/* ---------------------------------------------------------------------------
   A flecha — o coração da simulação.

   Três decisões importantes vivem aqui:

   1. ARRASTO MANUAL. Nenhuma engine calcula arrasto quadrático. `linearDamping`
      do Rapier é amortecimento exponencial, modelo diferente, que erraria a
      queda. Então aplicamos F = -½·ρ·Cd·A·|v_rel|·v_rel a cada passo fixo.

   2. ESTABILIDADE AERODINÂMICA DE VERDADE. A flecha não é "girada à força" para
      o vetor velocidade: o arrasto é aplicado no CENTRO DE PRESSÃO, ~13 cm
      atrás do centro de massa. O torque resultante alinha a ponta sozinho,
      com o pequeno atraso e a oscilação amortecida de uma empena real.

   3. IMPULSO LIDO ANTES DO CONTATO. Depois que o solver resolve a colisão a
      velocidade já mudou; guardamos a velocidade do passo anterior para
      transferir o momento correto ao alvo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";

const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------- geometria -- */

let sharedArrowGeometry = null;

function buildArrowMesh() {
  if (!sharedArrowGeometry) {
    const L = CONFIG.arrow.length;
    const r = CONFIG.arrow.shaftRadius;

    const shaftMat = new THREE.MeshStandardMaterial({
      color: "#c9b58c",
      roughness: 0.55,
      metalness: 0.05,
    });
    const tipMat = new THREE.MeshStandardMaterial({
      color: "#9aa0a6",
      roughness: 0.3,
      metalness: 0.75,
    });
    const fletchMat = new THREE.MeshStandardMaterial({
      color: "#d6483c",
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const nockMat = new THREE.MeshStandardMaterial({
      color: "#2b2b30",
      roughness: 0.7,
    });
    sharedArrowGeometry = {
      shaft: new THREE.CylinderGeometry(r, r, L, 7),
      tip: new THREE.ConeGeometry(r * 2.1, 0.055, 7),
      fletch: new THREE.PlaneGeometry(0.021, 0.08),
      nock: new THREE.CylinderGeometry(r * 1.7, r * 1.7, 0.02, 6),
      shaftMat,
      tipMat,
      fletchMat,
      nockMat,
    };
  }
  const g = sharedArrowGeometry;
  const L = CONFIG.arrow.length;

  // Eixo local +Y = da empena para a ponta. O colisor cápsula usa o mesmo eixo,
  // então visual e física nunca divergem.
  const group = new THREE.Group();

  const shaft = new THREE.Mesh(g.shaft, g.shaftMat);
  shaft.castShadow = true;
  group.add(shaft);

  const tip = new THREE.Mesh(g.tip, g.tipMat);
  tip.position.y = L / 2 + 0.027;
  tip.castShadow = true;
  group.add(tip);

  const nock = new THREE.Mesh(g.nock, g.nockMat);
  nock.position.y = -L / 2 + 0.01;
  group.add(nock);

  for (let i = 0; i < 3; i++) {
    const fletch = new THREE.Mesh(g.fletch, g.fletchMat);
    fletch.position.set(0, -L / 2 + 0.075, 0.012);
    const holder = new THREE.Group();
    holder.rotation.y = (i * Math.PI * 2) / 3;
    holder.add(fletch);
    group.add(holder);
  }
  return group;
}

/* ---------------------------------------------------------------- flecha -- */

let nextArrowId = 1;

export class Arrow {
  constructor(scene, physics, sync, origin, direction, speed, trail = null) {
    this.id = nextArrowId++;
    this.physics = physics;
    this.sync = sync;
    this.scene = scene;
    this.trail = trail;
    this.stuck = false;
    this.dead = false;
    this.age = 0;

    // Telemetria para HUD e depuração.
    this.launchSpeed = speed;
    this.launchPosition = origin.clone();
    this.apex = origin.y;
    this.flightTime = 0;
    this.lastSpeed = speed;
    this.lastDragForce = 0;
    if (this.trail) this.trail.push(origin.x, origin.y, origin.z);

    this.mesh = buildArrowMesh();
    this.mesh.position.copy(origin);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, direction);
    this.mesh.quaternion.copy(q);
    scene.add(this.mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinvel(direction.x * speed, direction.y * speed, direction.z * speed)
      .setAngularDamping(CONFIG.arrow.angularDamping)
      .setLinearDamping(0) // arrasto é calculado à mão; damping aqui falsearia
      .setCcdEnabled(true); // a 85 m/s a flecha anda 0,7 m por passo
    this.body = physics.createBody(bodyDesc);

    const half = CONFIG.arrow.length / 2 - CONFIG.arrow.shaftRadius * 1.5;
    const colliderDesc = RAPIER.ColliderDesc.capsule(
      half,
      CONFIG.arrow.shaftRadius * 1.5,
    )
      .setMass(CONFIG.arrow.mass)
      .setFriction(0.6)
      .setRestitution(0.0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.collider = physics.createCollider(colliderDesc, this.body);
    physics.register(this.collider, { kind: "arrow", arrow: this });

    this.syncEntry = sync.add(this.body, this.mesh);

    // Velocidade do passo ANTERIOR — é ela que vale na hora do impacto.
    this.lastVelocity = new THREE.Vector3(
      direction.x * speed,
      direction.y * speed,
      direction.z * speed,
    );

    this._axis = new THREE.Vector3();
    this._vrel = new THREE.Vector3();
    this._force = new THREE.Vector3();
    this._point = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  /** Chamado uma vez por PASSO FIXO, antes de world.step(). */
  applyAerodynamics(h, wind, options) {
    if (this.stuck || this.dead) return;
    this.flightTime += h;

    const body = this.body;
    const v = body.linvel();
    this.lastVelocity.set(v.x, v.y, v.z);
    this.lastSpeed = this.lastVelocity.length();

    const t = body.translation();
    if (t.y > this.apex) this.apex = t.y;
    // Amostrar no passo fixo (120 Hz) dá um traçado bem mais liso que
    // amostrar por frame, principalmente logo após o disparo.
    if (this.trail) this.trail.push(t.x, t.y, t.z);

    // Forças E TORQUES acumulam entre passos no Rapier até serem zerados.
    // `addForceAtPoint` alimenta os dois acumuladores, então zerar só as forças
    // deixaria o torque somando indefinidamente — a flecha acabaria girando
    // sozinha e voando de traseira.
    body.resetForces(false);
    body.resetTorques(false);

    if (!options.dragEnabled) {
      this.lastDragForce = 0;
      return;
    }

    // Velocidade RELATIVA ao ar: é isso que o vento altera. Aplicar o vento
    // como força constante separada seria fisicamente errado.
    this._vrel.set(v.x - wind.x, v.y - wind.y, v.z - wind.z);
    const speed = this._vrel.length();
    if (speed < 1e-3) {
      this.lastDragForce = 0;
      return;
    }

    // Eixo da flecha em coordenadas de mundo.
    const r = body.rotation();
    this._q.set(r.x, r.y, r.z, r.w);
    this._axis.copy(UP).applyQuaternion(this._q);

    // Ângulo de ataque: voando de lado, a área efetiva explode.
    const cosA = this._axis.dot(this._vrel) / speed;
    const sin2 = Math.max(0, 1 - cosA * cosA);
    const areaEff =
      CONFIG.arrow.frontalArea * (1 + CONFIG.arrow.sideAreaFactor * sin2);

    // F = -½·ρ·Cd·A_ef·|v_rel|·v_rel
    const k =
      0.5 *
      CONFIG.physics.airDensity *
      CONFIG.arrow.dragCoefficient *
      areaEff *
      speed;
    this._force.copy(this._vrel).multiplyScalar(-k);
    this.lastDragForce = this._force.length();

    if (options.aeroStabilization) {
      // Centro de pressão ATRÁS do centro de massa ⇒ torque restaurador.
      this._point
        .set(t.x, t.y, t.z)
        .addScaledVector(this._axis, -CONFIG.arrow.centerOfPressureOffset);
      body.addForceAtPoint(this._force, this._point, true);
    } else {
      body.addForce(this._force, true);
    }
  }

  /** Amostra a posição real do corpo rígido para o traçado. */
  recordTrace() {
    if (this.stuck || this.dead || !this.trail) return;
    const t = this.body.translation();
    this.trail.push(t.x, t.y, t.z);
  }

  /**
   * Crava a flecha. Se o corpo atingido for dinâmico, a flecha continua
   * dinâmica e é presa por um FixedJoint — assim ela acompanha o balanço do
   * alvo. Congelá-la travaria o alvo junto.
   */
  stick(otherBody, isDynamic) {
    if (this.stuck) return;
    this.stuck = true;

    // Fecha o traçado na posição de parada; a partir daqui ele conta o tempo
    // de vida até desaparecer.
    if (this.trail) {
      const t = this.body.translation();
      this.trail.finish(t.x, t.y, t.z);
    }

    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);

    // Não colide mais com nada (nem gera eventos).
    this.collider.setCollisionGroups(0);
    this.collider.setActiveEvents(0);
    this.physics.unregister(this.collider);

    if (isDynamic && otherBody) {
      const pa = this.body.translation();
      const qa = this.body.rotation();
      const pb = otherBody.translation();
      const qb = otherBody.rotation();

      // Pose relativa atual: preserva exatamente a orientação do impacto.
      const qInv = new THREE.Quaternion(qb.x, qb.y, qb.z, qb.w).invert();
      const anchor = new THREE.Vector3(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z)
        .applyQuaternion(qInv);
      const frame = qInv
        .clone()
        .multiply(new THREE.Quaternion(qa.x, qa.y, qa.z, qa.w));

      const params = RAPIER.JointData.fixed(
        { x: anchor.x, y: anchor.y, z: anchor.z },
        { x: frame.x, y: frame.y, z: frame.z, w: frame.w },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
      this.joint = this.physics.world.createImpulseJoint(
        params,
        otherBody,
        this.body,
        true,
      );
      this.body.setGravityScale(0, true); // o vínculo já segura o peso
    } else {
      // Cenário estático: congelar é mais estável (e mais barato) que um joint.
      this.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
      this.sync.setActive(this.body, false);
      this.sync.snap(this.body);
    }
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    // Uma flecha que sumiu sem cravar (saiu do mapa, expirou) também encerra o
    // traçado — senão ele ficaria eternamente "em voo" e nunca desapareceria.
    if (this.trail) this.trail.finish();
    if (this.joint) {
      this.physics.world.removeImpulseJoint(this.joint, true);
      this.joint = null;
    }
    this.sync.remove(this.body);
    this.physics.removeBody(this.body);
    this.scene.remove(this.mesh);
    // Geometrias e materiais da flecha são compartilhados entre todas as
    // instâncias: nada a liberar aqui.
  }
}

/* ------------------------------------------------------------ gerenciador -- */

export class ArrowManager {
  constructor(scene, physics, sync, wind, trails) {
    this.scene = scene;
    this.physics = physics;
    this.sync = sync;
    this.wind = wind;
    this.trails = trails;

    this.live = [];
    this.stuck = [];
    this.options = { dragEnabled: true, aeroStabilization: true };

    this.onScore = null; // (target, score, distance, arrow) => void
    this.onMiss = null;

    this.lastArrow = null;

    // UM callback antes de cada passo para todas as flechas: menos indireção.
    this.stepCallback = (h) => {
      const w = this.wind.vector;
      for (const arrow of this.live) arrow.applyAerodynamics(h, w, this.options);
    };
    physics.beforeStep.add(this.stepCallback);

    this.contactCallback = (contact) => this.handleContact(contact);
    physics.onContact.add(this.contactCallback);

    this.impactPuffs = [];
  }

  spawn(origin, direction, speed) {
    const arrow = new Arrow(
      this.scene,
      this.physics,
      this.sync,
      origin,
      direction,
      speed,
      this.trails ? this.trails.create() : null,
    );
    this.live.push(arrow);
    this.lastArrow = arrow;
    return arrow;
  }

  handleContact({ a, b, point, normal }) {
    const arrowOwner = a?.kind === "arrow" ? a : b?.kind === "arrow" ? b : null;
    if (!arrowOwner) return;
    const arrow = arrowOwner.arrow;
    if (arrow.stuck || arrow.dead) return;

    const other = arrowOwner === a ? b : a;

    // Ponto de impacto: do manifold quando disponível; senão, a PONTA da
    // flecha (nunca o centro de massa — o erro seria de ~37 cm).
    const impact = new THREE.Vector3();
    if (point) {
      impact.set(point.x, point.y, point.z);
    } else {
      const t = arrow.body.translation();
      const r = arrow.body.rotation();
      impact
        .copy(UP)
        .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
        .multiplyScalar(CONFIG.arrow.length / 2)
        .add(new THREE.Vector3(t.x, t.y, t.z));
    }

    const target = other?.kind === "target" ? other.target : null;
    let otherBody = null;
    let isDynamic = false;

    if (target) {
      otherBody = target.body;
      isDynamic = target.body.bodyType() === RAPIER.RigidBodyType.Dynamic;

      // Transferência de momento: J = m · v(passo anterior), no ponto do
      // contato — é o que faz o alvo balançar ou tombar.
      const v = arrow.lastVelocity;
      const impulse = {
        x: v.x * CONFIG.arrow.mass,
        y: v.y * CONFIG.arrow.mass,
        z: v.z * CONFIG.arrow.mass,
      };
      if (isDynamic) {
        otherBody.applyImpulseAtPoint(
          impulse,
          { x: impact.x, y: impact.y, z: impact.z },
          true,
        );
      }
      const result = target.registerHit(impact);
      if (this.onScore) {
        this.onScore(target, result, arrow);
      }
    } else {
      this.spawnPuff(impact, normal);
      if (this.onMiss) this.onMiss(arrow, other?.name ?? "chão");
    }

    arrow.stick(otherBody, isDynamic);
    this.retire(arrow);
  }

  retire(arrow) {
    const i = this.live.indexOf(arrow);
    if (i >= 0) this.live.splice(i, 1);
    this.stuck.push(arrow);
    while (this.stuck.length > CONFIG.arrow.maxStuck) {
      this.stuck.shift().dispose();
    }
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const arrow = this.live[i];
      arrow.age += dt;
      arrow.recordTrace();
      const t = arrow.body.translation();
      const tooOld = arrow.age > CONFIG.arrow.maxLifetime;
      const tooFar = Math.abs(t.x) > 130 || t.z < -240 || t.z > 90 || t.y < -30;
      if (tooOld || tooFar) {
        this.live.splice(i, 1);
        arrow.dispose();
      }
    }
    this.updatePuffs(dt);
  }

  get showTrace() {
    return this.trails ? this.trails.enabled : false;
  }

  setTraceVisible(on) {
    if (this.trails) this.trails.setEnabled(on);
  }

  /* --------------------------------------------------------- poeirinha ---- */

  spawnPuff(position, normal) {
    const geo = new THREE.SphereGeometry(0.06, 6, 5);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc9b391,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const group = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.1,
      );
      m.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 1.2 + (normal?.x ?? 0) * 0.8,
        Math.random() * 1.1 + (normal?.y ?? 0) * 0.8,
        (Math.random() - 0.5) * 1.2 + (normal?.z ?? 0) * 0.8,
      );
      group.add(m);
    }
    group.position.copy(position);
    group.userData = { life: 0, material: mat, geometry: geo };
    this.scene.add(group);
    this.impactPuffs.push(group);
    if (this.impactPuffs.length > 8) this.killPuff(this.impactPuffs[0]);
  }

  updatePuffs(dt) {
    for (let i = this.impactPuffs.length - 1; i >= 0; i--) {
      const puff = this.impactPuffs[i];
      puff.userData.life += dt;
      const life = puff.userData.life;
      for (const m of puff.children) {
        m.position.addScaledVector(m.userData.vel, dt);
        m.userData.vel.y -= 3.4 * dt;
        m.scale.setScalar(1 + life * 1.6);
      }
      puff.userData.material.opacity = Math.max(0, 0.65 * (1 - life / 0.85));
      if (life > 0.85) this.killPuff(puff);
    }
  }

  killPuff(puff) {
    const i = this.impactPuffs.indexOf(puff);
    if (i >= 0) this.impactPuffs.splice(i, 1);
    this.scene.remove(puff);
    puff.userData.material.dispose();
    puff.userData.geometry.dispose();
  }

  clearAll() {
    for (const a of this.stuck) a.dispose();
    this.stuck.length = 0;
    for (const a of this.live) a.dispose();
    this.live.length = 0;
    this.lastArrow = null;
    if (this.trails) this.trails.clear();
  }
}
