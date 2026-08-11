/* ---------------------------------------------------------------------------
   O que se mexe na Lua: poeira em suspensão, estrelas cadentes, naves que
   cruzam o céu e aliens que vêm atrás de você.

   Estão os quatro no mesmo arquivo porque são a mesma resposta a um problema
   só: **um cenário sem ar não tem nada se mexendo**. Não há grama balançando,
   não há nuvem passando, não há bandeira tremulando — e um mundo parado lê
   como tela congelada por mais bonito que seja. Cada peça daqui existe para
   dar movimento a uma camada de profundidade diferente: a poeira ao redor do
   jogador, as cadentes no infinito, as naves na média distância e os aliens no
   chão, onde a coisa vira jogo.

   ORÇAMENTO. Poeira e cadentes são DOIS `Points` — dois draw calls para o
   ambiente inteiro, e nenhum deles toca a física. As naves e os aliens são
   objetos de verdade com colisor, mas em contagem pequena e com corpo
   cinemático simples.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gameEvents, EventType, vec3Payload } from "../core/events.js";
import { makeRandom } from "../utils/math.js";
import { entityRegistry } from "../core/entityRegistry.js";

const TAU = Math.PI * 2;

/* ------------------------------------------------------------- ambiente --- */

/**
 * Poeira em suspensão e estrelas cadentes.
 *
 * A poeira é um truque de PROFUNDIDADE, não de realismo: no vácuo não há nada
 * pairando, mas sem partículas próximas o jogador perde toda a noção de
 * movimento ao voar de jetpack — o chão distante desliza devagar e o céu é
 * fixo, então nada diz "você está a doze metros por segundo". Os grãos passando
 * perto da câmera resolvem isso, e ficam raros o bastante para não virarem
 * neve.
 */
