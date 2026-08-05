/* ---------------------------------------------------------------------------
   Lobos invocados pelo alce na caçada.

   Reutiliza a classe Wolf do modo zumbi (perseguição + salto). Spawnam ao redor
   do alce quando a vida dele cai a ≤70% (ou via atalho de teste).
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { Wolf } from "./zombieSim.js";

export class ElkWolfPack {
  constructor(terrain) {
    this.terrain = terrain;
    /** @type {Wolf[]} */
    this.wolves = [];
    this.nextWaveAt = 0;
    this.wavesStarted = 0;
    /** Flechas que o alce já tinha levado quando a última onda nasceu. */
    this.hitsAtLastWave = 0;
    /** @type {{ timer: number, elk: object, i: number, total: number, nPlayers: number }[]} */
    this.pendingSpawns = [];
  }

  get vivos() {
    return this.wolves.reduce((n, w) => n + (w.dead ? 0 : 1), 0);
  }

  clear() {
    this.wolves = [];
    this.nextWaveAt = 0;
    this.wavesStarted = 0;
    this.hitsAtLastWave = 0;
    this.pendingSpawns = [];
  }

  packSize(nPlayers) {
    const E = CONFIG.elk;
    const n = Math.max(1, nPlayers | 0);
    return (E.wolfPackBase ?? 4) + (E.wolfPackPerPlayer ?? 2) * (n - 1);
  }

  /**
   * Spawna uma onda ao redor do alce, escalonada no tempo e em distância.
   * @returns {number} quantos lobos entraram na fila
   */
  spawnAround(elk, nPlayers = 1) {
    if (!elk || elk.dead) return 0;
    const n = this.packSize(nPlayers);
    const stagger = CONFIG.elk.wolfSpawnStagger ?? 1.2;
    for (let i = 0; i < n; i++) {
      this.pendingSpawns.push({
        timer: i * stagger + Math.random() * stagger * 0.4,
        elk,
        i,
        total: n,
        nPlayers,
      });
    }
    this.wavesStarted++;
    this.hitsAtLastWave = elk.hits ?? 0;
    return n;
  }

  spawnOne(elk, i, total) {
    const rMin = CONFIG.elk.wolfSpawnRadiusMin ?? 5;
    const rMax = CONFIG.elk.wolfSpawnRadiusMax ?? 14;
    const t = total > 1 ? i / (total - 1) : 0.5;
    const wave = 0.5 + 0.5 * Math.sin(i * 2.4);
    const d = rMin + t * (rMax - rMin) * 0.5 + wave * (rMax - rMin) * 0.5 + (Math.random() - 0.5) * 2;
    const ang = (Math.PI * 2 * i) / total + (Math.random() - 0.5) * 0.5;
    const x = elk.x + Math.cos(ang) * d;
    const z = elk.z + Math.sin(ang) * d;
    if (!this.terrain.isWalkable(x, z)) return 0;
    const lobo = new Wolf(this.terrain, x, z, "elk");
    lobo.faceToward(elk.x, elk.z);
    this.wolves.push(lobo);
    return 1;
  }

  tickPendingSpawns(dt) {
    for (let j = this.pendingSpawns.length - 1; j >= 0; j--) {
      const ps = this.pendingSpawns[j];
      ps.timer -= dt;
      if (ps.timer <= 0) {
        this.spawnOne(ps.elk, ps.i, ps.total);
        this.pendingSpawns.splice(j, 1);
      }
    }
  }

  /**
   * Gatilho automático por vida do alce + re-ondas.
   *
   * A primeira onda sai por vida (o alce chama a matilha quando começa a
   * perder). As seguintes só nascem quando TRÊS coisas coincidem: a matilha
   * anterior acabou, o intervalo mínimo passou, e o alce levou mais algumas
   * flechas desde então. A última condição é a que importa — sem ela, recuar e
   * matar lobos produzia matilha nova de graça, e a caçada nunca avançava.
   *
   * @returns {boolean} true se uma nova onda nasceu neste tick
   */
  tickSummon(elk, nPlayers, agora) {
    if (!elk || elk.dead || elk.fun) return false;
    const limiar = CONFIG.elk.wolfSummonHealth ?? 0.7;
    const frac = elk.health / Math.max(1, elk.maxHealth);
    if (frac > limiar) return false;

    if (this.wavesStarted === 0) {
      this.spawnAround(elk, nPlayers);
      this.nextWaveAt = agora + (CONFIG.elk.wolfWaveGap ?? 8) * 1000;
      return true;
    }

    if (this.vivos === 0 && !this.pendingSpawns.length && agora >= this.nextWaveAt) {
      const custo = CONFIG.elk.wolfWaveHits ?? 6;
      if ((elk.hits ?? 0) - this.hitsAtLastWave < custo) return false;
      this.spawnAround(elk, nPlayers);
      this.nextWaveAt = agora + (CONFIG.elk.wolfWaveGap ?? 8) * 1000;
      return true;
    }
    return false;
  }

  byId(id) {
    return this.wolves.find((w) => w.id === id) ?? null;
  }

  hit(id) {
    const lobo = this.byId(id);
    if (!lobo || lobo.dead) return null;
    const r = lobo.hit(false);
    return { wolf: lobo, morreu: r.morreu };
  }

  kill(id, agora) {
    const lobo = this.byId(id);
    if (!lobo || lobo.dead) return null;
    lobo.dead = true;
    lobo.deadSince = agora;
    lobo.state = "dead";
    return lobo;
  }

  update(dt, jogadores, agora) {
    this.tickPendingSpawns(dt);
    const ataques = [];
    const lobosVivos = this.wolves.filter((w) => !w.dead);
    for (const w of this.wolves) {
      if (w.dead) continue;
      const alvo = w.update(dt, jogadores, agora, lobosVivos);
      if (alvo != null) ataques.push({ wolfId: w.id, playerId: alvo });
    }
    const life = (CONFIG.modes.zombie.corpseLifetime ?? 7) * 1000;
    this.wolves = this.wolves.filter((w) => !w.dead || agora - w.deadSince < life);
    return { ataques };
  }

  view() {
    return this.wolves.map((z) => ({
      id: z.id,
      p: [round(z.x), round(z.y), round(z.z)],
      y: round(z.yaw),
      s: z.state,
      b: 0,
      d: z.dead ? 1 : 0,
      k: "w",
    }));
  }
}

function round(v) {
  return Math.round(v * 100) / 100;
}
