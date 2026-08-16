/* ---------------------------------------------------------------------------
   O CAMPO — o terreno como VOLUME, não como superfície.

   PURO. Sem Three.js, sem DOM (§11.4 do plano). A sala precisa deste mesmo chão
   para o modo poder virar multijogador; um campo que só existe no navegador não
   vira multijogador, vira dois jogos.

   -------------------------------------------------------- volume, e por quê

   A tentativa anterior (Namekusei) tinha um campo de ALTURA: um `y` por coluna.
   Furá-lo abre a chance de ver através da montanha, porque uma casca é oca por
   definição, e cada correção lá foi tapando um sintoma do mesmo problema.

   Aqui a verdade é uma DENSIDADE com sinal:

       densidade(x,y,z) > 0   →  é pedra
       densidade(x,y,z) < 0   →  é ar

   A malha (`malha.js`) desenha a fronteira COMPLETA do sólido — a encosta de
   fora e a parede de toda cavidade, na mesma superfície fechada. De dentro de um
   túnel, todo raio ou bate em rocha ou sai por uma abertura de verdade. O "oco"
   não é consertado: ele deixa de poder existir.

   ----------------------------------------------------------- e por que ESPARSO

   A arena inteira em voxels de meio metro seriam dezenas de milhões de células,
   quase todas iguais à fórmula do relevo. Então:

       célula de um chunk JÁ ESCAVADO   →  lê o `Int8Array` gravado
       célula de um chunk intocado      →  calcula a fórmula

   Chunk que ninguém furou não ocupa um byte: ele é uma função. O primeiro golpe
   que o alcança materializa o array e passa a gravar nele.

   É o mesmo desenho de um jogo de blocos, e é de propósito: é o que permite, mais
   adiante, o terreno virar profundo e explorável sem reescrever nada.

   -------------------------------------------------- a lista é que é a verdade

   `impactos` é o registro de tudo o que foi escavado, em ordem. É ELE que viaja
   na rede (§11.1) — nunca os voxels, que são centenas de KB por túnel. Dois
   campos que recebem a mesma lista NA MESMA ORDEM chegam ao mesmo chão, voxel a
   voxel, e há um teste em Node que confere exatamente isso.

   A ORDEM é contrato e não arrumação: a bacia entra por `min` (tira rocha) e o
   lábio entra SOMANDO na fronteira, e as duas operações não comutam entre
   impactos. Ver `escavar()`.
   --------------------------------------------------------------------------- */

import { ruido3, fbm3 } from "./ruido.js";
import { prepararImpacto, bacia, labio } from "./escavar.js";

/* --------------------------------------------------------------- a grade --- */

/** m — aresta do voxel. Meio metro dá 24 amostras no vão de um golpe de 6 m. */
export const VOXEL = 0.5;
/** m — aresta do chunk. */
export const CHUNK = 16;
/** Células por lado de um chunk. */
export const NC = Math.round(CHUNK / VOXEL);

/* Quantização da densidade em `Int8`.
 *
 * 15 unidades por metro dá passo de 6,7 cm num voxel de 50 cm — precisão de
 * sobra para a posição sub-voxel do vértice, que é o que faz a parede sair lisa
 * em vez de escadinha. E o alcance de ±8,4 m é o bastante: o que interessa é a
 * vizinhança do zero, o resto é "muito dentro da pedra" ou "muito no ar".
 *
 * Guardar quantizado ainda AJUDA o §11: diferenças de último bit entre máquinas
 * somem no arredondamento em vez de virarem uma célula de sinal trocado. */
const ESCALA = 15;
const TETO = 127 / ESCALA;

/* m — a faixa em torno da fronteira em que o lábio de ejeção assenta.
 *
 * Ver o uso em `escavar`. Fora dela o material não tem onde pousar: mais para
 * dentro é miolo de rocha, mais para fora é ar. Dois metros é pouco mais de um
 * voxel e meio, que é o bastante para o anel ter espessura sem invadir o vão. */
const LABIO_BANDA = 2;

/* ------------------------------------------------------------- o relevo --- */

