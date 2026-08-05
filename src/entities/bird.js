/* ---------------------------------------------------------------------------
   Pássaro — corpo pequeno, asas batendo, e um colisor do tamanho da ave.

   Como todo bicho deste jogo, a decisão é do servidor (`server/birdSim.js`) e
   aqui fica o corpo. Duas particularidades:

   1. O POLEIRO É RESOLVIDO AQUI. O servidor manda "pouse por aqui", com um
      (x, z), porque ele não conhece a vegetação — árvore é malha, e malha só
      existe no cliente. Cada cliente procura a copa mais próxima na SUA lista
      de árvores, e como o cenário é determinístico todos acham a mesma. Sem
      isso o pássaro pousaria no ar a cinco metros do galho.

   2. O COLISOR É PEQUENO E EXISTE SEMPRE. Um alvo de meio metro a trinta de
      altura é o tiro mais difícil do jogo, e é isso que o torna interessante —
      aumentar o colisor "para ajudar" tiraria justamente a graça.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { damp } from "../utils/math.js";

const MAT = {
  body: new THREE.MeshStandardMaterial({ color: "#2a2f3a", roughness: 0.85 }),
  wing: new THREE.MeshStandardMaterial({
    color: "#1d222c",
    roughness: 0.9,
    side: THREE.DoubleSide,
  }),
  beak: new THREE.MeshStandardMaterial({ color: "#d8a13c", roughness: 0.6 }),
};

export class Bird {
  constructor(scene, physics, terrain, entityId, x, y, z) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.entityId = entityId;
    this.netTarget = null;
    this.dead = false;
    this.state = "fly";
    this.flapPhase = Math.random() * Math.PI * 2;

    this.position = new THREE.Vector3(x, y, z);
    this.yaw = 0;
    /** Queda livre depois de abatido — a confirmação visual do acerto. */
    this.fallSpeed = 0;

    this.group = new THREE.Group();
    this.group.name = `bird-${entityId}`;
    this.buildMesh();
    this.group.position.copy(this.position);
    scene.add(this.group);

    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.ball(CONFIG.birds.hitRadius).setActiveEvents(
        RAPIER.ActiveEvents.COLLISION_EVENTS,
      ),
      this.body,
    );
    physics.register(this.collider, { kind: "bird", entityId, bird: this });
    entityRegistry.register(entityId, this);
  }

  buildMesh() {
    const root = new THREE.Group();
    /* LOD (ver `utils/lod.js`). O pássaro é pequeno e voa alto: o bico de 3 cm
       a 40 m já não existe na tela, e a 60 m o que sobra é a silhueta batendo
       asa contra o céu — que é justamente o que faz dele um alvo. Por isso as
       ASAS ficam na silhueta e não no detalhe. */
    this.lodDetail = [];
    this.lodBulk = [];

    const corpo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 7), MAT.body);
    corpo.scale.set(1, 0.85, 1.7);
    corpo.castShadow = true;
    root.add(corpo);

    const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6), MAT.body);
    cabeca.position.set(0, 0.06, 0.22);
    root.add(cabeca);
    this.lodBulk.push(cabeca);

    const bico = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 5), MAT.beak);
    bico.rotation.x = Math.PI / 2;
    bico.position.set(0, 0.04, 0.34);
    root.add(bico);
    this.lodDetail.push(bico);

    const cauda = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.22), MAT.wing);
    cauda.position.set(0, 0.01, -0.34);
    root.add(cauda);
    this.lodDetail.push(cauda);

    // Asas com a âncora na RAIZ, junto ao corpo: girar em Z bate a asa em torno
    // do ombro, e não em torno do meio dela.
    this.wings = [];
    for (const lado of [-1, 1]) {
      const asa = new THREE.Group();
      asa.position.set(lado * 0.11, 0.04, 0);
      const pena = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.24), MAT.wing);
      pena.position.set(lado * 0.25, 0, -0.02);
      pena.rotation.x = -Math.PI / 2;
      asa.add(pena);
      root.add(asa);
      this.wings.push({ group: asa, lado });
    }

    this.group.add(root);
    this.visualRoot = root;
  }

  registerHit(impact, arrow) {
    if (this.dead) return;
    gameEvents.emit(EventType.BIRD_HIT, {
      birdId: this.entityId,
      impact: vec3Payload(impact),
      arrowId: arrow?.id,
      ownerId: arrow?.ownerEntityId ?? null,
      distance: arrow ? arrow.launchPosition.distanceTo(impact) : 0,
    });
  }

  setNetworkTarget(p, yaw, state, perch) {
    this.netTarget = { x: p[0], y: p[1], z: p[2], yaw, state, perch };
  }

  killLocal() {
    if (this.dead) return;
    this.dead = true;
    this.state = "dead";
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "birdDeath",
      position: vec3Payload(this.position),
      volume: 1,
    });
  }

  dispose() {
    this.physics.unregister(this.collider);
    this.physics.removeBody(this.body);
    entityRegistry.unregister(this.entityId);
    this.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
  }

  /**
   * @param {(x: number, z: number) => {x,y,z}|null} acharPoleiro copa mais
   *   próxima, do ambiente. Ver o cabeçalho para por que ela mora no cliente.
   */
  update(dt, acharPoleiro) {
    const alvo = this.netTarget;

    if (this.dead) {
      // A queda é LOCAL: começa no instante do acerto, sem esperar o servidor.
      // Quem atirou vê o pássaro cair no mesmo frame em que a flecha o toca.
      // `gravity` é negativo (é uma aceleração em Y), daí o sinal.
      this.fallSpeed = Math.min(
        CONFIG.birds.fallSpeed,
        this.fallSpeed - CONFIG.physics.gravity * dt,
      );
      const chao = this.terrain?.heightAt(this.position.x, this.position.z) ?? -Infinity;
      this.position.y = Math.max(chao + 0.1, this.position.y - this.fallSpeed * dt);
      this.group.position.copy(this.position);
      // Rodopia ao cair: um corpo sem controle não desce reto.
      this.visualRoot.rotation.z += dt * 7;
      this.visualRoot.rotation.x += dt * 3;
      this.syncPhysics();
      return;
    }

    if (alvo) {
      /* Pousado, a posição não vem do servidor: vem da copa que ESTE cliente
         encontrou perto do ponto pedido. É a única vez em que o cliente decide
         onde uma criatura está — e pode, porque a decisão é determinística e
         todos os clientes chegam à mesma. */
      let tx = alvo.x;
      let ty = alvo.y;
      let tz = alvo.z;
      if (alvo.perch && (alvo.state === "perch" || alvo.state === "glide")) {
        const copa = acharPoleiro?.(alvo.perch[0], alvo.perch[1]);
        if (copa) {
          if (alvo.state === "perch") {
            tx = copa.x;
            tz = copa.z;
          }
          ty = copa.y;
        }
      }

      const k = alvo.state === "perch" ? 9 : 6;
      this.position.x = damp(this.position.x, tx, k, dt);
      this.position.y = damp(this.position.y, ty, k, dt);
      this.position.z = damp(this.position.z, tz, k, dt);

      let d = alvo.yaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-6 * dt));
      this.state = alvo.state;
    }

    // Bate asa voando, dobra as asas pousado — e uma inclinação de corpo que
    // acompanha o giro, para a curva não parecer um trilho.
    const voando = this.state !== "perch";
    this.flapPhase += dt * (voando ? 16 : 2.5);
    const bater = voando ? Math.sin(this.flapPhase) * 0.85 : -0.15;
    for (const asa of this.wings) {
      asa.group.rotation.z = asa.lado * bater;
    }
    this.visualRoot.rotation.x = voando ? -0.12 : 0;

    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    this.syncPhysics();
  }

  syncPhysics() {
    this.body.setTranslation(
      { x: this.position.x, y: this.position.y, z: this.position.z },
      true,
    );
  }
}
