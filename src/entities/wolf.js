/* ---------------------------------------------------------------------------
   Lobo — quadrúpede articulado, agressivo e assustador.

   Referência: cinza-carvão, snarl, olhos laranja, juba, patas com dedos.
   Cauda longa só obedece gravidade (reta ao correr, ponta cai parado).
   Backup: wolf.backup.js.

   PERFORMANCE: geometrias compartilhadas; olhos BasicMaterial (fog: false).
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
    color: "#3a3f48",
    roughness: 0.94,
    metalness: 0.02,
  }),
  furLight: new THREE.MeshStandardMaterial({
    color: "#5c636d",
    roughness: 0.9,
    metalness: 0.02,
  }),
  dark: new THREE.MeshStandardMaterial({
    color: "#22252a",
    roughness: 1.0,
  }),
  mane: new THREE.MeshStandardMaterial({
    color: "#2e3238",
    roughness: 0.98,
  }),
  muzzle: new THREE.MeshStandardMaterial({
    color: "#2a2824",
    roughness: 0.92,
  }),
  mouth: new THREE.MeshStandardMaterial({
    color: "#7a1a1a",
    roughness: 0.8,
  }),
  tongue: new THREE.MeshStandardMaterial({
    color: "#a82828",
    roughness: 0.55,
  }),
  gums: new THREE.MeshStandardMaterial({
    color: "#5a2020",
    roughness: 0.75,
  }),
  teeth: new THREE.MeshStandardMaterial({
    color: "#f0ebe3",
    roughness: 0.35,
    metalness: 0.08,
  }),
  claw: new THREE.MeshStandardMaterial({
    color: "#141618",
    roughness: 0.95,
  }),
  eye: new THREE.MeshBasicMaterial({
    color: CONFIG.modes.zombie.wolfEyeColor ?? 0xff8c28,
    fog: false,
  }),
};

let SHARED = null;
let SHARED_H = 0;

/** Canino longo e afiado (cone alongado). */
function makeCanine(len, rBase) {
  const g = new THREE.ConeGeometry(rBase, len, 6);
  g.rotateX(Math.PI);
  return g;
}

/** Dente molar/premolar — prisma triangular. */
function makeMolar(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  // ponta ligeiramente mais estreita via scale no topo não é trivial em box;
  // shape trapezoidal aproximada basta no close-up do snarl.
  return g;
}

