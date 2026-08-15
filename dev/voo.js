/* ---------------------------------------------------------------------------
   Bancada de voo — ferramenta de desenvolvimento, fora do jogo.

   Um lutador (ou quatro) cruzando o céu de Namekusei num trajeto conhecido, com
   a câmera PARADA do lado. É onde se julga a aura de voo e a cauda de ki, e ela
   existe porque dentro do jogo isso é quase impossível: a lente de perseguição
   fica atrás do lutador e em cima da própria cauda, então a única coisa que se
   enxerga da própria esteira é a ponta dela vindo na direção do olho. A
   referência do efeito é um plano de FORA — o pelotão passando de lado —, e é
   esse plano que esta página devolve.

   Ela importa o `Fighter` DE VERDADE. O que ela substitui é só o que está em
   volta: o mundo vira um domo de gradiente, não há física, não há rede, e o
   trajeto é uma fórmula. Tudo o que aparece aqui — pose, aura, casulo, cauda —
   é o mesmo código que a sala roda.

   DOIS CUIDADOS que a bancada de skins já tinha ensinado, e que valem em dobro
   para um efeito ADITIVO:

   • **o mesmo pipeline de cor.** ACES com exposição 1,05, `SRGBColorSpace`.
     Aditivo julgado sob outro tone mapping mente na direção mais cara: satura
     em branco aqui e sai apagado lá, ou o contrário.
   • **o mesmo FUNDO.** O céu do Namek é lima claro, e o que decide se a cauda
     lê como energia ou como papel é o quanto ela soma SOBRE esse verde. Julgar
     ki branco contra um fundo escuro de estúdio é não julgar nada.

   E o passo de tempo é FIXO (1/60) com ACUMULADOR, não o relógio de parede. A
   diferença importa porque a aba em segundo plano é estrangulada pelo navegador
   e pode cair a dois quadros por segundo: com dt real o voo sairia aos trancos e
   a cauda — que amostra a trajetória a cada 28 ms — sairia com quatro pontos. Com
   o acumulador, cada quadro desenhado põe em dia o tempo que passou de verdade,
   em passos de 1/60, e a imagem é a MESMA que se veria a 60 Hz.

   Aberta em /dev/voo.html com o servidor de desenvolvimento rodando. Não entra
   no build de produção: o Vite só empacota o que a página de entrada alcança.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { Fighter } from "../src/namek/character/index.js";
import { NAMEK } from "../src/shared/namek/config.js";
import { clamp, damp } from "../src/utils/math.js";

/* ------------------------------------------------------------------- cena --- */

const cena = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.15, 4000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

/* O céu, com as cores de `world/sky.js` (o clima "dia"). Um domo com gradiente
   de vértice: é a metade do céu do jogo que importa para julgar aditivo — a
   luminância do fundo. */
const domo = new THREE.Mesh(
  new THREE.SphereGeometry(2000, 24, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color("#1f9e46") },
      horizonte: { value: new THREE.Color("#9fd862") },
      chao: { value: new THREE.Color("#79b98d") },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 horizonte; uniform vec3 chao; varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        vec3 c = h > 0.0 ? mix(horizonte, zenith, pow(h, 1.7)) : mix(horizonte, chao, min(1.0, -h * 3.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }),
);
cena.add(domo);

const sol = new THREE.DirectionalLight(new THREE.Color("#fff0cc"), 3.0);
sol.position.set(120, 200, 90);
cena.add(sol);
cena.add(new THREE.HemisphereLight(new THREE.Color("#a8f0b6"), new THREE.Color("#2f6b52"), 0.62));

/* Uma grade no chão: sem uma referência parada, um lutador voando a 96 m/s
   contra um céu liso parece parado. É a grade que dá a velocidade. */
const grade = new THREE.GridHelper(1600, 80, 0x3f7f5a, 0x357049);
grade.position.y = -60;
grade.material.transparent = true;
grade.material.opacity = 0.55;
cena.add(grade);

/* ------------------------------------------------------------- os lutadores -- */

const CORES = [0xff7a1a, 0x4aa8ff, 0x9b6cff, 0x3ad07a];
/** m — deslocamento de cada um dentro do esquadrão: atrás e ao lado. */
const FORMACAO = [
  [0, 0, 0],
  [-4.5, -1.6, 7],
  [4.2, 1.4, 8.5],
  [-1.5, 2.6, 15],
];

