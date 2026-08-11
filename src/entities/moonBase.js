/* ---------------------------------------------------------------------------
   A base lunar: foguete, hábitats, painéis, antena, rover e carga.

   A peça que justifica o jetpack é O FOGUETE. Ele tem 28 m até a plataforma, e
   o tanque cheio sobe até ~50 m — dá para chegar lá em cima com folga, mas não
   de graça: a subida come 4 dos 6 segundos, então quem sobe fica sem
   combustível para escapar por um tempo. É essa troca que transforma "o ponto
   alto do mapa" numa decisão em vez de um lugar.

   ORÇAMENTO. O cenário inteiro tem de caber em ~12 chamadas de desenho, e a
   regra que consegue isso é uma só: **as peças são agrupadas por MATERIAL e
   fundidas numa geometria só**. Cinquenta caixas de treliça em cinco cores
   custariam cinquenta chamadas; as mesmas cinquenta caixas em cinco materiais
   custam cinco. `mergeGeometries` faz isso na construção, uma vez.

   Os colisores NÃO seguem a malha fundida: eles são primitivas simples
   (cilindro, caixa) posicionadas à mão. Um trimesh do foguete inteiro seria
   caro de construir e não acrescentaria nada — ninguém precisa que a flecha
   distinga uma aleta de um anel de reforço.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { makeRandom } from "../utils/math.js";

/* A paleta de um programa espacial: branco de pintura térmica, metal escuro,
   e o OURO da manta de isolamento — que é a cor mais reconhecível de hardware
   espacial real, e a única coisa quente num cenário todo cinza. */
const TINTAS = {
  casco: { color: "#d9d9d3", roughness: 0.62, metalness: 0.12 },
  metal: { color: "#40454c", roughness: 0.45, metalness: 0.75 },
  ouro: { color: "#c8952c", roughness: 0.32, metalness: 0.9 },
  escuro: { color: "#22262b", roughness: 0.6, metalness: 0.5 },
  aviso: { color: "#c4502a", roughness: 0.7, metalness: 0.1 },
  painel: { color: "#1b2a4d", roughness: 0.25, metalness: 0.55 },
};

/**
 * Acumula geometrias por material e entrega tudo em poucas malhas.
 *
 * É o coração do orçamento: quem constrói uma peça só diz "esta caixa é de
 * metal", e no fim todas as caixas de metal do cenário viram UMA malha.
 */
class Lote {
  constructor() {
    this.porTinta = new Map();
  }

  /** @param {string} tinta chave de `TINTAS` */
  add(tinta, geo, matriz) {
    const g = geo.clone().applyMatrix4(matriz);
    let lista = this.porTinta.get(tinta);
    if (!lista) this.porTinta.set(tinta, (lista = []));
    lista.push(g);
  }

  /** Funde e pendura no grupo. Devolve quantas chamadas de desenho custou. */
  flush(parent) {
    let calls = 0;
    for (const [tinta, lista] of this.porTinta) {
      const geo = lista.length === 1 ? lista[0] : mergeGeometries(lista, false);
      if (!geo) continue;
      if (lista.length > 1) for (const g of lista) g.dispose();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(TINTAS[tinta]));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `base-${tinta}`;
      parent.add(mesh);
      calls++;
    }
    this.porTinta.clear();
    return calls;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** Matriz de posição/rotação/escala, sem alocar. */
function trs(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.compose(_v, _q, _s);
}

export class MoonBase {
  /**
   * @param {THREE.Object3D} parent raiz da fase
   * @param {import("../core/physics.js").PhysicsWorld} physics
   * @param {import("../shared/moonField.js").MoonField} terrain
   */
  build(parent, physics, terrain) {
    const M = CONFIG.levels.moon;
    const B = M.base;
    this.physics = physics;
    this.terrain = terrain;

    this.group = new THREE.Group();
    this.group.name = "moon-base";
    parent.add(this.group);

    const lote = new Lote();
    const chao = (x, z) => terrain.heightAt(x, z);
    const solo = chao(B.x, B.z);

    this.buildRocket(lote, physics, B.x, B.z, solo);
    this.buildHabitats(lote, physics, B, chao);
    this.buildSolarFarm(lote, B, chao);
    this.buildDish(lote, physics, B, chao);
    this.buildLanderAndRover(lote, physics, B, chao);
    this.buildCargo(lote, physics, B, chao);
    this.buildFlag(lote, B, chao);

    this.drawCalls = lote.flush(this.group);
    return this;
  }

  /* ------------------------------------------------------------ foguete ---- */

