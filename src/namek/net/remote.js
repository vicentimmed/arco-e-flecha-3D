/* ---------------------------------------------------------------------------
   Os outros lutadores.

   Mesma ideia central do arqueiro (`src/net/remotePlayers.js`), e ela continua
   sendo a única que funciona: **o mundo dos outros é desenhado 100 ms no
   passado.** As poses chegam 20 vezes por segundo com jitter; desenhar cada
   pacote assim que cai produz teleporte, extrapolar produz boneco que entra na
   montanha e volta. Atrasando o relógio, a qualquer instante já existem duas
   amostras cercando o tempo desejado e o que se desenha é a interpolação entre
   elas.

   ------------------------------------------------- o que muda aqui: VELOCIDADE

   No vale um arqueiro anda a 5 m/s e corre a 8. Aqui um lutador cruza a arena a
   64 m/s no arranque de ki — mais de doze vezes mais rápido. Isso quebra o
   interpolador do arqueiro em dois pontos, e os dois estão consertados abaixo:

   • **Um buraco de rede de 150 ms custa quase dez metros.** A interpolação pura
     congelaria o alvo no ar durante o buraco e o teleportaria ao voltar. Por
     isso a amostra carrega a VELOCIDADE (`v` em `packFighter`) e o remoto
     extrapola por ela dentro de uma janela curta — é a diferença entre um
     adversário que "desliza" e um que pisca.

   • **Extrapolar demais é pior que engasgar.** Se a janela fosse generosa, um
     lutador que freia de 64 m/s para zero seria desenhado dez metros à
     frente de onde parou, e o tiro que você acertou nele erraria. Daí
     `EXTRAPOLACAO_MAX` ser curta e a extrapolação DESACELERAR conforme
     envelhece, em vez de manter a velocidade cheia.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../shared/namek/config.js";
import { unpackFighter } from "../../shared/namek/protocol.js";
import { Fighter } from "../character/index.js";

const TAU = Math.PI * 2;

/** ms — quanto se aceita adivinhar além da última amostra. Ver o cabeçalho. */
const EXTRAPOLACAO_MAX = 130;

/** Ângulos pelo caminho curto: sem isso o boneco gira 350° para virar 10°. */
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * t;
}

const lerp = (a, b, t) => a + (b - a) * t;

class RemoteFighter {
  constructor(parent, info) {
    this.id = info.id;
    this.name = info.name ?? "Lutador";
    this.color = info.color ?? 0xff7a1a;
    /** É de CPU? A sala diz no `roster`; o menu conta para saber o que oferecer. */
    this.isBot = info.isBot === true;

    this.fighter = new Fighter(parent, this.color, false);
    this.fighter.displayName = this.name;

    /** Amostras `{t, ...pose}` em ordem, para interpolar. */
    this.buffer = [];
    /** Vida e ki chegam num canal próprio, a 10 Hz. */
    this.health = NAMEK.fighter.maxHealth;
    this.ki = NAMEK.ki.max;
    this.down = false;
    this.invulnUntil = 0;

    /* A pose desenhada neste quadro. Um objeto SÓ, reaproveitado: com 14
       remotos a 60 Hz, alocar a pose por quadro são 840 objetos por segundo
       para o coletor recolher — exatamente o tipo de lixo que produz o engasgo
       periódico que ninguém consegue reproduzir. */
    this.pose = {
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0, roll: 0,
      gaitPhase: 0, runBlend: 0, flyBlend: 0,
      boostBlend: 0, chargeBlend: 0,
      specialFraction: 0, specialIndex: -1,
      hurtBlend: 0, lastHand: 0, handPose: 0,
      down: false, invuln: false, tonto: false, defendendo: false,
      /** Super Saiyajin — o bit 16 da pose. Ver `packFighter`. */
      ssj: false,
    };
  }

  /** Está em Super Saiyajin? Atalho para quem só quer a pergunta — o laço, ao
   *  escolher a cor de uma rajada alheia e o teto da barra de vida do alvo. */
  get ssj() {
    return this.pose.ssj === true;
  }

  /** Uma pose recebida, carimbada com o instante em que o dono a capturou. */
  pushSample(time, state) {
    const ultima = this.buffer[this.buffer.length - 1];
    /* O buffer precisa estar em ordem para a busca por par funcionar. Uma pose
       mais velha que a última é repetição ou atraso — nos dois casos ela já não
       tem o que acrescentar. */
    if (ultima && time <= ultima.t) return;

    const amostra = unpackFighter(state, {});
    amostra.t = time;
    this.buffer.push(amostra);

    /* Segura pouco mais que o atraso de interpolação. O buffer é uma janela,
       não um histórico: guardar mais só adiaria a memória do coletor. */
    const corte = time - (NAMEK.net.interpDelay * 1000 + 400);
    while (this.buffer.length > 2 && this.buffer[0].t < corte) this.buffer.shift();
  }

