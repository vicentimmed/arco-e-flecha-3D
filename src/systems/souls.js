/* ---------------------------------------------------------------------------
   AS ALMAS.

   Um monstro morre e uma bolinha luminosa sai do corpo em direção a quem o
   matou. Quando chega, some — e a barra do especial subiu um ponto.

   ---------------------------------------------------------- por que ela existe

   Não é enfeite: é a única confirmação de abate que se lê A DUZENTOS METROS.

   O jogo já dizia "morreu" de três maneiras, e as três exigem estar perto ou
   estar olhando para o HUD: o corpo tomba (some no LOD antes dos 60 m), o
   marcador de acerto pisca no centro da tela (exige que a mira esteja nele) e o
   `killFeed` escreve uma linha (exige tirar o olho do campo). Num cerco com
   cento e vinte sitiantes na rampa, ou numa noite de zumbis, a pergunta que o
   jogador faz o tempo todo é "aquele eu já matei?" — e nenhuma das três
   respondia de longe.

   A alma responde: ela é um risco de luz que SAI do corpo e VEM na sua direção.
   A direção é a metade importante da informação — ela diz não só que morreu,
   mas que morreu PARA VOCÊ, o que num co-op é o que impede duas pessoas de
   gastarem flecha no mesmo alvo.

   ---------------------------------------------------------------- o que custa

   UMA chamada de desenho para todas as almas em campo, e nenhuma alocação em
   voo: os sprites nascem uma vez, ficam escondidos e são reciclados. É o mesmo
   desenho do lote de estilhaços da chuva de meteoros, e pelo mesmo motivo —
   numa horda cheia isto dispara dezenas de vezes por segundo, e um sistema que
   aloca a cada morte apareceria como engasgo justamente no auge.

   O trajeto é uma CURVA, não uma reta: ela sobe do corpo, faz a volta e desce
   na direção de quem matou. Uma reta lê como projétil, e projétil é a única
   coisa que a alma não pode parecer — o jogador não pode se perguntar se aquilo
   vem para machucá-lo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { gameEvents, EventType } from "../core/events.js";

/** Quantas almas cabem em campo. Passou disto, a mais velha é reciclada. */
const TETO = 64;

/**
 * Tamanho da esfera, em metros, e por que ele é ESTE.
 *
 * A primeira versão usava 1,3 m e sumia — que é o oposto do trabalho dela. A
 * conta: com FOV de 58° e 720 px de altura, um metro a 60 m ocupa 12 px. Um
 * zumbi morre tipicamente entre 40 e 70 m; um sitiante do cerco, entre 60 e
 * 90; uma rocha da chuva, a 150. A 1,3 m isso dava de 6 a 15 px de núcleo —
 * tamanho de sujeira na tela, não de sinal.
 *
 * `raioBase` é o dobro disso, e `raioPorDistancia` é o que fecha a conta para o
 * caso longe: a esfera cresce um pouco com a distância, então ela mantém um
 * tamanho ANGULAR quase constante em vez de encolher com o quadrado. Não é o
 * mesmo que desligar a atenuação (aí ela viraria um balão colado na cara de
 * quem mata de perto); é um meio-termo que a deixa legível em toda a faixa em
 * que o jogo mata alguma coisa.
 */
const RAIO_BASE = 2.4; // m
const RAIO_POR_DISTANCIA = 0.016; // m por metro de distância até a câmera
const RAIO_MAX = 7.0; // m

/* A mesma textura de disco macio da rocha da chuva, gerada uma vez para o jogo
   inteiro. Um canvas de 64 px custa menos que carregar um arquivo. */
