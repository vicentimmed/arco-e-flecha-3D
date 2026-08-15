/* ---------------------------------------------------------------------------
   Constantes do jogo.

   REGRA DE OURO: 1 unidade Three.js = 1 metro, e todo valor aqui está em SI.
   Nenhum "fator mágico" deve existir espalhado pelos módulos — se um número
   influencia a simulação, ele mora aqui, com a unidade anotada.

   --------------------------------------------------------------------------- */

const SHAFT_RADIUS = 0.004; // m — raio do tubo da flecha

// Velocidade de deslocamento. A corrida é derivada da caminhada por um
// multiplicador para que exista um único número a mexer quando o ritmo do jogo
// mudar — `runSpeed` nunca sai de sincronia com `walkSpeed`.
const WALK_SPEED = 3.2; // m/s
const SPRINT_MULTIPLIER = 3.0; // Shift: quantas vezes a caminhada
/** Velocidade original do lobo (1,5× caminhada). */
const WOLF_SPEED_LEGACY = WALK_SPEED * 1.5;
const WOLF_LEAP_LEGACY = 12.0;
/** Modo zumbi: legacy −30%. Alce/demais: 3× legacy (via WOLF_SPEED_FAST). */
const WOLF_SLOW_SCALE = 0.7;
const WOLF_SPEED_SLOW = WOLF_SPEED_LEGACY * WOLF_SLOW_SCALE; // ≈ 3,36 m/s
const WOLF_LEAP_SLOW = WOLF_LEAP_LEGACY * WOLF_SLOW_SCALE; // ≈ 8,4 m/s
const WOLF_SPEED_FAST = WALK_SPEED * 4.5 * 0.9; // ≈ 12,96 m/s
/** Salto: independente da corrida — arco telegrafado de 0,45 s / 1,2 m. */
const WOLF_LEAP_FAST = WOLF_LEAP_LEGACY; // 12 m/s

// Centro da bacia jogável. Mora aqui em cima porque DOIS blocos precisam dele —
// o sorteio de nascimento e a arena de tochas do modo zumbi — e um deles não
// pode ler o outro de dentro do mesmo literal de objeto.
const SPAWN_CENTER_X = 0;
const SPAWN_CENTER_Z = -40;

