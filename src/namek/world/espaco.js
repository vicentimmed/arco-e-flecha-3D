/* ---------------------------------------------------------------------------
   O ESPAÇO — para onde vai quem consegue sair de Namekusei.

   *"Se eles voarem em direção ao céu… eles saem do planeta e entram no espaço.
   Do espaço eles podem observar o planeta Namekusei explodindo… Uma vez no
   espaço eles podem continuar lutando ali se quiserem."*

   Quem sai é quem alcança a boca do portal, a 2 400 m, antes de a contagem do
   planeta zerar — a fuga é altitude e nada mais. Ver `NAMEK.fim.fuga`.

   ------------------------------------------------------- não é uma segunda fase

   E essa é a decisão que manda no arquivo inteiro. O espaço fica nas MESMAS
   coordenadas do planeta, 2 900 m acima dele (`NAMEK.fim.espaco.altura`), e não
   num mundo à parte. Três coisas caem de graça dessa escolha:

   • **O planeta continua embaixo.** Quem escapou aos quarenta segundos passa os
     vinte restantes olhando a ilha lá embaixo, com as fissuras abrindo e o
     relógio correndo — e quando ela explode, o que ele vê explodir é o terreno
     de verdade, com a onda de choque de verdade saindo dele. Um planeta de
     mentira desenhado ao longe seria mais fácil e teria de ser sincronizado com
     o que os que ficaram estão vivendo.
   • **A rede não muda.** Posição é posição; ninguém precisa saber em que "mapa"
     alguém está para desenhá-lo. É a mesma pose de 20 Hz.
   • **A física não muda.** O que muda é o REGIME (ver `FighterController.regime`
     e `EstadoDoFim.aplicarRegime`): sem chão, sem gravidade, sem afogamento, sem
     lava, sem cratera, e o `flyRadius` cilíndrico do planeta virando uma bolha
     esférica. Nenhum desses desligamentos é um número mágico — todos são um `if`
     sobre `regime.espaco`.

   -------------------------------------------------------------- o que é daqui

   Este módulo é só o CÉU do espaço, e ele tem quatro peças:

     estrelas · a luz · a névoa (quase nenhuma) · os DESTROÇOS

   Os destroços são a única coisa que ele desenha de novo, e existem porque a
   fase `espaco` apaga o planeta com uma linha (`NamekWorld.root.visible =
   false`): sem eles, o lugar onde Namekusei estava ficaria vazio, e um planeta
   que some é muito menos do que um planeta que explodiu.

   Como `world/fuga.js`, **nada aqui entra em `NamekWorld.root`** — ele é o
   planeta, e o planeta é justamente o que sai de cena.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { clamp } from "../../utils/math.js";

/** Quantas estrelas. ~1 400 pontos em UMA chamada de desenho. */
const ESTRELAS = 1400;
/** m — o raio da esfera onde elas ficam. Dentro do `far` (3 600) com folga. */
const RAIO_ESTRELAS = 2400;

/** Quantos nacos de planeta ficam boiando depois da explosão. */
const DESTROCOS = 150;
/** m — o disco em que eles se espalham. Maior que a ilha: ela se abriu. */
const DESTROCO_ALCANCE = 1500;
/** s — quanto o miolo em brasa leva para apagar. Longo: é o luto. */
const BRASA_VIDA = 26;

const COR_BRASA = 0xff7a2a;
const COR_ROCHA = 0x2c3a3f;
const COR_FUNDO = 0x05070f;

