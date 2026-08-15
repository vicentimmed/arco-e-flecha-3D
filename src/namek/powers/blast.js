/* ---------------------------------------------------------------------------
   A bola de ki — o tiro comum de Namekusei.

   É o ataque mais usado do modo e por larga margem: sai a seis por segundo POR
   JOGADOR enquanto o botão estiver apertado e vive 5 s (ver `NAMEK.blast.life`
   — ela cresceu para atender ao "os poderes não devem sumir"). Nada aqui pode
   custar por bola aquilo que um efeito raro pode: nem uma luz, nem um `Mesh`,
   nem um objeto novo por quadro.

   **O TETO DE 256 PASSOU A MORDER, e isso é uma decisão e não um descuido.**
   Com a vida em 5 s, quinze jogadores segurando o gatilho produzem 450 bolas —
   quase o dobro do pool. O que acontece então está escrito em `spawn`: a MAIS
   VELHA é reciclada, ou seja, a bola que já voou quatro segundos some para dar
   lugar à que acabou de sair da mão. Preferir isso a crescer o pool é escolher
   onde pagar: 450 bolas seriam 183 mil triângulos (ver o comentário das
   camadas), e o caso que as produz — quinze pessoas metralhando ao mesmo tempo,
   sem parar, por cinco segundos — é justamente aquele em que ninguém vai
   sentir falta de uma bola perdida no fim da vida dela. Medido numa partida de
   verdade, o pico fica em ~110 bolas vivas.

   Daí as três decisões que este arquivo inteiro serve:

   1. **POOL EM ARRAYS TIPADOS, EMPACOTADO.** É o desenho de
      `systems/particles.js`, e é dele de propósito: os vivos ficam no começo do
      array, morrer é trocar de lugar com o último vivo e diminuir o contador.
      Sem lista de livres, sem varredura, sem lixo. Emitir e matar custam o
      mesmo, sempre.

   2. **TRÊS `InstancedMesh` PARA TODAS ELAS** — núcleo, halo e rastro. Três
      chamadas de desenho, quer haja uma bola em voo, quer haja duzentas e
      cinquenta e seis. Um `Mesh` por bola seria 768.

   3. **NENHUMA LUZ.** O orçamento do §3 do plano dá TRÊS luzes dinâmicas ao
      jogo inteiro e o cenário já usa duas. A que sobra é do especial do jogador
      local (ver `powers/index.js`) e nunca de uma bola — uma luz por bola seria
      duzentas e cinquenta e seis, e o número não é discutível: é 3.

   ------------------------------------------------------------------- a rede

   A vida de um projétil é FUNÇÃO PURA DE (origem, direção, tempo desde o
   disparo). Um disparo é UM evento de rede; cada cliente reconstrói o voo
   inteiro a partir dele e ninguém paga um byte por quadro. É o mesmo contrato
   que a flecha e o Kamehameha do outro jogo já cumprem.

   A ÚNICA exceção é a perseguição — e é por isso que o alvo viaja dentro do
   `NC2S.BLAST`. Sem ele, cada cliente escolheria o alvo mais perto do SEU ponto
   de vista e a mesma bola voaria para lados diferentes em cada tela. Com ele, a
   divergência que sobra é a que existe entre as posições interpoladas do alvo
   nas duas telas: alguns centímetros ao longo de 1,1 s de correção. Quem julga
   o acerto é quem atirou (§8 do plano), então essa sobra não decide nada.

   ------------------------------------------------------- as contas de colisão

   As três funções analíticas do fim do arquivo moram AQUI, e não num sétimo
   módulo, porque este é o arquivo que o §4 do plano manda copiar do Kamehameha
   do arqueiro (`entities/kamehameha.js`) — a distância ponto-segmento é dele,
   linha por linha. Feixe, disco, Genki Dama e onda importam daqui: uma cópia da
   mesma conta em cinco arquivos é uma conta que envelhece em cinco metades.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { gameEvents, EventType } from "../../core/events.js";

/* Teto de bolas simultâneas. Custo: ~13 KB de `Float32Array`.
   Ele deixou de ser o pior caso aritmético quando a vida da bola dobrou — ver
   o cabeçalho, que explica por que 256 continua sendo o número certo e o que a
   sala faz quando ele estoura. */
const CAPACIDADE = 256;

/** Fração da altura de um corpo em que fica o peito. Sai de `NAMEK.fighter`, e
 *  é o ponto para o qual a perseguição mira — os pés fariam a bola cravar no
 *  chão a cada correção, a cabeça a faria passar por cima. */
const PEITO = NAMEK.fighter.chest / NAMEK.fighter.height;

/* m — acima disto a bola nem pergunta ao terreno onde está o chão.
 *
 * A conta, do próprio `shared/namek/field.js`: o ruído base soma no máximo
 * 26 + 6,5 = 32,5 m; o pico mais alto do anel vale 46 + 96 = 142 m e dois picos
 * vizinhos podem se sobrepor na saia (nunca nos topos — os centros ficam a mais
 * de 100 m e a gaussiana cai com t²); as cristas ridged acrescentam 11 m. Com
 * folga larga, nada do relevo passa de ~340 m. Errar para cima aqui não custa
 * correção nenhuma: 380 m é céu vazio em toda a arena, e o teto de voo é 520. */
const TETO_DO_RELEVO = 380;

/* -------------------------------------------------------------------- visual */

/** Branco-azulado quente do miolo. */
const COR_NUCLEO = 0xf4fbff;
/** O halo aditivo em volta — é ele que dá o tamanho aparente da bola. */
const COR_HALO = 0x5cc9ff;
/** O rastro curto atrás. */
const COR_RASTRO = 0x86dcff;
/** Quantas vezes o raio da bola mede o halo. */
const HALO_ESCALA = 2.9;
/** Comprimento do rastro, em raios. Curto de propósito: rastro longo em 234
 *  bolas simultâneas vira uma teia branca e ninguém acha o próprio tiro. */
