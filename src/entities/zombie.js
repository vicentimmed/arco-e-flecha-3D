/* ---------------------------------------------------------------------------
   Zumbi — corpo, marcha, olhos e fogo.

   Como o porco e o alce, A INTELIGÊNCIA NÃO MORA AQUI: para onde ele anda, quem
   ele ataca e quando a horda vira são decididos em `server/zombieSim.js`. Aqui
   chegam posição, ângulo e estado a 10 Hz, e é montado o resto.

   DUAS DECISÕES DE CONSTRUÇÃO, as duas por causa do número deles:

   1. O corpo nasce MESCLADO POR MATERIAL — 7 meshes, não os 21 do porco. Na
      horda 10 são 21 zumbis vivos ao mesmo tempo; a 21 meshes cada, seriam 441
      draw calls só de bicho, mais o passe de sombra. Mesclado, são 147.

   2. Os OLHOS usam `MeshBasicMaterial`, que ignora a iluminação da cena.
      Não é economia — é o modo inteiro. À noite, fora do alcance das tochas, o
      corpo desaparece no breu e sobram dois pontos vermelhos vindo na sua
      direção. É assim que o jogador conta quantos vêm e de onde, muito antes de
      conseguir mirar em alguma coisa. Um material iluminado apagaria junto com o
      resto e a horda chegaria invisível.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { entityRegistry } from "../core/entityRegistry.js";
import { damp } from "../utils/math.js";

const H = 1.8; // m — altura do zumbi de pé

/* Vetores de módulo para o descarte dos olhos: `cullEyes` roda 21 vezes por
   quadro e não pode alocar. Ver o comentário do método. */
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
/** cos(99°) — além deste ângulo em relação ao eixo da câmera, os olhos saem. */
const COS_EYE_CULL = Math.cos(Math.PI * 0.55);

/* Materiais de módulo: ao contrário do arqueiro, nenhum zumbi é tingido
   individualmente, então compartilhar é economia pura. */
const MAT = {
  // Carne acinzentada e roupa em farrapos: dois tons próximos, porque à noite o
  // que separa o zumbi do fundo é a silhueta, não a cor.
  flesh: new THREE.MeshStandardMaterial({ color: "#7d8a6e", roughness: 0.95 }),
  cloth: new THREE.MeshStandardMaterial({ color: "#3b3f36", roughness: 1.0 }),
  /* Os olhos. `MeshBasicMaterial` não recebe luz: eles brilham igual no escuro
     total e é isso que anuncia a horda. `fog: false` para a névoa da noite não
     apagá-los à distância — é justamente de longe que eles precisam ser vistos. */
  eye: new THREE.MeshBasicMaterial({
    color: CONFIG.modes.zombie.eyeColor,
    fog: false,
  }),
  fire: new THREE.MeshBasicMaterial({
    color: 0xff8a2a,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    fog: false,
  }),
};

/* As geometrias são construídas UMA VEZ e reaproveitadas por todos os zumbis.
   Com 21 em campo, reconstruir seis geometrias por bicho a cada horda seria
   trabalho jogado fora — e um pico de GC bem no instante em que a horda entra. */
let SHARED = null;

