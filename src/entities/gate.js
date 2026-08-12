/* ---------------------------------------------------------------------------
   O grande portão — a única coisa que pode fazer a partida ser perdida.

   Ele mora fora de `castle.js` porque é a única peça de alvenaria que MUDA no
   meio do jogo, e mudar tem consequência dos dois lados: a vida é da sala (ela
   decide, como decide a bandeira em `flagSim.js`), e o estado visual é daqui.

   TRÊS ESTADOS, e eles não são enfeite:

     inteiro   → tábuas soltas → rachado com fresta → cai

   A fresta é jogável nos dois sentidos: dá para atirar por ela de dentro, e é
   por ela que se vê quantos estão do outro lado. Um portão que só mudasse de
   cor obrigaria o jogador a ler a barra do HUD para saber como está a coisa —
   e o modo inteiro é feito para que ele não precise tirar os olhos da mira.

   O SOM é metade da peça. Cada golpe é um baque grave que atravessa a mistura,
   e a frequência dos baques é a leitura da fila. Ver §7.1 do plano: é o único
   canal que informa sem exigir que se olhe.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { gateInfo, GROUND_Y } from "../shared/castleProps.js";

const MAT = {
  madeira: new THREE.MeshStandardMaterial({
    color: "#4a3627",
    roughness: 0.92,
    metalness: 0.0,
  }),
  ferro: new THREE.MeshStandardMaterial({
    color: "#26262a",
    roughness: 0.5,
    metalness: 0.75,
  }),
  /* A madeira lascada aparece CLARA: é o interior da tábua, que nunca pegou
     fuligem. É assim que o dano se lê a 30 m, à noite, sem barra nenhuma. */
  lasca: new THREE.MeshStandardMaterial({
    color: "#8a6f4e",
    roughness: 0.95,
    metalness: 0.0,
  }),
};

export class Gate {
  build(parent, physics) {
    const G = gateInfo();
    this.info = G;
    this.physics = physics;
    this.frac = 1;
    this.stage = 0;
    this.fallen = false;
    this._shake = 0;

    this.group = new THREE.Group();
    this.group.name = "portao";
    this.group.position.set(G.x, G.baseY, G.z);
    parent.add(this.group);

    const largura = G.halfX * 2;
    const altura = G.topY - G.baseY;
    const esp = 0.34;

    /* Duas folhas. Elas existem separadas porque a queda é assimétrica: uma
       tomba para dentro antes da outra, e um portão de peça única caindo em
       bloco lê como elevador descendo. */
    this.folhas = [];
    for (const s of [-1, 1]) {
      const folha = new THREE.Group();
      folha.position.set((s * largura) / 4, 0, 0);
      this.group.add(folha);

      const tabuas = new THREE.Group();
      const nT = 4;
      for (let i = 0; i < nT; i++) {
        const w = largura / 2 / nT;
        const t = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, altura, esp), MAT.madeira);
        t.position.set(-largura / 4 + w * (i + 0.5), altura / 2, 0);
        t.castShadow = true;
        t.receiveShadow = true;
        tabuas.add(t);
      }
      folha.add(tabuas);

