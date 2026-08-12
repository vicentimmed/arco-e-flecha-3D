/* ---------------------------------------------------------------------------
   O trabuco de muralha, e a pedra em chamas que ele cospe.

   É o que faz o cerco não ser "modo zumbi com muro". Ver §5 de
   `docs/plano-cerco.md`.

   ------------------------------------------------------- a decisão que manda

   **O ângulo de solta é FIXO em 45°.** O arco é mira livre; o trabuco não pode
   ser, senão ele é um arco que causa mais dano e o arco morre. Um trabuco de
   verdade tem ângulo de solta fixo e alcance dado pelo contrapeso, e essa
   restrição é justamente a que interessa:

     • azimute — o jogador gira a armação, dentro de ±40°;
     • alcance — a tensão do contrapeso, segurada como se segura o arco.

   Mirar no trabuco é escolher ONDE, no chão; mirar no arco é escolher PARA
   ONDE, no ar. São duas habilidades diferentes, e é por isso que as duas armas
   convivem em vez de uma substituir a outra.

   E a consequência que fecha o desenho: com 45° fixos o alcance mínimo é
   v²/g = 33 m. **O trabuco não alcança o pé do próprio muro.** Ele é a arma da
   aproximação, o arco é a arma do portão.

   ------------------------------------------------------------------- a pedra

   Corpo rígido de verdade, pelas mesmas regras da flecha e com a mesma conta de
   arrasto — 25 kg, raio de 0,14 m (calcário), Cd de esfera. A 33 m/s isso dá
   0,77 m/s² de desaceleração, 8 % de g: parábola quase limpa, vento que entorta
   pouco mas entorta. Nada disso é código novo; é a mesma integração que
   `entities/arrow.js` já roda, com outra área e outra massa.

   Quem atira é a AUTORIDADE sobre a própria pedra, como na flecha: ele simula,
   ele reporta o impacto, e a sala decide quem morreu no estouro (porque isso é
   placar). Custo de rede por quadro: zero. Ver `S2C.TREB_SHOT`.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { ARROW_COLLISION_GROUPS } from "../core/collisionGroups.js";

const MAT = {
  viga: new THREE.MeshStandardMaterial({ color: "#4a3627", roughness: 0.92 }),
  ferro: new THREE.MeshStandardMaterial({ color: "#2b2b2e", roughness: 0.5, metalness: 0.7 }),
  contrapeso: new THREE.MeshStandardMaterial({ color: "#3a3a40", roughness: 0.85, metalness: 0.2 }),
  /* A pedra acesa é BASIC: ela precisa continuar visível contra o preto do céu
     e contra o chão escuro, e um material iluminado apagaria no meio do voo —
     que é exatamente quando o jogador está lendo para onde ela vai. */
  pedra: new THREE.MeshBasicMaterial({ color: 0xffb060 }),
  brasa: new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.55 }),
};

/* ---------------------------------------------------------------- o engenho */

export class Trebuchet {
  /**
   * @param {THREE.Object3D} parent raiz da fase
   * @param {{id:number,x:number,y:number,z:number}} posto de `castleProps`
   */
  constructor(parent, posto) {
    this.id = posto.id;
    this.base = new THREE.Vector3(posto.x, posto.y, posto.z);
    /** Azimute da armação, relativo ao "para fora" do muro (+Z). */
    this.yaw = 0;
    /** 0 a 1: quanto o contrapeso está tensionado. */
    this.charge = 0;
    /** Carregado? A sala é dona desta resposta — ver `Room.trebuchets`. */
    this.ready = true;
    /** Fração do içamento (0 a 1) quando descarregado. */
    this.reload = 1;
    /** Animação do braço: 0 armado, 1 solto. */
    this.swing = 0;

    this.group = new THREE.Group();
    this.group.position.copy(this.base);
    this.group.name = `trabuco-${posto.id}`;
    parent.add(this.group);
    this.build();
  }

