/* ---------------------------------------------------------------------------
   Kakarot — o CORPO. Osso, carne e material; nenhuma pose.

   A divisão é a mesma que o arqueiro descobriu do jeito difícil (ver o cabeçalho
   de `entities/player.js`): o RIG é o que se pendura e o que se mede; a POSE é
   outro arquivo. Aqui não há um único `sin(tempo)` — se houver, está no lugar
   errado.

   ------------------------------------------------------------------ por que
   este arquivo repete código de `entities/skins/`

   `pele()`, `pano()`, o rim light, `fillNeutralVertexColors` e `podarSombras`
   existem, prontos e testados, em `entities/skins/base.js`. Importá-los seria
   uma linha. **Não são importados de propósito**, e o motivo é o §0 do plano: o
   arqueiro precisa continuar podendo mexer no contrato de skin dele — trocar a
   assinatura de `pano`, mudar `BODY`, repartir o rim light em dois — sem que uma
   luta em Namekusei apareça de cabeça para baixo. Uma dependência do modo novo
   sobre a fantasia do modo velho é exatamente o tipo de amarra que o §11 proíbe.

   O que É importado é `utils/geometry.js` e `utils/math.js`: utilitários puros,
   sem `config.js` atrás, e `shared/namek/field.js` já os importa pelo mesmo
   motivo. A régua é essa — `src/utils/` é de todo mundo, `src/entities/` é do
   arqueiro.

   --------------------------------------------------------------- referencial

   `root` fica nos PÉS, com −Z para a frente e +X à direita, igual ao arqueiro.
   O tronco (`spine`) nasce no quadril. Braços e pernas são grupos soltos filhos
   do `root`, porque a IK resolve tudo no espaço do root — pendurá-los no tronco
   obrigaria a converter alvo por alvo, a cada quadro, para nada.

   ------------------------------------------------------------- draw calls

   Um lutador são 49 malhas até 12 m, 43 entre 12 e 40 m e 31 além disso (ver
   `nivelDeDetalhe`), mais até três da aura quando ela está acesa. Quinze deles
   ao longe são ~465 chamadas, que é o teto de "15 × ~30 primitivas" do §3 do
   plano. Dois truques seguram esse número, e os dois valem mais que qualquer
   corte de qualidade:

   • **`fundir()`** — o cabelo espetado são catorze cones mais a calota, e cada
     um seria uma chamada de desenho: quinze por lutador só no penteado. Fundidos
     numa geometria só, são UMA. O mesmo vale para dedos, orelhas, olhos,
     sobrancelhas, peitoral, lapelas e o nó da faixa — sem as fusões este corpo
     teria 77 malhas em vez de 49.
   • **detalhe por distância** — nada que some é estrutural, a mesma regra que
     `Player.setDetailLevel` documenta: a peça que desaparece sempre tinha outra
     forma embaixo dela.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { shadeSegment, makeJoint } from "../../utils/geometry.js";

/* ---------------------------------------------------------------------- osso

   Antropometria de um lutador de 1,78 m — a altura que `NAMEK.fighter.height`
   declara e que a cápsula de colisão usa. Estes números são CONTRATO, não
   enfeite: a pose calcula IK com eles, a câmera vai buscar altura de ombro
   aqui e `chestPoint` marca o dano na cota do peito. Mexer neles muda jogo.

   O corpo é mais largo de ombro e mais curto de perna que o do arqueiro de
   propósito: a referência é um lutador de artes marciais desenhado em estilo
   heroico, e a proporção é o que faz a silhueta ser reconhecida a 200 m, quando
   já não há um único detalhe visível. */
export const OSSO = {
  hipY: 0.95,
  waistY: 1.1,
  chestY: 1.33,
  shoulderY: 1.47,
  /** m — meia-largura dos ombros. Larga: é a marca da silhueta. */
  shoulderX: 0.205,
  neckY: 1.55,
  headY: 1.665,
  headR: 0.108,
  upperArm: 0.3,
  foreArm: 0.27,
  thigh: 0.455,
  shin: 0.43,
  ankleY: 0.09,
  hipX: 0.115,
  /** m — meia-abertura dos pés parado. */
  stanceWidth: 0.2,
};

/* Distâncias (m) em que o corpo perde detalhe. Os mesmos cortes do arqueiro
   (12 e 40 m), e pela mesma aritmética: a 12 m uma íris tem meio pixel e a 40 m
   um dedo tem menos que isso. O plano do modo pede explicitamente o corte de
   40 m — ver §"pontos de atenção". */
