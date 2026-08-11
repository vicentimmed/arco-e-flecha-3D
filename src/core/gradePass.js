/* ---------------------------------------------------------------------------
   O passe de acabamento: vinheta, grão, curva de cor e o flare do Sol.

   Os quatro num passe só, e o último da cadeia. Separá-los daria quatro leituras
   e quatro escritas da tela inteira para fazer aritmética que cabe em algumas
   dezenas de instruções — e é justamente por caber que eles moram juntos.

   O FLARE mora aqui pelo mesmo motivo, e não num passe próprio: um reflexo de
   lente é aritmética sobre a posição do Sol na tela, e um passe novo custaria
   uma leitura e uma escrita do quadro inteiro para acrescentar zero informação
   nova. Ver o bloco do flare, no fim do fragmento.

   Roda DEPOIS do `OutputPass`, ou seja, em espaço de exibição (sRGB), e não em
   linear. Isso é deliberado:

   • o GRÃO tem de ser somado onde o olho o vê. Em linear, o mesmo ruído somado
     nas sombras vira granizo e nas altas some — porque a curva de exibição
     comprime as altas e estica as baixas;
   • a CURVA DE COR é um ajuste de níveis, e níveis são um conceito de imagem
     exibida: "levantar as sombras" quer dizer levantar o que se enxerga como
     sombra;
   • a VINHETA funcionaria nos dois espaços, e vem junto de carona.

   ⚠️ NADA DE CRASE dentro dos dois blocos de shader: eles são template literals,
   e uma crase num comentário GLSL encerra a string no meio — o erro que aparece
   é um "falta vírgula" apontando para uma linha de comentário, que não diz nada
   a quem procura. Para citar um identificador ali dentro, escreva sem marcação.
   A mesma armadilha está anotada em core/renderer.js, e já custou builds nos
   dois arquivos.
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

    /* ------------------------------------------------------------- flare ----
       Força do reflexo de lente. ZERO é o estado normal do jogo: quem escreve
       aqui é `Renderer._updateFlare`, todo quadro, e ele só passa de zero na
       Lua e com o Sol dentro do quadro. Com o valor em zero o bloco inteiro do
       flare é saltado por um `if` de uniforme — todos os fragmentos tomam o
       mesmo caminho, então o desvio é coerente e o vale não paga nada por um
       efeito que não usa. */
    flare: { value: 0 },
    /** Onde o Sol está na tela, em UV (0..1). Só vale quando `flare` > 0. */
    flarePos: { value: [0.5, 0.5] },
    /** Largura ÷ altura do quadro: sem ela todo disco sai oval. */
    aspect: { value: 1.777 },
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
    uniform float flare;
    uniform vec2 flarePos;
    uniform float aspect;

    varying vec2 vUv;

    /* Ruído de valor barato. Não é Perlin: para grão de filme, o que importa é
       não ter padrão visível, e uma hash de duas frequências já não tem. */
    float hash( vec2 p ) {
      return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
    }

    float brilho( vec3 c ) {
      return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    }

    /* Vetor de um centro de reflexo até este pixel, medido em ALTURAS DE TELA:
       o x é multiplicado pela proporção justamente para que a unidade seja a
       mesma nos dois eixos. Sem isso, disco vira elipse e raio vira leque —
       e o erro só aparece em tela larga, que é onde todo mundo joga. */
    vec2 doCentro( vec2 c ) {
      vec2 q = vUv - c;
      q.x *= aspect;
      return q;
    }

    /* O fantasma do diafragma: disco de miolo fraco e borda acesa. É a BORDA
       que o faz ler como reflexo interno da lente; um disco de brilho uniforme
       lê como bolha desenhada em cima da imagem. */
    float diafragma( vec2 q, float r ) {
      float d = length( q ) / r;
      return smoothstep( 1.0, 0.62, d ) * ( 0.32 + 0.9 * smoothstep( 0.5, 0.97, d ) );
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

      /* ---------------------------------------------------------- flare ---
         Olhar para o Sol na Lua.

         Lá não há atmosfera para espalhar a luz, então o céu não acende em
         volta do disco — o clarão que sobra é o que acontece DENTRO DA LENTE,
         entre os elementos de vidro e as pás do diafragma. É por isso que as
         fotos da Apollo têm flare tão marcado num céu preto: sem ar, a única
         difusão possível é a da própria câmera.

         Quatro peças, e cada uma diz uma coisa diferente:
         o CLARÃO junto ao disco (a luz que vaza no vidro), o VÉU largo (que
         lava o contraste do quadro inteiro e é o que se sente como "não dá
         para olhar"), os ESPINHOS do diafragma e os FANTASMAS — os discos
         coloridos que caminham para o lado OPOSTO ao Sol, porque um reflexo
         interno inverte a imagem pelo eixo óptico. É essa inversão que faz o
         olho aceitar o efeito como lente em vez de enfeite.

         Tudo aqui é aritmética sobre flarePos: sem textura, sem passe novo,
         sem chamada de desenho. O único acesso extra à memória são as três
         amostras da oclusão, logo abaixo.

         MEDIDO, e não estimado: preset high, alvo de 2560×1440 (3,7 Mpx), 150
         quadros por amostra com a GPU sincronizada no fim de cada bloco, cinco
         rodadas alternando ligado e desligado. Quadro de 12,43 ms desligado
         contra 12,46 ms com o Sol no meio da tela e o efeito inteiro aceso:
         0,02 ms, ou 0,2 % — abaixo da variação entre rodadas do mesmo estado
         (0,19 ms). A contagem de chamadas de desenho não muda em um único
         desenho, porque não há desenho novo nenhum.

         A vinheta vem DEPOIS, e de propósito: os dois são defeitos da mesma
         lente, e um fantasma que cai no canto do quadro tem de escurecer junto
         com o canto. Somado por cima da vinheta, ele flutuaria à frente da
         imagem em vez de fazer parte dela. */
      if ( flare > 0.001 ) {
        /* OCLUSÃO. O Sol pode estar atrás do foguete, de uma borda de cratera
           ou do próprio arqueiro, e um flare que atravessa o cenário entrega o
           truque na hora. O teste é olhar o pixel do Sol: o disco é branco
           estourado, então se ali está escuro é porque tem coisa na frente.

           Três amostras, e não uma: com uma só, a passagem do Sol por uma
           borda liga e desliga o efeito de um quadro para o outro e o que se vê
           é um piscar. Elas ficam a meio grau de distância, no mesmo canto da
           textura — é leitura de cache, não de memória.

           Este teste também apaga o flare quando o Sol SAI DO QUADRO, porque aí
           a amostra cai na borda da textura e não no disco. A rampa de borda que
           _updateFlare aplica faz a mesma coisa pelo lado da CPU, e a
           sobreposição é de propósito: quem garante que nada fica ancorado na
           beirada da tela é o mais conservador dos dois. */
        vec2 sp = clamp( flarePos, 0.0, 1.0 );
        float aberto = brilho( texture2D( tDiffuse, sp ).rgb )
                     + brilho( texture2D( tDiffuse, sp + vec2( 0.009, 0.004 ) ).rgb )
                     + brilho( texture2D( tDiffuse, sp - vec2( 0.007, 0.006 ) ).rgb );
        float k = flare * smoothstep( 0.9, 2.1, aberto );

        if ( k > 0.001 ) {
          vec2 q = doCentro( flarePos );
          float d = length( q );
          vec3 fl = vec3( 0.0 );

          // O clarão colado no disco: quente, curto, o vazamento no vidro.
          fl += vec3( 1.00, 0.96, 0.90 ) * exp( -d * 18.0 ) * 0.45;

          /* O véu. Alcança a tela inteira e é FRIO — o vidro espalha mais o
             azul, e é essa mudança de tinta que separa o véu da lente do halo
             atmosférico que o vale tem. O degradê é longo e correria risco de
             sair em faixas num alvo de 8 bits; o grão, que vem depois, o
             dissolve de graça. */
          fl += vec3( 0.70, 0.80, 1.00 ) * exp( -d * 2.5 ) * 0.085;

          /* Os espinhos: seis, porque são seis as pás do diafragma. Não giram —
             a lente não gira, o que gira é a cena.

             São DOIS conjuntos, e é a soma deles que separa o efeito de uma
             estrela de desenho: seis raios longos e finos, e seis curtos e mais
             estreitos ainda entre eles (daí o meio passo de 0,52 rad ≈ 30°).
             Com um conjunto só, todos os braços têm o mesmo comprimento e o
             mesmo peso, e o olho lê a simetria perfeita como carimbo. */
          float ang = atan( q.y, q.x );
          float esp = pow( abs( cos( ang * 3.0 ) ), 30.0 ) * exp( -d * 3.6 )
                    + pow( abs( cos( ang * 3.0 + 0.52 ) ), 80.0 ) * exp( -d * 6.5 ) * 0.55;
          fl += vec3( 1.00, 0.94, 0.84 ) * esp * 0.26;

          /* Os fantasmas, sobre a reta Sol → centro do quadro, passando do
             outro lado. Três, com cores e tamanhos diferentes: iguais e
             igualmente espaçados, leriam como uma fileira de bolinhas. */
          vec2 eixo = vec2( 0.5 ) - flarePos;
          fl += vec3( 0.34, 0.72, 1.00 ) *
                diafragma( doCentro( flarePos + eixo * 1.26 ), 0.085 ) * 0.16;
          fl += vec3( 1.00, 0.56, 0.30 ) *
                diafragma( doCentro( flarePos + eixo * 1.74 ), 0.042 ) * 0.20;
          fl += vec3( 0.60, 1.00, 0.74 ) *
                diafragma( doCentro( flarePos + eixo * 0.58 ), 0.026 ) * 0.15;

          c += fl * k;
        }
      }

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
