/* ---------------------------------------------------------------------------
   Alce — o corpo, a galhada, a barra de vida e o colisor.

   Como o porco, A INTELIGÊNCIA NÃO MORA AQUI: pastar, encarar, investir e
   chifrar são decididos em `server/elkSim.js`. Aqui chegam posição, ângulo,
   velocidade, estado e a fração de vida, a 10 Hz — e é montado o resto.

   A barra de vida não é enfeite de interface: é ela que transforma o alce num
   ADVERSÁRIO em vez de um alvo grande. Sem ver o progresso, oito flechadas
   parecem um bicho invencível e a briga vira frustração; com a barra, cada
   acerto é visivelmente um passo, e vale a pena continuar atirando enquanto ele
   vem para cima de você.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { damp } from "../utils/math.js";

/* PALETA (Fase 5B.4 do plano).
 *
 * O alce era marrom-chocolate uniforme e sumia contra a encosta — o bicho mais
 * importante do jogo era o mais difícil de ver. A paleta nova tem mais
 * SATURAÇÃO e, principalmente, mais CONTRASTE INTERNO: o dorso puxa para o
 * verde-oliva escuro da serra, a barriga é clara o bastante para desenhar a
 * linha de baixo do corpo, e o focinho é quase preto. É esse degrau entre as
 * três que dá volume à silhueta a cem metros.
 */
const MAT = {
  // Dorso: oliva escuro, a cor de um alce molhado contra mata fechada.
  body: new THREE.MeshStandardMaterial({
    color: "#6b7c5a",
    roughness: 0.92,
    metalness: 0,
  }),
  // Barriga e flancos: dois tons acima. É o que separa o corpo do chão.
  belly: new THREE.MeshStandardMaterial({
    color: "#8a9a70",
    roughness: 0.9,
    metalness: 0,
  }),
  dark: new THREE.MeshStandardMaterial({
    color: "#3f4a35",
    roughness: 0.94,
    metalness: 0,
  }),
  // Capa do pescoço: quase preta, como no bicho de verdade.
  cape: new THREE.MeshStandardMaterial({
    color: "#2a3122",
    roughness: 0.96,
    metalness: 0,
  }),
  muzzle: new THREE.MeshStandardMaterial({
    color: "#5a6840",
    roughness: 0.9,
    metalness: 0,
  }),
  // A galhada é a única coisa CLARA do bicho, e por isso é ela que se lê
  // primeiro: contra a mata escura, ela é a assinatura do alce.
  antler: new THREE.MeshStandardMaterial({
    color: "#d6c49a",
    roughness: 0.62,
    metalness: 0,
  }),
  eye: new THREE.MeshStandardMaterial({ color: "#0d0907", roughness: 0.22 }),
  hoof: new THREE.MeshStandardMaterial({ color: "#1d1713", roughness: 0.95 }),
};

/** Ponto reaproveitado por quadro: a posição de mundo das narinas. */
const _p = new THREE.Vector3();

/**
 * Barra de vida flutuante — sempre virada para a câmera.
 *
 * Fase 5B.6 do plano: ela ganhou MOLDURA, TETO DE CRESCIMENTO e ANIMAÇÃO DE
 * ENTRADA. Os três resolvem problemas diferentes:
 *
 * • A moldura (um quad 5 % maior por trás) separa a barra do fundo. Sem ela,
 *   uma barra escura sobre a mata escura simplesmente some, e a informação mais
 *   importante da briga fica ilegível justamente quando o alce está entre as
 *   árvores.
 * • O teto de crescimento existe porque a barra escala com a distância para
 *   continuar legível — e sem limite, um alce a 200 m tinha uma barra de quatro
 *   metros de largura atravessando a tela.
 * • A entrada e a saída animadas evitam o pop. A barra nasce achatada e cresce
 *   em 0,2 s.
 */
