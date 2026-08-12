/* ---------------------------------------------------------------------------
   Bancada do cerco — ferramenta de desenvolvimento, fora do jogo.

   O castelo inteiro, o chão, o portão, os três engenhos e uma amostra da horda,
   com câmera livre e o relógio do entardecer num controle deslizante. Ela existe
   porque a fase do cerco só é vista de UM lugar — o adarve, olhando para a rampa
   — e quase tudo o que está errado nela está errado em algum ângulo que o jogo
   nunca mostra: a cara de fora do muro, o pátio, a silhueta contra o poente.

   Ela monta os MESMOS objetos do jogo (`CastleTerrain`, `Castle`, `Gate`,
   `Trebuchet`, `BesiegerMesh`) com o Rapier de verdade, e é essa fidelidade que
   dá valor ao que se julga aqui. O que ela substitui é o resto: não há sala, não
   há rede e não há jogador.

   Aberta em /dev/cerco.html com o servidor de desenvolvimento rodando. Não entra
   no build de produção — o Vite só empacota o que a página de entrada alcança.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { initPhysics, PhysicsWorld } from "../src/core/physics.js";
import { Renderer } from "../src/core/renderer.js";
import { CastleTerrain } from "../src/entities/castleGround.js";
import { Castle } from "../src/entities/castle.js";
import { Gate } from "../src/entities/gate.js";
import { Trebuchet } from "../src/entities/trebuchet.js";
import { BesiegerMesh } from "../src/entities/besieger.js";
import { trebuchetPosts, GROUND_Y, WALL_TOP } from "../src/shared/castleProps.js";
import { CONFIG, applyQuality } from "../src/config.js";

/* ACHATAR O PRESET ANTES DE CONSTRUIR O RENDERIZADOR.
   `CONFIG.render` nasce sem `maxPixelRatio`: quem o preenche é `applyQuality`,
   que no jogo roda na tela de entrada. Sem ele, `Math.min(dpr, undefined)` dá
   NaN, o `setSize` do Three produz um canvas de 0 × 0 e a bancada abre PRETA —
   desenhando o quadro inteiro num buffer sem pixel nenhum. */
applyQuality("high");

await initPhysics();

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
const render = new Renderer(canvas);
const cena = render.scene;
const camera = render.camera;
camera.fov = 55;
camera.far = 900;
camera.updateProjectionMatrix();
cena.fog.density = CONFIG.levels.castle.fogDensity;

const physics = new PhysicsWorld();
const raiz = new THREE.Group();
cena.add(raiz);

const terreno = new CastleTerrain().build(raiz, physics);
const castelo = new Castle().build(raiz, physics);
const portao = new Gate().build(raiz, physics);
const engenhos = trebuchetPosts().map((p) => new Trebuchet(raiz, p));

/* UMA AMOSTRA DA HORDA, uma de cada espécie mais uma coluna de soldados na
   rampa. Não é a horda do servidor — é o suficiente para julgar silhueta,
   escala e leitura de cor, que é o que esta bancada faz. */
const ESPECIES = [
  "soldier", "shielded", "skeleton", "climber", "hound", "shaman", "ogre", "catapult",
];
const horda = [];
ESPECIES.forEach((kind, i) => {
  const x = -14 + i * 4;
  const z = 26;
  horda.push(new BesiegerMesh(raiz, physics, `amostra-${i}`, kind, x, terreno.heightAt(x, z), z));
});
for (let i = 0; i < 26; i++) {
  const x = (Math.random() * 2 - 1) * 13;
  const z = 16 + Math.random() * 70;
  const kind = ESPECIES[Math.floor(Math.random() * 4)];
  horda.push(new BesiegerMesh(raiz, physics, `fila-${i}`, kind, x, terreno.heightAt(x, z), z));
}

/* ------------------------------------------------------------ os controles */

/**
 * Os pontos de vista que importam. Cada um responde a uma pergunta.
 *
 * `livre` traz posição e alvo em coordenadas de mundo — é o que permite pôr a
 * câmera EXATAMENTE onde o jogador fica, que os controles de órbita não sabem
 * fazer (uma órbita de raio zero olha para os próprios pés). O resto orbita.
 */
