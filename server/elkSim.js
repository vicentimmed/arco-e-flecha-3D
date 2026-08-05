/* ---------------------------------------------------------------------------
   O alce, no servidor.

   Pelo mesmo motivo dos porcos (`boarSim.js`): a IA sorteia, e uma IA sorteada
   rodando em cada navegador daria um bicho por tela. Aqui é ainda mais grave —
   o alce MATA. Se cada cliente decidisse sozinho para onde ele investe, um
   jogador morreria de uma cabeçada que, na tela do amigo, passou a três metros
   de distância. Existe um simulador só, e o que ele decide é o que aconteceu.

   O BICHO É ARISCO, NÃO AGRESSIVO.

   Ele foge. É o que um herbívoro de meia tonelada faz quando gente se aproxima,
   e é o que torna a caçada uma caçada: você precisa alcançá-lo. A investida
   existe, mas é EXCEÇÃO — nasce de uma flechada, acontece só parte das vezes, e
   termina de um jeito ou de outro em fuga. Um alce que persegue sem parar não é
   um animal, é um míssil, e transformava o modo numa corrida perdida.

   A máquina de estados:

     pastar  → ninguém por perto; come e anda devagar, cabeça baixa.
     alerta  → alguém entrou no anel de vigilância; PARA e levanta a cabeça.
     fugir   → alguém chegou perto demais; corre para longe.
     investe → levou uma flecha e resolveu revidar. Vem em linha reta.
     recobra → acertou a cabeçada ou desistiu; respira e volta a fugir.
     morto   → o corpo fica um tempo e some.

   POR QUE A INVESTIDA É ESQUIVÁVEL. Três números fazem isso, e nenhum deles é
   "deixar o bicho mais lento": ele corrige o rumo devagar (`turnRate`), PARA de
   corrigir nos últimos metros (`commitDistance` — está comprometido, como um
   animal que abaixou a cabeça), e desiste assim que percebe que passou reto
   (`giveUpTicks`). O jogador ganha saindo de lado na hora certa, não correndo
   mais rápido — porque correr mais rápido que ele não dá.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { pickElkSpawn } from "./spawnPoints.js";

let proximoId = 1;

/** Desvios tentados quando a investida esbarra na borda do mundo. */
const DEFLECTIONS = [0, 0.5, -0.5, 1.1, -1.1, 1.9, -1.9];