  /**
   * O foguete, e a plataforma que é o ponto do cenário.
   *
   * A plataforma precisa de três coisas para funcionar como posto de tiro:
   * um colisor horizontal onde o controlador de personagem consiga POUSAR (o
   * `computedGrounded()` já resolve isso, é o mesmo caminho de subir numa
   * pedra no vale); um parapeito baixo, para não se cair sem querer ao andar
   * mirando; e linha de tiro limpa para a base inteira — daí ela ficar no
   * centro, e não na borda.
   */
  buildRocket(lote, physics, x, z, solo) {
    const ALTURA = 28; // m até o piso da plataforma
    const RAIO = 2.6;

    // Corpo: três seções que afinam, com anéis de reforço entre elas.
    const secoes = [
      { y: 0, h: 12, r0: RAIO, r1: RAIO },
      { y: 12, h: 10, r0: RAIO, r1: RAIO * 0.86 },
      { y: 22, h: 6, r0: RAIO * 0.86, r1: RAIO * 0.66 },
    ];
    for (const s of secoes) {
      lote.add(
        "casco",
        new THREE.CylinderGeometry(s.r1, s.r0, s.h, 20, 1, true),
        trs(x, solo + s.y + s.h / 2, z),
      );
    }

    // Anéis: separam as seções e dão escala ao cilindro. Sem eles, um cilindro
    // liso de 28 m parece um poste de 3 m — não há nada para medir.
    for (const y of [4, 8, 12, 16, 20, 22, 25]) {
      const r = y < 12 ? RAIO : y < 22 ? RAIO * 0.93 : RAIO * 0.76;
      lote.add(
        "metal",
        new THREE.TorusGeometry(r, 0.14, 6, 22),
        trs(x, solo + y, z, Math.PI / 2),
      );
    }

    // Faixa de aviso e a manta de ouro na base do motor.
    lote.add("aviso", new THREE.CylinderGeometry(RAIO * 1.01, RAIO * 1.01, 1.2, 20, 1, true), trs(x, solo + 9.4, z));
    lote.add("ouro", new THREE.CylinderGeometry(RAIO * 0.98, RAIO * 1.05, 2.4, 20, 1, true), trs(x, solo + 1.2, z));

    // Quatro aletas.
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const fin = new THREE.BoxGeometry(0.35, 6.5, 3.4);
      lote.add("casco", fin, trs(x + Math.cos(a) * (RAIO + 1.4), solo + 3.2, z + Math.sin(a) * (RAIO + 1.4), 0, -a, 0));
    }

    // Sino do motor, embaixo.
    lote.add("escuro", new THREE.CylinderGeometry(1.5, 2.2, 2.6, 16, 1, true), trs(x, solo - 0.4, z));

    /* --------------------------------------------------- a plataforma --- */
    const RP = 3.6; // m — raio do piso
    const yPiso = solo + ALTURA;

    lote.add("metal", new THREE.CylinderGeometry(RP, RP, 0.35, 22), trs(x, yPiso, z));
    // Parapeito: um anel de balaústres + o corrimão. Baixo de propósito — é
    // para tropeçar, não para tapar a mira.
    lote.add("metal", new THREE.TorusGeometry(RP - 0.15, 0.07, 5, 24), trs(x, yPiso + 1.0, z, Math.PI / 2));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      lote.add(
        "metal",
        new THREE.CylinderGeometry(0.05, 0.05, 1.0, 5),
        trs(x + Math.cos(a) * (RP - 0.15), yPiso + 0.5, z + Math.sin(a) * (RP - 0.15)),
      );
    }
    // Cone de nariz, acima da plataforma.
    lote.add("casco", new THREE.ConeGeometry(RAIO * 0.66, 5.5, 18), trs(x, yPiso + 3.1, z));

    /* ------------------------------------------------ torre de serviço --- */
    const tx = x + RAIO + 3.2;
    for (let y = 0; y < ALTURA; y += 2.4) {
      lote.add("metal", new THREE.BoxGeometry(2.2, 0.16, 0.16), trs(tx, solo + y, z));
      lote.add("metal", new THREE.BoxGeometry(0.16, 2.6, 0.16), trs(tx - 1.0, solo + y + 1.2, z));
      lote.add("metal", new THREE.BoxGeometry(0.16, 2.6, 0.16), trs(tx + 1.0, solo + y + 1.2, z));
    }

