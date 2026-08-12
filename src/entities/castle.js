/* ---------------------------------------------------------------------------
   O castelo: muro, bastiões, merlões, escadas, menagem e braseiros.

   As MEDIDAS não moram aqui — moram em `shared/castleProps.js`, que o servidor
   também importa. Este arquivo é a aparência e os colisores, e ele lê a MESMA
   lista de sólidos que o servidor usa para decidir visada e passo da horda.

   Essa é a decisão que organiza o arquivo inteiro: `buildSolids()` percorre
   `castleBlockers()` e, para cada caixa, cria de uma vez a geometria e o
   colisor. Não existe caminho em que um dos dois receba uma peça que o outro
   não tem. A alternativa — desenhar aqui e listar lá — é a divergência
   clássica: o muro que na tela está 40 cm à frente de onde o servidor acha que
   está, e que aparece como flecha cravando no ar a meio metro da pedra.

   ORÇAMENTO. O castelo inteiro sai em ~6 chamadas de desenho: as peças são
   agrupadas por material e fundidas numa geometria só, como a base lunar já
   fazia. São ~120 caixas; sem a fusão seriam 120 chamadas, num modo que ainda
   precisa desenhar 120 sitiantes.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import {
  CASTLE,
  GROUND_Y,
  WALL_TOP,
  MERLON_TOP,
  WALL_ZC,
  castleBlockers,
  castleParapets,
  castleHoard,
  trebuchetPosts,
} from "../shared/castleProps.js";

/* Calcário à noite. Dois tons e não um: uma parede de 34 m numa cor só lê como
   textura de placeholder, e a variação por fiada é o que dá escala à pedra. */
const TINTAS = {
  pedra: { color: "#6a655c", roughness: 0.94, metalness: 0.02 },
  pedraEscura: { color: "#4b4740", roughness: 0.97, metalness: 0.02 },
  madeira: { color: "#4a3627", roughness: 0.9, metalness: 0.0 },
  ferro: { color: "#2b2b2e", roughness: 0.55, metalness: 0.7 },
};

/** Acumula geometrias por material e entrega tudo em poucas malhas. */
class Lote {
  constructor() {
    this.porTinta = new Map();
  }

  add(tinta, geo, matriz) {
    const g = geo.clone().applyMatrix4(matriz);
    let lista = this.porTinta.get(tinta);
    if (!lista) this.porTinta.set(tinta, (lista = []));
    lista.push(g);
  }

  box(tinta, hx, hy, hz, x, y, z, ry = 0, rx = 0) {
    const g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(tinta, g, m);
    g.dispose();
  }

  flush(parent) {
    let calls = 0;
    for (const [tinta, lista] of this.porTinta) {
      const geo = lista.length === 1 ? lista[0] : mergeGeometries(lista, false);
      if (!geo) continue;
      if (lista.length > 1) for (const g of lista) g.dispose();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(TINTAS[tinta]));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `castelo-${tinta}`;
      parent.add(mesh);
      calls++;
    }
    this.porTinta.clear();
    return calls;
  }
}

export class Castle {
  /**
   * @param {THREE.Object3D} parent a raiz da fase (nunca a cena direto)
   * @param {object} physics o mundo de física
   */
  build(parent, physics) {
    this.group = new THREE.Group();
    this.group.name = "castelo";
    parent.add(this.group);
    this.physics = physics;
    this.lights = [];
    this.braziers = [];

    const lote = new Lote();
    this.buildSolids(lote, physics);
    this.buildHoard(lote, physics);
    this.buildParapets(lote, physics);
    this.buildStairs(lote, physics);
    this.buildDetail(lote);
    this.drawCalls = lote.flush(this.group);

    this.buildBraziers();
    return this;
  }

  /* --------------------------------------------------------------- pedra -- */

