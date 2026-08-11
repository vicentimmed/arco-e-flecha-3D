/* ---------------------------------------------------------------------------
   As fases, na parte que o SERVIDOR também precisa saber.

   Este módulo é PURO — nada de Three.js, nada de Rapier, nada de DOM —, pelo
   mesmo motivo que `shared/terrainField.js`: a sala roda em Node, não tem placa
   de vídeo nem cena, e ainda assim precisa responder "qual é a altura em
   (x, z) nesta fase?" para escolher onde alguém nasce, e "esta fase aceita este
   modo?" para não ligar a caçada aos porcos num lugar sem porco.

   A parte VISUAL de cada fase — malha, cores, vegetação, foguete — mora em
   `levels/`, que o servidor nunca importa.

   É a mesma divisão que o projeto já usa entre `shared/terrainField.js` e
   `entities/environment.js`, e pela mesma razão.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { TerrainField } from "./terrainField.js";
import { MoonField } from "./moonField.js";

/** A fase que o jogo monta no arranque, e o destino de qualquer id inválido. */
export const DEFAULT_LEVEL = "valley";

/**
 * Todas as fases, e o que se sabe delas dos dois lados da rede.
 *
 * `modos` é a lista de modos que a fase aceita. Ela existe para que a
 * combinação impossível seja recusada num lugar só: a bacia plana do vale, as
 * copas de árvore e a trilha de terra são pré-requisitos de metade dos modos, e
 * uma fase sem eles não pode fingir que os tem.
 *
 * `fisica` é o que a fase muda em relação a `CONFIG`. O vale não muda nada — é
 * a referência —, e por isso o objeto dele é vazio em vez de repetir os valores
 * padrão, que sairiam de sincronia no primeiro ajuste de balanceamento.
 */
export const LEVEL_INFO = {
  valley: {
    id: "valley",
    nome: "Vale",
    modos: [
      "free",
      "duel",
      "teamDuel",
      "boarHunt",
      "series",
      "elkHunt",
      "zombie",
      "zombieBoss",
      "birdHunt",
    ],
    fisica: {},
    campo: () => new TerrainField(),
  },

  moon: {
    id: "moon",
    nome: "Lua",
    /* Só livre e duelo. Porcos, alces, pássaros, zumbis e a série de alvos
       dependem de bacia plana, copas de árvore e trilha de terra — coisas que
       não existem lá, e fingir que existem seria pior que recusar. */
    modos: ["free", "duel", "teamDuel"],
    /* DUELO SEM CONVITE.
     *
     * No vale o duelo é convite porque arrasta gente para uma briga no meio do
     * cenário livre, onde cada um estava fazendo a sua coisa. Ir para a Lua já
     * é uma decisão coletiva — a sala inteira viajou junto —, e ninguém pousa
     * num campo de duelo de 330 m de diâmetro para ficar assistindo. */
    duelInvites: false,
    /* Sem fauna nenhuma. Os pássaros são cenário vivo em TODOS os modos do
       vale — voam de fundo mesmo durante um duelo —, e ninguém os desligou ao
       criar a Lua porque eles nunca tinham dependido de fase. No vácuo eles
       ficam absurdos duas vezes: pela biologia e pelo som, já que o ambiente
       de "dia" toca um loop de passarinhos. */
    fauna: false,
    fisica: {
      gravity: CONFIG.levels.moon.gravity,
      airDensity: CONFIG.levels.moon.airDensity,
      wind: CONFIG.levels.moon.wind,
      jumpSpeed: CONFIG.levels.moon.jumpSpeed,
      runSpeed: CONFIG.player.runSpeed * CONFIG.levels.moon.runMultiplier,
      jetpack: CONFIG.levels.moon.jetpack,
      arrow: CONFIG.levels.moon.arrow,
    },
    campo: () => new MoonField(),
  },
};