    /* ------------------------------------------------------ colisores --- */
    // Corpo: um cilindro só. A flecha não precisa distinguir aleta de anel.
    this.solid(physics, RAPIER.ColliderDesc.cylinder(ALTURA / 2, RAIO), x, solo + ALTURA / 2, z, "foguete");
    // A plataforma. É ela que o `computedGrounded()` encontra sob os pés.
    this.solid(physics, RAPIER.ColliderDesc.cylinder(0.22, RP), x, yPiso + 0.05, z, "plataforma");
    // Parapeito: um anel de caixas finas. Um cilindro oco não existe no
    // Rapier, e uma cápsula fecharia o topo — ninguém conseguiria pousar.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.solid(
        physics,
        RAPIER.ColliderDesc.cuboid(RP * 0.42, 0.5, 0.12),
        x + Math.cos(a) * RP,
        yPiso + 0.7,
        z + Math.sin(a) * RP,
        "parapeito",
        -a,
      );
    }
    this.solid(physics, RAPIER.ColliderDesc.cuboid(1.2, ALTURA / 2, 0.3), tx, solo + ALTURA / 2, z, "torre");

    this.platformY = yPiso;
  }

  /* ----------------------------------------------------------- hábitats --- */

  buildHabitats(lote, physics, B, chao) {
    const postos = [
      { dx: -22, dz: 8, r: 5.2 },
      { dx: -14, dz: 20, r: 4.4 },
      { dx: -27, dz: 21, r: 3.8 },
    ];

    let anterior = null;
    for (const p of postos) {
      const x = B.x + p.dx;
      const z = B.z + p.dz;
      const y = chao(x, z);

      // Domo + saia de ancoragem.
      lote.add("casco", new THREE.SphereGeometry(p.r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), trs(x, y, z));
      lote.add("ouro", new THREE.CylinderGeometry(p.r * 1.04, p.r * 1.1, 0.7, 18, 1, true), trs(x, y + 0.35, z));
      // Escotilha, para o domo ter frente.
      lote.add("escuro", new THREE.CylinderGeometry(0.9, 0.9, 0.25, 12), trs(x + p.r * 0.72, y + 1.1, z, 0, 0, Math.PI / 2));

      // Túnel de ligação até o domo anterior: é o que faz três bolhas virarem
      // uma base, em vez de três bolhas.
      if (anterior) {
        const dx = x - anterior.x;
        const dz = z - anterior.z;
        const comp = Math.hypot(dx, dz);
        lote.add(
          "casco",
          new THREE.CylinderGeometry(1.05, 1.05, comp, 10, 1, true),
          trs((x + anterior.x) / 2, (y + anterior.y) / 2 + 1.1, (z + anterior.z) / 2, Math.PI / 2, 0, -Math.atan2(dz, dx) + Math.PI / 2),
        );
      }
      anterior = { x, y, z };

      this.solid(physics, RAPIER.ColliderDesc.cuboid(p.r * 0.78, p.r * 0.6, p.r * 0.78), x, y + p.r * 0.5, z, "hábitat");
    }
  }

  /* ------------------------------------------------------------ painéis --- */

  buildSolarFarm(lote, B, chao) {
    /* Sem colisor de propósito: as placas ficam a 2,4 m e passa-se por baixo.
       Um colisor aqui só criaria parede invisível num lugar em que o olho diz
       que dá para passar. */
    for (let fila = 0; fila < 2; fila++) {
      for (let i = 0; i < 6; i++) {
        const x = B.x + 16 + fila * 9;
        const z = B.z - 14 + i * 5.2;
        const y = chao(x, z);
        // Inclinadas para o Sol rasante, como painel de verdade.
        lote.add("painel", new THREE.BoxGeometry(6.4, 0.12, 3.6), trs(x, y + 2.4, z, 0, 0, -0.42));
        lote.add("metal", new THREE.CylinderGeometry(0.12, 0.16, 2.4, 7), trs(x, y + 1.2, z));
      }
    }
  }

  buildDish(lote, physics, B, chao) {
    const x = B.x + 6;
    const z = B.z + 24;
    const y = chao(x, z);

    lote.add("metal", new THREE.CylinderGeometry(0.22, 0.3, 4.2, 8), trs(x, y + 2.1, z));
    // Parabólica: esfera cortada, virada para o céu e para a Terra.
    lote.add(
      "casco",
      new THREE.SphereGeometry(3.1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
      trs(x, y + 4.4, z, Math.PI * 0.72, 0, 0.4),
    );
    lote.add("escuro", new THREE.CylinderGeometry(0.1, 0.1, 2.2, 6), trs(x - 0.7, y + 5.4, z + 0.7, 0.6, 0, 0.5));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      lote.add("metal", new THREE.CylinderGeometry(0.09, 0.09, 2.6, 5), trs(x + Math.cos(a) * 1.1, y + 1.1, z + Math.sin(a) * 1.1, 0.36, -a, 0));
    }
    this.solid(physics, RAPIER.ColliderDesc.cylinder(2.1, 0.4), x, y + 2.1, z, "antena");
  }

  buildLanderAndRover(lote, physics, B, chao) {
    /* ---------------------------------------------------------- módulo --- */
    const lx = B.x + 20;
    const lz = B.z + 16;
    const ly = chao(lx, lz);
    lote.add("ouro", new THREE.BoxGeometry(4.2, 2.4, 4.2), trs(lx, ly + 2.2, lz));
    lote.add("casco", new THREE.CylinderGeometry(1.6, 2.0, 1.8, 8), trs(lx, ly + 4.2, lz));
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      lote.add("metal", new THREE.CylinderGeometry(0.11, 0.11, 3.4, 6), trs(lx + Math.cos(a) * 2.2, ly + 1.3, lz + Math.sin(a) * 2.2, 0.5, -a, 0));
      lote.add("metal", new THREE.CylinderGeometry(0.55, 0.55, 0.16, 10), trs(lx + Math.cos(a) * 3.3, ly + 0.1, lz + Math.sin(a) * 3.3));
    }
    this.solid(physics, RAPIER.ColliderDesc.cuboid(2.2, 1.8, 2.2), lx, ly + 2.2, lz, "módulo");

    /* ----------------------------------------------------------- rover --- */
    const rx = B.x - 8;
    const rz = B.z - 12;
    const ry = chao(rx, rz);
    lote.add("casco", new THREE.BoxGeometry(3.2, 0.7, 1.9), trs(rx, ry + 1.0, rz));
    lote.add("escuro", new THREE.BoxGeometry(1.3, 0.8, 1.5), trs(rx - 0.7, ry + 1.7, rz));
    lote.add("painel", new THREE.BoxGeometry(2.0, 0.08, 1.7), trs(rx + 0.6, ry + 1.5, rz, 0, 0, -0.12));
    for (const sx of [-1.1, 1.1]) {
      for (const sz of [-1.05, 1.05]) {
        lote.add("escuro", new THREE.CylinderGeometry(0.52, 0.52, 0.34, 12), trs(rx + sx, ry + 0.52, rz + sz, 0, 0, Math.PI / 2));
      }
    }
    this.solid(physics, RAPIER.ColliderDesc.cuboid(1.7, 0.9, 1.1), rx, ry + 1.0, rz, "rover");
  }

  /**
   * Contêineres de carga.
   *
   * São COBERTURA, e é para isso que existem: um duelo com jetpack numa
   * planície é uma troca de tiros sem nada a decidir. Espalhados em volta da
   * base, dão o que contornar no chão e o que sobrevoar no ar.
   */
  buildCargo(lote, physics, B, chao) {
    const rnd = makeRandom(31415);
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 12 + rnd() * 26;
      const x = B.x + Math.cos(a) * d;
      const z = B.z + Math.sin(a) * d;
      const y = chao(x, z);
      const w = 1.6 + rnd() * 1.4;
      const h = 1.2 + rnd() * 1.0;
      const giro = rnd() * Math.PI;
      const tinta = rnd() < 0.3 ? "ouro" : rnd() < 0.5 ? "aviso" : "casco";
      lote.add(tinta, new THREE.BoxGeometry(w * 2, h * 2, w * 1.5), trs(x, y + h, z, 0, giro, 0));
      this.solid(physics, RAPIER.ColliderDesc.cuboid(w, h, w * 0.75), x, y + h, z, "carga", giro);
    }
  }

  /** A bandeira. RÍGIDA — não há vento para tremular, e é isso que a torna certa. */
  buildFlag(lote, B, chao) {
    const x = B.x - 5;
    const z = B.z + 9;
    const y = chao(x, z);
    lote.add("metal", new THREE.CylinderGeometry(0.055, 0.055, 3.2, 6), trs(x, y + 1.6, z));
    lote.add("metal", new THREE.CylinderGeometry(0.04, 0.04, 1.3, 5), trs(x + 0.65, y + 3.1, z, 0, 0, Math.PI / 2));
    lote.add("aviso", new THREE.BoxGeometry(1.25, 0.78, 0.03), trs(x + 0.64, y + 2.72, z));
  }

  /* ------------------------------------------------------------ auxiliar -- */

  /** Corpo fixo + colisor, já registrado como cenário (a flecha crava neles). */
  solid(physics, desc, x, y, z, nome, giroY = 0) {
    const body = physics.createBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({
        x: 0,
        y: Math.sin(giroY / 2),
        z: 0,
        w: Math.cos(giroY / 2),
      }),
    );
    const collider = physics.createCollider(
      desc.setFriction(0.9).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    physics.register(collider, { kind: "scenery", name: nome });
    return collider;
  }

  /** Só solta as referências: o visual sai com a raiz da fase, a física com o
   *  `recreate()`. Ver `levels/index.js`. */
  dispose() {
    this.group = null;
  }
}
