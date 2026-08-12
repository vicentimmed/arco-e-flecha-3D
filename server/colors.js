/* ---------------------------------------------------------------------------
   Cores dos jogadores.

   O jogador não escolhe: o servidor sorteia. A regra pedida é "nunca uma cor já
   usada nesta sessão", e a implementação segue o espírito dela sem quebrar
   quando a paleta acaba:

     1. sorteia entre as NUNCA usadas;
     2. só quando elas acabam, sorteia entre as LIVRES (de quem já saiu).

   Nunca entre as de quem está conectado agora — dois jogadores jamais têm a
   mesma cor ao mesmo tempo. E uma cor só se repete depois que a paleta inteira
   rodou, então na prática você não reencontra a cor de um amigo que acabou de
   sair. A sessão termina quando a sala esvazia, e a paleta volta ao começo.
   --------------------------------------------------------------------------- */

/**
 * Matizes escolhidos para se destacarem do cenário — que é verde, marrom e
 * cinza — e uns dos outros. Nada de verde-grama nem de marrom-terra: numa
 * arena desse tamanho, reconhecer quem é a 60 m depende inteiramente disso.
 *
 * SEM ROSA, LILÁS OU MAGENTA — a pedido. Saíram `f06fa8` (rosa, ~333° de matiz)
 * e `d94bd0` (magenta, ~304°); nenhum tom entre vermelho e roxo ocupa mais essa
 * faixa. O `roxo` que sobra (`8e5ce0`, ~263°) é violeta puxado para o azul, não
 * lilás — a mesma checagem que vale aqui vale para a paleta separada dos bots,
 * em `botSim.js`.
 */
const PALETTE = [
  0xe2483d, // vermelho
  0x3d8ce2, // azul
  0xf2b134, // âmbar
  0x8e5ce0, // roxo
  0x25b8a0, // turquesa
  0xa9d94b, // limão
  0xff8a3d, // laranja
  0x4fd1f5, // ciano
  0xc9a227, // ocre
  0x6f7ce0, // anil
  0x2fbf5e, // esmeralda
  0xe0e0e0, // prata
  0x9c6b3f, // caramelo
  0x7fe0c0, // menta
];

export class ColorPool {
  constructor(palette = PALETTE) {
    this.palette = palette;
    /** Cores já entregues a alguém nesta sessão, tenha saído ou não. */
    this.used = new Set();
    /** Cores dos jogadores conectados AGORA — estas nunca são reentregues. */
    this.taken = new Set();
  }

  take(random = Math.random) {
    const nuncaUsadas = this.palette.filter(
      (c) => !this.used.has(c) && !this.taken.has(c),
    );
    const disponiveis = nuncaUsadas.length
      ? nuncaUsadas
      : this.palette.filter((c) => !this.taken.has(c));

    // Paleta inteira em uso (só acontece com mais jogadores que cores): repete
    // uma em vez de devolver nada. Melhor duas cores iguais que um invisível.
    if (!disponiveis.length) return this.palette[0];

    const color = disponiveis[Math.floor(random() * disponiveis.length)];
    this.used.add(color);
    this.taken.add(color);
    return color;
  }

  release(color) {
    this.taken.delete(color);
  }
}
