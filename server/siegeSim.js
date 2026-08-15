/* ---------------------------------------------------------------------------
   O cerco, no servidor.

   Mesma divisão de `zombieSim.js` e `meteorSim.js`: a inteligência dos
   sitiantes, a vida do portão e o relógio da partida moram AQUI, e o cliente só
   recebe poses a 10 Hz. O que muda em relação aos dois é o que o modo pergunta.

   ------------------------------------------------------------------- a ideia

   O modo zumbi pergunta "onde está o alvo". A chuva de meteoros pergunta
   "quanto tempo falta". O cerco pergunta **quantos passaram** — e é a primeira
   vez que a resposta é uma TAXA.

   Três consequências que explicam quase todo o código abaixo:

   • **A derrota é uma FILA.** O portão não cai porque alguém errou um tiro; cai
     porque, durante algumas dezenas de segundos, chegou mais gente na base dele
     do que saiu. `gateSlots` põe um teto no dano por segundo e produz o
     aglomerado parado que dá ao trabuco um alvo — ver `atribuirVagas`.

   • **NÃO HÁ HORDAS.** Não existe `nextHorde`, não existe `hordeDelay`, não
     existe faixa de "HORDA 3". O que existe é `gapAtual()`: uma função contínua
     do tempo de partida. Sem onda não há pausa entre ondas, e o que devolve o
     fôlego é a MARÉ (`tide()`), que aperta e afrouxa de 78 em 78 segundos.

   • **O ritmo é agendado pela CHEGADA, nunca pelo nascimento.** É a terceira
     vez que este projeto escreve esta linha (ver `hordeArrivalGaps` no zumbi e
     `hordeGaps` na chuva) e aqui ela é mais grave que nunca: a rampa tem 90 m,
     um esqueleto a 2,4 m/s a cobre em 37 s e um ogro a 0,9 m/s em 100 s.
     Espaçar o nascimento entregaria todos os esqueletos juntos e os ogros num
     bloco um minuto depois. Ver `agendar()`.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { FRAME } from "../src/shared/protocol.js";
import { bloqueado } from "../src/shared/blockers.js";
import {
  CASTLE,
  GROUND_Y,
  WALL_TOP,
  WALL_ZC,
  gateInfo,
  castleBlockers,
  insideFootprint,
  gateBlocks,
  mageTowers,
} from "../src/shared/castleProps.js";

let proximoId = 1;
/** Contador das bolas de magia. Ver `bid` em `atualizarMago` e `cancelarRaio`. */
let proximoRaio = 1;

/** A ordem É o código da espécie no quadro binário. Nunca reordenar. */
export const KINDS = [
  "soldier",
  "shielded",
  "skeleton",
  "climber",
  "hound",
  "shaman",
  "ogre",
  "catapult",
];

/** Idem para o estado. Ver `packFrame`. */
/**
 * Idem para o estado. Ver `packFrame`.
 *
 * `bones` é o esqueleto DESMONTADO — caído, mas que ainda vai voltar. Ele é
 * separado de `down` porque o cliente desenha as duas coisas de modo diferente:
 * `down` é um corpo tombado, `bones` é uma pilha de ossos que se remonta.
 * Sem o estado próprio, o cliente não teria como saber qual dos dois é.
 */
export const STATES = ["walk", "attack", "climb", "cast", "down", "rise", "bones"];

const DEFLECTIONS = [0, 0.4, -0.4, 0.85, -0.85, 1.45, -1.45];
const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/* Os bloqueadores do castelo são os MESMOS do cliente e não mudam nunca:
   calculados uma vez, no carregamento do módulo. É a lista que responde se o
   xamã tem visada para quem está atrás de um merlão. */
const BLOCKERS = castleBlockers();
const GATE = gateInfo();

/**
 * Altura de cada espécie, em metros, ANTES da escala. Cópia do `h` de `FICHAS`
 * em `src/entities/besieger.js` — ver `Besieger.altura` para o porquê da cópia.
 * O mastim é o número que importa: 1,05 m, e um valor genérico de 1,8 mandaria
 * a flecha do bot para meio metro acima das costas de um cachorro.
 */
const ALTURAS = {
  soldier: 1.82,
  shielded: 1.8,
  skeleton: 1.7,
  climber: 1.62,
  hound: 1.05,
  shaman: 1.8,
  ogre: 1.9,
  catapult: 2.6,
};

/* ------------------------------------------------------------------ sitiante */

export class Besieger {
  constructor(kind, x, z, terrain) {
    const S = CONFIG.modes.siege.species[kind];
    this.id = proximoId++;
    this.kind = kind;
    this.terrain = terrain;
    this.x = x;
    this.z = z;
    this.y = terrain.heightAt(x, z);
    /** Andada do último passo, m/s. Ver `step` — quem lê é a flecha do bot. */
    this.vx = 0;
    this.vz = 0;
    this.yaw = Math.PI; // olhando para o portão (−Z)
    this.state = "walk";
    this.dead = false;
    this.deadSince = 0;
    this.burning = false;
    this.hits = 0;
    this.maxHits = S.arrows;
    this.speed = S.speed * (1 + (Math.random() * 2 - 1) * 0.16);
    this.lastAttack = -Infinity;
    /** Vaga na fila do portão, ou −1. */
    this.slot = -1;
    /** Posição na fila, incluindo quem espera atrás das vagas. */
    this.queue = null;
    /** Esqueleto: já remontou uma vez? */
    this.risen = false;
    /** Escalador: 0 a 1 subindo o muro. */
    this.climb = 0;
    /** Onde ele encosta no muro / para de andar. */
    this.anchor = null;
    /** Xamã e catapulta: instante do próximo tiro. */
    this.nextShot = 0;
    /** Fogo do piche: segundos restantes queimando. */
    this.fire = 0;
  }

  get scale() {
    return this.kind === "ogre" ? 3.4 : 1;
  }

  /**
   * Altura do corpo, em metros. Espelha o `h` de `FICHAS`
   * (`src/entities/besieger.js`), pelo mesmo motivo que `scale` espelha o
   * `escala` de lá: o servidor não pode importar aquele arquivo, que carrega
   * Three.js inteiro junto.
   *
   * Quem lê é a flecha do bot (`Room.botPrey` → `botArrow.js`), que precisa do
   * eixo do corpo para acertar em qualquer altura — e não só na cota exata em
   * que o bot mirou.
   */
  get altura() {
    return (ALTURAS[this.kind] ?? 1.8) * this.scale;
  }

  /** Altura do peito — de onde sai o tiro do xamã e onde a flecha acerta. */
  get chestY() {
    return this.y + 1.1 * this.scale;
  }

  /**
   * Um passo. Devolve `false` quando o destino é intransponível, e é isso que
   * alimenta o leque de desvios em `walkToward`.
   *
   * As três recusas, em ordem de custo:
   *   1. alvenaria (`insideFootprint`) — o muro, que o terreno não conhece;
   *   2. o vão do portão enquanto ele estiver de pé (`gateBlocks`);
   *   3. despenhadeiro e borda do mundo (`isWalkable`, que no castelo já
   *      recusa inclinação — ver `castleField.isWalkable`).
   */
  step(fx, fz, dt, gateAlive) {
    const passo = this.speed * dt;
    const nx = this.x + fx * passo;
    const nz = this.z + fz * passo;
    const m = 0.3 * this.scale;
    if (insideFootprint(nx, nz, m)) return false;
    if (gateAlive && gateBlocks(nx, nz, m)) return false;
    if (!this.terrain.isWalkable(nx, nz)) return false;
    if (this.terrain.arenaDistance(nx, nz) > 10) return false;
    this.x = nx;
    this.z = nz;
    this.y = this.terrain.heightAt(nx, nz);
    /* A velocidade do passo que DEU CERTO — não a intenção.
     *
     * Quem lê é a flecha do bot (`Room.botPrey` → `botArrow.js`), que precisa
     * saber para onde ele vai durante o meio segundo de voo. Guardar a direção
     * pedida em vez da andada mentiria justamente no caso que importa: o
     * sujeito parado contra o portão, que continua "querendo" ir para a
     * frente e não sai do lugar. */
    this.vx = fx * this.speed;
    this.vz = fz * this.speed;
    return true;
  }

  /** Parou de andar (bateu, escalou, conjurou): a mira do bot para junto. */
  parar() {
    this.vx = 0;
    this.vz = 0;
  }

  walkToward(tx, tz, dt, gateAlive, vizinhos) {
    let sx = tx - this.x;
    let sz = tz - this.z;
    const len = Math.hypot(sx, sz);
    if (len > 1e-4) {
      sx /= len;
      sz /= len;
    }

    const sep = this.separacao(vizinhos);
    sx += sep.x;
    sz += sep.z;

    const base = Math.atan2(sx, sz);
    for (const desvio of DEFLECTIONS) {
      const ang = base + desvio;
      if (this.step(Math.sin(ang), Math.cos(ang), dt, gateAlive)) {
        this.yaw = ang;
        return true;
      }
    }
    this.yaw = base;
    return false;
  }

  /**
   * Repulsão entre vizinhos, resolvida aqui e não pelo solver do cliente.
   *
   * Mesma escolha do modo zumbi, e pelo mesmo motivo — 120 cápsulas dinâmicas
   * empurrando umas às outras é uma malha de contatos que o cliente não tem
   * orçamento para manter, e que ainda por cima divergiria entre telas.
   */
  separacao(vizinhos) {
    let ax = 0;
    let az = 0;
    const r = 0.95 * this.scale;
    for (const o of vizinhos) {
      if (o === this || o.dead) continue;
      const dx = this.x - o.x;
      const dz = this.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d > r || d < 1e-4) continue;
      const f = (1 - d / r) * 1.3;
      ax += (dx / d) * f;
      az += (dz / d) * f;
    }
    return { x: ax, z: az };
  }

  faceToward(x, z) {
    this.yaw = Math.atan2(x - this.x, z - this.z);
  }
}

/* --------------------------------------------------------------------- cerco */

/**
 * O nome de um nível de dificuldade, peneirado.
 *
 * Mesmo contrato do `meteorDifficultyOf`, e pelo mesmo motivo: todo caminho que
 * chega aqui vem da REDE (`C2S.SIEGE_DIFFICULTY`), e um cerco dimensionado por
 * um campo que o cliente escolheu seria a sala inteira refém de quem digitou
 * qualquer coisa no console. O que não estiver na tabela vira o padrão, calado.
 *
 * @param {unknown} nivel
 * @returns {"easy"|"normal"|"hard"}
 */
export function siegeDifficultyOf(nivel) {
  const S = CONFIG.modes.siege;
  return typeof nivel === "string" && S.difficulties[nivel] ? nivel : S.defaultDifficulty;
}