  build() {
    const T = CONFIG.modes.siege.trebuchet;

    // Base: duas cavaletes em A e uma travessa. Barata e reconhecível.
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      for (const d of [-1, 1]) {
        const perna = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.14), MAT.viga);
        perna.position.set(s * 0.55, 0.75, d * 0.5);
        perna.rotation.z = -s * 0.28;
        perna.castShadow = true;
        g.add(perna);
      }
    }
    const eixo = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.12), MAT.ferro);
    eixo.position.y = 1.5;
    g.add(eixo);

    /* O BRAÇO gira; ele é o único filho animado, e o pivô fica no eixo. */
    this.arm = new THREE.Group();
    this.arm.position.y = 1.5;
    const viga = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 3.2), MAT.viga);
    viga.position.z = 0.9;
    viga.castShadow = true;
    this.arm.add(viga);
    const peso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), MAT.contrapeso);
    peso.position.z = -0.85;
    peso.castShadow = true;
    this.arm.add(peso);
    // A funda: um fio e o berço onde a pedra descansa.
    this.berco = new THREE.Group();
    this.berco.position.z = 2.4;
    const fio = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.6, 0.03), MAT.ferro);
    fio.position.y = -0.3;
    this.berco.add(fio);
    this.municao = new THREE.Mesh(
      new THREE.SphereGeometry(T.visualRadius, 10, 8),
      MAT.pedra,
    );
    this.municao.position.y = -0.62;
    this.berco.add(this.municao);
    this.arm.add(this.berco);
    g.add(this.arm);

    // A manivela, do lado de dentro: é onde se iça, e ela precisa ser vista.
    this.manivela = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.16), MAT.ferro);
    this.manivela.position.set(0, 0.5, -0.75);
    g.add(this.manivela);

    this.group.add(g);
    this.corpo = g;
  }

  /** A velocidade de saída para a tensão atual. */
  get speed() {
    const T = CONFIG.modes.siege.trebuchet;
    return T.speedMin + (T.speedMax - T.speedMin) * this.charge;
  }

  /** A direção de saída: 45° acima do plano, no azimute da armação. */
  direction(out = new THREE.Vector3()) {
    const T = CONFIG.modes.siege.trebuchet;
    const c = Math.cos(T.launchAngle);
    return out
      .set(Math.sin(this.yaw) * c, Math.sin(T.launchAngle), Math.cos(this.yaw) * c)
      .normalize();
  }

  /** De onde a pedra sai: a ponta do braço, no alto. */
  muzzle(out = new THREE.Vector3()) {
    return out.set(
      this.base.x + Math.sin(this.yaw) * 1.6,
      this.base.y + 2.6,
      this.base.z + Math.cos(this.yaw) * 1.6,
    );
  }

  aim(dYaw) {
    const T = CONFIG.modes.siege.trebuchet;
    this.yaw = Math.max(-T.yawRange, Math.min(T.yawRange, this.yaw + dYaw));
  }

  /**
   * Solta, com azimute e velocidade JÁ RESOLVIDOS pela mira.
   *
   * O jogador nunca escolhe "quanta força": ele escolhe um ponto no chão, e
   * `velocidadePara` diz que velocidade leva a pedra até lá. É a diferença
   * entre uma arma que se aprende e uma que se adivinha — ver `SiegeSystem
   * .entrarNaMira`.
   */
  fireAt(yaw, v) {
    if (!this.ready) return null;
    this.yaw = yaw;
    const o = this.muzzle();
    const d = this.direction();
    this.ready = false;
    this.swing = 0.0001;
    this.charge = 0;
    return { o, d, v };
  }

  setReady(ready, reloadFrac = 1) {
    this.ready = ready;
    this.reload = reloadFrac;
    if (ready) this.swing = 0;
  }

  update(dt, carregando) {
    // Tensão: sobe segurando, e não desce sozinha — soltar é atirar.
    if (this.ready && carregando) {
      this.charge = Math.min(1, this.charge + dt / CONFIG.modes.siege.trebuchet.chargeTime);
    }
    this.group.rotation.y = 0;
    this.corpo.rotation.y = this.yaw;

    /* O braço. Armado, ele fica puxado para trás; ao soltar, varre para a
       frente e volta devagar enquanto o contrapeso é içado. É a leitura de
       "este está carregado" a vinte metros, sem HUD nenhum. */
    let alvo;
    if (!this.ready) {
      this.swing = Math.min(1, this.swing + dt * 4);
      // Descarregado: o braço fica caído, e sobe conforme o içamento avança.
      alvo = 1.1 - this.reload * 2.0;
      this.municao.visible = this.reload > 0.92;
    } else {
      this.swing = 0;
      alvo = -0.9 - this.charge * 0.35;
      this.municao.visible = true;
    }
    this.arm.rotation.x += (alvo - this.arm.rotation.x) * Math.min(1, dt * 7);
    this.manivela.rotation.z += this.ready ? 0 : dt * 5;
  }

  dispose() {
    this.group?.parent?.remove(this.group);
    this.group = null;
  }
}

