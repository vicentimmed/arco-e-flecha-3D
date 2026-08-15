/* ---------------------------------------------------------------------------
   Os lutadores de CPU de Namekusei.

   Mesma decisão de `server/botSim.js`, pela mesma razão e com a mesma
   consequência: o bot é **um jogador da sala que não tem socket**. Ele nasce do
   contador de ids dos humanos, viaja no mesmo `STATES`, aparece no mesmo placar
   e morre pelo mesmo `DEATH`. Nenhuma linha de cliente precisa saber que o
   sujeito do outro lado da bola de ki não era gente.

   ------------------------------------------------------------ o que muda aqui

   O arqueiro tem chão, gravidade e uma flecha que descreve parábola. Aqui o
   lutador **voa**, e isso desmonta a IA do vale inteira: não há caminho a
   percorrer, não há obstáculo a contornar e não há elevação a resolver. O que
   existe é uma nuvem de corpos em três dimensões trocando esferas a 78 m/s.

   Integração explícita contra `NamekField.heightAt()` — **sem Rapier**, §4 do
   plano. Um lutador é uma cápsula cinemática: persegue uma velocidade desejada,
   é freado pela borda macia, é cortado pelo teto e não atravessa o relevo. Cabe
   nas duas dúzias de linhas de `integrar()`, é determinístico e não encosta no
   mundo de física do arqueiro.

   ------------------------------------------------------- o que os torna BONS

   §9 do plano, na ordem dele — e a ordem importa, porque é ela que separa um
   adversário de um enfeite que atira:

   1. **Gerenciam ki.** Recuam e carregam abaixo de `kiRetreat`, e — a parte que
      quase ninguém implementa — **seguram a barra cheia**: com o estoque no topo
      eles param de gastar em rajada e vão CAÇAR a distância do especial. Ver
      `guardandoBarra`.
   2. **Esquivam LATERALMENTE.** A esquiva é sempre perpendicular à bola que vem
      (`direcaoDeEsquiva`), nunca para trás. Recuar de uma bola que persegue é
      correr na direção em que ela está mirando; mudar de ÂNGULO é o único jeito
      de estourar o cone de 35° dela.
   3. **Erram no ÂNGULO, não na decisão.** `NAMEK.bot.aimError` escalado pela
      perícia, sorteado A CADA TIRO. Bot que decide mal parece burro; bot que
      mira mal parece humano.
   4. **Não se agrupam.** Repulsão mútua de `NAMEK.bot.separation`, somada ao
      desejo antes de integrar — senão quinze bots viram um cardume, e um
      cardume é um alvo só.

   ------------------------------------------------------------- os projéteis

   A bola de ki de um bot é simulada AQUI, e a de um humano não é — e essa
   assimetria é a mesma de `botArrow.js`, não um descuido. O modelo de confiança
   do §8 diz que **quem atira é a autoridade sobre o próprio acerto**; para um
   humano quem atira é o cliente dele, e para um bot quem atira é este arquivo.
   O servidor não simula a bola do humano porque não precisa: ele recebe o
   `BLAST_HIT` e confere se o número é plausível.

   A bola do humano ainda entra na lista daqui, mas como **fantasma**: não
   machuca ninguém e não abre cratera — existe só para o bot ter o que desviar.
   Sem ela a esquiva funcionaria entre bots e falharia justamente contra a
   pessoa que está jogando.

   ------------------------------------------------------------- as convenções

   Ainda não há cliente de Namekusei, então as duas convenções de pose ficam
   escritas aqui, e são as MESMAS do resto do repositório para não haver duas:

     • **yaw 0 olha para −Z**, e a frente é `(−sen yaw, −cos yaw)`. É a fórmula
       que `faceYaw` em `server/room.js` usa e que `Player.setAim` desfaz.
     • **pitch positivo olha para CIMA.**
   --------------------------------------------------------------------------- */

import { NAMEK, specialInfo, duracaoDaPose, dificuldadeBot } from "../../src/shared/namek/config.js";

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Perseguição exponencial: independente do passo, ao contrário de `a += (b-a)*k`. */
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);

/** A mesma coisa para ângulos, pelo caminho curto do círculo. */
function angDamp(a, b, k, dt) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * (1 - Math.exp(-k * dt));
}

/**
 * Distância de um ponto a um SEGMENTO. A conta que resolve todo acerto do modo.
 *
 * É a mesma de `Room.distanciaAoFeixe` no jogo do arqueiro, e o §4 do plano a
 * nomeia de propósito: um projétil que anda 3,9 m por passo de 20 Hz contra uma
 * cápsula de 46 cm de raio atravessaria o corpo entre dois quadros se o teste
 * fosse ponto contra ponto. Testar o SEGMENTO percorrido no passo é o que torna
 * o acerto independente da taxa de simulação.
 */
function distSeg(px, py, pz, ax, ay, az, bx, by, bz) {
  const ex = bx - ax;
  const ey = by - ay;
  const ez = bz - az;
  const len2 = ex * ex + ey * ey + ez * ez;
  let t = len2 > 1e-9 ? ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + ex * t - px;
  const dy = ay + ey * t - py;
  const dz = az + ez * t - pz;
  return Math.hypot(dx, dy, dz);
}

/**
 * Tem relevo entre os dois pontos?
 *
 * Doze amostras. É grosseiro e é suficiente: o que esta pergunta protege é o
 * especial — a decisão de gastar a barra inteira — e o custo de um falso
 * negativo é um Kamehameha que bate na montanha, não um tiro injusto.
 */
function bloqueadoPeloRelevo(field, ax, ay, az, bx, by, bz) {
  const N = 12;
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    if (field.heightAt(x, z) > y) return true;
  }
  return false;
}

/* A paleta dos lutadores — de CPU E de gente. Quinze cores para as quinze vagas
   de `NAMEK.net.maxPlayers`, para que uma sala cheia nunca tenha duas iguais.
   Mesmo critério de `server/colors.js`: nada de rosa nem magenta, que aqui
   seriam a única cor que não combina com nenhuma aura de ki. Quem reveste é a
   sala (`NamekRoom.tomarCor`), não este arquivo. */
/* A ORDEM É A ORDEM DE ENTREGA, e o primeiro é laranja de propósito.
 *
 * A cor do jogador reveste o GI (ver `character/rig.js`), então ela não é um
 * detalhe de identificação: é a roupa inteira do lutador. O personagem deste
 * modo é feito à imagem do Goku, e o laranja é a assinatura dele — quem entra
 * sozinho numa sala vazia precisa ver o personagem CERTO, não a última cor de
 * uma lista. Antes daqui a entrega saía do fim da lista e o primeiro lutador
 * nascia verde-limão.
 *
 * Do segundo em diante são as cores de quem mais aparece ao lado dele no
 * material de origem — o azul e o roxo dos saiyajins, o verde namekuseijin, o
 * vermelho, o turquesa —, e só depois os tons de desempate. Quinze para as
 * quinze vagas de `NAMEK.net.maxPlayers`: uma sala cheia nunca tem duas iguais.
 *
 * Mesmo critério de `server/colors.js`: nada de rosa nem magenta, que aqui
 * seriam a única cor que não combina com nenhuma aura de ki. */
export const PALETA = [
  "#e8822c", "#4a9ee0", "#7a8ce0", "#5ad04a", "#e0554a",
  "#4ae0c2", "#e0c24a", "#8ee04a", "#4ac2e0", "#d0a04a",
  "#4ad97a", "#e0664a", "#c8e04a", "#4ab4d0", "#a0e04a",
];

/** Contador de bolas. Ver o comentário de `id` em `atirar`. */
let proximaBola = 1;

/* ------------------------------------------------------------------ lutador */

export class NamekBot {
  /**
   * @param {number} id do MESMO contador dos humanos — é isso que faz o placar,
   *   o `DEATH` e o `roster` funcionarem sem nenhum caso especial
   * @param {number} indice 1, 2, 3… só para o nome e a cor
   */
  constructor(id, indice) {
    this.id = id;
    this.isBot = true;
    /* É `conn === null` que impede o `broadcast` de tentar mandar pacote para
       ele. O bot não é um caso especial em lugar nenhum da sala: ele é um
       jogador cuja conexão não existe. */
    this.conn = null;
    this.name = `Lutador ${indice}`;
    /* Cor provisória. Quem manda é `NamekRoom.tomarCor`, que a troca logo em
       seguida — é ela que garante que o bot não repita a cor de um humano. */
    this.color = PALETA[(indice - 1) % PALETA.length];
    /* O corpo. Não há lista canônica de personagens ainda (o cliente de
       Namekusei não existe), então o bot usa o mesmo padrão que a sala aplica a
       um `hello` sem `char`. */
    this.char = "guerreiro";

    /* ------------------------------------------------- pose (packFighter) --
       Estes nomes existem porque `packFighter(obj)` é PURA e os lê. O bot
       produz a pose de rede sem adaptador nenhum — é o mesmo truque de
       `packState` do lado do arqueiro. */
    this.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.gaitPhase = 0;
    this.runBlend = 0;
    this.flyBlend = 1;
    this.boostBlend = 0;
    this.chargeBlend = 0;
    this.specialFraction = 0;
    this.specialIndex = -1;
    this.hurtBlend = 0;
    this.lastHand = 0;
    this.handPose = 0;
    this.down = false;
    this.invuln = false;
    /** s que faltam de queda por golpes seguidos. `packFighter` lê a
     *  VERACIDADE deste campo no bit 4 — ver `NAMEK.fighter.stagger`. */
    this.tonto = 0;
    /** Guarda de pé? Bit 8 da pose. Quem decide é `talvezDefender`. */
    this.defendendo = false;

    /* ------------------------------------------------------ estado de sala -- */
    this.health = NAMEK.fighter.maxHealth;
    this.ki = NAMEK.ki.max;
    this.alive = true;
    this.invulnUntil = 0;
    this.respawnAt = 0;
    this.ultimoGasto = -Infinity;
    this.score = { kills: 0, deaths: 0 };
    this.state = null;
    this.stateTime = 0;
    this.ping = 0;
    /* Os mesmos campos que a sala cria para um humano no `join`. Existem aqui
       para que `aplicarDano`, `podeCravar` e o acúmulo de dor não precisem
       perguntar se o corpo é de gente — ver `NamekRoom.todos()`. */
    this.dorAcum = 0;
    this.dorAte = 0;
    this.dorPor = null;
    this.dorKind = "blast";
    this.crateraAte = 0;

    /* ------------------------------------------------------------- perícia --
       Sorteada em torno do padrão, e não igual para todos: quinze adversários
       com a mesma mira e o mesmo tempo de reação lêem como quinze cópias do
       mesmo adversário, que é exatamente a sensação que uma sala cheia de bots
       não pode dar. */
    this.pericia = clamp(NAMEK.bot.skill + (Math.random() - 0.5) * 0.26, 0.34, 0.99);
    /** s — o quanto ele demora para reagir a uma ameaça nova. */
    this.reacao = NAMEK.bot.reaction * (2 - this.pericia);
    /** graus — o pior erro de mira dele. Ver `mirar`. */
    this.erroMira = NAMEK.bot.aimError * (1 - this.pericia);

    /* ------------------------------------------------------------------ IA -- */
    /** `procurar` | `aproximar` | `atacar` | `esquivar` | `carregar` */
    this.estado = "procurar";
    this.alvoId = null;
    this.tDecisao = Math.random() * 0.2;
    this.recarga = 0;
    /** +1 ou −1: de que lado ele circunda. Vira sozinho — ver `decidir`. */
    this.lado = Math.random() < 0.5 ? 1 : -1;
    this.trocaLado = 1.4 + Math.random() * 1.8;
    /** m — o degrau de altitude que ele mantém em relação ao alvo. */
    this.degrau = (Math.random() - 0.5) * 34;
    this.boost = false;
    this.carregando = false;
    /** s — quanto falta da esquiva em curso. */
    this.esquiva = 0;
    this.esquivaDir = { x: 0, y: 0, z: 0 };
    /** s — quanto falta da guarda em curso. Ver `talvezDefender`. */
    this.defesa = 0;
    /** s — carência depois de DECIDIR não desviar. Ver `decidir`. */
    this.recusaEm = 0;
    /** s — carência até o próximo especial. É a dificuldade em segundos; ver
     *  `talvezEspecial`. */
    this.especialEm = 0;
    /** Para onde ele vaga quando não há ninguém. */
    this.destino = null;
    /** s — carência da onda de empurrão. */
    this.ondaEm = 0;
    /** O especial em curso: `{ kind, dir, t, dur, windup, saiu }` ou null. */
    this.especial = null;
    /** Contadores do banco de provas. Não custam nada e respondem tudo. */
    this.gastoKi = 0;
    this.tiros = 0;
    this.especiais = 0;
    this.esquivas = 0;
  }

