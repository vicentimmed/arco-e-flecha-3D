/* ---------------------------------------------------------------------------
   A base comum das skins: o esqueleto e as ferramentas de montagem.

   Aqui mora o que TODA fantasia tem de respeitar e o que toda fantasia usa para
   se montar. As skins propriamente ditas (`atleta.js`, `medieval.js`) importam
   daqui; este arquivo não importa nenhuma delas, e é isso que mantém o grafo
   sem ciclo.

   ------------------------------------------------------------------- o osso

   `BODY` era do `player.js` e veio para cá porque virou CONTRATO: o rig monta a
   pose a partir destes números e a skin pendura a roupa neles. Nem todos são da
   mesma natureza, e a diferença importa:

   • OSSO — congelado, igual em toda skin. Alturas de junta, comprimentos de
     osso, largura da base, o giro do tronco, o alcance do braço e a âncora da
     corda. Três coisas dependem deles, e a terceira fecha o assunto:

       1. a CÂMERA sai daí (`getCameraPivot` usa `shoulderY`, `getEye` usa a
          âncora) — uma skin mais alta veria de mais alto e atiraria de outra
          altura, o que é regra de jogo disfarçada de enfeite;
       2. o COLISOR não é da skin: a cápsula é fixa (`CONFIG.player.height`), e é
          ela que a flecha acerta. Skin com hitbox diferente é vantagem
          competitiva, não estilo;
       3. a pose viaja como FASE, não como esqueleto: o que a rede manda é
          `gaitPhase`, e o contrato só fecha se "fase 0,3 do passo" quiser dizer
          a mesma coisa nas duas pontas.

   • CARNE — a skin manda. Raio dos segmentos, escala das peças de tronco, todas
     as peças decorativas e todos os materiais. Um gambeson acolchoado tem 12 cm
     de peito a mais que uma camiseta, e isso é `scale` de um cilindro.

   Regra prática: se o número entra numa conta de IK, de câmera ou de física, é
   osso. Se ele só decide o tamanho de uma malha, é carne.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { shadeSegment } from "../../utils/geometry.js";

/* Antropometria (m) — corpo de ~1,72 m. Não são constantes de simulação, por
   isso vivem aqui e não em config.js. */
export const BODY = {
  hipY: 0.9,
  waistY: 1.06,
  chestY: 1.27,
  shoulderY: 1.42,
  shoulderX: 0.175,
  neckY: 1.5,
  headY: 1.625,
  headR: 0.107,
  upperArm: 0.28,
  foreArm: 0.26,
  thigh: 0.44,
  shin: 0.42,
  ankleY: 0.085,
  hipX: 0.105,
  stanceWidth: 0.23,
  stanceYaw: 1.16, // rad — quanto o tronco fica de lado
  armReach: 0.505, // extensão do braço do arco
  // Ancoragem da corda: canto da boca, do lado da mão que puxa (a esquerda).
  // É este ponto que define a linha da flecha, e não o ombro. Medido a partir
  // da CABEÇA e no espaço do root — deslocar no espaço do tronco não serve,
  // porque o giro da postura converte "esquerda" em "para trás" e a âncora
  // acabaria no meio do corpo.
  anchorSide: 0.062, // m à esquerda da linha de tiro
  anchorDrop: 0.09, // m abaixo do centro da cabeça (canto da boca)
  anchorForward: 0.03, // m à frente, ao longo da mira
};

/* ESPECULAR SELETIVA E RIM LIGHT (Fases 1.5 e 5A.3 do plano).
 *
 * Cada material do corpo tem o SEU brilho, porque é a diferença entre eles que
 * conta de que coisa cada peça é feita: pele tem um brilho largo e oleoso, pano
 * quase nenhum, couro é fosco com um lustro nas dobras, metal é um ponto. Com
 * todos no mesmo `roughness` médio, o corpo lê como um boneco de resina
 * pintado — que era exatamente o problema.
 *
 * O RIM LIGHT entra em todos eles, pelo mesmo enxerto. Ele acende só as bordas
 * do corpo, onde a normal é perpendicular ao olhar, e serve a um propósito de
 * jogo antes de ser bonito: na noite do modo zumbi e contra a serra escura, é a
 * única coisa que separa a silhueta do arqueiro do fundo. */
