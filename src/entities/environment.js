/* ---------------------------------------------------------------------------
   Cenário: vale rochoso com trilha de terra, encostas de grama, matacões,
   árvores estilizadas, cercas e bandeirolas de vento.

   O relevo vem de uma função de altura determinística; a MESMA geometria
   alimenta o render e o colisor trimesh, então não existe descolamento entre
   o que se vê e o que a física enxerga.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { ValueNoise } from "../utils/noise.js";
import { clamp, smoothstep, makeRandom } from "../utils/math.js";

const PALETTE = {
  grass: new THREE.Color("#6f9c3f"),
  grassDry: new THREE.Color("#9cb254"),
  dirt: new THREE.Color("#c1996b"),
  dirtDark: new THREE.Color("#9d7a4f"),
  rockWarm: new THREE.Color("#c8ab84"),
  rockCool: new THREE.Color("#9c8869"),
  rockDark: new THREE.Color("#7d6b55"),
};

/** Centro da trilha em função de z: uma curva suave, não uma reta. */
export function pathCenterX(z) {
  return 3.0 * Math.sin(z * 0.016) + 1.6 * Math.sin(z * 0.0052 + 1.1);
}

/* ------------------------------------------------------------- terreno ----- */

export class Terrain {
  constructor(seed = 20260731) {
    this.noise = new ValueNoise(seed);
  }

  /** Altura do terreno (m) em qualquer ponto do plano. */
  heightAt(x, z) {
    const n = this.noise;
    const d = Math.abs(x - pathCenterX(z));

    // Fundo do vale: ondulação suave.
    let h = 0.62 * n.fbm2(x * 0.019, z * 0.019, 3) + 0.24 * n.fbm2(x * 0.075, z * 0.075, 2);

    // A trilha é plana e levemente escavada.
    const onPath = 1 - smoothstep(3.0, 7.5, d);
    h *= 1 - 0.8 * onPath;
    h -= 0.14 * onPath;

    // Encosta gramada antes das paredes.
    h += 3.0 * smoothstep(8.0, 17.0, d);

    // Paredes do desfiladeiro: sobem rápido (falésia) e saturam em ~34 m.
    const wall = Math.max(0, d - 16);
    if (wall > 0) {
      const sat = 1 - Math.exp(-wall / 9);
      const ridge = 0.5 + 0.5 * n.ridged2(x * 0.032, z * 0.024, 4);
      h += 34 * sat * (0.55 + 0.62 * ridge);
      h += 2.4 * n.fbm2(x * 0.11, z * 0.095, 3) * Math.min(1, wall / 5);
      // Degraus horizontais: sugerem estratos de arenito.
      h += 1.1 * Math.sin(h * 0.55 + n.noise2(x * 0.05, z * 0.05) * 2) * Math.min(1, wall / 8);
    }

    // Afloramentos rochosos isolados no meio do campo, para quebrar a monotonia.
    const outcrop = n.fbm2(x * 0.014 + 31.7, z * 0.014 - 12.3, 2);
    if (outcrop > 0.42 && d > 8) {
      h += (outcrop - 0.42) * 26 * smoothstep(8, 14, d);
    }

    return h;
  }

