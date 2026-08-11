/* ---------------------------------------------------------------------------
   Áudio 3D posicional — reativo a eventos, pronto para rede futura.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { gameEvents, EventType } from "../core/events.js";

/* Os gravados entram como URL de asset: o Vite emite o arquivo com hash e o
   caminho continua certo em subpasta, em `file://` e na hospedagem — o mesmo
   motivo de `base: "./"` no vite.config. */
import roncoUrl from "../assets/audio/porco_ronco.mp3";
import morrendoUrl from "../assets/audio/porco_morrendo.mp3";
import trilhaUrl from "../assets/audio/trilha_do_javali.mp3";
import trilhaZumbiUrl from "../assets/audio/lua_de_ossos.mp3";
import berroUrl from "../assets/audio/alce_berro.mp3";
import passarosUrl from "../assets/audio/passaros_dia.mp3";
import grilosUrl from "../assets/audio/grilos_noite.mp3";
import lobosUrl from "../assets/audio/lobos_uivo.mp3";
import loboAlcateiaUrl from "../assets/audio/lobo_alcateia_uivo.mp3";
import loboMorteUrl from "../assets/audio/lobo_morte_uivo.mp3";
import playerMorteUrl from "../assets/audio/player_morte_grunt.mp3";

const TAU = Math.PI * 2;

/** Volume da trilha de fundo. Um pouco abaixo para os ambientes respirarem. */
const MUSIC_VOLUME_DAY = 0.09;
/** Noite dos zumbis: a trilha sobe um pouco — é ela que carrega o clima. */
const MUSIC_VOLUME_ZOMBIE = 0.14;
const BIRDS_VOLUME = 0.5;
const CRICKETS_VOLUME = 0.18;
/** Uivos distantes de matilha — espaçados, só para o clima aterrorizante. */
const AMBIENT_HOWL_MIN_INTERVAL = 22;
const AMBIENT_HOWL_MAX_INTERVAL = 55;
const AMBIENT_HOWL_VOLUME = 0.62;

function makeNoiseBuffer(ctx, duration, type = "impact") {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / length;
    const env =
      type === "bow"
        ? Math.exp(-t * 14) * (1 - t * 0.3)
        : Math.exp(-t * 8) * (1 - t * 0.5);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  return buffer;
}

/**
 * O rugido do jetpack — um segundo, feito para dar LOOP contínuo.
 *
 * Ruído rosa (graves reforçados) atravessado por um zumbido baixo. O ruído
 * branco puro sai fino demais e lê como chiado de rádio; o que faz um motor de
 * foguete soar como motor é a energia embaixo.
 *
 * As duas pontas são casadas em `crossfade`: um buffer que começa e termina em
 * amostras diferentes estala a cada volta, e a cada volta significa uma vez por
 * segundo enquanto o jogador voa.
 */
function makeJetBuffer(ctx) {
  const duration = 1.0;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  // Filtro de um polo: transforma ruído branco em rosa, barato.
  let low = 0;
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const branco = Math.random() * 2 - 1;
    low = low * 0.92 + branco * 0.08;
    phase += (TAU * 58) / sampleRate; // zumbido grave do fluxo
    data[i] = low * 2.6 + Math.sin(phase) * 0.09;
  }

  // Casa o fim com o começo para o loop não estalar.
  const crossfade = Math.floor(sampleRate * 0.05);
  for (let i = 0; i < crossfade; i++) {
    const k = i / crossfade;
    data[i] = data[i] * k + data[length - crossfade + i] * (1 - k);
  }
  return buffer;
}

/** Sopro curto de lâmina atravessando o ar. */
function makeKnifeSwingBuffer(ctx) {
  const duration = 0.28;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    const envelope = Math.sin(Math.PI * p) ** 1.35;
    const frequency = 620 - 360 * p;
    phase += (TAU * frequency) / sampleRate;
    const hiss = (Math.random() * 2 - 1) * 0.34;
    data[i] = (hiss + Math.sin(phase) * 0.16) * envelope;
  }
  return buffer;
}

function makeToneBuffer(ctx, freq, duration) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 10);
    data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.4;
  }
  return buffer;
}

/**
 * Um berro/guincho de bicho, sintetizado a partir de uma envoltória de altura.
 *
 * Todos os gritos do jogo têm a mesma forma: uma voz harmônica cuja frequência
 * cai ao longo do som, um vibrato que a faz soar viva, e um chiado somado por
 * cima que dá a aspereza da garganta. Mudando quatro números sai desde o
 * guincho agudo do pássaro até o berro grave do alce — e é uma função pura do
 * tempo, então não depende de arquivo nenhum e nunca chega atrasada.
 */
/**
 * Trovão: estalo seco + ronco grave que se arrasta.
 *
 * Ruído filtrado por envoltória, não um tom — trovão real não tem nota. O
 * primeiro pico é o "crack" próximo; o resto é o eco longo no vale.
 */
function makeThunderBuffer(ctx) {
  const duration = 2.8;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  let low = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const white = Math.random() * 2 - 1;
    // Passa-baixa barato: o corpo do trovão vive abaixo de ~200 Hz.
    low += (white - low) * 0.045;
    const crack = white * Math.exp(-t * 28) * 0.85;
    const boom =
      low *
      (Math.exp(-t * 1.8) * 0.7 +
        Math.exp(-Math.max(0, t - 0.35) * 2.4) * 0.55 +
        Math.exp(-Math.max(0, t - 0.9) * 1.6) * 0.35);
    const rumble =
      Math.sin(TAU * (38 - 12 * Math.min(1, t / duration)) * t) *
      Math.exp(-t * 1.1) *
      0.22;
    data[i] = Math.tanh((crack + boom + rumble) * 1.35);
  }
  return buffer;
}

/** Risada instável do chefão — aguda, quebrada, curta. */
function makeBossLaughBuffer(ctx) {
  const duration = 1.75;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    const burst = Math.sin(TAU * 7.5 * t) > 0.15 ? 1 : 0.35;
    const frequency =
      420 +
      180 * Math.sin(TAU * 2.8 * t) +
      90 * Math.sin(TAU * 11 * t) * (1 - p) +
      Math.sin(t * 19) * 55;
    phase += (TAU * frequency) / sampleRate;
    const voice =
      Math.sin(phase) * 0.42 +
      Math.sin(phase * 2.03) * 0.28 +
      Math.sin(phase * 3.11) * 0.16;
    const noise = (Math.random() * 2 - 1) * 0.22;
    const attack = Math.min(1, t / 0.04);
    const release = Math.pow(1 - p, 1.4);
    data[i] = (voice + noise) * attack * release * burst;
  }
  return buffer;
}

