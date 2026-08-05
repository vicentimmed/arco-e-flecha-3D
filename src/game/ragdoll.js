/* ---------------------------------------------------------------------------
   Corpo mole — o tombo depois da flechada.

   O que existia antes era um giro: `root.rotation.z` ia de 0 a 90° e o corpo
   deitava inteiriço, sempre para o mesmo lado, com os braços na mesma pose de
   mira. Não importava de onde a flecha veio nem com que força — e é justamente
   isso que se quer ver, porque é a única informação que o acerto carrega.

   AQUI NÃO HÁ RAGDOLL DE ENGINE. Não são corpos rígidos com juntas no Rapier, e
   a escolha é deliberada:

     • o arqueiro não é uma malha esqueletada — é uma hierarquia de grupos
       resolvida por IK de dois ossos a cada frame. Trocá-la por corpos físicos
       significaria desmontar o boneco no instante da morte;

     • e, pior, cada cliente simularia o SEU. Como o contato depende do passo,
       da ordem dos pares e do acúmulo de arredondamento, dois navegadores
       chegariam a poses diferentes para a mesma morte. Um jogo em que o corpo
       do amigo cai de um jeito na tela dele e de outro na sua não tem uma
       verdade só.

   O que existe é uma simulação pequena e própria, com três partes:

     1. O CORPO como um sólido: recebe o empurrão e o giro da flecha, cai,
        bate no chão, escorrega e assenta deitado.
     2. Os MEMBROS como pontos amortecidos presos ao ombro e ao quadril: eles
        não são movidos, eles FICAM PARA TRÁS. A mola os puxa para baixo, e as
        forças de arrasto do referencial girando (Coriolis e centrífuga) fazem
        o resto — é daí que vem a chicoteada do braço quando o tronco roda.
     3. A COLUNA e o PESCOÇO como duas molas amortecidas que encurvam.

   Determinismo: a integração tem PASSO FIXO. Sem isso o mesmo tombo terminaria
   numa pose com 60 Hz e noutra com 144 Hz, e como cada cliente desenha na taxa
   que consegue, o corpo cairia diferente em cada tela. Com passo fixo, as
   únicas entradas são o ponto de impacto e a velocidade da flecha — que
   trafegam na mensagem de morte — e todo mundo vê o mesmo tombo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";

const STEP = 1 / 120; // s — passo fixo da integração
const MAX_STEPS = 12; // trava anti "espiral da morte" num frame que engasgou

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

/* Pontos do corpo que encostam no chão, na altura local (o 0 é o pé). São só
   três porque é o que basta: cabeça, quadril e pés decidem se o corpo está
   deitado, sentado ou de bruços — e é essa a leitura que importa de longe. */
const CONTACTS = [
  { y: 1.62, r: 0.16 }, // cabeça
  { y: 0.9, r: 0.2 }, // quadril
  { y: 0.12, r: 0.14 }, // pés
];