  /* ---------------------------------------------------------------- vida -- */

  renascer(x, y, z, invulnUntil = 0) {
    this.alive = true;
    this.down = false;
    this.tonto = 0;
    this.health = NAMEK.fighter.maxHealth;
    this.ki = NAMEK.ki.max;
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.invulnUntil = invulnUntil;
    this.especial = null;
    this.specialIndex = -1;
    this.specialFraction = 0;
    this.chargeBlend = 0;
    this.boostBlend = 0;
    this.hurtBlend = 0;
    this.esquiva = 0;
    this.defesa = 0;
    this.defendendo = false;
    this.estado = "procurar";
    this.destino = null;
    /* Encara o meio da arena ao cair: nascer de costas para a briga é nascer
       gastando meio segundo girando. */
    this.yaw = Math.atan2(x, z);
  }

  cair() {
    this.alive = false;
    this.down = true;
    this.tonto = 0;
    this.health = 0;
    this.especial = null;
    this.specialIndex = -1;
    this.specialFraction = 0;
    this.chargeBlend = 0;
    this.boostBlend = 0;
    this.carregando = false;
    this.boost = false;
    this.esquiva = 0;
    this.defesa = 0;
    this.defendendo = false;
  }

  /** A pose de dor, que o cliente lê em `hu`. Decai sozinha. */
  machucar() {
    this.hurtBlend = 1;
  }

  /**
   * Cinco golpes seguidos: ele PERDE O AR e cai.
   *
   * Quem conta os golpes é a sala (`NamekRoom.contarGolpe`) — aqui só se paga a
   * conta, e ela é a mesma que um humano paga na tela dele: o corpo é jogado
   * para baixo, o especial em curso morre no meio, e por `segundos` ele não
   * decide mais nada. O `estado` volta a `procurar` porque quem levanta do chão
   * não continua a manobra que estava fazendo antes de cair.
   *
   * O bot NÃO é solto no ar em queda livre por 2,4 s: `passoDoBot` o traz para
   * baixo com a mesma velocidade de corpo mole que a morte usa. Integrar
   * gravidade aqui daria trezentos metros de queda e o pouso do atordoamento
   * viraria uma cratera do outro lado da montanha.
   */
  derrubar(segundos) {
    if (!this.alive) return;
    this.tonto = Math.max(this.tonto, segundos);
    this._quedaAr = QUEDA_MAX;
    this.especial = null;
    this.specialIndex = -1;
    this.specialFraction = 0;
    this.carregando = false;
    this.boost = false;
    this.esquiva = 0;
    /* Caído não tem guarda — os braços não estão mais entre ele e o mundo. A
       sala pensa o mesmo (ver `NamekRoom.defendendo`), e as duas linhas
       existem porque as duas pontas decidem sozinhas. */
    this.defesa = 0;
    this.defendendo = false;
    this.estado = "procurar";
    this.tDecisao = 0;
    this.velocity.y = Math.min(this.velocity.y, -NAMEK.fighter.stagger.drop);
  }
}

/* ------------------------------------------------------------------ esquadra */

export class NamekBotSquad {
  constructor() {
    /** @type {NamekBot[]} */
    this.list = [];
    this.contador = 0;
    /**
     * As bolas em voo — dos bots e, como FANTASMA, dos humanos.
     * Ver o cabeçalho para por que as duas coisas moram na mesma lista.
     */
    this.bolas = [];
    /** Os feixes sustentados em curso: `{ dono, kind, o, d, t, info }`. */
    this.feixes = [];

    /* A DIFICULDADE É DA ESQUADRA, e não de cada bot. É o que faz o pedido
       ("tudo é alterado para todos dinamicamente, independente se já tiver
       adicionado o bot ou não") sair de graça: os multiplicadores são lidos
       AQUI, no quadro em que são usados, então trocar de nível muda o
       comportamento de quem já está em campo no passo seguinte — sem renascer
       ninguém, sem varrer lista, sem perder o alvo que cada um estava
       perseguindo. Ver `NAMEK.bot.dificuldades`. */
    this.dificuldadeId = NAMEK.bot.dificuldadePadrao;
    this.dif = dificuldadeBot(this.dificuldadeId);
  }

  /**
   * Troca o nível de todos os bots, agora.
   *
   * @param {string} id um de `NAMEK.bot.dificuldadeOrdem`
   * @returns {boolean} false quando o id não existe ou já era o corrente
   */
  setDificuldade(id) {
    if (typeof id !== "string") return false;
    if (!NAMEK.bot.dificuldades[id]) return false;
    if (id === this.dificuldadeId) return false;
    this.dificuldadeId = id;
    this.dif = dificuldadeBot(id);
    /* O que estava em curso é CANCELADO. Um especial armado no nível difícil
       terminando de sair depois de a sala pedir "parado" é o contrário do que
       "dinamicamente" quer dizer — e o alvo de treino não pode revidar nem uma
       vez. O resto do estado (alvo, órbita, ki) fica: trocar de nível não é
       recomeçar a partida. */
    for (const bot of this.list) {
      bot.especial = null;
      bot.specialIndex = -1;
      bot.specialFraction = 0;
      bot.carregando = false;
      bot.boost = false;
      bot.esquiva = 0;
      bot.defesa = 0;
      bot.defendendo = false;
      bot.especialEm = 0;
      bot.tDecisao = 0;
    }
    return true;
  }

  get count() {
    return this.list.length;
  }

  byId(id) {
    for (const b of this.list) if (b.id === id) return b;
    return null;
  }

  /**
   * @param {number} id vindo do contador de jogadores da sala
   * @param {object} field o `NamekField` da sala
   * @param {Array<{x:number,y:number,z:number}>} ocupados para não nascer em cima de alguém
   */
  add(id, field, ocupados = []) {
    this.contador++;
    const bot = new NamekBot(id, this.contador);
    const p = melhorNascimento(field, ocupados);
    bot.renascer(p.x, p.y, p.z);
    this.list.push(bot);
    return bot;
  }

  removeLast() {
    const bot = this.list.pop() ?? null;
    if (bot) this.esquecer(bot.id);
    return bot;
  }

  clear() {
    const saindo = this.list;
    this.list = [];
    this.contador = 0;
    this.bolas.length = 0;
    this.feixes.length = 0;
    return saindo;
  }

  /** Tira da simulação tudo que pertencia a quem saiu. */
  esquecer(id) {
    this.bolas = this.bolas.filter((b) => b.dono !== id);
    this.feixes = this.feixes.filter((f) => f.dono !== id);
  }

  /**
   * "Um humano acabou de atirar."
   *
   * Vira uma bola FANTASMA: persegue igual, envelhece igual e some igual, mas
   * não machuca ninguém e não abre cratera. O bot precisa dela para desviar —
   * sem isto a esquiva seria uma habilidade que os bots só usam entre si, e a
   * pessoa que está jogando veria adversários que ignoram os tiros dela.
   */
  avisarRajada({ owner, o, d, target }) {
    if (!Array.isArray(o) || !Array.isArray(d)) return;
    const n = normalizar(d[0], d[1], d[2]);
    if (!n) return;
    /* Teto da lista. O custo do ki já limita a cadência de verdade (a sala cobra
       2 por bola antes de chegar aqui), e quinze lutadores carregando e
       atirando no talo não passam de umas setecentas em voo. O teto existe para
       o caso que a economia não cobre — um cliente com o relógio adiantado
       despejando o histórico de uma vez — e o que ele descarta é medo de bot,
       não dano: bola perdida aqui é bola que ninguém desvia, nunca bola que
       ninguém leva. */
    if (this.bolas.length > 900) return;
    this.bolas.push({
      id: proximaBola++,
      dono: owner,
      x: o[0], y: o[1], z: o[2],
      dx: n.x, dy: n.y, dz: n.z,
      alvo: Number.isFinite(target) ? target : null,
      t: 0,
      vida: NAMEK.blast.life,
      velocidade: NAMEK.blast.speed,
      raio: NAMEK.blast.hitRadius,
      dano: 0,
      poder: 0,
      fantasma: true,
      persegue: true,
    });
  }

  /**
   * "Um humano soltou um especial."
   *
   * Não vira dano nenhum (quem atira é dono do próprio acerto — o `SPECIAL_HIT`
   * é que cobra), vira MEDO: um feixe fantasma que os bots consultam para sair
   * do eixo. Um bot que atravessa um Kamehameha porque não o enxerga é o
   * defeito mais visível que este modo poderia ter.
   */
  avisarEspecial({ owner, kind, o, d }) {
    const info = specialInfo(kind);
    if (!info || !Array.isArray(o) || !Array.isArray(d)) return;
    const n = normalizar(d[0], d[1], d[2]);
    if (!n) return;

    /* NEM TODO ESPECIAL É UM FEIXE, e o medo tem de ter a forma certa.
     *
     * A divisão é a mesma que o resto do modo usa: quem tem `dps` é um SEGMENTO
     * que fica aceso (Kamehameha), quem tem `damage` é um corpo que VOA (o
     * Kienzan, a Genki Dama e, desde que deixou de ser um segundo Kamehameha, o
     * Galick Gun). Empurrar um golpe que voa para a lista de feixes o desenharia
     * na cabeça do bot como uma parede de meio quilômetro acesa na direção do
     * tiro — ele desviaria de uma coisa que não existe e ficaria parado na frente
     * da que existe. E `passoDosFeixes` cobra `info.dps * dt`: sem `dps`, a conta
     * é `undefined * dt`, ou seja, NaN de dano em cima de quem estivesse por
     * perto se o feixe não fosse fantasma. */
    if (info.dps === undefined) {
      this.bolas.push({
        id: proximaBola++,
        dono: owner,
        x: o[0], y: o[1], z: o[2],
        dx: n.x, dy: n.y, dz: n.z,
        alvo: null,
        t: 0,
        /* A ESPERA é o `windup` do golpe: o humano ainda está na pose, e a bola
           só nasce quando ele a solta. Sem ela, o fantasma sairia no instante do
           anúncio e chegaria ao alvo um segundo inteiro antes do golpe de
           verdade — o bot desviaria cedo, voltaria para o lugar, e tomaria na
           cara a Genki Dama que ele "já tinha desviado". */
        espera: info.windup,
        vida: Math.min(info.sustain, info.range / info.speed),
        velocidade: info.speed,
        raio: info.hitRadius,
        dano: 0,
        poder: 0,
        fantasma: true,
        persegue: false,
      });
      return;
    }

    this.feixes.push({
      dono: owner,
      kind,
      info,
      ox: o[0], oy: o[1], oz: o[2],
      dx: n.x, dy: n.y, dz: n.z,
      t: 0,
      dur: info.windup + info.sustain,
      fantasma: true,
      crateraFeita: true,
    });
  }

