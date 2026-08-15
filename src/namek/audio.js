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
   • o alcance é curto e a queda é rápida: a briga que importa é a que está
     perto de você.

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
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../shared/namek/config.js";
import trilhaUrl from "../assets/audio/aurora_de_combate.mp3";

/** Vozes simultâneas do pool geral. */
const VOZES = 14;
/** m — além disto um som posicional não é criado. */
const ALCANCE = 240;

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
   substitua uma composição de verdade. O volume é DELIBERADAMENTE baixo pelo
   mesmo motivo do arqueiro (`systems/audio.js`, `MUSIC_VOLUME_DAY`): o que
   precisa ser ouvido é a rajada, o especial e o acerto — são eles que dizem ao
   jogador o que acabou de acontecer, e uma trilha no volume dos efeitos os
   encobre justamente nos instantes que importam. */
const VOLUME_TRILHA = 0.1;

/* ------------------------------------------------------------- síntese ----- */

/**
 * Um buffer mono, preenchido por uma função de amostra.
 *
 * `fn(t, i)` recebe o tempo em SEGUNDOS (não a fração): as contas de síntese
 * são todas em Hz e em segundos, e converter dentro de cada receita seria
 * repetir a mesma divisão quinze vezes com quinze chances de errar.
 */
function buffer(ctx, segundos, fn) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * segundos));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const dt = 1 / ctx.sampleRate;
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
 * A GENKI DAMA SENDO JUNTADA. 3,8 s, para cobrir o windup de 3,6 s.
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
  const dur = 3.8;
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

/** Dor alheia: curto, grave, sem brilho. Alguém apanhou, e não fui eu. */
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

