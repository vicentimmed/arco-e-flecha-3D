/* ---------------------------------------------------------------------------
   O Kienzan — o disco cortante.

   É o especial que NÃO é um feixe, e a diferença é o ponto dele. Os outros três
   ocupam o céu: o Kamehameha e o Galick Gun são uma parede de luz de meio
   quilômetro, a Genki Dama é uma lua. O disco é fino, silencioso e voa reto a
   105 m/s — quem morre para ele morreu porque não viu.

   Três regras que separam este arquivo dos vizinhos:

   • **NÃO EXPLODE.** Nunca. Ele corta e segue. A tentação de dar um estouro ao
     impacto é grande e é errada: o golpe todo é "aquilo passou por mim", e uma
     bola de fogo apagaria a única leitura que ele tem.
   • **Corta de uma vez** — `damage` em `NAMEK.specials.disk`, não `dps`. Quem
     encosta leva os 48 inteiros, uma vez só, e o disco continua o voo. Um
     disco que morre no primeiro corpo seria uma bola de ki cara.
   • **Atravessa quem já cortou.** A tabela de cortados existe para isso: sem
     ela, ficar dentro do plano do disco por dois quadros custaria o dobro.

   O que o para é o CHÃO, como tudo neste modo — e ali ele abre a rasgadura de
   `power: 1.4`, que é uma cicatriz e não uma cratera.

   -------------------------------------------------------------------- a forma

   O disco fica de PÉ e o plano dele contém a direção do voo: é uma serra, não
   um frisbee. Um disco visto de frente é um círculo, e um círculo brilhante
   voando lê como bola de energia — que é o outro golpe. De perfil ele é um
   traço, e um traço voando lê como lâmina.

   E ele PRECESSA em volta do próprio eixo de voo, devagar. Isso resolve o
   problema de um anel girando em torno do próprio eixo ser literalmente
   invisível (um anel é simétrico à rotação: girá-lo não muda um pixel). Com a
   precessão ele mostra a face de vez em quando, e o clarão em arco no gume
   corre pela borda dando a leitura do giro.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { gameEvents, EventType } from "../../core/events.js";
import { atingivel, distancia2AoAlvo, pegarVaga, PEITO, TETO_DO_RELEVO } from "./blast.js";

/** Quantos discos ao mesmo tempo. Dois por golpe é mais do que já aconteceu. */
const MAX_DISCOS = 6;

/** rad/s — o giro do clarão pela borda. Rápido: é uma serra. */
const GIRO = 27;
/** rad/s — a precessão do plano em volta do eixo de voo. Devagar: é o que
 *  mostra a face sem transformar o voo num cambalhota. */
const PRECESSAO = 2.2;

/** Fração interna do anel. O miolo do Kienzan é vazado no desenho original. */
const VAZADO = 0.52;
/** Fração do círculo que o clarão do gume cobre. */
const ARCO = 0.62;

/* ------------------------------------------------------------- rascunhos --- */
const _Z = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _eixo = new THREE.Vector3();
const _cor = new THREE.Color();
const MAX_CORTADOS = NAMEK.net.maxPlayers + 1;

/* ============================================================================
   Um disco
   ========================================================================== */

class Disco {
  constructor(scene, geos) {
    this.scene = scene;
    /* `viva`, `t` e `local` existem ANTES do primeiro disparo porque
       `pegarVaga` os lê para escolher quem reciclar. Um slot nunca usado sai
       pelo `!viva`, mas depender dessa ordem seria depender de uma ordem. */
    this.viva = false;
    this.t = 0;
    this.local = false;
    this.group = new THREE.Group();
    this.group.visible = false;

    this.corpo = this.folha(geos.corpo, 0.3, 1);
    this.gume = this.folha(geos.gume, 0.95, 2);

    scene.add(this.group);

    this.cortado = new Array(MAX_CORTADOS).fill(null);
    this.nCortados = 0;
    /** A base perpendicular ao voo, resolvida a cada disparo e guardada aqui. */
    this.b1 = new THREE.Vector3();
    this.b2 = new THREE.Vector3();
  }

