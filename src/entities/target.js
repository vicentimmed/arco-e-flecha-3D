/* ---------------------------------------------------------------------------
   Alvos.

   Três comportamentos, todos emergindo da física — nenhum é roteirizado:

   • topple — alvo leve (2,5 kg) sobre tripé: tomba com um impacto forte e
     centrado, resiste a um tiro fraco ou baixo.
   • swing  — alvo suspenso por junta revoluta: balança como pêndulo.
   • heavy  — 70 kg: absorve o impacto, mal se mexe.

   A pontuação sai da posição do impacto no referencial do alvo, então continua
   correta mesmo com o alvo tombado ou balançando.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { pathCenterX } from "./environment.js";

const UP = new THREE.Vector3(0, 1, 0);

/* --------------------------------------------------------- face do alvo ---- */

let faceTexture = null;

function makeFaceTexture() {
  if (faceTexture) return faceTexture;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size / 2;

  // Anéis oficiais, de fora para dentro: branco, preto, azul, vermelho, ouro.
  const rings = [
    ["#f2ede2", "#2c2c30"],
    ["#f2ede2", "#2c2c30"],
    ["#2c2c30", "#f2ede2"],
    ["#2c2c30", "#f2ede2"],
    ["#3d7fc1", "#f2ede2"],
    ["#3d7fc1", "#f2ede2"],
    ["#d6483c", "#f2ede2"],
    ["#d6483c", "#f2ede2"],
    ["#f2c14e", "#2c2c30"],
    ["#f2c14e", "#2c2c30"],
  ];

  for (let i = 0; i < rings.length; i++) {
    const outer = c * (1 - i / rings.length);
    ctx.beginPath();
    ctx.arc(c, c, outer, 0, Math.PI * 2);
    ctx.fillStyle = rings[i][0];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = rings[i][1];
    ctx.stroke();
  }
  // Ponto central.
  ctx.beginPath();
  ctx.arc(c, c, c * 0.025, 0, Math.PI * 2);
  ctx.fillStyle = "#d6483c";
  ctx.fill();

  faceTexture = new THREE.CanvasTexture(canvas);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  faceTexture.anisotropy = 8;
  return faceTexture;
}

const MAT = {
  straw: new THREE.MeshStandardMaterial({ color: "#d8c295", roughness: 0.95 }),
  wood: new THREE.MeshStandardMaterial({ color: "#8a6039", roughness: 0.9 }),
  strap: new THREE.MeshStandardMaterial({ color: "#4a3a2a", roughness: 0.9 }),
};

/* ------------------------------------------------------------------ alvo --- */

export class Target {
  constructor(scene, physics, sync, terrain, spec, index) {
    /** Todos os colisores deste alvo — permite desligá-lo por inteiro. */
    this.colliders = [];
    this.physics = physics;
    this.sync = sync;
    this.kind = spec.kind;
    this.index = index;
    this.distance = spec.distance;
    this.hits = 0;
    this.lastScore = 0;

    const z = CONFIG.player.start.z - spec.distance;
    const x = pathCenterX(z) + (spec.offsetX ?? 0);
    const y = terrain.heightAt(x, z);
    this.origin = new THREE.Vector3(x, y, z);

    this.group = new THREE.Group();
    this.group.name = `target-${index}`;
    scene.add(this.group);

    this.faceCenterLocal = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    if (this.kind === "swing") this.buildSwing(scene, physics);
    else this.buildStanding(scene, physics);

    this.sync.add(this.body, this.group);
  }

  /* ---------------------------------------------------------- geometria --- */

