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
    /** Para onde voltar quando a câmera da flecha for encerrada. */
    this.archerMode = CameraMode.ARCHER;
    this.followArrow = null;

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
  }

  get isFirstPerson() {
    return this.mode === CameraMode.FIRST;
  }

  get isArrowCam() {
    return this.mode === CameraMode.ARROW;
  }

  /** Alterna entre primeira e terceira pessoa (botão direito). */
  togglePerspective() {
    this.archerMode =
      this.archerMode === CameraMode.FIRST ? CameraMode.ARCHER : CameraMode.FIRST;
    if (this.mode !== CameraMode.ARROW) {
      this.mode = this.archerMode;
      this.initialized = false; // evita um deslize longo entre os dois pontos
    }
    this.applyLens();
  }

  /** Todo disparo joga a câmera para a flecha. */
  onShoot(arrow) {
    this.followArrow = arrow;
    this.mode = CameraMode.ARROW;
    this.applyLens();
  }

  /** Clique: volta para a visão da arqueira. */
  returnToArcher() {
    if (this.mode !== CameraMode.ARROW) return false;
    this.mode = this.archerMode;
    this.followArrow = null;
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
   * @param {THREE.Vector3} muzzle ponto de disparo
   * @param {THREE.Vector3} aimDirection eixo da mira
   * @param {THREE.Vector3} eye posição do olho da arqueira
   */
  update(dt, muzzle, aimDirection, eye) {
    if (this.mode === CameraMode.ARROW) {
      const arrow = this.followArrow;
      // Se a flecha sumiu de vez, não prende o jogador numa câmera órfã.
      if (!arrow || arrow.dead) {
        this.mode = this.archerMode;
        this.followArrow = null;
        this.initialized = false;
        this.applyLens();
      } else {
        this.updateArrowCam(dt, arrow);
        return;
      }
    }

    if (this.mode === CameraMode.FIRST) this.updateFirstPerson(eye, aimDirection);
    else this.updateArcherCam(dt, muzzle, aimDirection);
  }

  updateFirstPerson(eye, aimDirection) {
    // Sem suavização: a cabeça é a câmera, qualquer atraso vira enjoo.
    this.position.copy(eye);
    this.camera.position.copy(this.position);
    this.lookAt.copy(this.position).add(aimDirection);
    this.camera.lookAt(this.lookAt);
    this.initialized = true;
  }

  updateArcherCam(dt, muzzle, aimDirection) {
    const c = CONFIG.camera;
    this._right.crossVectors(aimDirection, this._up).normalize();

    this._desired
      .copy(muzzle)
      .addScaledVector(aimDirection, -c.distance)
      .addScaledVector(this._right, c.right)
      .addScaledVector(this._up, c.up);

    if (!this.initialized) {
      this.position.copy(this._desired);
      this.initialized = true;
    } else {
      const k = c.smoothing;
      this.position.x = damp(this.position.x, this._desired.x, k, dt);
      this.position.y = damp(this.position.y, this._desired.y, k, dt);
      this.position.z = damp(this.position.z, this._desired.z, k, dt);
    }

    this.camera.position.copy(this.position);
    this.lookAt.copy(muzzle).addScaledVector(aimDirection, c.convergence);
    this.camera.lookAt(this.lookAt);
  }

  updateArrowCam(dt, arrow) {
    const c = CONFIG.camera.arrowCam;
    const t = arrow.body.translation();
    const v = arrow.body.linvel();
    this._tmp.set(v.x, v.y, v.z);
    // Flecha cravada tem velocidade zero: mantém a última direção conhecida.
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
}
