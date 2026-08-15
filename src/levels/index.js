/* ---------------------------------------------------------------------------
   As fases do jogo, e o contrato que todas cumprem.

   Uma fase é ONDE se joga; um modo é O QUE se joga. São eixos independentes:
   o duelo é o mesmo duelo no vale e na Lua, com o mesmo convite, o mesmo placar
   e o mesmo renascimento — muda o chão, a gravidade e o céu.

   Misturar os dois seria o caminho curto: bastaria um modo `duelo na Lua`. Mas
   aí "a série de alvos na Lua" pediria outro modo gêmeo, e "a caçada em Marte"
   mais outro — cada combinação virando uma cópia da lógica inteira. Com os
   eixos separados, uma fase nova é um arquivo e uma linha no registro abaixo,
   e ela declara sozinha quais modos aceita.

   ------------------------------------------------------------------- o ciclo

   Trocar de fase é DESTRUIR e RECONSTRUIR, com carregamento no meio. Não é
   esconder o cenário antigo: o jogo tem um mundo de física só, e uma malha
   invisível continua com o colisor no lugar — o jogador bateria em troncos que
   não existem e as flechas cravariam no ar.

   A sequência está inteira em `LevelManager.swap()`, e a ordem dela não é
   arbitrária — cada passo depende do anterior estar feito. Ver os comentários
   lá.

   ------------------------------------------------------------------ contrato

   Uma fase é uma classe com:

     static id                        "valley"
     build(ctx, progresso) → Promise  — monta tudo dentro de `this.root`
     dispose()                        — devolve tudo o que `build` criou
     update(dt, wind)                 — opcional, por frame

   E duas garantias que ela precisa respeitar:

   • **Tudo pendura em `this.root`.** É o que torna a demolição uma varredura
     só, em vez de uma lista de grupos que envelhece mal.
   • **Nada de recurso de módulo dentro do `dispose()`.** A regra e a proteção
     estão em `resources.js`.

   O nome, os modos aceitos, a física e o campo de altura NÃO ficam aqui: moram
   em `shared/levels.js`, que é puro e que o servidor também importa. Este
   arquivo é o lado que só existe no navegador.
   --------------------------------------------------------------------------- */

import { DEFAULT_LEVEL, LEVEL_IDS, levelPhysics } from "../shared/levels.js";
import { ValleyLevel } from "./valleyLevel.js";
import { MoonLevel } from "./moonLevel.js";
import { CastleLevel } from "./castleLevel.js";
import { SandboxLevel } from "./sandboxLevel.js";

/**
 * O registro das classes visuais. Uma linha por fase.
 *
 * A contraparte pura é `LEVEL_INFO`, em `shared/levels.js`. Os dois têm de
 * listar as mesmas fases — e é por isso que a checagem logo abaixo existe: um
 * id declarado num e esquecido no outro daria um erro obscuro só na hora da
 * troca, e não no arranque.
 */
export const LEVELS = {
  [ValleyLevel.id]: ValleyLevel,
  [MoonLevel.id]: MoonLevel,
  [CastleLevel.id]: CastleLevel,
  [SandboxLevel.id]: SandboxLevel,
};

export { DEFAULT_LEVEL };

/* A checagem prometida no comentário acima. Roda uma vez, no carregamento do
   módulo, e custa um `for` sobre meia dúzia de chaves. Sem ela, esquecer uma
   das duas listas produz uma fase que existe para o servidor e não para o
   cliente (ou o contrário) — e o sintoma é uma troca que "não faz nada", já
   com todo mundo esperando na tela de carregamento. */
for (const id of LEVEL_IDS) {
  if (!LEVELS[id]) throw new Error(`fase "${id}" está em shared/levels.js mas não tem classe em levels/`);
}
for (const id of Object.keys(LEVELS)) {
  if (!LEVEL_IDS.includes(id)) throw new Error(`fase "${id}" tem classe mas não está em shared/levels.js`);
}