  /* -------------------------------------------------------------- o passo -- */

  /**
   * Um passo de todos os bots, das bolas e dos feixes.
   *
   * @param {number} dt segundos
   * @param {object} ctx `{ field, corpos, agora, gastar(bot, custo), emitir(ev) }`
   *   — `corpos` é a lista uniforme de TODO MUNDO em campo (humano e bot), que a
   *   sala monta uma vez por quadro; `gastar` é a sala cobrando ki, porque a
   *   barra é dela e não daqui; `emitir` é como o bot fala com a sala.
   */
  tick(dt, ctx) {
    for (const bot of this.list) this.passoDoBot(bot, dt, ctx);
    /* Os bots já andaram; as bolas têm de encontrá-los ONDE ELES ESTÃO.
       Sem esta linha o projétil testaria contra a posição do começo do quadro,
       e a 64 m/s isso são mais de três metros de defasagem — o bastante para uma
       bola atravessar alguém sem tocar e para outra acertar um lugar vazio. */
    for (const c of ctx.corpos) {
      if (!c.isBot) continue;
      c.x = c.ref.position.x;
      c.y = c.ref.position.y;
      c.z = c.ref.position.z;
      c.vx = c.ref.velocity.x;
      c.vy = c.ref.velocity.y;
      c.vz = c.ref.velocity.z;
      c.alive = c.ref.alive;
    }
    this.passoDasBolas(dt, ctx);
    this.passoDosFeixes(dt, ctx);
  }

  /* ------------------------------------------------------------- o lutador -- */

  passoDoBot(bot, dt, ctx) {
    if (!bot.alive) {
      /* Corpo caído: a sala cuida do renascimento. Aqui ele só para de voar —
         a pose continua sendo transmitida, com o bit `down` aceso, e o corpo
         desce até o chão em vez de ficar boiando onde morreu. Os −18 m/s são
         uma velocidade de queda, não a gravidade: um corpo mole não acelera
         indefinidamente, e integrar `gravity` daria trezentos metros de queda
         livre nos cinco segundos de renascimento. */
      bot.velocity.x = damp(bot.velocity.x, 0, 3, dt);
      bot.velocity.y = damp(bot.velocity.y, -18, 2, dt);
      bot.velocity.z = damp(bot.velocity.z, 0, 3, dt);
      this.integrar(bot, dt, ctx.field);
      bot.hurtBlend = Math.max(0, bot.hurtBlend - dt * 1.6);
      return;
    }

    bot.invuln = ctx.agora < bot.invulnUntil;
    bot.hurtBlend = Math.max(0, bot.hurtBlend - dt * 2.2);

    /* ATORDOADO: vivo, no chão, e sem decisão nenhuma.
     *
     * É o mesmo corpo mole da morte — velocidade amortecida para uma descida de
     * 18 m/s e nada mais —, com uma diferença que importa: ele continua VIVO na
     * lista de corpos, então ainda pode ser acertado, ainda é alvo válido para
     * quem estiver mirando, e ainda conta como gente na sala. É exatamente o que
     * a janela existe para produzir: alguém parado e alcançável pelo tempo de um
     * especial ser carregado. Ver `NamekBot.derrubar`. */
    if (bot.tonto > 0) {
      /* O RELÓGIO SÓ ANDA NO CHÃO — a mesma regra do lutador humano (ver
         `FighterController.derrubar`), e ela vale aqui pelo mesmo motivo: um bot
         derrubado a duzentos metros que recuperasse o controle no meio da queda
         voltaria a voar sem nunca ter encostado, e o golpe não teria
         acontecido. `_quedaAr` é o teto de segurança para o caso de o chão não
         chegar (derrubado sobre o oceano da borda). */
      const chao = ctx.field.heightAt(bot.position.x, bot.position.z);
      const noChao = bot.position.y <= chao + FOLGA_DURA + 0.4;
      if (noChao) bot.tonto -= dt;
      else {
        bot._quedaAr = (bot._quedaAr ?? QUEDA_MAX) - dt;
        if (bot._quedaAr <= 0) bot.tonto = 0;
      }
      bot.velocity.x = damp(bot.velocity.x, 0, 3, dt);
      bot.velocity.y = damp(bot.velocity.y, -18, 2, dt);
      bot.velocity.z = damp(bot.velocity.z, 0, 3, dt);
      bot.flyBlend = damp(bot.flyBlend, 0, 4, dt);
      bot.boostBlend = damp(bot.boostBlend, 0, 6, dt);
      bot.chargeBlend = damp(bot.chargeBlend, 0, 6, dt);
      this.integrar(bot, dt, ctx.field);
      if (bot.tonto <= 0) {
        bot.tonto = 0;
        bot._quedaAr = QUEDA_MAX;
        /* Levanta VOANDO. Um lutador que se põe de pé na grama e sobe a pé
           passa os dois segundos seguintes sendo um alvo parado — ou seja, a
           punição duraria o dobro do que está escrito em `stagger.time`. */
        bot.flyBlend = 1;
        bot.velocity.y = Math.max(bot.velocity.y, 6);
      }
      return;
    }

    bot.handPose = Math.max(0, bot.handPose - dt * 4);
    bot.recarga -= dt;
    bot.ondaEm -= dt;
    bot.esquiva -= dt;
    bot.recusaEm -= dt;
    bot.especialEm -= dt;
    bot.defesa -= dt;
    /* A GUARDA VALE ATÉ O RELÓGIO ZERAR, e cai sozinha com a barra vazia — a
       sala cobra `guard.drain` por segundo enquanto este bit estiver aceso (ver
       `NamekRoom.economiaDeKi`), então um bot que defendesse sem olhar a barra
       ficaria sem ki para escapar logo depois, que é o pior negócio possível. */
    /* E nunca junto da carga: são as duas mãos ocupadas de jeitos opostos, e a
       sala somaria o ganho da carga ao dreno da guarda no mesmo quadro — uma
       barra que sobe enquanto o corpo se protege é o contrário da troca. */
    bot.defendendo = bot.defesa > 0 && !bot.carregando && bot.ki > NAMEK.ki.burstCost;
    bot.trocaLado -= dt;
    if (bot.trocaLado <= 0) {
      /* Trocar de lado no meio da órbita é o que impede o bot de virar um
         satélite previsível — e é de graça: quem está mirando nele perde a
         antecipação sem que ele tenha de fazer nada de diferente. */
      bot.lado = -bot.lado;
      bot.degrau = (Math.random() - 0.5) * 34;
      bot.trocaLado = 1.4 + Math.random() * 1.8;
    }

    /* O ESPECIAL É COMPROMISSO. Enquanto ele corre, não se decide mais nada:
       nem alvo, nem esquiva, nem tiro. É a troca do §5 — a barra inteira compra
       o golpe mais forte do jogo e paga com os segundos em que você é um alvo
       parado. Um bot que pudesse cancelar seria um bot que nunca arrisca. */
    if (bot.especial) {
      this.passoDoEspecial(bot, dt, ctx);
      this.integrar(bot, dt, ctx.field);
      return;
    }

    bot.tDecisao -= dt;
    if (bot.tDecisao <= 0) {
      this.decidir(bot, ctx);
      bot.tDecisao = bot.reacao;
    }

    const alvo = bot.alvoId === null ? null : acharCorpo(ctx.corpos, bot.alvoId);
    const dv = this.desejo(bot, alvo, ctx);
    this.separar(bot, dv);
    this.conduzir(bot, dv, ctx, dt);
    this.integrar(bot, dt, ctx.field);
    this.pose(bot, alvo, dt);

    if (bot.estado === "atacar" && alvo) this.talvezAtirar(bot, alvo, ctx);
    this.talvezOnda(bot, ctx);
  }

  /* ------------------------------------------------------------- a decisão -- */

