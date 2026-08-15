/* ---------------------------------------------------------------------------
   Namekusei — todas as constantes, num arquivo só.

   PURO: nada de Three.js, nada de Rapier, nada de DOM. O servidor importa este
   mesmo arquivo para mover bots, cobrar ki e dimensionar cratera, e ele roda em
   Node. É a mesma divisão que `shared/terrainField.js` já faz do lado do
   arqueiro, e pela mesma razão.

   NÃO é uma extensão de `src/config.js`, e isso é deliberado. Aquele arquivo é
   do jogo de arco e flecha; encostar nele para acomodar um modo de voo seria a
   primeira das mil linhas que acabam mudando o comportamento do vale. Ver §0 e
   §11 de `docs/plano-namekusei.md`.

   Toda grandeza está em SI — metro, segundo, m/s — como no resto do projeto.
   --------------------------------------------------------------------------- */

export const NAMEK = {
  /* ------------------------------------------------------------------ mundo */
  world: {
    /* m — raio da arena.
     *
     * Era 900. Caiu para 460 junto com a troca do relevo: o terreno agora é o
     * da fase Sandbox multiplicado por dez (ver `NamekField.baseHeight`), e
     * dez vezes 46 m são estes 460. Espaço para voar continua sendo o pedido
     * do §2 — o que mudou é que o mapa inteiro passou a caber dentro do
     * alcance dos golpes, que é o que torna montanha um alvo e não cenário. */
    radius: 460,
    /** m — teto de voo. Acima disto a subida é cortada, sem parede visível. */
    ceiling: 520,
    /** m — nível do mar. O terreno mergulha nele na borda da arena. */
    seaLevel: -8,
    /** Semente do relevo. Fixa: o planeta é o mesmo em todas as máquinas. */
    seed: 20030711,

    /* A BARREIRA É MACIA, e isso é decisão de jogo, não de física.
     *
     * Uma parede dura a 900 m para um lutador a 95 m/s é uma batida seca a cada
     * perseguição — e perseguir é metade do modo. O que existe aqui é um freio
     * que cresce: passou do raio, ganha uma aceleração de volta proporcional à
     * distância excedida. Quem tenta fugir sente o planeta puxando; quem está
     * lutando nunca descobre que a borda existe. */
    softEdge: {
      /** m — onde o freio começa a agir. Acompanhou o raio 900 → 460. */
      start: 420,
      /** 1/s² — força do puxão por metro excedido. */
      pull: 0.9,
    },
  },

  /* ------------------------------------------------------------------- clima
     Dois climas: o dia de Namekusei e o planeta indo embora. Ver §1 do plano. */
  weather: {
    /** Os ids válidos. A sala manda um deles; o cliente pinta. */
    ids: ["dia", "tempestade"],
    padrao: "dia",
    /* s — a tempestade não é um interruptor, é uma TRANSIÇÃO. Céu, névoa, luz e
       cor do mar cruzam em oito segundos; virar de uma vez lê como troca de
       cenário, não como um planeta morrendo. */
    fade: 8,
    tempestade: {
      /** s — intervalo médio entre raios. Sorteado em torno disto. */
      raioIntervalo: 3.4,
      /** s — quanto dura o clarão de um raio. */
      raioFlash: 0.18,
      /** m/s² — amplitude do tremor de câmera no auge. */
      tremor: 0.55,
    },
  },

  /* ---------------------------------------------------------------- lutador */
  fighter: {
    /** m — altura da cápsula, do pé ao topo da cabeça. */
    height: 1.78,
    /** m — raio da cápsula. É também o alvo que os projéteis testam. */
    radius: 0.46,
    /** m — altura do centro de massa acima dos pés. Onde o dano é marcado. */
    chest: 1.15,

    /* --------------------------------------------------------------- chão -- */
    /** m/s — caminhada. */
    walkSpeed: 5.2,
    /** m/s — corrida no chão. */
    runSpeed: 13.5,
    /** 1/s — quão rápido a velocidade horizontal persegue a desejada, no chão. */
    groundAccel: 12,
    /** m/s — salto que também é a decolagem. */
    jumpSpeed: 9.5,
    /** m/s² — gravidade. Namekusei é maior que a Terra, e pesa um pouco mais. */
    gravity: -11.4,

    /* ---------------------------------------------------------------- voo --
     *
     * O pedido é explícito: "agilidade no voo", "não deve ser travado e lento".
     * Os números abaixo são a diferença entre um simulador e o BT3 — lá o
     * lutador vira num piscar e a aceleração é quase instantânea. */
    /** m/s — voo normal, com direção livre. */
    flySpeed: 34,
    /** m/s — arranque com ki (o boost). Quase o triplo do voo normal. */
    boostSpeed: 96,
    /** 1/s — perseguição da velocidade desejada no ar. Alto de propósito. */
    airAccel: 9.5,
    /** 1/s — a mesma coisa durante o boost: ainda mais direto. */
    boostAccel: 14,
    /** m/s — subida e descida verticais puras (teclas de altura). */
    climbSpeed: 26,
    /** s — atraso entre soltar o boost e voltar à velocidade de cruzeiro. */
    boostTail: 0.35,

    /* ------------------------------------------------------------ atrito --- */
    /** 1/s — amortecimento no ar quando não há entrada. Baixo: ele DERRAPA. */
    airDrag: 1.35,
    /** 1/s — amortecimento no chão sem entrada. Alto: ele PARA. */
    groundDrag: 9,

    /* -------------------------------------------------------------- dano --- */
    /** Vida cheia. */
    maxHealth: 100,
    /** m/s — acima disto, cair no chão machuca. */
    fallSafe: 34,
    /** dano por (m/s) acima do limite seguro. */
    fallDamage: 1.15,
    /** s — quanto o lutador fica sem controle depois de levar knockback forte. */
    stunTime: 0.55,
  },

  /* --------------------------------------------------------------------- ki
     A economia inteira do modo. Ver §5 do plano — em especial por que o
     ESPECIAL exige barra cheia e a rajada básica não. */
  ki: {
    max: 100,
    /** por segundo, segurando o botão de carga. ~2,6 s para encher do zero. */
    chargeRate: 38,
    /** por segundo, regeneração passiva. Existe para ninguém ficar preso em 0. */
    idleRegen: 3.2,
    /** s — atraso depois de gastar ki antes de a regeneração passiva voltar. */
    idleDelay: 1.6,
    /** por segundo, durante o arranque com ki. */
    boostDrain: 14,
    /** por bola da rajada básica. */
    blastCost: 2,
    /** por explosão de ki (a onda de empurrão). */
    burstCost: 25,
    /** m — raio da onda de empurrão. */
    burstRadius: 14,
    /** m/s — empurrão no centro da onda, caindo até a borda. */
    burstPush: 26,
    /** dano da onda no centro. É defesa, não ataque: machuca pouco. */
    burstDamage: 12,
    /** Fração da barra que um ESPECIAL exige — 1 é a barra inteira. */
    specialThreshold: 1,
  },

  /* --------------------------------------------------------------- projéteis */
  blast: {
    /** m/s — velocidade da bola de ki. */
    speed: 78,
    /** s — vida máxima antes de sumir sozinha. */
    life: 2.6,
    /** m — raio visual da bola. */
    radius: 0.42,
    /** m — raio de acerto (mais generoso que o visual, como todo jogo faz). */
    hitRadius: 1.5,
    /** dano por bola. */
    damage: 6,
    /** por segundo — cadência segurando o botão. Uma mão de cada vez. */
    rate: 6,
    /** m — deslocamento lateral da mão que atira, no espaço do lutador. */
    handOffset: 0.52,
    /* Potência para a cratera. Baixa de propósito: 0,12 dá um arranhão de 4 m
       (`craterFor`), e é o que se quer — a rajada é o tiro COMUM, sai seis vezes
       por segundo, e se cada bola abrisse a cratera de 7 m que a potência 1 abre,
       trinta segundos de tiroteio deixariam a clareira com cara de queijo suíço
       e o teto de 96 crateras seria gasto inteiro em quinze segundos. */
    power: 0.12,

    /* A PERSEGUIÇÃO FRACA. Ver §6.1 do plano — "levemente" é o requisito, e
       cada número aqui existe para segurar a palavra "levemente". */
    /* A CORREÇÃO TOTAL PRECISA SER MENOR QUE O CONE. É a regra inteira, e ela
     * estava invertida.
     *
     * `turnRate × duration` é quanto a bola pode girar na vida dela. Com 95°/s
     * por 1,1 s isso eram **104°, contra um cone de 35°** — ou seja, qualquer
     * alvo dentro do cone era acerto garantido, e o cone não limitava nada.
     * Medido: um disparo 25° fora do alvo a 60 m girava 31° em 0,4 s e acertava.
     * É exatamente o que o §6.1 do plano diz que não pode acontecer ("uma bola
     * que persegue de verdade tira o jogo do jogador e o dá ao software").
     *
     * Agora são 26°/s por 0,75 s = **19,5° de correção contra um cone de 22°**.
     * A diferença em jogo:
     *
     * • um alvo que ANDA — 34 m/s de través, a 60 m — sai uns 10° do lugar
     *   durante o voo, e a bola tem sobra para acompanhar: a mira continua
     *   perdoando movimento, que é o que ela existe para perdoar;
     * • um alvo na BORDA do cone (22°) fecha para ~2,5°, e 2,5° a 60 m são
     *   2,6 m — mais que o raio de acerto. Mira ruim continua errando.
     *
     * Ou seja: a bola persegue quem você já estava mirando, e não acha quem
     * você não mirou. */
    homing: {
      /** graus/s — teto de giro da direção. */
      turnRate: 26,
      /** s — depois disto ela segue reta, sempre. */
      duration: 0.75,
      /** graus — meio-ângulo do cone. Fora dele, não corrige. */
      cone: 22,
      /** m — alcance da escolha de alvo, no instante do disparo. */
      acquire: 50,
    },
  },

  /* --------------------------------------------------------------- especiais
     Todos custam a barra CHEIA. O que os separa é forma, alcance e cratera.
     `kind` é o que viaja na rede; o cliente escolhe o visual por ele. */
  specials: {
    kamehameha: {
      nome: "Kamehameha",
      /** s — quanto o lutador fica na pose antes do feixe sair. */
      windup: 1.05,
      /** s — quanto o feixe sustenta. */
      sustain: 2.4,
      /** m — alcance. */
      range: 620,
      /** m/s — velocidade da frente do feixe. */
      speed: 340,
      /** m — raio de morte em torno do eixo. */
      hitRadius: 3.6,
      /** dano por segundo dentro do feixe. */
      dps: 62,
      /** Potência para a conta da cratera. Ver `craterFor`. */
      power: 4.2,
      cor: 0x6fd8ff,
    },
    galick: {
      nome: "Galick Gun",
      windup: 0.9,
      sustain: 2.0,
      range: 460,
      speed: 320,
      hitRadius: 4.4,
      dps: 70,
      power: 4.6,
      cor: 0xc07bff,
    },
    disk: {
      nome: "Kienzan",
      windup: 0.7,
      /** O disco não sustenta: ele VOA. `sustain` é a vida dele. */
      sustain: 3.2,
      /* Honesto, pelo mesmo motivo da Genki Dama: 3,2 s a 105 m/s são 336 m, e
         o 520 que estava aqui nunca foi alcançado por disco nenhum. */
      range: 336,
      speed: 105,
      hitRadius: 2.2,
      /** O disco corta de uma vez, não por segundo. */
      damage: 48,
      power: 1.4,
      cor: 0xa8ff6f,
    },
    genki: {
      nome: "Genki Dama",
      windup: 3.6,
      sustain: 4.5,
      /* ALCANCE HONESTO. Estava 700, e a vida do projétil é
         `min(sustain, range / speed)`: com 4,5 s a 46 m/s ela nunca passava de
         **207 m**. O número grande não fazia nada além de mentir para quem
         fosse balancear o golpe — e a sala usa `range` para validar acerto, o
         que abria uma janela de 700 m para um golpe de 207. */
      range: 210,
      speed: 46,
      hitRadius: 11,
      damage: 96,
      /* 26 e não 12: o §7 do plano anuncia 30 m de cratera para ela, e
         `craterFor` dá 2,2 + 5,4·√p — com 12 saíam 20,9 m. É o golpe mais caro
         do jogo (3,6 s parado, a barra inteira) e o buraco é a única coisa que
         fica dele. */
      power: 26,
      cor: 0x9ff0ff,
    },
  },

  /** A ordem dos especiais nas teclas 1–4 e no HUD. */
  specialOrder: ["kamehameha", "galick", "disk", "genki"],

  /* -------------------------------------------------------------- destruição
     Ver §7 do plano. A conta da cratera é COMPARTILHADA de propósito: os dois
     lados precisam chegar ao mesmo buraco, ou duas abas veem chões diferentes. */
  destruction: {
    /** m — raio base de qualquer cratera. */
    craterBase: 2.2,
    /** m — quanto o raio cresce com a raiz da potência. */
    craterGain: 5.4,
    /** fração do raio que vira profundidade. */
    craterDepth: 0.35,
    /** m — maior cratera aceita. Trava contra potência absurda vinda da rede. */
    craterMax: 34,
    /**
     * Potência mínima para o buraco ser PERSISTENTE.
     *
     * Abaixo disto o golpe ainda levanta poeira, pedra e clarão — só não gasta
     * uma das 96 vagas do terreno. E precisa ser assim porque a rajada básica
     * sai seis vezes por segundo POR LUTADOR: com quinze em campo são noventa
     * pedidos de cratera por segundo contra um teto de 96, e a fila girava
     * inteira em pouco mais de um segundo. Medido numa partida curta: a sala
     * carimbou 176 crateras e o campo guardava 96 — buracos apagando na frente
     * do jogador enquanto ele olhava para eles.
     *
     * Com o corte em 0,5, a rajada (0,12) marca e não fica, e a fila passa a
     * pertencer a quem a merece: especiais (4,2 a 12) e quedas de altura. É
     * também o que a referência faz — bola de ki chamusca, especial abre buraco.
     */
    craterMinPower: 0.1,
    /** Quantas crateras o terreno guarda antes de aposentar as mais velhas.
     *  Ver `NamekField.addCrater` — é o teto de custo do `heightAt`. */
    craterLimit: 96,
    /** m — queda a partir da qual o pouso abre cratera e levanta poeira. */
    slamSpeed: 26,
    /** Potência de uma queda, por (m/s) acima do limite. */
    slamPower: 0.055,
  },

  /* ------------------------------------------------------------------- morte */
  respawn: {
    /** s — quanto tempo caído antes de reaparecer. */
    delay: 5,
    /** s — invulnerabilidade piscando depois de reaparecer. */
    invuln: 3,
    /** Hz — frequência do piscar. */
    blink: 6,
    /** m — altura em que se reaparece, para a entrada ser voando. */
    dropHeight: 120,
  },

  /* -------------------------------------------------------------------- rede */
  net: {
    /** O teto pedido: 15 jogadores, humanos e bots somados. */
    maxPlayers: 15,
    /** Hz — envio da própria pose. */
    stateRate: 20,
    /** Hz — vida, ki e estado dos outros. */
    statusRate: 10,
    /** s — quanto o buffer de interpolação atrasa os remotos. */
    interpDelay: 0.1,
    /** Nome da sala. Não é fase do arqueiro — ver §0 do plano. */
    levelId: "namek",
    /** O único modo desta sala. */
    modeId: "deathmatch",

    /* Os números do TRANSPORTE. Repetidos aqui em vez de lidos de
       `CONFIG.net`, e isso é o §0 do plano em ação: um `import` do config do
       arqueiro faria o modo herdar `maxPlayers: 12` — e o requisito é 15 — e
       amarraria a nossa sala a um arquivo que ninguém vai lembrar que ela lê ao
       balancear o vale. Os valores coincidem hoje porque a rede é a mesma; eles
       são livres para divergir amanhã, que é justamente o ponto. */
    url: "", // vazio = mesma origem, em /ws
    nameMaxLength: 16,
    /** s entre pings. Também impede o proxy de matar conexão ociosa. */
    heartbeat: 15,
    /** s — backoff de reconexão; depois repete o último. */
    reconnectDelays: [0.4, 0.8, 1.6, 3, 5],
    /**
     * m — folga entre o acerto declarado e onde a vítima estava de fato.
     *
     * O mesmo raciocínio do `CONFIG.net.hitTolerance` do arqueiro (4 m), com a
     * conta refeita para ESTA velocidade: quem atira vê o alvo `interpDelay`
     * (100 ms) no passado, e um lutador em arranque anda 96 m/s — quase dez
     * metros só de atraso de interpolação, mais o que o ping acrescentar. Uma
     * folga apertada aqui não pegaria trapaceiro; pegaria o jogo inteiro.
     */
    hitTolerance: 14,
    /** s — silêncio que derruba uma conexão. O cliente manda `ping`; quem some
     *  por mais que isto perdeu a rede e a vaga volta para a sala. */
    silenceTimeout: 40,
  },

  /* -------------------------------------------------------------------- bots */
  bot: {
    /** Perícia padrão. Os bots são bons — é requisito. Ver §9 do plano. */
    skill: 0.82,
    /** m — a que distância eles preferem brigar. */
    idealRange: 55,
    /** m — abaixo disto eles recuam. */
    tooClose: 22,
    /** m — repulsão mútua, para não virarem cardume. */
    separation: 25,
    /** abaixo desta fração de ki eles vão carregar. */
    kiRetreat: 0.3,
    /** s — tempo de reação a uma ameaça nova. Menor = mais afiado. */
    reaction: 0.22,
    /** graus — erro de mira no pior caso (perícia 0). */
    aimError: 14,
  },
};

/* ------------------------------------------------------------------ crateras */

/**
 * O buraco que uma potência abre. **A mesma conta nos dois lados da rede.**
 *
 * Está aqui, e não no campo de altura, porque quem chama é o servidor (que
 * carimba a cratera) e o cliente (que a desenha e a esculpe na malha). Duas
 * implementações dessa fórmula seriam duas topografias, e o sintoma seria
 * jogadores caindo em buracos que os outros não veem.
 *
 * Raiz quadrada e não linear: dobrar a potência não dobra o raio, e é isso que
 * mantém a bola de ki num arranhão de 3 m enquanto a Genki Dama abre 30 m sem
 * que a escala do meio fique sem graça.
 */
export function craterFor(power) {
  const p = Math.max(0, Math.min(power, 64));
  const D = NAMEK.destruction;
  const raio = Math.min(D.craterMax, D.craterBase + D.craterGain * Math.sqrt(p));
  return { raio, fundura: raio * D.craterDepth };
}

/** A definição de um especial pelo id, ou null se o id não existir. */
export function specialInfo(kind) {
  return NAMEK.specials[kind] ?? null;
}

/** Clamp em [0, 1] — usado o bastante nos dois lados para valer o export. */
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
