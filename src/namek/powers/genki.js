/* ---------------------------------------------------------------------------
   A Genki Dama.

   Onze metros de raio, 46 m/s, 3,6 s de carga parado no lugar. Todos os números
   deste golpe existem para dizer a mesma coisa: **ele é PESADO.**

   Peso, num jogo, não é massa — é tempo. A Genki Dama é lenta em três escalas
   diferentes e é a soma delas que faz a esfera parecer ter tonelada:

   • **Carga longa (3,6 s).** Um terço do tempo em que a arena inteira sabe onde
     você está e o que você vai fazer. É o preço, e é também o espetáculo: a
     bola crescendo sobre a cabeça é a imagem mais reconhecível da referência.
   • **Voo lento (46 m/s).** Menos da metade de uma bola de ki. Dá para desviar
     — e é para dar: um golpe de 96 de dano que não se pode desviar não é um
     golpe, é um sorteio.
   • **Crescimento que não para.** A esfera respira e gira devagar a viagem
     inteira. Coisa leve vibra rápido; coisa pesada oscila devagar.

   O que ela ganha em troca: a MAIOR cratera do jogo (`power: 12` → 21 m de
   buraco, contra os 13 do Kamehameha), a única luz dinâmica que o modo tem para
   dar, e um raio de morte de 11 m — quem estava perto de quem foi atingido
   também morreu.

   -------------------------------------------------------------------- a casca

   Uma esfera aditiva lisa girando é indistinguível de uma esfera aditiva lisa
   parada, e é assim que se perde a leitura de peso: o olho não tem em que se
   agarrar. A casca aqui é uma malha de arame — o icosaedro subdividido, em
   `wireframe` — girando devagar em dois eixos. É a mesma esfera de energia
   reunida da referência e é ela que carrega a rotação.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { gameEvents, EventType } from "../../core/events.js";
import { atingivel, distancia2AoAlvo, pegarVaga, TETO_DO_RELEVO } from "./blast.js";

/* Três. A Genki Dama custa a barra cheia E 3,6 s parado; três ao mesmo tempo
   numa sala de quinze já é um acontecimento que ninguém viu. */
const MAX_GENKIS = 3;

/** s — quanto dura o clarão da detonação depois do impacto. */
const ESTOURO = 0.62;
/** Quantas vezes a casca abre no estouro. */
const ESTOURO_ESCALA = 2.6;
/** rad/s — a rotação da malha. Devagar: é o que dá o peso. */
const GIRO_X = 0.32;
const GIRO_Y = 0.51;
/** s — de quanto em quanto tempo saem as fagulhas que ela vai recolhendo. */
const INTERVALO_FAGULHA = 0.16;

/* ------------------------------------------------------------- rascunhos --- */
const _cor = new THREE.Color();
const MAX_VITIMAS = NAMEK.net.maxPlayers + 1;

/* ============================================================================
   Uma Genki Dama
   ========================================================================== */

class Genki {
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

