/* ---------------------------------------------------------------------------
   O que se mexe na Lua, no servidor.

   Antes isto vivia no cliente, um mundo por aba: o alien que te perseguia não
   era o alien que perseguia o seu amigo, e a nave que você derrubou continuava
   voando na tela dele. Numa fase que fosse só cenário isso passaria; nesta não,
   porque **tudo aqui mata ou carrega alguém**.

   O que veio para cá, e por quê — a regra é uma só: vai para o servidor o que
   muda a partida para outra pessoa.

     alien ............. persegue e mata
     nave .............. é abatível e o estouro mata
     rover ............. carrega jogador e atropela alien
     meteorito ......... dá para ficar em cima, e os estilhaços matam

   O que NÃO veio, e por quê:

     poeira ............ é definida em torno da câmera de QUEM OLHA. Não existe
                         "a mesma poeira" para duas pessoas; a ideia não tem
                         sentido.
     estrela cadente ... nenhum efeito de jogo. Sincroniza pelo relógio da sala
     baliza do foguete   por uma função pura do tempo, sem trafegar um byte.
     base, terreno ..... geometria estática de semente fixa: já é idêntica em
                         todas as telas desde sempre.

   O padrão é o dos porcos (`boarSim.js`): aqui se simula, a sala transmite a
   10 Hz, e o cliente reconcilia por id. Acontecimento pontual que não cabe numa
   amostra — uma explosão — vai por `S2C.SPACE_EVENT`.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import {
  criarEstilhacos,
  passoEstilhaco,
  estilhacoLetal,
  distanciaSegmento,
} from "../src/shared/fragments.js";

const TAU = Math.PI * 2;
let proximoId = 1;

const faixa = (min, max) => min + Math.random() * (max - min);

/* ---------------------------------------------------------------- aliens --- */

/**
 * O alien: pequeno, verde e teimoso.
 *
 * Anda até o jogador mais próximo, para a `attackRange`, ERGUE OS BRAÇOS e só
 * depois do preparo o golpe conecta. O aviso não é enfeite: sem ele a morte
 * chega no mesmo quadro em que o alien encosta, e não há o que reagir — nem
 * recuar, nem virar e atirar nele primeiro.
 *
 * O alcance tem DUAS medidas, e a segunda é a que faltava: a horizontal
 * (`attackRange`) e a VERTICAL (`attackMaxHeight`). Só com a primeira, quem
 * subisse de jetpack continuava sendo golpeado do chão — o alien media a sombra
 * da vítima, não a vítima. Agora o golpe só pega quem está no chão; quem voa,
 * pula ou está em cima de um meteorito passa por cima dele.
 */
class Alien {
  constructor(terrain, x, z) {
    const A = CONFIG.levels.moon.alien;
    this.id = proximoId++;
    this.terrain = terrain;
    this.x = x;
    this.z = z;
    this.y = terrain.heightAt(x, z);
    this.yaw = 0;
    this.dead = false;
    this.hp = 1; // uma flechada, como o resto do bestiário pequeno
    this.estado = "perseguindo"; // | "golpeando" | "recuando"
    this.t = 0;
    this.A = A;
  }

  /**
   * A vítima está ao alcance do braço — nas duas medidas?
   *
   * A altura é contada a partir do TERRENO SOB ELA, e não da altura do próprio
   * alien: é assim que a conta continua certa quando ele está no fundo de uma
   * cratera e a pessoa na borda, e é a definição literal de "está no chão".
   */
  aoAlcance(j, folga = 0) {
    const d = Math.hypot(j.x - this.x, j.z - this.z);
    if (d > this.A.attackRange + folga) return false;
    const alturaChao = j.y - this.terrain.heightAt(j.x, j.z);
    return alturaChao <= (this.A.attackMaxHeight ?? 1.2);
  }

