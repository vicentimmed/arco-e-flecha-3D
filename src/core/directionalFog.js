/* ---------------------------------------------------------------------------
   Névoa DIRECIONAL — a mesma `FogExp2`, com a cor dependendo de para onde se
   olha.

   Névoa de verdade não tem uma cor só. Olhando na direção do sol ela é clara e
   quente, porque a luz atravessa as gotas; de costas para ele é fria e azulada,
   porque o que chega ao olho é a luz do céu espalhada. É essa diferença que dá
   VOLUME ao ar: com uma cor única, a serra de 300 m e a pedra de 30 m recebem
   a mesma tinta e o vale inteiro fica chapado, que é exatamente o que a imagem
   atual tem de errado.

   COMO ISTO É FEITO SEM UNIFORME NOVO

   O jeito óbvio — acrescentar `fogSunDir` e `fogSunColor` aos uniformes — não
   funciona: o Three CLONA `UniformsLib.fog` para cada material e só sabe
   atualizar `fogColor`, `fogDensity`, `fogNear` e `fogFar`. Uniforme novo teria
   de ser escrito material a material, todo quadro, para os quarenta e tantos
   materiais da cena.

   Então nada de uniforme. Os quatro trechos globais de névoa (`fog_*`) são
   trocados aqui, uma vez, ANTES de qualquer material existir, e o que eles
   precisam saber vira CONSTANTE de compilação:

   • a direção do sol é fixa neste jogo (`Renderer.sunDirection` nunca muda);
   • as duas tintas são fixas;
   • `fogColor` continua vindo do Three e continua sendo atualizado a cada
     quadro — é por ele que a transição dia↔noite do modo zumbi passa, e ela
     continua funcionando de graça.

   O único dado que faltava no fragmento era PARA ONDE se está olhando, e ele
   sai do varying novo `vFogView` (posição em espaço de câmera, onde o olho está
   na origem) combinado com `viewMatrix`, que o Three já declara no prefixo de
   todo fragmento.

   Custo: um varying `vec3` e ~8 instruções por fragmento coberto por névoa.
   --------------------------------------------------------------------------- */

import * as THREE from "three";

/**
 * Instala a névoa direcional. Idempotente e obrigatoriamente ANTES do primeiro
 * material — trechos trocados depois disso não alcançam programas já compilados.
 *
 * @param {THREE.Vector3} sunDir direção do sol, normalizada, em mundo
 * @param {object} [tints]
 * @param {number} [tints.towardSun] multiplicador da cor da névoa olhando para
 *   o sol — acima de 1 clareia e esquenta
 * @param {number} [tints.awayFromSun] multiplicador olhando na direção oposta
 */
export function installDirectionalFog(sunDir, tints = {}) {
  if (installDirectionalFog.done) return;
  installDirectionalFog.done = true;

  const s = sunDir.clone().normalize();
  const g = (v) => v.toFixed(5);

  /* As tintas.
     Contra o sol o ar fica quase branco-âmbar; de costas, azul-acinzentado e
     mais fundo. São multiplicadores da cor de névoa da cena, e não cores
     absolutas, justamente para a noite do modo zumbi continuar mandando: com
     `fogColor` quase preto, multiplicar por 1,18 continua dando quase preto. */
  const quente = tints.towardSun ?? new THREE.Color(1.16, 1.1, 0.98);
  const frio = tints.awayFromSun ?? new THREE.Color(0.82, 0.88, 1.02);

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  // Posição do fragmento em ESPAÇO DE CÂMERA. Ali o olho está na origem, então
  // este vetor já é a direção do olhar — sem inversa de matriz, sem uniforme.
  varying vec3 vFogView;
#endif
`;

  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogView = mvPosition.xyz;
#endif
`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogView;

  #define FOG_SUN_DIR vec3(${g(s.x)}, ${g(s.y)}, ${g(s.z)})
  #define FOG_WARM vec3(${g(quente.r)}, ${g(quente.g)}, ${g(quente.b)})
  #define FOG_COOL vec3(${g(frio.r)}, ${g(frio.g)}, ${g(frio.b)})

  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;

  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG

  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif

  {
    /* O sol é levado para o espaço de câmera (uma transformação de vetor, sem
       translação) em vez de trazer o olhar para o mundo: as duas dão o mesmo
       cosseno, e esta não precisa inverter matriz nenhuma. */
    vec3 olhar = normalize( vFogView );
    vec3 solView = normalize( ( viewMatrix * vec4( FOG_SUN_DIR, 0.0 ) ).xyz );
    /* A faixa do smoothstep é assimétrica de propósito: o clarão em torno do
       sol é estreito e o azul de costas é largo, que é como o céu se comporta.
       Fosse simétrico, metade do horizonte ficaria quente e a transição
       apareceria como uma emenda no meio do vale. */
    float sd = smoothstep( -0.45, 0.92, dot( olhar, solView ) );
    vec3 fogTint = fogColor * mix( FOG_COOL, FOG_WARM, sd );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
  }

#endif
`;
}
