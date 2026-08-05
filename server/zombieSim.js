/* ---------------------------------------------------------------------------
   Os zumbis e lobos, no servidor.

   Lobos entram mesclados nas hordas: mais rápidos, 1 flecha, uivam no cliente.
   Contam para limpar a horda junto com os zumbis.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";

let proximoId = 1;

const DEFLECTIONS = [0, 0.45, -0.45, 0.95, -0.95, 1.6, -1.6];
const TAU = Math.PI * 2;

function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function clampTurn(current, target, maxDelta) {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export class Zombie {
  constructor(terrain, x, z, speed = null) {
    const Z = CONFIG.modes.zombie;
    this.id = proximoId++;
    this.kind = "zombie";
    this.terrain = terrain;
    this.x = x;
    this.z = z;
    this.y = terrain.heightAt(x, z);
    this.yaw = 0;
    this.state = "walk";
    this.dead = false;
    this.deadSince = 0;
    this.burning = false;
    this.hits = 0;
    this.lastAttack = -Infinity;

    const base = speed ?? Z.speed;
    this.speed = base * (1 + (Math.random() * 2 - 1) * Z.speedVariation);
  }

  update(dt, jogadores, agora) {
    if (this.dead) return null;
    const Z = CONFIG.modes.zombie;

    const alvo = this.pickTarget(jogadores);
    if (!alvo) {
      this.walkToward(Z.centerX, Z.centerZ, dt);
      this.state = "walk";
      return null;
    }

    const d = Math.hypot(alvo.x - this.x, alvo.z - this.z);

    if (d <= Z.attackRadius) {
      this.state = "attack";
      this.faceToward(alvo.x, alvo.z);
      if (agora - this.lastAttack < Z.attackInterval * 1000) return null;
      this.lastAttack = agora;
      return alvo.id;
    }

    this.state = "walk";
    this.walkToward(alvo.x, alvo.z, dt);
    return null;
  }

  pickTarget(jogadores) {
    let melhor = null;
    let melhorD = Infinity;
    for (const p of jogadores) {
      if (p.alive === false) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < melhorD) {
        melhorD = d;
        melhor = p;
      }
    }
    return melhor;
  }

  faceToward(x, z) {
    this.yaw = Math.atan2(x - this.x, z - this.z);
  }

  walkToward(tx, tz, dt) {
    this.faceToward(tx, tz);
    for (const desvio of DEFLECTIONS) {
      const ang = this.yaw + desvio;
      if (this.step(Math.sin(ang), Math.cos(ang), dt)) {
        this.yaw = ang;
        return true;
      }
    }
    return false;
  }

  step(fx, fz, dt) {
    const passo = this.speed * dt;
    const nx = this.x + fx * passo;
    const nz = this.z + fz * passo;
    if (!this.terrain.isWalkable(nx, nz) || this.terrain.arenaDistance(nx, nz) > 10) {
      return false;
    }
    this.x = nx;
    this.z = nz;
    this.y = this.terrain.heightAt(nx, nz);
    return true;
  }

  hit(head) {
    if (this.dead) return { morreu: false, head: false };
    if (head) {
      this.burning = true;
      return { morreu: true, head: true };
    }
    this.hits++;
    return { morreu: this.hits >= CONFIG.modes.zombie.bodyHits, head: false };
  }

  /** Cabeça, ou corpo com tensão máxima do arco. */
  hitWithSpeed(head, speed = 0) {
    if (this.dead) return { morreu: false, head: false };
    const limiar = CONFIG.modes.zombie.fullDrawKillSpeed ?? CONFIG.bow.maxSpeed * 0.98;
    if (!head && speed >= limiar) {
      this.hits = CONFIG.modes.zombie.bodyHits;
      return { morreu: true, head: false };
    }
    return this.hit(head);
  }
}

