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
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { resolveArrowHit } from "../core/hitResolver.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { ARROW_COLLISION_GROUPS } from "../core/collisionGroups.js";

const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------- geometria --

   UMA FLECHA SÃO DUAS MALHAS, e antes eram seis.

   Haste, ponta, nó e três empenas: cada uma era um `Mesh` com material próprio,
   porque cada uma tem cor e acabamento próprios. Seis chamadas de desenho por
   flecha é barato quando há três no ar — e é a maior conta da tela quando há
   cento e quinze. No cerco, com dois arqueiros de CPU no muro e cravadas se
   acumulando, foi medido: **666 chamadas por quadro, e mais de quinhentas eram
   flecha**. No vale o efeito é o mesmo, só chega mais tarde.

   A fusão é possível porque as peças são RÍGIDAS entre si — a flecha não
   articula. O que impedia era a cor: `mergeGeometries` exige um material só, e
   as quatro peças têm quatro. A saída é a que o Three já oferece e ninguém
   estava usando aqui: COR POR VÉRTICE. A haste, a ponta e o nó viram uma
   geometria só com um atributo `color`, e um único `MeshStandardMaterial` com
   `vertexColors` desenha as três.

   As empenas ficam de fora do lote, e não por descuido: elas levam a cor de
   QUEM ATIROU (§5A.6 do plano), que muda por flecha. Assá-la no vértice
   obrigaria a clonar a geometria por dono — trocaria chamada de desenho por
   memória, que é o negócio errado. Elas viram uma segunda malha, com as três
   empenas fundidas e o material buscado num cache por cor.

   O ACABAMENTO É O CUSTO. Um material só significa um `roughness` e um
   `metalness` só, e a ponta era o brilho mais forte do jogo (aço quase espelho,
   contra a madeira fosca da haste). O meio-termo mantém a haste fosca e devolve
   o lampejo por outro caminho: a ponta fica bem mais CLARA na cor por vértice.
   O que se lê a oitenta metros é o contraste, não o expoente especular.
   6 → 2 chamadas por flecha. */

let sharedArrowGeometry = null;

/** Materiais de empena por cor do dono. Numa sala de seis são seis, não sessenta. */
const FLETCH_MATS = new Map();

function fletchMaterialFor(color, base) {
  if (color == null) return base;
  let m = FLETCH_MATS.get(color);
  if (!m) {
    m = base.clone();
    m.color.set(color).lerp(WHITE_REF, 0.18);
    FLETCH_MATS.set(color, m);
  }
  return m;
}

/** Pinta uma geometria inteira de uma cor, no atributo `color`. */
function tingir(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const cores = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cores[i * 3] = c.r;
    cores[i * 3 + 1] = c.g;
    cores[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cores, 3));
  return geo;
}

