/* ---------------------------------------------------------------------------
   O grão do chão de Namekusei.

   ----------------------------------------------------------------- o problema

   A malha do campo tem célula de 2,6 m. Cor por vértice nessa escala descreve
   REGIÃO — onde é campo, onde é rocha, onde é praia — e não descreve
   SUPERFÍCIE: a dois metros do chão, entre um vértice e o vizinho, não há
   informação nenhuma, e o interpolador do hardware preenche o vão com um
   degradê liso. É por isso que o planeta lia como uma chapa pintada.

   Resolver isso por vértice sairia caríssimo (o grão de 20 cm precisaria de
   célula de 20 cm, ou seja, cento e sessenta vezes mais vértices no campo).
   Resolve-se por FRAGMENTO, que é onde a informação é vista.

   ------------------------------------------------ por que não é arquivo de imagem

   O §3 do plano registra "zero texturas", e a razão dele continua valendo: o
   repositório não carrega nenhum arquivo de imagem, e não é para passar a
   carregar. A textura daqui é GERADA EM CÓDIGO no arranque do modo — seis
   oitavas de ruído de valor num `DataTexture` de 256², ~260 KB de RAM, zero
   bytes de download e zero requisições. O que o §3 protege (peso de download,
   pipeline de asset, cache) segue protegido; o que ele custava (chão sem grão)
   deixa de ser cobrado.

   -------------------------------------------------------- por que anti-repetição

   Um ladrilho de 2,4 m repete ~145 vezes na travessia da clareira. Repetição
   nessa contagem não lê como grão, lê como PADRÃO — é o defeito clássico de
   textura ladrilhada, e é visível justamente à meia distância, que é onde a
   briga acontece.

   A correção mistura duas leituras da MESMA textura, em escalas diferentes e
   com a segunda girada 137,5° (o ângulo áureo, que não alinha com a primeira
   em nenhum múltiplo baixo). O padrão combinado só volta a coincidir consigo
   mesmo a uma distância muito maior que a arena inteira.

   ------------------------------------------------------------------- o custo

   Sete leituras de textura por fragmento do terreno (duas triplanares de três,
   mais a macro). É custo de FRAGMENTO, não de vértice nem de chamada de
   desenho — não mexe no orçamento de triângulos do §3 nem na contagem de draw
   calls, que é o recurso escasso medido em `docs/plano-lua-desempenho.md`.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { clamp, makeRandom } from "../../utils/math.js";

/**
 * A textura de detalhe: RGB = normal tangente (Sobel sobre um campo de altura
 * de ruído), A = variação de albedo. Empacotar as duas coisas num RGBA é o que
 * permite uma amostragem triplanar de três leituras em vez de seis.
 *
 * PERIÓDICA por construção: as grades do ruído dão a volta em 256 px, então
 * ela ladrilha sem costura visível.
 */