export const LOD_PERTO = 12;
export const LOD_MEDIO = 40;
/** Subir de nível exige 12 % a mais de distância que descer: sem histerese, um
 *  lutador parado exatamente no limite pisca entre dois níveis a cada quadro. */
const HISTERESE = 1.12;

/**
 * Em que nível de detalhe um corpo a `dist` metros deve estar.
 * 0 = tudo · 1 = sem rosto · 2 = silhueta e cor.
 *
 * Escrita sem a função auxiliar que a versão do arqueiro usa (`utils/lod.js`)
 * por um motivo medido: uma arrow function criada dentro daqui é um contexto
 * alocado por chamada, e esta função roda uma vez por lutador por quadro. São
 * quinze alocações a cada 16 ms para economizar duas linhas.
 */
export function nivelDeDetalhe(dist, atual = 0) {
  if (dist >= (atual < 2 ? LOD_MEDIO_H : LOD_MEDIO)) return 2;
  return dist >= (atual < 1 ? LOD_PERTO_H : LOD_PERTO) ? 1 : 0;
}
const LOD_PERTO_H = LOD_PERTO * HISTERESE;
const LOD_MEDIO_H = LOD_MEDIO * HISTERESE;

/* ----------------------------------------------------------------- material */

/**
 * Luz de borda — o contorno que separa o lutador do fundo.
 *
 * Namekusei tem céu verde-claro de dia e vermelho na tempestade, e nos dois o
 * corpo é uma mancha escura contra uma parede de cor. O rim acende só onde a
 * normal foge do olhar, e é o que devolve a silhueta. Também é meio caminho do
 * traço de desenho animado que a referência tem.
 *
 * A CHAVE DE CACHE precisa ser diferente da do arqueiro. O Three reaproveita
 * programas compilados por chave, e o arqueiro registra `archer-rim-*`: dois
 * enxertos diferentes com a mesma chave dariam ao segundo o shader do primeiro,
 * e o defeito só apareceria quando os dois modos tivessem rodado na mesma aba.
 */
function comLuzDeBorda(material, forca = 0.24) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: forca };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float rimStrength;`,
      )
      /* Entra DEPOIS da iluminação e antes da névoa: o rim é luz somada, não
         propriedade da superfície. Somado antes, a névoa não o cobriria e um
         lutador a 400 m teria contorno de neon no meio da bruma. */
      .replace(
        "#include <opaque_fragment>",
        `{
           vec3 rimV = normalize( vViewPosition );
           float rim = pow( 1.0 - abs( dot( normalize( normal ), rimV ) ), 3.0 );
           outgoingLight += vec3( 0.72, 0.88, 0.78 ) * rim * rimStrength;
         }
         #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `namek-rim-${forca}`;
  return material;
}

/** Pele: brilho largo e fraco, o de quem treina ao sol. */
function pele(cor, rough = 0.62) {
  return comLuzDeBorda(
    new THREE.MeshStandardMaterial({
      color: cor,
      roughness: rough,
      metalness: 0,
      vertexColors: true,
    }),
    0.26,
  );
}

/** Pano: fosco. O gi é algodão pesado, não cetim. */
function pano(cor, rough = 0.9) {
  return comLuzDeBorda(
    new THREE.MeshStandardMaterial({
      color: cor,
      roughness: rough,
      metalness: 0,
      vertexColors: true,
    }),
    0.2,
  );
}

/* A paleta base. O laranja é o do gi da referência; o azul é o da faixa, da
   camisa de baixo e das botas — e é ele que segura a identidade do personagem
   quando a cor do jogador toma conta do gi (ver `tingir`). */
const AZUL_FAIXA = 0x1c46c8;
const AZUL_CAMISA = 0x2358d8;
const AZUL_BOTA = 0x1e3f9e;

/**
 * Os materiais DESTE corpo. Nunca de módulo — a armadilha está documentada em
 * `entities/skins/index.js` e o preço dela aqui é maior ainda: material
 * compartilhado faria a cor de um lutador tingir os quinze, e o piscar de quem
 * renasceu piscar a sala inteira.
 */
