/* ---------------------------------------------------------------------------
   O arqueiro — o RIG.

   O corpo é montado com primitivas e posicionado por IK de dois ossos: eu digo
   onde a mão precisa estar (o punho do arco, o nock da corda) e o cotovelo é
   resolvido geometricamente. Isso mantém a postura correta em qualquer ângulo
   de mira, sem esqueleto animado nem arquivos externos.

   Referencial: `root` fica nos pés, com -Z na direção da mira e +X à direita.
   O tronco é girado ~66° porque arqueiro atira de lado — é dessa rotação que
   nasce o enquadramento da referência (corpo à esquerda, arco no centro).

   ------------------------------------------------------------- rig e fantasia

   Este arquivo já foi as duas coisas ao mesmo tempo, e elas não são a mesma. O
   RIG é o que está aqui: estado, IK, pose, marcha, ragdoll, LOD, o que a rede
   escreve e o que a câmera lê. A FANTASIA — as primitivas e os materiais
   pendurados nas juntas — mora em `skins/`, e o rig não sabe o nome de nenhuma
   peça de roupa dela.

   O rig conhece a fantasia por SETE handles (`head`, `detail`, `sway`, `armR`,
   `armL`, `legR`, `legL`) e por quatro materiais que ele mesmo usa na flecha da
   mão e na faca. É todo o contrato. Ver `skins/index.js`.

   O que NÃO é da skin, de propósito: o jetpack (é equipamento da FASE, não da
   roupa), o arco, a flecha carregada e a faca — a geometria deles é linha de
   tiro, e a skin só pode mandar na paleta.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { Bow } from "./bow.js";
import { orientSegment } from "../utils/geometry.js";
import { solveTwoBoneIK, clamp, damp, smoothstep } from "../utils/math.js";
import { CONFIG, kameTotal } from "../config.js";
import { getSkin } from "./skins/index.js";
import { BODY, fillNeutralVertexColors, podarSombras } from "./skins/base.js";

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;
const _color = new THREE.Color();
/** Quanto o pé pode descer abaixo da base do corpo ao acompanhar o relevo (m). */
const MAX_STEP_DOWN = 0.45;

/**
 * A cota do chão sob um pé, relativa à base do corpo.
 *
 * O pé segue o RELEVO, e o relevo é amostrado no campo de altura da fase. Isso
 * vale enquanto o corpo está sobre o terreno — e deixa de valer no instante em
 * que ele pisa em alvenaria: no adarve do castelo o terreno sob o pé é o pátio,
 * **oito metros abaixo**.
 *
 * A versão anterior LIMITAVA essa descida a um passo (45 cm) e plantava o pé
 * ali. O limite evitava a perna de oito metros, mas o que sobrava era o defeito
 * relatado: os dois pés enterrados quarenta e cinco centímetros na pedra, em
 * todo o muro e o tempo todo.
 *
 * A correção é de INTERPRETAÇÃO, não de limite. Uma amostra que cai mais de um
 * passo abaixo do corpo não está descrevendo o chão em que se pisa — está
 * descrevendo outro chão, lá embaixo. Quando isso acontece, quem sabe a
 * verdade é o controlador de personagem, e a resposta dele é `position.y`: o
 * pé vai para o plano do próprio corpo. Ladeira abaixo, degrau de cratera e
 * rampa continuam funcionando, porque ali a amostra CABE no passo.
 *
 * @param {object} terrain campo de altura da fase
 * @param {number} wx @param {number} wz ponto do mundo sob o pé
 * @param {number} baseY cota do corpo (`position.y`)
 * @param {number} rootLift quanto o tronco subiu/desceu por cima dos pés
 */
function chaoSobOPe(terrain, wx, wz, baseY, rootLift) {
  const degrau = terrain.heightAt(wx, wz) - baseY;
  return (degrau < -MAX_STEP_DOWN ? 0 : degrau) - rootLift;
}

export class Player {
  /**
   * @param {object} terrain o chão desta fase
   * @param {number} entityId id no `entityRegistry`
   * @param {string} [skinId] a fantasia. Id desconhecido cai no padrão — quem
   *   decide isso é `getSkin`, e é por isso que a rede pode entregar aqui o que
   *   quiser sem derrubar o boneco de ninguém.
   */
  constructor(terrain, entityId = 1, skinId = undefined) {
    this.terrain = terrain;
    this.entityId = entityId;
    this.isLocal = true;
    /** Nome mostrado na etiqueta e nos avisos. Vem da rede; null = jogo local. */
    this.displayName = null;
    this.physicsBody = null;
    this.airborne = false;
    this.root = new THREE.Group();
    this.root.name = "archer";

    /** A fantasia deste corpo. Ver `skins/index.js`. */
    this.skin = getSkin(skinId);
    /** Materiais próprios deste arqueiro — ver `skin.createMaterials()`. */
    this.mat = this.skin.createMaterials();
    /** Cor do jogador (roupa, etiqueta, traçado). null = uniforme padrão. */
    this.color = null;
    this._opacity = 1;
    /* Estado que NÃO vive nas malhas e precisa ser vestido de novo quando o
       corpo é reconstruído numa troca de skin. Ver `setSkin`. */
    this._jetpackVisible = false;
    this._headVisible = true;
    /**
     * Imune a flecha — nasceu agora e ainda está piscando.
     *
     * É um booleano simples, atualizado a cada frame por quem cuida do
     * renascimento, em vez de um instante a comparar com o relógio. `hitResolver`
     * roda dentro do passo da física e não tem — nem deveria ter — acesso ao
     * relógio da sala.
     */
    this.invulnerable = false;
    /**
     * Limite de Z mínimo (modo série). Atrás da linha no chão os arqueiros
     * podem andar; além dela, não. null = sem limite.
     */
    this.minZ = null;
    /** 0 = de pé, 1 = caído. Sobrevive como medida de progresso do tombo. */
    this.deathFall = 0;
    /**
     * O corpo mole, quando morto. `null` = vivo.
     *
     * Quem cria e alimenta é o `Death` (ou o `RemotePlayer`); aqui só se lê.
     * O arqueiro não sabe simular um tombo — ele sabe VESTIR um.
     */
    this.ragdoll = null;

    this.position = new THREE.Vector3(
      CONFIG.player.start.x,
      0,
      CONFIG.player.start.z,
    );
    this.yaw = 0; // 0 = olhando para -Z, na direção dos alvos
    this.pitch = 0;
    this.drawFraction = 0;
    /* 0 = pronta para tensionar; (0,1] = mão da corda buscando flecha na
       aljava. Ver `setReload` / `updateReloadArm`. */
    this.reloadFraction = 0;
    /** 0 = sem golpe; 0..1 = animação da faca em andamento. */
    this.knifeFraction = 0;
    /** Fração da animação do especial. Ver `setKame` e `poseKamehameha`. */
    this.kameFraction = 0;
    this.bobPhase = 0;
    this.ponytailLag = new THREE.Vector2();
    this.prevYaw = 0;

    /* Estado da marcha. Ver `move()` para a ideia central: a fase do ciclo é
       medida em METROS PERCORRIDOS, não em segundos. */
    this.gaitPhase = 0; // rad — 2π = um ciclo completo (dois passos)
    this.gaitBlend = 0; // 0 parado … 1 em passo pleno
    /** Velocidade no instante em que os pés saíram do chão. Ver `move()`. */
    this._takeoffSpeed = CONFIG.player.walkSpeed;
    this.runBlend = 0; // 0 andando … 1 correndo
    this.moveF = 0; // componente frontal do movimento local, suavizada
    this.moveS = 0; // componente lateral do movimento local, suavizada
    this.speed = 0; // m/s reais, suavizados
    this.footYaw = BODY.stanceYaw; // rad — para onde a ponta do pé aponta
    this.rootLift = 0; // m — deslocamento vertical do corpo (quique + agacho)

    // Vetores reaproveitados por frame (zero alocação no loop).
    this._aim = new THREE.Vector3();
    this._shoulderR = new THREE.Vector3();
    this._shoulderL = new THREE.Vector3();
    this._hipR = new THREE.Vector3();
    this._hipL = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._knee = new THREE.Vector3();
    // Alvos do especial. Reaproveitados entre quadros: alocar quatro vetores
    // sessenta vezes por segundo é lixo que o coletor vem cobrar no meio do
    // efeito mais pesado do jogo.
    this._kameCenter = new THREE.Vector3();
    this._kameHandR = new THREE.Vector3();
    this._kameHandL = new THREE.Vector3();
    this._kameFoot = new THREE.Vector3();
    this._handTarget = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._idleHand = new THREE.Vector3();
    this._nock = new THREE.Vector3();
    this._quiverGrab = new THREE.Vector3();
    this._reloadHand = new THREE.Vector3();
    this._knifeHand = new THREE.Vector3();
    this._knifeStart = new THREE.Vector3();
    this._knifePeak = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
    this._lateral = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._tailA = new THREE.Vector3();
    this._tailB = new THREE.Vector3();
    this._tailC = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this._euler = new THREE.Euler(0, 0, 0, "YXZ");

    this.build();
    this.setAim(0, 0);
  }

  /* ----------------------------------------------------------- montagem --- */