const postos = CORES.map((cor, i) => {
  const f = new Fighter(cena, cor, false);
  f.displayName = null;
  f.flyBlend = 1;
  if (i > 0) f.root.visible = false;
  return { f, cor, i };
});

/* ------------------------------------------------------------------ estado -- */

const est = {
  trajeto: "reta",
  vel: 34,
  giro: 0,
  dist: 26,
  camera: "lado",
  esquadrao: false,
  carga: false,
  pausa: false,
  t: 0,
};

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _ant = new THREE.Vector3();

/**
 * Onde o lutador está no instante `t`, e a velocidade ali.
 *
 * A velocidade sai da DERIVADA NUMÉRICA da posição, e não de uma fórmula à
 * parte: é o mesmo contrato do jogo (o dono escreve `position` e `velocity` e os
 * dois têm de concordar), e uma velocidade que discorda do deslocamento é
 * exatamente o defeito que esta bancada existe para pegar.
 */
function caminho(t, out) {
  const v = est.vel;
  switch (est.trajeto) {
    case "circulo": {
      /* Raio proporcional à velocidade: uma curva de raio fixo a 96 m/s seria
         um giro de 6 g, e o que se quer ver é a cauda ACOMPANHANDO a curva. */
      const r = Math.max(40, v * 2.2);
      const a = (v / r) * t;
      out.set(Math.cos(a) * r, Math.sin(a * 0.7) * 6, Math.sin(a) * r);
      break;
    }
    case "onda": {
      const s = v * t;
      out.set(Math.sin(s * 0.02) * 34, Math.sin(s * 0.035) * 12, -s + 400);
      break;
    }
    case "parado":
      out.set(0, Math.sin(t * 0.8) * 0.6, 0);
      break;
    default: {
      // Reta: ele atravessa o quadro e volta ao começo, para sempre.
      const s = ((v * t) % 900) - 450;
      out.set(0, 0, -s);
      break;
    }
  }
  return out;
}

const DT = 1 / 60;

function passo() {
  est.t += DT;

  for (const posto of postos) {
    const { f, i } = posto;
    if (!f.root.visible) continue;

    /* Cada um do esquadrão voa o MESMO caminho, atrasado no tempo — é assim que
       uma formação se comporta de verdade, e é o que faz as caudas ficarem
       paralelas em vez de empilhadas. */
    const atraso = est.esquadrao ? (FORMACAO[i][2] / Math.max(1, est.vel)) : 0;
    caminho(est.t - atraso, _p);
    caminho(est.t - atraso - DT, _ant);
    _v.subVectors(_p, _ant).divideScalar(DT);

    _p.x += FORMACAO[i][0];
    _p.y += FORMACAO[i][1] + 40;

    f.position.x = _p.x;
    f.position.y = _p.y;
    f.position.z = _p.z;
    f.velocity.x = _v.x;
    f.velocity.y = _v.y;
    f.velocity.z = _v.z;

    const plano = Math.hypot(_v.x, _v.z);
    if (plano > 0.2) {
      /* Convenção de `movement.js`: a frente do corpo é (−sin yaw, −cos yaw). */
      f.yaw = Math.atan2(-_v.x, -_v.z);
      f.pitch = Math.atan2(_v.y, plano);
    }
    /* A rolagem forçada é o TESTE do pedido: "o poder sempre tem que ficar em
       volta do player, independente da posição que ele gire e vá". Com o giro
       no talo, o corpo capota sem parar e nem o casulo nem a cauda podem
       acompanhar — a cauda fica no rastro, que é onde o rastro fica. */
    f.roll = est.giro > 0 ? est.t * est.giro : clamp(-_v.x * 0.004, -0.6, 0.6);

    const rapido = clamp((est.vel - NAMEK.fighter.flySpeed) / 40, 0, 1);
    f.flyBlend = est.carga ? 0 : 1;
    f.boostBlend = est.carga ? 0 : rapido;
    f.chargeBlend = est.carga ? 1 : 0;

    f.update(DT, camera.position);
  }

  posicionarCamera();
}

