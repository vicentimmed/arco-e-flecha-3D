/* ---------------------------------------------------------------------------
   Bancada do trabuco — ferramenta de desenvolvimento, fora do jogo.

   Um engenho sozinho num deque, com o ciclo de tiro em laço e um arqueiro do
   lado para dar escala. É onde se julga a ARMAÇÃO — que estava de cabeça para
   baixo — sem ter de entrar numa sala de cerco, subir a escada e esperar
   catorze segundos de içamento a cada tentativa.

   Ela importa a `Trebuchet` DE VERDADE, com os mesmos materiais e a mesma
   animação do jogo. O que ela substitui é o mundo em volta: o adarve vira um
   plano e não existe física.

   Aberta em /dev/trabuco.html com o servidor de desenvolvimento rodando. Não
   entra no build de produção — o Vite só empacota o que a página de entrada
   alcança.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { Trebuchet, MUZZLE } from "../src/entities/trebuchet.js";
import { CONFIG } from "../src/config.js";

const cena = new THREE.Scene();
cena.background = new THREE.Color("#7ea8c8");
cena.fog = new THREE.Fog("#9db8cc", 40, 140);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 300);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
/* Mesmo pipeline de cor do jogo — julgar tinta sob outro tone mapping é pior
   do que não julgar. Ver o mesmo bloco em `dev/skins.js`. */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.render.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

/* A luz do castelo ao entardecer, que é quando o engenho é olhado. */
const sol = new THREE.DirectionalLight(0xffd9a8, 2.6);
sol.position.set(-7, 9, 6);
sol.castShadow = true;
sol.shadow.mapSize.set(1024, 1024);
sol.shadow.bias = -0.0008;
sol.shadow.normalBias = 0.05;
sol.shadow.camera.near = 0.5;
sol.shadow.camera.far = 40;
for (const lado of ["left", "bottom"]) sol.shadow.camera[lado] = -9;
for (const lado of ["right", "top"]) sol.shadow.camera[lado] = 9;
cena.add(sol, new THREE.HemisphereLight(0x9fc4e8, 0x4a4238, 0.9));

/* O DEQUE: um pedaço de adarve com a largura de verdade (5,4 m), para se ver
   se a máquina cabe nele. É a pergunta que motivou mover o posto. */
const deque = new THREE.Mesh(
  new THREE.BoxGeometry(9, 0.4, 5.4),
  new THREE.MeshStandardMaterial({ color: "#6a655c", roughness: 0.94 }),
);
deque.position.y = -0.2;
deque.receiveShadow = true;
cena.add(deque);

const grade = new THREE.GridHelper(9, 18, 0x304050, 0x263040);
grade.position.y = 0.005;
cena.add(grade);

/* Uma silhueta de 1,80 m ao lado. Não é o arqueiro de verdade (isto aqui julga
   a máquina, não a fantasia) — é a RÉGUA, e uma caixa da altura certa responde
   "isto ficou grande demais?" tão bem quanto um corpo articulado. */
const regua = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 1.8, 0.26),
  new THREE.MeshStandardMaterial({ color: "#c8b89a", roughness: 0.9 }),
);
regua.position.set(-2.4, 0.9, 1.9);
regua.castShadow = true;
cena.add(regua);

const trabuco = new Trebuchet(cena, { id: 0, x: 0, y: 0, z: 0 });
/* Exposto de propósito: é uma bancada, e medir a pose no console é metade do
   que ela serve para fazer. */
globalThis.__trabuco = trabuco;

/**
 * Roda `n` passos de animação SEM esperar o relógio da tela.
 *
 * O `requestAnimationFrame` de um painel que não está em foco não avança, e um
 * ciclo de tiro que só progride quando alguém tira uma foto não é inspecionável.
 * Isto assenta a pose num passo síncrono e devolve as medidas que interessam.
 */
globalThis.__passos = (n = 60, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) trabuco.update(dt, false);
  const pedra = new THREE.Vector3();
  const peso = new THREE.Vector3();
  const ponta = new THREE.Vector3();
  cena.updateMatrixWorld(true);
  trabuco.municao.getWorldPosition(pedra);
  trabuco.peso.getWorldPosition(peso);
  trabuco.funda.getWorldPosition(ponta);
  const r3 = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
  return {
    braco: +trabuco.arm.rotation.x.toFixed(3),
    swing: +trabuco.swing.toFixed(3),
    reload: +trabuco.reload.toFixed(2),
    ready: trabuco.ready,
    pedra: r3(pedra),
    peso: r3(peso),
    pontaDoBraco: r3(ponta),
  };
};