export const CONFIG = {
  physics: {
    gravity: -9.81, // m/s² em Y
    fixedStep: 1 / 120, // s — passo fixo do integrador
    maxSubSteps: 8, // trava anti "espiral da morte"
    airDensity: 1.225, // kg/m³ — ar ao nível do mar, 15 °C
  },

  arrow: {
    mass: 0.025, // kg (25 g — flecha de carbono para alvo)
    length: 0.75, // m
    shaftRadius: SHAFT_RADIUS, // m
    // Área de referência do arrasto: seção transversal do tubo.
    frontalArea: Math.PI * SHAFT_RADIUS * SHAFT_RADIUS, // ≈ 5.03e-5 m²
    dragCoefficient: 2.0, // adimensional, referenciado à área frontal
    // Quanto a área efetiva cresce quando a flecha voa "de lado" (ângulo de
    // ataque α ≠ 0). A_ef = A · (1 + sideAreaFactor · sen²α).
    sideAreaFactor: 55,
    // Distância do centro de pressão ATRÁS do centro de massa. É o que faz a
    // flecha se alinhar sozinha ao vetor velocidade: a força de arrasto,
    // aplicada atrás do CM, gera torque restaurador. Isso é a fletching real.
    centerOfPressureOffset: 0.13, // m
    angularDamping: 1.1, // amortece a oscilação residual da empena
    // O pool de flechas cravadas é POR DONO, não global. Com um pool único, o
    // jogador que atira mais rápido apaga as flechas de todo mundo — e ver a
    // própria flecha sumir porque um amigo disparou é o tipo de coisa que passa
    // por bug. O teto total continua existindo, só para a memória não crescer.
    /* Flechas cravadas simultâneas por arqueiro.
       Caiu de 24 para 14 por causa do cerco: lá se atira sem parar por dez
       minutos contra o mesmo pedaço de rampa, e 24 por pessoa viravam uma
       cerca de hastes na frente do muro — atrapalhando justamente a leitura da
       fila, que é o modo inteiro. No campo de tiro 14 continua sendo mais do
       que qualquer série usa. */
    maxStuckPerPlayer: 14,
    maxStuckTotal: 120, // teto absoluto de flechas cravadas na cena
    maxLifetime: 25, // s — some se nunca acertar nada
    // Teto de altitude. Um tiro reto para cima com tensão máxima chega a ~150 m,
    // então isto não corta nenhuma parábola legítima — é só a rede de segurança
    // para a flecha que sai do mundo por cima.
    maxAltitude: 400, // m
    ignoreOwner: true, // ignora colisão com quem disparou (nunca em quem atirou)
  },

  bow: {
    minSpeed: 30, // m/s — toque rápido
    maxSpeed: 120, // m/s — tensão máxima
    // A tensão acompanha a nova velocidade máxima: chegar a 120 m/s exige
    // mais curso/tempo do que chegar a 85 m/s.
    fullDrawTime: 1.7, // s até a tensão máxima
    holdBeforeShake: 3.0, // s segurando antes de começar a tremer
    shakeAmplitude: 0.0055, // rad/s de tremor acumulado
    /* Depois de cada tiro a mão da corda vai à aljava, pega outra flecha e
       encaixa no arco. Enquanto isso, mira e tiro ficam bloqueados — sem isso
       o arco vira metralhadora. Desligável no painel ~. */
    reloadAnimation: true,
    /* Meio segundo, e não um. A recarga longa demais era sentida como travar:
       entre duas flechas dava tempo do alvo sair de cena, e o duelo virava
       espera. Vale para TODOS os modos e para os bots — a recarga deles sai
       deste mesmo número (ver `server/botSim.js`), senão baixar a do jogador
       transformaria o adversário em alvo parado. */
    reloadTime: 0.65, // s (0,5 + 30 %)
  },

  knife: {
    duration: 0.5, // s — golpe completo, da preparação ao retorno
    range: 2.4, // m — alcance máximo da lâmina
    coneCos: 0.18, // cone frontal de aproximadamente 80°
    hitStart: 0.18, // fração da animação em que a lâmina começa a acertar
    hitEnd: 0.68, // fração da animação em que a lâmina ainda pode acertar
  },

  wind: {
    enabled: true,
    baseSpeed: 12.0, // m/s
    maxSpeed: 12.0, // m/s
    /* Vento de intensidade CONSTANTE: só a direção muda.
       Com a força variando, o mesmo tiro no mesmo alvo pedia uma correção
       diferente a cada minuto e não havia como aprender a compensar — a deriva
       virava sorteio. Fixa, ela vira leitura: a bandeira diz o rumo, os 12 m/s
       são sempre 12, e o ajuste que funcionou continua funcionando.
       Para trazer a variação de volta basta subir `speedVariation` e
       `gustStrength`; a matemática dos dois continua aqui, intacta. */
    speedVariation: 0, // fração de oscilação em torno da base (0 = fixo)
    directionDrift: 0.006, // Hz — velocidade de giro da direção
    directionSpin: 0.0012, // rad/s — deriva contínua somada ao passeio
    speedDrift: 0.09, // Hz — velocidade de variação da intensidade
    // A rajada NÃO é sorteada: ela sai de um canal de ruído próprio, função pura
    // do relógio. Isso é o que permite dois jogadores verem a mesma flecha
    // derivar do mesmo jeito sem trocar um único byte sobre a trajetória — o
    // vento é a única entrada do voo que não viaja no evento de disparo.
    gustRate: 0.2, // Hz — velocidade do canal de rajada
    gustThreshold: 0.45, // -1..1 — acima disso venta forte; maior = mais raro
    gustStrength: 0, // m/s adicionais no pico da rajada (0 = sem rajada)
  },

  player: {
    walkSpeed: WALK_SPEED, // m/s
    sprintMultiplier: SPRINT_MULTIPLIER, // adimensional — Shift
    runSpeed: WALK_SPEED * SPRINT_MULTIPLIER, // m/s (≈ 9,6)
    // A velocidade não salta ao apertar/soltar Shift: ela persegue o alvo com
    // amortecimento, e a animação vem junto porque a fase do passo é medida em
    // distância percorrida, não em tempo.
    speedSmoothing: 7, // 1/s — aceleração/frenagem
    runSmoothing: 4.5, // 1/s — mistura andar↔correr da animação
    height: 1.72, // m
    mouseSensitivity: 0.0022, // rad por pixel
    // Mira livre: praticamente a vertical para cima e para baixo. Os ±0,5 rad
    // de antes travavam justamente o tiro alto, que é o que um arco faz de mais
    // característico — a parábola longa depende de poder apontar para cima.
    //
    // Para em 86°, e não em 90°, porque na vertical exata a câmera perde a
    // referência de "para cima" e a imagem gira sozinha. Os 4° que faltam não
    // dão para mirar em nada que já não estivesse ao alcance.
    pitchMin: -1.5, // rad ≈ -86° (olhando para baixo)
    pitchMax: 1.5, // rad ≈ +86° (olhando para cima)
    start: { x: 1.2, z: 12.0 },
    jumpSpeed: 4.2, // m/s — impulso vertical
    colliderRadius: 0.35, // m — cápsula do character controller

    /* --------------------------------------------------------- a beira --
       Queda a partir da qual o corpo se RECUSA a andar para fora da borda.

       Não é uma parede invisível: é o teste que `PlayerPhysics.temChao` faz no
       destino do passo, e ele só cancela o componente do movimento que ficaria
       sem chão — andar rente à beira continua funcionando, e PULAR para fora
       continua sendo escolha de quem joga.

       5,5 m é o mesmo desnível que o cerco já considera mortal
       (`modes.siege.fatalFall`), e é essa coincidência que dá a regra sua
       forma final: **o corpo não anda para dentro de uma queda que o mata.**
       Abaixo disso ele desce normalmente — um talude, um degrau de cratera, o
       barranco da rampa continuam caminháveis.

       No adarve isso é o que substitui o parapeito que a geometria proíbe: a
       faixa de tiro tem 90 cm e termina em oito metros de queda, e o tiro no
       portão passa a cinco centímetros do deque na beira externa — não cabe
       borda nenhuma ali. Ver §6.4 de `docs/plano-cerco.md`. */
    ledgeGuardDrop: 5.5, // m
    // O ponto de disparo NÃO é configurado aqui: ele sai da postura (ombro do
    // braço do arco + extensão do braço), em entities/player.js.
  },

  gait: {
    // Ciclo de passo. A fase avança com a DISTÂNCIA percorrida (um ciclo
    // completo — dois passos — a cada `strideLength` metros), não com o
    // relógio: a cadência acompanha sozinha a velocidade real, e correr sai
    // mais rápido sem nenhum multiplicador de tempo extra.
    strideLength: 1.75, // m por ciclo completo, andando
    runStrideGain: 0.5, // passada 50 % mais longa correndo
    runAmplitudeGain: 0.5, // amplitude 50 % maior correndo

    // O ciclo é descrito pelo PÉ: estes são deslocamentos do alvo do pé em
    // relação à base parada, e a IK de dois ossos converte em rotação de coxa
    // (X para o plano sagital, Z para o plano frontal) dobrando o joelho.
    swingAmplitude: 0.26, // m — avanço/recuo do pé (W/S), plano sagital
    lateralAmplitude: 0.2, // m — abertura/fechamento do pé (A/D), plano frontal
    footLift: 0.11, // m — altura do pé na fase de balanço
    crouch: 0.05, // m — quadril desce ao andar (dá curso para o joelho)
    stanceNarrow: 0.55, // fração do afastamento de arqueiro fechada ao andar
    kneeTurn: 0.5, // quanto o joelho vira para a direção da marcha
    footTurn: 0.55, // quanto a ponta do pé vira para a direção da marcha

    // Acompanhamento do corpo. Tudo aqui é desligado proporcionalmente ao
    // tensionamento do arco: mirando, o tronco trava.
    bobAmplitude: 0.026, // m — sobe e desce do corpo (2× por ciclo)
    torsoTwist: 0.06, // rad — torção do tronco no passo
    armSwing: 0.075, // m — balanço da mão da corda em repouso
    blendSmoothing: 8, // 1/s — entrada/saída do ciclo e mistura frente↔lado
  },

  camera: {
    fov: 58, // graus
    near: 0.15,
    far: 900,
    /* Enquadramento de trás e por cima do ombro: a arqueira fica à esquerda do
       quadro e o campo de tiro à direita, como na referência. A câmera pode
       ficar longe da linha de tiro sem prejudicar a mira porque a linha de tiro
       converge no ponto sob o retículo (systems/aim.js).

       ----------------------------------------------------- a câmera CHEGOU --
       Era 4,15 / 1,25 / 0,50, e desse ponto a arqueira era um bonequinho de um
       terço da altura da tela: o corpo lia como um marcador de posição, não
       como uma pessoa. Agora ela ocupa metade do quadro, cortada na altura do
       joelho pela borda de baixo — o enquadramento de terceira pessoa moderno.

       Os três números andam JUNTOS, e é por isso que não é só `distance`:

       • `right` encolhe quase na mesma proporção que `distance`. O que decide a
         posição da arqueira na tela é o ÂNGULO `atan(right/distance)`, não o
         afastamento em metros. Mantendo 1,25 m a 2,35 de distância ela iria de
         15° para 29° fora do eixo — jogada contra a borda esquerda, metade do
         corpo fora. Com 0,78 o ângulo fica em ~17°, que é onde ela já estava, e
         o corpo chega maior sem sair do lugar.
       • `up` desce quase meio metro, e ESSE é o número que muda o retrato. Com
         0,50 a lente ficava ACIMA do alto da cabeça (ombro 1,42 + 0,50 = 1,92
         contra 1,72 de estatura), então a cabeça nascia abaixo do meio da tela
         por construção, olhando a pessoa de cima. Com 0,22 a lente fica na
         altura dos olhos: a cabeça sobe para perto da linha do horizonte, que é
         a proporção da referência.

       A MIRA NÃO SENTE NADA DISSO — e não é sorte, é a geometria de `aim.js`:
       o raio de mira sai do centro óptico e o retículo está no eixo, então o
       ponto mirado cai no centro da tela para QUALQUER trio aqui. Medido nos
       dois enquadramentos, em seis direções de mira incluindo os extremos de
       pitch: erro de 0 px em ambos. O que a aproximação faz é reduzir a
       paralaxe entre lente e arco, ou seja, a flecha sai ainda mais alinhada
       com o gesto do que saía antes. */
    distance: 2.35, // m atrás do ponto de disparo
    right: 0.78, // m à direita da linha de tiro
    up: 0.22, // m acima
    /* Enquadramento do ESPECIAL: a câmera sai de trás do ombro e vai para o
       lado. Ver o comentário em `camera.js` — de trás, a câmera fica DENTRO do
       feixe, e um tubo aditivo visto por dentro é uma tela branca.

       É ESTE o enquadramento do especial inteiro — carga, feixe e volta —,
       porque `kameCam.enabled` está desligado (ver o bloco abaixo).

       Por que 13,15 e não 9: o `9.0` de antes NUNCA foi o afastamento que se
       via. `camera.js` interpolava com `c.specialDistance ?? 9.0 - c.distance`,
       e `??` amarra mais frouxo que `-`, então a expressão valia 9,0 inteiro em
       vez de `9,0 − distance`: o especial ia parar em `distance + 9,0` = 13,15
       m. O parêntese foi consertado lá; o número foi trazido para cá com o
       valor que estava de fato em cena, porque o enquadramento do golpe foi
       ajustado OLHANDO para ele. Agora ele é absoluto de verdade — aproximar ou
       afastar a terceira pessoa não mexe mais no especial. */
    specialDistance: 13.15, // m
    specialRight: 7.5, // m — é este que tira a câmera de dentro do feixe
    specialUp: 2.4, // m

    /* ------------------------------------------------- câmera do FEIXE -----
       A câmera que ia para a FRENTE do Kamehameha e viajava com a cabeça dele
       até o impacto, olhando para trás.

       **DESLIGADA** (`enabled: false`), por decisão de quem joga: o especial
       usa o enquadramento lateral de `special*` acima do começo ao fim, sem o
       corte para a frente do feixe e sem a volta no impacto. Ela continua
       inteira em `camera.js` (`CameraMode.KAME`) e ligar de novo é trocar este
       `false` por `true` — ou apertar a chave "câmera do feixe" no painel `~`,
       que faz isso ao vivo, sem recarregar.

       Os números abaixo são ângulos disfarçados de metros: o par
       `X + XGain · frente` faz o afastamento CRESCER com a viagem, então o
       arqueiro encolhe ao fundo enquanto a ponta continua do lado da câmera.
       Com ganho zero em tudo, a câmera vira um ponto fixo à frente do peito e a
       ponta foge dela. */
    kameCam: {
      enabled: false,
      /* m à frente da PONTA. É o que mantém a cabeça do feixe (o "bloco" que
         acabou de sair) na borda do quadro em vez de atrás da câmera. */
      lead: 7.0,
      leadGain: 0.09, // ×m percorrido
      /* m ao lado do eixo. O mínimo NÃO pode ser menor que o halo (Ø 6,4):
         dentro dele a tela vira a parede branca do §8 do plano. */
      side: 6.0,
      sideGain: 0.03,
      up: 2.0, // m acima do eixo (perpendicular a ele, não ao mundo)
      upGain: 0.01,
      /* m acima do chão, no mínimo. Um feixe rasante levaria a câmera para
         dentro do terreno, e aí a tela é uma pedra. */
      groundClearance: 2.5,
      /* m — onde a viagem PARA, contados de trás do ponto de impacto.
         MEDIDO EM TELA: sem isto a câmera acompanhava a ponta até o fim e
         terminava a dez metros da explosão, com a luz de impacto (intensidade
         900, alcance 90) praticamente encostada na lente. O quadro lavava
         inteiro — a mesma lição do §8 do plano, agora pelo outro lado.
         Parando trinta metros antes, a ponta se afasta da câmera nos últimos
         0,1 s e a explosão acontece ONDE DÁ PARA VER. */
      standoff: 30,
      /* s parados no impacto antes de voltar para a terceira pessoa. Sem eles a
         explosão acontece no frame do corte e ninguém a vê. */
      hold: 0.55,
      /* m — abaixo disto a câmera não assume. Um feixe que morre a vinte metros
         (mirou no próprio pé) daria um corte de dois frames, que lê como falha
         de render, não como cinema. */
      minRange: 45,
    },
    // Ponto da linha de tiro para onde a câmera olha (toe-in). É FIXO de
    // propósito: usar a distância do raycast fazia a imagem tremer a cada troca
    // de superfície sob a mira (ver systems/camera.js). Como a mira sai do eixo
    // óptico, este valor decide a distância em que a flecha sai mais alinhada
    // com o arco — daí estar na faixa dos alvos de meia distância.
    convergence: 40, // m
    arrowCam: {
      distance: 2.6, // m atrás da flecha
      up: 0.5, // m acima
      smoothing: 6,
    },
  },

  aim: {
    // O retículo é o centro da tela e a linha de tiro nasce no EIXO ÓPTICO da
    // câmera. A flecha converge no ponto de cenário que o raio encontra, então
    // ela acerta exatamente onde o retículo está — e o retículo não se mexe,
    // porque o ponto está sempre sobre o eixo (ver systems/aim.js).
    //
    // Isso resolve só a GEOMETRIA (a câmera não fica no mesmo lugar que o
    // arco). Gravidade e vento continuam agindo no voo: mirar no alvo acerta
    // em linha reta, mas a flecha ainda cai e ainda deriva.
    maxRange: 400, // m — alcance do raycast de convergência
    fallbackDistance: 200, // m — se o raio não encontrar nada
  },

  trail: {
    enabled: true, // traçado ligado por padrão
    width: 4.0, // px — espessura na tela
    color: 0xffd873, // usado quando o dono não tem cor (jogo local)
    holdTime: 15, // s totalmente visível depois de completo
    fadeTime: 5, // s de desaparecimento gradual
    minSegment: 0.3, // m entre pontos registrados
    maxPoints: 700,
    // Como o pool de flechas, o de traçados é POR DONO: o traçado do amigo não
    // pode desaparecer porque VOCÊ atirou.
    maxTrailsPerPlayer: 10,
    maxTrailsTotal: 90,
  },

  firstPerson: {
    // Olho logo acima do ponto de ancoragem da corda — é assim que um arqueiro
    // enxerga: a flecha passa rente ao rosto e o arco aparece à frente.
    eyeAboveAnchor: 0.085, // m
    eyeForward: 0.04, // m ao longo da mira
    // Deslocamento lateral do olho em relação à âncora. Empurra o arco para a
    // direita do quadro, como na referência, em vez de deixá-lo no centro
    // exato tapando o alvo.
    eyeSide: 0.095, // m para a esquerda — afasta do braço do arco ao tensionar
    near: 0.05,
    fov: 62,
  },

  targets: [
    // z é negativo à frente do jogador; distance é a distância real ao arqueiro.
    { distance: 10, kind: "topple", offsetX: -1.6 },
    { distance: 18, kind: "swing", offsetX: 2.2 },
    { distance: 30, kind: "topple", offsetX: -2.6 },
    { distance: 45, kind: "swing", offsetX: 1.8 },
    { distance: 62, kind: "heavy", offsetX: -1.2 },
    { distance: 80, kind: "swing", offsetX: 2.6 },
    { distance: 100, kind: "heavy", offsetX: -0.6 },
  ],

  target: {
    faceRadius: 0.5, // m — alvo de 1 m de diâmetro
    faceThickness: 0.12, // m
    rings: 10, // anéis de pontuação
    // As massas não são arbitrárias: uma flecha de 25 g a 70 m/s carrega
    // 1,75 kg·m/s. Fazendo as contas de energia contra a elevação do centro de
    // massa, só tomba quem pesa menos de ~3 kg. Por isso o alvo leve é de
    // compensado (2,5 kg) e o pesado, de espuma prensada (70 kg): o jogo não
    // "ajuda" o tombo, ele simplesmente escolhe massas em que ele acontece.
    kinds: {
      topple: { mass: 2.5, restitution: 0.05, friction: 0.9 },
      swing: { mass: 5.0, restitution: 0.03, friction: 0.7 },
      heavy: { mass: 70, restitution: 0.02, friction: 0.95 },
    },
  },

  world: {
    // Extensão TOTAL do terreno. É muito maior que a área jogável de propósito:
    // a serra precisa continuar existindo atrás dos cumes, senão o horizonte
    // termina numa borda e o jogador vê o vazio.
    minX: -175, // m
    maxX: 175, // m
    minZ: -400, // m
    maxZ: 120, // m
    segmentsX: 176,
    // Mais segmentos porque o vale ficou 100 m mais longo: com a contagem
    // antiga a célula esticaria e o relevo perto do novo fundo ficaria facetado.
    segmentsZ: 244,
    // Concentração da malha: 0 = tudo no centro, 1 = grade uniforme. Com 0.34 a
    // célula tem ~0,7 m dentro da arena e ~4,5 m nos cumes distantes — detalhe
    // onde se joga, triângulos baratos onde só se olha.
    gridFocus: 0.34,
    // Névoa atmosférica. Subiu porque a serra vinha nítida demais e chapada
    // contra o céu: sem perspectiva aérea, uma montanha a 300 m tem o mesmo
    // contraste que a pedra ao lado do pé, e o cérebro lê as duas à mesma
    // distância. O campo de tiro (até ~120 m) mal sente.
    fogDensity: 0.0046,
    /* No modo zumbi a cena já é limitada pela noite e pelo círculo de luz. A
       névoa exponencial multiplicava o custo de fragmento justamente durante a
       transição e não acrescentava leitura útil ao cenário escuro. */
    fogDensityNight: 0,

    // ------------------------------------------------------------- arena ---
    // A área jogável é uma bacia fechada: piso plano cercado por sopé gramado
    // e, depois, pela serra. Todas as distâncias abaixo são medidas a partir da
    // borda do piso (negativo = dentro).
    arena: {
      halfX: 34, // m — meia-largura do piso
      zBack: 32, // m — borda atrás da arqueira (que começa em z = +12)
      // O vale se estende ~100 m além do que era. A trilha acompanha sozinha:
      // `pathCenterX(z)` é função pura de z e o rebaixo da estrada é esculpido
      // por `heightAt` em qualquer ponto — a estrada não "acaba", ela continua.
      // É este comprimento que dá espaço para os alvos progressivos irem até a
      // encosta da serra.
      zFront: -226, // m
      edgeNoise: 11, // m — serpenteio da borda; sem isso a arena é um retângulo
      footBand: 16, // m — largura da encosta gramada
      footHeight: 8.5, // m — altura do sopé
      wallStart: 10, // m — onde a serra começa a subir
      rampLength: 34, // m — comprimento característico da subida (satura)
      peak: 82, // m — altura de referência das cristas
      snowLine: 74, // m — cota média da neve (subiu junto com o verde)
      // As coníferas sobem mais: é a vegetação que dá escala à serra, e um
      // limite baixo deixava dois terços da montanha pelados.
      treeLine: 62, // m — cota acima da qual não nasce conífera
      walkMargin: 12, // m — até onde a arqueira pode subir no sopé
      minWalkNormal: 0.72, // cos da inclinação máxima que ela escala (~44°)
    },
  },

  render: {
    shadowRange: 46, // m — meia-largura do frustum de sombra que segue o jogador
    exposure: 1.0,

    /* ------------------------------------------------------------ presets --
       Um único lugar decide o quanto de imagem a máquina paga.

       Os campos abaixo (`shadowMapSize`, `starsCount`, …) NÃO são escritos à
       mão: `applyQuality()` copia o preset escolhido para cá, e todo o resto do
       jogo continua lendo `CONFIG.render.shadowMapSize` sem saber que existe
       preset nenhum. É o que permite trocar de qualidade sem caçar leitores.

       O modo zumbi é o mais pesado do jogo — noite, uma luz central e uma
       multidão de NPCs —, e é ele que dita o que cai primeiro no `low`: resolução
       de sombra, bloom, estrelas e o pixel ratio. */
    quality: "high", // "low" | "medium" | "high"
    presets: {
      low: {
        shadowMapSize: 512,
        torchIntensityScale: 0.5, // ⇒ 15, contra 30 no high
        bloom: false,
        bloomThreshold: 0.95,
        bloomStrength: 0.35,
        starsCount: 432,
        maxPixelRatio: 1,
        grassCount: 1400,
        msaaSamples: 0,
        vignette: 0.28,
        grain: 0.0,
        /* Sem flare, e não por escolha de gosto: sem bloom e sem MSAA não há
           cadeia de pós-processamento, e o flare mora no passe de acabamento
           dela (ver `core/gradePass.js`). Zero aqui é a documentação do que a
           máquina fraca já não recebia. */
        flare: 0,
        /* O assado de AO fica LIGADO até no preset mais baixo. Ele não custa
           nada em runtime (é cor de vértice) e o build dele sai em
           milissegundos — a oclusão é analítica sobre a lista de árvores, não
           raycast sobre a malha (ver `bakeVegetationAO`). Desligá-lo tiraria a
           sombra do bosque de graça, sem devolver um único quadro por segundo. */
        terrainAO: true,
        cullDistance: 45, // m — bicho some do render além disto
      },
      medium: {
        shadowMapSize: 1024,
        torchIntensityScale: 0.83, // ⇒ 25
        bloom: true,
        bloomThreshold: 0.85,
        bloomStrength: 0.5,
        starsCount: 650,
        maxPixelRatio: 1.5,
        grassCount: 3000,
        msaaSamples: 2,
        vignette: 0.34,
        grain: 0.02,
        flare: 0.8,
        terrainAO: true,
        cullDistance: 60,
        pausaChance: 0.35,
        pausaMin: 0.5,
        pausaMax: 1.0,
        avancoChance: 0.25,
        avancoIntervalo: 8,
        avancoMin: 2.5,
        avancoMax: 4.5,
        avancoMetros: 12,
      },
      high: {
        shadowMapSize: 2048,
        torchIntensityScale: 1.0, // ⇒ 30
        bloom: true,
        bloomThreshold: 0.78,
        bloomStrength: 0.62,
        starsCount: 900,
        maxPixelRatio: 2,
        grassCount: 4200,
        msaaSamples: 4,
        vignette: 0.38,
        grain: 0.028,
        /* Força do reflexo de lente ao olhar para o Sol na Lua — 0 desliga.
           Não é um item de custo: o efeito é aritmética dentro de um passe que
           já roda, e fora da Lua o desvio de uniforme o salta inteiro. O número
           está no preset porque é aqui que mora TODA decisão de imagem, e
           porque a média pede um véu um pouco mais discreto. */
        flare: 1.0,
        terrainAO: true,
        cullDistance: 60,
      },
    },
  },

  /* ------------------------------------------------------------------ rede --
     O jogo é para jogar com amigos. O teto de 12 não é técnico — é o número em
     que um jogo de arco continua fazendo sentido, com espaço para mirar e
     distância para a flecha voar. */
  net: {
    url: "", // vazio = mesma origem, em /ws
    maxPlayers: 12,
    stateHz: 20, // envio do próprio estado
    boarHz: 10, // envio das transformações dos porcos
    // Quanto o mundo dos OUTROS fica no passado. É este atraso que absorve o
    // jitter da rede: com ele, dois pacotes atrasados ainda têm um par de
    // amostras para interpolar, e o boneco alheio anda liso em vez de teleportar.
    interpDelay: 0.1, // s
    nameMaxLength: 16,
    heartbeat: 15, // s entre pings (também impede timeout de proxy ocioso)
    // Silêncio de heartbeat × (1 + faltas) = 45 s ⇒ conexão morta e vaga
    // liberada. Sem isso, uma aba fechada à força seguraria lugar para sempre.
    deadAfterMissed: 2,
    // Sem isto, uma queda de rede de cinco segundos apagaria a sessão inteira
    // de quem estava jogando sozinho.
    emptyRoomGrace: 30, // s antes de destruir a sala vazia
    // Quantas flechas cravadas quem entra atrasado recebe. É o que faz o campo
    // de tiro aparecer como está, com as flechas nos alvos.
    snapshotStuckArrows: 60,
    // Folga entre o impacto declarado e onde a vítima estava de fato. Precisa
    // ser generosa: quem atira vê o alvo 100 ms no passado, e correndo isso já
    // vale quase um metro. Serve para o jogo não se contradizer, não para
    // impedir trapaça.
    hitTolerance: 4, // m
    reconnectDelays: [0.4, 0.8, 1.6, 3, 5], // s — backoff, depois repete o último
    // Tempo máximo para uma sala esperar o aquecimento dos clientes antes de
    // iniciar a noite. Em condições normais a barra termina em menos de 2 s.
    modePrepareTimeout: 12,
    cull: {
      shadow: 25, // m — além disso o jogador remoto para de projetar sombra
      hide: 160, // m — além disso nem é desenhado
      /* A LUA VÊ MAIS LONGE, e isto começou como o oposto.
       *
       * A ideia era CORTAR mais cedo na Lua: lá não há árvore, morro nem
       * neblina para esconder ninguém, então os 160 m — que no vale já são
       * generosos — alcançam a sala inteira o tempo todo, e cada corpo custa
       * ~94 chamadas de desenho.
       *
       * A conta do duelo desmontou a ideia e revelou um defeito no caminho: o
       * anel de duelo da Lua tem 95 m de RAIO (`levels.moon.duel`), e dois
       * duelistas nascem em pontos opostos dele — a 190 m um do outro. Com o
       * corte em 160 m, o duelo lunar COMEÇA com o adversário invisível, e ele
       * só aparece depois que alguém anda trinta metros. Cortar em 110 m,
       * como o plano dizia, tornaria isso muito pior.
       *
       * 210 m cobrem o anel inteiro com folga. O preço é desenhar corpos entre
       * 160 e 210 m — ~36 chamadas cada, medido, e só nos instantes em que
       * alguém está de fato tão longe. Um adversário que não se vê é um preço
       * mais alto que esse. */
      hideMoon: 210, // m
    },
  },

  /* ---------------------------------------------------------------- nascer --
     O nascimento padrão cai de 10 m e pisca. A noite dos zumbis sobrescreve o
     drop para 0: todos entram diretamente no chão do quadrado de tochas. */
  spawn: {
    centerX: SPAWN_CENTER_X, // centro da bacia jogável
    centerZ: SPAWN_CENTER_Z,
    radius: 38, // m — raio máximo do sorteio
    minRadius: 6, // m — não nasce colado no centro exato
    dropHeight: 10, // m acima do chão
    invulnerability: 4, // s piscando e imune
    blinkHz: 6,
    minSeparation: 14, // m entre dois nascimentos simultâneos
    manualCooldown: 10, // s entre renascimentos pedidos na mão (tecla K)
    maxAttempts: 60, // tentativas de sorteio antes de relaxar o critério
    // O corpo tomba antes de renascer. Subiu de 1,4 s porque o ragdoll precisa
    // de tempo para bater no chão, escorregar e assentar — cortar no meio
    // congelava o corpo no ar. O total até renascer não mudou: o que a queda
    // ganhou, a espera perdeu.
    deathDuration: 2.0, // s
    respawnDelay: 1.8, // s entre o corpo assentar e nascer de novo
  },

  /* -------------------------------------------------------------- ragdoll --
     O tombo depois da flechada. A explicação de por que isto não usa os corpos
     rígidos do Rapier está em `game/ragdoll.js`; aqui ficam só os números.

     Medidas do esqueleto (ombro, quadril, centro de massa) repetem as de
     `entities/player.js` porque o ragdoll roda ANTES da pose e não pode
     depender dela. Se o boneco mudar de proporção, estes quatro números vêm
     junto. */
  ragdoll: {
    comHeight: 1.0, // m — centro de massa acima dos pés
    shoulderY: 1.42, // m
    shoulderX: 0.175, // m
    hipY: 0.9, // m
    hipX: 0.105, // m

    /* Ganho do empurrão: quanto de velocidade o corpo recebe por m/s de flecha.
       Não é físico e não tenta ser (ver o comentário em `Ragdoll.begin`). Com
       0.05, a flecha mais fraca (30 m/s) dá um tranco de 1,5 m/s e a mais forte
       (120 m/s) joga o corpo a 6,0 m/s — a diferença entre os dois é visível,
       que é o ponto. */
    pushGain: 0.05,
    liftGain: 0.022, // fração da velocidade convertida em impulso para cima
    spinGain: 0.9, // rad/s por (m de braço × m/s de flecha)
    maxSpin: 7.0, // rad/s — teto do giro, para não virar hélice
    fallbackSpin: 2.2, // rad/s quando a morte chega sem dado de impacto

    spinDamping: 0.55, // 1/s no ar
    groundSpinDamping: 5.5, // 1/s encostado no chão
    groundFriction: 4.0, // 1/s — freio horizontal no chão
    bounce: 0.14, // fração da velocidade vertical devolvida
    settleRate: 4.5, // 1/s — com que pressa o corpo procura a horizontal

    // Membros: mola forte o bastante para não parecer borracha, amortecimento
    // alto o bastante para não oscilar depois de parar.
    limbStiffness: 150,
    limbDamping: 9.0,
    centrifugal: 1.0, // ganho da força centrífuga (chicote do braço)
    coriolis: 0.8, // ganho de Coriolis (arrasto lateral)

    // Coluna e pescoço encolhem: um corpo sem tônus se dobra para a frente.
    spineCurl: 0.55, // rad
    spineStiffness: 34,
    spineDamping: 7.0,
    neckCurl: 0.7, // rad — a cabeça pende mais que o tronco
    neckStiffness: 46,
    neckDamping: 8.0,
  },

  /* ----------------------------------------------------------------- modos - */
  modes: {
    duel: {
      minPlayers: 2, // quantos precisam aceitar para começar
      ringRadius: 46, // m — anel onde os duelistas são postos
      minSeparation: 45, // m entre duelistas: é jogo de arco, precisa de espaço
      inviteTimeout: 20, // s até o convite expirar
      respawnDelay: 2.5, // s entre morrer e renascer
    },

    /* ----------------------------------------------------- o último em pé ----
       UMA VIDA. Morreu, acabou — e fica assistindo.

       É o único modo do jogo em que a morte é definitiva, e é isso que ele
       vende: em todos os outros o renascimento em quatro segundos torna cada
       tiro barato, e a consequência é que ninguém se esconde, ninguém espera,
       ninguém escolhe a hora. Aqui a primeira flecha que você toma é a última,
       e o modo inteiro sai dessa única regra.

       Quem morre NÃO sai da sala nem fica olhando para uma tela preta: entra em
       câmera livre e voa por onde quiser. Assistir é a segunda metade do modo —
       ver de cima quem sobrou se caçando é o prêmio de consolação, e é o que
       impede que morrer cedo signifique quatro minutos de nada. */
    lastStand: {
      minAlive: 2, // abaixo disto a rodada acaba
      /* O anel de nascimento é o do duelo, e pelo mesmo motivo: começar a 10 m
         de alguém, num modo em que a primeira flecha decide tudo, seria sortear
         o vencedor antes de a partida começar. */
      ringRadius: 52, // m
      /* Sem invencibilidade LONGA ao nascer: quatro segundos piscando num modo
         de vida única é tempo de atravessar meia arena protegido. Um segundo e
         meio cobre a queda de nascimento e nada mais. */
      invulnerability: 1.5, // s
      /* Quanto o corpo fica caído antes de a câmera soltar. É o mesmo tombo de
         sempre — o que muda é que depois dele não vem renascimento nenhum. */
      spectateDelay: 2.2, // s
    },

    /* ------------------------------------------------------ rouba bandeira ---
       UMA bandeira, no meio, e duas bases. Pegou, corre para casa.

       Uma bandeira só, e não uma por time. Com duas, o modo vira dois jogos
       paralelos que mal se encontram — cada equipe defende o próprio canto e o
       campo do meio fica vazio. Com uma, TODO MUNDO quer o mesmo objeto, e o
       centro do mapa vira o lugar onde a partida acontece.

       Os times são HUMANOS × CPU, como no duelo de times (`teamDuel`), e pela
       mesma razão prática: é o que funciona com uma pessoa só na sala, que é o
       caso mais comum. Ver `Room.timeDe`. */
    captureFlag: {
      /* Onde ficam as duas bases, como fração do raio da área de nascimento da
         fase. Fração, e não metros: o vale tem uma bacia de 38 m e a Lua uma
         planície bem maior, e um número fixo poria as bases dentro de uma
         cratera lá ou fora da bacia aqui. */
      baseRing: 0.82,
      baseRadius: 9, // m — o disco onde entregar a bandeira conta como entrega
      /* Raio para ENCOSTAR na bandeira e pegá-la. Generoso de propósito: o
         portador morre a toda hora e a bandeira cai no chão no meio da briga —
         obrigar a passar em cima do pixel exato faria o objeto mais importante
         do modo parecer emperrado. */
      pickupRadius: 2.6, // m
      captures: 5, // entregas para vencer
      /* A bandeira largada VOLTA SOZINHA PARA CASA depois disto. Sem o retorno,
         uma bandeira caída num canto do mapa que ninguém viu congela a partida
         — e ninguém tem como saber que ela está lá.

         Encurtou de 30 s para 18 junto com a virada para duas bandeiras. Lá o
         retorno era só uma rede de segurança contra a bandeira esquecida; aqui
         ele é REGRA DE JOGO, porque é o prêmio de quem defendeu: matar o ladrão
         e não conseguir chegar ao corpo ainda tem de devolver a bandeira. Trinta
         segundos são tempo de sobra para o time do ladrão trazer outro e
         recomeçar dali, o que anula a defesa. */
      returnAfter: 18, // s
      respawnDelay: 4, // s — mais longo que o padrão: morrer defendendo custa
    },
    /* ------------------------------------------------------- alvos em série --
       Um alvo por vez, cada um mais longe, subindo a estrada até a encosta da
       serra. Some ao ser acertado e nasce outro adiante.

       As distâncias crescem em PROGRESSÃO GEOMÉTRICA: de 25 m para 32 m o tiro
       muda pouco; de 220 m para 300 m muda tudo. Um passo fixo faria os
       primeiros alvos parecerem repetidos e os últimos, um salto no escuro. */
    series: {
      firstDistance: 25, // m — o primeiro alvo, medido a partir da linha no chão
      lastDistance: 300, // m — o último, na encosta da serra
      steps: 12, // quantos alvos até chegar ao mais distante
      pointsBase: 50, // pontos do primeiro alvo
      pointsPerStep: 1.32, // multiplicador de pontos a cada alvo vencido
      markerHeight: 5.0, // m — altura da seta indicadora sobre o alvo
      explosionTime: 1.0, // s de explosão ao acertar
      /* A linha no chão. Jogadores nascem ATRÁS dela e só podem andar do lado
         de cá — ir até o alvo a pé anularia o modo. */
      startZ: 26, // m — Z da linha de tiro (cerca no chão)
      spawnBehind: 3, // m — quanto atrás da linha os jogadores nascem (+Z)
      fenceWidth: 48, // m — largura visual da linha no chão
      lineSpread: 6, // m — afastamento lateral entre jogadores na linha
    },

    /* ---------------------------------------------------- caça aos pássaros --
       Corrida: quem abater 5 aves primeiro ganha. Alternativa instantânea: o
       pássaro raro, maior e mais alto — quem o derruba fecha a partida na hora.
       No modo o bando fica mais denso; fora dele o céu volta ao cenário normal. */
    birdHunt: {
      birdsToWin: 5, // abates para vencer pela contagem
      birdCount: 14, // mais abundantes que o cenário livre (CONFIG.birds.count)
      special: {
        cruiseHeight: 62, // m — bem acima do bando comum (~26 m)
        heightSpread: 3,
        circleRadius: 90, // m — circunda a arena num arco largo
        flySpeed: 10.5,
        scale: 5.5, // bem maior: tem de ser óbvio no céu que é a rara
        hitRadius: 1.6, // colisor acompanha o tamanho; a dificuldade é a altura
        bodyColor: "#c45a28",
        wingColor: "#8a3218",
        beakColor: "#e8c45a",
        points: 500,
      },
    },

    boarHunt: {
      /* As ondas crescem por TABELA, não por fórmula.
         Uma progressão calculada dá números certinhos e sem graça; escrita à
         mão, dá para apertar o salto onde ele precisa doer — o pulo de 6 para
         10 é onde a caçada deixa de ser tiro ao alvo. */
      waveSizes: [3, 6, 10, 15, 20],
      /* A quinta onda é a última: esgotada ela, a tela de vitória entra e os
         porcos que sobraram continuam vivos e valendo ponto — só não nasce
         onda nova. */
      maxWaves: 5,
      /* A onda seguinte entra quando sobram 10 % da atual, ARREDONDANDO PARA
         CIMA: onda de 3 chama a próxima com 1 vivo, de 20 com 2. Para baixo,
         as primeiras ondas exigiriam campo limpo, e uma caçada que para porque
         um javali se escondeu atrás de uma pedra não é uma caçada. */
      nextWaveRemaining: 0.1,
      // Rede de segurança: se o último porco ficar inalcançável, a onda entra
      // assim mesmo. Não é o caminho normal, é o que impede o modo de travar.
      waveTimeout: 60, // s
      maxAlive: 45, // teto de porcos vivos ao mesmo tempo
      corpseLifetime: 25, // s até o corpo sumir
      minDistFromPlayers: 28, // m — não nasce no colo de ninguém
      maxDistFromCenter: 70, // m
      // Porco longe vale mais. A distância é a mesma do texto flutuante: do
      // ponto de disparo ao impacto.
      score: {
        minPoints: 10, // abate colado
        maxPoints: 200, // abate no alcance máximo pontuado
        nearDistance: 10, // m — daqui para baixo vale o mínimo
        farDistance: 120, // m — daqui para cima vale o máximo
        curve: 1.6, // > 1 ⇒ a recompensa cresce mais rápido no fim
      },
    },

    /* ------------------------------------------------------------- o alce ---
       Um bicho só, e ele começa do outro lado do vale.

       Os arqueiros são postos num extremo e o alce no oposto: é essa distância
       que dá tempo de um primeiro tiro antes de ele chegar, e é ela que torna a
       investida uma ameaça em vez de uma surpresa. Morto o alce, a partida
       acaba em vitória — um chefão, não uma onda infinita. */
    elkHunt: {
      arenaRadius: 60, // m — raio em que alce e arqueiros são postos
      lineSpread: 7, // m entre arqueiros na linha
      /* Uma partida = um alce. Morto, vitória; sem respawn automático do bicho.
         O jogador caído espera `playerRespawnDelay` (igual à lógica do zumbi
         caído: countdown + espectador). Se todos caírem ao mesmo tempo, derrota. */
      playerRespawnDelay: 10, // s até o arqueiro voltar após a cabeçada
      invulnerability: 2.5, // s de graça ao renascer
      /* SOZINHO NA SALA a regra é outra: não existe "todo mundo caiu" quando
         só existe uma pessoa, e declarar derrota ali seria terminar a partida
         no primeiro erro. O arqueiro solitário volta em poucos segundos e a
         vida do alce continua onde estava — a caçada é uma queda de braço,
         não uma corrida de vida única. */
      soloRespawnDelay: 3, // s até voltar quando se joga sozinho
    },

    /* ----------------------------------------------------------- os zumbis --
       Noite fechada, quatro tochas e dez hordas.

       A ideia inverte todos os outros modos: em vez de sair atrás da caça, você
       defende um quadrado de luz. O escuro não é enfeite — é a regra do jogo.
       Fora do raio das tochas não se vê nada, e além de `safeRadius` o campo
       mata. É isso que impede a resposta óbvia de "corro para longe e atiro de
       fora", que transformaria a horda num alvo parado. */
    zombie: {
      // Centro da arena de luz. É o mesmo centro do sorteio de nascimento, então
      // o quadrado cai numa parte plana e jogável do vale.
      centerX: SPAWN_CENTER_X,
      centerZ: SPAWN_CENTER_Z,

      // ------------------------------------------------------------ tochas --
      // Meia-aresta do quadrado. 7 m dá 14 m de lado: tochas mais juntas, com
      // o centro bem iluminado (ver centerLight* abaixo).
      torchHalf: 7, // m
      torchHeight: 2.5, // m — altura da chama acima do chão
      torchRange: 14, // m — alcance da luz de cada tocha
      torchIntensity: 30, // legado — cantos não usam mais PointLight (ver torches.js)
      torchColor: 0xffa542,
      // Luz extra no centro do quadrado — única PointLight do modo; alcance
      // maior cobre o quadrado sem luz por canto (ver `systems/torches.js`).
      centerLightIntensity: 32,
      centerLightRange: 17, // m
      centerLightHeight: 3.2, // m acima do chão
      // Uma flecha apaga a tocha. É risco de verdade: errar o zumbi e acertar a
      // tocha escurece o próprio canto de quem errou.
      torchRadius: 0.16, // m — raio do colisor do poste

      /* Distância do centro além da qual o jogador morre.
         Fica FORA do quadrado das tochas (cujos cantos estão a 7√2 ≈ 9,9 m),
         com folga para perseguir um zumbi até a borda da luz sem ser punido por
         isso — mas não o bastante para acampar no escuro. */
      safeRadius: 16, // m

      // ----------------------------------------------------------- respawn --
      respawnDelay: 10.0, // s — morto espera; volta se alguém ainda estiver vivo
      invulnerability: 2.5, // s de graça ao voltar ao centro

      // ------------------------------------------------------------ hordas --
      /* Bases para N=1; tamanho real = ceil(base × jogadores). Horda 9 = boss. */
      hordeSizes: [2, 4, 6, 9, 12, 16, 21, 27],
      hordes: 9,
      hordeSpeeds: [1.0, 1.1, 1.2, 1.35, 1.5, 1.65, 1.8, 1.95],
      hordeDelay: 3.0, // s entre a última morte e a horda seguinte
      lateHordeFrom: 6, // hordas ≥6: nascem mais longe e com mais variação
      lateHordeSizeFrom: 16,
      spawnRadius: 36, // m — legado
      spawnRadiusMin: 28,
      spawnRadiusMax: 50,
      spawnRadiusMaxLate: 58, // hordas grandes: nascem mais longe
      spawnJitter: 4,
      spawnStagger: 0.85,
      speedVariationLate: 0.28, // hordas ≥6: quebra pelotão

      /* --------------------------------------------- ritmo de CHEGADA -------
         O que define a dificuldade de uma horda não é quantos zumbis nascem,
         é de quanto em quanto tempo um deles ENCOSTA no círculo de luz. E as
         duas coisas não são a mesma: o raio de nascimento varia ~20 m, o que
         são ~15 s de caminhada, enquanto o intervalo entre nascimentos é de
         menos de 1 s. Espaçar o nascimento, portanto, não espaça nada — quem
         nasce depois e perto ultrapassa quem nasceu antes e longe, e a horda
         que saiu enfileirada chega em bloco.

         Por isso o agendamento é pela CHEGADA (ver `ZombieNight.nextHorde`):
         estes números são o intervalo alvo entre dois zumbis alcançarem o
         jogador, e o instante de nascimento é derivado deles descontando a
         viagem. O raio volta a ser só variedade visual, sem efeito no ritmo.

         Um abate custa ~2 flechas × (tensão + 0,65 s de recarga) ≈ 3 s, então
         a faixa de 3,4 s a 2,2 s vai de "dá para respirar" a "não dá conta
         sozinho de todos" sem nunca virar a parede que era antes. */
      hordeArrivalGaps: [4.2, 3.8, 3.4, 3.1, 2.9, 2.7, 2.4, 2.2], // s
      /* Hordas 1–2 são pequenas demais para o agendamento importar; até lá o
         `spawnStagger` simples continua valendo. */
      arrivalPacingFrom: 3,
      /* Mais gente = mais zumbis (o tamanho já multiplica por N), então o
         intervalo precisa encolher junto, senão a horda de 4 jogadores levaria
         quatro vezes mais tempo. Encolhe SUBLINEARMENTE (0,85 por jogador
         extra): quatro arqueiros somam mais poder de fogo que um, mas dividem
         um círculo de luz de 14 m e atrapalham a linha de tiro um do outro. */
      playerGapScale: 0.80,

      // ------------------------------------------------------------- bicho --
      speed: 1.15,
      speedVariation: 0.18,
      // Guarda-corpos para o modo multiplayer: mortos ainda ficam visíveis por
      // alguns segundos, então o limite precisa considerar vivos + cadáveres.
      maxAlive: 48,
      maxEntities: 64,
      // A separação é resolvida no servidor, não pelo solver físico do cliente.
      npcSeparationRadius: 0.9,
      npcSeparationWeight: 1.35,
      bodyHits: 2,
      fullDrawKillSpeed: 118,
      headMinY: 1.45,
      attackRadius: 1.1,
      attackInterval: 1.4,
      burnTime: 1.5,
      corpseLifetime: 7,
      eyeColor: 0xff2a18,
      moanMinInterval: 3.0,
      moanMaxInterval: 8.5,
      moanVolume: 0.85,

      bodyPoints: 40,
      headPoints: 100,

      /* Metade dos lobos por horda, mantendo ao menos um nas primeiras ondas.
         O lobo corre a 6,7 m/s — quase 6× o zumbi — então ele não entra no
         agendamento por chegada: ele É a quebra de ritmo, e some dentro da
         horda em vez de ocupar um lugar na fila. Justamente por isso a conta
         dele desceu um degrau: com os zumbis chegando espaçados, o lobo passou
         a ser a única coisa que força o jogador a largar a mira do que está à
         frente, e dois desses ao mesmo tempo já resolvem a horda inteira. */
      wolfCounts: [1, 1, 1, 2, 2, 3, 3, 4],
      // Lobos não nascem todos no start: 1 a cada N zumbis mortos nesta horda.
      wolfEveryZombieKills: 4,
      wolfSpawnDelay: 1.5, // s de espera antes do lobo entrar (após gatilho)
      wolfSpawnRadiusBonus: 6, // m a mais que zumbis — chegam depois, de longe
      wolfSpawnStagger: 2.5, // s entre lobos da mesma horda
      // Modo zumbi: 2× a velocidade base lenta (legacy −30%, depois dobrado).
      wolfSpeed: WOLF_SPEED_SLOW * 2,
      wolfSpeedVariation: 0.08,
      wolfAttackRadius: 1.0, // m — mordida corpo a corpo (~ raio lobo + player + focinho)
      wolfLeapHitRadius: 1.2, // m — contato no salto (não 3 m de tolerância)
      wolfAttackInterval: 1.0, // s
      wolfLeapRange: 5.0, // m — inicia o salto-ataque
      wolfLeapDuration: 0.45, // s
      wolfLeapHeight: 1.2, // m
      wolfLeapSpeed: WOLF_LEAP_SLOW * 2,
      /* Motor de locomoção: giro limitado, aceleração, curva sustentada. */
      wolfAI: {
        turnRateMax: 3.2, // rad/s — giro no trote
        turnRateMin: 1.1, // rad/s — giro na disparada
        accel: 7.0 * WOLF_SLOW_SCALE * 2,
        brake: 11.0 * WOLF_SLOW_SCALE * 2,
        speedApproach: 0.65, // fração de wolfSpeed longe do alvo
        speedChase: 1.0, // fração perto / antes do salto
        separationRadius: 1.8, // m — repulsão entre lobos
        whiskerAngle: 0.61, // rad (~35°) — sondas laterais de terreno
        bearingOffsetMin: 0.26, // rad (~15°) — curva de aproximação
        bearingOffsetMax: 0.61, // rad (~35°)
        bearingHoldMin: 3.0, // s — quanto sustenta o lado da curva
        bearingHoldMax: 6.0,
        approachFadeDist: 18, // m — offset decai até zero nesta distância
        leapAlignCone: 0.61, // rad (~35°) — alinhamento exigido para saltar
        leapLandSpeedFrac: 0.55, // fração da vel. do salto mantida ao pousar
      },
      wolfPoints: 60,
      wolfHowlMinInterval: 2.5, // s
      wolfHowlMaxInterval: 6.0, // s
      wolfHowlVolume: 1.05,
      wolfBodyHeight: 1.45, // m — cernelha de lobo, não de cachorro
      wolfEyeColor: 0xff8c28, // laranja assustador (diferente dos zumbis)

      // ------------------------------------------------------ chefão (h.9) --
      boss: {
        /* ~3× o chefão anterior (2.8): silhueta de colosso no breu. */
        scale: 8.5,
        speed: 0.9,
        /* Pista longa: ~40 flechas × ~3,5 s entre tiros × 0,9 m/s ≈ 126 m;
           160 m dá folga para a luta respirar no fundo do vale (−Z). */
        spawnRadius: 160,
        bodyDamage: 1,
        headDamage: 2,
        arrowsToKillPerPlayer: 40,
        attackRadius: 6.6,
        headMinY: 1.45 * 8.5,
        points: 500,
        headBonusPoints: 200,
        eyeColor: 0xffaa22,
        /* LOD: o colosso precisa permanecer legível bem além dos zumbis comuns. */
        lodScale: 5,
        /* Rim light no mesh (mesmo truque do arqueiro) — contorno no breu. */
        rimStrength: 0.34,
        moanMinInterval: 1.8,
        moanMaxInterval: 3.5,
        moanVolume: 1.45,
        laughMinInterval: 18,
        laughMaxInterval: 35,
        laughVolume: 1.25,
        /* Matilhas de escolta: nascem no corredor do chefão, não na arena.
           pack = min(packMax, packBase + packPerPlayer × (N − 1)). */
        wolves: {
          // Metade da escolta do chefão; a chegada continua escalonada.
          packBase: 2,
          packPerPlayer: 1,
          packMax: 4,
          waves: 4,
          healthThresholds: [0.75, 0.5, 0.25],
          /* Entrada escalonada: matilha grande não desaba toda no centro. */
          stagger: 2.4,
          spawnOffsetMin: 14,
          spawnOffsetMax: 48,
          spawnLateral: 8,
        },
        /* Flash no impacto: clarão vermelho visível de longe — todos veem o hit. */
        hitFlash: {
          color: 0xff1a14,
          intensity: 520,
          fillIntensity: 0.72,
          range: 150,
          decay: 0.85,
          life: 0.48,
          meshEmissive: 0xff1808,
          meshIntensity: 3.2,
          meshLife: 0.42,
        },
        /* Tempestade só no chefão: nuvens escuras + raios volumétricos + trovão.
           Chuva opcional = Points leves (~48 gotas, 1 draw). */
        storm: {
          fadeIn: 2.2,
          fadeOut: 1.6,
          strikeMin: 3.2, // s — mais frequente que o clima genérico
          strikeMax: 7.5,
          nearBossChance: 0.72, // maioria dos raios perto do chefão
          nearBossRadiusMin: 5, // m
          nearBossRadiusMax: 26,
          doubleChance: 0.45,
          doubleDelay: 0.1,
          cloudHeight: 128, // m — nasce nas nuvens baixas
          lightColor: 0xc8e0ff,
          lightIntensity: 420, // clarão local (silhueta do chefão)
          lightRange: 72,
          lightDecay: 1.25,
          lightLife: 0.22,
          boltLife: 0.18,
          boltCoreWidth: 0.55, // m — núcleo branco
          boltGlowWidth: 2.4, // m — halo azul additive
          shockLife: 0.28, // anel no solo
          thunderVolume: 0.7, // mais baixo que o estouro inicial
          thunderMaxDistance: 260,
          rain: true,
          rainCount: 48,
        },
      },
    },

    /* --------------------------------------------------- chuva de meteoros --
       Hordas na Lua. Rochas em chamas caem sobre a base; uma que encoste no
       chão mata todo mundo. Ver `docs/plano-chuva-de-meteoros.md`.

       A ideia que organiza os números: **a dificuldade é CONCORRÊNCIA**, não
       quantidade. O que aperta não é o tamanho da horda, é quantas rochas
       estão no ar ao mesmo tempo — que é `prazo de queda ÷ intervalo`. É a
       mesma lição que `hordeArrivalGaps` do zumbi aprendeu na marra. */
    meteorRain: {
      hordes: 10,

      /* ---------------------------------------------------------- entrada --
         Dez segundos antes da horda 1. Quem acabou de sair de uma tela de
         carregamento não sabe para onde está olhando; sem isto a primeira
         rocha pega o jogador de costas. Quem chega depois NÃO reinicia nada:
         o que trafega é o instante absoluto (`startsAt`), então um retardatário
         recebe um horário no passado e simplesmente não desenha contagem. */
      startDelay: 10, // s
      hordeDelay: 4.0, // s entre a última rocha morta e a horda seguinte
      tankDelay: 4.0, // s entre o fim do primeiro ato e a descida do colosso

      /* ------------------------------------------------------------ queda --
         Altitude de entrada e velocidade CONSTANTE (não queda livre): com
         g = 1,62 os primeiros dez segundos seriam quase parados, e a rocha
         chegaria acelerando bem na hora em que mirar fica difícil. Constante,
         a antecipação vira algo que se APRENDE. */
      /* MEDIDO EM TELA: 210 m de altitude com 12° a 22° de inclinação punha a
         rocha praticamente A PRUMO sobre quem defende — o ponto de entrada
         ficava a 82° de elevação, e jogar virava olhar para o teto com o
         pescoço torcido. A câmera do jogo até alcança (o `pitchMax` são 86°),
         mas alcançar não é o mesmo que ser jogável.

         A correção é geométrica e tem duas metades. Baixar a altitude aproxima
         o alvo do horizonte; INCLINAR MUITO MAIS a entrada é o que resolve de
         verdade — a 35°–52° fora da vertical, a rocha entra de 105 a 192 m ao
         lado do alvo, ou seja, entre 38° e 55° de elevação vista da base. Ela
         aparece perto do horizonte, risca o campo de estrelas na diagonal e só
         no fim passa por cima.

         SEGUNDA PASSADA, pelo mesmo motivo: 38°–55° ainda era "de cima". A
         faixa desceu para 58°–68° de inclinação, que põe a entrada entre 239 e
         375 m ao lado do alvo — 22° a 32° de elevação vista da base, a altura
         em que se olha uma coisa no céu sem levantar o queixo. Comparação que
         calibra: o horizonte da Lua (curvatura exagerada, R = 26 km) fica a
         300 m de quem está em pé, então a rocha NASCE praticamente em cima
         dele e vem descendo na diagonal por todo o caminho.

         A altitude NÃO desceu junto, e é de propósito: o prazo de queda é
         `altitude ÷ velocidade`, e ele é o número que o banco de provas
         aprovou (`scripts/bench-meteoros.js`). Mexer só na inclinação muda o
         ÂNGULO sem tocar no prazo — a tabela de velocidades abaixo continua
         valendo palavra por palavra.

         O que muda de verdade no jogo é a VELOCIDADE HORIZONTAL: com 375 m de
         recuo em vez de 192, a rocha atravessa o céu a 14 m/s na horda 1 e a
         24 m/s na 10 (era 7,3 e 12,3). Mirar passa a exigir mais adiantamento —
         é o preço de tirar a rocha de cima da cabeça, e é o número a baixar se
         o modo ficar duro demais.

         TERCEIRA PASSADA, e ela desfaz o exagero da segunda.

         Medido no sorteio real (200 amostras): a faixa de 58°–68° punha a
         entrada entre 202 e 423 m do ponto de queda, com elevação de 19,5° a
         36°. O canto ruim dessa faixa é o que produziu o relato de que "o
         meteoro aparece quando já está quase encostando no chão": a 423 m e
         19,5°, uma pedra de 2,5 m de raio entra com meia dúzia de pixels rente
         ao horizonte de um céu preto. Ela ESTÁ lá desde o nascimento — o
         marcador do HUD prova —, mas não é legível como rocha até já estar
         perto, e o que o jogador vê é uma coisa surgindo baixa.

         A correção mexe nos DOIS números ao mesmo tempo, e é isso que a torna
         barata: a altitude sobe para 185 m e a inclinação recua para 53°–61°.
         O recuo horizontal fica em 242 a 331 m — praticamente a mesma faixa de
         antes, sem a cauda de 423 — e a elevação de entrada sobe para 29° a
         37°. É acima do horizonte de um jeito que se lê, e ainda abaixo dos
         38°–55° que a segunda passada rejeitou por pedir queixo levantado.

         O PRAZO DE QUEDA NÃO MUDA: as velocidades abaixo foram reescaladas por
         185/150, exatamente como já haviam sido por 150/210. Continua sendo de
         26,3 s na horda 1 a 15,7 s na 10 — o número que o banco de provas
         aprovou, intocado. */
      spawnAltitude: 185, // m acima do ponto de queda
      altitudeJitter: 12, // m
      entryTiltMin: 0.92, // rad (53°) — 242 m ao lado, 37° de elevação
      entryTiltMax: 1.06, // rad (61°) — 331 m ao lado, 29° de elevação
      /* MEDIDO, não estimado — ver `scripts/bench-meteoros.js`.
         A primeira tabela ia até 17,5 m/s e produzia 52 % de vitórias com o
         arqueiro médio, contra os 70 % que o modo pede. O motivo não estava na
         média e sim na VARIÂNCIA: com prazo de 12 s por rocha e ciclo de tiro
         de ~2 s, uma sequência de dois erros já é fatal, e sequências de dois
         erros acontecem o tempo todo a 78 % de acerto.

         Estas velocidades foram REESCALADAS junto com a altitude (×150/210 e
         depois ×185/150), e não escolhidas de novo: o que a dificuldade usa é o
         PRAZO DE QUEDA, e ele continua idêntico ao que o banco de provas
         aprovou — de 26,4 s na horda 1 a 15,7 s na 10. Nem baixar nem levantar
         o céu podia mexer no preço do modo. */
      fallSpeeds: [7.0, 7.5, 8.1, 8.6, 9.1, 9.7, 10.2, 10.7, 11.2, 11.8],

      /* -------------------------------------------------- onde elas caem --
         A base lunar É o centro da arena (`levels.moon.barrier` e
         `levels.moon.base` são o mesmo ponto). Perto dela, sempre: é o pedido,
         e é o que mantém a chuva inteira no campo de visão de quem defende. */
      dropInnerRadius: 18, // m — o miolo da base
      dropOuterRadius: 55, // m — o anel em volta
      dropInnerChance: 0.35,
      /* Duas silhuetas vizinhas viram UMA na tela, e aí o jogador atira uma
         flecha achando que resolveu duas. Recusa e sorteia de novo. */
      minSeparation: 6, // m somados aos dois raios
      separationTries: 6,

      /* ---------------------------------------------------------- classes --
         Raios GRANDES de propósito. Com o FOV de 58° e 720 px de tela, a
         pequena entra com 18 px de diâmetro a 200 m; com o raio de 1,2 m que
         este bloco tinha antes, entrava com 8 px — o que não é um meteoro, é
         um artefato de compressão. E não custa triângulo nenhum: o icosaedro
         de `esculpir()` tem 320 faces seja qual for o raio. */
      classes: [
        { raio: 2.5, hits: 1 },
        { raio: 4.0, hits: 2 },
        { raio: 6.0, hits: 3 },
      ],
      /* Composição de cada horda: quantas de cada classe, para UM jogador.
         As hordas 7–10 são mais pesadas do que a rampa sugere porque a rocha
         maior subiu a taxa de acerto — ver `hitRate` no plano. */
      hordeMix: [
        { p: 3, m: 0, g: 0 },
        { p: 4, m: 1, g: 0 },
        { p: 3, m: 1, g: 0 },
        { p: 5, m: 2, g: 0 },
        { p: 5, m: 3, g: 0 },
        { p: 5, m: 2, g: 0 },
        { p: 6, m: 3, g: 1 },
        { p: 6, m: 2, g: 2 },
        { p: 5, m: 3, g: 0 },
        { p: 6, m: 2, g: 2 },
      ],
      /* Segundos entre duas rochas ENTRANDO. É este número, e não o tamanho da
         horda, que decide se ela é jogável. */
      hordeGaps: [7.5, 6.8, 6.4, 6.0, 5.7, 5.5, 5.4, 5.3, 5.2, 5.1],

      /* ------------------------------------------------------ dificuldade --
         Fácil, normal e difícil — e `normal` É A CHUVA DE SEMPRE, com todos os
         multiplicadores em 1,00. Isso não é enfeite de simetria: é o que
         garante que ligar este bloco não muda uma vírgula do modo que já foi
         medido no banco de provas.

         São MULTIPLICADORES sobre as três tabelas acima, e não três cópias
         delas. Cópias envelhecem em separado — mexer na horda 7 do normal e
         esquecer as outras duas é o tipo de erro que só aparece jogando —, e
         além disso as cópias esconderiam a única coisa que o leitor precisa
         saber aqui: quanto cada nível se afasta do centro.

         `mix` é O PEDIDO — menos rochas no fácil, mais no difícil. `gap` vem
         junto porque sem ele o difícil seria só MAIS LONGO: o que aperta neste
         modo é quantas rochas estão no ar ao mesmo tempo, que é `prazo de
         queda ÷ intervalo`, e esse número não sabe quantas rochas a horda tem.

         `fallSpeeds` NÃO ENTRA, e é a decisão que dá coerência ao conjunto: o
         prazo de queda de cada rocha é o mesmo nos três níveis, então a leitura
         e a antecipação que se aprende no fácil valem inteiras no difícil. Muda
         o volume e o ritmo da chuva; não muda a física de mirar nela.

         MEDIDO (`scripts/bench-meteoros.js`, 200 partidas por nível, arqueiro
         de 0,5 tiro/s e 78 % de acerto). Um jogador: 97,5 % de vitórias no
         fácil, 87,5 % no normal, 53 % no difícil — e no difícil a derrota sobe
         com as hordas (7, 8 e 10 são os picos) em vez de se empilhar num ponto
         só, que é o que separa uma rampa de uma parede.

         ------------------------------------------- por que o `tank` é torto

         O colosso não sobe no difícil e desce no fácil, e não é descuido: ele é
         a única parte do modo que `mix` e `gap` NÃO ALCANÇAM — uma rocha só,
         com uma janela de queda fixa —, então cada ponta precisou ser medida
         por si.

         Para CIMA não há espaço. O abate já consome de 75 % a 83 % da janela no
         normal; a 1,20 passa de 99 % e a 1,30 chega a 109 %, ou seja, um
         colosso que um arqueiro sozinho não consegue matar nem acertando tudo.
         Medido: 0 % de vitórias, com 188 das 200 derrotas paradas na horda 3. O
         difícil ficou em 1,00 e a dificuldade dele veio toda da chuva, que é
         justamente o que foi pedido.

         Para BAIXO ele é obrigatório. Com o colosso intocado, o fácil mede
         84,5 % de vitórias contra os 87,5 % do normal — o fácil sairia mais
         DIFÍCIL que o normal, e pelo motivo que a medição deixa à vista: quem
         perde neste modo perde no colosso e na horda 10, e aliviar a chuva não
         toca em nenhum dos dois. A 0,75 o abate cai para 57 %–64 % da janela e
         o nível volta a fazer o que promete. */
      difficulties: {
        easy: { mix: 0.6, gap: 1.25, tank: 0.75 },
        normal: { mix: 1.0, gap: 1.0, tank: 1.0 },
        hard: { mix: 1.45, gap: 0.8, tank: 1.0 },
      },
      /** O nível de sala nova, e o que a porta do lobby entrega. */
      defaultDifficulty: "normal",

      /* ----------------------------------------------------------- tanque --
         Hordas 3, 6, 9 e 10, em SEGUNDO ATO: o céu esvazia e ele desce
         sozinho. Dois prazos simultâneos, um deles pedindo doze acertos, é a
         diferença entre difícil e arbitrário. */
      tankHordes: [3, 6, 9, 10],
      /* O COLOSSO CRESCE A CADA APARIÇÃO, e o da horda 10 é o maior de todos.
       *
       * Um raio só para os quatro fazia da terceira aparição uma repetição da
       * primeira: mesma silhueta, mesma leitura, só mais flechas. Crescendo, o
       * modo ganha de graça uma escada que o jogador lê sem HUD nenhum — ele
       * SABE que aquele é maior que o anterior. O último tem 52 m de diâmetro:
       * a 100 m ele ocupa 29° do campo de visão, ou seja, meia tela de pedra.
       *
       * Custo em triângulo: ZERO. `IcosahedronGeometry(raio, detalhe)` não
       * depende do raio — uma esfera de 26 m tem exatamente as mesmas faces de
       * uma de 14. O que o tamanho custa é preenchimento de pixel, e
       * preenchimento sem sombra é a coisa mais barata do quadro. */
      tankRaio: 14.0, // m — piso, e o que os aquecimentos usam
      tankRaios: { 3: 16.0, 6: 18.5, 9: 21.5, 10: 26.0 }, // Ø 32 / 37 / 43 / 52

      /* --------------------------------------------- de mais longe e mais rápido --
       * O colosso descia a 2,6–4,6 m/s dos mesmos 185 m: setenta segundos de
       * queda para dezoito flechas, ou seja, morria com metade da janela ainda
       * por gastar. O que se via era uma pedra enorme parada no céu enquanto
       * todo mundo já tinha acabado o trabalho — o segundo ato virava espera.
       *
       * Ele nasce mais alto (260 m, contra 185 das comuns) e desce quase o
       * dobro mais rápido. A janela ENCURTA — 32 a 46 s, contra 40 a 71 — e a
       * vida sobe junto, de forma que o abate caia perto do fim dela e não na
       * metade. Ver `tankHits` abaixo para a conta.
       *
       * 260 m e não mais: a flecha lunar se apaga a 300 m de altitude
       * (`levels.moon.arrow.maxAltitude`), e um colosso acima desse teto seria
       * um alvo que o jogo desenha e não deixa acertar. */
      tankAltitude: 260, // m
      /* A ENTRADA DELE É MAIS EM PÉ que a das comuns (43°–53° contra 53°–61°).
         Com o mesmo ângulo delas, 260 m de altitude o jogariam a 470 m ao lado
         da base — longe demais para ser ameaça e para ser alvo. Assim ele entra
         de 242 a 345 m, que é a mesma faixa das outras rochas, e ganha os 75 m
         extras em ALTURA, que é onde eles se veem. */
      tankTiltMin: 0.75, // rad (43°)
      tankTiltMax: 0.92, // rad (53°)
      /* MEDIDO no banco de provas, não estimado. A primeira tentativa punha
         8,0 a 5,6 m/s e reprovava: 12,5 % de vitórias, com a derrota toda
         empilhada na horda 10 — porque lá a chuva NÃO PARA durante o colosso
         (`tankDrizzleFrom`) e cada pedra pingada rouba uns dois segundos de
         tiro dele. A janela do último precisa pagar esse pedágio. */
      tankSpeeds: { 3: 7.2, 6: 6.4, 9: 5.6, 10: 4.4 }, // m/s ⇒ 36 / 41 / 46 / 59 s

      /* Contra um alvo de 32 a 52 m de diâmetro ninguém erra: a capacidade real
         é ~0,475 acertos/s por arqueiro (0,5 tiros/s × 95 %), e não os 0,40 que
         a chuva usa. Com esta vida o abate consome de 68 % a 86 % da janela —
         ou seja, ele morre quando já está grande na tela, que era o pedido. */
      tankHits: { 3: 14, 6: 16, 9: 18, 10: 21 }, // para UM jogador
      /* Só na horda 10 a chuva não para durante o colosso. É o clímax. */
      tankDrizzleFrom: 10,
      tankDrizzleEvery: 15, // s

      /* ------------------------------------------------------------ escala --
         A chuva escala a 0,70 por jogador extra porque duas pessoas mirando na
         mesma pedra pequena desperdiçam uma flecha. O TANQUE escala a 1,00:
         nele nenhuma flecha é desperdiçada, então não há perda a compensar.
         Acima de seis arqueiros o céu vira parede — daí o teto. */
      /* MEDIDO (`scripts/bench-meteoros.js`, 4 jogadores): a 0,70 o quarteto
         vencia 100 % das partidas com margens de 14 a 22 s — passeio. O 0,70
         partia da ideia de que boa parte das flechas do grupo se perderia em
         pedras já mortas; o piscar do acerto (`S2C.METEOR_HIT`) resolve isso
         melhor do que eu supus, e a folga que ele devolveu tinha de voltar
         para a horda. */
      playerScale: 0.88,
      playerScaleMax: 6,
      tankPlayerScale: 1.0,
      maxAlive: 16,
      maxEntities: 24,

      /* ---------------------------------------------------------- jogador --
         Não existe coleira aqui (o `safeRadius` do zumbi). Lá fugir DERROTA o
         modo; aqui fugir não salva ninguém — a rocha cai na base de qualquer
         jeito. O único efeito é encompridar os próprios tiros. */
      spawnRingMin: 20, // m do centro da base
      spawnRingMax: 30,
      invulnerability: 2.5, // s ao entrar ou renascer
      botRingMin: 35, // m — os bots ficam no anel externo (ver plano §4.7)
      botRingMax: 45,
      /* Elevação máxima que o bot aceita engajar.
         Eram 68°, e o motivo desapareceu: `elevacaoPara` degenerava com o alvo
         a pino porque iterava o tempo de voo sobre a distância HORIZONTAL, que
         tende a zero junto com o cosseno. Reescrita pela distância INCLINADA
         (mesma álgebra, sem o 0/0), ela responde certo em qualquer ângulo, e o
         filtro pode subir até perto do `pitchMax` de 86° — o que devolve ao bot
         a metade do céu que ele recusava. A folga que sobra é para a liderança,
         que sempre mira um pouco além de onde a rocha está. */
      botMaxElevation: 1.36, // rad (78°)

      /* ------------------------------------------------------------ pontos -- */
      points: { 1: 60, 2: 140, 3: 240, tank: 60 }, // por flecha, no tanque

      /* ------------------------------------------------------------ estouro --
         O número e o tamanho dos estilhaços saem do RAIO da rocha: uma pedra
         de 12 m que se parte em dezesseis cascalhos do tamanho de sempre lê
         como uma pedra pequena que explodiu perto.

         E eles NÃO MATAM. É a diferença essencial para o meteorito da Lua
         livre: aqui a rocha estourada é uma VITÓRIA, e uma vitória que às
         vezes mata quem venceu é punição por jogar bem. O servidor nem integra
         os pedaços — manda a semente e o cliente desenha. */
      burst: {
        fragPerRadius: 3.0, // pedaços por metro de raio
        fragCountMax: 36,
        fragRaioMin: 0.06, // × raio da rocha
        fragRaioMax: 0.16,
        fragSpeedMin: 6, // m/s
        fragSpeedMax: 17,
        fragKillSpeed: 3.5, // só decide quando ele ASSENTA (não mata ninguém)
        fragRestitution: 0.3,
        fragSettleTime: 25.0, // s no chão — o cascalho ACUMULA
        fragFadeTime: 2.0,
        debrisMax: 60, // teto do lote instanciado
        explosionRadius: 0, // não mata: a rocha morreu, não explodiu em cima
      },

      /* ------------------------------------------------------------ lascas --
         Cada FLECHADA arranca pedaços em brasa que NÃO caem: eles passam a
         acompanhar a rocha, girando em volta dela até a explosão final.

         Isso não é enfeite, é a barra de vida do modo. O escurecimento da rocha
         (`hp` → `emissiveIntensity`) já dizia "esta apanhou", mas só de perto e
         só para quem soubesse comparar. Uma nuvem de brasas em volta é legível
         a duzentos metros e CONTÁVEL: três lascas girando é a rocha que já
         levou três flechas, e num co-op isso é o que impede duas pessoas de
         gastarem tiro na mesma pedra.

         Sem colisão nenhuma — nem corpo, nem raio de morte. Elas são imagem, e
         imagem que mata é o que o `burst` acima já recusou por escrito.

         O teto de 90 é do LOTE INTEIRO, não por rocha, e é o que segura o
         colosso: quarenta flechadas dariam quinhentas lascas, então as velhas
         são recicladas e ele acaba usando uma coroa estável de escombros — que
         é exatamente a imagem que se quer dele. */
      /* O QUE ELAS ERAM, E POR QUE NÃO SE VIAM.
       *
       * Estavam implementadas e corretas, e ainda assim ninguém as via. Duas
       * contas explicam o sumiço, e as duas foram consertadas aqui:
       *
       * 1. **TAMANHO.** 0,05 a 0,12 do raio dá lascas de 12 a 30 cm na pedra
       *    pequena. A tela tem 720 px num campo de 58°, ou seja ~0,28 m por
       *    pixel a 200 m: a lasca entrava com MEIO PIXEL. Não é uma questão de
       *    contraste, é de não existir na grade de amostragem.
       *
       * 2. **ELAS ORBITAVAM DENTRO DO HALO.** O `haloScale` é 2,2 × o
       *    DIÂMETRO, ou seja, o sprite aditivo da rocha se estende a 2,2 raios
       *    do centro — e a órbita ia de 1,3 a 2,0 raios. Cada lasca ficava
       *    submersa no clarão laranja que a própria rocha emite, que é o pior
       *    fundo possível para uma brasa laranja. Fora do halo elas aparecem
       *    contra o preto do céu, que é o que as torna contáveis.
       *
       * O piso ABSOLUTO em metros é o que faz a regra valer para a pedra de
       * 2,5 m tanto quanto para o colosso de 14: uma fração sozinha sempre
       * some no menor caso, que é justamente o mais comum. */
      chips: {
        perRadius: 1.25, // lascas por metro de raio, a cada flechada
        perHitMin: 4,
        perHitMax: 12,
        max: 90, // teto do lote instanciado — de TODAS as rochas somadas
        raioMin: 0.11, // × raio da rocha
        raioMax: 0.2,
        /* Piso e teto em METROS. Sem o piso, a lasca da pedra pequena tem meio
           pixel a 200 m; sem o teto, a do colosso teria três metros e leria
           como uma segunda rocha em vez de um pedaço da primeira. */
        raioMinAbs: 0.62, // m
        raioMaxAbs: 1.7, // m
        /* Distância da órbita, × raio da rocha. O mínimo é > `haloScale`
           (2,2): dentro dele a lasca some dentro do clarão da própria rocha,
           que era metade do defeito. */
        orbitMin: 2.4,
        orbitMax: 3.1,
        orbitDrift: 0.14, // × raio por segundo — a coroa ABRE devagar
        orbitMaxScale: 4.2, // × raio — até onde a deriva abre antes de parar
        spinMin: 0.55, // rad/s em volta da rocha
        spinMax: 1.7,
        tumbleMax: 2.6, // rad/s do giro da própria lasca
        tiltMax: 1.0, // rad — inclinação do plano de órbita (não é um anel)
      },

      /* ------------------------------------------------------------ imagem --
         Zero luzes dinâmicas: dezesseis `PointLight` seriam dezesseis
         recompilações de material. O brilho é emissivo + bloom + halo aditivo,
         e é o halo que segura a leitura no preset `low`, que não tem bloom. */
      coreColor: 0xfff2c4,
      fireColor: 0xff8a2a,
      glowColor: 0xff5a1e,
      haloScale: 2.2, // × o diâmetro da rocha
      trailInterval: 0.045, // s entre sopros de fogo
      trailLife: 1.1, // s
      spin: 0.55, // rad/s de tombo
      /* A mancha no chão: onde vai cair, acendendo conforme desce. Faz o
         impacto ser JUSTO (ninguém morre sem ter tido onde ler o aviso) e é
         metade do espetáculo. Uma chamada de desenho, nenhuma luz. */
      markRadius: 1.6, // × o raio da rocha
      markMinAlpha: 0.12,
      markMaxAlpha: 0.75,

      /* ------------------------------------------------------------ alerta -- */
      warnAltitude: 60, // m — borda da tela pulsa
      dangerAltitude: 25, // m — pulso contínuo + bipe

      /* ------------------------------------------------------------ aliens --
         Secundários, e o config diz isso sozinho. Morrer para um alien não
         encerra a partida: ele te tira ~5 s de céu, e cinco segundos na horda 9
         são duas rochas que ninguém estourou. A punição é medida na moeda do
         modo, sem uma linha de regra para isso. */
      alien: {
        maxAlive: 2,
        spawnMin: 55, // s
        spawnMax: 95,
        fromHorde: 3, // antes disso, nenhum
      },
    },

    /* ------------------------------------------------------------- cerco --
       O castelo sitiado. Ver `docs/plano-cerco.md`.

       A ideia que organiza TODOS os números abaixo: **a derrota é uma fila,
       não um erro**. O portão não cai porque alguém errou um tiro; cai porque,
       durante algumas dezenas de segundos, chegou mais gente na base dele do
       que saiu. Por isso o número que manda não é vida de bicho nem dano de
       flecha — é `gapBase`, o intervalo entre duas CHEGADAS ao portão.

       E é a terceira vez que este projeto escreve a mesma linha: o ritmo é
       agendado pela chegada, nunca pelo nascimento. Ver `hordeArrivalGaps` no
       modo zumbi e `hordeGaps` na chuva, que aprenderam isso na marra. */
    siege: {
      /* ------------------------------------------------------------ prazo --
         DEZ minutos até o Sol tocar o horizonte.

         Eram vinte, e vinte é longo demais para um modo cuja tensão é uma
         curva que só sobe: o meio da partida virava planalto — o jogador já
         tinha aprendido tudo e ainda faltavam oito minutos de mais do mesmo.
         Com dez, cada escalão entra enquanto o anterior ainda é novidade. Todos os outros modos deste
         jogo terminam e têm tela de vitória; sobrevivência sem fim seria uma
         tabela de recordes, que é um modo legítimo e não é este.

         Este número é DUPLO: ele é o prazo da partida e é o percurso do Sol.
         `Game.updateDusk` divide o relógio do cerco por ele, então mexer aqui
         muda a hora do dia junto — e é assim que tem de ser, porque a luz é o
         cronômetro que o jogador realmente lê. */
      duration: 10 * 60, // s
      /** Dez segundos antes do primeiro inimigo sair da linha de árvores.
          Quem acabou de sair de uma tela de carregamento não sabe para onde
          está olhando. Mesmo motivo do `startDelay` da chuva. */
      startDelay: 10, // s
      /** Modo infinito: a curva continua caindo depois do pôr do sol. */
      endless: false,

      /* ----------------------------------------------------------- pressão --
         Segundos entre duas CHEGADAS ao portão, um ponto por minuto de
         partida. Interpolado linearmente entre os pontos.

         Tabela, e não fórmula, pelo motivo de sempre: é a tabela que o banco
         de provas (`scripts/bench-cerco.js`) consegue corrigir num ponto só,
         sem reescrever a curva inteira.

         DE ONDE SAI O 7,0 DO COMEÇO. A primeira tabela abria em 4,5 s e dava
         **0 % de vitórias**, com a derrota mediana no minuto 3,6. O erro não
         era de balanceamento fino: 4,5 s já era mais rápido do que um arco
         consegue matar. Um soldado pede 2 acertos; a 0,5 tiro/s e 78 % de
         acerto são 5,1 s por abate — a curva nascia acima da capacidade do
         jogador e nenhuma habilidade fechava a conta.

         Hoje ela abre com folga e cruza a capacidade do arco por volta do
         minuto 8. Esse cruzamento É o desenho: até ali o arco basta, e a
         partir dali a diferença tem de vir do trabuco. Um modo em que o arco
         nunca deixa de bastar não precisaria de trabuco nenhum. */
      /* Onze pontos, um por minuto. É a MESMA curva de vinte minutos,
         reamostrada: o que era o minuto 2 virou o 1, o que era o 20 virou o 10.
         A forma foi preservada de propósito — ela é o que o banco de provas
         mediu, e reamostrar não invalida a medição; encurtar mudando o formato
         invalidaria. */
      /* Encolhida 22 % em bloco quando o TIRO NA CABEÇA passou a matar de
         primeira. A conta é direta: com 18 % dos acertos virando abate
         instantâneo, o arco ficou ~35 % mais rápido, e uma curva calibrada
         contra o arco antigo mede um jogo que não existe mais. Medido: com a
         curva antiga, três defensores venciam 100 % das partidas SEM TRABUCO —
         ou seja, a arma que o modo inteiro existe para justificar tinha virado
         enfeite. A forma foi preservada; só o eixo do tempo apertou. */
      /* APERTADA 22 % EM BLOCO quando a horda passou a nascer na floresta.
         (Ver `Siege.nascer` e `Siege.start`.)

         O motivo é uma conta de EXPOSIÇÃO, e ela foi medida. Antes, 30 % dos
         sitiantes nasciam abaixo de z = 60 — passado o meio da ponte, e alguns
         a um passo do portão: a fila de chegadas escolhia a espécie ANTES de
         saber a hora do nascimento, e quem calhava de ser mais lento que a
         média nascia com o percurso já andado. Isso era o defeito visual
         relatado ("eles surgem no meio da ponte") e era, sem que ninguém
         tivesse escrito, um terço da dificuldade do modo: um terço da horda
         atravessava a rampa sem passar pelo campo de tiro.

         Corrigido o nascimento, cada sitiante passa até oitenta segundos a
         mais sob flecha, e o banco de provas mediu o tamanho do estrago: o
         defensor solitário saltou de 0 % para 85 % de vitórias. A forma da
         curva foi preservada — ela é o que o banco aprovou —, e só o eixo
         apertou.

         ISTO NÃO FECHA A CONTA SOZINHO, e é de propósito. A compensação cheia
         que o banco pede (×0,45) põe mais gente na rampa do que o teto de
         entidades aguenta, e mediria um jogo que não existe: o mesmo lote de
         mudanças acrescenta ao modo três ameaças que o banco não modela — os
         magos das torres, os morcegos e o escalador que agora caça pelo adarve
         —, e cada morte de defensor custa onze segundos e meio sem arco. O
         resto do ajuste é playtest, que é o juiz final. */
      /* A CURVA GIROU EM TORNO DO MEIO: a abertura subiu, o fim desceu.
       *
       * As duas metades tinham defeitos opostos, e medidos em jogo:
       *
       * • A ABERTURA ERA VAZIA. Com um soldado a cada 4,3 s (e depois 3,3), a
       *   primeira leva mal enchia a rampa — um arqueiro sozinho resolvia com
       *   meio arco e sobrava tempo para olhar a paisagem. Um modo cuja tensão
       *   é uma rampa não pode começar em patamar: o primeiro minuto é
       *   justamente onde o jogador decide se aquilo vai exigir algo dele.
       *   Agora a coluna sai do bosque com volume desde o começo.
       *
       * • O FIM ERA IMPOSSÍVEL. Um humano com dois bots perdia perto dos cinco
       *   minutos, ou seja, no ponto em que a curva atravessava 1,8 s — e não
       *   chegava perto de ver o pôr do sol, que é a única coisa que o modo
       *   promete. Os cinco últimos pontos afrouxaram de 20 a 28 %.
       *
       * O que continua valendo: a curva SÓ SOBE, e o clímax continua sendo o
       * clímax (1,35 s no fim contra 2,6 no começo é o dobro de pressão). O que
       * mudou foi a inclinação — ela ficou mais suave, e cobre mais partida. */
      /* MEDIDO: 2,6 no primeiro ponto reprovava. Ele põe a chegada em 0,385/s,
         que é exatamente a capacidade de um arqueiro médio (0,39 acertos/s) —
         ou seja, a fila nasce em ponto de equilíbrio e nunca drena, e o banco
         acusa "curva errada" com razão. 2,9 dá volume de verdade à abertura
         (era 4,3 antes deste lote) e ainda deixa a margem que a rampa precisa
         para o jogador aprender a leitura dela. */
      /* REANCORADA NO DEFENSOR SOZINHO — ×2,15 em bloco, forma intacta.
       *
       * A tabela sempre descreveu, no papel, o cerco de UM defensor. Na prática
       * descrevia o de três: a sala forçava dois bots na entrada do modo, e a
       * curva foi calibrada contra essa sala. Media-se, portanto, `gapBase`
       * vezes `0,85² = 0,72`, e o número escrito aqui nunca era jogado por
       * ninguém. O preço disso estava medido no banco de provas e era o pior
       * possível: um defensor sozinho perdia 40 de 40 partidas, sempre por volta
       * do minuto 4,6 — ou seja, a curva "de um jogador" era uma sentença de
       * morte para um jogador.
       *
       * Com os bots deixando de ser obrigatórios (ver `Room.setMode`), a tabela
       * passa a ser lida como sempre esteve escrita, e por isso teve de virar de
       * verdade a curva de um. São DOIS multiplicadores em bloco, nesta ordem, e
       * a tabela de hoje é ×2,02 da que existia antes deles:
       *
       * • ×2,15 — a REANCORAGEM. Punha o solitário em ~82 %, e foi escolhido
       *   para o encontro com a calibragem antiga cair em N = 3, que era a única
       *   sala que existia: `2,15 / 3^1,05 = 0,68` contra os `0,85² = 0,72` de
       *   então. Quem jogava com dois bots continuou jogando a mesma partida.
       * • ×0,94 — o APERTO. Os ~82 % estavam no teto da faixa que o próprio
       *   banco chama de certa (60 a 90 %), e um modo que se apresenta como
       *   "dez minutos de muralha" não deveria ser vencido em quatro de cada
       *   cinco tentativas. Hoje o solitário mede 59,2 % em 250 partidas — o
       *   meio da faixa —, com 0 % das derrotas antes do minuto 6 e a mediana
       *   delas no 9,3. A partida inteira acontece, e o que decide é o clímax.
       *
       * A FORMA NUNCA MUDOU, e isso importa mais que os fatores: é a forma que
       * os lotes anteriores mediram, e multiplicar em bloco preserva todas
       * aquelas medições.
       *
       * QUEM FOR REAJUSTAR ISTO PRECISA DE CORRIDAS LONGAS. Uma configuração
       * anterior devolveu de 75 % a 88 % em corridas de 100 a 300 partidas — a
       * dispersão é maior que a de uma binomial porque o acaso do cerco é
       * correlacionado dentro da partida: o sorteio de espécies e a fase da maré
       * valem para os dez minutos inteiros, não para cada chegada em separado.
       * Cem partidas distinguem 25 % de 80 %; não distinguem 55 % de 65 %. */
      gapBase: [
        5.85, 5.65, 5.45, 5.05, 4.65, 4.3, 4.05, 3.75, 3.45, 3.15, 2.8,
      ],
      /* UM ARCO A MAIS É UMA COTA A MAIS DE CERCO: `gap = base / N^exp`.
       *
       * Era um fator geométrico (`0,85^(N−1)`), e o defeito dele era de ORDEM
       * DE GRANDEZA, não de ajuste: três defensores triplicam a capacidade de
       * abate e recebiam ×1,38 de pressão. O resultado, medido, é que cada
       * reforço deixava o cerco MAIS FÁCIL — do 0 % do solitário para 100 % com
       * três, sem nenhum degrau no meio. Não havia curva capaz de servir às duas
       * pontas ao mesmo tempo, e é por isso que o modo precisava dos bots
       * obrigatórios para ser jogável: eles não eram ajuda, eram a calibragem.
       *
       * A ÂNCORA SERIA 1: a capacidade de abate é LINEAR no número de
       * defensores — cada um é um arco, e matar não se divide. Ela é 1,18
       * porque a capacidade de uma GUARNIÇÃO não é a soma dos arcos dela, e a
       * diferença foi medida em duas frentes:
       *
       * • O TRABUCO MELHORA COM A MULTIDÃO. Ele acha aglomerados muito
       *   melhores numa rampa cheia — 21 % da vazão com um defensor, 40 % com
       *   quatro. É vazão que aparece sem que ninguém tenha atirado uma flecha
       *   a mais.
       * • A MANIVELA NÃO ENCARECE. Uma pessoa içando serve os três engenhos,
       *   custe ela um quinto da sala ou a metade dela.
       *
       * Somadas, faziam o cerco AFROUXAR com gente: em 1,05 a sala de três
       * media 97 % e a de quatro 100 %, contra ~82 % do solitário. Ou seja, o
       * modo cooperativo era mais fácil quanto mais gente cooperasse, que é o
       * contrário do que ele promete.
       *
       * 1,18 É UM MEIO-TERMO MEDIDO, e os dois lados dele estão registrados:
       * em 1,15 a sala de três cai para 61 % (o alvo) mas a de quatro fica em
       * 87 %; em 1,20 a de quatro chega aos 60 % e a de três desaba para 31 %.
       * Não há expoente que acerte as duas, porque o degrau entre elas é do
       * banco, não do jogo — é ali que o modelo passa a descontar um arqueiro
       * inteiro para a manivela. Fica no meio, e o que sobra de erro fica
       * documentado em `docs/plano-cerco.md` §4.1.1.
       *
       * ELE VALE PARA OS TRÊS NÍVEIS, e é de propósito: a lei de N é UMA, e o
       * que separa fácil de difícil é quanto o cerco pesa por defensor, não o
       * formato da curva. O difícil já teve expoente próprio (1,15) enquanto a
       * âncora era 1,05, e era remendo — hoje a âncora faz o trabalho para
       * todos, e um nível a menos tem número para desafinar. */
      playerGapExp: 1.18,

      /* ------------------------------------------------------ dificuldade --
         Fácil, normal e difícil — e `normal` É O CERCO DE SEMPRE, com os dois
         multiplicadores em 1,00. Mesma regra da chuva de meteoros: ligar este
         bloco não muda uma vírgula do que o banco de provas já mediu.

         MULTIPLICADORES, e não três cópias das tabelas. Cópias envelhecem em
         separado, e além disso escondem a única coisa que o leitor precisa ver
         aqui: quanto cada nível se afasta do centro.

         Eles MULTIPLICAM a escala por defensor, não a substituem (ver
         `Siege.escalaDoRitmo`), e é isso que faz os três níveis serem
         proporcionais ao número de jogadores sem nenhuma tabela a mais: o
         difícil de quatro pessoas é quatro vezes o difícil de uma.

         --------------------------------------------------- por que DOIS botões

         `gap` é o pedido — o intervalo entre duas chegadas ao portão, que é a
         pressão do modo inteiro. Se fosse o único, porém, os três níveis seriam
         INVISÍVEIS: a curva é tão sensível que 13 % de aperto leva a vitória de
         75 % para 25 %, e 13 % é coisa que ninguém enxerga na rampa. Ninguém
         conta os segundos entre dois soldados saindo do bosque.

         `gate` é o mostrador do nível. A madeira cedendo mais cedo se vê, se
         ouve e muda o que a pessoa faz com o tempo dela — é a diferença entre
         "está mais difícil" e "não sei por que perdi". Ele também é o que
         mantém o difícil difícil na sala cheia: `gap` divide a pressão entre os
         defensores, mas a vida do portão é uma só, e é ela que impede quatro
         arqueiros de transformarem qualquer nível em passeio.

         O QUE NÃO ENTRA, e é a decisão que dá coerência ao conjunto: a
         composição da horda, os escalões, a velocidade de quem sobe a rampa e o
         dano de cada espécie. Um soldado é um soldado nos três níveis, e as
         duas flechas que ele custa são as mesmas — a leitura que se aprende no
         fácil vale inteira no difícil. Muda o volume e a margem; não muda o que
         se está olhando.

         --------------------------------------------- nenhum deles tem `exp`

         `exp` existe (`Siege.escalaDeDefensores` ainda o lê) e nenhum dos três
         o usa. Ele foi de um nível só — o difícil — enquanto `playerGapExp`
         valia 1,05 e o cerco AFROUXAVA com gente: o difícil precisava da
         inclinação própria para não virar passeio na sala cheia, e os outros
         dois viviam com o defeito. Corrigida a âncora, a lei de N passou a
         servir aos três, e o campo ficou como porta de saída para um nível
         futuro que precise de outro formato — não como remendo em uso.

         --------------------------------------------------------- MEDIDO

         `scripts/bench-cerco.js --tabela`, arqueiro de 0,5 tiro/s e 78 % de
         acerto. A tabela completa está em `docs/plano-cerco.md` §4.1.1, com o
         que cada coluna vale — o banco não mede as quatro iguais, e a de dois
         defensores é a que ele mede pior.

         OS MULTIPLICADORES DE FÁCIL E DIFÍCIL FORAM RECOMPENSADOS quando
         `gapBase` apertou 6 %: 1,08 virou 1,15 e 0,90 virou 0,96, que é a mesma
         curva absoluta dividida pela nova tabela. Sem isso, apertar o normal
         teria arrastado os outros dois junto, e o difícil — que estava no alvo
         de 20 a 30 % — sairia dele sem ninguém ter pedido. */
      difficulties: {
        easy: { gap: 1.15, gate: 1.15 },
        normal: { gap: 1.0, gate: 1.0 },
        hard: { gap: 0.96, gate: 0.65 },
      },
      /** O nível de sala nova, e o que a porta do lobby entrega. */
      defaultDifficulty: "normal",

      /* -------------------------------------------------------- a abertura --
         A COLUNA DO PRIMEIRO MINUTO. Ver `Siege.enfileirarAbertura`.

         O modo continua sem ondas: isto não é uma horda com pausa depois, é o
         começo da mesma taxa contínua, apertado. Ele existe porque a curva tem
         um problema que só aparece no começo — a rampa leva uma travessia
         inteira (84 s) para encher, e durante essa travessia `gapBase` está no
         ponto mais frouxo de toda a partida. As duas coisas se somam no pior
         lugar possível: os primeiros noventa segundos, que são justamente onde
         o jogador decide se aquilo vai exigir algo dele.

         DEZOITO, a 1,5 s. São 27 s de coluna saindo do bosque e 27 s de chegada
         ao portão — pressão de meados do minuto 7 (`gapBase` cruza 1,5 s por
         ali), aplicada no minuto 1,4 e só com soldados.

         A conta que a torna justa é a rampa: dezoito soldados a 1,15 m/s ficam
         84 s sob flecha antes de encostar na madeira, e um arqueiro médio (0,39
         abates/s) derruba trinta e três nesse tempo. Ou seja, a coluna inteira
         cabe com folga — DESDE QUE se atire nela. Quem passar a abertura
         olhando a paisagem recebe os dezoito no portão de uma vez, que é
         exatamente a lição que a fase quer ensinar no primeiro minuto em vez de
         no oitavo. */
      /* O PASSO É POR DEFENSOR, como o resto da curva (ver `playerGapExp` e
         `Siege.enfileirarAbertura`): 3,2 s é a coluna de um, e a sala de três a
         recebe a 1,07 s. Sem isto a abertura era a única parte do cerco que
         ignorava quem estava no muro — dezoito chegadas a 1,5 s, calibradas
         para três arqueiros, desabando sobre um. Era o pior lugar possível para
         essa conta estar errada: são os primeiros noventa segundos, e um
         defensor sozinho matava seis dos dezoito antes do portão. Os outros
         doze já chegavam encostados na madeira, e a partida estava decidida
         antes de o primeiro escalão sair.

         A CONTAGEM não escala junto, e é de propósito: dezoito é o que faz a
         coluna ser uma coluna, e ela é a primeira coisa que o jogador vê. O que
         muda é o passo — sozinho, o mesmo desfile leva o dobro do tempo. */
      opening: {
        count: 18,
        gap: 3.0, // s entre duas chegadas da coluna, POR DEFENSOR
        kind: "soldier",
      },

      /* -------------------------------------------------------------- maré --
         O que substitui a pausa entre ondas. Sem onda não há pausa, e sem
         pausa ninguém larga o arco para içar o contrapeso ou reparar o portão.

         62 s é escolhido contra o relógio do trabuco: a vazante dura ~16 s, o
         que continua acima dos 14 s de içamento automático — dá para recarregar
         um engenho por maré sem ninguém na manivela, e os três com ela.
         Encurtou junto com a partida: em dez minutos, uma maré de 78 s daria
         só sete respiros, e o primeiro cairia antes de a pressão existir. */
      tidePeriod: 62, // s
      tideDepth: 0.32, // ±32 % no intervalo de chegada
      /** Depois disto a maré para de vazar: é o clímax, e ele não afrouxa. */
      tideEndsAt: 9 * 60, // s

      /* ------------------------------------------------------------ campo --
         Onde eles saem e por onde sobem. A rampa do `castleField` vai de
         z = +9 (portão) a z = +99 (pé), e a linha de árvores fica logo atrás. */
      spawnZ: 106, // m
      spawnZJitter: 14, // m
      spawnHalfX: 15, // m — dentro do corredor da rampa
      /** Alvo padrão: a face externa do portão. */
      gateApproach: 0.6, // m à frente da folha

      /* ------------------------------------------------------------ portão --
         1 200 de vida contra um teto de 30 de dano por segundo (6 soldados de
         frente, ver `gateSlots`) dão 40 s de um portão totalmente ignorado.
         É curto DE PROPÓSITO: se ignorar o portão por quarenta segundos não
         perdesse a partida, a fila não seria ameaça e o modo não teria tensão. */
      gateHealth: 2400,
      /* DEZ BATENDO AO MESMO TEMPO, em duas fileiras de cinco.
       *
       * Eram seis, lado a lado no vão de 6 m, e o sétimo esperava. Visto do
       * muro, aquilo dava meia dúzia encostada na porta e o resto da horda numa
       * COLUNA descendo a rampa — uma fila indiana, não um cerco.
       *
       * A segunda fileira alcança a madeira por cima do ombro da primeira (ver
       * `Siege.postoDaVaga`), que é o que uma turba usando o corpo como aríete
       * faz de verdade. O dano por segundo no portão dobra junto, e isso é
       * intencional: o modo ficou mais fácil quando a horda passou a nascer na
       * floresta (ver `gapBase`), e este é o lado da conta que devolve pressão
       * onde ela é sentida — no portão, e não no tamanho da fila. */
      gateSlots: 10,
      gatePerRank: 5,
      /* O leque de quem espera. `gateRingFirst` é a largura do primeiro anel e
         cada anel seguinte cabe dois a mais; `gateSpread` é a meia-abertura em
         radianos (1,15 ≈ 66° para cada lado da boca do portão). */
      gateRingFirst: 9,
      gateSpread: 1.35, // rad
      /** Reparo: vence dois soldados (10/s) e perde para três (15/s).
          Remendo, nunca solução — a solução continua sendo matar antes. */
      repairRate: 12, // vida/s
      repairCap: 0.8, // fração máxima que o reparo alcança
      repairRadius: 4.5, // m — do lado de DENTRO do portão
      /** Estados visíveis do portão, em fração de vida. */
      gateStages: [0.66, 0.33],

      /* ------------------------------------------------------------ espécies --
         `arrows` é vida em flechas de corpo (a de cabeça vale 2, como no
         zumbi). `dps` sai de `damage / interval` e é o que a fila multiplica. */
      species: {
        soldier: { arrows: 2, speed: 1.15, damage: 8, interval: 1.6, points: 40 },
        shielded: { arrows: 3, speed: 1.0, damage: 8, interval: 1.6, points: 60 },
        skeleton: { arrows: 1, speed: 2.4, damage: 5, interval: 1.2, points: 30 },
        /* O escalador não faz dano NENHUM ao portão: o alvo dele é você.
           O mastim faz pouco — ele não está ali para derrubar o portão, está
           para chegar 60 s antes do resto e obrigar a largar a mira do que
           está à frente. É o mesmo papel (e a mesma velocidade) do lobo na
           horda zumbi; ver `wolfCounts` e o comentário ao lado. */
        climber: { arrows: 2, speed: 2.0, damage: 0, interval: 1.2, points: 70 },
        hound: { arrows: 1, speed: 6.7, damage: 4, interval: 1.0, points: 60 },
        /* O INTERVALO DOBROU (3,4 → 7,0 s) no mesmo lote em que a bola dele
           passou a matar. Uma bola a cada três segundos e meio era aceitável
           enquanto ela era enfeite; letal, e com três xamãs em campo
           (`shamanMax`), seria uma bola a cada segundo caindo no adarve — o
           defensor não teria janela para nada além de desviar. */
        shaman: { arrows: 3, speed: 0.9, damage: 0, interval: 7.0, points: 120 },
        ogre: { arrows: 16, speed: 0.9, damage: 45, interval: 3.2, points: 400 },
        catapult: { arrows: 14, speed: 0, damage: 0, interval: 9, points: 200 },
      },

      /* ------------------------------------------------------- o esqueleto --
         Remonta UMA vez, e só se não tiver queimado. É o que cria a demanda
         por fogo antes de o trabuco parecer necessário — e o que impede o modo
         de ser resolvido só com flecha. */
      skeletonRise: 4.0, // s caído antes de levantar
      /* --------------------------------------------------------- escalador --
         Sobe o muro em 6 s. Acaba com a hipótese de que lá em cima é seguro,
         que é a única coisa capaz de fazer o jogador olhar para trás. */
      climbTime: 6.0, // s
      climbReach: 1.4, // m — alcance do golpe dele no adarve
      /* ------------------------------------------------------------- xamã --
         Para a 70 m e remonta esqueleto num raio de 12 m. Alvo de valor que
         castiga quem só olha para o portão. */
      shamanStandoff: 70, // m
      shamanRaiseRadius: 12, // m
      /* MAIS LENTA, e agora ela MATA (ver `Siege.atualizarUm`).
       *
       * Os 34 m/s vinham de quando a bola era enfeite: a 70 m ela chegava em
       * dois segundos, e como não fazia nada, a velocidade não custava nada.
       * Com consequência, a velocidade É a justiça do golpe — o dano é aplicado
       * onde a bola cai, não em quem foi mirado, então o tempo de voo é
       * literalmente a janela para sair do lugar. A 20 m/s ela leva 3,5 s para
       * cruzar os 70 m: dá para ver, entender e andar dois passos.
       *
       * (Ainda é mais rápida que a do mirante, que faz 18 m/s de 95 m — lá a
       * janela sai da distância; aqui, da velocidade.) */
      /* 14 e não 20: a bola passou a ser ABATÍVEL a flecha, e um alvo que
         cruza setenta metros em três segundos e meio não dá tempo de tensionar
         o arco (o ciclo de tiro é ~2,4 s). A cinco segundos de voo a escolha
         "desvio ou atiro nela?" passa a existir de verdade — e é ela que
         transforma o xamã na disputa que ele deve ser. */
      shamanBolt: { speed: 14, damage: 1 },
      /* ------------------------------------------------ magos das torres --
         Dois xamãs em mirantes de madeira no pé da rampa (ver `mageTowers` em
         `shared/castleProps.js`). Eles não andam, não têm escalão e não entram
         no sorteio: estão lá desde o primeiro segundo, e a bola deles MATA.

         O intervalo é longo de propósito. Eles não existem para somar dano —
         existem para cobrar ATENÇÃO: enquanto uma torre estiver de pé, olhar
         só para o portão custa a vida. Uma bola a cada seis segundos é tempo de
         sobra para ver de onde ela veio, sair do lugar e decidir se vale gastar
         uma flecha a noventa metros.

         A bola é LENTA (18 m/s contra os 34 do xamã de chão): ela atravessa
         noventa metros em cinco segundos, e é essa demora que a torna evitável
         — quem se mexe escapa, e quem não viu, morre. Uma bola rápida seria um
         tiro teleguiado, que é o que a catapulta já foi ensinada a não ser.

         `mageRespawn` é o prêmio de acertar: meio minuto de torre calada. */
      /* MEDIDO EM TELA: seis segundos era a cadência de uma arma, não de uma
         ameaça de fundo. Com dois mirantes, saía uma bola a cada três segundos
         em média — o defensor passava a partida se desviando e a rampa, que é
         o assunto do modo, virava o que se olhava nos intervalos. Dezoito
         segundos por mago dão uma bola a cada nove: tempo de esquecer que elas
         existem, que é justamente o que faz a próxima cobrar atenção. */
      mageInterval: 18.0, // s entre bolas, por mago
      /* TRÊS MINUTOS de mirante calado. Era meio, e meio minuto não pagava a
         flecha: o mago voltava antes de a fila do portão mudar de tamanho.
         Numa partida de dez minutos, três é quase um terço do cerco sem aquela
         torre — o prêmio agora é grande o bastante para valer virar as costas
         para o portão e gastar o tiro. */
      mageRespawn: 180, // s até subir outro no mirante vazio
      /* Lenta o bastante para se desviar — e, desde que virou alvo de flecha,
         lenta o bastante para se mirar. Ela cruza 95 m em 7,3 s. */
      mageBolt: { speed: 13 }, // m/s
      /** Raio de morte da bola, no ponto em que ela cai. */
      mageBlast: 2.2, // m
      /* Raio do COLISOR da bola — o alvo que a flecha precisa encontrar para
         estourá-la no ar. Bem maior que o núcleo desenhado (0,4 m), e de
         propósito: ela cruza a rampa a catorze metros por segundo e o acerto é
         resolvido em passos de física, não continuamente. Um colisor do tamanho
         do pixel exigiria uma pontaria que o arco deste jogo não foi feito para
         ter, e a promessa de poder abatê-la quase nunca se cumpriria. */
      boltHitRadius: 1.4, // m

      /* ------------------------------------------------- o mago SE VÊ ------
         O mirante fica a 92 e 98 m do adarve, e essa distância desmontava o
         mago duas vezes antes de ele chegar ao olho de quem defende:

         1. o LOD. Acima de `cullDistance` (60 m no preset alto, 45 no baixo) o
            corpo articulado sai do render e o bicho vira uma instância da
            malha `corpo` — sem cajado, sem olhos, sem manto. O cajado dourado
            é justamente "a única linha vertical alta da horda", a coisa pela
            qual se acha um xamã, e ele sumia exatamente na faixa em que o mago
            das torres VIVE. `mageLod` empurra as faixas dele para longe o
            bastante para isso não acontecer em nenhum preset — e custa dois
            corpos articulados, porque são dois mirantes e mais nada.

         2. a COR. O xamã é azul-marinho quase preto (`#22304a`) contra um
            bosque noturno. Mesmo desenhado inteiro, ele é uma mancha escura
            sobre fundo escuro a noventa metros.

         O facho resolve a segunda: um núcleo branco-verde no alto do cajado
         com um halo aditivo em volta, na MESMA cor da bola que ele atira
         (`0x7affc8` em `SiegeSystem.onShot`). É de propósito que seja a mesma:
         quem aprende "aquele ponto verde no mirante é de onde a bola vem"
         aprende com uma cor só. Nenhuma luz dinâmica, pelo motivo de sempre —
         são dois sprites de esfera, como o halo da própria bola. */
      mageLod: 3.0, // × cullDistance — as faixas de LOD dele
      mageBeacon: {
        raio: 0.26, // m — o núcleo, branco e sem sombreamento
        halo: 2.8, // × o núcleo
        cor: 0x7affc8, // a cor da bola dele
        nucleoCor: 0xd8fff0,
        opacidade: 0.42,
        /* A PULSAÇÃO. Um ponto fixo a noventa metros lê como pixel morto do
           monitor; um que respira lê como coisa viva. O período é longo — o
           facho é um marcador, não um alarme. */
        pulso: 0.45, // s⁻¹ (≈ 2,2 s de ciclo)
        pulsoAmp: 0.22, // fração do tamanho
      },

      /* ------------------------------------------------ morcegos gigantes --
         A terceira ameaça que não vem pela rampa, e a única que chega POR CIMA.
         Ver o cabeçalho de `server/batSim.js` para o ciclo dos três estados.

         O número que decide se eles são interessantes ou insuportáveis é
         `circleTime`: são os segundos em que o bicho está em campo, visível e
         inofensivo, depois de cada mergulho. É a janela em que a resposta cabe.
         Curto demais e ele vira um projétil que reaparece; longo demais e ele
         vira paisagem.

         `diveTimeout` é o par disso do outro lado: o mergulho tem prazo, então
         quem se mexeu escapa. As duas coisas juntas são o que fazem dele um
         bicho e não uma sentença. */
      bats: {
        /* MAIS CEDO E EM MAIOR NÚMERO.
           Com dois em campo, uma ronda de 16 s e reposição a cada 25, o
           morcego aparecia tão espaçado que deixava de ser uma ameaça e virava
           fauna: o jogador via um passar, esquecia dele, e a próxima vez que
           levantava a cabeça era porque tinha morrido. A frequência é o que
           transforma "aquilo existe" em "aquilo é um problema meu" — e é ela
           que faz valer a pena guardar uma flecha para o céu.
           Os 150 s também eram tarde demais: metade da partida sem a única
           ameaça que chega por cima. Aos 80 s ele entra logo depois dos
           esqueletos, que é quando o adarve já tem ritmo para ser quebrado. */
        count: 3, // em campo ao mesmo tempo
        firstAt: 80, // s de partida até o primeiro
        respawn: 14, // s entre reposições do bando
        spawnZ: 118, // m — atrás da linha de árvores
        spawnHalfX: 22,
        cruiseYMin: 22, // m acima do chão onde nasce
        cruiseYMax: 32,
        /* Um passo mais lentos em tudo. A envergadura é de cinco metros, e um
           bicho desse tamanho cruzando o quadro a 13 m/s lê como projétil: o
           olho não acompanha as asas, então não lê como voo. Mais devagar, o
           mergulho passa a ser uma coisa que se VÊ chegando — que é o que o
           torna evitável em vez de fatal. */
        cruiseSpeed: 11, // m/s na travessia
        diveSpeed: 17, // m/s no mergulho — ainda bem mais rápido que a travessia
        diveTimeout: 3.2, // s de mergulho antes de desistir
        killRadius: 1.7, // m — encostou, matou
        /* A janela de trégua entre dois ataques. Encurtou junto com o aumento
           do bando (16 → 12 s): ela continua existindo, o que muda é que deixa
           de ser longa o bastante para o jogador esquecer que o bicho existe.
           Hoje ela é o TETO do recuo, não a duração dele — quem manda é a
           chegada ao ponto (ver `BatSwarm.recuar`). */
        circleTime: 12, // s
        /* ----------------------------------------------------------- recuo --
           Fração do caminho de volta ao bosque que ele percorre depois de
           atacar. Meio caminho: perto o bastante para continuar visível e no
           mesmo campo de visão da rampa, longe o bastante para a volta ser uma
           APROXIMAÇÃO que dá tempo de mirar. Ver o cabeçalho de `batSim.js`
           para por que o recuo substituiu a órbita sobre o castelo. */
        retreatFrac: 0.5,
        /** Segundos pairando no ponto de recuo antes de voltar. É o instante em
            que ele é mais fácil de acertar, e ele existe justamente para isso. */
        loiter: 2.6, // s
        /* A ALTURA DO RECUO. A 17 m ele passava rente ao adarve (que está a 8 m
           do pátio) e ficava metido no meio da mira de quem estava tentando
           atirar na rampa — a janela de trégua virava estorvo. A 27 m
           ele fica claramente ACIMA de tudo: dá para vê-lo, contá-lo e decidir
           gastar uma flecha nele, sem que ele atrapalhe o resto. */
        circleHeight: 27, // m acima do piso do pátio
        circleSpeed: 10, // m/s na órbita
        turnRate: 1.5, // rad/s — o arco largo de um bicho grande
        flap: 7.0, // rad/s do bater de asas (fase; quem desenha é o cliente)
        /** Uma flecha basta. Alvo grande, mas em movimento e no ar. */
        points: 150,
      },
      /* -------------------------------------------------------- catapulta --
         A 110 m, atira no ADARVE. É a primeira vez que o jogador é o alvo. */
      catapultStandoff: 110, // m
      catapultSpread: 3.5, // m de erro no ponto de queda

      /* -------------------------------------------------------- escalões --
         Em que segundo cada espécie ENTRA na composição. A densidade sobe
         liso; a variedade sobe em degraus, e cada degrau é anunciado por
         trompa e faixa na tela. É o único momento em que o modo pausa a
         leitura do jogador, e existe porque a primeira aparição de uma espécie
         precisa ser VISTA antes de ser um problema. */
      tiers: [
        { at: 0, kind: "soldier", nome: "Soldados" },
        { at: 45, kind: "skeleton", nome: "Esqueletos" },
        { at: 105, kind: "climber", nome: "Escaladores" },
        { at: 165, kind: "shaman", nome: "Xamãs" },
        { at: 225, kind: "ogre", nome: "Ogro" },
        { at: 300, kind: "shielded", nome: "Pavês" },
        { at: 375, kind: "hound", nome: "Matilha" },
        { at: 450, kind: "catapult", nome: "Catapultas" },
      ],
      /* Peso de cada espécie no sorteio, depois que ela entrou. O soldado cai
         conforme o resto aparece: sem isso, a composição do minuto 15 seria a
         do minuto 1 com enfeites. */
      weights: {
        soldier: 5,
        skeleton: 6,
        climber: 1.4,
        shielded: 2.2,
        hound: 1.0,
        shaman: 0.7,
      },
      /** Espécies que não entram no sorteio: têm relógio próprio. */
      ogreEvery: 85, // s entre ogros, a partir do escalão deles
      catapultEvery: 78, // s
      catapultMax: 2,
      shamanMax: 3,
      climberMax: 4,

      /* --------------------------------------------------------- alcance --
         Multiplicador das faixas de LOD de TODO sitiante — ver
         `SiegeSystem.atualizarLod` para a conta e o motivo. Em uma frase: a
         rampa tem 97 m e o `cullDistance` do jogo é calibrado para um javali a
         trinta, então sem isto o campo de tiro deste modo era desenhado como
         vulto na maior parte do seu comprimento. */
      lodScale: 1.7,

      /* ------------------------------------------------------------ teto --
         O número grande do pedido, e o limite que a rede e o LOD aguentam.
         Ver §9 do plano: 10 B por bicho no quadro binário, 120 vivos = 1,2 KB
         por quadro a 10 Hz. */
      maxAlive: 120,
      maxEntities: 150,
      corpseLifetime: 5, // s

      /* ---------------------------------------------------------- trabuco --
         Pedra de 25 kg e raio de 0,14 m (calcário, ~2 200 kg/m³). O arrasto a
         33 m/s dá 0,77 m/s² — 8 % de g: parábola quase limpa, vento que
         entorta pouco mas entorta.

         O ÂNGULO DE SOLTA É FIXO em 45°, e é a decisão que faz o modo. Com ele
         fixo, quem escolhe o alcance é a VELOCIDADE, e é a faixa dela que diz
         onde o engenho serve.

         A FAIXA CURTA FOI ABERTA, e isso desfaz uma regra antiga.

         O plano dizia, com todas as letras, que o trabuco não alcança o pé do
         próprio muro: o arco seria a arma do portão e o engenho a arma da
         aproximação, sem sobreposição. Medido na geometria real, a regra era
         mais dura do que soava. Os engenhos ficam nos bastiões, a 19 m do
         aglomerado do portão em planta, e SOLTAM DE 8 m DE ALTURA — a queda
         alonga o tiro, então os 18 m/s de mínimo caíam a 40 m, não a 33. A
         faixa inteira de 0 a 40 m era intocável, e é justamente ali que a fila
         se acumula e onde o modo é perdido.

         Com 9 m/s o mínimo cai para 14,6 m contra o piso do pátio, e o
         aglomerado do portão está a 19,1 m dos bastiões: dá para largar a
         pedra na boca do portão com folga para escolher onde dentro dele. O
         arco não perde o posto — ele continua sendo a arma de cadência, e o
         engenho cobra 14 s de recarga por tiro —, mas passa a haver uma
         RESPOSTA para o momento em que a fila venceu a cadência do arco, que
         antes simplesmente não existia. */
      trebuchet: {
        launchAngle: Math.PI / 4, // rad — fixo, ver acima
        /* ±77°, e não mais ±40°.
           A abertura antiga bastava para varrer a rampa de frente, e a rampa é
           o que se via de um engenho no MEIO do muro. Dos bastiões, o portão
           fica a 70° fora do eixo — ou seja, a faixa que o parágrafo acima
           acabou de destravar em DISTÂNCIA continuava trancada em ÂNGULO. */
        yawRange: 1.35, // rad — ±77° de giro da armação
        speedMin: 9.0, // m/s → ~15 m de alcance, dos bastiões
        speedMax: 33, // m/s → 111 m
        chargeTime: 1.6, // s de tensionamento até o máximo
        mass: 25, // kg
        radius: 0.14, // m — raio da PEDRA (área de arrasto)
        visualRadius: 0.42, // m — a bola de fogo que se vê é maior que a pedra
        dragCoefficient: 0.47, // esfera
        /* RECARGA DE DOIS MINUTOS, e não de catorze segundos.
         *
         * A catorze segundos o engenho era uma segunda arma: dava para atirar,
         * voltar ao arco por dois ciclos e atirar de novo. Com o estouro de 6 m
         * cobrindo a boca inteira do portão, isso o tornava a resposta para
         * tudo — e o modo se chama cerco de ARQUEIRO.
         *
         * A dois minutos ele volta a ser o que o §5.1 do plano descreve: o
         * recurso ESCASSO, guardado para o momento em que a fila venceu a
         * cadência do arco. Cinco pedras numa partida de dez minutos, e cada
         * uma é uma decisão.
         *
         * A manivela mantém a proporção de sempre (~3,1×): quem larga o arco
         * para içar troca a própria cadência pela do engenho, que continua
         * sendo a troca central do modo. */
        reload: 120, // s
        windReload: 38, // s
        windRadius: 2.2, // m — distância para operar a manivela
        /* ------------------------------------------------------- estouro --
           MEDIDO CONTRA A FILA, e não escolhido no abstrato.

           3,5 m de raio é menos do que o vão do portão (6 m) e menos do que o
           espaçamento da própria fila, que `atribuirVagas` abre em 1,05 m por
           vaga: uma pedra bem colocada pegava três dos seis de frente, e uma
           pedra no meio da rampa pegava um. Com 14 s de recarga, "matei um"
           lê como "não matou ninguém" — que foi exatamente o relato.

           A 6 m ela cobre o vão inteiro do portão, que é o alvo para o qual a
           faixa curta acima acabou de ser aberta.

           O DANO sobe de 6 para 8 pela mesma conta, e o teto é o OGRO: ele
           pede 16 flechas, então 8 é metade da vida dele — estrago pesado, e
           declaradamente insuficiente para derrubá-lo de uma vez. Na borda do
           estouro sobram 2,4 (a queda é de 70 %), que ainda mata soldado e
           esqueleto e não mata pavês. */
        blastRadius: 6.0, // m — dano direto
        blastDamage: 8, // flechas equivalentes no centro
        fireRadius: 6.0, // m — o piche em chamas
        fireTime: 8.0, // s
        fireDps: 2.2, // flechas equivalentes por segundo
        /** Uma pedra curta acerta o próprio portão. Não é punição arbitrária:
            com mínimo de 33 m, para acertá-lo é preciso errar de propósito. */
        gateDamage: 45,
      },

      /* ----------------------------------------------------------- morte --
         Morrer custa VAZÃO, não a partida. 8 s na menagem mais ~3,5 s de
         escada, numa maré em que chega um por segundo, são ~11 inimigos que
         ninguém parou. Matar o jogador de vez transformaria a derrota coletiva
         numa eliminação individual, que é o modo zumbi — que já existe. */
      respawnDelay: 8, // s
      invulnerability: 2.5, // s
      /* Desnível que mata. O muro tem 8 m; 5,5 põe a queda dele com folga
         dentro da regra e deixa de fora o salto da escada e o pulo de um
         degrau de adarve para o bastião. Vale para os DOIS lados: cair para
         fora entrega você à fila, cair para dentro quebra as pernas no pátio —
         e o jogador não precisa saber de qual lado caiu para entender. */
      fatalFall: 5.5, // m

      /* ----------------------------------------------------------- placar -- */
      gateCriticalFrac: 0.3, // abaixo disto o relógio de "portão em risco" corre
    },
  },

  /* ---------------------------------------------------------------- especial -
     O Kamehameha. Ver `docs/plano-kamehameha.md`.

     Isto NÃO é "um golpe", é um sistema de especial com uma implementação:
     `systems/special.js` não sabe o que é um meteoro. Ele sabe quanto falta
     para carregar, em que fase da animação está e para onde o feixe foi. Quem
     diz "isto encheu um ponto" é o modo, por `chargeSources`. */
  special: {
    kind: "kamehameha",
    /* EM TODO MODO, e é o que `"*"` quer dizer. Ver `specialEnabled`.
     *
     * Era uma lista de quatro — chuva, as duas noites de zumbi e o cerco —, e a
     * lista descrevia menos uma decisão de desenho do que a ordem em que as
     * coisas foram escritas: o especial nasceu junto com a chuva e foi sendo
     * ligado onde havia horda. O critério não sobrevive ao teste óbvio: o que
     * enche a barra é ABATER, e todo modo deste jogo é feito de abates. Um
     * duelo sem especial e um cerco com especial são dois jogos diferentes
     * vendidos com o mesmo arco.
     *
     * Uma lista também é uma armadilha para o modo seguinte: quem escrever o
     * décimo quarto modo não tem como saber que precisa vir aqui, e o sintoma é
     * um sistema inteiro que simplesmente não aparece, sem erro nenhum. */
    modes: "*",
    /* O que enche a barra, e quanto, por evento.
     *
     * Na chuva a moeda é a FLECHA que conecta; em todo o resto é a ALMA, ou
     * seja, o abate inteiro — e é ela que o jogador vê subindo até ele
     * (`systems/souls.js`). São duas moedas diferentes de propósito: uma rocha
     * pede de uma a vinte flechas e um zumbi pede uma; contar flecha lá e
     * abate aqui é o que mantém as duas barras enchendo no mesmo ritmo.
     *
     * O ALVO DE MADEIRA VALE MENOS QUE UM BICHO, e o JOGADOR vale mais.
     * A série é o modo mais barato de encher barra que existe — o alvo não
     * reage, não anda e nasce sempre à sua frente —, e pagá-lo cheio faria o
     * especial sair a cada dois minutos num modo que é sobre pontaria (a 0,5,
     * são vinte alvos por golpe). O abate de gente é o contrário: num duelo é a
     * coisa mais cara do jogo, e a 2,5 são QUATRO abates por golpe — o suficiente
     * para o feixe ser um prêmio de quem está ganhando a briga, e caro o
     * bastante para não sair duas vezes na mesma troca de tiros. */
    chargeSources: {
      meteor: 1,
      zombie: 1,
      besieger: 1,
      bat: 1,
      boar: 1,
      elk: 2,
      bird: 1,
      target: 0.5,
      player: 2.5,
    },
    /** Dez almas enchem a barra. */
    hitsToCharge: 10,
    /** Ele mata outros jogadores. Virar `false` por modo é uma linha. */
    friendlyFire: true,

    /* Quanto o feixe vale NO COLOSSO, em flechas.
     *
     * Em tudo o mais ele VAPORIZA — a rocha morre inteira, seja qual for a
     * vida que tinha, porque um raio de energia que precisa de duas passadas
     * numa pedra de 6 m não lê como um raio de energia. O colosso é a exceção
     * declarada: ele é o ato do modo, e apagá-lo com uma tecla apagaria junto
     * os setenta segundos que ele existe para cobrar. Três flechas de uma vez
     * é um pedaço honesto da barra dele sem ser a barra inteira. */
    kameTankHits: 3,

    /* ------------------------------------------------- o feixe NO CHÃO --
     *
     * Enquanto ele aponta para o terreno, a esfera que abre no ponto final não
     * é só imagem: ela mata em área. É o que dá ao especial um uso nos modos de
     * monstro, onde não há rocha para vaporizar — e é a leitura óbvia de um
     * raio de energia batendo no chão no meio de uma horda.
     *
     * A regra tem duas faixas porque as duas coisas que ela acerta são de
     * naturezas diferentes. O bicho de uma a três flechas — soldado, esqueleto,
     * zumbi, mastim, escalador — MORRE, sem conta nenhuma: um golpe desta
     * escala que deixasse um esqueleto de pé seria ridículo. O monstro grande
     * (ogro, chefão, catapulta) leva o equivalente a quatro flechas: é um
     * pedaço honesto da barra dele sem ser a barra inteira, exatamente o mesmo
     * critério do `kameTankHits` no colosso.
     *
     * O raio acompanha `beam.blastRadius`, que é o tamanho DESENHADO da esfera:
     * o que mata tem de ser o que se vê. */
    groundBlast: {
      /** Até quantas flechas de vida conta como "bicho pequeno". */
      smallArrows: 3,
      /** Flechas de dano no que não é pequeno. */
      bigHits: 4,
      /** Segundos entre duas ondas, enquanto o feixe seguir apoiado no chão. */
      interval: 0.6,
    },

    /* ------------------------------------------------------------- a Terra --
       O feixe apontado para o planeta o DESTRÓI, e a flecha não faz nada.

       A assimetria é o ponto inteiro: a Terra é a única coisa no céu que não é
       um alvo, e é justamente por isso que apontar para ela é a piada que o
       jogador vai querer contar. Uma flecha ali é uma flecha perdida no vácuo
       (ela não tem colisor e nunca terá); o feixe é a única arma do jogo com
       escala para a pergunta fazer sentido.

       E ele DEMORA. A Terra está a 384 mil quilômetros, e um golpe que a apaga
       no mesmo quadro em que sai da mão lê como um efeito de tela. Três
       segundos e meio de nada acontecendo — com o feixe já indo embora e o
       jogador sem entender por que apertou — é o que transforma o disparo numa
       expectativa, e é a expectativa que faz o clarão valer. */
    earth: {
      /** s até o feixe chegar lá. É teatro, e é o teatro que dá o peso. */
      travel: 3.5,
      /** Quanto do disco é preciso acertar: 0,75 do raio, ou seja, o miolo. */
      aimFrac: 0.75,
    },

    /* ------------------------------------------------------------- fases --
       Total 5,17 s, e o jogador fica PRESO neles: sem andar, e a direção do
       feixe é travada no disparo. Não é limitação técnica, é o preço — durante
       esse tempo você não atira flecha nem cobre o resto do céu.

       A concentração e a recuperação caíram À METADE outra vez (1,0 → 0,5 e
       0,56 → 0,28), pelo motivo que já havia justificado o primeiro corte e
       que a tela confirmou: as duas são o trecho em que NADA ACONTECE. A
       primeira é o arqueiro se concentrando com o céu cheio; a segunda é ele
       voltando à postura depois que o feixe já foi embora. Num modo com prazo,
       cada décimo delas é pago em rocha perdida — e nenhuma das duas é o
       golpe. O preço continua sendo os três segundos de sustentação, que é
       onde o golpe É o golpe, e esses não se tocam. */
      charge: 0.5, // s de concentração
      release: 0.15, // s do empurrão das mãos
      sustain: 3.0, // s de feixe cheio
      dissipate: 1.2, // s da cauda do FEIXE perseguindo a ponta

      /* --------------------------------- o corpo não espera mais o feixe --
       *
       * Depois que o fluxo sai das mãos, o que prendia o arqueiro era a
       * dissipação INTEIRA (1,2 s) mais o retorno (0,28): um segundo e meio de
       * pose parada olhando uma cauda de luz que já ia longe. Num modo com
       * prazo isso é rocha perdida, e — pior — é tempo em que o jogador já
       * entendeu que acabou e o boneco discorda dele.
       *
       * A correção separa as duas coisas que estavam presas no mesmo número: a
       * CAUDA continua com 1,2 s (é ela que faz o feixe ir embora em vez de
       * piscar), e a POSE dura 0,36 + 0,08. São 0,44 s do fim do feixe até o
       * arco na mão, contra 1,48 — os 70 % de corte pedidos, tirados de onde
       * eles não custam imagem nenhuma. O feixe termina de se apagar sozinho,
       * com o dono já mirando de novo.
       *
       * Os três segundos de sustentação continuam intocados: é ali que o golpe
       * É o golpe, e é ele o preço do especial. */
      poseDissipate: 0.36, // s de pose enquanto a cauda ainda vai embora
      recover: 0.08, // s até o corpo e o arco voltarem

    /* -------------------------------------------------------------- feixe -- */
    beam: {
      speed: 300, // m/s da frente
      range: 400, // m — ou até o terreno
      /* MEDIDO, e a primeira tabela estava errada.
       *
       * Ela dizia Ø5 / Ø9 / Ø14, e justificava comparando com as rochas (Ø8) —
       * mas as rochas são vistas a duzentos metros, e o feixe sai a QUINZE da
       * câmera. A dezenas de metros aquilo era "grosso"; a quinze, era uma
       * parede branca que apagava o personagem, o céu e as rochas. Com o núcleo
       * sozinho, sem casca nem halo, a tela já lavava.
       *
       * Ø 2,2 no núcleo é aproximadamente quatro vezes a largura do arqueiro:
       * lê como um feixe grosso ao lado dele, que é a leitura da referência, e
       * cabe no quadro. */
      coreRadius: 1.1, // m — Ø 2,2
      shellRadius: 2.0, // m — Ø 4
      haloRadius: 3.2, // m — Ø 6,4
      killRadius: 3.0, // m do eixo; passar raspando conta
      /* NÃO é branco puro. Branco puro em aditivo passa longe do
         `bloomThreshold` (0,78) ao longo de trezentos metros de cilindro, e o
         passe de bloom espalha isso pelo quadro inteiro. Um branco-azulado a
         85 % brilha igual e não satura. */
      coreColor: 0xd8f0ff,
      shellColor: 0x4fc3ff,
      haloColor: 0x1b4bd8,
      /* Estes três são o que o bloom vê. Trezentos metros de cilindro aditivo
         acumulam MUITO, e o passe de pós espalha o excesso pelo quadro inteiro:
         cada décimo aqui vale mais do que parece. Ver a tarefa de ajuste visual
         em `docs/plano-kamehameha.md` — este é o número a mexer. */
      coreOpacity: 0.55,
      shellOpacity: 0.22,
      haloOpacity: 0.08,
      ringSpeed: 60, // m/s das ondas de energia correndo na casca
      /* A explosão no ponto final. Enquanto o feixe vive e aponta para o chão
         ela SUSTENTA (pulsa) em vez de acontecer uma vez. */
      blastRadius: 22, // m
      blastGrow: 0.45, // s até a esfera abrir
      /* Duas luzes no máximo, e só perto da câmera: luz dinâmica é o item mais
         caro que se pode acrescentar à Lua (ver `docs/plano-lua-desempenho.md`). */
      lightDistance: 200, // m — além disto, só emissivo e bloom
      chargeLight: 400,
      blastLight: 900,
    },

    /* --------------------------------------------------------------- pose --
       Alvos de mão no espaço do tronco. O corpo do jogo não usa animação de
       esqueleto: `poseArm` é IK de dois ossos com vetor de polo, e a pose
       inteira é uma linha do tempo de alvos. Ver `player.poseKamehameha`. */
    pose: {
      stanceYawCharge: 0.35, // rad — esquadra para o alvo (normal é 1,16)
      stanceYawFire: 0.18,
      stanceWidth: 0.40, // m — base larga
      crouch: 0.12, // m — agacha na carga
      handsHip: { x: 0.26, y: 0.10, z: -0.10 }, // concha ao lado do quadril
      handsApartStart: 0.30, // m entre as palmas
      handsApartEnd: 0.22,
      handsFire: { forward: 0.42, up: -0.04 }, // à frente do ombro
      straighten: 0.02, // braço a ~90 %: travado no cotovelo lê como boneco
      recoil: 0.12, // m para trás no disparo
      lunge: 0.35, // m de avanço da perna da frente
      tremorCharge: 0.018, // m no fim da carga
      tremorSustain: 0.012, // m durante o feixe
      tremorHz: 18,
      orbRadius: 0.42, // m — a esfera entre as palmas, no auge
      /* O arco atravessado nas COSTAS. O `z` é POSITIVO: neste corpo a mira sai
         em −Z (ver `_aim` em `player.js`), então +Z é atrás — e a aljava, que já
         mora lá, confirma (`_quiverGrab` usa z = 0,2). Com −0,16 ele ficava
         pendurado na frente do peito, atrapalhando justamente as mãos que o
         golpe precisa livres. */
      bowBack: { x: -0.10, y: 0.34, z: 0.18 },
      bowBackRoll: 1.15, // rad
      bowSwap: 0.35, // s de troca mão ↔ costas
    },
  },

  /* ------------------------------------------------------------------ fases -
     O que muda de um cenário para outro. O vale não aparece aqui: ele é a
     REFERÊNCIA, e os valores dele são os de `physics` e `player` acima — repetir
     seria criar duas fontes para o mesmo número. Ver `shared/levels.js`. */
  levels: {
    /* ------------------------------------------------------------------ Lua --
       Tudo aqui sai de física real, não de "meio da Terra" arbitrário. */
    moon: {
      gravity: -1.62, // m/s² — o valor da Lua
      /* Vácuo. Zerar a densidade DESLIGA O ARRASTO PELA MATEMÁTICA (a força é
         proporcional a ρ, ver `entities/arrow.js`), não por um `if`. E como o
         arrasto é o que gera o torque no centro de pressão, a flecha deixa de
         se realinhar: ela mantém a atitude de lançamento durante todo o arco,
         que é o que aconteceria de verdade. */
      airDensity: 0,
      wind: false,

      /* Salto: 2,60 m de altura e 3,58 s no ar, contra 0,90 m e 0,86 s no vale.
         Manter os 4,2 m/s originais daria 5,4 m e 5,2 s — alto demais para
         mirar, e o duelo viraria uma troca de tiros entre dois pontos no céu. */
      jumpSpeed: 2.9, // m/s

      /* Corrida pela METADE (9,6 → 4,8 m/s).
         Correr num traje pressurizado a 1/6 de g não é correr: os astronautas
         da Apollo saltitavam porque a tração não segura a passada. Além da
         verossimilhança, isto conserta um problema de jogo — com a corrida
         cheia, atravessar os 330 m da arena era rápido demais e o jetpack
         deixava de ser a forma interessante de se locomover. Subiu um pouco
         (0,5 → 0,6) porque a marcha ficava arrastada demais para cruzar os
         vãos entre as estruturas da base a pé. */
      runMultiplier: 0.6,

      /* ---------------------------------------------------------- barreira --
         Arena de 330 m de diâmetro: três vezes o anel de duelo do vale. O
         centro cai no ponto mais denso da malha. */
      barrier: { centerX: 0, centerZ: -97, radius: 165 }, // m

      /* --------------------------------------------------------- curvatura --
         A curvatura real é invisível numa arena: com R = 1.737 km o chão cai
         8 mm em 165 m. Ela é exagerada de propósito — mas o exagero tem teto,
         porque um raio pequeno demais traz o horizonte para dentro da arena e
         o cenário vira uma colina.

         Com 26 km, o horizonte (√(2·h·R)) fica a 300 m de quem está em pé e a
         1.243 m de quem está no topo do foguete. Ou seja: subir AFASTA O
         HORIZONTE EM 4×, e isso é a mesma conta dos dois lados, não um efeito. */
      curvatureRadius: 26000, // m

      /* ------------------------------------------------------------- malha --
         Mais barata que a do vale (86 k triângulos) porque não há serra para
         descrever: 57,8 k na arena + 5,1 k no anel distante.

         O anel existe por causa do vácuo: sem névoa, o horizonte é recortado e
         nítido, e sem ele o jogador veria a malha acabar e o vazio começar. Ele
         vai até 1,6 km — além do horizonte visto do topo do foguete. */
      world: {
        half: 350, // m — meia-extensão da grade da arena
        segments: 170, // ⇒ 57,8 k triângulos
        gridFocus: 0.28, // célula de 1,15 m no centro, 5,8 m na barreira
        skirtOuter: 1600, // m — até onde vai o anel distante
        skirtRings: 20,
        skirtSectors: 128,
      },

      /* ----------------------------------------------------------- terreno -- */
      undulation: 0.9, // m — ondulação larga (mares suaves), não morro
      regolith: 0.25, // m — grão fino de 25 cm

      /* ---------------------------------------------------------- crateras --
         Três escalas que se SOBREPÕEM, aplicadas em ordem: a mais nova corta a
         borda da mais velha. Um campo com todas as bordas inteiras lê como
         bolhas; com umas cortando as outras, lê como Lua.

         O tamanho cresce com a distância da base, e isso não é só estética: a
         malha é adensada no centro, então cratera pequena só existe onde há
         célula fina para descrevê-la. */
        craters: {
        /* Profundidade = 0,30 × raio, ou seja ~1/6 do diâmetro. Uma cratera
           simples de verdade fica perto de 1/5 do diâmetro; 0,18, que era o
           valor anterior, produzia um PRATO — de dentro do jogo lia como uma
           depressão no gramado, não como um impacto. */
        depthRatio: 0.30,
        rimRatio: 0.07, // borda elevada = 0,07 × raio
        ejectaReach: 0.6, // manto de ejeção = 0,6 × raio além da borda
        /* Só o que a base realmente ocupa. Antes eram 46 m SOMADOS ao maior
           raio do escalão, e o efeito colateral foi um miolo de 55 m de raio
           completamente liso — justamente onde se anda. */
        clearAroundBase: 30, // m
        tiers: [
          // grandes: metade externa e horizonte, onde dão escala ao mundo
          { count: 12, rMin: 26, rMax: 45, dMin: 0.5, dMax: 1.7 },
          { count: 34, rMin: 10, rMax: 26, dMin: 0.25, dMax: 1.3 },
          { count: 80, rMin: 3.5, rMax: 10, dMin: 0.1, dMax: 1.0 },
          /* As MARCAS: crateras de um a três metros, densas e por toda parte.
             São elas que fazem o chão ler como regolito na escala de quem
             caminha — sem elas, os 30 m em volta do pé são uma placa lisa por
             mais crateras grandes que existam no horizonte. */
          { count: 130, rMin: 1.2, rMax: 3.5, dMin: 0.05, dMax: 0.95 },
        ],
        /* Raios de ejeção — as estrias claras que saem das crateras jovens (o
           efeito Tycho). É a coisa mais reconhecível da Lua vista de longe, e
           aqui é um cosseno no ângulo em torno da cratera: cor de vértice,
           zero custo em tempo de execução. */
        rayChance: 0.35, // fração das crateras que tem raios
        rayCount: 9, // estrias por cratera
        rayReach: 5.5, // × raio — até onde a estria vai
      },

      /* ------------------------------------------------------------ flecha --
         Sem arrasto e com 1/6 de g, um tiro de 120 m/s a 45° alcança 8,9 km e,
         reto para cima, sobe 4,4 km e leva 148 s para voltar. Cada flecha no ar
         é um corpo rígido com CCD e um traçado — sem teto, um duelo enche a
         memória de projéteis que nunca vão colidir com nada.

         Os 12 s NÃO são curtos: o arco mais longo que ainda cai DENTRO da arena
         (60° cobrindo os 165 m) sobe 71 m e dura 9,3 s. Cobre com folga todo
         tiro que ainda pode acertar alguém, e mata os que já não podem. */
      arrow: {
        maxLifetime: 12, // s (no vale são 25, e lá o arrasto derruba antes)
        maxAltitude: 300, // m — pega o tiro reto para cima
        despawnMargin: 15, // m além da barreira; some com um fade curto
        fadeOut: 0.25, // s — some sem parecer que travou
      },

      /* ----------------------------------------------------------- jetpack --
         Subir os 28 m até a plataforma do foguete leva ~3,9 s, sobrando 2 s
         para se posicionar lá em cima. Descer de lá é queda livre de 5,9 s. */
      jetpack: {
        fuel: 6.0, // s de voo contínuo
        refuelRate: 2.0, // /s — cheio em 3 s
        refuelDelay: 0.6, // s depois de pousar (voar de novo não é grátis)
        thrust: 6.0, // m/s² — empuxo líquido de +4,38 contra a gravidade
        maxRiseSpeed: 9.0, // m/s
        airThrust: 7.0, // m/s² — WASD no ar, por ACELERAÇÃO
        maxAirSpeed: 12.0, // m/s
        airDrag: 0.7, // 1/s — controle sem virar "andar no ar"
        lowFuel: 0.25, // fração em que o medidor começa a pulsar

        /* ------------------------------------------------------------ fumaça --
           O RASTRO é informação, não enfeite: um arqueiro voando contra o preto
           do céu é quase invisível, e a chama do bocal só se vê de perto. O
           caminho de fumaça que fica para trás diz, de qualquer distância e
           mesmo depois de o sujeito passar, POR ONDE alguém voou e há quanto
           tempo — é o mesmo papel do rastro de condensação de um avião.

           Ele sai do pool de partículas que já existe (`systems/particles.js`),
           então não custa uma chamada de desenho nova. O que custa é a
           QUANTIDADE VIVA, e é ela que está limitada aqui: um sopro a cada
           `interval` com `life` de vida dá ~`life/interval` partículas por
           jogador voando. Ver `systems/jetSmoke.js` para o corte por distância,
           que é o que impede uma sala cheia de estourar o pool. */
        smoke: {
          interval: 0.055, // s entre sopros (≈29 partículas vivas por jogador)
          intervalFar: 0.13, // s além de `nearDistance` — metade do custo
          nearDistance: 45, // m
          maxDistance: 130, // m — além disto ninguém lê um sopro de 30 cm
          life: 1.6, // s até sumir de vez
          size: 0.26, // m — lado inicial do sopro
          grow: 2.8, // ele se abre enquanto se dissipa
          alpha: 0.34, // translúcido: é fumaça rala, não uma bola de algodão
          speed: 1.1, // m/s de sopro inicial, para baixo
          drag: 2.2, // 1/s — freia quase de imediato e o sopro FICA no lugar,
          //                   que é o que transforma sopros num caminho
          gravity: -0.3, // m/s² — no vácuo ela não sobe; assenta devagar
          color: 0xc3c7cf,
          colorLow: 0xd8b9a6, // tanque no fim: fumaça mais suja
        },
      },

      /* -------------------------------------------------------------- base -- */
      base: { x: 0, z: -97 },

      /* ------------------------------------------------------------ aliens --
         Perseguem e MATAM, então vivem no servidor (`server/spaceSim.js`): se
         cada tela tivesse os seus, duas pessoas morreriam de coisas
         diferentes. */
      alien: {
        /* Seis vivos ao mesmo tempo enchiam a planície: a Lua virava corredor
           de bichos e o duelo entre jogadores não achava espaço. Três, nascendo
           mais devagar, mantêm a ameaça sem tomar conta do cenário. */
        maxAlive: 3,
        spawnMin: 26, // s entre nascimentos
        spawnMax: 52,
        spawnDistMin: 48, // m — nasce longe, e é o tempo de chegar que dá
        spawnDistMax: 88, //     tempo de reagir em vez de ser surpreendido
        speed: 2.6, // m/s
        attackRange: 1.6, // m — para de perseguir e ataca
        /* O BRAÇO DELE NÃO ALCANÇA O CÉU.
           O alcance sempre foi medido só no plano (x, z), e o resultado é que
           quem passava de jetpack cinquenta metros acima de um alien morria do
           golpe de um bicho que nem estava olhando para cima. Agora o golpe só
           conecta em quem está COM OS PÉS NO CHÃO: até 1,2 m acima do solo sob
           a vítima, que cobre estar em pé numa lombada e não cobre pulo nenhum
           (o salto lunar sobe 2,6 m). */
        attackMaxHeight: 1.2, // m acima do terreno sob a vítima
        attackWindup: 0.5, // s de braços erguidos antes do golpe valer
        attackCooldown: 1.6, // s de pausa depois de golpear
        chirpMinInterval: 5, // s — a voz é tocada no cliente, na posição da rede
        chirpMaxInterval: 15,
        chirpVolume: 0.7,
      },

      /* ------------------------------------------------------------- naves --
         O disco voador que cruza o céu: abatível, e o estouro mata. */
      ship: {
        /* UMA de cada vez, e raramente.
           Com duas vivas nascendo a cada 14–36 s havia quase sempre uma nave
           riscando o céu, e o que era para ser um acontecimento virou trânsito:
           quando algo passa o tempo todo, ninguém levanta a cabeça. Uma nave
           sozinha, a cada dois ou três minutos, volta a ser a coisa rara que
           faz o jogador parar de mirar para olhar. */
        maxAlive: 1,
        spawnMin: 105, // s
        spawnMax: 210,
        alturaMin: 52, // m acima do chão
        alturaMax: 78,
        velMin: 22, // m/s
        velMax: 34,
        raioRota: 260, // m — a reta atravessa a arena inteira
        humInterval: 1.9, // s entre repetições do zumbido enquanto ela passa
        /* O zumbido é CENÁRIO, não aviso.
           A 0,75 ele passava por cima do estalo da corda e do guincho do alien
           — e são esses dois que dizem ao jogador o que está acontecendo com
           ELE. A nave continua audível de longe (o alcance de 240 m em
           `audio.js` não mudou); ela só parou de mandar na mixagem. */
        humVolume: 0.3,
        explosionRadius: 13, // m — quem estiver dentro quando ela cai, morre
      },

      /* -------------------------------------------------------- meteoritos --
         Rocha grande em deriva lenta, em que dá para pousar de jetpack. */
      meteors: {
        max: 3,
        spawnMin: 16, // s
        spawnMax: 34,
        raioMin: 2.4, // m — grande o bastante para caber um jogador em cima
        raioMax: 3.6,
        velMin: 1.2, // m/s — deriva, não meteoro em queda
        velMax: 2.6,
        alturaMin: 11, // m acima do chão
        alturaMax: 26,
        giro: 0.12, // rad/s de tombo lento
        hp: 3, // flechas para estourar
        escoltaMin: 5, // pedrinhas acompanhando, como cauda
        escoltaMax: 9,
        explosionRadius: 7, // m
        formatos: 3, // variantes de silhueta

        /* -------------------------------------------------------- estilhaços --
           Eles MATAM ENQUANTO VOAM e param de matar assim que assentam. Não é
           detalhe de física: é o que dá consequência a estourar um meteorito em
           cima da cabeça de alguém — inclusive da sua. Um pedaço parado no chão
           que continuasse matando viraria uma mina invisível, que é o oposto de
           legível. */
        fragCount: 16,
        fragRaioMin: 0.25, // m
        fragRaioMax: 0.7,
        fragSpeedMin: 5, // m/s radiais
        fragSpeedMax: 13,
        fragKillSpeed: 3.5, // m/s — abaixo disto já não machuca ninguém
        /* m — raio de acerto do pedaço em voo, somado ao raio DELE.
           A 1,1 m os estilhaços eram decorativos: dezesseis pedras espalhadas
           por uma esfera de vinte metros quase nunca cruzam o metro cúbico
           ocupado por uma pessoa, e o estouro terminava sem consequência para
           quem estava fora do raio da explosão. Dois metros e vinte é "passou
           raspando e me pegou" — a leitura que o jogador já esperava. */
        fragKillRadius: 2.2,
        fragRestitution: 0.25, // quique ao bater no chão
        fragSettleTime: 4.0, // s no chão até sumir
        fragFadeTime: 1.0, // s de desaparecimento
      },

      /* ------------------------------------------------------------- rover --
         O veículo que ronda a base. Ver `entities/rover.js`. */
      rover: {
        speed: 3.6, // m/s — entre o passo e a corrida na Lua
        turnRate: 1.0, // rad/s
        probeDist: 7, // m — a que distância ele "olha" o relevo à frente
        maxClimb: 0.8, // m — degrau que ele aceita subir no `probeDist`
        propRayDist: 6, // m — alcance da sonda de obstáculo sólido
        stuckWindow: 3.0, // s de observação do vigia de travamento
        // m — APROXIMOU-SE do destino menos que isto na janela ⇒ travado.
        // É progresso, não distância andada: circular o fundo de uma cratera é
        // andar muito e não chegar a lugar nenhum.
        stuckDistance: 2.0,
        /* s dirigindo reto ao destino, ignorando as sondas.
           Cinco segundos são ~18 m na velocidade de ronda — o bastante para
           atravessar a parede de uma cratera grande de uma vez só. Com menos, a
           fuga terminava no meio da subida e ele escorregava de volta. */
        unstuckTime: 5.0,
      },

      /* ------------------------------------------------------------- duelo --
         Sem arrasto e com 1/6 de g, um tiro tenso de 120 m/s cai 12 cm em 46 m:
         o anel do vale transformaria o arco no revólver que o duelo existe para
         evitar. A 95 m a queda volta a ser leitura. */
      duel: { ringRadius: 95, minSeparation: 90 },
    },

    /* -------------------------------------------------------------- Castelo --
       Mesma Terra do vale: gravidade, ar e vento não mudam, e por isso a
       entrada de `castle` em `shared/levels.js` tem `fisica: {}`. O que muda é
       a HORA — é noite — e a arquitetura, que aqui é regra de jogo.

       Ver `docs/plano-cerco.md` e `shared/castleProps.js`. */
    castle: {
      /* -------------------------------------------------------- a hora --
         O CERCO É UMA TARDE, não uma noite.

         Ele começa com o Sol alto e termina com ele na linha do horizonte:
         `updateDusk` em `main.js` amarra a posição do Sol ao relógio da
         partida, e os vinte minutos do modo são exatamente a distância entre
         as duas. O cronômetro fica, portanto, do lado de FORA da tela — quem
         está sob pressão não lê o relógio do HUD, mas percebe que a luz está
         acabando.

         E ele nunca escurece. É a diferença que separa este dial do da noite
         dos zumbis: lá o escuro É a regra do jogo (fora das tochas não se vê
         nada, e é isso que impede acampar longe); aqui o jogador precisa LER a
         rampa a 90 m para antecipar a fila, do primeiro ao último minuto. Ver
         o bloco de constantes de `setDusk` em `core/renderer.js`. */
      /** A tarde fixa fora do cerco (livre, duelo): sem relógio, sem descida. */
      idleDusk: 0.3,
      fogDensity: 0.0042,

      /* --------------------------------------------------------- braseiros --
         Nos merlões e nos bastiões. Acesos de tarde é coisa de castelo em pé
         de guerra — mas o BRILHO acompanha a luz que resta: quase invisíveis
         com o Sol alto, e a única coisa quente no quadro quando ele se põe. É
         o mesmo papel das tochas do modo zumbi com uma diferença de intenção:
         lá a luz é o objetivo a defender, aqui ela marca o adarve para quem
         está embaixo — e marca o jogador para a catapulta, o que é justo. */
      /* `luz: true` marca quem carrega uma `PointLight` de verdade; o resto é
         cesto emissivo. A escolha é DECLARADA e não derivada ("o do meio"),
         porque ela decide onde se enxerga: o pátio ficava sem uma única luz
         dinâmica, e é lá que se renasce e que se repara o portão com o relógio
         correndo. A face interna do muro olha para longe do Sol do poente — no
         escuro, o jogador atravessava um breu de trinta metros para chegar a um
         portão que não via. */
      /* `adarve: true` põe o braseiro no piso do MURO; sem ele, no pátio. A
         escolha é declarada porque a regra que a inferia do z (`z > courtZBack
         + 2`) mandava para cima do muro qualquer coisa que não estivesse colada
         no fundo — e os braseiros novos do portão nasciam boiando a onze metros.

         E os do adarve estão na faixa de DENTRO (z = 3,2), não na hourd: a
         câmera de terceira pessoa fica quatro metros atrás do arqueiro, que
         está em z = 8,3, então tudo o que estiver adiante de z ≈ 4,3 entra no
         quadro. Em 6,4 um cesto de fogo de meio metro ocupava um sexto da tela.
         Em 3,2 eles ficam atrás da câmera e continuam desenhando a linha do
         muro para quem olha de baixo, que é o trabalho deles. */
      braziers: [
        { x: -14, z: 3.2, adarve: true },
        { x: -8.2, z: 3.2, adarve: true },
        { x: 8.2, z: 3.2, adarve: true, luz: true },
        { x: 14, z: 3.2, adarve: true },
        // Os dois do PÁTIO, ladeando o vão do portão pelo lado de dentro: eles
        // marcam o raio de reparo sem precisar de um círculo no chão.
        { x: -4.6, z: 1.4, luz: true },
        { x: 4.6, z: 1.4 },
        { x: 0, z: -13 },
      ],
      brazierRange: 15, // m
      brazierIntensity: 26,
      brazierColor: 0xffa542,
      brazierHeight: 1.1, // m acima do piso em que está

      /* --------------------------------------------------------- horizonte --
         A serra do `castleField` resolve o fundo; isto é só o quanto da malha
         distante ainda vale desenhar. */
      skirtSectors: 96,
      skirtRings: 12,
      skirtOuter: 900, // m

      /* --------------------------------------------------------- nascimento --
         No cerco quem nasce vai para o ADARVE, não para o chão: o modo inteiro
         acontece lá em cima, e cair de 11 m ao entrar seria uma piada cara.
         Fora do cerco (livre, duelo) vale o pátio, por `spawnCenter`. */
      spawnDrop: 0.6, // m
    },

    /* ----------------------------------------------------------- sandbox --
       Cenário de TESTE, isolado das outras fases: serra pequena e barata para
       avaliar textura triplanar + pedra instanciada + cratera dinâmica sem
       tocar no vale. Ver `shared/sandboxField.js` e `entities/sandboxGround.js`. */
    sandbox: {
      radius: 46, // m — borda jogável
      flatRadius: 14, // m — miolo plano, onde a arqueira nasce
      wallStart: 20, // m — onde a serra começa a subir
      rampLength: 20, // m — comprimento característico da subida (satura)
      peak: 26, // m — altura de referência da crista
      floorNoise: 0.35, // m — ondulação do piso plano

      world: {
        half: 50, // m — meia-extensão da malha (um pouco além da borda jogável)
        segments: 110, // malha pequena e uniforme: ~24 k triângulos, cabe barato
      },

      rocks: { count: 26 },
      grass: { count: 900 },

      /* ---------------------------------------------------------- cratera --
         Cratera DINÂMICA de verdade (a Lua é estática, sorteada uma vez — ver
         `moonField.js`). O raio cresce com a velocidade de impacto da flecha. */
      destruction: {
        craterBase: 0.8, // m — raio mínimo, de qualquer tiro que encoste
        craterGain: 0.55, // m por √(m/s) — quanto a velocidade infla o raio
        craterMax: 7, // m — teto do raio
        craterDepth: 0.42, // fundura = craterDepth × raio
        craterLimit: 24, // crateras simultâneas; a mais velha cede à mais nova
      },
    },
  },

  debug: {
    // Critério de aceite nº 1: sem arrasto e sem vento, 45° a 60 m/s deve bater
    // com v₀²·sen(2θ)/g dentro de 1 %.
    selfTest: { speed: 60, angleDeg: 45, tolerance: 0.01 },
  },

  boar: {
    visionRange: 25, // m — distância para detectar jogador e fugir
    walkSpeed: 1.4, // m/s
    /* Assustado, o javali é MAIS RÁPIDO que o arqueiro correndo (9,6 m/s).
       Tem de ser: se dá para alcançá-lo a pé, a caçada vira uma caminhada até
       encostar o arco nele e o tiro à distância perde a razão de existir. Este
       número está amarrado ao `player.runSpeed` logo acima — mexeu num, confira
       o outro. */
    fleeSpeed: 11.0, // m/s
    scareRadius: 6, // m — flecha cai perto e assusta
    scareDuration: 4, // s — fuga após flecha perto
    fleeDuration: 5, // s — fuga ao ver jogador
    /* Investida rara: ao avistar um jogador, ~5 % viram agressivos em vez de
       fugir. A corrida usa `fleeSpeed` — mesma velocidade da fuga. */
    chargeChance: 0.05,
    chargeDuration: 10, // s — desiste se não alcançar
    attackRadius: 1.2, // m — distância do impacto no jogador
    chargeCooldown: 8, // s — o mesmo porco não investe de novo logo em seguida
    eatDuration: 3, // s — animação de comer
    wanderMaxTime: 8, // s — tempo andando antes de comer
    calmDuration: 3, // s — acalmar após fugir
    wanderRadius: 12, // m
    spawnMinDist: 30, // m — spawn longe do jogador
    spawnMaxDist: 50, // m

    /* Bando: a maioria dos porcos de uma onda nasce em grupo e pasta perto um
       do outro; uma fração nasce desgarrada e vaga sozinha, como sempre fez.
       O bando em si é um ponto que deriva devagar pelo mapa (`driftSpeed`),
       bem mais lento que um porco andando — os membros orbitam esse ponto,
       não uns aos outros, o que evita que precisem saber a posição uns dos
       outros a cada passo. */
    herd: {
      maxSize: 6, // porcos por bando, no máximo
      soloChance: 0.2, // fração da onda que nasce desgarrada
      radius: 5, // m — até onde um membro se afasta do ponto do bando ao pastar
      driftSpeed: 0.35, // m/s — velocidade do próprio ponto do bando
      driftInterval: 14, // s — intervalo médio entre um novo destino do bando
    },
    colliderHalfHeight: 0.28, // m
    colliderRadius: 0.32, // m
    bodyHeight: 0.75, // m

    /* Marcha. Como no arqueiro, a fase do passo avança com a DISTÂNCIA
       percorrida, não com o relógio: um ciclo completo a cada `strideLength`
       metros. Antes era um número fixo de radianos por segundo, e o resultado
       era um bicho patinando — a 11 m/s as pernas continuavam no mesmo ritmo
       de quando ele pastava a 1,4 m/s. */
    strideLength: 0.78, // m por ciclo completo de perna, andando
    /* Correndo, a passada ALONGA — não é só a cadência que sobe.
       Sem isso, 11 m/s divididos por uma passada de andar davam 14 ciclos por
       segundo: as pernas viravam um borrão e o bicho parecia acelerado num
       vídeo. Com o alongamento, o galope fica em ~6 passadas por segundo, que é
       a faixa de um quadrúpede correndo de verdade. É a mesma ideia do
       `runStrideGain` do arqueiro. */
    runStrideGain: 1.4, // quanto a passada cresce na velocidade de fuga
    idleCadence: 1.1, // rad/s de fase mesmo parado (rabo, respiração)
    legSwing: 0.62, // rad — abertura máxima da perna
    legSwingSpeed: 6.0, // m/s em que a abertura satura

    /* O ronco. Sai com intervalo sorteado dentro desta faixa, e só enquanto o
       porco está de pé e se mexendo — um bicho parado comendo não bufa, e um
       ronco a cada segundo viraria ruído. O sorteio é LOCAL de propósito: é som
       ambiente, e dois jogadores ouvirem o mesmo grunhido com meio segundo de
       diferença não muda nada do jogo. */
    snortMinInterval: 4.5, // s
    snortMaxInterval: 11, // s
    snortVolume: 0.9,
  },

  /* ------------------------------------------------------------------ alce --
     Grande, forte e com barra de vida: não morre de uma flechada.

     A ideia do bicho é inverter a caçada. O porco foge; o alce ATACA — quanto
     mais flecha ele leva, mais rápido vem, e a única defesa é sair da linha da
     investida a tempo. É por isso que ele acumula flechas cravadas no corpo em
     vez de morrer no primeiro acerto: a barra de vida é o cronômetro da briga. */
  elk: {
    /* Vida base = 12 flechas × 1 jogador. No spawn do modo multiplica por N. */
    arrowsToKillPerPlayer: 12,
    arrowDamage: 5, // ⇒ 12 flechas por jogador (vida = damage × 12 × N)
    maxHealth: 60, // fallback / alce fun (1 jogador)

    /* ------------------------------------------------------------- ritmo --- */
    walkSpeed: 2.6, // m/s — pastando
    fleeSpeed: 7.2, // m/s — fugindo (−40% vs 12; era 15 antes do primeiro ajuste)
    chargeSpeed: 12.5, // m/s — investida
    chargeSpeedPerHit: 0.3, // m/s a mais por flecha levada
    chargeSpeedMax: 14.5, // m/s

    /* --------------------------------------------------------- percepção --- */
    visionRange: 70, // m
    alertRange: 60, // m
    fleeRange: 48, // m
    alertDuration: 4.5, // s — cabeça levantada se o player ficar parado
    alertApproach: 2.5, // m mais perto após o alerta → foge
    alertMoveDist: 1.8, // m de deslocamento do player após o alerta → foge
    grazeSettle: 4.5, // s
    scareRadius: 8, // m — flecha no chão perto assusta (como o porco)
    woundedFleeTime: 1.5, // s de fuga curta quando já ferido (≥5 hits)

    /* ----------------------------------------------------- lobos do alce --- */
    wolfSummonHealth: 0.7, // fração de vida: chama a primeira horda
    wolfPackBase: 2,
    wolfPackPerPlayer: 1, // total = base + perPlayer × (N − 1) — −40% vs 4+2(N−1)
    wolfWaveGap: 8, // s entre ondas se a pack foi limpa e vida ≤ limiar
    /* Limpar a matilha não basta para chamar a próxima: o alce precisa levar
       mais flechas. Sem isso, quem matasse os lobos e recuasse via matilha nova
       nascer sozinha a cada 8 s — a caçada virava um moedor de lobos em que o
       alce nunca era o problema. Agora a onda seguinte é resposta ao dano. */
    wolfWaveHits: 6, // flechadas no alce entre uma matilha e a seguinte
    wolfSpawnRadius: 6, // m ao redor do alce (centro da faixa)
    wolfSpawnRadiusMin: 5, // m — alguns mais perto do alce
    wolfSpawnRadiusMax: 14, // m — outros nascem longe e demoram a chegar
    wolfSpawnStagger: 1.2, // s entre cada lobo da onda
    // Modo alce: WOLF_SPEED_FAST − 30%.
    wolfSpeed: WOLF_SPEED_FAST * 0.7,
    wolfLeapSpeed: WOLF_LEAP_FAST * 0.7,
    wolfAI: {
      turnRateMax: 3.2,
      turnRateMin: 1.1,
      accel: 21.0,
      brake: 33.0,
      speedApproach: 0.65,
      speedChase: 1.0,
      separationRadius: 1.8,
      whiskerAngle: 0.61,
      bearingOffsetMin: 0.26,
      bearingOffsetMax: 0.61,
      bearingHoldMin: 3.0,
      bearingHoldMax: 6.0,
      approachFadeDist: 18,
      leapAlignCone: 0.61,
      leapLandSpeedFrac: 0.55,
    },
    wolfPoints: 60,

    /* --------------------------------------------------------- investida --- */
    chargeChance: 0.65,
    chargeChancePerHit: 0.015,
    chargeDuration: 7.0, // s
    chargeCooldown: 0.7, // s
    /* A TRAVA DA INVESTIDA — é o que torna a esquiva possível.
       Dentro deste raio o alce para de corrigir o rumo: fixa a mira (com
       antecipação moderada) e vem em linha reta, como um touro. A 11 m e
       12,5 m/s são ~0,9 s de janela para sair de lado. Antes da trava ele
       ainda aproxima e corrige, sem grudar indefinidamente no strafe. */
    commitDistance: 11, // m — a partir daqui o rumo está travado
    // Passou do jogador e não acertou: ainda leva a tonelada por mais alguns
    // metros antes de conseguir parar. É o preço do embalo, e é a recompensa
    // visível de quem desviou.
    overshootDistance: 14, // m de rolagem depois do ponto travado
    turnRate: 0.9, // rad/s
    giveUpTicks: 8,
    goreRadius: 1.5, // m — galhada (~ raio alce 0,82 + player 0,35 + ponta)
    nearestBias: 0.65,
    leadTime: 0.22, // s — antecipação moderada antes da trava
    leadTimePerHit: 0.008, // s a mais por flecha (ferido = mais preciso)
    rechargeOnMissChance: 0.7, // após miss com hits≥3
    rechargeOnMissMinHits: 3,
    woundedHuntMinHits: 5,

    /* ------------------------------------------------------- quebrar o susto --
       Duas flechas NO MEIO da investida e ele desiste: gira, foge e fica um
       tempo sem coragem de voltar. É a única defesa que não depende de correr —
       quem tem sangue frio para acertar o bicho que vem em cima paga menos que
       quem só desvia. Uma flecha só não resolve: seria fácil demais. */
    chargeBreakHits: 2, // flechas durante a investida que a interrompem
    scaredRecoverTime: 4.5, // s sem investir depois do susto
    missRecoverTime: 2.0, // s sem investir depois de passar direto

    /* --------------------------------------------------- desvio de flecha --- */
    // Gradual com a vida: quase não desvia intacto; perto da morte esquiva muito.
    dodgeChance: 0.0273, // proporcional a 8/88 com dodgeChanceAtDeath = 30%
    dodgeChanceAtDeath: 0.30,
    dodgeRadius: 2.5, // m — distância mínima da trajetória ao corpo
    dodgeLeadTime: 0.9, // s — ETA máxima para considerar ameaça
    dodgeDuration: 0.65, // s
    dodgeCooldown: 4.5, // s — espaçado com vida cheia
    dodgeCooldownAtDeath: 1.2, // s — frequente quando ferido
    dodgeSpeed: 11.0, // m/s no pulo lateral
    dodgeJumpHeight: 1.1, // m

    /* Navegação
       maxArenaDist: borda "mole" do sopé. O porco usa 8; 3,5 era curto demais
       na subida da trilha (+z) e a fuga misturava vetores opostos ali.
       minSlope 0.82 ≈ 35° — evita pastar na serra. stuckMinSlope relaxa só
       na fuga do stuck. */
    maxArenaDist: 8,
    minSlope: 0.82,
    stuckMinSlope: 0.68,
    lookAhead: 3.5,
    stuckEscapeTime: 0.35,

    bodyHeight: 2.7, // m
    colliderHalfHeight: 0.82, // m
    colliderRadius: 0.82, // m
    corpseLifetime: 30, // s
    strideLength: 2.3,
    runStrideGain: 1.15,
    killPoints: 400,
    hitPoints: 25,
  },

  /* -------------------------------------------------------------- pássaros --
     Alvos pequenos, altos e em movimento — o oposto do alvo parado a 100 m.

     Ficam sempre em cena, em qualquer modo, porque são cenário vivo antes de
     serem alvo. O ciclo é voar em círculo, descer numa copa, ficar ali um
     tempo e levantar voo de novo; uma flecha que passe perto os espanta mesmo
     sem acertar, que é o que torna o tiro difícil de repetir. */
  birds: {
    count: 7, // quantos existem ao mesmo tempo
    cruiseHeight: 26, // m acima do chão em voo de cruzeiro
    heightSpread: 12, // m de variação entre indivíduos
    flySpeed: 9.0, // m/s
    diveSpeed: 12.0, // m/s ao descer para a copa
    circleRadius: 70, // m — raio do circuito de voo sobre a arena
    perchMinTime: 6, // s pousado
    perchMaxTime: 18, // s
    flyMinTime: 12, // s no ar antes de procurar poleiro
    flyMaxTime: 30, // s
    scareRadius: 12, // m — flecha que cai perto levanta o bando local
    hitRadius: 0.55, // m — colisor do bicho
    corpseLifetime: 8, // s até o corpo sumir do chão
    fallSpeed: 14, // m/s — velocidade terminal da queda
    points: 150, // alvo pequeno e em movimento: paga bem
  },

  /* ------------------------------------------------------------------- bot --
     A perícia do adversário de CPU. Ver `server/botSim.js` para a mira em si —
     aqui ficam só os números que decidem o quanto ele erra.

     DUAS coisas separadas decidem o resultado de um tiro:

     • `missChance` é a pergunta "ele vai ERRAR de propósito este tiro?" — a
       porcentagem de tiros que saem com um desvio GRANDE (`erroMira × missSpread`),
       longe o bastante para não acertar quase nunca. É o "atirar torto".
     • `erroMira`, sozinho, é o tremor da mão presente em TODO tiro — inclusive
       nos que não erram de propósito. Mesmo "certeiro", o tiro carrega esse
       tanto de imprecisão; é o que separa um bot fácil de um que não erra
       jamais mesmo na dificuldade mais alta.

     Trocar de dificuldade é só trocar `difficulty` — nenhum outro arquivo
     precisa saber que a tabela existe. */
  bot: {
    /** Perícia padrão de bot novo. Troque aqui — ou pela tecla N, em jogo. */
    difficulty: "easy",

    /* A perícia PADRÃO DE CADA MODO, aplicada ao entrar nele.
     *
     * `easy` é o padrão certo enquanto o bot for ADVERSÁRIO: um duelo contra
     * uma máquina que não erra não é um duelo. Nos modos em que ele é ALIADO a
     * conta se inverte — um arqueiro de guarnição que erra dois de cada três
     * tiros não é ajuda, é enfeite, e o jogador paga a conta sozinho.
     *
     * Chuva e cerco pedem níveis diferentes, e a razão INVERTEU depois que a
     * flecha do bot passou a chegar no alvo (ela morria na barreira lunar — ver
     * `MoonField.isInsideWorld`).
     *
     * Enquanto ele errava tudo, `hard` na chuva era o mínimo para ele servir de
     * alguma coisa. Consertado, o mesmo `hard` acerta 93 % das flechas numa
     * rocha: três bots limpam o céu antes de o jogador levantar a cabeça, e o
     * modo — cuja graça inteira é a contagem regressiva de cada pedra — vira
     * plateia. `easy` devolve o céu para quem está jogando e mantém o bot como
     * a rede de segurança que ele deve ser.
     *
     * No cerco é o contrário: lá a derrota é uma TAXA, o defensor divide 34 m de
     * muro com a fila do portão crescendo, e um aliado que erra dois de cada
     * três tiros não é ajuda, é enfeite. Quem quiser outra coisa tem a tecla N. */
    modeDifficulty: {
      meteorRain: "easy",
      siege: "hard",
    },
    /** Teto de adversários de CPU em campo ao mesmo tempo. */
    maxBots: 6,

    /* Coleira: até onde o bot pode se afastar da bacia jogável.
       Medida em `arenaDistance` (negativo = dentro da arena), então 12 significa
       "pode subir 12 m sopé acima e nem um metro além". Sem ela os bots subiam a
       serra e duelavam no alto, fora do campo de visão de quem ficou embaixo. Na
       Lua o valor não muda nada: lá `arenaDistance` já é negativo em toda a
       arena e a barreira circular resolve sozinha. */
    leash: 12, // m de `arenaDistance`

    /* Quanto o bot PREFERE um adversário a um bicho.
       A distância até o bicho é multiplicada por isto na escolha do alvo: com
       1.8, um porco a 20 m só ganha de um duelista a 36 m. O bot continua sendo
       um duelista que atira na caça de passagem, não um caçador que ignora
       você. */
    creaturePenalty: 1.8,
    difficulties: {
      easy: {
        erroMira: 0.026, // rad — mão trêmula mesmo quando "acerta"
        missChance: 0.62, // quase 2 em 3 tiros saem deliberadamente tortos
        missSpread: 7, // × erroMira, no tiro que erra de propósito
        reacao: 0.55, // s até reagir a uma mudança sua
        precisaoLead: 0.5, // erra a liderança de alvo em movimento
        pausaChance: 0.55,
        pausaMin: 0.8,
        pausaMax: 1.6,
        avancoChance: 0.3,
        avancoIntervalo: 7,
        avancoMin: 3.0,
        avancoMax: 6.0,
        avancoMetros: 16,
      },
      medium: {
        erroMira: 0.013,
        missChance: 0.22,
        missSpread: 7,
        reacao: 0.32,
        precisaoLead: 0.78,
      },
      hard: {
        erroMira: 0.007,
        missChance: 0.06,
        missSpread: 6,
        reacao: 0.16,
        precisaoLead: 0.95,
        pausaChance: 0.2,
        pausaMin: 0.35,
        pausaMax: 0.7,
        avancoChance: 0.2,
        avancoIntervalo: 9,
        avancoMin: 2.0,
        avancoMax: 3.5,
        avancoMetros: 10,
      },
    },
  },
};

