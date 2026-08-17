/* ---------------------------------------------------------------------------
   A CHUVA DE METEOROS — a metade do pedido que dura.

   *"Após destruído cai uma chuva de meteoros pegando fogo de tamanhos variados
   no cenário, causando grandes explosões e deformidade no cenário."*

   Este arquivo é a CASCA VISUAL de entidades que vivem na sala
   (`server/namek/planetas.js`). Aqui não se decide nada: nem onde a rocha cai,
   nem quando, nem quem ela mata, nem que buraco ela abre. É a mesma divisão que
   `entities/fallingMeteor.js` faz do lado do arqueiro, e ela não é preferência
   de arquitetura — é o §8 do plano. Uma chuva sorteada em cada tela seriam
   quinze planetas diferentes explodindo ao mesmo tempo.

   ============================================================================
   1. UMA RETA E UM RELÓGIO
   ============================================================================

   A sala manda seis números por rocha (`NS2C.METEOR`: origem, impacto, raio,
   duração, instante) e nunca mais fala dela até ela estourar. A posição é

       p = o + (impacto − o) · (agoraSala − w) / t

   e é a MESMA conta dos dois lados — a sala integra a mesma reta para saber em
   quem a rocha encostou. O que o jogador vê passando por cima dele é
   exatamente o que lhe cobra metade da vida.

   Vinte rochas no ar custariam 400 números por quadro se a sala mandasse
   posição. Assim custam seis números, uma vez cada. É o mesmo princípio do
   `packFighter` e do salto do peixe: manda-se o relógio, não o quadro.

   E porque o relógio é o da SALA, uma mensagem que chega 200 ms atrasada não
   produz uma rocha atrasada: ela produz uma rocha que já está 200 ms adiante no
   trajeto, que é onde ela de fato está.

   ============================================================================
   2. O ORÇAMENTO — três chamadas de desenho para a chuva inteira
   ============================================================================

       rocha   1 InstancedMesh (icosaedro amassado, 20 faces, 20 vagas)
       coroa   1 InstancedMesh (casca de fogo, esfera de 80 faces)
       marca   1 InstancedMesh (o círculo no chão, disco de 32 lados)

   Nenhuma textura (§3): a coroa de fogo é um fresnel calculado no fragmento e a
   marca é um degradê radial sobre o `uv` do disco. O rastro sai do pool de
   partículas que já existe (`NamekFx.fagulhas`), então não custa chamada
   nenhuma nem alocação nenhuma.

   Zero alocação por quadro: as vinte vagas nascem no `build` e são reescritas
   para sempre. A vaga apagada fica com escala zero — nenhum fragmento, nenhum
   `count` para manter em dia, nenhum estado a compactar.

   ============================================================================
   3. A MARCA NO CHÃO É A PEÇA MAIS IMPORTANTE DAQUI
   ============================================================================

   E é a mesma lição que o modo da Lua já tinha aprendido: *"ela marca onde a
   rocha VAI cair e acende conforme desce: é o que faz o impacto ser justo —
   ninguém morre sem ter tido onde ler o aviso."*

   Aqui isso é literal e é grave, porque **o raio de explosão MATA**
   (`NAMEK.planetas.meteoro.raioLetal`). Um colosso apaga quem estiver a trinta
   metros do ponto de queda, e a única coisa entre o jogador e essa morte é o
   círculo laranja crescendo no chão. Por isso ele é generoso (3,4 vezes o raio
   da rocha, ou seja, MAIOR que o raio letal), ele acende com a aproximação e
   ele pulsa nos últimos instantes.

   Ela também é deitada sobre a NORMAL do terreno, e não na horizontal: um
   círculo horizontal numa ladeira de vinte metros entra pela terra de um lado e
   paira do outro — que é o mesmo cuidado que `NamekFx.normalDoChao` toma com o
   anel de choque.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";

/* Lados do disco da marca e da esfera da coroa. Os dois são vistos a dezenas ou
   centenas de metros e nunca de perto: 32 e (12×8) são lisos nessa faixa e
   custam 32 e 176 triângulos por instância. */
