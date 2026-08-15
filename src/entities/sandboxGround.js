/* ---------------------------------------------------------------------------
   Sandbox: o terreno visível.

   Mesmo contrato de `entities/environment.js`/`moonGround.js` — a malha e o
   colisor trimesh saem dos MESMOS arrays —, com duas coisas que nenhum dos
   dois precisa:

   1. Pedra e mato são InstancedMesh deste arquivo. O molde é
      `scatterBoulders`/`scatterGrass` de `environment.js`, mas os dois são
      privados daquele módulo (não exportados) — copiados aqui, adaptados à
      arena circular pequena do Sandbox.

   2. `rebuildCollider()` — o terreno pode mudar DEPOIS de construído, quando
      uma flecha abre cratera (ver o listener em `main.js`). A malha é pequena
      de propósito (~24 k triângulos) para que recriar o trimesh INTEIRO a
      cada cratera seja barato; não precisa do caminho "só os vértices
      tocados" que o Namekusei usa na malha grande dele.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { SandboxField } from "../shared/sandboxField.js";
import { smoothstep, clamp, makeRandom } from "../utils/math.js";

const PALETTE = {
  grass: new THREE.Color("#5d8a3a"),
  grassDry: new THREE.Color("#95a552"),
  rockLight: new THREE.Color("#84876d"),
  rockDark: new THREE.Color("#464b3c"),
  scree: new THREE.Color("#9c9280"),
  snow: new THREE.Color("#e8eef5"),
};

const GRASS_HEIGHT = 0.42; // m
const _c1 = new THREE.Color();

/* --------------------------------------------------- detalhe do terreno ---- */

/**
 * Textura de detalhe procedural, PRÓPRIA do Sandbox — não é a `detailTexture`
 * de `environment.js`. Aquela é recurso de módulo compartilhado com o vale e
 * a Lua; copiá-la (em vez de importar) evita que ajustar o Sandbox mude o
 * visual das fases de verdade. Mesma técnica: seis oitavas de ruído de valor,
 * Sobel sobre o campo de altura vira normal tangente (RGB), variação de
 * albedo vai na alfa.
 */
