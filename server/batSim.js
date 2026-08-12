/* ---------------------------------------------------------------------------
   OS MORCEGOS GIGANTES, no servidor.

   Eles são a terceira ameaça do cerco que não vem pela rampa — depois do
   escalador (que sobe a pedra) e do mago (que atira do mirante) — e a única que
   chega POR CIMA. Isso não é variedade por variedade: o adarve é um corredor de
   cinco metros e meio com o campo de tiro todo para um lado, e um jogador que
   só precisa vigiar um plano acaba jogando com metade da atenção. O morcego é a
   coisa que obriga a levantar a cabeça.

   ------------------------------------------------------------- por que aqui

   Eles NÃO entram no quadro binário do cerco (`Siege.packFrame`), e a razão é
   de formato, não de gosto: aquele quadro tem 3 bits para a espécie e as oito
   já estão ocupadas. Aumentá-lo custaria um byte por sitiante em 120 sitiantes
   a 10 Hz — 1,2 KB/s por cliente — para acomodar quatro bichos.

   Quatro bichos em JSON custam 240 B por quadro. É o mesmo cálculo que decidiu
   o inverso lá: cada formato serve à sua ordem de grandeza. Ver o cabeçalho de
   `siegeSim.js` para a conta completa.

   ------------------------------------------------------------------ o ciclo

   Três estados, e o terceiro é o que o torna um bicho em vez de um míssil:

     vindo    — sai da linha de árvores e cruza a rampa em direção ao castelo;
     rasante  — escolhe alguém no muro e mergulha; encostou, matou;
     rondando — circula o castelo por uns segundos antes de tentar de novo.

   A RONDA é o coração do desenho. Sem ela o morcego é um projétil teleguiado
   que reaparece: você morre, renasce, morre de novo, e nada do que você faça
   entre as duas mortes importa. Com ela existe uma janela — ele está lá em
   cima, visível, ao alcance do arco e sem poder machucar ninguém — e é nessa
   janela que a resposta cabe. É a mesma lógica da vazante da maré, na escala de
   um bicho só.

   Este módulo é PURO (só `CONFIG` e o campo de altura), como `meteorSim` e
   `siegeSim`, e por isso roda num script de bancada sem cliente nenhum.
   --------------------------------------------------------------------------- */

import { CONFIG } from "../src/config.js";
import { CASTLE, GROUND_Y, WALL_TOP } from "../src/shared/castleProps.js";

let proximoId = 1;

const TAU = Math.PI * 2;
const r2 = (v) => Math.round(v * 100) / 100;
const faixa = (a, b) => a + Math.random() * (b - a);

/** A ordem É o código do estado na rede. Nunca reordenar. */
export const BAT_STATES = ["vindo", "rasante", "rondando"];

export class Bat {
  constructor(x, y, z) {
    this.id = proximoId++;
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = Math.PI;
    this.state = "vindo";
    this.dead = false;
    /** Quem ele está caçando agora (id), ou null. */
    this.alvo = null;
    /** Segundos restantes de ronda. */
    this.ronda = 0;
    /** Ângulo na órbita da ronda. */
    this.ang = Math.random() * TAU;
    this.giro = Math.random() < 0.5 ? 1 : -1;
    /** Prazo do rasante: um mergulho que não conecta não dura para sempre. */
    this.mergulho = 0;
    /** Fase do bater de asas — é o cliente que desenha, mas a fase é daqui
        para as quatro asas não baterem em uníssono na tela. */
    this.fase = Math.random() * TAU;
  }
}

export class BatSwarm {
  constructor(terrain) {
    this.terrain = terrain;
    /** @type {Bat[]} */
    this.bats = [];
    this.ativo = false;
    this.espera = 0;
  }

  setTerrain(terrain) {
    this.terrain = terrain;
  }

  get vivos() {
    let n = 0;
    for (const b of this.bats) if (!b.dead) n++;
    return n;
  }

  start() {
    const B = CONFIG.modes.siege.bats;
    this.ativo = true;
    this.bats = [];
    /* Eles NÃO estão em campo no primeiro segundo. A abertura do cerco já é a
       coluna saindo do bosque, e um morcego cruzando o quadro por cima disso
       rouba a única imagem que a abertura tem. `firstAt` é tempo de partida, o
       mesmo relógio dos escalões. */
    this.espera = B.firstAt;
  }

  stop() {
    this.ativo = false;
    this.bats = [];
    this.espera = 0;
  }

