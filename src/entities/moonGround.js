/* ---------------------------------------------------------------------------
   O chão da Lua, do lado que se vê.

   A matemática — altura, crateras, curvatura, barreira — mora em
   `shared/moonField.js`, sem Three.js, porque o servidor precisa das mesmas
   respostas. Aqui fica só o que é de cliente: malha, cores e colisor. É a
   mesma divisão que `entities/environment.js` faz com `shared/terrainField.js`.

   DUAS MALHAS, e a segunda existe por causa do vácuo:

   • **A arena** (±350 m, grade adensada no centro) é onde se joga e é a única
     que tem colisor.

   • **O anel distante** (350 → 1.600 m) não é enfeite. No vale, a névoa e a
     serra escondem onde a malha termina; no vácuo não há névoa, o horizonte é
     recortado e nítido, e sem o anel o jogador veria o chão simplesmente
     ACABAR. Com a curvatura de 26 km, o horizonte fica a 300 m de quem está em
     pé — a borda da arena já está abaixo dele. Mas do alto do foguete o
     horizonte vai a 1,24 km, e é para lá que o anel foi dimensionado.

   O capricho todo cabe nestas duas malhas. Cratera é altura; raio de ejeção é
   cor de vértice; grão de regolito é a mesma textura triplanar que o vale já
   usa. Nada disso é objeto novo, e é por isso que a Lua sai mais barata que o
   vale — ela não tem 4.200 tufos de grama nem 200 árvores com copa animada.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CONFIG } from "../config.js";
import { MoonField } from "../shared/moonField.js";
import { focusWarp, applyTerrainDetail } from "./environment.js";
import { smoothstep } from "../utils/math.js";

/* Regolito é CINZA-ESCURO, quase marrom (albedo ~0,12) — não branco. O branco é
   o erro nº 1 de cenário lunar: ele vem da foto sobre-exposta, não do chão. O
   contraste vem da luz rasante e das sombras quase pretas, não da tinta. */
const PALETA = {
  regolito: new THREE.Color("#6b6459"),
  fundo: new THREE.Color("#3b3731"), // dentro das tigelas, onde a luz não bate
  mare: new THREE.Color("#4a4740"), // os "mares": manchas mais escuras
  borda: new THREE.Color("#8a8378"), // material fresco escavado, ainda claro
  raio: new THREE.Color("#9d968a"), // estrias de ejeção (efeito Tycho)
};

const _cor = new THREE.Color();

export class MoonTerrain extends MoonField {
  /**
   * Constrói malha visual + colisor + anel distante.
   * @param {THREE.Object3D} parent a raiz da fase (nunca a cena direto)
   */
  build(parent, physics) {
    this.buildArena(parent, physics);
    this.buildSkirt(parent);
    return this;
  }

  /* ------------------------------------------------------------- arena ---- */