class HealthBar {
  constructor(largura = 1.6, altura = 0.16) {
    this.group = new THREE.Group();

    // Moldura: 5 % maior, mais escura, atrás de tudo.
    const moldura = new THREE.Mesh(
      new THREE.PlaneGeometry(largura * 1.05, altura * 1.05 + 0.03),
      new THREE.MeshBasicMaterial({
        color: 0x05060a,
        transparent: true,
        opacity: 0.55,
        depthTest: false,
        depthWrite: false,
      }),
    );
    moldura.position.z = -0.002;
    this.group.add(moldura);

    const fundo = new THREE.Mesh(
      new THREE.PlaneGeometry(largura, altura),
      new THREE.MeshBasicMaterial({
        color: 0x14100c,
        transparent: true,
        opacity: 0.72,
        // Sem teste de profundidade: a barra é informação, e informação que
        // some atrás de um arbusto não informa. Mesmo critério da seta do modo
        // "alvos em série".
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.group.add(fundo);

    this.fillMat = new THREE.MeshBasicMaterial({
      color: 0x6fd45a,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    // A geometria nasce com a âncora na PONTA ESQUERDA: assim `scale.x` encolhe
    // a barra pelo lado direito, como uma barra de vida deve encolher, em vez
    // de encolher para o centro.
    const geo = new THREE.PlaneGeometry(largura - 0.06, altura - 0.05);
    geo.translate((largura - 0.06) / 2, 0, 0);
    this.fill = new THREE.Mesh(geo, this.fillMat);
    this.fill.position.set(-(largura - 0.06) / 2, 0, 0.002);
    this.group.add(this.fill);

    this.group.renderOrder = 8;
    this.width = largura;
    /** 0 = ainda entrando, 1 = na escala cheia. Ver `faceCamera`. */
    this.grow = 0;
  }

  set(fracao) {
    const f = Math.max(0, Math.min(1, fracao));
    this.fill.scale.x = Math.max(0.001, f);
    // Verde → âmbar → vermelho: a cor diz o quanto falta sem precisar medir.
    this.fillMat.color.setHSL(0.33 * f, 0.7, 0.5);
  }

  /** Encara a câmera e cresce com a distância, como as etiquetas de nome. */
  faceCamera(camera, distancia, dt = 0) {
    this.group.quaternion.copy(camera.quaternion);
    /* O TETO caiu de 6× para 3×, como o plano pede — a 1,6 m de largura base,
       3× dá 4,8 m de barra, e o `min` de 1,5 m a limita de verdade em qualquer
       distância. Com 6× o alce no fundo do vale tinha uma barra maior que ele. */
    const escala = Math.min(
      THREE.MathUtils.clamp(distancia * 0.022, 1, 3),
      1.5 / this.width + 1,
    );
    // Entrada: 0,2 s de 0 até a escala cheia, e o crescimento é em Y primeiro —
    // a barra "abre" como uma persiana em vez de aparecer inteira num quadro.
    this.grow = Math.min(1, this.grow + dt * 5);
    const g = this.grow;
    this.group.scale.set(escala * (0.5 + 0.5 * g), escala * g * g, escala);
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
}

export class Elk {
  constructor(scene, physics, terrain, entityId, x, z) {
    this.scene = scene;
    this.physics = physics;
    this.entityId = entityId;
    this.netTarget = null;
    this.dead = false;
    this.state = "graze";
    this.health = 1;
    this.animPhase = Math.random() * Math.PI * 2;

    const y = terrain.heightAt(x, z);
    this.position = new THREE.Vector3(x, y, z);
    this.yaw = 0;
    this.speed = 0;
    this.deathRoll = 0;
    /** Cronômetro da morte em dois tempos — ver `updateDeath`. */
    this.deathTime = 0;
    /** Conta-gotas do bafo na investida — ver `updateBreath`. */
    this.breathTimer = 0;

    this.group = new THREE.Group();
    this.group.name = `elk-${entityId}`;
    this.buildMesh();
    this.group.position.copy(this.position);
    scene.add(this.group);

    this.bar = new HealthBar();
    this.bar.group.position.y = CONFIG.elk.bodyHeight + 0.85;
    this.group.add(this.bar.group);

    const cfg = CONFIG.elk;
    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        x,
        y + cfg.bodyHeight / 2,
        z,
      ),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(cfg.colliderHalfHeight, cfg.colliderRadius)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { kind: "elk", entityId, elk: this });
    entityRegistry.register(entityId, this);
  }

  /**
   * O corpo (Fases 5B.1, 5B.2 e 5B.3 do plano).
   *
   * O alce anterior era uma ESFERA achatada com quatro cilindros. Faltava tudo
   * o que faz um alce ser reconhecível de longe, e é de longe que ele é visto:
   *
   * • CORCOVA. O alce tem uma crista de músculo sobre as escápulas, mais alta
   *   que a garupa. É a linha mais característica do bicho — sem ela a silhueta
   *   é de um cavalo gordo.
   * • PEITO FUNDO. O tórax desce bem abaixo da linha da barriga, e é a
   *   depressão atrás dele que faz o corpo ter cintura em vez de ser um barril.
   * • FOCINHO PENDENTE. O focinho do alce é bulboso e cai sobre a boca; reto,
   *   ele lê como veado.
   *
   * Corpo e cernelha agora são UMA peça mesclada, não duas sobrepostas: a
   * emenda entre as duas esferas antigas aparecia como um degrau na silhueta
   * contra o céu, que era o que mais entregava a construção por primitivas.
   */
  buildMesh() {
    const root = new THREE.Group();
    const H = CONFIG.elk.bodyHeight;
    // Listas de LOD (ver `utils/lod.js`) — o alce é grande e visto de longe,
    // mas as pontas da galhada e os olhos não sobrevivem a trinta metros.
    this.lodDetail = [];
    this.lodBulk = [];

    /* --- tronco + corcova + peito, numa peça só ------------------------- */
    const partes = [];

    const tronco = new THREE.SphereGeometry(0.62, 16, 11);
    tronco.scale(1.0, 0.9, 1.7);
    tronco.translate(0, H * 0.62, -0.12);
    partes.push(tronco);

    // A corcova: uma cunha sobre as escápulas, mais alta que o resto do dorso.
    const corcova = new THREE.SphereGeometry(0.46, 14, 10);
    corcova.scale(0.94, 1.0, 1.05);
    corcova.translate(0, H * 0.78, 0.38);
    partes.push(corcova);

    // Peito fundo: desce 20 cm abaixo da linha da barriga, à frente.
    const peito = new THREE.SphereGeometry(0.44, 14, 10);
    peito.scale(0.92, 1.15, 0.95);
    peito.translate(0, H * 0.5, 0.42);
    partes.push(peito);

    this.bodyMesh = new THREE.Mesh(mergeGeometries(partes), MAT.body);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    root.add(this.bodyMesh);
    for (const p of partes) p.dispose();

    // Barriga clara: a faixa de baixo, que desenha a linha inferior do corpo.
    const barriga = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 9), MAT.belly);
    barriga.scale.set(1.0, 0.52, 1.5);
    barriga.position.set(0, H * 0.44, -0.16);
    root.add(barriga);
    this.lodBulk.push(barriga);

    /* --- pescoço e cabeça ---------------------------------------------- */
    this.neck = new THREE.Group();
    this.neck.position.set(0, H * 0.78, 0.66);
    root.add(this.neck);

    const pescoco = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.38, 0.8, 10),
      MAT.cape,
    );
    pescoco.position.set(0, 0.3, 0.16);
    pescoco.rotation.x = -0.55;
    pescoco.castShadow = true;
    this.neck.add(pescoco);

    this.head = new THREE.Group();
    this.head.position.set(0, 0.62, 0.5);
    this.neck.add(this.head);

    const cranio = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 9), MAT.body);
    cranio.scale.set(0.88, 0.92, 1.2);
    cranio.castShadow = true;
    this.head.add(cranio);

    /* FOCINHO PENDENTE: dois volumes, não um cilindro reto. O tubo desce
       inclinado e a ponta é uma bola que CAI sobre a linha da boca. É esse
       degrau que dá o perfil do alce — o focinho reto de antes era de cervo. */
    const focinho = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.17, 0.34, 10),
      MAT.muzzle,
    );
    focinho.rotation.x = Math.PI / 2 - 0.42;
    focinho.position.set(0, -0.13, 0.26);
    focinho.castShadow = true;
    this.head.add(focinho);

    const bulbo = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), MAT.muzzle);
    bulbo.scale.set(0.95, 1.05, 0.9);
    bulbo.position.set(0, -0.25, 0.38);
    bulbo.castShadow = true;
    this.head.add(bulbo);
    this.lodBulk.push(bulbo);

    // Barbela: o pingente de pelo sob a garganta, a assinatura do alce.
    const barbela = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.1, 0.34, 7),
      MAT.cape,
    );
    barbela.position.set(0, -0.3, 0.0);
    this.head.add(barbela);
    this.lodBulk.push(barbela);

    /* As NARINAS são de onde sai o bafo na investida (Fase 5B.5). Guardadas
       como ponto local, não como malha: nada é desenhado ali. */
    this.nostrilLocal = new THREE.Vector3(0, -0.27, 0.46);

    for (const lado of [-1, 1]) {
      const olho = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), MAT.eye);
      olho.position.set(lado * 0.17, 0.07, 0.1);
      this.head.add(olho);
      this.lodDetail.push(olho);

      const orelha = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.26, 5), MAT.dark);
      orelha.position.set(lado * 0.22, 0.16, -0.1);
      orelha.rotation.z = lado * 0.9;
      this.head.add(orelha);
      this.lodBulk.push(orelha);

      this.head.add(this.buildAntler(lado));
    }

    /* --- pernas com joelho e jarrete (Fase 5B.3) ------------------------
       Antes cada perna era UM cilindro do quadril ao casco: uma vara reta, sem
       nenhuma articulação, e por isso a marcha parecia um compasso abrindo e
       fechando. Agora são coxa, canela e casco em grupos aninhados, e o joelho
       (dianteiro) / jarrete (traseiro) DOBRA na fase de balanço.

       O par de trás dobra ao CONTRÁRIO do da frente — é assim num quadrúpede, e
       é a coisa que mais denuncia uma animação errada quando está faltando. */
    this.legs = [];
    for (const [lx, lz, frente] of [
      [0.34, 0.55, 1],
      [-0.34, 0.55, 1],
      [0.32, -0.62, 0],
      [-0.32, -0.62, 0],
    ]) {
      const leg = new THREE.Group();
      leg.position.set(lx, H * 0.56, lz);

      const coxa = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.075, H * 0.3, 7),
        frente ? MAT.body : MAT.dark,
      );
      coxa.position.y = -H * 0.15;
      coxa.castShadow = true;
      leg.add(coxa);

      // O joelho é o PIVÔ do segmento de baixo: girar este grupo dobra a perna
      // pelo meio, que é exatamente o que faltava.
      const joelho = new THREE.Group();
      joelho.position.y = -H * 0.3;
      leg.add(joelho);

      const canela = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.05, H * 0.26, 6),
        MAT.dark,
      );
      canela.position.y = -H * 0.13;
      canela.castShadow = true;
      joelho.add(canela);

      const casco = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.2), MAT.hoof);
      casco.position.set(0, -H * 0.26 + 0.04, 0.03);
      casco.castShadow = true;
      joelho.add(casco);
      this.lodDetail.push(casco);

      root.add(leg);
      this.legs.push({ group: leg, joelho, frente });
      this.lodBulk.push(leg);
    }

    const cauda = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 6), MAT.dark);
    cauda.position.set(0, H * 0.72, -1.02);
    cauda.rotation.x = 0.6;
    root.add(cauda);
    this.lodDetail.push(cauda);

    this.group.add(root);
    this.visualRoot = root;
  }

  /**
   * A galhada — DUAS VEZES MAIOR e PALMADA (Fase 5B.2 do plano).
   *
   * A galhada de um alce adulto tem quase um metro e meio de ponta a ponta e é
   * a coisa que se vê primeiro dele. A anterior era um par de gravetos de 40 cm
   * quase colados no crânio: perdia-se contra a cabeça a vinte metros, e com ela
   * se perdia a única informação de "isto é um alce, não um cervo".
   *
   * A forma é uma MÃO ABERTA: a pá é a palma e as pontas são os dedos, saindo em
   * leque da borda externa dela e crescendo do polegar para o mindinho. É essa
   * leitura de mão que faz a galhada palmada ser reconhecível mesmo em
   * silhueta contra o céu.
   */
  buildAntler(lado) {
    const g = new THREE.Group();
    g.position.set(lado * 0.16, 0.2, -0.02);

    // Haste: sai do crânio para cima e para FORA, com a inclinação de 40°.
    const haste = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.075, 0.5, 7),
      MAT.antler,
    );
    haste.position.set(lado * 0.14, 0.24, 0);
    haste.rotation.z = lado * 0.62;
    haste.castShadow = true;
    g.add(haste);

    /* A PÁ: a palma da mão. Larga, fina e inclinada para fora e para trás. Não é
       um cubo achatado como antes — o cilindro de 6 lados dá a borda arredondada
       da palma e evita a leitura de "tábua". */
    const pa = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.055, 6),
      MAT.antler,
    );
    pa.scale.set(1.0, 1.0, 0.78);
    pa.rotation.set(Math.PI / 2, 0, lado * 0.5);
    pa.position.set(lado * 0.46, 0.52, -0.04);
    pa.castShadow = true;
    g.add(pa);
    this.lodBulk.push(pa);

    /* Os DEDOS: cinco pontas na borda externa da pá, em leque, crescendo. Elas
       apontam para cima e para fora, e a de trás é a mais longa — é assim que a
       galhada "abre" contra o céu. */
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const comprimento = 0.2 + t * 0.22;
      const ponta = new THREE.Mesh(
        new THREE.ConeGeometry(0.038, comprimento, 5),
        MAT.antler,
      );
      // Distribuídas num arco de ~110° na borda externa da palma.
      const ang = -0.5 + t * 1.9;
      ponta.position.set(
        lado * (0.46 + Math.cos(ang) * 0.34),
        0.52 + Math.sin(ang) * 0.3,
        -0.04 - 0.26 + t * 0.5,
      );
      ponta.rotation.z = lado * (ang - 0.25);
      ponta.castShadow = true;
      g.add(ponta);
      this.lodDetail.push(ponta);
    }
    return g;
  }

  /* -------------------------------------------------------------- impacto -- */

  /**
   * Uma flecha entrou. Aqui só o AVISO — a vida é contada no servidor.
   *
   * A flecha fica cravada porque o corpo é cinemático e `Arrow.stick` a prende
   * a ele: o bicho sai correndo com as flechas espetadas, que é a leitura mais
   * direta possível de "quanto dano ele já levou" e o que o pedido descreve.
   */
  registerHit(impact, arrow) {
    if (this.dead) return;
    gameEvents.emit(EventType.ELK_HIT, {
      elkId: this.entityId,
      impact: vec3Payload(impact),
      arrowId: arrow?.id,
      ownerId: arrow?.ownerEntityId ?? null,
      distance: arrow ? arrow.launchPosition.distanceTo(impact) : 0,
    });
  }

  /* -------------------------------------------------------------- em rede -- */

  setNetworkTarget(p, yaw, speed, state, health) {
    this.netTarget = { x: p[0], y: p[1], z: p[2], yaw, speed, state, health };
  }

  killLocal() {
    if (this.dead) return;
    this.dead = true;
    this.state = "dead";
    this.speed = 0;
    this.bar.group.visible = false;
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "elkDeath",
      position: vec3Payload(this.position),
      volume: 1.3,
    });
  }

  dispose() {
    this.physics.unregister(this.collider);
    this.physics.removeBody(this.body);
    entityRegistry.unregister(this.entityId);
    this.scene.remove(this.group);
    this.bar.dispose();
    this.group.traverse((o) => o.geometry?.dispose());
  }

  update(dt, camera) {
    if (this.dead) {
      this.updateDeath(dt);
      return;
    }

    const alvo = this.netTarget;
    if (alvo) {
      const k = 13;
      this.position.x = damp(this.position.x, alvo.x, k, dt);
      this.position.y = damp(this.position.y, alvo.y, k, dt);
      this.position.z = damp(this.position.z, alvo.z, k, dt);
      let d = alvo.yaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-k * dt));
      this.speed = damp(this.speed, alvo.speed, k, dt);
      this.health = alvo.health;
      /* A troca de estado é o gatilho da VOZ (Fase 4.4 do plano). Sai daqui, na
         transição, e não a cada quadro: `flee` e `charge` duram segundos, e um
         berro por quadro seria uma buzina. O berro de dor não entra aqui — ele
         vem do evento da SALA (ver `main.js`), porque acerto é informação que
         todos os jogadores precisam ouvir, não só quem está perto. */
      if (alvo.state !== this.state) {
        const antes = this.state;
        this.state = alvo.state;
        if (
          (alvo.state === "flee" && antes !== "charge" && antes !== "dodge") ||
          alvo.state === "charge" ||
          alvo.state === "dodge"
        ) {
          gameEvents.emit(EventType.AUDIO_PLAY, {
            sound: "elkVoice",
            variant: alvo.state === "dodge" ? "flee" : alvo.state,
            position: vec3Payload(this.position),
            volume: alvo.state === "charge" ? 1.5 : 1.05,
          });
        }
      }
    }

    /* Mesma regra do porco e do arqueiro: a cadência vem da distância andada, e
       a passada alonga com a velocidade. Um bicho de duas toneladas investindo
       a 12 m/s dá passadas largas, não passinhos rápidos. */
    const E = CONFIG.elk;
    const passada =
      E.strideLength * (1 + E.runStrideGain * Math.min(1, this.speed / E.chargeSpeed));
    this.animPhase += dt * (0.8 + (Math.PI * 2 * this.speed) / passada);
    this.animate();
    this.updateBreath(dt);
    this.bar.set(this.health);
    if (camera) {
      this.bar.faceCamera(camera, this.position.distanceTo(camera.position), dt);
    }
    this.syncPhysics();
  }

  /**
   * A MORTE EM DOIS TEMPOS (Fase 5B.7 do plano).
   *
   * O alce não tomba de lado na hora. Ele AJOELHA primeiro — as patas
   * dianteiras cedem, o peito desce, a cabeça vai ao chão — e só então o corpo
   * rola. São dois segundos em vez de um, e a diferença não é de duração: é que
   * um bicho de meia tonelada que cai instantaneamente não tem peso nenhum.
   *
   * O estalo de osso entra na VIRADA entre os dois tempos, que é o instante em
   * que o corpo perde a última sustentação. É o som que fecha a leitura.
   */
  updateDeath(dt) {
    const AJOELHAR = 0.5; // s
    const TOMBAR = 1.5; // s
    this.deathTime += dt;

    if (this.deathTime < AJOELHAR) {
      // Tempo 1: as dianteiras cedem. O corpo desce e inclina para a FRENTE.
      const p = this.deathTime / AJOELHAR;
      const e = p * p * (3 - 2 * p); // suaviza a entrada e a saída
      this.visualRoot.rotation.x = e * 0.26; // ~15° para a frente
      this.visualRoot.position.y = -0.8 * e;
      for (const perna of this.legs) {
        if (perna.frente) perna.joelho.rotation.x = -e * 1.5;
      }
      this.group.position.copy(this.position);
      return;
    }

    if (!this._boneCracked) {
      this._boneCracked = true;
      // Osso quebrando: a mesma pancada seca da cabeçada, mais grave e baixa.
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: "elkGore",
        position: vec3Payload(this.position),
        volume: 0.85,
      });
      gameEvents.emit(EventType.PARTICLES, {
        position: { x: this.position.x, y: this.position.y + 0.2, z: this.position.z },
        count: 12,
        color: 0xa8926a,
        speed: 1.8,
        spread: 0.9,
        direction: { x: 0, y: 0.4, z: 0 },
        size: 0.14,
        grow: 2.0,
        life: 0.9,
        gravity: -1.4,
        drag: 3.0,
        alpha: 0.4,
      });
    }

    // Tempo 2: tomba de lado. Mais lento que o ajoelhar — é o peso rolando.
    const p = Math.min(1, (this.deathTime - AJOELHAR) / TOMBAR);
    const e = p * p * (3 - 2 * p);
    this.deathRoll = e * (Math.PI / 2);
    this.visualRoot.rotation.z = this.deathRoll;
    this.visualRoot.rotation.x = 0.26 * (1 - e * 0.6);
    this.visualRoot.position.y = -0.8 - 0.35 * e;
    this.group.position.copy(this.position);
  }

  animate() {
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;

    /* A CABEÇA CONTA O ESTADO.
     *
     * É a única leitura que o jogador tem, a cem metros, do que o bicho vai
     * fazer — e cada pose é um aviso diferente:
     *
     *   pastar  → focinho no chão. Ele não viu você; dá para chegar mais perto.
     *   atento  → cabeça alta, encarando. Viu você. O próximo passo o espanta.
     *   fugir   → pescoço nivelado, esticado para a frente, correndo.
     *   investe → cabeça baixa e galhada à frente. É o meio segundo que separa
     *             sair da frente de levar a cabeçada.
     */
    const alvoNeck = {
      graze: 0.95,
      alert: -0.42,
      flee: 0.12,
      charge: 0.55,
      recover: -0.15,
      dodge: 0.05,
    }[this.state] ?? 0.05;
    this.neck.rotation.x += (alvoNeck - this.neck.rotation.x) * 0.12;

    const investindo = this.state === "charge";
    const atento = this.state === "alert";
    const desviando = this.state === "dodge";
    this.head.rotation.x = investindo
      ? -0.2
      : atento
        ? -0.15
        : desviando
          ? -0.05
          : Math.sin(this.animPhase * 0.7) * 0.05;
    this.head.rotation.y = atento ? Math.sin(this.animPhase * 0.5) * 0.28 : 0;

    const abertura = desviando
      ? 0.95
      : 0.7 * Math.min(1, this.speed / 7);
    const andando = this.speed > 0.1 || desviando;
    const swing = andando ? Math.sin(this.animPhase * (desviando ? 1.8 : 1)) * abertura : 0;
    for (let i = 0; i < this.legs.length; i++) {
      const perna = this.legs[i];
      const fase = i === 0 || i === 3 ? 1 : -1;
      perna.group.rotation.x = fase * swing;

      const balanco = andando ? Math.max(0, fase * Math.sin(this.animPhase * (desviando ? 1.8 : 1))) : 0;
      perna.joelho.rotation.x = (perna.frente ? -1 : 1) * balanco * abertura * 1.15;
    }

    // No dodge o servidor já sobe o Y; o bounce local reforça o galope.
    const bounceBase = desviando
      ? 0.12 + Math.abs(Math.sin(this.animPhase * 2)) * 0.08
      : Math.abs(Math.sin(this.animPhase)) * Math.min(0.06, this.speed * 0.008);
    this.bodyMesh.position.y = bounceBase;
    if (this.visualRoot) {
      this.visualRoot.rotation.x = desviando ? -0.18 : this.visualRoot.rotation.x * 0.9;
    }
  }

  /**
   * O BAFO DE VAPOR na investida (Fase 5B.5 do plano).
   *
   * Só enquanto ele investe, e a ~20 partículas por segundo — contadas em tempo,
   * não em quadros, senão quem tem monitor de 144 Hz vê o dobro de vapor.
   *
   * Serve a um propósito de jogo: a investida é ESQUIVÁVEL, e o que o jogador
   * precisa é perceber que ela começou. O bafo aparece meio segundo antes de o
   * bicho estar em cima dele, sai da altura das narinas e aponta para a frente —
   * ou seja, ele também mostra PARA ONDE a investida vai.
   */
  updateBreath(dt) {
    if (this.state !== "charge") {
      this.breathTimer = 0;
      return;
    }
    this.breathTimer -= dt;
    if (this.breathTimer > 0) return;
    this.breathTimer = 1 / 20;

    // As narinas em coordenadas de mundo: o ponto local passa pela cabeça, pelo
    // pescoço e pelo grupo, que já estão com as matrizes deste quadro.
    this.head.updateMatrixWorld();
    _p.copy(this.nostrilLocal).applyMatrix4(this.head.matrixWorld);
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);

    gameEvents.emit(EventType.PARTICLES, {
      position: _p,
      count: 2,
      color: 0xdfe6ea,
      colorJitter: 0.1,
      // Sai PARA A FRENTE do bicho (o -Z local, girado pelo yaw) e um pouco
      // para baixo: é ar quente saindo de narinas apontadas para o chão.
      direction: { x: -s * 1.0, y: -0.25, z: -c * 1.0 },
      speed: 3.2,
      spread: 0.22,
      size: 0.1,
      grow: 2.4, // a nuvem se abre rápido, como vapor
      life: 0.5,
      gravity: 0.4,
      drag: 3.4,
      alpha: 0.34,
    });
  }

  syncPhysics() {
    this.body.setTranslation(
      {
        x: this.position.x,
        y: this.position.y + CONFIG.elk.bodyHeight / 2,
        z: this.position.z,
      },
      true,
    );
  }
}