export class Siege {
  constructor(terrain) {
    this.terrain = terrain;
    /* FORA do `start`, e é de propósito: a dificuldade é uma escolha da SALA e
       sobrevive ao fim da partida. Recomeçar o cerco com Enter não devolve
       ninguém ao normal — quem pediu o difícil pediu o difícil. */
    this.dificuldade = CONFIG.modes.siege.defaultDifficulty;
    this.ativo = false;
    this.over = false;
    this.venceu = false;
    /** @type {Besieger[]} */
    this.lista = [];
    /** Vida do portão, absoluta. */
    this.gateHp = CONFIG.modes.siege.gateHealth;
    this.gateMax = CONFIG.modes.siege.gateHealth;
    this.gateAlive = true;
    /** Segundos de partida, a partir do fim de `startDelay`. */
    this.t = 0;
    /** Segundos até o primeiro sitiante sair da linha de árvores. */
    this.espera = 0;
    this.players = 1;
    /** Escalões já anunciados, por índice. */
    this.tiersOut = new Set();
    /** Quanto tempo o portão passou abaixo do crítico — vai para a tela de fim. */
    this.criticalTime = 0;
    /**
     * @type {Array<{kind:string, chegada:number, nascimento:number}>} as chegadas
     * já sorteadas e ainda não nascidas.
     *
     * UMA FILA, e não um único agendado — ver `agendar`.
     */
    this.pendentes = [];
    this.nextOgre = Infinity;
    this.nextCatapult = Infinity;
    /** Piche em chamas no chão: `{x, z, r, until, dps, owner}`. */
    this.fogos = [];
    this.kills = new Map();
  }

  /* ------------------------------------------------------------- ciclo ---- */

  /**
   * Aponta para o campo da fase ATUAL.
   *
   * A troca de fase constrói um campo novo (ver `Room.terrain`), e um cerco
   * segurando o campo antigo faria a horda andar no relevo de um castelo que
   * já não existe. Mesma razão do `MeteorRain.setTerrain`.
   */
  setTerrain(terrain) {
    this.terrain = terrain;
    for (const b of this.lista) b.terrain = terrain;
  }

  /**
   * @param {number} [nPlayers]
   * @param {string} [dificuldade] o nível pedido. Omitido, o que já valia
   *   continua valendo — recomeçar o cerco não é trocar de nível.
   */
  start(nPlayers = 1, dificuldade = undefined) {
    const S = CONFIG.modes.siege;
    /* ANTES de tudo: `perfil` decide a vida do portão e o passo da coluna de
       abertura, e as duas coisas são escritas logo abaixo. */
    if (dificuldade !== undefined) this.dificuldade = siegeDifficultyOf(dificuldade);
    this.ativo = true;
    this.over = false;
    this.venceu = false;
    this.lista = [];
    /* O PORTÃO É O SEGUNDO MOSTRADOR do nível, e ele existe porque o primeiro
       não se vê. Apertar a chegada em 13 % — que é o que separa o difícil do
       normal — é invisível na rampa: ninguém conta segundos entre dois soldados
       saindo do bosque. A madeira cedendo mais cedo, essa se vê, se ouve e
       muda o que a pessoa faz com o tempo dela. */
    this.gateHp = S.gateHealth * this.perfil.gate;
    this.gateMax = this.gateHp;
    this.gateAlive = true;
    this.t = 0;
    this.espera = S.startDelay;
    this.setPlayers(nPlayers);
    this.tiersOut = new Set();
    this.criticalTime = 0;
    this.pendentes = [];
    /* A FILA DE CHEGADAS COMEÇA UMA CAMINHADA ADIANTADA — e é esta linha que
     * põe a horda saindo da floresta em vez de surgindo no meio da ponte.
     *
     * `agendar()` marca CHEGADAS ao portão e deriva delas o nascimento
     * (`chegada − viagem`). Começando o acumulador em zero, a primeira chegada
     * caía nos 5,5 s de partida — e para chegar ali um soldado teria de ter
     * saído da linha de árvores 74 s ANTES de a partida existir. A resposta
     * antiga era nascer com o percurso já andado, no ponto da rampa em que ele
     * estaria: do muro se via gente aparecendo no meio da ponte, às vezes a um
     * passo do portão.
     *
     * Adiantando o acumulador de uma travessia, ninguém deve caminhada
     * nenhuma: cada um nasce no bosque, no instante certo, e sobe a rampa
     * inteira. O que muda no jogo é só a abertura — o portão fica em paz
     * enquanto a coluna sobe —, e ela não é tempo morto: a rampa está ao
     * alcance do arco desde o primeiro segundo, e agora ela tem gente. A curva
     * de pressão em regime é EXATAMENTE a mesma, só deslocada — e é
     * `faseDaCurva` que desfaz o deslocamento, ancorando a curva na primeira
     * chegada em vez de no carregamento da fase. */
    this.abertura = this.viagem("soldier");
    this.ultimaChegada = this.abertura;
    this.nextOgre = Infinity;
    this.nextCatapult = Infinity;
    this.fogos = [];
    this.kills = new Map();
    this.enfileirarAbertura();
    /* AS TORRES ESTÃO OCUPADAS DESDE O PRIMEIRO SEGUNDO.
       Elas não têm escalão e não entram no sorteio: são cenário com gente
       dentro, e a ameaça delas é o que impede a metade distante da rampa de
       ser um lugar seguro para olhar. Ver `mageTowers`. */
    this.magoEspera = mageTowers().map(() => 0);
    this.raiosPendentes = [];
    for (const t of mageTowers()) this.nascerMago(t);
    return { duration: S.duration, gate: 1 };
  }

  stop() {
    this.ativo = false;
    this.lista = [];
    this.fogos = [];
  }

  get alive() {
    let n = 0;
    for (const b of this.lista) if (!b.dead) n++;
    return n;
  }

  /** Quantos estão batendo no portão AGORA. É a única variável que o jogador
      controla diretamente, e por isso ela vai para o HUD. */
  get fila() {
    let n = 0;
    for (const b of this.lista) if (!b.dead && b.slot >= 0) n++;
    return n;
  }

  /* ------------------------------------------------------------ pressão ---- */

  /**
   * O RELÓGIO DA CURVA, que deixou de ser o relógio da partida.
   *
   * `gapBase` e a maré descrevem dez minutos de CERCO — de "chega um a cada
   * 5,5 s" até "chega um a cada 1,35 s". Enquanto a horda nascia já na rampa,
   * o primeiro sujeito batia no portão aos 5 s de partida e os dois relógios
   * eram o mesmo. Nascendo na floresta (ver `start`), o primeiro só chega
   * depois de atravessar os 91 m: a defesa começa aos ~80 s.
   *
   * Deixar a curva no relógio da partida custava as duas pontas ao mesmo
   * tempo — a abertura mansa era gasta com a rampa vazia, e os oitenta
   * segundos finais, que são os mais apertados e os que decidem, nunca
   * chegavam a acontecer. Medido no banco de provas: um defensor sozinho
   * passava de 0 % para 80 % de vitórias, ou seja, o modo deixava de ser o modo.
   *
   * A curva é então ancorada na PRIMEIRA CHEGADA e esticada para caber na
   * janela que sobra. Ela mantém forma, extremos e calibragem — o que muda é
   * só que ela é lida entre o primeiro contato e o pôr do sol, em vez de entre
   * a tela de carregamento e o pôr do sol.
   *
   * @param {number} quando instante da CHEGADA que se está espaçando
   */
  faseDaCurva(quando) {
    const S = CONFIG.modes.siege;
    const abertura = this.abertura ?? 0;
    const janela = Math.max(1, S.duration - abertura);
    return Math.max(0, quando - abertura) * (S.duration / janela);
  }

  /**
   * O intervalo entre duas CHEGADAS ao portão, num instante da partida.
   *
   * `gapBase` é uma tabela de um ponto por minuto, interpolada. Tabela e não
   * fórmula porque é a tabela que o banco de provas corrige num ponto só.
   *
   * @param {number} [quando] o instante da CHEGADA que se está espaçando, e
   *   não o relógio de agora — a fila corre uma travessia à frente. Ver
   *   `faseDaCurva`.
   */
  gapAtual(quando = this.t) {
    const S = CONFIG.modes.siege;
    const tab = S.gapBase;
    const fase = this.faseDaCurva(quando);
    const m = clamp(fase / 60, 0, tab.length - 1);
    const i = Math.floor(m);
    const f = m - i;
    const base = tab[i] + (tab[Math.min(i + 1, tab.length - 1)] - tab[i]) * f;
    return base * this.tide(fase) * this.escalaDoRitmo();
  }

  /**
   * Os multiplicadores do nível em curso. Ver `difficulties` no config.
   */
  get perfil() {
    const S = CONFIG.modes.siege;
    return S.difficulties[this.dificuldade] ?? S.difficulties[S.defaultDifficulty];
  }

  /**
   * O intervalo entre chegadas, inteiro: guarnição VEZES nível.
   *
   * As duas coisas se MULTIPLICAM, e é isso que faz o pedido "os níveis devem
   * ser proporcionais ao número de jogadores" ser verdade sem nenhuma tabela a
   * mais. O nível escolhe o quanto o cerco pesa por defensor; a guarnição diz
   * quantos defensores existem. O difícil de quatro pessoas é quatro vezes o
   * difícil de uma, e não um difícil diferente.
   *
   * Se o nível SUBSTITUÍSSE a escala em vez de multiplicá-la, cada um dos três
   * precisaria da sua própria lei de N — três curvas para manter afinadas em vez
   * de uma, que é exatamente o erro que a tabela de `difficulties` evita ao ser
   * multiplicador em vez de cópia.
   */
  escalaDoRitmo() {
    return this.escalaDeDefensores() * this.perfil.gap;
  }

  /**
   * O QUANTO A GUARNIÇÃO APERTA A CURVA — e é isto que faz o modo caber tanto
   * num defensor sozinho quanto num adarve cheio.
   *
   * `gapBase` descreve o cerco de UM defensor. Cada defensor a mais é um arco a
   * mais na muralha, e sem apertar nada o segundo jogador dobraria a capacidade
   * de abate sem dobrar coisa alguma do outro lado: era isso que fazia a
   * diferença entre "impossível" e "trivial" caber em um único participante de
   * distância, medida no banco de provas.
   *
   * A lei é uma POTÊNCIA de N, e não o `s^(N−1)` geométrico que estava aqui. A
   * razão é que a capacidade cresce LINEARMENTE — cada arqueiro é um arco —, e
   * só uma potência acompanha isso: o fator geométrico de 0,85 dava ×1,38 de
   * pressão para ×3 de poder de fogo, ou seja, cada reforço deixava o cerco
   * mais fácil em vez de apenas maior.
   *
   * O expoente fica em torno de 1, e o ajuste fino dele mora em `CONFIG` (ver
   * `playerGapExp`, que carrega as medições). O que esta função garante é o
   * sinal da conta, que é o que estava errado: mais gente no adarve é mais
   * cerco, nunca menos.
   *
   * @param {number} [n] quantos defensores, se não os desta partida
   */
  escalaDeDefensores(n = this.players) {
    const S = CONFIG.modes.siege;
    /* O EXPOENTE É DO NÍVEL, e o do config é a âncora de quem não declara o
       seu. É aqui que o fácil e o difícil deixam de ser o mesmo cerco com o
       volume mudado: no difícil cada arqueiro a mais traz mais cerco do que traz
       flecha, e no fácil o contrário. Ver `difficulties` no config. */
    return Math.pow(Math.max(1, n), -(this.perfil.exp ?? S.playerGapExp));
  }