/** Lobo: rush rápido, uma flecha mata, prefere alvo isolado; salta ao chegar perto. */
export class Wolf {
  /**
   * @param {"zombie"|"elk"} profile — tuning de velocidade/IA por modo.
   */
  constructor(terrain, x, z, profile = "zombie") {
    const Z = CONFIG.modes.zombie;
    const tuning = profile === "elk" ? CONFIG.elk : Z;
    const AI = tuning.wolfAI ?? Z.wolfAI ?? {};
    this.id = proximoId++;
    this.kind = "wolf";
    this.terrain = terrain;
    this.x = x;
    this.z = z;
    this.y = terrain.heightAt(x, z);
    this.baseY = this.y;
    this.yaw = 0;
    this.heading = 0;
    this.vel = 0;
    this.turnRate = 0;
    this.state = "walk";
    this.dead = false;
    this.deadSince = 0;
    this.burning = false;
    this.hits = 0;
    this.lastAttack = -Infinity;
    this.leapTimer = 0;
    this.leapFx = 0;
    this.leapFz = 0;
    this.leapRemain = 0;

    const base = tuning.wolfSpeed ?? Z.wolfSpeed;
    this.baseSpeed = base * (1 + (Math.random() * 2 - 1) * (Z.wolfSpeedVariation ?? 0.08));
    this.speed = this.baseSpeed;
    this.leapSpeed = tuning.wolfLeapSpeed ?? Z.wolfLeapSpeed ?? 11;
    this._aiConfig = AI;
    /** Com 2 jogadores: trava em um alvo (id) para a matilha se dividir. */
    this.lockedTargetId = null;

    /** Curva de aproximação: lado sustentado por alguns segundos. */
    this.bearingSide = Math.random() < 0.5 ? 1 : -1;
    this.bearingHold = this._nextBearingHold(AI);
    this.bearingOffset = this._pickBearingOffset(AI);
    this._whiskerBlockedSide = 0;
  }

  _ai() {
    return this._aiConfig ?? CONFIG.modes.zombie.wolfAI ?? {};
  }

  _nextBearingHold(AI = this._ai()) {
    const tMin = AI.bearingHoldMin ?? 3.0;
    const tMax = AI.bearingHoldMax ?? 6.0;
    return tMin + Math.random() * (tMax - tMin);
  }

  _pickBearingOffset(AI = this._ai()) {
    const aMin = AI.bearingOffsetMin ?? 0.26;
    const aMax = AI.bearingOffsetMax ?? 0.61;
    return aMin + Math.random() * (aMax - aMin);
  }

  maxTurnRate(v) {
    const AI = this._ai();
    const tMax = AI.turnRateMax ?? 3.2;
    const tMin = AI.turnRateMin ?? 1.1;
    const frac = Math.min(1, Math.max(0, v / Math.max(0.01, this.baseSpeed)));
    return tMax - (tMax - tMin) * frac;
  }

  update(dt, jogadores, agora, vizinhos = []) {
    if (this.dead) return null;
    const Z = CONFIG.modes.zombie;
    this.baseY = this.terrain.heightAt(this.x, this.z);

    if (this.state === "leap") {
      return this.updateLeap(dt, jogadores, agora);
    }

    const alvo = this.pickTarget(jogadores);
    if (!alvo) {
      this.steer(dt, Z.centerX, Z.centerZ, 0.65, vizinhos);
      this.state = "walk";
      this.y = this.baseY;
      return null;
    }

    const d = Math.hypot(alvo.x - this.x, alvo.z - this.z);
    const reach = Z.wolfAttackRadius ?? 1.4;
    const leapRange = Z.wolfLeapRange ?? 5;

    if (d <= reach) {
      this.state = "attack";
      this.y = this.baseY;
      this.vel = Math.max(0, this.vel - (this._ai().brake ?? 11) * dt);
      this.faceToward(alvo.x, alvo.z);
      this.heading = this.yaw;
      if (agora - this.lastAttack < (Z.wolfAttackInterval ?? 1) * 1000) return null;
      this.lastAttack = agora;
      return alvo.id;
    }

    if (d <= leapRange && agora - this.lastAttack >= (Z.wolfAttackInterval ?? 1) * 1000) {
      if (this.isAlignedTo(alvo.x, alvo.z)) {
        this.beginLeap(alvo);
        return null;
      }
    }

    this.state = "walk";
    this.y = this.baseY;

    const AI = this._ai();
    const speedFrac = d <= leapRange ? (AI.speedChase ?? 1.0) : (AI.speedApproach ?? 0.65);
    this.chaseWithBearing(alvo, dt, speedFrac, vizinhos);
    return null;
  }

