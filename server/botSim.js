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
import { DEFAULT_SKIN } from "../src/shared/skins.js";
import { levelPhysics } from "../src/shared/levels.js";
import { valleyBlockers } from "../src/shared/valleyProps.js";
import { moonBlockers } from "../src/shared/moonProps.js";
import { castleBlockers } from "../src/shared/castleProps.js";
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
  /* E o CASTELO tem 34 m de muro e uma fileira de merlões.
     Aqui o buraco seria maior que o do foguete lunar: sem esta lista, a flecha
     de um arqueiro de muralha sai do adarve, atravessa o próprio merlão à
     frente dele e ainda passa pelo portão que os dois lados estão disputando —
     e o xamã lá embaixo acerta quem está agachado atrás da pedra. A cobertura
     do modo É esta lista. Ver `shared/castleProps.js`. */
  if (levelId !== "valley" && levelId !== "moon" && levelId !== "castle") return [];
  let lista = blockersPorTerreno.get(terrain);
  if (!lista) {
    lista =
      levelId === "moon"
        ? moonBlockers(terrain)
        : levelId === "castle"
          ? castleBlockers()
          : valleyBlockers(terrain);
    blockersPorTerreno.set(terrain, lista);
  }
  return lista;
}

const TAU = Math.PI * 2;

/**
 * Giro do bot antiaéreo, em rad/s.
 *
 * O duelista gira a 2,6 rad/s de propósito: um adversário que encara
 * instantaneamente é impossível de flanquear, e flanquear é o que se faz num
 * duelo. Aqui não há ninguém para flanquear — ele é uma peça de artilharia
 * parada olhando para o céu, e o alvo atravessa o campo de visão a até 21 m/s.
 * Com 2,6 ele gastava meio ciclo de tiro só girando o tronco.
 */
const GIRO_ANTIAEREO = 5.0;

/** Reaproveitado por `Bot.pedraNaFrente`: ele roda por candidato, por quadro. */
const _alvoTmp = { x: 0, y: 0, z: 0 };

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

/* Paleta dos bots. Sem rosa, lilás ou magenta — mesmo critério de
   `server/colors.js`, que tem a explicação completa. Um roxo/violeta legítimo
   (como o `roxo` da paleta principal) ainda entraria; o que saiu foi a cor
   antiga daqui, um tom bem mais para o lado do magenta. */
