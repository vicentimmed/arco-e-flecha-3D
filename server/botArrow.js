/* ---------------------------------------------------------------------------
   A flecha do bot, integrada no servidor.

   O jogo tem um contrato antigo: **quem atira é a autoridade sobre o próprio
   acerto**. O cliente resolve a colisão com o Rapier dele e anuncia
   `C2S.IMPACT`; os outros só desenham a cópia (`visualOnly`) e encaixam na pose
   anunciada. Quando o atirador é um bot da sala, não existe cliente-dono — e é o
   servidor que precisa cumprir o papel.

   Ele não tem Rapier, e não precisa: a flecha é um ponto material com arrasto, e
   isso é uma integração de meia página. O que ela testa a cada passo:

   • **personagens** — cápsula vertical, o mesmo raio e altura de `CONFIG.player`;
   • **bichos** — esfera, com raio generoso (um porco correndo não é um ponto);
   • **terreno** — altura do campo, que servidor e cliente compartilham.

   Duas simplificações deliberadas, e o motivo de cada uma:

   1. **Sem o termo de ângulo de ataque.** A flecha real se realinha ao vetor
      velocidade em poucos décimos de segundo (é o que o centro de pressão faz em
      `entities/arrow.js`), então a área efetiva é ~a frontal durante quase todo o
      voo. O erro é de centímetros num tiro de sessenta metros.

   2. **A vegetação entra pela lista compartilhada**, não pela malha: os troncos
      e as rochas são cilindros verticais vindos de `shared/valleyProps.js`. Sem
      isso a flecha do bot atravessaria árvore, e ele viraria um franco-atirador
      que acerta através do cenário.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { levelPhysics } from "../src/shared/levels.js";
import { bloqueado } from "../src/shared/valleyProps.js";

/** Raio de acerto de um bicho. Generoso: alvo que corre não é um ponto. */
const RAIO_BICHO = 0.8;

/**
 * Voa a flecha até ela parar em alguma coisa.
 *
 * @param {object} tiro `{ origem, direcao, velocidade }` — o que `Bot.atirar` devolve
 * @param {object} ctx
 * @param {object} ctx.terrain campo de altura da fase
 * @param {string} ctx.levelId
 * @param {Array} ctx.personagens jogadores e bots com corpo em campo
 * @param {number} ctx.donoId quem atirou (não pode acertar a si mesmo)
 * @param {Array} ctx.bichos porcos/alces/zumbis vivos
 * @param {number} ctx.agora relógio da sala, para a checagem de invencibilidade
 * @returns {{kind:string, alvo:object|null, ponto:object, velocidade:object, tempo:number}}
 */