  /**
   * A máquina de estados, em cinco linhas de prioridade.
   *
   * A ORDEM É A REGRA. Esquivar ganha de tudo porque uma bola a caminho é a
   * única coisa que acontece agora; carregar vem em seguida porque um lutador
   * sem ki é um lutador que só sabe fugir; e atacar é o que sobra — que é como
   * deve ser, num modo em que a briga é o assunto.
   */
  decidir(bot, ctx) {
    /* 0 — O ALVO DE TREINO não decide nada. Sem alvo, sem esquiva, sem carga,
       sem tiro: `desejo` vai lê-lo em `treino` e só corrigir a altura. Ver
       `NAMEK.bot.dificuldades.parado`, que explica o ciclo inteiro (subir,
       apanhar, cair, subir). */
    if (this.dif.mover === 0) {
      bot.alvoId = null;
      bot.estado = "treino";
      return;
    }

    const alvo = this.escolherAlvo(bot, ctx);
    bot.alvoId = alvo?.id ?? null;

    /* 1 — TEM COISA VINDO. */
    const ameaca = this.ameacaPara(bot, ctx);
    /* A CHANCE DE DESVIAR é a dificuldade em pessoa — é o "mais fácil de ser
     * acertado" do pedido. E ela precisa de uma CARÊNCIA para significar o que
     * diz.
     *
     * `decidir` roda a cada `reaction` segundos (0,22 no padrão), e uma bola
     * leva perto de meio segundo entre entrar no alcance de aviso e chegar: sem
     * carência, o bot sortearia duas ou três vezes contra a MESMA bola, e 25 %
     * por sorteio viram 58 % de chance real. O nível fácil deixaria de existir
     * por aritmética. Recusado o desvio, ele fica 0,6 s sem repensar — o tempo
     * de a bola que ele decidiu ignorar chegar ou passar. */
    if (ameaca && bot.recusaEm <= 0 && Math.random() >= this.dif.esquiva) {
      bot.recusaEm = 0.6;
    } else if (ameaca && bot.recusaEm <= 0) {
      if (bot.esquiva <= 0) bot.esquivas++;
      bot.esquivaDir = ameaca;
      bot.esquiva = 0.55;
      /* E ELE TAMBÉM LEVANTA A GUARDA — desviar e se proteger não são
       * alternativas, são a mesma reação.
       *
       * O bot esquiva sempre; a guarda é a segunda camada, e ela existe por uma
       * razão de jogo e não de sobrevivência: sem isto, a defesa seria um botão
       * que só o jogador humano tem, e o modo ensinaria a mecânica a ninguém.
       * Vendo um adversário cruzar os braços e aguentar a rajada, o jogador
       * aprende que aquilo é possível — que é como todo jogo ensina o que ele
       * não escreve na tela.
       *
       * `pericia` decide QUEM se protege: um lutador ruim (0,34) quase nunca
       * fecha a guarda a tempo, um bom (0,99) fecha quase sempre. E ninguém
       * defende com a barra baixa: ki é fuga, e gastar o resto dele aparando
       * significa não ter como sair depois. */
      /* MAS SÓ CONTRA O QUE VALE A PENA. Medido no banco de provas: com o bot
       * aparando toda bolinha, a sala inteira parou de morrer — 15 lutadores,
       * 60 s, **zero abates**, contra os dois por minuto de sempre. Não é um
       * detalhe de ajuste: um adversário que reduz 78 % do dano recebido a cada
       * ameaça é, na prática, um adversário imortal, e o modo deixa de ter
       * desfecho.
       *
       * A regra que sobrou é a que um jogador bom usa: **de bolinha se desvia,
       * de golpe grande se aguenta** — e também se aguenta quando a vida está
       * no fim, porque aí não há mais o que trocar. As duas condições são
       * raras, que é exatamente o que faz a guarda LER como uma decisão quando
       * ela aparece. */
      const vale = this.grande || bot.health < NAMEK.fighter.maxHealth * 0.4;
      if (vale && bot.defesa <= 0 && bot.ki > NAMEK.ki.max * 0.45 && Math.random() < bot.pericia * 0.85) {
        bot.defesa = 0.45 + Math.random() * 0.4;
      }
    }
    if (bot.esquiva > 0) {
      bot.estado = "esquivar";
      return;
    }

    /* 2 — KI NO CHÃO.
       A histerese é obrigatória: sem ela o bot cruza `kiRetreat` para cima e
       para baixo a cada rajada, e o que se vê é alguém tremendo entre carregar
       e atirar sem fazer nem uma coisa nem outra. Entra em 30 %, sai em 88 %. */
    const frac = bot.ki / NAMEK.ki.max;
    const limite = bot.estado === "carregar" ? 0.88 : NAMEK.bot.kiRetreat;
    if (frac < limite) {
      bot.estado = "carregar";
      return;
    }

    if (!alvo) {
      bot.estado = "procurar";
      return;
    }

    const d = Math.hypot(alvo.x - bot.position.x, alvo.y - bot.position.y, alvo.z - bot.position.z);

    /* 3 — A BARRA ESTÁ CHEIA E O ALVO ESTÁ LONGE.
       Ver `guardandoBarra`: neste estado ele não gasta em rajada, ele CAÇA a
       distância do especial. É o comportamento que mais separa um bot bom de um
       bot que atira o tempo todo. */
    if (this.guardandoBarra(bot, d)) {
      bot.estado = d > 90 ? "aproximar" : "atacar";
      return;
    }

    bot.estado = d > NAMEK.bot.idealRange * 1.7 ? "aproximar" : "atacar";
  }

  /**
   * Ele está com a barra cheia e vale a pena guardá-la?
   *
   * §9.1 do plano: "guardam a barra cheia para quando o alvo estiver a menos de
   * 90 m e sem cobertura". A leitura ao pé da letra seria "nunca atire de barra
   * cheia", e isso trava um bot que não consegue chegar perto. O corte é a
   * DISTÂNCIA: com o alvo a menos de 160 m ele tem chance real de fechar o
   * espaço, então segura; mais longe que isso, a barra volta a ser munição.
   */
  guardandoBarra(bot, d) {
    /* GUARDAR A BARRA É PERÍCIA, e por isso ela é a primeira coisa que o nível
     * manso perde.
     *
     * Isto saiu de uma medida que teimava em dar o contrário do esperado: com a
     * carência de especial já no lugar, o nível FÁCIL soltava 45 especiais por
     * partida contra 17 do DIFÍCIL. A causa não estava no especial — estava no
     * ki. O bot difícil desvia muito, e desviar custa arranque; ele passa a
     * partida com a barra pela metade e só chega ao especial quando de fato
     * merece. O fácil quase não desvia, então não gasta nada, e a barra dele
     * vivia cheia: a carência virou o único limite, e ele soltava no relógio.
     *
     * Corrigir com um número maior de carência seria tratar o sintoma. O certo
     * é o próprio comportamento: **quem joga mal não economiza recurso.** Abaixo
     * de metade da escala de especial, o bot gasta a barra em rajada como
     * qualquer um gastaria, e o especial passa a ser o que sobra — que é
     * exatamente o "não solta tantos poderes" do pedido, e de brinde é uma
     * leitura muito mais honesta de um adversário fraco. */
    if (this.dif.especial < 0.5) return false;
    return bot.ki >= NAMEK.ki.max * 0.985 && d < 160;
  }

  /**
   * Contra quem brigar.
   *
   * Mantém o alvo atual enquanto ele estiver vivo e ao alcance — trocar de alvo
   * a cada 0,2 s por causa de dois metros de diferença produz um bot que gira
   * sem atirar, que é o modo mais barato de parecer burro. A preferência é pelo
   * mais perto com um desconto por vida baixa: terminar quem já está caindo é o
   * que qualquer jogador faz.
   */
  escolherAlvo(bot, ctx) {
    const atual = bot.alvoId === null ? null : acharCorpo(ctx.corpos, bot.alvoId);
    if (atual && atual.alive && !atual.invuln) {
      const d = Math.hypot(atual.x - bot.position.x, atual.y - bot.position.y, atual.z - bot.position.z);
      if (d < 300) return atual;
    }

    let melhor = null;
    let melhorC = Infinity;
    for (const c of ctx.corpos) {
      if (c.id === bot.id || !c.alive || c.invuln) continue;
      const d = Math.hypot(c.x - bot.position.x, c.y - bot.position.y, c.z - bot.position.z);
      /* O desconto por vida: 60 m de vantagem para quem está com a vida no fim.
         Não é agressividade gratuita — é o que faz o abate ACONTECER em vez de
         quinze lutadores se ferindo em círculo para sempre. */
      const custo = d - (1 - c.health / NAMEK.fighter.maxHealth) * 60;
      if (custo < melhorC) {
        melhorC = custo;
        melhor = c;
      }
    }
    return melhor;
  }

  /**
   * Tem alguma coisa a caminho? Devolve para onde desviar, ou null.
   *
   * **A esquiva é PERPENDICULAR, sempre.** O §9.2 do plano é categórico e a
   * razão é geométrica: a bola corrige o rumo em até 95°/s enquanto o alvo
   * estiver dentro de um cone de 35° à frente dela (§6.1). Recuar mantém o bot
   * dentro do cone — ele apenas adia. Sair de lado (ou para cima, que aqui é
   * "de lado" também) tira o bot do cone, e a bola segue reta para o vazio.
   */
  ameacaPara(bot, ctx) {
    /* Zerada a cada consulta: ela descreve a ameaça que ESTA chamada achou, e
       um resto da anterior faria o bot se defender de um perigo que já passou. */
    this.grande = false;
    const bx = bot.position.x;
    const by = bot.position.y + NAMEK.fighter.chest;
    const bz = bot.position.z;

    for (const b of this.bolas) {
      if (b.dono === bot.id) continue;
      const rx = b.x - bx;
      const ry = b.y - by;
      const rz = b.z - bz;
      const dist = Math.hypot(rx, ry, rz);
      if (dist > 110) continue;

      /* Instante da menor aproximação, no referencial do bot. A velocidade dele
         entra na conta: um bot que já está saindo de lado não precisa esquivar
         de novo, e sem isto ele ficaria preso numa esquiva perpétua. */
      const vx = b.dx * b.velocidade - bot.velocity.x;
      const vy = b.dy * b.velocidade - bot.velocity.y;
      const vz = b.dz * b.velocidade - bot.velocity.z;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 < 1) continue;
      const t = -(rx * vx + ry * vy + rz * vz) / v2;
      if (t < 0 || t > 0.95) continue;
      const cx = rx + vx * t;
      const cy = ry + vy * t;
      const cz = rz + vz * t;
      if (Math.hypot(cx, cy, cz) > 7) continue;
      /* A AMEAÇA É GRANDE? O raio do projétil responde sozinho: uma bola de ki
         tem 1,5 m de raio de acerto, e todo especial que voa tem no mínimo 3,4.
         É o que decide se vale a pena levantar a guarda (ver `decidir`) — de
         bolinha se desvia, de Genki Dama se aguenta. */
      this.grande = b.raio > NAMEK.blast.hitRadius * 1.5;
      return direcaoDeEsquiva(b.dx, b.dy, b.dz, rx, ry, rz);
    }

    /* O FEIXE. Não se desvia de um Kamehameha no último instante: ele já está
       aceso e o que importa é a distância ao EIXO, não o tempo de chegada. */
    for (const f of this.feixes) {
      if (f.dono === bot.id) continue;
      const alcance = f.info.range;
      const d = distSeg(
        bx, by, bz,
        f.ox, f.oy, f.oz,
        f.ox + f.dx * alcance, f.oy + f.dy * alcance, f.oz + f.dz * alcance,
      );
      if (d > f.info.hitRadius + 16) continue;
      // Feixe é sempre grande: são 62 de dano por segundo.
      this.grande = true;
      return direcaoDeEsquiva(f.dx, f.dy, f.dz, bx - f.ox, by - f.oy, bz - f.oz);
    }