  /**
   * Uma varredura, dois produtos: a malha e o colisor.
   *
   * É o coração do arquivo. Ver o cabeçalho para por que os dois saem da mesma
   * lista em vez de duas.
   */
  buildSolids(lote, physics) {
    this.colliders = [];
    let i = 0;
    for (const b of castleBlockers()) {
      /* SÓ AS CAIXAS. A lista também traz os troncos do bosque, que são
         CILINDROS (`{x, z, r, h, base}`) e não têm `y` nem meias-arestas —
         tratá-los como caixa passava `undefined` ao Rapier e a construção da
         fase inteira morria com "translation components must be numbers", sem
         nada apontando para uma árvore. Quem constrói o bosque é
         `castleGround.buildWoods`. */
      if (!b.box) continue;
      /* Fiadas alternadas: peças pares num tom, ímpares no outro. Não é
         aleatório — é determinístico pela ordem da lista, então a parede é a
         mesma em todas as telas. */
      const tinta = i++ % 2 === 0 ? "pedra" : "pedraEscura";
      lote.box(tinta, b.hx, b.hy, b.hz, b.x, b.y, b.z, b.ry ?? 0);

      const body = physics.createBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(b.x, b.y, b.z),
      );
      const col = physics.createCollider(
        RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
          .setFriction(0.9)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      physics.register(col, { kind: "scenery", name: b.name ?? "castelo" });
      this.colliders.push(col);
    }
  }

  /**
   * A HOURD: a galeria de madeira projetada para fora da face do muro.
   *
   * Ela é a peça que devolve o tiro no pé do muro (a conta está em
   * `CASTLE.hoardOut`) e é, historicamente, exatamente para isso que hourds
   * eram montadas — madeira pregada na véspera do cerco, porque a pedra sozinha
   * não alcança quem está encostado nela.
   *
   * O piso tem colisor mas NÃO entra em `castleBlockers()`: um deque de 40 cm
   * não é cobertura, e tratá-lo como obstáculo de flecha produziria a única
   * coisa absurda possível — o arqueiro incapaz de atirar por cima dos próprios
   * pés. Mesma divergência declarada das escadas.
   */
  buildHoard(lote, physics) {
    const C = CASTLE;
    const h = castleHoard();

    lote.box("madeira", h.hx, h.hy, h.hz, 0, h.y, h.z);
    this.solid(physics, h.hx, h.hy, h.hz, 0, h.y, h.z, "hourd");

    /* As MÃOS-FRANCESAS por baixo. Sem elas o deque flutua, e a coisa que a
       silhueta precisa dizer — "isto foi pregado aqui às pressas" — se perde.
       São só malha: ninguém encosta nelas. */
    const passo = 2.6;
    const n = Math.floor((C.wallHalfX * 2) / passo);
    for (let i = 0; i <= n; i++) {
      const x = -C.wallHalfX + i * passo;
      lote.box("madeira", 0.11, 0.11, 0.85, x, WALL_TOP - 1.2, C.wallZOut + 0.55, 0, -0.62);
      lote.box("madeira", 0.11, 0.6, 0.11, x, WALL_TOP - 0.85, C.wallZOut + 1.05);
    }
  }

  /**
   * Os parapeitos: peitoril e silhueta, com colisor só aqui.
   *
   * O servidor não os conhece — ver o comentário de `MERLON_TOP`. Aqui eles
   * existem para o pé não sair do muro sem querer e para o adarve ter uma linha
   * contra o céu, que é metade do que faz um castelo parecer um castelo.
   */
  buildParapets(lote, physics) {
    for (const [i, b] of castleParapets().entries()) {
      lote.box(i % 2 === 0 ? "pedra" : "pedraEscura", b.hx, b.hy, b.hz, b.x, b.y, b.z);
      this.solid(physics, b.hx, b.hy, b.hz, b.x, b.y, b.z, "parapeito");
    }
  }