/** A classe visual de uma fase, ou a padrão se o id não existir. */
export function levelClass(id) {
  return LEVELS[id] ?? LEVELS[DEFAULT_LEVEL];
}

/* ------------------------------------------------------------------ gerente -

   Quem executa a troca. É o único lugar do jogo que conhece a ordem — e a
   ordem é a parte difícil. */

export class LevelManager {
  /**
   * @param {object} ctx tudo o que uma fase precisa para se construir e o que
   *   o gerente precisa para religar o jogo depois da troca. Ver `main.js`.
   */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {object|null} a fase em cena */
    this.current = null;
    this.id = null;
    /** Diagnóstico da última troca — alimenta o critério de aceite. */
    this.lastSwap = null;
  }

  get terrain() {
    return this.current?.terrain ?? null;
  }

  /**
   * Monta a primeira fase. Não há nada a destruir.
   *
   * SÍNCRONO de propósito: roda dentro do construtor do jogo, que por sua vez
   * roda enquanto a pessoa digita o nome no lobby (ver o `bootstrap` de
   * `main.js`). Quem precisa de barra de progresso pintando no meio é a TROCA,
   * não a montagem inicial — e essa é `swap()`, que é assíncrona.
   */
  build(id, progresso = () => {}) {
    const Fase = levelClass(id);
    this.id = Fase.id;
    this.current = new Fase();
    this.current.build(this.ctx, progresso);
    this.ctx.onLevelReady?.(this.current, this.id);
    return this.current;
  }

  /**
   * Troca de fase: demole a atual e constrói a nova.
   *
   * A ordem abaixo é a parte que importa, e cada passo existe por um motivo
   * que já custou caro em algum projeto:
   *
   * 1. **Esvaziar quem tem corpo, ANTES de trocar o mundo.** Bichos, flechas e
   *    tochas guardam corpos e os removem no próprio `clear()`. Chamar isso
   *    depois do `recreate()` seria remover um corpo de um mundo que já foi
   *    liberado — ponteiro morto, e o Rapier não avisa, ele quebra.
   *
   * 2. **Demolir o visual da fase.** `scene.remove()` não devolve memória de
   *    vídeo; quem devolve é o `dispose()` que a fase implementa.
   *
   * 3. **Trocar o mundo de física.** Varre por construção o que sobrou de
   *    colisor, e já entra com a gravidade da fase nova.
   *
   * 4. **Construir a fase nova.** Só agora existe um mundo onde criar corpos.
   *
   * 5. **Religar quem sobreviveu.** O jogador e os remotos atravessam a troca:
   *    precisam do terreno novo e de cápsulas novas. Isso vem DEPOIS do build
   *    porque a altura dos pés sai do terreno que acabou de nascer.
   *
   * @returns {Promise<object>} diagnóstico `{ ms, freed }`
   */
  async swap(id, progresso = () => {}) {
    const t0 = performance.now();
    const { ctx } = this;
    const respirar = ctx.nextFrame ?? (() => Promise.resolve());

    progresso(0.05, "desmontando o cenário…");
    await respirar();
    ctx.beforeDispose?.();

    const liberado = this.current?.dispose() ?? null;
    this.current = null;

    progresso(0.2, "trocando o mundo…");
    // SEM await aqui: fecha a janela em que um pacote de rede (a rede não
    // para durante a troca) criaria corpos que o recreate() logo orfanaria.
    const Fase = levelClass(id);
    ctx.physics.recreate(levelPhysics(Fase.id).gravity);
    ctx.sync.clear();
    await respirar();

    progresso(0.3, "construindo a fase…");
    await respirar();
    this.id = Fase.id;
    this.current = new Fase();
    this.current.build(ctx, (f, texto) => progresso(0.3 + f * 0.6, texto));

    progresso(0.95, "recolocando os jogadores…");
    await respirar();
    ctx.onLevelReady?.(this.current, this.id);

    this.lastSwap = {
      ms: Math.round(performance.now() - t0),
      freed: liberado,
      bodies: ctx.physics.bodyCount,
    };
    return this.lastSwap;
  }
}
