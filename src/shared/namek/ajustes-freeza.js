/* ===========================================================================

                    AJUSTES DO FREEZA — mexa aqui à vontade

   ===========================================================================

   ESTE ARQUIVO É SEU. Ele existe para você poder deixar o Freeza mais fraco,
   mais forte, mais rápido ou mais lento sem precisar entender nada de
   programação e sem abrir nenhum outro arquivo do jogo.

   ---------------------------------------------------------------- como usar

   1. Ache o número que você quer mudar (todos estão explicados logo abaixo).
   2. Troque o número.
   3. Salve o arquivo.
   4. Recarregue a página do jogo. Pronto.

   Se o servidor de desenvolvimento estiver rodando (`npm run dev`), ele percebe
   a mudança sozinho e reinicia. Você não precisa mexer em mais nada, em lugar
   nenhum: este arquivo é a fonte de verdade dos números do Freeza, e o resto do
   jogo lê daqui.

   ------------------------------------------------------ atalho: as receitas

   Se você só quer "deixar ele mais fácil" e não quer escolher número nenhum,
   pule tudo e vá direto na palavra `RECEITA`, logo abaixo. Troque
   `"normal"` por `"facilimo"`, `"facil"` ou `"brutal"` e acabou.

   ------------------------------------------------------------- o que NÃO mexer

   Uns poucos números estão marcados com **NÃO MEXA** no comentário. Eles não
   são de balanceamento — são encanamento, e mudá-los quebra o jogo de um jeito
   que não é óbvio (o boss fica invisível, os tiros atravessam ele, o jogo trava).
   Estão todos identificados. Fora esses, nada aqui pode quebrar nada: no pior
   caso o Freeza fica ridículo ou impossível, e você volta o número.

   ------------------------------------------------------------------ o formato

   Números decimais usam PONTO, não vírgula: escreva `1.5`, nunca `1,5`.
   Não apague as vírgulas do fim das linhas.
   Linhas que começam com // são comentário, e o jogo ignora. Os blocos de
   texto cercados por barra-asterisco também.

   =========================================================================== */

/* ===========================================================================
   RECEITAS PRONTAS
   ===========================================================================

   Escolha UMA palavra abaixo e escreva ela em `RECEITA`, na linha que vem
   depois da tabela.

     "facilimo"  O Freeza vira quase um treino. Metade da vida, um terço do
                 dano, voa devagar. Bom para conhecer os golpes dele sem morrer.

     "facil"     Uma luta tranquila. Ele ainda machuca, mas dá muito espaço.

     "normal"    O padrão do jogo, e o que está valendo agora. Uma luta de
                 aproximadamente um minuto sozinho, em que você morre uma ou
                 duas vezes.

     "brutal"    Quase o dobro de vida e muito mais dano. Para quem já decorou
                 os golpes dele e quer sofrer.

   A receita multiplica três coisas de uma vez: a VIDA dele, o DANO dos golpes
   dele e a VELOCIDADE de voo dele. Ela NÃO mexe em quanto os seus poderes
   tiram dele — isso é a tabela QUANTO OS SEUS PODERES TIRAM DELE, mais
   abaixo, e você pode
   mexer nela junto se quiser.
   =========================================================================== */

/** ESCREVA AQUI a receita que você quer. */
export const RECEITA = "normal";

const RECEITAS = {
  facilimo: { vida: 0.45, dano: 0.35, velocidade: 0.8 },
  facil: { vida: 0.7, dano: 0.65, velocidade: 0.9 },
  normal: { vida: 1, dano: 1, velocidade: 1 },
  brutal: { vida: 1.9, dano: 1.7, velocidade: 1.15 },
};

/* Se você escrever uma palavra que não existe na tabela, o jogo usa "normal"
   em vez de quebrar. */
const R = RECEITAS[RECEITA] ?? RECEITAS.normal;

/* ===========================================================================
   OS NÚMEROS
   =========================================================================== */

/* ===========================================================================
   O TAMANHO DELE — uma alavanca só
   ===========================================================================

   *"O personagem do Freeza deve ser bem maior. Ele deve ser o triplo do tamanho
   que ele é. Ajuste essa proporção com a velocidade dele, para que a proporção
   não atrapalhe o desvio dos poderes, etc."*

   `ESCALA` multiplica de uma vez a altura, a grossura de acerto, a altura do
   peito e a cauda — os quatro números que descrevem o corpo. Ele existe como
   constante e não como quatro edições porque o CORPO DESENHADO
   (`src/namek/boss/freeza.js`) é montado a partir de uma antropometria fixa de
   2,24 m: aquele arquivo lê `altura / alturaBase` e escala a raiz inteira do
   boneco. Mexer só em `altura` faria a cápsula de acerto crescer e o boneco
   continuar do mesmo tamanho — tiro morrendo no ar a metros do corpo.

   ----------------------------------------------------- e a conta da velocidade

   Um corpo três vezes mais alto tem uma cápsula três vezes mais grossa (1,1 →
   3,3 m de raio), ou seja **nove vezes a área de acerto**. Sem compensação, a
   luta viraria um alvo de treino que voa. As duas compensações estão no bloco
   `voo`, e as duas são de POSIÇÃO e não de dano:

     • ele voa mais rápido (34 → 42 de cruzeiro, 58 → 64 de arranque);
     • e briga de mais longe (`distanciaIdeal` 62 → 78, `perto` 26 → 40) — o que
       é também a leitura certa de uma criatura desse tamanho.

   A distância é o que de fato devolve a dificuldade: o raio de acerto é
   constante em metros, mas o que a mira sente é o ÂNGULO que ele ocupa. A 62 m
   um corpo de 1,1 m abria 2,0°; a 78 m um corpo de 3,3 m abre 4,8°. Ainda é mais
   fácil de acertar que antes — e tem de ser, porque agora ele desvia melhor. */