  /**
   * Monta o corpo: o rig arma o esqueleto, a skin veste.
   *
   * A ORDEM aqui carrega razões, e trocar duas linhas de lugar quebra coisas
   * que não parecem ter relação nenhuma:
   *
   *   1. o `spine` primeiro — é o pai de tudo o que a skin pendura no tronco;
   *   2. a skin, que devolve os handles que a pose lê;
   *   3. o jetpack, filho do `spine` e que NÃO é da skin (é equipamento da
   *      FASE: um capuz não muda a mochila);
   *   4. a flecha carregada e a faca, que são do rig mas moram na mão da skin;
   *   5. `fillNeutralVertexColors` depois de tudo isso e ANTES do arco. Os
   *      materiais do corpo têm `vertexColors: true`, e o Three define
   *      `USE_COLOR` a partir do MATERIAL, sem olhar se a geometria tem o
   *      atributo. Numa geometria sem ele o WebGL entrega (0,0,0) e a peça sai
   *      PRETA. Só segmentos e juntas nascem com cor (ver `utils/geometry.js`);
   *      pescoço, nariz, cinto, aljava e o resto são primitivas cruas, e é aqui
   *      que elas recebem o branco. O arco fica de fora porque os materiais
   *      dele não têm `vertexColors`, e o atributo seria memória à toa;
   *   6. `podarSombras` por último, quando já existe tudo o que ela mede.
   */
  build() {
    // Pivô do tronco: gira em Y (postura de lado) e em X (inclinação da mira).
    this.spine = new THREE.Group();
    this.spine.position.set(0, BODY.hipY, 0);
    this.root.add(this.spine);

    const corpo = this.skin.build(this);
    this.head = corpo.head;
    /* As peças que somem com a distância, repartidas pela skin em dois níveis.
       Ver `setDetailLevel` para a regra que impede que um corte abra buraco. */
    this.detail = {
      perto: corpo.detail?.perto ?? [],
      medio: corpo.detail?.medio ?? [],
    };
    /** A ponta que balança com atraso: rabo de cavalo, rabicho do capuz… */
    this.sway = corpo.sway ?? null;
    this.armR = corpo.armR; // braço do arco
    this.armL = corpo.armL; // braço da corda
    this.legR = corpo.legR;
    this.legL = corpo.legL;
    this.root.add(this.armR.group, this.armL.group);
    this.root.add(this.legR.group, this.legL.group);

    this.buildJetpack();

    /* Flecha que a mão carrega da aljava até o nock durante o reload.
       Fica escondida fora dessa janela — a flecha encaixada no arco é outra. */
    this.heldArrow = this.buildHeldArrow();
    this.armL.hand.add(this.heldArrow);
    this.heldArrow.visible = false;

    /* A faca fica presa à mão livre e só aparece enquanto o golpe acontece. */
    this.knife = this.buildKnife();
    this.armL.hand.add(this.knife);
    this.knife.visible = false;

    fillNeutralVertexColors(this.root);

    /* arco ---------------------------------------------------------------- */
    this.bow = new Bow(this.skin.bowPalette);
    this.root.add(this.bow.group);

    podarSombras(this.root);

    /* O que o rig pendurou no `root` e sabe desmontar.
     *
     * O `root` também recebe coisas de FORA — a etiqueta de nome de um jogador
     * remoto é filha dele (ver `net/remotePlayers.js`) —, e varrer os filhos às
     * cegas numa troca de skin levaria a etiqueta junto. */
    this._bodyParts = [
      this.spine,
      this.armR.group,
      this.armL.group,
      this.legR.group,
      this.legL.group,
      this.bow.group,
    ];
  }

  /**
   * Troca a fantasia com o corpo já de pé.
   *
   * É a tela de entrada que usa isto, onde nenhum laço de quadro está rodando e
   * a troca sai de graça. Reconstruir é seguro porque NENHUM estado vive dentro
   * das malhas: posição, mira, fase da marcha, tensionamento e o resto são
   * campos desta classe, e a pose inteira é derivada deles a cada quadro.
   *
   * O que não é derivado são as cinco coisas numeradas abaixo — e é aqui que
   * elas voltam. Esquecer qualquer uma dá um bug silencioso do pior tipo: o que
   * só aparece na Lua, ou só em primeira pessoa, ou só depois de morrer.
   */
  setSkin(id) {
    const nova = getSkin(id);
    if (nova === this.skin) return;

    /* O que precisa sobreviver à remontagem é lido ANTES dela.
     *
     * `jetFlame` é o caso traiçoeiro: ele não morre com as malhas, ele é ZERADO
     * por `buildJetpack()` — que é chamado lá dentro do `build()`. Ler depois
     * devolveria sempre 0, e trocar de skin no meio de um voo apagaria o jato
     * de quem está no ar. */
    const cor = this.color;
    const jato = this.jetFlame;
    const mochila = this._jetpackVisible;
    const cabeca = this._headVisible;
    const nivel = this._detailLevel ?? 0;

    this.disposeBody();
    this.skin = nova;
    this.mat = this.skin.createMaterials();
    this.build();

    /* 1. A cor. `setColor` sai fora quando a cor pedida é igual à guardada, e o
          corpo novo nasceria sem tingir — daí zerar antes de repetir. */
    this.color = null;
    if (cor != null) this.setColor(cor);
    // 2. A mochila é da FASE, e a fase não mudou porque a roupa mudou.
    this.setJetpackVisible(mochila);
    this.setJetFlame(jato);
    // 3. A cabeça, que fica escondida em primeira pessoa.
    this.setHeadVisible(cabeca);
    // 4. O nível de detalhe, cuja memória de "já está assim" morreu com as peças.
    this._detailLevel = null;
    this.setDetailLevel(nivel);
    /* 5. As duas peças que só aparecem no meio de uma animação.
     *
     * A FACA precisa disto: quem decide se ela existe é `setKnife`, e o corpo
     * novo nasceu com ela escondida.
     *
     * A FLECHA CARREGADA não precisa, e é bom saber por quê em vez de repetir a
     * condição aqui: quem liga e desliga a flecha da mão é `updateReloadArm`, a
     * partir da fração, TODO QUADRO. Ela sai daqui invisível e volta ao certo no
     * próximo `update()` — que roda antes de qualquer desenho, então não existe
     * um quadro em que se veja a mão vazia. Repetir a janela `0,32 ≤ t < 0,7`
     * neste método seria criar uma segunda cópia dela para sair de sincronia
     * mais tarde. O que se chama abaixo é só o outro lado de `setReload`: com
     * fração zero, garantir que a flecha está escondida. */
    this.setReload(this.reloadFraction);
    this.setKnife(this.knifeFraction);
  }

  /**
   * Devolve à GPU o corpo inteiro, e só o corpo.
   *
   * O `Set` de materiais não é zelo: o mesmo couro veste quatro peças, e sem
   * ele `dispose()` seria chamado várias vezes no mesmo material.
   */
  disposeBody() {
    const materiais = new Set();
    for (const parte of this._bodyParts ?? []) {
      parte.traverse((o) => {
        o.geometry?.dispose();
        if (!o.material) return;
        if (Array.isArray(o.material)) for (const m of o.material) materiais.add(m);
        else materiais.add(o.material);
      });
      this.root.remove(parte);
    }
    for (const m of materiais) m.dispose();
    this._bodyParts = [];
  }

  /* -------------------------------------------------------------- estado --- */

  setAim(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = clamp(pitch, CONFIG.player.pitchMin, CONFIG.player.pitchMax);
  }

  setDraw(fraction) {
    this.drawFraction = clamp(fraction, 0, 1);
  }

  /**
   * Progresso da animação de recarregar (0 = ociosa, 1 = acabou de encaixar).
   * Quem dispara o timer é o `main`; aqui só vestimos a pose.
   */
  setReload(fraction) {
    this.reloadFraction = clamp(fraction, 0, 1);
    if (this.reloadFraction <= 0 && this.heldArrow) {
      this.heldArrow.visible = false;
    }
  }

  /** Progresso do golpe de faca; a animação é vestida por `updateKnifeArm`. */
  /**
   * A fração da animação do especial — 0 a 1 ao longo dos ~7 s.
   *
   * Um número só carrega as cinco fases (concha no quadril, esfera crescendo,
   * empurrão, tremor, retorno) porque o corpo é montado por PROCEDIMENTO, não
   * por animação gravada: `poseKamehameha` lê esta fração e deriva tudo. É o
   * mesmo desenho do `knifeFraction`, e é o que faz a pose do companheiro
   * aparecer na sua tela sem uma única mensagem nova (ela viaja no `q` da
   * pose, que já sai a 20 Hz).
   */
  setKame(fraction) {
    this.kameFraction = clamp(fraction, 0, 1);
    if (this.kameFraction > 0 && this.heldArrow) this.heldArrow.visible = false;
  }

  get kameActive() {
    return (this.kameFraction ?? 0) > 0;
  }

  setKnife(fraction) {
    this.knifeFraction = clamp(fraction, 0, 1);
    if (this.knife) this.knife.visible = this.knifeFraction > 0;
    if (this.knifeFraction > 0 && this.heldArrow) {
      this.heldArrow.visible = false;
    }
  }

  get isKnifeAttacking() {
    return this.knifeFraction > 0;
  }

  get isReloading() {
    return this.reloadFraction > 0;
  }