class Ambiente {
  constructor(parent, camera) {
    this.camera = camera;
    this.rnd = makeRandom(5150);

    /* ---------------------------------------------------------- poeira --- */
    this.N = 220;
    this.raio = 34; // m — a bolha que acompanha a câmera
    const pos = new Float32Array(this.N * 3);
    this.vel = new Float32Array(this.N * 3);
    for (let i = 0; i < this.N; i++) {
      this.semear(pos, i, true);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.poeira = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xcfd4dc,
        size: 0.055,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        fog: false,
      }),
    );
    this.poeira.frustumCulled = false;
    parent.add(this.poeira);

    /* -------------------------------------------------------- cadentes --- */
    /* Uma risca só de cada vez, reaproveitada. Um pool de meteoros para algo
       que aparece a cada quinze segundos seria memória parada. */
    const rastro = new THREE.BufferGeometry();
    rastro.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    this.cadente = new THREE.Line(
      rastro,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    );
    this.cadente.frustumCulled = false;
    parent.add(this.cadente);

    /* Estado da cadente: ESPERANDO (contagem até a próxima) ou VOANDO
       (progresso 0..1 ao longo do trajeto sorteado). Raras de propósito — no
       céu de verdade elas não são um espetáculo contínuo, e aparecer a cada
       poucos segundos vira ruído visual em vez de evento. */
    this.cadenteVoando = false;
    this.cadenteT = 20 + this.rnd() * 30;
    this.cadenteProgresso = 0;
    this.cadenteDuracao = 1.6;
    this._de = new THREE.Vector3();
    this._para = new THREE.Vector3();
    this._cadHead = new THREE.Vector3();
    this._cadTail = new THREE.Vector3();
  }

  semear(pos, i, inicial) {
    const c = this.camera.position;
    const a = this.rnd() * TAU;
    const b = Math.acos(2 * this.rnd() - 1);
    const r = this.raio * (inicial ? Math.cbrt(this.rnd()) : 1);
    pos[i * 3] = c.x + Math.sin(b) * Math.cos(a) * r;
    pos[i * 3 + 1] = c.y + Math.cos(b) * r;
    pos[i * 3 + 2] = c.z + Math.sin(b) * Math.sin(a) * r;
    // Deriva lenta e sem direção comum: é poeira, não vento.
    this.vel[i * 3] = (this.rnd() - 0.5) * 0.5;
    this.vel[i * 3 + 1] = (this.rnd() - 0.5) * 0.3;
    this.vel[i * 3 + 2] = (this.rnd() - 0.5) * 0.5;
  }

  update(dt) {
    const pos = this.poeira.geometry.attributes.position.array;
    const c = this.camera.position;
    const r2 = this.raio * this.raio;

    for (let i = 0; i < this.N; i++) {
      const k = i * 3;
      pos[k] += this.vel[k] * dt;
      pos[k + 1] += this.vel[k + 1] * dt;
      pos[k + 2] += this.vel[k + 2] * dt;

      /* A bolha ACOMPANHA a câmera: o grão que sai por trás reaparece na
         frente. Sem isso, voar 200 m deixaria a poeira toda para trás e o
         efeito sumiria justamente quando a velocidade é maior. */
      const dx = pos[k] - c.x;
      const dy = pos[k + 1] - c.y;
      const dz = pos[k + 2] - c.z;
      if (dx * dx + dy * dy + dz * dz > r2) this.semear(pos, i, false);
    }
    this.poeira.geometry.attributes.position.needsUpdate = true;

    /* -------------------------------------------------------- cadentes --- */
    if (!this.cadenteVoando) {
      this.cadenteT -= dt;
      if (this.cadenteT <= 0) this.lancarCadente(c);
    } else {
      this.cadenteProgresso += dt / this.cadenteDuracao;
      if (this.cadenteProgresso >= 1) {
        this.cadente.material.opacity = 0;
        this.cadenteVoando = false;
        // Rara: a próxima demora entre vinte e cinquenta segundos.
        this.cadenteT = 20 + this.rnd() * 30;
      } else {
        this.atualizarCadente(this.cadenteProgresso);
      }
    }
  }

  /** Sorteia o trajeto da próxima cadente, alta e longe, e a põe em voo. */
  lancarCadente(c) {
    const a = this.rnd() * TAU;
    const alt = 220 + this.rnd() * 180;
    const dist = 420;
    this._de.set(
      c.x + Math.cos(a) * dist,
      c.y + alt,
      c.z + Math.sin(a) * dist,
    );
    const dir = new THREE.Vector3(
      (this.rnd() - 0.5) * 2,
      -0.35 - this.rnd() * 0.4,
      (this.rnd() - 0.5) * 2,
    ).normalize();
    this._para.copy(this._de).addScaledVector(dir, 70 + this.rnd() * 60);

    this.cadenteVoando = true;
    this.cadenteProgresso = 0;
    this.cadenteDuracao = 1.3 + this.rnd() * 0.9;
    this.cadente.material.opacity = 0;
  }

  /**
   * Um METEORO cruzando o céu, não um palito que acende e apaga.
   *
   * A cabeça avança pelo trajeto sorteado; o RASTRO cresce atrás dela no
   * primeiro terço do voo (nasce sem cauda e ela se estica), se mantém no
   * meio e ENCOLHE no último terço — a cauda alcança a cabeça e as duas
   * somem juntas. É essa variação de comprimento, e não um fade abrupto,
   * que lê como "atravessando o céu" em vez de "piscou".
   */
  atualizarCadente(t) {
    const CRESCE_ATE = 0.3;
    const ENCOLHE_DE = 0.72;
    const RASTRO_MAX = 0.4; // fração do trajeto total, no pico do rastro

    let rastro;
    if (t < CRESCE_ATE) rastro = RASTRO_MAX * (t / CRESCE_ATE);
    else if (t < ENCOLHE_DE) rastro = RASTRO_MAX;
    else rastro = RASTRO_MAX * Math.max(0, (1 - t) / (1 - ENCOLHE_DE));

    const tCauda = Math.max(0, t - rastro);
    this._cadHead.lerpVectors(this._de, this._para, t);
    this._cadTail.lerpVectors(this._de, this._para, tCauda);

    const p = this.cadente.geometry.attributes.position.array;
    p[0] = this._cadTail.x; p[1] = this._cadTail.y; p[2] = this._cadTail.z;
    p[3] = this._cadHead.x; p[4] = this._cadHead.y; p[5] = this._cadHead.z;
    this.cadente.geometry.attributes.position.needsUpdate = true;

    // Entra e sai suave: sem isto a risca aparece e some num salto de
    // opacidade no primeiro e no último quadro do voo.
    const fadeIn = Math.min(1, t / 0.06);
    const fadeOut = Math.min(1, (1 - t) / 0.12);
    this.cadente.material.opacity = 0.85 * Math.min(fadeIn, fadeOut);
  }
}

/* ---------------------------------------------------------------- naves --- */