  /** @returns {{vitima:number}|null} o golpe que conectou neste passo */
  update(dt, jogadores) {
    if (this.dead) return null;

    let melhor = null;
    let melhorD = Infinity;
    for (const j of jogadores) {
      if (!j.alive) continue;
      const d = (j.x - this.x) ** 2 + (j.z - this.z) ** 2;
      if (d < melhorD) {
        melhorD = d;
        melhor = j;
      }
    }

    if (this.estado === "golpeando") {
      this.t += dt;
      if (melhor) this.yaw = Math.atan2(melhor.x - this.x, melhor.z - this.z);
      if (this.t >= this.A.attackWindup) {
        this.estado = "recuando";
        this.t = 0;
        /* Ainda ao alcance? O alvo pode ter se afastado durante o preparo — a
           pé ou PARA CIMA, e os dois são fuga legítima: meio segundo de braços
           erguidos é exatamente o tempo de acionar o jetpack e sair de cima
           dele. Nos dois casos o golpe passa no vazio em vez de matar. */
        if (melhor && this.aoAlcance(melhor, 0.4)) return { vitima: melhor.id };
      }
      return null;
    }

    if (this.estado === "recuando") {
      this.t += dt;
      if (this.t >= this.A.attackCooldown) {
        this.estado = "perseguindo";
        this.t = 0;
      }
      return null;
    }

    if (!melhor) return null;

    const dx = melhor.x - this.x;
    const dz = melhor.z - this.z;
    const d = Math.hypot(dx, dz) || 1;
    this.yaw = Math.atan2(dx, dz);

    /* Só ERGUE OS BRAÇOS para quem ele poderia acertar. Contra alguém voando
       por cima ele continua perseguindo — fica embaixo, andando e guinchando,
       que é a leitura certa: a ameaça não sumiu, ela está esperando você
       pousar. Um alien golpeando o ar sob um jogador a trinta metros seria
       cômico, e pior, prometeria um perigo que não existe. */
    if (d <= this.A.attackRange && this.aoAlcance(melhor)) {
      this.estado = "golpeando";
      this.t = 0;
      return null;
    }

    const nx = this.x + (dx / d) * this.A.speed * dt;
    const nz = this.z + (dz / d) * this.A.speed * dt;
    if (this.terrain.isWalkable(nx, nz)) {
      this.x = nx;
      this.z = nz;
      this.y = this.terrain.heightAt(nx, nz);
    }
    return null;
  }

  atingir() {
    if (this.dead) return false;
    this.hp--;
    if (this.hp > 0) return false;
    this.dead = true;
    return true;
  }

  view() {
    return {
      i: this.id,
      x: r(this.x),
      y: r(this.y),
      z: r(this.z),
      w: r(this.yaw),
      s: this.estado === "golpeando" ? 1 : 0,
    };
  }
}

/* ----------------------------------------------------------------- naves --- */

/** Um disco voador cruzando o céu — e derrubável. */
class Nave {
  constructor(terrain, centro) {
    const S = CONFIG.levels.moon.ship;
    this.id = proximoId++;
    this.terrain = terrain;
    this.morta = false;
    this.queda = 0;
    this.acabou = false;

    const ang = Math.random() * TAU;
    const raio = S.raioRota;
    this.altura = faixa(S.alturaMin, S.alturaMax);
    this.de = {
      x: centro.x + Math.cos(ang) * raio,
      y: this.altura,
      z: centro.z + Math.sin(ang) * raio,
    };
    const desvio = (Math.random() - 0.5) * 120;
    this.para = {
      x: centro.x - Math.cos(ang) * raio + Math.sin(ang) * desvio,
      y: this.altura - 6,
      z: centro.z - Math.sin(ang) * raio - Math.cos(ang) * desvio,
    };
    this.t = 0;
    const dist = Math.hypot(this.para.x - this.de.x, this.para.z - this.de.z);
    this.duracao = dist / faixa(S.velMin, S.velMax);
    this.x = this.de.x;
    this.y = this.de.y;
    this.z = this.de.z;
    this.giro = 0;
  }

  abater() {
    if (this.morta) return false;
    this.morta = true;
    this.queda = 0;
    this.giro = (Math.random() - 0.5) * 4;
    return true;
  }

