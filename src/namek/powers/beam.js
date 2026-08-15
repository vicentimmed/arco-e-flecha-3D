/* ---------------------------------------------------------------------------
   O feixe sustentado — Kamehameha e Galick Gun.

   Custa a barra CHEIA (§5 do plano) e é o golpe que enche a tela. Três
   cilindros concêntricos, uma ponta, e a vida inteira deles é FUNÇÃO PURA DE
   (origem, direção, tempo desde o disparo): a rede manda um `NC2S.SPECIAL` de
   uns setenta bytes e cada cliente reconstrói o mesmo feixe.

   -------------------------------------------------------------- as quatro fases

       carga        windup segundos na pose, a esfera crescendo na mão
       sustentação  a frente avança a `speed` até o alcance (ou até o chão)
       dissipação   a cauda solta da mão e persegue a frente
       morto        devolvido ao pool

   A DISSIPAÇÃO é o que dá o caráter. Um feixe que some de uma vez é um cilindro
   que desliga; o que se quer é a energia ACABANDO — a cauda solta, corre atrás
   da ponta e o traço vai afinando enquanto se estica. São duas distâncias sobre
   o mesmo raio, e é a mesma ideia do Kamehameha do arqueiro
   (`entities/kamehameha.js`), que resolveu isto primeiro.

   ------------------------------------------------------------------ o dano

   Por SEGUNDO, não por acerto: `dps` em `NAMEK.specials`. Cobrar por acerto
   faria um feixe de 2,4 s valer o mesmo que um encostão de meio segundo, e a
   decisão de SEGURAR a mira em cima de alguém — que é a jogada do golpe —
   deixaria de valer alguma coisa.

   Mas cobrar por segundo não é mandar uma mensagem por quadro: a exposição de
   cada vítima é ACUMULADA aqui e despejada a 10 Hz, que é a mesma frequência
   do `VITALS`. É exatamente o que o comentário do `NC2S.SPECIAL_HIT` no
   protocolo descreve — `dt` são os segundos desde o último aviso.

   ----------------------------------------------------------------- e o chão

   O feixe atravessa gente e cenário. Só o CHÃO o para — um raio de energia que
   uma pedra interrompe não é um raio de energia. E o chão vira UMA cratera, no
   ponto em que a frente encostou, e só uma: um pulso de cratera por quadro
   durante 2,4 s gastaria os 96 buracos que `NAMEK.destruction.craterLimit`
   guarda para a partida inteira, num golpe só.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { gameEvents, EventType } from "../../core/events.js";
import { acharChao, atingivel, distanciaAoFeixe, pegarVaga, PEITO } from "./blast.js";

/* Quantos feixes cabem em cena ao mesmo tempo.
 *
 * Não é um limite de jogo, é um teto de custo: cada feixe são quatro chamadas
 * de desenho, e seis é mais que o número de pessoas que conseguem ter a barra
 * cheia no mesmo instante numa sala de quinze (a barra leva 2,6 s para encher
 * e o especial ainda tem `windup`). O sétimo recicla — e QUEM ele recicla está
 * em `pegarVaga`, que nunca rouba o feixe do jogador local para dar a um
 * remoto. */
const MAX_FEIXES = 6;

/** Raio na base, como fração do raio cheio. Ver o comentário em `montar`. */
const BASE_TAPER = 0.14;
/** m — quanto o VISUAL nasce à frente das mãos (o acerto continua nelas). */
const RECUO_VISUAL = 1.2;
/** m — em quantos metros a ponta apaga quando não há nada em que bater. */
const SUMICO_PONTA = 70;

/* Fração da sustentação que a cauda leva para alcançar a frente. É FORMA, não
   balanço: o dano por segundo e a duração do golpe estão em `NAMEK.specials`, e
   isto só diz quanto tempo o rabo do feixe leva para sumir depois que a energia
   acabou. Um pouco mais da metade da sustentação é o que a referência mostra —
   o traço estica, afina e some. */
const FRACAO_DISSIPACAO = 0.55;