function makeCryBuffer(ctx, { duration, from, to, vibrato, rasp, growl = 0 }) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    // A queda é exponencial: a voz despenca no começo e depois se arrasta, que
    // é como um bicho perde o fôlego — uma rampa linear soa mecânica.
    const frequency =
      to + (from - to) * Math.pow(1 - p, 1.5) + Math.sin(t * vibrato) * from * 0.07 * (1 - p);
    phase += (TAU * frequency) / sampleRate;
    let voice =
      Math.sin(phase) * 0.54 +
      Math.sin(phase * 1.97) * 0.26 +
      Math.sin(phase * 3.04) * 0.12;
    // O "growl" é uma modulação subgrave: é ela que separa um berro de peito de
    // um assobio. Sem isso o alce soa como um pássaro grande.
    if (growl > 0) voice *= 1 - growl + growl * (0.5 + 0.5 * Math.sin(TAU * 34 * t));
    const noise = (Math.random() * 2 - 1) * rasp;
    const attack = Math.min(1, t / 0.02);
    const release = Math.pow(1 - p, 1.7);
    data[i] = (voice + noise) * attack * release;
  }
  return buffer;
}

/**
 * Pancada seca: a cabeçada do alce.
 *
 * Sem altura definida de propósito — um impacto não tem nota. São duas camadas
 * com envoltórias diferentes: um estalo agudo de contato (a galhada) que morre
 * em 40 ms, e um baque grave de corpo que se arrasta. Juntas dão o "toc-BUM"
 * que o ouvido lê como algo pesado acertando algo mole.
 */
/**
 * O zumbido de um disco voador.
 *
 * A assinatura sonora de "nave alienígena" não é motor: é um tom PURO batendo
 * contra outro quase igual. As duas senoides desafinadas produzem um batimento
 * lento, e a modulação em anel por cima acrescenta a bordinha metálica que um
 * motor de avião — ruído de banda larga — nunca tem. É a diferença entre "algo
 * voando" e "algo voando que não é daqui".
 */
function makeUfoBuffer(ctx) {
  const duration = 2.4;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    const wob = Math.sin(TAU * 1.6 * t) * 22; // vibrato lento na altura
    const voz =
      Math.sin(TAU * (196 + wob) * t) * 0.5 +
      Math.sin(TAU * (203 + wob) * t) * 0.5; // 7 Hz de batimento entre as duas
    const anel = 0.72 + 0.28 * Math.sin(TAU * 42 * t);
    // Entra e sai suave: a nave se aproxima e passa, não liga e desliga.
    const env = Math.sin(Math.PI * p) ** 0.9;
    data[i] = voz * anel * env * 0.7;
  }
  return buffer;
}

/**
 * A voz do alien: curta, aguda e quebrada.
 *
 * Um trinado descendente com salto de oitava no meio — o salto é o que a faz
 * soar como fala de bicho e não como apito. O chiado somado dá a garganta.
 */
function makeAlienChirpBuffer(ctx) {
  const duration = 0.55;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    const salto = p > 0.45 && p < 0.7 ? 1.55 : 1;
    const freq = (880 - 380 * p) * salto + Math.sin(t * 70) * 60;
    phase += (TAU * freq) / sampleRate;
    const voz = Math.sin(phase) * 0.62 + Math.sin(phase * 2.7) * 0.2;
    const chiado = (Math.random() * 2 - 1) * 0.12;
    const env = Math.min(1, t / 0.015) * Math.pow(1 - p, 1.4);
    data[i] = (voz + chiado) * env;
  }
  return buffer;
}

/**
 * O ABATIMENTO DO ALIEN: o guincho que quebra no meio e derrete.
 *
 * Três coisas em sequência, e a ordem é o som inteiro:
 *
 * 1. um GUINCHO que despenca de 1.100 para 140 Hz em meio segundo — é a mesma
 *    voz de `makeAlienChirpBuffer`, só que caindo em vez de trinar. Quem já
 *    ouviu o bicho falar reconhece que é ele morrendo, e não outra coisa;
 * 2. uma QUEBRA: a modulação em anel acelera de 30 para 140 Hz no meio da
 *    queda, e o timbre desmancha em vez de simplesmente descer. É o instante em
 *    que a coisa deixa de estar viva;
 * 3. o BORBULHAR do fim — ruído filtrado com um passa-baixa que fecha, sobre um
 *    grave que some. É ele que casa com o derretimento que o corpo faz na tela.
 *
 * Nada disso é humano de propósito: o grito do arqueiro (`playerDeath`) e o
 * berro do alce ocupam a faixa da voz, e um alien que morresse ali soaria como
 * mais um bicho. Ele morre ACIMA e ao lado dessa faixa.
 */
function makeAlienDeathBuffer(ctx) {
  const duration = 0.95;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;
  let lp = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;

    // A queda: rápida no começo, arrastada no fim — a mesma curva da voz que
    // perde força em `makeCryBuffer`, só que uma oitava e meia acima.
    const freq = 140 + 960 * Math.pow(1 - p, 2.2) + Math.sin(t * 46) * 90 * (1 - p);
    phase += (TAU * freq) / sampleRate;
    const voz = Math.sin(phase) * 0.6 + Math.sin(phase * 2.3) * 0.22;

    // O anel acelera: 30 Hz (bordinha metálica) → 140 Hz (timbre desmanchando).
    const anel = 0.55 + 0.45 * Math.sin(TAU * (30 + 110 * p) * t);

    // O borbulhar, que só entra na segunda metade.
    const branco = Math.random() * 2 - 1;
    lp += (branco - lp) * (0.5 - 0.42 * p); // o filtro fecha com o tempo
    const gosma = lp * Math.max(0, p - 0.35) * 1.9;

    const ataque = Math.min(1, t / 0.012);
    const queda = Math.pow(1 - p, 1.3);
    data[i] = Math.tanh((voz * anel + gosma) * ataque * queda * 1.5);
  }
  return buffer;
}

/**
 * O ronco da nave de transporte — a grande, a que pousa.
 *
 * Ela NÃO pode soar como o disco voador: os dois estão no céu ao mesmo tempo e
 * fazem coisas opostas (um passa e some, a outra pousa e espera). A diferença é
 * de FAIXA e de textura — onde o disco é um tom puro agudo com batimento, esta é
 * um acorde grave (55/82/110 Hz) sobre um jato de ruído, com um throb lento de
 * 5 Hz por cima. Grave = pesada; ruído = motor de verdade; throb = turbina.
 */