export class Elk {
  /**
   * @param {boolean} fun alce solto na mão por alguém, fora do modo. Anda e
   *   ataca igual; só não vale ponto, pela mesma razão do porco avulso —
   *   quem solta escolhe a distância.
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
    this.state = "graze";
    this.stateTimer = 0;
    this.health = CONFIG.elk.maxHealth;
    this.hits = 0;
    this.dead = false;
    this.deadSince = 0;
    /** Id do jogador na mira da investida. */
    this.targetId = null;
    /** Distância ao alvo no passo anterior — é ela que detecta "passei reto". */
    this.lastTargetDist = Infinity;
    /** Passos seguidos se afastando do alvo durante a investida. */
    this.awayTicks = 0;
    this.pickWanderTarget();
  }

  pickWanderTarget() {
    const ang = Math.random() * Math.PI * 2;
    const d = 6 + Math.random() * 18;
    this.targetX = this.x + Math.cos(ang) * d;
    this.targetZ = this.z + Math.sin(ang) * d;
  }

  /**
   * Levou uma flecha.
   *
   * É o ÚNICO caminho para uma investida. Sem flecha, o alce nunca ataca — ele
   * foge, pasta e observa. Mas nem toda flechada vira investida: `chargeChance`
   * decide, e o resto das vezes ele simplesmente dispara em fuga.
   *
   * A dúvida é o ponto. Se toda flechada trouxesse o bicho para cima, o jogador
   * aprenderia a contar os tiros e a briga viraria coreografia; se nenhuma
   * trouxesse, ele viraria um alvo grande e manso. Sem saber qual das duas vem,
   * cada tiro é uma decisão de verdade.
   *
   * @param {{x, z, id}|null} atiradorPos quem atirou, para virar-se contra ele
   */
  hit(atiradorId, atiradorPos, jogadores = []) {
    if (this.dead) return null;
    const E = CONFIG.elk;
    this.hits++;
    this.health = Math.max(0, this.health - E.arrowDamage);

    if (this.health <= 0) return { morreu: true };

    this.stateTimer = 0;
    if (Math.random() < E.chargeChance) {
      // Revida. O alvo costuma ser quem atirou, mas não sempre — ver
      // `pickChargeTarget`.
      const alvo = this.pickChargeTarget(jogadores, atiradorId, atiradorPos);
      this.targetId = alvo?.id ?? atiradorId;
      this.state = "charge";
      this.awayTicks = 0;
      this.lastTargetDist = Infinity;
      if (alvo) this.faceToward(alvo.x, alvo.z);
      else if (atiradorPos) this.faceToward(atiradorPos.x, atiradorPos.z);
      return { morreu: false, investiu: true };
    }

    // Não revidou: corre. E corre PARA LONGE de quem atirou, não em rumo
    // sorteado — levar uma flechada e sair na direção do arqueiro seria o
    // oposto do que assusta um bicho.
    this.state = "flee";
    this.fleeFrom = atiradorPos ? { x: atiradorPos.x, z: atiradorPos.z } : null;
    return { morreu: false, investiu: false };
  }

  /**
   * Contra quem investir.
   *
   * Quase sempre o mais próximo — é o alvo que qualquer animal escolheria. Mas
   * `nearestBias` deixa uma fatia para os outros, e é ela que impede o modo de
   * virar uma regra decorada numa sala com gente: se o alce fosse SEMPRE no
   * mais perto, o grupo aprenderia a usar uma isca fixa e ninguém mais correria
   * perigo. Quem atirou entra na conta com peso extra, porque é dele a flecha.
   */
  pickChargeTarget(jogadores, atiradorId, atiradorPos) {
    const E = CONFIG.elk;
    const candidatos = jogadores.filter(
      (p) => p.alive !== false && this.distanceTo(p) < E.visionRange,
    );
    if (!candidatos.length) {
      return atiradorPos ? { id: atiradorId, ...atiradorPos } : null;
    }

    candidatos.sort((a, b) => this.distanceTo(a) - this.distanceTo(b));
    // O atirador conta como "o mais próximo" mesmo estando longe: foi ele que
    // provocou, e ir atrás de quem provocou é a leitura óbvia da cena.
    const preferido =
      candidatos.find((p) => p.id === atiradorId) ?? candidatos[0];
    if (candidatos.length === 1 || Math.random() < E.nearestBias) return preferido;

    const outros = candidatos.filter((p) => p !== preferido);
    return outros[Math.floor(Math.random() * outros.length)];
  }

  /** Velocidade da investida AGORA: cresce com o número de flechas levadas. */
  get chargeSpeed() {
    const E = CONFIG.elk;
    return Math.min(E.chargeSpeedMax, E.chargeSpeed + E.chargeSpeedPerHit * this.hits);
  }

  faceToward(x, z) {
    const dx = x - this.x;
    const dz = z - this.z;
    if (Math.hypot(dx, dz) < 1e-4) return;
    this.yaw = Math.atan2(dx, dz);
  }

  /**
   * Um passo. Devolve o id do jogador chifrado neste instante, ou null.
   *
   * A cabeçada é decidida AQUI e não no cliente pelo mesmo motivo de tudo o
   * mais neste arquivo: é uma morte, e uma morte não pode depender de qual
   * navegador estava desenhando o alce mais adiantado.
   */
  update(dt, jogadores) {
    if (this.dead) return null;
    const E = CONFIG.elk;
    this.stateTimer += dt;

    const alvo = this.pickTarget(jogadores);

    const perto = alvo ? this.distanceTo(alvo) : Infinity;

    switch (this.state) {
      case "graze": {
        this.speed = E.walkSpeed;
        this.moveToward(this.targetX, this.targetZ, dt);
        if (perto < E.fleeRange) {
          this.startFlee(alvo);
        } else if (perto < E.alertRange) {
          this.state = "alert";
          this.stateTimer = 0;
          this.targetId = alvo.id;
        } else if (this.stateTimer > 7) {
          this.stateTimer = 0;
          this.pickWanderTarget();
        }
        break;
      }

      /* Atento: PARADO, cabeça erguida, encarando.
         Ele não ronda nem se aproxima — a versão anterior fazia isso e lia como
         "vem me pegar", exatamente o contrário do bicho arisco. Aqui ele
         congela e olha, que é o aviso de que a próxima aproximação o espanta. */
      case "alert": {
        this.speed = 0;
        if (!alvo) {
          this.state = "graze";
          this.stateTimer = 0;
          break;
        }
        this.targetId = alvo.id;
        this.faceToward(alvo.x, alvo.z);
        if (perto < E.fleeRange) this.startFlee(alvo);
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
          this.yaw = Math.atan2(dx / len, dz / len);
        }
        this.stepForward(dt);
        // Só volta a pastar quando ficou um tempo longe de todo mundo: parar de
        // correr no instante em que o jogador sai do raio dá um bicho que
        // liga e desliga a fuga a cada passo dele.
        if (perto > E.alertRange && this.stateTimer > E.grazeSettle) {
          this.state = "graze";
          this.stateTimer = 0;
          this.pickWanderTarget();
        } else if (perto < E.fleeRange) {
          // Continua com alguém colado: renova o rumo e o cronômetro.
          this.fleeFrom = { x: alvo.x, z: alvo.z };
          this.stateTimer = 0;
        }
        break;
      }

      case "charge": {
        this.speed = this.chargeSpeed;
        const perseguido = this.byId(jogadores, this.targetId);
        if (!perseguido) {
          this.endCharge(alvo);
          break;
        }

        const d = this.distanceTo(perseguido);

        /* O COMPROMISSO. Longe do alvo ele ainda corrige o rumo, devagar; dentro
           de `commitDistance` ele para de corrigir e vai reto no que mirou.
           É esta linha que torna a esquiva possível: nos últimos metros, sair de
           lado não é acompanhado, porque o bicho já abaixou a cabeça. */
        if (d > E.commitDistance) {
          this.turnToward(perseguido.x, perseguido.z, E.turnRate * dt);
        }
        this.stepForward(dt);

        if (d < E.goreRadius) {
          // Acertou. E, tendo acertado, FOGE — não sai procurando o próximo.
          this.endCharge(perseguido, true);
          return perseguido.id;
        }

        /* Desistência por afastamento: se a distância cresce vários passos
           seguidos, ele passou reto. Um único passo não serve de critério
           (a correção de rumo produz oscilações de centímetros), mas quatro
           seguidos só acontecem quando o alvo saiu mesmo da linha. */
        if (d > this.lastTargetDist) this.awayTicks++;
        else this.awayTicks = 0;
        this.lastTargetDist = d;

        if (this.awayTicks >= E.giveUpTicks || this.stateTimer > E.chargeDuration) {
          this.endCharge(perseguido);
        }
        break;
      }

      /* Recobrando: parado, ofegante. Termina SEMPRE em fuga — foi por isso que
         a investida acabou, tendo acertado ou não. */
      case "recover": {
        this.speed = 0;
        if (this.stateTimer < E.chargeCooldown) break;
        this.startFlee(alvo);
        break;
      }
    }
    return null;
  }

  /** Entra em fuga, correndo para longe de quem o incomodou. */
  startFlee(de) {
    this.state = "flee";
    this.stateTimer = 0;
    if (de) this.fleeFrom = { x: de.x, z: de.z };
  }

  /** Fim da investida: respira e depois foge. */
  endCharge(de, acertou = false) {
    this.state = "recover";
    this.stateTimer = 0;
    this.awayTicks = 0;
    this.lastTargetDist = Infinity;
    this.targetId = null;
    // Acertou: o corpo do arqueiro fica para trás e o alce dispara na direção
    // oposta. Não acertou: ele se afasta de quem estava perseguindo.
    if (de) this.fleeFrom = { x: de.x, z: de.z };
    if (acertou) this.faceToward(this.x * 2 - (de?.x ?? this.x), this.z * 2 - (de?.z ?? this.z));
  }

  /** O jogador vivo mais próximo. */
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

  /** Gira até `maxDelta` radianos na direção do ponto, pelo caminho curto. */
  turnToward(x, z, maxDelta) {
    const querido = Math.atan2(x - this.x, z - this.z);
    let d = querido - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += Math.max(-maxDelta, Math.min(maxDelta, d));
  }

  moveToward(tx, tz, dt) {
    this.faceToward(tx, tz);
    this.stepForward(dt);
    if (Math.hypot(tx - this.x, tz - this.z) < 2) this.pickWanderTarget();
  }

  /** Anda para onde está virado, desviando quando a borda do mundo barra. */
  stepForward(dt) {
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
    if (!this.terrain.isWalkable(nx, nz) || this.terrain.arenaDistance(nx, nz) > 6) {
      return false;
    }
    this.x = nx;
    this.z = nz;
    this.y = this.terrain.heightAt(nx, nz);
    return true;
  }

  view() {
    return {
      id: this.id,
      p: [r3(this.x), r3(this.y), r3(this.z)],
      y: r3(this.yaw),
      v: r3(this.speed),
      s: this.state,
      // Fração de vida, não o valor absoluto: a barra na tela quer 0..1 e o
      // cliente não precisa saber quanto vale uma flechada.
      h: Math.round((this.health / CONFIG.elk.maxHealth) * 100) / 100,
      f: this.fun ? 1 : 0,
    };
  }
}

