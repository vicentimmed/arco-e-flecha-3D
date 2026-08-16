/* ---------------------------------------------------------------------------
   O DESABAMENTO — quando a montanha furada demais cede.

   PURO, como o campo: a decisão de desabar é estado de jogo, e estado de jogo
   não pode nascer no navegador de um dos jogadores.

     *"se tiver muito pesado a parte de cima da montanha ela cede e desmorona a
      parte de cima"*

   ------------------------------------------------------------ como se decide

   Não por física de verdade — não há tensão, nem viga, nem malha de elementos.
   O critério é o que o olho usa: **quanto de rocha sobrou sustentando o que está
   em cima.**

   Depois de cada escavação, uma grade grossa de colunas varre a região mexida.
   Cada coluna responde três coisas descendo da superfície:

       o VÃO       — a primeira cavidade que ela encontra
       o TETO      — quanta rocha há entre a superfície e esse vão
       a CARGA     — quanto de montanha está apoiada nesse teto

   Uma coluna é FRÁGIL quando o teto é fino perto do vão que ele atravessa e há
   carga real por cima. Uma coluna frágil sozinha não é nada — é a beira de um
   túnel, e túnel tem beira. O que derruba é o AGRUPAMENTO: quando frágeis
   demais aparecem juntas, o que está por cima não tem mais em que se apoiar.

   -------------------------------------------------- e por que ele vira IMPACTO

   O desabamento não mexe no campo por um caminho próprio. Ele DEVOLVE impactos,
   que quem chama aplica pelo mesmo `escavar` de sempre.

   Isso não é elegância: é o §11. A lista de impactos é a única coisa que viaja
   na rede, e é dela que todo cliente reconstrói o chão. Um desabamento que
   escrevesse voxels direto seria um pedaço de terreno que existe numa máquina e
   não na outra — e como ele é justamente o evento mais dramático do modo, seria
   o pior lugar possível para os dois lados discordarem.

   ---------------------------------------------------------- a calibragem dura

   **Um golpe sozinho nunca desaba nada.** Se um Kamehameha derruba a montanha,
   os dois pedidos brigam entre si: o jogador pediu para furar e atravessar, e
   pediu para desabar quando fura DEMAIS. O desabamento é a recompensa de
   insistir, e `MIN_FRAGEIS` é o número que separa as duas coisas.
   --------------------------------------------------------------------------- */

import { VOXEL } from "./campo.js";

/* m — passo da grade de sondagem.
 *
 * Grosso, e ficou mais grosso depois de medir: com 2,5 m e marcha de meio voxel
 * a avaliação custava 1,6 MILHÃO de amostras — e um feixe dispara vinte e oito
 * escavações, o que travava a página por dezenas de segundos. Um desabamento é
 * um evento de dez metros; sondar de três em três metros o descreve igual. */
const PASSO = 3;
/** m — até onde a sondagem desce. Além disto não há teto que interesse. */
const FUNDO_SONDA = 46;
/** m — vão menor que isto não conta como cavidade; é rugosidade da parede. */
const VAO_MIN = 2;
/** Teto mais fino que esta fração do vão é frágil. */
const FRACAO_FRAGIL = 0.55;
/** m — teto mais fino que isto é frágil de qualquer jeito. */
const TETO_FINO = 4;
/* m — vão mínimo para o desabamento valer a pena.
 *
 * Substituiu uma condição de "carga" que NÃO MEDIA NADA. Ela era
 * `topo − solidoDesde`, com `solidoDesde` sendo o primeiro sólido encontrado
 * descendo — ou seja, a própria superfície. O resultado era sempre a folga de
 * dois metros com que a sondagem começa, nunca passava do mínimo, e **nenhum
 * desabamento acontecia jamais**. Medido numa caverna de 35 m de largura com
 * teto de 7 m sob um morro de 48: zero.
 *
 * O que aquela condição queria evitar era desabar um arranhão raso na clareira,
 * e quem responde por isso é o TAMANHO DO VÃO: buraco raso não tem vão de doze
 * metros. */
const VAO_GRANDE = 9;
/** Quantas colunas frágeis juntas derrubam. É o número que impede um golpe só de
 *  desabar a montanha — ver a calibragem dura, no cabeçalho. */
const MIN_FRAGEIS = 14;
/* m — o quanto o alcance da sondagem passa do alcance da escavação.
 *
 * Generoso, e por medição: a sondagem é centrada na ÚLTIMA bacia escavada, que
 * quase sempre está na BEIRA da cavidade — o feixe entra por um lado e sai pelo
 * outro. Com folga curta ela enxergava meia caverna, não juntava as catorze
 * colunas frágeis do gatilho, e o desabamento nunca acontecia. Um desabamento é
 * um evento de vinte metros; a sondagem tem de enxergar vinte metros. */
const FOLGA = 26;

