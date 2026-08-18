/* ---------------------------------------------------------------------------
   A sala de Namekusei. Irmã da do arqueiro, e nunca parente.

   Ela expõe **exatamente** a mesma interface externa que a `Room` de
   `server/room.js` — `level`, `mode`, `players`, `bots.count`, `onEmpty`,
   `handleMessage`, `handleClose`, `destroy` — e é só por isso que o `RoomHost`
   a guarda no mesmo `Set`, a lista no mesmo `publicStatus()` e a destrói pela
   mesma carência, sem uma única linha especial. O `if` de roteamento em
   `RoomHost.ensure` é a ÚNICA linha de `server/room.js` que este modo tocou —
   ver §0 e §11 de `docs/plano-namekusei.md`, que é o requisito principal do
   modo e não um pedido de organização.

   Por dentro, nada é parecido. Não há Rapier (§4), não há campo de altura do
   vale, não há flecha, vento, javali nem troca de fase. O que há é uma arena
   esférica de 900 m com quinze lutadores voando, e a sala é a autoridade sobre
   a única coisa que não pode divergir entre duas telas.

   ------------------------------------------------------- o modelo de confiança

   O MESMO do jogo do arqueiro (§8 do plano), e isso é deliberado: um segundo
   modelo de confiança no mesmo servidor seria a inconsistência que ninguém
   lembra de manter.

     | Cliente  | a própria pose, o próprio disparo, o próprio acerto |
     | SERVIDOR | vida, dano, morte, renascimento, placar, cratera,   |
     |          | clima, ki e bots                                    |

   Quem atira declara o acerto (`BLAST_HIT`, `SPECIAL_HIT`), exatamente como o
   `C2S.IMPACT` do vale; a sala confere se o número é PLAUSÍVEL e cobra a vida.
   A checagem existe para o jogo não se contradizer, não para impedir trapaça —
   serve para jogar com amigos, e isso está claro no plano desde a primeira
   linha do outro `room.js`.

   ------------------------------------------------------------------- a barra

   O ki é a exceção que vale sublinhar: **a sala é dona da barra**, e não o
   cliente. Ela cobra 2 por bola, 25 por onda e a barra INTEIRA por especial —
   e recusa o especial que não vier com o estoque cheio (§5). O gasto contínuo
   (arranque) e o ganho contínuo (carga) saem da PRÓPRIA POSE que o cliente já
   manda 20 vezes por segundo: `bo` é o arranque aceso e `ch` é a pose de
   carregar. Nenhuma mensagem nova, nenhum botão a mais, e a autoridade continua
   deste lado — o cliente declara o que está FAZENDO, a sala decide o que isso
   CUSTA.
   --------------------------------------------------------------------------- */

import { NAMEK, specialInfo } from "../../src/shared/namek/config.js";
import {
  NC2S,
  NS2C,
  NAMEK_LEVEL,
  NAMEK_MODE,
  NAMEK_PROTOCOL_VERSION,
  NamekReject,
  displayName,
  packFighter,
} from "../../src/shared/namek/protocol.js";
import { NamekField } from "../../src/shared/namek/field.js";
import { NamekBotSquad, melhorNascimento, PALETA } from "./bots.js";
/* O SUPER SAIYAJIN mora fora deste arquivo — um estado por lutador, quatro
   perguntas de economia e dois anúncios —, e os ganchos aqui são os menores
   possíveis: um `case` na rota, uma linha no funil de dano, três no preço do ki
   e uma varredura por quadro. Ver o cabeçalho de `./ssj.js`, que explica também
   por que ele lê o Freeza sempre com `?.`. */
import * as SSJ from "./ssj.js";
import { NamekFreeza } from "./freeza.js";
import { NamekPeixeSim } from "./peixe.js";
/* Os DOIS PLANETAS e a chuva que sai deles. Mesmo contrato do `bots.js`: um
   módulo que a sala hospeda, aciona uma vez por quadro e alimenta com três
   funções (cratera, dano, envio). Ele não conhece a sala; ela não conhece a
   chuva. */
import { NamekPlanetas } from "./planetas.js";
import { NamekSol } from "./sol.js";
/* O FIM DO PLANETA — a máquina de estados inteira mora lá, e a sala só a
   alimenta. Ver `server/namek/fim.js`: Freeza, contagem, explosão e espaço. */
import { NamekFim } from "./fim.js";

export { NAMEK_LEVEL };

/* O contador de ids é PRÓPRIO desta sala, e não o de `server/room.js`.
   Os dois jogos não trocam mensagem nem corpo — um id repetido entre eles não
   tem onde colidir —, e importar o contador de lá seria a primeira linha de
   acoplamento entre duas coisas que o §0 do plano quer separadas para sempre. */
let proximoId = 1;

/** Contador de crateras. Ver `NS2C.CRATER`: é ele que torna `addCrater` idempotente. */
let proximaCratera = 1;

/* Os três vêm de `NAMEK.net`, e não de cópias locais.
 *
 * Havia cópias aqui, com um comentário afirmando que `shared/namek/config.js`
 * era "arquivo existente" que o §11 do plano proibia mexer. Não é: aquele
 * arquivo NASCEU com este modo, e o §11 fala dos arquivos do arqueiro. O preço
 * do engano já tinha aparecido — a tolerância local valia 14 e a do config, 12,
 * duas fontes de verdade para o mesmo número, com a sala usando a sua e o resto
 * do mundo lendo a outra. */
const NOME_MAX = NAMEK.net.nameMaxLength;
const SILENCIO = NAMEK.net.silenceTimeout;
const TOLERANCIA = NAMEK.net.hitTolerance;

/** s — o mínimo de tempo caído antes de o `RESPAWN` antecipado valer. */
const RESPAWN_MINIMO = 1.6;

/**
 * Teto de crateras PEQUENAS por jogador, por segundo.
 *
 * A rajada sai a 6/s por pessoa. Com quinze em campo mirando o chão seriam 90
 * crateras por segundo, retransmitidas para quinze telas, e a malha do terreno
 * de todo mundo re-esculpida noventa vezes por segundo.
 */
const CRATERAS_POR_SEGUNDO = 5;

/**
 * A mesma cota, para os golpes GRANDES — e ela é um balde SEPARADO.
 *
 * ------------------------------------------------------------------ o defeito
 *
 * Havia um balde só, e o comentário dele prometia uma coisa que o código não
 * fazia: *"golpe GRANDE (potência ≥ 1, que é a faixa dos especiais) passa
 * sempre"*. Passava, na versão em que a exceção existia; ela foi tirada para
 * conter um abuso, e a promessa ficou no comentário.
 *
 * Enquanto a rajada tinha potência 0,12 isso não custou nada — ela ficava
 * abaixo do corte de `craterMinPower` e nem chegava a pedir cratera. Quando a
 * potência dela subiu para 0,45 (para a ilha poder ser destruída de verdade),
 * ela passou a pedir uma cratera a cada tiro, **seis por segundo contra um
 * balde de cinco**, e o balde virou o que ele nunca quis ser: uma fila em que a
 * rajada entra sempre na frente.
 *
 * Medido: quatro segundos de rajada contínua deixam o balde estourado, e a
 * Genki Dama disparada em seguida é **descartada em silêncio** — sem erro, sem
 * aviso, sem cratera. É o relato *"a Genki Dama não abriu cratera"*, e ele não
 * dependia de mira nem de distância: dependia de o jogador ter atirado antes,
 * que é o que todo mundo faz.
 *
 * ------------------------------------------------------------------ a defesa
 *
 * Dois baldes, um por faixa. O da rajada continua contendo o spray; o dos
 * especiais é lento (dois por segundo) e a rajada não encosta nele — ela não
 * pode, porque nem sequer é medida ali. Um especial custa a barra CHEIA, então
 * dois por segundo é várias vezes mais do que qualquer jogador honesto consegue
 * produzir, e continua sendo um teto contra um cliente que minta a potência.
 *
 * O corte entre as faixas é 2: a rajada tem 0,45, o Kamehameha 0,58, e o menor
 * especial que abre buraco de verdade (o Kienzan) tem 3,6. O Kamehameha fica do
 * lado da rajada de propósito — a potência dele é baixa porque a cratera dele é
 * ESTREITA (ele cava fundo, ver `craterDeep`), e ele ainda enfileira uma
 * cratera a cada sete metros de rocha ao atravessar uma montanha. Essa fila é
 * exatamente o que o balde pequeno existe para conter, e ela já tem a folga
 * dela em `podeCravar`.
 */
const CRATERAS_GRANDES_POR_SEGUNDO = 2;

/** Potência a partir da qual a cratera é cobrada no balde dos GRANDES. */
const POTENCIA_GRANDE = 2;

/**
 * m — o maior alcance que qualquer golpe deste jogo tem.
 *
 * Derivado da tabela em vez de escrito: é o teto de "até onde um lutador pode
 * ter causado alguma coisa", e ele precisa crescer sozinho no dia em que um
 * especial de alcance maior entrar em `NAMEK.specials`. Um número à mão aqui
 * envelheceria calado, e o sintoma seria o golpe novo sendo recusado pela sala
 * sem nada dizer por quê.
 */
const ALCANCE_MAXIMO = Math.max(
  ...Object.values(NAMEK.specials).map((s) => s.range),
  NAMEK.blast.speed * NAMEK.blast.life,
);

