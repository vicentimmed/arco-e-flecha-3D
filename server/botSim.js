/* ---------------------------------------------------------------------------
   O adversário de CPU, no servidor.

   Ele deixou de ser local. Antes cada cliente hospedava os próprios bots, e isso
   tinha um limite óbvio: **ninguém mais os via**. Dois amigos na mesma sala
   jogavam contra adversários invisíveis um para o outro, o abate de um bot não
   existia para o placar de ninguém, e a flecha que um bot disparava não passava
   de pixel na tela de quem o hospedava.

   Aqui ele é o que sempre deveria ter sido: **um jogador da sala que não tem
   socket**. Nasce pelo mesmo contador de id, anda no mesmo `S2C.STATES`, atira
   pelo mesmo `S2C.SHOT` e morre pelo mesmo `S2C.KILL`. Nenhuma linha de cliente
   precisa saber que o atirador não era gente — e é justamente por isso que a
   migração coube em dois arquivos.

   ---------------------------------------------------------------- o que mudou

   A IA é a MESMA que rodava no cliente (`src/systems/bot.js`, agora apagado):
   perseguir uma faixa de distância, circundar, prever onde o alvo estará e
   resolver a elevação por iteração. O que saiu foi só o que não existe aqui:
   Three.js (vetores viraram `{x,y,z}` cru) e Rapier (a linha de visada virou
   amostragem do relevo, e a flecha é integrada à mão em `botArrow.js`).

   ------------------------------------------------------------------ a visada

   O servidor não tem malha nenhuma, mas TEM a lista de obstáculos: as posições
   de árvores e rochas foram extraídas para `shared/valleyProps.js`, que os dois
   lados importam. Sem ela o defeito seria pior do que a ausência de visada no
   cliente: em vez de cravar todas as flechas na mesma árvore, o bot passaria a
   acertar ATRAVÉS dela — injusto de um jeito que o jogador não consegue ler.

   A visada olha as duas coisas: o RELEVO (um morro entre os dois bloqueia, por
   amostragem de altura) e os TRONCOS (segmento contra cilindro).
   --------------------------------------------------------------------------- */

import { CONFIG, drawSpeed } from "../src/config.js";
import { levelPhysics } from "../src/shared/levels.js";
import { valleyBlockers } from "../src/shared/valleyProps.js";
import { moonBlockers } from "../src/shared/moonProps.js";
import { bloqueado } from "../src/shared/blockers.js";

/* Os obstáculos do vale, calculados uma vez por campo de altura.
   `valleyBlockers` refaz o sorteio inteiro; num teste de visada por quadro com
   seis bots isso seria absurdo. O cache é por terreno porque a fase troca. */
const blockersPorTerreno = new WeakMap();

export function obstaculosDe(terrain, levelId) {
  /* O vale tem vegetação; a Lua tem o FOGUETE.
     Ele não é "cenário esparso": é o ponto alto do mapa, o lugar que o jetpack
     existe para alcançar, e enquanto o servidor não o conhecia a flecha do bot
     atravessava o piso da plataforma e matava quem estava de pé em cima dela —
     de dentro do casco, inclusive. Ver `shared/moonProps.js`. */
  if (levelId !== "valley" && levelId !== "moon") return [];
  let lista = blockersPorTerreno.get(terrain);
  if (!lista) {
    lista = levelId === "moon" ? moonBlockers(terrain) : valleyBlockers(terrain);
    blockersPorTerreno.set(terrain, lista);
  }
  return lista;
}

const TAU = Math.PI * 2;

/**
 * Perícia padrão, caso `CONFIG.bot.difficulty` aponte para algo fora da tabela.
 * Rede de segurança, não o caminho normal: a dificuldade de verdade mora em
 * `CONFIG.bot.difficulties`.
 */
const PERICIA = {
  erroMira: 0.026,
  missChance: 0.62,
  missSpread: 7,
  reacao: 0.55,
  precisaoLead: 0.5,
  pausaChance: 0.55,
  pausaMin: 0.8,
  pausaMax: 1.6,
  avancoChance: 0.3,
  avancoIntervalo: 7,
  avancoMin: 3.0,
  avancoMax: 6.0,
  avancoMetros: 16,
};

