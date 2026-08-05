/* ---------------------------------------------------------------------------
   Gerenciador de pássaros.

   Como os porcos e os alces, o bando é do servidor. A diferença é que ele não
   pertence a modo nenhum: existe sempre, em qualquer partida.

   A única decisão que fica do lado do cliente é ONDE, exatamente, um pássaro
   pousa — o servidor manda um (x, z) e cada cliente procura a copa mais próxima
   na sua própria vegetação. O porquê está no cabeçalho de `entities/bird.js` e
   em `server/birdSim.js`; aqui basta ter a função em mãos.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { Bird } from "../entities/bird.js";
import { birdEntity } from "../shared/protocol.js";
import { updateLodMap } from "../utils/lod.js";

/* O bando circula num raio de 70 m a 26 m de altura, e o tiro no pássaro é o
   mais difícil do jogo justamente por isso. Um alcance de LOD generoso é o que
   mantém o alvo existindo: some o bico, nunca a silhueta. */
const BIRD_LOD_SCALE = 1.8;

export class BirdManager {
  /**
   * @param {(x: number, z: number) => {x,y,z}|null} acharPoleiro devolve a copa
   *   mais próxima de um ponto do chão, ou null se não houver árvore por perto.
   */
  constructor(scene, physics, terrain, acharPoleiro) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.acharPoleiro = acharPoleiro;
    /** @type {Map<number, Bird>} */
    this.byNetId = new Map();
    this._cam = new THREE.Vector3();
  }

  get counts() {
    let alive = 0;
    for (const b of this.byNetId.values()) if (!b.dead) alive++;
    return { alive, total: this.byNetId.size };
  }

  applyNetwork(lista) {
    const vistos = new Set();

    for (const item of lista) {
      vistos.add(item.id);
      let ave = this.byNetId.get(item.id);

      if (!ave) {
        ave = new Bird(
          this.scene,
          this.physics,
          this.terrain,
          birdEntity(item.id),
          item.p[0],
          item.p[1],
          item.p[2],
        );
        this.byNetId.set(item.id, ave);
      }
      if (item.s === "dead") ave.killLocal();
      else ave.setNetworkTarget(item.p, item.y, item.s, item.k);
    }

    for (const [id, ave] of [...this.byNetId]) {
      if (vistos.has(id)) continue;
      this.byNetId.delete(id);
      ave.dispose();
    }
  }

  kill(id) {
    this.byNetId.get(id)?.killLocal();
  }

  clear() {
    for (const ave of this.byNetId.values()) ave.dispose();
    this.byNetId.clear();
  }

  update(dt, camera) {
    for (const ave of this.byNetId.values()) ave.update(dt, this.acharPoleiro);
    if (!camera) return;
    camera.getWorldPosition(this._cam);
    updateLodMap(this.byNetId, this._cam, BIRD_LOD_SCALE);
  }
}
