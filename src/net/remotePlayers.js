/* ---------------------------------------------------------------------------
   Os outros jogadores.

   A ideia central é uma só: o mundo dos outros é desenhado 100 ms NO PASSADO.

   As poses chegam 20 vezes por segundo, com jitter. Desenhar cada pacote assim
   que ele cai produz teleporte; extrapolar produz boneco que anda para dentro
   de árvore e volta. Atrasando o relógio em `interpDelay`, a qualquer instante
   já existem duas amostras cercando o tempo desejado, e o que se desenha é uma
   interpolação entre elas — movimento liso, mesmo com a rede oscilando. Os
   100 ms saem de graça na percepção: você não repara, mas repara no teleporte.

   O corpo não é remontado nem animado à parte. Chegam a posição, a mira e a
   FASE DA MARCHA, e o `Player.update()` que já existe monta a pose inteira a
   partir disso — pernas, tronco, arco tensionado. Nenhum osso trafega.

   Cada remoto ganha também uma cápsula cinemática de colisão. É ela que torna o
   PvP possível: sem um colisor, a flecha atravessaria o boneco.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { Player } from "../entities/player.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { playerEntity, unpackState } from "../shared/protocol.js";
import { blinkOpacity } from "../game/respawn.js";
import { NameTag } from "./nameTag.js";

const TAU = Math.PI * 2;

/** Quanto se aceita adivinhar além da última amostra (ms). Dois pacotes a 20 Hz. */
const EXTRAPOLACAO_MAX = 110;

/** Ângulos pelo caminho curto: sem isso o boneco gira 350° para virar 10°. */
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * t;
}

const lerp = (a, b, t) => a + (b - a) * t;

class RemotePlayer {
  /**
   * @param {object} info `{ id, name, color }` vindos do servidor
   */
  constructor(scene, physics, terrain, info) {
    this.id = info.id;
    this.name = info.name;
    this.color = info.color;
    this.entityId = playerEntity(info.id);

    this.player = new Player(terrain, this.entityId);
    this.player.isLocal = false;
    this.player.displayName = info.name;
    this.player.setColor(info.color);
    scene.add(this.player.root);

    this.tag = new NameTag(info.name, info.color);
    // Preso ao root (que fica nos pés): o sprite ignora a rotação do pai e
    // encara a câmera sozinho, então basta a altura.
    this.tag.sprite.position.set(0, CONFIG.player.height + 0.24, 0);
    this.player.root.add(this.tag.sprite);

    /** Amostras `{t, ...pose}` para interpolar. */
    this.buffer = [];
    this.invulnUntil = 0;
    /** Instante do relógio da sala em que o tombo começou. 0 = vivo. */
    this.dyingSince = 0;
    this.visible = true;
    this.shadowsOn = true;
    this.opacity = 1;

    this.body = new RemoteBody(physics, this.entityId, this.player);
    this.player.physicsBody = this.body;
    entityRegistry.register(this.entityId, this.player);
  }

  /** Uma pose recebida, carimbada com o instante em que o dono a capturou. */
  pushSample(time, state) {
    const ultima = this.buffer[this.buffer.length - 1];
    // O buffer precisa estar em ordem para a busca por par funcionar. Uma pose
    // que chega mais velha que a última é repetição ou atraso — em qualquer dos
    // casos ela já não tem o que acrescentar.
    if (ultima && time <= ultima.t) return;

    const amostra = unpackState(state, {});
    amostra.t = time;
    this.buffer.push(amostra);
    // Guarda pouco mais que o necessário: com 20 Hz e 100 ms de atraso, meio
    // segundo já cobre qualquer soluço razoável da rede.
    while (this.buffer.length > 24) this.buffer.shift();
  }

  /**
   * Teleporte (nascer, renascer, ir para o duelo).
   *
   * O buffer é DESCARTADO. Sem isso, a interpolação ligaria a posição antiga à
   * nova e o boneco atravessaria a arena deslizando — em vez de simplesmente
   * aparecer lá.
   */
  applySpawn(spawn) {
    this.buffer.length = 0;
    this.invulnUntil = spawn.invulnUntil ?? 0;
    this.dyingSince = 0;
    this.player.deathFall = 0;
    const y = spawn.y + (spawn.drop ?? CONFIG.spawn.dropHeight);
    this.player.position.set(spawn.x, y, spawn.z);
    this.player.airborne = true;
    this.player.gaitBlend = 0;
    this.player.runBlend = 0;
    this.player.setDraw(0);
  }

