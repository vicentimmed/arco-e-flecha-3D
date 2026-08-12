/* ---------------------------------------------------------------------------
   O trabuco de muralha, e a pedra em chamas que ele cospe.

   É o que faz o cerco não ser "modo zumbi com muro". Ver §5 de
   `docs/plano-cerco.md`.

   ------------------------------------------------------- a decisão que manda

   **O ângulo de solta é FIXO em 45°.** O arco é mira livre; o trabuco não pode
   ser, senão ele é um arco que causa mais dano e o arco morre. Um trabuco de
   verdade tem ângulo de solta fixo e alcance dado pelo contrapeso, e essa
   restrição é justamente a que interessa:

     • azimute — o jogador gira a armação, dentro de ±40°;
     • alcance — a tensão do contrapeso, segurada como se segura o arco.

   Mirar no trabuco é escolher ONDE, no chão; mirar no arco é escolher PARA
   ONDE, no ar. São duas habilidades diferentes, e é por isso que as duas armas
   convivem em vez de uma substituir a outra.

   E a consequência que fecha o desenho: com 45° fixos o alcance mínimo é
   v²/g = 33 m. **O trabuco não alcança o pé do próprio muro.** Ele é a arma da
   aproximação, o arco é a arma do portão.

   ------------------------------------------------------------------- a pedra

   Corpo rígido de verdade, pelas mesmas regras da flecha e com a mesma conta de
   arrasto — 25 kg, raio de 0,14 m (calcário), Cd de esfera. A 33 m/s isso dá
   0,77 m/s² de desaceleração, 8 % de g: parábola quase limpa, vento que entorta
   pouco mas entorta. Nada disso é código novo; é a mesma integração que
   `entities/arrow.js` já roda, com outra área e outra massa.

   Quem atira é a AUTORIDADE sobre a própria pedra, como na flecha: ele simula,
   ele reporta o impacto, e a sala decide quem morreu no estouro (porque isso é
   placar). Custo de rede por quadro: zero. Ver `S2C.TREB_SHOT`.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { ARROW_COLLISION_GROUPS } from "../core/collisionGroups.js";
import { shared } from "../levels/resources.js";

/* Materiais de MÓDULO: os três engenhos os dividem, e eles precisam sobreviver
   à troca de fase. Ver `levels/resources.js`. */
const MAT = {
  viga: shared(new THREE.MeshStandardMaterial({ color: "#5a4230", roughness: 0.92 })),
  vigaEscura: shared(new THREE.MeshStandardMaterial({ color: "#3d2c1f", roughness: 0.95 })),
  ferro: shared(new THREE.MeshStandardMaterial({ color: "#2b2b2e", roughness: 0.5, metalness: 0.7 })),
  contrapeso: shared(new THREE.MeshStandardMaterial({ color: "#3a3a40", roughness: 0.85, metalness: 0.2 })),
  corda: shared(new THREE.MeshStandardMaterial({ color: "#b39a6a", roughness: 1 })),
  couro: shared(new THREE.MeshStandardMaterial({ color: "#6b4a2c", roughness: 0.95 })),
  /** A pedra APAGADA, a que está no berço. O fogo é do voo. */
  calcario: shared(new THREE.MeshStandardMaterial({ color: "#9a948a", roughness: 0.95 })),
  /* A pedra acesa é BASIC: ela precisa continuar visível contra o preto do céu
     e contra o chão escuro, e um material iluminado apagaria no meio do voo —
     que é exatamente quando o jogador está lendo para onde ela vai. */
  pedra: shared(new THREE.MeshBasicMaterial({ color: 0xffb060 })),
  brasa: shared(new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.55 })),
};

/* ------------------------------------------------------------- as medidas --

   A ARMAÇÃO ESTAVA DE CABEÇA PARA BAIXO, e não era um detalhe de aparência.

   No braço antigo, ARMADO significava contrapeso EMBAIXO e funda no alto; ao
   soltar, o contrapeso SUBIA. É o inverso de como a máquina funciona e, pior,
   é o inverso do que ela precisa comunicar: um trabuco carregado se reconhece
   de longe pelo peso pendurado LÁ EM CIMA — é ele que diz "esta tem energia
   guardada", e é a queda dele que a gasta. Com o sinal trocado, os três
   engenhos do muro mentiam sobre o próprio estado a quem olhava de vinte
   metros, que é a única distância de que se olha para eles.

   Referencial local (o `corpo`, já girado pelo azimute): o tiro sai para +Z, o
   deque está em y = 0. O braço LONGO fica em −Z e o contrapeso em +Z — ou seja,
   armado o braço longo desce por trás e o peso sobe pela frente, e a solta
   varre de trás para a frente por cima do eixo. É o movimento de um trabuco de
   contrapeso, e agora é o que se vê.

   Os ângulos abaixo estão todos no mesmo referencial: rotação em X do grupo do
   braço, com a ponta longa em (0, L·sen θ, −L·cos θ). */
