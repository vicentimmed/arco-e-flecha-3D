/* ---------------------------------------------------------------------------
   Vento: direção e intensidade variando continuamente, com rajadas.

   O vento NÃO é aplicado como força extra sobre a flecha. Ele entra na conta
   do arrasto através da velocidade relativa ao ar (v_rel = v_flecha − v_vento),
   que é como funciona de verdade — e é o que faz o efeito depender da
   velocidade da flecha e do tempo de voo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { ValueNoise } from "../utils/noise.js";
import { clamp } from "../utils/math.js";

export class Wind {
  constructor(seed = 4242) {
    this.noise = new ValueNoise(seed);
    this.time = 0;
    this.vector = new THREE.Vector3();
    this.enabled = CONFIG.wind.enabled;
    this.speed = 0;
    this.direction = 0; // rad — para onde o vento sopra
    this.gust = 0;
    this.gustTimer = 0;
    this.baseSpeed = CONFIG.wind.baseSpeed;
    this.update(0);
  }

  update(dt) {
    this.time += dt;
    const c = CONFIG.wind;

    // Direção: passeio suave, dá a volta completa em alguns minutos.
    const dirNoise = this.noise.noise1(this.time * c.directionDrift);
    this.direction = dirNoise * Math.PI + this.time * 0.012;

    // Intensidade: ruído lento em torno da base.
    const spdNoise = this.noise.noise2(this.time * c.speedDrift, 17.3);
    let speed = this.baseSpeed * (1 + 0.55 * spdNoise);

    // Rajadas: sobem e descem com uma curva de sino.
    if (this.gustTimer > 0) {
      this.gustTimer -= dt;
      const phase = 1 - this.gustTimer / c.gustDuration;
      this.gust = Math.sin(clamp(phase, 0, 1) * Math.PI) * c.gustStrength;
    } else {
      this.gust = 0;
      if (dt > 0 && Math.random() < c.gustChance * dt) {
        this.gustTimer = c.gustDuration;
      }
    }
    speed = clamp(speed + this.gust, 0, c.maxSpeed);

    this.speed = this.enabled ? speed : 0;
    this.vector.set(
      Math.sin(this.direction) * this.speed,
      0,
      Math.cos(this.direction) * this.speed,
    );
  }

  /** Ângulo (rad) do vento relativo à direção para onde o jogador olha. */
  relativeAngle(playerYaw) {
    return this.direction - playerYaw;
  }

  setEnabled(on) {
    this.enabled = on;
    this.update(0);
  }

  setBaseSpeed(v) {
    this.baseSpeed = v;
    this.update(0);
  }
}
