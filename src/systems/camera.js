/* ---------------------------------------------------------------------------
   Câmeras: terceira pessoa, primeira pessoa e acompanhamento da flecha.

   • ARCHER — atrás e por cima do ombro. A arqueira fica à esquerda do quadro e
     o campo de tiro à direita.
   • FIRST  — no olho da arqueira, logo acima do ponto de ancoragem da corda.
     A flecha passa rente à câmera e o arco aparece à frente, como se vê
     mirando de verdade.
   • ARROW  — atrás da flecha em voo. Entra sozinha a cada disparo e só sai
     quando o jogador clica.
   • KAME   — à FRENTE do Kamehameha, viajando com a ponta e olhando para trás.
     Entra sozinha no disparo do especial e sai no impacto. É o inverso da
     câmera da flecha, e o inverso é o ponto: o que se quer ver não é o que a
     ponta vai encontrar, é o arqueiro ao fundo empurrando trezentos metros de
     feixe. Desligável por `CONFIG.camera.kameCam.enabled`.

   REGRA DE OURO: a pose da câmera é função EXCLUSIVA dos ângulos de mira e da
   posição da arqueira — nunca do raycast. E é essa pose que DEFINE a mira.

   Duas coisas dependiam do raycast e as duas tremiam:

   1. A câmera olhava direto para o ponto devolvido pelo raio. Como ela fica
      atrás e ao lado da linha de tiro, a distância desse ponto entrava na
      conta do ângulo: varrer o mouse sobre a borda de um alvo fazia o raio pular
      de 10 m para 60 m e a câmera girava graus num único frame — o "shuttering".
   2. Corrigido isso, o retículo é que passou a pular: mirando pelo OLHO da
      arqueira, o ponto de impacto não está sobre o eixo óptico, então sua
      posição na tela também depende da distância.

   A saída é uma só: quem manda na mira é o eixo óptico. `aimOrigin`/`aimForward`
   são o centro óptico e a direção do retículo, calculados só a partir de
   yaw/pitch, e o raio de mira sai dali (ver systems/aim.js). O ponto de impacto
   fica então SEMPRE sobre o eixo óptico — retículo cravado no centro da tela e
   flecha convergindo exatamente nele, sem amortecimento e sem histerese.

   Em terceira pessoa a câmera ainda faz "toe-in": aponta para um ponto fixo da
   linha de tiro (`camera.convergence`). Isso mantém o enquadramento de origem e
   faz a flecha sair praticamente alinhada com o arco na faixa dos alvos de meia
   distância. Na primeira pessoa o centro óptico É o olho, então mira e olhar
   coincidem exatamente.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { damp } from "../utils/math.js";

export const CameraMode = {
  ARCHER: "archer",
  FIRST: "first",
  ARROW: "arrow",
  KAME: "kame",
};

/** Modos que são CINEMA: a câmera não está mais no ponto de vista da mira. */
const CINEMATIC = new Set([CameraMode.ARROW, CameraMode.KAME]);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = CameraMode.ARCHER;
    /** Modo que o jogador está pedindo (botão direito/C), mesmo durante o voo. */
    this.wantFirstPerson = false;
    /** Ligado por padrão: cada disparo joga a câmera para trás da flecha.
     *  Desligado (tecla F), o disparo não muda a câmera — a arqueira continua
     *  na visão de sempre enquanto a flecha voa. */
    this.followArrowEnabled = true;
    this.followArrow = null;
    /** Câmera da flecha congelada no impacto (não segue alvo balançando). */
    this.arrowCamFrozen = false;
    this.frozenPosition = new THREE.Vector3();
    this.frozenLookAt = new THREE.Vector3();

    /** Feixe que a câmera do especial está acompanhando, ou null. */
    this.kameBeam = null;
    /** Segundos parados no impacto antes de devolver a terceira pessoa. */
    this.kameHold = 0;

    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();

    /* Ponto de vista da MIRA — centro óptico e direção do retículo. É daqui que
       sai o raio de mira (systems/aim.js). Fora da câmera da flecha, a câmera
       de apresentação é exatamente este ponto de vista. */
    this.aimOrigin = new THREE.Vector3();
    this.aimForward = new THREE.Vector3(0, 0, -1);
    /** Metros à frente do centro óptico onde o raio de mira começa a valer. */
    this.aimSkip = 0;

    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    /** "Cima" do enquadramento do feixe: perpendicular a ele, não ao mundo. */
    this._axis = new THREE.Vector3();
    this.initialized = false;

    this.baseFov = CONFIG.camera.fov;
    this.baseNear = CONFIG.camera.near;
    this.applyLens();
  }

  get isFirstPerson() {
    return this.mode === CameraMode.FIRST;
  }

  get isArrowCam() {
    return this.mode === CameraMode.ARROW;
  }

  get isKameCam() {
    return this.mode === CameraMode.KAME;
  }

  /** A câmera está contando uma história em vez de mostrar a mira? */
  get isCinematic() {
    return CINEMATIC.has(this.mode);
  }

  /** Terceira pessoa é o padrão; botão direito/C segura a primeira pessoa. */
  /**
   * Quanto do enquadramento do especial está aplicado (0 a 1).
   *
   * Recebe a própria fração da pose, então a câmera viaja junto com a carga e
   * volta junto com o retorno — sem uma segunda interpolação para manter em
   * sincronia com a animação.
   */
  setSpecialFrame(k) {
    this.specialFrame = Math.max(0, Math.min(1, k));
  }

  setFirstPerson(on) {
    // O pedido é registrado mesmo durante a câmera da flecha: é ele que decide
    // para onde voltar quando o voo acaba.
    this.wantFirstPerson = on;
    if (this.isCinematic) return;
    const next = on ? CameraMode.FIRST : CameraMode.ARCHER;
    if (this.mode === next) return;
    this.mode = next;
    this.initialized = false;
    this.applyLens();
  }

  /** Todo disparo joga a câmera para a flecha — a menos que o jogador tenha
   *  desligado o acompanhamento (tecla F). */
  onShoot(arrow) {
    if (!this.followArrowEnabled) return;
    this.followArrow = arrow;
    this.arrowCamFrozen = false;
    this.mode = CameraMode.ARROW;
    this.applyLens();
  }

  /** Liga/desliga a câmera acompanhando a flecha em voo. Ligado por padrão. */
  setFollowArrow(on) {
    this.followArrowEnabled = on;
  }

  /**
   * O feixe do PRÓPRIO jogador acabou de sair: a câmera vai para a frente dele.
   *
   * Recusa em dois casos, e os dois importam:
   *
   * • `enabled: false` — é o botão de volta para o enquadramento lateral que
   *   existia antes desta câmera (`CONFIG.camera.special*`). Nenhum outro
   *   arquivo precisa saber da diferença.
   * • feixe curto — mirar no chão a vinte metros daria um corte de dois frames
   *   ida e volta, e um corte tão curto lê como falha de render.
   *
   * @param {object} feixe um `KamehamehaBeam`
   * @returns {boolean} se a câmera assumiu
   */
  onKame(feixe) {
    const c = CONFIG.camera.kameCam;
    if (!c?.enabled || !feixe || feixe.morto) return false;
    if (feixe.alcance < c.minRange) return false;
    this.kameBeam = feixe;
    this.kameHold = 0;
    this.mode = CameraMode.KAME;
    this.initialized = false;
    this.applyLens();
    return true;
  }

  /** Interrompe a câmera do feixe (troca de modo, morte, cancelamento). */
  leaveKame() {
    if (this.mode !== CameraMode.KAME) return false;
    this._leaveKameCam();
    return true;
  }

  _leaveKameCam() {
    this.kameBeam = null;
    this.kameHold = 0;
    this.mode = this.wantFirstPerson ? CameraMode.FIRST : CameraMode.ARCHER;
    this.initialized = false;
    this.applyLens();
  }

  /**
   * Encerra a câmera da flecha no modo que o jogador está pedindo AGORA.
   *
   * Voltar sempre para um modo fixo custava um frame de imagem errada: se ele
   * estivesse segurando o botão direito, a tela piscava em terceira pessoa antes
   * de `setFirstPerson` corrigir no frame seguinte.
   */
  _leaveArrowCam() {
    this.mode = this.wantFirstPerson ? CameraMode.FIRST : CameraMode.ARCHER;
    this.followArrow = null;
    this.arrowCamFrozen = false;
    this.initialized = false;
    this.applyLens();
  }

  /**
   * Clique: volta para a visão da arqueira.
   *
   * Vale SÓ para a câmera da flecha, e de propósito. O clique e o W chegam aqui
   * porque `input` os transforma em `dismissArrowCam` sempre que o tiro está
   * bloqueado — e durante o especial ele está. Aceitá-los aqui deixaria a
   * primeira tecla apertada cancelar o enquadramento do feixe sem devolver o
   * movimento, que continua travado pelos sete segundos: a pessoa perderia a
   * imagem e não ganharia nada. Quem encerra a câmera do feixe é o impacto.
   */
  returnToArcher() {
    if (this.mode !== CameraMode.ARROW) return false;
    this._leaveArrowCam();
    return true;
  }

  applyLens() {
    const first = this.mode === CameraMode.FIRST;
    this.camera.fov = first ? CONFIG.firstPerson.fov : this.baseFov;
    this.camera.near = first ? CONFIG.firstPerson.near : this.baseNear;
    this.camera.updateProjectionMatrix();
  }

  /** Modo que manda na MIRA — câmera de cinema não desvia a linha de tiro. */
  get aimMode() {
    if (!this.isCinematic) return this.mode;
    return this.wantFirstPerson ? CameraMode.FIRST : CameraMode.ARCHER;
  }

  /**
   * Centro óptico e direção do retículo, só a partir de yaw/pitch.
   *
   * Depende só dos argumentos e do modo, e não toca na câmera — assim o main
   * pode avaliá-la com ângulos hipotéticos ao trocar de modo.
   *
   * @param {THREE.Vector3} aimAxis eixo do corpo (unitário, saindo do olho)
   * @param {THREE.Vector3} eye posição do olho da arqueira
   * @param {THREE.Vector3} pivot ombro da arqueira (sem quique do passo)
   */
  updateAimViewpoint(aimAxis, eye, pivot) {
    if (this.aimMode === CameraMode.FIRST) {
      this.aimOrigin.copy(eye);
      this.aimForward.copy(aimAxis);
      this.aimSkip = 0;
      return;
    }

    const c = CONFIG.camera;

    // Só o yaw posiciona a câmera. Incluir pitch no recuo lateral fazia ela
    // avançar e recuar ao mirar para os lados com inclinação.
    this._tmp.copy(aimAxis);
    this._tmp.y = 0;
    if (this._tmp.lengthSq() < 1e-8) this._tmp.set(0, 0, -1);
    else this._tmp.normalize();

    this._right.crossVectors(this._tmp, this._up).normalize();

    /* ENQUADRAMENTO DO ESPECIAL.
     *
     * A câmera sai de trás do ombro e vai para o LADO. Não é gosto: um feixe
     * de catorze metros de diâmetro e quatrocentos de comprimento, visto de
     * quatro metros atrás da boca, é um tubo em que a câmera está OLHANDO POR
     * DENTRO — e aditivo, isso é uma parede branca que apaga o personagem, o
     * céu e as rochas. Medido, e foi exatamente o que aconteceu.
     *
     * De lado o feixe vira o que a referência mostra: um traço atravessando o
     * quadro, com o arqueiro plantado no canto. `t` sobe e desce com a pose,
     * então a viagem da câmera acompanha a carga em vez de cortar. */
    const k = this.specialFrame ?? 0;
    const dist = c.distance + ((c.specialDistance ?? 13.15) - c.distance) * k;
    const right = c.right + ((c.specialRight ?? 7.5) - c.right) * k;
    const up = c.up + ((c.specialUp ?? 2.4) - c.up) * k;

    this.aimOrigin
      .copy(pivot)
      .addScaledVector(this._tmp, -dist)
      .addScaledVector(this._right, right)
      .addScaledVector(this._up, up);

    // Toe-in: a câmera aponta para um ponto FIXO da linha de tiro. É o que
    // preserva o enquadramento e o que deixa a flecha sair quase alinhada com o
    // arco na faixa de `convergence`.
    this._look.copy(eye).addScaledVector(aimAxis, c.convergence);
    this.aimForward.copy(this._look).sub(this.aimOrigin).normalize();

    // O raio de mira só começa a valer na altura da arqueira: senão um tronco
    // ou uma pedra ENTRE a câmera e ela viraria o alvo da flecha.
    this.aimSkip = Math.max(
      0,
      this._desired.copy(pivot).sub(this.aimOrigin).dot(this.aimForward),
    );
  }

  /**
   * @param {THREE.Vector3} aimAxis eixo do corpo (unitário, saindo do olho)
   * @param {THREE.Vector3} eye posição do olho da arqueira
   * @param {THREE.Vector3} cameraPivot ombro da arqueira (só yaw) para terceira pessoa
   */
  update(dt, aimAxis, eye, cameraPivot) {
    // A mira é resolvida SEMPRE, inclusive durante o voo da flecha: assim o HUD
    // e o retorno da câmera não dependem de um estado que ficou para trás.
    this.updateAimViewpoint(aimAxis, eye, cameraPivot);

    if (this.mode === CameraMode.KAME) {
      const feixe = this.kameBeam;
      // Feixe que morreu (ou foi descartado) não prende ninguém numa câmera
      // órfã — o mesmo cuidado da câmera da flecha, logo abaixo.
      if (!feixe || feixe.morto) {
        this._leaveKameCam();
      } else {
        this.updateKameCam(dt, feixe);
        return;
      }
    }

    if (this.mode === CameraMode.ARROW) {
      const arrow = this.followArrow;
      // Se a flecha sumiu de vez, não prende o jogador numa câmera órfã.
      if (!arrow || arrow.dead) {
        // `aimMode` já valia o modo de destino, então a mira não muda aqui.
        this._leaveArrowCam();
      } else {
        this.updateArrowCam(dt, arrow);
        return;
      }
    }

    // A câmera de apresentação É o ponto de vista da mira — sem amortecimento
    // nem correção posterior, que é o que garante retículo cravado no centro.
    this.position.copy(this.aimOrigin);
    this.camera.position.copy(this.position);
    this.lookAt
      .copy(this.aimOrigin)
      .addScaledVector(this.aimForward, CONFIG.camera.convergence);
    this.camera.lookAt(this.lookAt);
    this.initialized = true;
  }

  /**
   * A câmera do feixe: à frente da ponta, de lado, olhando para trás.
   *
   * A câmera da flecha vai ATRÁS porque o que interessa nela é o alvo chegando.
   * Aqui é o contrário: o que interessa é a ORIGEM — o arqueiro plantado com as
   * mãos à frente e trezentos metros de energia saindo delas. Então a câmera se
   * põe adiante da ponta e olha para o peito de quem atirou; o feixe entra pelo
   * canto do quadro, atravessa em diagonal e converge no personagem, que vai
   * ficando pequeno enquanto a viagem continua.
   *
   * Três cuidados, e nenhum é enfeite:
   *
   * • **O afastamento CRESCE com a viagem** (`XGain · frente`). Com deslocamento
   *   fixo, a 400 m o arqueiro estaria a menos de um grau do eixo: o feixe
   *   viraria um ponto no centro da tela em vez de um traço. Crescendo, o ângulo
   *   se mantém e o traço continua traço.
   * • **Nunca dentro do halo.** O mínimo lateral (6 m) é maior que o raio
   *   externo do feixe (3,2 m) — dentro dele, um cilindro aditivo é uma tela
   *   branca, que é a lição mais cara de `docs/plano-kamehameha.md`.
   * • **Para ANTES do impacto, e nunca dentro do chão.** A viagem termina
   *   `standoff` metros atrás do fim, e a altura tem piso no terreno: colada na
   *   explosão a câmera lava o quadro, e num feixe rasante ela iria para debaixo
   *   da Lua.
   *
   * Tudo é função do estado do feixe — sem amortecimento, sem relógio próprio.
   * A ponta viaja a 300 m/s numa reta travada, então não há tremor a filtrar, e
   * um `damp` só produziria atraso.
   */
  updateKameCam(dt, feixe) {
    const c = CONFIG.camera.kameCam;
    const frente = feixe.frente;

    /* Base do enquadramento: o eixo do feixe, uma lateral e um "cima"
       perpendicular a ele. O cima do MUNDO não serve — com o feixe apontado
       para o zênite, `up` e o eixo são paralelos e o quadro tomba. */
    this._tmp.copy(feixe.dir);
    this._right.crossVectors(this._tmp, this._up);
    if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0);
    else this._right.normalize();
    this._axis.crossVectors(this._right, this._tmp).normalize();

    const lead = c.lead + c.leadGain * frente;
    const side = c.side + c.sideGain * frente;
    const up = c.up + c.upGain * frente;
    /* À frente da ponta, e a viagem PARA antes do fim. O limite não é o ponto
       de impacto: é `standoff` metros atrás dele. Ir até lá punha a câmera a
       dez metros de uma luz de intensidade 900, e o quadro lavava — ver o
       comentário do `standoff` no config. Nos últimos metros a ponta se afasta
       da câmera, e é ela quem explode ao longe. */
    const fim = Math.max(0, feixe.alcance - c.standoff);
    const eixo = Math.min(frente + lead, fim);

    this._desired
      .copy(feixe.origem)
      .addScaledVector(this._tmp, eixo)
      .addScaledVector(this._right, side)
      .addScaledVector(this._axis, up);

    const chao = feixe.terrain?.heightAt?.(this._desired.x, this._desired.z);
    if (Number.isFinite(chao)) {
      this._desired.y = Math.max(this._desired.y, chao + c.groundClearance);
    }

    // O olhar é a ORIGEM do feixe, que é o peito do arqueiro. É isto, e só
    // isto, que põe o personagem ao fundo com o raio saindo das mãos dele.
    this._look.copy(feixe.origem);

    this.position.copy(this._desired);
    this.lookAt.copy(this._look);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
    this.initialized = true;

    /* Chegou ao fim: segura o quadro por um instante para a explosão aparecer e
       devolve a terceira pessoa. Sair no mesmo frame do impacto é gastar a
       viagem inteira para não mostrar o que ela ia mostrar. */
    if (frente >= feixe.alcance - 0.01) {
      this.kameHold += dt;
      if (this.kameHold >= c.hold) this._leaveKameCam();
    }
  }

  updateArrowCam(dt, arrow) {
    // No impacto a flecha pode ficar presa a um alvo dinâmico — congelamos a
    // câmera na pose do momento do acerto, não no corpo que se move depois.
    if (arrow.stuck) {
      if (!this.arrowCamFrozen) {
        this.freezeArrowCam(arrow);
        this.arrowCamFrozen = true;
      }
      this.camera.position.copy(this.frozenPosition);
      this.camera.lookAt(this.frozenLookAt);
      return;
    }

    const c = CONFIG.camera.arrowCam;
    const t = arrow.body.translation();
    const v = arrow.body.linvel();
    this._tmp.set(v.x, v.y, v.z);
    if (this._tmp.lengthSq() < 1e-4) {
      this._tmp.copy(arrow.lastVelocity);
      if (this._tmp.lengthSq() < 1e-4) this._tmp.set(0, 0, -1);
    }
    this._tmp.normalize();

    this._desired
      .set(t.x, t.y, t.z)
      .addScaledVector(this._tmp, -c.distance)
      .addScaledVector(this._up, c.up);
    this._look.set(t.x, t.y, t.z).addScaledVector(this._tmp, 6);

    if (!this.initialized) {
      this.position.copy(this._desired);
      this.lookAt.copy(this._look);
      this.initialized = true;
    } else {
      const k = c.smoothing;
      this.position.x = damp(this.position.x, this._desired.x, k, dt);
      this.position.y = damp(this.position.y, this._desired.y, k, dt);
      this.position.z = damp(this.position.z, this._desired.z, k, dt);
      this.lookAt.x = damp(this.lookAt.x, this._look.x, k, dt);
      this.lookAt.y = damp(this.lookAt.y, this._look.y, k, dt);
      this.lookAt.z = damp(this.lookAt.z, this._look.z, k, dt);
    }

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }

  /** Fixa posição e olhar da câmera da flecha no instante do impacto. */
  freezeArrowCam(arrow) {
    const c = CONFIG.camera.arrowCam;
    const anchor = arrow.stickCamAnchor;
    const fwd = arrow.stickCamForward;
    this.frozenPosition
      .copy(anchor)
      .addScaledVector(fwd, -c.distance)
      .addScaledVector(this._up, c.up);
    this.frozenLookAt.copy(anchor).addScaledVector(fwd, 6);
  }
}