const G = {
  /** Altura do eixo acima do deque. */
  axleY: 2.15,
  /** Braço longo (o da funda) e braço curto (o do contrapeso). Razão ~2:1. */
  armLong: 2.05,
  armShort: 1.0,
  /** Quanto o contrapeso pende abaixo da ponta do braço curto, até o centro. */
  pesoDrop: 0.3,
  /** Comprimento da funda, da ponta do braço ao centro da bolsa. */
  fundaDrop: 0.46,
  /** Meia-bitola da armação: os dois cavaletes ficam em x = ±este valor. */
  frameX: 0.78,
  /** Afastamento do pé de cada perna, em z. */
  footZ: 1.2,
  /** Onde a bolsa da funda para de descer: o fundo da calha. */
  calhaY: 0.22,
};

/** Os quatro ângulos do braço, em radianos. Ver o bloco acima. */
const ANG = {
  /** Armado: ponta longa quase no deque, atrás; contrapeso no alto, à frente. */
  armado: -0.95,
  /** A solta, a 45° acima da horizontal — é o `launchAngle` visto de perfil. */
  solta: Math.PI * 0.75,
  /** O repique: o braço passa da solta e bate no batente. */
  pico: 2.62,
  /** Descarregado e parado: contrapeso no fundo, braço quase a prumo. */
  solto: Math.PI / 2 + 0.05,
};

/**
 * Onde a pedra deixa a funda, DERIVADO da armação e não escrito à mão.
 *
 * O número antigo (2,6 m) era um chute que não batia com malha nenhuma, e ele
 * entrava na integração do voo — ou seja, a marca no chão prometia um lançamento
 * que a máquina na tela não fazia. Agora sai da mesma trigonometria que desenha
 * o braço: se o braço mudar de tamanho, a marca acompanha sozinha.
 */
export const MUZZLE = {
  y: G.axleY + G.armLong * Math.SQRT1_2,
  z: G.armLong * Math.SQRT1_2,
};

/* --------------------------------------------------- o lote de geometrias --

   Mesma economia de `entities/castle.js`: as peças que não se mexem umas em
   relação às outras viram UMA malha por material. A armação são 26 caixas e
   sai em 2 chamadas; o braço são 7 e sai em 2. Três engenhos no muro custam 30
   chamadas — o mesmo que a versão de tubos custava, com quatro vezes mais peça
   na tela. */
class Lote {
  constructor() {
    this.por = new Map();
  }

  /** Uma caixa, com giro opcional em X e Z. `h*` são MEIAS-arestas. */
  box(mat, hx, hy, hz, x, y, z, rx = 0, rz = 0) {
    this.push(mat, new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), x, y, z, rx, rz);
  }

  /** Um cilindro. Deitado no eixo X com `rz = Math.PI / 2`. */
  cyl(mat, r, alt, x, y, z, rx = 0, rz = 0, lados = 8) {
    this.push(mat, new THREE.CylinderGeometry(r, r, alt, lados), x, y, z, rx, rz);
  }

  push(mat, geo, x, y, z, rx, rz) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
      new THREE.Vector3(1, 1, 1),
    );
    geo.applyMatrix4(m);
    let lista = this.por.get(mat);
    if (!lista) this.por.set(mat, (lista = []));
    lista.push(geo);
  }

  /**
   * Funde e pendura. `sombra` é uma LISTA de materiais que lançam sombra — e
   * não um booleano — porque o critério é o tamanho da peça: a armação e o
   * braço projetam silhueta legível no adarve, as ferragens e as cordas
   * projetam menos que um texel do mapa de sombra e pagariam um segundo
   * desenho por quadro para nada.
   */
  flush(parent, sombra = []) {
    for (const [mat, lista] of this.por) {
      const geo = lista.length === 1 ? lista[0] : mergeGeometries(lista, false);
      if (!geo) continue;
      if (lista.length > 1) for (const g of lista) g.dispose();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = sombra.includes(mat);
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.por.clear();
  }
}

/* ---------------------------------------------------------------- o engenho */

/** Rascunhos da corda do sarilho: `atualizarSarilho` roda três vezes por quadro. */
const _de = new THREE.Vector3();
const _para = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cima = new THREE.Vector3(0, 1, 0);

