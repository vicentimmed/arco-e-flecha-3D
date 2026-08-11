/* ---------------------------------------------------------------------------
   O que se vê na Lua.

   Este arquivo já foi o CÉREBRO da fase — ele decidia onde o alien andava, que
   rota a nave fazia e quando cada um nascia. Não decide mais nada disso: alien,
   nave, rover, nave de transporte e meteorito viraram entidades da SALA
   (`server/spaceSim.js`), porque todos eles matam ou carregam alguém, e um
   mundo por aba fazia duas pessoas morrerem de coisas diferentes.

   O que sobrou aqui é o que só existe dentro dos olhos de quem está olhando:

   • **a poeira em suspensão**, que é definida em torno da CÂMERA — não existe
     "a mesma poeira" para duas pessoas, a ideia não tem sentido;
   • **as estrelas cadentes**, que não têm efeito de jogo nenhum e sincronizam
     de graça pelo relógio da sala, sem trafegar um byte (ver `Ambiente`).

   Todo o resto é reconciliação: `applyNetwork` recebe a amostra de 10 Hz e cria,
   atualiza ou descarta — o mesmo padrão de `systems/boarManager.js`. Os corpos
   de física continuam existindo aqui porque é com eles que a SUA flecha acerta;
   o que muda é que o acerto virou um pedido à sala em vez de uma decisão local.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { makeRandom } from "../utils/math.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { Plataforma } from "../entities/rideable.js";
import {
  criarEstilhacos,
  passoEstilhaco,
  opacidadeEstilhaco,
} from "../shared/fragments.js";

const TAU = Math.PI * 2;

/* A cadente é sorteada por JANELA de tempo — ver `Ambiente.resolverJanela`.
   26 s de janela com 70 % de chance dá uma cadente a cada ~37 s em média: rara
   o bastante para ser um acontecimento, frequente o bastante para quem olhar o
   céu por um minuto ver pelo menos uma. */
const CADENTE_JANELA = 26; // s
const CADENTE_CHANCE = 0.7;

/** Quão depressa uma pose de rede é alcançada. Ver `aproximar`. */
const SUAVIZA = 12;

/* ------------------------------------------------------------- ambiente --- */

/**
 * Poeira em suspensão e estrelas cadentes — as duas coisas locais da Lua.
 *
 * A poeira é um truque de PROFUNDIDADE, não de realismo: no vácuo não há nada
 * pairando, mas sem partículas próximas o jogador perde toda a noção de
 * movimento ao voar de jetpack. Os grãos passando perto da câmera resolvem
 * isso, e ficam raros o bastante para não virarem neve.
 */
