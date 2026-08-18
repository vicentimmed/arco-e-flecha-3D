/* ---------------------------------------------------------------------------
   O Kienzan — o disco cortante.

   É o especial que NÃO é um feixe e NÃO é uma bola, e a diferença é o ponto
   dele. Os outros três ocupam o céu: o Kamehameha é uma parede de luz de meio
   quilômetro, o Galick Gun é uma pedrada de energia, a Genki Dama é uma lua. O
   disco é uma LÂMINA — a menor área de acerto do repertório, silenciosa, a
   105 m/s. Quem morre para ele morreu porque não viu.

   Quatro regras que separam este arquivo dos vizinhos:

   • **NÃO EXPLODE.** Nunca. Ele corta e segue. A tentação de dar um estouro ao
     impacto é grande e é errada: o golpe todo é "aquilo passou por mim", e uma
     bola de fogo apagaria a única leitura que ele tem.
   • **Corta de uma vez** — `damage` em `NAMEK.specials.disk`, não `dps`. Quem
     encosta leva os 40 inteiros, uma vez só, e o disco continua o voo. Um
     disco que morre no primeiro corpo seria uma bola de ki cara.
   • **Atravessa quem já cortou.** A tabela de cortados existe para isso: sem
     ela, ficar dentro do plano do disco por dois quadros custaria o dobro.
   • **PERSEGUE MAIS QUE TUDO, e dá para escapar de um jeito só.** Ver
     `perseguir` — a curva dele tem 56 m de raio (105 m/s sobre 108°/s) e ele
     corrige a VIDA INTEIRA, sem teto de arco: 486° de orçamento, contra os 176°
     do Galick Gun. Ele acompanha quem foge em linha reta e perde quem arranca DE
     LADO COM O BURST, e só. As duas metades são o pedido, e as duas foram
     medidas — e remedidas quando o disco cresceu.

   O que o para é o CHÃO, como tudo neste modo — e ali ele abre a rasgadura de
   `power: 1.4`, que é uma cicatriz e não uma cratera.

   -------------------------------------------------------------------- a forma

   O disco fica de PÉ e o plano dele contém a direção do voo: é uma serra, não
   um frisbee. Um disco visto de frente é um círculo, e um círculo brilhante
   voando lê como bola de energia — que é o outro golpe. De perfil ele é um
   traço, e um traço voando lê como lâmina.

   E ele PRECESSA em volta do próprio eixo de voo, devagar. Isso resolve o
   problema de um anel girando em torno do próprio eixo ser literalmente
   invisível (um anel é simétrico à rotação: girá-lo não muda um pixel). Com a
   precessão ele mostra a face de vez em quando, e o clarão em arco no gume
   corre pela borda dando a leitura do giro.

   ------------------------------------------------ ENXERGAR ISSO A 300 METROS

   *"Aumente o tamanho do Kinzan e também deixe mais fácil de enxergar ele."* O
   tamanho é um número e ele mora no config (`specials.disk.hitRadius`, que subiu
   de 3,4 para 4,8 m — e que É o raio desenhado, ver `orientar`). A LEITURA é
   este arquivo, e ela é um problema de pixels e de fundo.

   A régua: a câmera do modo tem 68° verticais, então a `d` metros um metro de
   mundo vale ~800/d pixels de altura numa tela de 1080. O disco inteiro, de
   frente, mede 77 px a 100 m, 38 px a 200 m e 26 px a 300 m. O que se via antes
   dessa passagem, nessas mesmas distâncias, era pior que isso em três frentes —
   e as três foram atacadas SEM MALHA NOVA, porque a fase está em passe de
   desempenho e um terceiro `Mesh` por disco seriam seis draw calls a mais:

   1. **O GUME ERA FINO DEMAIS PARA EXISTIR DE LONGE.** `TUBO` é fração do raio,
      então o tubo media 0,085 · 3,4 = 0,29 m — 0,8 px a 300 m, ou seja MENOS DE
      UM PIXEL: o gume desaparecia por amostragem, não por opacidade. Com 0,115 ·
      4,8 = 0,55 m ele vale 1,5 px a 300 m e 4,4 px a 100 m. É a diferença entre
      uma linha que o rasterizador às vezes desenha e uma que ele sempre desenha.
   2. **O MIOLO ERA QUASE NADA.** A chapa do anel estava a 0,3 de opacidade —
      contra montanha ela sumia. Subiu para 0,55: de longe, quando o gume já é
      uma linha de um pixel e meio, é a CHAPA que dá a mancha que o olho pega, e
      é ela que faz o disco ler como disco em vez de como risco.
   3. **VERDE ADITIVO CONTRA CÉU VERDE É INVISÍVEL**, e essa é a que nenhum
      ajuste de tamanho resolveria. O céu de Namekusei é verde-claro e o material
      é `AdditiveBlending`: somar verde a um fundo que já é verde-claro quase não
      muda o pixel. Por isso o gume ficou mais BRANCO (mistura de 0,3 para 0,15
      da cor do golpe) — branco aditivo satura os três canais e vence qualquer
      fundo, inclusive o céu. A cor do golpe continua inteira na chapa, que é
      quem carrega a identidade verde do Kienzan.

   E a quarta, que é a que se vê primeiro: **o RASTRO** (ver `rastro`). Fagulhas
   soltas na trilha, pelo barramento de partículas que já existe — zero draw call
   nova, o pool é compartilhado. Elas vivem ~0,4 s, e a 105 m/s isso desenha uma
   linha pontilhada de uns 40 m atrás do disco: a 300 m, 105 px de risco atrás de
   um alvo de 26 px. O que o olho pega à distância não é o disco, é o rastro dele
   — e, como as fagulhas ficam PARADAS onde nasceram, o rastro mostra a curva por
   onde ele passou, que é a informação que decide se dá para desviar.

   Isso não briga com "quem morre para ele morreu porque não viu": o rastro é
   curto e some em meio segundo, então de perto ele continua sendo uma lâmina, e
   não um cometa. O que ele conserta é o outro extremo — a distância em que o
   golpe era invisível e o jogador não tinha o que ver.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { gameEvents, EventType } from "../../core/events.js";
import {
  atingivel,
  distancia2AoAlvo,
  pegarVaga,
  alvoPorId,
  passoDeGiro,
  perseguirPonto,
  PEITO,
  TETO_DO_RELEVO,
} from "./blast.js";

/** Quantos discos ao mesmo tempo. Dois por golpe é mais do que já aconteceu. */
const MAX_DISCOS = 6;