  /** @returns {"caiu"|"saiu"|null} */
  update(dt) {
    if (this.morta) {
      /* A QUEDA. Sem propulsão e em 1/6 de g ela desce devagar e girando — o
         que dá tempo de ver o resultado do próprio tiro, que é metade da
         recompensa de acertar. */
      this.queda += CONFIG.levels.moon.gravity * dt;
      this.y += this.queda * dt;
      const chao = this.terrain.heightAt(this.x, this.z);
      if (this.y <= chao + 1.5) {
        this.y = chao + 1.5;
        return "caiu";
      }
      return null;
    }

    this.t += dt / this.duracao;
    if (this.t >= 1) return "saiu";
    this.x = this.de.x + (this.para.x - this.de.x) * this.t;
    this.y = this.de.y + (this.para.y - this.de.y) * this.t;
    this.z = this.de.z + (this.para.z - this.de.z) * this.t;
    return null;
  }

  view() {
    return { i: this.id, x: r(this.x), y: r(this.y), z: r(this.z), m: this.morta ? 1 : 0 };
  }
}

/* ----------------------------------------------------------------- rover --- */

/** Pontos do circuito, relativos ao centro da base. */
const WAYPOINTS = [
  { dx: -10, dz: -22 }, { dx: -44, dz: 4 }, { dx: -58, dz: 42 },
  { dx: -30, dz: 46 }, { dx: -10, dz: 26 }, { dx: 20, dz: 48 },
  { dx: 46, dz: 34 }, { dx: 44, dz: -2 }, { dx: 32, dz: -34 },
  { dx: 0, dz: -44 },
];
const SONDA_ANGULO = 0.7;

/**
 * O rover, rondando a base.
 *
 * A esquiva de RELEVO é a mesma do cliente (diferença de altura à frente, que
 * sabe distinguir rampa de parede) com o mesmo vigia de travamento — que mede
 * PROGRESSO ATÉ O DESTINO, e não distância andada, porque dentro de uma cratera
 * ele não fica parado: ele circula a tigela.
 *
 * O que ficou de fora é a sonda de raio: ela dependia do Rapier e das caixas de
 * carga, que o servidor não conhece. Sem ela o rover atravessa contêiner —
 * dívida conhecida, do mesmo tamanho da que o bot tem com as árvores.
 */
class Rover {
  constructor(terrain, base) {
    const R = CONFIG.levels.moon.rover;
    this.id = proximoId++;
    this.terrain = terrain;
    this.waypoints = WAYPOINTS.map((w) => ({ x: base.x + w.dx, z: base.z + w.dz }));
    this.wpIndex = 0;
    this.x = this.waypoints[0].x;
    this.z = this.waypoints[0].z;
    this.y = terrain.heightAt(this.x, this.z);
    this.yaw = 0;
    this.stuckT = 0;
    this.escapeT = 0;
    this.marcoDist = Infinity;
    this.R = R;
    /** m — contato com um alien dentro disto o mata. */
    this.contactRadius = Math.hypot(0.95, 1.7) + 0.6;
  }

  subidaAdiante(desvio) {
    const d = this.R.probeDist;
    const ang = this.yaw + desvio;
    const px = this.x + Math.sin(ang) * d;
    const pz = this.z + Math.cos(ang) * d;
    if (!this.terrain.isWalkable(px, pz)) return Infinity;
    return this.terrain.heightAt(px, pz) - this.y;
  }

  update(dt) {
    const alvo = this.waypoints[this.wpIndex];
    const dx = alvo.x - this.x;
    const dz = alvo.z - this.z;
    const distAlvo = Math.hypot(dx, dz);
    if (distAlvo < 4.5) {
      this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
      this.marcoDist = Infinity;
      this.stuckT = 0;
    }

    let rumo = Math.atan2(dx, dz);
    const R = this.R;

    this.stuckT += dt;
    if (this.escapeT > 0) {
      this.escapeT -= dt;
    } else if (this.stuckT >= R.stuckWindow) {
      const aproximou = this.marcoDist - distAlvo;
      if (aproximou < R.stuckDistance) this.escapeT = R.unstuckTime;
      this.stuckT = 0;
      this.marcoDist = distAlvo;
    }

    if (this.escapeT <= 0 && this.subidaAdiante(0) > R.maxClimb) {
      const esq = this.subidaAdiante(-SONDA_ANGULO);
      const dir = this.subidaAdiante(SONDA_ANGULO);
      rumo = this.yaw + (esq < dir ? -SONDA_ANGULO * 1.3 : SONDA_ANGULO * 1.3);
    }

    let dYaw = rumo - this.yaw;
    while (dYaw > Math.PI) dYaw -= TAU;
    while (dYaw < -Math.PI) dYaw += TAU;
    const giroMax = R.turnRate * dt;
    this.yaw += Math.max(-giroMax, Math.min(giroMax, dYaw));

    const passo = R.speed * dt;
    const nx = this.x + Math.sin(this.yaw) * passo;
    const nz = this.z + Math.cos(this.yaw) * passo;
    if (this.terrain.isWalkable(nx, nz)) {
      this.x = nx;
      this.z = nz;
    }
    this.y = this.terrain.heightAt(this.x, this.z);
  }

