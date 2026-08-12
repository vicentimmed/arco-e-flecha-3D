/* ---------------------------------------------------------------------------
   Bancada de skins — ferramenta de desenvolvimento, fora do jogo.

   Dois arqueiros lado a lado, o mesmo Sol, a mesma pose, e uma contagem de
   malhas embaixo. É onde se decide se uma fantasia nova ficou boa e se ela cabe
   no orçamento, sem precisar entrar numa sala nem carregar o vale.

   Ela importa o `Player` DE VERDADE, não uma cópia — é o mesmo corpo, a mesma
   IK e a mesma pose que o jogo monta. O que ela substitui é só o mundo em volta:
   o terreno vira um plano em y = 0 e a física não existe.

   Aberta em /dev/skins.html com o servidor de desenvolvimento rodando. Não entra
   no build de produção: o Vite só empacota o que a página de entrada alcança.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { Player } from "../src/entities/player.js";
import { SKINS } from "../src/entities/skins/index.js";
import { CONFIG } from "../src/config.js";
import { Ragdoll } from "../src/game/ragdoll.js";

/* O mundo mais simples que satisfaz o contrato do arqueiro: chão plano e
   caminhável em toda parte. O corpo não sabe a diferença. */
const terreno = {
  heightAt: () => 0,
  isWalkable: () => true,
};

const cena = new THREE.Scene();
cena.background = new THREE.Color("#8fbfe4"); // o azul do céu do vale

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 120);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
/* O TONE MAPPING é o item mais importante desta bancada, e o primeiro que eu
   esqueci. Sem ele as cores mentem: o ACES comprime as altas e dessatura o que
   é forte, e uma túnica que aqui parecia laranja fluorescente sai assentada no
   jogo. Julgar cor sob um pipeline diferente do de produção é pior do que não
   julgar — leva a "corrigir" o que não estava errado. */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.render.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

/* A luz do vale ao meio-dia, copiada NÚMERO A NÚMERO de `core/renderer.js`
   (`buildLights`): Sol quente 3,1, céu azul 0,5 com rebote de grama, e o
   preenchimento frio de 0,2 vindo do lado oposto para as sombras não chaparem.
   Um corpo bonito sob luz de estúdio não quer dizer nada. */
const sol = new THREE.DirectionalLight(0xfff0d2, 3.1);
sol.position.set(5, 8, 4);
sol.castShadow = true;
sol.shadow.mapSize.set(1024, 1024);
sol.shadow.bias = -0.0008;
sol.shadow.normalBias = 0.05;
sol.shadow.camera.near = 0.5;
sol.shadow.camera.far = 24;
for (const lado of ["left", "bottom"]) sol.shadow.camera[lado] = -3;
for (const lado of ["right", "top"]) sol.shadow.camera[lado] = 3;
cena.add(sol);
cena.add(new THREE.HemisphereLight(0xa8d3ff, 0x5d6142, 0.5));
const preenchimento = new THREE.DirectionalLight(0xbcd8ff, 0.2);
preenchimento.position.set(6, 4, -8);
cena.add(preenchimento);

const chao = new THREE.Mesh(
  new THREE.CircleGeometry(9, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: "#6f7d45", roughness: 0.95 }),
);
chao.receiveShadow = true;
cena.add(chao);

/* --------------------------------------------------------------- os corpos -- */

const SEPARACAO = 1.15; // m entre os dois arqueiros

/** Um posto: um arqueiro que pode trocar de fantasia sem sair do lugar. */
function criarPosto(x, skinId) {
  const player = new Player(terreno, 1, skinId);
  player.position.set(x, 0, 0);
  cena.add(player.root);
  /* O corpo mole nasce COM o arqueiro e é reaproveitado, exatamente como no
     jogo (ver `net/remotePlayers.js`): alocá-lo no instante da morte é
     justamente onde não se quer um soluço do coletor de lixo. */
  return { player, x, ragdoll: new Ragdoll(terreno) };
}

const postos = [
  criarPosto(-SEPARACAO, SKINS[0].id),
  criarPosto(SEPARACAO, SKINS[Math.min(1, SKINS.length - 1)].id),
];

/* ------------------------------------------------------------------ painel -- */

