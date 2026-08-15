/* ---------------------------------------------------------------------------
   O chão de Namekusei: relevo, montanhas, mar — e as crateras que o jogo abre.

   PURO. Nada de Three.js, nada de Rapier, nada de DOM. A sala roda em Node e
   precisa das mesmas alturas para nascer gente, pousar bot e decidir onde uma
   cratera cabe; a malha, as cores e a água moram em `src/namek/world/`, que só
   existe no navegador. É a mesma divisão que `shared/moonField.js` faz do lado
   do arqueiro, e o mesmo motivo.

   ------------------------------------------------------------------ o relevo

   Um planeta inteiro não cabe numa malha, então o que existe aqui é o recorte
   que o BT3 também usava: uma CLAREIRA no meio para a briga acontecer, um anel
   de montanhas para dar parede e escala, e o mar depois delas para fechar o
   horizonte sem uma borda reta.

       centro ─────────────────────────────────► borda
       clareira      serra + picos       praia        mar
       0–200 m       200–520 m           520–650 m    650 m+

   A clareira não é plana: ela ondula o suficiente para uma cratera ter onde
   aparecer. Terreno perfeitamente liso faz toda deformação parecer um erro de
   malha.

   ---------------------------------------------------------------- as crateras

   Cratera é ALTURA, não objeto — a mesma ideia da Lua. A diferença é que aqui
   elas nascem em jogo, e a pergunta que isso levanta é quanto custa carregá-las.

   **A resposta é um MAPA DE DESLOCAMENTO, e não uma lista.** A grade cobre a
   arena com célula de 2 m e guarda, em cada uma, quantos metros o chão baixou
   ali. Abrir uma cratera é assá-la na grade uma vez (`bakeCrater`); consultar
   a altura é ler quatro células e interpolar (`displacementAt`).

   O desenho anterior guardava a lista de crateras num índice espacial e somava,
   a cada `heightAt`, o efeito de todas as próximas. Isso tinha uma consequência
   que o jogo não queria: como o custo crescia com a destruição acumulada, era
   preciso APOSENTAR buracos — a 97ª cratera apagava a 1ª. O jogador via o
   planeta se regenerar sozinho enquanto olhava para ele.

   Com a grade, o custo de consultar é o mesmo com dez ou dez mil crateras, e
   por isso **nada é aposentado**: o que foi cavado fica cavado até o fim da
   partida. O que passou a ter teto é a PROFUNDIDADE (`DESL_MIN`), não a
   quantidade — insistir no mesmo ponto aprofunda o buraco até um limite, em
   vez de abrir um poço sem fundo.

   O registro `craters` continua existindo, mas só para a rede: é ele que viaja
   no `welcome` para quem entra no meio da partida. A grade em si tem 231 mil
   células e não caberia numa mensagem.
   --------------------------------------------------------------------------- */

import { ValueNoise } from "../../utils/noise.js";
import { makeRandom, smoothstep } from "../../utils/math.js";
import { NAMEK, craterFor } from "./config.js";

/* ------------------------------------------------- o mapa de deslocamento --

   m — lado da célula. 2 m contra os 2,6 m da célula da malha na clareira: a
   grade é ligeiramente mais fina que a malha que a desenha, então não é ela
   que limita o detalhe do buraco. */
const DESL_RES = 2;
/* m — meia-extensão coberta. A sala recusa cratera fora do raio da arena
   (460 m), então 480 cobre tudo o que pode ser cavado, com folga. */
const DESL_HALF = 480;
/** Células por lado. 481² = 231 mil floats ≈ 925 KB, alocados uma vez. */
const DESL_N = Math.floor((DESL_HALF * 2) / DESL_RES) + 1;
/* m — o quanto o chão pode afundar e a borda pode subir, ACUMULADO.
   Sem os limites, insistir no mesmo ponto abriria um poço sem fundo — as
   crateras se somam, e nada as impediria de somar para sempre. */