const ESCALA = 3;

export const FREEZA = {
  /* -------------------------------------------------------------------------
     IDENTIDADE
     ------------------------------------------------------------------------- */

  /** **NÃO MEXA.** O número interno que identifica o Freeza para o jogo. Ele é
   *  negativo de propósito, para nunca ser confundido com um jogador. Mudar
   *  isto faz o boss sumir da lista de alvos e ficar impossível de acertar. */
  id: -1,

  /** O nome dele, do jeito que aparece na barra no topo da tela. Pode trocar
   *  por qualquer coisa. Padrão: "Freeza". */
  nome: "Freeza",

  /** A cor dele, em código de cor de computador (`0x` + vermelho, verde e azul
   *  em hexadecimal). É a cor da aura, dos poderes, do nome no topo e do anel
   *  que marca ele na tela — tudo de uma vez.
   *  Exemplos: `0xc21ad8` roxo (padrão) · `0xff2200` vermelho ·
   *  `0x22ff88` verde · `0xffcc00` dourado. */
  cor: 0xc21ad8,

  /* -------------------------------------------------------------------------
     O TAMANHO DELE
     ------------------------------------------------------------------------- */

  /** **NÃO MEXA.** A altura da ANTROPOMETRIA com que o boneco dele foi
   *  desenhado. Ela não é o tamanho dele em campo — é a régua contra a qual
   *  `altura` (logo abaixo) é dividida para o corpo inteiro ser escalado.
   *  Mudar isto desmonta as proporções do boneco. Ver `ESCALA`, no topo. */
  alturaBase: 2.24,

  /** Altura do corpo, em metros (um jogador tem 1,78 m). **6,72 m** — o triplo
   *  do original, e o comprimento de um ônibus em pé.
   *  AUMENTAR: ele fica maior e mais fácil de acertar.
   *  DIMINUIR: fica menor e mais difícil de acertar.
   *  O jeito certo de mexer é pela `ESCALA` no topo do arquivo, que move este
   *  número e os outros três do corpo juntos.
   *  Faixa que faz sentido: 1.6 a 9. */
  altura: 2.24 * ESCALA,

  /** A "grossura" do corpo para efeito de acerto, em metros — o quanto os seus
   *  tiros perdoam de erro de mira.
   *  AUMENTAR: fica muito mais fácil de acertar (é o jeito mais direto de
   *  facilitar a luta sem mexer em dano nenhum).
   *  DIMINUIR: fica mais difícil.
   *  **Cuidado:** tem de ser sempre MENOR que a metade da `altura` acima —
   *  3,3 contra 3,36, que é justamente por isso que os dois são escalados
   *  juntos. Escrever um sem o outro embaralha a área de acerto. */
  raio: 1.1 * ESCALA,

  /** A que altura do corpo dele os golpes são marcados, em metros do pé para
   *  cima. Serve para a mira apontar para o peito e não para os pés — e é de lá
   *  que os poderes dele saem. */
  peito: 1.36 * ESCALA,

  /** Comprimento da cauda, em metros. É só enfeite: ela não machuca ninguém. */
  cauda: 2.6 * ESCALA,

  /* -------------------------------------------------------------------------
     A VIDA DELE
     -------------------------------------------------------------------------

     A vida do Freeza não é um número fixo: ela CRESCE conforme entra gente na
     partida, porque senão um chefe calibrado para uma pessoa morreria em cinco
     segundos com oito atirando nele.

     A conta é simples:

         vida = vidaBase + vidaPorLutador × (quantos estão em campo)

     Com os valores padrão, sozinho ele tem 6.600 de vida; com quatro pessoas,
     19.800; com oito, 37.400. (Isso ainda é multiplicado pelo nível de
     dificuldade, lá no fim do arquivo — no padrão "Tirano", por 0,55, o que dá
     3.630 sozinho.)

     É AQUI que você mexe se a luta está demorando demais ou de menos.
     ------------------------------------------------------------------------- */

  /** A vida que ele tem "de base", antes de contar a galera.
   *  AUMENTAR: a luta fica mais longa para todo mundo.
   *  DIMINUIR: mais curta.
   *  Faixa: 500 a 30000. Padrão: 2200. */
  vidaBase: Math.round(2200 * R.vida),

  /** Quanto de vida ele GANHA por pessoa em campo (contando os bots).
   *  AUMENTAR: partidas cheias ficam mais longas.
   *  DIMINUIR: partidas cheias ficam mais curtas; se puser 0, a vida dele não
   *  muda mais com o número de jogadores.
   *  Faixa: 0 a 20000. Padrão: 4400. */
  vidaPorLutador: Math.round(4400 * R.vida),

  /** **NÃO MEXA.** Teto de quantas pessoas a conta acima considera. Existe só
   *  para a vida não explodir se algo der errado na contagem. */
  lutadoresMax: 15,

  /* -------------------------------------------------------------------------
     O KI DELE (a energia que ele gasta para atirar)
     -------------------------------------------------------------------------

     Igual à sua barra azul, só que muito maior e que enche sozinha. Ele nunca
     para para carregar — é isso que faz o ki dele "demorar a gastar".
     ------------------------------------------------------------------------- */

  /** O tamanho da barra de energia dele (a sua tem 100).
   *  AUMENTAR: ele consegue soltar mais golpes seguidos sem parar.
   *  DIMINUIR: ele fica sem energia e passa mais tempo sem atacar.
   *  Faixa: 50 a 1000. Padrão: 300. */
  kiMax: 300,

  /** Quanto de energia ele recupera por segundo.
   *  AUMENTAR: ele quase nunca fica sem atacar.
   *  DIMINUIR (por exemplo para 8): ele passa longos períodos parado, sem
   *  poder atirar — é um jeito bem eficaz de deixar a luta mais fácil.
   *  Faixa: 0 a 100. Padrão: 34. */
  kiRegen: 34,

  /* -------------------------------------------------------------------------
     QUANTO OS *SEUS* PODERES TIRAM DELE
     -------------------------------------------------------------------------

     **Esta é a tabela mais útil do arquivo se você quer facilitar a luta.**
     Dobre todos estes números e a luta fica na metade do tempo.

     Os números são grandes porque a vida dele é grande: sua bolinha tira 6 de
     um jogador e 9 dele, mas ele tem milhares de pontos de vida.
     ------------------------------------------------------------------------- */

  /* (O nome interno desta tabela é `dano`. Outros pedaços do jogo leem ela por
     esse nome — inclusive o bônus do Super Saiyajin —, então o nome fica.) */
  dano: {
    /** A bolinha de ki (o tiro comum, botão esquerdo).
     *  Faixa: 1 a 200. Padrão: 9. */
    blast: 9,

    /** Kamehameha — este é POR SEGUNDO que o feixe fica em cima dele. O feixe
     *  dura 2,4 segundos, então acertar em cheio do começo ao fim vale 288.
     *  Faixa: 10 a 2000. Padrão: 120. */
    kamehameha: 120,

    /** Galick Gun (a esfera roxa). Faixa: 10 a 5000. Padrão: 280. */
    galick: 280,

    /** Kienzan (o disco). Faixa: 10 a 5000. Padrão: 190. */
    disk: 190,

    /** **GENKI DAMA — é de longe a que mais tira dele, e é assim de
     *  propósito.** Ela vale dez Galick Guns. Se você quiser um jeito rápido de
     *  vencer, aumente este número: com 8000, três acertos derrubam ele em
     *  quase qualquer situação.
     *  Faixa: 100 a 50000. Padrão: 2800. */
    genki: 2800,

    /** A onda de choque (tecla Q). Ela é defesa, então tira pouco.
     *  Faixa: 0 a 500. Padrão: 20. */
    burst: 20,

    /** Dano de queda. Ele voa, então nunca cai no chão: deixe em 0. */
    queda: 0,
  },

  /* -------------------------------------------------------------------------
     CONTRA QUEM ELE BRIGA
     -------------------------------------------------------------------------

     O Freeza troca de alvo de tempos em tempos, de propósito, para brigar com
     todo mundo em vez de perseguir uma pessoa só até matá-la.
     ------------------------------------------------------------------------- */

  alvo: {
    /** De quantos em quantos segundos ele escolhe um novo alvo.
     *  AUMENTAR: ele persegue a mesma pessoa por mais tempo (fica bem mais
     *  pesado para quem for escolhido).
     *  DIMINUIR: ele fica trocando toda hora e a pressão se espalha.
     *  Faixa: 1 a 20. Padrão: 3.4. */
    trocaEm: 3.4,

    /** O quanto ele "guarda rancor" de quem está machucando ele. Quanto maior,
     *  mais ele vai atrás de quem está causando mais dano.
     *  Faixa: 0 a 3. Padrão: 0.55. */
    pesoRaiva: 0.55,

    /** O quanto ele prefere atacar quem já está com pouca vida.
     *  AUMENTAR: ele é implacável com quem está quase morrendo.
     *  DIMINUIR (0 desliga): ele ignora a vida dos outros ao escolher.
     *  Faixa: 0 a 400. Padrão: 90. */
    pesoVida: 90,

    /** O quanto ele EVITA repetir a mesma pessoa quando reavalia. É isto que
     *  faz ele circular em vez de grudar em alguém.
     *  AUMENTAR: ele quase nunca repete o alvo.
     *  DIMINUIR (0 desliga): ele pode ficar na mesma pessoa para sempre.
     *  Faixa: 0 a 600. Padrão: 220. */
    penaRepetir: 220,

    /** Em quantos segundos o rancor dele pela metade. Faixa: 1 a 60. Padrão: 7. */
    raivaMeiaVida: 7,

    /** A que distância, em metros, ele ainda considera alguém como alvo. O mapa
     *  todo tem uns 900 m, então o padrão quer dizer "o mapa inteiro".
     *  DIMINUIR (por exemplo 150): ele só briga com quem está perto e ignora o
     *  resto — deixa a luta bem mais tranquila.
     *  Faixa: 50 a 900. Padrão: 900. */
    alcance: 900,
  },

  /* -------------------------------------------------------------------------
     COMO ELE VOA
     -------------------------------------------------------------------------

     Para comparar: você voa a 26 m/s no voo normal e a 64 m/s segurando o
     arranque (botão direito). Se ele voar mais rápido que 64, você nunca
     consegue alcançar nem fugir — por isso o padrão é mais baixo que isso.
     ------------------------------------------------------------------------- */

  voo: {
    /** Velocidade normal de voo dele, em metros por segundo. **42**, e eram 34:
     *  é a compensação do corpo três vezes maior (ver `ESCALA`, no topo).
     *  AUMENTAR: ele fica mais difícil de acompanhar e de acertar.
     *  DIMINUIR: fica fácil de perseguir.
     *  **Não passe de 46**: a Genki Dama voa a 46 m/s, e se ele for mais rápido
     *  que ela, ela nunca alcança ele. (No nível mais difícil, 42 × 1,05 = 44,1
     *  — ainda abaixo dela, e de propósito.)
     *  Faixa: 10 a 46. */
    velocidade: Math.round(42 * R.velocidade),

    /** A velocidade da INVESTIDA — quando ele resolve fechar a distância. **64**,
     *  e eram 58.
     *
     *  Este número tem DUAS travas agora, e as duas vêm de fora deste arquivo:
     *  • **Não passe de 64**, que é a sua velocidade de arranque: acima disso
     *    você não consegue mais escapar dele de jeito nenhum;
     *  • e ele não pode ficar MENOR do que 62,2, porque é ele que faz o Freeza
     *    continuar conseguindo desviar da rajada agora que ela persegue mais.
     *    A conta inteira está em `NAMEK.blast.homing.ganhoNoFreeza` — em uma
     *    linha: o boss escapa da bola de ki se `v ≥ 1,244 × 50 m`.
     *  Ou seja, 64 é praticamente o único valor que satisfaz as duas.
     *  Faixa: 15 a 64. */
    arranque: Math.round(64 * R.velocidade),

    /** O quanto ele muda de direção depressa. Alto = ele vira igual a um
     *  inseto; baixo = ele "derrapa" e fica previsível. Subiu de 7,5 para 9 com
     *  o tamanho: um corpo maior parece mais lento com a mesma aceleração,
     *  porque o olho compara o deslocamento com a silhueta.
     *  Faixa: 1 a 20. */
    aceleracao: 9,

    /** A que distância, em metros, ele gosta de ficar de você. **78**, e eram
     *  62 — ver a conta do ângulo em `ESCALA`: é a distância, e não o dano, que
     *  devolve a dificuldade de acertar um corpo três vezes maior.
     *  AUMENTAR: ele briga de longe.
     *  DIMINUIR: ele cola em você.
     *  Faixa: 15 a 200. */
    distanciaIdeal: 78,

    /** Se você chegar mais perto que isto (metros), ele recua. **40**, e eram
     *  26: com 6,7 m de altura, 26 m é encostado nele.
     *  Faixa: 5 a 60. */
    perto: 40,

    /** Quantos metros ALÉM da distância ideal ele aceita antes de sair em
     *  investida atrás de você.
     *  AUMENTAR: ele fica mais tempo longe, atirando de longe.
     *  DIMINUIR: ele vive em cima de você.
     *  Faixa: 3 a 120. Padrão: 14. */
    investirEm: 14,

    /** A altura mínima que ele mantém do chão, em metros. Ele voa e nunca
     *  aterrissa — **exceto derrubado**, que é o único caso em que este piso é
     *  ignorado (ver `queda`, mais abaixo). Faixa: 2 a 100. */
    alturaMin: 14,

    /** Quantos metros ACIMA do alvo ele fica. Positivo = ele briga de cima.
     *  Faixa: -50 a 120. Padrão: 22. */
    degrau: 22,

    /** A rapidez com que o corpo dele gira para encarar você.
     *  Faixa: 0.5 a 12. Padrão: 3.4. */
    giro: 3.4,
  },

  /* =========================================================================
     A CHEGADA — a cena de apresentação
     =========================================================================

     *"Quando o Freeza chega, ele deve chegar voando lá do início do céu até a
     terra. Quando ele aparece, a câmera deve dar um close nele, acompanhando ele
     com a câmera, fazendo um 360 por uns 5 segundos, para o player ver que
     realmente ele chegou. Então, todos os players veem a câmera com foco no
     Freeza e a câmera sai de foco dos players, como se fosse uma apresentação de
     um jogo. Nesse momento, a câmera está mostrando ele, ele dá risada duas
     vezes e é apresentado o nome Freeza. Após essa cena cinemática, a câmera
     volta ao normal do player."*

     ------------------------------------------------------- quem faz o quê

     A SALA decide (§8 do plano): ela põe o corpo lá em cima, faz a descida,
     mantém a invulnerabilidade e proíbe qualquer golpe enquanto a cena corre —
     e manda o `duracao` junto no `FREEZA_IN`. O CLIENTE só desenha: a lente
     orbitando (`src/namek/boss/cine.js`), o nome na tela e as duas risadas.

     É essa divisão que faz a cena acontecer JUNTO nas quinze telas sem uma
     mensagem a mais: todo mundo recebe o mesmo `FREEZA_IN`, com o mesmo
     carimbo, e a cena inteira é função dele.

     ------------------------------------------------------ e o jogador nisso

     Ele continua no controle do próprio corpo — o que sai de cena é a LENTE, e
     não o comando. Prendê-lo seria pior: quinze pessoas congeladas no ar durante
     seis segundos e meio, algumas delas caindo. O que garante que ninguém apanhe
     de graça nesse tempo é o boss estar invulnerável E mudo (ele não escolhe
     alvo nem solta golpe enquanto `descida + orbita` não termina). */
  chegada: {
    /** m — a que altura ele APARECE. É o "início do céu": bem acima do teto de
     *  voo do jogador (520 m), para a descida ser vista de baixo como uma coisa
     *  entrando na atmosfera. Faixa: 200 a 1200. */
    alto: 900,

    /** m — onde a descida TERMINA, medido do relevo. Daí em diante ele volta a
     *  voar normalmente (`voo.degrau` sobre o alvo). Faixa: 20 a 300. */
    baixo: 70,

    /** s — quanto dura a descida do céu até lá. 2,2 s para 830 m são 377 m/s:
     *  é uma entrada, não um voo — ele CAI sobre o planeta. Faixa: 0.5 a 8. */
    descida: 2.2,

    /** s — o giro de 360° com a câmera colada nele. É o "por uns 5 segundos"
     *  literal, e a cena inteira dura `descida + orbita`. Faixa: 0 a 15. */
    orbita: 5,

    /** m — a que distância a lente fica dele durante a órbita. Medida em
     *  ALTURAS DELE e não em metros absolutos, para a cena continuar enquadrada
     *  se alguém mexer na `ESCALA`: 2,6 alturas com 6,72 m dão 17,5 m. */
    lente: 2.6,

    /** s — quando cada uma das duas risadas sai, contado do começo da cena. A
     *  primeira no meio da descida (ele chega rindo), a segunda com o nome. */
    risadas: [1.5, 4.2],

    /** s — quando o nome aparece na tela, e por quanto tempo ele fica. */
    nome: 4,
    nomeDur: 3,
  },

  /* =========================================================================
     A MORTE — a outra cena
     =========================================================================

     *"Quando o Freeza é derrotado, a câmera vai para ele antes de ele sair de
     cena. Aparece ele com a cabeça erguida, com os braços esticados e as pernas
     esticadas. Ele começa a sair raios dele e luzes, e ele explode. A câmera,
     depois dessa explosão, passa alguns segundos para a explosão se dissipar e a
     câmera volta ao normal para os players."*

     Esta cena é INTEIRAMENTE do cliente, ao contrário da chegada, e a diferença
     não é de gosto: a morte já é uma mensagem (`NS2C.FREEZA_DOWN`, com o ponto e
     o carimbo), o corpo já não é mais simulado por ninguém depois dela, e a
     contagem do fim do planeta (`fim.contagem`, 60 s) começa no mesmo instante
     em todas as telas por conta do `aoMorrer` da sala. Não há nada a decidir —
     só a desenhar. */
  fim: {
    /** s — a pose aberta com os raios saindo, antes do estouro. */
    abertura: 2.4,
    /** s — o estouro e a poeira baixando, depois dele. */
    dissipar: 2.6,
    /** m — a distância da lente, em ALTURAS dele. Um pouco mais longe que a da
     *  chegada: o que se enquadra aqui é a explosão, não o corpo. */
    lente: 3.4,
    /** Quantos raios saem do corpo no auge. Faixa: 0 a 64. */
    raios: 18,
  },

  /* =========================================================================
     A GENKI DAMA O DEIXA LENTO
     =========================================================================

     *"Uma Genki Dama contra o Freeza: quando a Genki Dama é atirada, o Freeza
     anda mais lento. Ele não anda tão rápido, para dar chance da Genki Dama
     acertar ele. Mas tem chances da Genki Dama acertar ele, e também não é que
     acerta."*

     A última frase é a especificação: o golpe passa a ter chance, e não passa a
     ser garantido. A conta que decide isso é a de sempre — a Genki Dama voa a
     46 m/s e persegue a 40°/s, e o boss escapa dela enquanto `v > ω·d`. Com o
     fator abaixo:

         v do boss em fuga ... 64 × 0,5 = 32 m/s
         ω da Genki Dama ..... 0,698 rad/s
         ele escapa a ........ d < 32 / 0,698 = 45,8 m

     Ou seja: perto ele ainda sai da frente (e sair da frente de uma bola de
     41 m de diâmetro a 45 m é uma manobra apertada), longe ele não ganha mais a
     corrida angular — mas a bola tem só 75° de `arcMax` para gastar, então uma
     mudança de rumo dele no meio do voo ainda a faz passar de lado. É
     exatamente "tem chances, e não é que acerta".

     A lentidão começa quando a bola SAI da mão (depois do `windup` de 5,2 s) e
     não quando o gesto começa: o pedido diz "quando a Genki Dama é atirada", e
     antes disso não há nada no ar de que ele precise fugir devagar. */
  lentidao: {
    /** Fração da velocidade dele enquanto a bola está no ar. 0,5 = metade.
     *  Faixa: 0.2 a 1 (1 desliga). */
    fator: 0.5,
    /** s — quanto ela dura, contados da soltura. 12 s a 46 m/s são 552 m de voo
     *  da bola: mais que a arena inteira, ou seja, ela cobre o golpe todo sem
     *  precisar que a sala acompanhe o projétil. Faixa: 0 a 30. */
    duracao: 12,
  },

  /* =========================================================================
     A ONDA DE CHOQUE DERRUBA ELE
     =========================================================================

     *"Se esse flash pegar, além de afastar, o player é derrubado. Inclusive o
     Freeza pode ser derrubado se esse flash pegar. Derrubado é igual acontece
     quando o player leva cinco ataques consecutivos: ele cai no chão, abre a
     cratera e tudo mais."*

     É a única coisa do modo que derruba o boss, e ela desmente de propósito o
     "ele não é atordoável" do cabeçalho de `server/namek/freeza.js`. A
     justificativa de lá continua valendo para o que ela cobria — um boss que cai
     a cada cinco bolinhas não é um boss —, e é por isso que esta queda tem um
     gatilho único e caro: a onda custa 25 de ki, tem catorze metros de raio e
     exige estar COLADO nele, que é o lugar mais perigoso do mapa (`voo.perto`
     manda ele recuar de lá, e a onda dele mesmo empurra de volta).

     O que ela compra é a janela: enquanto ele está no chão, ele não escolhe
     alvo, não atira e não desvia. É o mesmo contrato do atordoamento entre
     jogadores — ver `NAMEK.fighter.stagger`. */
  queda: {
    /** s — quanto ele fica no chão depois de tocar o solo. Mais que os 2,4 s de
     *  um lutador porque chegar lá de 78 m já leva tempo, e o que se quer é a
     *  janela DEPOIS do baque. Faixa: 0.5 a 12. */
    tempo: 3.2,
    /** m/s — a velocidade com que ele despenca. Ele não tem gravidade (ele
     *  voa); esta é a queda inteira, escrita como um número. Faixa: 10 a 200. */
    velocidade: 62,
    /** s — carência até ele poder ser derrubado de novo. Sem ela, dois
     *  jogadores revezando ondas o manteriam no chão para sempre — é a mesma
     *  trava de `stagger.immune`. Faixa: 1 a 60. */
    carencia: 9,
    /** Potência da cratera que o corpo dele abre ao bater. Ver `craterFor`: 14
     *  dão 3,2 + 7,6·√14 = 31,6 m de boca, entre a do Galick Gun (26 m) e a da
     *  Death Ball dele (54 m). Faixa: 0 a 60. */
    cratera: 14,
  },

  /* -------------------------------------------------------------------------
     A RISADA
     ------------------------------------------------------------------------- */

  risada: {
    /** Segundos mínimos entre duas risadas. AUMENTAR: ele ri menos.
     *  Faixa: 1 a 60. Padrão: 6.5. */
    carencia: 6.5,
    /** Acima desta fração de vida (0,62 = 62 %) ele ri ao soltar a Death Ball.
     *  Faixa: 0 a 1. Padrão: 0.62. */
    folgado: 0.62,
    /** Chance de rir ao acertar um golpe grande (0,06 = 6 %).
     *  Faixa: 0 a 1. Padrão: 0.06. */
    golpeGrande: 0.06,
    /** Abaixo desta fração de vida ele para de rir e passa a grunhir.
     *  Faixa: 0 a 1. Padrão: 0.78. */
    aguentaAte: 0.78,
  },

  /* -------------------------------------------------------------------------
     O TELEPORTE
     -------------------------------------------------------------------------

     Ele some e reaparece atrás de quem está atacando. Só acontece quando ele
     está cercado — num duelo de um contra um ele NUNCA teleporta, porque isso
     tornaria impossível acertar qualquer coisa nele.
     ------------------------------------------------------------------------- */

  teleporte: {
    /** Quantos metros ele salta. Faixa: 5 a 200. Padrão: 46. */
    distancia: 46,
    /** Segundos de espera entre dois teleportes.
     *  AUMENTAR: ele quase não some. Ponha 999 para praticamente desligar.
     *  Faixa: 1 a 999. Padrão: 9. */
    recarga: 9,
    /** Quanto da vida dele precisa ser levada (0,055 = 5,5 %) para ele saltar.
     *  Faixa: 0.01 a 1. Padrão: 0.055. */
    gatilho: 0.055,
    /** Em quantos segundos esse dano é medido. Faixa: 0.5 a 10. Padrão: 2.2. */
    janela: 2.2,
    /** Quantas pessoas precisam estar em volta dele para o salto valer.
     *  DIMINUIR para 1: ele passa a sumir em duelo também (não recomendado —
     *  fica muito frustrante).
     *  AUMENTAR para 99: desliga o teleporte de vez.
     *  Faixa: 1 a 99. Padrão: 3. */
    atacantes: 3,
    /** Em que raio, em metros, essas pessoas são contadas.
     *  Faixa: 20 a 400. Padrão: 90. */
    raioCerco: 90,
  },

  /* -------------------------------------------------------------------------
     OS GOLPES GRANDES DELE
     ------------------------------------------------------------------------- */

  poderes: {
    /* ---------------------------------------------------------- DEATH BEAM
       O raio fino e rápido que sai do dedo. É o golpe que ele mais usa. */
    raioDaMorte: {
      /** O nome, só para aparecer nas mensagens. */
      nome: "Death Beam",

      /** Segundos que ele fica "carregando" antes de o raio sair. É o seu aviso
       *  para desviar ou defender.
       *  AUMENTAR: você tem mais tempo para reagir (deixa a luta mais fácil).
       *  Faixa: 0.05 a 3. Padrão: 0.34. */
      windup: 0.34,

      /** Quanto tempo o raio fica aceso, em segundos.
       *  Faixa: 0.1 a 3. Padrão: 0.42. */
      sustain: 0.42,

      /** **DANO POR SEGUNDO do raio.** O dano total de um raio é
       *  `dps × sustain` — com os padrões, 24 × 0,42 = **10 de dano**, e no
       *  nível padrão ("Tirano") isso vira 2,6. Você tem 100 de vida.
       *  AUMENTAR: ele mata muito mais rápido.
       *  DIMINUIR: é o jeito mais direto de parar de morrer tanto.
       *  Faixa: 5 a 300. Padrão: 24. */
      dps: Math.round(24 * R.dano),

      /** Segundos de espera entre um raio e o próximo.
       *  AUMENTAR: ele atira muito menos (bem mais fácil).
       *  Faixa: 0.3 a 30. Padrão: 3.2. */
      recarga: 3.2,

      /** Energia que cada raio custa a ele. Faixa: 0 a 300. Padrão: 15. */
      ki: 15,

      /** Alcance máximo, em metros. Faixa: 50 a 1800. Padrão: 900. */
      range: 900,

      /** Velocidade do raio, em m/s. É o golpe rápido dele.
       *  Faixa: 100 a 2000. Padrão: 620. */
      speed: 620,

      /** A grossura do raio, em metros — o quanto ele perdoa erro de mira DELE.
       *  DIMINUIR: ele erra mais.
       *  Faixa: 0.2 a 8. Padrão: 0.95. */
      hitRadius: 0.95,

      /** Tamanho da cratera que ele abre no chão. Faixa: 0 a 30. Padrão: 0.2. */
      power: 0.2,
      /** O quanto essa cratera é funda. Faixa: 0.25 a 6. Padrão: 3. */
      craterDeep: 3,
      /** Cor do raio. Faixa: qualquer cor. Padrão: 0xc21ad8 (magenta). */
      cor: 0xc21ad8,

      /* O quanto o raio CURVA atrás de você. Mexer aqui é opcional.
         `turnRate` = graus por segundo que ele vira (maior = persegue mais).
         `arcMax` = quanto ele pode virar no total, em graus.
         `duration` = por quantos segundos ele persegue.
         `cone` = o quanto pode estar fora de mira e ainda corrigir.
         `acquire` = de que distância ele escolhe o alvo, em metros. */
      homing: { turnRate: 40, arcMax: 14, duration: 0.35, cone: 24, acquire: 900 },
    },

    /* ---------------------------------------------------------- DEATH BALL
       A esfera gigante que ele levanta acima da cabeça. Ela pega todo mundo
       que estiver perto, não só o alvo. */
    esferaDaMorte: {
      nome: "Death Ball",

      /** Segundos carregando a esfera antes de jogá-la. É bastante tempo de
       *  propósito: é a sua janela para sair de perto.
       *  AUMENTAR: mais tempo para fugir.
       *  Faixa: 0.5 a 10. Padrão: 3.2. */
      windup: 3.2,

      /** **DANO da esfera, de uma vez só.** Você tem 100 de vida, então com o
       *  padrão de 35 ela tira um terço — ela NÃO mata de um golpe quem está
       *  com a vida cheia, e isso é de propósito.
       *  **Cuidado:** pondo 100 ou mais, ela volta a matar instantaneamente.
       *  Faixa: 5 a 300. Padrão: 35. */
      damage: Math.round(35 * R.dano),

      /** Segundos de espera até a próxima esfera.
       *  AUMENTAR: ela quase não aparece.
       *  Faixa: 3 a 120. Padrão: 22. */
      recarga: 22,

      /** Energia que ela custa a ele. Faixa: 0 a 300. Padrão: 96. */
      ki: 96,

      /** O RAIO DA EXPLOSÃO, em metros. É enorme — quem estiver dentro dessa
       *  bola toda leva o dano.
       *  DIMINUIR: fica muito mais fácil de escapar.
       *  Faixa: 3 a 40. Padrão: 19. */
      hitRadius: 19,

      /** Velocidade da esfera, em m/s. Ela é lenta de propósito, para dar tempo
       *  de correr. Faixa: 5 a 120. Padrão: 30. */
      speed: 30,

      /** Alcance, em metros. Faixa: 50 a 1800. Padrão: 900. */
      range: 900,
      /** Quantos segundos ela fica voando antes de sumir sozinha.
       *  Faixa: 3 a 60. Padrão: 22. */
      sustain: 22,
      /** Tamanho da cratera. É o maior buraco do jogo. Faixa: 0 a 60. Padrão: 46. */
      power: 46,
      /** Cor da esfera. Padrão: 0x7a0fc4 (roxo escuro). */
      cor: 0x7a0fc4,
      /* O quanto ela persegue. Ver a explicação no Death Beam, acima. */
      homing: { turnRate: 16, arcMax: 44, duration: 5.5, cone: 44, acquire: 800 },
    },
  },

  /* -------------------------------------------------------------------------
     A RAJADA (o tiro comum dele)
     -------------------------------------------------------------------------

     Ele dispara um punhado de bolinhas escuras, respira, e dispara outro.
     ------------------------------------------------------------------------- */

  rajada: {
    /** Quantas bolinhas por segundo, dentro de um punhado.
     *  Faixa: 1 a 20. Padrão: 9. */
    cadencia: 9,

    /** Quantas bolinhas tem cada punhado.
     *  AUMENTAR: cada rajada dói muito mais.
     *  Faixa: 1 a 15. Padrão: 3. */
    porSurto: 3,

    /** Segundos de descanso entre um punhado e o próximo.
     *  AUMENTAR: é o jeito mais simples de aliviar a pressão constante dele.
     *  Faixa: 0.2 a 15. Padrão: 2.4. */
    pausa: 2.4,

    /** **DANO de cada bolinha.** Você tem 100 de vida; a sua bolinha tira 6.
     *  Faixa: 1 a 60. Padrão: 3. */
    dano: Math.round(3 * R.dano),

    /** A que distância, em metros, ele começa a metralhar.
     *  DIMINUIR: ele só metralha de perto.
     *  Faixa: 20 a 600. Padrão: 220. */
    alcance: 220,

    /** O erro de mira dele, em graus. **AUMENTAR faz ele errar mais** — é uma
     *  das formas mais naturais de deixar a luta fácil sem deixar o boss
     *  bobo. Com 15 ele acerta bem pouco.
     *  Faixa: 0 a 40. Padrão: 3.2. */
    erro: 3.2,

    /** Energia por bolinha. Faixa: 0 a 50. Padrão: 1.1. */
    ki: 1.1,

    /** Quantos segundos cada bolinha vive. Faixa: 1 a 20. Padrão: 6. */
    vida: 6,
    /** Tamanho da cratera de cada bolinha. Faixa: 0 a 5. Padrão: 0.02. */
    power: 0.02,

    /** **NÃO MEXA** nestes dois. A velocidade e o tamanho das bolinhas dele são
     *  desenhados pelo mesmo sistema que desenha as suas, e esse sistema lê os
     *  números da SUA bolinha. Se você mudar aqui, o dano acontece num lugar e o
     *  desenho em outro — você leva dano de uma bola que ainda está longe. */
    velocidade: 78,
    raio: 1.5,

    /* O quanto as bolinhas perseguem. Ver a explicação no Death Beam. */
    homing: { turnRate: 34, duration: 0.8, cone: 24, acquire: 220 },
  },

  /* -------------------------------------------------------------------------
     A ONDA DE EMPURRÃO
     -------------------------------------------------------------------------

     Quando alguém cola nele, ele solta um empurrão em volta.
     ------------------------------------------------------------------------- */

  onda: {
    /** **NÃO MEXA.** O raio da onda, em metros. Ele é desenhado pelo mesmo
     *  sistema da sua onda de choque, que usa um número fixo — mudar aqui faz o
     *  dano e o desenho discordarem. */
    raio: 14,

    /** A força do empurrão. AUMENTAR: você é arremessado para longe.
     *  Faixa: 0 a 200. Padrão: 54. */
    empurrao: Math.round(54),

    /** Dano de quem está no meio da onda. Faixa: 0 a 100. Padrão: 12. */
    dano: Math.round(12 * R.dano),

    /** Energia que custa a ele. Faixa: 0 a 300. Padrão: 40. */
    ki: 40,

    /** Segundos entre uma onda e a próxima. AUMENTAR: quase não acontece.
     *  Faixa: 1 a 60. Padrão: 7.5. */
    recarga: 7.5,

    /** Quantas pessoas precisam estar perto para ele soltar.
     *  Faixa: 1 a 15. Padrão: 1. */
    gatilho: 1,
  },

  /* =========================================================================
     OS TRÊS NÍVEIS DE DIFICULDADE
     =========================================================================

     Os números acima são o nível "Imperador" (o do meio). Os outros dois são
     MULTIPLICADORES em cima deles: 0.5 quer dizer metade, 2 quer dizer o dobro,
     1 quer dizer igual.

     Quem escolhe o nível é quem chama o boss para a partida. Sem escolha, vale
     o `dificuldadePadrao` logo abaixo.

     O que cada coluna faz:

       vida           multiplica a vida dele (luta mais longa ou mais curta)
       dano           multiplica TUDO que ele tira de você
       cadencia       multiplica a frequência dos golpes dele
                      (número MAIOR = ele atira MAIS vezes)
       agressividade  o quanto ele parte para cima em vez de ficar rodeando
       mover          multiplica a velocidade de voo dele
       erro           multiplica o erro de mira dele
                      (número MAIOR = ele ERRA MAIS = mais fácil para você)
     ========================================================================= */

  /** O nível que vale quando ninguém escolheu. Escreva "tirano", "imperador"
   *  ou "absoluto". Padrão: "tirano" (o mais fácil). */
  dificuldadePadrao: "tirano",

  /** A ordem em que os níveis aparecem no menu. Do mais fácil ao mais difícil. */
  dificuldadeOrdem: ["tirano", "imperador", "absoluto"],

  dificuldades: {
    /* O MAIS FÁCIL, e é o padrão. Feito para quem está conhecendo o chefe:
       menos da metade do dano, atira bem menos vezes, erra três vezes mais. */
    tirano: {
      nome: "Tirano",
      vida: 0.55,
      dano: 0.26,
      cadencia: 0.5,
      agressividade: 0.4,
      /* 0,98 e não 0,72. **Este número deixou de ser de dificuldade e passou a
         ser de física.** Ele multiplica `voo.arranque`, e é o arranque que
         decide se o boss consegue desviar da rajada agora que ela persegue
         15 % mais contra ele: 64 × 0,98 = 62,7 m/s, contra os 62,2 exigidos (a
         conta está em `NAMEK.blast.homing.ganhoNoFreeza`). A 0,72 ele ficaria
         com 46 m/s e a bola de ki nunca mais erraria o chefe — o nível "fácil"
         viraria, sem que ninguém notasse, o nível em que ele não tem resposta.
         O que continua fazendo deste o nível fácil são as outras cinco colunas:
         metade da vida, um quarto do dano, metade dos golpes e o triplo do erro
         de mira. */
      mover: 0.98,
      erro: 3,
    },

    /* O DO MEIO: exatamente os números escritos lá em cima, sem multiplicar. */
    imperador: {
      nome: "Imperador",
      vida: 1,
      dano: 1,
      cadencia: 1,
      agressividade: 1,
      mover: 1,
      erro: 1,
    },

    /* O MAIS DIFÍCIL. Quase o dobro de vida, mais dano, mais rápido, e ele
       quase não erra. */
    absoluto: {
      nome: "Imperador do Mal",
      vida: 1.6,
      dano: 1.35,
      cadencia: 1.35,
      agressividade: 1.3,
      /* 1,05 e não 1,12: com `voo.arranque` em 64, este multiplicador é o que
         decide se o boss passa da velocidade de arranque do JOGADOR (64 m/s), e
         passar dela é a única forma de tornar impossível fugir dele. 1,05 dá
         67 m/s — acima do jogador, sim, mas por 5 %, o que é a diferença entre
         "ele alcança quem foge em linha reta" e "ninguém escapa nunca". A 1,12
         seriam 72 m/s, e aí a fuga deixaria de existir como opção. */
      mover: 1.05,
      erro: 0.55,
    },
  },
};