const RASTRO_COMP = 5.4;
/** Raio do rastro na base, em raios de bola. */
const RASTRO_RAIO = 0.66;
/** s — em quanto tempo o rastro cresce até o tamanho cheio, ao sair da mão. */
const RASTRO_ABRE = 0.07;

/* Tinta por dono. As bolas dos OUTROS puxam para o quente e as suas ficam
   brancas: num tiroteio de quinze pessoas, saber num relance qual traço é seu e
   qual está vindo na sua direção é informação de jogo, não enfeite. Nenhuma das
   duas escurece — fogo inimigo que você não enxerga é pior que feio. */
const TINTA_MINHA = [1.0, 1.0, 1.0];
const TINTA_ALHEIA = [1.0, 0.9, 0.82];

/**
 * Comprimento de um vetor. **`Math.sqrt` da soma dos quadrados, e não
 * `Math.hypot`.**
 *
 * Não é micro-otimização de gosto: medido neste Node (V8, 20 milhões de
 * chamadas), `Math.hypot` de três argumentos leva 616 ms contra 257 ms da conta
 * explícita — 2,4× mais lenta, e 3,7× no caso de dois argumentos. O que ela
 * compra em troca é proteção contra overflow e underflow do quadrado
 * intermediário, que importa quando as componentes chegam perto de 1e154 ou de
 * 1e-154. Uma arena de 900 m com velocidades de 340 m/s não chega perto disso
 * em nenhum eixo.
 *
 * A perseguição sozinha faz três chamadas por bola por quadro; com 200 em voo
 * são 600, e 600 vezes a diferença é meio milissegundo de quadro comprado de
 * volta por uma linha.
 */
const comp = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

/* ------------------------------------------------------------- rascunhos ----
   Um de cada, no escopo do módulo. Todo `new THREE.Vector3()` dentro de um laço
   que roda 256 vezes por quadro é lixo que o coletor vem cobrar no meio de uma
   briga. */
const _m4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _esc = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _dirv = new THREE.Vector3();
const _cor = new THREE.Color();
const _UP = new THREE.Vector3(0, 1, 0);

/* ============================================================================
   O pool
   ========================================================================== */

export class BlastPool {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../../shared/namek/field.js").NamekField} field
   * @param {number} [capacidade]
   */
  constructor(scene, field, capacidade = CAPACIDADE) {
    this.scene = scene;
    this.field = field;
    this.cap = capacidade;
    /** Quantas bolas estão vivas. Os índices [0, live) são os vivos. */
    this.live = 0;

    /* Estado em CPU. Structure-of-arrays: o laço de integração toca só `pos`,
       `dir` e `idade`, e três varreduras lineares de `Float32Array` batem
       qualquer array de objetos que o coletor teria de perseguir. */
    this.pos = new Float32Array(capacidade * 3);
    this.dir = new Float32Array(capacidade * 3);
    this.idade = new Float32Array(capacidade);
    this.mao = new Uint8Array(capacidade);
    this.meu = new Uint8Array(capacidade);

    /* Ids são opacos (número da sala ou string) e ficam em arrays comuns
       PRÉ-DIMENSIONADOS: escrever num índice que já existe não aloca nada, e
       tentar empacotar id de rede em `Float64Array` seria inventar um formato
       novo para economizar bytes que ninguém está pagando. */
    this.id = new Array(capacidade).fill(null);
    this.dono = new Array(capacidade).fill(null);
    this.alvo = new Array(capacidade).fill(null);

    /* A BOLA DE KI É REDONDA, e antes ela não era.
     *
     * O halo era `IcosahedronGeometry(1, 0)`: um icosaedro cru, vinte faces —
     * literalmente um poliedro, e ele é a camada de FORA, ou seja, era ele que
     * desenhava a silhueta. O núcleo tinha 80 faces. O resultado é o que o
     * usuário descreveu: "os poderes rápidos que saem da mão estão meio
     * quadrados". A 0,42 m de raio passando a poucos metros da lente, um
     * vinte-faces não lê como esfera — lê como pedra lapidada.
     *
     * Subdivisão 2 no núcleo (320 faces) e 1 no halo (80): a silhueta do núcleo
     * vira um polígono de ~20 lados, que a esta escala é indistinguível de um
     * círculo, e o halo — que é translúcido a 0,26 e some contra o fundo —
     * fecha o contorno sem pagar a subdivisão cheia.
     *
     * O CUSTO, porque ele não é desprezível e o §3 do plano cobra: no teto de
     * 256 bolas simultâneas são 256 × (320 + 80 + 8) ≈ 104 mil triângulos,
     * contra 28 mil antes. É a maior linha de triângulos do modo depois do
     * cenário (~173 mil), e ela cabe: as chamadas de desenho — que são o
     * recurso realmente escasso aqui — continuam TRÊS, porque isto é
     * `InstancedMesh` e a contagem de instâncias não mudou. Num tiroteio real
     * medido, o número de bolas vivas fica perto de 110, ou ~45 mil triângulos.
     *
     * Uma esfera de verdade (`SphereGeometry`) daria a mesma silhueta por
     * triângulo parecido, e o icosaedro foi mantido por um motivo bobo e real:
     * ele não tem polos, então não há um aperto de vértices no topo da bola
     * para o brilho aditivo acusar. */
    this.nucleo = this.camada(
      new THREE.IcosahedronGeometry(1, 2),
      COR_NUCLEO,
      0.95,
      13,
    );
    this.halo = this.camada(new THREE.IcosahedronGeometry(1, 1), COR_HALO, 0.26, 11);
    this.rastro = this.camada(cauda(), COR_RASTRO, 0.2, 10);

    /* As três, num array MONTADO UMA VEZ.
     *
     * `for (const m of [a, b, c])` é a mesma coisa escrita mais curto e custa um
     * array novo e um iterador novo — por quadro em `escrever`, e por bola morta
     * em `swapRemove`. Com 90 tiros por segundo isso é lixo gerado no ritmo do
     * combate, e o §3 do plano pede zero. Foi medido: era a única alocação que
     * sobrava no regime. */
    this.camadas = [this.nucleo, this.halo, this.rastro];
  }

