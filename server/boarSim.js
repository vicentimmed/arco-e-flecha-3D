/* ---------------------------------------------------------------------------
   Os porcos, no servidor.

   Por que aqui e não em cada cliente: a IA sorteia. Para onde vagar, quando
   comer, para que lado fugir — tudo isso passa por `Math.random()`. Se cada
   navegador rodasse a mesma IA, em poucos segundos cada um teria os porcos num
   lugar diferente, e um jogador atiraria num porco que, para o amigo, já tinha
   saído dali. Com um simulador só, existe uma verdade.

   É a mesma máquina de estados de `entities/boar.js` — vagar, comer, fugir,
   acalmar —, só que sem malha e sem física: posição, ângulo e estado. O cliente
   recebe isso a 10 Hz, interpola e roda pernas e cabeça localmente, porque
   animação não precisa trafegar.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { pickBoarSpawn } from "./spawnPoints.js";

let proximoId = 1;

export class Boar {
  /**
   * @param {boolean} fun porco solto na mão por alguém, só por diversão.
   *   Ele anda e reage igual; só não vale ponto, porque ponto se ganha no modo
   *   caçada, onde as ondas vêm sozinhas e não dá para escolher a distância.
   */
  constructor(terrain, x, z, fun = false) {
    this.id = proximoId++;
    this.fun = fun;
    this.terrain = terrain;
    this.x = x;
    this.z = z;
    this.y = terrain.heightAt(x, z);
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.state = "wander";
    this.stateTimer = 0;
    this.fleeTimer = 0;
    this.dead = false;
    this.deadSince = 0;
    this.fleeFrom = null;
    this.pickWanderTarget();
  }

  pickWanderTarget() {
    const r = CONFIG.boar.wanderRadius;
    const ang = Math.random() * Math.PI * 2;
    const d = 3 + Math.random() * r;
    this.targetX = this.x + Math.cos(ang) * d;
    this.targetZ = this.z + Math.sin(ang) * d;
  }

  scare(x, z) {
    if (this.dead) return;
    this.state = "flee";
    this.fleeTimer = CONFIG.boar.scareDuration;
    this.fleeFrom = { x, z };
  }

  update(dt, jogadores) {
    if (this.dead) return;
    const cfg = CONFIG.boar;

    // Ver um jogador de perto assusta. É o que faz a caçada exigir aproximação
    // cuidadosa em vez de virar tiro ao alvo parado.
    for (const p of jogadores) {
      if (Math.hypot(p.x - this.x, p.z - this.z) >= cfg.visionRange) continue;
      this.state = "flee";
      this.fleeTimer = cfg.fleeDuration;
      this.fleeFrom = { x: p.x, z: p.z };
      break;
    }

    this.stateTimer += dt;
    switch (this.state) {
      case "wander":
        this.speed = cfg.walkSpeed;
        this.moveToward(this.targetX, this.targetZ, dt);
        if (this.stateTimer > cfg.wanderMaxTime) {
          this.state = "eat";
          this.stateTimer = 0;
          this.speed = 0;
        } else if (Math.hypot(this.targetX - this.x, this.targetZ - this.z) < 1.2) {
          this.pickWanderTarget();
        }
        break;

      case "eat":
        this.speed = 0;
        if (this.stateTimer > cfg.eatDuration) {
          this.state = "wander";
          this.stateTimer = 0;
          this.pickWanderTarget();
        }
        break;

      case "flee": {
        this.speed = cfg.fleeSpeed;
        if (this.fleeFrom) {
          const dx = this.x - this.fleeFrom.x;
          const dz = this.z - this.fleeFrom.z;
          const len = Math.hypot(dx, dz) || 1;
          this.yaw = Math.atan2(dx / len, dz / len);
          this.step(dx / len, dz / len, dt);
        }
        this.fleeTimer -= dt;
        if (this.fleeTimer <= 0) {
          this.state = "calm";
          this.stateTimer = 0;
        }
        break;
      }

      case "calm":
        this.speed = cfg.walkSpeed * 0.4;
        this.moveToward(this.targetX, this.targetZ, dt);
        if (this.stateTimer > cfg.calmDuration) {
          this.state = "wander";
          this.stateTimer = 0;
          this.pickWanderTarget();
        }
        break;
    }
  }

  moveToward(tx, tz, dt) {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const len = Math.hypot(dx, dz) || 1;
    this.yaw = Math.atan2(dx / len, dz / len);
    this.step(dx / len, dz / len, dt);
  }

  step(fx, fz, dt) {
    const passo = this.speed * dt;
    const nx = this.x + fx * passo;
    const nz = this.z + fz * passo;
    // Fugir para fora do mundo não é fuga: escolhe outro rumo.
    if (!this.terrain.isWalkable(nx, nz) || this.terrain.arenaDistance(nx, nz) > 8) {
      this.pickWanderTarget();
      return;
    }
    this.x = nx;
    this.z = nz;
    this.y = this.terrain.heightAt(nx, nz);
  }

  /** Só o essencial para a tela — a animação é local. */
  view() {
    return {
      id: this.id,
      p: [r3(this.x), r3(this.y), r3(this.z)],
      y: r3(this.yaw),
      v: r3(this.speed),
      s: this.state,
    };
  }
}

