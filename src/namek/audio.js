/* ---------------------------------------------------------------------------
   O som de Namekusei — sintetizado, com UMA exceção: a trilha de fundo
   (`aurora_de_combate.mp3`, ver `NamekAudio.constructor`). Música é composição,
   não energia — não existe receita de ruído filtrado que substitua uma
   melodia de verdade, e é por isso que o arqueiro também usa mp3 para a dele
   (`systems/audio.js`). Todo o resto — bola de ki, feixe, carga, explosão,
   trovão — continua síntese pura, pelo motivo abaixo.

   ------------------------------------------------------------ por que síntese

   O jogo do arqueiro é híbrido: mp3 para o que é ORGÂNICO (o berro do alce, o
   uivo do lobo, os passarinhos, a trilha) e Web Audio para o que é MECÂNICO (o
   estalo da corda, o impacto, o rugido do jetpack). A divisão é boa, e ela
   responde sozinha o que fazer aqui: **em Namekusei não existe nada orgânico.**

   O que este modo precisa fazer soar é energia — bola de ki, feixe, carga,
   explosão, trovão. Esses são justamente os sons que a síntese faz MELHOR do
   que uma gravação, porque não existe gravação de um Kamehameha: o som que a
   referência usa também foi construído, de ruído filtrado e varredura de
   frequência. Sintetizar aqui não é economia — é o caminho certo, e de quebra
   custa zero byte de download num modo cujo pedido principal era ser leve.

   ----------------------------------------------------------------- a receita

   Quase tudo aqui sai de três ingredientes combinados:

   • **Ruído filtrado** dá o CORPO. Ruído branco puro é chiado de rádio; passado
     por um passa-baixa que se move, vira sopro, rugido ou trovão conforme a
     velocidade com que a frequência de corte anda.
   • **Varredura de frequência** dá a INTENÇÃO. Descendo, o som "sai" (tiro,
     lançamento); subindo, ele "carrega" (a pose antes do golpe). É a diferença
     entre disparar e se preparar, e o ouvido a lê antes dos olhos.
   • **Envelope exponencial** dá o PESO. Ataque instantâneo e cauda longa é
     explosão; ataque lento e platô é sustentação.

   ----------------------------------------------------------- o que NÃO fazer

   Um som por acontecimento é o caminho da cacofonia. Com quinze lutadores
   soltando seis bolas por segundo cada, um `play()` por bola são NOVENTA vozes
   por segundo — e o resultado não é "intenso", é uma serra elétrica em que
   nenhum evento é audível. Por isso:

   • as vozes são um POOL de tamanho fixo, e o que não cabe simplesmente não
     toca (ver `tocar`);
   • a rajada tem cota por lutador (`_ultimoTiro`), então a bola do vizinho a
     oitenta metros não rouba a voz da sua;
   • os sons grandes têm PRIORIDADE e não podem ser roubados por um tiro que
     chegou depois (ver `_voz`);
   • o alcance é a régua da CLASSE do som, e não uma só para todos (ver
     `PERFIS`): o tiro morre perto, a bomba atravessa a arena.

   E o que não existe, de propósito: **nenhum projétil tem som de voo.** É
   tentador — uma esfera roxa cruzando o vale pedindo um assobio —, e é
   exatamente o erro que o parágrafo acima descreve, só que pior, porque um som
   de voo não é um evento: é um LOOP que dura o quanto o projétil viver. O
   Galick Gun voa até 15 s e o Kienzan até 18; cinco esferas e seis discos no ar
   ao mesmo tempo são onze loops contínuos que, somados, não são onze objetos
   voando — são um chiado só, que come o pool inteiro e mascara justamente as
   explosões que este arquivo acabou de subir. O que cada golpe ganhou no lugar
   foi um DISPARO com timbre próprio (`arremessoDeEsfera`, `zunidoDeDisco`), que
   diz de onde ele saiu e o que ele é, e cala em seguida.

   A exceção é o feixe, e ela se explica sozinha: um Kamehameha não voa, ele
   FICA — é um tubo apoiado, e a coisa que fica é justamente a que precisa de um
   som contínuo (ver `feixeVoando` e o `loop("feixe")`).

   ------------------------------------------------------- as três misturas

   Nem todo som deste modo vive no mesmo lugar, e confundir os três é a causa de
   quase todo "não estou ouvindo isso":

   1. **No mundo** (`tocar`). Posicional, atenuado por distância, disputando o
      pool com noventa outros eventos. É onde mora o tiro dos outros, o acerto
      nos outros, a explosão lá longe. Um som aqui é informação sobre ONDE.

   2. **Na cabeça** (`tocarNaCabeca`). Sem posição e sem atenuação, porque não
      acontece no mundo: acontece em VOCÊ. O ki encher, o alvo travar — e,
      principalmente, **você apanhar**. Quem leva o golpe está a zero metro de
      si mesmo; tocar a própria dor num ponto do espaço, atenuada, e ainda por
      cima disputando voz com a metralhadora alheia, é a receita exata para o
      jogador não ouvir que está morrendo. Um som aqui é informação sobre VOCÊ.

   3. **Solene** (`tocarSolene`). Posicional, mas com voz RESERVADA e alcance de
      arena inteira. São os dois ou três acontecimentos por partida que a arena
      toda tem direito de saber: a Genki Dama sendo juntada, a Genki Dama
      detonando. Um som aqui é informação sobre A PARTIDA, e ele não pode ser
      roubado por uma bola de ki qualquer que chegou depois.

   ------------------------------------------------------ e a régua da distância

   As três misturas dizem POR ONDE o som sai. Falta a outra pergunta, que é a
   que estava respondida errado: **de quantos metros ele ainda se ouve.** Todas
   as vozes posicionais dividiam uma curva só — referência de 9 m —, e com ela
   uma bomba a sessenta metros (a distância normal de briga deste modo) saía
   dezenove decibéis abaixo do nominal. Era essa a explicação do *"o som de
   explosão quando os poderes pegam no adversário ou na terra está muito
   baixo"*: não era o volume, era o alcance. Ver `PERFIS`, onde as quatro
   réguas de hoje estão com a conta de cada uma.

   ------------------------------------------------------------------ o teto

   E, no fim de tudo, um limitador (`_montarTeto`). Ele é a licença para os
   números deste arquivo passarem de 1 sem que a soma de três explosões rasgue
   a saída da placa — e, de brinde, é ele que faz a trilha ceder por um quarto
   de segundo toda vez que uma bomba entra. Um som só fica grande em relação ao
   que ele cala.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../shared/namek/config.js";
import trilhaUrl from "../assets/audio/aurora_de_combate.mp3";

/* Vozes simultâneas do pool geral.
 *
 * Eram 14. Subiu para 16 porque o banco cresceu de tamanho E de duração: o
 * feixe alheio agora sustenta 2,7 s numa voz (`feixeVoando`) e a queimadura
 * ocupa mais meio segundo — dois eventos longos que antes não existiam. Duas
 * vozes a mais cobrem isso sem inflar a soma, porque quem defende a mistura de
 * estourar não é o número de vozes, é o teto (`_montarTeto`). */
const VOZES = 16;

/* O `ALCANCE` único de 240 m saiu daqui. Ele era usado em dois lugares — o
   corte que decide se a voz chega a ser criada e o `maxDistance` do panner — e
   os dois passaram a ser por CLASSE de som, logo abaixo. Um alcance só para
   tiro e bomba era metade do problema que este arquivo acabou de consertar. */

/* --------------------------------------------------- o alcance por CLASSE --
 *
 * **Este bloco é a resposta ao "as explosões estão muito baixas".**
 *
 * Todas as vozes do pool tinham a MESMA curva de distância: referência de 9 m,
 * queda 1,4, modelo inverso. A conta que isso produz, e ela é o problema
 * inteiro:
 *
 *     ganho = ref / (ref + queda · (d − ref))
 *     a 60 m  →  9 / (9 + 1,4 · 51) = 0,112   (−19 dB)
 *     a 100 m →  9 / (9 + 1,4 · 91) = 0,066   (−23,6 dB)
 *
 * Sessenta metros é a distância de briga deste modo — é onde o adversário está
 * quando você acerta ele, e é onde a sua bola bate no chão. Ou seja: TODA
 * explosão que o jogador reclamou de não ouvir estava saindo vinte decibéis
 * abaixo do nominal, tocada por cima de uma trilha que não é atenuada por nada.
 * A explosão não estava baixa no código; ela estava sendo apagada pela
 * distância, com a régua de um som que só devia valer a três metros.
 *
 * A régua certa não é uma: é uma por CLASSE de som, porque "de que distância
 * isto deve ser audível" é uma pergunta diferente para um tiro e para uma bomba.
 * Quatro classes, com a conta de cada uma escrita ao lado:
 *
 * • `corpo`  — o tiro, o acerto no corpo, a guarda. É a briga corpo a corpo, e
 *   ela É local: o pedido diz explicitamente que a rajada NÃO tem de ser ouvida
 *   de longe. A referência subiu de 9 para 12 m só para o próprio jogador (a
 *   câmera está ~7 m atrás do peito) não entrar já atenuado.
 *   a 60 m → 12/(12+1,4·48) = 0,152; a 200 m → 0,043 (some, como deve).
 *
 * • `estalo` — o impacto da rajada no chão e o baque de um corpo caindo.
 *   Precisa atravessar a distância de briga e morrer logo depois: o estalo é o
 *   som mais repetido do jogo (6/s por lutador) e um estalo audível de 300 m
 *   viraria um chiado de fundo permanente.
 *   a 60 m → 22/(22+1,2·38) = 0,325 (+6,6 dB sobre a régua antiga); a 200 m → 0,09.
 *
 * • `medio`  — o talho do Kienzan, a onda de ki, a morte. Acontecimentos que
 *   valem uma cabeçada de quem está do outro lado do vale, mas não a arena.
 *   a 60 m → 40/(40+0,95·20) = 0,678; a 300 m → 0,133.
 *
 * • `grande` — o Kamehameha, o Galick Gun, o trovão, a cratera pesada. É a
 *   metade do pedido que diz *"a explosão de um poder GRANDE tem de ser audível
 *   de longe"*: dentro de 95 m ela sai INTEIRA (o modelo inverso devolve 1 até a
 *   referência), e depois cai devagar.
 *   a 60 m → 1,0 (contra 0,112 de antes: **+19 dB**); a 300 m → 0,42;
 *   a 900 m (o raio da arena) → 0,16, que é pouco e é audível.
 *
 * A quinta curva, a dos sons SOLENES, continua onde estava (`_vozSolene`): ela
 * é ainda mais aberta e vive fora do pool. */
const PERFIS = {
  corpo: { ref: 12, queda: 1.4, max: 240 },
  estalo: { ref: 22, queda: 1.2, max: 320 },
  medio: { ref: 40, queda: 0.95, max: 560 },
  grande: { ref: 95, queda: 0.62, max: 980 },
};

/* -------------------------------------------------------- o teto da mistura -
 *
 * O grafo NÃO tinha teto nenhum: cada voz era um `GainNode` do Three ligado
 * direto no ganho do listener, que ia direto no `destination`. Enquanto o som
 * mais alto do modo saía com ganho 1 sobre um buffer normalizado a pico 1, isso
 * funcionava por sorte — a soma raramente passava de 0 dBFS porque quase tudo
 * chegava atenuado pela distância.
 *
 * Subir explosão de 0,62 para 1,20 e ainda por cima fazer ela chegar SEM
 * atenuação a 60 m (ver `PERFIS`) acaba com essa sorte: três estouros no mesmo
 * quadro somariam +10 dBFS, e o que o `destination` faz com isso é ceifar a
 * onda no topo — distorção suja, do tipo que soa como alto-falante rasgado e
 * não como explosão.
 *
 * Por isso a cadeia agora é
 *
 *     vozes → listener.gain → COMPRESSOR → ganho mestre → destination
 *
 * e os números:
 *
 * • limiar −6 dBFS e razão 10:1 — isto é um LIMITADOR, não um compressor de
 *   mixagem. Abaixo de −6 dBFS nada acontece (a briga normal passa intacta e
 *   guarda a dinâmica); acima, o excesso é dividido por dez. Uma entrada de
 *   +14 dBFS (quatro explosões grandes empilhadas, o pior caso honesto) sai a
 *   −4 dBFS. **Não existe entrada plausível que faça a saída passar de 0.**
 * • joelho de 6 dB — a transição para o regime limitado é suave, senão o
 *   instante em que a mistura cruza o limiar vira um degrau audível.
 * • ataque de 1,5 ms — a única defesa contra o ÚNICO jeito de isto ainda
 *   estourar. Nenhum limitador segura o que passa antes de ele reagir, e o
 *   ataque das explosões deste banco é de 2 a 3 ms (ver `explosao` e
 *   `detonacaoColossal`): com 1,5 ms o compressor já está agarrado antes de o
 *   transiente chegar ao topo, e o que escapa é o primeiro milissegundo de uma
 *   rampa — fração de decibel, não um ceifamento.
 * • soltura de 220 ms — mais curta pumpava a cada estalo da rajada; mais longa
 *   deixava a mistura abafada por meio segundo depois de cada bomba.
 * • ganho mestre 1,4 (+2,9 dB) DEPOIS do compressor — é a recuperação. Sem
 *   ela, limitar a 6 dB de excesso deixaria a mistura inteira mais baixa do que
 *   estava, que é o oposto do pedido. Com ela, tudo o que passa longe do teto
 *   (a trilha, o aviso de ki, o tiro distante) ganha 2,9 dB de graça.
 *
 * ---------------------------------------------- e a conta do pior caso, feita
 *
 * O pedido foi explícito em querer saber como isto não satura com várias
 * explosões juntas, então a conta está aqui e ela é fechada. Somando os quatro
 * eventos mais altos que o modo consegue pôr no mesmo quadro — Genki Dama a
 * 1,9, cratera de Kamehameha a 1,7, Galick Gun a 1,7 e a dor própria a 1,6 —
 * dá 6,9 de pico, ou +16,8 dBFS na entrada do limitador. Saída:
 *
 *     −6 + (16,8 + 6) / 10 = −3,7 dBFS  →  × 1,4  =  −0,8 dBFS
 *
 * E isso é o pior caso IMPOSSÍVEL, que supõe as quatro formas de onda batendo o
 * pico na mesma amostra. O caso plausível — duas bombas grandes juntas, +11 dBFS
 * de entrada — sai a −1,4 dBFS. **Não existe combinação de eventos deste jogo
 * que faça a saída passar de zero.** O que existe é redução de ganho: quanto
 * mais coisa explode ao mesmo tempo, mais a mistura inteira cede — de graça, e
 * é assim que uma barragem de explosões deve soar.
 *
 * ------------------------------------------------------- e a trilha DUCKA
 *
 * A música passa pelo mesmo compressor de propósito. Quando uma explosão
 * grande entra, ela empurra a trilha para baixo por 220 ms e volta — o
 * "ducking" clássico, e ele é metade da razão de a explosão PARECER alta. Um
 * som só fica grande em relação ao que ele cala.
 *
 * O preço é que a trilha também recebe os +2,9 dB do ganho mestre, e o volume
 * dela foi calibrado por pedido do usuário. Por isso `VOLUME_TRILHA` desceu de
 * 0,34 para 0,25: 0,25 × 1,4 = 0,35 na saída, ou seja **a mesma trilha de
 * antes**. O número mudou porque o barramento mudou, não porque a mistura
 * mudou. */
const TETO_LIMIAR = -6;
const TETO_RAZAO = 10;
const TETO_JOELHO = 6;
const TETO_ATAQUE = 0.0015;
const TETO_SOLTURA = 0.22;
const GANHO_MESTRE = 1.4;

/* Vozes RESERVADAS, fora do pool geral. Três porque os sons solenes são longos
   (a carga da Genki Dama tem 3,8 s, a detonação tem 6,5 s) e não podem ser
   roubados: duas Genki Damas simultâneas mais a detonação de uma terceira é o
   pior caso plausível numa sala de quinze, e além disso o quarto pedido perde a
   vez — o que é infinitamente melhor do que o pool geral, onde um som de 6,5 s
   seria cortado pela primeira bola de ki que chegasse. */
const VOZES_SOLENES = 3;
/* m — a arena tem 900 m de raio (`NAMEK.world.radius`). Uma Genki Dama sendo
   juntada é o aviso de que alguém fez a aposta mais cara do jogo, e esse aviso
   é para TODO MUNDO: o alcance dela é o diâmetro da arena com folga, e a queda
   por distância é muito mais lenta que a dos sons comuns (ver `_vozSolene`). */
const ALCANCE_SOLENE = 1400;

/* A ÚNICA exceção à síntese (ver o comentário do topo do arquivo): uma trilha
   de fundo é música, não energia, e não existe receita de ruído filtrado que
   substitua uma composição de verdade.
   ---------------------------------------------------------------- o volume

   Eram 0,1, herdados do `MUSIC_VOLUME_DAY` do arqueiro, e o argumento de lá
   ("a trilha não pode encobrir a rajada e o acerto") estava certo sobre a
   PRIORIDADE e errado sobre o NÚMERO. Os efeitos deste modo são sintetizados
   e normalizados a pico (`normalizar`, logo abaixo): eles saem muito mais
   altos que uma faixa mixada para escuta, e um décimo do ganho contra isso não
   é "discreto" — é inaudível. O relato foi literal: *"Aumente o volume da
   música. Está muito baixo."*

   0,34 põe a trilha na faixa em que ela se ouve por baixo do tiroteio sem
   disputar com ele: um estouro no chão (pico 1,0, e o mais alto do modo)
   continua três vezes acima dela, e o silêncio entre duas trocas de tiro
   deixou de ser silêncio.

   -------------------------------------- por que o número virou 0,24 sem mudar

   0,25 e não 0,34 porque o barramento passou a ter um ganho mestre de 1,4
   depois do limitador (ver `GANHO_MESTRE`): 0,25 × 1,4 = 0,35 na saída, que é
   a mesma trilha que o usuário pediu. Quem mexer num dos dois números tem de
   mexer no outro — o que está calibrado é o PRODUTO. */
const VOLUME_TRILHA = 0.25;

/* ------------------------------------------------------------- síntese ----- */

/* Taxa de amostragem REDUZIDA, para os sons que não têm agudo nenhum.
 *
 * O banco chegou a setenta segundos de áudio somados, e cada segundo custa
 * memória (4 bytes por amostra) e tempo de laço no `unlock` — que roda dentro
 * do clique que destrava o áudio, ou seja, num instante em que engasgar é
 * visível. Metade da taxa é metade dos dois.
 *
 * O que autoriza isso não é economia, é o CONTEÚDO: um rugido cujo passa-baixa
 * nunca abre acima de 2 kHz não tem uma única amostra de informação acima de
 * 2 kHz, e guardá-lo a 48 kHz é gravar silêncio caro. A 24 kHz o Nyquist são
 * 12 kHz, seis vezes acima do topo desses sons, e o próprio Web Audio
 * reamostra na hora de tocar.
 *
 * **Só entra aqui receita cujo corte máximo fique abaixo de ~3,5 kHz** — que é
 * onde o `passaBaixa` de um polo satura a 24 kHz (ver o `clamp` do alfa lá).
 * Um assobio, um estalo de terra ou o pico da dor própria NÃO cabem: eles
 * vivem justamente no agudo. */
const TAXA_ESCURA = 24000;

/**
 * Um buffer mono, preenchido por uma função de amostra.
 *
 * `fn(t, i)` recebe o tempo em SEGUNDOS (não a fração): as contas de síntese
 * são todas em Hz e em segundos, e converter dentro de cada receita seria
 * repetir a mesma divisão quinze vezes com quinze chances de errar.
 *
 * @param {number} [taxa] amostras por segundo. Ver `TAXA_ESCURA`; o padrão é a
 *   taxa da placa, e mexer nisto sem ler aquele comentário produz um som que
 *   perde o brilho sem ninguém entender por quê.
 */
function buffer(ctx, segundos, fn, taxa = ctx.sampleRate) {
  const n = Math.max(1, Math.floor(taxa * segundos));
  const buf = ctx.createBuffer(1, n, taxa);
  const d = buf.getChannelData(0);
  const dt = 1 / taxa;
  for (let i = 0; i < n; i++) d[i] = fn(i * dt, i);
  return buf;
}

/**
 * Passa-baixa de um polo, aplicado no lugar.
 *
 * Um polo só é pouco filtro — e é exatamente o que se quer: um passa-baixa
 * ressonante "canta" numa nota, e som de energia não tem nota. O que se procura
 * aqui é tirar o brilho do ruído branco sem lhe dar altura definida.
 *
 * `corte` pode ser função do tempo: é ela que faz o filtro ANDAR, e é o
 * movimento do corte que transforma ruído em sopro, em rugido ou em trovão.
 */
function passaBaixa(buf, corte) {
  const d = buf.getChannelData(0);
  const sr = buf.sampleRate;
  let y = 0;
  for (let i = 0; i < d.length; i++) {
    const fc = typeof corte === "function" ? corte(i / sr) : corte;
    /* Coeficiente do filtro a partir da frequência de corte. Preso em [0,1]:
       um corte acima de Nyquist daria alfa > 1 e o filtro entraria em
       realimentação positiva — estouro digital, não brilho. */
    const a = Math.min(1, Math.max(0.0005, (2 * Math.PI * fc) / sr));
    y += a * (d[i] - y);
    d[i] = y;
  }
  return buf;
}

/** Normaliza para o pico pedido. Sem isto cada receita sai num volume diferente. */
function normalizar(buf, pico = 0.9) {
  const d = buf.getChannelData(0);
  let max = 0;
  for (let i = 0; i < d.length; i++) {
    const v = Math.abs(d[i]);
    if (v > max) max = v;
  }
  if (max < 1e-6) return buf;
  const g = pico / max;
  for (let i = 0; i < d.length; i++) d[i] *= g;
  return buf;
}

/**
 * Casa o começo com o fim, para o buffer poder rodar em LOOP sem estalo.
 *
 * A emenda de um loop é uma descontinuidade, e descontinuidade em áudio é um
 * clique — audível, rítmico e impossível de ignorar depois que se percebe. A
 * mistura cruzada dos últimos milissegundos com os primeiros resolve isso sem
 * um único nó a mais na cadeia.
 */
