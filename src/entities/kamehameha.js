/* ---------------------------------------------------------------------------
   O feixe.

   Três cilindros concêntricos, uma ponta e uma explosão — e a vida inteira
   deles é FUNÇÃO PURA DE (origem, direção, tempo desde o disparo). É por isso
   que a rede custa ~60 bytes: cada cliente reconstrói o mesmo feixe a partir do
   evento, exatamente como já faz com a flecha.

   A parte que dá o caráter é a DISSIPAÇÃO. Um feixe que some de uma vez é um
   cilindro que desliga; o que se quer é a energia acabando — a cauda solta das
   mãos, corre atrás da ponta e o traço vai afinando enquanto se estica. Aqui
   isso são duas distâncias sobre o mesmo raio:

       frente  0 → 400 m a 300 m/s (ou até o terreno)
       cauda   0 durante a sustentação; depois persegue a frente

   O que ele atravessa: meteoro e gente. O que o para: o CHÃO. Um raio de
   energia que uma pedra interrompe não é um raio de energia.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { gameEvents, EventType } from "../core/events.js";

/** Raio na base, como fração do raio cheio. Ver o comentário em `camada`. */
const BASE_TAPER = 0.14;
/** m — quanto o VISUAL nasce à frente das mãos (o acerto continua nelas). */
const RECUO_VISUAL = 1.2;
/** m — em quantos metros a ponta apaga quando não há nada em que bater. */
const SUMICO_PONTA = 70;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Um Kamehameha em voo.
 *
 * Não conhece jogador nem rede: recebe origem, direção e um relógio. Quem
 * decide o que morreu é `systems/special.js`, e só na tela de quem atirou.
 */
export class KamehamehaBeam {
  /**
   * @param {THREE.Scene} scene
   * @param {{x,y,z}} origem ponto entre as mãos
   * @param {{x,y,z}} direcao unitária, TRAVADA no disparo
   * @param {object} terrain campo de altura, para saber onde o feixe termina
   * @param {boolean} local se é o feixe de quem está jogando (ganha luz)
   */
  constructor(scene, origem, direcao, terrain, local = false) {
    const B = CONFIG.special.beam;
    this.scene = scene;
    this.terrain = terrain;
    this.local = local;
    this.origem = new THREE.Vector3(origem.x, origem.y, origem.z);
    this.dir = new THREE.Vector3(direcao.x, direcao.y, direcao.z).normalize();
    this.t = 0;
    this.frente = 0;
    this.cauda = 0;
    this.morto = false;

    /* Onde ele termina. Resolvido UMA vez, no disparo: a direção está travada e
       o terreno não muda, então marchar pelo raio agora sai mais barato do que
       testar altura a cada quadro pelos sete segundos de vida. */
    this.alcance = this.acharFim(B.range);
    this.fim = this.origem.clone().addScaledVector(this.dir, this.alcance);
    // Bateu em alguma coisa (não sumiu no vazio além da barreira)?
    this.bateu = this.alcance < B.range - 1;

    this.group = new THREE.Group();
    /* O grupo é orientado uma vez e os cilindros crescem em Y local. Assim
       "estender o feixe" é mexer em escala e posição, não regerar geometria.

       Ele nasce um pouco À FRENTE das mãos, e só o desenho: a origem do teste
       de acerto continua sendo o punho. Um metro e vinte tira a boca do feixe
       de dentro do campo de visão da câmera de terceira pessoa sem que ninguém
       perceba um vão — o afunilamento da base já deixa aquele trecho fino. */
    this.group.position.copy(this.origem).addScaledVector(this.dir, RECUO_VISUAL);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dir);

    this.nucleo = this.camada(B.coreRadius, B.coreColor, B.coreOpacity ?? 0.85, 3);
    this.casca = this.camada(B.shellRadius, B.shellColor, B.shellOpacity ?? 0.32, 2);
    this.halo = this.camada(B.haloRadius, B.haloColor, B.haloOpacity ?? 0.1, 1);

