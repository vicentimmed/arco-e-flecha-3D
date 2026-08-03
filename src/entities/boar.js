/* ---------------------------------------------------------------------------
   Porco selvagem — alvo móvel com IA de medo e animações procedurais.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { entityRegistry } from "../core/entityRegistry.js";

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
    this.terrain = terrain;
    this.entityId = entityId;
    this.dead = false;
    this.state = "wander";
    this.stateTimer = 0;
    this.animPhase = Math.random() * Math.PI * 2;
    this.fleeTimer = 0;
    this.wanderTarget = new THREE.Vector3();
    this.pickWanderTarget(x, z);

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

  pickWanderTarget(x, z) {
    const cfg = CONFIG.boar;
    const angle = Math.random() * Math.PI * 2;
    const dist = cfg.wanderRadius * (0.4 + Math.random() * 0.6);
    this.wanderTarget.set(
      x + Math.cos(angle) * dist,
      0,
      z + Math.sin(angle) * dist,
    );
  }

  scare(from) {
    if (this.dead) return;
    this.state = "flee";
    this.fleeTimer = CONFIG.boar.scareDuration;
    this._fleeFrom = new THREE.Vector3(from.x, from.y, from.z);
  }

  fleeFromPlayer(playerPos) {
    if (this.dead) return;
    this.state = "flee";
    this.fleeTimer = CONFIG.boar.fleeDuration;
    this._fleeFrom = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);
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
    });
  }

  onArrowHit(_impact, _arrow) {
    /* registerHit já tratou morte */
  }

  update(dt, playerPos) {
    if (this.dead) {
      this.deathRoll = Math.min(Math.PI / 2, this.deathRoll + dt * 2.2);
      this.visualRoot.rotation.z = this.deathRoll;
      this.visualRoot.position.y = -0.15 * (this.deathRoll / (Math.PI / 2));
      return;
    }

    const cfg = CONFIG.boar;
    const distPlayer = this.position.distanceTo(playerPos);

    if (distPlayer < cfg.visionRange) {
      this.fleeFromPlayer(playerPos);
    }

    this.stateTimer += dt;
    this.animPhase += dt * (this.state === "flee" ? 14 : 6);

    switch (this.state) {
      case "wander":
        this.speed = cfg.walkSpeed;
        this.moveToward(this.wanderTarget, dt);
        if (this.stateTimer > cfg.wanderMaxTime) {
          this.state = "eat";
          this.stateTimer = 0;
          this.speed = 0;
        }
        if (this.position.distanceTo(this.wanderTarget) < 1.2) {
          this.pickWanderTarget(this.position.x, this.position.z);
        }
        break;
      case "eat":
        this.speed = 0;
        if (this.stateTimer > cfg.eatDuration) {
          this.state = "wander";
          this.stateTimer = 0;
          this.pickWanderTarget(this.position.x, this.position.z);
        }
        break;
      case "flee":
        this.speed = cfg.fleeSpeed;
        if (this._fleeFrom) {
          const away = this.position.clone().sub(this._fleeFrom).normalize();
          this.yaw = Math.atan2(away.x, away.z);
          this.moveDirection(away.x, away.z, dt);
        }
        this.fleeTimer -= dt;
        if (this.fleeTimer <= 0) {
          this.state = "calm";
          this.stateTimer = 0;
          this.speed = cfg.walkSpeed * 0.5;
        }
        break;
      case "calm":
        this.speed = cfg.walkSpeed * 0.4;
        this.moveToward(this.wanderTarget, dt);
        if (this.stateTimer > cfg.calmDuration) {
          this.state = "wander";
          this.stateTimer = 0;
          this.pickWanderTarget(this.position.x, this.position.z);
        }
        break;
    }

    this.animate(dt);
    this.syncPhysics();
  }

  moveToward(target, dt) {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const len = Math.hypot(dx, dz) || 1;
    this.yaw = Math.atan2(dx / len, dz / len);
    this.moveDirection(dx / len, dz / len, dt);
  }

  moveDirection(fx, fz, dt) {
    const step = this.speed * dt;
    let nx = this.position.x + fx * step;
    let nz = this.position.z + fz * step;
    if (!this.terrain.isWalkable(nx, nz)) {
      this.pickWanderTarget(this.position.x, this.position.z);
      return;
    }
    this.position.x = nx;
    this.position.z = nz;
    this.position.y = this.terrain.heightAt(nx, nz);
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

  get counts() {
    return this.dead ? "dead" : "alive";
  }
}
