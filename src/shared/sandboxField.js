/* ---------------------------------------------------------------------------
   Campo do Sandbox — cenário de TESTE, isolado do resto do jogo.

   Serra pequena e barata em vez do vale inteiro, com uma diferença estrutural
   que nem o vale nem a Lua têm: cratera DINÂMICA de verdade.

   `moonField.js` sorteia a lista de crateras UMA VEZ, no construtor, e nunca
   mais toca nela — é altura fixa, congelada com o resto do relevo. Aqui o
   `grid` é um índice MUTÁVEL e `addCrater()` empurra uma cratera nova a
   qualquer momento, exatamente o padrão que `shared/namek/field.js` já usa
   para o modo Namekusei (fila com teto, a mais velha cede à mais nova).

   Puro (sem THREE/Rapier) pela mesma razão de `terrainField.js`/`moonField.js`:
   é o formato que o servidor também consumiria, se um dia o Sandbox precisar
   existir em rede — hoje ele é só local (ver o listener de cratera em
   `main.js`), mas o campo não precisa saber disso.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../config.js";
import { ValueNoise } from "../utils/noise.js";

const CELL = 16; // m — célula da grade de busca de crateras

export class SandboxField {
  constructor(seed = 20260815) {
    this.noise = new ValueNoise(seed);
    this.M = CONFIG.levels.sandbox;
    this.centerX = 0;
    this.centerZ = 0;
    this.radius = this.M.radius;

    this.spawnCenter = {
      x: 0,
      z: 0,
      radius: this.M.flatRadius * 0.65,
      minRadius: 4,
    };

    this.craters = [];
    this.grid = new Map();
    this.nextCraterId = 1;
  }

  /* -------------------------------------------------------------- altura -- */

  heightAt(x, z) {
    const M = this.M;
    const dist = Math.hypot(x - this.centerX, z - this.centerZ);

    let h = M.floorNoise * this.noise.fbm2(x * 0.05, z * 0.05, 3);

    const w = dist - M.wallStart;
    if (w > 0) {
      // Warp de domínio: a crista não vira um anel perfeitamente circular.
      const wx = x + 7 * this.noise.noise2(x * 0.015, z * 0.015);
      const wz = z + 7 * this.noise.noise2(x * 0.015 + 91, z * 0.015 - 33);
      const crista = 0.5 + 0.5 * this.noise.ridged2(wx * 0.04, wz * 0.04, 4, 2.1, 0.5);
      const massif = 0.6 + 0.4 * this.noise.fbm2(wx * 0.012, wz * 0.012, 2);
      const rise = 1 - Math.exp(-w / M.rampLength);
      h += M.peak * rise * massif * Math.pow(crista, 1.3);
    }

    const perto = this.cratersNear(x, z);
    if (perto) {
      for (const c of perto) h += this.craterDelta(c, x, z);
    }
    return h;
  }

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

  distanceToCenter(x, z) {
    return Math.hypot(x - this.centerX, z - this.centerZ);
  }

  arenaDistance(x, z) {
    return this.distanceToCenter(x, z) - this.radius;
  }

  isWalkable(x, z) {
    return this.distanceToCenter(x, z) <= this.radius;
  }

  isInsideWorld(x, z) {
    return this.distanceToCenter(x, z) <= this.M.world.half;
  }

  isFlatGround(x, z, margin = 6, minSlope = 0.9) {
    if (this.distanceToCenter(x, z) > this.M.flatRadius - margin) return false;
    return this.slopeAt(x, z, 1.0) >= minSlope;
  }

  /* ------------------------------------------------------------- cratera -- */

  key(cx, cz) {
    return `${cx},${cz}`;
  }

  indexCrater(c) {
    const min = Math.floor((c.x - c.raio) / CELL);
    const max = Math.floor((c.x + c.raio) / CELL);
    const zmin = Math.floor((c.z - c.raio) / CELL);
    const zmax = Math.floor((c.z + c.raio) / CELL);
    for (let cx = min; cx <= max; cx++) {
      for (let cz = zmin; cz <= zmax; cz++) {
        const k = this.key(cx, cz);
        let lista = this.grid.get(k);
        if (!lista) this.grid.set(k, (lista = []));
        lista.push(c);
      }
    }
  }

  reindexAll() {
    this.grid.clear();
    for (const c of this.craters) this.indexCrater(c);
  }

  cratersNear(x, z) {
    return this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
  }

  /**
   * Abre uma cratera nova, centrada em (x, z).
   *
   * O raio cresce com a RAIZ da velocidade de impacto (`power`, em m/s) — um
   * tiro forte e reto abre mais buraco que um roçar de raspão, mas o ganho
   * desacelera em vez de crescer linear. Fila com teto: sem ele `heightAt`
   * degradaria ao longo de uma sessão de teste longa (mesmo critério do
   * Namekusei, ver `shared/namek/field.js:addCrater`).
   */
  addCrater(x, z, power) {
    const D = this.M.destruction;
    const raio = Math.min(D.craterMax, D.craterBase + D.craterGain * Math.sqrt(Math.max(0, power)));
    const c = { id: this.nextCraterId++, x, z, raio, fundura: raio * D.craterDepth };
    this.craters.push(c);
    this.indexCrater(c);
    if (this.craters.length > D.craterLimit) {
      while (this.craters.length > D.craterLimit) this.craters.shift();
      this.reindexAll();
    }
    return c;
  }

  /** Bacia parabólica (cosseno) + borda elevada — mesmo perfil do Namekusei. */
  craterDelta(c, x, z) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d >= c.raio) return 0;
    const u = d / c.raio;
    const bacia = -c.fundura * Math.pow(Math.cos((u * Math.PI) / 2), 1.6);
    const anel = u > 0.66 ? Math.sin(((u - 0.66) / 0.34) * Math.PI) * c.fundura * 0.22 : 0;
    return bacia + anel;
  }

  /** Tingimento (bacia escura / borda clara) que `surfaceColor` consome. */
  craterShade(x, z) {
    const perto = this.cratersNear(x, z);
    let bowl = 0;
    let rim = 0;
    if (perto) {
      for (const c of perto) {
        const d = Math.hypot(x - c.x, z - c.z);
        if (d >= c.raio) continue;
        const u = d / c.raio;
        if (u < 0.66) bowl = Math.max(bowl, 1 - u / 0.66);
        else rim = Math.max(rim, Math.sin(((u - 0.66) / 0.34) * Math.PI));
      }
    }
    return { bowl, rim };
  }
}

const _normal = { x: 0, y: 0, z: 0 };