  /**
   * A guarnição mudou de tamanho no meio do cerco.
   *
   * Chega tanto de gente entrando na sala quanto da tecla `B` — e as duas coisas
   * têm de valer o mesmo, porque o portão não sabe distinguir um arco de CPU de
   * um arco humano.
   *
   * O QUE JÁ ESTÁ MARCADO NÃO MUDA, e é de propósito. A fila de chegadas corre
   * uma travessia (~84 s) à frente do relógio: quem já saiu da linha de árvores
   * está na rampa, à vista, e reescrever a hora dele seria mover gente que o
   * jogador está olhando. O reforço aperta a curva DO HORIZONTE EM DIANTE, que
   * é o mesmo critério da chuva de meteoros — lá uma horda em curso também
   * nunca é remexida. Na prática: quem chama dois bots vê a rampa engrossar no
   * minuto seguinte, não no segundo seguinte.
   */
  setPlayers(n) {
    this.players = Math.max(1, n | 0);
  }

  /**
   * A maré — o que substitui a pausa entre ondas.
   *
   * Sem onda não há pausa, e sem pausa ninguém larga o arco para içar o
   * contrapeso ou reparar o portão. O período de 78 s é escolhido contra o
   * relógio do trabuco: a vazante dura ~20 s, mais que os 14 s de içamento
   * automático.
   *
   * Depois de `tideEndsAt` ela PARA — nem vazante, nem preamar.
   *
   * Travá-la na preamar (`1 − tideDepth`) foi a primeira tentativa e produziu
   * um precipício: entre 4 200 e 4 800 de vida de portão a taxa de vitória
   * pulava de 28 % para 80 %, com todas as derrotas nos últimos 40 s. Os dois
   * últimos minutos decidiam a partida inteira e os dezoito anteriores não
   * tinham consequência. Parada em 1, o clímax continua sem alívio — que é o
   * que "maré cheia, sem vazante" quer dizer — sem ser um dado de uma face.
   */
  /** @param {number} [fase] já em tempo de CURVA — ver `faseDaCurva`. */
  tide(fase = this.faseDaCurva(this.t)) {
    const S = CONFIG.modes.siege;
    if (fase >= S.tideEndsAt) return 1;
    return 1 + S.tideDepth * Math.sin((TAU * fase) / S.tidePeriod);
  }

  /** De 0 a 1: quanto a maré está apertando. Vai para o HUD e para os tambores. */
  get pressao() {
    return clamp(1 - (this.gapAtual() - 0.8) / (4.5 - 0.8), 0, 1);
  }

  /**
   * Adianta o relógio até o próximo escalão. ATALHO DE TESTE.
   *
   * O que ele NÃO faz é tão importante quanto o que faz: não invoca o escalão à
   * mão. Ele só move `this.t` para o segundo em que o escalão entra, e o passo
   * seguinte de `update` dispara a trompa, a faixa e a mudança de composição
   * pelo caminho normal — testar um atalho que passa por fora do caminho normal
   * é testar o atalho.
   *
   * A fila de chegadas é RECOLOCADA junto. Ela corre uma travessia à frente de
   * `this.t`; empurrando só o relógio, ela ficaria no passado e o próximo passo
   * despejaria de uma vez todos os sitiantes cuja chegada venceu — quarenta de
   * uma vez, na linha de árvores.
   *
   * @param {string|null} [alvoKind] pula direto para o escalão desta espécie,
   *   em vez do próximo. É o que serve o caso comum — "quero ver o escalador
   *   agora" —, que de outro modo pediria dois toques e a leitura de uma
   *   tabela de segundos.
   * @returns {number} o segundo de partida em que o cerco ficou
   */
  pularEscalao(alvoKind = null) {
    const S = CONFIG.modes.siege;
    const proximo = alvoKind
      ? S.tiers.find((t) => t.kind === alvoKind)
      : S.tiers.find((t, i) => !this.tiersOut.has(i) && t.at > this.t);
    if (!proximo || proximo.at <= this.t) return this.t;
    this.espera = 0;
    this.t = proximo.at;
    this.ultimaChegada = this.t + this.abertura;
    this.pendentes = [];
    return this.t;
  }

  /**
   * O escalão de uma espécie, ou `null` se ela não tem um.
   *
   * O mago de mirante é um xamã sem escalão (`nascerMago` não passa por aqui), e
   * o `null` existe para essa gente: espécie sem degrau é espécie que nunca foi
   * prometida na tela e por isso nunca pode sair no sorteio.
   */
  escalaoDe(kind) {
    return CONFIG.modes.siege.tiers.find((t) => t.kind === kind) ?? null;
  }

  /**
   * Sorteia a espécie de uma chegada — e a trava é o NASCIMENTO, não a chegada.
   *
   * NADA APARECE NA RAMPA ANTES DE TER SIDO ANUNCIADO, e é esta linha que
   * garante isso. A regra anterior soltava a espécie no sorteio uma travessia
   * ANTES da faixa, apostando que o primeiro exemplar chegaria ao portão no
   * segundo do anúncio. A aposta ignorava que a rampa é o campo de tiro: o
   * jogador não vê ninguém "chegar", ele vê sair do bosque. Medido, o buraco era
   * grande — escalador na rampa aos 80 s com a faixa dele aos 105, xamã aos 116
   * com a faixa aos 165, pavês aos 236 com a faixa aos 300. Três espécies
   * inteiras entravam em campo sem nome, no meio do escalão anterior, que é
   * exatamente o defeito que os degraus existem para não ter.
   *
   * Agora a conta é exata em vez de aproximada: sabemos a chegada que estamos
   * espaçando e sabemos a travessia de cada espécie, então sabemos o SEGUNDO em
   * que cada candidata sairia do bosque. Quem sairia antes da própria faixa não
   * entra no sorteio. O degrau volta a valer o que ele diz.
   *
   * Ogro e catapulta NÃO entram aqui: têm relógio próprio, porque uma espécie
   * que aparece por sorteio pode não aparecer nunca — e "o ogro do minuto 9" é
   * um evento, não uma probabilidade.
   *
   * @param {number} chegada o instante de chegada ao portão que se está sorteando
   */
  sortearEspecie(chegada = this.t) {
    const S = CONFIG.modes.siege;
    const pesos = [];
    let total = 0;
    for (const [kind, p] of Object.entries(S.weights)) {
      if (!p) continue;
      const tier = this.escalaoDe(kind);
      if (!tier) continue;
      // O segundo em que ESTE bicho sairia da linha de árvores.
      if (chegada - this.viagem(kind) < tier.at) continue;
      if (kind === "shaman" && this.contar("shaman") >= S.shamanMax) continue;
      if (kind === "climber" && this.contar("climber") >= S.climberMax) continue;
      pesos.push([kind, p]);
      total += p;
    }
    if (!pesos.length) return "soldier";
    let r = Math.random() * total;
    for (const [kind, p] of pesos) {
      r -= p;
      if (r <= 0) return kind;
    }
    return pesos[pesos.length - 1][0];
  }

  /**
   * Quantos desta espécie estão em campo — SEM os magos das torres.
   *
   * Eles são xamãs (ver `nascerMago`), e contá-los aqui gastaria dois dos três
   * lugares de `shamanMax` com gente que nem chega perto da rampa: o escalão
   * dos xamãs abriria e o sorteio nunca conseguiria pôr um em campo.
   */
  contar(kind) {
    let n = 0;
    for (const b of this.lista) if (!b.dead && b.kind === kind && b.torre == null) n++;
    return n;
  }

  /**
   * O TETO É RECONFERIDO NA HORA DE SAIR DO BOSQUE, e não só no sorteio.
   *
   * `sortearEspecie` escolhe uma travessia inteira antes do nascimento (ver
   * `horizonte`), e `shamanMax`/`climberMax` contam quem está EM CAMPO — dois
   * relógios diferentes. Sem esta reconferência, cinco escaladores sorteados num
   * minuto em que não havia nenhum nasceriam todos juntos um minuto depois, e o
   * teto que existe para o adarve não virar uma escada não valeria nada.
   *
   * Quem não cabe vira SOLDADO em vez de sumir: a chegada foi marcada pela
   * curva, e apagá-la seria tirar pressão do portão por um limite que é sobre
   * variedade, não sobre volume.
   */
  escolherNoNascimento(kind) {
    const S = CONFIG.modes.siege;
    if (kind === "shaman" && this.contar("shaman") >= S.shamanMax) return "soldier";
    if (kind === "climber" && this.contar("climber") >= S.climberMax) return "soldier";
    return kind;
  }

  /**
   * Agenda a próxima chegada e deriva dela o instante de nascimento.
   *
   * É a peça central do ritmo. Ver o cabeçalho do arquivo para por que ela não
   * pode ser um simples "nasce a cada N segundos".
   *
   * ---------------------------------------------------- por que ela ENFILEIRA
   *
   * Havia UM agendado por vez (`this.pendente`), e esse único lugar era um
   * defeito de trancar a fase inteira.
   *
   * A ordem de nascimento NÃO é a ordem de chegada, e não pode ser: o ritmo é
   * agendado pela chegada, e cada espécie leva um tempo diferente na rampa. Um
   * esqueleto (2,4 m/s, 40 s de subida) que chega ao portão no segundo 90 sai do
   * bosque no 50; um soldado (1,15 m/s, 84 s) que chega no 93 sai no 9. Com um
   * lugar só, sortear o esqueleto PARAVA a fila até o segundo 50 — e o soldado
   * do segundo 9, que já devia estar subindo, nunca era sequer sorteado.
   *
   * Medido, com o defeito: três soldados nos primeiros dez segundos e mais
   * ninguém até o 55. A abertura era uma rampa vazia, que é justamente o
   * contrário do que a abertura tem de ser. E não era só a abertura — o cerco
   * inteiro nascia com 118 sitiantes em dez minutos onde a curva pede ~300, ou
   * seja, o modo rodava a um terço da pressão que `gapBase` descreve.
   *
   * Com uma fila cada chegada espera a própria hora sem segurar as de trás, e a
   * curva de `gapBase` passa a ser o que ela sempre disse ser.
   */
  agendar() {
    /* A chegada ACUMULA — ela não é "daqui a `gap` segundos".
       Contada a partir de `this.t`, cada tique reiniciaria o relógio e o
       intervalo real viraria o passo da simulação: cem sitiantes por segundo. */
    /* O espaçamento é lido NO INSTANTE DA CHEGADA que ele separa, e não no
       relógio de agora — a fila corre uma travessia à frente. Ver `gapAtual`. */
    const anterior = Math.max(this.ultimaChegada ?? 0, this.t);
    const chegada = anterior + this.gapAtual(anterior);
    this.ultimaChegada = chegada;
    const kind = this.sortearEspecie(chegada);
    this.pendentes.push({ kind, chegada, nascimento: chegada - this.viagem(kind) });
  }

