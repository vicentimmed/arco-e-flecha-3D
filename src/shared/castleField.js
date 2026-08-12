/* ---------------------------------------------------------------------------
   O chão da fase Castelo: esporão, rampa, planície e serra ao fundo.

   PURO, como `terrainField.js` e `moonField.js`, e pelo mesmo motivo: o
   servidor roda em Node, precisa das mesmas alturas para fazer a horda subir a
   rampa, e não tem malha nenhuma. A parte visual mora em `entities/castle.js`
   e `levels/castleLevel.js`.

   ------------------------------------------------------------- a forma, e o
                                                                    porquê dela

   Três peças, e cada uma existe para resolver um problema do MODO, não para
   fazer paisagem:

   • **O esporão** (topo em `GROUND_Y` = 14 m) tem despenhadeiro em três lados.
     Não é enfeite: é o que impede a resposta óbvia de contornar o muro e
     atacar por trás, que transformaria o cerco numa defesa de perímetro de
     360° que quatro arqueiros não cobrem.

   • **A rampa**, de 90 m, é o campo de tiro inteiro. Ela é um aterro ELEVADO
     sobre a planície — com ombros caindo dos dois lados —, e é isso que
     funila a horda para dentro dos 26 m que o trabuco alcança. Uma rampa
     rente ao chão deixaria a horda se espalhar e o trabuco sem alvo.

   • **A planície e a serra** são o horizonte. Não se joga lá; a linha de
     árvores em z ≈ +105 é de onde eles saem, e é longe o bastante para a
     silhueta entrar pequena e crescer.

   A rampa AFINA de baixo para cima (18 m de meia-largura no pé, 13 m junto ao
   portão). É a mesma ideia do funil: a horda que chega espalhada aperta
   sozinha conforme sobe, e a densidade cresce justamente onde o arco alcança.
   --------------------------------------------------------------------------- */

import { ValueNoise } from "../utils/noise.js";
import { smoothstep, clamp } from "../utils/math.js";
import { GROUND_Y, CASTLE, insideFootprint } from "./castleProps.js";

/** A borda do platô — onde o esporão termina e a rampa começa. */
const RAMP_TOP_Z = 9;
/** O pé da rampa, já na planície. */
const RAMP_FOOT_Z = 99;

/** Meia-largura da rampa junto ao portão e no pé. Ver o funil, acima. */
const RAMP_HALF_TOP = 13;
const RAMP_HALF_FOOT = 18;

/** O platô, como caixa arredondada no plano. */
const PLATEAU = { cx: 0, cz: -14, hx: 30, hz: 23, round: 6 };

/** Limites do mundo desta fase. Bem além do jogável: o horizonte precisa
    continuar existindo depois da última coisa em que se pisa. */
export const CASTLE_WORLD = {
  minX: -150,
  maxX: 150,
  minZ: -170,
  maxZ: 210,
  /** Segmentos da malha visual (ver `entities/castleGround.js`). */
  segments: 190,
  gridFocus: 0.4,
  /** Meia-extensão da malha central, medida a partir de `center`. */
  half: 180,
  center: { x: 0, z: 20 },
};

/** SDF de caixa arredondada no plano. Negativo = dentro. */
function sdRoundBox(px, pz, hx, hz, r) {
  const qx = Math.abs(px) - hx + r;
  const qz = Math.abs(pz) - hz + r;
  const ox = Math.max(qx, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0) - r;
}

export class CastleField {
  constructor(seed = 12140529) {
    // 29/05/1214, dia de nada em especial. É só uma semente — mas é fixa, e é
    // o que faz o relevo ser o mesmo no servidor e em cada navegador.
    this.noise = new ValueNoise(seed);

    /* Onde a sala sorteia nascimento fora do cerco (modo livre e duelo): o
       PÁTIO. `spawnPoints.js` lê isto do terreno em vez de `CONFIG.spawn`, que
       é do vale. */
    this.spawnCenter = { x: 0, z: -12, radius: 11 };

    /* O anel do duelo, DECLARADO em vez de inferido.
     *
     * 45 m a partir do pátio chegam ao terço de cima da rampa, que é o único
     * lugar da fase onde dois arqueiros ficam longe um do outro com linha de
     * tiro limpa. O pátio sozinho tem 38 × 30 m — colar dois duelistas ali
     * transformaria o arco no revólver que o duelo existe para evitar.
     *
     * Ver o comentário em `server/spawnPoints.js:duelPositions`: sem esta
     * propriedade a fase herdaria o anel de 95 m da Lua. */
    this.duel = { ringRadius: 45, minSeparation: 34 };

    // Compatibilidade com quem lê estes dois do campo do vale.
    this.centerZ = CASTLE_WORLD.center.z;
    this.halfZ = CASTLE_WORLD.half;
  }

  /* ------------------------------------------------------------- altura -- */

  /**
   * Quanto este ponto está em cima do platô (0 a 1).
   *
   * A transição é curta de propósito — 4,5 m de banda para 14 m de subida dá
   * ~72°, que é despenhadeiro. É este número, e não uma parede invisível, que
   * fecha os três lados do esporão.
   */
  plateauMask(x, z) {
    const sd = sdRoundBox(x - PLATEAU.cx, z - PLATEAU.cz, PLATEAU.hx, PLATEAU.hz, PLATEAU.round);
    return 1 - smoothstep(-1.5, 4.5, sd);
  }

