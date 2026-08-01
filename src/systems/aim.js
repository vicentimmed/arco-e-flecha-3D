/* ---------------------------------------------------------------------------
   Linha de tiro e pino de mira.

   A direção do disparo é definida SÓ pelo mouse (yaw/pitch). A câmera é livre
   para se posicionar onde a composição fica boa — atrás e à esquerda da
   arqueira, como na referência — porque a mira não é um retículo colado no
   centro da tela: ela é desenhada exatamente onde a linha de tiro passa na
   distância do pino, projetada na tela a cada frame.

   É assim que funciona a mira de um arco de verdade. O pino é regulado pelo
   jogador (roda do mouse, ou Tab para calibrar no alvo selecionado) e:

     • elimina qualquer erro de paralaxe entre câmera e flecha;
     • NÃO compensa gravidade, NÃO compensa vento, NÃO procura alvos.

   Ou seja: pôr o pino em cima do alvo acerta em linha reta, mas a flecha cai.
   Compensar a queda continua sendo trabalho do jogador.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { clamp } from "../utils/math.js";

export class AimSolver {
  constructor() {
    this.pinDistance = CONFIG.aim.pinDistance;
    this.direction = new THREE.Vector3(0, 0, -1);
    this.sightPoint = new THREE.Vector3();
    this._ndc = new THREE.Vector3();
  }

  setPin(distance) {
    this.pinDistance = clamp(distance, CONFIG.aim.pinMin, CONFIG.aim.pinMax);
  }

  nudgePin(steps) {
    this.setPin(this.pinDistance + steps * CONFIG.aim.pinStep);
  }

  /** Direção de lançamento a partir dos ângulos de mira. */
  solve(yaw, pitch) {
    const cp = Math.cos(pitch);
    this.direction.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    return this.direction;
  }

  /** Ponto onde o pino "enxerga": sobre a linha de tiro, na distância regulada. */
  updateSightPoint(muzzle) {
    return this.sightPoint
      .copy(muzzle)
      .addScaledVector(this.direction, this.pinDistance);
  }

  /**
   * Projeta o pino na tela. Devolve null se estiver atrás da câmera.
   * @returns {{x:number,y:number}|null} pixels
   */
  projectSight(camera, width, height) {
    this._ndc.copy(this.sightPoint).project(camera);
    if (this._ndc.z > 1 || !Number.isFinite(this._ndc.x) || !Number.isFinite(this._ndc.y)) {
      return null; // atrás da câmera, ou viewport degenerado
    }
    return {
      x: (this._ndc.x * 0.5 + 0.5) * width,
      y: (-this._ndc.y * 0.5 + 0.5) * height,
    };
  }
}
