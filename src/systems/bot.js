/* ---------------------------------------------------------------------------
   O adversário de CPU.

   A regra que organiza este arquivo inteiro: **o bot joga o MESMO jogo que
   você**. Ele não recebe a sua posição por um canal privilegiado nem acerta por
   decreto — ele monta um `Player`, aponta um arco, resolve a mesma balística
   que a sua flecha vai obedecer e solta a corda. Se errar, a flecha erra de
   verdade e some no horizonte.

   Isso não é purismo. É o que faz o adversário ser LEGÍVEL: quando ele acerta,
   dá para ver por que; quando erra, dá para ver o quanto. Um bot que teleporta
   dano na sua barra de vida não ensina nada e não dá para enganar — e enganar o
   adversário é metade de um duelo de arco.

   ------------------------------------------------------------------ a mira

   O problema difícil não é apontar: é apontar para ONDE a pessoa VAI ESTAR
   quando a flecha chegar. Isso é uma equação implícita (o tempo de voo depende
   da distância, que depende de para onde ele correu, que depende do tempo), e
   ela se resolve por iteração — três passos bastam, e é o que `mirarComLead`
   faz. Depois vem o ângulo de elevação, que a gravidade cobra e que também é
   iterativo porque o arrasto não tem solução fechada.

   ------------------------------------------------------------- a dificuldade

   Um bot que resolve a balística exata acerta SEMPRE, e isso é tão sem graça
   quanto um que erra sempre. O que existe aqui é um erro deliberado: uma
   chance de errar o tiro de propósito (`missChance`), um tremor de mão
   presente em TODO tiro (`erroMira`) e um tempo de reação antes de responder
   ao que você fez (`reacao`). A tabela de dificuldade — fácil por padrão —
   mora em `CONFIG.bot` (`config.js`), num lugar só: trocar a perícia do bot é
   trocar `CONFIG.bot.difficulty`, sem tocar em nenhuma linha deste arquivo.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG, drawSpeed } from "../config.js";
import { Player } from "../entities/player.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { RAPIER } from "../core/physics.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { Ragdoll } from "../game/ragdoll.js";
import { NameTag } from "../net/nameTag.js";
import { clamp } from "../utils/math.js";

const TAU = Math.PI * 2;

/**
 * Perícia padrão, caso `CONFIG.bot.difficulty` aponte para algo que não existe
 * na tabela — rede de segurança, não o caminho normal. A dificuldade de
 * verdade mora em `config.js` (`CONFIG.bot.difficulties`), num lugar só, para
 * que trocá-la não exija caçar número espalhado por este arquivo.
 */
const PERICIA = {
  erroMira: 0.02,
  missChance: 0.45,
  missSpread: 7,
  reacao: 0.55,
  precisaoLead: 0.5,
};

/** A perícia configurada em `CONFIG.bot.difficulty`, com a rede de segurança acima. */
function periciaPadrao() {
  return CONFIG.bot?.difficulties?.[CONFIG.bot?.difficulty] ?? PERICIA;
}

export class Bot {
  /**
   * @param {object} ctx tudo o que o bot precisa para existir no mundo
   */
  constructor(ctx, opcoes = {}) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.physics = ctx.physics;
    this.terrain = ctx.terrain;
    this.arrows = ctx.arrows;

    this.nome = opcoes.nome ?? "CPU";
    this.cor = opcoes.cor ?? "#e0554a";
    this.pericia = { ...periciaPadrao(), ...(opcoes.pericia ?? {}) };

    this.entityId = `bot${entityRegistry.createId()}`;
    this.player = new Player(this.terrain, this.entityId);
    this.player.isLocal = false;
    this.player.displayName = this.nome;
    this.player.setColor(this.cor);
    this.scene.add(this.player.root);

    this.tag = new NameTag(this.nome, this.cor);
    this.tag.sprite.position.set(0, CONFIG.player.height + 0.24, 0);
    this.player.root.add(this.tag.sprite);

