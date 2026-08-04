/* ---------------------------------------------------------------------------
   Onde alguém nasce.

   O critério é o pedido: perto do centro da arena, nunca em cima de montanha,
   nunca longe demais — e sem cair na cabeça de quem já está lá. Quem responde a
   "isto é chão plano de arena?" é o `TerrainField`, o mesmo módulo que o
   navegador usa, então o ponto que o servidor escolhe é chão de verdade no
   cliente também.

   O sorteio é por rejeição com relaxamento progressivo: tenta N vezes com todos
   os critérios e vai afrouxando a separação mínima. Nunca devolve nada — com a
   arena cheia, nascer perto de alguém é infinitamente melhor que não nascer.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";

/**
 * @param {import("../src/shared/terrainField.js").TerrainField} terrain
 * @param {Array<{x:number,z:number}>} ocupados posições a evitar
 * @param {() => number} random
 * @returns {{x:number, z:number, y:number}} pés no chão (a queda vem depois)
 */
export function pickSpawnPoint(terrain, ocupados = [], random = Math.random) {
  const S = CONFIG.spawn;
  let melhor = null;
  let melhorFolga = -Infinity;

  for (let i = 0; i < S.maxAttempts; i++) {
    // Raio com raiz quadrada: sem isso o sorteio se acumula no centro, porque a
    // área de um anel cresce com o raio.
    const ang = random() * Math.PI * 2;
    const t = S.minRadius / S.radius;
    const r = S.radius * Math.sqrt(t * t + random() * (1 - t * t));
    const x = S.centerX + Math.cos(ang) * r;
    const z = S.centerZ + Math.sin(ang) * r;

    if (!terrain.isFlatGround(x, z)) continue;

    const folga = distanciaAoMaisProximo(x, z, ocupados);
    if (folga >= S.minSeparation) {
      return { x, z, y: terrain.heightAt(x, z) };
    }
    // Guarda o menos ruim: se ninguém passar no crivo, este é o resultado.
    if (folga > melhorFolga) {
      melhorFolga = folga;
      melhor = { x, z };
    }
  }

  const p = melhor ?? { x: S.centerX, z: S.centerZ };
  return { x: p.x, z: p.z, y: terrain.heightAt(p.x, p.z) };
}

/**
 * Posições de duelo: bem separadas, em pontos distintos do cenário.
 *
 * Um anel largo em volta do centro, com os duelistas distribuídos por igual e
 * empurrados para o ponto plano mais próximo quando calham numa encosta. Um
 * jogo de arco precisa dessa distância — colar dois duelistas a 10 m transforma
 * o arco num revólver.
 */
export function duelPositions(terrain, count, random = Math.random) {
  const D = CONFIG.modes.duel;
  const S = CONFIG.spawn;
  const giro = random() * Math.PI * 2; // a arena não começa sempre igual
  const saida = [];

  for (let i = 0; i < count; i++) {
    const ang = giro + (i * Math.PI * 2) / Math.max(1, count);
    let ponto = null;

    // Do anel para dentro: o primeiro raio que der chão plano vence, então
    // todos ficam o mais longe possível uns dos outros.
    for (let r = D.ringRadius; r >= S.minRadius && !ponto; r -= 4) {
      const x = S.centerX + Math.cos(ang) * r;
      const z = S.centerZ + Math.sin(ang) * r;
      if (terrain.isFlatGround(x, z)) ponto = { x, z };
    }
    if (!ponto) ponto = pickSpawnPoint(terrain, saida, random);

    saida.push({ x: ponto.x, z: ponto.z, y: terrain.heightAt(ponto.x, ponto.z) });
  }
  return saida;
}

/** Ponto para um porco: longe dos jogadores, dentro do alcance do modo. */
export function pickBoarSpawn(terrain, jogadores, random = Math.random) {
  const B = CONFIG.modes.boarHunt;
  const S = CONFIG.spawn;

  for (let i = 0; i < 40; i++) {
    const ang = random() * Math.PI * 2;
    const r = 20 + random() * (B.maxDistFromCenter - 20);
    const x = S.centerX + Math.cos(ang) * r;
    const z = S.centerZ + Math.sin(ang) * r;
    if (!terrain.isWalkable(x, z)) continue;
    // Porco pode pastar no sopé; só não pode nascer na serra.
    if (terrain.arenaDistance(x, z) > 0) continue;
    if (distanciaAoMaisProximo(x, z, jogadores) < B.minDistFromPlayers) continue;
    return { x, z, y: terrain.heightAt(x, z) };
  }
  return null;
}

function distanciaAoMaisProximo(x, z, pontos) {
  let min = Infinity;
  for (const p of pontos) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < min) min = d;
  }
  return min;
}