function posicionarCamera() {
  const alvo = postos[0].f;
  const p = alvo.position;
  const d = est.dist;
  /* A lente segue o alvo com atraso: uma câmera colada em quem passa a 96 m/s
     esconde justamente a velocidade que se quer julgar. */
  const c = camera.position;
  let ax = p.x;
  let ay = p.y;
  let az = p.z;
  const c1 = Math.cos(alvo.yaw);
  const s1 = Math.sin(alvo.yaw);
  if (est.camera === "lado") {
    ax = p.x + c1 * d;
    az = p.z - s1 * d;
    ay = p.y + d * 0.12;
  } else if (est.camera === "tras") {
    ax = p.x + s1 * d;
    az = p.z + c1 * d;
    ay = p.y + d * 0.18;
  } else if (est.camera === "frente") {
    ax = p.x - s1 * d;
    az = p.z - c1 * d;
    ay = p.y + d * 0.1;
  } else {
    ax = p.x;
    ay = p.y + d;
    az = p.z + d * 0.35;
  }
  c.set(ax, ay, az);
  camera.lookAt(p.x, p.y, p.z);
}

/* --------------------------------------------------------------- interface -- */

const eco = (nome, v) => {
  for (const el of document.querySelectorAll(`[data-eco="${nome}"]`)) el.textContent = v;
};

function faixa(id, campo, formata = (v) => v) {
  const el = document.getElementById(id);
  el.addEventListener("input", () => {
    est[campo] = parseFloat(el.value);
    eco(id, formata(est[campo]));
  });
  eco(id, formata(est[campo]));
}

faixa("vel", "vel");
faixa("giro", "giro", (v) => v.toFixed(1));
faixa("dist", "dist");

function grupo(prefixo, campo, valores) {
  const botoes = valores.map((v) => document.getElementById(`${prefixo}-${v}`));
  botoes.forEach((b, k) => {
    b.addEventListener("click", () => {
      est[campo] = valores[k];
      botoes.forEach((o, j) => o.classList.toggle("on", j === k));
      if (campo === "trajeto") for (const posto of postos) posto.f.aura.reset();
    });
  });
}

grupo("t", "trajeto", ["reta", "circulo", "onda", "parado"]);
grupo("c", "camera", ["lado", "tras", "frente", "cima"]);

function alterna(id, campo, aoMudar) {
  const b = document.getElementById(id);
  b.addEventListener("click", () => {
    est[campo] = !est[campo];
    b.classList.toggle("on", est[campo]);
    aoMudar?.();
  });
}

alterna("esquadrao", "esquadrao", () => {
  for (const posto of postos) {
    if (posto.i === 0) continue;
    posto.f.root.visible = est.esquadrao;
    posto.f.aura.reset();
  }
});
alterna("carga", "carga", () => {
  for (const posto of postos) posto.f.aura.reset();
});
alterna("pausa", "pausa");

const conta = document.getElementById("conta");
let contador = 0;

function relatar() {
  const info = renderer.info;
  const f = postos[0].f;
  const vel = Math.hypot(f.velocity.x, f.velocity.y, f.velocity.z);
  conta.innerHTML =
    `<b>${info.render.calls}</b> chamadas   <b>${(info.render.triangles / 1000).toFixed(1)}k</b> tri\n` +
    `velocidade real <b>${vel.toFixed(0)}</b> m/s\n` +
    `aura <b>${f.aura.intensidade.toFixed(2)}</b>   cauda <b>${f.aura._energia.toFixed(2)}</b>`;
}

/* ------------------------------------------------------------------ quadro -- */

/** Quantos passos de 1/60 um quadro desenhado pode pôr em dia. 1,5 s: o
 *  bastante para uma aba estrangulada não engasgar, pouco o bastante para uma
 *  parada longa (outra janela por cima) não devolver um salto absurdo. */
const PASSOS_MAX = 90;
let sobra = 0;
let relogio = performance.now();

function quadro() {
  requestAnimationFrame(quadro);
  const agora = performance.now();
  sobra += (agora - relogio) / 1000;
  relogio = agora;
  if (est.pausa) sobra = 0;
  let n = 0;
  while (sobra >= DT && n < PASSOS_MAX) {
    passo();
    sobra -= DT;
    n++;
  }
  if (sobra > DT) sobra = 0;
  renderer.render(cena, camera);
  if (++contador % 15 === 0 || n > 4) relatar();
}

/* Um punho para dirigir a bancada de fora — do console ou de uma ferramenta.
   `avancar(n)` roda n passos e desenha, que é como se tira uma sequência de
   quadros de um voo sem depender da cadência que o navegador resolver dar. */
window.__voo = {
  est,
  postos,
  avancar(n = 1) {
    for (let i = 0; i < n; i++) passo();
    renderer.render(cena, camera);
    relatar();
    return conta.textContent;
  },
};

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

quadro();