  /**
   * Escreve `this.pose` para o instante pedido.
   *
   * @param {number} tempoAlvo instante do relógio da SALA a desenhar
   */
  amostrar(tempoAlvo) {
    const buf = this.buffer;
    const p = this.pose;
    if (!buf.length) return false;

    /* Antes da primeira amostra (acabou de entrar): congela na mais velha. Não
       há o que interpolar, e adivinhar para trás poria o corpo num lugar em que
       ele nunca esteve. */
    if (tempoAlvo <= buf[0].t) {
      copiarPose(buf[0], p);
      return true;
    }

    for (let i = buf.length - 1; i > 0; i--) {
      const b = buf[i];
      const a = buf[i - 1];
      if (tempoAlvo >= a.t && tempoAlvo <= b.t) {
        const t = (tempoAlvo - a.t) / (b.t - a.t || 1);
        interpolarPose(a, b, t, p);
        return true;
      }
    }

    /* DEPOIS da última: extrapola pela velocidade, dentro da janela curta. Ver
       o cabeçalho — é o que impede o lutador a 64 m/s de congelar no ar num
       buraco de rede. */
    const ultima = buf[buf.length - 1];
    const atraso = Math.min(EXTRAPOLACAO_MAX, tempoAlvo - ultima.t) / 1000;
    copiarPose(ultima, p);
    if (atraso > 0) {
      /* DESACELERANDO: `atraso²/2` no lugar de `atraso` seria queda livre; o
         que se usa é a velocidade cheia amortecida por um fator que cai com o
         tempo de adivinhação. No limite da janela ele já anda a 60 % — o
         suficiente para não travar, pouco o bastante para não ultrapassar a
         freada. */
      const f = atraso * (1 - 0.4 * (atraso / (EXTRAPOLACAO_MAX / 1000)));
      p.x += ultima.vx * f;
      p.y += ultima.vy * f;
      p.z += ultima.vz * f;
    }
    return true;
  }
}

function copiarPose(a, out) {
  out.x = a.x; out.y = a.y; out.z = a.z;
  out.vx = a.vx; out.vy = a.vy; out.vz = a.vz;
  out.yaw = a.yaw; out.pitch = a.pitch; out.roll = a.roll;
  out.gaitPhase = a.gaitPhase; out.runBlend = a.runBlend;
  out.flyBlend = a.flyBlend; out.boostBlend = a.boostBlend;
  out.chargeBlend = a.chargeBlend;
  out.specialFraction = a.specialFraction; out.specialIndex = a.specialIndex;
  out.hurtBlend = a.hurtBlend; out.lastHand = a.lastHand; out.handPose = a.handPose;
  out.down = a.down; out.invuln = a.invuln;
  out.tonto = a.tonto; out.defendendo = a.defendendo;
  out.ssj = a.ssj;
}

function interpolarPose(a, b, t, out) {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  out.vx = lerp(a.vx, b.vx, t);
  out.vy = lerp(a.vy, b.vy, t);
  out.vz = lerp(a.vz, b.vz, t);
  out.yaw = lerpAngle(a.yaw, b.yaw, t);
  out.pitch = lerpAngle(a.pitch, b.pitch, t);
  out.roll = lerpAngle(a.roll, b.roll, t);
  /* A FASE DA MARCHA também é um ângulo, e tratá-la como número foi o bug
     clássico deste tipo de código: ela dá a volta em 2π, e um `lerp` reto faz
     as pernas correrem para trás em altíssima velocidade toda vez que ela
     passa do fim para o começo. */
  out.gaitPhase = lerpAngle(a.gaitPhase, b.gaitPhase, t);
  out.runBlend = lerp(a.runBlend, b.runBlend, t);
  out.flyBlend = lerp(a.flyBlend, b.flyBlend, t);
  out.boostBlend = lerp(a.boostBlend, b.boostBlend, t);
  out.chargeBlend = lerp(a.chargeBlend, b.chargeBlend, t);
  out.specialFraction = lerp(a.specialFraction, b.specialFraction, t);
  out.hurtBlend = lerp(a.hurtBlend, b.hurtBlend, t);
  out.handPose = lerp(a.handPose, b.handPose, t);
  /* Discretos: NÃO se interpolam. Qual especial e qual mão são escolhas, não
     grandezas — meio caminho entre o Kamehameha e a Genki Dama não existe, e
     `lerp(0, 1, 0.5)` na mão daria um braço meio estendido de cada lado. Vale o
     valor da amostra mais NOVA, porque é a decisão mais recente. */
  out.specialIndex = b.specialIndex;
  out.lastHand = b.lastHand;
  out.down = b.down;
  out.invuln = b.invuln;
  /* Caído e defendendo também são DISCRETOS, e pela mesma razão dos vizinhos:
     não existe meio corpo no chão nem meia guarda de pé. O valor é o da amostra
     mais nova, porque é a decisão mais recente — e porque atrasar a guarda em
     meio quadro faria o adversário aparecer aparando o golpe que já passou. */
  out.tonto = b.tonto;
  out.defendendo = b.defendendo;
  /* E o Super Saiyajin, pela mesma razão: não existe meio transformado. O valor
     é o da amostra mais nova — atrasar o ouro em meio quadro faria o cabelo
     mudar de cor depois do golpe dourado que já saiu da mão. */
  out.ssj = b.ssj;
}

