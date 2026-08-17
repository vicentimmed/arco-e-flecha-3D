/* ---------------------------------------------------------------------------
   FREEZA — o CORPO do boss. Osso, carapaça e pose, tudo por código.

   Nenhuma textura, nenhum modelo importado, nada de fora: a mesma regra do
   repositório inteiro (§3 do plano — "texturas carregadas: 0"). O que existe
   aqui é `LatheGeometry`, esfera, cone e cilindro, montados numa hierarquia de
   grupos, e um punhado de senos que os movem.

   ============================================================================
   1. QUAL FORMA, E POR QUÊ
   ============================================================================

   **A PRIMEIRA.** Baixo, casca roxa nos ombros e na cabeça, dois chifres, cauda
   longa. O pedido oferecia também a forma final (esbranquiçada, lisa, sem
   chifres), e a escolha não é de gosto — é de LEITURA A DISTÂNCIA.

   A forma final é lisa por definição: um corpo branco-perolado sem uma única
   massa escura. Ela é linda a dez metros e some contra o céu verde-claro de
   Namekusei a cem — e a distância de briga deste modo é 55 m, com trocas de
   tiro reais a 400. A primeira forma tem quatro manchas escuras que sobrevivem
   à distância: os dois ombros, o capacete, a cauda. São elas que continuam
   dizendo "aquilo ali é o chefe" quando o corpo inteiro tem vinte pixels.

   Os dois CHIFRES entram na mesma conta: eles quebram a silhueta da cabeça, que
   de outro modo seria uma bola — e uma bola sobre ombros redondos, a duzentos
   metros, é indistinguível de qualquer outro corpo.

   A ESCALA é maior que a canônica (2,24 m contra 1,58 m, ver
   `NAMEK.freeza.altura`): 1,58 m fariam do boss o MENOR corpo em campo, ao lado
   de lutadores de 1,78 m. A cauda sozinha tem 2,6 m e é o que dá a ele um
   volume que nenhum lutador tem.

   ============================================================================
   2. O REFERENCIAL
   ============================================================================

   `raiz` fica nos PÉS, com −Z para a frente e +X à direita — a mesma convenção
   do `rig.js` dos lutadores e do arqueiro. Manter a convenção não é cerimônia:
   é o que permite ao sistema de poderes, à câmera e ao HUD tratarem a posição
   dele exatamente como tratam a de qualquer outro corpo.

   ============================================================================
   3. POR QUE ELE NÃO USA `character/rig.js`
   ============================================================================

   Porque aquele arquivo monta um HUMANO, e cada número dele é contrato: `OSSO`
   tem antropometria de 1,78 m, `montarCorpo` monta gi, faixa, botas e catorze
   espetos de cabelo, e `poses.js` resolve IK de braço e perna para uma criatura
   que ANDA. O Freeza não tem nada disso — ele não tem roupa, não tem cabelo,
   não anda, tem cauda e tem carapaça. Reaproveitar aquele rig seria construir um
   humano e depois esconder metade dele.

   O que É reaproveitado é o que faz sentido: a `Aura` (exportada de
   `character/index.js` justamente para usos fora de um lutador) e as MESMAS
   ideias — luz de borda para recortar o corpo contra o céu, `LatheGeometry` para
   os membros terem bojo em vez de virarem canos, fusão de peças pequenas numa
   geometria só, e detalhe por distância.

   ============================================================================
   4. O ORÇAMENTO
   ============================================================================

   **34 malhas** com tudo à mostra e **27 além de 40 m** (some o rosto, somem os
   elos ímpares da cauda), mais até quatro da aura — medido, não estimado. É a
   ordem de grandeza de UM lutador (49 perto, 31 longe), e há um boss só em campo
   — nunca quinze.

   As fusões pagam o grosso: cada mão é uma geometria só (palma + cinco dedos), o
   capacete é uma só (calota + crista + dois chifres), o rosto é uma só (dois
   olhos, duas íris, a boca) e cada pé é uma só (sola + três garras). Sem elas
   este corpo teria 58 malhas.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { Aura } from "../character/index.js";

/* ---------------------------------------------------------------------- osso

   A antropometria do boss. Como o `OSSO` dos lutadores, estes números são
   CONTRATO e não enfeite: a mão é de onde os poderes saem (o servidor calcula a
   mesma coisa em `NamekFreeza.maoEm`), o peito é onde o dano é marcado, e a
   altura é a da cápsula que os projéteis testam.

   A proporção é a da referência e ela é deliberadamente NÃO humana: tronco
   grande, pernas curtas e grossas, ombros muito largos por causa da carapaça,
   cabeça pequena. É a silhueta que faz o corpo ser lido como "outra espécie"
   antes de qualquer detalhe aparecer. */
const OSSO = {
  /** m — do pé ao topo do capacete. O mesmo de `NAMEK.freeza.altura`. */
  altura: NAMEK.freeza.altura,
  quadrilY: 0.96,
  cinturaY: 1.12,
  peitoY: 1.44,
  ombroY: 1.62,
  /** m — meia-largura dos ombros. Larguíssima: é a marca da carapaça. */
  ombroX: 0.5,
  pescocoY: 1.74,
  cabecaY: 1.94,
  cabecaR: 0.23,
  braco: 0.42,
  antebraco: 0.38,
  coxa: 0.42,
  canela: 0.4,
  tornozeloY: 0.1,
  quadrilX: 0.19,
  /** m — meia-abertura dos pés. */
  base: 0.24,
};

/** m — comprimento total da cauda e em quantos elos ela é feita.
 *
 *  Nove elos para 2,6 m dão 29 cm cada — curto o bastante para a onda que
 *  percorre a cauda ler como uma curva e não como uma cotovelada, e longo o
 *  bastante para nove malhas serem um preço aceitável. Doze elos ficariam mais
 *  lisos e custariam um terço a mais de chamadas de desenho por uma diferença
 *  que só aparece a cinco metros. */