    /* A PONTA. Uma esfera com um cone à frente: a esfera é a massa, o cone é a
       direção. Só a esfera já lê como "bola de energia voando", que é a coisa
       errada — isto é um feixe, e a ponta é o nariz dele. */
    this.ponta = new THREE.Mesh(
      new THREE.SphereGeometry(B.shellRadius * 1.25, 16, 12),
      new THREE.MeshBasicMaterial({
        color: B.coreColor,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.group.add(this.ponta);

    scene.add(this.group);

    /* A LUZ. Duas no máximo em todo o efeito, e só perto da câmera — luz
       dinâmica é o item mais caro que se pode acrescentar à Lua. Sete segundos
       num acontecimento raro cabem; uma por rocha, não caberia. */
    if (local) {
      this.luz = new THREE.PointLight(B.coreColor, 0, 90, 1.4);
      this.luz.position.copy(this.origem);
      scene.add(this.luz);
    }

    this.estourar();
  }

  camada(raio, cor, opacidade, ordem) {
    /* AFUNILADO NA MÃO, e isso não é estética — é o que torna o efeito
     * jogável. Um tubo de 14 m de diâmetro que começa cheio no punho é visto
     * de dentro pela câmera de terceira pessoa, que está a quatro metros dali:
     * a tela inteira vira uma parede branca e o jogador deixa de ver o próprio
     * personagem, o céu e as rochas. Medido — foi exatamente o que aconteceu no
     * primeiro teste.
     *
     * Estreito na base e cheio à frente também é o que a referência mostra: a
     * energia sai concentrada e ABRE. O raio de morte (`killRadius`) não muda
     * com isto; ele é do eixo, e o afunilamento é só a casca. */
    const geo = new THREE.CylinderGeometry(raio, raio * BASE_TAPER, 1, 20, 1, true);
    // O cilindro nasce centrado; deslocá-lo meia unidade faz a base ficar na
    // origem, e aí escala em Y = comprimento do feixe, direto.
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: cor,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: opacidade,
        side: THREE.DoubleSide,
      }),
    );
    mesh.renderOrder = ordem;
    // Um cilindro de 400 m que nasce na mão: a caixa envolvente não ajuda em
    // nada e o custo já é conhecido.
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Marcha pelo raio até achar o chão. Passo grosso, depois refinado.
   *
   * SÓ O CHÃO PARA O FEIXE — e essa frase precisou ser escrita em código porque
   * havia uma segunda parada aqui que não era chão nenhum.
   *
   * A versão anterior recusava o ponto em que `isWalkable` desse falso, e na
   * Lua isso é a BARREIRA CIRCULAR de 165 m: um teste de x e z que não olha a
   * altura. Um feixe disparado para o céu a 45° cruza esse círculo aos 233 m de
   * caminho — a duzentos metros de altura, no vácuo — e parava ali, com a
   * `bateu` verdadeira e a ponta inchando na explosão. Na tela: uma bola parada
   * no ar, contra nada, exatamente o que foi relatado.
   *
   * E o mesmo defeito comia o golpe. Uma rocha a 150 m de altura fica atrás
   * dessa fronteira invisível para quase todo ângulo útil, então o segmento
   * vivo do feixe terminava ANTES dela e `testarAcertos` não tinha o que
   * testar: o colosso atravessado pelo raio e intacto.
   *
   * `heightAt` é definida em qualquer x e z (ruído mais curvatura, sem
   * fronteira), então o teste de terreno sozinho já cobre o caso rasante que a
   * barreira pretendia cobrir. Sem obstáculo nenhum, o feixe vai até o alcance
   * e some — ver o desvanecimento da ponta em `update`.
   */
  acharFim(maxRange) {
    const p = new THREE.Vector3();
    let ultimo = 0;
    for (let d = 4; d <= maxRange; d += 4) {
      p.copy(this.origem).addScaledVector(this.dir, d);
      if (p.y <= this.terrain.heightAt(p.x, p.z)) {
        // Refina em passos de meio metro: um erro de 4 m no ponto da explosão
        // apareceria como a bola de fogo enterrada ou flutuando.
        for (let f = ultimo; f <= d; f += 0.5) {
          p.copy(this.origem).addScaledVector(this.dir, f);
          if (p.y <= this.terrain.heightAt(p.x, p.z)) return f;
        }
        return d;
      }
      ultimo = d;
    }
    return maxRange;
  }

