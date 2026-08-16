/* ---------------------------------------------------------------------------
   FASE CRATERA — a bancada jogável.

   Ferramenta de desenvolvimento, fora do jogo: não encosta em `lobby.js` nem em
   `main.js`, e é de propósito — é o que garante risco zero para quem está
   trabalhando no jogo agora.

   O que ela é: um lutador em primeira pessoa numa arena de 160 m, atirando
   poderes que escavam o terreno em tempo real. Tudo o que acontece aqui — a
   forma da bacia, o entulho, a rocha que cai, o teto que desaba — é o mesmo
   código que uma fase de verdade rodaria. O que ela substitui é o que está em
   volta: não há rede, não há inimigo, não há vida.

   ------------------------------------------------------------- em tempo real

   Três coisas precisam ser verdade ao mesmo tempo para isto não travar:

   • **A malha é fatiada por TEMPO.** Um tiro suja vários pedaços de uma vez, e
     um pedaço atravessado por túnel custa dez milissegundos. `passoTempo` gasta
     o que couber no quadro e devolve o resto para o seguinte.
   • **A escavação acontece no quadro do tiro.** A física do buraco não pode
     esperar a malha: o jogador entra no furo antes de ele terminar de aparecer,
     e isso é melhor do que o contrário.
   • **O desabamento é avaliado no impacto**, nunca por quadro. Ele varre uma
     grade de colunas, e isso é caro demais para acontecer sessenta vezes por
     segundo — e desnecessário, porque nada muda entre dois tiros.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CampoCratera, VOXEL, NC, METADE, FUNDO, TETO_MUNDO } from "../src/cratera/campo.js";
import { MalhaCratera } from "../src/cratera/malha.js";
import { Entulho } from "../src/cratera/entulho.js";
import { Rochas } from "../src/cratera/rochas.js";
import { Poderes } from "../src/cratera/poderes.js";
import { Lutador, ALTURA } from "../src/cratera/lutador.js";
import { avaliarDesabamento } from "../src/cratera/desabar.js";

/* ------------------------------------------------------------------ cena -- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#8fc4e8");
scene.fog = new THREE.Fog("#8fc4e8", 190, 480);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.2, 1200);

scene.add(new THREE.HemisphereLight(0xcfe6f2, 0x4a4238, 1.1));
const sol = new THREE.DirectionalLight(0xfff2d8, 2.1);
sol.position.set(-90, 130, 70);
scene.add(sol);
/* Uma luz fraca por baixo, para a parede do túnel não virar breu absoluto.
   Numa fase de verdade quem faria isso é o ki de quem está atirando. */
const contra = new THREE.DirectionalLight(0x6a7c88, 0.45);
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

const C0 = Math.floor(-METADE / (NC * VOXEL));
const C1 = Math.floor(METADE / (NC * VOXEL));
const CY0 = Math.floor(FUNDO / (NC * VOXEL));
const CY1 = Math.floor(TETO_MUNDO / (NC * VOXEL));
malha.sujarCaixa(C0, CY0, C0, C1, CY1, C1);
console.time("malha inicial");
malha.tudo();
console.timeEnd("malha inicial");

const entulho = new Entulho(raiz, campo);
const rochas = new Rochas(raiz, campo, entulho);

/* ------------------------------------------------------------- escavar ---- */
let proxId = 1;
let desabamentos = 0;

/**
 * O caminho ÚNICO por onde toda escavação passa — tiro, desabamento, tudo.
 *
 * Ter um só é o que mantém a lista de impactos íntegra: é ela que viaja na rede
 * (§11 do plano), e uma escavação que entrasse por fora dela seria um pedaço de
 * terreno que existe numa máquina e não na outra.
 */