/** Raios das três camadas, em múltiplos do `hitRadius` do especial. */
const RAIO_NUCLEO = 0.5;
const RAIO_CASCA = 1.0;
const RAIO_HALO = 1.75;
/* A casca vale EXATAMENTE o raio de morte, e isso é uma promessa ao jogador:
   tudo o que parece sólido mata, e o que sobra para fora é o brilho. Morrer do
   lado de fora do que se vê é a reclamação que nenhum ajuste de número
   conserta. */

/** s — de quanto em quanto tempo a exposição acumulada é despejada. */
const AVISO = 1 / NAMEK.net.statusRate;
/** Quantas vítimas simultâneas a tabela de exposição guarda entre dois avisos. */
const MAX_VITIMAS = NAMEK.net.maxPlayers + 1;

/* ------------------------------------------------------------- rascunhos --- */
const _dir = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _cor = new THREE.Color();

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ============================================================================
   Um feixe
   ========================================================================== */

class Feixe {
  /** @param {THREE.Scene} scene @param {object} geos geometrias do pool */
  constructor(scene, geos) {
    this.scene = scene;
    /* `viva`, `t` e `local` existem ANTES do primeiro disparo porque
       `pegarVaga` os lê para escolher quem reciclar. Um slot nunca usado sai
       pelo `!viva`, mas depender dessa ordem seria depender de uma ordem. */
    this.viva = false;
    this.t = 0;
    this.local = false;
    this.group = new THREE.Group();
    this.group.visible = false;

    this.nucleo = this.montar(geos.tubo, 3, 0.9);
    this.casca = this.montar(geos.tubo, 2, 0.34);
    this.halo = this.montar(geos.tubo, 1, 0.11);

    /* A PONTA faz DOIS papéis, e é por isso que ela existe como um objeto só:
       durante a carga é a esfera entre as mãos (a pose), e depois é o nariz do
       feixe e a explosão onde ele encosta. Dois meshes para duas fases que
       nunca coexistem seriam uma chamada de desenho a mais por feixe. */
    this.ponta = new THREE.Mesh(
      geos.bola,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
        fog: false,
      }),
    );
    this.ponta.renderOrder = 4;
    this.ponta.frustumCulled = false;
    this.group.add(this.ponta);

    scene.add(this.group);

    /* A tabela de exposição. Pré-alocada: ela é reconstruída a cada despejo e
       nunca cresce, então um `Map` aqui seria uma alocação a cada vítima nova
       para guardar no máximo dezesseis floats. */
    this.vitimaId = new Array(MAX_VITIMAS).fill(null);
    this.vitimaSeg = new Float32Array(MAX_VITIMAS);
    this.nVitimas = 0;
    this.tAviso = 0;
  }

  montar(geo, ordem, opacidade) {
    /* AFUNILADO NA MÃO, e isto não é estética — é o que torna o golpe jogável.
     *
     * Um tubo de 7 m de raio que começa cheio no punho é visto POR DENTRO pela
     * câmera de terceira pessoa, que está a quatro metros dali: a tela inteira
     * vira uma parede branca e o jogador deixa de ver o próprio personagem, o
     * céu e quem está atirando de volta. Isso foi medido no jogo do arqueiro,
     * está escrito lá em `entities/kamehameha.js`, e não há motivo para
     * descobrir de novo com um feixe duas vezes mais grosso.
     *
     * Estreito na base e cheio à frente também é o que a referência mostra: a
     * energia sai concentrada e ABRE. O raio de morte não muda com isto — ele
     * é do EIXO, e o afunilamento é só a casca. */
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: opacidade,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    mesh.renderOrder = ordem;
    // Um cilindro de 620 m que nasce na mão: a caixa envolvente não ajuda em
    // nada e o custo já é conhecido.
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /* ---------------------------------------------------------------- disparo */

  acender(field, { owner, kind, origem, dir, local }) {
    const S = NAMEK.specials[kind];
    this.field = field;
    this.owner = owner;
    this.kind = kind;
    this.info = S;
    this.local = !!local;
    this.viva = true;
    this.t = 0;
    this.frente = 0;
    this.cauda = 0;
    this.reportouChao = false;
    this.nVitimas = 0;
    this.tAviso = 0;
    this._imp = 0;
    this.alcance = 0;
    this.bateu = false;
    this.saiu = false;

    this.ox = origem.x;
    this.oy = origem.y;
    this.oz = origem.z;
    const inv = 1 / (Math.hypot(dir.x, dir.y, dir.z) || 1);
    this.dx = dir.x * inv;
    this.dy = dir.y * inv;
    this.dz = dir.z * inv;

    this.dissipacao = S.sustain * FRACAO_DISSIPACAO;

    /* A ORIGEM NÃO ACOMPANHA O DONO, e é de propósito. Quem solta um especial
       fica preso na pose (§5 e §10 do plano) — ele não vai a lugar nenhum
       durante o golpe. Amarrar o feixe à posição do lutador a cada quadro
       custaria uma dependência do sistema de animação e daria em nada, porque
       aquela posição não muda. */
    this.group.position.set(
      this.ox + this.dx * RECUO_VISUAL,
      this.oy + this.dy * RECUO_VISUAL,
      this.oz + this.dz * RECUO_VISUAL,
    );
    _dir.set(this.dx, this.dy, this.dz);
    this.group.quaternion.setFromUnitVectors(_UP, _dir);
    this.group.visible = true;

    const cor = S.cor;
    /* O núcleo puxa para o branco e as camadas de fora ficam com a cor do
       golpe. É como a referência trata todo feixe: o miolo está quente demais
       para ter cor, e é a coroa que diz se aquilo é um Kamehameha ou um Galick
       Gun. */
    _cor.set(cor);
    this.nucleo.material.color.set(0xffffff).lerp(_cor, 0.35);
    this.casca.material.color.copy(_cor);
    this.halo.material.color.copy(_cor);
    this.ponta.material.color.set(0xffffff).lerp(_cor, 0.25);
    this.ponta.material.opacity = 0.9;

    this.nucleo.visible = false;
    this.casca.visible = false;
    this.halo.visible = false;

    this.faiscarCarga();
    return this;
  }

  /** O sopro de energia sendo puxada para as mãos, no começo da pose. */
  faiscarCarga() {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.ox, y: this.oy, z: this.oz },
      count: 26,
      color: this.info.cor,
      speed: 9,
      spread: 1,
      size: 0.4,
      grow: -0.6,
      life: this.info.windup * 0.8,
      gravity: 0,
      // Arrasto alto e crescimento negativo: as fagulhas VÃO para a mão e
      // encolhem, em vez de sair dela. É a leitura de "juntando", não de
      // "explodindo", e é a única diferença entre a pose de carga e um estouro.
      drag: 2.6,
      alpha: 1,
      additive: true,
    });
  }

  /* ------------------------------------------------------------------ passo */

  /** @returns {boolean} true quando acabou e pode voltar ao pool */
  update(dt, alvos, localId, relato) {
    if (!this.viva) return true;
    const S = this.info;
    this.t += dt;

    /* A CARGA. O feixe ainda não existe: o que existe é a esfera entre as mãos,
       crescendo. É a pose que a referência mostra antes de todo Kamehameha, e é
       também o aviso que dá a quem está do outro lado a chance de sair da
       frente — sem ela, o especial seria um botão que apaga alguém. */
    if (this.t < S.windup) {
      const u = this.t / S.windup;
      this.ponta.position.y = 0;
      // Cresce com u² e treme: energia sendo comprimida, não um balão inflando.
      const r = S.hitRadius * 0.62 * u * u * (1 + Math.sin(this.t * 30) * 0.06);
      this.ponta.scale.setScalar(Math.max(0.001, r));
      this.ponta.material.opacity = 0.55 + u * 0.4;
      if (this.local) relato.luz(this.ox, this.oy, this.oz, S.cor, 0.35 * u);
      return false;
    }

    /* O DISPARO. O alcance é resolvido AGORA, e não no início da pose: uma
       cratera aberta durante a carga (por outra pessoa, ou pela própria rajada
       de quem estava atirando de volta) muda onde este feixe encosta. */
    if (!this.saiu) {
      this.saiu = true;
      this.alcance = acharChao(
        this.field,
        this.ox,
        this.oy,
        this.oz,
        this.dx,
        this.dy,
        this.dz,
        S.range,
      );
      this.bateu = this.alcance < S.range - 1;
      this.nucleo.visible = true;
      this.casca.visible = true;
      this.halo.visible = true;
      this.estourarBoca();
    }

    const tf = this.t - S.windup;
    this.frente = Math.min(this.alcance, tf * S.speed);

    /* A CAUDA fica na mão durante a sustentação; depois persegue a frente com
       ease-in — devagar no começo (o feixe "estica") e rápido no fim (ele
       "some"). Uma corrida linear daria um traço encolhendo em velocidade
       constante, que lê como uma barra de progresso. */
    const dissipando = tf > S.sustain;
    if (dissipando) {
      const u = Math.min(1, (tf - S.sustain) / this.dissipacao);
      this.cauda = this.frente * u * u;
      if (u >= 1) {
        this.despejar(relato, true);
        return true;
      }
    }

    /* COMPRIMENTO ZERO SÓ MATA NA DISSIPAÇÃO.
     *
     * Isto já foi um bug, e vale escrever qual: `frente` vale `tf · speed`, e no
     * quadro em que a carga termina `tf` pode ser exatamente zero — acontece
     * sempre que `windup` é múltiplo do passo, e 1,05 s é 63 quadros redondos a
     * 60 Hz. O feixe nascia com zero de comprimento, caía na guarda de "não
     * sobrou nada" e MORRIA no quadro em que deveria sair. Na tela: a pose de
     * carga inteira, o clarão da boca, e nenhum feixe.
     *
     * Enquanto ele sustenta, comprimento zero é o começo. Só quando a cauda
     * está perseguindo a frente é que zero significa acabou. */
    const comprimento = this.frente - this.cauda;
    if (dissipando && comprimento <= 0.01) {
      this.despejar(relato, true);
      return true;
    }
    if (comprimento > 0.01) {
      this.desenhar(tf, comprimento, dissipando);
      this.queimar(dt, alvos, localId, relato);
      this.bater(relato, localId, dt);
    }
    if (this.local) {
      const vivo = dissipando ? comprimento / Math.max(1e-3, this.frente) : 1;
      relato.luz(
        this.ox + this.dx * this.frente,
        this.oy + this.dy * this.frente,
        this.oz + this.dz * this.frente,
        S.cor,
        0.85 * vivo,
      );
    }
    return false;
  }

  /* ---------------------------------------------------------------- desenho */

  desenhar(tf, comprimento, dissipando) {
    const S = this.info;

    /* O AFINAMENTO. Na dissipação o raio cai junto com o que resta — e cai mais
       depressa que o comprimento, senão o feixe viraria um charuto grosso e
       curto em vez de um traço se apagando. */
    const restante = this.frente > 0 ? comprimento / this.frente : 1;
    const magro = dissipando ? Math.pow(restante, 0.65) : 1;
    // Pulso rápido na espessura: energia não é um tubo de PVC.
    const pulso = 1 + Math.sin(tf * 34) * 0.045;
    const k = magro * pulso * S.hitRadius;

    this.nucleo.position.y = this.cauda;
    this.nucleo.scale.set(k * RAIO_NUCLEO, comprimento, k * RAIO_NUCLEO);
    this.casca.position.y = this.cauda;
    this.casca.scale.set(k * RAIO_CASCA, comprimento, k * RAIO_CASCA);
    this.halo.position.y = this.cauda;
    this.halo.scale.set(k * RAIO_HALO, comprimento, k * RAIO_HALO);

    this.ponta.position.y = this.frente;
    const p = magro * S.hitRadius * 1.25 * (1 + Math.sin(tf * 22) * 0.08);
    // Chegou ao fim com anteparo: a ponta VIRA a explosão, então ela cresce.
    this.ponta.scale.setScalar(
      this.frente >= this.alcance && this.bateu ? p * 1.9 : p,
    );

    /* SEM ANTEPARO, A PONTA SOME. O TUBO FICA.
     *
     * `frente` é limitada pelo alcance, então um tiro para o céu terminaria com
     * a esfera PARADA na cota máxima pelo resto da sustentação: um ponto de luz
     * estacionário no vácuo, que lê como "bati em alguma coisa invisível". Some
     * só ela, nos últimos metros. O cilindro continua lá, atravessado no céu e
     * apontando para longe — que é o que se pede de uma coisa disparada contra
     * o espaço: ela vai embora, não termina em lugar nenhum. */
    if (!this.bateu) {
      const u = clamp01((this.frente - (this.alcance - SUMICO_PONTA)) / SUMICO_PONTA);
      this.ponta.material.opacity = 0.9 * (1 - u * u);
    }
  }

  /* ------------------------------------------------------------------- dano */

  /**
   * Quem está dentro do trecho VIVO do feixe, e por quanto tempo.
   *
   * O teste é do PEITO contra o eixo, e não da cápsula inteira: com um raio de
   * morte de 3,6 m contra um corpo de 1,78 m, a diferença entre as duas contas
   * é menor que a espessura do halo. É a mesma aproximação que o
   * `systems/special.js` do arqueiro faz, e pelo mesmo motivo.
   */
  queimar(dt, alvos, localId, relato) {
    // Só quem atirou julga o próprio acerto (§8 do plano). Os feixes dos outros
    // são desenhados, não arbitrados.
    if (this.owner !== localId) return;
    const raio = this.info.hitRadius;
    for (let k = 0; k < alvos.length; k++) {
      const a = alvos[k];
      if (!atingivel(a, this.owner)) continue;
      const d = distanciaAoFeixe(
        this.ox,
        this.oy,
        this.oz,
        this.dx,
        this.dy,
        this.dz,
        this.cauda,
        this.frente,
        a.x,
        a.y + a.altura * PEITO,
        a.z,
      );
      if (d > raio) continue;
      this.acumular(a.id, dt);
    }

    this.tAviso += dt;
    if (this.tAviso >= AVISO) this.despejar(relato, false);
  }

  acumular(id, dt) {
    for (let i = 0; i < this.nVitimas; i++) {
      if (this.vitimaId[i] === id) {
        this.vitimaSeg[i] += dt;
        return;
      }
    }
    if (this.nVitimas >= MAX_VITIMAS) return;
    this.vitimaId[this.nVitimas] = id;
    this.vitimaSeg[this.nVitimas] = dt;
    this.nVitimas++;
  }

  /** Despeja a exposição acumulada e zera a tabela. */
  despejar(relato, fim) {
    this.tAviso = 0;
    for (let i = 0; i < this.nVitimas; i++) {
      if (this.vitimaSeg[i] <= 0) continue;
      const e = relato.queima();
      e.owner = this.owner;
      e.victim = this.vitimaId[i];
      e.kind = this.kind;
      e.dt = this.vitimaSeg[i];
    }
    this.nVitimas = 0;
    if (fim) this.viva = false;
  }

  /* ------------------------------------------------------------------ o chão */

  /**
   * A frente encostou no chão.
   *
   * UMA cratera por feixe, no quadro em que a frente chega — e as fagulhas
   * continuam saindo enquanto o feixe estiver apoiado. Pulsar a cratera junto
   * com as fagulhas seria vinte buracos no mesmo ponto e o teto de 96 gasto num
   * golpe (`NAMEK.destruction.craterLimit`); e como as crateras se somam no
   * `heightAt`, o resultado nem sequer seria um buraco maior — seria o mesmo
   * buraco, cobrado vinte vezes.
   */
  bater(relato, localId, dt) {
    if (!this.bateu) return;
    if (this.frente < this.alcance - 0.5) return;

    const fx = this.ox + this.dx * this.alcance;
    const fy = this.oy + this.dy * this.alcance;
    const fz = this.oz + this.dz * this.alcance;

    if (!this.reportouChao) {
      this.reportouChao = true;
      if (this.owner === localId) {
        const e = relato.chao();
        e.owner = this.owner;
        e.p.x = fx;
        e.p.y = fy;
        e.p.z = fz;
        e.power = this.info.power;
      }
    }

    /* FAGULHA, NÃO NUVEM. O impacto SUSTENTA: a cada 0,12 s sai um sopro novo, e
       em 2,4 s de feixe isso são vinte sopros no mesmo ponto. Poeira grande ali
       vira uma cortina opaca e quem atirou perde de vista a única coisa que a
       ponta precisa comunicar: ONDE ela acertou. Fagulha pequena, meio segundo
       de vida, quase sem crescer — o ponto continua aceso e legível. */
    this._imp -= dt;
    if (this._imp > 0) return;
    this._imp = 0.12;
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: fx, y: fy, z: fz },
      count: 10,
      color: this.info.cor,
      speed: 26,
      spread: 1,
      size: this.info.hitRadius * 0.06,
      grow: 1.4,
      life: 0.5,
      gravity: NAMEK.fighter.gravity * 0.2,
      drag: 0.6,
      alpha: 1,
      additive: true,
    });
  }

  /** O clarão no instante em que o feixe sai da mão. */
  estourarBoca() {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.ox, y: this.oy, z: this.oz },
      count: 30,
      color: this.info.cor,
      speed: 24,
      spread: 0.55,
      direction: { x: this.dx, y: this.dy, z: this.dz },
      size: this.info.hitRadius * 0.2,
      grow: 2.2,
      life: 0.5,
      gravity: 0,
      drag: 2.2,
      alpha: 1,
      additive: true,
    });
  }

  apagar() {
    this.viva = false;
    this.group.visible = false;
    this.nVitimas = 0;
  }

  dispose() {
    this.scene.remove(this.group);
    // As GEOMETRIAS são do pool e servem os seis feixes — quem as descarta é
    // ele. Aqui morre só o que é próprio deste feixe: os quatro materiais.
    this.nucleo.material.dispose();
    this.casca.material.dispose();
    this.halo.material.dispose();
    this.ponta.material.dispose();
  }
}