  /** O clarão inicial, no ponto de saída. */
  estourar() {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.origem.x, y: this.origem.y, z: this.origem.z },
      count: 60,
      color: 0x9fe0ff,
      speed: 22,
      spread: 0.5,
      size: 0.6,
      grow: 2.4,
      life: 0.9,
      gravity: 0,
      drag: 1.4,
      alpha: 1,
    });
  }

  /**
   * A explosão de energia onde ele bate. Sustenta enquanto o feixe vive.
   *
   * FAGULHA, NÃO NUVEM — e isto é informação, não estética.
   *
   * Havia duas emissões aqui, e as duas erravam pelo mesmo motivo: elas
   * SUSTENTAM. A cada 0,12 s sai um sopro novo, e nos três segundos de feixe
   * isso são vinte e cinco sopros no mesmo ponto. A poeira cinza (que vivia
   * 2,2 s e crescia 3,2×) virava uma cortina opaca; medida em tela, a fagulha
   * azul sozinha — 26 partículas de 3 m crescendo 2,8× — fazia a MESMA cortina,
   * só que clara. Em ambos os casos quem atirou perdia de vista a única coisa
   * que a ponta precisa comunicar: ONDE ela acertou.
   *
   * A poeira saiu. A fagulha ficou, mas em regime de fagulha: um terço da
   * conta, um quinto do tamanho, quase sem crescer e com meio segundo de vida.
   * O que fica no ar em regime permanente são ~40 riscos pequenos em vez de
   * ~260 bolas grandes — o ponto de impacto continua aceso e volta a ser
   * legível. Quem marca o lugar é a ponta do feixe, que já cresce 1,9× ali.
   */
  pulsarImpacto(dt) {
    if (!this.bateu) return;
    this._impTimer = (this._impTimer ?? 0) - dt;
    if (this._impTimer > 0) return;
    this._impTimer = 0.12;
    const B = CONFIG.special.beam;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.fim.x, y: this.fim.y, z: this.fim.z },
      count: 10,
      color: 0xbfe8ff,
      speed: 26,
      spread: 1,
      size: B.blastRadius * 0.05,
      grow: 1.4,
      life: 0.5,
      gravity: -1.62,
      drag: 0.6,
      alpha: 1,
    });
  }

  /**
   * @returns {boolean} true quando o feixe acabou e pode ser descartado
   */
  update(dt) {
    if (this.morto) return true;
    const S = CONFIG.special;
    const B = S.beam;
    this.t += dt;

    // A frente avança até o fim e para lá.
    this.frente = Math.min(this.alcance, this.t * B.speed);

    /* A CAUDA. Fica na mão durante a sustentação; depois persegue a frente com
       ease-in — devagar no começo (o feixe "estica") e rápido no fim (ele
       "some"). Uma corrida linear daria um traço encolhendo em velocidade
       constante, que lê como uma barra de progresso. */
    const fimSustentacao = S.sustain;
    if (this.t > fimSustentacao) {
      const u = Math.min(1, (this.t - fimSustentacao) / S.dissipate);
      this.cauda = this.frente * (u * u);
      if (u >= 1) {
        this.morto = true;
        return true;
      }
    }

    const comprimento = Math.max(0, this.frente - this.cauda);
    if (comprimento <= 0.01) {
      this.morto = true;
      return true;
    }

    /* O AFINAMENTO. Na dissipação o raio cai junto com o que resta — e cai mais
       depressa que o comprimento, senão o feixe viraria um charuto grosso e
       curto em vez de um traço se apagando. */
    const restante = this.frente > 0 ? comprimento / this.frente : 1;
    const magro = this.t > fimSustentacao ? Math.pow(restante, 0.65) : 1;

    // Pulso rápido na espessura: energia não é um tubo de PVC.
    const pulso = 1 + Math.sin(this.t * 34) * 0.045;

    for (const [mesh, raio] of [
      [this.nucleo, B.coreRadius],
      [this.casca, B.shellRadius],
      [this.halo, B.haloRadius],
    ]) {
      mesh.position.y = this.cauda;
      mesh.scale.set(magro * pulso, comprimento, magro * pulso);
      void raio;
    }

    this.ponta.position.y = this.frente;
    const pontaEsc = magro * (1 + Math.sin(this.t * 22) * 0.08);
    this.ponta.scale.setScalar(pontaEsc);
    // Chegou ao fim: a ponta vira a explosão, então ela cresce e fica.
    if (this.frente >= this.alcance && this.bateu) {
      this.ponta.scale.setScalar(pontaEsc * 1.9);
    }

    /* SEM ANTEPARO, A PONTA SOME. O TUBO FICA.
     *
     * `frente` é limitada pelo alcance, então um tiro para o céu terminava com
     * a esfera PARADA na cota máxima pelo resto da sustentação: um ponto de luz
     * estacionário no vácuo, que é a mesma leitura errada de "bati em alguma
     * coisa invisível" — só que agora a 400 m em vez de 230.
     *
     * Some só ela, nos últimos metros do percurso. O cilindro continua lá,
     * atravessado no céu e apontando para longe, que é o que se pede de uma
     * coisa disparada contra o espaço: ela vai embora, não termina em lugar
     * nenhum. */
    if (!this.bateu) {
      const u = clamp01((this.frente - (this.alcance - SUMICO_PONTA)) / SUMICO_PONTA);
      this.ponta.material.opacity = 0.9 * (1 - u * u);
    }

    if (this.luz) {
      const vivo = this.t < fimSustentacao ? 1 : Math.max(0, restante);
      this.luz.intensity = B.blastLight * vivo;
      // A luz acompanha a PONTA: é lá que a coisa está acontecendo.
      this.luz.position.copy(this.origem).addScaledVector(this.dir, this.frente);
    }

    this.pulsarImpacto(dt);
    return false;
  }

  /** O segmento vivo agora, para o teste de acerto. */
  segmento() {
    return { origem: this.origem, dir: this.dir, de: this.cauda, ate: this.frente };
  }

  dispose() {
    // Feixe descartado é feixe morto — quem o estiver acompanhando (a câmera do
    // especial, o teste de acerto) tem uma bandeira só para consultar, e não
    // precisa saber que existe um `dispose`.
    this.morto = true;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    if (this.luz) this.scene.remove(this.luz);
    this.luz = null;
  }
}

/** Distância de um ponto ao segmento vivo do feixe. */
export function distanciaAoFeixe(seg, x, y, z) {
  const px = x - seg.origem.x;
  const py = y - seg.origem.y;
  const pz = z - seg.origem.z;
  let t = px * seg.dir.x + py * seg.dir.y + pz * seg.dir.z;
  t = Math.max(seg.de, Math.min(seg.ate, t));
  return Math.hypot(
    px - seg.dir.x * t,
    py - seg.dir.y * t,
    pz - seg.dir.z * t,
  );
}