    this.nucleo = new THREE.Mesh(
      geos.bola,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.8,
        fog: false,
      }),
    );
    this.nucleo.renderOrder = 5;
    this.nucleo.frustumCulled = false;

    this.casca = new THREE.Mesh(
      geos.malha,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.34,
        wireframe: true,
        fog: false,
      }),
    );
    this.casca.renderOrder = 6;
    this.casca.frustumCulled = false;

    this.group.add(this.nucleo);
    this.group.add(this.casca);
    scene.add(this.group);

    this.vitima = new Array(MAX_VITIMAS).fill(null);
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
    this.tEstouro = 0;
    this.estourando = false;
    this.raio = 0.001;
    this._fag = 0;

    const inv = 1 / (Math.hypot(dir.x, dir.y, dir.z) || 1);
    this.dx = dir.x * inv;
    this.dy = dir.y * inv;
    this.dz = dir.z * inv;

    /* ELA NASCE ACIMA DA MÃO, meio raio para cima. Uma esfera de 11 m centrada
       no punho engole o lutador inteiro e a pose de erguer os braços — que é a
       pose do golpe — deixa de ser vista. Meio raio é o que basta para o corpo
       ficar por baixo dela, exatamente como na referência. */
    this.x = origem.x;
    this.y = origem.y + S.hitRadius * 0.55;
    this.z = origem.z;

    this.vida = Math.min(S.sustain, S.range / S.speed);

    _cor.set(S.cor);
    this.nucleo.material.color.set(0xffffff).lerp(_cor, 0.42);
    this.nucleo.material.opacity = 0.8;
    this.casca.material.color.copy(_cor);
    this.casca.material.opacity = 0.34;
    this.casca.rotation.set(0, 0, 0);
    this.group.visible = true;
    return this;
  }

  /* ------------------------------------------------------------------ passo */

  update(dt, alvos, localId, relato) {
    if (!this.viva) return true;
    const S = this.info;
    this.t += dt;

    if (this.estourando) return this.passoDoEstouro(dt, relato);

    /* A CARGA. A esfera cresce no lugar por 3,6 s.
     *
     * `u^0.72` e não `u`: ela salta de tamanho no primeiro segundo e depois vai
     * enchendo devagar, que é como uma coisa grande se forma. Crescimento
     * linear daria uma bola inflando em velocidade constante — leia-se balão. */
    if (this.t < S.windup) {
      const u = this.t / S.windup;
      this.raio = S.hitRadius * Math.pow(u, 0.72);
      this.recolher(dt, u);
      this.desenhar(dt);
      if (this.local) relato.luz(this.x, this.y, this.z, S.cor, 0.45 + 0.4 * u);
      return false;
    }

    this.raio = S.hitRadius;
    const tv = this.t - S.windup;

    /* O VOO. Passo único, sem subdivisão — e aqui isso é seguro por construção:
       a 46 m/s um quadro de 30 Hz anda 1,5 m contra um raio de morte de 11.
       Nem a 5 fps ela atravessaria alguém. */
    this.x += this.dx * S.speed * dt;
    this.y += this.dy * S.speed * dt;
    this.z += this.dz * S.speed * dt;

    const chao =
      this.y < TETO_DO_RELEVO + S.hitRadius
        ? this.field.heightAt(this.x, this.z)
        : -1e9;
    const noChao = this.y - S.hitRadius <= chao;

    let encostou = noChao;
    if (!encostou) {
      const raio2 = S.hitRadius * S.hitRadius;
      for (let k = 0; k < alvos.length; k++) {
        const a = alvos[k];
        if (!atingivel(a, this.owner)) continue;
        if (distancia2AoAlvo(a, this.x, this.y, this.z) <= raio2) {
          encostou = true;
          break;
        }
      }
    }
    /* Fim da linha sem encostar em nada: ela detona no ar mesmo. Uma Genki Dama
       que simplesmente some depois de 3,6 s de carga é a maior anticlímax que o
       modo poderia ter. */
    if (!encostou && tv >= this.vida) encostou = true;

    if (encostou) {
      this.detonar(alvos, localId, relato, noChao ? chao : null);
      return false;
    }

    this.rastro(dt);
    this.desenhar(dt);
    if (this.local) relato.luz(this.x, this.y, this.z, S.cor, 1);
    return false;
  }

  /* --------------------------------------------------------------- detonação */

  /**
   * O impacto.
   *
   * Tudo o que estiver a menos de `hitRadius` do centro leva `damage` de uma
   * vez — pelo canal do especial, com `dt: 0`: a Genki Dama tem `damage` e não
   * `dps` em `NAMEK.specials`, e é a sala que sabe a diferença (ver o cabeçalho
   * de `powers/index.js`).
   *
   * A cratera só é reportada se ela encostou no CHÃO. Uma detonação a duzentos
   * metros de altura que abrisse um buraco no terreno debaixo dela seria um
   * buraco que ninguém viu abrir — e, pior, gastaria uma das 96 vagas que
   * `NAMEK.destruction.craterLimit` guarda para a partida inteira.
   */
  detonar(alvos, localId, relato, alturaDoChao) {
    const S = this.info;
    this.estourando = true;
    this.tEstouro = 0;

    if (this.owner === localId) {
      const raio2 = S.hitRadius * S.hitRadius;
      for (let k = 0; k < alvos.length; k++) {
        const a = alvos[k];
        if (!atingivel(a, this.owner)) continue;
        if (distancia2AoAlvo(a, this.x, this.y, this.z) > raio2) continue;
        const e = relato.queima();
        e.owner = this.owner;
        e.victim = a.id;
        e.kind = this.kind;
        e.dt = 0;
      }
      if (alturaDoChao !== null) {
        const e = relato.chao();
        e.owner = this.owner;
        e.p.x = this.x;
        e.p.y = alturaDoChao;
        e.p.z = this.z;
        e.power = S.power;
      }
    }

    // O clarão. Aditivo, largo e curto — a poeira quem levanta é a cratera.
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 46,
      color: S.cor,
      speed: 48,
      spread: 1,
      size: S.hitRadius * 0.22,
      grow: 2.6,
      life: 0.75,
      gravity: 0,
      drag: 1.1,
      alpha: 1,
      additive: true,
    });
    if (alturaDoChao === null) return;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: alturaDoChao, z: this.z },
      count: 34,
      color: 0x7c8a5e,
      speed: 26,
      spread: 0.5,
      direction: { x: 0, y: 1, z: 0 },
      size: 1.6,
      grow: 3.4,
      life: 1.7,
      gravity: NAMEK.fighter.gravity * 0.35,
      drag: 0.9,
      alpha: 0.8,
    });
  }

  /** A casca abre e apaga. Meio segundo, e a Genki Dama acabou. */
  passoDoEstouro(dt, relato) {
    this.tEstouro += dt;
    const u = this.tEstouro / ESTOURO;
    if (u >= 1) return true;

    const k = this.info.hitRadius * (1 + (ESTOURO_ESCALA - 1) * u);
    const some = (1 - u) * (1 - u);
    this.group.position.set(this.x, this.y, this.z);
    this.nucleo.scale.setScalar(k * 0.9);
    this.nucleo.material.opacity = 0.8 * some;
    this.casca.scale.setScalar(k);
    this.casca.material.opacity = 0.34 * some;
    if (this.local) relato.luz(this.x, this.y, this.z, this.info.cor, 1.4 * (1 - u));
    return false;
  }

  /* ------------------------------------------------------------------ visual */

  desenhar(dt) {
    this.group.position.set(this.x, this.y, this.z);
    /* A respiração. Meio hertz e 3 % de amplitude — devagar o bastante para
       ninguém contar as batidas, forte o bastante para a esfera não parecer
       um adesivo colado na tela. */
    const resp = 1 + Math.sin(this.t * 3.1) * 0.03;
    this.nucleo.scale.setScalar(Math.max(0.001, this.raio * 0.88 * resp));
    this.casca.scale.setScalar(Math.max(0.001, this.raio * resp));
    this.casca.rotation.x += GIRO_X * dt;
    this.casca.rotation.y += GIRO_Y * dt;
  }

  /**
   * A energia sendo recolhida durante a carga.
   *
   * `grow` negativo e arrasto alto: as fagulhas ENCOLHEM em direção à esfera em
   * vez de saírem dela. É a diferença entre "juntando" e "explodindo", e sem
   * ela a pose de carga lê como um estouro que não acaba.
   */
  recolher(dt, u) {
    this._fag -= dt;
    if (this._fag > 0) return;
    this._fag = INTERVALO_FAGULHA;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 7,
      color: this.info.cor,
      speed: 16 + 22 * u,
      spread: 1,
      size: 0.5,
      grow: -0.75,
      life: 0.6,
      gravity: 0,
      drag: 3.4,
      alpha: 0.9,
      additive: true,
    });
  }

  /** O que ela vai deixando cair no caminho. Pouco: peso não faz confete. */
  rastro(dt) {
    this._fag -= dt;
    if (this._fag > 0) return;
    this._fag = INTERVALO_FAGULHA * 1.6;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 4,
      color: this.info.cor,
      speed: 9,
      spread: 1,
      size: 0.7,
      grow: 1.4,
      life: 0.85,
      gravity: 0,
      drag: 1.2,
      alpha: 0.55,
      additive: true,
    });
  }

  apagar() {
    this.viva = false;
    this.estourando = false;
    this.group.visible = false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.nucleo.material.dispose();
    this.casca.material.dispose();
  }
}