const CAUDA_ELOS = 9;
const CAUDA_COMP = NAMEK.freeza.cauda;

/* Distâncias (m) de corte do detalhe. Os mesmos 12 e 40 do `rig.js`, e pela
   mesma aritmética: a 12 m uma íris tem meio pixel e a 40 m um dedo tem menos
   que isso. */
const LOD_PERTO = 12;
const LOD_MEDIO = 40;
const HISTERESE = 1.12;

/* --------------------------------------------------------------- a paleta

   Escura, e a escolha é a mesma dos poderes dele: roxo profundo, magenta e
   preto com brilho. A carapaça e a energia têm de ser obviamente a mesma
   criatura — quando o Death Beam sai do dedo, a cor dele já estava no ombro. */
/* Estas NÃO são `NAMEK.freeza.cor`, e a distinção vale escrever porque é fácil
   querer unificá-las: a cor do config é a IDENTIDADE dele — o que a aura acende,
   o que os poderes emitem e o que o marcador do HUD desenha em volta do corpo —,
   e o que está aqui é a PELE e a CASCA, que precisam ser mais escuras que ela
   para o corpo não virar uma mancha de neon do tamanho de um lutador e meio. Um
   corpo da cor da própria aura não tem contorno: ele some dentro dela. */
const COR = {
  /** A pele. Branco-rosado, não branco puro: branco puro estoura no tone
   *  mapping do renderer e o corpo vira um recorte de papel. */
  pele: "#e7dfe6",
  peleEscura: "#c8bcc9",
  /** A CARAPAÇA. Roxo profundo — a cor que aparece a duzentos metros. */
  casca: "#4a1a72",
  cascaClara: "#6d2ba0",
  /** Os chifres e as unhas: osso escuro, quase preto. */
  chifre: "#2b1436",
  olho: "#f4e9f2",
  iris: "#d31432",
  boca: "#8c2050",
};

/* ------------------------------------------------------------------ material */

/**
 * Luz de borda — o contorno que separa o corpo do fundo.
 *
 * A mesma ideia de `comLuzDeBorda` no `rig.js`, com DOIS ajustes que importam:
 * a cor do rim é roxa (e não o verde-claro de lá), porque o que ela deve sugerir
 * é a energia dele e não o céu do planeta; e a **chave de cache é própria**. O
 * Three reaproveita programas compilados por chave, e dois enxertos diferentes
 * com a mesma chave dariam ao segundo o shader do primeiro — um defeito que só
 * apareceria depois de um lutador e o boss estarem na mesma cena, que é sempre.
 */
function comLuzDeBorda(material, forca = 0.3) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: forca };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float rimStrength;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
           vec3 rimV = normalize( vViewPosition );
           float rim = pow( 1.0 - abs( dot( normalize( normal ), rimV ) ), 3.0 );
           outgoingLight += vec3( 0.78, 0.36, 0.98 ) * rim * rimStrength;
         }
         #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `namek-boss-rim-${forca}`;
  return material;
}

function fosco(cor, rough = 0.72, rim = 0.3) {
  return comLuzDeBorda(
    new THREE.MeshStandardMaterial({ color: cor, roughness: rough, metalness: 0 }),
    rim,
  );
}

/** A carapaça é a única coisa dele com brilho de verdade: ela é casca, não pele.
 *  Um `metalness` baixo com `roughness` baixa dá o reflexo largo de resina. */
function carapaca(cor) {
  return comLuzDeBorda(
    new THREE.MeshStandardMaterial({ color: cor, roughness: 0.26, metalness: 0.18 }),
    0.42,
  );
}

/* --------------------------------------------------------------- montagem */

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);

/** Matriz de posição/rotação/escala para uma peça a fundir. Aloca, e pode: roda
 *  uma vez na montagem, nunca dentro do laço de quadro (§3 do plano). */
function em(x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  _e.set(rx, ry, rz);
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(s, s, s));
}

/**
 * Funde várias geometrias numa só — o truque que paga os dedos e os chifres.
 *
 * Cinco dedos são cinco malhas, e uma malha custa uma chamada de desenho esteja
 * ela a dois metros ou a duzentos. Fundidos, são zero: eles entram na geometria
 * da palma. O mesmo vale para o capacete (calota + dois chifres + crista) e para
 * o rosto (dois olhos + duas íris + a boca).
 *
 * Sem `color` por vértice aqui, ao contrário do `fundir` do `rig.js`: os
 * materiais deste corpo não usam `vertexColors` — a variação de tom vem da
 * própria forma e da luz de borda, e um atributo de cor por vértice seria três
 * floats por vértice para escrever 1,1,1.
 */
function fundir(partes) {
  const prontas = [];
  let total = 0;
  for (const p of partes) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.matriz) g.applyMatrix4(p.matriz);
    prontas.push(g);
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let off = 0;
  for (const g of prontas) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    off += g.attributes.position.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Membro torneado: altura 1, base na origem, eixo em +Y.
 *
 * Cápsula de raio constante lê como CANO — é o sinal mais forte de "boneco de
 * primitivas" que um corpo procedural emite, e o `rig.js` já documenta isso. O
 * volume tem de estar DENTRO da geometria, e é o que o perfil faz.
 *
 * @param {Array<[number, number]>} perfil pares `[altura 0..1, raio em metros]`
 */
function torneado(perfil, radial = 14) {
  const pontos = perfil.map(([t, r]) => new THREE.Vector2(Math.max(1e-4, r), t));
  return new THREE.LatheGeometry(pontos, radial);
}

