/* ---------------------------------------------------------------------------
   O cerco, no cliente.

   Mesma divisão dos outros gerentes (`zombieManager`, `meteorRain`): a horda é
   do SERVIDOR e aqui existe só a casca. O que este arquivo tem de próprio, e
   que os outros não têm, são três coisas:

   1. **O quadro BINÁRIO.** As poses não chegam em JSON — chegam em 10 bytes por
      sitiante, e `applyFrame` é quem os desempacota. Ver `Siege.packFrame` no
      servidor para a conta que justifica isso.

   2. **A terceira faixa de LOD.** Acima do nível 2 o corpo sai do render e vira
      uma instância numa `InstancedMesh` por espécie. Com 120 vivos, o corpo
      articulado só é pago por quem está perto — e o cenário ajuda: o jogador
      está 11 m acima e a horda a 20–90 m, então a faixa de perto está quase
      sempre vazia por construção.

   3. **O trabuco.** Ele é a única arma do jogo cujo ESTADO é da sala (carregado
      ou não) e cuja TRAJETÓRIA é de quem atira. Ver `entities/trebuchet.js`.

   ----------------------------------------------------------------- uma tecla

   `F` faz três coisas, decididas pelo contexto — e é de propósito. Num modo em
   que o jogador está com o arco tensionado quase o tempo todo, três teclas
   novas seriam três coisas a lembrar no pior momento possível:

     • perto de um trabuco CARREGADO  → segura e solta para atirar;
     • perto de um trabuco VAZIO      → iça o contrapeso;
     • dentro, junto ao portão        → repara.

   É o mesmo padrão de `PlayerPhysics.onJumpPressed`: uma tecla, vários
   significados, resolvidos num lugar só.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { gameEvents, EventType } from "../core/events.js";
import { C2S, S2C, FRAME } from "../shared/protocol.js";
import { BesiegerMesh, FICHAS, construirGeometrias } from "../entities/besieger.js";
import { Trebuchet, Stone, voar, velocidadePara } from "../entities/trebuchet.js";
import {
  CASTLE,
  GROUND_Y,
  WALL_TOP,
  gateInfo,
  trebuchetPosts,
  mageTowers,
} from "../shared/castleProps.js";
import { lodLevel, applyLod } from "../utils/lod.js";

/** Espelha `KINDS` de `server/siegeSim.js`. A ORDEM é o código na rede. */
const KINDS = [
  "soldier",
  "shielded",
  "skeleton",
  "climber",
  "hound",
  "shaman",
  "ogre",
  "catapult",
];
const STATES = ["walk", "attack", "climb", "cast", "down", "rise", "bones"];

const TAU = Math.PI * 2;

/**
 * Este xamã é um MAGO DE MIRANTE?
 *
 * A pergunta é respondida pela GEOMETRIA e não por um campo de rede, e é de
 * propósito: o quadro binário do cerco tem 11 bytes por bicho e o byte de flags
 * está cheio (3 bits de espécie, 3 de estado, morto, fogo — ver `packFrame`).
 * Um décimo segundo byte para 120 sitiantes, dez vezes por segundo, para
 * distinguir DOIS deles, seria pagar 1,2 KB/s por uma coisa que os dois lados
 * já sabem: `mageTowers()` é compartilhado, o mago nasce exatamente em cima da
 * torre (`Siege.nascerMago`) e nunca sai de lá.
 *
 * A tolerância é folgada em `y` (a pose chega interpolada) e apertada em `x/z`
 * — nenhum xamã de chão chega perto dos ombros do corredor, que é onde os
 * mirantes ficam.
 */