/* ============================================================================
   O pool
   ========================================================================== */

export class GenkiPool {
  constructor(scene, field, max = MAX_GENKIS) {
    this.scene = scene;
    this.field = field;
    this.geos = {
      bola: new THREE.SphereGeometry(1, 24, 18),
      // Subdivisão 2: 320 faces de arame. Mais que isso vira uma bola de lã;
      // menos, e o icosaedro aparece como um dado de vinte lados.
      malha: new THREE.IcosahedronGeometry(1, 2),
    };
    this.genkis = new Array(max);
    for (let i = 0; i < max; i++) this.genkis[i] = new Genki(scene, this.geos);
  }

  disparar(disparo) {
    if (!NAMEK.specials[disparo.kind]) return null;
    return pegarVaga(this.genkis).acender(this.field, disparo);
  }

  update(dt, alvos, localId, relato) {
    for (let i = 0; i < this.genkis.length; i++) {
      const g = this.genkis[i];
      if (!g.viva) continue;
      if (g.update(dt, alvos, localId, relato)) g.apagar();
    }
  }

  get count() {
    let n = 0;
    for (let i = 0; i < this.genkis.length; i++) if (this.genkis[i].viva) n++;
    return n;
  }

  clear() {
    for (let i = 0; i < this.genkis.length; i++) this.genkis[i].apagar();
  }

  dispose() {
    for (let i = 0; i < this.genkis.length; i++) this.genkis[i].dispose();
    this.geos.bola.dispose();
    this.geos.malha.dispose();
  }
}