  isAlignedTo(tx, tz) {
    const AI = this._ai();
    const cone = AI.leapAlignCone ?? 0.61;
    const toTarget = Math.atan2(tx - this.x, tz - this.z);
    return Math.abs(angleDelta(this.heading, toTarget)) <= cone;
  }

  /** Perseguição em curva sustentada — substitui zigue-zague por waypoint. */
  chaseWithBearing(alvo, dt, speedFrac, vizinhos) {
    const AI = this._ai();
    this.bearingHold -= dt;
    if (this.bearingHold <= 0 || this._whiskerBlockedSide !== 0) {
      if (this._whiskerBlockedSide !== 0) {
        this.bearingSide = -this._whiskerBlockedSide;
        this._whiskerBlockedSide = 0;
      }
      this.bearingHold = this._nextBearingHold(AI);
      this.bearingOffset = this._pickBearingOffset(AI);
    }

    const dx = alvo.x - this.x;
    const dz = alvo.z - this.z;
    const dist = Math.hypot(dx, dz) || 1;
    const fade = AI.approachFadeDist ?? 18;
    const fadeT = Math.min(1, dist / fade);
    const offset = this.bearingOffset * fadeT * this.bearingSide;
    const baseAng = Math.atan2(dx, dz);
    const seekAng = baseAng + offset;
    const seekDist = Math.min(dist, 8);
    const tx = this.x + Math.sin(seekAng) * seekDist;
    const tz = this.z + Math.cos(seekAng) * seekDist;
    this.steer(dt, tx, tz, speedFrac, vizinhos);
  }

  /**
   * Motor de locomoção: seek + separação + whiskers → giro limitado + aceleração.
   */
  steer(dt, tx, tz, speedFrac, vizinhos = []) {
    const AI = this._ai();
    const accel = AI.accel ?? 7.0;
    const brake = AI.brake ?? 11.0;
    const sepRadius = AI.separationRadius ?? 1.8;
    const whiskerAng = AI.whiskerAngle ?? 0.61;

    let sx = tx - this.x;
    let sz = tz - this.z;
    const slen = Math.hypot(sx, sz);
    if (slen > 1e-4) {
      sx /= slen;
      sz /= slen;
    } else {
      sx = Math.sin(this.heading);
      sz = Math.cos(this.heading);
    }

    // Separação entre lobos.
    for (const outro of vizinhos) {
      if (outro === this || outro.dead) continue;
      const ox = this.x - outro.x;
      const oz = this.z - outro.z;
      const od = Math.hypot(ox, oz);
      if (od < 1e-4 || od >= sepRadius) continue;
      const peso = (sepRadius - od) / sepRadius;
      sx += (ox / od) * peso * 1.4;
      sz += (oz / od) * peso * 1.4;
    }

    // Whiskers de terreno — empurra rumo, registra lado bloqueado.
    const probeLen = this.vel * 0.5 + 0.8;
    const probes = [
      { ang: 0, side: 0 },
      { ang: whiskerAng, side: 1 },
      { ang: -whiskerAng, side: -1 },
    ];
    let blockedSide = 0;
    for (const p of probes) {
      const ang = this.heading + p.ang;
      const px = this.x + Math.sin(ang) * probeLen;
      const pz = this.z + Math.cos(ang) * probeLen;
      if (this.terrain.isWalkable(px, pz) && this.terrain.arenaDistance(px, pz) <= 10) continue;
      if (p.side !== 0) blockedSide = p.side;
      const push = p.side === 0 ? 1.2 : 0.9;
      sx += Math.sin(this.heading - p.ang) * push;
      sz += Math.cos(this.heading - p.ang) * push;
    }
    if (blockedSide !== 0) this._whiskerBlockedSide = blockedSide;

    const desired = Math.atan2(sx, sz);
    const prevHeading = this.heading;
    const maxTurn = this.maxTurnRate(this.vel) * dt;
    this.heading = clampTurn(this.heading, desired, maxTurn);
    this.turnRate = angleDelta(prevHeading, this.heading) / Math.max(dt, 1e-4);

    const alvoVel = this.baseSpeed * speedFrac;
    if (this.vel < alvoVel) {
      this.vel = Math.min(alvoVel, this.vel + accel * dt);
    } else {
      this.vel = Math.max(alvoVel, this.vel - brake * dt);
    }

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    if (!this.step(fx, fz, dt)) {
      this.vel = Math.max(0, this.vel - brake * dt * 1.5);
    }
    this.yaw = this.heading;
  }

