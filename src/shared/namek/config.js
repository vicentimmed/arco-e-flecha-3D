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

import { FREEZA } from "./ajustes-freeza.js";

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

  /* ================================================================ desenho
     A QUALIDADE — e por que ela precisou existir aqui.

     *"Faça um ajuste de performance nessa fase… para que a fase fique leve, sem
     exigir muito da placa de vídeo, e fique compatível com a fase do vale, que é
     uma fase em que os players conseguem jogar sem travar. Mas não pode ter
     muitas perdas gráficas. A questão de enxergar de longe é necessária, pois é
     um jogo em que os players voam e veem tudo de longe."*

     A maior diferença medida entre esta fase e a do Vale não era o cenário: era
     que **este modo ignorava o preset de qualidade que o jogador escolheu no
     lobby.** O Vale lê `CONFIG.render.presets[q].maxPixelRatio` — 1 no `low`,
     1,5 no `medium`, 2 no `high` — e o Namekusei tinha `min(devicePixelRatio, 2)`
     chumbado. Numa tela de razão 2 com qualidade "baixa", isso são **quatro
     vezes mais fragmentos** por quadro: a mesma máquina que roda o Vale liso
     engasga aqui, e nenhuma otimização de cenário compensa um fator quatro.

     ------------------------------------------------- por que não importar `config.js`

     Porque `src/namek/` não importa `src/config.js` — é uma regra do modo (§0 do
     plano) e ela existe por um bom motivo: aquele arquivo carrega o jogo do
     arqueiro inteiro, com os modos, as fases, as armas e o zumbi. O que se faz
     aqui é ler a MESMA chave de `localStorage` que o lobby grava
     (`arcoflecha.quality`), com a mesma escada de valores, e nada mais.

     ------------------------------------------------------ e o que NÃO entra aqui

     **Nenhuma distância.** Nem alcance de desenho, nem corte de LOD, nem raio de
     mundo, nem `far` de câmera. A regra do pedido é explícita e ela é o eixo do
     jogo: quem voa vê tudo de longe. O que a qualidade mexe é o custo POR PIXEL
     (a resolução interna, o antisserrilhado, o tamanho do mapa de sombra) e a
     DENSIDADE do que já é invisível a distância (o mato ao rés do chão) — nunca
     o que se enxerga do alto.

     E nada aqui toca a DESTRUIÇÃO. As crateras, o terreno deformado e as peças
     que caem continuam exatamente como estão em qualquer qualidade: o pedido é
     literal em que a destruição deve continuar visível como está hoje. */
  render: {
    /** A mesma chave que o lobby do arqueiro grava. Ler dela é o que faz a
     *  escolha do jogador valer nas duas fases sem um segundo menu. */
    chave: "arcoflecha.quality",
    presets: {
      low: { pixelRatio: 1, antialias: false, sombra: 512, mato: 2600 },
      medium: { pixelRatio: 1.5, antialias: true, sombra: 1024, mato: 4600 },
      high: { pixelRatio: 2, antialias: true, sombra: 2048, mato: 7000 },
    },
    /** O que vale quando não há escolha guardada. `high` mantém o comportamento
     *  de antes para quem nunca abriu o menu de qualidade. */
    padrao: "high",
  },

  /* ===================================================================== sol
     O SOL DE NAMEKUSEI — e as três vidas dele.

     Ele era desenho puro: três números dentro de `world/sky.js`, invisíveis para
     a sala e para qualquer outra coisa. Passou a ser ALVO, e por isso a
     descrição dele subiu para cá — o teste do acerto acontece no servidor
     (`server/namek/sol.js`) e o servidor não pode importar um módulo que
     `import * as THREE`.

     ------------------------------------------------------------- o que ele faz

     *"Esse modo Namekusei também é ativado se 3 Kamehamehas atingirem o sol.
     Eles não precisam estar juntos, mas é como se o sol tivesse três vidas e, no
     último Kamehameha, depois dos três, ele explode, ativando várias partículas,
     pegando fogo em Namekusei. E aí entra o modo de Namekusei destruído, assim
     como se fosse ativado pelo menu."*

     Ou seja: o sol é um SEGUNDO BOTÃO para a mesma alavanca que o menu já tem
     (`weather = "tempestade"`), com um preço de três barras de ki cheias e uma
     pontaria de 3° pagos no meio de uma partida. Nada aqui inventa uma fase
     nova — `NamekSol` chama `pedirClima("tempestade")` e a máquina de estados de
     `fim.js` faz o resto exatamente como faria pelo menu.

     O caminho do acerto é **o mesmo dos dois planetas** (`NC2S.PLANET_HIT`, ver
     `planetas`), e ser o mesmo é o ponto: o cliente testa a direção travada no
     disparo contra o disco, a sala confere o ângulo contra a MESMA direção e o
     mesmo raio, e a folga de 3° cobre a diferença entre medir do peito de quem
     atirou e medir da origem do mundo. */
  sol: {
    /* A direção, normalizada. **É a fonte única** — `world/sky.js` lê daqui para
       desenhar o disco E para apontar a luz direcional, e o mar lê a mesma coisa
       para pôr o rastro especular no lugar certo. Um segundo literal em qualquer
       um desses arquivos seria o erro clássico deste cenário: o sol pintado num
       canto e a sombra caindo do outro. */
    dir: [0.705, 0.53, 0.471],

    /* rad — o raio ANGULAR do disco. Era 0,105 (12° de diâmetro, 17,6 % da
     * altura da tela), e o pedido foi literal: *"inclusive, diminua um pouco o
     * tamanho do sol. Ele está muito grande."*
     *
     * 0,078 dão 8,9° de diâmetro, ou 131 px a 1080p. A escada de referência do
     * próprio céu: Kuraia tem 16,1° e Rubel 11,2°, então o sol volta a ser MENOR
     * que as duas luas — que é a proporção de um corpo distante e brilhante
     * contra dois corpos próximos e opacos, e continua grande o bastante para
     * ninguém confundir qual dos três é a fonte de luz (ele é o único que
     * estoura em branco no miolo).
     *
     * O piso é a mira: com este raio o cone de acerto do Kamehameha é
     * 4,45° + 3° de folga, o que continua sendo um alvo que se acha voando —
     * bem mais largo que o corpo de um lutador a cem metros. */
    raio: 0.078,

    /** Quantos Kamehamehas ele aguenta. "É como se o sol tivesse três vidas" —
     *  e eles NÃO precisam ser do mesmo jogador nem sair juntos. */
    vidas: 3,

    /** graus — a folga angular do teste de acerto, a mesma dos planetas e pela
     *  mesma razão (ver §2 de `server/namek/planetas.js`): ela cobre o quarto de
     *  grau entre o ângulo medido da mão e o medido da origem do mundo, com uma
     *  ordem de grandeza de sobra. */
    folga: 3,

    /* s — quanto o clarão da explosão dele leva para se dissipar na tela. Ele é
     * mais longo que o de um golpe porque o que explodiu está a uma distância
     * astronômica: o que se vê não é um estouro, é o céu inteiro trocando de
     * cor. Ele corre POR CIMA da virada de clima (`weather.fade`, 8 s), que é o
     * que de fato escurece o céu. */
    estouro: 6,
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

  /* ===================================================================== fim
     O FIM DE NAMEKUSEI — o planeta explode, e quem não subir a tempo morre com
     ele.

     O pedido inteiro, em ordem: *"quando entrar no modo que namecusei vai
     explodir, o Freeza deve entrar. Depois de matar o Freeza entra uma contagem
     de 1 minuto para o planeta explodir. Se o planeta explodir com eles dentro
     todos os players morrem. Mas se eles voarem em direção ao céu… eles saem do
     planeta e entram no espaço… Uma vez no espaço eles podem continuar lutando
     ali."*

     E o ajuste que veio depois, que é o que decide a régua da fuga: *"em vez de
     ter que voar X minutos, a fuga é baseada somente em metros mesmo. Ele tem
     que sair do planeta antes que ele exploda."* Existe UM relógio no fim — o do
     planeta — e a fuga é geometria. Ver `fuga`.

     ------------------------------------------------------------ a máquina toda

       calmo ──(clima = tempestade)──▶ freeza ──(Freeza morre)──▶ contagem
         ▲                              │                            │
         │                              │(clima = dia)               │(0 s)
         └──────────────────────────────┴──────────────────┐         ▼
                                                           │    explodindo
                                        (clima = dia)      │         │(6 s)
                                                           └──── espaco

     Quem manda é a SALA (`server/namek/fim.js`). O cliente desenha o portal,
     conta os metros que faltam e mostra o relógio — e não decide nada.

     -------------------------------------------------- por que o gatilho é o clima

     `tempestade` já era, por escrito, *"o planeta indo embora… é a batalha contra
     Freeza nos cinco minutos finais"* (§1 do plano). Pendurar a entrada do Freeza
     nela não é reaproveitamento preguiçoso: é a única forma de o botão que já
     existe no menu significar o que ele sempre disse que significava. Voltar para
     `dia` desfaz tudo — o Freeza sai, o relógio para, o planeta continua. */
  fim: {
    /* ------------------------------------------------------------- o Freeza --
     *
     * Quem o constrói NÃO é este módulo (ver `server/namek/fim.js`, que fala com
     * ele por `entrar()`, `sair()`, `vivo` e `aoMorrer`). O que mora aqui são as
     * duas decisões que são de JOGO e não dele. */
    freeza: {
      /** s — espera entre o céu virar e ele aparecer. O `weather.fade` são 8 s;
       *  chegar antes de o céu terminar de fechar é chegar num cenário que ainda
       *  está sendo pintado. */
      entrada: 6,
      /**
       * s — o PLANO B, e ele existe por causa da ordem em que este modo foi
       * escrito: o Freeza é de outro arquivo, e enquanto ele não existir a
       * tempestade levaria a lugar nenhum — sem inimigo para matar, a contagem
       * nunca começaria e o fim do planeta seria código morto.
       *
       * Passado este tempo SEM um `sala.freeza` em pé, a contagem começa
       * sozinha. Com o Freeza instalado a linha nunca dispara, porque o objeto
       * existe desde o primeiro quadro da tempestade.
       */
      esperaMax: 24,
    },

    /* s — A CONTAGEM, e ela é o ÚNICO relógio do fim. O pedido é literal: "uma
     * contagem de 1 minuto para o planeta explodir".
     *
     * Sessenta segundos são o número do pedido, e desde que a fuga passou a ser
     * só altitude (ver `fuga`) eles são também a régua inteira do desafio: a
     * pergunta que o jogador se faz deixou de ser "consigo sustentar subida?" e
     * passou a ser **"este minuto chega para eu vencer esta altura?"**. Toda a
     * dificuldade está na conta que `fuga.altitude` documenta — mexer aqui é
     * mexer nela. */
    contagem: 60,

    /* ------------------------------------------------------------ a explosão */
    explosao: {
      /** s — quanto o clarão, a onda de choque e o planeta se desfazendo duram
       *  antes de a sala declarar o espaço. É o tempo do ESPETÁCULO: curto
       *  demais e a morte de um planeta vira um corte de cena. */
      duracao: 6,
      /** m/s — velocidade da onda de choque saindo do centro da arena. A 900 m/s
       *  ela varre os 760 m do raio de passeio em 0,85 s, que é o que faz dela
       *  uma onda e não um anel crescendo. */
      onda: 900,
      /** m — até onde a onda vai antes de sumir. Maior que `flyRadius` de
       *  propósito: ela tem de passar POR fora de quem está na borda. */
      alcance: 2600,
      /** s — quanto o clarão branco leva para tomar a tela, e quanto ele leva
       *  para sair. Entra num piscar; sai devagar, porque é a retina. */
      clarao: [0.12, 3.2],
      /** m/s² — tremor de câmera no instante zero. Três vezes o pior raio da
       *  tempestade: nada neste modo sacode mais que isto. */
      tremor: 1.8,
    },

    /* =================================================================== fuga
       **A FUGA É SÓ ALTITUDE.** O pedido, na segunda versão dele: *"a fuga é
       baseada somente em metros mesmo. Ele tem que sair do planeta antes que ele
       exploda."*

       --------------------------------------------------- o que isto substituiu

       Havia aqui um relógio pessoal: trinta segundos de subida sustentada, com
       uma faixa de tolerância para o desvio e um recuo ao dobro para quem
       descia. Ele media ESFORÇO, e medir esforço num jogo de voo livre é dizer
       ao jogador que existe um jeito certo de segurar a tecla — a fuga virava
       um exercício de manter `vy` acima de um limiar, e não uma corrida.

       Agora existe UM relógio só, o do planeta (`contagem`), e a fuga é
       geometria pura: **chegar à boca do portal antes de a contagem zerar.**
       Duas consequências que valem escrever, porque são o motivo da troca:

       • O desafio virou uma pergunta de recurso, não de técnica: *dá tempo?* E a
         resposta depende de coisas que o jogador já entende — a que altura ele
         estava, quanto ki ele tem, e se ele parou para brigar no caminho.
       • Desviar de um golpe deixou de custar progresso. Só custa TEMPO, que é a
         mesma moeda de todo o resto do minuto final.

       O portal continua sendo um LUGAR, e não uma cota: é ele o "indicativo no
       céu para o lugar que eles têm que voar" do pedido original. */
    fuga: {
      /* m — A BOCA DO PORTAL, e ela é o desafio inteiro.
       *
       * Fica sobre o CENTRO da arena (x = 0, z = 0) e não sobre um canto: é o
       * único ponto do mapa igualmente longe de todo mundo, e o único de que
       * ninguém pode reclamar por ter nascido do lado errado.
       *
       * ------------------------------------------------------------- a conta
       *
       * 2 400 m foram MEDIDOS contra a física de `movement.js`, não estimados —
       * a velocidade de subida do lutador não é uma constante do config, ela sai
       * de `climbSpeed`, `boostSpeed`, `flySpeed` e da economia de ki.
       *
       * A medida é até a BOCA (2 400 − `raio` = 2 180 m, que é onde a esfera
       * começa e onde a fuga de fato dispara), partindo de 200 m — uma altura de
       * briga comum — e com o teto de fuga em 2 650:
       *
       *   nariz para cima + arranque, barra CHEIA .... 63,5 m/s → 31,3 s
       *   só ESPAÇO + arranque, barra cheia .......... 49,2 m/s → 40,3 s
       *   arranque PAGO (barra não cheia) ............ 25,8 m/s → 66,0 s
       *   sem arranque nenhum ........................ 20,0 m/s → 99,1 s
       *
       * Contra os 60 s da contagem, isso desenha exatamente a régua pedida:
       *
       * • Quem sobe DIRETO chega com **19,7 s de folga** na técnica natural
       *   (segurar espaço com o arranque) e **28,7 s** na ótima (apontar o nariz
       *   para cima). Os 700 m de deslocamento horizontal até o eixo do portal
       *   quase não cobram: subindo na diagonal, a componente vertical só cai
       *   para 60,5 m/s, um segundo e meio a mais.
       * • Quem NÃO chega é quem não tem a barra cheia — 66 s contra 60. E a
       *   barra só fica cheia para quem não atirou (`ki.freeFlightAt`), ou seja:
       *   **a fuga cobra parar de brigar.** É a trava que o relógio de subida
       *   tentava impor por fora e que a economia de ki já impunha sozinha, sem
       *   precisar de um segundo cronômetro.
       * • E quem começa de mais baixo paga: do chão são 34,4 s; do teto normal
       *   de 520 m, 26,2 s. A briga do minuto final passa a ter uma altitude
       *   preferida, que é uma decisão a mais e não uma regra a mais.
       *
       * Mexer neste número sem refazer a medida é mexer na dificuldade inteira
       * do modo. O método: integrar o `FighterController` de verdade a 60 Hz com
       * `regime.teto` alto e um `ki` que responda `voaDeGraca()` — é a economia
       * de ki, e não a velocidade de voo, que decide quem escapa. */
      altitude: 2400,
      /** m — raio da boca. Uma esfera de 440 m de diâmetro no céu: grande o
       *  bastante para se entrar nela voando a 64 m/s sem mira fina, pequena o
       *  bastante para a seta da borda da tela ter serventia. */
      raio: 220,

      /* m — O TETO DE VOO DURANTE A FUGA, e ele é o `NAMEK.world.ceiling` de
       * 520 m substituído — não editado.
       *
       * O pedido: *"no momento que os players estão fugindo do planeta o limite
       * de altura de voo do céu deve ser maior para eles conseguirem chegar no
       * espaço sem morrer."* A constante do mundo continua valendo no dia a dia
       * (um teto de 2 km em partida normal esvaziaria a arena para cima); o que
       * muda é que ela deixou de ser lida direto e passou por
       * `FighterController.regime`, que a fase do fim reescreve. Ver
       * `src/namek/movement.js`.
       *
       * 2 650 e não 2 400: 250 m de folga acima da boca do portal, para quem
       * passar direto não bater num teto invisível exatamente onde devia escapar.
       * (E é contra ESTE teto que a conta de `altitude` foi medida — a faixa de
       * amortecimento da subida, `FAIXA_TETO` em `movement.js`, começa 45 m
       * abaixo dele, ou seja bem acima da boca.) */
      teto: 2650,

      /* ---------------------------------------------- e o freio da borda ----
       * `world.softEdge` é a barreira macia que puxa de volta quem se afasta do
       * centro. Ela existe para o mapa não vazar pelos lados — e a 1 500 m de
       * altura ela não protege nada: só briga com quem está subindo em espiral,
       * empurrando para dentro justamente quem está correndo contra o relógio
       * para chegar ao alto.
       *
       * Durante a fuga ela AFROUXA com a altitude: inteira até `freioSolta`,
       * nenhuma a partir de `freioMorre`. O puxão para quem está FORA do limite
       * continua valendo em qualquer altura — ele é o que impede alguém de ficar
       * pendurado no vazio, e isso não tem nada a ver com fugir. */
      freioSolta: 420,
      freioMorre: 760,
    },

    /* ================================================================= espaço
       "Uma vez no espaço eles podem continuar lutando ali se quiserem."

       O espaço NÃO é outra arena com outro código: é a mesma física com o chão
       desligado. Ver o `regime` de `movement.js` — a lista do que cai fora é
       curta e literal: campo de altura, afogamento, lava, gravidade, cratera e o
       `flyRadius` do planeta, que vira uma BOLHA esférica.

       Ela é esférica porque no espaço não há "para baixo": um limite cilíndrico
       como o do planeta deixaria a fuga vertical aberta para sempre. */
    espaco: {
      /** m — a cota do centro da bolha. Acima da boca do portal (2 400): quem
       *  escapa é cuspido PARA CIMA, e o planeta fica embaixo, inteiro na tela. */
      altura: 2900,
      /* m — raio da bolha. 560 dão 1 120 m de ponta a ponta, ou 17,5 s de
       * travessia no arranque: menos que a arena do planeta, que é o certo para
       * um lugar sem cenário nenhum onde se esconder.
       *
       * O teto da bolha (2 900 + 560 = 3 460 m) é escolhido contra o `far` da
       * câmera, que são 3 600: do ponto mais alto do espaço a ilha ainda cabe
       * no tronco de visão (3 542 m até a borda dela), e é isso que permite
       * assistir ao planeta explodir de fora em vez de vê-lo sumir no plano de
       * recorte. Ver `NAMEK_CAMERA_FAR` em `world/sky.js`. */
      raio: 560,
      /** Fração do raio em que o freio começa. Ver `world.softEdge`, mesma
       *  mecânica em três dimensões. */
      freioInicio: 0.82,
      /** m — o quanto se espalha o nascimento de quem morreu e voltou no espaço.
       *  Menor que o raio: renascer colado na parede da bolha seria renascer
       *  sendo empurrado. */
      nascimento: 380,

      /* ---------------------------------------------- O FUNDO DA QUEDA
       *
       * *"Caso o player for derrubado [no espaço], ele tem um limite: ele cai no
       * espaço. Como não vai ter chão pra fazer colisão, então ele chega nesse
       * limite e volta, pois senão ele vai ficar caindo infinito."*
       *
       * Fração do raio da bolha, medida do CENTRO dela para baixo. Com 0,86 o
       * fundo fica em 2 900 − 482 = **2 418 m**, uns oitenta metros acima da
       * parede da esfera — dentro do freio macio, e não em cima dele, para as
       * duas coisas não brigarem pelo mesmo corpo no mesmo quadro.
       *
       * O que ele faz não é só parar a descida: ele **encerra a queda**. Um
       * lutador derrubado no espaço não tem chão para o relógio de
       * `FighterController.derrubar` começar a correr (ele só anda com os pés
       * apoiados), então sem este fundo a punição durava os nove segundos
       * inteiros do teto de segurança, caindo o tempo todo. Tocar o fundo é o
       * equivalente a tocar o chão: o corpo para, o atordoamento acaba e ele
       * volta a voar. Ver `FighterController._integrar`. */
      fundoQueda: 0.86,
    },

    /* NÃO HÁ FUNÇÃO NENHUMA AQUI, e a ausência é o resumo da mudança.
     *
     * Havia um `relogioDaSubida(relogio, vy, dt)` — a regra do acúmulo, escrita
     * uma vez para os dois lados da rede rodarem a mesma frase. Ela saiu junto
     * com o relógio pessoal: a fuga virou geometria, e geometria não precisa de
     * regra compartilhada. Os dois lados comparam a mesma distância aos mesmos
     * `altitude` e `raio`, e não há mais estado por jogador para divergir. */
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
     * angular maior que a dele, e a `d` metros isso pede `v > ω·d`. Ou seja: a
     * DISTÂNCIA DE FUGA de cada golpe é `v/ω`, e abaixo dela quem arranca de
     * lado ganha a corrida.
     *
     * Com o arranque a 64 m/s, e depois de a perseguição do repertório inteiro
     * dobrar (ver `blast.homing` e os `homing` de cada especial):
     *
     *     Genki Dama    40°/s   →  92 m      o mais fácil de desviar
     *     rajada de ki  62°/s   →  59 m      (e `acquire` são 50: sempre)
     *     Kienzan      108°/s   →  34 m      medido: 58 m — ver abaixo
     *     Galick Gun   110°/s   →  33 m
     *     Kamehameha   170°/s   →  22 m      quem o segura é o `arcMax`
     *
     * A rajada subiu de 52 para 62°/s (o pedido de +20 %) e o Kienzan CAIU de
     * 114 para 108 quando o disco cresceu — um disco maior acerta mais com o
     * mesmo giro, e o giro teve de pagar por isso. As duas contas estão nos
     * blocos dos respectivos golpes. E contra o FREEZA a rajada gira ainda mais
     * (`blast.homing.ganhoNoFreeza`, 71,3°/s → 51 m), o que é justamente por que
     * o arranque dele teve de ir a 64 m/s.
     *
     * **ESTA COLUNA É UM PISO, NÃO O NÚMERO.** `v/ω` é um critério de regime
     * permanente — ele pergunta se o golpe consegue manter o nariz no alvo para
     * sempre. O que decide um acerto é outra coisa: se o golpe passa a menos de
     * um `hitRadius` UMA vez, em menos de um segundo de voo. Como
     * `perseguirPonto` é perseguição pura (mira a posição atual, não antecipa),
     * ele desperdiça giro na curva e erra em distâncias que a fórmula dava como
     * acerto. Medido no Kienzan: a fuga real é **1,7 vez** a calculada (58 m
     * contra os 34 da tabela).
     *
     * Use a coluna para ORDENAR os golpes — para isso ela é exata e barata. Não
     * a use para calibrar um golpe contra uma distância específica: é para isso
     * que existe o banco de medição descrito em `specials.disk.homing`, e é por
     * isso que o Kienzan é o único `turnRate` do arquivo que não saiu daqui.
     *
     * Escapar de lado, portanto, continua possível e exige estar PERTO, que é a
     * troca certa: quem está longe se defende com antecedência, não com reflexo.
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
     *   mesma linha: o Kienzan (40), o Galick Gun (60) e a Genki Dama (100)
     *   passam de 30 num impacto só, e o Kamehameha, que cobra por segundo
     *   (29,2/s), fecha a conta em 1,03 s de feixe em cima de alguém. Ver
     *   `NamekRoom.contarGolpe`.
     *
     *   A escada de dano mudou (era 50 · 50 · 100 e 21/s; ver `galick.damage`),
     *   e o limiar de 30 não mudou junto de propósito: ele é medido em BOLAS DE
     *   KI, e a bola de ki continua valendo 6. Nenhum dos quatro especiais
     *   chegou perto de deixar de derrubar sozinho — o menor deles tira 40.
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
       Kamehameha (29,2/s) ainda tira 6,4/s de quem está defendendo — 15,4 na
       sustentação inteira, contra os 70 que ele tira de quem não defendeu.
       Ficar parado atrás dos braços continua sendo perder, só que devagar; e a
       barra (4,8 s de guarda) acaba antes de dois feixes.
     • `drain: 7` — a barra cheia dá **14,3 s** de guarda. Eram 21 (4,8 s), e o
       pedido foi literal: *"diminua três vezes a quantidade de ki usada durante
       a defesa — atualmente a defesa suga muito ki."* O número é o antigo
       dividido por três, e o que ele muda é a leitura do botão: 4,8 s eram
       menos que a carga de uma barra (5,3 s), ou seja, defender custava mais do
       que rende — quem aparasse uma investida inteira ficava sem ki para
       revidar, e o botão virava um jeito lento de perder. Com 14,3 s a guarda
       passa a aguentar três Kamehamehas seguidos e ainda sobra barra.
       O que impede isso de virar imunidade continua sendo o mesmo de sempre, e
       não o preço: quem defende não atira, anda a 30 % da velocidade
       (`speed`) e ainda leva 22 % do dano. Em Super Saiyajin o dreno cai a 40 %
       disto (2,8/s, `NAMEK.ssj.kiDreno`) — 35,7 s de braços cruzados —, e o
       teto do estrago ali continua sendo o descrito em `ssj.danoDoFreeza`:
       aguentar muito tempo sem fazer nada.
     • `push: 0.3` — o empurrão da onda também é aparado. Sem isto a guarda
       pareceria funcionar contra o dano e falhar contra o que se VÊ, que é a
       pior forma de um mecanismo mentir.

     E ela impede a QUEDA (ver `contarGolpe` na sala): golpe aparado não conta
     para os cinco. É a razão de existir do botão — quem lê a investida a tempo
     não vai ao chão. */
  guard: {
    /** Fração do dano que ainda passa pela guarda. */
    damage: 0.22,
    /** por segundo, com a guarda de pé. Era 21; ver a conta no bloco acima. */
    drain: 7,
    /** Fração do empurrão que ainda passa. */
    push: 0.3,
    /** Fração da velocidade que sobra ao defender. Guarda não é corrida. */
    speed: 0.3,
  },

  /* ==================================================== o SUPER SAIYAJIN ====
     A virada de mesa da batalha contra o Freeza, e ela é uma peça de RITMO
     antes de ser uma peça de números.

     O pedido é literal: *"se o player estiver com vida de 30 % ou menos aparece
     um alerta que ele pode se transformar… sua aura, seu ki, sua barra de vida
     fica amarelo… todos os seus poderes que ele solta ficam amarelos, tiram
     mais life do freeza e seu ki demora mais para gastar e ele ganha mais vida.
     Com uma barra de ki ele consegue soltar 3 poderes especiais sem precisar
     recarregar."*

     Tudo aqui obedece a uma regra que não está escrita no pedido e que é o que
     impede isto de virar um botão de "ganhar": **o gatilho é o pior momento
     possível.** Ele só existe com 30 % de vida ou menos, e só enquanto o Freeza
     está em campo. Quem se transforma já perdeu 70 da barra e está a uma bola de
     ki e meia da morte — o poder que ele recebe é o troco de um risco que ele
     já correu, não um prêmio por apertar uma tecla.

     ------------------------------------------------------- quando ela ACABA

     **Até morrer, ou até o Freeza cair — e NÃO há relógio.** É a decisão mais
     importante deste bloco e a que mais parece arbitrária, então ela fica
     escrita:

     • Um relógio criaria o pior instante do jogo. `vidaBonus` sobe o teto de
       vida de 100 para 160; quando o relógio vencesse, alguém com 140 de vida
       teria de ser aparado para 100 — quarenta pontos evaporando sem golpe
       nenhum, no meio de uma briga, sem nada na tela que explicasse. Qualquer
       transformação com prazo precisa dessa poda, e toda poda lê como dano
       vindo do nada.
     • E ele puniria justamente quem usou bem. O gatilho pede ≤ 30 % de vida:
       se a transformação vencesse enquanto o jogador está com 120 de 160, ele
       ficaria sem poder e SEM PODER SE TRANSFORMAR DE NOVO, porque já não está
       machucado o bastante. O jogador seria castigado por ter sobrevivido.
     • O fim pelo Freeza é o beat da referência e é de graça: a batalha acabou,
       ninguém está atirando, e a barra volta ao normal num momento em que a
       volta não custa nada. Quem continuar brigando com os outros jogadores
       (ver o §fogo amigo em `NamekRoom.aplicarDano` — o dano entre jogadores
       nunca foi desligado) volta a lutar em igualdade.
     • Morrer desliga porque morrer já reinicia tudo: `NamekRoom.nascer` devolve
       vida e ki cheios, e carregar o estado através da morte daria a quem
       acabou de renascer com 100 de vida um teto de 160 e três especiais por
       barra sem nunca mais precisar do gatilho.

     ------------------------------------------- a vida no INSTANTE da virada

     `vidaBonus` entra na vida ATUAL, não só no teto. Das três opções, é a única
     que não mente na tela:

     • só no teto: quem tinha 30 passaria a ter 30 de 160 — a barra ENCOLHE de
       30 % para 19 % no quadro em que o jogador ficou mais forte;
     • guardando a fração: 30 % de 160 são 48, um ganho de 18 que ninguém vê;
     • somando o bônus inteiro: 30 viram 90 de 160 (56 %). A barra sobe, o
       estouro de poder tem consequência, e ainda assim NÃO é cura — ele
       continua com 70 pontos de estrago acumulado, e a metade de cima da barra
       nova é a que ele nunca teve.

     Ver `SuperSaiyajin.acender` (cliente) e `server/namek/ssj.js: acender`
     (a autoridade, que é quem manda). */
  ssj: {
    /* Fração de `maxHealth` (o teto BASE, 100) em que o alerta aparece e a
     * transformação passa a ser aceita. É o "30 % ou menos" literal.
     *
     * **Ele deixa de valer depois que o Freeza cai** — ver `livreAposOFreeza`. */
    gatilho: 0.3,

    /* ================================ DEPOIS QUE O FREEZA MORRE, É DE GRAÇA ==
     *
     * *"Após destruir o Freeza, o Goku pode voltar a ser Super Saiyajin sempre
     * que ele quiser. Não precisa mais estar com aquele volume de vida
     * específico. Ele pode virar Super Saiyajin sempre que ele quiser mesmo, se
     * ele morrer e voltar, mas o Freeza tem que estar morto. Então tanto ali na
     * Namekusei quanto no espaço, ele pode fazer isso."*
     *
     * É a referência inteira num campo: a transformação era uma reação ao
     * desespero e vira uma CONQUISTA. Com a chave ligada, a partir do instante
     * em que o boss cai:
     *
     * • o limiar de vida (`gatilho`) deixa de ser conferido;
     * • `exigeFreeza` passa a ser satisfeito pela MORTE dele em vez da presença;
     * • ela sobrevive à própria morte do jogador — quem renasce nasce normal
     *   (o teto volta a 100, ver "quando ela ACABA") e pode reacender no quadro
     *   seguinte, com a tecla;
     * • e vale no espaço, porque o que ela pergunta é sobre o BOSS e não sobre
     *   onde o jogador está.
     *
     * O que a mantém sendo uma conquista e não um estado permanente do modo é o
     * que ela EXIGE: o Freeza tem de ter sido derrubado nesta partida. Voltar o
     * clima para `dia` desfaz a batalha inteira (o boss sai de campo sem morrer,
     * ver `NamekFim.pararFreeza`) e apaga esta marca junto — senão o menu viraria
     * um jeito de destravar a transformação sem lutar.
     *
     * Quem guarda a marca é o boss (`NamekFreeza.derrotado`), e não a sala nem
     * este arquivo: é ele que sabe a diferença entre "caiu" e "foi retirado", e
     * essa diferença é a regra inteira. */
    livreAposOFreeza: true,

    /* **A TRANSFORMAÇÃO CURA.** *"Quando o player vira Super Saiyajin, toda a
     * vida dele é recuperada."*
     *
     * Ela substitui a regra antiga, que somava `vidaBonus` à vida atual (30 de
     * 100 viravam 150 de 220). Agora a vida vai ao TETO NOVO — 220 cheios —, e a
     * diferença entre as duas leituras é o que o pedido quer dizer: a virada
     * deixou de ser "um fôlego a mais" e passou a ser o corte de cena da
     * referência, em que o corpo se refaz.
     *
     * O que segura o preço continua sendo o mesmo, e é por isso que a cura não
     * desequilibra: durante a batalha ela só existe a 30 % de vida ou menos
     * (`gatilho`), custa três segundos parado no lugar, e não pode ser repetida
     * — quem já está transformado não se transforma de novo, e sair da
     * transformação só acontece morrendo. Depois da batalha (`livreAposOFreeza`)
     * ela é livre, e aí a cura é o prêmio explícito do pedido.
     *
     * O KI NÃO é enchido, e isso não mudou: a transformação muda o preço das
     * coisas: encher a barra por cima disso daria três especiais de graça no
     * quadro seguinte ao aperto da tecla. */
    curaTotal: true,

    /* Só durante a batalha contra o Freeza — o pedido é explícito sobre o
     * contexto, e sem esta trava o Super Saiyajin viraria uma segunda economia
     * permanente por cima do mata-mata comum: quem estivesse com pouca vida
     * jamais brigaria sem ele.
     *
     * Fica como CHAVE e não como `if` escrito no código para o dia em que se
     * quiser um modo livre com transformação: é uma linha aqui, e nenhuma lá.
     * Quem lê o estado do chefe o faz sempre com `?.` (o Freeza é de outro
     * arquivo e pode não existir ainda), então com a chave ligada e sem chefe
     * em campo a transformação simplesmente não acontece. */
    exigeFreeza: true,

    /** s — a animação inteira, e o pedido é literal: "a transformação deve
     *  demorar 3 segundos e ele fica invencível enquanto está se transformando".
     *  A invencibilidade cobre os três segundos, do primeiro quadro ao último —
     *  ver `NamekRoom.aplicarDano`, que devolve zero durante a janela. */
    duracao: 3,

    /* Marcos da animação, em FRAÇÃO da duração — a coreografia do pedido:
     * "o boneco faz a animação clássica com os braços cruzados na cabeça depois
     * ele coloca esses braços na cintura e a aura dele fica amarela e mais
     * intensa e tem uma explosão de poder ali momentânea".
     *
     * `cruzar` é quanto dura a subida dos braços; de lá até `baixar` eles
     * descem para a cintura, punhos cerrados; de `baixar` em diante é o grito,
     * com o corpo arqueando e o tremor no talo; e em 1,0 vem o estouro.
     *
     * Estão aqui, e não escritos dentro da pose, porque a AURA e a explosão
     * precisam dos mesmos instantes — três cópias do mesmo 0,42 em três
     * arquivos seria a primeira coisa a sair de sincronia ao afinar o gesto. */
    cruzar: 0.42,
    baixar: 0.74,

    /* **+120 de vida: o teto passa de 100 para 220.** Ver "a vida no INSTANTE
     * da virada", acima, para o que acontece com a vida atual — o bônus entra
     * nas DUAS (30 de 100 viram 150 de 220), e é essa regra que impede a barra
     * de encolher no quadro em que ele ficou mais forte.
     *
     * Eram 60, e o pedido foi explícito em querer mais ("virando super saiadin
     * o player deve ter mais vida"). O número novo é medido contra os golpes que
     * existem, e a tabela fica escrita porque é ela que justifica os 120 — quem
     * mexer nos danos deve refazer esta conta:
     *
     *   NO GATILHO (30 de 100), qualquer coisa mata:
     *     Kienzan 40 ✗ · Galick Gun 60 ✗ · Kamehameha cheio 70 ✗ · 5 bolas 30 ✗
     *
     *   RECÉM-TRANSFORMADO (150 de 220), ele aguenta qualquer golpe único:
     *     Kienzan 40 → 110 · Galick Gun 60 → 90
     *     Kamehameha cheio 70 → 80 · Genki Dama 100 → 50
     *
     * ------------------------------- o que isto tira da GENKI DAMA, e por quê
     *
     * Ela deixa de matar de um golpe. `genki.damage` é 100 porque ele é
     * exatamente `maxHealth` — "a Genki Dama deve tirar a vida inteira" —, e um
     * teto maior desfaz essa igualdade por construção. É consequência do pedido
     * e não descuido, e a troca é aceitável: contra um Super Saiyajin ela ainda
     * arranca 45 % da barra dele num impacto, que continua sendo, de longe, o
     * maior golpe único do jogo. Contra todo mundo que não se transformou — que
     * é quase todo mundo, quase o tempo todo — ela continua matando.
     *
     * E é a favor do modo: o único jeito de sobreviver à Genki Dama passa a ser
     * ter pagado o preço da transformação, que só existe a 30 % de vida e só
     * durante a batalha do chefe. */
    vidaBonus: 120,

    /* "Seu ki demora mais para gastar": todo gasto CONTÍNUO ou de repetição sai
     * por 40 % do preço. As três contas, com a barra de 100:
     *
     * • arranque (`ki.boostDrain` 14/s → 5,6/s): a barra cheia dá 17,9 s de
     *   voo em arranque contra os 7,1 s de sempre;
     * • rajada (`ki.blastCost` 2 → 0,8): 125 bolas por barra contra 50;
     * • guarda (`guard.drain` 21/s → 8,4/s): 11,9 s de braços cruzados contra
     *   4,8 s. Continua sendo menos que a carga inteira (5,3 s para encher só
     *   metade do que a guarda gastou), então defender ainda não é viver.
     *
     * O ESPECIAL NÃO PASSA POR AQUI. O desconto dele é `especialCusto`, e
     * aplicar os dois seria cobrar 13 % da barra por um Kamehameha — sete
     * especiais por carga, que é outro jogo. Ver `KiMeter.gastarEspecial` e
     * `server/namek/ssj.js: custoEspecial`. */
    kiDreno: 0.4,

    /* **Três especiais com uma barra**, e o pedido é literal.
     *
     * Hoje o especial exige a barra CHEIA e consome tudo (`ki.specialThreshold`
     * = 1). Em Super Saiyajin ele custa 33 e exige 33, e a conta fecha em cima:
     * 100 → 67 → 34 → 1. Três golpes, e o quarto é recusado por um ponto.
     *
     * 0,33 e não 1/3 exatamente é de propósito: com 0,3333… a soma de três
     * gastos dá 99,999… e o resto flutuante decide se o terceiro sai — o mesmo
     * tipo de bug que a margem de `KiMeter.cheia` já documenta, com o sinal
     * trocado. Com 0,33 sobra um ponto inteiro de folga e o terceiro golpe é
     * garantido em qualquer aritmética, nos dois lados da rede.
     *
     * O LIMIAR CAI JUNTO, e tem de cair: com o custo em 33 e o limiar em 1, a
     * barra ficaria em 67 depois do primeiro golpe e o segundo seria recusado
     * — o jogador teria pago mais barato para atirar menos. */
    especialCusto: 0.33,
    limiar: 0.33,

    /* E O VOO DE GRAÇA ACOMPANHA O LIMIAR, em vez de continuar exigindo a barra
     * cheia (`ki.freeFlightAt` = 1).
     *
     * Sem isto a regra do voo de graça morreria em Super Saiyajin: o primeiro
     * especial tira a barra de 100 para 67 e, com o limiar antigo, o arranque
     * voltaria a cobrar pelo resto da transformação inteira. O sentido da regra
     * — "a barra é MUNIÇÃO, gasta por quem atira e não por quem se desloca"
     * (ver `ki.freeFlightAt`) — vale igual aqui; o que muda é o que conta como
     * estar municiado, e municiado agora é ter pelo menos um especial guardado.
     *
     * É o MESMO número de `limiar`, e é repetido como campo próprio para o dia
     * em que alguém quiser separá-los: hoje as duas perguntas ("dá para soltar
     * o golpe?" e "o voo sai de graça?") têm a mesma resposta, e amanhã podem
     * não ter. Os dois lados da rede leem este campo — o cliente em
     * `KiMeter.voaDeGraca`, a sala em `economiaDeKi` —, como já faziam com o
     * original, porque uma barra que o HUD desenha descendo e a sala não cobra
     * é a pior discordância que este modo consegue produzir. */
    voaDeGracaEm: 0.33,

    /* "Tiram mais life do freeza": multiplicador sobre a tabela de dano do
     * chefe (`NAMEK.freeza.dano`, de outro arquivo — lido sempre com `?.`, e
     * com o dano contra jogador como padrão quando ela ainda não existe; ver
     * `danoNoFreeza` em `server/namek/ssj.js`).
     *
     * 1,75 e não 2 porque o dobro apagaria a fase: a transformação já
     * multiplica o número de golpes por barra (três especiais em vez de um) e
     * já paga o arranque, ou seja, o dano POR MINUTO contra o chefe sobe muito
     * mais que 1,75× — três Kamehamehas onde antes cabia um, cada um valendo
     * 1,75. Somando, é da ordem de cinco vezes o estrago. Um multiplicador de 2
     * por cima disso transformaria o Freeza num alvo de treino no instante em
     * que o primeiro jogador se transformasse.
     *
     * Contra JOGADORES o multiplicador é 1 de propósito, e por isso ele não
     * existe como campo: quem se transforma já ganhou fôlego, vida e cadência,
     * e somar dano a isso faria da queixa óbvia ("virou Super Saiyajin, acabou
     * a partida") uma queixa correta. A transformação é uma resposta ao CHEFE,
     * e é contra ele que ela morde. */
    danoNoFreeza: 1.75,

    /* **"Os ataques do Freeza tiram bem menos life do player."**
     *
     * O espelho exato da linha de cima, na direção contrária: o Super Saiyajin
     * bate mais forte NELE e apanha menos DELE. Os dois campos ficam colados de
     * propósito — a troca inteira da transformação contra o chefe se lê num
     * lugar só, e quem for reequilibrar um dos lados vê o outro sem procurar.
     *
     * 0,45 é "bem menos" sem ser imunidade: ele passa a levar 45 % do golpe. A
     * conta com a RAJADA do boss (o ataque que ele repete o tempo todo), nas
     * três dificuldades, contando quantos tiros o jogador aguenta — e note que
     * ela é feita com a tabela LIDA EM TEMPO DE EXECUÇÃO (`NAMEK.freeza.rajada`
     * vezes `dificuldades[x].dano`), nunca com números copiados para cá, porque
     * o dono do boss recalibra e a conta tem de acompanhar sozinha:
     *
     *              antes (100 de vida)      em SSJ (220 de vida, 45 % do dano)
     *   Tirano           23 tiros                     112 tiros
     *   Imperador        14 tiros                      69 tiros
     *   Imp. do Mal      10 tiros                      51 tiros
     *
     * E com o RAIO DA MORTE, que é o golpe que de fato mata (ele cobra por
     * segundo): no Imperador são 1,6 s de exposição para morrer, contra 7,9 s
     * em Super Saiyajin. Continua sendo o golpe que não se pode encarar — só
     * deixou de ser o golpe que apaga alguém antes de ele reagir.
     *
     * ------------------------------------------- e quando ele TAMBÉM defende
     *
     * A guarda (`NAMEK.guard.damage`) já é um redutor de 22 %, e os dois se
     * COMPÕEM em vez de um substituir o outro: 0,45 × 0,22 = **9,9 % do dano**.
     * Parece imunidade e não é, e o que impede é o preço — não o número:
     *
     * • a guarda ESCOA ki (`guard.drain` 21/s, que em SSJ vira 8,4/s), então a
     *   barra cheia dá 11,9 s de braços cruzados e acabou. Quem defende o raio
     *   da morte inteiro chega ao fim dele sem ki, ou seja, sem especial, sem
     *   arranque e sem a próxima guarda;
     * • quem está defendendo NÃO está atacando, e o boss não tem pressa.
     *
     * O teto do estrago de uma imunidade real seria "nunca morre"; aqui o teto é
     * "aguenta doze segundos e fica sem nada". É uma postura com preço, que é o
     * que a guarda sempre foi. */
    danoDoFreeza: 0.45,

    /* ------------------------------------------------------------- as cores
     *
     * "Sua aura, seu ki, sua barra de vida fica amarelo. O cabelo do boneco
     * também fica amarelo. Todos os seus poderes que ele solta ficam amarelos."
     *
     * Três amarelos e não um, e a diferença entre eles é a mesma que separa
     * tinta de luz: o CABELO é matéria iluminada pelo sol (mais claro, quase
     * palha), a AURA é emissão aditiva contra um céu já claro (mais saturada,
     * senão satura em branco e some — ver o comentário de `matChama.opacity` em
     * `character/aura.js`), e o GOLPE é o meio-termo, porque ele precisa ser
     * lido a duzentos metros contra montanha, mar e céu. */
    cor: 0xffd23a,
    corCabelo: 0xffe45c,
    corAura: 0xffc81e,
    /** graus de matiz para a BARRA DE VIDA do HUD. Ela é pintada por giro de
     *  matiz (`--nk-hue`, ver `ui/style.js`), então o amarelo dela é um número
     *  e não uma cor: 48° é o ouro que casa com `corCabelo` no mesmo verniz. */
    hue: 48,

    /* ---------------------------------- o KI EM VOLTA DO CORPO, e por que ele
     *                                     precisou de três números e não de um
     *
     * *"Quando vira super saiadin o KI que fica em torno do jogador quando ele
     * voa ou carrega o ki deve ficar dourado."*
     *
     * Trocar `corAura` NÃO bastava, e a razão está no desenho da aura e não na
     * cor: `character/aura.js` pinta as três camadas do casulo com a cor do ki
     * **misturada com BRANCO** — 72 % no núcleo, 45 % nas faíscas, 32 % na
     * coroa. Isso existe por um bom motivo (a cor crua do jogador virava uma
     * coroa de palha sobre o céu verde), e o preço dele é que qualquer matiz
     * chega à tela lavada: o dourado 0xffc81e (255, 200, 30) sai do núcleo como
     * (255, 240, 192), que é branco com um sopro de creme. O ki continuava
     * "amarelo" no código e branco no olho.
     *
     * E a mistura é ADITIVA, então o segundo agravante é a opacidade: quanto
     * mais forte a camada, mais perto de branco ela chega no compositor. O
     * `auraGanho` que eu tinha posto para atender "mais intensa" estava,
     * portanto, trabalhando CONTRA "dourado" — ele empurrava as três camadas
     * para a saturação exatamente quando elas mais precisavam segurar a matiz.
     *
     * Daí os três números, que são as três alavancas separadas:
     *
     * • `auraGanho` continua sendo o TAMANHO (a coroa abre, o casulo engorda);
     * • `auraBrilho` é a OPACIDADE, e é bem menor de propósito — é ela que
     *   satura;
     * • `auraTinta` é quanto do branqueamento SOBREVIVE. É a alavanca nova e a
     *   que de fato conserta a queixa.
     */
    /** Quanto a aura fica MAIOR — "mais intensa". +85 % na coroa e no casulo. */
    auraGanho: 0.85,
    /* Quanto a aura fica mais OPACA. +35 % e não +85 % porque aditivo satura:
     * medido, a 1,85× de opacidade o casulo dourado chega à tela como branco
     * puro e a troca de cor não aparece. A intensidade que o pedido pede é lida
     * pelo TAMANHO (acima) e pela cor cheia; a opacidade só precisa acompanhar o
     * bastante para o efeito não parecer oco. */
    auraBrilho: 0.35,
    /* Fração do branqueamento que SOBRA em Super Saiyajin. Com 0,42, o núcleo
     * cai de 72 % para 30 % de branco (o dourado passa a (255, 217, 97) — ouro
     * quente em vez de creme), a coroa de 32 % para 13 % e as faíscas de 45 %
     * para 19 %.
     *
     * Não é ZERO, e isso é deliberado: o miolo do casulo é a parte MAIS QUENTE
     * do ki, e fogo quente clareia no centro. Sem nada de branco o casulo vira
     * uma bolha de tinta chapada, que lê como gelatina e não como energia —
     * exatamente a armadilha que o branqueamento original existia para evitar.
     * 0,42 é o ponto em que o núcleo ainda tem brasa e o olho já lê "ouro". */
    auraTinta: 0.42,
    /* Onde o RASTRO já é dourado, ao longo do próprio comprimento (0 = colado no
     * corpo, 1 = na ponta que se dissipa).
     *
     * A cauda nasce BRANCA e só assume a cor do ki ao longe — "o ki esfria com a
     * idade", diz o comentário dela, e é uma boa regra. Só que o trecho que se
     * vê de um Super Saiyajin voando é justamente o colado no corpo, e ali a
     * regra entregava uma fita branca saindo de um lutador dourado. Com 0,72 a
     * fita já sai de ouro do peito e só o último quarto lava para o branco, que
     * mantém a leitura de dissipação sem mentir sobre a cor de quem voa. */
    auraCauda: 0.72,
    /** Quanto o cabelo ESPETA a mais (fração da altura do penteado). O rig tem
     *  o cabelo num grupo próprio e já o escala em Y (ver `Fighter.aplicar`);
     *  +34 % é o que se lê como "arrepiou" sem virar chapéu. */
    espeto: 0.34,

    /* ------------------------------------------------- a GENKI DAMA DOURADA
     *
     * *"Com o player Super Saiyajin, a Genki Dama, além de ficar dourada, fica
     * maior do que ela já é, e ela tem partículas em volta dela que ficam
     * rodeando ela, que dão a impressão de que ela é ainda mais poderosa."*
     *
     * A COR já era de graça: `infoDoGolpe` troca a definição inteira do golpe
     * por uma cópia dourada (ver o cabeçalho de `character/ssj.js`), e o núcleo,
     * a casca de arame, a fita e o estouro leem a cor de lá. O que faltava eram
     * as duas outras metades, e cada uma tem um número aqui.
     *
     * ------------------------------------------------------------- o tamanho
     *
     * `genkiEscala` multiplica o `hitRadius` do golpe — não a escala da malha —,
     * e a distinção é a única coisa deste bloco que pode dar errado se for
     * ignorada. Em `powers/orb.js` o raio de morte É o desenho: a esfera é
     * escalada por `hitRadius` e o raio da detonação sai da mesma constante.
     * Crescer só o visual criaria exatamente a reclamação que o comentário de
     * `specials.genki.hitRadius` diz que nenhum ajuste de número conserta —
     * morrer do lado de fora do que se vê, ou atravessar o que se vê sem morrer.
     *
     * 1,3 leva os 16 m para **20,8 m** (41,6 m de diâmetro, vinte e três vezes a
     * altura de um lutador). O teto é o servidor: ele confere o acerto contra o
     * `hitRadius` do config mais o cone de `arcMax` (75°), que a `t` metros abre
     * `t·tan 75°` — folga de sobra para 4,8 m a mais. Ver `registrarQueimadura`.
     *
     * ----------------------------------------------------------- as partículas
     *
     * `genkiOrbe` é o anel de fagulhas que gira em volta dela, e ele é a peça
     * que a Genki Dama comum NÃO tem de propósito: a tabela de estilo dela zera
     * `espiral` porque "uma hélice de fagulhas em torno de uma bola de 32 m cabe
     * dentro da bola". A dourada resolve isso pelo lado de fora — o anel nasce a
     * `raio` vezes o raio da esfera, ou seja FORA dela, e é por isso que ele lê
     * como uma coroa e não como poeira interna.
     *
     * `n` é por sopro e `intervalo` o espaçamento entre sopros: 10 partículas a
     * cada 0,1 s dão ~100 vivas ao mesmo tempo com `vida` de 1 s, que é o mesmo
     * orçamento de um rastro de Galick Gun. O `giro` é o quanto o anel avança
     * de fase a cada sopro — 0,9 rad é primo o bastante de 2π para as marcas não
     * caírem em cima das anteriores e o anel parecer contínuo. */
    genkiEscala: 1.3,
    genkiOrbe: {
      /** Fração do raio da esfera em que o anel gira. > 1 = por fora dela. */
      raio: 1.22,
      /** Partículas por sopro. */
      n: 10,
      /** s entre sopros. */
      intervalo: 0.1,
      /** rad de avanço da fase a cada sopro. */
      giro: 0.9,
      /** s de vida de cada fagulha. */
      vida: 1,
      /** Fração do raio da esfera que dá o tamanho de cada fagulha. */
      tamanho: 0.045,
    },

    /* --------------------------------------------------- a explosão do fim
     *
     * "Tem uma explosão de poder ali momentânea" — e ela é o único quadro do
     * gesto que precisa acontecer NO MUNDO e não no boneco: onda de choque,
     * chão levantando pedra e clarão.
     *
     * `potencia` passa por `craterFor`: 2,4 dão 3,2 + 7,6·√2,4 = **15 m de
     * boca**. É maior que a cratera de uma bola de ki (5,8 m) e menor que a de
     * um Kienzan (17,6 m) — a marca de alguém arrebentando o chão em que estava
     * de pé, não a de um golpe. Ela só é pedida com os pés perto do relevo; no
     * ar sobram o clarão e o tremor, que é o que se vê na referência. */
    estouro: {
      /** Potência da cratera. Ver `craterFor`. */
      potencia: 2.4,
      /** m — até onde o clarão se abre. */
      clarao: 26,
      /** força e segundos do tremor de câmera. */
      tremor: 1,
      tremorDur: 0.6,
      /** m — altura acima do relevo em que a explosão ainda cava o chão. */
      alcanceDoChao: 6,
    },
  },

  /* ------------------------------------------------------------------- aura
     O RASTRO DE KI — a fita que fica atrás de quem voa.

     Quem desenha é `src/namek/character/aura.js` (a "cauda"), e o que está aqui
     é só o TAMANHO dela. Mora no config, e não lá, porque comprimento de rastro
     é grandeza de jogo e não de desenho: ele é `velocidade × vida`, e a
     velocidade está poucas linhas acima (`fighter.flySpeed`, `boostSpeed`) —
     separar os dois números em arquivos diferentes seria esconder metade da
     conta.

     Vale para TODO MUNDO: o lutador local e os remotos são a mesma classe
     `Fighter`, e portanto a mesma `Aura`. Não há um segundo caminho de rastro
     para quem chega pela rede.

     **CINQUENTA POR CENTO MAIS COMPRIDA**, e o pedido é explícito quanto ao
     eixo: mais COMPRIDA, não mais grossa. Os três números cresceram JUNTOS
     porque o comprimento é o produto dos três, e alongar um só não alonga nada:

     • `vida` é o que de fato estica. A cauda cobre sempre os mesmos segundos de
       voo, então ela cresce sozinha com a velocidade — 26 m/s de cruzeiro dão
       33 m, e o arranque a 64 m/s dá 82 m (eram 22 m e 54 m).
     • `compMax` tinha de subir junto, senão o teto comeria o aumento inteiro:
       64 m/s × 1,275 s são 81,6 m contra um teto antigo de 72 m, ou seja, a
       cauda pararia de crescer exatamente onde o alongamento começaria a
       aparecer.
     • `amostras` sobe na mesma proporção para o PASSO continuar em 28 ms. Com
       as 30 de antes espalhadas por 1,275 s o intervalo iria a 42 ms — 2,7 m de
       vão a 64 m/s —, e a fita mostraria o canto de cada amostra em vez da
       curva do voo.

     E a GROSSURA não muda: `aura.js` divide os coeficientes de largura pelo
     mesmo fator que multiplica o comprimento (ver `LARG_POR_METRO`), então a
     mesma velocidade produz uma fita da mesma espessura — só mais longa.

     Custo: o buffer da fita é alocado UMA VEZ, na construção da aura (ver
     `criarFita`). Crescer aqui é memória na entrada — ~13 kB por lutador — e
     zero alocação por quadro, que é o que o §3 do plano exige. */
  aura: {
    rastro: {
      /** s — quanto tempo de voo cabe na cauda. Era 0,85. */
      vida: 1.275,
      /** Quantas amostras de trajetória ela guarda. Eram 30; 45 mantêm o passo
       *  de amostragem nos mesmos 28 ms. */
      amostras: 45,
      /** m — teto de comprimento, para a cauda não deixar de ler como rastro e
       *  virar uma faixa atravessando a arena. Era 72. */
      compMax: 108,
    },
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
     * bola perdida morrer antes de virar tráfego.
     *
     * Triplicado para 15 s (1 170 m): quem voa no ponto mais alto do cenário e
     * atira para baixo, no chão, percorre uma distância bem maior que a de uma
     * briga rasante, e a bola sumia no ar antes de chegar. */
    life: 15,
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
     * 0,45 abria 8,3 m — o buraco de uma pessoa. É o "as crateras dos poderes
     * pequenos devem ser bem maiores" literal, e é ele que faz a promessa da
     * ilha destruída: o especial sai uma vez por barra cheia, a rajada sai o
     * tempo todo, e destruição acumulada é feita do que sai o tempo todo.
     *
     * Reduzido pela metade: 0,0156 abria 4,1 m. `craterBase` (3,2 m) domina a
     * conta com potências pequenas, então cortar o raio ao meio pede uma
     * potência bem menor, não a metade dela.
     *
     * E SUBIU DE NOVO, a pedido: *"pode deixar a cratera do poder rápido um
     * pouco maior e mais funda."* 0,117 dá 3,2 + 7,6·√0,117 = **5,8 m de boca**
     * — 40 % a mais que os 4,1 m. É o "um pouco maior" literal, e é de propósito
     * que não é a volta aos 8,3 m: aquele número era o buraco de um especial
     * saindo seis vezes por segundo.
     *
     * Continua uma ordem de grandeza ACIMA de `craterMinPower` (0,01), e essa
     * folga é o conserto de b7cc70c em pé: o corte existe para filtrar potência
     * ZERO, nunca a rajada. Quem mexer nesta linha para baixo confere lá antes. */
    power: 0.117,
    /* A OUTRA METADE DO PEDIDO — "e mais funda".
     *
     * Mesmo mecanismo do `craterDeep` do Kamehameha, e ele existe aqui pela
     * mesma razão: `craterFor` tira a fundura do RAIO (`craterDepth`, 62 %),
     * então pedir "mais fundo" pela potência alargaria a boca junto. Sem este
     * número, os 5,8 m de boca dariam 3,6 m de fundo — uma tigela larga e rasa,
     * que é justamente o que o pedido não quer.
     *
     * 1,7 leva a fundura a 5,8 · 0,62 · 1,7 = **6,1 m**. São 11,6 m de boca de
     * ponta a ponta por 6,1 m de fundo: um lutador de 1,78 m some dentro do
     * buraco de UM tiro rápido, e é isso que separa "marcou o chão" de "cavou".
     *
     * Onde ele se encaixa na escala de fundura (fração do raio que vira
     * profundidade): estouro comum 0,62 · Kamehameha 2,17 (0,62 · 3,5) · rajada
     * 1,05 (0,62 · 1,7). Ou seja, ela FURA um pouco — bem menos que o feixe,
     * mais que qualquer outra coisa —, que é a leitura de uma bola de energia
     * concentrada batendo no chão.
     *
     * Viaja na rede pelo campo `df` de `NC2S.GROUND_HIT`, como o do feixe (ver
     * `craterFor`, que é quem o apara em [0,25 · 6]). Quem o escreve no relato é
     * `Bolas.update`, nos DOIS pontos em que a bola morre no cenário — o chão e
     * a peça de cenário. Esquecer um dos dois daria buracos de fundura
     * diferente conforme a bola tivesse batido em terra ou em pedra. */
    craterDeep: 1.7,

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
     * Foram 26°/s por 0,75 s = 19,5° de correção contra um cone de 22°.
     *
     * ------------------------------------------------- A PERSEGUIÇÃO DOBROU
     *
     * *"Todos os poderes devem ter o nível de perseguição duplicado."* O giro
     * foi a 52°/s, e o CONE foi junto — 22° → 44° —, porque dobrar só o giro
     * quebraria a regra que abre este comentário: 52 × 0,75 = 39°, e 39° de
     * correção dentro de um cone de 22° é o caso "acerto garantido" de novo,
     * só que com o sinal trocado.
     *
     * Com o cone em 44° a régua fica **39° de correção contra 44° de cone**, e
     * as duas leituras do parágrafo antigo continuam valendo, dobradas:
     *
     * • um alvo que ANDA — 26 m/s de través, a 60 m — sai uns 8° do lugar
     *   durante o voo, e agora a bola tem folga de sobra para acompanhar: a
     *   mira perdoa MUITO mais movimento, que é o pedido;
     * • um alvo na BORDA do cone (44°) fecha para 5°, e 5° a 60 m são 5,2 m —
     *   três vezes e meia o raio de acerto (1,5 m). Mira ruim continua errando,
     *   e continua errando por uma margem que o olho vê.
     *
     * ------------------------------------------------------------- e a fuga
     *
     * `d = v/ω` (ver `flySpeed`): a 52°/s (0,908 rad/s), quem arranca de lado no
     * boost vence a corrida angular a menos de 64/0,908 = **70 m**. Como
     * `acquire` são 50 m, a bola NUNCA nasce fora dessa distância — ou seja, o
     * arranque lateral desvia de toda rajada, em qualquer disparo do jogo. É o
     * que mantém a palavra "levemente" de pé mesmo com o giro dobrado: o que
     * dobrou foi o perdão de mira, não a impossibilidade de desviar. */
    /* --------------------------------- E ELA SUBIU MAIS 20 %, a pedido
     *
     * *"No geral, sobre o poder rápido, aumento 20 % a perseguição dele. Está
     * atualmente muito fácil de desviar."*
     *
     * O giro foi de 52 para 62°/s e **o cone foi junto**, de 44 para 53°, pela
     * regra que abre este bloco e que continua sendo a única que fixa os dois
     * lados de uma desigualdade: `turnRate × duration` (46,5°) tem de caber
     * dentro do cone (53°). Subir só o giro devolveria o defeito de origem — um
     * cone que não limita nada e um acerto garantido para quem estiver dentro
     * dele.
     *
     * E a promessa do §6.1 continua de pé, medida do mesmo jeito: `d = v/ω`. A
     * 62°/s (1,082 rad/s), quem arranca de lado no boost (64 m/s) vence a
     * corrida angular a menos de **59 m** — e `acquire` são 50, ou seja a bola
     * nunca nasce fora dessa distância. O arranque lateral continua desviando
     * de toda rajada do jogo; o que encolheu foi o perdão para quem NÃO se
     * compromete. */
    homing: {
      /** graus/s — teto de giro da direção. Era 52 (e 26 antes disso). */
      turnRate: 62,
      /** s — depois disto ela segue reta, sempre. 62 × 0,75 = 46,5° no total. */
      duration: 0.75,
      /** graus — meio-ângulo do cone. Fora dele, não corrige. Sobe com o giro
       *  (era 44), senão a correção total passaria do cone. */
      cone: 53,
      /** m — alcance da escolha de alvo, no instante do disparo. */
      acquire: 50,

      /* ================================ E MAIS UM TANTO CONTRA O FREEZA ====
       *
       * *"O contra o Freeza: os poderes rápidos têm 40 % mais de perseguição,
       * mas não deve ficar impossível para o Freeza desviar — se esse número
       * for muito grande, ajuste."*
       *
       * O pedido traz um número E uma condição, e a condição manda (é a mesma
       * regra que o `turnRate` do Kienzan já documenta). A condição, escrita
       * como aritmética: o boss tem de continuar vencendo a corrida angular
       * dentro do alcance de aquisição, ou seja `v_boss / ω ≥ acquire`.
       *
       *   ω com este fator .... 62 × 1,15 = 71,3°/s = 1,244 rad/s
       *   v mínimo exigido .... 1,244 × 50 m = 62,2 m/s
       *   v do boss (arranque 64 × `dificuldades.mover`)
       *       tirano 0,98 → 62,7 ✓ · imperador 1,0 → 64 ✓ · absoluto 1,05 → 67 ✓
       *
       * Ou seja: **1,15 é o maior fator que ainda deixa o Freeza desviar com o
       * arranque em qualquer dificuldade.** A 1,25 o mínimo exigido iria a
       * 67,6 m/s — acima do arranque do próprio jogador —, e a rajada passaria
       * a acertar o boss sem que ele tivesse resposta nenhuma.
       *
       * E o 40 % do pedido está lá, medido do lugar certo: contra o Freeza o
       * giro sai de 52 (o número de antes destes dois ajustes) para 71,3°/s, que
       * são **+37 %**. Os dois pedidos se somam em vez de se sobreporem — o
       * +20 % geral vale contra todo mundo, e este é o que sobra dos 40 %
       * depois de descontá-lo.
       *
       * O CONE acompanha pelo mesmo motivo de sempre (46,5 × 1,15 = 53,5° de
       * correção precisam caber num cone de 53 × 1,15 = 61°), e quem aplica os
       * dois é `Bolas.perseguir`, só quando o alvo travado é `NAMEK.freeza.id`.
       *
       * Vale para a bola de ki e mais nada: "poder rápido" é como o jogo chama
       * o tiro do botão esquerdo, e é o único golpe do modo que sai seis vezes
       * por segundo. */
      ganhoNoFreeza: 1.15,
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
      /** m — alcance. Triplicado (era 620) para não sumir antes de chegar. */
      range: 1860,
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
       * "Em cheio", para um feixe, é a SUSTENTAÇÃO INTEIRA em cima de alguém —
       * e é essa frase que converte a régua de dano num dps, porque este é o
       * único golpe do repertório que cobra por segundo.
       *
       * ------------------------------------------------ a régua nova: 70 %
       *
       * A metade virou setenta por cento: *"KameHameHa suga 70%"*. A conta é
       * uma divisão, e ela é o motivo de o número ser quebrado:
       *
       *     70 de vida ÷ 2,4 s de `sustain` = 29,166…/s  →  **29,2**
       *
       * 29,2 × 2,4 = 70,08 — os oito centésimos de sobra são o arredondamento
       * para uma casa, e sobrar é melhor que faltar: 29,1 daria 69,8 e um golpe
       * anunciado como "70 %" que tira 69,8 é a diferença que ninguém vê e que
       * mesmo assim é mentira no arquivo.
       *
       * A graduação continua sendo o que só um golpe contínuo tem: meio segundo
       * de encostão tira 14,6, um segundo tira 29,2, e a barra inteira de 2,4 s
       * tira os 70. Quem sai do eixo paga proporcionalmente ao que ficou nele.
       *
       * O que ele NÃO faz é matar sozinho — sobram 30 de vida —, e isso continua
       * sendo o lugar da Genki Dama (`genki.damage`, a vida inteira). O que ele
       * ganhou foi deixar de empatar com o Kienzan e o Galick Gun: os três
       * valiam a mesma metade, e agora são 40 · 60 · 70, que é uma escada. */
      dps: 29.2,
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
       * ------------------------------------------------------- por que 170°/s
       *
       * Eram 85, e dobraram com o resto do repertório: *"todos os poderes devem
       * ter o nível de perseguição duplicado."*
       *
       * Parece muito e não é, e o argumento é o mesmo de sempre: o que o olho lê
       * numa curva é o RAIO, não a taxa. A 340 m/s, 170°/s (2,967 rad/s) fecham
       * uma curva de `v/ω` = **114,6 m de raio** (eram 229). A 55 m de quem
       * atirou o feixe dobrou 27,5° — o dobro dos 14° de antes, na mesma
       * distância —, e ele gasta o teto inteiro em 0,41 s, ou 140 m de voo.
       *
       * Ou seja: o gancho continua sendo um gancho, só que ele acontece na
       * primeira metade do caminho em vez de se arrastar por trezentos metros. É
       * a diferença entre um feixe que corrige NA CARA de quem atirou e um que
       * corrige lá longe, onde ninguém vê a correção acontecer.
       *
       * ------------------------------------------------------------- e a fuga
       *
       * A régua do resto do modo (ver `flySpeed`) diz que quem arranca de lado a
       * `v > ω·d` vence a velocidade angular do golpe, e com o boost a 64 m/s
       * isso dá 64/2,967 = **21,6 m** para este (eram 43). A corrida angular
       * deixou de ser a escapatória prática deste golpe — perto demais.
       *
       * O que sobrou, e ele basta, é a outra metade: **o `arcMax`**. O feixe
       * gasta os 70° e para de corrigir PARA SEMPRE, e isso acontece 0,41 s
       * depois do disparo. Quem arranca de lado no instante do tiro força o
       * feixe a queimar o orçamento inteiro numa correção que o desvio lateral
       * já venceu, e depois vê um tubo azul reto passando ao lado.
       *
       * O que a curva compra, então, não é acertar quem foge: é acertar quem se
       * mexe sem se comprometer — quem deriva, quem recua em linha reta, quem
       * decide tarde — e punir quem fica no eixo. Que é a troca certa para um
       * golpe que custa a barra inteira, 1,05 s de pose e 70 % da vida alheia.
       *
       * ------------------------------------------------------------- e `arcMax`
       *
       * É o "deve ter um limite essa curva", virado em número, e é a trava que o
       * Kienzan e o Galick Gun não têm (lá, contornar é o que o golpe faz).
       *
       * Ele subiu de 40° para 70° junto com o giro, e NÃO dobrou de propósito. A
       * conta: o desvio lateral que o teto compra é `R·(1−cos θ)`, e com o raio
       * caindo pela metade (229 → 114,6 m) manter os 40° teria ENCOLHIDO o
       * alcance da curva de 54 m para 27 m — dobrar o giro deixaria o feixe pior
       * de perseguir, que é o oposto do pedido. Com 70° o desvio vai a
       * 114,6·(1−cos 70°) = **75 m**: meia vez mais que antes.
       *
       * Para cima o limite é o bumerangue, e ele é o mesmo de sempre: 170°/s por
       * 1,4 s de prazo dariam 238°, e um feixe que corrige 238° não persegue,
       * ele volta por cima do ombro de quem atirou. Com 70° o feixe termina
       * apontando 70° fora do disparo — bem virado, ainda para a frente.
       *
       * `duration` (1,4 s) virou o pano de fundo: a esta taxa o teto de 70°
       * fecha em 0,41 s, então quem manda é sempre o `arcMax`. O prazo continua
       * aqui porque a correção só corre DENTRO do cone, e um alvo que entra e
       * sai do cone pode não gastar o orçamento — nesse caso é o prazo que
       * encerra a perseguição.
       *
       * O teto é também o que dá ao servidor um cone honesto para conferir o
       * acerto — ver `registrarQueimadura`, que sem ele cairia numa esfera de
       * 1 860 m em torno de quem atirou. */
      homing: {
        /** graus/s — teto de giro, dobrado (era 85). Raio de curva de 114,6 m a
         *  340 m/s, contra os 229 m de antes. */
        turnRate: 170,
        /** graus — teto da correção TOTAL na vida do feixe. O limite da curva.
         *  70 e não 80: ver a conta de `R·(1−cos θ)` acima. */
        arcMax: 70,
        /** s — depois disto ele segue reto, sempre. Hoje o `arcMax` fecha antes
         *  (0,41 s); isto é o que vale quando o alvo sai do cone no meio. */
        duration: 1.4,
        /* graus — meio-ângulo do cone. Fora dele, não corrige.
         *
         * NÃO dobrou, e é o único número deste bloco que ficou parado. O cone
         * decide QUEM o feixe aceita perseguir; o `arcMax` decide QUANTO ele
         * persegue. Dobrar o cone junto faria o Kamehameha aceitar alvos a 70°
         * do disparo — "não sai caçando sozinho" (ver `soTrava`) deixaria de ser
         * verdade. Com o teto de correção (70°) já valendo o dobro do cone, todo
         * alvo que o cone aceita cabe no orçamento com folga: o que sobra é
         * gasto ACOMPANHANDO quem se mexe, que é o que o pedido quer. */
        cone: 35,
        /** m — alcance da escolha de alvo. Só vale se `soTrava` cair. */
        acquire: 320,
        /* SÓ COM ALVO DESIGNADO — e hoje quem designa é O CURSOR, e mais nada.
         *
         * A regra nasceu como *"ele só faz curva quando o player está travado o
         * foco no inimigo"*, e ela continua valendo no que importa: o Kamehameha
         * não sai caçando sozinho. O que mudou duas vezes foi o que conta como
         * "travado o foco". Primeiro apareceu uma SEGUNDA forma de designar
         * alguém — a mira assistida pelo cursor (`NAMEK.lock.mira`) —, porque o
         * pedido é explícito de que a perseguição vale para tudo: *"todos os
         * poderes seguem o player, não só o tiro rápido."* Depois a primeira
         * forma (a tecla `R`) foi removida a pedido, e a mira assistida ficou
         * sendo a única.
         *
         * `soTrava` significa, então, "não adquire alvo sozinho" — que é o que
         * ele sempre quis dizer: **sem ninguém sob o cursor no instante do
         * disparo, o feixe é a reta que sempre foi.** O preço da curvatura deixou
         * de ser uma tecla e passou a ser a pontaria: apontar para alguém no
         * momento em que se gasta a barra inteira. Quem resolve isso é
         * `soltarEspecial`, através de `LockOn.alvoDeAtaque`. */
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
      sustain: 15,
      /* Alcance triplicado (eram 5 s / 475 m): quem atira de cima, no chão,
         longe, não pode ver o golpe sumir no meio do caminho. A vida do
         projétil continua `min(sustain, range / speed)`, agora 15 s a 95 m/s
         = 1 425 m. */
      range: 1425,
      speed: 95,
      hitRadius: 6.5,
      /* Corta de uma vez, como o disco e a Genki Dama.
       *
       * ------------------------------------------- os quatro deixaram de empatar
       *
       * Valia 50, e 50 era o "qualquer poder grande que acertou em cheio deve
       * tirar metade da vida" aplicado sem exceção. O efeito colateral disso era
       * que os três golpes de corte seco valiam a MESMA metade, e a diferença
       * entre eles ficava inteiramente por conta de forma e alcance.
       *
       * O pedido novo desempatou os quatro, um a um: *"em vez de metade da vida
       * ele suga 40%. KameHameHa suga 70%, Jenkidama 100%, GarlikGun 60%."* A
       * escada que sai disso, contra os 100 de `maxHealth`:
       *
       *     Kienzan      40   o mais barato de armar (0,7 s), o menor alvo
       *     Galick Gun   60   0,9 s de pose, 6,5 m de raio de morte
       *     Kamehameha   70   sustentado, 2,4 s inteiros em cima de alguém
       *     Genki Dama  100   5,2 s parado no ar: a aposta
       *
       * Ela é lida de baixo para cima como o preço de armar cada um, e é essa
       * correspondência — quanto custa × quanto tira — que os quatro empatados
       * em 50 não tinham.
       *
       * 60 é o número deste: mais que o disco porque a bola é dez vezes maior e
       * custa dois centésimos a mais de pose, menos que o feixe porque o feixe
       * cobra o dano dele por 2,4 s de exposição e este resolve num quadro. */
      damage: 60,
      /* 9,2 e não 6,4: a escala das crateras subiu (ver `craterBase`) e a régua
         deste golpe subiu com ela. Dá 26,3 m de boca — a bola tem 6,5 m de raio
         de morte e deixa um buraco quatro vezes maior que ela, que é a leitura
         de uma esfera densa arrebentando no chão. */
      power: 9.2,
      cor: 0xc07bff,
      /* ELE PERSEGUE, e persegue MUITO mais do que a bola de ki.
       *
       * O pedido: "o Galick Gun também deve seguir o usuário". A diferença para
       * a perseguição da rajada (`blast.homing`, 52°/s por 0,75 s, um cone de
       * 44°) é de outra ordem, e é de propósito — este é o golpe que custa a
       * barra inteira e 0,9 s de pose, e a promessa dele é que ele CHEGA.
       *
       * --------------------------------------------- 110°/s, e o prazo pela metade
       *
       * O giro dobrou (era 55) com o resto do repertório, e o PRAZO caiu de 3 s
       * para 1,6 s no mesmo movimento. Os dois números andam juntos porque o que
       * define se um golpe persegue ou vira bumerangue não é a taxa, é o produto:
       *
       *     antes   55 × 3,0 s = 165° de correção total
       *     agora  110 × 1,6 s = 176° de correção total
       *
       * Ou seja: ele contorna o MESMO tanto que já contornava — e faz isso em
       * pouco mais da metade do tempo. É a leitura certa de "perseguição
       * duplicada" para uma bola que já contornava: ela vira na cara de quem
       * fugiu, e não trezentos metros depois.
       *
       * Deixar o prazo em 3 s daria 330° de correção sem `arcMax` nenhum para
       * segurar — o golpe voltaria por cima do ombro de quem atirou, que é
       * exatamente o que o comentário do `arcMax` do Kamehameha diz que um golpe
       * não pode fazer. Este bloco não declara `arcMax` de propósito (§6.1 do
       * plano: contornar é o que este golpe faz), então quem faz o papel de teto
       * é o prazo — e é por isso que ele teve de encolher.
       *
       * --------------------------------------------------------------- a fuga
       *
       * A conta de sempre (`v > ω·d`, ver `flySpeed`), com o boost a 64 m/s:
       * 64/1,920 rad/s = **33 m** (eram 67). A 152 m de voo — 1,6 s — ele para
       * de corrigir e vira um projétil balístico de 6,5 m de raio.
       *
       * O que mudou em jogo: perto, quem arranca de lado ainda ganha a corrida
       * angular, só que agora tem de estar a menos de 33 m em vez de 67. Longe,
       * a escapatória deixou de ser o ângulo e passou a ser o RELÓGIO — aguentar
       * 1,6 s de perseguição e depois sair da reta. **Quem tenta correr em linha
       * reta na frente dele continua não escapando de jeito nenhum.** */
      homing: {
        /** graus/s — dobrado (era 55). Raio de curva de 49,5 m a 95 m/s. */
        turnRate: 110,
        /** s — pela metade (era 3), para a correção TOTAL continuar em ~170° em
         *  vez de ir a 330°. Ver a conta acima: aqui o prazo é o `arcMax`. */
        duration: 1.6,
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
      sustain: 18,
      /* Triplicado (eram 6 s / 630 m), pelo mesmo argumento de `blast.life`:
         atirado de cima para o chão, longe, o disco sumia antes de chegar.
         18 s a 105 m/s são 1 890 m. */
      range: 1890,
      speed: 105,
      /* 4,8 e não 3,4 — *"aumente o tamanho do Kinzan e também deixe mais fácil
         de enxergar ele"*. É o segundo aumento seguido do disco (2,2 → 3,4 →
         4,8), e ele volta pela mesma razão de sempre: este é o golpe que se lê
         de longe, e o que se lia de longe era pouco.

         4,8 é 3,4 · √2, e a raiz de dois não é enfeite — é a conta inteira:
         **a área dobrou**, tanto a de acerto quanto a que ele ocupa na tela.
         Menos que isso ninguém percebe sem medir; mais que isso e ele deixa de
         ser o menor golpe do repertório, que é o lugar dele. São 9,6 m de ponta
         a ponta, contra os 13 do Galick Gun (6,5 de raio), os 13,2 do
         Kamehameha (6,6) e os 32 da Genki Dama (16) — ele continua sendo, com
         folga, a menor área de acerto dos quatro especiais.

         NA TELA, que é onde a reclamação nasce. A câmera do modo tem 68° de
         campo VERTICAL (`NamekGame`, o `PerspectiveCamera`), então a `d` metros
         a tela cobre 2·d·tan 34° = 1,349·d metros de mundo; em 1080 px de
         altura isso dá 1080/1,349d ≈ 800/d pixels por metro. O disco visto de
         frente mede:

              a 100 m   6,8 m →  54 px      9,6 m →  77 px
              a 200 m   6,8 m →  27 px      9,6 m →  38 px
              a 300 m   6,8 m →  18 px      9,6 m →  26 px
              a 400 m   6,8 m →  14 px      9,6 m →  19 px

         Vinte e seis pixels a 300 m é uma coisa que existe contra a montanha e
         contra o céu verde-claro; dezoito eram um cisco. A outra metade da
         legibilidade — a ESPESSURA do gume, que é o que sobra quando o disco
         está de perfil, e o rastro de fagulhas que marca o caminho dele — está
         em `powers/disk.js`, com a mesma conta de pixels refeita lá.

         O RAIO DESENHADO É ESTE NÚMERO, e não um parente dele: `Disco.orientar`
         faz `group.scale.set(hitRadius, …)` sobre malhas de raio 1, então o
         gume termina exatamente no `hitRadius`. Vale a regra do modo — tudo o
         que parece sólido tem de matar, ver o comentário de `genki.hitRadius`
         —, e aqui ela é ESTRUTURAL: não há um segundo número a manter em dia,
         crescer o raio de acerto é crescer o desenho.

         O QUE ISSO CUSTOU. Um disco maior é mais fácil de acertar, e a promessa
         de que dá para desviar dele é a única deste arquivo que foi MEDIDA. O
         banco foi refeito com 4,8 m e o `turnRate` desceu de 114 para 108 para
         pagar a diferença — a conta está em `homing`, na seção "a remedição". */
      hitRadius: 4.8,
      /* O disco corta de uma vez, não por segundo.
       *
       * 40 e não 50: *"em vez de metade da vida ele suga 40%."* Ele é o piso da
       * escada de dano dos quatro especiais (40 · 60 · 70 · 100, ver
       * `galick.damage`), e o lugar dele lá embaixo é o preço mais baixo de
       * armar — 0,7 s de pose contra 0,9 do Galick Gun e 5,2 da Genki Dama.
       *
       * Ele continua fechando a conta do atordoamento sozinho (`fighter.stagger`
       * derruba a partir de 30 de dano na janela), e é isso que impede a queda
       * de 50 para 40 de tirar dele o que ele é: um golpe que, acertando, põe
       * alguém no chão por 2,4 s. */
      damage: 40,
      /* 3,6 e não 1,4. O comentário antigo do arquivo chamava o buraco dele de
         "uma cicatriz e não uma cratera", e isso fazia sentido enquanto a régua
         de todo mundo era menor. Com a escala nova, 1,4 daria 12,2 m — já maior
         que o Kamehameha de antes — e continuaria sendo o menor do repertório,
         que é o lugar dele. 3,6 dão 17,6 m: o talho de uma lâmina de sete metros
         de diâmetro passando rente ao chão, que é o que se vê na referência. */
      power: 3.6,
      cor: 0xa8ff6f,
      /* ============================================ O KIENZAN É O QUE MAIS PERSEGUE
       *
       * "O Kienzan deve seguir o usuário", e o usuário completou a regra na
       * mesma frase — duas vezes, com dois anos de distância e a mesma
       * exigência: *"é possível escapar, mas o player tem que se movimentar
       * rápido para os lados"*, e depois *"o kienzan é o que persegue mais, o
       * player só consegue desviar se ele estiver voando com burst
       * lateralmente."*
       *
       * A segunda metade é a especificação inteira, ela é geométrica, e ela é a
       * ÚNICA regra do arquivo que fixa os DOIS lados de uma desigualdade. Por
       * isso este é o único `turnRate` do modo que não foi escolhido por
       * fórmula: foi **medido**, e a medição desmentiu a fórmula.
       *
       * ------------------------------- por que a fórmula não serve para este
       *
       * A régua que o resto do arquivo usa (`flySpeed`) é a corrida angular: um
       * alvo a `d` metros cruzando a `v` obriga o golpe a girar `v/d` rad/s, e
       * quem não consegue fica para trás — daí `fuga = v/ω`. Ela é ótima para
       * ordenar golpes e **péssima para decidir este número**, porque é um
       * critério de regime permanente: ela pergunta se o disco consegue manter o
       * nariz no alvo para sempre, quando o que decide um Kienzan é se ele passa
       * a mais de 4,8 m (`hitRadius`) uma vez só, em menos de um segundo de voo.
       *
       * Perseguição pura (`perseguirPonto` aponta o nariz na posição ATUAL, sem
       * antecipar) é gastadora: o disco entra numa curva de perseguição, chega
       * atrás do alvo e desperdiça o giro. Medido, ele erra em distâncias onde a
       * fórmula garantia acerto — a fuga real é ~1,7 vez a fuga calculada.
       *
       * --------------------------------------- a medição (com o disco de 3,4 m)
       *
       * Banco: o `perseguirPonto` e o `passoDeGiro` de verdade, a 60 Hz, na
       * mesma ordem de `Disco.passo` (gira, depois anda subdividido pelo raio de
       * corte), com os valores reais do golpe (105 m/s, 3,4 m, 4,5 s, cone 75°).
       * Alvo a `d` metros arrancando de través. Faixa em que ele ESCAPA:
       *
       *      ω      reação 0      reação 0,15 s   reação 0,22 s
       *      70   7,0 – 95,5 m   23 – 111,5 m    31,5 – 120 m
       *     110   7,5 – 58,0 m   23 –  73,5 m    32   –  82,5 m
       *     114   7,5 – 55,5 m   23 –  71,5 m    32   –  80,0 m
       *     118   7,5 – 53,5 m   23 –  69,0 m    32   –  78,0 m
       *     140   7,5 – 43,5 m   23 –  59,5 m    32   –  68,0 m
       *
       * Três coisas saem daí, e nenhuma delas estava na fórmula:
       *
       * 1. **O VOO NORMAL NUNCA ESCAPA.** Em nenhum `ω` de 70 a 140, em nenhuma
       *    distância de 6 a 200 m. A metade "o voo normal não desvia" do pedido
       *    é grátis; a única metade que custa calibragem é a outra.
       * 2. **A fuga é um INTERVALO, não uma meia-reta.** Colado demais não dá
       *    tempo de acumular deslocamento antes de o disco chegar (a 20 m ele
       *    voa 0,19 s), e é por isso que existe um piso. O piso é do TEMPO DE
       *    REAÇÃO e não do giro: ele fica em 23 m com 0,15 s e em 32 m com os
       *    0,22 s de `NAMEK.bot.reaction`, igual em toda a coluna. Kienzan à
       *    queima-roupa não se desvia, e isso é o prêmio de quem fechou a
       *    distância — não um defeito deste número.
       * 3. **Reagir tarde ajuda.** O teto SOBE com a reação (120 m contra 95 m,
       *    a 70°/s), porque um disco que já comprometeu a curva na posição
       *    velha erra mais feio. É contraintuitivo e é real.
       *
       * ------------------------------------------------- por que 114 e não 140
       *
       * O teto de fuga encolhe com o giro, e o que ele precisa cobrir é a FAIXA
       * DE BRIGA: 22 a 55 m — `NAMEK.bot.tooClose` embaixo, `idealRange` em
       * cima, e é literalmente a faixa que `bots.js` declara no estado "atacar".
       * Medindo no caso mais severo (reação zero, reflexo perfeito):
       *
       *     ω = 112  →  escapa até 56,5 m   ✓
       *     ω = 114  →  escapa até 55,5 m   ✓  ← o último que cobre
       *     ω = 116  →  escapa até 54,5 m   ✗
       *     ω = 140  →  escapa até 43,5 m   ✗  (12 m abaixo da briga)
       *
       * **114°/s era o maior giro que ainda honrava a frase do usuário na
       * distância em que o golpe é usado.** A 140 — o dobro literal — um Kienzan
       * lançado na distância de briga do próprio modo não teria desvio: nem com
       * burst, que é exatamente o que a frase promete que existe.
       *
       * ----------------------------------- a remedição (com o disco de 4,8 m)
       *
       * O `hitRadius` subiu de 3,4 para 4,8 m (ver o comentário dele: o pedido
       * era de tamanho e de leitura na tela). Isso mexe DIRETAMENTE nesta
       * promessa, porque o critério de escapar é geométrico e é este: o disco
       * passar a mais de um `hitRadius` do eixo do alvo. Um metro e meio a mais
       * de raio é um metro e meio a menos de erro perdoado.
       *
       * O banco foi refeito, mesmo código e mesma ordem, agora com 4,8 m. Ele
       * lê ~1,5 m mais alto que a rodada da tabela de cima (é um banco no plano,
       * sem o desvio do peito do alvo), então **a comparação que vale é coluna
       * contra coluna, na mesma rodada** — e nela a referência a bater são os
       * 57,0 m que 114°/s dava com 3,4 m:
       *
       *      ω      reação 0      reação 0,15 s   reação 0,22 s
       *      70   10   – 94,0 m   25,5 – 110,0 m  34,5 – 118,5 m
       *     107   10   – 58,5 m
       *     108   10   – 58,0 m   25,5 –  73,5 m  34,5 –  82,5 m   ← escolhido
       *     109   10   – 57,5 m
       *     110   10   – 56,5 m   25,5 –  72,5 m  34,5 –  81,0 m
       *     114   10   – 54,5 m   26   –  70,5 m  34,5 –  79,0 m
       *     140   10   – 43,0 m   26   –  58,5 m  34,5 –  67,5 m
       *
       *     (referência, 3,4 m e ω = 114, na MESMA rodada:  7 – 57,0 m)
       *
       * Manter os 114 com o disco novo derrubaria o teto de fuga para 54,5 —
       * abaixo dos 55 m de `idealRange`, ou seja, a promessa quebrada dentro da
       * faixa de briga. **108°/s devolve 58,0 m, meio metro ACIMA do que o disco
       * pequeno entregava**, e é por isso que é este o número: 109 é o limiar
       * exato, e um valor sentado no limiar é um valor que quebra na próxima vez
       * que alguém reescrever o banco. Um grau de folga custa 1 % de giro.
       *
       * O CONE não serve de moeda para esta troca, e isso foi medido antes de
       * mexer no giro: com 4,8 m e ω = 114, fechar o cone de 75° para 60° devolve
       * 0,5 m de fuga e para 45° devolve 1,5 m — ou seja, ele quase não decide o
       * teto (o que o cone decide é o disco não virar bumerangue, ver abaixo).
       * Quem paga a área é o giro.
       *
       * O PISO subiu junto, de 7 para 10 m com reflexo instantâneo, e isso é
       * consequência e não escolha: um disco de 9,6 m de diâmetro cobre mais
       * chão à queima-roupa. A faixa de briga começa em 22 m, então o piso
       * continua fora dela — e a leitura "Kienzan colado não se desvia" fica só
       * um pouco mais verdadeira do que já era.
       *
       * Não é o dobro dos 70 de antes, e é 54 % a mais. Onde o pedido traz um
       * número e uma condição e os dois não cabem juntos, quem manda é a
       * condição — e o número foi levado o mais perto do dobro que a condição
       * deixa.
       *
       * ------------------------------------ e ele é o que MAIS persegue, por tudo
       *
       * NÃO É PELO GIRO INSTANTÂNEO, e desde a remedição não é mesmo: 108 fica
       * dois graus abaixo dos 110 do Galick Gun. Essa é a única via em que ele
       * não lidera, e ela é a menos importante das quatro — o giro por segundo
       * diz o quanto o golpe vira num instante, não o quanto ele persegue. O
       * Galick Gun gasta os 110 dele por 1,6 s e depois vira pedra balística;
       * este corrige por 4,5 s, sem teto de arco nenhum por cima. Ele ganha em
       * todas as outras vias de uma vez:
       *
       *     teto de correção  NENHUM        (único do repertório)
       *     orçamento         108 × 4,5 s = 486°, sobre uma vida de 18 s
       *                       (o Galick Gun: 110 × 1,6 s = 176°)
       *     cone              75°           (o mais largo)
       *     aquisição         300 m
       *
       *     rajada       39° de teto     Kamehameha  70° (`arcMax`)
       *     Genki Dama   75° (`arcMax`)  Galick Gun 176° (teto pelo prazo)
       *
       * Os outros quatro te alcançam ou desistem; este te SEGUE. Os 486° não o
       * transformam em bumerangue porque quem segura isso é o CONE: passou de
       * 75° do rumo, a correção para. Medido sobre a vida inteira (18 s), um
       * disco que errou gasta 65° a 91° de arco e **nunca volta** — a distância
       * mínima depois de passar é a mesma do momento em que passou.
       *
       * Os 4,5 s de perseguição são quase a vida inteira dele: um disco que
       * persegue por um segundo e depois segue reto seria um disco que erra
       * bonito. Ele é o golpe barato do repertório (0,7 s de pose) e o de menor
       * área — perseguir é o que ele tem. */
      homing: {
        /* graus/s — MEDIDO, não derivado, e REMEDIDO quando o disco cresceu.
         * 108 é o giro que devolve, com o `hitRadius` de 4,8 m, a mesma fuga que
         * 114 dava com 3,4 m: o arranque lateral escapa em toda a faixa de briga
         * (até 55 m) mesmo com reflexo instantâneo, e ainda sobra meio metro. A
         * 110 o teto cai para 56,5 m e a folga acaba; a 114 cai para 54,5 m e a
         * promessa quebra. Ver as duas tabelas acima antes de mexer — e, se
         * mexer no `hitRadius`, refazer o banco: os dois números são um só. */
        turnRate: 108,
        /** s — quase a vida inteira do disco, e sem `arcMax` nenhum por cima:
         *  são 486° de correção total, de longe o maior orçamento do modo. */
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
      sustain: 21,
      /* Triplicado (eram 7 s / 322 m): quem atira de cima, mirando o chão bem
         longe, via a bola sumir no meio do voo. Agora são 21 s a 46 m/s =
         966 m, e a sala continua usando `range` para validar acerto. */
      range: 966,
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
       * Ela é a que MENOS persegue de todas, e continua sendo depois de o
       * repertório inteiro dobrar de perseguição: 40°/s contra os 52 da rajada,
       * os 114 do Kienzan, os 110 do Galick Gun e os 170 do Kamehameha. O motivo
       * é o mesmo que antes recomendava não perseguir nada: 100 de dano com 16 m
       * de raio de morte é o golpe que apaga alguém — e apaga o grupo em volta
       * dele —, e uma perseguição de verdade o transformaria numa sentença.
       *
       * ------------------------------------------------------- 40°/s, e 75° de teto
       *
       * O giro dobrou (era 20) e o teto de correção total foi de 50° para 75°,
       * que NÃO é o dobro. A conta que decide isso é a mesma do Kamehameha, e
       * ela vale repetir porque é contraintuitiva: o que o alvo sente não é o
       * ângulo, é o DESVIO LATERAL que o golpe compra, e ele é `R·(1−cos θ)`.
       *
       *     antes   R = 46/0,349 = 132 m,  θ = 50°  →  132 · 0,357 = 47,2 m
       *     agora   R = 46/0,698 =  66 m,  θ = 75°  →   66 · 0,741 = 48,8 m
       *
       * Ou seja: com o raio de curva caindo pela metade, manter os 50° teria
       * ENCOLHIDO o alcance da curva para 24 m. Os 75° devolvem o desvio de
       * antes — e ela o alcança em 1,9 s em vez de 2,5 s. É a perseguição
       * dobrada onde ela se sente (a bola vira duas vezes mais rápido) sem que a
       * esfera de 32 m de diâmetro passe a varrer meio mapa.
       *
       * ---------------------------------------------------------------- a fuga
       *
       * A conta de sempre (`v > ω·d`, ver `flySpeed`): quem arranca de lado com
       * o boost escapa dela a **até 92 m** (eram 183), e quem só voa, a até
       * 37 m. Continua sendo a MAIOR distância de fuga do jogo inteiro — contra
       * os 22 m do Kamehameha, os 33 m do Galick Gun e os 32 m do Kienzan, é
       * outra categoria de golpe: eles te alcançam, ela só te acompanha.
       *
       * Ela NÃO tem `soTrava`: 5,2 s parado carregando a bola já são
       * comprometimento de sobra, e cobrar a trava por cima seria cobrar duas
       * vezes pelo mesmo gesto. */
      homing: {
        /** graus/s — dobrado (era 20). Ainda o menor do repertório, de longe. */
        turnRate: 40,
        /** graus — teto da correção total. Ver `kamehameha.homing.arcMax`. 75 e
         *  não 100: o que se conserva é o desvio lateral, não o ângulo. */
        arcMax: 75,
        /** s — prazo. O `arcMax` fecha antes (1,9 s); isto vale quando o alvo
         *  sai do cone no meio e a bola não chega a gastar o orçamento. */
        duration: 4,
        /** graus — cone largo: a bola é enorme e vira devagar. */
        cone: 45,
        acquire: 300,
      },
    },
  },

  /** A ordem dos especiais nas teclas 1–4 e no HUD. */
  specialOrder: ["kamehameha", "galick", "disk", "genki"],

  /* ==================================================== embate — poder × poder
     O QUE ACONTECE QUANDO DOIS PODERES SE ENCOSTAM NO AR.

     Até aqui, nada: dois Kamehamehas se atravessavam, uma rajada de ki
     entrava por dentro de uma Genki Dama e saía do outro lado, e o Galick Gun
     passava por um Kienzan como se fossem hologramas. Quem implementa é
     `src/namek/powers/colisao.js`, e o cabeçalho de lá tem o argumento inteiro
     — o que mora AQUI são os números e a tabela, porque a classificação é
     regra de jogo e regra de jogo não pode existir em duas versões.

     ------------------------------------------------------------- as quatro regras

     1. **Pequeno não derruba grande.** "Um Galick Gun não pode ser explodido
        por um poder rápido." O pequeno morre com um clarão; o grande segue
        intacto e SEM DESVIO — nem um grau, senão a rajada barata viraria um
        leme de graça contra o golpe que custa a barra inteira.
     2. **Grande contra grande: os dois detonam** no ponto de contato, com o
        mesmo estouro que cada um faz ao bater no chão. "Cada um" é literal, e
        é a leitura certa de "assim como se tivesse pegado no chão": o
        Kamehameha abre o poço fundo dele, a esfera abre a bacia dela e o
        Kienzan deixa o talho dele — o mesmo som, as mesmas partículas e a
        mesma potência que o golpe já tem no terreno. No ar não há cratera; a
        um `craterAr` de raio do solo, o comportamento de chão volta a valer.
     3. **A Genki Dama é imune a tudo, menos a outra Genki Dama.** Qualquer
        outro poder que a encoste é CONSUMIDO por ela — detona ali e ela segue
        inteira. Duas Genki Damas se destroem.
     4. **As duas bolas de carga do Kamehameha** (durante o `windup`) produzem
        uma explosão à parte, com raios elétricos, e cancelam os dois golpes.

     A bola de carga só embate com outra bola de carga, e essa restrição É a
     regra 1 aplicada com honestidade: se uma rajada de ki pudesse estourar a
     esfera que se forma nas mãos, o poder pequeno estaria derrubando o poder
     grande — pela porta dos fundos, e no instante em que ele é mais caro. O
     corpo de quem carrega já responde por aquele ponto do espaço.
     ======================================================================== */
  embate: {
    /* A TABELA. Um golpe que não está aqui não embate com nada — é a recusa
       segura, e é de propósito: um especial novo entra na briga no dia em que
       alguém escrever a classe dele, não por acidente no dia em que for
       criado. */
    classe: {
      blast: "pequeno",
      kamehameha: "grande",
      galick: "grande",
      disk: "grande",
      genki: "grande",
    },

    /* Multiplicador dos raios somados no teste de contato.
     *
     * 1,15 e não 1: os dois projéteis são reconstruções (o meu é exato, o do
     * outro é interpolado a partir do disparo que a sala retransmitiu), e
     * exigir sobreposição perfeita entre duas simulações que já divergiram
     * alguns metros é exigir que o embate quase nunca aconteça. Quinze por
     * cento é a folga que faz o encontro parecer encontro sem fazer os dois
     * golpes se anularem à distância. */
    folga: 1.15,

    /* Raio de embate da BOLA DE CARGA do Kamehameha, em frações do `hitRadius`
     * do golpe (3,6 m → 2,2 m).
     *
     * O desenho dela é `hitRadius · 0,22` (0,79 m — ver `beam.js`, que explica
     * por que ela é pequena: uma parede branca a sete metros da lente tapava a
     * tela inteira). Um raio de embate igual ao desenho exigiria dois lutadores
     * a 1,6 m um do outro para o choque acontecer, que é distância de soco: a
     * regra 4 existiria e nunca dispararia. Com 0,6 são 4,3 m entre os dois
     * peitos — perto o bastante para ser um confronto declarado, longe o
     * bastante para ser alcançável em voo. */
    raioCarga: 0.6,

    /* m — raio de busca ao APLICAR um embate que veio da rede.
     *
     * A mensagem não carrega id de projétil (não existe um: o `NC2S.SPECIAL`
     * nunca teve), ela carrega dono + golpe + ponto. Cada cliente casa isso com
     * o SEU projétil daquele dono e daquele tipo mais próximo do ponto. 120 m
     * é generoso porque a cabeça de um Kamehameha anda 340 m/s: meio RTT de
     * 100 ms já são 17 m, e a minha cópia continuou voando enquanto a
     * confirmação subia e descia. Casar errado é praticamente impossível — é
     * preciso a MESMA pessoa ter DOIS golpes do MESMO tipo vivos a menos de
     * 120 m um do outro. */
    busca: 120,

    /* s — janela em que a SALA considera dois avisos do mesmo embate como o
     * mesmo acontecimento. Ver `NamekRoom.registrarEmbate`: qualquer cliente
     * que veja o choque pode avisar, e numa sala de quinze isso são até quinze
     * avisos do mesmo par em poucos milissegundos. */
    janelaSala: 0.4,

    /* Fração do raio de morte a que o solo ainda "conta" numa detonação de
       embate. Mesma régua que a esfera já usa em `orb.js` (`hitRadius · 2`), e
       pelo mesmo motivo: uma explosão de 16 m detonando a 20 m do chão arranca
       chão; a 200 m, não. */
    craterAr: 2,

    /* ---------------------------------------------------- a explosão de carga
       Os números da regra 4 — o único efeito PRÓPRIO deste arquivo, e o pedido
       foi explícito quanto ao tamanho: "dimensionada para ser vista de centenas
       de metros". Daí o raio absurdo e a duração longa; a resolução das malhas
       (quantos arcos, quantos nós) mora em `colisao.js`, que é direção de arte,
       pela mesma divisão que `orb.js` já documenta. */
    carga: {
      /** m — raio da bola de fogo. 78 m de raio são 156 de diâmetro: a 500 m de
       *  distância isso ocupa 18° de tela, mais que a Genki Dama inteira. */
      raio: 78,
      /** m — até onde os arcos elétricos chegam, em raios da bola. */
      arco: 1.9,
      /** s — o tempo todo do efeito. Longo de propósito: quem estava do outro
       *  lado da arena precisa ter tempo de virar a cabeça e ver. */
      duracao: 1.7,
      /** Força do pedido de luz (a escala de `relato.luz`, em que o feixe pede
       *  0,85 e a Genki Dama 1,9). Ela GANHA de tudo, e deve. */
      luz: 2.6,
      /** Tremor de câmera de quem estava carregando, e por quanto tempo. */
      tremor: 1.4,
      tremorT: 0.9,
      /** Cor do miolo. Quase branca: o que está no centro está quente demais
       *  para ter matiz — a cor fica nos arcos, que vêm do próprio golpe. */
      cor: 0xdff4ff,
    },
  },

  /* ===================================================================== alvo
     QUEM É O ALVO — e a TRAVA MANUAL não existe mais.

     *"Pode remover o atalho que dá lock-in no teclado (R). Esse atalho não é
     mais necessário."*

     Este bloco chamava-se "trava" e girava em torno de um interruptor: o `R`
     prendia um adversário, a câmera passava a enquadrar os dois, o corpo ganhava
     uma correção de rumo e o Kamehameha ganhava o direito de fazer curva. Tirado
     o `R`, **não sobrou gesto nenhum capaz de prender alguém** — e o que só o
     `R` podia acender deixou de ser "código pouco usado" para ser código
     inalcançável. Por isso o que saiu, saiu inteiro em vez de ficar aqui
     esperando um dono:

     • `alcance`, `cone`, `viesDaMira`, `perda` — os critérios de ADQUIRIR e de
       SEGURAR um alvo travado. Sem trava não há o que adquirir nem o que perder.
     • `assist` — a correção de rumo que a trava dava ao corpo. Ela não foi
       transferida para a mira assistida de propósito: a mira assistida é uma
       leitura do quadro atual e o gesto que ela serve é varrer o mouse por
       vários adversários. Uma assistência que puxasse o olhar para quem está sob
       o cursor brigaria com esse gesto justamente enquanto ele acontece.
     • O ANEL VERMELHO do alvo travado (`NamekHud.setLockRing`) e o retículo
       "travado" — o marcador do compromisso que deixou de existir. Quem marca
       hoje é o círculo de cada lutador acendendo (`NamekHud.setAneis`).

     **O que sobrou** é a MIRA ASSISTIDA (`mira`, logo abaixo), e ela herdou a
     única função da trava que valia por si: dizer aos projéteis em quem mirar.
     É ela que sustenta o `soTrava` do Kamehameha — ver `alvoDeAtaque`.

     E `camera` continua aqui, DORMENTE e de propósito — ver o bloco.

     Quem implementa é `src/namek/lockon.js` (o alvo e o painel), `src/namek/
     camera.js` (o enquadramento) e `src/namek/game.js` (a costura). */
  lock: {
    /* ============================================== a MIRA ASSISTIDA (soft)
     *
     * **O único alvo que existe**, escolhido a cada quadro por quem está mais
     * perto do CURSOR na tela. É o pedido, e ele descreve exatamente o problema
     * que a trava manual não resolvia:
     *
     *   *"os poderes sempre devem ir no player cujo cursor está mais próximo. Se
     *   o cursor estiver muito longe, aí os poderes saem retos… dessa forma o
     *   player consegue atirar em vários players movendo o mouse rapidamente,
     *   sem ter que ficar preso a algum player."*
     *
     * A diferença para a trava que existia no `R` era o COMPROMISSO: aquela era
     * uma decisão que durava — mudava a câmera, sobrevivia ao alvo sair da tela,
     * e era o preço da curvatura do Kamehameha. Esta não decide nada: é uma
     * leitura do quadro atual, morre no quadro seguinte, e a única coisa que ela
     * faz é dizer aos projéteis para onde ir. Tirada a trava, ficou esta — e o
     * modo não perdeu função nenhuma, porque a única que importava era essa.
     *
     * Ela **não mexe na câmera e não tem anel vermelho**: o pedido é literal
     * sobre isso ("sem travar a câmera, sem a parte vermelha nem nada"). O aviso
     * é o círculo que cada lutador já tem mudando de cor — ver
     * `NamekHud.setAneis` — e, desde o pedido da vida do alvo, a barra de vida
     * dele no painel do canto (ver `painel`, logo abaixo).
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

    /* ================================================= o PAINEL DO ALVO ----
     * A VIDA DE QUEM ESTÁ DO OUTRO LADO — **um widget só, com duas razões de
     * aparecer**. São dois pedidos que chegaram juntos e que descrevem a mesma
     * placa do canto direito:
     *
     *   1. *"Quando o player acerta o outro deve aparecer a vida do player que
     *      ele acertou na tela dele diminuindo, independente se tiver lock-in ou
     *      não. Ou seja, o player que atacou sabe quanto de vida do outro player
     *      ele tirou."*
     *   2. *"No lock-in que acontece quando o mouse fica perto, a vida do player
     *      inimigo deve aparecer para o player que está no lock-in. Deve ser a
     *      vida dinâmica e diminui conforme o player perde vida seja para ele ou
     *      outros players."*
     *
     * DOIS WIDGETS SERIAM O ERRO. As duas metades mostram exatamente a mesma
     * coisa (retrato, nome, barra de vida com fantasma) do mesmo adversário, na
     * mesma quina da tela — e na briga elas são a MESMA pessoa quase sempre, o
     * que poria duas placas idênticas uma em cima da outra. É a placa do alvo do
     * BT3, que já existia: o que mudou foi quem a acende.
     *
     * ------------------------------------------------------------ precedência
     *
     * **O ACERTO GANHA da mira, enquanto a janela dele estiver viva.** As razões,
     * em ordem:
     *
     * • acertar é um ACONTECIMENTO e mirar é um estado. O painel do acerto
     *   responde "quanto eu tirei dele?", que é uma pergunta com prazo de
     *   validade de dois segundos; o da mira responde "quem vai levar o próximo
     *   tiro?", que continua verdadeiro para sempre e volta sozinho quando a
     *   janela fecha;
     * • o conflito é raro por construção — quem você acerta é quase sempre quem
     *   está sob o cursor —, e quando ele existe é porque um golpe SEU está
     *   cobrando de alguém enquanto o cursor já passeia por outro (o feixe
     *   queimando um enquanto se procura o próximo). Nesse caso o que importa é
     *   o estrago que está saindo, não o alvo que ainda não foi escolhido;
     * • um acerto novo sempre toma a frente, inclusive de outra vítima — o painel
     *   segue o último golpe que saiu da sua mão.
     *
     * As duas metades leem a vida do MESMO lugar (`RemoteFighters`, alimentado
     * pelo `NS2C.VITALS` a 10 Hz e por todo `NS2C.HURT`), e é isso que faz a
     * barra descer quando um TERCEIRO acerta o seu alvo. */
    painel: {
      /** s que o painel fica na tela depois do último acerto MEU.
       *
       *  Longo o bastante para ser lido depois que a briga saiu de cima (a
       *  rajada sai a 6 Hz; a última bola de uma sequência não pode sumir junto
       *  com o dedo) e curto o bastante para não virar uma placa permanente que
       *  contradiz a mira. */
      acerto: 2.6,
      /** s que o painel sobrevive ao cursor SAIR de cima de alguém.
       *
       *  Sem esta cauda o painel pisca: a zona da mira assistida é apertada
       *  (`mira.raioTela`) e um adversário voando a 60 m/s entra e sai dela
       *  várias vezes por segundo. Meio segundo é mais que a maior lacuna que um
       *  alvo em fuga produz e menos que o tempo de trocar de alvo de propósito.
       *
       *  Ela vale só para o PAINEL. O alvo dos projéteis (`LockOn.sob`) não tem
       *  cauda nenhuma e morre no quadro em que o cursor sai — atirar em quem o
       *  cursor já deixou seria a assistência decidindo pelo jogador. */
      mira: 0.5,
      /** s do esmaecimento na saída. O painel some desbotando em vez de piscar
       *  para fora — é a mesma cortesia que os pinos da bússola já têm. */
      fade: 0.35,
      /** s que o número do dano fica na tela depois do último acerto. Menor que
       *  `acerto` de propósito: o "−34" é a notícia, e ele deve apagar antes da
       *  placa para não continuar afirmando um golpe que já passou. */
      dano: 1.6,
    },

    /* ------------------------------------------------------------- câmera --
     * DORMENTE: **nada nesta versão do modo passa um alvo para a câmera.**
     *
     * O enquadramento de dois corpos era o privilégio da trava manual, e o `R`
     * foi embora (ver o cabeçalho do bloco). `NamekGame` passa `null` como
     * `lockTarget`, então `NamekCamera._enquadrarTrava` — e cada número daqui —
     * nunca chega a rodar: a lente fica sempre no enquadramento livre.
     *
     * Fica de pé, e não vai para o lixo, por duas razões. A primeira é que a
     * mira assistida **não pode** herdar isto: o pedido é literal em "sem travar
     * a câmera", e uma lente que se ajeitasse sozinha a cada adversário que
     * passa sob o cursor seria o oposto do gesto que ela serve. A segunda é que
     * este é o único enquadramento de dois corpos que o modo tem escrito, com a
     * zona morta e a mistura de braço já medidas — jogá-lo fora custaria
     * reescrevê-lo por inteiro no dia em que um alvo designado voltar (uma
     * finalização, um duelo, um modo de treino), e ele não custa um ciclo por
     * quadro enquanto ninguém o chama.
     *
     * O que ele fazia, para quem for acordá-lo — era o coração do pedido §4–§6:
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
     * Agora a rajada abre **5,8 m de boca por 6,1 m de fundo** (ver
     * `blast.power` e `blast.craterDeep`) e o Kamehameha, 9 m de boca com 19,5 m
     * de fundo (ver `craterDeep` no golpe). O que muda de verdade é a base: com
     * 3,2 m, QUALQUER coisa que encoste no chão deixa buraco de gente, e é a
     * soma desses buracos — não os quatro especiais — que come a ilha.
     *
     * `craterDepth` de 0,35 para 0,62 é o "mais fundas" literal. Ele não faz a
     * cratera virar poço porque a bacia é um cosseno elevado (`craterDelta`):
     * fundo redondo, parede que suaviza na borda. O que ele muda é que dá para
     * ENTRAR no buraco — e a rajada, que hoje deixa 11,6 m de boca por 6,1 m de
     * fundo, some com um lutador de 1,78 m em UM tiro. Era isso que faltava para
     * a destruição ser terreno em vez de textura.
     *
     * Os dois multiplicadores de fundura (`craterDeep`) são a exceção a esta
     * escala e existem porque ela move raio e profundidade JUNTOS: o Kamehameha
     * pede 3,5 para perfurar em vez de amassar, e a rajada pede 1,7 para cavar
     * em vez de arranhar. Quem os interpreta é `craterFor`. */
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
     * O corte caiu para 0,1 quando a fila deixou de existir, e insistir no
     * mesmo ponto AFUNDA o buraco em vez de gastar vaga (ver
     * `NamekField.addCrater`). O corte continua aqui só para um golpe de
     * potência zero não pedir cratera nenhuma.
     *
     * **Precisa ficar ABAIXO de `blast.power`**, e essa é a única invariante
     * desta linha. Quando a rajada foi reduzida pela metade para abrir uma
     * cratera menor (8,3 m → 4,1 m, potência 0,45 → 0,0156), 0,1 ficou acima
     * dela — e o corte, que devia só filtrar potência zero, passou a filtrar a
     * rajada inteira: nenhum tiro rápido abria cratera nenhuma, grande ou
     * pequena. Foi o defeito de b7cc70c.
     *
     * A rajada voltou a subir depois (0,117, uma boca de 5,8 m), então hoje a
     * folga é de uma ordem de grandeza. **0,01 fica onde está mesmo assim**: o
     * conserto não foi "acompanhar a rajada", foi pôr o corte tão embaixo que
     * nenhum ajuste futuro de balanceamento o alcance. Um corte que precisa ser
     * lembrado toda vez que outro número muda é o mesmo bug esperando. */
    craterMinPower: 0.01,
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
       * −14 → −28 → −56, e as três vezes o pedido foi o mesmo: *"a lava deve
       * ficar mais funda"*, e depois *"para aparecer deve ser ainda mais funda.
       * O dobro de fundura."* O número não é de gosto: ele decide quanto de
       * PAREDE existe entre a boca do buraco e a poça, e é essa parede que faz o
       * poço ler como poço.
       *
       * A régua é o relevo da clareira. Medido em `NamekField.baseHeight` sobre
       * o raio de nascimento (150 m), ele vai de **−0,5 a +38 m, com média
       * +3,0**, e o centro exato está em +1,2 — a ondulação do piso é pequena,
       * mas a saia de duas das montanhas soltas entra na clareira. Contra o
       * ponto médio:
       *
       *     −14   15 m de parede   uma bacia com fundo laranja
       *     −28   29 m             um poço
       *     −56   57 m             um POÇO, com as camadas de solo inteiras
       *
       * Os 57 m são o que as cinco camadas de cor do terreno precisavam para
       * caber (terra clara, terra funda, rocha, rocha-mãe, brasa). Elas estavam
       * calibradas para 34 m de escavação e ficariam espremidas no primeiro
       * terço do buraco — ver `corDeCratera`, em `world/terrain.js`, que foi
       * reescalada junto com esta linha e não se ajusta sozinha.
       *
       * ---------------------------------------------------- o custo, MEDIDO
       *
       * Chegar à lava é cavar `1,2 − (−64) = 65,2 m` no centro do buraco. Quem
       * cava é a fusão de crateras (`NamekField.addCrater`): o primeiro golpe
       * vale a fundura inteira e cada golpe seguinte no mesmo ponto acrescenta
       * 80 % dela. Com `craterFor` dando `raio · 0,62 · craterDeep`:
       *
       *     KAMEHAMEHA  9,0 m de boca × 0,62 × 3,5 = 19,5 m por golpe
       *                 19,5 → 35,1 → 50,7 → 66,3      **4 golpes** (eram 2)
       *     RAJADA      5,8 m de boca × 0,62 × 1,7 = 6,1 m por tiro
       *                 6,1 → … → 64,8 (13) → 69,7     **14 tiros** (eram 16)
       *     GENKI DAMA  52 m de boca × 0,62 = 32,2 m por golpe
       *                 32,2 → 58,0 → 83,8             **3 golpes**
       *     GALICK GUN  16,3 m por golpe → **5 golpes**
       *     KIENZAN     10,9 m por golpe → **8 golpes**
       *
       * O Kamehameha DOBROU de custo, que é exatamente o pedido. A rajada quase
       * não mudou (16 → 14) porque a cratera dela cresceu no mesmo movimento
       * (ver `blast.power` e `blast.craterDeep`) — e 14 tiros no mesmo ponto são
       * 2,3 s de gatilho preso mirando o mesmo palmo de chão, o que continua
       * sendo uma conquista e não um acidente.
       *
       * Os números acima são do centro. Varrendo a clareira inteira (317 pontos
       * numa grade de 15 m dentro do raio de nascimento), o Kamehameha fura em
       * **4 golpes em 68 % dela e em 5 no resto**, e não há um único ponto que
       * resista a 10. É esse "não há um único ponto" que custou o teto de
       * escavação de `field.js` — ver `DESL_MIN`, que subiu junto.
       *
       * A conta ignora o corredor que o Kamehameha abre enquanto atravessa a
       * rocha (`atravessar`), como sempre ignorou: ali os buracos caem ao longo
       * do trajeto e só se somam quando o feixe é apontado quase para baixo. */
      nivel: -56,
      /* m — o fundo tem de passar disto para a poça acender.
       *
       * Oito metros abaixo de `nivel`, e a distância entre os dois é o que
       * impede uma poça de nascer rasa demais para ter onde assentar: a lava é
       * desenhada como um disco plano na cota de `nivel` (ver `world/lava.js`),
       * então um buraco que parasse exatamente ali mostraria o disco raspando o
       * chão. Os oito metros de folga garantem que, quando ela acende, já existe
       * bacia embaixo dela.
       *
       * Acompanhou o `nivel` na duplicação (−32 → −64), e tinha de acompanhar:
       * ele é medido na mesma régua e não em fração. */
      gatilho: -64,
      /** dano por segundo em quem encosta. Alto: é para doer, não para coçar. */
      dano: 34,
      /** m — quanto acima da superfície da lava o toque ainda conta. */
      margem: 1.8,
      /** m — teto do raio de uma poça, por segurança contra número absurdo. */
      raioMax: 40,
    },
  },

  /* ---------------------------------------------------- os dois planetas ----
     "Adicione 2 planetas distintos grandes no cenário. Eles devem ficar
     distantes. Devem ser planetas parecidos com luas. Kamehameha nesses planetas
     os destrói. Porém, após destruído, cai uma chuva de meteoros pegando fogo de
     tamanhos variados no cenário, causando grandes explosões e deformidade."

     ---------------------------------------------------------- o que eles são

     Duas ESFERAS DE VERDADE, e não discos pintados no domo. A diferença importa
     em três lugares e é ela que dita todos os números abaixo:

     • **Dá para acertá-las.** O Kamehameha é testado contra a esfera por
       interseção raio-esfera (ver `NamekPlanetas.naMira`), e não por um
       "cosseno maior que tanto" — o que é a mesma conta só enquanto o atirador
       está no centro do mundo.
     • **O relevo as esconde.** Elas escrevem profundidade a 2.400 m, então a
       serra na frente as recorta como recorta qualquer outra coisa. Um disco no
       fragmento do domo apareceria POR CIMA da montanha, porque o domo desenha
       primeiro e sem profundidade.
     • **Elas acompanham o olho**, como o domo e as nuvens. É o que as mantém
       "longe": sem isso, voar 700 m na direção de uma delas mudaria o tamanho
       aparente em 30 % — e um corpo celeste que cresce quando você voa para ele
       é uma bola pendurada, não um planeta.

     ------------------------------------------------------- por que 2.400 m

     O domo do céu está a 2.600 m do olho (`RAIO_DOMO`, em `sky.js`) e o `far` da
     câmera é 3.600. Os planetas ficam DENTRO do domo (senão o domo os cobriria) e
     bem além de qualquer coisa do mundo — o mar acaba a 3.200 m mas mora rente à
     linha d'água, e os dois estão a 31° e 24° de altura, longe dele.

     O raio segue disso: o que o jogador julga é o tamanho ANGULAR, e o metro só
     existe para o teste de acerto ser geometria e não trigonometria solta.
       Kuraia  340 m a 2.400 m → 16,1° de diâmetro
       Rubel   235 m a 2.400 m → 11,2° de diâmetro
     Contra os 7,8° do sol principal, os dois são visivelmente CORPOS. Com o
     campo vertical de 68° deste modo, Kuraia ocupa um quarto da altura da tela —
     que é o "grandes" do pedido, e o limite dele: mais que isso vira obstáculo.  */
  planetas: {
    /** m — distância AO OLHO dos dois corpos. Ver o cabeçalho. */
    distancia: 2400,

    /**
     * Fração do raio que o feixe precisa acertar para destruir.
     *
     * O mesmo 0,75 da Terra do arqueiro (`CONFIG.special.earth.aimFrac`), um
     * tico mais apertado: **raspar a borda não destrói planeta nenhum.** Sem
     * isto, um Kamehameha passando a meio grau do limbo contaria como acerto e o
     * jogador não teria como saber por que — a única leitura honesta de um
     * disparo assim é "passou de raspão".
     */
    miolo: 0.72,

    /**
     * s entre o disparo e o clarão. **É teatro, e o teatro é o ponto.**
     *
     * A Terra do arqueiro leva 3,5 s pela mesma razão, escrita lá: um golpe que
     * apaga um planeta no mesmo quadro em que sai da mão lê como efeito de tela.
     * Aqui são 3,2 — o feixe do Kamehameha leva 1,05 s de pose mais ~2 s até a
     * cabeça sumir no céu, então o clarão chega logo depois de o jogador perder o
     * feixe de vista. É o instante em que ele já desistiu de esperar.
     */
    viagem: 3.2,

    /* ------------------------------------------------- a sequência da morte
       Três atos, e os três somam `viagem` à parte. Estão aqui e não no cliente
       porque a sala agenda a chuva a partir deles: o primeiro meteoro tem de
       cair DEPOIS de o planeta ter visivelmente se partido, ou a causa chega
       atrasada em relação ao efeito. */
    /** s — as rachaduras acendendo, antes de qualquer estouro. */
    rachar: 1.3,
    /** s — o clarão branco engolindo o disco. Curto: é uma detonação. */
    clarao: 0.55,
    /** s — os cacos se abrindo e esfriando até sumirem. */
    cacos: 5.2,

    /**
     * Os dois corpos. `dir` é a direção A PARTIR DO OLHO, já normalizada.
     *
     * As direções não são gosto — elas foram escolhidas contra a do SOL
     * (`SOIS[0].dir`, azimute 33,7°, altura 32°), porque é ela que decide a FASE
     * de cada um, e a fase é metade do que faz uma esfera pintada parecer um
     * corpo celeste:
     *
     *   Kuraia  azimute 205°, altura 31° → quase oposta ao sol, 72 % iluminada.
     *           Uma lua gibosa alta, com o terminador cortando um quarto do disco.
     *   Rubel   azimute 300°, altura 24° → perpendicular ao sol, 42 % iluminada.
     *           Meia-lua franca: o terminador passa perto do meio e a sombra é
     *           metade do corpo.
     *
     * E elas estão a **82° uma da outra**, o que é o "direções diferentes" do
     * pedido com uma consequência prática: com o campo horizontal de ~100° deste
     * modo, dá para ver as duas no mesmo quadro só de relance, e nunca as duas
     * bem no meio. Cada uma é um marco de uma metade do céu — que é para o que
     * serve um corpo celeste num mapa sem bússola.
     *
     * `paleta` é do cliente (`world/planetas.js` a lê) e mora aqui por um motivo
     * só: os dois planetas são UMA descrição, e espalhar metade dela num arquivo
     * de desenho é como o repositório já perdeu a direção do sol uma vez.
     */
    corpos: [
      {
        id: "kuraia",
        nome: "Kuraia",
        dir: [-0.777, 0.515, -0.362],
        raio: 340,
        /* A LUA CINZENTA. Regolito, crateras por toda parte, nenhum mar — é o
           corpo "parecido com uma lua" do pedido, na leitura mais literal.
           `rocha` é o piso, `alta` é o que o sol acende, `bacia` é o fundo das
           crateras (mais escuro, porque ali a poeira é mais funda) e `sombra` é
           o lado escuro, que NÃO é preto: um planeta com lado escuro preto lê
           como um recorte de papel. Ele é iluminado pelo próprio céu. */
        paleta: { rocha: 0x8d8a86, alta: 0xd8d5cf, bacia: 0x5a5854, sombra: 0x1d2a2a },
        /** Densidade das crateras — células por raio. Alta: ela é PICOTADA. */
        crateras: 5.2,
        /** Quanto do disco é bacia escura. Zero em Kuraia: ela não tem mares. */
        mares: 0,
        /** Voltas por minuto aparentes. Devagar: é um corpo, não um pião. */
        giro: 0.35,
      },
      {
        id: "rubel",
        nome: "Rubel",
        dir: [0.457, 0.407, -0.791],
        raio: 235,
        /* O CORPO FERRUGEM. Mesma família (é uma lua, cheia de cratera), outra
           história geológica: ferro oxidado, bacias de lava já fria cobrindo um
           terço da superfície e um terminador que puxa para o violeta. A
           distinção "à primeira vista" que o pedido cobra sai de três coisas ao
           mesmo tempo — a cor, as manchas escuras grandes (que Kuraia não tem) e
           o tamanho menor. */
        paleta: { rocha: 0xa85f37, alta: 0xe8a878, bacia: 0x4a241b, sombra: 0x2a1220 },
        crateras: 3.6,
        /** Um terço da superfície em bacia escura — os "mares" dele. */
        mares: 0.34,
        giro: 0.22,
      },
    ],

    /* ================================================== a chuva de meteoros ==
       O que acontece DEPOIS da destruição, e é a metade do pedido que dura.

       Quem decide tudo é a SALA (`server/namek/planetas.js`): onde cada rocha
       cai, quando, de que tamanho, e quem ela mata. O cliente recebe uma reta e
       um relógio e desenha — é o mesmo repartição de autoridade do resto do modo
       (§8 do plano), e aqui ela não é opcional: uma chuva sorteada em cada tela
       seria quinze planetas diferentes se destruindo ao mesmo tempo.               */
    chuva: {
      /** s entre o planeta se partir e a primeira rocha entrar no céu.
       *  Depois de `rachar + clarao`, e antes de os cacos acabarem: a chuva
       *  começa COM o planeta ainda se desfazendo, que é o que liga uma coisa à
       *  outra sem precisar de uma linha de texto explicando. */
      atraso: 2.4,
      /** s de chuva. Vinte segundos são ~27 rochas — o bastante para mudar o
       *  mapa de vez e curto o bastante para a partida continuar sendo uma luta
       *  e não uma corrida de obstáculos. */
      duracao: 20,
      /** s médios entre duas rochas. Sorteado entre metade e uma vez e meia
       *  disto: intervalo fixo vira metrônomo, e metrônomo não assusta. */
      intervalo: 0.75,
      /** Quantas podem estar no ar ao mesmo tempo. É o tamanho do pool dos dois
       *  lados — a sala nunca solta a de número 21, então o cliente nunca
       *  precisa de uma vaga que ele não tem. */
      vivosMax: 20,
      /** m — o comprimento do trajeto, do céu ao chão, medido na direção do
       *  planeta que explodiu. Elas entram INCLINADAS, pelo lado dele: é isso
       *  que faz a chuva ter uma origem visível em vez de cair do zênite. */
      comprimento: 620,
      /** fração do raio da arena em que as rochas caem. 0,92 deixa a orla livre:
       *  cratera fora do círculo é recusada por `NamekRoom.cratera` e viraria
       *  uma explosão sem buraco. */
      raioQueda: 0.92,
      /** Chance de uma rocha ser mirada PERTO de alguém em vez de sorteada no
       *  disco. É a mesma decisão de `NamekRoom.tempo` com os raios: uma chuva
       *  que cai onde não há ninguém é uma chuva que não aconteceu. */
      viesNosCorpos: 0.45,
      /** m — a que distância de alguém cai a rocha enviesada. Nunca em cima: o
       *  mínimo é maior que o maior raio letal, senão a chuva mataria sem
       *  ninguém ter tido onde ler o aviso. */
      viesPerto: 34,
      viesLonge: 210,
    },

    /* ------------------------------------------------------------ o meteoro
       Três classes, e a variedade de tamanho é o pedido literal ("de tamanhos
       variados"). `peso` é a chance de sorteio de cada uma — a pequena é a
       maioria, a colossal é o acontecimento. */
    meteoro: {
      classes: [
        /** Pedrisco. Cratera de 15 m, explosão que mata a 6 m. */
        { raio: 2.2, power: 2.4, velocidade: 150, peso: 0.5 },
        /** Pedregulho. Cratera de 22 m. */
        { raio: 5, power: 6, velocidade: 125, peso: 0.35 },
        /** Colosso. Cratera de 37 m — o maior buraco que este jogo abre. */
        { raio: 11, power: 20, velocidade: 100, peso: 0.15 },
      ],

      /* ================== OS DOIS RAIOS, e por que eles são dois ==============
       *
       * O pedido tem duas frases e elas descrevem coisas diferentes:
       *
       *   "Esses meteoros, se pegam no player, tira 50% da vida."
       *   "O raio de explosão do meteoro também mata os players."
       *
       * A primeira é a rocha EM VOO encostando em alguém: um corpo sólido a
       * 150 m/s passando por cima de você. Dói muito e não mata — 50 de 100 é
       * metade da vida, exatamente como está escrito, e fica entre o Kienzan
       * (40) e o Galick Gun (60) na escada dos especiais — um pouco menos que um
       * Kamehameha inteiro em cima de alguém (70). Cobra UMA vez por
       * rocha e por vítima: uma pedra não atropela a mesma pessoa duas vezes.
       *
       * A segunda é o ESTOURO no chão, e ali não há fração: quem está dentro da
       * bola de fogo morre. É o que separa "fui atingido" de "estava no ponto de
       * impacto", e é por isso que os dois raios não podem ser o mesmo número —
       * se fossem, ou o atropelamento mataria (e a primeira frase deixaria de
       * valer) ou a explosão pouparia (e a segunda também).
       *
       * Os dois são MÚLTIPLOS do raio da rocha, e não metros fixos, porque o
       * pedido é sobre tamanhos variados: um pedrisco de 2,2 m que matasse a
       * trinta metros seria uma mina terrestre disfarçada de pedra.
       *
       *   classe      rocha   acerto (50 %)   letal (morte)
       *   pedrisco    2,2 m       4,2 m           6,2 m
       *   pedregulho  5,0 m       9,5 m          14,0 m
       *   colosso    11,0 m      20,9 m          30,8 m
       *
       * O colosso mata num raio quase igual ao da cratera que ele abre (37 m), e
       * é a leitura certa: morre quem estava dentro do buraco que se abriu.
       */
      /** Múltiplo do raio da rocha — o toque EM VOO. Cobra `danoDireto`. */
      raioAcerto: 1.9,
      /** Múltiplo do raio da rocha — a explosão no chão. Dentro dela, é FATAL. */
      raioLetal: 2.8,
      /** Fração da vida cheia que o toque em voo leva. Meia vida, literalmente. */
      danoDireto: 0.5,

      /** graus/s — o tombo da rocha no ar. Só desenho; a sala não o simula. */
      giro: 55,
      /** s entre dois sopros do rastro de fogo, por rocha. Ver `meteoros.js`. */
      rastro: 0.075,
      /** Múltiplo do raio — o tamanho da mancha que ela projeta no chão antes de
       *  chegar. É o aviso, e ele é generoso de propósito: a explosão mata. */
      marca: 3.4,
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

  /* ------------------------------------------------------------------ peixe
     O PEIXE GIGANTE que salta no mar — o do começo de Dragon Ball, aquele que o
     Goku pesca. Corpo roliço, boca larga, barbatanas grandes; de tempos em
     tempos ele emerge num arco, gira o corpo no ar e mergulha de volta.

     Três decisões moram nesta tabela e vale dizer por quê antes dos números:

     • **A SALA É DONA DELE.** Quando salta, onde salta, o rumo do arco e a vida
       que lhe resta são todos do servidor, pelo mesmo motivo que a vida dos
       lutadores é (§8 do plano): quinze telas têm de ver o MESMO peixe no mesmo
       lugar, e um bicho sorteado no cliente sairia da água em quinze horas
       diferentes. O que viaja é o salto INTEIRO num pacote só (ver `NS2C.FISH`),
       e cada cliente integra a mesma parábola a partir dele — é o mesmo truque
       do `q` do Kamehameha: manda-se o roteiro, não o quadro.

     • **ELE SÓ EXISTE ENQUANTO SALTA.** Fora do arco não há peixe na cena: nem
       corpo, nem colisor, nem consulta. O único resto é o VULTO — a sombra
       subindo debaixo d'água nos `aviso` segundos que antecedem a saída, que é o
       que impede o salto de ser um susto sem aviso e o que dá ao jogador tempo
       de apontar. Fora dessa janela ele custa exatamente zero.

     • **A ÁGUA ABERTA, E NÃO A ARENA.** A linha d'água cai por volta de 612 m do
       centro (ver `NamekField.baseHeight`) e o teto de passeio é 760 m
       (`world.flyRadius`). A faixa abaixo é o que sobra: fora da rebentação, à
       vista de quem está na ilha, e alcançável por quem quiser chegar perto. */
  peixe: {
    /* ------------------------------------------------------------- o corpo (m)
       Enorme de propósito: um lutador tem 1,78 m, e o peixe tem quinze deles do
       focinho à base da cauda. É a escala que a referência pede — o bicho não é
       fauna de cenário, é um acontecimento.

       Os três medem o TRONCO. A silhueta desenhada é maior, e o quanto sai de
       cada peça: a cauda acrescenta ~19 % atrás (31 m de ponta a ponta), a
       dorsal quase dobra a altura no meio, e as peitorais abertas dão 15 m de
       envergadura. Medir o tronco é a convenção útil das duas — é ele que a
       tabela de perfil de `world/peixe.js` escala, e ninguém quer reescrever
       aquela tabela para mudar o tamanho de uma nadadeira. */
    /* Trinta e quatro metros, e não 26. *"Pode aumentar o tamanho desse peixe
       também."* Os três crescem JUNTOS (×1,3): a tabela de perfil de
       `world/peixe.js` é normalizada, então mexer num eixo sozinho produziria
       um bicho achatado ou uma enguia — o que se quer é o mesmo animal maior. */
    comprimento: 34,
    altura: 12.5,
    largura: 9.6,
    /* m — raio da ESFERA de acerto, centrada no meio do corpo.
     *
     * Uma esfera e não a cápsula do lutador: a cápsula é vertical por
     * construção (`distancia2AoAlvo` interpola em y), e um peixe no ar está
     * deitado. Com `altura = 2 × raio` a cápsula degenera exatamente numa
     * esfera, que é a forma honesta para um corpo que gira no ar — ver
     * `NamekPeixe.alvo`. 12 m cobrem o bojo inteiro e deixam de fora só a ponta
     * da cauda e o focinho, que é a margem certa: acertar o peixe tem de ser
     * fácil quando se está perto e difícil de duzentos metros.
     *
     * Eram 9, e cresceu com o corpo (×1,3): o raio de acerto é uma leitura do
     * bojo, e um bicho 30 % maior com a mesma esfera passaria a ter tiro
     * passando por dentro dele. */
    raioAcerto: 12,

    /* O id reservado dele na lista de alvos do sistema de poderes.
     *
     * NEGATIVO pelo mesmo motivo que o do Freeza é (ver `NAMEK.freeza.id`, logo
     * abaixo neste arquivo): `proximoId` da sala começa em 1 e só cresce, então
     * nenhum lutador — humano ou bot — colide com ele nem depois de mil entradas.
     *
     * **−2 porque o −1 já é do Freeza**, e é para isso que os dois moram no
     * mesmo arquivo: os ids negativos são um espaço de nomes COMPARTILHADO, e
     * cada alvo que não é gente precisa de um só seu. Duas peças com o mesmo
     * número não dariam erro nenhum — o desvio do boss em `NamekGame.reportar`
     * roda primeiro e engoliria calado todo acerto no peixe. */
    alvoId: -2,

    /* --------------------------------------------------------- onde ele mora
       m do centro da arena. A praia acaba aos ~630 m e a água abre depois disso;
       `flyRadius` é 760. Esta faixa é a água aberta VISÍVEL: longe o bastante da
       costa para não sair de dentro da rebentação, perto o bastante para caber
       na tela de quem está na ilha e para quem quiser voar até lá conseguir. */
    /* O teto encolheu de 726 para 700 quando o `alcance` do salto cresceu: o
       arco sai DE TRAVÉS, então o avanço afasta o corpo do centro pela
       hipotenusa — √(700² + 183²) = 723 m, ainda dentro dos 760 m de
       `world.flyRadius`. Com 726 de raio inicial o salto mais longo terminaria
       fora do mundo. */
    raioMin: 630,
    raioMax: 700,
    /* Fração dos saltos que acontece na direção de ALGUÉM que está em campo, em
       vez de num ângulo qualquer do círculo. É a mesma regra do relâmpago
       (`NamekRoom.tempo`) e existe pelo mesmo motivo: um peixe que salta às
       costas de todo mundo é um peixe que não saltou. */
    perto: 0.65,
    /** graus — abertura do sorteio em torno do rumo de quem foi escolhido. */
    pertoAbertura: 38,

    /* ------------------------------------------------------------- o relógio */
    /** s — intervalo médio entre dois saltos do mesmo peixe. */
    intervalo: 19,
    /* s — o sorteio em torno do intervalo, para os dois lados. Sem ele o peixe
       vira metrônomo, e um metrônomo deixa de ser um acontecimento na terceira
       repetição. */
    variacao: 8,
    /** s — carência até o primeiro salto de um peixe recém-nascido. */
    primeiro: 7,
    /* s — o vulto sob a água antes de o corpo romper a superfície.
     *
     * **CINCO segundos, e eram 2,4.** *"Faça ele nadar mais tempo debaixo da
     * água, tanto antes de pular, para ficar mais fácil de saber onde ele vai
     * aparecer."* Este número é literalmente o telegrama do salto: é a janela em
     * que a sombra sobe e em que o jogador tem para escolher a posição, apontar
     * e começar a atirar. Dobrá-la é o ajuste mais barato para "está muito
     * difícil de matar" — ele não mexe em vida, dano nem no acerto, só dá tempo.
     *
     * Ele também é a folga que a mensagem `NS2C.FISH` tem para atravessar uma
     * rede ruim antes de o corpo precisar estar na tela; cinco segundos são
     * folga de sobra e o custo continua sendo zero (é um pacote a cada ~19 s). */
    aviso: 5,
    /* s — **quanto demora até aparecer outro depois que um morre.** É o pedido
       literal, e o número é longo de propósito: matar o peixe tem de ser um
       acontecimento com consequência, não uma torneira. */
    respawn: 34,

    /* --------------------------------------------------------------- o salto
       Uma parábola balística resolvida por FRAÇÃO do salto (u ∈ [0,1]) e não por
       integração de gravidade: os dois dão a mesma curva, e a fechada é a única
       que garante que quinze clientes com quinze `dt` diferentes desenhem o
       peixe no mesmo ponto. Ver `NamekPeixe.pose`. */
    /* **O SALTO INTEIRO CRESCEU**, e é a outra metade da resposta a "o peixe
       está muito difícil de matar".
     *
     * A conta é direta: o bicho só pode ser atingido enquanto está FORA
     * d'água (ver `NamekPeixeSim.noAr`), então o tempo de voo é literalmente a
     * janela de tiro da partida inteira contra ele. Eram 2,6 a 3,9 s — 3,2 s em
     * média, ou 19 bolas de ki a 6/s, contra 160 de vida a 6 por bola. Ou seja:
     * **a rajada sozinha não matava o peixe nem no melhor salto**, por
     * construção, e era preciso gastar um especial em cima de um alvo que
     * aparece a 650 m do centro.
     *
     * Com 4,2 a 6,0 s (5,1 s de média) cabem 30 bolas — a rajada passa a fechar
     * a conta num salto bom, e continua não fechando num salto ruim. E mais
     * alto (38 a 76 m) e mais longe (60 a 150 m) o corpo passa mais tempo LONGE
     * da rebentação e recortado contra o céu, que é onde ele é visível. */
    duracaoMin: 4.2,
    duracaoMax: 6,
    /** m — altura do ápice acima da linha d'água. Eram 24–47. */
    alturaMin: 38,
    alturaMax: 76,
    /** m — quanto ele avança na horizontal do mergulho à saída. Eram 34–92.
     *  Ver `raioMax`: o teto de onde ele nasce encolheu para este caber. */
    alcanceMin: 60,
    alcanceMax: 150,
    /* Fração de `alcance` que o corpo desloca DE LADO no ápice — a "curva" do
       pedido. O deslocamento é zero nas duas pontas e máximo no meio, então a
       trajetória vergueia e volta em vez de virar uma banana torta. */
    curvaMax: 0.22,
    /** rad — rolagem acumulada no salto inteiro. O parafuso do corpo no ar. */
    giroMax: 2.6,
    /** m — fundura em que o vulto começa a subir. Mais fundo (eram 9) porque a
     *  subida agora leva `aviso` = 5 s: com 9 m ela seria lenta demais para ler
     *  como um bicho vindo à tona. */
    vultoFundura: 16,
    /** s — o mergulho visível depois de a cauda entrar na água. Eram 2,4 — a
     *  outra metade do "nadar mais tempo debaixo da água". */
    afundar: 4,

    /* --------------------------------------------------------- vida e morte */
    /* A vida dele. 160 é uma barra e meia de lutador: uma Genki Dama (100) não
       resolve sozinha, um Kamehameha inteiro em cima (21/s por 2,4 s) chega
       perto, e a rajada básica (6 por bola) mata em 27 acertos — o que num salto
       de três segundos e meio a 6 bolas/s é possível e não é fácil. */
    vida: 160,
    /** s — teto do `dt` de UM aviso de feixe. Mesma trava do `SPECIAL_HIT`. */
    dtMax: 0.5,
    /* Teto de dano de um aviso de FEIXE, e só dele.
     *
     * A distinção é o ponto: o dano de um projétil (Galick, Kienzan, Genki) sai
     * inteiro do config e o cliente não tem como inflá-lo, enquanto o do feixe é
     * `dps × dt` com o `dt` vindo pela rede. Aplicar o teto aos dois — que é o
     * que estava escrito — fazia a Genki Dama (100) bater igual ao Galick Gun
     * (60) no peixe: o maior golpe do jogo aparado em silêncio justamente contra
     * o único alvo em que ele é a escolha óbvia.
     *
     * Com `dtMax` de meio segundo e 29,2 de dps, um aviso legítimo chega a 14,6.
     * Os 40 aqui são folga de segurança, não equilíbrio. */
    danoAvisoMax: 40,
    /** m — distância máxima entre quem relata o acerto e o ponto do salto. */
    alcanceAviso: 1400,
    /** s — carência entre dois avisos de acerto do mesmo jogador. */
    avisoCarencia: 0.07,
    /** Potência do estouro da morte — alimenta o efeito e a receita de som. */
    mortePotencia: 6,

    /* ---------------------------------------------------------------- cores
       Sem textura nenhuma, como todo o resto do jogo: o que separa dorso, barriga
       e barbatana é cor de vértice num material só. */
    /** Dorso: azul-esverdeado escuro, para destacar contra o mar turquesa. */
    cor: 0x2f5f72,
    /** Barriga: quase branca — é ela que aparece quando ele vira no ar. */
    corBarriga: 0xdcead8,
    /** Barbatana e cauda: um degrau mais escuro que o dorso. */
    corBarbatana: 0x214657,
    /** Olho e boca: preto. */
    corOlho: 0x100c0a,
    /** Espuma do respingo e da entrada. */
    corEspuma: 0xe8fbff,
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
     * descobrir apanhando.
     *
     * ------------------------------------------------------- e o PADRÃO é fácil
     *
     * *"Por padrão todos os bots adicionados devem ser no fácil caso o jogador
     * não selecione a dificuldade deles."* Era "medio", e "medio" é uma escolha
     * que ninguém fez: quem abre a sala e aperta "+ bot" não pediu 72 % de
     * velocidade, 65 % de esquiva e 60 % de chance de especial — ele pediu
     * companhia. O nível que um jogador não escolheu tem de ser o que menos
     * atrapalha quem ainda está aprendendo onde ficam as teclas.
     *
     * A dificuldade é da SALA e não do bot (ver o bloco acima), então este
     * padrão vale nos três lugares em que ela nasce, e vale por LEITURA — não há
     * nenhum "medio" literal em nenhum deles, e não pode passar a haver:
     *
     *   • `BotPool` (`server/namek/bots.js`), no construtor;
     *   • `NamekRoom.limpar`, que devolve a sala ao padrão quando ela esvazia;
     *   • `NamekGame` (`src/namek/game.js`), enquanto o `welcome` não chega.
     *
     * Quem quiser bots bravos aperta o botão do menu, e a escolha vale para a
     * sala inteira e para os bots já em campo — que é o contrato do bloco. */
    dificuldadePadrao: "facil",
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

  /* ====================================================================== FREEZA
     O BOSS. Um só, em campo, contra TODO MUNDO ao mesmo tempo.

     **Os números dele NÃO moram aqui.** Eles moram em
     `src/shared/namek/ajustes-freeza.js`, que é um arquivo escrito para ser
     editado por quem está JOGANDO — cada parâmetro com uma explicação em
     português simples do que acontece se aumentar e do que acontece se
     diminuir, mais um punhado de receitas prontas ("quero ele bem fácil",
     "quero ele brutal").

     Ele é a FONTE DE VERDADE, e este campo é só o encanamento que o traz para
     dentro de `NAMEK`. Nada é redeclarado aqui de propósito: um número que
     existisse nos dois lugares divergiria no primeiro ajuste, e o arquivo de
     ajustes viraria decoração — o usuário mexeria nele e o jogo continuaria
     usando o valor daqui.

     ------------------------------------------------------- por que ele é assim

     Ele não é um lutador com números maiores, e a separação começa na estrutura:
     um bot é um `NamekBot` na lista da sala, com vida de 100, placar,
     renascimento e a mesma cápsula de 1,78 m de todo mundo. O Freeza tem vida na
     casa dos milhares, não renasce, não entra no placar, não ocupa vaga em
     `NAMEK.net.maxPlayers` e voa o tempo todo. Ver o §1 de
     `server/namek/freeza.js` para o argumento inteiro.

     A ESCALA do corpo é maior que a canônica de propósito: 1,58 m de Freeza
     contra 1,78 m de lutador fariam do boss o menor corpo em campo. 2,24 m (mais
     a cauda, que sozinha tem 2,6 m) é o que o olho lê como "aquilo ali é o
     chefe" antes de a barra de vida aparecer no topo da tela.

     A VIDA é função de quanta gente está em campo — ver `vidaDoFreeza`, logo
     abaixo, que é onde a conta e o argumento dela estão.

     Duas travas técnicas que o arquivo de ajustes marca como "NÃO MEXA", e que
     valem ser sabidas de deste lado também:

     • `raio` tem de ser menor que a METADE de `altura`. `distancia2AoAlvo` (em
       `powers/blast.js`) monta o eixo da cápsula de `y + raio` até
       `y + altura − raio`; invertido, ele degenera e o volume de acerto vira
       uma esfera por acidente.
     • `rajada.velocidade`/`raio` e `onda.raio` são DITADOS pelos pools do
       cliente, que leem `NAMEK.blast` e `NAMEK.ki`. Divergir aqui faz o dano
       acontecer num lugar e o desenho em outro. */
  freeza: FREEZA,
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

/* ------------------------------------------------------------------- Freeza */

/**
 * Os multiplicadores de uma dificuldade do BOSS, com o padrão para id
 * desconhecido.
 *
 * Existe pelo mesmo motivo que `dificuldadeBot`, e o preço do engano aqui seria
 * pior: um `undefined` multiplicando a vida máxima do Freeza dá `NaN`, e um boss
 * com `NaN` de vida não é um boss difícil — é um boss que nunca morre, porque
 * toda comparação com `NaN` é falsa.
 */
export function dificuldadeFreeza(id) {
  const F = NAMEK.freeza;
  return F.dificuldades[id] ?? F.dificuldades[F.dificuldadePadrao];
}

/**
 * **A vida do boss, em função de quanta gente está em campo.**
 *
 * O pedido é literal: *"seu life aumenta de acordo com a quantidade de
 * players."* A conta:
 *
 *     vida = (vidaBase + vidaPorLutador × n) × dificuldade.vida
 *
 * com `n` = humanos + bots vivos ou não, limitado a `lutadoresMax`.
 *
 * **Linear, e não por raiz.** A tentação é usar `√n` (é o que muitos jogos
 * fazem, para o boss não virar uma esponja quando a sala enche), e aqui seria
 * errado: o dano que a sala inteira entrega TAMBÉM cresce linearmente, então uma
 * vida sublinear faria a luta encurtar a cada pessoa que entra — e uma luta de
 * boss que fica mais curta quanto mais gente chega é uma luta que só o primeiro
 * jogador viu. O que cai com a lotação é a EFICIÊNCIA (quem está morto não
 * atira), e é por isso que a duração medida sobe um pouco em vez de ficar plana.
 * Ver a tabela de segundos medidos no fim de `ajustes-freeza.js`.
 *
 * Está aqui, e não na sala, porque os dois lados a leem: o servidor para decidir
 * quando ele morre, o cliente para desenhar a barra cheia no instante em que ele
 * entra — antes do primeiro `FREEZA_STATE` chegar.
 *
 * @param {number} lutadores humanos + bots em campo
 * @param {string} [dificuldade] id em `NAMEK.freeza.dificuldadeOrdem`
 */
export function vidaDoFreeza(lutadores, dificuldade) {
  const F = NAMEK.freeza;
  const n = Number.isFinite(lutadores) ? Math.max(0, Math.min(lutadores, F.lutadoresMax)) : 0;
  const d = dificuldadeFreeza(dificuldade);
  return Math.round((F.vidaBase + F.vidaPorLutador * n) * d.vida);
}

/**
 * O dano que um golpe de jogador tira do BOSS. Ver `NAMEK.freeza.dano`.
 *
 * Uma função e não uma leitura direta da tabela porque o `kind` vem da REDE (é
 * o cliente que declara qual golpe acertou), e um id inventado devolveria
 * `undefined` — que somado à vida dela vira `NaN`. O padrão é o da rajada, que é
 * o menor da tabela: um golpe que a sala não reconhece nunca pode valer mais que
 * o que ela reconhece.
 *
 * @param {string} kind `"blast"` ou uma chave de `NAMEK.specials`
 * @returns {number} dano por acerto — ou por SEGUNDO, no caso do Kamehameha
 */
export function danoNoFreeza(kind) {
  const v = NAMEK.freeza.dano[kind];
  return Number.isFinite(v) ? v : NAMEK.freeza.dano.blast;
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

/**
 * **O PRESET DE QUALIDADE QUE O JOGADOR ESCOLHEU.** Ver `NAMEK.render`.
 *
 * Uma função e não uma constante porque `localStorage` só existe no navegador —
 * a sala importa este mesmo arquivo em Node, e uma leitura no corpo do módulo
 * derrubaria o servidor no `import`. Aqui ela é chamada uma vez, no arranque do
 * cliente, e o `try` cobre o resto (aba anônima, iframe sem storage): sem
 * resposta, vale o padrão, que é o comportamento de antes desta feature.
 *
 * @param {string} [forcado] para banco de provas e para o dia em que houver um
 *   menu de qualidade próprio deste modo
 */
export function qualidadeNamek(forcado) {
  const P = NAMEK.render.presets;
  let nome = forcado;
  if (!nome) {
    try {
      nome = globalThis.localStorage?.getItem(NAMEK.render.chave) ?? null;
    } catch {
      nome = null;
    }
  }
  return P[nome] ? P[nome] : P[NAMEK.render.padrao];
}