function emendar(buf, segundos = 0.05) {
  const d = buf.getChannelData(0);
  const n = Math.min(Math.floor(buf.sampleRate * segundos), d.length >> 1);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const fim = d.length - n + i;
    d[fim] = d[fim] * (1 - t) + d[i] * t;
  }
  return buf;
}

const ruido = () => Math.random() * 2 - 1;

/* ---------------------------------------------------------------- receitas -- */

/**
 * A RAJADA DE KI. Curta, seca, e com a varredura DESCENDO.
 *
 * Descer é o que faz o ouvido ler "saiu de mim e foi embora". A mesma receita
 * com a varredura subindo soaria como carregar — e o jogador leria errado o que
 * acabou de fazer, mesmo olhando para a tela.
 */
function bolaDeKi(ctx) {
  const dur = 0.26;
  const b = buffer(ctx, dur, (t) => {
    const env = Math.exp(-t * 16);
    // 1400 → 220 Hz em exponencial: rápido no começo, e é o começo que se ouve.
    const f = 220 + 1180 * Math.exp(-t * 11);
    const tom = Math.sin(2 * Math.PI * f * t);
    /* O ruído é o SOPRO em volta do tom. Sem ele o som é um bip de brinquedo;
       com ele demais, vira chiado. Um terço é onde ele lê como energia. */
    return (tom * 0.7 + ruido() * 0.3) * env;
  });
  return normalizar(passaBaixa(b, (t) => 5200 * Math.exp(-t * 5) + 500), 0.85);
}

/** O acerto no corpo: mais curto e mais agudo que o disparo. */
function acerto(ctx) {
  const b = buffer(ctx, 0.18, (t) => {
    const env = Math.exp(-t * 26);
    const f = 180 + 900 * Math.exp(-t * 24);
    return (Math.sin(2 * Math.PI * f * t) * 0.5 + ruido() * 0.5) * env;
  });
  return normalizar(passaBaixa(b, 3400), 0.9);
}

/**
 * A CARGA — o som que sobe. Feito para rodar em LOOP.
 *
 * É a pose mais icônica do material de origem e o momento mais vulnerável do
 * jogo (o lutador fica parado). O som precisa comunicar as duas coisas: energia
 * acumulando, e uma tensão que não se resolve. Daí o zumbido em duas oitavas
 * mais o crepitar por cima — e nada que "termine", porque o fim quem dá é o
 * jogador ao soltar o botão.
 */
function cargaKi(ctx) {
  const b = buffer(ctx, 1.4, (t) => {
    /* Duas frequências que NÃO são múltiplas (62 e 93,5): batimento lento entre
       elas, que é o que dá a sensação de coisa viva em vez de motor. */
    const grave = Math.sin(2 * Math.PI * 62 * t) * 0.5;
    const medio = Math.sin(2 * Math.PI * 93.5 * t) * 0.3;
    // Crepitar: ruído modulado por um tremor rápido e irregular.
    const crep = ruido() * (0.18 + 0.12 * Math.sin(2 * Math.PI * 7.3 * t));
    return grave + medio + crep;
  });
  return normalizar(emendar(passaBaixa(b, 1800), 0.08), 0.75);
}

/**
 * O FEIXE sustentado (Kamehameha, Galick Gun). Loop.
 *
 * Rugido largo, sem altura definida: um feixe de energia que tem NOTA soa como
 * sintetizador, não como força bruta. O corte alto deixa passar o brilho que dá
 * a impressão de calor.
 */
function feixe(ctx) {
  const b = buffer(ctx, 1.1, (t) => {
    const corpo = ruido();
    // Um grave por baixo dá massa; sem ele o rugido fica fino e distante.
    const massa = Math.sin(2 * Math.PI * 48 * t) * 0.35;
    // Ondulação lenta: o feixe "respira" em vez de ser uma parede de ruído.
    const onda = 1 + 0.15 * Math.sin(2 * Math.PI * 3.1 * t);
    return (corpo * 0.8 + massa) * onda;
  });
  return normalizar(emendar(passaBaixa(b, 2600), 0.07), 0.8);
}

/**
 * A CARGA DO KAMEHAMEHA — o "ka-me-ha-me..." antes do "HÁ".
 *
 * Era o buraco mais grave do modo, e ele era literal: `especial()` tocava o
 * `disparoEspecial` no instante em que o jogador apertava o botão, ou seja **no
 * começo do windup**, e depois o feixe nascia 1,05 s mais tarde em silêncio
 * absoluto. O golpe mais caro do jogo tinha o som no lugar errado e não tinha
 * som nenhum no lugar certo — a pose inteira, que é o aviso que dá ao outro a
 * chance de sair da frente, acontecia muda.
 *
 * A duração ACOMPANHA `NAMEK.specials.kamehameha.windup` (1,05 s) com uma folga
 * de 100 ms para o disparo entrar por cima em vez de depois de um silêncio.
 * Quem mexer no windup mexe aqui junto — mesma regra do `genkiCarga`.
 *
 * ---------------------------------------------------------------- a receita
 *
 * O que separa esta carga das outras duas do banco é o MOVIMENTO:
 *
 * • `cargaKi` (o loop de encher a barra) não vai a lugar nenhum de propósito —
 *   ela é um zumbido em duas oitavas que não resolve, porque quem decide o fim
 *   é o jogador soltando o botão;
 * • `genkiCarga` RECOLHE de fora para dentro por 5,4 s, com um enxame que
 *   acelera;
 * • esta aqui CONVERGE. Duas vozes que começam separadas (148 e 232 Hz) e
 *   caminham uma para a outra (300 e 306 Hz no fim). A distância entre elas cai
 *   de 84 Hz — um intervalo largo, que o ouvido separa em duas notas — para
 *   6 Hz, que já não é intervalo nenhum: é um tom só, tremendo. Duas coisas
 *   virando uma, que é literalmente o que as duas mãos fazem na pose.
 *
 * A sucção por cima (ruído ganhando corpo) é o ar indo para a mão, e o
 * passa-baixa que ABRE de 380 para 3 580 Hz é o que faz a esfera parecer estar
 * ficando perto da lente — o mesmo truque do `genkiCarga` e pelo mesmo motivo.
 *
 * Não termina em decaimento: termina em amplitude cheia, com 50 ms de rampa só
 * para não estalar. O fim dela é o disparo, e um decaimento antes do disparo
 * contaria que o golpe murchou.
 */
function cargaDeFeixe(ctx) {
  const dur = 1.15;
  const b = buffer(ctx, dur, (t) => {
    const k = t / dur;
    /* Ao quadrado, como no `genkiCarga`: energia que chega em velocidade
       constante soa como fade-in de mixagem, e fade-in não conta história. */
    const cresce = k * k;
    const f1 = 148 + 152 * cresce;
    const f2 = 232 + 74 * cresce;
    const tom =
      (Math.sin(2 * Math.PI * f1 * t) * 0.5 + Math.sin(2 * Math.PI * f2 * t) * 0.4) *
      (0.25 + 0.75 * cresce);
    const suga = ruido() * (0.15 + 0.5 * cresce);
    // 60 ms de ataque na frente; 50 ms de rampa no fim, só contra o estalo.
    const env = Math.min(1, t / 0.06) * Math.min(1, (dur - t) / 0.05);
    return (tom + suga) * env;
  });
  return normalizar(passaBaixa(b, (t) => 380 + 3200 * Math.pow(t / dur, 1.7)), 0.9);
}

/**
 * O FEIXE ALHEIO, aceso. 2,7 s — a sustentação inteira mais a dissipação.
 *
 * O loop `feixe` só existe para o MEU Kamehameha: ele é acionado por
 * `update({ feixeAceso })`, que lê `game.casting`, e `casting` é um estado que
 * só o jogador local tem. O feixe dos outros — o tubo de treze metros de
 * diâmetro que atravessa a tela — não tinha absolutamente nenhum som depois do
 * estampido de saída.
 *
 * Aqui ele é um disparo ÚNICO e posicional em vez de um loop, e é uma escolha
 * e não uma preguiça: um loop posicional pediria uma voz reservada por feixe
 * alheio vivo (até seis) com liga/desliga vindo de um estado que o cliente não
 * recebe. Um buffer do tamanho exato da vida do golpe entrega a mesma coisa com
 * um `play()`, e se o feixe morrer antes (bateu numa montanha) o erro é a cauda
 * de meio segundo — que é justamente o tempo que o golpe leva dissipando.
 *
 * O timbre é primo do `rugidoDeFeixe` (o mesmo golpe encostando no chão) e
 * deliberadamente mais CLARO que ele: no ar não há terra devolvendo grave, há
 * um tubo de plasma assobiando. O corte fica em 3 000 Hz em vez de fechar em
 * 220, e o assobio de ~430 Hz com vibrato lento é o que dá a leitura de
 * "pressão passando por um cano" em vez de "estouro comprido".
 */
function feixeVoando(ctx) {
  const dur = 2.7;
  const b = buffer(ctx, dur, (t) => {
    const k = t / dur;
    /* Platô com solta no último quinto — o feixe dissipa, não decai desde o
       começo. Ver `rugidoDeFeixe`, mesma ideia e mesmo motivo. */
    const env = Math.min(1, t / 0.06) * (k < 0.8 ? 1 : Math.pow(1 - (k - 0.8) / 0.2, 1.4));
    const corpo = ruido();
    const massa = Math.sin(2 * Math.PI * 58 * t) * 0.3 + Math.sin(2 * Math.PI * 87 * t) * 0.18;
    // O assobio com vibrato de 2,7 Hz: o cano de plasma, não o estouro.
    const assobio = Math.sin(2 * Math.PI * (430 + 40 * Math.sin(2 * Math.PI * 2.7 * t)) * t) * 0.14;
    const onda = 1 + 0.14 * Math.sin(2 * Math.PI * 3.7 * t);
    return (corpo * 0.85 + massa + assobio) * onda * env;
  });
  return normalizar(passaBaixa(b, 3000), 0.95);
}

/**
 * A QUEIMADURA — o feixe torrando um corpo.
 *
 * `ev.queimando` era o único canal de acerto do jogo que não fazia barulho
 * nenhum na ponta de quem atirou: ele ia para a rede (`SPECIAL_HIT`) e o som só
 * voltava, se voltasse, como o `acerto` genérico do `HURT` da vítima — o mesmo
 * "toc" de uma bolinha de ki. Segurar um Kamehameha em cima de alguém por dois
 * segundos e ouvir tapinhas é a leitura errada do golpe mais caro do jogo.
 *
 * O timbre é o oposto do `acerto` (que é baque com grave): aqui não há grave
 * NENHUM abaixo de 1 400 Hz, porque carne queimando não tem tripa — tem chiado.
 * O crepitar irregular (33 Hz mordido por 11,7 Hz, dois tremores que não fecham
 * entre si) e as fagulhas esparsas são o que impedem o chiado de virar estática
 * de rádio.
 */
function queimaduraDeFeixe(ctx) {
  const b = buffer(ctx, 0.55, (t) => {
    const env = Math.min(1, t / 0.008) * Math.exp(-t * 4.5);
    const chiado = ruido() * (0.7 + 0.3 * Math.sin(2 * Math.PI * 33 * t) * Math.sin(2 * Math.PI * 11.7 * t));
    // Fagulhas: cliques esparsos, como as partículas do `genkiCarga`.
    const faisca = Math.random() < 0.09 ? ruido() * 0.8 : 0;
    const nota = Math.sin(2 * Math.PI * (760 * Math.exp(-t * 3) + 240) * t) * 0.22;
    return (chiado + faisca * 0.5 + nota) * env;
  });
  /* Piso ALTO no corte (1 400 Hz), e é ele que faz "queimar" em vez de "bater".
     Fechando como uma explosão, sobraria o baque — o som de qualquer outro golpe. */
  return normalizar(passaBaixa(b, (t) => 5200 * Math.exp(-t * 1.6) + 1400), 0.95);
}

/**
 * O ARREMESSO DA ESFERA — o Galick Gun saindo das duas mãos.
 *
 * Os três especiais que não são a Genki Dama dividiam UM buffer
 * (`disparoEspecial`) com três afinações: 0,85 para o Galick, 1,35 para o
 * Kienzan, 1 para o Kamehameha. Afinação não é timbre — é o mesmo som três
 * vezes, e o pedido é explícito em querer timbres DISTINTOS. Pior: afinar para
 * baixo estica o som, então o Galick soava como um Kamehameha em câmera lenta.
 *
 * O que o Galick faz que o feixe não faz é SAIR DA MÃO. Um feixe é pressão
 * contínua; uma esfera é massa que foi empurrada e foi embora. Por isso a
 * receita tem duas partes e nenhuma delas é a varredura descendente do feixe:
 *
 * • o EMPURRÃO — um grave curto de 114 → 40 Hz morrendo em dois décimos. É o
 *   peso deixando a mão, e é o que dá tonelada à bola;
 * • o SOPRO — ruído com ataque próprio, filtrado por um corte que ABRE e FECHA
 *   em torno de 130 ms (o termo gaussiano). Um corte que só fecha lê como coisa
 *   que explodiu; um que abre e fecha lê como coisa que PASSOU, e é a assinatura
 *   acústica de um objeto voando perto do ouvido.
 */
function arremessoDeEsfera(ctx) {
  const b = buffer(ctx, 0.8, (t) => {
    const ataque = Math.min(1, t / 0.004);
    const empurra = Math.sin(2 * Math.PI * (40 + 74 * Math.exp(-t * 7)) * t) * 0.85 * Math.exp(-t * 4.2);
    const sopro = ruido() * Math.exp(-t * 3.1) * (1 - Math.exp(-t * 22));
    return (empurra + sopro * 0.7) * ataque;
  });
  return normalizar(
    passaBaixa(b, (t) => 260 + 2400 * Math.exp(-Math.pow((t - 0.13) / 0.16, 2))),
    0.95,
  );
}

/**
 * O ZUNIDO DO KIENZAN — o disco ganhando giro e saindo.
 *
 * O Kienzan já tinha identidade no IMPACTO (`talhoDeDisco`, o gume mordendo a
 * terra) e nenhuma no DISPARO: ele saía com o `disparoEspecial` afinado em 1,35,
 * ou seja, um Kamehameha fininho. O golpe que é uma lâmina começava soando como
 * um feixe.
 *
 * Aqui ele começa como o que é. A varredura SOBE (620 → 1 800 Hz), ao contrário
 * de todo disparo do modo, e subir é o certo justamente uma vez: o disco não é
 * lançado pronto, ele é FIADO na mão até virar um anel e só então voa. O
 * tremolo cuja frequência cresce com o tempo (38 Hz + 60·t) são as bordas
 * cortando o ar a cada volta, cada vez mais rápido.
 *
 * O par desafinado 1 : 1,37 é o mesmo truque do `talhoDeDisco` e existe pela
 * mesma razão: duas senoides na mesma frequência somam e viram nota de
 * instrumento, e um Kienzan que toca uma nota é um sino.
 */
function zunidoDeDisco(ctx) {
  const b = buffer(ctx, 0.62, (t) => {
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 3.2);
    const f = 620 + 1180 * (1 - Math.exp(-t * 7));
    const gume = Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 1.37 * t) * 0.32;
    const giro = 0.7 + 0.3 * Math.sin(2 * Math.PI * (38 + 60 * t) * t);
    const ar = ruido() * 0.35 * Math.exp(-t * 5);
    return (gume * giro + ar) * env;
  });
  return normalizar(passaBaixa(b, (t) => 7000 * Math.exp(-t * 2.2) + 1500), 0.92);
}

/**
 * O ARREMESSO DA GENKI DAMA — a esfera enorme começando a andar.
 *
 * `genkiCarga` cobria os 5,2 s da pose e depois... nada. A maior coisa que este
 * modo desenha era JUNTADA com som de arena inteira e ARREMESSADA em silêncio,
 * e só voltava a existir quando detonava. O buraco ficava exatamente no instante
 * mais dramático do golpe.
 *
 * A receita é o inverso da carga em todos os eixos, de propósito — a carga sobe
 * e adensa por cinco segundos, o arremesso DESPENCA em um e meio:
 *
 * • o GEMIDO desce de 96 para 30 Hz. Trinta hertz é a faixa em que se sente
 *   mais do que se ouve, e é o mesmo terreno do `detonacaoColossal`: os dois
 *   sons são as duas pontas do mesmo golpe e têm de soar da mesma família;
 * • o AR tem ataque próprio de 200 ms e cauda longa — uma esfera de vinte e
 *   seis metros de diâmetro não "passa", ela EMPURRA o ar por um bom tempo
 *   depois de já ter saído.
 *
 * Vai pela mistura solene, como a carga e a detonação: os três pedaços do golpe
 * que a arena inteira tem direito de ouvir são os três pedaços do mesmo golpe.
 */
function arremessoColossal(ctx) {
  const b = buffer(ctx, 1.6, (t) => {
    const ataque = Math.min(1, t / 0.006);
    const gemido = Math.sin(2 * Math.PI * (30 + 66 * Math.exp(-t * 2.4)) * t) * Math.exp(-t * 1.5);
    const ar = ruido() * (1 - Math.exp(-t * 5)) * Math.exp(-t * 1.9) * 0.75;
    return (gemido * 1.1 + ar) * ataque;
  });
  return normalizar(passaBaixa(b, (t) => 70 + 900 * Math.exp(-t * 1.3)), 0.95);
}

/** O disparo do especial: o instante em que o feixe SAI. Descida violenta. */
function disparoEspecial(ctx) {
  const b = buffer(ctx, 0.7, (t) => {
    const env = Math.exp(-t * 5.5);
    const f = 90 + 1400 * Math.exp(-t * 9);
    return (Math.sin(2 * Math.PI * f * t) * 0.55 + ruido() * 0.45) * env;
  });
  return normalizar(passaBaixa(b, (t) => 6000 * Math.exp(-t * 3.4) + 260), 0.95);
}

/**
 * EXPLOSÃO. `tamanho` estica a cauda e abaixa o corte.
 *
 * O que separa um estouro pequeno de um grande não é o volume — é o TEMPO que
 * ele leva para morrer e o quanto dele é grave. Uma explosão grande tocada
 * baixo continua lendo como grande; uma pequena tocada alto lê como perto.
 */
function explosao(ctx, tamanho = 1) {
  const dur = 0.6 + 1.5 * tamanho;
  const b = buffer(ctx, dur, (t) => {
    /* Ataque não-instantâneo (2 ms): o estalo seco de um envelope quadrado lê
       como clique de alto-falante, não como estouro. */
    const ataque = Math.min(1, t / 0.002);
    const cauda = Math.exp(-t * (3.4 / tamanho));
    const grave = Math.sin(2 * Math.PI * (46 / tamanho) * t) * 0.4 * Math.exp(-t * 2);
    return (ruido() * 0.9 + grave) * ataque * cauda;
  });
  return normalizar(passaBaixa(b, (t) => (1500 / tamanho) * Math.exp(-t * 1.6) + 90), 1);
}

/**
 * O ESTALO DA RAJADA NO CHÃO — a bola de ki arrebentando na terra.
 *
 * É o som que faltava, e a queixa foi literal: *"quando o poder cair no chão e
 * explodir deve fazer barulho de explosão, inclusive aqueles poderes rápidos."*
 * A rajada TINHA som de impacto — o `explosao(0,55)` genérico —, e o problema
 * era ele ser a mesma coisa que tudo o mais, um degrau mais baixo. Numa troca de
 * tiros a 6/s, doze estouros iguais por segundo viram um ronco só, e o ouvido
 * para de contar.
 *
 * O que separa este som dos outros é o TEMPO, não o volume: 0,3 s contra os 1,4
 * do Galick Gun. Um estalo curto e brilhante lê como "bateu ali" e some para dar
 * lugar ao próximo; uma explosão com cauda lê como "aconteceu alguma coisa
 * grande" e, repetida seis vezes por segundo, entope a mistura inteira.
 *
 * O corte que ABRE (400 → 2 600 Hz nos primeiros 8 ms) é o que dá o "tec" do
 * torrão de terra voando; depois ele fecha depressa e sobra só o grave curto do
 * chão cedendo.
 */
function estaloDeTerra(ctx) {
  const b = buffer(ctx, 0.3, (t) => {
    const ataque = Math.min(1, t / 0.0015);
    const cauda = Math.exp(-t * 16);
    /* O grave é uma senoide que DESCE — 190 para ~60 Hz em três centésimos.
       Frequência fixa daria nota, e terra cedendo não tem nota. */
    const grave = Math.sin(2 * Math.PI * (190 * Math.exp(-t * 26) + 58) * t) * 0.55;
    return (ruido() * 0.85 + grave) * ataque * cauda;
  });
  return normalizar(
    passaBaixa(b, (t) => (t < 0.008 ? 400 + 275000 * t : 2600 * Math.exp(-t * 22) + 130)),
    1,
  );
}

/**
 * O TALHO DO KIENZAN NO CHÃO — o disco cravando na terra.
 *
 * O golpe é uma LÂMINA, e nenhum dos estouros do banco soa como lâmina: eles são
 * todos ruído filtrado com cauda, que é a assinatura de uma coisa que EXPLODE.
 * O Kienzan não explode — ele corta, e o corte tem duas partes que este som
 * separa de propósito:
 *
 * • o ZUMBIDO, um par de senoides desafinadas entre si (1 040 e 1 390 Hz)
 *   morrendo em um décimo de segundo. Elas batem uma contra a outra e produzem
 *   o "ring" metálico que o ouvido lê como gume;
 * • a MORDIDA, o ruído grave de terra sendo aberta logo atrás.
 *
 * A desafinação é o ponto inteiro: duas senoides na MESMA frequência somam e
 * viram uma nota limpa de instrumento. É a diferença entre um sino e uma lâmina.
 */