const estado = {
  draw: 0,
  pitch: 0,
  dist: 3.2,
  alt: 1.15,
  /** 0 = os dois enquadrados; 1 ou 2 = de perto, num deles só. */
  foco: 0,
  /* Para onde os corpos estão virados (rad). O botão `girar` avança isto; com
     ele desligado, dá para parar num ângulo e comparar as duas skins lado a
     lado no MESMO ângulo, que é a única comparação que vale. */
  yaw: 0,
  andar: false,
  correr: false,
  girar: true,
  recarregar: false,
  faca: false,
  cor: true,
  cinza: false,
  chapado: false,
  primeira: false,
  /** null = automático pela distância; 0/1/2 = forçado. */
  nivel: null,
};

const CORES = ["#4aa3df", "#e0663c"];

function montarBotoesDeSkin(idDiv, indicePosto) {
  const div = document.getElementById(idDiv);
  for (const skin of SKINS) {
    const b = document.createElement("button");
    b.textContent = skin.label;
    b.onclick = () => {
      postos[indicePosto].player.setSkin(skin.id);
      aplicarCor();
      for (const irmao of div.children) irmao.classList.remove("on");
      b.classList.add("on");
      atualizarConta();
    };
    if (skin.id === postos[indicePosto].player.skin.id) b.classList.add("on");
    div.appendChild(b);
  }
}
montarBotoesDeSkin("skinA", 0);
montarBotoesDeSkin("skinB", 1);

function aplicarCor() {
  postos.forEach((p, i) => {
    if (estado.cor) p.player.setColor(CORES[i]);
  });
}
aplicarCor();

for (const id of ["draw", "pitch", "dist", "alt"]) {
  const input = document.getElementById(id);
  const eco = document.querySelector(`[data-eco="${id}"]`);
  const sincronizar = () => {
    estado[id] = parseFloat(input.value);
    eco.textContent = input.value;
  };
  input.addEventListener("input", sincronizar);
  sincronizar();
}

/* Enquadramentos guardados. Os três testes do plano que se fazem com a câmera —
   a silhueta de longe, o rosto de perto e o corpo inteiro — viram um clique, e
   é isso que torna a comparação entre duas skins uma comparação de verdade: o
   mesmo ângulo, a mesma distância, os dois lados. */
const ENQUADRAMENTOS = {
  corpo: { dist: 3.2, alt: 1.0, foco: 0 },
  /* A cabeça de frente para a câmera NÃO é `yaw = π`.
     O tronco gira +`stanceYaw` e a cabeça desfaz 86 % disso, então o rosto sai
     apontando 0,14·stanceYaw = 0,162 rad ADIANTE do corpo — e o enquadramento
     tem de descontar isso, não somar. É a mesma razão de uma captura feita "de
     frente para o corpo" pegar o arqueiro olhando de esguelha. */
  rosto: { dist: 0.55, alt: 1.63, foco: 1, yaw: Math.PI - 0.162 },
  perfil: { dist: 0.8, alt: 1.6, foco: 1, yaw: Math.PI / 2 - 0.162 },
  tronco: { dist: 1.5, alt: 1.25, foco: 1, yaw: Math.PI - 0.162 },
  longe: { dist: 9, alt: 1.4, foco: 0 },
};
window.enquadrar = (nome, lado = 1) => {
  const e = ENQUADRAMENTOS[nome];
  if (!e) return Object.keys(ENQUADRAMENTOS);
  if (e.yaw != null) {
    estado.yaw = e.yaw;
    estado.girar = false;
    document.getElementById("girar").classList.remove("on");
  }
  estado.dist = e.dist;
  estado.alt = e.alt;
  estado.foco = e.foco && lado;
  for (const id of ["dist", "alt"]) {
    const input = document.getElementById(id);
    input.value = estado[id];
    document.querySelector(`[data-eco="${id}"]`).textContent = input.value;
  }
  return nome;
};

/* O TOMBO. É o teste que mais depende de a skin ter entregado todos os handles:
   `poseRagdoll` mexe em cabeça, braços, pernas e balanço de uma vez, e uma peça
   faltando aparece aqui antes de aparecer em qualquer outro lugar. */
document.getElementById("morrer").onclick = () => {
  for (const posto of postos) {
    const p = posto.player;
    if (p.ragdoll) {
      posto.ragdoll.stop();
      p.ragdoll = null;
      p.deathFall = 0;
      continue;
    }
    p.ragdoll = posto.ragdoll;
    posto.ragdoll.begin(p.position, p.yaw, null, null);
  }
  document.getElementById("morrer").classList.toggle("on");
};