/* ---------------------------------------------------------------- qualidade --

   `applyQuality` achata o preset escolhido dentro de `CONFIG.render`.

   Chamada uma vez no arranque, ANTES de qualquer coisa ser construída — é isso
   que garante que o shadow map, o contador de estrelas e a densidade da grama
   já nasçam no tamanho certo, sem ninguém precisar reconstruir nada depois.

   A qualidade preferida sobrevive à sessão em `localStorage`: quem baixou para
   `low` porque a máquina engasgava não quer refazer isso a cada partida. */

const QUALITY_KEY = "arcoflecha.quality";

export function applyQuality(nome) {
  const presets = CONFIG.render.presets;
  const escolhido = presets[nome] ? nome : "high";
  CONFIG.render.quality = escolhido;
  Object.assign(CONFIG.render, presets[escolhido]);
  // A intensidade da tocha é derivada, não copiada: o número de referência
  // continua sendo o do modo (30), e o preset só diz que fração dele se paga.
  CONFIG.modes.zombie.torchIntensity = 30 * CONFIG.render.torchIntensityScale;
  try {
    localStorage.setItem(QUALITY_KEY, escolhido);
  } catch {
    /* modo privado, iframe sem storage: a qualidade vale só para esta sessão */
  }
  return escolhido;
}