  folha(geo, opacidade, ordem) {
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: opacidade,
        // Um disco tem dois lados e os dois são vistos: cortar a face de trás
        // faria a lâmina sumir em metade da precessão.
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    mesh.renderOrder = ordem;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /* ---------------------------------------------------------------- disparo */

  acender(field, { owner, kind, origem, dir, local }) {
    const S = NAMEK.specials[kind];
    this.field = field;
    this.owner = owner;
    this.kind = kind;
    this.info = S;
    this.local = !!local;
    this.viva = true;
    this.t = 0;
    this.percorrido = 0;
    this.nCortados = 0;

    this.x = origem.x;
    this.y = origem.y;
    this.z = origem.z;
    const inv = 1 / (Math.hypot(dir.x, dir.y, dir.z) || 1);
    this.dx = dir.x * inv;
    this.dy = dir.y * inv;
    this.dz = dir.z * inv;

    /* A vida é o MENOR entre o que a sustentação permite e o que o alcance
       permite. Com 105 m/s e 3,2 s ele para nos 336 m, antes dos 520 de
       `range`; deixar as duas contas escritas é o que impede um ajuste de
       velocidade em `NAMEK` de transformar o disco numa coisa que atravessa a
       arena inteira sem ninguém ter mexido no alcance. */
    this.vida = Math.min(S.sustain, S.range / S.speed);

    /* A BASE PERPENDICULAR ao voo, resolvida uma vez. `_p1` é qualquer vetor
       ortogonal ao eixo (o mundo tem um "para cima", e usá-lo faz o disco
       nascer de pé, que é a pose de arremesso); `_p2` fecha a base. */
    _eixo.set(this.dx, this.dy, this.dz);
    _p1.set(0, 1, 0).cross(_eixo);
    if (_p1.lengthSq() < 1e-6) _p1.set(1, 0, 0).cross(_eixo); // tiro na vertical
    _p1.normalize();
    _p2.copy(_eixo).cross(_p1).normalize();
    this.b1.copy(_p1);
    this.b2.copy(_p2);

    _cor.set(S.cor);
    this.corpo.material.color.copy(_cor);
    this.gume.material.color.set(0xffffff).lerp(_cor, 0.3);
    this.group.visible = true;
    this.group.position.set(this.x, this.y, this.z);

    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 18,
      color: S.cor,
      speed: 7,
      spread: 1,
      size: 0.3,
      grow: -0.5,
      life: S.windup * 0.85,
      gravity: 0,
      drag: 2.4,
      alpha: 1,
      additive: true,
    });
    return this;
  }

  /* ------------------------------------------------------------------ passo */

  update(dt, alvos, localId, relato) {
    if (!this.viva) return true;
    const S = this.info;
    this.t += dt;

    /* A CARGA. O disco se forma na mão, girando, e cresce. É curta (0,7 s) de
       propósito: o Kienzan é o especial rápido, e um aviso longo tiraria dele a
       única vantagem que ele tem sobre um feixe. */
    if (this.t < S.windup) {
      const u = this.t / S.windup;
      this.orientar(u * u * S.hitRadius);
      if (this.local) relato.luz(this.x, this.y, this.z, S.cor, 0.2 * u);
      return false;
    }

    const tv = this.t - S.windup;
    if (tv >= this.vida) {
      this.sumir();
      return true;
    }

    /* O AVANÇO, subdividido pelo raio de acerto quando o quadro estica — a
       mesma trava de `blast.js`, e pelo mesmo motivo: a 105 m/s um quadro de
       30 Hz anda 3,5 m e o raio de corte é 2,2. Sem isto, o disco atravessaria
       gente sem nunca ter estado perto dela num quadro só. */
    const avanco = S.speed * dt;
    const n = avanco > S.hitRadius ? Math.ceil(avanco / S.hitRadius) : 1;
    const passo = avanco / n;
    const raio2 = S.hitRadius * S.hitRadius;

    for (let s = 0; s < n; s++) {
      this.x += this.dx * passo;
      this.y += this.dy * passo;
      this.z += this.dz * passo;
      this.percorrido += passo;

      /* CORTA E SEGUE. O disco não morre em quem ele pega — ele atravessa, e
         é por isso que o laço não sai daqui ao achar alguém.
         O TALHO aparece em toda tela; o AVISO à sala sai só na de quem atirou
         (§8 do plano). Desenhar é de todos, julgar é de quem disparou. */
      for (let k = 0; k < alvos.length; k++) {
        const a = alvos[k];
        if (!atingivel(a, this.owner)) continue;
        if (this.jaCortou(a.id)) continue;
        if (distancia2AoAlvo(a, this.x, this.y, this.z) > raio2) continue;
        this.marcar(a.id);
        this.talhar(a);
        if (this.owner !== localId) continue;
        /* Pelo canal do especial, e com `dt: 0` — o Kienzan tem `damage` e
           não `dps` em `NAMEK.specials`, e é a sala que sabe a diferença.
           Ver o cabeçalho de `powers/index.js`. */
        const e = relato.queima();
        e.owner = this.owner;
        e.victim = a.id;
        e.kind = this.kind;
        e.dt = 0;
      }

      if (this.y < TETO_DO_RELEVO && this.y <= this.field.heightAt(this.x, this.z)) {
        this.cravar(relato, localId);
        return true;
      }
    }

    this.orientar(S.hitRadius);
    if (this.local) relato.luz(this.x, this.y, this.z, S.cor, 0.3);
    return false;
  }

  /**
   * Posição, plano e giro.
   *
   * A NORMAL precessa em volta do eixo de voo: ela é uma combinação da base
   * perpendicular resolvida no disparo. Isso é o que faz o disco mostrar a face
   * de vez em quando — sem precessão, um anel girando no próprio eixo não muda
   * um pixel, e o jogador veria uma lâmina parada deslizando pelo ar.
   */
  orientar(raio) {
    const a = this.t * PRECESSAO;
    _n.copy(this.b1).multiplyScalar(Math.cos(a)).addScaledVector(this.b2, Math.sin(a));
    this.group.position.set(this.x, this.y, this.z);
    this.group.quaternion.setFromUnitVectors(_Z, _n);
    this.group.rotateZ(this.t * GIRO);
    const r = Math.max(0.001, raio);
    this.group.scale.set(r, r, r);
  }

  jaCortou(id) {
    for (let i = 0; i < this.nCortados; i++) if (this.cortado[i] === id) return true;
    return false;
  }

  marcar(id) {
    if (this.nCortados >= MAX_CORTADOS) return;
    this.cortado[this.nCortados++] = id;
  }

  /** O corte. Um risco de luz no peito de quem passou — nada de bola de fogo. */
  talhar(a) {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: a.x, y: a.y + a.altura * PEITO, z: a.z },
      count: 14,
      color: this.info.cor,
      speed: 15,
      spread: 0.35,
      // Saem na direção do voo do disco: é o rastro do talho, e ele aponta para
      // onde a lâmina foi.
      direction: { x: this.dx, y: this.dy, z: this.dz },
      size: 0.16,
      grow: 0.8,
      life: 0.34,
      gravity: 0,
      drag: 1.8,
      alpha: 1,
      additive: true,
    });
  }

  /** Bateu no chão: cicatriz, poeira e fim. Sem explosão — ver o cabeçalho. */
  cravar(relato, localId) {
    if (this.owner === localId) {
      const e = relato.chao();
      e.owner = this.owner;
      e.p.x = this.x;
      e.p.y = this.y;
      e.p.z = this.z;
      e.power = this.info.power;
    }
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 20,
      color: 0x7a8a5c,
      speed: 9,
      spread: 0.6,
      direction: { x: -this.dx, y: 1, z: -this.dz },
      size: 0.34,
      grow: 2.4,
      life: 0.9,
      gravity: NAMEK.fighter.gravity * 0.5,
      drag: 1.3,
      alpha: 0.75,
    });
    this.sumir();
  }

  /** Fim de vida no ar: a energia se desfaz, sem estouro. */
  sumir() {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 10,
      color: this.info.cor,
      speed: 5,
      spread: 1,
      size: 0.22,
      grow: 1.2,
      life: 0.4,
      gravity: 0,
      drag: 2.2,
      alpha: 0.8,
      additive: true,
    });
    this.apagar();
  }

  apagar() {
    this.viva = false;
    this.group.visible = false;
    this.nCortados = 0;
  }

  dispose() {
    this.scene.remove(this.group);
    this.corpo.material.dispose();
    this.gume.material.dispose();
  }
}