export function withRimLight(material, forca = 0.22, tecido = 0) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: forca };
    shader.uniforms.fabric = { value: tecido };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vLocalPos;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vLocalPos = position;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float rimStrength;
         uniform float fabric;
         varying vec3 vLocalPos;`,
      )
      /* ESTRUTURA DE TECIDO (Fase 5A.4 do plano).
       *
       * O plano pedia normal maps em braços e pernas. Um normal map de verdade
       * exigiria UVs — e as peças do arqueiro são cápsulas e caixas geradas em
       * código, sem UV que faça sentido. A alternativa que dá o mesmo resultado
       * pelo mesmo custo é gerar a trama NO FRAGMENTO, a partir da posição
       * local do vértice: duas ondas cruzadas em alta frequência, moduladas
       * muito de leve sobre o albedo.
       *
       * A amplitude é minúscula (±3 %) de propósito. Tecido não tem desenho —
       * tem GRÃO —, e o que se quer é só que a superfície pare de ser
       * perfeitamente lisa. Acima disso vira estampa xadrez.
       *
       * A coordenada é a LOCAL, não a de mundo: assim a trama acompanha a peça
       * quando o braço gira, em vez de o corpo deslizar por dentro de um padrão
       * fixo no espaço.
       */
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         if ( fabric > 0.0 ) {
           vec3 p = vLocalPos * 220.0;
           float trama = sin( p.x ) * sin( p.y ) + 0.6 * sin( p.z * 1.3 + p.y * 0.7 );
           diffuseColor.rgb *= 1.0 + trama * 0.03 * fabric;
         }`,
      )
      /* Entra no fim, DEPOIS da iluminação e antes da névoa: o rim é luz
         somada, não uma propriedade da superfície. Somá-lo antes faria a névoa
         não o cobrir, e o arqueiro a cem metros teria contorno neon. */
      .replace(
        "#include <opaque_fragment>",
        `{
           vec3 rimV = normalize( vViewPosition );
           float rim = pow( 1.0 - abs( dot( normalize( normal ), rimV ) ), 3.0 );
           // A cor do rim é a da luz do céu: ele representa o céu inteiro
           // batendo de raspão na borda do corpo, e céu é azul.
           outgoingLight += vec3( 0.62, 0.74, 1.0 ) * rim * rimStrength;
         }
         #include <opaque_fragment>`,
      );
  };
  // Sem chave própria o Three reaproveitaria o programa de qualquer
  // MeshStandardMaterial com as mesmas flags e o enxerto seria ignorado.
  material.customProgramCacheKey = () => `archer-rim-${forca}-${tecido}`;
  return material;
}

/* As três famílias de material do corpo.
 *
 * `vertexColors: true` liga o gradiente e o AO de junta que `makeSegment` e
 * `makeJoint` assaram na geometria (ver `utils/geometry.js`). As peças que NÃO
 * são segmento nem junta simplesmente não têm o atributo `color`, e o Three
 * trata a ausência dele como branco — desde que `fillNeutralVertexColors` tenha
 * rodado (ver abaixo, e é obrigatório).
 *
 * O METAL é o único sem `vertexColors`: ele nunca é segmento, e o gradiente de
 * osso não diz nada sobre uma fivela. */

/** Pele: brilho largo e fraco, o de uma pele ao ar livre. */
export function pele(cor, rough) {
  return withRimLight(
    new THREE.MeshStandardMaterial({
      color: cor,
      roughness: rough,
      metalness: 0,
      vertexColors: true,
    }),
    0.26,
  );
}

/** Pano: fosco, com a trama do fragmento ligada (`tecido` = 1). */
export function pano(cor, rough, tecido = 1) {
  return withRimLight(
    new THREE.MeshStandardMaterial({
      color: cor,
      roughness: rough,
      metalness: 0,
      vertexColors: true,
    }),
    0.2,
    tecido,
  );
}

/** Metal: reflexo estreito e forte, um ponto de luz. */
export function metal(cor = "#b9bcc2", rough = 0.28, metalness = 0.85) {
  return withRimLight(
    new THREE.MeshStandardMaterial({
      color: cor,
      roughness: rough,
      metalness,
    }),
    0.18,
  );
}

/* ------------------------------------------------------- membros com forma --
 *
 * `makeSegment` faz uma cápsula de raio constante. Um membro de raio constante
 * lê como CANO — é o sinal mais forte de "boneco de primitivas" que um corpo
 * procedural emite, e nenhuma quantidade de acessório o disfarça.
 *
 * A solução não é pendurar um músculo no segmento: `orientSegment` escreve
 * `scale.y = comprimento do osso`, e qualquer filho herda essa escala achatado.
 * A solução é o músculo estar DENTRO da geometria — um torneado (lathe) com
 * perfil, em altura unitária, que a IK estica exatamente como estica a cápsula.
 *
 * Custo: zero malhas a mais e zero mudança na pose. É a melhoria mais barata
 * que existe neste corpo.
 *
 * O perfil é simétrico em volta do eixo, e isso é uma limitação assumida: uma
 * panturrilha de verdade fica ATRÁS da canela, não em volta dela. Empurrar os
 * vértices para trás não funcionaria, porque `orientSegment` alinha o segmento
 * com `setFromUnitVectors`, que deixa o giro em torno do próprio eixo
 * indefinido — o "atrás" da geometria apontaria para um lado diferente a cada
 * ângulo de perna. O volume simétrico já entrega a maior parte da leitura.
 */

/**
 * Segmento torneado, altura 1, base na origem, eixo em +Y.
 *
 * @param {Array<[number, number]>} perfil pares `[altura 0..1, raio em metros]`,
 *   da base para a ponta. É o desenho do membro visto de lado.
 */
