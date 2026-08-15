/* ---------------------------------------------------------------------------
   Fase de teste — Sandbox.

   Isolada de propósito: serve para avaliar terreno com detalhe triplanar,
   pedra instanciada e cratera dinâmica sem tocar no vale (`valleyLevel.js`)
   nem em nenhuma outra fase existente. Nasce e morre como qualquer fase — ver
   o contrato de cabeçalho em `levels/index.js`.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { SandboxTerrain } from "../entities/sandboxGround.js";
import { disposeSubtree } from "./resources.js";

export class SandboxLevel {
  static id = "sandbox";

  /* O nome, os modos aceitos e a física estão em `shared/levels.js`: o
     servidor precisa deles e não pode importar este arquivo, que arrasta
     Three.js junto — mesma regra do vale/Lua/castelo. */

  build(ctx, progresso = () => {}) {
    this.root = new THREE.Group();
    this.root.name = "level:sandbox";
    ctx.scene.add(this.root);

    // Uniformes de balanço do mato — de FASE, não de módulo: cada Sandbox
    // tem o seu (ver `levels/resources.js`).
    this.sway = {
      time: { value: 0 },
      wind: { value: new THREE.Vector2() },
    };

    progresso(0.15, "erguendo a serra de teste…");
    this.terrain = new SandboxTerrain().build(this.root, ctx.physics, this.sway);

    progresso(1, "pronto");
    return this;
  }

  /** Sem fauna: nunca há poleiro de pássaro aqui. */
  nearestPerch() {
    return null;
  }

  get flags() {
    return [];
  }

  update(dt, wind) {
    this.sway.time.value += dt;
    const speed = Math.hypot(wind.x, wind.z) || 1e-6;
    const amp = 0.055 + 0.11 * Math.min(1, Math.max(0, speed / 12));
    this.sway.wind.value.set((wind.x / speed) * amp, (wind.z / speed) * amp);
  }

  dispose() {
    this.terrain?.dispose();
    const contagem = disposeSubtree(this.root);
    this.root = null;
    this.terrain = null;
    this.sway = null;
    return contagem;
  }
}
