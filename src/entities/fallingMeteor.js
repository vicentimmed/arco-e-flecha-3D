/* ---------------------------------------------------------------------------
   Uma rocha caindo, na tela.

   A casca visual de uma entidade da SALA (`server/meteorSim.js`): aqui não se
   decide nada — nem onde ela está, nem quanto de vida tem, nem quando estoura.
   O que existe aqui é o que só pode existir dentro dos olhos de quem olha.

   TRÊS DECISÕES QUE VALEM SER LIDAS ANTES DO CÓDIGO:

   1. **ELA É GRANDE.** Raio de 2,5 a 14 m. Com o FOV de 58° e 720 px de tela, a
      menor entra com 18 px de diâmetro a 200 m; com os 1,2 m que o meteorito da
      Lua livre usa, entraria com OITO — o que não é um meteoro, é um artefato
      de compressão. E o tamanho não custa nada: `esculpir()` devolve um
      icosaedro de 320 faces seja qual for o raio, e preenchimento de pixel sem
      sombra é a coisa mais barata do quadro.

   2. **NENHUMA LUZ DINÂMICA.** Dezesseis `PointLight` seriam dezesseis
      recompilações de material e o fim do quadro (ver `plano-lua-desempenho`).
      O brilho é emissivo + bloom + um halo aditivo — e é o halo que segura a
      leitura no preset `low`, que não tem bloom nenhum.

   3. **A MANCHA NO CHÃO** é a peça mais importante do arquivo, e não é enfeite.
      Ela marca onde a rocha VAI cair e acende conforme desce: é o que faz o
      impacto ser justo (ninguém morre sem ter tido onde ler o aviso) e é metade
      do espetáculo, porque um círculo de vinte metros de luz crescendo no chão
      da base diz "vem coisa grande" melhor do que qualquer HUD.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType } from "../core/events.js";
import { esculpir } from "../systems/spaceLife.js";
import { meteorEntity } from "../shared/protocol.js";

const SUAVIZA = 14; // 1/s — quão depressa a pose de rede é alcançada

/* Uma textura de disco macio, gerada uma vez para o jogo inteiro: serve ao halo
   da rocha e à mancha do chão. Um canvas de 128 px custa menos que carregar um
   arquivo e nunca some do bundle. */
let _discoTex = null;
function discoTexture() {
  if (_discoTex) return _discoTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,225,170,0.72)");
  grad.addColorStop(0.75, "rgba(255,130,40,0.20)");
  grad.addColorStop(1.0, "rgba(255,90,20,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _discoTex = new THREE.CanvasTexture(c);
  _discoTex.colorSpace = THREE.SRGBColorSpace;
  return _discoTex;
}

/* ---------------------------------------------------------------- geometria --
   AS MALHAS SÃO COMPARTILHADAS, e este cache é a otimização mais importante do
   arquivo.

   `esculpir()` monta um icosaedro de 960 vértices e passa por cada um deles
   aplicando alongamento, ruído e crateras. Fazer isso POR ROCHA, num modo em
   que trinta pedras nascem e estouram ao longo de cada horda com sala cheia,
   é montar e jogar fora dezenas de milhares de vértices por minuto — CPU no
   quadro do nascimento e, pior, uma alocação/liberação de buffer na GPU a cada
   pedra que aparece e a cada pedra que some.

   E é gasto à toa: a forma só depende de (raio, formato), e existem TREZE
   combinações no jogo inteiro — três classes × três silhuetas, mais os quatro
   tamanhos de colosso. Cada uma é construída uma vez e emprestada para sempre.
   Elas nunca são descartadas de propósito: são treze buffers pequenos que valem
   muito mais parados na memória do que reconstruídos.

   O mesmo vale para o disco da mancha do chão, que é uma `CircleGeometry` nova
   por rocha para desenhar sempre o mesmo círculo em raios diferentes. */
const _malhas = new Map();
function malhaDe(raio, formato) {
  const chave = `${raio}|${formato}`;
  let g = _malhas.get(chave);
  if (!g) {
    g = esculpir(raio, formato);
    _malhas.set(chave, g);
  }
  return g;
}

const _discos = new Map();
function discoDe(raio) {
  let g = _discos.get(raio);
  if (!g) {
    g = new THREE.CircleGeometry(raio, 32);
    g.rotateX(-Math.PI / 2);
    _discos.set(raio, g);
  }
  return g;
}

