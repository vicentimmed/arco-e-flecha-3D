/* ---------------------------------------------------------------------------
   O alce, no servidor.

   CHEFÃO: mira com lead, reinveste após miss, desvia flechas às vezes, e a
   vida escala com o número de jogadores (20 flechas × N).
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { pickElkSpawn } from "./spawnPoints.js";

let proximoId = 1;

const STEER_ANGLES = [
  0, 0.28, -0.28, 0.55, -0.55, 0.9, -0.9, 1.35, -1.35, 1.9, -1.9, Math.PI,
];

function calcMaxHealth(nPlayers, fun) {
  const E = CONFIG.elk;
  const n = fun ? 1 : Math.max(1, nPlayers | 0);
  return E.arrowDamage * E.arrowsToKillPerPlayer * n;
}

export class Elk {
  constructor(terrain, x, z, fun = false, nPlayers = 1) {
    this.id = proximoId++;
    this.fun = fun;
    this.terrain = terrain;
    this.x = x;
    this.z = z;
    this.y = terrain.heightAt(x, z);
    this.baseY = this.y;
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.state = "graze";
    this.stateTimer = 0;
    this.maxHealth = calcMaxHealth(nPlayers, fun);
    this.health = this.maxHealth;
    this.hits = 0;
    this.dead = false;
    this.deadSince = 0;
    this.targetId = null;
    this.lastTargetDist = Infinity;
    this.awayTicks = 0;
    this.stuckTime = 0;
    this.lastX = x;
    this.lastZ = z;
    this.dodgeCooldownUntil = 0;
    this.dodgeFx = 0;
    this.dodgeFz = 0;
    this.pendingRecharge = false;
    /* Trava da investida: dentro de `commitDistance` o rumo congela e o bicho
       vira um projétil. `commitRun` mede quanto ele já correu travado, e é o
       que decide quando o embalo acaba. */
    this.committed = false;
    this.commitRun = 0;
    /** Flechas levadas DESTA investida — duas e ele desiste. */
    this.chargeHits = 0;
    /** s de coragem em falta: enquanto > 0 ele não investe. */
    this.spooked = 0;
    /** @type {Map<number, {x:number,z:number,vx:number,vz:number}>} */
    this.playerMotion = new Map();
    this.aimX = x;
    this.aimZ = z;
    this.pickWanderTarget();
  }

  pickWanderTarget() {
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = 8 + Math.random() * 20;
      const tx = this.x + Math.cos(ang) * d;
      const tz = this.z + Math.sin(ang) * d;
      if (this.isClear(tx, tz)) {
        this.targetX = tx;
        this.targetZ = tz;
        return;
      }
    }
    this.targetX = this.x * 0.4;
    this.targetZ = this.z * 0.4;
  }

  hit(atiradorId, atiradorPos, jogadores = []) {
    if (this.dead) return null;
    const E = CONFIG.elk;
    this.hits++;
    this.health = Math.max(0, this.health - E.arrowDamage);

    if (this.health <= 0) return { morreu: true };

    /* ACERTAR QUEM VEM EM CIMA.
       A primeira flecha durante a investida não muda nada — o bicho está
       comprometido e a dor não vence a inércia. A segunda quebra: ele gira,
       foge e passa uns segundos sem coragem de voltar. Isso dá ao modo uma
       saída que não é correr, e recompensa quem consegue mirar com meia
       tonelada de alce crescendo na tela. */
    if (this.state === "charge") {
      this.chargeHits++;
      if (this.chargeHits >= (E.chargeBreakHits ?? 2)) {
        this.spooked = E.scaredRecoverTime ?? 4.5;
        this.targetId = null;
        this.startFlee(atiradorPos);
        return { morreu: false, investiu: false, assustou: true };
      }
      return { morreu: false, investiu: true };
    }

    // Assustado ainda: a flecha dói, mas não faz ele virar para trás.
    if (this.spooked > 0) {
      if (atiradorPos) this.fleeFrom = { x: atiradorPos.x, z: atiradorPos.z };
      this.state = "flee";
      this.stateTimer = 0;
      return { morreu: false, investiu: false };
    }

    this.stateTimer = 0;
    const chance = Math.min(0.95, E.chargeChance + E.chargeChancePerHit * this.hits);
    if (Math.random() < chance) {
      const alvo = this.pickChargeTarget(jogadores, atiradorId, atiradorPos);
      this.beginCharge(alvo?.id ?? atiradorId, alvo ?? atiradorPos);
      return { morreu: false, investiu: true };
    }

    this.state = "flee";
    this.fleeFrom = atiradorPos ? { x: atiradorPos.x, z: atiradorPos.z } : null;
    this.pendingRecharge = false;
    return { morreu: false, investiu: false };
  }

  beginCharge(targetId, pos) {
    this.targetId = targetId;
    this.state = "charge";
    this.stateTimer = 0;
    this.awayTicks = 0;
    this.lastTargetDist = Infinity;
    this.stuckTime = 0;
    this.pendingRecharge = false;
    this.committed = false;
    this.commitRun = 0;
    this.chargeHits = 0;
    if (pos) this.faceToward(pos.x, pos.z);
  }

  pickChargeTarget(jogadores, atiradorId, atiradorPos) {
    const E = CONFIG.elk;
    const candidatos = jogadores.filter(
      (p) => p.alive !== false && this.distanceTo(p) < E.visionRange,
    );
    if (!candidatos.length) {
      return atiradorPos ? { id: atiradorId, ...atiradorPos } : null;
    }

    candidatos.sort((a, b) => this.distanceTo(a) - this.distanceTo(b));
    const preferido =
      candidatos.find((p) => p.id === atiradorId) ?? candidatos[0];
    if (candidatos.length === 1 || Math.random() < E.nearestBias) return preferido;

    const outros = candidatos.filter((p) => p !== preferido);
    return outros[Math.floor(Math.random() * outros.length)];
  }

  get chargeSpeed() {
    const E = CONFIG.elk;
    return Math.min(E.chargeSpeedMax, E.chargeSpeed + E.chargeSpeedPerHit * this.hits);
  }

  get currentLeadTime() {
    const E = CONFIG.elk;
    return E.leadTime + E.leadTimePerHit * this.hits;
  }

  faceToward(x, z) {
    const dx = x - this.x;
    const dz = z - this.z;
    if (Math.hypot(dx, dz) < 1e-4) return;
    this.yaw = Math.atan2(dx, dz);
  }

  /** Atualiza estimativa de velocidade dos jogadores (tick ~10 Hz). */
  samplePlayerMotion(jogadores, dt) {
    const inv = 1 / Math.max(dt, 0.05);
    for (const p of jogadores) {
      const prev = this.playerMotion.get(p.id);
      if (prev) {
        this.playerMotion.set(p.id, {
          x: p.x,
          z: p.z,
          vx: (p.x - prev.x) * inv,
          vz: (p.z - prev.z) * inv,
        });
      } else {
        this.playerMotion.set(p.id, { x: p.x, z: p.z, vx: 0, vz: 0 });
      }
    }
  }

  leadPoint(alvo) {
    const m = this.playerMotion.get(alvo.id);
    const lead = this.currentLeadTime;
    if (!m) return { x: alvo.x, z: alvo.z };
    return {
      x: alvo.x + m.vx * lead,
      z: alvo.z + m.vz * lead,
    };
  }

  update(dt, jogadores, agora = 0) {
    if (this.dead) return null;
    const E = CONFIG.elk;
    this.stateTimer += dt;
    this.spooked = Math.max(0, this.spooked - dt);
    this.samplePlayerMotion(jogadores, dt);

    const alvo = this.pickTarget(jogadores);
    const perto = alvo ? this.distanceTo(alvo) : Infinity;

    // Altura base do terreno; o dodge sobe o Y temporariamente.
    this.baseY = this.terrain.heightAt(this.x, this.z);
    if (this.state !== "dodge") this.y = this.baseY;

    switch (this.state) {
      case "graze": {
        this.speed = E.walkSpeed;
        this.moveToward(this.targetX, this.targetZ, dt);
        if (perto < E.fleeRange) this.startFlee(alvo);
        else if (perto < E.alertRange) {
          this.enterAlert(alvo);
        } else if (this.stateTimer > 7) {
          this.stateTimer = 0;
          this.pickWanderTarget();
        }
        break;
      }

      case "alert": {
        this.speed = 0;
        if (!alvo) {
          this.state = "graze";
          this.stateTimer = 0;
          break;
        }
        this.targetId = alvo.id;
        this.faceToward(alvo.x, alvo.z);
        const aproximou =
          this.alertDist != null && this.alertDist - perto > E.alertApproach;
        const andou =
          this.alertPlayerX != null &&
          Math.hypot(alvo.x - this.alertPlayerX, alvo.z - this.alertPlayerZ) >
            E.alertMoveDist;
        if (perto < E.fleeRange || aproximou || andou) this.startFlee(alvo);
        else if (perto > E.alertRange || this.stateTimer > E.alertDuration) {
          this.state = "graze";
          this.stateTimer = 0;
          this.pickWanderTarget();
        }
        break;
      }

      case "flee": {
        this.speed = E.fleeSpeed;
        const de = this.fleeFrom ?? alvo;
        if (de) {
          const dx = this.x - de.x;
          const dz = this.z - de.z;
          const len = Math.hypot(dx, dz) || 1;
          let fx = dx / len;
          let fz = dz / len;
          // Perto da borda: NÃO mistura com "para o centro" (vetores opostos
          // cancelam e o yaw inverte ~180° a cada tick — alce gira no lugar
          // na subida da trilha). Em vez disso, corta a componente que sobe
          // o SDF da arena.
          const corr = this.deflectFromArenaEdge(fx, fz);
          fx = corr.fx;
          fz = corr.fz;
          this.steerToward(Math.atan2(fx, fz), 4.5 * dt);
        }
        this.stepForward(dt);

        // Ferido: fuga curta e volta a caçar — desde que a coragem já tenha
        // voltado (levar duas flechas na investida custa alguns segundos).
        if (
          this.hits >= E.woundedHuntMinHits &&
          alvo &&
          this.spooked <= 0 &&
          perto < E.visionRange &&
          this.stateTimer > E.woundedFleeTime
        ) {
          this.beginCharge(alvo.id, alvo);
          break;
        }

        if (perto > E.alertRange && this.stateTimer > E.grazeSettle) {
          this.state = "graze";
          this.stateTimer = 0;
          this.pickWanderTarget();
        } else if (perto < E.fleeRange && alvo) {
          this.fleeFrom = { x: alvo.x, z: alvo.z };
          this.stateTimer = 0;
        }
        break;
      }

      case "charge": {
        this.speed = this.chargeSpeed;
        const perseguido = this.byId(jogadores, this.targetId);
        if (!perseguido) {
          this.endCharge(alvo, false, jogadores);
          break;
        }

        const lead = this.leadPoint(perseguido);
        this.aimX = lead.x;
        this.aimZ = lead.z;
        const d = this.distanceTo(perseguido);

        /* O INSTANTE DA TRAVA.
           Cruzou `commitDistance`: o rumo congela no ponto de lead e acabou a
           perseguição. Daqui até o fim do embalo ele só corre reto — e é essa
           reta que dá ao jogador o mesmo recurso de quem enfrenta um touro:
           esperar o compromisso e sair de lado. */
        if (!this.committed && d <= E.commitDistance) {
          this.committed = true;
          this.commitRun = 0;
          this.yaw = Math.atan2(lead.x - this.x, lead.z - this.z);
        }

        if (this.committed) {
          const antesX = this.x;
          const antesZ = this.z;
          // Sem `lead`: `stepForward` só desvia de pedra e barranco, não persegue.
          this.stepForward(dt);
          this.commitRun += Math.hypot(this.x - antesX, this.z - antesZ);
        } else {
          const desejado = Math.atan2(lead.x - this.x, lead.z - this.z);
          this.steerToward(desejado, E.turnRate * dt);
          this.stepForward(dt, lead);
        }

        /* A galhada continua matando durante toda a passagem, inclusive na
           sobra de embalo. Sair da frente é a esquiva; voltar para a frente é
           o mesmo erro de antes. */
        if (d < (E.goreRadius ?? 1.5)) {
          this.endCharge(perseguido, true, jogadores);
          return perseguido.id;
        }

        if (this.committed) {
          const total = E.commitDistance + (E.overshootDistance ?? 14);
          if (this.commitRun >= total || this.stateTimer > E.chargeDuration) {
            // Passou direto. Perde o fôlego e foge — a esquiva foi paga.
            this.spooked = Math.max(this.spooked, E.missRecoverTime ?? 2.0);
            this.targetId = null;
            this.startFlee(perseguido);
          }
          break;
        }

        if (d > this.lastTargetDist) this.awayTicks++;
        else this.awayTicks = 0;
        this.lastTargetDist = d;

        if (this.awayTicks >= E.giveUpTicks || this.stateTimer > E.chargeDuration) {
          this.endCharge(perseguido, false, jogadores);
        }
        break;
      }

      case "recover": {
        this.speed = 0;
        if (this.stateTimer < E.chargeCooldown) break;
        if (this.pendingRecharge && alvo && this.spooked <= 0) {
          this.beginCharge(alvo.id, alvo);
        } else {
          this.startFlee(alvo);
        }
        break;
      }

      case "dodge": {
        this.speed = E.dodgeSpeed;
        const t = Math.min(1, this.stateTimer / E.dodgeDuration);
        // Arco de pulo: sobe e desce.
        this.y = this.baseY + Math.sin(t * Math.PI) * E.dodgeJumpHeight;
        this.step(this.dodgeFx, this.dodgeFz, dt);
        if (this.stateTimer >= E.dodgeDuration) {
          this.y = this.terrain.heightAt(this.x, this.z);
          if (this.hits >= E.woundedHuntMinHits && alvo && this.spooked <= 0) {
            this.beginCharge(alvo.id, alvo);
          } else {
            this.startFlee(alvo);
          }
        }
        break;
      }
    }

    this.trackStuck(dt);
    return null;
  }

  /**
   * Avalia se uma flecha ameaça o alce e, às vezes, entra em dodge.
   * @param {number[]} o origem [x,y,z]
   * @param {number[]} d direção [x,y,z]
   * @param {number} v velocidade
   * @param {number} agora ms
   */
  maybeDodgeShot(o, d, v, agora) {
    if (this.dead || this.state === "dodge" || this.state === "dead") return false;
    // Travado na investida ele não desvia de nada: o compromisso é total, e é
    // justamente isso que dá ao jogador uma janela limpa para acertar.
    if (this.committed && this.state === "charge") return false;
    const E = CONFIG.elk;
    if (agora < this.dodgeCooldownUntil) return false;
    if (!o || !d || !(v > 0)) return false;

    // Trajetória em XZ (aprox. sem gravidade — janela curta).
    const ox = o[0];
    const oz = o[2];
    const dx = d[0];
    const dz = d[2];
    const horiz = Math.hypot(dx, dz) || 1e-6;
    const fx = dx / horiz;
    const fz = dz / horiz;
    // Distância do ponto (elk) à reta da flecha.
    const wx = this.x - ox;
    const wz = this.z - oz;
    const proj = wx * fx + wz * fz;
    if (proj < 0) return false; // flecha para trás do alce
    const cx = ox + fx * proj;
    const cz = oz + fz * proj;
    const dist = Math.hypot(this.x - cx, this.z - cz);
    if (dist > E.dodgeRadius) return false;

    const eta = proj / Math.max(v * (horiz / Math.hypot(dx, dz, d[1] || 0)), 1);
    if (eta > E.dodgeLeadTime || eta < 0.05) return false;

    const wound = 1 - this.health / Math.max(1, this.maxHealth);
    const chance = Math.min(
      0.92,
      E.dodgeChance + (E.dodgeChanceAtDeath - E.dodgeChance) * wound,
    );
    if (Math.random() > chance) return false;

    // Lateral perpendicular à flecha, escolhendo o lado com mais espaço.
    const px = -fz;
    const pz = fx;
    const sideA = this.isClear(this.x + px * 4, this.z + pz * 4);
    const sideB = this.isClear(this.x - px * 4, this.z - pz * 4);
    const sign = sideA && !sideB ? 1 : sideB && !sideA ? -1 : Math.random() < 0.5 ? 1 : -1;
    // Mistura lateral + avanço.
    let sx = px * sign * 0.75 + fx * 0.35;
    let sz = pz * sign * 0.75 + fz * 0.35;
    const sl = Math.hypot(sx, sz) || 1;
    this.dodgeFx = sx / sl;
    this.dodgeFz = sz / sl;
    this.yaw = Math.atan2(this.dodgeFx, this.dodgeFz);
    this.state = "dodge";
    this.stateTimer = 0;
    const cooldown =
      E.dodgeCooldown + (E.dodgeCooldownAtDeath - E.dodgeCooldown) * wound;
    this.dodgeCooldownUntil = agora + cooldown * 1000;
    return true;
  }

  enterAlert(alvo) {
    this.state = "alert";
    this.stateTimer = 0;
    this.targetId = alvo.id;
    this.alertPlayerX = alvo.x;
    this.alertPlayerZ = alvo.z;
    this.alertDist = this.distanceTo(alvo);
  }

  scare(x, z) {
    if (this.dead) return;
    if (this.state === "charge" || this.state === "dodge") return;
    this.startFlee({ x, z });
  }

  startFlee(de) {
    this.state = "flee";
    this.stateTimer = 0;
    this.stuckTime = 0;
    this.pendingRecharge = false;
    this.committed = false;
    this.commitRun = 0;
    if (de) this.fleeFrom = { x: de.x, z: de.z };
  }

  endCharge(de, acertou, jogadores = []) {
    const E = CONFIG.elk;
    this.state = "recover";
    this.stateTimer = 0;
    this.awayTicks = 0;
    this.lastTargetDist = Infinity;
    this.targetId = null;
    this.stuckTime = 0;
    this.committed = false;
    this.commitRun = 0;
    if (de) this.fleeFrom = { x: de.x, z: de.z };
    if (acertou) {
      this.pendingRecharge = false;
      this.faceToward(this.x * 2 - (de?.x ?? this.x), this.z * 2 - (de?.z ?? this.z));
    } else {
      this.pendingRecharge =
        this.hits >= E.rechargeOnMissMinHits &&
        Math.random() < E.rechargeOnMissChance &&
        !!this.pickTarget(jogadores);
    }
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

  byId(jogadores, id) {
    if (id == null) return null;
    for (const p of jogadores) if (p.id === id && p.alive !== false) return p;
    return null;
  }

  distanceTo(p) {
    return Math.hypot(p.x - this.x, p.z - this.z);
  }

  turnToward(x, z, maxDelta) {
    this.steerToward(Math.atan2(x - this.x, z - this.z), maxDelta);
  }

  steerToward(querido, maxDelta) {
    let d = querido - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += Math.max(-maxDelta, Math.min(maxDelta, d));
  }

  moveToward(tx, tz, dt) {
    this.steerToward(Math.atan2(tx - this.x, tz - this.z), 2.5 * dt);
    this.stepForward(dt);
    if (Math.hypot(tx - this.x, tz - this.z) < 2.5) this.pickWanderTarget();
  }

  isClear(x, z, minSlope = null) {
    const E = CONFIG.elk;
    if (!this.terrain.isWalkable(x, z)) return false;
    if (this.terrain.arenaDistance(x, z) > E.maxArenaDist) return false;
    const limiar = minSlope ?? E.minSlope;
    if (this.terrain.slopeAt(x, z, 1.0) < limiar) return false;
    return true;
  }

  /**
   * Gradiente de `arenaDistance` (aponta para FORA da bacia).
   * Usado para desviar a fuga da parede invisível sem inverter o yaw.
   */
  arenaOutward(x = this.x, z = this.z, eps = 1.0) {
    const gx =
      this.terrain.arenaDistance(x + eps, z) -
      this.terrain.arenaDistance(x - eps, z);
    const gz =
      this.terrain.arenaDistance(x, z + eps) -
      this.terrain.arenaDistance(x, z - eps);
    const len = Math.hypot(gx, gz) || 1;
    return { x: gx / len, z: gz / len };
  }

  /**
   * Remove a componente do rumo que sobe a borda da arena.
   * Se sobrar quase nada, corre tangente à borda (ou para dentro se já passou).
   */
  deflectFromArenaEdge(fx, fz) {
    const E = CONFIG.elk;
    const ad = this.terrain.arenaDistance(this.x, this.z);
    // Longe da borda: fuga pura.
    if (ad < -6) return { fx, fz };

    const g = this.arenaOutward();
    const outDot = fx * g.x + fz * g.z;
    if (outDot > 0) {
      fx -= g.x * outDot;
      fz -= g.z * outDot;
    }

    let fl = Math.hypot(fx, fz);
    if (fl < 0.25) {
      // Quase cancelado: corre ao longo da borda (tangente).
      fx = -g.z;
      fz = g.x;
      // Escolhe o lado da tangente que ainda afasta do perseguidor, se houver.
      if (this.fleeFrom) {
        const ax = this.x - this.fleeFrom.x;
        const az = this.z - this.fleeFrom.z;
        if (fx * ax + fz * az < 0) {
          fx = -fx;
          fz = -fz;
        }
      }
      fl = 1;
    }

    fx /= fl;
    fz /= fl;

    // Já encostou / passou do limite: puxa para dentro com peso crescente.
    if (ad > -1) {
      const w = Math.min(1, (ad + 1) / (E.maxArenaDist + 1));
      fx = fx * (1 - w) - g.x * w;
      fz = fz * (1 - w) - g.z * w;
      fl = Math.hypot(fx, fz) || 1;
      fx /= fl;
      fz /= fl;
    }
    return { fx, fz };
  }

  /** Slope mínimo vigente: relaxa quando o alce já está preso. */
  currentMinSlope() {
    const E = CONFIG.elk;
    return this.stuckTime >= E.stuckEscapeTime ? E.stuckMinSlope : E.minSlope;
  }

  stepForward(dt, lead = null) {
    const E = CONFIG.elk;
    const passo = Math.max(0.4, this.speed * dt);
    const look = E.lookAhead;
    const minSlope = this.currentMinSlope();
    const ad0 = this.terrain.arenaDistance(this.x, this.z);

    let melhor = null;
    let melhorNota = -Infinity;

    for (const desvio of STEER_ANGLES) {
      const ang = this.yaw + desvio;
      const fx = Math.sin(ang);
      const fz = Math.cos(ang);
      const nx = this.x + fx * passo;
      const nz = this.z + fz * passo;
      if (!this.isClear(nx, nz, minSlope)) continue;
      const lx = this.x + fx * look;
      const lz = this.z + fz * look;
      const lookOk = this.isClear(lx, lz, minSlope);

      const ad = this.terrain.arenaDistance(nx, nz);
      const slope = this.terrain.slopeAt(nx, nz, 1.0);
      let nota = -Math.abs(desvio) * 1.4;
      if (lookOk) nota += 2.5;
      nota -= Math.max(0, ad + 4) * 0.35;
      // Prefere chão mais plano — sai de bolsões no sopé em vez de oscilar.
      nota += (slope - E.minSlope) * 4.0;
      // Perto da borda: premia passos que DESCENDEM o SDF (para dentro).
      if (ad0 > -6) nota += (ad0 - ad) * 3.5;

      // Em charge: premia headings que aproximam do ponto de lead.
      if (lead) {
        const d0 = Math.hypot(lead.x - this.x, lead.z - this.z);
        const d1 = Math.hypot(lead.x - nx, lead.z - nz);
        nota += (d0 - d1) * 1.8;
      }

      if (nota > melhorNota) {
        melhorNota = nota;
        melhor = ang;
      }
    }

    if (melhor == null) {
      this.stuckTime += dt;
      if (this.stuckTime >= E.stuckEscapeTime) this.escapeStuck(dt);
      return false;
    }

    this.yaw = melhor;
    return this.step(Math.sin(melhor), Math.cos(melhor), dt, minSlope);
  }

  /**
   * Procura um passo caminhável e força o deslocamento.
   * Se já estiver fora do maxArenaDist, aceita qualquer passo que reduza `ad`.
   */
  escapeStuck(dt = 1 / 30) {
    const E = CONFIG.elk;
    const passo = Math.max(0.8, this.speed * Math.max(dt, 1 / 30));
    const relax = E.stuckMinSlope;
    const ad0 = this.terrain.arenaDistance(this.x, this.z);
    let melhor = null;
    let melhorNota = -Infinity;

    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const fx = Math.sin(ang);
      const fz = Math.cos(ang);
      const nx = this.x + fx * passo;
      const nz = this.z + fz * passo;
      if (!this.terrain.isWalkable(nx, nz)) continue;
      const ad = this.terrain.arenaDistance(nx, nz);
      const slope = this.terrain.slopeAt(nx, nz, 1.0);
      const dentro = ad <= E.maxArenaDist && slope >= relax;
      // Fora da zona: ainda aceita passo que MELHORE ad (volta para a bacia).
      const resgate = ad0 > E.maxArenaDist && ad < ad0 - 0.05;
      if (!dentro && !resgate) continue;

      let nota = slope * 8 - Math.max(0, ad + 2) * 1.2 + (ad0 - ad) * 6;
      nota -= Math.hypot(nx, nz) * 0.02;
      if (nota > melhorNota) {
        melhorNota = nota;
        melhor = { ang, nx, nz };
      }
    }

    if (melhor) {
      this.yaw = melhor.ang;
      this.x = melhor.nx;
      this.z = melhor.nz;
      if (this.state !== "dodge") this.y = this.terrain.heightAt(melhor.nx, melhor.nz);
      this.stuckTime = 0;
    } else {
      // Último recurso: um passo na direção do gradiente para dentro.
      const g = this.arenaOutward();
      const nx = this.x - g.x * passo;
      const nz = this.z - g.z * passo;
      this.yaw = Math.atan2(-g.x, -g.z);
      if (this.terrain.isWalkable(nx, nz)) {
        this.x = nx;
        this.z = nz;
        if (this.state !== "dodge") this.y = this.terrain.heightAt(nx, nz);
        this.stuckTime = 0;
      }
    }

    if (this.state === "graze") this.pickWanderTarget();
  }

  trackStuck(dt) {
    const moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
    if (this.speed > 0.5 && moved < this.speed * dt * 0.25) {
      this.stuckTime += dt;
      if (this.stuckTime >= CONFIG.elk.stuckEscapeTime) this.escapeStuck(dt);
    } else if (moved > 0.05) {
      this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
    }
    this.lastX = this.x;
    this.lastZ = this.z;
  }

  step(fx, fz, dt, minSlope = null) {
    const passo = this.speed * dt;
    const nx = this.x + fx * passo;
    const nz = this.z + fz * passo;
    if (!this.isClear(nx, nz, minSlope ?? this.currentMinSlope())) return false;
    this.x = nx;
    this.z = nz;
    if (this.state !== "dodge") this.y = this.terrain.heightAt(nx, nz);
    return true;
  }

  view() {
    return {
      id: this.id,
      p: [r3(this.x), r3(this.y), r3(this.z)],
      y: r3(this.yaw),
      v: r3(this.speed),
      s: this.state,
      h: Math.round((this.health / this.maxHealth) * 100) / 100,
      f: this.fun ? 1 : 0,
    };
  }
}