export function criarMateriais() {
  return {
    pele: pele("#f2c393"),
    peleEscura: pele("#e0a674", 0.66),
    /** O gi. É esta cor que recebe a cor do jogador. */
    gi: pano("#f07a12", 0.88),
    /** A dobra do gi (lapelas, sombra da peça sobre si mesma). */
    giFundo: pano("#c85d07", 0.9),
    calca: pano("#ef7410", 0.9),
    faixa: pano(AZUL_FAIXA, 0.86),
    camisa: pano(AZUL_CAMISA, 0.87),
    bota: pano(AZUL_BOTA, 0.72),
    botaSola: pano("#e9e2cf", 0.8),
    botaBanda: pano("#c9302a", 0.8),
    munheca: pano("#e9e6de", 0.84),
    /* Cabelo com brilho definido: é ele que dá o realce em faixa no alto dos
       espetos. Sem isso o penteado é feltro preto e some contra qualquer
       sombra. */
    cabelo: pele("#131017", 0.42),
    olho: pele("#f8f5ee", 0.3),
    olhoEscuro: pele("#241a18", 0.2),
    boca: pele("#a35a4e", 0.66),
  };
}

/** Branco de referência, para clarear a cor do jogador sem alocar. */
const BRANCO = new THREE.Color(1, 1, 1);

/**
 * A cor do jogador entra no GI, e só nele.
 *
 * O arqueiro tinge a camiseta e deixa o resto; aqui a decisão é a mesma com uma
 * razão a mais. São quinze lutadores com o MESMO corpo — não há silhueta que os
 * separe, então a cor é a identidade inteira, e ela precisa cair na maior área
 * legível que existe: o gi. A cor padrão do contrato é laranja justamente
 * porque o laranja é o gi da referência: quem não escolhe cor nenhuma sai
 * exatamente como o personagem original.
 *
 * O que NÃO é tingido é o que mantém o personagem sendo o mesmo personagem:
 * faixa, camisa de baixo e botas continuam azuis, o cabelo continua preto, a
 * pele continua pele. Um lutador vermelho e um verde ainda são obviamente o
 * mesmo lutador — que é o que a referência faz com as trocas de traje.
 *
 * As munhequeiras herdam a cor CLAREADA, pelo motivo do arqueiro: são peças de
 * poucos pixels contra a pele do antebraço, e no mesmo tom do gi elas sumiriam
 * justamente onde estão.
 */
export function tingir(mat, cor) {
  mat.gi.color.copy(cor);
  mat.calca.color.copy(cor);
  mat.giFundo.color.copy(cor).multiplyScalar(0.72);
  mat.munheca.color.copy(cor).lerp(BRANCO, 0.62);
}

/* ---------------------------------------------------------------- montagem */

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _euler = new THREE.Euler();
const _escala = new THREE.Vector3(1, 1, 1);
const CIMA = new THREE.Vector3(0, 1, 0);

/**
 * Membro torneado: altura 1, base na origem, eixo em +Y — o mesmo contrato de
 * `makeSegment`, para `orientSegment` esticá-lo entre duas juntas.
 *
 * Cápsula de raio constante lê como CANO, e cano é o sinal mais forte de
 * "boneco de primitivas" que um corpo procedural emite. O volume tem de estar
 * DENTRO da geometria: pendurar um bíceps no segmento não funciona, porque
 * `orientSegment` escreve `scale.y` e o filho herdaria o esticão achatado.
 *
 * @param {Array<[number, number]>} perfil pares `[altura 0..1, raio em metros]`
 */