/** Aceleração e desaceleração suaves (smoothstep). */
function suave(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

export class Trebuchet {
  /**
   * @param {THREE.Object3D} parent raiz da fase
   * @param {{id:number,x:number,y:number,z:number}} posto de `castleProps`
   */
  constructor(parent, posto) {
    this.id = posto.id;
    this.base = new THREE.Vector3(posto.x, posto.y, posto.z);
    /** Azimute da armação, relativo ao "para fora" do muro (+Z). */
    this.yaw = 0;
    /** 0 a 1: quanto o contrapeso está tensionado. */
    this.charge = 0;
    /** Carregado? A sala é dona desta resposta — ver `Room.trebuchets`. */
    this.ready = true;
    /** Fração do içamento (0 a 1) quando descarregado. */
    this.reload = 1;
    /** Animação do braço: 0 armado, 1 solto. */
    this.swing = 0;

    this.group = new THREE.Group();
    this.group.position.copy(this.base);
    this.group.name = `trabuco-${posto.id}`;
    parent.add(this.group);
    this.build();
  }

  build() {
    const T = CONFIG.modes.siege.trebuchet;
    const corpo = new THREE.Group();

    this.buildArmacao(corpo);
    this.buildBraco(corpo, T);
    this.buildSarilho(corpo);

    this.group.add(corpo);
    this.corpo = corpo;
    this.colherFinos();
  }

  /**
   * A ARMAÇÃO: soleiras, dois cavaletes em A, o eixo e a calha da funda.
   *
   * Os cavaletes são DOIS TRIÂNGULOS SEPARADOS, ligados só pelo eixo e pelas
   * soleiras — e isso não é estilo, é a única topologia possível: o braço varre
   * o plano x = 0 inteiro, então qualquer travessa que atravesse de um cavalete
   * ao outro acima do deque seria varada por ele. A conta que libera as
   * travessas baixas é a do círculo do braço: com 2,2 m de raio em torno de um
   * eixo a 2,05 m, na altura do deque ele só alcança |z| < 1,10.
   */
  buildArmacao(corpo) {
    const lote = new Lote();

    /* Soleiras: as duas vigas de base, longas o bastante para chegar ao
       sarilho, e as travessas de amarração. O braço nunca desce abaixo de
       y = 0,10 (o raio dele é menor que a altura do eixo), então as travessas
       rentes ao deque estão livres por construção, em qualquer z. */
    for (const s of [-1, 1]) {
      lote.box(MAT.viga, 0.13, 0.09, 2.25, s * G.frameX, 0.09, -0.15);
    }
    for (const d of [-1, 1]) {
      lote.box(MAT.vigaEscura, G.frameX + 0.13, 0.075, 0.12, 0, 0.075, d * 1.42);
    }

    /* As quatro pernas. O ângulo sai do pé (z = ±1,2) até o eixo, e o SINAL do
       giro é negativo do lado de +Z porque é o topo que anda para −Z. */
    const rise = G.axleY - 0.18;
    const ang = Math.atan2(G.footZ, rise);
    const comp = Math.hypot(G.footZ, rise);
    for (const s of [-1, 1]) {
      for (const d of [-1, 1]) {
        lote.box(
          MAT.viga, 0.085, comp / 2, 0.085,
          s * G.frameX, 0.18 + rise / 2, (d * G.footZ) / 2, -d * ang,
        );
      }
      // Tirante horizontal no meio de cada A: é o que faz o cavalete ler como
      // treliça em vez de dois palitos. Fica em x = ±frameX, fora do varrimento.
      lote.box(MAT.vigaEscura, 0.07, 0.07, 0.62, s * G.frameX, 1.02, 0);
      // Sapata de ferro no pé de cada perna.
      for (const d of [-1, 1]) {
        lote.box(MAT.ferro, 0.11, 0.06, 0.14, s * G.frameX, 0.2, d * G.footZ * 0.93);
      }
    }

    /* O EIXO, deitado em X, com dois mancais. É a peça que diz onde o braço
       gira, e sem ela o braço parece flutuar. */
    lote.cyl(MAT.ferro, 0.075, G.frameX * 2 + 0.34, 0, G.axleY, 0, 0, Math.PI / 2, 8);
    for (const s of [-1, 1]) {
      lote.cyl(MAT.ferro, 0.14, 0.16, s * G.frameX, G.axleY, 0, 0, Math.PI / 2, 8);
    }

    /* A CALHA em que a pedra descansa com o braço armado. Duas guias baixas
       atrás do engenho: elas explicam onde a pedra fica antes do tiro, e são o
       detalhe que faz a máquina parecer CARREGADA em vez de vazia. O `calhaY`
       delas é o mesmo número que impede a funda de furar o deque — ver
       `update`. */
    for (const s of [-1, 1]) {
      lote.box(MAT.vigaEscura, 0.055, 0.1, 0.66, s * 0.33, 0.1, -1.6);
    }
    lote.box(MAT.vigaEscura, 0.33, 0.045, 0.66, 0, 0.055, -1.6);

    // Os cavaletes do sarilho entram NESTE lote: são parte da armação parada, e
    // um lote próprio para eles custaria uma chamada de desenho por engenho.
    for (const s of [-1, 1]) {
      lote.box(MAT.viga, 0.07, 0.28, 0.07, s * 0.5, 0.28, -1.95);
    }

    lote.flush(corpo, [MAT.viga]);
  }

  /**
   * O BRAÇO, o contrapeso pendurado e a funda.
   *
   * Três grupos aninhados, e os dois de dentro CONTRA-GIRAM: um contrapeso de
   * caixote e uma funda de corda pendem do próprio peso, não acompanham a
   * inclinação da viga. É o que separa um trabuco de uma gangorra com uma pedra
   * pregada na ponta — e custa duas atribuições de rotação por quadro.
   */
  buildBraco(corpo, T) {
    this.arm = new THREE.Group();
    this.arm.position.y = G.axleY;
    corpo.add(this.arm);

    const lote = new Lote();
    // A viga AFINA para a ponta da funda: três seções em vez de uma, porque é
    // a seção grossa junto ao eixo que aguenta o momento do contrapeso.
    lote.box(MAT.vigaEscura, 0.09, 0.095, 0.6, 0, 0, -0.6);
    lote.box(MAT.vigaEscura, 0.078, 0.082, 0.5, 0, 0, -1.18);
    lote.box(MAT.vigaEscura, 0.062, 0.066, 0.42, 0, 0, -1.66);
    // O braço curto, mais robusto: ele carrega o peso inteiro.
    lote.box(MAT.vigaEscura, 0.105, 0.11, G.armShort / 2, 0, 0, G.armShort / 2);
    // Cubo e cintas de ferro junto ao eixo, e o gancho da funda na ponta.
    lote.cyl(MAT.ferro, 0.115, 0.32, 0, 0, 0, 0, Math.PI / 2, 8);
    for (const d of [-1, 1]) {
      lote.box(MAT.ferro, 0.1, 0.105, 0.04, 0, 0, d * 0.32);
    }
    lote.box(MAT.ferro, 0.07, 0.075, 0.06, 0, 0, -G.armLong + 0.04);
    lote.flush(this.arm, [MAT.vigaEscura]);

    /* O CONTRAPESO, pendurado na ponta do braço curto. Caixote com cintas — um
       bloco liso lê como pedra e não como "isto é pesado". */
    this.peso = new THREE.Group();
    this.peso.position.z = G.armShort;
    this.arm.add(this.peso);
    const lp = new Lote();
    lp.box(MAT.contrapeso, 0.32, 0.27, 0.26, 0, -G.pesoDrop, 0);
    for (const s of [-1, 1]) {
      lp.box(MAT.ferro, 0.033, 0.16, 0.033, s * 0.2, -0.14, 0); // as talas
      lp.box(MAT.ferro, 0.34, 0.028, 0.028, 0, -G.pesoDrop, s * 0.27); // as cintas
      lp.box(MAT.ferro, 0.028, 0.28, 0.028, s * 0.33, -G.pesoDrop, 0);
    }
    lp.flush(this.peso, [MAT.contrapeso]);

    /* A FUNDA: duas cordas e a bolsa de couro. Pendura na ponta longa e
       ARRASTA — ver o amortecimento em `update`. */
    this.funda = new THREE.Group();
    this.funda.position.z = -G.armLong;
    this.arm.add(this.funda);
    const lf = new Lote();
    for (const s of [-1, 1]) {
      lf.box(MAT.corda, 0.013, G.fundaDrop / 2, 0.013, s * 0.13, -G.fundaDrop / 2, 0, 0, s * 0.16);
    }
    lf.box(MAT.couro, 0.19, 0.02, 0.16, 0, -G.fundaDrop, 0);
    for (const s of [-1, 1]) {
      lf.box(MAT.couro, 0.02, 0.085, 0.16, s * 0.19, -G.fundaDrop + 0.07, 0, 0, s * 0.32);
    }
    lf.flush(this.funda);

    /* A PEDRA NO BERÇO É MENOR QUE A BOLA DE FOGO QUE VOA.
       `visualRadius` são 0,42 m porque a pedra em voo precisa ser lida a 90 m
       contra o céu — dentro de uma bolsa de 0,38 m ela era uma lua encostada na
       funda. Aqui ela é o calcário de verdade, e o fogo é do voo. */
    this.municao = new THREE.Mesh(
      new THREE.SphereGeometry(0.23, 9, 7),
      MAT.calcario,
    );
    this.municao.position.y = -G.fundaDrop + 0.19;
    this.municao.castShadow = true;
    this.funda.add(this.municao);
  }

  /**
   * O SARILHO — o torno que puxa o braço de volta, e a resposta a "quem está
   * recarregando?" a vinte metros.
   *
   * Ele vive atrás do engenho, com o tambor abaixo da linha que o braço varre
   * (a 1,95 m do eixo o braço passa a 1,03 m; o tambor termina a 0,67 m). A
   * corda só aparece depois que o braço para de balançar, porque é aí que a
   * guarnição a engata de verdade.
   */
  buildSarilho(corpo) {
    this.tambor = new THREE.Group();
    this.tambor.position.set(0, 0.52, -1.95);
    corpo.add(this.tambor);
    const lt = new Lote();
    lt.cyl(MAT.viga, 0.135, 0.86, 0, 0, 0, 0, Math.PI / 2, 8);
    /* As alavancas, em cruz nas duas cabeceiras. Elas são o MOSTRADOR: um
       tambor liso girando é indistinguível de um tambor parado, e a única
       coisa que diz "alguém está na manivela" a vinte metros são estes quatro
       raios passando. */
    for (const s of [-1, 1]) {
      for (const a of [0, Math.PI / 2]) {
        lt.box(MAT.vigaEscura, 0.026, 0.21, 0.026, s * 0.48, 0, 0, a);
      }
    }
    lt.flush(this.tambor);

    /* A CORDA do sarilho: uma caixa unitária reorientada por quadro. Uma malha,
       e só existe enquanto se iça. */
    this.corda = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1, 0.03), MAT.corda);
    this.corda.visible = false;
    corpo.add(this.corda);
  }

  /**
   * O DETALHE, ligado e desligado pela distância.
   *
   * São TRÊS engenhos no muro e no máximo um deles está ao alcance da mão: os
   * outros dois ficam nos bastiões, a dezoito metros do posto central e a
   * trinta e seis um do outro. A ferragem, a corda da funda e a bolsa de couro
   * medem entre dois e cinco centímetros — a essa distância elas não somam um
   * pixel, e cada uma custa uma chamada de desenho inteira.
   *
   * Esconder é gratuito no Three (o objeto sai antes do teste de frustum) e não
   * toca o que carrega a LEITURA do engenho: a viga, o contrapeso e o tambor
   * continuam desenhados sempre, porque é a posição deles que diz se aquele
   * trabuco tem tiro.
   */
  setDetalhe(ligado) {
    if (this._detalhe === ligado) return;
    this._detalhe = ligado;
    for (const m of this._finos) m.visible = ligado;
  }

  /** As malhas que o LOD desliga. Colhidas por MATERIAL, não por nome. */
  colherFinos() {
    this._finos = [];
    this._detalhe = true;
    this.group.traverse((o) => {
      if (o.isMesh && (o.material === MAT.ferro || o.material === MAT.corda ||
          o.material === MAT.couro)) {
        this._finos.push(o);
      }
    });
  }

  /** A velocidade de saída para a tensão atual. */
  get speed() {
    const T = CONFIG.modes.siege.trebuchet;
    return T.speedMin + (T.speedMax - T.speedMin) * this.charge;
  }

  /** Altura da solta acima do piso do adarve — a mesma que a mira integra. */
  get muzzleHeight() {
    return MUZZLE.y;
  }

  /** A direção de saída: 45° acima do plano, no azimute da armação. */
  direction(out = new THREE.Vector3()) {
    const T = CONFIG.modes.siege.trebuchet;
    const c = Math.cos(T.launchAngle);
    return out
      .set(Math.sin(this.yaw) * c, Math.sin(T.launchAngle), Math.cos(this.yaw) * c)
      .normalize();
  }

  /** De onde a pedra sai: a ponta da funda no instante da solta. */
  muzzle(out = new THREE.Vector3()) {
    return out.set(
      this.base.x + Math.sin(this.yaw) * MUZZLE.z,
      this.base.y + MUZZLE.y,
      this.base.z + Math.cos(this.yaw) * MUZZLE.z,
    );
  }

  aim(dYaw) {
    const T = CONFIG.modes.siege.trebuchet;
    this.yaw = Math.max(-T.yawRange, Math.min(T.yawRange, this.yaw + dYaw));
  }

  /**
   * Solta, com azimute e velocidade JÁ RESOLVIDOS pela mira.
   *
   * O jogador nunca escolhe "quanta força": ele escolhe um ponto no chão, e
   * `velocidadePara` diz que velocidade leva a pedra até lá. É a diferença
   * entre uma arma que se aprende e uma que se adivinha — ver `SiegeSystem
   * .entrarNaMira`.
   */
  fireAt(yaw, v) {
    if (!this.ready) return null;
    this.yaw = yaw;
    const o = this.muzzle();
    const d = this.direction();
    this.ready = false;
    this.swing = 0.0001;
    this.charge = 0;
    /* ZERAR O ÍÇAMENTO AQUI, e não esperar o `TREB_STATE` do servidor.
       Sem isto o `reload` continuava valendo 1 até o próximo pacote de estado,
       e a mistura de `update` mantinha o braço na posição ARMADA: quem atirava
       via a pedra sair e o engenho não se mexer. */
    this.reload = 0;
    return { o, d, v };
  }

  setReady(ready, reloadFrac = 1) {
    this.ready = ready;
    this.reload = reloadFrac;
    if (ready) this.swing = 0;
  }

  update(dt, carregando) {
    // Tensão: sobe segurando, e não desce sozinha — soltar é atirar.
    if (this.ready && carregando) {
      this.charge = Math.min(1, this.charge + dt / CONFIG.modes.siege.trebuchet.chargeTime);
    }
    this.corpo.rotation.y = this.yaw;

    /* O BRAÇO, e a leitura que ele carrega.
     *
     * Armado, o contrapeso está NO ALTO e a funda repousa na calha — é assim
     * que se vê, a vinte metros e sem HUD, que aquele engenho tem tiro. Ao
     * soltar, o peso cai e a viga varre de trás para a frente por cima do eixo,
     * passa da solta, bate no batente e volta balançando até parar com o peso
     * no fundo. Daí em diante quem manda no ângulo é o sarilho. */
    let alvo;
    if (!this.ready) {
      this.swing = Math.min(1, this.swing + dt * 2.4);
      const s = this.swing;
      /* A varredura leva um quarto do ciclo e o repique o resto — a proporção
         de um braço de verdade, que sobe rápido e volta pesado. */
      const varrer =
        s < 0.24
          ? ANG.armado + (ANG.pico - ANG.armado) * suave(s / 0.24)
          : ANG.pico + (ANG.solto - ANG.pico) * suave((s - 0.24) / 0.76);
      /* O ÍÇAMENTO puxa de volta, e os dois convivem: a manivela pode começar
         antes de o braço parar de balançar. */
      alvo = varrer + (ANG.armado - varrer) * this.reload;
      this.municao.visible = this.reload > 0.9;
    } else {
      this.swing = 0;
      alvo = ANG.armado - this.charge * 0.12;
      this.municao.visible = true;
    }
    this.arm.rotation.x += (alvo - this.arm.rotation.x) * Math.min(1, dt * 9);

    /* O contrapeso PENDE: contra-gira o ângulo do braço, e por isso continua a
       prumo esteja a viga onde estiver. Um caixote pregado na ponta seria uma
       gangorra, não um trabuco. */
    const a = this.arm.rotation.x;
    this.peso.rotation.x = -a;

    /* A FUNDA PENDE, MAS NÃO ATRAVESSA O DEQUE.
     *
     * Com o braço armado a ponta fica a meio metro do piso, e uma funda que
     * cai reta a partir dali enfia a bolsa e a pedra por baixo da tábua —
     * exatamente o que se via: um berço cortado ao meio pelo chão. A saída não
     * é encurtar a corda, é DEITÁ-LA: quando não cabe na vertical, ela se
     * inclina para trás e a pedra vai parar na calha, que é o lugar de onde
     * uma pedra de trabuco é lançada de verdade.
     *
     * O ângulo sai de um cosseno, não de uma tabela: `cos δ` é a fração do
     * comprimento da funda que ainda cabe entre a ponta e o fundo da calha. */
    const pontaY = G.axleY + G.armLong * Math.sin(a);
    const cabe = (pontaY - G.calhaY) / G.fundaDrop;
    const delta = cabe >= 1 ? 0 : Math.acos(Math.max(-1, cabe));
    /* Com ATRASO, porque uma corda arrasta — e é esse atraso que dá o estalo de
       chicote na solta, de graça. */
    this.funda.rotation.x += (delta - a - this.funda.rotation.x) * Math.min(1, dt * 11);

    this.atualizarSarilho(dt);
  }

  /**
   * O tambor gira e a corda o liga à ponta do braço.
   *
   * A corda é uma caixa unitária reorientada: `setFromUnitVectors` do +Y para a
   * direção, escala em Y para o comprimento. Uma malha e nenhuma alocação — os
   * dois vetores são rascunhos de módulo.
   */
  atualizarSarilho(dt) {
    if (this.ready) {
      this.corda.visible = false;
      return;
    }
    this.tambor.rotation.x -= dt * (2.2 + 5.4 * this.reload);
    /* Só depois que o braço para de balançar: antes disso a guarnição ainda
       não engatou nada, e uma corda esticada durante o repique denunciaria o
       truque. E nunca com o detalhe desligado — ver `setDetalhe`. */
    if (this.reload < 0.12 || this._detalhe === false) {
      this.corda.visible = false;
      return;
    }
    const a = this.arm.rotation.x;
    _de.set(0, this.tambor.position.y + 0.14, this.tambor.position.z);
    _para.set(0, G.axleY + G.armLong * Math.sin(a), -G.armLong * Math.cos(a));
    _dir.subVectors(_para, _de);
    const comp = _dir.length();
    if (comp < 0.05) {
      this.corda.visible = false;
      return;
    }
    _dir.divideScalar(comp);
    this.corda.visible = true;
    this.corda.position.addVectors(_de, _para).multiplyScalar(0.5);
    this.corda.quaternion.setFromUnitVectors(_cima, _dir);
    this.corda.scale.set(1, comp, 1);
  }

  dispose() {
    /* As geometrias são POR ENGENHO (cada `Lote` funde as suas), então elas
       precisam voltar para a GPU aqui. Os materiais não: são de módulo, e
       `shared()` os protege — ver `levels/resources.js`. */
    this.group?.traverse((o) => o.geometry?.dispose());
    this.group?.parent?.remove(this.group);
    this.group = null;
  }
}