/* ===========================================================================
   PARA CURIOSOS: quanto a luta dura hoje
   ===========================================================================

   Tudo abaixo foi MEDIDO, não estimado: um jogador de mentira entra numa
   partida de verdade, voa atrás do Freeza, atira, erra, morre e volta. Ele erra
   a mira em 12 graus, demora 0,3 s para reagir e passa um terço do tempo
   desviando em vez de atirando — ou seja, uma pessoa comum, não um robô.

   Quanto tempo leva para derrubar ele, e quantas vezes você morre no caminho:

       sozinho, TIRANO (o padrão) .....  83 s ....... 1 morte
       sozinho, IMPERADOR ............. 127 s ....... 5 mortes
       sozinho, ABSOLUTO .............. 169 s ....... 9 mortes

       em quatro, TIRANO ..............  53 s ....... 0 mortes
       em quatro, IMPERADOR ........... 122 s ...... 10 mortes (2 ou 3 por pessoa)
       em oito,   TIRANO ..............  56 s ....... 0 mortes
       em oito,   IMPERADOR ........... 101 s ...... 12 mortes (1 ou 2 por pessoa)

   Quantos golpes seus derrubam ele quando você está sozinho:

       golpe               TIRANO      IMPERADOR    ABSOLUTO
       bolinha de ki .....  404 .........  734 ....... 1 174
       Kamehameha ........   13 ..........  23 .......... 37
       Galick Gun ........   13 ..........  24 .......... 38
       Kienzan ...........   20 ..........  35 .......... 56
       GENKI DAMA ........    2 ...........  3 ........... 4

   A vida dele no nível padrão: 3.630 sozinho, 10.890 em quatro, 20.570 em oito.

   ------------------------------------------------------------ receitas de bolso

   Quer parar de morrer?           receita "facil" lá no topo.
   Quer um boneco de pancada?      receita "facilimo" (uma Genki Dama e acabou).
   Quer sofrer?                    receita "brutal" (148 s e 4 mortes sozinho).
   Quer a luta na metade do tempo? divida `vidaBase` e `vidaPorLutador` por 2.
   Quer só levar menos dano?       diminua `dano` do nível "tirano", lá embaixo.
   =========================================================================== */