/**
 * Uma nave cruzando o céu — e derrubável.
 *
 * O colisor é uma esfera generosa (4 m) e não a silhueta: acertar algo que
 * atravessa o campo de visão a 26 m/s a duzentos metros de distância já é
 * difícil o suficiente sem exigir precisão de centímetro. A generosidade aqui
 * é o que transforma "impossível" em "difícil", que é onde está a graça.
 */
class Nave {
  constructor(scene, physics, rnd, centro) {
    this.physics = physics;
    this.morta = false;
    this.vidaAposMorte = 0;

    this.group = new THREE.Group();

    const casco = new THREE.MeshStandardMaterial({
      color: "#c9ccd2",
      roughness: 0.35,
      metalness: 0.8,
    });
    const vidro = new THREE.MeshStandardMaterial({
      color: "#39d6ff",
      roughness: 0.1,
      metalness: 0.2,
      emissive: new THREE.Color("#1e7fa8"),
      emissiveIntensity: 0.9,
    });

    // Disco voador: dois pratos e uma cúpula. É a silhueta que se lê contra o
    // preto num piscar de olhos, e ler rápido é o que dá tempo de atirar.
    const prato = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 0.9, 0.85, 18), casco);
    prato.position.y = 0.1;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 3.0, 0.7, 18), casco);
    base.position.y = -0.5;
    const cupula = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 16, 10, 0, TAU, 0, Math.PI / 2),
      vidro,
    );
    cupula.position.y = 0.5;
    this.group.add(prato, base, cupula);

    // Luzes de navegação em volta do prato: piscam e denunciam a nave antes de
    // a silhueta aparecer.
    this.luzes = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const luz = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 8, 6),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff3b30 : 0x39ff7a, fog: false }),
      );
      luz.position.set(Math.cos(a) * 2.9, -0.15, Math.sin(a) * 2.9);
      this.group.add(luz);
      this.luzes.push(luz);
    }

    /* Rota: uma reta que atravessa a arena inteira, numa altura de voo baixo o
       bastante para ser alvo e alta o bastante para não bater no foguete. */
    const ang = rnd() * TAU;
    const raio = 260;
    this.altura = 52 + rnd() * 26;
    this.de = new THREE.Vector3(
      centro.x + Math.cos(ang) * raio,
      this.altura,
      centro.z + Math.sin(ang) * raio,
    );
    const desvio = (rnd() - 0.5) * 120;
    this.para = new THREE.Vector3(
      centro.x - Math.cos(ang) * raio + Math.sin(ang) * desvio,
      this.altura - 6,
      centro.z - Math.sin(ang) * raio - Math.cos(ang) * desvio,
    );
    this.t = 0;
    this.duracao = this.de.distanceTo(this.para) / (22 + rnd() * 12);

    this.group.position.copy(this.de);
    this.group.lookAt(this.para);
    this.group.rotateX(Math.PI / 2); // o prato voa deitado
    scene.add(this.group);

    // Corpo cinemático + colisor esférico, registrado como alvo abatível.
    this.entityId = `ship${entityRegistry.createId()}`;
    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.de.x, this.de.y, this.de.z,
      ),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.ball(4.0).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, {
      kind: "ship",
      entityId: this.entityId,
      ship: this,
    });

    this.piscar = 0;
    this._v = new THREE.Vector3();
  }

  /** Levou uma flecha: perde o controle e cai girando. */
  abater() {
    if (this.morta) return false;
    this.morta = true;
    this.queda = 0;
    this.giro = (Math.random() - 0.5) * 4;
    // O colisor sai na hora: uma nave já abatida não deve consumir a segunda
    // flecha de ninguém enquanto desce.
    this.physics.removeBody(this.body);
    this.body = null;

    gameEvents.emit(EventType.PARTICLES, {
      position: vec3Payload(this.group.position),
      count: 40,
      color: 0xffc457,
      speed: 12,
      spread: 1,
      size: 0.5,
      grow: 2,
      life: 1.1,
      gravity: -1.62,
      drag: 0.4,
      alpha: 0.9,
    });
    return true;
  }

  update(dt, chaoY) {
    this.piscar += dt;
    const on = Math.sin(this.piscar * 6) > 0;
    for (let i = 0; i < this.luzes.length; i++) {
      this.luzes[i].visible = i % 2 === 0 ? on : !on;
    }

    if (this.morta) {
      /* A QUEDA. Sem propulsão e em 1/6 de g, ela desce devagar e girando —
         o que dá tempo de ver o resultado do próprio tiro, que é metade da
         recompensa de acertar. */
      this.queda += CONFIG.levels.moon.gravity * dt;
      this.group.position.y += this.queda * dt;
      this.group.rotation.z += this.giro * dt;
      this.group.rotation.x += this.giro * 0.6 * dt;

      // Fumaça enquanto cai.
      this.fumo = (this.fumo ?? 0) + dt;
      if (this.fumo > 0.06) {
        this.fumo = 0;
        gameEvents.emit(EventType.PARTICLES, {
          position: vec3Payload(this.group.position),
          count: 2,
          color: 0x6b6b6b,
          speed: 1.2,
          spread: 0.8,
          size: 0.4,
          grow: 2.4,
          life: 1.4,
          gravity: -0.3,
          drag: 0.6,
          alpha: 0.5,
        });
      }

      if (this.group.position.y <= chaoY + 1.5) return "explodiu";
      return null;
    }

    this.t += dt / this.duracao;
    if (this.t >= 1) return "saiu";
    this.group.position.lerpVectors(this.de, this.para, this.t);
    this.body?.setNextKinematicTranslation(this.group.position);
    return null;
  }

  dispose(scene) {
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
}

