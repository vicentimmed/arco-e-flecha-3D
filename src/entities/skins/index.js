/* ---------------------------------------------------------------------------
   O registro das skins.

   Uma skin é a FANTASIA do arqueiro: as primitivas e os materiais pendurados
   nas juntas. O rig — estado, IK, pose, rede, LOD, ragdoll — é o `Player`, e ele
   não sabe o nome de nenhuma peça de roupa.

   Acrescentar uma skin é: um arquivo aqui, uma linha no `SKIN_IDS` de
   `shared/skins.js` (porque o servidor valida contra ela) e nada mais. Nenhuma
   linha de pose, de câmera, de física ou de rede muda — e é exatamente esse o
   ponto de ter separado as duas coisas.

   ------------------------------------------------------------- o contrato

   Toda skin exporta um objeto com:

     id, label, detalhe, swatch   identidade e o que a tela de entrada mostra
     bowPalette                   cores do arco, ou null para o arco padrão
     createMaterials()            materiais NOVOS a cada corpo (ver abaixo)
     tint(mat, cor)               onde a cor do jogador entra
     build(rig)                   pendura o corpo e devolve os HANDLES

   Os handles devolvidos por `build` não são uma lista arbitrária: são
   exatamente os nomes que o código de pose já lê.

     head        THREE.Group, filho de `rig.spine` — a cabeça inteira
     faceDetail  peças que somem acima de 12 m (ver `Player.setFaceDetail`)
     sway        { root, a, b, tip, tuning } ou null — a ponta que balança
     armR, armL  { group, upper, fore, elbow, hand, band }
     legR, legL  { group, thigh, shin, knee, shoe, short }

   E há quatro materiais que o RIG usa por conta própria, na flecha da mão e na
   faca: `arrowShaft`, `fletch`, `metal` e `leatherDark`. Toda skin precisa
   tê-los.

   Materiais são POR CORPO, nunca de módulo: material compartilhado faria tingir
   um de azul tingir a sala inteira, e o piscar de quem renasceu piscar todo
   mundo junto. Daí `createMaterials` ser função.
   --------------------------------------------------------------------------- */

import { DEFAULT_SKIN, SKIN_IDS } from "../../shared/skins.js";
import { atleta } from "./atleta.js";
import { medieval } from "./medieval.js";

/**
 * Toda skin MONTÁVEL — inclui a arqueira, que está oculta do jogo (ver
 * `shared/skins.js`) mas continua registrada aqui para a bancada
 * (`dev/skins.html`) poder construí-la e comparar.
 */
export const SKINS = [atleta, medieval];

const POR_ID = new Map(SKINS.map((s) => [s.id, s]));

/* A checagem é NUM SÓ SENTIDO: toda skin que o jogo oferece (`SKIN_IDS`)
 * precisa estar registrada aqui, ou o `hello` mandaria um id que a sala aceita
 * mas que ninguém sabe desenhar. O sentido contrário NÃO é erro — uma skin
 * registrada e fora de `SKIN_IDS` é exatamente o estado de "oculta", e a
 * arqueira vive nele de propósito. */
for (const id of SKIN_IDS) {
  if (!POR_ID.has(id)) {
    console.warn(`"${id}" está em SKIN_IDS mas não tem skin registrada — o jogo vai travar ao montá-la`);
  }
}

/** A skin de um id. Id desconhecido devolve o padrão, nunca `undefined`. */
export function getSkin(id) {
  return POR_ID.get(id) ?? POR_ID.get(DEFAULT_SKIN) ?? SKINS[0];
}
