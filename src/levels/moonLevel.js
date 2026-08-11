/* ---------------------------------------------------------------------------
   Fase 2 — a Lua.

   Gravidade de 1,62 m/s², vácuo, um chão de regolito com 144 crateras e uma
   base com um foguete que dá para escalar de jetpack.

   Esta classe é fina de propósito: ela MONTA e DESMONTA, e a inteligência está
   nas peças. O chão é `entities/moonGround.js`; a matemática dele é
   `shared/moonField.js`, que o servidor também usa. Uma fase é um roteiro de
   construção, não um lugar para lógica de jogo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { MoonTerrain } from "../entities/moonGround.js";
import { MoonBase } from "../entities/moonBase.js";
import { SpaceLife } from "../systems/spaceLife.js";
import { disposeSubtree } from "./resources.js";

export class MoonLevel {
  static id = "moon";

  /* Nome, modos aceitos (só `free` e `duel`) e física estão em
     `shared/levels.js`: o servidor precisa deles e não pode importar este
     arquivo, que arrasta Three.js junto. */

  build(ctx, progresso = () => {}) {
    this.root = new THREE.Group();
    this.root.name = "level:moon";
    ctx.scene.add(this.root);

    progresso(0.15, "assentando o regolito…");
    this.terrain = new MoonTerrain().build(this.root, ctx.physics);

    progresso(0.8, "montando a base…");
    this.base = new MoonBase().build(this.root, ctx.physics, this.terrain);

    progresso(0.95, "acendendo o céu…");
    this.space = new SpaceLife(
      this.root,
      ctx.scene,
      ctx.physics,
      this.terrain,
      ctx.camera,
    );

    progresso(1, "pronto");
    return this;
  }

  /** Altura do piso da plataforma do foguete — o ponto alto do mapa. */
  get platformY() {
    return this.base?.platformY ?? null;
  }

  /** Não há copa nenhuma na Lua: as aves ficam no ar em vez de pousar no vazio. */
  nearestPerch() {
    return null;
  }

  /** Não há bandeirola de vento onde não há vento. */
  get flags() {
    return [];
  }

  /**
   * @param {number} dt
   * @param {object} _wind ignorado: não há vento aqui
   * @param {Array<{x:number,z:number}>} jogadores quem os aliens perseguem
   */
  update(dt, _wind, jogadores = [], tempoSala = 0) {
    /* Sem ar não há balanço de grama nem bandeira tremulando, e essa quietude é
       o que o vácuo transmite — mas um cenário TOTALMENTE parado lê como tela
       congelada. O que se mexe aqui foi escolhido para dar movimento a camadas
       de profundidade diferentes: a baliza no foguete, a poeira ao redor do
       jogador, as cadentes no infinito, as naves na média distância e os aliens
       no chão. Ver `systems/spaceLife.js`. */
    this.base?.update(dt, tempoSala);
    this.space?.update(dt, jogadores, tempoSala);
    /* O atropelamento do rover é decidido no SERVIDOR (`server/spaceSim.js`):
       ele vale para as duas telas ao mesmo tempo, e este lado só vê o alien
       sumir da amostra e derreter. */
  }

  dispose() {
    this.terrain?.dispose();
    this.base?.dispose();
    // Naves e aliens têm corpo no mundo de física: precisam sair ANTES do
    // `recreate()`, e é aqui que ainda dá tempo. Ver `levels/index.js`.
    this.space?.dispose();
    this.space = null;
    const contagem = disposeSubtree(this.root);
    this.root = null;
    this.terrain = null;
    this.base = null;
    return contagem;
  }
}