const DESL_MIN = -80;
const DESL_MAX = 25;
/* m — teto da fundura de UMA cratera que foi sendo aprofundada. Abaixo disto o
   `DESL_MIN` da grade já estaria aparando de qualquer jeito; o limite aqui
   existe para o registro não guardar números que a grade nunca vai honrar. */
const FUNDURA_MAX = 70;
/* m — célula do índice usado só para achar cratera a fundir. Grande porque a
   busca varre 3×3 células e as crateras candidatas são poucas. */
const FUSAO_CELL = 32;

export class NamekField {
  constructor(seed = NAMEK.world.seed) {
    this.noise = new ValueNoise(seed);
    this.radius = NAMEK.world.radius;
    this.seaLevel = NAMEK.world.seaLevel;

    /* Onde a sala sorteia nascimentos: a CLAREIRA, e só ela.

       O raio acompanha o relevo, e é por isso que ele encolheu junto com a
       arena: a serra do terreno novo (ver `baseHeight`) começa a subir aos
       200 m, então um raio de nascimento maior que isso põe gente na encosta
       ou no topo de um pico — foi o primeiro defeito visto depois da troca. */
    this.spawnCenter = { x: 0, z: 0, radius: 150, minRadius: 25 };

    /**
     * O TERRENO CAVADO, em metros de deslocamento por célula.
     *
     * É o que substituiu a lista de crateras consultada a cada `heightAt`.
     * Uma cratera é assada aqui uma vez (`bakeCrater`) e vira parte do chão;
     * a consulta de altura passa a custar quatro leituras, sempre, tenha a
     * partida aberto dez buracos ou dez mil.
     */
    this.desl = new Float32Array(DESL_N * DESL_N);

    /**
     * Índice espacial LEVE, consultado só ao abrir cratera (`craterParaFundir`)
     * e nunca em `heightAt`. É o que permite achar o buraco a aprofundar sem
     * varrer o registro inteiro — e é barato justamente porque abrir cratera é
     * raro comparado a consultar altura.
     * @type {Map<number, object[]>}
     */
    this.fusaoGrid = new Map();

    /**
     * As poças de lava abertas. Derivadas do relevo (ver `avaliarLava`), não
     * transmitidas: os dois lados chegam nelas sozinhos.
     * @type {Array<{x:number,z:number,raio:number}>}
     */
    this.lavaPools = [];
    /** Avisa quem desenha que nasceu (ou cresceu) uma poça. Nulo no servidor. */
    this.onLava = null;

    /** @type {object[]} o registro, em ordem de chegada. Só para a rede. */
    this.craters = [];
    /** @type {Map<number, object>} id da sala → cratera, contra duplicata */
    this.byId = new Map();

    /* As MONTANHAS não saem de ruído puro. Ruído dá relevo, não dá silhueta —
       e o que faz um cenário de Namekusei ser reconhecível são picos separados,
       com vale entre eles, não uma crista contínua. Sorteados uma vez, com
       semente fixa: o planeta é o mesmo em todas as máquinas. */
    this.peaks = this.buildPeaks(seed);
  }

  /* ---------------------------------------------------------------- picos -- */