function gerarTextura(seed) {
  const S = 256;
  const rnd = makeRandom(seed);
  const altura = new Float32Array(S * S);

  for (const [celulas, amp] of [
    [4, 1.0],
    [8, 0.55],
    [16, 0.3],
    [32, 0.18],
    [64, 0.1],
    [128, 0.06],
  ]) {
    const g = new Float32Array(celulas * celulas);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    const passo = S / celulas;
    for (let y = 0; y < S; y++) {
      const fy = y / passo;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const y0i = y0 % celulas;
      const y1i = (y0 + 1) % celulas;
      for (let x = 0; x < S; x++) {
        const fx = x / passo;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x0i = x0 % celulas;
        const x1i = (x0 + 1) % celulas;
        const cima = g[y0i * celulas + x0i] + (g[y0i * celulas + x1i] - g[y0i * celulas + x0i]) * sx;
        const baixo = g[y1i * celulas + x0i] + (g[y1i * celulas + x1i] - g[y1i * celulas + x0i]) * sx;
        altura[y * S + x] += (cima + (baixo - cima) * sy) * amp;
      }
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < altura.length; i++) {
    if (altura[i] < min) min = altura[i];
    if (altura[i] > max) max = altura[i];
  }
  const inv = 1 / (max - min || 1);
  for (let i = 0; i < altura.length; i++) altura[i] = (altura[i] - min) * inv;

  const dados = new Uint8Array(S * S * 4);
  const FORCA = 3.0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = altura[y * S + ((x - 1 + S) % S)];
      const r = altura[y * S + ((x + 1) % S)];
      const u = altura[((y - 1 + S) % S) * S + x];
      const d = altura[((y + 1) % S) * S + x];
      const nx = (l - r) * FORCA;
      const ny = (u - d) * FORCA;
      const len = Math.hypot(nx, ny, 1);
      const i4 = (y * S + x) * 4;
      dados[i4] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      dados[i4 + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      dados[i4 + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      dados[i4 + 3] = Math.round(clamp(0.5 + (altura[y * S + x] - 0.5) * 0.9, 0, 1) * 255);
    }
  }

  const tex = new THREE.DataTexture(dados, S, S, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A textura do modo, criada na primeira vez que alguém pede.
 *
 * Guardada no módulo de propósito: ela é a MESMA para o chão e para as rochas,
 * e recriá-la por peça custaria 260 KB e ~40 ms de CPU cada. Quem a destrói é
 * `descartarDetalhe`, chamado no `dispose` do mundo — este modo não tem o
 * registro de recursos de módulo do jogo do arqueiro (§0), então a limpeza é
 * explícita.
 */
let textura = null;

export function texturaDeDetalhe(seed = 0x5a3c17) {
  if (!textura) textura = gerarTextura(seed);
  return textura;
}

/** Solta a textura do módulo. Chamado quando o mundo inteiro é desmontado. */
export function descartarDetalhe() {
  textura?.dispose();
  textura = null;
}

/**
 * Enxerta SÓ o detalhe num material — o caminho para quem não tem outro
 * enxerto disputando o `onBeforeCompile`.
 *
 * O terreno não usa isto: lá o detalhe divide a função com as fissuras de
 * magma, e os dois têm de ser montados juntos (ver `criarMaterial`). Quem usa
 * é a ROCHA do cenário, para a pedra não ficar lisa ao lado de um chão que
 * agora tem grão — a diferença de tratamento entre os dois é mais visível que
 * a ausência de grão nos dois.
 *
 * @param {THREE.Material} material
 * @param {string} chave identidade do programa no cache do Three
 */
export function aplicarDetalhe(material, chave) {
  const uniforms = DETALHE_GLSL.uniforms(texturaDeDetalhe());
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${DETALHE_GLSL.vertexCommon}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${DETALHE_GLSL.vertexBody}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${DETALHE_GLSL.fragmentCommon}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${DETALHE_GLSL.fragmentColor}`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\n${DETALHE_GLSL.fragmentNormal}`,
      );
  };
  material.customProgramCacheKey = () => chave;
  return material;
}

/**
 * Os trechos de GLSL do detalhe, para serem enxertados num
 * `MeshStandardMaterial` via `onBeforeCompile`.
 *
 * Devolve pedaços de texto em vez de aplicar o enxerto porque o material do
 * terreno já tem OUTRO enxerto — as fissuras de magma — e `onBeforeCompile` é
 * um só: os dois precisam ser montados juntos, na mesma função, por quem é
 * dono do material. Ver `NamekTerrain.criarMaterial`.
 */
export const DETALHE_GLSL = {
  /** Uniforms a serem misturados em `shader.uniforms`. */
  uniforms(mapa) {
    return {
      detailMap: { value: mapa },
      // repetições/metro ⇒ ladrilho de ~2,4 m, na escala do grão de solo
      detailScale: { value: 0.42 },
      // a segunda grade, fora de fase com a primeira (ver o cabeçalho)
      detailScale2: { value: 0.42 * 0.53 },
      // manchas de ~90 m: quebra a leitura de "mesma superfície em todo lugar"
      macroScale: { value: 0.011 },
      /* Força do relevo falso. Contido de propósito: acima de ~0,6 o grão
         começa a competir com a inclinação real do relevo, e a leitura de
         montanha se perde num chuvisco de normais. */
      detailBump: { value: 0.42 },
    };
  },

  vertexCommon: `
    varying vec3 vWorldPos;
    varying vec3 vWorldNrm;`,

  vertexBody: `
    vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vWorldNrm = normalize(mat3(modelMatrix) * objectNormal);`,

  fragmentCommon: `
    uniform sampler2D detailMap;
    uniform float detailScale;
    uniform float detailScale2;
    uniform float macroScale;
    uniform float detailBump;
    varying vec3 vWorldPos;
    varying vec3 vWorldNrm;

    vec2 girarUV(vec2 uv, float a) {
      float s = sin(a), c = cos(a);
      return mat2(c, -s, s, c) * uv;
    }

    vec4 triplanarUma(sampler2D m, vec3 p, vec3 w, float s, float ang) {
      return texture2D(m, girarUV(p.zy, ang) * s) * w.x
           + texture2D(m, girarUV(p.xz, ang) * s) * w.y
           + texture2D(m, girarUV(p.xy, ang) * s) * w.z;
    }

    /* Duas grades, a segunda girada 2,399 rad (137,5°, o ângulo áureo). É a
       mistura delas que impede o ladrilho de aparecer como padrão. */
    vec4 triplanarAT(sampler2D m, vec3 p, vec3 w, float s1, float s2) {
      return mix(triplanarUma(m, p, w, s1, 0.0), triplanarUma(m, p, w, s2, 2.399), 0.5);
    }`,

  /** Vai depois de `<color_fragment>`, que é onde a cor de vértice já entrou. */
  fragmentColor: `
    vec3 triW = pow(abs(vWorldNrm), vec3(4.0));
    triW /= (triW.x + triW.y + triW.z + 1e-5);
    vec4 detalhe = triplanarAT(detailMap, vWorldPos, triW, detailScale, detailScale2);
    float macro = texture2D(detailMap, girarUV(vWorldPos.xz, 0.7) * macroScale).a;
    /* MULTIPLICA a cor de vértice, não a substitui: a cor de vértice continua
       mandando na REGIÃO (campo, rocha, praia, fundo do mar) e o detalhe só
       diz o que acontece dentro de um metro quadrado dela. */
    diffuseColor.rgb *= (0.68 + 0.64 * detalhe.a) * (0.86 + 0.28 * macro);`,

  /** Vai depois de `<normal_fragment_maps>`: o relevo falso do grão. */
  fragmentNormal: `
    {
      vec3 gn = normalize(vWorldNrm);
      vec3 tX = normalize(cross(abs(gn.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0), gn));
      vec3 tY = cross(gn, tX);
      vec2 dn = detalhe.rg * 2.0 - 1.0;
      vec3 wn = normalize(gn + (tX * dn.x + tY * dn.y) * detailBump);
      normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
    }`,
};
