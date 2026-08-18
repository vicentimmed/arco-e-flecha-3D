/* ---------------------------------------------------------------------------
   O BOSS, do lado do cliente. A porta do módulo.

   Quem monta o jogo importa DAQUI e de mais lugar nenhum:

       import { BossSystem } from "./boss/index.js";

   Este arquivo é a costura entre quatro coisas que já existem e não se conhecem:
   a rede (cinco mensagens novas), o corpo (`./freeza.js`), os pools de projétil
   (`../powers/`) e a barra do HUD (`../ui/boss.js`). Ele não tem regra de jogo
   nenhuma — vida, dano, alvo e comportamento são todos da SALA, e o §10 do
   pedido é explícito sobre isso.

   ============================================================================
   1. O QUE ESTE LADO DECIDE (quase nada, e é o ponto)
   ============================================================================

       a SALA decide       vida, posição, qual golpe sai, quem apanha
       este lado decide    onde o corpo é desenhado ENTRE dois pacotes,
                           e que o meu golpe encostou nele

   A segunda metade é o mesmo contrato do resto do modo — quem atira é a
   autoridade sobre o próprio acerto (§8 do plano) — e ela chega à sala pelo
   `NC2S.FREEZA_HIT`. A primeira é interpolação pura.

   ============================================================================
   2. POR QUE OS PODERES DELE ENTRAM EM `NAMEK.specials`, E SÓ AQUI
   ============================================================================

   Os pools de `../powers/` (`BeamPool`, `OrbPool`) resolvem tudo o que sabem
   sobre um golpe por `NAMEK.specials[kind]`: alcance, velocidade, raio, cor,
   perseguição. É assim para os quatro golpes do jogador e é a razão de o Galick
   Gun ter podido virar uma esfera com uma linha de mudança.

   Reaproveitá-los para o boss — que é o pedido literal, "reaproveite o mecanismo
   de projéteis em vez de inventar outro" — exige, portanto, que os golpes dele
   estejam naquela tabela. E é aqui, no CLIENTE, que eles entram:

       registrarPoderes()  →  NAMEK.specials.raioDaMorte = NAMEK.freeza.poderes.raioDaMorte
                              NAMEK.specials.esferaDaMorte = …

   **Nunca no `config.js`.** Aquele arquivo é importado pelos dois lados, e um
   golpe do boss dentro de `NAMEK.specials` no SERVIDOR seria um golpe que
   `specialInfo()` reconhece — ou seja, qualquer cliente poderia mandar um
   `NC2S.SPECIAL` de `esferaDaMorte` e a sala o aceitaria sem discutir, cobrando
   a barra cheia e entregando uma bola de 19 m com 100 de dano. Fazendo o
   registro deste lado, o servidor nunca vê essas chaves: `specialInfo` devolve
   null, `registrarEspecial` sai na primeira linha, e a superfície de abuso é
   exatamente zero.

   O efeito colateral aceitável é o inverso: um `ALCANCE_MAXIMO` da sala que não
   conhece os golpes do boss. Ele não precisa conhecer — o boss não declara
   acerto por aquele caminho.

   ============================================================================
   3. O ORÇAMENTO
   ============================================================================

   **Zero pool novo.** As bolas da rajada saem do MESMO `InstancedMesh` das
   bolas de todo mundo (o `BlastPool` do `PowerSystem`, repintado por instância);
   o Death Beam sai do mesmo pool de seis feixes do Kamehameha; a Death Ball, do
   mesmo pool de cinco esferas do Galick Gun e da Genki Dama; a onda de repulsa
   dele é literalmente um `NS2C.BURST` que o cliente já sabia tratar.

   O que o boss acrescenta à cena é o CORPO dele (~28 malhas, ver `freeza.js`) e
   três nós de HUD. Nada mais.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../shared/namek/config.js";
import { NC2S, NS2C, vecFrom } from "../../shared/namek/protocol.js";
import { FreezaBody, POSE } from "./freeza.js";
import { BossBar } from "../ui/boss.js";
import { BossCine } from "./cine.js";

/** O id reservado do boss. Ver `NAMEK.freeza.id` para por que ele é negativo. */
export const FREEZA_ID = NAMEK.freeza.id;

/**
 * A fagulha do acerto — a cor dele CLAREADA.
 *
 * Ela não pode ser `NAMEK.freeza.cor` puro, e o motivo é o fundo: a fagulha
 * nasce em cima do corpo dele, que já é roxo, e roxo sobre roxo não se vê. O
 * que precisa acontecer é o contrário do resto da paleta — aqui a cor tem de
 * DESTOAR da criatura, porque ela é a confirmação de que o golpe encostou.
 *
 * Derivada e não escrita à mão, para continuar sendo obviamente a mesma família
 * no dia em que o roxo dele virar outro roxo.
 *
 * Uma mistura com branco basta aqui, e vale dizer por que — a barra do HUD faz a
 * mesma derivação em HSL, com trinta linhas a mais (ver `tom`, em
 * `ui/boss.js`). Lá o resultado é uma cor CHAPADA, num texto sobre o céu, e
 * clarear por mistura lava a saturação até o magenta virar lilás. Aqui é uma
 * PARTÍCULA, somada por cima do corpo e de tudo o mais que estiver aceso: ela
 * estoura para o branco no meio de qualquer clarão, e a diferença entre os dois
 * métodos não sobrevive ao primeiro quadro. Meio caminho para o branco é o
 * ponto em que ela ainda lê como magenta e já separa do corpo.
 */