function talhoDeDisco(ctx) {
  const b = buffer(ctx, 0.75, (t) => {
    const ataque = Math.min(1, t / 0.001);
    const zumbido =
      (Math.sin(2 * Math.PI * 1040 * t) + Math.sin(2 * Math.PI * 1390 * t) * 0.8) *
      0.5 *
      Math.exp(-t * 24);
    const mordida = ruido() * 0.9 * Math.exp(-t * 7);
    const grave = Math.sin(2 * Math.PI * (120 * Math.exp(-t * 12) + 44) * t) * 0.5 * Math.exp(-t * 5);
    return (zumbido + mordida + grave) * ataque;
  });
  /* O corte NÃO desce até o fim: 900 Hz de piso deixam o zumbido passar pela
     cauda inteira. Fechando como uma explosão comum, a lâmina desapareceria e
     sobraria o baque — que é o som de qualquer outro golpe. */
  return normalizar(passaBaixa(b, (t) => 5200 * Math.exp(-t * 9) + 900), 1);
}

/**
 * O RUGIDO DO KAMEHAMEHA NO CHÃO — e ele é o único impacto SUSTENTADO do modo.
 *
 * Os outros golpes batem e acabam. O feixe fica APOIADO no terreno por até 2,4 s,
 * cavando: a cabeça dele encosta, abre a cratera de entrada e continua ali,
 * perfurando. Um estouro de meio segundo debaixo de um feixe que dura cinco
 * vezes isso é a leitura errada — soa como se o golpe tivesse terminado enquanto
 * ele ainda está queimando o chão na frente do jogador.
 *
 * Por isso 2,2 s, e por isso o envelope é um PLATÔ e não uma cauda: sobe em
 * 40 ms, segura, e só solta no último terço. É o som de uma coisa que está
 * acontecendo, e não de uma que aconteceu.
 *
 * O tremor de 19 Hz por cima é o que impede o platô de virar um chiado de
 * estática: energia sustentada não é lisa, ela pulsa.
 */
function rugidoDeFeixe(ctx) {
  const dur = 2.2;
  const b = buffer(ctx, dur, (t) => {
    const k = t / dur;
    const env = Math.min(1, t / 0.04) * (k < 0.62 ? 1 : Math.pow(1 - (k - 0.62) / 0.38, 1.6));
    /* Duas frequências de tremor que não fecham entre si, como no tremor da
       câmera e pelo mesmo motivo: uma só é um batimento regular, e batimento
       regular lê como defeito de áudio. */
    const pulso = 0.72 + 0.28 * Math.sin(2 * Math.PI * 19 * t) * Math.sin(2 * Math.PI * 7.3 * t);
    const sub = Math.sin(2 * Math.PI * 52 * t) * 0.5 + Math.sin(2 * Math.PI * 78 * t) * 0.25;
    return (ruido() * 0.8 * pulso + sub) * env;
  });
  return normalizar(passaBaixa(b, (t) => 1900 * Math.exp(-t * 0.9) + 220), 1);
}

/**
 * A GENKI DAMA SENDO JUNTADA. 5,4 s, para cobrir o windup de 5,2 s.
 *
 * A duração ACOMPANHA `NAMEK.specials.genki.windup`, e tem de acompanhar: um
 * buffer mais curto que a pose deixa o fim dela em silêncio, e o fim da pose é
 * justamente o instante em que o jogador está mais exposto — parado no ar, sem
 * defesa, com a esfera no tamanho máximo. Silêncio ali leria como "o golpe
 * falhou". Quem mexer no windup mexe aqui junto.
 *
 * Todos os outros especiais saem com um "fiu" descendente (`disparoEspecial`),
 * e descer é o que faz o ouvido ler "saiu de mim e foi embora". A Genki Dama é o
 * contrário em tudo: durante 3,6 s ela não sai — ela RECOLHE. Energia vindo de
 * todo lado para um ponto acima da cabeça de um lutador que fica parado, sem
 * defesa, apostando a barra inteira. Um "fiu" ali contaria a história errada.
 *
 * Por isso tudo neste som sobe e ADENSA:
 *
 * • o sub sai de 34 e chega a 96 Hz, e ganha volume ao quadrado do tempo — a
 *   aceleração é o que faz a coisa parecer inevitável em vez de constante;
 * • o tremor que modula o enxame acelera de 3 para 25 Hz, que é a energia
 *   chegando de mais longe e mais rápido conforme a esfera cresce;
 * • as partículas (o crepitar esparso) ficam mais densas no fim;
 * • o passa-baixa ABRE de 300 para 4 500 Hz, que é a diferença entre uma coisa
 *   acontecendo longe e uma coisa acontecendo em cima de você.
 *
 * O último décimo de segundo desce em rampa — não por estética, mas porque um
 * buffer que termina em amplitude cheia dá um estalo de alto-falante, e este é
 * um som longo demais para terminar num clique.
 */
function genkiCarga(ctx) {
  const dur = 5.4;
  const b = buffer(ctx, dur, (t) => {
    const k = t / dur;
    /* Ao quadrado, não linear: a energia "chegando" tem de acelerar. Linear soa
       como um fade-in de mixagem, e fade-in não conta história nenhuma. */
    const cresce = k * k;
    const fSub = 34 + 62 * cresce;
    const sub = Math.sin(2 * Math.PI * fSub * t) * (0.25 + 0.55 * cresce);
    // O enxame: ruído mordido por um tremor que acelera de 3 para 25 Hz.
    const tremor = 0.55 + 0.45 * Math.sin(2 * Math.PI * (3 + 22 * cresce) * t);
    const enxame = ruido() * tremor * (0.2 + 0.5 * cresce);
    /* Partículas: cliques esparsos que só acontecem em parte das amostras. A
       densidade sobe com `cresce`, então a esfera passa de "faíscas soltas" a
       "chuva" sem que nenhum parâmetro de volume tenha mudado. */
    const particula = Math.random() < 0.006 + 0.05 * cresce ? ruido() * 0.6 : 0;
    // Ataque de 150 ms na frente, rampa de 100 ms no fim.
    const env = Math.min(1, t / 0.15) * Math.min(1, (dur - t) / 0.1);
    return (sub + enxame + particula) * env;
  });
  return normalizar(passaBaixa(b, (t) => 300 + 4200 * Math.pow(t / dur, 2)), 0.95);
}

/**
 * A DETONAÇÃO COLOSSAL — só a Genki Dama chega aqui.
 *
 * `explosao(tamanho)` é uma boa escala para o repertório normal, mas ela satura:
 * como tudo sai normalizado no mesmo pico, um estouro "maior" só se diferencia
 * pelo tempo que leva para morrer, e a partir de certo ponto o ouvido para de
 * medir isso. Um golpe de 96 de dano e 30 m de cratera precisa de outra coisa,
 * e a outra coisa é **estrutura**, em três tempos que o ouvido consegue separar:
 *
 * 1. **SUB no impacto** (0 → 0,3 s). Uma senoide caindo de 44 para 18 Hz. Nessa
 *    faixa quase não se OUVE — se SENTE, e num alto-falante pequeno ela vira o
 *    empurrão no cone que nenhum outro som do modo produz. É o que dá o "isso
 *    foi diferente" antes de qualquer análise consciente.
 * 2. **ROLO longo** (0 → 6 s). Ruído com cauda de seis segundos, ondulado a
 *    0,7 Hz: o eco voltando do terreno. Nenhum outro estouro do modo passa de
 *    4,2 s, então o rolo sozinho já denuncia de quem foi o golpe.
 * 3. **DESLOCAMENTO DE AR** (a partir de 0,35 s). O sopro que chega DEPOIS do
 *    estouro, com ataque próprio: é a frente de pressão, e é a parte que faz a
 *    explosão ter tamanho físico em vez de ser só um estampido alto.
 *
 * O corte do passa-baixa REABRE por volta de 0,9 s (o termo gaussiano) em vez de
 * só fechar. Isso é de propósito: o rolo grave e a frente de ar não têm o mesmo
 * brilho, e sem essa reabertura o deslocamento de ar ficava enterrado embaixo do
 * rolo — o som ficava enorme e SURDO, quando ele precisa ser enorme e ABERTO.
 */
function detonacaoColossal(ctx) {
  const dur = 6.5;
  const b = buffer(ctx, dur, (t) => {
    // 3 ms de ataque: instantâneo demais é clique de alto-falante, não estouro.
    const ataque = Math.min(1, t / 0.003);
    const fSub = 18 + 26 * Math.exp(-t * 2.2);
    const sub = Math.sin(2 * Math.PI * fSub * t) * Math.exp(-t * 1.1);
    const rolo = ruido() * Math.exp(-t * 0.85) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t));
    let ar = 0;
    if (t > 0.35) {
      const u = t - 0.35;
      // Ataque próprio (300 ms) e cauda própria: a frente de ar é outro evento.
      ar = ruido() * (1 - Math.exp(-u * 3.3)) * Math.exp(-u * 1) * 0.7;
    }
    return (sub * 1.15 + rolo * 0.85 + ar) * ataque;
  });
  return normalizar(
    passaBaixa(b, (t) => 45 + 860 * Math.exp(-t * 3) + 520 * Math.exp(-Math.pow((t - 0.9) / 0.7, 2))),
    1,
  );
}

/** O baque de um corpo caindo no chão de muito alto. Grave e curto. */
function baque(ctx) {
  const b = buffer(ctx, 0.85, (t) => {
    const env = Math.exp(-t * 6);
    const f = 130 * Math.exp(-t * 12) + 38;
    return (Math.sin(2 * Math.PI * f * t) * 0.8 + ruido() * 0.35) * env;
  });
  return normalizar(passaBaixa(b, 620), 1);
}

/** A onda de empurrão: um estalo de pressão que abre. */
function ondaDeKi(ctx) {
  const b = buffer(ctx, 0.55, (t) => {
    const env = Math.exp(-t * 8);
    // Varredura SUBINDO: a casca se expandindo para fora.
    const f = 120 + 700 * (1 - Math.exp(-t * 14));
    return (Math.sin(2 * Math.PI * f * t) * 0.45 + ruido() * 0.55) * env;
  });
  return normalizar(passaBaixa(b, 2200), 0.92);
}

/**
 * TROVÃO da tempestade. Longo, quase todo grave.
 *
 * O estalo agudo na frente é o raio; o rolo grave atrás é o ar voltando. Sem o
 * estalo o som lê como avalanche; sem o rolo, como galho quebrando.
 */
function trovao(ctx) {
  const b = buffer(ctx, 2.6, (t) => {
    const estalo = t < 0.08 ? ruido() * Math.exp(-t * 42) : 0;
    const rolo = ruido() * Math.exp(-t * 1.5) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.7 * t));
    return estalo * 0.9 + rolo * 0.7;
  });
  return normalizar(passaBaixa(b, (t) => 900 * Math.exp(-t * 1.1) + 60), 1);
}

/** O vento do voo rápido. Loop. Sopro puro, sem altura. */
function ventoDeVoo(ctx) {
  const b = buffer(ctx, 1.3, (t) => ruido() * (1 + 0.25 * Math.sin(2 * Math.PI * 2.3 * t)));
  return normalizar(emendar(passaBaixa(b, 900), 0.09), 0.7);
}

/**
 * Dor alheia: curto, grave, sem brilho. Alguém apanhou, e não fui eu.
 *
 * **Sem chamador hoje, e mantido de propósito** — ao contrário do `trava`, que
 * foi apagado na mesma varredura. A diferença não é de gosto: `trava` tinha um
 * método público (`travou()`) apontando para ele, e um som público sem evento é
 * uma armadilha para o próximo que precisar de um bipe. Este não tem porta
 * nenhuma para fora; ele é o TERMO DE COMPARAÇÃO de que a documentação inteira
 * do `dorPropria` e do `levouDano` depende — as duas explicam por que apanhar
 * não pode soar como acertar medindo uma contra a outra, e apagar a referência
 * deixaria o argumento sem o outro lado.
 *
 * O custo é 0,3 s de buffer e ~2 ms de laço na leva 1. Se algum dia alguém
 * quiser separar "o golpe que EU dei nos outros" do `acerto` genérico, ela já
 * está aqui e é exatamente esse som.
 */
function dor(ctx) {
  const b = buffer(ctx, 0.3, (t) => {
    const env = Math.exp(-t * 12);
    return (Math.sin(2 * Math.PI * (150 * Math.exp(-t * 6) + 60) * t) * 0.7 + ruido() * 0.3) * env;
  });
  return normalizar(passaBaixa(b, 900), 0.9);
}

/**
 * A DOR PRÓPRIA — o golpe em MIM. O som mais importante do modo.
 *
 * Este é o som que o jogador precisa ouvir mesmo estando distraído, mesmo no
 * meio de um tiroteio de quinze pessoas, mesmo sem estar olhando para a barra de
 * vida. Ele existe separado de `dor` (o golpe nos outros) porque as duas coisas
 * NÃO podem soar parecidas: se apanhar soa igual a acertar, o jogador aprende a
 * ignorar os dois, e a partir daí morre sem entender por quê.
 *
 * A separação é feita em três eixos ao mesmo tempo, e é por isso que ela
 * funciona mesmo com a mistura cheia:
 *
 * • **PICO curto.** Dezoito milissegundos de ruído quase sem filtro na frente.
 *   É a única coisa aguda deste som, e ela existe para ATRAVESSAR — um transiente
 *   curto e brilhante é a coisa mais difícil de mascarar que existe, porque o
 *   ouvido o detecta pelo ataque e não pelo espectro. É o que faz o golpe "doer".
 * • **CORPO curto atrás.** Uma queda de 190 a 52 Hz em cento e poucos
 *   milissegundos, mais um sub em 41 Hz sustentando por meio segundo. É o peso.
 *   O golpe nos outros (`dor`) mora em 60–150 Hz e para em 0,3 s; este desce
 *   mais fundo e dura mais, e o ouvido lê essa diferença como "foi comigo".
 * • **Sem atenuação.** Ver `tocarNaCabeca`. Quem apanha está a zero metro de si
 *   mesmo, e este é o som que menos pode depender de onde a câmera está.
 *
 * O passa-baixa ANDA de 2 800 para 190 Hz em cerca de cem milissegundos: é ele
 * que deixa o pico passar inteiro e depois fecha a porta, transformando o resto
 * numa pancada surda em vez de um chiado prolongado.
 */
function dorPropria(ctx) {
  const b = buffer(ctx, 0.5, (t) => {
    const pico = ruido() * Math.exp(-t * 150);
    const f = 52 + 138 * Math.exp(-t * 18);
    const corpo = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9);
    const sub = Math.sin(2 * Math.PI * 41 * t) * Math.exp(-t * 5);
    return pico * 0.9 + corpo * 0.85 + sub * 0.5;
  });
  return normalizar(passaBaixa(b, (t) => 2600 * Math.exp(-t * 26) + 190), 1);
}

/**
 * GOLPE APARADO pela guarda. Preparado para o estado de defesa novo.
 *
 * O que define este som é o que ele NÃO tem: o grave. Um golpe que entra no
 * corpo tem tripa; um golpe que bate no antebraço cruzado é casca — curto, seco,
 * com brilho e sem peso. É exatamente a informação que o jogador precisa no
 * instante em que segura a guarda: "funcionou, o dano foi cortado".
 *
 * Dois parciais desafinados (620 e 917 Hz, que não são múltiplos) dão o timbre de
 * casca sem virar NOTA — som de guarda com altura definida lê como sino, e sino
 * lê como recompensa de menu, não como um golpe absorvido.
 */
function guardaAparada(ctx) {
  const b = buffer(ctx, 0.22, (t) => {
    const env = Math.exp(-t * 30) * Math.min(1, t / 0.001);
    const casca = Math.sin(2 * Math.PI * 620 * t) * 0.35 + Math.sin(2 * Math.PI * 917 * t) * 0.25;
    return (casca + ruido() * 0.5) * env;
  });
  return normalizar(passaBaixa(b, (t) => 5200 * Math.exp(-t * 12) + 900), 0.85);
}

/** Morte: a mesma ideia da dor, mais longa e caindo mais fundo. */
function morte(ctx) {
  const b = buffer(ctx, 1.1, (t) => {
    const env = Math.exp(-t * 3.2);
    const f = 210 * Math.exp(-t * 3) + 34;
    return (Math.sin(2 * Math.PI * f * t) * 0.8 + ruido() * 0.25) * env;
  });
  return normalizar(passaBaixa(b, 700), 0.95);
}

/**
 * O aviso de KI CHEIO — o único som do modo que NÃO é posicional.
 *
 * Ele não acontece no mundo: acontece em você. Uma terça maior ascendente, que
 * é o intervalo que o ouvido lê como "liberado" sem precisar de nenhum
 * treinamento. É deliberadamente o som mais limpo do jogo, para atravessar uma
 * briga cheia de explosão — porque a informação que ele carrega (o especial
 * destravou) é a que decide a próxima jogada.
 */
function kiCheio(ctx) {
  const b = buffer(ctx, 0.5, (t) => {
    const env = Math.exp(-t * 5.5) * Math.min(1, t / 0.005);
    const f = t < 0.1 ? 880 : 1108.7;
    return Math.sin(2 * Math.PI * f * t) * env * 0.6 + Math.sin(2 * Math.PI * f * 2 * t) * env * 0.18;
  });
  return normalizar(b, 0.55);
}

/* A RECEITA `trava` FOI APAGADA daqui. Eram dois cliques secos em 1 600 Hz, o
   som de travar um alvo com a tecla R — e o atalho R saiu do jogo a pedido do
   usuário. O buffer virava lixo em todo `unlock` e o método `travou()` não
   tinha um único chamador no repositório.
   O raciocínio de não a ter reciclado para o aviso de Super Saiyajin está em
   `_sintetizarMundo`, ao lado do `avisoSSJ` que ocupou a vaga. */

/* ============================================================== O MUNDO ======
 *
 * Daqui para baixo os sons não são de golpe: são do que ACONTECE no planeta —
 * o peixe, a chuva de meteoros — e do que acontece com o corpo de quem joga (a
 * transformação). Eles chegaram todos de uma vez, pedidos pelos donos dos
 * módulos que os disparam, e a regra de sempre vale: nenhum arquivo de áudio
 * novo, tudo saído de ruído filtrado, varredura e envelope.
 * ========================================================================== */

/**
 * O RESPINGO — vinte e seis metros de peixe entrando e saindo do mar.
 *
 * Não existia som de água NENHUM no modo, e os dois respingos do peixe usavam o
 * `baque` (`quedaNoChao`), que é um corpo caindo em terra: grave, seco, com
 * cauda curta. É quase o oposto do que a água faz, e o ouvido sabe disso mesmo
 * sem conseguir explicar — água não é uma pancada, é um VOLUME sendo aberto e
 * fechando de volta.
 *
 * Três partes, e a terceira é a que faz a coisa ser água:
 *
 * 1. o ESTOURO da superfície (90 ms de ruído largo). Sozinho, isto é uma
 *    explosão pequena;
 * 2. o VOLUME deslocado — um grave de 90 → 38 Hz que morre em um quarto de
 *    segundo. Curto de propósito: terra CEDE e continua rangendo, água só se
 *    afasta. Um grave com cauda longa aqui leria como pedra;
 * 3. a CHUVA — gotas caindo de volta, e é a assinatura. Cliques esparsos cuja
 *    densidade cai de 22 % para quase zero em um segundo e pouco, misturados a
 *    um borbulhar de tremor irregular. Nenhuma explosão do banco tem isso, e é
 *    por isso que nenhuma soa molhada.
 *
 * O passa-baixa é o outro eixo da diferença: ele fecha para um piso ALTO
 * (1 100 Hz), enquanto o `estaloDeTerra` fecha para 130. Água que perde o
 * brilho vira lama; a chuva de gotas mora justamente no agudo.
 */
function respingoDeAgua(ctx) {
  const dur = 1.4;
  const b = buffer(ctx, dur, (t) => {
    const crash = t < 0.09 ? ruido() * Math.exp(-t * 34) : 0;
    const volume = Math.sin(2 * Math.PI * (38 + 52 * Math.exp(-t * 14)) * t) * 0.7 * Math.exp(-t * 9);
    /* Densidade de gotas caindo com o tempo. Só depois de 120 ms: antes disso a
       água ainda está subindo, e gota que cai antes de a coluna subir é ruído. */
    const dens = 0.22 * Math.exp(-t * 2.2);
    const gota = t > 0.12 && Math.random() < dens ? ruido() * (0.5 + 0.5 * Math.random()) : 0;
    const borbulha =
      ruido() * 0.3 * Math.exp(-t * 2.6) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 8.3 * t) * Math.sin(2 * Math.PI * 3.1 * t));
    return crash * 0.95 + volume + gota * 0.85 + borbulha;
  });
  return normalizar(
    passaBaixa(b, (t) => (t < 0.02 ? 6000 : 3400 * Math.exp(-t * 2.4) + 1100)),
    1,
  );
}

/**
 * O ASSOBIO DA ROCHA CAINDO. `tamanho` troca o timbre, não só a altura.
 *
 * A chuva de meteoros avisava só pelo OLHO — a mancha laranja no chão (ver
 * `meteoros.js`) — e o estouro só existia depois que a rocha já tinha matado
 * quem estava dentro do raio letal. Um aviso que exige estar olhando para baixo
 * não é aviso num jogo de luta aérea.
 *
 * ------------------------------------------------------------------ a receita
 *
 * Duas coisas ao mesmo tempo, e é a combinação que o ouvido lê como "está
 * caindo em cima de mim":
 *
 * • a AMPLITUDE sobe ao quadrado — está chegando;
 * • a ALTURA desce — o Doppler de uma coisa que se aproxima e passa.
 *
 * Uma sem a outra não funciona: só amplitude subindo é um fade-in, e só altura
 * caindo é uma sirene de desenho animado.
 *
 * ------------------------------------------------------------ e o tamanho
 *
 * `tamanho` não é um multiplicador de volume — as três classes de rocha
 * (`NAMEK.planetas.meteoro.classes`: 2,2 m, 5 m e 11 m de raio) precisam soar
 * como coisas DIFERENTES, e o eixo que as separa é quanto de tom contra quanto
 * de ruído:
 *
 * • o pedrisco é quase só TOM (10 % de ruído) — ele assobia, fino e agudo;
 * • o colosso é quase só RUÍDO (66 %) com um sub por baixo — ele não assobia,
 *   ele RASGA o ar. Uma coisa de onze metros de raio não tem altura definida.
 *
 * A frequência e o corte também caem com o tamanho, o que dobra a leitura: o
 * pequeno é agudo e claro, o grande é grave e escuro, e os dois estão descendo.
 */