/* ------------------------------------------------------------- a coleção --- */

export class RemoteFighters {
  /**
   * @param {THREE.Scene|THREE.Group} parent onde os corpos são pendurados
   * @param {() => number} relogioSala função que devolve o tempo da sala em ms
   */
  constructor(parent, relogioSala) {
    this.parent = parent;
    this.relogioSala = relogioSala;
    /** @type {Map<number, RemoteFighter>} */
    this.byId = new Map();
    /* A lista de alvos que os poderes testam, e o BANCO de registros dela.
     *
     * O array era reaproveitado e os objetos dentro dele não: `push({...})` por
     * remoto por quadro são ~14 literais, ~840 por segundo, exatamente o tipo de
     * lixo que produz o engasgo periódico que ninguém consegue reproduzir. O
     * banco cresce até o tamanho da maior sala e para de crescer para sempre. */
    this._alvos = [];
    this._banco = [];
  }

  add(info) {
    if (this.byId.has(info.id)) return this.byId.get(info.id);
    const r = new RemoteFighter(this.parent, info);
    this.byId.set(info.id, r);

    /* O QUE VEIO NO ROSTER É APROVEITADO, e antes era jogado fora.
     *
     * A sala manda `state`, `health` e `ki` de cada um junto do nome e da cor, e
     * ler só os três primeiros custava dois defeitos visíveis a quem entra no
     * meio da partida: todo mundo com a barra cheia até o primeiro `VITALS`
     * (100 ms depois), e — pior — todo mundo AMONTOADO NA ORIGEM DO MUNDO até a
     * primeira pose de 20 Hz chegar, porque sem amostra nenhuma o interpolador
     * não tem o que desenhar. */
    if (Number.isFinite(info.health)) r.health = info.health;
    if (Number.isFinite(info.ki)) r.ki = info.ki;
    if (info.state) r.pushSample(info.state.w ?? 0, info.state);

    return r;
  }

  remove(id) {
    const r = this.byId.get(id);
    if (!r) return;
    r.fighter.dispose();
    this.byId.delete(id);
  }

  get(id) {
    return this.byId.get(id) ?? null;
  }

  /**
   * Reconcilia a coleção com a lista COMPLETA que a sala manda.
   *
   * Contra o histórico de `join`/`leave`, e pelo motivo que o arqueiro já
   * documenta em `S2C.MODE`: um `leave` perdido numa reconexão deixa um corpo
   * parado no cenário para sempre, e um `join` perdido deixa um adversário
   * invisível que mata. A lista inteira não tem esse problema.
   */
  reconcile(lista) {
    const vistos = new Set();
    for (const info of lista ?? []) {
      vistos.add(info.id);
      const r = this.add(info);
      if (info.name) r.name = info.name;
      if (info.color !== undefined && info.color !== r.color) {
        r.color = info.color;
        r.fighter.setColor(info.color);
      }
    }
    for (const id of [...this.byId.keys()]) {
      if (!vistos.has(id)) this.remove(id);
    }
  }

  /**
   * Poses recebidas em lote (`NS2C.STATES`).
   *
   * A entrada JÁ É a pose — os campos de `packFighter` vêm achatados ao lado do
   * `id`, não aninhados. Ver o comentário de `NS2C.STATES` no protocolo, que
   * existe por causa de exatamente este trecho.
   *
   * O carimbo preferido é o `w` da própria entrada e não o `time` do lote:
   * quando a sala reencaminha a pose de um humano, ela vale do instante em que
   * o dono a capturou, não do instante em que o pacote saiu. Usar o do lote
   * jogaria todas as poses do quadro para a frente no tempo e o interpolador
   * passaria a comparar amostras que não são contemporâneas.
   */
  applyStates(msg) {
    for (const entrada of msg.s ?? []) {
      this.byId.get(entrada.id)?.pushSample(entrada.w ?? msg.time, entrada);
    }
  }