/* ------------------------------------------------------- balística da pedra */

/**
 * Onde a pedra CAI, integrando o voo de verdade.
 *
 * Fórmula fechada não serve. `v²/g` é o alcance de um projétil sem ar; esta
 * pedra tem 25 kg, 0,14 m de raio e Cd de esfera, e a 33 m/s ela perde ~4 % do
 * alcance para o arrasto. Quatro por cento em 110 m são quatro metros e meio —
 * mais que o raio do estouro. A marca mentiria justamente na distância em que
 * ela é mais usada.
 *
 * Então integra-se, com o mesmo passo fixo e a mesma conta de `Stone.applyDrag`.
 * São ~300 passos; roda uma vez por quadro durante a mira e não aparece no
 * perfil.
 *
 * @returns {{d:number, pontos:number[][]}} alcance no plano e a curva amostrada
 */
export function voar(v0, alturaSaida, alvoY, amostras = 24) {
  const T = CONFIG.modes.siege.trebuchet;
  const g = Math.abs(CONFIG.physics.gravity);
  const area = Math.PI * T.radius * T.radius;
  const k = 0.5 * CONFIG.physics.airDensity * T.dragCoefficient * area;
  const h = 1 / 120;

  const c = Math.cos(T.launchAngle);
  let x = 0;
  let y = alturaSaida;
  let vx = v0 * c;
  let vy = v0 * Math.sin(T.launchAngle);

  const pontos = [[0, y]];
  let passos = 0;
  const guarda = 3000;
  while (y > alvoY && passos++ < guarda) {
    const sp = Math.hypot(vx, vy);
    const f = (k * sp) / T.mass;
    vx -= vx * f * h;
    vy -= (vy * f + g) * h;
    x += vx * h;
    y += vy * h;
    if (passos % Math.max(1, Math.floor(guarda / amostras / 6)) === 0) pontos.push([x, y]);
  }
  pontos.push([x, y]);
  return { d: x, pontos };
}

