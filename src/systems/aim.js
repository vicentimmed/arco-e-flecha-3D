/* ---------------------------------------------------------------------------
   Linha de tiro.

   O retículo fica fixo no centro da tela e a flecha sai apontada exatamente
   para o ponto do cenário que está sob ele. Para achar esse ponto lançamos um
   raio pela engine de física a partir da câmera; o primeiro colisor atingido
   define a distância de convergência.

   Por que isso não é "assistência de mira": a câmera e o arco não ocupam o
   mesmo lugar no espaço, então uma direção de tiro paralela ao eixo da câmera
   erraria o que está sob o retículo por um deslocamento fixo. A convergência
   corrige APENAS essa diferença geométrica. Nada aqui compensa gravidade nem
   vento — a flecha continua caindo e derivando durante o voo, e é isso que o
   jogador precisa antecipar.

   Usamos raycast só para MIRAR. O acerto no alvo continua sendo detectado por
   contato da engine de física, nunca por raio.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";

export class AimSolver {
  constructor(physics) {
    this.physics = physics;
    /** Direção da câmera (eixo do retículo). */
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

  /** Eixo da câmera a partir dos ângulos de mira. */
  solveAxis(yaw, pitch) {
    const cp = Math.cos(pitch);
    this.axis.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    return this.axis;
  }

  /**
   * Converge a linha de tiro no ponto sob o retículo.
   * @param {THREE.Vector3} cameraPosition origem do raio da mira
   * @param {THREE.Vector3} muzzle ponto de onde a flecha realmente sai
   */
  solve(cameraPosition, muzzle) {
    this._ray.origin.x = cameraPosition.x;
    this._ray.origin.y = cameraPosition.y;
    this._ray.origin.z = cameraPosition.z;
    this._ray.dir.x = this.axis.x;
    this._ray.dir.y = this.axis.y;
    this._ray.dir.z = this.axis.z;

    const hit = this.physics.world.castRay(this._ray, CONFIG.aim.maxRange, true);
    this.hasFocus = hit !== null;
    const distance = hit ? hit.timeOfImpact : CONFIG.aim.fallbackDistance;
    this.focusDistance = distance;

    this.focus.copy(cameraPosition).addScaledVector(this.axis, distance);
    this.direction.copy(this.focus).sub(muzzle).normalize();
    return this.direction;
  }
}