/** Distância ao quadrado entre um vetor da rede `[x,y,z]` e um ponto. */
function dist2(a, p) {
  const dx = a[0] - p.x;
  const dy = a[1] - p.y;
  const dz = a[2] - p.z;
  return dx * dx + dy * dy + dz * dz;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round = (v) => Math.round(v * 1000) / 1000;

export class NamekRoom {
  /**
   * @param {object} [opcoes]
   * @param {(msg:string)=>void} [opcoes.log]
   * @param {boolean} [opcoes.relogio] `false` entrega o TEMPO a quem chama: sem
   *   `setInterval`, e com `now()` andando pelo `dt` de cada `passo()` em vez do
   *   relógio de parede. É o que o banco de provas usa
   *   (`scripts/bench-namek.js`): sessenta segundos de jogo têm de caber em
   *   menos de um segundo de relógio real, e as duas metades precisam concordar
   *   — com o timer desligado mas `now()` ainda lendo `Date.now()`, ninguém
   *   sairia da invulnerabilidade de nascimento e o banco mediria quinze bots
   *   intocáveis se ignorando. Fora do banco, ninguém passa este parâmetro.
   */
  constructor({ log = () => {}, relogio = true } = {}) {
    this.log = log;
    this.epoch = Date.now();

    /* `level` e `mode` existem para o `RoomHost`: é por eles que ele encontra a
       sala e é por eles que a tela de entrada a lista. "namek" NÃO está em
       `LEVEL_IDS` de propósito — ver o comentário do `if` em `ensure`. */
    this.level = NAMEK_LEVEL;
    this.mode = NAMEK_MODE;

    /* O planeta. Puro, roda em Node, e é o MESMO objeto que o cliente constrói
       do lado dele — mesma semente, mesmo relevo, mesmas crateras. */
    this.field = new NamekField();

    /** @type {Map<object, object>} conexão → lutador */
    this.players = new Map();
    this.bots = new NamekBotSquad();
    /* O BOSS. Ele nasce DESLIGADO — `entrar()` é que o põe em campo, e quem a
       chama é quem orquestra a partida. Ver o §2 de `server/namek/freeza.js`
       para o contrato inteiro (`entrar`, `sair`, `vivo`, `aoMorrer`). */
    this.freeza = new NamekFreeza(this);
    /* Os dois corpos celestes e a chuva de meteoros. Nascem com a sala e
       voltam ao começo quando ela esvazia — ver `handleClose`. */
    this.planetas = new NamekPlanetas();
    /* E O SOL, que virou alvo: três Kamehamehas nele acendem o fim do planeta
       pelo MESMO caminho do botão do menu. Ver `server/namek/sol.js`, que é onde
       está o argumento de por que ele não inventa fase nenhuma. */
    this.sol = new NamekSol(this);

    /* O FIM DO PLANETA. Ele nasce com a sala e vive nela inteira — a fase
       `calmo` não custa nada e não faz nada, e é o que permite o resto do
       arquivo perguntar `this.fim.noEspaco` sem um `if` de existência antes.
       O `this.freeza` que ele procura é de outro módulo e pode não existir:
       `fim.js` trata os dois casos. */
    this.fim = new NamekFim(this);

    /* As cores livres. Mesma ideia do `ColorPool` do arqueiro, em oito linhas
       em vez de importada — importar `server/colors.js` seria acoplar os dois
       jogos por causa de uma lista de tons (§0), e a paleta daqui é outra: ela
       tem de combinar com aura de ki, não com túnica de arqueiro. É uma PILHA
       e não um índice porque quem sai devolve a cor, e sem devolução uma sala
       de sessão longa acabaria com quinze lutadores da mesma cor. */
    this.cores = [...PALETA];

    /* O clima é da SALA. Ver `pedirClima`: ele muda por pedido de quem está
       jogando, e o raio é sorteado aqui para todo mundo ver o mesmo relâmpago
       no mesmo lugar. */
    this.weather = NAMEK.weather.padrao;
    this.weatherAt = 0;
    /** Instante a partir do qual outra troca de clima é aceita. Ver `pedirClima`. */
    this.climaLivreEm = 0;
    this.proximoRaio = 0;

    /* O PEIXE GIGANTE do mar. A sala é dona dele pelo mesmo motivo que é dona da
       vida dos lutadores: quinze telas têm de ver o mesmo bicho no mesmo lugar.
       Ver `server/namek/peixe.js`. */
    this.peixe = new NamekPeixeSim();

    /** Peças de cenário já derrubadas, para não anunciar duas vezes. */
    this.propsCaidos = new Set();
    /** Quantas crateras a sala já carimbou. O campo só guarda as 96 últimas. */
    this.crateras = 0;

    /* OS EMBATES RECENTES — um anel de oito, para o desempate do
       `NC2S.POWER_CLASH`. Ver `registrarEmbate`: qualquer cliente que veja dois
       poderes se encostarem avisa, e numa sala de quinze isso são até quinze
       avisos do mesmo encontro em poucos milissegundos. O primeiro vira o
       acontecimento; os outros morrem aqui.
       Pré-alocado com registros nulos porque o anel é escrito por índice — um
       array que cresce e encolhe faria lixo num caminho que é raro mas que
       acontece no quadro mais carregado que o modo tem. */
    this.embatesRecentes = new Array(8).fill(null).map(() => ({
      a: null,
      ka: null,
      b: null,
      kb: null,
      w: -1e9,
    }));
    this.embateProx = 0;

    /** Corpos uniformes do quadro em curso. Ver `montarCorpos`. */
    this.corpos = [];
    this.corpoPorId = new Map();

    this.quadro = 0;
    this.ultimoPasso = Date.now();
    /** ms — o relógio simulado, ou `null` quando o relógio é o do mundo. */
    this.simulado = relogio ? null : 0;

    /* UM TIMER SÓ para o jogo inteiro.
     *
     * A sala do arqueiro tem quatro (poses, bichos, bots, varredura) porque lá
     * as coisas andam em relógios diferentes — um javali não precisa de 20 Hz.
     * Aqui tudo anda junto: os bots pensam no mesmo passo em que as bolas voam
     * e em que as poses saem, porque um bot que decide a 10 Hz e é transmitido
     * a 20 Hz manda metade das amostras repetidas. A vida sai de dois em dois
     * quadros (`statusRate`, 10 Hz), que é o único ritmo diferente do modo. */
    this.stepTimer = relogio
      ? setInterval(() => this.passo(), 1000 / NAMEK.net.stateRate)
      : null;
    this.sweepTimer = relogio
      ? setInterval(() => this.derrubarMudos(), 5000)
      : null;
  }

  now() {
    return this.simulado === null ? Date.now() - this.epoch : this.simulado;
  }

  get size() {
    return this.players.size;
  }

  /** Humanos + CPU. É este número que `NAMEK.net.maxPlayers` limita. */
  get lotacao() {
    return this.players.size + this.bots.count;
  }

  /* ============================================================== o passo == */

  /**
   * Um quadro da sala inteira.
   *
   * @param {number} [forcado] segundos, para quem dirige o relógio à mão
   */
  passo(forcado = null) {
    const agora = Date.now();
    /* O passo real, e não o nominal: um `setInterval` que atrasa 30 ms sob
       carga faria o mundo andar em câmera lenta se o dt fosse fixo. O teto de
       0,25 s existe para o contrário — depois de um engasgo do processo, um dt
       de dois segundos teleportaria todo mundo. */
    const dt = forcado ?? clamp((agora - this.ultimoPasso) / 1000, 0, 0.25);
    this.ultimoPasso = agora;
    if (dt <= 0) return;
    /* O relógio simulado anda ANTES da saída antecipada: uma sala parada tem de
       continuar envelhecendo, ou a carência de 30 s nunca venceria nela. */
    if (this.simulado !== null) this.simulado += dt * 1000;

    /* Sala em carência (sem gente e sem bot) não gasta nada. */
    if (!this.players.size && !this.bots.count) return;

    const t = this.now();
    this.relogioDaQueda(t);
    /* O FREEZA CAIU, A TRANSFORMAÇÃO ACABA. É a única regra do Super Saiyajin
       sem gatilho próprio — não existe uma mensagem de "o chefe morreu,
       desligue" —, então ela é observada por quadro, como a carência da queda
       logo acima. Sem chefe em campo é uma comparação e um `return`. */
    SSJ.manutencao(this);
    this.economiaDeKi(dt, t);
    this.queimarNaLava(dt, t);
    this.afogarNoMar(dt, t);
    this.montarCorpos(t);
    /* O BOSS anda ANTES dos bots e DEPOIS de `montarCorpos`, e a ordem é a
       mesma do peixe e do relâmpago: ele lê a lista uniforme deste quadro para
       escolher alvo, e acrescenta o próprio corpo a ela no fim do passo dele —
       o que faz os bots o enxergarem onde ele ESTÁ e não onde estava. A 118 m/s
       um quadro são quase seis metros. */
    this.freeza.passo(dt, t);
    this.bots.tick(dt, {
      field: this.field,
      corpos: this.corpos,
      agora: t,
      gastar: (f, custo) => this.gastar(f, custo),
      emitir: (ev) => this.doBot(ev, t),
    });
    /* A CHUVA DE METEOROS, depois de `montarCorpos` pelo mesmo motivo do peixe e
       do relâmpago: quase metade das rochas é mirada perto de alguém, e "alguém"
       é a lista uniforme deste quadro. As três funções que ela recebe são a
       fronteira dela com a sala — cratera pelo caminho de sempre, dano pelo funil
       de sempre, e a morte direta pelo mesmo `matar` do mar e da lava. */
    this.planetas.tick(dt, {
      field: this.field,
      corpos: this.corpos,
      agora: t,
      cratera: (x, z, power) => this.cratera(x, z, power),
      dano: (c, dano, p, d) =>
        this.aplicarDano(c.ref, dano, { kind: "meteoro", p, d }),
      /* Sem culpado, como a lava, o mar e a queda: não há a quem dar o abate. A
         chuva é uma catástrofe, não um golpe — e premiar quem explodiu o planeta
         por cada corpo que uma pedra encontrar seria premiar o acaso. */
      matar: (c, p, d) => this.matar(c.ref, null, "meteoro", p, d, t),
      enviar: (msg) => this.broadcastAll(msg),
    });
    this.renascimentos(t);
    this.tempo(dt, t);
    /* O peixe DEPOIS de `montarCorpos`, porque é da lista uniforme que ele tira
       para que lado saltar — o salto sai na direção de alguém em campo dois
       terços das vezes, pela mesma razão que o relâmpago cai perto (ver
       `NAMEK.peixe.perto`). Um salto anunciado é retransmitido inteiro num
       pacote só e nada mais viaja depois dele. */
    const salto = this.peixe.tick(dt, t, this.corpos);
    if (salto) this.broadcastAll({ t: NS2C.FISH, ...salto });
    /* O FIM, depois de tudo e antes das poses saírem: ele mede a fuga na lista
       uniforme que `montarCorpos` acabou de montar, e quando alguém escapa ele
       reescreve a posição daquele corpo — que é justamente a que o
       `broadcastStates` da linha seguinte vai mandar. Rodar antes deixaria o
       escapado viajando uma última vez do lugar de onde ele saiu. */
    this.fim.passo(dt, t);

    this.broadcastStates(t);
    this.quadro++;
    /* 20 Hz de pose, 10 Hz de vida. As duas frequências do §8, num contador. */
    if (this.quadro % Math.max(1, Math.round(NAMEK.net.stateRate / NAMEK.net.statusRate)) === 0) {
      this.broadcastVitals();
    }
  }

  /**
   * A lista uniforme de quem está em campo.
   *
   * Humano e bot declaram a posição de jeitos diferentes — um manda `state.p`
   * pela rede, o outro tem `position` na memória —, e absolutamente nada do
   * resto do modo quer saber de qual dos dois se trata. É a mesma decisão do
   * `allCharacters()`/`corpoDe()` da sala do arqueiro, levada um passo adiante:
   * aqui a lista é montada UMA vez por quadro, porque ela é varrida por bola em
   * voo (até duzentas) e por bot (quinze), e desempacotar `state.p` dentro
   * desses laços seria pagar o mesmo trabalho três mil vezes.
   */
  montarCorpos(agora) {
    this.corpos.length = 0;
    this.corpoPorId.clear();
    for (const p of this.players.values()) {
      const s = p.state;
      if (!s) continue;
      this.corpos.push({
        id: p.id,
        ref: p,
        isBot: false,
        x: s.p[0], y: s.p[1], z: s.p[2],
        vx: s.v?.[0] ?? 0, vy: s.v?.[1] ?? 0, vz: s.v?.[2] ?? 0,
        alive: p.alive,
        invuln: agora < p.invulnUntil,
        health: p.health,
        /* AS MEDIDAS DO CORPO, e elas viajam na lista porque **nem todo corpo
           desta lista é um lutador**. Ver a nota em `NamekFreeza.corpoNaLista`
           para o defeito que a ausência delas causava. */
        raio: NAMEK.fighter.radius,
        peito: NAMEK.fighter.chest,
      });
    }
    for (const b of this.bots.list) {
      this.corpos.push({
        id: b.id,
        ref: b,
        isBot: true,
        x: b.position.x, y: b.position.y, z: b.position.z,
        vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z,
        alive: b.alive,
        invuln: agora < b.invulnUntil,
        health: b.health,
        raio: NAMEK.fighter.radius,
        peito: NAMEK.fighter.chest,
      });
    }
    for (const c of this.corpos) this.corpoPorId.set(c.id, c);
    return this.corpos;
  }

  /* ================================================================== ki == */

  /**
   * A barra de todo mundo, por segundo.
   *
   * O gasto e o ganho CONTÍNUOS saem da pose: `bo` (arranque aceso) drena
   * `boostDrain`, `ch` (pose de carregar) enche a `chargeRate`. Ler isso da
   * pose em vez de criar um par de mensagens "comecei/parei" é o que mantém a
   * conta certa quando um pacote se perde — a pose é reenviada 20 vezes por
   * segundo, e um "parei" perdido deixaria o jogador drenando para sempre.
   *
   * A regeneração passiva existe para ninguém ficar preso em zero, e o atraso
   * (`idleDelay`) é o que impede que ela pague pela rajada em curso: quem está
   * atirando não regenera, quem parou volta a encher devagar.
   */
  /**
   * Quem está com os pés na lava perde vida enquanto ficar lá.
   *
   * A SALA é quem cobra, como cobra todo o resto do dano: o cliente desenha a
   * poça e sente o calor, mas quem tira vida é um só, senão duas telas
   * discordariam sobre quem morreu.
   *
   * Nem a poça nem o gatilho viajam pela rede. Elas são DERIVADAS do relevo
   * (`NamekField.avaliarLava`), e o relevo já é o mesmo dos dois lados porque
   * as crateras são sincronizadas — o mesmo motivo pelo qual ninguém precisa
   * transmitir onde fica cada buraco.
   *
   * Morrer na lava não dá abate a ninguém, pelo mesmo critério da queda: não
   * há culpado, e inventar um seria premiar quem por acaso cavou ali antes.
   */
  queimarNaLava(dt, agora) {
    /* NO ESPAÇO NÃO HÁ LAVA — nem chão embaixo dela. Sem esta linha, a poça que
       ficou registrada no campo continuaria queimando quem passasse pelas mesmas
       coordenadas (x, z) a dois quilômetros de altura. Ver `server/namek/fim.js`. */
    if (this.fim.noEspaco) return;
    if (!this.field.lavaPools.length) return;
    const L = NAMEK.destruction.lava;
    for (const f of this.todos()) {
      if (!f.alive) continue;
      const p = this.pontoDe(f);
      if (!this.field.naLava(p.x, p.y, p.z)) continue;
      this.aplicarDano(f, L.dano * dt, {
        kind: "lava",
        p,
        d: [0, 1, 0],
        /* Contínuo: é o mesmo caminho do feixe, que também cobra por quadro.
           Sem isto, cada tique viraria um anúncio de acerto separado. */
        continuo: true,
      });
    }
  }

  /**
   * **Quem cai no mar, morre.** É o pedido literal, e ele fecha o buraco que a
   * ampliação do voo abriu.
   *
   * Enquanto o `flyRadius` era o mesmo 460 m da arena, o oceano era decoração
   * atrás de uma parede macia. Agora dá para atravessar a praia e mergulhar
   * (ver `NAMEK.world.flyRadius`), e sem preço nenhum o mar aberto seria o
   * melhor lugar do mapa para descansar no meio de uma partida: sem cenário,
   * sem cratera, sem ninguém.
   *
   * Três decisões, e nenhuma delas é óbvia:
   *
   * • **A fronteira é o RELEVO BASE, não a altura atual** (`NamekField.ehMar`).
   *   Depois que as crateras passaram a furar até a lava, o fundo de um buraco
   *   na clareira também está abaixo da linha d'água — e afogar quem está dentro
   *   do próprio buraco seria o oposto do que se quer. É mar onde o terreno
   *   NATURAL já estava submerso, e cratera nenhuma move isso.
   *
   * • **Tem um relógio** (`afogar.tempo`). Instantâneo, um mergulho raspando a
   *   água no fim de uma perseguição mataria — e raspar a água é justamente a
   *   manobra que a praia existe para permitir. Sete décimos de segundo são
   *   longos o bastante para sair e curtos o bastante para não parecer perdão.
   *
   * • **Não dá abate a ninguém.** Mesmo critério da lava e da queda: não há
   *   culpado, e premiar quem por acaso empurrou seria premiar o acaso. Quem
   *   morre no mar morre para o mar.
   *
   * O relógio é do LUTADOR e não da sala, porque quinze podem estar molhados ao
   * mesmo tempo, e ele zera fora d'água — é a mesma janela deslizante do
   * `contarGolpe`, com um contador só.
   */
  afogarNoMar(dt) {
    /* E NO ESPAÇO NÃO HÁ MAR. Mesmo motivo da lava logo acima: a fronteira é
       função de (x, z) e continuaria valendo sobre a bolha, que fica em cima do
       antigo oceano. Quem escapou não pode se afogar a dois mil metros. */
    if (this.fim.noEspaco) return;
    const A = NAMEK.world.afogar;
    const linha = NAMEK.world.seaLevel - A.fundura;
    for (const f of this.todos()) {
      if (!f.alive) {
        f.afogando = 0;
        continue;
      }
      const p = this.pontoDe(f);
      /* Os PÉS, e não o peito: `pontoDe` devolve a base da cápsula, que é a
         convenção de posição do modo inteiro. Afogar pelo peito deixaria alguém
         de pé no fundo raso com a cabeça fora d'água morrendo assim mesmo. */
      if (p.y > linha || !this.field.ehMar(p.x, p.z)) {
        f.afogando = 0;
        continue;
      }
      f.afogando = (f.afogando ?? 0) + dt;
      if (f.afogando < A.tempo) continue;
      f.afogando = 0;
      /* `matar` direto, e não `aplicarDano` com um número grande: o mar não tira
         vida, ele acaba com ela. Um dano enorme daria o mesmo resultado e
         mentiria no `HURT` que sai antes — o jogador veria a barra despencar
         como se tivesse levado um golpe. */
      this.matar(f, null, "mar", p, [0, -1, 0], this.now());
    }
  }

  economiaDeKi(dt, agora) {
    const K = NAMEK.ki;
    for (const f of this.todos()) {
      if (!f.alive) continue;

      const bo = f.isBot ? f.boostBlend : (f.state?.bo ?? 0);
      const ch = f.isBot ? f.chargeBlend : (f.state?.ch ?? 0);

      /* BARRA CHEIA VOA DE GRAÇA — o mesmo limiar que o cliente lê em
         `KiMeter.voaDeGraca`, e ter os dois lados no mesmo `freeFlightAt` é o
         que impede a barra do HUD de descer enquanto a barra que vale fica
         parada. Vale para o bot pelo mesmo caminho: ele não paga arranque com o
         especial no topo, que é justamente quando ele está caçando alguém. */
      /* Em Super Saiyajin o limiar do voo de graça acompanha o do especial (um
         terço da barra em vez dela inteira), senão a regra morreria no primeiro
         golpe — ver `NAMEK.ssj.voaDeGracaEm`. O cliente lê o mesmo campo em
         `KiMeter.voaDeGraca`, pelo motivo escrito acima. */
      const deGraca = f.ki >= K.max * SSJ.voaDeGracaEm(f) - 1e-6;
      if (bo > 0.05 && !deGraca) {
        /* E o arranque que ele PAGA custa 40 % — é o "seu ki demora mais para
           gastar" (`NAMEK.ssj.kiDreno`), aplicado ao dreno contínuo aqui e no
           `KiMeter.drenar` do outro lado. */
        const custo = SSJ.custo(f, K.boostDrain) * bo * dt;
        if (custo > 0) {
          f.ki = Math.max(0, f.ki - custo);
          f.ultimoGasto = agora;
        }
      }
      /* A GUARDA DRENA, e drena antes de qualquer ganho. É o que dá preço ao
         botão de defesa: quem fica atrás dos braços vê a barra descer, e uma
         barra vazia é uma guarda que não apara mais nada (ver `defendendo`).
         Vem da pose pelo mesmo motivo que o arranque vem — ver o cabeçalho. */
      if (this.defendendo(f)) {
        f.ki = Math.max(0, f.ki - SSJ.custo(f, NAMEK.guard.drain) * dt);
        f.ultimoGasto = agora;
      }

      if (ch > 0.05) {
        f.ki = Math.min(K.max, f.ki + K.chargeRate * ch * dt);
      } else if (agora - f.ultimoGasto > K.idleDelay * 1000) {
        f.ki = Math.min(K.max, f.ki + K.idleRegen * dt);
      }
    }
  }

  /**
   * Cobra da barra, se houver. **É por aqui que todo gasto passa** — humano ou
   * bot, rajada ou especial.
   *
   * @returns {boolean} false quando não deu, e aí o disparo simplesmente não
   *   acontece: nem dano, nem retransmissão. O cliente que se adiantou vê a
   *   própria bola sumir sem efeito, e a barra correta chega no `VITALS`
   *   seguinte, no máximo 100 ms depois.
   */
  gastar(f, custo) {
    if (!f.alive || f.ki < custo) return false;
    f.ki -= custo;
    f.ultimoGasto = this.now();
    if (f.ki < 0) f.ki = 0;
    /* O total gasto na vida do lutador. Uma soma por disparo, e é ela que
       permite ao banco de provas responder "eles gerenciam ki?" sem pendurar
       gancho nenhum na economia — este método é o funil por onde TODO gasto do
       modo passa, então o número aqui é o número certo por construção. */
    f.gastoKi += custo;
    return true;
  }

  /* ============================================================== o clima == */

  /**
   * O relógio do planeta: a tempestade e os raios dela.
   *
   * O raio é sorteado AQUI e mandado pronto (`NS2C.BOLT`), e o comentário do
   * protocolo explica por quê melhor do que este: meio céu piscando em horas
   * diferentes em cada tela é o oposto de um planeta explodindo JUNTO.
   */
  tempo(dt, agora) {
    if (this.weather !== "tempestade") return;
    this.proximoRaio -= dt;
    if (this.proximoRaio > 0) return;

    const T = NAMEK.weather.tempestade;
    /* Intervalo sorteado em torno do médio, e não fixo: um relâmpago a cada
       exatos 3,4 s vira metrônomo, e metrônomo não assusta ninguém. */
    this.proximoRaio = T.raioIntervalo * (0.5 + Math.random());

    /* Sessenta por cento dos raios caem perto de alguém. Um relâmpago que
       ninguém vê é um relâmpago que não aconteceu — e a tempestade é o único
       momento do modo em que o cenário fala. */
    let x;
    let z;
    const perto = this.corpos.length && Math.random() < 0.6
      ? this.corpos[(Math.random() * this.corpos.length) | 0]
      : null;
    if (perto) {
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 260;
      x = perto.x + Math.cos(a) * r;
      z = perto.z + Math.sin(a) * r;
    } else {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * NAMEK.world.radius * 0.9;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    const lim = NAMEK.world.radius * 0.96;
    const d = Math.hypot(x, z);
    if (d > lim) {
      x = (x / d) * lim;
      z = (z / d) * lim;
    }
    this.broadcastAll({ t: NS2C.BOLT, p: [round(x), round(z)], w: agora });
  }

  /**
   * Alguém pediu outro clima. Vale para a sala inteira.
   *
   * Não há ciclo automático, e é escolha: a tempestade é uma DECISÃO — o
   * equivalente do V do arqueiro —, e um céu que vira sozinho no meio de uma
   * perseguição é o cenário tomando do jogador uma coisa que era dele.
   */
  pedirClima(id, agora) {
    if (!NAMEK.weather.ids.includes(id) || id === this.weather) return;

    /* UMA TROCA POR VEZ, e o tempo mínimo é o da própria transição.
     *
     * O clima é da SALA e qualquer um o vira. Sem trava, um cliente alternando
     * dia e tempestade num laço produziu 39 trocas em 0,4 s — todas
     * retransmitidas para todo mundo, com o céu de catorze pessoas piscando
     * entre verde e vermelho. Não é trapaça, é um botão que qualquer um pode
     * segurar sem querer.
     *
     * A carência é o `fade`: enquanto o céu ainda está VIRANDO, um pedido novo
     * não descreve nada que dê para ver. Terminada a transição, quem quiser
     * trocar de novo troca. */
    if (agora < this.climaLivreEm) return;
    this.climaLivreEm = agora + NAMEK.weather.fade * 1000;

    this.weather = id;
    this.weatherAt = agora;
    /* O primeiro raio não sai junto com a transição: o céu leva
       `NAMEK.weather.fade` segundos para virar, e um relâmpago num céu ainda
       verde-claro lê como erro de sincronismo. */
    this.proximoRaio = NAMEK.weather.fade * 0.7;
    this.broadcastAll({ t: NS2C.WEATHER, id, w: agora });
    this.log(`namek — clima: ${id}`);

    /* E O CLIMA É O GATILHO DO FIM. `tempestade` já era, por escrito, "o planeta
       indo embora… é a batalha contra Freeza nos cinco minutos finais" (§1 do
       plano) — pendurar o Freeza nela é o que faz o botão que já existe
       significar o que ele sempre disse. `dia` desfaz. Ver `server/namek/fim.js`.
       Aqui embaixo, e não antes das travas: só o clima que de fato MUDOU (a
       carência de `weather.fade` já filtrou o clique repetido) pode ligar ou
       desligar uma máquina de estados. */
    this.fim.clima(id, agora);
  }

  /* ================================================================ dano == */

  /**
   * Tira vida de alguém, e resolve a morte se ela vier. **O caminho único.**
   *
   * Rajada, feixe, onda e queda passam todos por aqui — é o que garante que a
   * invulnerabilidade, o placar, o `HURT` e o `DEATH` tenham UMA implementação
   * só. A sala do arqueiro aprendeu isso da forma cara (ver `emptyScore`, que
   * existe porque a mesma coisa estava escrita em dois lugares e as duas cópias
   * divergiram).
   *
   * @param {object} vitima
   * @param {number} dano
   * @param {object} ctx `{ por, kind, p, d, continuo }` — `continuo` é o feixe,
   *   que cobra por quadro e por isso não pode acender um `HURT` por quadro.
   */
  aplicarDano(vitima, dano, { por = null, kind = "blast", p = null, d = null, continuo = false } = {}) {
    if (!vitima?.alive) return 0;
    const agora = this.now();
    if (agora < vitima.invulnUntil) return 0;
    /* **"ELE FICA INVENCÍVEL ENQUANTO ESTÁ SE TRANSFORMANDO."** Os três segundos
       do Super Saiyajin, no mesmo funil da invulnerabilidade de nascimento e uma
       linha abaixo dela, porque as duas dizem exatamente a mesma coisa: nada
       acerta este corpo agora. Ver `server/namek/ssj.js: invencivel`. */
    if (SSJ.invencivel(vitima, agora)) return 0;
    if (!(dano > 0)) return 0;

    /* ===================================================== O FOGO AMIGO =====
     *
     * *"No modo de batalha contra o Freeza os players podem atacar outros
     * players se eles quiserem."*
     *
     * **Ele já é assim, e nunca deixou de ser** — este parágrafo existe porque a
     * ausência de uma regra é invisível, e alguém vai voltar aqui procurando por
     * ela. As únicas saídas antecipadas deste funil são as quatro logo acima:
     * vítima morta, vítima invulnerável (o piscar do nascimento), vítima no meio
     * da própria transformação, e dano não positivo. Nenhuma delas olha para
     * QUEM bateu, e não existe em lugar nenhum deste arquivo um conceito de
     * time, aliado ou trégua — `registrarAcerto` e `registrarQueimadura` só
     * recusam a vítima que é o próprio atirador (`vitima === player`), que é
     * outra coisa: é não deixar ninguém acertar a si mesmo.
     *
     * E a entrada do Freeza não muda nada disso: o boss não passa por este
     * método (ele tem `NamekFreeza.levarDano`), não entra em `todos()` e não é
     * consultado aqui. Com ele em campo, duas pessoas continuam podendo brigar
     * exatamente como brigavam antes — que é o pedido.
     *
     * NÃO PROCURE AQUI, também, o multiplicador do Super Saiyajin contra o
     * chefe: contra outro JOGADOR ele é 1 de propósito (ver o parágrafo final de
     * `NAMEK.ssj.danoNoFreeza`), e contra o boss ele entra no funil de lá. */

    /* A GUARDA APARA AQUI, no funil, e não em cada fonte de dano.
     *
     * Rajada, feixe, disco, esfera, onda e queda passam todos por este método —
     * é o que o cabeçalho promete —, e é por isso que a defesa precisa de uma
     * linha só para valer contra tudo. Aparar dentro de cada golpe seria seis
     * implementações da mesma regra, e a sétima (a que alguém acrescentar
     * amanhã) nasceria sem defesa nenhuma e ninguém notaria. */
    const aparado = this.defendendo(vitima);
    if (aparado) dano *= NAMEK.guard.damage;

    vitima.health -= dano;
    if (vitima.isBot) vitima.machucar();

    if (vitima.health <= 0) {
      vitima.health = 0;
      this.matar(vitima, por, kind, p, d, agora);
      return dano;
    }

    /* O `HURT` é o clarão vermelho e o número subindo — é FEEL, não estado (o
       estado vai no `VITALS` a 10 Hz de qualquer jeito). Por isso o golpe
       discreto acende na hora, e o feixe — que cobraria vinte vezes por segundo
       — acumula e acende a 6 Hz. Sem essa distinção, três segundos de
       Kamehameha em dois alvos são 120 mensagens que dizem a mesma coisa. */
    if (continuo) {
      /* O FEIXE TAMBÉM DERRUBA, e ele conta a cada quadro — não a cada `HURT`.
         O `HURT` sai a 6 Hz por economia de rede (é o clarão vermelho, não o
         estado); a contagem é sobre o DANO, e o dano do feixe acontece vinte
         vezes por segundo. Contar no ritmo da mensagem faria um Kamehameha
         derrubar três vezes mais devagar do que ele machuca. */
      if (!aparado) this.contarGolpe(vitima, por, agora, dano);
      vitima.dorAcum += dano;
      vitima.dorPor = por?.id ?? null;
      vitima.dorKind = kind;
      if (agora < vitima.dorAte) return dano;
      vitima.dorAte = agora + 160;
      this.broadcastAll({
        t: NS2C.HURT,
        id: vitima.id,
        health: Math.round(vitima.health),
        by: vitima.dorPor,
        amount: Math.round(vitima.dorAcum),
        kind: vitima.dorKind,
        g: aparado ? 1 : 0,
      });
      vitima.dorAcum = 0;
      return dano;
    }

    this.broadcastAll({
      t: NS2C.HURT,
      id: vitima.id,
      health: Math.round(vitima.health),
      by: por?.id ?? null,
      amount: Math.round(dano),
      kind,
      /* APARADO. Um bit, e ele existe porque a guarda precisa ser AUDÍVEL: sem
         ele, aparar um Kienzan e levá-lo na cara soam igual, e o jogador não
         tem como aprender que o botão fez alguma coisa. A vida já diz (o dano
         caiu para 22 %), mas ninguém lê número no meio de uma briga. */
      g: aparado ? 1 : 0,
    });
    /* A CONTAGEM SÓ VÊ GOLPE DISCRETO, e o `continuo` acima já saiu com o
       `return` dele. É a distinção certa: o feixe cobra vinte vezes por segundo
       e derrubaria alguém em um quarto de segundo de exposição, o que faria do
       atordoamento um efeito colateral do Kamehameha em vez da janela que
       existe para o Kamehameha poder sair. Rajada, disco, esfera e onda contam;
       feixe, não. */
    if (!aparado) this.contarGolpe(vitima, por, agora, dano);
    return dano;
  }

  /**
   * Está com a guarda de pé?
   *
   * Lida da POSE (bit 8 de `packFighter`) para o humano e do campo direto para o
   * bot — a mesma divisão que `economiaDeKi` já faz com o arranque e a carga, e
   * pela mesma razão: a pose chega 20 vezes por segundo e se conserta sozinha.
   *
   * **E ela exige ki.** Sem essa segunda metade, um cliente que mentisse o bit
   * defenderia de graça e para sempre: com ela, a mentira é autolimitada, porque
   * quem defende paga `guard.drain` por segundo em `economiaDeKi` e a barra
   * chega a zero em menos de cinco segundos. É o mesmo modelo de confiança do
   * resto do modo — o cliente declara, a sala cobra.
   */
  defendendo(f) {
    if (!f?.alive || f.ki <= 0) return false;
    if (this.atordoado(f)) return false; // caído não tem guarda
    if (f.isBot) return f.defendendo === true;
    return (((f.state?.b ?? 0) & 8) === 8);
  }

  /**
   * Mais castigo na conta — e a queda, quando ela fecha.
   *
   * **A conta é de DANO, medida em rajadas.** Uma bola de ki (6 de dano) vale
   * exatamente um golpe, e é daí que sai o "cinco poderes seguidos" do pedido;
   * um Kienzan (48), um Galick Gun (62) ou uma Genki Dama (96) valem mais de
   * cinco sozinhos e derrubam no impacto; e um feixe, que cobra por quadro, vai
   * somando até fechar os trinta.
   *
   * Foi assim, e não com um contador de acertos, porque a regra que o usuário
   * descreveu tem DUAS metades que precisam ser a mesma linha de código:
   * "cinco poderes pequenos seguidos derrubam" e "um poder grande derruba de
   * uma vez". Com um contador de eventos, a Genki Dama valeria 1 de 5 e uma
   * bolinha valeria o mesmo — e o golpe mais caro do jogo não interromperia
   * nada. Contando dano, as duas metades caem sozinhas da mesma conta.
   *
   * A janela DESLIZA: cada acerto empurra o prazo para `window` segundos à
   * frente, e um intervalo maior que isso zera a conta. É o que separa "estou
   * sendo metralhado" de cinco tiros espalhados por uma partida inteira, que é
   * a única leitura que faz do golpe uma coisa merecida.
   *
   * Ver `NAMEK.fighter.stagger` para a razão de cada número, e o §6 do plano
   * para por que o modo precisava disto: a 64 m/s ninguém acerta um especial em
   * quem tem o controle do próprio corpo.
   *
   * @param {number} dano o dano JÁ aparado pela guarda, se houve guarda
   */
  contarGolpe(vitima, por, agora, dano) {
    const S = NAMEK.fighter.stagger;
    if (!vitima.alive) return;
    if (!(dano > 0)) return;
    /* Já está caído, ou acabou de levantar: a contagem nem começa. Sem esta
       linha, os golpes que chovem EM CIMA de quem está no chão — e eles chovem,
       porque é para isso que a janela existe — reiniciariam o relógio a cada
       cinco, e o corpo nunca mais se levantaria. */
    if (agora < vitima.tontoLivreEm) return;

    if (agora > vitima.golpeAte) vitima.golpes = 0;
    /* Em RAJADAS: o dano dividido pelo dano de uma bola de ki. É o que faz a
       mesma linha atender "cinco pequenos" e "um grande" — ver o cabeçalho. */
    vitima.golpes += dano / NAMEK.blast.damage;
    vitima.golpeAte = agora + S.window * 1000;
    if (vitima.golpes < S.hits) return;

    this.derrubar(vitima, por, agora);
  }

  /** Põe alguém no chão por `stagger.time` segundos. O caminho único. */
  derrubar(vitima, por, agora) {
    const S = NAMEK.fighter.stagger;
    vitima.golpes = 0;
    vitima.golpeAte = 0;
    /* O MÍNIMO garantido pela sala. O fim de verdade quem diz é o corpo, pelo
       bit 4 da pose — a queda de trezentos metros dura mais que isto. Ver
       `atordoado` e `relogioDaQueda`. */
    vitima.tontoAte = agora + S.time * 1000;
    vitima.tontoLivreEm = vitima.tontoAte + S.immune * 1000;
    /* O ESPECIAL EM CURSO MORRE JUNTO. Ele é o registro que autoriza o
       `SPECIAL_HIT` a cobrar dano (ver `registrarEspecial`): mantê-lo vivo
       deixaria um feixe continuar queimando gente a partir de um corpo caído no
       chão — o golpe cobrando por um lutador que já não existe. */
    vitima.especial = null;
    if (vitima.isBot) vitima.derrubar(S.time);

    /* DERRUBAR ENCHE A BARRA DE QUEM DERRUBOU. É o pedido literal — "o ki dele
     * é completamente restaurado para que ele possa em sequência soltar um
     * poder maior enquanto o player está atordoado" — e é a peça que fecha o
     * ciclo do modo.
     *
     * Sem ela, a janela existia e era inútil na prática: derrubar alguém custa
     * cinco bolas de ki (10 da barra) ou um especial (a barra inteira), e o
     * especial que a janela foi criada para permitir exige a barra CHEIA. Ou
     * seja, quem acabava de derrubar alguém era exatamente quem NÃO tinha com o
     * que aproveitar — e encher a barra leva 5,3 s, mais que o dobro dos 2,4 s
     * em que a vítima fica no chão. A recompensa chegava sempre tarde demais.
     *
     * É uma recompensa grande, e ela se paga sozinha: derrubar exige 30 de dano
     * dentro de uma janela de 2,6 s, com a vítima sem guarda, e não pode ser
     * repetido na mesma pessoa por 6 s (`stagger.immune`). Quem consegue isso
     * ganhou o direito ao golpe grande. E o `ultimoGasto` é zerado junto, senão
     * a regeneração passiva ficaria bloqueada pelo próprio presente.
     *
     * Só para quem NÃO é a vítima, obviamente: uma queda por dano de queda ou
     * por onda própria não premia ninguém. */
    if (por && por !== vitima && por.alive) {
      por.ki = NAMEK.ki.max;
      por.ultimoGasto = -Infinity;
    }

    this.broadcastAll({
      t: NS2C.STAGGER,
      id: vitima.id,
      by: por && por !== vitima ? por.id : null,
      s: S.time,
      w: agora,
    });
  }

  /**
   * Está caído AGORA? Quem está, não atira, não solta especial e não cava.
   *
   * **A queda tem duração VARIÁVEL, e por isso são duas fontes.** Quem é
   * derrubado a trezentos metros passa cinco segundos despencando antes de os
   * 2,4 s no chão começarem a contar (ver `FighterController.derrubar`, que
   * explica por que o relógio só anda com os pés no chão). A sala não tem como
   * saber de antemão quanto tempo a queda leva — ela nem sabe a que altura o
   * lutador estava quando o quinto golpe chegou.
   *
   * Então: `tontoAte` é o MÍNIMO garantido pela sala, e o bit 4 da pose é o
   * lutador dizendo "ainda estou no chão". A união dos dois é a resposta. Um
   * cliente que mentisse o bit só conseguiria voltar a atirar no mínimo — nunca
   * antes dele —, que é o mesmo teto de sempre: o cliente pode se prejudicar,
   * não se privilegiar.
   */
  atordoado(f, agora = this.now()) {
    if (agora < (f.tontoAte ?? 0)) return true;
    if (f.isBot) return f.tonto > 0;
    return (((f.state?.b ?? 0) & 4) === 4);
  }

  /**
   * O relógio da CARÊNCIA, que só pode começar quando o corpo se levanta.
   *
   * `stagger.immune` é a trava que impede dois atiradores de manter um terceiro
   * no chão para sempre, e ela conta a partir do momento em que ele LEVANTA —
   * não do instante em que a sala imaginou que ele levantaria. Como a queda tem
   * duração variável, a única forma de acertar isso é observar a borda: enquanto
   * `atordoado` for verdade, a carência é empurrada para a frente.
   *
   * Uma passada por quadro sobre quinze lutadores, sem alocar nada.
   */
  relogioDaQueda(agora) {
    for (const f of this.todos()) {
      if (!f.alive) continue;
      if (!this.atordoado(f, agora)) continue;
      f.tontoLivreEm = agora + NAMEK.fighter.stagger.immune * 1000;
    }
  }

  /** A morte: placar, aviso e o relógio do renascimento. */
  matar(vitima, por, kind, p, d, agora) {
    vitima.alive = false;
    vitima.health = 0;
    vitima.score.deaths++;
    vitima.respawnAt = agora + NAMEK.respawn.delay * 1000;
    vitima.dorAcum = 0;
    /* Morrer apaga o atordoamento inteiro, inclusive a carência: o corpo que
       renasce é um corpo novo, e ele nasce piscando (`respawn.invuln`), que já é
       a proteção daquele instante. Guardar a carência através da morte daria a
       quem acabou de morrer seis segundos de imunidade a queda de graça. */
    vitima.golpes = 0;
    vitima.golpeAte = 0;
    vitima.tontoAte = 0;
    vitima.tontoLivreEm = 0;
    /* Não há nada do FIM a zerar aqui, e vale dizer por quê: havia um
       `this.fim.morreu(vitima)` limpando o relógio de subida daquele lutador.
       A fuga virou altitude pura (ver `NAMEK.fim.fuga`) — não há relógio pessoal
       para uma morte apagar, e quem morre já é levado para longe do portal pelo
       renascimento. */
    if (vitima.isBot) vitima.cair();
    /* MORRER DESLIGA O SUPER SAIYAJIN — ver o §"quando ela ACABA" em
       `NAMEK.ssj`. **Calado**, e é de propósito: o `DEATH` já sai neste mesmo
       quadro e o `nascer` devolve vida cheia logo atrás, então um `SSJ_OFF` no
       meio contaria uma terceira versão da mesma vida para o HUD — que
       apareceria como a barra caindo, subindo e caindo de novo. O cliente
       desliga sozinho no `morrer`, pelo mesmo raciocínio. */
    SSJ.apagar(this, vitima, true);
    const corpo = this.corpoPorId.get(vitima.id);
    /* O corpo do QUADRO EM CURSO morre junto. Sem isto, uma segunda bola que
       chegasse no mesmo passo ainda encontraria a vítima "viva" na lista
       uniforme e cobraria o abate de novo — dois `DEATH` para uma morte. */
    if (corpo) corpo.alive = false;

    if (por && por !== vitima) {
      por.score.kills++;
      if (por.isBot) por.tDecisao = 0; // procura o próximo na hora

      /* MATAR NÃO ENCHE A BARRA — e isto é uma linha REMOVIDA de propósito.
       *
       * Havia aqui um `por.ki = NAMEK.ki.max`: quem matava alguém recebia a
       * barra cheia no instante do abate, do mesmo jeito que quem DERRUBA
       * alguém recebe em `derrubar`. O pedido desfez metade disso: *"ao matar um
       * player o ki não deve se regenerar — somente quando o player derruba, que
       * já é hoje."*
       *
       * E o pedido tem razão, porque os dois prêmios não pagam a mesma coisa. O
       * de `derrubar` compra uma JANELA: a vítima fica 2,4 s no chão e a barra
       * cheia é o que permite gastar essa janela num especial, que é a razão de
       * o atordoamento existir (ver `NAMEK.fighter.stagger`). Já o do abate não
       * comprava nada — o adversário sumiu do mapa por cinco segundos, não há
       * janela para aproveitar —, e ele empilhava: quase toda morte deste modo
       * chega logo depois de uma queda, então quem matava recebia a barra cheia
       * DUAS vezes seguidas pelo mesmo combate.
       *
       * O que sobra é o ciclo certo: derrubar paga o golpe grande, e o golpe
       * grande é que mata. Quem mata sem derrubar volta a carregar como todo
       * mundo.
       *
       * **Só o prêmio saiu.** O resto da economia continua igual: a vítima
       * renasce com a barra cheia (`nascer`), e a regeneração passiva continua
       * existindo para ninguém ficar preso em zero (`economiaDeKi`). */
    }

    const ponto = p ?? this.pontoDe(vitima);
    this.broadcastAll({
      t: NS2C.DEATH,
      victim: vitima.id,
      killer: por && por !== vitima ? por.id : null,
      kind,
      p: [round(ponto.x), round(ponto.y), round(ponto.z)],
      /* A direção do golpe. O protocolo é explícito: "é ela que joga o corpo
         para o lado certo" — sem ela todo mundo cai em pé, para baixo. */
      d: d ? [round(d[0]), round(d[1]), round(d[2])] : [0, 1, 0],
    });
    this.broadcastScores();
  }

  /**
   * Uma cor livre da paleta. Nunca falha: com a paleta vazia, sorteia.
   *
   * `shift` e não `pop`: a `PALETA` está escrita na ordem em que as cores devem
   * ser entregues (o laranja do personagem primeiro — ver o comentário lá), e
   * tirar do fim entregava a lista ao contrário. O sintoma era o primeiro
   * lutador da sala nascendo verde-limão em vez de com o gi do personagem.
   */
  tomarCor() {
    return this.cores.shift() ?? PALETA[(Math.random() * PALETA.length) | 0];
  }

  /** Devolve a cor de quem saiu, para quem chegar depois. */
  devolverCor(cor) {
    if (cor && !this.cores.includes(cor) && PALETA.includes(cor)) this.cores.push(cor);
  }

  /** Quem tem este id — humano OU bot. */
  lutadorPor(id) {
    for (const p of this.players.values()) if (p.id === id) return p;
    return this.bots.byId(id);
  }

  /** Todo mundo em campo, humano e bot, num laço só. */
  *todos() {
    for (const p of this.players.values()) yield p;
    for (const b of this.bots.list) yield b;
  }

  /** A posição de qualquer corpo, venha ela da rede ou da memória. */
  pontoDe(f) {
    if (f.isBot) return { x: f.position.x, y: f.position.y, z: f.position.z };
    const s = f.state;
    return s ? { x: s.p[0], y: s.p[1], z: s.p[2] } : { x: 0, y: 0, z: 0 };
  }

  /* ========================================================= renascimento == */

  renascimentos(agora) {
    for (const f of this.todos()) {
      if (f.alive || !f.respawnAt || agora < f.respawnAt) continue;
      this.nascer(f, agora);
    }
  }

  /**
   * Põe alguém em campo — na entrada e depois de cada morte, pelo mesmo caminho.
   *
   * Nasce-se **voando**, a `dropHeight` do chão: o modo é aéreo e um lutador
   * que aparece de pé na grama passa os primeiros segundos subindo em vez de
   * jogando. E longe de todo mundo, que é o que impede o renascimento de virar
   * a continuação da morte anterior.
   */
  nascer(f, agora = this.now()) {
    const ocupados = [];
    for (const c of this.todos()) {
      if (c === f) continue;
      const p = this.pontoDe(c);
      if (c.alive) ocupados.push(p);
    }
    /* DEPOIS QUE O PLANETA ACABA, nasce-se no ESPAÇO — é a última frase do
       pedido ("depois eles reaparecem no espaço"). `fim.nascimento()` devolve
       null enquanto houver chão, e aí o caminho é o de sempre: um ponto plano
       longe de todo mundo. Um `??` no lugar de um `if` porque é exatamente isso
       que ele diz — o espaço quando existe, o planeta quando não. */
    const p = this.fim.nascimento() ?? melhorNascimento(this.field, ocupados);
    const invulnUntil = agora + NAMEK.respawn.invuln * 1000;

    f.alive = true;
    f.health = NAMEK.fighter.maxHealth;
    f.ki = NAMEK.ki.max;
    f.invulnUntil = invulnUntil;
    f.respawnAt = 0;
    f.ultimoGasto = -Infinity;
    f.dorAcum = 0;
    f.especial = null;
    f.golpes = 0;
    f.golpeAte = 0;
    f.tontoAte = 0;
    f.tontoLivreEm = 0;
    /* O corpo que nasce é um corpo NOVO: teto de vida base, barra sem desconto,
       cabelo preto. Aqui e não só em `matar` porque `nascer` é o caminho único
       da entrada E de todo renascimento — e é ele que também dá os campos a quem
       está entrando pela primeira vez, humano ou bot. */
    SSJ.limpar(f);
    if (f.isBot) f.renascer(p.x, p.y, p.z, invulnUntil);

    /* Encara o meio da arena. Mesma razão do bot: nascer de costas para a
       briga é nascer gastando meio segundo girando. */
    const yaw = Math.atan2(p.x, p.z);
    this.broadcastAll({
      t: NS2C.SPAWN,
      id: f.id,
      p: [round(p.x), round(p.y), round(p.z)],
      yaw: round(yaw),
      invulnUntil,
    });
  }

  /* ============================================================ crateras == */

  /**
   * Carimba uma cratera e a manda para TODOS.
   *
   * O id incremental é o contrato do §7: os dois lados chegam ao mesmo buraco a
   * partir de (id, x, z, potência), e `NamekField.addCrater` é idempotente por
   * id justamente porque quem atirou já a aplicou localmente para não esperar o
   * retorno da rede. Mandar de volta para o autor não é desperdício — é o que
   * dá a ele o id oficial.
   */
  /**
   * @param {number} [fundo] multiplicador SÓ da profundidade, declarado por quem
   *   atirou. É como o Kamehameha pede um buraco estreito e fundo em vez de um
   *   largo e raso — a potência sozinha move raio e fundura juntos. Ver
   *   `craterFor`, que é quem o apara em [0,25 · 6]: aparar aqui de novo seria
   *   um segundo limite para manter em dia.
   */
  cratera(x, z, power, dono = null, fundo = 1) {
    /* SEM PLANETA NÃO HÁ BURACO. Um Kamehameha disparado para baixo lá do
       espaço ainda alcança as coordenadas do antigo chão (1 860 m de alcance
       contra 2 250 m de altura, mas basta mergulhar um pouco), e o cliente
       relataria o toque no relevo que o campo continua sabendo calcular. */
    if (this.fim.noEspaco) return null;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(power)) return null;
    if (x * x + z * z > NAMEK.world.radius ** 2) return null;
    const p = clamp(power, 0, 64);
    if (p <= 0) return null;

    /* GOLPE FRACO NÃO GASTA VAGA. O corte é o mesmo dos dois lados — o cliente
       nem chega a pedir (ver `craterMinPower` e o `reportar` do laço), e aqui
       ele vale também para o BOT, que fala com a sala por dentro e não passa por
       aquele caminho. Sem esta linha, quinze bots atirando a 6/s continuariam
       girando a fila de 96 crateras sozinhos, e a destruição dos especiais
       apagaria na frente de todo mundo do mesmo jeito. */
    if (p < NAMEK.destruction.craterMinPower) return null;

    /* A COTA VALE PARA TODA CRATERA, não só para as pequenas.
     *
     * A condição era `p < 1`, o que deixava a porta escancarada justamente para
     * as grandes: 60 pedidos de potência 16 em 1,2 s viravam 54 crateras — o
     * teto de 96 da sala gasto em dois segundos, e a malha do terreno de TODOS
     * os clientes re-esculpida 54 vezes seguidas. A rajada legítima continua
     * passando inteira pela folga de meio segundo do balde, e um especial de
     * verdade sai muitas vezes abaixo do limite. */
    if (dono && !this.podeCravar(dono, p)) return null;

    /* A cota é medida ANTES de o buraco existir. Depois de `addCrater` o
       `heightAt` deste ponto já é o fundo da cratera, e mandar isso faria a
       poeira e as pedrinhas nascerem alguns metros abaixo do chão que estourou
       — dentro da própria cratera, invisíveis. */
    const y = this.field.heightAt(x, z);

    const id = proximaCratera++;
    const c = this.field.addCrater(id, x, z, p, fundo);
    if (!c) return null;
    this.crateras++;

    this.broadcastAll({
      t: NS2C.CRATER,
      i: id,
      p: [round(x), round(y), round(z)],
      power: round(p),
      /* O multiplicador de fundura VIAJA junto com a potência, e tem de viajar:
         os dois lados chegam ao mesmo buraco a partir de (id, x, z, potência),
         e desde que existe um segundo número na conta ele é parte do contrato.
         Sem ele, quem atirou veria o poço do Kamehameha e todo mundo veria uma
         bacia rasa no mesmo lugar. Só sai da mensagem quando é 1, que é o caso
         de quase toda cratera — ver o `?? 1` do lado do cliente. */
      df: fundo !== 1 ? round(fundo) : undefined,
      /* QUEM abriu. O cliente já desenhou a poeira e já tocou o estouro do
         PRÓPRIO golpe no instante do impacto — ele não espera a rede para isso.
         Sem este campo ele não tem como saber que a cratera que volta é a dele,
         e o estouro sairia duas vezes: uma na hora e outra meio segundo depois.
         Um número por cratera, e crateras são raras. */
      by: dono?.id ?? null,
    });
    return c;
  }

  /**
   * A dificuldade dos bots, pedida por alguém no menu.
   *
   * Da SALA, como o clima, e retransmitida a todos: os bots são de todos, e um
   * menu mostrando o nível que aquela pessoa pediu por último em vez do que
   * está valendo seria a pior forma de mentir — a que o jogador só descobre
   * apanhando.
   *
   * Sem carência de tempo, ao contrário do clima. Lá ela existe porque a
   * transição de céu dura oito segundos e um pedido novo no meio dela não
   * descreve nada que dê para ver; aqui a troca é instantânea por construção
   * (são multiplicadores lidos no quadro em que são usados), então segurar o
   * botão só produziria a mesma sala, escrita de novo. O que protege contra o
   * clique repetido é `setDificuldade` devolver false quando o nível já é o
   * corrente — e aí não há retransmissão nenhuma.
   */
  pedirDificuldade(id) {
    if (!this.bots.setDificuldade(id)) return;
    this.broadcastAll({ t: NS2C.DIFFICULTY, id: this.bots.dificuldadeId });
    this.log(`namek — bots: ${this.bots.dificuldadeId}`);
  }

  /** O balde de crateras pequenas de um lutador. Ver `CRATERAS_POR_SEGUNDO`. */
  /**
   * @param {number} power a potência da cratera — é ela que escolhe o BALDE.
   *   Ver `CRATERAS_GRANDES_POR_SEGUNDO`: a rajada e o especial disputavam a
   *   mesma fila, e como a rajada sai a 6/s contra um teto de 5/s ela vencia
   *   sempre. A Genki Dama de quem tinha acabado de atirar era descartada em
   *   silêncio.
   */
  podeCravar(f, power = 0) {
    const agora = this.now();

    /* O BALDE DOS GRANDES. Separado, lento, e a rajada não o toca. */
    if (power >= POTENCIA_GRANDE) {
      const passoG = 1000 / CRATERAS_GRANDES_POR_SEGUNDO;
      const baseG = Math.max(f.crateraGrandeAte ?? 0, agora - passoG);
      if (baseG > agora) return false;
      f.crateraGrandeAte = baseG + passoG;
      return true;
    }

    const passo = 1000 / CRATERAS_POR_SEGUNDO;
    /* Balde com folga: rajadas curtas passam inteiras, spray contínuo é aparado.
     *
     * A FOLGA CRESCE ENQUANTO UM GOLPE PERFURANTE ESTÁ NO AR, e isto não é uma
     * porta dos fundos — é o balde deixando de aparar o que ele nunca quis
     * aparar. Ele foi dimensionado contra a RAJADA (6 tiros/s por pessoa, quinze
     * pessoas), e o comentário de `CRATERAS_POR_SEGUNDO` diz isso: "golpe GRANDE
     * passa sempre, ele acontece uma vez por barra cheia e a cratera dele é o
     * assunto do golpe".
     *
     * O Kamehameha perfurante é um golpe grande que pede VINTE buracos em vez de
     * um — o corredor que ele abre na montanha é uma fila de crateras a cada
     * sete metros de rocha (ver `atravessar`, em `powers/beam.js`). Com meio
     * segundo de folga, dois passavam e o resto era descartado: o feixe
     * atravessava o morro e deixava dois furos soltos em vez de um túnel.
     *
     * O sinal que separa os dois casos é o que a sala JÁ registra: `especial` é
     * o golpe em curso daquele lutador, com a janela de tempo dele
     * (`registrarEspecial`), e ele só existe porque custou a barra cheia. Quatro
     * segundos de folga cobrem o corredor inteiro de um disparo e nada mais —
     * quando a janela do especial fecha, o balde volta ao tamanho de sempre.
     *
     * O teto do abuso continua sendo o mesmo de antes: quem mentir sobre o ponto
     * ainda esbarra no alcance máximo (`registrarChao`) e ainda precisa ter
     * gastado a barra inteira para abrir a janela. */
    const perfurando =
      f.especial && f.especial.info?.atravessar && agora <= f.especial.ate;
    const folga = perfurando ? 4000 : 500;
    const base = Math.max(f.crateraAte ?? 0, agora - folga);
    if (base > agora) return false;
    f.crateraAte = base + passo;
    return true;
  }

  /* ============================================================== os bots == */

  /**
   * O que um bot fez, virando efeito de sala.
   *
   * Este método é a fronteira entre `bots.js` e o protocolo: o bot emite coisas
   * SEMÂNTICAS ("atirei", "acertei", "bati no chão") e é aqui que elas viram
   * mensagem e viram vida perdida. `bots.js` não conhece uma única constante de
   * `NS2C` — é o que permite mexer na IA sem nunca pensar em rede, e mexer na
   * rede sem nunca abrir a IA.
   */
  doBot(ev, agora) {
    const dono = this.bots.byId(ev.dono);
    if (!dono) return;

    switch (ev.tipo) {
      case "rajada":
        this.broadcastAll({
          t: NS2C.BLAST,
          owner: dono.id,
          id: ev.id,
          o: vec(ev.o),
          d: vec(ev.d),
          hand: ev.hand,
          target: ev.alvo,
          w: agora,
        });
        break;

      case "especial":
        this.broadcastAll({
          t: NS2C.SPECIAL,
          owner: dono.id,
          kind: ev.kind,
          o: vec(ev.o),
          d: vec(ev.d),
          /* O ALVO, que faltava — e a falta era visível: sem este campo o
             cliente recebia `target: undefined`, e o especial de todo bot voava
             RETO na tela enquanto o mesmo golpe de um humano contornava. Um
             Kienzan de bot e um Kienzan de gente eram dois golpes diferentes.
             `alvoId` é a trava do bot; é o que a tecla R é para o humano. */
          target: ev.alvo ?? null,
          w: agora,
        });
        break;

      case "acerto": {
        /* O BOSS não é um lutador (`lutadorPor` não o acha, de propósito — ver
           o §1 de `freeza.js`), então o acerto de um bot nele precisa desta
           linha para não se perder em silêncio. É a metade "inclusive os bots"
           do pedido chegando à barra de vida. */
        if (this.freeza.ehAlvo(ev.vitima)) {
          this.freeza.acertoDeBot(ev, dono);
          break;
        }
        const vitima = this.lutadorPor(ev.vitima);
        if (!vitima) break;
        this.aplicarDano(vitima, ev.dano, {
          por: dono,
          kind: ev.kind,
          p: { x: ev.p[0], y: ev.p[1], z: ev.p[2] },
          d: ev.d,
          /* O feixe cobra por quadro; a bola cobra de uma vez. É o mesmo
             critério do `SPECIAL_HIT` que chega dos humanos — e agora quem
             responde é o EMISSOR, em vez de ser deduzido do nome do golpe.
             A dedução funcionava por acidente: tudo o que voava saía daqui
             chamado de `"blast"`, então "não é blast" e "é feixe" davam o mesmo
             resultado. No dia em que o Galick Gun de um bot passou a viajar com
             o próprio nome (era preciso, senão o boss o cobrava como bolinha —
             ver `passoDasBolas`), a dedução passaria a chamar de contínuo um
             golpe que acontece uma vez só. */
          continuo: ev.continuo === true,
        });
        break;
      }

      case "chao":
        this.cratera(ev.p[0], ev.p[2], ev.poder, dono);
        break;

      case "onda":
        this.onda(dono, { x: ev.p[0], y: ev.p[1], z: ev.p[2] });
        break;

      default:
        break;
    }
  }

  /**
   * A explosão de ki: empurra quem está perto e machuca pouco.
   *
   * Vale para humano e bot pelo mesmo caminho. O empurrão só é APLICADO de
   * verdade nos bots — o humano é dono da própria pose (§8), então para ele a
   * onda viaja como evento e quem move o corpo é o cliente dele. É a mesma
   * divisão do knockback do arqueiro, e tentar corrigir a posição do humano
   * daqui seria o servidor brigando com a predição do cliente pelo controle do
   * boneco, que é a receita clássica da borracha.
   */
  onda(dono, p) {
    const K = NAMEK.ki;
    const agora = this.now();
    this.broadcastAll({
      t: NS2C.BURST,
      owner: dono.id,
      p: [round(p.x), round(p.y), round(p.z)],
      w: agora,
    });

    for (const c of this.corpos) {
      if (c.id === dono.id || !c.alive) continue;
      const dx = c.x - p.x;
      const dy = c.y + NAMEK.fighter.chest - p.y;
      const dz = c.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > K.burstRadius) continue;

      /* ================================================ E ELA DERRUBA ======
       *
       * *"Se esse flash pegar, além de afastar, o player é derrubado. Inclusive
       * o Freeza pode ser derrubado se esse flash pegar. Derrubado é igual
       * acontece quando o player leva cinco ataques consecutivos: ele cai no
       * chão, abre a cratera e tudo mais."*
       *
       * É o pedido mudando a natureza do gesto: a onda era uma DEFESA de
       * pressão — empurra, tira pouco, compra espaço — e vira também uma
       * abertura. E a queda é a MESMA de sempre, pelo mesmo caminho
       * (`this.derrubar`), o que significa que ela traz tudo junto de graça: o
       * `NS2C.STAGGER` para todas as telas, os 2,4 s no chão, a cratera que o
       * corpo abre ao bater, a imunidade de 6 s contra ser derrubado de novo, o
       * especial em curso da vítima morrendo — e a barra de ki de quem derrubou
       * enchendo, que é o prêmio que fecha o ciclo do modo.
       *
       * Ela é chamada ANTES do dano de propósito. `aplicarDano` pode matar, e
       * `derrubar` num cadáver escreveria relógios num corpo que `nascer` vai
       * zerar meio segundo depois — o `STAGGER` sairia atrás do `DEATH`, e a
       * tela da vítima mostraria o tombo de um corpo que já explodiu.
       *
       * O que a mantém equilibrada é o preço, e ele não mudou: 25 de ki, catorze
       * metros de raio, e é preciso estar COLADO em alguém. A carência de
       * `stagger.immune` continua valendo, então duas pessoas revezando ondas
       * não prendem ninguém no chão. */
      if (c.boss) {
        /* **O BOSS, pelo caminho dele.** Ele não passa por `aplicarDano` (o
           `ref` dele é um espantalho morto, ver `NamekFreeza.corpoNaLista`) e
           não podia passar por `derrubar` tampouco — aquele método escreve
           `tontoAte`, `golpes` e `especial` num objeto que o boss não tem. O
           tombo dele é resolvido lá dentro, com o relógio dele e a cratera dele.
           Ver `NamekFreeza.derrubar`. */
        this.freeza?.derrubar?.(agora);
        continue;
      }
      /* Queda linear do centro à borda: quem está no olho da onda leva tudo,
         quem está raspando leva um empurrãozinho. */
      const f = 1 - d / K.burstRadius;
      const inv = d > 1e-3 ? 1 / d : 0;
      if (c.ref.isBot) {
        // Quem está de guarda também é MENOS empurrado — ver `NAMEK.guard.push`.
        const v = K.burstPush * f * (this.defendendo(c.ref) ? NAMEK.guard.push : 1);
        c.ref.velocity.x += dx * inv * v;
        c.ref.velocity.y += dy * inv * v + v * 0.35;
        c.ref.velocity.z += dz * inv * v;
      }
      /* A GUARDA AINDA VALE CONTRA A QUEDA, e ela é a única defesa que existe
         contra este golpe: `contarGolpe` já ignora golpe aparado ("é a razão de
         existir do botão — quem lê a investida a tempo não vai ao chão"), e
         seria incoerente que a onda passasse por cima disso. Quem está de
         braços cruzados é empurrado menos, leva 22 % do dano e fica de pé. */
      if (!this.defendendo(c.ref) && this.now() >= (c.ref.tontoLivreEm ?? 0)) {
        this.derrubar(c.ref, dono, agora);
      }
      this.aplicarDano(c.ref, K.burstDamage * f, {
        por: dono,
        kind: "burst",
        p: { x: c.x, y: c.y, z: c.z },
        d: [dx * inv, dy * inv, dz * inv],
      });
    }
  }

  /** Põe um lutador de CPU em campo, visível para a sala inteira. */
  addBot() {
    /* BOT É CRIATURA DO PLANETA. A física dele (`server/namek/bots.js`) é
       integrada contra o campo de altura e contra `NAMEK.world.ceiling`, sem
       passar pelo `regime` que a fuga reescreve — um bot posto no espaço voaria
       contra um chão que já não existe e cairia dois quilômetros até ele. Eles
       vão embora com o planeta (ver `NamekFim.explodir`) e voltam quando ele
       volta. `semChao` e não `noEspaco`: durante os seis segundos da explosão o
       chão já acabou, e um bot posto ali nasceria em cima de um planeta que
       está afundando. */
    if (this.fim.semChao) return null;
    if (this.lotacao >= NAMEK.net.maxPlayers) return null;
    const ocupados = [];
    for (const c of this.todos()) ocupados.push(this.pontoDe(c));
    const bot = this.bots.add(proximoId++, this.field, ocupados);
    if (!bot) return null;

    bot.color = this.tomarCor();
    bot.state = packFighter(bot);
    bot.stateTime = this.now();
    bot.invulnUntil = this.now() + NAMEK.respawn.invuln * 1000;
    bot.dorAcum = 0;
    bot.dorAte = 0;
    bot.crateraAte = 0;

    /* Entra pelo MESMO `JOIN` de um humano — é isso que faz o cliente desenhá-lo
       sem uma linha de código nova. */
    this.broadcastAll({ t: NS2C.JOIN, fighter: view(bot) });
    this.broadcastAll({
      t: NS2C.SPAWN,
      id: bot.id,
      p: [round(bot.position.x), round(bot.position.y), round(bot.position.z)],
      yaw: round(bot.yaw),
      invulnUntil: bot.invulnUntil,
    });
    this.broadcastScores();
    return bot;
  }

  removeBot() {
    const bot = this.bots.removeLast();
    if (!bot) return false;
    this.devolverCor(bot.color);
    this.broadcastAll({ t: NS2C.LEAVE, id: bot.id, name: bot.name });
    this.broadcastScores();
    return true;
  }

  clearBots() {
    for (const bot of this.bots.clear()) {
      this.devolverCor(bot.color);
      this.broadcastAll({ t: NS2C.LEAVE, id: bot.id, name: bot.name });
    }
  }

  /* ============================================================== entrada == */

  handleMessage(conn, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // lixo na linha: ignora em silêncio
    }
    if (!msg || typeof msg.t !== "string") return;

    const player = this.players.get(conn);
    if (!player) {
      if (msg.t === NC2S.HELLO) this.join(conn, msg);
      return;
    }
    player.lastSeen = Date.now();
    this.route(player, msg);
  }

  join(conn, msg) {
    if (msg.version !== NAMEK_PROTOCOL_VERSION) {
      send(conn, {
        t: NS2C.REJECT,
        reason: NamekReject.VERSION,
        expected: NAMEK_PROTOCOL_VERSION,
      });
      conn.close();
      return;
    }

    /* A LOTAÇÃO CONTA OS BOTS, e o §8 do plano é explícito: 15 somados. Mas
       gente ganha de CPU — se a sala está cheia só porque alguém encheu de
       adversários de treino, sai um bot e entra a pessoa. Recusar um humano
       para preservar um bot seria a sala defendendo a própria decoração. */
    while (this.lotacao >= NAMEK.net.maxPlayers && this.bots.count > 0) {
      this.removeBot();
    }
    if (this.lotacao >= NAMEK.net.maxPlayers) {
      send(conn, {
        t: NS2C.REJECT,
        reason: NamekReject.FULL,
        players: this.lotacao,
        max: NAMEK.net.maxPlayers,
      });
      conn.close();
      return;
    }

    const agora = this.now();
    const player = {
      id: proximoId++,
      conn,
      isBot: false,
      name: displayName(msg.name, NOME_MAX, "Guerreiro"),
      color: this.tomarCor(),
      /* O personagem escolhido na tela de entrada. Saneado e NÃO validado
         contra uma lista: o cliente de Namekusei ainda não existe, e uma lista
         inventada aqui seria a primeira coisa que ele teria de contrariar. O
         que a sala garante é o que ela precisa garantir — que a string é curta,
         limpa e nunca vazia. Ver `sanitizeSkin` do arqueiro para a mesma ideia
         com a lista já existindo. */
      char: displayName(msg.char, 24, "guerreiro"),
      score: { kills: 0, deaths: 0 },
      state: null,
      stateTime: 0,

      health: NAMEK.fighter.maxHealth,
      ki: NAMEK.ki.max,
      alive: true,
      invulnUntil: 0,
      respawnAt: 0,
      ultimoGasto: -Infinity,
      /* O especial em curso, para `SPECIAL_HIT` poder conferir que o feixe que
         está cobrando dano existe de verdade. Ver `registrarEspecial`. */
      especial: null,
      dorAcum: 0,
      dorAte: 0,
      dorPor: null,
      dorKind: "blast",
      crateraAte: 0,
      /** Último aviso de acerto no peixe. Ver `registrarPeixe`. */
      peixeEm: -Infinity,
      /* O SUPER SAIYAJIN: o estado e o fim da invencibilidade dos três segundos.
         Os dois são reescritos por `SSJ.limpar` em todo renascimento; estão aqui
         porque o objeto do jogador é o contrato de campos da sala, e um campo
         que só nasce numa função é um campo que `packFighter` lê como
         `undefined` no primeiro quadro. Ver `server/namek/ssj.js`. */
      ssj: false,
      ssjAte: 0,
      /* O atordoamento. `golpes` é a contagem corrente e `golpeAte` é o fim da
         janela deslizante; `tontoAte` é o instante em que ele se levanta e
         `tontoLivreEm` o instante a partir do qual pode ser derrubado de novo.
         Ver `contarGolpe` e `NAMEK.fighter.stagger`. */
      golpes: 0,
      golpeAte: 0,
      tontoAte: 0,
      tontoLivreEm: 0,
      /** Ki gasto na vida toda. Ver `gastar`. */
      gastoKi: 0,

      ping: 0,
      lastSeen: Date.now(),
      joinedAt: agora,
    };
    this.players.set(conn, player);

    send(conn, {
      t: NS2C.WELCOME,
      you: view(player),
      time: agora,
      max: NAMEK.net.maxPlayers,
      weather: { id: this.weather, w: this.weatherAt },
      /* Quem entra no meio precisa do nível que está VALENDO, não do padrão —
         senão o menu dele mostraria "Médio" numa sala em que os bots estão em
         "Parado", e a primeira coisa que ele faria seria trocar para um nível
         que já era o dele. */
      difficulty: this.bots.dificuldadeId,
      fighters: this.roster(player),
      /* A LISTA INTEIRA DE CRATERAS. É esta linha que cumpre o critério 6 do
         §12: quem entra no meio vê o chão já deformado, e não um planeta liso
         que ninguém mais está vendo. */
      craters: this.field.craterList(),
      /* AS PEÇAS JÁ DERRUBADAS. Mesmo motivo da lista de crateras logo acima, e
         a ausência disto era um furo real: quem entrava no meio via de pé as
         rochas, ajisas e casas que todo mundo já tinha destruído, e continuava
         batendo nelas com o projétil enquanto os outros atiravam através do
         lugar vazio. `propsCaidos` já guarda tudo, só não viajava. */
      props: [...this.propsCaidos],
      /* E QUAIS PLANETAS JÁ CAÍRAM. Mesmo motivo da lista de crateras e da de
         peças derrubadas: quem entra no meio precisa do ESTADO, não do
         acontecimento. Sem isto, o retardatário veria os dois corpos inteiros no
         céu enquanto todo mundo já os viu explodir — e uma chuva de meteoros
         caindo de um planeta que, na tela dele, continua lá. */
      planetas: this.planetas.caidos(),
      /* E EM QUE PÉ ESTÁ O FIM DO PLANETA. Mesmo argumento das crateras e das
         peças caídas, com uma consequência maior: sem este campo, quem entrasse
         durante a contagem veria céu de dia, teto de 520 m e nenhum portal — e
         morreria sem nunca ter sabido que havia um relógio correndo. */
      fim: this.fim.resumo(),
      /* O SALTO DO PEIXE EM CURSO, quando há um. Mesmo argumento das crateras:
         quem entra no meio de um mergulho tem de ver o mesmo bicho que os
         outros, e não um mar liso onde catorze pessoas estão olhando um peixe.
         `null` entre um salto e outro — nesse caso o próximo `NS2C.FISH` chega
         pelo caminho normal. */
      fish: this.peixe.view(agora),
      /* AS FERIDAS DO SOL. Mesmo argumento das crateras e do peixe: quem entra
         numa partida em que o sol já levou dois Kamehamehas tem de ver o mesmo
         disco vermelho que os outros — e não um sol amarelo que fica laranja de
         repente no terceiro tiro de outra pessoa. */
      sol: this.sol.resumo(),
      /* **O FREEZA JÁ FOI DERRUBADO NESTA PARTIDA?** É o que destrava o Super
         Saiyajin livre (ver `NAMEK.ssj.livreAposOFreeza`), e a marca é da SALA,
         não de quem estava lá quando ele caiu: quem entra durante a fuga do
         planeta tem o mesmo direito. Sem esta linha, esse jogador apertaria `R`
         e ouviria "só na batalha contra o Freeza" pelo resto da partida — e a
         sala, que confere a mesma coisa por conta própria em `podeAcender`,
         aceitaria a transformação que o HUD dele diz ser impossível. */
      freezaMorto: this.freeza?.derrotado === true,
      scores: this.scores(),
    });

    /* O `JOIN` vai para os OUTROS: quem entrou já se conhece pelo `you` do
       `welcome`, e receber o próprio anúncio faria o cliente criar um boneco
       remoto de si mesmo. */
    this.broadcast({ t: NS2C.JOIN, fighter: view(player) }, player.id);
    this.nascer(player, agora);
    /* O BOSS, para quem chegou no meio: a mensagem de entrada dele outra vez,
       só nesta conexão — mesma ideia da lista de crateras do `welcome`. E a
       vida máxima é recontada, porque ela é função de quanta gente há em campo
       (ver `vidaDoFreeza`); a FRAÇÃO é preservada, então a barra de quem já
       estava lutando não se mexe. */
    this.freeza.recontar();
    this.freeza.apresentar(conn);
    this.broadcastScores();
    this.log(`namek — entrou: ${player.name} (#${player.id}) — ${this.lotacao} em campo`);
  }

  /** Quem já está em campo, com a última pose de cada um. */
  roster(exceto) {
    const lista = [];
    for (const f of this.todos()) {
      if (f === exceto) continue;
      lista.push({ ...view(f), state: f.state, health: Math.round(f.health), ki: Math.round(f.ki) });
    }
    return lista;
  }

  handleClose(conn) {
    const player = this.players.get(conn);
    if (!player) return;
    this.players.delete(conn);
    this.devolverCor(player.color);
    /* Sai da conta do fim junto com a vaga: um id no conjunto de escapados
       depois de a pessoa ter ido embora é um lutador invisível no espaço, e ele
       sairia no `FIM_ESTADO` seguinte para todo mundo. */
    this.fim.saiu(player);
    this.broadcastAll({ t: NS2C.LEAVE, id: player.id, name: player.name });
    this.broadcastScores();
    this.log(`namek — saiu: ${player.name} (#${player.id}) — ${this.lotacao} em campo`);

    /* Sala vazia = planeta zerado, AGORA.
     *
     * Mesma decisão da sala do arqueiro, e pelo mesmo motivo: a sala sobrevive
     * 30 s ao último jogador para que uma queda de rede curta não apague a
     * sessão, e sem esta limpeza quem recarregasse a página cairia num planeta
     * cheio de crateras de uma partida que acabou, com quinze bots brigando
     * sozinhos e consumindo CPU para ninguém. */
    /* A vida do boss é função da lotação: quem sai leva um pedaço dela junto.
       A fração é preservada (ver `recontar`), então a barra não salta — o que
       muda é quanto tempo ele ainda aguenta. */
    this.freeza.recontar();
    if (this.players.size === 0) {
      /* Sala sem gente, boss fora: ele é uma luta, e não há luta sem ninguém.
         `sair()` e não morte — ver o comentário lá para a diferença, que é o
         `aoMorrer` de quem estava contando não disparar por uma aba fechada. */
      this.freeza.sair();
      this.clearBots();
      this.field = new NamekField();
      this.weather = NAMEK.weather.padrao;
      this.weatherAt = 0;
      /* A dificuldade volta ao padrão junto com o resto. Ela é uma escolha da
         PARTIDA, não da instalação: quem chega numa sala vazia não deveria
         herdar o "Parado" que alguém deixou ligado para treinar ontem. */
      this.bots.setDificuldade(NAMEK.bot.dificuldadePadrao);
      this.corpos.length = 0;
      this.corpoPorId.clear();
      this.propsCaidos.clear();
      /* E o céu volta com os dois planetas. Mesmo argumento do campo de altura
         logo acima: quem recarrega a página não pode cair num sistema solar
         destruído por uma partida que já acabou — nem herdar uma chuva de
         meteoros pela metade caindo sobre um terreno recém-zerado. */
      this.planetas.reiniciar();
      /* E o peixe volta inteiro. Um bicho pela metade da vida — ou um relógio de
         renascimento correndo — é estado da partida que acabou, exatamente como
         as crateras: quem chega numa sala vazia não herda nem uma coisa nem a
         outra. */
      this.peixe.reset();
      /* E O SOL VOLTA INTEIRO, pelo mesmo argumento: as feridas dele são estado
         da partida que acabou, como as crateras. Sem esta linha, quem entrasse
         numa sala recém-esvaziada veria um sol já vermelho de dois
         Kamehamehas que ninguém daquela partida deu. */
      this.sol.zerar();
      /* O FIM ZERA JUNTO — o planeta voltou inteiro, então a contagem, o Freeza
         e a lista de quem estava no espaço não descrevem mais nada. Sem esta
         linha, quem recarregasse a página cairia numa sala em fase `espaco` sem
         planeta nenhum tendo explodido para ele. */
      this.fim.zerar();
      this.log("namek — sala vazia: planeta zerado");
    }

    this.onEmpty?.(this);
  }

  /** Derruba quem parou de dar sinal. Sem isto, uma aba fechada à força segura vaga. */
  derrubarMudos() {
    const limite = SILENCIO * 1000;
    const agora = Date.now();
    for (const [conn, player] of [...this.players]) {
      if (agora - player.lastSeen <= limite) continue;
      this.log(`namek — sem sinal: ${player.name} (#${player.id})`);
      this.handleClose(conn);
      try {
        conn.close();
      } catch {
        /* já estava morta */
      }
    }
  }

  /* ============================================================ mensagens == */

  route(player, msg) {
    switch (msg.t) {
      /* O PEDIDO DE TRANSFORMAÇÃO. Sem corpo e sem validação de mensagem: tudo o
         que a decisão precisa (vida, chefe em campo, estado) a sala já tem, e é
         `SSJ.podeAcender` quem responde. Recusa em silêncio, como a do especial
         — ver `NC2S.SSJ` no protocolo. */
      case NC2S.SSJ:
        SSJ.pedir(this, player);
        break;

      case NC2S.PING:
        send(player.conn, { t: NS2C.PONG, c: msg.c, s: this.now() });
        if (typeof msg.rtt === "number") player.ping = Math.round(msg.rtt);
        break;

      case NC2S.STATE:
        this.registrarPose(player, msg);
        break;

      case NC2S.BLAST:
        this.registrarRajada(player, msg);
        break;

      case NC2S.BLAST_HIT:
        this.registrarAcerto(player, msg);
        break;

      case NC2S.SPECIAL:
        this.registrarEspecial(player, msg);
        break;

      case NC2S.SPECIAL_HIT:
        this.registrarQueimadura(player, msg);
        break;

      case NC2S.POWER_CLASH:
        this.registrarEmbate(player, msg);
        break;

      case NC2S.BURST:
        this.registrarOnda(player, msg);
        break;

      case NC2S.GROUND_HIT:
        this.registrarChao(player, msg);
        break;

      case NC2S.PROP_HIT:
        this.registrarProp(player, msg);
        break;

      case NC2S.FISH_HIT:
        this.registrarPeixe(player, msg);
        break;

      case NC2S.SLAM:
        this.registrarQueda(player, msg);
        break;

      case NC2S.RESPAWN:
        this.registrarRespawn(player);
        break;

      case NC2S.BOT:
        /* `{ boss: "<dificuldade>" }` chama o FREEZA, e ele entra pela mensagem
           que já existe em vez de uma nova. Não é economia de protocolo: pôr e
           tirar adversário de CPU é exatamente o que esta mensagem faz, e o boss
           é o adversário de CPU maior — quem monta o menu ganha o caminho pronto
           sem nenhum cliente antigo precisar aprender uma palavra nova. Quem
           quiser chamá-lo por dentro usa a API: `sala.freeza.entrar(nivel)`. */
        /* `{ boss: "matar" }` é a BANCADA — ver `NamekFreeza.matarPorTeste`. Ele
           entra pela mesma mensagem em vez de um tipo novo de protocolo, e mata
           pelo caminho de morte de verdade, para o `aoMorrer` disparar e a fuga
           de Namekusei começar. */
        if (msg.boss === "matar") this.freeza.matarPorTeste();
        else if (msg.boss) this.freeza.entrar(String(msg.boss));
        else if (msg.remove) this.removeBot();
        else this.addBot();
        break;

      case NC2S.FREEZA_HIT:
        this.freeza.acertoDeclarado(player, msg);
        break;

      case NC2S.WEATHER:
        this.pedirClima(msg.id, this.now());
        break;

      case NC2S.DIFFICULTY:
        this.pedirDificuldade(msg.id);
        break;

      /* "O meu Kamehameha está apontado para aquele planeta." A conferência
         inteira mora em `NamekPlanetas.pedido` — inclusive a de que o especial
         existe, que é feita sobre o `player.especial` que `registrarEspecial`
         acabou de criar. Recusa em silêncio, como todo o resto. */
      case NC2S.PLANET_HIT:
        this.planetas.pedido(player, msg, this.now());
        break;

      /* "O meu Kamehameha está apontado para o SOL." Mesma conferência, mesmo
         modelo de confiança e mesma recusa em silêncio — ver
         `server/namek/sol.js`. Sem `msg`: não há o que escolher, existe um sol. */
      case NC2S.SUN_HIT:
        this.sol.pedido(player, this.now());
        break;

      default:
        break;
    }
  }

  /**
   * A pose própria, 20 Hz.
   *
   * A sala NÃO corrige a pose — o §8 é claro sobre de quem ela é. O que ela faz
   * é recusar a pose IMPOSSÍVEL: um `NaN` ou um número fora do planeta não é
   * trapaça, é bug ou lixo de rede, e retransmiti-lo poria o boneco daquela
   * pessoa num lugar em que nenhuma tela consegue desenhá-lo. Recusar é melhor
   * que reescrever: com a pose recusada, a última boa continua valendo e o
   * cliente se conserta no quadro seguinte; reescrevendo, ele e a sala
   * discordariam para sempre sobre onde ele está.
   */
  registrarPose(player, msg) {
    const s = msg.s;
    /* Exatamente três componentes: é o que `r3v`/`r2v` produzem, e um vetor
       mais comprido não seria "um cliente diferente" — seria carga extra que a
       sala retransmitiria para todo mundo. */
    if (!s || !Array.isArray(s.p) || s.p.length !== 3) return;
    if (!Array.isArray(s.v) || s.v.length !== 3) return;
    const [x, y, z] = s.p;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    if (!Number.isFinite(s.v[0]) || !Number.isFinite(s.v[1]) || !Number.isFinite(s.v[2])) return;
    const W = NAMEK.world;
    if (x * x + z * z > (W.radius + 200) ** 2) return;
    /* O TETO DA VALIDAÇÃO SEGUE O TETO DE VOO, e não a constante do mundo.
       Durante a fuga o limite sobe para 2 000 m e no espaço para quase 2 900:
       lendo `W.ceiling` aqui, a PRIMEIRA pose de quem subisse atrás do portal
       seria descartada em silêncio, o corpo dele congelaria no céu de todos os
       outros, e o cliente continuaria subindo sozinho. Ver `NamekFim.tetoDePose`. */
    if (y > this.fim.tetoDePose() + 200 || y < W.seaLevel - 200) return;
    /* E TODO CANAL TEM DE SER NÚMERO. A pose é a única coisa que a sala
       retransmite sem reescrever, então ela é também a única porta por onde um
       cliente poderia mandar `"y": "olá"` e travar o desenho de todos os
       outros. A autoridade sobre a própria pose (§8) é sobre PARA ONDE ela
       aponta — não sobre de que tipo ela é. */
    for (const k in PADROES) {
      const v = s[k];
      if (v !== undefined && !Number.isFinite(v)) return;
    }
    if (!Number.isFinite(s.y) || !Number.isFinite(s.i)) return;
    if (s.b !== undefined && !Number.isFinite(s.b)) return;

    player.state = s;
    /* O carimbo é o do CLIENTE, não o da retransmissão — mesma razão anotada em
       `Room.route`: carimbar no broadcast transforma um engasgo de 300 ms num
       teleporte na tela de quem recebe. */
    player.stateTime = clampTempo(msg.w, this.now());
  }

  /**
   * "Atirei uma bola." A sala cobra o ki e retransmite.
   *
   * O `target` viaja intacto porque ele é a razão de existir do campo: o alvo é
   * escolhido NO DISPARO por quem atirou, e é mandá-lo junto que faz a bola
   * perseguir a mesma pessoa em todas as telas.
   */
  registrarRajada(player, msg) {
    if (!player.alive) return;
    /* CAÍDO NÃO ATIRA — e a trava mora aqui, na sala, e não só no cliente.
     *
     * O cliente já cala o botão de tiro enquanto o corpo está no chão (ver
     * `NamekGame.step`), mas essa é a metade cortês da regra: a metade que
     * importa é esta, porque a janela de atordoamento só vale alguma coisa se
     * ela for real para todo mundo. Sem esta linha, bastaria um cliente que
     * ignora o próprio estado para continuar metralhando deitado — e o golpe
     * inteiro deixaria de existir. Vale para o especial, para a onda e para a
     * cratera pelo mesmo motivo. */
    if (this.atordoado(player)) return;
    /* E QUEM ESTÁ SE TRANSFORMANDO TAMPOUCO — mesma razão da linha acima, com o
       peso maior: os três segundos são INVENCÍVEIS, e atirar de dentro deles
       seria machucar sem poder ser machucado. Vale para o especial e para a onda
       pelo mesmo motivo. */
    if (SSJ.invencivel(player, this.now())) return;
    if (!vetorOk(msg.o) || !vetorOk(msg.d)) return;
    /* O ki da rajada custa 40 % em Super Saiyajin (`NAMEK.ssj.kiDreno`) — o
       mesmo desconto que o `KiMeter.gastar` aplica do lado do cliente, para as
       duas barras descerem juntas. */
    if (!this.gastar(player, SSJ.custo(player, NAMEK.ki.blastCost))) return;

    const alvo = Number.isFinite(msg.target) ? msg.target : null;
    this.broadcastAll({
      t: NS2C.BLAST,
      owner: player.id,
      /* NÚMERO, e nunca o que veio da rede.
       *
       * O `id` casa o acerto com o disparo e para isso ele só precisa ser um
       * inteiro. Repassá-lo intacto fazia da sala um AMPLIFICADOR: um cliente
       * mandou um `id` de 200 000 caracteres e ela o retransmitiu para cada uma
       * das outras catorze conexões — três megabytes de subida do servidor a
       * partir de um pacote. É o mesmo cuidado que `vec()` já toma com as
       * coordenadas, aplicado ao campo que tinha escapado. */
      id: Number.isFinite(msg.id) ? msg.id : 0,
      o: vec(msg.o),
      d: vec(msg.d),
      hand: msg.hand === 1 ? 1 : 0,
      target: alvo,
      w: clampTempo(msg.w, this.now()),
    });
    /* Os bots precisam VER a bola para desviar dela. Ver o cabeçalho de
       `bots.js`: ela entra na simulação como fantasma — não machuca (quem
       atirou é dono do próprio acerto) e não abre cratera, mas está lá. */
    this.bots.avisarRajada({ owner: player.id, o: msg.o, d: msg.d, target: alvo });
  }

  /**
   * "A minha bola acertou fulano."
   *
   * Mesmo contrato do `C2S.IMPACT` do arqueiro. As quatro conferências são as
   * que custam quase nada e pegam quase tudo que é INCOERÊNCIA: a vítima
   * existe, está viva, não está piscando, e o ponto declarado é perto dela.
   */
  registrarAcerto(player, msg) {
    if (!player.alive) return;
    const vitima = this.lutadorPor(msg.victim);
    if (!vitima || vitima === player || !vitima.alive) return;
    if (this.now() < vitima.invulnUntil) return;
    if (!vetorOk(msg.p)) return;

    const p = this.pontoDe(vitima);
    const alvo = { x: p.x, y: p.y + NAMEK.fighter.chest, z: p.z };
    const d = Math.hypot(msg.p[0] - alvo.x, msg.p[1] - alvo.y, msg.p[2] - alvo.z);
    if (d > NAMEK.blast.hitRadius + NAMEK.fighter.radius + TOLERANCIA) return;

    /* E o tiro tem de ter sido possível: a bola vive `life` segundos a `speed`,
       então ninguém acerta alguém a mais de 200 m de onde está. */
    const eu = this.pontoDe(player);
    const alcance = NAMEK.blast.speed * NAMEK.blast.life + TOLERANCIA;
    if (Math.hypot(alvo.x - eu.x, alvo.y - eu.y, alvo.z - eu.z) > alcance) return;

    const dir = versorEntre(eu, alvo);
    this.aplicarDano(vitima, NAMEK.blast.damage, {
      por: player,
      kind: "blast",
      p: { x: msg.p[0], y: msg.p[1], z: msg.p[2] },
      d: [dir.x, dir.y, dir.z],
    });
  }

  /**
   * O especial. **Só sai com a barra CHEIA** — §5 do plano, e é a regra que dá
   * ao modo a economia inteira dele.
   *
   * Recusar em silêncio é de propósito: o cliente já começou a animação (ele
   * prevê, como prevê tudo), e o `VITALS` de no máximo 100 ms depois desmente a
   * barra. Uma mensagem de recusa só existiria para dizer o que a barra já diz.
   */
  registrarEspecial(player, msg) {
    if (!player.alive) return;
    if (this.atordoado(player)) return; // ver `registrarRajada`
    if (SSJ.invencivel(player, this.now())) return; // idem: não se atira do grito
    const info = specialInfo(msg.kind);
    if (!info) return;
    if (!vetorOk(msg.o) || !vetorOk(msg.d)) return;
    /* **TRÊS ESPECIAIS COM UMA BARRA** em Super Saiyajin: o limiar cai de 1 para
       um terço e o custo cai junto (`NAMEK.ssj.limiar` e `especialCusto`), e a
       conta fecha em cima — 100 → 67 → 34 → 1. Os dois números vêm do mesmo
       módulo que o cliente lê em `KiMeter`, senão a barra do HUD aceitaria um
       golpe que esta linha recusaria. */
    if (player.ki < NAMEK.ki.max * SSJ.limiarEspecial(player)) return;
    if (!this.gastar(player, SSJ.custoEspecial(player))) return;

    const agora = this.now();
    /* A JANELA DO GOLPE, e ela é o que dá dentes ao `SPECIAL_HIT`: sem este
       registro, um cliente poderia cobrar dano de feixe por tempo indefinido
       sem nunca ter soltado feixe nenhum. Com ele, o dano só é aceito enquanto
       o golpe declarado existe, e no máximo pelo tempo que ele dura. */
    player.especial = {
      kind: msg.kind,
      info,
      ate: agora + (info.windup + info.sustain + 0.35) * 1000,
      /* Segundos de exposição já cobrados, POR VÍTIMA — e é por vítima, e não
         no total, porque o feixe ATRAVESSA. Um Kamehameha alinhado com três
         pessoas queima as três pelos mesmos 2,4 s; com um contador só, a
         primeira consumiria o orçamento e as outras duas sairiam ilesas de
         dentro do feixe. O teto continua existindo, um por pessoa, e é ele que
         impede um `dt` inflado de virar dano infinito.
         O mapa é limitado pelo elenco: `lutadorPor` já descartou id que não
         existe antes de qualquer coisa ser escrita aqui. */
      exposicao: new Map(),
      o: vec(msg.o),
      d: vec(msg.d),
    };

    this.broadcastAll({
      t: NS2C.SPECIAL,
      owner: player.id,
      kind: msg.kind,
      o: vec(msg.o),
      d: vec(msg.d),
      /* O alvo do golpe que persegue, repassado INTACTO e saneado como número —
         o mesmo cuidado que `registrarRajada` toma com o `target` dela, e pelo
         mesmo motivo: um campo vindo da rede que é retransmitido para catorze
         conexões é um amplificador se não for aparado. */
      target: Number.isFinite(msg.target) ? msg.target : null,
      w: clampTempo(msg.w, agora),
    });
    /* O ALVO vai junto: o fantasma que os bots consultam para desviar tem de
       CURVAR como o golpe de verdade curva. Sem ele, o bot se afastava do eixo
       do disparo e o Kamehameha ia atrás dele — a esquiva o entregava. */
    this.bots.avisarEspecial({
      owner: player.id,
      kind: msg.kind,
      o: msg.o,
      d: msg.d,
      target: msg.target,
    });

    /* ================================ A GENKI DAMA DEIXA O FREEZA LENTO =====
     *
     * *"Uma Genki Dama contra o Freeza: quando a Genki Dama é atirada, o Freeza
     * anda mais lento. Ele não anda tão rápido, para dar chance da Genki Dama
     * acertar ele. Mas tem chances da Genki Dama acertar ele, e também não é que
     * acerta."*
     *
     * O aviso sai daqui — do REGISTRO do especial — e não do impacto, e é o
     * único lugar de onde ele poderia sair: a sala não simula projétil de
     * jogador (quem atira julga o próprio acerto, §8 do plano), então ela não
     * tem uma bola para acompanhar. O que ela tem é o instante em que o golpe
     * foi pago, e a lentidão é uma janela contada a partir dele.
     *
     * O `windup` vai junto porque a lentidão começa quando a bola SAI da mão, e
     * não quando o gesto começa: os 5,2 s de carga são exatamente o tempo em que
     * o boss deveria estar indo para cima de quem carrega, e deixá-lo lento ali
     * inverteria o sentido do golpe. Ver `NamekFreeza.avisarGenkiDama`.
     *
     * `?.` na chamada e não um `if` no tipo: quem sabe o que fazer com esta
     * notícia é o boss, e uma sala sem boss instalado tem de continuar aceitando
     * Genki Damas. */
    if (msg.kind === "genki") {
      this.freeza?.avisarGenkiDama?.(agora, info.windup ?? 0);
    }
  }

  /**
   * "O meu especial está queimando fulano há `dt` segundos."
   *
   * O `dt` é a peça mais delicada do protocolo inteiro e o comentário dele
   * explica por quê: é assim que um feixe SUSTENTADO cobra por segundo sem
   * mandar uma mensagem por quadro. E é exatamente por isso que ele é o número
   * mais fácil de inflar — daí as três travas: o golpe tem de existir, o `dt`
   * de um aviso não passa de meio segundo, e a soma de todos não passa do
   * `sustain` do golpe.
   */
  registrarQueimadura(player, msg) {
    if (!player.alive) return;
    const e = player.especial;
    if (!e || e.kind !== msg.kind) return;
    const agora = this.now();
    if (agora > e.ate) {
      player.especial = null;
      return;
    }
    const vitima = this.lutadorPor(msg.victim);
    if (!vitima || vitima === player || !vitima.alive) return;
    if (agora < vitima.invulnUntil) return;

    /* O FEIXE É UM SEGMENTO, NÃO UMA ESFERA — e essa era a metade que faltava.
     *
     * Só a distância era conferida, e com isso quem declarasse a vítima podia
     * escolher qualquer um dentro do alcance, inclusive às próprias costas.
     * Medido: um Kamehameha apontado para +z queimava alguém 400 m em −z, e uma
     * Genki Dama sozinha atingiu as quatro vítimas espalhadas em direções
     * opostas — 96 de dano cada, de 100 de vida.
     *
     * A conta é a distância da vítima ao EIXO do golpe, medida da ORIGEM e na
     * DIREÇÃO que ficaram travadas no disparo (`e.o`, `e.d`) — e não da posição
     * atual de quem atirou, que já andou desde então.
     *
     * Distância ao eixo, e não um cone: um cone de ângulo fixo é largo demais
     * longe e apertado demais perto, enquanto o raio de morte do golpe é o mesmo
     * em qualquer distância — que é exatamente como o feixe se comporta na tela
     * de quem atira. A folga é a mesma `TOLERANCIA` do resto.
     *
     * `t` é quanto se anda pelo eixo até o pé da perpendicular: negativo é a
     * vítima atrás da boca do golpe, e além do alcance é longe demais. */
    const p = this.pontoDe(vitima);
    const vx = p.x - e.o[0];
    const vy = p.y - e.o[1];
    const vz = p.z - e.o[2];

    /* GOLPE QUE PERSEGUE NÃO TEM EIXO, e a conferência tem de mudar com ele.
     *
     * O teste da distância à reta que sai da boca do golpe é exato para quem
     * viaja em linha reta — e desde que "todos os poderes devem perseguir o
     * player", ninguém viaja. Um Kienzan que faz 165° de correção acerta alguém
     * a noventa graus do rumo original, e o teste do eixo recusaria justamente o
     * acerto legítimo: o golpe não machucaria ninguém que ele perseguiu.
     *
     * São dois casos, e a diferença entre eles é o teto de correção total:
     *
     * • QUEM TEM `arcMax` (o Kamehameha e a Genki Dama) ganha um CONE. O teto
     *   dá um limite geométrico de graça: a posição do golpe é a integral de
     *   versores que nunca se afastam mais de `arcMax` da direção do disparo, e
     *   a média de vetores dentro de um cone fica dentro do mesmo cone. Ou seja,
     *   o golpe inteiro cabe num cone de meia-abertura `arcMax` em torno de `d`,
     *   e a margem lateral aceita a `t` metros é `t · tan(arcMax)` — um cone que
     *   é frouxo longe, sim, mas oito vezes e meia mais apertado que a esfera em
     *   ângulo sólido, e o mais apertado que se pode afirmar com honestidade.
     *
     * • QUEM NÃO TEM (o Kienzan, o Galick Gun) fica com a ESFERA: a vítima tem
     *   de estar dentro do alcance, medido da origem. Para eles não existe cone
     *   honesto — 165° de correção é mais que um hemisfério.
     *
     * A troca da esfera vale a pena registrar: um cliente mentiroso poderia
     * escolher a vítima dentro dela em vez de a que ele de fato acertou. O que
     * segura o abuso é o resto do cerco, que continua inteiro: o golpe tem de
     * existir e estar dentro da janela de tempo dele (`e.ate`), custou a barra
     * CHEIA, e cada vítima só pode ser cobrada UMA vez (`exposicao`). O teto do
     * estrago de uma mentira é, portanto, um acerto por golpe — que é o mesmo
     * teto de um acerto honesto.
     *
     * E é por isso que o Kamehameha PRECISA do cone e não podia herdar a esfera:
     * ele cobra por SEGUNDO, então "uma vez por vítima" vale 2,4 s de dps em vez
     * de um corte, e a esfera de 620 m em torno de quem atirou é grande demais
     * para uma cobrança dessa. */
    const arcMax = e.info.homing?.arcMax;
    if (e.info.homing && arcMax === undefined) {
      const d = Math.hypot(vx, vy, vz);
      if (d > e.info.range + TOLERANCIA) return;
    } else {

    const dn = Math.hypot(e.d[0], e.d[1], e.d[2]);
    /* Direção degenerada não pode virar divisão por zero. `vetorOk` garante que
       os três números são finitos, não que eles formam um versor: um cliente
       pode mandar [0,0,0], e sem esta saída o `t` viraria NaN e toda comparação
       com NaN é falsa — ou seja, o golpe passaria a acertar todo mundo. */
    if (dn < 1e-6) return;
    const dx = e.d[0] / dn;
    const dy = e.d[1] / dn;
    const dz = e.d[2] / dn;

    const t = vx * dx + vy * dy + vz * dz;
    if (t < 0 || t > e.info.range + TOLERANCIA) return;

    /* A abertura do cone. Zero para quem não persegue — e aí isto é, linha por
       linha, o teste de eixo que sempre esteve aqui. */
    const abre = arcMax === undefined ? 0 : t * Math.tan((arcMax * Math.PI) / 180);
    const raio = (e.info.hitRadius ?? 4) + abre + TOLERANCIA;
    const fora = Math.hypot(vx - dx * t, vy - dy * t, vz - dz * t);
    if (fora > raio) return;
    }

    /* Feixe cobra por SEGUNDO (`dps`); disco e Genki Dama cortam DE UMA VEZ
       (`damage`). São dois golpes de natureza diferente e a mesma mensagem
       serve aos dois — a diferença é só quantas vezes cada um pode cobrar da
       mesma pessoa. */
    const ja = e.exposicao.get(vitima.id) ?? 0;
    let dano;
    if (e.info.dps !== undefined) {
      const dt = clamp(Number(msg.dt) || 0, 0, 0.5);
      const cobrado = Math.min(dt, Math.max(0, e.info.sustain - ja));
      if (cobrado <= 0) return;
      e.exposicao.set(vitima.id, ja + cobrado);
      dano = e.info.dps * cobrado;
    } else {
      /* Um corte por pessoa. O disco atravessa uma fileira inteira — e deve —,
         mas não serra a mesma pessoa duas vezes na mesma passagem. */
      if (ja > 0) return;
      e.exposicao.set(vitima.id, e.info.sustain);
      dano = e.info.damage;
    }

    this.aplicarDano(vitima, dano, {
      por: player,
      kind: e.kind,
      p: { x: p.x, y: p.y + NAMEK.fighter.chest, z: p.z },
      d: e.d,
      continuo: e.info.dps !== undefined,
    });
  }

  /**
   * "DOIS PODERES SE ENCOSTARAM." A sala confirma UM aviso e descarta os ecos.
   *
   * ------------------------------------------------------------ o problema
   *
   * Cada cliente simula os próprios projéteis e reconstrói os alheios a partir
   * do disparo que esta sala retransmitiu. As catorze reconstruções do mesmo
   * Galick Gun estão a alguns metros umas das outras — e "alguns metros" é
   * exatamente a margem que decide se ele encostou ou não no Kamehameha que
   * vinha de frente. Sem ninguém no meio, um jogador veria o golpe sumir e o
   * outro o veria acertar, que é o único desacordo que este modo não tolera,
   * porque ele decide quem morre.
   *
   * ------------------------------------------------------------- o critério
   *
   * **Qualquer cliente que enxergue o choque avisa; a sala guarda o primeiro e
   * descarta os repetidos.** O critério óbvio seria "quem é dono do projétil de
   * menor id arbitra", e ele quebra por um motivo concreto deste jogo: metade
   * dos golpes é de BOT, e bot não tem cliente. Todo embate cujo número menor
   * coubesse a um bot não aconteceria em tela nenhuma — numa sala de quinze
   * bots, quase todos. Deixando qualquer um avisar e centralizando o desempate
   * aqui, o mesmo mecanismo cobre humano×humano, humano×bot e bot×bot.
   *
   * A sala NÃO recalcula o desfecho, e isso é deliberado: quem morre e que
   * estouro sai são função pura dos dois tipos (`NAMEK.embate.classe`, mais o
   * bit `c` da bola de carga), e cada cliente a aplica com a mesma tabela. O que
   * é conferido aqui são as INVARIANTES dessa tabela — que os tipos existem,
   * que a rajada de ki não passa por aqui (ela é resolvida em cada tela, sem
   * rede) e que a explosão de carga só é pedida entre dois Kamehamehas. É a
   * mesma régua do resto desta sala: conferir para o jogo não se contradizer,
   * não para impedir trapaça.
   *
   * **`player` não é usado, e a ausência é a mensagem.** Todo outro `registrar*`
   * daqui trata do que AQUELE jogador fez — o tiro dele, o acerto dele, a
   * cratera dele — e por isso começa conferindo se ele está vivo e de pé. Este
   * fala de dois projéteis que quase nunca são dele: quem avisa é qualquer um
   * que ENXERGOU o choque, inclusive um espectador dos dois lados, e é
   * justamente por isso que o remetente não tem autoridade nenhuma sobre o
   * conteúdo. O parâmetro fica na assinatura porque `route` chama todos igual.
   */
  registrarEmbate(player, msg) {
    if (!vetorOk(msg.p)) return;
    const ka = String(msg.ka ?? "");
    const kb = String(msg.kb ?? "");
    const ca = NAMEK.embate.classe[ka];
    const cb = NAMEK.embate.classe[kb];
    /* Tipo desconhecido, ou rajada de ki num dos lados: a bolinha nunca sobe
       (ver `NC2S.POWER_CLASH`), então um aviso com ela é lixo. Recusar em vez de
       adivinhar também é o que impede a sala de virar amplificador — o que sai
       daqui é a CHAVE que passou pela tabela, nunca a string que chegou. */
    if (ca !== "grande" || cb !== "grande") return;
    const carga = msg.c === 1 || msg.c === true;
    if (carga && (ka !== "kamehameha" || kb !== "kamehameha")) return;

    const a = Number(msg.a);
    const b = Number(msg.b);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return;

    const agora = this.now();
    /* A JANELA. Numa sala de quinze, o mesmo encontro chega em até quinze
       pacotes em poucos milissegundos, cada um com o ponto de contato da
       reconstrução daquela tela. O primeiro vira o acontecimento; os outros são
       o mesmo acontecimento contado de novo.
       O par é comparado sem ordem: quem avisou pode ter posto o Kamehameha em
       `a` e o Kienzan em `b`, e o vizinho o contrário. */
    for (let i = 0; i < this.embatesRecentes.length; i++) {
      const e = this.embatesRecentes[i];
      if (agora - e.w > NAMEK.embate.janelaSala * 1000) continue;
      const mesmo =
        (e.a === a && e.ka === ka && e.b === b && e.kb === kb) ||
        (e.a === b && e.ka === kb && e.b === a && e.kb === ka);
      if (mesmo) return;
    }
    /* Anel de oito. Guardar mais seria guardar história que a janela já jogou
       fora; guardar menos deixaria dois embates simultâneos empurrarem um ao
       outro para fora do registro. */
    const reg = this.embatesRecentes[this.embateProx];
    reg.a = a;
    reg.ka = ka;
    reg.b = b;
    reg.kb = kb;
    reg.w = agora;
    this.embateProx = (this.embateProx + 1) % this.embatesRecentes.length;

    this.broadcastAll({
      t: NS2C.POWER_CLASH,
      a,
      ka,
      b,
      kb,
      p: vec(msg.p),
      c: carga ? 1 : 0,
    });
  }

  registrarOnda(player, msg) {
    if (!player.alive) return;
    if (this.atordoado(player)) return; // ver `registrarRajada`
    if (SSJ.invencivel(player, this.now())) return; // idem: não se atira do grito
    if (!vetorOk(msg.p)) return;
    /* A onda sai de QUEM a soltou, então o ponto declarado tem de ser o corpo
       dele. Oito metros de folga cobrem o atraso da pose; o que a checagem
       impede é a onda teleportada para o meio de um grupo do outro lado do
       mapa. */
    const eu = this.pontoDe(player);
    if (Math.hypot(msg.p[0] - eu.x, msg.p[1] - eu.y, msg.p[2] - eu.z) > 8 + TOLERANCIA) return;
    if (!this.gastar(player, SSJ.custo(player, NAMEK.ki.burstCost))) return;
    this.onda(player, { x: msg.p[0], y: msg.p[1], z: msg.p[2] });
  }

  registrarChao(player, msg) {
    if (!vetorOk(msg.p)) return;
    const power = Number(msg.power);
    if (!Number.isFinite(power) || power <= 0) return;

    /* MORTO NÃO CAVA. A cratera é a marca de um golpe, e quem está caído não
       está dando golpe nenhum — sem esta linha, um cliente parado na tela de
       morte continuava esculpindo o terreno de todo mundo. */
    if (!player.alive) return;

    /* E NÃO CAVA DO OUTRO LADO DO MAPA. O ponto tem de estar ao alcance de
       alguma coisa que este lutador poderia ter disparado; o maior alcance do
       jogo é o da Genki Dama. Sem o teste, uma cratera declarada a 928 m — o
       caso medido — era carimbada e retransmitida sem discussão. */
    const eu = this.pontoDe(player);
    const alcance = ALCANCE_MAXIMO + TOLERANCIA;
    if (dist2(msg.p, eu) > alcance * alcance) return;

    /* A cota por lutador é cobrada dentro de `cratera()`, para valer também
       para o bot e para o baque de queda. Ver o comentário lá.

       O teto é a potência do golpe mais forte do jogo com uma folga para a
       queda. Ele ERA 16, dimensionado quando a Genki Dama tinha potência 12 — e
       ela subiu junto com a escala das crateras (ver `craterBase`) e de novo
       quando a esfera dobrou de tamanho, chegando a 44. Um teto abaixo da
       potência de um golpe legítimo não protege nada: ele só apara em silêncio o
       maior buraco do jogo, e o sintoma seria a Genki Dama abrindo a mesma
       cratera do Galick Gun. 56 é a Genki Dama com folga.

       `craterFor` já apara em 64 e `craterMax` apara o raio em 52 m; isto apara
       mais cedo, porque uma potência absurda vinda da rede também vira uma
       cratera absurda no índice espacial. */
    this.cratera(msg.p[0], msg.p[2], Math.min(power, 56), player, msg.df);
  }

  registrarProp(player, msg) {
    if (typeof msg.kind !== "string" || !Number.isFinite(msg.i)) return;
    /* Teto de memória. O cenário tem algumas centenas de peças, então este
       número nunca é alcançado jogando; ele existe porque a chave vem da rede,
       e um cliente que mandasse índices crescentes para sempre faria a sala
       guardar um `Set` que só cresce. */
    if (this.propsCaidos.size > 4000) return;
    const chave = `${msg.kind}:${msg.i}`;
    /* Uma peça só cai uma vez. Sem esta memória, duas pessoas acertando a mesma
       rocha no mesmo instante mandariam dois `PROP_DOWN`, e o cliente estilharia
       o mesmo objeto duas vezes — dois montes de detrito no mesmo lugar. */
    if (this.propsCaidos.has(chave)) return;
    this.propsCaidos.add(chave);
    this.broadcastAll({ t: NS2C.PROP_DOWN, kind: msg.kind, i: msg.i, by: player.id });
  }

  /**
   * "O meu poder acertou o PEIXE GIGANTE."
   *
   * Mesmo contrato do `registrarAcerto` e do `registrarQueimadura`: quem atira é
   * a autoridade sobre o próprio acerto, a sala é a autoridade sobre a vida. As
   * conferências que importam moram em `NamekPeixeSim.acerto` — o peixe existe, é
   * o mesmo peixe, ele está fora d'água agora, e quem relata está a uma distância
   * plausível dele.
   *
   * A única coisa que fica AQUI é a carência por jogador, e ela é de sala e não
   * de peixe: o que ela protege não é a vida do bicho (o dano de cada golpe já é
   * o dano de verdade, e matar o peixe mais rápido não dá vantagem nenhuma a
   * ninguém), é o CPU de um cliente defeituoso avisando sessenta vezes por
   * segundo. Setenta milissegundos são mais curtos que a cadência real da rajada
   * (167 ms), então nenhum acerto legítimo é engolido.
   */
  registrarPeixe(player, msg) {
    if (!player.alive) return;
    if (!Number.isFinite(msg?.i)) return;

    const agora = this.now();
    const carencia = NAMEK.peixe.avisoCarencia * 1000;
    if (agora - (player.peixeEm ?? -Infinity) < carencia) return;
    player.peixeEm = agora;

    const r = this.peixe.acerto(msg, this.pontoDe(player), agora);
    if (!r || !r.morreu) return;

    /* MORREU. Um anúncio só, com o ponto onde o corpo estava — o cliente estoura
       ali, vira o bicho de barriga para cima e o afunda. A morte NÃO entra no
       placar: abate é de lutador, e premiar quem matou um peixe com a mesma
       moeda de quem matou uma pessoa desequilibraria a única coisa que o modo
       conta. O próximo bicho vem sozinho, `NAMEK.peixe.respawn` segundos depois. */
    this.broadcastAll({
      t: NS2C.FISH_DOWN,
      i: msg.i,
      p: [round(r.p.x), round(r.p.y), round(r.p.z)],
      by: player.id,
    });
    this.log(`namek — o peixe gigante caiu (por ${player.name})`);
  }

  /**
   * "Caí de muito alto."
   *
   * Cratera, e vida. A queda é a única fonte de dano do modo que não tem
   * culpado — morrer assim conta a morte no placar e não dá abate a ninguém, o
   * que é a leitura honesta do que aconteceu.
   */
  registrarQueda(player, msg) {
    if (!player.alive || !vetorOk(msg.p)) return;
    const speed = Math.abs(Number(msg.speed) || 0);
    const F = NAMEK.fighter;
    const D = NAMEK.destruction;

    if (speed > D.slamSpeed) {
      this.cratera(msg.p[0], msg.p[2], Math.min((speed - D.slamSpeed) * D.slamPower, 16), player);
    }

    /* ======================== O MERGULHO DE PROPÓSITO NÃO MACHUCA ===========
     *
     * *"Quando o player está no ar, ele aperta F. O impacto dele no chão, devido
     * ao F, não deve sugar vida do player."*
     *
     * `tipo` separa as duas coisas que este mesmo baque pode ser, e a distinção
     * já existia DOCUMENTADA no cliente desde sempre (ver o `@returns` de
     * `FighterController.update`: *"`pouso` quando ele veio VOANDO, mergulho de
     * propósito, e `queda` quando ele veio caindo — sem voo, atordoado,
     * arremessado; os dois abrem cratera, o segundo é o que também machuca"*).
     * O campo simplesmente nunca chegava até aqui, e o dano saía igual nos dois
     * casos — o que fazia do `F` no ar uma tecla que se paga com vida.
     *
     * A CRATERA continua acontecendo nos dois, e ela é o ponto: o gesto continua
     * arrebentando o chão, levantando poeira e derrubando o cenário em volta. O
     * que ele deixa de fazer é cobrar do próprio corpo por uma manobra que o
     * jogador escolheu.
     *
     * A validação é a de sempre — nada vindo da rede vale sem ser conferido: só
     * a string exata `"pouso"` isenta, e qualquer outra coisa (ausente, lixo,
     * `"queda"`) cai no caminho que machuca. O teto do abuso é um cliente
     * mentiroso que nunca leva dano de queda, o que não tira vida de ninguém e
     * não dá vantagem nenhuma contra quem quer que seja: cair de duzentos metros
     * de propósito continua sendo mais lento que voar. */
    if (msg.tipo === "pouso") return;
    if (speed <= F.fallSafe) return;
    this.aplicarDano(player, (speed - F.fallSafe) * F.fallDamage, {
      kind: "queda",
      p: { x: msg.p[0], y: msg.p[1], z: msg.p[2] },
      d: [0, 1, 0],
    });
  }

  /** Renascer antes da hora. Depois do mínimo, quem quer voltar volta. */
  registrarRespawn(player) {
    if (player.alive || !player.respawnAt) return;
    const agora = this.now();
    const desde = player.respawnAt - NAMEK.respawn.delay * 1000;
    if (agora - desde < RESPAWN_MINIMO * 1000) return;
    this.nascer(player, agora);
  }

  /* ================================================================ envio == */

  /**
   * As poses de todo mundo, 20 Hz. **A mensagem mais cara do modo.**
   *
   * Cada lutador é empacotado UMA vez e serializado UMA vez, num fragmento de
   * texto; a mensagem de cada cliente é a junção dos fragmentos dos OUTROS. É a
   * diferença entre quinze `JSON.stringify` de catorze objetos por quadro
   * (trezentos por segundo, com quinze em campo) e quinze concatenações de
   * texto já pronto.
   *
   * E o motivo de excluir o próprio dono não é economia de bytes: é que a pose
   * dele é DELE (§8). Devolvê-la seria o servidor mandando de volta uma
   * informação que o cliente já tem melhor, e todo cliente teria de escrever a
   * linha que a ignora.
   */
  broadcastStates(agora) {
    for (const b of this.bots.list) {
      b.state = packFighter(b);
      b.stateTime = agora;
    }
    if (!this.players.size) return;

    const ids = [];
    const frags = [];
    for (const f of this.todos()) {
      if (!f.state) continue;
      ids.push(f.id);
      frags.push(JSON.stringify({ id: f.id, w: f.stateTime, ...podar(f.state) }));
    }
    if (!frags.length) return;

    const cabeca = `{"t":"${NS2C.STATES}","time":${agora},"s":[`;
    for (const p of this.players.values()) {
      let corpo = "";
      for (let i = 0; i < frags.length; i++) {
        if (ids[i] === p.id) continue;
        if (corpo) corpo += ",";
        corpo += frags[i];
      }
      if (!corpo) continue;
      raw(p.conn, cabeca + corpo + "]}");
    }
  }

  /**
   * Vida e ki de todos, 10 Hz.
   *
   * Array de arrays e não de objetos — o protocolo explica: quinze lutadores a
   * 10 Hz são a segunda mensagem mais cara do modo, e as chaves seriam metade
   * dos bytes. Os números vão inteiros porque a barra tem cem pixels: o
   * terceiro decimal de uma vida é ruído que custa quatro bytes.
   */
  broadcastVitals() {
    if (!this.players.size) return;
    const h = [];
    for (const f of this.todos()) h.push([f.id, Math.round(f.health), Math.round(f.ki)]);
    if (!h.length) return;
    this.broadcastAll({ t: NS2C.VITALS, h });
  }

  scores() {
    const s = [];
    for (const f of this.todos()) {
      s.push({
        id: f.id,
        name: f.name,
        color: f.color ?? null,
        isBot: f.isBot === true,
        ping: f.ping ?? 0,
        kills: f.score.kills,
        deaths: f.score.deaths,
      });
    }
    return s;
  }

  broadcastScores() {
    this.broadcastAll({ t: NS2C.SCORES, s: this.scores() });
  }

  /** Para todos menos `exceto` (por id). */
  broadcast(msg, exceto = null) {
    /* Sem ninguém para ouvir, nem o `JSON.stringify` acontece. Numa sala só de
       bots — que é o caso do banco de provas e o dos 30 s de carência — a briga
       inteira roda sem gastar um byte de serialização. */
    if (!this.players.size) return;
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.id === exceto) continue;
      raw(player.conn, data);
    }
  }

  /** Para todos, sem exceção. Mesmo par de nomes da sala do arqueiro. */
  broadcastAll(msg) {
    this.broadcast(msg, null);
  }

  destroy() {
    if (this.stepTimer) clearInterval(this.stepTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.stepTimer = null;
    this.sweepTimer = null;
    this.freeza.sair();
    this.bots.clear();
    this.players.clear();
    this.corpos.length = 0;
    this.corpoPorId.clear();
  }
}