  beginLeap(alvo) {
    const Z = CONFIG.modes.zombie;
    const dx = alvo.x - this.x;
    const dz = alvo.z - this.z;
    const len = Math.hypot(dx, dz) || 1;
    this.leapFx = dx / len;
    this.leapFz = dz / len;
    // O salto termina pouco depois do ponto onde foi disparado. Sem esse
    // limite, o perfil rápido do alce atravessa o jogador e só verifica o hit
    // muitos metros depois, já fora do raio de ataque.
    this.leapRemain = len + 1.0;
    this.heading = Math.atan2(this.leapFx, this.leapFz);
    this.yaw = this.heading;
    this.state = "leap";
    this.leapTimer = 0;
    this.speed = this.leapSpeed;
    this.vel = this.leapSpeed;
  }

  updateLeap(dt, jogadores, agora) {
    const Z = CONFIG.modes.zombie;
    const AI = this._ai();
    const dur = Z.wolfLeapDuration ?? 0.45;
    const leapSpeed = this.leapSpeed;
    this.leapTimer += dt;
    const t = Math.min(1, this.leapTimer / dur);
    const passo = Math.min(leapSpeed * dt, this.leapRemain);
    const nx = this.x + this.leapFx * passo;
    const nz = this.z + this.leapFz * passo;
    if (this.terrain.isWalkable(nx, nz) && this.terrain.arenaDistance(nx, nz) <= 10) {
      this.x = nx;
      this.z = nz;
    }
    this.leapRemain = Math.max(0, this.leapRemain - passo);
    this.baseY = this.terrain.heightAt(this.x, this.z);
    this.y = this.baseY + Math.sin(t * Math.PI) * (Z.wolfLeapHeight ?? 1.2);
    this.heading = Math.atan2(this.leapFx, this.leapFz);
    this.yaw = this.heading;
    this.vel = leapSpeed;

    // O lobo pode atravessar o player durante o voo. O teste precisa ocorrer
    // antes do pouso, e em cada tick, para que o salto seja uma colisão real.
    const alvoNoAr = this.pickTarget(jogadores);
    if (
      alvoNoAr &&
      Math.hypot(alvoNoAr.x - this.x, alvoNoAr.z - this.z) <=
        (Z.wolfAttackRadius ?? 1.4) * 2.2
    ) {
      this.lastAttack = agora;
      this.y = this.baseY;
      this.state = "attack";
      return alvoNoAr.id;
    }

    if (this.leapTimer < dur) return null;

    this.y = this.baseY;
    const landFrac = AI.leapLandSpeedFrac ?? 0.55;
    this.vel = leapSpeed * landFrac;
    this.speed = this.baseSpeed;
    this.state = "attack";
    this.lastAttack = agora;
    const alvo = this.pickTarget(jogadores);
    if (!alvo) {
      this.state = "walk";
      return null;
    }
    const d = Math.hypot(alvo.x - this.x, alvo.z - this.z);
    if (d <= (Z.wolfAttackRadius ?? 1.4) * 2.2) return alvo.id;
    this.state = "walk";
    return null;
  }