  /** Onde eles nascem: alto, no fundo da rampa, sobre a linha de árvores. */
  nascer() {
    const B = CONFIG.modes.siege.bats;
    const x = faixa(-B.spawnHalfX, B.spawnHalfX);
    const z = B.spawnZ + faixa(-8, 8);
    const y = (this.terrain?.heightAt(x, z) ?? 0) + faixa(B.cruiseYMin, B.cruiseYMax);
    const b = new Bat(x, y, z);
    this.bats.push(b);
    return b;
  }

  /**
   * Um passo do bando.
   *
   * @param {number} dt
   * @param {Array<{id,x,y,z,alive}>} jogadores quem tem corpo em campo
   * @returns {{mortes:Array<{playerId:number, x:number, y:number, z:number}>}}
   */
  update(dt, jogadores, tempoDePartida) {
    const saida = { mortes: [] };
    if (!this.ativo) return saida;

    const B = CONFIG.modes.siege.bats;
    if (tempoDePartida < this.espera) return saida;

    // Reposição: o bando tem um tamanho, e ele se recompõe com calma.
    this._repor = (this._repor ?? 0) - dt;
    if (this.vivos < B.count && this._repor <= 0) {
      this._repor = B.respawn;
      this.nascer();
    }

    for (const b of this.bats) {
      if (b.dead) continue;
      this.passo(b, dt, jogadores, saida);
    }
    // Morcego morto não vira cadáver: ele cai fora da lista e o cliente o
    // estoura pelo evento. É a mesma economia da rocha da chuva.
    this.bats = this.bats.filter((b) => !b.dead);
    return saida;
  }

  passo(b, dt, jogadores, saida) {
    const B = CONFIG.modes.siege.bats;
    if (b.state === "rondando") return this.rondar(b, dt, jogadores);
    if (b.state === "rasante") return this.rasar(b, dt, jogadores, saida);

    /* VINDO: cruza a rampa em direção ao castelo, na altura de cruzeiro. Ele só
       escolhe vítima ao chegar perto — de noventa metros ninguém escolhe nada,
       e um morcego que já sai da floresta travado numa pessoa lê como um
       míssil com asas. */
    const alvoZ = CASTLE.wallZOut + 18;
    this.voarPara(b, 0, b.y, alvoZ, B.cruiseSpeed, dt);
    if (b.z <= alvoZ + 6) this.escolherPresa(b, jogadores);
  }

