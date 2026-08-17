/* ---------------------------------------------------------------------------
   A FUGA — o rasgo de luz no céu, a morte do planeta, e o estado que os dois
   desenham.

   Duas coisas moram aqui, e elas são duas porque respondem a perguntas
   diferentes sobre o mesmo acontecimento:

   • `EstadoDoFim` é a CÓPIA CLIENTE da máquina de estados da sala
     (`server/namek/fim.js`). Ela não decide nada — recebe a fase, prevê o
     relógio entre dois tiques de rede, responde "quantos metros faltam" e
     **escreve o regime de voo** em `FighterController.regime`. É por ela que o
     teto de 520 m vira 2 000 durante a fuga e que o chão desliga no espaço.
   • `NamekFuga` é o que se VÊ: o portal, as fissuras que abrem no chão enquanto
     o relógio corre, o clarão, a onda de choque e o planeta afundando.

   Estar no mesmo arquivo não é economia de arquivo: é que o desenho do portal e
   a conta de "faltam 940 m" leem exatamente os mesmos três números
   (`NAMEK.fim.fuga.altitude`, `.raio`, o ponto que a sala mandou), e separá-los
   seria a primeira oportunidade de eles discordarem — a seta apontando para um
   lugar e a distância medindo até outro.

   ------------------------------------------------------------------ o desenho

   Nada aqui entra em `NamekWorld.root`, e isso é deliberado. `root` é o
   PLANETA, e a fase `espaco` o apaga com uma linha (`root.visible = false`).
   Se o clarão e a onda de choque estivessem dentro dele, o planeta sumiria
   levando junto a explosão que o estava matando.

   Orçamento (§3): duas malhas fixas para o portal, uma instância para as
   fissuras, duas para o estouro. Cinco chamadas de desenho, ~2 400 triângulos,
   nenhuma textura, nada alocado por quadro.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { clamp } from "../../utils/math.js";

/* As fases, iguais às de `server/namek/fim.js`. Repetidas e não importadas: o
   cliente não pode carregar um módulo de `server/`, e o que atravessa a rede é
   uma string — a lista é o contrato, não o objeto. */
export const FASE = {
  CALMO: "calmo",
  FREEZA: "freeza",
  CONTAGEM: "contagem",
  EXPLODINDO: "explodindo",
  ESPACO: "espaco",
};

/* ========================================================================== */
/* ============================== O ESTADO ================================== */
/* ========================================================================== */

/**
 * O que este cliente sabe sobre o fim do planeta.
 *
 * **Ele nunca decide.** Quem escapou, quem morreu e quanto falta no relógio são
 * da sala (§8 do plano); o que existe aqui é o relógio andando entre dois
 * pacotes, para o número da tela descer segundo a segundo em vez de aos pulos.
 *
 * **A fuga é altitude**, não esforço: não há relógio de subida, não há acúmulo,
 * não há nada por jogador além de "eu já saí?". O que este objeto mede por
 * quadro é geometria — a que altura estou e quantos metros faltam até a boca do
 * portal. Ver `NAMEK.fim.fuga`.
 */
export class EstadoDoFim {
  constructor() {
    /** @type {string} uma de `FASE`. */
    this.fase = FASE.CALMO;
    /** s — o que falta no relógio da fase. Anda localmente entre tiques. */
    this.restante = 0;
    /** Eu já saí do planeta? */
    this.euEscapei = false;
    /** Ids de todos os que já estão no espaço — inclusive eu. */
    this.escapados = new Set();

    /** A boca do portal, como a sala a declarou. */
    this.portal = { x: 0, y: NAMEK.fim.fuga.altitude, z: 0 };
    /** m — quanto falta para chegar nela, em linha reta. Reescrito por quadro. */
    this.metros = 0;
    /** m — a minha altitude agora. É o outro número que o HUD mostra. */
    this.altitude = 0;

    /* A bolha do espaço, pré-alocada: ela é escrita direto no `regime` do
       controlador, e um literal por quadro ali seria lixo no caminho mais
       quente do modo. */
    this._bolha = {
      x: 0,
      y: NAMEK.fim.espaco.altura,
      z: 0,
      raio: NAMEK.fim.espaco.raio,
    };

    /* A BORDA de cada acontecimento, para quem desenha. São lidos e zerados por
       `NamekGame.step` no mesmo quadro — é o mesmo contrato do `_evento` de
       `movement.js`, e pelo mesmo motivo: quem precisa deles precisa AGORA. */
    this.trocouDeFase = false;
    this.explodiuAgora = false;
    this.escapeiAgora = false;
  }