function sandboxDetailTexture(seed = 88031) {
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

let sandboxDetail = null; // recurso de módulo — sobrevive a qualquer reconstrução do Sandbox

/**
 * Detalhe triplanar ANTI-REPETIÇÃO.
 *
 * Numa arena de 46 m de raio, o ladrilho de ~2,4 m do detalhe original se
 * repete quase 20 vezes na travessia — dá pra ver o padrão de longe, e é
 * exatamente essa a queixa. A correção mistura DUAS leituras da MESMA textura,
 * em escala e rotação diferentes (a segunda gira ~137,5°, o ângulo áureo, que
 * evita qualquer alinhamento periódico simples entre as duas grades). O
 * padrão combinado só volta a coincidir consigo mesmo numa distância muito
 * maior que a arena inteira — o olho nunca pega a repetição. Custa uma
 * segunda leitura de textura por amostra; para uma cena deste tamanho isso
 * não é nada.
 */
function applySandboxDetail(material) {
  if (!sandboxDetail) sandboxDetail = sandboxDetailTexture();
  const uniforms = {
    detailMap: { value: sandboxDetail },
    detailScale: { value: 0.42 }, // ladrilho fino ~2,4 m
    detailScale2: { value: 0.42 * 0.53 }, // segunda grade, fora de fase com a primeira
    macroScale: { value: 0.014 }, // manchas de ~70 m — menos de uma repetição na arena toda
    detailBump: { value: 0.45 },
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
         uniform float detailScale2;
         uniform float macroScale;
         uniform float detailBump;
         varying vec3 vWorldPos;
         varying vec3 vWorldNrm;

         vec2 rotUV(vec2 uv, float a) {
           float s = sin(a), c = cos(a);
           return mat2(c, -s, s, c) * uv;
         }

         vec4 triplanarOne(sampler2D m, vec3 p, vec3 w, float s, float ang) {
           return texture2D(m, rotUV(p.zy, ang) * s) * w.x
                + texture2D(m, rotUV(p.xz, ang) * s) * w.y
                + texture2D(m, rotUV(p.xy, ang) * s) * w.z;
         }

         vec4 triplanarAT(sampler2D m, vec3 p, vec3 w, float s1, float s2) {
           vec4 a = triplanarOne(m, p, w, s1, 0.0);
           vec4 b = triplanarOne(m, p, w, s2, 2.399);
           return mix(a, b, 0.5);
         }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         vec3 triW = pow(abs(vWorldNrm), vec3(4.0));
         triW /= (triW.x + triW.y + triW.z + 1e-5);
         vec4 detail = triplanarAT(detailMap, vWorldPos, triW, detailScale, detailScale2);
         float macro = texture2D(detailMap, rotUV(vWorldPos.xz, 0.7) * macroScale).a;
         diffuseColor.rgb *= (0.62 + 0.76 * detail.a) * (0.82 + 0.36 * macro);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec3 gn = normalize(vWorldNrm);
           vec3 tX = normalize(cross(abs(gn.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0), gn));
           vec3 tY = cross(gn, tX);
           vec2 dn = detail.rg * 2.0 - 1.0;
           vec3 wn = normalize(gn + (tX * dn.x + tY * dn.y) * detailBump);
           normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
         }`,
      );
  };
  material.customProgramCacheKey = () => "sandbox-terrain-triplanar-detail-at";
}

export class SandboxTerrain extends SandboxField {
  /**
   * @param {THREE.Object3D} parent raiz da fase (nunca a cena direto)
   * @param {object} physics
   * @param {{time: {value:number}, wind: {value:THREE.Vector2}}} sway uniformes de balanço — dono é a fase
   */
  build(parent, physics, sway) {
    this.buildGround(parent, physics);
    this.rockGroup = scatterRocks(parent, physics, this, makeRandom(771));
    const grass = scatterGrass(parent, this, makeRandom(772), sway);
    this.grassMesh = grass.mesh;
    this.grassInstances = grass.instances;
    return this;
  }

  buildGround(parent, physics) {
    const W = this.M.world;
    const seg = W.segments;
    const n = seg + 1;
    const half = W.half;

    // Grade UNIFORME e quadrada (mesmos valores em x e z): a área é pequena
    // o bastante para não precisar do `focusWarp` (adensar o centro) que o
    // vale e a Lua usam nas malhas grandes deles.
    const xs = new Float32Array(n);
    for (let i = 0; i < n; i++) xs[i] = -half + (2 * half * i) / seg;

    const indices = new Uint32Array(seg * seg * 6);
    let k = 0;
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }

    this._n = n;
    this._xs = xs;
    this._positions = new Float32Array(n * n * 3);
    this._colors = new Float32Array(n * n * 3);
    this._normals = new Float32Array(n * n * 3);
    this._indices = indices;

    this.fillHeightsAndColors();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this._positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(this._normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this._colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
    });
    applySandboxDetail(material);

    this.geometry = geometry;
    this.material = material;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = "sandbox-ground";
    parent.add(this.mesh);

    this.createCollider(physics);
  }

  /** Preenche posição/normal/cor por inteiro, a partir de `heightAt`/`surfaceColor`. */
  fillHeightsAndColors() {
    const n = this._n;
    const xs = this._xs;
    const positions = this._positions;
    const colors = this._colors;
    const normals = this._normals;

    for (let j = 0; j < n; j++) {
      const z = xs[j];
      for (let i = 0; i < n; i++) {
        const idx = (j * n + i) * 3;
        positions[idx] = xs[i];
        positions[idx + 1] = this.heightAt(xs[i], z);
        positions[idx + 2] = z;
      }
    }

    const nrm = new THREE.Vector3();
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) {
      const z = xs[j];
      const jm = Math.max(0, j - 1);
      const jp = Math.min(n - 1, j + 1);
      const dz = xs[jp] - xs[jm];
      for (let i = 0; i < n; i++) {
        const im = Math.max(0, i - 1);
        const ip = Math.min(n - 1, i + 1);
        const dx = xs[ip] - xs[im];
        const hL = positions[(j * n + im) * 3 + 1];
        const hR = positions[(j * n + ip) * 3 + 1];
        const hB = positions[(jm * n + i) * 3 + 1];
        const hF = positions[(jp * n + i) * 3 + 1];

        nrm.set(-(hR - hL) / dx, 1, -(hF - hB) / dz).normalize();

        const idx = (j * n + i) * 3;
        normals[idx] = nrm.x;
        normals[idx + 1] = nrm.y;
        normals[idx + 2] = nrm.z;

        this.surfaceColor(xs[i], z, positions[idx + 1], nrm, c);
        colors[idx] = c.r;
        colors[idx + 1] = c.g;
        colors[idx + 2] = c.b;
      }
    }
  }

  createCollider(physics) {
    const body = physics.createBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(this._positions, this._indices)
      .setFriction(0.95)
      .setRestitution(0.0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = physics.createCollider(desc, body);
    physics.register(collider, { kind: "terrain", name: "sandbox" });
    this.body = body;
    this.collider = collider;
  }

  /**
   * Reesculpe o grid inteiro e recria o colisor.
   *
   * `physics.removeBody` já cuida de desregistrar o collider velho e tirar só
   * este corpo do mundo — o corpo do terreno nunca teve mais nada anexado a
   * ele, então nada além dele é afetado (ver `core/physics.js`).
   */
  rebuildCollider(physics) {
    this.fillHeightsAndColors();
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeBoundingSphere();

    physics.removeBody(this.body);
    this.createCollider(physics);
  }

  /**
   * Mata a vegetação dentro do raio da cratera nova.
   *
   * `rebuildCollider` só mexe no CHÃO — os tufos de grama são um
   * `InstancedMesh` à parte, com a posição de cada um fixada uma vez na
   * construção. Sem isto, quem estava em cima do buraco novo fica flutuando
   * sobre ele. "Morrer" aqui é sair da lista de instâncias ativas — não
   * existe caminho de volta, do mesmo jeito que não nasce capim de novo no
   * fundo de uma cratera de verdade.
   */
  cullVegetation(crater) {
    if (!crater || !this.grassMesh || !this.grassInstances?.length) return;
    const r2 = crater.raio * crater.raio;
    const kept = this.grassInstances.filter((g) => {
      const dx = g.x - crater.x;
      const dz = g.z - crater.z;
      return dx * dx + dz * dz > r2;
    });
    if (kept.length === this.grassInstances.length) return;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < kept.length; i++) writeGrassInstance(this.grassMesh, dummy, i, kept[i]);
    this.grassMesh.count = kept.length;
    this.grassMesh.instanceMatrix.needsUpdate = true;
    if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;

    this.grassInstances = kept;
  }

  /** Cor macro por vértice: grama no miolo, rocha na serra, tingido de cratera. */
  surfaceColor(x, z, h, normal, out) {
    const n = this.noise;
    const slope = 1 - normal.y;
    const grain = n.fbm2(x * 0.09, z * 0.09, 3);
    /* Segunda camada, em escala e coordenadas DIFERENTES da de `grain` — sem
       ela, a mancha seca do gramado é a mesma função repetida, e o padrão
       fica óbvio de longe. Mesma ideia de `terrainField.js`/`environment.js`
       (`grain` + `patch`), aqui com um deslocamento próprio do Sandbox. */
    const patch = n.fbm2(x * 0.021 + 40.5, z * 0.021 - 8.2, 2);

    out.copy(PALETTE.grass).lerp(PALETTE.grassDry, clamp(0.35 + 0.5 * patch + 0.22 * grain, 0, 1));

    const rockMix = clamp(
      smoothstep(0.3, 0.6, slope) + smoothstep(this.M.wallStart + 2, this.M.wallStart + 16, h) * 0.6,
      0,
      1,
    );
    if (rockMix > 0.001) {
      const rock = _c1.copy(PALETTE.rockLight).lerp(PALETTE.rockDark, smoothstep(0.4, 0.9, slope));
      rock.lerp(
        PALETTE.scree,
        (1 - smoothstep(0.15, 0.35, slope)) * smoothstep(this.M.wallStart, this.M.wallStart + 10, h) * 0.5,
      );
      out.lerp(rock, rockMix);
    }

    const snowMix = smoothstep(this.M.peak * 0.8, this.M.peak * 0.98, h) * smoothstep(0.55, 0.25, slope);
    if (snowMix > 0.001) out.lerp(PALETTE.snow, clamp(snowMix, 0, 1));

    const { bowl, rim } = this.craterShade(x, z);
    if (bowl > 0) out.lerp(_c1.copy(PALETTE.rockDark), bowl * 0.5);
    if (rim > 0) out.lerp(_c1.copy(PALETTE.scree), rim * 0.6);

    out.multiplyScalar(0.85 + 0.15 * clamp(normal.y, 0, 1));
  }

  dispose() {
    this.mesh = null;
    this.geometry = null;
    this.material = null;
    this.body = null;
    this.collider = null;
    this.rockGroup = null;
    this.grassMesh = null;
    this.grassInstances = null;
  }
}

/* ------------------------------------------------------------ pedras ---- */

function makeRockGeometry(random) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let f = seen.get(key);
    if (f === undefined) {
      f = 0.62 + random() * 0.55;
      seen.set(key, f);
    }
    v.multiplyScalar(f);
    v.y *= 0.75;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Matacões instanciados na encosta, cada um com o próprio collider fixo (casco convexo). */
function scatterRocks(parent, physics, terrain, random) {
  const COUNT = CONFIG.levels.sandbox.rocks.count;
  const VARIANTS = 5;
  const geos = Array.from({ length: VARIANTS }, () => makeRockGeometry(random));
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
    vertexColors: true,
  });
  applySandboxDetail(material);

  const buckets = Array.from({ length: VARIANTS }, () => []);
  let guard = 0;
  let planned = 0;
  while (planned < COUNT && guard++ < COUNT * 25) {
    const ang = random() * Math.PI * 2;
    const dist = terrain.M.wallStart - 3 + random() * (terrain.radius - terrain.M.wallStart + 6);
    if (dist < 2) continue;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const variant = Math.floor(random() * VARIANTS);
    buckets[variant].push({
      x,
      z,
      radius: 0.4 + Math.pow(random(), 1.5) * 1.6,
      ry: random() * Math.PI * 2,
      tiltX: (random() - 0.5) * 0.3,
      tiltZ: (random() - 0.5) * 0.3,
      tint: new THREE.Color().copy(PALETTE.rockLight).lerp(PALETTE.rockDark, random()),
    });
    planned++;
  }

  const group = new THREE.Group();
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
      const base = terrain.heightAt(b.x, b.z);
      dummy.position.set(b.x, base - b.radius * 0.3, b.z);
      dummy.rotation.set(b.tiltX, b.ry, b.tiltZ);
      dummy.scale.setScalar(b.radius);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, b.tint);

      // Colisor = casco convexo dos MESMOS vértices já transformados.
      const hull = new Float32Array(verts.length);
      for (let kk = 0; kk < verts.length; kk += 3) {
        v.set(verts[kk], verts[kk + 1], verts[kk + 2])
          .multiplyScalar(b.radius)
          .applyEuler(dummy.rotation);
        hull[kk] = v.x;
        hull[kk + 1] = v.y;
        hull[kk + 2] = v.z;
      }
      const desc = RAPIER.ColliderDesc.convexHull(hull);
      if (!desc) continue;
      const body = physics.createBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(dummy.position.x, dummy.position.y, dummy.position.z),
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
  parent.add(group);
  return group;
}

/* -------------------------------------------------------------- mato ---- */

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

function applySwayShader(material, sway, alturaRef, amplitude) {
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
         vec3 aX = instanceMatrix[0].xyz;
         float invS = 1.0 / max(length(aX), 1e-4);
         transformed.x += dot(dWorld, aX * invS) * invS;
         transformed.z += dot(dWorld, instanceMatrix[2].xyz * invS) * invS;`,
      );
  };
  material.customProgramCacheKey = () => `sandbox-grass-sway-${alturaRef}-${amplitude}`;
}