  /** Vida e ki em lote (`NS2C.VITALS`): `[[id, health, ki], ...]`. */
  applyVitals(msg) {
    for (const [id, health, ki] of msg.h ?? []) {
      const r = this.byId.get(id);
      if (!r) continue;
      r.health = health;
      r.ki = ki;
    }
  }

  update(dt, cameraPos) {
    const alvo = this.relogioSala() - NAMEK.net.interpDelay * 1000;
    for (const r of this.byId.values()) {
      if (!r.amostrar(alvo)) continue;
      const p = r.pose;
      const f = r.fighter;
      f.position.x = p.x; f.position.y = p.y; f.position.z = p.z;
      f.velocity.x = p.vx; f.velocity.y = p.vy; f.velocity.z = p.vz;
      f.yaw = p.yaw; f.pitch = p.pitch; f.roll = p.roll;
      f.gaitPhase = p.gaitPhase;
      f.runBlend = p.runBlend;
      f.flyBlend = p.flyBlend;
      f.boostBlend = p.boostBlend;
      f.chargeBlend = p.chargeBlend;
      f.specialFraction = p.specialFraction;
      f.specialIndex = p.specialIndex;
      f.hurtBlend = p.hurtBlend;
      f.lastHand = p.lastHand;
      f.handPose = p.handPose;
      f.down = p.down;
      f.invuln = p.invuln;
      f.tonto = p.tonto;
      f.defendendo = p.defendendo;
      /* O SUPER SAIYAJIN vem da POSE (bit 16) e não do `VITALS`, ao contrário do
         `kiFull` logo abaixo, e a diferença é a mesma que separa o caído e o
         defendendo do ki cheio: o ouro muda no meio de uma briga e precisa
         chegar no ritmo dela, não a 10 Hz. É ele que sustenta o cabelo, a aura e
         a cor dos poderes de um adversário transformado — inclusive na tela de
         quem entrou na sala depois do grito dele, e que por isso nunca viu o
         `NS2C.SSJ_ON`. */
      f.ssj = p.ssj;
      /* A aura de barra cheia dos OUTROS sai do `VITALS`, não da pose: o ki de
         cada um já viaja lá a 10 Hz (`applyVitals`), e um canal a mais na pose
         seria pagar 20 Hz por um booleano que muda uma vez por briga. Ver
         `Fighter.kiFull` — é a leitura de quem está pronto para o especial, e a
         informação mais útil que se pode dar sobre um adversário.

         (Caído e defendendo vêm da POSE, logo acima, e a diferença é a
         frequência: os dois mudam no meio de uma troca de golpes e precisam
         chegar no ritmo dela, não a 10 Hz.) */
      /* O limiar acompanha o Super Saiyajin: quem está transformado solta um
         especial com um terço da barra, e a aura de prontidão dele tem de
         acender aí — senão ela mentiria para quem estivesse decidindo se dá
         para chegar perto. Ver `NAMEK.ssj.limiar`. */
      const limiar = p.ssj ? NAMEK.ssj.limiar : NAMEK.ki.specialThreshold;
      f.kiFull = r.ki >= NAMEK.ki.max * limiar - 1e-3;
      f.update(dt, cameraPos);
    }
  }

  /**
   * Quem pode ser atingido, para o sistema de poderes.
   *
   * O array e os objetos dentro dele são reaproveitados entre quadros — ver o
   * comentário de `_alvos`. Quem chama pode LER à vontade e não deve guardar a
   * referência de um quadro para o outro.
   */
  alvos(incluirCaidos = false) {
    const lista = this._alvos;
    lista.length = 0;
    for (const r of this.byId.values()) {
      if (r.down && !incluirCaidos) continue;
      const p = r.pose;
      const n = lista.length;
      // Um registro por posição da lista, criado na primeira vez e reescrito
      // para sempre. Ver `_banco`.
      let alvo = this._banco[n];
      if (!alvo) {
        alvo = this._banco[n] = {
          id: 0, x: 0, y: 0, z: 0,
          raio: NAMEK.fighter.radius,
          altura: NAMEK.fighter.height,
          vivo: true, invuln: false,
        };
      }
      alvo.id = r.id;
      alvo.x = p.x;
      alvo.y = p.y;
      alvo.z = p.z;
      alvo.vivo = !r.down;
      alvo.invuln = p.invuln;
      lista.push(alvo);
    }
    return lista;
  }

  clear() {
    for (const r of this.byId.values()) r.fighter.dispose();
    this.byId.clear();
  }

  dispose() {
    this.clear();
  }
}
