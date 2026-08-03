/* ---------------------------------------------------------------------------
   Câmeras: terceira pessoa, primeira pessoa e acompanhamento da flecha.

   • ARCHER — atrás e por cima do ombro. A arqueira fica à esquerda do quadro e
     o campo de tiro à direita.
   • FIRST  — no olho da arqueira, logo acima do ponto de ancoragem da corda.
     A flecha passa rente à câmera e o arco aparece à frente, como se vê
     mirando de verdade.
   • ARROW  — atrás da flecha em voo. Entra sozinha a cada disparo e só sai
     quando o jogador clica.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { damp } from "../utils/math.js";

export const CameraMode = {
  ARCHER: "archer",
  FIRST: "first",
  ARROW: "arrow",
};

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = CameraMode.ARCHER;
    this.followArrow = null;
    /** Câmera da flecha congelada no impacto (não segue alvo balançando). */
    this.arrowCamFrozen = false;
    this.frozenPosition = new THREE.Vector3();
    this.frozenLookAt = new THREE.Vector3();

    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    this.initialized = false;

    this.baseFov = CONFIG.camera.fov;
    this.baseNear = CONFIG.camera.near;
    this.applyLens();
  }

  get isFirstPerson() {
    return this.mode === CameraMode.FIRST;
  }

  get isArrowCam() {
    return this.mode === CameraMode.ARROW;
  }

  /** Terceira pessoa é o padrão; botão direito/C segura a primeira pessoa. */
  setFirstPerson(on) {
    if (this.mode === CameraMode.ARROW) return;
    const next = on ? CameraMode.FIRST : CameraMode.ARCHER;
    if (this.mode === next) return;
    this.mode = next;
    this.initialized = false;
    this.applyLens();
  }

  /** Todo disparo joga a câmera para a flecha. */
  onShoot(arrow) {
    this.followArrow = arrow;
    this.arrowCamFrozen = false;
    this.mode = CameraMode.ARROW;
    this.applyLens();
  }

  /** Clique: volta para a visão da arqueira. */
  returnToArcher() {
    if (this.mode !== CameraMode.ARROW) return false;
    this.mode = CameraMode.ARCHER;
    this.followArrow = null;
    this.arrowCamFrozen = false;
    this.initialized = false;
    this.applyLens();
    return true;
  }

  applyLens() {
    const first = this.mode === CameraMode.FIRST;
    this.camera.fov = first ? CONFIG.firstPerson.fov : this.baseFov;
    this.camera.near = first ? CONFIG.firstPerson.near : this.baseNear;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param {THREE.Vector3} aimDirection eixo da mira
   * @param {THREE.Vector3} eye posição do olho da arqueira
   * @param {THREE.Vector3} aimFocus ponto do mundo sob o retículo
   * @param {THREE.Vector3} cameraPivot ombro da arqueira (só yaw) para terceira pessoa
   */
  update(dt, aimDirection, eye, aimFocus, cameraPivot) {
    if (this.mode === CameraMode.ARROW) {
      const arrow = this.followArrow;
      // Se a flecha sumiu de vez, não prende o jogador numa câmera órfã.
      if (!arrow || arrow.dead) {
        this.mode = CameraMode.FIRST;
        this.followArrow = null;
        this.arrowCamFrozen = false;
        this.initialized = false;
        this.applyLens();
      } else {
        this.updateArrowCam(dt, arrow);
        return;
      }
    }

    if (this.mode === CameraMode.FIRST) this.updateFirstPerson(eye, aimFocus);
    else this.updateArcherCam(aimDirection, cameraPivot, aimFocus);
  }

  updateFirstPerson(eye, aimFocus) {
    // Sem suavização: a cabeça é a câmera, qualquer atraso vira enjoo.
    this.position.copy(eye);
    this.camera.position.copy(this.position);
    this.lookAt.copy(aimFocus);
    this.camera.lookAt(this.lookAt);
    this.initialized = true;
  }

  updateArcherCam(aimDirection, pivot, aimFocus) {
    const c = CONFIG.camera;

    // Só o yaw posiciona a câmera. Incluir pitch no recuo lateral fazia ela
    // avançar e recuar ao mirar para os lados com inclinação.
    this._tmp.copy(aimDirection);
    this._tmp.y = 0;
    if (this._tmp.lengthSq() < 1e-8) this._tmp.set(0, 0, -1);
    else this._tmp.normalize();

    this._right.crossVectors(this._tmp, this._up).normalize();

    this._desired
      .copy(pivot)
      .addScaledVector(this._tmp, -c.distance)
      .addScaledVector(this._right, c.right)
      .addScaledVector(this._up, c.up);

    // Não amortecer a órbita da câmera. O alvo do retículo responde no mesmo
    // frame ao mouse; atrasar só a posição criava duas respostas diferentes e
    // uma sensação de stutter exclusiva da terceira pessoa.
    this.position.copy(this._desired);

    this.camera.position.copy(this.position);
    // Olhar para o ponto físico sob o retículo (aimFocus), não para um ponto
    // reconstruído a partir do olho + distância. Com a câmera lateral, qualquer
    // erro nessa distância desloca o retículo na tela — a flecha obedece o
    // raycast (aimFocus), então a câmera tem de olhar exatamente para lá.
    this.lookAt.copy(aimFocus);
    this.initialized = true;
    this.camera.lookAt(this.lookAt);
  }

  updateArrowCam(dt, arrow) {
    // No impacto a flecha pode ficar presa a um alvo dinâmico — congelamos a
    // câmera na pose do momento do acerto, não no corpo que se move depois.
    if (arrow.stuck) {
      if (!this.arrowCamFrozen) {
        this.freezeArrowCam(arrow);
        this.arrowCamFrozen = true;
      }
      this.camera.position.copy(this.frozenPosition);
      this.camera.lookAt(this.frozenLookAt);
      return;
    }

    const c = CONFIG.camera.arrowCam;
    const t = arrow.body.translation();
    const v = arrow.body.linvel();
    this._tmp.set(v.x, v.y, v.z);
    if (this._tmp.lengthSq() < 1e-4) {
      this._tmp.copy(arrow.lastVelocity);
      if (this._tmp.lengthSq() < 1e-4) this._tmp.set(0, 0, -1);
    }
    this._tmp.normalize();

    this._desired
      .set(t.x, t.y, t.z)
      .addScaledVector(this._tmp, -c.distance)
      .addScaledVector(this._up, c.up);
    this._look.set(t.x, t.y, t.z).addScaledVector(this._tmp, 6);

    if (!this.initialized) {
      this.position.copy(this._desired);
      this.lookAt.copy(this._look);
      this.initialized = true;
    } else {
      const k = c.smoothing;
      this.position.x = damp(this.position.x, this._desired.x, k, dt);
      this.position.y = damp(this.position.y, this._desired.y, k, dt);
      this.position.z = damp(this.position.z, this._desired.z, k, dt);
      this.lookAt.x = damp(this.lookAt.x, this._look.x, k, dt);
      this.lookAt.y = damp(this.lookAt.y, this._look.y, k, dt);
      this.lookAt.z = damp(this.lookAt.z, this._look.z, k, dt);
    }

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }

  /** Fixa posição e olhar da câmera da flecha no instante do impacto. */
  freezeArrowCam(arrow) {
    const c = CONFIG.camera.arrowCam;
    const anchor = arrow.stickCamAnchor;
    const fwd = arrow.stickCamForward;
    this.frozenPosition
      .copy(anchor)
      .addScaledVector(fwd, -c.distance)
      .addScaledVector(this._up, c.up);
    this.frozenLookAt.copy(anchor).addScaledVector(fwd, 6);
  }
}