function assobioDeRocha(ctx, tamanho = 1) {
  const dur = 2.6;
  const b = buffer(ctx, dur, (t) => {
    const k = t / dur;
    const perto = 0.12 + 0.88 * k * k;
    const f = (1500 / tamanho) * (1 - 0.62 * k) + 90;
    const tom = Math.sin(2 * Math.PI * f * t);
    const mistura = Math.min(0.85, 0.3 * tamanho);
    const sub =
      Math.sin(2 * Math.PI * (46 / Math.max(0.6, tamanho)) * t) * 0.4 * Math.min(1, tamanho * 0.6);
    const corpo = tom * (1 - mistura) + ruido() * mistura + sub;
    /* 250 ms de ataque (a rocha entra na atmosfera, não aparece) e 120 ms de
       rampa no fim — o fim aqui é o estouro, e um clique antes dele estragaria
       justamente o instante que o assobio existe para anunciar. */
    const env = Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 0.12);
    return corpo * perto * env;
  });
  return normalizar(passaBaixa(b, (t) => (2600 / tamanho) * (1 - 0.55 * (t / dur)) + 260), 0.9);
}

/**
 * O GRITO DA TRANSFORMAÇÃO — três segundos de Super Saiyajin.
 *
 * A duração ACOMPANHA `NAMEK.ssj.duracao`, como a da Genki Dama acompanha o
 * windup dela: a animação inteira tem de estar coberta, e o estouro seco no fim
 * tem de cair no mesmo quadro do clarão (ver `NamekGame.estourarSSJ`). Quem
 * mexer nos três segundos mexe aqui junto.
 *
 * ---------------------------------------------------------------- a garganta
 *
 * O problema honesto: **isto é um grito, e não existe amostra de voz neste
 * modo.** Sintetizar voz é outro ofício (formantes, ressonadores, um modelo de
 * trato vocal) e o resultado de uma tentativa preguiçosa é sempre um brinquedo
 * falando.
 *
 * O que dá para fazer, e é o que está aqui, é a única pista acústica que o
 * ouvido usa para separar "voz forçada" de "máquina": a MODULAÇÃO IRREGULAR e
 * rápida da amplitude. Uma garganta no limite não produz um tom, produz um som
 * serrilhado; e uma serrilha cuja frequência ACELERA de 28 para 150 Hz é lida
 * como um esforço que está aumentando. Não é uma voz — é a assinatura de uma,
 * e é ela que faz o resto do som (o sub que sobe, o corte que abre) virar
 * "alguém gritando" em vez de "um motor ligando".
 *
 * O ESTOURO nos últimos 200 ms é o clarão. Ele corta o grito em vez de somar a
 * ele (o `Math.exp` que multiplica a garganta depois do corte): a transformação
 * não termina desbotando, ela ESTOURA, e o que vem depois do estouro é a nova
 * aura — que é assunto do `loop`, não deste buffer.
 */
function gritoDeTransformacao(ctx) {
  const dur = (NAMEK.ssj?.duracao ?? 3) + 0.05;
  const corte = dur - 0.2;
  const b = buffer(ctx, dur, (t) => {
    const k = Math.min(1, t / corte);
    const sobe = k * k;
    const rasp = 0.55 + 0.45 * Math.sin(2 * Math.PI * (28 + 122 * sobe) * t);
    const garganta = ruido() * rasp * (0.2 + 0.6 * sobe);
    const peito =
      (Math.sin(2 * Math.PI * (44 + 58 * sobe) * t) * 0.55 +
        Math.sin(2 * Math.PI * (66 + 92 * sobe) * t) * 0.3) *
      (0.25 + 0.75 * sobe);
    let estouro = 0;
    let ceifa = 1;
    if (t >= corte) {
      const u = t - corte;
      estouro =
        (ruido() * 0.95 + Math.sin(2 * Math.PI * (200 * Math.exp(-u * 30) + 45) * u) * 0.8) *
        Math.exp(-u * 13);
      ceifa = Math.exp(-u * 9);
    }
    const env = Math.min(1, t / 0.08) * Math.min(1, (dur - t) / 0.04);
    return ((garganta + peito) * ceifa + estouro * 1.1) * env;
  });
  /* O corte ABRE com o esforço (420 → 3 000 Hz) e dá um salto no estouro. O
     salto é de propósito e não estala: um passa-baixa de um polo com o
     coeficiente mudando de degrau não produz descontinuidade no sinal, só na
     cor dele — que é exatamente o que um clarão faz com o som. */
  return normalizar(
    passaBaixa(b, (t) => 420 + 2600 * Math.pow(Math.min(1, t / corte), 1.5) + (t >= corte ? 2600 : 0)),
    1,
  );
}

/**
 * O AVISO DE QUE DÁ PARA VIRAR SUPER SAIYAJIN.
 *
 * Irmão do `kiCheio` e deliberadamente mais PESADO que ele. O aviso de barra
 * cheia é rotina: acontece várias vezes por partida, e por isso ele é leve, fino
 * e sem grave. Este aparece quando a vida cai abaixo de 30 % (`NAMEK.ssj.gatilho`)
 * durante a luta contra o Freeza — no máximo uma ou duas vezes por partida, e no
 * pior momento dela.
 *
 * A quinta justa ascendente (587 → 880 Hz) contra a terça maior do `kiCheio`
 * (880 → 1 108) é o que separa os dois sem que nenhum precise ser mais alto: a
 * quinta é o intervalo mais aberto que existe fora da oitava, e o ouvido a lê
 * como uma porta larga. A oitava abaixo por baixo dá o peso que a rotina não
 * tem.
 *
 * Ele HERDA A VAGA de `trava` — ver a nota sobre o som da trava de alvo em
 * `_sintetizarMundo`, onde ele é montado.
 */
function avisoDeSSJ(ctx) {
  const b = buffer(ctx, 0.45, (t) => {
    const env = Math.exp(-t * 4.2) * Math.min(1, t / 0.012);
    const f = t < 0.13 ? 587.3 : 880;
    const nota = Math.sin(2 * Math.PI * f * t) * 0.55 + Math.sin(2 * Math.PI * f * 2 * t) * 0.12;
    const peso = Math.sin(2 * Math.PI * (f / 2) * t) * 0.3 * Math.exp(-t * 3);
    return (nota + peso) * env;
  });
  return normalizar(b, 0.6);
}

/* ============================================================== O FREEZA =====
 *
 * Cinco sons, e eles têm de soar como UMA FAMÍLIA que não é a dos jogadores.
 * O pedido do usuário é sobre cor — os poderes dele são roxo-escuro e magenta
 * profundo (`NAMEK.freeza.poderes.*.cor`) — e o ouvido tem de concordar com o
 * olho, senão o boss vira um jogador com outra roupa.
 *
 * ------------------------------------------------------- o que faz "escuro"
 *
 * Duas decisões valem para os cinco, e é a repetição delas que faz família:
 *
 * 1. **O par de √2.** Todo som dele carrega duas senoides na razão 1 : 1,4142.
 *    Os golpes dos jogadores também usam pares desafinados (o Kienzan em
 *    1 : 1,37, a guarda em 620/917) e ali a desafinação existe só para NÃO
 *    virar nota. Aqui ela é uma escolha de intervalo: √2 é o trítono, o único
 *    intervalo que não resolve para lugar nenhum, e o ouvido o lê como ameaça
 *    sem precisar saber o nome dele. É a assinatura da casa.
 * 2. **O corte fecha para BAIXO.** Os sons dos jogadores terminam com piso alto
 *    (o Kienzan em 900 Hz, a queimadura em 1 400) porque energia limpa é
 *    brilhante. Os dele fecham para 200–420 Hz. Mesma energia, sem brilho: é o
 *    que a cor roxo-escura soa.
 *
 * Quatro dos cinco são sintetizados a 24 kHz (ver `TAXA_ESCURA`), e não por
 * economia: é a consequência de terem sido feitos escuros. Nenhum deles tem uma
 * amostra de conteúdo acima de 2 kHz.
 * ========================================================================== */

/**
 * A CHEGADA DO BOSS. Solene — a arena inteira precisa saber.
 *
 * Dois tempos, e o silêncio entre eles é metade do efeito:
 *
 * • 1,25 s de APROXIMAÇÃO — o par de trítono mais um sopro, os dois crescendo
 *   ao expoente 2,2. Não é um som de chegada, é um som de coisa VINDO;
 * • e então o PESO: um sub de 120 → 26 Hz com o ruído por cima, que é o
 *   instante em que ela chega. O corte reabre num sino gaussiano centrado
 *   exatamente na emenda, o que dá o "abre a cortina" sem nenhum evento a mais.
 */
function chegadaDoBoss(ctx) {
  const dur = 2.8;
  const b = buffer(
    ctx,
    dur,
    (t) => {
      const vindo = t < 1.25 ? Math.pow(t / 1.25, 2.2) : 0;
      const par =
        (Math.sin(2 * Math.PI * 126 * t) + Math.sin(2 * Math.PI * 126 * 1.4142 * t) * 0.8) * 0.35 * vindo;
      const sopro = ruido() * 0.55 * vindo;
      let peso = 0;
      if (t >= 1.25) {
        const u = t - 1.25;
        peso =
          Math.sin(2 * Math.PI * (26 + 94 * Math.exp(-u * 2.6)) * u) * Math.exp(-u * 1.15) * 1.1 +
          ruido() * 0.4 * Math.exp(-u * 2.2);
      }
      const env = Math.min(1, t / 0.05) * Math.min(1, (dur - t) / 0.1);
      return (par + sopro + peso) * env;
    },
    TAXA_ESCURA,
  );
  return normalizar(passaBaixa(b, (t) => 180 + 1500 * Math.exp(-Math.pow((t - 1.25) / 0.55, 2))), 1);
}

/**
 * A MIRA DO DEATH BEAM — o dedo apontando, durante os 0,34 s de pose.
 *
 * A pose dele é a mais curta do jogo (0,34 s contra 1,05 do Kamehameha), e é
 * ela que dá ao jogador a chance de sair da frente de um golpe que tira um
 * quarto da vida. Um terço de segundo é pouco para o olho e é MUITO para o
 * ouvido: um som subindo aqui é a diferença entre "levei do nada" e "deu tempo".
 *
 * Sobe e termina em amplitude cheia, como a `cargaDeFeixe` e pelo mesmo motivo:
 * quem dá o fim dela é a agulha.
 */
function miraDaMorte(ctx) {
  const dur = 0.3;
  const b = buffer(ctx, dur, (t) => {
    const k = t / dur;
    const env = Math.min(1, t / 0.006) * Math.pow(k, 0.8) * Math.min(1, (dur - t) / 0.008);
    const f = 240 + 520 * k;
    const par = Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 1.4142 * t) * 0.35;
    return (par + ruido() * 0.15) * env;
  });
  return normalizar(passaBaixa(b, (t) => 900 + 1800 * (t / dur)), 0.8);
}

/**
 * A AGULHA — o Death Beam saindo. 0,26 s, o som mais curto do modo.
 *
 * *"Agulha aguda, curtíssima"*, e as duas palavras brigam com o timbre escuro
 * da família — resolvidas em eixos separados: o ATAQUE é agudo (uma varredura
 * de 3 100 → 300 Hz em cinquenta milissegundos, rápida demais para o ouvido
 * medir a queda; o que ele registra é uma perfuração), e a CAUDA é escura (o
 * par de trítono em 318 Hz, fechando para 420). Agudo na entrada, roxo na
 * saída.
 *
 * O ataque de 0,8 ms é o mais curto do arquivo inteiro — todos os outros usam
 * 1,5 a 3 ms para não estalar. Aqui o estalo é o ponto: é uma agulha.
 */
function agulhaDaMorte(ctx) {
  const b = buffer(ctx, 0.26, (t) => {
    const env = Math.min(1, t / 0.0008) * Math.exp(-t * 22);
    const zip = Math.sin(2 * Math.PI * (300 + 2800 * Math.exp(-t * 60)) * t) * 0.75;
    const cauda =
      (Math.sin(2 * Math.PI * 318 * t) + Math.sin(2 * Math.PI * 318 * 1.4142 * t) * 0.7) *
      0.4 *
      Math.exp(-t * 11);
    return (zip + cauda + ruido() * 0.22) * env;
  });
  return normalizar(passaBaixa(b, (t) => 5200 * Math.exp(-t * 16) + 420), 0.95);
}

/**
 * A DEATH BALL SENDO CARREGADA. 3,35 s, cobrindo os 3,2 s de pose. Solene.
 *
 * É o espelho ESCURO do `genkiCarga`, e as duas foram escritas para serem
 * comparadas — o jogo tem dois golpes que se juntam acima da cabeça de alguém
 * por segundos, e eles não podem soar parecidos:
 *
 * |                 | Genki Dama          | Death Ball            |
 * |-----------------|---------------------|-----------------------|
 * | o sub           | SOBE  (34 → 96 Hz)  | AFUNDA (88 → 31 Hz)   |
 * | o passa-baixa   | ABRE  (300 → 4 500) | FECHA  (2 200 → 320)  |
 * | o tremor        | acelera 3 → 25 Hz   | pesa    4 → 11 Hz     |
 * | o que ela conta | energia CHEGANDO    | massa ADENSANDO       |
 *
 * A Genki Dama é energia emprestada do planeta e vem de fora para dentro, cada
 * vez mais perto e mais clara. Esta é a mesma coisa ao contrário: nada chega,
 * alguma coisa se comprime, e quanto mais ela cresce mais escura ela fica.
 */
function cargaDaMorte(ctx) {
  const dur = 3.35;
  const b = buffer(
    ctx,
    dur,
    (t) => {
      const k = t / dur;
      const cresce = k * k;
      const sub = Math.sin(2 * Math.PI * (31 + 57 * (1 - cresce)) * t) * (0.3 + 0.7 * cresce);
      const par =
        (Math.sin(2 * Math.PI * 212 * t) + Math.sin(2 * Math.PI * 212 * 1.4142 * t) * 0.75) *
        0.3 *
        (0.15 + 0.85 * cresce);
      const tremor = 0.6 + 0.4 * Math.sin(2 * Math.PI * (4 + 7 * cresce) * t);
      const ronco = ruido() * tremor * (0.15 + 0.4 * cresce);
      const env = Math.min(1, t / 0.2) * Math.min(1, (dur - t) / 0.1);
      return (sub + par + ronco) * env;
    },
    TAXA_ESCURA,
  );
  return normalizar(passaBaixa(b, (t) => 320 + 1880 * (1 - t / dur)), 0.95);
}

/**
 * A SUPERNOVA — a Death Ball detonando. Solene, como a Genki Dama.
 *
 * `detonacaoColossal` tem uma estrutura de três tempos que termina numa frente
 * de ar chegando DEPOIS do estouro. Este é o contrário exato, e a inversão é
 * toda a identidade dele: **a sucção vem ANTES.**
 *
 * Trezentos e quarenta milissegundos de ruído subindo em amplitude e em corte
 * antes de existir qualquer estouro — o ar sendo puxado para dentro da esfera.
 * Nenhum outro som do modo começa assim. O efeito é que o golpe soa como uma
 * coisa que se dobra sobre si mesma e só então arrebenta, que é literalmente o
 * que o desenho da esfera faz.
 *
 * Depois disso é um estouro colossal comum em estrutura — sub de 47 → 17 Hz,
 * rolo longo — mas com o corte fechando para 40 Hz em vez de reabrir. A Genki
 * Dama detona ABERTA (o comentário de lá diz por quê: enorme e aberto); esta
 * detona SURDA, e surdo aqui não é defeito, é a cor.
 */
function estouroDaMorte(ctx) {
  const dur = 4.4;
  /** s de sucção antes do estouro. Ver o cabeçalho — é a assinatura do golpe. */
  const IMP = 0.34;
  const b = buffer(
    ctx,
    dur,
    (t) => {
      if (t < IMP) {
        const u = t / IMP;
        return ruido() * Math.pow(u, 2.4) * 0.55 * (0.6 + 0.4 * Math.sin(2 * Math.PI * (9 + 40 * u) * t));
      }
      const u = t - IMP;
      const ataque = Math.min(1, u / 0.003);
      const sub = Math.sin(2 * Math.PI * (17 + 30 * Math.exp(-u * 2.6)) * u) * Math.exp(-u * 1.3) * 1.2;
      const rolo = ruido() * Math.exp(-u * 1.05) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 0.9 * u));
      const par =
        (Math.sin(2 * Math.PI * 96 * u) + Math.sin(2 * Math.PI * 96 * 1.4142 * u) * 0.7) *
        0.3 *
        Math.exp(-u * 2.4);
      return (sub + rolo * 0.85 + par) * ataque;
    },
    TAXA_ESCURA,
  );
  return normalizar(
    passaBaixa(b, (t) => (t < IMP ? 300 + 2600 * (t / IMP) : 40 + 780 * Math.exp(-(t - IMP) * 2.4))),
    1,
  );
}

/**
 * O TELEPORTE — ele deixou de estar ali.
 *
 * Envelope de SINO, sem ataque e sem cauda, e é a coisa toda: todo som de
 * impacto do modo tem um começo duro (alguma coisa bateu em alguma coisa) e uma
 * cauda (o que sobrou). Um teleporte não bate em nada e não deixa nada. Um
 * envelope que sobe e desce simétrico em 340 ms é a forma acústica de um
 * acontecimento sem consequência física — e por isso ele é impossível de
 * confundir com qualquer golpe.
 *
 * O corte varre para cima e volta pelo mesmo sino, o que dá o "vuu" que passa
 * de um lado ao outro sem nunca chegar.
 */
function piscarDoBoss(ctx) {
  const dur = 0.34;
  const b = buffer(ctx, dur, (t) => {
    const sino = Math.sin(Math.PI * (t / dur));
    const par =
      (Math.sin(2 * Math.PI * 430 * t) + Math.sin(2 * Math.PI * 430 * 1.4142 * t) * 0.7) * 0.28;
    return (ruido() * 0.8 + par) * sino * sino;
  });
  return normalizar(passaBaixa(b, (t) => 340 + 3200 * Math.sin(Math.PI * Math.min(1, t / dur))), 0.85);
}

/* ------------------------------------------------------------------ a VOZ ---
 *
 * As duas coisas que faltavam ao boss — a risada e a reação a levar dano — são
 * VOZ, e voz é a coisa que o cabeçalho deste arquivo diz que a síntese faz
 * pior. *"Em Namekusei não existe nada orgânico"* era verdade até o Freeza
 * chegar; ele é a primeira exceção, e vale escrever como ela foi resolvida sem
 * quebrar a regra de não trazer arquivo de áudio.
 *
 * ------------------------------------------------------ o que faz soar vocal
 *
 * Um tom com harmônicos é um instrumento. O que o ouvido usa para dizer
 * "garganta" são três coisas, e nenhuma delas exige uma gravação:
 *
 * 1. **FORMANTE.** Uma vogal não é uma frequência, é uma REGIÃO do espectro que
 *    fica mais alta que as vizinhas — a boca é um tubo que ressoa. Somando os
 *    harmônicos com pesos que fazem um sino em torno de uma frequência
 *    escolhida, o resultado é uma vogal reconhecível: ~600 Hz lê como "ô",
 *    ~900 como "á", ~1 250 como "i" fechado e nasal. É isto que `vogal` faz, e
 *    é o motivo de a síntese ser aditiva aqui e subtrativa em todo o resto do
 *    arquivo (o `passaBaixa` de um polo NÃO ressoa — ver o comentário dele —,
 *    então ele não consegue produzir formante nenhum).
 * 2. **ASPIRAÇÃO.** O "h" de cada "ha": um sopro curtíssimo de ruído antes do
 *    tom. Sem ele os pulsos soam pinçados, como um sintetizador tocando notas;
 *    com ele, cada pulso começa com ar, que é o que uma garganta faz.
 * 3. **JITTER.** Nenhuma prega vocal segura uma frequência exata. Um desvio de
 *    ~1 % andando devagar é a diferença entre "voz" e "oscilador".
 *
 * ------------------------------------------------------------ e o registro
 *
 * Tudo isso em AGUDO. A primeira forma do personagem tem voz fina, e o
 * contraste é deliberado contra a família dos poderes dele, que é toda escura
 * e grave (ver o cabeçalho "O FREEZA"): o que ele ATIRA pesa, o que ele DIZ é
 * fino e desdenhoso. Um boss cuja voz combina com as próprias bombas some
 * dentro delas.
 */

/**
 * Uma vogal, por soma de harmônicos com um formante.
 *
 * `t` é o tempo ABSOLUTO no buffer, e é de propósito: usando o relógio corrido
 * em vez de reiniciar a fase a cada pulso, os harmônicos ficam contínuos e a
 * emenda entre dois "ha" não estala. Quem faz o pulso é o envelope, não a fase.
 *
 * Doze harmônicos: acima disso, com f0 em ~380 Hz, já se passa de 4,5 kHz — e
 * lá em cima não há mais formante nenhum, só brilho que o passa-baixa vai
 * cortar em seguida.
 */
function vogal(t, f0, formante, largura = 520) {
  let s = 0;
  for (let h = 1; h <= 12; h++) {
    const f = f0 * h;
    /* O sino em torno do formante MAIS um piso que cai com o harmônico. O piso
       é o que impede a vogal de virar um assobio quando o formante calha longe
       de todo harmônico — uma garganta real também tem o resto do espectro. */
    const peso = Math.exp(-Math.pow((f - formante) / largura, 2)) + 0.18 / h;
    s += Math.sin(2 * Math.PI * f * t) * peso;
  }
  return s * 0.42;
}