function magoDeMirante(kind, x, y, z) {
  if (kind !== "shaman") return false;
  for (const t of mageTowers()) {
    if (Math.abs(x - t.x) < 1.5 && Math.abs(z - t.z) < 1.5 && y > t.platY - 1) {
      return true;
    }
  }
  return false;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _um = new THREE.Vector3(1, 1, 1);
const _cam = new THREE.Vector3();

export class SiegeSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} physics
   * @param {object} net cliente de rede — para reportar acerto e impacto
   * @param {import("../entities/arrow.js").ArrowManager} arrows
   */
  constructor(scene, physics, net, arrows = null) {
    this.scene = scene;
    this.physics = physics;
    this.net = net;
    /* As FLECHAS CRAVADAS NO BICHO.
     *
     * Uma flecha presa a um sitiante é um corpo dinâmico ligado ao corpo dele
     * por um vínculo. Some o sitiante sem soltar a flecha e ela fica pendurada
     * no ponto do último quadro — hastes flutuando no ar sobre a rampa, que foi
     * exatamente o que apareceu. `ZombieManager` já fazia isto; o cerco não
     * tinha sequer a referência para fazer. */
    this.arrows = arrows;
    this.ativo = false;

    /** @type {Map<number, BesiegerMesh>} id do servidor → casca local */
    this.byId = new Map();
    /** @type {Trebuchet[]} */
    this.engenhos = [];
    /** @type {Stone[]} pedras em voo, minhas e dos outros */
    this.pedras = [];
    /** Poças de piche em chamas: visual puro, o dano é do servidor. */
    this.fogos = [];
    /** Raios de xamã e pedras de catapulta — só o desenho. */
    this.projeteis = [];

    this.status = null;
    /** @type {import("../entities/gate.js").Gate|null} */
    this.gate = null;

    this.root = new THREE.Group();
    this.root.name = "cerco";
    scene.add(this.root);

    this.instancias = new Map();
    this._segurando = false;
    this._reparando = false;
    this._icando = null;
    /** A MIRA do trabuco. `null` fora dela. Ver `entrarNaMira`. */
    this.mira = null;

    /* O arrasto das pedras entra no MESMO gancho de passo fixo das flechas.
       Um callback para todas, como o `ArrowManager` faz — e pelo mesmo motivo:
       menos indireção, e fica visível que a conta é uma por pedra por passo. */
    this._stepCallback = (h) => {
      const w = this.wind?.vector ?? null;
      for (const p of this.pedras) p.applyDrag(h, w);
    };
    physics.beforeStep.add(this._stepCallback);
    this._contactCallback = (c) => this.onContact(c);
    physics.onContact.add(this._contactCallback);
  }

  /* ------------------------------------------------------------- ciclo ---- */

  /**
   * Liga o modo. Recebe o portão da fase — ele é da FASE, não do modo: existe
   * no castelo mesmo em partida livre, e só a VIDA dele é do cerco.
   */
  start(gate, wind) {
    this.ativo = true;
    this.gate = gate ?? null;
    this.wind = wind ?? null;
    this.gate?.reset();
    if (!this.engenhos.length) {
      for (const posto of trebuchetPosts()) {
        this.engenhos.push(new Trebuchet(this.root, posto));
      }
    }
  }

  stop() {
    this.ativo = false;
    this.clear();
    for (const e of this.engenhos) e.dispose();
    this.engenhos = [];
    this.status = null;
    this.gate = null;
  }

  clear() {
    for (const b of this.byId.values()) {
      this.arrows?.removeAttachedTo(b);
      b.dispose();
    }
    this.byId.clear();
    for (const p of this.pedras) p.dispose();
    this.pedras = [];
    for (const f of this.fogos) this.root.remove(f.mesh);
    this.fogos = [];
    for (const p of this.projeteis) this.root.remove(p.mesh);
    this.projeteis = [];
    for (const inst of this.instancias.values()) {
      inst.mesh.count = 0;
      inst.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Aquece as oito silhuetas durante a tela de preparação.
   *
   * Uma amostra de cada espécie, viva e OCULTA — não criada e destruída. É a
   * mesma decisão do `ZombieManager.prepare()`: o primeiro sitiante de verdade
   * reaproveita os programas já compilados, em vez de gerar um pico de shader
   * no instante em que a coluna aparece na rampa.
   */
  prepare() {
    if (this._warmups?.length) return;
    this._warmups = [];
    for (const kind of KINDS) {
      const b = new BesiegerMesh(this.root, this.physics, `warm-${kind}`, kind, 0, -900, 0);
      b.collider?.setEnabled(false);
      b.group.visible = false;
      this._warmups.push(b);
    }
  }

  setWarmupVisible(v) {
    for (const b of this._warmups ?? []) b.group.visible = v;
  }

  /* ------------------------------------------------------ o quadro binário -- */

  /**
   * Desempacota um quadro de poses.
   *
   *   byte 0     tipo do quadro (`FRAME.SIEGE`)
   *   byte 1     versão do formato
   *   bytes 2–3  quantos
   *   depois     10 B por sitiante — ver `Siege.packFrame`
   *
   * O laço é escrito para não alocar: um `DataView` reaproveitado, nenhum
   * objeto intermediário por bicho. A 10 Hz com 120 vivos, alocar aqui seria
   * 1 200 objetos por segundo entrando no coletor de lixo — e o soluço dele
   * cairia exatamente no meio de uma maré cheia.
   */
  applyFrame(buffer) {
    if (!this.ativo) return;
    const dv = new DataView(buffer);
    if (dv.getUint8(0) !== FRAME.SIEGE) return;
    const n = dv.getUint16(2, true);

    this._vistos ??= new Set();
    this._vistos.clear();

    // 11 bytes por sitiante — o décimo primeiro é a VIDA. Ver `Siege.packFrame`.
    let o = 4;
    for (let i = 0; i < n; i++, o += 11) {
      const id = dv.getUint16(o, true);
      const x = dv.getInt16(o + 2, true) / 100;
      const y = dv.getInt16(o + 4, true) / 100;
      const z = dv.getInt16(o + 6, true) / 100;
      const yaw = (dv.getUint8(o + 8) / 255) * TAU;
      const flags = dv.getUint8(o + 9);
      const kind = KINDS[flags & 0x07] ?? "soldier";
      const state = STATES[(flags >> 3) & 0x07] ?? "walk";
      const dead = (flags & 0x40) !== 0;
      const fogo = (flags & 0x80) !== 0;
      const hp = dv.getUint8(o + 10) / 255;

      this._vistos.add(id);
      let b = this.byId.get(id);
      if (!b) {
        b = new BesiegerMesh(this.root, this.physics, `s${id}`, kind, x, y, z);
        if (magoDeMirante(kind, x, y, z)) b.virarMagoDeTorre();
        this.byId.set(id, b);
      }
      if (dead && !b.dead) {
        b.killLocal(fogo);
        this.arrows?.removeAttachedTo(b);
      }
      /* Instantâneo vivo MANDA: se o cliente matou por otimismo e o servidor
         não confirmou, o bicho volta. Sem isto o corpo fica tombado enquanto a
         IA de verdade continua andando invisível. Mesma regra do zumbi. */
      else if (!dead && b.dead) b.reviveLocal();
      b.setNetworkTarget(x, y, z, yaw, state, fogo);
      b.setHealth(hp);
    }

    for (const [id, b] of [...this.byId]) {
      if (this._vistos.has(id)) continue;
      this.byId.delete(id);
      /* ANTES do `dispose`: a flecha precisa sair enquanto o corpo dela ainda
         existe. Depois, o vínculo aponta para memória liberada. */
      this.arrows?.removeAttachedTo(b);
      b.dispose();
    }
  }

  /** O instantâneo de quem entra no meio — este vem em JSON, uma vez só. */
  applySnapshot(lista) {
    if (!Array.isArray(lista)) return;
    for (const item of lista) {
      const kind = KINDS[item.k] ?? "soldier";
      const [x, y, z] = item.p;
      let b = this.byId.get(item.id);
      if (!b) {
        b = new BesiegerMesh(this.root, this.physics, `s${item.id}`, kind, x, y, z);
        if (magoDeMirante(kind, x, y, z)) b.virarMagoDeTorre();
        this.byId.set(item.id, b);
      }
      b.setNetworkTarget(x, y, z, item.y, STATES[item.s] ?? "walk", item.f === 1);
      // O instantâneo traz a vida em quinze avos (ver `Siege.view`); o quadro
      // binário traz em 255. Quem entra no meio já vê a barra do ogro cheia
      // pela metade, em vez de esperar o primeiro dano para ela existir.
      if (item.h != null) b.setHealth(item.h / 15);
      if (item.d) b.killLocal(item.f === 1);
    }
  }

  /* ------------------------------------------------------------ eventos ---- */

  /**
   * Um sitiante caiu — e cada espécie cai com a PRÓPRIA voz.
   *
   * O som é a única coisa que diz O QUE morreu sem custar um olhar, e num modo
   * com 120 bichos na rampa isso decide o tiro seguinte: quem está mirando o
   * próximo da fila precisa saber, pelo canto do ouvido, se o que caiu atrás
   * dele foi mais um esqueleto ou o ogro. O id sai do `kind` do protocolo
   * (`deathOgre`, `deathHound`…), então acrescentar uma espécie é acrescentar
   * um buffer em `audio.js` e mais nada aqui.
   *
   * O VOLUME acompanha o tamanho. Não é mixagem por gosto: o ogro tem 6,5 m e
   * o mastim 1,0 m, e um bramido no mesmo nível de um ganido apagaria a única
   * informação que a diferença entre os dois carrega.
   */
  onDeath(msg) {
    const b = this.byId.get(msg.id);
    if (!b) return;

    const p = b.group?.position;
    if (p && msg.kind) {
      const som = `death${msg.kind[0].toUpperCase()}${msg.kind.slice(1)}`;
      const volume =
        msg.kind === "ogre" ? 1.0 : msg.kind === "catapult" ? 0.85 : 0.6;
      gameEvents.emit(EventType.AUDIO_PLAY, {
        sound: som,
        position: { x: p.x, y: p.y + 0.9, z: p.z },
        volume,
      });
    }

    b.killLocal(msg.head === true);
    this.arrows?.removeAttachedTo(b);
  }

  /** Raio de xamã, feixe de remontagem, pedra de catapulta ou rugido de ogro. */
  onShot(msg) {
    if (msg.kind === "rockImpact") {
      this.acenderFogo(msg.to[0], msg.to[2], 2.4, 1.2);
      return;
    }
    if (msg.kind === "rage") {
      /* O rugido do ogro: um clarão laranja curto no peito dele. Não é um som
         com imagem — é a imagem que o som acompanha, e é ela que faz alguém no
         outro canto do muro virar a cabeça. */
      this.clarao(msg.to[0], msg.to[1], msg.to[2], 3.2);
      return;
    }
    if (msg.kind === "boltImpact") {
      /* A bola do mago chegou. O clarão sai SEMPRE, tenha matado ou não: ele é
         a resposta à pergunta "por onde aquilo passou?", e quem escapou por um
         metro precisa da resposta tanto quanto quem morreu. */
      this.clarao(msg.to[0], msg.to[1], msg.to[2], 2.6);
      gameEvents.emit(EventType.PARTICLES, {
        position: { x: msg.to[0], y: msg.to[1], z: msg.to[2] },
        count: 34,
        color: 0x8affd8,
        speed: 13,
        spread: 1,
        size: 0.5,
        grow: 2.0,
        life: 0.8,
        gravity: CONFIG.physics.gravity * 0.2,
        drag: 0.7,
        alpha: 1,
      });
      return;
    }
    const cor =
      msg.kind === "bolt" ? 0x7affc8 : msg.kind === "raise" ? 0x9cff6a : 0xff8a3a;
    /* A BOLA DO MAGO É GRANDE, e é obrigatório que seja.
     *
     * Ela atravessa noventa metros de rampa e mata. Com os 16 cm do raio do
     * xamã de chão ela entra na tela com dois pixels a essa distância — e uma
     * ameaça que só se vê quando já está em cima não é uma ameaça, é um
     * sorteio. Quem carrega a leitura à distância é o HALO aditivo, e não o
     * núcleo: por isso o corpo pôde encolher de 0,55 para 0,4 sem custar
     * visibilidade nenhuma — de perto ele deixou de ser uma bola de praia
     * atravessada na tela, e de longe continua sendo o mesmo ponto verde
     * saindo do mirante. */
    const grande = msg.big === 1;
    const raio = msg.kind === "rock" ? 0.45 : grande ? 0.4 : msg.kind === "raise" ? 0.22 : 0.16;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(raio, grande ? 12 : 8, grande ? 10 : 6),
      new THREE.MeshBasicMaterial({ color: grande ? 0xd8fff0 : cor }),
    );
    if (grande) {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(raio * 2.3, 10, 8),
        new THREE.MeshBasicMaterial({
          color: cor,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.add(halo);
    }
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.root.add(mesh);
    const from = new THREE.Vector3(...msg.from);
    const to = new THREE.Vector3(...msg.to);
    const dur = msg.flight ?? from.distanceTo(to) / (msg.speed ?? 34);
    this.projeteis.push({ mesh, from, to, t: 0, dur, arco: msg.kind === "rock" });
  }

  /**
   * A pedra do trabuco caiu — a de qualquer um.
   *
   * A poça de piche e o clarão já estavam aqui; o que faltava era a EXPLOSÃO
   * ser explosão. Quem está no muro vê a pedra sair, some três segundos de
   * olho e o que voltava era um disco laranja acendendo no chão: o abate
   * acontecia (a sala decide em `Siege.blast`) e nada na tela ligava as duas
   * coisas. Fogo, terra e o baque fazem essa ligação — e são a diferença entre
   * "caiu uma pedra ali" e "aquilo matou a fila".
   */
  onTrebImpact(msg) {
    const [x, y, z] = msg.p;
    const T = CONFIG.modes.siege.trebuchet;
    this.acenderFogo(x, z, T.fireRadius, T.fireTime);
    this.clarao(x, y, z, T.blastRadius);

    const p = { x, y, z };
    gameEvents.emit(EventType.PARTICLES, {
      position: p,
      count: 90,
      color: 0xffb340,
      speed: 22,
      spread: 1,
      size: T.blastRadius * 0.22,
      grow: 2.4,
      life: 1.3,
      gravity: CONFIG.physics.gravity,
      drag: 0.6,
      alpha: 1,
    });
    gameEvents.emit(EventType.PARTICLES, {
      position: p,
      count: 55,
      color: 0x6b5b48,
      speed: 11,
      spread: 1,
      size: T.blastRadius * 0.34,
      grow: 3.0,
      life: 2.2,
      gravity: CONFIG.physics.gravity * 0.25,
      drag: 0.85,
      alpha: 0.5,
    });
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "explosion",
      position: p,
      volume: 0.85,
    });
  }

  onTrebState(msg) {
    if (!Array.isArray(msg.e)) return;
    for (const e of msg.e) {
      const t = this.engenhos[e.i];
      if (!t) continue;
      const total = CONFIG.modes.siege.trebuchet.reload;
      t.setReady(e.ready, e.ready ? 1 : 1 - Math.min(1, (e.left ?? total) / total));
    }
  }

  /** A pedra de outro jogador. Ela voa aqui também — mas não reporta nada. */
  onRemoteShot(msg) {
    const o = new THREE.Vector3(...msg.o);
    const d = new THREE.Vector3(...msg.d);
    this.pedras.push(new Stone(this.root, this.physics, o, d, msg.v, false));
    const t = this.engenhos[msg.i];
    if (t) {
      t.setReady(false, 0);
      t.swing = 0.0001;
    }
  }

  setStatus(msg) {
    this.status = msg;
    if (this.gate && typeof msg.gate === "number") this.gate.setHealth(msg.gate);
  }

  /* ------------------------------------------------------------- física ---- */

  /**
   * A PEDRA BATEU EM ALGUMA COISA.
   *
   * `a` e `b` do payload JÁ SÃO OS DONOS — `Physics.drainContacts` os resolve
   * antes de despachar, e é assim que `ArrowManager.handleContact` os lê. Aqui
   * eles estavam passando por `ownerOf()` outra vez, e `ownerOf` espera um
   * HANDLE de colisor: recebendo um objeto de dono, o `Map` não achava nada e
   * devolvia null, sempre.
   *
   * A consequência era silenciosa e total: `dono` nunca era encontrado, a pedra
   * jamais registrava impacto e o `C2S.TREB_IMPACT` jamais era enviado. Ou
   * seja — o trabuco nunca explodiu, desde sempre. A bola voava, encostava no
   * chão e ficava lá parada até o descarte por tempo de vida, sem estouro, sem
   * piche e sem matar ninguém. Nenhum erro aparecia, porque não havia erro
   * nenhum: era uma consulta legítima que respondia "não é uma pedra".
   */
  onContact({ a, b }) {
    const dono = a?.kind === "stone" ? a : b?.kind === "stone" ? b : null;
    if (!dono) return;
    const p = dono.stone.body?.translation();
    if (p) dono.stone.registerImpact(p);
  }

  /* -------------------------------------------------------------- fogo ----- */

  acenderFogo(x, z, raio, tempo) {
    /* Um disco no chão, deitado, com material aditivo. Não é decalque nem
       partícula: a poça precisa ser lida do alto do muro, a 60 m, no escuro —
       e é o brilho, não a forma, que faz isso. */
    const geo = new THREE.CircleGeometry(raio, 20);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff7a26,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, this.alturaDoChao(x, z) + 0.08, z);
    mesh.renderOrder = 3;
    this.root.add(mesh);
    this.fogos.push({ mesh, t: 0, dur: tempo });
  }

  clarao(x, y, z, raio) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(raio, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffd08a,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.position.set(x, y + 0.5, z);
    mesh.renderOrder = 6;
    this.root.add(mesh);
    this.fogos.push({ mesh, t: 0, dur: 0.35, clarao: true });
  }

  alturaDoChao(x, z) {
    return this.terrain?.heightAt(x, z) ?? 0;
  }

  /* ------------------------------------------------------------- a tecla --- */

  /**
   * Qual é a ação de `F` daqui, agora?
   *
   * Devolve `null` quando não há nenhuma — e é isso que o HUD lê para mostrar
   * a dica no lugar certo. Ver o cabeçalho para por que é uma tecla só.
   */
  acaoDisponivel(pos) {
    if (!this.ativo || !pos) return null;
    const T = CONFIG.modes.siege.trebuchet;
    let melhor = null;
    let melhorD = T.windRadius;
    for (const e of this.engenhos) {
      const d = Math.hypot(pos.x - e.base.x, pos.z - e.base.z);
      if (Math.abs(pos.y - e.base.y) > 3) continue;
      if (d < melhorD) {
        melhorD = d;
        melhor = e;
      }
    }
    if (melhor) {
      return { tipo: melhor.ready ? "atirar" : "içar", trabuco: melhor };
    }

    /* Reparo: do lado de DENTRO do portão, no pátio. A checagem de altura é o
       que impede reparar de cima do muro — que seria consertar a folha de
       carvalho a onze metros dela. */
    const G = gateInfo();
    const S = CONFIG.modes.siege;
    if (
      Math.abs(pos.y - GROUND_Y) < 3 &&
      Math.hypot(pos.x - G.x, pos.z - (G.z - S.repairRadius * 0.5)) < S.repairRadius &&
      this.gate &&
      !this.gate.fallen &&
      (this.status?.gate ?? 1) < S.repairCap
    ) {
      return { tipo: "reparar" };
    }
    return null;
  }

  /** `F` desceu. */
  usar(pos) {
    const acao = this.acaoDisponivel(pos);
    if (!acao) return null;
    this._segurando = true;
    if (acao.tipo === "atirar") {
      this.entrarNaMira(acao.trabuco);
    } else if (acao.tipo === "içar") {
      this._icando = acao.trabuco;
      this.net?.send(C2S.TREB_WIND, { i: acao.trabuco.id, on: true });
    } else {
      this._reparando = true;
      this.net?.send(C2S.GATE_REPAIR, { on: true });
    }
    return acao.tipo;
  }

  /**
   * `F` subiu.
   *
   * NÃO atira mais. Soltar `F` no trabuco só desiste da mira — quem dispara é
   * o CLIQUE, depois de a marca estar onde o jogador quer. É a diferença entre
   * uma arma que se aprende e uma que se adivinha; ver `entrarNaMira`.
   */
  soltar() {
    this._segurando = false;
    if (this._icando) {
      this.net?.send(C2S.TREB_WIND, { i: this._icando.id, on: false });
      this._icando = null;
    }
    if (this._reparando) {
      this.net?.send(C2S.GATE_REPAIR, { on: false });
      this._reparando = false;
    }
  }

  /* --------------------------------------------------------------- mira ----

     A MIRA DO TRABUCO, e por que ela é uma câmera inteira.

     A primeira versão era o arco outra vez: gire o corpo, segure para tensionar,
     solte para atirar. Não funcionou, e o motivo é simples de dizer e difícil de
     enxergar antes de jogar — **o jogador não tem como saber onde a pedra vai
     cair.** No arco, o retículo está sobre o alvo e a queda é a habilidade. Aqui
     a tensão é um número invisível, a pedra sai por cima do ombro, o alvo está
     cinquenta metros abaixo e o resultado só aparece três segundos depois. Não
     havia o que aprender: havia o que adivinhar.

     Agora o engenho tem MODO DE MIRA:

       • a câmera sobe e olha o castelo e a rampa de cima;
       • uma MARCA no chão mostra onde a pedra cai, com o arco desenhado até ela;
       • o mouse arrasta a marca, dentro do que o engenho alcança;
       • o clique solta.

     Nada disso é assistência: a marca é o resultado de INTEGRAR o voo com o
     mesmo arrasto que a pedra vai sofrer (`voar`), e a velocidade sai da busca
     binária inversa (`velocidadePara`). O que a tela mostra é o que vai
     acontecer — que é o oposto de facilitar, porque agora errar é escolha. */

  entrarNaMira(treb) {
    const T = CONFIG.modes.siege.trebuchet;
    const alturaSaida = treb.base.y + treb.muzzleHeight - GROUND_Y;
    this.mira = {
      treb,
      /* Distância no plano a partir do engenho. Começa no meio do alcance:
         é de onde a rampa está mais cheia. */
      dMin: voar(T.speedMin, alturaSaida, 0).d,
      dMax: voar(T.speedMax, alturaSaida, 0).d,
      alturaSaida,
      d: 0,
      yaw: 0,
      v: 0,
      pronto: false,
    };
    this.mira.d = (this.mira.dMin + this.mira.dMax) * 0.45;
    this.construirMarca();
    this.resolverMira();
  }

  sairDaMira() {
    if (!this.mira) return;
    if (this.marca) this.marca.visible = false;
    if (this.arco) this.arco.visible = false;
    this.mira = null;
  }

  /** O mouse arrasta a marca. `dx`/`dy` são os deltas do quadro, em radianos. */
  moverMira(dx, dy) {
    const m = this.mira;
    if (!m) return;
    const T = CONFIG.modes.siege.trebuchet;
    /* A sensibilidade é por METRO, não por ângulo: o jogador está arrastando
       uma marca no chão, e ela tem de responder à mão do mesmo jeito longe e
       perto. Um fator angular faria a marca voar nos 100 m e travar nos 40. */
    m.yaw = Math.max(-T.yawRange, Math.min(T.yawRange, m.yaw - dx * 1.1));
    m.d = Math.max(m.dMin, Math.min(m.dMax, m.d + dy * 90));
    this.resolverMira();
  }

  /** Onde a marca está, em coordenadas de mundo. */
  pontoDaMira(out = new THREE.Vector3()) {
    const m = this.mira;
    return out.set(
      m.treb.base.x + Math.sin(m.yaw) * m.d,
      GROUND_Y,
      m.treb.base.z + Math.cos(m.yaw) * m.d,
    );
  }

  /**
   * Resolve a velocidade para a marca atual e redesenha o arco.
   *
   * Uma busca binária de 22 passos sobre uma integração de ~300 — roda uma vez
   * por quadro enquanto se mira, e não aparece no perfil. É o preço de a marca
   * dizer a verdade em vez de uma parábola de livro.
   */
  resolverMira() {
    const m = this.mira;
    if (!m) return;
    const T = CONFIG.modes.siege.trebuchet;
    const alvo = this.pontoDaMira();
    let alvoY = this.terrain?.heightAt(alvo.x, alvo.z) ?? GROUND_Y;
    const saida = m.treb.base.y + m.treb.muzzleHeight;

    /* O ALCANCE É RECALCULADO CONTRA O CHÃO DE VERDADE, e não contra a cota do
     * pátio.
     *
     * `dMin`/`dMax` nascem em `entrarNaMira` com a altura de solta medida a
     * partir de `GROUND_Y` — mas a rampa DESCE catorze metros até o pé, e uma
     * pedra que cai mais longe vai mais longe. No fim curto isso passava do
     * engano estético para o defeito: a marca ficava presa a uma distância que
     * `velocidadePara` já considerava fora de alcance, devolvia `null`, e o
     * clique não fazia nada — com o anel vermelho como única explicação.
     *
     * Uma passada de correção basta: empurrar a marca para dentro do alcance
     * baixa o alvo, o que só AUMENTA o alcance, então não há oscilação. */
    let vMin = voar(T.speedMin, saida - alvoY, 0).d;
    let vMax = voar(T.speedMax, saida - alvoY, 0).d;
    if (m.d < vMin || m.d > vMax) {
      m.d = Math.max(vMin, Math.min(vMax, m.d));
      this.pontoDaMira(alvo);
      alvoY = this.terrain?.heightAt(alvo.x, alvo.z) ?? GROUND_Y;
      vMin = voar(T.speedMin, saida - alvoY, 0).d;
      vMax = voar(T.speedMax, saida - alvoY, 0).d;
      m.d = Math.max(vMin, Math.min(vMax, m.d));
      this.pontoDaMira(alvo);
      alvoY = this.terrain?.heightAt(alvo.x, alvo.z) ?? GROUND_Y;
    }
    alvo.y = alvoY;

    const v = velocidadePara(m.d, saida - alvoY, 0);
    m.v = v ?? 0;
    m.pronto = v != null && m.treb.ready;

    if (this.marca) {
      this.marca.position.set(alvo.x, alvoY + 0.06, alvo.z);
      this.marca.visible = true;
      /* Vermelho quando o engenho não está carregado: a marca continua
         mostrando ONDE cairia, e a cor diz que ainda não cai. */
      const cor = m.treb.ready ? 0xffc451 : 0xff5a48;
      this.marca.children[0].material.color.setHex(cor);
      this.marca.children[1].material.color.setHex(cor);
    }
    if (v == null) return;

    // O arco, amostrado da MESMA integração que decidiu a velocidade.
    const { pontos } = voar(v, saida - alvoY, 0, 26);
    const pos = this.arco.geometry.attributes.position;
    const sx = Math.sin(m.yaw);
    const sz = Math.cos(m.yaw);
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const p = pontos[Math.min(pontos.length - 1, Math.round((i / (n - 1)) * (pontos.length - 1)))];
      pos.setXYZ(i, m.treb.base.x + sx * p[0], alvoY + p[1], m.treb.base.z + sz * p[0]);
    }
    pos.needsUpdate = true;
    this.arco.geometry.computeBoundingSphere();
    this.arco.visible = true;
  }

  construirMarca() {
    if (this.marca) return;
    const anel = new THREE.Mesh(
      new THREE.RingGeometry(CONFIG.modes.siege.trebuchet.blastRadius * 0.82,
        CONFIG.modes.siege.trebuchet.blastRadius, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffc451,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    anel.rotation.x = -Math.PI / 2;
    /* O RAIO DO ANEL É O RAIO DO ESTOURO. Não é um enfeite de mira: o jogador
       precisa ver, antes de soltar, quanta gente cabe dentro dele. */
    const cruz = new THREE.Mesh(
      new THREE.RingGeometry(0, 0.35, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc451, transparent: true, opacity: 0.95, depthTest: false }),
    );
    cruz.rotation.x = -Math.PI / 2;

    this.marca = new THREE.Group();
    this.marca.add(anel, cruz);
    this.marca.renderOrder = 900;
    this.root.add(this.marca);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(26 * 3), 3));
    this.arco = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({
        color: 0xffc451,
        dashSize: 1.6,
        gapSize: 1.1,
        transparent: true,
        opacity: 0.75,
        depthTest: false,
      }),
    );
    this.arco.renderOrder = 899;
    this.arco.frustumCulled = false;
    this.root.add(this.arco);
  }

  /** O clique soltou a pedra. */
  dispararMira() {
    const m = this.mira;
    if (!m || !m.pronto) return false;
    const tiro = m.treb.fireAt(m.yaw, m.v);
    if (!tiro) return false;
    this.pedras.push(new Stone(this.root, this.physics, tiro.o, tiro.d, tiro.v, true));
    this.net?.send(C2S.TREB_SHOT, {
      i: m.treb.id,
      o: [tiro.o.x, tiro.o.y, tiro.o.z],
      d: [tiro.d.x, tiro.d.y, tiro.d.z],
      v: tiro.v,
    });
    this.sairDaMira();
    return true;
  }

  /**
   * Onde a câmera fica durante a mira: acima e atrás do engenho, olhando a
   * rampa. É a vista que responde à pergunta que a mira faz — "onde está o
   * aglomerado?" —, e ela não existe em nenhum outro momento do jogo.
   */
  camaraDaMira(posOut, alvoOut) {
    const m = this.mira;
    const b = m.treb.base;
    posOut.set(b.x * 0.4, b.y + 26, b.z - 20);
    const p = this.pontoDaMira();
    alvoOut.set(p.x * 0.5, GROUND_Y + 2, (p.z + b.z) * 0.5);
  }

  /* -------------------------------------------------------------- passo ---- */

  update(dt, camera, jogadorYaw = null, pos = null) {
    if (!this.ativo) return;

    // A câmera vai junto: a barra de vida do ogro é um billboard e precisa
    // dela para se virar. Ver `BesiegerMesh.setHealth`.
    for (const b of this.byId.values()) b.update(dt, camera);

    /* A armação acompanha a MARCA, não o corpo do jogador. Quem decide o rumo
       é onde a pedra vai cair — ver `entrarNaMira`. */
    if (camera) camera.getWorldPosition(_cam);
    for (const e of this.engenhos) {
      if (this.mira?.treb === e) {
        e.yaw += (this.mira.yaw - e.yaw) * Math.min(1, dt * 10);
      }
      /* A ferragem do engenho só existe de perto. 16 m é escolhido contra a
         GEOMETRIA e não contra um gosto: os bastiões estão a 18 m do posto
         central, então quem opera um engenho vê o detalhe do seu e a silhueta
         dos outros dois — que é exatamente a informação que ele precisa dos
         outros dois. Ver `Trebuchet.setDetalhe`. */
      if (camera) e.setDetalhe(_cam.distanceToSquared(e.base) < 256);
      // A câmera vai junto: a barra de recarga é um billboard e precisa dela
      // para se virar. Ver `Trebuchet.atualizarBarra`.
      e.update(dt, false, camera);
    }

    /* O ENGENHO FICOU PRONTO ENQUANTO SE MIRAVA. `pronto` só era recalculado
       ao mexer o mouse: quem entrava na mira de um trabuco vazio e esperava o
       içamento acabar continuava com a marca vermelha e o clique morto até
       arrastar a mira um pixel. */
    if (this.mira && this.mira.pronto !== (this.mira.v > 0 && this.mira.treb.ready)) {
      this.resolverMira();
    }

    this.atualizarPedras(dt);
    this.atualizarProjeteis(dt);
    this.atualizarFogo(dt);
    if (camera) this.atualizarLod(camera);
  }

  atualizarPedras(dt) {
    if (!this.pedras.length) return;
    const vivas = [];
    for (const p of this.pedras) {
      p.update(dt);
      if (!p.impact) {
        vivas.push(p);
        continue;
      }
      /* Só a MINHA pedra reporta. A do outro já foi reportada por ele, e duas
         mensagens para o mesmo estouro seriam dois piches e dois placares. */
      if (p.own) {
        this.net?.send(C2S.TREB_IMPACT, { p: [p.impact.x, p.impact.y, p.impact.z] });
      }
      p.dispose();
    }
    this.pedras = vivas;
  }

  atualizarProjeteis(dt) {
    if (!this.projeteis.length) return;
    const vivos = [];
    for (const p of this.projeteis) {
      p.t += dt;
      const f = Math.min(1, p.t / p.dur);
      _v.lerpVectors(p.from, p.to, f);
      // A pedra de catapulta descreve arco; o raio do xamã vai reto. É a
      // diferença que diz ao jogador qual dos dois dá para se abaixar.
      if (p.arco) _v.y += Math.sin(f * Math.PI) * p.from.distanceTo(p.to) * 0.16;
      p.mesh.position.copy(_v);
      if (f < 1) {
        vivos.push(p);
        continue;
      }
      this.root.remove(p.mesh);
      /* `traverse` e não os dois `dispose` diretos: a bola do mago carrega um
         halo pendurado nela, e liberar só o pai deixaria uma esfera de dez
         faces na GPU por bola disparada — algumas centenas por partida. */
      p.mesh.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    this.projeteis = vivos;
  }

  atualizarFogo(dt) {
    if (!this.fogos.length) return;
    const vivos = [];
    for (const f of this.fogos) {
      f.t += dt;
      const frac = 1 - f.t / f.dur;
      if (frac <= 0) {
        this.root.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
        continue;
      }
      if (f.clarao) {
        const s = 1 + (1 - frac) * 1.6;
        f.mesh.scale.set(s, s, s);
        f.mesh.material.opacity = frac * 0.85;
      } else {
        // A poça pisca: fogo parado lê como decalque.
        f.mesh.material.opacity = frac * (0.4 + Math.sin(f.t * 13) * 0.08);
      }
      vivos.push(f);
    }
    this.fogos = vivos;
  }

  /* ---------------------------------------------------------------- LOD ---- */

  /**
   * Três faixas, e a terceira é o que faz 120 caberem.
   *
   * Níveis 0 e 1 são o corpo articulado (com e sem membros); a partir do 2 o
   * grupo sai do render e o bicho passa a ser uma matriz numa `InstancedMesh`
   * por espécie — UMA chamada de desenho para os oitenta que estão longe.
   *
   * A conta por quadro continua sendo uma raiz quadrada por bicho, como em
   * `updateLodMap`; o que muda é o destino de quem passou do limiar.
   */
  atualizarLod(camera) {
    camera.getWorldPosition(_cam);
    for (const inst of this.instancias.values()) inst.n = 0;

    for (const b of this.byId.values()) {
      const nivel = lodLevel(b.position.distanceTo(_cam), b._lod ?? 0, b.lodScale);
      applyLod(b, Math.min(nivel, 2));
      if (nivel < 2) {
        b.setVisible(true);
        continue;
      }
      b.setVisible(false);
      if (nivel >= 3) continue; // longe demais até para a silhueta

      const inst = this.instanciaDe(b.kind);
      if (!inst || inst.n >= inst.mesh.instanceMatrix.count) continue;
      _q.setFromAxisAngle(EIXO_Y, b.yaw);
      _v.set(1, 1, 1).multiplyScalar(b.escala);
      _m4.compose(b.position, _q, _v);
      inst.mesh.setMatrixAt(inst.n++, _m4);
    }

    for (const inst of this.instancias.values()) {
      inst.mesh.count = inst.n;
      inst.mesh.instanceMatrix.needsUpdate = true;
      inst.mesh.visible = inst.n > 0;
    }
  }

  instanciaDe(kind) {
    let inst = this.instancias.get(kind);
    if (inst) return inst;
    const g = construirGeometrias(kind);
    if (!g?.corpo) return null;
    const f = FICHAS[kind];
    const mesh = new THREE.InstancedMesh(
      g.corpo,
      new THREE.MeshStandardMaterial({ color: f.pele, roughness: 0.95 }),
      CONFIG.modes.siege.maxAlive,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false; // a esta distância a sombra não desenha nada
    mesh.count = 0;
    mesh.name = `cerco-inst-${kind}`;
    this.root.add(mesh);
    inst = { mesh, n: 0 };
    this.instancias.set(kind, inst);
    return inst;
  }

  dispose() {
    this.physics.beforeStep.delete(this._stepCallback);
    this.physics.onContact.delete(this._contactCallback);
    for (const b of this._warmups ?? []) b.dispose();
    this._warmups = [];
    this.clear();
    for (const e of this.engenhos) e.dispose();
    this.engenhos = [];
    for (const inst of this.instancias.values()) {
      this.root.remove(inst.mesh);
      inst.mesh.dispose();
    }
    this.instancias.clear();
    this.root?.parent?.remove(this.root);
    this.root = null;
  }
}

const EIXO_Y = new THREE.Vector3(0, 1, 0);

/** Traz um ângulo para (−π, π]. */
function normalizar(a) {
  let d = a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}
