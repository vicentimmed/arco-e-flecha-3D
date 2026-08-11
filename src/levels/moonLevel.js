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

  update(dt) {
    /* Quase nada se mexe sozinho aqui: sem ar não há balanço de grama nem
       bandeira tremulando, e é essa quietude que o vácuo transmite. O que pisca
       é a baliza do foguete — e ela pisca justamente porque é a única coisa
       viva num horizonte parado. */
    this.base?.update(dt);
  }

  dispose() {
    this.terrain?.dispose();
    this.base?.dispose();
    const contagem = disposeSubtree(this.root);
    this.root = null;
    this.terrain = null;
    this.base = null;
    return contagem;
  }
}
