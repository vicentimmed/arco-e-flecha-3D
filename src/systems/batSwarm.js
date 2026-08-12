/* ---------------------------------------------------------------------------
   OS MORCEGOS GIGANTES, na tela.

   Mesma divisão do `MeteorRainManager` e do `ZombieManager`, e pelo mesmo
   motivo: os bichos são do SERVIDOR (`server/batSim.js`) e aqui existe só a
   casca — criar pela amostra de 10 Hz, interpolar entre duas amostras, e sumir.
   Nada é decidido deste lado, nem para onde eles vão nem quando matam.

   O que este arquivo tem de próprio é o que só pode existir dentro dos olhos de
   quem olha:

   • **AS ASAS BATEM.** A pose de rede traz posição e rumo, e a 10 Hz. O bater
     de asas é interpolado localmente a partir de um relógio próprio — mandá-lo
     pela rede seria trafegar sessenta vezes por segundo uma informação que
     nenhuma decisão do jogo consulta.

   • **O CORPO INCLINA NO MERGULHO.** O estado vem da sala (`vindo`, `rasante`,
     `rondando`) e vira ângulo de ataque aqui. É a única coisa que diz, de
     longe e sem HUD, que aquele morcego escolheu alguém — e "de longe" importa,
     porque o mergulho leva três segundos e a resposta cabe neles.

   • **O COLISOR**, para a flecha ter em que bater. Cinemático e reposicionado
     pela pose, como o da rocha da chuva: quem decide se ele caiu é a sala, e
     este lado só anuncia o acerto.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType } from "../core/events.js";
import { batEntity } from "../shared/protocol.js";

/** Espelha `BAT_STATES` de `server/batSim.js`. A ORDEM é o código na rede. */
const STATES = ["vindo", "rasante", "rondando"];

/** 1/s — quão depressa a pose amortecida alcança a amostra de rede. */
const SUAVIZA = 12;

/* Materiais de módulo: são dois bichos, mas eles nascem e morrem várias vezes
   por partida, e recriar material é recompilar shader. */
const MAT_COURO = new THREE.MeshStandardMaterial({
  color: 0x2a2130,
  roughness: 0.85,
  metalness: 0.05,
  flatShading: true,
});
const MAT_MEMBRANA = new THREE.MeshStandardMaterial({
  color: 0x4a2b3a,
  roughness: 0.7,
  metalness: 0.0,
  side: THREE.DoubleSide,
  flatShading: true,
});
const MAT_OLHO = new THREE.MeshBasicMaterial({ color: 0xff5a3c });

/**
 * Um morcego, na tela.
 *
 * A escala é generosa de propósito: ele é visto a cinquenta metros contra o
 * céu do poente, e um bicho "de tamanho realista" a essa distância é um ponto
 * escuro que ninguém distingue de um pássaro. Envergadura de 5 m — é o mesmo
 * argumento do raio das rochas da chuva, e pela mesma razão de pixels.
 */