function escavar(imp) {
  const c = campo.escavar({ id: proxId++, ...imp });
  if (!c) return null;

  /* A ordem importa: as pedras primeiro (algumas viram entulho), depois o
     estouro da própria cratera, depois sacudir o entulho que já estava pousado
     e acabou de perder o chão. */
  rochas.aplicar(c);
  entulho.estourar(c, Math.round(10 + c.R * 2));
  entulho.sacudir(c.cx, c.cy, c.cz, c.alcance + 6);

  /* O DESABAMENTO fica PENDENTE, e é avaliado no quadro — nunca aqui.
   *
   * Dois motivos, e o primeiro custou uma página travada. Um feixe dispara vinte
   * e oito escavações no mesmo instante, e avaliar apoio vinte e oito vezes é
   * varrer a mesma montanha vinte e oito vezes para chegar à mesma conclusão. O
   * segundo: o desabamento tem de olhar o túnel PRONTO. Avaliado na primeira
   * bacia, ele julgaria uma montanha que ainda não foi furada.
   *
   * E só para escavação de GOLPE: um desabamento que avaliasse desabamento se
   * alimentaria em cascata até a montanha inteira sumir. */
  if (!imp.desabamento) pendente = c;
  return c;
}

/** A última escavação de golpe, esperando avaliação de apoio. */
let pendente = null;
let esperaDesabar = 0;

/** Avalia o apoio, no máximo uma vez a cada meio segundo. */
function talvezDesabar(dt) {
  esperaDesabar -= dt;
  if (!pendente || esperaDesabar > 0) return;
  const c = pendente;
  pendente = null;
  esperaDesabar = 0.5;

  const quedas = avaliarDesabamento(campo, c, () => proxId++);
  if (quedas.length === 0) return;
  desabamentos++;
  for (const q of quedas) {
    const cq = campo.escavar(q);
    if (!cq) continue;
    rochas.aplicar(cq);
    /* Desabamento solta MUITO entulho: é a leitura inteira do evento. */
    entulho.estourar(cq, Math.round(24 + cq.R * 3));
    entulho.sacudir(cq.cx, cq.cy, cq.cz, cq.alcance + 10);
  }
}

const poderes = new Poderes(raiz, campo, escavar);

/* ---------------------------------------------------------------- jogador -- */
const eu = new Lutador(campo);
eu.position.x = 0;
eu.position.z = 46;
eu.position.y = campo.alturaBase(0, 46) + 24;
eu.yaw = Math.PI;

const acao = { frente: 0, lado: 0, cima: 0, correr: false, pular: false, voar: false };
const teclas = new Set();

addEventListener("keydown", (e) => {
  teclas.add(e.code);
  if (e.code === "KeyF") eu.voando = !eu.voando;
  if (e.code === "KeyR") reiniciar();
  if (e.code === "Space") e.preventDefault();
});
addEventListener("keyup", (e) => teclas.delete(e.code));

function lerTeclas() {
  acao.frente = (teclas.has("KeyW") ? 1 : 0) - (teclas.has("KeyS") ? 1 : 0);
  acao.lado = (teclas.has("KeyD") ? 1 : 0) - (teclas.has("KeyA") ? 1 : 0);
  acao.cima = (teclas.has("Space") ? 1 : 0) - (teclas.has("ControlLeft") ? 1 : 0);
  acao.correr = teclas.has("ShiftLeft");
  acao.pular = teclas.has("Space");
  acao.voar = false;
}

/* A mira por PONTEIRO TRAVADO: é o que faz isto ser jogar em vez de arrastar. */
renderer.domElement.addEventListener("click", () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});
addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  eu.yaw -= e.movementX * 0.0022;
  eu.pitch = Math.max(-1.5, Math.min(1.5, eu.pitch - e.movementY * 0.0022));
});

let recarga = 0;
addEventListener("mousedown", (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (recarga > 0) return;
  const o = eu.olhos();
  const d = eu.mira();
  /* Nasce um pouco à frente do rosto: nascer no olho faria o primeiro passo
     acontecer dentro da própria cabeça quando se atira encostado na parede. */
  const ox = o.x + d.x * 1.2;
  const oy = o.y + d.y * 1.2;
  const oz = o.z + d.z * 1.2;
  if (e.button === 0) {
    poderes.disparar("bola", ox, oy, oz, d.x, d.y, d.z);
    recarga = 0.16;
  } else if (e.button === 2) {
    poderes.disparar("feixe", ox, oy, oz, d.x, d.y, d.z);
    recarga = 0.75;
  }
});
addEventListener("contextmenu", (e) => e.preventDefault());

