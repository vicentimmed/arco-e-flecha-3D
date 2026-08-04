/* ---------------------------------------------------------------------------
   Gerenciador de porcos.

   Os porcos são do SERVIDOR. Aqui só existe a casca: criar, remover e alimentar
   cada bicho com a pose que chega a 10 Hz. A máquina de estados vive em
   `server/boarSim.js` porque ela sorteia — e IA sorteada rodando em cada
   navegador daria, em segundos, um bando diferente por tela: você atiraria num
   porco que, para o seu amigo, já tinha saído dali.

   O susto por flecha também é do servidor: `Room` avisa `BoarHunt.scareNear()`
   a cada impacto, para que o bando inteiro reaja igual em todas as telas.
   --------------------------------------------------------------------------- */

import { Boar } from "../entities/boar.js";
import { boarEntity } from "../shared/protocol.js";

export class BoarManager {
  constructor(scene, physics, terrain) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    /** @type {Map<number, Boar>} id do servidor → casca local */
    this.byNetId = new Map();
  }

  get boars() {
    return [...this.byNetId.values()];
  }

  get counts() {
    let alive = 0;
    let dead = 0;
    for (const b of this.byNetId.values()) {
      if (b.dead) dead++;
      else alive++;
    }
    return { alive, dead };
  }

  /** A lista completa de porcos, como o servidor a vê. */
  applyNetwork(lista) {
    const vistos = new Set();

    for (const item of lista) {
      vistos.add(item.id);
      let porco = this.byNetId.get(item.id);

      // `d` = morto. Pode ser a primeira notícia que temos deste porco (entrei
      // depois de ele já ter caído), então nem sempre existe um local para matar.
      if (item.d) {
        porco?.killLocal();
        continue;
      }

      if (!porco) {
        porco = new Boar(
          this.scene,
          this.physics,
          this.terrain,
          boarEntity(item.id),
          item.p[0],
          item.p[2],
        );
        this.byNetId.set(item.id, porco);
      }
      porco.setNetworkTarget(item.p, item.y, item.v, item.s);
    }

    // Sumiu da lista do servidor: o corpo expirou e sai da cena.
    for (const [id, porco] of [...this.byNetId]) {
      if (vistos.has(id)) continue;
      this.byNetId.delete(id);
      porco.dispose();
    }
  }

  /** Morte anunciada pelo servidor. */
  kill(id) {
    this.byNetId.get(id)?.killLocal();
  }

  /** Sai do modo caçada: todo o bando some. */
  clear() {
    for (const porco of this.byNetId.values()) porco.dispose();
    this.byNetId.clear();
  }

  update(dt) {
    for (const porco of this.byNetId.values()) porco.update(dt);
  }
}
