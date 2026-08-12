/* ---------------------------------------------------------------------------
   O chão da fase Castelo, do lado que se vê.

   A matemática — esporão, rampa, planície, serra — mora em
   `shared/castleField.js`, sem Three.js, porque o servidor precisa das mesmas
   alturas para fazer a horda subir. Aqui fica só o que é de cliente: malha,
   cores e colisor. Mesma divisão de `moonGround.js` sobre `moonField.js`.

   A COR FAZ TRABALHO DE JOGO, não de paisagem. São três materiais no mesmo
   atributo de vértice, e cada um marca uma regra:

   • **rocha nua** nos flancos do esporão — onde a inclinação passa dos 54° e
     `isWalkable` já responde não. O jogador lê "não se sobe por aqui" pela
     cor, antes de tentar;
   • **terra batida** na rampa — o corredor de 26 m que o trabuco cobre. É
     literalmente o campo de tiro, e ele tem de ser visível a 90 m, à noite;
   • **pasto** no resto.

   Pintar isso por vértice custa zero em tempo de execução: é resolvido uma vez
   na construção, como as crateras da Lua.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { RAPIER } from "../core/physics.js";
import { CastleField, CASTLE_WORLD } from "../shared/castleField.js";
import { GROUND_Y, castleWoods, castleRocks, rampDebris } from "../shared/castleProps.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { focusWarp, applyTerrainDetail } from "./environment.js";
import { smoothstep } from "../utils/math.js";

const PALETA = {
  // Pasto: verde de campo, com a variação seca por cima.
  pasto: new THREE.Color("#4e6440"),
  pastoSeco: new THREE.Color("#6b7346"),
  // Rocha do esporão: calcário, o mesmo material do castelo.
  rocha: new THREE.Color("#6b655b"),
  rochaClara: new THREE.Color("#847d70"),
  /* ------------------------------------------------------------ a rampa ----
     Quatro tons, e não um.

     A primeira versão era UMA cor de terra interpolada por um ruído — o
     resultado era uma faixa marrom chapada de noventa metros, que é o que se vê
     numa textura de espaço reservado. E ela ocupa o centro da tela a partida
     inteira: é literalmente o campo de tiro.

     O que dá superfície a ela é a MESMA coisa que dá superfície a uma estrada
     de verdade: os sulcos onde a roda passa, o meio pisado que fica mais claro,
     o cascalho que aflora e a grama que volta pela beirada. Nada disso é
     textura — é cor por vértice, resolvida uma vez na construção. */
  terra: new THREE.Color("#7a6547"),
  terraSeca: new THREE.Color("#96805c"),
  sulco: new THREE.Color("#4f4030"),
  cascalho: new THREE.Color("#8b8577"),
};

const _cor = new THREE.Color();
const _nrm = new THREE.Vector3();
const EIXO_Y = new THREE.Vector3(0, 1, 0);

export class CastleTerrain extends CastleField {
  build(parent, physics) {
    this.buildArena(parent, physics);
    this.buildSkirt(parent);
    this.buildWoods(parent, physics);
    return this;
  }

