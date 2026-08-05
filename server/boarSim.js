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

/** Desvios tentados ao fugir, do rumo direto para os lados (ver `flee`). */
const DEFLECTIONS = [0, 0.6, -0.6, 1.3, -1.3, 2.1, -2.1, Math.PI];

export class Boar {
  /**
   * @param {boolean} fun porco solto na mão por alguém, só por diversão.
   *   Ele anda e reage igual; só não vale ponto, porque ponto se ganha no modo
   *   caçada, onde as ondas vêm sozinhas e não dá para escolher a distância.
   * @param {object|null} herd o PONTO do bando deste porco (ver `BoarHunt.herds`),
   *   ou `null` para um porco desgarrado. Vários porcos compartilham o mesmo
   *   objeto — é assim que eles pastam perto uns dos outros sem precisar saber
   *   a posição um do outro: cada um só orbita o ponto em comum.
   */
  constructor(terrain, x, z, fun = false, wave = 0, herd = null) {
    this.id = proximoId++;
    this.fun = fun;
    /** Índice da onda que trouxe este porco. `0` = avulso, solto na mão. */
    this.wave = wave;
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
    this.herd = herd;
    this.pickWanderTarget();
  }

  pickWanderTarget() {
    // No bando, o destino orbita o PONTO DO BANDO, não a própria posição —
    // senão cada porco vagaria com seu próprio raio e o grupo se espalharia
    // pelo mapa em poucos ciclos, exatamente como um desgarrado.
    if (this.herd) {
      const r = CONFIG.boar.herd.radius;
      const ang = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      this.targetX = this.herd.x + Math.cos(ang) * d;
      this.targetZ = this.herd.z + Math.sin(ang) * d;
      return;
    }
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
          const base = Math.atan2(dx / len, dz / len);

          /* Fugir em linha reta acaba na borda do mundo, e lá o passo é
             recusado: o bicho ficava parado "correndo" contra a parede. Agora
             ele DESVIA — tenta o rumo direto e, se não passar, vai abrindo o
             ângulo para os dois lados até achar saída, que é o que um animal
             encurralado faz. Ficou visível quando a fuga passou para 11 m/s:
             antes, devagar, ele quase nunca chegava à borda. */
          for (const desvio of DEFLECTIONS) {
            const ang = base + desvio;
            const fx = Math.sin(ang);
            const fz = Math.cos(ang);
            if (this.step(fx, fz, dt)) {
              this.yaw = ang;
              break;
            }
          }
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

  /** Dá um passo. Devolve false quando o destino não é chão pisável. */
  step(fx, fz, dt) {
    const passo = this.speed * dt;
    const nx = this.x + fx * passo;
    const nz = this.z + fz * passo;
    // Fugir para fora do mundo não é fuga: escolhe outro rumo.
    if (!this.terrain.isWalkable(nx, nz) || this.terrain.arenaDistance(nx, nz) > 8) {
      this.pickWanderTarget();
      return false;
    }
    this.x = nx;
    this.z = nz;
    this.y = this.terrain.heightAt(nx, nz);
    return true;
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
 * O modo de caçada: ondas que crescem, até um limite.
 *
 * 3 → 6 → 10 → 15 → 20. A leva seguinte entra quando sobram 10 % da atual, e
 * não quando um cronômetro toca.
 *
 * A DIFERENÇA IMPORTA. Com relógio, quem atira devagar acumula porcos até o
 * campo virar um formigueiro, e quem atira rápido fica esperando de braços
 * cruzados; a dificuldade não tinha relação nenhuma com o que a pessoa fazia.
 * Pelo que sobra em campo, a caçada anda no ritmo de quem está caçando — limpar
 * rápido traz a próxima leva rápido, e é aí que ela aperta.
 *
 * Os 10 % (e não "campo limpo") existem para o modo não travar atrás do último
 * javali escondido numa dobra do terreno. E o `waveTimeout` é a rede embaixo
 * disso: se nem os 10 % caírem, a onda entra assim mesmo.
 *
 * Esgotada a quinta onda (`maxWaves`), a caçada termina: a sala anuncia a
 * vitória e nenhuma onda nova entra, mas os porcos que sobraram continuam
 * vivos, andando e valendo ponto — só o cronômetro de ondas para.
 *
 * Todos os números vivem em `CONFIG.modes.boarHunt`.
 */
export class BoarHunt {
  constructor(terrain) {
    this.terrain = terrain;
    /** @type {Boar[]} */
    this.boars = [];
    this.active = false;
    this.waveTimer = 0;
    /** Quantas ondas já entraram. A primeira é a 1. */
    this.waveCount = 0;
    /** Tamanho da onda em curso — é dele que sai o gatilho dos 10 %. */
    this.waveSize = 0;
    /**
     * Onda recém-chegada, para a sala anunciar. `null` quando não há novidade;
     * quem lê, limpa (ver `takeWaveAnnouncement`).
     */
    this.pendingWave = null;
    /** A quinta onda já esgotou — não entra onda nova. */
    this.finished = false;
    /** Vitória recém-decidida, para a sala anunciar uma única vez. */
    this.pendingVictory = false;
    /**
     * Os PONTOS dos bandos vivos — cada um é `{x, z, targetX, targetZ, timer}`,
     * compartilhado pelos porcos daquele bando (ver `Boar.herd`). Um `Set` e
     * não um `Map` por id porque nada aqui precisa procurar um bando pelo
     * nome — só percorrer todos, a cada passo, e descartar os que ficaram sem
     * porco vivo.
     */
    this.herds = new Set();
  }

  get vivos() {
    return this.boars.reduce((n, b) => n + (b.dead ? 0 : 1), 0);
  }

  /** Vivos da onda ATUAL. Os avulsos e os de ondas velhas não contam. */
  get vivosDaOnda() {
    return this.boars.reduce(
      (n, b) => n + (!b.dead && b.wave === this.waveCount ? 1 : 0),
      0,
    );
  }

  /** Tamanho da onda `n` (1-based). Esgotada a tabela, repete a última. */
  sizeOfWave(n) {
    const tabela = CONFIG.modes.boarHunt.waveSizes;
    return tabela[Math.min(n, tabela.length) - 1];
  }

  start(jogadores) {
    if (this.active) return;
    this.active = true;
    this.waveCount = 0;
    this.finished = false;
    this.pendingVictory = false;
    this.nextWave(jogadores);
  }

  /** Traz a próxima leva e deixa o anúncio pronto para a sala despachar. */
  nextWave(jogadores) {
    this.waveCount++;
    this.waveSize = this.sizeOfWave(this.waveCount);
    this.waveTimer = 0;
    const criados = this.spawnMany(this.waveSize, jogadores, false, this.waveCount);
    this.pendingWave = { n: this.waveCount, size: criados.length || this.waveSize };
  }

  /** Devolve o anúncio pendente uma única vez. */
  takeWaveAnnouncement() {
    const aviso = this.pendingWave;
    this.pendingWave = null;
    return aviso;
  }

  /** Devolve `true` uma única vez, no instante em que a quinta onda esgota. */
  takeVictoryAnnouncement() {
    if (!this.pendingVictory) return false;
    this.pendingVictory = false;
    return true;
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

  /**
   * Traz `quantos` porcos ao campo, agrupados em bandos de até
   * `CONFIG.boar.herd.maxSize` — com uma fração deles desgarrada (ver
   * `pickHerdSize`). Cada bando nasce de um `pickBoarSpawn` só, e os membros se
   * espalham a partir dali — é a partir desse mesmo ponto que o bando começa a
   * pastar (ver `Boar.pickWanderTarget`).
   */
  spawnMany(quantos, jogadores, fun = false, wave = 0) {
    const B = CONFIG.modes.boarHunt;
    const criados = [];
    let restam = quantos;

    while (restam > 0 && this.vivos < B.maxAlive) {
      const tamanho = fun ? 1 : Math.min(restam, this.pickHerdSize());
      const ponto = pickBoarSpawn(this.terrain, jogadores);
      if (!ponto) break;

      const herd =
        tamanho > 1
          ? { x: ponto.x, z: ponto.z, targetX: ponto.x, targetZ: ponto.z, timer: 0 }
          : null;
      if (herd) this.herds.add(herd);

      for (let i = 0; i < tamanho && this.vivos < B.maxAlive; i++) {
        // O primeiro porco nasce no próprio ponto; os demais se espalham perto
        // dele, dentro do raio do bando — senão nasceriam todos empilhados.
        let x = ponto.x;
        let z = ponto.z;
        if (i > 0) {
          const ang = Math.random() * Math.PI * 2;
          const d = Math.random() * CONFIG.boar.herd.radius;
          const cx = ponto.x + Math.cos(ang) * d;
          const cz = ponto.z + Math.sin(ang) * d;
          if (this.terrain.isWalkable(cx, cz)) {
            x = cx;
            z = cz;
          }
        }
        const b = new Boar(this.terrain, x, z, fun, wave, herd);
        this.boars.push(b);
        criados.push(b);
        restam--;
      }
    }
    return criados;
  }

  /** Sorteia o tamanho de um bando novo: a maioria em grupo, uma fração sozinha. */
  pickHerdSize() {
    const H = CONFIG.boar.herd;
    if (Math.random() < H.soloChance) return 1;
    return 2 + Math.floor(Math.random() * (H.maxSize - 1));
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

  /**
   * Faz cada bando derivar devagar pelo mapa.
   *
   * O ponto do bando anda sozinho, bem mais devagar que um porco (ver
   * `herd.driftSpeed`) — os membros é que orbitam ele ao pastar. Sem essa
   * deriva o bando ficaria sempre plantado no ponto de nascimento; com ela,
   * a caçada encontra bandos em lugares diferentes do mapa com o tempo, e não
   * só onde a onda decidiu que eles nasceriam.
   */
  updateHerds(dt) {
    const H = CONFIG.boar.herd;
    for (const h of this.herds) {
      h.timer -= dt;
      const chegou = Math.hypot(h.targetX - h.x, h.targetZ - h.z) < 2;
      if (h.timer <= 0 || chegou) {
        const alvo = this.pickHerdDriftPoint(h);
        if (alvo) {
          h.targetX = alvo.x;
          h.targetZ = alvo.z;
        }
        // Achou ou não achou chão bom desta vez, tenta de novo em breve — não
        // trava a deriva esperando o intervalo inteiro se a primeira tentativa
        // caiu numa encosta.
        h.timer = alvo
          ? H.driftInterval * (0.6 + Math.random() * 0.8)
          : 2;
      }

      const dx = h.targetX - h.x;
      const dz = h.targetZ - h.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const passo = Math.min(len, H.driftSpeed * dt);
      h.x += (dx / len) * passo;
      h.z += (dz / len) * passo;
    }
  }

  /** Um novo destino para o bando `h`: chão de arena a uma boa distância dali. */
  pickHerdDriftPoint(h) {
    for (let i = 0; i < 20; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = 8 + Math.random() * 18;
      const x = h.x + Math.cos(ang) * d;
      const z = h.z + Math.sin(ang) * d;
      if (!this.terrain.isWalkable(x, z)) continue;
      if (this.terrain.arenaDistance(x, z) > 0) continue;
      return { x, z };
    }
    return null;
  }

  update(dt, jogadores, agora) {
    const B = CONFIG.modes.boarHunt;

    this.updateHerds(dt);

    // Os porcos andam sempre que existem — inclusive os avulsos, fora da
    // caçada. Só as ONDAS dependem do modo estar ligado.
    for (const b of this.boars) b.update(dt, jogadores);

    // Corpos somem depois de um tempo, senão o campo vira um matadouro que só
    // acumula geometria.
    this.boars = this.boars.filter(
      (b) => !b.dead || agora - b.deadSince < B.corpseLifetime * 1000,
    );

    // Bando sem porco vivo não tem mais o que segurar junto — descarta, senão
    // o `Set` só cresce ao longo de uma caçada inteira.
    for (const h of this.herds) {
      if (!this.boars.some((b) => !b.dead && b.herd === h)) this.herds.delete(h);
    }

    if (!this.active || this.finished) return;
    this.waveTimer += dt;

    /* O gatilho: sobraram 10 % da onda, arredondando PARA CIMA.
       Para cima, e não para baixo, porque com 3 porcos os 10 % dariam zero — e
       exigir campo perfeitamente limpo faz a caçada travar atrás do último
       javali que se enfiou numa moita. Com o arredondamento para cima, uma onda
       de 3 chama a próxima quando resta 1, e uma de 20, quando restam 2. */
    const limite = Math.ceil(this.waveSize * B.nextWaveRemaining);
    const esvaziou = this.vivosDaOnda <= limite;
    const demorou = this.waveTimer >= B.waveTimeout;
    if (!esvaziou && !demorou) return;

    if (this.waveCount >= B.maxWaves) {
      // A quinta onda esgotou: a caçada termina aqui. Os porcos que sobraram
      // continuam em campo (ver o `filter` acima) — só o relógio de ondas para.
      this.finished = true;
      this.pendingVictory = true;
      return;
    }
    this.nextWave(jogadores);
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
