/* ---------------------------------------------------------------------------
   Gerenciador de zumbis e lobos.

   Mesma divisão do `boarManager` e do `elkManager`: os bichos são do SERVIDOR e
   aqui existe só a casca — criar, remover e alimentar cada um com a pose que
   chega a 10 Hz. O campo `k` distingue zumbi (`z`) de lobo (`w`).
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { Zombie } from "../entities/zombie.js";
import { Wolf } from "../entities/wolf.js";
import { zombieEntity } from "../shared/protocol.js";
import { updateLodMap } from "../utils/lod.js";

export class ZombieManager {
  constructor(scene, physics, terrain, arrows = null) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.arrows = arrows;
    /** @type {Map<number, Zombie|Wolf>} id do servidor → casca local */
    this.byNetId = new Map();
    this._cam = new THREE.Vector3();
  }

  get counts() {
    let alive = 0;
    for (const z of this.byNetId.values()) if (!z.dead) alive++;
    return { alive, total: this.byNetId.size };
  }

  applyNetwork(lista) {
    if (!lista) return;
    const vistos = new Set();

    for (const item of lista) {
      vistos.add(item.id);
      let bicho = this.byNetId.get(item.id);

      if (item.d) {
        if (bicho?.kind === "wolf") bicho.killLocal();
        else bicho?.killLocal(item.b === 1);
        if (bicho) this.arrows?.removeAttachedTo(bicho);
        continue;
      }

      if (!bicho) {
        const isBoss = item.k === "b";
        const isWolf = item.k === "w";
        bicho = isWolf
          ? new Wolf(
              this.scene,
              this.physics,
              this.terrain,
              zombieEntity(item.id),
              item.p[0],
              item.p[2],
            )
          : new Zombie(
              this.scene,
              this.physics,
              this.terrain,
              zombieEntity(item.id),
              item.p[0],
              item.p[2],
              { isBoss },
            );
        this.byNetId.set(item.id, bicho);
      }

      /* Snapshot vivo manda: se o cliente matou por otimismo e o servidor
         ainda não confirmou (ou rejeitou o acerto), o bicho volta. Sem isso
         o mesh fica tombado e a IA real chega invisível. */
      if (bicho.dead) bicho.reviveLocal();

      if (bicho.kind === "wolf") {
        bicho.setNetworkTarget(item.p, item.y, item.s);
      } else {
        if (item.hp != null) bicho.setHealth(item.hp);
        bicho.setNetworkTarget(item.p, item.y, item.s, item.b === 1);
      }
    }

    for (const [id, bicho] of [...this.byNetId]) {
      if (vistos.has(id)) continue;
      this.byNetId.delete(id);
      this.arrows?.removeAttachedTo(bicho);
      bicho.dispose();
    }
  }

  kill(id, head = false) {
    const bicho = this.byNetId.get(id);
    if (!bicho) return;
    if (bicho.kind === "wolf") bicho.killLocal();
    else bicho.killLocal(head);
    this.arrows?.removeAttachedTo(bicho);
  }

  clear() {
    for (const z of this.byNetId.values()) {
      this.arrows?.removeAttachedTo(z);
      z.dispose();
    }
    this.byNetId.clear();
  }

  update(dt, camera) {
    for (const z of this.byNetId.values()) z.update(dt, camera);
    if (!camera) return;
    camera.getWorldPosition(this._cam);
    updateLodMap(this.byNetId, this._cam);
  }
}