  /**
   * Os picos do anel, sorteados uma vez.
   *
   * Eles ficam no anel de 500–760 m porque é onde a montanha cumpre o papel de
   * parede sem estreitar a arena de combate. Um pico no miolo seria um obstáculo
   * no meio da briga aérea — e brigar em volta de um obstáculo é o que torna um
   * jogo de voo irritante em vez de amplo.
   */
  buildPeaks(seed) {
    const rnd = makeRandom(seed ^ 0x5eed);
    const lista = [];
    /* NOVE, e não vinte e dois. A arena encolheu para 460 m de raio e as
       montanhas deixaram de ser só a parede do fundo: agora elas ficam DENTRO
       do alcance, para servirem de alvo. Vinte e dois picos nesse espaço
       viram uma crista contínua, e crista contínua não se contorna nem se
       derruba — se margeia. Nove deixam vale entre eles. */
    const n = 9;
    for (let i = 0; i < n; i++) {
      /* Ângulos em setores, com sobra sorteada dentro de cada um: sorteio livre
         deixa buracos de 60° e aglomerados de três, e o anel de montanhas some
         de metade das direções. */
      const ang = ((i + rnd() * 0.8 - 0.4) / n) * Math.PI * 2;
      /* 180 a 430 m: fora da clareira central (onde a briga começa e onde um
         obstáculo no meio irritaria) e dentro do alcance de qualquer especial,
         que é o que os torna DESTRUTÍVEIS na prática. */
      const d = 240 + rnd() * 200;
      lista.push({
        x: Math.cos(ang) * d,
        z: Math.sin(ang) * d,
        /* m — altura acrescentada no centro do pico. */
        h: 60 + rnd() * 105,
        /* m — quão largo ele é. Picos altos são largos: um cone de 140 m de
           altura e 40 m de base é uma agulha, e agulha não lê como montanha. */
        r: 90 + rnd() * 110,
        /* Achatamento em uma direção, para nenhum deles ser um cone perfeito. */
        squash: 0.62 + rnd() * 0.5,
        rot: rnd() * Math.PI,
      });
    }
    return lista;
  }

  /* ------------------------------------------------- mapa de deslocamento -- */