  /** Normal analítica por diferenças finitas. */
  normalAt(x, z, eps = 0.6, out = new THREE.Vector3()) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    return out.set(hL - hR, 2 * eps, hD - hU).normalize();
  }

  /** Constrói malha visual + colisor trimesh a partir da mesma geometria. */
  build(scene, physics) {
    const { sizeX, sizeZ, segmentsX, segmentsZ } = CONFIG.world;
    const nx = segmentsX + 1;
    const nz = segmentsZ + 1;
    const halfX = sizeX / 2;
    const originZ = 60; // o terreno vai de +60 (atrás) até -220 (frente)

    const positions = new Float32Array(nx * nz * 3);
    const colors = new Float32Array(nx * nz * 3);
    const normals = new Float32Array(nx * nz * 3);
    const indices = new Uint32Array(segmentsX * segmentsZ * 6);

    const c = new THREE.Color();
    const nrm = new THREE.Vector3();

    for (let j = 0; j < nz; j++) {
      const z = originZ - (j / segmentsZ) * sizeZ;
      for (let i = 0; i < nx; i++) {
        const x = -halfX + (i / segmentsX) * sizeX;
        const idx = j * nx + i;
        const h = this.heightAt(x, z);

        positions[idx * 3] = x;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = z;

        this.normalAt(x, z, 1.2, nrm);
        normals[idx * 3] = nrm.x;
        normals[idx * 3 + 1] = nrm.y;
        normals[idx * 3 + 2] = nrm.z;

        this.surfaceColor(x, z, h, nrm, c);
        colors[idx * 3] = c.r;
        colors[idx * 3 + 1] = c.g;
        colors[idx * 3 + 2] = c.b;
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
      roughness: 0.94,
      metalness: 0.0,
    });

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

  surfaceColor(x, z, h, normal, out) {
    const n = this.noise;
    const d = Math.abs(x - pathCenterX(z));
    const slope = 1 - normal.y; // 0 = plano, 1 = parede
    const variation = n.fbm2(x * 0.16, z * 0.16, 2);

    // Terra na trilha, grama fora dela.
    const pathMix = 1 - smoothstep(1.8, 4.6, d);
    out.copy(PALETTE.grass).lerp(PALETTE.grassDry, 0.5 + 0.5 * variation);
    const dirt = PALETTE.dirt.clone().lerp(PALETTE.dirtDark, 0.5 + 0.5 * variation);
    out.lerp(dirt, pathMix);

    // Rocha onde é íngreme. O limiar é baixo de propósito: o vale da
    // referência é de arenito, não de morro gramado.
    const rockMix = smoothstep(0.14, 0.4, slope);
    if (rockMix > 0) {
      // Estratos: bandas horizontais alternando tom quente e frio.
      const strata = 0.5 + 0.5 * Math.sin(h * 0.42 + variation * 1.6);
      const rock = PALETTE.rockWarm.clone()
        .lerp(PALETTE.rockCool, clamp(0.25 + 0.5 * strata, 0, 1))
        .lerp(PALETTE.rockDark, smoothstep(0.55, 0.95, slope) * 0.55);
      out.lerp(rock, rockMix);
    }

    // Escurece levemente as reentrâncias — dá leitura de volume sem textura.
    const ao = 0.88 + 0.12 * clamp(normal.y, 0, 1);
    out.multiplyScalar(ao);
  }
}

/* ------------------------------------------------------------ matacões ----- */

function makeBoulderGeometry(random, radius) {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
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

function scatterBoulders(scene, physics, terrain, random) {
  const material = new THREE.MeshStandardMaterial({
    color: "#c3aa88",
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
  });
  const materialDark = material.clone();
  materialDark.color = new THREE.Color("#a08a6c");

  const group = new THREE.Group();
  group.name = "boulders";
  const up = new THREE.Vector3();

  let placed = 0;
  let guard = 0;
  while (placed < 46 && guard++ < 900) {
    const z = 40 - random() * 210;
    const spread = 8 + random() * 34;
    const side = random() < 0.5 ? -1 : 1;
    const x = pathCenterX(z) + side * spread;
    if (Math.abs(x) > CONFIG.world.sizeX / 2 - 12) continue;

    const d = Math.abs(x - pathCenterX(z));
    if (d < 4.5) continue; // não obstrui a linha de tiro
    terrain.normalAt(x, z, 1.0, up);
    if (up.y < 0.72) continue; // encosta íngreme demais para uma pedra assentada

    const radius = 0.55 + random() * 1.9;
    const geo = makeBoulderGeometry(random, radius);
    const mesh = new THREE.Mesh(geo, random() < 0.35 ? materialDark : material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, terrain.heightAt(x, z) - radius * 0.32, z);
    mesh.rotation.set(
      (random() - 0.5) * 0.4,
      random() * Math.PI * 2,
      (random() - 0.5) * 0.4,
    );
    mesh.updateMatrix();
    group.add(mesh);

    // Colisor: casco convexo dos MESMOS vértices, já com a rotação aplicada.
    const verts = geo.attributes.position.array;
    const rotated = new Float32Array(verts.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < verts.length; i += 3) {
      v.set(verts[i], verts[i + 1], verts[i + 2]).applyEuler(mesh.rotation);
      rotated[i] = v.x;
      rotated[i + 1] = v.y;
      rotated[i + 2] = v.z;
    }
    const desc = RAPIER.ColliderDesc.convexHull(rotated);
    if (desc) {
      const body = physics.createBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(
          mesh.position.x,
          mesh.position.y,
          mesh.position.z,
        ),
      );
      const collider = physics.createCollider(
        desc.setFriction(0.9).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      physics.register(collider, { kind: "scenery", name: "rocha" });
    }
    placed++;
  }
  scene.add(group);
  return group;
}

/* ------------------------------------------------------------- árvores ----- */

function makeTree(random, terrain, x, z) {
  const group = new THREE.Group();
  const scale = 0.85 + random() * 0.7;

  const trunkMat = new THREE.MeshStandardMaterial({
    color: "#6b4a2c",
    roughness: 0.95,
    flatShading: true,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    color: "#4f8236",
    roughness: 0.88,
    flatShading: true,
  });
  const leafMat2 = leafMat.clone();
  leafMat2.color = new THREE.Color("#669b40");

  const trunkH = 2.6 * scale;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13 * scale, 0.22 * scale, trunkH, 7),
    trunkMat,
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  // Copa: aglomerado de esferas facetadas, estilo "pintado".
  const blobs = [
    [0, trunkH + 0.5 * scale, 0, 1.35],
    [0.75 * scale, trunkH + 0.15 * scale, 0.3 * scale, 0.95],
    [-0.7 * scale, trunkH + 0.3 * scale, -0.35 * scale, 1.0],
    [0.15 * scale, trunkH + 1.25 * scale, -0.5 * scale, 0.85],
    [-0.3 * scale, trunkH + 0.95 * scale, 0.65 * scale, 0.8],
  ];
  for (const [bx, by, bz, br] of blobs) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(br * scale, 1),
      random() < 0.4 ? leafMat2 : leafMat,
    );
    mesh.position.set(bx, by, bz);
    mesh.rotation.set(random() * 3, random() * 3, random() * 3);
    mesh.scale.set(1, 0.85, 1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  group.position.set(x, terrain.heightAt(x, z) - 0.1, z);
  group.rotation.y = random() * Math.PI * 2;
  group.userData.trunkRadius = 0.2 * scale;
  group.userData.trunkHeight = trunkH;
  return group;
}