    return null;
  }

  /* -------------------------------------------------------------- o desejo -- */

  /** A velocidade que ele QUER ter, antes de separação, borda e relevo. */
  desejo(bot, alvo, ctx) {
    const dv = { x: 0, y: 0, z: 0 };
    bot.boost = false;
    bot.carregando = false;

    switch (bot.estado) {
      case "esquivar": {
        /* Esquiva com ARRANQUE. Sair de lado a 34 m/s não sai do cone de uma
           bola que vem a 78 m/s corrigindo; a 64 m/s do arranque, sai. O ki que isso
           custa é o preço de continuar vivo, e é uma troca que o jogador
           também faz. */
        const forte = bot.ki > NAMEK.ki.burstCost;
        bot.boost = forte;
        const v = forte ? NAMEK.fighter.boostSpeed : NAMEK.fighter.flySpeed;
        dv.x = bot.esquivaDir.x * v;
        dv.y = bot.esquivaDir.y * v;
        dv.z = bot.esquivaDir.z * v;
        break;
      }

      case "carregar": {
        /* Duas fases. Primeiro AFASTA — carregar a dez metros de quem está
           atirando é oferecer o peito —, depois trava e enche a barra. O
           `chargeBlend` é o que a sala lê para creditar `NAMEK.ki.chargeRate`:
           a barra é dela, e este arquivo só declara a POSE. */
        const perto = alvo
          ? Math.hypot(alvo.x - bot.position.x, alvo.y - bot.position.y, alvo.z - bot.position.z)
          : Infinity;
        if (alvo && perto < NAMEK.bot.idealRange * 1.6) {
          const f = versor(bot.position.x - alvo.x, bot.position.y - alvo.y, bot.position.z - alvo.z);
          bot.boost = perto < NAMEK.bot.tooClose * 1.6 && bot.ki > NAMEK.ki.burstCost;
          const v = bot.boost ? NAMEK.fighter.boostSpeed : NAMEK.fighter.flySpeed;
          dv.x = f.x * v;
          dv.y = f.y * v * 0.6 + 6;
          dv.z = f.z * v;
        } else {
          bot.carregando = true; // travado no lugar, como manda o §5
        }
        break;
      }

      case "aproximar": {
        if (!alvo) break;
        const f = versor(alvo.x - bot.position.x, alvo.y - bot.position.y, alvo.z - bot.position.z);
        const d = Math.hypot(alvo.x - bot.position.x, alvo.y - bot.position.y, alvo.z - bot.position.z);
        bot.boost = d > 110 && bot.ki > NAMEK.ki.max * 0.45;
        const v = bot.boost ? NAMEK.fighter.boostSpeed : NAMEK.fighter.flySpeed;
        /* Chega em ARCO, não em linha reta. Uma aproximação frontal e
           perfeitamente reta é o alvo mais fácil que existe — e, pior, lê como
           trilho de trem. O termo lateral é 30 % da velocidade e resolve as
           duas coisas de uma vez. */
        const lat = versor(-f.z, 0, f.x);
        dv.x = (f.x + lat.x * 0.3 * bot.lado) * v;
        dv.y = (f.y + 0.08) * v;
        dv.z = (f.z + lat.z * 0.3 * bot.lado) * v;
        break;
      }

      case "atacar": {
        if (!alvo) break;
        const ex = alvo.x - bot.position.x;
        const ey = alvo.y - bot.position.y;
        const ez = alvo.z - bot.position.z;
        const d = Math.max(1e-3, Math.hypot(ex, ey, ez));
        const f = { x: ex / d, y: ey / d, z: ez / d };
        /* A FAIXA. Erro positivo = está longe demais, negativo = colado. O
           ganho de 0,9 basta: a faixa é larga (22 m a 55 m) e um ganho alto
           faria o bot oscilar dentro dela como um pêndulo. */
        const erro = d - NAMEK.bot.idealRange;
        const radial = clamp(erro * 0.9, -NAMEK.fighter.flySpeed, NAMEK.fighter.flySpeed);
        const lat = versor(-f.z, 0, f.x);
        const orbital = NAMEK.fighter.flySpeed * 0.72 * bot.lado;
        /* O DEGRAU. Brigar na mesma cota do adversário é brigar em duas
           dimensões, e o modo tem três. Cada bot escolhe uma altura relativa e
           a troca junto com o lado da órbita. */
        const alturaAlvo = alvo.y + bot.degrau;
        dv.x = f.x * radial + lat.x * orbital;
        dv.y = clamp((alturaAlvo - bot.position.y) * 1.1, -NAMEK.fighter.climbSpeed, NAMEK.fighter.climbSpeed);
        dv.z = f.z * radial + lat.z * orbital;
        /* Colado demais: sai de perto com arranque. `tooClose` existe para o
           bot não virar aquele adversário que gruda no rosto e não deixa mirar. */
        if (d < NAMEK.bot.tooClose) bot.boost = bot.ki > NAMEK.ki.max * 0.5;
        break;
      }

      case "treino": {
        /* O ALVO DE TREINO. Uma linha de comportamento: **só a altura.**
         *
         * Nada lateral — nem órbita, nem separação útil, nem fuga da borda —,
         * então ele fica onde está e sobe até `alturaTreino` acima do relevo.
         * Quando um golpe o empurra ou o derruba ele cai, porque a física é a
         * de todo mundo; quando volta ao controle, sobe de novo. Esse vaivém É
         * o boneco de pancada que o pedido descreve, e ele não custou uma linha
         * de máquina de estados: custou não pedir mais nada.
         *
         * O ganho de 0,8 é o que separa "sobe" de "salta": ele volta em alguns
         * segundos, devagar, que é o tempo de quem está treinando recarregar. */
        const cota = ctx.field.heightAt(bot.position.x, bot.position.z) + NAMEK.bot.alturaTreino;
        dv.y = clamp((cota - bot.position.y) * 0.8, -NAMEK.fighter.climbSpeed, NAMEK.fighter.climbSpeed);
        break;
      }

      default: {
        /* PROCURAR. Vagar em direção a um ponto sorteado na clareira — e não
           parar no meio dela: quinze bots sem alvo, todos parados no centro,
           seria o cardume que a repulsão existe para evitar. */
        if (!bot.destino || dist2D(bot.position, bot.destino) < 45) {
          const a = Math.random() * TAU;
          const r = 60 + Math.random() * 380;
          bot.destino = { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 70 + Math.random() * 160 };
        }
        const f = versor(
          bot.destino.x - bot.position.x,
          bot.destino.y - bot.position.y,
          bot.destino.z - bot.position.z,
        );
        const v = NAMEK.fighter.flySpeed * 0.8;
        dv.x = f.x * v;
        dv.y = f.y * v;
        dv.z = f.z * v;
        break;
      }
    }

    return dv;
  }

  /**
   * A repulsão mútua. §9.4 do plano.
   *
   * Sem ela, quinze bots que perseguem o mesmo alvo convergem para o mesmo
   * ponto do espaço e viram um CARDUME — que, além de feio, é um alvo só: um
   * Kamehameha levaria a sala inteira. Ela é somada ao desejo ANTES da
   * perseguição de velocidade, então compõe com a manobra em vez de brigar com
   * ela: o bot continua orbitando, só que num lugar que ninguém mais ocupa.
   */
  separar(bot, dv) {
    const R = NAMEK.bot.separation;
    for (const outro of this.list) {
      if (outro === bot || !outro.alive) continue;
      const dx = bot.position.x - outro.position.x;
      const dy = bot.position.y - outro.position.y;
      const dz = bot.position.z - outro.position.z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= R) continue;
      /* Quadrático perto de zero: dois bots colados se repelem com força, dois
         a 24 m mal se notam. Linear daria um empurrão constante que empurraria
         a formação inteira para fora da briga. */
      const k = (1 - d / R) ** 2;
      const inv = d > 1e-3 ? 1 / d : 0;
      const v = NAMEK.fighter.flySpeed * 1.15 * k;
      dv.x += dx * inv * v;
      dv.y += dy * inv * v + (d < 1e-3 ? v : 0);
      dv.z += dz * inv * v;
    }
  }

  /**
   * Do desejo à velocidade: teto, borda macia, relevo e a perseguição.
   *
   * É aqui que as três paredes do mundo entram, e todas as três são MACIAS —
   * nenhuma delas para o lutador, todas empurram. Ver §2 do plano para por que
   * a borda é assim, e o mesmo argumento vale para o teto e para o chão: o que
   * mata a sensação de voo é bater em coisa invisível.
   */
  conduzir(bot, dv, ctx, dt) {
    const W = NAMEK.world;
    const p = bot.position;

    /* A BORDA, decidida antes de sofrida. O freio do mundo continua existindo
       (ver `integrar`), mas um bot que só descobre a borda quando é freado
       passa metade da partida sendo arrastado de volta. Ele vira antes. */
    const d = Math.hypot(p.x, p.z);
    if (d > W.softEdge.start - 90) {
      const f = clamp((d - (W.softEdge.start - 90)) / 90, 0, 1);
      const inv = d > 1e-3 ? 1 / d : 0;
      dv.x = dv.x * (1 - f) - p.x * inv * NAMEK.fighter.flySpeed * f;
      dv.z = dv.z * (1 - f) - p.z * inv * NAMEK.fighter.flySpeed * f;
    }

    /* O TETO, pela mesma lógica. */
    if (p.y > W.ceiling - 60) {
      const f = clamp((p.y - (W.ceiling - 60)) / 60, 0, 1);
      dv.y = Math.min(dv.y, 0) - f * NAMEK.fighter.climbSpeed;
    }

    /* O RELEVO, COM ANTEVISÃO — e é este bloco que responde ao "não ficam
       presos em montanha".
       Olhar só o chão debaixo dos pés faz o bot subir a encosta rente à rocha e
       enfiar o nariz na parede da montanha, porque quando ele percebe a subida
       já está dentro dela. Olhando 0,45 s e 1,1 s à frente ao longo da própria
       velocidade, ele começa a subir ANTES do sopé — que é o que um piloto faz. */
    const piso = this.pisoSeguro(bot, ctx.field);
    if (p.y < piso) {
      dv.y = Math.max(dv.y, (piso - p.y) * 2.4);
    }

    /* O "VOA MAIS DEVAGAR" do pedido, e ele mora aqui — no ALVO de velocidade,
       não na aceleração. Cortar a aceleração daria um bot que demora a chegar à
       mesma velocidade de sempre, o que lê como lentidão de rede; cortando o
       alvo, ele se move devagar e continua respondendo na hora. É a mesma
       distinção que a guarda do jogador faz, e pelo mesmo motivo.
       A cota vertical do alvo de treino é a única que NÃO escala: `mover` vale
       zero nele, e zerar a subida o deixaria caído no chão para sempre. */
    const mult = this.dif.mover;
    if (bot.estado === "treino") {
      /* O ALVO DE TREINO não anda de lado — nem pela repulsão dos vizinhos, nem
         pela antevisão de relevo, nem pela borda. Zerar aqui, DEPOIS de todas
         elas, é o que garante o "não fica se mexendo muito" contra qualquer
         termo que alguém venha a somar amanhã. A vertical fica: é ela que o faz
         subir de volta depois de apanhar. */
      dv.x = 0;
      dv.z = 0;
      bot.boost = false;
    } else if (mult !== 1) {
      dv.x *= mult;
      dv.y *= mult;
      dv.z *= mult;
      if (mult < 0.6) bot.boost = false;
    }

    const accel = bot.boost ? NAMEK.fighter.boostAccel : NAMEK.fighter.airAccel;
    if (bot.carregando) {
      /* Carregar TRAVA o lutador. Frear rápido (e não instantaneamente) é o que
         faz a pose de carga começar com o corpo ainda deslizando um pouco —
         parar no ar de uma vez lê como pausa de emulador. */
      bot.velocity.x = damp(bot.velocity.x, 0, 6, dt);
      bot.velocity.y = damp(bot.velocity.y, 0, 6, dt);
      bot.velocity.z = damp(bot.velocity.z, 0, 6, dt);
      return;
    }
    bot.velocity.x = damp(bot.velocity.x, dv.x, accel, dt);
    bot.velocity.y = damp(bot.velocity.y, dv.y, accel, dt);
    bot.velocity.z = damp(bot.velocity.z, dv.z, accel, dt);
  }

  /** A cota mínima de voo aqui e logo à frente, com folga de cruzeiro. */
  pisoSeguro(bot, field) {
    const p = bot.position;
    let h = field.heightAt(p.x, p.z);
    for (const t of [0.45, 1.1]) {
      const hx = field.heightAt(p.x + bot.velocity.x * t, p.z + bot.velocity.z * t);
      if (hx > h) h = hx;
    }
    return h + FOLGA_VOO;
  }

  /**
   * Integração explícita. **Sem Rapier** — §4 do plano.
   *
   * Vinte linhas para: andar, ser freado pela borda, ser cortado pelo teto e
   * não atravessar o chão. Determinístico, de custo constante e sem uma única
   * superfície de contato com o mundo de física do jogo do arqueiro.
   */
  integrar(bot, dt, field) {
    const W = NAMEK.world;
    const p = bot.position;
    const v = bot.velocity;

    /* A BARREIRA MACIA, como o `NAMEK.world.softEdge` a descreve: um puxão
       proporcional ao excesso. Quem luta nunca descobre que ela existe. */
    const d = Math.hypot(p.x, p.z);
    if (d > W.softEdge.start) {
      const a = W.softEdge.pull * (d - W.softEdge.start) * dt;
      const inv = 1 / d;
      v.x -= p.x * inv * a;
      v.z -= p.z * inv * a;
    }

    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;

    if (p.y > W.ceiling) {
      p.y = W.ceiling;
      if (v.y > 0) v.y = 0;
    }

    const chao = field.heightAt(p.x, p.z);
    const minimo = chao + (bot.alive ? FOLGA_DURA : NAMEK.fighter.radius);
    if (p.y < minimo) {
      p.y = minimo;
      if (v.y < 0) v.y = 0;
    }
    /* O mar não é chão: quem cair abaixo do nível dele é erguido de volta. Sem
       isto um bot com a velocidade errada afundaria no oceano da borda e ficaria
       ali, vivo, sem nunca mais ver ninguém. */
    if (p.y < W.seaLevel + 2) p.y = W.seaLevel + 2;
  }

  /* ---------------------------------------------------------------- a pose -- */

  pose(bot, alvo, dt) {
    const v = bot.velocity;
    const vel = Math.hypot(v.x, v.y, v.z);

    /* Encara o ALVO quando está brigando, e o rumo quando está indo. Um lutador
       que voa de lado olhando para onde atira é exatamente a leitura do BT3; um
       que olha sempre para a frente vira um avião. */
    let yawAlvo = bot.yaw;
    let pitchAlvo = 0;
    if (alvo && (bot.estado === "atacar" || bot.estado === "carregar")) {
      const dx = alvo.x - bot.position.x;
      const dy = alvo.y + NAMEK.fighter.chest - (bot.position.y + NAMEK.fighter.chest);
      const dz = alvo.z - bot.position.z;
      yawAlvo = Math.atan2(-dx, -dz);
      pitchAlvo = Math.atan2(dy, Math.max(1e-3, Math.hypot(dx, dz)));
    } else if (vel > 1.5) {
      yawAlvo = Math.atan2(-v.x, -v.z);
      pitchAlvo = Math.atan2(v.y, Math.max(1e-3, Math.hypot(v.x, v.z)));
    }

    const antes = bot.yaw;
    bot.yaw = angDamp(bot.yaw, yawAlvo, 9, dt);
    /* O YAW VIAJA DOBRADO EM [−π, π].
     *
     * `angDamp` persegue pelo caminho curto mas nunca redobra o resultado, e um
     * lutador que gira sempre para o mesmo lado sai de 3 e chega a 40 rad em
     * poucos minutos — o mesmo ângulo, escrito com o dobro de dígitos, vinte
     * vezes por segundo, e com precisão pior a cada volta. Dobrar aqui cria uma
     * descontinuidade em ±π, e ela é de graça: quem interpola ângulo de rede
     * tem de fazê-lo pelo arco curto de qualquer jeito — a pose de um humano
     * girando também salta. */
    if (bot.yaw > Math.PI) bot.yaw -= TAU;
    else if (bot.yaw < -Math.PI) bot.yaw += TAU;
    bot.pitch = damp(bot.pitch, clamp(pitchAlvo, -1.2, 1.2), 8, dt);

    /* A ROLAGEM sai do giro, e não de uma decisão: o corpo inclina PARA DENTRO
       da curva na proporção de quanto virou neste passo. É o campo `r` do
       `packFighter`, e sem ele o voo fica de trilho — o comentário do protocolo
       diz exatamente isso. */
    let giro = bot.yaw - antes;
    while (giro > Math.PI) giro -= TAU;
    while (giro < -Math.PI) giro += TAU;
    const rollAlvo = clamp((giro / Math.max(dt, 1e-3)) * 0.22, -0.75, 0.75);
    bot.roll = damp(bot.roll, rollAlvo, 6, dt);

    bot.flyBlend = damp(bot.flyBlend, 1, 5, dt);
    bot.runBlend = damp(bot.runBlend, 0, 5, dt);
    bot.boostBlend = damp(bot.boostBlend, bot.boost ? 1 : 0, 7, dt);
    bot.chargeBlend = damp(bot.chargeBlend, bot.carregando ? 1 : 0, 8, dt);
    /* A MARCHA só anda no CHÃO, e por isso ela zera aqui em vez de girar
       eternamente: um lutador voando não tem passada, e a fase é um número de
       0 a 6,283 com três decimais que viajaria em todo quadro de 20 Hz para
       alimentar uma animação que ninguém está vendo. Zerada, ela vira o padrão
       e some da mensagem — ver `podar` em `room.js`. */
    const pe = 1 - bot.flyBlend;
    bot.gaitPhase = pe > 0.02 ? (bot.gaitPhase + vel * dt * 0.35 * pe) % TAU : 0;
  }

  /* ------------------------------------------------------------- a rajada -- */

  talvezAtirar(bot, alvo, ctx) {
    /* `rajada` zerada = alvo de treino: ele não revida, nunca. */
    if (this.dif.rajada <= 0) return;
    if (bot.recarga > 0 || bot.carregando) return;
    if (!alvo.alive || alvo.invuln) return;

    const dx = alvo.x - bot.position.x;
    const dy = alvo.y + NAMEK.fighter.chest - (bot.position.y + NAMEK.fighter.chest);
    const dz = alvo.z - bot.position.z;
    const d = Math.hypot(dx, dy, dz);
    /* Alcance útil da bola: velocidade × vida. Atirar além disso é gastar ki
       para ver a bola sumir no meio do caminho. */
    if (d > NAMEK.blast.speed * NAMEK.blast.life * 0.82) return;

    /* O ESPECIAL primeiro, se a hora é essa. */
    if (this.talvezEspecial(bot, alvo, d, ctx)) return;
    /* Barra cheia guardada: ele não gasta a última lasca em rajada, porque
       gastar significa perder o especial que está a poucos segundos de sair. */
    if (this.guardandoBarra(bot, d)) return;

    /* Uma RESERVA de ki, e ela é o que distingue um bot bom de um bot que fica
       sem fôlego: gastar até o último ponto é chegar na próxima esquiva sem
       arranque. Ele para de atirar com 12 na barra, não com 2. */
    if (bot.ki < NAMEK.ki.blastCost + 10) return;

    /* Só atira o que está razoavelmente à frente. Um lutador que dispara para
       trás por cima do ombro pode ser Dragon Ball, mas com quinze bots vira
       fogo cruzado sem leitura nenhuma. */
    const frente = { x: -Math.sin(bot.yaw), y: Math.sin(bot.pitch), z: -Math.cos(bot.yaw) };
    const cos = (frente.x * dx + frente.y * dy + frente.z * dz) / Math.max(d, 1e-3);
    if (cos < 0.82) return;

    if (!ctx.gastar(bot, NAMEK.ki.blastCost)) return;

    /* A CADÊNCIA escalada pela dificuldade — é o "não solta tantos poderes" na
       parte mais visível dele. No fácil ele atira a 40 %, ou seja, uma bola a
       cada 0,4 s em vez de a cada 0,17: dá para ver cada uma sair e desviar. */
    bot.recarga = 1 / (NAMEK.blast.rate * this.dif.rajada);
    bot.lastHand = bot.lastHand === 0 ? 1 : 0;
    bot.handPose = 1;
    bot.tiros++;
    this.atirar(bot, alvo, d, ctx);
  }

  /**
   * A bola sai. **O erro mora aqui, e só aqui.**
   *
   * A antecipação (`lead`) é exata: o bot calcula onde o alvo estará quando a
   * bola chegar. Depois disso o disparo é girado por um ângulo sorteado dentro
   * do cone de erro da perícia. É a ordem que importa — decidir certo e mirar
   * errado. Trocar as duas coisas (mirar certo e decidir errado) dá um bot que
   * acerta sempre e faz besteira, que é a combinação que ninguém acha divertida.
   */
  atirar(bot, alvo, d, ctx) {
    const voo = d / NAMEK.blast.speed;
    const ax = alvo.x + alvo.vx * voo;
    const ay = alvo.y + NAMEK.fighter.chest + alvo.vy * voo;
    const az = alvo.z + alvo.vz * voo;

    const ox = bot.position.x + Math.cos(bot.yaw) * NAMEK.blast.handOffset * (bot.lastHand ? 1 : -1);
    const oy = bot.position.y + NAMEK.fighter.chest;
    const oz = bot.position.z - Math.sin(bot.yaw) * NAMEK.blast.handOffset * (bot.lastHand ? 1 : -1);

    let dir = versor(ax - ox, ay - oy, az - oz);
    /* O ERRO DE MIRA multiplicado pela dificuldade — o "ele também erra mais
       poderes" do pedido. No fácil são 3,4 vezes o erro natural dele. */
    dir = desviar(dir, bot.erroMira * this.dif.erro * RAD);

    const bola = {
      id: proximaBola++,
      dono: bot.id,
      x: ox, y: oy, z: oz,
      dx: dir.x, dy: dir.y, dz: dir.z,
      alvo: alvo.id,
      t: 0,
      vida: NAMEK.blast.life,
      velocidade: NAMEK.blast.speed,
      raio: NAMEK.blast.hitRadius,
      dano: NAMEK.blast.damage,
      poder: NAMEK.blast.power,
      fantasma: false,
      persegue: true,
    };
    this.bolas.push(bola);

    ctx.emitir({
      tipo: "rajada",
      dono: bot.id,
      id: bola.id,
      o: [ox, oy, oz],
      d: [dir.x, dir.y, dir.z],
      hand: bot.lastHand,
      alvo: alvo.id,
    });
  }

  /* ------------------------------------------------------------ o especial -- */

  /**
   * A barra está cheia e o alvo está perto e exposto? Então é agora.
   *
   * Três condições, e nenhuma delas é sorte: barra CHEIA (§5 — o especial só sai
   * com o ki no topo), alvo a menos de 90 m, e visada livre de relevo. A
   * terceira é a que evita o cômico: um bot gastando a partida inteira de ki
   * para esculpir uma montanha.
   */
  talvezEspecial(bot, alvo, d, ctx) {
    if (this.dif.especial <= 0) return false; // alvo de treino não revida
    if (bot.especial) return false;
    if (bot.ki < NAMEK.ki.max * NAMEK.ki.specialThreshold) return false;
    /* A JANELA DE DISTÂNCIA também aperta com o nível, e ela é o que finalmente
     * fez a conta bater.
     *
     * Medido: mesmo com carência e sem guardar a barra, o nível fácil ainda
     * soltava o DOBRO de especiais do difícil. O motivo é que ele MORRE muito
     * mais (não desvia), e quem renasce volta com a barra cheia — cada morte
     * era um especial de graça, e no fácil as mortes são o que mais acontece.
     *
     * Apertar a janela resolve pelo comportamento, e não por mais um relógio:
     * um lutador fraco só tenta o golpe grande quando o adversário está bem na
     * frente dele. No fácil a janela fecha em 53 m — abaixo dos 55 m em que ele
     * orbita —, então ele só arrisca quando a briga fecha de verdade. */
    const janela = 90 * (0.5 + 0.5 * this.dif.especial);
    if (d > janela || d < 12) return false;
    /* A CARÊNCIA ENTRE ESPECIAIS, pela dificuldade — e ela é um RELÓGIO, não um
     * sorteio. A primeira versão sorteava `Math.random() < dif.especial` aqui, e
     * o banco de provas mostrou o resultado exatamente ao contrário do
     * pretendido: **77 especiais no nível fácil contra 11 no difícil.**
     *
     * O motivo é uma armadilha que vale escrever, porque ela aparece toda vez
     * que se põe uma probabilidade num caminho quente. `talvezAtirar` é chamada
     * a cada quadro em que o bot está atacando; quando ele está com a barra
     * cheia, `guardandoBarra` o impede de gastar em rajada, então `recarga`
     * nunca é armada e ele cai aqui VINTE VEZES POR SEGUNDO. Uma chance de 18 %
     * por tentativa, vinte vezes por segundo, é praticamente certeza em um
     * quarto de segundo — ou seja, quanto MENOR a probabilidade, mais parecido
     * com "sempre" ficava o resultado, porque o que mudava não era a frequência,
     * era só quantas vezes ele reperguntava.
     *
     * Um relógio não tem esse problema: no difícil ele é zero (nenhum limite
     * além do ki), no médio são ~3 s de espera entre um especial e o próximo, e
     * no fácil são ~23 s. É o "não solta tantos poderes" do pedido, medido em
     * segundos, que é a unidade em que o jogador sente. */
    if (bot.especialEm > 0) return false;

    const ox = bot.position.x;
    const oy = bot.position.y + NAMEK.fighter.chest;
    const oz = bot.position.z;
    const ax = alvo.x;
    const ay = alvo.y + NAMEK.fighter.chest;
    const az = alvo.z;
    if (bloqueadoPeloRelevo(ctx.field, ox, oy, oz, ax, ay, az)) return false;

    /* QUAL ESPECIAL. Só os dois feixes, e o disco de vez em quando.
     *
     * A Genki Dama fica de fora de propósito: 3,6 s de carga parado no meio de
     * quinze lutadores é morrer segurando a bola. Ela é a aposta de um HUMANO,
     * que tem leitura de sala para saber quando ninguém está olhando — um bot
     * que a usasse seria um bot que morre com a barra cheia, e o jogador leria
     * isso como burrice, não como ousadia. */
    const kind = d > 55 && Math.random() < 0.3 ? "disk" : Math.random() < 0.5 ? "kamehameha" : "galick";
    const info = specialInfo(kind);

    /* A direção é TRAVADA no disparo, como o protocolo manda: girar depois não
       entorta o feixe. A antecipação usa a velocidade do feixe, que é dez vezes
       a de uma bola — daí o erro de mira valer menos aqui, e ser justo que
       valha: um especial que erra por um triz depois de custar a barra inteira
       é frustrante para quem atira e ilegível para quem escapou. */
    const voo = d / info.speed;
    let dir = versor(
      alvo.x + alvo.vx * voo - ox,
      alvo.y + NAMEK.fighter.chest + alvo.vy * voo - oy,
      alvo.z + alvo.vz * voo - oz,
    );
    dir = desviar(dir, bot.erroMira * 0.4 * this.dif.erro * RAD);

    if (!ctx.gastar(bot, NAMEK.ki.max)) return false;

    bot.especial = {
      kind,
      info,
      dir,
      o: { x: ox, y: oy, z: oz },
      t: 0,
      /* NÃO é `windup + sustain`: ver `duracaoDaPose`. O disco e a esfera saem
         da mão e voam sozinhos — prender o lutador pela vida do projétil o
         deixava seis segundos parado no ar sem decidir nada. */
      dur: duracaoDaPose(info),
      saiu: false,
    };
    bot.specialIndex = Math.max(0, NAMEK.specialOrder.indexOf(kind));
    bot.specialFraction = 0;
    bot.especiais++;
    /* O relógio do PRÓXIMO. `1/especial - 1` é zero no difícil e cresce sem
       tabela extra: 0,6 dá 0,67 × BASE, e 0,18 dá 4,6 × BASE. */
    bot.especialEm = ESPECIAL_BASE * (1 / this.dif.especial - 1);

    ctx.emitir({
      tipo: "especial",
      dono: bot.id,
      kind,
      o: [ox, oy, oz],
      d: [dir.x, dir.y, dir.z],
    });
    return true;
  }

  /** O lutador durante o próprio especial: parado, apontado e comprometido. */
  passoDoEspecial(bot, dt, ctx) {
    const e = bot.especial;
    e.t += dt;
    bot.specialFraction = clamp(e.t / e.dur, 0, 1);

    /* Trava quase por completo. "Quase" e não "por completo" porque um corpo
       absolutamente imóvel no ar por três segundos parece um bug de rede; a
       deriva de meio metro por segundo é o que diz "ele está se segurando". */
    bot.velocity.x = damp(bot.velocity.x, 0, 4, dt);
    bot.velocity.y = damp(bot.velocity.y, 0, 4, dt);
    bot.velocity.z = damp(bot.velocity.z, 0, 4, dt);
    bot.yaw = angDamp(bot.yaw, Math.atan2(-e.dir.x, -e.dir.z), 8, dt);
    bot.pitch = damp(bot.pitch, Math.asin(clamp(e.dir.y, -1, 1)), 8, dt);
    bot.boostBlend = damp(bot.boostBlend, 0, 6, dt);
    bot.chargeBlend = damp(bot.chargeBlend, 0, 6, dt);
    bot.flyBlend = damp(bot.flyBlend, 1, 5, dt);

    /* O golpe NASCE ao fim da preparação, não no instante da decisão: é a
       janela em que ele está vulnerável, e é ela que dá ao adversário a chance
       de sair do eixo. */
    if (!e.saiu && e.t >= e.info.windup) {
      e.saiu = true;
      if (e.info.dps !== undefined) {
        this.feixes.push({
          dono: bot.id,
          kind: e.kind,
          info: e.info,
          ox: e.o.x, oy: e.o.y, oz: e.o.z,
          dx: e.dir.x, dy: e.dir.y, dz: e.dir.z,
          t: 0,
          dur: e.info.sustain,
          fantasma: false,
          crateraFeita: false,
        });
      } else {
        /* Disco e Genki Dama não sustentam: eles VOAM. Entram na mesma lista
           das bolas de ki, com raio, dano e potência próprios — um integrador
           só para tudo que se desloca. */
        this.bolas.push({
          id: proximaBola++,
          dono: bot.id,
          x: e.o.x, y: e.o.y, z: e.o.z,
          dx: e.dir.x, dy: e.dir.y, dz: e.dir.z,
          alvo: null,
          t: 0,
          vida: e.info.sustain,
          velocidade: e.info.speed,
          raio: e.info.hitRadius,
          dano: e.info.damage ?? 40,
          poder: e.info.power,
          fantasma: false,
          persegue: false,
        });
      }
    }

    if (e.t >= e.dur) {
      bot.especial = null;
      bot.specialIndex = -1;
      bot.specialFraction = 0;
      /* Sai do especial com a decisão em branco e a barra vazia: o estado
         seguinte vai ser `carregar`, que é exatamente o que deve ser. */
      bot.tDecisao = 0;
    }
  }

  /* ---------------------------------------------------------------- a onda -- */

  /**
   * A explosão de ki. Defesa de PRESSÃO, e é assim que o bot a usa.
   *
   * Ela não é um ataque: 12 de dano é menos que duas bolas. O que ela faz é
   * ABRIR ESPAÇO — quem está colado é empurrado 26 m/s para longe, e o bot que
   * estava sendo encurralado volta a ter a distância em que sabe brigar.
   */
  talvezOnda(bot, ctx) {
    if (this.dif.rajada <= 0) return; // alvo de treino não revida
    if (bot.ondaEm > 0 || !bot.alive || bot.carregando) return;
    if (bot.ki < NAMEK.ki.burstCost + 18) return;

    let perto = 0;
    for (const c of ctx.corpos) {
      if (c.id === bot.id || !c.alive) continue;
      const d = Math.hypot(c.x - bot.position.x, c.y - bot.position.y, c.z - bot.position.z);
      if (d < NAMEK.ki.burstRadius * 0.72) perto++;
    }
    if (!perto) return;
    if (!ctx.gastar(bot, NAMEK.ki.burstCost)) return;

    bot.ondaEm = 3.2;
    ctx.emitir({
      tipo: "onda",
      dono: bot.id,
      p: [bot.position.x, bot.position.y + NAMEK.fighter.chest, bot.position.z],
    });
  }

  /* ------------------------------------------------------------- as bolas -- */

  /**
   * Um passo de todas as bolas em voo.
   *
   * A perseguição fraca é a do §6.1, letra por letra: gira no máximo
   * `turnRate` graus por segundo, por no máximo `duration` segundos, e SÓ
   * enquanto o alvo estiver dentro do cone. O alvo foi escolhido no disparo e
   * nunca é reavaliado — bola que troca de alvo no meio do voo lê como bug.
   */
  passoDasBolas(dt, ctx) {
    const H = NAMEK.blast.homing;
    const cosCone = Math.cos(H.cone * RAD);
    const giroMax = H.turnRate * RAD * dt;
    const vivas = [];

    for (const b of this.bolas) {
      /* Ainda na mão de quem vai atirar. Só o fantasma de um especial alheio usa
         isto — ver `avisarEspecial` —, e é por isso que ele fica na lista sem
         andar: a ameaça precisa existir para o bot antes de existir no espaço. */
      if (b.espera > 0) {
        b.espera -= dt;
        vivas.push(b);
        continue;
      }
      b.t += dt;
      if (b.t > b.vida) continue;

      if (b.persegue && b.t < H.duration && b.alvo !== null) {
        const alvo = acharCorpo(ctx.corpos, b.alvo);
        if (alvo && alvo.alive) {
          const ax = alvo.x - b.x;
          const ay = alvo.y + NAMEK.fighter.chest - b.y;
          const az = alvo.z - b.z;
          const d = Math.hypot(ax, ay, az);
          if (d > 1e-3) {
            const ux = ax / d;
            const uy = ay / d;
            const uz = az / d;
            const cos = ux * b.dx + uy * b.dy + uz * b.dz;
            if (cos > cosCone) {
              /* Gira o VERSOR em direção ao alvo, com teto no ângulo do passo.
                 Interpolar e renormalizar dá exatamente isto para ângulos
                 pequenos, e um passo de 50 ms nunca produz um ângulo grande. */
              const ang = Math.min(Math.acos(clamp(cos, -1, 1)), giroMax);
              const g = versor(ux - b.dx * cos, uy - b.dy * cos, uz - b.dz * cos);
              const c = Math.cos(ang);
              const s = Math.sin(ang);
              b.dx = b.dx * c + g.x * s;
              b.dy = b.dy * c + g.y * s;
              b.dz = b.dz * c + g.z * s;
            }
          }
        }
      }

      const passo = b.velocidade * dt;
      const nx = b.x + b.dx * passo;
      const ny = b.y + b.dy * passo;
      const nz = b.z + b.dz * passo;

      if (!b.fantasma) {
        /* CORPOS primeiro, chão depois: uma bola que passa rente ao ombro de
           alguém e bate no morro logo atrás tem de matar a pessoa, não abrir
           cratera atrás dela. */
        const vitima = this.varrer(b, nx, ny, nz, ctx);
        if (vitima) {
          ctx.emitir({
            tipo: "acerto",
            dono: b.dono,
            vitima: vitima.id,
            dano: b.dano,
            p: [nx, ny, nz],
            d: [b.dx, b.dy, b.dz],
            kind: "blast",
          });
          continue;
        }
        /* O CHÃO. Duas amostras por passo: a 78 m/s a bola anda 3,9 m em 50 ms,
           e uma crista estreita cabe inteira entre dois quadros. */
        const meio = ctx.field.heightAt((b.x + nx) / 2, (b.z + nz) / 2);
        const fim = ctx.field.heightAt(nx, nz);
        if ((b.y + ny) / 2 <= meio || ny <= fim) {
          ctx.emitir({
            tipo: "chao",
            dono: b.dono,
            p: [nx, Math.max(ny, fim), nz],
            poder: b.poder,
          });
          continue;
        }
      } else if (fora(nx, ny, nz)) {
        continue;
      }

      b.x = nx;
      b.y = ny;
      b.z = nz;
      vivas.push(b);
    }

    this.bolas = vivas;
  }

  /** Quem esta bola atravessou neste passo. Ver `distSeg` para a conta. */
  varrer(b, nx, ny, nz, ctx) {
    const alcance = b.raio + NAMEK.fighter.radius;
    let melhor = null;
    let melhorD = Infinity;
    for (const c of ctx.corpos) {
      if (c.id === b.dono || !c.alive || c.invuln) continue;
      /* Rejeição barata antes da conta cara: quem está a 200 m não precisa de
         distância ponto-segmento para ser descartado. */
      if (Math.abs(c.x - b.x) > 250 || Math.abs(c.z - b.z) > 250) continue;
      const d = distSeg(
        c.x, c.y + NAMEK.fighter.chest, c.z,
        b.x, b.y, b.z,
        nx, ny, nz,
      );
      if (d <= alcance && d < melhorD) {
        melhorD = d;
        melhor = c;
      }
    }
    return melhor;
  }

  /* ------------------------------------------------------------ os feixes -- */

  /**
   * Um passo dos feixes sustentados.
   *
   * O feixe não é um projétil: ele é um SEGMENTO que existe por
   * `info.sustain` segundos e cobra por tempo de exposição. A frente avança a
   * `info.speed` até o alcance ou até o relevo — quem está atrás do ponto de
   * impacto ainda não está sendo queimado, e essa diferença é visível a olho.
   */
  passoDosFeixes(dt, ctx) {
    const vivos = [];
    for (const f of this.feixes) {
      f.t += dt;
      if (f.t > f.dur) continue;

      const frente = Math.min(f.info.range, f.info.speed * f.t);
      const fim = this.pontaDoFeixe(f, frente, ctx.field);

      if (!f.fantasma) {
        if (!f.crateraFeita && fim.chao) {
          f.crateraFeita = true;
          ctx.emitir({ tipo: "chao", dono: f.dono, p: [fim.x, fim.y, fim.z], poder: f.info.power });
        }
        for (const c of ctx.corpos) {
          if (c.id === f.dono || !c.alive || c.invuln) continue;
          const d = distSeg(
            c.x, c.y + NAMEK.fighter.chest, c.z,
            f.ox, f.oy, f.oz,
            fim.x, fim.y, fim.z,
          );
          if (d > f.info.hitRadius + NAMEK.fighter.radius) continue;
          ctx.emitir({
            tipo: "acerto",
            dono: f.dono,
            vitima: c.id,
            dano: f.info.dps * dt,
            p: [c.x, c.y + NAMEK.fighter.chest, c.z],
            d: [f.dx, f.dy, f.dz],
            kind: f.kind,
          });
        }
      }
      vivos.push(f);
    }
    this.feixes = vivos;
  }

  /** Onde o feixe termina: no alcance atual, ou no relevo, o que vier antes. */
  pontaDoFeixe(f, frente, field) {
    const N = 14;
    for (let i = 1; i <= N; i++) {
      const t = (frente * i) / N;
      const x = f.ox + f.dx * t;
      const y = f.oy + f.dy * t;
      const z = f.oz + f.dz * t;
      if (field.heightAt(x, z) >= y) return { x, y, z, chao: true };
    }
    return {
      x: f.ox + f.dx * frente,
      y: f.oy + f.dy * frente,
      z: f.oz + f.dz * frente,
      chao: false,
    };
  }
}