  /**
   * O bosque e as pedras soltas.
   *
   * O porquê está em `castleProps.castleWoods()`: sem eles a planície lê como
   * lâmina d'água e a horda parece emergir dela. Aqui é só a malha.
   *
   * TUDO FUNDIDO EM TRÊS: tronco, copa e pedra. São ~300 árvores e ~90 pedras;
   * uma malha por peça seriam 1 300 chamadas de desenho num modo que ainda
   * precisa desenhar 120 sitiantes. Fundidas, são três — e nenhuma delas se
   * move, então a fusão não custa nada depois da construção.
   */
  buildWoods(parent, physics) {
    const troncos = [];
    const copas = [];
    const pedras = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const um = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();

    const geoTronco = new THREE.CylinderGeometry(0.72, 1, 1, 6);
    const geoConifera = new THREE.ConeGeometry(1, 1, 7);
    /* Esfera de 5×4 e NÃO icosaedro: `IcosahedronGeometry` vem sem índice e
       `ConeGeometry` vem com, e `mergeGeometries` recusa a mistura — o bosque
       inteiro sumia com um aviso no console e nada na tela. */
    const geoCopa = new THREE.SphereGeometry(1, 5, 4);
    const geoPedra = new THREE.SphereGeometry(1, 6, 4);

    this.woodColliders = [];
    for (const t of castleWoods()) {
      const y = this.heightAt(t.x, t.z);
      const hTronco = t.conifera ? t.h * 0.32 : t.h * 0.55;

      /* O TRONCO TEM COLISOR, e ele existe pelo motivo que o cabeçalho de
         `shared/valleyProps.js` documenta: o servidor já para a flecha do bot
         num tronco (a lista é a mesma), e sem o colisor deste lado a flecha do
         JOGADOR atravessaria a mesma árvore. Duas telas discordando sobre onde
         a flecha parou é o defeito que a lista única existe para evitar.
         A altura é a mesma que `castleBlockers` declara: 55 % da árvore. */
      const hCol = t.h * 0.55;
      const corpo = physics.createBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(t.x, y + hCol / 2, t.z),
      );
      const col = physics.createCollider(
        RAPIER.ColliderDesc.cylinder(hCol / 2, t.r)
          .setFriction(0.9)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        corpo,
      );
      physics.register(col, { kind: "scenery", name: "árvore" });
      this.woodColliders.push(col);

      pos.set(t.x, y + hTronco / 2, t.z);
      q.setFromAxisAngle(EIXO_Y, t.giro);
      m4.compose(pos, q, um.set(t.r, hTronco, t.r));
      troncos.push(geoTronco.clone().applyMatrix4(m4));

      if (t.conifera) {
        /* Três cones empilhados. A conífera é a silhueta que diz "floresta" a
           cento e cinquenta metros — e é justamente a essa distância que ela
           precisa dizer, porque é de lá que a horda sai. */
        for (let k = 0; k < 3; k++) {
          const f = 1 - k * 0.28;
          const raio = t.r * (3.4 - k * 0.55);
          const alt = t.h * 0.42 * f;
          pos.set(t.x, y + hTronco + t.h * 0.2 * k + alt / 2, t.z);
          m4.compose(pos, q, um.set(raio, alt, raio));
          copas.push(geoConifera.clone().applyMatrix4(m4));
        }
      } else {
        const raio = t.r * 3.2;
        pos.set(t.x, y + hTronco + raio * 0.65, t.z);
        m4.compose(pos, q, um.set(raio, raio * 0.82, raio));
        copas.push(geoCopa.clone().applyMatrix4(m4));
      }
    }

    for (const r of castleRocks()) {
      const y = this.heightAt(r.x, r.z);
      pos.set(r.x, y + r.r * r.achatamento * 0.55, r.z);
      q.setFromAxisAngle(EIXO_Y, r.giro);
      m4.compose(pos, q, um.set(r.r, r.r * r.achatamento, r.r * 0.86));
      pedras.push(geoPedra.clone().applyMatrix4(m4));
    }

    const juntar = (lista, material, nome) => {
      if (!lista.length) return;
      const geo = mergeGeometries(lista, false);
      for (const g of lista) g.dispose();
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = nome;
      parent.add(mesh);
    };

    juntar(troncos, new THREE.MeshStandardMaterial({ color: "#3b3026", roughness: 0.96 }), "castle-troncos");
    juntar(copas, new THREE.MeshStandardMaterial({ color: "#2f4030", roughness: 0.95 }), "castle-copas");
    juntar(pedras, new THREE.MeshStandardMaterial({ color: "#565049", roughness: 0.95 }), "castle-pedras");

    geoTronco.dispose();
    geoConifera.dispose();
    geoCopa.dispose();
    geoPedra.dispose();

