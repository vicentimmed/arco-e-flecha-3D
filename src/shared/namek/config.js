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
    /** m — raio da arena. Ver §2 do plano: espaço para voar é o pedido. */
    radius: 900,
    /** m — teto de voo. Acima disto a subida é cortada, sem parede visível. */
    ceiling: 520,
    /** m — nível do mar. O terreno mergulha nele na borda da arena. */
    seaLevel: -8,
    /** Semente do relevo. Fixa: o planeta é o mesmo em todas as máquinas. */
    seed: 20030711,

    /* A BARREIRA É MACIA, e isso é decisão de jogo, não de física.
     *
     * Uma parede dura a 900 m para um lutador a 64 m/s é uma batida seca a cada
     * perseguição — e perseguir é metade do modo. O que existe aqui é um freio
     * que cresce: passou do raio, ganha uma aceleração de volta proporcional à
     * distância excedida. Quem tenta fugir sente o planeta puxando; quem está
     * lutando nunca descobre que a borda existe. */
    softEdge: {
      /** m — onde o freio começa a agir. */
      start: 820,
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
     * O pedido original é explícito: "agilidade no voo", "não deve ser travado
     * e lento". A agilidade mora na ACELERAÇÃO (`airAccel`, `boostAccel`) e na
     * liberdade de direção — não na velocidade de cruzeiro, e é por isso que
     * baixar a segunda não desmente a primeira. Ver logo abaixo.
     *
     * O VOO DESACELEROU UM TERÇO, e o pedido foi direto: "a velocidade do voo
     * ainda está muito rápida, diminua".
     *
     * Eram 34 e 96 m/s. O problema não era o número no papel — era a ESCALA: a
     * arena tem 1 800 m de ponta a ponta, e a 96 m/s dava para atravessá-la
     * inteira em dezenove segundos. Um planeta que se cruza em dezenove
     * segundos é um planeta pequeno, e a briga acontecia sempre em fuga, porque
     * o arranque vencia qualquer mira.
     *
     * Com 26 e 64 a travessia passa a 28 s e — o que importa mais — a
     * perseguição dos golpes volta a morder. A conta é a mesma dos `homing`: um
     * projétil que gira `ω` só é desviado por quem consegue uma velocidade
     * angular maior que a dele, e a `d` metros isso pede `v > ω·d`. Com o
     * arranque a 64 m/s, o Kienzan (70°/s) é perdido a menos de 52 m e o Galick
     * Gun (55°/s) a menos de 66 m — ou seja, escapar de lado continua sendo
     * possível e passou a exigir estar PERTO, que é a troca certa: quem está
     * longe se defende com antecedência, não com reflexo.
     *
     * A aceleração NÃO caiu junto, e isso é deliberado. O pedido original do
     * modo — "não deve ser travado e lento" — é sobre RESPOSTA, não sobre
     * velocidade de cruzeiro. Mantidos `airAccel` e `boostAccel`, o lutador
     * chega ao máximo no mesmo quinto de segundo de antes; ele só não vai mais
     * tão longe. */
    /** m/s — voo normal, com direção livre. */
    flySpeed: 26,
    /** m/s — arranque com ki (o boost). Dois vírgula cinco vezes o voo normal. */
    boostSpeed: 64,
    /** 1/s — perseguição da velocidade desejada no ar. Alto de propósito. */
    airAccel: 9.5,
    /** 1/s — a mesma coisa durante o boost: ainda mais direto. */
    boostAccel: 14,
    /** m/s — subida e descida verticais puras (teclas de altura). */
    climbSpeed: 20,
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

    /* ------------------------------------------------------ o atordoamento --
     *
     * CINCO GOLPES SEGUIDOS DERRUBAM. É a peça que faltava para o especial
     * existir de verdade, e a razão é aritmética, não de gosto.
     *
     * Um lutador em arranque anda a 64 m/s. O Kamehameha pede 1,05 s parado na
     * pose antes de o feixe sair, e a Genki Dama pede 3,6 s. Nesse tempo o alvo
     * percorreu, respectivamente, 67 m e 230 m — ou seja, ele não precisa
     * desviar do golpe: ele já não estava lá quando o golpe foi decidido. O
     * resultado medido é o que o usuário descreve, e é o que qualquer um vê em
     * dois minutos de partida: os especiais nunca acertam ninguém, e o modo
     * inteiro vira troca de bolinha de ki.
     *
     * A resposta não podia ser só frear o voo — frear o bastante para a mira
     * alcançar mataria a agilidade que é o pedido original do modo — nem
     * acelerar o especial, porque o windup é o aviso que dá ao outro a chance
     * de sair da frente. (O voo ACABOU caindo um terço depois, a pedido, e isso
     * ajuda; mas mesmo a 64 m/s o alvo anda 67 m durante a pose do Kamehameha,
     * então a queda continua sendo o que faz o golpe existir.)
     * A resposta é a da referência: quem apanha em sequência PERDE O AR e cai.
     * É a janela — dois segundos e meio de alguém caído no chão — em que o
     * Kamehameha do outro lado tem tempo de carregar e sair.
     *
     * Os quatro números, e por que cada um é o que é:
     *
     * • `hits: 5` — o pedido literal, e a unidade é a RAJADA: a sala soma
     *   `dano / blast.damage`, então cinco bolas de ki (6 cada) fecham a conta
     *   em 30 de dano. A vantagem de contar dano em vez de acertos é que a
     *   segunda metade do pedido — "um poder grande derruba sozinho" — cai da
     *   mesma linha: o Kienzan (48), o Galick Gun (62) e a Genki Dama (96)
     *   passam de 30 num impacto só, e o Kamehameha, que cobra por segundo,
     *   fecha a conta em meio segundo de feixe em cima de alguém. Ver
     *   `NamekRoom.contarGolpe`.
     * • `window: 2.6` — os golpes precisam ser SEGUIDOS. A janela desliza a
     *   cada acerto; parou de apanhar por 2,6 s, a contagem morre. Sem isso, um
     *   lutador cairia por causa de cinco tiros espalhados em dois minutos.
     * • `time: 2.4` — quanto ele fica caído. É maior que o windup do
     *   Kamehameha (1,05 s) e do Galick Gun (0,9 s) de propósito: a janela tem
     *   de caber o golpe INTEIRO sendo carregado, senão ela não paga nada. Não
     *   cabe a Genki Dama (3,6 s), e isso também é de propósito — ela continua
     *   sendo a aposta que ela sempre foi.
     * • `immune: 6` — a carência DEPOIS de levantar, e é a trava mais
     *   importante das quatro. Sem ela, dois lutadores atirando juntos mantêm
     *   um terceiro no chão para sempre: ele levanta, leva cinco bolas, cai de
     *   novo, e nunca mais joga. Um golpe que tira o controle e pode ser
     *   repetido sem intervalo não é um golpe, é uma expulsão.
     */
    stagger: {
      /** Golpes seguidos que derrubam. */
      hits: 5,
      /** s — a janela em que os golpes contam como "seguidos". */
      window: 2.6,
      /** s — quanto o corpo fica caído, sem controle. */
      time: 2.4,
      /** s — carência depois de levantar, em que ninguém o derruba de novo. */
      immune: 6,
      /** m/s — o tranco para baixo no instante da queda. É o que tira o ar. */
      drop: 24,
    },
  },

  /* --------------------------------------------------------------------- ki
     A economia inteira do modo. Ver §5 do plano — em especial por que o
     ESPECIAL exige barra cheia e a rajada básica não. */
  ki: {
    max: 100,
    /* CARREGAR CUSTA O DOBRO DO TEMPO, e o dobro é o pedido literal.
     *
     * Eram 38/s — 2,6 s para encher do zero —, e 2,6 s de alguém parado é curto
     * demais para ser uma aposta: dava para carregar a barra inteira no meio de
     * um tiroteio, entre duas rajadas alheias, praticamente de graça. A troca
     * central do modo (§5 do plano: "poder em troca de estar parado à vista de
     * todo mundo") só existe se o "estar parado" durar o bastante para alguém do
     * outro lado da arena ver, decidir e chegar.
     *
     * Com 19/s são 5,3 s. É muito tempo — de propósito: é quase o dobro da
     * janela em que um lutador atravessa a arena inteira em arranque, ou seja,
     * qualquer um que enxergue a pose de carga tem tempo de chegar. E é também o
     * que dá sentido ao atordoamento (`fighter.stagger`): quem foi derrubado
     * paga a queda, e quem derrubou tem o tempo de carregar o golpe grande. */
    chargeRate: 19,
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

  /* ------------------------------------------------------------------ defesa
     A guarda: os dois braços cruzados à frente do corpo, o dano quase todo
     absorvido, e a barra escoando enquanto ela estiver de pé.

     É a terceira coisa que se pode fazer com ki, e ela fecha o triângulo do
     modo: atacar (rajada e especial), FUGIR (o arranque) e AGUENTAR. Sem ela, a
     única resposta a alguém que atira melhor que você é correr — e a partir do
     momento em que cinco golpes seguidos derrubam (`fighter.stagger`), correr
     deixou de ser resposta suficiente.

     Os três números são um triângulo fechado, e mexer num deles sozinho quebra
     o golpe:

     • `damage: 0.22` — passa 22 % do dano. Não é imunidade de propósito: uma
       guarda que zera o dano transforma toda briga em quem cansa primeiro, e um
       Kamehameha (62/s) ainda tira 13,6/s de quem está defendendo, o que
       significa que ficar parado atrás dos braços continua sendo perder.
     • `drain: 21` — a barra cheia dá 4,8 s de guarda. É mais que o
       atordoamento (2,4 s) e menos que a carga (5,3 s): dá para aguentar uma
       investida inteira, e não dá para viver defendendo.
     • `push: 0.3` — o empurrão da onda também é aparado. Sem isto a guarda
       pareceria funcionar contra o dano e falhar contra o que se VÊ, que é a
       pior forma de um mecanismo mentir.

     E ela impede a QUEDA (ver `contarGolpe` na sala): golpe aparado não conta
     para os cinco. É a razão de existir do botão — quem lê a investida a tempo
     não vai ao chão. */
  guard: {
    /** Fração do dano que ainda passa pela guarda. */
    damage: 0.22,
    /** por segundo, com a guarda de pé. */
    drain: 21,
    /** Fração do empurrão que ainda passa. */
    push: 0.3,
    /** Fração da velocidade que sobra ao defender. Guarda não é corrida. */
    speed: 0.3,
  },

  /* --------------------------------------------------------------- projéteis */
  blast: {
    /** m/s — velocidade da bola de ki. */
    speed: 78,
    /* s — vida máxima antes de sumir sozinha.
     *
     * "OS PODERES NÃO DEVEM SUMIR" — o pedido é literal, e a régua dele também:
     * eles seguem até bater em alguém ou no cenário, e só um tiro para o CÉU
     * pode morrer de velhice, porque a alternativa é lixo voando para sempre.
     *
     * Eram 2,6 s, ou 203 m. Num modo cuja arena tem 1 800 m de diâmetro e cuja
     * distância de briga é 55 m, isso significava que toda bola disparada de
     * mais de duzentos metros — e brigar a duzentos metros é comum aqui —
     * evaporava no ar, na frente de quem atirou, sem tocar em nada. Cinco
     * segundos são 390 m: cobre qualquer troca de tiros real e ainda deixa a
     * bola perdida morrer antes de virar tráfego. */
    life: 5,
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
     * • um alvo que ANDA — 26 m/s de través, a 60 m — sai uns 8° do lugar
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
    /* O GALICK GUN É UMA BOLA, E NÃO UM SEGUNDO KAMEHAMEHA.
     *
     * Ele era um feixe com os mesmos 0,9 s de pose, o mesmo tubo de meio
     * quilômetro e a mesma sustentação — a única diferença entre os dois na tela
     * era a matiz: azul contra roxo. Dois dos quatro especiais do modo eram o
     * mesmo golpe pintado de outra cor, e num jogo em que o especial custa a
     * barra inteira isso é um quarto do repertório jogado fora.
     *
     * Agora ele é o que a referência mostra: uma ESFERA grande e densa, lançada
     * com as duas mãos, arrastando um rastro de energia atrás. `damage` no
     * lugar de `dps` é o que faz a troca — quem tem `dps` cobra por segundo de
     * exposição e é desenhado como tubo (`powers/beam.js`); quem tem `damage`
     * cobra de uma vez e voa (`powers/orb.js`). A sala já sabia a diferença
     * antes desta mudança: ver `registrarQueimadura`.
     *
     * Ele é o meio-termo entre o feixe e a Genki Dama: mais rápido e muito mais
     * barato de armar que ela (0,9 s contra 3,6 s), com metade do raio e dois
     * terços do dano. */
    galick: {
      nome: "Galick Gun",
      windup: 0.9,
      /** s — o VOO da bola, não uma sustentação: ela não fica na mão. */
      sustain: 5,
      /* Alcance honesto, pela mesma régua da Genki Dama: a vida do projétil é
         `min(sustain, range / speed)`, e 5 s a 95 m/s são 475 m. Um número
         maior aqui só mentiria para quem viesse balancear o golpe — e abriria
         na sala uma janela de acerto que o projétil nunca alcança. */
      range: 475,
      speed: 95,
      hitRadius: 6.5,
      /** Corta de uma vez, como o disco e a Genki Dama. */
      damage: 62,
      power: 6.4,
      cor: 0xc07bff,
      /* ELE PERSEGUE, e persegue MUITO mais do que a bola de ki.
       *
       * O pedido: "o Galick Gun também deve seguir o usuário". A diferença para
       * a perseguição da rajada (`blast.homing`, 26°/s por 0,75 s, um cone de
       * 22°) é de outra ordem, e é de propósito — este é o golpe que custa a
       * barra inteira e 0,9 s de pose, e a promessa dele é que ele CHEGA.
       *
       * 55°/s durante 3 s são 165° de correção: ele contorna, volta e persegue
       * de verdade. O que faz dele um golpe e não uma sentença é a velocidade
       * angular contra a distância — a 40 m de quem foge, 55°/s significa que
       * ele acompanha um alvo cruzando a 38 m/s, e um lutador em arranque faz
       * 96. Ou seja: **quem arranca de lado escapa; quem tenta correr em linha
       * reta na frente dele, não.** É a mesma regra do Kienzan, com números
       * maiores porque a bola é maior e mais lenta. */
      homing: {
        turnRate: 55,
        duration: 3,
        /** graus — cone largo, mas não "atrás de mim". */
        cone: 60,
        /** m — a que distância ele escolhe o alvo, no instante do disparo. */
        acquire: 260,
      },
    },
    disk: {
      nome: "Kienzan",
      windup: 0.7,
      /** O disco não sustenta: ele VOA. `sustain` é a vida dele. */
      sustain: 6,
      /* Honesto, pelo mesmo motivo da Genki Dama: 6 s a 105 m/s são 630 m, e o
         520 que estava aqui nunca foi alcançado por disco nenhum. A vida subiu
         de 3,2 s por causa do "os poderes não devem sumir" — ver `blast.life`,
         que tem o argumento inteiro. */
      range: 630,
      speed: 105,
      /* 3,4 e não 2,2. O disco de 2,2 m tinha **4,4 m de ponta a ponta contra
         um lutador de 1,78 m** — do tamanho de duas pessoas —, e a 105 m/s, a
         cem metros de distância, isso é um risco de luz de poucos pixels: ele
         não lia como lâmina, lia como arranhão na tela. Pior, era o menor raio
         de acerto de todos os especiais, num golpe que não persegue e não
         explode: errar por meio metro era a regra.
         Com 3,4 m ele tem quase sete metros de diâmetro — um portal, que é o
         que a referência mostra — e continua sendo, de longe, a menor área de
         acerto do repertório (o Galick Gun tem 6,5 e a Genki Dama 11). A
         espessura de VERDADE, que é a outra metade da reclamação, está em
         `powers/disk.js`: o gume virou um toro, e ele tem volume. */
      hitRadius: 3.4,
      /** O disco corta de uma vez, não por segundo. */
      damage: 48,
      power: 1.4,
      cor: 0xa8ff6f,
      /* ELE PERSEGUE — "o Kienzan deve seguir o usuário", e o usuário completou
       * a regra na mesma frase: "é possível escapar, mas o player tem que se
       * movimentar rápido para os lados".
       *
       * Essa segunda metade é a especificação inteira, e ela é geométrica. A
       * 105 m/s com 70°/s de giro, o disco fecha uma curva de raio
       * `v / ω` = 105 / 1,22 rad/s ≈ **86 m**. Traduzindo para dentro do jogo:
       * ele acompanha qualquer coisa que se mova em linha reta na frente dele,
       * e PERDE o alvo que corta de lado a mais de ~55 m/s a curta distância —
       * ou seja, quem arranca para o lado a menos de 52 m escapa, e quem só
       * recua não — recuar mantém você no eixo da lâmina.
       * Exatamente o que foi pedido.
       *
       * Os 4,5 s de perseguição são quase a vida inteira dele: um disco que
       * persegue por um segundo e depois segue reto seria um disco que erra
       * bonito. Ele é o golpe barato do repertório (0,7 s de pose) e o de menor
       * área — perseguir é o que ele tem. */
      homing: {
        turnRate: 70,
        duration: 4.5,
        /** graus — o cone é largo porque a lâmina contorna. */
        cone: 75,
        acquire: 300,
      },
    },
    genki: {
      nome: "Genki Dama",
      windup: 3.6,
      sustain: 7,
      /* ALCANCE HONESTO. Estava 700, e a vida do projétil é
         `min(sustain, range / speed)`: com a sustentação de então (4,5 s) a
         46 m/s ela nunca passava de **207 m**. O número grande não fazia nada
         além de mentir para quem fosse balancear o golpe — e a sala usa `range`
         para validar acerto, o que abria uma janela de 700 m para um golpe de
         207. Agora são 7 s a 46 m/s = 322 m, e o número aqui é esse. */
      range: 322,
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
    craterMinPower: 0.5,
    /** Quantas crateras o terreno guarda antes de aposentar as mais velhas.
     *  Ver `NamekField.addCrater` — é o teto de custo do `heightAt`. */
    craterLimit: 96,
    /** m — queda a partir da qual o pouso abre cratera e levanta poeira. */
    slamSpeed: 26,
    /* Potência de uma queda, por (m/s) acima do limite.
     *
     * Era 0,055, e o pedido explícito mudou o que essa linha precisa entregar:
     * "dependendo da altura que ele está, ele deve cair no chão e criar uma
     * grande cratera… ele deve cair no chão com velocidade e impacto".
     *
     * A conta, agora que o atordoamento existe: quem é derrubado a duzentos
     * metros chega ao chão a ~51 m/s (o tranco de 24 m/s mais 2,4 s de queda),
     * o que dá 25 m/s acima do limite. Com 0,055 isso eram 1,4 de potência —
     * 8,6 m de buraco, do tamanho do que uma bola de ki faria se ela abrisse
     * cratera. Com 0,13 são 3,2, ou **12 m**: quase o buraco de um Kamehameha,
     * aberto por um corpo, que é a leitura certa de alguém arrancado do céu.
     * A queda mais violenta possível (do teto de 520 m, a ~100 m/s) chega a
     * 9,6 de potência e 19 m de cratera — grande, e ainda longe dos 30 m que a
     * Genki Dama guarda para si. */
    slamPower: 0.13,
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
     * (100 ms) no passado, e um lutador em arranque anda 64 m/s — mais de seis
     * metros só de atraso de interpolação, mais o que o ping acrescentar. Uma
     * folga apertada aqui não pegaria trapaceiro; pegaria o jogo inteiro.
     *
     * Os 14 m foram dimensionados quando o arranque era 96 m/s e ficaram
     * FOLGADOS depois que ele caiu para 64. Continuam aqui de propósito: a
     * folga extra custa uma tolerância maior a acerto declarado, que ninguém
     * consegue transformar em vantagem (o dano é o mesmo), enquanto apertá-la
     * custaria acertos legítimos de quem joga com ping alto.
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

    /* --------------------------------------------------------- dificuldade --
     *
     * Quatro níveis, e eles são da SALA e não de cada bot: o pedido é explícito
     * — "o que estiver setado ali é o que manda no jogo online; caso a
     * dificuldade seja alterada no meio do jogo, tudo é alterado para todos
     * dinamicamente, independente se já tiver adicionado o bot ou não".
     *
     * Por isso os números abaixo são MULTIPLICADORES, e não um segundo conjunto
     * de constantes de IA. Um bot já em campo muda de nível sem renascer, sem
     * perder o alvo e sem um único `if` novo no meio da máquina de estados: o
     * que muda é quanto ele multiplica o que ele já sabia fazer.
     *
     * O que cada eixo faz, e por que são cinco e não um só "nível 0..1":
     *
     * • `mover` — fração da velocidade que ele usa. É o "voa mais devagar" do
     *   pedido, e é o eixo que mais muda a sensação: um adversário a 45 % da
     *   velocidade pode ser ACOMPANHADO pela mira, e mira que acompanha é o que
     *   faz alguém sentir que está jogando em vez de sorteando.
     * • `esquiva` — a chance de ele de fato sair da frente de uma bola. É o
     *   "mais fácil de ser acertado", e ele precisava ser separado de `mover`
     *   porque um bot lento que ainda desvia de tudo continua impossível de
     *   acertar — ele só fica impossível mais devagar.
     * • `rajada` — fração da cadência de tiro.
     * • `especial` — a chance de ele gastar a barra cheia num especial. É o
     *   "não solta tantos poderes", e no fácil ele quase não solta: levar um
     *   Kamehameha de um adversário que você ainda está aprendendo a acertar é
     *   o jeito mais rápido de o modo parecer injusto.
     * • `erro` — multiplica o erro de mira. É o "erra mais poderes".
     *
     * `parado` zera os cinco, e ele NÃO é uma dificuldade — é um alvo de treino,
     * como o pedido descreve: *"bote parado é somente para fazer testes. Ele
     * sempre, após derrubado, voa até uma certa altura e, conforme eu bato nele,
     * ele cai e ele volta de novo."*
     *
     * O comportamento inteiro cabe numa frase: **ele só corrige a altura.**
     * Nada de lateral, nada de órbita, nada de esquiva, nada de tiro. Quando um
     * golpe o empurra ou o derruba, ele cai — porque a física é a mesma de todo
     * mundo —, e quando volta ao controle sobe de novo até `alturaTreino` e
     * fica lá. É esse ciclo (subir, apanhar, cair, subir) que faz dele um
     * boneco de pancada, e ele sai de graça: basta não pedir mais nada.
     *
     * Serve para aprender onde a Genki Dama cai, quanto tempo o Kamehameha leva
     * para sair e quantos golpes derrubam — que é exatamente o que não dá para
     * descobrir apanhando. */
    dificuldadePadrao: "medio",
    /** A ordem em que os níveis aparecem no menu. Do mais manso ao mais bravo. */
    dificuldadeOrdem: ["parado", "facil", "medio", "dificil"],
    /* m — a cota que o alvo de treino mantém ACIMA DO RELEVO.
     *
     * Trinta e dois metros: alto o bastante para ser um alvo aéreo de verdade
     * (e para a queda dele render a cratera e a poeira que se quer ver), baixo
     * o bastante para caber na tela junto com o chão, que é a referência que
     * diz a que altura ele está. Acima do relevo e não uma cota absoluta —
     * senão ele nasceria enterrado na montanha e voando alto na clareira. */
    alturaTreino: 32,
    dificuldades: {
      parado: { nome: "Parado", mover: 0, esquiva: 0, rajada: 0, especial: 0, erro: 1 },
      facil: { nome: "Fácil", mover: 0.45, esquiva: 0.25, rajada: 0.4, especial: 0.18, erro: 3.4 },
      medio: { nome: "Médio", mover: 0.72, esquiva: 0.65, rajada: 0.7, especial: 0.6, erro: 1.8 },
      dificil: { nome: "Difícil", mover: 1, esquiva: 1, rajada: 1, especial: 1, erro: 1 },
    },
  },
};

/**
 * Os multiplicadores de uma dificuldade, com o padrão para um id desconhecido.
 *
 * Existe para que NINGUÉM leia `NAMEK.bot.dificuldades[x]` direto: o id vem da
 * rede (é o cliente que pede a troca), e um id inventado devolveria `undefined`
 * — que em multiplicação vira `NaN`, e um `NaN` na velocidade desejada de um bot
 * não é um bot mais fácil, é um corpo que some da simulação.
 */
export function dificuldadeBot(id) {
  const B = NAMEK.bot;
  return B.dificuldades[id] ?? B.dificuldades[B.dificuldadePadrao];
}

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

/** s — o quanto o corpo leva para se recompor depois de LANÇAR alguma coisa. */
const SOLTURA = 0.45;

/**
 * Quanto tempo o LUTADOR fica preso na pose de um especial.
 *
 * **Não é `windup + sustain`, e a diferença é a lição inteira desta função.**
 *
 * `sustain` quer dizer duas coisas diferentes em `NAMEK.specials`, e o
 * comentário de cada golpe já dizia isso: no Kamehameha é quanto o feixe fica
 * ACESO — e ele sai das mãos de quem o segura, então o corpo está preso o tempo
 * todo; no Kienzan, no Galick Gun e na Genki Dama é a VIDA DO PROJÉTIL, que voa
 * sozinho e não tem mais nada a ver com quem o atirou.
 *
 * Somar os dois indistintamente é o erro que isto conserta, e ele foi medido:
 * quando a vida dos projéteis cresceu (para atender ao "os poderes não devem
 * sumir"), o disco passou a prender quem o lançou por **6,7 s** e a Genki Dama
 * por 10,6 s — parado no ar, sem decidir nada. No banco de provas isso apareceu
 * como bots congelados a 140 m de altura em metade das partidas; para um humano
 * seria pior, porque ele veria a bola voando enquanto o próprio corpo continua
 * na pose de arremesso.
 *
 * Quem LANÇA fica preso pela pose mais um instante de recomposição. Quem
 * SEGURA fica preso enquanto segura.
 */
export function duracaoDaPose(info) {
  if (!info) return 0;
  return info.dps !== undefined ? info.windup + info.sustain : info.windup + SOLTURA;
}

/** Clamp em [0, 1] — usado o bastante nos dois lados para valer o export. */
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