/* ------------------------------------------------------------- ciclo de vida */

/**
 * A sala de Namekusei para esta entrada, criando-a se não existir.
 *
 * Mora AQUI e não em `RoomHost` de propósito: o §11 do plano permite acrescentar
 * um `if` em `ensure`, e um `if` é o que ele acrescentou. Toda a lógica de
 * procurar, criar e registrar cabe nesta função, e `server/room.js` continua
 * sendo o arquivo do jogo do arqueiro — com uma linha a mais.
 *
 * A busca casa só a FASE, porque o modo é um só (`deathmatch`): não há tecla 9
 * neste jogo, nem troca de modo, nem sala que viaja. Sala de Namekusei é sala
 * de Namekusei para sempre.
 */
export function ensureNamekRoom(host) {
  for (const room of host.rooms) {
    if (room.level !== NAMEK_LEVEL) continue;
    /* Sala cheia de GENTE é pulada; sala cheia de BOT não — ver `join`, que
       abre vaga tirando um adversário de CPU. Mandar a pessoa para uma sala
       nova só porque a outra estava cheia de treino seria separá-la justamente
       de quem ela veio encontrar. */
    if (room.players.size >= NAMEK.net.maxPlayers) continue;
    host.cancelTeardown(room);
    return room;
  }

  const room = new NamekRoom({ log: host.log });
  room.onEmpty = (r) => host.scheduleTeardown(r);
  host.rooms.add(room);
  host.log(`sala criada — ${NAMEK_LEVEL} / ${NAMEK_MODE} (${host.rooms.size} no ar)`);
  return room;
}