/* m — meia-extensão da arena. Pequena de propósito: é fase de teste. */
export const METADE = 80;
/* m — o fundo. Abaixo disto é rocha maciça e ninguém cava. */
export const FUNDO = -48;
/* m — o teto útil. Acima disto é céu. */
export const TETO_MUNDO = 64;

export class CampoCratera {
  constructor(semente = 20260816) {
    this.semente = semente | 0;
    /** @type {Map<number, Int8Array>} chunk → células, só os já escavados. */
    this.chunks = new Map();
    /** @type {object[]} o registro, em ordem. É ele que viaja na rede. */
    this.impactos = [];
    /** @type {Set<number>} ids já aplicados, contra a mensagem que chega duas vezes. */
    this.vistos = new Set();
    /** Avisa quem desenha quais chunks sujaram. Nulo no servidor. */
    this.onSujo = null;
  }

  /* ------------------------------------------------------- relevo base --- */

  /**
   * A densidade do terreno INTACTO — positiva dentro da pedra.
   *
   * É uma função pura de (x, y, z) com semente fixa, portanto idêntica em toda
   * máquina. Três camadas:
   *
   * 1. **A altura.** Uma clareira central para a briga, três morros para furar
   *    de lado e um paredão de um dos lados para furar de frente. É deliberado
   *    que a arena tenha os três casos: furar de cima, furar de lado e derrubar.
   * 2. **A rugosidade de profundidade.** Um ruído 3D que só liga ABAIXO da
   *    superfície. É ele que faz a parede de um corte ter blocos e lascas em vez
   *    de ser uma casca lisa — é o que se vê nas referências, a rocha em placas.
   *    Fora do subsolo ele é zero, senão a encosta ficaria esburacada.
   * 3. **O fundo.** Abaixo de `FUNDO` a densidade cresce depressa: ninguém cava
   *    até o outro lado do mundo, e o teste de "estou no sólido" precisa de um
   *    piso onde parar.
   */
  baseDensidade(x, y, z) {
    return this.densidadeComAltura(x, y, z, this.alturaBase(x, z));
  }

  /**
   * A mesma conta, com a cota da superfície JÁ SABIDA.
   *
   * Existe porque `alturaBase` não depende de `y`: as 34 amostras de uma coluna
   * de chunk compartilham a mesma altura, e recalculá-la para cada uma custou
   * 26 segundos na montagem da arena — medidos. Ver `amostrarBloco`.
   */
  densidadeComAltura(x, y, z, h) {
    let d = h - y;

    /* A rugosidade entra por uma janela: começa 1,5 m abaixo da superfície e
       chega ao cheio uns 8 m adentro. A janela é polinomial (nada de `exp`, §11)
       e é o que impede a encosta de ganhar buracos.

       E ela para de ser calculada abaixo de 12 m: lá `h − y` já passou do teto
       de quantização (±8,5 m), então a rugosidade (±3,4 m) não tem como mudar o
       SINAL — só gastaria 24 consultas de hash para produzir um número que vai
       ser aparado do mesmo jeito. */
    const prof = h - y;
    if (prof > 1.5 && prof < 12) {
      let t = (prof - 1.5) / 6.5;
      if (t > 1) t = 1;
      const janela = t * t * (3 - 2 * t);
      /* Duas escalas: placas largas de uns 12 m e lascas de uns 3 m. */
      const placa = fbm3(x * 0.085, y * 0.085, z * 0.085, 2, this.semente ^ 0x11, 0.5);
      const lasca = ruido3(x * 0.34, y * 0.34, z * 0.34, this.semente ^ 0x22);
      d += janela * (placa * 2.6 + lasca * 0.75);
    }

    /* O fundo do mundo. */
    if (y < FUNDO) d += (FUNDO - y) * 4;

    return d;
  }