/**
 * A RISADA. Uma sequência de pulsos vocais com envelope próprio.
 *
 * As três variações existem para a risada não virar TEXTURA por repetição, que
 * é o risco inteiro de um som tão marcado: ouvir o mesmo "ha ha ha" oito vezes
 * numa luta transforma o traço mais reconhecível do personagem no som mais
 * cansativo do jogo. Elas não são a mesma risada em três velocidades — cada uma
 * tem outra VOGAL (outro formante), outro número de pulsos e outro contorno de
 * altura, que é o que faz duas risadas seguidas soarem como a mesma pessoa
 * dizendo coisas diferentes:
 *
 * • `0` **"hi hi hi"** — cinco pulsos rápidos, formante fechado e nasal
 *   (1 250 Hz), altura quase parada. É a risadinha de canto de boca, e é a mais
 *   curta porque é a que mais toca;
 * • `1` **"HA ha ha ha"** — o primeiro pulso acentuado e mais alto, os
 *   seguintes descendo. Formante aberto (880 Hz). É a gargalhada de deboche —
 *   a do "isso é tudo?";
 * • `2` **"ho ho ho... hoooo"** — três pulsos graves e espaçados mais uma cauda
 *   longa sustentada. Formante escuro (620 Hz). É a teatral, a de quem tem
 *   tempo, e por isso é a da entrada em campo e a do abate.
 *
 * O contorno de altura desce em todas (`decai` < 1), porque risada que sobe soa
 * como susto; o que muda é quanto.
 */
function risadaDeFreeza(ctx, V) {
  /* Os pulsos são resolvidos ANTES do laço de amostras: são de três a seis
     números, e recalculá-los quarenta e oito mil vezes por segundo para
     descobrir onde começa o "ha" seguinte seria pagar um laço aninhado por um
     dado que não muda. */
  const inicio = [];
  const largura = [];
  const altura = [];
  const ganho = [];
  let t0 = 0;
  let f = V.f0;
  for (let i = 0; i < V.n; i++) {
    const ultimo = i === V.n - 1;
    const larg = ultimo && V.cauda ? V.cauda : V.pulso;
    inicio.push(t0);
    largura.push(larg);
    altura.push(f);
    // O primeiro pulso é mais forte: toda risada começa no ataque e afrouxa.
    ganho.push(i === 0 ? 1 : 0.62 + 0.38 * Math.pow(V.decai, i));
    t0 += (ultimo ? larg : V.passo);
    f *= V.decai;
  }
  /* 140 ms de cauda depois do último pulso, e ela é SILÊNCIO de propósito: é o
     fôlego no fim da risada. Sem ela o buffer termina no instante em que a voz
     para, e uma risada que corta seco no último "ha" soa como um arquivo mal
     recortado — o ouvido espera a respiração que vem depois. */
  const dur = t0 + 0.14;

  /* Índice do pulso corrente, mantido entre chamadas. `buffer` percorre o
     tempo em ordem, então este ponteiro só anda para a frente — a busca do
     pulso custa O(pulsos) no arquivo inteiro, e não O(pulsos) por amostra. */
  let p = 0;
  const b = buffer(ctx, dur, (t) => {
    while (p < V.n - 1 && t >= inicio[p + 1]) p++;
    const u = t - inicio[p];
    if (u < 0 || u > largura[p]) return 0;
    /* Envelope do pulso: 6 ms de ataque e um decaimento calibrado para chegar a
       0,7 % no fim da largura (`exp(-5)`) — assim cada "ha" morre sozinho antes
       do seguinte, em vez de ser cortado. */
    const env = Math.min(1, u / 0.006) * Math.exp((-u * 5) / largura[p]) * ganho[p];
    // Jitter: 1,2 % de desvio andando a 5,7 Hz. Ver o cabeçalho da VOZ.
    const f0 = altura[p] * (1 + 0.012 * Math.sin(2 * Math.PI * 5.7 * t));
    // A aspiração — o "h". Vinte milissegundos de ar na frente de cada pulso.
    const sopro = ruido() * Math.exp(-u * 55) * 0.4;
    return (vogal(t, f0, V.formante) + sopro) * env;
  });
  /* Corte em 3,2 kHz: acima disso a soma dos harmônicos só acrescenta aspereza
     digital. Voz fina precisa de agudo, não de estridência. */
  return normalizar(passaBaixa(b, 3200), 0.95);
}

/**
 * O GRUNHIDO — o boss levando dano.
 *
 * Ele apanhava em SILÊNCIO absoluto: os lutadores têm `dorPropria` e `dor`, e
 * o boss não tinha nada. Um alvo que voa e não reage a ser acertado é um alvo,
 * não um adversário — e é a única peça que faltava para o jogador ter retorno
 * de que está progredindo antes de olhar para a barra.
 *
 * **Não é o grunhido dos lutadores afinado.** Aqueles são pancada com grave
 * (`dor` mora em 60–150 Hz); este é a MESMA GARGANTA da risada, com f0 acima de
 * 400 Hz. É a mesma decisão que recusou reciclar o som da trava de alvo para o
 * aviso de Super Saiyajin: um som carrega quem ele já foi, e o boss não pode
 * grunhir com a voz da vítima.
 *
 * Duas magnitudes, e elas divergem em quatro eixos ao mesmo tempo — volume
 * sozinho leria como distância, não como ter doído mais:
 *
 * |            | leve (bola de ki)      | forte (especial em cheio) |
 * |------------|------------------------|---------------------------|
 * | duração    | 0,2 s                  | 0,55 s                    |
 * | a altura   | 455 → 430 Hz (irritação)| 470 → 250 Hz (a voz cede) |
 * | a vogal    | 1 250 Hz, fechada ("nh")| 900 Hz, aberta ("AH")    |
 * | a aspereza | quase nenhuma          | serrilha de 70 Hz         |
 *
 * O leve é um "nh" de contrariedade — ele não se machucou, ele se INCOMODOU. O
 * forte é a voz descendo uma oitava inteira, que é o que uma garganta faz
 * quando o golpe tira o ar.
 */
function grunhidoDeFreeza(ctx, forte) {
  const dur = forte ? 0.55 : 0.2;
  const b = buffer(ctx, dur, (t) => {
    const k = t / dur;
    const env = Math.min(1, t / 0.005) * Math.exp(-t * (forte ? 5.2 : 14)) * Math.min(1, (dur - t) / 0.02);
    const f0 = forte ? 250 + 220 * Math.exp(-t * 3.4) : 430 + 25 * Math.exp(-t * 9);
    const formante = forte ? 900 + 260 * (1 - k) : 1250;
    /* A ASPEREZA do golpe forte: a vogal mordida por uma serrilha de 70 Hz que
       enfraquece com o tempo. É a mesma ideia da garganta do grito de Super
       Saiyajin (`gritoDeTransformacao`) e o contrário do uso dela lá — lá a
       serrilha acelera porque o esforço cresce, aqui ela afrouxa porque o
       impacto passou. */
    const aspero = forte ? 0.7 + 0.3 * Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 4) : 1;
    const sopro = ruido() * Math.exp(-t * (forte ? 26 : 48)) * (forte ? 0.5 : 0.3);
    return (vogal(t, f0, formante) * aspero + sopro) * env;
  });
  return normalizar(passaBaixa(b, forte ? 2600 : 3400), 0.95);
}

/**
 * A QUEDA DO BOSS — o fim da luta. Solene.
 *
 * O gemido desce de 190 a 22 Hz em dois segundos e meio. A morte de um lutador
 * (`morte`) desce de 210 a 34 Hz em pouco mais de um, e a comparação é o ponto:
 * este vai mais fundo e leva o dobro do tempo. É a diferença entre alguém
 * caindo e a coisa que segurava a partida caindo — e ela é medida em segundos e
 * em hertz, não em volume, porque volume o jogador atribui à distância.
 *
 * Os destroços por cima (ruído ondulado a 1,3 Hz) são o que impede o gemido de
 * soar como um sintetizador desligando.
 */
function quedaDoBoss(ctx) {
  const dur = 2.4;
  const b = buffer(
    ctx,
    dur,
    (t) => {
      const ataque = Math.min(1, t / 0.004);
      const gemido = Math.sin(2 * Math.PI * (22 + 168 * Math.exp(-t * 1.9)) * t) * Math.exp(-t * 1.15);
      const par =
        (Math.sin(2 * Math.PI * 140 * t) + Math.sin(2 * Math.PI * 140 * 1.4142 * t) * 0.6) *
        0.25 *
        Math.exp(-t * 2.6);
      const destrocos = ruido() * 0.45 * Math.exp(-t * 1.5) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.3 * t));
      return (gemido * 1.1 + par + destrocos) * ataque;
    },
    TAXA_ESCURA,
  );
  return normalizar(passaBaixa(b, (t) => 60 + 820 * Math.exp(-t * 1.1)), 1);
}

/* ---------------------------------------------------------------- sistema -- */

export class NamekAudio {
  /**
   * @param {THREE.Camera} camera onde o ouvinte mora
   * @param {THREE.Scene} scene onde as vozes posicionais são penduradas
   */
  constructor(camera, scene) {
    this.scene = scene;
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.destravado = false;
    this.ligado = true;

    /* O TETO. Ver `TETO_LIMIAR` — é o que deixa as explosões subirem sem que a
       soma delas rasgue a saída. Montado no construtor e não no `unlock` porque
       ele é topologia de grafo, não buffer: custa dois nós e nenhum laço. */
    this._montarTeto();

    /* Disparos AGENDADOS (a saída do feixe depois do windup, o arremesso da
       Genki Dama depois da pose). Guardados para o `dispose` e o mudo poderem
       cancelar — ver `_agendar`. */
    this._timers = new Set();

    /* Os buffers são construídos SOB DEMANDA, no `unlock`, e não aqui — e em
     * DUAS LEVAS, que é a parte que precisa de explicação.
     *
     * O banco chegou a quarenta e seis receitas e setenta e três segundos de
     * áudio somados: 12,1 MB de `Float32Array` e ~367 ms de laço, medidos. Um
     * terço de segundo é um congelamento VISÍVEL, e ele cairia exatamente no
     * clique que captura o ponteiro e põe o jogador em campo.
     *
     * A divisão é por QUANDO o som pode ser preciso:
     *
     * • **Leva 1** (`_sintetizar`, 28 receitas, 206 ms) — a briga. Tiro, acerto, especiais,
     *   dor, explosões, os loops. Qualquer um destes pode ser necessário no
     *   primeiro quadro depois do clique, então eles pagam o preço junto com o
     *   gesto, como sempre pagaram.
     * • **Leva 2** (`_sintetizarMundo`, 18 receitas, 165 ms) — o peixe, a chuva de
     *   meteoros, a transformação e o Freeza (inclusive a voz dele). Nenhum destes é possível nos
     *   primeiros quadros: o chefe entra por mensagem da sala, o peixe salta num
     *   relógio próprio, a chuva vem da sala e a transformação exige ter perdido
     *   70 % da vida. Eles esperam um quadro e chegam num tempo em que o jogador
     *   já está voando.
     *
     * O que torna isso seguro é uma invariante que já existia: **buffer que não
     * existe é silêncio, não erro.** `tocar`, `tocarSolene` e `tocarNaCabeca`
     * saem na primeira linha com `!buf`, e um pedido feito no meio do caminho
     * entre as duas levas simplesmente não toca. */
    this.buf = null;
    /** Temporizador da leva 2. Fora do `_timers` de propósito — ver `_segundaLeva`. */
    this._leva = 0;

    this.pool = [];
    this.proxima = 0;

    /** Vozes reservadas dos sons solenes. Ver `VOZES_SOLENES` e `_vozSolene`. */
    this.solenes = [];

    /** Vozes contínuas, uma de cada: carga, feixe e vento. */
    this.loops = new Map();

    /* Vozes fixas da mistura "na cabeça", uma por CANAL. Ver `tocarNaCabeca`:
       um canal reusa sempre o mesmo nó, e retriggar corta o anterior. É o que a
       dor própria quer (dois golpes seguidos são dois golpes, não uma sobreposição
       que vira lama) e é o que impede seis eventos por segundo de criarem seis
       objetos de áudio por segundo. */
    this._canais = new Map();

    /* Cota por lutador na rajada. Com quinze em campo a seis bolas por segundo
       são noventa disparos por segundo; sem cota, o pool inteiro é consumido
       por quem está longe e a sua própria bola fica muda. */
    this._ultimoTiro = new Map();

    /* Cota do acerto no corpo ALHEIO, por vítima. O `HURT` sai a 6 Hz por
       vítima e há até quinze vítimas: sem cota são noventa acertos por segundo
       disputando as catorze vozes, e o pool inteiro vira uma serra elétrica de
       gente apanhando longe enquanto o que acontece perto some. Mesmo número da
       rajada (110 ms) e pelo mesmo motivo: é mais curto que a cadência real de
       um agressor só, então a briga de perto sai inteira. */
    this._ultimoAcerto = new Map();

    /* Cota da dor PRÓPRIA, separada de tudo. Ver `levouDano`. */
    this._ultimaDor = 0;
    this._ultimaDorForte = false;

    /* A VOZ do boss. Os dois relógios começam em −infinito e não em zero: com
       zero, a primeira risada e o primeiro grunhido da partida seriam medidos
       contra um evento que nunca aconteceu e a carência os engoliria nos
       primeiros segundos de aba. Ver `risadaDoFreeza` e `bossLevouDano`. */
    this._ultimaRisada = -Infinity;
    this._ultimoGrunhido = -Infinity;

    /* A trilha de fundo. `setLoop(true)` é o que faz ela recomeçar sozinha ao
       terminar, sem emenda audível — o Web Audio repete o buffer no próprio
       relógio da placa. Fica pendurada no listener e não no mundo: música não
       tem posição. */
    this.musica = new THREE.Audio(this.listener);
    this.musica.setLoop(true);
    this.musica.setVolume(VOLUME_TRILHA);
    // Baixa em paralelo com o resto da partida — falhar ou demorar não pode
    // segurar a entrada em campo. Ver `_carregarTrilha`.
    this._carregarTrilha();
  }

  /**
   * Insere o limitador entre o listener e a saída da placa.
   *
   * O Three liga `listener.gain` direto no `destination` no construtor do
   * `AudioListener`; desligar e religar por dentro é a única forma de pôr
   * qualquer coisa no meio, e é o que o próprio `AudioListener.setFilter` faz
   * (não usamos `setFilter` porque ele só aceita UM nó, e a recuperação de ganho
   * tem de vir DEPOIS do compressor, senão ela entra antes dele e o limitador
   * come de volta exatamente o que ela acabou de dar).
   *
   * Só a mistura DESTE modo passa por aqui: o arqueiro tem o listener dele, e
   * dois listeners no mesmo contexto têm ganhos independentes. Nada em
   * `systems/audio.js` sente esta mudança.
   */
  _montarTeto() {
    const ctx = this.ctx;
    try {
      const teto = ctx.createDynamicsCompressor();
      teto.threshold.value = TETO_LIMIAR;
      teto.ratio.value = TETO_RAZAO;
      teto.knee.value = TETO_JOELHO;
      teto.attack.value = TETO_ATAQUE;
      teto.release.value = TETO_SOLTURA;

      const mestre = ctx.createGain();
      mestre.gain.value = GANHO_MESTRE;

      this.listener.gain.disconnect();
      this.listener.gain.connect(teto);
      teto.connect(mestre);
      mestre.connect(ctx.destination);

      this.teto = teto;
      this.mestre = mestre;
    } catch {
      /* Nenhum navegador atual falha aqui, mas se falhar o jogo continua com o
         grafo original do Three — mais baixo e sujeito a ceifar, e não mudo. É
         a degradação certa: som pior é melhor que som nenhum. */
      this.teto = null;
      this.mestre = null;
    }
  }