  /**
   * Uma das três camadas.
   *
   * `frustumCulled = false` porque a caixa envolvente de um lote que se move
   * inteiro a cada quadro ou é recalculada por quadro (caro) ou descarta bolas
   * válidas (pior). O teto de custo já é a capacidade.
   */
  camada(geo, cor, opacidade, ordem) {
    const mat = new THREE.MeshBasicMaterial({
      color: cor,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: opacidade,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /* A cor por instância é criada AQUI e não pelo primeiro `setColorAt`: o
       renderer decide `USE_INSTANCING_COLOR` na compilação do programa, e um
       atributo que aparece no meio da partida recompila o shader — engasgo
       visível, exatamente no primeiro tiro. */
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.cap * 3).fill(1),
      3,
    );
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = ordem;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    return mesh;
  }

  /* ------------------------------------------------------------- nascimento */

  /**
   * Uma bola. Ver o contrato em `powers/index.js`.
   *
   * @param {object} o
   * @param {number|string} o.id      id do disparo (o `q` do protocolo)
   * @param {number|string} o.owner   quem atirou
   * @param {{x,y,z}} o.origem        a mão
   * @param {{x,y,z}} o.dir           direção, será normalizada
   * @param {number} [o.hand]         0 esquerda, 1 direita — só visual
   * @param {number|string|null} [o.target] alvo TRAVADO no disparo (§6.1)
   * @param {boolean} [o.local]       é o meu tiro
   * @returns {number} o índice ocupado
   */
  spawn({ id, owner, origem, dir, hand = 0, target = null, local = false }) {
    let i;
    if (this.live < this.cap) {
      i = this.live++;
    } else {
      /* CHEIO. Recicla a MAIS VELHA, e não a nova: quem acabou de apertar o
         botão pagou ki por aquele tiro e está olhando para ele. A bola que já
         voou dois segundos, ninguém procura mais. A varredura só acontece no
         estouro do teto, que é um caso de sala lotada em fogo cerrado. */
      i = 0;
      let maisVelha = -1;
      for (let k = 0; k < this.live; k++) {
        if (this.idade[k] > maisVelha) {
          maisVelha = this.idade[k];
          i = k;
        }
      }
    }

    const i3 = i * 3;
    this.pos[i3] = origem.x;
    this.pos[i3 + 1] = origem.y;
    this.pos[i3 + 2] = origem.z;

    const inv = 1 / (comp(dir.x, dir.y, dir.z) || 1);
    this.dir[i3] = dir.x * inv;
    this.dir[i3 + 1] = dir.y * inv;
    this.dir[i3 + 2] = dir.z * inv;

    this.idade[i] = 0;
    this.mao[i] = hand ? 1 : 0;
    this.meu[i] = local ? 1 : 0;
    this.id[i] = id ?? null;
    this.dono[i] = owner ?? null;
    /* Alvo do próprio dono não existe: a bola voaria de volta para a mão. */
    this.alvo[i] = target === owner ? null : (target ?? null);

    const t = local ? TINTA_MINHA : TINTA_ALHEIA;
    this.pintar(i, t[0], t[1], t[2]);
    return i;
  }

  /** Escreve a tinta da bola `i` nas três camadas. */
  pintar(i, r, g, b) {
    const i3 = i * 3;
    const a = this.nucleo.instanceColor.array;
    const c = this.halo.instanceColor.array;
    const d = this.rastro.instanceColor.array;
    a[i3] = c[i3] = d[i3] = r;
    a[i3 + 1] = c[i3 + 1] = g;
    a[i3 + 2] = c[i3 + 2] = b;
    /* O rastro puxa mais para o azul que o núcleo: o que fica para trás é a
       energia já esfriando, e um traço da mesma cor da cabeça faz a bola
       parecer um bastão em vez de uma coisa em voo. */
    d[i3 + 1] = g * 0.96;
    d[i3 + 2] = b;
    this.nucleo.instanceColor.needsUpdate = true;
    this.halo.instanceColor.needsUpdate = true;
    this.rastro.instanceColor.needsUpdate = true;
  }