function buildShared() {
  if (SHARED) return SHARED;

  // --- tronco + cabeça + quadril, numa peça só ---------------------------
  const torso = new THREE.CapsuleGeometry(0.19, 0.44, 4, 10);
  torso.scale(1.0, 1.0, 0.72); // achatado: um corpo seco, não um barril
  torso.translate(0, 1.16, 0);

  const quadril = new THREE.CapsuleGeometry(0.16, 0.1, 3, 8);
  quadril.translate(0, 0.86, 0);

  const pescoco = new THREE.CylinderGeometry(0.055, 0.065, 0.1, 6);
  pescoco.translate(0, 1.5, 0);

  const cranio = new THREE.SphereGeometry(0.13, 10, 8);
  cranio.scale(0.92, 1.06, 1.0);
  cranio.translate(0, 1.62, 0);

  // A mandíbula caída é o que faz a cabeça ler como zumbi em silhueta.
  const mandibula = new THREE.BoxGeometry(0.11, 0.07, 0.09);
  mandibula.translate(0, 1.52, -0.07);

  const corpo = mergeGeometries([torso, quadril, pescoco, cranio, mandibula]);

  // --- os dois olhos, numa peça só --------------------------------------
  const olhos = mergeGeometries(
    [-1, 1].map((lado) => {
      const g = new THREE.SphereGeometry(0.028, 7, 5);
      g.translate(lado * 0.052, 1.655, -0.108);
      return g;
    }),
  );

  // --- braço: ombro → mão, esticado para a frente ------------------------
  // A geometria nasce com o ombro na ORIGEM para o grupo poder girá-la pelo
  // ombro; o `translate` de posição vive no grupo, não aqui.
  const bracoSup = new THREE.CapsuleGeometry(0.058, 0.24, 3, 7);
  bracoSup.rotateX(Math.PI / 2);
  bracoSup.translate(0, 0, -0.17);
  const bracoInf = new THREE.CapsuleGeometry(0.05, 0.22, 3, 7);
  bracoInf.rotateX(Math.PI / 2);
  bracoInf.translate(0, -0.02, -0.46);
  const mao = new THREE.BoxGeometry(0.075, 0.05, 0.11);
  mao.translate(0, -0.03, -0.63);
  const braco = mergeGeometries([bracoSup, bracoInf, mao]);

  // --- perna: quadril → pé ----------------------------------------------
  const coxa = new THREE.CapsuleGeometry(0.075, 0.3, 3, 7);
  coxa.translate(0, -0.22, 0);
  const canela = new THREE.CapsuleGeometry(0.06, 0.28, 3, 7);
  canela.translate(0, -0.58, 0);
  const pe = new THREE.BoxGeometry(0.1, 0.07, 0.2);
  pe.translate(0, -0.83, -0.04);
  const perna = mergeGeometries([coxa, canela, pe]);

  // --- a labareda -------------------------------------------------------
  const chama = new THREE.ConeGeometry(0.42, 1.5, 7, 1, true);
  chama.translate(0, 1.0, 0);

  SHARED = { corpo, olhos, braco, perna, chama };
  return SHARED;
}

export class Zombie {
  constructor(scene, physics, terrain, entityId, x, z) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.entityId = entityId;
    this.netTarget = null;
    this.dead = false;
    this.state = "walk";
    /** Pegou fogo (morte por tiro na cabeça). */
    this.burning = false;
    this.burnTime = 0;
    /** Conta-gotas das brasas enquanto queima — ver `updateDeath`. */
    this.emberTimer = 0;
    this.deathRoll = 0;
    this.animPhase = Math.random() * Math.PI * 2;
    this.moanTimer = this._nextMoanDelay();

    const y = terrain.heightAt(x, z);
    this.position = new THREE.Vector3(x, y, z);
    this.yaw = 0;
    this.speed = 0;

    this.group = new THREE.Group();
    this.group.name = `zombie-${entityId}`;
    this.buildMesh();
    this.group.position.copy(this.position);
    scene.add(this.group);

