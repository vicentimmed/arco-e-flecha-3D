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

     vindo     — sai da linha de árvores e cruza a rampa em direção ao castelo;
     rasante   — escolhe alguém no muro e mergulha; encostou, matou;
     recuando  — volta pelo caminho por onde veio, espera, e vem de novo.

   O RECUO é o coração do desenho. Sem ele o morcego é um projétil teleguiado
   que reaparece: você morre, renasce, morre de novo, e nada do que você faça
   entre as duas mortes importa. Com ele existe uma janela — o bicho está em
   campo, visível, ao alcance do arco e sem poder machucar ninguém — e é nessa
   janela que a resposta cabe. É a mesma lógica da vazante da maré, na escala de
   um bicho só.

   ------------------------------------------------- por que ele VOLTA, e não ronda

   A primeira versão do recuo era uma ÓRBITA em volta do pátio, e ela falhava no
   único trabalho que tinha. Circulando a trinta e quatro metros por cima do
   castelo, o morcego passava a maior parte da janela ATRÁS de quem defende, ou
   em cima da cabeça dele, ou tapado pela menagem: para acertá-lo era preciso
   girar o corpo, achá-lo contra o céu escuro e liderar um alvo que cruza
   lateralmente a dez metros por segundo. A janela existia no relógio e não
   existia na tela.

   Agora ele volta pelo caminho por onde veio — até o meio da rampa, em direção
   ao bosque —, para um instante e vem de frente outra vez. Três coisas saem de
   graça disso: ele fica no MESMO campo de visão em que a horda já está (ninguém
   precisa virar as costas para o portão), ele é um alvo que se afasta e depois
   se aproxima em linha quase reta (a liderança some), e a aproximação frontal é
   um anúncio — dá para vê-lo crescer e decidir gastar a flecha antes de ele
   chegar.

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
export const BAT_STATES = ["vindo", "rasante", "recuando"];

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
    /** Segundos restantes de recuo — teto, para ele nunca ficar preso lá atrás. */
    this.ronda = 0;
    /** Para onde ele está recuando. Escolhido uma vez, ao entrar no estado. */
    this.recuo = null;
    /** Segundos parado no ponto de recuo antes de voltar. */
    this.espera = 0;
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
    if (b.state === "recuando") return this.recuar(b, dt, jogadores);
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
      // Ninguém no muro: recua e pergunta de novo na volta.
      this.iniciarRecuo(b, 0.5);
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
      this.iniciarRecuo(b);
      return;
    }

    const ay = (alvo.y ?? 0) + 1.0;
    this.voarPara(b, alvo.x, ay, alvo.z, B.diveSpeed, dt);

    const d = Math.hypot(b.x - alvo.x, b.y - ay, b.z - alvo.z);
    if (d > B.killRadius) return;

    saida.mortes.push({ playerId: alvo.id, x: b.x, y: b.y, z: b.z });
    /* Depois de matar ele VAI EMBORA pelo caminho por onde veio. Não é
       cortesia: sem isso o morcego ficaria pairando no ponto do abate, e quem
       renascesse na menagem encontraria a mesma coisa esperando no mesmo
       lugar. */
    this.iniciarRecuo(b);
  }

  /**
   * Manda o morcego voltar pelo caminho por onde veio.
   *
   * O ponto é o MEIO da rampa — entre o muro e a linha de árvores —, e a
   * fração é o que o torna útil: mais perto e ele nunca sai do colo de quem
   * defende; mais longe e ele some no bosque, o que transforma a janela em
   * espera. No meio ele fica visível, afastando-se em linha quase reta, que é
   * o alvo mais fácil que um arqueiro pode pedir.
   *
   * O `x` é PRESERVADO com um empurrão para o eixo: ele volta mais ou menos
   * por onde entrou (senão o recuo lê como teletransporte lateral), mas
   * centraliza um pouco para a volta vir de frente para o portão, que é onde
   * todo mundo já está olhando.
   *
   * @param {number} [escala] fração do recuo padrão. Meio recuo quando ele nem
   *   chegou a mergulhar — não custou nada a ninguém, não merece a janela cheia.
   */
  iniciarRecuo(b, escala = 1) {
    const B = CONFIG.modes.siege.bats;
    b.state = "recuando";
    b.alvo = null;
    const frac = B.retreatFrac * escala;
    const z = CASTLE.wallZOut + (B.spawnZ - CASTLE.wallZOut) * frac;
    b.recuo = {
      x: b.x * 0.55,
      y: (this.terrain?.heightAt(b.x * 0.55, z) ?? GROUND_Y) + B.circleHeight,
      z,
    };
    b.espera = B.loiter;
    /* Teto de segurança. O recuo termina por CHEGADA, não por relógio — mas um
       bicho que erra o ponto (empurrado por um mergulho longo, por exemplo) não
       pode ficar preso lá atrás pelo resto da partida. */
    b.ronda = B.circleTime * escala + 6;
  }

  /**
   * O RECUO. Ele volta, espera, e vem de novo.
   *
   * Duas fases num estado só, e o que as separa é a chegada ao ponto. Enquanto
   * não chegou, voa para lá; chegando, o relógio de `espera` corre com ele
   * praticamente parado — é o instante em que o alvo fica mais fácil de todos,
   * e é de propósito que ele exista.
   */
  recuar(b, dt, jogadores) {
    const B = CONFIG.modes.siege.bats;
    b.ronda -= dt;

    const alvo = b.recuo;
    if (!alvo) {
      this.iniciarRecuo(b);
      return;
    }

    const d = Math.hypot(b.x - alvo.x, b.z - alvo.z);
    if (d > 6 && b.ronda > 0) {
      this.voarPara(b, alvo.x, alvo.y, alvo.z, B.circleSpeed, dt);
      return;
    }

    /* Chegou: paira. `voarPara` sempre anda para a frente (é o que dá sentido à
       viragem limitada), então "parar" aqui é dar uma volta curta em torno do
       ponto — o bicho continua batendo asa, o que é o certo, e não sai do lugar
       em que o arqueiro já o encontrou. */
    b.espera -= dt;
    if (b.espera > 0) {
      b.ang = (b.ang ?? 0) + dt * 0.9;
      this.voarPara(
        b,
        alvo.x + Math.cos(b.ang) * 7,
        alvo.y,
        alvo.z + Math.sin(b.ang) * 7,
        B.circleSpeed * 0.55,
        dt,
      );
      return;
    }

    // E vem de novo, de frente. `vindo` já sabe cruzar a rampa e escolher presa.
    b.state = "vindo";
    b.recuo = null;
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