/* ============================================================================
   O pool
   ========================================================================== */

export class DiskPool {
  constructor(scene, field, max = MAX_DISCOS) {
    this.scene = scene;
    this.field = field;

    /* Raio 1 na geometria: o tamanho vira escala, e os seis discos dividem os
       mesmos dois buffers. */
    this.geos = {
      corpo: new THREE.RingGeometry(VAZADO, 1, 48, 1),
      // O clarão do gume é um ARCO, e é ele que torna o giro visível. Um anel
      // inteiro seria simétrico e girar não mudaria nada na tela.
      gume: new THREE.RingGeometry(0.88, 1.02, 48, 1, 0, Math.PI * 2 * ARCO),
    };

    this.discos = new Array(max);
    for (let i = 0; i < max; i++) this.discos[i] = new Disco(scene, this.geos);
  }

  disparar(disparo) {
    if (!NAMEK.specials[disparo.kind]) return null;
    return pegarVaga(this.discos).acender(this.field, disparo);
  }

  update(dt, alvos, localId, relato) {
    for (let i = 0; i < this.discos.length; i++) {
      const d = this.discos[i];
      if (!d.viva) continue;
      if (d.update(dt, alvos, localId, relato)) d.apagar();
    }
  }

  get count() {
    let n = 0;
    for (let i = 0; i < this.discos.length; i++) if (this.discos[i].viva) n++;
    return n;
  }

  clear() {
    for (let i = 0; i < this.discos.length; i++) this.discos[i].apagar();
  }

  dispose() {
    for (let i = 0; i < this.discos.length; i++) this.discos[i].dispose();
    this.geos.corpo.dispose();
    this.geos.gume.dispose();
  }
}