function scatterTrees(scene, physics, terrain, random) {
  const group = new THREE.Group();
  group.name = "trees";
  const up = new THREE.Vector3();

  let placed = 0;
  let guard = 0;
  while (placed < 14 && guard++ < 600) {
    const z = 30 - random() * 200;
    const side = random() < 0.5 ? -1 : 1;
    const x = pathCenterX(z) + side * (10 + random() * 22);
    if (Math.abs(x - pathCenterX(z)) < 7) continue;
    terrain.normalAt(x, z, 1.2, up);
    if (up.y < 0.86) continue;

    const tree = makeTree(random, terrain, x, z);
    group.add(tree);

    const r = tree.userData.trunkRadius;
    const h = tree.userData.trunkHeight;
    const body = physics.createBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        tree.position.x,
        tree.position.y + h / 2,
        tree.position.z,
      ),
    );
    const collider = physics.createCollider(
      RAPIER.ColliderDesc.cylinder(h / 2, r)
        .setFriction(0.8)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    physics.register(collider, { kind: "scenery", name: "árvore" });
    placed++;
  }
  scene.add(group);
  return group;
}

/* -------------------------------------------------------------- cercas ----- */

function buildFences(scene, physics, terrain, random) {
  const group = new THREE.Group();
  group.name = "fences";
  const wood = new THREE.MeshStandardMaterial({
    color: "#8a6039",
    roughness: 0.9,
    flatShading: true,
  });

  const sections = [
    { z: -6, side: 1, count: 4 },
    { z: -26, side: -1, count: 5 },
    { z: -55, side: 1, count: 5 },
    { z: -88, side: -1, count: 4 },
  ];

  for (const s of sections) {
    const spacing = 2.0;
    const offset = 6.5 + random() * 2.5;
    for (let i = 0; i < s.count; i++) {
      const z = s.z - i * spacing;
      const x = pathCenterX(z) + s.side * offset;
      const y = terrain.heightAt(x, z);

      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.15, 0.12), wood);
      post.position.set(x, y + 0.5, z);
      post.rotation.y = (random() - 0.5) * 0.3;
      post.rotation.z = (random() - 0.5) * 0.08;
      post.castShadow = true;
      post.receiveShadow = true;
      group.add(post);

      if (i < s.count - 1) {
        const z2 = z - spacing;
        const x2 = pathCenterX(z2) + s.side * offset;
        const y2 = terrain.heightAt(x2, z2);
        for (const railY of [0.85, 0.45]) {
          const a = new THREE.Vector3(x, y + railY, z);
          const b = new THREE.Vector3(x2, y2 + railY, z2);
          const len = a.distanceTo(b);
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), wood);
          rail.position.copy(a).lerp(b, 0.5);
          rail.lookAt(b);
          rail.castShadow = true;
          group.add(rail);
        }
      }
    }
  }
  scene.add(group);
  return group;
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