/* ---------------------------------------------------------------- auxiliares */

/* s — a carência-base entre dois especiais do mesmo bot, antes de a dificuldade
   multiplicá-la. Ver `talvezEspecial`: no difícil ela vale zero (o único limite
   é o ki), e é `1/especial - 1` que a estica nos níveis mansos. Cinco segundos
   é a ordem de grandeza do tempo que a barra leva para encher — ou seja, no
   médio a espera fica logo acima do ritmo natural do golpe, e no fácil bem
   além dele. */
const ESPECIAL_BASE = 5;

/* s — teto de tempo caindo depois de ser derrubado no ar. O mesmo número e o
   mesmo motivo do `QUEDA_MAX` de `src/namek/movement.js`: a queda do teto de
   voo cabe nele, e ele existe para que "sem controle" nunca vire "sem controle
   para sempre" — derrubado sobre o oceano, o chão não chega nunca. */
const QUEDA_MAX = 9;

/** m — folga de cruzeiro sobre o relevo. É onde o bot QUER voar. */
const FOLGA_VOO = 9;
/** m — folga que ele nunca fura. É a colisão de verdade. */
const FOLGA_DURA = 2.4;

function versor(x, y, z) {
  const d = Math.hypot(x, y, z);
  if (d < 1e-6) return { x: 0, y: 0, z: 1 };
  return { x: x / d, y: y / d, z: z / d };
}