function makeDropshipBuffer(ctx) {
  const duration = 2.8;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let lp = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    const deriva = Math.sin(TAU * 0.4 * t) * 3; // o motor não é um metrônomo
    const motor =
      Math.sin(TAU * (55 + deriva) * t) * 0.42 +
      Math.sin(TAU * (82.5 + deriva) * t) * 0.26 +
      Math.sin(TAU * (110 + deriva * 2) * t) * 0.16;

    // O jato: ruído bem filtrado, o ar (ou o propelente) saindo sob pressão.
    const branco = Math.random() * 2 - 1;
    lp += (branco - lp) * 0.045;
    const jato = lp * 0.75;

    const throb = 0.78 + 0.22 * Math.sin(TAU * 5 * t);
    // Entra e sai suave, para as repetições emendarem sem estalo.
    const env = Math.sin(Math.PI * p) ** 0.7;
    data[i] = Math.tanh((motor + jato) * throb * env * 1.15);
  }
  return buffer;
}

/**
 * O meteorito estourando: PEDRA, não metal.
 *
 * A explosão da nave (`makeExplosionBuffer`) é fogo — estalo e ronco. Uma rocha
 * partindo é outra coisa: um CRACK seco e curto, e depois o CASCALHO, que é o
 * som que conta a história. O cascalho aqui são impulsos sorteados (~90 por
 * segundo, ralentando) de ruído bem curto: cada um é um pedaço batendo em outro,
 * e é a irregularidade deles que soa como pedra se despedaçando em vez de
 * chiado. O grave por baixo dá o tamanho — sem ele, três metros de rocha soariam
 * como um vaso quebrando.
 */
function makeRockBurstBuffer(ctx) {
  const duration = 1.6;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  let low = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    const branco = Math.random() * 2 - 1;

    // 1. O crack: banda larga, morto em 60 ms.
    const crack = branco * Math.exp(-t * 46) * 0.95;

    // 2. O corpo grave, que dá a massa da rocha.
    low += (branco - low) * 0.07;
    const corpo = low * Math.exp(-t * 3.4) * 0.8;
    const ronco = Math.sin(TAU * (44 - 20 * p) * t) * Math.exp(-t * 3.8) * 0.28;

    // 3. O cascalho: a chance de um novo impulso cai com o tempo, então os
    //    pedaços vão rareando — como cascalho de verdade assentando.
    const densidade = 0.09 * Math.exp(-t * 1.7);
    const lasca =
      Math.random() < densidade ? (Math.random() * 2 - 1) * (0.5 - 0.32 * p) : 0;

    data[i] = Math.tanh((crack + corpo + ronco + lasca) * 1.35);
  }
  return buffer;
}

/**
 * Explosão: estalo seco na frente, estrondo grave arrastando atrás.
 *
 * Sem altura definida — explosão não tem nota. O que a torna GRANDE é a cauda:
 * o estalo sozinho lê como tiro, e é o ronco de meio segundo depois dele que
 * diz "aquilo era do tamanho de uma nave".
 */
function makeExplosionBuffer(ctx) {
  const duration = 1.8;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  let low = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const branco = Math.random() * 2 - 1;
    low += (branco - low) * 0.05;
    const estalo = branco * Math.exp(-t * 34) * 0.9;
    const corpo =
      low * (Math.exp(-t * 2.6) * 0.9 + Math.exp(-Math.max(0, t - 0.3) * 1.7) * 0.5);
    const ronco =
      Math.sin(TAU * (52 - 26 * Math.min(1, t / duration)) * t) *
      Math.exp(-t * 2.2) *
      0.3;
    data[i] = Math.tanh((estalo + corpo + ronco) * 1.4);
  }
  return buffer;
}

function makeThumpBuffer(ctx) {
  const duration = 0.55;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const estalo = (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.7;
    const baque =
      Math.sin(TAU * (64 - 28 * Math.min(1, t / duration)) * t) * Math.exp(-t * 11);
    data[i] = Math.tanh((estalo + baque) * 1.2);
  }
  return buffer;
}

/** Toque de trompa: duas notas curtas, o aviso de onda nova na caçada. */
function makeHornBuffer(ctx) {
  const duration = 1.0;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  // Quinta ascendente: o intervalo de chamada de caça, curto e reconhecível.
  const notas = [
    { inicio: 0.0, dur: 0.32, freq: 196.0 },
    { inicio: 0.3, dur: 0.62, freq: 293.66 },
  ];
  for (const n of notas) {
    const de = Math.floor(n.inicio * sampleRate);
    const ate = Math.min(length, Math.ceil((n.inicio + n.dur) * sampleRate));
    for (let i = de; i < ate; i++) {
      const t = (i - de) / sampleRate;
      const p = t / n.dur;
      const ataque = Math.min(1, t / 0.03);
      const solta = Math.pow(Math.max(0, 1 - p), 1.6);
      const fase = TAU * n.freq * t;
      const voz =
        Math.sin(fase) * 0.6 + Math.sin(fase * 2) * 0.28 + Math.sin(fase * 3) * 0.12;
      data[i] += voz * ataque * solta * 0.5;
    }
  }
  return buffer;
}

/**
 * Fanfarra de vitória: quatro notas de trompa em fila, como cornetas reais
 * anunciando o fim da caçada — mais longa e mais cheia do que o toque curto
 * de `makeHornBuffer`, que é só um aviso de "chegou gente".
 */
function makeFanfareBuffer(ctx) {
  const duration = 2.3;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  // Tônica, quinta, oitava e o remate na décima — a fórmula clássica de
  // fanfarra de trompete, com a última nota segurada mais tempo.
  const notas = [
    { inicio: 0.0, dur: 0.26, freq: 261.63 },
    { inicio: 0.24, dur: 0.26, freq: 329.63 },
    { inicio: 0.48, dur: 0.26, freq: 392.0 },
    { inicio: 0.72, dur: 1.15, freq: 523.25 },
  ];
  for (const n of notas) {
    const de = Math.floor(n.inicio * sampleRate);
    const ate = Math.min(length, Math.ceil((n.inicio + n.dur) * sampleRate));
    for (let i = de; i < ate; i++) {
      const t = (i - de) / sampleRate;
      const p = t / n.dur;
      const ataque = Math.min(1, t / 0.02);
      const solta = Math.pow(Math.max(0, 1 - p), 1.3);
      const fase = TAU * n.freq * t;
      // Quatro harmônicas somadas dão o timbre metálico de trompa/corneta —
      // uma senoide pura soa a apito, não a metal.
      const voz =
        Math.sin(fase) * 0.5 +
        Math.sin(fase * 2) * 0.26 +
        Math.sin(fase * 3) * 0.16 +
        Math.sin(fase * 4) * 0.08;
      data[i] += voz * ataque * solta * 0.55;
    }
  }
  return buffer;
}