  /**
   * Até onde a fila precisa correr à frente do relógio.
   *
   * É a travessia MAIS LONGA do sorteio: uma chegada marcada para daqui a menos
   * que isso pode ser de um xamã, e o xamã tem de sair do bosque agora para
   * cumpri-la. Agendar menos que este horizonte é perder as espécies lentas —
   * elas chegariam sempre atrasadas ou não chegariam.
   */
  horizonte() {
    if (this._horizonte != null) return this._horizonte;
    const S = CONFIG.modes.siege;
    let maior = 0;
    for (const kind of Object.keys(S.weights)) {
      if (!S.weights[kind]) continue;
      maior = Math.max(maior, this.viagem(kind));
    }
    this._horizonte = maior;
    return maior;
  }

  /** Quanto tempo esta espécie leva da linha de árvores até o portão. */
  viagem(kind) {
    const S = CONFIG.modes.siege;
    const dist = S.spawnZ - GATE.standZ;
    return dist / Math.max(0.2, S.species[kind].speed);
  }

  /**
   * A COLUNA DE ABERTURA — a primeira horda, e a única que é uma horda.
   *
   * O modo não tem ondas (ver o cabeçalho), e continua não tendo: o que existe é
   * uma taxa contínua. Mas a taxa tem um começo, e o começo dela é um problema
   * que nenhuma curva resolve — a rampa demora uma travessia inteira para
   * encher, e durante essa travessia `gapBase` está no ponto mais frouxo que
   * terá em toda a partida. Somando as duas coisas, o primeiro minuto e meio
   * saía com meia dúzia de soldados espalhados em noventa metros: tempo de
   * sobra para matar todos e olhar a paisagem, num modo que se apresenta como
   * um cerco.
   *
   * A coluna é a resposta, e ela é SÓ SOLDADO de propósito. É a primeira coisa
   * que o jogador vê, e a primeira coisa que ele vê tem de ser a que ensina a
   * leitura básica da fase: um corpo de duas flechas subindo a rampa. Esqueleto,
   * escalador e xamã têm degrau próprio, e antecipá-los aqui gastaria os degraus
   * todos no primeiro minuto.
   *
   * O espaçamento dela é mais apertado que o de `gapBase`, e isso é a
   * dificuldade: eles chegam ao portão em bloco. O que torna a conta justa é que
   * a coluna atravessa os noventa metros À VISTA, do primeiro segundo em diante
   * — quem gastar a abertura atirando não vê fila nenhuma no portão; quem gastar
   * olhando a paisagem recebe a coluna inteira de uma vez.
   *
   * As chegadas dela ocupam o começo do acumulador, então o fluxo normal pega
   * exatamente onde a coluna termina: não há soma de duas pressões, há uma
   * abertura mais densa que afrouxa para a curva de sempre.
   */
  enfileirarAbertura() {
    const A = CONFIG.modes.siege.opening;
    if (!A?.count) return;
    const viagem = this.viagem(A.kind);
    /* A COLUNA TAMBÉM É DA GUARNIÇÃO, pela mesma conta de `gapAtual`: ela é o
       primeiro minuto e meio de pressão, e um primeiro minuto e meio calibrado
       para três arqueiros é uma sentença para um. O que NÃO muda é a contagem —
       dezoito continuam saindo do bosque, e é a contagem que faz a coluna ser
       uma coluna. O que muda é o passo dela, exatamente como no resto da curva:
       sozinho, a mesma coluna leva o dobro do tempo para desfilar. */
    const passo = A.gap * this.escalaDoRitmo();
    for (let i = 0; i < A.count; i++) {
      const chegada = this.abertura + i * passo;
      this.pendentes.push({ kind: A.kind, chegada, nascimento: chegada - viagem });
    }
    /* O acumulador salta para o fim da coluna. Sem isto o fluxo normal começaria
       a marcar chegadas POR CIMA das dela, e o portão receberia as duas coisas
       somadas — que é o dobro da pressão que a curva descreve. */
    this.ultimaChegada = this.abertura + (A.count - 1) * passo;
  }

  /* ------------------------------------------------------------ nascimento -- */

  /**
   * TODO MUNDO NASCE NA LINHA DE ÁRVORES, sem exceção.
   *
   * Havia um `atraso` aqui: quem estivesse "devendo" caminhada nascia adiantado
   * na rampa, no ponto em que estaria se tivesse saído a tempo. Era a solução
   * para os 85 s de rampa vazia da abertura, e ela custava a única coisa que a
   * fase promete o tempo todo — que eles VÊM DE ALGUM LUGAR. Do muro se via
   * gente surgindo no meio da ponte, às vezes a um passo do portão.
   *
   * Quem resolve a abertura agora é o piso de `agendar()`: a primeira chegada é
   * adiada até caber a caminhada, ninguém deve nada, e a partida abre com a
   * coluna saindo do bosque. Ver o comentário lá.
   */
  nascer(kind) {
    const S = CONFIG.modes.siege;
    if (this.lista.length >= S.maxEntities) return null;
    if (this.alive >= S.maxAlive) return null;

    let x = 0;
    let z = 0;
    for (let i = 0; i < 8; i++) {
      x = (Math.random() * 2 - 1) * S.spawnHalfX;
      z = S.spawnZ + (Math.random() * 2 - 1) * S.spawnZJitter;
      if (this.terrain.isWalkable(x, z)) break;
    }
    const b = new Besieger(kind, x, z, this.terrain);

    if (kind === "climber") {
      /* O escalador escolhe um trecho de muro LONGE do portão. Perto dele a
         subida acontece no meio da fila, onde já há flecha caindo por outro
         motivo — e o susto de ter alguém subindo atrás de você se perderia. */
      const lado = Math.random() < 0.5 ? -1 : 1;
      b.anchor = { x: lado * (6 + Math.random() * 9), z: CASTLE.wallZOut + 0.5 };
    } else if (kind === "shaman") {
      b.anchor = { x: (Math.random() * 2 - 1) * 11, z: GATE.standZ + S.shamanStandoff };
    } else if (kind === "catapult") {
      b.anchor = { x: (Math.random() * 2 - 1) * 14, z: GATE.standZ + S.catapultStandoff };
    }

    this.lista.push(b);
    return b;
  }

  /* ------------------------------------------------------ torres de mago -- */

  /**
   * Um mago no mirante.
   *
   * Ele é um XAMÃ — a mesma espécie, o mesmo código de rede, a mesma silhueta —
   * e essa é a decisão que faz a coisa caber em meia página em vez de num
   * sistema novo. O que muda é onde ele está e que ele não sai de lá: o quadro
   * binário já carrega `y`, então pôr um xamã doze metros no ar é escrever a
   * cota e mais nada. Nenhum bit novo, nenhuma espécie nova, nenhum caso
   * especial no cliente.
   *
   * `torre` é o que o distingue do xamã de chão: é ela que faz `atualizarUm`
   * mandá-lo para `atualizarMago` (que não anda) e é ela que diz a qual mirante
   * ele volta quando morre.
   */
  nascerMago(t) {
    const b = new Besieger("shaman", t.x, t.z, this.terrain);
    b.torre = t.id;
    /* UMA FLECHA, e não as três do xamã de chão.
     *
     * O alvo está a noventa metros, parado, em cima de um poste, e a recompensa
     * é meio minuto de torre calada. Três flechas a essa distância seriam três
     * ciclos inteiros de arco — quinze segundos de costas para o portão — por
     * uma coisa que volta. Com uma, calar a torre é uma DECISÃO que cabe entre
     * duas levas da fila, que é onde ela precisa caber. */
    b.maxHits = 1;
    b.y = t.platY + 0.32;
    b.fixoY = b.y;
    b.anchor = { x: t.x, z: t.z };
    b.yaw = Math.PI;
    this.lista.push(b);
    return b;
  }

  /** Mirante vazio conta o tempo; ao fim dele, sobe outro. */
  tickMagos(dt) {
    const S = CONFIG.modes.siege;
    const torres = mageTowers();
    for (const [i, t] of torres.entries()) {
      const vivo = this.lista.some((b) => b.torre === t.id && !b.dead);
      if (vivo) {
        this.magoEspera[i] = 0;
        continue;
      }
      /* A ESPERA é o prêmio de acertar. Sem ela o mago voltaria no quadro
         seguinte e a flecha gasta nele não teria comprado nada; com ela, calar
         uma torre é uma janela de trinta segundos em que se pode olhar só para
         o portão. É o mesmo desenho da tocha apagada do modo zumbi, ao
         contrário. */
      this.magoEspera[i] += dt;
      if (this.magoEspera[i] < S.mageRespawn) continue;
      this.magoEspera[i] = 0;
      this.nascerMago(t);
    }
  }

