/* ---------------------------------------------------------------------------
   A aura de ki.

   Acende ao carregar, no arranque de voo e durante os especiais. É o efeito que
   mais aparece no modo — quinze lutadores podem acendê-la ao mesmo tempo —, e é
   por isso que ele tem uma regra acima de todas as outras:

   **NENHUMA LUZ DINÂMICA.** O §3 do plano dá três luzes ao jogo INTEIRO. Uma
   `PointLight` por aura seria quinze, e o custo de luz dinâmica no Three não é
   linear: cada uma entra no laço de todo fragmento de todo material iluminado
   da cena. O brilho aqui é feito com geometria ADITIVA, que custa preenchimento
   de tela e mais nada — o mesmo caminho que o jato do jetpack e o feixe do
   Kamehameha do arqueiro já tomaram, pela mesma razão.

   ------------------------------------------------------------------ as peças

   Três malhas, e cada uma existe porque a anterior não dá conta sozinha:

   • **núcleo** — um torneado liso em volta do corpo. Sozinho é um casulo de
     gelatina: bonito parado, morto em movimento.
   • **línguas** — dez cones em anel, girando e pulsando. São elas que dão a
     BORDA IRREGULAR. Um torneado é liso por construção e chama de verdade não
     tem contorno liso; sem as línguas a aura lê como campo de força.
   • **faíscas** — uma coluna de cacos subindo em espiral. Elas dão a DIREÇÃO
     (para cima) e a escala do efeito, e são a única coisa que se vê a 200 m.

   Fundidas em TRÊS malhas e não em vinte e cinco (um torneado, dez línguas,
   catorze cacos) — o mesmo truque de `fundir` em `rig.js`, e aqui ele vale
   ainda mais: quinze auras acesas seriam 375 chamadas de desenho. Apagada, a
   aura tem `visible = false` e não custa desenho nenhum — o Three descarta
   objeto invisível antes de qualquer outra coisa.

   ------------------------------------------------------------------ o rastro

   O arranque de ki não ganha um efeito NOVO. É a mesma chama girada para trás e
   esticada — `envelope.rotation.x` leva o fogo do topo da cabeça para a esteira
   atrás do corpo conforme a velocidade sobe. Duas linhas em vez de um segundo
   sistema de partículas, e o resultado é melhor: o rastro NASCE da aura em vez
   de aparecer do lado dela.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { damp } from "../../utils/math.js";
import { PIVO } from "./poses.js";

const TAU = Math.PI * 2;
const _cor = new THREE.Color();
const BRANCO = new THREE.Color(1, 1, 1);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _euler = new THREE.Euler();
const _escala = new THREE.Vector3(1, 1, 1);
const CIMA = new THREE.Vector3(0, 1, 0);

/* Perfil do núcleo, em metros e RELATIVO AO PEITO (y = 0 é o centro de massa).
   Ele mora no centro do corpo, e não nos pés, porque é em torno do peito que o
   corpo inclina — ver `PIVO` em `poses.js`. Uma aura ancorada nos pés ficaria
   para trás toda vez que o lutador mergulhasse. */
const PERFIL_NUCLEO = [
  [-1.24, 0.03],
  [-1.1, 0.26],
  [-0.7, 0.42],
  [-0.15, 0.48],
  [0.35, 0.42],
  [0.78, 0.3],
  [1.06, 0.17],
  [1.62, 0.02],
];

/** Quantas línguas de fogo em volta do corpo. */
const LINGUAS = 10;
/** Quantos cacos na coluna de faíscas. */
const FAISCAS = 14;
/** m — altura em que a coluna de faíscas se repete. */
const ALTURA_FAISCA = 2.6;

function materialAditivo(cor, opacidade) {
  return new THREE.MeshBasicMaterial({
    color: cor,
    transparent: true,
    opacity: opacidade,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    /* `fog: false` como o resto do que EMITE neste projeto (a chama do jetpack,
       o feixe do especial). Aditivo com névoa somaria a cor da névoa em cada
       pixel do efeito e a aura viraria um retângulo claro no céu. O sumiço com a
       distância é feito na opacidade, por LOD. */
    fog: false,
  });
}

/** Concatena geometrias já posicionadas numa só — versão local, sem cor de
 *  vértice: material aditivo não lê `vertexColors`, e o atributo seria memória
 *  à toa em quinze cópias. */
function fundirSimples(partes) {
  let total = 0;
  const prontas = [];
  for (const { geo, matriz } of partes) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (matriz) g.applyMatrix4(matriz);
    prontas.push(g);
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let off = 0;
  for (const g of prontas) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    off += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return geo;
}