  view() {
    return { x: r(this.x), y: r(this.y), z: r(this.z), w: r(this.yaw) };
  }
}

/* ------------------------------------------------------------ meteoritos --- */

/** Rocha grande em deriva lenta, em que dá para pousar de jetpack. */
class Meteor {
  constructor(terrain, centro, raioArena) {
    const M = CONFIG.levels.moon.meteors;
    this.id = proximoId++;
    this.terrain = terrain;
    this.raio = faixa(M.raioMin, M.raioMax);
    this.formato = Math.floor(Math.random() * M.formatos);
    this.hp = M.hp;
    this.dead = false;

    const ang = Math.random() * TAU;
    const dist = raioArena + 40;
    this.x = centro.x + Math.cos(ang) * dist;
    this.z = centro.z + Math.sin(ang) * dist;
    this.y = terrain.heightAt(centro.x, centro.z) + faixa(M.alturaMin, M.alturaMax);
    const v = faixa(M.velMin, M.velMax);
    // Atravessa em direção ao outro lado, com um desvio para não passar sempre
    // pelo centro exato.
    const alvoX = centro.x - Math.cos(ang) * dist + (Math.random() - 0.5) * 120;
    const alvoZ = centro.z - Math.sin(ang) * dist + (Math.random() - 0.5) * 120;
    const dx = alvoX - this.x;
    const dz = alvoZ - this.z;
    const d = Math.hypot(dx, dz) || 1;
    this.vx = (dx / d) * v;
    this.vz = (dz / d) * v;
    this.percorrido = 0;
    this.total = d;
  }

  update(dt) {
    if (this.dead) return "morreu";
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.percorrido += Math.hypot(this.vx, this.vz) * dt;
    if (this.percorrido >= this.total) return "saiu";
    return null;
  }

  atingir() {
    if (this.dead) return false;
    this.hp--;
    if (this.hp > 0) return false;
    this.dead = true;
    return true;
  }

  view() {
    return {
      i: this.id,
      x: r(this.x),
      y: r(this.y),
      z: r(this.z),
      r: r(this.raio),
      f: this.formato,
    };
  }
}

/* --------------------------------------------------------------- o campo --- */

export class SpaceField {
  constructor(terrain) {
    this.setTerrain(terrain);
  }

  setTerrain(terrain) {
    this.terrain = terrain;
    this.aliens = [];
    this.naves = [];
    this.meteors = [];
    this.rover = null;
    this.estilhacos = [];
    this.tAlien = 12;
    this.tNave = 6;
    this.tMeteor = 8;
    this.ativo = false;
  }

  /** Liga o campo — só faz sentido na Lua. */
  ligar() {
    if (this.ativo) return;
    const M = CONFIG.levels.moon;
    this.ativo = true;
    this.centro = { x: this.terrain.centerX ?? 0, z: this.terrain.centerZ ?? 0 };
    this.base = { x: M.base.x, z: M.base.z };
    this.rover = new Rover(this.terrain, this.base);
  }

  clear() {
    this.aliens = [];
    this.naves = [];
    this.meteors = [];
    this.estilhacos = [];
    this.rover = null;
    this.ativo = false;
  }