  /** A fuga está aberta: teto alto, portal aceso, contagem correndo. */
  get fugaAberta() {
    return this.fase === FASE.CONTAGEM;
  }

  /** m — a altitude que é preciso vencer. O HUD a mostra ao lado da atual. */
  get altitudeAlvo() {
    return this.portal.y;
  }

  /** EU estou no espaço — o que decide o meu regime de voo e o meu céu. */
  get euNoEspaco() {
    return this.euEscapei || this.fase === FASE.ESPACO;
  }

  /** O planeta ainda existe para alguém? */
  get temPlaneta() {
    return this.fase !== FASE.ESPACO;
  }

  /**
   * 0..1 — o quanto da ALTURA já foi vencido. É a barra do HUD.
   *
   * Do nível do mar até a boca, e não da altura em que se estava quando a
   * contagem começou: a barra tem de significar a mesma coisa para todo mundo na
   * mesma sala, e um zero que depende de onde cada um estava seria uma barra que
   * mede pessoas diferentes com réguas diferentes.
   */
  get fracaoDaFuga() {
    const base = NAMEK.world.seaLevel;
    return clamp((this.altitude - base) / (this.portal.y - base), 0, 1);
  }

  /* ---------------------------------------------------------------- rede --- */

  /**
   * `NS2C.FIM_ESTADO` — e também o `fim` do `welcome`, que é o mesmo objeto.
   *
   * @param {object} msg
   * @param {number} meuId
   */
  aplicarEstado(msg, meuId) {
    if (!msg || typeof msg.fase !== "string") return;
    const antes = this.fase;
    this.fase = msg.fase;
    this.restante = Math.max(0, (msg.restante ?? 0) / 1000);

    if (Array.isArray(msg.portal) && msg.portal.length === 3) {
      this.portal.x = msg.portal[0];
      this.portal.y = msg.portal[1];
      this.portal.z = msg.portal[2];
    }

    this.escapados.clear();
    for (const id of msg.escapados ?? []) this.escapados.add(id);
    this.euEscapei = this.escapados.has(meuId);

    /* O planeta voltou: eu não escapei de nada. Sem esta linha, quem tivesse
       saído numa tempestade desfeita continuaria com o céu de estrelas e sem
       chão depois de o mundo voltar a existir. */
    if (this.fase === FASE.CALMO) this.euEscapei = false;
    if (antes !== this.fase) this.trocouDeFase = true;
  }

  /** `NS2C.FIM_CONTAGEM` — o relógio da sala corrigindo o que corre aqui. */
  aplicarContagem(msg) {
    if (!msg) return;
    /* ATRIBUIÇÃO e não perseguição amortecida: este número decide se o jogador
       continua subindo ou desiste, e um cronômetro que persegue mentiria por até
       um segundo justamente no fim, que é quando ele é lido. */
    if (Number.isFinite(msg.restante)) this.restante = Math.max(0, msg.restante);
  }

  /** `NS2C.FIM_ESCAPOU`. @returns {boolean} fui EU? */
  aplicarEscape(msg, meuId) {
    if (!msg || !Number.isFinite(msg.id)) return false;
    this.escapados.add(msg.id);
    if (msg.id !== meuId) return false;
    this.euEscapei = true;
    this.escapeiAgora = true;
    return true;
  }

  /** `NS2C.FIM_EXPLODIU`. */
  aplicarExplosao(msg) {
    this.fase = FASE.EXPLODINDO;
    this.restante = NAMEK.fim.explosao.duracao;
    this.explodiuAgora = true;
    for (const id of msg?.escapados ?? []) this.escapados.add(id);
  }

  /* --------------------------------------------------------------- quadro -- */

