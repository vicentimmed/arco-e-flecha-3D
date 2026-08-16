/* ---------------------------------------------------------------------------
   O ENTULHO — a pedra que voa no impacto e a que fica caída depois.

   De cliente: importa Three.js. O campo não sabe que isto existe.

   ------------------------------------------------------------ por que existe

   Nas três referências que o pedido trouxe há pedra solta por toda parte: pedaços
   voando radialmente em volta do poço, blocos cravados na parede do túnel,
   cascalho no chão. Isso faz METADE do trabalho de leitura — um buraco limpo,
   por mais lascada que seja a borda dele, continua parecendo uma forma
   geométrica. Um buraco com entulho parece uma coisa que EXPLODIU.

   Duas vidas, no mesmo pool:

       VOANDO    balística contra o campo, alguns segundos
       ASSENTADA parada onde caiu, para sempre

   E é o mesmo objeto: a peça que para de voar não é destruída nem trocada, só
   deixa de ser integrada. Sem realocação, sem segundo pool, sem chamada de
   desenho a mais.

   ----------------------------------------------------------------- e a rede

   Isto é ENFEITE LOCAL, e é a única parte do trabalho que pode ser. A posição
   final de um cascalho não decide luta nenhuma, então dois clientes desenharem a
   mesma pedra parando com meio metro de diferença não é divergência de jogo — é
   ruído. Mesmo assim o sorteio sai do hash do id do impacto, e não de
   `Math.random`: custa o mesmo e mantém a bancada reproduzível, que é o que
   permite comparar duas execuções depois de mexer num número.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { sorteio } from "./ruido.js";

/* Teto de pedaços em cena. Passou disso, o mais velho é reciclado.
 *
 * Caiu de 1400 para 700 depois da queixa de peso. O que se vê num monte de
 * entulho é a SILHUETA dele, e a silhueta satura muito antes do número de
 * pedras — dobrar a contagem não dobra a leitura, dobra o custo. */
const MAX = 700;
/** m/s² — gravidade. Mais forte que a real: pedra de jogo cai com peso. */
const G = -26;
/** Perda de energia ao bater. Pedra não quica muito; ela raspa e para. */
const QUIQUE = 0.28;
/** s — depois disto, o que ainda estiver voando é considerado assentado. */
const VIDA_MAX = 4;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _cor = new THREE.Color();

/* Um atributo `color` de UNS na geometria — e ele não é decoração.
 *
 * `vertexColors: true` liga o `USE_COLOR` do Three, e o shader passa a LER um
 * atributo `color` do vértice. Uma geometria de primitiva não tem esse atributo,
 * então ele entra como (0,0,0), `vColor` vira zero e a cor por instância é
 * multiplicada por zero: TUDO PRETO. Foi exatamente o que apareceu na tela —
 * entulho e pedras como buracos escuros.
 *
 * Preencher com uns deixa a cor por instância passar intacta. A alternativa
 * seria desligar `vertexColors`, mas aí o `instanceColor` não chega ao fragmento
 * nas versões atuais do Three. */
function pintarDeUns(geo) {
  const n = geo.attributes.position.count;
  const uns = new Float32Array(n * 3).fill(1);
  geo.setAttribute("color", new THREE.BufferAttribute(uns, 3));
  return geo;
}


export class Entulho {
  /**
   * @param {THREE.Object3D} raiz
   * @param {import("./campo.js").CampoCratera} campo
   */
  constructor(raiz, campo) {
    this.campo = campo;

    /* Um icosaedro de zero subdivisões: vinte faces, e com escala não uniforme
       por instância ele já lê como lasca de rocha. Geometria mais rica seria
       gasto puro num objeto que quase sempre aparece com poucos pixels. */
    const geo = pintarDeUns(new THREE.IcosahedronGeometry(0.5, 0));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      flatShading: true,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    raiz.add(this.mesh);

    /* Estado por peça, em arrays paralelos — o §3 do plano original já dizia
       por quê, e vale aqui: zero alocação em regime. */
    this.n = 0;
    this.prox = 0; // onde o próximo entra, quando o pool encheu
    this.p = new Float32Array(MAX * 3);
    this.v = new Float32Array(MAX * 3);
    this.rot = new Float32Array(MAX * 3);
    this.giro = new Float32Array(MAX * 3);
    this.esc = new Float32Array(MAX * 3);
    this.t = new Float32Array(MAX);
    this.voando = new Uint8Array(MAX);
  }

