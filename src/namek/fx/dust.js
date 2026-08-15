/* ---------------------------------------------------------------------------
   A POEIRA.

   Ela é a coisa que vende o golpe. A cratera é matemática no campo de altura e
   o jogador não a vê acontecer — vê o buraco depois. O que ele vê ACONTECER é
   isto: o chão levantando.

   ------------------------------------------------------- o erro a não repetir

   Está documentado, em código, em `src/entities/kamehameha.js`, no comentário de
   `pulsarImpacto`. Vale a pena reler antes de mexer aqui, porque o defeito é
   sedutor: havia poeira no ponto onde o feixe batia, ela SUSTENTAVA (um sopro a
   cada 0,12 s durante três segundos de feixe), e vinte e cinco sopros no mesmo
   ponto viraram uma cortina opaca. Quem atirou perdia de vista a única coisa que
   a ponta precisa comunicar: ONDE ela acertou. A poeira foi removida de lá.

   Removida de lá, e reconstruída aqui com três defesas que aquele código não
   tinha:

   1. **SOPRO, NUNCA REGIME.** `poeiraDeImpacto` emite uma vez, forte, e acabou.
      Não existe temporizador, não existe repetição, não existe "enquanto o golpe
      sustenta". Um Kamehameha que queima o chão por dois segundos e meio abre UM
      sopro quando encosta, e é o suficiente — o resto do tempo o que marca o
      lugar é a ponta do feixe, que já brilha ali.

   2. **O SOPRO TEM BURACO.** O anel de poeira nasce entre 45 % e 90 % do raio
      da cratera, e não no ponto. O centro do impacto — onde está o lutador que
      levou, onde está a cratera nova, onde o jogador está olhando — fica LIMPO.
      É o mesmo motivo pelo qual uma explosão de cinema é um anel: o meio é onde
      a informação está.

   3. **A COLUNA É VÉU, O ANEL É CORPO.** O que sobe no meio é translúcido (alfa
      0,40–0,54) e o que corre rente ao chão é denso (0,58–0,76). Assim a nuvem
      tem massa onde ela não atrapalha e transparência onde ela atrapalharia.

   ------------------------------------------------------------------ o caráter

   Sobe, ABRE e desacelera — nessa ordem, e o "desacelera" é o que a maioria dos
   efeitos erra. Arrasto de 2,2–2,6 /s significa que 90 % da velocidade some nos
   primeiros nove décimos de segundo: a nuvem estoura para fora, freia e depois
   só flutua e se dissolve. Poeira que continua viajando até morrer não é poeira,
   é fumaça de foguete.

   -------------------------------------------------------------------- a cor

   Namekusei é verde-azulada, então a poeira é CLARA e levemente esverdeada — o
   material do chão em suspensão, não fumaça de incêndio. Ela é neutra de
   propósito: a cor do golpe (azul do Kamehameha, roxo do Galick) fica no clarão
   e nas fagulhas, que é onde ela informa QUEM bateu. Se a poeira também mudasse
   de cor, duas informações diferentes usariam o mesmo canal e nenhuma das duas
   seria lida.
   --------------------------------------------------------------------------- */

import { decodeCor } from "./pool.js";

/* Paleta do solo de Namekusei em suspensão. Três tons sorteados por partícula:
   uma nuvem de uma cor só é uma mancha, e o que dá volume a ela é a variação de
   claro e escuro entre os flocos — não o degradê dentro de cada um. */
const TONS = [0xd9e3cd, 0xc3d2b6, 0xe8efe2];
/** A poeira de quem cai/corre: o mesmo chão, um tom abaixo. */
const TOM_RASTRO = 0xcbd6bd;

/* Buffers de cor deste módulo. Ver `decodeCor` — o destino é do chamador
   justamente para que dois módulos possam desempacotar no mesmo quadro. */
const _rgb = new Float32Array(3);

/** Sorteio em [a, b). */
const entre = (a, b) => a + Math.random() * (b - a);

/**
 * O SOPRO de um impacto no chão.
 *
 * @param {import("./pool.js").SpritePool} pool
 * @param {number} x,y,z    o ponto do impacto — `y` é a cota do chão ali
 * @param {number} raio     raio da cratera que este golpe abriu (m)
 * @param {object|null} field  campo de altura, para o anel acompanhar o relevo
 * @param {number} fator    multiplicador de contagem do LOD (0..1)
 * @param {number} tamFator multiplicador de tamanho do LOD
 * @param {number} forca    1 = golpe de energia · <1 = queda, prop quebrado
 */
