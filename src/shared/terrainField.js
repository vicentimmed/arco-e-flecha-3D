/* ---------------------------------------------------------------------------
   O campo escalar do terreno: altura, distância à arena e onde se pode pisar.

   Este módulo é PURO — nada de Three.js, nada de Rapier, nada de DOM. É o que
   permite que o servidor, que roda em Node e não tem placa de vídeo nem cena,
   responda "qual é a altura em (x, z)?" com exatamente o mesmo número que o
   navegador. Sem isso o servidor não teria como escolher um ponto de
   nascimento no chão, nem fazer os porcos andarem no relevo certo.

   `entities/environment.js` estende esta classe e acrescenta o que só faz
   sentido no cliente: malha, cores, colisor e vegetação.

   Determinístico por construção: mesma seed ⇒ mesmo relevo, no servidor e em
   cada um dos navegadores.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { ValueNoise } from "../utils/noise.js";
import { smoothstep } from "../utils/math.js";

/** Centro da trilha em função de z: uma curva suave, não uma reta. */
export function pathCenterX(z) {
  return 3.0 * Math.sin(z * 0.016) + 1.6 * Math.sin(z * 0.0052 + 1.1);
}

export class TerrainField {
  constructor(seed = 20260731) {
    this.noise = new ValueNoise(seed);
    const A = CONFIG.world.arena;
    this.centerZ = (A.zBack + A.zFront) * 0.5;
    this.halfZ = (A.zBack - A.zFront) * 0.5;
  }

  /**
   * Distância com sinal até a borda do piso da arena (negativo = dentro).
   *
   * É um retângulo arredondado (SDF de caixa) somado a um ruído de baixa
   * frequência. O ruído é o que impede que a arena leia como "um retângulo":
   * a borda ganha enseadas e esporões de até ~7 m, e como TODO o relevo da
   * serra é função desta distância, os contrafortes herdam essa irregularidade
   * de graça.
   *
   * Também é o teste mais barato de "isto é chão plano?": tudo com distância
   * menor que -footBand está na bacia, longe de qualquer encosta. É assim que
   * o servidor escolhe onde os jogadores nascem.
   */
  arenaDistance(x, z) {
    const A = CONFIG.world.arena;
    const qx = Math.abs(x) - A.halfX;
    const qz = Math.abs(z - this.centerZ) - this.halfZ;
    const ox = Math.max(qx, 0);
    const oz = Math.max(qz, 0);
    const box = Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0);
    return box + A.edgeNoise * this.noise.fbm2(x * 0.0072, z * 0.0072, 3);
  }

  /** Altura do terreno (m) em qualquer ponto do plano. */
  heightAt(x, z) {
    const n = this.noise;
    const A = CONFIG.world.arena;

    /* --- piso da bacia: ondulação suave, trilha plana e escavada --------- */
    const dPath = Math.abs(x - pathCenterX(z));
    let h =
      0.52 * n.fbm2(x * 0.021, z * 0.021, 3) + 0.19 * n.fbm2(x * 0.082, z * 0.082, 2);
    const onPath = 1 - smoothstep(3.0, 7.5, dPath);
    h *= 1 - 0.8 * onPath;
    h -= 0.14 * onPath;

    const ad = this.arenaDistance(x, z);
    if (ad <= -A.footBand) return h;

    /* --- sopé gramado: a bacia fecha antes de virar rocha ---------------- */
    h += A.footHeight * smoothstep(-A.footBand, A.footBand * 0.5, ad);

    const w = ad - A.wallStart;
    if (w <= 0) return h;

    /* --- serra ------------------------------------------------------------
       Domain warping: distorcer o espaço ANTES de amostrar o ruído é o que
       transforma manchas genéricas em espigões e vales com direção coerente.
       Sem isto, ruído fractal produz "morros de bolha". */
    const wx = x + 30 * n.fbm2(x * 0.0052 + 5.2, z * 0.0052 - 2.1, 2);
    const wz = z + 30 * n.fbm2(x * 0.0052 - 8.7, z * 0.0052 + 4.4, 2);

    // Três escalas de crista: maciço → contrafortes → rugosidade.
    const r1 = 0.5 + 0.5 * n.ridged2(wx * 0.0068, wz * 0.0068, 3);
    const r2 = 0.5 + 0.5 * n.ridged2(wx * 0.018, wz * 0.018, 3);
    const r3 = 0.5 + 0.5 * n.ridged2(wx * 0.044, wz * 0.044, 2);
    // O expoente > 1 afina os cumes e alarga os vales. É a diferença entre um
    // perfil de montanha e um perfil de duna.
    const ridge = Math.pow(0.6 * r1 + 0.27 * r2 + 0.13 * r3, 1.5);

    // A altura do maciço varia ao longo da serra: cumes e colos, não muralha.
    const massif =
      0.55 + 0.7 * (0.5 + 0.5 * n.fbm2(x * 0.0036 - 17.3, z * 0.0036 + 9.1, 2));
    const rise = 1 - Math.exp(-w / A.rampLength);

    h += A.peak * massif * rise * (0.22 + 0.9 * ridge);

    // Estratos: degraus horizontais de rocha sedimentar nas encostas médias,
    // atenuados perto dos cumes (onde o topo é erodido, não estratificado).
    const bench =
      Math.min(1, w / 14) * (1 - smoothstep(0.55, 1.0, h / (A.peak * 1.15)));
    h += 1.5 * bench * Math.sin(h * 0.32 + n.noise2(x * 0.03, z * 0.03) * 2.4);

    // Rugosidade fina só perto da arena: lá fora a malha é rala e não a
    // resolveria — só produziria cintilação.
    h += 2.2 * n.fbm2(x * 0.075, z * 0.075, 3) * Math.min(1, w / 8) * Math.exp(-w / 90);

    return h;
  }

  /**
   * Normal analítica por diferenças finitas.
   *
   * `out` é qualquer objeto com x/y/z — um `THREE.Vector3` no cliente, um
   * literal no servidor. A normalização é feita à mão justamente para não
   * depender de um método de Vector3 que o servidor não tem.
   */
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

  /** Inclinação em (x, z): cosseno do ângulo com a vertical. 1 = plano. */
  slopeAt(x, z, eps = 0.6) {
    return this.normalAt(x, z, eps, _normal).y;
  }

  /**
   * A arqueira pode pisar aqui?
   *
   * Só bloqueamos as bordas reais da malha. A inclinação não cria paredes
   * invisíveis: troncos, rochas e cercas são os obstáculos físicos de verdade.
   */
  isWalkable(x, z) {
    const W = CONFIG.world;
    if (x <= W.minX + 1 || x >= W.maxX - 1) return false;
    if (z <= W.minZ + 1 || z >= W.maxZ - 1) return false;
    return true;
  }

  /**
   * É chão plano de arena — o critério de "lugar bom para nascer".
   *
   * Combina duas coisas: estar dentro da bacia (`arenaDistance` bem negativa,
   * portanto longe do sopé e da serra) e não estar numa ondulação íngreme do
   * próprio piso. É o que garante o que você pediu: ninguém nasce no alto de
   * uma montanha nem pendurado numa encosta.
   */
  isFlatGround(x, z, margin = CONFIG.world.arena.footBand, minSlope = 0.94) {
    if (!this.isWalkable(x, z)) return false;
    if (this.arenaDistance(x, z) > -margin) return false;
    return this.slopeAt(x, z, 1.0) >= minSlope;
  }
}

const _normal = { x: 0, y: 0, z: 0 };