function buildShared() {
  const h = H();
  if (SHARED && SHARED_H === h) return SHARED;
  SHARED_H = h;

  const torso = new THREE.SphereGeometry(0.4, 10, 8);
  torso.scale(1.2, 0.78, 1.65);
  torso.translate(0, h * 0.54, 0.04);

  const peito = new THREE.SphereGeometry(0.3, 8, 6);
  peito.scale(1.15, 0.88, 1.05);
  peito.translate(0, h * 0.5, 0.42);

  const garupa = new THREE.SphereGeometry(0.32, 8, 6);
  garupa.scale(1.2, 0.82, 1.1);
  garupa.translate(0, h * 0.52, -0.42);

  const jubaL = new THREE.SphereGeometry(0.14, 6, 5);
  jubaL.scale(1.2, 1.8, 0.9);
  jubaL.translate(-0.22, h * 0.62, 0.18);
  const jubaR = jubaL.clone();
  jubaR.translate(0.44, 0, 0);
  const jubaTop = new THREE.SphereGeometry(0.12, 6, 5);
  jubaTop.scale(2.2, 1.4, 0.8);
  jubaTop.translate(0, h * 0.68, 0.12);
  const jubaChest = new THREE.SphereGeometry(0.11, 6, 5);
  jubaChest.scale(1.8, 1.5, 0.7);
  jubaChest.translate(0, h * 0.48, 0.35);

  const corpo = mergeGeometries([torso, peito, garupa]);
  const juba = mergeGeometries([jubaL, jubaR, jubaTop, jubaChest]);

  const olhos = mergeGeometries(
    [-1, 1].map((lado) => {
      const g = new THREE.SphereGeometry(0.045, 6, 5);
      g.translate(lado * 0.11, 0.1, 0.2);
      return g;
    }),
  );

  // --- arcada dentária superior (mesclada) --------------------------------
  const upperParts = [];
  // Caninos superiores — longos, laterais, ponta para baixo.
  for (const lado of [-1, 1]) {
    const c = makeCanine(0.1, 0.018);
    c.translate(lado * 0.048, -0.02, 0.36);
    upperParts.push(c);
  }
  // Incisivos centrais (pequenos, frente).
  for (let i = -1; i <= 1; i++) {
    const inc = makeMolar(0.014, 0.032, 0.016);
    inc.translate(i * 0.018, -0.01, 0.42);
    upperParts.push(inc);
  }
  // Pré-molares ao longo do focinho.
  for (let i = 0; i < 3; i++) {
    for (const lado of [-1, 1]) {
      const m = makeMolar(0.016, 0.038 + i * 0.004, 0.02);
      m.translate(lado * (0.04 + i * 0.008), -0.012, 0.32 - i * 0.045);
      upperParts.push(m);
    }
  }
  const upperTeeth = mergeGeometries(upperParts);

  // --- arcada inferior ----------------------------------------------------
  const lowerParts = [];
  for (const lado of [-1, 1]) {
    const c = makeCanine(0.085, 0.016);
    c.translate(lado * 0.042, 0.02, 0.3);
    lowerParts.push(c);
  }
  for (let i = -1; i <= 1; i++) {
    const inc = makeMolar(0.012, 0.028, 0.014);
    inc.translate(i * 0.016, 0.015, 0.34);
    lowerParts.push(inc);
  }
  for (let i = 0; i < 3; i++) {
    for (const lado of [-1, 1]) {
      const m = makeMolar(0.014, 0.032 + i * 0.003, 0.018);
      m.translate(lado * (0.036 + i * 0.006), 0.012, 0.26 - i * 0.04);
      lowerParts.push(m);
    }
  }
  const lowerTeeth = mergeGeometries(lowerParts);

  // Pata: 4 dedos + garras.
  const dedos = [];
  for (const lado of [-1.2, -0.4, 0.4, 1.2]) {
    const garra = new THREE.ConeGeometry(0.01, 0.05, 4);
    garra.rotateX(Math.PI);
    garra.translate(lado * 0.018, -0.018, -0.045);
    dedos.push(garra);
    const dedo = new THREE.BoxGeometry(0.016, 0.022, 0.038);
    dedo.translate(lado * 0.018, 0.008, -0.018);
    dedos.push(dedo);
  }
  const palm = new THREE.BoxGeometry(0.09, 0.032, 0.1);
  palm.translate(0, 0.018, 0.012);
  dedos.push(palm);
  const pata = mergeGeometries(dedos);

  SHARED = { corpo, juba, olhos, upperTeeth, lowerTeeth, pata };
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
    /** Quão "deitado" está o rabo (0 = reto atrás, 1 = ponta no chão). */
    this.tailSag = 1;

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
      RAPIER.ColliderDesc.capsule(hh / 2 - 0.22, 0.32).setActiveEvents(
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
    this.lodDetail = [];
    this.lodBulk = [];

    root.rotation.x = 0.12;

    this.corpo = new THREE.Mesh(S.corpo, MAT.fur);
    this.corpo.castShadow = true;
    root.add(this.corpo);
    this.lodBulk.push(this.corpo);

    const jubaMesh = new THREE.Mesh(S.juba, MAT.mane);
    jubaMesh.castShadow = true;
    root.add(jubaMesh);
    this.lodBulk.push(jubaMesh);

    const highlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.04, 0.9),
      MAT.furLight,
    );
    highlight.position.set(0, h * 0.62, 0.05);
    highlight.castShadow = true;
    root.add(highlight);
    this.lodDetail.push(highlight);

    this.neck = new THREE.Group();
    this.neck.position.set(0, h * 0.58, 0.5);
    root.add(this.neck);

    const pescoco = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.17, 0.38, 7),
      MAT.fur,
    );
    pescoco.rotation.x = -0.55;
    pescoco.position.set(0, 0.06, 0.1);
    pescoco.castShadow = true;
    this.neck.add(pescoco);

    this.head = new THREE.Group();
    this.head.position.set(0, 0.14, 0.28);
    this.neck.add(this.head);

    const cranio = new THREE.Mesh(new THREE.SphereGeometry(0.17, 9, 7), MAT.fur);
    cranio.scale.set(0.95, 0.92, 1.25);
    cranio.castShadow = true;
    this.head.add(cranio);

    // Sobrancelha franzida — olhar agressivo.
    for (const lado of [-1, 1]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.04), MAT.dark);
      brow.position.set(lado * 0.1, 0.14, 0.16);
      brow.rotation.z = lado * -0.35;
      brow.rotation.x = -0.3;
      this.head.add(brow);
      this.lodDetail.push(brow);
    }

    const focinho = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.095, 0.4, 8),
      MAT.muzzle,
    );
    focinho.rotation.x = Math.PI / 2;
    focinho.position.set(0, -0.03, 0.3);
    focinho.castShadow = true;
    this.head.add(focinho);

    const nariz = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), MAT.dark);
    nariz.position.set(0, -0.01, 0.5);
    this.head.add(nariz);

    // Boca aberta — gengiva, interior e língua.
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.05, 0.2);
    this.head.add(this.jaw);

    const gengivaSup = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.22), MAT.gums);
    gengivaSup.position.set(0, -0.02, 0.28);
    this.head.add(gengivaSup);
    this.lodDetail.push(gengivaSup);

    const bocaInt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.22), MAT.mouth);
    bocaInt.position.set(0, -0.02, 0.12);
    this.jaw.add(bocaInt);

    const lingua = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.028, 0.12, 3, 5),
      MAT.tongue,
    );
    lingua.rotation.x = Math.PI / 2;
    lingua.position.set(0, -0.01, 0.16);
    this.jaw.add(lingua);
    this.lodDetail.push(lingua);

    const mandibula = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.045, 0.22),
      MAT.muzzle,
    );
    mandibula.position.set(0, -0.055, 0.1);
    this.jaw.add(mandibula);

    const gengivaInf = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.18), MAT.gums);
    gengivaInf.position.set(0, -0.02, 0.14);
    this.jaw.add(gengivaInf);
    this.lodDetail.push(gengivaInf);

    // Dentes mesclados (arcadas inteiras).
    const upperMesh = new THREE.Mesh(S.upperTeeth, MAT.teeth);
    upperMesh.castShadow = true;
    this.head.add(upperMesh);
    this.lodDetail.push(upperMesh);

    const lowerMesh = new THREE.Mesh(S.lowerTeeth, MAT.teeth);
    lowerMesh.castShadow = true;
    this.jaw.add(lowerMesh);
    this.lodDetail.push(lowerMesh);

    this.olhos = new THREE.Mesh(S.olhos, MAT.eye);
    this.olhos.frustumCulled = false;
    this.olhos.renderOrder = 4;
    this.head.add(this.olhos);

    for (const lado of [-1, 1]) {
      const orelha = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.2, 5), MAT.dark);
      orelha.position.set(lado * 0.11, 0.17, -0.06);
      orelha.rotation.z = lado * 0.45;
      orelha.rotation.x = -0.25;
      this.head.add(orelha);
    }

    // Pernas: coxa → joelho → canela → pata.
    this.legs = [];
    const legY = h * 0.46;
    const places = [
      { x: -0.2, z: 0.34, frente: true },
      { x: 0.2, z: 0.34, frente: true },
      { x: -0.2, z: -0.38, frente: false },
      { x: 0.2, z: -0.38, frente: false },
    ];
    for (const p of places) {
      const leg = new THREE.Group();
      leg.position.set(p.x, legY, p.z);

      const coxa = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.06, 0.2, 3, 5),
        MAT.dark,
      );
      coxa.position.y = -0.12;
      coxa.castShadow = true;
      leg.add(coxa);

      const joelho = new THREE.Group();
      joelho.position.y = -0.24;
      leg.add(joelho);

      const canela = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.045, 0.18, 3, 5),
        MAT.fur,
      );
      canela.position.y = -0.1;
      canela.castShadow = true;
      joelho.add(canela);

      const paw = new THREE.Group();
      paw.position.set(0, -0.22, 0.02);
      joelho.add(paw);

      const pawMesh = new THREE.Mesh(S.pata, MAT.claw);
      pawMesh.castShadow = true;
      paw.add(pawMesh);

      root.add(leg);
      this.legs.push({ group: leg, joelho, paw, frente: p.frente });
      this.lodBulk.push(leg);
    }

    /* Cauda LONGA e articulada (6 segmentos). Sem wag lateral — só gravidade
       no animate(): correndo fica reta para trás; parado a ponta cai. */
    this.tailRoot = new THREE.Group();
    this.tailRoot.position.set(0, h * 0.54, -0.55);
    root.add(this.tailRoot);
    this.tailSegments = [];
    this.tailLens = [0.28, 0.26, 0.24, 0.22, 0.2, 0.16];
    const radii = [0.085, 0.075, 0.062, 0.05, 0.038, 0.025];
    let parent = this.tailRoot;
    for (let i = 0; i < this.tailLens.length; i++) {
      const seg = new THREE.Group();
      if (i > 0) seg.position.z = -this.tailLens[i - 1] * 0.92;
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(radii[i], this.tailLens[i], 6),
        i < 2 ? MAT.fur : MAT.dark,
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = -this.tailLens[i] * 0.45;
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
    // Cadáver não recebe flecha nem bloqueia o mundo — senão o próximo tiro
    // "acerta" um corpo morto e o lobo vivo (servidor) segue invisível.
    this.collider?.setEnabled(false);
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "wolfDeath",
      position: vec3Payload(this.position),
      volume: 2.0,
    });
  }

  /**
   * O cliente pode ter matado por otimismo (feedback imediato do tiro). Se o
   * servidor ainda manda o lobo vivo, ele TEM de voltar — senão o mesh fica
   * tombado no chão enquanto a IA real chega e mata sem silhueta.
   */
  reviveLocal() {
    if (!this.dead) return;
    this.dead = false;
    this.state = "walk";
    this.speed = 0;
    this.deathRoll = 0;
    if (this.visualRoot) {
      this.visualRoot.rotation.z = 0;
      this.visualRoot.position.y = 0;
    }
    this.collider?.setEnabled(true);
    this.group.visible = true;
    this._lod = undefined;
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
    // Morto: rabo cai completamente.
    this.tailSag = damp(this.tailSag, 1, 6, dt);
    this.applyTailGravity();
  }

  /**
   * Cauda só por gravidade.
   * sag=0 → segmentos quase horizontais (reto para trás, correndo).
   * sag=1 → cada segmento dobra mais; a ponta pende para o chão.
   * Sem balanço lateral.
   */
  applyTailGravity() {
    if (!this.tailSegments?.length) return;
    const sag = this.tailSag;
    // Base quase alinhada com o corpo; ponta cai mais.
    for (let i = 0; i < this.tailSegments.length; i++) {
      const t = i / Math.max(1, this.tailSegments.length - 1);
      // Curva crescente: base leve, ponta bem caída quando parado.
      const drop = sag * (0.15 + t * t * 1.35);
      this.tailSegments[i].rotation.x = drop;
      this.tailSegments[i].rotation.y = 0;
      this.tailSegments[i].rotation.z = 0;
    }
  }

  animate(dt) {
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;

    const passada = 0.95;
    this.animPhase += (Math.PI * 2 * this.speed * dt) / passada + dt * 0.8;

    const andando = this.speed > 0.25;
    const ataque = this.state === "attack";
    const salto = this.state === "leap";
    const abertura = salto ? 0.4 : ataque ? 0.5 : andando ? 0.75 : 0.06;
    const swing = Math.sin(this.animPhase) * abertura;

    for (let i = 0; i < this.legs.length; i++) {
      const perna = this.legs[i];
      const fase = i === 0 || i === 3 ? 1 : -1;
      perna.group.rotation.x = fase * swing + (salto ? -0.5 : 0);

      const balanco = andando ? Math.max(0, fase * Math.sin(this.animPhase)) : 0;
      perna.joelho.rotation.x =
        (perna.frente ? -1 : 1) * balanco * abertura * 1.2 + (salto ? -0.35 : 0);
      perna.paw.rotation.x = balanco * 0.25 - 0.08;
    }

    this.neck.rotation.x = salto
      ? -0.1
      : ataque
        ? 0.65 + Math.sin(this.animPhase * 9) * 0.15
        : 0.2 + Math.sin(this.animPhase * 0.7) * 0.06;
    this.head.rotation.x = ataque ? 0.4 : Math.sin(this.animPhase * 0.5) * 0.05;
    this.jaw.rotation.x = ataque
      ? 0.35 + Math.sin(this.animPhase * 12) * 0.1
      : 0.18 + Math.sin(this.animPhase * 0.4) * 0.03;

    const bob = salto
      ? 0.18
      : Math.abs(Math.sin(this.animPhase)) * Math.min(0.07, this.speed * 0.008);
    this.corpo.position.y = bob;

    // Gravidade do rabo: velocidade alta → sag≈0 (reto); parado → sag≈1 (cai).
    const alvoSag = salto ? 0.05 : andando ? Math.max(0, 1 - this.speed / 4.5) * 0.2 : 1;
    this.tailSag = damp(this.tailSag, alvoSag, andando ? 5 : 3.5, dt);
    this.applyTailGravity();
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