function torneado(perfil, material, radial = 12, claro = 1.06, escuro = 0.74) {
  const pontos = perfil.map(([t, r]) => new THREE.Vector2(Math.max(1e-4, r), t));
  const geo = new THREE.LatheGeometry(pontos, radial);
  shadeSegment(geo, claro, escuro);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Funde várias geometrias numa só — o truque que paga o penteado.
 *
 * Catorze espetos de cabelo são catorze `Mesh`, e uma malha custa uma chamada de
 * desenho esteja ela a dois metros ou a duzentos. Com quinze lutadores em campo
 * isso são 210 chamadas gastas em cabelo. Fundidas, são 15.
 *
 * O `color` é preenchido quando falta porque os materiais do corpo têm
 * `vertexColors: true`: o Three liga `USE_COLOR` a partir do MATERIAL, sem olhar
 * a geometria, e uma peça sem o atributo sai PRETA. Concatenar uma geometria com
 * cor e outra sem também quebraria o alinhamento dos buffers.
 *
 * @param {Array<{geo: THREE.BufferGeometry, matriz?: THREE.Matrix4}>} partes
 */
function fundir(partes) {
  const prontas = [];
  let total = 0;
  for (const parte of partes) {
    const g = parte.geo.index ? parte.geo.toNonIndexed() : parte.geo;
    if (parte.matriz) g.applyMatrix4(parte.matriz);
    if (!g.attributes.color) {
      const n = g.attributes.position.count;
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    prontas.push(g);
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const cor = new Float32Array(total * 3);
  let off = 0;
  for (const g of prontas) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    cor.set(g.attributes.color.array, off * 3);
    off += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(cor, 3));
  return geo;
}

/* As duas fábricas de matriz abaixo ALOCAM, e podem: rodam uma vez por corpo, na
   montagem, e nunca dentro do laço de quadro. A regra de zero alocação do §3 do
   plano é sobre o regime, não sobre o nascimento. */

/** Matriz de posição/rotação/escala para uma peça a fundir. */
function em(x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  _euler.set(rx, ry, rz);
  return new THREE.Matrix4().compose(
    _v.set(x, y, z),
    _q.setFromEuler(_euler),
    _escala.set(s, s, s),
  );
}

/** Matriz que deita um cone (eixo +Y) na direção `dir`, com a base em `base`. */
function apontar(base, dir) {
  return new THREE.Matrix4().compose(
    base,
    _q.setFromUnitVectors(CIMA, dir.normalize()),
    _escala.set(1, 1, 1),
  );
}

/* ------------------------------------------------------------------ cabelo

   O penteado é a assinatura do personagem — mais que a cor do gi, mais que a
   cara. A referência é um leque de espetos pretos: dois caindo sobre a testa,
   uma coroa abrindo para cima e para trás, e pontas laterais que fecham a
   silhueta de perfil.

   A tabela é [azimute, elevação, comprimento, raio]. Azimute 0 é a FRENTE
   (−Z) e cresce para a direita (+X); elevação 0 é a linha do horizonte e π/2 é
   o alto da cabeça. Ela existe como dado, e não como quinze linhas de
   `new Mesh`, porque afinar um penteado é mexer em números até ele ficar certo,
   e mexer em número é barato. */
const ESPETOS = [
  // As duas franjas da testa: caem para a frente e para baixo. São elas que
  // dão a cara do personagem de frente.
  [-0.36, 0.16, 0.2, 0.036],
  [0.36, 0.14, 0.21, 0.036],
  [-0.1, 0.42, 0.19, 0.032],
  [0.14, 0.4, 0.18, 0.032],
  // A coroa: abre para cima e para trás, cada vez mais longa em direção à nuca.
  [-1.0, 0.72, 0.2, 0.04],
  [1.0, 0.7, 0.21, 0.04],
  [-1.75, 0.82, 0.23, 0.042],
  [1.75, 0.8, 0.22, 0.042],
  [-2.5, 0.78, 0.24, 0.04],
  [2.5, 0.76, 0.23, 0.04],
  [3.14, 0.86, 0.25, 0.044],
  [0.0, 1.05, 0.22, 0.038],
  // As pontas laterais, curtas: fecham o perfil na altura das orelhas.
  [-1.45, 0.24, 0.14, 0.03],
  [1.45, 0.22, 0.15, 0.03],
];

function montarCabelo(mat) {
  const R = OSSO.headR;
  const partes = [];

  /* A calota: o couro cabeludo. Sem ela os espetos nascem de uma cabeça cor de
     pele e o penteado fica flutuando. Meia esfera aberta, um fio maior que o
     crânio para não brigar em z. */
  partes.push({
    geo: new THREE.SphereGeometry(R * 1.04, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
    matriz: em(0, 0.004, 0.006),
  });

  for (const [az, el, comp, raio] of ESPETOS) {
    /* Cinco lados por cone: a 12 m um espeto tem oito pixels de largura e o
       sexto lado não aparece em lugar nenhum. Catorze cones de cinco lados são
       140 triângulos — o penteado inteiro custa menos que uma cabeça. */
    const geo = new THREE.ConeGeometry(raio, comp, 5, 1);
    // O cone nasce centrado; subir meio comprimento põe a BASE na origem, que é
    // o que `apontar` espera.
    geo.translate(0, comp * 0.5, 0);
    const cos = Math.cos(el);
    const dir = _v.set(Math.sin(az) * cos, Math.sin(el), -Math.cos(az) * cos);
    // A base entra um pouco no crânio (0,86 R) para não abrir fresta quando o
    // espeto sai quase tangente.
    const base = new THREE.Vector3(dir.x, dir.y, dir.z).multiplyScalar(R * 0.86);
    partes.push({ geo, matriz: apontar(base, dir) });
  }

  const geo = fundir(partes);
  /* Raiz escura, ponta clara — o oposto do gradiente de osso, e de propósito: a
     luz bate no alto dos espetos. `shadeSegment` mede o Y local, que aqui é o
     eixo da cabeça, então o degradê sobe junto com o penteado. Sem AO de junta:
     cabelo não tem cotovelo. */
  shadeSegment(geo, 0.7, 1.16, 0);
  const mesh = new THREE.Mesh(geo, mat.cabelo);
  mesh.castShadow = true;
  return mesh;
}

/* -------------------------------------------------------------------- rosto */

function montarRosto(mat, head, perto) {
  const R = OSSO.headR;

  // Esclera e íris: um par de malhas, não quatro. Ver `fundir`.
  const olhos = new THREE.Mesh(
    fundir(
      [-1, 1].map((lado) => ({
        geo: new THREE.SphereGeometry(R * 0.17, 10, 8),
        matriz: em(lado * R * 0.38, R * 0.12, -R * 0.86),
      })),
    ),
    mat.olho,
  );
  olhos.scale.set(1, 1.2, 0.55);
  head.add(olhos);
  perto.push(olhos);

  const iris = new THREE.Mesh(
    fundir(
      [-1, 1].map((lado) => ({
        geo: new THREE.SphereGeometry(R * 0.095, 8, 6),
        matriz: em(lado * R * 0.38, R * 0.1, -R * 0.96),
      })),
    ),
    mat.olhoEscuro,
  );
  iris.scale.set(1, 1.15, 0.5);
  head.add(iris);
  perto.push(iris);

  /* Sobrancelhas GROSSAS e caídas para dentro. É a peça mais barata do rosto e
     a que mais muda a leitura: sem elas o personagem parece surpreso o tempo
     todo; com elas, concentrado. A referência inteira se apoia nisso. */
  const cenho = new THREE.Mesh(
    fundir(
      [-1, 1].map((lado) => ({
        geo: new THREE.BoxGeometry(R * 0.36, R * 0.1, R * 0.1),
        matriz: em(lado * R * 0.4, R * 0.35, -R * 0.85, 0, 0, lado * 0.2),
      })),
    ),
    mat.cabelo,
  );
  head.add(cenho);
  perto.push(cenho);

  const nariz = new THREE.Mesh(new THREE.ConeGeometry(R * 0.1, R * 0.24, 6), mat.pele);
  nariz.rotation.x = -Math.PI / 2;
  nariz.position.set(0, -R * 0.1, -R * 0.94);
  head.add(nariz);
  perto.push(nariz);

  const boca = new THREE.Mesh(new THREE.BoxGeometry(R * 0.3, R * 0.05, R * 0.06), mat.boca);
  boca.position.set(0, -R * 0.44, -R * 0.85);
  head.add(boca);
  perto.push(boca);

  const orelhas = new THREE.Mesh(
    fundir(
      [-1, 1].map((lado) => ({
        geo: new THREE.SphereGeometry(R * 0.21, 8, 6),
        matriz: em(lado * R * 0.93, -R * 0.04, 0),
      })),
    ),
    mat.pele,
  );
  orelhas.scale.set(0.4, 1, 0.7);
  head.add(orelhas);
  perto.push(orelhas);
}

/* --------------------------------------------------------------------- braço

   Manga curta laranja, antebraço nu, munhequeira. É o traje da referência e por
   acaso também é a melhor decisão de leitura: a faixa de pele entre a manga e a
   munhequeira dá TRÊS trocas de cor ao longo do braço, e é isso que faz o membro
   ter articulação visível a cinquenta metros. */

const PERFIL_BRACO = [
  [0.0, 0.052],
  [0.2, 0.069],
  [0.46, 0.072],
  [0.76, 0.056],
  [1.0, 0.045],
];
const PERFIL_ANTEBRACO = [
  [0.0, 0.048],
  [0.26, 0.056],
  [0.62, 0.045],
  [1.0, 0.034],
];
/* A manga acaba em 0,55 do osso — e o último ponto do perfil volta ao raio do
   braço, fechando a boca da manga. Um cilindro aberto deixaria ver o vazio por
   dentro sempre que o braço apontasse para a câmera. */
const PERFIL_MANGA = [
  [0.0, 0.093],
  [0.28, 0.101],
  [0.5, 0.106],
  [0.55, 0.062],
];

function montarBraco(mat, medio) {
  const group = new THREE.Group();
  const manga = torneado(PERFIL_MANGA, mat.gi, 12);
  const upper = torneado(PERFIL_BRACO, mat.pele, 12);
  const fore = torneado(PERFIL_ANTEBRACO, mat.pele, 12);
  const elbow = makeJoint(0.05, mat.pele, 10);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.05, 0.08, 10), mat.munheca);
  band.castShadow = true;

  /* A mão: palma + dedos. Os dedos são UMA malha fundida com a origem na linha
     dos nós — girá-la em X fecha os cinco de uma vez, e é assim que o punho
     cerra na pose de carregar ki sem um osso por falange. Cinco malhas viraram
     uma, e o punho fechado continua funcionando. */
  const hand = new THREE.Group();
  const palma = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.086, 0.04), mat.peleEscura);
  palma.castShadow = true;
  hand.add(palma);

  const partesDedo = [];
  for (let i = 0; i < 4; i++) {
    partesDedo.push({
      geo: new THREE.CapsuleGeometry(0.0115, 0.05 - Math.abs(i - 1.5) * 0.008, 3, 6),
      // +Y é a direção cotovelo→mão: os dedos seguem adiante do punho, e a
      // fusão os coloca já a partir dos nós (y ≈ 0,043) para o giro do punho
      // cerrar em torno do lugar certo.
      matriz: em(-0.022 + i * 0.0147, 0.031, 0.002),
    });
  }
  const dedos = new THREE.Mesh(fundir(partesDedo), mat.peleEscura);
  dedos.position.y = 0.043;
  dedos.rotation.x = -0.2;
  hand.add(dedos);
  medio.push(dedos);

  const polegar = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.036, 3, 6), mat.peleEscura);
  polegar.position.set(0.036, 0.022, -0.014);
  polegar.rotation.set(-0.2, 0, 0.95);
  hand.add(polegar);
  medio.push(polegar);

  group.add(manga, upper, fore, elbow, band, hand);
  return { group, manga, upper, fore, elbow, band, hand, dedos };
}