/** Semente fixa: os destroços caem do mesmo jeito em todas as telas. */
function semente(s) {
  let x = s >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

export class NamekEspaco {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** O céu do espaço está no ar? Não é a mesma coisa que a fase da sala: quem
     *  escapa sozinho passa a ver estrelas enquanto os outros ainda têm dia. */
    this.ativo = false;
    /** s desde que o planeta explodiu; negativo antes. */
    this.tDestrocos = -1;

    this.root = null;
    /** O céu do PLANETA, que este esconde enquanto durar. Não somos donos. */
    this.ceu = null;

    this._nevoaAnterior = null;
    this._fundoAnterior = null;
    this._rnd = semente(NAMEK.world.seed ^ 0x5eed5face);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._esc = new THREE.Vector3();
    this._eixo = new THREE.Vector3();
    this._pedacos = [];
  }

  /**
   * @param {THREE.Scene} scene
   * @param {import("./sky.js").NamekSky} [ceu] o céu do planeta, para apagá-lo
   *   quando o jogador sair da atmosfera. Lido e nunca modificado além do
   *   `visible` da raiz dele — o §0 do plano vale entre módulos também: quem
   *   sabe pintar uma tempestade é `sky.js`, e quem sabe que não há tempestade
   *   no vácuo é este arquivo.
   */
  build(scene, ceu = null) {
    this.scene = scene;
    this.ceu = ceu;

    this.root = new THREE.Group();
    this.root.name = "namek:espaco";
    this.root.visible = false;
    scene.add(this.root);

    this._montarEstrelas();
    this._montarLuz();
    this._montarDestrocos();

    /* A névoa do vácuo: quase nenhuma, e ela existe por um motivo só — dar
       PROFUNDIDADE ao planeta lá embaixo. Sem nada, a ilha a dois quilômetros
       tem o mesmo contraste que o adversário a vinte metros, e o olho perde a
       escala inteira da cena. */
    this.nevoa = new THREE.FogExp2(COR_FUNDO, 0.00022);
    this.fundo = new THREE.Color(COR_FUNDO);
    return this;
  }

  /* ---------------------------------------------------------- as estrelas -- */

  /**
   * O céu estrelado: um `THREE.Points`, uma chamada de desenho.
   *
   * A receita é a mesma do céu da Lua (`buildStars`, em `core/renderer.js`) e
   * está copiada em vez de importada pela razão de sempre neste modo: aquele
   * arquivo é o renderizador do jogo do arqueiro, e o §0 do plano existe para
   * que nenhuma linha daqui dependa de lá. São vinte linhas de aritmética.
   *
   * Duas diferenças, e as duas são deste lugar:
   *
   * • **A esfera é INTEIRA**, e não só o hemisfério de cima. Lá as estrelas
   *   abaixo do horizonte seriam estrelas dentro da montanha; aqui não há
   *   horizonte, e um céu que acaba na altura dos pés seria a coisa mais falsa
   *   possível no vácuo.
   * • **`sizeAttenuation: false`**, igual: uma estrela tem o mesmo tamanho em
   *   pixels a qualquer distância, porque é isso que estrela faz.
   */
  _montarEstrelas() {
    const pos = new Float32Array(ESTRELAS * 3);
    const cor = new Float32Array(ESTRELAS * 3);
    const rnd = this._rnd;

    for (let i = 0; i < ESTRELAS; i++) {
      /* `z` uniforme em [−1, 1] e não latitude uniforme: com latitude as
         estrelas se acumulam nos polos e o zênite vira uma mancha branca. */
      const z = rnd() * 2 - 1;
      const ang = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos[i * 3] = Math.cos(ang) * r * RAIO_ESTRELAS;
      pos[i * 3 + 1] = z * RAIO_ESTRELAS;
      pos[i * 3 + 2] = Math.sin(ang) * r * RAIO_ESTRELAS;

      /* Um punhado puxa para o azul e para o âmbar; o resto é branco sujo. Um
         céu de pontos idênticos lê como ruído de sensor, não como estrelas. */
      const t = rnd();
      const brilho = 0.45 + rnd() * rnd() * 0.55;
      cor[i * 3] = brilho * (t > 0.88 ? 1 : 0.88);
      cor[i * 3 + 1] = brilho * 0.93;
      cor[i * 3 + 2] = brilho * (t < 0.24 ? 1 : 0.86);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(cor, 3));
    this.estrelaMat = new THREE.PointsMaterial({
      size: 1.9,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.estrelas = new THREE.Points(geo, this.estrelaMat);
    this.estrelas.frustumCulled = false;
    this.estrelas.renderOrder = -999;
    this.root.add(this.estrelas);
  }

  /* ---------------------------------------------------------------- a luz -- */

  /**
   * DUAS luzes, e nem uma a mais — o teto do §3 são três, e o céu do planeta
   * (que gasta as suas) está apagado enquanto estas valem.
   *
   * A direcional é o sol de Namekusei visto de fora da atmosfera: branco, duro,
   * sem dispersão nenhuma. A hemisférica é o preenchimento, e ela é o que impede
   * o lado escuro de um lutador de virar uma silhueta preta — no vácuo não há
   * céu para reacender nada, mas uma tela em que metade de cada corpo é um
   * buraco não é leitura, é falta de informação.
   */
  _montarLuz() {
    this.sol = new THREE.DirectionalLight(0xfff4e2, 0);
    this.sol.position.set(0.42, 0.78, 0.46).multiplyScalar(900);
    this.root.add(this.sol);

    this.hemi = new THREE.HemisphereLight(0x3a4b78, 0x0a0c14, 0);
    this.root.add(this.hemi);

    /** As intensidades de regime. Guardadas porque a entrada é um FADE. */
    this._solInt = 2.1;
    this._hemiInt = 0.55;
  }

  /* ---------------------------------------------------------- os destroços - */

  /**
   * O QUE SOBROU DO PLANETA.
   *
   * Uma `InstancedMesh` de icosaedros de baixa contagem — 150 nacos entre 24 e
   * 110 m — espalhados num disco achatado onde a ilha estava, girando devagar e
   * derivando para fora. Mais um miolo em brasa que apaga em vinte e seis
   * segundos.
   *
   * Eles só aparecem depois da explosão. Antes dela o "planeta ao longe" é o
   * planeta de verdade, ainda desenhado por `NamekWorld.root`, com as fissuras
   * abrindo — ver o cabeçalho.
   */
  _montarDestrocos() {
    /* Detalhe 0 é um icosaedro de 20 faces. 150 × 20 = 3 000 triângulos para o
       cadáver de um planeta inteiro, numa chamada só. */
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.destrocoMat = new THREE.MeshStandardMaterial({
      color: COR_ROCHA,
      roughness: 0.95,
      metalness: 0,
      /* Emissivo: os nacos ainda estão quentes, e o brilho por dentro é o que
         diz que aquilo não é um cinturão de asteroides qualquer — é uma coisa
         que acabou de queimar. Ele apaga junto com a brasa. */
      emissive: new THREE.Color(COR_BRASA),
      emissiveIntensity: 0,
      fog: true,
    });
    this.destrocos = new THREE.InstancedMesh(geo, this.destrocoMat, DESTROCOS);
    this.destrocos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.destrocos.frustumCulled = false;
    this.destrocos.visible = false;
    this.root.add(this.destrocos);

    const rnd = this._rnd;
    for (let i = 0; i < DESTROCOS; i++) {
      const ang = rnd() * Math.PI * 2;
      const r = DESTROCO_ALCANCE * Math.sqrt(rnd());
      this._pedacos.push({
        ang,
        r0: r * 0.35,
        /* Achatado em y: o que explodiu era um disco de terra, não uma bola, e
           uma nuvem esférica de pedra leria como outra coisa. */
        y0: (rnd() - 0.5) * 260,
        tam: 24 + rnd() * 86,
        deriva: 8 + rnd() * 26,
        subida: (rnd() - 0.5) * 12,
        giro: 0.05 + rnd() * 0.22,
        eixo: [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1],
        fase: rnd() * Math.PI * 2,
      });
    }

    this.brasaMat = new THREE.MeshBasicMaterial({
      color: COR_BRASA,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.brasa = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.brasaMat);
    this.brasa.visible = false;
    this.brasa.frustumCulled = false;
    this.root.add(this.brasa);
  }

  /* -------------------------------------------------------------- comandos - */

  /**
   * O jogador entrou (ou saiu) do espaço.
   *
   * **Não é a fase da sala.** Quem escapa aos quarenta segundos vê estrelas
   * enquanto catorze pessoas ainda estão brigando debaixo de um céu vermelho —
   * este é o único sistema do modo cujo estado é do OLHO e não da partida.
   */
  setAtivo(ligado) {
    if (ligado === this.ativo) return;
    this.ativo = ligado;
    this.root.visible = ligado;

    if (ligado) {
      /* O céu do planeta sai de cena INTEIRO — domo, nuvens e as duas luzes
         dele, que estão penduradas na mesma raiz. É por isso que este módulo
         traz luz própria: sem ela, atravessar o portal apagaria a cena. */
      if (this.ceu?.root) this.ceu.root.visible = false;
      this._nevoaAnterior = this.scene.fog;
      this._fundoAnterior = this.scene.background;
      this.scene.fog = this.nevoa;
      this.scene.background = this.fundo;
      return;
    }

    if (this.ceu?.root) this.ceu.root.visible = true;
    this.scene.fog = this._nevoaAnterior ?? null;
    this.scene.background = this._fundoAnterior ?? null;
    this._nevoaAnterior = null;
    this._fundoAnterior = null;
  }

  /** O planeta explodiu: a partir de agora há destroços onde ele estava. */
  planetaMorreu() {
    if (this.tDestrocos >= 0) return;
    this.tDestrocos = 0;
    this.destrocos.visible = true;
    this.brasa.visible = true;
  }

  /** O planeta voltou (o clima virou para `dia`): os destroços somem. */
  planetaVoltou() {
    this.tDestrocos = -1;
    this.destrocos.visible = false;
    this.brasa.visible = false;
  }

  /* --------------------------------------------------------------- quadro -- */

  /**
   * @param {number} dt
   * @param {THREE.Vector3} cameraPos as estrelas acompanham o olho, como o domo
   */
  update(dt, cameraPos) {
    if (!this.root) return;

    /* A ENTRADA É UM FADE, e de meio segundo: atravessar o portal e ver a luz da
       cena trocar num quadro leria como um corte de câmera, não como sair da
       atmosfera. O apagar é igual, para o caminho de volta ser o mesmo. */
    const alvo = this.ativo ? 1 : 0;
    const passo = dt / 0.5;
    const k = this._k ?? 0;
    this._k = k < alvo ? Math.min(alvo, k + passo) : Math.max(alvo, k - passo);
    if (!this.ativo && this._k <= 0) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    this.estrelaMat.opacity = this._k;
    this.sol.intensity = this._solInt * this._k;
    this.hemi.intensity = this._hemiInt * this._k;
    if (cameraPos) this.estrelas.position.copy(cameraPos);

    if (this.tDestrocos >= 0) this._derivar(dt);
  }

  /**
   * Os nacos derivando.
   *
   * Escritos por quadro e não em intervalos, ao contrário das fissuras de
   * `fuga.js`: aqui o que muda é a POSIÇÃO de cada um, e um destroço que
   * atualiza a cada dez quadros anda aos saltos. São 150 matrizes — o mesmo
   * custo de meia dúzia de lutadores, e só enquanto o espaço estiver na tela.
   */
  _derivar(dt) {
    this.tDestrocos += dt;
    const t = this.tDestrocos;

    for (let i = 0; i < DESTROCOS; i++) {
      const p = this._pedacos[i];
      const r = p.r0 + p.deriva * t;
      this._pos.set(
        Math.cos(p.ang) * r,
        p.y0 + p.subida * t,
        Math.sin(p.ang) * r,
      );
      this._eixo.set(p.eixo[0], p.eixo[1], p.eixo[2]).normalize();
      this._q.setFromAxisAngle(this._eixo, p.fase + t * p.giro);
      this._esc.setScalar(p.tam);
      this._m.compose(this._pos, this._q, this._esc);
      this.destrocos.setMatrixAt(i, this._m);
    }
    this.destrocos.instanceMatrix.needsUpdate = true;

    /* A brasa apaga, e com ela o emissivo dos nacos: as duas coisas são o mesmo
       calor visto de dois jeitos, e deixá-las com relógios diferentes daria uma
       pedra fria dentro de um brilho aceso. */
    const calor = clamp(1 - t / BRASA_VIDA, 0, 1);
    this.destrocoMat.emissiveIntensity = calor * calor * 1.6;
    this.brasaMat.opacity = calor * calor * 0.5;
    this.brasa.scale.setScalar(340 + t * 46);
  }

  /* ------------------------------------------------------------- desmonta -- */

  dispose() {
    /* Devolve a cena como ela estava — névoa e fundo inclusive. Sair do modo
       com a névoa do vácuo instalada deixaria o jogo do arqueiro com um vale
       preto, e é o mesmo cuidado que `NamekSky.dispose` documenta. */
    if (this.ativo) this.setAtivo(false);

    for (const m of [this.estrelas, this.destrocos, this.brasa]) {
      m?.geometry?.dispose();
      if (m?.isInstancedMesh) m.dispose();
    }
    for (const mat of [this.estrelaMat, this.destrocoMat, this.brasaMat]) {
      mat?.dispose();
    }
    this.root?.parent?.remove(this.root);
    this.root?.clear();
    this.root = null;
    this.ceu = null;
    this._pedacos.length = 0;
  }
}