/* As três chaves de julgamento. `cinza` é do canvas (CSS), `chapado` troca
   material e `primeira` troca a câmera — nenhuma delas mexe na skin. */
for (const id of ["cinza", "chapado", "primeira"]) {
  const b = document.getElementById(id);
  b.onclick = () => {
    estado[id] = !estado[id];
    b.classList.toggle("on", estado[id]);
    if (id === "cinza") document.body.classList.toggle("cinza", estado.cinza);
    if (id === "chapado") aplicarChapado(estado.chapado);
    if (id === "primeira") {
      // A cabeça some em primeira pessoa, como no jogo — senão a câmera fica
      // dentro dela.
      for (const posto of postos) posto.player.setHeadVisible(!estado.primeira);
      atualizarConta();
    }
  };
}

/* O NÍVEL DE DETALHE, forçado. Serve a uma pergunta só: algum corte abre
   BURACO? Uma peça de detalhe tem de sumir por cima de uma forma que continua
   ali — e o jeito de conferir isso é olhar os três níveis parados, não esperar
   um jogador se afastar. */
for (const nivel of ["auto", "0", "1", "2"]) {
  const b = document.getElementById(`nivel-${nivel}`);
  b.onclick = () => {
    estado.nivel = nivel === "auto" ? null : Number(nivel);
    for (const outro of ["auto", "0", "1", "2"]) {
      document.getElementById(`nivel-${outro}`).classList.toggle("on", outro === nivel);
    }
    document.querySelector('[data-eco="nivel"]').textContent =
      nivel === "auto" ? "automático" : ["perto", "médio", "longe"][Number(nivel)];
    atualizarConta();
  };
}

for (const id of ["andar", "correr", "girar", "recarregar", "faca", "cor"]) {
  const b = document.getElementById(id);
  b.classList.toggle("on", estado[id]);
  b.onclick = () => {
    estado[id] = !estado[id];
    b.classList.toggle("on", estado[id]);
    if (id === "cor") {
      // Tirar a cor não desfaz o tingimento (os materiais já foram pintados);
      // remontar o corpo é o jeito honesto de ver o uniforme padrão de novo.
      for (const p of postos) {
        const skin = p.player.skin.id;
        p.player.setSkin(skin === SKINS[0].id ? SKINS[1]?.id ?? skin : SKINS[0].id);
        p.player.setSkin(skin);
      }
      aplicarCor();
    }
  };
}

/* ------------------------------------------------- como julgar um corpo -----
 *
 * Três chaves e uma régua. Elas existem porque a primeira tentativa de arqueiro
 * medieval passou por mim inteira sem que eu visse o defeito: julguei EM COR, DE
 * PERTO e UMA FIGURA DE CADA VEZ — as três condições em que o defeito dela era
 * invisível. Em cinza, a 40 m e ao lado da arqueira, ele salta.
 */

/** Preto fosco, sem luz: o corpo vira recorte. */
const MATERIAL_CHAPADO = new THREE.MeshBasicMaterial({ color: 0x101014 });

/**
 * A SILHUETA CHAPADA. Troca todo material do corpo por preto sem iluminação e o
 * fundo pelo céu claro.
 *
 * É o teste dos quarenta metros destilado: sem cor, sem sombreado e sem
 * material, sobra só a FORMA — que é literalmente tudo o que se vê de longe. Um
 * corpo que não se distingue aqui não se distingue no jogo, e nenhuma paleta
 * conserta isso depois.
 *
 * Os materiais originais são guardados na própria malha, e não numa tabela à
 * parte: assim uma troca de skin no meio do teste não deixa nada órfão.
 */
function aplicarChapado(ligado) {
  for (const posto of postos) {
    posto.player.root.traverse((o) => {
      if (!o.isMesh) return;
      if (ligado) {
        if (!o.userData.matOriginal) o.userData.matOriginal = o.material;
        o.material = MATERIAL_CHAPADO;
      } else if (o.userData.matOriginal) {
        o.material = o.userData.matOriginal;
        o.userData.matOriginal = null;
      }
    });
  }
  cena.background.set(ligado ? "#dce9f5" : "#8fbfe4");
  chao.visible = !ligado;
}

