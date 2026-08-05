/* ---------------------------------------------------------------------------
   Os zumbis, no servidor.

   Mesma divisão dos porcos e do alce (`boarSim.js`, `elkSim.js`): a IA e a
   arbitragem moram aqui. Aqui isso é ainda mais necessário do que no alce —
   quem decide que a horda acabou e que a próxima entra é uma decisão ÚNICA para
   a sala inteira. Se cada navegador contasse os zumbis restantes por conta
   própria, dois jogadores veriam números de horda diferentes na tela, e o
   momento de virar a horda seria outro em cada máquina.

   O DESENHO DO MODO, em três regras que se sustentam mutuamente:

   1. O zumbi é LENTO (1,15 m/s contra os 3,2 m/s da caminhada). Ele nunca
      alcança quem corre — o perigo não é a velocidade dele, é o número.
   2. Como ele é lento, a única forma de perder é ser cercado. Por isso eles
      nascem em ORDEM CIRCULAR: cada um entra num setor seguinte da volta, e a
      horda fecha o cerco em vez de chegar toda pela mesma aresta. Fosse
      sorteado, três hordas seguidas viriam do mesmo lado e o modo viraria
      "fique de costas para o norte".
   3. Como o cerco é a ameaça, fugir não pode ser resposta: `safeRadius` mata
      quem sai do quadrado de luz. O jogador é obrigado a resolver o cerco
      atirando, que é o que o jogo tem de interessante.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";

let proximoId = 1;

/** Desvios tentados quando o caminho reto esbarra em terreno impossível. */
const DEFLECTIONS = [0, 0.45, -0.45, 0.95, -0.95, 1.6, -1.6];

export class Zombie {
  constructor(terrain, x, z) {
    const Z = CONFIG.modes.zombie;
    this.id = proximoId++;
    this.terrain = terrain;
    this.x = x;
    this.z = z;
    this.y = terrain.heightAt(x, z);
    this.yaw = 0;
    this.state = "walk";
    this.dead = false;
    this.deadSince = 0;
    /** Pegou fogo — só acontece em morte por tiro na cabeça. */
    this.burning = false;
    /** Flechadas no corpo acumuladas. Duas derrubam. */
    this.hits = 0;
    this.lastAttack = -Infinity;

    /* Cada um anda num passo ligeiramente diferente. Sem isso a horda inteira
       chega junta, na mesma linha, e lê como um bloco em vez de um bando. */
    this.speed = Z.speed * (1 + (Math.random() * 2 - 1) * Z.speedVariation);
  }

  /**
   * Um passo. Devolve o id do jogador atacado neste instante, ou null.
   *
   * O alvo é reavaliado a cada passo — ao contrário do alce, cuja investida
   * trava num alvo. Aqui é o certo: o zumbi não investe, ele cerca, e um bando
   * que sempre converge para o vivo mais próximo é exatamente o que produz o
   * cerco.
   */
  update(dt, jogadores, agora) {
    if (this.dead) return null;
    const Z = CONFIG.modes.zombie;

    const alvo = this.pickTarget(jogadores);
    if (!alvo) {
      // Ninguém vivo: continuam andando para o centro, para não congelarem
      // parados no escuro enquanto alguém espera para renascer.
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

  /** Anda na direção do ponto, desviando quando o terreno barra. */
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
    // A folga de 10 m é maior que a do alce porque o zumbi NASCE fora da bacia,
    // no escuro do sopé, e precisa poder descer de lá até o quadrado de luz.
    if (!this.terrain.isWalkable(nx, nz) || this.terrain.arenaDistance(nx, nz) > 10) {
      return false;
    }
    this.x = nx;
    this.z = nz;
    this.y = this.terrain.heightAt(nx, nz);
    return true;
  }

  /**
   * Uma flecha entrou. Devolve `{ morreu, head }`.
   *
   * `head` chega decidido pelo cliente que atirou, a partir da ALTURA do ponto
   * de impacto — é o mesmo dado que o evento de impacto já carrega, e conferir
   * de novo aqui exigiria a pose exata do zumbi no instante do tiro, que o
   * servidor não tem com precisão suficiente (ele manda 10 poses por segundo).
   * O risco disso é um cliente adulterado declarar sempre `head`; a resposta é
   * a mesma de todo o resto do jogo, e está no comentário de `hitTolerance`:
   * isto existe para o jogo não se contradizer, não para impedir trapaça.
   */
  hit(head) {
    if (this.dead) return { morreu: false, head: false };
    if (head) {
      this.burning = true;
      return { morreu: true, head: true };
    }
    this.hits++;
    return { morreu: this.hits >= CONFIG.modes.zombie.bodyHits, head: false };
  }
}

/* ------------------------------------------------------------------ o modo -- */

/**
 * A noite dos zumbis.
 *
 * Dez hordas, de 3 a 21 zumbis, e a seguinte só entra quando o último da atual
 * cai. É essa regra — e não um cronômetro — que faz o modo ter ritmo: a pausa
 * entre hordas é o tempo que os jogadores levaram para limpar a anterior.
 */
export class ZombieNight {
  constructor(terrain) {
    this.terrain = terrain;
    /** @type {Zombie[]} */
    this.zombies = [];
    this.active = false;
    this.horde = 0;
    this.hordeTimer = 0;
    /** Volta em que a horda atual começou a nascer, para o cerco não repetir. */
    this.spawnPhase = 0;
    this.over = false;
    this.overReason = null;
  }