export class ElkHunt {
  constructor(terrain) {
    this.terrain = terrain;
    /** @type {Elk[]} */
    this.elks = [];
    this.active = false;
    this.over = false;
    this.overReason = null;
  }

  get vivos() {
    return this.elks.reduce((n, e) => n + (e.dead ? 0 : 1), 0);
  }

  get vivosDoModo() {
    return this.elks.reduce((n, e) => n + (!e.dead && !e.fun ? 1 : 0), 0);
  }

  start(jogadores) {
    if (this.active) return;
    this.active = true;
    this.over = false;
    this.overReason = null;
    this.spawnOne(jogadores, false);
  }

  stop() {
    this.active = false;
    this.over = false;
    this.overReason = null;
    this.elks = this.elks.filter((e) => e.fun && !e.dead);
  }

  gameOver(reason) {
    this.over = true;
    this.overReason = reason;
    this.active = false;
  }

  spawnOne(jogadores, fun = false) {
    const ponto = pickElkSpawn(this.terrain, jogadores);
    if (!ponto) return null;
    const n = fun ? 1 : Math.max(1, jogadores?.length ?? 1);
    const e = new Elk(this.terrain, ponto.x, ponto.z, fun, n);
    this.elks.push(e);
    return e;
  }

  byId(id) {
    return this.elks.find((e) => e.id === id) ?? null;
  }