export function makeMuscleSegment(perfil, material, radialSegments = 20) {
  const pontos = perfil.map(([t, r]) => new THREE.Vector2(Math.max(1e-4, r), t));
  const geo = new THREE.LatheGeometry(pontos, radialSegments);
  shadeSegment(geo);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.baseRadius = Math.max(...perfil.map(([, r]) => r));
  return mesh;
}

/**
 * Faz a barra de uma peça de pano ondular.
 *
 * Uma saia, um manto ou uma túnica terminam numa aresta perfeitamente circular
 * quando saem de um cilindro — e círculo perfeito é chapa, não pano. Empurrar a
 * borda de baixo para dentro e para fora em torno do eixo dá as sombras
 * verticais irregulares que o olho lê como tecido.
 *
 * Mexe só nos vértices da borda inferior, e por isso não muda o encaixe da peça
 * no corpo. Custa zero malhas: é um laço sobre vértices que já existem.
 */
export function ondularBarra(geo, amplitude = 0.03, lobos = 7, borda = "min") {
  const pos = geo.attributes.position;
  /* Qual das duas pontas é a barra depende da peça: num cilindro centrado na
     origem (o manto) ela é a de baixo; num segmento de altura unitária, que
     nasce na base e cresce para +Y (a saia da túnica, que desce do quadril), a
     barra é a ponta OPOSTA à raiz. */
  let alvo = borda === "min" ? Infinity : -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    alvo = borda === "min" ? Math.min(alvo, y) : Math.max(alvo, y);
  }
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (Math.abs(y - alvo) > 1e-4) continue;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const k = 1 + Math.sin(Math.atan2(z, x) * lobos) * amplitude;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Preenche `color` = branco em toda geometria da subárvore que não tiver. */
export function fillNeutralVertexColors(root) {
  root.traverse((o) => {
    const geo = o.geometry;
    if (!geo || geo.attributes.color) return;
    const n = geo.attributes.position.count;
    const brancos = new Float32Array(n * 3).fill(1);
    geo.setAttribute("color", new THREE.BufferAttribute(brancos, 3));
  });
}

/* Raio (m) abaixo do qual uma peça deixa de lançar sombra. Ver `podarSombras`.
   16 cm é a medida que separa o que TEM silhueta (cabeça, coxa, antebraço,
   braço do arco) do que é acabamento (fivela, dedo, costura, pena da aljava). */
const RAIO_MINIMO_DE_SOMBRA = 0.16;

/**
 * Tira do passe de sombra tudo o que é pequeno demais para projetar sombra.
 *
 * O passe de sombra é um SEGUNDO desenho da cena inteira, do ponto de vista do
 * Sol: cada peça marcada com `castShadow` é desenhada duas vezes por quadro. O
 * corpo nasceu com 54 dessas — e a maioria não projeta sombra nenhuma que se
 * possa ver, porque o mapa tem 2048 px cobrindo 92 m (`render.shadowRange`),
 * ou seja 4,5 cm por texel: uma fivela inteira cabe em um texel e meio.
 *
 * Medido numa partida de seis arqueiros na Lua: 174 peças saíram do passe e o
 * quadro caiu 84 chamadas de desenho (−10 %), fora o preenchimento do mapa, que
 * é custo de GPU que nenhum contador mostra.
 *
 * O critério é o TAMANHO, e não uma lista de nomes, porque uma lista sairia de
 * sincronia no primeiro acessório novo — quem acrescentar uma peça grande ao
 * corpo ganha a sombra dela sem precisar saber que esta função existe.
 */
export function podarSombras(raiz) {
  raiz.traverse((o) => {
    if (!o.isMesh || !o.castShadow || !o.geometry) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const raio = o.geometry.boundingSphere?.radius ?? Infinity;
    // O `scale` conta: a pelve é uma cápsula achatada, e o pé é uma caixa
    // esticada. Medir só a geometria crua puniria peças que só são pequenas
    // antes de serem redimensionadas.
    const escala = Math.max(o.scale.x, o.scale.y, o.scale.z);
    if (raio * escala < RAIO_MINIMO_DE_SOMBRA) o.castShadow = false;
  });
}

/**
 * O balanço da ponta de cabelo (ou do rabicho do capuz, ou do que a skin
 * pendurar ali). Ver `Player.updateSway`.
 *
 * Estes são os números da arqueira, e eles são o PADRÃO porque foram os
 * primeiros: uma skin que não diga nada balança exatamente como ela sempre
 * balançou. Uma skin com pano mais pesado baixa os ganhos e o amortecimento.
 */
export const SWAY_PADRAO = {
  yawGain: 0.09, // quanto a virada joga a ponta para o lado
  pitchGain: 0.25, // quanto olhar para cima/baixo a levanta
  dampYaw: 9, // rapidez com que o lado volta ao lugar
  dampPitch: 7,
  swingA: 0.12, // deslocamento lateral da primeira seção
  dropA: -0.09, // queda da primeira seção
  bobA: 0.1,
  backA: 0.17, // quanto ela sai para trás da cabeça
  swingB: 0.16, // o mesmo, para a ponta
  dropB: -0.22,
  bobB: 0.12,
  backB: 0.05,
};