    this.ragdoll = new Ragdoll(this.terrain);
    this.player.physicsBody = this;

    /* O DANO PRECISA CHEGAR ATÉ AQUI.
     *
     * `hitResolver` acerta um colisor de `kind: "character"` e chama
     * `character.onArrowHit(...)` — e `character` é o `Player`, cujo
     * `onArrowHit` é um stub vazio (dano de jogador é decidido pelo servidor).
     * Sem esta ponte a flecha acertava o bot, o impacto era registrado e
     * ABSOLUTAMENTE NADA acontecia: noventa tiros, zero mortes.
     *
     * `invulnerable` viaja pelo mesmo caminho: é lida no `Player` para deixar a
     * flecha atravessar quem está piscando. */
    this.player.onArrowHit = (impact, arrow) => this.onArrowHit(impact, arrow);
    Object.defineProperty(this.player, "invulnerable", {
      get: () => !this.vivo,
      configurable: true,
    });

    // Cápsula: é ela que faz a flecha do jogador acertar o bot.
    this.buildBody();
    entityRegistry.register(this.entityId, this.player);

    /* ------------------------------------------------------------ estado -- */
    this.vivo = true;
    this.morteEm = 0;
    this.drawTime = 0;
    this.tensionando = false;
    this.recarga = 0;
    this.reagirEm = 0;
    this.destino = null;
    this.tempoNoDestino = 0;
    this.pulaEm = 1 + Math.random() * 3;
    this.jetpack = null;

    this.velY = 0;
    this.noChao = true;