  /** Troca a morta pela última viva. O pool inteiro é esta função. */
  swapRemove(i) {
    const ultimo = --this.live;
    if (i === ultimo) return;
    const i3 = i * 3;
    const u3 = ultimo * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[u3 + k];
      this.dir[i3 + k] = this.dir[u3 + k];
    }
    this.idade[i] = this.idade[ultimo];
    this.mao[i] = this.mao[ultimo];
    this.meu[i] = this.meu[ultimo];
    this.id[i] = this.id[ultimo];
    this.dono[i] = this.dono[ultimo];
    this.alvo[i] = this.alvo[ultimo];
    for (let c = 0; c < 3; c++) {
      const mesh = this.camadas[c];
      const a = mesh.instanceColor.array;
      a[i3] = a[u3];
      a[i3 + 1] = a[u3 + 1];
      a[i3 + 2] = a[u3 + 2];
      mesh.instanceColor.needsUpdate = true;
    }
  }

  /* ------------------------------------------------------------------ passo */

  /**
   * Um quadro de todas as bolas.
   *
   * **Zero alocação.** Nenhum literal de objeto, nenhum `for...of` sobre coisa
   * que não seja um array pequeno e fixo, nenhum vetor novo. O que sai daqui
   * são registros REUSADOS que o `relato` empresta — ver `powers/index.js`.
   *
   * @param {number} dt
   * @param {Array<{id,x,y,z,raio,altura,vivo}>} alvos em espaço de mundo, pés em y
   * @param {number|string} localId quem é o dono desta tela
   * @param {object} relato o cartório de acontecimentos
   */
  update(dt, alvos, localId, relato, cenario) {
    const B = NAMEK.blast;
    const H = NAMEK.blast.homing;
    const duracaoHoming = H.duration;
    const cosCone = Math.cos((H.cone * Math.PI) / 180);
    const giroMax = (H.turnRate * Math.PI) / 180;
    const raio2 = B.hitRadius * B.hitRadius;
    const nAlvos = alvos.length;

    for (let i = this.live - 1; i >= 0; i--) {
      this.idade[i] += dt;
      if (this.idade[i] >= B.life) {
        /* Fim de vida no vazio: some sem estardalhaço. Uma bola que explode ao
           acabar o prazo marcaria no céu um ponto em que nada aconteceu. */
        this.swapRemove(i);
        continue;
      }

      const i3 = i * 3;
      if (this.alvo[i] !== null && this.idade[i] <= duracaoHoming) {
        this.perseguir(i, i3, alvos, nAlvos, dt, cosCone, giroMax);
      }

      /* O AVANÇO, SUBDIVIDIDO SE PRECISAR.
       *
       * A 78 m/s, um quadro de 60 Hz anda 1,3 m e o raio de acerto é 1,5 m —
       * não há como atravessar ninguém. A 30 Hz o passo é 2,6 m e passa a
       * haver: a bola estaria de um lado do corpo num quadro e do outro no
       * seguinte, sem nunca ter estado perto. Subdividir o passo pelo próprio
       * raio de acerto fecha isso pelo preço de um teste a mais só quando o
       * quadro estica, e é o mesmo que se faria com um teste varrido, sem
       * escrever a distância segmento-segmento. */
      const avanco = B.speed * dt;
      const n = avanco > B.hitRadius ? Math.ceil(avanco / B.hitRadius) : 1;
      const passo = avanco / n;
      const dx = this.dir[i3];
      const dy = this.dir[i3 + 1];
      const dz = this.dir[i3 + 2];
      let x = this.pos[i3];
      let y = this.pos[i3 + 1];
      let z = this.pos[i3 + 2];
      let morreu = false;

      for (let s = 0; s < n; s++) {
        x += dx * passo;
        y += dy * passo;
        z += dz * passo;

        /* GENTE. Testada antes do chão: uma bola que pega alguém rasante no
           terreno tem de contar como acerto, não como cratera. */
        const vitima = this.acharVitima(alvos, nAlvos, this.dono[i], x, y, z, raio2);
        if (vitima) {
          this.estourar(x, y, z, false);
          if (this.dono[i] === localId) {
            const e = relato.acerto();
            e.blastId = this.id[i];
            e.owner = this.dono[i];
            e.victim = vitima.id;
            e.p.x = x;
            e.p.y = y;
            e.p.z = z;
          }
          morreu = true;
          break;
        }

        /* O CHÃO. */
        if (y < TETO_DO_RELEVO && y <= this.field.heightAt(x, z)) {
          this.estourar(x, y, z, true);
          if (this.dono[i] === localId) {
            const e = relato.chao();
            e.owner = this.dono[i];
            e.p.x = x;
            e.p.y = y;
            e.p.z = z;
            e.power = B.power;
            /* Bacia de sempre. Escrito mesmo valendo 1: o registro da fila e
               REAPROVEITADO, e um `fundo` deixado pelo Kamehameha do quadro
               anterior viraria um poco aqui. */
            e.fundo = 1;
          }
          morreu = true;
          break;
        }

        /* AS PEÇAS DO CENÁRIO — rocha, ajisa, casa.
         *
         * Antes só o chão parava a bola, e a consequência era que um tiro
         * mirado numa pedra a ATRAVESSAVA e ia estourar no chão atrás dela. A
         * peça até caía, mas por tabela: o `derrubarPorPerto` do estouro lá
         * atrás a alcançava se estivesse dentro do raio.
         *
         * Parando aqui, o estouro acontece NA peça — e como quem trata o
         * evento de chão é o mesmo `derrubarPorPerto` de sempre, ela cai e a
         * cratera abre no ponto certo, sem nenhuma mensagem nova de rede.
         *
         * O teste é contra a lista curta da célula (`propsNear`), não contra
         * as ~300 peças do cenário. */
        if (cenario && y < TETO_DO_RELEVO) {
          const perto = cenario.propsNear(x, z);
          if (perto) {
            for (let k = 0; k < perto.length; k++) {
              const p = perto[k];
              if (p.vida <= 0) continue;
              const dx = p.x - x;
              const dy = p.y - y;
              const dz = p.z - z;
              const alcance = p.raio + B.radius;
              if (dx * dx + dy * dy + dz * dz > alcance * alcance) continue;
              this.estourar(x, y, z, true);
              if (this.dono[i] === localId) {
                const e = relato.chao();
                e.owner = this.dono[i];
                e.p.x = x;
                e.p.y = y;
                e.p.z = z;
                e.power = B.power;
                /* Bacia de sempre. Escrito mesmo valendo 1: o registro da fila e
                   REAPROVEITADO, e um `fundo` deixado pelo Kamehameha do quadro
                   anterior viraria um poco aqui. */
                e.fundo = 1;
              }
              morreu = true;
              break;
            }
            if (morreu) break;
          }
        }
      }

      if (morreu) {
        this.swapRemove(i);
        continue;
      }
      this.pos[i3] = x;
      this.pos[i3 + 1] = y;
      this.pos[i3 + 2] = z;
    }

    this.escrever();
  }

  /**
   * A PERSEGUIÇÃO FRACA. §6.1 do plano, e cada linha aqui segura a palavra
   * "levemente".
   *
   * Três travas, e as três são necessárias:
   *
   * • **Teto de giro** (95°/s). Sem ele a bola vira instantaneamente e nunca
   *   erra — o jogador deixa de ter o que fazer.
   * • **Janela** (1,1 s). Depois disso ela segue reta, SEMPRE. Uma bola que
   *   corrige a vida inteira acerta de qualquer lugar, e a distância deixa de
   *   proteger.
   * • **Cone** (35°). Fora dele não corrige. É o que faz o passo lateral
   *   funcionar: saia do cone e a bola vai embora reta, e sair do cone é uma
   *   decisão do jogador — que é exatamente o que se quer preservar.
   *
   * O alvo NÃO é reavaliado: ele foi travado no disparo e viajou na mensagem.
   * Bola que troca de alvo no meio do voo lê como bug, e seria também a única
   * coisa deste modo que duas telas não conseguiriam concordar.
   */
  perseguir(i, i3, alvos, nAlvos, dt, cosCone, giroMax) {
    const idAlvo = this.alvo[i];
    let a = null;
    for (let k = 0; k < nAlvos; k++) {
      if (alvos[k].id === idAlvo) {
        a = alvos[k];
        break;
      }
    }
    /* Alvo que morreu, saiu ou nunca existiu nesta tela: a bola segue reta e a
       trava some para não pagar a busca de novo. */
    if (!a || a.vivo === false) {
      this.alvo[i] = null;
      return;
    }

    let tx = a.x - this.pos[i3];
    let ty = a.y + a.altura * PEITO - this.pos[i3 + 1];
    let tz = a.z - this.pos[i3 + 2];
    const dist = comp(tx, ty, tz);
    if (dist < 1e-3) return;
    tx /= dist;
    ty /= dist;
    tz /= dist;

    const dx = this.dir[i3];
    const dy = this.dir[i3 + 1];
    const dz = this.dir[i3 + 2];
    const cos = dx * tx + dy * ty + dz * tz;
    if (cos < cosCone) return; // fora do cone: reta, e ponto
    if (cos > 0.999999) return; // já apontando: nada a girar

    /* Gira a direção EM DIREÇÃO ao alvo, no máximo `giroMax·dt` radianos.
       A componente de `t` ortogonal a `d` dá o eixo do plano dos dois vetores,
       e a rotação vira duas multiplicações — sem quaternion, sem eixo, sem
       normalização de cruz. */
    const ang = Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
    const passo = Math.min(ang, giroMax * dt);
    let ox = tx - dx * cos;
    let oy = ty - dy * cos;
    let oz = tz - dz * cos;
    const olen = comp(ox, oy, oz);
    if (olen < 1e-6) return;
    ox /= olen;
    oy /= olen;
    oz /= olen;

    const c = Math.cos(passo);
    const s = Math.sin(passo);
    let nx = dx * c + ox * s;
    let ny = dy * c + oy * s;
    let nz = dz * c + oz * s;
    const inv = 1 / (comp(nx, ny, nz) || 1);
    this.dir[i3] = nx * inv;
    this.dir[i3 + 1] = ny * inv;
    this.dir[i3 + 2] = nz * inv;
  }

  /** O primeiro alvo cuja cápsula está dentro do raio de acerto. */
  acharVitima(alvos, nAlvos, dono, x, y, z, raio2) {
    for (let k = 0; k < nAlvos; k++) {
      const a = alvos[k];
      if (!atingivel(a, dono)) continue;
      if (distancia2AoAlvo(a, x, y, z) <= raio2) return a;
    }
    return null;
  }

  /**
   * Apaga as bolas ALHEIAS dentro de uma esfera. É a onda de empurrão varrendo
   * o que vinha na direção de quem a soltou — ver `burst.js`.
   *
   * As do próprio dono sobrevivem: uma onda que apagasse o próprio fogo de
   * cobertura seria uma defesa que também desarma quem a usou.
   *
   * @returns {number} quantas foram varridas
   */
  varrer(x, y, z, raio, dono) {
    const r2 = raio * raio;
    let n = 0;
    for (let i = this.live - 1; i >= 0; i--) {
      if (this.dono[i] === dono) continue;
      const i3 = i * 3;
      const dx = this.pos[i3] - x;
      const dy = this.pos[i3 + 1] - y;
      const dz = this.pos[i3 + 2] - z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      this.estourar(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2], false);
      this.swapRemove(i);
      n++;
    }
    return n;
  }

  /**
   * O estouro.
   *
   * Fagulha aditiva e curta, e SÓ no impacto — nunca por quadro e nunca no
   * disparo. A conta é implacável: 15 jogadores a 6 tiros/s são 90 disparos por
   * segundo, e um sopro de boca por disparo consumiria o lote aditivo inteiro
   * de `systems/particles.js` (192 partículas) três vezes por segundo, apagando
   * a poeira do chão, a lasca do cenário e a aura de quem carrega ki. O clarão
   * da boca já é o próprio rastro nascendo.
   */
  estourar(x, y, z, noChao) {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x, y, z },
      count: 7,
      color: COR_HALO,
      speed: 11,
      spread: 1,
      size: 0.22,
      grow: 1.6,
      life: 0.26,
      gravity: 0,
      drag: 3.2,
      alpha: 1,
      additive: true,
    });
    if (!noChao) return;
    /* No chão sai terra também: é o que diz ao jogador que aquele tiro virou
       cratera, e a cratera é estado COMPARTILHADO (§7 do plano) — o buraco vai
       ficar lá, então o impacto precisa ter peso. */
    gameEvents.emit(EventType.PARTICLES, {
      position: { x, y, z },
      count: 8,
      color: 0x6f7f52,
      speed: 4.4,
      spread: 0.55,
      direction: { x: 0, y: 1, z: 0 },
      size: 0.3,
      grow: 2.1,
      life: 0.7,
      gravity: -NAMEK.fighter.gravity * 0.4,
      drag: 1.5,
      alpha: 0.7,
    });
  }

  /* --------------------------------------------------------------- desenho  */

  /** Escreve as matrizes das três camadas. Uma passada, três `setMatrixAt`. */
  escrever() {
    const B = NAMEK.blast;
    for (let i = 0; i < this.live; i++) {
      const i3 = i * 3;
      const x = this.pos[i3];
      const y = this.pos[i3 + 1];
      const z = this.pos[i3 + 2];

      /* O pulso da espessura, defasado pela MÃO: as duas mãos alternam a 6/s e,
         sem defasagem, as bolas piscam em uníssono e a rajada vira um
         estroboscópio. */
      const fase = this.idade[i] * 38 + this.mao[i] * Math.PI;
      const pulso = 1 + Math.sin(fase) * 0.09;
      const r = B.radius * pulso;

      // Esfera não tem orientação: escala e translação bastam, e sai mais
      // barato que compor um quaternion que não seria usado.
      _m4.makeScale(r, r, r);
      _m4.setPosition(x, y, z);
      this.nucleo.setMatrixAt(i, _m4);

      const rh = B.radius * HALO_ESCALA * (2 - pulso);
      _m4.makeScale(rh, rh, rh);
      _m4.setPosition(x, y, z);
      this.halo.setMatrixAt(i, _m4);

      _dirv.set(this.dir[i3], this.dir[i3 + 1], this.dir[i3 + 2]);
      _quat.setFromUnitVectors(_UP, _dirv);
      _pos.set(x, y, z);
      const abre = Math.min(1, this.idade[i] / RASTRO_ABRE);
      const rr = B.radius * RASTRO_RAIO;
      _esc.set(rr, B.radius * RASTRO_COMP * abre, rr);
      _m4.compose(_pos, _quat, _esc);
      this.rastro.setMatrixAt(i, _m4);
    }

    for (let c = 0; c < 3; c++) {
      const mesh = this.camadas[c];
      mesh.count = this.live;
      mesh.visible = this.live > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  get count() {
    return this.live;
  }

  clear() {
    this.live = 0;
    for (const mesh of this.camadas) {
      mesh.count = 0;
      mesh.visible = false;
    }
  }

  dispose() {
    for (const mesh of this.camadas) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
  }
}

/* ============================================================================
   Geometria do rastro
   ========================================================================== */

/**
 * O cone que fica atrás da bola.
 *
 * Ponta para trás e base na bola: é a leitura de "isto veio de lá e vai para
 * cá". Aberto nas duas extremidades porque as tampas nunca são vistas — o
 * núcleo cobre a base, e a ponta é um ponto.
 */
function cauda() {
  const geo = new THREE.ConeGeometry(1, 1, 8, 1, true);
  // Nasce com o ápice em +0,5 e a base em −0,5. Vira e desloca para que a base
  // fique na origem (onde a bola está) e o ápice em −1 (atrás dela), e aí
  // escalar em Y é escolher o comprimento do rastro, direto.
  geo.rotateX(Math.PI);
  geo.translate(0, -0.5, 0);
  return geo;
}

/* ============================================================================
   Reciclagem de pool

   Os quatro poderes que têm pool de OBJETOS (feixe, disco, Genki Dama, onda)
   escolhem vaga do mesmo jeito, e a regra que importa é a segunda.
   ========================================================================== */

/**
 * Uma vaga livre no pool, ou a melhor para reciclar.
 *
 * **O golpe do jogador local nunca é roubado enquanto houver um alheio para
 * reciclar.** É a única regra desta função que não é óbvia, e ela conserta um
 * caso real: com seis vagas e oito disparos no mesmo quadro, a busca pelo "mais
 * adiantado" encontra todos empatados em `t = 0` e escolhe o primeiro — que é
 * justamente o do jogador, porque foi ele quem disparou primeiro. O sintoma é o
 * pior possível: você aperta a tecla, paga a barra inteira de ki, vê a pose de
 * carga, e o feixe não sai porque alguém do outro lado da arena disparou depois
 * de você.
 *
 * Fora isso, recicla o mais ADIANTADO: ele é o que já está dissipando, e é o
 * que ninguém está olhando.
 *
 * @param {Array<{viva:boolean,t:number,local:boolean,apagar:Function}>} pool
 */
export function pegarVaga(pool) {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].viva) return pool[i];
  }
  let alheio = null;
  let maiorAlheio = -1;
  let meu = null;
  let maiorMeu = -1;
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i];
    if (e.local) {
      if (e.t > maiorMeu) {
        maiorMeu = e.t;
        meu = e;
      }
    } else if (e.t > maiorAlheio) {
      maiorAlheio = e.t;
      alheio = e;
    }
  }
  const escolhido = alheio ?? meu ?? pool[0];
  /* Apagar antes de reacender não é higiene, é correção: o feixe carrega uma
     tabela de vítimas com exposição acumulada e o disco uma lista de quem já
     foi cortado. Reacender por cima faria o golpe novo cobrar, no primeiro
     despejo, o tempo que o golpe anterior tinha juntado. */
  escolhido.apagar();
  return escolhido;
}