/** A qualidade guardada da última vez, ou `high` se nunca houve escolha. */
export function savedQuality() {
  try {
    return localStorage.getItem(QUALITY_KEY) ?? "high";
  } catch {
    return "high";
  }
}

/**
 * Quanto dura o especial PARA O CORPO, do primeiro quadro ao arco de volta.
 *
 * Uma função e não uma constante porque três lugares precisavam da mesma soma
 * — a máquina de estados (`systems/special.js`), a linha do tempo da pose
 * (`entities/player.js`) e o esmaecimento do HUD (`main.js`) — e eles já
 * tinham divergido uma vez. Note que a parcela é `poseDissipate` e não
 * `dissipate`: a cauda do feixe sobrevive à pose de propósito. Ver o bloco das
 * fases em `CONFIG.special`.
 */
export function kameTotal() {
  const S = CONFIG.special;
  return S.charge + S.release + S.sustain + S.poseDissipate + S.recover;
}

/**
 * O especial existe neste modo?
 *
 * Uma função e não um `includes` espalhado porque `CONFIG.special.modes` aceita
 * `"*"` — "em todos" —, e a alternativa era repetir a mesma condição de três
 * caracteres em quatro arquivos e esquecer um. Ver o comentário do campo.
 */
export function specialEnabled(mode) {
  const m = CONFIG.special.modes;
  if (m === "*") return true;
  return Array.isArray(m) && m.includes(mode);
}

/** Velocidade inicial em função do tempo de tensionamento (s). */
export function drawSpeed(drawTime) {
  const t = Math.min(1, Math.max(0, drawTime / CONFIG.bow.fullDrawTime));
  // Curva monotônica que satura: o arqueiro ganha muito rápido no início e
  // pouco no fim do curso, como a curva força × abertura de um recurvo.
  const eased = 1 - Math.pow(1 - t, 1.7);
  return CONFIG.bow.minSpeed + (CONFIG.bow.maxSpeed - CONFIG.bow.minSpeed) * eased;
}

/** Fração 0..1 do curso do arco (para HUD e animação). */
export function drawFraction(drawTime) {
  return Math.min(1, Math.max(0, drawTime / CONFIG.bow.fullDrawTime));
}
