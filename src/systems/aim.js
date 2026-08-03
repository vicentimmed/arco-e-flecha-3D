/* ---------------------------------------------------------------------------
   Linha de tiro.

   O retículo fica fixo no centro da tela e a flecha sai apontada exatamente
   para o ponto do cenário que está sob ele. Para achar esse ponto lançamos um
   raio pela engine de física a partir do olho da arqueira; o primeiro colisor
   atingido define a distância de convergência.

   O olho é a fonte de verdade, não a câmera de apresentação. Assim primeira e
   terceira pessoa compartilham rigorosamente o mesmo ponto sob o retículo.
   A convergência corrige apenas a diferença geométrica entre olho e arco;
   gravidade e vento continuam sendo responsabilidade do jogador.

   Usamos raycast só para MIRAR. O acerto no alvo continua sendo detectado por
   contato da engine de física, nunca por raio.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";

export class AimSolver {
  constructor(physics) {
    this.physics = physics;
    /** Colisor do próprio jogador: a mira começa dentro dele e deve ignorá-lo. */
    this.excludedCollider = null;
    /** Direção da mira da arqueira (eixo do retículo). */
    this.axis = new THREE.Vector3(0, 0, -1);
    /** Direção real de lançamento da flecha. */
    this.direction = new THREE.Vector3(0, 0, -1);
    /** Ponto do mundo sob o retículo. */
    this.focus = new THREE.Vector3();
    /** Distância até esse ponto (m), para o HUD. */
    this.focusDistance = CONFIG.aim.fallbackDistance;
    /** true se o raio encontrou algo de verdade. */
    this.hasFocus = false;

    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  }

  setExcludedCollider(collider) {
    this.excludedCollider = collider;
  }

  /** Eixo de mira a partir dos ângulos de mira. */
  solveAxis(yaw, pitch) {
    const cp = Math.cos(pitch);
    this.axis.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    return this.axis;
  }

  /**
   * Converge a linha de tiro no ponto sob o retículo.
   * @param {THREE.Vector3} aimOrigin posição do olho da arqueira
   * @param {THREE.Vector3} muzzle ponto de onde a flecha realmente sai
   */
  solve(aimOrigin, muzzle) {
    this._ray.origin.x = aimOrigin.x;
    this._ray.origin.y = aimOrigin.y;
    this._ray.origin.z = aimOrigin.z;
    this._ray.dir.x = this.axis.x;
    this._ray.dir.y = this.axis.y;
    this._ray.dir.z = this.axis.z;

    const hit = this.physics.world.castRay(
      this._ray,
      CONFIG.aim.maxRange,
      true,
      undefined,
      undefined,
      this.excludedCollider,
    );
    this.hasFocus = hit !== null;
    const distance = hit ? hit.timeOfImpact : CONFIG.aim.fallbackDistance;
    this.focusDistance = distance;

    this.focus.copy(aimOrigin).addScaledVector(this.axis, distance);
    this.direction.copy(this.focus).sub(muzzle).normalize();
    return this.direction;
  }
}