  /**
   * Com exatamente 2 vivos: a matilha se divide — cada lobo trava num dos dois
   * (pelo id do lobo), para não empilharem no mesmo arqueiro.
   * Com 1 ou 3+: prefere o mais isolado (ou o único).
   */
  pickTarget(jogadores) {
    const vivos = jogadores.filter((p) => p.alive !== false);
    if (!vivos.length) {
      this.lockedTargetId = null;
      return null;
    }
    if (vivos.length === 1) {
      this.lockedTargetId = vivos[0].id;
      return vivos[0];
    }

    if (vivos.length === 2) {
      // Ordena por id para a divisão ser estável entre ticks.
      const ordenados = [...vivos].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const slot = this.id % 2;
      const preferido = ordenados[slot];
      // Mantém o lock se o alvo ainda está vivo; senão troca para o outro.
      if (this.lockedTargetId != null) {
        const locked = ordenados.find((p) => p.id === this.lockedTargetId);
        if (locked) return locked;
      }
      this.lockedTargetId = preferido.id;
      return preferido;
    }

    this.lockedTargetId = null;
    let melhor = null;
    let melhorNota = -Infinity;
    for (const p of vivos) {
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      let isol = Infinity;
      for (const q of vivos) {
        if (q === p) continue;
        isol = Math.min(isol, Math.hypot(p.x - q.x, p.z - q.z));
      }
      const nota = isol * 0.55 - d * 0.45;
      if (nota > melhorNota) {
        melhorNota = nota;
        melhor = p;
      }
    }
    return melhor;
  }

  faceToward(x, z) {
    this.yaw = Math.atan2(x - this.x, z - this.z);
  }

  walkToward(tx, tz, dt, vizinhos = []) {
    return this.steer(dt, tx, tz, 1.0, vizinhos);
  }

  step(fx, fz, dt) {
    const passo = this.vel * dt;
    const nx = this.x + fx * passo;
    const nz = this.z + fz * passo;
    if (!this.terrain.isWalkable(nx, nz) || this.terrain.arenaDistance(nx, nz) > 10) {
      return false;
    }
    this.x = nx;
    this.z = nz;
    this.y = this.terrain.heightAt(nx, nz);
    return true;
  }

  hit(_head) {
    if (this.dead) return { morreu: false, head: false };
    return { morreu: true, head: false };
  }
}

export class ZombieNight {
  constructor(terrain) {
    this.terrain = terrain;
    /** @type {(Zombie|Wolf)[]} */
    this.zombies = [];
    this.active = false;
    this.horde = 0;
    this.hordeTimer = 0;
    this.spawnPhase = 0;
    this.over = false;
    this.overReason = null;
    this.pendingWolves = 0;
    this.zombiesKilledInHorde = 0;
    this.plannedWolves = 0;
    /** @type {{ timer: number, i: number, total: number, isWolf: boolean }[]} */
    this.pendingSpawns = [];
  }

  get vivos() {
    return this.zombies.reduce((n, z) => n + (z.dead ? 0 : 1), 0);
  }

  hordeSize(n) {
    const lista = CONFIG.modes.zombie.hordeSizes;
    return lista[Math.max(0, Math.min(lista.length, n) - 1)] ?? lista[lista.length - 1];
  }

  wolfCount(n) {
    const lista = CONFIG.modes.zombie.wolfCounts ?? [];
    return lista[Math.max(0, Math.min(lista.length, n) - 1)] ?? 0;
  }

  hordeSpeed(n) {
    const Z = CONFIG.modes.zombie;
    const lista = Z.hordeSpeeds;
    return lista[Math.max(0, Math.min(lista.length, n) - 1)] ?? Z.speed;
  }

  start() {
    this.active = true;
    this.over = false;
    this.overReason = null;
    this.zombies = [];
    this.horde = 0;
    this.hordeTimer = 0;
    this.pendingWolves = 0;
    this.plannedWolves = 0;
    this.zombiesKilledInHorde = 0;
    this.pendingSpawns = [];
    this.spawnPhase = Math.random() * Math.PI * 2;
    return this.nextHorde();
  }