/** Guincho curto, descendente e áspero — reserva caso o mp3 não decodifique. */
function makeBoarDeathBuffer(ctx) {
  const duration = 0.9;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const p = t / duration;
    const frequency =
      520 - 330 * p + Math.sin(t * 48) * 45 * (1 - p);
    phase += (Math.PI * 2 * frequency) / sampleRate;
    const voice =
      Math.sin(phase) * 0.56 +
      Math.sin(phase * 1.93) * 0.24 +
      Math.sin(phase * 3.07) * 0.1;
    const rasp = (Math.random() * 2 - 1) * 0.16;
    const attack = Math.min(1, t / 0.025);
    const release = Math.pow(1 - p, 1.8);
    data[i] = (voice + rasp) * attack * release;
  }
  return buffer;
}

/**
 * Fatia um buffer nas ilhas de som, separadas por silêncio.
 *
 * Varre a envoltória de energia em janelas de 20 ms, marca o que está acima de
 * um limiar relativo ao pico e agrupa as janelas vizinhas. Trechos curtos demais
 * (< 250 ms) são descartados: são respiração e ruído de fundo, não berro.
 *
 * Devolve no máximo `max` trechos, os mais LONGOS — que são os berros inteiros;
 * os curtos costumam ser o fim de um que já foi capturado.
 */
function sliceByEnergy(ctx, buffer, max) {
  const dados = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const janela = Math.floor(sr * 0.02);
  const n = Math.floor(dados.length / janela);
  if (n < 4) return [];

  const energia = new Float32Array(n);
  let pico = 0;
  for (let j = 0; j < n; j++) {
    let soma = 0;
    const de = j * janela;
    for (let i = de; i < de + janela; i++) soma += dados[i] * dados[i];
    energia[j] = Math.sqrt(soma / janela);
    if (energia[j] > pico) pico = energia[j];
  }
  if (pico <= 1e-5) return [];

  // 8 % do pico: alto o bastante para ignorar chiado, baixo o bastante para não
  // cortar o fim do berro, que morre devagar.
  const limiar = pico * 0.08;
  const ilhas = [];
  let inicio = -1;
  // Tolera até 8 janelas (160 ms) de silêncio dentro do mesmo berro: um alce
  // respira no meio do som, e cortar ali partiria o berro em dois.
  let quietas = 0;
  for (let j = 0; j < n; j++) {
    if (energia[j] >= limiar) {
      if (inicio < 0) inicio = j;
      quietas = 0;
    } else if (inicio >= 0 && ++quietas > 8) {
      ilhas.push([inicio, j - quietas]);
      inicio = -1;
    }
  }
  if (inicio >= 0) ilhas.push([inicio, n - 1]);

  const minJanelas = Math.ceil(0.25 / 0.02);
  const bons = ilhas
    .filter(([a, b]) => b - a >= minJanelas)
    .sort((p, q) => q[1] - q[0] - (p[1] - p[0]))
    .slice(0, max);
  if (!bons.length) return [];

  return bons.map(([a, b]) => {
    // Uma janela de folga dos dois lados, para não cortar o ataque nem a cauda.
    const de = Math.max(0, (a - 1) * janela);
    const ate = Math.min(dados.length, (b + 2) * janela);
    const trecho = ctx.createBuffer(1, ate - de, sr);
    const saida = trecho.getChannelData(0);
    for (let i = 0; i < ate - de; i++) {
      const t = i / (ate - de);
      // Rampa curta nas pontas: sem ela o corte estala, e um estalo no começo
      // de um berro soa como o alto-falante batendo.
      const env = Math.min(1, t / 0.02) * Math.min(1, (1 - t) / 0.05);
      saida[i] = dados[de + i] * env;
    }
    return trecho;
  });
}

/* A trilha de fundo é um ARQUIVO, não síntese.

   Havia aqui uma trilha inteira gerada por código — tambor, baixo e sopro em Ré
   menor, umas noventa linhas. Ela existia para não depender de asset externo, e
   cumpriu esse papel enquanto não havia música de verdade. Agora há: a
   `trilha_do_javali.mp3` entra no lugar dela, e manter as duas seria guardar um
   gerador de música que nunca mais tocaria uma nota. */