/* --------------------------------------------------------------- aliens --- */

/** m — distância em que o alien para de perseguir e ataca. */
const ALIEN_ATTACK_RANGE = 1.6;
/** s — quanto tempo os braços ficam subindo antes do golpe valer. */
const ALIEN_ATTACK_WINDUP = 0.5;
/** s — pausa depois de golpear, antes de poder golpear de novo. */
const ALIEN_ATTACK_COOLDOWN = 1.6;

/**
 * O alien: pequeno, verde e teimoso.
 *
 * Ele anda no chão em direção ao jogador mais próximo, e é isso. Não desvia,
 * não flanqueia, não salta — a graça dele é ser uma pressão constante enquanto
 * você está tentando fazer outra coisa, e uma IA elaborada aqui competiria com
 * o duelo pela atenção em vez de temperá-lo.
 */
class Alien {
  constructor(scene, physics, terrain, x, z) {
    this.physics = physics;
    this.terrain = terrain;
    this.dead = false;
    // Uma flechada mata — como o resto do bestiário pequeno do jogo (porco,
    // pássaro). Vida em dobro aqui só faria o jogador gastar a segunda flecha
    // achando que a primeira falhou, quando ela só não tinha efeito nenhum.
    this.hp = 1;
    /** Ataque corpo a corpo: "perseguindo" | "golpeando" | "recuando". */
    this.attackState = "perseguindo";
    this.attackT = 0;

    const pele = new THREE.MeshStandardMaterial({
      color: "#4fd44f",
      roughness: 0.55,
      metalness: 0.1,
      emissive: new THREE.Color("#0d3a0d"),
      emissiveIntensity: 0.5,
    });
    const olhoMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, fog: false });

    this.group = new THREE.Group();
    const corpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 5, 12), pele);
    corpo.position.y = 0.72;
    // Cabeça grande e ovalada — a silhueta clássica, e a que se lê de longe.
    const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 12), pele);
    cabeca.position.y = 1.42;
    cabeca.scale.set(1, 1.22, 0.92);
    this.group.add(corpo, cabeca);

    for (const lado of [-1, 1]) {
      const olho = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), olhoMat);
      olho.position.set(lado * 0.15, 1.46, 0.3);
      olho.scale.set(1, 1.5, 0.6);
      this.group.add(olho);

      const braco = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 4, 8), pele);
      braco.position.set(lado * 0.42, 0.86, 0);
      braco.rotation.z = lado * 0.32;
      this.group.add(braco);
      if (lado === -1) this.bracoE = braco;
      else this.bracoD = braco;

      const perna = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 4, 8), pele);
      perna.position.set(lado * 0.17, 0.26, 0);
      this.group.add(perna);
      if (lado === -1) this.pernaE = perna;
      else this.pernaD = perna;
    }
    for (const o of this.group.children) o.castShadow = true;

    this.group.position.set(x, terrain.heightAt(x, z), z);
    scene.add(this.group);

    this.entityId = `alien${entityRegistry.createId()}`;
    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, terrain.heightAt(x, z) + 0.9, z),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(0.45, 0.42).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, {
      kind: "alien",
      entityId: this.entityId,
      alien: this,
    });

    this.fase = Math.random() * TAU;
    this._alvo = new THREE.Vector3();
  }

  /** Levou uma flecha. Devolve true se morreu com esta. */
  atingir() {
    if (this.dead) return false;
    this.hp--;
    gameEvents.emit(EventType.PARTICLES, {
      position: vec3Payload(this.group.position),
      count: 14,
      color: 0x5cff5c,
      speed: 4,
      spread: 1,
      size: 0.16,
      grow: 1.6,
      life: 0.6,
      gravity: -1.62,
      drag: 1.2,
      alpha: 0.9,
    });
    if (this.hp > 0) return false;
    this.dead = true;
    if (this.body) {
      this.physics.removeBody(this.body);
      this.body = null;
    }
    gameEvents.emit(EventType.PARTICLES, {
      position: vec3Payload(this.group.position),
      count: 30,
      color: 0x39ff7a,
      speed: 7,
      spread: 1,
      size: 0.24,
      grow: 2,
      life: 0.9,
      gravity: -1.62,
      drag: 0.8,
      alpha: 0.9,
    });
    return true;
  }

  update(dt, alvos) {
    if (this.dead) {
      // Derrete no chão em vez de sumir num quadro.
      this.group.scale.multiplyScalar(Math.max(0, 1 - dt * 1.6));
      return this.group.scale.x < 0.05;
    }

    // O mais próximo, e só.
    let melhor = null;
    let melhorD = Infinity;
    for (const a of alvos) {
      const d = (a.x - this.group.position.x) ** 2 + (a.z - this.group.position.z) ** 2;
      if (d < melhorD) {
        melhorD = d;
        melhor = a;
      }
    }

    /* O GOLPE. Chegou perto, para de perseguir, ergue os braços — o aviso —
       e só depois do preparo é que o ataque conecta. Sem o aviso a morte
       chegaria no mesmo quadro em que o alien encostou, e não haveria o que
       reagir: nem recuar, nem virar e atirar nele primeiro. */
    if (this.attackState === "golpeando") {
      this.attackT += dt;
      this.ergueBracos(Math.min(1, this.attackT / ALIEN_ATTACK_WINDUP));
      if (melhor) {
        this.group.rotation.y = Math.atan2(
          melhor.x - this.group.position.x,
          melhor.z - this.group.position.z,
        );
      }
      if (this.attackT >= ALIEN_ATTACK_WINDUP) {
        // Ainda ao alcance? O alvo pode ter se afastado durante o preparo —
        // aí o golpe erra em vez de matar a distância.
        if (melhor) {
          const dGolpe = Math.hypot(
            melhor.x - this.group.position.x,
            melhor.z - this.group.position.z,
          );
          if (dGolpe <= ALIEN_ATTACK_RANGE + 0.4) {
            gameEvents.emit(EventType.ALIEN_MELEE_HIT, { position: melhor });
          }
        }
        this.attackState = "recuando";
        this.attackT = 0;
      }
      return false;
    }

    if (this.attackState === "recuando") {
      this.attackT += dt;
      this.ergueBracos(Math.max(0, 1 - this.attackT / 0.35));
      if (this.attackT >= ALIEN_ATTACK_COOLDOWN) {
        this.attackState = "perseguindo";
        this.attackT = 0;
      }
      return false;
    }

    if (!melhor) return false;

    const dx = melhor.x - this.group.position.x;
    const dz = melhor.z - this.group.position.z;
    const d = Math.hypot(dx, dz) || 1;

    if (d <= ALIEN_ATTACK_RANGE) {
      this.attackState = "golpeando";
      this.attackT = 0;
      this.group.rotation.y = Math.atan2(dx, dz);
      return false;
    }

    const v = 2.6;
    if (d > 1.4) {
      const nx = this.group.position.x + (dx / d) * v * dt;
      const nz = this.group.position.z + (dz / d) * v * dt;
      if (this.terrain.isWalkable(nx, nz)) {
        this.group.position.set(nx, this.terrain.heightAt(nx, nz), nz);
      }
      // Passada: as pernas alternam com a distância, como a do arqueiro.
      this.fase += (v * dt) / 0.6;
      const s = Math.sin(this.fase) * 0.28;
      if (this.pernaE) this.pernaE.position.z = s;
      if (this.pernaD) this.pernaD.position.z = -s;
    }
    this.group.rotation.y = Math.atan2(dx, dz);
    this.body?.setNextKinematicTranslation({
      x: this.group.position.x,
      y: this.group.position.y + 0.9,
      z: this.group.position.z,
    });
    return false;
  }

  /** Pose do golpe: os dois braços sobem juntos, `t` = 0 (repouso) .. 1 (erguidos). */
  ergueBracos(t) {
    const ang = -t * 2.2;
    if (this.bracoE) this.bracoE.rotation.x = ang;
    if (this.bracoD) this.bracoD.rotation.x = ang;
  }

  dispose(scene) {
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
}