export function simularFlechaDoBot(tiro, ctx) {
  const { terrain, levelId, personagens, donoId, bichos = [], agora = 0, blockers = [] } = ctx;
  const fisica = levelPhysics(levelId);

  const h = CONFIG.physics.fixedStep;
  const vidaMax = fisica.arrow?.maxLifetime ?? CONFIG.arrow.maxLifetime;
  const altMax = fisica.arrow?.maxAltitude ?? CONFIG.arrow.maxAltitude;

  const p = { ...tiro.origem };
  const v = {
    x: tiro.direcao.x * tiro.velocidade,
    y: tiro.direcao.y * tiro.velocidade,
    z: tiro.direcao.z * tiro.velocidade,
  };
  const anterior = { x: p.x, y: p.y, z: p.z };

  /* Constante do arrasto, fatorada fora do laço: F = -½·ρ·Cd·A·|v|·v, e a
     aceleração é F/m. Com `airDensity` zero (o vácuo lunar) todo o termo some
     pela matemática, sem nenhum `if` — igual ao que a flecha do cliente faz. */
  const kArrasto =
    (0.5 * fisica.airDensity * CONFIG.arrow.dragCoefficient * CONFIG.arrow.frontalArea) /
    CONFIG.arrow.mass;

  const raioPersonagem = CONFIG.player.colliderRadius + CONFIG.arrow.shaftRadius * 1.5;
  const altura = CONFIG.player.height;

  let t = 0;
  while (t < vidaMax) {
    anterior.x = p.x;
    anterior.y = p.y;
    anterior.z = p.z;

    const rapidez = Math.hypot(v.x, v.y, v.z);
    if (kArrasto > 0 && rapidez > 1e-3) {
      const a = kArrasto * rapidez;
      v.x -= v.x * a * h;
      v.y -= v.y * a * h;
      v.z -= v.z * a * h;
    }
    v.y += fisica.gravity * h;

    p.x += v.x * h;
    p.y += v.y * h;
    p.z += v.z * h;
    t += h;

    /* ------------------------------------------------------- personagens --
       Cápsula vertical: o segmento da flecha neste passo contra o eixo do
       corpo. Quem está piscando (invencível) é atravessado, como no cliente. */
    for (const c of personagens) {
      if (!c || c.id === donoId || !c.alive || !c.position) continue;
      if (agora < (c.invulnUntil ?? 0)) continue;
      const d = distanciaSegmentoEixo(anterior, p, c.position, altura);
      if (d <= raioPersonagem) {
        return { kind: "character", alvo: c, ponto: { ...p }, velocidade: { ...v }, tempo: t };
      }
    }

    /* ------------------------------------------------------------ bichos -- */
    for (const b of bichos) {
      const d = distanciaSegmentoPonto(anterior, p, {
        x: b.x,
        y: b.y + RAIO_BICHO,
        z: b.z,
      });
      if (d <= RAIO_BICHO) {
        return { kind: b.kind, alvo: b, ponto: { ...p }, velocidade: { ...v }, tempo: t };
      }
    }

    /* ------------------------------------------------ tronco e rocha ----- */
    if (blockers.length && bloqueado(blockers, anterior, p)) {
      return { kind: "scenery", alvo: null, ponto: { ...p }, velocidade: { ...v }, tempo: t };
    }

    /* ----------------------------------------------------------- terreno -- */
    if (p.y <= terrain.heightAt(p.x, p.z)) {
      p.y = terrain.heightAt(p.x, p.z);
      return { kind: "terrain", alvo: null, ponto: { ...p }, velocidade: { ...v }, tempo: t };
    }

    // Saiu do mundo por cima ou pelos lados: some sem cravar em nada.
    if (p.y > altMax || !terrain.isWalkable(p.x, p.z)) {
      return { kind: "sumiu", alvo: null, ponto: { ...p }, velocidade: { ...v }, tempo: t };
    }
  }

  return { kind: "sumiu", alvo: null, ponto: { ...p }, velocidade: { ...v }, tempo: t };
}

/**
 * Quaternion que aponta o eixo +Y da flecha na direção do voo.
 *
 * O cliente encaixa a cópia visual nesta orientação; sem ela, a flecha cravaria
 * apontando para cima, que é a pose de repouso da malha.
 */
export function orientacaoDe(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  const dx = v.x / m;
  const dy = v.y / m;
  const dz = v.z / m;

  // Rotação mínima de (0,1,0) para (dx,dy,dz) — a mesma conta que
  // `Quaternion.setFromUnitVectors` faz no cliente.
  const w = 1 + dy;
  if (w < 1e-6) {
    // Antiparalelo: meia volta em torno de um eixo perpendicular qualquer.
    return [0, 0, 1, 0];
  }
  const qx = dz;
  const qz = -dx;
  const inv = 1 / Math.hypot(qx, 0, qz, w);
  return [qx * inv, 0, qz * inv, w * inv];
}

/* ------------------------------------------------------------------ util -- */

/** Menor distância entre o segmento [a,b] e o ponto `p`. */
function distanciaSegmentoPonto(a, b, p) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let s = 0;
  if (len2 > 1e-12) {
    s = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
  }
  return Math.hypot(a.x + abx * s - p.x, a.y + aby * s - p.y, a.z + abz * s - p.z);
}

/**
 * Menor distância entre o segmento da flecha e o EIXO do corpo — a reta
 * vertical que vai dos pés ao topo da cabeça.
 *
 * Amostrar o eixo em alguns pontos é o suficiente e evita a álgebra de
 * segmento-contra-segmento: a cápsula tem 1,72 m e cinco amostras a deixam com
 * 43 cm entre elas, bem abaixo do raio de acerto.
 */
function distanciaSegmentoEixo(a, b, base, altura) {
  let melhor = Infinity;
  const N = 5;
  for (let i = 0; i <= N; i++) {
    const y = base.y + (altura * i) / N;
    const d = distanciaSegmentoPonto(a, b, { x: base.x, y, z: base.z });
    if (d < melhor) melhor = d;
  }
  return melhor;
}