/* ============================================================================
   As contas analíticas — o §4 do plano

   Não há Rapier em Namekusei e não vai haver. Colisão aqui é a distância entre
   um ponto e um segmento, três vezes: contra a cápsula de um lutador, contra o
   eixo vivo de um feixe, e contra o chão por `heightAt`. É o que o Kamehameha
   do arqueiro já faz, e as duas primeiras são a `distanciaAoFeixe` dele.
   ========================================================================== */

/**
 * Distância AO QUADRADO de um ponto à cápsula de um lutador.
 *
 * Ao quadrado porque quem chama compara com um raio conhecido, e uma raiz
 * quadrada por alvo por bola por subpasso — 200 × 15 × 2 por quadro — é raiz
 * quadrada que ninguém precisou tirar.
 *
 * A cápsula é VERTICAL, sempre: um lutador de Namekusei não tumbla (§4 do
 * plano). Com o eixo alinhado em Y, a projeção do ponto sobre o segmento vira
 * um `clamp` e some a álgebra de ponto-segmento genérico.
 *
 *      cabeça  ─╮  y + altura − raio
 *               │
 *               │   ← o eixo, e é dele que se mede
 *               │
 *      pés     ─╯  y + raio
 */
/**
 * Este alvo pode ser atingido AGORA?
 *
 * Três recusas, e a terceira é a que não é óbvia:
 *
 * • morto (`vivo === false`) — nada acerta um corpo caído;
 * • o próprio dono — ninguém se acerta com o próprio tiro;
 * • **invulnerável.** Quem acabou de renascer passa `NAMEK.respawn.invuln`
 *   segundos piscando (§ do `respawn` no config), e piscando quer dizer
 *   INTANGÍVEL: o projétil atravessa. Sem esta linha o tiro morreria nele, a
 *   mensagem subiria e a sala a recusaria — o dano não sairia, mas na tela
 *   ficaria a explosão de um acerto que não aconteceu, em cima justamente da
 *   pessoa que o jogo está protegendo. `invuln` é opcional no alvo: quem não
 *   manda a chave é tratado como tangível.
 */
