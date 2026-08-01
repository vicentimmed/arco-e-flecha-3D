/* ---------------------------------------------------------------------------
   Ruído de valor com interpolação suave + FBM. Serve para o relevo do terreno,
   para a variação contínua do vento e para o espalhamento de vegetação.
   Determinístico: mesma seed ⇒ mesmo mundo.
   --------------------------------------------------------------------------- */

import { makeRandom } from "./math.js";

const TABLE_SIZE = 512;
const MASK = TABLE_SIZE - 1;

export class ValueNoise {
  constructor(seed = 1337) {
    const random = makeRandom(seed);
    this.values = new Float32Array(TABLE_SIZE);
    this.perm = new Uint16Array(TABLE_SIZE * 2);
    for (let i = 0; i < TABLE_SIZE; i++) {
      this.values[i] = random() * 2 - 1;
      this.perm[i] = i;
    }
    for (let i = TABLE_SIZE - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const t = this.perm[i];
      this.perm[i] = this.perm[j];
      this.perm[j] = t;
    }
    for (let i = 0; i < TABLE_SIZE; i++) this.perm[TABLE_SIZE + i] = this.perm[i];
  }

  /** Ruído 2D em [-1, 1]. */
  noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);

    const p = this.perm;
    const a = p[(xi & MASK) + p[yi & MASK]];
    const b = p[((xi + 1) & MASK) + p[yi & MASK]];
    const c = p[(xi & MASK) + p[(yi + 1) & MASK]];
    const d = p[((xi + 1) & MASK) + p[(yi + 1) & MASK]];

    const v0 = this.values[a & MASK];
    const v1 = this.values[b & MASK];
    const v2 = this.values[c & MASK];
    const v3 = this.values[d & MASK];

    const top = v0 + (v1 - v0) * u;
    const bottom = v2 + (v3 - v2) * u;
    return top + (bottom - top) * v;
  }

  /** Ruído 1D (fatia do 2D) — usado pelo vento. */
  noise1(x) {
    return this.noise2(x, 0.371);
  }

  /** Soma de oitavas. */
  fbm2(x, y, octaves = 4, lacunarity = 2.03, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(fx, fy) * amp;
      norm += amp;
      amp *= gain;
      fx *= lacunarity;
      fy *= lacunarity;
    }
    return sum / (norm || 1);
  }

  /** FBM "ridged": cria cristas — bom para paredes rochosas. */
  ridged2(x, y, octaves = 4, lacunarity = 2.11, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let i = 0; i < octaves; i++) {
      sum += (1 - Math.abs(this.noise2(fx, fy))) * amp;
      norm += amp;
      amp *= gain;
      fx *= lacunarity;
      fy *= lacunarity;
    }
    return (sum / (norm || 1)) * 2 - 1;
  }
}
