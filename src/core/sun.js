/* ---------------------------------------------------------------------------
   A direção do sol.

   Um módulo de uma linha porque TRÊS lugares precisam do mesmo vetor e nenhum
   pode ser dono dele:

   • `core/renderer.js` posiciona a luz direcional e o disco no shader do céu;
   • `core/directionalFog.js` compila a direção dentro dos trechos de névoa;
   • `entities/environment.js` assa a sombra da vegetação nas cores de vértice
     do terreno.

   Fosse cada um com a sua cópia, a sombra assada no chão apontaria para um lado
   e a sombra dinâmica para outro — e o erro só apareceria olhando o pé de uma
   árvore ao entardecer, que é o último lugar onde alguém procura.

   O sol NÃO SE MOVE neste jogo. É isso que permite assar a sombra da vegetação
   uma vez, no carregamento, e não pagar mais nada por ela em nenhum quadro.
   --------------------------------------------------------------------------- */

import * as THREE from "three";

/** Do chão APONTANDO PARA o sol (não a direção em que a luz viaja). */
export const SUN_DIR = new THREE.Vector3(-0.42, 0.66, 0.62).normalize();