/* ------------------------------------------------------- balística da pedra */

/**
 * Onde a pedra CAI, integrando o voo de verdade.
 *
 * Fórmula fechada não serve. `v²/g` é o alcance de um projétil sem ar; esta
 * pedra tem 25 kg, 0,14 m de raio e Cd de esfera, e a 33 m/s ela perde ~4 % do
 * alcance para o arrasto. Quatro por cento em 110 m são quatro metros e meio —
 * mais que o raio do estouro. A marca mentiria justamente na distância em que
 * ela é mais usada.
 *
 * Então integra-se, com o mesmo passo fixo e a mesma conta de `Stone.applyDrag`.
 * São ~300 passos; roda uma vez por quadro durante a mira e não aparece no
 * perfil.
 *
 * @returns {{d:number, pontos:number[][]}} alcance no plano e a curva amostrada
 */
export function voar(v0, alturaSaida, alvoY, amostras = 24) {
  const T = CONFIG.modes.siege.trebuchet;
  const g = Math.abs(CONFIG.physics.gravity);
  const area = Math.PI * T.radius * T.radius;
  const k = 0.5 * CONFIG.physics.airDensity * T.dragCoefficient * area;
  const h = 1 / 120;

  const c = Math.cos(T.launchAngle);
  let x = 0;
  let y = alturaSaida;
  let vx = v0 * c;
  let vy = v0 * Math.sin(T.launchAngle);

  const pontos = [[0, y]];
  let passos = 0;
  const guarda = 3000;
  while (y > alvoY && passos++ < guarda) {
    const sp = Math.hypot(vx, vy);
    const f = (k * sp) / T.mass;
    vx -= vx * f * h;
    vy -= (vy * f + g) * h;
    x += vx * h;
    y += vy * h;
    if (passos % Math.max(1, Math.floor(guarda / amostras / 6)) === 0) pontos.push([x, y]);
  }
  pontos.push([x, y]);
  return { d: x, pontos };
}

/**
 * A velocidade que faz a pedra cair a `d` metros — o inverso de `voar`.
 *
 * Busca binária, porque o alcance é monotônico na velocidade e vinte iterações
 * dão precisão de centímetro. Devolve `null` quando `d` está fora do que o
 * engenho alcança, e é esse `null` que impede a marca de ir para onde a pedra
 * não vai.
 */
