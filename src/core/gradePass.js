/* ---------------------------------------------------------------------------
   O passe de acabamento: vinheta, grão e curva de cor.

   Os três num passe só, e o último da cadeia. Separá-los daria três leituras e
   três escritas da tela inteira para fazer aritmética que cabe em vinte
   instruções — e é justamente por caber que eles moram juntos.

   Roda DEPOIS do `OutputPass`, ou seja, em espaço de exibição (sRGB), e não em
   linear. Isso é deliberado:

   • o GRÃO tem de ser somado onde o olho o vê. Em linear, o mesmo ruído somado
     nas sombras vira granizo e nas altas some — porque a curva de exibição
     comprime as altas e estica as baixas;
   • a CURVA DE COR é um ajuste de níveis, e níveis são um conceito de imagem
     exibida: "levantar as sombras" quer dizer levantar o que se enxerga como
     sombra;
   • a VINHETA funcionaria nos dois espaços, e vem junto de carona.
   --------------------------------------------------------------------------- */

export const GradeShader = {
  name: "GradeShader",

  uniforms: {
    tDiffuse: { value: null },
    /** Força do escurecimento nos cantos (0 = sem vinheta). */
    vignette: { value: 0.38 },
    /** Amplitude do grão. Acima de ~0.06 já lê como chuvisco. */
    grain: { value: 0.028 },
    /** Avança o padrão do grão a cada quadro; sem isto ele congela na tela. */
    time: { value: 0 },
    /** Contraste em torno do cinza médio. 1 = neutro. */
    contrast: { value: 1.055 },
    /** Saturação. 1 = neutro. */
    saturation: { value: 1.12 },
    /** Quanto as sombras são levantadas (e para que cor). */
    lift: { value: 0.012 },
    /** Tinta das baixas — o azul de sombra que a luz do céu deixa. */
    shadowTint: { value: [0.86, 0.94, 1.14] },
    /** Tinta das altas — o âmbar do sol. */
    highlightTint: { value: [1.04, 1.0, 0.94] },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float grain;
    uniform float time;
    uniform float contrast;
    uniform float saturation;
    uniform float lift;
    uniform vec3 shadowTint;
    uniform vec3 highlightTint;

    varying vec2 vUv;

    /* Ruído de valor barato. Não é Perlin: para grão de filme, o que importa é
       não ter padrão visível, e uma hash de duas frequências já não tem. */
    float hash( vec2 p ) {
      return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
    }

    void main() {
      vec4 tex = texture2D( tDiffuse, vUv );
      vec3 c = tex.rgb;

      /* --------------------------------------------------- curva de cor ---
         Três passos, nesta ordem: contraste em torno do cinza médio,
         saturação, e a divisão de tintas entre sombra e alta luz. A ordem
         importa — saturar depois do contraste evita que as cores estourem
         justamente onde o contraste já as empurrou para o topo. */
      c = ( c - 0.5 ) * contrast + 0.5;

      float luma = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c = mix( vec3( luma ), c, saturation );

      // Split-tone: a sombra puxa para o azul do céu e a alta para o âmbar do
      // sol. É o que amarra a imagem à iluminação da cena em vez de deixá-la
      // neutra e sem hora do dia.
      c *= mix( shadowTint, highlightTint, smoothstep( 0.15, 0.85, luma ) );

      // As sombras sobem um fio: preto absoluto num vale ao ar livre não
      // existe, e é ele que fazia o pé das árvores parecer um buraco.
      c += lift * ( 1.0 - smoothstep( 0.0, 0.5, luma ) );

      /* -------------------------------------------------------- vinheta ---
         Elíptica e corrigida pela proporção da tela: circular, ela escurece
         demais os lados numa tela larga e quase nada em cima e embaixo. */
      vec2 d = ( vUv - 0.5 ) * vec2( 1.0, 0.82 );
      float r = dot( d, d ) * 2.6;
      c *= 1.0 - vignette * smoothstep( 0.25, 1.35, r );

      /* ----------------------------------------------------------- grão ---
         Centrado em zero (daí a subtração de 0.5) e ATENUADO NAS ALTAS: grão
         visível num céu claro parece sujeira de sensor; nas sombras e nos
         meios-tons é onde ele disfarça o degradê em faixas. */
      float n = hash( vUv * 1024.0 + time * 91.7 ) - 0.5;
      c += n * grain * ( 1.0 - smoothstep( 0.55, 1.0, luma ) );

      gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), tex.a );
    }
  `,
};