class Ambiente {
  constructor(parent, camera) {
    this.camera = camera;
    this.rnd = makeRandom(5150);

    this.N = 220;
    this.raio = 34; // m — a bolha que acompanha a câmera
    const pos = new Float32Array(this.N * 3);
    this.vel = new Float32Array(this.N * 3);
    for (let i = 0; i < this.N; i++) this.semear(pos, i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.poeira = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xcfd4dc,
        size: 0.055,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        fog: false,
      }),
    );
    this.poeira.frustumCulled = false;
    parent.add(this.poeira);

    const rastro = new THREE.BufferGeometry();
    rastro.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    this.cadente = new THREE.Line(
      rastro,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    );
    this.cadente.frustumCulled = false;
    parent.add(this.cadente);

    this.cadenteJanela = -1;
    this.cadenteTem = false;
    this.cadenteDuracao = 1.6;
    this._de = new THREE.Vector3();
    this._para = new THREE.Vector3();
    this._cadHead = new THREE.Vector3();
    this._cadTail = new THREE.Vector3();
  }

  semear(pos, i, inicial) {
    const c = this.camera.position;
    const a = this.rnd() * TAU;
    const b = Math.acos(2 * this.rnd() - 1);
    const r = this.raio * (inicial ? Math.cbrt(this.rnd()) : 1);
    pos[i * 3] = c.x + Math.sin(b) * Math.cos(a) * r;
    pos[i * 3 + 1] = c.y + Math.cos(b) * r;
    pos[i * 3 + 2] = c.z + Math.sin(b) * Math.sin(a) * r;
    this.vel[i * 3] = (this.rnd() - 0.5) * 0.5;
    this.vel[i * 3 + 1] = (this.rnd() - 0.5) * 0.3;
    this.vel[i * 3 + 2] = (this.rnd() - 0.5) * 0.5;
  }

  /**
   * @param {number} tempoSala relógio da SALA em ms — é ele que sincroniza a
   *   cadente entre as telas. Sem sala vale o relógio local, e o efeito é o
   *   mesmo para quem joga sozinho.
   */
  update(dt, tempoSala = 0) {
    const pos = this.poeira.geometry.attributes.position.array;
    const c = this.camera.position;
    const r2 = this.raio * this.raio;

    for (let i = 0; i < this.N; i++) {
      const k = i * 3;
      pos[k] += this.vel[k] * dt;
      pos[k + 1] += this.vel[k + 1] * dt;
      pos[k + 2] += this.vel[k + 2] * dt;
      /* A bolha ACOMPANHA a câmera: o grão que sai por trás reaparece na
         frente. Sem isso, voar 200 m deixaria a poeira toda para trás e o
         efeito sumiria justamente quando a velocidade é maior. */
      const dx = pos[k] - c.x;
      const dy = pos[k + 1] - c.y;
      const dz = pos[k + 2] - c.z;
      if (dx * dx + dy * dy + dz * dz > r2) this.semear(pos, i, false);
    }
    this.poeira.geometry.attributes.position.needsUpdate = true;

    const relogio = (tempoSala || performance.now()) / 1000;
    const janela = Math.floor(relogio / CADENTE_JANELA);
    if (janela !== this.cadenteJanela) this.resolverJanela(janela, c);

    if (!this.cadenteTem) {
      if (this.cadente.material.opacity !== 0) this.cadente.material.opacity = 0;
      return;
    }
    const t = (relogio % CADENTE_JANELA) / this.cadenteDuracao;
    if (t >= 1) {
      if (this.cadente.material.opacity !== 0) this.cadente.material.opacity = 0;
      return;
    }
    this.atualizarCadente(t);
  }

  /**
   * Resolve o trajeto da cadente desta janela de tempo.
   *
   * Determinístico a partir do ÍNDICE da janela: mesma janela, mesmo trajeto,
   * em qualquer máquina. É isso que dispensa qualquer mensagem de rede. O
   * trajeto é montado em torno da câmera de quem olha — mas alto (220–400 m) e
   * longe (420 m), então a diferença de posição entre dois jogadores da mesma
   * arena é irrelevante contra a distância.
   */
  resolverJanela(janela, c) {
    this.cadenteJanela = janela;
    const rnd = makeRandom(4242 + janela);

    // Nem toda janela tem cadente: sem isso elas viriam com regularidade de
    // metrônomo, e o que faz uma cadente ser um acontecimento é não dar para
    // prever quando vem a próxima.
    this.cadenteTem = rnd() < CADENTE_CHANCE;
    if (!this.cadenteTem) return;

    const a = rnd() * TAU;
    const alt = 220 + rnd() * 180;
    const dist = 420;
    this._de.set(c.x + Math.cos(a) * dist, c.y + alt, c.z + Math.sin(a) * dist);
    const dir = new THREE.Vector3(
      (rnd() - 0.5) * 2,
      -0.35 - rnd() * 0.4,
      (rnd() - 0.5) * 2,
    ).normalize();
    this._para.copy(this._de).addScaledVector(dir, 70 + rnd() * 60);
    this.cadenteDuracao = 1.3 + rnd() * 0.9;
    this.cadente.material.opacity = 0;
  }

  /**
   * Um METEORO cruzando o céu, não um palito que acende e apaga.
   *
   * A cabeça avança pelo trajeto; o RASTRO cresce atrás dela no primeiro terço
   * do voo, se mantém no meio e ENCOLHE no último terço — a cauda alcança a
   * cabeça e as duas somem juntas. É essa variação de comprimento, e não um
   * fade abrupto, que lê como "atravessando o céu" em vez de "piscou".
   */
  atualizarCadente(t) {
    const CRESCE_ATE = 0.3;
    const ENCOLHE_DE = 0.72;
    const RASTRO_MAX = 0.4;

    let rastro;
    if (t < CRESCE_ATE) rastro = RASTRO_MAX * (t / CRESCE_ATE);
    else if (t < ENCOLHE_DE) rastro = RASTRO_MAX;
    else rastro = RASTRO_MAX * Math.max(0, (1 - t) / (1 - ENCOLHE_DE));

    const tCauda = Math.max(0, t - rastro);
    this._cadHead.lerpVectors(this._de, this._para, t);
    this._cadTail.lerpVectors(this._de, this._para, tCauda);

    const p = this.cadente.geometry.attributes.position.array;
    p[0] = this._cadTail.x; p[1] = this._cadTail.y; p[2] = this._cadTail.z;
    p[3] = this._cadHead.x; p[4] = this._cadHead.y; p[5] = this._cadHead.z;
    this.cadente.geometry.attributes.position.needsUpdate = true;

    const fadeIn = Math.min(1, t / 0.06);
    const fadeOut = Math.min(1, (1 - t) / 0.12);
    this.cadente.material.opacity = 0.85 * Math.min(fadeIn, fadeOut);
  }
}

/* ------------------------------------------------------------- corpos ----- */

/**
 * Base das coisas que a SALA move e este lado só desenha.
 *
 * A pose chega a 10 Hz e é perseguida com amortecimento — o mesmo que os
 * porcos fazem. Sem isso, cada amostra seria um salto visível.
 */