function periciaAtual() {
  return CONFIG.bot?.difficulties?.[CONFIG.bot?.difficulty] ?? PERICIA;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Paleta dos bots — a mesma que o cliente usava, para nada mudar de cor. */
const CORES = ["#e0554a", "#4a9ee0", "#8ee04a", "#e0c24a", "#b44ae0", "#4ae0c2"];

export class Bot {
  /**
   * @param {number} id do MESMO contador dos jogadores humanos — é isso que faz
   *   `S2C.KILL { victim }` e o placar funcionarem sem nenhum caso especial
   * @param {object} terrain campo de altura da fase (`TerrainField`/`MoonField`)
   * @param {string} levelId
   */
  constructor(id, terrain, levelId, indice) {
    this.id = id;
    this.isBot = true;
    this.conn = null; // é o que impede o `broadcast` de tentar mandar pacote
    this.nome = `CPU ${indice}`;
    this.name = this.nome;
    this.color = CORES[(indice - 1) % CORES.length];
    this.terrain = terrain;
    this.levelId = levelId;
    this.pericia = { ...periciaAtual() };

    /* ------------------------------------------------- pose (packState) --
       Estes campos existem com estes nomes porque `packState(obj)` é uma função
       PURA que os lê — o bot produz a pose de rede sem adaptador nenhum. */
    this.position = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.gaitPhase = 0;
    this.gaitBlend = 0;
    this.runBlend = 0;
    this.drawFraction = 0;
    this.reloadFraction = 0;
    this.knifeFraction = 0;
    this.moveF = 0;
    this.moveS = 0;
    this.airborne = false;
    this.jetFlame = 0;

    /* ------------------------------------------------------ estado de sala -- */
    this.score = { kills: 0, deaths: 0, boars: 0, elks: 0, elkHits: 0, birds: 0, targets: 0, points: 0 };
    this.alive = true;
    this.invulnUntil = 0;
    this.state = null;
    this.stateTime = 0;
    this.duelReady = false;

    /* ----------------------------------------------------------- IA ------- */
    this.drawTime = 0;
    this.recarga = 0;
    this.reagirEm = 0;
    this.tempoNoDestino = 0;
    this.ladoStrafe = 1;
    this.bloqueado = false;
    this.pulaEm = 1 + Math.random() * 3;
    this.velY = 0;
    this.noChao = true;
    this._andando = false;

    // Comportamento do bot fácil: parar para mirar, e avançar de vez em quando.
    this.pausaT = 0;
    this.avancoT = 0;
    this.avancoSorteioEm = Math.random() * (this.pericia.avancoIntervalo ?? 8);
    this._decidiuPausa = false;

    this._ultimoAlvo = { x: 0, y: 0, z: 0 };
    this._velAlvo = { x: 0, y: 0, z: 0 };
    this._muzzle = { x: 0, y: 0, z: 0 };
    this._mira = { x: 0, y: 0, z: 0 };
  }

  get fisica() {
    return levelPhysics(this.levelId);
  }

  /**
   * O ponto de disparo.
   *
   * No cliente ele saía da POSTURA do boneco (`player.getMuzzle`), que resolve
   * IK de dois ossos. Aqui não há boneco, então é uma aproximação: altura do
   * ombro, 30 cm à frente ao longo da mira. A diferença para o muzzle real é de
   * centímetros e não muda a balística — o que ela mudaria é a estética de onde
   * a flecha nasce, e essa quem desenha é o cliente.
   */
  atualizarMuzzle() {
    const cp = Math.cos(this.pitch);
    const dx = -Math.sin(this.yaw) * cp;
    const dz = -Math.cos(this.yaw) * cp;
    this._muzzle.x = this.position.x + dx * 0.3;
    this._muzzle.y = this.position.y + 1.42;
    this._muzzle.z = this.position.z + dz * 0.3;
  }

  /* ---------------------------------------------------------------- vida -- */

  renascer(x, z) {
    this.alive = true;
    this.position.x = x;
    this.position.z = z;
    this.position.y = this.terrain.heightAt(x, z);
    this.velY = 0;
    this.noChao = true;
    this.drawTime = 0;
    this.drawFraction = 0;
    this.recarga = 0;
    this.pausaT = 0;
    this.avancoT = 0;
    this._decidiuPausa = false;
  }

  relevel(terrain, levelId) {
    this.terrain = terrain;
    this.levelId = levelId;
  }

  /* --------------------------------------------------------------- laço --- */

  /**
   * @param {number} dt
   * @param {Array<{id:number, alive:boolean, position:{x,y,z}}>} alvos todo mundo
   *   com corpo em campo, o próprio bot incluído (ele se filtra pelo id)
   * @param {Array<object>} bichos porcos, alces e zumbis vivos — ver `Room.botPrey`
   * @returns {object|null} um tiro a disparar, ou null
   */
  update(dt, alvos, bichos = []) {
    if (!this.alive) return null;

    const alvo = this.escolherAlvo(alvos);
    this.mover(dt, alvo);
    this.gravidade(dt);

    const alvoTiro = this.escolherAlvoDeTiro(alvos, bichos);
    if (!alvoTiro) {
      this.drawTime = 0;
      this.drawFraction = 0;
      return null;
    }
    return this.mirarEAtirar(dt, alvoTiro);
  }

  /**
   * O adversário mais próximo.
   *
   * `semFogoAmigo` liga no duelo de times: lá os bots são UM TIME, e um time
   * que se mata sozinho não é adversário de ninguém — no primeiro teste eles
   * abriram o placar entre si antes de qualquer pessoa atirar. Fora do modo de
   * times eles continuam caçando uns aos outros, que é o que torna dois bots
   * numa sala vazia uma demonstração da IA.
   */
  escolherAlvo(alvos) {
    let melhor = null;
    let melhorD = Infinity;
    for (const e of alvos) {
      if (!e || e.id === this.id || !e.alive) continue;
      if (this.semFogoAmigo && e.isBot) continue;
      const d = dist2(e.position, this.position);
      if (d < melhorD) {
        melhorD = d;
        melhor = e;
      }
    }
    return melhor;
  }

  /**
   * Em quem ATIRAR — que não é necessariamente para quem se posicionar.
   *
   * Separar as duas perguntas é o que permite o bot dar um tiro no porco que
   * passou sem largar a órbita do duelo: o MOVIMENTO continua governado pelo
   * adversário mais próximo, e só a MIRA considera bicho. O bicho entra com uma
   * penalidade de distância, então só é escolhido quando está claramente mais
   * perto que qualquer adversário.
   *
   * PÁSSAROS FICAM DE FORA (ver `Room.botPrey`): alvo pequeno, alto e em
   * movimento — o bot passaria o duelo de cabeça erguida mirando o céu, e um
   * adversário distraído por pardais não é adversário.
   */
  escolherAlvoDeTiro(alvos, bichos) {
    let melhor = this.escolherAlvo(alvos);
    let melhorD = melhor ? dist2(melhor.position, this.position) : Infinity;

    const penal = (CONFIG.bot?.creaturePenalty ?? 1.8) ** 2;
    for (const c of bichos) {
      const d = dist2(c, this.position) * penal;
      if (d < melhorD) {
        melhorD = d;
        melhor = { position: c, isCreature: true, kind: c.kind, id: c.id, alive: true };
      }
    }
    return melhor;
  }

  /* --------------------------------------------------------- locomoção --- */

  /**
   * O bot pode pisar aqui?
   *
   * É o `isWalkable` do terreno MAIS a coleira: o jogador humano pode subir a
   * serra se quiser (é o cenário dele), mas um adversário que sobe some do
   * duelo — e um duelo que acontece onde ninguém vê não é um duelo. Na Lua o
   * limite não muda nada: lá `arenaDistance` já é negativo em toda a arena e a
   * barreira circular resolve sozinha.
   */
  podeAndar(x, z) {
    if (!this.terrain.isWalkable(x, z)) return false;
    const limite = CONFIG.bot?.leash ?? 12;
    return (this.terrain.arenaDistance?.(x, z) ?? -Infinity) <= limite;
  }

  mover(dt, alvo) {
    this._andando = false;
    this.gaitBlend = 0;
    if (!alvo) return;

    const p = this.position;

    /* PARADO PARA MIRAR. Ele continua girando o corpo para o alvo — o que para
       são os PÉS. Um bot que atira em movimento o tempo todo lê como máquina;
       parar é o que um jogador iniciante faz, e é também o que o torna um alvo,
       que é o outro lado do trato. */
    this.pausaT = Math.max(0, this.pausaT - dt);
    if (this.pausaT > 0) return;

    /* AVANÇO. De vez em quando ele encurta a distância ideal e vem para cima,
       em vez de circular eternamente na mesma órbita. */
    this.avancoT = Math.max(0, this.avancoT - dt);
    this.avancoSorteioEm -= dt;
    if (this.avancoSorteioEm <= 0) {
      this.avancoSorteioEm = this.pericia.avancoIntervalo ?? 8;
      if (this.avancoT <= 0 && Math.random() < (this.pericia.avancoChance ?? 0)) {
        const min = this.pericia.avancoMin ?? 3;
        const max = this.pericia.avancoMax ?? 6;
        this.avancoT = min + Math.random() * (max - min);
      }
    }

    /* Já está fora da coleira: o único objetivo é voltar. Sem este caso, o
       strafe o joga contra o limite e ele fica vibrando lá em cima. */
    const fora = (this.terrain.arenaDistance?.(p.x, p.z) ?? -Infinity) > (CONFIG.bot?.leash ?? 12);
    if (fora) {
      const c = this.terrain.spawnCenter ?? { x: CONFIG.spawn.centerX, z: CONFIG.spawn.centerZ };
      const vx0 = c.x - p.x;
      const vz0 = c.z - p.z;
      const m0 = Math.hypot(vx0, vz0) || 1;
      const passo0 = CONFIG.player.walkSpeed * dt;
      p.x += (vx0 / m0) * passo0;
      p.z += (vz0 / m0) * passo0;
      this._andando = true;
      this.gaitBlend = 1;
      this.gaitPhase = (this.gaitPhase + (passo0 / CONFIG.gait.strideLength) * TAU) % TAU;
      return;
    }

    const dx = alvo.position.x - p.x;
    const dz = alvo.position.z - p.z;
    const dist = Math.hypot(dx, dz) || 1;

    const encolhe = this.avancoT > 0 ? (this.pericia.avancoMetros ?? 0) : 0;
    const IDEAL_MIN = Math.max(8, 34 - encolhe);
    const IDEAL_MAX = Math.max(IDEAL_MIN + 12, 62 - encolhe);

    let vx = 0;
    let vz = 0;
    if (dist > IDEAL_MAX) {
      vx = dx / dist;
      vz = dz / dist;
    } else if (dist < IDEAL_MIN) {
      vx = -dx / dist;
      vz = -dz / dist;
    } else {
      /* Na faixa boa: circunda. O lado é sorteado e SUSTENTADO por alguns
         segundos — trocar a cada quadro daria um boneco vibrando no lugar, que
         não engana ninguém e ainda é impossível de acertar por acidente. */
      this.tempoNoDestino -= dt;
      if (this.tempoNoDestino <= 0) {
        this.ladoStrafe = Math.random() < 0.5 ? 1 : -1;
        this.tempoNoDestino = 1.4 + Math.random() * 2.2;
      }
      vx = (-dz / dist) * this.ladoStrafe;
      vz = (dx / dist) * this.ladoStrafe;

      /* Sem visada, ele CIRCUNDA MAIS DEPRESSA e não fica trocando de lado.
         Parado atrás do mesmo morro, a mira nunca abriria. */
      if (this.bloqueado) {
        this.tempoNoDestino = Math.max(this.tempoNoDestino, 1.2);
        vx *= 1.6;
        vz *= 1.6;
      }
    }

    const passo = CONFIG.player.walkSpeed * dt;
    const nx = p.x + vx * passo;
    const nz = p.z + vz * passo;
    if (this.podeAndar(nx, nz)) {
      p.x = nx;
      p.z = nz;
      this._andando = true;
    } else {
      // Bateu no limite: inverte o lado em vez de ficar raspando nele.
      this.ladoStrafe = -this.ladoStrafe;
    }

    /* O PULO. Não é enfeite: um alvo que muda de altura de repente estraga a
       solução balística de quem está mirando nele, e é a única defesa que
       existe contra uma flecha já no ar. */
    this.pulaEm -= dt;
    if (this.pulaEm <= 0 && this.noChao) {
      this.pulaEm = 2.5 + Math.random() * 4;
      this.velY = this.fisica.jumpSpeed;
      this.noChao = false;
    }

    this.gaitBlend = this._andando && this.noChao ? 1 : 0;
    if (this.gaitBlend) {
      this.gaitPhase = (this.gaitPhase + (passo / CONFIG.gait.strideLength) * TAU) % TAU;
    }
  }

  gravidade(dt) {
    const p = this.position;
    const chao = this.terrain.heightAt(p.x, p.z);
    if (!this.noChao) {
      this.velY += this.fisica.gravity * dt;
      p.y += this.velY * dt;
      if (p.y <= chao) {
        p.y = chao;
        this.velY = 0;
        this.noChao = true;
      }
    } else {
      p.y = chao;
    }
    this.airborne = !this.noChao;
  }

  /* -------------------------------------------------------------- mira --- */

  /**
   * Onde o alvo VAI ESTAR quando a flecha chegar.
   *
   * Equação implícita: o tempo de voo depende da distância, que depende de para
   * onde ele foi, que depende do tempo. Três iterações convergem de sobra nas
   * distâncias deste jogo.
   */
  mirarComLead(alvo, v, out) {
    /* MIRA NO PEITO, não nos pés. `position` é o chão sob o personagem; mirar
       ali manda a flecha para a base da cápsula, onde ela crava no chão a um
       passo do alvo. Bicho é mais baixo que gente — mirar no peito de um humano
       passa por cima de um porco. */
    const altura = alvo.isCreature ? 0.55 : 1.15;
    let t = 0;
    for (let i = 0; i < 3; i++) {
      out.x = alvo.position.x + this._velAlvo.x * t * this.pericia.precisaoLead;
      out.y = alvo.position.y + altura + this._velAlvo.y * t * this.pericia.precisaoLead;
      out.z = alvo.position.z + this._velAlvo.z * t * this.pericia.precisaoLead;
      t = distancia(this._muzzle, out) / v;
    }
    return t;
  }

  /**
   * O ângulo de elevação que compensa a queda.
   *
   * A conta fechada só vale sem arrasto. Em vez de escolher uma fórmula que só
   * serve metade das vezes, o bot faz o que um arqueiro faz: chuta, vê onde
   * cairia, corrige. O arrasto entra como encurtamento da velocidade média — no
   * vácuo lunar `airDensity` é zero e o fator vira 1, então a mesma linha serve
   * para as duas fases.
   */
  elevacaoPara(distH, alturaRel, v) {
    const g = -this.fisica.gravity;
    const ar = this.fisica.airDensity / 1.225;
    const vEf = v * (1 - 0.11 * ar * Math.min(1, distH / 100));

    let ang = Math.atan2(alturaRel, distH);
    for (let i = 0; i < 4; i++) {
      const t = distH / Math.max(1e-3, vEf * Math.cos(ang));
      const queda = 0.5 * g * t * t;
      ang = Math.atan2(alturaRel + queda, distH);
    }
    return ang;
  }

  /**
   * Há caminho livre do arco até este ponto?
   *
   * Duas perguntas com respostas de naturezas diferentes. O RELEVO é resolvido
   * por amostragem de altura ao longo da reta — se em algum ponto o chão está
   * acima da trajetória, há morro no meio. Os TRONCOS e as ROCHAS são um teste
   * de segmento contra cilindro, com a lista compartilhada de
   * `shared/valleyProps.js`.
   */
  temVisada(alvoPonto) {
    if (bloqueado(obstaculosDe(this.terrain, this.levelId), this._muzzle, alvoPonto)) {
      return false;
    }
    const dx = alvoPonto.x - this._muzzle.x;
    const dy = alvoPonto.y - this._muzzle.y;
    const dz = alvoPonto.z - this._muzzle.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-3) return true;

    // Um passo a cada ~4 m: fino o bastante para achar um cume, barato o
    // bastante para rodar a cada quadro com seis bots em campo.
    const passos = Math.min(48, Math.max(4, Math.ceil(d / 4)));
    for (let i = 1; i < passos; i++) {
      const f = i / passos;
      const x = this._muzzle.x + dx * f;
      const y = this._muzzle.y + dy * f;
      const z = this._muzzle.z + dz * f;
      // 0,6 m de folga: a flecha passa rente ao chão sem que isso conte como
      // bloqueio, que é o que acontece num tiro rasante legítimo.
      if (this.terrain.heightAt(x, z) > y + 0.6) return false;
    }
    return true;
  }

  mirarEAtirar(dt, alvo) {
    // Velocidade do alvo, MEDIDA — não recebida. É o que um jogador faz.
    const inv = 1 / Math.max(dt, 1e-4);
    this._velAlvo.x = (alvo.position.x - this._ultimoAlvo.x) * inv;
    this._velAlvo.y = (alvo.position.y - this._ultimoAlvo.y) * inv;
    this._velAlvo.z = (alvo.position.z - this._ultimoAlvo.z) * inv;
    if (
      this._velAlvo.x ** 2 + this._velAlvo.y ** 2 + this._velAlvo.z ** 2 > 900
    ) {
      this._velAlvo.x = this._velAlvo.y = this._velAlvo.z = 0; // teleporte
    }
    this._ultimoAlvo.x = alvo.position.x;
    this._ultimoAlvo.y = alvo.position.y;
    this._ultimoAlvo.z = alvo.position.z;

    this.recarga = Math.max(0, this.recarga - dt);
    this.reagirEm -= dt;
    this.atualizarMuzzle();

    // Tensiona até uma força escolhida pela distância: tiro curto não precisa
    // de tensão máxima, e tensão máxima demora quase dois segundos.
    const distBruta = distancia(this._muzzle, alvo.position);
    const tensaoAlvo = clamp(distBruta / 110, 0.35, 1) * CONFIG.bow.fullDrawTime;

    if (this.recarga > 0) {
      this.drawTime = 0;
    } else {
      this.drawTime = Math.min(this.drawTime + dt, CONFIG.bow.fullDrawTime);

      /* A parada é decidida NO MEIO do tensionamento, e uma vez só por tiro: no
         começo ele ainda não sabe se vai atirar, e no fim já seria tarde para a
         parada significar alguma coisa. */
      if (this.drawTime > tensaoAlvo * 0.5) {
        if (!this._decidiuPausa && Math.random() < (this.pericia.pausaChance ?? 0)) {
          const min = this.pericia.pausaMin ?? 0.6;
          const max = this.pericia.pausaMax ?? 1.2;
          this.pausaT = min + Math.random() * (max - min);
        }
        this._decidiuPausa = true;
      }
    }
    this.drawFraction = this.drawTime / CONFIG.bow.fullDrawTime;

    const v = drawSpeed(this.drawTime);
    this.mirarComLead(alvo, v, this._mira);

    const dx = this._mira.x - this._muzzle.x;
    const dy = this._mira.y - this._muzzle.y;
    const dz = this._mira.z - this._muzzle.z;
    const distH = Math.hypot(dx, dz);

    /* O SINAL importa e já custou uma sessão de tiros a esmo. A mira do jogo é
       `(-sen y·cos p, sen p, -cos y·cos p)` — ver `AimSolver.axisFrom`. Com o
       yaw pela convenção "normal" (`atan2(x, z)`), o bot aponta o corpo para um
       lado e manda a flecha para o oposto. */
    const yawAlvo = Math.atan2(-dx, -dz);
    const pitchAlvo = this.elevacaoPara(distH, dy, v);

    // O giro tem VELOCIDADE FINITA. Um bot que encara instantaneamente é
    // impossível de flanquear, e flanquear é o que se faz num duelo.
    const giroMax = 2.6 * dt;
    let dYaw = yawAlvo - this.yaw;
    while (dYaw > Math.PI) dYaw -= TAU;
    while (dYaw < -Math.PI) dYaw += TAU;
    const dPitch = pitchAlvo - this.pitch;

    this.yaw += clamp(dYaw, -giroMax, giroMax);
    this.pitch = clamp(
      this.pitch + clamp(dPitch, -giroMax, giroMax),
      CONFIG.player.pitchMin,
      CONFIG.player.pitchMax,
    );

    if (this.recarga > 0 || this.drawTime < tensaoAlvo) return null;
    if (this.reagirEm > 0) return null;

    /* LINHA DE VISADA. Sem isto o bot é excelente e inútil: a balística
       resolvida ao centímetro só garante que a flecha acerte o morro na frente
       dele com precisão. Bloqueado, ele guarda o tiro e continua circundando —
       que é exatamente o que resolve a situação. */
    if (!this.temVisada(this._mira)) {
      this.bloqueado = true;
      return null;
    }
    this.bloqueado = false;

    /* SÓ ATIRA COM OS DOIS ÂNGULOS NO LUGAR. Exigir só o yaw deixava a flecha
       sair enquanto a ELEVAÇÃO ainda subia — e a elevação é justamente o que
       compensa a queda. A tolerância de 0,01 rad vale ~45 cm a 45 m. */
    if (Math.abs(dYaw) > 0.01 || Math.abs(dPitch) > 0.01) return null;

    return this.atirar(v);
  }

  /** Devolve o descritor do tiro; quem cria a flecha é a sala. */
  atirar(v) {
    this.atualizarMuzzle();

    /* A mão do bot treme: é este desvio que separa um treino de um carrasco.
       `missChance` decide se ESTE tiro sai deliberadamente torto (ampliado por
       `missSpread`) — a "porcentagem de errar o tiro". O tremor de `erroMira`
       sozinho continua presente mesmo quando ele não erra de propósito: é o
       "atirar certeiro" da dificuldade, e nunca chega a zero. */
    const errouDeProposito = Math.random() < (this.pericia.missChance ?? 0);
    const e = this.pericia.erroMira * (errouDeProposito ? this.pericia.missSpread ?? 1 : 1);
    const yaw = this.yaw + (Math.random() - 0.5) * 2 * e;
    const pitch = this.pitch + (Math.random() - 0.5) * 2 * e;

    const cp = Math.cos(pitch);
    const dir = {
      x: -Math.sin(yaw) * cp,
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * cp,
    };

    this.drawTime = 0;
    this.drawFraction = 0;
    /* A recarga dele acompanha a do jogador, e a folga também encolheu junto
       (0,35 → 0,18 s): a folga existe para o bot não sacar mais rápido que uma
       pessoa, e mantê-la inteira depois de cortar `reloadTime` pela metade
       deixaria o adversário num ritmo antigo enquanto o jogador atira no dobro
       da cadência. */
    this.recarga = CONFIG.bow.reloadTime + 0.18;
    this.reagirEm = this.pericia.reacao;
    this._decidiuPausa = false;

    return {
      origem: {
        x: this._muzzle.x + dir.x * 0.3,
        y: this._muzzle.y + dir.y * 0.3,
        z: this._muzzle.z + dir.z * 0.3,
      },
      direcao: dir,
      velocidade: v,
    };
  }
}