/** Escreve a instância `inst` (posição/rotação/escala/cor) no índice `index` do InstancedMesh. */
function writeGrassInstance(mesh, dummy, index, inst) {
  dummy.position.set(inst.x, inst.y, inst.z);
  dummy.rotation.set(0, inst.ry, 0);
  dummy.scale.set(inst.sx, inst.sy, inst.sz);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
  mesh.setColorAt(index, inst.color);
}

/**
 * Tufos instanciados no miolo plano — dois planos cruzados, com balanço de
 * vento. Devolve também a lista de instâncias (posição + cor de cada uma),
 * porque `cullVegetation` precisa saber ONDE cada tufo está para apagar só os
 * que caem dentro de uma cratera nova.
 */
function scatterGrass(parent, terrain, random, sway) {
  const material = new THREE.MeshStandardMaterial({
    map: grassTexture(),
    transparent: false,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
    color: 0xffffff,
    vertexColors: false,
  });
  applySwayShader(material, sway, GRASS_HEIGHT, 1.0);

  const plane = new THREE.PlaneGeometry(0.5, GRASS_HEIGHT);
  plane.translate(0, GRASS_HEIGHT / 2, 0);
  const plane2 = plane.clone();
  plane2.rotateY(Math.PI / 2);
  const merged = mergeGeometries([plane, plane2]);

  const COUNT = CONFIG.levels.sandbox.grass.count;
  const mesh = new THREE.InstancedMesh(merged, material, COUNT);
  mesh.name = "sandbox-grass";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // DYNAMIC porque uma cratera pode apagar tufos depois da construção
  // (`cullVegetation`) — não é mais um mesh que se escreve uma vez e esquece.
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const up = new THREE.Vector3();
  const tint = new THREE.Color();
  const instances = [];
  let guard = 0;
  while (instances.length < COUNT && guard++ < COUNT * 14) {
    const ang = random() * Math.PI * 2;
    // sqrt(u), não u: a área de um anel cresce com o raio, então amostrar u
    // puro (ou uma potência > 0,5) empilha os tufos perto do centro — era
    // exatamente o que estava acontecendo antes desta correção.
    const dist = Math.sqrt(random()) * (terrain.M.wallStart - 2);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    terrain.normalAt(x, z, 1.0, up);
    if (up.y < 0.75) continue;
    const y = terrain.heightAt(x, z);
    const s = 0.7 + random() * 0.9;
    terrain.surfaceColor(x, z, y, up, tint);
    instances.push({
      x,
      y: y - 0.03,
      z,
      ry: random() * Math.PI,
      sx: s,
      sy: s * (0.8 + random() * 0.6),
      sz: s,
      color: tint.multiplyScalar(1.35).clone(),
    });
  }

  const dummy = new THREE.Object3D();
  for (let i = 0; i < instances.length; i++) writeGrassInstance(mesh, dummy, i, instances[i]);
  mesh.count = instances.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  parent.add(mesh);
  return { mesh, instances };
}