  /**
   * O mago do mirante: não anda, não recua, e atira uma bola que MATA.
   *
   * O xamã de chão dispara o mesmo `bolt` desde sempre e ele nunca fez dano
   * nenhum — o feixe saía, atravessava o defensor e sumia. Aqui a bola tem
   * consequência, e ela é agendada em vez de instantânea: a distância dividida
   * pela velocidade vira um prazo, e nesse prazo dá para SAIR DO LUGAR. É a
   * mesma escolha da pedra de catapulta, e pelo mesmo motivo — uma ameaça de
   * área se evita andando; um tiro teleguiado não se evita de jeito nenhum.
   */
  atualizarMago(b, dt, jogadores, agora, saida) {
    const S = CONFIG.modes.siege;
    const esp = S.species.shaman;
    b.y = b.fixoY;
    b.state = "cast";

    // Ele também remonta esqueleto, como qualquer xamã — só que de longe.
    for (const f of this.remontar(b)) saida.tiros.push(f);

    if (agora - b.lastAttack < S.mageInterval * 1000) return;

    const de = { x: b.x, y: b.y + 1.1, z: b.z };
    /* O MAIS PRÓXIMO, e não o primeiro da lista.
     *
     * `break` no primeiro com visada parecia equivalente e não era: a lista vem
     * de `Room.playerPositions`, que enfileira os humanos ANTES dos bots. Na
     * prática o mago mirava sempre a mesma pessoa e a guarnição de CPU, que
     * divide o mesmo adarve e corre exatamente o mesmo risco, nunca era
     * ameaçada. Pela distância, quem está exposto é quem paga. */
    let alvo = null;
    let melhorD = Infinity;
    for (const p of jogadores) {
      /* SÓ QUEM ESTÁ NO MURO. Do mirante se vê o pátio por cima do adarve, e
         um mago acertando quem repara o portão lá dentro seria uma morte vinda
         de um lugar que a vítima não tem como olhar. */
      if ((p.y ?? 0) < WALL_TOP - 3) continue;
      const para = { x: p.x, y: (p.y ?? 0) + 1.2, z: p.z };
      if (bloqueado(BLOCKERS, de, para)) continue;
      const d = Math.hypot(para.x - de.x, para.z - de.z);
      if (d >= melhorD) continue;
      melhorD = d;
      alvo = p;
    }
    if (!alvo) return;

    b.faceToward(alvo.x, alvo.z);
    b.lastAttack = agora;
    const para = { x: alvo.x, y: (alvo.y ?? 0) + 1.2, z: alvo.z };
    const voo = Math.hypot(para.x - de.x, para.y - de.y, para.z - de.z) / S.mageBolt.speed;
    const bid = proximoRaio++;
    saida.tiros.push({
      kind: "bolt",
      id: b.id,
      // A IDENTIDADE DA BOLA. Ela existe porque a bola virou uma coisa que se
      // pode ABATER, e abater exige poder apontar para qual delas — o id do
      // atirador não serve, porque ele dispara várias ao longo da partida.
      bid,
      from: [de.x, de.y, de.z],
      to: [para.x, para.y, para.z],
      speed: S.mageBolt.speed,
      target: alvo.id,
      // O cliente desenha esta bem maior e mais brilhante que a do xamã de
      // chão: ela é a única coisa que vem lá do fundo e mata.
      big: 1,
    });
    this.raiosPendentes.push({
      bid,
      at: agora + voo * 1000,
      x: para.x,
      y: para.y,
      z: para.z,
      alvo: alvo.id,
    });
  }

  /**
   * Uma flecha estourou a bola no ar.
   *
   * É a única ameaça deste modo que se DESFAZ depois de anunciada, e ela existe
   * porque a bola era a única sem resposta: dava para desviar dela, e mais
   * nada. Poder abatê-la transforma o mago numa disputa — a bola vem, o
   * defensor decide se sai da frente ou se gasta a flecha nela —, e é essa
   * escolha que justifica ela ser lenta e grande.
   *
   * @returns {object|null} o raio cancelado, ou null se ele já tinha caído
   */
  cancelarRaio(bid) {
    if (!this.raiosPendentes?.length) return null;
    const i = this.raiosPendentes.findIndex((r) => r.bid === bid);
    if (i < 0) return null;
    return this.raiosPendentes.splice(i, 1)[0];
  }

  /** Bolas de magia que venceram o prazo de voo. A sala aplica a morte. */
  colherRaios(agora) {
    if (!this.raiosPendentes?.length) return [];
    const prontos = this.raiosPendentes.filter((r) => agora >= r.at);
    if (prontos.length) {
      this.raiosPendentes = this.raiosPendentes.filter((r) => agora < r.at);
    }
    return prontos;
  }

  /* ---------------------------------------------------------------- passo -- */

  /**
   * Um passo do cerco.
   *
   * @param {number} dt segundos
   * @param {Array<{id,x,y,z,alive}>} jogadores quem está em campo
   * @param {number} agora relógio da sala (ms)
   * @returns {object} o que este passo produziu
   */
  update(dt, jogadores, agora) {
    const S = CONFIG.modes.siege;
    const saida = {
      ataques: [],
      tiros: [],
      impactos: [],
      mortos: [],
      tier: null,
      over: false,
      venceu: false,
      gateHit: 0,
    };
    if (!this.ativo || this.over) return saida;

    if (this.espera > 0) {
      this.espera = Math.max(0, this.espera - dt);
      return saida;
    }

    const antes = this.t;
    this.t += dt;

    /* --------------------------------------------------------- escalões --
       A ESTREIA SAI JUNTO COM A FAIXA. O sorteio já garante que ninguém nasce
       antes de ser anunciado (ver `sortearEspecie`); o que ele não garante é o
       contrário — que alguém nasça LOGO depois. Um escalador tem peso 1,4 num
       bolo de catorze, então a faixa podia subir e o primeiro exemplar demorar
       meio minuto a ser sorteado, que é a mesma promessa quebrada ao contrário.
       Um exemplar forçado no instante do anúncio fecha os dois lados: a trompa
       toca e há o que procurar na linha de árvores. */
    for (const [i, t] of S.tiers.entries()) {
      if (this.tiersOut.has(i) || this.t < t.at) continue;
      this.tiersOut.add(i);
      saida.tier = { i, nome: t.nome, kind: t.kind, at: t.at };
      if (t.kind === "ogre") this.nextOgre = this.t;
      else if (t.kind === "catapult") this.nextCatapult = this.t;
      // Ogro e catapulta já nascem pelo relógio próprio, logo abaixo.
      else if (S.weights[t.kind]) this.nascer(t.kind);
    }

    /* --------------------------------------------------------- chegadas --
       Duas coisas, e elas são independentes desde que a fila deixou de ter um
       lugar só (ver `agendar`): MARCAR chegadas até o horizonte, e FAZER NASCER
       quem já venceu a hora de sair do bosque.

       O `while` de cima é o que mantém a curva: numa maré cheia com quatro
       jogadores o intervalo cai abaixo do passo de 100 ms, e uma marcação por
       tique deixaria `gapBase` para trás. */
    let guarda = 0;
    while (this.ultimaChegada - this.horizonte() < this.t && guarda++ < 200) {
      this.agendar();
    }

    for (let i = this.pendentes.length - 1; i >= 0; i--) {
      const p = this.pendentes[i];
      if (this.t < p.nascimento) continue;
      this.pendentes.splice(i, 1);
      this.nascer(this.escolherNoNascimento(p.kind));
    }

    /* Ogro e catapulta, no relógio próprio deles. */
    if (this.t >= this.nextOgre) {
      this.nascer("ogre");
      this.nextOgre = this.t + S.ogreEvery;
    }
    if (this.t >= this.nextCatapult && this.contar("catapult") < S.catapultMax) {
      this.nascer("catapult");
      this.nextCatapult = this.t + S.catapultEvery;
    }

    /* ------------------------------------------------------------ vagas -- */
    this.atribuirVagas();

    /* ------------------------------------------------------------ bicho -- */
    const vivos = jogadores.filter((p) => p.alive !== false);
    for (const b of this.lista) {
      if (b.dead) {
        this.atualizarCaido(b, dt);
        continue;
      }
      this.atualizarUm(b, dt, vivos, agora, saida);
    }

    /* ------------------------------------------------------------- fogo -- */
    this.atualizarFogo(dt, saida);

    /* ------------------------------------------------------- as torres -- */
    this.tickMagos(dt);

    /* ---------------------------------------------------------- limpeza -- */
    /* O corpo some depois de `corpseLifetime` — MENOS o esqueleto que ainda
       vai se remontar, que precisa continuar existindo enquanto o relógio dele
       corre. Sem esta exceção o monte de ossos sumia da tela e o esqueleto
       reaparecia do nada alguns segundos depois. */
    const limite = S.corpseLifetime * 1000;
    this.lista = this.lista.filter(
      (b) => !b.dead || b.state === "bones" || agora - b.deadSince < limite,
    );

    /* ---------------------------------------------------------- portão -- */
    if (this.gateAlive && this.gateHp <= 0) {
      this.gateAlive = false;
      this.over = true;
      this.venceu = false;
      saida.over = true;
      return saida;
    }
    if (this.gateHp < this.gateMax * S.gateCriticalFrac) this.criticalTime += dt;

    /* ----------------------------------------------------- pôr do sol -- */
    if (!S.endless && antes < S.duration && this.t >= S.duration) {
      this.over = true;
      this.venceu = true;
      saida.over = true;
      saida.venceu = true;
    }

    return saida;
  }

  /**
   * Quem tem vaga na frente do portão.
   *
   * Cabem `gateSlots` de frente no vão de 6 m; o sétimo espera atrás. É o teto
   * que impede a morte instantânea por acúmulo — e é ele que produz o
   * aglomerado parado que dá ao trabuco um alvo. Sem isso, trinta esqueletos
   * empilhados no mesmo ponto derrubariam o portão em quatro segundos e o modo
   * não teria como ser jogado.
   *
   * A ordem é de CHEGADA (quem está mais perto), não de nascimento: quem
   * atravessou a rampa primeiro bate primeiro.
   */
  atribuirVagas() {
    const S = CONFIG.modes.siege;
    const candidatos = [];
    for (const b of this.lista) {
      if (b.dead || b.kind === "climber" || b.kind === "shaman" || b.kind === "catapult") {
        b.slot = -1;
        continue;
      }
      const d = Math.hypot(b.x - GATE.x, b.z - GATE.standZ);
      /* VINTE E DOIS METROS, e não catorze.
       *
       * Quem está fora do raio não recebe posição na fila, e sem posição
       * `postoDeEspera` manda para a boca do portão — ou seja, todos eles
       * andam para o MESMO ponto, um atrás do outro. Era essa a coluna que se
       * via descendo a rampa: não era a fila, era quem ainda não tinha entrado
       * nela.
       *
       * A 22 m o leque começa a se abrir enquanto eles ainda estão chegando, e
       * o que se forma na frente do portão é uma massa larga em vez de um fio.
       * O custo é nulo — o laço já percorre a lista inteira. */
      if (d > 22) {
        b.slot = -1;
        b.queue = null;
        continue;
      }
      candidatos.push([d, b]);
    }
    candidatos.sort((a, c) => a[0] - c[0]);
    for (const [i, [, b]] of candidatos.entries()) {
      b.slot = i < S.gateSlots ? i : -1;
      b.queue = i;
    }
  }

  /**
   * O esqueleto DESMONTA, e depois se remonta.
   *
   * A primeira morte não é morte: os ossos caem, ficam no chão por
   * `skeletonRise` segundos e voltam a se juntar. A segunda é definitiva.
   *
   * Isso muda o que o jogador faz com o modo. Um esqueleto no chão não é um
   * abate — é um relógio, e a pergunta passa a ser se vale gastar a segunda
   * flecha AGORA ou deixar para quando ele levantar, com a fila crescendo no
   * portão enquanto se decide. É a mesma economia de atenção que a fila cobra,
   * numa escala menor.
   *
   * E o FOGO cancela a remontagem: um esqueleto queimado não volta. É o que
   * dá ao trabuco um papel que a flecha não tem, muito antes de o volume
   * exigir o trabuco por si só.
   */
  atualizarCaido(b, dt) {
    const S = CONFIG.modes.siege;
    if (b.kind !== "skeleton" || b.risen || b.burning) return;
    b.state = "bones";
    b.riseIn = (b.riseIn ?? S.skeletonRise) - dt;
    if (b.riseIn > 0) return;
    b.dead = false;
    b.risen = true;
    b.hits = 0;
    b.state = "rise";
    b.riseIn = null;
  }