/* ------------------------------------------------------------- a caçada ---- */

/**
 * O modo de caçada: ondas que crescem.
 *
 * Cinco porcos ao ligar e, a cada `waveInterval`, mais uma leva — que aumenta
 * de tamanho a cada onda. Todos os números vivem em `CONFIG.modes.boarHunt`,
 * que é o arquivo de configuração pedido: dá para deixar a caçada mansa ou
 * insana sem tocar em código.
 */
export class BoarHunt {
  constructor(terrain) {
    this.terrain = terrain;
    /** @type {Boar[]} */
    this.boars = [];
    this.active = false;
    this.waveTimer = 0;
    this.waveCount = 0;
  }

  get vivos() {
    return this.boars.reduce((n, b) => n + (b.dead ? 0 : 1), 0);
  }

  start(jogadores) {
    if (this.active) return;
    this.active = true;
    this.waveTimer = 0;
    this.waveCount = 0;
    this.spawnMany(CONFIG.modes.boarHunt.initialBoars, jogadores);
  }

  /**
   * Encerra as ondas — mas NÃO varre o campo.
   *
   * Os porcos soltos na mão são independentes do modo: alguém que largou dois
   * javalis para brincar de tiro móvel não deveria perdê-los porque outro
   * jogador desligou a caçada.
   */
  stop() {
    this.active = false;
    this.boars = this.boars.filter((b) => b.fun);
  }

  spawnMany(quantos, jogadores, fun = false) {
    const B = CONFIG.modes.boarHunt;
    const criados = [];
    for (let i = 0; i < quantos && this.vivos < B.maxAlive; i++) {
      const ponto = pickBoarSpawn(this.terrain, jogadores);
      if (!ponto) continue;
      const b = new Boar(this.terrain, ponto.x, ponto.z, fun);
      this.boars.push(b);
      criados.push(b);
    }
    return criados;
  }

  /** Marca como morto. Devolve o porco, ou null se já estava. */
  kill(id, agora) {
    const b = this.boars.find((x) => x.id === id);
    if (!b || b.dead) return null;
    b.dead = true;
    b.deadSince = agora;
    b.speed = 0;
    return b;
  }

  /** Assusta os porcos perto de onde uma flecha caiu. */
  scareNear(x, z) {
    const raio = CONFIG.boar.scareRadius;
    for (const b of this.boars) {
      if (b.dead) continue;
      if (Math.hypot(b.x - x, b.z - z) < raio) b.scare(x, z);
    }
  }

  update(dt, jogadores, agora) {
    const B = CONFIG.modes.boarHunt;

    // Os porcos andam sempre que existem — inclusive os avulsos, fora da
    // caçada. Só as ONDAS dependem do modo estar ligado.
    for (const b of this.boars) b.update(dt, jogadores);

    // Corpos somem depois de um tempo, senão o campo vira um matadouro que só
    // acumula geometria.
    this.boars = this.boars.filter(
      (b) => !b.dead || agora - b.deadSince < B.corpseLifetime * 1000,
    );

    if (!this.active) return;
    this.waveTimer += dt;
    if (this.waveTimer < B.waveInterval) return;
    this.waveTimer = 0;
    this.waveCount++;
    // A leva cresce: a caçada aperta sozinha conforme você aguenta.
    const tamanho = B.waveSize + B.waveGrowth * (this.waveCount - 1);
    this.spawnMany(tamanho, jogadores);
  }

  view() {
    return this.boars.map((b) => (b.dead ? { id: b.id, d: 1 } : b.view()));
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Pontos por um abate, em função da distância do disparo.
 *
 * Porco longe vale mais — é o que separa quem se aproxima devagar e mata de
 * perto de quem acerta um tiro difícil. A curva com expoente faz a recompensa
 * crescer mais rápido no fim do alcance, para que os últimos metros valham a
 * pena de verdade em vez de renderem só mais uns pontinhos.
 */
export function boarPoints(distancia) {
  const S = CONFIG.modes.boarHunt.score;
  const span = S.farDistance - S.nearDistance;
  const t = Math.max(0, Math.min(1, (distancia - S.nearDistance) / (span || 1)));
  return Math.round(S.minPoints + (S.maxPoints - S.minPoints) * t ** S.curve);
}