  /**
   * Solta um punhado de pedaços a partir de um impacto.
   *
   * A direção não é aleatória em todo o espaço: ela sai do CENTRO da bacia, o
   * que faz a nuvem abrir radialmente — é o que a primeira referência mostra, o
   * material saindo do poço em leque. Um sorteio isotrópico daria uma bola de
   * poeira, que é o que uma explosão de gás faz, não uma de rocha.
   *
   * @param {object} c o impacto já preparado (`prepararImpacto`)
   * @param {number} quantos
   */
  estourar(c, quantos = 26) {
    for (let k = 0; k < quantos; k++) {
      const i = this.vaga();
      const s1 = sorteio(c.id, 40 + k * 3);
      const s2 = sorteio(c.id, 41 + k * 3);
      const s3 = sorteio(c.id, 42 + k * 3);

      /* Direção: um ponto do cubo normalizado, empurrado para CIMA. O empurrão
         é o que impede metade dos pedaços de sair para dentro do chão e sumir
         no primeiro quadro. */
      let dx = s1 * 2 - 1;
      let dy = s2 * 1.4 + 0.35;
      let dz = s3 * 2 - 1;
      const m = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= m;
      dy /= m;
      dz /= m;

      /* Nasce na CASCA da bacia, não no centro: sair do centro faria a pedra
         atravessar a parede antes de aparecer. */
      const r = c.R * (0.55 + s1 * 0.5);
      const i3 = i * 3;
      this.p[i3] = c.cx + dx * r;
      this.p[i3 + 1] = c.cy + dy * r;
      this.p[i3 + 2] = c.cz + dz * r;

      const forca = 9 + s2 * 16 + c.R * 0.7;
      this.v[i3] = dx * forca;
      this.v[i3 + 1] = dy * forca;
      this.v[i3 + 2] = dz * forca;

      this.giro[i3] = (s1 - 0.5) * 9;
      this.giro[i3 + 1] = (s2 - 0.5) * 9;
      this.giro[i3 + 2] = (s3 - 0.5) * 9;
      this.rot[i3] = s1 * 6.28;
      this.rot[i3 + 1] = s2 * 6.28;
      this.rot[i3 + 2] = s3 * 6.28;

      /* Tamanho: a maioria cascalho, alguns blocos. A escala não uniforme é o
         que faz vinte faces parecerem lasca em vez de bolinha. */
      const base = 0.35 + s3 * s3 * c.R * 0.28;
      this.esc[i3] = base * (0.7 + s1 * 0.7);
      this.esc[i3 + 1] = base * (0.6 + s2 * 0.8);
      this.esc[i3 + 2] = base * (0.7 + s3 * 0.7);

      this.t[i] = 0;
      this.voando[i] = 1;
      this.pintar(i, this.p[i3], this.p[i3 + 1], this.p[i3 + 2]);
    }
    this.mesh.count = this.n;
  }

  /** Uma vaga livre, ou a mais velha se o pool encheu. */
  vaga() {
    if (this.n < MAX) return this.n++;
    const i = this.prox;
    this.prox = (this.prox + 1) % MAX;
    return i;
  }