  atualizarUm(b, dt, jogadores, agora, saida) {
    const S = CONFIG.modes.siege;
    const vizinhos = this.vizinhosDe(b);

    /* Parado até prova em contrário: `step` reescreve isto quando o passo dá
       certo. Zerar aqui, num lugar só, cobre de uma vez todos os caminhos que
       terminam sem andar — bater no portão, escalar, conjurar, ou tentar os
       sete desvios e não passar por nenhum. */
    b.parar();

    /* Queimando: o piche cobra por segundo e não perdoa esqueleto. */
    if (b.fire > 0) {
      b.fire -= dt;
      b.burning = true;
      b.hits += S.trebuchet.fireDps * dt;
      if (b.hits >= b.maxHits) {
        this.matar(b, null, agora, saida);
        return;
      }
    } else {
      b.burning = false;
    }

    // O mago do mirante vem antes do xamã: ele É um xamã, e o que o separa é
    // a torre. Ver `nascerMago`.
    if (b.torre != null) {
      this.atualizarMago(b, dt, jogadores, agora, saida);
      return;
    }

    switch (b.kind) {
      case "climber":
        this.atualizarEscalador(b, dt, jogadores, agora, saida, vizinhos);
        return;
      case "shaman":
        this.atualizarDistancia(b, dt, jogadores, agora, saida, vizinhos, "cast");
        return;
      case "catapult":
        this.atualizarDistancia(b, dt, jogadores, agora, saida, vizinhos, "cast");
        return;
      default:
        this.atualizarPortao(b, dt, agora, saida, vizinhos);
    }
  }

  /**
   * O MASTIM CORRE EM ZIGUEZAGUE.
   *
   * Ele já era o quebra-ritmo — chega sessenta segundos antes do pelotão dele —
   * mas em linha reta um alvo rápido é só um alvo rápido: o jogador aprende a
   * antecipação em três tiros e ele vira um soldado apressado. Serpenteando, a
   * antecipação deixa de ser uma constante e passa a ser uma leitura, que é o
   * que faz dele um problema DIFERENTE e não um problema maior.
   *
   * O período é por indivíduo, senão a matilha inteira ondula em fase e vira
   * uma cobra só.
   */
  desvioDoMastim(b, dt) {
    b.zigFase = (b.zigFase ?? Math.random() * TAU) + dt * (b.zigRitmo ??= 2.2 + Math.random() * 1.6);
    return Math.sin(b.zigFase) * 5.5;
  }

  /** Soldado, pavês, esqueleto, ogro e mastim: o portão é o alvo. */
  atualizarPortao(b, dt, agora, saida, vizinhos) {
    const S = CONFIG.modes.siege;
    const esp = S.species[b.kind];

    if (b.slot >= 0) {
      /* Ter vaga é ter DIREITO de bater, não estar batendo.
       *
       * A distinção não é preciosismo: `atribuirVagas` considera candidato
       * quem está a até 14 m, e sem a checagem de contato abaixo o sujeito
       * começava a arrancar tábua a treze metros do portão. O sintoma era o
       * portão perdendo 18 de vida por segundo aos dez segundos de partida,
       * com a fila ainda subindo a rampa — dano vindo de ninguém. */
      const posto = this.postoDaVaga(b.slot);
      const d = Math.hypot(b.x - posto.x, b.z - posto.z);
      if (d > 1.2) {
        b.state = "walk";
        b.walkToward(posto.x, posto.z, dt, this.gateAlive, vizinhos);
        return;
      }
      this.aproximar(b, posto.x, posto.z, dt, vizinhos);
      b.faceToward(GATE.x, GATE.z);
      b.state = "attack";
      if (agora - b.lastAttack < esp.interval * 1000) return;
      b.lastAttack = agora;
      this.gateHp = Math.max(0, this.gateHp - esp.damage);
      saida.gateHit += esp.damage;
      saida.ataques.push({ kind: b.kind, x: b.x, z: b.z, damage: esp.damage });
      return;
    }

    b.state = "walk";
    const espera = this.postoDeEspera(b.queue);
    const desvio = b.kind === "hound" ? this.desvioDoMastim(b, dt) : 0;
    b.walkToward(espera.x + desvio, espera.z, dt, this.gateAlive, vizinhos);
  }

  /**
   * ONDE CADA UM DOS QUE BATEM FICA — em DUAS FILEIRAS, não numa.
   *
   * O vão tem 6 m e a primeira versão punha os seis atacantes lado a lado numa
   * linha só, a 1,05 m de distância. Do muro, o que se via era isto: meia dúzia
   * encostada na porta e o resto da horda esperando em COLUNA, um atrás do
   * outro, uma fila indiana de trinta bichos descendo a rampa. Não parecia um
   * cerco; parecia uma bilheteria.
   *
   * Agora são cinco de frente e cinco imediatamente atrás, encaixados nos vãos
   * da primeira fileira (o `+0,62` de deslocamento). A segunda fileira alcança
   * a madeira por cima do ombro da primeira — é o que uma turba fazendo aríete
   * com o corpo faz de verdade —, e o número de gente batendo ao mesmo tempo
   * dobrou sem que a porta ficasse mais larga.
   */
  postoDaVaga(slot) {
    const S = CONFIG.modes.siege;
    const porFileira = S.gatePerRank;
    const fila = Math.floor(slot / porFileira);
    const col = slot % porFileira;
    return {
      x: GATE.x + (col - (porFileira - 1) / 2) * 1.2 + (fila % 2 ? 0.6 : 0),
      z: GATE.standZ + fila * 1.15,
    };
  }

  /**
   * ONDE ESPERA QUEM NÃO TEM VAGA — num LEQUE, não numa fila.
   *
   * Era `standZ + 1,6 + (posição − vagas) × 0,7`: um ponto por sujeito, todos
   * no mesmo x, recuando em linha reta. Vinte deles davam catorze metros de
   * coluna — a fila indiana da imagem.
   *
   * Em arcos concêntricos eles se AGLOMERAM: cada anel cabe mais gente que o
   * anterior e se abre em torno da boca do portão, então a massa cresce em
   * largura antes de crescer em profundidade. É a diferença entre "eles estão
   * na fila" e "eles estão em cima da porta" — e, do ponto de vista do jogo, é
   * o que dá ao trabuco um alvo que vale a pedra.
   */
  postoDeEspera(queue) {
    const S = CONFIG.modes.siege;
    if (queue == null || queue < S.gateSlots) return { x: GATE.x, z: GATE.standZ };
    const fora = queue - S.gateSlots;

    /* Anéis de largura crescente: 7, 9, 11… Um anel de largura fixa voltaria a
       empilhar em profundidade assim que enchesse. */
    let anel = 0;
    let base = 0;
    let largura = S.gateRingFirst;
    while (fora >= base + largura) {
      base += largura;
      anel++;
      largura += 2;
    }
    const i = fora - base;
    const t = largura > 1 ? (i / (largura - 1)) * 2 - 1 : 0; // −1 … +1
    const raio = 2.6 + anel * 1.6;
    const ang = t * S.gateSpread;
    return {
      x: GATE.x + Math.sin(ang) * raio,
      z: GATE.standZ + Math.cos(ang) * raio,
    };
  }

  /** Anda os últimos centímetros sem o leque de desvios (já está no lugar). */
  aproximar(b, tx, tz, dt, vizinhos) {
    const d = Math.hypot(tx - b.x, tz - b.z);
    if (d < 0.12) return;
    b.walkToward(tx, tz, dt * 0.6, this.gateAlive, vizinhos);
  }