  /**
   * @param {number} renderTime instante a desenhar (relógio da sala, ms)
   * @param {THREE.Vector3} cameraPos
   */
  update(dt, renderTime, serverTime, cameraPos) {
    const p = this.player;
    const distancia = p.position.distanceTo(cameraPos);
    const cull = CONFIG.net.cull;

    // Longe demais: nem interpola nem monta a pose. É a economia que faz a sala
    // cheia caber no frame — a IK de dois ossos é o que custa, não o desenho.
    const deveAparecer = distancia <= cull.hide;
    if (deveAparecer !== this.visible) {
      this.visible = deveAparecer;
      p.root.visible = deveAparecer;
      this.tag.sprite.visible = deveAparecer;
    }
    if (!deveAparecer) {
      this.sample(renderTime); // posição ainda avança, para voltar no lugar certo
      this.body.moveTo(p.position);
      return;
    }

    this.sample(renderTime);

    // Tombo da morte: sai do relógio da sala, então o corpo cai com o mesmo
    // tempo em todas as telas.
    if (this.dyingSince) {
      const k = (serverTime - this.dyingSince) / (CONFIG.spawn.deathDuration * 1000);
      p.deathFall = 1 - (1 - Math.min(1, Math.max(0, k))) ** 2;
      p.gaitBlend = 0;
      p.runBlend = 0;
      p.setDraw(0);
    }

    p.bobPhase += dt * 1.3; // respiração: é local, não trafega
    p.update(dt, p.gaitBlend > 0.01);
    this.body.moveTo(p.position);

    // Sombra só de perto. Cada arqueiro são ~45 malhas com `castShadow`, e a
    // sombra de quem está a 40 m não é vista por ninguém.
    const querSombra = distancia <= cull.shadow;
    if (querSombra !== this.shadowsOn) {
      this.shadowsOn = querSombra;
      p.root.traverse((o) => {
        if (o.isMesh) o.castShadow = querSombra;
      });
    }

    // Invencibilidade: mesma fase, mesma fórmula que a do jogador local.
    const imune = serverTime < this.invulnUntil;
    p.invulnerable = imune;
    const alvo = imune ? blinkOpacity(serverTime) : 1;
    if (alvo !== this.opacity) {
      this.opacity = alvo;
      p.setOpacity(alvo);
      this.tag.setOpacity(alvo < 1 ? 0.7 : 1);
    }

    this.tag.updateScale(distancia);
  }

  /** Encontra as duas amostras que cercam `renderTime` e mistura as duas. */
  sample(renderTime) {
    const buf = this.buffer;
    if (!buf.length) return;

    const ultima = buf[buf.length - 1];
    if (renderTime >= ultima.t) {
      /* Ficamos sem amostra nova — um pacote se perdeu ou atrasou.
       *
       * Congelar aqui produz o pior efeito visual que existe: o boneco para,
       * e quando o próximo pacote chega ele SALTA para onde já deveria estar.
       * Seguir o rumo por um instante troca isso por um deslize curto que
       * ninguém percebe, e a correção chega suave.
       *
       * O teto é curto de propósito: extrapolação longa põe o boneco dentro de
       * tronco e o faz voltar. Passado o limite, parar é o menor dos males. */
      const atraso = renderTime - ultima.t;
      const penultima = buf[buf.length - 2];
      if (penultima && atraso <= EXTRAPOLACAO_MAX) {
        this.extrapolate(penultima, ultima, atraso);
      } else {
        this.apply(ultima);
      }
      return;
    }
    if (renderTime <= buf[0].t) {
      this.apply(buf[0]);
      return;
    }

    let i = buf.length - 1;
    while (i > 0 && buf[i - 1].t > renderTime) i--;
    const a = buf[i - 1];
    const b = buf[i];
    const span = b.t - a.t;
    const t = span > 0 ? (renderTime - a.t) / span : 1;
    this.apply(a, b, t);

    // Descarta o que já passou, deixando uma amostra de folga antes do corte.
    if (i > 1) buf.splice(0, i - 1);
  }

