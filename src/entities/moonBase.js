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
import { shared } from "../levels/resources.js";
import { Rover } from "./rover.js";

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

/**
 * A bandeira, desenhada em canvas.
 *
 * Treze listras, cinquenta estrelas e o cantão azul — pintados por código, como
 * todo o resto do jogo. É recurso de MÓDULO (`shared`) porque uma só existe e
 * ela sobrevive a qualquer troca de fase; destruí-la junto com a Lua deixaria a
 * bandeira branca na segunda visita. Ver `levels/resources.js`.
 */
let _bandeira = null;
function bandeiraTextura() {
  if (_bandeira) return _bandeira;

  const L = 1900;
  const A = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = L;
  canvas.height = A;
  const g = canvas.getContext("2d");

  // 13 listras, começando e terminando em vermelho.
  const hFaixa = A / 13;
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 === 0 ? "#b22234" : "#ffffff";
    g.fillRect(0, i * hFaixa, L, hFaixa + 1);
  }

  // Cantão: 7 listras de altura, 2/5 do comprimento.
  const cL = L * 0.4;
  const cA = hFaixa * 7;
  g.fillStyle = "#3c3b6e";
  g.fillRect(0, 0, cL, cA);

  /* As 50 estrelas: cinco fileiras de seis alternadas com quatro de cinco.
     Desenhadas como pentagramas de verdade — um círculo branco ficaria com
     cara de confete, e a estrela é o que se reconhece à distância. */
  g.fillStyle = "#ffffff";
  const estrela = (cx, cy, r) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      const raio = i % 2 === 0 ? r : r * 0.382;
      const px = cx + Math.cos(ang) * raio;
      const py = cy + Math.sin(ang) * raio;
      i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  };
  const passoX = cL / 12;
  const passoY = cA / 10;
  for (let linha = 0; linha < 9; linha++) {
    const n = linha % 2 === 0 ? 6 : 5;
    const off = linha % 2 === 0 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      estrela(passoX * (off + i * 2), passoY * (linha + 1), passoX * 0.62);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _bandeira = shared(tex);
  return _bandeira;
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
    this.buildSolarFarm(lote, physics, B, chao);
    this.buildDish(lote, physics, B, chao);
    this.buildLander(lote, physics, B, chao);
    this.buildCargo(lote, physics, B, chao);
    this.buildFlag(lote, B, chao);

    this.drawCalls = lote.flush(this.group);

    /* O rover FICA DE FORA do lote fundido — ele se move, e uma geometria
       fundida não move uma peça isolada. Ver `entities/rover.js`. */
    this.rover = new Rover(this.group, physics, terrain, B.x, B.z);

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

    /* ------------------------------------------------- as plataformas ---
       DUAS, e sem parapeito nenhum.

       O parapeito saiu porque ele resolvia um problema que o jogador não tem:
       cair de lá é barato na Lua (queda de 28 m é lenta e não machuca) e a
       grade tapava justamente a linha de tiro rasante, que é o motivo de
       subir. Sem ela, o topo é um posto de tiro de 360°.

       A do MEIO existe para a subida ter uma etapa. Ir direto ao topo custa
       quatro dos seis segundos de tanque; parar na metade custa dois, e daí dá
       para atirar, esperar encher e subir de novo. É a diferença entre um
       ponto alto e uma rota. */
    const RP = 3.6; // m — raio do piso do topo
    /* O do meio ERA 2,9 m — perto demais do casco nessa altura (o corpo do
       foguete já afina para ~2,53 m ali), sobrando uns 37 cm de aro para pisar.
       Em 3,4 m a folga vira ~0,9 m, de verdade utilizável, sem ultrapassar o
       piso de cima. */
    const RM = 3.4; // m — o do meio, um pouco menor que o de cima
    const yPiso = solo + ALTURA;
    const yMeio = solo + 14;

    lote.add("metal", new THREE.CylinderGeometry(RP, RP, 0.35, 22), trs(x, yPiso, z));
    lote.add("metal", new THREE.CylinderGeometry(RM, RM, 0.3, 20), trs(x, yMeio, z));
    // Um friso na borda de cada piso: sem ele o disco some contra o casco e a
    // plataforma não se lê de baixo.
    lote.add("aviso", new THREE.TorusGeometry(RP, 0.1, 5, 24), trs(x, yPiso + 0.16, z, Math.PI / 2));
    lote.add("aviso", new THREE.TorusGeometry(RM, 0.09, 5, 22), trs(x, yMeio + 0.14, z, Math.PI / 2));

    // Cone de nariz, acima da plataforma.
    lote.add("casco", new THREE.ConeGeometry(RAIO * 0.66, 5.5, 18), trs(x, yPiso + 3.1, z));

    /* ---------------------------------------------- baliza de aviação ---
       Luz vermelha piscando no topo, como em qualquer estrutura alta.

       É uma `PointLight` — a única do cenário. Vale o custo: num céu preto sem
       névoa, ela é a coisa que localiza a base de qualquer ponto da arena, e o
       piscar dá ao horizonte um relógio. O mesh emissivo sozinho apareceria,
       mas não pintaria o cone de nariz de vermelho a cada pulso, que é o que
       vende a luz como luz. */
    const yBaliza = yPiso + 6.2;
    this.beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2a18, fog: false }),
    );
    this.beacon.position.set(x, yBaliza, z);
    this.group.add(this.beacon);

    this.beaconLight = new THREE.PointLight(0xff2a18, 0, 26, 1.6);
    this.beaconLight.position.set(x, yBaliza, z);
    this.group.add(this.beaconLight);

    /* ------------------------------------------------------ colisores --- */
    // Corpo: um cilindro só. A flecha não precisa distinguir aleta de anel.
    this.solid(physics, RAPIER.ColliderDesc.cylinder(ALTURA / 2, RAIO), x, solo + ALTURA / 2, z, "foguete");
    // As plataformas. São elas que o `computedGrounded()` encontra sob os pés.
    this.solid(physics, RAPIER.ColliderDesc.cylinder(0.22, RP), x, yPiso + 0.05, z, "plataforma");
    this.solid(physics, RAPIER.ColliderDesc.cylinder(0.2, RM), x, yMeio + 0.05, z, "plataforma-meio");

    this.platformY = yPiso;
    this.midPlatformY = yMeio;
  }

  /**
   * A baliza pisca: dois lampejos curtos e uma pausa longa, como as de verdade.
   *
   * @param {number} tempoSala relógio da sala (ms). A fase sai DELE, não de um
   *   acumulador local: é a mesma ideia do vento — uma função pura do tempo
   *   compartilhado pisca em fase em todas as telas sem trafegar nada. Sem
   *   sala, o relógio local serve e a baliza pisca igual, só não compartilhada.
   */
  update(dt, tempoSala = 0) {
    this.rover?.update(dt);

    if (!this.beaconLight) return;
    const t = ((tempoSala || performance.now()) / 1000) % 2.6;
    const aceso = t < 0.12 || (t > 0.34 && t < 0.46);
    this.beaconLight.intensity = aceso ? 42 : 0;
    this.beacon.material.opacity = aceso ? 1 : 0.25;
    this.beacon.material.transparent = true;
  }

  /* ----------------------------------------------------------- hábitats --- */

  buildHabitats(lote, physics, B, chao) {
    /* Os domos foram AFASTADOS uns dos outros e da base.
     *
     * Amontoados eles liam como um só objeto e, pior, não davam jogo: um duelo
     * com jetpack precisa de vãos para atravessar e de silhuetas separadas para
     * contornar. Espalhados, cada peça vira uma referência de navegação — "vou
     * pelo domo grande" passa a significar alguma coisa. */
    const postos = [
      { dx: -46, dz: 14, r: 5.6 },
      { dx: -30, dz: 40, r: 4.6 },
      { dx: -58, dz: 44, r: 4.0 },
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

  buildSolarFarm(lote, physics, B, chao) {
    /* As placas SÃO sólidas: com jetpack passa-se por cima delas o tempo todo,
       e uma placa atravessável desmentia o olho tanto quanto uma parede
       invisível desmentiria. Continua-se passando por baixo — o colisor é só a
       chapa, inclinada como ela, a 2,4 m; o mastro é fino e fica livre. */
    for (let fila = 0; fila < 2; fila++) {
      for (let i = 0; i < 6; i++) {
        const x = B.x + 38 + fila * 14;
        const z = B.z - 30 + i * 11;
        const y = chao(x, z);
        // Inclinadas para o Sol rasante, como painel de verdade.
        lote.add("painel", new THREE.BoxGeometry(6.4, 0.12, 3.6), trs(x, y + 2.4, z, 0, 0, -0.42));
        lote.add("metal", new THREE.CylinderGeometry(0.12, 0.16, 2.4, 7), trs(x, y + 1.2, z));
        this.solid(physics, RAPIER.ColliderDesc.cuboid(3.2, 0.06, 1.8), x, y + 2.4, z, "painel solar", 0, -0.42);
      }
    }
  }

  buildDish(lote, physics, B, chao) {
    const x = B.x + 22;
    const z = B.z + 52;
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

  /** O módulo pousado. O rover mora em `entities/rover.js` — ele anda. */
  buildLander(lote, physics, B, chao) {
    const lx = B.x + 44;
    const lz = B.z + 34;
    const ly = chao(lx, lz);
    lote.add("ouro", new THREE.BoxGeometry(4.2, 2.4, 4.2), trs(lx, ly + 2.2, lz));
    lote.add("casco", new THREE.CylinderGeometry(1.6, 2.0, 1.8, 8), trs(lx, ly + 4.2, lz));
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      lote.add("metal", new THREE.CylinderGeometry(0.11, 0.11, 3.4, 6), trs(lx + Math.cos(a) * 2.2, ly + 1.3, lz + Math.sin(a) * 2.2, 0.5, -a, 0));
      lote.add("metal", new THREE.CylinderGeometry(0.55, 0.55, 0.16, 10), trs(lx + Math.cos(a) * 3.3, ly + 0.1, lz + Math.sin(a) * 3.3));
    }
    this.solid(physics, RAPIER.ColliderDesc.cuboid(2.2, 1.8, 2.2), lx, ly + 2.2, lz, "módulo");
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
      const d = 18 + rnd() * 58;
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

  /**
   * A bandeira dos Estados Unidos, como a que ficou lá em 1969.
   *
   * RÍGIDA, e essa é a parte interessante: ela tem uma barra horizontal no topo
   * justamente porque não há vento na Lua — sem a barra, o pano penderia morto
   * ao longo do mastro e não apareceria em foto nenhuma. O detalhe que parece
   * um erro de física é, na verdade, a solução que a NASA teve de inventar.
   *
   * Fica FORA do grupo fundido porque precisa da própria textura; é uma chamada
   * de desenho a mais, e a única do cenário que se paga sozinha.
   */
  buildFlag(lote, B, chao) {
    const x = B.x - 14;
    const z = B.z + 22;
    const y = chao(x, z);

    lote.add("metal", new THREE.CylinderGeometry(0.045, 0.045, 3.2, 6), trs(x, y + 1.6, z));
    lote.add("metal", new THREE.CylinderGeometry(0.035, 0.035, 1.42, 5), trs(x + 0.71, y + 3.06, z, 0, 0, Math.PI / 2));

    const pano = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.74),
      new THREE.MeshStandardMaterial({
        map: bandeiraTextura(),
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    pano.position.set(x + 0.7, y + 2.68, z + 0.004);
    pano.castShadow = true;
    pano.receiveShadow = true;
    this.group.add(pano);
  }

  /* ------------------------------------------------------------ auxiliar -- */

  /** Corpo fixo + colisor, já registrado como cenário (a flecha crava neles). */
  solid(physics, desc, x, y, z, nome, giroY = 0, giroZ = 0) {
    /* O giro é aplicado em Y e depois em Z — a mesma ordem do `trs()` visual,
       para o colisor não sair torto em relação à peça que ele representa. */
    const sy = Math.sin(giroY / 2);
    const cy = Math.cos(giroY / 2);
    const sz = Math.sin(giroZ / 2);
    const cz = Math.cos(giroZ / 2);
    const body = physics.createBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({
        x: sy * sz,
        y: sy * cz,
        z: cy * sz,
        w: cy * cz,
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
    this.rover = null;
  }
}
