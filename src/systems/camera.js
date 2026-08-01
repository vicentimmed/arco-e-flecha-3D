/* ---------------------------------------------------------------------------
   Câmera em terceira pessoa, atrás da arqueira, com modo "seguir a flecha".

   A câmera fica praticamente SOBRE a linha de tiro: recuada a partir do ponto
   de disparo, com um deslocamento pequeno (30 cm para cima, 30 cm para a
   direita) só para enxergar por cima do arco. Esse deslocamento é o único
   paralaxe do jogo, e é ele que o pino de mira compensa (ver systems/aim.js).
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { damp } from "../utils/math.js";

export const CameraMode = {
  ARCHER: "archer",
  ARROW: "arrow",
};

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = CameraMode.ARCHER;
    this.followArrow = null;
    this.autoFollow = false;

    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    this.initialized = false;
  }

  setAutoFollow(on) {
    this.autoFollow = on;
  }

  /** Chamado ao disparar: se o modo automático estiver ligado, acompanha. */
  onShoot(arrow) {
    if (this.autoFollow) {
      this.followArrow = arrow;
      this.mode = CameraMode.ARROW;
    }
  }

  toggleFollow(arrow) {
    if (this.mode === CameraMode.ARROW) {
      this.mode = CameraMode.ARCHER;
      this.followArrow = null;
    } else if (arrow && !arrow.stuck && !arrow.dead) {
      this.mode = CameraMode.ARROW;
      this.followArrow = arrow;
    }
  }

  update(dt, muzzle, aimDirection) {
    if (this.mode === CameraMode.ARROW) {
      const arrow = this.followArrow;
      if (!arrow || arrow.dead) {
        this.mode = CameraMode.ARCHER;
      } else {
        this.updateArrowCam(dt, arrow);
        return;
      }
    }
    this.updateArcherCam(dt, muzzle, aimDirection);
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

    // A câmera converge para um ponto distante da linha de tiro: é só
    // enquadramento. A mira de verdade é o pino projetado (systems/aim.js), que
    // não depende de onde a câmera está.
    this.camera.position.copy(this.position);
    this.lookAt.copy(muzzle).addScaledVector(aimDirection, CONFIG.camera.convergence);
    this.camera.lookAt(this.lookAt);
  }

  updateArrowCam(dt, arrow) {
    const c = CONFIG.camera.arrowCam;
    const t = arrow.body.translation();
    const v = arrow.body.linvel();
    this._tmp.set(v.x, v.y, v.z);
    if (this._tmp.lengthSq() < 1e-4) this._tmp.set(0, 0, -1);
    this._tmp.normalize();

    this._desired
      .set(t.x, t.y, t.z)
      .addScaledVector(this._tmp, -c.distance)
      .addScaledVector(this._up, c.up);
    this._look.set(t.x, t.y, t.z).addScaledVector(this._tmp, 6);

    const k = c.smoothing;
    this.position.x = damp(this.position.x, this._desired.x, k, dt);
    this.position.y = damp(this.position.y, this._desired.y, k, dt);
    this.position.z = damp(this.position.z, this._desired.z, k, dt);
    this.lookAt.x = damp(this.lookAt.x, this._look.x, k, dt);
    this.lookAt.y = damp(this.lookAt.y, this._look.y, k, dt);
    this.lookAt.z = damp(this.lookAt.z, this._look.z, k, dt);

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }
}