  get vivos() {
    return this.zombies.reduce((n, z) => n + (z.dead ? 0 : 1), 0);
  }

  /** Quantos zumbis a horda `n` traz: 3, 5, 7, … */
  hordeSize(n) {
    const Z = CONFIG.modes.zombie;
    return Z.firstHorde + (n - 1) * Z.hordeStep;
  }

  start() {
    this.active = true;
    this.over = false;
    this.overReason = null;
    this.zombies = [];
    this.horde = 0;
    this.hordeTimer = 0;
    this.spawnPhase = Math.random() * Math.PI * 2;
    return this.nextHorde();
  }

  stop() {
    this.active = false;
    this.zombies = [];
    this.horde = 0;
    this.over = false;
    this.overReason = null;
  }

  /** Entra a horda seguinte. Devolve `{ n, size }`, ou null se acabaram as dez. */
  nextHorde() {
    const Z = CONFIG.modes.zombie;
    if (this.horde >= Z.hordes) return null;
    this.horde++;
    const size = this.hordeSize(this.horde);
    // A fase gira entre hordas: se ela ficasse fixa, o primeiro zumbi de toda
    // horda apareceria sempre no mesmo rumo e o cerco viraria decorável.
    this.spawnPhase += 0.7 + Math.random() * 1.4;
    for (let i = 0; i < size; i++) this.spawnAt(i, size);
    return { n: this.horde, size };
  }

  /**
   * Põe um zumbi no setor `i` de `total` da volta.
   *
   * O ângulo é determinístico (setor i de n, mais a fase da horda) e só o
   * pequeno sorteio dentro do setor é aleatório: é isso que garante que a horda
   * cerque de verdade, em vez de sortear oito ângulos e, por azar, colocar seis
   * deles no mesmo quadrante.
   */
  spawnAt(i, total) {
    const Z = CONFIG.modes.zombie;
    const setor = (Math.PI * 2) / total;
    const ang = this.spawnPhase + i * setor + (Math.random() - 0.5) * setor * 0.7;
    const raio = Z.spawnRadius + (Math.random() - 0.5) * Z.spawnJitter;

    // Marcha para dentro até achar chão que preste. O círculo ideal passa pelo
    // sopé em alguns rumos, e um zumbi nascido na encosta desceria patinando.
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

    const zumbi = new Zombie(this.terrain, x, z);
    zumbi.faceToward(Z.centerX, Z.centerZ);
    this.zombies.push(zumbi);
    return zumbi;
  }

  byId(id) {
    return this.zombies.find((z) => z.id === id) ?? null;
  }

  /** Uma flecha acertou. Devolve `{ zombie, morreu, head }` ou null. */
  hit(id, head) {
    const zumbi = this.byId(id);
    if (!zumbi || zumbi.dead) return null;
    const r = zumbi.hit(head);
    return { zombie: zumbi, morreu: r.morreu, head: r.head };
  }

  kill(id, agora) {
    const zumbi = this.byId(id);
    if (!zumbi || zumbi.dead) return null;
    zumbi.dead = true;
    zumbi.deadSince = agora;
    zumbi.state = "dead";
    return zumbi;
  }

  /**
   * Um passo do mundo dos zumbis.
   *
   * Devolve `{ ataques, horda, venceu }`:
   *   • `ataques` — [{ zombieId, playerId }] de quem alcançou alguém agora;
   *   • `horda`   — `{ n, size }` se uma horda nova acabou de entrar;
   *   • `venceu`  — true quando a décima horda caiu inteira.
   */
  update(dt, jogadores, agora) {
    const Z = CONFIG.modes.zombie;
    const ataques = [];

    for (const zumbi of this.zombies) {
      if (zumbi.dead) continue;
      const alvo = zumbi.update(dt, jogadores, agora);
      if (alvo != null) ataques.push({ zombieId: zumbi.id, playerId: alvo });
    }

    // Os corpos somem depois de um tempo.
    this.zombies = this.zombies.filter(
      (z) => !z.dead || agora - z.deadSince < Z.corpseLifetime * 1000,
    );

    let horda = null;
    let venceu = false;

    if (this.active && !this.over && this.vivos === 0) {
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

  /** Fim de jogo por derrota: todo mundo caiu. */
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
    }));
  }
}

function round(v) {
  return Math.round(v * 100) / 100;
}