class CorpoDeRede {
  constructor() {
    this.alvo = new THREE.Vector3();
    this.alvoYaw = 0;
    this.primeiro = true;
  }

  setNetworkTarget(x, y, z, yaw = 0) {
    this.alvo.set(x, y, z);
    this.alvoYaw = yaw;
    if (this.primeiro) {
      this.primeiro = false;
      this.group.position.copy(this.alvo);
      this.group.rotation.y = yaw;
    }
  }

  aproximar(dt) {
    const k = 1 - Math.exp(-SUAVIZA * dt);
    this.group.position.lerp(this.alvo, k);
    let d = this.alvoYaw - this.group.rotation.y;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.group.rotation.y += d * k;
  }
}

/* ---------------------------------------------------------------- naves --- */

/**
 * Um disco voador cruzando o céu — e derrubável.
 *
 * O colisor é uma esfera generosa (4 m) e não a silhueta: acertar algo que
 * atravessa o campo de visão a 26 m/s a duzentos metros já é difícil o
 * suficiente sem exigir precisão de centímetro. A generosidade aqui é o que
 * transforma "impossível" em "difícil", que é onde está a graça.
 */
class Nave extends CorpoDeRede {
  constructor(scene, physics, id) {
    super();
    this.physics = physics;
    this.netId = id;
    this.group = new THREE.Group();

    const casco = new THREE.MeshStandardMaterial({ color: "#c9ccd2", roughness: 0.35, metalness: 0.8 });
    const vidro = new THREE.MeshStandardMaterial({
      color: "#39d6ff", roughness: 0.1, metalness: 0.2,
      emissive: new THREE.Color("#1e7fa8"), emissiveIntensity: 0.9,
    });

    // Disco voador: dois pratos e uma cúpula. É a silhueta que se lê contra o
    // preto num piscar de olhos, e ler rápido é o que dá tempo de atirar.
    const prato = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 0.9, 0.85, 18), casco);
    prato.position.y = 0.1;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 3.0, 0.7, 18), casco);
    base.position.y = -0.5;
    const cupula = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 16, 10, 0, TAU, 0, Math.PI / 2), vidro,
    );
    cupula.position.y = 0.5;
    this.group.add(prato, base, cupula);

    this.luzes = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const luz = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 8, 6),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff3b30 : 0x39ff7a, fog: false }),
      );
      luz.position.set(Math.cos(a) * 2.9, -0.15, Math.sin(a) * 2.9);
      this.group.add(luz);
      this.luzes.push(luz);
    }
    for (const o of this.group.children) o.castShadow = true;
    scene.add(this.group);

    this.entityId = `ship${entityRegistry.createId()}`;
    this.body = physics.createBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.ball(4.0).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { kind: "ship", entityId: this.entityId, netId: id });

    this.piscar = 0;
    this.somT = 0;
    this.morta = false;
    this.giro = 0;
  }

  update(dt) {
    this.aproximar(dt);
    this.piscar += dt;
    const on = Math.sin(this.piscar * 6) > 0;
    for (let i = 0; i < this.luzes.length; i++) {
      this.luzes[i].visible = i % 2 === 0 ? on : !on;
    }

    if (this.morta) {
      this.giro += dt;
      this.group.rotation.z += 2.2 * dt;
      this.group.rotation.x += 1.3 * dt;
      this.fumo = (this.fumo ?? 0) + dt;
      if (this.fumo > 0.06) {
        this.fumo = 0;
        gameEvents.emit(EventType.PARTICLES, {
          position: vec3Payload(this.group.position),
          count: 2, color: 0x6b6b6b, speed: 1.2, spread: 0.8, size: 0.4,
          grow: 2.4, life: 1.4, gravity: -0.3, drag: 0.6, alpha: 0.5,
        });
      }
    }

    /* O ZUMBIDO ACOMPANHA A NAVE. É reemitido na posição ATUAL dela a cada
       poucos segundos em vez de tocado uma vez na entrada: o som do Three é
       posicionado onde nasce e não segue nada, e uma nave que atravessa 500 m
       soaria parada no ponto de onde veio. */
    this.somT -= dt;
    if (this.somT <= 0) {
      const S = CONFIG.levels.moon.ship;
      this.somT = S.humInterval;
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "ufoHum",
        position: vec3Payload(this.group.position),
        volume: S.humVolume,
      });
    }

    this.body?.setNextKinematicTranslation(this.group.position);
  }

  dispose(scene) {
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    scene.remove(this.group);
    disposeGrupo(this.group);
  }
}

/* --------------------------------------------------------------- aliens --- */