  stop() {
    this.active = false;
    this.zombies = [];
    this.horde = 0;
    this.pendingWolves = 0;
    this.plannedWolves = 0;
    this.zombiesKilledInHorde = 0;
    this.pendingSpawns = [];
    this.over = false;
    this.overReason = null;
  }

  nextHorde() {
    const Z = CONFIG.modes.zombie;
    if (this.horde >= Z.hordes) return null;
    this.horde++;
    const size = this.hordeSize(this.horde);
    const wolves = this.wolfCount(this.horde);
    this.spawnPhase += 0.7 + Math.random() * 1.4;
    this.pendingWolves = wolves;
    this.plannedWolves = wolves;
    this.zombiesKilledInHorde = 0;
    this.pendingSpawns = [];

    const stagger = Z.spawnStagger ?? 0.85;
    for (let i = 0; i < size; i++) {
      this.pendingSpawns.push({
        timer: i * stagger + Math.random() * stagger * 0.35,
        i,
        total: size,
        isWolf: false,
      });
    }
    // Lobos entram intercalados conforme zumbis morrem — não no start.

    return { n: this.horde, size: size + wolves };
  }

  /** Raio de spawn variado: alterna perto/longe para espalhar chegadas ao centro. */
  spawnRadiusFor(i, total, isWolf) {
    const Z = CONFIG.modes.zombie;
    const rMin = Z.spawnRadiusMin ?? Z.spawnRadius - (Z.spawnJitter ?? 5);
    const rMax = Z.spawnRadiusMax ?? Z.spawnRadius + (Z.spawnJitter ?? 5);
    const t = total > 1 ? i / (total - 1) : 0.5;
    // Onda senoidal + offset por índice: vizinhos não ficam na mesma distância.
    const wave = 0.5 + 0.5 * Math.sin(i * 2.17 + this.spawnPhase);
    const base = rMin + (rMax - rMin) * (t * 0.35 + wave * 0.65);
    const jitter = (Math.random() - 0.5) * (Z.spawnJitter ?? 4);
    const bonus = isWolf ? (Z.wolfSpawnRadiusBonus ?? 6) : 0;
    return base + jitter + bonus;
  }

  tickPendingSpawns(dt) {
    for (let j = this.pendingSpawns.length - 1; j >= 0; j--) {
      const ps = this.pendingSpawns[j];
      ps.timer -= dt;
      if (ps.timer <= 0) {
        this.spawnAt(ps.i, ps.total, ps.isWolf);
        this.pendingSpawns.splice(j, 1);
      }
    }
  }

  /**
   * @param {boolean} isWolf
   */
  spawnAt(i, total, isWolf = false) {
    const Z = CONFIG.modes.zombie;
    const setor = (Math.PI * 2) / total;
    // Lobos nascem nos “meios” dos setores dos zumbis: fase deslocada.
    const faseExtra = isWolf ? setor * 0.5 + 0.35 : 0;
    const ang =
      this.spawnPhase + faseExtra + i * setor + (Math.random() - 0.5) * setor * 0.7;
    const raio = this.spawnRadiusFor(i, total, isWolf);

    let x = 0;
    let z = 0;
    let achou = false;
    for (let r = raio; r > 14; r -= 2) {
      x = Z.centerX + Math.sin(ang) * r;
      z = Z.centerZ + Math.cos(ang) * r;
      if (this.terrain.isWalkable(x, z) && this.terrain.arenaDistance(x, z) <= 5) {
        achou = true;
        break;
      }
    }
    if (!achou) return null;

    const bicho = isWolf
      ? new Wolf(this.terrain, x, z)
      : new Zombie(this.terrain, x, z, this.hordeSpeed(this.horde));
    bicho.faceToward(Z.centerX, Z.centerZ);
    this.zombies.push(bicho);
    return bicho;
  }

  byId(id) {
    return this.zombies.find((z) => z.id === id) ?? null;
  }

