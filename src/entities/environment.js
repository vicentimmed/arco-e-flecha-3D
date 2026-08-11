/* ---------------------------------------------------------------------------
   Cenário: uma ARENA FECHADA — bacia gramada com trilha de terra, cercada por
   sopé arborizado e, atrás dele, uma serra que sobe até ~100 m e fecha os
   quatro lados do horizonte.

   Três decisões estruturam este arquivo:

   1. O relevo vem de uma função de altura determinística; a MESMA geometria
      alimenta o render e o colisor trimesh, então não existe descolamento
      entre o que se vê e o que a física enxerga.

   2. O terreno se estende MUITO além da área jogável (±175 m em x, de +120 a
      -300 m em z). Não é desperdício: é o que garante que a arqueira nunca
      chegue a uma borda e caia no vazio, e que os cumes distantes tenham
      montanha atrás deles em vez de céu recortado. A malha é adensada no
      centro (ver `focusWarp`), então esse tamanho todo custa ~70 k triângulos.

   3. Vegetação e matacões são InstancedMesh. Umas 500 peças de cenário saem em
      6 chamadas de desenho em vez de 500.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { TerrainField, pathCenterX } from "../shared/terrainField.js";
import { SUN_DIR } from "../core/sun.js";
import { clamp, smoothstep, makeRandom } from "../utils/math.js";
import { shared } from "../levels/resources.js";

// Reexportado porque metade do jogo importa `pathCenterX` daqui.
export { pathCenterX };

/* Paleta alpina: gramado no fundo do vale, granito acinzentado nas paredes,
   talude claro no pé das falésias e neve nos cumes. O tom cinza-esverdeado é
   deliberado — rocha bege satura o quadro inteiro e é o que fazia a serra
   antiga parecer plástico. */
const PALETTE = {
  grass: new THREE.Color("#5d8a3a"),
  grassDry: new THREE.Color("#95a552"),
  grassDeep: new THREE.Color("#3f6b2c"),
  dirt: new THREE.Color("#b18e60"),
  dirtDark: new THREE.Color("#8a6a44"),
  scree: new THREE.Color("#9c9280"),
  // Pasto de altitude: o verde que sobe pelas encostas suaves da serra.
  alpine: new THREE.Color("#6f9145"),
  // A rocha puxa para o musgo e para o oliva em vez do cinza puro. Granito
  // exposto de verdade quase nunca é cinza limpo numa serra com chuva — e o
  // cinza limpo era o que fazia a montanha parecer concreto.
  rockLight: new THREE.Color("#84876d"),
  rockWarm: new THREE.Color("#7d7a54"),
  rockDark: new THREE.Color("#464b3c"),
  snow: new THREE.Color("#e8eef5"),
  snowShade: new THREE.Color("#b4c6da"),
};

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _n1 = new THREE.Vector3();

/**
 * Reparametrização da malha: leva t ∈ [-1,1] em [-1,1] concentrando amostras
 * perto de 0. `a` é a derivada na origem — quanto menor, mais denso o centro.
 */
export function focusWarp(t, a) {
  return t * (a + (1 - a) * t * t);
}

/* ------------------------------------------------------------- terreno ----- */

/**
 * O terreno visível.
 *
 * A matemática do relevo — altura, distância à arena, inclinação, onde se pode
 * pisar — mora em `shared/terrainField.js`, sem Three.js, porque o SERVIDOR
 * precisa das mesmas respostas para escolher onde os jogadores nascem e para
 * fazer os porcos andarem no chão certo. Aqui fica só o que é de cliente:
 * malha, cores e colisor.
 */