  /**
   * Um quadro do estado. **Só relógio e geometria** — nada acumula aqui.
   *
   * @param {number} dt
   * @param {{x:number,y:number,z:number}} pos onde eu estou
   */
  passo(dt, pos) {
    if (this.restante > 0) this.restante = Math.max(0, this.restante - dt);

    this.altitude = pos.y;

    const dx = this.portal.x - pos.x;
    const dy = this.portal.y - pos.y;
    const dz = this.portal.z - pos.z;
    /* A distância à BOCA e não à altitude: o pedido fala do "lugar para onde
       eles têm que voar", e um número que só medisse altura mandaria subir a
       oitocentos metros do portal e depois descobrir que ainda falta atravessar
       a arena. A boca tem raio (`fuga.raio`) — descontá-lo é o que faz o
       contador chegar a zero exatamente quando se entra nela. */
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - NAMEK.fim.fuga.raio;
    this.metros = d > 0 ? d : 0;
  }

  /**
   * **O REGIME DE VOO**, escrito no controlador.
   *
   * É a peça que responde ao pedido *"o limite de altura de voo do céu deve ser
   * maior para eles conseguirem chegar no espaço sem morrer"*, e ela não toca em
   * `NAMEK.world.ceiling`: a constante continua sendo o teto do jogo normal, e o
   * que muda é o valor que `movement.js` lê. Ver o comentário de
   * `FighterController.regime`, que é a outra metade desta explicação.
   *
   * Uma vez por quadro, sem alocar: os três campos são reescritos no objeto que
   * já existe.
   */
  aplicarRegime(controller) {
    const R = controller?.regime;
    if (!R) return;
    const F = NAMEK.fim;

    if (this.euNoEspaco) {
      /* Sem chão, sem gravidade, sem teto — e uma bolha esférica no lugar do
         `flyRadius` do planeta. A lista inteira do que isso desliga está em
         `movement.js`, num `if` só. */
      R.espaco = this._bolha;
      R.teto = F.espaco.altura + F.espaco.raio;
      R.freioSolta = Infinity;
      R.freioMorre = Infinity;
      return;
    }

    R.espaco = null;
    if (this.fugaAberta || this.fase === FASE.EXPLODINDO) {
      R.teto = F.fuga.teto;
      R.freioSolta = F.fuga.freioSolta;
      R.freioMorre = F.fuga.freioMorre;
      return;
    }

    R.teto = NAMEK.world.ceiling;
    R.freioSolta = Infinity;
    R.freioMorre = Infinity;
  }
}

/* ========================================================================== */
/* ============================== O DESENHO ================================= */
/* ========================================================================== */

/** Quantas fissuras abrem no chão durante a contagem. Uma instância só. */
const FISSURAS = 96;
/** m — o comprimento de uma fissura no auge. */
const FISSURA_LONGA = 46;
/** m — a largura dela. Fina: é uma rachadura, não uma vala. */
const FISSURA_LARGA = 2.6;
/** m — de onde as fissuras podem nascer, medido do centro da clareira. */
const FISSURA_ALCANCE = 620;

/** s — quanto a onda de choque leva para desbotar depois de passar. */
const ONDA_FADE = 2.2;

/** Cores. O portal é a única coisa FRIA num céu que está todo em brasa —
 *  é o que faz o olho achá-lo sem ninguém explicar o que ele é. */
const COR_PORTAL = 0x9ff6ff;
const COR_COLUNA = 0x5fd0ff;
const COR_FISSURA = 0xff6a1e;
const COR_ESTOURO = 0xfff2d0;

/** Semente fixa: as fissuras abrem no MESMO lugar em todas as telas, e isso é
 *  de graça — nenhum byte de rede, pelo mesmo truque das crateras estáticas. */