/**
 * Luminância relativa — o que o olho lê como claro ou escuro.
 *
 * SEM conversão de espaço, e isto é o oposto do que parece certo: com a gestão
 * de cor ligada, `THREE.Color` já guarda o valor LINEAR (o `.set("#e8dfc4")`
 * converte na entrada). Aplicar a curva do sRGB aqui converteria de novo, e a
 * primeira versão desta régua fazia exatamente isso — dava 0,51 onde o valor é
 * 0,74, e teria me feito "corrigir" uma paleta que estava certa.
 */
function luminancia(cor) {
  return 0.2126 * cor.r + 0.7152 * cor.g + 0.0722 * cor.b;
}

/**
 * A RÉGUA DE VALOR, lida dos materiais VIVOS do corpo.
 *
 * Mede as três coisas que separaram a arqueira (que funciona) da primeira
 * tentativa de medieval (que virou uma coluna marrom):
 *
 *   • AMPLITUDE — quantas vezes o material mais claro é mais claro que o mais
 *     escuro. A arqueira tem 43×; a v1 tinha 17×.
 *   • FAIXA MÉDIA — quantas peças caem entre 0,05 e 0,25, onde tudo vira a
 *     mesma coisa a quarenta metros. A arqueira tem 4 de 8; a v1 tinha 7 de 11.
 *   • ÂNCORA CLARA — existe alguma peça acima de 0,6? A arqueira tem os tênis
 *     em 0,82. A v1 não tinha nada acima de 0,41, e é por isso que ela não
 *     tinha onde o olho pousar.
 */
function reguaDeValor(player) {
  /* Mede só os materiais que SOBREVIVEM ao corte de distância.
   *
   * Íris, boca e fivela têm luminâncias extremas e área quase zero — incluí-las
   * dá uma amplitude de 800× que não quer dizer nada, porque a 40 m elas nem
   * são desenhadas. A estrutura de valor que importa é a das peças que ainda
   * existem quando o corpo já é um contorno, e essas são exatamente as que não
   * estão em nenhum dos dois níveis de detalhe. */
  const efemeros = new Set([...player.detail.perto, ...player.detail.medio]);
  const estruturais = new Set();
  player.root.traverse((o) => {
    if (o.isMesh && o.material && !efemeros.has(o)) estruturais.add(o.material);
  });

  const linhas = [];
  for (const [nome, m] of Object.entries(player.mat)) {
    if (!m?.color || !estruturais.has(m)) continue;
    linhas.push({ nome, L: luminancia(m.color), hex: "#" + m.color.getHexString() });
  }
  linhas.sort((a, b) => b.L - a.L);
  const Ls = linhas.map((l) => l.L);
  const amplitude = Math.max(...Ls) / Math.max(1e-4, Math.min(...Ls));
  const naFaixaMedia = Ls.filter((L) => L >= 0.05 && L <= 0.25).length;
  const ancora = Math.max(...Ls);
  return { linhas, amplitude, naFaixaMedia, ancora, total: Ls.length };
}

function desenharRegua() {
  const partes = postos.map((posto) => {
    const p = posto.player;
    const r = reguaDeValor(p);
    const corpo = r.linhas
      .map((l) => {
        const barra = "█".repeat(Math.max(1, Math.round(l.L * 26)));
        return `  ${l.nome.padEnd(13).slice(0, 13)} ${l.L.toFixed(3)} ${barra}`;
      })
      .join("\n");
    const marca = (ok, txt) => `<span class="${ok ? "ok" : "ruim"}">${txt}</span>`;
    return [
      `${p.skin.label}`,
      corpo,
      "  " +
        marca(r.amplitude >= 40, `amplitude ${r.amplitude.toFixed(0)}×`) +
        " · " +
        marca(r.naFaixaMedia <= 2, `faixa média ${r.naFaixaMedia}/${r.total}`) +
        " · " +
        marca(r.ancora >= 0.6, `âncora ${r.ancora.toFixed(2)}`),
    ].join("\n");
  });
  document.getElementById("regua").innerHTML = partes.join("\n\n");
}

/* ------------------------------------------------------------------- conta -- */

/**
 * O que o corpo custa.
 *
 * `visiveis` é o número que importa e `malhas` é o que existe — a diferença
 * entre os dois é o LOD trabalhando. Uma peça invisível não vira chamada de
 * desenho: o Three a descarta antes de qualquer coisa, e é por isso que a
 * mochila do jetpack pode nascer sempre e ficar escondida fora da Lua.
 *
 * A visibilidade é HERDADA, então não basta olhar a própria malha: um dedo
 * dentro de uma mão invisível não desenha. Daí subir a árvore até o `root`.
 */