/**
 * A velocidade que faz a pedra cair a `d` metros — o inverso de `voar`.
 *
 * Busca binária, porque o alcance é monotônico na velocidade e vinte iterações
 * dão precisão de centímetro. Devolve `null` quando `d` está fora do que o
 * engenho alcança, e é esse `null` que impede a marca de ir para onde a pedra
 * não vai.
 */
export function velocidadePara(d, alturaSaida, alvoY) {
  const T = CONFIG.modes.siege.trebuchet;
  if (voar(T.speedMin, alturaSaida, alvoY).d > d) return null;
  if (voar(T.speedMax, alturaSaida, alvoY).d < d) return null;
  let lo = T.speedMin;
  let hi = T.speedMax;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    if (voar(m, alturaSaida, alvoY).d < d) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------------ a pedra */

export class Stone {
  /**
   * @param {THREE.Object3D} parent
   * @param {object} physics
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} direction unitário
   * @param {number} speed m/s
   * @param {boolean} own a pedra é MINHA (só a minha reporta impacto)
   */
  constructor(parent, physics, origin, direction, speed, own = true) {
    const T = CONFIG.modes.siege.trebuchet;
    this.physics = physics;
    this.own = own;
    this.dead = false;
    this.life = 0;
    this.impact = null;

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(T.visualRadius, 12, 10), MAT.pedra);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    /* O halo: uma casca maior e translúcida. Custa uma malha e é o que faz a
       pedra ler como TOCHA a 90 m, em vez de um ponto laranja. */
    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(T.visualRadius * 2.1, 10, 8),
      MAT.brasa,
    );
    this.mesh.add(this.halo);

    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(direction.x * speed, direction.y * speed, direction.z * speed)
        // A 33 m/s ela anda 28 cm por passo de física contra um raio de 14 cm:
        // sem detecção contínua, ela atravessaria o próprio merlão na saída.
        .setCcdEnabled(true)
        .setLinearDamping(0)
        .setAngularDamping(0.1),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.ball(T.radius)
        .setMass(T.mass)
        .setRestitution(0.02)
        .setFriction(0.9)
        /* O MESMO grupo da flecha: ela acerta tudo menos outras flechas. Sem
           isto a pedra ricochetearia na flecha de alguém no ar. */
        .setCollisionGroups(ARROW_COLLISION_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { kind: "stone", stone: this });

    this._v = new THREE.Vector3();
    this._f = { x: 0, y: 0, z: 0 };
  }

  /**
   * O arrasto, no passo fixo — a mesma fórmula da flecha.
   *
   * F = −½·ρ·Cd·A·|v_rel|·v_rel, com `v_rel = v − vento`. O vento nunca é uma
   * força separada: ele altera a velocidade relativa ao ar, e é por isso que o
   * efeito dele depende da velocidade e do tempo de voo.
   *
   * Sem estabilização aerodinâmica: uma esfera não tem centro de pressão atrás
   * do centro de massa, não se alinha e não precisa. É a diferença física entre
   * uma pedra e uma flecha, e ela aparece aqui como código que NÃO existe.
   */
  applyDrag(h, wind) {
    if (this.dead || !this.body) return;
    const T = CONFIG.modes.siege.trebuchet;
    const v = this.body.linvel();
    this.body.resetForces(false);

    const vx = v.x - (wind?.x ?? 0);
    const vy = v.y - (wind?.y ?? 0);
    const vz = v.z - (wind?.z ?? 0);
    const speed = Math.hypot(vx, vy, vz);
    if (speed < 1e-3) return;

    const area = Math.PI * T.radius * T.radius;
    const k = 0.5 * CONFIG.physics.airDensity * T.dragCoefficient * area * speed;
    this._f.x = -vx * k;
    this._f.y = -vy * k;
    this._f.z = -vz * k;
    this.body.addForce(this._f, true);
  }

  /** Bateu em alguma coisa. Guarda o ponto; quem consome é o gerente. */
  registerImpact(point) {
    if (this.impact) return;
    this.impact = { x: point.x, y: point.y, z: point.z };
    this.dead = true;
  }

  update(dt) {
    this.life += dt;
    if (this.body && !this.dead) {
      const t = this.body.translation();
      this.mesh.position.set(t.x, t.y, t.z);
      /* Rede de segurança: pedra que passou do chão sem contato (caiu fora do
         colisor do terreno, ou o contato se perdeu num quadro engasgado) ainda
         precisa estourar em algum lugar. Sem isto ela cairia para sempre e a
         recarga do engenho nunca começaria a valer para nada. */
      if (t.y < -20 || this.life > 12) this.registerImpact(t);
    }
    // A brasa pulsa. Uma escala, e é o que separa "uma bola laranja" de fogo.
    const s = 1 + Math.sin(this.life * 22) * 0.12;
    this.halo.scale.set(s, s, s);
  }

  dispose() {
    this.physics?.removeBody(this.body);
    this.mesh?.parent?.remove(this.mesh);
    this.mesh?.geometry?.dispose();
    this.halo?.geometry?.dispose();
    this.body = null;
    this.collider = null;
    this.mesh = null;
  }
}