/** rad/s — o giro do clarão pela borda. Rápido: é uma serra. */
const GIRO = 27;
/** rad/s — a precessão do plano em volta do eixo de voo. Devagar: é o que
 *  mostra a face sem transformar o voo num cambalhota. */
const PRECESSAO = 2.2;

/* Fração interna do anel. O miolo do Kienzan é vazado no desenho original.
 *
 * Era 0,52 — um aro estreito, e metade da reclamação de "o Kienzan está muito
 * fino". Com 0,34 a lâmina tem dois terços do raio de matéria, e o vazado
 * continua existindo (é a assinatura do golpe): o que se perdeu foi o ar. */
const VAZADO = 0.34;
/** Fração do círculo que o clarão do gume cobre. */
const ARCO = 0.62;
/* A ESPESSURA DO GUME, em frações do raio. É a outra metade da reclamação — e a
 * que nenhum ajuste de raio resolveria.
 *
 * O disco era feito de duas folhas de espessura ZERO. De frente ele era um
 * anel; de perfil ele DESAPARECIA, porque um plano visto de lado tem zero pixel
 * — e o disco passa metade da precessão de perfil. O que o jogador via era uma
 * lâmina que pisca. Agora o gume é um TORO: um tubo em volta da borda, com
 * volume de verdade, que continua sendo uma linha de luz vista de frente e
 * continua existindo visto de lado. É a mesma peça que a referência desenha —
 * o disco tem uma borda acesa e grossa, e o miolo é que é fino.
 *
 * 0,115 e não 0,085 desde o pedido de legibilidade. O número é FRAÇÃO DO RAIO,
 * então ele já tinha crescido junto com o disco (0,085 · 3,4 = 0,29 m viraram
 * 0,085 · 4,8 = 0,41 m sozinhos); o que a fração a mais compra é o gume passar
 * de 1,1 para 1,5 px A 300 METROS — ou seja, deixar de cair abaixo de um pixel,
 * que é onde uma linha some por AMOSTRAGEM e não por brilho, e onde nenhuma
 * opacidade a traz de volta. A 100 m são 4,4 px de gume contra os 2,3 de antes:
 * o dobro de traço. O teto é a leitura da forma — passando de ~0,15 o tubo
 * começa a comer o vazado e o anel vira uma moeda. */