const LADOS_MARCA = 32;
const COROA_U = 12;
const COROA_V = 8;

/* Múltiplo do raio da rocha — o tamanho da casca de fogo em volta dela.
 *
 * Era 2,3 e a bancada mostrou o defeito: com a casca ao dobro do diâmetro da
 * pedra, o que se vê é uma BOLHA grande e pálida com um caroço escuro no meio —
 * a rocha parece pequena e a chama parece névoa. A 1,8 o envelope ainda abraça
 * a pedra por fora (é a coroa que diz "isto está pegando fogo") sem tomar o
 * lugar dela na silhueta. */
const COROA_ESCALA = 1.8;

/* Ordem de desenho da marca. Ela é aditiva e tem de aparecer POR CIMA do chão
   sem escrever profundidade; a poeira e o clarão dos efeitos ficam em 900 e
   acima, e ela precisa ficar abaixo deles — a nuvem do impacto tem de cobrir a
   marca do impacto, não o contrário. */
const ORDEM_MARCA = 8;

const COROA_VERT = /* glsl */ `
  /* 'instanceMatrix' e 'instanceColor' vêm DECLARADOS pelo prefixo que o
     three.js põe em todo 'ShaderMaterial' de um 'InstancedMesh' — declará-los
     aqui é erro de compilação. 'instanceColor.r' carrega o brilho da rocha
     (ela acende ao entrar na atmosfera e some ao estourar), um número por
     instância sem um segundo buffer. */
  varying vec3 vN;
  varying vec3 vW;
  varying float vBrilho;
  void main() {
    vBrilho = instanceColor.r;
    vec4 lp = instanceMatrix * vec4(position, 1.0);
    vec4 wp = modelMatrix * lp;
    vW = wp.xyz;
    /* Escala uniforme na instância da coroa (ver 'update'), então a submatriz
       3×3 normalizada é a normal certa — sem inversa-transposta. */
    vN = normalize(mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const COROA_FRAG = /* glsl */ `
  uniform vec3 corNucleo;
  uniform vec3 corBorda;
  varying vec3 vN;
  varying vec3 vW;
  varying float vBrilho;
  void main() {
    vec3 olho = normalize(cameraPosition - vW);
    /* FRESNEL. A casca é quase transparente de frente e acesa de perfil — é
       assim que um envelope de plasma se comporta, e é o que separa "rocha
       dentro de uma bolha de fogo" de "rocha dentro de uma bola branca".
       O expoente 2,4 é o que deixa a borda fina o bastante para a silhueta da
       pedra continuar legível por dentro dela. */
    float borda = 1.0 - abs(dot(normalize(vN), olho));
    /* O TERMO CONSTANTE É PEQUENO (0,05 contra os 0,10 de antes) porque ele é o
       que enche o miolo da casca: alto, ele soma luz uniforme sobre a pedra
       inteira e o resultado, sobre um céu lima claro, satura em branco-esverdeado
       — névoa, não fogo. Quase toda a energia vai para a borda. */
    float a = pow(borda, 2.0) * 1.15 + 0.05;
    /* O miolo puxa para o branco-amarelo e a borda para o laranja fundo: duas
       cores, porque uma só dá um adesivo colorido em vez de fogo. */
    vec3 cor = mix(corNucleo, corBorda, borda);
    /* A INTENSIDADE vai na cor e a FORMA vai no alfa: 'AdditiveBlending' sem
       alfa pré-multiplicado soma 'rgb · a', então pôr as duas no alfa o elevaria
       ao quadrado. Mesma decisão do halo em 'planetas.js'. */
    gl_FragColor = vec4(cor * vBrilho, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const MARCA_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vForca;
  void main() {
    vUv = uv;
    vForca = instanceColor.r;
    vec4 lp = instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * lp;
  }
`;

const MARCA_FRAG = /* glsl */ `
  uniform vec3 cor;
  varying vec2 vUv;
  varying float vForca;
  void main() {
    if (vForca <= 0.002) discard;
    float d = length(vUv - 0.5) * 2.0;
    if (d > 1.0) discard;
    /* Um ARO forte e um miolo fraco. O aro é o que dá a escala (o olho mede
       distância percorrida no chão, não brilho); o miolo é o que diz que o
       ponto exato de queda é ali dentro, e não em cima da linha. */
    float aro = smoothstep(1.0, 0.86, d) * smoothstep(0.58, 0.80, d);
    float miolo = pow(max(1.0 - d, 0.0), 2.4) * 0.30;
    float a = aro + miolo;
    if (a <= 0.004) discard;
    gl_FragColor = vec4(cor * vForca, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* --------------------------------------------------------------- rascunhos -- */

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _esc = new THREE.Vector3();
const _eixo = new THREE.Vector3();
const _cima = new THREE.Vector3(0, 1, 0);
const _norm = { x: 0, y: 1, z: 0 };
const _zero = new THREE.Matrix4();

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class NamekMeteoros {
  /**
   * @param {import("../../shared/namek/field.js").NamekField} field
   * @param {import("../fx/index.js").NamekFx} [fx] o pool de partículas. Opcional
   *   pelo mesmo motivo que o da lava: a bancada de cenário em `dev/` monta o
   *   mundo sem o jogo em volta, e sem o pool a rocha continua caindo — ela só
   *   não pega fogo nem levanta poeira ao estourar.
   */
  constructor(field, fx = null) {
    this.field = field;
    this.fx = fx;
    /** O som, pendurado depois por `ligarAudio`. Sem ele a chuva cai muda. */
    this.audio = null;
    this.root = null;
    /** Uma vaga por rocha viva. Pré-alocadas em `build`. */
    this.vagas = [];
  }

  build(parent) {
    const M = NAMEK.planetas.meteoro;
    const max = NAMEK.planetas.chuva.vivosMax;

    this.root = new THREE.Group();
    this.root.name = "namek-meteoros";
    parent.add(this.root);

    _esc.set(0, 0, 0);
    _v.set(0, 0, 0);
    _q.identity();
    _zero.compose(_v, _q, _esc);

    /* ------------------------------------------------------------- rocha --
       `MeshStandardMaterial` e não um shader próprio: ela é a única peça daqui
       que precisa das LUZES e da NÉVOA da cena, e reescrever os dois à mão para
       ganhar um emissivo por instância seria copiar meio renderizador. O
       emissivo é o mesmo para todas — todas estão queimando à mesma
       temperatura —, e a variedade que o pedido cobra ("de tamanhos variados")
       é de ESCALA, que a matriz de instância já carrega. */
    this.rochaMat = new THREE.MeshStandardMaterial({
      color: 0x231710,
      emissive: new THREE.Color(0xff5a18),
      /* A ROCHA EMITE MAIS DO QUE RECEBE, e tem de ser assim: ela é vista contra
         um céu lima CLARO, e um corpo escuro e difuso contra fundo claro é uma
         silhueta preta — a leitura de "pedra" e não a de "pedra em chamas". O
         emissivo é o que faz o material dela participar do incêndio em vez de
         só ser envolvido por ele. */
      emissiveIntensity: 2.6,
      roughness: 0.95,
      metalness: 0.02,
      flatShading: true,
    });
    this.rochas = new THREE.InstancedMesh(this.montarRocha(), this.rochaMat, max);
    this.rochas.name = "namek-meteoro-rocha";
    this.rochas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /* Elas nascem a 600 m do chão e caem: a esfera envolvente da malha não
       acompanha instância nenhuma, e o objeto inteiro tem vinte peças. */
    this.rochas.frustumCulled = false;
    this.root.add(this.rochas);

    /* ------------------------------------------------------------- coroa -- */
    this.coroaMat = new THREE.ShaderMaterial({
      vertexShader: COROA_VERT,
      fragmentShader: COROA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      /* AS DUAS CORES SÃO SATURADAS DE PROPÓSITO, e o motivo é o fundo.
       *
       * Mistura aditiva não escolhe: ela SOMA sobre o que já está lá, e o que já
       * está lá é o céu de Namekusei — lima claro, com o canal verde alto. Um
       * âmbar pálido (era `#ffd9a0`) somado sobre isso satura os três canais
       * quase junto e sai BRANCO-ESVERDEADO: medido na bancada, a chama lia como
       * uma bolha de névoa. O que desloca a matiz é a diferença ENTRE os canais,
       * então o vermelho tem de sobrar muito sobre os outros dois. */
      uniforms: {
        corNucleo: { value: new THREE.Color(0xffb257) },
        corBorda: { value: new THREE.Color(0xff3c04) },
      },
    });
    this.coroas = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, COROA_U, COROA_V),
      this.coroaMat,
      max,
    );
    this.coroas.name = "namek-meteoro-coroa";
    this.coroas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coroas.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.coroas.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.coroas.frustumCulled = false;
    this.coroas.renderOrder = 10;
    this.root.add(this.coroas);

    /* ------------------------------------------------------------- marca -- */
    const disco = new THREE.CircleGeometry(1, LADOS_MARCA);
    disco.rotateX(-Math.PI / 2); // deitado, visto de cima
    this.marcaMat = new THREE.ShaderMaterial({
      vertexShader: MARCA_VERT,
      fragmentShader: MARCA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { cor: { value: new THREE.Color(0xff7a20) } },
    });
    this.marcas = new THREE.InstancedMesh(disco, this.marcaMat, max);
    this.marcas.name = "namek-meteoro-marca";
    this.marcas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.marcas.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.marcas.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.marcas.frustumCulled = false;
    this.marcas.renderOrder = ORDEM_MARCA;
    this.root.add(this.marcas);

    for (let i = 0; i < max; i++) {
      this.rochas.setMatrixAt(i, _zero);
      this.coroas.setMatrixAt(i, _zero);
      this.marcas.setMatrixAt(i, _zero);
      this.vagas.push({
        viva: false,
        id: -1,
        /** origem, no céu */
        ox: 0, oy: 0, oz: 0,
        /** ponto de impacto */
        px: 0, py: 0, pz: 0,
        raio: 1,
        /** s de queda, e o instante da largada no relógio da SALA */
        dur: 1,
        w: 0,
        /** rad já girados, e o eixo do tombo */
        ang: 0,
        ax: 0, ay: 1, az: 0,
        /** s até o próximo sopro do rastro */
        rastro: 0,
        /** posição corrente — o rastro e o LOD leem daqui */
        x: 0, y: 0, z: 0,
      });
    }
    this.rochas.instanceMatrix.needsUpdate = true;
    this.coroas.instanceMatrix.needsUpdate = true;
    this.marcas.instanceMatrix.needsUpdate = true;
    this.marcaEscala = M.marca;
    this.visiveis(false);
    return this;
  }

  /**
   * A forma de uma rocha: icosaedro amassado, raio 1.
   *
   * UMA geometria para as vinte, e a variedade sai da escala NÃO uniforme de
   * cada instância mais o tombo. Vinte malhas distintas dariam vinte silhuetas
   * para um objeto que passa voando a 150 m/s — ninguém compara duas.
   */
  montarRocha() {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const pos = g.attributes.position;
    /* Amassado DETERMINÍSTICO: uma sequência linear congruente com semente
       fixa, e não `Math.random`. A forma é a mesma em toda máquina — não porque
       alguém compare, mas porque um cenário que muda entre execuções é um
       cenário que não dá para comparar quando alguma coisa der errado. */
    let s = 0x2545f491;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < pos.count; i++) {
      const k = 0.62 + rnd() * 0.62;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.88, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  }

  visiveis(on) {
    if (this.rochas) this.rochas.visible = on;
    if (this.coroas) this.coroas.visible = on;
    if (this.marcas) this.marcas.visible = on;
  }

  /* ============================================================== a chuva == */

  /**
   * Uma rocha entrou no céu (`NS2C.METEOR`).
   *
   * A vaga é procurada entre as mortas; se não houver nenhuma — o que a sala
   * garante que não acontece, porque `chuva.vivosMax` é o teto dos dois lados —
   * a mais VELHA é reciclada. Recusar em silêncio seria pior: a rocha continuaria
   * existindo para a sala, cobraria dano e abriria cratera, e o jogador levaria
   * cinquenta de vida de uma coisa que nunca esteve na tela dele.
   */
  /**
   * Liga o som. Mesmo contrato do `NamekPeixe.ligarAudio`: este módulo só
   * CHAMA a API do dono do áudio, nunca a altera, e sem ela ele funciona mudo.
   *
   * @param {object} audio a instância de `NamekAudio`
   */
  ligarAudio(audio) {
    this.audio = audio;
    return this;
  }

  soltar(msg) {
    if (!msg || !Array.isArray(msg.o) || !Array.isArray(msg.p)) return;
    const v = this.pegarVaga();
    v.viva = true;
    v.id = msg.i;
    v.ox = msg.o[0];
    v.oy = msg.o[1];
    v.oz = msg.o[2];
    v.px = msg.p[0];
    v.py = msg.p[1];
    v.pz = msg.p[2];
    v.raio = Math.max(0.3, Number(msg.r) || 1);
    v.dur = Math.max(0.2, Number(msg.dur) || 1);
    v.w = Number(msg.w) || 0;
    v.x = v.ox;
    v.y = v.oy;
    v.z = v.oz;
    v.rastro = 0;

    /* O tombo: um eixo qualquer, sorteado uma vez. Ele é PURAMENTE local — a
       sala não simula rotação nenhuma, e ela não precisa: uma rocha girando não
       muda onde ela encosta. */
    _eixo.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (_eixo.lengthSq() < 1e-4) _eixo.set(0, 1, 0);
    _eixo.normalize();
    v.ax = _eixo.x;
    v.ay = _eixo.y;
    v.az = _eixo.z;
    v.ang = Math.random() * Math.PI * 2;

    /* A MARCA é escrita UMA vez, aqui: ela pertence ao ponto de queda, e o
       ponto de queda não se mexe. Deitá-la sobre a normal do terreno custa
       quatro consultas de altura por rocha — pago uma vez, contra uma vez por
       quadro se fosse feito no `update`. */
    this.assentarMarca(v);
    this.visiveis(true);

    /* O ASSOBIO. A chuva avisava só pelo OLHO — a mancha laranja que
       `assentarMarca` acabou de deitar no chão —, e um aviso que exige estar
       olhando para baixo não serve num jogo em que se voa olhando para a frente.
       O som sai do PONTO DE QUEDA e não da rocha lá em cima, de propósito: ver
       `NamekAudio.assobioDeQueda`, que é onde a escolha está justificada.
       `v.dur` é a queda inteira, e é ela que faz o assobio acabar junto com o
       estouro em vez de terminar antes ou continuar depois. */
    this.audio?.assobioDeQueda?.({ x: v.px, y: v.py, z: v.pz }, v.raio, v.dur);
  }

  pegarVaga() {
    let velha = this.vagas[0];
    for (const v of this.vagas) {
      if (!v.viva) return v;
      if (v.w < velha.w) velha = v;
    }
    return velha;
  }

  /** Deita o círculo de aviso sobre o relevo do ponto de queda. */
  assentarMarca(v) {
    const i = this.vagas.indexOf(v);
    const chao = this.field ? this.field.heightAt(v.px, v.pz) : v.py;
    if (this.field) this.field.normalAt(v.px, v.pz, 0.8, _norm);
    else {
      _norm.x = 0;
      _norm.y = 1;
      _norm.z = 0;
    }
    _v.set(_norm.x, _norm.y, _norm.z).normalize();
    _q.setFromUnitVectors(_cima, _v);
    /* Meio metro acima do chão. Rente demais e o disco briga com o terreno na
       precisão de profundidade (o `far` deste modo é 3.600 m); alto demais e
       ele flutua visivelmente numa ladeira. */
    _v.set(v.px, chao + 0.5, v.pz);
    const r = v.raio * this.marcaEscala;
    _esc.set(r, r, r);
    _m.compose(_v, _q, _esc);
    this.marcas.setMatrixAt(i, _m);
    this.marcas.instanceMatrix.needsUpdate = true;
  }

  /**
   * A rocha estourou (`NS2C.METEOR_HIT`).
   *
   * O QUE NÃO ACONTECE AQUI: a cratera e o som. Os dois descem pelo `NS2C.CRATER`
   * de sempre, carimbado pelo mesmo `NamekRoom.cratera` que atende bola de ki,
   * Genki Dama e baque de queda — é o que faz o buraco do meteoro ser o mesmo
   * buraco em todas as telas, entrar na lista do `welcome` de quem chegar depois
   * e furar até a lava como qualquer outro. O som sai de lá pela mesma porta
   * (`NamekAudio.estouroNoChao`, escolhido pela potência), e um segundo som aqui
   * seria o mesmo estouro tocado duas vezes.
   *
   * O que acontece aqui é o que só existe nos olhos: o clarão, a bola de fogo, a
   * poeira e a pedra voando.
   */
  estourar(msg) {
    const v = this.vagas.find((s) => s.viva && s.id === msg?.i);
    if (v) this.apagar(v);
    if (!this.fx || !msg || !Array.isArray(msg.p)) return;

    const x = msg.p[0];
    const y = msg.p[1];
    const z = msg.p[2];
    const power = Number(msg.power) || 1;
    const raio = Math.max(0.5, Number(msg.r) || 1);

    /* A poeira, a pedra, o naco de encosta e o anel de choque — o caminho de
       impacto que todo golpe deste modo já usa, com a potência que a sala usou
       para cavar. Cor quente e não a azul do ki: o que caiu ali é rocha em
       chamas. */
    this.fx.groundImpact(x, y, z, power, 0xff8c2a);
    /* E a BOLA DE FOGO por cima dele. `groundImpact` desenha um impacto; o que
       o pedido chama de "grandes explosões" é isto — um clarão do tamanho do
       raio LETAL, para que a bola de fogo tenha exatamente o tamanho da coisa
       que mata. Quem vê a bola cobrindo o próprio corpo entendeu por que
       morreu. */
    this.fx.clarao(x, y, z, raio * NAMEK.planetas.meteoro.raioLetal, 0xffd08a, 1.2);
    this.fx.fagulhas(x, y, z, raio * 1.5, 0xffb060, 26, 30 + raio * 3.5);
  }

  apagar(v) {
    v.viva = false;
    const i = this.vagas.indexOf(v);
    if (i < 0) return;
    this.rochas.setMatrixAt(i, _zero);
    this.coroas.setMatrixAt(i, _zero);
    this.marcas.setMatrixAt(i, _zero);
    this.rochas.instanceMatrix.needsUpdate = true;
    this.coroas.instanceMatrix.needsUpdate = true;
    this.marcas.instanceMatrix.needsUpdate = true;
    if (!this.vagas.some((s) => s.viva)) this.visiveis(false);
  }

  /* =============================================================== quadro == */

  /**
   * @param {number} dt
   * @param {THREE.Vector3} cameraPos só para o LOD do rastro
   * @param {number} tempoSala relógio da SALA em ms — é ele que move a rocha
   */
  update(dt, cameraPos, tempoSala = 0) {
    if (!this.rochas) return;
    let alguma = false;
    const M = NAMEK.planetas.meteoro;
    const giro = (M.giro * Math.PI) / 180;
    const corCoroa = this.coroas.instanceColor;
    const corMarca = this.marcas.instanceColor;

    for (let i = 0; i < this.vagas.length; i++) {
      const v = this.vagas[i];
      if (!v.viva) continue;

      const u = (tempoSala - v.w) / 1000 / v.dur;
      /* CHEGOU E A CONFIRMAÇÃO NÃO VEIO. O estouro é da sala (`METEOR_HIT`) e é
         ele que apaga a rocha; esta folga de 25 % do tempo de queda existe para
         o caso em que a mensagem se perde ou a conexão engasga. Sem ela, uma
         rocha ficaria parada dentro do chão pelo resto da partida — e sendo
         desenhada, porque ela é uma instância viva. */
      if (u >= 1.25) {
        this.apagar(v);
        continue;
      }
      alguma = true;

      /* Antes da largada (o pacote chegou adiantado por causa do relógio) ela
         fica na origem, esperando. Depois do impacto ela para no ponto e
         aguarda a confirmação. */
      const k = clamp01(u);
      v.x = v.ox + (v.px - v.ox) * k;
      v.y = v.oy + (v.py - v.oy) * k;
      v.z = v.oz + (v.pz - v.oz) * k;
      v.ang += giro * dt;

      /* --------------------------------------------------------- a rocha -- */
      _eixo.set(v.ax, v.ay, v.az);
      _q.setFromAxisAngle(_eixo, v.ang);
      _v.set(v.x, v.y, v.z);
      /* Escala NÃO uniforme: é o que dá silhueta própria a cada rocha a partir
         de uma geometria só. O índice da vaga é a variação — determinística,
         estável enquanto a rocha vive, e de graça. */
      _esc.set(
        v.raio,
        v.raio * (0.74 + (i % 5) * 0.11),
        v.raio * (0.82 + (i % 3) * 0.14),
      );
      _m.compose(_v, _q, _esc);
      this.rochas.setMatrixAt(i, _m);

      /* --------------------------------------------------------- a coroa --
         Escala UNIFORME (o shader dela conta com isso para a normal) e um pulso
         rápido: fogo não é um balão de plástico. */
      const pulso = 1 + Math.sin(v.ang * 3.1) * 0.06;
      const rc = v.raio * COROA_ESCALA * pulso;
      _esc.set(rc, rc, rc);
      _m.compose(_v, _q, _esc);
      this.coroas.setMatrixAt(i, _m);
      /* Ela ACENDE na descida: a atmosfera é mais densa embaixo, e o brilho
         crescendo é o que faz a queda ter direção mesmo quando a rocha está
         longe demais para o deslocamento ser visível. */
      const brilho = 0.7 + 0.5 * k;
      corCoroa.setXYZ(i, brilho, brilho, brilho);

      /* --------------------------------------------------------- a marca --
         Acende no FIM, não linearmente — é o aviso ficando urgente. E pulsa nos
         últimos vinte por cento, que é a janela em que sair de perto ainda é
         possível e já é assunto. Ver o §3 do cabeçalho. */
      let forca = 0.18 + 0.95 * k * k;
      if (k > 0.8) forca *= 0.72 + 0.28 * Math.sin(tempoSala * 0.022);
      corMarca.setXYZ(i, forca, forca, forca);

      /* --------------------------------------------------------- o fogo ---
         O rastro sai do pool de partículas que já existe, então ele não custa
         chamada de desenho nenhuma — e `NamekFx.fagulhas` já descarta sozinho o
         que está longe demais da lente (`detalhar`), que é o corte que importa
         numa chuva de vinte rochas espalhadas por novecentos metros. */
      v.rastro -= dt;
      if (this.fx && v.rastro <= 0) {
        v.rastro = M.rastro;
        this.fx.fagulhas(v.x, v.y, v.z, v.raio * 0.55, 0xff7a1e, 2, 5 + v.raio);
      }
    }

    if (!alguma) {
      this.visiveis(false);
      return;
    }
    this.rochas.instanceMatrix.needsUpdate = true;
    this.coroas.instanceMatrix.needsUpdate = true;
    corCoroa.needsUpdate = true;
    corMarca.needsUpdate = true;
  }

  /** Apaga a chuva inteira. Sala zerada, saída para o menu. */
  limpar() {
    for (const v of this.vagas) if (v.viva) this.apagar(v);
  }

  dispose() {
    /* Geometrias e materiais saem com a raiz do mundo em `NamekWorld.dispose`,
       que varre a subárvore — mesma divisão de `NamekSky.dispose`. Aqui só se
       soltam as referências. */
    this.vagas.length = 0;
    this.rochas = null;
    this.coroas = null;
    this.marcas = null;
    this.rochaMat = null;
    this.coroaMat = null;
    this.marcaMat = null;
    this.root = null;
  }
}
