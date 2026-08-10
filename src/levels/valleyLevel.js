/* ---------------------------------------------------------------------------
   Fase 1 — o vale.

   É o cenário que o jogo sempre teve, agora embrulhado no contrato de fase.
   Nada aqui é novo: `createEnvironment` continua esculpindo o relevo, semeando
   a vegetação e assando a oclusão exatamente como antes, e `createTargets`
   continua plantando os sete alvos do campo de tiro.

   O que mudou é só QUEM É O DONO. Antes tudo era criado uma vez no arranque e
   pendurado direto na cena, sem ninguém responsável por desmontar; agora tem
   uma raiz, um `dispose()` e um ciclo de vida.

   Por isso esta fase é o TESTE do sistema: `vale → vale` tem de reconstruir um
   vale idêntico, sem diferença visível na tela e sem geometria vazando. Se a
   mecânica de troca estiver certa aqui, onde não há nenhuma variável nova, ela
   está certa para a Lua.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { createEnvironment } from "../entities/environment.js";
import { createTargets } from "../entities/target.js";
import { disposeSubtree } from "./resources.js";

export class ValleyLevel {
  static id = "valley";

  /* O nome, os modos aceitos e a física estão em `shared/levels.js`: o
     servidor precisa deles e não pode importar este arquivo, que arrasta
     Three.js junto. O vale aceita todos os modos e não altera física nenhuma —
     ele é a referência de ambos. */

  async build(ctx, progresso = () => {}) {
    this.root = new THREE.Group();
    this.root.name = "level:valley";
    ctx.scene.add(this.root);

    progresso(0.1, "esculpindo o vale…");
    this.environment = createEnvironment(this.root, ctx.physics);
    this.terrain = this.environment.terrain;

    progresso(0.85, "posicionando alvos…");
    this.targets = createTargets(this.root, ctx.physics, ctx.sync, this.terrain);

    progresso(1, "pronto");
    return this;
  }

  /**
   * Copas onde um pássaro pode pousar. Específico do vale — na Lua não há
   * árvore, e quem pergunta recebe `null` e deixa a ave no ar.
   */
  nearestPerch(x, z, maxDist) {
    return this.environment.nearestPerch(x, z, maxDist);
  }

  /** Bandeirolas de vento: o modo zumbi as esconde (campo limpo). */
  get flags() {
    return this.environment.flags;
  }

  update(dt, wind) {
    this.environment.update(dt, wind);
  }

  /**
   * Demole o vale.
   *
   * Só o visual: corpos e colisores são varridos por `PhysicsWorld.recreate()`,
   * que o gerente chama logo em seguida. Uma varredura manual de corpos
   * garantiria a limpeza por disciplina; trocar o mundo garante por construção.
   */
  dispose() {
    const contagem = disposeSubtree(this.root);
    this.root = null;
    this.environment = null;
    this.terrain = null;
    this.targets = [];
    return contagem;
  }
}
