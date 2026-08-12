/* ---------------------------------------------------------------------------
   Fase 3 — o Castelo.

   Terra igual à do vale: mesma gravidade, mesmo ar, mesmo vento. O que muda é a
   HORA (é noite) e a ARQUITETURA — e aqui a arquitetura não é cenário, é regra:
   o adarve a 11 m, os merlões que fazem cobertura, o portão que decide a
   partida e o esporão com um lado só de aproximação.

   Fina de propósito, como as outras duas: esta classe MONTA e DESMONTA. O chão
   é `entities/castleGround.js` (matemática em `shared/castleField.js`), a
   alvenaria é `entities/castle.js` (medidas em `shared/castleProps.js`) e o
   portão é `entities/gate.js`. Uma fase é um roteiro de construção, não um
   lugar para lógica de jogo — quem tem a lógica do cerco é `systems/siege.js`
   no cliente e `server/siegeSim.js` na sala.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CastleTerrain } from "../entities/castleGround.js";
import { Castle } from "../entities/castle.js";
import { Gate } from "../entities/gate.js";
import { disposeSubtree } from "./resources.js";

export class CastleLevel {
  static id = "castle";

  /* Nome, modos aceitos (livre, duelo e cerco) e física estão em
     `shared/levels.js`: o servidor precisa deles e não pode importar este
     arquivo, que arrasta Three.js junto. */

  build(ctx, progresso = () => {}) {
    this.root = new THREE.Group();
    this.root.name = "level:castle";
    ctx.scene.add(this.root);

    progresso(0.15, "levantando o esporão…");
    this.terrain = new CastleTerrain().build(this.root, ctx.physics);

    progresso(0.7, "erguendo a muralha…");
    this.castle = new Castle().build(this.root, ctx.physics);

    progresso(0.9, "pendurando o portão…");
    this.gate = new Gate().build(this.root, ctx.physics);

    progresso(1, "pronto");
    return this;
  }

  /** Os três postos de trabuco, para quem monta os engenhos. */
  get trebuchetPosts() {
    return this.castle?.postos ?? [];
  }

  /** Não há copa nenhuma aqui: as aves ficariam no ar — e a fase não tem aves. */
  nearestPerch() {
    return null;
  }

  /** Sem bandeirola de vento: o cenário é pedra, e o vento se lê na flecha. */
  get flags() {
    return [];
  }

  /**
   * A assinatura é a de TODAS as fases, e por isso tem buracos.
   *
   * `main.js` chama uma só vez, com os mesmos argumentos, e cada fase pega o
   * que lhe serve: o vale usa o vento, a Lua usa os jogadores e o relógio da
   * sala, o castelo usa o entardecer. Uma assinatura por fase obrigaria o laço
   * a saber em qual fase está — que é exatamente o que o contrato de
   * `levels/index.js` existe para evitar.
   *
   * @param {number} dt
   * @param {object} _wind o vale usa; aqui não há bandeirola nem copa
   * @param {Array} _jogadores a Lua usa (os aliens perseguem)
   * @param {number} _tempoSala a Lua usa (baliza e cadentes em fase)
   * @param {number} dusk quanto o Sol já desceu (0 a 1). Ver `Game.updateDusk`.
   */
  update(dt, _wind, _jogadores, _tempoSala, dusk = 0) {
    this.castle?.update(dt, dusk);
    this.gate?.update(dt);
  }

  dispose() {
    // O portão tem corpo no mundo de física e precisa sair ANTES do
    // `recreate()` — mas quem garante isso é o `recreate()`, que varre tudo.
    // Aqui só soltamos as referências. Ver `levels/index.js`.
    this.gate?.dispose();
    this.castle?.dispose();
    this.terrain?.dispose();
    const contagem = disposeSubtree(this.root);
    this.root = null;
    this.terrain = null;
    this.castle = null;
    this.gate = null;
    return contagem;
  }
}
