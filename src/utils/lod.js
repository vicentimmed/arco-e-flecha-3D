/* ---------------------------------------------------------------------------
   Nível de detalhe por distância.

   O gargalo deste jogo nunca foi triângulo — é CONTAGEM DE OBJETO. Um javali
   são trinta `Mesh`; trinta javalis vivos são novecentas chamadas de desenho, e
   nove décimos delas descrevem presas de 2 cm num bicho que ocupa quatro pixels
   na tela. O custo é o mesmo desenhando de perto ou de longe.

   Daí este módulo. Cada bicho declara o que é silhueta e o que é detalhe, e a
   distância à câmera decide o que ainda vale desenhar:

     0 · perto      tudo
     1 · médio      some o detalhe fino (olho, narina, cerda, presa)
     2 · longe      sobra a silhueta (corpo e cabeça)
     3 · fora       não é desenhado

   Os limites saem de UM número — `CONFIG.render.cullDistance` —, que é o que o
   preset de qualidade mexe. Assim baixar a qualidade encurta os três anéis de
   uma vez, em vez de exigir três ajustes coerentes entre si.

   O corte é HISTERÉTICO: subir de nível exige 12 % a mais de distância do que
   descer. Sem isso, um bicho parado exatamente no limite pisca entre dois níveis
   a cada frame — e piscar lê como bug, não como economia.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";

/** Frações de `cullDistance` em que cada nível começa. */
const DETAIL = 0.45; // 0 → 1
const SILHOUETTE = 1.0; // 1 → 2
const HIDE = 2.6; // 2 → 3
const HYSTERESIS = 1.12;

/**
 * Em que nível um objeto a `dist` metros deve estar, dado o nível atual.
 *
 * @param {number} dist distância à câmera, em metros
 * @param {number} atual nível em que o objeto está agora (para a histerese)
 * @param {number} escala multiplicador do alcance deste bicho — um alce é
 *   visível de muito mais longe que um pássaro, e o modo caçada pontua abates a
 *   120 m, então nem todos podem sumir no mesmo raio.
 */
export function lodLevel(dist, atual = 0, escala = 1) {
  const base = CONFIG.render.cullDistance * escala;
  // Subindo de nível (afastando) o limiar é maior; descendo, é o nominal.
  const k = (limite, nivel) => (atual < nivel ? limite * HYSTERESIS : limite);
  if (dist >= k(base * HIDE, 3)) return 3;
  if (dist >= k(base * SILHOUETTE, 2)) return 2;
  if (dist >= k(base * DETAIL, 1)) return 1;
  return 0;
}

/**
 * Aplica um nível a um bicho que expõe `lodDetail` e `lodBulk`.
 *
 * `lodDetail` são os objetos que somem no nível 1 (detalhe fino) e `lodBulk` os
 * que somem no nível 2 (tudo o que não é silhueta). No nível 3 o grupo inteiro
 * sai do render — o corpo cinemático e a lógica continuam rodando, porque um
 * bicho que para de pensar quando ninguém olha reaparece no lugar errado.
 *
 * Escreve `visible` só na VIRADA de nível: `visible` é uma propriedade simples,
 * mas são dezenas de objetos por bicho e trinta bichos em campo.
 */
export function applyLod(entity, nivel) {
  if (entity._lod === nivel) return;
  const antes = entity._lod ?? 0;
  entity._lod = nivel;

  if (nivel >= 3 || antes >= 3) entity.group.visible = nivel < 3;
  if (nivel >= 3) return;

  const detalhe = nivel < 1;
  const volume = nivel < 2;
  if (entity.lodDetail) for (const o of entity.lodDetail) o.visible = detalhe;
  if (entity.lodBulk) for (const o of entity.lodBulk) o.visible = volume;
}

/**
 * Percorre um mapa de bichos aplicando o LOD de uma vez.
 *
 * Fica aqui, e não em cada gerenciador, porque os quatro fariam exatamente o
 * mesmo laço — e porque é aqui que se vê que a conta é uma raiz quadrada por
 * bicho por quadro, e nada mais.
 */
export function updateLodMap(mapa, cameraPos, escala = 1) {
  if (!cameraPos) return;
  for (const e of mapa.values()) {
    const sc = e.lodScale ?? escala;
    applyLod(e, lodLevel(e.position.distanceTo(cameraPos), e._lod ?? 0, sc));
  }
}
