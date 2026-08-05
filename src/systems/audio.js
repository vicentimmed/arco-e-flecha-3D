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
import berroUrl from "../assets/audio/alce_berro.mp3";

const TAU = Math.PI * 2;

/** Volume da trilha de fundo. Ver o comentário em `AudioSystem` para o porquê. */
const MUSIC_VOLUME = 0.1;

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
    this.dedicatedSize = { zombieMoan: 8, elkVoice: 4 };

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
    this.music.setVolume(MUSIC_VOLUME);
    // Só toca quando o arquivo chegar; `startMusic` é chamado de novo por conta
    // disso, porque o desbloqueio do áudio costuma acontecer antes do download.
    this._loadMusic();

    gameEvents.on(EventType.ARROW_SHOT, (e) => {
      if (e.origin) this.play3D("bow", e.origin, 0.85);
    });
    gameEvents.on(EventType.ARROW_IMPACT, (e) => {
      if (!e.impact) return;
      const pos = e.impact;
      if (e.targetKind === "target") this.play3D("hitTarget", pos, 1);
      else if (e.targetKind === "boar") this.play3D("hitBoar", pos, 1.1);
      else if (e.targetKind === "elk") this.play3D("elkHit", pos, 1.2);
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
    this.buffers.elkHit = makeToneBuffer(this.ctx, 70, 0.26);
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
      return;
    }
    this.unlocked = true;
    const start = () => this.startMusic();
    if (this.ctx.state === "suspended") {
      this.ctx.resume().then(start).catch(() => {});
    } else {
      start();
    }
  }

  /**
   * Baixa e instala a trilha.
   *
   * Corre em paralelo com o resto da partida: o jogo entra em campo sem esperar
   * por seis megabytes de música, e ela começa a tocar quando chegar. Falhou o
   * download? O jogo continua, sem trilha — som de fundo nunca é motivo para
   * segurar ou quebrar uma partida.
   */
  async _loadMusic() {
    try {
      const resposta = await fetch(trilhaUrl);
      const bytes = await resposta.arrayBuffer();
      this.music.setBuffer(await this.ctx.decodeAudioData(bytes));
      this.startMusic();
    } catch {
      /* sem trilha; o jogo não sente */
    }
  }

  startMusic() {
    // `music.buffer` ainda é null enquanto o mp3 não chegou — tocar sem buffer
    // lança, e este método é chamado tanto pelo desbloqueio quanto pelo fim do
    // download, sem ordem garantida entre os dois.
    if (!this.unlocked || !this.musicEnabled || !this.music.buffer) return;
    if (this.music.isPlaying) return;
    this.music.play();
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
    const audio = dedicado
      ? this._dedicatedVoice(soundId)
      : (this.pool.pop() ?? this._newVoice());

    const holder = new THREE.Object3D();
    holder.position.set(position.x, position.y, position.z);
    holder.add(audio);
    this.scene.add(holder);
    audio.userData.holder = holder;

    audio.setBuffer(buffer);
    audio.setVolume(volume);
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