export function atingivel(alvo, dono) {
  return alvo.vivo !== false && alvo.invuln !== true && alvo.id !== dono;
}

export function distancia2AoAlvo(alvo, x, y, z) {
  const dx = x - alvo.x;
  const dz = z - alvo.z;
  const de = alvo.y + alvo.raio;
  const ate = alvo.y + alvo.altura - alvo.raio;
  const cy = y < de ? de : y > ate ? ate : y;
  const dy = y - cy;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Distância de um ponto ao trecho VIVO de um feixe.
 *
 * É a `distanciaAoFeixe` de `entities/kamehameha.js`, com os componentes
 * soltos em vez de um `THREE.Vector3` — o feixe daqui testa quinze alvos por
 * quadro e não tem por que empacotar três floats para desempacotá-los na linha
 * seguinte. `de` e `ate` são as distâncias da cauda e da frente ao longo do
 * raio: é o que faz o trecho já dissipado deixar de matar.
 */
export function distanciaAoFeixe(ox, oy, oz, dx, dy, dz, de, ate, x, y, z) {
  const px = x - ox;
  const py = y - oy;
  const pz = z - oz;
  let t = px * dx + py * dy + pz * dz;
  t = t < de ? de : t > ate ? ate : t;
  return comp(px - dx * t, py - dy * t, pz - dz * t);
}

/**
 * Marcha pelo raio até achar o chão. Passo grosso, depois refinado.
 *
 * Cópia deliberada do `acharFim` de `entities/kamehameha.js`, com o aviso dele
 * junto: **SÓ O CHÃO PARA UM FEIXE.** A tentação é recusar também o ponto em
 * que o mundo "acaba" (fora do círculo da arena, dentro do mar), e lá isso
 * custou um bug com nome e sobrenome — um feixe disparado a 45° parava no
 * vácuo, contra nada, com a bola de explosão inchando a duzentos metros de
 * altura. `heightAt` é definida em qualquer x e z, e o teste de altura sozinho
 * já cobre o rasante. Sem obstáculo, o feixe vai até o alcance e some.
 *
 * Resolvido UMA vez, quando o feixe sai: a direção está travada e o terreno não
 * muda durante os poucos segundos de vida dele, então marchar agora sai bem
 * mais barato que perguntar a altura a cada quadro.
 */
export function acharChao(field, ox, oy, oz, dx, dy, dz, alcanceMax) {
  let ultimo = 0;
  for (let d = 4; d <= alcanceMax; d += 4) {
    const y = oy + dy * d;
    if (y < TETO_DO_RELEVO && y <= field.heightAt(ox + dx * d, oz + dz * d)) {
      // Refina em meio metro: um erro de 4 m no ponto da explosão apareceria
      // como a bola de fogo enterrada no morro ou flutuando acima dele.
      for (let f = ultimo; f <= d; f += 0.5) {
        const fy = oy + dy * f;
        if (fy <= field.heightAt(ox + dx * f, oz + dz * f)) return f;
      }
      return d;
    }
    ultimo = d;
  }
  return alcanceMax;
}

/**
 * Escolhe o alvo de um disparo. §6.1: **o mais próximo do centro da tela,
 * dentro de `NAMEK.blast.homing.acquire` metros, no instante do tiro.**
 *
 * Mora aqui, e não no sistema de entrada, porque a regra é do projétil: quem
 * atira precisa mandar este id dentro do `NC2S.BLAST` para que a bola persiga a
 * MESMA pessoa em todas as telas, e a única forma de garantir isso é ter uma
 * implementação só da escolha.
 *
 * "Centro da tela" é o menor ângulo com a direção da mira, não a menor
 * distância: quem está a 8 m atrás do seu ombro não é para quem você está
 * olhando, e mirar por proximidade daria a sensação de a bola escolher sozinha.
 */
export function escolherAlvo(alvos, ox, oy, oz, dx, dy, dz, meuId, raio = null) {
  if (!alvos) return null;
  /* O alcance é o da rajada por padrão e o do GOLPE quando ele tem o próprio.
     O Kienzan e o Galick Gun perseguem (ver `homing` em `NAMEK.specials`) e
     escolhem de muito mais longe que uma bola de ki — 300 m contra 50 —, porque
     eles são disparados de longe e a promessa deles é que chegam. */
  const R = raio ?? NAMEK.blast.homing.acquire;
  let melhor = null;
  let melhorCos = 0; // < 0 é atrás de quem atirou: nunca
  for (let k = 0; k < alvos.length; k++) {
    const a = alvos[k];
    // Travar em quem está piscando gastaria a correção da bola numa pessoa que
    // ela vai atravessar — ver `atingivel`.
    if (!atingivel(a, meuId)) continue;
    const tx = a.x - ox;
    const ty = a.y + a.altura * PEITO - oy;
    const tz = a.z - oz;
    const d = comp(tx, ty, tz);
    if (d > R || d < 1e-3) continue;
    const cos = (tx * dx + ty * dy + tz * dz) / d;
    if (cos > melhorCos) {
      melhorCos = cos;
      melhor = a.id;
    }
  }
  return melhor;
}

/**
 * Quem tem este id na lista de alvos, ou null. Busca linear porque a lista tem
 * quinze entradas no pior caso e um `Map` reconstruído por quadro custaria mais
 * do que a varredura inteira.
 */
export function alvoPorId(alvos, id) {
  if (id === null || id === undefined || !alvos) return null;
  for (let k = 0; k < alvos.length; k++) if (alvos[k].id === id) return alvos[k];
  return null;
}

/**
 * Quanto este golpe pode girar NESTE passo, em radianos.
 *
 * Duas travas numa conta só: o teto por segundo (`turnRate`, que todo golpe que
 * persegue tem) e o teto da correção TOTAL (`arcMax`, que só alguns declaram).
 * O segundo precisa de um acumulador, e o acumulador é do projétil — por isso
 * ele entra como parâmetro em vez de morar aqui.
 *
 * Mora junto de `perseguirPonto`, e não em cada golpe, porque a alternativa era
 * um campo de configuração que os arquivos que não o leem ignoram em silêncio:
 * declarar `arcMax` num Kienzan e ver o disco contornar do mesmo jeito é o tipo
 * de armadilha que custa uma tarde para achar.
 *
 * @param {object} H o bloco `homing` do golpe
 * @param {number} dt segundos
 * @param {number} arco radianos já gastos do teto total
 * @returns {number} radianos — 0 quando o teto total acabou
 */
export function passoDeGiro(H, dt, arco) {
  const passo = ((H.turnRate * Math.PI) / 180) * dt;
  if (H.arcMax === undefined) return passo;
  const sobra = (H.arcMax * Math.PI) / 180 - arco;
  return sobra <= 0 ? 0 : passo < sobra ? passo : sobra;
}

/**
 * Gira uma direção EM DIREÇÃO a um ponto, com teto de ângulo. O motor da
 * perseguição, compartilhado.
 *
 * É a mesma conta que `Bolas.perseguir` faz sobre os arrays de bolas, extraída
 * para os golpes que perseguem um a um (o Kienzan e o Galick Gun) — e extraída,
 * e não copiada, porque a fórmula tem uma sutileza que ninguém acerta duas
 * vezes seguidas: a rotação é feita no PLANO dos dois vetores, usando a
 * componente do alvo ortogonal à direção como segundo eixo. Duas
 * multiplicações, sem quaternion e sem produto vetorial.
 *
 * As três travas são as do §6.1 do plano, e valem para todo golpe que persegue:
 * teto de giro por segundo, prazo de validade, e um CONE fora do qual não há
 * correção nenhuma. É o cone que faz o passo lateral funcionar — sair dele é
 * uma decisão de quem está fugindo, e é ela que precisa continuar valendo
 * alguma coisa.
 *
 * A QUARTA TRAVA — o teto de correção TOTAL (`arcMax`) — não mora aqui, e é de
 * propósito: ela é um acumulador, e acumular é do projétil. Quem a usa (o
 * Kamehameha e a Genki Dama) soma este retorno e encolhe o próprio `maxRad` até
 * zero. Ver `NAMEK.specials.kamehameha.homing`.
 *
 * @param {{x,y,z}} dir versor mutado no lugar
 * @param {number} tx alvo, em espaço de mundo
 * @param {number} cosCone cosseno do meio-ângulo do cone
 * @param {number} maxRad teto de giro DESTE passo, em radianos
 * @returns {number} radianos efetivamente girados — 0 quando não houve
 *   correção, o que continua sendo falso para quem só quisesse o sim ou não
 */
export function perseguirPonto(dir, tx, ty, tz, ox, oy, oz, cosCone, maxRad) {
  if (!(maxRad > 0)) return 0;
  let ax = tx - ox;
  let ay = ty - oy;
  let az = tz - oz;
  const dist = comp(ax, ay, az);
  if (dist < 1e-3) return 0;
  ax /= dist;
  ay /= dist;
  az /= dist;

  const cos = dir.x * ax + dir.y * ay + dir.z * az;
  if (cos < cosCone) return 0; // fora do cone: reta, e ponto
  if (cos > 0.999999) return 0; // já apontando: nada a girar

  const ang = Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
  const passo = ang < maxRad ? ang : maxRad;
  let px = ax - dir.x * cos;
  let py = ay - dir.y * cos;
  let pz = az - dir.z * cos;
  const plen = comp(px, py, pz);
  if (plen < 1e-6) return 0;
  px /= plen;
  py /= plen;
  pz /= plen;

  const c = Math.cos(passo);
  const s = Math.sin(passo);
  const nx = dir.x * c + px * s;
  const ny = dir.y * c + py * s;
  const nz = dir.z * c + pz * s;
  const inv = 1 / (comp(nx, ny, nz) || 1);
  dir.x = nx * inv;
  dir.y = ny * inv;
  dir.z = nz * inv;
  return passo;
}

export { PEITO, TETO_DO_RELEVO };
