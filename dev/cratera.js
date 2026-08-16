/* ---------------------------------------------------------------------------
   Bancada da FASE CRATERA — ferramenta de desenvolvimento, fora do jogo.

   Existe pela mesma razão que `dev/voo.html` e `dev/cerco.html`: julgar a forma
   de uma cratera exige abri-la vinte vezes seguidas mudando um número, e fazer
   isso dentro de uma partida é lento demais para ser honesto. Aqui a montanha
   está a um clique.

   Ela não encosta em `lobby.js` nem em `main.js`, e é de propósito — é o que
   garante risco zero para quem está trabalhando no jogo agora.

   O tiro é um raio marchado contra o campo: onde ele encontra a primeira pedra,
   nasce uma bacia. A sequência de bacias de uma rajada é o mesmo laço que um
   feixe perfurante faria, com o espaçamento sorteado de `espacamentoApos`.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CampoCratera, VOXEL, NC, METADE, FUNDO, TETO_MUNDO } from "../src/cratera/campo.js";
import { MalhaCratera } from "../src/cratera/malha.js";
import { espacamentoApos, prepararImpacto } from "../src/cratera/escavar.js";
import { Entulho } from "../src/cratera/entulho.js";
import { Rochas } from "../src/cratera/rochas.js";

/* ------------------------------------------------------------------ cena -- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#8fc4e8");
scene.fog = new THREE.Fog("#8fc4e8", 180, 460);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.3, 1200);

scene.add(new THREE.HemisphereLight(0xcfe6f2, 0x4a4238, 1.15));
const sol = new THREE.DirectionalLight(0xfff2d8, 2.1);
sol.position.set(-90, 130, 70);
scene.add(sol);
/* Uma segunda luz fraca por baixo, só para a parede do túnel não virar breu
   absoluto. Numa fase de verdade isso seria a própria luz do ki de quem atira. */
const contra = new THREE.DirectionalLight(0x6a7c88, 0.5);
contra.position.set(70, -40, -60);
scene.add(contra);

/* ----------------------------------------------------------------- mundo -- */
const raiz = new THREE.Group();
scene.add(raiz);

const campo = new CampoCratera();
const malha = new MalhaCratera(raiz, campo);
campo.onSujo = (cx, cy, cz) => {
  /* O vizinho de cima também suja: a auréola de um pedaço olha uma célula para
     trás, então quem muda a borda baixa dele muda o desenho do de cima. */
  for (let ax = 0; ax <= 1; ax++) {
    for (let ay = 0; ay <= 1; ay++) {
      for (let az = 0; az <= 1; az++) malha.sujar(cx + ax, cy + ay, cz + az);
    }
  }
};

/* A arena inteira, de uma vez: é pequena e isto é bancada. */
const C0 = Math.floor(-METADE / (NC * VOXEL));
const C1 = Math.floor(METADE / (NC * VOXEL));
const CY0 = Math.floor(FUNDO / (NC * VOXEL));
const CY1 = Math.floor(TETO_MUNDO / (NC * VOXEL));
malha.sujarCaixa(C0, CY0, C0, C1, CY1, C1);
console.time("malha inicial");
malha.tudo();
console.timeEnd("malha inicial");

/* O entulho e as pedras. Nascem depois da malha porque a distribuição das
   pedras consulta o relevo, e o entulho colide contra ele. */
const entulho = new Entulho(raiz, campo);
const rochas = new Rochas(raiz, campo, entulho);

/* ------------------------------------------------------------- o tiro ----- */
let proxId = 1;

/** Marcha um raio até a primeira pedra. Devolve o ponto, ou null. */
function primeiraPedra(ox, oy, oz, dx, dy, dz, alcance = 400, passo = VOXEL * 0.8) {
  for (let d = 0; d < alcance; d += passo) {
    const x = ox + dx * d;
    const y = oy + dy * d;
    const z = oz + dz * d;
    if (y < FUNDO - 4 || y > TETO_MUNDO + 40) continue;
    if (campo.solidoEm(x, y, z)) return { x, y, z, d };
  }
  return null;
}

/**
 * Um disparo: acha a pedra e abre `n` bacias entrando por ela.
 *
 * É o mesmo laço que um feixe perfurante roda — a primeira bacia é a BOCA (bem
 * maior) e as seguintes andam pelo espaçamento sorteado. A cabeça enxerga o
 * terreno como ele estava quando o tiro saiu, e não os próprios buracos: sem
 * isso ela se encontraria dentro da bacia recém-aberta e concluiria que saiu da
 * rocha. Aqui isso é de graça, porque a marcha já foi resolvida antes de cavar.
 */
function atirar(ox, oy, oz, dx, dy, dz, raio = 5, n = 1) {
  const m = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= m;
  dy /= m;
  dz /= m;
  const bate = primeiraPedra(ox, oy, oz, dx, dy, dz);
  if (!bate) return 0;

  let x = bate.x;
  let y = bate.y;
  let z = bate.z;
  let feitos = 0;
  for (let i = 0; i < n; i++) {
    const id = proxId++;
    const c = campo.escavar({ id, x, y, z, dx, dy, dz, raio, boca: i === 0 });
    feitos++;
    if (c) {
      /* A ordem importa: as pedras primeiro (algumas viram entulho), depois o
         estouro da própria cratera, depois sacudir o entulho que já estava
         pousado e acabou de perder o chão. */
      rochas.aplicar(c);
      entulho.estourar(c, Math.round(14 + c.R * 2.4));
      entulho.sacudir(c.cx, c.cy, c.cz, c.alcance + 6);
    }
    const passo = espacamentoApos(id, raio);
    x += dx * passo;
    y += dy * passo;
    z += dz * passo;
    if (y < FUNDO || Math.abs(x) > METADE || Math.abs(z) > METADE) break;
  }
  malha.tudo();
  medir();
  return feitos;
}