  /**
   * Quanto o chão baixou (ou subiu, na borda) neste ponto, por interpolação
   * bilinear na grade.
   *
   * Bilinear e não vizinho-mais-próximo: a grade tem célula de 2 m e a malha
   * tem 2,6 m na clareira, então amostrar em degrau deixaria a cratera com
   * borda de escada — um buraco quadriculado.
   */
  displacementAt(x, z) {
    const fx = (x + DESL_HALF) / DESL_RES;
    const fz = (z + DESL_HALF) / DESL_RES;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= DESL_N - 1 || iz >= DESL_N - 1) return 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const i00 = iz * DESL_N + ix;
    const a = this.desl[i00];
    const b = this.desl[i00 + 1];
    const c = this.desl[i00 + DESL_N];
    const d = this.desl[i00 + DESL_N + 1];
    const cima = a + (b - a) * tx;
    const baixo = c + (d - c) * tx;
    return cima + (baixo - cima) * tz;
  }

  /**
   * ASSA uma cratera na grade — é aqui que ela deixa de ser evento e vira
   * terreno.
   *
   * Custa O(células do disco) UMA vez, e depois some: não importa quantas
   * crateras a partida acumulou, `displacementAt` continua lendo quatro
   * números. É o oposto da lista, que cobrava a conta em toda consulta de
   * altura pelo resto da partida.
   *
   * As crateras se SOMAM, e é isso que faz o buraco crescer quando se insiste
   * no mesmo ponto. Os limites existem para que insistir não abra um poço sem
   * fundo: o chão para de descer em `DESL_MIN` e a borda para de subir em
   * `DESL_MAX`.
   */
  bakeCrater(c, sinal = 1) {
    const ix0 = Math.max(0, Math.floor((c.x - c.raio + DESL_HALF) / DESL_RES));
    const ix1 = Math.min(DESL_N - 1, Math.ceil((c.x + c.raio + DESL_HALF) / DESL_RES));
    const iz0 = Math.max(0, Math.floor((c.z - c.raio + DESL_HALF) / DESL_RES));
    const iz1 = Math.min(DESL_N - 1, Math.ceil((c.z + c.raio + DESL_HALF) / DESL_RES));

    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = iz * DESL_RES - DESL_HALF;
      const linha = iz * DESL_N;
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = ix * DESL_RES - DESL_HALF;
        const d = this.craterDelta(c, px, pz);
        if (d === 0) continue;
        const k = linha + ix;
        const v = this.desl[k] + d * sinal;
        this.desl[k] = v < DESL_MIN ? DESL_MIN : v > DESL_MAX ? DESL_MAX : v;
      }
    }
  }

  /**
   * Desassa: tira da grade exatamente o que `bakeCrater` pôs.
   *
   * Exato porque assar é uma SOMA, e somar tem inverso. A única exceção é o
   * ponto que bateu no teto de profundidade — lá a soma foi aparada e não dá
   * para desfazer o que não entrou. É aceitável porque só acontece no fundo de
   * um buraco já saturado, onde mais alguns metros não mudam o que se vê.
   */
  unbakeCrater(c) {
    this.bakeCrater(c, -1);
  }

  /* --------------------------------------------------------------- lava ----

     Cavar fundo o bastante FURA A CROSTA, e o que estava embaixo sobe. */

  /**
   * A cratera furou? Se furou, vira poça de lava.
   *
   * Roda depois de cada `bakeCrater`, nos DOIS lados: o servidor precisa saber
   * onde queima para cobrar vida, o cliente para desenhar. Como os dois chegam
   * ao mesmo `heightAt` a partir da mesma sequência de crateras, chegam também
   * à mesma lista de poças — sem uma mensagem de rede sequer.
   *
   * O raio sai por AMOSTRAGEM do fundo, e não da geometria da cratera: depois
   * de vários golpes somados o buraco já não tem forma de cratera nenhuma, e
   * perguntar ao relevo onde ele cruza o nível da lava é a única medida que
   * continua valendo.
   */
  avaliarLava(c) {
    const L = NAMEK.destruction.lava;
    if (this.heightAt(c.x, c.z) > L.gatilho) return;

    let raio = 0;
    for (let r = 2; r <= L.raioMax; r += 2) {
      /* Quatro direções bastam: a poça é desenhada como um disco, então o que
         importa é onde ela deixa de ser poça em MÉDIA, não o contorno exato. */
      let dentro = 0;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        if (this.heightAt(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r) < L.nivel) dentro++;
      }
      if (dentro < 3) break;
      raio = r;
    }
    if (raio < 2) return;

    /* Duas poças que se encostam viram UMA: dois discos sobrepostos deixam uma
       borda visível no meio da lava. */
    for (const p of this.lavaPools) {
      if (Math.hypot(p.x - c.x, p.z - c.z) < p.raio) {
        if (raio > p.raio) {
          p.raio = raio;
          this.onLava?.(p);
        }
        return;
      }
    }
    const nova = { x: c.x, z: c.z, raio };
    this.lavaPools.push(nova);
    this.onLava?.(nova);
  }

  /**
   * Este ponto está encostando na lava?
   * @param {number} y altura dos PÉS — quem chama passa a base do lutador
   */
  naLava(x, y, z) {
    const L = NAMEK.destruction.lava;
    if (y > L.nivel + L.margem) return false;
    for (let i = 0; i < this.lavaPools.length; i++) {
      const p = this.lavaPools[i];
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= p.raio * p.raio) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------- fusão ----- */

  /** Célula do índice de fusão. Só é consultado ao ABRIR cratera, nunca em `heightAt`. */
  chaveFusao(x, z) {
    return ((Math.floor(x / FUSAO_CELL) + 2048) << 16) | (Math.floor(z / FUSAO_CELL) + 2048);
  }

  indexarParaFusao(c) {
    const k = this.chaveFusao(c.x, c.z);
    let lista = this.fusaoGrid.get(k);
    if (!lista) this.fusaoGrid.set(k, (lista = []));
    lista.push(c);
  }

  /**
   * A cratera existente que este novo golpe deve APROFUNDAR em vez de duplicar.
   *
   * Sem isto, segurar o botão da rajada (seis tiros por segundo) criaria seis
   * entradas por segundo no registro — e o registro é o que viaja no `welcome`
   * para quem entra no meio. Com isto, insistir no mesmo ponto continua
   * afundando o buraco (é o que se quer) sem que o registro cresça.
   *
   * O critério é o centro do golpe novo cair BEM dentro de um buraco que já
   * existe. Metade do raio e não o raio inteiro: encostar na borda de uma
   * cratera é abrir uma cratera vizinha, não aprofundar aquela — e é assim que
   * um buraco se alarga em vez de virar um poço.
   */
  craterParaFundir(x, z, raio) {
    let melhor = null;
    let melhorD = Infinity;
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const lista = this.fusaoGrid.get(this.chaveFusao(x + cx * FUSAO_CELL, z + cz * FUSAO_CELL));
        if (!lista) continue;
        for (const c of lista) {
          const d = Math.hypot(c.x - x, c.z - z);
          if (d > c.raio * 0.5 || d >= melhorD) continue;
          /* Não funde golpe grande em cratera pequena: uma Genki Dama que cai
             dentro do arranhão de uma rajada tem de abrir a cratera DELA, com
             o raio dela, e não engordar um buraco de quatro metros. */
          if (raio > c.raio * 1.3) continue;
          melhorD = d;
          melhor = c;
        }
      }
    }
    return melhor;
  }

  /**
   * Abre uma cratera. **Determinística e idempotente.**
   *
   * Determinística porque raio e fundura saem de `craterFor(power)`, que é
   * compartilhada — os dois lados chegam ao mesmo buraco a partir dos mesmos
   * três números, e é isso que faz duas abas verem o mesmo chão (critério 5 do
   * §12 do plano).
   *
   * Idempotente pelo `id`: a mensagem da sala pode chegar duas vezes (o cliente
   * que atirou já a aplicou localmente para não esperar o retorno da rede) e a
   * segunda não pode aprofundar o buraco.
   *
   * **Não aposenta mais nada.** A cratera é assada na grade e fica lá para
   * sempre — ver o cabeçalho do arquivo.
   *
   * @param {number} id       carimbo da sala; o mesmo em todas as telas
   * @param {number} x
   * @param {number} z
   * @param {number} power    potência do golpe
   * @returns {object|null} a cratera criada, ou null se o id já existia
   */
  addCrater(id, x, z, power) {
    if (this.byId.has(id)) return null;
    const { raio, fundura } = craterFor(power);

    /* APROFUNDAR, quando o golpe cai dentro de um buraco que já existe.
     *
     * A grade é desassada e reassada com a cratera já crescida, em vez de
     * simplesmente somar o golpe novo por cima. Parece um rodeio e não é: é o
     * que mantém a GRADE e o REGISTRO contando a mesma história. Quem está em
     * campo tem a grade; quem entra no meio recebe o registro e o reassa. Se a
     * grade guardasse a soma de vinte rajadas e o registro guardasse uma
     * cratera só, os dois chãos seriam diferentes — e chão diferente entre
     * jogadores é o pior defeito possível deste modo (§12, critério 5). */
    const alvo = this.craterParaFundir(x, z, raio);
    if (alvo) {
      this.unbakeCrater(alvo);
      alvo.fundura = Math.min(FUNDURA_MAX, alvo.fundura + fundura * 0.8);
      /* O raio cresce por soma de ÁREAS (hipotenusa), não de comprimentos:
         vinte rajadas no mesmo ponto abrem um buraco fundo e só um pouco mais
         largo, que é como um buraco de verdade se comporta. Somar raios daria
         uma cratera de cem metros a partir de tiros de quatro. */
      alvo.raio = Math.min(NAMEK.destruction.craterMax, Math.hypot(alvo.raio, raio * 0.5));
      this.bakeCrater(alvo);
      this.avaliarLava(alvo);
      /* O id NOVO passa a apontar para a cratera velha: é o que mantém a
         idempotência quando a mesma mensagem da sala chega duas vezes. */
      this.byId.set(id, alvo);
      return alvo;
    }

    const c = { id, x, z, raio, fundura };
    this.craters.push(c);
    this.byId.set(id, c);
    this.indexarParaFusao(c);
    this.bakeCrater(c);
    this.avaliarLava(c);
    return c;
  }

  /**
   * Todas, para mandar a quem entra no meio da partida.
   *
   * O registro é append-only agora que nada é aposentado, e é ele — não a
   * grade — que viaja: a grade tem 231 mil células e não caberia numa mensagem
   * de entrada, enquanto o registro tem uma entrada por golpe que abriu buraco
   * (especiais e quedas, algumas centenas numa partida longa).
   */
  craterList() {
    return this.craters.map((c) => ({ i: c.id, p: [c.x, c.z], r: c.raio, f: c.fundura }));
  }

  /**
   * Rebate a lista recebida do `welcome` sem recalcular potência.
   *
   * Raio e fundura viajam prontos de propósito: quem entra no meio precisa do
   * MESMO buraco que os outros têm, e refazer a conta a partir da potência
   * daria o mesmo resultado só enquanto ninguém mexesse na fórmula. No dia em
   * que `craterFor` for ajustada, quem já está em campo continua com o chão
   * antigo e o retardatário chegaria com um chão novo — a única divergência
   * possível, fechada aqui.
   *
   * A ORDEM importa e é a da lista: as crateras se somam na grade, e somar não
   * é comutativo depois que os limites de `bakeCrater` entram. A sala manda na
   * ordem em que carimbou, que é a mesma em que todo mundo já assou.
   */
  loadCraters(lista) {
    for (const c of lista ?? []) {
      if (this.byId.has(c.i)) continue;
      const cratera = { id: c.i, x: c.p[0], z: c.p[1], raio: c.r, fundura: c.f };
      this.craters.push(cratera);
      this.byId.set(c.i, cratera);
      this.indexarParaFusao(cratera);
      this.bakeCrater(cratera);
      this.avaliarLava(cratera);
    }
  }

  /* --------------------------------------------------------------- altura -- */

  /**
   * O relevo BASE, sem cratera nenhuma.
   *
   * Separado de `heightAt` porque a malha do terreno precisa dos dois: o base
   * para nascer, e o completo para ser re-esculpida quando um buraco abre perto
   * dela. Recalcular o ruído a cada re-esculpimento seria pagar FBM por vértice
   * a cada explosão — o cliente guarda o base e só soma a diferença.
   */
  /**
   * O relevo, SEM cratera nenhuma.
   *
   * ------------------------------------------------- de onde este relevo veio
   *
   * É o terreno da fase Sandbox (`shared/sandboxField.js`), com **todas as
   * escalas multiplicadas por dez**: uma arena de teste de 46 m de raio virou
   * um planeta de 460 m. Multiplicar por dez quer dizer comprimentos ×10 e
   * frequências de ruído ÷10 — é a mesma paisagem, vista de um lugar dez vezes
   * maior, e não uma paisagem diferente que por acaso é grande.
   *
   * O relevo antigo (colinas de FBM largo + clareira achatada na cota 4 + anel
   * de 22 picos a 500–760 m) está guardado na tag `namekusei-terreno-v2` e em
   * `backup/namekusei-terreno-v2-2026-08-15/`.
   *
   * ---------------------------------------------------------- as três camadas
   *
   * 1. **O piso.** Ondulação baixa, que dá o chão de onde tudo sai.
   * 2. **A serra.** Anel de cristas com deformação de domínio — é o que a fase
   *    de teste tem de melhor: a crista não vira um anel geométrico, ela
   *    serpenteia.
   * 3. **As montanhas soltas.** Nove gaussianas achatadas dentro do alcance de
   *    tiro (ver `buildPeaks`). Elas não existiam no Sandbox; entram aqui
   *    porque uma montanha só é destrutível se dá para chegar nela.
   *
   * E, por último, o mar — que o Sandbox não tem e Namekusei precisa, senão a
   * malha termina numa borda seca em vez de mergulhar (ver `water.js`).
   */
  baseHeight(x, z) {
    const d = Math.hypot(x, z);
    const n = this.noise;

    /* 1. O PISO. `floorNoise` 0,35 a 0,05 de frequência no Sandbox; aqui 3,5 a
       0,005 — dez vezes mais alto e dez vezes mais largo. */
    let h = 3.5 * n.fbm2(x * 0.005, z * 0.005, 3);

    /* 2. A SERRA. `wallStart` 20 → 200 m, `rampLength` 20 → 200 m,
       `peak` 26 → 260 m. A deformação de domínio (`wx`/`wz`) é o que impede o
       anel de ler como um círculo desenhado a compasso. */
    const w = d - 200;
    if (w > 0) {
      const wx = x + 70 * n.noise2(x * 0.0015, z * 0.0015);
      const wz = z + 70 * n.noise2(x * 0.0015 + 91, z * 0.0015 - 33);
      const crista = 0.5 + 0.5 * n.ridged2(wx * 0.004, wz * 0.004, 4, 2.1, 0.5);
      const massif = 0.6 + 0.4 * n.fbm2(wx * 0.0012, wz * 0.0012, 2);
      const rise = 1 - Math.exp(-w / 200);
      h += 260 * rise * massif * Math.pow(crista, 1.3);
    }

    /* 3. AS MONTANHAS SOLTAS. Nove iterações por consulta, cada uma cortada
       cedo pelo teste de distância — barato o bastante para rodar sempre, o
       que é obrigatório agora que elas ficam DENTRO da arena e não mais atrás
       de um `if (d > 300)`. */
    for (const p of this.peaks) {
      const dx = x - p.x;
      const dz = z - p.z;
      /* Gira no espaço do pico antes de achatar, senão todos achatariam na
         mesma direção do mundo e a montanha viraria um padrão. */
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const rx = dx * c - dz * s;
      const rz = (dx * s + dz * c) * p.squash;
      const dist2 = rx * rx + rz * rz;
      const r2 = p.r * p.r;
      if (dist2 > r2) continue;
      const t = 1 - dist2 / r2;
      /* t² dá uma saia larga e um topo redondo; t linear daria um cone. */
      h += p.h * t * t;
    }

    /* A PRAIA E O MAR, em DOIS passos — e são dois de propósito.
     *
     * Num passo só (uma interpolação da serra direto para o fundo do mar) a
     * água encostava num paredão: a costa descia de ~130 m para −22 m em
     * pouco mais de cem metros, o que é uma encosta de quase 50°. O mar batia
     * num bloco, sem faixa nenhuma de areia entre uma coisa e outra.
     *
     * Agora a serra desce primeiro até a COTA DA PRAIA, um pouco acima da
     * linha d'água, e só depois a areia mergulha — devagar, porque é a
     * inclinação suave que faz a maré ter onde ficar e a areia ter onde
     * aparecer. Quem pinta a faixa clara é `corDeSuperficie`, e ela pinta por
     * ALTURA: sem esta cota intermediária não havia altura nenhuma para ela
     * pintar. */
    const cotaPraia = this.seaLevel + 3;

    // 1. a serra cede e vira orla
    const orla = smoothstep(500, 580, d);
    h = h * (1 - orla) + cotaPraia * orla;

    // 2. a areia entra na água. A linha d'água cai por volta de 612 m.
    const areia = smoothstep(580, 630, d);
    h = h * (1 - areia) + (this.seaLevel - 2.5) * areia;

    // 3. e o fundo se aprofunda, já longe da vista
    const fundo = smoothstep(630, 700, d);
    h = h * (1 - fundo) + (this.seaLevel - 18) * fundo;

    return h;
  }

  /**
   * A altura de verdade: relevo base mais o que já foi cavado.
   *
   * É a função mais chamada do modo — malha, bot, bala, pé de jogador — e
   * agora ela custa o MESMO em qualquer ponto da partida: uma consulta de
   * ruído mais quatro leituras de array. Antes ela varria a lista de crateras
   * próximas, e o preço subia com a destruição acumulada — o que obrigava a
   * aposentar buracos para o jogo não degradar.
   */
  heightAt(x, z) {
    return this.baseHeight(x, z) + this.displacementAt(x, z);
  }

  /**
   * Quanto uma cratera baixa o terreno num ponto. Zero fora do raio.
   *
   * O perfil tem BORDA LEVANTADA, e ela é a diferença entre um buraco e uma
   * cratera: o material que saiu do meio tem de estar em algum lugar, e num
   * impacto ele está no anel em volta. Sem esse anel, o que se vê é uma
   * mordida — que é exatamente o que parecia na primeira versão.
   *
   *     borda            ⌒‾‾⌒
   *     ─────────────⌒‾‾      ‾‾⌒─────────────
   *     fundo              ⌄⌄⌄
   */
  craterDelta(c, x, z) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d >= c.raio) return 0;
    const u = d / c.raio;

    /* Bacia: cosseno elevado. Fundo redondo, paredes que suavizam na borda —
       um parabolóide puro encontra o terreno num ângulo vivo e o normal salta
       ali, o que aparece como um aro escuro na iluminação. */
    const bacia = -c.fundura * Math.pow(Math.cos((u * Math.PI) / 2), 1.6);

    /* Anel: a sobra, só no terço externo, com um quinto da fundura. */
    const anel = u > 0.66 ? Math.sin((u - 0.66) / 0.34 * Math.PI) * c.fundura * 0.2 : 0;

    return bacia + anel;
  }

  /* ------------------------------------------------------------ geometria -- */

  /** Normal do terreno por diferença central. */
  normalAt(x, z, eps = 0.8, out = { x: 0, y: 0, z: 0 }) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    const nx = hL - hR;
    const nz = hD - hU;
    const ny = 2 * eps;
    const inv = 1 / Math.hypot(nx, ny, nz);
    out.x = nx * inv;
    out.y = ny * inv;
    out.z = nz * inv;
    return out;
  }

  /** Cosseno do ângulo com a vertical: 1 é plano, 0 é parede. */
  slopeAt(x, z, eps = 0.8) {
    return this.normalAt(x, z, eps).y;
  }

  /** Está dentro do círculo da arena? */
  isInsideWorld(x, z) {
    return x * x + z * z <= this.radius * this.radius;
  }

  /** Dá para ficar de pé aqui? Fora d'água, dentro da arena e sem ser parede. */
  isWalkable(x, z) {
    if (!this.isInsideWorld(x, z)) return false;
    if (this.heightAt(x, z) <= this.seaLevel + 0.5) return false;
    return this.slopeAt(x, z) > 0.72;
  }

  /**
   * Um ponto plano o bastante para pousar uma casa ou nascer alguém.
   *
   * Testa o entorno, não só o centro: um ponto plano no meio de uma encosta
   * existe (o relevo passa pela horizontal ao virar), e uma vila construída ali
   * fica com metade das casas no ar.
   */
  isFlatGround(x, z, margem = 8, minSlope = 0.93) {
    if (!this.isWalkable(x, z)) return false;
    const h = this.heightAt(x, z);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const px = x + Math.cos(a) * margem;
      const pz = z + Math.sin(a) * margem;
      if (Math.abs(this.heightAt(px, pz) - h) > margem * 0.34) return false;
    }
    return this.slopeAt(x, z) > minSlope;
  }

  /**
   * Um lugar para nascer, sorteado.
   *
   * `√` no raio pelo mesmo motivo de sempre: sem ele o sorteio se acumula no
   * centro, porque a área de um anel cresce com o raio — e todo mundo nasceria
   * em cima de todo mundo no meio da clareira.
   */
  pickSpawn(rnd = Math.random) {
    const S = this.spawnCenter;
    for (let tentativa = 0; tentativa < 40; tentativa++) {
      const ang = rnd() * Math.PI * 2;
      const t = Math.sqrt(rnd());
      const d = S.minRadius + (S.radius - S.minRadius) * t;
      const x = S.x + Math.cos(ang) * d;
      const z = S.z + Math.sin(ang) * d;
      if (this.isWalkable(x, z)) return { x, z, y: this.heightAt(x, z) };
    }
    /* Quarenta tentativas sem achar chão é impossível com este relevo, mas o
       nascimento não pode ser a coisa que falha: o centro da clareira é plano
       por construção. */
    return { x: 0, z: 0, y: this.heightAt(0, 0) };
  }
}