  hit(id, atiradorId, atiradorPos, jogadores = []) {
    const elk = this.byId(id);
    if (!elk || elk.dead) return null;
    const r = elk.hit(atiradorId, atiradorPos, jogadores);
    return { elk, morreu: r.morreu, investiu: r.investiu, assustou: r.assustou };
  }

  kill(id, agora) {
    const elk = this.byId(id);
    if (!elk || elk.dead) return null;
    elk.dead = true;
    elk.deadSince = agora;
    elk.speed = 0;
    elk.state = "dead";
    return elk;
  }

  noticeShot(shot, agora) {
    if (this.over) return;
    for (const e of this.elks) {
      if (e.dead || e.fun) continue;
      if (e.maybeDodgeShot(shot.o, shot.d, shot.v, agora)) break;
    }
  }

  scareNear(x, z) {
    const raio = CONFIG.elk.scareRadius ?? 8;
    for (const e of this.elks) {
      if (e.dead) continue;
      if (Math.hypot(e.x - x, e.z - z) < raio) e.scare(x, z);
    }
  }

  /** Alce do modo (não divertido) ainda vivo. */
  bossElk() {
    return this.elks.find((e) => !e.dead && !e.fun) ?? null;
  }

  update(dt, jogadores, agora) {
    if (this.over) {
      this.elks = this.elks.filter(
        (e) => !e.dead || agora - e.deadSince < CONFIG.elk.corpseLifetime * 1000,
      );
      return [];
    }

    const chifrados = [];
    for (const e of this.elks) {
      const vitima = e.update(dt, jogadores, agora);
      if (vitima != null) chifrados.push(vitima);
    }

    this.elks = this.elks.filter(
      (e) => !e.dead || agora - e.deadSince < CONFIG.elk.corpseLifetime * 1000,
    );

    return chifrados;
  }

  view() {
    return this.elks.map((e) => (e.dead ? { id: e.id, d: 1 } : e.view()));
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;
