/* ---------------------------------------------------------------------------
   Os ids das skins, e só isso.

   Este arquivo vive em `shared/` porque o SERVIDOR precisa dele: a skin viaja
   no `hello`, e quem valida é a sala (ver `room.js`). Ele não pode importar
   Three nem nada de desenho — a aparência propriamente dita mora em
   `entities/skins/`, que é código de cliente.

   A validação é do servidor por um motivo prático, não de segurança: um cliente
   adiantado (ou uma aba velha em cache) mandando um id que não existe faria o
   boneco dele sumir da tela de todo mundo. Id desconhecido vira o padrão, e a
   partida continua.

   ------------------------------------------------------------- a arqueira ---

   A skin original ("atleta") saiu desta lista a pedido: o jogo passou a ter um
   corpo só, o arqueiro medieval, sem escolha na tela de entrada. O arquivo dela
   continua existindo em `entities/skins/atleta.js` e registrado em
   `entities/skins/index.js` — OCULTA, não apagada — porque é código que
   funciona e pode voltar a ser útil (a bancada `dev/skins.html` ainda a usa
   para comparar). O que a tira do JOGO é justamente não estar mais aqui: com
   ela fora de `SKIN_IDS`, qualquer `skin` que chegue pela rede (de uma aba
   velha em cache, por exemplo) sanea para o padrão, e "atleta" nunca aparece
   numa sala de verdade.
   --------------------------------------------------------------------------- */

/** O arqueiro medieval. É o único corpo do jogo — não há escolha nem padrão. */
export const DEFAULT_SKIN = "medieval";

/** As skins que o jogo mostra. Ver a nota acima sobre a arqueira. */
export const SKIN_IDS = ["medieval"];

/** Um id que se pode confiar: qualquer coisa fora da lista vira o padrão. */
export function sanitizeSkin(raw) {
  return SKIN_IDS.includes(raw) ? raw : DEFAULT_SKIN;
}
