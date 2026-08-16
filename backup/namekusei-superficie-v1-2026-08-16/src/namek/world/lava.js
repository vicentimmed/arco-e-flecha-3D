/* ---------------------------------------------------------------------------
   A lava que sobe pelo buraco.

   Cavar fundo o bastante fura a crosta, e o que estava embaixo aparece. Quem
   decide ONDE é o campo compartilhado (`NamekField.avaliarLava`); este arquivo
   só desenha, e o servidor só cobra vida. Os três chegam à mesma lista sem
   trocar mensagem nenhuma, porque a lista é derivada do relevo e o relevo já é
   sincronizado.

   ------------------------------------------------------------------ o desenho

   Um disco por poça, num `InstancedMesh` — uma chamada de desenho para todas,
   pelo mesmo motivo que o resto do modo instancia tudo (§3 do plano).

   O disco fica numa cota FIXA (`lava.nivel`) e não acompanha o fundo do
   buraco: lava é líquida, e líquido é plano. É a mesma decisão do mar em
   `water.js`, e é ela que faz a poça ler como poça em vez de como uma tinta
   laranja pintada na bacia.

   ------------------------------------------------------------------- a luz

   Nenhuma luz dinâmica, e é o §3 de novo: o jogo tem três, e o cenário e o
   especial do jogador já as gastam. O brilho aqui é EMISSIVO — o material se
   acende sozinho, sem iluminar o que está em volta. A perda é real (uma
   cratera de lava não pinta de laranja a parede do próprio buraco) e o preço
   de consertá-la seria uma quarta luz por poça.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";

/** Teto de poças desenhadas ao mesmo tempo. */
const CAPACIDADE = 48;

/* ------------------------------------------------------------------ as cores
 *
 * Eram duas — laranja `#ff7a1e` e um marrom-vermelho `#8f2408` — e o relato foi
 * *"deve ter uma cor mais parecido com lava"*. Duas cores próximas na mesma
 * matiz não descrevem lava: descrevem uma tinta laranja com sombra.
 *
 * Lava de verdade tem TRÊS registros, e o que a identifica é a distância entre
 * eles, não a matiz de nenhum:
 *
 * • o BOLO, o material a mil e tantos graus, que é amarelo-branco e não laranja
 *   — a coisa mais clara da cena, mais clara que o céu;
 * • a LAVA propriamente, laranja saturado, o degrau do meio;
 * • a CROSTA, a película já solidificada por cima, que é quase PRETA. Basalto
 *   fresco é escuro, e é justamente o contraste contra ele que faz o resto
 *   brilhar.
 *
 * A crosta ser preta é o que mais muda: com um marrom claro no lugar dela, a
 * poça inteira fica na mesma faixa de luminosidade e vira um decalque. */
/** O bolo incandescente, no fundo das fendas. Quase branco. */
const COR_BOLO = new THREE.Color("#ffe08a");
/** A lava. Laranja saturado. */
const COR_LAVA = new THREE.Color("#ff5a0a");
/** A crosta solidificada. Basalto — quase preto, e é ele que dá o contraste. */
const COR_CROSTA = new THREE.Color("#1a0b07");

const _obj = new THREE.Object3D();
/* Havia um `_cor` aqui, para o pulsar de cor POR INSTÂNCIA. Ele saiu junto com
   esse pulsar: quem faz a poça respirar agora é o shader, por fragmento e com
   estrutura (placas, fendas, bolo). Uma cor de instância por cima disso só
   lavaria o contraste que ele constrói. */