/** @param {number|null} color cor do dono; null = uniforme padrão da flecha */
function buildArrowMesh(color = null) {
  if (!sharedArrowGeometry) {
    const L = CONFIG.arrow.length;
    const r = CONFIG.arrow.shaftRadius;

    const m4 = new THREE.Matrix4();
    /* A HASTE, a PONTA e o NÓ, já posicionados e fundidos. As posições saem de
       onde estavam os `position` dos `Mesh` antigos — assar a transformação na
       geometria é o que permite compartilhá-la entre todas as flechas. */
    const haste = tingir(new THREE.CylinderGeometry(r, r, L, 7), "#c9b58c");
    const ponta = tingir(new THREE.ConeGeometry(r * 2.1, 0.055, 7), "#d8dde3")
      .applyMatrix4(m4.makeTranslation(0, L / 2 + 0.027, 0));
    const no = tingir(new THREE.CylinderGeometry(r * 1.7, r * 1.7, 0.02, 6), "#2b2b30")
      .applyMatrix4(m4.makeTranslation(0, -L / 2 + 0.01, 0));
    const corpo = mergeGeometries([haste, ponta, no], false);
    haste.dispose();
    ponta.dispose();
    no.dispose();

    /* As TRÊS EMPENAS, fundidas entre si. A cor vem do material, não do
       vértice — ver o cabeçalho. */
    const penas = [];
    for (let i = 0; i < 3; i++) {
      const p = new THREE.PlaneGeometry(0.021, 0.08);
      p.applyMatrix4(m4.makeTranslation(0, -L / 2 + 0.075, 0.012));
      p.applyMatrix4(m4.makeRotationY((i * Math.PI * 2) / 3));
      penas.push(p);
    }
    const empena = mergeGeometries(penas, false);
    for (const p of penas) p.dispose();

    sharedArrowGeometry = {
      corpo,
      empena,
      corpoMat: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.25,
      }),
      fletchMat: new THREE.MeshStandardMaterial({
        color: "#d6483c",
        roughness: 0.85,
        side: THREE.DoubleSide,
      }),
    };
  }
  const g = sharedArrowGeometry;
  // Eixo local +Y = da empena para a ponta. O colisor cápsula usa o mesmo eixo,
  // então visual e física nunca divergem.
  const group = new THREE.Group();

  const corpo = new THREE.Mesh(g.corpo, g.corpoMat);
  corpo.castShadow = true;
  group.add(corpo);

  /* A EMPENA LEVA A COR DE QUEM ATIROU (Fase 5A.6 do plano) — e é a única
   * peça que precisa variar: numa flecha cravada no alvo, a três centímetros
   * de outra, é a cor dela que diz de quem foi o tiro.
   *
   * O material vem do CACHE POR COR e não de um `clone()` por flecha. Clonar
   * por flecha dava um material por projétil — com cento e quinze em cena são
   * cento e quinze programas de sombreamento a validar por quadro, para seis
   * cores diferentes. `userData.fletchMat` fica nulo justamente porque o
   * material não pertence mais à flecha: destruí-lo com ela apagaria a empena
   * de todas as outras do mesmo dono. */
  group.add(new THREE.Mesh(g.empena, fletchMaterialFor(color, g.fletchMat)));
  group.userData.fletchMat = null;
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
    /* NADA A DEVOLVER. Geometrias e materiais da flecha são todos
       compartilhados — inclusive o da empena, que antes era um clone por
       disparo e hoje vem do cache por cor de `fletchMaterialFor`. Destruí-lo
       aqui apagaria a empena de todas as outras flechas do mesmo dono. O cache
       tem o tamanho da sala, não o do histórico de tiros. */
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
    /** Cravadas que estão APAGANDO. Ver `fadeOut`. */
    this.fading = [];
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

    /* A MAIS VELHA DESAPARECE, e desaparece APAGANDO.
     *
     * Antes ela sumia num quadro só, e num modo em que se atira sem parar isso
     * aparece como flechas piscando fora de cena no canto do olho. `fadeOut`
     * marca a flecha para encolher e sumir em `updateFade` — ela sai da cota
     * na hora (a contagem é do que ainda conta como cravado) e da cena um
     * segundo depois. */
    let mine = 0;
    for (const a of this.stuck) if (a.ownerEntityId === owner) mine++;
    for (let k = 0; k < this.stuck.length && mine > maxStuckPerPlayer; k++) {
      if (this.stuck[k].ownerEntityId !== owner) continue;
      this.fadeOut(this.stuck.splice(k, 1)[0]);
      k--;
      mine--;
    }

    while (this.stuck.length > maxStuckTotal) this.fadeOut(this.stuck.shift());
  }

  /**
   * Põe uma flecha cravada para APAGAR em vez de sumir num quadro.
   *
   * O material é compartilhado entre flechas (é o mesmo `MeshStandardMaterial`
   * para todas), então não dá para baixar a opacidade dele sem apagar as
   * outras junto. O que encolhe é a ESCALA — de graça, sem material novo, e a
   * leitura é a mesma: a flecha se apaga em vez de piscar para fora da cena.
   */
  fadeOut(arrow) {
    if (!arrow || arrow.fading) return;
    arrow.fading = 0;
    this.fading.push(arrow);
  }

  updateFade(dt) {
    if (!this.fading.length) return;
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const a = this.fading[i];
      a.fading += dt;
      const f = 1 - Math.min(1, a.fading / 0.8);
      a.group?.scale.setScalar(f);
      if (f > 0) continue;
      this.fading.splice(i, 1);
      if (this.lastArrow === a) this.lastArrow = null;
      a.dispose();
    }
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
    for (const lista of [this.stuck, this.live, this.fading]) {
      for (let i = lista.length - 1; i >= 0; i--) {
        if (lista[i].attachedTo !== target) continue;
        const arrow = lista.splice(i, 1)[0];
        if (this.lastArrow === arrow) this.lastArrow = null;
        arrow.dispose();
      }
    }
  }

  update(dt) {
    this.updateFade(dt);
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
    // As que estavam apagando somem junto: uma flecha meio transparente
    // sobrevivendo a um "limpar tudo" é a definição de sobra.
    for (let i = this.fading.length - 1; i >= 0; i--) {
      if (mine(this.fading[i])) this.fading.splice(i, 1)[0].dispose();
    }
    if (this.lastArrow?.dead) this.lastArrow = null;
    if (this.trails) this.trails.clear(ownerId);
  }
}
