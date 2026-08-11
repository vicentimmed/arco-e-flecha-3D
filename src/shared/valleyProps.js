/* ---------------------------------------------------------------------------
   Onde ficam as árvores e as rochas do vale — só as POSIÇÕES.

   Puro, como `terrainField.js`, e pelo mesmo motivo: o servidor precisa saber o
   que bloqueia uma flecha para que o adversário de CPU não atire através de um
   tronco, e ele não tem — nem quer ter — malha nenhuma.

   ---------------------------------------------------------------- o problema

   `server/birdSim.js` documenta o limite: "o servidor não tem árvore nenhuma;
   ele conhece o relevo, não a vegetação". Para os poleiros isso se resolveu com
   um (x, z) aproximado e o cliente escolhendo a copa. Para a linha de visada do
   bot não dá: ou ele sabe onde está o tronco, ou atira através dele.

   E o defeito, no servidor, é PIOR do que era no cliente. O comentário original
   do bot registrava o custo de não ter visada nenhuma — "noventa tiros, zero
   acertos, todas as flechas cravadas na mesma árvore". Sem a lista aqui, o erro
   inverte: ele vira um franco-atirador que acerta ATRAVÉS do cenário, o que é
   injusto de um jeito que o jogador não tem como ler.

   ------------------------------------------------------------- a semente

   Cada lista tem a PRÓPRIA semente, em vez de compartilhar o fluxo de números
   do `environment.js`. É o que torna a lista reproduzível de fora: o servidor
   chama `valleyBlockers(terrain)` e recebe exatamente o que o cliente desenhou,
   sem ter de imitar a ordem em que o cliente sorteou cor de folha e variante de
   copa.

   ------------------------------------------------------------- o formato

   Um obstáculo é um CILINDRO VERTICAL — `{ x, z, r, h }`. Não é a silhueta da
   árvore, e não precisa ser: para decidir "a flecha passa ou não passa", a copa
   não conta (ela é folha) e o tronco é um cilindro de verdade.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { makeRandom } from "../utils/math.js";
import { pathCenterX } from "./terrainField.js";

/** Altura do tronco de uma folhosa, na escala 1. Espelha `BROADLEAF_TRUNK`. */
export const BROADLEAF_TRUNK = 3.4;

const SEED_ROCHAS = 90210;
const SEED_ARVORES = 31337;

/**
 * As rochas espalhadas pela bacia e pelo sopé.
 * @returns {Array<{x:number,z:number,radius:number,variant:number,tint:number}>}
 */
export function valleyBoulders(terrain) {
  const A = CONFIG.world.arena;
  const random = makeRandom(SEED_ROCHAS);
  const lista = [];
  const up = { x: 0, y: 0, z: 0 };

  let guard = 0;
  while (lista.length < 80 && guard++ < 4000) {
    const x = (random() * 2 - 1) * (A.halfX + 30);
    const z = terrain.centerZ + (random() * 2 - 1) * (terrain.halfZ + 30);
    const ad = terrain.arenaDistance(x, z);
    if (ad > 20) continue; // já é parede de serra
    // Não obstrui a linha de tiro.
    if (Math.abs(x - pathCenterX(z)) < 7 && z > -112 && z < 30) continue;
    terrain.normalAt(x, z, 1.0, up);
    if (up.y < 0.68) continue; // encosta íngreme demais para uma pedra assentada

    lista.push({
      x,
      z,
      radius: 0.5 + random() * 2.1,
      variant: Math.floor(random() * 6),
      tint: Math.floor(random() * 4),
      rx: (random() - 0.5) * 0.4,
      ry: random() * Math.PI * 2,
      rz: (random() - 0.5) * 0.4,
    });
  }
  return lista;
}

/**
 * As árvores: o ANEL de folhosas em volta da bacia e a ENCOSTA de coníferas.
 *
 * Só o anel vira obstáculo de tiro — a encosta fica atrás da barreira de
 * caminhada, e é lá que ninguém duela.
 */
export function valleyTrees(terrain) {
  const A = CONFIG.world.arena;
  const random = makeRandom(SEED_ARVORES);
  const up = { x: 0, y: 0, z: 0 };
  const ring = [];
  const slope = [];

  // --- anel: da borda do piso até a metade do sopé -----------------------
  let guard = 0;
  while (ring.length < 130 && guard++ < 6000) {
    const x = (random() * 2 - 1) * (A.halfX + 22);
    const z = terrain.centerZ + (random() * 2 - 1) * (terrain.halfZ + 22);
    const ad = terrain.arenaDistance(x, z);
    if (ad < -11 || ad > 15) continue;
    // A linha de tiro fica limpa da arqueira até bem além do último alvo.
    if (Math.abs(x - pathCenterX(z)) < 9 && z > -114 && z < 26) continue;
    terrain.normalAt(x, z, 1.2, up);
    if (up.y < 0.84) continue;
    const scale = 0.85 + random() * 0.75;
    /* Garante um corredor físico entre os troncos. A folga considera os raios
       visuais dos dois troncos mais a largura da cápsula do jogador — sem ela o
       anel vira uma paliçada em que ninguém passa. */
    const overlaps = ring.some((t) => {
      const required = 0.24 * (scale + t.scale) + 0.9;
      return Math.hypot(x - t.x, z - t.z) < required;
    });
    if (overlaps) continue;
    ring.push({ x, z, scale });
  }

  // --- encosta: coníferas até a linha das árvores -------------------------
  guard = 0;
  while (slope.length < 300 && guard++ < 12000) {
    const x = (random() * 2 - 1) * (A.halfX + 90);
    const z = terrain.centerZ + (random() * 2 - 1) * (terrain.halfZ + 90);
    const ad = terrain.arenaDistance(x, z);
    if (ad < 6) continue;
    const h = terrain.heightAt(x, z);
    if (h > A.treeLine) continue;
    terrain.normalAt(x, z, 1.4, up);
    if (up.y < 0.62) continue; // não nasce pinheiro em falésia
    slope.push({ x, z, scale: 0.9 + random() * 1.1 });
  }

  return { ring, slope };
}

/**
 * O que bloqueia uma flecha, como cilindros verticais.
 *
 * Entram os troncos do ANEL e as rochas. A encosta fica de fora: ela está atrás
 * da barreira de caminhada, e nem o bot (que tem coleira) nem o jogador duelam
 * lá — carregar trezentas coníferas no teste de visada seria pagar por um caso
 * que não acontece.
 *
 * @returns {Array<{x:number,z:number,r:number,h:number}>}
 */
export function valleyBlockers(terrain) {
  const saida = [];
  for (const t of valleyTrees(terrain).ring) {
    saida.push({
      x: t.x,
      z: t.z,
      r: 0.24 * t.scale,
      h: BROADLEAF_TRUNK * t.scale,
      base: terrain.heightAt(t.x, t.z),
    });
  }
  for (const b of valleyBoulders(terrain)) {
    saida.push({
      x: b.x,
      z: b.z,
      r: b.radius,
      h: b.radius * 1.6,
      base: terrain.heightAt(b.x, b.z) - b.radius / 3,
    });
  }
  return saida;
}

/* O teste de segmento contra sólido MUDOU DE CASA: ele deixou de ser do vale
   quando a Lua passou a ter obstáculos também, e mora em `shared/blockers.js`.
   Reexportado daqui porque troncos e rochas continuam sendo o caso de uso mais
   antigo — e para nenhum importador precisar saber que a peça se mudou. */
export { bloqueado } from "./blockers.js";