    const Z = CONFIG.modes.zombie;
    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + H / 2, z),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(H / 2 - 0.28, 0.28).setActiveEvents(
        RAPIER.ActiveEvents.COLLISION_EVENTS,
      ),
      this.body,
    );
    physics.register(this.collider, { kind: "zombie", entityId, zombie: this });
    entityRegistry.register(entityId, this);
  }

  buildMesh() {
    const S = buildShared();
    const root = new THREE.Group();

    /* LOD (ver `utils/lod.js`). Aqui ele é DESENHADO PELA NÉVOA, não escolhido:
       com `fogDensityNight` a 0,017, um corpo a 60 m já está 65 % apagado e a
       80 m não existe mais na imagem. Desenhá-lo é pagar cinco chamadas por
       zumbi para pintar névoa. Na horda 10 são 21 bichos — cem chamadas.

       Os OLHOS ficam de fora das duas listas de propósito: eles têm
       `fog: false` e continuam visíveis até o nível 3. É a regra do modo — a
       horda se anuncia como pares de pontos vermelhos vindo do breu, muito
       antes de haver corpo para mirar. Cortá-los junto com o corpo mataria o
       modo para economizar uma chamada de desenho. */
    this.lodDetail = null;
    this.lodBulk = [];

    this.corpo = new THREE.Mesh(S.corpo, MAT.flesh);
    this.corpo.castShadow = true;
    root.add(this.corpo);
    this.lodBulk.push(this.corpo);

    this.olhos = new THREE.Mesh(S.olhos, MAT.eye);
    // Nunca descartado pelo frustum: os olhos são pontos de 3 cm a 40 m de
    // distância, e o teste por caixa envolvente os elimina em ângulos rasantes
    // justamente quando eles são a única coisa visível do bicho.
    this.olhos.frustumCulled = false;
    this.olhos.renderOrder = 4;
    root.add(this.olhos);

    this.bracos = [];
    for (const lado of [-1, 1]) {
      const b = new THREE.Group();
      b.position.set(lado * 0.21, 1.36, 0);
      const m = new THREE.Mesh(S.braco, MAT.cloth);
      m.castShadow = true;
      b.add(m);
      // Braços esticados para a frente, um pouco abertos: a pose que se lê como
      // zumbi mesmo em silhueta contra o escuro.
      b.rotation.x = -1.35;
      b.rotation.z = lado * 0.12;
      root.add(b);
      this.bracos.push(b);
      this.lodBulk.push(b);
    }

    this.pernas = [];
    for (const lado of [-1, 1]) {
      const p = new THREE.Group();
      p.position.set(lado * 0.1, 0.88, 0);
      const m = new THREE.Mesh(S.perna, MAT.cloth);
      m.castShadow = true;
      p.add(m);
      root.add(p);
      this.pernas.push(p);
      this.lodBulk.push(p);
    }

    this.chama = new THREE.Mesh(S.chama, MAT.fire);
    this.chama.visible = false;
    this.chama.frustumCulled = false;
    this.chama.renderOrder = 6;
    root.add(this.chama);

    this.group.add(root);
    this.visualRoot = root;
  }

  _nextMoanDelay() {
    const Z = CONFIG.modes.zombie;
    return Z.moanMinInterval + Math.random() * (Z.moanMaxInterval - Z.moanMinInterval);
  }

  /* -------------------------------------------------------------- impacto -- */

  /**
   * Uma flecha entrou. Só o AVISO sai daqui — quem conta os acertos e decide a
   * morte é o servidor, como no alce.
   */
  registerHit(impact, arrow, head) {
    if (this.dead) return;
    gameEvents.emit(EventType.ZOMBIE_HIT, {
      zombieId: this.entityId,
      head,
      impact: vec3Payload(impact),
      arrowId: arrow?.id,
      ownerId: arrow?.ownerEntityId ?? null,
      distance: arrow ? arrow.launchPosition.distanceTo(impact) : 0,
    });
  }

  /* -------------------------------------------------------------- em rede -- */

  setNetworkTarget(p, yaw, state, burning) {
    this.netTarget = { x: p[0], y: p[1], z: p[2], yaw, state, burning };
  }

  /**
   * Caiu.
   *
   * `head` decide COMO ele cai: no corpo, tomba e acabou; na cabeça, pega fogo
   * primeiro e só então desaba. A diferença é o retorno do tiro difícil — quem
   * acerta a cabeça vê algo que quem acerta o peito não vê.
   */
  killLocal(head = false) {
    if (this.dead) return;
    this.dead = true;
    this.state = "dead";
    this.speed = 0;
    if (head) {
      this.burning = true;
      this.burnTime = 0;
      this.emberTimer = 0;
      this.chama.visible = true;
      /* O estouro inicial das brasas. Sai do pool compartilhado
         (`systems/particles.js`), então vinte e uma mortes simultâneas na horda
         10 continuam custando os mesmos dois draw calls que uma só. */
      gameEvents.emit(EventType.PARTICLES, {
        position: { x: this.position.x, y: this.position.y + 1.4, z: this.position.z },
        count: 14,
        color: 0xff9a34,
        speed: 2.6,
        spread: 0.85,
        direction: { x: 0, y: 1, z: 0 },
        size: 0.1,
        grow: -0.5,
        life: 0.85,
        gravity: 1.4, // brasa SOBE: é o ar quente que a carrega
        drag: 1.6,
        additive: true,
      });
    }
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "zombieDeath",
      position: vec3Payload(this.position),
      volume: 1.0,
    });
  }

  dispose() {
    this.physics.unregister(this.collider);
    this.physics.removeBody(this.body);
    entityRegistry.unregister(this.entityId);
    this.scene.remove(this.group);
    // As geometrias são COMPARTILHADAS entre todos os zumbis: descartá-las aqui
    // apagaria os outros da tela. Só o que é desta instância morre com ela.
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry = null;
    });
  }

  /**
   * Descarte manual dos olhos (o frustum automático está desligado neles).
   *
   * `frustumCulled = false` resolve o problema de os olhos sumirem em ângulos
   * rasantes — a caixa envolvente de duas esferas de 3 cm é pequena demais para
   * o teste por caixa acertar — mas o preço é que eles são desenhados SEMPRE,
   * inclusive quando estão atrás da câmera. Com 21 zumbis em volta, metade da
   * horda está atrás de você a qualquer momento.
   *
   * O teste aqui é por ÂNGULO, não por caixa: se o bicho está a mais de ~99° do
   * eixo da câmera, ele está fora de qualquer campo de visão possível e os olhos
   * saem. A folga sobre o meio-FOV (58° ⇒ ~35° na vertical, mais a diagonal) é
   * larga de propósito — errar para o lado de desenhar demais custa uma chamada;
   * errar para o outro apaga o único traço visível da horda.
   */
  cullEyes(camera) {
    if (!camera) return;
    _dir.copy(this.position).sub(camera.position);
    const d = _dir.length();
    if (d < 1e-3) return;
    _dir.divideScalar(d);
    camera.getWorldDirection(_fwd);
    this.olhos.visible = _dir.dot(_fwd) > COS_EYE_CULL;
  }

  update(dt, camera) {
    if (this.dead) {
      this.updateDeath(dt);
      this.cullEyes(camera);
      return;
    }

    const alvo = this.netTarget;
    if (alvo) {
      const k = 11;
      const antes = this.position.clone();
      this.position.x = damp(this.position.x, alvo.x, k, dt);
      this.position.y = damp(this.position.y, alvo.y, k, dt);
      this.position.z = damp(this.position.z, alvo.z, k, dt);
      let d = alvo.yaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-k * dt));
      this.speed = antes.distanceTo(this.position) / Math.max(dt, 1e-4);
      this.state = alvo.state;
    }

    this.animate(dt);
    this.updateMoan(dt);
    this.cullEyes(camera);
    this.syncPhysics();
  }

  /** Fogo primeiro, tombo depois — e o fogo some junto com o corpo. */
  updateDeath(dt) {
    const Z = CONFIG.modes.zombie;
    if (this.burning) {
      this.burnTime += dt;
      const p = Math.min(1, this.burnTime / Z.burnTime);
      // A labareda sobe rápido, treme e apaga.
      const tremor = 0.85 + 0.3 * Math.sin(this.burnTime * 27);
      this.chama.scale.set(tremor, (0.6 + p * 0.9) * tremor, tremor);
      this.chama.material.opacity = 0.92 * (1 - p * p);
      this.chama.visible = p < 1;

      /* Brasas soltando enquanto queima, num gotejamento fixo de ~12 por
         segundo. Contar o tempo (e não emitir por quadro) é o que faz o efeito
         ficar igual a 60 e a 144 Hz — por quadro, quem tem monitor rápido veria
         o dobro de fogo. */
      this.emberTimer -= dt;
      if (this.emberTimer <= 0 && p < 0.9) {
        this.emberTimer = 1 / 12;
        gameEvents.emit(EventType.PARTICLES, {
          position: {
            x: this.position.x,
            y: this.position.y + 0.9 + Math.random() * 0.8,
            z: this.position.z,
          },
          count: 2,
          color: 0xffb347,
          speed: 1.1,
          spread: 0.6,
          direction: { x: 0, y: 1, z: 0 },
          size: 0.07,
          grow: -0.4,
          life: 0.7,
          gravity: 1.1,
          drag: 1.1,
          additive: true,
        });
      }
      // Enquanto queima ele ainda está de pé; o tombo começa na metade.
      if (p < 0.45) {
        this.group.position.copy(this.position);
        return;
      }
    }

    this.deathRoll = Math.min(Math.PI / 2, this.deathRoll + dt * 3.2);
    this.visualRoot.rotation.x = this.deathRoll;
    this.visualRoot.position.y = -0.22 * (this.deathRoll / (Math.PI / 2));
    this.group.position.copy(this.position);
  }

  /**
   * A marcha arrastada.
   *
   * Como no arqueiro e no porco, a fase avança com a DISTÂNCIA percorrida e não
   * com o relógio — mas aqui o efeito é o oposto do que costuma ser: como o
   * zumbi anda a 1,15 m/s, a cadência sai naturalmente lenta, sem nenhum
   * multiplicador. É a mesma regra produzindo o passo pesado.
   */
  animate(dt) {
    this.group.position.copy(this.position);
    // A malha (olhos, mandíbula, braços) foi construída de frente para -Z, e
    // não para +Z como o porco e o alce — sem o giro de 180°, o zumbi mostrava
    // a nuca para o rumo em que estava andando, e os olhos só apareciam para
    // quem desse a volta nele.
    this.group.rotation.y = this.yaw + Math.PI;

    const passada = 1.15; // m por ciclo completo
    this.animPhase += (Math.PI * 2 * this.speed * dt) / passada + dt * 0.55;

    const andando = this.speed > 0.15;
    const abertura = andando ? 0.42 : 0.06;
    const swing = Math.sin(this.animPhase) * abertura;
    this.pernas[0].rotation.x = swing;
    this.pernas[1].rotation.x = -swing;

    // O tronco pende e balança: o zumbi não tem tônus, ele se joga para a frente
    // e o corpo acompanha meio passo atrasado.
    this.visualRoot.rotation.x = 0.13 + Math.sin(this.animPhase * 2) * 0.035;
    this.visualRoot.rotation.z = Math.sin(this.animPhase) * 0.07;

    // Os braços oscilam pouco e fora de fase com as pernas.
    const bracoSwing = Math.sin(this.animPhase + 0.9) * (andando ? 0.16 : 0.04);
    this.bracos[0].rotation.x = -1.35 + bracoSwing;
    this.bracos[1].rotation.x = -1.35 - bracoSwing;

    // Atacando, os braços sobem e fecham.
    if (this.state === "attack") {
      this.bracos[0].rotation.x = -1.9 + Math.sin(this.animPhase * 6) * 0.25;
      this.bracos[1].rotation.x = -1.9 - Math.sin(this.animPhase * 6) * 0.25;
    }
  }

  /** O gemido. Sorteado LOCALMENTE, como o ronco do porco — é som ambiente. */
  updateMoan(dt) {
    this.moanTimer -= dt;
    if (this.moanTimer > 0) return;
    this.moanTimer = this._nextMoanDelay();
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "zombieMoan",
      position: vec3Payload(this.position),
      volume: CONFIG.modes.zombie.moanVolume,
    });
  }

  syncPhysics() {
    this.body.setTranslation(
      { x: this.position.x, y: this.position.y + H / 2, z: this.position.z },
      true,
    );
  }
}
