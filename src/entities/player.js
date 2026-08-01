/* ---------------------------------------------------------------------------
   A arqueira.

   O corpo é montado com primitivas e posicionado por IK de dois ossos: eu digo
   onde a mão precisa estar (o punho do arco, o nock da corda) e o cotovelo é
   resolvido geometricamente. Isso mantém a postura correta em qualquer ângulo
   de mira, sem esqueleto animado nem arquivos externos.

   Referencial: `root` fica nos pés, com -Z na direção da mira e +X à direita.
   O tronco é girado ~66° porque arqueiro atira de lado — é dessa rotação que
   nasce o enquadramento da referência (corpo à esquerda, arco no centro).
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { Bow } from "./bow.js";
import { makeSegment, orientSegment, makeJoint } from "../utils/geometry.js";
import { solveTwoBoneIK, clamp, damp } from "../utils/math.js";
import { CONFIG } from "../config.js";

/* Antropometria (m) — mulher de ~1,72 m. Não são constantes de simulação,
   por isso vivem aqui e não em config.js. */
const BODY = {
  hipY: 0.9,
  waistY: 1.06,
  chestY: 1.27,
  shoulderY: 1.42,
  shoulderX: 0.175,
  neckY: 1.5,
  headY: 1.625,
  headR: 0.107,
  upperArm: 0.28,
  foreArm: 0.26,
  thigh: 0.44,
  shin: 0.42,
  ankleY: 0.085,
  hipX: 0.105,
  stanceWidth: 0.23,
  stanceYaw: 1.16, // rad — quanto o tronco fica de lado
  armReach: 0.505, // extensão do braço do arco
};

