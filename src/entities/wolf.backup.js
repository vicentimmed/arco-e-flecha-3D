/* ---------------------------------------------------------------------------
   Lobo — quadrúpede articulado (noite dos zumbis e hordas do alce).

   Mais rápido e frágil que o zumbi (1 flecha). Olhos vermelhos BasicMaterial
   (fog: false), como o zumbi: no escuro anunciam a ameaça antes do corpo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { damp } from "../utils/math.js";

const H = () => CONFIG.modes.zombie.wolfBodyHeight ?? 1.45;

const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const COS_EYE_CULL = Math.cos(Math.PI * 0.55);

const MAT = {
  fur: new THREE.MeshStandardMaterial({
    color: "#2a2e28",
    roughness: 0.96,
    metalness: 0.02,
  }),
  dark: new THREE.MeshStandardMaterial({
    color: "#141612",
    roughness: 1.0,
  }),
  muzzle: new THREE.MeshStandardMaterial({
    color: "#1a1814",
    roughness: 0.9,
  }),
  teeth: new THREE.MeshStandardMaterial({
    color: "#f2efe6",
    roughness: 0.45,
    metalness: 0.05,
  }),
  eye: new THREE.MeshBasicMaterial({
    color: CONFIG.modes.zombie.eyeColor,
    fog: false,
  }),
};

let SHARED = null;
let SHARED_H = 0;

function buildShared() {
  const h = H();
  if (SHARED && SHARED_H === h) return SHARED;
  SHARED_H = h;

  const torso = new THREE.SphereGeometry(0.38, 10, 8);
  torso.scale(1.15, 0.82, 1.7);
  torso.translate(0, h * 0.55, 0.02);

  const peito = new THREE.SphereGeometry(0.28, 8, 6);
  peito.scale(1.1, 0.9, 1.0);
  peito.translate(0, h * 0.52, 0.4);

  const garupa = new THREE.SphereGeometry(0.3, 8, 6);
  garupa.scale(1.15, 0.85, 1.05);
  garupa.translate(0, h * 0.54, -0.38);

  const corpo = mergeGeometries([torso, peito, garupa]);

  const olhos = mergeGeometries(
    [-1, 1].map((lado) => {
      const g = new THREE.SphereGeometry(0.04, 6, 5);
      g.translate(lado * 0.1, 0.09, 0.18);
      return g;
    }),
  );

  const coxa = new THREE.CapsuleGeometry(0.055, 0.22, 3, 5);
  coxa.translate(0, -0.14, 0);
  const joelhoG = new THREE.SphereGeometry(0.05, 5, 4);
  joelhoG.translate(0, -0.28, 0.01);
  const canela = new THREE.CapsuleGeometry(0.04, 0.2, 3, 5);
  canela.translate(0, -0.44, 0);
  const pe = new THREE.BoxGeometry(0.07, 0.04, 0.14);
  pe.translate(0, -0.58, -0.02);
  const perna = mergeGeometries([coxa, joelhoG, canela, pe]);

  SHARED = { corpo, olhos, perna };
  return SHARED;
}

export class Wolf {
  constructor(scene, physics, terrain, entityId, x, z) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.entityId = entityId;
    this.kind = "wolf";
    this.netTarget = null;
    this.dead = false;
    this.state = "walk";
    this.deathRoll = 0;
    this.animPhase = Math.random() * Math.PI * 2;
    this.howlTimer = this._nextHowlDelay();

    const y = terrain.heightAt(x, z);
    this.position = new THREE.Vector3(x, y, z);
    this.yaw = 0;
    this.speed = 0;

    this.group = new THREE.Group();
    this.group.name = `wolf-${entityId}`;
    this.buildMesh();
    this.group.position.copy(this.position);
    scene.add(this.group);

    const hh = H();
    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + hh / 2, z),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(hh / 2 - 0.22, 0.3).setActiveEvents(
        RAPIER.ActiveEvents.COLLISION_EVENTS,
      ),
      this.body,
    );
    physics.register(this.collider, { kind: "wolf", entityId, wolf: this });
    entityRegistry.register(entityId, this);
  }

  buildMesh() {
    const S = buildShared();
    const h = H();
    const root = new THREE.Group();
    this.lodDetail = null;
    this.lodBulk = [];

    this.corpo = new THREE.Mesh(S.corpo, MAT.fur);
    this.corpo.castShadow = true;
    root.add(this.corpo);
    this.lodBulk.push(this.corpo);

    this.neck = new THREE.Group();
    this.neck.position.set(0, h * 0.62, 0.48);
    root.add(this.neck);

    const pescoco = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.16, 0.36, 7),
      MAT.fur,
    );
    pescoco.rotation.x = -0.5;
    pescoco.position.set(0, 0.08, 0.08);
    pescoco.castShadow = true;
    this.neck.add(pescoco);

    this.head = new THREE.Group();
    this.head.position.set(0, 0.16, 0.26);
    this.neck.add(this.head);

    const cranio = new THREE.Mesh(new THREE.SphereGeometry(0.16, 9, 7), MAT.fur);
    cranio.scale.set(0.9, 0.95, 1.2);
    cranio.castShadow = true;
    this.head.add(cranio);

    // Focinho comprido de lobo.
    const focinho = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.09, 0.36, 8),
      MAT.muzzle,
    );
    focinho.rotation.x = Math.PI / 2;
    focinho.position.set(0, -0.02, 0.28);
    this.head.add(focinho);

    const nariz = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), MAT.dark);
    nariz.position.set(0, -0.01, 0.46);
    this.head.add(nariz);

    // Boca aberta + dentes brancos.
    const boca = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.22), MAT.dark);
    boca.position.set(0, -0.07, 0.28);
    this.head.add(boca);

    for (const lado of [-1, 1]) {
      const canino = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 5), MAT.teeth);
      canino.rotation.x = Math.PI;
      canino.position.set(lado * 0.035, -0.05, 0.38);
      this.head.add(canino);
    }
    for (let i = -1; i <= 1; i++) {
      const dente = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.035, 0.02), MAT.teeth);
      dente.position.set(i * 0.028, -0.048, 0.3);
      this.head.add(dente);
    }

    this.olhos = new THREE.Mesh(S.olhos, MAT.eye);
    this.olhos.frustumCulled = false;
    this.olhos.renderOrder = 4;
    this.head.add(this.olhos);

    for (const lado of [-1, 1]) {
      const orelha = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), MAT.dark);
      orelha.position.set(lado * 0.1, 0.16, -0.04);
      orelha.rotation.z = lado * 0.35;
      this.head.add(orelha);
    }

    this.legs = [];
    const legY = h * 0.48;
    const places = [
      { x: -0.18, z: 0.32, frente: true },
      { x: 0.18, z: 0.32, frente: true },
      { x: -0.18, z: -0.36, frente: false },
      { x: 0.18, z: -0.36, frente: false },
    ];
    for (const p of places) {
      const leg = new THREE.Group();
      leg.position.set(p.x, legY, p.z);
      const m = new THREE.Mesh(S.perna, MAT.dark);
      m.castShadow = true;
      leg.add(m);
      root.add(leg);
      this.legs.push({ group: leg, frente: p.frente });
      this.lodBulk.push(leg);
    }

    // Rabo articulado: 3 segmentos.
    this.tailRoot = new THREE.Group();
    this.tailRoot.position.set(0, h * 0.58, -0.55);
    root.add(this.tailRoot);
    this.tailSegments = [];
    const lens = [0.22, 0.2, 0.18];
    const radii = [0.07, 0.055, 0.035];
    let parent = this.tailRoot;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      if (i > 0) seg.position.z = -lens[i - 1] * 0.9;
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(radii[i], lens[i], 6),
        MAT.fur,
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = -lens[i] * 0.45;
      mesh.castShadow = true;
      seg.add(mesh);
      parent.add(seg);
      this.tailSegments.push(seg);
      parent = seg;
      this.lodBulk.push(seg);
    }

    this.group.add(root);
    this.visualRoot = root;
  }

  _nextHowlDelay() {
    const Z = CONFIG.modes.zombie;
    return Z.wolfHowlMinInterval + Math.random() * (Z.wolfHowlMaxInterval - Z.wolfHowlMinInterval);
  }

  registerHit(impact, arrow) {
    if (this.dead) return;
    gameEvents.emit(EventType.ZOMBIE_HIT, {
      zombieId: this.entityId,
      head: false,
      wolf: true,
      impact: vec3Payload(impact),
      arrowId: arrow?.id,
      ownerId: arrow?.ownerEntityId ?? null,
      distance: arrow ? arrow.launchPosition.distanceTo(impact) : 0,
      speed: arrow?.launchSpeed ?? 0,
    });
  }

  setNetworkTarget(p, yaw, state) {
    this.netTarget = { x: p[0], y: p[1], z: p[2], yaw, state };
  }

  killLocal() {
    if (this.dead) return;
    this.dead = true;
    this.state = "dead";
    this.speed = 0;
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "wolfDeath",
      position: vec3Payload(this.position),
      volume: 1.25,
    });
  }

  dispose() {
    this.physics.unregister(this.collider);
    this.physics.removeBody(this.body);
    entityRegistry.unregister(this.entityId);
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry = null;
    });
  }

  cullEyes(camera) {
    if (!camera) return;
    _dir.copy(this.position).sub(camera.position);
    const d = _dir.length();
    if (d < 1e-3) return;
    _dir.divideScalar(d);
    camera.getWorldDirection(_fwd);
    this.olhos.visible = _dir.dot(_fwd) > COS_EYE_CULL;
  }

  update(dt, camera) {
    if (this.dead) {
      this.updateDeath(dt);
      this.cullEyes(camera);
      return;
    }

    const alvo = this.netTarget;
    if (alvo) {
      const k = 14;
      const antes = this.position.clone();
      this.position.x = damp(this.position.x, alvo.x, k, dt);
      this.position.y = damp(this.position.y, alvo.y, k, dt);
      this.position.z = damp(this.position.z, alvo.z, k, dt);
      let d = alvo.yaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-k * dt));
      this.speed = antes.distanceTo(this.position) / Math.max(dt, 1e-4);
      this.state = alvo.state;
    }

    this.animate(dt);
    this.updateHowl(dt);
    this.cullEyes(camera);
    this.syncPhysics();
  }

  updateDeath(dt) {
    this.deathRoll = Math.min(Math.PI / 2, this.deathRoll + dt * 4.2);
    this.visualRoot.rotation.z = this.deathRoll;
    this.visualRoot.position.y = -0.15 * (this.deathRoll / (Math.PI / 2));
    this.group.position.copy(this.position);
  }

  animate(dt) {
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;

    const passada = 1.1;
    this.animPhase += (Math.PI * 2 * this.speed * dt) / passada + dt * 0.8;

    const andando = this.speed > 0.2;
    const ataque = this.state === "attack";
    const salto = this.state === "leap";
    const abertura = salto ? 0.35 : ataque ? 0.55 : andando ? 0.7 : 0.08;
    const swing = Math.sin(this.animPhase) * abertura;

    for (let i = 0; i < this.legs.length; i++) {
      const fase = i === 0 || i === 3 ? 1 : -1;
      this.legs[i].group.rotation.x = fase * swing + (salto ? -0.45 : 0);
    }

    this.neck.rotation.x = salto
      ? -0.15
      : ataque
        ? 0.55 + Math.sin(this.animPhase * 8) * 0.12
        : 0.15 + Math.sin(this.animPhase * 0.8) * 0.08;
    this.head.rotation.x = ataque ? 0.35 : Math.sin(this.animPhase * 0.6) * 0.06;

    const bob = salto
      ? 0.15
      : Math.abs(Math.sin(this.animPhase)) * Math.min(0.06, this.speed * 0.007);
    this.corpo.position.y = bob;

    // Cauda: balanço em walk; mais erguida em attack/leap.
    if (this.tailSegments?.length) {
      const rígido = ataque || salto;
      const wag = rígido ? 0.12 : Math.sin(this.animPhase * 1.4) * 0.45;
      const lift = rígido ? -0.35 : 0.55 + Math.sin(this.animPhase * 0.7) * 0.12;
      for (let i = 0; i < this.tailSegments.length; i++) {
        const amp = 1 + i * 0.35;
        this.tailSegments[i].rotation.y = wag * amp * 0.35;
        this.tailSegments[i].rotation.x = lift * (0.35 + i * 0.15);
      }
    }
  }

  updateHowl(dt) {
    this.howlTimer -= dt;
    if (this.howlTimer > 0) return;
    this.howlTimer = this._nextHowlDelay();
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "wolfHowl",
      position: vec3Payload(this.position),
      volume: CONFIG.modes.zombie.wolfHowlVolume,
    });
  }

  syncPhysics() {
    const hh = H();
    this.body.setTranslation(
      { x: this.position.x, y: this.position.y + hh / 2, z: this.position.z },
      true,
    );
  }
}