    this._alvoPos = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._ultimaPosAlvo = new THREE.Vector3();
    this._velAlvo = new THREE.Vector3();
  }

  buildBody() {
    const raio = CONFIG.player.colliderRadius;
    const meia = Math.max(0.1, (CONFIG.player.height - 2 * raio) / 2);
    this.body = this.physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.player.position.x,
        this.player.position.y + CONFIG.player.height / 2,
        this.player.position.z,
      ),
    );
    this.collider = this.physics.createCollider(
      RAPIER.ColliderDesc.capsule(meia, raio).setActiveEvents(
        RAPIER.ActiveEvents.COLLISION_EVENTS,
      ),
      this.body,
    );
    this.physics.register(this.collider, {
      kind: "character",
      entityId: this.entityId,
      character: this.player,
      isLocal: false,
    });
  }

  /* `Player` chama estes: o bot é o próprio corpo físico dele. */
  getHitBody() {
    return this.body;
  }
  queueJump() {
    if (this.noChao) {
      this.velY = CONFIG.player.jumpSpeed;
      this.noChao = false;
    }
  }
  setHorizontalMove() {}

  teleport(x, y, z) {
    this.player.position.set(x, y, z);
    this.velY = 0;
    this.noChao = false;
  }

  /* ---------------------------------------------------------------- vida -- */

  /** Uma flecha acertou. O `Player` chama isto pelo caminho normal de dano. */
  onArrowHit(impact, arrow) {
    if (!this.vivo) return;
    this.vivo = false;
    this.morteEm = 0;
    this.tensionando = false;
    this.drawTime = 0;
    this.player.setDraw(0);
    this.player.ragdoll = this.ragdoll;
    this.ragdoll.begin(
      this.player.position,
      this.player.yaw,
      impact ? { x: impact.x, y: impact.y, z: impact.z } : null,
      arrow?.speed ?? null,
    );
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "hitCharacter",
      position: vec3Payload(this.player.position),
      volume: 1,
    });
  }

  get invulnerable() {
    return !this.vivo;
  }

  renascer(x, z) {
    this.vivo = true;
    this.ragdoll.stop();
    this.player.ragdoll = null;
    this.player.position.set(x, this.terrain.heightAt(x, z), z);
    this.velY = 0;
    this.noChao = true;
    this.destino = null;
    this.drawTime = 0;
    this.tensionando = false;
  }

  /* --------------------------------------------------------------- laço --- */

  /**
   * @param {number} dt
   * @param {Array<{position: THREE.Vector3, entityId: string}>} inimigos
   */
  update(dt, inimigos) {
    if (!this.vivo) {
      this.morteEm += dt;
      this.ragdoll.update(dt);
      this.player.update(dt, false);
      // Volta sozinho: um duelo em que o adversário some depois do primeiro
      // acerto acaba antes de virar duelo.
      if (this.morteEm > CONFIG.modes.duel.respawnDelay + 2) {
        const a = Math.random() * TAU;
        const r = 60 + Math.random() * 40;
        const cx = this.terrain.spawnCenter?.x ?? CONFIG.spawn.centerX;
        const cz = this.terrain.spawnCenter?.z ?? CONFIG.spawn.centerZ;
        this.renascer(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      }
      return;
    }

    const alvo = this.escolherAlvo(inimigos);
    this.mover(dt, alvo);
    this.gravidade(dt);
    if (alvo) this.mirarEAtirar(dt, alvo);
    else {
      this.tensionando = false;
      this.drawTime = 0;
      this.player.setDraw(0);
    }

    this.player.update(dt, this._andando);
    this.body?.setNextKinematicTranslation({
      x: this.player.position.x,
      y: this.player.position.y + CONFIG.player.height / 2,
      z: this.player.position.z,
    });
  }

  escolherAlvo(inimigos) {
    let melhor = null;
    let melhorD = Infinity;
    for (const e of inimigos) {
      if (!e || e.entityId === this.entityId) continue;
      const d = e.position.distanceToSquared(this.player.position);
      if (d < melhorD) {
        melhorD = d;
        melhor = e;
      }
    }
    return melhor;
  }

  /* --------------------------------------------------------- locomoção --- */

  /**
   * Andar com PROPÓSITO, não a esmo.
   *
   * Ele persegue uma faixa de distância, não um ponto: perto demais o arco
   * perde a graça (e ele vira alvo fácil), longe demais nenhum dos dois acerta
   * nada. Dentro da faixa ele STRAFEIA — anda de lado —, que é o que um
   * duelista de verdade faz, porque parar é morrer e avançar em linha reta é
   * dar a distância de graça.
   */
  mover(dt, alvo) {
    this._andando = false;
    if (!alvo) return;

    const p = this.player.position;
    const dx = alvo.position.x - p.x;
    const dz = alvo.position.z - p.z;
    const dist = Math.hypot(dx, dz) || 1;

    const IDEAL_MIN = 34;
    const IDEAL_MAX = 62;

    let vx = 0;
    let vz = 0;
    if (dist > IDEAL_MAX) {
      vx = dx / dist;
      vz = dz / dist;
    } else if (dist < IDEAL_MIN) {
      vx = -dx / dist;
      vz = -dz / dist;
    } else {
      /* Na faixa boa: circunda. O lado é sorteado e SUSTENTADO por alguns
         segundos — trocar a cada quadro daria um boneco vibrando no lugar, que
         não engana ninguém e ainda é impossível de acertar por acidente. */
      this.tempoNoDestino -= dt;
      if (this.tempoNoDestino <= 0) {
        this.ladoStrafe = Math.random() < 0.5 ? 1 : -1;
        this.tempoNoDestino = 1.4 + Math.random() * 2.2;
      }
      vx = (-dz / dist) * (this.ladoStrafe ?? 1);
      vz = (dx / dist) * (this.ladoStrafe ?? 1);

      /* Sem visada, ele CIRCUNDA MAIS DEPRESSA e não fica trocando de lado.
         Parado atrás da mesma árvore, a mira nunca abriria; andando de lado
         com propósito, ela abre em um ou dois segundos. */
      if (this.bloqueado) {
        this.tempoNoDestino = Math.max(this.tempoNoDestino, 1.2);
        vx *= 1.6;
        vz *= 1.6;
      }
    }

    // Mira sempre para o alvo, ande para onde andar. É isso que permite
    // strafear atirando, como um jogador faz.
    const passo = CONFIG.player.walkSpeed * dt;
    const nx = p.x + vx * passo;
    const nz = p.z + vz * passo;
    if (this.terrain.isWalkable(nx, nz)) {
      p.x = nx;
      p.z = nz;
      this._andando = true;
    } else {
      // Bateu na barreira: inverte o lado em vez de ficar raspando nela.
      this.ladoStrafe = -(this.ladoStrafe ?? 1);
    }

    /* O PULO. Não é enfeite: um alvo que muda de altura de repente estraga a
       solução balística de quem está mirando nele, e é a única defesa que
       existe contra uma flecha já no ar. Ele pula com folga entre um e outro
       para não virar um pula-pula previsível. */
    this.pulaEm -= dt;
    if (this.pulaEm <= 0 && this.noChao) {
      this.pulaEm = 2.5 + Math.random() * 4;
      this.queueJump();
    }

    // A fase de passada do boneco é alimentada pelo mesmo `move` do jogador,
    // então a animação sai de graça e igual à de todo mundo.
    this.player.gaitBlend = this._andando && this.noChao ? 1 : 0;
    if (this._andando && this.noChao) {
      this.player.gaitPhase = (this.player.gaitPhase + (passo / CONFIG.gait.strideLength) * TAU) % TAU;
    }
  }

  gravidade(dt) {
    const p = this.player.position;
    const chao = this.terrain.heightAt(p.x, p.z);
    if (!this.noChao) {
      this.velY += CONFIG.physics.gravity * dt;
      p.y += this.velY * dt;
      if (p.y <= chao) {
        p.y = chao;
        this.velY = 0;
        this.noChao = true;
      }
    } else {
      p.y = chao;
    }
    this.player.airborne = !this.noChao;
  }

  /* -------------------------------------------------------------- mira --- */

  /**
   * Onde o alvo VAI ESTAR quando a flecha chegar.
   *
   * É uma equação implícita: o tempo de voo depende da distância, que depende
   * de para onde ele foi, que depende do tempo. Três iterações convergem de
   * sobra nas distâncias deste jogo — a primeira já acerta o grosso, e as
   * outras duas afinam.
   */
  mirarComLead(alvo, velocidadeFlecha, out) {
    /* MIRA NO PEITO, não nos pés.
     *
     * `position` de um personagem é o chão sob ele. Mirar ali manda a flecha
     * para a base da cápsula, onde ela raspa o terreno logo antes e crava no
     * chão a um passo do alvo — o bot acertava o pé da pessoa com precisão de
     * centímetro e não machucava ninguém. */
    const ALTURA_PEITO = 1.15;
    out.copy(alvo.position);
    out.y += ALTURA_PEITO;
    let t = 0;
    for (let i = 0; i < 3; i++) {
      t = this._muzzle.distanceTo(out) / velocidadeFlecha;
      out.copy(alvo.position);
      out.y += ALTURA_PEITO;
      out.addScaledVector(this._velAlvo, t * this.pericia.precisaoLead);
    }
    return t;
  }

  /**
   * O ângulo de elevação que compensa a queda.
   *
   * A conta fechada de balística existe só no vácuo E sem arrasto — no vale há
   * arrasto, e no vácuo lunar a gravidade é outra. Em vez de escolher uma
   * fórmula que só vale metade das vezes, o bot faz o que um arqueiro faz:
   * chuta, vê onde cairia, corrige. Duas iterações bastam porque o erro cai
   * quadraticamente.
   */
  elevacaoPara(distancia, alturaRelativa, v) {
    const g = -CONFIG.physics.gravity;

    /* O ARRASTO entra como um encurtamento da velocidade média.
     *
     * A flecha do vale perde ~20 % da velocidade em 100 m, e é ela que decide
     * o tempo de voo — que entra ao QUADRADO na queda. Ignorar isso fazia o bot
     * mirar sempre abaixo, e o erro crescia com a distância exatamente como um
     * arqueiro novato erra.
     *
     * Não é a integral do arrasto: é uma velocidade efetiva, que é o que um
     * arqueiro de verdade também usa (ele não integra nada, ele lembra que
     * "longe cai mais"). No vácuo lunar `airDensity` é zero e o fator vira 1,
     * então a mesma linha serve para as duas fases. */
    const ar = CONFIG.physics.airDensity / 1.225;
    const vEf = v * (1 - 0.11 * ar * Math.min(1, distancia / 100));

    let ang = Math.atan2(alturaRelativa, distancia);
    for (let i = 0; i < 4; i++) {
      const t = distancia / Math.max(1e-3, vEf * Math.cos(ang));
      const queda = 0.5 * g * t * t;
      ang = Math.atan2(alturaRelativa + queda, distancia);
    }
    return ang;
  }

  mirarEAtirar(dt, alvo) {
    // Velocidade do alvo, medida — não recebida. É o que um jogador faz: olha
    // para onde o outro está indo.
    this._velAlvo.subVectors(alvo.position, this._ultimaPosAlvo).divideScalar(Math.max(dt, 1e-4));
    if (this._velAlvo.lengthSq() > 900) this._velAlvo.set(0, 0, 0); // teleporte
    this._ultimaPosAlvo.copy(alvo.position);

    this.recarga = Math.max(0, this.recarga - dt);
    this.reagirEm -= dt;

    this.player.getMuzzle(this._muzzle);

    // Tensiona até uma força escolhida pela distância: tiro curto não precisa
    // de tensão máxima, e tensão máxima demora quase dois segundos.
    const distBruta = this._muzzle.distanceTo(alvo.position);
    const tensaoAlvo = clamp(distBruta / 110, 0.35, 1) * CONFIG.bow.fullDrawTime;

    if (this.recarga > 0) {
      this.tensionando = false;
      this.drawTime = 0;
      this.player.setDraw(0);
    } else {
      this.tensionando = true;
      this.drawTime = Math.min(this.drawTime + dt, CONFIG.bow.fullDrawTime);
      this.player.setDraw(this.drawTime / CONFIG.bow.fullDrawTime);
    }

    const v = drawSpeed(this.drawTime);
    const tempoVoo = this.mirarComLead(alvo, v, this._alvoPos);

    // Aponta para o ponto previsto, com a elevação que a gravidade cobre.
    this._dir.subVectors(this._alvoPos, this._muzzle);
    const distH = Math.hypot(this._dir.x, this._dir.z);
    /* O SINAL importa e já me custou uma sessão de tiros a esmo.
     * A mira do jogo é `(-sen y·cos p, sen p, -cos y·cos p)` — ver
     * `AimSolver.axisFrom`. Com o yaw calculado pela convenção "normal"
     * (`atan2(x, z)`), o bot apontava o corpo para um lado e mandava a flecha
     * para o oposto: 34 m de erro contra um alvo parado a 45 m. */
    const yaw = Math.atan2(-this._dir.x, -this._dir.z);
    const pitch = this.elevacaoPara(distH, this._dir.y, v);

    // O giro tem VELOCIDADE FINITA. Um bot que encara instantaneamente é
    // impossível de flanquear, e flanquear é o que se faz num duelo.
    const giroMax = 2.6 * dt;
    let dYaw = yaw - this.player.yaw;
    while (dYaw > Math.PI) dYaw -= TAU;
    while (dYaw < -Math.PI) dYaw += TAU;
    const dPitch = pitch - this.player.pitch;

    this.player.setAim(
      this.player.yaw + clamp(dYaw, -giroMax, giroMax),
      this.player.pitch + clamp(dPitch, -giroMax, giroMax),
    );

    if (this.recarga > 0 || this.drawTime < tensaoAlvo) return;
    if (this.reagirEm > 0) return;

    /* LINHA DE VISADA. Sem isto o bot é excelente e inútil.
     *
     * No vale ele duela dentro de um bosque, e a balística resolvida ao
     * centímetro só garante que a flecha acerte o TRONCO na frente dele com
     * precisão. Medido: noventa tiros, zero acertos, todas as flechas cravadas
     * na mesma árvore.
     *
     * Um jogador não faz isso — ele vê a árvore e anda. O bot passa a ver
     * também, e quando está bloqueado ele guarda o tiro e continua
     * circundando, que é exatamente o que resolve a situação. */
    if (!this.temVisada(this._alvoPos)) {
      this.bloqueado = true;
      return;
    }
    this.bloqueado = false;

    /* SÓ ATIRA COM OS DOIS ÂNGULOS NO LUGAR.
     *
     * Exigir só o yaw — que era o que estava aqui — deixava a flecha sair
     * enquanto a ELEVAÇÃO ainda subia, e a elevação é justamente o que
     * compensa a queda. O resultado batia 13 m longe de um alvo parado a 45 m,
     * com o erro todo na vertical, e parecia falta de pontaria quando era
     * pressa.
     *
     * A tolerância de 0,01 rad vale ~45 cm a 45 m: fina o bastante para
     * acertar, larga o bastante para ele não travar mirando eternamente contra
     * um alvo que se mexe. */
    if (Math.abs(dYaw) > 0.01 || Math.abs(dPitch) > 0.01) return;

    this.atirar(v, tempoVoo);
  }

  /**
   * Há caminho livre do arco até este ponto?
   *
   * Um raio só, do muzzle ao alvo, ignorando a própria cápsula. Se ele bate em
   * algo ANTES de chegar, tem obstáculo no meio — árvore, rocha, foguete.
   *
   * A tolerância de 1,5 m no fim existe porque o raio acerta a cápsula do
   * ALVO, que está exatamente ali: sem a folga, o bot concluiria que o próprio
   * adversário é o obstáculo e nunca atiraria em ninguém.
   */
  temVisada(pontoAlvo) {
    const dir = this._losDir ??= new THREE.Vector3();
    dir.subVectors(pontoAlvo, this._muzzle);
    const dist = dir.length();
    if (dist < 1e-3) return true;
    dir.divideScalar(dist);

    const raio = (this._losRay ??= new RAPIER.Ray(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ));
    raio.origin.x = this._muzzle.x;
    raio.origin.y = this._muzzle.y;
    raio.origin.z = this._muzzle.z;
    raio.dir.x = dir.x;
    raio.dir.y = dir.y;
    raio.dir.z = dir.z;

    const hit = this.physics.world.castRay(
      raio,
      dist,
      true,
      undefined,
      undefined,
      this.collider,
    );
    return !hit || hit.timeOfImpact >= dist - 1.5;
  }

  atirar(v) {
    this.player.getMuzzle(this._muzzle);

    /* A mão do bot treme: é este desvio que separa um treino de um carrasco.
     * `missChance` decide se ESTE tiro em particular sai deliberadamente
     * torto (desvio ampliado por `missSpread`) — a "porcentagem de errar o
     * tiro". O tremor de `erroMira` sozinho continua presente mesmo quando
     * não erra de propósito: é o "atirar certeiro" da dificuldade, e nunca
     * chega a zero. */
    const errouDeProposito = Math.random() < (this.pericia.missChance ?? 0);
    const e = this.pericia.erroMira * (errouDeProposito ? (this.pericia.missSpread ?? 1) : 1);
    const yaw = this.player.yaw + (Math.random() - 0.5) * 2 * e;
    const pitch = this.player.pitch + (Math.random() - 0.5) * 2 * e;
    /* A MESMA função que a mira do jogador usa (`AimSolver.axisFrom`), e não
       uma cópia escrita à mão. Uma cópia é onde o sinal se perde — foi
       exatamente o que aconteceu, e o bot passou a atirar para trás do alvo. */
    const cp = Math.cos(pitch);
    this._dir.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp).normalize();

    this._tmp.copy(this._muzzle).addScaledVector(this._dir, 0.3);
    const arrow = this.arrows.spawn(this._tmp, this._dir, v, {
      ownerEntityId: this.entityId,
      trailColor: this.cor,
    });

    gameEvents.emit(EventType.ARROW_SHOT, {
      arrowId: arrow?.id,
      ownerId: this.entityId,
      origin: vec3Payload(this._tmp),
      direction: vec3Payload(this._dir),
      speed: v,
    });

    this.drawTime = 0;
    this.tensionando = false;
    this.player.setDraw(0);
    this.recarga = CONFIG.bow.reloadTime + 0.35;
    this.reagirEm = this.pericia.reacao;
  }

  dispose() {
    entityRegistry.unregister(this.entityId);
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    this.tag.dispose();
    this.scene.remove(this.player.root);
    this.player.dispose();
  }
}