/** Um membro: a ponta (mão ou pé) que fica para trás quando o corpo se mexe. */
class LimpLimb {
  constructor(length) {
    this.length = length;
    this.p = new THREE.Vector3(); // posição no espaço do root
    this.v = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  reset(attach, gLocal) {
    this.p.copy(attach).addScaledVector(gLocal, this.length * 0.9);
    this.v.set(0, 0, 0);
  }

  /**
   * Um passo da mola.
   *
   * @param {THREE.Vector3} attach ombro ou quadril, no espaço do root
   * @param {THREE.Vector3} gLocal para onde é "para baixo", visto do root
   * @param {THREE.Vector3} omega velocidade angular do corpo, no espaço do root
   */
  step(attach, gLocal, omega, dt) {
    const R = CONFIG.ragdoll;

    // Repouso: pendurado, esticado na direção da gravidade.
    this._a.copy(attach).addScaledVector(gLocal, this.length * 0.92);
    this._a.sub(this.p).multiplyScalar(R.limbStiffness);
    this._a.addScaledVector(this.v, -R.limbDamping);

    /* As duas forças do referencial que gira. Elas não são enfeite: sem elas o
       membro só balança como um pêndulo preso a um ponto que se move, e o que
       o olho procura num corpo mole é exatamente o contrário — a mão sendo
       ATIRADA para fora quando o tronco roda (centrífuga) e arrastada de lado
       quando ela já está em movimento (Coriolis). */
    this._t.copy(this.p).sub(attach);
    // centrífuga: −ω × (ω × r)
    this._a.addScaledVector(
      _v1.copy(omega).cross(_v2.copy(omega).cross(this._t)),
      -R.centrifugal,
    );
    // Coriolis: −2 ω × v
    this._a.addScaledVector(_v1.copy(omega).cross(this.v), -2 * R.coriolis);

    this.v.addScaledVector(this._a, dt);
    this.p.addScaledVector(this.v, dt);

    /* O osso não estica. Sem esta trava a mola dispara num impacto forte e o
       braço vira um fio de dois metros — o defeito clássico de ragdoll caseiro.
       Passar do comprimento é puxado de volta e a velocidade radial some. */
    this._t.copy(this.p).sub(attach);
    const d = this._t.length();
    if (d > this.length) {
      this._t.multiplyScalar(this.length / d);
      this.p.copy(attach).add(this._t);
      const radial = this._t.normalize();
      this.v.addScaledVector(radial, -this.v.dot(radial));
    }
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export class Ragdoll {
  constructor(terrain) {
    this.terrain = terrain;
    this.active = false;
    this.accumulator = 0;

    /** Centro de massa, em mundo. É em torno dele que o corpo gira. */
    this.com = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    /** Orientação do corpo inteiro. Substitui `root.rotation.y/z` na morte. */
    this.orient = new THREE.Quaternion();
    /** Velocidade angular, em mundo (rad/s). */
    this.omega = new THREE.Vector3();
    this.grounded = false;

    /** Curvatura da coluna e do pescoço: ângulo e velocidade de cada mola. */
    this.spine = { pitch: 0, roll: 0, vPitch: 0, vRoll: 0 };
    this.neck = { pitch: 0, roll: 0, vPitch: 0, vRoll: 0 };

    this.handR = new LimpLimb(0.5);
    this.handL = new LimpLimb(0.5);
    this.footR = new LimpLimb(0.84);
    this.footL = new LimpLimb(0.84);

    this._omegaLocal = new THREE.Vector3();
    this._gLocal = new THREE.Vector3();
  }

  /**
   * Começa o tombo.
   *
   * @param {THREE.Vector3|{x,y,z}} feet posição dos pés no instante da morte
   * @param {number} yaw para onde o corpo estava virado
   * @param {{x,y,z}|null} impact onde a flecha entrou (mundo)
   * @param {number[]|null} velocity velocidade da flecha no impacto [x,y,z]
   */
  begin(feet, yaw, impact, velocity) {
    const R = CONFIG.ragdoll;
    this.active = true;
    this.accumulator = 0;
    this.grounded = false;

    this.com.set(feet.x, feet.y + R.comHeight, feet.z);
    this.orient.setFromAxisAngle(UP, yaw);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.spine.pitch = this.spine.roll = this.spine.vPitch = this.spine.vRoll = 0;
    this.neck.pitch = this.neck.roll = this.neck.vPitch = this.neck.vRoll = 0;

    if (velocity) {
      /* O empurrão.

         Fisicamente uma flecha de 25 g a 85 m/s carrega 2,1 kg·m/s, e num corpo
         de 70 kg isso são 3 cm/s — invisível. Se a intenção fosse realismo, a
         resposta certa seria não mexer o corpo. Mas o acerto precisa TER
         consequência visível, então o impulso é amplificado por `pushGain` e o
         que se preserva é o que informa: a DIREÇÃO de onde veio o tiro e o
         quanto o arco estava tensionado. */
      _v1.set(velocity[0], velocity[1], velocity[2]);
      const speed = _v1.length();
      if (speed > 1e-3) {
        _v1.divideScalar(speed);
        this.vel.addScaledVector(_v1, speed * R.pushGain);
        // Um pouco para cima sempre: um corpo empurrado na horizontal pura
        // desliza como um caixote, e o que se espera é que ele seja levantado.
        this.vel.y += speed * R.liftGain;
      }

      /* O GIRO nasce do braço de alavanca: quanto mais longe do centro de massa
         a flecha entrou, mais o corpo roda. É isto que faz um tiro no ombro
         torcer o tronco e um tiro na perna derrubar de lado — a mesma conta,
         dois desfechos diferentes, sem nenhum caso especial escrito à mão. */
        if (impact) {
        _v2.set(impact.x - this.com.x, impact.y - this.com.y, impact.z - this.com.z);
        this.omega
          .copy(_v2)
          .cross(_v1)
          .multiplyScalar(speed * R.spinGain);
        this.omega.clampLength(0, R.maxSpin);
      }
    }
    // Sem dado de impacto (morte sem detalhe, ou uma cópia antiga do protocolo)
    // o corpo ainda tomba: cai de lado, como antes, só que mole.
    if (this.omega.lengthSq() < 1e-6) this.omega.set(0, 0, R.fallbackSpin);

    const attach = _v3.set(0, CONFIG.ragdoll.shoulderY, 0);
    this._gLocal.copy(DOWN).applyQuaternion(_q1.copy(this.orient).invert());
    this.handR.reset(attach, this._gLocal);
    this.handL.reset(attach, this._gLocal);
    attach.y = CONFIG.ragdoll.hipY;
    this.footR.reset(attach, this._gLocal);
    this.footL.reset(attach, this._gLocal);
  }

  stop() {
    this.active = false;
  }

  /** Avança a simulação em passos fixos. Ver o cabeçalho para o porquê. */
  update(dt) {
    if (!this.active) return;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS) {
      this.step(STEP);
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;
  }

  step(dt) {
    const R = CONFIG.ragdoll;

    /* ------------------------------------------------------------- corpo -- */
    this.vel.y += CONFIG.physics.gravity * dt;
    this.com.addScaledVector(this.vel, dt);

    // Integra a orientação: q ← Δq · q, com Δq lido da velocidade angular.
    const spin = this.omega.length();
    if (spin > 1e-5) {
      _q1.setFromAxisAngle(_v1.copy(this.omega).divideScalar(spin), spin * dt);
      this.orient.premultiply(_q1).normalize();
    }

    this.resolveGround(dt);

    this.omega.multiplyScalar(Math.exp(-R.spinDamping * dt));

    /* ------------------------------------------------- coluna e pescoço --- */
    /* Duas molas de segunda ordem, uma por eixo. O alvo NÃO é zero: é uma pose
       encolhida (`spineCurl`), porque um corpo que perde o tônus se dobra —
       ficar reto seria o mesmo boneco de antes, só que caído. O giro do corpo
       entra como perturbação, e é por isso que a cabeça pende para o lado da
       rotação em vez de acompanhar rígida. */
    this._omegaLocal.copy(this.omega).applyQuaternion(_q1.copy(this.orient).invert());
    spring(this.spine, R.spineCurl, this._omegaLocal.x, this._omegaLocal.z, R.spineStiffness, R.spineDamping, dt);
    spring(this.neck, R.neckCurl, this._omegaLocal.x, this._omegaLocal.z, R.neckStiffness, R.neckDamping, dt);

    /* ---------------------------------------------------------- membros --- */
    this._gLocal.copy(DOWN).applyQuaternion(_q1.copy(this.orient).invert());
    const ombro = _v3.set(R.shoulderX, R.shoulderY, 0);
    this.handR.step(ombro, this._gLocal, this._omegaLocal, dt);
    ombro.x = -R.shoulderX;
    this.handL.step(ombro, this._gLocal, this._omegaLocal, dt);
    ombro.set(R.hipX, R.hipY, 0);
    this.footR.step(ombro, this._gLocal, this._omegaLocal, dt);
    ombro.x = -R.hipX;
    this.footL.step(ombro, this._gLocal, this._omegaLocal, dt);
  }

  /**
   * Chão: empurra para cima, tira a velocidade e deita o corpo.
   *
   * O corpo é amostrado em três pontos (cabeça, quadril, pés). O mais enterrado
   * manda: ele decide o quanto subir e é no ponto dele que o atrito e o torque
   * de tombamento são aplicados. Não é uma cápsula de verdade, e não precisa
   * ser — o que interessa é que o corpo não afunde e que ele acabe DEITADO.
   */
  resolveGround(dt) {
    const R = CONFIG.ragdoll;
    let piorPen = 0;
    let piorAltura = 0;

    for (const c of CONTACTS) {
      _v1.set(0, c.y - R.comHeight, 0).applyQuaternion(this.orient).add(this.com);
      const chao = this.terrain.heightAt(_v1.x, _v1.z);
      const pen = chao + c.r - _v1.y;
      if (pen > piorPen) {
        piorPen = pen;
        piorAltura = c.y - R.comHeight;
      }
    }

    if (piorPen <= 0) {
      this.grounded = false;
      return;
    }

    this.grounded = true;
    this.com.y += piorPen;

    if (this.vel.y < 0) {
      // Quicada curta e atrito no plano: o corpo escorrega um pouco e para.
      this.vel.y = -this.vel.y * R.bounce;
      const atrito = Math.exp(-R.groundFriction * dt);
      this.vel.x *= atrito;
      this.vel.z *= atrito;
    }
    this.omega.multiplyScalar(Math.exp(-R.groundSpinDamping * dt));

    /* Deitar.

       O contato num ponto só do corpo gera torque em torno dele, mas integrar
       isso de verdade daria a um corpo apoiado na cabeça a chance de ficar
       equilibrado ali — e um cadáver em pé de cabeça é pior que qualquer erro
       de física. Então o alvo é declarado: o eixo do corpo vai para a
       HORIZONTAL, mantendo o rumo em que ele já está caído, e a orientação
       persegue esse alvo com amortecimento. Ele deita sempre, e deita para o
       lado em que estava indo. */
    _v1.copy(UP).applyQuaternion(this.orient); // eixo do corpo, em mundo
    _v2.copy(_v1).projectOnPlane(UP); // ...rebatido no plano do chão
    if (_v2.lengthSq() < 1e-4) {
      // Corpo exatamente na vertical: sem rumo preferido, usa o "para frente".
      _v2.set(0, 0, -1).applyQuaternion(this.orient).projectOnPlane(UP);
      if (_v2.lengthSq() < 1e-4) _v2.set(0, 0, -1);
    }
    _v2.normalize();
    _q1.setFromUnitVectors(_v1, _v2);
    _q2.copy(_q1).multiply(this.orient);
    // O peso do ponto apoiado: quanto mais longe do centro, mais rápido tomba.
    const forca = R.settleRate * (1 + Math.abs(piorAltura));
    this.orient.slerp(_q2, 1 - Math.exp(-forca * dt));
  }

  /** Posição dos pés equivalente, para posicionar o `root` do arqueiro. */
  rootPosition(out) {
    return out
      .set(0, -CONFIG.ragdoll.comHeight, 0)
      .applyQuaternion(this.orient)
      .add(this.com);
  }
}

/**
 * Uma mola amortecida de segunda ordem em dois eixos.
 *
 * `alvo` é a pose de repouso (o encolhimento), e `dx`/`dz` são a perturbação
 * que o giro do corpo injeta. Integração semi-implícita: a velocidade é
 * atualizada antes da posição, que é o que mantém a mola estável com passos
 * grandes em vez de fazê-la crescer sozinha.
 */
function spring(s, alvo, dx, dz, k, c, dt) {
  s.vPitch += ((alvo - s.pitch) * k - s.vPitch * c + dx * 0.35) * dt;
  s.vRoll += ((0 - s.roll) * k - s.vRoll * c + dz * 0.35) * dt;
  s.pitch += s.vPitch * dt;
  s.roll += s.vRoll * dt;
}
