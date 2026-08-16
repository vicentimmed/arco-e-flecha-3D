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

import { VOXEL, NC } from "./campo.js";

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
/* Quantas colunas frágeis juntas derrubam.
 *
 * Baixou de 14 para 10 quando o voxel passou de 0,50 para 0,60 m: a sondagem
 * passou a ter menos amostras por coluna e a contagem escorregou junto — uma
 * caverna que dava catorze passou a dar doze, e o desabamento parou de
 * acontecer. É um número de CALIBRAGEM, e ele acompanha a resolução.
 *
 * A garantia de que um golpe sozinho nunca desaba não depende dele, e é bom que
 * não dependa: uma cratera de superfície não tem TETO — ela é aberta para o céu
 * —, então  não acha vão coberto nenhum e devolve zero coluna frágil,
 * qualquer que seja o limiar. Este número separa túnel pequeno de caverna. */
const MIN_FRAGEIS = 10;
/* m — o quanto o alcance da sondagem passa do alcance da escavação.
 *
 * Generoso, e por medição: a sondagem é centrada na ÚLTIMA bacia escavada, que
 * quase sempre está na BEIRA da cavidade — o feixe entra por um lado e sai pelo
 * outro. Com folga curta ela enxergava meia caverna, não juntava as catorze
 * colunas frágeis do gatilho, e o desabamento nunca acontecia. Um desabamento é
 * um evento de vinte metros; a sondagem tem de enxergar vinte metros. */
const FOLGA = 26;

/* Teto de bacias que um desabamento emite.
 *
 * O tamanho do evento vem da QUANTIDADE delas, não do raio de cada uma — e essa
 * é a diferença entre um desabamento e um congelamento. O custo de escavar
 * cresce com o CUBO do alcance: uma bacia de raio 5 varre 32 mil voxels e uma de
 * raio 33 varre 8,7 MILHÕES, duzentas e setenta vezes mais. A primeira versão
 * tirava o raio do ESPALHAMENTO das colunas frágeis, que num desabamento de
 * verdade passa de trinta metros, e emitia de três a cinco delas — era
 * exatamente o travamento relatado. */
const MAX_BACIAS = 14;
/** m — raio máximo de uma bacia de desabamento. */
const RAIO_MAX = 9;

/**
 * Sonda uma coluna. Devolve `null` se ela não é frágil.
 *
 * Desce da superfície procurando a primeira cavidade. Passo de meio voxel: mais
 * grosso que isso pula um teto fino, que é justamente o que se está caçando.
 */
function sondar(campo, x, z) {
  /* CHUNK INTOCADO NÃO TEM CAVIDADE — e esta linha é quase toda a economia.
   *
   * O terreno virgem é a fórmula do relevo: sólido abaixo da superfície, ar
   * acima, sem vão nenhum por construção. Se nenhum chunk desta coluna foi
   * escavado, não há o que sondar.
   *
   * Sem ela, `amostra` caía na fórmula em cada uma das setenta e sete amostras
   * de cada uma das setecentas colunas — e a fórmula é FBM mais o laço dos
   * morros. Medido: 168 ms só de sondagem, um congelamento de dez quadros que
   * acontecia a cada meio segundo depois de qualquer tiro, tivesse ou não
   * desabamento. Era metade do travamento relatado.
   *
   * Com ela, só as colunas sobre o que de fato foi cavado custam alguma coisa. */
  const cx = Math.floor(Math.round(x / VOXEL) / NC);
  const cz = Math.floor(Math.round(z / VOXEL) / NC);
  let algumEscavado = false;
  const topoBase = campo.alturaBase(x, z);
  const cyAlto = Math.floor(Math.round((topoBase + 2) / VOXEL) / NC);
  const cyBaixo = Math.floor(Math.round((topoBase - FUNDO_SONDA) / VOXEL) / NC);
  for (let cy = cyBaixo; cy <= cyAlto && !algumEscavado; cy++) {
    if (campo.chunks.has(campo.chaveChunk(cx, cy, cz))) algumEscavado = true;
  }
  if (!algumEscavado) return null;

  const topo = topoBase + 2;
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

  /* ------------------------------------------------------- como o teto cai --

     MUITAS bacias PEQUENAS, postas sobre as próprias colunas frágeis — e não
     poucas bacias grandes centradas na média delas.

     A primeira versão fazia o contrário, e o custo era catastrófico. O raio saía
     do ESPALHAMENTO das colunas frágeis, que passa de trinta metros num
     desabamento de verdade; e o custo de escavar cresce com o CUBO do alcance.
     Medido: uma bacia de raio 5 varre 32 mil voxels e uma de raio 33 varre 8,7
     MILHÕES — duzentas e setenta vezes mais —, e o desabamento emitia de três a
     cinco delas. Era exatamente o travamento relatado.

     Bacias pequenas sobre as colunas custam uma fração disso e, de quebra, dão
     um resultado melhor: o teto cede em pedaços irregulares, sobre os pontos que
     de fato estavam sem apoio, em vez de abrir uma abóbada lisa no meio da
     montanha. Abóbada perfeita é assinatura de software, e este trabalho inteiro
     existe para evitá-la. */

  /* Ordena por FRAGILIDADE — o teto mais fino sobre o maior vão cede primeiro —
     e pega as mais frágeis até o teto de bacias. Ordenar é barato: são algumas
     centenas de entradas, uma vez por desabamento. */
  fragil.sort((a, b) => a.espessura / a.vao - b.espessura / b.vao);

  const impactos = [];
  const quantas = Math.min(MAX_BACIAS, Math.max(4, Math.round(fragil.length / 6)));
  /* Passo pela lista para as bacias se espalharem pela área em vez de se
     amontoarem todas na coluna mais fraca. */
  const salto = Math.max(1, Math.floor(fragil.length / quantas));

  for (let k = 0; k < quantas; k++) {
    const f = fragil[Math.min(fragil.length - 1, k * salto)];
    /* O centro fica DENTRO do teto, não no vão: é o teto que some. */
    const y = f.teto + f.espessura * 0.5;
    impactos.push({
      id: proxId(),
      x: f.x,
      y,
      z: f.z,
      /* Para CIMA: o material desaba, então a escavação sobe. */
      dx: 0,
      dy: 1,
      dz: 0,
      /* Raio modesto e limitado. O tamanho do desabamento vem da QUANTIDADE de
         bacias, não do tamanho de cada uma — que é o que mantém o custo linear
         na área em vez de cúbico no raio. */
      raio: Math.min(RAIO_MAX, Math.max(4, f.espessura * 1.3 + 3)),
      desabamento: true,
    });
  }
  return impactos;
}
