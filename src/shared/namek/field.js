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
       clareira      colinas      montanhas       mar
       0–180 m       180–500 m    500–760 m       760 m+

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
  bakeCrater(c) {
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
        const v = this.desl[k] + d;
        this.desl[k] = v < DESL_MIN ? DESL_MIN : v > DESL_MAX ? DESL_MAX : v;
      }
    }
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
    const c = { id, x, z, raio, fundura };

    this.craters.push(c);
    this.byId.set(id, c);
    this.bakeCrater(c);
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
      this.bakeCrater(cratera);
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

    /* O MAR. Depois das montanhas o chão desce e afunda. A descida começa
       antes da borda da arena para que a barreira macia (§2 do plano)
       aconteça sobre água aberta — voar para fora e ser freado sobre o oceano
       lê como o mundo continuando; ser freado sobre um penhasco lê como uma
       parede invisível. */
    const praia = smoothstep(520, 650, d);
    h = h * (1 - praia) + (this.seaLevel - 14) * praia;

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
