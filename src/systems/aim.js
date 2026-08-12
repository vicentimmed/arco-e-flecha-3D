/* ---------------------------------------------------------------------------
   Linha de tiro.

   O retículo é um ponto FIXO no centro da tela e a flecha sai apontada
   exatamente para o pedaço de cenário que está sob ele. Para achar esse ponto
   lançamos um raio pela engine de física a partir do centro óptico da câmera de
   mira, na direção do retículo; o primeiro colisor atingido define o ponto de
   convergência da flecha.

   POR QUE O RAIO SAI DA CÂMERA, E NÃO DO OLHO DA ARQUEIRA.

   Em terceira pessoa a câmera fica alguns metros atrás e um pouco ao lado da
   linha de tiro (`CONFIG.camera.distance`/`right`/`up` — e o quanto não importa
   para nada do que se lê abaixo, que é justamente a graça do arranjo).
   Um ponto do mundo só cai sempre no mesmo lugar da tela se estiver sobre uma
   reta que passa pelo centro óptico da câmera — qualquer outra reta se projeta
   como um SEGMENTO, e a posição do ponto dentro dele depende da distância.
   Mirando pelo olho, o retículo tinha de acompanhar essa distância: quando o
   raio trocava de superfície (borda de alvo, tronco, chão ↔ fundo), ele pulava
   dezenas de pixels — e a flecha ia para o ponto novo, não para onde o jogador
   achava que estava apontando.

   Saindo da câmera, o ponto de mira está por definição sobre o eixo óptico:
   o retículo nunca sai do centro da tela e a flecha sempre converge nele.
   A conta que a convergência resolve é só a diferença geométrica entre de onde
   se OLHA e de onde a flecha SAI. Gravidade e vento continuam agindo no voo e
   continuam sendo responsabilidade do jogador.

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
    /** Eixo do CORPO da arqueira (yaw/pitch) — postura, arco e câmera. */
    this.axis = new THREE.Vector3(0, 0, -1);
    /** Direção real de lançamento da flecha. */
    this.direction = new THREE.Vector3(0, 0, -1);
    /** Ponto do mundo sob o retículo. */
    this.focus = new THREE.Vector3();
    /** Distância do arco até esse ponto (m), para o HUD. */
    this.focusDistance = CONFIG.aim.fallbackDistance;
    /** true se o raio encontrou algo de verdade. */
    this.hasFocus = false;

    this._origin = new THREE.Vector3();
    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  }

  setExcludedCollider(collider) {
    this.excludedCollider = collider;
  }

  /** Eixo a partir dos ângulos de mira, sem tocar no estado. */
  axisFrom(yaw, pitch, out) {
    const cp = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  }

  /** Eixo do corpo a partir dos ângulos de mira. */
  solveAxis(yaw, pitch) {
    return this.axisFrom(yaw, pitch, this.axis);
  }

  /**
   * Converge a linha de tiro no ponto sob o retículo.
   * @param {THREE.Vector3} viewpoint centro óptico da câmera de mira
   * @param {THREE.Vector3} forward direção do retículo (eixo óptico)
   * @param {number} skip metros ignorados à frente do viewpoint — em terceira
   *   pessoa é o que impede o raio de parar na arqueira ou no que estiver entre
   *   ela e a câmera
   * @param {THREE.Vector3} muzzle ponto de onde a flecha realmente sai
   */
  solve(viewpoint, forward, skip, muzzle) {
    this._origin.copy(viewpoint).addScaledVector(forward, skip);

    this._ray.origin.x = this._origin.x;
    this._ray.origin.y = this._origin.y;
    this._ray.origin.z = this._origin.z;
    this._ray.dir.x = forward.x;
    this._ray.dir.y = forward.y;
    this._ray.dir.z = forward.z;

    const hit = this.physics.world.castRay(
      this._ray,
      CONFIG.aim.maxRange,
      true,
      undefined,
      undefined,
      this.excludedCollider,
    );
    this.hasFocus = hit !== null;
    const reach = hit ? hit.timeOfImpact : CONFIG.aim.fallbackDistance;

    this.focus.copy(this._origin).addScaledVector(forward, reach);
    this.direction.copy(this.focus).sub(muzzle).normalize();
    // O HUD mostra a distância do TIRO (do arco ao alvo), não do olho da câmera.
    this.focusDistance = muzzle.distanceTo(this.focus);
    return this.direction;
  }
}