export function poeiraDeImpacto(pool, x, y, z, raio, field, fator, tamFator, forca = 1) {
  /* AS CONTAGENS SAEM DO RAIO DA CRATERA, e não da potência crua. O raio já
     passou pela raiz quadrada e pelo teto de `craterFor`, então a bola de ki
     (4 m) e a Genki Dama (21 m) ficam a uma distância visual honesta uma da
     outra: cinco vezes mais partículas, cinco vezes maiores. Escalar na potência
     crua daria cem vezes, e a bola de ki desapareceria. */
  const nAnel = Math.max(4, Math.round((5 + raio * 2.1) * fator));
  const nColuna = Math.max(2, Math.round((2 + raio * 0.8) * fator));

  const tam = raio * 0.3 * tamFator;
  /* Vida entre 1,5 s e 2,5 s, crescendo com o tamanho do buraco: uma nuvem de
     vinte metros que some no mesmo tempo que uma de quatro parece ter sido
     apagada, porque o olho espera que coisa grande demore mais. */
  const vida = Math.min(2.5, 1.5 + raio * 0.045);
  /* A velocidade de abertura é calibrada CONTRA o arrasto: com 2,3 /s a
     partícula anda `v/2,3` metros antes de parar. Somado ao raio de nascimento,
     o anel para em cima da borda da cratera — o material caindo onde ele
     realmente cairia. */
  const vAbre = 3.4 + raio * 0.62;

  /* --------------------------------------------------------------- o anel -- */
  for (let i = 0; i < nAnel; i++) {
    const a = Math.random() * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const d = raio * entre(0.45, 0.9); // o BURACO no meio: nada nasce no ponto
    const px = x + ca * d;
    const pz = z + sa * d;
    /* A cota é medida onde a partícula NASCE, não onde o golpe bateu. Numa
       encosta, um anel de vinte metros preso à cota do centro fica com metade
       enterrada e metade pairando a três metros do chão. Só vale o preço acima
       de seis metros de raio: abaixo disso o relevo não muda o bastante para o
       olho notar, e `heightAt` custa duas FBM por consulta. */
    const chao = field && raio > 6 ? field.heightAt(px, pz) : y;

    const v = vAbre * entre(0.7, 1.15);
    decodeCor(TONS[(Math.random() * TONS.length) | 0], _rgb);
    const brilho = entre(0.86, 1.06);
    if (
      !pool.spawn(
        px,
        chao + entre(0.1, 0.55) * tamFator,
        pz,
        ca * v,
        /* Sobe pouco: este é o material que ROLA para fora. Quem sobe é a
           coluna. */
        entre(0.6, 2.4) + raio * 0.06,
        sa * v,
        _rgb[0] * brilho,
        _rgb[1] * brilho,
        _rgb[2] * brilho,
        tam * entre(0.75, 1.35),
        entre(1.6, 2.4),
        vida * entre(0.8, 1.15),
        /* Empuxo levíssimo. Poeira fina não cai: ela fica no ar e se dissolve. */
        entre(0.15, 0.55),
        2.3,
        entre(0.58, 0.76) * forca,
        /* Curva 0,25: quase reta. O anel SEGURA no ar quase até o fim e some
           dissolvendo, que é o que poeira faz. */
        0.25,
        0.7,
        chao,
      )
    ) {
      return;
    }
  }

  /* ------------------------------------------------------------- a coluna -- */
  const vSobe = 4 + raio * 0.55;
  for (let i = 0; i < nColuna; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = raio * entre(0, 0.3);
    const px = x + Math.cos(a) * d;
    const pz = z + Math.sin(a) * d;
    decodeCor(TONS[(Math.random() * TONS.length) | 0], _rgb);
    const brilho = entre(0.95, 1.12);
    if (
      !pool.spawn(
        px,
        y + entre(0.3, 1.2) * tamFator,
        pz,
        (Math.random() * 2 - 1) * vAbre * 0.22,
        vSobe * entre(0.75, 1.25),
        (Math.random() * 2 - 1) * vAbre * 0.22,
        _rgb[0] * brilho,
        _rgb[1] * brilho,
        _rgb[2] * brilho,
        tam * entre(0.9, 1.5),
        entre(2.0, 3.0),
        vida * entre(0.95, 1.25),
        /* Empuxo de verdade: a coluna precisa continuar subindo depois que o
           impulso acaba, senão ela vira uma bolha que sobe e para no ar. */
        entre(0.9, 1.6),
        1.7,
        /* O VÉU. Translúcida de propósito — ver a defesa nº 3 no cabeçalho. */
        entre(0.4, 0.54) * forca,
        0.3,
        0.55,
        y,
      )
    ) {
      return;
    }
  }
}

/**
 * A poeira de uma QUEDA — alguém batendo no chão vindo de cima.
 *
 * O caráter é outro e a diferença importa: um corpo não explode, ele ESPIRRA. A
 * coluna some quase inteira (nada empurra o material para cima, só para os
 * lados), o anel sai mais rasante e mais rápido, e tudo dura menos. Reaproveitar
 * o sopro do golpe aqui faria toda queda parecer um Kamehameha fraco.
 */