  /**
   * Preenche um bloco de amostras `n³` a partir do nó `(ox, oy, oz)`.
   *
   * É o caminho que a malha usa, e ele existe por uma razão só: cachear
   * `alturaBase` por COLUNA. São n² consultas em vez de n³ — trinta e quatro
   * vezes menos numa grade de 34 —, e foi a diferença entre a arena montar em
   * vinte e seis segundos e montar em dois.
   *
   * O nó que cai num chunk já escavado lê o array; o resto sai da fórmula. Essa
   * decisão é por AMOSTRA e não por bloco, porque um bloco pode ter os dois.
   */
  amostrarBloco(ox, oy, oz, n, saida) {
    const alt = this._altCache && this._altCache.length >= n * n ? this._altCache : (this._altCache = new Float32Array(n * n));
    for (let iz = 0; iz < n; iz++) {
      const wz = (oz + iz) * VOXEL;
      for (let ix = 0; ix < n; ix++) {
        alt[iz * n + ix] = this.alturaBase((ox + ix) * VOXEL, wz);
      }
    }

    for (let iy = 0; iy < n; iy++) {
      const gy = oy + iy;
      const wy = gy * VOXEL;
      const cy = Math.floor(gy / NC);
      for (let iz = 0; iz < n; iz++) {
        const gz = oz + iz;
        const wz = gz * VOXEL;
        const cz = Math.floor(gz / NC);
        const linha = (iy * n + iz) * n;
        const alinha = iz * n;
        for (let ix = 0; ix < n; ix++) {
          const gx = ox + ix;
          const cx = Math.floor(gx / NC);
          const arr = this.chunks.get(this.chaveChunk(cx, cy, cz));
          if (arr === undefined) {
            saida[linha + ix] = this.densidadeComAltura(
              gx * VOXEL,
              wy,
              wz,
              alt[alinha + ix],
            );
          } else {
            const lx = gx - cx * NC;
            const ly = gy - cy * NC;
            const lz = gz - cz * NC;
            saida[linha + ix] = arr[(ly * NC + lz) * NC + lx] / ESCALA;
          }
        }
      }
    }
  }

  /**
   * A cota da superfície intacta. Separada porque a malha e o entulho a querem
   * sem pagar a rugosidade 3D.
   */
  alturaBase(x, z) {
    const s = this.semente;
    /* O piso: ondulação larga e baixa. Terreno perfeitamente liso faz toda
       deformação parecer erro de malha. */
    let h = 2.2 * ruido3(x * 0.012, 0.5, z * 0.012, s) + 1.1 * ruido3(x * 0.031, 1.5, z * 0.031, s ^ 7);

    /* TRÊS MORROS, postos à mão e não sorteados: a bancada precisa que eles
       estejam sempre no mesmo lugar para dois testes seguidos serem
       comparáveis. Gaussiana não, que usa `exp` — o perfil é `t²` sobre uma
       distância normalizada, que dá saia larga e topo redondo pelo mesmo preço. */
    h += this.morro(x, z, -38, -30, 30, 44);
    h += this.morro(x, z, 34, 26, 26, 34);
    h += this.morro(x, z, 46, -46, 22, 26);

    /* O PAREDÃO de um lado — para furar de frente, na horizontal, como na
       referência. Uma rampa que sobe do meio da arena para a borda −Z. */
    const p = (-z - 20) / 46;
    if (p > 0) {
      const t = p > 1 ? 1 : p;
      h += 34 * t * t * (3 - 2 * t);
    }

    return h;
  }

  /** Um morro: perfil `(1−t²)²`, saia larga e topo redondo. Sem `exp`. */
  morro(x, z, cx, cz, raio, altura) {
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    const r2 = raio * raio;
    if (d2 >= r2) return 0;
    const t = 1 - d2 / r2;
    return altura * t * t;
  }

  /* --------------------------------------------------------- os voxels --- */

  /** Chave do chunk a partir dos índices de chunk. */
  chaveChunk(cx, cy, cz) {
    /* ±512 chunks por eixo cabem em 10 bits com viés — folga enorme para uma
       arena de 160 m, e cabe num inteiro de 32 bits, que é o que faz a chave ser
       número e não string (Map de string aloca por consulta). */
    return (((cx + 512) & 1023) << 20) | (((cy + 512) & 1023) << 10) | ((cz + 512) & 1023);
  }

  /** Divisão para baixo, correta para índice negativo. */
  static piso(v, n) {
    return Math.floor(v / n);
  }