class BatMesh {
  constructor(scene, physics, netId) {
    this.physics = physics;
    this.netId = netId;
    this.alvo = new THREE.Vector3();
    this.primeiro = true;
    this.fase = Math.random() * Math.PI * 2;
    this.inclina = 0;
    this.state = "vindo";

    this.group = new THREE.Group();

    // Tronco: um corpo achatado e afilado. Cone deitado, dois cones somados.
    const corpo = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 7), MAT_COURO);
    corpo.rotation.x = Math.PI / 2;
    corpo.scale.set(1, 1, 0.62);
    this.group.add(corpo);

    // Cabeça e orelhas: a silhueta que diz "morcego" e não "pássaro".
    const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), MAT_COURO);
    cabeca.position.set(0, 0.05, 1.25);
    this.group.add(cabeca);
    for (const s of [-1, 1]) {
      const orelha = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 4), MAT_COURO);
      orelha.position.set(s * 0.24, 0.5, 1.15);
      orelha.rotation.z = s * -0.28;
      this.group.add(orelha);
      const olho = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), MAT_OLHO);
      olho.position.set(s * 0.2, 0.12, 1.55);
      this.group.add(olho);
    }

    /* AS ASAS. Cada uma é um grupo com pivô no ombro, para o batimento ser uma
       rotação e não uma deformação de vértice: uma rotação por asa e por quadro
       custa nada, e uma malha animada custaria um skin inteiro por bicho. */
    this.asas = [];
    for (const s of [-1, 1]) {
      const pivo = new THREE.Group();
      pivo.position.set(s * 0.4, 0.1, 0.1);
      // A membrana: um triângulo largo e fino, com o braço na borda da frente.
      const membrana = new THREE.Mesh(new THREE.ConeGeometry(1.3, 2.1, 3), MAT_MEMBRANA);
      membrana.rotation.z = s * Math.PI * 0.5;
      membrana.position.set(s * 1.05, 0, -0.15);
      membrana.scale.set(1, 1, 0.08);
      pivo.add(membrana);
      const braco = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.12), MAT_COURO);
      braco.position.set(s * 1.05, 0, 0.42);
      pivo.add(braco);
      this.group.add(pivo);
      this.asas.push({ pivo, s });
    }

    scene.add(this.group);

    /* O colisor. É com ele que a SUA flecha acerta — e quem decide se o bicho
       caiu é a sala, que é uma só para todo mundo. Uma esfera generosa: o alvo
       está a dezenas de metros, no ar, e mudando de rumo. */
    this.entityId = batEntity(netId);
    this.body = physics.createBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.ball(1.3).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, {
      kind: "bat",
      entityId: this.entityId,
      netId,
      bat: this,
    });
  }

  setNetworkTarget(x, y, z, yaw, state) {
    this.alvo.set(x, y, z);
    this.yawAlvo = yaw;
    this.state = state;
    if (this.primeiro) {
      this.primeiro = false;
      this.group.position.copy(this.alvo);
      this.group.rotation.y = yaw;
    }
  }

  update(dt) {
    const B = CONFIG.modes.siege.bats;
    const k = 1 - Math.exp(-SUAVIZA * dt);
    this.group.position.lerp(this.alvo, k);
    this.body?.setNextKinematicTranslation(this.group.position);

    // O rumo pelo caminho curto: sem isto, cruzar ±π faz o bicho girar 350°.
    let d = (this.yawAlvo ?? 0) - this.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.group.rotation.y += d * k;

    /* O BATIMENTO. Mais rápido e mais fundo no mergulho: é a leitura de
       esforço, e é ela que faz o rasante parecer um rasante. */
    const mergulhando = this.state === "rasante";
    this.fase += dt * B.flap * (mergulhando ? 1.7 : 1);
    const amp = mergulhando ? 0.95 : 0.62;
    const bate = Math.sin(this.fase) * amp;
    for (const a of this.asas) a.pivo.rotation.z = a.s * -bate;

    // E o CORPO INCLINA para a frente no mergulho — o ângulo de ataque.
    const alvoInclina = mergulhando ? 0.55 : 0;
    this.inclina += (alvoInclina - this.inclina) * Math.min(1, dt * 4);
    this.group.rotation.x = this.inclina;
  }

  dispose(scene) {
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    scene.remove(this.group);
    /* Só a GEOMETRIA volta para a GPU. Os materiais são de módulo e servem a
       todos os morcegos da sessão — liberá-los aqui deixaria o próximo bando
       com material descartado, que o Three desenha como preto. */
    this.group.traverse((o) => o.geometry?.dispose());
  }
}

export class BatSwarmManager {
  constructor(scene, physics, arrows = null) {
    this.scene = scene;
    this.physics = physics;
    this.arrows = arrows;
    /** @type {Map<number, BatMesh>} id da sala → casca local */
    this.byNetId = new Map();
  }

  /** A amostra de 10 Hz da sala: cria o que é novo, some com o que sumiu. */
  applyNetwork(lista) {
    if (!lista) return;
    const vistos = new Set();
    for (const it of lista) {
      vistos.add(it.i);
      let b = this.byNetId.get(it.i);
      if (!b) {
        b = new BatMesh(this.scene, this.physics, it.i);
        this.byNetId.set(it.i, b);
      }
      b.setNetworkTarget(it.p[0], it.p[1], it.p[2], it.y, STATES[it.s] ?? "vindo");
    }
    /* Sumiu da lista sem um `BAT_DEATH`: a partida acabou ou o modo trocou.
       Some sem estouro — quem estoura é o evento. */
    for (const [id, b] of [...this.byNetId]) {
      if (vistos.has(id)) continue;
      this.byNetId.delete(id);
      this.arrows?.removeAttachedTo(b);
      b.dispose(this.scene);
    }
  }

  /** Uma flecha o derrubou. Estouro de couro e poeira, e ele some. */
  morrer(msg) {
    const b = this.byNetId.get(msg.id);
    const p = msg.p
      ? { x: msg.p[0], y: msg.p[1], z: msg.p[2] }
      : b
        ? { x: b.group.position.x, y: b.group.position.y, z: b.group.position.z }
        : null;
    if (b) {
      this.byNetId.delete(msg.id);
      this.arrows?.removeAttachedTo(b);
      b.dispose(this.scene);
    }
    if (!p) return;
    gameEvents.emit(EventType.PARTICLES, {
      position: p,
      count: 40,
      color: 0x3a2a3c,
      speed: 9,
      spread: 1,
      size: 0.42,
      grow: 1.8,
      life: 1.4,
      gravity: CONFIG.physics.gravity * 0.5,
      drag: 0.7,
      alpha: 0.95,
    });
    /* O GUINCHO, e não o estouro de pedra que estava aqui. Ele é a única
       ameaça que vem de cima, e o som que anuncia a queda dele tem de ser o
       único que ninguém confunde com a rampa. Ver `makeBatScreechBuffer`. */
    gameEvents.emit(EventType.AUDIO_PLAY, { sound: "deathBat", position: p, volume: 0.85 });
  }

  update(dt) {
    for (const b of this.byNetId.values()) b.update(dt);
  }

  clear() {
    for (const b of this.byNetId.values()) {
      this.arrows?.removeAttachedTo(b);
      b.dispose(this.scene);
    }
    this.byNetId.clear();
  }

  dispose() {
    this.clear();
  }
}
