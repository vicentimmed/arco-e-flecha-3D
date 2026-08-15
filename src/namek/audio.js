/* ---------------------------------------------------------------------------
   O som de Namekusei — inteiro sintetizado, sem um único arquivo.

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
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../shared/namek/config.js";

/** Vozes simultâneas do pool geral. */
const VOZES = 14;
/** m — além disto um som posicional não é criado. */
const ALCANCE = 240;

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

/** Dor: curto, grave, sem brilho. */
function dor(ctx) {
  const b = buffer(ctx, 0.3, (t) => {
    const env = Math.exp(-t * 12);
    return (Math.sin(2 * Math.PI * (150 * Math.exp(-t * 6) + 60) * t) * 0.7 + ruido() * 0.3) * env;
  });
  return normalizar(passaBaixa(b, 900), 0.9);
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

    /** Vozes contínuas, uma de cada: carga, feixe e vento. */
    this.loops = new Map();

    /* Cota por lutador na rajada. Com quinze em campo a seis bolas por segundo
       são noventa disparos por segundo; sem cota, o pool inteiro é consumido
       por quem está longe e a sua própria bola fica muda. */
    this._ultimoTiro = new Map();
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
      baque: baque(c),
      onda: ondaDeKi(c),
      trovao: trovao(c),
      vento: ventoDeVoo(c),
      dor: dor(c),
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

  /** Toca sem posição — o que acontece em VOCÊ, não no mundo. Ver `kiCheio`. */
  tocarNaCabeca(buf, vol = 1) {
    if (!this.ligado || !this.buf || !buf) return;
    const a = new THREE.Audio(this.listener);
    a.setBuffer(buf);
    a.setVolume(vol);
    a.play();
    /* Voz descartável, e é o único lugar em que isso se justifica: são sons
       raros (encher o ki, travar um alvo) e um pool de dois ficaria ocioso o
       jogo inteiro. O `onEnded` do Three já solta o nó de origem. */
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

  acertoNoCorpo(p, forte = false) {
    this.tocar(this.buf?.acerto, p, forte ? 0.8 : 0.5, forte ? 0.8 : 1 + Math.random() * 0.2);
  }

  /** O especial saindo. `kind` afina o disparo: cada golpe tem outro peso. */
  especial(p, kind) {
    if (!this.buf) return;
    const taxa = kind === "genki" ? 0.62 : kind === "galick" ? 0.85 : kind === "disk" ? 1.35 : 1;
    this.tocar(this.buf.disparo, p, 0.9, taxa);
  }

  /** Impacto no chão. A potência escolhe QUAL estouro, não só o volume. */
  estouroNoChao(p, power) {
    if (!this.buf) return;
    const b = power >= 8 ? this.buf.estouroG : power >= 2 ? this.buf.estouroM : this.buf.estouroP;
    this.tocar(b, p, Math.min(1, 0.55 + power * 0.05), 0.9 + Math.random() * 0.2);
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

  levouDano(p, forte) {
    this.tocar(this.buf?.dor, p, forte ? 0.85 : 0.55);
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
    if (!on) for (const [id] of this.loops) this.loop(id, false);
  }

  dispose() {
    for (const [, L] of this.loops) {
      clearTimeout(L.timer);
      if (L.a.isPlaying) L.a.stop();
    }
    this.loops.clear();
    for (const v of this.pool) {
      if (v.a.isPlaying) v.a.stop();
      v.suporte.parent?.remove(v.suporte);
    }
    this.pool.length = 0;
    this.listener.parent?.remove(this.listener);
  }
}