function semente(s) {
  let x = s >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

export class NamekFuga {
  /**
   * @param {import("../../shared/namek/field.js").NamekField} field
   * @param {import("../fx/index.js").NamekFx} [fx] para os detritos do estouro
   */
  constructor(field, fx = null) {
    this.field = field;
    this.fx = fx;

    this.fase = FASE.CALMO;
    /** 0..1 — o quanto do minuto final já correu. Alimenta as fissuras. */
    this.tensao = 0;
    /** s desde o instante da explosão; negativo antes dela. */
    this.tExplosao = -1;
    /** 0..1 — o quanto o planeta já desabou. Ver `_colapsar`. */
    this.colapso = 0;

    this.root = null;
    /** O grupo do PLANETA, para o afundamento. Não somos donos dele. */
    this.planeta = null;
    this._planetaY = 0;

    this._rnd = semente(NAMEK.world.seed ^ 0x0fee1dead);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._eixo = new THREE.Vector3(0, 1, 0);
    this._pos = new THREE.Vector3();
    this._esc = new THREE.Vector3(1, 1, 1);
    /** Onde cada fissura fica. Pré-calculado: 96 pontos, uma vez na vida. */
    this._fissuras = [];
  }

  /**
   * @param {THREE.Scene} scene onde pendurar — a CENA, e não o mundo. Ver o
   *   cabeçalho: o planeta some com uma linha, e a explosão dele não pode sumir
   *   junto.
   * @param {THREE.Object3D} planeta o grupo do mundo, para o afundamento
   */
  build(scene, planeta = null) {
    this.root = new THREE.Group();
    this.root.name = "namek:fim";
    this.root.visible = false;
    scene.add(this.root);
    this.planeta = planeta;
    this._planetaY = planeta ? planeta.position.y : 0;

    this._montarPortal();
    this._montarFissuras();
    this._montarEstouro();
    return this;
  }

  /* ----------------------------------------------------------- o portal ---- */

  /**
   * O RASGO DE LUZ — "um indicativo no céu para o lugar que eles têm que voar".
   *
   * Três peças, e cada uma responde a uma distância de leitura:
   *
   * • A COLUNA (um cilindro sem tampa, aditivo, visto por dentro e por fora) é o
   *   que se enxerga de qualquer ponto do mapa, inclusive rente ao chão do outro
   *   lado da serra. Ela é a resposta à pergunta "para onde eu vou?".
   * • O ANEL marca a BOCA, e é ele que diz onde a coluna termina: sem ele, subir
   *   pela coluna não teria um fim visível e o jogador não saberia quando parar.
   * • O NÚCLEO é o brilho de dentro do anel — a coisa que se atravessa.
   *
   * Aditivo e sem escrita de profundidade porque é luz, não matéria: um lutador
   * voando dentro da coluna tem de aparecer através dela, e uma parede opaca de
   * 440 m de diâmetro no meio da arena esconderia metade da briga.
   */
  _montarPortal() {
    const F = NAMEK.fim.fuga;
    this.portalGrupo = new THREE.Group();
    this.root.add(this.portalGrupo);

    /* A coluna vai do nível do mar até a boca: ela tem de nascer ABAIXO do
       relevo, senão quem estiver na clareira (a +3 m) veria a base flutuando. */
    const base = NAMEK.world.seaLevel - 20;
    const altura = F.altitude - base;
    const geoCol = new THREE.CylinderGeometry(F.raio * 0.62, F.raio * 0.34, altura, 28, 1, true);
    geoCol.translate(0, base + altura / 2, 0);
    this.colunaMat = new THREE.MeshBasicMaterial({
      color: COR_COLUNA,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.coluna = new THREE.Mesh(geoCol, this.colunaMat);
    this.coluna.frustumCulled = false;
    this.portalGrupo.add(this.coluna);

    /* O anel: um toro DEITADO, com o furo do tamanho da boca de verdade. Quem
       o atravessa escapa, e é por isso que o raio dele é `fuga.raio` e não um
       número escolhido no olho — a coisa que se vê e a coisa que conta são a
       mesma. */
    const geoAnel = new THREE.TorusGeometry(F.raio, F.raio * 0.09, 10, 40);
    geoAnel.rotateX(Math.PI / 2);
    this.anelMat = new THREE.MeshBasicMaterial({
      color: COR_PORTAL,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.anel = new THREE.Mesh(geoAnel, this.anelMat);
    this.anel.position.y = F.altitude;
    this.anel.frustumCulled = false;
    this.portalGrupo.add(this.anel);

    const geoNucleo = new THREE.SphereGeometry(F.raio * 0.72, 20, 12);
    this.nucleoMat = new THREE.MeshBasicMaterial({
      color: COR_PORTAL,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.nucleo = new THREE.Mesh(geoNucleo, this.nucleoMat);
    this.nucleo.position.y = F.altitude;
    this.nucleo.frustumCulled = false;
    this.portalGrupo.add(this.nucleo);
  }

  /* --------------------------------------------------------- as fissuras --- */

  /**
   * O planeta rachando enquanto o relógio corre.
   *
   * Elas não são enfeite: são o RELÓGIO escrito no chão. Um jogador que não
   * esteja olhando para o HUD tem de conseguir saber, pelo cenário, que o tempo
   * está acabando — e a leitura é imediata porque o que cresce é a quantidade de
   * luz laranja debaixo dos pés dele.
   *
   * Uma `InstancedMesh` de 96 lascas finas, uma chamada de desenho, todas
   * assentadas no relevo com `heightAt`. Elas nascem com escala zero e crescem
   * com a tensão — nenhuma alocação, nenhuma malha nova.
   */
  _montarFissuras() {
    const geo = new THREE.BoxGeometry(FISSURA_LARGA, 1.2, FISSURA_LONGA);
    this.fissuraMat = new THREE.MeshBasicMaterial({
      color: COR_FISSURA,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    this.fissuras = new THREE.InstancedMesh(geo, this.fissuraMat, FISSURAS);
    this.fissuras.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fissuras.frustumCulled = false;
    this.root.add(this.fissuras);

    const rnd = this._rnd;
    for (let i = 0; i < FISSURAS; i++) {
      /* `√` no raio pela razão de sempre: sem ele todas se acumulam no centro,
         porque a área de um anel cresce com o raio. */
      const ang = rnd() * Math.PI * 2;
      const r = FISSURA_ALCANCE * Math.sqrt(rnd());
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      this._fissuras.push({
        x,
        z,
        y: this.field.heightAt(x, z),
        giro: rnd() * Math.PI,
        /* Quando ela abre, em fração da contagem. Espalhado para o chão rachar
           aos poucos em vez de estalar inteiro no mesmo segundo. */
        em: 0.12 + rnd() * 0.74,
        comp: 0.6 + rnd() * 1.5,
      });
    }
    this._escreverFissuras(0);
  }

  /* ---------------------------------------------------------- o estouro ---- */

  /**
   * O clarão e a onda de choque.
   *
   * A onda é um ANEL horizontal e não uma esfera, e a escolha é de leitura: uma
   * casca esférica crescendo a 900 m/s some da vista em meio segundo (ela passa
   * por dentro da câmera), enquanto um anel rasante fica visível varrendo o
   * relevo — que é a imagem que a referência tem, e a única que diz *para onde*
   * a explosão está indo.
   */
  _montarEstouro() {
    this.claraoMat = new THREE.MeshBasicMaterial({
      color: COR_ESTOURO,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    });
    this.clarao = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.claraoMat);
    this.clarao.visible = false;
    this.clarao.frustumCulled = false;
    this.clarao.renderOrder = 900;
    this.root.add(this.clarao);

    const geoOnda = new THREE.RingGeometry(0.86, 1, 72, 1);
    geoOnda.rotateX(-Math.PI / 2);
    this.ondaMat = new THREE.MeshBasicMaterial({
      color: COR_ESTOURO,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.onda = new THREE.Mesh(geoOnda, this.ondaMat);
    this.onda.visible = false;
    this.onda.frustumCulled = false;
    this.root.add(this.onda);
  }

  /* ------------------------------------------------------------- o quadro -- */

  /**
   * A fase mudou. Chamado por `NamekWorld.setFim`.
   *
   * @param {string} fase
   * @param {number} restante s que faltam no relógio da fase
   */
  setFase(fase, restante = 0) {
    if (fase === this.fase) return;
    const antes = this.fase;
    this.fase = fase;

    if (fase === FASE.EXPLODINDO && antes !== FASE.EXPLODINDO) {
      this.tExplosao = 0;
      this.clarao.visible = true;
      this.onda.visible = true;
    }
    if (fase === FASE.CALMO || fase === FASE.FREEZA) {
      /* O céu abriu de novo: o planeta volta inteiro, e com ele o chão sem
         rachadura e sem afundamento. Os três eixos, e não só o `y` — o tremor
         mexe nos outros dois, e devolver metade da posição deixaria a ilha
         inteira uns metros fora do lugar pelo resto da sessão. */
      this.tExplosao = -1;
      this.colapso = 0;
      this.tensao = 0;
      this.clarao.visible = false;
      this.onda.visible = false;
      this._escreverFissuras(0);
      if (this.planeta) this.planeta.position.set(0, this._planetaY, 0);
    }
    this.root.visible = fase !== FASE.CALMO;
    this.portalGrupo.visible = fase === FASE.CONTAGEM || fase === FASE.EXPLODINDO;
    /* AS FISSURAS SÃO DO CHÃO, e sem chão elas não existem. Sem esta linha,
       noventa e seis lascas de luz laranja continuariam boiando na cota do
       antigo relevo, dois quilômetros abaixo de quem escapou — o único pedaço
       do planeta que teria sobrevivido à explosão, e justamente porque ele mora
       fora do grupo que a explosão apaga. */
    this.fissuras.visible = fase === FASE.CONTAGEM || fase === FASE.EXPLODINDO;
    void restante;
  }

  /**
   * @param {number} dt
   * @param {number} tensao 0..1 — o quanto do minuto final já correu
   * @param {number} tempoSala relógio da sala em ms, para o pulso do portal
   *   bater igual em todas as telas
   */
  update(dt, tensao, tempoSala = 0) {
    if (!this.root?.visible) return;
    this.tensao = tensao;

    const t = tempoSala > 0 ? (tempoSala / 1000) % 3600 : 0;

    if (this.portalGrupo.visible) {
      /* O portal PULSA, e o pulso acelera com a tensão: a mesma informação do
         relógio, dita por um canal que não exige leitura. A rotação lenta do
         anel é o que impede a coluna de parecer um decalque. */
      const ritmo = 1.6 + tensao * 3.4;
      const pulso = 0.5 + 0.5 * Math.sin(t * ritmo);
      this.colunaMat.opacity = 0.1 + 0.14 * pulso + tensao * 0.1;
      this.anelMat.opacity = 0.6 + 0.4 * pulso;
      this.nucleoMat.opacity = 0.07 + 0.1 * pulso;
      this.anel.rotation.y += dt * 0.35;
      const respira = 1 + 0.05 * Math.sin(t * ritmo * 0.7);
      this.nucleo.scale.setScalar(respira);
    }

    this._escreverFissuras(tensao);

    if (this.tExplosao >= 0) this._explodir(dt);
  }

  /**
   * As fissuras acompanham a tensão.
   *
   * Escrever 96 matrizes por quadro seria caro para nada — o que muda entre um
   * quadro e o seguinte é a terceira casa da escala. A escrita só acontece
   * quando a tensão andou o bastante para o olho ver, que numa contagem de 60 s
   * dá umas cinquenta atualizações no total.
   */
  _escreverFissuras(tensao) {
    if (this._tensaoEscrita !== undefined && Math.abs(tensao - this._tensaoEscrita) < 0.008) {
      return;
    }
    this._tensaoEscrita = tensao;

    for (let i = 0; i < FISSURAS; i++) {
      const f = this._fissuras[i];
      /* Cada uma tem a própria hora de abrir, e abre em 12 % da contagem. O
         `clamp` no fim de tudo é o que faz o chão parar de rachar quando o
         relógio para — e ele para quando o clima volta para `dia`. */
      const k = clamp((tensao - f.em) / 0.12, 0, 1);
      const cresce = k * k * (3 - 2 * k); // suave nas duas pontas
      this._pos.set(f.x, f.y + 0.4, f.z);
      this._q.setFromAxisAngle(this._eixo, f.giro);
      this._esc.set(cresce * (0.7 + tensao * 0.8), cresce, cresce * f.comp);
      this._m.compose(this._pos, this._q, this._esc);
      this.fissuras.setMatrixAt(i, this._m);
    }
    this.fissuras.instanceMatrix.needsUpdate = true;
    this.fissuraMat.opacity = 0.55 + 0.45 * tensao;
  }

  /**
   * O PLANETA MORRENDO — os seis segundos do espetáculo.
   *
   * Três coisas ao mesmo tempo, e elas são três porque o olho não lê uma
   * explosão como um evento só: há o CLARÃO (instantâneo, ofusca), a ONDA
   * (viaja, mostra a escala) e o COLAPSO (lento, é o que dá o luto).
   */
  _explodir(dt) {
    const E = NAMEK.fim.explosao;
    this.tExplosao += dt;
    const t = this.tExplosao;

    /* O clarão: uma casca enorme vista POR DENTRO, que cresce até engolir a
       câmera e desbota. Vista por dentro (`BackSide`) porque uma esfera aditiva
       vista de fora vira uma bola no meio da arena — e o que se quer é a tela
       inteira lavando de branco. */
    const raioClarao = 40 + t * 620;
    this.clarao.scale.setScalar(raioClarao);
    this.clarao.position.set(0, 60, 0);
    this.claraoMat.opacity = clamp(1 - t / 2.4, 0, 1) * 0.9;
    this.clarao.visible = this.claraoMat.opacity > 0.002;

    /* A onda de choque, rasante. Ela vive até `alcance` e depois some. */
    const raioOnda = t * E.onda;
    if (raioOnda < E.alcance) {
      this.onda.visible = true;
      this.onda.scale.set(raioOnda, 1, raioOnda);
      this.onda.position.set(0, 30 + t * 26, 0);
      this.ondaMat.opacity = clamp(1 - raioOnda / E.alcance, 0, 1) * 0.75;
    } else if (this.onda.visible) {
      this.ondaMat.opacity = Math.max(0, this.ondaMat.opacity - dt / ONDA_FADE);
      if (this.ondaMat.opacity <= 0.002) this.onda.visible = false;
    }

    this._colapsar(dt, t);
  }

  /**
   * O TERRENO SE DESFAZENDO.
   *
   * Não há malha nova e não há física: o que existe é o grupo inteiro do planeta
   * TREMENDO e AFUNDANDO, com detritos saindo do chão nos primeiros segundos. É
   * o efeito mais barato possível para a leitura mais cara do modo, e ele é
   * honesto — o planeta está indo embora, e a última coisa que se vê dele é ele
   * caindo para longe dos pés de quem escapou.
   *
   * Quem apaga o planeta de vez é a fase `espaco` (`root.visible = false`, em
   * `NamekWorld.setFim`): este afundamento é a rampa até lá, e a duração dele é
   * exatamente a da fase (`explosao.duracao`), para as duas coisas se
   * encontrarem sem um corte.
   */
  _colapsar(dt, t) {
    const E = NAMEK.fim.explosao;
    this.colapso = clamp(t / E.duracao, 0, 1);
    if (this.planeta) {
      /* O tremor morre com o tempo; o afundamento acelera. Juntos eles dão a
         leitura de uma coisa que primeiro racha e depois desiste. */
      const tremor = Math.max(0, 1 - t / 2.6) * 6;
      const queda = this.colapso * this.colapso * 260;
      this.planeta.position.y =
        this._planetaY - queda + Math.sin(t * 41) * tremor * 0.5;
      this.planeta.position.x = Math.sin(t * 53) * tremor;
      this.planeta.position.z = Math.cos(t * 47) * tremor;
    }

    /* Os detritos, pelo pool que já existe. Só nos dois primeiros segundos: é
       quando o chão está se abrindo, e depois disso o planeta já está longe. */
    if (!this.fx || t > 2.2) return;
    this._detrito = (this._detrito ?? 0) + dt;
    if (this._detrito < 0.06) return;
    this._detrito = 0;
    const rnd = this._rnd;
    const ang = rnd() * Math.PI * 2;
    const r = FISSURA_ALCANCE * Math.sqrt(rnd());
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    this.fx.fagulhas?.(x, this.field.heightAt(x, z) + 4, z, 3.4, COR_FISSURA, 26, 62);
  }

  /* ------------------------------------------------------------- desmonta -- */

  dispose() {
    if (this.planeta) {
      this.planeta.position.set(0, this._planetaY, 0);
      this.planeta = null;
    }
    /* Nada daqui está dentro de `NamekWorld.root`, então a varredura de lá não
       nos alcança — ver o cabeçalho. Cada geometria e cada material sai à mão. */
    for (const m of [this.coluna, this.anel, this.nucleo, this.fissuras, this.clarao, this.onda]) {
      m?.geometry?.dispose();
      if (m?.isInstancedMesh) m.dispose();
    }
    for (const mat of [
      this.colunaMat,
      this.anelMat,
      this.nucleoMat,
      this.fissuraMat,
      this.claraoMat,
      this.ondaMat,
    ]) {
      mat?.dispose();
    }
    this.root?.parent?.remove(this.root);
    this.root?.clear();
    this.root = null;
    this._fissuras.length = 0;
  }
}