/** O alien: pequeno, verde e teimoso. A IA é da sala; aqui é só o corpo. */
class Alien extends CorpoDeRede {
  constructor(scene, physics, id) {
    super();
    this.physics = physics;
    this.netId = id;
    this.dead = false;

    const pele = new THREE.MeshStandardMaterial({
      color: "#4fd44f", roughness: 0.55, metalness: 0.1,
      emissive: new THREE.Color("#0d3a0d"), emissiveIntensity: 0.5,
    });
    const olhoMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, fog: false });

    this.group = new THREE.Group();
    const corpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 5, 12), pele);
    corpo.position.y = 0.72;
    // Cabeça grande e ovalada — a silhueta clássica, e a que se lê de longe.
    const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 12), pele);
    cabeca.position.y = 1.42;
    cabeca.scale.set(1, 1.22, 0.92);
    this.group.add(corpo, cabeca);

    for (const lado of [-1, 1]) {
      const olho = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), olhoMat);
      olho.position.set(lado * 0.15, 1.46, 0.3);
      olho.scale.set(1, 1.5, 0.6);
      this.group.add(olho);

      const braco = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 4, 8), pele);
      braco.position.set(lado * 0.42, 0.86, 0);
      braco.rotation.z = lado * 0.32;
      this.group.add(braco);
      if (lado === -1) this.bracoE = braco;
      else this.bracoD = braco;

      const perna = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 4, 8), pele);
      perna.position.set(lado * 0.17, 0.26, 0);
      this.group.add(perna);
      if (lado === -1) this.pernaE = perna;
      else this.pernaD = perna;
    }
    for (const o of this.group.children) o.castShadow = true;
    scene.add(this.group);

    this.entityId = `alien${entityRegistry.createId()}`;
    this.body = physics.createBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(0.45, 0.42).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { kind: "alien", entityId: this.entityId, netId: id });

    this.fase = Math.random() * TAU;
    this.golpeando = 0;
    const A = CONFIG.levels.moon.alien;
    this.chirpT = A.chirpMinInterval + Math.random() * (A.chirpMaxInterval - A.chirpMinInterval);
    this._ultimo = new THREE.Vector3();
  }

  update(dt) {
    if (this.dead) {
      // Derrete no chão em vez de sumir num quadro.
      this.group.scale.multiplyScalar(Math.max(0, 1 - dt * 1.6));
      return;
    }

    this._ultimo.copy(this.group.position);
    this.aproximar(dt);
    const andou = this.group.position.distanceTo(this._ultimo);

    // Passada: as pernas alternam com a DISTÂNCIA, como a do arqueiro.
    if (andou > 1e-4) {
      this.fase += andou / 0.6;
      const s = Math.sin(this.fase) * 0.28;
      if (this.pernaE) this.pernaE.position.z = s;
      if (this.pernaD) this.pernaD.position.z = -s;
    }

    /* Os braços erguidos são o AVISO do golpe. Sem eles a morte chegaria no
       mesmo quadro em que o alien encosta, e não haveria o que reagir. */
    const alvoBraco = this.golpeando ? -2.2 : 0;
    const kb = 1 - Math.exp(-9 * dt);
    if (this.bracoE) this.bracoE.rotation.x += (alvoBraco - this.bracoE.rotation.x) * kb;
    if (this.bracoD) this.bracoD.rotation.x += (alvoBraco - this.bracoD.rotation.x) * kb;

    /* A VOZ, espaçada. Um alien que guincha a cada quadro vira alarme de carro;
       o que assusta é ouvir um deles atrás de você de vez em quando. */
    this.chirpT -= dt;
    if (this.chirpT <= 0) {
      const A = CONFIG.levels.moon.alien;
      this.chirpT = A.chirpMinInterval + Math.random() * (A.chirpMaxInterval - A.chirpMinInterval);
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "alienChirp",
        position: vec3Payload(this.group.position),
        volume: A.chirpVolume,
      });
    }

    this.body?.setNextKinematicTranslation({
      x: this.group.position.x,
      y: this.group.position.y + 0.9,
      z: this.group.position.z,
    });
  }

  morrer() {
    if (this.dead) return;
    this.dead = true;
    if (this.body) {
      this.physics.removeBody(this.body);
      this.body = null;
    }
    /* O guincho de abatimento. Sai AQUI e não no impacto da flecha porque
       `morrer()` é chamado quando a SALA tira o alien da lista — ou seja, uma
       vez só e na mesma hora em todas as telas, seja quem for que atirou, seja
       o rover que o atropelou ou um estilhaço que o pegou. É o mesmo motivo de
       o berro do alce sair do evento da sala. */
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "alienDeath",
      position: vec3Payload(this.group.position),
      volume: 0.95,
    });
    gameEvents.emit(EventType.PARTICLES, {
      position: vec3Payload(this.group.position),
      count: 30, color: 0x39ff7a, speed: 7, spread: 1, size: 0.24,
      grow: 2, life: 0.9, gravity: -1.62, drag: 0.8, alpha: 0.9,
    });
  }

  dispose(scene) {
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    scene.remove(this.group);
    disposeGrupo(this.group);
  }
}