/* --------------------------------------------------------------------- perna

   Calça larga do gi, bota alta até meia canela, banda vermelha na boca da bota.
   A calça é NOTAVELMENTE mais grossa que a perna — é o corte do traje, e é ele
   que dá o peso à silhueta de baixo. */

const PERFIL_COXA = [
  [0.0, 0.118],
  [0.32, 0.12],
  [0.72, 0.103],
  [1.0, 0.086],
];
const PERFIL_CANELA = [
  [0.0, 0.086],
  [0.34, 0.082],
  [0.74, 0.066],
  [1.0, 0.055],
];
/* A bota começa em 0,42 da canela e vai até o tornozelo. Um `LatheGeometry` não
   exige começar em t = 0: os pontos são o perfil, e começar no meio é
   exatamente o que faz o cano da bota nascer na batata da perna. */
const PERFIL_BOTA = [
  [0.42, 0.09],
  [0.5, 0.097],
  [0.88, 0.08],
  [1.0, 0.077],
];

function montarPerna(mat, medio) {
  const group = new THREE.Group();
  const thigh = torneado(PERFIL_COXA, mat.calca, 12);
  const shin = torneado(PERFIL_CANELA, mat.calca, 12);
  const knee = makeJoint(0.088, mat.calca, 10);
  const cano = torneado(PERFIL_BOTA, mat.bota, 12);

  /* A banda vermelha da boca da bota. Cilindro curto, e ele é o único ponto de
     vermelho do corpo inteiro — some aos 40 m sem deixar buraco, porque o cano
     da bota continua ali embaixo. */
  const banda = new THREE.Mesh(new THREE.CylinderGeometry(0.099, 0.096, 0.035, 10), mat.botaBanda);
  medio.push(banda);

  /* O pé é montado com a ponta em −Z e o grupo é girado pela pose. `order` é
     YXZ porque a pose escreve DUAS coisas nele: para onde a ponta aponta (Y) e
     quanto o peito do pé estica (X, no voo). Na ordem padrão XYZ o esticão
     aconteceria antes do giro e o pé sairia torto sempre que o lutador não
     estivesse olhando para o norte. */
  const shoe = new THREE.Group();
  shoe.rotation.order = "YXZ";
  const sola = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.036, 0.27), mat.botaSola);
  sola.position.set(0, 0.018, -0.03);
  sola.castShadow = true;
  const pe = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.078, 0.2), mat.bota);
  pe.position.set(0, 0.07, 0.0);
  pe.castShadow = true;
  shoe.add(sola, pe);

  group.add(thigh, shin, knee, cano, shoe, banda);
  return { group, thigh, shin, knee, cano, banda, shoe };
}