const CORES = ["#e0554a", "#4a9ee0", "#8ee04a", "#e0c24a", "#4ad97a", "#4ae0c2"];

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
    /* O corpo do bot é o mesmo de todo mundo. `publicView` (em `room.js`) manda
       este campo para os clientes como manda o de qualquer jogador — bot não
       tem caminho próprio. */
    this.skin = DEFAULT_SKIN;
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

    /** A rocha em que ele se comprometeu — ver `escolherRocha`. */
    this._rochaId = null;
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

  renascer(x, z, floorY = null) {
    this.alive = true;
    this.floorY = floorY;
    this.position.x = x;
    this.position.z = z;
    this.position.y = floorY ?? this.terrain.heightAt(x, z);
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
    /* O piso declarado é do ADARVE de uma fase específica. Levá-lo para outra
       deixaria o bot pairando a onze metros do vale. */
    this.floorY = null;
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
  /**
   * @param {{x:number,z:number}|null} [objetivo] um ponto que vale MAIS que o
   *   duelo: hoje só a bandeira e a base inimiga (`captureFlag`). Sem ele o bot
   *   faz o que sempre fez — orbitar o adversário mais próximo.
   */
  update(dt, alvos, bichos = [], objetivo = null) {
    if (!this.alive) return null;

    this.objetivo = objetivo;
    const alvo = this.escolherAlvo(alvos);
    /* POSTADO: o arqueiro de muralha não anda.
     *
     * Ele não tem para onde ir — o adarve tem 2,6 m de largura útil e um passo
     * para o lado errado é uma queda de onze metros dentro da fila. E o modo
     * não pede deslocamento nenhum dele: pede uma flecha a cada dois segundos
     * no que estiver mais perto do portão. É a mesma economia de `soPresas`,
     * que já desliga a outra metade da IA na chuva de meteoros. */
    if (!this.postado) this.mover(dt, alvo);
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
    /* SÓ PRESAS: o bot é artilharia antiaérea e mais nada.
     *
     * Devolver null aqui tira o alvo das DUAS perguntas de uma vez — para onde
     * andar e em quem atirar —, e é isso que o modo pede: ele não persegue
     * ninguém, fica no posto e olha para cima. É a primeira das três camadas
     * que impedem um bot de matar um jogador (ver `Room.dispararDoBot` para a
     * segunda, que é a que realmente garante). */
    if (this.soPresas) return null;

    let melhor = null;
    let melhorD = Infinity;
    for (const e of alvos) {
      if (!e || e.id === this.id || !e.alive) continue;
      /* MESMO TIME NÃO É ALVO.
       *
       * A regra era `semFogoAmigo && e.isBot`, e ela dizia "não atire em quem é
       * CPU". Isso funcionou enquanto time e espécie eram a mesma coisa; no
       * rouba bandeira deixaram de ser — os lados agora se equilibram por
       * cabeça, humano ou não —, e a regra antiga fazia o bot atirar no
       * companheiro humano que corre com a bandeira ao lado dele.
       *
       * Quando a sala declara o time (`characterViews`), é ele que manda; sem
       * declaração, o comportamento antigo continua valendo palavra por palavra
       * para o duelo de times. */
      if (this.time && e.time) {
        if (e.time === this.time) continue;
      } else if (this.semFogoAmigo && e.isBot) continue;
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
    /* ARTILHARIA ANTIAÉREA é outra pergunta, e por isso é outro método.
       O duelista escolhe o alvo mais PERTO; o antiaéreo escolhe o que está
       prestes a encostar no chão, e não larga dele no meio do tensionamento. */
    if (this.antiaereo) return this.escolherRocha(bichos);

    let melhor = this.escolherAlvo(alvos);
    let melhorD = melhor ? dist2(melhor.position, this.position) : Infinity;

    /* A penalidade de distração existe para o bot não largar o duelo por causa
       de um javali. Onde a distração É o trabalho (a chuva), ela não faz
       sentido: sem alvo humano nenhum, penalizar a presa só a afastaria de si
       mesma. */
    const penal = this.soPresas ? 1 : (CONFIG.bot?.creaturePenalty ?? 1.8) ** 2;
    for (const c of bichos) {
      if (!this.podeEngajar(c)) continue;
      /* A FRENTE DELE, e não o mais perto do mundo.
       *
       * Um arqueiro POSTADO não pode se deslocar, e atirar 45° para o lado ao
       * longo de uma muralha ameiada é atirar no próximo merlão — é o que a
       * geometria diz e é o que `temVisada` recusa, corretamente. Sem esta
       * preferência ele escolhia o alvo mais próximo em linha reta, que quase
       * sempre estava atrás de pedra, e passava a partida inteira de arco
       * tensionado sem soltar uma flecha.
       *
       * A penalidade é suave (cresce com o cosseno) em vez de um corte seco:
       * assim ele ainda cobre o flanco quando não há nada à frente, que é o
       * que um jogador faria. */
      /* Alvo atrás de pedra nem entra no páreo.
       *
       * Só o teste de CAIXA (`bloqueado`), não o `temVisada` inteiro: este roda
       * uma vez por candidato por quadro, e a amostragem de relevo dele custa
       * até 48 consultas de altura. A pedra é o que decide aqui — o relevo
       * fica para a checagem final, antes de soltar a corda.
       *
       * Sem isto o arqueiro postado escolhia o aglomerado do portão, que para
       * ele estava atrás do próprio merlão, e ficava travado: 26 tiros em três
       * minutos, quando o ciclo dele é de dois segundos. */
      if (this.postado && this.pedraNaFrente(c)) continue;
      /* PRIORIDADE FURA A FILA, e fura a penalidade de setor junto.
       *
       * Quem a declara é o que mata gente e chega por onde o posto não olha: o
       * escalador agarrado ao muro e o morcego em cima da cabeça (ver
       * `Room.botPrey`). Multiplicar a distância por 0,2 faz um morcego a 30 m
       * competir como se estivesse a 6; e ignorar `penalidadeDeSetor` é o que
       * permite ao arqueiro VIRAR — a frente do posto é uma regra de tiro na
       * rampa, e nem o muro ao lado nem o céu acima têm frente. */
      const urgente = (c.prioridade ?? 1) < 1;
      const setor = urgente ? 1 : this.penalidadeDeSetor(c);
      const d = dist2(c, this.position) * penal * setor * (c.prioridade ?? 1) ** 2;
      if (d < melhorD) {
        melhorD = d;
        melhor = {
          position: c,
          isCreature: true,
          kind: c.kind,
          id: c.id,
          alive: true,
          // Onde mirar no corpo. Um porco tem a posição na pata e pede 0,55 m
          // acima; uma rocha TEM a posição no centro e pede zero.
          aimY: c.aimY,
          raio: c.r,
        };
      }
    }
    return melhor;
  }

  /**
   * A rocha em que este bot vai gastar a próxima flecha.
   *
   * Três decisões, e cada uma conserta um defeito medido em campo:
   *
   * • **COMPROMISSO.** Ele não troca de pedra no meio do tensionamento. A
   *   escolha do duelista é refeita a cada quadro, e num céu com seis rochas
   *   descendo a "mais próxima" muda sozinha o tempo todo: o bot recomeçava a
   *   mira a cada troca, os ângulos nunca chegavam na tolerância de disparo, e
   *   ele passava a horda inteira de arco tensionado com a mira oscilando. É
   *   exatamente o que se via na tela — muito tempo mirando, quase nenhum tiro.
   *   Pior ainda em silêncio: `_ultimoAlvo` é um slot só, então a cada troca a
   *   velocidade medida do alvo era o salto de uma rocha para a outra, ou seja,
   *   lixo, e a liderança de tiro saía junto.
   *
   * • **URGÊNCIA, não proximidade.** O que decide a partida é a rocha que vai
   *   encostar primeiro. `prazo` vem da sala e é literalmente isso: segundos
   *   até o chão. O giro entra como preço em segundos, senão ele atravessa o
   *   céu inteiro atrás de uma pedra que outro já vai pegar.
   *
   * • **PEDRA JÁ COBERTA NÃO ENTRA.** `left` chega descontado das flechas de
   *   bot ainda em voo (ver `Room.botPrey`). Sem isso, três bots gastavam três
   *   flechas na mesma rocha de um acerto e a horda passava por cima deles.
   */
  escolherRocha(bichos) {
    if (this._rochaId != null) {
      const atual = bichos.find((c) => c.id === this._rochaId && c.kind === "meteor");
      if (atual && (atual.left ?? 1) > 0 && this.podeEngajar(atual)) return this.presa(atual);
      /* Perdeu o alvo — estourou, encostou ou subiu acima do teto de elevação.
         O tensionamento em curso não serve para mais nada: zerar é o que evita
         soltar a flecha na direção de uma pedra que não existe mais. */
      this._rochaId = null;
      this.drawTime = 0;
      this.drawFraction = 0;
    }

    let melhor = null;
    let melhorCusto = Infinity;
    for (const c of bichos) {
      if (c.kind !== "meteor") continue;
      if ((c.left ?? 1) <= 0) continue;
      if (!this.podeEngajar(c)) continue;

      /* O preço do giro, em segundos: `giroAntiaereo` rad/s. Somado ao prazo
         ele responde "qual dá para pegar antes", que é a pergunta certa. */
      const dx = c.x - this.position.x;
      const dz = c.z - this.position.z;
      let dYaw = Math.atan2(-dx, -dz) - this.yaw;
      while (dYaw > Math.PI) dYaw -= TAU;
      while (dYaw < -Math.PI) dYaw += TAU;

      const custo = (c.prazo ?? 99) + Math.abs(dYaw) / GIRO_ANTIAEREO;
      if (custo < melhorCusto) {
        melhorCusto = custo;
        melhor = c;
      }
    }
    if (!melhor) return null;
    this._rochaId = melhor.id;
    return this.presa(melhor);
  }

  /** O invólucro que `mirarEAtirar` espera, a partir de uma presa crua. */
  presa(c) {
    return {
      position: c,
      isCreature: true,
      kind: c.kind,
      id: c.id,
      alive: true,
      aimY: c.aimY,
      raio: c.r,
      /* A VELOCIDADE DECLARADA. Ver `mirarComLead`: medir por diferença de
         posição só funciona quando o alvo é sempre o mesmo, e no céu ele não é. */
      vel: c.vx != null ? { x: c.vx, y: c.vy ?? 0, z: c.vz ?? 0 } : null,
    };
  }

  /** Tem alvenaria entre o arco e este ponto? Só o teste de caixa. */
  pedraNaFrente(c) {
    this.atualizarMuzzle();
    _alvoTmp.x = c.x;
    _alvoTmp.y = c.y + (c.aimY ?? 0);
    _alvoTmp.z = c.z;
    return bloqueado(obstaculosDe(this.terrain, this.levelId), this._muzzle, _alvoTmp);
  }

  /**
   * Quanto este alvo está fora da frente de tiro deste posto.
   *
   * Devolve 1 para quem está bem à frente e cresce até 9 na perpendicular. Só
   * vale para o bot POSTADO — quem pode andar resolve o ângulo andando.
   */
  penalidadeDeSetor(c) {
    if (!this.postado) return 1;
    const dx = c.x - this.position.x;
    const dz = c.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return 1;
    /* A frente do posto é +Z: é para lá que a rampa desce e de lá que eles
       vêm. O castelo inteiro é orientado assim — ver `shared/castleProps.js`. */
    const cos = dz / d;
    return cos <= 0 ? 40 : 1 / (cos * cos * cos);
  }

  /**
   * Este alvo está num ângulo que a balística do bot resolve?
   *
   * `elevacaoPara` itera o tempo de voo sobre a distância HORIZONTAL. Com o
   * alvo quase a pino ela tende a zero, a queda estimada some junto, e a função
   * devolve ~90° — que o `pitchMax` de 86° corta. O erro em 200 m passa de dez
   * metros: **o bot não erra por perícia, erra por álgebra**.
   *
   * O filtro é a correção barata e sem risco: ele guarda o tiro, como já faz
   * quando `temVisada` reprova. Consertar o solver resolveria o caso geral e
   * mexeria em código que o duelo usa — fica para depois.
   */
  podeEngajar(c) {
    const teto = this.maxElevation;
    if (!teto) return true;
    const dy = c.y - this.position.y;
    if (dy <= 0) return true;
    const distH = Math.hypot(c.x - this.position.x, c.z - this.position.z);
    return Math.atan2(dy, Math.max(0.01, distH)) <= teto;
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

    /* O OBJETIVO GANHA DA ÓRBITA.
     *
     * A IA de duelo persegue uma FAIXA de distância do adversário — 34 a 62 m —
     * e circunda dentro dela. É o comportamento certo quando o que está em jogo
     * é acertar e não ser acertado, e é exatamente o comportamento errado num
     * modo com um objeto a buscar: sem isto, o time da CPU no rouba bandeira
     * orbitava os humanos a cinquenta metros da bandeira e NUNCA pontuava — o
     * modo tinha um só lado jogando, e os humanos ganhavam por caminhar.
     *
     * Com objetivo o bot anda reto para ele e continua atirando no caminho:
     * quem escolhe o alvo de tiro é `escolherAlvoDeTiro`, que não passa por
     * aqui. Andar e atirar ao mesmo tempo é justamente o que um jogador faz
     * carregando a bandeira. */
    if (this.objetivo) {
      const ox = this.objetivo.x - p.x;
      const oz = this.objetivo.z - p.z;
      const om = Math.hypot(ox, oz);
      if (om > 1.2) {
        const passoO = CONFIG.player.walkSpeed * dt;
        const nxO = p.x + (ox / om) * passoO;
        const nzO = p.z + (oz / om) * passoO;
        if (this.podeAndar(nxO, nzO)) {
          p.x = nxO;
          p.z = nzO;
          this._andando = true;
          this.gaitBlend = 1;
          this.gaitPhase =
            (this.gaitPhase + (passoO / CONFIG.gait.strideLength) * TAU) % TAU;
        }
      }
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
    /* O PISO PODE SER DECLARADO.
     *
     * `terrain.heightAt` responde a cota do CHÃO, e o chão não sabe que existe
     * um adarve onze metros acima dele. Um bot posto na muralha do cerco era
     * puxado para o pátio no primeiro tique — de pé no lugar certo em x e z, e
     * onze metros abaixo do jogo.
     *
     * `floorY` é a saída mais barata que continua correta: quem põe o bot num
     * piso construído diz qual é a cota dele, e a gravidade passa a cair
     * naquele piso. Fora disso (que é todo o resto do jogo) nada muda. */
    const chao = this.floorY ?? this.terrain.heightAt(p.x, p.z);
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
    const altura = alvo.aimY ?? (alvo.isCreature ? 0.55 : 1.15);

    /* A VELOCIDADE DECLARADA GANHA DA MEDIDA.
     *
     * Medir por diferença de posição entre quadros é o que um jogador faz, e é
     * a coisa certa contra um adversário — ele não te entrega o vetor dele. Só
     * que `_ultimoAlvo` é UM slot: a conta só vale enquanto o alvo for o mesmo
     * de ontem. No céu ele não é, e cada troca de rocha produzia uma velocidade
     * que era o salto entre duas pedras — descartada pelo teto de 900, ou seja,
     * liderança ZERO no quadro seguinte. Contra uma rocha a 15 m/s com dois
     * segundos de voo, liderança zero é errar por trinta metros.
     *
     * Quem declara `vel` é um objeto balístico com trajetória conhecida (a
     * rocha, o sitiante). Não há nada de desleal em usá-la: é a mesma
     * informação que o jogador humano lê olhando a pedra descer. */
    const vel = alvo.vel ?? this._velAlvo;
    const k = alvo.vel ? 1 : this.pericia.precisaoLead;

    let t = 0;
    for (let i = 0; i < 3; i++) {
      out.x = alvo.position.x + vel.x * t * k;
      out.y = alvo.position.y + altura + vel.y * t * k;
      out.z = alvo.position.z + vel.z * t * k;
      t = distancia(this._muzzle, out) / v;
    }
    return t;
  }

  /**
   * Quão perto do ângulo certo ele precisa estar para soltar a corda.
   *
   * Os 0,01 rad fixos são a tolerância de um duelo — ~45 cm a 45 m, que é a
   * largura de um tronco humano. Contra o colosso de 26 m de raio a 200 m eles
   * exigem um alinhamento cem vezes mais fino do que o alvo pede, e o custo é
   * pago em segundos de mira parada: o bot fica pendurado no último milirradiano
   * de uma pedra que ele acertaria de olhos fechados.
   *
   * Com o tamanho angular do alvo no lugar do número fixo, a pedra pequena
   * continua exigindo o que sempre exigiu (o piso é o mesmo 0,01) e o colosso
   * libera o tiro assim que a mira entra nele. O fator 0,35 mira o miolo, não a
   * borda — a flecha ainda tem que ACERTAR, não raspar.
   */
  toleranciaAngular(alvo, dist) {
    const raio = alvo.raio ?? 0;
    if (raio <= 0 || dist < 1e-3) return 0.01;
    return clamp(Math.atan2(raio, dist) * 0.35, 0.01, 0.05);
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
    const inclinada = Math.hypot(distH, alturaRel);
    const ar = this.fisica.airDensity / 1.225;
    const vEf = v * (1 - 0.11 * ar * Math.min(1, inclinada / 100));

    /* O TEMPO DE VOO SAI DA DISTÂNCIA INCLINADA, e não da projeção horizontal.
     *
     * As duas formas são a MESMA álgebra — a flecha sai a `v` na direção da
     * mira, então `distH/(v·cos ang)` e `inclinada/v` são idênticos —, mas a
     * primeira é 0/0 com o alvo a pino: `distH → 0` e `cos ang → 0` juntos. Era
     * daí que vinha o "o bot não erra por perícia, erra por álgebra": com a
     * rocha quase em cima da cabeça o tempo estimado sumia, a queda estimada
     * sumia junto, e ele mirava dois metros abaixo do alvo num tiro de 200 m.
     * Dois metros contra uma pedra de 2,5 m de raio é a diferença entre estourar
     * e atravessar.
     *
     * Escrita pela inclinada não há denominador que tenda a zero, e o caso
     * plano continua respondendo exatamente o mesmo número de antes. */
    let t = inclinada / Math.max(1e-3, vEf);
    let ang = Math.atan2(alturaRel, distH);
    for (let i = 0; i < 4; i++) {
      const queda = 0.5 * g * t * t;
      ang = Math.atan2(alturaRel + queda, distH);
      t = Math.hypot(distH, alturaRel + queda) / Math.max(1e-3, vEf);
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
    /* NO VÁCUO A CONTA É OUTRA, e o divisor tem que dizer isso.
     *
     * Os 110 m são calibrados para o vale, onde o arrasto come a velocidade e
     * um tiro longo exige tensão cheia mesmo. Na Lua não há arrasto nenhum: a
     * 70 % de tensão a flecha ainda faz 93 m/s e cruza 250 m em 2,7 s. O que a
     * tensão cheia compra ali não é alcance, é meio segundo a menos de voo — e
     * custa 0,5 s a mais de tensionamento, ou seja, é um mau negócio.
     *
     * O bot antiaéreo compra o CICLO em vez do alcance: com o divisor no dobro
     * ele solta uma flecha a cada ~2,0 s em vez de ~2,7 s, que é um terço a
     * mais de flechas na mesma horda. A liderança maior não o incomoda — ele
     * resolve a antecipação por álgebra, e a rocha vem em linha reta. */
    const divisor = this.antiaereo ? 230 : 110;
    const tensaoAlvo = clamp(distBruta / divisor, 0.35, 1) * CONFIG.bow.fullDrawTime;

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
    // impossível de flanquear, e flanquear é o que se faz num duelo. Contra o
    // céu não há flanco a proteger e o alvo cruza a 21 m/s — ver `GIRO_ANTIAEREO`.
    const giroMax = (this.antiaereo ? GIRO_ANTIAEREO : 2.6) * dt;
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
      /* O antiaéreo LARGA a pedra bloqueada, e é obrigatório largar.
         O duelista bloqueado circunda e a visada abre sozinha em poucos
         segundos; este está postado e não anda — se o foguete estiver entre ele
         e aquela rocha, vai estar até a rocha encostar no chão. Sem soltar o
         compromisso ele ficaria travado num alvo impossível enquanto o resto do
         céu desce. */
      if (this.antiaereo) {
        this._rochaId = null;
        this.drawTime = 0;
        this.drawFraction = 0;
      }
      return null;
    }
    this.bloqueado = false;

    /* SÓ ATIRA COM OS DOIS ÂNGULOS NO LUGAR. Exigir só o yaw deixava a flecha
       sair enquanto a ELEVAÇÃO ainda subia — e a elevação é justamente o que
       compensa a queda. A tolerância sai do TAMANHO DO ALVO, com piso nos
       mesmos 0,01 rad de antes — ver `toleranciaAngular`. */
    const tol = this.toleranciaAngular(alvo, distBruta);
    if (Math.abs(dYaw) > tol || Math.abs(dPitch) > tol) return null;

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
    /* O TEMPO DE REAÇÃO NÃO VALE CONTRA UMA PEDRA.
       Ele modela o instante em que a pessoa percebe que o adversário mudou de
       ideia — e uma rocha em queda balística não muda de ideia. Cobrá-lo aqui é
       só um imposto sobre o ciclo de tiro. */
    this.reagirEm = this.antiaereo ? 0 : this.pericia.reacao;
    this._decidiuPausa = false;
    // A pedra escolhida foi servida: a próxima flecha reabre a escolha.
    this._rochaId = null;

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
  /**
   * @param {boolean} semFogoAmigo no duelo de times os bots são um time só
   * @param {{soPresas?:boolean, maxElevation?:number}} [perfil] o modo manda
   */
  /**
   * @param {(bot: Bot) => ({x:number,z:number}|null)} [objetivoDe] para onde
   *   cada bot deve ir, quando o modo tem um objetivo. Ver `Bot.update`.
   */
  update(dt, alvos, bichos, semFogoAmigo = false, perfil = null, objetivoDe = null) {
    const tiros = [];
    for (const b of this.list) {
      b.semFogoAmigo = semFogoAmigo;
      b.soPresas = perfil?.soPresas === true;
      b.postado = perfil?.postado === true;
      b.antiaereo = perfil?.antiaereo === true;
      b.maxElevation = perfil?.maxElevation ?? 0;
      const tiro = b.update(dt, alvos, bichos, objetivoDe ? objetivoDe(b) : null);
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
