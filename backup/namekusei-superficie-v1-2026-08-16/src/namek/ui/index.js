/* ---------------------------------------------------------------------------
   A porta da interface de Namekusei.

   O laço principal importa DAQUI e de mais lugar nenhum:

       import { NamekHud } from "./namek/ui/index.js";

   Não é cerimônia. É o que mantém a promessa do §0 do plano de um jeito que não
   depende de ninguém lembrar dela: enquanto a única superfície pública for esta
   linha, o dia em que a barra de ki virar canvas, o placar virar tabela ou o
   estilo sair do JavaScript não é o dia em que `main.js` precisa ser editado —
   e um arquivo do arqueiro que não precisa ser editado é um arquivo do arqueiro
   que não quebra.

   `NamekHud` é o contrato inteiro. `NamekScoreboard` e `NamekKillFeed` saem
   junto porque a bancada de desenvolvimento (`dev/namek-hud.html`) monta os dois
   sozinhos para julgá-los sem uma partida em volta — mas o jogo não os toca: o
   HUD já os carrega dentro de si.
   --------------------------------------------------------------------------- */

export { NamekHud, CONTROLES } from "./hud.js";
export { NamekScoreboard, NamekKillFeed, nomeDoGolpe, corHex } from "./scoreboard.js";
export { aplicarEstiloNamek } from "./style.js";
export { NamekMenu, EVENTO_MENU } from "./menu.js";
/* A porta de entrada sai por aqui pela mesma razão do placar e do feed — para a
   bancada poder montá-la sozinha. O JOGO não a constrói: quem a monta é
   `input.js`, que é quem sabe se o ponteiro está travado. Ver `./porta.js`. */
export { NamekPorta } from "./porta.js";