/* --------------------------------------------------------------------- corpo */

/**
 * Monta o lutador inteiro e devolve os HANDLES que a pose lê.
 *
 * A ordem tem razões, como no arqueiro: o tronco primeiro (é pai de tudo o que
 * se pendura nele), o resto depois, e `preencherCoresNeutras` e `podarSombras`
 * por último, quando já existe tudo o que elas medem.
 */
export function montarCorpo(mat) {
  const perto = [];
  const medio = [];

  const root = new THREE.Group();
  root.name = "kakarot";

  const spine = new THREE.Group();
  spine.position.y = OSSO.hipY;
  spine.rotation.order = "YXZ";
  root.add(spine);

  /* Quadril: cápsula deitada e achatada na frente. A escala é aplicada ANTES da
     rotação (M = T·R·S), então o 0,72 continua sendo profundidade depois de
     deitar a peça. */
  const pelve = new THREE.Mesh(new THREE.CapsuleGeometry(0.142, 0.1, 4, 12), mat.calca);
  pelve.rotation.z = Math.PI / 2;
  pelve.scale.set(1, 1, 0.72);
  pelve.castShadow = true;
  spine.add(pelve);

  /* O tronco é um TORNEADO, não um cilindro: cintura fina e peito largo é o que
     diz "lutador" antes de qualquer detalhe. 0,38 m de ombro a ombro por 0,26 m
     de profundidade — a proporção de um atleta de verdade, achatada como todo
     tórax é. */
  const altoTronco = OSSO.shoulderY - OSSO.hipY;
  const tronco = torneado(
    [
      [0.0, 0.15],
      [0.22, 0.144],
      [0.52, 0.178],
      [0.82, 0.191],
      [1.0, 0.166],
    ],
    mat.gi,
    16,
  );
  tronco.scale.set(1, altoTronco, 0.7);
  spine.add(tronco);

  // Peitoral: duas massas achatadas por cima do gi. Some aos 40 m, e o tronco
  // continua inteiro embaixo.
  const peitoral = new THREE.Mesh(
    fundir(
      [-1, 1].map((lado) => ({
        geo: new THREE.SphereGeometry(0.082, 10, 8),
        matriz: em(lado * 0.072, OSSO.chestY - OSSO.hipY, -0.058),
      })),
    ),
    mat.gi,
  );
  peitoral.scale.set(1, 0.78, 0.52);
  spine.add(peitoral);
  medio.push(peitoral);

  /* A camisa azul por baixo aparece em dois lugares: a gola e o decote em V do
     gi aberto. São as duas peças que impedem o tronco de virar um bloco laranja
     chapado, e é a leitura mais rápida de "isto é um gi" que existe. */
  const gola = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.096, 0.05, 12), mat.camisa);
  gola.position.y = OSSO.neckY - OSSO.hipY - 0.075;
  gola.scale.set(1, 1, 0.82);
  spine.add(gola);
  medio.push(gola);

  const decote = new THREE.Mesh(
    fundir(
      [-1, 1].map((lado) => ({
        geo: new THREE.BoxGeometry(0.05, 0.2, 0.03),
        matriz: em(lado * 0.042, OSSO.chestY - OSSO.hipY - 0.02, -0.115, 0, 0, lado * 0.28),
      })),
    ),
    mat.camisa,
  );
  spine.add(decote);
  medio.push(decote);

  // As duas bandas do gi cruzando o peito — a dobra da peça sobre si mesma.
  const lapelas = new THREE.Mesh(
    fundir(
      [-1, 1].map((lado) => ({
        geo: new THREE.BoxGeometry(0.062, 0.3, 0.028),
        matriz: em(lado * 0.085, OSSO.chestY - OSSO.hipY - 0.03, -0.1, 0, 0, lado * 0.2),
      })),
    ),
    mat.giFundo,
  );
  spine.add(lapelas);
  medio.push(lapelas);

  /* A FAIXA. O plano manda ela sumir além de 40 m, e some — mas de perto é a
     peça que amarra o traje: sem ela o gi é um pijama laranja. */
  const faixa = new THREE.Mesh(new THREE.CylinderGeometry(0.163, 0.158, 0.088, 14), mat.faixa);
  faixa.position.y = OSSO.waistY - OSSO.hipY - 0.07;
  faixa.scale.set(1, 1, 0.72);
  faixa.castShadow = true;
  spine.add(faixa);
  medio.push(faixa);

  // As duas pontas do nó, caindo no quadril esquerdo.
  const no = new THREE.Mesh(
    fundir([
      { geo: new THREE.BoxGeometry(0.05, 0.17, 0.03), matriz: em(-0.11, 0.03, -0.1, 0, 0, 0.16) },
      { geo: new THREE.BoxGeometry(0.045, 0.13, 0.03), matriz: em(-0.15, 0.05, -0.085, 0, 0, -0.1) },
    ]),
    mat.faixa,
  );
  spine.add(no);
  medio.push(no);

  const pescoco = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.1, 10), mat.pele);
  pescoco.position.y = OSSO.neckY - OSSO.hipY - 0.04;
  pescoco.castShadow = true;
  spine.add(pescoco);

  for (const lado of [-1, 1]) {
    const ombro = makeJoint(0.077, mat.gi, 12);
    ombro.position.set(lado * OSSO.shoulderX, altoTronco, 0);
    spine.add(ombro);
  }

  /* Âncora do peito: um objeto vazio na cota do centro de massa que
     `NAMEK.fighter.chest` declara. É dele que saem o número de dano e a etiqueta
     de nome, e ele é um `Object3D` em vez de uma conta porque o corpo TOMBA: um
     `position.y + 1,15` continuaria marcando o dano no ar depois que o lutador
     caiu de costas no chão. */
  const ancoraPeito = new THREE.Object3D();
  ancoraPeito.position.y = 0.2;
  spine.add(ancoraPeito);

  /* cabeça ------------------------------------------------------------- */
  const head = new THREE.Group();
  head.position.y = OSSO.headY - OSSO.hipY;
  head.rotation.order = "YXZ";
  spine.add(head);

  const cranio = makeJoint(OSSO.headR, mat.pele, 16);
  cranio.scale.set(0.95, 1.05, 1.0);
  head.add(cranio);

  montarRosto(mat, head, perto);

  /* O cabelo vive num grupo próprio para a pose poder jogá-lo para trás no
     arranque sem mexer na geometria: escalar em Z e girar em X são duas linhas,
     e uma simulação de fio seria mil. */
  const cabeloRaiz = new THREE.Group();
  head.add(cabeloRaiz);
  cabeloRaiz.add(montarCabelo(mat));

  /* membros ------------------------------------------------------------ */
  const bracoR = montarBraco(mat, medio);
  const bracoL = montarBraco(mat, medio);
  const pernaR = montarPerna(mat, medio);
  const pernaL = montarPerna(mat, medio);
  root.add(bracoR.group, bracoL.group, pernaR.group, pernaL.group);

  preencherCoresNeutras(root);
  podarSombras(root);

  return {
    root,
    spine,
    head,
    cabeloRaiz,
    ancoraPeito,
    bracoR,
    bracoL,
    pernaR,
    pernaL,
    detalhe: { perto, medio },
  };
}