function scatterGrass(scene, terrain, random) {
  const tex = grassTexture();
  const material = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: false,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 1,
    color: 0xffffff,
  });

  // Tufo = duas placas cruzadas.
  const plane = new THREE.PlaneGeometry(0.5, 0.42);
  plane.translate(0, 0.21, 0);
  const plane2 = plane.clone();
  plane2.rotateY(Math.PI / 2);
  const merged = mergeGeometries([plane, plane2]);

  const COUNT = 2600;
  const mesh = new THREE.InstancedMesh(merged, material, COUNT);
  mesh.name = "grass";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3();
  let placed = 0;
  let guard = 0;
  while (placed < COUNT && guard++ < COUNT * 12) {
    const z = 30 - random() * 175;
    const side = random() < 0.5 ? -1 : 1;
    const x = pathCenterX(z) + side * (3.4 + Math.pow(random(), 0.7) * 22);
    terrain.normalAt(x, z, 1.0, up);
    if (up.y < 0.8) continue;
    const y = terrain.heightAt(x, z);
    dummy.position.set(x, y - 0.03, z);
    dummy.rotation.set(0, random() * Math.PI, 0);
    const s = 0.7 + random() * 0.85;
    dummy.scale.set(s, s * (0.8 + random() * 0.6), s);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

/** Mesclagem mínima de BufferGeometries não-indexadas equivalentes. */
function mergeGeometries(geometries) {
  const merged = new THREE.BufferGeometry();
  const attrs = ["position", "normal", "uv"];
  const counts = geometries.reduce((s, g) => s + g.attributes.position.count, 0);
  const indexCount = geometries.reduce((s, g) => s + (g.index ? g.index.count : 0), 0);

  for (const name of attrs) {
    const itemSize = geometries[0].attributes[name].itemSize;
    const array = new Float32Array(counts * itemSize);
    let offset = 0;
    for (const g of geometries) {
      array.set(g.attributes[name].array, offset);
      offset += g.attributes[name].array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }

  const index = new Uint16Array(indexCount);
  let io = 0;
  let vo = 0;
  for (const g of geometries) {
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) index[io + i] = gi[i] + vo;
    io += gi.length;
    vo += g.attributes.position.count;
  }
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
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
    // A fita aponta para onde o vento sopra.
    this.cloth.rotation.y = Math.atan2(wind.x, wind.z) + Math.PI / 2;
    // ... e cai quando não há vento.
    this.cloth.rotation.z = -Math.PI / 2.2 + smoothstep(0, 9, speed) * (Math.PI / 2.2);

    const pos = this.cloth.geometry.attributes.position;
    const base = this.basePositions;
    const amp = 0.06 + 0.1 * smoothstep(0, 10, speed);
    const freq = 3.0 + speed * 0.8;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      pos.setXYZ(
        i,
        bx,
        by,
        Math.sin(bx * 5.5 - this.time * freq) * amp * (bx / 1.1),
      );
    }
    pos.needsUpdate = true;
  }
}

/* ---------------------------------------------------------------- API ------ */

export function createEnvironment(scene, physics) {
  const random = makeRandom(90210);
  const terrain = new Terrain().build(scene, physics);

  scatterBoulders(scene, physics, terrain, random);
  scatterTrees(scene, physics, terrain, random);
  buildFences(scene, physics, terrain, random);
  scatterGrass(scene, terrain, random);

  const flags = [
    new WindFlag(terrain, pathCenterX(-24) + 5.2, -24),
    new WindFlag(terrain, pathCenterX(-58) - 5.6, -58),
    new WindFlag(terrain, pathCenterX(-92) + 6.0, -92),
  ];
  for (const f of flags) scene.add(f.group);

  return {
    terrain,
    flags,
    update(dt, wind) {
      for (const f of flags) f.update(dt, wind);
    },
  };
}
