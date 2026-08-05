/* ---------------------------------------------------------------------------
   Gerenciador de alces.

   Mesma divisão do `boarManager`: os alces são do SERVIDOR, e aqui só existe a
   casca — criar, remover e alimentar cada bicho com a pose que chega a 10 Hz.
   A IA (e, principalmente, a decisão de quem foi chifrado) vive em
   `server/elkSim.js`, porque uma cabeçada mata e uma morte não pode depender de
   qual navegador estava desenhando o alce mais adiantado.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { Elk } from "../entities/elk.js";
import { elkEntity } from "../shared/protocol.js";
import { updateLodMap } from "../utils/lod.js";

/* O alce existe UM de cada vez e o modo inteiro é sobre vê-lo chegando do outro
   lado do vale (`arenaRadius` é 60 m). O LOD dele é generoso de propósito: só
   as pontas da galhada e os cascos somem, e mesmo assim só além de ~54 m. */
const ELK_LOD_SCALE = 2.0;

export class ElkManager {
  constructor(scene, physics, terrain) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    /** @type {Map<number, Elk>} id do servidor → casca local */
    this.byNetId = new Map();
    this._cam = new THREE.Vector3();
  }

  get elks() {
    return [...this.byNetId.values()];
  }

  get counts() {
    let alive = 0;
    for (const e of this.byNetId.values()) if (!e.dead) alive++;
    return { alive, total: this.byNetId.size };
  }

  /** O alce vivo mais próximo de um ponto — o que a barra do HUD acompanha. */
  nearestAlive(point) {
    let melhor = null;
    let melhorD = Infinity;
    for (const e of this.byNetId.values()) {
      if (e.dead) continue;
      const d = e.position.distanceToSquared(point);
      if (d < melhorD) {
        melhorD = d;
        melhor = e;
      }
    }
    return melhor;
  }

  applyNetwork(lista) {
    const vistos = new Set();

    for (const item of lista) {
      vistos.add(item.id);
      let alce = this.byNetId.get(item.id);

      // `d` = morto. Pode ser a primeira notícia que temos deste alce (entrei
      // depois de ele já ter caído), então nem sempre existe um local para matar.
      if (item.d) {
        alce?.killLocal();
        continue;
      }

      if (!alce) {
        alce = new Elk(
          this.scene,
          this.physics,
          this.terrain,
          elkEntity(item.id),
          item.p[0],
          item.p[2],
        );
        this.byNetId.set(item.id, alce);
      }
      alce.setNetworkTarget(item.p, item.y, item.v, item.s, item.h);
    }

    for (const [id, alce] of [...this.byNetId]) {
      if (vistos.has(id)) continue;
      this.byNetId.delete(id);
      alce.dispose();
    }
  }

  kill(id) {
    this.byNetId.get(id)?.killLocal();
  }

  clear() {
    for (const alce of this.byNetId.values()) alce.dispose();
    this.byNetId.clear();
  }

  update(dt, camera) {
    for (const alce of this.byNetId.values()) alce.update(dt, camera);
    if (!camera) return;
    camera.getWorldPosition(this._cam);
    updateLodMap(this.byNetId, this._cam, ELK_LOD_SCALE);
  }
}