export class AudioSystem {
  constructor(camera, scene) {
    this.scene = scene;
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.unlocked = false;
    this.musicEnabled = true;
    this.buffers = {};
    this.pool = [];
    this.maxVoices = 16;

    /* --------------------------------------------------- vozes dedicadas ---
       Alguns sons são CONTÍNUOS e numerosos, e por isso não podem disputar o
       pool geral de 16: na horda 10 são vinte e um zumbis gemendo, uns três por
       segundo, cada gemido durando 1,6 s. Sozinhos eles ocupariam o pool
       inteiro, e o estalo da corda — o som de que o jogo mais depende —
       simplesmente não sairia.

       A regra do pool dedicado é diferente da do geral: aqui a voz mais antiga
       é ROUBADA quando todas estão ocupadas. Um gemido cortado no meio por
       outro gemido é o som certo para uma horda; um gemido que impede um
       disparo de ser ouvido, não.

       As vozes são criadas sob demanda (na primeira vez que o modo roda) porque
       um `PositionalAudio` cria um nó de panner no contexto de áudio, e quem
       nunca entrar no modo zumbi não deve pagar por oito deles. */
    this.dedicated = new Map();
    this.dedicatedSize = {
      zombieMoan: 8,
      bossMoan: 2,
      bossLaugh: 1,
      elkVoice: 4,
      wolfHowl: 6,
      // Seis aliens falando ao mesmo tempo comeriam o pool geral; a nave
      // reemite o zumbido a cada dois segundos enquanto atravessa o céu.
      alienChirp: 4,
      ufoHum: 2,
      // A nave de transporte é UMA só, e o ronco dela se repete enquanto ela
      // estiver em cena: duas vozes bastam para uma repetição emendar na outra.
      dropshipHum: 2,
    };

    this._initBuffers();

    /* A trilha de fundo.
     *
     * `setLoop(true)` é o que faz a música recomeçar sozinha ao terminar, sem
     * emenda audível — o Web Audio repete o mesmo buffer no próprio relógio da
     * placa, então não existe o pulinho de um `ended` tratado em JavaScript.
     *
     * O volume é DELIBERADAMENTE baixo. A música é fundo: o que precisa ser
     * ouvido é o estalo da corda, a flecha cravando e o berro do bicho, e são
     * eles que dizem ao jogador o que acabou de acontecer. Uma trilha no mesmo
     * nível dos efeitos os encobre e o jogo fica mudo justamente nos instantes
     * que importam. */
    this.music = new THREE.Audio(this.listener);
    this.music.setLoop(true);
    this.music.setVolume(MUSIC_VOLUME_DAY);
    /* Duas trilhas no mesmo `Audio`: a do dia (`trilha_do_javali`) e a da noite
       dos zumbis (`lua_de_ossos`). Só uma toca por vez — a troca é em
       `setAmbientNight`, que também cala os pássaros e deixa os grilos. */
    this._musicTrack = "day"; // "day" | "zombie"
    this._musicBuffers = { day: null, zombie: null };
    // Só toca quando o arquivo chegar; `startMusic` é chamado de novo por conta
    // disso, porque o desbloqueio do áudio costuma acontecer antes do download.
    this._loadMusic("day", trilhaUrl);
    this._loadMusic("zombie", trilhaZumbiUrl);

    /* Ambientes de natureza — em paralelo com a trilha, trocam com o modo. */
    this.birds = new THREE.Audio(this.listener);
    this.birds.setLoop(true);
    this.birds.setVolume(BIRDS_VOLUME);
    this.crickets = new THREE.Audio(this.listener);
    this.crickets.setLoop(true);
    this.crickets.setVolume(CRICKETS_VOLUME);
    this._ambientMode = "day"; // "day" | "night"
    /** Fase sem ar: cala TODOS os ambientes. Ver `setAmbientSpace`. */
    this._ambientSpace = false;
    this._ambientHowlTimer = 0;
    this.howlClips = null;
    this._loadAmbient(this.birds, passarosUrl, () => this._syncAmbient());
    this._loadAmbient(this.crickets, grilosUrl, () => this._syncAmbient());
    this._loadAmbientHowls();

    gameEvents.on(EventType.ARROW_SHOT, (e) => {
      if (e.origin) this.play3D("bow", e.origin, 0.85);
    });
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (!e.impact) return;
      const pos = e.impact;
      if (e.targetKind === "target") this.play3D("hitTarget", pos, 1);
      else if (e.targetKind === "boar") this.play3D("hitBoar", pos, 1.1);
      // Alce: nenhum baque sintético no impacto — o berro MP3 sai só do
      // evento da sala (ELK_HIT), para todo mundo ouvir o mesmo grito.
      else if (e.targetKind === "elk") return;
      else if (e.targetKind === "bird") this.play3D("hitBoar", pos, 0.5);
      else if (e.targetKind === "character") this.play3D("hitCharacter", pos, 1);
      else this.play3D("hitScenery", pos, 0.7);
    });
    gameEvents.on(EventType.BOAR_DEATH, (e) => {
      if (e.impact) this.play3D("boarDeath", e.impact, 1.15);
    });
    gameEvents.on(EventType.AUDIO_PLAY, (e) => {
      if (e.position && e.sound) {
        this.play3D(e.sound, e.position, e.volume ?? 1, e.variant ?? null);
      }
    });
  }

  _initBuffers() {
    this.buffers.bow = makeNoiseBuffer(this.ctx, 0.12, "bow");
    this.buffers.hitTarget = makeNoiseBuffer(this.ctx, 0.18, "impact");
    this.buffers.hitBoar = makeToneBuffer(this.ctx, 90, 0.22);
    this.buffers.boarDeath = makeBoarDeathBuffer(this.ctx);
    this.buffers.hitCharacter = makeToneBuffer(this.ctx, 120, 0.2);
    this.buffers.hitScenery = makeNoiseBuffer(this.ctx, 0.14, "impact");
    this.buffers.knifeSwing = makeKnifeSwingBuffer(this.ctx);
    this.buffers.jet = makeJetBuffer(this.ctx);

    // A Lua: a nave que passa, o alien que fala e o que estoura.
    this.buffers.ufoHum = makeUfoBuffer(this.ctx);
    this.buffers.alienChirp = makeAlienChirpBuffer(this.ctx);
    this.buffers.alienDeath = makeAlienDeathBuffer(this.ctx);
    this.buffers.explosion = makeExplosionBuffer(this.ctx);
    // A nave grande tem motor próprio, e a rocha se parte com som de rocha.
    this.buffers.dropshipHum = makeDropshipBuffer(this.ctx);
    this.buffers.rockBurst = makeRockBurstBuffer(this.ctx);

    // Alce: berro de peito, grave e com rosnado. O de dor é curto e sobe de
    // volta; o de morte é longo e só desce.
    this.buffers.elkPain = makeCryBuffer(this.ctx, {
      duration: 1.1,
      from: 210,
      to: 120,
      vibrato: 26,
      rasp: 0.14,
      growl: 0.45,
    });
    this.buffers.elkDeath = makeCryBuffer(this.ctx, {
      duration: 1.9,
      from: 195,
      to: 62,
      vibrato: 17,
      rasp: 0.18,
      growl: 0.6,
    });
    // `elkHit` sintético removido: no acerto só toca o MP3 (`elkVoice`).
    // Pássaro: guincho curto e agudo, sem rosnado.
    this.buffers.birdDeath = makeCryBuffer(this.ctx, {
      duration: 0.42,
      from: 2100,
      to: 640,
      vibrato: 90,
      rasp: 0.06,
    });

    /* Morte de gente. Um grito curto, na faixa da voz humana e sem o rosnado
       subgrave dos bichos — é o que impede que ele soe como um alce pequeno.
       Toca em TODA morte, seja por flecha ou por cabeçada: é o aviso de que
       alguém caiu, e quem está de costas só tem o som para saber disso. */
    this.buffers.playerDeath = makeCryBuffer(this.ctx, {
      duration: 0.75,
      from: 330,
      to: 138,
      vibrato: 34,
      rasp: 0.12,
    });

    /* Zumbi. O gemido é o oposto de um grito: quase não muda de altura (de 128
       para 96 Hz), tem vibrato lento e MUITO rosnado — é o rosnado que faz a
       garganta soar sem fôlego. Vibrato rápido daria dor; aqui não há dor,
       há um som que não termina.

       Como ele é grave e o som é 3D, é ele que anuncia a horda antes dos olhos:
       o jogador ouve de que lado vêm antes de ver o primeiro par de vermelhos. */
    this.buffers.zombieMoan = makeCryBuffer(this.ctx, {
      duration: 1.6,
      from: 128,
      to: 96,
      vibrato: 9,
      rasp: 0.22,
      growl: 0.72,
    });
    // A morte desce até quase nada e se arrasta: o ar saindo.
    this.buffers.zombieDeath = makeCryBuffer(this.ctx, {
      duration: 1.15,
      from: 150,
      to: 44,
      vibrato: 13,
      rasp: 0.3,
      growl: 0.8,
    });

    this.buffers.bossMoan = makeCryBuffer(this.ctx, {
      duration: 2.25,
      from: 72,
      to: 46,
      vibrato: 6,
      rasp: 0.38,
      growl: 0.96,
    });
    this.buffers.bossLaugh = makeBossLaughBuffer(this.ctx);
    this.buffers.bossDeath = makeCryBuffer(this.ctx, {
      duration: 1.45,
      from: 88,
      to: 24,
      vibrato: 8,
      rasp: 0.42,
      growl: 1.0,
    });
    this.buffers.thunder = makeThunderBuffer(this.ctx);

    /* Lobo: fallback sintetizado até os MP3 chegarem. */
    this.buffers.wolfHowl = makeCryBuffer(this.ctx, {
      duration: 1.05,
      from: 780,
      to: 420,
      vibrato: 38,
      rasp: 0.1,
      growl: 0.15,
    });
    this.buffers.wolfDeath = makeCryBuffer(this.ctx, {
      duration: 0.78,
      from: 1100,
      to: 380,
      vibrato: 55,
      rasp: 0.12,
      growl: 0.1,
    });

    // A cabeçada: pancada seca, sem altura definida. Galhada em corpo.
    this.buffers.elkGore = makeThumpBuffer(this.ctx);

    // Toque curto de trompa: anuncia a onda nova da caçada.
    this.buffers.waveHorn = makeHornBuffer(this.ctx);

    // Fanfarra: a caçada acabou, com direito a tela de vitória.
    this.buffers.victoryFanfare = makeFanfareBuffer(this.ctx);

    // Os gravados chegam depois; até lá tocam as versões sintetizadas (ou nada,
    // no caso do ronco, que não tem substituto — melhor mudo que errado).
    this._loadFile("boarDeath", morrendoUrl);
    this._loadFile("boarIdle", roncoUrl);
    this._loadFile("wolfHowl", loboAlcateiaUrl);
    this._loadFile("wolfDeath", loboMorteUrl);
    this._loadFile("playerDeath", playerMorteUrl);
    this._loadElkVoice();
  }

  /* ------------------------------------------------------ a voz do alce ---
   *
   * O berro gravado (`alce_berro.mp3`) é um arquivo LONGO com vários berros
   * seguidos. Tocá-lo inteiro a cada susto daria dez segundos de alce por uma
   * flechada — então ele é FATIADO em oito trechos, e cada evento sorteia um.
   *
   * O corte é por energia, não por tempo fixo: o arquivo é varrido procurando
   * os silêncios, e cada ilha de som vira um trecho. Um corte cego em oito
   * pedaços iguais cairia no meio de um berro na metade das vezes, e meio berro
   * seguido de silêncio soa como falha de áudio.
   *
   * Falhou o download, ou o arquivo não tem trechos utilizáveis? Ficam os
   * berros sintetizados de `makeCryBuffer`, que já existiam. O jogo nunca fica
   * mudo por causa de um asset.
   */
  async _loadElkVoice() {
    try {
      const resposta = await fetch(berroUrl);
      const bytes = await resposta.arrayBuffer();
      const inteiro = await this.ctx.decodeAudioData(bytes);
      const trechos = sliceByEnergy(this.ctx, inteiro, 8);
      if (trechos.length) this.elkVoiceClips = trechos;
    } catch {
      /* fica com os berros sintetizados */
    }
  }

  /**
   * Um berro do alce, sorteado entre os trechos do gravado.
   *
   * `tipo` escolhe a FAIXA de trechos, não o trecho: os primeiros do arquivo são
   * mais curtos e agudos (servem para o susto da fuga), os últimos mais longos e
   * graves (servem para a investida e para a dor). É uma aproximação, e é
   * suficiente — o que o jogador precisa distinguir é a INTENSIDADE, e ela vem
   * junto do volume e do que está acontecendo na tela.
   */
  elkVoiceBuffer(tipo) {
    const clips = this.elkVoiceClips;
    if (!clips?.length) return null;
    const n = clips.length;
    const faixa = {
      flee: [0, Math.ceil(n * 0.5)],
      charge: [Math.floor(n * 0.4), n],
      hit: [Math.floor(n * 0.25), n],
    }[tipo] ?? [0, n];
    const [de, ate] = faixa;
    return clips[de + Math.floor(Math.random() * Math.max(1, ate - de))] ?? clips[0];
  }

  /**
   * Carrega um mp3 e o instala no lugar do buffer sintetizado.
   *
   * A decodificação é assíncrona e pode falhar (formato não suportado, arquivo
   * ausente num build recortado). Em nenhum dos casos o jogo pode parar por
   * causa de um som: o `catch` deixa o que já estava lá.
   */
  async _loadFile(id, url) {
    try {
      const resposta = await fetch(url);
      const bytes = await resposta.arrayBuffer();
      this.buffers[id] = await this.ctx.decodeAudioData(bytes);
    } catch {
      /* fica com o sintetizado, ou mudo se não houver */
    }
  }

  unlock() {
    if (this.unlocked) {
      this.startMusic();
      this._syncAmbient();
      return;
    }
    this.unlocked = true;
    const start = () => {
      this.startMusic();
      this._syncAmbient();
    };
    if (this.ctx.state === "suspended") {
      this.ctx.resume().then(start).catch(() => {});
    } else {
      start();
    }
  }

  /**
   * Baixa e guarda uma trilha (`day` ou `zombie`).
   *
   * Corre em paralelo com o resto da partida: o jogo entra em campo sem esperar
   * por megabytes de música, e ela começa a tocar quando chegar. Falhou o
   * download? O jogo continua, sem trilha — som de fundo nunca é motivo para
   * segurar ou quebrar uma partida.
   */
  async _loadMusic(track, url) {
    try {
      const resposta = await fetch(url);
      const bytes = await resposta.arrayBuffer();
      this._musicBuffers[track] = await this.ctx.decodeAudioData(bytes);
      // Só reaplica se esta for a trilha ativa — carregar a do zumbi no meio
      // do dia não pode trocar o que está tocando.
      if (this._musicTrack === track) this._applyMusicTrack();
    } catch {
      /* sem trilha; o jogo não sente */
    }
  }

  async _loadAmbient(audio, url, onReady) {
    try {
      const resposta = await fetch(url);
      const bytes = await resposta.arrayBuffer();
      audio.setBuffer(await this.ctx.decodeAudioData(bytes));
      onReady?.();
    } catch {
      /* sem ambiente */
    }
  }

  /**
   * Noite dos zumbis: grilos + `lua_de_ossos` em loop.
   * Dia (qualquer outro modo): pássaros + trilha original.
   */
  setAmbientNight(noite) {
    this._ambientMode = noite ? "night" : "day";
    this._musicTrack = noite ? "zombie" : "day";
    this.music.setVolume(noite ? MUSIC_VOLUME_ZOMBIE : MUSIC_VOLUME_DAY);
    this._ambientHowlTimer = noite ? this._nextAmbientHowlDelay() : 0;
    this._syncAmbient();
    this._applyMusicTrack();
  }

  /** Uivos de matilha distante — só no modo zumbi, entre um e outro com folga. */
  tickAmbient(dt, listenerPos) {
    if (this._ambientMode !== "night" || !this.unlocked || !listenerPos) return;
    this._ambientHowlTimer -= dt;
    if (this._ambientHowlTimer > 0) return;
    this._ambientHowlTimer = this._nextAmbientHowlDelay();
    this._playAmbientHowl(listenerPos);
  }

  _nextAmbientHowlDelay() {
    return (
      AMBIENT_HOWL_MIN_INTERVAL +
      Math.random() * (AMBIENT_HOWL_MAX_INTERVAL - AMBIENT_HOWL_MIN_INTERVAL)
    );
  }

  /**
   * Fatia o gravado de lobos em uivos isolados (mesma lógica do berro do alce).
   * Falhou? Fica mudo — os uivos posicionais dos lobos vivos ainda funcionam.
   */
  async _loadAmbientHowls() {
    try {
      const resposta = await fetch(lobosUrl);
      const bytes = await resposta.arrayBuffer();
      const inteiro = await this.ctx.decodeAudioData(bytes);
      const trechos = sliceByEnergy(this.ctx, inteiro, 6);
      if (trechos.length) this.howlClips = trechos;
    } catch {
      /* sem uivos ambientais */
    }
  }

  _playAmbientHowl(listenerPos) {
    const clips = this.howlClips;
    if (!clips?.length) return;
    const buffer = clips[Math.floor(Math.random() * clips.length)];
    const ang = Math.random() * TAU;
    const dist = 42 + Math.random() * 38;
    this._playClip3D(buffer, {
      x: listenerPos.x + Math.cos(ang) * dist,
      y: listenerPos.y + (Math.random() - 0.25) * 10,
      z: listenerPos.z + Math.sin(ang) * dist,
    }, AMBIENT_HOWL_VOLUME);
  }

  /**
   * Vácuo: NENHUM ambiente.
   *
   * Não é o mesmo que baixar o volume — é a ausência de meio. Sem ar não há o
   * que vibrar, e um loop de passarinhos na Lua é a coisa mais absurda que o
   * jogo poderia tocar. A trilha continua: música é do jogador, não do mundo.
   */
  /**
   * O jato queimando: um loop que liga e desliga com rampa.
   *
   * A rampa de 80 ms existe porque cortar um som contínuo no zero estala, e o
   * jetpack liga e desliga muitas vezes por voo — em pulsos, que é como ele foi
   * feito para ser usado. Um estalo por pulso seria insuportável.
   *
   * Não é 3D: é o SEU jetpack, preso às suas costas. Espacializá-lo faria o som
   * girar quando a câmera de terceira pessoa orbita, e o motor nas costas de
   * alguém não gira em volta da cabeça dele.
   */
  setJet(ligado, intensidade = 1) {
    if (!this.unlocked || !this.buffers.jet) return;

    if (!this._jetNode) {
      const fonte = this.ctx.createBufferSource();
      fonte.buffer = this.buffers.jet;
      fonte.loop = true;
      const ganho = this.ctx.createGain();
      ganho.gain.value = 0;
      fonte.connect(ganho).connect(this.ctx.destination);
      fonte.start();
      this._jetNode = { fonte, ganho };
    }

    const alvo = ligado ? 0.2 * intensidade : 0;
    const g = this._jetNode.ganho.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(alvo, this.ctx.currentTime, 0.08);
  }

  setAmbientSpace(vacuo) {
    this._ambientSpace = !!vacuo;
    this._syncAmbient();
  }

  _syncAmbient() {
    if (!this.unlocked) return;
    if (this._ambientSpace) {
      this._playOrStop(this.birds, false);
      this._playOrStop(this.crickets, false);
      return;
    }
    const dia = this._ambientMode !== "night";
    this._playOrStop(this.birds, dia);
    this._playOrStop(this.crickets, !dia);
  }

  /**
   * Coloca no `Audio` o buffer da trilha ativa e (re)inicia se a música
   * estiver ligada. Trocar buffer com o som tocando estala — por isso para,
   * troca e só então toca de novo.
   */
  _applyMusicTrack() {
    const buffer = this._musicBuffers[this._musicTrack];
    if (!buffer) return;

    const precisaTrocar = this.music.buffer !== buffer;
    if (precisaTrocar) {
      if (this.music.isPlaying) this.music.stop();
      this.music.setBuffer(buffer);
    }

    if (!this.unlocked || !this.musicEnabled) return;
    if (!this.music.isPlaying) this.music.play();
  }

  _playOrStop(audio, play) {
    if (!audio?.buffer) return;
    if (play) {
      if (!audio.isPlaying) audio.play();
    } else if (audio.isPlaying) {
      audio.stop();
    }
  }

  startMusic() {
    // O buffer da trilha ativa ainda pode ser null enquanto o mp3 não chegou —
    // tocar sem buffer lança, e este método é chamado tanto pelo desbloqueio
    // quanto pelo fim do download, sem ordem garantida entre os dois.
    this._applyMusicTrack();
    this._syncAmbient();
  }

  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    if (this.musicEnabled) this.startMusic();
    else if (this.music.isPlaying) this.music.stop();
    return this.musicEnabled;
  }

  /** Uma voz posicional nova, com o mesmo ajuste de distância de todas. */
  _newVoice() {
    const audio = new THREE.PositionalAudio(this.listener);
    audio.setRefDistance(3);
    audio.setRolloffFactor(1.2);
    audio.setMaxDistance(80);
    audio.setDistanceModel("inverse");
    return audio;
  }

  /**
   * O anel de vozes de um som contínuo. Ver o comentário no construtor.
   *
   * Devolve a voz mais antiga do anel, PARANDO-A se ainda estiver tocando —
   * é o roubo deliberado que mantém o pool geral livre para o que importa.
   */
  _dedicatedVoice(soundId) {
    let anel = this.dedicated.get(soundId);
    if (!anel) {
      const n = this.dedicatedSize[soundId];
      anel = { vozes: Array.from({ length: n }, () => this._newVoice()), next: 0 };
      this.dedicated.set(soundId, anel);
    }
    const audio = anel.vozes[anel.next];
    anel.next = (anel.next + 1) % anel.vozes.length;
    if (audio.isPlaying) audio.stop();

    /* Limpeza do som roubado.
     *
     * `Audio.stop()` do Three zera o `onended` do nó de origem — de propósito,
     * para um `stop` manual não disparar o callback de fim natural. O efeito
     * colateral é que o NOSSO `onEnded` também não roda, e com ele não roda a
     * remoção do `holder`. Sem esta limpeza, cada gemido interrompido deixaria
     * um `Object3D` vazio na cena; uma noite de dez hordas deixaria milhares. */
    const anterior = audio.userData.holder;
    if (anterior) {
      anterior.remove(audio);
      this.scene.remove(anterior);
      audio.userData.holder = null;
    }
    return audio;
  }

  /**
   * @param {string} soundId
   * @param {{x,y,z}} position
   * @param {number} [volume]
   * @param {string} [variante] qual sabor do som — hoje só a voz do alce usa
   *   (`flee`, `charge`, `hit`), para escolher a faixa de trechos do gravado.
   */
  play3D(soundId, position, volume = 1, variante = null) {
    if (!this.unlocked) return;

    /* A voz do alce não sai de `buffers`: ela sorteia um trecho do gravado a
       cada vez (ver `_loadElkVoice`). Quando o arquivo não chegou, cai no berro
       sintetizado de dor — que é o mais próximo dos três estados. */
    const buffer =
      soundId === "elkVoice"
        ? (this.elkVoiceBuffer(variante) ?? this.buffers.elkPain)
        : this.buffers[soundId];
    if (!buffer) return;

    const dedicado = this.dedicatedSize[soundId] !== undefined;
    this._playClip3D(buffer, position, volume, dedicado ? soundId : null, soundId);
  }

  /**
   * Toca um buffer já decodificado num ponto 3D.
   * @param {string|null} dedicatedId quando setado, usa o anel dedicado desse som.
   * @param {string} [soundId] id original — usado só para alcance 3D do chefão.
   */
  _playClip3D(buffer, position, volume = 1, dedicatedId = null, soundId = null) {
    const dedicado = dedicatedId != null;
    const audio = dedicado
      ? this._dedicatedVoice(dedicatedId)
      : (this.pool.pop() ?? this._newVoice());

    const holder = new THREE.Object3D();
    holder.position.set(position.x, position.y, position.z);
    holder.add(audio);
    this.scene.add(holder);
    audio.userData.holder = holder;

    audio.setBuffer(buffer);
    audio.setVolume(volume);
    /* Chefão: gemido longo e grave — precisa atravessar o vale. O pool padrão
       corta em 80 m; com spawn a ~130 m o som sumia até ele já estar perto. */
    const id = soundId ?? dedicatedId;
    if (id === "bossMoan" || id === "bossLaugh" || id === "bossDeath") {
      audio.setRefDistance(18);
      audio.setRolloffFactor(0.85);
      audio.setMaxDistance(220);
    } else if (id === "thunder") {
      /* Trovão atravessa o vale: o raio cai longe e ainda precisa soar. */
      audio.setRefDistance(28);
      audio.setRolloffFactor(0.7);
      audio.setMaxDistance(260);
    } else if (
      id === "ufoHum" ||
      id === "explosion" ||
      id === "dropshipHum" ||
      id === "rockBurst"
    ) {
      /* A nave cruza o céu a 50–80 m de altura e a explosão precisa ser ouvida
         do outro lado da arena. Com o alcance padrão (80 m) as duas sumiam
         justamente quando são o acontecimento da cena. Vale igual para o motor
         da nave de transporte (26 m de altitude em órbita, a 70 m da base) e
         para o meteorito se partindo lá em cima. */
      audio.setRefDistance(22);
      audio.setRolloffFactor(0.8);
      audio.setMaxDistance(240);
    } else {
      audio.setRefDistance(3);
      audio.setRolloffFactor(1.2);
      audio.setMaxDistance(80);
    }
    audio.setLoop(false);
    audio.play();

    /* O `onEnded` PADRÃO do Three é o único lugar que faz `isPlaying = false`, e
       o `play()` recusa (com aviso no console) quando a flag está ligada. Trocar
       o método sem chamar o original deixava toda voz do pool marcada como
       "tocando" para sempre depois do primeiro uso — o pool inteiro morria em
       silêncio depois de 16 sons. Não aparecia porque nada consultava a flag.
       Agora aparece: o modo zumbi dispara dezenas de gemidos por minuto.

       A voz dedicada NÃO volta para o pool geral (ela pertence ao anel dela),
       mas o `holder` sai da cena do mesmo jeito: sem isso, cada gemido deixaria
       um `Object3D` vazio para trás, e uma noite inteira de horda encheria a
       cena de milhares deles. */
    const encerrar = THREE.Audio.prototype.onEnded;
    const cena = this.scene;
    const pool = this.pool;
    audio.onEnded = function () {
      encerrar.call(this); // devolve `isPlaying` para false
      holder.remove(audio);
      cena.remove(holder);
      this.userData.holder = null;
      if (!dedicado) pool.push(audio);
    };
  }
}