/** A trava de alvo: dois cliques curtos e secos. Também não é posicional. */
function trava(ctx) {
  const b = buffer(ctx, 0.16, (t) => {
    const bip = (x) => Math.sin(2 * Math.PI * 1600 * x) * Math.exp(-x * 60);
    return (bip(t) + (t > 0.07 ? bip(t - 0.07) : 0)) * 0.7;
  });
  return normalizar(b, 0.4);
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

    /* Os buffers são construídos SOB DEMANDA, no `unlock`, e não aqui.
     *
     * Sintetizar quinze receitas são alguns megabytes de `Float32Array` e umas
     * dezenas de milissegundos de laço — barato, mas não de graça, e o
     * construtor roda enquanto a tela de entrada ainda está montando o mundo.
     * Pagar isso antes do primeiro clique atrasaria a entrada para quem talvez
     * jogue no mudo. */
    this.buf = null;

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
      if (!this.buf) this.buf = this._sintetizar();
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
      estouroP: explosao(c, 0.55),
      estouroM: explosao(c, 1.2),
      estouroG: explosao(c, 2.4),
      estouroColossal: detonacaoColossal(c),
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
      trava: trava(c),
    };
  }

  _voz() {
    if (this.pool.length < VOZES) {
      const a = new THREE.PositionalAudio(this.listener);
      a.setRefDistance(9);
      a.setRolloffFactor(1.4);
      a.setMaxDistance(ALCANCE);
      a.setDistanceModel("inverse");
      const suporte = new THREE.Object3D();
      suporte.add(a);
      this.pool.push({ a, suporte, usada: 0 });
      return this.pool[this.pool.length - 1];
    }
    /* Pool cheio: rouba a voz MAIS ANTIGA. Cortar um som velho pela metade é
       menos perceptível do que engolir o som novo — o evento que acabou de
       acontecer é o que o jogador está esperando ouvir. */
    let alvo = this.pool[0];
    for (const v of this.pool) if (v.usada < alvo.usada) alvo = v;
    return alvo;
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
   */
  tocar(buf, p, vol = 1, taxa = 1) {
    if (!this.ligado || !this.buf || !buf) return;
    /* Longe demais: nem cria a voz. O `maxDistance` do panner já silenciaria,
       mas silenciar depois de alocar continua consumindo a vaga que o som de
       perto precisa. */
    const l = this.listener;
    const dx = p.x - l.parent.position.x;
    const dy = p.y - l.parent.position.y;
    const dz = p.z - l.parent.position.z;
    if (dx * dx + dy * dy + dz * dz > ALCANCE * ALCANCE) return;

    const v = this._voz();
    if (v.a.isPlaying) v.a.stop();
    v.usada = this.ctx.currentTime;
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
    // Afinação sorteada: a mesma amostra noventa vezes por segundo vira metralhadora.
    this.tocar(this.buf.bola, p, 0.55, 0.9 + Math.random() * 0.25);
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
    this.tocar(this.buf.acerto, p, forte ? 0.8 : 0.5, forte ? 0.8 : 1 + Math.random() * 0.2);
  }

  /**
   * O especial saindo. `kind` afina o disparo: cada golpe tem outro peso.
   *
   * A Genki Dama sai desta regra inteira. Ver `genkiCarga`: os outros três
   * especiais SAEM (varredura descendo, um instante), e ela RECOLHE (3,6 s
   * subindo). Um "fiu" descendente na Genki Dama contaria a história errada no
   * único golpe do jogo em que a história é a espera. E ela vai pela mistura
   * solene, com voz reservada e alcance de arena, porque o aviso de que alguém
   * apostou a barra inteira é para todo mundo — não só para quem está a 240 m.
   */
  especial(p, kind) {
    if (!this.buf) return;
    if (kind === "genki") {
      this.tocarSolene(this.buf.genkiCarga, p, 0.95);
      return;
    }
    const taxa = kind === "galick" ? 0.85 : kind === "disk" ? 1.35 : 1;
    this.tocar(this.buf.disparo, p, 0.9, taxa);
  }

  /**
   * Impacto no chão. A potência escolhe QUAL estouro, não só o volume.
   *
   * As potências reais do modo são 0,12 (bola), 1,4 (disco), 4,2 (Kamehameha),
   * 6,4 (Galick Gun) e **26** (Genki Dama). O escalonamento antigo tinha três
   * faixas e um volume `0,55 + p·0,05` que SATURAVA em 1,0 já na potência 9 —
   * então o golpe de 96 de dano e 30 m de cratera soava 15% mais alto que o
   * Galick Gun e usava o mesmo buffer de qualquer coisa acima de 8. O ouvido não
   * tinha como saber que a maior coisa do jogo tinha acabado de acontecer.
   *
   * Agora são quatro faixas com volumes ESPAÇADOS de propósito. Como toda
   * receita sai normalizada no mesmo pico, "maior" não pode vir de tocar mais
   * alto que o máximo — tem de vir de tocar os pequenos mais BAIXO, deixando
   * espaço de cabeça para o colossal. Os três primeiros perderam volume; só a
   * Genki Dama toca em 1,0, e só ela usa `detonacaoColossal`.
   */
  estouroNoChao(p, power) {
    if (!this.buf) return;
    /* Acima de 16 só existe a Genki Dama (26), e o degrau até o vizinho mais
       próximo (6,4) é enorme de propósito: esta faixa é dela e de mais nada. */
    if (power >= 16) {
      this.tocarSolene(this.buf.estouroColossal, p, 1, 0.97 + Math.random() * 0.06);
      return;
    }
    const b = power >= 5 ? this.buf.estouroG : power >= 2 ? this.buf.estouroM : this.buf.estouroP;
    const vol = power >= 5 ? 0.8 : power >= 2 ? 0.68 : 0.5;
    this.tocar(b, p, vol, 0.9 + Math.random() * 0.2);
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
  detonouNoAr(p, power) {
    if (!this.buf) return;
    if (power >= 16) {
      this.tocarSolene(this.buf.estouroColossal, p, 1, 0.97 + Math.random() * 0.06);
      return;
    }
    /* No ar não há terreno para devolver o grave, então o estouro é um degrau
       mais leve e um tico mais agudo que o mesmo golpe no chão. É uma diferença
       pequena e ela faz o ouvido saber, sem olhar, se o golpe pegou o chão ou
       pegou gente. */
    const b = power >= 5 ? this.buf.estouroG : power >= 2 ? this.buf.estouroM : this.buf.estouroP;
    const vol = power >= 5 ? 0.72 : power >= 2 ? 0.6 : 0.45;
    this.tocar(b, p, vol, 1.05 + Math.random() * 0.15);
  }

  quedaNoChao(p, speed) {
    this.tocar(this.buf?.baque, p, Math.min(1, 0.45 + speed * 0.008), 0.85 + Math.random() * 0.2);
  }

  ondaDeChoque(p) {
    this.tocar(this.buf?.onda, p, 0.7);
  }

  raio(x, z, y = 90) {
    this.tocar(this.buf?.trovao, { x, y, z }, 1, 0.85 + Math.random() * 0.3);
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
    this.tocarNaCabeca(this.buf.dorPropria, forte ? 1 : 0.62, forte ? 0.82 : 1, "dor");
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
      this.tocarNaCabeca(this.buf.guarda, 0.7, 0.95 + Math.random() * 0.1, "dor");
      return;
    }
    this.tocar(this.buf.guarda, p, 0.45, 0.9 + Math.random() * 0.2);
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
      this.tocar(this.buf.baque, p, 0.6, 0.8 + Math.random() * 0.1);
      return;
    }
    this.tocarNaCabeca(this.buf.baque, 0.9, 0.8, "baque");
    /* O atraso é agendado e não é um `setTimeout` de precisão: oitenta
       milissegundos de erro num som de queda são inaudíveis, e um temporizador
       aqui é mais simples do que um buffer novo só para juntar as duas metades.
       Se a partida acabar no meio, `dispose` corta o canal e o disparo tardio cai
       no `!this.buf` — não sobra voz pendurada. */
    setTimeout(() => this.tocarNaCabeca(this.buf?.dorPropria, 0.85, 0.78, "dor"), 80);
  }

  morreu(p) {
    this.tocar(this.buf?.morte, p, 0.9);
  }

  kiEncheu() {
    this.tocarNaCabeca(this.buf?.kiCheio, 0.5);
  }

  travou() {
    this.tocarNaCabeca(this.buf?.trava, 0.35);
  }

  /**
   * Os contínuos, por quadro.
   *
   * @param {object} e `{ carregando, feixeAceso, velocidade }`
   */
  update(e) {
    if (!this.buf) return;
    this.loop("carga", e.carregando, 0.42);
    this.loop("feixe", e.feixeAceso, 0.5);
    /* O VENTO É PROPORCIONAL À VELOCIDADE, e só acima do voo de cruzeiro. Um
       sopro constante durante o voo normal vira ruído de fundo que o ouvido
       apaga em trinta segundos — e aí a arrancada deixa de ter som próprio,
       que é justamente o que ele existe para marcar. */
    const v = e.velocidade ?? 0;
    const f = Math.max(0, (v - NAMEK.fighter.flySpeed) / (NAMEK.fighter.boostSpeed - NAMEK.fighter.flySpeed));
    this.loop("vento", f > 0.05, Math.min(0.5, f * 0.5), 0.85 + f * 0.5);
  }

  setLigado(on) {
    this.ligado = on;
    if (!on) {
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
    this.listener.parent?.remove(this.listener);
  }
}