const TUBO = 0.115;

/* O RASTRO: segundos entre um sopro de fagulhas e o outro, e quantas por sopro.
 *
 * 0,06 s × 2 são 33 fagulhas por segundo por disco — um terço da cadência do
 * Galick Gun (0,06 s × 3, em dois braços), que é o rastro mais denso do modo. O
 * orçamento é o argumento: seis discos no ar no pior caso pedem 200 por segundo,
 * e o pool de brilho é o MESMO da poeira de impacto, que é informação e não
 * decoração (ver o comentário de ordem em `NamekFx.groundImpact`). Denso o
 * bastante para virar uma linha — a 105 m/s cada sopro nasce 6,3 m adiante do
 * anterior, e a fagulha vive ~0,4 s, então são sete pontos vivos cobrindo uns
 * 40 m —, ralo o bastante para não esvaziar o pool de ninguém. */
const RASTRO = 0.06;
const RASTRO_N = 2;

/* ------------------------------------------------------------- rascunhos --- */
const _Z = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _eixo = new THREE.Vector3();
const _cor = new THREE.Color();
const MAX_CORTADOS = NAMEK.net.maxPlayers + 1;

/* ============================================================================
   Um disco
   ========================================================================== */

class Disco {
  constructor(scene, geos) {
    this.scene = scene;
    /* `viva`, `t` e `local` existem ANTES do primeiro disparo porque
       `pegarVaga` os lê para escolher quem reciclar. Um slot nunca usado sai
       pelo `!viva`, mas depender dessa ordem seria depender de uma ordem. */
    this.viva = false;
    this.t = 0;
    this.local = false;
    this.group = new THREE.Group();
    this.group.visible = false;

    /* A CHAPA a 0,55 e não a 0,3 — ver a seção "enxergar isso a 300 metros" no
       cabeçalho. A 0,3, contra a encosta de Namekusei, ela era um véu; e é ela,
       não o gume, quem dá a MANCHA que o olho acha de longe, porque a partir de
       uns 250 m o gume já é uma linha de um pixel e meio e uma linha de um pixel
       e meio compete mal com uma montanha texturizada. Não vai a 1: o vazado e a
       transparência são o que impedem o disco de ler como bola de energia, que é
       o outro golpe — a primeira regra da forma continua valendo.
       O GUME a 1 e não a 0,95: cinco centésimos de opacidade num traço de quatro
       pixels não são um efeito, são um desperdício de dúvida. */
    this.corpo = this.folha(geos.corpo, 0.55, 1);
    this.gume = this.folha(geos.gume, 1, 2);

    scene.add(this.group);

    this.cortado = new Array(MAX_CORTADOS).fill(null);
    this.nCortados = 0;
    /** A base perpendicular ao voo, resolvida a cada disparo e guardada aqui. */
    this.b1 = new THREE.Vector3();
    this.b2 = new THREE.Vector3();
    /* A DIREÇÃO É UM OBJETO, e não três campos soltos, porque ela MUDA: o disco
       persegue (ver `perseguir`), e `perseguirPonto` gira um `{x,y,z}` no
       lugar. Um objeto por disco, criado uma vez — o pool não aloca nada em
       voo. */
    this.dir = { x: 0, y: 0, z: 1 };
    /** Conta-gotas do rastro. Ver `rastro`. */
    this._fag = 0;
  }