function contar(player) {
  let malhas = 0;
  let visiveis = 0;
  let sombras = 0;
  const materiais = new Set();
  player.root.traverse((o) => {
    if (!o.isMesh) return;
    malhas++;
    let visivel = true;
    for (let n = o; n && n !== player.root.parent; n = n.parent) {
      if (!n.visible) { visivel = false; break; }
    }
    if (visivel) {
      visiveis++;
      if (o.castShadow) sombras++;
    }
    if (o.material) materiais.add(o.material);
  });
  return { malhas, visiveis, sombras, materiais: materiais.size };
}

function atualizarConta() {
  desenharRegua();
  const linhas = postos.map((p) => {
    const c = contar(p.player);
    return `${p.player.skin.label}: <b>${c.visiveis}</b> desenhando de ${c.malhas} · ${c.sombras} com sombra · ${c.materiais} materiais`;
  });
  document.getElementById("conta").innerHTML = linhas.join("\n");
}
atualizarConta();

/* -------------------------------------------------------------------- laço -- */

const _olho = new THREE.Vector3();
const _mira = new THREE.Vector3();
let anterior = performance.now();
let tReload = 0;
let tFaca = 0;

function quadro(agora) {
  requestAnimationFrame(quadro);
  const dt = Math.min(0.05, (agora - anterior) / 1000);
  anterior = agora;

  if (estado.girar) estado.yaw = (estado.yaw + dt * 0.5) % (Math.PI * 2);

  for (const posto of postos) {
    const p = posto.player;

    /* A marcha de verdade: `move` é quem avança a fase do passo em METROS
       percorridos, então usar qualquer outra coisa aqui daria uma cadência que
       não é a do jogo. O corpo anda e é trazido de volta ao posto — o que
       importa é o ciclo, não o deslocamento. */
    p.move(dt, estado.andar || estado.correr ? 1 : 0, 0, estado.correr);
    p.position.set(posto.x, 0, 0);
    p.yaw = estado.yaw;
    p.setAim(estado.yaw, estado.pitch);
    p.setDraw(estado.draw);

    if (estado.recarregar) {
      tReload = (tReload + dt / CONFIG.player.reloadTime) % 1;
      p.setReload(tReload);
    } else if (p.reloadFraction) {
      tReload = 0;
      p.setReload(0);
    }

    if (estado.faca) {
      tFaca = (tFaca + dt / 0.6) % 1;
      p.setKnife(tFaca);
    } else if (p.knifeFraction) {
      tFaca = 0;
      p.setKnife(0);
    }

    p.bobPhase += dt * 1.3;
    /* O nível de detalhe: forçado pelo painel, ou o de perto quando em
       automático. Na bancada "automático" quer dizer perto, porque a distância
       da câmera aqui é de estúdio e não de jogo — quem exercita os cortes é a
       chave, e é ela que responde "algum nível abre buraco?". */
    p.setDetailLevel(estado.nivel ?? 0);
    p.update(dt, estado.andar || estado.correr);
  }

  if (estado.primeira) {
    /* A PRIMEIRA PESSOA DE VERDADE — `getEye` é o mesmo olho que o jogo usa,
       logo acima da ancoragem da corda. Não adianta pôr a câmera "mais ou menos
       na cabeça": a meta declarada é aguentar ser olhado a um metro, e o que
       decide isso é exatamente a distância a que a mão do arco fica DESTE
       ponto, não de outro qualquer. */
    const p = postos[Math.max(0, (estado.foco || 1) - 1)].player;
    p.getEye(_olho, null);
    _mira
      .set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch))
      .normalize();
    camera.position.copy(_olho);
    camera.lookAt(_olho.clone().add(_mira));
  } else {
    /* A câmera OLHA para a altura escolhida, em vez de olhar para uma fração
       dela: mirar a cabeça é escrever 1,62, que é onde a cabeça está. */
    const foco = estado.foco === 0 ? 0 : postos[estado.foco - 1].x;
    camera.position.set(foco, estado.alt, estado.dist);
    camera.lookAt(foco, estado.alt, 0);
  }
  renderer.render(cena, camera);
}
requestAnimationFrame(quadro);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Para inspecionar do console.
window.bancada = { postos, cena, estado, contar };