/* ------------------------------------------------------------- o sistema -- */

export class SpaceLife {
  /**
   * @param {THREE.Object3D} parent raiz da fase — tudo morre com ela
   */
  constructor(parent, scene, physics, terrain, camera) {
    this.parent = parent;
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.rnd = makeRandom(24601);

    this.ambiente = new Ambiente(parent, camera);
    this.naves = [];
    this.aliens = [];
    this.tNave = 6;
    this.tAlien = 12;
    this.centro = { x: terrain.centerX, z: terrain.centerZ };
  }

  /**
   * @param {Array<{x:number,z:number}>} jogadores quem os aliens perseguem
   */
  update(dt, jogadores) {
    this.ambiente.update(dt);

    /* ----------------------------------------------------------- naves --- */
    this.tNave -= dt;
    if (this.tNave <= 0 && this.naves.length < 2) {
      this.tNave = 14 + this.rnd() * 22;
      this.naves.push(new Nave(this.parent, this.physics, this.rnd, this.centro));
    }
    for (let i = this.naves.length - 1; i >= 0; i--) {
      const n = this.naves[i];
      const chao = this.terrain.heightAt(n.group.position.x, n.group.position.z);
      const fim = n.update(dt, chao);
      if (fim === "explodiu") {
        this.explodir(n.group.position, chao);
        n.dispose(this.parent);
        this.naves.splice(i, 1);
      } else if (fim === "saiu") {
        n.dispose(this.parent);
        this.naves.splice(i, 1);
      }
    }

    /* ---------------------------------------------------------- aliens --- */
    this.tAlien -= dt;
    if (this.tAlien <= 0 && this.aliens.length < 6 && jogadores.length) {
      this.tAlien = 16 + this.rnd() * 20;
      // Nasce longe, na direção de um jogador sorteado: chegar leva tempo, e é
      // esse tempo que dá para reagir em vez de ser surpreendido.
      const alvo = jogadores[Math.floor(this.rnd() * jogadores.length)];
      const a = this.rnd() * TAU;
      const d = 48 + this.rnd() * 40;
      const x = alvo.x + Math.cos(a) * d;
      const z = alvo.z + Math.sin(a) * d;
      if (this.terrain.isWalkable(x, z)) {
        this.aliens.push(new Alien(this.scene, this.physics, this.terrain, x, z));
      }
    }
    for (let i = this.aliens.length - 1; i >= 0; i--) {
      if (this.aliens[i].update(dt, jogadores)) {
        this.aliens[i].dispose(this.scene);
        this.aliens.splice(i, 1);
      }
    }
  }

