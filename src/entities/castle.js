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

/* Calcário ao entardecer. Três tons e não um: uma parede de 34 m numa cor só lê
   como textura de espaço reservado, e a variação por fiada é o que dá escala à
   pedra.

   E eles são QUENTES, o que não era o caso. A face que interessa é a de FORA, e
   ela olha para +Z: com o Sol do cerco baixo e a −X, ela passa a partida
   inteira em luz rasante ou em sombra própria, iluminada só pelo hemisférico —
   que é azul. Um cinza neutro sob luz azul é uma laje azul, e era exatamente
   isso que se via. A correção é na TINTA e não na luz: subir o hemisférico
   clarearia junto a horda, a rampa e o pátio, que estão certos. */
const TINTAS = {
  pedra: { color: "#8c8272", roughness: 0.94, metalness: 0.02 },
  pedraEscura: { color: "#6d6455", roughness: 0.96, metalness: 0.02 },
  /** A terceira fiada: o calcário mais tostado, para os cordões e as ameias. */
  pedraQuente: { color: "#9c8e77", roughness: 0.92, metalness: 0.02 },
  madeira: { color: "#5a4230", roughness: 0.9, metalness: 0.0 },
  ferro: { color: "#2b2b2e", roughness: 0.55, metalness: 0.7 },
  /** As frestas e os vãos: pretos de propósito, é o que dá profundidade. */
  vao: { color: "#14120f", roughness: 1, metalness: 0 },
  /** Os estandartes. Vermelho porque é a única cor quente do castelo. */
  pano: { color: "#a8342e", roughness: 0.95, metalness: 0, side: THREE.DoubleSide },
};

/**
 * Quanto uma peça afunda no piso em que assenta, em metros.
 *
 * Seis centímetros: o suficiente para o cartão de profundidade nunca empatar as
 * duas faces (ver `Lote.assenta`), e pouco o bastante para caber dentro da
 * espessura de qualquer alvenaria deste castelo — a mais fina são os 40 cm da
 * hourd.
 */