  hit(id, head, speed = 0) {
    const zumbi = this.byId(id);
    if (!zumbi || zumbi.dead) return null;
    const r =
      zumbi.kind === "wolf"
        ? zumbi.hit(head)
        : typeof zumbi.hitWithSpeed === "function"
          ? zumbi.hitWithSpeed(head, speed)
          : zumbi.hit(head);
    return { zombie: zumbi, morreu: r.morreu, head: r.head };
  }

  kill(id, agora) {
    const zumbi = this.byId(id);
    if (!zumbi || zumbi.dead) return null;
    zumbi.dead = true;
    zumbi.deadSince = agora;
    zumbi.state = "dead";

    if (zumbi.kind !== "wolf") {
      this.zombiesKilledInHorde++;
      this.trySpawnPendingWolf();
    }
    return zumbi;
  }

  /** 1 lobo a cada N zumbis mortos; se só sobram pending e zero zumbis, libera 1. */
  trySpawnPendingWolf() {
    if (this.pendingWolves <= 0) return;
    const aCada = CONFIG.modes.zombie.wolfEveryZombieKills ?? 3;
    const zumbisVivos = this.zombies.reduce(
      (n, z) => n + (!z.dead && z.kind !== "wolf" ? 1 : 0),
      0,
    );
    const noRitmo =
      this.zombiesKilledInHorde > 0 && this.zombiesKilledInHorde % aCada === 0;
    if (noRitmo || zumbisVivos === 0) {
      const idx = this.plannedWolves - this.pendingWolves;
      const total = Math.max(1, this.plannedWolves);
      const delay =
        (CONFIG.modes.zombie.wolfSpawnDelay ?? 1.0) +
        idx * (CONFIG.modes.zombie.wolfSpawnStagger ?? 1.4) +
        Math.random() * 0.5;
      this.pendingSpawns.push({
        timer: delay,
        i: idx,
        total,
        isWolf: true,
      });
      this.pendingWolves--;
    }
  }

  update(dt, jogadores, agora) {
    const Z = CONFIG.modes.zombie;
    const ataques = [];

    this.tickPendingSpawns(dt);

    const lobosVivos = this.zombies.filter((z) => !z.dead && z.kind === "wolf");

    for (const zumbi of this.zombies) {
      if (zumbi.dead) continue;
      const vizinhos = zumbi.kind === "wolf" ? lobosVivos : [];
      const alvo = zumbi.update(dt, jogadores, agora, vizinhos);
      if (alvo != null) ataques.push({ zombieId: zumbi.id, playerId: alvo });
    }

    // Se a horda limpou os zumbis mas ainda há lobos pendentes, solta um por tick de horda.
    if (
      this.active &&
      !this.over &&
      this.pendingWolves > 0 &&
      this.zombies.every((z) => z.dead || z.kind === "wolf")
    ) {
      this.trySpawnPendingWolf();
    }

    this.zombies = this.zombies.filter(
      (z) => !z.dead || agora - z.deadSince < Z.corpseLifetime * 1000,
    );

    let horda = null;
    let venceu = false;

    if (this.active && !this.over && this.vivos === 0 && this.pendingWolves === 0 && this.pendingSpawns.length === 0) {
      this.hordeTimer += dt;
      if (this.hordeTimer >= Z.hordeDelay) {
        this.hordeTimer = 0;
        horda = this.nextHorde();
        if (!horda) {
          venceu = true;
          this.over = true;
          this.overReason = "win";
        }
      }
    } else {
      this.hordeTimer = 0;
    }

    return { ataques, horda, venceu };
  }

  gameOver(reason = "wipe") {
    this.over = true;
    this.overReason = reason;
    this.zombies = [];
  }

  view() {
    return this.zombies.map((z) => ({
      id: z.id,
      p: [round(z.x), round(z.y), round(z.z)],
      y: round(z.yaw),
      s: z.state,
      b: z.burning ? 1 : 0,
      d: z.dead ? 1 : 0,
      k: z.kind === "wolf" ? "w" : "z",
    }));
  }
}

function round(v) {
  return Math.round(v * 100) / 100;
}