  /** A nave bateu no chão. */
  explodir(pos, chaoY) {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: pos.x, y: chaoY + 1, z: pos.z },
      count: 90,
      color: 0xffb340,
      speed: 20,
      spread: 1,
      size: 0.7,
      grow: 2.6,
      life: 1.6,
      gravity: -1.62,
      drag: 0.5,
      alpha: 1,
    });
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: pos.x, y: chaoY + 1, z: pos.z },
      count: 60,
      color: 0x5a5a5a,
      speed: 9,
      spread: 1,
      size: 1.2,
      grow: 3.2,
      life: 2.6,
      gravity: -0.4,
      drag: 0.8,
      alpha: 0.6,
    });
    gameEvents.emit(EventType.AUDIO_PLAY, {
      sound: "hitScenery",
      position: { x: pos.x, y: chaoY + 1, z: pos.z },
      volume: 1.6,
    });
  }

  /**
   * O rover atropelou. Mesmo caminho de morte de uma flechada — `atingir()`
   * já mata em um golpe (`hp = 1`) — só que sem flecha nenhuma envolvida.
   * Chamado por `levels/moonLevel.js`, que é quem conhece os dois lados
   * (o rover mora em `base`, os aliens moram aqui).
   */
  killAliensNear(x, z, radius) {
    const r2 = radius * radius;
    for (const a of this.aliens) {
      if (a.dead) continue;
      const dx = a.group.position.x - x;
      const dz = a.group.position.z - z;
      if (dx * dx + dz * dz <= r2) a.atingir();
    }
  }

  dispose() {
    for (const n of this.naves) n.dispose(this.parent);
    for (const a of this.aliens) a.dispose(this.scene);
    this.naves = [];
    this.aliens = [];
  }
}