  /**
   * @param {Array<{id,alive,x,y,z}>} jogadores todo mundo com corpo em campo
   * @returns {{mortes:Array, eventos:Array}} quem morreu e o que estourou
   */
  update(dt, jogadores) {
    const mortes = [];
    const eventos = [];
    if (!this.ativo) return { mortes, eventos };

    const M = CONFIG.levels.moon;

    /* ------------------------------------------------------------ aliens -- */
    this.tAlien -= dt;
    if (this.tAlien <= 0 && this.aliens.length < M.alien.maxAlive && jogadores.length) {
      this.tAlien = faixa(M.alien.spawnMin, M.alien.spawnMax);
      const alvo = jogadores[Math.floor(Math.random() * jogadores.length)];
      const a = Math.random() * TAU;
      const d = faixa(M.alien.spawnDistMin, M.alien.spawnDistMax);
      const x = alvo.x + Math.cos(a) * d;
      const z = alvo.z + Math.sin(a) * d;
      if (this.terrain.isWalkable(x, z)) {
        this.aliens.push(new Alien(this.terrain, x, z));
      }
    }
    for (let i = this.aliens.length - 1; i >= 0; i--) {
      const al = this.aliens[i];
      const golpe = al.update(dt, jogadores);
      if (golpe) mortes.push({ vitima: golpe.vitima, causa: "alien" });
      // O corpo some da lista alguns segundos depois de morrer, para o cliente
      // ter tempo de tocar o derretimento.
      if (al.dead) {
        al.sumindo = (al.sumindo ?? 0) + dt;
        if (al.sumindo > 1.2) this.aliens.splice(i, 1);
      }
    }

    /* ------------------------------------------------------------- naves -- */
    this.tNave -= dt;
    if (this.tNave <= 0 && this.naves.length < M.ship.maxAlive) {
      this.tNave = faixa(M.ship.spawnMin, M.ship.spawnMax);
      this.naves.push(new Nave(this.terrain, this.base));
    }
    for (let i = this.naves.length - 1; i >= 0; i--) {
      const n = this.naves[i];
      const fim = n.update(dt);
      if (fim === "caiu") {
        eventos.push({ kind: "explosion", p: [r(n.x), r(n.y), r(n.z)], r: M.ship.explosionRadius });
        this.matarNoRaio(jogadores, n, M.ship.explosionRadius, mortes, "explosion");
        this.naves.splice(i, 1);
      } else if (fim === "saiu") {
        this.naves.splice(i, 1);
      }
    }

    /* ------------------------------------------------------------- rover -- */
    this.rover?.update(dt);
    if (this.rover) {
      // Atropelamento: vale para todos ao mesmo tempo.
      for (const al of this.aliens) {
        if (al.dead) continue;
        if (Math.hypot(al.x - this.rover.x, al.z - this.rover.z) <= this.rover.contactRadius) {
          al.atingir();
        }
      }
    }

    /* -------------------------------------------------------- meteoritos -- */
    this.tMeteor -= dt;
    if (this.tMeteor <= 0 && this.meteors.length < M.meteors.max) {
      this.tMeteor = faixa(M.meteors.spawnMin, M.meteors.spawnMax);
      this.meteors.push(new Meteor(this.terrain, this.centro, this.terrain.radius ?? 165));
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const fim = this.meteors[i].update(dt);
      if (fim) this.meteors.splice(i, 1);
    }

    /* -------------------------------------------------------- estilhaços --
       Integrados AQUI só para decidir quem morre; o cliente integra a mesma
       conta para desenhar, a partir da semente que veio no evento. Nada de
       posição trafega. */
    const cfgM = M.meteors;
    const heightAt = (x, z) => this.terrain.heightAt(x, z);
    for (let i = this.estilhacos.length - 1; i >= 0; i--) {
      const f = this.estilhacos[i];
      if (passoEstilhaco(f, dt, M.gravity, heightAt, cfgM)) {
        this.estilhacos.splice(i, 1);
        continue;
      }
      if (!estilhacoLetal(f, cfgM)) continue;
      for (const j of jogadores) {
        if (!j.alive) continue;
        /* Contra o CAMINHO do pedaço neste passo, não contra o ponto em que ele
           parou: a 10 Hz um estilhaço rápido pula mais que o próprio raio de
           acerto, e o teste pontual deixava pedaços atravessarem o jogador
           entre dois quadros — era isso que fazia o estouro parecer inofensivo.

           O corpo tem 1,72 m: mede-se do pé ao peito, escolhendo a altura do
           tronco mais próxima do pedaço em vez do ponto do chão. */
        const alvoY = j.y + Math.max(0, Math.min(1.4, f.y - j.y));
        const d = distanciaSegmento(f, j.x, alvoY, j.z);
        if (d <= cfgM.fragKillRadius + f.raio + 0.4) {
          f.jaAcertou = true;
          mortes.push({ vitima: j.id, causa: "meteoro" });
          break;
        }
      }
      if (f.jaAcertou) continue;
      for (const al of this.aliens) {
        if (al.dead) continue;
        if (distanciaSegmento(f, al.x, al.y + 0.9, al.z) <= cfgM.fragKillRadius + f.raio + 0.5) {
          al.atingir();
          f.jaAcertou = true;
          break;
        }
      }
    }

    return { mortes, eventos };
  }