/* ------------------------------------------------------------------ o shader
 *
 * A POÇA DEIXOU DE SER UM DISCO DE UMA COR SÓ, e é essa a diferença entre "uma
 * mancha laranja no fundo do buraco" e lava.
 *
 * O que existia era um `CircleGeometry` com emissivo uniforme e uma cor de
 * instância pulsando devagar. Isso dá um decalque que respira, e a três metros
 * de distância — que é onde o jogador está quando cai dentro do buraco — ele é
 * chapado.
 *
 * O que uma superfície de lava tem, e o que este enxerto desenha:
 *
 * 1. **PLACAS DE CROSTA COM FENDAS ENTRE ELAS.** É a estrutura dominante. Sai de
 *    um ruído celular barato (o clássico "worley" de 2×2 células por amostra):
 *    a distância à segunda célula mais próxima menos a distância à primeira dá
 *    exatamente uma malha de fronteiras, e as fronteiras são as fendas.
 * 2. **AS PLACAS DERIVAM.** Elas andam devagar, e cada poça anda para um lado
 *    diferente (a fase vem da posição). Crosta parada lê como pedra pintada.
 * 3. **O BOLO PULSA NAS FENDAS.** O material quente aparece onde a crosta
 *    rachou, e o brilho dele respira num ritmo diferente do da deriva — dois
 *    períodos que não fecham entre si, como em todo o resto deste projeto.
 * 4. **A BORDA ESFRIA.** Nos últimos 12 % do raio a crosta ganha, e é isso que
 *    encaixa a poça na parede do buraco em vez de deixar um recorte laranja.
 *
 * Tudo por fragmento e sem uma textura sequer — o projeto inteiro não carrega
 * imagem para cenário, e não vai começar por aqui.
 */
const LAVA_GLSL = `
  /* Hash 2D → 2D. As constantes são as de sempre ('fract' de um seno grande);
     elas não precisam ser boas, precisam ser estáveis entre placas de vídeo, e
     estas são as que o resto do repositório já usa. */
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  /* Celular: devolve (menor distância, segunda menor). A DIFERENÇA entre as
     duas é a fenda — ela vale zero no meio de uma placa e cresce até a
     fronteira, onde as duas células empatam. */
  vec2 celular(vec2 p) {
    vec2 base = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash2(base + g);
        /* O ponto da célula ANDA: é a deriva das placas, e ela é o que impede a
           crosta de parecer pedra. Amplitude pequena — placas escorregam, não
           voam. */
        o = 0.5 + 0.42 * sin(uLavaT * 0.35 + 6.2831 * o);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; }
        else if (d < d2) { d2 = d; }
      }
    }
    return vec2(sqrt(d1), sqrt(d2));
  }
`;

/* Células por metro — a escala das placas de crosta.
 *
 * 0,34 dá placas de ~3 m. O primeiro valor foi 0,09 (placas de 11 m) e ele
 * estava errado por uma razão que só apareceu com a poça na tela: **uma poça
 * recém-aberta tem 6 m de raio**, e placas de 11 m não cabem nela. O que se via
 * era menos de uma placa esticada sobre o disco inteiro — uma mancha branca
 * enorme com duas fendas gordas, que não lê como lava nem como pedra.
 *
 * A régua certa é a MENOR poça, não a maior: a poça nasce pequena e cresce, e a
 * textura tem de funcionar desde o primeiro instante. Com 3 m cabem cinco placas
 * numa poça nova e trinta numa de quarenta metros — e três metros é, por acaso,
 * o tamanho real de uma placa de crosta em lava de verdade. */
const ESCALA_PLACA = 0.34;

/* ------------------------------------------------------------- as partículas */
/** m — além disto a poça não solta brasa: o custo seria de sub-pixel. */
const ALCANCE_BRASA = 190;
/** s — intervalo médio entre dois sopros de uma poça. */
const INTERVALO_BRASA = 0.22;
/** Quantas poças são visitadas por quadro, em rodízio. Ver `borbulhar`. */
const POCAS_POR_QUADRO = 4;
/** A direção da coluna. Objeto de módulo: `fagulhas` só o lê. */
const PARA_CIMA = { x: 0, y: 1, z: 0 };

export class NamekLava {
  /**
   * @param {import("../../shared/namek/field.js").NamekField} field
   * @param {import("../fx/index.js").NamekFx} [fx] quem desenha as partículas.
   *   OPCIONAL, e opcional de propósito: a lava sabe desenhar a superfície dela
   *   sozinha, e o pool de partículas é um recurso do jogo que a bancada de
   *   cenário (`dev/`) não monta. Sem ele, a poça continua correta — só não
   *   ferve.
   */
  constructor(field, fx = null) {
    this.field = field;
    this.fx = fx;
    this.mesh = null;
    this.relogio = 0;
    /** Uniform do relógio, compartilhado com o shader da crosta. */
    this.uTempo = { value: 0 };
    /** Onde o rodízio de borbulha parou. Ver `borbulhar`. */
    this._rodizio = 0;
    /** As poças que já ganharam instância, na ordem em que nasceram. */
    this.desenhadas = [];
  }