  /**
   * A densidade NO NÓ da grade `(ix, iy, iz)` — índices globais de voxel.
   *
   * É a leitura que a malha faz, e é a que decide sólido de ar. Se o chunk foi
   * escavado, vem do array; senão, da fórmula.
   */
  amostra(ix, iy, iz) {
    const cx = Math.floor(ix / NC);
    const cy = Math.floor(iy / NC);
    const cz = Math.floor(iz / NC);
    const arr = this.chunks.get(this.chaveChunk(cx, cy, cz));
    if (arr === undefined) {
      return this.baseDensidade(ix * VOXEL, iy * VOXEL, iz * VOXEL);
    }
    const lx = ix - cx * NC;
    const ly = iy - cy * NC;
    const lz = iz - cz * NC;
    return arr[(ly * NC + lz) * NC + lx] / ESCALA;
  }

  /**
   * A densidade num ponto QUALQUER, por interpolação trilinear na grade.
   *
   * É o que a física consome. Trilinear e não vizinho-mais-próximo porque um
   * degrau de meio metro no chão apareceria como o corpo tremendo ao andar.
   */
  densidadeEm(x, y, z) {
    const fx = x / VOXEL;
    const fy = y / VOXEL;
    const fz = z / VOXEL;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const ty = fy - iy;
    const tz = fz - iz;

    const c000 = this.amostra(ix, iy, iz);
    const c100 = this.amostra(ix + 1, iy, iz);
    const c010 = this.amostra(ix, iy + 1, iz);
    const c110 = this.amostra(ix + 1, iy + 1, iz);
    const c001 = this.amostra(ix, iy, iz + 1);
    const c101 = this.amostra(ix + 1, iy, iz + 1);
    const c011 = this.amostra(ix, iy + 1, iz + 1);
    const c111 = this.amostra(ix + 1, iy + 1, iz + 1);

    const x00 = c000 + (c100 - c000) * tx;
    const x10 = c010 + (c110 - c010) * tx;
    const x01 = c001 + (c101 - c001) * tx;
    const x11 = c011 + (c111 - c011) * tx;
    const y0 = x00 + (x10 - x00) * ty;
    const y1 = x01 + (x11 - x01) * ty;
    return y0 + (y1 - y0) * tz;
  }

  /** É pedra aqui? */
  solidoEm(x, y, z) {
    return this.densidadeEm(x, y, z) > 0;
  }

  /**
   * Materializa um chunk: copia a fórmula do relevo para um array gravável.
   *
   * Só acontece no primeiro golpe que alcança aquele pedaço de mundo. Daí em
   * diante o array é a verdade daquele chunk, e a fórmula não é mais consultada
   * lá — é o que permite ao terreno ter buraco, teto e caverna, coisas que a
   * fórmula não sabe expressar.
   */
  materializar(cx, cy, cz) {
    const k = this.chaveChunk(cx, cy, cz);
    let arr = this.chunks.get(k);
    if (arr !== undefined) return arr;

    arr = new Int8Array(NC * NC * NC);
    const ox = cx * NC;
    const oy = cy * NC;
    const oz = cz * NC;
    /* Também por coluna, pelo mesmo motivo de `amostrarBloco`. */
    const alt = new Float32Array(NC * NC);
    for (let lz = 0; lz < NC; lz++) {
      const wz = (oz + lz) * VOXEL;
      for (let lx = 0; lx < NC; lx++) alt[lz * NC + lx] = this.alturaBase((ox + lx) * VOXEL, wz);
    }
    for (let ly = 0; ly < NC; ly++) {
      const wy = (oy + ly) * VOXEL;
      for (let lz = 0; lz < NC; lz++) {
        const wz = (oz + lz) * VOXEL;
        const linha = (ly * NC + lz) * NC;
        const alinha = lz * NC;
        for (let lx = 0; lx < NC; lx++) {
          arr[linha + lx] = this.quantizar(
            this.densidadeComAltura((ox + lx) * VOXEL, wy, wz, alt[alinha + lx]),
          );
        }
      }
    }
    this.chunks.set(k, arr);
    return arr;
  }

  quantizar(v) {
    const t = v > TETO ? TETO : v < -TETO ? -TETO : v;
    return Math.round(t * ESCALA);
  }

