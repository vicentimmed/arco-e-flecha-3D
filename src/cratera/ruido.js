/* ---------------------------------------------------------------------------
   Ruído 3D determinístico — a base de toda a escavação.

   PURO. Sem Three.js, sem DOM. Roda em Node, porque o §11.4 do plano manda: o
   campo precisa existir do lado da sala para o modo poder virar multijogador, e
   um campo que só existe no navegador não vira multijogador — vira dois jogos.

   ------------------------------------------------ por que não o ValueNoise

   `src/utils/noise.js` já tem um, e ele é 2D. A borda lascada de uma cratera é
   uma função da DIREÇÃO em três eixos (ver `escavar.js`), e projetar isso em 2D
   deixaria a bacia com simetria num eixo — uma concha, não uma pedra.

   Também é de propósito que ele não seja alterado: aquele arquivo é usado por
   todos os modos do jogo, e esta fase tem de ser isolada.

   ------------------------------------------------ e por que é feito de hash

   O ValueNoise sorteia uma tabela no construtor e a consulta por permutação.
   Aqui o valor sai direto do hash das coordenadas inteiras — sem tabela, sem
   estado, sem construtor. Duas consequências, e as duas são do §11:

   • **Nada de `Math.random`.** Não há sorteio nenhum: a mesma coordenada e a
     mesma semente dão o mesmo número em qualquer máquina, para sempre.
   • **Nada de transcendental.** `Math.imul`, deslocamentos, multiplicação e
     soma. O IEEE 754 obriga `+ − × ÷` a serem exatas; `sin`, `exp` e `pow` NÃO
     têm resultado idêntico garantido entre motores, e um bit de diferença numa
     borda de voxel vira célula sólida num cliente e vazia no outro.
   --------------------------------------------------------------------------- */

/** 1 / 2³², para levar o hash de 32 bits a [0, 1). */
const INV32 = 1 / 4294967296;

/**
 * Hash de três inteiros mais semente, em [0, 1).
 *
 * As constantes são as do murmur3 e da família xxhash, e a mistura em três
 * passos existe pelo motivo de sempre: coordenadas vizinhas diferem num bit
 * baixo, e sem espalhar os bits altos para baixo o "ruído" sairia com padrão
 * visível em degraus de um voxel.
 */
export function hash3(ix, iy, iz, semente) {
  let h = semente | 0;
  h ^= Math.imul(ix | 0, 0x27d4eb2d);
  h ^= Math.imul(iy | 0, 0x85ebca6b);
  h ^= Math.imul(iz | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) * INV32;
}

/**
 * Um número em [0, 1) a partir de um id e de um canal.
 *
 * O CANAL é o que permite tirar vários sorteios independentes do mesmo id — o
 * raio, o desvio lateral e o espaçamento de um impacto saem daqui, com canais
 * diferentes, e não podem sair correlacionados: se saíssem, as crateras grandes
 * seriam sempre as mais desviadas e o padrão apareceria.
 */
export function sorteio(id, canal) {
  return hash3(id, Math.imul(canal, 0x9e3779b9), 0x51ed270b, 0x1b873593);
}

/**
 * Ruído de valor 3D em [−1, 1].
 *
 * Interpolação por `t²(3−2t)` nos três eixos — a mesma curva de suavização do
 * `ValueNoise` do repositório, e pelo mesmo motivo: a interpolação linear pura
 * deixa a derivada em degrau nas fronteiras de célula, e derivada em degrau
 * aparece como facetas na parede depois que o gradiente vira normal.
 */
export function ruido3(x, y, z, semente = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;

  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);

  const c000 = hash3(xi, yi, zi, semente);
  const c100 = hash3(xi + 1, yi, zi, semente);
  const c010 = hash3(xi, yi + 1, zi, semente);
  const c110 = hash3(xi + 1, yi + 1, zi, semente);
  const c001 = hash3(xi, yi, zi + 1, semente);
  const c101 = hash3(xi + 1, yi, zi + 1, semente);
  const c011 = hash3(xi, yi + 1, zi + 1, semente);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, semente);

  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;

  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;

  return (y0 + (y1 - y0) * w) * 2 - 1;
}

/** Soma de oitavas do `ruido3`. Sem `Math.pow` — o ganho é acumulado. */
export function fbm3(x, y, z, oitavas = 3, semente = 0, ganho = 0.5, lacuna = 2.03) {
  let soma = 0;
  let amp = 1;
  let norma = 0;
  let fx = x;
  let fy = y;
  let fz = z;
  for (let i = 0; i < oitavas; i++) {
    soma += ruido3(fx, fy, fz, semente + i * 0x9e3779b9) * amp;
    norma += amp;
    amp *= ganho;
    fx *= lacuna;
    fy *= lacuna;
    fz *= lacuna;
  }
  return soma / norma;
}