  /** Cor por profundidade escavada, a mesma régua da parede. */
  pintar(i, x, y, z) {
    const prof = this.campo.alturaBase(x, z) - y;
    /* Uma tabela curta: o entulho é pequeno na tela e não precisa das cinco
       camadas da malha, só de não destoar dela. */
    if (prof < 3) _cor.setHex(0x9c7f56);
    else if (prof < 12) _cor.setHex(0x6b4b2c);
    else _cor.setHex(0x55504b);
    /* Uma variação por peça, senão o monte inteiro tem uma cor chapada. */
    const v = 0.82 + sorteio(i, 77) * 0.36;
    this.mesh.setColorAt(i, _cor.multiplyScalar(v));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Integra quem ainda voa.
   *
   * A colisão é contra o CAMPO, por amostragem de densidade — a mesma verdade
   * que a malha desenha. É isso que faz a pedra parar na parede do túnel em vez
   * de atravessá-la: ela não sabe o que é túnel, sabe o que é sólido.
   */
  update(dt) {
    if (this.n === 0) return;
    const campo = this.campo;
    const h = dt > 0.05 ? 0.05 : dt;
    let mexeu = false;

    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      /* SÓ QUEM SE MEXEU escreve matriz.
       *
       * A primeira versão tinha um `mexeu` só, ligado pela primeira peça voando —
       * e daí em diante TODA peça do pool recompunha a própria matriz a cada
       * quadro, mesmo as centenas já paradas no chão. Com o pool cheio eram mil e
       * quatrocentas composições de matriz por quadro para redesenhar pedras que
       * não saem do lugar desde o primeiro minuto. */
      if (!this.voando[i]) continue;
      {
        this.t[i] += h;
        this.v[i3 + 1] += G * h;

        let nx = this.p[i3] + this.v[i3] * h;
        let ny = this.p[i3 + 1] + this.v[i3 + 1] * h;
        let nz = this.p[i3 + 2] + this.v[i3 + 2] * h;

        if (campo.solidoEm(nx, ny, nz)) {
          /* Bateu. A normal do campo dá a reflexão; com `QUIQUE` baixo o que
             acontece na prática é raspar e parar, que é o que pedra faz. */
          const n = campo.normalEm(this.p[i3], this.p[i3 + 1], this.p[i3 + 2], _p);
          const vn = this.v[i3] * n.x + this.v[i3 + 1] * n.y + this.v[i3 + 2] * n.z;
          if (vn < 0) {
            this.v[i3] -= n.x * vn * (1 + QUIQUE);
            this.v[i3 + 1] -= n.y * vn * (1 + QUIQUE);
            this.v[i3 + 2] -= n.z * vn * (1 + QUIQUE);
          }
          this.v[i3] *= 0.55;
          this.v[i3 + 1] *= 0.55;
          this.v[i3 + 2] *= 0.55;
          nx = this.p[i3];
          ny = this.p[i3 + 1];
          nz = this.p[i3 + 2];

          const rapidez =
            this.v[i3] * this.v[i3] + this.v[i3 + 1] * this.v[i3 + 1] + this.v[i3 + 2] * this.v[i3 + 2];
          if (rapidez < 1.2) this.voando[i] = 0;
        }

        this.p[i3] = nx;
        this.p[i3 + 1] = ny;
        this.p[i3 + 2] = nz;
        this.rot[i3] += this.giro[i3] * h;
        this.rot[i3 + 1] += this.giro[i3 + 1] * h;
        this.rot[i3 + 2] += this.giro[i3 + 2] * h;

        /* Caiu do mundo, ou cansou. Nos dois casos ela para de ser integrada:
           uma peça esquecida voando para sempre é custo por quadro para sempre. */
        if (this.t[i] > VIDA_MAX || ny < -200) this.voando[i] = 0;
        mexeu = true;
      }

      {
        _p.set(this.p[i3], this.p[i3 + 1], this.p[i3 + 2]);
        _e.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2]);
        _q.setFromEuler(_e);
        _s.set(this.esc[i3], this.esc[i3 + 1], this.esc[i3 + 2]);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(i, _m);
      }
    }

    if (mexeu) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Reassenta o que ficou no ar depois de uma escavação nova.
   *
   * É o "não devem ficar flutuando" do pedido, aplicado ao próprio entulho: uma
   * pedra que estava pousada no chão e teve o chão levado embora pela cratera
   * seguinte volta a cair.
   */
  sacudir(cx, cy, cz, raio) {
    const r2 = raio * raio;
    for (let i = 0; i < this.n; i++) {
      if (this.voando[i]) continue;
      const i3 = i * 3;
      const dx = this.p[i3] - cx;
      const dy = this.p[i3 + 1] - cy;
      const dz = this.p[i3 + 2] - cz;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      /* Ainda tem chão logo abaixo? Se não, volta a voar. */
      if (this.campo.solidoEm(this.p[i3], this.p[i3 + 1] - 0.6, this.p[i3 + 2])) continue;
      this.voando[i] = 1;
      this.t[i] = 0;
      this.v[i3] = 0;
      this.v[i3 + 1] = 0;
      this.v[i3 + 2] = 0;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