  buildArena(parent, physics) {
    const W = CONFIG.levels.moon.world;
    const seg = W.segments;
    const n = seg + 1;

    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const indices = new Uint32Array(seg * seg * 6);

    /* Eixos pré-calculados: a malha é NÃO uniforme (densa na arena, rala lá
       fora), então cada linha e cada coluna têm a própria coordenada. Mesma
       reparametrização do vale — ver `focusWarp`. */
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = focusWarp((i / seg) * 2 - 1, W.gridFocus);
      xs[i] = this.centerX + w * W.half;
      zs[i] = this.centerZ + w * W.half;
    }

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = (j * n + i) * 3;
        positions[k] = xs[i];
        positions[k + 1] = this.heightAt(xs[i], zs[j]);
        positions[k + 2] = zs[j];
      }
    }

    /* Normais por diferença central sobre a PRÓPRIA grade, não analíticas:
       assim o sombreamento descreve o triângulo que existe, e a malha rala da
       borda não finge um detalhe que a geometria dela não tem. */
    const nrm = new THREE.Vector3();
    for (let j = 0; j < n; j++) {
      const jm = Math.max(0, j - 1);
      const jp = Math.min(n - 1, j + 1);
      const dz = zs[jp] - zs[jm];
      for (let i = 0; i < n; i++) {
        const im = Math.max(0, i - 1);
        const ip = Math.min(n - 1, i + 1);
        const dx = xs[ip] - xs[im];
        const hL = positions[(j * n + im) * 3 + 1];
        const hR = positions[(j * n + ip) * 3 + 1];
        const hB = positions[(jm * n + i) * 3 + 1];
        const hF = positions[(jp * n + i) * 3 + 1];

        nrm.set(-(hR - hL) / dx, 1, -(hF - hB) / dz).normalize();

        const k = (j * n + i) * 3;
        normals[k] = nrm.x;
        normals[k + 1] = nrm.y;
        normals[k + 2] = nrm.z;

        this.surfaceColor(xs[i], zs[j], nrm, _cor);
        colors[k] = _cor.r;
        colors[k + 1] = _cor.g;
        colors[k + 2] = _cor.b;
      }
    }

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

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1.0,
      metalness: 0.0,
    });
    // Reaproveita a textura de grão do vale — que é recurso de MÓDULO e por
    // isso sobrevive a qualquer troca de fase. Ver `levels/resources.js`.
    applyTerrainDetail(material);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = "moon-ground";
    parent.add(this.mesh);

    // Colisor: exatamente os mesmos vértices e índices da malha visual, então
    // não existe descolamento entre o que se vê e o que a física enxerga.
    const body = physics.createBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(positions, indices)
      .setFriction(0.98) // regolito é areia grossa: pé não escorrega
      .setRestitution(0.0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = physics.createCollider(desc, body);
    physics.register(collider, { kind: "terrain", name: "regolito" });

    this.body = body;
    this.collider = collider;
  }

  /* ------------------------------------------------- o anel do horizonte -- */

  /**
   * O chão que se vê e onde não se pisa.
   *
   * Anel polar de 128 setores por 20 anéis, com espaçamento geométrico — as
   * células crescem de ~13 m junto à arena até ~200 m lá no fim, porque o que
   * está a 1,4 km ocupa poucos pixels e não merece triângulo. São ~5,1 k
   * triângulos e UMA chamada de desenho para resolver o horizonte inteiro.
   *
   * Sem colisor, sem sombra: ninguém chega lá (a barreira está a 165 m) e uma
   * sombra projetada a 1 km só gastaria shadow map.
   */
  buildSkirt(parent) {
    const W = CONFIG.levels.moon.world;
    const setores = W.skirtSectors;
    const aneis = W.skirtRings;

    const nVerts = setores * (aneis + 1);
    const positions = new Float32Array(nVerts * 3);
    const colors = new Float32Array(nVerts * 3);
    const indices = new Uint32Array(setores * aneis * 6);

    const raios = new Float32Array(aneis + 1);
    for (let a = 0; a <= aneis; a++) {
      // Progressão geométrica: detalhe onde ainda se enxerga, barato no fim.
      const t = a / aneis;
      raios[a] = W.half * Math.pow(W.skirtOuter / W.half, t);
    }

    for (let a = 0; a <= aneis; a++) {
      for (let s = 0; s < setores; s++) {
        const ang = (s / setores) * Math.PI * 2;
        const x = this.centerX + Math.cos(ang) * raios[a];
        const z = this.centerZ + Math.sin(ang) * raios[a];
        const k = (a * setores + s) * 3;
        positions[k] = x;
        positions[k + 1] = this.heightAt(x, z);
        positions[k + 2] = z;

        this.surfaceColor(x, z, UP, _cor);
        // Escurece com a distância: sem névoa para dar perspectiva aérea, é a
        // única pista de profundidade que resta — e na Lua ela é real, porque o
        // terreno distante é visto cada vez mais de raspão.
        const escuro = 1 - 0.32 * smoothstep(W.half, W.skirtOuter, raios[a]);
        colors[k] = _cor.r * escuro;
        colors[k + 1] = _cor.g * escuro;
        colors[k + 2] = _cor.b * escuro;
      }
    }

    let k = 0;
    for (let a = 0; a < aneis; a++) {
      for (let s = 0; s < setores; s++) {
        const s2 = (s + 1) % setores;
        const i0 = a * setores + s;
        const i1 = a * setores + s2;
        const i2 = (a + 1) * setores + s;
        const i3 = (a + 1) * setores + s2;
        indices[k++] = i0;
        indices[k++] = i2;
        indices[k++] = i1;
        indices[k++] = i1;
        indices[k++] = i2;
        indices[k++] = i3;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1.0,
      metalness: 0.0,
    });

    this.skirt = new THREE.Mesh(geometry, material);
    this.skirt.receiveShadow = false;
    this.skirt.castShadow = false;
    this.skirt.name = "moon-horizon";
    parent.add(this.skirt);
  }

  /* --------------------------------------------------------------- cor ---- */

  /**
   * Cor por vértice: mares, tigelas, bordas frescas e raios de ejeção.
   *
   * TUDO aqui custa zero em tempo de execução — é atributo de vértice, resolvido
   * uma vez na construção. É onde mora metade do realismo da Lua, e é por isso
   * que dá para caprichar sem pesar.
   */
  surfaceColor(x, z, normal, out) {
    const n = this.noise;

    /* Mares × terras altas: manchas de albedo em escala de centenas de metros.
       É o que impede a Lua de parecer uma placa de cimento uniforme. */
    const mare = smoothstep(0.02, 0.42, n.fbm2(x * 0.0022, z * 0.0022, 2));
    out.copy(PALETA.regolito).lerp(PALETA.mare, mare);

    // Grão macro, para o vértice não ficar liso demais entre as manchas.
    const grao = n.fbm2(x * 0.05, z * 0.05, 2);
    out.offsetHSL(0, 0, grao * 0.03);

    const { rim, ray, bowl } = this.craterShade(x, z);
    // Fundo de tigela escurece: menos luz direta chega lá, e o material é velho.
    if (bowl > 0) out.lerp(PALETA.fundo, bowl * 0.55);
    // Borda: material escavado recentemente, ainda não escurecido pelo Sol.
    if (rim > 0) out.lerp(PALETA.borda, rim * 0.7);
    // Raios de ejeção: as estrias claras que denunciam uma cratera jovem.
    if (ray > 0) out.lerp(PALETA.raio, Math.min(1, ray) * 0.5);

    /* Encosta virada para o Sol clareia. Não é iluminação — é o material: a
       face batida fica limpa e a face abrigada acumula poeira escura. */
    const inclinacao = 1 - normal.y;
    out.offsetHSL(0, 0, inclinacao * 0.10);
    return out;
  }

  /**
   * Quanto este ponto está numa tigela, numa borda e num raio de ejeção.
   *
   * Usa a MESMA grade espacial de `heightAt`, então custa os mesmos 2 a 4 testes
   * por ponto — e só roda na construção da malha.
   */
  craterShade(x, z) {
    const C = this.M.craters;
    let rim = 0;
    let ray = 0;
    let bowl = 0;

    const perto = this.cratersNear(x, z);
    if (perto) {
      for (const c of perto) {
        const dx = x - c.x;
        const dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const t = d / c.r;

        if (t < 1) bowl = Math.max(bowl, 1 - smoothstep(0.0, 0.85, t));
        // A faixa clara acompanha a borda elevada da geometria.
        if (t > 0.7 && t < 1.25) {
          rim = Math.max(rim, 1 - Math.abs(t - 0.97) / 0.28);
        }
        if (!c.rays || t < 0.9 || t > C.rayReach) continue;

        /* A estria: um cosseno no ângulo, elevado a uma potência alta para
           virar risco fino em vez de onda. `rayPhase` gira o leque de cada
           cratera, senão todas apontariam para o mesmo lado. */
        const ang = Math.atan2(dz, dx) + c.rayPhase;
        const faixa = Math.pow(Math.max(0, Math.cos(ang * C.rayCount)), 8);
        const some = 1 - smoothstep(1, C.rayReach, t);
        ray += faixa * some;
      }
    }
    return { rim, ray, bowl };
  }

  /** Desmontagem: só a física; o visual sai com a raiz da fase. */
  dispose() {
    this.mesh = null;
    this.skirt = null;
    this.body = null;
    this.collider = null;
  }
}

const UP = { x: 0, y: 1, z: 0 };
