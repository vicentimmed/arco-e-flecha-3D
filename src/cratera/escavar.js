/* ---------------------------------------------------------------------------
   A PRIMITIVA DE ESCAVAÇÃO — uma cratera, e não uma esfera.

   Este arquivo é o coração da fase, e ele existe por causa de uma crítica
   específica ao trabalho anterior:

     *"o furo na montanha ficou como um furo de minhoca e não como um acúmulo de
      várias crateras, ou seja, não tem características de crateras. Ter a
      característica de cratera é o mais importante, pois é um jogo de batalha de
      poderes Dragon Ball."*

   E a crítica estava certa por um motivo que não era de execução, era de
   receita. Lá, cada impacto removia uma ESFERA, e as esferas eram:

       do mesmo raio  ·  colineares  ·  igualmente espaçadas  ·  lisas

   A união disso é um cilindro de pontas arredondadas. O resultado não foi um
   defeito da implementação — foi exatamente o que aquela fórmula descreve. Uma
   broca.

   ------------------------------------------------- o que faz ler como cratera

   Quatro coisas, e nenhuma delas é "mais buraco":

   1. **A borda mordida.** O raio da bacia varia com a DIREÇÃO, por ruído. Uma
      circunferência perfeita é a assinatura de software desenhando um disco.
   2. **O lábio de ejeção.** O material que saiu de dentro está em algum lugar, e
      num impacto ele está no anel em volta. É ele, mais do que o buraco, que faz
      o olho ler "explodiu aqui".
   3. **A variação entre impactos.** Raio, desvio e espaçamento sorteados. Bacias
      iguais em fila reta voltam a ser um tubo por mais lascada que seja cada uma.
   4. **O escalonamento.** Bacias que se comem só PARCIALMENTE deixam lóbulos —
      a parede em anéis sobrepostos das referências, e não um cano.

   Este arquivo entrega 1, 2 e 3. O 4 é de quem chama, e sai do espaçamento
   sorteado em `espacamentoApos`.

   ------------------------------------------------------------ e o §11 manda

   Tudo aqui é função pura de (impacto, ponto), com o acaso vindo do HASH DO ID —
   nunca de `Math.random` — e usando só `+ − × ÷ √`. É o contrato que permite
   ligar isto na rede depois: cada cliente recebe a lista de impactos e reproduz
   o mesmo chão, voxel a voxel. Ver §11 de `docs/plano-fase-cratera.md`.

   **Nenhum `Math.sin`, `cos`, `exp` ou `pow` pode entrar neste arquivo.** Eles
   não têm resultado idêntico garantido entre motores de JavaScript, e um bit de
   diferença numa borda de voxel vira célula sólida num cliente e vazia no outro.
   --------------------------------------------------------------------------- */

import { ruido3, sorteio } from "./ruido.js";

/* ------------------------------------------------------------- os números --
   Todos em fração do raio nominal `R` do golpe, para a forma ser a mesma numa
   bola de ki e numa Genki Dama. */

/** Faixa do raio sorteado. Bacias de tamanhos diferentes não viram tubo. */
const RAIO_MIN = 0.75;
const RAIO_MAX = 1.3;
/* Desvio lateral máximo do centro, perpendicular ao tiro. Tira da linha reta.
 *
 * 0,30 e não 0,40: entra na conta de conectividade do `PASSO_MAX` abaixo, e os
 * dez centésimos a menos compram folga contra tampão sem que a parede deixe de
 * serpentear. */
const DESVIO = 0.3;
/* Espaçamento entre bacias sucessivas, em frações do raio NOMINAL do golpe.
 *
 * O teto não é gosto, é a conta do pior caso. Duas bacias vizinhas podem sair
 * ambas no mínimo do raio (0,75 R) e desviadas em sentidos OPOSTOS (0,30 R cada
 * uma). Para a união delas continuar ligada:
 *
 *     passo < √( (2·0,75R)² − (2·0,30·0,75R)² )  =  1,43 R
 *
 * O primeiro desenho usava 1,05 do raio JÁ SORTEADO, que chega a 1,37 R — em
 * cima do limite. O resultado, medido: túneis com TAMPÃO, trechos de rocha
 * maciça no meio do corredor. Passar a medir sobre o raio nominal e parar em
 * 0,85 dá quase o dobro de folga e não custa nada de aparência: 0,55 a 0,85
 * ainda faz as bacias se comerem só parcialmente, que é o que deixa os
 * lóbulos. */