  /* -------------------------------------------------------- escavar ------ */

  /**
   * Aplica um impacto. **Idempotente pelo id.**
   *
   * A BACIA E O LÁBIO SÃO APLICADOS JUNTOS, no mesmo passeio pelos voxels, e
   * isso é o contrato do §11.2 — não arrumação. Escavar é `min` (tira rocha) e o
   * lábio é `max` (põe rocha), e misturar `min` com `max` NÃO é comutativo:
   * cavar A e depois levantar o lábio de B dá um chão diferente de levantar o
   * lábio de B e depois cavar A. Se os dois fossem passeios separados, ou se os
   * impactos fossem aplicados fora de ordem, dois jogadores acabariam com chões
   * silenciosamente diferentes — e o defeito só apareceria quando um caísse num
   * buraco que o outro não vê.
   *
   * @param {{id:number,x:number,y:number,z:number,dx?:number,dy?:number,dz?:number,raio:number,boca?:boolean}} imp
   * @returns {object|null} o impacto preparado, ou null se o id já era conhecido
   */
  escavar(imp) {
    if (this.vistos.has(imp.id)) return null;
    this.vistos.add(imp.id);
    this.impactos.push(imp);

    const c = prepararImpacto(imp);
    const A = c.alcance;

    /* A caixa de voxels tocada, em índices globais. */
    const ix0 = Math.floor((c.cx - A) / VOXEL);
    const ix1 = Math.ceil((c.cx + A) / VOXEL);
    const iy0 = Math.floor((c.cy - A) / VOXEL);
    const iy1 = Math.ceil((c.cy + A) / VOXEL);
    const iz0 = Math.floor((c.cz - A) / VOXEL);
    const iz1 = Math.ceil((c.cz + A) / VOXEL);

    const cx0 = Math.floor(ix0 / NC);
    const cx1 = Math.floor(ix1 / NC);
    const cy0 = Math.floor(iy0 / NC);
    const cy1 = Math.floor(iy1 / NC);
    const cz0 = Math.floor(iz0 / NC);
    const cz1 = Math.floor(iz1 / NC);

    for (let ccx = cx0; ccx <= cx1; ccx++) {
      for (let ccy = cy0; ccy <= cy1; ccy++) {
        for (let ccz = cz0; ccz <= cz1; ccz++) {
          const arr = this.materializar(ccx, ccy, ccz);
          const ox = ccx * NC;
          const oy = ccy * NC;
          const oz = ccz * NC;

          /* Interseção da caixa do impacto com a do chunk. */
          const lx0 = Math.max(0, ix0 - ox);
          const lx1 = Math.min(NC - 1, ix1 - ox);
          const ly0 = Math.max(0, iy0 - oy);
          const ly1 = Math.min(NC - 1, iy1 - oy);
          const lz0 = Math.max(0, iz0 - oz);
          const lz1 = Math.min(NC - 1, iz1 - oz);
          if (lx0 > lx1 || ly0 > ly1 || lz0 > lz1) continue;

          let mexeu = false;
          for (let ly = ly0; ly <= ly1; ly++) {
            const wy = (oy + ly) * VOXEL;
            for (let lz = lz0; lz <= lz1; lz++) {
              const wz = (oz + lz) * VOXEL;
              const linha = (ly * NC + lz) * NC;
              for (let lx = lx0; lx <= lx1; lx++) {
                const wx = (ox + lx) * VOXEL;
                const i = linha + lx;
                const antes = arr[i];
                let v = antes / ESCALA;

                /* 1. A BACIA tira rocha. */
                const b = bacia(c, wx, wy, wz);
                if (b < v) v = b;

                /* 2. O LÁBIO põe rocha — mas SÓ NA FRONTEIRA, e SOMANDO.
                 *
                 * Duas ressalvas, e as duas nasceram de defeito medido.
                 *
                 * **Só na fronteira.** O material ejetado assenta na SUPERFÍCIE.
                 * A primeira versão liberava o lábio onde o relevo intacto fosse
                 * sólido — o que é o subsolo inteiro —, e aí cada bacia nova
                 * reenchia o vão da vizinha com o próprio anel. O túnel saía com
                 * TAMPÕES de rocha maciça no meio, medidos no perfil do eixo. A
                 * janela é sobre a densidade que havia ANTES deste impacto: perto
                 * de zero é superfície (ou parede de túnel, onde o entulho
                 * grudado é bem-vindo); muito positiva é miolo de pedra; muito
                 * negativa é vão aberto. Nos dois extremos, nada acontece.
                 *
                 * **Somando e não `max`.** `max` FORÇA o ponto a ser sólido, e
                 * com altura de 0,35 R isso comeria metros de vão. Somar levanta
                 * a superfície pelo tanto do lábio, que é o que ejeção faz. */
                const l = labio(c, wx, wy, wz);
                if (l > 0) {
                  const a = antes / ESCALA;
                  const dist = a < 0 ? -a : a;
                  if (dist < LABIO_BANDA) {
                    const t = 1 - dist / LABIO_BANDA;
                    v += l * t * t * (3 - 2 * t);
                  }
                }

                const depois = this.quantizar(v);
                if (depois !== antes) {
                  arr[i] = depois;
                  mexeu = true;
                }
              }
            }
          }
          if (mexeu) this.onSujo?.(ccx, ccy, ccz);
        }
      }
    }

    return c;
  }