export class Aura {
  /**
   * @param {THREE.Object3D} pai o `root` do lutador — a aura acompanha o corpo,
   *   inclusive quando ele tomba
   * @param {number} cor cor do jogador; o ki puxa para ela sem deixar de ser ki
   */
  constructor(pai, cor = 0xff7a1a) {
    this.grupo = new THREE.Group();
    this.grupo.visible = false;
    /* Depois do corpo: aditivo sem `depthWrite` precisa ser desenhado por
       último, ou a chama some atrás do próprio lutador. */
    this.grupo.renderOrder = 4;
    pai.add(this.grupo);

    /* O envelope é o que gira para virar rastro. Ele fica na cota do peito
       porque é lá que está o pivô do corpo. */
    this.envelope = new THREE.Group();
    this.envelope.position.y = PIVO;
    this.grupo.add(this.envelope);

    this.matNucleo = materialAditivo(0xffffff, 0.16);
    this.matChama = materialAditivo(cor, 0.34);
    this.matFaisca = materialAditivo(0xffffff, 0.6);

    const pontos = PERFIL_NUCLEO.map(([y, r]) => new THREE.Vector2(Math.max(1e-3, r), y));
    this.nucleo = new THREE.Mesh(new THREE.LatheGeometry(pontos, 14), this.matNucleo);
    this.envelope.add(this.nucleo);

    this.linguas = new THREE.Mesh(this.geometriaLinguas(), this.matChama);
    this.envelope.add(this.linguas);

    this.faiscas = new THREE.Mesh(this.geometriaFaiscas(), this.matFaisca);
    this.envelope.add(this.faiscas);

    /* Uma caixa envolvente para um efeito que muda de escala e de eixo todo
       quadro não ajuda em nada, e o `frustumCulled` padrão faria a aura sumir de
       lado quando o rastro se estica para fora dela. */
    for (const m of [this.nucleo, this.linguas, this.faiscas]) m.frustumCulled = false;

    this.intensidade = 0;
    this._t = Math.random() * 10; // fases diferentes: quinze auras não pulsam juntas
    this._alonga = 0;
    this._cor = new THREE.Color(cor);
    this._alvoCor = new THREE.Color(cor);
    this._opacidade = 1;
  }

  /** Anel de cones apontando para cima e para fora — a borda irregular do fogo. */
  geometriaLinguas() {
    const partes = [];
    for (let i = 0; i < LINGUAS; i++) {
      const a = (i / LINGUAS) * TAU;
      /* Alturas alternadas e irregulares. Dez línguas iguais dariam uma coroa
         de plástico; a diferença de tamanho é o que faz o olho ler fogo. */
      /* CHAMA, NÃO CACO DE VIDRO.
       *
       * Eram cones de QUATRO lados: de perfil, um cone de quatro lados é um
       * triângulo de aresta viva, e dez deles em aditivo branco viravam um
       * punhado de estilhaços chapados por cima do corpo — na pose do
       * Kamehameha, que é a mais icônica do jogo, o tronco e os braços sumiam
       * atrás deles. Sete lados já leem como volume arredondado ao custo de
       * três triângulos a mais por língua.
       *
       * E elas foram AFASTADAS do corpo (0,34 → 0,52 m) e afinadas: a aura tem
       * de emoldurar a silhueta, não cobri-la. Com `depthWrite: false` e mistura
       * aditiva, tudo o que ela cruza ela apaga — então o único lugar seguro
       * para ela é fora do contorno do lutador. */
      const alto = 0.74 + ((i * 7) % 5) * 0.18;
      const raio = 0.075 + ((i * 3) % 4) * 0.014;
      const geo = new THREE.ConeGeometry(raio, alto, 7, 1, true);
      geo.translate(0, alto * 0.5, 0);
      // Inclinadas para fora: subindo e abrindo, como toda chama sobe.
      const dir = _v.set(Math.cos(a) * 0.34, 1, Math.sin(a) * 0.34).normalize();
      const base = new THREE.Vector3(Math.cos(a) * 0.52, -0.45 + (i % 3) * 0.22, Math.sin(a) * 0.52);
      const m = new THREE.Matrix4().compose(
        base,
        _q.setFromUnitVectors(CIMA, dir),
        _escala.set(1, 1, 1),
      );
      partes.push({ geo, matriz: m });
    }
    return fundirSimples(partes);
  }

  /** Coluna de cacos em espiral. Sobem e reaparecem embaixo — ver `update`. */
  geometriaFaiscas() {
    const partes = [];
    for (let i = 0; i < FAISCAS; i++) {
      const t = i / FAISCAS;
      const a = t * TAU * 2.6;
      const raio = 0.26 + (i % 3) * 0.12;
      const tam = 0.035 + ((i * 5) % 4) * 0.012;
      const geo = new THREE.TetrahedronGeometry(tam);
      _euler.set(a, a * 1.7, 0);
      const m = new THREE.Matrix4().compose(
        _v.set(Math.cos(a) * raio, -1.2 + t * ALTURA_FAISCA, Math.sin(a) * raio),
        _q.setFromEuler(_euler),
        _escala.set(1, 1.8, 1),
      );
      partes.push({ geo, matriz: m });
    }
    return fundirSimples(partes);
  }