  /**
   * A altura do aterro da rampa acima da planície, em metros.
   *
   * Zero fora do corredor. É somado — não interpolado — com o platô, e os dois
   * se encontram exatamente em `RAMP_TOP_Z` com o mesmo valor, que é o que
   * evita o degrau na boca do portão.
   */
  rampHeight(x, z) {
    if (z < RAMP_TOP_Z - 6 || z > RAMP_FOOT_Z + 14) return 0;
    const t = clamp((z - RAMP_TOP_Z) / (RAMP_FOOT_Z - RAMP_TOP_Z), 0, 1);
    // Desce liso, com as duas pontas suavizadas: no alto para casar com o
    // platô, embaixo para não terminar num degrau contra a planície.
    const perfil = 1 - (t * t * (3 - 2 * t));
    const meia = RAMP_HALF_TOP + (RAMP_HALF_FOOT - RAMP_HALF_TOP) * t;
    const lateral = 1 - smoothstep(meia - 1.5, meia + 3.0, Math.abs(x));
    return GROUND_Y * perfil * lateral;
  }

  /** Altura do terreno (m) em qualquer ponto do plano. */
  heightAt(x, z) {
    const n = this.noise;

    /* --- planície: ondulação de pasto, nada que atrapalhe a leitura ------ */
    let plana =
      0.62 * n.fbm2(x * 0.019, z * 0.019, 3) + 0.22 * n.fbm2(x * 0.07, z * 0.07, 2);

    /* --- serra do horizonte -----------------------------------------------
       Começa longe do pé da rampa e sobe rápido. Ela existe para o mundo não
       terminar numa borda; ninguém chega lá, e por isso é barata. */
    const d = Math.hypot(x - CASTLE_WORLD.center.x, z - CASTLE_WORLD.center.z);
    if (d > 118) {
      const w = (d - 118) / 46;
      const wx = x + 26 * n.fbm2(x * 0.005 + 3.1, z * 0.005 - 1.7, 2);
      const wz = z + 26 * n.fbm2(x * 0.005 - 6.3, z * 0.005 + 2.9, 2);
      const crista = 0.5 + 0.5 * n.ridged2(wx * 0.0085, wz * 0.0085, 3);
      plana += 46 * (1 - Math.exp(-w)) * (0.18 + 0.9 * Math.pow(crista, 1.4));
    }

    const platô = this.plateauMask(x, z);
    const rampa = this.rampHeight(x, z);
    const k = Math.max(platô, rampa / GROUND_Y);

    /* O piso do pátio e a superfície da rampa são LISOS. Não é preguiça: o
       pátio é onde se repara o portão sob pressão e a rampa é o alvo do
       trabuco — os dois lugares em que uma ondulação de 60 cm vira um tropeço
       ou uma pedra que quica para o lado errado. */
    return plana * (1 - 0.92 * k) + Math.max(GROUND_Y * platô, rampa);
  }

  /* ---------------------------------------------------------- derivadas -- */

  normalAt(x, z, eps = 0.6, out = { x: 0, y: 0, z: 0 }) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    const nx = hL - hR;
    const ny = 2 * eps;
    const nz = hD - hU;
    const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
    out.x = nx * inv;
    out.y = ny * inv;
    out.z = nz * inv;
    return out;
  }

  slopeAt(x, z, eps = 0.6) {
    return this.normalAt(x, z, eps, _normal).y;
  }

  /**
   * Distância com sinal até a borda da área jogável (negativo = dentro).
   *
   * Cobre o esporão, a rampa inteira e a soleira de planície onde a horda
   * nasce. `zombieSim.step()` recusa passo com `arenaDistance > 10`, então
   * esta caixa é, na prática, a coleira da horda.
   */
  arenaDistance(x, z) {
    return sdRoundBox(x, z - 40, 42, 100, 20);
  }

  /**
   * Dá para pisar aqui?
   *
   * Além dos limites do mundo, RECUSA DESPENHADEIRO — e essa é a diferença
   * para o vale, cujo `isWalkable` só olha a borda da malha. Aqui a inclinação
   * é regra de jogo: é ela que impede a horda de escalar o esporão pelos três
   * lados fechados em vez de subir a rampa.
   *
   * 0,58 é cos(54°). Fica acima da rampa (9°) e da planície com folga enorme,
   * e abaixo dos ~72° dos flancos do esporão.
   */
  isWalkable(x, z) {
    const W = CASTLE_WORLD;
    if (x <= W.minX + 1 || x >= W.maxX - 1) return false;
    if (z <= W.minZ + 1 || z >= W.maxZ - 1) return false;
    return this.slopeAt(x, z, 1.0) >= 0.58;
  }

  /**
   * É chão bom para nascer?
   *
   * Duas superfícies servem: o topo do esporão (pátio) e a rampa. As duas são
   * lisas por construção — ver o comentário em `heightAt` sobre por que o
   * ruído é suprimido nelas.
   *
   * A cláusula que não existe no vale é a da ALVENARIA: lá não há parede
   * dentro da qual caber, aqui há, e nascer dentro de um muro de 3,2 m é o
   * defeito que a queda de nascimento esconderia até alguém tentar andar.
   *
   * `minSlope` é 0,90 e não 0,94 porque a rampa inteira tem 9° de inclinação
   * (cos 9° = 0,988) mas os ombros dela sobem rápido: o valor do vale
   * recusaria a faixa útil junto às bordas e empilharia todo mundo no eixo.
   */
  isFlatGround(x, z, margin = 2.5, minSlope = 0.9) {
    if (!this.isWalkable(x, z)) return false;
    if (insideFootprint(x, z, 1.2)) return false;

    const noPatio = this.plateauMask(x, z) > 0.98 && z < CASTLE.courtZFront - margin;
    const naRampa = this.rampHeight(x, z) > 0.5 && z > CASTLE.wallZOut + margin;
    if (!noPatio && !naRampa) return false;

    return this.slopeAt(x, z, 1.0) >= minSlope;
  }
}

const _normal = { x: 0, y: 0, z: 0 };