/* ------------------------------------------------------------------ o modo -- */

/**
 * A caçada ao alce.
 *
 * Um bicho por vez. Morto, outro entra depois de `respawnDelay` — o modo não
 * termina, ele recomeça, e o placar é que conta a história.
 *
 * Como `BoarHunt`, os alces SOLTOS NA MÃO (tecla avulsa) sobrevivem ao
 * desligamento do modo: quem largou um alce para brincar não deveria perdê-lo
 * porque outro jogador trocou de modo.
 */
export class ElkHunt {
  constructor(terrain) {
    this.terrain = terrain;
    /** @type {Elk[]} */
    this.elks = [];
    this.active = false;
    this.respawnTimer = 0;
  }

  get vivos() {
    return this.elks.reduce((n, e) => n + (e.dead ? 0 : 1), 0);
  }

  /** Alces do modo (não os avulsos): é a existência deles que o modo garante. */
  get vivosDoModo() {
    return this.elks.reduce((n, e) => n + (!e.dead && !e.fun ? 1 : 0), 0);
  }

  start(jogadores) {
    if (this.active) return;
    this.active = true;
    this.respawnTimer = 0;
    this.spawnOne(jogadores, false);
  }

  stop() {
    this.active = false;
    this.elks = this.elks.filter((e) => e.fun && !e.dead);
  }