  /** A cor do ki. Puxa para a cor do jogador, mas nunca deixa de ser luz. */
  setColor(cor) {
    this._alvoCor.set(cor);
  }

  /**
   * @param {number} dt
   * @param {number} intensidade 0 apagada … 1 no talo
   * @param {number} alonga 0 chama para cima … 1 rastro esticado para trás
   * @param {number} opacidade multiplicador de distância (LOD)
   */
  update(dt, intensidade, alonga = 0, opacidade = 1) {
    /* A intensidade é AMORTECIDA aqui dentro, e não pelo dono. Quem manda nela
       são eventos secos — soltou a tecla de carga, o especial acabou — e uma
       aura que apaga no mesmo quadro em que a tecla sobe é um interruptor de
       luz. O ki some como fogo some. */
    this.intensidade = damp(this.intensidade, intensidade, 9, dt);
    this._alonga = damp(this._alonga, alonga, 6, dt);
    this._opacidade = opacidade;

    const i = this.intensidade;
    const ligada = i > 0.02;
    if (this.grupo.visible !== ligada) this.grupo.visible = ligada;
    if (!ligada) return;

    this._t += dt;
    const t = this._t;

    // Cor: transição, nunca troca seca — o azul do Kamehameha CHEGA na aura.
    this._cor.lerp(this._alvoCor, 1 - Math.exp(-5 * dt));
    this.matChama.color.copy(this._cor);
    this.matNucleo.color.copy(_cor.copy(this._cor).lerp(BRANCO, 0.72));
    this.matFaisca.color.copy(_cor.copy(this._cor).lerp(BRANCO, 0.45));

    /* Duas frequências incomensuráveis outra vez (11,3 e 17,9): o pulso da aura
       não pode ter período audível, ou vira lâmpada de discoteca. */
    const pulso = 1 + Math.sin(t * 11.3) * 0.07 + Math.sin(t * 17.9) * 0.04;
    const largo = 0.55 + 0.55 * i;

    this.nucleo.scale.set(largo, 0.9 + 0.25 * i, largo);
    this.matNucleo.opacity = 0.2 * i * this._opacidade;

    // As línguas GIRAM. É o movimento que separa "aura" de "casulo".
    this.linguas.rotation.y = t * 2.4;
    this.linguas.scale.set(largo * pulso, (0.7 + 0.75 * i) * pulso, largo * pulso);
    /* 0,42 → 0,26. Aditivo sobre um céu já claro satura em branco muito antes
       de a cor do lutador aparecer, e era isso que fazia a aura ler como vidro
       em vez de fogo: a matiz existia no material e nunca chegava à tela. Mais
       fraca, ela SOMA em vez de substituir — e a cor volta. */
    this.matChama.opacity = 0.26 * i * this._opacidade;

    /* As faíscas sobem e voltam por baixo. O módulo é o truque inteiro: uma
       coluna que se repete a cada `ALTURA_FAISCA` metros parece infinita e não
       custa uma única escrita em atributo de geometria. */
    const subida = (t * (1.6 + 2.2 * i)) % ALTURA_FAISCA;
    this.faiscas.position.y = subida;
    this.faiscas.rotation.y = -t * 1.3;
    this.faiscas.scale.setScalar(0.7 + 0.6 * i);
    // Pelo mesmo motivo da chama: faísca branca cheia em aditivo é um recorte
    // de papel, não uma fagulha.
    this.matFaisca.opacity = 0.34 * i * this._opacidade;

    /* O RASTRO. A chama tomba para trás (o −Y do corpo, que no voo rasante é a
       direção de onde ele veio) e estica. Nenhum objeto novo: é a mesma aura
       deitada. */
    this.envelope.rotation.x = this._alonga * Math.PI;
    const estica = 1 + this._alonga * 2.4;
    this.envelope.scale.set(1 - this._alonga * 0.35, estica, 1 - this._alonga * 0.35);
  }

  /** Detalhe fino da aura: as faíscas somem de longe, a chama fica. */
  setDetalhe(nivel) {
    this.faiscas.visible = nivel < 2;
  }

  dispose() {
    for (const m of [this.nucleo, this.linguas, this.faiscas]) m.geometry.dispose();
    for (const m of [this.matNucleo, this.matChama, this.matFaisca]) m.dispose();
    this.grupo.parent?.remove(this.grupo);
  }
}