/* ---------------------------------------------------------------- câmera -- */
const alvo = new THREE.Vector3(0, 6, 0);
let raioOrb = 150;
let yaw = 0.9;
let pitch = 0.42;
let livre = false;

function posicionar() {
  if (livre) return;
  camera.position.set(
    alvo.x + Math.cos(yaw) * Math.cos(pitch) * raioOrb,
    alvo.y + Math.sin(pitch) * raioOrb,
    alvo.z + Math.sin(yaw) * Math.cos(pitch) * raioOrb,
  );
  camera.lookAt(alvo);
}
posicionar();

let arrastou = false;
let apertado = false;
renderer.domElement.addEventListener("pointerdown", () => {
  apertado = true;
  arrastou = false;
});
addEventListener("pointermove", (e) => {
  if (!apertado) return;
  if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) arrastou = true;
  yaw -= e.movementX * 0.005;
  pitch = Math.max(-1.35, Math.min(1.35, pitch + e.movementY * 0.005));
  posicionar();
});
addEventListener("pointerup", (e) => {
  apertado = false;
  /* Clique sem arrastar = tiro, na direção do cursor. */
  if (arrastou || e.target !== renderer.domElement) return;
  const ndc = new THREE.Vector2(
    (e.clientX / innerWidth) * 2 - 1,
    -(e.clientY / innerHeight) * 2 + 1,
  );
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const d = rc.ray.direction;
  const o = rc.ray.origin;
  atirar(o.x, o.y, o.z, d.x, d.y, d.z, 5, 1);
});
addEventListener(
  "wheel",
  (e) => {
    raioOrb = Math.max(8, Math.min(500, raioOrb * (1 + Math.sign(e.deltaY) * 0.1)));
    posicionar();
  },
  { passive: true },
);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------------------------------------------------------- botões -- */
const medidas = document.getElementById("medidas");
function medir() {
  medidas.textContent =
    `impactos: ${campo.impactos.length}   chunks: ${campo.chunks.size}\n` +
    `triângulos: ${Math.round(malha.triangulos).toLocaleString("pt-BR")}\n` +
    `entulho: ${entulho.n}   rochas de pé: ${rochas.vivas()}/${rochas.n}`;
}

let ultimoTunel = null;

document.getElementById("hud").addEventListener("click", (e) => {
  const a = e.target.dataset?.a;
  if (!a) return;
  if (a === "cima") {
    atirar(10, 90, 12, 0, -1, 0, 6, 8);
  } else if (a === "lado") {
    const y = campo.alturaBase(0, -66) - 16;
    atirar(0, y, 10, 0, 0, -1, 6, 14);
    ultimoTunel = { x: 0, y, z: -30 };
  } else if (a === "morro") {
    const y = campo.alturaBase(-38, -30) - 18;
    atirar(-95, y, -30, 1, 0, 0, 5, 16);
    ultimoTunel = { x: -60, y, z: -30 };
  } else if (a === "rajada") {
    for (let k = 0; k < 10; k++) {
      atirar(-30 + k * 7, 80, 30 - k * 3, 0.1, -1, -0.15, 4.5, 1);
    }
  } else if (a === "dentro") {
    if (!ultimoTunel) return;
    livre = true;
    camera.position.set(ultimoTunel.x, ultimoTunel.y, ultimoTunel.z + 34);
    camera.lookAt(ultimoTunel.x, ultimoTunel.y, ultimoTunel.z - 40);
  } else if (a === "orbita") {
    livre = false;
    posicionar();
  } else if (a === "limpar") {
    location.reload();
  }
  medir();
});

/* ----------------------------------------------------------------- quadro -- */
let tAnt = performance.now();
renderer.setAnimationLoop(() => {
  const agora = performance.now();
  const dt = Math.min(0.05, (agora - tAnt) / 1000);
  tAnt = agora;
  malha.passo(2);
  entulho.update(dt);
  rochas.update(dt);
  renderer.render(scene, camera);
});

/* Aberto ao console: é bancada, e mexer nos números daqui é o ponto dela.
   `passos` existe porque nem todo painel de inspeção roda `requestAnimationFrame`. */
globalThis.__cratera = {
  scene,
  camera,
  renderer,
  campo,
  malha,
  entulho,
  rochas,
  atirar,
  medir,
  olhar(px, py, pz, ax, ay, az) {
    livre = true;
    camera.position.set(px, py, pz);
    camera.lookAt(ax, ay, az);
  },
  quadro(segundos = 0) {
    malha.tudo();
    /* Adianta a física do entulho, para a foto sair com a pedra já pousada. */
    for (let i = 0; i < Math.round(segundos * 60); i++) {
      entulho.update(1 / 60);
      rochas.update(1 / 60);
    }
    renderer.render(scene, camera);
    medir();
    return {
      tris: Math.round(malha.triangulos),
      impactos: campo.impactos.length,
      entulho: entulho.n,
      rochas: rochas.vivas() + "/" + rochas.n,
    };
  },
};

medir();
console.log(
  `bancada pronta. arena ${METADE * 2} m, voxel ${VOXEL} m, ${Math.round(malha.triangulos).toLocaleString("pt-BR")} triângulos`,
);