  /** Todo mundo dentro do raio morre. Devolve pelas `mortes`. */
  matarNoRaio(jogadores, centro, raio, mortes, causa) {
    for (const j of jogadores) {
      if (!j.alive) continue;
      if (Math.hypot(j.x - centro.x, j.y - centro.y, j.z - centro.z) <= raio) {
        mortes.push({ vitima: j.id, causa });
      }
    }
  }

  /**
   * Alguém acertou uma flecha em algo do espaço.
   *
   * Quem atira continua sendo a autoridade sobre o PRÓPRIO acerto (é o contrato
   * do jogo), mas quem decide se a nave caiu é a sala — ela é uma só para todo
   * mundo, e duas telas não podem discordar sobre uma nave que explodiu.
   *
   * @returns {{mortes:Array, eventos:Array}}
   */
  registrarAcerto(kind, id, jogadores) {
    const mortes = [];
    const eventos = [];
    const M = CONFIG.levels.moon;

    if (kind === "alien") {
      this.aliens.find((a) => a.id === id)?.atingir();
    } else if (kind === "ship") {
      this.naves.find((n) => n.id === id)?.abater();
    } else if (kind === "meteor") {
      const m = this.meteors.find((x) => x.id === id);
      if (m?.atingir()) {
        const seed = (Math.random() * 0xffffffff) >>> 0;
        eventos.push({
          kind: "meteorBurst",
          p: [r(m.x), r(m.y), r(m.z)],
          seed,
          r: M.meteors.explosionRadius,
        });
        this.matarNoRaio(jogadores, m, M.meteors.explosionRadius, mortes, "explosion");
        // Os MESMOS estilhaços que o cliente vai desenhar, pela mesma semente.
        this.estilhacos.push(
          ...criarEstilhacos({ x: m.x, y: m.y, z: m.z }, seed, M.meteors),
        );
      }
    }
    return { mortes, eventos };
  }

  /**
   * A amostra que vai para a rede.
   *
   * @param {boolean} [completo] inclui meteorito e rover. Ver o comentário
   *   abaixo: eles vão a 5 Hz, e a sala alterna.
   */
  view(completo = true) {
    if (!this.ativo) return { a: [], s: [], m: [], r: null };
    const saida = {
      a: this.aliens.map((x) => x.view()),
      s: this.naves.map((x) => x.view()),
    };
    /* Meteorito e rover só vão nas amostras PARES — 5 Hz em vez de 10.
     *
     * Não é para economizar banda por esporte: o pacote da Lua era 6,4 kB/s dos
     * 22,5 kB/s de uma sala de seis, e a maior parte dele era meteorito, que
     * anda de 1,2 a 2,6 m/s. Entre duas amostras a 10 Hz ele se desloca vinte
     * centímetros — e o cliente ainda amortece a pose por cima disso, então
     * metade dessas amostras não muda um pixel na tela. O rover é igualmente
     * previsível: circuito fechado, 3,6 m/s.
     *
     * Alien e nave continuam a 10 Hz, e é uma distinção de JOGO, não de custo:
     * alien mata de perto e nave é alvo em movimento. Nesses dois, atrasar cem
     * milissegundos é atrasar a informação que decide o golpe e o tiro.
     *
     * O campo AUSENTE não significa "lista vazia" — significa "sem notícia".
     * Quem lê (`SpaceLife.applyNetwork`) só reconcilia o que veio. */
    if (completo) {
      saida.m = this.meteors.map((x) => x.view());
      saida.r = this.rover?.view() ?? null;
    }
    return saida;
  }
}

const r = (v) => Math.round(v * 1000) / 1000;