let _tex = null;
function almaTexture() {
  if (_tex) return _tex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(190,245,255,0.85)");
  grad.addColorStop(0.7, "rgba(90,190,255,0.22)");
  grad.addColorStop(1.0, "rgba(40,120,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _tex = new THREE.CanvasTexture(c);
  _tex.colorSpace = THREE.SRGBColorSpace;
  return _tex;
}

export class SoulSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {(id:number) => ({x:number,y:number,z:number}|null)} localizar onde
   *   está quem matou. É uma função e não uma lista porque o destino se move: a
   *   alma persegue o arqueiro, e um alvo congelado no instante da morte
   *   deixaria a bolinha indo para onde ele estava.
   */
  constructor(scene, localizar) {
    this.scene = scene;
    this.localizar = localizar;
    /** @type {Array<object>} as almas em voo */
    this.vivas = [];
    this.sprites = [];
    this.livres = [];

    const mat = new THREE.SpriteMaterial({
      map: almaTexture(),
      color: 0xbdf2ff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
    /* UM material para todas, e por isso um sprite por alma em vez de uma
       `InstancedMesh`: sprite já é billboard de graça no shader do Three, e a
       alma tem de encarar a câmera sempre. São 48 objetos pequenos que nascem
       uma vez e nunca são destruídos. */
    this.mat = mat;
    for (let i = 0; i < TETO; i++) {
      const s = new THREE.Sprite(mat.clone());
      s.visible = false;
      // Ela cruza o mapa inteiro; a caixa envolvente não descreve isso.
      s.frustumCulled = false;
      s.renderOrder = 6;
      scene.add(s);
      this.sprites.push(s);
      this.livres.push(i);
    }
  }

  /**
   * Um monstro morreu.
   *
   * @param {{x:number,y:number,z:number}} de o corpo
   * @param {number} matadorId para quem ela vai
   * @param {number} [escala] 1 = bicho comum. O ogro e o chefão soltam uma alma
   *   maior — quem matou aquilo merece que a tela diga.
   */
  spawn(de, matadorId, escala = 1) {
    if (!de) return;
    let vaga = this.livres.pop();
    if (vaga === undefined) {
      const velha = this.vivas.shift();
      if (!velha) return;
      vaga = velha.vaga;
    }

    const s = this.sprites[vaga];
    /* Rede contra o lote descartado. Sem ela, uma vaga sobrevivente a um
       `dispose` derrubava o handler de rede que chamou este método — e um
       `throw` ali não some sozinho: ele aborta o RESTO do processamento
       daquela mensagem, então uma alma quebrada levava junto o abate, o placar
       e o som. */
    if (!s) return;
    s.position.set(de.x, de.y + 0.9, de.z);
    s.visible = true;

    this.vivas.push({
      vaga,
      matadorId,
      escala,
      t: 0,
      // A SUBIDA INICIAL. Ela sai do corpo para cima antes de virar na direção
      // de quem matou — é o que a separa visualmente de um projétil.
      subida: 1.6 + Math.random() * 1.2,
      giro: Math.random() * Math.PI * 2,
      // Cada uma faz a volta um pouco diferente: um enxame de almas em trajetos
      // idênticos lê como uma coisa só.
      raio: 0.8 + Math.random() * 0.9,
      vel: 0,
    });
  }

  /**
   * Um passo.
   *
   * A alma ACELERA em direção ao destino em vez de andar a velocidade
   * constante: perto do corpo ela ainda está "se soltando", e no fim chega
   * rápido. Sem isso, uma morte a cem metros produzia uma bolinha atravessando
   * a tela devagar por quatro segundos, o que é tempo demais para um retorno.
   */
  update(dt, camera = null) {
    if (camera) this.camera = camera;
    if (!this.vivas.length) return;

    for (let i = this.vivas.length - 1; i >= 0; i--) {
      const a = this.vivas[i];
      const s = this.sprites[a.vaga];
      a.t += dt;

      const destino = this.localizar?.(a.matadorId) ?? null;
      if (!destino) {
        /* Quem matou saiu de cena (morreu longe, desconectou, trocou de fase).
           A alma sobe e apaga em vez de ficar pendurada: uma bolinha parada no
           ar para sempre é pior que nenhuma. */
        s.position.y += 3 * dt;
        if (a.t > 1.2) this.recolher(i);
        else this.desenhar(a, s, 1 - a.t / 1.2);
        continue;
      }

      const alvoY = destino.y + 1.2;
      let dx = destino.x - s.position.x;
      let dy = alvoY - s.position.y;
      let dz = destino.z - s.position.z;
      const d = Math.hypot(dx, dy, dz);

      if (d < 1.1) {
        this.chegou(destino, a);
        this.recolher(i);
        continue;
      }

      /* A SUBIDA sobrevive ao primeiro meio segundo e depois se rende à
         atração: é ela que dá o arco, e é ela que separa a alma de um projétil.
         Ficou mais longa junto com o teto de velocidade — ver abaixo. */
      const solta = Math.max(0, 1 - a.t / 0.7);
      /* MAIS DEVAGAR. A 34 m/s ela cruzava sessenta metros em dois segundos e
         quem não estava olhando para o corpo no instante da morte não via
         nada — que é justamente a pessoa para quem o aviso existe. A 20 m/s a
         mesma viagem leva o dobro, e o dobro é o tempo de virar a cabeça. */
      a.vel = Math.min(20, a.vel + (9 + d * 0.22) * dt);
      const passo = (a.vel * dt) / d;
      s.position.x += dx * passo;
      s.position.y += dy * passo + a.subida * solta * dt * 6;
      s.position.z += dz * passo;

      // O bamboleio em torno do próprio rumo — dois eixos perpendiculares ao
      // movimento seriam a conta certa, e um seno no plano horizontal é o que o
      // olho lê como "flutuando" pelo mesmo preço.
      a.giro += dt * 6;
      s.position.x += Math.cos(a.giro) * a.raio * dt;
      s.position.z += Math.sin(a.giro) * a.raio * dt;

      this.desenhar(a, s, 1);
    }
  }

  /**
   * O tamanho na tela.
   *
   * Ela PULSA e é grande de propósito: 1,3 m de sprite aditivo a cem metros são
   * uns nove pixels de núcleo com halo em volta — que é o mínimo para ser vista
   * contra a rampa noturna, que é a única razão pela qual ela existe.
   */
  desenhar(a, s, opacidade) {
    const pulso = 1 + Math.sin(a.t * 11) * 0.14;
    /* Cresce com a DISTÂNCIA ATÉ A CÂMERA, e é isso que a torna legível de
       longe sem virar um balão de perto. Ver `RAIO_POR_DISTANCIA`. */
    const d = this.camera ? this.camera.position.distanceTo(s.position) : 0;
    const r = Math.min(
      RAIO_MAX * a.escala,
      (RAIO_BASE + d * RAIO_POR_DISTANCIA) * a.escala * pulso,
    );
    s.scale.set(r, r, 1);
    s.material.opacity = 0.95 * opacidade;
  }

  /** Ela encostou em quem matou: um clarão curto e a bolinha some. */
  chegou(destino, a) {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: destino.x, y: destino.y + 1.2, z: destino.z },
      count: Math.round(6 * a.escala),
      color: 0xbdf2ff,
      speed: 3.5,
      spread: 1,
      size: 0.16 * a.escala,
      grow: 1.4,
      life: 0.45,
      gravity: 0,
      drag: 2.2,
      alpha: 0.9,
      additive: true,
    });
  }

  recolher(i) {
    const a = this.vivas[i];
    this.sprites[a.vaga].visible = false;
    this.livres.push(a.vaga);
    this.vivas.splice(i, 1);
  }

  clear() {
    for (const a of this.vivas) {
      this.sprites[a.vaga].visible = false;
      this.livres.push(a.vaga);
    }
    this.vivas = [];
  }

  dispose() {
    this.clear();
    for (const s of this.sprites) {
      this.scene.remove(s);
      s.material.dispose();
    }
    this.sprites = [];
    // A lista de vagas vai junto: vaga sem sprite é um índice para o vazio.
    this.livres = [];
    this.mat.dispose();
  }
}
