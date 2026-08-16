/* ---------------------------------------------------------------------------
   AS ROCHAS do cenário — e o que uma explosão faz com elas.

   O pedido, literal:

     *"se tiver rochas ou outros objetos quando a cratera for aberta, eles
      explodem ou desabam, não devem ficar flutuando. Se o poder pegar direto
      numa rocha ela é destruída e o poder continua e abre a cratera. Se pegar no
      chão mas a cratera for grande o suficiente para pegar na rocha que está ao
      lado, a rocha é destruída."*

   São três regras, e todas se resolvem no mesmo lugar, com uma frase:

       A PEÇA NÃO É OBSTÁCULO DO GOLPE. ELA É VÍTIMA DO RAIO DA CRATERA.

   1. **O poder não para nela.** Rocha não entra no teste de colisão do projétil
      — só o terreno detém um golpe. Quem encosta numa pedra a destrói e SEGUE, e
      a cratera nasce onde ele bateu no chão. Aqui isso não é código nenhum: é a
      ausência de código. `dev/cratera.js` marcha o raio contra o CAMPO, e as
      peças não estão no campo.

   2. **Quem está no raio morre junto.** Depois de cada escavação, toda peça cuja
      esfera toque a bacia é destruída. O critério é `distância < raio da cratera
      + raio da peça`, e não "o centro dela caiu dentro": uma pedra grande
      encostada na borda é atingida, que é o que uma explosão faz.

   3. **Quem ficou sem chão CAI.** É a parte que exige trabalho de verdade. Uma
      peça pode estar fora do raio e mesmo assim ter perdido o apoio, porque a
      cratera comeu o chão debaixo dela. Ela vira corpo em queda contra o campo
      até achar piso — e se cair de alto demais, se espatifa em vez de pousar.

   ------------------------------------------------------------------- e a rede

   A destruição é DERIVADA, não transmitida. Uma peça morre porque uma escavação
   a alcançou, e a lista de escavações já viaja (§11 do plano): todo mundo chega
   à mesma lista de peças mortas sem um byte a mais. A distribuição inicial sai
   do hash da semente, então também é a mesma em toda máquina.

   A QUEDA é enfeite local, como o entulho. Se dois clientes desenharem a mesma
   pedra pousando com meio metro de diferença, ninguém perde uma luta por isso.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { sorteio, ruido3 } from "./ruido.js";
import { METADE } from "./campo.js";

/** Quantas pedras a arena semeia. */
const QUANTAS = 220;
/** m/s² — a mesma gravidade pesada do entulho. */
const G = -26;
/** m — cair mais que isto ESPATIFA em vez de pousar. */
const QUEDA_FATAL = 7;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _cor = new THREE.Color();