/* ------------------------------------------------------ nave de transporte -- */

/**
 * A nave grande: circunda a base, pousa e decola — com quem tiver subido.
 *
 * Ela não some sozinha: a órbita é fechada e a única saída é ser destruída. É o
 * que permite viajar nela sem o chão desaparecer no meio do caminho.
 */
class Dropship extends CorpoDeRede {
  constructor(scene, physics) {
    super();
    this.physics = physics;
    const D = CONFIG.levels.moon.dropship;
    this.raio = D.raio;
    this.group = new THREE.Group();

    const casco = new THREE.MeshStandardMaterial({ color: "#d0d3d8", roughness: 0.4, metalness: 0.7 });
    const escuro = new THREE.MeshStandardMaterial({ color: "#242a31", roughness: 0.6, metalness: 0.5 });
    const vidro = new THREE.MeshStandardMaterial({
      color: "#4ae0c2", roughness: 0.1, metalness: 0.2,
      emissive: new THREE.Color("#1c7f6d"), emissiveIntensity: 0.9,
    });

    // Disco com CONVÉS PLANO por cima: é ele que se pisa, e a silhueta precisa
    // dizer isso de longe — daí o topo ser uma chapa e não uma cúpula inteira.
    const disco = new THREE.Mesh(new THREE.CylinderGeometry(D.raio, D.raio * 0.72, 1.1, 24), casco);
    const conves = new THREE.Mesh(new THREE.CylinderGeometry(D.raio * 0.92, D.raio * 0.92, 0.18, 24), escuro);
    conves.position.y = 0.62;
    const cupula = new THREE.Mesh(
      new THREE.SphereGeometry(D.raio * 0.3, 14, 10, 0, TAU, 0, Math.PI / 2), vidro,
    );
    cupula.position.y = 0.7;
    this.group.add(disco, conves, cupula);

    this.luzes = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const luz = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 6),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff8a30 : 0x4ae0c2, fog: false }),
      );
      luz.position.set(Math.cos(a) * D.raio * 0.95, -0.2, Math.sin(a) * D.raio * 0.95);
      this.group.add(luz);
      this.luzes.push(luz);
    }

    // Pés de pouso: só aparecem quando ela vai encostar.
    this.pes = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const pe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6), escuro);
      pe.position.set(Math.cos(a) * D.raio * 0.6, -1.0, Math.sin(a) * D.raio * 0.6);
      this.group.add(pe);
      this.pes.push(pe);
    }
    for (const o of this.group.children) o.castShadow = true;
    scene.add(this.group);

    this.entityId = `dropship${entityRegistry.createId()}`;
    this.body = physics.createBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.cylinder(0.55, D.raio * 0.92).setActiveEvents(
        RAPIER.ActiveEvents.COLLISION_EVENTS,
      ),
      this.body,
    );
    physics.register(this.collider, { kind: "dropship", entityId: this.entityId });

    this.plat = new Plataforma();
    this.estado = "cruzeiro";
    this.piscar = 0;
    /* O ronco começa quase de imediato (0,4 s) e não em `humInterval`: quem
       entra na fase com ela já em cena precisa ouvi-la antes de vê-la. */
    this.somT = 0.4;
  }

  get deckY() {
    return this.group.position.y + 0.71;
  }

  isOnDeck(pos) {
    if (this.estado === "destruida") return false;
    return this.plat.pisandoEmDisco(
      pos, this.group.position.x, this.group.position.z, this.deckY, this.raio * 0.85, 0.6,
    );
  }

  carry(pos) {
    this.plat.carregar(pos, this.group.position.x, this.group.position.z, this.group.rotation.y, this.deckY);
  }

  update(dt) {
    this.plat.marcarPose(this.group.position.x, this.group.position.z, this.group.rotation.y);
    this.aproximar(dt);

    this.piscar += dt;
    const on = Math.sin(this.piscar * 4) > 0;
    for (let i = 0; i < this.luzes.length; i++) {
      this.luzes[i].visible = i % 2 === 0 ? on : !on;
    }
    const pousando = this.estado === "descendo" || this.estado === "pousada";
    for (const pe of this.pes) pe.visible = pousando;

    this.group.visible = this.estado !== "destruida";

    /* O MOTOR. Reemitido na posição atual, pelo mesmo motivo do disco voador: o
       som do Three nasce parado onde foi tocado, e uma nave que orbita 70 m
       soaria pregada no ponto de onde saiu.

       Destruída, ela cala: o que se ouve no lugar é a explosão que a sala
       mandou (`SPACE_EVENT`), e um motor roncando num destroço invisível seria
       a pior pista possível sobre onde ela está. */
    this.somT -= dt;
    if (this.somT <= 0 && this.estado !== "destruida") {
      const D = CONFIG.levels.moon.dropship;
      this.somT = D.humInterval ?? 2.4;
      // Manobrando ela acende os retrofoguetes: mais alto, e é o aviso de que
      // dá para correr até ela e subir.
      const manobra = this.estado === "descendo" || this.estado === "subindo";
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "dropshipHum",
        position: vec3Payload(this.group.position),
        volume: manobra ? (D.humVolumeManobra ?? 1.05) : (D.humVolume ?? 0.8),
      });
    }
    if (this.body) {
      this.body.setNextKinematicTranslation({
        x: this.group.position.x,
        y: this.group.position.y + 0.3,
        z: this.group.position.z,
      });
    }
  }

  dispose(scene) {
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    scene.remove(this.group);
    disposeGrupo(this.group);
  }
}