function normalizar(x, y, z) {
  const d = Math.hypot(x, y, z);
  if (!Number.isFinite(d) || d < 1e-6) return null;
  return { x: x / d, y: y / d, z: z / d };
}

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function acharCorpo(corpos, id) {
  for (let i = 0; i < corpos.length; i++) if (corpos[i].id === id) return corpos[i];
  return null;
}

function fora(x, y, z) {
  const W = NAMEK.world;
  return x * x + z * z > (W.radius + 60) ** 2 || y > W.ceiling + 60 || y < W.seaLevel - 40;
}

/**
 * Gira um versor por um ângulo sorteado dentro de um cone.
 *
 * O sorteio é uniforme em ÁREA do cone (`√u`), e não no ângulo: sorteando o
 * ângulo direto, metade dos tiros cairia no miolo do cone e a mira ficaria
 * melhor do que a perícia mandou. É a mesma correção de `pickSpawn`, e pela
 * mesma razão geométrica.
 */
function desviar(dir, cone) {
  if (cone <= 1e-4) return dir;
  const ang = cone * Math.sqrt(Math.random());
  const gira = Math.random() * TAU;
  /* Uma base perpendicular qualquer: cruza com o eixo menos alinhado com `dir`,
     que é o jeito de nunca cruzar dois vetores paralelos. */
  const eixo = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = versor(
    dir.y * eixo.z - dir.z * eixo.y,
    dir.z * eixo.x - dir.x * eixo.z,
    dir.x * eixo.y - dir.y * eixo.x,
  );
  const v = {
    x: dir.y * u.z - dir.z * u.y,
    y: dir.z * u.x - dir.x * u.z,
    z: dir.x * u.y - dir.y * u.x,
  };
  const s = Math.sin(ang);
  const c = Math.cos(ang);
  const cg = Math.cos(gira);
  const sg = Math.sin(gira);
  return versor(
    dir.x * c + (u.x * cg + v.x * sg) * s,
    dir.y * c + (u.y * cg + v.y * sg) * s,
    dir.z * c + (u.z * cg + v.z * sg) * s,
  );
}