/* ---------------------------------------------------------------- coleção -- */

export class BotSquad {
  constructor(terrain, levelId) {
    this.terrain = terrain;
    this.levelId = levelId;
    /** @type {Bot[]} */
    this.list = [];
    this.contador = 0;
  }

  get count() {
    return this.list.length;
  }

  /**
   * @param {number} id vindo do contador de jogadores da sala
   * @param {Array<{x:number,z:number}>} ocupados para não nascer em cima de ninguém
   */
  add(id, ocupados = []) {
    if (this.list.length >= (CONFIG.bot?.maxBots ?? 6)) return null;
    this.contador++;
    const bot = new Bot(id, this.terrain, this.levelId, this.contador);

    // Nasce no anel de duelo da fase, longe de quem já está em campo.
    const c = this.terrain.spawnCenter ?? { x: CONFIG.spawn.centerX, z: CONFIG.spawn.centerZ };
    const raio = this.terrain.spawnCenter
      ? CONFIG.levels.moon.duel.ringRadius
      : CONFIG.modes.duel.ringRadius;
    let melhor = null;
    let melhorD = -1;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * TAU;
      const x = c.x + Math.cos(a) * raio;
      const z = c.z + Math.sin(a) * raio;
      if (!this.terrain.isWalkable(x, z)) continue;
      let d = Infinity;
      for (const o of ocupados) d = Math.min(d, Math.hypot(x - o.x, z - o.z));
      if (d > melhorD) {
        melhorD = d;
        melhor = { x, z };
      }
    }
    const ponto = melhor ?? { x: c.x + raio, z: c.z };
    bot.renascer(ponto.x, ponto.z);