  /**
   * Reproduz uma lista de impactos, NA ORDEM recebida.
   *
   * É por aqui que um cliente que entra no meio da partida chega ao mesmo chão
   * que os outros — e é o mesmo caminho que o teste de determinismo usa.
   */
  carregar(lista) {
    for (const imp of lista ?? []) this.escavar(imp);
  }

  /* ------------------------------------------------------- física -------- */

  /**
   * O piso sólido sob `y`, marchando para baixo no máximo `alcance` metros.
   *
   * Marcha e não fórmula, porque o campo já não tem fórmula: depois do primeiro
   * buraco, a coluna pode ter qualquer número de vãos. O alcance curto é o que
   * mantém isto barato — quem precisa saber onde pisar só precisa olhar alguns
   * metros abaixo dos próprios pés, e "não achei nada em 6 m" já é a resposta
   * certa: está caindo.
   *
   * @returns {number} a cota do piso, ou `-Infinity` se não houver nenhum perto
   */
  chaoAbaixo(x, y, z, alcance = 6, passo = VOXEL * 0.5) {
    let ant = y;
    let dAnt = this.densidadeEm(x, y, z);
    if (dAnt > 0) return y; // já está dentro da pedra
    for (let d = passo; d <= alcance; d += passo) {
      const yy = y - d;
      const dd = this.densidadeEm(x, yy, z);
      if (dd > 0) {
        /* Refina por bisseção na aresta que cruzou. Seis passos levam o erro a
           menos de um centímetro, e sem isso o corpo ficaria oscilando meio
           voxel a cada quadro. */
        let lo = yy;
        let hi = ant;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) * 0.5;
          if (this.densidadeEm(x, m, z) > 0) lo = m;
          else hi = m;
        }
        return hi;
      }
      ant = yy;
      dAnt = dd;
    }
    return -Infinity;
  }

  /** O teto sobre `y`, ou `Infinity` se houver céu dentro do alcance. */
  tetoAcima(x, y, z, alcance = 6, passo = VOXEL * 0.5) {
    if (this.densidadeEm(x, y, z) > 0) return y;
    for (let d = passo; d <= alcance; d += passo) {
      const yy = y + d;
      if (this.densidadeEm(x, yy, z) > 0) return yy;
    }
    return Infinity;
  }

  /** Normal da superfície — o gradiente da densidade, apontando para o ar. */
  normalEm(x, y, z, out = { x: 0, y: 0, z: 0 }) {
    const e = VOXEL;
    const gx = this.densidadeEm(x + e, y, z) - this.densidadeEm(x - e, y, z);
    const gy = this.densidadeEm(x, y + e, z) - this.densidadeEm(x, y - e, z);
    const gz = this.densidadeEm(x, y, z + e) - this.densidadeEm(x, y, z - e);
    const m = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    out.x = -gx / m;
    out.y = -gy / m;
    out.z = -gz / m;
    return out;
  }
}