const PASSO_MIN = 0.55;
const PASSO_MAX = 0.85;

/** Quanto a bacia estica na direção do tiro. */
const ALONGA = 0.35;
/** Amplitude das lascas grandes e das finas, em fração do raio. */
const LASCA_GRANDE = 0.22;
const LASCA_FINA = 0.09;
/** Frequência do ruído sobre a esfera de direções. */
const FREQ_GRANDE = 2.1;
const FREQ_FINA = 5.7;

/** Altura do lábio de ejeção e largura do anel, em fração do raio. */
const LABIO_ALTURA = 0.35;
const LABIO_LARGURA = 0.55;

/** A boca de uma penetração é bem maior que a broca. Ver `prepararImpacto`. */
export const FATOR_BOCA = 2.2;

/**
 * Resolve, UMA vez, tudo o que um impacto tem de sorteado.
 *
 * Chamado na inserção e não por voxel: o corpo de uma cratera são milhares de
 * amostras, e nenhuma delas pode pagar de novo o hash e a normalização.
 *
 * @param {{id:number, x:number, y:number, z:number, dx:number, dy:number, dz:number, raio:number, boca?:boolean}} imp
 * @returns {object} o impacto preparado, com centro já desviado
 */
export function prepararImpacto(imp) {
  const id = imp.id | 0;

  /* O EIXO DO TIRO, normalizado. Ele decide para onde a bacia estica e em que
     plano o desvio lateral acontece. Sem direção (uma explosão parada), o eixo
     vira vertical e a bacia sai quase esférica — que é o certo. */
  let dx = imp.dx ?? 0;
  let dy = imp.dy ?? -1;
  let dz = imp.dz ?? 0;
  const m = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (m > 1e-9) {
    dx /= m;
    dy /= m;
    dz /= m;
  } else {
    dx = 0;
    dy = -1;
    dz = 0;
  }

  /* O RAIO SORTEADO. `boca` é o primeiro impacto de uma penetração: nas
     referências a entrada é um rasgo enorme e o corredor é estreito, então ela
     entra em funil. */
  const base = imp.raio * (imp.boca ? FATOR_BOCA : 1);
  const R = base * (RAIO_MIN + sorteio(id, 1) * (RAIO_MAX - RAIO_MIN));

  /* O DESVIO LATERAL, no plano perpendicular ao tiro.
   *
   * É a linha que mais faz diferença contra o "furo de minhoca": ela tira cada
   * bacia do eixo, e a parede passa a serpentear em vez de correr reta. O plano
   * é construído a partir do eixo com o truque de sempre — escolher como
   * referência o eixo do mundo em que `d` é MENOS alinhado, senão o produto
   * vetorial degenera quando o tiro é vertical. */
  let ux;
  let uy;
  let uz;
  if (Math.abs(dy) < 0.9) {
    // d × (0,1,0)
    ux = -dz;
    uy = 0;
    uz = dx;
  } else {
    // d × (1,0,0) — a referência troca quando o tiro é quase vertical
    ux = 0;
    uy = dz;
    uz = -dy;
  }
  const um = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  ux /= um;
  uy /= um;
  uz /= um;
  // o segundo eixo do plano é o produto vetorial de d por u
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;

  /* Ângulo do desvio SEM trigonometria: dois sorteios num quadrado, rejeitados
     para dentro do círculo por normalização. É o que substitui `cos/sin` de um
     ângulo sorteado, e o §11 proíbe transcendentais aqui. */
  let a = sorteio(id, 2) * 2 - 1;
  let b = sorteio(id, 3) * 2 - 1;
  const am = Math.sqrt(a * a + b * b);
  if (am > 1e-6) {
    a /= am;
    b /= am;
  } else {
    a = 1;
    b = 0;
  }
  const desvio = sorteio(id, 4) * DESVIO * R;

  return {
    id,
    /* O centro JÁ DESVIADO. Quem consome não precisa saber que houve desvio. */
    cx: imp.x + (ux * a + vx * b) * desvio,
    cy: imp.y + (uy * a + vy * b) * desvio,
    cz: imp.z + (uz * a + vz * b) * desvio,
    dx,
    dy,
    dz,
    R,
    /* Alcance máximo que esta cratera pode tocar — o raio esticado, mais o
       lábio, mais a maior lasca. É a caixa que `campo.escavar` varre, e ela tem
       de ser generosa: uma lasca cortada pela caixa vira uma parede reta no meio
       da borda mordida, que é o oposto do que este arquivo existe para fazer. */
    alcance: R * (1 + ALONGA) * (1 + LASCA_GRANDE + LASCA_FINA) + R * LABIO_LARGURA,
    semente: (imp.id * 0x9e3779b9) | 0,
  };
}