const FAGULHA = clarear(NAMEK.freeza.cor, 0.5);

/** Clareia 0xRRGGBB em direção ao branco. Uma vez, na carga do módulo. */
function clarear(cor, k) {
  const n = cor >>> 0;
  const r = Math.round((n >> 16 & 255) + (255 - (n >> 16 & 255)) * k);
  const g = Math.round((n >> 8 & 255) + (255 - (n >> 8 & 255)) * k);
  const b = Math.round((n & 255) + (255 - (n & 255)) * k);
  return (r << 16) | (g << 8) | b;
}

/**
 * Põe os golpes do boss em `NAMEK.specials` — **só neste lado**. Ver o §2 do
 * cabeçalho para a razão inteira, que é de segurança e não de organização.
 *
 * Idempotente: rodar duas vezes (duas partidas na mesma aba) reescreve as
 * mesmas referências.
 */
function registrarPoderes() {
  for (const [chave, info] of Object.entries(NAMEK.freeza.poderes)) {
    NAMEK.specials[chave] = info;
  }
}
registrarPoderes();

/* s — o atraso do buffer de interpolação, o mesmo dos lutadores remotos.
 *
 * Ele existe pela mesma razão de sempre: a pose chega a 20 Hz e a tela desenha a
 * 60, então ou se desenha o passado suavemente ou se desenha o presente aos
 * solavancos. Cem milissegundos é o que `NAMEK.net.interpDelay` já escolheu para
 * o modo, e usar OUTRO número aqui faria o boss e os lutadores viverem em dois
 * instantes diferentes — visível na hora em que um passa na frente do outro. */
const ATRASO = NAMEK.net.interpDelay;

/** 1/s — rigidez da perseguição visual. Ver `update`. */
const SUAVE_POS = 14;
const SUAVE_ANG = 11;

/** s — quanto a pose de DOR fica acesa depois de um `FREEZA_HURT`. */
const DOR = 0.28;

const TAU = Math.PI * 2;

/** Ângulo mais curto entre dois ângulos. Sem ele, um corpo que cruza ±π gira o
 *  caminho longo — 359 graus de volta num quadro. */