const AFUNDA = 0.06;

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

  /**
   * Uma caixa que ASSENTA sobre um piso — e que NÃO briga com ele.
   *
   * Toda peça que fica em cima de outra (ameia sobre o adarve, guarita sobre o
   * bastião, torre sobre o muro) nasce com a face de baixo exatamente na cota
   * do piso. Duas faces coplanares na mesma profundidade são o caso clássico de
   * **z-fighting**: o cartão de profundidade não tem precisão para decidir qual
   * está na frente, e a que ganha muda de pixel para pixel e de quadro para
   * quadro. Na tela isso é o chão do muro PISCANDO em manchas — que foi
   * exatamente o relato.
   *
   * A cura é não empatar: a peça afunda seis centímetros no piso. Nada disso
   * aparece (o que afunda está dentro de pedra maciça) e o empate acaba.
   *
   * `yBase` é a cota do PISO, não o centro da caixa — que é como se pensa ao
   * pôr uma coisa em cima de outra, e é a metade do valor deste método.
   */
  assenta(tinta, hx, alt, hz, x, yBase, z) {
    const meia = alt / 2 + AFUNDA / 2;
    this.box(tinta, hx, meia, hz, x, yBase + alt / 2 - AFUNDA / 2, z);
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
    this.buildBanners();
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

      /* A ESCADA NÃO, e é o defeito que fazia o cerco perder um jogador por
       * morte.
       *
       * `castleBlockers()` declara cada escada como um BLOCO MACIÇO do pátio ao
       * adarve — uma aproximação deliberada, porque o formato compartilhado não
       * tem caixa girada em torno de X e o servidor só precisa dela para
       * decidir visada. O cliente monta a rampa de verdade em `buildStairs`, e
       * o comentário de lá sempre disse isso.
       *
       * Só que esta varredura não abria exceção: ela criava o colisor do bloco
       * TAMBÉM. O resultado era uma escada que, do lado de cá, era um pilar de
       * pedra de oito metros com paredes verticais — a rampa existia por baixo
       * e não servia para nada, porque o bloco a envolvia inteira. Quem morria
       * renascia na menagem e não tinha por onde voltar ao muro: as duas
       * escadas do castelo eram maciças.
       *
       * A malha sai junto pelo mesmo motivo: o bloco ia até `WALL_TOP` e
       * escondia os degraus desenhados. Quem desenha a escada é `buildStairs`. */
      if (b.name === "escada") continue;

      /* Fiadas alternadas: peças pares num tom, ímpares no outro. Não é
         aleatório — é determinístico pela ordem da lista, então a parede é a
         mesma em todas as telas. */
      /* A peça pode DECLARAR o material. Só as torres de madeira do pé da
         rampa fazem isso hoje (ver `mageTowers`); todo o resto continua
         alternando as fiadas de calcário pela ordem da lista. */
      const tinta = b.mat ?? (i++ % 2 === 0 ? "pedra" : "pedraEscura");
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
    const n = Math.floor((h.hx * 2) / passo);
    for (let i = 0; i <= n; i++) {
      const x = -h.hx + i * passo;
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
    const ang = Math.atan2(subida, corrida); // 30° com o muro de 8 m
    const comp = Math.hypot(corrida, subida) / 2;

    for (const sx of [-C.stairX, C.stairX]) {
      const cz = (C.stairZBottom + C.stairZTop) / 2;
      const cy = (GROUND_Y + WALL_TOP) / 2;

      /* Rampa inclinada. A escada sobe no sentido +Z: o pé em z = −11, no
         pátio, e o topo em z = 3, encostado no muro.

         O SINAL É NEGATIVO, e a conta que o decide é a do Three: girar em torno
         de X por θ leva o eixo local +Z para (0, −sen θ, cos θ). Para a ponta
         +Z ser a ALTA é preciso −sen θ > 0, ou seja θ = −ang. Medido depois de
         escrever: com −ang o perfil vai de y = 14 em z = −11 a y = 22 em z = 3;
         com +ang ele desce ao contrário e o topo fica pendurado sobre o pátio. */
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
      /* A MASSA DE ALVENARIA ERA UM TIJOLÃO QUE ENGOLIA A ESCADA.
       *
       * Ela existe para os degraus não flutuarem, e era UMA caixa alinhada aos
       * eixos indo de y = 13,5 a 21,5 ao longo de todo o vão. Só que os degraus
       * sobem de 14 a 22: no pé da escada o degrau está a oito metros ABAIXO do
       * topo da caixa, ou seja, dentro dela. O que se via era um bloco liso com
       * dois ou três degraus espetados na ponta de cima — a escada existia,
       * dava para subir, e estava coberta.
       *
       * A massa passa a ser feita DEGRAU A DEGRAU: sob cada um, uma coluna que
       * desce até o piso do pátio. O contorno resultante é o de uma escada de
       * pedra maciça, que é o que ela é. Custo: nenhuma chamada de desenho a
       * mais — tudo cai no mesmo `Lote`, fundido por material.
       *
       * A coluna é um pouco mais ESTREITA que o degrau (94 %), e não é detalhe:
       * é o ressalto que faz cada degrau ter sombra própria em vez de a escada
       * virar um plano inclinado serrilhado. */
      const n = Math.round(subida / 0.34);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const z = C.stairZBottom + corrida * t;
        const y = GROUND_Y + subida * t;
        lote.box("pedraEscura", C.stairHalfW, 0.17, 0.34, sx, y, z);

        const h = (y - 0.17 - GROUND_Y) / 2;
        if (h > 0.03) {
          lote.box("pedra", C.stairHalfW * 0.94, h, 0.34, sx, GROUND_Y + h, z);
        }
      }
    }
  }

  /**
   * A DECORAÇÃO, e a regra que decide onde ela pode existir.
   *
   * Nada aqui tem colisor, e por isso nada aqui pode ficar na frente de uma
   * flecha: o servidor não conhece estas peças, e uma flecha que parasse numa
   * ameia local e passasse na sala seria a divergência que este arquivo
   * inteiro existe para evitar.
   *
   * A regra é geométrica e vale peça por peça — **atrás do arqueiro, ou acima
   * de onde ninguém atira**:
   *
   * • o arqueiro do muro está na hourd, em z = 8,3, à frente de toda a
   *   alvenaria (a face externa é z = 8,0). Cordões, pilastras e o embasamento
   *   ficam em z ≤ 8,7 e rentes à pedra — a linha de tiro sai por cima deles;
   * • a menagem, o muro de fundo e os flancos ficam ATRÁS de quem atira, no
   *   pátio, e nenhum tiro do modo passa por ali;
   * • as ameias dos bastiões ficam nos CANTOS DE TRÁS. O bastião é um posto de
   *   tiro; o canto de trás dele não é linha de tiro de ninguém.
   *
   * O que sustenta o resto é o orçamento: tudo isto entra no mesmo `Lote` da
   * alvenaria, funde por material e sai nas MESMAS ~6 chamadas de desenho. São
   * ~180 caixas a mais e nenhuma chamada a mais — é triângulo, que é o recurso
   * de que esta fase sobra, e não chamada, que é o que falta.
   */
  buildDetail(lote) {
    const C = CASTLE;

    /* ------------------------------------------------------ o muro de fora --
       EMBASAMENTO, PILASTRAS E CORDÃO.
       A face externa é o fundo de tela da partida inteira, e ela era um plano
       liso de 34 × 8 m. Estas três coisas são o mínimo que faz a luz rasante do
       poente desenhar alguma coisa nela: uma sombra horizontal embaixo, sombras
       verticais ritmadas no meio, e uma linha contínua no alto. */
    const zOut = C.wallZOut;
    // O embasamento, alargado e chanfrado — a pedra sempre engrossa no pé.
    lote.box("pedraEscura", C.wallHalfX + 0.35, 0.9, C.wallThick / 2 + 0.42, 0, GROUND_Y + 0.9, WALL_ZC);
    lote.box("pedra", C.wallHalfX + 0.2, 0.3, C.wallThick / 2 + 0.24, 0, GROUND_Y + 1.95, WALL_ZC);

    // Pilastras: uma a cada 4,25 m, saltando o vão do portão.
    for (let i = -4; i <= 4; i++) {
      const x = i * 4.25;
      if (Math.abs(x) < C.gateHalfX + 1.2) continue;
      lote.box("pedraQuente", 0.55, (WALL_TOP - GROUND_Y - 2.2) / 2, 0.28,
        x, GROUND_Y + 2.2 + (WALL_TOP - GROUND_Y - 2.2) / 2, zOut + 0.24);
    }

    // Cordão de pedra no pé do adarve — a linha que dá altura ao muro.
    lote.box("pedraQuente", C.wallHalfX + 0.4, 0.22, C.wallThick / 2 + 0.32, 0, WALL_TOP - 1.5, WALL_ZC);

    // Aduela do portão: um arco grosseiro em cinco pedras.
    for (let k = 0; k < 5; k++) {
      const a = (-0.55 + (k / 4) * 1.1) * Math.PI * 0.5;
      const r = C.gateHalfX + 0.55;
      lote.box(
        "pedraQuente",
        0.5,
        0.42,
        C.wallThick / 2 + 0.34,
        Math.sin(a) * r,
        CASTLE.gateTopY - 0.3 + Math.cos(a) * 0.9,
        WALL_ZC,
        0,
      );
    }

    this.buildGateHouse(lote);
    this.buildCrenels(lote);
    this.buildKeep(lote);
    this.buildCourtyard(lote);
  }

  /**
   * O PÁTIO, que era um retângulo de 38 × 30 m com uma torre no meio.
   *
   * Ele não é paisagem: é onde se renasce, é onde se repara o portão sob
   * pressão e é o primeiro lugar que a horda vê quando o portão cai. Vazio, as
   * três coisas acontecem no mesmo chão liso e nenhuma delas tem um ponto de
   * referência — "vou ao portão" e "vou à menagem" eram a mesma travessia sem
   * nada no caminho.
   *
   * Tudo aqui é MALHA SEM COLISOR, e por isso nada disto pode estorvar quem
   * corre para o portão com o relógio de reparo correndo. As peças ficam
   * ENCOSTADAS nos muros, deixando limpo o eixo menagem → portão, que é o
   * trajeto que o modo cobra.
   */
  buildCourtyard(lote) {
    const C = CASTLE;
    const G = GROUND_Y;
    const dentro = C.sideX - C.sideThick / 2;

    // O POÇO, no canto: cilindro de pedra, dois montantes e a travessa.
    const px = -12.5;
    const pz = -8;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      lote.box("pedraEscura", 0.36, 0.55, 0.22,
        px + Math.cos(a) * 1.05, G + 0.55, pz + Math.sin(a) * 1.05, 0, 0);
    }
    for (const s of [-1, 1]) {
      lote.box("madeira", 0.09, 0.85, 0.09, px + s * 0.95, G + 1.85, pz);
    }
    lote.box("madeira", 1.15, 0.08, 0.09, px, G + 2.6, pz);
    lote.box("madeira", 0.32, 0.26, 0.28, px, G + 2.3, pz);

    /* O DEPÓSITO DO CERCO, encostado no muro de fundo: barris, caixas e uma
       pilha de lenha. É a explicação silenciosa de onde saem as pedras que o
       trabuco cospe e o piche que arde na rampa. */
    for (let i = 0; i < 7; i++) {
      const x = -8 + i * 2.6;
      const z = C.sideZBack + 2.0 + (i % 2) * 1.1;
      lote.box("madeira", 0.42, 0.55, 0.42, x, G + 0.55, z);
      if (i % 3 === 0) lote.box("madeira", 0.36, 0.45, 0.36, x + 0.3, G + 1.45, z + 0.2);
    }
    // Pilha de pedras de trabuco: quatro fiadas piramidais.
    for (let f = 0; f < 3; f++) {
      const n = 3 - f;
      for (let i = 0; i < n; i++) {
        lote.box("pedraQuente", 0.3, 0.28, 0.3,
          13.0 + (i - (n - 1) / 2) * 0.68, G + 0.28 + f * 0.56, -6.5);
      }
    }
    // A lenha, deitada em toras: só o muro de flanco a vê, e é o que basta.
    for (let i = 0; i < 6; i++) {
      lote.box("madeira", 1.5, 0.16, 0.16,
        dentro - 1.9, G + 0.16 + Math.floor(i / 3) * 0.34,
        -16 + (i % 3) * 0.36, 0, Math.PI / 2);
    }

    /* A CARROÇA quebrada junto ao portão, virada de lado. Ela conta o que já
       aconteceu ali — e dá uma referência de escala no meio do vão, que é o
       lugar em que o jogador mais precisa de uma. */
    const cx = -6.4;
    const cz = C.courtZFront - 1.6;
    lote.box("madeira", 1.15, 0.12, 0.7, cx, G + 0.72, cz, 0, 0.22);
    for (const s of [-1, 1]) {
      lote.box("madeira", 1.15, 0.28, 0.08, cx, G + 0.95, cz + s * 0.62, 0, 0.22);
    }
    for (const s of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        lote.box("madeira", 0.1, 0.28, 0.09,
          cx + 0.8, G + 0.6 + Math.sin(a) * 0.55, cz + s * 0.72 + Math.cos(a) * 0.55, 0, a);
      }
    }
  }

  /**
   * As duas torres do portão — a única coisa vertical que o muro tem.
   *
   * Elas só cabem porque a hourd empurrou o arqueiro para fora da alvenaria;
   * o porquê inteiro está em `CASTLE.gateTowerX`. A alvenaria delas está em
   * `castleBlockers()` (o servidor precisa saber); aqui ficam a coroa, as
   * frestas e o estandarte, que são só imagem.
   */
  buildGateHouse(lote) {
    const C = CASTLE;
    const hz = C.gateTowerHalfZ;
    const zc = C.wallZOut - C.wallThick + hz;
    const topo = WALL_TOP + C.gateTowerRise;

    for (const sx of [-C.gateTowerX, C.gateTowerX]) {
      // Cordão sob a coroa.
      lote.box("pedraQuente", C.gateTowerHalfX + 0.18, 0.16, hz + 0.18, sx, topo - 0.55, zc);
      // A coroa, ameada: cinco merlões em cada face longa.
      this.ameias(lote, sx, topo, zc, C.gateTowerHalfX, hz, 0.62);
      // Frestas de flecha: duas por torre, na face de fora.
      for (const dy of [1.4, 3.0]) {
        lote.box("vao", 0.09, 0.42, 0.06, sx, WALL_TOP + dy, zc - hz - 0.02);
      }
    }
  }

  /**
   * As AMEIAS, e o único lugar em que elas não atrapalham.
   *
   * Merlões alternados são o que faz uma silhueta ler como castelo, e são
   * também o que o §6.4 do plano proibiu no muro frontal: lá eles cortam o
   * campo de tiro em fatias de noventa centímetros, na altura do olho. A
   * proibição vale para o muro frontal — e só para ele. Aqui elas coroam o que
   * está atrás de quem atira: o fundo, os flancos, os cantos de trás dos
   * bastiões e as torres do portão.
   */
  buildCrenels(lote) {
    const C = CASTLE;
    const topoFlanco = GROUND_Y + C.sideHeight;

    // Os dois muros de flanco, na face de FORA de cada um.
    for (const sx of [-C.sideX, C.sideX]) {
      const x = sx + Math.sign(sx) * (C.sideThick / 2 - 0.22);
      for (let z = C.sideZBack + 1.2; z < C.wallZOut - 1.2; z += 1.55) {
        lote.assenta("pedraEscura", 0.22, 1.0, 0.42, x, topoFlanco, z);
      }
    }
    // O muro de fundo, que é o que se vê do pátio e de trás.
    for (let x = -C.sideX + 1.0; x <= C.sideX - 1.0; x += 1.55) {
      lote.assenta("pedraEscura", 0.42, 1.0, 0.22,
        x, topoFlanco, C.sideZBack - C.sideThick / 2 + 0.22);
    }

    /* Os BASTIÕES: ameias só no terço de trás, e guaritas nos dois cantos de
       trás. O terço da frente é posto de tiro e continua chão limpo — a mesma
       regra do muro, aplicada dentro de uma peça só. */
    for (const sx of [-C.towerX, C.towerX]) {
      const zFundo = C.towerZ - C.towerHalfZ;
      for (let x = sx - C.towerHalf + 0.5; x <= sx + C.towerHalf - 0.4; x += 1.5) {
        lote.assenta("pedraEscura", 0.4, 1.0, 0.22, x, WALL_TOP, zFundo + 0.22);
      }
      for (const lado of [-1, 1]) {
        for (let z = zFundo + 0.8; z < C.towerZ - 1.0; z += 1.5) {
          lote.assenta("pedraEscura", 0.22, 1.0, 0.4,
            sx + lado * (C.towerHalf - 0.22), WALL_TOP, z);
        }
        // A guarita do canto de trás: um cilindro em balanço, com cobertura.
        const gx = sx + lado * (C.towerHalf - 0.1);
        this.guarita(lote, gx, WALL_TOP, zFundo + 0.3);
      }
    }
  }

  /** Uma guarita: fuste, coroa e um cone de quatro caixas. Pura silhueta. */
  guarita(lote, x, base, z) {
    lote.assenta("pedra", 0.52, 2.3, 0.52, x, base, z);
    lote.box("pedraQuente", 0.62, 0.14, 0.62, x, base + 2.38, z);
    for (let k = 0; k < 3; k++) {
      const h = 0.55 * (1 - k * 0.3);
      lote.box("pedraEscura", h, 0.22, h, x, base + 2.62 + k * 0.42, z);
    }
  }

  /**
   * A MENAGEM, que era uma laje de 22 m sem uma única aresta.
   *
   * Ela é o ponto mais alto da fase e aparece em todo enquadramento que inclua
   * o pátio — e não tinha nem coroa, nem fresta, nem porta que se lesse. Ganhou
   * as quatro coisas que fazem uma torre de menagem: o embasamento, os cordões
   * que dividem os andares, as frestas em três alturas e a coroa ameada com
   * guaritas nos quatro cantos.
   */
  buildKeep(lote) {
    const K = CASTLE.keep;
    const topo = GROUND_Y + K.height;

    // Embasamento e dois cordões de andar.
    lote.box("pedraEscura", K.half + 0.3, 1.0, K.half + 0.3, K.x, GROUND_Y + 1.0, K.z);
    for (const dy of [7.5, 14.5]) {
      lote.box("pedraQuente", K.half + 0.16, 0.16, K.half + 0.16, K.x, GROUND_Y + dy, K.z);
    }

    /* As FRESTAS. Quatro faces × três andares, e é a coisa mais barata que
       existe para dizer "isto é habitado": um retângulo preto de 12 cm de
       largura, rebaixado dois centímetros na pedra. */
    for (const dy of [4.2, 11.0, 17.8]) {
      for (const s of [-1, 1]) {
        lote.box("vao", 0.09, 0.55, 0.05, K.x + s * 1.7, GROUND_Y + dy, K.z + s * (K.half + 0.02));
        lote.box("vao", 0.05, 0.55, 0.09, K.x + s * (K.half + 0.02), GROUND_Y + dy, K.z - s * 1.7);
      }
    }

    // A coroa ameada e as quatro guaritas de canto.
    lote.assenta("pedraQuente", K.half + 0.42, 0.4, K.half + 0.42, K.x, topo, K.z);
    this.ameias(lote, K.x, topo + 0.4, K.z, K.half + 0.34, K.half + 0.34, 0.62);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.guarita(lote, K.x + sx * (K.half + 0.3), topo + 0.4, K.z + sz * (K.half + 0.3));
      }
    }
    // Coruchéu: o telhado do torreão central, acima da coroa.
    for (let k = 0; k < 4; k++) {
      const h = (K.half - 1.2) * (1 - k * 0.24);
      lote.box("pedraEscura", h, 0.42, h, K.x, topo + 1.6 + k * 0.8, K.z);
    }

    // Porta da menagem, virada para o portão: é dela que se sai ao renascer.
    lote.box("vao", 1.22, 1.62, 0.12, K.x, GROUND_Y + 1.62, K.z + K.half + 0.03);
    lote.box("madeira", 1.1, 1.5, 0.2, K.x, GROUND_Y + 1.5, K.z + K.half + 0.09);
    for (const dy of [0.7, 2.2]) {
      lote.box("ferro", 1.12, 0.09, 0.05, K.x, GROUND_Y + dy, K.z + K.half + 0.21);
    }
  }

  /**
   * Um anel de merlões alternados em torno de um retângulo.
   *
   * `passo` é o vão entre dois merlões, e ele é o número que faz a coisa ler:
   * grande demais e vira uma cerca, pequeno demais e vira uma serra. 0,62 m é
   * pouco menos que a largura do merlão, que é a proporção medieval.
   */
  ameias(lote, cx, base, cz, hx, hz, passo) {
    const larg = 0.42;
    const alt = 1.04;
    for (let x = -hx + larg; x <= hx - larg + 0.01; x += larg * 2 + passo) {
      for (const s of [-1, 1]) {
        lote.assenta("pedraEscura", larg, alt, 0.24, cx + x, base, cz + s * (hz - 0.2));
      }
    }
    for (let z = -hz + larg; z <= hz - larg + 0.01; z += larg * 2 + passo) {
      for (const s of [-1, 1]) {
        lote.assenta("pedraEscura", 0.24, alt, larg, cx + s * (hx - 0.2), base, cz + z);
      }
    }
  }

  /* ------------------------------------------------------------ estandartes -

     A ÚNICA COISA DO CASTELO QUE SE MEXE — e por isso a que mais trabalha.

     Uma fortaleza inteira de pedra parada, com a horda andando lá embaixo, lê
     como maquete: o olho separa o que é cenário do que é jogo pelo movimento, e
     do lado de cá não havia nenhum. Duas bandeiras ondulando no alto das torres
     custam o que se lê abaixo e devolvem a cena inteira à categoria "lugar".

     ORÇAMENTO: uma malha para TODAS. Os quatro panos vivem numa geometria só,
     com uma tira de 6 × 4 vértices cada — 96 vértices ao todo, animados num
     laço de CPU por quadro. Uma malha por bandeira seriam quatro chamadas de
     desenho num modo que já paga 120 sitiantes; um shader próprio seria um
     programa a mais para compilar no meio do carregamento.

     E elas dizem o vento: a amplitude sai do MESMO `wind` que entorta a flecha,
     então o estandarte é um instrumento e não um enfeite. Ver `update`. */

  buildBanners() {
    const C = CASTLE;
    const K = C.keep;
    /** [x, y, z do mastro, largura, altura, giro em torno de Y] */
    this.bannerSpots = [
      [-C.gateTowerX, WALL_TOP + C.gateTowerRise - 0.3, C.wallZOut - C.wallThick + 0.5, 1.0, 1.9, 0],
      [C.gateTowerX, WALL_TOP + C.gateTowerRise - 0.3, C.wallZOut - C.wallThick + 0.5, 1.0, 1.9, 0],
      [K.x - 1.9, GROUND_Y + K.height - 1.2, K.z + K.half + 0.15, 1.15, 2.5, 0],
      [K.x + 1.9, GROUND_Y + K.height - 1.2, K.z + K.half + 0.15, 1.15, 2.5, 0],
    ];

    const COLS = 5;
    const LINHAS = 4;
    const nVerts = COLS * LINHAS;
    const total = this.bannerSpots.length * nVerts;
    const pos = new Float32Array(total * 3);
    const idx = [];
    /** Fração horizontal de cada vértice: 0 no mastro, 1 na ponta solta. */
    this._bannerU = new Float32Array(total);
    this._bannerBase = new Float32Array(total * 3);

    this.bannerSpots.forEach((b, n) => {
      const [bx, by, bz, larg, alt] = b;
      const off = n * nVerts;
      for (let j = 0; j < LINHAS; j++) {
        for (let i = 0; i < COLS; i++) {
          const k = off + j * COLS + i;
          const u = i / (COLS - 1);
          this._bannerU[k] = u;
          this._bannerBase[k * 3] = bx + (u - 0.5) * 0 + u * 0; // preenchido abaixo
          // O pano pende do mastro: x anda com `u`, y desce com `j`.
          this._bannerBase[k * 3] = bx + u * larg;
          this._bannerBase[k * 3 + 1] = by - (j / (LINHAS - 1)) * alt;
          this._bannerBase[k * 3 + 2] = bz;
        }
      }
      for (let j = 0; j < LINHAS - 1; j++) {
        for (let i = 0; i < COLS - 1; i++) {
          const a = off + j * COLS + i;
          idx.push(a, a + COLS, a + 1, a + 1, a + COLS, a + COLS + 1);
        }
      }
    });
    pos.set(this._bannerBase);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.bannerGeo = geo;
    this.banners = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(TINTAS.pano));
    this.banners.castShadow = false;
    this.banners.frustumCulled = false;
    this.banners.name = "castelo-estandartes";
    this.group.add(this.banners);

    // Os mastros, estes sim parados: entram no lote da pedra... mas o lote já
    // foi esvaziado, então saem numa malha própria e barata de ferro.
    const lote = new Lote();
    for (const [bx, by, bz, larg] of this.bannerSpots) {
      lote.box("ferro", 0.04, 0.06, 0.04, bx + larg * 0.5, by + 0.1, bz);
      lote.box("ferro", larg * 0.55, 0.035, 0.035, bx + larg * 0.5, by + 0.14, bz);
    }
    lote.flush(this.group);
    this._bannerFase = 0;
  }

  /**
   * O pano ondula, e a onda cresce da tralha para a ponta solta.
   *
   * `u²` e não `u`: perto do mastro o tecido está preso e quase não se move; na
   * ponta ele chicoteia. Uma amplitude constante daria uma bandeira de borracha
   * balançando inteira, que é o erro clássico e se reconhece na hora.
   */
  updateBanners(dt, vento = 0) {
    if (!this.banners) return;
    this._bannerFase += dt * (2.2 + vento * 0.5);
    const amp = 0.1 + Math.min(0.34, vento * 0.035);
    const pos = this.bannerGeo.attributes.position;
    const base = this._bannerBase;
    const t = this._bannerFase;
    for (let k = 0; k < this._bannerU.length; k++) {
      const u = this._bannerU[k];
      const peso = u * u;
      const y = base[k * 3 + 1];
      const onda = Math.sin(t + u * 5.2 + y * 1.7) * amp * peso;
      pos.array[k * 3] = base[k * 3] - peso * amp * 0.5;
      pos.array[k * 3 + 1] = y + onda * 0.35;
      pos.array[k * 3 + 2] = base[k * 3 + 2] + onda;
    }
    pos.needsUpdate = true;
    this.bannerGeo.computeVertexNormals();
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

    /* O FERRO DOS SETE BRASEIROS SAI NUMA MALHA SÓ.
     *
     * Cesto e tripé não se mexem — quem respira é a chama. Um `Mesh` por peça
     * dariam catorze chamadas de desenho para desenhar catorze cilindros
     * imóveis, num modo que ainda tem 120 sitiantes e uma horda de flechas para
     * pagar. Fundidos, é uma. As chamas continuam soltas porque cada uma tem a
     * própria fase de tremor, e sete `MeshBasicMaterial` sem luz são o pedaço
     * mais barato do quadro.
     *
     * O piso vem DECLARADO em `adarve`, e não inferido do z — ver o comentário
     * da lista em `CONFIG.levels.castle.braziers`. */
    const geoPe = new THREE.CylinderGeometry(0.07, 0.09, L.brazierHeight, 6);
    const ferros = [];
    const m4 = new THREE.Matrix4();

    for (const p of L.braziers) {
      const y = (p.adarve ? WALL_TOP : GROUND_Y) + L.brazierHeight;

      ferros.push(geoCesto.clone().applyMatrix4(m4.makeTranslation(p.x, y, p.z)));
      // O tripé: sem ele o cesto flutua, e no pátio isso fica à altura do olho.
      ferros.push(
        geoPe.clone().applyMatrix4(
          m4.makeTranslation(p.x, y - L.brazierHeight / 2 - 0.16, p.z),
        ),
      );

      const chama = new THREE.Mesh(geoChama, matChama);
      chama.position.set(p.x, y + 0.3, p.z);
      chama.renderOrder = 5;
      chama.frustumCulled = false;
      this.group.add(chama);
      this.braziers.push({ chama, fase: Math.random() * Math.PI * 2 });

      if (p.luz) {
        const luz = new THREE.PointLight(L.brazierColor, L.brazierIntensity, L.brazierRange, 2);
        luz.position.set(p.x, y + 0.4, p.z);
        this.group.add(luz);
        this.lights.push(luz);
      }
    }

    const ferro = new THREE.Mesh(mergeGeometries(ferros, false), matCesto);
    for (const g of ferros) g.dispose();
    ferro.castShadow = true;
    ferro.name = "castelo-braseiros";
    this.group.add(ferro);
    geoCesto.dispose();
    geoPe.dispose();
  }

  /** Onde os trabucos ficam. Repassa `castleProps` para quem monta os engenhos. */
  get postos() {
    return trebuchetPosts();
  }

  /**
   * @param {number} dt
   * @param {number} dusk 0 = Sol alto, 1 = Sol no horizonte. Ver `setDusk`.
   * @param {number} vento m/s — a MESMA velocidade que entorta a flecha
   */
  update(dt, dusk = 0, vento = 0) {
    this.updateBanners(dt, vento);
    this.updateFogo(dt, dusk);
  }

  updateFogo(dt, dusk) {
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
    // UMA atribuição: as sete chamas dividem o mesmo material.
    if (this.braziers.length) this.braziers[0].chama.material.opacity = f;
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
    this.banners = null;
    this.bannerGeo = null;
    this.group = null;
    this.physics = null;
  }
}

export { WALL_TOP, GROUND_Y, MERLON_TOP };
