/* ---------------------------------------------------------------------------
   Os estilhaços de um meteorito — a mesma conta nos dois lados do fio.

   O servidor precisa deles para decidir quem morre; o cliente precisa deles
   para desenhar. Trafegar doze posições a 10 Hz por explosão seria caro para
   uma coisa que dura cinco segundos — então **não se trafega nada além do
   EVENTO**: origem, semente e instante. Com as três, os dois lados integram a
   mesma parábola e chegam ao mesmo lugar.

   É o mesmo contrato que o vento (`systems/wind.js`) já usa, e pela mesma
   razão: uma função pura de entradas compartilhadas dá sincronia perfeita de
   graça.

   ------------------------------------------------------------------ a regra

   O pedaço MATA ENQUANTO VOA e para de matar assim que assenta, e o critério é
   a VELOCIDADE, não o tempo. Um pedaço que já parou no chão não machuca
   ninguém; um que ainda está quicando, sim. Sem isso teríamos uma mina
   invisível no chão da Lua, que é o oposto de legível.
   --------------------------------------------------------------------------- */

import { makeRandom } from "../utils/math.js";

const TAU = Math.PI * 2;

/**
 * Cria os estilhaços de uma explosão, determinísticos pela semente.
 *
 * @param {{x,y,z}} origem
 * @param {number} seed a mesma nos dois lados
 * @param {object} cfg bloco `CONFIG.levels.moon.meteors`
 * @returns {Array} pedaços em estado inicial
 */
export function criarEstilhacos(origem, seed, cfg) {
  const rnd = makeRandom(seed >>> 0);
  const n = cfg.fragCount;
  const lista = [];
  for (let i = 0; i < n; i++) {
    /* Direção radial com viés para CIMA: uma explosão que joga metade dos
       pedaços para dentro do chão desperdiça metade do efeito. */
    const a = rnd() * TAU;
    const alt = 0.15 + rnd() * 0.85;
    const h = Math.sqrt(Math.max(0, 1 - alt * alt));
    const v = cfg.fragSpeedMin + rnd() * (cfg.fragSpeedMax - cfg.fragSpeedMin);
    lista.push({
      x: origem.x,
      y: origem.y,
      z: origem.z,
      vx: Math.cos(a) * h * v,
      vy: alt * v,
      vz: Math.sin(a) * h * v,
      raio: cfg.fragRaioMin + rnd() * (cfg.fragRaioMax - cfg.fragRaioMin),
      giroX: (rnd() - 0.5) * 6,
      giroZ: (rnd() - 0.5) * 6,
      rotX: rnd() * TAU,
      rotZ: rnd() * TAU,
      formato: Math.floor(rnd() * 4),
      assentado: false,
      tempoNoChao: 0,
      jaAcertou: false,
    });
  }
  return lista;
}

/**
 * Avança um estilhaço. Mutação in-place, sem alocar.
 *
 * @returns {boolean} true quando ele já pode ser descartado
 */
export function passoEstilhaco(f, dt, gravity, heightAt, cfg) {
  if (f.assentado) {
    /* No chão: não há quem matar, só esperar sumir. O fade evita o pedaço
       desaparecendo num quadro na frente de quem está olhando. */
    f.tempoNoChao += dt;
    return f.tempoNoChao > cfg.fragSettleTime + cfg.fragFadeTime;
  }

  /* Onde ele estava ANTES deste passo.
     A 10 Hz um pedaço a 13 m/s salta 1,3 m por quadro — mais que o raio de
     acerto. Testar só a posição de chegada é sortear se o quadro caiu em cima
     do jogador, e o resultado era um estilhaço que atravessava gente sem
     machucar. Guardando a origem, o teste vira um SEGMENTO (ver
     `distanciaSegmento`) e o pedaço acerta o que ele de fato atravessou. */
  f.px = f.x;
  f.py = f.y;
  f.pz = f.z;

  f.vy += gravity * dt;
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  f.z += f.vz * dt;
  f.rotX += f.giroX * dt;
  f.rotZ += f.giroZ * dt;

  const chao = heightAt(f.x, f.z) + f.raio;
  if (f.y <= chao) {
    f.y = chao;
    // Quica com perda; abaixo do limiar de morte ele simplesmente assenta.
    f.vy = -f.vy * cfg.fragRestitution;
    f.vx *= 0.5;
    f.vz *= 0.5;
    if (velocidade(f) < cfg.fragKillSpeed) {
      f.assentado = true;
      f.vx = f.vy = f.vz = 0;
    }
  }
  return false;
}

/** Quanto do fade já passou (0 = inteiro, 1 = sumiu). */
export function opacidadeEstilhaco(f, cfg) {
  if (!f.assentado) return 1;
  const sobra = f.tempoNoChao - cfg.fragSettleTime;
  if (sobra <= 0) return 1;
  return Math.max(0, 1 - sobra / cfg.fragFadeTime);
}

/** Este pedaço está voando rápido o bastante para matar? */
export function estilhacoLetal(f, cfg) {
  return !f.assentado && !f.jaAcertou && velocidade(f) >= cfg.fragKillSpeed;
}

/**
 * Menor distância entre o caminho do estilhaço neste passo e um ponto.
 *
 * O caminho é o segmento (px,py,pz)→(x,y,z); sem `px` (pedaço recém-criado,
 * que ainda não deu um passo) cai na distância ao ponto atual.
 */
export function distanciaSegmento(f, px, py, pz) {
  if (f.px === undefined) return Math.hypot(f.x - px, f.y - py, f.z - pz);
  const ax = f.px, ay = f.py, az = f.pz;
  const dx = f.x - ax, dy = f.y - ay, dz = f.z - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (len2 > 1e-9) {
    t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  return Math.hypot(ax + dx * t - px, ay + dy * t - py, az + dz * t - pz);
}

function velocidade(f) {
  return Math.hypot(f.vx, f.vy, f.vz);
}
