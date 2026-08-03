/* ---------------------------------------------------------------------------
   Gerenciador de porcos — spawn, IA, contagem, susto por flecha.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { Boar } from "../entities/boar.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { entityRegistry } from "../core/entityRegistry.js";

export class BoarManager {
  constructor(scene, physics, terrain) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.boars = [];

    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (e.impact) this.onArrowImpact(e.impact);
    });
  }

  get counts() {
    let alive = 0;
    let dead = 0;
    for (const b of this.boars) {
      if (b.dead) dead++;
      else alive++;
    }
    return { alive, dead };
  }

  spawnNear(playerPos) {
    const cfg = CONFIG.boar;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = cfg.spawnMinDist + Math.random() * (cfg.spawnMaxDist - cfg.spawnMinDist);
      const x = playerPos.x + Math.cos(angle) * dist;
      const z = playerPos.z + Math.sin(angle) * dist;
      if (!this.terrain.isWalkable(x, z)) continue;

      const entityId = entityRegistry.createId();
      const boar = new Boar(this.scene, this.physics, this.terrain, entityId, x, z);
      this.boars.push(boar);

      gameEvents.emit(EventType.BOAR_SPAWN, {
        boarId: entityId,
        position: vec3Payload({ x, y: this.terrain.heightAt(x, z), z }),
      });
      return boar;
    }
    return null;
  }

  onArrowImpact(impact) {
    const cfg = CONFIG.boar;
    const p = { x: impact.x, y: impact.y, z: impact.z };
    for (const boar of this.boars) {
      if (boar.dead) continue;
      const dx = boar.position.x - p.x;
      const dz = boar.position.z - p.z;
      const dy = boar.position.y - p.y;
      if (Math.hypot(dx, dz, dy) < cfg.scareRadius) {
        boar.scare(p);
        gameEvents.emit(EventType.BOAR_SCARED, {
          boarId: boar.entityId,
          scareOrigin: vec3Payload(p),
        });
      }
    }
  }

  update(dt, playerPos) {
    for (const boar of this.boars) {
      boar.update(dt, playerPos);
    }
  }
}