  /**
   * Escolhe quem levar o rasante.
   *
   * SÓ QUEM ESTÁ NO MURO. Quem está no pátio está sob o adarve, e um mergulho
   * ali termina dentro da alvenaria — o morcego atravessaria pedra na frente de
   * todo mundo. É a mesma restrição do mago, pelo mesmo motivo: a ameaça tem de
   * vir de onde a vítima consegue olhar.
   */
  escolherPresa(b, jogadores) {
    const B = CONFIG.modes.siege.bats;
    let melhor = null;
    let melhorD = Infinity;
    for (const p of jogadores) {
      if (p.alive === false) continue;
      if ((p.y ?? 0) < WALL_TOP - 3) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < melhorD) {
        melhorD = d;
        melhor = p;
      }
    }
    if (!melhor) {
      // Ninguém no muro: dá uma volta e pergunta de novo.
      b.state = "rondando";
      b.ronda = B.circleTime * 0.5;
      return;
    }
    b.alvo = melhor.id;
    b.state = "rasante";
    b.mergulho = B.diveTimeout;
  }

  /**
   * O RASANTE. Ele mergulha na pessoa, e encostar mata.
   *
   * O alvo é reconsultado a cada passo — ele persegue, não vai a um ponto. O
   * que impede isso de ser injusto é o PRAZO: `diveTimeout` segundos e o
   * mergulho acaba, tenha conectado ou não. Quem se mexeu, escapou; e escapar
   * é a coisa que o jogador precisa poder fazer com o corpo, não com a sorte.
   */
  rasar(b, dt, jogadores, saida) {
    const B = CONFIG.modes.siege.bats;
    const alvo = jogadores.find((p) => p.id === b.alvo && p.alive !== false);
    b.mergulho -= dt;
    if (!alvo || b.mergulho <= 0) {
      b.state = "rondando";
      b.ronda = B.circleTime;
      b.alvo = null;
      return;
    }

    const ay = (alvo.y ?? 0) + 1.0;
    this.voarPara(b, alvo.x, ay, alvo.z, B.diveSpeed, dt);

    const d = Math.hypot(b.x - alvo.x, b.y - ay, b.z - alvo.z);
    if (d > B.killRadius) return;

    saida.mortes.push({ playerId: alvo.id, x: b.x, y: b.y, z: b.z });
    /* Depois de matar ele SOBE e ronda. A subida não é enfeite: sem ela o
       morcego ficaria pairando no ponto do abate, e quem renascesse na menagem
       encontraria a mesma coisa esperando no mesmo lugar. */
    b.state = "rondando";
    b.ronda = B.circleTime;
    b.alvo = null;
  }

  /**
   * A RONDA. Ele circula o castelo, alto, até tentar de novo.
   *
   * A órbita é em torno do PÁTIO e não do portão: dá a volta inteira no
   * conjunto, passa por cima da menagem e volta pela rampa. É a trajetória que
   * o mantém em campo de visão de quem está no muro durante quase todo o
   * intervalo — que é o que faz a janela ser aproveitável.
   */
  rondar(b, dt, jogadores) {
    const B = CONFIG.modes.siege.bats;
    b.ronda -= dt;
    b.ang += (b.giro * B.circleSpeed * dt) / B.circleRadius;

    const cx = 0;
    const cz = (CASTLE.courtZBack + CASTLE.wallZOut) / 2;
    const tx = cx + Math.cos(b.ang) * B.circleRadius;
    const tz = cz + Math.sin(b.ang) * B.circleRadius;
    const ty = GROUND_Y + B.circleHeight;
    this.voarPara(b, tx, ty, tz, B.circleSpeed, dt);

    if (b.ronda > 0) return;
    this.escolherPresa(b, jogadores);
  }

  /**
   * Um passo de voo em direção a um ponto.
   *
   * Direção com VIRAGEM LIMITADA, e não teleporte de rumo: um morcego que muda
   * de direção instantaneamente lê como um cursor. `turnRate` é o que dá o arco
   * largo do bicho grande — e é ele que produz, de graça, o momento em que o
   * mergulho erra por pouco e ele tem de dar a volta.
   */
  voarPara(b, tx, ty, tz, vel, dt) {
    const B = CONFIG.modes.siege.bats;
    let dx = tx - b.x;
    let dy = ty - b.y;
    let dz = tz - b.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    dx /= d;
    dy /= d;
    dz /= d;

    const desejado = Math.atan2(dx, dz);
    let delta = desejado - b.yaw;
    while (delta > Math.PI) delta -= TAU;
    while (delta < -Math.PI) delta += TAU;
    const maxGiro = B.turnRate * dt;
    b.yaw += Math.max(-maxGiro, Math.min(maxGiro, delta));
    /* ENROLADO em [−π, π]. Ele é transmitido a 10 Hz durante dez minutos, e um
       ângulo que só cresce chega a milhares de radianos: a rotação continuaria
       certa (é modular), mas o número perderia precisão no arredondamento de
       duas casas justamente quando ficasse grande. */
    if (b.yaw > Math.PI) b.yaw -= TAU;
    else if (b.yaw < -Math.PI) b.yaw += TAU;

    // Anda NA DIREÇÃO EM QUE ESTÁ VIRADO, no plano; a subida é livre. É o que
    // faz a viragem limitada significar alguma coisa.
    const passo = vel * dt;
    b.x += Math.sin(b.yaw) * passo;
    b.z += Math.cos(b.yaw) * passo;
    b.y += Math.max(-passo, Math.min(passo, dy * passo * 1.6));

    // Nunca abaixo do chão nem colado nele: ele voa, e um morcego arrastando a
    // barriga no regolito seria um bicho quebrado.
    const chao = (this.terrain?.heightAt(b.x, b.z) ?? 0) + 1.2;
    if (b.y < chao) b.y = chao;
    b.fase += dt * B.flap;
  }

  byId(id) {
    return this.bats.find((b) => b.id === id && !b.dead) ?? null;
  }

  /** Uma flecha entrou. Um acerto basta — ver `CONFIG.modes.siege.bats`. */
  hit(id) {
    const b = this.byId(id);
    if (!b) return null;
    b.dead = true;
    return b;
  }

  view() {
    return this.bats
      .filter((b) => !b.dead)
      .map((b) => ({
        i: b.id,
        p: [r2(b.x), r2(b.y), r2(b.z)],
        y: r2(b.yaw),
        s: BAT_STATES.indexOf(b.state),
      }));
  }
}