function curto(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export class BossSystem {
  /**
   * @param {object} o
   * @param {import("three").Scene} o.scene
   * @param {import("../powers/index.js").PowerSystem} o.powers os POOLS já
   *   montados — este módulo não cria nenhum. Ver o §3 do cabeçalho.
   * @param {import("../fx/index.js").NamekFx} o.fx
   * @param {object} o.audio a API de som (só é CHAMADA, nunca alterada)
   * @param {HTMLElement} o.hudEl o elemento `.nk-hud`, para a barra herdar os
   *   tokens de cor e a fonte
   * @param {import("../net/client.js").NamekClient} o.net
   * @param {() => (number|null)} o.meuId o id local, que só existe depois do
   *   `welcome` — daí ser uma função e não um número
   */
  constructor({ scene, powers, fx, audio, hudEl, net, meuId, camera, hud }) {
    this.scene = scene;
    this.powers = powers;
    this.fx = fx;
    this.audio = audio;
    this.net = net;
    this.meuId = meuId ?? (() => null);
    /** O HUD, só para o nome e o aviso das duas cenas. Opcional: sem ele o boss
     *  entra e morre em silêncio na tela, e nada mais quebra. */
    this.hud = hud ?? null;

    this.corpo = new FreezaBody(scene);
    this.barra = new BossBar(hudEl);
    /* A LENTE DAS DUAS CENAS. Ela mora aqui e não no laço principal porque as
       duas cenas são acontecimentos DO BOSS: quem sabe que ele chegou e que ele
       morreu é este módulo, e é ele que recebe as duas mensagens. O laço só
       pergunta, uma vez por quadro, se a cena está mandando na câmera. Ver o §1
       de `boss/cine.js` para por que ela não é um modo da `NamekCamera`. */
    this.cine = camera ? new BossCine(camera) : null;

    /** Está em campo? */
    this.ativo = false;
    this.vida = 0;
    this.vidaMax = 1;

    /* ------------------------------------------------------- interpolação --
       Duas amostras: a última recebida e a anterior. Não há buffer de histórico
       como o dos lutadores porque o boss é UM — o custo de um buffer circular
       aqui pagaria por uma suavidade que a perseguição amortecida já entrega, e
       o corpo dele é grande demais para meio metro de erro aparecer. */
    this.alvo = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, roll: 0 };
    this.mostrado = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
    /** ms — o instante do servidor da última amostra. */
    this.amostraEm = 0;
    this.pose = POSE.parado;
    this.fracao = 0;
    this.auraForca = 0;
    this.dor = 0;

    /* A cápsula que os projéteis do jogador testam. UM objeto, reescrito — a
       lista de alvos é montada por quadro e um literal aqui seria alocação em
       regime (§3 do plano). Os nomes dos campos são o contrato de
       `PowerSystem.update`: `id`, `x`, `y`, `z` (nos PÉS), `raio`, `altura`,
       `vivo`, `invuln`. */
    this._capsula = {
      id: FREEZA_ID,
      x: 0, y: 0, z: 0,
      raio: NAMEK.freeza.raio,
      altura: NAMEK.freeza.altura,
      vivo: false,
      invuln: false,
    };

    /* ------------------------------------------------------- a queimadura --
     * O Kamehameha cobra por TEMPO, e o `SPECIAL_HIT` do modo resolve isso
     * mandando `dt` de exposição acumulada. O mesmo vale aqui: o `PowerSystem`
     * já entrega o `dt` pronto na fila `queimando`, então este módulo só o
     * repassa. Guardar estado seria repetir uma conta que já foi feita. */
    this._pontoTmp = { x: 0, y: 0, z: 0 };

    /* A ficha de "lutador remoto" que a mira lê. Ver `candidato()` para por que
       ela existe — é o conserto do boss que nenhum poder perseguia. Um objeto
       só, reescrito: ele é lido uma vez por quadro pela trava e uma vez por
       disparo pelos seletores de alvo. */
    this._candidato = {
      id: FREEZA_ID,
      name: NAMEK.freeza.nome,
      /* A cor do anel e do pino na tela: o roxo DELE, não a cor de um jogador.
         Lida de `NAMEK.freeza.cor` e não escrita aqui — é a mesma constante que
         o corpo, a aura, os poderes e a barra do HUD usam, e é o que garante que
         o marcador aponte para uma criatura da cor que ele desenha. */
      color: NAMEK.freeza.cor,
      pose: { x: 0, y: 0, z: 0 },
      down: false,
      health: 0,
      vidaMax: 1,
      /** A marca que distingue o boss de um lutador para quem quiser tratá-lo
       *  diferente (o HUD desenha o anel maior, por exemplo). */
      boss: true,
    };

    this.ligar();
  }

  /* ============================================================== a rede == */

  /**
   * As cinco mensagens do boss.
   *
   * Elas ficam AQUI, e não em `NamekGame.bindNetwork`, para o gancho no laço
   * principal ser de uma linha só: quem monta o jogo constrói este objeto e
   * pronto. É a mesma divisão que `RemoteFighters` faria se tivesse nascido
   * depois — quem sabe tratar a mensagem é quem sabe o que ela significa.
   */
  ligar() {
    const net = this.net;
    if (!net?.on) return;

    net.on(NS2C.FREEZA_IN, (msg) => this.entrar(msg));

    net.on(NS2C.FREEZA_STATE, (msg) => this.aplicarPose(msg));

    net.on(NS2C.FREEZA_POWER, (msg) => this.soltarPoder(msg));

    net.on(NS2C.FREEZA_HURT, (msg) => {
      if (!this.ativo) return;
      this.vida = msg.vida ?? this.vida;
      this.vidaMax = msg.vidaMax ?? this.vidaMax;
      this.barra.setVida(this.vida, this.vidaMax);
      /* A pose de DOR só entra quando o golpe foi grande. Um boss que se
         encolhe a cada bola de ki tremeria o tempo todo — e a pose deixaria de
         significar qualquer coisa justamente quando o golpe grande chegasse. */
      if ((msg.dano ?? 0) > this.vidaMax * 0.02) this.dor = DOR;
      /* A VOZ. Ele apanhava em silêncio absoluto — os lutadores têm
         `levouDano` e ele não tinha nada, o que fazia dele um alvo que voa em
         vez de um adversário. `bossLevouDano` gradua o grunhido pela fração da
         barra que saiu neste despejo e, quando o golpe foi grande e ele ainda
         está com folga, solta a gargalhada do "isso é tudo?" — as duas coisas
         saem do mesmo número, e é por isso que são uma chamada só. Ver
         `NamekAudio.bossLevouDano`. */
      this.audio?.bossLevouDano?.(
        this.pontoDoPeito(this._pontoTmp),
        msg.dano ?? 0,
        this.vidaMax,
        this.vida,
      );
    });

    net.on(NS2C.FREEZA_DOWN, (msg) => this.cair(msg));
  }

  entrar(msg) {
    this.ativo = true;
    this.vidaMax = Math.max(1, msg?.vidaMax ?? 1);
    this.vida = msg?.vida ?? this.vidaMax;

    const nivel = NAMEK.freeza.dificuldades[msg?.dificuldade]?.nome ?? "";
    this.barra.entrar(msg, nivel);

    if (Array.isArray(msg?.p)) {
      const p = vecFrom(msg.p);
      this.alvo.x = this.mostrado.x = p.x;
      this.alvo.y = this.mostrado.y = p.y;
      this.alvo.z = this.mostrado.z = p.z;
      this.alvo.vx = this.alvo.vy = this.alvo.vz = 0;
    }
    this.pose = POSE.parado;
    this.fracao = 0;
    this.dor = 0;
    this.corpo.reviver();
    this.corpo.aplicar(this.estadoParaCorpo());
    /* A entrada é AUDÍVEL, e agora com som PRÓPRIO: `bossEntrou` é solene, ou
       seja, voz reservada e alcance de arena inteira. O paliativo daqui era um
       estouro no ar, que contava a história errada — uma detonação diz que
       alguma coisa arrebentou, e o que aconteceu foi uma chegada. */
    this.audio?.bossEntrou?.(this.mostrado);

    /* ============================================== A CENA DE APRESENTAÇÃO ==
     *
     * Ela só abre se a sala disser que ainda há cena a mostrar (`msg.cena` são
     * os MILISSEGUNDOS QUE FALTAM, não a duração — ver `NamekFreeza.mensagemEntrada`).
     * Essa distinção é o que impede a apresentação de acontecer duas vezes: esta
     * mesma mensagem é reenviada a quem chega no meio da luta e a cada troca de
     * dificuldade, e nesses casos `cena` vem zero.
     *
     * A pose que a lente do jogo tinha AGORA é passada junto porque a cena parte
     * dela — sem isso, a entrada seria um corte de um lugar para outro. Quem a
     * fornece é o laço, em `NamekGame.step`, que é quem tem a `NamekCamera`. */
    this._cenaPedida = Number(msg?.cena) || 0;
    this._descidaPedida = Number(msg?.desce) || 0;
  }

  /**
   * O laço abre a cena, e não este método — porque abrir depende da pose que a
   * lente do jogo tem NESTE quadro, e `entrar` roda no meio da fila de rede, um
   * quadro antes.
   *
   * @param {object} lente `{ position, lookAt }` da `NamekCamera`
   * @returns {boolean} se uma cena foi aberta neste quadro
   */
  abrirCenaPendente(lente) {
    if (!this._cenaPedida || !this.cine) return false;
    const ms = this._cenaPedida;
    const desce = this._descidaPedida;
    this._cenaPedida = 0;
    this._descidaPedida = 0;
    return this.cine.chegada(ms, desce, lente);
  }

  cair(msg) {
    if (!this.ativo) return;
    this.ativo = false;
    this._capsula.vivo = false;
    this.barra.cair();
    /* **SÓ QUEM FOI DERRUBADO TEM CENA DE MORTE.** O mesmo `FREEZA_DOWN` chega
     * pelos dois caminhos — a queda (`NamekFreeza.morrer`, com `derrotado: 1`) e
     * a retirada (`sair()`, quando alguém vira o clima de volta para `dia`) —, e
     * dar a cena aos dois seria desenhar uma explosão triunfal toda vez que
     * alguém desistisse da luta pelo menu.
     *
     * Sem a marca, ele simplesmente some: `esconder()` no próximo quadro, sem
     * corpo, sem raios e sem lente presa em ninguém. */
    if (!msg?.derrotado) {
      this.corpo.esconder();
      this.cine?.cortar();
      return;
    }

    this.corpo.morrer();
    this._cenaDeMorte = true;
    this._cinePedidaMorte = true;
    if (Array.isArray(msg?.p)) {
      const p = vecFrom(msg.p);
      /* O gemido que desce de 190 a 22 Hz, solene como a chegada. Ver
         `NamekAudio.bossCaiu`: o que separa a queda dele da morte de um lutador
         não é o volume, é ir mais fundo e durar o dobro.
         O ESTOURO NÃO SAI AQUI, e é a diferença para a versão anterior: a
         explosão acontece `fim.abertura` segundos depois, no fim da pose aberta,
         e disparar o `groundImpact` no instante da mensagem punha a bola de fogo
         antes dos raios que a anunciam. Ver `explodir`. */
      this.audio?.bossCaiu?.(p);
    }
  }

  /**
   * O ESTOURO — o instante em que o corpo some.
   *
   * *"Ele começa a sair raios dele e luzes, e ele explode."*
   *
   * Ele é disparado do `update`, na borda em que o relógio do corpo cruza
   * `fim.abertura`, e não da mensagem de morte: o que dita o instante é a
   * ANIMAÇÃO (a pose abrindo, os raios crescendo, o corpo acendendo), e ela é
   * local. Amarrá-lo ao pacote poria a explosão antes do gesto que a anuncia.
   */
  explodir() {
    const p = this.pontoDoPeito(this._pontoTmp);
    /* Três emissões e não uma, e cada uma cobre um sentido: o CLARÃO (que se vê
       da arena inteira, e é o que diz "aconteceu"), as FAGULHAS na cor dele (que
       dão volume ao clarão de perto e são a carcaça indo embora) e o
       `groundImpact`, que é a maior emissão que o pool entrega — ele é a bola de
       fogo. Um corpo de 6,7 m arrebentando precisa dos três; um só leria como
       mais um golpe. */
    this.fx?.clarao?.(p.x, p.y, p.z, NAMEK.freeza.altura * 14, FAGULHA, 1);
    this.fx?.fagulhas?.(p.x, p.y, p.z, NAMEK.freeza.altura, FAGULHA, 90, 120);
    this.fx?.groundImpact?.(p.x, p.y, p.z, 12);
    this.audio?.detonouNoAr?.(p, 44, "genki");
    this.hud?.banner?.("FREEZA DERROTADO", 3.2);
  }

  /** A pose que veio da sala. 20 Hz. */
  aplicarPose(msg) {
    if (!this.ativo) return;
    const p = msg.p;
    if (!Array.isArray(p) || !Number.isFinite(p[0])) return;

    this.alvo.x = p[0];
    this.alvo.y = p[1];
    this.alvo.z = p[2];
    const v = msg.v;
    this.alvo.vx = v?.[0] ?? 0;
    this.alvo.vy = v?.[1] ?? 0;
    this.alvo.vz = v?.[2] ?? 0;
    this.alvo.yaw = msg.y ?? 0;
    this.alvo.pitch = msg.i ?? 0;
    this.alvo.roll = msg.r ?? 0;
    this.auraForca = msg.a ?? 0;
    this.pose = msg.u ?? POSE.parado;
    this.fracao = msg.s ?? 0;
    this.amostraEm = msg.w ?? 0;
    this.barra.setKi(msg.k ?? 1);

    /* O TELEPORTE corta a interpolação. Sem esta linha o corpo atravessaria os
       46 m do salto em linha reta na tela — o que não é um teleporte, é um
       tranco —, e ainda passaria por dentro de quem estivesse no caminho. */
    if (msg.tp) {
      this.mostrado.x = this.alvo.x;
      this.mostrado.y = this.alvo.y;
      this.mostrado.z = this.alvo.z;
      this.fx?.fagulhas?.(
        this.alvo.x, this.alvo.y + NAMEK.freeza.peito, this.alvo.z,
        0.8, NAMEK.freeza.cor, 26, 16,
      );
      /* O "vuu" do sumiço, no ponto de CHEGADA — é para lá que o jogador tem de
         virar a cabeça, e o corpo já está lá nesta linha. Ver
         `NamekAudio.bossPiscou`: envelope de sino, sem ataque e sem cauda,
         porque um teleporte não bate em nada e não deixa nada. */
      this.audio?.bossPiscou?.({ x: this.alvo.x, y: this.alvo.y + NAMEK.freeza.peito, z: this.alvo.z });
    }
  }

  /**
   * O boss soltou um poder. **Só desenho.**
   *
   * `local: false` em tudo, e é a linha mais importante deste método: é ela que
   * diz aos pools para não reportarem acerto nenhum. O dano dos golpes dele já
   * foi cobrado no servidor — reportá-lo daqui seria cobrar duas vezes, e cada
   * cliente cobraria a sua.
   */
  soltarPoder(msg) {
    if (!this.ativo || !Array.isArray(msg?.o) || !Array.isArray(msg?.d)) return;
    const origem = vecFrom(msg.o);
    const dir = vecFrom(msg.d);

    if (msg.kind === "rajada") {
      /* A rajada sai do MESMO `InstancedMesh` das bolas de todo mundo, e a única
         diferença é a tinta: `pintar` escreve a cor daquela instância nas três
         camadas (núcleo, halo, rastro). É assim que uma bola escura custa zero
         chamada de desenho a mais. */
      const i = this.powers.spawnBlast({
        id: `f:${msg.id ?? 0}`,
        owner: FREEZA_ID,
        origem,
        dir,
        hand: msg.hand ?? 0,
        target: msg.target ?? null,
        local: false,
      });
      /* `0` é um índice válido — daí o teste de tipo, e não um `if (i)`. */
      if (typeof i === "number" && i >= 0) {
        this.powers.blasts.pintar(i, 0.62, 0.09, 0.9);
      }
      this.audio?.rajada?.(origem, FREEZA_ID);
      return;
    }

    const info = NAMEK.freeza.poderes[msg.kind];
    if (!info) return;

    /* O roteamento por FORMA, e não por nome: quem tem `dps` é feixe, quem tem
       `damage` e voa é esfera. É o contrário do que `PowerSystem.spawnSpecial`
       faz (lá é por nome, de propósito, porque lá há quatro golpes fixos com
       histórias diferentes) — aqui há dois, os dois nasceram juntos, e a forma é
       exatamente o que os separa. */
    const disparo = { owner: FREEZA_ID, kind: msg.kind, origem, dir, target: msg.target ?? null, local: false };
    if (info.dps !== undefined) this.powers.beams.disparar(disparo);
    else this.powers.orbes.disparar(disparo);
    this.audio?.especial?.(origem, msg.kind);

    /* ELE RI ENQUANTO JUNTA A DEATH BALL — e só se estiver ganhando.
       É o momento mais em-personagem que a luta oferece, e ele não é gratuito:
       a pose do golpe dura 3,2 s e mata todo mundo num raio de 19 m, então a
       risada é literalmente o aviso de que dá tempo de sair de perto.
       O corte de vida (`risada.folgado`) é o que faz o boss CALAR quando a
       barra desce — ver `NamekAudio.risadaDoFreeza`, onde essa escolha está
       argumentada: o silêncio da segunda metade da luta é, sozinho, a
       informação de que a maré virou. */
    if (msg.kind === "esferaDaMorte" && this.vida > this.vidaMax * (NAMEK.freeza.risada?.folgado ?? 0.62)) {
      this.audio?.risadaDoFreeza?.(this.pontoDoPeito(this._pontoTmp), "grande");
    }
  }

  /* ============================================================== o quadro */

  /**
   * Põe a cápsula dele na lista de alvos dos projéteis.
   *
   * Chamada antes de `PowerSystem.update`, e é ela que faz o Kamehameha do
   * jogador PARAR nele, a Genki Dama detonar contra ele e a bola de ki achá-lo.
   * Sem esta linha o boss seria um fantasma: os golpes o atravessariam.
   *
   * `y` são os PÉS — é a convenção que `distancia2AoAlvo` espera (ela monta a
   * cápsula de `y + raio` a `y + altura − raio`).
   */
  comoAlvo(lista) {
    if (!this.ativo || !lista) return;
    const c = this._capsula;
    c.x = this.mostrado.x;
    c.y = this.mostrado.y;
    c.z = this.mostrado.z;
    c.vivo = true;
    c.invuln = false;
    lista.push(c);
  }

  /**
   * Um acerto saído do relatório do `PowerSystem` era no boss?
   *
   * Devolve `true` quando a vítima é ele — e nesse caso já mandou o
   * `NC2S.FREEZA_HIT` e desenhou a fagulha. Quem chama usa o retorno para NÃO
   * mandar o `BLAST_HIT`/`SPECIAL_HIT` daquele mesmo acerto: a sala procuraria
   * um lutador com o id do boss e não acharia, e o dano se perderia em silêncio.
   *
   * @param {number|string} victim
   * @param {string} kind `"blast"` ou a chave do especial
   * @param {number} dt segundos de exposição (só o Kamehameha usa)
   * @param {{x,y,z}|null} p onde bateu. `null` para os especiais: a fila
   *   `queimando` do `PowerSystem` não carrega ponto — e não precisa, porque o
   *   único alvo possível é ele e o peito dele responde a pergunta.
   */
  acertou(victim, kind, dt, p = null) {
    if (victim !== FREEZA_ID) return false;
    if (!this.ativo) return true; // era dele, mas ele já caiu: some em silêncio
    const ponto = p ?? this.pontoDoPeito(this._pontoTmp);
    this.net?.send?.(NC2S.FREEZA_HIT, {
      kind,
      dt: dt || 0,
      p: [ponto.x, ponto.y, ponto.z],
    });
    /* A fagulha e o baque são LOCAIS e imediatos, como em qualquer acerto: o
       jogador não pode esperar a volta da rede para saber que encostou. A barra
       é que espera — e a diferença entre as duas coisas é justamente o que
       torna a barra confiável. */
    this.fx?.bodyHit?.(ponto.x, ponto.y, ponto.z, FAGULHA);
    this.audio?.acertoNoCorpo?.(ponto, kind !== "blast", FREEZA_ID);
    return true;
  }

  update(dt, cameraPos) {
    this.barra.update(dt);

    /* ------------------------------------------------------ A CENA DE MORTE
     *
     * Ela é o único caso em que o corpo continua sendo atualizado com o boss já
     * fora de campo — e ele NÃO passa por `aplicar`. A distinção é o conserto de
     * um defeito silencioso da versão anterior: `aplicar` reescreve a posição, a
     * pose e a visibilidade da raiz a partir do último pacote da sala, e chamá-lo
     * durante a morte apagava, todo quadro, a subida e a pose aberta que
     * `atualizarMorte` acabara de escrever. O corpo ficava tremendo entre as
     * duas verdades e a raiz piscava.
     *
     * Aqui a sala já não manda nada (`NamekFreeza.passo` sai na primeira linha
     * com ele morto), então não há o que aplicar: o que sobra é a animação. */
    if (!this.ativo && this.corpo.caindo) {
      this.corpo.update(dt, cameraPos);
      if (this._cenaDeMorte && this.corpo.estourou) {
        this._cenaDeMorte = false;
        this.explodir();
      }
      return;
    }

    if (!this.ativo) {
      this.corpo.esconder();
      this._cenaDeMorte = false;
      return;
    }

    /* -------------------------------------------------------- a extrapolação
     * A amostra tem `ATRASO` segundos de idade por construção (é o buffer de
     * interpolação do modo), e o boss anda até 118 m/s: sem estender a posição
     * pela velocidade, ele seria desenhado onze metros atrás de onde a sala o
     * considera. Onze metros num corpo de 2,24 m é o golpe dele saindo do vazio.
     *
     * O teto de meio segundo existe para o caso oposto: um pacote perdido não
     * pode fazer o corpo disparar para o infinito enquanto o próximo não chega. */
    const idade = Math.min(0.5, ATRASO);
    const ax = this.alvo.x + this.alvo.vx * idade;
    const ay = this.alvo.y + this.alvo.vy * idade;
    const az = this.alvo.z + this.alvo.vz * idade;

    const kp = 1 - Math.exp(-SUAVE_POS * dt);
    this.mostrado.x += (ax - this.mostrado.x) * kp;
    this.mostrado.y += (ay - this.mostrado.y) * kp;
    this.mostrado.z += (az - this.mostrado.z) * kp;

    const ka = 1 - Math.exp(-SUAVE_ANG * dt);
    this.mostrado.yaw += curto(this.mostrado.yaw, this.alvo.yaw) * ka;
    this.mostrado.pitch += (this.alvo.pitch - this.mostrado.pitch) * ka;
    this.mostrado.roll += (this.alvo.roll - this.mostrado.roll) * ka;

    if (this.dor > 0) this.dor -= dt;

    this.corpo.aplicar(this.estadoParaCorpo());
    this.corpo.update(dt, cameraPos);
  }

  /** O registro que o corpo lê. Reusado — ver o §3 do plano. */
  estadoParaCorpo() {
    const e = _estado;
    e.x = this.mostrado.x;
    e.y = this.mostrado.y;
    e.z = this.mostrado.z;
    e.yaw = this.mostrado.yaw;
    e.pitch = this.mostrado.pitch;
    e.roll = this.mostrado.roll;
    /* A DOR ganha da pose que veio da rede. Ela é curta (0,28 s) e é a única
       coisa que o corpo faz por conta própria — a sala não manda "leve dano"
       como pose porque isso duplicaria o `FREEZA_HURT` que já sai. */
    e.pose = this.dor > 0 ? POSE.dor : this.pose;
    e.fracao = this.fracao;
    e.aura = this.auraForca;
    e.rapidez = Math.hypot(this.alvo.vx, this.alvo.vy, this.alvo.vz);
    return e;
  }

  /** Está em campo? O laço principal e o menu leem isto. */
  get vivo() {
    return this.ativo;
  }

  /* ========================================================= as duas cenas ==
   *
   * A porta ÚNICA entre o laço principal e a lente cinemática. `NamekGame.step`
   * chama isto uma vez por quadro, depois de já ter montado a pose normal da
   * câmera, e usa o retorno para decidir se ainda vale escrever o retículo, a
   * bússola e os anéis do HUD — que não fazem sentido nenhum enquanto a lente
   * está em outro lugar.
   *
   * Ela abre as cenas PENDENTES aqui, e não onde as mensagens chegam, por uma
   * razão só: as duas precisam da pose que a lente do jogo tem NESTE quadro
   * (é dela que a mistura parte, ver `BossCine._abrir`), e as mensagens chegam
   * na fila de rede, antes de a câmera do quadro existir.
   *
   * @param {number} dt
   * @param {object} lente a `NamekCamera` — `{ position, lookAt }`
   * @returns {boolean} a cena está mandando na câmera?
   */
  passoDaCine(dt, lente) {
    const cine = this.cine;
    if (!cine) return false;

    if (this._cinePedidaMorte) {
      this._cinePedidaMorte = false;
      cine.morte(lente);
    } else {
      this.abrirCenaPendente(lente);
    }

    /* O ponto enquadrado é o `mostrado` — a posição INTERPOLADA, que é a que
       todo mundo vê. Usar o `alvo` cru (o último pacote) faria a lente orbitar
       um ponto e o corpo estar noutro, a até onze metros de distância durante a
       descida, que é justamente quando ele é mais rápido. */
    const marco = cine.update(dt, this.mostrado, lente);
    if (marco === "risada") {
      /* A risada TEATRAL da entrada. `"entrada"` passa por cima da carência de
         6,5 s (ver `NamekAudio.risadaDoFreeza`), e é por isso que as duas do
         pedido conseguem sair com 2,7 s de intervalo — com qualquer outro motivo
         a segunda seria engolida em silêncio. */
      this.audio?.risadaDoFreeza?.(this.pontoDoPeito(this._pontoTmp), "entrada");
    } else if (marco === "nome") {
      /* O NOME, e é literalmente *"é apresentado o nome Freeza"*. Ele sai de
         `NAMEK.freeza.nome` e não escrito aqui: quem trocar o nome dele no
         arquivo de ajustes troca também o que a apresentação anuncia. */
      this.hud?.banner?.(NAMEK.freeza.nome.toUpperCase(), NAMEK.freeza.chegada.nomeDur);
    }
    return cine.ativa;
  }

  /**
   * O boss com a CARA DE UM LUTADOR REMOTO, para a mira poder pegá-lo.
   *
   * ------------------------------------------------------------------ o defeito
   *
   * Esta função existe por causa do pior defeito que este modo já teve, e ele
   * era invisível no código: **nenhum poder do jogador curvava na direção do
   * boss.**
   *
   * Todo golpe deste jogo persegue (§6.1 do plano), e todos eles escolhem a
   * vítima no disparo varrendo `remotes.byId` — a lista de LUTADORES remotos. O
   * Freeza nunca esteve nela: ele não é um lutador, não entra em `todos()` e não
   * chega pelo `NS2C.JOIN`. Consequência em cadeia, e nenhuma linha de erro em
   * lugar nenhum:
   *
   *   • `escolherAlvoDaBola` e `escolherAlvoDeEspecial` nunca o devolviam;
   *   • `LockOn._sobAMira` não o via, então a mira assistida não o marcava, o
   *     anel não acendia e o painel de alvo ficava vazio;
   *   • `alvoDeAtaque()` devolvia null, e com isso o Kamehameha — que só curva
   *     com alvo designado (`soTrava`) — saía RETO contra ele, sempre.
   *
   * Ou seja: contra o boss, e só contra ele, o jogo virava mira manual pura
   * contra um corpo que voa e vira. **Medido**, com um jogador simulado de erro
   * de mira humano (7°) e 0,18 s de atraso: a rajada acertava **7,9 %** dos
   * tiros sem perseguição contra 64,2 % com ela; o Kienzan, 35 % contra 100 %; o
   * Galick Gun, 59 % contra 100 %. Um em cada treze tiros — que é exatamente o
   * relato do jogador, *"nem sequer consigo acertar um único golpe"*.
   *
   * ------------------------------------------------------------------ a defesa
   *
   * Um objeto com a forma que a mira espera — `id`, `pose`, `down`, `color`,
   * `name`, `health` —, reusado entre quadros. Não é um `Fighter` e não vira um:
   * quem o DESENHA continua sendo `FreezaBody`. O que ele empresta é só a
   * identidade que os três seletores de alvo sabem ler, e é essa a fronteira
   * certa — o boss passa a ser mirável sem passar a ser um lutador.
   */
  candidato() {
    if (!this.ativo) return null;
    const c = this._candidato;
    c.pose.x = this.mostrado.x;
    c.pose.y = this.mostrado.y;
    c.pose.z = this.mostrado.z;
    c.health = this.vida;
    c.vidaMax = this.vidaMax;
    return c;
  }

  /** O ponto do peito, em mundo. Para quem quiser mirar nele. */
  /**
   * Alguém morreu — foi ELE quem matou? Se foi, ele ri.
   *
   * -------------------------------------------------- por que é pelo `kind`
   *
   * O `NS2C.DEATH` traz `killer`, e para um abate do boss ele vem **`null`**:
   * `NamekFreeza.bater` passa `por: null` de propósito (o comentário de lá é
   * explícito — um abate do boss não é de ninguém, não há placar onde marcá-lo,
   * e é a mesma decisão que a lava e o mar tomam). Ou seja, o campo óbvio não
   * serve, e mudar aquilo para o cliente poder rir seria mexer na lógica do
   * boss por causa de um som.
   *
   * O que já viaja e basta é o `kind`. Os quatro golpes com que ele fere são os
   * quatro nomes abaixo, e nenhum deles colide com os dos jogadores
   * (`blast`, `kamehameha`, `galick`, `disk`, `genki`) nem com os do cenário
   * (`meteoro`, `lava`, `mar`, `queda`). A lista mora aqui, e não em
   * `audio.js`, porque quem conhece o repertório do boss é o módulo do boss.
   *
   * @param {string} kind o `kind` do `NS2C.DEATH`
   * @returns {boolean} se o abate foi dele
   */
  matou(kind) {
    if (!this.ativo) return false;
    if (kind !== "freeza" && kind !== "freezaOnda" && kind !== "raioDaMorte" && kind !== "esferaDaMorte") {
      return false;
    }
    /* A gargalhada teatral, a mesma da entrada — este é o outro acontecimento
       da luta que vale uma pausa. A carência de `risadaDoFreeza` é que decide
       se ela sai: num abate logo depois de outro, o silêncio é melhor. */
    this.audio?.risadaDoFreeza?.(this.pontoDoPeito(this._pontoTmp), "abate");
    return true;
  }

  pontoDoPeito(out = { x: 0, y: 0, z: 0 }) {
    out.x = this.mostrado.x;
    out.y = this.mostrado.y + NAMEK.freeza.peito;
    out.z = this.mostrado.z;
    return out;
  }

  dispose() {
    this.corpo.dispose();
    this.barra.dispose();
  }
}

/** O registro que atravessa `estadoParaCorpo`. Um só, para sempre. */
const _estado = {
  x: 0, y: 0, z: 0,
  yaw: 0, pitch: 0, roll: 0,
  pose: POSE.parado,
  fracao: 0,
  aura: 0,
  rapidez: 0,
};

export { FreezaBody, POSE };