/* ---------------------------------------------------------------- auxiliares */

/**
 * O que a sala conta sobre alguém para os outros.
 *
 * Passa no `WELCOME`, no `JOIN` e no `roster` — os três caminhos por onde um
 * corpo aparece na tela alheia. Mesma função do `publicView` do arqueiro, com o
 * `char` no lugar da `skin`: é o mesmo tipo de dado (um por PESSOA, que não muda
 * durante a partida e que todo mundo precisa para desenhá-la).
 */
function view(f) {
  return {
    id: f.id,
    name: f.name,
    color: f.color ?? null,
    char: f.char,
    isBot: f.isBot === true,
  };
}

function send(conn, msg) {
  raw(conn, JSON.stringify(msg));
}

function raw(conn, data) {
  try {
    conn.send(data);
  } catch {
    /* socket fechando no meio do envio: o `close` cuida do resto */
  }
}

/**
 * Os canais de pose que têm PADRÃO, e qual é.
 *
 * A lista sai de `unpackFighter`: todo campo que ele lê com `?? 0` (ou `?? -1`,
 * no caso do especial) é um campo que o protocolo já declarou opcional. Ver
 * `podar` para o que se faz com isso.
 */
const PADROES = { r: 0, g: 0, n: 0, fl: 0, bo: 0, ch: 0, sp: 0, sk: -1, hu: 0, ha: 0, hp: 0 };