export function poeiraDeQueda(pool, x, y, z, raio, field, fator, tamFator) {
  const n = Math.max(4, Math.round((6 + raio * 1.9) * fator));
  const tam = raio * 0.26 * tamFator;
  const vida = Math.min(2.1, 1.5 + raio * 0.035);
  const vAbre = 4.5 + raio * 0.8;

  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const d = raio * entre(0.25, 0.85);
    const px = x + ca * d;
    const pz = z + sa * d;
    const chao = field && raio > 6 ? field.heightAt(px, pz) : y;
    const v = vAbre * entre(0.75, 1.2);
    decodeCor(TONS[(Math.random() * TONS.length) | 0], _rgb);
    const brilho = entre(0.88, 1.08);
    if (
      !pool.spawn(
        px,
        chao + entre(0.05, 0.4) * tamFator,
        pz,
        ca * v,
        /* Rasante: o pouco que sobe é o que o próprio anel arrasta consigo. */
        entre(0.4, 1.8),
        sa * v,
        _rgb[0] * brilho,
        _rgb[1] * brilho,
        _rgb[2] * brilho,
        tam * entre(0.8, 1.4),
        entre(1.8, 2.8),
        vida * entre(0.8, 1.1),
        entre(0.1, 0.45),
        2.6,
        entre(0.5, 0.68),
        0.3,
        0.8,
        chao,
      )
    ) {
      return;
    }
  }
}

/**
 * A poeira de um objeto do cenário que se despedaça.
 *
 * Curta, baixa e sem coluna. Uma rocha que estoura não levanta cogumelo — ela
 * solta uma baforada no lugar onde estava e o que voa é o estilhaço, que é
 * assunto de `debris.js`. A cor vem do material, não do chão: casa cai em pó
 * branco de reboco, rocha em pó cinza-esverdeado, árvore em serragem clara.
 *
 * `y` é onde o objeto QUEBROU e `chao` é o terreno sob ele — são coisas
 * diferentes numa ajisa partida a três metros do solo, e é `chao` que decide
 * onde o pó para de descer.
 */
export function poeiraDeProp(pool, kind, x, y, z, raio, fator, tamFator, chao) {
  const cor = kind === "casa" ? 0xe6e2d6 : kind === "arvore" ? 0xcfc099 : 0xb9c2ae;
  const n = Math.max(3, Math.round((4 + raio * 2.2) * fator));
  const tam = raio * 0.42 * tamFator;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const v = (2.2 + raio * 1.1) * entre(0.5, 1.1);
    decodeCor(cor, _rgb);
    const brilho = entre(0.85, 1.1);
    if (
      !pool.spawn(
        x + ca * raio * entre(0, 0.6),
        y + entre(0.1, 1.0) * raio * 0.5,
        z + sa * raio * entre(0, 0.6),
        ca * v,
        entre(0.5, 2.2),
        sa * v,
        _rgb[0] * brilho,
        _rgb[1] * brilho,
        _rgb[2] * brilho,
        tam * entre(0.7, 1.3),
        entre(1.4, 2.2),
        entre(1.0, 1.6),
        entre(-0.2, 0.5),
        2.4,
        entre(0.5, 0.7),
        0.4,
        0.9,
        chao,
      )
    ) {
      return;
    }
  }
}

/**
 * O RASTRO — poeira sob quem corre ou voa rasante. Uma partícula por chamada.
 *
 * Este é o ÚNICO emissor contínuo do arquivo, e por isso ele é o único que pode
 * repetir o erro do Kamehameha. Três travas o seguram:
 *
 * • quem decide a cadência é o gerente (`NamekFx.groundTrail`), que multiplica a
 *   intensidade pelo `dt` do quadro — o rastro não fica mais denso em máquina
 *   rápida;
 * • a partícula é pequena (menos de um metro), quase transparente (0,30) e vive
 *   três quartos de segundo;
 * • e o gerente recusa o rastro quando o pool de poeira já passou de 60 % — ver
 *   `RESERVA_IMPACTO` lá. Rastro é tempero; impacto é informação. Tempero nunca
 *   pode ocupar a vaga da informação.
 */
export function poeiraDeRastro(pool, x, y, z, intensidade) {
  const a = Math.random() * Math.PI * 2;
  const v = 0.8 + intensidade * 1.9;
  decodeCor(TOM_RASTRO, _rgb);
  const brilho = entre(0.9, 1.05);
  pool.spawn(
    x + (Math.random() * 2 - 1) * 0.35,
    y + 0.12,
    z + (Math.random() * 2 - 1) * 0.35,
    Math.cos(a) * v,
    entre(0.3, 1.0),
    Math.sin(a) * v,
    _rgb[0] * brilho,
    _rgb[1] * brilho,
    _rgb[2] * brilho,
    (0.45 + intensidade * 0.5) * entre(0.8, 1.25),
    entre(1.4, 2.2),
    entre(0.6, 0.9),
    0.25,
    2.7,
    /* Trinta por cento, e nem um ponto a mais. Quinze lutadores rasantes numa
       clareira somam sessenta destas no ar ao mesmo tempo; a 0,6 de opacidade
       elas empilhariam uma névoa branca sobre a arena inteira. */
    0.3 * (0.6 + intensidade * 0.5),
    0.35,
    0.5,
    y,
  );
}