  /**
   * Um disparo ADIADO, cancelável.
   *
   * Existe por causa das duas partes de golpe que acontecem depois de uma pose:
   * a saída do feixe (1,05 s de windup) e o arremesso da Genki Dama (5,2 s).
   * As duas chegam a este arquivo pelo `especial()`, que é chamado no INÍCIO da
   * pose — tanto para o meu golpe quanto para o dos outros —, e não existe
   * nenhum outro evento avisando que a pose acabou.
   *
   * O erro de um `setTimeout` aqui é de milissegundos sobre um alvo de segundo,
   * e é inaudível. O que ele NÃO pode fazer é sobreviver ao fim da partida ou ao
   * mudo: por isso o id fica no conjunto e é limpo pelos dois.
   */
  _agendar(atrasoSegundos, fn) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      if (this.ligado && this.buf) fn();
    }, atrasoSegundos * 1000);
    this._timers.add(id);
    return id;
  }

  /** Cancela todos os disparos adiados. Ver `_agendar`. */
  _cancelarAgendados() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
  }

  /**
   * Baixa e decodifica a trilha, e toca se o áudio já estiver destravado.
   *
   * Mesmo padrão do arqueiro (`systems/audio.js`, `_loadMusic`): o download
   * corre à parte, e o `catch` deixa o jogo mudo em vez de quebrar por causa
   * de um mp3 que não chegou.
   */
  async _carregarTrilha() {
    try {
      const resposta = await fetch(trilhaUrl);
      const bytes = await resposta.arrayBuffer();
      this.musica.setBuffer(await this.ctx.decodeAudioData(bytes));
      if (this.destravado && this.ligado && !this.musica.isPlaying) this.musica.play();
    } catch {
      /* sem trilha; o jogo não sente */
    }
  }

  /**
   * Destrava o áudio. **Só funciona dentro de um gesto do usuário.**
   *
   * Todo navegador nasce com o contexto suspenso e só o libera a partir de um
   * clique ou tecla — é regra de plataforma, não preferência. Quem chama isto é
   * o laço, no mesmo tratador que captura o ponteiro.
   */
  unlock() {
    if (this.destravado) return;
    this.destravado = true;
    const começar = () => {
      if (!this.buf) {
        this.buf = this._sintetizar();
        this._segundaLeva();
      }
      if (this.ligado && this.musica.buffer && !this.musica.isPlaying) this.musica.play();
    };
    if (this.ctx.state === "suspended") this.ctx.resume().then(começar).catch(() => {});
    else começar();
  }

  _sintetizar() {
    const c = this.ctx;
    return {
      bola: bolaDeKi(c),
      acerto: acerto(c),
      carga: cargaKi(c),
      feixe: feixe(c),
      disparo: disparoEspecial(c),
      /* As TRÊS partes do Kamehameha (o pedido: *"verifique se o kamehameha tem
         som"*). A carga cobre o windup, o `disparo` acima marca a saída, o
         `feixeVoando` sustenta o feixe alheio e a `queimadura` é o impacto em
         gente — o impacto no chão já era o `rugidoFeixe`. Ver `especial`. */
      cargaFeixe: cargaDeFeixe(c),
      feixeVoando: feixeVoando(c),
      queimadura: queimaduraDeFeixe(c),
      /* Os disparos com TIMBRE PRÓPRIO. Eram três afinações do mesmo `disparo`,
         que é o mesmo som três vezes. Ver cada receita. */
      arremessoEsfera: arremessoDeEsfera(c),
      zunidoDisco: zunidoDeDisco(c),
      arremessoColossal: arremessoColossal(c),
      estouroP: explosao(c, 0.55),
      estouroM: explosao(c, 1.2),
      estouroG: explosao(c, 2.4),
      estouroColossal: detonacaoColossal(c),
      /* Os três impactos com IDENTIDADE — ver `IMPACTO`, logo abaixo do banco. */
      estaloTerra: estaloDeTerra(c),
      talhoDisco: talhoDeDisco(c),
      rugidoFeixe: rugidoDeFeixe(c),
      genkiCarga: genkiCarga(c),
      baque: baque(c),
      onda: ondaDeKi(c),
      trovao: trovao(c),
      vento: ventoDeVoo(c),
      dor: dor(c),
      dorPropria: dorPropria(c),
      guarda: guardaAparada(c),
      morte: morte(c),
      kiCheio: kiCheio(c),
    };
  }

  /**
   * Agenda a LEVA 2 dos buffers. Ver o comentário de `this.buf`, no construtor.
   *
   * Sessenta milissegundos, e não zero: um `setTimeout(0)` volta no mesmo lote
   * de tarefas e o navegador pode não ter pintado nada entre as duas levas — o
   * congelamento continuaria sendo de 367 ms, só que com uma vírgula no meio.
   * Sessenta dão ao menos um quadro inteiro de folga, e nada que a leva 2
   * contém pode acontecer nesse tempo.
   *
   * O temporizador fica FORA do `_timers` de propósito. Aquele conjunto é
   * cancelado por `setLigado(false)`, que é o certo para um disparo de som
   * agendado — mas cancelar a SÍNTESE ao apertar mudo deixaria o jogo sem os
   * buffers para sempre, e quem desmutasse cinco minutos depois teria um mundo
   * sem peixe, sem meteoro e sem chefe. Só o `dispose` mata este.
   */
  _segundaLeva() {
    if (this._leva || !this.buf || this.buf.respingo) return;
    this._leva = setTimeout(() => {
      this._leva = 0;
      /* `this.buf` pode ter sido zerado pelo `dispose` entre o agendamento e
         agora; escrever num objeto morto criaria o banco de volta pela porta
         dos fundos e vazaria os megabytes que o `dispose` acabou de soltar. */
      if (this.buf) Object.assign(this.buf, this._sintetizarMundo());
    }, 60);
  }

  /** A leva 2: o planeta, a transformação e o chefe. Ver `_segundaLeva`. */
  _sintetizarMundo() {
    const c = this.ctx;
    return {
      /* ------------------------------------------------------------ o mundo */
      respingo: respingoDeAgua(c),
      /* Os três tamanhos de rocha da chuva, na mesma escala das classes de
         `NAMEK.planetas.meteoro`: 2,2 m, 5 m e 11 m de raio. Três buffers e não
         um afinado, pelo mesmo motivo dos disparos dos especiais — afinação não
         é timbre, e o que separa um pedrisco de um colosso é ele assobiar ou
         rasgar, não ser mais agudo. */
      assobioP: assobioDeRocha(c, 0.35),
      assobioM: assobioDeRocha(c, 1),
      assobioG: assobioDeRocha(c, 2.2),
      grito: gritoDeTransformacao(c),
      /* HERDA A VAGA DE `trava`.
       *
       * `trava` eram dois cliques secos: o som de travar um alvo com a tecla R.
       * O atalho foi removido a pedido do usuário e o método público
       * (`travou()`) ficou sem nenhum chamador no repositório inteiro.
       *
       * Apagado, e não reaproveitado. Reaproveitar era a tentação óbvia — é um
       * bipe curto e o aviso de Super Saiyajin também é um aviso —, e seria o
       * erro: um som carrega o que ele JÁ significou. Dois cliques seriíssimos
       * de trava de mira anunciando a transformação leriam como interface, e a
       * transformação é a coisa mais consequente que o jogador faz. Ganhou
       * receita própria (`avisoDeSSJ`), e o que fica desta troca é uma linha a
       * menos de síntese, não uma a mais. */
      avisoSSJ: avisoDeSSJ(c),

      /* ------------------------------------------------------------ o Freeza */
      bossChegou: chegadaDoBoss(c),
      miraMorte: miraDaMorte(c),
      agulhaMorte: agulhaDaMorte(c),
      cargaMorte: cargaDaMorte(c),
      estouroMorte: estouroDaMorte(c),
      bossPiscou: piscarDoBoss(c),
      bossCaiu: quedaDoBoss(c),

      /* A VOZ dele. Ver o cabeçalho "a VOZ" e `risadaDeFreeza` para o que cada
         variação diz — elas não são a mesma risada em três velocidades. */
      risada0: risadaDeFreeza(c, { n: 5, f0: 402, pulso: 0.1, passo: 0.126, decai: 0.985, formante: 1250 }),
      risada1: risadaDeFreeza(c, { n: 6, f0: 388, pulso: 0.13, passo: 0.163, decai: 0.955, formante: 880 }),
      risada2: risadaDeFreeza(c, {
        n: 4,
        f0: 352,
        pulso: 0.155,
        passo: 0.205,
        decai: 0.94,
        formante: 620,
        /** s — o último pulso é sustentado. É o que faz esta ser a teatral. */
        cauda: 0.62,
      }),
      grunhidoLeve: grunhidoDeFreeza(c, false),
      grunhidoForte: grunhidoDeFreeza(c, true),
    };
  }

  /**
   * Uma voz do pool geral, respeitando PRIORIDADE.
   *
   * A regra antiga era só "rouba a mais antiga", e ela tinha um defeito que só
   * apareceu quando os sons ficaram longos: uma explosão grande ocupa a voz por
   * 2 a 4 segundos, e nesse intervalo passam dezenas de bolas de ki. Como a
   * explosão era sempre a mais antiga das que ainda tocavam, ela era a PRIMEIRA
   * a ser roubada — a bomba sumia no meio para dar lugar a um tiro. Era mais uma
   * peça do "as explosões estão baixas": parte delas nem chegava ao fim.
   *
   * Agora a escolha é, em ordem:
   *
   * 1. uma voz LIVRE (nenhum som é interrompido — o caso comum);
   * 2. criar mais uma, até `VOZES`;
   * 3. a voz de MENOR prioridade em curso; entre iguais, a mais antiga;
   * 4. se até a candidata mais fraca for mais importante que o pedido, o pedido
   *    NÃO TOCA. Engolir um tiro para não cortar uma bomba é a troca certa: o
   *    tiro sai de novo em 167 ms, a bomba não.
   *
   * @param {number} prio 0 tiro/acerto, 1 estalo, 2 golpe especial, 3 bomba
   */
  _voz(prio = 0) {
    for (const v of this.pool) if (!v.a.isPlaying) return v;
    if (this.pool.length < VOZES) {
      const a = new THREE.PositionalAudio(this.listener);
      a.setDistanceModel("inverse");
      const suporte = new THREE.Object3D();
      suporte.add(a);
      /* A curva de distância NÃO é fixada aqui: ela é escrita a cada disparo,
         por classe de som (ver `_aplicarPerfil` e `PERFIS`). Uma voz reciclada
         serve ora um tiro, ora uma bomba, e as duas precisam de réguas
         diferentes de alcance. */
      const v = { a, suporte, usada: 0, prio: -1 };
      this.pool.push(v);
      return v;
    }
    let alvo = this.pool[0];
    for (const v of this.pool) {
      if (v.prio < alvo.prio || (v.prio === alvo.prio && v.usada < alvo.usada)) alvo = v;
    }
    return alvo.prio > prio ? null : alvo;
  }

  /**
   * Escreve no panner a curva de distância da CLASSE do som.
   *
   * Ver `PERFIS`, que é onde as quatro curvas e a conta de cada uma estão. Aqui
   * só sobra o cuidado de sempre reescrever os três campos: uma voz reciclada
   * carrega a régua do som anterior, e uma bomba tocada com a régua de um tiro é
   * exatamente o defeito que este bloco existe para consertar.
   */
  _aplicarPerfil(v, classe) {
    const P = PERFIS[classe] ?? PERFIS.corpo;
    v.a.setRefDistance(P.ref);
    v.a.setRolloffFactor(P.queda);
    v.a.setMaxDistance(P.max);
    return P;
  }

  /**
   * Uma voz RESERVADA, que o pool geral não pode tocar.
   *
   * A regra de roubo aqui é o oposto da do pool: lá se rouba a mais antiga
   * porque o evento novo é o que interessa; aqui só se rouba uma voz que já
   * TERMINOU, e se todas as três estiverem soando o pedido novo simplesmente não
   * toca. É deliberado — cortar uma Genki Dama pela metade para começar outra
   * entrega duas informações truncadas em vez de uma inteira, e a informação
   * inteira ("alguém está juntando a bola grande") é a que muda o que o jogador
   * vai fazer nos próximos três segundos.
   */
  _vozSolene() {
    for (const v of this.solenes) if (!v.a.isPlaying) return v;
    if (this.solenes.length < VOZES_SOLENES) {
      const a = new THREE.PositionalAudio(this.listener);
      /* Outra curva de distância, e é ela que faz "solene" significar alguma
         coisa. Referência de 70 m (contra 9 m) e queda de 0,55 (contra 1,4): a
         900 m — o outro lado da arena — ainda sobra cerca de 13% do ganho, que é
         pouco mas é audível, e é exatamente o que um aviso de arena tem de ser.
         Com a curva do pool geral, o mesmo som a 900 m seria zero absoluto. */
      a.setRefDistance(70);
      a.setRolloffFactor(0.55);
      a.setMaxDistance(ALCANCE_SOLENE);
      a.setDistanceModel("inverse");
      const suporte = new THREE.Object3D();
      suporte.add(a);
      const v = { a, suporte };
      this.solenes.push(v);
      return v;
    }
    return null;
  }

  /**
   * Toca um som SOLENE: posicional, voz reservada, alcance de arena.
   *
   * Ver o item 3 do cabeçalho. Só os acontecimentos que a partida inteira tem
   * direito de saber entram aqui, e por enquanto eles são dois: a Genki Dama
   * sendo juntada e a Genki Dama detonando.
   */
  tocarSolene(buf, p, vol = 1, taxa = 1) {
    if (!this.ligado || !this.buf || !buf) return;
    const l = this.listener;
    const dx = p.x - l.parent.position.x;
    const dy = p.y - l.parent.position.y;
    const dz = p.z - l.parent.position.z;
    if (dx * dx + dy * dy + dz * dz > ALCANCE_SOLENE * ALCANCE_SOLENE) return;

    const v = this._vozSolene();
    if (!v) return;
    v.suporte.position.set(p.x, p.y, p.z);
    if (!v.suporte.parent) this.scene.add(v.suporte);
    v.a.setBuffer(buf);
    v.a.setVolume(vol);
    v.a.setPlaybackRate(taxa);
    v.a.play();
  }

  /**
   * Toca um som NO MUNDO.
   *
   * @param {AudioBuffer} buf
   * @param {{x,y,z}} p onde
   * @param {number} vol
   * @param {number} taxa afinação — varia o som para o mesmo evento não repetir
   * @param {"corpo"|"estalo"|"medio"|"grande"} [classe] a régua de ALCANCE.
   *   Ver `PERFIS`: é ela que decide de quantos metros o som ainda se ouve, e
   *   errar nela é o que fazia bomba a 60 m soar vinte decibéis abaixo do tiro
   *   que a gente dispara colado no ouvido.
   * @param {number} [prio] quem pode roubar a voz de quem. Ver `_voz`.
   */
  tocar(buf, p, vol = 1, taxa = 1, classe = "corpo", prio = 0) {
    if (!this.ligado || !this.buf || !buf) return;
    /* Longe demais: nem cria a voz. O `maxDistance` do panner já silenciaria,
       mas silenciar depois de alocar continua consumindo a vaga que o som de
       perto precisa. O corte é o da CLASSE, não mais um 240 m para todos: com o
       teto único, uma cratera de Genki Dama a 300 m era descartada aqui antes
       mesmo de o panner ter a chance de tocá-la baixinho. */
    const P = PERFIS[classe] ?? PERFIS.corpo;
    const l = this.listener;
    const dx = p.x - l.parent.position.x;
    const dy = p.y - l.parent.position.y;
    const dz = p.z - l.parent.position.z;
    if (dx * dx + dy * dy + dz * dz > P.max * P.max) return;

    const v = this._voz(prio);
    /* Sem voz: o pedido era mais fraco do que tudo o que está tocando. Ver
       `_voz` — engolir um tiro para não cortar uma bomba é deliberado. */
    if (!v) return;
    if (v.a.isPlaying) v.a.stop();
    v.usada = this.ctx.currentTime;
    v.prio = prio;
    this._aplicarPerfil(v, classe);
    v.suporte.position.set(p.x, p.y, p.z);
    if (!v.suporte.parent) this.scene.add(v.suporte);
    v.a.setBuffer(buf);
    v.a.setVolume(vol);
    v.a.setPlaybackRate(taxa);
    v.a.play();
  }

  /**
   * Toca sem posição — o que acontece em VOCÊ, não no mundo.
   *
   * Sem panner, sem atenuação por distância e sem disputar o pool: é a mistura 2
   * do cabeçalho. Ver `kiCheio` (o aviso), `trava` (a mira) e, principalmente,
   * `levouDano` (a dor própria).
   *
   * @param {string} [canal] quando dado, reusa SEMPRE o mesmo nó para este
   *   canal e o retrigga cortando o anterior. Sem canal, a voz é descartável.
   */
  tocarNaCabeca(buf, vol = 1, taxa = 1, canal = null) {
    if (!this.ligado || !this.buf || !buf) return;
    if (canal) {
      let a = this._canais.get(canal);
      if (!a) {
        a = new THREE.Audio(this.listener);
        this._canais.set(canal, a);
      }
      /* Cortar o anterior é o comportamento CERTO aqui, não um efeito colateral:
         dois golpes em cento e cinquenta milissegundos são dois golpes, e deixar
         o primeiro tocando por baixo do segundo empasta os dois numa massa em que
         não se conta mais quantos foram. */
      if (a.isPlaying) a.stop();
      a.setBuffer(buf);
      a.setVolume(vol);
      a.setPlaybackRate(taxa);
      a.play();
      return;
    }
    const a = new THREE.Audio(this.listener);
    a.setBuffer(buf);
    a.setVolume(vol);
    a.setPlaybackRate(taxa);
    a.play();
    /* Voz descartável, e ela se justifica para os sons RAROS (encher o ki,
       travar um alvo): um canal fixo para eles ficaria ocioso o jogo inteiro. O
       `onEnded` do Three já solta o nó de origem. */
  }

  /**
   * Liga ou desliga um som CONTÍNUO (carga, feixe, vento).
   *
   * O ganho sobe e desce em rampa e não em degrau: um loop que começa no volume
   * cheio dá um estalo, e um que para de uma vez dá outro. Sessenta
   * milissegundos são inaudíveis como fade e resolvem os dois.
   */
  loop(id, ligado, vol = 0.5, taxa = 1) {
    if (!this.buf) return;
    let L = this.loops.get(id);
    if (!L) {
      if (!ligado) return;
      const a = new THREE.Audio(this.listener);
      a.setBuffer(this.buf[id]);
      a.setLoop(true);
      a.setVolume(0);
      L = { a, alvo: 0 };
      this.loops.set(id, L);
    }
    L.alvo = ligado && this.ligado ? vol : 0;
    L.a.setPlaybackRate(taxa);
    if (ligado && !L.a.isPlaying) L.a.play();
    const g = L.a.gain.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(L.alvo, this.ctx.currentTime, 0.06);
    if (!ligado) {
      /* Parar de verdade só depois da rampa. Um `stop()` imediato cortaria o
         fade que acabamos de agendar, e o estalo voltaria pela porta dos
         fundos. */
      clearTimeout(L.timer);
      L.timer = setTimeout(() => {
        if (L.alvo === 0 && L.a.isPlaying) L.a.stop();
      }, 220);
    }
    return L;
  }

  /* ------------------------------------------------------------- eventos --- */

  /** Rajada de ki. `dono` é quem atirou — a cota por lutador vive nele. */
  rajada(p, dono) {
    if (!this.buf) return;
    const agora = this.ctx.currentTime;
    /* Uma bola por lutador a cada 110 ms. A cadência real é 6/s (167 ms), então
       a SUA rajada sai inteira; o que a cota corta é a soma de catorze pessoas
       atirando ao mesmo tempo. */
    if (agora - (this._ultimoTiro.get(dono) ?? 0) < 0.11) return;
    this._ultimoTiro.set(dono, agora);
    /* Afinação sorteada: a mesma amostra noventa vezes por segundo vira
       metralhadora.
       ---------------------------------------------------------- o volume
       0,55 e classe `corpo`, os dois inalterados — e isso é o pedido, não
       esquecimento. *"A explosão de um poder GRANDE tem de ser audível de longe;
       a rajada, não."* Tudo em volta subiu de 5 a 20 dB; deixar o tiro onde
       estava é o que transforma esse trabalho todo em CONTRASTE em vez de
       "tudo mais alto". */
    this.tocar(this.buf.bola, p, 0.55, 0.9 + Math.random() * 0.25, "corpo", 0);
  }

  /**
   * O acerto no corpo dos OUTROS.
   *
   * @param {{x,y,z}} p onde o corpo está
   * @param {boolean} forte golpe pesado
   * @param {*} [vitima] chave da cota. Quando `game.js` passa o id de quem
   *   apanhou, a cota é por vítima — a briga de perto sai inteira e o que é
   *   cortado é a soma de catorze brigas simultâneas. Sem o id, a cota vira
   *   global e fica mais dura, porque aí não há como saber se dois acertos
   *   seguidos são a mesma briga ou duas.
   */
  acertoNoCorpo(p, forte = false, vitima = undefined) {
    if (!this.buf) return;
    const agora = this.ctx.currentTime;
    const chave = vitima ?? "*";
    const janela = vitima === undefined ? 0.055 : 0.11;
    if (agora - (this._ultimoAcerto.get(chave) ?? 0) < janela) return;
    this._ultimoAcerto.set(chave, agora);
    /* VOLUME: 0,5 → 1,05 (fraco) e 0,8 → 1,55 (forte). São +6,4 dB e +5,7 dB,
       e eles são a metade fácil do pedido *"o som de explosão quando os poderes
       pegam no adversário está muito baixo"*. A outra metade — a que valia mais
       — é a classe: o acerto acontece NO OUTRO, e o outro está a sessenta metros
       quando você acerta. Ver `PERFIS`.
       A classe continua `corpo` (o acerto é briga, não bomba: quem está a 200 m
       não tem nada a aprender com ele), mas a referência de 9 para 12 m já
       devolve os primeiros decibéis. Prioridade 0: um acerto pode ser roubado
       por qualquer coisa maior, e sai de novo em 110 ms. */
    this.tocar(
      this.buf.acerto,
      p,
      forte ? 1.55 : 1.05,
      forte ? 0.8 : 1 + Math.random() * 0.2,
      "corpo",
      0,
    );
  }

  /**
   * O especial COMEÇANDO. Chamado no primeiro quadro da pose, meu ou alheio.
   *
   * -------------------------------------------------------- o que havia aqui
   *
   * Um `disparoEspecial` com três afinações (0,85 Galick, 1,35 Kienzan, 1
   * Kamehameha) e a Genki Dama à parte. Dois defeitos, e os dois eram o pedido:
   *
   * • **timbre.** Afinação não é timbre. Três golpes que fazem coisas
   *   completamente diferentes — um tubo de pressão, uma esfera arremessada e um
   *   disco de corte — saíam do mesmo buffer, e o ouvido não tinha como saber o
   *   que estava vindo na direção dele.
   * • **tempo.** Este método é chamado no INÍCIO da pose, e ele tocava o som de
   *   SAÍDA. O Kamehameha tem 1,05 s de windup: o estampido saía um segundo
   *   inteiro antes do feixe existir, e o feixe nascia mudo.
   *
   * ------------------------------------------------------------- o que faz hoje
   *
   * Cada golpe tem a linha do tempo dele escrita aqui, lida do `NAMEK.specials`
   * (nunca de um número repetido) e agendada com `_agendar`:
   *
   *   Kamehameha  carga (agora) → disparo (windup) → feixe aceso (windup)
   *   Genki Dama  carga (agora) → arremesso (windup)
   *   Galick Gun  arremesso (agora)
   *   Kienzan     zunido (agora)
   *
   * A Genki Dama continua na mistura solene, com voz reservada e alcance de
   * arena, porque o aviso de que alguém apostou a barra inteira é para todo
   * mundo — e agora as três partes dela vão juntas por lá.
   *
   * @param {{x,y,z}} p de onde o golpe sai (o peito de quem atirou)
   * @param {string} kind chave de `NAMEK.specials`
   * @param {boolean} [meu] o golpe é do jogador local. Só muda uma coisa: a
   *   sustentação do MEU feixe vem do `loop("feixe")` de `update()`, e tocar
   *   também a versão posicional seria o mesmo rugido duas vezes.
   */
  especial(p, kind, meu = false) {
    if (!this.buf) return;
    const S = NAMEK.specials[kind];
    /* O windup é a régua de TODO agendamento daqui. Ler do config em vez de
       repetir o número é o que faz o som acompanhar quem mexer no golpe — a
       mesma disciplina que `genkiCarga` já pedia no comentário dela. */
    const windup = S?.windup ?? NAMEK.freeza?.poderes?.[kind]?.windup ?? 0;
    /* CÓPIA do ponto, e ela não é paranoia barata: o agendamento da Genki Dama
       segura este objeto por 5,2 s, e basta um dia alguém passar aqui um vetor
       reaproveitado (o padrão deste projeto inteiro, para não alocar por quadro)
       para o arremesso tocar onde o lutador estiver CINCO SEGUNDOS depois. Um
       literal por especial disparado é grátis; o especial sai uma vez a cada
       barra cheia, não sessenta vezes por segundo. */
    const onde = { x: p.x, y: p.y, z: p.z };

    if (kind === "genki") {
      /* 1) A CARGA, 5,4 s cobrindo os 5,2 s da pose. Já existia. */
      this.tocarSolene(this.buf.genkiCarga, onde, 1.05);
      /* 2) O ARREMESSO, que NÃO existia: a maior coisa do modo era juntada com
         som de arena e atirada em silêncio. Ver `arremessoColossal`. */
      this._agendar(windup, () => this.tocarSolene(this.buf.arremessoColossal, onde, 1.15));
      /* 3) A detonação já é `estouroNoChao`/`detonouNoAr` com `kind: "genki"`. */
      return;
    }

    if (kind === "kamehameha") {
      /* -------------------------------------------------- AS TRÊS PARTES
       *
       * O pedido foi *"verifique se o kamehameha tem som"*, e a resposta era
       * "um terço": existia só o estampido de saída, tocado na hora ERRADA (no
       * começo do windup, porque é aí que `especial` é chamado). O windup
       * inteiro e o feixe aceso eram silêncio.
       *
       * 1. CARGA — agora, durante os 1,05 s da pose. Posicional e de classe
       *    `medio`: a pose é o aviso que dá ao adversário a chance de sair da
       *    frente, e um aviso que só se ouve a doze metros não avisa ninguém. */
      this.tocar(this.buf.cargaFeixe, onde, 0.85, 1, "medio", 2);
      /* 2. DISPARO — no fim do windup, que é quando o feixe realmente nasce
       *    (ver `beam.js`: o tubo só aparece depois de `S.windup`). Antes o
       *    estampido saía 1,05 s ANTES do feixe, e o jogador ouvia o golpe sair
       *    enquanto ainda estava carregando. */
      this._agendar(windup, () => this.tocar(this.buf.disparo, onde, 1.15, 1, "grande", 3));
      /* 3. SUSTENTAÇÃO. Duas casas, e a divisão é a mesma das três misturas do
       *    cabeçalho: o MEU feixe sustenta pelo `loop("feixe")` de `update()`,
       *    sem posição, porque ele sai da minha mão e não tem distância; o feixe
       *    dos OUTROS não tem estado nenhum aqui que diga quando acende e apaga,
       *    e por isso sai como um disparo posicional do tamanho exato da vida
       *    dele (ver `feixeVoando`). Sem esta linha, o tubo de treze metros que
       *    atravessa a tela vindo do outro lutador era completamente mudo.
       *
       *    O ponto é a BOCA do feixe (o peito de quem atirou, congelado no
       *    disparo), e não a cabeça que corre a 340 m/s. É o certo: a boca é
       *    onde o rugido nasce e é o que fica parado durante a sustentação
       *    inteira; seguir a cabeça faria o som atravessar o mapa em dois
       *    segundos e sumir, quando o que o jogador precisa localizar é DE ONDE
       *    o feixe está vindo. */
      if (!meu) {
        this._agendar(windup, () => this.tocar(this.buf.feixeVoando, onde, 0.95, 1, "grande", 3));
      }
      return;
    }

    /* ----------------------------------------------------- OS DOIS DO BOSS
     *
     * Eles entram por AQUI e não por um método próprio, e isso é de graça: o
     * `NamekBoss` já chama `especial(origem, msg.kind)` com as chaves de
     * `NAMEK.freeza.poderes`, exatamente como o jogo chama com as chaves de
     * `NAMEK.specials`. Um golpe é um golpe; o que muda é a família de timbre,
     * e a família mora nas receitas (ver o cabeçalho "O FREEZA"). */
    if (kind === "raioDaMorte") {
      /* A pose inteira dele são 0,34 s. A mira sobe durante ela e a agulha
         entra no fim — as mesmas duas partes do Kamehameha, comprimidas oito
         vezes, que é literalmente a diferença entre os dois golpes. */
      this.tocar(this.buf.miraMorte, onde, 0.8, 1, "medio", 2);
      this._agendar(windup, () => this.tocar(this.buf.agulhaMorte, onde, 1.25, 0.96 + Math.random() * 0.1, "medio", 2));
      return;
    }
    if (kind === "esferaDaMorte") {
      /* 3,2 s de pose, solene como a Genki Dama: são os dois golpes do jogo que
         matam um grupo inteiro, e os dois avisam a arena antes. Ver
         `cargaDaMorte` para a tabela que os separa timbre a timbre. */
      this.tocarSolene(this.buf.cargaMorte, onde, 1.05);
      /* Ela SAI da mão (o `sustain` de 22 s é a vida do projétil, não uma
         sustentação), então o arremesso colossal também serve aqui — o peso
         deixando a mão é o mesmo gesto. O que não se repete é a detonação: essa
         é `estouroMorte`, e é dela a assinatura. */
      this._agendar(windup, () => this.tocarSolene(this.buf.arremessoColossal, onde, 1.1));
      return;
    }

    /* Os dois que SAEM DA MÃO e voam sozinhos. Cada um com o timbre dele — ver
       `arremessoDeEsfera` e `zunidoDeDisco` para o porquê de não ser mais o
       mesmo buffer com três afinações.
       CLASSE: o Galick é bomba (`grande`, ouve-se de trezentos metros); o
       Kienzan é lâmina (`medio`) — ele corta, não estoura, e um zunido metálico
       audível da arena inteira viraria mosquito. */
    if (kind === "galick") {
      this.tocar(this.buf.arremessoEsfera, onde, 1.2, 0.94 + Math.random() * 0.12, "grande", 3);
      return;
    }
    if (kind === "disk") {
      this.tocar(this.buf.zunidoDisco, onde, 1.0, 0.94 + Math.random() * 0.14, "medio", 2);
      return;
    }
    /* Um `kind` que este arquivo não conhece ainda: o disparo genérico. É o
       caminho de quando alguém acrescentar o quinto especial e esquecer daqui —
       melhor um som errado do que um golpe mudo. */
    this.tocar(this.buf.disparo, onde, 1.15, 1, "medio", 2);
  }

  /**
   * O FEIXE QUEIMANDO UM CORPO — o impacto que faltava no Kamehameha.
   *
   * `ev.queimando` é o canal por onde TODO especial cobra vida (ver
   * `powers/index.js`), e ele ia inteiro para a rede sem produzir um único som
   * na ponta de quem atirou. O retorno vinha, se viesse, como o `acerto`
   * genérico do `HURT` da vítima: o mesmo "toc" de uma bolinha de ki para um
   * feixe que está torrando alguém há dois segundos.
   *
   * A cota é a mesma ideia do `acertoNoCorpo` e por um motivo mais forte: o
   * feixe despeja a exposição acumulada a cada aviso (ver `despejar`, em
   * `beam.js`), e um feixe apoiado em três pessoas dispara três eventos no mesmo
   * quadro. Sem cota, seriam três chiados idênticos sobrepostos — que não somam
   * informação, somam lama.
   *
   * O Galick Gun e a Genki Dama também passam por `queimando`, e para eles isto
   * NÃO toca: os dois DETONAM no mesmo instante em que cobram vida, e a
   * detonação já é o som (`detonouNoAr`). Dois sons para um acontecimento é o
   * caminho da papa.
   *
   * @param {{x,y,z}} p onde a vítima está
   * @param {string} kind o golpe que está queimando
   * @param {*} [vitima] chave da cota, por corpo queimado
   */
  queimouAlguem(p, kind, vitima = undefined) {
    if (!this.buf || !p) return;
    const agora = this.ctx.currentTime;
    const chave = `q${vitima ?? "*"}`;
    /* 160 ms. Mais folgado que os 110 do acerto porque a queimadura é um som
       LONGO (0,55 s): repetir a cada 110 ms empilharia cinco cópias tocando ao
       mesmo tempo, e cinco chiados somados são um chiado só, mais alto. */
    if (agora - (this._ultimoAcerto.get(chave) ?? 0) < 0.16) return;
    this._ultimoAcerto.set(chave, agora);

    if (kind === "kamehameha") {
      this.tocar(this.buf.queimadura, p, 1.15, 0.95 + Math.random() * 0.12, "medio", 2);
      return;
    }
    if (kind === "disk") {
      /* O disco no corpo é o MESMO gume do disco na terra, mais agudo e sem a
         mordida grave da terra cedendo — daí o mesmo buffer afinado para cima e
         um degrau mais baixo. Timbre próprio sem uma receita a mais. */
      this.tocar(this.buf.talhoDisco, p, 1.2, 1.18 + Math.random() * 0.1, "medio", 2);
      return;
    }
    if (kind === "raioDaMorte") {
      /* O Death Beam queimando alguém. A queimadura do Kamehameha afinada uma
         quinta abaixo (0,66) fica escura e perde o chiado agudo — vira o cheiro
         de furo, que é o que um raio de 0,95 m de raio faz num corpo. A família
         do boss inteira se separa da dos jogadores pelo mesmo eixo: mesma
         física, sem brilho. */
      this.tocar(this.buf.queimadura, p, 1.1, 0.66, "medio", 2);
    }
  }

  /**
   * Impacto no chão. **Quem escolhe o som é o GOLPE, não a potência.**
   *
   * ------------------------------------------------------------------ o defeito
   *
   * A escolha era por `power`, em faixas — e `power` não é "o tamanho do golpe",
   * é *"quanto de cratera ele abre"*. As duas coisas andaram juntas por um tempo
   * e deixaram de andar no dia em que o Kamehameha passou a cavar um buraco
   * ESTREITO e fundo: a potência dele caiu de 4,2 para 0,58 (ver `craterDeep`),
   * e com ela o golpe que enche a tela passou a soar exatamente como uma bolinha
   * de ki — mesma faixa, mesmo buffer, mesmo volume.
   *
   * O pedido fecha a questão: *"cada poder deve ter o som adequado a ele"*. A
   * régua certa é a IDENTIDADE, e ela vem no evento (`kind`).
   *
   * -------------------------------------------------------------- as identidades
   *
   * Três dos cinco ganharam receita própria, e cada uma existe porque o golpe
   * faz uma coisa que ruído-com-cauda não descreve:
   *
   * • a RAJADA estala (0,3 s). Curto porque ela sai seis vezes por segundo, e
   *   seis explosões com cauda por segundo viram um ronco só;
   * • o KIENZAN talha — tem gume, e gume é um zumbido metálico, não um estouro;
   * • o KAMEHAMEHA ruge, e é o único impacto SUSTENTADO do jogo: ele fica
   *   apoiado no chão por até 2,4 s, cavando.
   *
   * O Galick Gun e a Genki Dama continuam com os estouros do banco, e é o certo:
   * os dois são esferas que detonam, que é exatamente o que aquelas receitas
   * descrevem. O que muda para eles é só o volume ESPAÇADO — como toda receita
   * sai normalizada no mesmo pico, "maior" não vem de tocar acima do máximo, vem
   * de tocar os menores mais baixo.
   *
   * `power` continua entrando, e continua sendo útil: ele é o caminho de trás
   * para quem chega sem `kind` (a cratera que volta pela rede, o baque de queda).
   *
   * @param {string} [kind] o id do golpe em `NAMEK.specials`, ou `"blast"`
   */
  estouroNoChao(p, power, kind) {
    if (!this.buf) return;
    const r = this._receitaDeImpacto(power, kind);
    if (r.solene) this.tocarSolene(this.buf[r.buf], p, r.vol, r.taxa());
    else this.tocar(this.buf[r.buf], p, r.vol, r.taxa(), r.classe, r.prio);
  }

  /**
   * A tabela de impacto: golpe → receita, com o caminho de trás por potência.
   *
   * Separada de `estouroNoChao` porque a detonação NO AR usa a mesma escolha com
   * outro tempero (ver `detonouNoAr`), e duas tabelas seriam duas listas de cinco
   * golpes envelhecendo em metades.
   */
  _receitaDeImpacto(power, kind) {
    switch (kind) {
      case "blast":
        return {
          buf: "estaloTerra",
          vol: 1.2,
          classe: "estalo",
          prio: 1,
          taxa: () => 0.92 + Math.random() * 0.22,
        };
      case "disk":
        return {
          buf: "talhoDisco",
          vol: 1.45,
          classe: "medio",
          prio: 2,
          taxa: () => 0.94 + Math.random() * 0.14,
        };
      case "kamehameha":
        return {
          buf: "rugidoFeixe",
          vol: 1.7,
          classe: "grande",
          prio: 3,
          taxa: () => 0.97 + Math.random() * 0.08,
        };
      case "galick":
        return {
          buf: "estouroG",
          vol: 1.7,
          classe: "grande",
          prio: 3,
          taxa: () => 0.88 + Math.random() * 0.14,
        };
      case "genki":
        return {
          buf: "estouroColossal",
          vol: 1.9,
          solene: true,
          taxa: () => 0.97 + Math.random() * 0.06,
        };
      /* ------------------------------------------------------ os dois do boss.
         A Death Ball é a Genki Dama dele em tudo — mesmo papel, mesma escala de
         cratera (as duas batem no teto de `craterMax`), mesma mistura solene —
         e por isso ela precisava do próprio estouro: duas bombas de fim de
         partida com o MESMO som seriam a maior confusão possível justamente no
         instante em que o jogador precisa saber de quem foi. Ver `estouroDaMorte`. */
      case "esferaDaMorte":
        return {
          buf: "estouroMorte",
          vol: 1.9,
          solene: true,
          taxa: () => 0.97 + Math.random() * 0.06,
        };
      /* O Death Beam FURA (`power` 0,2 e `craterDeep` 3): ele não abre buraco,
         abre poço. O `estaloTerra` é o estouro mais curto e mais seco do banco e
         é o que mais se parece com uma perfuração — afinado para baixo, ele
         perde o "tec" de torrão de terra voando e fica com o soco surdo do
         fundo, que é o que a família escura pede. */
      case "raioDaMorte":
        return {
          buf: "estaloTerra",
          vol: 1.3,
          classe: "medio",
          prio: 2,
          taxa: () => 0.68 + Math.random() * 0.1,
        };
      default:
        break;
    }
    /* SEM `kind`: a escala de potência de sempre. É o caminho de quem chega pela
       rede sem a identidade do golpe — a cratera dos outros e o baque de queda.
       A CLASSE acompanha a potência, porque aqui ela é a única pista de tamanho
       que existe: um buraco de potência 16 é uma bomba e se ouve da arena, um de
       potência 1 é um torrão de terra e morre em duzentos metros. */
    if (power >= 16) {
      return {
        buf: "estouroColossal",
        vol: 1.9,
        solene: true,
        taxa: () => 0.97 + Math.random() * 0.06,
      };
    }
    if (power >= 5) {
      return { buf: "estouroG", vol: 1.55, classe: "grande", prio: 3, taxa: () => 0.9 + Math.random() * 0.2 };
    }
    if (power >= 2) {
      return { buf: "estouroM", vol: 1.3, classe: "medio", prio: 2, taxa: () => 0.9 + Math.random() * 0.2 };
    }
    return { buf: "estouroP", vol: 1.0, classe: "estalo", prio: 1, taxa: () => 0.9 + Math.random() * 0.2 };
  }

  /**
   * A DETONAÇÃO NO AR — o estouro que não abre cratera nenhuma.
   *
   * `estouroNoChao` só toca quando o golpe encosta no terreno, e a Genki Dama
   * passa boa parte da vida detonando a duzentos metros de altura, em cima de um
   * lutador. Sem isto, a maior explosão do jogo é MUDA justamente quando ela
   * acerta o que devia acertar — um jogador. Mesma escala de potência do chão,
   * de propósito: a mesma bomba não pode ter dois tamanhos conforme o que ela
   * encontrou pela frente.
   *
   * @param {{x,y,z}} p onde ela abriu
   * @param {number} power a potência do golpe (`NAMEK.specials[kind].power`)
   */
  detonouNoAr(p, power, kind) {
    if (!this.buf) return;
    const r = this._receitaDeImpacto(power, kind);
    if (r.solene) {
      this.tocarSolene(this.buf[r.buf], p, r.vol, r.taxa());
      return;
    }
    /* No ar não há terreno para devolver o grave, então o mesmo golpe sai um
       degrau mais leve e um tico mais agudo que no chão. É uma diferença pequena
       e ela faz o ouvido saber, sem olhar, se o golpe pegou o chão ou pegou
       gente — e ela é aplicada POR CIMA da receita do golpe, para o Kienzan
       continuar soando como Kienzan nos dois casos.

       A CLASSE, essa, não muda: a bomba que detona no ar é a mesma bomba, e o
       que decide de quantos metros ela se ouve é o tamanho dela, não a altura
       em que ela abriu. */
    this.tocar(this.buf[r.buf], p, r.vol * 0.88, r.taxa() * 1.08, r.classe, r.prio);
  }

  /* Pouso. 0,45–1,0 → 0,7–1,5 (+3,8 dB no teto), classe `estalo`: um corpo
     batendo no chão é um acontecimento de perto, mas de "perto" na escala de uma
     briga aérea, não na de uma conversa. */
  quedaNoChao(p, speed) {
    this.tocar(
      this.buf?.baque,
      p,
      Math.min(1.5, 0.7 + speed * 0.011),
      0.85 + Math.random() * 0.2,
      "estalo",
      1,
    );
  }

  /* A onda de ki. 0,7 → 1,35 (+5,7 dB) e classe `medio`: ela é a defesa de
     pressão do §6, custa um quarto da barra, e quem está a cem metros tem
     interesse em saber que alguém acabou de limpar a área em volta. */
  ondaDeChoque(p) {
    this.tocar(this.buf?.onda, p, 1.35, 0.95 + Math.random() * 0.12, "medio", 2);
  }

  /* Trovão. 1,0 → 1,5 (+3,5 dB) e classe `grande`, que aqui é literal: um raio
     que só se ouvisse a duzentos metros não seria um raio, seria um estalo. */
  raio(x, z, y = 90) {
    this.tocar(this.buf?.trovao, { x, y, z }, 1.5, 0.85 + Math.random() * 0.3, "grande", 3);
  }

  /**
   * EU APANHEI. O som que o jogador precisa ouvir e não estava ouvindo.
   *
   * ------------------------------------------------------------- o que havia
   *
   * A chamada existia e o buffer existia, mas o som saía por `tocar` — a mistura
   * do MUNDO — no ponto onde o corpo do jogador está. Três coisas conspiravam
   * para ele desaparecer, e bastava qualquer uma:
   *
   * • **Atenuação por distância.** O ouvinte mora na câmera, e a câmera é de
   *   terceira pessoa: ela está metros atrás do corpo. Com `refDistance` 9 e
   *   queda 1,4, a própria dor já entrava na mistura abaixo do volume nominal —
   *   por um som que descreve algo acontecendo a ZERO metro do jogador.
   * • **O pool.** `dor` dura 0,3 s e ia para as mesmas catorze vozes que quinze
   *   lutadores enchem com até noventa bolas por segundo. `_voz` rouba a mais
   *   antiga, então a sua dor era interrompida pela próxima bola alheia quase
   *   sempre antes de terminar. Ela não era baixa: ela era CORTADA.
   * • **O timbre.** `dor` é o mesmo buffer do golpe nos outros, filtrado a
   *   900 Hz. Escuro, sem transiente, e idêntico ao som que toca quando você
   *   ACERTA alguém — a única coisa que o jogador mais precisa distinguir.
   *
   * ------------------------------------------------------------ o que faz hoje
   *
   * Buffer próprio (`dorPropria`, com pico curto e corpo grave), mistura na
   * cabeça (sem panner e sem atenuação, porque quem apanha está a zero metro de
   * si mesmo) e canal fixo, fora do pool, onde nenhuma bola de ki pode roubar a
   * vez. O `p` continua na assinatura e continua sendo ignorado de propósito:
   * `game.js` passa a posição do próprio jogador, e não existe posição relativa
   * entre o jogador e ele mesmo.
   *
   * Forte e fraco divergem em VOLUME e em AFINAÇÃO ao mesmo tempo. A taxa 0,82
   * do golpe forte não só o abaixa uma terça: ela estica o som em 22%, então o
   * golpe pesado é mais grave E mais demorado — as duas dimensões que o ouvido
   * usa para julgar peso. Fazer só o volume mudar produziria "o mesmo tapa mais
   * alto", que lê como estar perto, não como ter doído mais.
   *
   * @param {{x,y,z}} p ignorado. Ver acima.
   * @param {boolean} forte o golpe passou de 40% de um `hurtFlash` cheio
   */
  levouDano(p, forte = false) {
    if (!this.buf) return;
    const agora = this.ctx.currentTime;
    /* COTA. O `HURT` sai a 6 Hz por vítima (167 ms) e nada impede três pessoas
       de baterem em você ao mesmo tempo, o que triplicaria isso. Cento e vinte
       milissegundos deixam passar a cadência inteira de um agressor — a sua dor
       nunca some quando alguém está te metralhando — e fundem num só evento a
       enxurrada de três agressores simultâneos, que de qualquer forma o ouvido
       não conseguiria contar.

       A exceção é o golpe FORTE logo depois de um fraco: aquele o jogador tem de
       ouvir mesmo dentro da janela, porque ele é a informação nova (a briga
       mudou de patamar). O contrário — um fraco atrás de um forte — não abre
       exceção nenhuma: não há nada a aprender com ele. */
    const dentroDaJanela = agora - this._ultimaDor < 0.12;
    if (dentroDaJanela && !(forte && !this._ultimaDorForte)) return;
    this._ultimaDor = agora;
    this._ultimaDorForte = forte;
    /* VOLUME: 1,0 → 1,6 (forte) e 0,62 → 1,15 (fraco), ou +4,1 dB e +5,4 dB.
       Passar de 1 aqui só é possível porque existe teto (ver `_montarTeto`): sem
       limitador, um ganho 1,6 sobre um buffer normalizado a pico 1 ceifaria a
       onda na saída da placa. Com ele, o pico é segurado a ~−2 dBFS e a dor
       ainda EMPURRA a mistura inteira para baixo por 220 ms — a trilha, o
       tiroteio, tudo. É o efeito que se quer: quando você apanha forte, o mundo
       abaixa o volume. */
    this.tocarNaCabeca(this.buf.dorPropria, forte ? 1.6 : 1.15, forte ? 0.82 : 1, "dor");
  }

  /**
   * GOLPE APARADO pela guarda. **Preparado, ainda sem chamada em `game.js`.**
   *
   * A guarda é o único estado do jogo em que o jogador toma uma decisão e o
   * resultado dela é invisível — o dano que ela cortou não aconteceu, e o que não
   * acontece não tem como aparecer na tela. Só o som pode dizer "funcionou", e
   * ele precisa dizer isso no mesmo instante em que a alternativa (`levouDano`)
   * teria tocado, para que o contraste entre os dois seja a lição.
   *
   * @param {{x,y,z}} p onde a guarda foi batida
   * @param {boolean} emMim se fui EU quem aparou — vai para a cabeça, como a dor
   */
  golpeAparado(p, emMim = false) {
    if (!this.buf) return;
    if (emMim) {
      /* Mesmo canal da dor, e isso é o ponto: uma sequência de golpes em que
         você aparou dois e levou um tem de soar como TRÊS eventos no mesmo
         lugar, com o do meio diferente. Canais separados os empilhariam e a
         diferença viraria textura em vez de informação. */
      /* 0,7 → 1,1 (+3,9 dB). Sobe MENOS que a dor de propósito: a diferença
         entre os dois é a lição inteira da guarda, e se o golpe aparado subisse
         tanto quanto o que passou, aparar deixaria de soar como alívio. */
      this.tocarNaCabeca(this.buf.guarda, 1.1, 0.95 + Math.random() * 0.1, "dor");
      return;
    }
    // 0,45 → 0,8 (+5 dB). Alheio, e por isso continua na régua de perto.
    this.tocar(this.buf.guarda, p, 0.8, 0.9 + Math.random() * 0.2, "corpo", 0);
  }

  /**
   * DERRUBADO — o corpo indo ao chão depois de cinco golpes seguidos.
   * **Preparado, ainda sem chamada em `game.js`.**
   *
   * `quedaNoChao` já existe e serve ao pouso normal, mas o atordoamento não é um
   * pouso: é a punição por ter comido cinco golpes sem se mexer, e o jogador
   * perde o controle por alguns segundos. Isso merece ser dito na cabeça, como a
   * dor, e não a alguns metros de distância como qualquer outro baque.
   *
   * O baque sai afinado a 0,8 (mais grave e mais longo) e é seguido, oitenta
   * milissegundos depois, do corpo grave da dor própria: dois eventos coladinhos
   * lêem como "bateu no chão e doeu", que é literalmente o que aconteceu. Uma
   * coisa só leria como um pulo mal dado.
   *
   * @param {{x,y,z}} p onde o corpo caiu — usado só quando não sou eu
   * @param {boolean} emMim se fui EU quem foi derrubado
   */
  fuiDerrubado(p, emMim = true) {
    if (!this.buf) return;
    if (!emMim) {
      // 0,6 → 1,0 (+4,4 dB), classe `estalo` como o pouso normal.
      this.tocar(this.buf.baque, p, 1.0, 0.8 + Math.random() * 0.1, "estalo", 1);
      return;
    }
    // 0,9 → 1,3 (+3,2 dB).
    this.tocarNaCabeca(this.buf.baque, 1.3, 0.8, "baque");
    /* O atraso é agendado e não é um `setTimeout` de precisão: oitenta
       milissegundos de erro num som de queda são inaudíveis, e um temporizador
       aqui é mais simples do que um buffer novo só para juntar as duas metades.
       Se a partida acabar no meio, `dispose` corta o canal e o disparo tardio cai
       no `!this.buf` — não sobra voz pendurada. */
    setTimeout(() => this.tocarNaCabeca(this.buf?.dorPropria, 1.25, 0.78, "dor"), 80);
  }

  /* Morte. 0,9 → 1,3 (+3,2 dB) e classe `medio`: alguém caindo é notícia para o
     vale, não para a arena — a arena fica com a Genki Dama. */
  morreu(p) {
    this.tocar(this.buf?.morte, p, 1.3, 1, "medio", 2);
  }

  /* Os dois avisos "na cabeça" DESCEM de número e ficam onde estavam de fato:
     0,5 → 0,42 e 0,35 → 0,28, porque o ganho mestre de 1,4 (ver `GANHO_MESTRE`)
     já os multiplica depois. 0,42 × 1,4 = 0,59 na saída, contra os 0,5 de
     antes — ainda um pouco acima, que é bem-vindo num aviso, sem virar bipe de
     eletrodoméstico por cima da briga. */
  kiEncheu() {
    this.tocarNaCabeca(this.buf?.kiCheio, 0.42);
  }

  /* `travou()` FOI REMOVIDO. Ver a nota em `_sintetizarMundo`, junto do `avisoSSJ`:
     o atalho R da trava de alvo saiu do jogo e o método ficou sem chamador
     nenhum. Um método público de som que não toca em lugar nenhum não é código
     morto inofensivo — é uma armadilha, porque o próximo a precisar de um bipe
     vai encontrá-lo e usá-lo, e vai anunciar outra coisa com o som de uma mira. */

  /* ------------------------------------------------------------- o mundo --- */

  /**
   * O RESPINGO do peixe, entrando ou saindo do mar.
   *
   * Classe `grande`, e é o único som de cenário que merece essa régua: o bicho
   * tem vinte e seis metros, o salto dele é o acontecimento mais visível do
   * mapa depois de uma Genki Dama, e ele acontece longe — no mar, e não onde a
   * briga está. Com a régua de perto, o respingo de um peixe de trinta metros
   * de comprimento seria audível de doze, o que é o mesmo que não existir.
   *
   * @param {{x,y,z}} p onde a água abriu (a linha do mar)
   * @param {number} [forca] 1 é o salto normal; quem chama já escala a entrada
   *   (mais pesada) contra a saída. Entra no volume E na afinação: um respingo
   *   maior é mais grave, não só mais alto — água que só sobe de volume lê como
   *   estar perto, e não como ter sido maior.
   */
  respingo(p, forca = 1) {
    if (!this.buf || !p) return;
    const f = Math.max(0.3, Math.min(2, forca));
    /* 1,1 de base, e o número é alto porque o buffer é MAGRO: o estouro de
       superfície domina o pico e o corpo do som fica a 0,076 de RMS, metade do
       de uma explosão do banco. Normalizar por pico trata todos os buffers como
       iguais e eles não são — quem tem transiente forte e corpo fino precisa de
       mais ganho para a mesma sensação de tamanho. */
    this.tocar(this.buf.respingo, p, Math.min(1.7, 1.1 * f), 1.12 - 0.22 * f, "grande", 2);
  }

  /**
   * O ASSOBIO de uma rocha da chuva descendo.
   *
   * ------------------------------------------------- por que NÃO é um loop
   *
   * O pedido veio como "em loop enquanto a rocha desce", e o resultado é um
   * disparo único — vale explicar, porque a diferença é de projeto e não de
   * preguiça. Um loop posicional por rocha pede uma voz reservada por rocha
   * viva, ligada e desligada por um estado que este arquivo não tem; e o
   * cabeçalho já argumenta longamente contra loops por projétil.
   *
   * O que substitui é o mesmo truque do `feixeVoando`: a queda tem duração
   * CONHECIDA (`msg.dur`, que a sala manda junto com a rocha), então um buffer
   * único esticado para essa duração cobre o evento inteiro com um `play()`. A
   * "descida" do Doppler está dentro do buffer, que é onde ela sempre esteve.
   *
   * ------------------------------------------- e por que ele toca no CHÃO
   *
   * O som sai do PONTO DE IMPACTO, não da rocha lá em cima. É deliberado e é a
   * parte que mais serve ao jogador: uma rocha a quatrocentos metros de
   * altitude soa vinda de cima, e "de cima" não é uma informação sobre a qual
   * se possa agir. O que decide se você vive é ONDE ela vai cair — o mesmo
   * ponto que a mancha laranja já marca no chão. O som e a marca passam a dizer
   * a mesma coisa, um para cada sentido, e o assobio descendente é o que
   * carrega o "está vindo".
   *
   * @param {{x,y,z}} p o ponto de impacto
   * @param {number} raio o raio da rocha em metros (2,2 / 5 / 11 nas classes)
   * @param {number} [segundos] a duração da queda. Quando dada, a afinação é
   *   ajustada para o assobio acabar junto com o estouro; sem ela, toca no
   *   tamanho natural do buffer.
   */
  assobioDeQueda(p, raio = 1, segundos = 0) {
    if (!this.buf || !p) return;
    /* Os cortes 3,5 e 8 m saem do meio das classes (2,2 / 5 / 11): cada rocha
       cai no timbre da classe dela, e uma classe nova amanhã cai na vizinha em
       vez de ficar muda. */
    const nome = raio >= 8 ? "assobioG" : raio >= 3.5 ? "assobioM" : "assobioP";
    const buf = this.buf[nome];
    /* A leva 2 pode não ter chegado (ver `_segundaLeva`). Todo o resto do
       arquivo trata buffer ausente como silêncio dentro do próprio `tocar`;
       aqui a guarda tem de ser explícita porque a linha seguinte lê
       `buf.duration` — e `undefined.duration` não é silêncio, é um TypeError
       dentro do tratador da mensagem que trouxe a rocha. */
    if (!buf) return;
    /* A afinação estica o buffer de 2,6 s até a queda real. Presa em [0,7; 1,6]
       porque fora disso o remendo aparece: abaixo de 0,7 o assobio vira um
       rosnado grave que não lê como rocha pequena, e acima de 1,6 ele vira um
       guincho. Uma queda muito mais longa que o buffer simplesmente começa a
       ser ouvida mais tarde, que é o comportamento certo — o aviso interessa no
       fim da queda, não no começo. */
    const taxa = segundos > 0 ? Math.max(0.7, Math.min(1.6, buf.duration / segundos)) : 1;
    /* Volume por tamanho: um colosso (potência 20, raio letal de 31 m) tem de
       chegar antes e mais alto que um pedrisco que abre um buraco de nada. */
    const vol = raio >= 8 ? 1.35 : raio >= 3.5 ? 1.0 : 0.72;
    this.tocar(buf, p, vol, taxa, "grande", 2);
  }

  /**
   * O GRITO da transformação. Três segundos, terminando no clarão.
   *
   * Classe `grande` e prioridade máxima: é a única coisa que um lutador faz que
   * muda o resto da partida (teto de vida de 100 para 160), e ela acontece uma
   * vez. Nenhuma bola de ki tem o direito de cortá-la pela metade.
   *
   * O estouro do fim está DENTRO do buffer (ver `gritoDeTransformacao`), e é
   * por isso que `NamekGame.estourarSSJ` não pede mais um estouro por fora: os
   * dois juntos eram uma detonação em cima da outra, com 200 ms de diferença.
   */
  transformacao(p) {
    if (!this.buf || !p) return;
    this.tocar(this.buf.grito, p, 1.5, 1, "grande", 3);
  }

  /** O aviso de que dá para virar Super Saiyajin. Na cabeça, como o `kiEncheu`. */
  ssjPronto() {
    this.tocarNaCabeca(this.buf?.avisoSSJ, 0.5);
  }

  /* ------------------------------------------------------------- o Freeza -- */

  /**
   * O BOSS CHEGOU. Solene — e este é o caso mais claro de "a arena inteira tem
   * direito de saber" que o modo já teve: a partida acabou de virar outra coisa.
   */
  bossEntrou(p) {
    if (!this.buf || !p) return;
    this.tocarSolene(this.buf.bossChegou, p, 1.2);
    /* E ele RI ao chegar — a primeira das cinco ocasiões (ver
       `risadaDoFreeza`). Agendada 1,55 s depois porque a chegada tem dois
       tempos e o peso dela cai em 1,25 s: rir por cima do próprio estrondo
       desperdiça os dois sons. O ponto é copiado pelo mesmo motivo de sempre —
       quem chama passa a posição corrente do corpo, e ela anda. */
    const onde = { x: p.x, y: p.y, z: p.z };
    this._agendar(1.55, () => this.risadaDoFreeza(onde, "entrada"));
  }

  /**
   * A RISADA. **"Em certos momentos" — estes cinco, e por quê.**
   *
   * O pedido deixou a escolha em aberto. O critério que a fechou: uma risada
   * tem de ser uma REAÇÃO a alguma coisa que o jogador fez ou deixou de fazer,
   * nunca um relógio. Rir a cada N segundos é o caminho garantido para o traço
   * mais reconhecível do personagem virar barulho de fundo em duas lutas.
   *
   * • `"entrada"` — ele chegou. É a apresentação, e é a única que ignora a
   *   carência: não há nada antes dela para atropelar.
   * • `"aguentou"` — **a mais interessante, e a que mais paga.** O jogador
   *   gastou a barra inteira, encaixou um especial em cheio, e a resposta é uma
   *   gargalhada. Ela só sai quando o golpe foi grande DE VERDADE
   *   (`risada.golpeGrande`) e ele ainda está com folga (`risada.aguentaAte`) —
   *   as duas condições juntas são o que a faz dizer "isso é tudo?" em vez de
   *   "não senti", que seria mentira e o jogador ouviria como tal.
   * • `"grande"` — ele começou a carregar a Death Ball estando com vida alta.
   *   Rir enquanto junta o golpe que mata um grupo inteiro é o momento mais
   *   em-personagem que a luta oferece, e ele já é um aviso: o jogador tem 3,2 s
   *   para sair de perto.
   * • `"abate"` — ele matou alguém.
   * • `"aparou"` — reservado. Ver a nota no fim deste comentário.
   *
   * E o que ele NÃO faz, que é igualmente uma decisão: **ele para de rir quando
   * está perdendo.** Três dos cinco gatilhos exigem vida alta
   * (`risada.folgado` / `risada.aguentaAte`), então a segunda metade da luta é
   * silenciosa da parte dele. Isso não é economia de som — é a informação mais
   * barata e mais clara de que a maré virou, e ela chega ao jogador sem um
   * único elemento de interface.
   *
   * A escolha da VARIAÇÃO é por motivo e não sorteada: cada ocasião tem um
   * registro (ver `risadaDeFreeza`), e sortear faria a gargalhada teatral cair
   * no meio de uma troca de tiros.
   *
   * @param {{x,y,z}} p de onde a voz sai (o peito dele)
   * @param {string} motivo `"entrada"|"aguentou"|"grande"|"abate"|"aparou"`
   * @returns {boolean} se saiu — quem chama pode usar para não repetir a conta
   */
  risadaDoFreeza(p, motivo = "grande") {
    /* `buf.risada0` e não só `buf`: a voz do boss mora na LEVA 2 (ver
       `_segundaLeva`), e um pedido feito antes de ela chegar não pode gastar a
       carência de uma risada que não vai sair — o boss ficaria mudo pelos
       próximos seis segundos e meio por causa de um som que nunca tocou. */
    if (!this.buf?.risada0 || !p) return false;
    const R = NAMEK.freeza?.risada;
    const agora = this.ctx.currentTime;
    /* A CARÊNCIA, e a entrada passa por cima dela. `_ultimaRisada` começa em
       −infinito e não em zero: com zero, a primeira risada dos primeiros
       segundos de aba seria engolida pela carência contra um evento que nunca
       aconteceu. */
    if (motivo !== "entrada" && agora - this._ultimaRisada < (R?.carencia ?? 6.5)) return false;
    this._ultimaRisada = agora;

    /* Motivo → variação. A teatral (2) para os dois acontecimentos que valem
       uma pausa; a gargalhada aberta (1) para o deboche; a risadinha rápida (0)
       para o que acontece no meio da briga e não pode roubar o palco. */
    const V =
      motivo === "entrada" || motivo === "abate"
        ? "risada2"
        : motivo === "aguentou"
          ? "risada1"
          : "risada0";
    /* Classe `medio` e não `grande`: a voz dele não é uma bomba, e ela repete.
       Quarenta metros de referência cobrem toda a distância de briga com ele e
       poupam de ouvi-lo debochar do outro lado do vale, o que viraria textura.
       A entrada é a exceção — ali ele é uma notícia de arena. */
    const arena = motivo === "entrada";
    const vol = arena ? 1.25 : motivo === "aguentou" ? 1.2 : 1.05;
    /* Afinação sorteada num intervalo ESTREITO (±4 %). Larga demais e a voz
       muda de pessoa entre uma risada e outra; sem nenhuma, duas risadas
       seguidas do mesmo motivo são audivelmente a mesma amostra. */
    this.tocar(this.buf[V], p, vol, 0.96 + Math.random() * 0.08, arena ? "grande" : "medio", 3);
    return true;
  }

  /**
   * O BOSS LEVOU DANO — e, se o golpe foi grande, ele ri disso.
   *
   * As duas coisas moram no mesmo método de propósito, e não por preguiça de
   * quem chama: elas são a MESMA decisão lida do mesmo número. O tamanho do
   * despejo de dano diz ao mesmo tempo qual grunhido sai e se cabe a
   * gargalhada, e separá-las em dois métodos obrigaria o chamador a refazer a
   * conta da fração de vida — que é a conta que decide as duas.
   *
   * A graduação é a mesma régua do `_receitaDeImpacto`: uma bola de ki e uma
   * Genki Dama não podem arrancar o mesmo som. O corte é a fração de `vidaMax`
   * num único despejo (a sala junta o dano e manda a 8 Hz, ver `FREEZA_HURT`),
   * e não o dano absoluto — a barra do boss muda de tamanho com a dificuldade,
   * e um número fixo aqui significaria coisas diferentes em cada uma.
   *
   * @param {{x,y,z}} p o peito dele
   * @param {number} dano quanto saiu neste despejo
   * @param {number} vidaMax a barra cheia dele
   * @param {number} [vida] a vida que sobrou — só a risada usa
   */
  bossLevouDano(p, dano, vidaMax, vida = 0) {
    // Mesma guarda da risada, e pelo mesmo motivo: a voz está na leva 2.
    if (!this.buf?.grunhidoLeve || !p || !(dano > 0)) return;
    const max = vidaMax > 0 ? vidaMax : 1;
    const fracao = dano / max;
    const R = NAMEK.freeza?.risada;
    const grande = fracao >= (R?.golpeGrande ?? 0.06);

    /* COTA. O `FREEZA_HURT` sai a 8 Hz (125 ms) enquanto alguém estiver
       encostando nele, e um grunhido de 0,2 s repetido a essa taxa é uma
       serrilha, não uma reação. 260 ms deixam passar um a cada dois despejos —
       o bastante para o retorno ser contínuo enquanto se metralha, sem empastar.
       O golpe GRANDE fura a cota, pelo mesmo motivo que o golpe forte fura a
       cota da dor própria em `levouDano`: ele é a informação nova. */
    const agora = this.ctx.currentTime;
    if (!grande && agora - this._ultimoGrunhido < 0.26) return;
    this._ultimoGrunhido = agora;

    this.tocar(
      this.buf[grande ? "grunhidoForte" : "grunhidoLeve"],
      p,
      grande ? 1.3 : 0.95,
      /* O forte varia menos: uma reação de dor pesada com afinação sorteada
         larga soa como pessoas diferentes apanhando. */
      grande ? 0.97 + Math.random() * 0.06 : 0.94 + Math.random() * 0.14,
      "medio",
      grande ? 3 : 1,
    );

    /* "ISSO É TUDO?" — o inverso do óbvio, e a razão de o gatilho existir. Só
       depois de um golpe que doeu e só enquanto ele tem folga na barra; a
       carência de `risadaDoFreeza` cuida do resto. */
    if (grande && vida > max * (R?.aguentaAte ?? 0.78)) this.risadaDoFreeza(p, "aguentou");
  }

  /** O boss caiu. Solene, pelo mesmo motivo da chegada — é o fim da luta. */
  bossCaiu(p) {
    if (!this.buf || !p) return;
    this.tocarSolene(this.buf.bossCaiu, p, 1.25);
  }

  /**
   * O teleporte dele. Classe `medio`, e não `grande`, de propósito.
   *
   * Ele pisca a cada poucos segundos quando está apanhando (ver
   * `NAMEK.freeza.teleporte`), e um som de arena repetido a essa cadência deixa
   * de ser informação e vira textura. A quarenta metros de referência, quem
   * está brigando com ele ouve e quem está do outro lado do vale não precisa.
   */
  bossPiscou(p) {
    if (!this.buf || !p) return;
    this.tocar(this.buf.bossPiscou, p, 0.95, 0.94 + Math.random() * 0.14, "medio", 2);
  }

  /**
   * Os contínuos, por quadro.
   *
   * @param {object} e `{ carregando, feixeAceso, velocidade }`
   */
  update(e) {
    if (!this.buf) return;
    /* OS LOOPS DESCEM DE NÚMERO PARA FICAREM ONDE ESTAVAM. Ver `GANHO_MESTRE`:
       tudo é multiplicado por 1,4 depois do limitador, então 0,42 viraria 0,59
       sem ninguém ter pedido. E alto aqui é pior do que alto em qualquer outro
       lugar, porque um loop é CONTÍNUO: um contínuo alto segura o compressor
       engatado o tempo todo, a mistura inteira fica abafada enquanto alguém
       carrega ki, e as explosões — que é o que o pedido quer ouvir — perdem
       justamente o espaço que este trabalho abriu.
         carga  0,42 → 0,32 (0,45 na saída, ~ onde estava)
         feixe  0,50 → 0,40 (0,56 na saída, um degrau ACIMA — o feixe aceso é a
                maior coisa na tela enquanto dura) */
    this.loop("carga", e.carregando, 0.32);
    this.loop("feixe", e.feixeAceso, 0.4);
    /* O VENTO É PROPORCIONAL À VELOCIDADE, e só acima do voo de cruzeiro. Um
       sopro constante durante o voo normal vira ruído de fundo que o ouvido
       apaga em trinta segundos — e aí a arrancada deixa de ter som próprio,
       que é justamente o que ele existe para marcar. */
    const v = e.velocidade ?? 0;
    const f = Math.max(0, (v - NAMEK.fighter.flySpeed) / (NAMEK.fighter.boostSpeed - NAMEK.fighter.flySpeed));
    // 0,5 → 0,34 no teto, pelo mesmo motivo dos outros dois: 0,34 × 1,4 = 0,48.
    this.loop("vento", f > 0.05, Math.min(0.34, f * 0.34), 0.85 + f * 0.5);
  }

  setLigado(on) {
    this.ligado = on;
    if (!on) {
      /* Os AGENDADOS morrem junto. A saída de um feixe está marcada para daqui a
         um segundo e o arremesso da Genki Dama para daqui a cinco: sem esta
         linha, apertar "mudo" deixaria o jogo cuspindo os dois depois — e o
         `_agendar` só verifica `ligado` no disparo, o que salvaria o mudo mas
         não o `dispose`. Cortar aqui resolve os dois com uma regra só. */
      this._cancelarAgendados();
      for (const [id] of this.loops) this.loop(id, false);
      /* Os solenes duram até seis segundos e meio. Sem cortá-los aqui, desligar
         o som no meio de uma Genki Dama deixaria a detonação rolando por mais um
         punhado de segundos — que é exatamente a experiência que alguém que
         acabou de apertar "mudo" não quer ter. */
      for (const v of this.solenes) if (v.a.isPlaying) v.a.stop();
      for (const [, a] of this._canais) if (a.isPlaying) a.stop();
      if (this.musica.isPlaying) this.musica.pause();
    } else if (this.destravado && this.musica.buffer && !this.musica.isPlaying) {
      this.musica.play();
    }
  }

  dispose() {
    this._cancelarAgendados();
    /* A leva 2 pode estar a caminho — ver `_segundaLeva`. Sem isto, ela cairia
       sessenta milissegundos depois de a partida ter acabado e sintetizaria
       quatro megabytes para um objeto que ninguém mais lê. */
    clearTimeout(this._leva);
    this._leva = 0;
    for (const [, L] of this.loops) {
      clearTimeout(L.timer);
      if (L.a.isPlaying) L.a.stop();
    }
    this.loops.clear();
    if (this.musica.isPlaying) this.musica.stop();
    for (const v of this.pool) {
      if (v.a.isPlaying) v.a.stop();
      v.suporte.parent?.remove(v.suporte);
    }
    this.pool.length = 0;
    for (const v of this.solenes) {
      if (v.a.isPlaying) v.a.stop();
      v.suporte.parent?.remove(v.suporte);
    }
    this.solenes.length = 0;
    for (const [, a] of this._canais) if (a.isPlaying) a.stop();
    this._canais.clear();
    /* Soltar os buffers é o que faz os disparos ATRASADOS (ver `fuiDerrubado`)
       caírem no `!this.buf` de todo mundo em vez de tocarem num contexto que já
       foi embora. São também alguns megabytes de `Float32Array` que não têm por
       que sobreviver ao fim da partida. */
    this.buf = null;
    /* O TETO volta a sair do caminho. Sem isto, um `NamekAudio` novo (entrar em
       campo de novo na mesma aba) montaria um segundo compressor em série com o
       primeiro, que continuaria pendurado no `destination` de um listener morto
       — dois limitadores empilhados são o dobro da redução, e a mistura ficaria
       progressivamente mais abafada a cada partida. */
    this.teto?.disconnect();
    this.mestre?.disconnect();
    this.teto = null;
    this.mestre = null;
    this.listener.parent?.remove(this.listener);
  }
}