/* ------------------------------------------------------------ meteoritos --- */

/**
 * Uma rocha, esculpida a partir de um icosaedro.
 *
 * Três coisas, na ordem: um ALONGAMENTO por eixo (é ele que separa "batata" de
 * "seixo" de "lasca" — a silhueta é o que se lê de longe), um ruído para a
 * superfície não ser lisa, e algumas CRATERAS, que são vértices puxados para
 * dentro num raio angular em torno de pontos sorteados.
 *
 * Tudo assado na geometria, uma vez: não custa nada por quadro. A semente vem
 * do ÍNDICE do formato, então os três são estáveis entre sessões e iguais em
 * todas as telas.
 */
function esculpir(raio, formato) {
  const rnd = makeRandom(7000 + formato * 131);
  const geo = new THREE.IcosahedronGeometry(raio, 2);
  const pos = geo.attributes.position;

  const eixos = [
    [1.0, 0.78, 1.15],
    [1.25, 0.62, 0.9],
    [0.9, 1.0, 0.85],
  ][formato % 3];

  const crateras = [];
  const n = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const b = Math.acos(2 * rnd() - 1);
    crateras.push({
      x: Math.sin(b) * Math.cos(a),
      y: Math.cos(b),
      z: Math.sin(b) * Math.sin(a),
      r: 0.22 + rnd() * 0.24,
      d: 0.1 + rnd() * 0.12,
    });
  }

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nrm = v.clone().normalize();
    let escala = 1 + (rnd() - 0.5) * 0.16;
    for (const c of crateras) {
      const d = Math.hypot(nrm.x - c.x, nrm.y - c.y, nrm.z - c.z);
      if (d < c.r) escala -= c.d * (1 - d / c.r) ** 2;
    }
    v.copy(nrm).multiplyScalar(raio * escala);
    v.x *= eixos[0];
    v.y *= eixos[1];
    v.z *= eixos[2];
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Rocha grande em deriva lenta, em que dá para pousar de jetpack. */
class Meteor extends CorpoDeRede {
  constructor(scene, physics, id, raio, formato) {
    super();
    this.physics = physics;
    this.netId = id;
    this.raio = raio;
    const M = CONFIG.levels.moon.meteors;

    this.group = new THREE.Group();
    /* O TOMBO gira só um grupo INTERNO. Girar o grupo externo faria o
       passageiro girar junto — e o externo é o que define a pose de
       plataforma. */
    this.giroGroup = new THREE.Group();
    this.group.add(this.giroGroup);

    const mat = new THREE.MeshStandardMaterial({
      color: "#8a8880", roughness: 0.95, metalness: 0.05, flatShading: true,
    });
    const rocha = new THREE.Mesh(esculpir(raio, formato), mat);
    rocha.castShadow = true;
    this.giroGroup.add(rocha);

    /* A ESCOLTA: pedrinhas em órbita própria, concentradas um pouco atrás para
       lerem como cauda. Sem colisor — são visuais. */
    const rnd = makeRandom(id * 977 + 13);
    const nEsc = M.escoltaMin + Math.floor(rnd() * (M.escoltaMax - M.escoltaMin + 1));
    this.escolta = [];
    for (let i = 0; i < nEsc; i++) {
      const r = 0.15 + rnd() * 0.25;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
      this.giroGroup.add(m);
      this.escolta.push({
        mesh: m,
        raio: raio * (1.4 + rnd() * 1.1),
        ang: rnd() * TAU,
        vel: (0.2 + rnd() * 0.5) * (rnd() < 0.5 ? 1 : -1),
        alt: (rnd() - 0.5) * raio * 1.2,
      });
    }

    scene.add(this.group);

    this.entityId = `meteor${entityRegistry.createId()}`;
    this.body = physics.createBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.ball(raio).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { kind: "meteor", entityId: this.entityId, netId: id });

