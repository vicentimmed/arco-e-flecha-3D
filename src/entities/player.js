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
  // Ancoragem da corda: canto da boca, do lado da mão que puxa (a esquerda).
  // É este ponto que define a linha da flecha, e não o ombro. Medido a partir
  // da CABEÇA e no espaço do root — deslocar no espaço do tronco não serve,
  // porque o giro da postura converte "esquerda" em "para trás" e a âncora
  // acabaria no meio do corpo.
  anchorSide: 0.062, // m à esquerda da linha de tiro
  anchorDrop: 0.09, // m abaixo do centro da cabeça (canto da boca)
  anchorForward: 0.03, // m à frente, ao longo da mira
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
const TAU = Math.PI * 2;

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

    /* Estado da marcha. Ver `move()` para a ideia central: a fase do ciclo é
       medida em METROS PERCORRIDOS, não em segundos. */
    this.gaitPhase = 0; // rad — 2π = um ciclo completo (dois passos)
    this.gaitBlend = 0; // 0 parado … 1 em passo pleno
    this.runBlend = 0; // 0 andando … 1 correndo
    this.moveF = 0; // componente frontal do movimento local, suavizada
    this.moveS = 0; // componente lateral do movimento local, suavizada
    this.speed = 0; // m/s reais, suavizados
    this.footYaw = BODY.stanceYaw; // rad — para onde a ponta do pé aponta
    this.rootLift = 0; // m — deslocamento vertical do corpo (quique + agacho)

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
    this._anchor = new THREE.Vector3();
    this._lateral = new THREE.Vector3();
    this._eye = new THREE.Vector3();
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
  move(dt, forward, strafe, wantRun = false) {
    const p = CONFIG.player;
    const g = CONFIG.gait;
    const moving = forward !== 0 || strafe !== 0;
    const target = moving ? (wantRun ? p.runSpeed : p.walkSpeed) : 0;

    // A velocidade persegue o alvo em vez de saltar: sair andando e frear têm
    // peso, e Shift acelera de forma contínua.
    this.speed = damp(this.speed, target, p.speedSmoothing, dt);
    this.runBlend = damp(this.runBlend, moving && wantRun ? 1 : 0, p.runSmoothing, dt);

    let fx = 0;
    let sx = 0;
    const step = this.speed * dt;
    if (moving) {
      const len = Math.hypot(forward, strafe) || 1;
      fx = forward / len;
      sx = strafe / len;
      if (step > 1e-6) {
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        // Frente do jogador = -Z rotacionado por yaw.
        this.stepTo((-sin * fx + cos * sx) * step, (-cos * fx - sin * sx) * step);
      }
    }

    /* Composição do passo. `moveF`/`moveS` guardam o vetor de movimento em
       coordenadas do corpo (frente e lado) já amortecido — é essa proporção que
       mistura o balanço sagital com o passo lateral, e é o SINAL de `moveF` que
       inverte o ciclo ao andar para trás. `gaitBlend` liga e desliga a animação
       inteira, garantindo o retorno suave à pose neutra ao parar. */
    this.moveF = damp(this.moveF, fx, g.blendSmoothing, dt);
    this.moveS = damp(this.moveS, sx, g.blendSmoothing, dt);
    this.gaitBlend = damp(this.gaitBlend, moving ? 1 : 0, g.blendSmoothing, dt);

    /* A FASE ANDA COM A DISTÂNCIA, não com o relógio: um ciclo completo a cada
       `strideLength` metros. Assim a cadência acompanha sozinha a velocidade
       real — o pé nunca patina no chão nem "corre no lugar" — e a corrida sai
       mais rápida de graça, ainda por cima com a passada mais longa. */
    const stride = g.strideLength * (1 + g.runStrideGain * this.runBlend);
    this.gaitPhase += (step / stride) * TAU;
    if (this.gaitPhase > TAU) this.gaitPhase -= TAU;

    this.bobPhase += dt * 1.3; // respiração — independe da marcha

    this.position.y = this.terrain.heightAt(this.position.x, this.position.z);
    return moving;
  }

  /**
   * Avança o passo respeitando os limites da arena — e DESLIZANDO neles.
   *
   * O limite não é uma caixa invisível: é o próprio terreno. `isWalkable`
   * recusa o que é íngreme demais para se subir e o que passou da borda da
   * bacia. Quando o passo inteiro é recusado, cada eixo é tentado sozinho:
   * assim, encostar na serra em diagonal faz a arqueira correr rente à
   * encosta em vez de travar de repente.
   *
   * O terreno se estende centenas de metros além disso, então mesmo que este
   * teste falhasse não haveria buraco para cair — só encosta.
   */
  stepTo(dx, dz) {
    const p = this.position;
    if (this.tryStep(p.x + dx, p.z + dz)) return;
    if (this.tryStep(p.x + dx, p.z)) return;
    this.tryStep(p.x, p.z + dz);
  }

  tryStep(x, z) {
    if (!this.terrain.isWalkable(x, z)) return false;
    this.position.x = x;
    this.position.z = z;
    return true;
  }

  /** Fator de amplitude do passo: 1 andando, cresce até a corrida plena. */
  get strideScale() {
    return 1 + CONFIG.gait.runAmplitudeGain * this.runBlend;
  }

  /* --------------------------------------------------------------- pose ---- */

  update(dt, moving) {
    // O quique vertical sai da MESMA fase do passo (dois toques de pé por
    // ciclo), com `gaitBlend` desligando na parada e a respiração assumindo.
    // Sem isso teríamos duas fontes de verdade para a cadência e o corpo
    // subiria fora de sincronia com os pés.
    const g = CONFIG.gait;
    const w = this.gaitBlend;
    const amp = this.strideScale;

    const stepBob = Math.sin(this.gaitPhase * 2) * g.bobAmplitude * amp * w;
    const breath = Math.sin(this.bobPhase) * 0.006 * (1 - w);
    // Agacho constante enquanto anda: além de ser o que o corpo faz de verdade,
    // é ele que dá curso ao joelho para a perna alcançar a passada sem esticar.
    // Guardado porque o alvo do pé precisa descontá-lo: o corpo sobe e desce,
    // o pé plantado NÃO — senão ele afundaria e flutuaria junto com o quique.
    this.rootLift = stepBob + breath - g.crouch * w;

    this.root.position.set(
      this.position.x,
      this.position.y + this.rootLift,
      this.position.z,
    );
    this.root.rotation.y = this.yaw;

    // Direção da mira no espaço do root (o yaw já está no root).
    this._aim.set(0, Math.sin(this.pitch), -Math.cos(this.pitch));
    // Lateral do corpo (direita), usada para manter os cotovelos para fora.
    this._lateral.set(1, 0, 0);

    /* Para onde a ponta do pé aponta. Parada, ela mantém a base de arqueiro;
       andando, vira parcialmente para a direção da marcha — pelo caminho
       angular curto, para não dar meia-volta ao inverter o sentido. */
    const mag = Math.hypot(this.moveF, this.moveS);
    let turn = 0;
    if (mag > 1e-3) {
      let d = Math.atan2(-this.moveS, this.moveF) - BODY.stanceYaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      turn = d * g.footTurn * w * Math.min(1, mag);
    }
    this.footYaw = BODY.stanceYaw + turn;

    /* Tronco: postura de lado + inclinação acompanhando a mira + a torção do
       passo. A torção é cancelada conforme o arco tensiona: mirando, o tronco
       trava, e a caminhada não mexe na linha da flecha nem no punho do arco. */
    const twist =
      Math.sin(this.gaitPhase) * g.torsoTwist * amp * w * (1 - this.drawFraction);
    this._q.setFromAxisAngle(AXIS_X, -this.pitch * 0.42);
    this._qb.setFromAxisAngle(AXIS_Y, BODY.stanceYaw + twist);
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
    /* A geometria do tiro nasce da ANCORAGEM, não do ombro.
     *
     * Num arqueiro de verdade a corda é puxada até um ponto fixo do rosto (o
     * canto da boca, do lado da mão que puxa) e o arco fica onde a linha da
     * flecha manda. Derivar o punho a partir do ombro, como eu fazia antes,
     * jogava o nock para o lado ERRADO do rosto: o braço da corda tinha que
     * atravessar o tronco para alcançá-lo.
     *
     * Aqui ela puxa com a mão esquerda, então a âncora fica à esquerda do
     * queixo e o braço da corda trabalha do seu próprio lado do corpo. */
    this.localToRoot(0, BODY.headY - BODY.hipY, 0, this._anchor);
    this._anchor.x -= BODY.anchorSide; // lado da mão que puxa
    this._anchor.y -= BODY.anchorDrop; // canto da boca
    this._anchor.addScaledVector(this._aim, BODY.anchorForward);

    // Punho do arco: sobre a linha da flecha, à frente da âncora.
    const grip = this._tmp
      .copy(this._anchor)
      .addScaledVector(this._aim, this.bow.fullDrawReach);

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
    /* Antes de tensionar, a mão descansa junto ao quadril — e é só aí que ela
       balança com o passo, em fase com a perna DIREITA (braço e perna opostos,
       como na marcha humana). Assim que a corda começa a ser puxada o balanço
       desaparece: o braço do arco nunca é tocado, então a mira não sente nada. */
    const armSwing =
      Math.cos(this.gaitPhase) *
      CONFIG.gait.armSwing *
      this.strideScale *
      this.gaitBlend *
      (1 - this.drawFraction);
    this._idleHand
      .copy(this._hipL)
      .add(this._tmp.set(-0.06, -0.16, 0.06 - armSwing));
    const grab = clamp(this.drawFraction * 5, 0, 1);
    this._handTarget.copy(this._idleHand).lerp(this._nock, grab);

    // Cotovelo alto e para trás, alinhado com a flecha — e sempre para FORA do
    // corpo (lado da mão que puxa), nunca cruzando o peito.
    this._pole
      .copy(this._aim)
      .multiplyScalar(-1)
      .addScaledVector(AXIS_Y, 0.45)
      .addScaledVector(this._lateral, -0.55)
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

  /* ---------------------------------------------------------------- passo --
   *
   * O ciclo de marcha é descrito pelo PÉ, não por ângulos de junta: cada perna
   * recebe um alvo de pé deslocado em torno do quadril e a mesma IK de dois
   * ossos do resto do corpo resolve coxa e canela. Deslocar o pé para a frente
   * É girar a coxa em X; deslocá-lo para o lado É girá-la em Z — com três
   * vantagens sobre escrever os ângulos na mão:
   *
   *   • o joelho dobra sozinho na fase de balanço, porque levantar o pé encurta
   *     a distância quadril→pé e a IK responde com flexão;
   *   • o pé continua acompanhando o relevo (a altura vem do terreno sob ELE);
   *   • a pose parada continua saindo da mesma função, sem caso especial.
   *
   * As duas pernas andam em CONTRAFASE (π de diferença), e as componentes
   * sagital e frontal entram na proporção do vetor de movimento local — o que
   * dá a diagonal de graça. Andar para trás inverte `moveF` e, com ele, o
   * sentido do ciclo.
   */

  updateLegs() {
    this.poseLeg(this.legR, this._hipR, BODY.stanceWidth, 0);
    this.poseLeg(this.legL, this._hipL, -BODY.stanceWidth, Math.PI);
  }

  /**
   * Alvo do pé no espaço do root.
   * @param {number} side  afastamento ao longo do eixo lateral do tronco (m)
   * @param {number} theta fase desta perna no ciclo (rad)
   */
  footTarget(side, theta, out) {
    const g = CONFIG.gait;
    const w = this.gaitBlend;
    const amp = this.strideScale * w;

    // Andando, a base de arqueiro se fecha: pés tão abertos só fazem sentido
    // plantada, e fechá-los ainda dá alcance de sobra para a passada.
    const stance = side * (1 - g.stanceNarrow * w);

    // Eixo lateral do tronco projetado no chão (X local do tronco girado).
    let x = Math.cos(BODY.stanceYaw) * stance;
    let z = -Math.sin(BODY.stanceYaw) * stance;

    /* Deslocamento do passo. O cosseno dá a posição ao longo do ciclo; a
       amplitude de cada plano é ponderada pela componente correspondente do
       movimento (frente/lado), então diagonal vira mistura das duas. */
    const swing = Math.cos(theta) * amp;
    x += swing * g.lateralAmplitude * this.moveS; // plano frontal (A/D)
    z -= swing * g.swingAmplitude * this.moveF; // plano sagital (W/S), -Z à frente

    // Mesmo ponto em mundo, para amostrar a altura do terreno sob o pé.
    // Rotação em torno de Y (convenção do Three): x' = x·cos + z·sen.
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const wx = this.root.position.x + c * x + s * z;
    const wz = this.root.position.z - s * x + c * z;
    // `rootLift` sai da conta para que o pé fique colado no chão enquanto o
    // corpo quica e agacha por cima dele.
    const groundY = this.terrain.heightAt(wx, wz) - this.position.y - this.rootLift;

    /* Fase de balanço = pé indo NA DIREÇÃO da marcha, ou seja, derivada
       positiva do deslocamento acima. Como a projeção do deslocamento sobre a
       direção do movimento vale cos(θ)·(algo ≥ 0) qualquer que seja o sentido,
       o critério é sempre −sen(θ) > 0 — e o pé levanta na hora certa mesmo
       andando para trás ou de lado. Levantar o pé é o que dobra o joelho. */
    const lift = Math.max(0, -Math.sin(theta)) * g.footLift * amp;

    return out.set(x, groundY + BODY.ankleY + lift, z);
  }

  poseLeg(leg, hip, side, phaseOffset) {
    const foot = this.footTarget(side, this.gaitPhase + phaseOffset, this._tmp);

    // Joelho aponta para onde o corpo está virado, virando um pouco para a
    // direção da marcha enquanto anda.
    this._pole
      .set(-Math.sin(BODY.stanceYaw), 0.1, -Math.cos(BODY.stanceYaw))
      .addScaledVector(
        this._tmpB.set(this.moveS, 0, -this.moveF),
        CONFIG.gait.kneeTurn * this.gaitBlend,
      )
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
    // A ponta do pé (-Z do grupo) aponta para onde o corpo está virado —
    // parcialmente girada para a direção da marcha enquanto anda.
    leg.shoe.rotation.set(0, this.footYaw, 0);
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

  /**
   * Olho da arqueira, em coordenadas de mundo: logo acima da ancoragem da
   * corda. É de lá que ela mira, então é de lá que a primeira pessoa enxerga —
   * a flecha passa rente à câmera e o arco aparece à frente.
   */
  getEye(out, aimWorld) {
    this._eye.copy(this._anchor);
    this._eye.y += CONFIG.firstPerson.eyeAboveAnchor;
    this._eye.x -= CONFIG.firstPerson.eyeSide;
    out.copy(this._eye).applyMatrix4(this.root.matrixWorld);
    if (aimWorld) out.addScaledVector(aimWorld, CONFIG.firstPerson.eyeForward);
    return out;
  }

  /** Esconde a cabeça na primeira pessoa (senão a câmera fica dentro dela). */
  setHeadVisible(visible) {
    this.head.visible = visible;
  }
}