  /** Haste simples na mão da corda — só aparece no meio do reload. */
  buildHeldArrow() {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.55, 5),
      this.mat.arrowShaft,
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.22;
    shaft.castShadow = true;
    group.add(shaft);

    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.007, 0.04, 5),
      this.mat.metal,
    );
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.52;
    group.add(tip);

    const fletch = new THREE.Mesh(
      new THREE.PlaneGeometry(0.06, 0.018),
      this.mat.fletch,
    );
    fletch.rotation.y = Math.PI / 2;
    fletch.position.set(0, 0.01, 0.02);
    group.add(fletch);

    // Orientação na palma: haste saindo para trás da mão.
    group.position.set(0.01, 0.02, -0.02);
    group.rotation.set(0.15, 0.4, 0.35);
    return group;
  }

  /** Faca curta, presa à mão livre, invisível fora do golpe. */
  buildKnife() {
    const group = new THREE.Group();

    const cabo = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.12, 0.026),
      this.mat.leatherDark,
    );
    cabo.position.y = 0.075;
    cabo.castShadow = true;

    const guarda = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.018, 0.035),
      this.mat.metal,
    );
    guarda.position.y = 0.145;
    guarda.castShadow = true;

    const lamina = new THREE.Mesh(
      new THREE.BoxGeometry(0.038, 0.28, 0.012),
      this.mat.metal,
    );
    lamina.position.y = 0.29;
    lamina.castShadow = true;

    group.add(cabo, guarda, lamina);
    return group;
  }

  /** Todos os materiais deste arqueiro, o arco incluído. */
  get materials() {
    return [...Object.values(this.mat), ...(this.bow?.materials ?? [])];
  }

  /**
   * Cor do jogador.
   *
   * QUAIS peças recebem a cor é decisão da skin — o gambeson do medieval e a
   * camiseta da atleta não são a mesma peça, e o rig não conhece nenhuma das
   * duas. O que o rig garante é o CRITÉRIO, e ele vale para toda skin: tinge só
   * a roupa. Pele e cabelo ficam como estão de propósito, porque colorir o
   * corpo inteiro apaga o volume do personagem e ele vira uma silhueta chapada
   * — justamente quando você mais precisa reconhecer quem é à distância.
   */
  setColor(hex) {
    if (hex == null || hex === this.color) return;
    this.color = hex;
    this.skin.tint(this.mat, _color.set(hex));
  }

  /**
   * Pisca sem mudar flags de material.
   *
   * Alternar `transparent`, `depthWrite` e `needsUpdate` a cada fase do piscar
   * invalida programas do Three e pode recompilar todos os materiais do jogador
   * no meio do respawn. A invulnerabilidade é um estado curto: esconder o grupo
   * nos vales da curva produz o mesmo sinal visual sem tocar no pipeline PBR.
   */
  setOpacity(alpha) {
    if (alpha === this._opacity) return;
    this._opacity = alpha;
    this.root.visible = alpha >= 0.5;
  }

  /** Libera GPU ao tirar um jogador remoto da cena. */
  dispose() {
    for (const m of this.materials) m.dispose();
    this.root.traverse((o) => o.geometry?.dispose());
  }

  /** Move no plano; a altura vem do terreno. */
  move(dt, forward, strafe, wantRun = false) {
    const p = CONFIG.player;
    const g = CONFIG.gait;
    const moving = forward !== 0 || strafe !== 0;

    /* CORRER É COISA DE QUEM TEM CHÃO.
     *
     * Sem apoio não há de onde empurrar: quem sai do chão leva a velocidade que
     * tinha e nada que se aperte depois muda isso. Antes, Shift no meio do
     * salto esticava o pulo — uma tecla apertada DEPOIS de os pés saírem do
     * chão alterando a trajetória, que é o oposto do que qualquer um espera.
     *
     * A velocidade de decolagem é GUARDADA em vez de simplesmente cair para a
     * caminhada. Cair para a caminhada seria o outro erro, simétrico: quem
     * pulou correndo frearia no ar sem motivo nenhum. */
    if (!this.airborne) this._takeoffSpeed = wantRun ? p.runSpeed : p.walkSpeed;
    const alvoNoChao = wantRun ? p.runSpeed : p.walkSpeed;
    const target = moving ? (this.airborne ? this._takeoffSpeed : alvoNoChao) : 0;

    // A velocidade persegue o alvo em vez de saltar: sair andando e frear têm
    // peso, e Shift acelera de forma contínua.
    this.speed = damp(this.speed, target, p.speedSmoothing, dt);
    const correndo = moving && wantRun && !this.airborne;
    this.runBlend = damp(this.runBlend, correndo ? 1 : 0, p.runSmoothing, dt);

    let fx = 0;
    let sx = 0;
    const step = this.speed * dt;
    if (moving) {
      const len = Math.hypot(forward, strafe) || 1;
      fx = forward / len;
      sx = strafe / len;
      if (step > 1e-6) {
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        const wdx = (-sin * fx + cos * sx) * step;
        const wdz = (-cos * fx - sin * sx) * step;
        if (this.physicsBody) {
          const frameDt = Math.max(dt, 1e-4);
          this.physicsBody.setHorizontalMove(wdx / frameDt, wdz / frameDt);
        } else {
          this.stepTo(wdx, wdz);
        }
      }
    }
    if (this.physicsBody && (!moving || step <= 1e-6)) {
      this.physicsBody.setHorizontalMove(0, 0);
    }

    /* Composição do passo. `moveF`/`moveS` guardam o vetor de movimento em
       coordenadas do corpo (frente e lado) já amortecido — é essa proporção que
       mistura o balanço sagital com o passo lateral, e é o SINAL de `moveF` que
       inverte o ciclo ao andar para trás. `gaitBlend` liga e desliga a animação
       inteira, garantindo o retorno suave à pose neutra ao parar. */
    this.moveF = damp(this.moveF, fx, g.blendSmoothing, dt);
    this.moveS = damp(this.moveS, sx, g.blendSmoothing, dt);

    /* NO AR NÃO SE CAMINHA.
     *
     * O ciclo de passada era ligado por "está se movendo?", e no ar isso
     * continua verdade — a pessoa está atravessando o espaço. O resultado era
     * um boneco pedalando enquanto voa, e só quem pulava PARADO via a pose de
     * salto correta, o que fazia o bug parecer aleatório.
     *
     * A condição certa é "há chão sob o pé para empurrar". Sem chão, o
     * `gaitBlend` cai a zero e a pose de salto — que já existe e é montada a
     * partir de `airborne` — assume sozinha. */
    const caminhando = moving && !this.airborne;
    this.gaitBlend = damp(this.gaitBlend, caminhando ? 1 : 0, g.blendSmoothing, dt);

    /* A FASE ANDA COM A DISTÂNCIA, não com o relógio: um ciclo completo a cada
       `strideLength` metros. Assim a cadência acompanha sozinha a velocidade
       real — o pé nunca patina no chão nem "corre no lugar" — e a corrida sai
       mais rápida de graça, ainda por cima com a passada mais longa. */
    const stride = g.strideLength * (1 + g.runStrideGain * this.runBlend);
    // A fase congela no ar junto com o `gaitBlend`: deixá-la correr faria o
    // boneco pousar num ponto arbitrário do ciclo, com a perna no alto.
    if (!this.airborne) {
      this.gaitPhase += (step / stride) * TAU;
      if (this.gaitPhase > TAU) this.gaitPhase -= TAU;
    }

    this.bobPhase += dt * 1.3; // respiração — independe da marcha

    if (!this.physicsBody) {
      this.position.y = this.terrain.heightAt(this.position.x, this.position.z);
    }
    return moving;
  }

  /**
   * O toque no espaço.
   *
   * Quem decide se isso é um salto ou a ignição do jetpack é o
   * `PlayerPhysics` — ele é quem sabe se os pés estão no chão. Aqui a tecla
   * continua sendo só "a tecla de pular".
   */
  /**
   * A mochila do jetpack e o fogo dos bocais.
   *
   * Nasce SEMPRE, e fica invisível fora da Lua. A alternativa — construir na
   * troca de fase — parece mais econômica e é pior: são nove malhas por
   * arqueiro vezes doze jogadores para alocar no instante em que o mundo está
   * sendo reconstruído, que é justamente o pico de trabalho do quadro. Escondida
   * ela não custa desenho nenhum; o Three descarta objeto invisível antes de
   * qualquer coisa.
   *
   * A chama é `MeshBasicMaterial` com `fog: false`: ela EMITE, não recebe. Um
   * material iluminado ficaria escuro no vácuo — apareceria preta no meio do
   * próprio fogo, que é o mesmo motivo pelo qual as tochas do modo zumbi usam
   * este material.
   */
  buildJetpack() {
    const g = new THREE.Group();
    g.name = "jetpack";
    g.visible = false;
    const y = (BODY.shoulderY - BODY.hipY) * 0.55;

    const casco = new THREE.MeshStandardMaterial({
      color: "#cfd2d6",
      roughness: 0.5,
      metalness: 0.35,
    });
    const cinta = new THREE.MeshStandardMaterial({
      color: "#2c3036",
      roughness: 0.75,
      metalness: 0.2,
    });

    // Dois tanques e a placa que os une às costas.
    const placa = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.30, 0.07), casco);
    placa.position.set(0, y, 0.155);
    g.add(placa);

    this.jetNozzles = [];
    for (const lado of [-1, 1]) {
      const tanque = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.062, 0.18, 4, 10),
        casco,
      );
      tanque.position.set(lado * 0.105, y, 0.215);
      g.add(tanque);

      const bocal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.055, 0.09, 8),
        cinta,
      );
      bocal.position.set(lado * 0.105, y - 0.185, 0.205);
      bocal.rotation.x = -0.22;
      g.add(bocal);

      /* A chama: um cone virado para BAIXO, saindo do bocal. É o gás que
         empurra o corpo, então ele aponta para onde o empuxo não vai. */
      const chama = new THREE.Mesh(
        new THREE.ConeGeometry(0.05, 0.42, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffb347,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
          fog: false,
        }),
      );
      chama.position.set(lado * 0.105, y - 0.44, 0.19);
      chama.rotation.x = Math.PI;
      g.add(chama);

      // Halo aditivo: dá calor sem uma luz pontual, que é o que derruba o
      // desempenho quando doze jogadores acendem ao mesmo tempo.
      const halo = new THREE.Mesh(
        new THREE.ConeGeometry(0.10, 0.62, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xff8a30,
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
          fog: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      halo.position.copy(chama.position);
      halo.rotation.x = Math.PI;
      g.add(halo);

      this.jetNozzles.push({ chama, halo });
    }

    for (const m of [placa, ...g.children]) m.castShadow = true;

    this.jetpackGroup = g;
    /** 0 = jato apagado, 1 = queimando. Chega pela rede nos remotos (`j`). */
    this.jetFlame = 0;
    this.spine.add(g);
  }

  /** A fase tem jetpack? Mostra ou esconde a mochila inteira. */
  setJetpackVisible(on) {
    // Guardado, e não só escrito na malha: a mochila é da FASE, e a malha morre
    // numa troca de skin. Sem esta linha, escolher outro corpo na Lua devolve
    // um arqueiro voando sem nada nas costas.
    this._jetpackVisible = on;
    if (this.jetpackGroup) this.jetpackGroup.visible = on;
  }

  /**
   * Estado do fogo (0..1). Chamado com o próprio jetpack no jogador local e com
   * o campo `j` da rede nos remotos — os dois caminhos terminam aqui, então a
   * chama do amigo é desenhada pelo mesmo código que a sua.
   */
  setJetFlame(t) {
    this.jetFlame = Math.max(0, Math.min(1, t));
    if (!this.jetNozzles) return;
    const on = this.jetFlame > 0.01;
    for (const n of this.jetNozzles) {
      n.chama.visible = on;
      n.halo.visible = on;
      if (!on) continue;
      /* Tremula. O comprimento varia com um seno rápido de fase deslocada por
         bocal — sem isso são dois cones parados, que leem como plástico. */
      const f = 0.78 + 0.22 * Math.sin(this.gaitPhase * 9 + n.chama.position.x * 60);
      n.chama.scale.set(1, f * this.jetFlame, 1);
      n.halo.scale.set(1, f * this.jetFlame * 1.1, 1);
    }
  }

  jump() {
    if (this.physicsBody?.onJumpPressed) this.physicsBody.onJumpPressed();
    else this.physicsBody?.queueJump();
  }

  /** Soltou o espaço: apaga o jato (guardando o combustível que sobrou). */
  jumpReleased() {
    this.physicsBody?.onJumpReleased?.();
  }

  getHitBody() {
    return this.physicsBody?.getHitBody() ?? null;
  }

  onArrowHit(_impact, _arrow) {
    /* Futuro: dano, animação de impacto */
  }

  getPosition() {
    return this.position;
  }

  /** Stub para sync multiplayer futuro. */
  applyNetworkState(_state) {}

  /**
   * Avança o passo respeitando os limites da arena — e DESLIZANDO neles.
   *
   * O limite não é uma caixa invisível: é o próprio terreno. `isWalkable`
   * recusa o que é íngreme demais para se subir e o que passou da borda da
   * bacia. Quando o passo inteiro é recusado, cada eixo é tentado sozinho:
   * assim, encostar na serra em diagonal faz a arqueira correr rente à
   * encosta em vez de travar de repente.
   *
   * O terreno se estende centenas de metros além disso, então mesmo que este
   * teste falhasse não haveria buraco para cair — só encosta.
   */
  stepTo(dx, dz) {
    const p = this.position;
    if (this.tryStep(p.x + dx, p.z + dz)) return;
    if (this.tryStep(p.x + dx, p.z)) return;
    this.tryStep(p.x, p.z + dz);
  }

  tryStep(x, z) {
    // Modo série: a linha no chão. Quem passa dela anula o tiro à distância.
    if (this.minZ != null && z < this.minZ) z = this.minZ;
    if (!this.terrain.isWalkable(x, z)) return false;
    this.position.x = x;
    this.position.z = z;
    return true;
  }

  /** Fator de amplitude do passo: 1 andando, cresce até a corrida plena. */
  get strideScale() {
    return 1 + CONFIG.gait.runAmplitudeGain * this.runBlend;
  }

  /* --------------------------------------------------------------- pose ---- */

  update(dt, moving) {
    // Morto, o corpo não anda: quem manda na pose é o ragdoll, e ele já traz
    // posição, orientação e a ponta de cada membro prontas.
    if (this.ragdoll?.active) {
      this.poseRagdoll(dt);
      return;
    }

    // O quique vertical sai da MESMA fase do passo (dois toques de pé por
    // ciclo), com `gaitBlend` desligando na parada e a respiração assumindo.
    // Sem isso teríamos duas fontes de verdade para a cadência e o corpo
    // subiria fora de sincronia com os pés.
    const g = CONFIG.gait;
    const w = this.gaitBlend;
    const amp = this.strideScale;

    const stepBob = Math.sin(this.gaitPhase * 2) * g.bobAmplitude * amp * w;
    const breath = Math.sin(this.bobPhase) * 0.006 * (1 - w);
    const jumpLift = this.airborne
      ? Math.sin(Math.min(1, (this.physicsBody?.verticalVelocity ?? 0) / CONFIG.player.jumpSpeed + 0.5) * Math.PI) * 0.06
      : 0;
    this.rootLift = stepBob + breath - g.crouch * w * (1 - this.airborne * 0.8) + jumpLift;

    this.root.position.set(
      this.position.x,
      this.position.y + this.rootLift,
      this.position.z,
    );
    /* A rotação é escrita INTEIRA, e não só em Y e Z.
     *
     * O ragdoll põe uma orientação arbitrária no `root` (por quaternion, ver
     * `poseRagdoll`), e o Three sincroniza os ângulos de Euler a partir dela —
     * inclusive o X. Ao renascer, escrever só Y e Z deixava aquele X para trás,
     * e a arqueira voltava à vida permanentemente tombada para a frente. */
    this.root.rotation.set(0, this.yaw, this.deathFall * Math.PI * 0.5);
    if (this.deathFall > 0) this.root.position.y -= this.deathFall * 0.22;

    // Direção da mira no espaço do root (o yaw já está no root).
    this._aim.set(0, Math.sin(this.pitch), -Math.cos(this.pitch));
    // Lateral do corpo (direita), usada para manter os cotovelos para fora.
    this._lateral.set(1, 0, 0);

    /* Para onde a ponta do pé aponta. Parada, ela mantém a base de arqueiro;
       andando, vira parcialmente para a direção da marcha — pelo caminho
       angular curto, para não dar meia-volta ao inverter o sentido. */
    const mag = Math.hypot(this.moveF, this.moveS);
    let turn = 0;
    if (mag > 1e-3) {
      let d = Math.atan2(-this.moveS, this.moveF) - BODY.stanceYaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      turn = d * g.footTurn * w * Math.min(1, mag);
    }
    this.footYaw = BODY.stanceYaw + turn;

    /* Tronco: postura de lado + inclinação acompanhando a mira + a torção do
       passo. A torção é cancelada conforme o arco tensiona: mirando, o tronco
       trava, e a caminhada não mexe na linha da flecha nem no punho do arco. */
    const twist =
      Math.sin(this.gaitPhase) * g.torsoTwist * amp * w * (1 - this.drawFraction);
    this._q.setFromAxisAngle(AXIS_X, -this.pitch * 0.42);
    this._qb.setFromAxisAngle(AXIS_Y, BODY.stanceYaw + twist);
    this.spine.quaternion.copy(this._q).multiply(this._qb);
    this.spine.updateMatrix();

    // A cabeça compensa a rotação do tronco para olhar o alvo.
    this.head.rotation.y = -BODY.stanceYaw * 0.86;
    this.head.rotation.x = -this.pitch * 0.35;

    this.localToRoot(BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderR);
    this.localToRoot(-BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderL);
    this.localToRoot(BODY.hipX, -0.02, 0, this._hipR);
    this.localToRoot(-BODY.hipX, -0.02, 0, this._hipL);

    if (this.kameActive) {
      /* O ESPECIAL substitui arco, braços e pernas — não os corrige.
       *
       * Entra aqui, e não como um ramo dentro de `updateArms`, pelo mesmo
       * motivo do `poseRagdoll`: a faca troca UM braço, e cabe num desvio lá
       * dentro; isto troca os dois braços, o arco, a base das pernas e a
       * orientação do tronco. Um ramo por peça espalharia a mesma decisão por
       * quatro funções. */
      this.poseKamehameha(dt);
    } else {
      this.updateBow();
      this.updateArms(dt);
      this.updateLegs();
    }
    this.updateSway(dt);

    this.prevYaw = this.yaw;
    this.root.updateMatrixWorld(true);
  }

  /* ------------------------------------------------------------- especial --
   *
   * A POSE INTEIRA, derivada de uma fração.
   *
   * O corpo do jogo não usa animação de esqueleto exportada: `poseArm` é IK de
   * dois ossos com vetor de polo, e é ela que anima a marcha, o tensionamento,
   * a recarga na aljava e o corpo mole. Aqui ela recebe outros alvos, e isso é
   * a animação inteira — nenhum osso novo, nenhum arquivo.
   *
   * As cinco fases do CORPO, em segundos (de `CONFIG.special`):
   *
   *   carga 0,5 → disparo 0,15 → sustentação 3,0 → dissipação 0,36 → retorno 0,08
   *
   * A dissipação daqui é a da POSE (`poseDissipate`), que é bem mais curta que
   * a do feixe: a cauda de luz ainda leva 1,2 s para ir embora, e o arqueiro
   * não tem nada a fazer nesse tempo — ele já empurrou.
   *
   * O que muda em cada uma está escrito abaixo, na ordem em que o corpo faz.
   */

  /**
   * Em que fase estamos, e o quanto dela já passou.
   *
   * A linha do tempo do CORPO usa `poseDissipate`, não `dissipate`: a cauda do
   * feixe leva 1,2 s para ir embora e o arqueiro não tem nada a fazer nesse
   * tempo — ele já empurrou. Ver o bloco das fases em `config.js`.
   */
  kamePhase() {
    const S = CONFIG.special;
    const total = kameTotal();
    const t = this.kameFraction * total;
    if (t < S.charge) return { fase: "carga", u: t / S.charge, t };
    if (t < S.charge + S.release) {
      return { fase: "disparo", u: (t - S.charge) / S.release, t };
    }
    if (t < S.charge + S.release + S.sustain) {
      return { fase: "feixe", u: (t - S.charge - S.release) / S.sustain, t };
    }
    if (t < total - S.recover) {
      const base = S.charge + S.release + S.sustain;
      return { fase: "dissipando", u: (t - base) / S.poseDissipate, t };
    }
    return { fase: "retorno", u: (t - (total - S.recover)) / S.recover, t };
  }

  poseKamehameha(dt) {
    const P = CONFIG.special.pose;
    const { fase, u } = this.kamePhase();

    /* Quanto o corpo já "entrou" no especial: 0 na pose normal, 1 na pose
       cheia. Ele sobe rápido no início da carga e desce no retorno — e é ele
       que faz a transição não ter corte, sem uma única interpolação escrita à
       mão entre dois estados. */
    const entrada =
      fase === "carga"
        ? smoothstep(0, 0.35, u)
        : fase === "retorno"
          ? 1 - smoothstep(0, 1, u)
          : 1;

    /* ---------------------------------------------------------- o tronco --
       Ele ESQUADRA para o alvo: o arqueiro deixa de estar de perfil (1,16 rad)
       e passa a encarar o que vai destruir. É a mudança mais legível de todas,
       e é ela que anuncia o golpe de longe, antes de qualquer luz. */
    const yawAlvo =
      fase === "carga" ? P.stanceYawCharge : fase === "retorno" ? P.stanceYawCharge : P.stanceYawFire;
    const stanceYaw = BODY.stanceYaw + (yawAlvo - BODY.stanceYaw) * entrada;

    // Inclina para trás na carga, para a frente empurrando o feixe.
    let pitchTronco = -this.pitch * 0.42;
    if (fase === "carga") pitchTronco -= 0.15 * entrada * u;
    else if (fase === "feixe") pitchTronco += 0.08 * u;

    this._q.setFromAxisAngle(AXIS_X, pitchTronco);
    this._qb.setFromAxisAngle(AXIS_Y, stanceYaw);
    this.spine.quaternion.copy(this._q).multiply(this._qb);
    this.spine.updateMatrix();
    this.head.rotation.y = -stanceYaw * 0.86;
    this.head.rotation.x = -this.pitch * 0.35;

    /* O RECUO. O root vai para trás no disparo e volta devagar — é o que vende
       o peso, e custa uma linha porque a posição já é escrita todo quadro. */
    if (fase === "disparo") {
      this.root.position.addScaledVector(this._aim, -P.recoil * (1 - u));
    } else if (fase === "feixe") {
      this.root.position.addScaledVector(this._aim, -P.recoil * 0.45 * (1 - u));
    }

    // Ombros e quadris na pose nova (o tronco girou; eles giram junto).
    this.localToRoot(BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderR);
    this.localToRoot(-BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderL);
    this.localToRoot(BODY.hipX, -0.02, 0, this._hipR);
    this.localToRoot(-BODY.hipX, -0.02, 0, this._hipL);

    this.kameBow(entrada);
    this.kameArms(fase, u, entrada);
    this.kameLegs(entrada, fase);
  }

  /**
   * O arco vai para as costas.
   *
   * Ele é um grupo filho do root, posicionado a cada quadro — então "guardar"
   * é escrever outra transformação, sem reparentar nada. Ao lado da aljava, na
   * diagonal, com a troca interpolada para não teleportar.
   */
  kameBow(entrada) {
    const P = CONFIG.special.pose;
    /* A posição INTERPOLA com a entrada, não salta.
     *
     * Escrevendo o destino direto, o arco teleportava da mão para as costas no
     * primeiro quadro do especial — e voltava do mesmo jeito. Meio segundo de
     * viagem é o que transforma isso num gesto (ele guarda o arco) em vez de um
     * corte. O ponto de partida é onde o `updateBow` normal o deixou. */
    this.localToRoot(P.bowBack.x, P.bowBack.y, P.bowBack.z, this._tmp);
    this.bow.group.position.lerp(this._tmp, entrada);
    this._euler.set(0.35 * entrada, 0, P.bowBackRoll * entrada);
    this.bow.group.quaternion.setFromEuler(this._euler);
    this.bow.setDraw(0);
    this.bow.setArrowVisible(false);
  }

  kameArms(fase, u, entrada) {
    const P = CONFIG.special.pose;
    const tremor = fase === "carga" ? P.tremorCharge * u : fase === "feixe" ? P.tremorSustain : 0;
    const shake = tremor
      ? Math.sin(performance.now() * 0.001 * P.tremorHz * TAU) * tremor
      : 0;

    /* A concha ao lado do quadril: as duas palmas separadas por 30 cm fechando
       para 22 — é o gesto que a referência tem, e é o espaço onde a esfera
       cresce. */
    const aberto = P.handsApartStart + (P.handsApartEnd - P.handsApartStart) * u;

    if (fase === "carga" || fase === "retorno") {
      this.localToRoot(P.handsHip.x, P.handsHip.y, P.handsHip.z, this._kameCenter);
      this._kameCenter.addScaledVector(this._aim, shake);
      const meio = (fase === "carga" ? aberto : P.handsApartEnd) * 0.5;
      /* Cotovelos ABERTOS, para fora e para trás. Sem este polo os braços
         colam no corpo e a pose vira "mãos no bolso" em vez de "segurando
         alguma coisa que quer sair". */
      this._pole
        .copy(this._aim)
        .multiplyScalar(-0.5)
        .addScaledVector(this._lateral, 0.7)
        .addScaledVector(AXIS_Y, -0.2)
        .normalize();
      this._kameHandR.copy(this._kameCenter).addScaledVector(AXIS_Y, meio);
      this._kameHandL.copy(this._kameCenter).addScaledVector(AXIS_Y, -meio);
      this.poseArm(this.armR, this._shoulderR, this._kameHandR, this._pole, 0.0);
      this._pole.multiplyScalar(-1).addScaledVector(AXIS_Y, -0.4).normalize();
      this.poseArm(this.armL, this._shoulderL, this._kameHandL, this._pole, 0.0);
      return;
    }

    /* Disparo e feixe: as mãos vão à frente do peito, palmas para fora, punhos
       juntos. Os braços ficam a ~90 % de extensão — travado no cotovelo lê como
       boneco de pau, e é o erro mais comum de IK. */
    const avanco = fase === "disparo" ? P.handsFire.forward * smoothstep(0, 1, u) : P.handsFire.forward;
    const deriva = fase === "feixe" ? 0.05 * u : 0;
    this._kameCenter
      .copy(this._shoulderR)
      .lerp(this._shoulderL, 0.5)
      .addScaledVector(this._aim, avanco + deriva + shake)
      .addScaledVector(AXIS_Y, P.handsFire.up + (fase === "feixe" ? 0.03 * u : 0));

    this._pole
      .copy(this._aim)
      .multiplyScalar(-0.35)
      .addScaledVector(AXIS_Y, -0.55)
      .addScaledVector(this._lateral, 0.5)
      .normalize();
    this._kameHandR.copy(this._kameCenter).addScaledVector(this._lateral, 0.075);
    this.poseArm(this.armR, this._shoulderR, this._kameHandR, this._pole, P.straighten);

    this._pole
      .copy(this._aim)
      .multiplyScalar(-0.35)
      .addScaledVector(AXIS_Y, -0.55)
      .addScaledVector(this._lateral, -0.5)
      .normalize();
    this._kameHandL.copy(this._kameCenter).addScaledVector(this._lateral, -0.075);
    this.poseArm(this.armL, this._shoulderL, this._kameHandL, this._pole, P.straighten);
  }

  /** Onde a energia sai: o meio das duas mãos, no espaço do MUNDO. */
  kameMuzzle(out) {
    out.copy(this._kameCenter ?? this.root.position);
    return out.applyMatrix4(this.root.matrix);
  }

  /**
   * Base larga e joelhos dobrados — e, no disparo, um afundo.
   *
   * A perna da frente avança 35 cm no instante em que o feixe sai. Sem isso o
   * corpo dispara em posição de sentido, e nenhuma quantidade de luz conserta
   * uma pose que não tem peso.
   */
  kameLegs(entrada, fase) {
    const P = CONFIG.special.pose;
    const largura = BODY.stanceWidth + (P.stanceWidth - BODY.stanceWidth) * entrada;
    const avanco = fase === "carga" || fase === "retorno" ? 0 : P.lunge * entrada;

    this.poseKameLeg(this.legR, this._hipR, largura, avanco);
    this.poseKameLeg(this.legL, this._hipL, -largura, -avanco * 0.4);
  }

  /**
   * Uma perna plantada, com afundo.
   *
   * Reaproveita `poseLegTo` — a mesma IK que a marcha e o corpo mole usam —,
   * então bermuda, joelho e sapato saem certos de graça. O que este método faz
   * é só decidir ONDE o pé está: parado, largo, e a perna da frente adiantada.
   */
  poseKameLeg(leg, hip, side, avanco) {
    const pe = this._kameFoot;
    // Base larga, na orientação do tronco — a mesma conta do `footTarget` na
    // fase parada, sem o balanço do passo.
    const x = Math.cos(BODY.stanceYaw) * side;
    const z = -Math.sin(BODY.stanceYaw) * side;
    pe.set(x, 0, z).addScaledVector(this._aim, avanco);

    // O chão sob o pé, na mesma convenção do ciclo de marcha (ver `footTarget`).
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const wx = this.root.position.x + c * pe.x + s * pe.z;
    const wz = this.root.position.z - s * pe.x + c * pe.z;
    const groundY = chaoSobOPe(this.terrain, wx, wz, this.position.y, this.rootLift);
    pe.y = groundY + BODY.ankleY;

    // Joelho para a frente do corpo: é o que dá o agachamento em vez de a perna
    // dobrar para o lado.
    this._pole
      .set(-Math.sin(BODY.stanceYaw), 0.12, -Math.cos(BODY.stanceYaw))
      .normalize();
    this.poseLegTo(leg, hip, pe, this._pole);
  }

  localToRoot(x, y, z, out) {
    return out.set(x, y, z).applyMatrix4(this.spine.matrix);
  }

  /* -------------------------------------------------------------- ragdoll --
   *
   * A pose de um corpo sem tônus. Ela substitui `update()` inteiro na morte, e
   * não o corrige: marcha, mira e tensionamento não existem mais aqui.
   *
   * A divisão de trabalho é a mesma do resto do arquivo: quem calcula É OUTRO
   * (`game/ragdoll.js`, que simula o tombo e as pontas dos membros), e este
   * método só VESTE o resultado no esqueleto — a mesma IK de dois ossos que
   * anima a caminhada, alimentada com alvos que agora vêm da física em vez do
   * ciclo de passo. É por isso que o corpo mole não precisou de nenhum osso
   * novo nem de um segundo boneco.
   */
  poseRagdoll(dt) {
    const rd = this.ragdoll;
    rd.update(dt);

    rd.rootPosition(this.root.position);
    this.root.quaternion.copy(rd.orient);
    this.root.updateMatrix();

    /* Tronco: encurvado pelas molas da coluna, e com a postura de arqueiro
       (o tronco de lado) desaparecendo — ela é tensão muscular, e o que
       define este estado é justamente não haver nenhuma. */
    this._q.setFromAxisAngle(AXIS_X, rd.spine.pitch);
    this._qb.setFromAxisAngle(AXIS_Z, rd.spine.roll);
    this.spine.quaternion.copy(this._q).multiply(this._qb);
    this._qb.setFromAxisAngle(AXIS_Y, BODY.stanceYaw * 0.25);
    this.spine.quaternion.multiply(this._qb);
    this.spine.updateMatrix();

    this.head.rotation.set(rd.neck.pitch * 0.6, 0, rd.neck.roll);

    this.localToRoot(BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderR);
    this.localToRoot(-BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0, this._shoulderL);
    this.localToRoot(BODY.hipX, -0.02, 0, this._hipR);
    this.localToRoot(-BODY.hipX, -0.02, 0, this._hipL);

    // Mãos e pés não atravessam o chão. A simulação dos membros roda no espaço
    // do root, que está girando; o chão é do mundo — então a checagem tem de
    // ir e voltar. É uma vez por membro por frame, não por subpasso.
    this.clampLimbToGround(rd.handR.p, 0.05);
    this.clampLimbToGround(rd.handL.p, 0.05);
    this.clampLimbToGround(rd.footR.p, 0.08);
    this.clampLimbToGround(rd.footL.p, 0.08);

    // Cotovelos para fora, joelhos para a frente: sem um pólo definido a IK
    // escolhe um plano arbitrário e as juntas dobram para dentro do corpo.
    this._pole.set(1, 0.25, -0.3).normalize();
    this.poseArm(this.armR, this._shoulderR, rd.handR.p, this._pole, 0.02);
    this._pole.set(-1, 0.25, -0.3).normalize();
    this.poseArm(this.armL, this._shoulderL, rd.handL.p, this._pole, 0.02);

    this._pole.set(0, 0.15, -1).normalize();
    this.poseLegTo(this.legR, this._hipR, rd.footR.p, this._pole);
    this.poseLegTo(this.legL, this._hipL, rd.footL.p, this._pole);

    // O arco cai junto com a mão que o segurava — largá-lo no chão exigiria um
    // objeto solto com vida própria, e ninguém repara nele durante o tombo.
    this.bow.group.position.copy(rd.handR.p);
    this.bow.group.quaternion.copy(this.armR.fore.quaternion);

    this.updateSway(dt);
    this.prevYaw = this.yaw;
    this.root.updateMatrixWorld(true);
  }

  /** Impede que uma ponta de membro entre no terreno. `p` é do espaço do root. */
  clampLimbToGround(p, folga) {
    this._tmp.copy(p).applyQuaternion(this.root.quaternion).add(this.root.position);
    const chao = this.terrain.heightAt(this._tmp.x, this._tmp.z) + folga;
    if (this._tmp.y >= chao) return;
    this._tmp.y = chao;
    this._tmp.sub(this.root.position);
    p.copy(this._tmp).applyQuaternion(this._q.copy(this.root.quaternion).invert());
  }

  updateBow() {
    /* A geometria do tiro nasce da ANCORAGEM, não do ombro.
     *
     * Num arqueiro de verdade a corda é puxada até um ponto fixo do rosto (o
     * canto da boca, do lado da mão que puxa) e o arco fica onde a linha da
     * flecha manda. Derivar o punho a partir do ombro, como eu fazia antes,
     * jogava o nock para o lado ERRADO do rosto: o braço da corda tinha que
     * atravessar o tronco para alcançá-lo.
     *
     * Aqui ela puxa com a mão esquerda, então a âncora fica à esquerda do
     * queixo e o braço da corda trabalha do seu próprio lado do corpo. */
    this.localToRoot(0, BODY.headY - BODY.hipY, 0, this._anchor);
    this._anchor.x -= BODY.anchorSide; // lado da mão que puxa
    this._anchor.y -= BODY.anchorDrop; // canto da boca
    this._anchor.addScaledVector(this._aim, BODY.anchorForward);

    // Punho do arco: sobre a linha da flecha, à frente da âncora.
    const grip = this._tmp
      .copy(this._anchor)
      .addScaledVector(this._aim, this.bow.fullDrawReach);

    this.bow.group.position.copy(grip);
    // -Z do arco na direção da mira, com inclinação lateral (cant) de ~12°,
    // como na referência.
    this._euler.set(this.pitch, 0, -0.21);
    this.bow.group.quaternion.setFromEuler(this._euler);
    this.bow.setDraw(this.drawFraction);
    /* Sem flecha no arco enquanto a mão busca outra na aljava. Volta a
       aparecer quando a mão chega perto do nock (ver `updateReloadArm`). */
    const t = this.reloadFraction;
    const flechaNoArco = t <= 0 || t >= 0.7;
    this.bow.setArrowVisible(flechaNoArco);
  }

  updateArms(dt) {
    /* braço do arco: quase reto, cotovelo girado para baixo e para fora ----- */
    const gripLocal = this.bow.group.position;
    this._pole.set(0.55, -1, 0.15).normalize();
    this.poseArm(this.armR, this._shoulderR, gripLocal, this._pole, 0.06);

    if (this.knifeFraction > 0) {
      this.updateKnifeArm();
      return;
    }

    if (this.reloadFraction > 0) {
      this.updateReloadArm();
      return;
    }

    /* braço da corda: puxa o nock, cotovelo alto e para trás ---------------- */
    // Nock em coordenadas do root, direto da transformação local do arco (sem
    // depender de matrizes de mundo, que ainda não foram atualizadas).
    this._nock
      .copy(this.bow.nockPoint)
      .applyQuaternion(this.bow.group.quaternion)
      .add(this.bow.group.position);
    /* Antes de tensionar, a mão descansa junto ao quadril — e é só aí que ela
       balança com o passo, em fase com a perna DIREITA (braço e perna opostos,
       como na marcha humana). Assim que a corda começa a ser puxada o balanço
       desaparece: o braço do arco nunca é tocado, então a mira não sente nada. */
    const armSwing =
      Math.cos(this.gaitPhase) *
      CONFIG.gait.armSwing *
      this.strideScale *
      this.gaitBlend *
      (1 - this.drawFraction);
    this._idleHand
      .copy(this._hipL)
      .add(this._tmp.set(-0.06, -0.16, 0.06 - armSwing));
    const grab = clamp(this.drawFraction * 5, 0, 1);
    this._handTarget.copy(this._idleHand).lerp(this._nock, grab);

    // Cotovelo alto e para trás, alinhado com a flecha — e sempre para FORA do
    // corpo (lado da mão que puxa), nunca cruzando o peito.
    this._pole
      .copy(this._aim)
      .multiplyScalar(-1)
      .addScaledVector(AXIS_Y, 0.45)
      .addScaledVector(this._lateral, -0.55)
      .normalize();
    this.poseArm(this.armL, this._shoulderL, this._handTarget, this._pole, 0.0);
  }

  /** Estocada curta com a mão que não segura o arco. */
  updateKnifeArm() {
    const t = this.knifeFraction;

    this._idleHand
      .copy(this._hipL)
      .add(this._tmp.set(-0.06, -0.16, 0.06));
    this._knifeStart
      .copy(this._idleHand)
      .addScaledVector(this._aim, 0.08)
      .addScaledVector(AXIS_Y, 0.05);
    this._knifePeak
      .copy(this._shoulderL)
      .addScaledVector(this._aim, 0.42)
      .addScaledVector(this._lateral, -0.14)
      .addScaledVector(AXIS_Y, -0.1);

    if (t < 0.2) {
      const k = smoothstep(0, 0.2, t);
      this._knifeHand.copy(this._knifeStart).lerp(this._knifePeak, k);
    } else if (t < 0.45) {
      this._knifeHand.copy(this._knifePeak);
    } else {
      const k = smoothstep(0.45, 1, t);
      this._knifeHand.copy(this._knifePeak).lerp(this._knifeStart, k);
    }

    this._pole
      .copy(this._aim)
      .multiplyScalar(-0.45)
      .addScaledVector(AXIS_Y, 0.6)
      .addScaledVector(this._lateral, -0.8)
      .normalize();
    this.poseArm(this.armL, this._shoulderL, this._knifeHand, this._pole, 0.0);

    if (this.heldArrow) this.heldArrow.visible = false;
  }

  /**
   * Mão da corda: nock → aljava → nock → repouso.
   *
   * É a mão LIVRE depois do tiro (a outra segura o arco). Sai da face, sobe
   * pelas costas até a aljava, traz a flecha de volta ao arco e só então
   * descansa no quadril. Funciona andando, correndo ou parado.
   */
  updateReloadArm() {
    const t = this.reloadFraction;

    this._nock
      .copy(this.bow.nockPoint)
      .applyQuaternion(this.bow.group.quaternion)
      .add(this.bow.group.position);

    // Boca da aljava, um pouco acima do cilindro — onde a mão "pega" a haste.
    this.localToRoot(
      -0.1,
      (BODY.shoulderY - BODY.hipY) * 0.88,
      0.2,
      this._quiverGrab,
    );

    this._idleHand.copy(this._hipL).add(this._tmp.set(-0.06, -0.16, 0.06));

    let hand;
    if (t < 0.32) {
      // Da face (onde soltou a corda) para as costas / aljava.
      const k = smoothstep(0, 0.32, t);
      hand = this._reloadHand.copy(this._nock).lerp(this._quiverGrab, k);
    } else if (t < 0.42) {
      // Segura um instante — o "pegou".
      hand = this._reloadHand.copy(this._quiverGrab);
    } else if (t < 0.78) {
      // Traz a flecha até o nock e encaixa.
      const k = smoothstep(0.42, 0.78, t);
      hand = this._reloadHand.copy(this._quiverGrab).lerp(this._nock, k);
    } else {
      // Solta o nock e volta ao quadril.
      const k = smoothstep(0.78, 1, t);
      hand = this._reloadHand.copy(this._nock).lerp(this._idleHand, k);
    }

    // Cotovelo alto e para trás enquanto alcança a aljava; depois abre de
    // lado no caminho de volta ao arco.
    const reachBack = t < 0.5 ? 1 : 1 - smoothstep(0.5, 0.85, t);
    this._pole
      .copy(this._aim)
      .multiplyScalar(-0.35 - 0.65 * reachBack)
      .addScaledVector(AXIS_Y, 0.55 + 0.35 * reachBack)
      .addScaledVector(this._lateral, -0.35 - 0.4 * reachBack)
      .normalize();
    this.poseArm(this.armL, this._shoulderL, hand, this._pole, 0.0);

    // Flecha na mão só no trecho aljava → nock.
    if (this.heldArrow) {
      this.heldArrow.visible = t >= 0.32 && t < 0.7;
    }
  }

  poseArm(arm, shoulder, hand, pole, straighten) {
    solveTwoBoneIK(
      shoulder,
      hand,
      BODY.upperArm + straighten,
      BODY.foreArm + straighten,
      pole,
      this._elbow,
    );
    orientSegment(arm.upper, shoulder, this._elbow);
    orientSegment(arm.fore, this._elbow, hand);
    arm.elbow.position.copy(this._elbow);
    arm.hand.position.copy(hand);
    // A mão deixou de ser uma esfera: sem orientar, os dedos apontariam para
    // uma direção fixa do mundo enquanto o braço gira.
    arm.hand.quaternion.copy(arm.fore.quaternion);
    // Punheira logo antes da mão.
    arm.band.position.copy(hand).lerp(this._elbow, 0.22);
    arm.band.quaternion.copy(arm.fore.quaternion);
  }

  /* ---------------------------------------------------------------- passo --
   *
   * O ciclo de marcha é descrito pelo PÉ, não por ângulos de junta: cada perna
   * recebe um alvo de pé deslocado em torno do quadril e a mesma IK de dois
   * ossos do resto do corpo resolve coxa e canela. Deslocar o pé para a frente
   * É girar a coxa em X; deslocá-lo para o lado É girá-la em Z — com três
   * vantagens sobre escrever os ângulos na mão:
   *
   *   • o joelho dobra sozinho na fase de balanço, porque levantar o pé encurta
   *     a distância quadril→pé e a IK responde com flexão;
   *   • o pé continua acompanhando o relevo (a altura vem do terreno sob ELE);
   *   • a pose parada continua saindo da mesma função, sem caso especial.
   *
   * As duas pernas andam em CONTRAFASE (π de diferença), e as componentes
   * sagital e frontal entram na proporção do vetor de movimento local — o que
   * dá a diagonal de graça. Andar para trás inverte `moveF` e, com ele, o
   * sentido do ciclo.
   */

  updateLegs() {
    this.poseLeg(this.legR, this._hipR, BODY.stanceWidth, 0);
    this.poseLeg(this.legL, this._hipL, -BODY.stanceWidth, Math.PI);
  }

  /**
   * Alvo do pé no espaço do root.
   * @param {number} side  afastamento ao longo do eixo lateral do tronco (m)
   * @param {number} theta fase desta perna no ciclo (rad)
   */
  footTarget(side, theta, out) {
    const g = CONFIG.gait;
    const w = this.gaitBlend;
    const amp = this.strideScale * w;

    if (this.airborne) {
      const stance = side * (1 - g.stanceNarrow * 0.4);
      let x = Math.cos(BODY.stanceYaw) * stance;
      let z = -Math.sin(BODY.stanceYaw) * stance;
      const tuck = 0.28 + Math.sin(this.gaitPhase * 2) * 0.04;
      return out.set(x, BODY.ankleY + tuck, z);
    }

    // Andando, a base de arqueiro se fecha: pés tão abertos só fazem sentido
    // plantada, e fechá-los ainda dá alcance de sobra para a passada.
    const stance = side * (1 - g.stanceNarrow * w);

    // Eixo lateral do tronco projetado no chão (X local do tronco girado).
    let x = Math.cos(BODY.stanceYaw) * stance;
    let z = -Math.sin(BODY.stanceYaw) * stance;

    /* Deslocamento do passo. O cosseno dá a posição ao longo do ciclo; a
       amplitude de cada plano é ponderada pela componente correspondente do
       movimento (frente/lado), então diagonal vira mistura das duas. */
    const swing = Math.cos(theta) * amp;
    x += swing * g.lateralAmplitude * this.moveS; // plano frontal (A/D)
    z -= swing * g.swingAmplitude * this.moveF; // plano sagital (W/S), -Z à frente

    // Mesmo ponto em mundo, para amostrar a altura do terreno sob o pé.
    // Rotação em torno de Y (convenção do Three): x' = x·cos + z·sen.
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const wx = this.root.position.x + c * x + s * z;
    const wz = this.root.position.z - s * x + c * z;
    /* `rootLift` sai da conta para que o pé fique colado no chão enquanto o
       corpo quica e agacha por cima dele. O resto — e por que a amostra do
       terreno às vezes precisa ser IGNORADA em vez de limitada — está em
       `chaoSobOPe`. */
    const groundY = chaoSobOPe(this.terrain, wx, wz, this.position.y, this.rootLift);

    /* Fase de balanço = pé indo NA DIREÇÃO da marcha, ou seja, derivada
       positiva do deslocamento acima. Como a projeção do deslocamento sobre a
       direção do movimento vale cos(θ)·(algo ≥ 0) qualquer que seja o sentido,
       o critério é sempre −sen(θ) > 0 — e o pé levanta na hora certa mesmo
       andando para trás ou de lado. Levantar o pé é o que dobra o joelho. */
    const lift = Math.max(0, -Math.sin(theta)) * g.footLift * amp;

    return out.set(x, groundY + BODY.ankleY + lift, z);
  }

  poseLeg(leg, hip, side, phaseOffset) {
    const foot = this.footTarget(side, this.gaitPhase + phaseOffset, this._tmp);

    // Joelho aponta para onde o corpo está virado, virando um pouco para a
    // direção da marcha enquanto anda.
    this._pole
      .set(-Math.sin(BODY.stanceYaw), 0.1, -Math.cos(BODY.stanceYaw))
      .addScaledVector(
        this._tmpB.set(this.moveS, 0, -this.moveF),
        CONFIG.gait.kneeTurn * this.gaitBlend,
      )
      .normalize();
    this.poseLegTo(leg, hip, foot, this._pole);
  }

  /**
   * Resolve uma perna para um alvo de pé JÁ decidido.
   *
   * Separado de `poseLeg` porque o ragdoll também precisa dele: lá o pé não sai
   * do ciclo de marcha, sai da simulação do corpo mole. A IK e a orientação dos
   * segmentos são as mesmas nos dois casos — só a origem do alvo muda.
   */
  poseLegTo(leg, hip, foot, pole) {
    solveTwoBoneIK(hip, foot, BODY.thigh, BODY.shin, pole, this._knee);
    orientSegment(leg.thigh, hip, this._knee);
    orientSegment(leg.shin, this._knee, foot);
    // Bermuda: metade de cima da coxa.
    this._tmpB.copy(hip).lerp(this._knee, 0.52);
    orientSegment(leg.short, hip, this._tmpB);
    leg.knee.position.copy(this._knee);
    leg.shoe.position.copy(foot);
    leg.shoe.position.y -= BODY.ankleY;
    // A ponta do pé (-Z do grupo) aponta para onde o corpo está virado —
    // parcialmente girada para a direção da marcha enquanto anda.
    leg.shoe.rotation.set(0, this.footYaw, 0);
  }

  /**
   * A ponta que balança com atraso.
   *
   * Era o rabo de cavalo da arqueira, e a máquina não tem nada de feminino: são
   * duas seções em cadeia com atraso proporcional à velocidade angular. No
   * medieval ela move o RABICHO DO CAPUZ (o liripipe), e uma skin careca passa
   * `sway: null` e não paga nada por isso.
   *
   * Os números vêm da skin (`tuning`), com os da arqueira como padrão — pano
   * pesado quer ganho e amortecimento menores que cabelo.
   */
  updateSway(dt) {
    const s = this.sway;
    if (!s) return;
    const k = s.tuning;

    // O atraso: a ponta "sobra" na virada e volta amortecida.
    let dYaw = this.yaw - this.prevYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const yawRate = dt > 0 ? dYaw / dt : 0;

    this.ponytailLag.x = damp(
      this.ponytailLag.x,
      clamp(yawRate * k.yawGain, -0.5, 0.5),
      k.dampYaw,
      dt,
    );
    this.ponytailLag.y = damp(
      this.ponytailLag.y,
      clamp(-this.pitch * k.pitchGain + Math.sin(this.bobPhase * 2) * 0.05, -0.4, 0.4),
      k.dampPitch,
      dt,
    );

    const a = this._tailA.set(0, 0, 0);
    const b = this._tailB.set(
      this.ponytailLag.x * k.swingA,
      k.dropA + this.ponytailLag.y * k.bobA,
      k.backA,
    );
    const c = this._tailC.set(
      b.x + this.ponytailLag.x * k.swingB,
      b.y + k.dropB + this.ponytailLag.y * k.bobB,
      b.z + k.backB,
    );
    orientSegment(s.a, a, b);
    s.b.position.copy(b);
    orientSegment(s.tip, a, c.sub(b));
  }

  /* --------------------------------------------------------------- tiro ---- */

  /** Ponto de disparo (repouso da flecha) em coordenadas de mundo. */
  getMuzzle(out) {
    return this.bow.getMuzzleWorld(out);
  }

  /**
   * Pivô da câmera em terceira pessoa: altura do ombro sobre os pés.
   *
   * A inclinação da mira não entra aqui — senão girar o mouse lateralmente
   * empurra a câmera para frente e para trás. `rootLift` também não: o quique
   * do passo, o agacho e a respiração são animação do CORPO, e passá-los para a
   * câmera é o que fazia a imagem balançar ao andar mirando. O pulo continua
   * sendo acompanhado, porque ele está em `position.y`.
   */
  getCameraPivot(out) {
    return out.set(
      this.position.x,
      this.position.y + BODY.shoulderY,
      this.position.z,
    );
  }

  /**
   * Olho da arqueira, em coordenadas de mundo: logo acima da ancoragem da
   * corda. É de lá que ela mira, então é de lá que a primeira pessoa enxerga —
   * a flecha passa rente à câmera e o arco aparece à frente.
   */
  getEye(out, aimWorld) {
    this._eye.copy(this._anchor);
    this._eye.y += CONFIG.firstPerson.eyeAboveAnchor;
    this._eye.x -= CONFIG.firstPerson.eyeSide;
    out.copy(this._eye).applyMatrix4(this.root.matrixWorld);
    if (aimWorld) out.addScaledVector(aimWorld, CONFIG.firstPerson.eyeForward);
    return out;
  }

  /** Esconde a cabeça na primeira pessoa (senão a câmera fica dentro dela). */
  setHeadVisible(visible) {
    // Guardado pelo mesmo motivo do jetpack: trocar de corpo em primeira pessoa
    // devolveria uma cabeça nova bem no meio da câmera.
    this._headVisible = visible;
    this.head.visible = visible;
  }

  /**
   * NÍVEL DE DETALHE DO CORPO — 0 perto, 1 médio, 2 longe.
   *
   * Era só o rosto, cortado a 12 m. Virou o corpo inteiro, em três níveis, e a
   * razão é aritmética: com um corte só, cada arqueiro desenhava ~90 malhas a
   * QUALQUER distância até 160 m, e doze deles custavam mais de mil chamadas de
   * desenho — o que impedia qualquer detalhe novo de existir.
   *
   *   perto (≤ 12 m, e sempre o jogador local) — tudo: rosto, falanges,
   *     costuras, fivelas, vincos de pano
   *   médio (12–40 m) — corpo, roupa em camadas, massas musculares, bordas
   *   longe (> 40 m) — as formas estruturais e a silhueta
   *
   * A REGRA QUE TORNA ISTO SEGURO: nenhuma peça de detalhe pode ser estrutural.
   * Cada uma some POR CIMA de uma forma que continua ali — o deltoide some sobre
   * o braço, a gola sobre a túnica, o nó sobre o dedo. Nunca aparece buraco, e a
   * silhueta sobrevive aos três níveis. Quem garante isso é a skin, ao repartir
   * as peças; quem confere é a chave de níveis da bancada.
   *
   * Quem CONHECE a distância é o jogador remoto (`net/remotePlayers.js`); aqui
   * só se veste o resultado, e só na virada — escrever `visible` em dezenas de
   * objetos por quadro por jogador seria trocar desenho por trabalho de CPU.
   */
  setDetailLevel(nivel) {
    if (this._detailLevel === nivel) return;
    this._detailLevel = nivel;
    for (const o of this.detail.perto) o.visible = nivel <= 0;
    for (const o of this.detail.medio) o.visible = nivel <= 1;
  }
}

/**
 * O nível de detalhe de um corpo a esta distância.
 *
 * Os cortes são onde a peça deixa de render pixel: a 12 m uma íris tem meio
 * pixel; a 40 m uma costura de manga tem menos que isso, e o que resta a essa
 * distância é contorno.
 */
export function detailLevelFor(distancia) {
  if (distancia <= DETAIL_NEAR) return 0;
  if (distancia <= DETAIL_MID) return 1;
  return 2;
}

/** Distância (m) até onde o corpo é desenhado inteiro. */
export const DETAIL_NEAR = 12;
/** Distância (m) até onde ele mantém camadas de roupa e massa muscular. */
export const DETAIL_MID = 40;