/** Os ids existentes, na ordem em que uma tela de seleção os mostraria. */
export const LEVEL_IDS = Object.keys(LEVEL_INFO);

/** Informação de uma fase pelo id, caindo na padrão se o id não existir. */
export function levelInfo(id) {
  return LEVEL_INFO[id] ?? LEVEL_INFO[DEFAULT_LEVEL];
}

/** Um campo de altura novo para a fase. Cliente e servidor criam o mesmo. */
export function createField(id) {
  return levelInfo(id).campo();
}

/** Esta fase aceita este modo? */
export function levelAllowsMode(id, mode) {
  return levelInfo(id).modos.includes(mode);
}

/** O duelo desta fase passa por convite, ou entra direto com todo mundo? */
export function levelUsesDuelInvites(id) {
  return levelInfo(id).duelInvites !== false;
}

/**
 * Esta fase tem bicho vivo?
 *
 * Decide três coisas de uma vez: se o servidor emite pássaros, se o ambiente
 * sonoro toca o loop de dia, e se o HUD mostra os contadores de porcos e fauna.
 * As três respostas são a mesma pergunta, e separá-las era o caminho para uma
 * delas ficar para trás.
 */
export function levelHasFauna(id) {
  return levelInfo(id).fauna !== false;
}

/**
 * Qual fase suporta este modo, preferindo a que já está em cena.
 *
 * É o que faz a tecla da caçada funcionar mesmo estando numa fase que não tem
 * porcos: em vez de a tecla parecer quebrada, a troca de modo arrasta junto a
 * troca de fase.
 */
export function levelForMode(mode, atual = DEFAULT_LEVEL) {
  if (levelAllowsMode(atual, mode)) return atual;
  for (const id of LEVEL_IDS) {
    if (LEVEL_INFO[id].modos.includes(mode)) return id;
  }
  return DEFAULT_LEVEL;
}

/** Um modo que a fase aceita, mantendo o pedido quando ele é possível. */
export function fallbackMode(id, mode) {
  const modos = levelInfo(id).modos;
  return modos.includes(mode) ? mode : modos[0];
}

/* ---------------------------------------------------------------- física ----

   Os valores de REFERÊNCIA, congelados no carregamento do módulo.

   Isto parece redundante — os números estão logo ali em `CONFIG` — e não é. A
   fase é aplicada ESCREVENDO em `CONFIG` (o mesmo caminho que `applyQuality`
   já usa para os presets gráficos), porque é de `CONFIG` que a flecha lê a
   densidade do ar e o jogador lê a força do salto.

   Se `levelPhysics()` lesse `CONFIG` na hora, o padrão do vale passaria a ser
   "o que a última fase deixou lá": entrar na Lua e voltar ao vale traria a
   gravidade lunar junto, e o bug apareceria como um vale onde se pula 2,6 m —
   sem nenhuma linha de código lunar rodando para acusar.

   Capturado aqui, no topo, antes de qualquer fase existir. */
const BASE = {
  gravity: CONFIG.physics.gravity,
  airDensity: CONFIG.physics.airDensity,
  wind: true,
  jumpSpeed: CONFIG.player.jumpSpeed,
  runSpeed: CONFIG.player.runSpeed,
  arrow: {
    maxLifetime: CONFIG.arrow.maxLifetime,
    maxAltitude: CONFIG.arrow.maxAltitude,
    despawnMargin: Infinity, // o vale não tem barreira que apague flecha
    fadeOut: 0,
  },
  jetpack: null, // só existe onde a fase declara
};

/**
 * A física da fase, resolvida contra a referência.
 *
 * Uma fase declara só o que difere; tudo o mais herda. É o que permite mexer na
 * gravidade do jogo inteiro num lugar só sem revisar cada fase.
 */
export function levelPhysics(id) {
  const fase = levelInfo(id).fisica;
  return {
    ...BASE,
    ...fase,
    arrow: { ...BASE.arrow, ...(fase.arrow ?? {}) },
  };
}
