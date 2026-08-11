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
    maxStuckPerPlayer: 24, // flechas cravadas simultâneas por arqueiro
    maxStuckTotal: 200, // teto absoluto de flechas cravadas na cena
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
    reloadTime: 1.0, // s
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
    // Enquadramento de trás e por cima do ombro: a arqueira fica à esquerda do
    // quadro e o campo de tiro à direita, como na referência. A câmera pode
    // ficar longe da linha de tiro sem prejudicar a mira porque a linha de tiro
    // converge no ponto sob o retículo (systems/aim.js).
    distance: 4.15, // m atrás do ponto de disparo
    right: 1.25, // m à direita da linha de tiro
    up: 0.5, // m acima
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
      hordeSizes: [2, 4, 8, 12, 16, 20, 26, 34],
      hordes: 9,
      hordeSpeeds: [1.0, 1.1, 1.2, 1.35, 1.5, 1.65, 1.8, 1.95],
      hordeDelay: 3.0, // s entre a última morte e a horda seguinte
      lateHordeFrom: 6, // hordas ≥6: ETA ao centro espaçado
      lateHordeSizeFrom: 16,
      spawnRadius: 36, // m — legado
      spawnRadiusMin: 28,
      spawnRadiusMax: 50,
      spawnRadiusMaxLate: 58, // hordas grandes: nascem mais longe
      spawnJitter: 4,
      spawnStagger: 0.85,
      speedVariationLate: 0.28, // hordas ≥6: quebra pelotão

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

      // Metade dos lobos por horda, mantendo ao menos um nas primeiras ondas.
      wolfCounts: [1, 1, 2, 2, 3, 3, 4, 5],
      // Lobos não nascem todos no start: 1 a cada N zumbis mortos nesta horda.
      wolfEveryZombieKills: 3,
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
      },

      /* -------------------------------------------------------------- base -- */
      base: { x: 0, z: -97 },

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
