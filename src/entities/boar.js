/* ---------------------------------------------------------------------------
   Porco selvagem — o corpo, a animação e o colisor.

   A INTELIGÊNCIA NÃO MORA AQUI. Vagar, comer, se assustar e fugir são decididos
   em `server/boarSim.js`, porque essas escolhas sorteiam: rodar a mesma IA em
   cada navegador daria, em segundos, um bando diferente por tela — você atiraria
   num porco que, para o seu amigo, já tinha saído dali.

   O que chega são posição, ângulo, velocidade e estado, a 10 Hz. Esta classe
   persegue essa pose e calcula a animação — pernas, cabeça, rabo — a partir da
   velocidade, porque animação é função do estado e não precisa trafegar.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { damp } from "../utils/math.js";

const MAT = {
  body: new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.88 }),
  dark: new THREE.MeshStandardMaterial({ color: "#4a3020", roughness: 0.9 }),
  snout: new THREE.MeshStandardMaterial({ color: "#5c4030", roughness: 0.85 }),
  bristle: new THREE.MeshStandardMaterial({ color: "#33251d", roughness: 1 }),
  eye: new THREE.MeshStandardMaterial({ color: "#0d0907", roughness: 0.35 }),
  tusk: new THREE.MeshStandardMaterial({ color: "#d8c9a5", roughness: 0.65 }),
  hoof: new THREE.MeshStandardMaterial({ color: "#1f1814", roughness: 0.95 }),
};

export class Boar {
  constructor(scene, physics, terrain, entityId, x, z) {
    this.scene = scene;
    this.physics = physics;
    this.entityId = entityId;
    /** Última pose vinda do servidor. Até a primeira chegar, ele fica parado. */
    this.netTarget = null;
    this.dead = false;
    /** Vem do servidor; a animação lê daqui (comer abaixa a cabeça, fugir corre). */
    this.state = "wander";
    // A fase começa espalhada para que dois porcos lado a lado não andem em
    // sincronia perfeita, o que denuncia na hora que são cópias.
    this.animPhase = Math.random() * Math.PI * 2;

    const y = terrain.heightAt(x, z);
    this.position = new THREE.Vector3(x, y, z);
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.deathRoll = 0;

    this.group = new THREE.Group();
    this.group.name = `boar-${entityId}`;
    this.buildMesh();
    this.group.position.copy(this.position);
    scene.add(this.group);

    const cfg = CONFIG.boar;
    const halfH = cfg.colliderHalfHeight;
    const r = cfg.colliderRadius;
    const centerY = y + cfg.bodyHeight / 2;

    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, centerY, z),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(halfH, r).setActiveEvents(
        RAPIER.ActiveEvents.COLLISION_EVENTS,
      ),
      this.body,
    );
    physics.register(this.collider, {
      kind: "boar",
      entityId,
      boar: this,
    });
    entityRegistry.register(entityId, this);
  }

  buildMesh() {
    const root = new THREE.Group();

    this.bodyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 16, 12),
      MAT.body,
    );
    this.bodyMesh.scale.set(1.08, 0.78, 1.5);
    this.bodyMesh.position.set(0, 0.43, -0.05);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    root.add(this.bodyMesh);

    // Javali tem ombros altos e pesados, pescoço curto e dorso arqueado.
    const shoulder = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 14, 10),
      MAT.dark,
    );
    shoulder.scale.set(1.13, 1.03, 0.85);
    shoulder.position.set(0, 0.49, 0.3);
    shoulder.castShadow = true;
    root.add(shoulder);

    const belly = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 9),
      MAT.body,
    );
    belly.scale.set(1.05, 0.72, 1.3);
    belly.position.set(0, 0.31, -0.15);
    belly.castShadow = true;
    root.add(belly);

    // Cerdas escuras formam uma crista irregular no dorso.
    for (let i = 0; i < 9; i++) {
      const bristle = new THREE.Mesh(
        new THREE.ConeGeometry(0.025, 0.15 + (i % 3) * 0.018, 4),
        MAT.bristle,
      );
      bristle.position.set(
        (i % 2 ? 1 : -1) * 0.015,
        0.78 - Math.abs(i - 4) * 0.012,
        0.46 - i * 0.12,
      );
      bristle.rotation.x = (i - 4) * 0.035;
      root.add(bristle);
    }

    this.head = new THREE.Group();
    this.head.position.set(0, 0.5, 0.62);
    root.add(this.head);

    const skull = new THREE.Mesh(
      new THREE.SphereGeometry(0.23, 14, 10),
      MAT.body,
    );
    skull.scale.set(1.12, 0.92, 1.2);
    skull.castShadow = true;
    this.head.add(skull);

    const muzzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.16, 0.25, 12),
      MAT.snout,
    );
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, -0.055, 0.22);
    muzzle.castShadow = true;
    this.head.add(muzzle);

    const snout = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.045, 12),
      MAT.snout,
    );
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.055, 0.36);
    snout.castShadow = true;
    this.head.add(snout);

    for (const side of [-1, 1]) {
      const nostril = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 7, 5),
        MAT.eye,
      );
      nostril.position.set(side * 0.052, -0.035, 0.384);
      nostril.scale.set(1, 0.65, 0.4);
      this.head.add(nostril);

      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 8, 6),
        MAT.eye,
      );
      eye.position.set(side * 0.175, 0.055, 0.105);
      this.head.add(eye);

      const ear = new THREE.Mesh(
        new THREE.ConeGeometry(0.075, 0.18, 5),
        MAT.dark,
      );
      ear.position.set(side * 0.16, 0.17, -0.035);
      ear.rotation.z = side * 0.58;
      ear.rotation.x = -0.2;
      this.head.add(ear);

      const tusk = new THREE.Mesh(
        new THREE.ConeGeometry(0.026, 0.14, 8),
        MAT.tusk,
      );
      tusk.position.set(side * 0.125, -0.115, 0.285);
      tusk.rotation.z = side * 0.55;
      tusk.rotation.x = -0.45;
      this.head.add(tusk);
    }

    this.legs = [];
    for (const [lx, lz] of [
      [0.25, 0.32],
      [-0.25, 0.32],
      [0.23, -0.34],
      [-0.23, -0.34],
    ]) {
      const leg = new THREE.Group();
      leg.position.set(lx, 0.34, lz);

      const shin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.047, 0.29, 7),
        MAT.dark,
      );
      shin.position.y = -0.145;
      shin.castShadow = true;
      leg.add(shin);

      const hoof = new THREE.Mesh(
        new THREE.BoxGeometry(0.105, 0.07, 0.14),
        MAT.hoof,
      );
      hoof.position.set(0, -0.31, 0.035);
      hoof.rotation.x = -0.08;
      hoof.castShadow = true;
      leg.add(hoof);

      root.add(leg);
      this.legs.push(leg);
    }

    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.58, -0.62);
    const tailA = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.018, 6, 12, Math.PI * 1.45),
      MAT.dark,
    );
    tailA.rotation.y = Math.PI / 2;
    this.tail.add(tailA);
    root.add(this.tail);

    this.group.add(root);
    this.visualRoot = root;
  }

  registerHit(impact, arrow) {
    if (this.dead) return;
    this.dead = true;
    this.state = "dead";
    this.speed = 0;
    gameEvents.emit(EventType.BOAR_DEATH, {
      boarId: this.entityId,
      impact: vec3Payload(impact),
      arrowId: arrow?.id,
      ownerId: arrow?.ownerEntityId ?? null,
      // A distância do disparo é o que decide os pontos: porco longe vale mais.
      distance: arrow ? arrow.launchPosition.distanceTo(impact) : 0,
    });
  }

  /* -------------------------------------------------------------- em rede -- */

  /** Última pose vinda do servidor. A animação continua sendo calculada aqui. */
  setNetworkTarget(p, yaw, speed, state) {
    this.netTarget = { x: p[0], y: p[1], z: p[2], yaw, speed, state };
  }

  /** Morte anunciada pelo servidor (ou pelo próprio acerto). */
  killLocal() {
    if (this.dead) return;
    this.dead = true;
    this.state = "dead";
    this.speed = 0;
  }

  dispose() {
    this.physics.unregister(this.collider);
    this.physics.removeBody(this.body);
    entityRegistry.unregister(this.entityId);
    this.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
  }

  /**
   * Um passo: persegue a pose recebida em vez de decidir sozinho.
   *
   * A 10 Hz, um amortecimento simples já dá movimento liso — um javali vagando
   * não precisa do buffer de interpolação que os jogadores usam, porque ninguém
   * mira nele com a precisão com que mira numa pessoa.
   */
  update(dt) {
    if (this.dead) {
      this.deathRoll = Math.min(Math.PI / 2, this.deathRoll + dt * 2.2);
      this.visualRoot.rotation.z = this.deathRoll;
      this.visualRoot.position.y = -0.15 * (this.deathRoll / (Math.PI / 2));
      return;
    }
    const alvo = this.netTarget;
    if (alvo) {
      const k = 14;
      this.position.x = damp(this.position.x, alvo.x, k, dt);
      this.position.y = damp(this.position.y, alvo.y, k, dt);
      this.position.z = damp(this.position.z, alvo.z, k, dt);
      // Ângulo pelo caminho curto: sem isso o porco dá meia-volta ao cruzar ±π.
      let d = alvo.yaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-k * dt));
      this.speed = damp(this.speed, alvo.speed, k, dt);
      this.state = alvo.state;
    }
    this.animPhase += dt * (this.state === "flee" ? 14 : 6);
    this.animate(dt);
    this.syncPhysics();
  }

  animate(dt) {
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;

    const eatBob =
      this.state === "eat" ? Math.sin(this.animPhase * 3) * 0.08 : 0;
    this.head.rotation.x = eatBob - (this.state === "eat" ? 0.48 : 0.08);
    this.head.rotation.z =
      this.state === "eat" ? Math.sin(this.animPhase * 1.7) * 0.045 : 0;
    this.bodyMesh.position.y =
      0.43 + Math.abs(Math.sin(this.animPhase)) * Math.min(0.035, this.speed * 0.01);
    this.tail.rotation.z = Math.sin(this.animPhase * 0.7) * 0.22;

    const legSwing =
      this.speed > 0.1 ? Math.sin(this.animPhase) * (this.state === "flee" ? 0.5 : 0.28) : 0;
    for (let i = 0; i < this.legs.length; i++) {
      const phase = i === 0 || i === 3 ? 1 : -1;
      this.legs[i].rotation.x = phase * legSwing;
    }
  }

  syncPhysics() {
    const y = this.position.y + CONFIG.boar.bodyHeight / 2;
    this.body.setTranslation(
      { x: this.position.x, y, z: this.position.z },
      true,
    );
  }
}