const MAT = {
  skin: new THREE.MeshStandardMaterial({ color: "#e6ab7d", roughness: 0.72 }),
  skinDark: new THREE.MeshStandardMaterial({ color: "#d9995f", roughness: 0.75 }),
  top: new THREE.MeshStandardMaterial({ color: "#cc2f2b", roughness: 0.78 }),
  trim: new THREE.MeshStandardMaterial({ color: "#f3ede1", roughness: 0.8 }),
  shorts: new THREE.MeshStandardMaterial({ color: "#bb2724", roughness: 0.8 }),
  hair: new THREE.MeshStandardMaterial({ color: "#392015", roughness: 0.62 }),
  shoe: new THREE.MeshStandardMaterial({ color: "#efe9df", roughness: 0.7 }),
  shoeRed: new THREE.MeshStandardMaterial({ color: "#cc2f2b", roughness: 0.7 }),
};

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(terrain) {
    this.terrain = terrain;
    this.root = new THREE.Group();
    this.root.name = "archer";

    this.position = new THREE.Vector3(
      CONFIG.player.start.x,
      0,
      CONFIG.player.start.z,
    );
    this.yaw = 0; // 0 = olhando para -Z, na direção dos alvos
    this.pitch = 0;
    this.drawFraction = 0;
    this.bobPhase = 0;
    this.ponytailLag = new THREE.Vector2();
    this.prevYaw = 0;

    // Vetores reaproveitados por frame (zero alocação no loop).
    this._aim = new THREE.Vector3();
    this._shoulderR = new THREE.Vector3();
    this._shoulderL = new THREE.Vector3();
    this._hipR = new THREE.Vector3();
    this._hipL = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._knee = new THREE.Vector3();
    this._handTarget = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._idleHand = new THREE.Vector3();
    this._nock = new THREE.Vector3();
    this._tailA = new THREE.Vector3();
    this._tailB = new THREE.Vector3();
    this._tailC = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this._euler = new THREE.Euler(0, 0, 0, "YXZ");

    this.build();
    this.setAim(0, 0);
  }

  /* ----------------------------------------------------------- montagem --- */

  build() {
    // Pivô do tronco: gira em Y (postura de lado) e em X (inclinação da mira).
    this.spine = new THREE.Group();
    this.spine.position.set(0, BODY.hipY, 0);
    this.root.add(this.spine);

    /* quadril e tronco --------------------------------------------------- */
    const pelvis = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.135, 0.1, 4, 14),
      MAT.shorts,
    );
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.72);
    pelvis.position.y = 0.02;
    pelvis.castShadow = true;
    this.spine.add(pelvis);

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.152, 0.128, BODY.shoulderY - BODY.hipY - 0.02, 16),
      MAT.top,
    );
    torso.scale.set(1, 1, 0.66);
    torso.position.y = (BODY.shoulderY - BODY.hipY) / 2 + 0.02;
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.spine.add(torso);

    const waistBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.134, 0.134, 0.03, 16),
      MAT.trim,
    );
    waistBand.scale.set(1, 1, 0.68);
    waistBand.position.y = BODY.waistY - BODY.hipY - 0.09;
    this.spine.add(waistBand);

    // Ombros arredondados.
    for (const s of [-1, 1]) {
      const sh = makeJoint(0.062, MAT.top);
      sh.position.set(s * BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0);
      this.spine.add(sh);
    }

    /* pescoço e cabeça ---------------------------------------------------- */
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.043, 0.05, 0.1, 10),
      MAT.skin,
    );
    neck.position.y = BODY.neckY - BODY.hipY - 0.03;
    neck.castShadow = true;
    this.spine.add(neck);

    this.head = new THREE.Group();
    this.head.position.y = BODY.headY - BODY.hipY;
    this.spine.add(this.head);

    const skull = makeJoint(BODY.headR, MAT.skin, 18);
    skull.scale.set(0.94, 1.06, 1.0);
    this.head.add(skull);

    // Cabelo: calota + franja, com a testa livre.
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(BODY.headR * 1.05, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      MAT.hair,
    );
    hairCap.scale.set(0.98, 1.12, 1.02);
    hairCap.position.y = 0.004;
    hairCap.castShadow = true;
    this.head.add(hairCap);

    const hairBack = new THREE.Mesh(
      new THREE.SphereGeometry(BODY.headR * 1.02, 16, 12, 0, Math.PI, 0, Math.PI),
      MAT.hair,
    );
    hairBack.rotation.y = -Math.PI / 2;
    hairBack.scale.set(1.0, 1.05, 0.86);
    hairBack.position.z = 0.02;
    this.head.add(hairBack);

    // Rabo de cavalo: duas seções que balançam com atraso.
    this.ponytailRoot = new THREE.Group();
    this.ponytailRoot.position.set(0, 0.055, BODY.headR * 0.95);
    this.head.add(this.ponytailRoot);

    const tie = makeJoint(0.036, MAT.hair, 10);
    this.ponytailRoot.add(tie);

    this.ponytailA = makeSegment(0.056, MAT.hair, true, 10);
    this.ponytailRoot.add(this.ponytailA);

    this.ponytailB = new THREE.Group();
    this.ponytailRoot.add(this.ponytailB);
    this.ponytailTip = makeSegment(0.04, MAT.hair, true, 10);
    this.ponytailB.add(this.ponytailTip);

    /* braços -------------------------------------------------------------- */
    this.armR = this.buildArm(); // braço do arco
    this.armL = this.buildArm(); // braço da corda
    this.root.add(this.armR.group, this.armL.group);

    /* pernas -------------------------------------------------------------- */
    this.legR = this.buildLeg();
    this.legL = this.buildLeg();
    this.root.add(this.legR.group, this.legL.group);

    /* arco ---------------------------------------------------------------- */
    this.bow = new Bow();
    this.root.add(this.bow.group);
  }

  buildArm() {
    const group = new THREE.Group();
    const upper = makeSegment(0.057, MAT.skin, true, 12);
    const fore = makeSegment(0.047, MAT.skin, true, 12);
    const elbow = makeJoint(0.052, MAT.skin, 12);
    const hand = makeJoint(0.055, MAT.skinDark, 12);
    hand.scale.set(1, 1.15, 0.72);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.058, 0.06, 12),
      MAT.top,
    );
    band.castShadow = true;
    group.add(upper, fore, elbow, hand, band);
    return { group, upper, fore, elbow, hand, band };
  }

  buildLeg() {
    const group = new THREE.Group();
    const thigh = makeSegment(0.092, MAT.skin, true, 12);
    const shin = makeSegment(0.068, MAT.skin, true, 12);
    const knee = makeJoint(0.072, MAT.skin, 12);
    // Bermuda cobrindo a parte de cima da coxa.
    const short = makeSegment(0.105, MAT.shorts, true, 12);
    short.userData.isShort = true;

    // Tênis montado com a ponta em -Z; o grupo é girado para a direção do pé.
    const shoe = new THREE.Group();
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.05, 0.26), MAT.shoe);
    sole.position.set(0, 0.025, -0.03);
    sole.castShadow = true;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.075, 0.15), MAT.shoeRed);
    upper.position.set(0, 0.075, 0.025);
    upper.castShadow = true;
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.08), MAT.shoe);
    toe.position.set(0, 0.06, -0.115);
    shoe.add(sole, upper, toe);

    group.add(thigh, shin, knee, shoe, short);
    return { group, thigh, shin, knee, shoe, short };
  }

  /* -------------------------------------------------------------- estado --- */

  setAim(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = clamp(pitch, CONFIG.player.pitchMin, CONFIG.player.pitchMax);
  }

  setDraw(fraction) {
    this.drawFraction = clamp(fraction, 0, 1);
  }

  /** Move no plano; a altura vem do terreno. */
  move(dt, forward, strafe) {
    const speed = CONFIG.player.walkSpeed;
    const moving = forward !== 0 || strafe !== 0;
    if (moving) {
      const len = Math.hypot(forward, strafe) || 1;
      const fx = forward / len;
      const sx = strafe / len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // Frente do jogador = -Z rotacionado por yaw.
      this.position.x += (-sin * fx + cos * sx) * speed * dt;
      this.position.z += (-cos * fx - sin * sx) * speed * dt;
      this.bobPhase += dt * 7.5;
    } else {
      this.bobPhase += dt * 1.3;
    }
    // Mantém dentro do vale.
    this.position.x = clamp(this.position.x, -70, 70);
    this.position.z = clamp(this.position.z, -95, 45);
    this.position.y = this.terrain.heightAt(this.position.x, this.position.z);
    return moving;
  }

  /* --------------------------------------------------------------- pose ---- */

  update(dt, moving) {
    const bob = moving
      ? Math.sin(this.bobPhase * 2) * 0.022
      : Math.sin(this.bobPhase) * 0.006;

    this.root.position.set(this.position.x, this.position.y + bob, this.position.z);
    this.root.rotation.y = this.yaw;

    // Direção da mira no espaço do root (o yaw já está no root).
    this._aim.set(0, Math.sin(this.pitch), -Math.cos(this.pitch));

    // Tronco: postura de lado + inclinação acompanhando a mira.
    this._q.setFromAxisAngle(AXIS_X, -this.pitch * 0.42);
    this._qb.setFromAxisAngle(AXIS_Y, BODY.stanceYaw);
    this.spine.quaternion.copy(this._q).multiply(this._qb);
    this.spine.updateMatrix();

    // A cabeça compensa a rotação do tronco para olhar o alvo.
    this.head.rotation.y = -BODY.stanceYaw * 0.86;
    this.head.rotation.x = -this.pitch * 0.35;

    this.localToRoot(BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderR);
    this.localToRoot(-BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderL);
    this.localToRoot(BODY.hipX, -0.02, 0, this._hipR);
    this.localToRoot(-BODY.hipX, -0.02, 0, this._hipL);

    this.updateBow();
    this.updateArms(dt);
    this.updateLegs();
    this.updatePonytail(dt);

    this.prevYaw = this.yaw;
    this.root.updateMatrixWorld(true);
  }

  localToRoot(x, y, z, out) {
    return out.set(x, y, z).applyMatrix4(this.spine.matrix);
  }

  updateBow() {
    // Punho do arco: braço estendido a partir do ombro, na direção da mira.
    const grip = this._tmp
      .copy(this._shoulderR)
      .addScaledVector(this._aim, BODY.armReach);
    // Um leve rebaixo: a mão do arco fica um pouco abaixo da linha do ombro.
    grip.y -= 0.02;

    this.bow.group.position.copy(grip);
    // -Z do arco na direção da mira, com inclinação lateral (cant) de ~12°,
    // como na referência.
    this._euler.set(this.pitch, 0, -0.21);
    this.bow.group.quaternion.setFromEuler(this._euler);
    this.bow.setDraw(this.drawFraction);
    this.bow.setArrowVisible(true);
  }

  updateArms(dt) {
    /* braço do arco: quase reto, cotovelo girado para baixo e para fora ----- */
    const gripLocal = this.bow.group.position;
    this._pole.set(0.55, -1, 0.15).normalize();
    this.poseArm(this.armR, this._shoulderR, gripLocal, this._pole, 0.06);

    /* braço da corda: puxa o nock, cotovelo alto e para trás ---------------- */
    // Nock em coordenadas do root, direto da transformação local do arco (sem
    // depender de matrizes de mundo, que ainda não foram atualizadas).
    this._nock
      .copy(this.bow.nockPoint)
      .applyQuaternion(this.bow.group.quaternion)
      .add(this.bow.group.position);
    // Antes de tensionar, a mão descansa junto ao quadril.
    this._idleHand
      .copy(this._hipL)
      .add(this._tmp.set(-0.06, -0.16, 0.06));
    const grab = clamp(this.drawFraction * 5, 0, 1);
    this._handTarget.copy(this._idleHand).lerp(this._nock, grab);

    this._pole
      .set(0, 0.42, 1)
      .applyAxisAngle(AXIS_X, -this.pitch * 0.6)
      .normalize();
    this.poseArm(this.armL, this._shoulderL, this._handTarget, this._pole, 0.0);
  }

  poseArm(arm, shoulder, hand, pole, straighten) {
    solveTwoBoneIK(
      shoulder,
      hand,
      BODY.upperArm + straighten,
      BODY.foreArm + straighten,
      pole,
      this._elbow,
    );
    orientSegment(arm.upper, shoulder, this._elbow);
    orientSegment(arm.fore, this._elbow, hand);
    arm.elbow.position.copy(this._elbow);
    arm.hand.position.copy(hand);
    // Punheira logo antes da mão.
    arm.band.position.copy(hand).lerp(this._elbow, 0.22);
    arm.band.quaternion.copy(arm.fore.quaternion);
  }

  updateLegs() {
    // Pés afastados ao longo do eixo lateral do tronco: como o tronco está de
    // lado, a linha dos pés aponta para o alvo — a base clássica do arqueiro.
    this.footTarget(BODY.stanceWidth, this._tmp);
    this.poseLeg(this.legR, this._hipR, this._tmp);
    this.footTarget(-BODY.stanceWidth, this._tmp);
    this.poseLeg(this.legL, this._hipL, this._tmp);
  }

  footTarget(side, out) {
    // Eixo lateral do tronco projetado no chão (X local do tronco girado).
    const x = Math.cos(BODY.stanceYaw) * side;
    const z = -Math.sin(BODY.stanceYaw) * side;
    // Mesmo ponto em mundo, para amostrar a altura do terreno sob o pé.
    // Rotação em torno de Y (convenção do Three): x' = x·cos + z·sen.
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const wx = this.root.position.x + c * x + s * z;
    const wz = this.root.position.z - s * x + c * z;
    const groundY = this.terrain.heightAt(wx, wz) - this.position.y;
    return out.set(x, groundY + BODY.ankleY, z);
  }

  poseLeg(leg, hip, foot) {
    // Joelho aponta para onde o corpo está virado.
    this._pole
      .set(-Math.sin(BODY.stanceYaw), 0.1, -Math.cos(BODY.stanceYaw))
      .normalize();
    solveTwoBoneIK(hip, foot, BODY.thigh, BODY.shin, this._pole, this._knee);
    orientSegment(leg.thigh, hip, this._knee);
    orientSegment(leg.shin, this._knee, foot);
    // Bermuda: metade de cima da coxa.
    this._tmpB.copy(hip).lerp(this._knee, 0.52);
    orientSegment(leg.short, hip, this._tmpB);
    leg.knee.position.copy(this._knee);
    leg.shoe.position.copy(foot);
    leg.shoe.position.y -= BODY.ankleY;
    // A ponta do pé (-Z do grupo) aponta para onde o corpo está virado.
    leg.shoe.rotation.set(0, BODY.stanceYaw, 0);
  }

  updatePonytail(dt) {
    // Atraso proporcional à velocidade angular: o rabo de cavalo "sobra" na
    // virada e volta amortecido.
    let dYaw = this.yaw - this.prevYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const yawRate = dt > 0 ? dYaw / dt : 0;

    this.ponytailLag.x = damp(this.ponytailLag.x, clamp(yawRate * 0.09, -0.5, 0.5), 9, dt);
    this.ponytailLag.y = damp(
      this.ponytailLag.y,
      clamp(-this.pitch * 0.25 + Math.sin(this.bobPhase * 2) * 0.05, -0.4, 0.4),
      7,
      dt,
    );

    const a = this._tailA.set(0, 0, 0);
    const b = this._tailB.set(
      this.ponytailLag.x * 0.12,
      -0.09 + this.ponytailLag.y * 0.1,
      0.17,
    );
    const c = this._tailC.set(
      b.x + this.ponytailLag.x * 0.16,
      b.y - 0.22 + this.ponytailLag.y * 0.12,
      b.z + 0.05,
    );
    orientSegment(this.ponytailA, a, b);
    this.ponytailB.position.copy(b);
    orientSegment(this.ponytailTip, a, c.sub(b));
  }

  /* --------------------------------------------------------------- tiro ---- */

  /** Ponto de disparo (repouso da flecha) em coordenadas de mundo. */
  getMuzzle(out) {
    return this.bow.getMuzzleWorld(out);
  }
}