export class Rochas {
  /**
   * @param {THREE.Object3D} raiz
   * @param {import("./campo.js").CampoCratera} campo
   * @param {import("./entulho.js").Entulho} entulho para onde vai o que quebra
   */
  constructor(raiz, campo, entulho) {
    this.campo = campo;
    this.entulho = entulho;

    const geo = new THREE.DodecahedronGeometry(1, 0);
    /* Ver `pintarDeUns` em `entulho.js`: sem o atributo `color`, `vertexColors`
       zera a cor da instância e a pedra sai preta. */
    {
      const n = geo.attributes.position.count;
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, QUANTAS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(QUANTAS * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    raiz.add(this.mesh);

    this.n = 0;
    this.px = new Float32Array(QUANTAS);
    this.py = new Float32Array(QUANTAS);
    this.pz = new Float32Array(QUANTAS);
    this.raio = new Float32Array(QUANTAS);
    this.escY = new Float32Array(QUANTAS);
    this.rot = new Float32Array(QUANTAS * 3);
    this.vy = new Float32Array(QUANTAS);
    /** 0 = de pé · 1 = caindo · 2 = destruída */
    this.estado = new Uint8Array(QUANTAS);
    /** Cota de onde a queda começou, para saber se ela é fatal. */
    this.yQueda = new Float32Array(QUANTAS);

    this.semear();
  }

  /**
   * Espalha as pedras pela arena. Determinístico pela semente do campo — o §11
   * vale também para o cenário, senão dois jogadores acertariam pedras
   * diferentes.
   */
  semear() {
    const s = this.campo.semente;
    let posta = 0;
    for (let k = 0; k < QUANTAS * 4 && posta < QUANTAS; k++) {
      const x = (sorteio(s ^ k, 11) * 2 - 1) * (METADE - 6);
      const z = (sorteio(s ^ k, 12) * 2 - 1) * (METADE - 6);
      /* Nem no chão liso demais nem na parede: um ruído decide onde há pedregulho,
         para elas saírem em grupos em vez de chuviscadas por igual. */
      if (ruido3(x * 0.03, 3.7, z * 0.03, s ^ 0x5a) < -0.12) continue;

      const r = 0.9 + sorteio(s ^ k, 13) * 2.6;
      const i = posta++;
      this.px[i] = x;
      this.pz[i] = z;
      this.raio[i] = r;
      /* Assenta um pouco ENTERRADA: pedra pousada tangenciando o chão parece
         adesivo, pedra meio enfiada parece que está ali há mil anos. */
      this.py[i] = this.campo.alturaBase(x, z) + r * 0.45;
      this.escY[i] = 0.62 + sorteio(s ^ k, 14) * 0.5;
      this.rot[i * 3] = sorteio(s ^ k, 15) * 6.28;
      this.rot[i * 3 + 1] = sorteio(s ^ k, 16) * 6.28;
      this.rot[i * 3 + 2] = sorteio(s ^ k, 17) * 6.28;
      this.estado[i] = 0;
      const v = 0.78 + sorteio(s ^ k, 18) * 0.4;
      _cor.setHex(0x6d6a63).multiplyScalar(v);
      this.mesh.setColorAt(i, _cor);
      this.escrever(i);
    }
    this.n = posta;
    this.mesh.count = posta;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  escrever(i) {
    _p.set(this.px[i], this.py[i], this.pz[i]);
    _e.set(this.rot[i * 3], this.rot[i * 3 + 1], this.rot[i * 3 + 2]);
    _q.setFromEuler(_e);
    const r = this.raio[i];
    _s.set(r, r * this.escY[i], r);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
  }

  /** Some da cena sem buraco no `InstancedMesh`: escala zero. */
  apagar(i) {
    this.estado[i] = 2;
    _m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, _m);
  }

  /**
   * O que uma escavação faz com as pedras em volta. Chamado depois de `escavar`.
   *
   * @param {object} c o impacto já preparado
   */
  aplicar(c) {
    /* O alcance da checagem é generoso: quem morre é quem está dentro do raio da
       cratera, mas quem pode PERDER O CHÃO está bem mais longe — o lábio de
       ejeção e a saia da bacia mexem no terreno além da casca. */
    const busca = c.alcance + 8;
    const b2 = busca * busca;

    for (let i = 0; i < this.n; i++) {
      if (this.estado[i] === 2) continue;
      const dx = this.px[i] - c.cx;
      const dy = this.py[i] - c.cy;
      const dz = this.pz[i] - c.cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > b2) continue;

      const d = Math.sqrt(d2);

      /* REGRA 2 — dentro do raio da explosão, morre. O raio da PEÇA entra na
         conta: uma pedra grande encostada na borda é atingida. */
      if (d < c.R + this.raio[i]) {
        this.estourar(i, c);
        continue;
      }

      /* REGRA 3 — ficou sem chão? Então cai. */
      if (this.estado[i] === 0 && !this.temChao(i)) {
        this.estado[i] = 1;
        this.vy[i] = 0;
        this.yQueda[i] = this.py[i];
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Há sólido logo abaixo da base desta pedra? */
  temChao(i) {
    const base = this.py[i] - this.raio[i] * this.escY[i] * 0.5;
    return this.campo.solidoEm(this.px[i], base - 0.35, this.pz[i]);
  }

  /** A pedra vira entulho: some, e solta lascas do tamanho dela. */
  estourar(i, c) {
    this.entulho.estourar(
      {
        id: (c.id * 7919 + i) | 0,
        cx: this.px[i],
        cy: this.py[i],
        cz: this.pz[i],
        R: this.raio[i] * 1.2,
      },
      6 + Math.round(this.raio[i] * 3),
    );
    this.apagar(i);
  }

  /** Integra as que estão caindo. */
  update(dt) {
    const h = dt > 0.05 ? 0.05 : dt;
    let mexeu = false;
    for (let i = 0; i < this.n; i++) {
      if (this.estado[i] !== 1) continue;
      this.vy[i] += G * h;
      this.py[i] += this.vy[i] * h;
      this.rot[i * 3] += h * 1.6;

      if (this.temChao(i)) {
        const queda = this.yQueda[i] - this.py[i];
        if (queda > QUEDA_FATAL) {
          /* Caiu de alto: SE ESPATIFA. É a leitura certa de um pedregulho
             despencando vinte metros — pousar de leve seria pior que flutuar. */
          this.entulho.estourar(
            { id: (i * 104729) | 0, cx: this.px[i], cy: this.py[i], cz: this.pz[i], R: this.raio[i] * 1.4 },
            8 + Math.round(this.raio[i] * 4),
          );
          this.apagar(i);
        } else {
          this.estado[i] = 0;
          this.escrever(i);
        }
        mexeu = true;
        continue;
      }

      if (this.py[i] < -200) {
        this.apagar(i);
        mexeu = true;
        continue;
      }
      this.escrever(i);
      mexeu = true;
    }
    if (mexeu) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Quantas ainda estão de pé. Para a bancada mostrar. */
  vivas() {
    let n = 0;
    for (let i = 0; i < this.n; i++) if (this.estado[i] !== 2) n++;
    return n;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
