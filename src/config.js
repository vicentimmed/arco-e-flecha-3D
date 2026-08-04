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
    maxSpeed: 85, // m/s — tensão máxima
    fullDrawTime: 1.2, // s até a tensão máxima
    holdBeforeShake: 3.0, // s segurando antes de começar a tremer
    shakeAmplitude: 0.0055, // rad/s de tremor acumulado
  },

  wind: {
    enabled: true,
    baseSpeed: 3.5, // m/s
    maxSpeed: 12.0, // m/s
    directionDrift: 0.055, // Hz — velocidade de giro da direção
    speedDrift: 0.09, // Hz — velocidade de variação da intensidade
    // A rajada NÃO é sorteada: ela sai de um canal de ruído próprio, função pura
    // do relógio. Isso é o que permite dois jogadores verem a mesma flecha
    // derivar do mesmo jeito sem trocar um único byte sobre a trajetória — o
    // vento é a única entrada do voo que não viaja no evento de disparo.
    gustRate: 0.2, // Hz — velocidade do canal de rajada
    gustThreshold: 0.45, // -1..1 — acima disso venta forte; maior = mais raro
    gustStrength: 5.0, // m/s adicionais no pico da rajada
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
    shadowMapSize: 2048,
    shadowRange: 46, // m — meia-largura do frustum de sombra que segue o jogador
    exposure: 1.0,
    maxPixelRatio: 2,
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
    cull: {
      shadow: 25, // m — além disso o jogador remoto para de projetar sombra
      hide: 160, // m — além disso nem é desenhado
    },
  },

  /* ---------------------------------------------------------------- nascer --
     Todo mundo nasce igual: caindo de 10 m, piscando, num ponto plano perto do
     centro. Vale para quem entra na sala e para quem acabou de morrer. */
  spawn: {
    centerX: 0, // centro da bacia jogável
    centerZ: -40,
    radius: 38, // m — raio máximo do sorteio
    minRadius: 6, // m — não nasce colado no centro exato
    dropHeight: 10, // m acima do chão
    invulnerability: 4, // s piscando e imune
    blinkHz: 6,
    minSeparation: 14, // m entre dois nascimentos simultâneos
    manualCooldown: 10, // s entre renascimentos pedidos na mão (tecla K)
    maxAttempts: 60, // tentativas de sorteio antes de relaxar o critério
    deathDuration: 1.4, // s — o corpo tomba antes de renascer
    respawnDelay: 2.4, // s entre morrer e nascer de novo
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
      firstDistance: 25, // m — o primeiro alvo, logo à frente
      lastDistance: 300, // m — o último, na encosta da serra
      steps: 12, // quantos alvos até chegar ao mais distante
      pointsBase: 50, // pontos do primeiro alvo
      pointsPerStep: 1.32, // multiplicador de pontos a cada alvo vencido
      markerHeight: 5.0, // m — altura da seta indicadora sobre o alvo
      explosionTime: 1.0, // s de explosão ao acertar
      startZ: 26, // m — a linha de tiro, no começo da estrada
      lineSpread: 6, // m — afastamento lateral entre jogadores na linha
    },

    boarHunt: {
      initialBoars: 5, // quantos aparecem ao ativar o modo
      waveInterval: 8, // s entre ondas
      waveSize: 2, // porcos por onda
      waveGrowth: 1, // +N porcos a cada onda que passa
      maxAlive: 30, // teto de porcos vivos ao mesmo tempo
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
  },

  debug: {
    // Critério de aceite nº 1: sem arrasto e sem vento, 45° a 60 m/s deve bater
    // com v₀²·sen(2θ)/g dentro de 1 %.
    selfTest: { speed: 60, angleDeg: 45, tolerance: 0.01 },
  },

  boar: {
    visionRange: 25, // m — distância para detectar jogador e fugir
    walkSpeed: 1.4, // m/s
    fleeSpeed: 4.5, // m/s
    scareRadius: 6, // m — flecha cai perto e assusta
    scareDuration: 4, // s — fuga após flecha perto
    fleeDuration: 5, // s — fuga ao ver jogador
    eatDuration: 3, // s — animação de comer
    wanderMaxTime: 8, // s — tempo andando antes de comer
    calmDuration: 3, // s — acalmar após fugir
    wanderRadius: 12, // m
    spawnMinDist: 30, // m — spawn longe do jogador
    spawnMaxDist: 50, // m
    colliderHalfHeight: 0.28, // m
    colliderRadius: 0.32, // m
    bodyHeight: 0.75, // m
  },
};

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