export class FallingMeteor {
  /**
   * @param {THREE.Scene} scene
   * @param {object} physics
   * @param {number} netId id da sala
   * @param {number} raio m
   * @param {number} formato variante de silhueta (0–2)
   * @param {number} maxHits flechas para estourar — decide a cor das brasas
   */
  constructor(scene, physics, netId, raio, formato, maxHits) {
    const M = CONFIG.modes.meteorRain;
    this.physics = physics;
    this.netId = netId;
    this.raio = raio;
    this.maxHits = Math.max(1, maxHits);
    this.hp = 1;
    this.dead = false;
    this.flash = 0;
    this.trailTimer = 0;
    this.alvo = new THREE.Vector3();
    this.primeiro = true;
    this._chao = 0;
    /** A maior altitude já vista desta rocha — a régua da mancha do chão. */
    this._altRef = CONFIG.modes.meteorRain.spawnAltitude;
    /** Distância até a câmera, medida no último quadro. Ver `piscar`. */
    this._camDist = Infinity;

    this.group = new THREE.Group();
    /* O tombo gira um grupo INTERNO. Girar o externo giraria junto o halo, que
       é um billboard e não pode rodar, e a chama, que aponta para cima. */
    this.giro = new THREE.Group();
    this.group.add(this.giro);

    /* A rocha. O emissivo é a coisa toda: no preto do céu lunar, um material
       apenas difuso a 200 m do único Sol é uma silhueta escura contra fundo
       escuro — invisível. Ela precisa emitir a própria luz para ser vista. */
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x3a2a22,
      emissive: new THREE.Color(M.fireColor),
      emissiveIntensity: 1.5,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: true,
    });
    const rocha = new THREE.Mesh(malhaDe(raio, formato), this.mat);
    // Sombra não: a 200 m de altura a mancha que ela projetaria gastaria
    // resolução do mapa da cena inteira para desenhar algo que ninguém
    // associaria à rocha. Quem faz esse trabalho é a mancha do chão, abaixo.
    rocha.castShadow = false;
    this.giro.add(rocha);

    /* O HALO. Um sprite aditivo com 2,2× o diâmetro da rocha — é ele que faz a
       coisa ler como "em chamas" e não como "pedra clara", e é ele que segura
       a leitura onde não há bloom. */
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: discoTexture(),
        color: new THREE.Color(M.glowColor),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.85,
      }),
    );
    const d = raio * 2 * M.haloScale;
    this.halo.scale.set(d, d, 1);
    this.group.add(this.halo);

    /* Um segundo sprite, menor e mais quente: o núcleo. Dois sprites dão o
       degradê branco→laranja que um só não consegue. */
    this.nucleo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: discoTexture(),
        color: new THREE.Color(M.coreColor),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.nucleo.scale.set(raio * 2.1, raio * 2.1, 1);
    this.group.add(this.nucleo);

    /* A MANCHA NO CHÃO. Fica na cena, não no grupo da rocha: ela é do PONTO DE
       QUEDA, e a rocha se move em relação a ele. */
    this.marca = new THREE.Mesh(
      // Geometria emprestada do cache — já deitada, por isso não há `rotation`.
      discoDe(raio * M.markRadius),
      new THREE.MeshBasicMaterial({
        map: discoTexture(),
        color: new THREE.Color(M.glowColor),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: M.markMinAlpha,
      }),
    );
    scene.add(this.marca);

    scene.add(this.group);

    /* O colisor. É com ele que a SUA flecha acerta — mas quem decide se a rocha
       estourou é a sala, que é uma só para todo mundo. */
    this.entityId = meteorEntity(netId);
    this.body = physics.createBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.ball(raio).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, {
      kind: "fallingMeteor",
      entityId: this.entityId,
      netId,
      meteor: this,
    });
  }

  /** Onde ela vai bater. Alimenta a mancha do chão e o alerta do HUD. */
  setImpactPoint(x, y, z) {
    this._chao = y;
    this.marca.position.set(x, y + 0.2, z);
  }

  setNetworkTarget(x, y, z) {
    this.alvo.set(x, y, z);
    if (this.primeiro) {
      this.primeiro = false;
      this.group.position.copy(this.alvo);
    }
  }

  /** Fração de vida restante (1 = inteira). Vem da sala. */
  setHealth(hp) {
    this.hp = Math.max(0, Math.min(1, hp));
  }

  /** Metros até o chão sob ela. É o que o alerta da tela lê. */
  get altitude() {
    return this.group.position.y - this._chao;
  }

  /**
   * Levou uma flecha: PISCA.
   *
   * Em co-op esta é a informação mais importante do modo — ela é o que diz
   * "aquela ali já tem dono", e é o que impede duas pessoas de gastarem duas
   * flechas na mesma pedra. Por isso o clarão é branco e forte, e não um
   * tremeliquezinho: precisa ser lido a duzentos metros, de canto de olho.
   */
  piscar() {
    this.flash = 1;
    /* Menos faíscas a queima-roupa, pelo mesmo motivo do estouro (ver o
       "desconto de perto" em `systems/meteorRain.js`): quem acerta uma rocha
       costuma estar assistindo pela câmera da flecha, ou seja, a meio metro do
       ponto do impacto. Ali cada faísca cobre a tela, e vinte e duas telas
       aditivas empilhadas custam mais do que a imagem que entregam. */
    const perto = this._camDist < this.raio * 6;
    gameEvents.emit(EventType.PARTICLES, {
      position: {
        x: this.group.position.x,
        y: this.group.position.y,
        z: this.group.position.z,
      },
      count: perto ? 8 : 22,
      color: 0xfff0c0,
      speed: 12,
      spread: 1,
      size: 0.5,
      grow: 1.6,
      life: 0.7,
      gravity: -1.62,
      drag: 0.6,
      alpha: 1,
    });
  }

  update(dt, camera) {
    const M = CONFIG.modes.meteorRain;

    // Pose amortecida por cima da amostra de 10 Hz.
    const k = 1 - Math.exp(-SUAVIZA * dt);
    this.group.position.lerp(this.alvo, k);
    this.body?.setNextKinematicTranslation(this.group.position);

    this.giro.rotation.x += M.spin * dt;
    this.giro.rotation.y += M.spin * 0.63 * dt;

    /* A rocha ESCURECE conforme apanha, e as brasas ficam mais brancas: uma
       média com um acerto é visivelmente diferente de uma média inteira. Isto
       substitui uma barra de vida — a informação fica no objeto, na distância
       em que ele é visto, sem HUD nenhum. */
    const gasto = 1 - this.hp;
    const brilhoBase = 1.5 + gasto * 2.2;
    this.mat.emissiveIntensity = brilhoBase + this.flash * 9;
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt / 0.18);
      const b = 0.35 + this.flash * 0.65;
      this.nucleo.material.opacity = 0.9 + this.flash * 0.1;
      this.nucleo.scale.setScalar(this.raio * 2.1 * (1 + this.flash * 0.8));
      this.halo.material.color.setRGB(1, 0.55 + b * 0.45, 0.25 + b * 0.6);
    } else {
      this.nucleo.scale.setScalar(this.raio * 2.1);
      this.halo.material.color.set(M.glowColor);
    }

    /* A MANCHA acende com a descida: fraca e alaranjada lá em cima, branca e
       pulsando quando o perigo é real. */
    const alt = Math.max(0, this.altitude);
    /* A referência é a altitude MAIS ALTA em que esta rocha já foi vista, e não
       a da chuva: o colosso nasce a 260 m, e medido contra os 185 m das comuns
       ele passaria o primeiro terço da descida com a mancha já no máximo — ou
       seja, sem dizer nada sobre a aproximação, que é a única coisa que ela
       existe para dizer. */
    if (alt > this._altRef) this._altRef = alt;
    const perto = 1 - Math.min(1, alt / this._altRef);
    const t = perto * perto; // acende no fim, não linearmente
    let alpha = M.markMinAlpha + (M.markMaxAlpha - M.markMinAlpha) * t;
    if (alt < M.dangerAltitude) {
      alpha *= 0.7 + 0.3 * Math.sin(performance.now() * 0.02);
    }
    this.marca.material.opacity = alpha;
    this.marca.material.color.setRGB(1, 0.45 + t * 0.4, 0.2 + t * 0.5);

    /* O RASTRO DE FOGO. Sai do pool de partículas que já existe, então não
       custa uma chamada de desenho nova — o pool inteiro do jogo são duas. */
    this.trailTimer -= dt;
    if (camera) this._camDist = camera.position.distanceTo(this.group.position);
    if (this.trailTimer <= 0 && camera) {
      this.trailTimer = M.trailInterval;
      const dist = this._camDist;
      // Longe, metade dos sopros: a 250 m ninguém conta partícula.
      if (dist < 260) {
        gameEvents.emit(EventType.PARTICLES, {
          position: {
            x: this.group.position.x,
            y: this.group.position.y,
            z: this.group.position.z,
          },
          count: dist > 120 ? 1 : 2,
          color: M.fireColor,
          speed: 1.5,
          spread: this.raio * 0.5,
          size: this.raio * 0.9,
          grow: 2.4,
          life: M.trailLife,
          gravity: 0,
          drag: 1.2,
          alpha: 0.75,
        });
      }
    }
  }

  /**
   * Some da cena.
   *
   * SÓ O QUE É DESTA ROCHA é destruído: os materiais, que carregam estado
   * próprio (o emissivo escurece com a vida, o halo esquenta no piscar). As
   * GEOMETRIAS são emprestadas do cache do topo do arquivo e ficam — destruí-las
   * aqui liberaria um buffer de GPU que a próxima pedra da mesma classe vai
   * pedir de volta meio segundo depois, e é justamente essa dança que fazia o
   * quadro engasgar quando uma rocha estourava perto da câmera.
   */
  dispose(scene) {
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    scene.remove(this.group);
    scene.remove(this.marca);
    this.group.traverse((o) => o.material?.dispose());
    this.marca.material.dispose();
  }
}