/**
 * Sonda uma coluna. Devolve `null` se ela não é frágil.
 *
 * Desce da superfície procurando a primeira cavidade. Passo de meio voxel: mais
 * grosso que isso pula um teto fino, que é justamente o que se está caçando.
 */
function sondar(campo, x, z) {
  const topo = campo.alturaBase(x, z) + 2;
  const fundo = topo - FUNDO_SONDA;
  /* Passo de um voxel inteiro, e leitura no NÓ da grade em vez de trilinear.
     `densidadeEm` custa oito leituras por consulta e existe para a física, que
     precisa de continuidade; um heurístico de apoio não precisa. Oito vezes mais
     barato, pela mesma resposta. */
  const h = VOXEL;
  const ix = Math.round(x / VOXEL);
  const iz = Math.round(z / VOXEL);

  let teto = -1; // onde a rocha acabou pela primeira vez
  let vao = 0;
  let dentro = false;
  let solidoDesde = topo;

  for (let y = topo; y > fundo; y -= h) {
    const solido = campo.amostra(ix, Math.round(y / VOXEL), iz) > 0;
    if (!dentro) {
      if (!solido) continue;
      dentro = true;
      solidoDesde = y;
      continue;
    }
    if (solido) {
      if (teto >= 0) {
        /* Achou o fundo do vão: fecha a conta. */
        if (vao >= VAO_MIN) {
          const espessura = solidoDesde - teto;
          /* Teto de verdade: se ele tem menos de meio metro, não é teto — é a
             borda da boca do buraco, vista de cima. */
          const fino = espessura < vao * FRACAO_FRAGIL || espessura < TETO_FINO;
          if (espessura > 0.5 && vao >= VAO_GRANDE && fino) {
            return { teto, vao, espessura };
          }
        }
        teto = -1;
        vao = 0;
        solidoDesde = y;
      }
      continue;
    }
    if (teto < 0) teto = y;
    vao += h;
  }
  return null;
}

/**
 * Avalia a vizinhança de uma escavação e devolve os impactos do desabamento.
 *
 * @param {import("./campo.js").CampoCratera} campo
 * @param {object} c o impacto já preparado que acabou de acontecer
 * @param {(n:number)=>number} proxId de onde saem os ids dos impactos novos
 * @returns {object[]} impactos a aplicar, possivelmente vazio
 */
export function avaliarDesabamento(campo, c, proxId) {
  const alcance = c.alcance + FOLGA;
  const fragil = [];

  for (let dz = -alcance; dz <= alcance; dz += PASSO) {
    for (let dx = -alcance; dx <= alcance; dx += PASSO) {
      if (dx * dx + dz * dz > alcance * alcance) continue;
      const s = sondar(campo, c.cx + dx, c.cz + dz);
      if (s) fragil.push({ x: c.cx + dx, z: c.cz + dz, ...s });
    }
  }

  if (fragil.length < MIN_FRAGEIS) return [];

  /* O CENTRO DE MASSA das colunas frágeis, e o raio que as cobre. É onde o
     desabamento acontece — não no ponto do tiro, que pode estar na beira. */
  let sx = 0;
  let sz = 0;
  let sy = 0;
  for (const f of fragil) {
    sx += f.x;
    sz += f.z;
    sy += f.teto;
  }
  const n = fragil.length;
  const cx = sx / n;
  const cz = sz / n;
  const cy = sy / n;

  let r2 = 0;
  for (const f of fragil) {
    const d2 = (f.x - cx) * (f.x - cx) + (f.z - cz) * (f.z - cz);
    if (d2 > r2) r2 = d2;
  }
  const raio = Math.max(6, Math.sqrt(r2));

  /* O TETO CAI, e cai de baixo para cima: uma sequência de bacias subindo do
     teto até perto da superfície. Uma bacia só, gigante, deixaria uma abóbada
     perfeita — e abóbada perfeita é a assinatura de software, o oposto do que
     este trabalho inteiro persegue. Três a cinco bacias empilhadas comem o teto
     de forma irregular, que é como um desabamento come.

     E elas saem pelo mesmo `escavar` de todo mundo, com id de verdade: é o que
     mantém o desabamento dentro da lista que viaja na rede. */
  const impactos = [];
  const altura = Math.min(28, Math.max(8, cy + 0 - (cy - 0)) + 18);
  const passos = 3 + Math.min(2, Math.floor(n / 40));
  for (let i = 0; i < passos; i++) {
    const t = i / (passos - 1 || 1);
    impactos.push({
      id: proxId(),
      x: cx + (t - 0.5) * raio * 0.5,
      y: cy + t * altura * 0.55,
      z: cz + (0.5 - t) * raio * 0.35,
      /* Para CIMA: o material desaba, então a escavação sobe. */
      dx: 0,
      dy: 1,
      dz: 0,
      raio: raio * (0.55 + t * 0.28),
      desabamento: true,
    });
  }
  return impactos;
}