    this.plat = new Plataforma();
  }

  get deckY() {
    return this.group.position.y + this.raio * 0.9;
  }

  isOnDeck(pos) {
    return this.plat.pisandoEmDisco(
      pos, this.group.position.x, this.group.position.z, this.deckY, this.raio * 0.7, 0.6,
    );
  }

  carry(pos) {
    this.plat.carregar(pos, this.group.position.x, this.group.position.z, 0, this.deckY);
  }

  update(dt) {
    this.plat.marcarPose(this.group.position.x, this.group.position.z, 0);
    this.aproximar(dt);

    const g = CONFIG.levels.moon.meteors.giro;
    this.giroGroup.rotation.x += g * dt;
    this.giroGroup.rotation.y += g * 0.7 * dt;

    for (const e of this.escolta) {
      e.ang += e.vel * dt;
      e.mesh.position.set(Math.cos(e.ang) * e.raio, e.alt, Math.sin(e.ang) * e.raio);
    }

    this.body?.setNextKinematicTranslation(this.group.position);
  }

  dispose(scene) {
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    scene.remove(this.group);
    disposeGrupo(this.group);
  }
}

/* ------------------------------------------------------------- o sistema -- */

export class SpaceLife {
  /**
   * @param {THREE.Object3D} parent raiz da fase — tudo morre com ela
   */
  constructor(parent, scene, physics, terrain, camera) {
    this.parent = parent;
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;

    this.ambiente = new Ambiente(parent, camera);
    /** @type {Map<number, Nave>} */
    this.naves = new Map();
    /** @type {Map<number, Alien>} */
    this.aliensById = new Map();
    /** @type {Map<number, Meteor>} */
    this.meteorsById = new Map();
    this.dropship = null;
    /** Estilhaços em voo — integrados aqui pela MESMA conta do servidor. */
    this.estilhacos = [];
    this.fragGeo = null;
    this.fragMat = null;
  }

  /** Lista para quem precisa iterar (a carona, em `main.js`). */
  get meteors() {
    return [...this.meteorsById.values()];
  }

  /** Lista dos aliens vivos — o rover e o HUD perguntam. */
  get aliens() {
    return [...this.aliensById.values()];
  }

  /**
   * A amostra de 10 Hz da sala. Cria o que é novo, atualiza o que existe e
   * descarta o que sumiu — o mesmo padrão de `BoarManager.applyNetwork`.
   */
  applyNetwork(msg) {
    /* ------------------------------------------------------------ naves -- */
    const vistasN = new Set();
    for (const it of msg.s ?? []) {
      vistasN.add(it.i);
      let n = this.naves.get(it.i);
      if (!n) {
        n = new Nave(this.scene, this.physics, it.i);
        this.naves.set(it.i, n);
      }
      n.morta = !!it.m;
      n.setNetworkTarget(it.x, it.y, it.z);
    }
    for (const [id, n] of [...this.naves]) {
      if (vistasN.has(id)) continue;
      this.naves.delete(id);
      n.dispose(this.scene);
    }

    /* ----------------------------------------------------------- aliens -- */
    const vistosA = new Set();
    for (const it of msg.a ?? []) {
      vistosA.add(it.i);
      let a = this.aliensById.get(it.i);
      if (!a) {
        a = new Alien(this.scene, this.physics, it.i);
        this.aliensById.set(it.i, a);
      }
      a.golpeando = it.s === 1;
      a.setNetworkTarget(it.x, it.y, it.z, it.w);
    }
    for (const [id, a] of [...this.aliensById]) {
      if (vistosA.has(id)) continue;
      /* Sumiu da lista: morreu. O corpo não some num quadro — ele derrete, e é
         o `morrer()` que começa isso. O descarte real vem no `update`. */
      a.morrer();
      if (a.group.scale.x < 0.06) {
        this.aliensById.delete(id);
        a.dispose(this.scene);
      }
    }

    /* ------------------------------------------------------ meteoritos -- */
    const vistosM = new Set();
    for (const it of msg.m ?? []) {
      vistosM.add(it.i);
      let m = this.meteorsById.get(it.i);
      if (!m) {
        m = new Meteor(this.scene, this.physics, it.i, it.r, it.f);
        this.meteorsById.set(it.i, m);
      }
      m.setNetworkTarget(it.x, it.y, it.z);
    }
    for (const [id, m] of [...this.meteorsById]) {
      if (vistosM.has(id)) continue;
      this.meteorsById.delete(id);
      m.dispose(this.scene);
    }

    /* ------------------------------------------- nave de transporte ----- */
    if (msg.d) {
      if (!this.dropship) this.dropship = new Dropship(this.scene, this.physics);
      this.dropship.estado = msg.d.st;
      this.dropship.setNetworkTarget(msg.d.x, msg.d.y, msg.d.z, msg.d.w);
    }

    /* O rover é da base — quem o guarda é `MoonBase`, e a pose chega por lá. */
    this.roverAlvo = msg.r ?? null;
  }