  apply(a, b = null, t = 0) {
    const p = this.player;
    if (!b) {
      p.position.set(a.x, a.y, a.z);
      p.yaw = a.yaw;
      p.pitch = a.pitch;
      p.gaitPhase = a.gaitPhase;
      p.gaitBlend = a.gaitBlend;
      p.runBlend = a.runBlend;
      p.moveF = a.moveF;
      p.moveS = a.moveS;
      p.airborne = a.airborne;
      p.setDraw(a.drawFraction);
      this.body.verticalVelocity = 0;
      return;
    }

    p.position.set(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
    p.yaw = lerpAngle(a.yaw, b.yaw, t);
    p.pitch = lerp(a.pitch, b.pitch, t);
    // A fase da marcha dá a volta em 2π: interpolar reto faz a perna voltar
    // correndo ao cruzar o zero.
    p.gaitPhase = lerpAngle(a.gaitPhase, b.gaitPhase, t);
    p.gaitBlend = lerp(a.gaitBlend, b.gaitBlend, t);
    p.runBlend = lerp(a.runBlend, b.runBlend, t);
    p.moveF = lerp(a.moveF, b.moveF, t);
    p.moveS = lerp(a.moveS, b.moveS, t);
    p.airborne = t < 0.5 ? a.airborne : b.airborne;
    p.setDraw(lerp(a.drawFraction, b.drawFraction, t));

    // Velocidade vertical estimada das amostras: é o que a pose de pulo usa
    // para encolher as pernas na subida.
    const dt = (b.t - a.t) / 1000;
    this.body.verticalVelocity = dt > 0 ? (b.y - a.y) / dt : 0;
  }

  /**
   * Segue o rumo das duas últimas amostras por `atrasoMs` além da última.
   *
   * Só a posição e a fase da marcha avançam. Os ÂNGULOS ficam parados: um
   * boneco que continua girando sozinho porque estava girando fica muito mais
   * estranho que um que para de girar — e a mira alheia é o que menos convém
   * inventar.
   */
  extrapolate(a, b, atrasoMs) {
    const span = (b.t - a.t) / 1000;
    if (span <= 0) return this.apply(b);
    const k = atrasoMs / 1000;
    const p = this.player;

    p.position.set(
      b.x + ((b.x - a.x) / span) * k,
      b.y + ((b.y - a.y) / span) * k,
      b.z + ((b.z - a.z) / span) * k,
    );
    p.yaw = b.yaw;
    p.pitch = b.pitch;
    // A fase precisa avançar junto, senão o boneco desliza com as pernas
    // paradas — que é exatamente a aparência de bug de rede.
    let dFase = b.gaitPhase - a.gaitPhase;
    while (dFase > Math.PI) dFase -= TAU;
    while (dFase < -Math.PI) dFase += TAU;
    p.gaitPhase = b.gaitPhase + (dFase / span) * k;
    p.gaitBlend = b.gaitBlend;
    p.runBlend = b.runBlend;
    p.moveF = b.moveF;
    p.moveS = b.moveS;
    p.airborne = b.airborne;
    p.setDraw(b.drawFraction);
  }

  dispose(scene) {
    entityRegistry.unregister(this.entityId);
    this.tag.dispose();
    this.body.dispose();
    scene.remove(this.player.root);
    this.player.dispose();
  }
}

/**
 * A cápsula de colisão de um jogador remoto.
 *
 * Cinemática e movida na mão a cada frame para a posição interpolada. Sem ela
 * não existe PvP: `hitResolver` procura um colisor com dono `character`, e sem
 * colisor a flecha atravessa o boneco como se ele fosse cenário pintado.
 */
class RemoteBody {
  constructor(physics, entityId, player) {
    this.physics = physics;
    this.verticalVelocity = 0;

    const raio = CONFIG.player.colliderRadius;
    const meia = Math.max(0.1, (CONFIG.player.height - 2 * raio) / 2);

    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        player.position.x,
        player.position.y + CONFIG.player.height / 2,
        player.position.z,
      ),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(meia, raio).setActiveEvents(
        RAPIER.ActiveEvents.COLLISION_EVENTS,
      ),
      this.body,
    );
    physics.register(this.collider, {
      kind: "character",
      entityId,
      character: player,
      isLocal: false,
    });
  }

  moveTo(position) {
    this.body.setNextKinematicTranslation({
      x: position.x,
      y: position.y + CONFIG.player.height / 2,
      z: position.z,
    });
  }

  getHitBody() {
    return this.body;
  }

  dispose() {
    this.physics.removeBody(this.body);
  }
}

/* ---------------------------------------------------------------- coleção -- */

export class RemotePlayers {
  constructor(scene, physics, terrain) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    /** @type {Map<number, RemotePlayer>} */
    this.byId = new Map();
    this._cam = new THREE.Vector3();
  }

  get count() {
    return this.byId.size;
  }

  add(info) {
    if (this.byId.has(info.id)) return this.byId.get(info.id);
    const remoto = new RemotePlayer(this.scene, this.physics, this.terrain, info);
    this.byId.set(info.id, remoto);
    return remoto;
  }

  remove(id) {
    const remoto = this.byId.get(id);
    if (!remoto) return;
    this.byId.delete(id);
    remoto.dispose(this.scene);
  }

  get(id) {
    return this.byId.get(id) ?? null;
  }

  /** Alguém morreu: o corpo começa a tombar. */
  kill(id, serverTime) {
    const remoto = this.byId.get(id);
    if (remoto) remoto.dyingSince = serverTime;
  }

  /** Poses vindas do servidor. `selfId` é ignorado: o seu boneco é local. */
  applyStates(msg, selfId) {
    for (const entrada of msg.s) {
      if (entrada.id === selfId) continue;
      // `w` é quando o DONO capturou a pose; `msg.time` é quando o servidor
      // retransmitiu. O primeiro é o que faz o movimento chegar com a duração
      // real que teve.
      this.byId.get(entrada.id)?.pushSample(entrada.w ?? msg.time, entrada);
    }
  }

  update(dt, serverTime, camera) {
    const renderTime = serverTime - CONFIG.net.interpDelay * 1000;
    camera.getWorldPosition(this._cam);
    for (const remoto of this.byId.values()) {
      remoto.update(dt, renderTime, serverTime, this._cam);
    }
  }

  clear() {
    for (const id of [...this.byId.keys()]) this.remove(id);
  }
}