/**
 * Tira da pose o que é igual ao padrão. **É a maior economia do modo.**
 *
 * `packFighter` sempre escreve os dezessete canais, porque ele não sabe para
 * onde a pose vai. Mas `unpackFighter` lê onze deles com `?? 0` — ou seja, o
 * protocolo já diz, por escrito e dos dois lados, que a ausência de um canal
 * significa zero. Não mandar o que é zero não é apertar o contrato: é usá-lo.
 *
 * E a diferença é grande porque a maioria dos canais é zero quase sempre. Um
 * lutador voando não tem marcha (`g`, `n`), não está carregando (`ch`), não
 * está soltando especial (`sp`, `sk`) e não está doendo (`hu`) — sete dos onze,
 * na maior parte dos quadros. Com quinze em campo, a mensagem de 20 Hz é a
 * conta de rede inteira deste modo, e um terço dela era a palavra "zero"
 * repetida.
 *
 * O que NÃO se poda: posição, velocidade, yaw, pitch e os bits. `unpackFighter`
 * os lê sem padrão, e é assim que tem de ser — uma posição ausente não é uma
 * posição na origem.
 */
function podar(s) {
  const out = { p: s.p, v: s.v, y: s.y, i: s.i, b: s.b };
  for (const k in PADROES) {
    const v = s[k];
    if (v !== undefined && v !== PADROES[k]) out[k] = v;
  }
  return out;
}

/** Um `[x,y,z]` que veio da rede é utilizável? */
function vetorOk(v) {
  return Array.isArray(v) && v.length >= 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/** Arredonda um vetor para o milímetro, como `r3v` faz do lado de lá. */
function vec(v) {
  return [round(v[0]), round(v[1]), round(v[2])];
}

function versorEntre(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return { x: 0, y: 1, z: 0 };
  return { x: dx / d, y: dy / d, z: dz / d };
}

/**
 * Prende um instante vindo do cliente a uma janela plausível em torno de agora.
 *
 * Cópia consciente do `clampTime` de `server/room.js` — quinze linhas que não
 * podem ser importadas de lá sem criar a dependência que o §0 existe para
 * evitar, e cuja razão de ser é idêntica: um relógio adiantado jogaria a pose
 * no futuro e ela ficaria congelada até o tempo alcançá-la.
 */
function clampTempo(t, agora) {
  if (typeof t !== "number" || !Number.isFinite(t)) return agora;
  return Math.min(agora + 100, Math.max(agora - 500, t));
}