  buildFaceMesh(parent, localY) {
    const R = CONFIG.target.faceRadius;
    const T = CONFIG.target.faceThickness;

    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 40), MAT.straw);
    drum.rotation.x = Math.PI / 2;
    drum.position.y = localY;
    drum.castShadow = true;
    drum.receiveShadow = true;
    parent.add(drum);

    const face = new THREE.Mesh(
      new THREE.CircleGeometry(R * 0.995, 56),
      new THREE.MeshStandardMaterial({
        map: makeFaceTexture(),
        roughness: 0.9,
      }),
    );
    face.position.set(0, localY, T / 2 + 0.002);
    face.receiveShadow = true;
    parent.add(face);

    const back = new THREE.Mesh(
      new THREE.CircleGeometry(R * 0.995, 40),
      MAT.straw,
    );
    back.rotation.y = Math.PI;
    back.position.set(0, localY, -T / 2 - 0.002);
    parent.add(back);

    this.faceCenterLocal.set(0, localY, 0);
  }

  /** Alvo apoiado num tripé: pode tombar. */
  buildStanding(scene, physics) {
    const kind = CONFIG.target.kinds[this.kind];
    const faceY = 1.25;

    this.buildFaceMesh(this.group, faceY);

    // Tripé de madeira.
    const legTop = new THREE.Vector3(0, faceY + 0.1, -0.09);
    const legFeet = [
      new THREE.Vector3(0.42, 0, 0.26),
      new THREE.Vector3(-0.42, 0, 0.26),
      new THREE.Vector3(0, 0, -0.5),
    ];
    this.legSpecs = [];
    for (const foot of legFeet) {
      const dir = foot.clone().sub(legTop);
      const len = dir.length();
      dir.normalize();
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.045, len, 7),
        MAT.wood,
      );
      mesh.position.copy(legTop).addScaledVector(dir, len / 2);
      mesh.quaternion.setFromUnitVectors(UP, dir);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.legSpecs.push({ center: mesh.position.clone(), q: mesh.quaternion.clone(), len });
    }

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.origin.x, this.origin.y, this.origin.z)
      .setLinearDamping(0.25)
      .setAngularDamping(0.35)
      .setCanSleep(true);
    this.body = physics.createBody(bodyDesc);

    // 70 % da massa na face, 10 % em cada perna: centro de gravidade alto o
    // bastante para tombar, baixo o bastante para ficar de pé.
    const R = CONFIG.target.faceRadius;
    const T = CONFIG.target.faceThickness;
    const faceDesc = RAPIER.ColliderDesc.cylinder(T / 2, R)
      .setTranslation(0, faceY, 0)
      .setRotation(quatFromAxisAngle(1, 0, 0, Math.PI / 2))
      .setMass(kind.mass * 0.7)
      .setFriction(kind.friction)
      .setRestitution(kind.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.faceCollider = physics.createCollider(faceDesc, this.body);
    this.colliders.push(this.faceCollider);
    physics.register(this.faceCollider, { kind: "target", target: this });

    for (const leg of this.legSpecs) {
      const desc = RAPIER.ColliderDesc.cylinder(leg.len / 2, 0.04)
        .setTranslation(leg.center.x, leg.center.y, leg.center.z)
        .setRotation({ x: leg.q.x, y: leg.q.y, z: leg.q.z, w: leg.q.w })
        .setMass((kind.mass * 0.3) / 3)
        .setFriction(kind.friction)
        .setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = physics.createCollider(desc, this.body);
      this.colliders.push(collider);
      physics.register(collider, { kind: "target", target: this, isLeg: true });
    }
  }

  /** Alvo suspenso: junta revoluta com eixo horizontal transversal ao tiro. */
  buildSwing(scene, physics) {
    const kind = CONFIG.target.kinds[this.kind];
    const beamY = 2.5;
    const hingeLocalY = 0.82; // acima do centro da face (origem do corpo)

    /* estrutura fixa ------------------------------------------------------ */
    const frame = new THREE.Group();
    frame.position.copy(this.origin);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.075, beamY, 8),
        MAT.wood,
      );
      post.position.set(s * 0.92, beamY / 2, 0);
      post.castShadow = true;
      frame.add(post);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.9), MAT.wood);
      brace.position.set(s * 0.92, beamY * 0.35, 0.32);
      brace.rotation.x = 0.5;
      frame.add(brace);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.09, 0.09), MAT.wood);
    beam.position.set(0, beamY, 0);
    beam.castShadow = true;
    frame.add(beam);
    scene.add(frame);
    this.frame = frame;

    const frameBody = physics.createBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        this.origin.x,
        this.origin.y,
        this.origin.z,
      ),
    );
    for (const s of [-1, 1]) {
      const desc = RAPIER.ColliderDesc.cylinder(beamY / 2, 0.07)
        .setTranslation(s * 0.92, beamY / 2, 0)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = physics.createCollider(desc, frameBody);
      this.colliders.push(collider);
      physics.register(collider, { kind: "scenery", name: "poste" });
    }
    this.frameBody = frameBody;

    /* alvo pendurado ------------------------------------------------------ */
    this.buildFaceMesh(this.group, 0);
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.02), MAT.strap);
      strap.position.set(s * 0.26, 0.42, 0);
      strap.rotation.z = -s * 0.16;
      strap.castShadow = true;
      this.group.add(strap);
    }

    const faceWorldY = this.origin.y + beamY - hingeLocalY;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.origin.x, faceWorldY, this.origin.z)
      .setLinearDamping(0.12)
      .setAngularDamping(0.28)
      .setCanSleep(true);
    this.body = physics.createBody(bodyDesc);

    const R = CONFIG.target.faceRadius;
    const T = CONFIG.target.faceThickness;
    const faceDesc = RAPIER.ColliderDesc.cylinder(T / 2, R)
      .setRotation(quatFromAxisAngle(1, 0, 0, Math.PI / 2))
      .setMass(kind.mass)
      .setFriction(kind.friction)
      .setRestitution(kind.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.faceCollider = physics.createCollider(faceDesc, this.body);
    this.colliders.push(this.faceCollider);
    physics.register(this.faceCollider, { kind: "target", target: this });

    // Eixo X: o alvo balança para frente e para trás em relação ao tiro.
    const joint = RAPIER.JointData.revolute(
      { x: 0, y: beamY, z: 0 },
      { x: 0, y: hingeLocalY, z: 0 },
      { x: 1, y: 0, z: 0 },
    );
    this.joint = physics.world.createImpulseJoint(joint, frameBody, this.body, true);
  }

  /* --------------------------------------------------------- pontuação ---- */

  /**
   * Converte o ponto de impacto para o referencial do alvo e devolve o anel.
   * Funciona igual com o alvo tombado, girado ou balançando.
   */
  registerHit(worldPoint) {
    const t = this.body.translation();
    const r = this.body.rotation();
    this._q.set(r.x, r.y, r.z, r.w).invert();
    this._local
      .set(worldPoint.x - t.x, worldPoint.y - t.y, worldPoint.z - t.z)
      .applyQuaternion(this._q)
      .sub(this.faceCenterLocal);

    // O plano da face é o XY local; Z é a normal.
    const radius = Math.hypot(this._local.x, this._local.y);
    const R = CONFIG.target.faceRadius;
    const ringWidth = R / CONFIG.target.rings;

    let score = 0;
    let onFace = false;
    if (radius <= R) {
      onFace = Math.abs(this._local.z) < CONFIG.target.faceThickness * 1.6;
      score = onFace
        ? Math.max(1, CONFIG.target.rings + 1 - Math.ceil(radius / ringWidth))
        : 0;
    }

    if (score > 0) {
      this.hits++;
      this.lastScore = score;
    }
    return { score, radius, onFace, distance: this.distance, target: this };
  }

  /**
   * Some com o alvo — visual E fisicamente.
   *
   * Esconder só a malha não basta: uma flecha ainda cravaria num alvo
   * invisível, e no modo de alvos em série o campo precisa estar realmente
   * vazio para "o próximo está mais longe" significar alguma coisa.
   */
  setActive(on) {
    this.group.visible = on;
    for (const c of this.colliders) c.setEnabled(on);
  }

  /** Distância real do arqueiro (o jogador anda, então não é fixa). */
  distanceTo(position) {
    const t = this.body.translation();
    return Math.hypot(t.x - position.x, t.z - position.z);
  }
}

function quatFromAxisAngle(x, y, z, angle) {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(half) };
}

/* ---------------------------------------------------------------- API ------ */

export function createTargets(scene, physics, sync, terrain) {
  return CONFIG.targets.map(
    (spec, i) => new Target(scene, physics, sync, terrain, spec, i),
  );
}