/**
 * Preenche `color` = branco em toda geometria da subárvore que não tiver.
 *
 * Obrigatório, e o sintoma de esquecer é violento: os materiais do corpo têm
 * `vertexColors: true`, o Three define `USE_COLOR` a partir do MATERIAL, e uma
 * geometria sem o atributo entrega (0,0,0) ao WebGL — a peça sai PRETA. Só
 * torneados e juntas nascem com cor; caixa, cilindro e cone são primitivas
 * cruas, e é aqui que elas recebem o branco.
 */
export function preencherCoresNeutras(raiz) {
  raiz.traverse((o) => {
    const geo = o.geometry;
    if (!geo || geo.attributes.color) return;
    const n = geo.attributes.position.count;
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  });
}

/** Raio (m) abaixo do qual a peça deixa de lançar sombra. */
const RAIO_MINIMO_DE_SOMBRA = 0.15;

/**
 * Tira do passe de sombra o que é pequeno demais para projetar sombra.
 *
 * O passe de sombra é um SEGUNDO desenho da cena, do ponto de vista do sol:
 * cada peça com `castShadow` é desenhada duas vezes por quadro. Com quinze
 * lutadores, cada dedo que sobra ali custa quinze desenhos por uma sombra que
 * não chega a um texel. O critério é o TAMANHO e não uma lista de nomes, porque
 * lista sai de sincronia na primeira peça nova.
 */
export function podarSombras(raiz) {
  raiz.traverse((o) => {
    if (!o.isMesh || !o.castShadow || !o.geometry) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const raio = o.geometry.boundingSphere?.radius ?? Infinity;
    const escala = Math.max(o.scale.x, o.scale.y, o.scale.z);
    if (raio * escala < RAIO_MINIMO_DE_SOMBRA) o.castShadow = false;
  });
}