    this.list.push(bot);
    return bot;
  }

  removeLast() {
    return this.list.pop() ?? null;
  }

  clear() {
    const saindo = this.list;
    this.list = [];
    this.contador = 0;
    return saindo;
  }

  byId(id) {
    return this.list.find((b) => b.id === id) ?? null;
  }

  relevel(terrain, levelId) {
    this.terrain = terrain;
    this.levelId = levelId;
    const c = terrain.spawnCenter ?? { x: CONFIG.spawn.centerX, z: CONFIG.spawn.centerZ };
    const raio = terrain.spawnCenter
      ? CONFIG.levels.moon.duel.ringRadius
      : CONFIG.modes.duel.ringRadius;
    for (const b of this.list) {
      b.relevel(terrain, levelId);
      const a = Math.random() * TAU;
      b.renascer(c.x + Math.cos(a) * raio, c.z + Math.sin(a) * raio);
    }
  }

  /**
   * Troca a perícia de todos, e a dos que ainda vão nascer.
   *
   * Escreve em `CONFIG.bot.difficulty` de propósito: é de lá que `periciaAtual`
   * lê, então o bot criado depois já nasce no nível novo sem ninguém ter de
   * lembrar de passá-lo. Como os bots vivem todos aqui, a troca vale para a
   * sala inteira no mesmo instante — que é o que "em tempo real para todos"
   * quer dizer.
   */
  setDifficulty(nome) {
    const tabela = CONFIG.bot?.difficulties ?? {};
    if (!tabela[nome]) return CONFIG.bot.difficulty;
    CONFIG.bot.difficulty = nome;
    for (const b of this.list) b.pericia = { ...tabela[nome] };
    return nome;
  }

  cycleDifficulty(passo = 1) {
    const nomes = Object.keys(CONFIG.bot?.difficulties ?? {});
    if (!nomes.length) return CONFIG.bot?.difficulty;
    const i = nomes.indexOf(CONFIG.bot.difficulty);
    return this.setDifficulty(nomes[(i + passo + nomes.length) % nomes.length]);
  }

  /**
   * @param {boolean} semFogoAmigo no duelo de times os bots são um time só
   * @returns {Array<{bot: Bot, tiro: object}>} os tiros deste passo
   */
  update(dt, alvos, bichos, semFogoAmigo = false) {
    const tiros = [];
    for (const b of this.list) {
      b.semFogoAmigo = semFogoAmigo;
      const tiro = b.update(dt, alvos, bichos);
      if (tiro) tiros.push({ bot: b, tiro });
    }
    return tiros;
  }
}

/* ------------------------------------------------------------------ util -- */

function dist2(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function distancia(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