/* A MARCA DA SOLTA: onde `MUZZLE` diz que a pedra deixa a funda. Ela existe
   porque esse ponto entra na integração do voo — se a esfera não coincidir com
   a bolsa de couro no instante da varredura, a marca no chão mente. */
const marca = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0x7affc8, wireframe: true }),
);
cena.add(marca);

/* ------------------------------------------------------------- os controles */

const est = {
  ciclo: true,
  girar: false,
  orbita: 0.9,
  alt: 2.2,
  dist: 7.5,
  yaw: 0,
  reloadManual: 1,
  t: 0,
};

const eco = (nome, v) => {
  const el = document.querySelector(`[data-eco="${nome}"]`);
  if (el) el.textContent = typeof v === "number" ? v.toFixed(2) : v;
};

for (const [id, chave] of [
  ["reload", "reloadManual"],
  ["yaw", "yaw"],
  ["orbita", "orbita"],
  ["alt", "alt"],
  ["dist", "dist"],
]) {
  const el = document.getElementById(id);
  el.addEventListener("input", () => {
    est[chave] = Number(el.value);
    eco(id, est[chave]);
    if (id === "reload") est.ciclo = false, botao("ciclo", false);
  });
  eco(id, est[chave]);
}

function botao(id, ligado) {
  document.getElementById(id).classList.toggle("on", ligado);
}

document.getElementById("atirar").addEventListener("click", () => {
  est.ciclo = false;
  botao("ciclo", false);
  trabuco.setReady(true, 1);
  trabuco.fireAt(est.yaw, 30);
});
document.getElementById("ciclo").addEventListener("click", () => {
  est.ciclo = !est.ciclo;
  botao("ciclo", est.ciclo);
  est.t = 0;
});
document.getElementById("girar").addEventListener("click", () => {
  est.girar = !est.girar;
  botao("girar", est.girar);
});
document.getElementById("cinza").addEventListener("click", () => {
  document.body.classList.toggle("cinza");
  botao("cinza", document.body.classList.contains("cinza"));
});
document.getElementById("grade").addEventListener("click", () => {
  grade.visible = !grade.visible;
  botao("grade", grade.visible);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* -------------------------------------------------------------- o laço ---- */

/** Um ciclo comprimido: tiro, repique e içamento em 6 s em vez de 14. */
const CICLO = 6;

const relogio = new THREE.Clock();
const conta = document.getElementById("conta");
let quadros = 0;

function laco() {
  requestAnimationFrame(laco);
  const dt = Math.min(0.05, relogio.getDelta());

  if (est.ciclo) {
    est.t += dt;
    if (est.t > CICLO) {
      est.t = 0;
      trabuco.setReady(true, 1);
      trabuco.fireAt(est.yaw, 30);
    } else {
      // 0,8 s de repique e o resto de içamento — as proporções do jogo.
      trabuco.reload = Math.max(0, Math.min(1, (est.t - 0.8) / (CICLO - 1.6)));
      if (est.t > CICLO - 0.4) trabuco.setReady(true, 1);
    }
  } else {
    trabuco.reload = est.reloadManual;
    trabuco.ready = est.reloadManual >= 1;
  }

  trabuco.yaw = est.yaw;
  trabuco.update(dt, false);

  if (est.girar) est.orbita += dt * 0.5;
  const o = est.orbita;
  camera.position.set(Math.sin(o) * est.dist, est.alt, Math.cos(o) * est.dist);
  camera.lookAt(0, 1.5, 0);

  marca.position.set(Math.sin(est.yaw) * MUZZLE.z, MUZZLE.y, Math.cos(est.yaw) * MUZZLE.z);

  renderer.render(cena, camera);

  if (++quadros % 20 === 0) {
    const i = renderer.info.render;
    conta.innerHTML =
      `chamadas <b>${i.calls}</b> · triângulos <b>${i.triangles.toLocaleString("pt-BR")}</b>\n` +
      `braço <b>${trabuco.arm.rotation.x.toFixed(2)}</b> rad · içamento <b>${trabuco.reload.toFixed(2)}</b>\n` +
      `solta em <b>y ${MUZZLE.y.toFixed(2)}</b> · <b>z ${MUZZLE.z.toFixed(2)}</b>`;
  }
}
laco();
