/* ---------------------------------------------------------------------------
   Os zumbis, lobos e o chefão, no servidor.

   Lobos entram mesclados nas hordas: mais rápidos, 1 flecha, uivam no cliente.
   Horda 9 = um boss gigante com vida escalada por jogador.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";

let proximoId = 1;

const DEFLECTIONS = [0, 0.45, -0.45, 0.95, -0.95, 1.6, -1.6];
const TAU = Math.PI * 2;
const NPC_GRID_CELL = 2.5; // maior que o raio de separação dos lobos

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

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Zombie {
  constructor(terrain, x, z, speed = null, speedVar = null) {
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
    this.attackRadius = Z.attackRadius ?? 1.1;

    const base = speed ?? Z.speed;
    const varFrac = speedVar ?? Z.speedVariation;
    this.speed = base * (1 + (Math.random() * 2 - 1) * varFrac);
  }

  update(dt, jogadores, agora, vizinhos = []) {
    if (this.dead) return null;
    const Z = CONFIG.modes.zombie;

    const alvo = this.pickTarget(jogadores);
    if (!alvo) {
      this.walkToward(Z.centerX, Z.centerZ, dt, vizinhos);
      this.state = "walk";
      return null;
    }

    const d = Math.hypot(alvo.x - this.x, alvo.z - this.z);

    if (d <= this.attackRadius) {
      this.state = "attack";
      this.applySeparation(dt, vizinhos);
      this.faceToward(alvo.x, alvo.z);
      if (agora - this.lastAttack < Z.attackInterval * 1000) return null;
      this.lastAttack = agora;
      return alvo.id;
    }

    this.state = "walk";
    this.walkToward(alvo.x, alvo.z, dt, vizinhos);
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

  walkToward(tx, tz, dt, vizinhos = []) {
    let sx = tx - this.x;
    let sz = tz - this.z;
    const len = Math.hypot(sx, sz);
    if (len > 1e-4) {
      sx /= len;
      sz /= len;
    }

    const separacao = this.separationForce(vizinhos);
    sx += separacao.x;
    sz += separacao.z;

    this.yaw = Math.atan2(sx, sz);
    for (const desvio of DEFLECTIONS) {
      const ang = this.yaw + desvio;
      if (this.step(Math.sin(ang), Math.cos(ang), dt)) {
        this.yaw = ang;
        return true;
      }
    }
    return false;
  }

  separationForce(vizinhos = []) {
    const Z = CONFIG.modes.zombie;
    const radius = Z.npcSeparationRadius ?? 0.9;
    const weight = Z.npcSeparationWeight ?? 1.35;
    const radiusSq = radius * radius;
    let sx = 0;
    let sz = 0;

    /* A separação fica no servidor para ser igual em todas as telas. Sem ela,
       desligar zumbi–zumbi no Rapier economizaria CPU, mas a horda poderia
       atravessar o próprio centro e formar uma pilha visual. */
    for (const outro of vizinhos) {
      if (outro === this || outro.dead || outro.kind === "boss") continue;
      const dx = this.x - outro.x;
      const dz = this.z - outro.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radiusSq) continue;

      if (d2 < 1e-6) {
        const sinal = this.id < outro.id ? -1 : 1;
        sx += sinal * weight;
        sz += (this.id % 2 ? 1 : -1) * weight * 0.35;
        continue;
      }

      const d = Math.sqrt(d2);
      const força = ((radius - d) / radius) * weight;
      sx += (dx / d) * força;
      sz += (dz / d) * força;
    }
    return { x: sx, z: sz };
  }

  applySeparation(dt, vizinhos = []) {
    const força = this.separationForce(vizinhos);
    const len = Math.hypot(força.x, força.z);
    if (len < 1e-4) return;
    this.yaw = Math.atan2(força.x, força.z);
    this.step(força.x / len, força.z / len, dt);
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

/** Chefão da horda 9: tanque com vida escalada; cabeça = 2× dano. */
export class BossZombie extends Zombie {
  constructor(terrain, x, z, playerCount) {
    const B = CONFIG.modes.zombie.boss;
    super(terrain, x, z, B.speed, 0.06);
    this.kind = "boss";
    this.maxHealth = B.arrowsToKillPerPlayer * Math.max(1, playerCount | 0);
    this.health = this.maxHealth;
    this.attackRadius = B.attackRadius ?? 6.6;
  }

  hit(head) {
    if (this.dead) return { morreu: false, head: false };
    const B = CONFIG.modes.zombie.boss;
    const dmg = head ? B.headDamage : B.bodyDamage;
    this.health -= dmg;
    if (this.health <= 0) {
      if (head) this.burning = true;
      return { morreu: true, head: !!head };
    }
    return { morreu: false, head: !!head };
  }

  hitWithSpeed(head, _speed = 0) {
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

    const base = tuning.wolfSpeed ?? Z.wolfSpeed;
    this.baseSpeed = base * (1 + (Math.random() * 2 - 1) * (Z.wolfSpeedVariation ?? 0.08));
    this.speed = this.baseSpeed;
    this.leapSpeed = tuning.wolfLeapSpeed ?? Z.wolfLeapSpeed ?? 11;
    this._aiConfig = AI;
    this.lockedTargetId = null;

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

  _attackReach() {
    return CONFIG.modes.zombie.wolfAttackRadius ?? 1.0;
  }

  _leapHitReach() {
    return CONFIG.modes.zombie.wolfLeapHitRadius ?? this._attackReach() * 1.2;
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
    const reach = this._attackReach();
    const leapRange = Z.wolfLeapRange ?? 5;

    if (d <= reach) {
      this.state = "attack";
      this.y = this.baseY;
      this.vel = Math.max(0, this.vel - (this._ai().brake ?? 11) * dt);
      this.applySeparation(dt, vizinhos);
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

  applySeparation(dt, vizinhos = []) {
    const AI = this._ai();
    const sepRadius = AI.separationRadius ?? 1.8;
    let sx = 0;
    let sz = 0;

    for (const outro of vizinhos) {
      if (outro === this || outro.dead) continue;
      const ox = this.x - outro.x;
      const oz = this.z - outro.z;
      const od = Math.hypot(ox, oz);
      if (od >= sepRadius) continue;
      if (od < 1e-4) {
        const sinal = this.id < outro.id ? -1 : 1;
        sx += sinal;
        sz += this.id % 2 ? 0.35 : -0.35;
        continue;
      }
      const peso = (sepRadius - od) / sepRadius;
      sx += (ox / od) * peso * 1.4;
      sz += (oz / od) * peso * 1.4;
    }

    const len = Math.hypot(sx, sz);
    if (len < 1e-4) return;

    const velocidadeParaEmpurrar = Math.max(this.vel, this.baseSpeed * 0.45);
    const desired = Math.atan2(sx, sz);
    /* No estado de ataque a velocidade normal já foi freada. Se o solver
       também estiver desligado para NPCs, uma separação limitada pelo turn
       rate demoraria vários segundos para desfazer uma sobreposição. */
    this.heading = desired;
    this.vel = velocidadeParaEmpurrar;
    if (!this.step(Math.sin(this.heading), Math.cos(this.heading), dt)) {
      this.vel = Math.max(0, this.vel - (AI.brake ?? 11) * dt);
    }
    this.yaw = this.heading;
  }

  beginLeap(alvo) {
    const dx = alvo.x - this.x;
    const dz = alvo.z - this.z;
    const len = Math.hypot(dx, dz) || 1;
    this.leapFx = dx / len;
    this.leapFz = dz / len;
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
    const passo = leapSpeed * dt;
    const nx = this.x + this.leapFx * passo;
    const nz = this.z + this.leapFz * passo;
    if (this.terrain.isWalkable(nx, nz) && this.terrain.arenaDistance(nx, nz) <= 10) {
      this.x = nx;
      this.z = nz;
    }
    this.baseY = this.terrain.heightAt(this.x, this.z);
    this.y = this.baseY + Math.sin(t * Math.PI) * (Z.wolfLeapHeight ?? 1.2);
    this.heading = Math.atan2(this.leapFx, this.leapFz);
    this.yaw = this.heading;
    this.vel = leapSpeed;

    const alvoNoAr = this.pickTarget(jogadores);
    if (
      alvoNoAr &&
      Math.hypot(alvoNoAr.x - this.x, alvoNoAr.z - this.z) <= this._leapHitReach()
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
    if (d <= this._leapHitReach()) return alvo.id;
    this.state = "walk";
    return null;
  }

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
      const ordenados = [...vivos].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const slot = this.id % 2;
      const preferido = ordenados[slot];
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
    /** @type {(Zombie|Wolf|BossZombie)[]} */
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
    this.playerCount = 1;
    /** @type {{ timer: number, i: number; total: number; isWolf: boolean; isBoss?: boolean; bossWolf?: boolean; bossId?: number }[]} */
    this.pendingSpawns = [];
    /** Ondas de lobos do chefão já disparadas (0 = spawn, 1–3 = limiares de HP). */
    this.bossWolfWavesFired = new Set();
  }

  get vivos() {
    return this.zombies.reduce((n, z) => n + (z.dead ? 0 : 1), 0);
  }

  hordeBaseSize(n) {
    const lista = CONFIG.modes.zombie.hordeSizes;
    return lista[Math.max(0, Math.min(lista.length, n) - 1)] ?? lista[lista.length - 1];
  }

  hordeSize(n) {
    const Z = CONFIG.modes.zombie;
    if (n >= Z.hordes) return 0;
    return Math.ceil(this.hordeBaseSize(n) * Math.max(1, this.playerCount));
  }

  wolfCount(n) {
    const lista = CONFIG.modes.zombie.wolfCounts ?? [];
    const base = lista[Math.max(0, Math.min(lista.length, n) - 1)] ?? 0;
    if (n >= CONFIG.modes.zombie.hordes) return 0;
    return Math.ceil(base * Math.max(1, this.playerCount));
  }

  hordeSpeed(n) {
    const Z = CONFIG.modes.zombie;
    const lista = Z.hordeSpeeds;
    return lista[Math.max(0, Math.min(lista.length, n) - 1)] ?? Z.speed;
  }

  /**
   * Segundos entre dois zumbis ALCANÇAREM o círculo de luz. É este número, e
   * não o tamanho da horda, que decide se ela é jogável (ver o comentário de
   * `hordeArrivalGaps` no config). Encolhe com a sala cheia porque o tamanho
   * da horda já multiplicou por N — sem isso, quatro jogadores esperariam
   * quatro vezes mais pela mesma horda.
   */
  arrivalGap(n) {
    const Z = CONFIG.modes.zombie;
    const lista = Z.hordeArrivalGaps ?? [];
    const base =
      lista[Math.max(0, Math.min(lista.length, n) - 1)] ??
      lista[lista.length - 1] ??
      3;
    const escala = Z.playerGapScale ?? 0.85;
    return base / (1 + escala * Math.max(0, this.playerCount - 1));
  }

  isLateHorde(horde, size) {
    const Z = CONFIG.modes.zombie;
    return horde >= (Z.lateHordeFrom ?? 6) || size >= (Z.lateHordeSizeFrom ?? 16);
  }

  effectiveStagger(size, horde) {
    const Z = CONFIG.modes.zombie;
    let stagger = Z.spawnStagger ?? 0.85;
    if (this.isLateHorde(horde, size)) {
      stagger = Math.min(1.6, stagger * Math.sqrt(size / 12));
    }
    return stagger;
  }

  /** Índice espacial barato para separar apenas vizinhos próximos. */
  buildNpcGrid() {
    const grid = new Map();
    for (const bicho of this.zombies) {
      if (bicho.dead) continue;
      const cx = Math.floor(bicho.x / NPC_GRID_CELL);
      const cz = Math.floor(bicho.z / NPC_GRID_CELL);
      const key = `${cx}:${cz}`;
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(bicho);
    }
    return grid;
  }

  /** Retorna no máximo os 9 quadrados ao redor do NPC. */
  nearbyNpcs(bicho, grid) {
    const cx = Math.floor(bicho.x / NPC_GRID_CELL);
    const cz = Math.floor(bicho.z / NPC_GRID_CELL);
    const vizinhos = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = grid.get(`${cx + dx}:${cz + dz}`);
        if (!bucket) continue;
        for (const outro of bucket) {
          if (outro !== bicho) vizinhos.push(outro);
        }
      }
    }
    return vizinhos;
  }

  start(nPlayers = 1) {
    this.playerCount = Math.max(1, nPlayers | 0);
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
    this.bossWolfWavesFired = new Set();
    return this.nextHorde();
  }

  startBossOnly(nPlayers = 1) {
    this.playerCount = Math.max(1, nPlayers | 0);
    this.active = true;
    this.over = false;
    this.overReason = null;
    this.zombies = [];
    this.horde = CONFIG.modes.zombie.hordes - 1;
    this.hordeTimer = 0;
    this.pendingWolves = 0;
    this.plannedWolves = 0;
    this.zombiesKilledInHorde = 0;
    this.pendingSpawns = [];
    this.spawnPhase = Math.random() * Math.PI * 2;
    this.bossWolfWavesFired = new Set();
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
    this.bossWolfWavesFired = new Set();
    this.over = false;
    this.overReason = null;
  }

  nextHorde() {
    const Z = CONFIG.modes.zombie;
    if (this.horde >= Z.hordes) return null;
    this.horde++;

    if (this.horde >= Z.hordes) {
      return this.queueBossHorde();
    }

    const size = this.hordeSize(this.horde);
    const wolves = this.wolfCount(this.horde);
    this.spawnPhase += 0.7 + Math.random() * 1.4;
    this.pendingWolves = wolves;
    this.plannedWolves = wolves;
    this.zombiesKilledInHorde = 0;
    this.pendingSpawns = [];

    const stagger = this.effectiveStagger(size, this.horde);
    const paced = this.horde >= (Z.arrivalPacingFrom ?? 3);
    const gap = this.arrivalGap(this.horde);
    const walkSpeed = this.hordeSpeed(this.horde);
    /* Viagem do raio MÉDIO: é o zero do relógio de chegada. Descontar a viagem
       real contra esta referência é o que faz um zumbi sorteado longe nascer
       antes e um sorteado perto nascer depois, de modo que os dois cheguem no
       intervalo pedido apesar dos ~15 s que separam as duas caminhadas. */
    const rRef =
      ((Z.spawnRadiusMin ?? 28) +
        (this.isLateHorde(this.horde, size)
          ? (Z.spawnRadiusMaxLate ?? 58)
          : (Z.spawnRadiusMax ?? 50))) /
      2;
    const travelRef = this.travelTime(rRef, walkSpeed);
    const varFrac = this.isLateHorde(this.horde, size)
      ? (Z.speedVariationLate ?? 0.28)
      : Z.speedVariation;

    for (let i = 0; i < size; i++) {
      const radius = this.spawnRadiusFor(i, size, false);
      /* A velocidade é sorteada AQUI, e não no construtor do zumbi, porque ela
         entra na conta da viagem. Deixá-la para o nascimento devolveria ±28 %
         sobre uma caminhada de ~17 s — quase 5 s de dispersão contra um
         intervalo alvo de 2,7 s, ou seja, o bastante para reembaralhar a fila
         que este agendamento acabou de montar. */
      const speed = walkSpeed * (1 + (Math.random() * 2 - 1) * varFrac);
      let timer;
      if (paced) {
        const chegada = i * gap + (Math.random() - 0.5) * gap * 0.25;
        /* O piso em zero só morde nos primeiros: ninguém pode nascer antes do
           início da horda, então um bicho sorteado no raio máximo logo no
           começo chega um pouco atrasado. É o trecho fácil da horda, e o preço
           é menor que o de encurtar o raio e entregar sempre a mesma silhueta. */
        timer = Math.max(0, chegada - (this.travelTime(radius, speed) - travelRef));
      } else {
        timer = i * stagger + Math.random() * stagger * 0.35;
      }
      this.pendingSpawns.push({ timer, i, total: size, isWolf: false, radius, speed });
    }

    return { n: this.horde, size: size + wolves };
  }

  queueBossHorde() {
    this.pendingWolves = 0;
    this.plannedWolves = 0;
    this.zombiesKilledInHorde = 0;
    this.bossWolfWavesFired = new Set();
    this.pendingSpawns = [{ timer: 0.5, i: 0, total: 1, isWolf: false, isBoss: true }];
    return { n: this.horde, size: 1, boss: true };
  }

  /** Tamanho da matilha de escolta do chefão (escala com jogadores, com teto). */
  bossWolfPackSize() {
    const W = CONFIG.modes.zombie.boss?.wolves ?? {};
    const base = W.packBase ?? 2;
    const extra = (W.packPerPlayer ?? 1) * Math.max(0, this.playerCount - 1);
    return Math.min(W.packMax ?? 4, base + extra);
  }

  /** Enfileira uma onda de lobos no corredor do chefão. */
  queueBossWolfWave(boss, waveIndex) {
    if (!boss || boss.dead || boss.kind !== "boss") return;
    if (this.bossWolfWavesFired.has(waveIndex)) return;
    const W = CONFIG.modes.zombie.boss?.wolves ?? {};
    const total = this.bossWolfPackSize();
    /* Matilha maior → gap um pouco maior entre nascimentos. */
    const stagger = (W.stagger ?? 1.4) * Math.max(1, Math.sqrt(total / 4));
    for (let i = 0; i < total; i++) {
      this.pendingSpawns.push({
        timer: i * stagger + Math.random() * stagger * 0.35,
        i,
        total,
        bossWolf: true,
        bossId: boss.id,
      });
    }
    this.bossWolfWavesFired.add(waveIndex);
  }

  /** Lobos do chefão: nascem atrás/lateral no eixo boss → centro (não na arena). */
  spawnBossWolfNear(boss, i, total) {
    const Z = CONFIG.modes.zombie;
    const W = Z.boss?.wolves ?? {};
    const dx = Z.centerX - boss.x;
    const dz = Z.centerZ - boss.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    const px = -fz;
    const pz = fx;
    const offMin = W.spawnOffsetMin ?? 8;
    const offMax = W.spawnOffsetMax ?? 36;
    const lateralBase = W.spawnLateral ?? 8;
    const lado = i % 2 === 0 ? 1 : -1;
    const faixa = 1 + Math.floor(i / 2) * 0.4;
    /* Índice alto = mais longe do centro → chegam em fileira, não em bloco. */
    const t = total > 1 ? i / (total - 1) : 0.5;
    const depthBias = offMin + (offMax - offMin) * (0.12 + 0.88 * t);

    for (let tentativa = 0; tentativa < 6; tentativa++) {
      const shrink = 1 - tentativa * 0.14;
      const jitter = (Math.random() - 0.5) * (offMax - offMin) * 0.18;
      const offsetBack = Math.max(offMin, depthBias + jitter) * shrink;
      const lateral = lateralBase * faixa * shrink * lado;
      const x = boss.x - fx * offsetBack + px * lateral;
      const z = boss.z - fz * offsetBack + pz * lateral;
      if (!this.terrain.isWalkable(x, z) || this.terrain.arenaDistance(x, z) > 5) {
        continue;
      }
      const lobo = new Wolf(this.terrain, x, z);
      lobo.faceToward(Z.centerX, Z.centerZ);
      this.zombies.push(lobo);
      return lobo;
    }
    return null;
  }

  /** Ondas 1–3: disparam por fração de vida do chefão (independente de lobos vivos). */
  tickBossWolfWaves() {
    const boss = this.zombies.find((z) => z.kind === "boss" && !z.dead);
    if (!boss || boss.maxHealth <= 0) return;
    const W = CONFIG.modes.zombie.boss?.wolves;
    if (!W) return;
    const thresholds = W.healthThresholds ?? [0.75, 0.5, 0.25];
    const frac = boss.health / boss.maxHealth;
    for (let wi = 0; wi < thresholds.length; wi++) {
      const waveIndex = wi + 1;
      if (this.bossWolfWavesFired.has(waveIndex)) continue;
      if (frac <= thresholds[wi]) {
        this.queueBossWolfWave(boss, waveIndex);
      }
    }
  }

  /**
   * Raio de nascimento: alterna perto/longe só para o breu não entregar sempre
   * a mesma distância de silhueta.
   *
   * Ele NÃO tem mais papel no ritmo. Existia aqui um ramo que tentava derivar
   * o raio de um "ETA ao centro" (`walkSpeed × i × gap`) para espaçar as
   * chegadas — mas esquecia de somar o raio base, e como o produto só passa de
   * 28 m lá pelo 21º zumbi, o `clamp` devolvia `rMin` para a horda inteira: os
   * bichos nasciam todos à mesma distância e chegavam em bloco, exatamente o
   * oposto do pretendido. O espaçamento agora é feito no relógio, por
   * `nextHorde`, que desconta esta viagem em vez de tentar codificá-la aqui.
   */
  spawnRadiusFor(i, total, isWolf) {
    const Z = CONFIG.modes.zombie;
    const rMin = Z.spawnRadiusMin ?? Z.spawnRadius - (Z.spawnJitter ?? 5);
    const rMaxDefault = Z.spawnRadiusMax ?? Z.spawnRadius + (Z.spawnJitter ?? 5);
    const rMax = this.isLateHorde(this.horde, total)
      ? (Z.spawnRadiusMaxLate ?? rMaxDefault)
      : rMaxDefault;

    const t = total > 1 ? i / (total - 1) : 0.5;
    const wave = 0.5 + 0.5 * Math.sin(i * 2.17 + this.spawnPhase);
    const base = rMin + (rMax - rMin) * (t * 0.35 + wave * 0.65);
    const jitter = (Math.random() - 0.5) * (Z.spawnJitter ?? 4);
    const bonus = isWolf ? (Z.wolfSpawnRadiusBonus ?? 6) : 0;
    return clamp(base + jitter, rMin, rMax) + bonus;
  }

  /** Segundos que um zumbi desta horda leva do raio `r` até a borda da luz. */
  travelTime(r, walkSpeed) {
    const safe = CONFIG.modes.zombie.safeRadius ?? 16;
    return Math.max(0, r - safe) / Math.max(0.1, walkSpeed);
  }

  tickPendingSpawns(dt) {
    const Z = CONFIG.modes.zombie;
    const maxAlive = Z.maxAlive ?? Infinity;
    const maxEntities = Z.maxEntities ?? Infinity;

    for (let j = this.pendingSpawns.length - 1; j >= 0; j--) {
      const ps = this.pendingSpawns[j];
      ps.timer -= dt;
      if (ps.timer <= 0) {
        /* Cadáveres ainda estão no array e ainda são desenhados pelo cliente.
           Contar o array inteiro evita trocar uma horda de 48 vivos por
           centenas de vivos + mortos acumulados. */
        if (
          this.zombies.length >= maxEntities ||
          (!ps.isBoss && this.vivos >= maxAlive)
        ) {
          /* Segura o relógio no zero em vez de deixá-lo afundar. Acumulando
             dívida negativa, uma fila represada pelo teto de vivos nasceria
             INTEIRA no quadro em que a primeira vaga abrisse — e é o teto que
             manda numa sala cheia, justamente onde o paredão dói mais. Preso em
             zero, ele drena no ritmo em que os zumbis morrem: uma vaga, um
             nascimento. */
          ps.timer = 0;
          continue;
        }
        if (ps.bossWolf) {
          const boss = ps.bossId != null ? this.byId(ps.bossId) : null;
          if (boss && !boss.dead) {
            this.spawnBossWolfNear(boss, ps.i, ps.total);
          }
        } else {
          this.spawnAt(
            ps.i,
            ps.total,
            ps.isWolf,
            ps.isBoss === true,
            ps.radius,
            ps.speed,
          );
        }
        this.pendingSpawns.splice(j, 1);
      }
    }
  }

  /**
   * @param {number|null} radius — raio já sorteado no enfileiramento.
   * @param {number|null} speed — velocidade já sorteada no enfileiramento.
   *
   * Os dois precisam vir de lá, e não ser sorteados aqui: é deles que saiu o
   * instante de nascimento (ver `nextHorde`), e re-sortear qualquer um
   * desfaria o espaçamento das chegadas.
   */
  spawnAt(i, total, isWolf = false, isBoss = false, radius = null, speed = null) {
    const Z = CONFIG.modes.zombie;
    const B = Z.boss ?? {};
    const setor = (Math.PI * 2) / Math.max(1, total);
    const faseExtra = isWolf ? setor * 0.5 + 0.35 : 0;
    let ang =
      this.spawnPhase + faseExtra + i * setor + (Math.random() - 0.5) * setor * 0.7;

    const hordeSpd = isBoss ? (B.speed ?? 0.9) : this.hordeSpeed(this.horde);
    /* Chefão: fundo do vale (−Z a partir do círculo de tochas). O ângulo
       aleatório da horda o empurrava pra lateral da bacia (~30 m) e ele
       nascia perto demais — a vida de 20 flechas pedia bem mais pista. */
    let raio = isBoss
      ? (B.spawnRadius ??
        Math.max(100, (B.speed ?? 0.9) * (B.arrowsToKillPerPlayer ?? 40) * 7))
      : (radius ?? this.spawnRadiusFor(i, total, isWolf));
    if (isBoss) {
      ang = Math.PI + (Math.random() - 0.5) * 0.55;
    }

    let x = 0;
    let z = 0;
    let achou = false;
    const raioMin = isBoss ? Math.max(70, raio * 0.55) : 14;
    for (let r = raio; r > raioMin; r -= 2) {
      x = Z.centerX + Math.sin(ang) * r;
      z = Z.centerZ + Math.cos(ang) * r;
      if (this.terrain.isWalkable(x, z) && this.terrain.arenaDistance(x, z) <= 5) {
        achou = true;
        break;
      }
    }
    if (!achou) return null;

    let bicho;
    if (isBoss) {
      bicho = new BossZombie(this.terrain, x, z, this.playerCount);
    } else if (isWolf) {
      bicho = new Wolf(this.terrain, x, z);
    } else {
      const late = this.isLateHorde(this.horde, total);
      const varFrac = late ? (Z.speedVariationLate ?? 0.28) : Z.speedVariation;
      /* Velocidade já sorteada ⇒ variação zero, senão ela seria aplicada duas
         vezes e a viagem deixaria de bater com o horário que agendou este
         nascimento. Sem ela (lobos, chamadas avulsas) o sorteio é aqui. */
      bicho =
        speed != null
          ? new Zombie(this.terrain, x, z, speed, 0)
          : new Zombie(this.terrain, x, z, hordeSpd, varFrac);
    }
    bicho.faceToward(Z.centerX, Z.centerZ);
    this.zombies.push(bicho);
    if (isBoss) {
      this.queueBossWolfWave(bicho, 0);
    }
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

    if (zumbi.kind !== "wolf" && zumbi.kind !== "boss") {
      this.zombiesKilledInHorde++;
      this.trySpawnPendingWolf();
    }
    return zumbi;
  }

  trySpawnPendingWolf() {
    if (this.pendingWolves <= 0) return;
    const aCada = CONFIG.modes.zombie.wolfEveryZombieKills ?? 3;
    const zumbisVivos = this.zombies.reduce(
      (n, z) => n + (!z.dead && z.kind === "zombie" ? 1 : 0),
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
    this.tickBossWolfWaves();

    const npcGrid = this.buildNpcGrid();

    for (const zumbi of this.zombies) {
      if (zumbi.dead) continue;
      const vizinhos = this.nearbyNpcs(zumbi, npcGrid);
      const alvo = zumbi.update(dt, jogadores, agora, vizinhos);
      if (alvo != null) ataques.push({ zombieId: zumbi.id, playerId: alvo });
    }

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

    if (
      this.active &&
      !this.over &&
      this.vivos === 0 &&
      this.pendingWolves === 0 &&
      this.pendingSpawns.length === 0
    ) {
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
    return this.zombies.map((z) => {
      const row = {
        id: z.id,
        p: [round(z.x), round(z.y), round(z.z)],
        y: round(z.yaw),
        s: z.state,
        b: z.burning ? 1 : 0,
        d: z.dead ? 1 : 0,
        k:
          z.kind === "boss" ? "b" : z.kind === "wolf" ? "w" : "z",
      };
      if (z.kind === "boss" && z.maxHealth > 0) {
        row.hp = round(z.health / z.maxHealth);
      }
      return row;
    });
  }
}

function round(v) {
  return Math.round(v * 100) / 100;
}