      // Duas travessas de ferro. São o que o olho lê como "isto é um portão".
      for (const hy of [altura * 0.28, altura * 0.72]) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(largura / 2 - 0.1, 0.16, esp + 0.1),
          MAT.ferro,
        );
        b.position.set(0, hy, 0);
        b.castShadow = true;
        folha.add(b);
      }

      this.folhas.push({ group: folha, tabuas, lado: s, queda: 0 });
    }

    /* As lascas do segundo estágio já nascem, invisíveis. Criá-las na hora
       custaria um pico de geometria no instante em que a tela está mais cheia
       — que é exatamente quando o portão racha. */
    this.lascas = new THREE.Group();
    this.lascas.visible = false;
    for (let i = 0; i < 14; i++) {
      const w = 0.1 + Math.random() * 0.22;
      const h = 0.3 + Math.random() * 0.9;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, esp * 0.6), MAT.lasca);
      m.position.set(
        (Math.random() * 2 - 1) * (largura / 2 - 0.3),
        0.6 + Math.random() * (altura - 1.4),
        (Math.random() * 2 - 1) * 0.14,
      );
      m.rotation.z = (Math.random() * 2 - 1) * 0.5;
      this.lascas.add(m);
    }
    this.group.add(this.lascas);

    this.buildCollider();
    return this;
  }

  buildCollider() {
    const G = this.info;
    const altura = G.topY - G.baseY;
    this.body = this.physics.createBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(G.x, G.baseY + altura / 2, G.z),
    );
    this.collider = this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(G.halfX, altura / 2, G.thick / 2)
        .setFriction(0.9)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    // `scenery` faz a flecha CRAVAR nele, que é o que uma porta de carvalho
    // faz. Congelar a flecha no cenário é mais barato e mais estável que um
    // vínculo — a mesma escolha que `hitResolver` já toma para tronco e rocha.
    this.physics.register(this.collider, { kind: "scenery", name: "portão" });
  }

  /**
   * A vida chegou da sala.
   *
   * @param {number} frac 0 a 1
   */
  setHealth(frac) {
    const f = Math.max(0, Math.min(1, frac));
    if (f < this.frac - 0.001) this._shake = Math.min(1, this._shake + 0.5);
    this.frac = f;

    const [s1, s2] = CONFIG.modes.siege.gateStages;
    const stage = f > s1 ? 0 : f > s2 ? 1 : 2;
    if (stage === this.stage) return;
    this.stage = stage;

    this.lascas.visible = stage >= 1;
    if (stage >= 2) {
      /* A fresta: a tábua do meio de cada folha sai. Não é um buraco pintado —
         é geometria que some, e por ela passa flecha (a folha continua tendo
         colisor, mas quem mira o vão do meio acerta quem está atrás). */
      for (const f2 of this.folhas) {
        const meio = f2.tabuas.children[f2.lado < 0 ? 3 : 0];
        if (meio) meio.visible = false;
      }
    }
  }

  /** A sala decidiu: o portão caiu. */
  fall() {
    if (this.fallen) return;
    this.fallen = true;
    /* `removeBody` leva o colisor junto e o desregistra — e ignora em silêncio
       um corpo de mundo antigo, que é exatamente o caso quando o portão cai no
       mesmo quadro em que a fase está sendo trocada. Ver `core/physics.js`. */
    this.physics.removeBody(this.body);
    this.collider = null;
    this.body = null;
  }

  /** Volta ao estado novo — reinício de partida sem reconstruir a peça. */
  reset() {
    this.frac = 1;
    this.stage = 0;
    this._shake = 0;
    this.lascas.visible = false;
    for (const f of this.folhas) {
      f.queda = 0;
      f.group.rotation.x = 0;
      f.group.position.y = 0;
      for (const t of f.tabuas.children) t.visible = true;
    }
    if (this.fallen) {
      this.fallen = false;
      this.buildCollider();
    }
    this.group.visible = true;
  }

  update(dt) {
    /* O tranco do golpe. Amortecido rápido: é um baque, não um balanço — uma
       porta de carvalho de 20 cm não oscila, ela estremece e para. */
    if (this._shake > 0.001) {
      this._shake = Math.max(0, this._shake - dt * 4.5);
      const a = this._shake * 0.035;
      this.group.position.z = this.info.z + Math.sin(this._shake * 60) * a;
    } else {
      this.group.position.z = this.info.z;
    }

    if (!this.fallen) return;
    // Tombam para DENTRO, uma antes da outra.
    let todas = true;
    for (const [i, f] of this.folhas.entries()) {
      const alvo = 1;
      const vel = i === 0 ? 1.9 : 1.3;
      if (f.queda < alvo) {
        f.queda = Math.min(alvo, f.queda + dt * vel);
        todas = false;
      }
      const t = f.queda;
      f.group.rotation.x = -t * t * (Math.PI / 2 - 0.12);
      f.group.position.y = -t * 0.2;
    }
    if (todas) this.group.visible = true;
  }

  dispose() {
    this.collider = null;
    this.body = null;
    this.group = null;
    this.folhas = [];
    this.physics = null;
  }
}

export { GROUND_Y };