/* ============================================================================
   O pool
   ========================================================================== */

export class BeamPool {
  constructor(scene, field, max = MAX_FEIXES) {
    this.scene = scene;
    this.field = field;

    /* UMA geometria de tubo e UMA de bola para todos os feixes que a partida
       vier a ter. Gerar `CylinderGeometry` no disparo custaria três buffers
       novos e um envio para a GPU no exato quadro em que a tela tem mais coisa
       acontecendo — que é o pior momento possível para alocar. */
    const tubo = new THREE.CylinderGeometry(1, BASE_TAPER, 1, 20, 1, true);
    // O cilindro nasce centrado; deslocá-lo meia unidade põe a base na origem,
    // e aí escala em Y = comprimento do feixe, direto.
    tubo.translate(0, 0.5, 0);
    this.geos = { tubo, bola: new THREE.SphereGeometry(1, 16, 12) };

    this.feixes = new Array(max);
    for (let i = 0; i < max; i++) this.feixes[i] = new Feixe(scene, this.geos);
  }

  /** @returns {Feixe|null} */
  disparar(disparo) {
    const S = NAMEK.specials[disparo.kind];
    // Só quem tem dano por segundo é feixe. O roteamento de verdade está em
    // `PowerSystem.spawnSpecial`; isto é a rede de segurança.
    if (!S || S.dps === undefined) return null;
    return pegarVaga(this.feixes).acender(this.field, disparo);
  }

  update(dt, alvos, localId, relato) {
    for (let i = 0; i < this.feixes.length; i++) {
      const f = this.feixes[i];
      if (!f.viva) continue;
      if (f.update(dt, alvos, localId, relato)) f.apagar();
    }
  }

  get count() {
    let n = 0;
    for (let i = 0; i < this.feixes.length; i++) if (this.feixes[i].viva) n++;
    return n;
  }

  clear() {
    for (let i = 0; i < this.feixes.length; i++) this.feixes[i].apagar();
  }

  dispose() {
    for (let i = 0; i < this.feixes.length; i++) this.feixes[i].dispose();
    this.geos.tubo.dispose();
    this.geos.bola.dispose();
  }
}