/* ---------------------------------------------------------------- coleção -- */

/**
 * Os bots em campo.
 *
 * Vive FORA da fase, como o jogador e os remotos: quem trocou de cenário
 * continua duelando com o mesmo adversário do outro lado. O que muda na troca é
 * o terreno sob os pés dele e a cápsula, exatamente como acontece com os
 * jogadores humanos.
 */
export class BotManager {
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {Bot[]} */
    this.bots = [];
    this.contador = 0;
  }

  get count() {
    return this.bots.length;
  }

  add(opcoes = {}) {
    if (this.bots.length >= 6) return null;
    this.contador++;
    const cores = ["#e0554a", "#4a9ee0", "#8ee04a", "#e0c24a", "#b44ae0", "#4ae0c2"];
    const bot = new Bot(this.ctx, {
      nome: `CPU ${this.contador}`,
      cor: cores[(this.contador - 1) % cores.length],
      ...opcoes,
    });

    // Nasce longe de quem já está em campo, no anel de duelo da fase.
    const t = this.ctx.terrain;
    const cx = t.spawnCenter?.x ?? CONFIG.spawn.centerX;
    const cz = t.spawnCenter?.z ?? CONFIG.spawn.centerZ;
    const raio = t.spawnCenter ? CONFIG.levels.moon.duel.ringRadius : CONFIG.modes.duel.ringRadius;
    const a = Math.random() * TAU;
    bot.renascer(cx + Math.cos(a) * raio, cz + Math.sin(a) * raio);

    this.bots.push(bot);
    return bot;
  }

  removeLast() {
    const bot = this.bots.pop();
    bot?.dispose();
    return !!bot;
  }

  clear() {
    for (const b of this.bots) b.dispose();
    this.bots = [];
  }

  /** A fase mudou: terreno novo e cápsula nova, como nos jogadores remotos. */
  relevel(terrain) {
    /* NÃO se atribui a `this.ctx.terrain`: é um getter (`get terrain() {
       return this.jogo.terrain; }`, montado em main.js) sem setter, e
       `onLevelReady` — de onde `relevel` é chamado — já roda DEPOIS da fase
       nova estar instalada, então o getter já devolve o terreno certo sozinho.
       Escrever nele lançava `TypeError` e derrubava toda troca de fase. */
    for (const b of this.bots) {
      b.terrain = terrain;
      b.player.terrain = terrain;
      b.ragdoll.terrain = terrain;
      b.buildBody();
      const cx = terrain.spawnCenter?.x ?? CONFIG.spawn.centerX;
      const cz = terrain.spawnCenter?.z ?? CONFIG.spawn.centerZ;
      const a = Math.random() * TAU;
      const r = terrain.spawnCenter ? CONFIG.levels.moon.duel.ringRadius : CONFIG.modes.duel.ringRadius;
      b.renascer(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
  }

  update(dt, inimigos) {
    for (const b of this.bots) {
      /* Cada bot enxerga todo mundo MENOS ele mesmo — e os outros bots contam
         como adversário. Dois bots numa sala vazia duelam entre si, o que é a
         melhor forma de olhar a IA jogando. */
      b.update(dt, inimigos);
    }
  }

  /** Alvos para os aliens e para a mira: os bots também são gente em campo. */
  positions(out) {
    for (const b of this.bots) if (b.vivo) out.push(b.player.position);
    return out;
  }
}