  /** Um sólido alinhado aos eixos: malha por fora, colisor aqui. */
  solid(physics, hx, hy, hz, x, y, z, nome) {
    const body = physics.createBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z),
    );
    const col = physics.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(0.9)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    physics.register(col, { kind: "scenery", name: nome });
    this.colliders.push(col);
    return col;
  }

  /**
   * As escadas, que são o único lugar onde cliente e servidor divergem — e de
   * propósito.
   *
   * `shared/blockers.js` não tem caixa girada em torno de X, e uma rampa é
   * exatamente isso. O servidor recebe a escada como bloco maciço (conservador,
   * dentro do pátio, sem consequência para tiro nenhum) e o cliente recebe a
   * rampa de verdade, que é o que o controlador de personagem precisa para
   * subir. O comentário em `castleProps.castleBlockers()` registra o mesmo.
   */
  buildStairs(lote, physics) {
    const C = CASTLE;
    const corrida = C.stairZTop - C.stairZBottom;
    const subida = WALL_TOP - GROUND_Y;
    const ang = Math.atan2(subida, corrida); // 38°
    const comp = Math.hypot(corrida, subida) / 2;

    for (const sx of [-C.stairX, C.stairX]) {
      const cz = (C.stairZBottom + C.stairZTop) / 2;
      const cy = (GROUND_Y + WALL_TOP) / 2;

      /* Rampa inclinada. O giro é em torno de X e o sinal é negativo porque a
         escada sobe no sentido +Z: a face de cima tem de olhar para trás. */
      const body = physics.createBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(sx, cy, cz)
          .setRotation({ x: Math.sin(-ang / 2), y: 0, z: 0, w: Math.cos(-ang / 2) }),
      );
      const col = physics.createCollider(
        RAPIER.ColliderDesc.cuboid(C.stairHalfW, 0.4, comp)
          .setFriction(0.95)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      physics.register(col, { kind: "scenery", name: "escada" });
      this.colliders.push(col);

      /* Os degraus são SÓ VISUAL — a rampa acima é que sustenta o pé. Fazer o
         contrário (colisor por degrau) daria 64 corpos para o mesmo resultado,
         e o autostep do controlador já resolveria de qualquer jeito. */
      const n = Math.round(subida / 0.34);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const z = C.stairZBottom + corrida * t;
        const y = GROUND_Y + subida * t;
        lote.box("pedraEscura", C.stairHalfW, 0.17, 0.34, sx, y, z);
      }
      // Massa de alvenaria por baixo, para a escada não flutuar.
      lote.box("pedra", C.stairHalfW, subida / 2, comp * Math.cos(ang), sx, cy - 0.5, cz);
    }
  }

  /** Detalhes que não têm colisor: cordões, arco do portão, coruchéu. */
  buildDetail(lote) {
    const C = CASTLE;

    // Cordão de pedra no pé do adarve — a linha que dá altura ao muro.
    lote.box("pedraEscura", C.wallHalfX + 0.4, 0.22, C.wallThick / 2 + 0.25, 0, WALL_TOP - 1.5, WALL_ZC);

    // Aduela do portão: um arco grosseiro em cinco pedras.
    for (let k = 0; k < 5; k++) {
      const a = (-0.55 + (k / 4) * 1.1) * Math.PI * 0.5;
      const r = C.gateHalfX + 0.55;
      lote.box(
        "pedra",
        0.5,
        0.42,
        C.wallThick / 2 + 0.3,
        Math.sin(a) * r,
        CASTLE.gateTopY - 0.3 + Math.cos(a) * 0.9,
        WALL_ZC,
        0,
      );
    }

    // Coruchéu da menagem: um tronco de pirâmide barato feito de três caixas.
    const K = C.keep;
    for (let k = 0; k < 3; k++) {
      const h = K.half * (1 - k * 0.3);
      lote.box("pedraEscura", h, 0.5, h, K.x, GROUND_Y + K.height + 0.5 + k, K.z);
    }
    // Porta da menagem, virada para o portão: é dela que se sai ao renascer.
    lote.box("madeira", 1.1, 1.5, 0.2, K.x, GROUND_Y + 1.5, K.z + K.half + 0.05);
  }

  /* ------------------------------------------------------------ braseiros -- */

  /**
   * A luz do adarve.
   *
   * Uma `PointLight` só, no centro do muro, e cestos emissivos no resto. É a
   * mesma economia que `systems/torches.js` documenta: quatro luzes dinâmicas
   * num modo com 120 bichos custam o passe inteiro de sombra, e o que o jogador
   * lê é o BRILHO do cesto, não o cone de luz que ele projeta.
   *
   * E a luz aqui tem custo de jogo, não só de GPU: ela marca o adarve para a
   * catapulta. Ver §6.4 do plano — quem está iluminado é quem está visível.
   */
  buildBraziers() {
    const L = CONFIG.levels.castle;
    const geoCesto = new THREE.CylinderGeometry(0.34, 0.22, 0.42, 8);
    const geoChama = new THREE.SphereGeometry(0.32, 8, 6);
    const matCesto = new THREE.MeshStandardMaterial(TINTAS.ferro);
    /* Emissivo puro, como os olhos do zumbi: à noite é a única coisa que a
       iluminação da cena não apaga, e é ele que desenha a linha do muro para
       quem está lá embaixo. */
    const matChama = new THREE.MeshBasicMaterial({
      color: 0xffb45a,
      // Transparente porque a força dela varia com a hora — ver `update`.
      transparent: true,
      opacity: 1,
    });

    for (const [i, p] of L.braziers.entries()) {
      const y = (p.z > CASTLE.courtZBack + 2 ? WALL_TOP : GROUND_Y) + L.brazierHeight;
      const g = new THREE.Group();
      g.position.set(p.x, y, p.z);

      const cesto = new THREE.Mesh(geoCesto, matCesto);
      cesto.castShadow = true;
      g.add(cesto);

      const chama = new THREE.Mesh(geoChama, matChama);
      chama.position.y = 0.3;
      chama.renderOrder = 5;
      chama.frustumCulled = false;
      g.add(chama);

      this.group.add(g);
      this.braziers.push({ group: g, chama, fase: Math.random() * Math.PI * 2 });

      if (i === Math.floor(L.braziers.length / 2)) {
        const luz = new THREE.PointLight(L.brazierColor, L.brazierIntensity, L.brazierRange, 2);
        luz.position.copy(g.position);
        luz.position.y += 0.4;
        this.group.add(luz);
        this.lights.push(luz);
      }
    }
  }

  /** Onde os trabucos ficam. Repassa `castleProps` para quem monta os engenhos. */
  get postos() {
    return trebuchetPosts();
  }

  /**
   * @param {number} dt
   * @param {number} dusk 0 = Sol alto, 1 = Sol no horizonte. Ver `setDusk`.
   */
  update(dt, dusk = 0) {
    // A chama respira. Custa uma escala por braseiro e é o que impede o muro
    // de parecer congelado num modo que é todo movimento lá embaixo.
    for (const b of this.braziers) {
      b.fase += dt * 7;
      const s = 1 + Math.sin(b.fase) * 0.14 + Math.sin(b.fase * 2.3) * 0.07;
      b.chama.scale.set(s, s * 1.25, s);
    }
    /* O BRILHO acompanha a luz que resta.
     *
     * Uma chama emissiva com a mesma força ao meio-dia e ao pôr do sol é uma
     * mancha laranja chapada no primeiro caso e a única coisa quente do quadro
     * no segundo. Com o Sol alto ela quase some (é fogo sob luz forte, que é
     * como fogo se comporta); ao entardecer ela assume. */
    const f = 0.28 + 0.72 * Math.min(1, dusk);
    for (const b of this.braziers) b.chama.material.opacity = f;
    for (const luz of this.lights) {
      luz.intensity = CONFIG.levels.castle.brazierIntensity * (0.15 + 0.85 * f);
    }
  }

  dispose() {
    /* Só as referências: os corpos e colisores saem no `recreate()` do mundo
       de física, e a malha sai com a raiz da fase. Ver `levels/index.js`. */
    this.colliders = [];
    this.lights = [];
    this.braziers = [];
    this.group = null;
    this.physics = null;
  }
}

export { WALL_TOP, GROUND_Y, MERLON_TOP };