/**
 * O raio da bacia NAQUELA DIREÇÃO — a borda mordida.
 *
 * O ruído é aplicado na DIREÇÃO (um vetor unitário) e não na posição, e essa é
 * a decisão que faz a superfície fechar: a mesma direção sempre devolve o mesmo
 * raio, então a bacia é uma superfície estrelada bem definida, sem furos e sem
 * ilhas soltas. Ruído sobre a posição daria uma nuvem de bolhas.
 *
 * @param {number} ux versor da direção do ponto em relação ao centro
 */
function raioNaDirecao(c, ux, uy, uz) {
  /* Estica no eixo do tiro. Ao quadrado para valer nos DOIS sentidos: uma
     cratera de impacto é alongada ao longo da trajetória, para a frente e para
     trás, e não uma gota apontando num sentido só. */
  const proj = ux * c.dx + uy * c.dy + uz * c.dz;
  const alonga = 1 + ALONGA * proj * proj;

  const grande = ruido3(ux * FREQ_GRANDE, uy * FREQ_GRANDE, uz * FREQ_GRANDE, c.semente);
  const fina = ruido3(
    ux * FREQ_FINA,
    uy * FREQ_FINA,
    uz * FREQ_FINA,
    (c.semente ^ 0x5bf03635) | 0,
  );

  return c.R * alonga * (1 + LASCA_GRANDE * grande + LASCA_FINA * fina);
}

/**
 * A BACIA. Distância com sinal à casca: negativa dentro do buraco.
 *
 * Quem chama faz `densidade = min(densidade, bacia)`, que é a diferença
 * booleana — remover rocha.
 */
export function bacia(c, x, y, z) {
  const vx = x - c.cx;
  const vy = y - c.cy;
  const vz = z - c.cz;
  const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (d < 1e-6) return -c.R;
  const inv = 1 / d;
  return d - raioNaDirecao(c, vx * inv, vy * inv, vz * inv);
}

/**
 * O LÁBIO DE EJEÇÃO — o material levantado em volta da boca.
 *
 * Devolve quanta rocha ADICIONAR neste ponto (zero fora do anel). Quem chama faz
 * `densidade = max(densidade, labio)`, e só onde já havia rocha por perto — ver
 * `campo.escavar`, que é onde essa ressalva mora, porque senão o lábio flutuaria
 * no ar no meio de um túnel.
 *
 * O perfil é uma PARÁBOLA `4t(1−t)`: vale zero nas duas pontas (encosta na casca
 * da bacia de um lado e no terreno intacto do outro) e cheio no meio.
 *
 * Parábola e não gaussiana, e não é gosto: `exp` é uma das funções sem
 * resultado idêntico garantido entre motores de JavaScript, e o §11 do plano
 * proíbe transcendentais em todo o caminho da escavação.
 */
export function labio(c, x, y, z) {
  const vx = x - c.cx;
  const vy = y - c.cy;
  const vz = z - c.cz;
  const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (d < 1e-6) return 0;
  const inv = 1 / d;
  const r = raioNaDirecao(c, vx * inv, vy * inv, vz * inv);

  const t = (d - r) / (c.R * LABIO_LARGURA);
  if (t <= 0 || t >= 1) return 0;
  return c.R * LABIO_ALTURA * 4 * t * (1 - t);
}

/**
 * Quanto andar até a próxima bacia de uma penetração, em metros.
 *
 * Sorteado, e é o item 4 da lista do cabeçalho: espaçamento cravado é a
 * assinatura de uma máquina, e foi ele que deu o passo de 7,00 m exatos do
 * trabalho anterior.
 *
 * **`raioNominal` é o raio do GOLPE, não o da bacia que acabou de sair.** A
 * diferença é a que separa um túnel passável de um túnel com tampão: medir sobre
 * o raio já sorteado deixa uma bacia grande mandar um passo grande para uma
 * vizinha que pode sair pequena, e as duas não se alcançam. Ver `PASSO_MAX`.
 */
export function espacamentoApos(id, raioNominal) {
  return raioNominal * (PASSO_MIN + sorteio(id, 5) * (PASSO_MAX - PASSO_MIN));
}