/**
 * Para onde sair de uma coisa que vem na direção `d`. **Nunca para trás.**
 *
 * O resultado é sempre PERPENDICULAR a `d` — é a garantia mecânica do §9.2, e
 * ela é dada pela construção e não pela boa vontade: o vetor devolvido é uma
 * combinação de dois versores ortogonais a `d`, então a componente ao longo de
 * `d` é exatamente zero. Não há como esta função devolver "recue".
 *
 * O SINAL de cada componente é o que já estava acontecendo: se o bot já está um
 * pouco à esquerda do eixo, ele sai mais para a esquerda. Escolher o lado
 * contrário o mandaria cruzar a trajetória — que é o pior lugar do mapa.
 */
function direcaoDeEsquiva(dx, dy, dz, rx, ry, rz) {
  const cima = Math.abs(dy) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const lat = versor(dy * cima.z - dz * cima.y, dz * cima.x - dx * cima.z, dx * cima.y - dy * cima.x);
  const vert = versor(dy * lat.z - dz * lat.y, dz * lat.x - dx * lat.z, dx * lat.y - dy * lat.x);
  /* `r` aponta da ameaça para o bot; a projeção dele em cada eixo diz de que
     lado ele já está. O sinal zero (bot exatamente no eixo) cai para +1, que é
     tão bom quanto −1 e não precisa de sorteio. */
  const sl = lat.x * -rx + lat.y * -ry + lat.z * -rz <= 0 ? 1 : -1;
  const sv = vert.x * -rx + vert.y * -ry + vert.z * -rz <= 0 ? 1 : -1;
  return versor(
    lat.x * sl * 0.82 + vert.x * sv * 0.57,
    lat.y * sl * 0.82 + vert.y * sv * 0.57,
    lat.z * sl * 0.82 + vert.z * sv * 0.57,
  );
}

/**
 * Onde pôr um lutador novo: longe de todo mundo, no ar.
 *
 * Vinte sorteios e o melhor deles. `pickSpawn` do campo já garante chão
 * caminhável (nem mar, nem parede de montanha); o que falta é a distância, e
 * ela é o que impede o recém-nascido de aparecer dentro de uma briga que já
 * estava acontecendo.
 */
export function melhorNascimento(field, ocupados = []) {
  let melhor = null;
  let melhorD = -1;
  for (let i = 0; i < 20; i++) {
    const p = field.pickSpawn();
    let d = Infinity;
    for (const o of ocupados) d = Math.min(d, Math.hypot(p.x - o.x, p.z - o.z));
    if (d > melhorD) {
      melhorD = d;
      melhor = p;
    }
  }
  const p = melhor ?? { x: 0, z: 0, y: field.heightAt(0, 0) };
  return { x: p.x, y: p.y + NAMEK.respawn.dropHeight, z: p.z };
}