  spawnOne(jogadores, fun = false) {
    const ponto = pickElkSpawn(this.terrain, jogadores);
    if (!ponto) return null;
    const e = new Elk(this.terrain, ponto.x, ponto.z, fun);
    this.elks.push(e);
    return e;
  }

  byId(id) {
    return this.elks.find((e) => e.id === id) ?? null;
  }

  /**
   * Uma flecha acertou. Devolve `{ elk, morreu, investiu }`, ou null se o alce
   * não existe ou já estava morto.
   *
   * A lista de jogadores vai junto porque a escolha do alvo da investida é
   * feita AQUI, no instante do acerto — e não a cada passo. Um bicho que
   * reavalia o alvo a cada décimo de segundo troca de vítima no meio da corrida
   * e nunca chega em ninguém.
   */
  hit(id, atiradorId, atiradorPos, jogadores = []) {
    const elk = this.byId(id);
    if (!elk || elk.dead) return null;
    const r = elk.hit(atiradorId, atiradorPos, jogadores);
    return { elk, morreu: r.morreu, investiu: r.investiu };
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

  /**
   * Um passo do mundo dos alces.
   * @returns {number[]} ids dos jogadores chifrados neste passo
   */
  update(dt, jogadores, agora) {
    const chifrados = [];
    for (const e of this.elks) {
      const vitima = e.update(dt, jogadores);
      if (vitima != null) chifrados.push(vitima);
    }

    this.elks = this.elks.filter(
      (e) => !e.dead || agora - e.deadSince < CONFIG.elk.corpseLifetime * 1000,
    );

    // O modo garante que sempre haja um alce em pé.
    if (this.active && this.vivosDoModo === 0) {
      this.respawnTimer += dt;
      if (this.respawnTimer >= CONFIG.modes.elkHunt.respawnDelay) {
        this.respawnTimer = 0;
        this.spawnOne(jogadores, false);
      }
    }
    return chifrados;
  }

  view() {
    return this.elks.map((e) => (e.dead ? { id: e.id, d: 1 } : e.view()));
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;
