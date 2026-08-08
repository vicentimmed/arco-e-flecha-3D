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
import { resolveArrowHit } from "../core/hitResolver.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { ARROW_COLLISION_GROUPS } from "../core/collisionGroups.js";

const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------- geometria -- */

let sharedArrowGeometry = null;

/** @param {number|null} color cor do dono; null = uniforme padrão da flecha */
function buildArrowMesh(color = null) {
  if (!sharedArrowGeometry) {
    const L = CONFIG.arrow.length;
    const r = CONFIG.arrow.shaftRadius;

    /* Especular seletiva (Fase 1.5). A PONTA é o brilho mais forte do jogo
       inteiro: aço polido, quase espelho. É ela que faz a flecha em voo piscar
       quando cruza o sol, e é esse lampejo que deixa a trajetória legível a
       oitenta metros — antes, com metalness 0.75 e o mesmo `roughness` da
       haste, ponta e madeira brilhavam igual e a flecha era um palito. */
    const shaftMat = new THREE.MeshStandardMaterial({
      color: "#c9b58c",
      roughness: 0.62,
      metalness: 0.0,
    });
    const tipMat = new THREE.MeshStandardMaterial({
      color: "#9aa0a6",
      roughness: 0.22,
      metalness: 0.85,
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

  /* A EMPENA LEVA A COR DE QUEM ATIROU (Fase 5A.6 do plano).
   *
   * O material é clonado por flecha só para as três empenas — o resto continua
   * compartilhado. É a diferença entre um material por flecha e vinte, e a
   * empena é a única peça que precisa variar: numa flecha cravada no alvo, a
   * três centímetros de outra, é a cor dela que diz de quem foi o tiro.
   *
   * Sem dono (jogo local) fica a cor de fábrica e nada é clonado. */
  const fletchMat = color != null ? g.fletchMat.clone() : g.fletchMat;
  if (color != null) fletchMat.color.set(color).lerp(WHITE_REF, 0.18);
  group.userData.fletchMat = color != null ? fletchMat : null;

  for (let i = 0; i < 3; i++) {
    const fletch = new THREE.Mesh(g.fletch, fletchMat);
    fletch.position.set(0, -L / 2 + 0.075, 0.012);
    const holder = new THREE.Group();
    holder.rotation.y = (i * Math.PI * 2) / 3;
    holder.add(fletch);
    group.add(holder);
  }
  return group;
}

/** Branco de referência: a empena é clareada para não sumir contra o alvo. */
const WHITE_REF = new THREE.Color(1, 1, 1);

/* ------------------------------------------------------------- incendiária -- */

let sharedFire = null;

/**
 * A parte acesa de uma flecha incendiária: só a labareda emissiva.
 *
 * Sem `PointLight`: em multiplayer, cada flecha (inclusive a dos amigos) gerava
 * uma luz dinâmica a mais, e dezenas de `MeshStandardMaterial` recalculavam
 * iluminação por fragmento — o gargalo que sobrevivia ao preset `low`. A chama
 * em `MeshBasicMaterial` continua legível no escuro; quem precisa enxergar além
 * das tochas usa o círculo de luz central do quadrado.
 */
function buildFireParts() {
  if (!sharedFire) {
    sharedFire = {
      // Cone invertido: a labareda se arrasta PARA TRÁS da ponta, ao longo do
      // eixo local -Y, que é o rastro que o olho espera de algo em voo.
      chama: new THREE.ConeGeometry(0.045, 0.34, 6, 1, true),
      material: new THREE.MeshBasicMaterial({
        color: 0xffa63a,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: false,
      }),
    };
    sharedFire.chama.rotateX(Math.PI); // ponta da chama para -Y
  }
  const material = sharedFire.material.clone();
  const chama = new THREE.Mesh(sharedFire.chama, material);
  chama.position.y = CONFIG.arrow.length / 2 - 0.1;
  chama.renderOrder = 6;

  return { chama, material };
}

/* ---------------------------------------------------------------- flecha -- */

let nextArrowId = 1;

export class Arrow {
  constructor(
    scene,
    physics,
    sync,
    origin,
    direction,
    speed,
    trail = null,
    ownerEntityId = null,
    visualOnly = false,
    color = null,
  ) {
    this.id = nextArrowId++;
    this.ownerEntityId = ownerEntityId;
    /**
     * Flecha de outro jogador: voa, desenha o traçado e não resolve colisão
     * nenhuma.
     *
     * Quem atirou é a autoridade sobre o próprio acerto. Se esta cópia também
     * resolvesse contatos, ela cravaria onde a simulação DESTA máquina achou —
     * alguns centímetros à frente ou atrás — e o mesmo tiro teria dois destinos
     * diferentes em duas telas. Ela voa só para ser vista, e o `impact` do dono
     * diz onde ela para.
     */
    this.visualOnly = visualOnly;
    this.physics = physics;
    this.sync = sync;
    this.scene = scene;
    this.trail = trail;
    this.stuck = false;
    this.dead = false;
    /** Entidade que acompanha a flecha enquanto ela está cravada. */
    this.attachedTo = null;
    this.age = 0;

    // Telemetria para HUD e depuração.
    this.launchSpeed = speed;
    this.launchPosition = origin.clone();
    this.apex = origin.y;
    this.flightTime = 0;
    this.lastSpeed = speed;
    this.lastDragForce = 0;
    if (this.trail) this.trail.push(origin.x, origin.y, origin.z);

    this.mesh = buildArrowMesh(color);
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
      .setCcdEnabled(true); // a 120 m/s a flecha anda 1 m por passo
    this.body = physics.createBody(bodyDesc);

    const half = CONFIG.arrow.length / 2 - CONFIG.arrow.shaftRadius * 1.5;
    const colliderDesc = RAPIER.ColliderDesc.capsule(
      half,
      CONFIG.arrow.shaftRadius * 1.5,
    )
      .setMass(CONFIG.arrow.mass)
      .setFriction(0.6)
      .setRestitution(0.0);

    if (visualOnly) {
      // Grupo 0: não colide com nada. A massa e o arrasto continuam valendo, e
      // é isso que importa — a curva precisa ser a mesma, só o desfecho é que
      // vem do dono.
      colliderDesc.setCollisionGroups(0);
      this.collider = physics.createCollider(colliderDesc, this.body);
    } else {
      colliderDesc.setCollisionGroups(ARROW_COLLISION_GROUPS);
      colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.collider = physics.createCollider(colliderDesc, this.body);
      physics.register(this.collider, { kind: "arrow", arrow: this });
    }

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
    /** Âncora da câmera da flecha no impacto (antes do alvo se mover). */
    this.stickCamAnchor = null;
    this.stickCamForward = null;
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
    const wx = options.windInfluence ? wind.x : 0;
    const wy = options.windInfluence ? wind.y : 0;
    const wz = options.windInfluence ? wind.z : 0;
    this._vrel.set(v.x - wx, v.y - wy, v.z - wz);
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
  stick(otherBody, isDynamic, attachment = null) {
    if (this.stuck) return;
    this.stuck = true;
    this.attachedTo = attachment;

    const t = this.body.translation();
    this.stickCamAnchor = new THREE.Vector3(t.x, t.y, t.z);
    this.stickCamForward = this.lastVelocity.clone();
    if (this.stickCamForward.lengthSq() < 1e-4) {
      const r = this.body.rotation();
      this.stickCamForward.copy(UP).applyQuaternion(
        new THREE.Quaternion(r.x, r.y, r.z, r.w),
      );
    }
    this.stickCamForward.normalize();

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
    this.collider.setEnabled(false);
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

  /**
   * Encaixa a flecha na pose exata que o DONO reportou e crava.
   *
   * É o fecho do modelo: a curva foi recalculada aqui e chegou perto, mas os
   * últimos centímetros vêm de quem atirou — senão a mesma flecha ficaria em
   * dois lugares diferentes em duas telas. O salto é de centímetros e acontece
   * meio ping depois do impacto: ninguém vê.
   */
  snapTo(
    position,
    rotation,
    otherBody = null,
    isDynamic = false,
    attachment = null,
  ) {
    if (this.stuck || this.dead) return;
    this.body.setTranslation(position, true);
    if (rotation) this.body.setRotation(rotation, true);
    this.mesh.position.set(position.x, position.y, position.z);
    if (rotation) {
      this.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
    this.stick(otherBody, isDynamic, attachment);
    this.sync.snap(this.body);
  }

  /** Acende a flecha. Chamado pelo gerenciador quando o modo pede fogo. */
  ignite() {
    if (this.fire) return;
    this.fire = buildFireParts();
    this.mesh.add(this.fire.chama);
    this.fireAge = 0;
  }

  /**
   * O fogo treme enquanto voa e se apaga depois de cravar.
   *
   * Cravada, a flecha vira uma tocha fraquinha por alguns segundos antes de
   * morrer. É um detalhe barato com efeito de jogo real: um tiro perdido no
   * escuro deixa uma brasa marcando onde ele foi parar.
   */
  updateFire(dt) {
    if (!this.fire) return;
    this.fireAge += dt;

    const t = this.fireAge;
    const tremor = 0.82 + 0.12 * Math.sin(t * 31) + 0.06 * Math.sin(t * 47);

    if (this.stuck) {
      // Cravada: some em 4 s — só brasa visual, sem luz dinâmica.
      const p = Math.min(1, (this.stuckAge = (this.stuckAge ?? 0) + dt) / 4);
      const f = (1 - p) * tremor;
      this.fire.material.opacity = 0.9 * f;
      this.fire.chama.scale.setScalar(0.6 + f * 0.5);
      if (p >= 1) this.extinguish();
      return;
    }

    this.fire.material.opacity = 0.9;
    // Em voo a labareda estica: quanto mais rápido, mais longo o rastro.
    const v = this.lastVelocity;
    const rapidez = Math.min(1, Math.hypot(v.x, v.y, v.z) / 80);
    this.fire.chama.scale.set(tremor, 0.7 + rapidez * 1.9, tremor);
  }

  extinguish() {
    if (!this.fire) return;
    this.mesh.remove(this.fire.chama);
    this.fire.material.dispose();
    this.fire = null;
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.extinguish();
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
    /* Geometrias e materiais da flecha são compartilhados entre todas as
       instâncias — com UMA exceção: quando a flecha tem dono, o material da
       empena é um clone tingido com a cor dele (ver `buildArrowMesh`). Esse é
       desta flecha e morre com ela; sem isto, uma partida longa deixaria um
       material vazando por disparo. */
    this.mesh.userData.fletchMat?.dispose();
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
    this.options = {
      dragEnabled: true,
      aeroStabilization: true,
      windInfluence: true,
    };
    /* Flechas incendiárias. Ligado só pelo modo zumbi — ver `systems/torches.js`
       para a razão de o fogo ser fonte de luz e não enfeite. */
    this.fireArrows = false;
    this._noWind = new THREE.Vector3();

    this.onScore = null;
    this.onMiss = null;
    this.onCharacterHit = null;

    this.lastArrow = null;

    // UM callback antes de cada passo para todas as flechas: menos indireção.
    this.stepCallback = (h) => {
      const w = this.options.windInfluence ? this.wind.vector : this._noWind;
      for (const arrow of this.live) arrow.applyAerodynamics(h, w, this.options);
    };
    physics.beforeStep.add(this.stepCallback);

    this.contactCallback = (contact) => this.handleContact(contact);
    physics.onContact.add(this.contactCallback);

    this.impactPuffs = [];
  }

  /**
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} direction unitário
   * @param {number} speed m/s
   * @param {object} [options]
   * @param {number|string|null} [options.ownerEntityId] quem atirou
   * @param {number} [options.trailColor] cor do traçado (a do dono, em rede)
   * @param {boolean} [options.visualOnly] flecha de outro jogador: só voa
   */
  spawn(origin, direction, speed, options = {}) {
    const {
      ownerEntityId = null,
      trailColor = CONFIG.trail.color,
      visualOnly = false,
    } = options;

    // O novo tiro ganha o seu traçado e o `TrailManager` inicia o fade do
    // traçado anterior do mesmo dono. O disparo de um jogador não apaga o
    // traçado atual dos outros jogadores.
    const arrow = new Arrow(
      this.scene,
      this.physics,
      this.sync,
      origin,
      direction,
      speed,
      this.trails ? this.trails.create(ownerEntityId, trailColor) : null,
      ownerEntityId,
      visualOnly,
      // A empena leva a cor do dono, como o traçado. Ver `buildArrowMesh`.
      ownerEntityId != null ? trailColor : null,
    );
    this.live.push(arrow);
    // Vale para as flechas dos OUTROS também: ver o amigo riscar o escuro com
    // fogo do outro lado do quadrado é metade da graça do modo.
    if (this.fireArrows) arrow.ignite();
    // A câmera de acompanhamento só segue as SUAS flechas.
    if (!visualOnly) this.lastArrow = arrow;
    return arrow;
  }

  handleContact({ a, b, point, normal }) {
    const arrowOwner = a?.kind === "arrow" ? a : b?.kind === "arrow" ? b : null;
    if (!arrowOwner) return;
    const arrow = arrowOwner.arrow;
    if (arrow.stuck || arrow.dead) return;

    const other = arrowOwner === a ? b : a;

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

    const result = resolveArrowHit({
      arrow,
      other,
      impact,
      normal,
      deps: {
        onScore: this.onScore,
        onMiss: this.onMiss,
        onCharacterHit: this.onCharacterHit,
        spawnPuff: (p, n) => this.spawnPuff(p, n),
        retireArrow: (a) => this.retire(a),
        removeArrow: (a) => this.remove(a),
      },
    });

    if (result?.kind === "character" && this.onCharacterHit) {
      this.onCharacterHit(result.entityId, arrow);
    }
  }

  /**
   * Passa a flecha de "em voo" para "cravada" e faz a reciclagem do pool.
   *
   * A cota é POR DONO: quem atira mais rápido não apaga as flechas de ninguém.
   * O teto global é só uma trava de memória, não o critério normal de descarte.
   */
  retire(arrow) {
    const i = this.live.indexOf(arrow);
    if (i >= 0) this.live.splice(i, 1);
    this.stuck.push(arrow);

    const { maxStuckPerPlayer, maxStuckTotal } = CONFIG.arrow;
    const owner = arrow.ownerEntityId;

    let mine = 0;
    for (const a of this.stuck) if (a.ownerEntityId === owner) mine++;
    for (let k = 0; k < this.stuck.length && mine > maxStuckPerPlayer; k++) {
      if (this.stuck[k].ownerEntityId !== owner) continue;
      this.stuck.splice(k, 1)[0].dispose();
      k--;
      mine--;
    }

    while (this.stuck.length > maxStuckTotal) this.stuck.shift().dispose();
  }

  /**
   * Tira a flecha de cena imediatamente, sem passar por "cravada".
   *
   * É o caminho de quem acertou algo que DESAPARECE no impacto — hoje só o alvo
   * da série, que explode. Não é o mesmo que `retire`: aquele guarda a flecha
   * no mundo, este a apaga.
   */
  remove(arrow) {
    const i = this.live.indexOf(arrow);
    if (i >= 0) this.live.splice(i, 1);
    const j = this.stuck.indexOf(arrow);
    if (j >= 0) this.stuck.splice(j, 1);
    if (this.lastArrow === arrow) this.lastArrow = null;
    arrow.dispose();
  }

  /**
   * Remove flechas presas a uma entidade que está saindo do mundo.
   *
   * É importante fazer isso antes de remover o corpo do alvo: uma flecha
   * dinâmica presa por joint não pode continuar viva depois que o outro corpo
   * desaparece, senão ela cai ou fica suspensa no ponto do último frame.
   */
  removeAttachedTo(target) {
    if (!target) return;
    for (const lista of [this.stuck, this.live]) {
      for (let i = lista.length - 1; i >= 0; i--) {
        if (lista[i].attachedTo !== target) continue;
        const arrow = lista.splice(i, 1)[0];
        if (this.lastArrow === arrow) this.lastArrow = null;
        arrow.dispose();
      }
    }
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const arrow = this.live[i];
      arrow.age += dt;
      arrow.recordTrace();
      const t = arrow.body.translation();
      const tooOld = arrow.age > CONFIG.arrow.maxLifetime;
      /* Os limites saem do TAMANHO DO MUNDO, não de números soltos: se o
         cenário cresce, o descarte cresce junto, e uma flecha nunca é apagada
         ainda por cima de terreno que existe.
         O teto em Y é o que faltava — sem ele, um tiro para o céu ficava vivo
         o tempo de vida inteiro. */
      const W = CONFIG.world;
      const tooFar =
        t.x < W.minX ||
        t.x > W.maxX ||
        t.z < W.minZ ||
        t.z > W.maxZ ||
        t.y < -30 ||
        t.y > CONFIG.arrow.maxAltitude;
      if (tooOld || tooFar) {
        this.live.splice(i, 1);
        arrow.dispose();
        continue;
      }
      arrow.updateFire(dt);
    }
    // As cravadas também: é o fogo delas que vira brasa marcando onde caíram.
    for (const arrow of this.stuck) arrow.updateFire(dt);
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

  /**
   * Limpa flechas e traçados. Sem argumento limpa tudo; com um dono, só as
   * dele — é assim que a tecla de limpar se comporta no multiplayer, para você
   * arrumar a sua bagunça sem apagar o tiro que o amigo acabou de dar.
   */
  clearAll(ownerId = undefined) {
    const mine = (a) => ownerId === undefined || a.ownerEntityId === ownerId;

    for (let i = this.stuck.length - 1; i >= 0; i--) {
      if (mine(this.stuck[i])) this.stuck.splice(i, 1)[0].dispose();
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (mine(this.live[i])) this.live.splice(i, 1)[0].dispose();
    }
    if (this.lastArrow?.dead) this.lastArrow = null;
    if (this.trails) this.trails.clear(ownerId);
  }
}