  /** O escalador: sobe o muro e vira problema de quem está no adarve. */
  atualizarEscalador(b, dt, jogadores, agora, saida, vizinhos) {
    const S = CONFIG.modes.siege;

    if (b.climb <= 0) {
      const d = Math.hypot(b.x - b.anchor.x, b.z - b.anchor.z);
      if (d > 0.8) {
        b.state = "walk";
        b.walkToward(b.anchor.x, b.anchor.z, dt, this.gateAlive, vizinhos);
        return;
      }
      b.climb = 0.001;
    }

    if (b.climb < 1) {
      b.state = "climb";
      b.climb = Math.min(1, b.climb + dt / S.climbTime);
      b.x = b.anchor.x;
      b.z = b.anchor.z;
      b.y = GROUND_Y + (WALL_TOP - GROUND_Y) * b.climb;
      b.yaw = Math.PI;
      return;
    }

    /* NO ADARVE ELE CAÇA.
     *
     * Ele ficava parado no ponto em que subiu, golpeando só quem passasse a um
     * metro e meio dele — e a justificativa era que um escalador patrulhando
     * viraria um duelo dentro de um modo que já tem uma coisa acontecendo.
     * Na prática deu o contrário do que a espécie existe para dar: ele subia,
     * chegava ao topo e virava estátua. Quem estava a cinco metros continuava
     * atirando na rampa de costas para ele, sem custo nenhum, e a única coisa
     * capaz de fazer o jogador olhar para trás não fazia mais ninguém olhar
     * para lugar nenhum.
     *
     * Caçando, ele volta a ser o que a ficha dele diz: o inimigo que obriga a
     * largar a mira do portão. Não é um duelo — ele não desvia, não recua e
     * morre com duas flechas —, é um relógio andando na sua direção. E vale
     * para os arqueiros de CPU também, que estão no mesmo adarve pelo mesmo
     * motivo. */
    b.y = WALL_TOP;
    const esp = S.species.climber;
    let alvo = null;
    let melhor = Infinity;
    for (const p of jogadores) {
      /* Só quem está NO MURO. O pátio fica onze metros abaixo, e um escalador
         mirando alguém que está reparando o portão lá embaixo andaria até a
         beirada e ficaria olhando para o vazio. */
      if (Math.abs((p.y ?? 0) - b.y) > 3.5) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < melhor) {
        melhor = d;
        alvo = p;
      }
    }
    if (!alvo) {
      // Ninguém no adarve: ele fica de guarda onde subiu, como antes.
      b.state = "attack";
      return;
    }
    if (melhor > S.climbReach) {
      b.state = "walk";
      this.andarNoAdarve(b, alvo.x, alvo.z, dt);
      return;
    }
    b.faceToward(alvo.x, alvo.z);
    b.state = "attack";
    if (agora - b.lastAttack < esp.interval * 1000) return;
    b.lastAttack = agora;
    saida.ataques.push({ kind: "climber", playerId: alvo.id, x: b.x, z: b.z });
  }

  /**
   * Um passo do escalador SOBRE o muro.
   *
   * Não passa por `Besieger.step`, e não pode passar: aquele recusa qualquer
   * ponto dentro de `insideFootprint`, e o adarve é o topo da alvenaria — ou
   * seja, o passo seria recusado sempre. Aqui a restrição é outra: ele anda
   * livre no plano e fica PRESO À FAIXA do adarve, que é o retângulo entre as
   * duas faces do muro mais a hourd. Sem a coleira ele sairia andando no ar
   * atrás de alguém que pulou.
   *
   * A cota é fixa em `WALL_TOP`: os bastiões estão na mesma, então andar até
   * eles não pede nada além de deixar o x correr.
   */
  andarNoAdarve(b, tx, tz, dt) {
    const passo = CONFIG.modes.siege.species.climber.speed * dt;
    let dx = tx - b.x;
    let dz = tz - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    dx /= d;
    dz /= d;
    /* A faixa útil: da face interna do muro à borda da hourd, e de um bastião
       ao outro. As folgas de meio metro impedem o corpo de ficar meio fora. */
    const limiteX = CASTLE.towerX + CASTLE.towerHalf - 0.6;
    const zMin = CASTLE.courtZFront + 0.6;
    const zMax = CASTLE.wallZOut + CASTLE.hoardOut - 0.5;
    b.x = clamp(b.x + dx * passo, -limiteX, limiteX);
    b.z = clamp(b.z + dz * passo, zMin, zMax);
    b.y = WALL_TOP;
    b.yaw = Math.atan2(tx - b.x, tz - b.z);
  }

  /**
   * Xamã e catapulta: param longe e atiram.
   *
   * A visada passa por `bloqueado()` contra os merlões — a mesma chamada que
   * `botSim.js` já faz. É a cobertura do modo, e ela não custou um sistema:
   * custou a lista de caixas que `castleProps` já precisava ter.
   */
  atualizarDistancia(b, dt, jogadores, agora, saida, vizinhos, estado) {
    const S = CONFIG.modes.siege;
    const esp = S.species[b.kind];

    const d = Math.hypot(b.x - b.anchor.x, b.z - b.anchor.z);
    if (d > 1.0) {
      b.state = "walk";
      b.walkToward(b.anchor.x, b.anchor.z, dt, this.gateAlive, vizinhos);
      return;
    }
    b.state = estado;
    b.faceToward(GATE.x, GATE.z);

    if (b.kind === "shaman") {
      for (const f of this.remontar(b)) saida.tiros.push(f);
    }

    if (agora - b.lastAttack < esp.interval * 1000) return;

    const de = { x: b.x, y: b.chestY, z: b.z };
    /* O MAIS PRÓXIMO, e não o primeiro da lista com visada.
     *
     * `break` no primeiro parecia equivalente e não era: `Room.playerPositions`
     * enfileira os humanos ANTES dos bots, então o xamã de chão mirava sempre a
     * mesma pessoa e a guarnição de CPU — que divide o mesmo adarve e corre
     * exatamente o mesmo risco — nunca era ameaçada. É o mesmo defeito que o
     * mago do mirante já tinha corrigido; ver `atualizarMago`. */
    let alvo = null;
    let melhorD = Infinity;
    for (const p of jogadores) {
      if (p.alive === false) continue;
      const para = { x: p.x, y: (p.y ?? 0) + 1.2, z: p.z };
      if (bloqueado(BLOCKERS, de, para)) continue;
      const d = Math.hypot(para.x - de.x, para.z - de.z);
      if (d >= melhorD) continue;
      melhorD = d;
      alvo = p;
    }
    if (!alvo) return;

    b.lastAttack = agora;
    if (b.kind === "shaman") {
      const para = { x: alvo.x, y: (alvo.y ?? 0) + 1.2, z: alvo.z };
      const voo =
        Math.hypot(para.x - de.x, para.y - de.y, para.z - de.z) / S.shamanBolt.speed;
      const bid = proximoRaio++;
      saida.tiros.push({
        kind: "bolt",
        id: b.id,
        bid,
        from: [de.x, de.y, de.z],
        to: [para.x, para.y, para.z],
        speed: S.shamanBolt.speed,
        target: alvo.id,
        /* GRANDE como a do mirante. Ela nasce a setenta metros do adarve, ou
           seja, na mesma faixa em que a do mago já tinha provado que 16 cm de
           raio somem na tela — e agora que ela MATA e que dá para abatê-la, ser
           vista deixou de ser conforto e virou a regra do golpe. */
        big: 1,
      });
      /* A BOLA DO XAMÃ DE CHÃO PASSOU A TER CONSEQUÊNCIA.
       *
       * Ela saía do cajado, cruzava a rampa, atravessava o defensor e sumia:
       * a espécie de maior valor da horda — a que remonta esqueleto e a que o
       * jogador precisa decidir caçar — não cobrava nada por ser ignorada. Era
       * ameaça de mentira, e o jogador aprende isso em duas partidas.
       *
       * Entra pela MESMA fila do mago do mirante (`raiosPendentes`), o que dá
       * três coisas de graça e sem uma linha nova de sala: o dano é do PONTO
       * onde a bola cai e não da pessoa mirada, ele só é aplicado quando o voo
       * termina — ou seja, quem viu a bola sair e saiu do lugar escapa — e ele
       * alcança jogadores E bots, porque quem colhe a fila varre
       * `allCharacters()`. Ver `Room.tickSiege`. */
      this.raiosPendentes.push({
        bid,
        at: agora + voo * 1000,
        x: para.x,
        y: para.y,
        z: para.z,
        alvo: alvo.id,
      });
    } else {
      /* A catapulta atira num PONTO, com erro, e não numa pessoa. É a
         diferença entre uma ameaça de área — que se evita saindo do lugar — e
         um tiro teleguiado, que não se evita de jeito nenhum. */
      const ex = alvo.x + (Math.random() * 2 - 1) * S.catapultSpread;
      const ez = (alvo.z ?? WALL_ZC) + (Math.random() * 2 - 1) * S.catapultSpread;
      saida.tiros.push({
        kind: "rock",
        id: b.id,
        from: [de.x, de.y, de.z],
        to: [ex, WALL_TOP, ez],
        flight: 2.4,
      });
      this.impactosPendentes ??= [];
      this.impactosPendentes.push({ at: agora + 2400, x: ex, y: WALL_TOP, z: ez });
    }
  }

  /**
   * O xamã levanta esqueleto caído num raio — e o feixe é VISÍVEL.
   *
   * O que ele faz é a coisa mais consequente da rampa e era a mais invisível:
   * esqueletos voltavam a ficar de pé e nada na tela dizia por quê. Com o
   * feixe, quem está no muro vê a linha verde sair do cajado e entender, sem
   * uma linha de texto, que a resposta é matar o sujeito no fim dela.
   *
   * @returns {Array} os feixes desta remontagem, para a sala transmitir
   */
  remontar(b) {
    const S = CONFIG.modes.siege;
    const feixes = [];
    for (const o of this.lista) {
      if (!o.dead || o.kind !== "skeleton" || o.burning) continue;
      if (Math.hypot(o.x - b.x, o.z - b.z) > S.shamanRaiseRadius) continue;
      if (o.riseIn != null && o.riseIn <= 0.7) continue; // já está voltando
      o.risen = false; // o xamã devolve a remontagem que o esqueleto já gastou
      o.riseIn = 0.6;
      feixes.push({
        kind: "raise",
        from: [b.x, b.chestY + 0.9, b.z],
        to: [o.x, o.y + 0.4, o.z],
        speed: 26,
      });
    }
    return feixes;
  }

  vizinhosDe(b) {
    /* Sem grade espacial: a `lista` inteira, filtrada por caixa. Com 120 bichos
       são 14 400 pares por tique a 10 Hz — medido em ~1,1 ms, o que cabe. Se um
       dia não couber, a grade do `zombieSim` (NPC_GRID_CELL) é o caminho e não
       muda mais nada aqui. */
    const out = [];
    for (const o of this.lista) {
      if (o === b || o.dead) continue;
      if (Math.abs(o.x - b.x) > 2 || Math.abs(o.z - b.z) > 2) continue;
      out.push(o);
    }
    return out;
  }

  /* -------------------------------------------------------------- fogo ---- */

  /** O piche do trabuco: uma poça que queima e que não perdoa esqueleto. */
  acenderFogo(x, z, dono) {
    const T = CONFIG.modes.siege.trebuchet;
    this.fogos.push({
      x,
      z,
      r: T.fireRadius,
      restante: T.fireTime,
      owner: dono,
    });
  }

  atualizarFogo(dt, saida) {
    if (!this.fogos.length) return;
    for (const f of this.fogos) f.restante -= dt;
    for (const b of this.lista) {
      if (b.dead) continue;
      for (const f of this.fogos) {
        if (f.restante <= 0) continue;
        if (Math.hypot(b.x - f.x, b.z - f.z) > f.r) continue;
        b.fire = Math.max(b.fire, 0.9);
        b.fireOwner = f.owner;
        break;
      }
    }
    this.fogos = this.fogos.filter((f) => f.restante > 0);
  }

  /* ------------------------------------------------------------ acertos ---- */

  /**
   * Alguém acertou um sitiante.
   *
   * Quem atira continua sendo a autoridade sobre o PRÓPRIO acerto — é o mesmo
   * contrato da flecha em todo o resto do jogo. O que a sala decide é o que é
   * compartilhado: se ele caiu, quanto vale, e se o escudo aparou.
   *
   * @param {number} id
   * @param {object} opts `{ head, from: {x,y,z}, kame }`
   */
  hit(id, opts = {}) {
    const b = this.lista.find((o) => o.id === id && !o.dead);
    if (!b) return null;

    /* O PAVÊS NÃO É DECIDIDO AQUI.
     *
     * Ele era: "veio de frente e com pouca elevação ⇒ aparou". A conta acerta
     * na média e mente no caso — aparava tiro que passava pela cabeça e deixava
     * passar tiro que batia na tábua. Hoje o escudo é um COLISOR do tamanho
     * exato do escudo (ver `entities/besieger.js`), e a flecha que bate nele
     * simplesmente nunca chega a esta função: o cliente não manda `SIEGE_HIT`.
     *
     * É a mesma disciplina do resto do jogo: quem decide o acerto é o solver de
     * contato, não uma regra escrita à parte. */

    /* CABEÇA MATA DE PRIMEIRA.
     *
     * Vale para tudo o que tem cabeça e não é o ogro. O ogro é o único em que
     * ela não encerra a luta — ele pede quatro, e mesmo assim é a diferença
     * entre dezesseis flechas e quatro: continua sendo o maior prêmio de mira
     * do modo, sem apagar num tiro o único inimigo que deveria dar trabalho. */
    if (opts.head && !opts.kame) {
      if (b.kind === "ogre") {
        b.hits += b.maxHits / 4;
        return b.hits >= b.maxHits
          ? { killed: true, b, head: true }
          : { hurt: true, b, frac: 1 - b.hits / b.maxHits, head: true };
      }
      b.hits = b.maxHits;
      return { killed: true, b, head: true };
    }

    const antes = b.hits;
    b.hits += opts.kame ? b.maxHits : 1;
    if (b.hits < b.maxHits) {
      /* O OGRO ENFURECE na metade da vida, e uma vez só.
       *
       * Sem isso ele é um saco de pancadas que anda: dezesseis flechas contra
       * uma coisa que faz sempre a mesma coisa, e o jogador simplesmente
       * espera. Enfurecido ele acelera 60 % e bate mais rápido — o que
       * transforma "quantas flechas faltam" em "dá tempo?", que é uma pergunta
       * muito melhor. E o rugido avisa: quem estava mirando noutra coisa tem um
       * segundo para mudar de ideia. */
      if (b.kind === "ogre" && !b.furioso && b.hits >= b.maxHits / 2) {
        b.furioso = true;
        b.speed *= 1.6;
        return {
          hurt: true,
          b,
          frac: 1 - b.hits / b.maxHits,
          enfureceu: true,
          first: antes === 0,
        };
      }
      return { hurt: true, b, frac: 1 - b.hits / b.maxHits, first: antes === 0 };
    }
    return { killed: true, b };
  }

  matar(b, killer, agora, saida) {
    if (b.dead) return;
    b.dead = true;
    b.deadSince = agora;
    b.slot = -1;
    b.state = "down";
    b.riseIn = CONFIG.modes.siege.skeletonRise;
    saida?.mortos.push({ id: b.id, kind: b.kind, killer });
  }

  /** Pontos que a espécie vale. */
  pontos(kind) {
    return CONFIG.modes.siege.species[kind]?.points ?? 20;
  }

  /* -------------------------------------------------------------- portão --- */

  /**
   * Reparo, com os dois limites que o tornam um remendo.
   *
   * Vence dois soldados (10/s) e perde para três (15/s), e não passa de 80 %.
   * Se ele fechasse a conta sozinho, o modo teria uma dominante — alguém de
   * plantão no portão para sempre — e dominante é o que mata modo.
   */
  repair(dt, quantos = 1) {
    const S = CONFIG.modes.siege;
    if (!this.gateAlive || quantos <= 0) return 0;
    const teto = this.gateMax * S.repairCap;
    if (this.gateHp >= teto) return 0;
    const antes = this.gateHp;
    this.gateHp = Math.min(teto, this.gateHp + S.repairRate * dt * quantos);
    return this.gateHp - antes;
  }

  /** A pedra do trabuco caiu aqui. Devolve quem morreu. */
  blast(x, z, dono) {
    const T = CONFIG.modes.siege.trebuchet;
    const mortos = [];
    const feridos = [];
    for (const b of this.lista) {
      if (b.dead) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d > T.blastRadius) continue;
      // Cai com a distância: no centro mata quase tudo, na borda machuca.
      const dano = T.blastDamage * (1 - (d / T.blastRadius) * 0.7);
      b.hits += dano;
      if (b.hits >= b.maxHits) mortos.push(b);
      else feridos.push(b);
    }
    this.acenderFogo(x, z, dono);

    /* Uma pedra curta acerta o PRÓPRIO portão. Não é punição arbitrária: com
       ângulo fixo de 45° o alcance mínimo é 33 m, e para acertá-lo é preciso
       errar de propósito, para trás. */
    let gate = 0;
    if (this.gateAlive && Math.abs(x - GATE.x) < 5 && Math.abs(z - GATE.standZ) < 5) {
      gate = T.gateDamage;
      this.gateHp = Math.max(0, this.gateHp - gate);
    }
    return { mortos, feridos, gate };
  }

  /**
   * O feixe do especial bateu no chão aqui.
   *
   * Irmã de `blast` (a pedra de trabuco) e diferente dela de propósito: a pedra
   * cai com o dano decrescendo até a borda, porque o que ela entrega é uma
   * ONDA. O feixe entrega uma esfera de energia — dentro dela não há gradiente,
   * há dentro e fora.
   *
   * As duas faixas: soldado, esqueleto, mastim, escalador e pavês morrem de
   * primeira (todos pedem de uma a três flechas); ogro e catapulta levam o
   * equivalente a quatro. Ver `CONFIG.special.groundBlast`.
   *
   * @returns {{mortos:Array, feridos:Array}}
   */
  kameBlast(x, z, raio) {
    const G = CONFIG.special.groundBlast;
    const mortos = [];
    const feridos = [];
    for (const b of this.lista) {
      if (b.dead) continue;
      if (Math.hypot(b.x - x, b.z - z) > raio) continue;

      if (b.maxHits <= G.smallArrows) {
        b.hits = b.maxHits;
        mortos.push(b);
        continue;
      }
      b.hits += G.bigHits;
      if (b.hits >= b.maxHits) mortos.push(b);
      else feridos.push(b);
    }
    return { mortos, feridos };
  }

  /* --------------------------------------------------------------- rede ---- */

  /**
   * O estado da partida — o que vira HUD.
   *
   * Barato e enviado a 2 Hz. As poses vão pelo quadro binário (`packFrame`),
   * que é outro relógio e outro caminho.
   */
  status() {
    const S = CONFIG.modes.siege;
    return {
      gate: this.gateMax > 0 ? this.gateHp / this.gateMax : 0,
      gateAlive: this.gateAlive,
      fila: this.fila,
      alive: this.alive,
      pressao: Math.round(this.pressao * 100) / 100,
      /* `w`, de *when*, e NUNCA `t`.
       *
       * `t` é o tipo da mensagem em todo o protocolo, e `broadcastSiegeStatus`
       * espalha este objeto por cima de `{ t: S2C.SIEGE_STATUS }`. Com o nome
       * errado o tempo de partida vira o tipo: a sala passa a mandar
       * `{ t: 20 }`, o cliente não acha rota para isso e simplesmente não
       * acontece nada — sem erro, sem log, sem HUD. É o defeito que o
       * cabeçalho de `shared/protocol.js` descreve, e ele apareceu aqui na
       * primeira execução de ponta a ponta. */
      w: Math.round(this.t),
      restante: Math.max(0, Math.round(S.duration - this.t)),
      espera: Math.ceil(this.espera),
      over: this.over,
      venceu: this.venceu,
      critical: Math.round(this.criticalTime),
      /* O NÍVEL VIAJA COM O ESTADO, e não numa mensagem própria — mesma decisão
         do `METEOR_STATUS`, pelas mesmas duas razões: ele muda uma vez por
         partida, junto com o começo do cerco (que é quando este pacote já sai),
         e assim quem chega no meio o recebe de graça pelo `snapshot`. */
      difficulty: this.dificuldade,
    };
  }

  /**
   * As poses, em JSON.
   *
   * Existe para o SNAPSHOT de quem entra no meio e para depuração — o fluxo de
   * 10 Hz usa `packFrame`. Ver o comentário lá para a conta que justifica os
   * dois caminhos.
   */
  view() {
    return this.lista.map((b) => ({
      id: b.id,
      p: [round(b.x), round(b.y), round(b.z)],
      y: round(b.yaw),
      k: KINDS.indexOf(b.kind),
      s: STATES.indexOf(b.state),
      d: b.dead ? 1 : 0,
      f: b.burning ? 1 : 0,
      h: b.maxHits > 0 ? Math.round((1 - b.hits / b.maxHits) * 15) : 15,
    }));
  }

  /**
   * O quadro binário — a razão de o modo caber na rede.
   *
   * `view()` em JSON dá ~80 B por bicho. A 10 Hz, com 120 vivos e 4 clientes,
   * são **380 KB/s de subida**, que não vai. Aqui são **10 B por bicho**:
   *
   *   id      uint16   (2 B)
   *   x,y,z   int16    (6 B)  ×100 → 1,2 cm de resolução, ±327 m
   *   yaw     uint8    (1 B)  1,4° de resolução
   *   flags   uint8    (1 B)  espécie (3 bits) | estado (3) | morto | fogo
   *
   * 120 vivos = 1,3 KB por quadro, 13 KB/s por cliente. Cabe com folga.
   *
   * A VIDA (`hp`) ENTRA, e ela custa o décimo primeiro byte.
   *
   * Este comentário dizia o contrário, e com um argumento correto: um campo por
   * bicho para uma informação que 119 deles não usam é gordura. O que mudou foi
   * a informação deixar de ser inútil para os 119 — o ogro ganhou barra de
   * vida, e barra de vida só existe se a vida chegar aqui. Alternativas
   * pesadas foram descartadas: mandar só o ogro por um canal à parte precisaria
   * de um segundo caminho de rede e de conciliar duas fontes de pose para o
   * mesmo bicho.
   *
   * O preço medido é 10 %: 1,2 KB por quadro viraram 1,32 KB. Em troca, QUALQUER
   * espécie pode ganhar barra sem tocar no formato outra vez — e é o cliente,
   * sozinho, que decide quais merecem uma (ver `BesiegerMesh.setHealth`).
   */
  packFrame() {
    const n = this.lista.length;
    const buf = new ArrayBuffer(4 + n * 11);
    const dv = new DataView(buf);
    /* Byte 0 é o TIPO do quadro (`FRAME.SIEGE`). Um quadro binário não tem
       campo `t` como as mensagens de texto — um campo de texto no cabeçalho
       custaria mais que meio sitiante. */
    dv.setUint8(0, FRAME.SIEGE);
    dv.setUint8(1, 0); // reservado: versão do formato
    dv.setUint16(2, n, true);
    let o = 4;
    for (const b of this.lista) {
      dv.setUint16(o, b.id & 0xffff, true);
      dv.setInt16(o + 2, clamp(Math.round(b.x * 100), -32768, 32767), true);
      dv.setInt16(o + 4, clamp(Math.round(b.y * 100), -32768, 32767), true);
      dv.setInt16(o + 6, clamp(Math.round(b.z * 100), -32768, 32767), true);
      dv.setUint8(o + 8, Math.round(((b.yaw % TAU) + TAU) % TAU / TAU * 255) & 0xff);
      const k = KINDS.indexOf(b.kind) & 0x07;
      const s = STATES.indexOf(b.state) & 0x07;
      dv.setUint8(o + 9, k | (s << 3) | (b.dead ? 0x40 : 0) | (b.burning ? 0x80 : 0));
      // Vida em 0–255. Um byte dá 0,4 % de resolução numa barra de 200 px —
      // muito além do que o olho lê, e é o menor campo que existe.
      const vivo = b.maxHits > 0 ? 1 - b.hits / b.maxHits : 1;
      dv.setUint8(o + 10, clamp(Math.round(vivo * 255), 0, 255));
      o += 11;
    }
    return Buffer.from(buf);
  }

  /** Impactos de catapulta que venceram o prazo. A sala aplica o dano. */
  colherImpactos(agora) {
    if (!this.impactosPendentes?.length) return [];
    const prontos = this.impactosPendentes.filter((i) => agora >= i.at);
    if (prontos.length) {
      this.impactosPendentes = this.impactosPendentes.filter((i) => agora < i.at);
    }
    return prontos;
  }
}

function round(v) {
  return Math.round(v * 100) / 100;
}