const VISTAS = {
  /* A vista que decide o modo: de pé na hourd, olhando a rampa. A altura sai
     de `walkwayPosts` mais o olho do arqueiro. */
  "adarve": { livre: [[0, WALL_TOP + 1.62, 8.3], [0, GROUND_Y - 4, 58]] },
  "trabuco": { livre: [[0, WALL_TOP + 1.62, 8.6], [0, WALL_TOP + 1.2, 3.0]] },
  "de fora": { orbita: 0.05, alt: 26, dist: 62, alvoZ: 8 },
  "a rampa": { orbita: 0.02, alt: 40, dist: 118, alvoZ: 30 },
  /* DE DENTRO do pátio, à altura do olho: é o que se vê ao renascer na porta
     da menagem e o enquadramento de quem corre para reparar o portão. */
  "o pátio": { livre: [[-1.5, GROUND_Y + 1.7, -13], [2, GROUND_Y + 2.5, 8]] },
  "de trás": { orbita: Math.PI, alt: 24, dist: 46, alvoZ: -14 },
  "o portão": { orbita: 0.02, alt: 17, dist: 26, alvoZ: 8 },
  "de lado": { orbita: 1.5, alt: 24, dist: 62, alvoZ: 0 },
  "silhueta": { orbita: -1.15, alt: 20, dist: 96, alvoZ: 4 },
  "a horda": { orbita: 0.02, alt: 17, dist: 34, alvoZ: 26 },
};

const est = { orbita: 0, alt: 28, dist: 70, alvoZ: 10, dusk: 0.3, girar: false, livre: null };

const eco = (nome, v) => {
  const el = document.querySelector(`[data-eco="${nome}"]`);
  if (el) el.textContent = typeof v === "number" ? v.toFixed(2) : v;
};

for (const id of ["dusk", "orbita", "alt", "dist", "alvoZ"]) {
  const el = document.getElementById(id);
  el.addEventListener("input", () => {
    est[id] = Number(el.value);
    if (id !== "dusk") est.livre = null; // mexer num controle sai da vista fixa
    eco(id, est[id]);
  });
  eco(id, est[id]);
}

const caixaVistas = document.getElementById("vistas");
for (const nome of Object.keys(VISTAS)) {
  const b = document.createElement("button");
  b.textContent = nome;
  b.addEventListener("click", () => aplicarVista(nome));
  caixaVistas.appendChild(b);
}

function aplicarVista(nome) {
  const v = VISTAS[nome];
  est.livre = v.livre ?? null;
  for (const [k, valor] of Object.entries(v)) {
    if (k === "livre") continue;
    est[k] = valor;
    const el = document.getElementById(k);
    if (el) el.value = valor;
    eco(k, valor);
  }
  for (const b of caixaVistas.children) b.classList.toggle("on", b.textContent === nome);
}

document.getElementById("girar").addEventListener("click", (e) => {
  est.girar = !est.girar;
  e.target.classList.toggle("on", est.girar);
});
document.getElementById("cinza").addEventListener("click", (e) => {
  document.body.classList.toggle("cinza");
  e.target.classList.toggle("on", document.body.classList.contains("cinza"));
});
document.getElementById("horda").addEventListener("click", (e) => {
  const v = !horda[0].group.visible;
  for (const b of horda) b.group.visible = v;
  e.target.classList.toggle("on", v);
});

addEventListener("resize", () => render.resize());

/* -------------------------------------------------------------- o laço ---- */

const relogio = new THREE.Clock();
const conta = document.getElementById("conta");
let quadros = 0;

/** Avança `n` passos sem depender do relógio da tela. Ver `dev/trabuco.js`. */
globalThis.__passos = (n = 60, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) passo(dt);
  return { chamadas: render.renderer.info.render.calls };
};
globalThis.__cerco = { render, cena, castelo, portao, engenhos, horda, terreno, camera };

const _foco = new THREE.Vector3();

function passo(dt) {
  render.setDusk(est.dusk);
  /* O FOCO DA SOMBRA, que no jogo é o jogador.
     Sem esta chamada a luz direcional fica na origem apontando para a origem —
     degenerada — e o castelo inteiro aparece preto. Foi o que me fez procurar
     um defeito de tinta que não existia. */
  _foco.set(0, GROUND_Y, est.livre ? 20 : est.alvoZ);
  render.updateShadowFocus(_foco);
  castelo.update(dt, est.dusk, 7);
  portao.update(dt);
  for (const e of engenhos) e.update(dt, false);
  for (const b of horda) b.update(dt);

  if (est.livre) {
    camera.position.set(...est.livre[0]);
    camera.lookAt(...est.livre[1]);
    return;
  }
  if (est.girar) est.orbita += dt * 0.22;
  const o = est.orbita;
  camera.position.set(
    Math.sin(o) * est.dist,
    GROUND_Y + est.alt,
    est.alvoZ + Math.cos(o) * est.dist,
  );
  camera.lookAt(0, GROUND_Y + 4, est.alvoZ);
}

function laco() {
  requestAnimationFrame(laco);
  const dt = Math.min(0.05, relogio.getDelta());
  passo(dt);
  render.render();

  if (++quadros % 20 === 0) {
    const i = render.renderer.info.render;
    conta.innerHTML =
      `chamadas <b>${i.calls}</b> · triângulos <b>${i.triangles.toLocaleString("pt-BR")}</b>\n` +
      `castelo <b>${castelo.drawCalls}</b> malhas de pedra · horda <b>${horda.length}</b>`;
  }
}

aplicarVista("de fora");
laco();
