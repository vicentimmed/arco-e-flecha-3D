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

/**
 * A física da fase, já resolvida contra os padrões de `CONFIG`.
 *
 * Uma fase declara só o que difere; tudo o mais herda. É o que permite mexer na
 * gravidade do jogo inteiro num lugar só sem ter de revisar cada fase.
 */
export function levelPhysics(id) {
  return {
    gravity: CONFIG.physics.gravity,
    airDensity: CONFIG.physics.airDensity,
    /** Há ar mexendo? Falso na Lua — e aí não há vento NEM arrasto. */
    wind: true,
    jumpSpeed: CONFIG.player.jumpSpeed,
    ...levelInfo(id).fisica,
  };
}