/** Um `Mesh` com sombra ligada nos dois sentidos, que é o padrão do modo. */
function malha(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* ============================================================================
   O corpo
   ========================================================================== */

/** As poses que viajam em `FREEZA_STATE.u`. A tabela é espelho da do servidor
 *  (`POSE`, em `server/namek/freeza.js`) e as duas TÊM de bater — é um índice
 *  cru na rede, escolhido em vez de uma string porque ele sai 20 vezes por
 *  segundo. */
export const POSE = {
  parado: 0,
  investida: 1,
  rajada: 2,
  raio: 3,
  esfera: 4,
  onda: 5,
  dor: 6,
};

export class FreezaBody {
  /** @param {THREE.Object3D} pai a cena */
  constructor(pai) {
    this.pai = pai;

    this.raiz = new THREE.Group();
    this.raiz.name = "namek:freeza";
    this.raiz.visible = false;
    pai.add(this.raiz);

    /* O PIVÔ DE INCLINAÇÃO. O corpo inteiro arfa e rola em torno do centro de
       massa, e não dos pés: girar pelos pés faria a cabeça descrever um arco de
       dois metros a cada manobra, que é a diferença entre voar e ser
       arremessado. É a mesma decisão que `PIVO` toma no `poses.js`. */
    this.pivo = new THREE.Group();
    this.pivo.position.y = OSSO.peitoY;
    this.raiz.add(this.pivo);
    this.corpo = new THREE.Group();
    this.corpo.position.y = -OSSO.peitoY;
    this.pivo.add(this.corpo);

    this.mat = {
      pele: fosco(COR.pele, 0.64),
      peleEscura: fosco(COR.peleEscura, 0.7),
      casca: carapaca(COR.casca),
      cascaClara: carapaca(COR.cascaClara),
      chifre: fosco(COR.chifre, 0.44, 0.2),
      olho: fosco(COR.olho, 0.24, 0.1),
      iris: fosco(COR.iris, 0.3, 0.5),
      boca: fosco(COR.boca, 0.5, 0.2),
    };

    /** Tudo o que precisa de `dispose`. Geometrias fundidas não são
     *  compartilhadas com ninguém e morrem com o corpo. */
    this._geos = [];

    this.montar();

    /* -------------------------------------------------------------- a aura
     *
     * A `Aura` dos lutadores, reaproveitada inteira — ela é exportada de
     * `character/index.js` justamente para usos que não são um lutador (o
     * comentário lá cita a Genki Dama no céu).
     *
     * O que ela precisa é de um pai cujo referencial seja o de um corpo de
     * 1,78 m, porque o `PIVO` dela é uma constante daquele tamanho. Daí o grupo
     * intermediário escalado: a aura desenha na escala que ela conhece e o grupo
     * a cresce para o boss. Sem ele, a chama sairia da barriga dele. */
    this.auraPivo = new THREE.Group();
    const k = OSSO.altura / 1.78;
    this.auraPivo.scale.setScalar(k);
    this.raiz.add(this.auraPivo);
    /* Magenta profundo — a cor da rajada dele. A aura é a primeira coisa que se
       vê de longe e ela tem de ser a cor do que vem depois, e a mesma que o
       marcador do HUD desenha em volta dele: por isso ela sai de
       `NAMEK.freeza.cor` e não de um número escrito aqui. */
    this.aura = new Aura(this.auraPivo, NAMEK.freeza.cor);

    /* --------------------------------------------------------- os relógios */
    this._t = 0;
    /** 0…1 — o quanto a pose corrente está aplicada. Toda troca de pose é
     *  AMORTECIDA: o que faz parecer animação de verdade não é a quantidade de
     *  poses, é a interpolação entre elas nunca ser instantânea (§10 do plano). */
    this._peso = new Float32Array(7);
    this._peso[POSE.parado] = 1;
    this._poseAtual = POSE.parado;
    this._fracao = 0;
    this._auraForca = 0;
    this._morto = 0;
    this._nivel = 0;
    /** Fase da onda que percorre a cauda. Avança sozinha e acelera com o voo. */
    this._cauda = 0;
    this._rapidez = 0;

    this._maoTmp = new THREE.Vector3();
  }

  /* ------------------------------------------------------------- a montagem */

  montar() {
    const M = this.mat;

    /* ------------------------------------------------------------ o tronco --
     * Um torneado só, do quadril ao pescoço. O perfil é a silhueta inteira do
     * personagem: quadril estreito, barriga cheia, peito largo, ombros abrindo.
     * Ele é a peça que mais define a leitura de longe, e por isso tem 18 lados
     * (o resto do corpo usa 12 ou 14). */
    const tronco = torneado(
      [
        [0, 0.001],
        [0.06, 0.2],
        [0.2, 0.26],
        [0.42, 0.245],
        [0.62, 0.29],
        [0.82, 0.31],
        [0.94, 0.22],
        [1, 0.12],
      ],
      18,
    );
    this.tronco = malha(tronco, M.pele);
    /* O torneado tem altura 1 por construção (é o contrato de `torneado`), então
       `scale.y` é o único jeito de esticá-lo sem refazer a geometria. E o
       `scale.z` de 0,82 o ACHATA: um tronco de revolução puro é um tonel, e o
       que separa um peito de um tonel é ele ser mais largo que fundo. É essa
       linha que dá frente e costas ao corpo. */
    const alturaTronco = OSSO.pescocoY - OSSO.quadrilY + 0.12;
    this.tronco.scale.set(1, alturaTronco, 0.82);
    this.tronco.position.y = OSSO.quadrilY - 0.12;
    this.corpo.add(this.tronco);
    this._geos.push(tronco);

    /* A PLACA DO ESTERNO — a mancha roxa do peito. Meia esfera achatada, colada
       à frente do tronco. */
    const esterno = new THREE.SphereGeometry(0.21, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const placa = malha(esterno, M.casca);
    placa.rotation.x = Math.PI * 0.52;
    placa.position.set(0, OSSO.peitoY + 0.02, -0.19);
    placa.scale.set(1.15, 1, 0.55);
    this.corpo.add(placa);
    this._geos.push(esterno);

    /* ------------------------------------------------------------ os ombros --
     * As duas maiores massas escuras do corpo, e as que fazem a silhueta. Meia
     * esfera cada, mais larga que alta, encaixada por fora do tronco. */
    const domo = new THREE.SphereGeometry(0.235, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    this._geos.push(domo);
    this.ombros = [];
    for (const lado of [-1, 1]) {
      const o = malha(domo, M.casca);
      o.position.set(OSSO.ombroX * lado * 0.78, OSSO.ombroY, 0);
      o.rotation.z = -0.5 * lado;
      o.scale.set(1.25, 1.05, 1.1);
      this.corpo.add(o);
      this.ombros.push(o);
    }

    /* ------------------------------------------------------------ a cabeça --
     * Um ovo de pé, com o queixo estreito. Ela é PEQUENA em relação aos ombros
     * de propósito — é a proporção da referência e é o que faz o tronco parecer
     * enorme sem que nada nele precise crescer. */
    this.pescoco = new THREE.Group();
    this.pescoco.position.y = OSSO.pescocoY;
    this.corpo.add(this.pescoco);

    const cranio = new THREE.SphereGeometry(OSSO.cabecaR, 18, 14);
    this.cabeca = malha(cranio, M.pele);
    this.cabeca.position.y = OSSO.cabecaY - OSSO.pescocoY;
    this.cabeca.scale.set(0.94, 1.16, 1.02);
    this.pescoco.add(this.cabeca);
    this._geos.push(cranio);

    /* O CAPACETE, fundido: calota + crista + dois chifres. Quatro peças numa
       geometria, e ela é a assinatura da primeira forma. */
    const calota = new THREE.SphereGeometry(OSSO.cabecaR * 1.04, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
    const crista = new THREE.SphereGeometry(OSSO.cabecaR * 0.62, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
    /* Os chifres saem PARA OS LADOS e um pouco para cima, como na referência —
       não para a frente. Um chifre frontal leria como bico. */
    const chifre = new THREE.ConeGeometry(0.062, 0.3, 10);
    const capacete = fundir([
      { geo: calota, matriz: em(0, 0.03, 0, 0, 0, 0, 1) },
      { geo: crista, matriz: em(0, 0.02, 0.13, 0.5, 0, 0) },
      { geo: chifre, matriz: em(-OSSO.cabecaR * 0.86, 0.02, 0.02, 0, 0, Math.PI * 0.62) },
      { geo: chifre, matriz: em(OSSO.cabecaR * 0.86, 0.02, 0.02, 0, 0, -Math.PI * 0.62) },
    ]);
    calota.dispose();
    crista.dispose();
    chifre.dispose();
    this.capacete = malha(capacete, M.casca);
    this.capacete.position.copy(this.cabeca.position);
    this.capacete.scale.copy(this.cabeca.scale);
    this.pescoco.add(this.capacete);
    this._geos.push(capacete);

    /* O ROSTO, fundido: dois olhos, duas íris e a boca. Some no primeiro corte
       de detalhe (12 m) — nada aqui é estrutural, que é a regra do LOD do
       repositório inteiro. */
    const globo = new THREE.SphereGeometry(0.052, 10, 8);
    const iris = new THREE.SphereGeometry(0.03, 8, 6);
    const labio = new THREE.SphereGeometry(0.045, 10, 6);
    const olhos = fundir([
      { geo: globo, matriz: em(-0.083, 0.03, -0.185, 0, 0, 0, 1) },
      { geo: globo, matriz: em(0.083, 0.03, -0.185, 0, 0, 0, 1) },
    ]);
    const irises = fundir([
      { geo: iris, matriz: em(-0.087, 0.028, -0.216, 0, 0, 0, 1) },
      { geo: iris, matriz: em(0.087, 0.028, -0.216, 0, 0, 0, 1) },
    ]);
    const boca = fundir([{ geo: labio, matriz: em(0, -0.098, -0.185, 0, 0, 0, 1) }]);
    globo.dispose();
    iris.dispose();
    labio.dispose();
    this.rosto = new THREE.Group();
    const mOlhos = malha(olhos, M.olho);
    const mIris = malha(irises, M.iris);
    const mBoca = malha(boca, M.boca);
    mBoca.scale.set(1.5, 0.55, 0.7);
    this.rosto.add(mOlhos, mIris, mBoca);
    this.rosto.position.copy(this.cabeca.position);
    this.pescoco.add(this.rosto);
    this._geos.push(olhos, irises, boca);

    /* ------------------------------------------------------------- os braços */
    this.bracos = [];
    for (const lado of [-1, 1]) {
      this.bracos.push(this.montarBraco(lado));
    }

    /* ------------------------------------------------------------ as pernas --
     * Curtas e grossas, com a canela encapada de roxo e o pé de três dedos.
     * Fundidas em UMA geometria por perna e penduradas num grupo só: ele voa —
     * as pernas não precisam de IK, precisam de balançar juntas. */
    this.pernas = [];
    for (const lado of [-1, 1]) {
      this.pernas.push(this.montarPerna(lado));
    }

    /* ------------------------------------------------------------- a cauda --
     * Nove elos aninhados, cada um filho do anterior: a rotação de um se
     * propaga para todos os seguintes, e é isso que transforma nove senos
     * defasados numa ONDA que percorre a cauda em vez de nove segmentos
     * chacoalhando. É a hierarquia fazendo o trabalho que uma malha deformada
     * faria, sem um único vértice reescrito por quadro. */
    this.cauda = [];
    let pai = this.corpo;
    const elo = CAUDA_COMP / CAUDA_ELOS;
    for (let i = 0; i < CAUDA_ELOS; i++) {
      const g = new THREE.Group();
      /* O primeiro nasce na base da coluna; os outros, na ponta do anterior. */
      if (i === 0) g.position.set(0, OSSO.quadrilY + 0.06, 0.2);
      else g.position.set(0, 0, elo);
      pai.add(g);

      const t0 = i / CAUDA_ELOS;
      const t1 = (i + 1) / CAUDA_ELOS;
      /* O raio afina pela raiz do avanço: linear deixaria a cauda parecendo um
         cone de trânsito, e a raiz mantém a base grossa e a ponta fina, que é o
         perfil de uma cauda de verdade. */
      const r0 = 0.115 * (1 - Math.sqrt(t0) * 0.86);
      const r1 = 0.115 * (1 - Math.sqrt(t1) * 0.86);
      const geo = torneado([[0, r0 * 0.98], [0.5, (r0 + r1) * 0.52], [1, r1]], 10);
      geo.rotateX(Math.PI * 0.5);
      geo.scale(1, 1, elo);
      const m = malha(geo, i % 2 === 0 ? M.pele : M.peleEscura);
      g.add(m);
      this._geos.push(geo);
      this.cauda.push({ grupo: g, malha: m });
      pai = g;
    }

    this.raiz.traverse((o) => {
      // A caixa envolvente de um corpo articulado não ajuda em nada e o culling
      // padrão o faria sumir de lado. Mesma decisão da aura.
      if (o.isMesh) o.frustumCulled = false;
    });
  }

  montarBraco(lado) {
    const M = this.mat;
    const grupo = new THREE.Group();
    grupo.position.set(OSSO.ombroX * lado * 0.74, OSSO.ombroY - 0.06, 0);
    this.corpo.add(grupo);

    /* O BRAÇO: torneado com bíceps. O bojo está na geometria e não numa peça
       pendurada, pelo motivo que o `rig.js` documenta — um filho herdaria o
       esticão em Y e viraria uma bolha achatada. */
    /* O torneado cresce em +Y e o braço DESCE: `rotateX(π)` na geometria o vira
       de cabeça para baixo de uma vez, e a partir daí todo o resto do braço
       trabalha em −Y — que é onde o cotovelo, o antebraço e a mão ficam. Virar
       a geometria (e não a malha) evita ter de desfazer a rotação em cada peça
       pendurada nela. */
    const gBraco = torneado([[0, 0.098], [0.3, 0.108], [0.75, 0.082], [1, 0.072]], 12);
    gBraco.scale(1, OSSO.braco, 1);
    gBraco.rotateX(Math.PI);
    grupo.add(malha(gBraco, M.pele));
    this._geos.push(gBraco);

    const cotovelo = new THREE.Group();
    cotovelo.position.y = -OSSO.braco;
    grupo.add(cotovelo);

    const gAnte = torneado([[0, 0.072], [0.35, 0.084], [1, 0.062]], 12);
    gAnte.scale(1, OSSO.antebraco, 1);
    gAnte.rotateX(Math.PI);
    cotovelo.add(malha(gAnte, M.pele));
    this._geos.push(gAnte);

    /* A BRAÇADEIRA roxa do antebraço — a terceira mancha escura do corpo. */
    const gBanda = new THREE.CylinderGeometry(0.092, 0.086, 0.11, 12);
    const banda = malha(gBanda, M.cascaClara);
    banda.position.y = -0.06;
    cotovelo.add(banda);
    this._geos.push(gBanda);

    /* A MÃO, fundida: palma + cinco dedos, com o INDICADOR mais longo. O dedo
       comprido não é enfeite — é dele que sai o Death Beam, e a pose de apontar
       só existe se houver o que apontar. */
    const palma = new THREE.SphereGeometry(0.075, 10, 8);
    const dedo = new THREE.CylinderGeometry(0.019, 0.015, 0.1, 6);
    const partes = [{ geo: palma, matriz: em(0, 0, 0, 0, 0, 0, 1) }];
    for (let i = 0; i < 4; i++) {
      const a = (-0.5 + i / 3) * 0.7;
      partes.push({
        geo: dedo,
        matriz: em(Math.sin(a) * 0.055, -0.075, Math.cos(a) * -0.02, 0.1, 0, a * 0.5),
      });
    }
    /* O indicador: metade mais longo e apontando para a frente (−Z). */
    partes.push({ geo: dedo, matriz: em(0, -0.05, -0.09, Math.PI * 0.5, 0, 0, 1.45) });
    const gMao = fundir(partes);
    palma.dispose();
    dedo.dispose();
    const mao = malha(gMao, M.pele);
    mao.position.y = -OSSO.antebraco;
    cotovelo.add(mao);
    this._geos.push(gMao);

    return { grupo, cotovelo, mao, banda, lado };
  }

  montarPerna(lado) {
    const M = this.mat;
    const grupo = new THREE.Group();
    grupo.position.set(OSSO.quadrilX * lado, OSSO.quadrilY, 0);
    this.corpo.add(grupo);

    const gCoxa = torneado([[0, 0.135], [0.4, 0.145], [1, 0.112]], 12);
    gCoxa.scale(1, OSSO.coxa, 1);
    gCoxa.rotateX(Math.PI);
    const coxa = malha(gCoxa, M.pele);
    grupo.add(coxa);
    this._geos.push(gCoxa);

    const joelho = new THREE.Group();
    joelho.position.y = -OSSO.coxa;
    grupo.add(joelho);

    /* A CANELA vem encapada: o torneado de pele por dentro e a placa roxa por
       fora, que é a quarta mancha escura. Ela é uma casca (esfera aberta) e não
       um cilindro, para acompanhar a curva da panturrilha. */
    const gCanela = torneado([[0, 0.112], [0.45, 0.118], [1, 0.078]], 12);
    gCanela.scale(1, OSSO.canela, 1);
    gCanela.rotateX(Math.PI);
    const canela = malha(gCanela, M.pele);
    joelho.add(canela);
    this._geos.push(gCanela);

    const gPlaca = new THREE.CylinderGeometry(0.128, 0.095, OSSO.canela * 0.78, 12, 1, true);
    const placa = malha(gPlaca, M.casca);
    placa.position.y = -OSSO.canela * 0.42;
    joelho.add(placa);
    this._geos.push(gPlaca);

    /* O PÉ de três dedos, fundido. Três e não cinco: é o que a referência tem, e
       de longe o que se lê é a forma de garra. */
    const sola = new THREE.SphereGeometry(0.1, 10, 8);
    const unha = new THREE.ConeGeometry(0.032, 0.11, 6);
    const partes = [{ geo: sola, matriz: em(0, 0, -0.03, 0, 0, 0, 1) }];
    for (let i = 0; i < 3; i++) {
      const a = (-1 + i) * 0.44;
      partes.push({
        geo: unha,
        matriz: em(Math.sin(a) * 0.07, -0.02, -0.14 - Math.cos(a) * 0.02, -Math.PI * 0.5, 0, 0),
      });
    }
    const gPe = fundir(partes);
    sola.dispose();
    unha.dispose();
    const pe = malha(gPe, M.pele);
    pe.position.y = -OSSO.canela - 0.02;
    pe.scale.set(1, 0.68, 1.25);
    joelho.add(pe);
    this._geos.push(gPe);

    return { grupo, joelho, pe, lado };
  }

  /* ============================================================== o estado == */

  /**
   * O que o servidor mandou, aplicado ao corpo.
   *
   * A posição e a orientação são escritas DIRETO — quem interpola é quem chama
   * (`BossSystem`), pelo mesmo motivo que o `RemoteFighters` interpola por fora
   * do `Fighter`: o amortecimento de rede é assunto da rede, e este arquivo só
   * sabe desenhar.
   *
   * @param {{x,y,z,yaw,pitch,roll,pose,fracao,aura}} e
   */
  aplicar(e) {
    this.raiz.position.set(e.x, e.y, e.z);
    this.raiz.rotation.y = e.yaw;
    this.pivo.rotation.x = e.pitch * 0.42;
    this.pivo.rotation.z = e.roll;
    this._poseAtual = e.pose ?? POSE.parado;
    this._fracao = e.fracao ?? 0;
    this._auraForca = e.aura ?? 0;
    this._rapidez = e.rapidez ?? 0;
    this.raiz.visible = true;
  }

  /** Ele caiu: o corpo tomba e apaga. Um relógio só, lido em `update`. */
  morrer() {
    this._morto = 0.0001;
  }

  reviver() {
    this._morto = 0;
    this.raiz.rotation.z = 0;
    this.raiz.visible = true;
  }

  esconder() {
    this.raiz.visible = false;
  }

  /** Está no meio do tombo? Quem chama precisa saber que o corpo ainda tem o
   *  que desenhar depois de o boss já não estar mais em campo. */
  get caindo() {
    return this._morto > 0;
  }

  /* ================================================================ o quadro */

  update(dt, cameraPos) {
    if (!this.raiz.visible) return;
    this._t += dt;

    /* --------------------------------------------------------- a mistura ---
     * Cada pose tem um PESO que persegue 0 ou 1. É o §10 do plano em três
     * linhas: "o que faz parecer animação de verdade não é a quantidade de
     * poses, é a interpolação entre elas nunca ser instantânea".
     *
     * 11/s de constante é rápido — um quinto de segundo para uma troca
     * completa. Mais lento e o Death Beam sairia antes de o braço subir; mais
     * rápido e a troca vira um corte. */
    const k = 1 - Math.exp(-11 * dt);
    for (let i = 0; i < this._peso.length; i++) {
      const alvo = i === this._poseAtual ? 1 : 0;
      this._peso[i] += (alvo - this._peso[i]) * k;
    }

    this.posar(dt);
    this.animarCauda(dt);
    this.atualizarMorte(dt);
    this.atualizarDetalhe(cameraPos);
    this.atualizarAura(dt, cameraPos);
  }

  /**
   * A pose do quadro — a soma ponderada das sete.
   *
   * Todas escrevem nos MESMOS ângulos, e o peso decide quanto de cada uma entra.
   * Escrever assim (acumular num ângulo em vez de escolher uma pose) é o que faz
   * a transição funcionar sozinha: no meio de uma troca, o braço está de fato
   * entre as duas posições, e não numa terceira interpolada por fora.
   */
  posar(dt) {
    const p = this._peso;
    const f = this._fracao;
    /* A RESPIRAÇÃO e o BALANÇO de quem flutua. Duas frequências incomensuráveis
       (1,9 e 0,7 Hz) porque duas iguais batem em fase e viram um pulo. */
    const resp = Math.sin(this._t * 1.9) * 0.5 + 0.5;
    const bal = Math.sin(this._t * 0.7);

    /* Os ângulos acumulados. Zerados a cada quadro e somados pose a pose. */
    let ombroX = 0;
    let ombroZ = 0;
    let cotovelo = 0;
    let ombroXdir = 0;
    let ombroZdir = 0;
    let cotoveloDir = 0;
    let quadril = 0;
    let joelho = 0;
    let tronco = 0;
    let cabeca = 0;

    /* ---- parado: braços caídos e um pouco abertos, corpo boiando ---------- */
    const w0 = p[POSE.parado];
    ombroX += w0 * (0.12 + resp * 0.05);
    ombroZ += w0 * (0.26 + bal * 0.04);
    ombroXdir += w0 * (0.12 + resp * 0.05);
    ombroZdir += w0 * (0.26 - bal * 0.04);
    cotovelo += w0 * 0.34;
    cotoveloDir += w0 * 0.34;
    quadril += w0 * 0.22;
    joelho += w0 * -0.5;
    cabeca += w0 * (bal * 0.06);

    /* ---- investida: tronco à frente, braços para trás, pernas esticadas --- */
    const w1 = p[POSE.investida];
    tronco += w1 * 0.34;
    ombroX += w1 * -0.9;
    ombroZ += w1 * 0.14;
    ombroXdir += w1 * -0.9;
    ombroZdir += w1 * 0.14;
    cotovelo += w1 * 0.2;
    cotoveloDir += w1 * 0.2;
    quadril += w1 * -0.42;
    joelho += w1 * -0.15;

    /* ---- rajada: os dois braços à frente, alternando o soco -------------- *
     * A alternância sai de `_t` e não da rede: a cadência é conhecida
     * (`NAMEK.freeza.rajada.cadencia`) e mandar qual mão atirou em cada bola só
     * para o braço se mexer seria um campo por disparo. O que a rede manda é a
     * mão, e ela alimenta o `handPose` — aqui o que se quer é o ritmo. */
    const w2 = p[POSE.rajada];
    const soco = Math.sin(this._t * NAMEK.freeza.rajada.cadencia * Math.PI);
    ombroX += w2 * (-1.5 - Math.max(0, soco) * 0.28);
    ombroXdir += w2 * (-1.5 + Math.min(0, soco) * 0.28);
    ombroZ += w2 * 0.1;
    ombroZdir += w2 * 0.1;
    cotovelo += w2 * (0.5 - Math.max(0, soco) * 0.45);
    cotoveloDir += w2 * (0.5 + Math.min(0, soco) * 0.45);
    quadril += w2 * 0.1;
    joelho += w2 * -0.3;

    /* ---- Death Beam: o braço DIREITO estendido, dedo apontado ------------ *
     * A pose inteira do golpe é o braço subindo (`f` indo a 1) e o corpo
     * ficando quieto. É a leitura da referência: ele não se prepara, ele
     * aponta. */
    const w3 = p[POSE.raio];
    ombroXdir += w3 * (-1.62 * Math.min(1, f * 2.4));
    ombroZdir += w3 * 0.06;
    cotoveloDir += w3 * 0.04;
    ombroX += w3 * 0.16;
    ombroZ += w3 * 0.3;
    cotovelo += w3 * 0.5;
    cabeca += w3 * -0.12;
    quadril += w3 * 0.16;
    joelho += w3 * -0.42;

    /* ---- Death Ball: os dois braços para CIMA, corpo arqueado para trás -- *
     * O arco cresce com a carga (`f`), o que dá ao golpe a única coisa que um
     * windup de 3,2 s precisa ter: um progresso VISÍVEL. Quem está do outro
     * lado da arena vê o corpo abrindo e sabe quanto falta. */
    const w4 = p[POSE.esfera];
    const carga = Math.min(1, f * 1.15);
    ombroX += w4 * (-2.5 * carga - 0.2);
    ombroXdir += w4 * (-2.5 * carga - 0.2);
    ombroZ += w4 * (0.34 + carga * 0.16);
    ombroZdir += w4 * (0.34 + carga * 0.16);
    cotovelo += w4 * 0.12;
    cotoveloDir += w4 * 0.12;
    tronco += w4 * (-0.3 * carga);
    cabeca += w4 * (-0.34 * carga);
    quadril += w4 * 0.3;
    joelho += w4 * -0.7;

    /* ---- onda: braços abertos em cruz, um empurrão para fora ------------- */
    const w5 = p[POSE.onda];
    const pulso = Math.min(1, f * 3);
    ombroZ += w5 * (0.4 + pulso * 1.05);
    ombroZdir += w5 * (0.4 + pulso * 1.05);
    ombroX += w5 * -0.3;
    ombroXdir += w5 * -0.3;
    cotovelo += w5 * 0.1;
    cotoveloDir += w5 * 0.1;
    tronco += w5 * -0.16;

    /* ---- dor: encolhe -------------------------------------------------- */
    const w6 = p[POSE.dor];
    tronco += w6 * 0.5;
    ombroX += w6 * -0.5;
    ombroXdir += w6 * -0.5;
    ombroZ += w6 * -0.2;
    ombroZdir += w6 * -0.2;
    cabeca += w6 * 0.4;

    /* ------------------------------------------------------- e a escrita -- */
    const be = this.bracos[0];
    const bd = this.bracos[1];
    be.grupo.rotation.x = ombroX;
    be.grupo.rotation.z = ombroZ;
    be.cotovelo.rotation.x = cotovelo;
    bd.grupo.rotation.x = ombroXdir;
    bd.grupo.rotation.z = -ombroZdir;
    bd.cotovelo.rotation.x = cotoveloDir;

    for (const perna of this.pernas) {
      perna.grupo.rotation.x = quadril;
      perna.joelho.rotation.x = joelho;
      /* As pernas abrem um pouco quando ele voa: pernas coladas leem como
         "de pé", e ele nunca está de pé. */
      perna.grupo.rotation.z = perna.lado * 0.12;
    }
    this.corpo.rotation.x = tronco;
    this.pescoco.rotation.x = cabeca;
    /* A cabeça acompanha a arfagem do voo pela metade — o resto é o tronco. É
       o que impede o pescoço de virar uma dobradiça na primeira picada. */
    this.pescoco.rotation.y = bal * 0.05;
  }

  /**
   * A cauda.
   *
   * Uma ONDA que corre da base à ponta: cada elo recebe o mesmo seno atrasado
   * por um passo de fase. Como eles são aninhados, o atraso vira curvatura — e é
   * por isso que nove senos produzem uma serpente e não nove pedaços vibrando.
   *
   * A frequência sobe com a velocidade: parado ela ondula devagar, em arranque
   * ela chicoteia. É a mesma ideia da cauda da aura do lutador.
   */
  animarCauda(dt) {
    const vel = 1 + Math.min(2.2, this._rapidez / 40);
    this._cauda += dt * 1.5 * vel;
    /* A curvatura BASE encolhe para a ponta (`1 − t·0,45`) porque uma cauda real
       é mais rígida na raiz; sem isso a base chicoteia mais que a ponta, que é o
       contrário do que se vê. */
    for (let i = 0; i < this.cauda.length; i++) {
      const t = i / (this.cauda.length - 1 || 1);
      const fase = this._cauda - t * 2.1;
      const amp = 0.19 * (1 - t * 0.45) * vel * 0.6;
      const g = this.cauda[i].grupo;
      g.rotation.y = Math.sin(fase) * amp;
      /* A curva vertical: a cauda cai por gravidade na raiz e sobe na ponta,
         que é a pose de repouso da referência. O cosseno defasado dá o
         movimento em torno dela. */
      g.rotation.x = (i === 0 ? -0.34 : 0.1) + Math.cos(fase * 0.8) * amp * 0.5;
    }
  }

  /** O tombo. Ele cai girando, apaga e some — a barra do HUD conta o resto. */
  atualizarMorte(dt) {
    if (this._morto <= 0) return;
    this._morto += dt;
    const u = Math.min(1, this._morto / 2.6);
    this.raiz.rotation.z = u * 1.5;
    this.raiz.position.y -= dt * 14 * u;
    if (u >= 1) this.raiz.visible = false;
  }

  /**
   * Detalhe por distância. Nada do que some é estrutural — a mesma regra do
   * `Player.setDetailLevel` e do `rig.js`: a peça que desaparece sempre tinha
   * outra forma embaixo dela.
   *
   * 0 = tudo · 1 = sem rosto · 2 = sem rosto, sem meia cauda.
   */
  atualizarDetalhe(cameraPos) {
    if (!cameraPos) return;
    const d = this.raiz.position.distanceTo(cameraPos);
    const n = this._nivel;
    const nivel =
      d >= (n < 2 ? LOD_MEDIO * HISTERESE : LOD_MEDIO)
        ? 2
        : d >= (n < 1 ? LOD_PERTO * HISTERESE : LOD_PERTO)
          ? 1
          : 0;
    if (nivel === this._nivel) return;
    this._nivel = nivel;
    this.rosto.visible = nivel === 0;
    /* Além de 40 m a cauda perde os elos ímpares. A silhueta continua lá — os
       elos pares cobrem o mesmo caminho —, e o que se perde é a suavidade da
       curva, que àquela distância tem menos de um pixel de erro. */
    for (let i = 0; i < this.cauda.length; i++) {
      this.cauda[i].malha.visible = nivel < 2 || i % 2 === 0;
    }
  }

  /** A aura, com o contexto que a `Aura` dos lutadores espera. */
  atualizarAura(dt, cameraPos) {
    _ctxAura.intensidade = this._morto > 0 ? 0 : this._auraForca;
    _ctxAura.voo = 1;
    _ctxAura.rapidez = this._rapidez;
    _vel.set(0, 0, 0);
    _ctxAura.velocidade = _vel;
    _ctxAura.camera = cameraPos ?? null;
    _ctxAura.opacidade = this._nivel >= 2 ? 0.75 : 1;
    this.aura.update(dt, _ctxAura);
  }

  /* ------------------------------------------------------------ consultas -- */

  /**
   * Onde está a mão, em espaço de MUNDO. É de lá que saem os poderes na tela.
   *
   * O servidor calcula o mesmo ponto por trigonometria (`NamekFreeza.maoEm`),
   * e os dois não batem ao centímetro — nem precisam: o que importa é o golpe
   * SAIR da mão na tela de quem está olhando, e a origem que a rede manda é a do
   * servidor. Esta função existe para os floreios locais (a fagulha da carga, o
   * clarão da boca do golpe), que são desenhados onde a mão de fato está.
   */
  pontoDaMao(mao, out = { x: 0, y: 0, z: 0 }) {
    const b = this.bracos[mao ? 1 : 0];
    b.mao.getWorldPosition(this._maoTmp);
    out.x = this._maoTmp.x;
    out.y = this._maoTmp.y;
    out.z = this._maoTmp.z;
    return out;
  }

  dispose() {
    this.aura?.dispose();
    for (const g of this._geos) g.dispose();
    this._geos.length = 0;
    for (const m of Object.values(this.mat)) m.dispose();
    this.raiz.parent?.remove(this.raiz);
    this.raiz.clear();
  }
}

/* Reusados entre quadros: a aura pede um contexto e um vetor de velocidade, e
   criar os dois por quadro seria 120 objetos por segundo pelo boss sozinho. */
const _ctxAura = {
  intensidade: 0,
  voo: 1,
  rapidez: 0,
  velocidade: null,
  camera: null,
  opacidade: 1,
};
const _vel = new THREE.Vector3();

export { OSSO as OSSO_FREEZA };