export class Terrain extends TerrainField {
  /** Constrói malha visual + colisor trimesh a partir da mesma geometria. */
  build(scene, physics) {
    const W = CONFIG.world;
    const { segmentsX, segmentsZ, gridFocus } = W;
    const nx = segmentsX + 1;
    const nz = segmentsZ + 1;

    const spanBack = W.maxZ - this.centerZ;
    const spanFront = this.centerZ - W.minZ;

    const positions = new Float32Array(nx * nz * 3);
    const colors = new Float32Array(nx * nz * 3);
    const normals = new Float32Array(nx * nz * 3);
    const indices = new Uint32Array(segmentsX * segmentsZ * 6);

    // Eixos pré-calculados: a malha é NÃO uniforme (densa na arena, rala nos
    // cumes), então cada linha/coluna tem sua própria coordenada.
    const xs = new Float32Array(nx);
    for (let i = 0; i < nx; i++) {
      const wgt = focusWarp((i / segmentsX) * 2 - 1, gridFocus);
      xs[i] = wgt * (wgt < 0 ? -W.minX : W.maxX);
    }
    const zs = new Float32Array(nz);
    for (let j = 0; j < nz; j++) {
      // j cresce em direção a -Z (frente), como na versão anterior.
      const wgt = focusWarp(1 - (j / segmentsZ) * 2, gridFocus);
      zs[j] = this.centerZ + wgt * (wgt < 0 ? spanFront : spanBack);
    }

    for (let j = 0; j < nz; j++) {
      const z = zs[j];
      for (let i = 0; i < nx; i++) {
        const idx = (j * nx + i) * 3;
        positions[idx] = xs[i];
        positions[idx + 1] = this.heightAt(xs[i], z);
        positions[idx + 2] = z;
      }
    }

    /* Normais por diferença central sobre a PRÓPRIA grade, não por amostragem
       analítica: assim o sombreamento descreve o triângulo que existe, e a
       malha rala dos cumes não finge um detalhe que sua geometria não tem. */
    const nrm = new THREE.Vector3();
    const c = new THREE.Color();
    for (let j = 0; j < nz; j++) {
      const jm = Math.max(0, j - 1);
      const jp = Math.min(nz - 1, j + 1);
      const dz = zs[jp] - zs[jm]; // negativo: z decresce com j
      for (let i = 0; i < nx; i++) {
        const im = Math.max(0, i - 1);
        const ip = Math.min(nx - 1, i + 1);
        const dx = xs[ip] - xs[im];
        const hL = positions[(j * nx + im) * 3 + 1];
        const hR = positions[(j * nx + ip) * 3 + 1];
        const hB = positions[(jm * nx + i) * 3 + 1];
        const hF = positions[(jp * nx + i) * 3 + 1];

        nrm.set(-(hR - hL) / dx, 1, -(hF - hB) / dz).normalize();

        const idx = (j * nx + i) * 3;
        normals[idx] = nrm.x;
        normals[idx + 1] = nrm.y;
        normals[idx + 2] = nrm.z;

        this.surfaceColor(xs[i], zs[j], positions[idx + 1], nrm, c);
        colors[idx] = c.r;
        colors[idx + 1] = c.g;
        colors[idx + 2] = c.b;
      }
    }

    // Ordem anti-horária vista de cima: como z DIMINUI conforme j cresce, a
    // sequência ingênua (a, cc, b) produz faces viradas para baixo e o chão
    // some por backface culling.
    let k = 0;
    for (let j = 0; j < segmentsZ; j++) {
      for (let i = 0; i < segmentsX; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const cc = a + nx;
        const d = cc + 1;
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = cc;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = cc;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
    });
    applyTerrainDetail(material);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = "terrain";
    scene.add(this.mesh);

    // Colisor: exatamente os mesmos vértices e índices da malha visual.
    const body = physics.createBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(positions, indices)
      .setFriction(0.95)
      .setRestitution(0.0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = physics.createCollider(desc, body);
    physics.register(collider, { kind: "terrain", name: "terreno" });

    this.body = body;
    this.collider = collider;
    return this;
  }

  /**
   * Cor macro do terreno, por vértice. Resolve as ZONAS (grama, terra, rocha,
   * talude, neve); o grão fino vem da textura triplanar do material.
   */
  surfaceColor(x, z, h, normal, out) {
    const n = this.noise;
    const A = CONFIG.world.arena;
    const slope = 1 - normal.y; // 0 = plano, 1 = parede
    const grain = n.fbm2(x * 0.09, z * 0.09, 3);
    const patch = n.fbm2(x * 0.021 + 40.5, z * 0.021 - 8.2, 2);

    // Gramado do fundo do vale, com manchas secas e reentrâncias mais escuras.
    out
      .copy(PALETTE.grass)
      .lerp(PALETTE.grassDry, clamp(0.45 + 0.55 * patch + 0.25 * grain, 0, 1))
      .lerp(PALETTE.grassDeep, clamp(0.3 - 0.6 * patch, 0, 1) * 0.7);

    // Trilha de terra batida.
    const dPath = Math.abs(x - pathCenterX(z));
    const pathMix = 1 - smoothstep(1.8, 4.6, dPath);
    if (pathMix > 0) {
      out.lerp(_c1.copy(PALETTE.dirt).lerp(PALETTE.dirtDark, 0.5 + 0.5 * grain), pathMix);
    }

    /* Pasto de altitude: o verde não para no fundo do vale.
       Numa serra de verdade a vegetação sobe pelas encostas suaves e só cede
       onde o terreno fica íngreme ou alto demais. Sem esta camada, tudo acima
       de ~30 m virava pedra cinza de uma vez e a serra lia como concreto. */
    const alpino =
      smoothstep(6, 26, h) * (1 - smoothstep(0.2, 0.52, slope)) *
      (1 - smoothstep(A.treeLine + 14, A.snowLine, h));
    if (alpino > 0.001) {
      out.lerp(
        _c1.copy(PALETTE.alpine).lerp(PALETTE.grassDeep, clamp(0.35 + 0.4 * patch, 0, 1)),
        alpino * 0.85,
      );
    }

    // Rocha: aflora tanto pela inclinação quanto pela altitude — o mesmo
    // granito não pode ficar gramado só porque um cume é achatado. Os limiares
    // de altitude subiram: a pedra agora aparece de verdade só nas paredes e
    // perto dos cumes, não em toda encosta média.
    const rockMix = clamp(
      Math.max(smoothstep(0.34, 0.62, slope), smoothstep(38, 74, h)) + 0.1 * grain,
      0,
      1,
    );
    if (rockMix > 0.001) {
      // Estratos: bandas horizontais alternando tom frio e quente.
      const strata = 0.5 + 0.5 * Math.sin(h * 0.5 + grain * 1.8 + patch * 3.0);
      const rock = _c2
        .copy(PALETTE.rockLight)
        .lerp(PALETTE.rockWarm, strata)
        .lerp(PALETTE.rockDark, smoothstep(0.45, 0.9, slope) * 0.75);
      // Talude de detritos: acumula onde a encosta afrouxa, ao pé das paredes.
      rock.lerp(
        PALETTE.scree,
        (1 - smoothstep(0.12, 0.34, slope)) * smoothstep(10, 26, h) * 0.6,
      );
      out.lerp(rock, rockMix);
    }

    // Neve: só onde é alto E não é vertical demais — em parede de 70° a neve
    // não fica, e é justamente esse recorte que dá leitura de altitude.
    const line = A.snowLine + 16 * patch + 5 * grain;
    const snowMix = smoothstep(line, line + 16, h) * smoothstep(0.62, 0.3, slope);
    if (snowMix > 0.001) {
      out.lerp(
        _c1.copy(PALETTE.snow).lerp(PALETTE.snowShade, clamp(slope * 1.4, 0, 1)),
        clamp(snowMix, 0, 1),
      );
    }

    // Oclusão barata: faces viradas para baixo escurecem.
    out.multiplyScalar(0.84 + 0.16 * clamp(normal.y, 0, 1));
  }
}

/* --------------------------------------------------- detalhe do terreno ---- */

/**
 * Textura de detalhe, gerada em código e PERIÓDICA (o ruído usa grades que dão
 * a volta em 256 px), então ela ladrilha sem costura.
 *
 * Um único RGBA carrega duas coisas: RGB = normal tangente (Sobel sobre o campo
 * de altura) e A = variação de albedo. Empacotar assim é o que permite fazer
 * amostragem triplanar com 3 leituras em vez de 6.
 */
function detailTexture(seed = 4242) {
  const S = 256;
  const rnd = makeRandom(seed);
  const height = new Float32Array(S * S);

  for (const [cells, amp] of [
    [4, 1.0],
    [8, 0.55],
    [16, 0.3],
    [32, 0.18],
    [64, 0.1],
    [128, 0.06],
  ]) {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    const step = S / cells;
    for (let y = 0; y < S; y++) {
      const fy = y / step;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const y0i = y0 % cells;
      const y1i = (y0 + 1) % cells;
      for (let x = 0; x < S; x++) {
        const fx = x / step;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x0i = x0 % cells;
        const x1i = (x0 + 1) % cells;
        const top = g[y0i * cells + x0i] + (g[y0i * cells + x1i] - g[y0i * cells + x0i]) * sx;
        const bot = g[y1i * cells + x0i] + (g[y1i * cells + x1i] - g[y1i * cells + x0i]) * sx;
        height[y * S + x] += (top + (bot - top) * sy) * amp;
      }
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < height.length; i++) {
    if (height[i] < min) min = height[i];
    if (height[i] > max) max = height[i];
  }
  const inv = 1 / (max - min || 1);
  for (let i = 0; i < height.length; i++) height[i] = (height[i] - min) * inv;

  const data = new Uint8Array(S * S * 4);
  const STRENGTH = 3.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = height[y * S + ((x - 1 + S) % S)];
      const r = height[y * S + ((x + 1) % S)];
      const u = height[((y - 1 + S) % S) * S + x];
      const d = height[((y + 1) % S) * S + x];
      const nx = (l - r) * STRENGTH;
      const ny = (u - d) * STRENGTH;
      const len = Math.hypot(nx, ny, 1);
      const i4 = (y * S + x) * 4;
      data[i4] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      data[i4 + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      data[i4 + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[i4 + 3] = Math.round(clamp(0.5 + (height[y * S + x] - 0.5) * 0.9, 0, 1) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/* Textura de grão do terreno: criada uma vez e reaproveitada por TODAS as
   fases. Vai marcada como recurso de módulo porque ela é o exemplo perfeito do
   que a regra protege — não é `material.map` de ninguém, ela entra como uniform
   de shader em `applyTerrainDetail`, então uma varredura de texturas por
   material não a enxergaria e uma varredura mais completa a destruiria sem
   perceber. Ver `levels/resources.js`. */
let sharedDetail = null;

/**
 * Enxerta amostragem TRIPLANAR no MeshStandardMaterial do terreno.
 *
 * Por que triplanar e não uma UV planar: a serra tem paredes de 70°, e uma UV
 * projetada em XZ estica a textura até virar listra justamente nelas. Triplanar
 * projeta nos três planos do mundo e mistura pelo peso da normal — custa 3
 * leituras em vez de 1, e é o que permite ter grão de rocha na falésia.
 *
 * A malha do terreno tem célula de 0,7 a 4,5 m; o detalhe fino (~2,4 m) e a
 * variação macro (~22 m) vivem só aqui, no fragmento, onde não custam vértice.
 */
export function applyTerrainDetail(material) {
  if (!sharedDetail) sharedDetail = shared(detailTexture());
  const uniforms = {
    detailMap: { value: sharedDetail },
    detailScale: { value: 0.42 }, // repetições por metro ⇒ ladrilho de ~2,4 m
    macroScale: { value: 0.045 }, // ⇒ manchas de ~22 m
    detailBump: { value: 0.5 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vWorldPos;
         varying vec3 vWorldNrm;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vWorldNrm = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform sampler2D detailMap;
         uniform float detailScale;
         uniform float macroScale;
         uniform float detailBump;
         varying vec3 vWorldPos;
         varying vec3 vWorldNrm;

         vec4 triplanar(sampler2D m, vec3 p, vec3 w, float s) {
           return texture2D(m, p.zy * s) * w.x
                + texture2D(m, p.xz * s) * w.y
                + texture2D(m, p.xy * s) * w.z;
         }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         vec3 triW = pow(abs(vWorldNrm), vec3(4.0));
         triW /= (triW.x + triW.y + triW.z + 1e-5);
         vec4 detail = triplanar(detailMap, vWorldPos, triW, detailScale);
         float macro = texture2D(detailMap, vWorldPos.xz * macroScale).a;
         // Ambos centrados em 0.5, então o valor médio não altera a paleta.
         diffuseColor.rgb *= (0.66 + 0.68 * detail.a) * (0.84 + 0.32 * macro);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec3 gn = normalize(vWorldNrm);
           vec3 tX = normalize(cross(abs(gn.y) < 0.99 ? vec3(0.0, 1.0, 0.0)
                                                      : vec3(1.0, 0.0, 0.0), gn));
           vec3 tY = cross(gn, tX);
           vec2 dn = detail.rg * 2.0 - 1.0;
           vec3 wn = normalize(gn + (tX * dn.x + tY * dn.y) * detailBump);
           normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
         }`,
      );
  };
  // Sem isto o Three reaproveitaria o programa de qualquer MeshStandardMaterial
  // com as mesmas flags, e o enxerto seria ignorado.
  material.customProgramCacheKey = () => "terrain-triplanar-detail";
}

/* ------------------------------------------------------------ matacões ----- */

function makeBoulderGeometry(random) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const seenKey = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Vértices coincidentes precisam do mesmo deslocamento, senão a casca abre.
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let f = seenKey.get(key);
    if (f === undefined) {
      f = 0.66 + random() * 0.5;
      seenKey.set(key, f);
    }
    v.multiplyScalar(f);
    v.y *= 0.78;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Matacões: 6 formas de raio unitário, instanciadas com escala e rotação
 * próprias. O colisor é o casco convexo dos MESMOS vértices, já transformados,
 * então a pedra que se vê é a pedra em que a flecha crava.
 */
function scatterBoulders(scene, physics, terrain, random) {
  const A = CONFIG.world.arena;
  const VARIANTS = 6;
  const geos = [];
  for (let i = 0; i < VARIANTS; i++) geos.push(makeBoulderGeometry(random));

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });

  const tints = [
    new THREE.Color("#9a9184"),
    new THREE.Color("#857d70"),
    new THREE.Color("#a89e8c"),
    new THREE.Color("#6f6a60"),
  ];

  const buckets = Array.from({ length: VARIANTS }, () => []);
  const up = new THREE.Vector3();

  let placed = 0;
  let guard = 0;
  while (placed < 80 && guard++ < 4000) {
    const x = (random() * 2 - 1) * (A.halfX + 30);
    const z = terrain.centerZ + (random() * 2 - 1) * (terrain.halfZ + 30);
    const ad = terrain.arenaDistance(x, z);
    if (ad > 20) continue; // já é parede de serra
    // Não obstrui a linha de tiro.
    if (Math.abs(x - pathCenterX(z)) < 7 && z > -112 && z < 30) continue;
    terrain.normalAt(x, z, 1.0, up);
    if (up.y < 0.68) continue; // encosta íngreme demais para uma pedra assentada

    buckets[Math.floor(random() * VARIANTS)].push({
      x,
      z,
      radius: 0.5 + random() * 2.1,
      rx: (random() - 0.5) * 0.4,
      ry: random() * Math.PI * 2,
      rz: (random() - 0.5) * 0.4,
      tint: tints[Math.floor(random() * tints.length)],
    });
    placed++;
  }

  const group = new THREE.Group();
  group.name = "boulders";
  const dummy = new THREE.Object3D();
  const v = new THREE.Vector3();

  for (let g = 0; g < VARIANTS; g++) {
    const list = buckets[g];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geos[g], material, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const verts = geos[g].attributes.position.array;

    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      /* ASSENTAMENTO (Fase 3.6 do plano).
       *
       * A altura saía de UM ponto — o centro da pedra. Numa encosta isso põe
       * metade do matacão no ar: o chão desce do lado de baixo e a pedra fica
       * pendurada, com uma fresta de céu por baixo. Não é sutil, é a primeira
       * coisa que se vê subindo o sopé.
       *
       * A correção é amostrar a PEGADA inteira e usar o ponto mais baixo dela.
       * Quatro amostras na borda mais o centro bastam: a célula do terreno tem
       * 0,7 m dentro da arena e a pedra tem entre 0,5 e 2,6 m de raio, então
       * cinco pontos já cobrem a variação que existe debaixo dela. */
      let base = terrain.heightAt(b.x, b.z);
      const r = b.radius * 0.85;
      for (const [dx, dz] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ]) {
        base = Math.min(base, terrain.heightAt(b.x + dx, b.z + dz));
      }
      // E ainda enterra um terço do raio: pedra assentada tem parte no chão.
      dummy.position.set(b.x, base - b.radius * 0.34, b.z);
      dummy.rotation.set(b.rx, b.ry, b.rz);
      dummy.scale.setScalar(b.radius);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, b.tint);

      const hull = new Float32Array(verts.length);
      for (let k = 0; k < verts.length; k += 3) {
        v.set(verts[k], verts[k + 1], verts[k + 2])
          .multiplyScalar(b.radius)
          .applyEuler(dummy.rotation);
        hull[k] = v.x;
        hull[k + 1] = v.y;
        hull[k + 2] = v.z;
      }
      const desc = RAPIER.ColliderDesc.convexHull(hull);
      if (!desc) continue;
      const body = physics.createBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(
          dummy.position.x,
          dummy.position.y,
          dummy.position.z,
        ),
      );
      const collider = physics.createCollider(
        desc.setFriction(0.9).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      physics.register(collider, { kind: "scenery", name: "rocha" });
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  scene.add(group);
  // A lista sai junto: é dela que o assado de AO tira as manchas de contato das
  // pedras (ver `bakeVegetationAO`).
  return { group, list: buckets.flat() };
}

/* ------------------------------------------------------------- árvores ----- */

const BROADLEAF_TRUNK = 2.7; // m
const CONIFER_TRUNK = 1.5; // m

/**
 * Gradiente vertical na copa, em cor de vértice (Fase 3.2 do plano).
 *
 * O topo pega sol e a base fica na sombra da própria copa. Sem isso a árvore é
 * uma bolha de UMA cor só, e é isso que a entrega como primitiva quando o
 * jogador chega perto — a três metros de distância uma copa chapada não tem
 * volume nenhum.
 *
 * A cor é CINZA (multiplicador), não colorida: a tinta vem do `setColorAt` da
 * instância, e as duas se multiplicam no shader. É o que permite ter quatro
 * variedades de verde e o mesmo gradiente em todas.
 */
function shadeCanopy(geo, baixo, alto) {
  const pos = geo.attributes.position;
  const cores = new Float32Array(pos.count * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const inv = 1 / Math.max(1e-4, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) * inv;
    // A curva não é linear: a base escurece rápido e o topo satura. É assim que
    // a luz cai dentro de uma copa de verdade — quase toda a sombra está no
    // terço de baixo.
    const f = baixo + (alto - baixo) * Math.pow(t, 0.62);
    cores[i * 3] = f;
    cores[i * 3 + 1] = f;
    cores[i * 3 + 2] = f;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cores, 3));
  return geo;
}

/**
 * Copa de folhosa: aglomerado de esferas facetadas, já na altura do tronco.
 *
 * `variante` muda a receita de bolhas (Fase 3.3). DUAS silhuetas para 430
 * árvores era pouco: o olho reconhece a repetição e o bosque vira papel de
 * parede. Com quatro receitas — larga, alta, torta e rala — mais o sorteio de
 * escala e de giro que já existia, a repetição some.
 */
function broadleafCanopyGeometry(random, variante = 0) {
  const receitas = [
    // larga e baixa: a copa "de campo", que cresceu sem competir por luz
    [
      [0, 0.5, 0, 1.5],
      [0.86, 0.08, 0.32, 1.02],
      [-0.8, 0.24, -0.4, 1.06],
      [0.18, 1.1, -0.54, 0.86],
      [-0.35, 0.86, 0.72, 0.84],
    ],
    // alta e estreita: cresceu no meio do bosque, esticada atrás de luz
    [
      [0, 0.9, 0, 1.16],
      [0.4, 0.2, 0.24, 0.92],
      [-0.42, 0.44, -0.22, 0.9],
      [0.1, 1.72, -0.16, 0.82],
      [-0.14, 2.3, 0.12, 0.58],
    ],
    // torta: o peso todo de um lado, como quem cresceu na borda da clareira
    [
      [0.28, 0.62, 0.1, 1.34],
      [1.02, 0.5, 0.14, 0.9],
      [-0.5, 0.22, -0.3, 0.86],
      [0.7, 1.36, -0.3, 0.8],
      [-0.1, 1.04, 0.6, 0.7],
    ],
    // rala: poucas bolhas e mais separadas — árvore velha, folhagem esparsa
    [
      [0, 0.66, 0, 1.2],
      [0.94, 0.44, -0.2, 0.74],
      [-0.86, 0.72, 0.3, 0.7],
      [0.1, 1.5, 0.35, 0.66],
    ],
  ];

  const parts = [];
  for (const [bx, by, bz, br] of receitas[variante % receitas.length]) {
    const g = new THREE.IcosahedronGeometry(br, 1);
    g.scale(1, 0.85, 1);
    g.rotateY(random() * 3.1);
    g.rotateX(random() * 3.1);
    g.translate(bx, BROADLEAF_TRUNK + by, bz);
    parts.push(g);
  }
  return shadeCanopy(mergeGeometries(parts), 0.52, 1.12);
}

/** Conífera: saias cônicas empilhadas — silhueta de abeto, em duas alturas. */
function coniferCanopyGeometry(variante = 0) {
  const receitas = [
    [
      [0.0, 3.6, 1.2],
      [1.7, 3.0, 0.92],
      [3.3, 2.3, 0.6],
    ],
    // a segunda é mais alta e mais afilada: abeto novo, ainda em ponta
    [
      [0.0, 3.0, 0.95],
      [1.5, 2.9, 0.78],
      [3.0, 2.6, 0.56],
      [4.4, 1.9, 0.34],
    ],
  ];
  const parts = [];
  for (const [y, hh, r] of receitas[variante % receitas.length]) {
    const g = new THREE.ConeGeometry(r, hh, 7, 1);
    g.translate(0, CONIFER_TRUNK + y + hh / 2 - 0.5, 0);
    parts.push(g);
  }
  return shadeCanopy(mergeGeometries(parts), 0.46, 1.14);
}

/**
 * Vento nas copas (Fase 3.1 do plano).
 *
 * É o mesmo enxerto de balanço da grama, com três diferenças:
 *
 * • A amplitude é ~10× maior (uns 15 cm no topo, contra 2 cm numa folha de
 *   grama), porque uma copa de quatro metros que se mexe dois centímetros
 *   parece congelada.
 * • A fase vem da POSIÇÃO DA INSTÂNCIA, não da UV. É o que faz o bosque ondular
 *   em vez de piscar em uníssono — a rajada atravessa o vale.
 * • Só o que está ACIMA do tronco se mexe, e proporcionalmente à altura. O pé
 *   da árvore está enterrado no chão; se ele oscilar junto, a árvore inteira
 *   escorrega de lado e o efeito lê como bug de física, não como vento.
 *
 * Custo: zero de CPU. É vertex shader, e a árvore já era instanciada.
 */
function applyCanopySway(material, sway, baseY, topY, amplitude) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.swayTime = sway.time;
    shader.uniforms.swayWind = sway.wind;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float swayTime;
         uniform vec2 swayWind;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         {
           float canopyT = clamp(
             (position.y - ${baseY.toFixed(2)}) / ${(topY - baseY).toFixed(2)},
             0.0, 1.0
           );
           vec3 iPos = instanceMatrix[3].xyz;
           float ph = iPos.x * 0.13 + iPos.z * 0.11;
           /* Duas senoides incomensuráveis: uma lenta, que é a rajada
              atravessando, e uma rápida de menor amplitude, que é a folha
              tremendo. Com uma só, o movimento tem período audível ao olho. */
           float s = sin(swayTime * 0.85 + ph)
                   + 0.42 * sin(swayTime * 2.3 + ph * 1.7);
           /* O expoente 1.6 concentra o movimento no alto da copa: a ponta
              chicoteia e a base quase não sai do lugar, que é como um galho se
              comporta. Linear, a copa inteira desliza em bloco. */
           vec2 d = swayWind * pow(canopyT, 1.6) * ${amplitude.toFixed(2)} * (0.6 + 0.4 * s);
           /* Como na grama: o deslocamento é de MUNDO e precisa ser projetado
              nos eixos da instância, senão o giro sorteado de cada árvore leva
              o vento junto e cada uma balança para um lado. */
           vec3 aX = instanceMatrix[0].xyz;
           float invS = 1.0 / max(length(aX), 1e-4);
           transformed.x += dot(vec3(d.x, 0.0, d.y), aX * invS) * invS;
           transformed.z += dot(vec3(d.x, 0.0, d.y), instanceMatrix[2].xyz * invS) * invS;
         }`,
      );
  };
  material.customProgramCacheKey = () => `canopy-sway-${baseY}-${topY}-${amplitude}`;
  return material;
}

function trunkGeometry(rTop, rBottom, height) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, 7, 1);
  g.translate(0, height / 2, 0);
  return g;
}

/**
 * Vegetação da arena.
 *
 * Dois cinturões, com orçamentos diferentes:
 *
 * • ANEL — folhosas na borda do piso e no sopé. São as que o jogador chega
 *   perto, então recebem sombra e colisor de tronco.
 * • ENCOSTA — coníferas subindo a serra até a linha das árvores. São dezenas de
 *   metros acima e atrás da barreira de caminhada, então não recebem nem
 *   sombra nem colisor: seriam custo puro.
 *
 * Tudo instanciado: 4 InstancedMesh cobrem ~400 árvores.
 */
function scatterTrees(scene, physics, terrain, random, sway) {
  const A = CONFIG.world.arena;
  const group = new THREE.Group();
  group.name = "trees";

  const barkMat = new THREE.MeshStandardMaterial({
    color: "#6b4a2c",
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  /* `vertexColors` liga o gradiente de `shadeCanopy`; a tinta de cada árvore
     continua vindo do `setColorAt` da instância e os dois se multiplicam no
     shader. O balanço entra por cima, no vértice. */
  const leafMat = applyCanopySway(
    new THREE.MeshStandardMaterial({
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
    }),
    sway,
    BROADLEAF_TRUNK,
    BROADLEAF_TRUNK + 2.5,
    2.6, // multiplicador sobre a amplitude do vento (que já vale ~0,06 m)
  );
  const needleMat = applyCanopySway(
    new THREE.MeshStandardMaterial({
      roughness: 0.94,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
    }),
    sway,
    CONIFER_TRUNK,
    CONIFER_TRUNK + 6.0,
    // A conífera é rígida: ela balança bem menos que a folhosa, e é justamente
    // a diferença entre as duas que faz o vento parecer vento e não uma
    // animação aplicada a tudo igual.
    1.3,
  );

  const leafTints = [
    new THREE.Color("#4f8236"),
    new THREE.Color("#669b40"),
    new THREE.Color("#3f6f2c"),
    new THREE.Color("#7ba64a"),
  ];
  const needleTints = [
    new THREE.Color("#2f5a35"),
    new THREE.Color("#27492c"),
    new THREE.Color("#3a6b3c"),
  ];

  const up = new THREE.Vector3();
  const ring = [];
  const slope = [];

  // --- anel: da borda do piso até a metade do sopé -----------------------
  let guard = 0;
  while (ring.length < 130 && guard++ < 6000) {
    const x = (random() * 2 - 1) * (A.halfX + 22);
    const z = terrain.centerZ + (random() * 2 - 1) * (terrain.halfZ + 22);
    const ad = terrain.arenaDistance(x, z);
    if (ad < -11 || ad > 15) continue;
    // A linha de tiro fica limpa da arqueira até bem além do último alvo.
    if (Math.abs(x - pathCenterX(z)) < 9 && z > -114 && z < 26) continue;
    terrain.normalAt(x, z, 1.2, up);
    if (up.y < 0.84) continue;
    const scale = 0.85 + random() * 0.75;
    // Garante um corredor físico entre os troncos. A folga considera os raios
    // visuais dos dois troncos mais a largura da cápsula do jogador.
    const overlaps = ring.some((tree) => {
      const required = 0.24 * (scale + tree.scale) + 0.9;
      return Math.hypot(x - tree.x, z - tree.z) < required;
    });
    if (overlaps) continue;
    ring.push({ x, z, scale });
  }

  // --- encosta: coníferas até a linha das árvores -------------------------
  guard = 0;
  while (slope.length < 300 && guard++ < 12000) {
    const x = (random() * 2 - 1) * (A.halfX + 90);
    const z = terrain.centerZ + (random() * 2 - 1) * (terrain.halfZ + 90);
    const ad = terrain.arenaDistance(x, z);
    if (ad < 6) continue;
    const h = terrain.heightAt(x, z);
    if (h > A.treeLine) continue;
    terrain.normalAt(x, z, 1.4, up);
    if (up.y < 0.62) continue; // não nasce pinheiro em falésia
    slope.push({ x, z, scale: 0.9 + random() * 1.1 });
  }

  /* Uma passada de instâncias POR VARIANTE de silhueta.
     São quatro chamadas de desenho a mais para as folhosas e uma para as
     coníferas — cinco no total, num orçamento que a Fase 0 acabou de liberar em
     centenas. Em troca, 430 árvores deixam de ser dois carimbos repetidos. */
  const BROADLEAF_VARIANTS = 4;
  const CONIFER_VARIANTS = 2;

  if (ring.length) {
    prepare(ring, terrain, 0.12);
    instance(group, ring, trunkGeometry(0.13, 0.24, BROADLEAF_TRUNK), barkMat, null, true);
    for (let v = 0; v < BROADLEAF_VARIANTS; v++) {
      const lote = ring.filter((t) => t.variant % BROADLEAF_VARIANTS === v);
      if (!lote.length) continue;
      instance(group, lote, broadleafCanopyGeometry(random, v), leafMat, leafTints, true);
    }
  }
  if (slope.length) {
    prepare(slope, terrain, 0.1);
    instance(group, slope, trunkGeometry(0.1, 0.18, CONIFER_TRUNK), barkMat, null, false);
    for (let v = 0; v < CONIFER_VARIANTS; v++) {
      const lote = slope.filter((t) => t.variant % CONIFER_VARIANTS === v);
      if (!lote.length) continue;
      instance(group, lote, coniferCanopyGeometry(v), needleMat, needleTints, false);
    }
  }

  /* Colisores só no anel — a encosta está atrás da barreira de caminhada. */
  for (const t of ring) {
    const h = BROADLEAF_TRUNK * t.scale;
    const body = physics.createBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(t.x, t.y + h / 2, t.z),
    );
    const collider = physics.createCollider(
      RAPIER.ColliderDesc.cylinder(h / 2, 0.24 * t.scale)
        .setFriction(0.8)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    physics.register(collider, { kind: "scenery", name: "árvore" });
  }

  scene.add(group);

  /* Os poleiros: o topo da copa de cada folhosa do anel.
     Os pássaros são do servidor, mas o servidor não tem árvore nenhuma — ele
     manda "pouse por aqui" com um (x, z) e cada cliente resolve para a copa
     mais próxima que ELE conhece. Como o cenário é determinístico (mesma seed,
     mesmo relevo), todos resolvem para a MESMA árvore, e o pássaro pousa no
     mesmo galho em todas as telas sem que um único metro de altura trafegue. */
  return {
    group,
    // As duas listas seguem para o assado de AO: as folhosas do anel dão a
    // mancha larga do bosque e as coníferas da encosta, o pontilhado da serra.
    ring,
    slope,
    /* A altura é o TOPO da copa, não o meio dela.
       A copa é um aglomerado de esferas cujo ponto mais alto fica a 2,01 m
       acima do tronco (a bolha `[0.16, 1.28, -0.5, 0.86]`, com 0,85 de achatamento
       em Y). Com os 1,75 m de antes, o pássaro pousava 26 cm DENTRO da
       folhagem: sumia da vista e não dava para acertar. Os 2,5 m o põem sobre a
       copa, com meio metro de folga — silhueta contra o céu, e alvo de verdade. */
    perches: ring.map((t) => ({
      x: t.x,
      z: t.z,
      y: t.y + t.scale * (BROADLEAF_TRUNK + 2.5),
    })),
  };
}

/**
 * Congela a transformação de cada árvore ANTES de instanciar.
 *
 * Tronco e copa são InstancedMesh diferentes, mas são a mesma árvore: se cada
 * passada sorteasse o próprio ângulo e a própria altura, a copa flutuaria ao
 * lado do tronco. Aqui a pose é decidida uma vez e as duas passadas a leem.
 */
function prepare(list, terrain, sink) {
  for (const t of list) {
    t.yaw = (Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % (Math.PI * 2);
    t.tintIndex = Math.abs(Math.floor(t.x * 3.7 + t.z * 1.9));
    /* Qual silhueta esta árvore usa. Sai da POSIÇÃO, como o giro e a tinta:
       assim o bosque é o mesmo em todas as telas sem que nada trafegue, e a
       árvore atrás da qual você se escondeu tem a mesma forma para o amigo. */
    t.variant = Math.abs(Math.floor(t.x * 7.31 + t.z * 4.17)) % 12;
    t.y = terrain.heightAt(t.x, t.z) - sink;
  }
}

/** Uma passada de instâncias. `tints` nulo = usa a cor do próprio material. */
function instance(group, list, geo, material, tints, shadow) {
  const dummy = new THREE.Object3D();
  const mesh = new THREE.InstancedMesh(geo, material, list.length);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotation.set(0, t.yaw, 0);
    dummy.scale.setScalar(t.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (tints) mesh.setColorAt(i, tints[t.tintIndex % tints.length]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
  return mesh;
}

/* -------------------------------------------------------------- cercas ----- */

/**
 * As cercas de madeira ao longo da trilha.
 *
 * Eram 46 malhas — 18 postes e 28 travessas —, cada uma uma chamada de desenho,
 * para 46 caixas do mesmo material que NUNCA SE MEXEM. Agora a geometria de
 * cada peça é gerada, transformada para o lugar dela e MESCLADA: uma malha só,
 * uma chamada, mesma imagem.
 *
 * O truque que torna isso possível é a transformação ser aplicada na
 * GEOMETRIA (`applyMatrix4`) em vez de no objeto. Uma malha mesclada não tem
 * como girar cada poste depois — mas também não precisa, porque o ângulo
 * torto de cada um é sorteado uma vez, no build, e vale para sempre.
 *
 * Os colisores continuam um por poste: eles são de física, não de render, e a
 * flecha precisa de um alvo com forma para cravar.
 */
function buildFences(scene, physics, terrain, random) {
  const wood = new THREE.MeshStandardMaterial({
    color: "#8a6039",
    // Madeira exposta ao tempo quase não reflete: `0.95` tira o brilho plástico
    // que a cerca tinha contra o sol da tarde (ver Fase 1.5, especular seletiva).
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });

  const sections = [
    { z: -6, side: 1, count: 4 },
    { z: -26, side: -1, count: 5 },
    { z: -55, side: 1, count: 5 },
    { z: -88, side: -1, count: 4 },
  ];

  const partes = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const meio = new THREE.Vector3();
  const um = new THREE.Vector3(1, 1, 1);
  const dummy = new THREE.Object3D();

  for (const s of sections) {
    const spacing = 2.0;
    const offset = 6.5 + random() * 2.5;
    for (let i = 0; i < s.count; i++) {
      const z = s.z - i * spacing;
      const x = pathCenterX(z) + s.side * offset;
      const y = terrain.heightAt(x, z);

      const poste = new THREE.BoxGeometry(0.12, 1.15, 0.12);
      e.set((random() - 0.5) * 0.08, (random() - 0.5) * 0.3, (random() - 0.5) * 0.08, "YXZ");
      q.setFromEuler(e);
      poste.applyMatrix4(m.compose(a.set(x, y + 0.5, z), q, um));
      partes.push(poste);

      if (physics) {
        const body = physics.createBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + 0.575, z),
        );
        const pc = physics.createCollider(
          RAPIER.ColliderDesc.cuboid(0.06, 0.575, 0.06),
          body,
        );
        physics.register(pc, { kind: "scenery", name: "cerca" });
      }

      if (i < s.count - 1) {
        const z2 = z - spacing;
        const x2 = pathCenterX(z2) + s.side * offset;
        const y2 = terrain.heightAt(x2, z2);
        for (const railY of [0.85, 0.45]) {
          a.set(x, y + railY, z);
          b.set(x2, y2 + railY, z2);
          const len = a.distanceTo(b);
          // `lookAt` num Object3D descartável: é a mesma orientação de antes
          // (a travessa aponta do poste A para o B), só que agora ela vira
          // matriz e some dentro da geometria.
          dummy.position.copy(meio.copy(a).lerp(b, 0.5));
          dummy.quaternion.identity();
          dummy.lookAt(b);
          dummy.updateMatrix();
          const trave = new THREE.BoxGeometry(0.07, 0.07, len);
          trave.applyMatrix4(dummy.matrix);
          partes.push(trave);
        }
      }
    }
  }

  const cerca = new THREE.Mesh(mergeGeometries(partes), wood);
  cerca.name = "fences";
  cerca.castShadow = true;
  cerca.receiveShadow = true;
  for (const p of partes) p.dispose();
  scene.add(cerca);
  return cerca;
}

/* --------------------------------------------------------------- grama ----- */

function grassTexture() {
  const w = 64;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const blades = [
    [32, 0.0, "#79a844"],
    [22, -0.35, "#6b9a3c"],
    [42, 0.35, "#8bb954"],
    [14, -0.6, "#5f8c35"],
    [50, 0.6, "#7fae4a"],
  ];
  for (const [bx, lean, color] of blades) {
    ctx.beginPath();
    ctx.moveTo(bx - 3.2, h);
    ctx.quadraticCurveTo(bx + lean * 14, h * 0.45, bx + lean * 26, h * 0.06);
    ctx.quadraticCurveTo(bx + lean * 14 + 3.5, h * 0.5, bx + 3.2, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const GRASS_HEIGHT = 0.42; // m — altura da placa, usada pelo shader de balanço

/** Flor: um caule fino com uma corola de quatro pétalas no topo. */
function flowerTexture() {
  const w = 64;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  // Caule.
  ctx.strokeStyle = "#5f8c35";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(32, h);
  ctx.quadraticCurveTo(30, h * 0.5, 32, h * 0.26);
  ctx.stroke();

  // Corola: quatro pétalas em branco puro. A COR vem da instância, então uma
  // textura branca serve para todas as espécies do campo.
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(32 + Math.cos(a) * 7, 20 + Math.sin(a) * 7, 5.5, 4.2, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#f5d76a";
  ctx.beginPath();
  ctx.arc(32, 20, 3.4, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Some com a distância, no VÉRTICE (Fase 3.4 do plano).
 *
 * O tufo encolhe até zero acima de `GRASS_FADE` metros em vez de ficar
 * transparente. Encolher é melhor que apagar por três motivos:
 *
 * • `alphaTest` não tem meio-termo — ou o pixel existe ou não —, então um fade
 *   de opacidade daria um recorte piscando em vez de um sumiço;
 * • um triângulo de área zero é descartado pela GPU antes da rasterização, o
 *   que economiza fragmento de verdade;
 * • a transição é contínua e ninguém vê a borda do raio.
 *
 * O que se ganha é o essencial: os 4 200 tufos existem só nos 22 m em volta do
 * jogador, que é onde a grama se vê. Além disso eles eram fragmento pago para
 * pintar dois pixels de verde sobre um chão que já é verde.
 */
const GRASS_FADE = 22; // m — daqui para fora o tufo encolhe
const GRASS_FADE_END = 30; // m — e some de vez

function applyGroundCoverShader(material, sway, alturaRef, amplitude) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.swayTime = sway.time;
    shader.uniforms.swayWind = sway.wind;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float swayTime;
         uniform vec2 swayWind;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float bladeT = clamp(position.y / ${alturaRef.toFixed(2)}, 0.0, 1.0);
         vec3 iPos = instanceMatrix[3].xyz;
         float phase = iPos.x * 0.7 + iPos.z * 0.55;
         float s = sin(swayTime * 1.9 + phase) + 0.45 * sin(swayTime * 3.7 + phase * 1.7);
         vec3 dWorld = vec3(swayWind.x, 0.0, swayWind.y)
                     * bladeT * bladeT * (0.55 + 0.45 * s) * ${amplitude.toFixed(2)};
         /* Cada tufo tem um yaw aleatório. Deslocar o vértice direto faria a
            matriz da instância girar o deslocamento junto, e o campo balançaria
            em todas as direções. Projetando nos eixos da instância (e dividindo
            pela escala) o vento sai igual para todo mundo, como vento é. */
         vec3 aX = instanceMatrix[0].xyz;
         float invS = 1.0 / max(length(aX), 1e-4);
         transformed.x += dot(dWorld, aX * invS) * invS;
         transformed.z += dot(dWorld, instanceMatrix[2].xyz * invS) * invS;

         /* Encolhimento por distância. cameraPosition é uniforme embutido do
            Three, então isto não custa nem um uniforme novo nem uma passada de
            CPU por tufo. */
         {
           vec3 wp = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
           float d = distance(wp.xz, cameraPosition.xz);
           float k = 1.0 - smoothstep(${GRASS_FADE.toFixed(1)}, ${GRASS_FADE_END.toFixed(1)}, d);
           transformed.xyz *= k;
         }`,
      );
  };
  material.customProgramCacheKey = () => `ground-cover-${alturaRef}-${amplitude}`;
  return material;
}

function scatterGrass(scene, terrain, random, sway) {
  const A = CONFIG.world.arena;
  const material = new THREE.MeshStandardMaterial({
    map: grassTexture(),
    transparent: false,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
    color: 0xffffff,
    // Cada tufo herda a cor do terreno debaixo dele — ver o laço de sorteio.
    vertexColors: false,
  });

  // Balanço + encolhimento por distância, os dois no vértice.
  applyGroundCoverShader(material, sway, GRASS_HEIGHT, 1.0);

  // Tufo = duas placas cruzadas.
  const plane = new THREE.PlaneGeometry(0.5, GRASS_HEIGHT);
  plane.translate(0, GRASS_HEIGHT / 2, 0);
  const plane2 = plane.clone();
  plane2.rotateY(Math.PI / 2);
  const merged = mergeGeometries([plane, plane2]);

  /* A FLOR é uma camada separada, com a própria textura, o próprio material e a
     própria contagem — uma chamada de desenho a mais, e uma só. Tingir tufos de
     grama de vermelho não daria flor nenhuma: a textura são lâminas, e uma
     lâmina rosa lê como grama doente. */
  const flowerMat = applyGroundCoverShader(
    new THREE.MeshStandardMaterial({
      map: flowerTexture(),
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0,
      vertexColors: false,
    }),
    sway,
    GRASS_HEIGHT,
    // A flor balança mais que a grama: ela é mais alta e o caule é fino.
    1.5,
  );
  const flowerTints = [
    new THREE.Color("#f2f0e4"), // margarida
    new THREE.Color("#e8d45c"), // botão-de-ouro
    new THREE.Color("#c98fd8"), // cardo
    new THREE.Color("#e2705f"), // papoula
    new THREE.Color("#9fc4e8"), // cicória
  ];

  const COUNT = CONFIG.render.grassCount;
  // Uma flor a cada vinte tufos, como o plano pede. Menos que isso o campo fica
  // pontilhado como uma toalha estampada.
  const FLOWERS = Math.round(COUNT / 20);

  const mesh = new THREE.InstancedMesh(merged, material, COUNT);
  mesh.name = "grass";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const flores = new THREE.InstancedMesh(merged, flowerMat, FLOWERS);
  flores.name = "flowers";
  flores.castShadow = false;
  flores.receiveShadow = false;
  flores.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3();
  const tintaChao = new THREE.Color();
  let placed = 0;
  let comFlor = 0;
  let guard = 0;
  while (placed < COUNT && guard++ < COUNT * 14) {
    // Densidade decrescente a partir da trilha: perto do jogador é onde o
    // detalhe se vê, e cada tufo distante é um quad que ninguém olha.
    const z = terrain.centerZ + (random() * 2 - 1) * (terrain.halfZ + 6);
    const side = random() < 0.5 ? -1 : 1;
    const x = pathCenterX(z) + side * (2.6 + Math.pow(random(), 0.65) * (A.halfX + 8));
    if (terrain.arenaDistance(x, z) > 8) continue;
    terrain.normalAt(x, z, 1.0, up);
    if (up.y < 0.8) continue;
    const y = terrain.heightAt(x, z);
    dummy.position.set(x, y - 0.03, z);
    dummy.rotation.set(0, random() * Math.PI, 0);
    const s = 0.7 + random() * 0.9;
    dummy.scale.set(s, s * (0.8 + random() * 0.6), s);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);

    /* TINGIDO PELO CHÃO DEBAIXO DELE.
       `surfaceColor` é a mesma função que pinta o vértice do terreno, então o
       tufo nasce exatamente da cor sobre a qual está: verde no gramado,
       amarelado na mancha seca, quase terra na beira da trilha. Antes todos os
       tufos eram do mesmo verde da textura, e o campo tinha um tapete de uma cor
       só por cima de um chão de muitas — dava para ver a emenda de longe. */
    terrain.normalAt(x, z, 1.0, up);
    terrain.surfaceColor(x, z, y, up, tintaChao);
    // Clareia um pouco: a folha viva é mais clara que o chão que ela cobre.
    mesh.setColorAt(placed, tintaChao.multiplyScalar(1.35));
    placed++;

    // Uma em cada vinte vira flor, no mesmo ponto — a flor nasce NO tufo.
    if (comFlor < FLOWERS && placed % 20 === 0) {
      dummy.scale.multiplyScalar(1.15);
      dummy.updateMatrix();
      flores.setMatrixAt(comFlor, dummy.matrix);
      flores.setColorAt(comFlor, flowerTints[Math.floor(random() * flowerTints.length)]);
      comFlor++;
    }
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  flores.count = comFlor;
  flores.instanceMatrix.needsUpdate = true;
  if (flores.instanceColor) flores.instanceColor.needsUpdate = true;
  scene.add(flores);
  return mesh;
}

/* ------------------------------------------------- AO e sombra assadas ----

   O melhor item do plano inteiro por custo/benefício, e ele não desenha nada:
   escurece as CORES DE VÉRTICE do terreno onde há vegetação por cima.

   Três problemas de uma vez:

   1. "Tudo flutua." Uma árvore sem escurecimento no pé parece colada por cima
      do chão. A mancha de contato é o que assenta o objeto no mundo — e é a
      coisa que o olho procura primeiro para julgar se algo está apoiado.

   2. A sombra dinâmica ACABA EM 46 m (`CONFIG.render.shadowRange`). Além disso o
      bosque inteiro fica sem sombra nenhuma, e a encosta vira um tapete verde
      chapado com adesivos de árvore. Esta não acaba nunca: ela é cor.

   3. Custo de runtime ZERO. É um atributo que já existia e já era enviado à
      GPU; o que muda são os números dentro dele.

   POR QUE NÃO SÃO RAIOS. O plano pedia oito raios por vértice contra a
   geometria. São 43 mil vértices — 344 mil raycasts contra `InstancedMesh`,
   dezenas de segundos, e o resultado seria o mesmo: a copa é uma bolha e a
   oclusão dela é analítica. Com as LISTAS de árvores e rochas em mãos, cada
   vértice consulta só os vizinhos de uma grade e a conta fecha em milissegundos.

   São DUAS camadas, somadas, e é a diferença entre elas que dá a leitura:

   • OCLUSÃO — simétrica, centrada na copa. É "aqui chega menos céu".
   • SOMBRA — o mesmo disco DESLOCADO na direção oposta ao sol, projetado no
     chão. É "aqui o sol não bate". Sem ela a mancha fica igual dos quatro
     lados e lê como sujeira; com ela, o bosque ganha hora do dia. */

/** Grade uniforme para achar os oclusores perto de um ponto sem varrer todos. */
class OccluderGrid {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }

  key(ix, iz) {
    return ix * 73856093 ^ (iz * 19349663);
  }

  add(o) {
    // O oclusor entra em TODAS as células que o raio dele alcança: assim a
    // consulta olha uma célula só e mesmo assim não perde uma copa larga cujo
    // centro caiu na célula vizinha.
    const r = o.reach;
    const i0 = Math.floor((o.x - r) / this.cell);
    const i1 = Math.floor((o.x + r) / this.cell);
    const j0 = Math.floor((o.z - r) / this.cell);
    const j1 = Math.floor((o.z + r) / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let lista = this.map.get(k);
        if (!lista) this.map.set(k, (lista = []));
        lista.push(o);
      }
    }
  }

  at(x, z) {
    return this.map.get(
      this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)),
    );
  }
}

/**
 * Escurece as cores de vértice do terreno sob a vegetação.
 *
 * @param {Terrain} terrain o terreno já construído (com a malha e as cores)
 * @param {Array<{x,z,y,radius,height}>} oclusores copas e matacões
 */
function bakeVegetationAO(terrain, oclusores) {
  if (!oclusores.length) return;

  const geo = terrain.mesh.geometry;
  const pos = geo.attributes.position.array;
  const cor = geo.attributes.color.array;

  /* Deslocamento da sombra no plano: para onde a projeção da copa cai.
     A luz viaja de `SUN_DIR` para o chão, então a sombra vai para −XZ do sol,
     e o quanto ela se estica é `altura / tan(elevação)` — daí a divisão por
     `SUN_DIR.y`. Fica limitada porque com o sol baixo a projeção esticaria
     dezenas de metros e a mancha deixaria de parecer uma árvore. */
  const espalha = Math.min(1.6, 1 / Math.max(0.25, SUN_DIR.y));
  const sombraX = -SUN_DIR.x * espalha;
  const sombraZ = -SUN_DIR.z * espalha;

  const grade = new OccluderGrid(12);
  for (const o of oclusores) {
    // Alcance horizontal: a copa mais a projeção da sombra dela.
    o.reach = o.radius * 1.7 + o.height * Math.abs(espalha) * 0.6;
    grade.add(o);
  }

  const n = pos.length / 3;
  for (let v = 0; v < n; v++) {
    const i3 = v * 3;
    const x = pos[i3];
    const y = pos[i3 + 1];
    const z = pos[i3 + 2];
    const perto = grade.at(x, z);
    if (!perto) continue;

    let oclusao = 0;
    let sombra = 0;
    for (let k = 0; k < perto.length; k++) {
      const o = perto[k];

      /* Só ocluir o que está ABAIXO da copa. Sem isto, uma árvore no sopé
         escureceria o terreno da encosta atrás dela, que está vinte metros
         acima — e apareceria uma mancha escura pendurada na montanha. */
      const alturaCopa = o.y + o.height;
      if (y > alturaCopa) continue;

      const dx = x - o.x;
      const dz = z - o.z;
      const d2 = dx * dx + dz * dz;

      // Oclusão: disco macio centrado na copa.
      const rO = o.radius * 1.45;
      if (d2 < rO * rO) {
        const t = 1 - Math.sqrt(d2) / rO;
        oclusao += t * t * o.strength;
      }

      // Sombra: o MESMO disco, deslocado. Um pouco menor e mais dura, porque
      // sombra tem borda e oclusão não.
      const sx = dx - o.height * sombraX;
      const sz = dz - o.height * sombraZ;
      const rS = o.radius * 1.15;
      const ds2 = sx * sx + sz * sz;
      if (ds2 < rS * rS) {
        const t = 1 - Math.sqrt(ds2) / rS;
        sombra += t * 1.35 * o.strength;
      }
    }

    if (oclusao === 0 && sombra === 0) continue;

    /* As duas se somam mas SATURAM. Sem o teto, um bosque fechado (cinco copas
       sobrepostas) levaria o chão a preto absoluto, e o pé do bosque viraria um
       buraco — exatamente o defeito que a Fase 1.4 tirou da luz ambiente. */
    const escuro = Math.min(0.72, oclusao * 0.42 + Math.min(0.55, sombra) * 0.5);
    const f = 1 - escuro;
    /* A sombra ESFRIA além de escurecer: o que sobra debaixo de uma copa é luz
       do céu, que é azul. Escurecer só o brilho dá cinza morto; tirar mais do
       vermelho que do azul dá sombra. */
    cor[i3] *= f * 0.96;
    cor[i3 + 1] *= f * 0.99;
    cor[i3 + 2] *= Math.min(1, f * 1.06);
  }

  geo.attributes.color.needsUpdate = true;
}

/* ---------------------------------------------------------- bandeirolas ---- */

class WindFlag {
  constructor(terrain, x, z) {
    this.group = new THREE.Group();
    const y = terrain.heightAt(x, z);

    const poleMat = new THREE.MeshStandardMaterial({
      color: "#e8e2d4",
      roughness: 0.6,
      metalness: 0.15,
    });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.2, 8), poleMat);
    pole.position.y = 1.6;
    pole.castShadow = true;
    this.group.add(pole);

    // Fita: um plano estreito que gira com o vento e ondula.
    const geo = new THREE.PlaneGeometry(1.1, 0.28, 12, 1);
    geo.translate(0.55, 0, 0);
    this.material = new THREE.MeshStandardMaterial({
      color: "#e2483c",
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    this.cloth = new THREE.Mesh(geo, this.material);
    this.cloth.position.y = 3.0;
    this.cloth.castShadow = true;
    this.group.add(this.cloth);

    this.basePositions = geo.attributes.position.array.slice();
    this.group.position.set(x, y, z);
    this.time = 0;
  }

  update(dt, wind) {
    this.time += dt;
    const speed = Math.hypot(wind.x, wind.z);

    /* A fita aponta para onde o vento SOPRA — o mesmo rumo da seta do HUD.
       O sinal aqui não é decorativo. A malha da fita nasce ao longo do +X local
       (o `geo.translate(0.55, …)` lá em cima), e um grupo girado de θ em torno
       do Y leva o +X local para (cos θ, 0, −sen θ) no mundo. Com `+ π/2` isso dá
       exatamente −(vento): a bandeira apontava para a origem da rajada enquanto
       a seta do HUD apontava para o destino, e quem confiasse na bandeira
       corrigia a mira para o lado errado. Com `− π/2` os dois batem. */
    this.cloth.rotation.y = Math.atan2(wind.x, wind.z) - Math.PI / 2;
    // ... e cai quando não há vento.
    this.cloth.rotation.z = -Math.PI / 2.2 + smoothstep(0, 9, speed) * (Math.PI / 2.2);

    const pos = this.cloth.geometry.attributes.position;
    const base = this.basePositions;
    const amp = 0.06 + 0.1 * smoothstep(0, 10, speed);
    const freq = 3.0 + speed * 0.8;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      pos.setXYZ(i, bx, by, Math.sin(bx * 5.5 - this.time * freq) * amp * (bx / 1.1));
    }
    pos.needsUpdate = true;
  }
}

/* ---------------------------------------------------------------- API ------ */

export function createEnvironment(scene, physics) {
  const random = makeRandom(90210);

  /* Tudo o que este módulo cria pendura AQUI, e não direto na cena.
     É o que torna a demolição uma operação só: uma raiz para remover e uma
     subárvore para varrer. Sem ela, desmontar o vale seria uma lista de seis
     grupos que alguém teria de manter em sincronia com o construtor — e é
     dessa lista que sempre escapa a peça nova.

     Quem destrói NÃO é este módulo: é a fase dona dele (`levels/valleyLevel.js`).
     Dois donos para a mesma memória é exatamente a ambiguidade que o sistema de
     fases existe para eliminar — ver `levels/resources.js`. */
  const root = new THREE.Group();
  root.name = "environment";
  scene.add(root);
  const alvo = root; // os construtores abaixo recebem a raiz no lugar da cena

  const terrain = new Terrain().build(alvo, physics);

  // Uniformes compartilhados com o shader de balanço da grama.
  const sway = {
    time: { value: 0 },
    wind: { value: new THREE.Vector2() },
  };

  const rochas = scatterBoulders(alvo, physics, terrain, random);
  const arvores = scatterTrees(alvo, physics, terrain, random, sway);
  buildFences(alvo, physics, terrain, random);
  scatterGrass(alvo, terrain, random, sway);

  /* O assado tem de vir DEPOIS da vegetação: ele lê onde cada copa e cada
     pedra ficaram. É a única coisa neste arquivo que depende da ordem, e é
     por isso que está aqui embaixo e não dentro de `Terrain.build`.

     `radius` e `height` descrevem a BOLHA que ocupa o lugar da copa, não a
     malha: a folhosa é um aglomerado de esferas com ~1,6 m de raio a ~3,5 m do
     chão; a conífera é um cone estreito e alto; o matacão é uma bola no chão.
     A oclusão de uma bolha é analítica, e é por isso que isto custa
     milissegundos em vez dos segundos que os raios custariam. */
  if (CONFIG.render.terrainAO) {
    const oclusores = [];
    for (const t of arvores.ring) {
      oclusores.push({
        x: t.x,
        z: t.z,
        y: t.y,
        radius: 1.75 * t.scale,
        height: (BROADLEAF_TRUNK + 0.9) * t.scale,
        strength: 1,
      });
    }
    for (const t of arvores.slope) {
      oclusores.push({
        x: t.x,
        z: t.z,
        y: t.y,
        radius: 1.1 * t.scale,
        height: (CONIFER_TRUNK + 2.2) * t.scale,
        // A conífera é rala e a encosta é longe: meia força evita que a serra
        // inteira vire um borrão escuro visto do fundo do vale.
        strength: 0.75,
      });
    }
    for (const b of rochas.list) {
      oclusores.push({
        x: b.x,
        z: b.z,
        y: terrain.heightAt(b.x, b.z),
        radius: b.radius * 0.95,
        height: b.radius * 0.8,
        strength: 0.85,
      });
    }
    bakeVegetationAO(terrain, oclusores);
  }

  const flags = [
    new WindFlag(terrain, pathCenterX(-24) + 5.2, -24),
    new WindFlag(terrain, pathCenterX(-58) - 5.6, -58),
    new WindFlag(terrain, pathCenterX(-92) + 6.0, -92),
  ];
  for (const f of flags) alvo.add(f.group);

  return {
    terrain,
    flags,
    root,
    /** Topos de copa onde um pássaro pode pousar (ver `scatterTrees`). */
    perches: arvores.perches,

    /**
     * A copa mais próxima de um ponto do chão.
     *
     * Devolve null quando não há árvore por perto: o chamador então deixa o
     * pássaro no ar em vez de fazê-lo pousar no vazio.
     */
    nearestPerch(x, z, maxDist = 26) {
      let melhor = null;
      let melhorD = maxDist * maxDist;
      for (const p of arvores.perches) {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d >= melhorD) continue;
        melhorD = d;
        melhor = p;
      }
      return melhor;
    },

    update(dt, wind) {
      for (const f of flags) f.update(dt, wind);
      sway.time.value += dt;
      // O deslocamento satura: rajada forte deita a grama, não a arranca.
      const speed = Math.hypot(wind.x, wind.z) || 1e-6;
      const amp = 0.055 + 0.11 * smoothstep(0, 12, speed);
      sway.wind.value.set((wind.x / speed) * amp, (wind.z / speed) * amp);
    },

  };
}