  folha(geo, opacidade, ordem) {
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: opacidade,
        // Um disco tem dois lados e os dois são vistos: cortar a face de trás
        // faria a lâmina sumir em metade da precessão.
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    mesh.renderOrder = ordem;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /* ---------------------------------------------------------------- disparo */

  acender(field, { owner, kind, origem, dir, local, target = null, info = null }) {
    /* `info` é a definição do golpe COMO ELE É VISTA — dourada em Super
       Saiyajin. Ver `PowerSystem.spawnSpecial`, que a escolhe, e o cabeçalho de
       `character/ssj.js`, que explica por que a cor virou uma troca de objeto em
       vez de doze `if`. */
    const S = info ?? NAMEK.specials[kind];
    this.field = field;
    this.owner = owner;
    this.kind = kind;
    this.info = S;
    this.local = !!local;
    this.viva = true;
    this.t = 0;
    this.percorrido = 0;
    this.nCortados = 0;
    /* Zerado no disparo, e não só no construtor: o pool RECICLA discos, e um
       `_fag` herdado de meio sopro atrás faria o rastro começar torto — irrele-
       vante em um quadro, mas é o tipo de estado que sobrevive a reciclagem e
       depois ninguém acha. */
    this._fag = 0;
    /* O alvo foi travado NO DISPARO e viaja na mensagem — a mesma regra da bola
       de ki (§6.1). Um disco que escolhesse a vítima sozinho, em cada tela,
       voaria para lados diferentes em cada tela. */
    this.alvo = target;
    /** Radianos já gastos do teto total de correção. Ver `passoDeGiro`. */
    this.arco = 0;

    this.x = origem.x;
    this.y = origem.y;
    this.z = origem.z;
    const inv = 1 / (Math.hypot(dir.x, dir.y, dir.z) || 1);
    this.dir.x = dir.x * inv;
    this.dir.y = dir.y * inv;
    this.dir.z = dir.z * inv;

    /* A vida é o MENOR entre o que a sustentação permite e o que o alcance
       permite. Com 105 m/s e 3,2 s ele para nos 336 m, antes dos 520 de
       `range`; deixar as duas contas escritas é o que impede um ajuste de
       velocidade em `NAMEK` de transformar o disco numa coisa que atravessa a
       arena inteira sem ninguém ter mexido no alcance. */
    this.vida = Math.min(S.sustain, S.range / S.speed);

    /* A BASE PERPENDICULAR ao voo, resolvida uma vez. `_p1` é qualquer vetor
       ortogonal ao eixo (o mundo tem um "para cima", e usá-lo faz o disco
       nascer de pé, que é a pose de arremesso); `_p2` fecha a base. */
    _eixo.set(this.dir.x, this.dir.y, this.dir.z);
    _p1.set(0, 1, 0).cross(_eixo);
    if (_p1.lengthSq() < 1e-6) _p1.set(1, 0, 0).cross(_eixo); // tiro na vertical
    _p1.normalize();
    _p2.copy(_eixo).cross(_p1).normalize();
    this.b1.copy(_p1);
    this.b2.copy(_p2);

    _cor.set(S.cor);
    this.corpo.material.color.copy(_cor);
    /* O GUME QUASE BRANCO — 0,15 da cor do golpe e não 0,3.
     *
     * O material é aditivo e o céu de Namekusei é VERDE-CLARO: somar o verde do
     * Kienzan a um fundo que já é verde-claro quase não muda pixel nenhum, e é
     * por isso que o disco sumia contra o céu enquanto lia bem contra a rocha.
     * Branco aditivo satura os três canais e aparece contra qualquer fundo, e é
     * exatamente o que um gume tem de ser: a parte quente. A identidade verde
     * não se perde porque ela mora na chapa, que continua com a cor cheia — e em
     * Super Saiyajin as duas peças viram douradas juntas, pelo `info`. */
    this.gume.material.color.set(0xffffff).lerp(_cor, 0.15);
    this.group.visible = true;
    this.group.position.set(this.x, this.y, this.z);

    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 18,
      color: S.cor,
      speed: 7,
      spread: 1,
      size: 0.3,
      grow: -0.5,
      life: S.windup * 0.85,
      gravity: 0,
      drag: 2.4,
      alpha: 1,
      additive: true,
    });
    return this;
  }

  /* ------------------------------------------------------------------ passo */

  update(dt, alvos, localId, relato) {
    if (!this.viva) return true;
    const S = this.info;
    this.t += dt;

    /* A CARGA. O disco se forma na mão, girando, e cresce. É curta (0,7 s) de
       propósito: o Kienzan é o especial rápido, e um aviso longo tiraria dele a
       única vantagem que ele tem sobre um feixe. */
    if (this.t < S.windup) {
      const u = this.t / S.windup;
      this.orientar(u * u * S.hitRadius);
      if (this.local) relato.luz(this.x, this.y, this.z, S.cor, 0.2 * u);
      return false;
    }

    const tv = this.t - S.windup;
    if (tv >= this.vida) {
      this.sumir();
      return true;
    }

    /* O AVANÇO, subdividido pelo raio de acerto quando o quadro estica — a
       mesma trava de `blast.js`, e pelo mesmo motivo: a 105 m/s um quadro de
       30 Hz anda 3,5 m, e num quadro de 10 Hz (a aba que voltou do fundo) anda
       10,5 — mais que os 4,8 m do raio de corte. Sem isto, o disco atravessaria
       gente sem nunca ter estado perto dela num quadro só. A trava afrouxou
       sozinha quando o disco cresceu (com 4,8 m ela só entra a partir de 22 Hz,
       contra os 31 Hz de quando o raio era 3,4): disco maior, menos subdivisão,
       menos laço — o aumento saiu de graça aqui. */
    /* A PERSEGUIÇÃO, antes de andar: o disco corrige o rumo e SÓ ENTÃO avança.
       Na ordem contrária ele daria o passo do quadro na direção velha e viraria
       depois — meio metro de atraso por quadro, que a 105 m/s é o bastante para
       ele passar raspando por quem estava perseguindo. */
    this.perseguir(dt, alvos, tv);

    const avanco = S.speed * dt;
    const n = avanco > S.hitRadius ? Math.ceil(avanco / S.hitRadius) : 1;
    const passo = avanco / n;
    const raio2 = S.hitRadius * S.hitRadius;

    for (let s = 0; s < n; s++) {
      this.x += this.dir.x * passo;
      this.y += this.dir.y * passo;
      this.z += this.dir.z * passo;
      this.percorrido += passo;

      /* CORTA E SEGUE. O disco não morre em quem ele pega — ele atravessa, e
         é por isso que o laço não sai daqui ao achar alguém.
         O TALHO aparece em toda tela; o AVISO à sala sai só na de quem atirou
         (§8 do plano). Desenhar é de todos, julgar é de quem disparou. */
      for (let k = 0; k < alvos.length; k++) {
        const a = alvos[k];
        if (!atingivel(a, this.owner)) continue;
        if (this.jaCortou(a.id)) continue;
        if (distancia2AoAlvo(a, this.x, this.y, this.z) > raio2) continue;
        this.marcar(a.id);
        this.talhar(a);
        if (this.owner !== localId) continue;
        /* Pelo canal do especial, e com `dt: 0` — o Kienzan tem `damage` e
           não `dps` em `NAMEK.specials`, e é a sala que sabe a diferença.
           Ver o cabeçalho de `powers/index.js`. */
        const e = relato.queima();
        e.owner = this.owner;
        e.victim = a.id;
        e.kind = this.kind;
        e.dt = 0;
      }

      if (this.y < TETO_DO_RELEVO && this.y <= this.field.heightAt(this.x, this.z)) {
        this.cravar(relato, localId);
        return true;
      }
    }

    this.orientar(S.hitRadius);
    /* O rastro sai DEPOIS de andar e de orientar, e em toda tela: ele é desenho,
       e desenhar é de todos (a mesma divisão do talho — ver o laço acima). */
    this.rastro(dt);
    if (this.local) relato.luz(this.x, this.y, this.z, S.cor, 0.3);
    return false;
  }

  /**
   * O RASTRO — a peça que faz o disco existir a 300 metros.
   *
   * Ver a seção "enxergar isso a 300 metros" no cabeçalho para o porquê. A
   * mecânica é a mais barata que existe neste modo: o barramento de partículas
   * que o arquivo já usa para o talho e para a pose (`EventType.PARTICLES`), que
   * cai no pool compartilhado de brilho — **nenhuma malha, nenhuma draw call
   * nova**, que é o que a fase em passe de desempenho pode pagar.
   *
   * As fagulhas nascem na BORDA DE TRÁS (0,9 raio atrás do centro, sobre o eixo
   * do voo) e quase paradas — `speed` baixo de propósito. Um rastro que sai
   * correndo atrás do disco vira fumaça de escapamento; um que fica ONDE NASCEU
   * é a trilha do voo, e num golpe que persegue essa diferença é informação: o
   * pontilhado desenha a CURVA que a lâmina fez, que é o que diz a quem está
   * fugindo se o disco ainda está corrigindo para cima dele.
   *
   * `direction` é o voo invertido com `spread` estreito — o barramento deste
   * modo honra os dois desde que `NamekGame.bindParticles` passou a repassá-los
   * —, então o sopro abre para trás em vez de virar uma bolinha isotrópica.
   */
  rastro(dt) {
    this._fag -= dt;
    if (this._fag > 0) return;
    this._fag = RASTRO;
    const S = this.info;
    const r = S.hitRadius * 0.9;
    gameEvents.emit(EventType.PARTICLES, {
      position: {
        x: this.x - this.dir.x * r,
        y: this.y - this.dir.y * r,
        z: this.z - this.dir.z * r,
      },
      count: RASTRO_N,
      color: S.cor,
      speed: 2.4,
      direction: { x: -this.dir.x, y: -this.dir.y, z: -this.dir.z },
      spread: 0.45,
      /* Proporcional ao raio para o dia em que o disco crescer de novo: a
         fagulha de um disco de 9,6 m de diâmetro não é a de um de 4,4. */
      size: S.hitRadius * 0.06,
      grow: 0.6,
      life: 0.4,
      gravity: 0,
      drag: 1.6,
      alpha: 0.9,
      additive: true,
    });
  }

  /**
   * Posição, plano e giro.
   *
   * A NORMAL precessa em volta do eixo de voo: ela é uma combinação da base
   * perpendicular resolvida no disparo. Isso é o que faz o disco mostrar a face
   * de vez em quando — sem precessão, um anel girando no próprio eixo não muda
   * um pixel, e o jogador veria uma lâmina parada deslizando pelo ar.
   */
  orientar(raio) {
    /* A BASE É REFEITA A CADA QUADRO desde que o disco passou a perseguir.
     *
     * Ela era resolvida uma vez, no disparo, e isso valia enquanto o rumo fosse
     * fixo. Com a perseguição, um disco que faz uma curva de 90° terminaria
     * voando de lado com o plano da lâmina no ângulo do arremesso — ou seja,
     * cortando o ar de chapa. Refazer custa dois produtos vetoriais por disco
     * por quadro (seis discos no pior caso) e mantém a promessa da forma: o
     * plano da lâmina SEMPRE contém a direção do voo. */
    _eixo.set(this.dir.x, this.dir.y, this.dir.z);
    _p1.set(0, 1, 0).cross(_eixo);
    if (_p1.lengthSq() < 1e-6) _p1.set(1, 0, 0).cross(_eixo); // voo vertical
    _p1.normalize();
    _p2.copy(_eixo).cross(_p1).normalize();
    this.b1.copy(_p1);
    this.b2.copy(_p2);

    const a = this.t * PRECESSAO;
    _n.copy(this.b1).multiplyScalar(Math.cos(a)).addScaledVector(this.b2, Math.sin(a));
    this.group.position.set(this.x, this.y, this.z);
    this.group.quaternion.setFromUnitVectors(_Z, _n);
    this.group.rotateZ(this.t * GIRO);
    const r = Math.max(0.001, raio);
    this.group.scale.set(r, r, r);
  }

  /**
   * O disco SEGUE o alvo — e é possível escapar dele.
   *
   * As duas metades são o pedido do usuário, palavra por palavra: "o Kienzan
   * deve seguir o usuário… é possível escapar, mas o player tem que se
   * movimentar rápido para os lados". A segunda metade não é uma concessão à
   * primeira; é a especificação, e ela é geométrica.
   *
   * Um projétil que gira a `turnRate` graus por segundo enquanto voa a `speed`
   * descreve uma curva de raio `v / ω`. Com os números do `homing` do Kienzan
   * (105 m/s e 108°/s) isso são **56 m**. Ele fecha em cima de quem se move em
   * linha reta na frente dele, e larga quem corta de lado no arranque. Correr
   * para trás não adianta (você continua no eixo); arrancar para o lado, sim.
   * Que é exatamente a manobra que se queria cobrar.
   *
   * Os 108°/s são MEDIDOS e não derivados, e é o único `turnRate` do jogo que
   * não saiu da fórmula `v/ω`. O banco inteiro está em
   * `NAMEK.specials.disk.homing`, e o resumo é: com o disco de 4,8 m, 108 é o
   * giro que devolve a fuga que 114 dava com o disco de 3,4 m — o arranque
   * lateral escapa em toda a faixa de briga (22 a 55 m), mesmo com reflexo
   * instantâneo, e ainda sobra meio metro. A 110 a folga acaba (56,5 m); a 114,
   * com o disco novo, o teto cai para 54,5 m e a promessa quebra.
   *
   * **O RAIO E O GIRO SÃO UM NÚMERO SÓ.** É a armadilha deste golpe e ela já
   * pegou uma vez: o critério de escapar é o disco passar a mais de um
   * `hitRadius` do eixo do alvo, então aumentar o disco é encolher a fuga sem
   * tocar em `turnRate` nenhum. Quem mexer num tem de remedir o outro.
   *
   * Detalhe que só a medição mostra: **o voo normal nunca escapa**, em nenhum
   * giro e em nenhuma distância. A metade "quem só voa não desvia" do pedido
   * sai de graça — o que custa calibragem é deixar o burst funcionar.
   *
   * O alvo NÃO é reavaliado no voo: foi travado no disparo e viajou na
   * mensagem, como o da bola de ki (§6.1). Já quem CORTOU não é mais
   * perseguido — sem isso, o disco ficaria orbitando a mesma pessoa que ele já
   * não pode ferir de novo, e a lâmina viraria um satélite.
   */
  perseguir(dt, alvos, tv) {
    const H = this.info.homing;
    if (!H || this.alvo === null || tv > H.duration) return;
    const a = alvoPorId(alvos, this.alvo);
    if (!a || a.vivo === false || this.jaCortou(a.id)) {
      this.alvo = null;
      return;
    }
    /* O Kienzan não declara `arcMax` — contornar é o que ele tem —, então
       `passoDeGiro` devolve aqui o teto por segundo puro. Ela está no caminho
       assim mesmo para que o dia em que alguém quiser limitar a curva do disco
       seja um número na configuração, e não uma visita a este arquivo. */
    this.arco += perseguirPonto(
      this.dir,
      a.x,
      a.y + a.altura * PEITO,
      a.z,
      this.x,
      this.y,
      this.z,
      Math.cos((H.cone * Math.PI) / 180),
      passoDeGiro(H, dt, this.arco),
    );
  }

  jaCortou(id) {
    for (let i = 0; i < this.nCortados; i++) if (this.cortado[i] === id) return true;
    return false;
  }

  marcar(id) {
    if (this.nCortados >= MAX_CORTADOS) return;
    this.cortado[this.nCortados++] = id;
  }

  /** O corte. Um risco de luz no peito de quem passou — nada de bola de fogo. */
  talhar(a) {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: a.x, y: a.y + a.altura * PEITO, z: a.z },
      count: 14,
      color: this.info.cor,
      speed: 15,
      spread: 0.35,
      // Saem na direção do voo do disco: é o rastro do talho, e ele aponta para
      // onde a lâmina foi.
      direction: { x: this.dir.x, y: this.dir.y, z: this.dir.z },
      size: 0.16,
      grow: 0.8,
      life: 0.34,
      gravity: 0,
      drag: 1.8,
      alpha: 1,
      additive: true,
    });
  }

  /** Bateu no chão: cicatriz, poeira e fim. Sem explosão — ver o cabeçalho. */
  cravar(relato, localId) {
    if (this.owner === localId) {
      const e = relato.chao();
      e.owner = this.owner;
      e.p.x = this.x;
      e.p.y = this.y;
      e.p.z = this.z;
      e.power = this.info.power;
      /* Talho largo e raso, que é o que uma lâmina rente ao chão faz. Escrito
         mesmo valendo 1 porque o registro da fila é REAPROVEITADO: um `fundo` de
         3,5 deixado pelo Kamehameha do quadro anterior viraria um poço aqui. */
      e.fundo = 1;
      e.kind = this.kind;
    }
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 20,
      color: 0x7a8a5c,
      speed: 9,
      spread: 0.6,
      direction: { x: -this.dir.x, y: 1, z: -this.dir.z },
      size: 0.34,
      grow: 2.4,
      life: 0.9,
      gravity: NAMEK.fighter.gravity * 0.5,
      drag: 1.3,
      alpha: 0.75,
    });
    this.sumir();
  }

  /** Fim de vida no ar: a energia se desfaz, sem estouro. */
  sumir() {
    gameEvents.emit(EventType.PARTICLES, {
      position: { x: this.x, y: this.y, z: this.z },
      count: 10,
      color: this.info.cor,
      speed: 5,
      spread: 1,
      size: 0.22,
      grow: 1.2,
      life: 0.4,
      gravity: 0,
      drag: 2.2,
      alpha: 0.8,
      additive: true,
    });
    this.apagar();
  }

  /**
   * O disco foi INTERCEPTADO por outro poder — o gancho do embate.
   *
   * Ver `powers/colisao.js`. Ele some sem estouro e sem o sopro de `sumir`: o
   * disco continua sendo o golpe que NÃO explode (é a primeira regra do
   * cabeçalho deste arquivo, e ela não tem exceção), e quem desenha o clarão do
   * choque é o árbitro, uma vez para os dois lados. Duas emissões no mesmo
   * ponto seriam a mesma coisa contada duas vezes — e, na única leitura que
   * este golpe tem, a errada: uma bola de fogo saindo de onde a lâmina estava.
   */
  abortarPorEmbate() {
    if (!this.viva) return false;
    this.apagar();
    return true;
  }

  apagar() {
    this.viva = false;
    this.group.visible = false;
    this.nCortados = 0;
  }

  dispose() {
    this.scene.remove(this.group);
    this.corpo.material.dispose();
    this.gume.material.dispose();
  }
}