  build(parent) {
    /* Disco de 24 lados. A poça é orgânica, mas o contorno dela é escondido
       pela borda da própria cratera — gastar mais lados aqui compraria uma
       silhueta que ninguém vê. */
    const geo = new THREE.CircleGeometry(1, 24);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: COR_LAVA.clone(),
      emissiveIntensity: 1,
      roughness: 0.85,
      metalness: 0,
      /* A poça fica no fundo de um buraco e o terreno passa rente a ela; sem
         o deslocamento de profundidade, as duas superfícies brigam pelo mesmo
         pixel e a lava pisca em faixas conforme a câmera anda. */
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    /* O relógio do shader. Um uniform SÓ para todas as instâncias — a poça se
       diferencia pela POSIÇÃO no mundo (a fase do celular sai dela), não por um
       relógio próprio, e é isso que mantém a coisa em uma chamada de desenho. */
    this.uTempo = { value: 0 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uLavaT = this.uTempo;
      shader.uniforms.uBolo = { value: COR_BOLO.clone() };
      shader.uniforms.uLava = { value: COR_LAVA.clone() };
      shader.uniforms.uCrosta = { value: COR_CROSTA.clone() };

      /* A posição LOCAL do vértice viaja para o fragmento, e é ela — e não a de
         mundo — que dá o `u` radial de graça: a geometria é um círculo de raio
         1, então `length(xz)` já é a fração do raio. A de MUNDO também vai, para
         a fase do celular ser diferente em cada poça sem um uniform por
         instância. */
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           varying vec3 vLavaLocal;
           varying vec3 vLavaMundo;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           vLavaLocal = position;
           vLavaMundo = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float uLavaT;
           uniform vec3 uBolo;
           uniform vec3 uLava;
           uniform vec3 uCrosta;
           varying vec3 vLavaLocal;
           varying vec3 vLavaMundo;
           ${LAVA_GLSL}`,
        )
        /* `<emissivemap_fragment>` é o único ponto em que `totalEmissiveRadiance`
           já existe e ainda não foi usada — a mesma injeção que o terreno usa
           para as fissuras de magma. Aqui ela é SOBRESCRITA e não somada: o
           emissivo do material é a cor base, e o que este bloco calcula é a cor
           final de cada pixel da poça. */
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           {
             vec2 c = celular(vLavaMundo.xz * ${ESCALA_PLACA.toFixed(3)});
             /* A FENDA: a diferença entre as duas distâncias. Zero no meio da
                placa, máxima na fronteira. Invertida e apertada com smoothstep,
                ela vira uma linha fina — que é a forma de uma rachadura. */
             /* 0,02 a 0,20 e não 0,02 a 0,30: a fenda tem de ser uma LINHA. Com
                a faixa larga ela vira um degradê que cobre metade da placa, e a
                crosta preta — que é o que dá o contraste — desaparece. */
             float fenda = 1.0 - smoothstep(0.02, 0.20, c.y - c.x);

             /* O BOLO PULSA, e num período que não fecha com o da deriva das
                placas (0,35 lá contra 1,7 e 0,9 aqui). Dois períodos que fecham
                entre si produzem um pisca regular, e pisca regular lê como
                defeito de material. */
             float pulso = 0.62 + 0.38 * sin(uLavaT * 1.7 + vLavaMundo.x * 0.3)
                                 * sin(uLavaT * 0.9 + vLavaMundo.z * 0.24);

             /* AS ZONAS QUENTES E FRIAS. Uma segunda escala celular, seis vezes
                mais larga que as placas, decidindo quanto de cada REGIÃO da poça
                está fervendo.
              *
              * Sem ela a malha de fendas fica uniforme — todas com o mesmo
              * brilho, todas com a mesma espessura —, e uniformidade é a
              * assinatura de uma fórmula. Numa poça de verdade há um lado ativo,
              * onde a crosta mal se forma, e um lado já esfriado e escuro. Esta
              * é a variação que separa as duas coisas, e ela custa uma segunda
              * chamada de 'celular' por fragmento. */
             float zona = 0.45 + 0.55 * smoothstep(0.15, 0.75, celular(vLavaMundo.xz * 0.055).x);

             /* Três registros, empilhados do frio para o quente: crosta preta,
                lava laranja onde a fenda abre, bolo amarelo-branco no fundo
                dela. O expoente na segunda mistura é o que mantém o amarelo
                restrito ao MIOLO da fenda — sem ele, a poça inteira estoura em
                branco e volta a não ter cor nenhuma. */
             float f = fenda * zona;
             vec3 cor = mix(uCrosta, uLava, f);
             cor = mix(cor, uBolo, pow(f, 3.0) * pulso);

             /* A BORDA ESFRIA. Nos últimos 12 % do raio a crosta ganha: é o que
                encaixa a poça na parede do buraco em vez de deixar um recorte
                laranja contra a rocha. */
             float u = length(vLavaLocal.xz);
             cor = mix(cor, uCrosta, smoothstep(0.88, 1.0, u));

             /* A intensidade acompanha a cor: crosta quase não emite, fenda
                emite muito. Emissivo uniforme faria o preto da crosta brilhar
                tanto quanto o amarelo do bolo, e aí não há contraste nenhum. */
             /* 1,9 e não 2,6: com o tonemap filmico do renderer, qualquer coisa
                acima de ~2 satura em branco e a fenda perde a cor pela qual ela
                existe. O que se quer é a fenda ser a coisa mais BRILHANTE da
                cena, não a mais branca. */
             totalEmissiveRadiance = cor * (0.22 + 1.9 * f * pulso);
           }`,
        );
    };
    /* Sem esta chave o Three entrega a ESTE material o programa de qualquer
       outro `MeshStandardMaterial` com os mesmos parâmetros — ver o comentário
       longo em `world/terrain.js`, que paga a mesma linha pelo mesmo motivo. */
    mat.customProgramCacheKey = () => "namek-lava-crosta";

    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACIDADE);
    this.mesh.name = "namek-lava";
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    /* Sem culling: a caixa da instância zero não descreve onde as poças estão,
       e o lote inteiro sumiria conforme a câmera gira. */
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);

    /* As que já existiam quando o mundo foi montado — o caso de quem entra no
       meio da partida, com o chão já cheio de buracos. */
    for (const p of this.field.lavaPools) this.acender(p);
    return this;
  }

  /** Uma poça nasceu (ou cresceu). Ligado em `NamekField.onLava`. */
  acender(poça) {
    if (!this.mesh) return;
    const i = this.desenhadas.indexOf(poça);
    if (i >= 0) {
      this.escrever(i, poça);
      return;
    }
    if (this.desenhadas.length >= CAPACIDADE) return;
    this.desenhadas.push(poça);
    this.escrever(this.desenhadas.length - 1, poça);
    this.mesh.count = this.desenhadas.length;
  }

  escrever(i, poça) {
    const L = NAMEK.destruction.lava;
    _obj.position.set(poça.x, L.nivel, poça.z);
    _obj.rotation.set(0, 0, 0);
    _obj.scale.setScalar(poça.raio);
    _obj.updateMatrix();
    this.mesh.setMatrixAt(i, _obj.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * O relógio do shader e as BRASAS.
   *
   * O pulsar de cor por instância que morava aqui saiu: ele existia para a poça
   * não ser um decalque de cor fixa, e quem faz esse trabalho agora é o shader
   * (ver `LAVA_GLSL`), por fragmento e com estrutura — placas, fendas, bolo. Uma
   * cor por instância por cima disso só lavaria o contraste que ele constrói.
   *
   * O que sobrou é o relógio e a coisa que shader nenhum resolve: **partículas.**
   * O pedido é literal — *"ela deve ter partículas como se fosse lava mesmo"* —
   * e ele está certo sobre o motivo: uma superfície de lava, por melhor que seja
   * pintada, é uma superfície. O que diz ao olho que aquilo está QUENTE é o que
   * sai dela e sobe.
   *
   * São duas, e cada uma conta uma metade:
   *
   * • a BRASA — fagulhas alaranjadas que sobem rápido, sem gravidade (elas são
   *   leves e o ar quente as carrega), com vida curta. É o respingo;
   * • a FUMAÇA — bem mais lenta, escura, crescendo enquanto sobe. É o que dá
   *   VOLUME à coluna e o que se vê de longe.
   *
   * ---------------------------------------------------------------- o orçamento
   *
   * Uma poça de 40 m cuspindo brasa a 60 Hz esvazia o pool de partículas sozinha
   * e engole a poeira dos impactos — que é a informação que o jogador precisa
   * ver. Três travas, e as três são necessárias:
   *
   * 1. **cadência por poça**, não por quadro: cada uma respira no ritmo dela;
   * 2. **só as PERTO da câmera** (`ALCANCE_BRASA`). Uma poça a quatrocentos
   *    metros tem as partículas dela em sub-pixel — é orçamento gasto em nada;
   * 3. **teto de poças por quadro**, varridas em rodízio. Com quinze buracos
   *    abertos, borbulhar todos no mesmo quadro é um pico de trezentas
   *    partículas; em rodízio, o custo é constante e nenhuma poça fica muda.
   */
  update(dt, cameraPos) {
    if (!this.mesh || !this.desenhadas.length) return;
    this.relogio += dt;
    this.uTempo.value = this.relogio;
    if (this.fx) this.borbulhar(dt, cameraPos);
  }

  /**
   * A respiração das poças. Ver o bloco do orçamento em `update`.
   *
   * O ponto de emissão é sorteado no DISCO (raiz quadrada no raio, como todo
   * sorteio em área deste projeto): sem a raiz, tudo sai do meio da poça e a
   * coluna vira um esguicho central em vez de uma superfície fervendo.
   */
  borbulhar(dt, cameraPos) {
    const L = NAMEK.destruction.lava;
    const n = this.desenhadas.length;
    const teto = Math.min(n, POCAS_POR_QUADRO);

    for (let k = 0; k < teto; k++) {
      this._rodizio = (this._rodizio + 1) % n;
      const p = this.desenhadas[this._rodizio];

      if (cameraPos) {
        const dx = p.x - cameraPos.x;
        const dz = p.z - cameraPos.z;
        const dy = L.nivel - cameraPos.y;
        if (dx * dx + dy * dy + dz * dz > ALCANCE_BRASA * ALCANCE_BRASA) continue;
      }

      /* O relógio é da POÇA e vive no registro dela — o mesmo objeto que o campo
         compartilhado guarda. Guardá-lo num mapa aqui seria um segundo lugar
         para os dois envelhecerem separados quando uma poça crescesse. */
      p._brasa = (p._brasa ?? Math.random() * INTERVALO_BRASA) - dt;
      if (p._brasa > 0) continue;
      /* Poça grande borbulha mais vezes, não com mais partículas por vez: uma
         rajada grossa lê como explosão, e o que se quer é fervura. */
      p._brasa = INTERVALO_BRASA * (0.55 + 0.45 * Math.random()) * (12 / (12 + p.raio));

      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * p.raio * 0.86;
      const x = p.x + Math.cos(ang) * r;
      const z = p.z + Math.sin(ang) * r;

      /* A BRASA. `spread` baixo com direção para cima: uma coluna, não uma
         esfera. Gravidade zero de propósito — respingo de lava desenhado com
         balística vira pipoca, e o que se quer é a fagulha sendo LEVADA pelo ar
         quente. */
      this.fx.fagulhas(x, L.nivel + 0.3, z, 0.5, 0xff7a1e, 3, 7, PARA_CIMA, 0.22);

      /* A FUMAÇA sai com um terço da frequência: ela dura muito mais que a
         brasa, e emitir as duas no mesmo ritmo encheria a coluna de cinza e
         apagaria o laranja, que é a informação. */
      if (Math.random() < 0.34) {
        this.fx.fagulhas(x, L.nivel + 1.1, z, 1.9, 0x2b2320, 2, 2.4, PARA_CIMA, 0.4);
      }
    }
  }

  dispose() {
    this.mesh = null;
    this.desenhadas = [];
  }
}
