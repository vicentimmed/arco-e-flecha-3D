/* ---------------------------------------------------------------------------
   Gerenciador de zumbis.

   Mesma divisão do `boarManager` e do `elkManager`: os zumbis são do SERVIDOR e
   aqui existe só a casca — criar, remover e alimentar cada um com a pose que
   chega a 10 Hz.

   A diferença é a escala. Na horda 10 são 21 corpos entrando quase ao mesmo
   tempo, e é por isso que a criação passa por um caminho enxuto: as geometrias
   do zumbi são compartilhadas (ver `entities/zombie.js`) e o que sobra por bicho
   é um punhado de `Mesh` e um corpo cinemático.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { Zombie } from "../entities/zombie.js";
import { zombieEntity } from "../shared/protocol.js";
import { updateLodMap } from "../utils/lod.js";

export class ZombieManager {
  constructor(scene, physics, terrain) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    /** @type {Map<number, Zombie>} id do servidor → casca local */
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
      let zumbi = this.byNetId.get(item.id);

      // `d` = morto. Pode ser a primeira notícia que temos deste zumbi (entrei
      // depois de ele já ter caído), então nem sempre existe um local para matar.
      if (item.d) {
        zumbi?.killLocal(item.b === 1);
        continue;
      }

      if (!zumbi) {
        zumbi = new Zombie(
          this.scene,
          this.physics,
          this.terrain,
          zombieEntity(item.id),
          item.p[0],
          item.p[2],
        );
        this.byNetId.set(item.id, zumbi);
      }
      zumbi.setNetworkTarget(item.p, item.y, item.s, item.b === 1);
    }

    for (const [id, zumbi] of [...this.byNetId]) {
      if (vistos.has(id)) continue;
      this.byNetId.delete(id);
      zumbi.dispose();
    }
  }

  /**
   * Derruba um zumbi na hora, sem esperar a confirmação.
   *
   * Mesmo critério do pássaro: o retorno do tiro tem de ser imediato. Meio ping
   * de silêncio entre acertar a cabeça e ver o bicho pegar fogo é o suficiente
   * para a pessoa achar que errou — e neste modo ela vai atirar de novo, gastando
   * uma flecha e o tempo que não tem.
   */
  kill(id, head = false) {
    this.byNetId.get(id)?.killLocal(head);
  }

  clear() {
    for (const z of this.byNetId.values()) z.dispose();
    this.byNetId.clear();
  }

  /**
   * O passo da horda.
   *
   * O LOD roda com escala 1 — ou seja, o corpo some no `cullDistance` cheio.
   * Não é um número escolhido no olho: a névoa da noite (`fogDensityNight`,
   * 0,017) já apaga 65 % de um corpo a 60 m e praticamente tudo a 80 m, então o
   * que se deixa de desenhar ali é névoa pintada por cinco malhas. Os OLHOS
   * ficam fora do LOD e continuam aparecendo — ver `entities/zombie.js`.
   */
  update(dt, camera) {
    for (const z of this.byNetId.values()) z.update(dt, camera);
    if (!camera) return;
    camera.getWorldPosition(this._cam);
    updateLodMap(this.byNetId, this._cam);
  }
}