/* ============================================================================
   O pool
   ========================================================================== */

export class DiskPool {
  constructor(scene, field, max = MAX_DISCOS) {
    this.scene = scene;
    this.field = field;

    /* Raio 1 na geometria: o tamanho vira escala, e os seis discos dividem os
       mesmos dois buffers. */
    this.geos = {
      corpo: new THREE.RingGeometry(VAZADO, 1, 48, 1),
      /* O clarão do gume é um ARCO — é ele que torna o giro visível, porque um
         anel inteiro seria simétrico e girar não mudaria um pixel — e agora ele
         é um TORO, com o tubo de `TUBO` raios de espessura: um arco de tubo
         existe visto de qualquer ângulo, inclusive exatamente de perfil, que é
         onde a folha de espessura zero sumia. Ver o comentário de `TUBO`.
         12 lados no tubo: a 40 m ninguém conta as faces, e são 12 × 48 = 576
         triângulos numa peça que aparece no máximo seis vezes em cena. */
      gume: new THREE.TorusGeometry(1 - TUBO, TUBO, 12, 48, Math.PI * 2 * ARCO),
    };

    this.discos = new Array(max);
    for (let i = 0; i < max; i++) this.discos[i] = new Disco(scene, this.geos);
  }

  disparar(disparo) {
    if (!NAMEK.specials[disparo.kind]) return null;
    return pegarVaga(this.discos).acender(this.field, disparo);
  }

  update(dt, alvos, localId, relato) {
    for (let i = 0; i < this.discos.length; i++) {
      const d = this.discos[i];
      if (!d.viva) continue;
      if (d.update(dt, alvos, localId, relato)) d.apagar();
    }
  }

  get count() {
    let n = 0;
    for (let i = 0; i < this.discos.length; i++) if (this.discos[i].viva) n++;
    return n;
  }

  clear() {
    for (let i = 0; i < this.discos.length; i++) this.discos[i].apagar();
  }

  dispose() {
    for (let i = 0; i < this.discos.length; i++) this.discos[i].dispose();
    this.geos.corpo.dispose();
    this.geos.gume.dispose();
  }
}