    this.buildDebris(parent, juntar);
  }

  /**
   * Os destroços dos ombros da rampa.
   *
   * O porquê está em `castleProps.rampDebris()`: sem eles, noventa metros de
   * terra lisa não dão distância nenhuma ao olho, e escolher em quem atirar
   * primeiro é a decisão que o modo pede o tempo todo.
   *
   * DUAS malhas para tudo — madeira e ferro —, fundidas como o bosque e pelo
   * mesmo motivo. São ~90 peças; soltas seriam noventa chamadas de desenho num
   * modo que já paga 120 sitiantes.
   */
  buildDebris(parent, juntar) {
    const madeira = [];
    const ferro = [];
    const m4 = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const um = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();

    const geoPau = new THREE.CylinderGeometry(0.6, 1, 1, 5);
    const geoCaixa = new THREE.BoxGeometry(1, 1, 1);
    const geoDisco = new THREE.CylinderGeometry(1, 1, 1, 9);

    const por = (lista, geo, x, y, z, sx, sy, sz, rx, ry, rz) => {
      pos.set(x, y, z);
      q.setFromEuler(e.set(rx, ry, rz));
      m4.compose(pos, q, um.set(sx, sy, sz));
      lista.push(geo.clone().applyMatrix4(m4));
    };

    for (const d of rampDebris()) {
      const y = this.heightAt(d.x, d.z);
      if (d.tipo === "estaca") {
        // Uma estaca fincada e tombada: o pé afunda, a ponta é lascada.
        por(madeira, geoPau, d.x, y + Math.cos(d.inclina) * d.h * 0.45, d.z,
          d.r, d.h, d.r, 0, d.giro, d.inclina);
      } else if (d.tipo === "escudo") {
        por(madeira, geoDisco, d.x, y + 0.06, d.z,
          0.38 * d.escala, 0.09, 0.38 * d.escala, Math.PI / 2 - d.inclina, d.giro, 0);
        por(ferro, geoDisco, d.x, y + 0.11, d.z,
          0.1 * d.escala, 0.1, 0.1 * d.escala, Math.PI / 2 - d.inclina, d.giro, 0);
      } else if (d.tipo === "lanca") {
        por(madeira, geoPau, d.x, y + 0.07, d.z,
          0.045, 2.1 * d.escala, 0.045, Math.PI / 2 - d.inclina * 0.4, d.giro, 0);
        por(ferro, geoCaixa, d.x + Math.sin(d.giro) * 1.05 * d.escala, y + 0.1,
          d.z + Math.cos(d.giro) * 1.05 * d.escala, 0.05, 0.05, 0.26, 0, d.giro, 0);
      } else {
        /* A CARROÇA: caixa tombada, dois eixos e uma roda de pé. Ela é a peça
           grande, e é dela que sai a escala do trecho em que está. */
        const t = d.tomba;
        por(madeira, geoCaixa, d.x, y + 0.55, d.z, 1.25, 0.42, 0.75, t, d.giro, 0);
        for (const s of [-1, 1]) {
          por(madeira, geoCaixa, d.x, y + 0.9, d.z + s * 0.7,
            1.25, 0.3, 0.08, t, d.giro, 0);
        }
        por(madeira, geoDisco, d.x + Math.cos(d.giro) * 1.0, y + 0.62,
          d.z - Math.sin(d.giro) * 1.0, 0.62, 0.11, 0.62, 0, 0, Math.PI / 2 + d.giro);
        por(madeira, geoPau, d.x - Math.cos(d.giro) * 1.5, y + 0.3,
          d.z + Math.sin(d.giro) * 1.5, 0.07, 1.9, 0.07, 1.35, d.giro, 0);
      }
    }

    juntar(madeira, new THREE.MeshStandardMaterial({ color: "#4a3a2a", roughness: 0.96 }), "castle-destrocos");
    juntar(ferro, new THREE.MeshStandardMaterial({ color: "#5a5a60", roughness: 0.6, metalness: 0.55 }), "castle-ferragem");

    geoPau.dispose();
    geoCaixa.dispose();
    geoDisco.dispose();
  }

  buildArena(parent, physics) {
    const W = CASTLE_WORLD;
    const seg = W.segments;
    const n = seg + 1;

    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const indices = new Uint32Array(seg * seg * 6);

    /* Grade NÃO uniforme: densa onde se joga, rala no horizonte. Mesma
       reparametrização do vale e da Lua — ver `focusWarp`. A célula fica em
       ~0,9 m dentro do castelo e da rampa, que é o que o degrau de 14 m do
       esporão precisa para não virar escada de serra. */
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = focusWarp((i / seg) * 2 - 1, W.gridFocus);
      xs[i] = W.center.x + w * W.half;
      zs[i] = W.center.z + w * W.half;
    }

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = (j * n + i) * 3;
        positions[k] = xs[i];
        positions[k + 1] = this.heightAt(xs[i], zs[j]);
        positions[k + 2] = zs[j];
      }
    }

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

        _nrm.set(-(hR - hL) / dx, 1, -(hF - hB) / dz).normalize();

        const k = (j * n + i) * 3;
        normals[k] = _nrm.x;
        normals[k + 1] = _nrm.y;
        normals[k + 2] = _nrm.z;

        this.surfaceColor(xs[i], zs[j], _nrm, _cor);
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
    applyTerrainDetail(material);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = "castle-ground";
    parent.add(this.mesh);

    const body = physics.createBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(positions, indices)
      .setFriction(0.95)
      .setRestitution(0.0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = physics.createCollider(desc, body);
    physics.register(collider, { kind: "terrain", name: "castelo-chão" });

    this.body = body;
    this.collider = collider;
  }

  /**
   * O anel do horizonte: chão que se vê e onde não se pisa.
   *
   * Mais barato que o da Lua (96 × 12 contra 128 × 20) porque aqui existe
   * névoa: a partir de ~400 m tudo já está lavado, e triângulo gasto além
   * disso não desenha nada que se distinga do fundo.
   */
  buildSkirt(parent) {
    const W = CASTLE_WORLD;
    const setores = 96;
    const aneis = 12;
    const nVerts = setores * (aneis + 1);
    const positions = new Float32Array(nVerts * 3);
    const colors = new Float32Array(nVerts * 3);
    const indices = new Uint32Array(setores * aneis * 6);

    const raios = new Float32Array(aneis + 1);
    for (let a = 0; a <= aneis; a++) {
      raios[a] = W.half * Math.pow(900 / W.half, a / aneis);
    }

    for (let a = 0; a <= aneis; a++) {
      for (let s = 0; s < setores; s++) {
        const ang = (s / setores) * Math.PI * 2;
        const x = W.center.x + Math.cos(ang) * raios[a];
        const z = W.center.z + Math.sin(ang) * raios[a];
        const kk = (a * setores + s) * 3;
        positions[kk] = x;
        positions[kk + 1] = this.heightAt(x, z);
        positions[kk + 2] = z;
        _cor.copy(PALETA.rocha).lerp(PALETA.pasto, 0.35);
        const escuro = 1 - 0.4 * smoothstep(W.half, 900, raios[a]);
        colors[kk] = _cor.r * escuro;
        colors[kk + 1] = _cor.g * escuro;
        colors[kk + 2] = _cor.b * escuro;
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

    this.skirt = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    );
    this.skirt.receiveShadow = false;
    this.skirt.castShadow = false;
    this.skirt.name = "castle-horizon";
    parent.add(this.skirt);
  }

  /** Cor por vértice — ver o cabeçalho para o que cada uma comunica. */
  surfaceColor(x, z, normal, out) {
    const n = this.noise;

    const seco = smoothstep(0.1, 0.6, n.fbm2(x * 0.014, z * 0.014, 2));
    out.copy(PALETA.pasto).lerp(PALETA.pastoSeco, seco);

    /* Rocha onde a inclinação denuncia flanco de esporão. O mesmo 0,58 que
       `isWalkable` usa: a cor e a regra saem do mesmo número, então nunca há
       uma encosta que parece escalável e não é. */
    const rocha = 1 - smoothstep(0.58, 0.86, normal.y);
    if (rocha > 0) {
      const veio = 0.5 + 0.5 * n.fbm2(x * 0.09, z * 0.09, 2);
      out.lerp(PALETA.rocha.clone().lerp(PALETA.rochaClara, veio), rocha);
    }

    /* ------------------------------------------------------------ a rampa --
       Ver o comentário da paleta para por que ela ganhou quatro tons. */
    const aterro = this.rampHeight(x, z) / GROUND_Y;
    const patio = this.plateauMask(x, z);
    const batido = Math.max(aterro * 0.92, patio * 0.8);
    if (batido > 0.02) {
      const f = Math.min(1, batido);

      // Base de terra, com manchas secas em escala de dez metros.
      const seco2 = smoothstep(0.15, 0.7, n.fbm2(x * 0.05 + 11, z * 0.05 - 7, 2));
      const terra = PALETA.terra.clone().lerp(PALETA.terraSeca, seco2);

      /* CASCALHO. Ruído de alta frequência com corte duro: em vez de um
         degradê (que some), vira pedrisco solto aflorando — a única coisa que
         dá granulometria a noventa metros de chão. */
      const brita = smoothstep(0.62, 0.78, n.fbm2(x * 0.55, z * 0.55, 2));
      terra.lerp(PALETA.cascalho, brita * 0.55);

      /* OS SULCOS. Dois, onde a roda de carroça passa, serpenteando de leve
         para não virarem dois traços de régua. O centro entre eles é o mais
         pisado, e por isso o mais claro. */
      const serp = Math.sin(z * 0.055) * 1.6 + Math.sin(z * 0.021 + 2.1) * 1.1;
      for (const lado of [-1, 1]) {
        const d = Math.abs(x - (serp + lado * 3.6));
        terra.lerp(PALETA.sulco, (1 - smoothstep(0.0, 1.5, d)) * 0.62);
      }
      const miolo = 1 - smoothstep(1.2, 4.2, Math.abs(x - serp));
      terra.lerp(PALETA.terraSeca, miolo * 0.3);

      /* A BEIRADA não corta a seco: a grama volta por cima da terra nos
         últimos metros, que é o que uma estrada de terra faz. */
      const borda = 1 - smoothstep(0.55, 0.95, f);
      out.lerp(terra, f * (1 - borda * 0.55));
    }

    out.offsetHSL(0, 0, (1 - normal.y) * 0.06);
    return out;
  }

  dispose() {
    this.woodColliders = [];
    this.mesh = null;
    this.skirt = null;
    this.body = null;
    this.collider = null;
  }
}
