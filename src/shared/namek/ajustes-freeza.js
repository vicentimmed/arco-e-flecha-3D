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

  /** Altura do corpo, em metros (um jogador tem 1,78 m).
   *  AUMENTAR: ele fica maior e mais fácil de acertar.
   *  DIMINUIR: fica menor e mais difícil de acertar.
   *  Faixa que faz sentido: 1.6 a 4. Padrão: 2.24. */
  altura: 2.24,

  /** A "grossura" do corpo para efeito de acerto, em metros — o quanto os seus
   *  tiros perdoam de erro de mira.
   *  AUMENTAR: fica muito mais fácil de acertar (é o jeito mais direto de
   *  facilitar a luta sem mexer em dano nenhum).
   *  DIMINUIR: fica mais difícil.
   *  **Cuidado:** tem de ser sempre MENOR que a metade da `altura` acima. Com
   *  a altura em 2.24, não passe de 1.12, senão a área de acerto embaralha.
   *  Faixa: 0.6 a 1.12. Padrão: 1.1. */
  raio: 1.1,

  /** A que altura do corpo dele os golpes são marcados, em metros do pé para
   *  cima. Serve para a mira apontar para o peito e não para os pés.
   *  Faixa: 0.8 a 1.8. Padrão: 1.36. */
  peito: 1.36,

  /** Comprimento da cauda, em metros. É só enfeite: ela não machuca ninguém.
   *  Faixa: 0 a 5. Padrão: 2.6. */
  cauda: 2.6,

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
    /** Velocidade normal de voo dele, em metros por segundo.
     *  AUMENTAR: ele fica mais difícil de acompanhar e de acertar.
     *  DIMINUIR: fica fácil de perseguir.
     *  **Não passe de 46**: a Genki Dama voa a 46 m/s, e se ele for mais rápido
     *  que ela, ela nunca alcança ele.
     *  Faixa: 10 a 46. Padrão: 34. */
    velocidade: Math.round(34 * R.velocidade),

    /** A velocidade da INVESTIDA — quando ele resolve fechar a distância.
     *  **Não passe de 64**, que é a sua velocidade de arranque: acima disso
     *  você não consegue mais escapar dele de jeito nenhum.
     *  Faixa: 15 a 64. Padrão: 58. */
    arranque: Math.round(58 * R.velocidade),

    /** O quanto ele muda de direção depressa. Alto = ele vira igual a um
     *  inseto; baixo = ele "derrapa" e fica previsível.
     *  Faixa: 1 a 20. Padrão: 7.5. */
    aceleracao: 7.5,

    /** A que distância, em metros, ele gosta de ficar de você.
     *  AUMENTAR: ele briga de longe.
     *  DIMINUIR: ele cola em você.
     *  Faixa: 15 a 200. Padrão: 62. */
    distanciaIdeal: 62,

    /** Se você chegar mais perto que isto (metros), ele recua.
     *  Faixa: 5 a 60. Padrão: 26. */
    perto: 26,

    /** Quantos metros ALÉM da distância ideal ele aceita antes de sair em
     *  investida atrás de você.
     *  AUMENTAR: ele fica mais tempo longe, atirando de longe.
     *  DIMINUIR: ele vive em cima de você.
     *  Faixa: 3 a 120. Padrão: 14. */
    investirEm: 14,

    /** A altura mínima que ele mantém do chão, em metros. Ele voa e nunca
     *  aterrissa. Faixa: 2 a 100. Padrão: 14. */
    alturaMin: 14,

    /** Quantos metros ACIMA do alvo ele fica. Positivo = ele briga de cima.
     *  Faixa: -50 a 120. Padrão: 22. */
    degrau: 22,

    /** A rapidez com que o corpo dele gira para encarar você.
     *  Faixa: 0.5 a 12. Padrão: 3.4. */
    giro: 3.4,
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
      mover: 0.72,
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
      mover: 1.12,
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
