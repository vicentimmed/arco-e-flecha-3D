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

/**
 * Onde o alce entra: o ponto do anel MAIS LONGE de todos os arqueiros.
 *
 * "Do lado oposto" não precisa de trigonometria: varrendo o anel e ficando com
 * o ponto cuja distância ao arqueiro mais próximo é a maior, o resultado é o
 * lado oposto quando o grupo está junto (que é o caso ao ligar o modo, porque
 * `lineUpForElk` põe todo mundo lado a lado) e continua sendo o ponto mais
 * seguro quando o grupo está espalhado — onde uma conta de "ângulo médio"
 * poderia cair bem no meio de duas pessoas.
 */
export function pickElkSpawn(terrain, jogadores = [], random = Math.random) {
  const E = CONFIG.modes.elkHunt;
  const S = CONFIG.spawn;
  const giro = random() * Math.PI * 2;
  let melhor = null;
  let melhorFolga = -Infinity;

  for (let i = 0; i < 48; i++) {
    const ang = giro + (i * Math.PI * 2) / 48;
    // Do anel para dentro: prefere longe, mas aceita perto se o anel inteiro
    // cair em encosta.
    for (let r = E.arenaRadius; r >= 20; r -= 6) {
      const x = S.centerX + Math.cos(ang) * r;
      const z = S.centerZ + Math.sin(ang) * r;
      if (!terrain.isWalkable(x, z) || terrain.arenaDistance(x, z) > 0) continue;
      const folga = distanciaAoMaisProximo(x, z, jogadores);
      if (folga > melhorFolga) {
        melhorFolga = folga;
        melhor = { x, z };
      }
      break;
    }
  }

  if (!melhor) return null;
  return { x: melhor.x, z: melhor.z, y: terrain.heightAt(melhor.x, melhor.z) };
}

/**
 * A linha dos arqueiros na caçada ao alce: todos juntos, de um lado só.
 *
 * Juntos porque o alce escolhe um alvo e vem em linha reta: espalhados, cada um
 * enfrentaria o bicho sozinho e a investida viraria uma sequência de duelos
 * privados. Lado a lado, quem não está sendo perseguido atira em quem está
 * perseguindo o amigo — que é o modo funcionando.
 */
export function elkHuntPositions(terrain, count, random = Math.random) {
  const E = CONFIG.modes.elkHunt;
  const S = CONFIG.spawn;
  const meio = (count - 1) / 2;

  /* O ângulo NÃO é sorteado livremente.
   *
   * A arena é um vale: ±34 m de largura e quase 260 m de comprimento. Um anel
   * circular de 60 m cabe folgado ao longo do vale e não cabe de jeito nenhum
   * de través — sorteando o ângulo às cegas, metade das partidas punha os
   * arqueiros a 15 m do centro (era até onde havia chão plano naquela direção),
   * e "o lado oposto ao alce" virava "a dois passos dele".
   *
   * Então varremos as direções e ficamos com a que permite ir MAIS LONGE. Na
   * prática isso escolhe sempre um dos dois extremos do vale, que é o lugar
   * certo — e continua funcionando sozinho se a arena mudar de forma. */
  let melhorAng = 0;
  let melhorR = 0;
  const passos = 24;
  const giro = random() * Math.PI * 2; // desempata sem preferir sempre o mesmo lado
  for (let i = 0; i < passos; i++) {
    const ang = giro + (i * Math.PI * 2) / passos;
    const r = alcanceDaLinha(terrain, ang, count, meio, E);
    if (r > melhorR) {
      melhorR = r;
      melhorAng = ang;
    }
  }

  const raio = melhorR || 20;
  const lx = -Math.sin(melhorAng);
  const lz = Math.cos(melhorAng);
  const saida = [];
  for (let i = 0; i < count; i++) {
    const desloc = (i - meio) * E.lineSpread;
    const x = S.centerX + Math.cos(melhorAng) * raio + lx * desloc;
    const z = S.centerZ + Math.sin(melhorAng) * raio + lz * desloc;
    saida.push({ x, z, y: terrain.heightAt(x, z) });
  }
  return saida;
}

/** O maior raio, nesta direção, em que a LINHA INTEIRA cai em chão de arena. */
function alcanceDaLinha(terrain, ang, count, meio, E) {
  const S = CONFIG.spawn;
  const lx = -Math.sin(ang);
  const lz = Math.cos(ang);

  for (let r = E.arenaRadius; r >= 12; r -= 4) {
    let ok = true;
    for (let i = 0; i < count && ok; i++) {
      const desloc = (i - meio) * E.lineSpread;
      const x = S.centerX + Math.cos(ang) * r + lx * desloc;
      const z = S.centerZ + Math.sin(ang) * r + lz * desloc;
      if (!terrain.isFlatGround(x, z)) ok = false;
    }
    if (ok) return r;
  }
  return 0;
}

function distanciaAoMaisProximo(x, z, pontos) {
  let min = Infinity;
  for (const p of pontos) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < min) min = d;
  }
  return min;
}
