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

    /* m — ATÉ ONDE SE PODE VOAR, e ele é MAIOR que o raio da arena de propósito.
     *
     * Os dois números respondem a perguntas diferentes e estavam colados num só,
     * o que produzia exatamente a queixa: *"o player está impedido de ir muito
     * além do cenário. Ele deve conseguir voar bem além da praia, mas não muito,
     * inclusive a fundo no mar, mas não muito longe no mar."*
     *
     * `radius` (460 m) é o raio de JOGO: onde se nasce, onde a sala aceita
     * cratera, o que a grade de deslocamento cobre. Ele não muda.
     *
     * `flyRadius` é o raio de PASSEIO, e a régua dele é o relevo (ver
     * `NamekField.baseHeight`): a serra cede aos 500 m, a praia é a faixa entre
     * 580 e 630 m, e a linha d'água cai por volta de 612 m. Com o freio velho
     * começando aos 420 m, o jogador era virado de volta ANTES de a montanha
     * acabar — a praia inteira e o mar existiam no cenário e eram inalcançáveis.
     *
     * 760 m deixam ~150 m de mar aberto depois da rebentação: o bastante para
     * sobrevoar a água, mergulhar nela (e morrer, ver `NAMEK.world.afogar`) e
     * olhar a ilha de fora; e curto o bastante para o oceano nunca virar um
     * lugar para onde fugir de uma briga. */
    flyRadius: 760,
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
      /* m — onde o freio começa a agir.
       *
       * Passou a ser medido contra `flyRadius` e não contra `radius`: o freio é
       * a borda do PASSEIO, e ele começava aos 420 m — cem metros antes de a
       * serra sequer terminar. Aos 700 m o jogador já cruzou a praia e está
       * sobre a água; os 60 m que sobram até `flyRadius` são a faixa em que o
       * planeta vai puxando de volta. */
      start: 700,
      /** 1/s² — força do puxão por metro excedido. */
      pull: 0.9,
    },

    /* ------------------------------------------------------------ o afogamento
     *
     * "Caso algum player caia no mar, ele morre" — e é uma regra melhor do que
     * parece à primeira vista: sem ela, o mar aberto que `flyRadius` acabou de
     * liberar seria um lugar sem risco nenhum para descansar no meio de uma
     * partida. Com ela, sair da ilha é uma escolha com preço.
     *
     * Quem cobra é a SALA (`NamekRoom.afogarNoMar`), pelo mesmo caminho da lava
     * e pelo mesmo motivo: vida é do servidor. O que este bloco define é a
     * FRONTEIRA, e ela não pode ser "y abaixo do nível do mar" — depois que as
     * crateras passaram a furar até a lava (ver `destruction.lava`), o fundo de
     * um buraco na clareira também está abaixo de −8 m, e afogar quem está
     * dentro do próprio buraco seria absurdo.
     *
     * A fronteira é o RELEVO BASE: é mar onde o terreno natural, sem cratera
     * nenhuma, já estava debaixo d'água. Isso é função pura da posição, igual
     * nos dois lados da rede, e nenhuma cratera a move. */
    afogar: {
      /** m — quanto abaixo da linha d'água os pés precisam estar. */
      fundura: 1.2,
      /** s — quanto tempo submerso antes de morrer. Curto, mas não instantâneo:
       *  um mergulho raspando a água na perseguição não pode matar. */
      tempo: 0.7,
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

    /**
     * **Com a barra CHEIA o voo é de graça.**
     *
     * O pedido é literal: "uma vez que ele está com o ki totalmente cheio ele
     * pode usar o modo Voo com shift o quanto quiser que não vai gastar o ki.
     * Só gasta o ki quando ele soltar um poder."
     *
     * E ele conserta um problema real da economia: `boostDrain` são 14/s contra
     * uma barra de 100, ou seja **sete segundos** de arranque acabam com o
     * especial. Quem quisesse chegar perto de alguém para soltar um Kamehameha
     * gastava no caminho justamente a barra que o golpe exige — o modo pedia
     * que você parasse para carregar toda vez que quisesse usar o que carregou.
     *
     * Cheio, o arranque não cobra nada e a barra vira o que ela deve ser: uma
     * MUNIÇÃO, gasta por quem atira, não por quem se desloca. O primeiro tiro
     * tira a barra do topo e o voo volta a custar — então o estado de graça é
     * exatamente a janela entre "estou pronto" e "usei".
     *
     * Vale para os dois lados da rede: o cliente (`KiMeter.voaDeGraca`) e a
     * sala (`economiaDeKi`) leem o MESMO limiar, senão a barra do HUD
     * discordaria da barra que a sala cobra.
     */
    freeFlightAt: 1,
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
    /* Potência para a cratera.
     *
     * Era 0,12 — um arranhão de 4 m —, e o argumento de então era o teto de 96
     * crateras: seis tiros por segundo por lutador gastariam a fila inteira em
     * quinze segundos. **Esse teto não existe mais.** As crateras são assadas
     * num mapa de deslocamento (`NamekField.bakeCrater`), o custo de consultar
     * altura é o mesmo com dez ou dez mil buracos, e insistir no mesmo ponto
     * AFUNDA em vez de gastar vaga. O último motivo para a rajada mal marcar o
     * chão caiu junto.
     *
     * 0,45 abre 8,3 m — o buraco de uma pessoa. É o "as crateras dos poderes
     * pequenos devem ser bem maiores" literal, e é ele que faz a promessa da
     * ilha destruída: o especial sai uma vez por barra cheia, a rajada sai o
     * tempo todo, e destruição acumulada é feita do que sai o tempo todo. */
    power: 0.45,

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
      /* m — raio de morte em torno do eixo, e ele É a grossura do feixe: a
       * casca do desenho vale exatamente este número (ver `RAIO_CASCA` em
       * `powers/beam.js`), então engrossar o golpe e engrossar o que mata são a
       * mesma linha.
       *
       * Eram 3,6 m, e a queixa foi direta: *"o poder de Kamehameha está muito
       * fino no geral. Ele deve ser bem mais grosso, cobra grossa."* A régua que
       * faltava é a do CORPO: 3,6 m de raio contra um lutador de 1,78 m de
       * altura dava um tubo de sete metros — largo no papel, e visto de sessenta
       * metros (a distância de briga deste modo) ele é um risco fino contra o
       * céu. 6,6 m dão treze metros de diâmetro, ou sete vezes a altura de quem
       * atirou: aí sim é a cobra grossa da referência.
       *
       * O que segura isso de virar uma parede na cara do jogador é o
       * afunilamento na base (`BASE_TAPER`, 14 % do raio no punho) — a câmera
       * está a sete metros do peito e um tubo cheio ali seria a tela inteira em
       * branco. Ver o comentário de `PERFIL` em `powers/beam.js`. */
      hitRadius: 6.6,
      /* dano por segundo dentro do feixe.
       *
       * Eram 62/s, ou 148 de dano numa sustentação inteira — uma vida e meia. O
       * pedido reescreveu a régua de todos os golpes grandes: *"qualquer poder
       * grande que acertou em cheio deve tirar metade da vida. A Genki Dama
       * deve tirar a vida inteira."*
       *
       * "Em cheio", para um feixe, é a sustentação inteira em cima de alguém —
       * e 21/s por 2,4 s são exatamente 50, metade dos 100 de vida. Um encostão
       * de meio segundo tira 10, que é a graduação que só um golpe contínuo tem
       * e que é a razão de ele cobrar por segundo.
       *
       * A queda de 62 para 21 parece brutal e não é: com 6,6 m de raio de morte
       * (o dobro do de antes) ele acerta muito mais, e a conta de quanto ele
       * tira de quem fica no eixo continua sendo a mesma metade da vida. O que
       * ele deixou de fazer é matar sozinho — que é o lugar da Genki Dama. */
      dps: 21,
      /* Potência para a conta da cratera. Ver `craterFor`.
       *
       * 0,58 dá 9 m de boca, e o número foi escolhido contra o IMPACTO e não
       * contra a força do golpe: *"a cratera do Kamehameha deve ser uma cratera
       * basicamente um pouco maior que o tamanho do seu impacto e bem funda."* O
       * impacto é o `hitRadius` de 6,6 m; 9 m são um pouco maiores que ele, e é
       * literalmente o que foi pedido. */
      power: 0.58,
      /* O MULTIPLICADOR DE FUNDURA — a outra metade do "bem funda".
       *
       * A cratera é redonda por construção: `craterFor` tira a profundidade do
       * raio (`craterDepth`), então um buraco estreito é um buraco raso, e não
       * havia como pedir "estreito E fundo" com um número só. Este campo separa
       * as duas coisas.
       *
       * 3,5 sobre os 5,6 m que os 9 m de raio dariam são **19,5 m de fundo** —
       * o feixe não amassa o chão, ele o PERFURA. Somado à perfuração ao longo
       * do caminho (ver `atravessar`, em `powers/beam.js`), é o que faz um
       * Kamehameha no chão abrir poço até a rocha e, com insistência, até a
       * lava.
       *
       * Ele viaja na rede junto com a potência — ver `NC2S.GROUND_HIT` — porque
       * quem cava é o cliente que atirou e quem carimba é a sala, e um buraco
       * fundo de um lado e raso do outro seriam duas topografias. */
      craterDeep: 3.5,

      /* ------------------------------------------------------ ELE ATRAVESSA
       *
       * O pedido: *"quando eu falo que o Kamehameha atravessa uma montanha ou
       * atravessa o chão todo de uma vez e já sai a lava, o tamanho já é um
       * buraco do tamanho da cratera que ele forma… a gente consegue deixar
       * furos na montanha e o player consegue passar por dentro se ele quiser."*
       *
       * O feixe PARAVA no primeiro ponto de relevo que encostava (`tocouChao`
       * devolvia a fatia e `alcance` virava `frente`). Agora ele continua, e o
       * que ele deixa para trás é uma fila de crateras ao longo do caminho
       * enterrado — uma VALA que corta a montanha de lado a lado, larga o
       * bastante para se voar dentro dela.
       *
       * -------------------------------------------------- e por que é vala, e
       *                                                     não túnel de teto
       *
       * O terreno deste modo é um campo de ALTURA (`NamekField`): uma função
       * y = f(x, z). Um túnel com teto é uma superfície que tem dois valores de
       * y na mesma coluna, e isso não cabe num campo de altura por definição —
       * não é uma limitação de esforço, é o tipo do dado. Fazer túnel de verdade
       * pediria voxel ou malha de volume, o que é outro motor de terreno e outra
       * física (o §4 do plano existe justamente para não haver dois).
       *
       * O que cabe, e é o que foi feito, é o corte aberto: o feixe entra pela
       * encosta, sai do outro lado, e no meio fica um corredor com paredes dos
       * dois lados e céu em cima. Voa-se por dentro, o relevo em volta está
       * intacto, e a leitura de "a montanha foi furada" é a mesma. A parte que o
       * pedido já marcava como opcional — *"se essa última parte ficar muito
       * complexa de fazer, pode pular"*, sobre a montanha desabar quando sobra
       * pouco apoio — sai de graça na medida em que os cortes se cruzam: duas
       * valas em cruz deixam quatro torres, e a terceira leva o miolo.
       */
      atravessar: {
        /** m — de quantos em quantos metros de rocha o feixe deixa uma cratera.
         *  Menor que o raio do buraco (9 m), para os discos se fundirem numa
         *  vala contínua em vez de virarem uma fileira de poços. */
        passo: 7,
        /** m — quanto de relevo ele aguenta perfurar num disparo. Uma montanha
         *  deste mapa tem 90 a 220 m de base; 260 atravessam a maior delas de
         *  lado a lado e ainda travam o caso patológico (um tiro rasante que
         *  correria enterrado por meio quilômetro). */
        alcance: 260,
        /** Fração da potência em cada cratera do trajeto. Menos que na boca: a
         *  entrada é a cratera cheia, o corredor é o rastro dela. */
        potencia: 0.62,
      },
      cor: 0x6fd8ff,

      /* ELE FAZ CURVA — e é a mudança mais funda que este golpe já teve.
       *
       * O pedido: "hoje é só algo muito reto, mas ele deve, sim, ter uma
       * curvatura para perseguir o player… porém a curva nunca deve ser muito
       * brusca, é sempre uma curva suave e deve ter um limite".
       *
       * O feixe deixou de ser função pura de (origem, direção, tempo) e virou
       * uma COBRA: uma cabeça que voa e gira, e um corpo que é o caminho por
       * onde ela passou. `powers/beam.js` tem o mecanismo inteiro.
       *
       * -------------------------------------------------------- por que 85°/s
       *
       * Parece muito e não é: o que o olho lê numa curva é o RAIO, não a taxa.
       * A 340 m/s, 85°/s (1,48 rad/s) fecham uma curva de `v/ω` = **229 m de
       * raio** — a 55 m de quem atirou o feixe dobrou 14°, e ele só completa os
       * 40° do teto depois de 160 m de voo. É um gancho longo, que é o que a
       * referência mostra, e não uma cotovelada.
       *
       * ------------------------------------------------------------- e a fuga
       *
       * A régua do resto do modo (ver `flySpeed`) diz que quem arranca de lado a
       * `v > ω·d` vence a velocidade angular do golpe, e com o boost a 64 m/s
       * isso dá 43 m para este. Mas essa conta não é a história inteira aqui, e
       * vale escrever o que foi MEDIDO contra este arquivo: um lutador que
       * arranca de lado no instante do tiro escapa **em qualquer distância** —
       * 0 s de exposição a 50, 100 e 200 m, e 0,02 s (1,2 de dano) a 400 m,
       * contra os 2,3 a 2,7 s que mata quem fica no eixo.
       *
       * As duas metades da fuga são diferentes, e é por isso que ela vale em
       * toda a escala: PERTO, o jogador ganha a corrida angular; LONGE, quem
       * segura o feixe é o `arcMax` — ele gasta os 40° e para de corrigir. O
       * teto não é só uma trava contra o bumerangue: é a metade da escapatória
       * que a conta de velocidade angular não cobre.
       *
       * O que a curva compra, então, não é acertar quem foge: é acertar quem se
       * mexe sem se comprometer — quem deriva, quem recua em linha reta, quem
       * decide tarde — e punir quem fica no eixo. Que é a troca certa para um
       * golpe que custa a barra inteira e 1,05 s de pose.
       *
       * ------------------------------------------------------------- e `arcMax`
       *
       * É o "deve ter um limite essa curva", virado em número, e é uma trava
       * NOVA — a rajada, o Kienzan e o Galick Gun têm só teto de giro e prazo.
       * Prazo não é limite de curva: 85°/s por 1,4 s dariam 119°, e um feixe que
       * corrige 119° não persegue, ele CAÇA — volta por cima do ombro de quem
       * atirou. Com o teto em 40° o desvio lateral que ele compra é
       * `R·(1−cos40°)` = 54 m: sobra para pegar quem se mexeu, longe de um
       * bumerangue.
       *
       * O teto é também o que dá ao servidor um cone honesto para conferir o
       * acerto — ver `registrarQueimadura`, que sem ele cairia numa esfera de
       * 620 m em torno de quem atirou. */
      homing: {
        /** graus/s — teto de giro. Raio de curva de 229 m a 340 m/s. */
        turnRate: 85,
        /** graus — teto da correção TOTAL na vida do feixe. O limite da curva. */
        arcMax: 40,
        /** s — depois disto ele segue reto, sempre. */
        duration: 1.4,
        /** graus — meio-ângulo do cone. Fora dele, não corrige. */
        cone: 35,
        /** m — alcance da escolha de alvo. Só vale se `soTrava` cair. */
        acquire: 320,
        /* SÓ COM ALVO DESIGNADO — e o que conta como "designado" mudou.
         *
         * A regra nasceu como *"ele só faz curva quando o player está travado o
         * foco no inimigo"*, e ela continua valendo no que importa: o Kamehameha
         * não sai caçando sozinho. O que mudou foi existir uma SEGUNDA forma de
         * designar alguém — a mira assistida pelo cursor (`NAMEK.lock.mira`) —,
         * e o pedido é explícito de que ela vale para tudo: *"todos os poderes
         * seguem o player, não só o tiro rápido."*
         *
         * `soTrava` passou a significar "não adquire alvo sozinho", que é o que
         * ele sempre quis dizer: sem trava E sem ninguém sob o cursor, o feixe é
         * a reta que sempre foi. Quem resolve isso é `soltarEspecial`, através
         * de `LockOn.alvoDeAtaque`. */
        soTrava: true,
      },
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
      /* Corta de uma vez, como o disco e a Genki Dama.
       *
       * 50 e não 62: é o "qualquer poder grande que acertou em cheio deve tirar
       * metade da vida" aplicado sem exceção. Os três golpes de corte seco
       * (este, o Kienzan e o Kamehameha somado) valem a MESMA metade — o que os
       * separa passou a ser inteiramente forma, alcance e perseguição, que é
       * onde a diferença entre eles devia estar desde sempre. */
      damage: 50,
      /* 9,2 e não 6,4: a escala das crateras subiu (ver `craterBase`) e a régua
         deste golpe subiu com ela. Dá 26,3 m de boca — a bola tem 6,5 m de raio
         de morte e deixa um buraco quatro vezes maior que ela, que é a leitura
         de uma esfera densa arrebentando no chão. */
      power: 9.2,
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
      /** O disco corta de uma vez, não por segundo. Metade da vida, como todo
       *  poder grande — ver `galick.damage`. */
      damage: 50,
      /* 3,6 e não 1,4. O comentário antigo do arquivo chamava o buraco dele de
         "uma cicatriz e não uma cratera", e isso fazia sentido enquanto a régua
         de todo mundo era menor. Com a escala nova, 1,4 daria 12,2 m — já maior
         que o Kamehameha de antes — e continuaria sendo o menor do repertório,
         que é o lugar dele. 3,6 dão 17,6 m: o talho de uma lâmina de sete metros
         de diâmetro passando rente ao chão, que é o que se vê na referência. */
      power: 3.6,
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
      /* 5,2 s de pose, e não 3,6 — *"ela também deve precisar de mais tempo
       * para atirar, mais tempo criando."*
       *
       * O número tem uma trava dos dois lados e ela vale escrever, porque quem
       * mexer nele de novo precisa saber onde bate a cabeça:
       *
       * • PARA BAIXO, o windup é o aviso. Ele é o que dá a quem está do outro
       *   lado da arena tempo de ver a esfera crescendo, decidir e chegar — sem
       *   ele o golpe que apaga alguém seria um botão.
       * • PARA CIMA, ele é o preço. 5,2 s parado no ar, sem defesa, à vista de
       *   todo mundo, é mais que a barra inteira de carga (5,3 s) e mais que o
       *   dobro do atordoamento (2,4 s). Ou seja: **a janela em que alguém foi
       *   derrubado não cabe mais este golpe**, e isso é de propósito — a Genki
       *   Dama não é o remate de um combo, ela é a aposta.
       *
       * O som da carga acompanha (`genkiCarga`, 5,4 s): um windup mais longo que
       * o buffer deixaria o último segundo e meio em silêncio, que é justamente
       * o segundo e meio em que o jogador está mais exposto. */
      windup: 5.2,
      sustain: 7,
      /* ALCANCE HONESTO. Estava 700, e a vida do projétil é
         `min(sustain, range / speed)`: com a sustentação de então (4,5 s) a
         46 m/s ela nunca passava de **207 m**. O número grande não fazia nada
         além de mentir para quem fosse balancear o golpe — e a sala usa `range`
         para validar acerto, o que abria uma janela de 700 m para um golpe de
         207. Agora são 7 s a 46 m/s = 322 m, e o número aqui é esse. */
      range: 322,
      speed: 46,
      /* 16 m de raio — trinta e dois de diâmetro, dezoito vezes a altura de um
       * lutador. *"Aumente mais o tamanho da Genki Dama."*
       *
       * Era 11, e 11 já era o maior raio de morte do jogo. O que 16 muda não é
       * a conta de quem morre (ela já matava todo mundo que encostava): é a
       * ESCALA na tela. A referência mostra uma lua — uma coisa maior que o
       * cenário à volta —, e a 200 m de distância uma esfera de 22 m de diâmetro
       * lê como uma bola grande, não como um astro. Com 32 m ela cobre um quinto
       * da tela àquela distância, e não há mais como confundi-la com o Galick
       * Gun, que é o outro golpe esférico do repertório (13 m de diâmetro).
       *
       * O raio de morte cresceu junto porque no `powers/orb.js` ele É o desenho:
       * a esfera é escalada por `hitRadius`, e o comentário do Kamehameha vale
       * aqui igual — tudo o que parece sólido tem de matar, e morrer do lado de
       * fora do que se vê é a reclamação que nenhum ajuste de número conserta. */
      hitRadius: 16,
      /* A VIDA INTEIRA. "A Genki Dama deve tirar a vida inteira do player que
       * mirou, inclusive de outros players que estiverem na explosão dela."
       *
       * 96 era um golpe que quase mata: quem estivesse com a barra cheia de vida
       * sobrevivia com 4 e voltava atirando, o que apagava a única coisa que
       * justifica 3,6 s parado no ar carregando a bola à vista de todo mundo.
       * 100 é exatamente `maxHealth`, e a leitura é a da referência — quem for
       * pego pela Genki Dama não levanta.
       *
       * A segunda metade do pedido ("inclusive de outros players") já era
       * verdade no código e agora vale a pena registrar por quê: a detonação
       * varre TODOS os alvos dentro dos 11 m de raio e emite uma queimadura por
       * um deles (ver `detonar`, em `powers/orb.js`), e a sala cobra cada vítima
       * uma vez (`exposicao`, em `registrarQueimadura`). Onze metros de raio
       * pegam um grupo inteiro, e agora cada um deles morre. */
      damage: 100,
      /* 44, e com o teto de `craterMax` subindo junto para 52 m: a esfera dobrou
         de volume, e um buraco do mesmo tamanho de antes leria como se ela
         tivesse encolhido no impacto. `craterBase` 3,2 + 7,6·√44 = 53,6 m, então
         ela bate no teto — e bater no teto aqui é o certo: o golpe mais caro do
         modo deve abrir o maior buraco que o jogo aceita, e o teto existe contra
         potência absurda vinda da rede, não contra este golpe. */
      power: 44,
      cor: 0x9ff0ff,

      /* ELA PASSOU A PERSEGUIR — e este bloco desmente, de propósito, um "nunca
       * vai perseguir" que estava escrito em `orb.js` e aqui.
       *
       * O que mudou foi o pedido: "todos os poderes devem perseguir o player,
       * alguns perseguem mais, outros menos". A Genki Dama era, com o
       * Kamehameha, uma das duas retas puras do repertório.
       *
       * Ela é a que MENOS persegue de todas, e por larga margem — 20°/s contra
       * os 26 da rajada, os 55 do Galick Gun e os 70 do Kienzan. O motivo é o
       * mesmo que antes recomendava não perseguir nada: 96 de dano com 11 m de
       * raio de morte é o golpe que apaga alguém, e uma perseguição de verdade
       * o transformaria numa sentença.
       *
       * O que sobrou é a correção que perdoa movimento e nada além disso. A
       * 46 m/s, 20°/s (0,349 rad/s) fecham uma curva de **132 m de raio**, e a
       * conta da fuga (`v > ω·d`, ver `flySpeed`) diz que quem arranca de lado
       * com o boost escapa dela a **até 183 m** — a maior distância de fuga do
       * jogo inteiro. Contra os 43 m do Kamehameha, é outra categoria de golpe:
       * ele te alcança, ela só te acompanha.
       *
       * Ela NÃO tem `soTrava`: 3,6 s parado carregando a bola já são
       * comprometimento de sobra, e cobrar a trava por cima seria cobrar duas
       * vezes pelo mesmo gesto. */
      homing: {
        turnRate: 20,
        /** graus — teto da correção total. Ver `kamehameha.homing.arcMax`. */
        arcMax: 50,
        duration: 4,
        /** graus — cone largo: a bola é enorme e vira devagar. */
        cone: 45,
        acquire: 300,
      },
    },
  },

  /** A ordem dos especiais nas teclas 1–4 e no HUD. */
  specialOrder: ["kamehameha", "galick", "disk", "genki"],

  /* ===================================================================== trava
     A TRAVA DE ALVO — e a regra que manda em tudo aqui é uma frase:

         **LOCK-ON ≠ CÂMERA FIXA NO INIMIGO.**

     A trava é ASSISTÊNCIA DE COMBATE. Ela diz quem é o alvo; ela não diz para
     onde o corpo vai, não puxa ninguém para lugar nenhum e não tira do jogador
     um grau de liberdade sequer. O que ela entrega é: os ataques sabem em quem
     mirar, a câmera sabe o que manter no quadro, e o corpo ganha uma correção
     de rumo — forte na hora do golpe, quase nula enquanto se voa.

     O que estava aqui antes atendia a metade disso e falhava na outra: a câmera
     saía de trás do lutador e ia para cima da LINHA que o liga ao alvo, olhando
     para um ponto a 42 % do caminho. Voar de lado passava a mostrar o lutador de
     perfil cruzando a tela; dar a volta no inimigo girava a lente junto, à
     mesma velocidade angular do jogador. Era câmera presa ao inimigo, que é
     justamente o que não se quer.

     Os três blocos abaixo são os três sistemas que o §17 do pedido separa —
     seleção de alvo, câmera, assistência de mira — e eles são independentes de
     propósito: a câmera LÊ a trava e não manda nela, o combate LÊ a trava e não
     manda nela, e o movimento não a conhece.

     Quem implementa é `src/namek/lockon.js` (o alvo), `src/namek/camera.js`
     (o enquadramento) e `src/namek/game.js` (a costura). */
  lock: {
    /* ============================================== a MIRA ASSISTIDA (soft)
     *
     * **Um alvo sem trava**, escolhido a cada quadro por quem está mais perto do
     * CURSOR na tela. É o pedido, e ele descreve exatamente o problema que a
     * trava não resolve:
     *
     *   *"os poderes sempre devem ir no player cujo cursor está mais próximo. Se
     *   o cursor estiver muito longe, aí os poderes saem retos… dessa forma o
     *   player consegue atirar em vários players movendo o mouse rapidamente,
     *   sem ter que ficar preso a algum player."*
     *
     * A diferença para a trava (`R`) é o COMPROMISSO. A trava é uma decisão que
     * dura: ela muda a câmera, sobrevive ao alvo sair da tela, e é o preço da
     * curvatura do Kamehameha. A mira assistida não decide nada — ela é uma
     * leitura do quadro atual, morre no quadro seguinte, e a única coisa que ela
     * faz é dizer aos projéteis para onde ir.
     *
     * Por isso ela **não mexe na câmera e não tem anel vermelho**: o pedido é
     * literal sobre isso ("sem travar a câmera, sem a parte vermelha nem nada").
     * O aviso é o círculo que cada lutador já tem mudando de cor — ver
     * `NamekHud.setAneis`.
     *
     * A trava GANHA quando existe: ela é a intenção declarada do jogador, e uma
     * mira automática que a contradissesse seria o software desfazendo uma
     * decisão explícita. Ver `LockOn.alvoDeAtaque`.
     */
    mira: {
      /* Raio da zona, em frações da MEIA-ALTURA da tela.
       *
       * Em frações e não em pixels porque a tela do jogador não é a nossa; e da
       * meia-altura (com o `x` corrigido pela proporção) porque a zona tem de ser
       * um CÍRCULO na tela — medida em NDC cru ela seria uma elipse achatada, e
       * um alvo à direita entraria na assistência antes de um alvo acima, à
       * mesma distância aparente.
       *
       * 0,26 são 13 % da altura da tela. É generoso o bastante para o gesto que
       * o pedido descreve (varrer o mouse por três adversários e atirar em cada
       * um) e apertado o bastante para nunca haver dúvida sobre em quem o tiro
       * vai — a esta distância só cabe um corpo. */
      raioTela: 0.26,
      /* NÃO HÁ ALCANCE MÁXIMO AQUI, e a ausência é o conserto de uma queixa:
       * *"estou lá no teto, no céu, no ponto mais alto, e os jogadores estão
       * todos no chão — esse efeito não funciona."* Havia um teto de 260 m, e o
       * teto de voo são 520: do alto a assistência simplesmente não existia.
       *
       * Não virou um número maior porque um número maior é a mesma queixa
       * adiada. Quem limita a zona é `raioTela`, e ele já é um critério ANGULAR
       * — uma fração da abertura da lente, não metros de mundo. Ele se sente
       * idêntico a 20 m e a 800 m (levar o retículo para o lado solta o foco
       * exatamente no mesmo ângulo) e responde sozinho à única pergunta que a
       * mira assistida faz: *o cursor está em cima de alguém?* A distância a
       * esse alguém nunca fez parte da pergunta — quem cobra distância é o
       * PROJÉTIL, que tem alcance próprio (`blast.life`, `range` de cada
       * especial) e morre no caminho quando o tiro foi longe demais. */
      /** graus — meio-ângulo de segurança. A zona de tela já exclui quem está
       *  atrás, MENOS no caso degenerado de um alvo quase no plano da lente, em
       *  que a projeção explode. Este cone é a guarda contra esse caso. */
      cone: 70,
    },

    /* ----------------------------------------------------- seleção de alvo */
    /* m — a RÉGUA da distância, e ela deixou de ser uma parede.
     *
     * Era o alcance máximo: além de 420 m não se travava, e o que já estivesse
     * travado caía. Isso pôs um teto na trava mais baixo que o teto de voo (520
     * m), então subir ao céu para procurar quem estava no chão desligava
     * justamente o sistema que serve para achar quem está longe. Hoje não existe
     * distância que impeça de travar nem distância que solte a trava — quem
     * solta é o alvo sair do quadro (ver `perda`), que é uma condição que o
     * jogador controla e entende.
     *
     * O número continua aqui porque duas contas precisam de uma escala: a nota
     * de `proximidade` na hora de escolher entre dois candidatos (`_melhor`), e
     * o `avisoEm` que faz o anel piscar. Nas duas ele diz "a partir daqui é
     * longe", e em nenhuma ele diz "a partir daqui não vale". */
    alcance: 420,
    /** graus — meio-ângulo do cone de aquisição. Generoso, mas não "atrás de
     *  mim": travar em quem está às costas seria travar por engano. */
    cone: 55,
    /* Peso da DISTÂNCIA AO CENTRO DA TELA contra a distância no espaço, na hora
     * de escolher.
     *
     * O jogador aponta para quem ele quer brigar — essa é a intenção declarada,
     * e ela ganha. Mas com peso 1 (só o centro da tela), um adversário a 300 m
     * exatamente no eixo vencia um a 20 m três graus fora, o que é sempre a
     * escolha errada numa briga colada. 0,72 é o meio: manda quem está mirado,
     * e o desempate é a proximidade. */
    viesDaMira: 0.72,

    /* ------------------------------------------------------------- a perda
       "Não perder o lock simplesmente porque o inimigo saiu por alguns frames
       da tela" — o pedido é explícito, e por isso a perda é um RELÓGIO e não uma
       condição instantânea. O alvo pode sair do quadro, passar por trás de uma
       montanha e voltar; o que derruba a trava é ele ficar inalcançável por
       tempo suficiente. */
    perda: {
      /** s fora do quadro antes de a trava cair. É a ÚNICA perda por relógio que
       *  existe: a distância saiu da conta junto com a parede de `alcance`. */
      tempo: 2.5,
      /** Fração de NDC além da qual o alvo conta como "fora do quadro". Maior
       *  que 1 de propósito: uma margem além da borda da tela, para quem está
       *  raspando o canto não começar a contagem. */
      margem: 1.3,
      /** Fração de `alcance` a partir da qual a trava começa a piscar no HUD.
       *  É o "a indicação visual pode informar que o alvo está distante". */
      avisoEm: 0.8,
    },

    /* ------------------------------------------------------- assistência ---
     * A correção de rumo que a trava dá ao CORPO, em rad/s de velocidade
     * angular. Ela nunca é uma atribuição de ângulo: é um teto de giro, e um
     * teto de giro pode sempre ser vencido pelo mouse — que é o que garante que
     * o jogador continua no controle.
     *
     * Os quatro valores são a escada do §8 do pedido: fraca voando, forte
     * atacando, mais forte ainda no corpo a corpo.
     */
    assist: {
      /* rad/s — só voando.
       *
       * 0,25 rad/s são 14°/s, e o número veio de uma MEDIDA: com 0,7 (40°/s),
       * virar a mira 60° para longe do inimigo era desfeito pela assistência em
       * um segundo e meio. Isso não é "correção leve", é o software decidindo
       * para onde o jogador olha — e o §8 do pedido é explícito sobre a
       * assistência ter de ser fraca justamente quando se está só voando.
       *
       * Com 14°/s ela endireita quem está à deriva ao longo de vários segundos
       * e não briga com ninguém que decidiu virar: um movimento de mouse comum
       * gira dez vezes isso num quadro só. */
      passiva: 0.25,
      /** rad/s — durante e logo depois de um ataque. */
      ataque: 4.5,
      /** rad/s — dentro do alcance de corpo a corpo. */
      perto: 8,
      /** m — o que conta como corpo a corpo para a assistência. */
      alcancePerto: 20,
      /** s — quanto a assistência forte dura depois do último ataque. Sem esta
       *  cauda, a correção viveria um quadro e não corrigiria nada. */
      janela: 0.35,
      /** Fração da assistência que sobra quando o jogador está MANOBRANDO (com
       *  entrada lateral ou vertical). É o "mais fraca quando está tentando
       *  escapar ou se reposicionando": quem vira de propósito não é
       *  desvirado. */
      manobra: 0.2,
    },

    /* ------------------------------------------------------------- câmera --
     * O ENQUADRAMENTO, e ele é o coração do pedido §4–§6.
     *
     * A câmera NÃO aponta para o inimigo. Ela mantém uma ZONA da tela em que o
     * alvo deve permanecer, e só se mexe quando ele sai dessa zona — e aí só o
     * bastante para trazê-lo de volta à borda dela. É a diferença entre uma
     * lente que persegue e uma que acompanha.
     */
    camera: {
      /** graus — meia-abertura da ZONA MORTA angular. Enquanto o ponto de
       *  interesse estiver dentro dela, a lente não gira nada. 9° numa tela de
       *  68° de campo é um quinto da largura: espaço de sobra para o alvo
       *  derivar sem arrastar a imagem junto. */
      zona: 9,
      /** rad/s — teto da velocidade de giro da lente. É o que impede a câmera de
       *  acompanhar um giro brusco do alvo: ela fica para trás, de propósito, e
       *  alcança depois. Sem teto, um adversário passando rente varre a tela. */
      giroMax: 2.2,
      /* m a mais de braço por metro de separação.
       *
       * 0,045 e não 0,14, e o teto caiu de 26 m para 11 m. O relato foi direto:
       * *"com o lock-in a câmera está ficando muito afastada; a câmera deve
       * ficar bem mais perto do player."*
       *
       * O que estava errado era a régua. Com 0,14, brigar a 60 m de distância —
       * que é a distância NORMAL deste modo — punha a lente a 15 m do peito,
       * mais que o dobro dos 6,6 m do voo livre; a 140 m ela batia no teto de
       * 26 m e o lutador virava um boneco de brinquedo no meio da tela. O braço
       * estava tentando fazer sozinho o trabalho de manter os dois no quadro, e
       * esse trabalho hoje é de outra peça: o campo de visão abre (`fovExtra`) e
       * o ponto de interesse desliza para o meio (`vies`) conforme a separação
       * cresce. Somando os três, a câmera recuava três vezes pelo mesmo motivo.
       *
       * Com 0,045 a 60 m dão 9,3 m e o teto de 11 m só é atingido a partir de
       * ~100 m. O enquadramento fica perto do voo livre — que é o pedido — e o
       * adversário continua cabendo, porque quem o mantém no quadro é a lente
       * abrindo, não a câmera fugindo. */
      ganho: 0.045,
      /** m — braço máximo. Pouco acima do braço de voo livre em arrancada
       *  (6,6 + 5,2 = 11,8): a trava não pode afastar mais que um mergulho. */
      distMax: 11,
      /** Onde a lente olha, entre o peito do lutador (0) e o alvo (1). Puxado
       *  para o lutador — ele é quem o jogador controla, e o alvo só precisa
       *  CABER no quadro, não ocupar o centro. */
      vies: 0.34,
      /** Quanto o braço da câmera segue a linha até o alvo em vez do olhar do
       *  próprio lutador, no combate COLADO (0) e no DISTANTE (1).
       *
       *  É a peça que desfaz a "câmera presa": de perto ela fica atrás do
       *  OLHAR do jogador (ele manobra, a lente vai junto) e de longe ela se
       *  alinha com a linha até o alvo (que é o único jeito de os dois caberem
       *  no quadro). No meio, mistura. */
      alinhaPerto: 0.15,
      alinhaLonge: 0.8,
      /** m — onde acaba o "perto" e começa o "longe" da mistura acima. */
      perto: 25,
      longe: 130,
      /** graus de campo de visão a mais quando o alvo está no limite do quadro.
       *  É o "se necessário, aumentar temporariamente o campo de visão". */
      fovExtra: 12,
    },
  },

  /* -------------------------------------------------------------- destruição
     Ver §7 do plano. A conta da cratera é COMPARTILHADA de propósito: os dois
     lados precisam chegar ao mesmo buraco, ou duas abas veem chões diferentes. */
  destruction: {
    /* ------------------------------------------------- a escala das crateras
     *
     * Os três números abaixo subiram juntos, e o pedido explica por quê: *"ao
     * fazer crateras, todas elas devem ficar mais fundas… as crateras dos
     * poderes pequenos devem ser bem maiores; inclusive aumente o tamanho das
     * crateras de todos os poderes. O objetivo é fazer a ilha ficar totalmente
     * destruída no final da batalha."*
     *
     * "Totalmente destruída" é um requisito de ORÇAMENTO, não de estética: numa
     * partida de dez minutos a soma das crateras tem de cobrir a clareira. Com
     * os valores antigos uma bola de ki abria 4,1 m e um Kamehameha 13,3 m —
     * uma clareira de 300 m de diâmetro (70 000 m²) precisaria de mil e
     * duzentos Kamehamehas para ficar coberta. A rajada, que é o que sai o
     * tempo todo, mal marcava.
     *
     * Agora a rajada abre 8,3 m e o Kamehameha, 9 m de boca com 20 m de fundo
     * (ver `craterDeep` no golpe). O que muda de verdade é a base: com 3,2 m,
     * QUALQUER coisa que encoste no chão deixa buraco de gente, e é a soma
     * desses buracos — não os quatro especiais — que come a ilha.
     *
     * `craterDepth` de 0,35 para 0,62 é o "mais fundas" literal. Ele não faz a
     * cratera virar poço porque a bacia é um cosseno elevado (`craterDelta`):
     * fundo redondo, parede que suaviza na borda. O que ele muda é que dá para
     * ENTRAR no buraco — 8,3 m de boca por 5,1 m de fundo é uma bacia em que um
     * lutador de 1,78 m se esconde, e era isso que faltava para a destruição
     * ser terreno em vez de textura. */
    /** m — raio base de qualquer cratera. */
    craterBase: 3.2,
    /** m — quanto o raio cresce com a raiz da potência. */
    craterGain: 7.6,
    /** fração do raio que vira profundidade. */
    craterDepth: 0.62,
    /** m — maior cratera aceita. Trava contra potência absurda vinda da rede.
     *  52 acompanha a Genki Dama, que dobrou de tamanho (ver `genki.hitRadius`):
     *  um buraco de 44 m debaixo de uma esfera de 32 m de diâmetro leria como se
     *  ela tivesse encolhido ao encostar no chão. */
    craterMax: 52,
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
     * O corte caiu para 0,1 quando a fila deixou de existir: a rajada (0,12)
     * passou a marcar, e insistir no mesmo ponto AFUNDA o buraco em vez de
     * gastar vaga (ver `NamekField.addCrater`). O corte continua aqui só para
     * um golpe de potência zero não pedir cratera nenhuma.
     */
    craterMinPower: 0.1,
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
     * aberto por um corpo, que é a leitura certa de alguém arrancado do céu. */
    slamPower: 0.13,

    /* -------------------------------------------- por que não há teto de fila
       Havia aqui um `craterMerge` (não cavar duas vezes no mesmo buraco) e um
       `craterDepthMax` (teto da soma das crateras). Os dois existiam para
       conter um efeito da arquitetura ANTIGA: `heightAt` somava o perfil de
       toda cratera próxima, então buracos empilhados afundavam sem fim e ainda
       encareciam a consulta.

       O mapa de deslocamento (`NamekField`) tirou o problema pela raiz. A
       cratera é assada na grade uma vez e a consulta lê quatro células, custe
       o que custar a partida — e o teto de profundidade passou a ser da GRADE
       (`DESL_MIN`), não de uma regra de negócio.

       E a regra de não cavar duas vezes foi INVERTIDA de propósito, a pedido:
       insistir no mesmo ponto tem de afundar o buraco. Quem impede o poço sem
       fundo é o teto da grade; quem impede o registro de inchar é a fusão em
       `addCrater`. */

    /* ------------------------------------------------------------- lava ----
       Cavar fundo o bastante FURA A CROSTA, e o que estava embaixo sobe.

       O nível fica abaixo da linha d'água de propósito: é a leitura de "o
       buraco chegou onde não devia". Um buraco raso não acende nada; é preciso
       atravessar a terra toda, e só a insistência (ou uma Genki Dama num ponto
       já cavado) chega lá. */
    lava: {
      /* m — a cota em que a lava assenta. **Bem abaixo do mar (−8).**
       *
       * Era −14, e o pedido foi *"a lava deve ficar mais funda"*. O número não é
       * de gosto: ele decide quanto de PAREDE existe entre a boca do buraco e a
       * poça, e é essa parede que faz o poço ler como poço.
       *
       * Com −14 e um relevo de clareira a +1,2, sobravam quinze metros — o
       * bastante para o buraco ser uma bacia com fundo laranja, e não o bastante
       * para ele ser um poço. Com −28 são quase trinta metros de rocha em volta,
       * e as camadas de cor que o terreno pinta por profundidade (terra, marrom
       * escuro, rocha cinza, brasa) ganham espaço para acontecer todas antes de
       * a lava aparecer — hoje elas ficavam espremidas.
       *
       * O custo é quanto se cava para chegar lá, e ele foi medido: um Kamehameha
       * abre 19,5 m de fundo e não chega; dois chegam. A rajada precisa de ~8
       * tiros no mesmo ponto. Isso é uma conquista, que é o que ela deve ser. */
      nivel: -28,
      /** m — o fundo tem de passar disto para a poça acender. */
      gatilho: -32,
      /** dano por segundo em quem encosta. Alto: é para doer, não para coçar. */
      dano: 34,
      /** m — quanto acima da superfície da lava o toque ainda conta. */
      margem: 1.8,
      /** m — teto do raio de uma poça, por segurança contra número absurdo. */
      raioMax: 40,
    },
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
/**
 * @param {number} power
 * @param {number} [fundo] multiplicador SÓ da profundidade — o jeito de pedir
 *   um buraco estreito e fundo, que a potência sozinha não sabe expressar
 *   (ela move raio e fundura juntos, porque a fundura é uma fração do raio).
 *   Ver `NAMEK.specials.kamehameha.craterDeep`, que é quem o usa.
 *
 *   Ele é aparado em [0,25 · 6] aqui, e não em quem chama, porque ele VIAJA NA
 *   REDE (`NC2S.GROUND_HIT.df`): o número vem de um cliente, e um multiplicador
 *   absurdo aqui é um poço de trezentos metros no chão de todo mundo. O piso
 *   existe pelo motivo espelhado — zero ou negativo transformaria a cratera num
 *   morro.
 */
export function craterFor(power, fundo = 1) {
  const p = Math.max(0, Math.min(power, 64));
  const D = NAMEK.destruction;
  const f = Number.isFinite(fundo) ? Math.max(0.25, Math.min(fundo, 6)) : 1;
  const raio = Math.min(D.craterMax, D.craterBase + D.craterGain * Math.sqrt(p));
  return { raio, fundura: raio * D.craterDepth * f };
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