  /**
   * Um acontecimento pontual da Lua: explosão de nave, ou meteorito estourando.
   *
   * A DECISÃO de quem morreu é do servidor (ela já veio, ou vem, num `S2C.KILL`).
   * Aqui só se desenha e se ouve.
   */
  onEvent(msg) {
    const p = { x: msg.p[0], y: msg.p[1], z: msg.p[2] };

    gameEvents.emit(EventType.PARTICLES, {
      position: p, count: 90, color: 0xffb340, speed: 20, spread: 1,
      size: 0.7, grow: 2.6, life: 1.6, gravity: -1.62, drag: 0.5, alpha: 1,
    });
    gameEvents.emit(EventType.PARTICLES, {
      position: p, count: 60, color: 0x5a5a5a, speed: 9, spread: 1,
      size: 1.2, grow: 3.2, life: 2.6, gravity: -0.4, drag: 0.8, alpha: 0.6,
    });
    gameEvents.emit(EventType.AUDIO_PLAY, { sound: "explosion", position: p, volume: 1.3 });

    /* A rocha se partindo, POR CIMA da explosão.
     *
     * As duas juntas e não uma no lugar da outra: a explosão dá o baque que
     * chega do outro lado da arena, e o cascalho (`rockBurst`) é o que diz que
     * o que estourou era pedra e não uma nave. Quem estourou o meteorito sabe
     * disso pela tela; quem estava de costas, a cem metros, só tem o som. */
    if (msg.kind === "meteorBurst") {
      gameEvents.emit(EventType.AUDIO_PLAY, { sound: "rockBurst", position: p, volume: 1.15 });

      /* Os MESMOS estilhaços que o servidor está integrando para decidir quem
         morre — mesma semente, mesma conta, sem trafegar uma única posição.
         Ver `shared/fragments.js`. */
      const cfg = CONFIG.levels.moon.meteors;
      const novos = criarEstilhacos(p, msg.seed, cfg);
      if (!this.fragGeo) {
        this.fragGeo = new THREE.IcosahedronGeometry(1, 0);
        this.fragMat = new THREE.MeshStandardMaterial({
          color: "#8a8880", roughness: 0.95, metalness: 0.05,
          flatShading: true, transparent: true,
        });
      }
      for (const f of novos) {
        const mesh = new THREE.Mesh(this.fragGeo, this.fragMat);
        mesh.scale.setScalar(f.raio);
        mesh.position.set(f.x, f.y, f.z);
        mesh.castShadow = true;
        this.scene.add(mesh);
        f.mesh = mesh;
        this.estilhacos.push(f);
      }
    }
  }

  /**
   * @param {Array<{x:number,z:number}>} _jogadores mantido por compatibilidade
   * @param {number} tempoSala relógio da sala (ms) — sincroniza as cadentes
   */
  update(dt, _jogadores, tempoSala = 0) {
    this.ambiente.update(dt, tempoSala);

    for (const n of this.naves.values()) n.update(dt);
    for (const [id, a] of [...this.aliensById]) {
      a.update(dt);
      if (a.dead && a.group.scale.x < 0.06) {
        this.aliensById.delete(id);
        a.dispose(this.scene);
      }
    }
    for (const m of this.meteorsById.values()) m.update(dt);
    this.dropship?.update(dt);

    /* Os estilhaços: a mesma integração do servidor, só que aqui para
       DESENHAR. Quem decide quem morreu é lá; este lado nunca mata ninguém. */
    if (this.estilhacos.length) {
      const cfg = CONFIG.levels.moon.meteors;
      const g = CONFIG.levels.moon.gravity;
      const heightAt = (x, z) => this.terrain.heightAt(x, z);
      for (let i = this.estilhacos.length - 1; i >= 0; i--) {
        const f = this.estilhacos[i];
        const acabou = passoEstilhaco(f, dt, g, heightAt, cfg);
        f.mesh.position.set(f.x, f.y, f.z);
        f.mesh.rotation.set(f.rotX, 0, f.rotZ);
        if (acabou) {
          this.scene.remove(f.mesh);
          this.estilhacos.splice(i, 1);
        }
      }
      // O fade é do material compartilhado: todos somem juntos, e o pedaço mais
      // novo domina — é barato e ninguém percebe a diferença.
      const maisNovo = this.estilhacos[this.estilhacos.length - 1];
      if (maisNovo && this.fragMat) {
        this.fragMat.opacity = opacidadeEstilhaco(maisNovo, cfg);
      }
    }
  }

  dispose() {
    for (const n of this.naves.values()) n.dispose(this.scene);
    for (const a of this.aliensById.values()) a.dispose(this.scene);
    for (const m of this.meteorsById.values()) m.dispose(this.scene);
    this.dropship?.dispose(this.scene);
    for (const f of this.estilhacos) this.scene.remove(f.mesh);
    this.naves.clear();
    this.aliensById.clear();
    this.meteorsById.clear();
    this.estilhacos = [];
    this.dropship = null;
    this.fragGeo?.dispose();
    this.fragMat?.dispose();
    this.fragGeo = null;
    this.fragMat = null;
  }
}

function disposeGrupo(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
}