export function velocidadePara(d, alturaSaida, alvoY) {
  const T = CONFIG.modes.siege.trebuchet;
  if (voar(T.speedMin, alturaSaida, alvoY).d > d) return null;
  if (voar(T.speedMax, alturaSaida, alvoY).d < d) return null;
  let lo = T.speedMin;
  let hi = T.speedMax;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    if (voar(m, alturaSaida, alvoY).d < d) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------------ a pedra */

export class Stone {
  /**
   * @param {THREE.Object3D} parent
   * @param {object} physics
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} direction unitário
   * @param {number} speed m/s
   * @param {boolean} own a pedra é MINHA (só a minha reporta impacto)
   */
  constructor(parent, physics, origin, direction, speed, own = true) {
    const T = CONFIG.modes.siege.trebuchet;
    this.physics = physics;
    this.own = own;
    this.dead = false;
    this.life = 0;
    this.impact = null;

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(T.visualRadius, 12, 10), MAT.pedra);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    /* O halo: uma casca maior e translúcida. Custa uma malha e é o que faz a
       pedra ler como TOCHA a 90 m, em vez de um ponto laranja. */
    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(T.visualRadius * 2.1, 10, 8),
      MAT.brasa,
    );
    this.mesh.add(this.halo);

    this.body = physics.createBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(direction.x * speed, direction.y * speed, direction.z * speed)
        // A 33 m/s ela anda 28 cm por passo de física contra um raio de 14 cm:
        // sem detecção contínua, ela atravessaria o próprio merlão na saída.
        .setCcdEnabled(true)
        .setLinearDamping(0)
        .setAngularDamping(0.1),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.ball(T.radius)
        .setMass(T.mass)
        .setRestitution(0.02)
        .setFriction(0.9)
        /* O MESMO grupo da flecha: ela acerta tudo menos outras flechas. Sem
           isto a pedra ricochetearia na flecha de alguém no ar. */
        .setCollisionGroups(ARROW_COLLISION_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    physics.register(this.collider, { kind: "stone", stone: this });

    this._v = new THREE.Vector3();
    this._f = { x: 0, y: 0, z: 0 };
  }

  /**
   * O arrasto, no passo fixo — a mesma fórmula da flecha.
   *
   * F = −½·ρ·Cd·A·|v_rel|·v_rel, com `v_rel = v − vento`. O vento nunca é uma
   * força separada: ele altera a velocidade relativa ao ar, e é por isso que o
   * efeito dele depende da velocidade e do tempo de voo.
   *
   * Sem estabilização aerodinâmica: uma esfera não tem centro de pressão atrás
   * do centro de massa, não se alinha e não precisa. É a diferença física entre
   * uma pedra e uma flecha, e ela aparece aqui como código que NÃO existe.
   */
  applyDrag(h, wind) {
    if (this.dead || !this.body) return;
    const T = CONFIG.modes.siege.trebuchet;
    const v = this.body.linvel();
    this.body.resetForces(false);

    const vx = v.x - (wind?.x ?? 0);
    const vy = v.y - (wind?.y ?? 0);
    const vz = v.z - (wind?.z ?? 0);
    const speed = Math.hypot(vx, vy, vz);
    if (speed < 1e-3) return;

    const area = Math.PI * T.radius * T.radius;
    const k = 0.5 * CONFIG.physics.airDensity * T.dragCoefficient * area * speed;
    this._f.x = -vx * k;
    this._f.y = -vy * k;
    this._f.z = -vz * k;
    this.body.addForce(this._f, true);
  }

  /** Bateu em alguma coisa. Guarda o ponto; quem consome é o gerente. */
  registerImpact(point) {
    if (this.impact) return;
    this.impact = { x: point.x, y: point.y, z: point.z };
    this.dead = true;
  }

  update(dt) {
    this.life += dt;
    if (this.body && !this.dead) {
      const t = this.body.translation();
      this.mesh.position.set(t.x, t.y, t.z);
      /* Rede de segurança: pedra que passou do chão sem contato (caiu fora do
         colisor do terreno, ou o contato se perdeu num quadro engasgado) ainda
         precisa estourar em algum lugar. Sem isto ela cairia para sempre e a
         recarga do engenho nunca começaria a valer para nada. */
      if (t.y < -20 || this.life > 12) this.registerImpact(t);
    }
    // A brasa pulsa. Uma escala, e é o que separa "uma bola laranja" de fogo.
    const s = 1 + Math.sin(this.life * 22) * 0.12;
    this.halo.scale.set(s, s, s);
  }

  dispose() {
    this.physics?.removeBody(this.body);
    this.mesh?.parent?.remove(this.mesh);
    this.mesh?.geometry?.dispose();
    this.halo?.geometry?.dispose();
    this.body = null;
    this.collider = null;
    this.mesh = null;
  }
}