function reiniciar() {
  eu.position.x = 0;
  eu.position.z = 46;
  eu.position.y = campo.alturaBase(0, 46) + 24;
  eu.velocity.x = eu.velocity.y = eu.velocity.z = 0;
  eu.voando = true;
}

/* ------------------------------------------------------------------- hud -- */
const hud = document.getElementById("hud");
const medidas = document.getElementById("medidas");
let fps = 60;

function medir() {
  const p = eu.position;
  medidas.textContent =
    `fps ${fps.toFixed(0)}   fila de malha ${malha.fila.length}\n` +
    `impactos ${campo.impactos.length}   desabamentos ${desabamentos}\n` +
    `triângulos ${Math.round(malha.triangulos).toLocaleString("pt-BR")}\n` +
    `entulho ${entulho.n}   rochas ${rochas.vivas()}/${rochas.n}\n` +
    `você (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}) ${eu.voando ? "voando" : eu.noChao ? "no chão" : "caindo"}`;
}

/* ---------------------------------------------------------------- quadro --- */
let tAnt = performance.now();
let acumFps = 0;
let quadros = 0;

renderer.setAnimationLoop(() => {
  const agora = performance.now();
  const dt = Math.min(0.05, (agora - tAnt) / 1000);
  tAnt = agora;
  if (recarga > 0) recarga -= dt;

  lerTeclas();
  eu.update(dt, acao);
  poderes.update(dt);
  entulho.update(dt);
  rochas.update(dt);
  talvezDesabar(dt);
  /* A malha por último e por TEMPO: o que não couber neste quadro vai para o
     próximo. É isto que impede o tiro de engasgar a imagem. */
  malha.passoTempo(7);

  const o = eu.olhos();
  camera.position.set(o.x, o.y, o.z);
  const d = eu.mira();
  camera.lookAt(o.x + d.x, o.y + d.y, o.z + d.z);

  renderer.render(scene, camera);

  acumFps += 1 / Math.max(0.001, dt);
  if (++quadros >= 20) {
    fps = acumFps / quadros;
    acumFps = 0;
    quadros = 0;
    medir();
  }
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* Aberto ao console: é bancada. */
globalThis.__cratera = {
  scene,
  camera,
  renderer,
  campo,
  malha,
  entulho,
  rochas,
  poderes,
  eu,
  escavar,
  medir,
  /** Põe o jogador em algum lugar, olhando para algum lugar. */
  por(px, py, pz, yaw = eu.yaw, pitch = eu.pitch) {
    eu.position.x = px;
    eu.position.y = py;
    eu.position.z = pz;
    eu.velocity.x = eu.velocity.y = eu.velocity.z = 0;
    eu.yaw = yaw;
    eu.pitch = pitch;
    eu.voando = true;
  },
  /** Adianta `segundos` de simulação e desenha. Para inspeção sem rAF. */
  correr(segundos = 1) {
    const passos = Math.round(segundos * 60);
    for (let i = 0; i < passos; i++) {
      lerTeclas();
      eu.update(1 / 60, acao);
      poderes.update(1 / 60);
      entulho.update(1 / 60);
      rochas.update(1 / 60);
      talvezDesabar(1 / 60);
    }
    malha.tudo();
    const o = eu.olhos();
    camera.position.set(o.x, o.y, o.z);
    const d = eu.mira();
    camera.lookAt(o.x + d.x, o.y + d.y, o.z + d.z);
    renderer.render(scene, camera);
    medir();
    return {
      tris: Math.round(malha.triangulos),
      impactos: campo.impactos.length,
      desabamentos,
      entulho: entulho.n,
      rochas: rochas.vivas() + "/" + rochas.n,
      pos: [eu.position.x.toFixed(1), eu.position.y.toFixed(1), eu.position.z.toFixed(1)],
    };
  },
  /** Atira daqui, na direção da mira. */
  atirar(tipo = "bola") {
    const o = eu.olhos();
    const d = eu.mira();
    poderes.disparar(tipo, o.x + d.x * 1.2, o.y + d.y * 1.2, o.z + d.z * 1.2, d.x, d.y, d.z);
  },
};

medir();
console.log(
  `bancada pronta. arena ${METADE * 2} m, voxel ${VOXEL} m, ${Math.round(malha.triangulos).toLocaleString("pt-BR")} triângulos`,
);
