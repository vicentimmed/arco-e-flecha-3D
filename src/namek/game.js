/* ---------------------------------------------------------------------------
   Namekusei — o laço principal.

   Este é o arquivo que junta as peças, e ele é o ÚNICO lugar do modo que
   conhece todas elas. Cada subsistema (mundo, personagem, poderes, efeitos,
   controle, câmera, HUD, rede) sabe fazer a própria coisa e não sabe da
   existência dos outros; quem os apresenta é aqui.

   É a mesma forma do `Game` do arqueiro em `src/main.js` — e é um arquivo
   SEPARADO pelo motivo do §0 do plano: o jogo de arco e flecha não pode mudar
   de comportamento por causa deste modo. Um `if (namek)` dentro daquele laço de
   4 100 linhas seria a primeira das mil linhas que acabam mexendo no vale.

   ---------------------------------------------------------------- o quadro

   Passo VARIÁVEL, e essa é uma diferença deliberada em relação ao arqueiro.

   Lá o passo é fixo em 1/120 s num acumulador, porque a flecha é um corpo
   rígido integrado por um solver e o resultado precisa ser idêntico em 60, 120
   ou 144 Hz. Aqui não há solver: o movimento é cinemático e todo amortecimento
   usa `damp()` (que é estável em passo variável, ver `utils/math.js`). Pagar um
   acumulador de passo fixo daria o mesmo resultado por mais trabalho — e o
   passo variável entrega a resposta mais imediata, que é o pedido explícito
   ("a jogabilidade deve ser rápida, não deve ser um jogo travado e lento").

   O `dt` é limitado a 50 ms. Uma aba que volta do segundo plano entrega um
   quadro de vários segundos, e integrar isso de uma vez teleportaria todo mundo
   para fora da arena.
   --------------------------------------------------------------------------- */

import * as THREE from "three";

import { NAMEK, specialInfo, craterFor } from "../shared/namek/config.js";
import { NamekField } from "../shared/namek/field.js";
import { NC2S, NS2C, packFighter, vecFrom } from "../shared/namek/protocol.js";
import { gameEvents, EventType } from "../core/events.js";

import { NamekWorld, NAMEK_CAMERA_FAR } from "./world/index.js";
import { NamekFx } from "./fx/index.js";
import { PowerSystem } from "./powers/index.js";
import { Fighter } from "./character/index.js";
import { FighterController } from "./movement.js";
import { NamekCamera } from "./camera.js";
import { NamekInput } from "./input.js";
import { NamekHud, NamekMenu } from "./ui/index.js";
import { KiMeter } from "./ki.js";
import { NamekAudio } from "./audio.js";
import { NamekClient } from "./net/client.js";
import { RemoteFighters } from "./net/remote.js";

/** s — teto do passo. Ver o cabeçalho. */
const DT_MAX = 0.05;

export class NamekGame {
  constructor(canvas, uiRoot) {
    /* --------------------------------------------------------- desenho --- */
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    /* Contagem manual, como o renderer do arqueiro faz e pelo mesmo motivo: ela
       é o guarda-corpo do orçamento do §3, e o `autoReset` a zeraria a cada
       `render()` deixando só o último passe para ler. */
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    /* O `far` vem do CENÁRIO e não de um palpite daqui: quem sabe onde está o
       domo do céu (2 600 m do olho) e até onde vai o mar (3 200 m) é quem os
       construiu. Um número maior escolhido "por segurança" custaria precisão de
       profundidade em todo o resto da cena sem mostrar um metro a mais. */
    this.camera3 = new THREE.PerspectiveCamera(
      68,
      window.innerWidth / window.innerHeight,
      0.15,
      NAMEK_CAMERA_FAR,
    );

    /* --------------------------------------------------------- o mundo --- */
    this.field = new NamekField();
    this.world = new NamekWorld(this.scene, this.field);
    /* A fila de crateras tem teto, e quem sai da altura precisa sair da malha
       junto — senão o buraco fica desenhado sobre um chão que a física já
       considera liso. Ver `NamekField.onRetire`. `applyCrater` recalcula o disco
       a partir do relevo base e das crateras que AINDA existem, então reaplicá-lo
       sobre a que saiu é exatamente o que a devolve ao lugar. */
    this.field.onRetire = (velha) => this.world.applyCrater(velha);
    this.fx = new NamekFx(this.scene, this.field);
    this.powers = new PowerSystem(this.scene, this.field);

    /* -------------------------------------------------------- o jogador --- */
    this.controller = new FighterController(this.field);
    this.ki = new KiMeter();
    this.me = new Fighter(this.scene, 0xff7a1a, true);
    this.cam = new NamekCamera(this.camera3, this.field);
    this.input = new NamekInput(canvas);
    this.hud = new NamekHud(uiRoot);
    /* O som nasce MUDO e só acorda no primeiro clique — ver `NamekAudio.unlock`.
       Todo navegador suspende o contexto de áudio até um gesto do usuário, e
       aqui o gesto é o mesmo que captura o ponteiro. */
    this.audio = new NamekAudio(this.camera3, this.scene);
    /* A ÚNICA superfície de comando do modo. Pôr bot e virar o clima moram aqui
       porque o pedido fechou o teclado em "só o menu geral" — e sem um lugar
       para elas, a IA inteira e a tempestade ficariam escritas e inalcançáveis.
       Ver o cabeçalho de `ui/menu.js`. */
    this.menu = new NamekMenu(uiRoot, {
      addBot: () => this.net.send(NC2S.BOT, {}),
      removeBot: () => this.net.send(NC2S.BOT, { remove: true }),
      setWeather: (id) => this.net.send(NC2S.WEATHER, { id }),
      sair: () => {
        this.net.disconnect();
        location.reload();
      },
    });
    /** Clima em cena, só para o menu acender o botão certo. */
    this.weather = NAMEK.weather.padrao;

    /* ----------------------------------------------------------- rede --- */
    this.net = new NamekClient();
    this.remotes = new RemoteFighters(this.scene, () => this.net.serverTime);

    /** Meu id na sala. Vem no `welcome`. */
    this.myId = null;
    this.myName = "";
    /** Vida — a SALA é a autoridade; isto é a cópia local para o HUD. */
    this.health = NAMEK.fighter.maxHealth;
    this.down = false;
    this.deadUntil = 0;
    this.invulnUntil = 0;

    /** Alvo travado (E). null = sem trava. */
    this.lockId = null;
    /** Especial armado (índice em `NAMEK.specialOrder`). */
    this.specialIndex = 0;
    /** O especial em execução: `{ kind, t, dur, dir }` ou null. */
    this.casting = null;

    /** Id local de cada bola, para casar o acerto com o disparo. */
    this.blastSeq = 1;
    /** s — relógio da cadência da rajada. */
    this.blastCooldown = 0;
    /** Qual mão atira a próxima. Alterna — é o pedido explícito. */
    this.nextHand = 0;

    /** ms — quando a próxima pose sai. */
    this.nextStateAt = 0;

    this.running = false;
    this.lastTime = 0;

    /* ------------------------------------------------------- rascunhos ---
     *
     * Objetos que o passo reescreve em vez de recriar. São quatro literais por
     * quadro — o alvo da câmera, a minha cápsula na lista de alvos, o ponto da
     * trava e o registro do HUD —, ~240 por segundo, contra os "0 B em regime"
     * do §3 que todo o resto do modo pagou caro para respeitar.
     *
     * E o `bind`: `this.frame.bind(this)` dentro do próprio `frame` cria uma
     * função NOVA a cada quadro. Amarrado uma vez, no construtor, ele é o mesmo
     * para sempre. */
    this._frameBound = this.frame.bind(this);
    this._alvoCam = {
      position: null, yaw: 0, pitch: 0, velocity: null, flying: false, boosting: false,
    };
    this._minhaCapsula = {
      id: 0, x: 0, y: 0, z: 0,
      raio: NAMEK.fighter.radius,
      altura: NAMEK.fighter.height,
      vivo: true, invuln: false,
    };
    this._pontoTrava = { x: 0, y: 0, z: 0 };
    this._alvoHud = { id: 0, nome: "", cor: 0, vida: 0, vidaMax: NAMEK.fighter.maxHealth };

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);

    /* O PRIMEIRO GESTO destrava o áudio, e ele precisa ser um ouvinte próprio.
     *
     * O navegador só libera o contexto de som dentro de um `click`/`keydown` de
     * verdade — não adianta chamar `resume()` de dentro do laço, por mais que o
     * jogador já esteja jogando. `once: true` porque destravar é irreversível e
     * um ouvinte permanente na janela inteira seria custo eterno por um evento
     * que acontece uma vez na partida. */
    const destravar = () => this.audio.unlock();
    window.addEventListener("pointerdown", destravar, { once: true });
    window.addEventListener("keydown", destravar, { once: true });

    this.bindNetwork();
    this.bindParticles();
  }

  /**
   * A ponte entre os poderes e os efeitos.
   *
   * `src/namek/powers/` emite os floreios — a fagulha da pose de carga, o
   * clarão da boca do feixe, a faísca do talho do Kienzan — por
   * `gameEvents.emit(EventType.PARTICLES)`, que é o barramento que
   * `systems/impactFx.js` já usa no jogo do arqueiro. É a escolha certa: o
   * emissor não deve conhecer o desenhista.
   *
   * Só que quem escuta aquele barramento é `installImpactEffects()`, e ela roda
   * dentro do `Game` do arqueiro — que neste modo nunca é construído (ver
   * `boot.js`). Sem esta assinatura o barramento não tem NINGUÉM do outro lado:
   * o que é estrutural aparece (feixe, disco, esfera, casca são malhas de
   * verdade) e todo o resto fica mudo, sem erro nenhum para acusar. É o pior
   * tipo de defeito — o que só se percebe comparando com o que deveria estar lá.
   *
   * O barramento é um módulo puro de pub/sub e não arrasta nada do arqueiro
   * junto; assinar aqui não é acoplamento, é fechar o circuito.
   */
  bindParticles() {
    this._offParticles = gameEvents.on(EventType.PARTICLES, (p) => {
      const pos = p.position;
      if (!pos) return;
      this.fx.fagulhas(
        pos.x,
        pos.y,
        pos.z,
        p.size ?? 0.5,
        p.color ?? 0xbfe8ff,
        /* Teto na contagem: um pedido de 200 partículas para um floreio esvazia
           o pool e engole a poeira do impacto, que é a informação que importa.
           O emissor pede o que quer; quem tem o orçamento é quem desenha. */
        Math.min(p.count ?? 12, 40),
        p.speed ?? 12,
      );
    });
  }

  build(progresso = () => {}) {
    this.world.build(progresso);
    return this;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera3.aspect = w / h;
    this.camera3.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------- rede ----- */

  bindNetwork() {
    const net = this.net;

    net.on("welcome", (msg) => {
      this.myId = msg.you.id;
      this.myName = msg.you.name;
      this.me.setColor(msg.you.color ?? 0xff7a1a);
      /* A vida NÃO vem no `welcome` — a visão pública de um lutador é
         identidade (id, nome, cor, corpo), não estado. Quem entra nasce inteiro
         por definição, e a partir daí quem manda é o `VITALS` a 10 Hz. Havia um
         `msg.you.health` aqui lendo um campo que nunca existiu: funcionava por
         acidente, pelo `??`, e escondia de onde a vida realmente vem. */
      this.health = NAMEK.fighter.maxHealth;

      /* O CHÃO JÁ DEFORMADO. Quem entra no meio de uma partida precisa do mesmo
         relevo que os outros têm — é o critério 6 do §12 do plano. A lista vem
         com raio e fundura prontos de propósito (ver `NamekField.loadCraters`). */
      this.field.loadCraters(msg.craters);
      for (const c of this.field.craters) this.world.applyCrater(c);

      /* `.id` — o `welcome` traz o clima como `{ id, w }`, não como a string
         que o `NS2C.WEATHER` de cada troca manda. Passar o objeto inteiro não
         estourava: `setWeather` valida contra `NAMEK.weather.ids`, não achava o
         objeto lá e desistia CALADO. O sintoma era quem entrasse no meio de uma
         tempestade ver dia claro enquanto todo mundo via o planeta explodindo. */
      this.weather = msg.weather?.id ?? NAMEK.weather.padrao;
      this.world.setWeather(this.weather, true);
      this.remotes.reconcile((msg.fighters ?? []).filter((f) => f.id !== this.myId));
      this.hud.setScores(this.placar(msg.scores));
      /* Quem nasce é o `NS2C.SPAWN`, que a sala manda logo depois do `welcome`
         — e é ele que traz o ponto, o rumo e o fim da invulnerabilidade. Havia
         um `this.nascer(msg.you.spawn)` aqui, lendo um campo inexistente e
         saindo na primeira linha: o nascimento funcionava, mas por outro
         caminho, e a leitura morta escondia qual. */
    });

    net.on(NS2C.JOIN, (msg) => {
      if (msg.fighter.id === this.myId) return;
      this.remotes.add(msg.fighter);
      this.hud.toast(`${msg.fighter.name} entrou`);
    });

    net.on(NS2C.LEAVE, (msg) => {
      this.remotes.remove(msg.id);
      if (this.lockId === msg.id) this.lockId = null;
    });

    net.on(NS2C.STATES, (msg) => this.remotes.applyStates(msg));

    net.on(NS2C.VITALS, (msg) => {
      this.remotes.applyVitals(msg);
      /* A minha barra também vem aqui: a sala é a autoridade sobre o ki (ela
         cobra os disparos) e sobre a vida. O `sincronizar` PERSEGUE em vez de
         escrever — ver o comentário lá, é o que impede a barra de engasgar a
         cada amostra. */
      for (const [id, health, ki] of msg.h ?? []) {
        if (id !== this.myId) continue;
        this.health = health;
        this.ki.sincronizar(ki);
      }
    });

    /* Projéteis dos OUTROS: eu desenho, eu não julgo. Quem atira é a autoridade
       sobre o próprio acerto (§8 do plano) — o `local: false` é o que diz ao
       sistema de poderes para não reportar acerto nenhum destes. */
    net.on(NS2C.BLAST, (msg) => {
      if (msg.owner === this.myId) return; // o meu eu já desenhei no disparo
      this.powers.spawnBlast({
        id: `${msg.owner}:${msg.id}`,
        owner: msg.owner,
        origem: vecFrom(msg.o),
        dir: vecFrom(msg.d),
        hand: msg.hand,
        target: msg.target ?? null,
        local: false,
      });
      /* A bola dos OUTROS também soa. Sem isto o campo de batalha é mudo
         exceto por você, e quinze lutadores brigando viram um filme sem trilha
         — pior, você deixa de ouvir de que lado vem o tiro. A cota por lutador
         em `NamekAudio.rajada` é o que impede isso de virar serra elétrica. */
      this.audio.rajada(vecFrom(msg.o), msg.owner);
    });

    net.on(NS2C.SPECIAL, (msg) => {
      if (msg.owner === this.myId) return;
      this.powers.spawnSpecial({
        owner: msg.owner,
        kind: msg.kind,
        origem: vecFrom(msg.o),
        dir: vecFrom(msg.d),
        local: false,
      });
      this.audio.especial(vecFrom(msg.o), msg.kind);
    });

    net.on(NS2C.BURST, (msg) => {
      if (msg.owner === this.myId) return;
      /* `p`, não `o`. A onda é a única das três retransmissões que carrega o
         ponto em `p` — porque é o campo que o `NC2S.BURST` do cliente usa, e a
         sala repassa o que recebeu. Lendo `o`, o `vecFrom(undefined)` estourava
         um TypeError DENTRO do tratador da mensagem: a onda dos outros nunca
         aparecia, e o resto daquele pacote morria junto. */
      const origem = vecFrom(msg.p);
      this.powers.spawnBurst({ owner: msg.owner, origem, local: false });
      this.audio.ondaDeChoque(origem);
      /* O EMPURRÃO EM MIM É CALCULADO AQUI, e não pelo sistema de poderes.
       *
       * Lá o empurrão só é resolvido para a onda de quem é DONO dela, e o dono
       * nunca está entre os próprios alvos — então a conta que existe no
       * `PowerSystem` jamais produz uma vítima que seja eu. O resultado era uma
       * "defesa de pressão" (§6 do plano) que empurrava bot, porque a sala mexe
       * na velocidade deles, e não empurrava gente NENHUMA.
       *
       * Cada cliente aplicar em si mesmo é o mesmo repartição de autoridade do
       * resto do modo: quem manda na minha posição sou eu (§8). Recalcular custa
       * uma raiz quadrada num acontecimento raro. */
      this.empurraoDaOnda(origem);
    });

    net.on(NS2C.HURT, (msg) => {
      if (msg.id === this.myId) {
        const antes = this.health;
        this.health = msg.health;
        const fracao = Math.min(1, (antes - msg.health) / 34);
        this.hud.hurtFlash(fracao);
        this.audio.levouDano(this.controller.position, fracao > 0.4);
        this.cam.shake(0.3 + fracao * 0.7, 0.25);
        const de = this.remotes.get(msg.by);
        if (de) this.hud.damageFrom(this.anguloNaTela(de.pose));
        return;
      }
      const r = this.remotes.get(msg.id);
      if (r) {
        r.health = msg.health;
        /* A DIREÇÃO É DEDUZIDA, não recebida.
         *
         * O `HURT` traz quem bateu (`by`), não o vetor — e mandar o vetor seria
         * três números a mais numa mensagem que já sai a 6 Hz por vítima, para
         * dizer o que as duas pontas já sabem: onde estão os dois corpos. Sem
         * deduzir, o `hit(null)` deixava toda dor igual, que é justamente o que
         * o `Fighter.hit` documenta que não pode acontecer. */
        r.fighter.hit(this.direcaoDoGolpe(msg.by, r.pose), msg.amount > 20);
        this.audio.acertoNoCorpo(r.pose, msg.amount > 20);
      }
    });

    net.on(NS2C.DEATH, (msg) => {
      const dir = msg.d ? vecFrom(msg.d) : null;

      /* O PRÊMIO DO ABATE, no quadro em que o corpo começa a cair.
       *
       * A sala já encheu a barra dela (ver `matar`) e o `VITALS` traria o valor
       * em até 100 ms — mas o `sincronizar` PERSEGUE em vez de escrever, então a
       * barra local levaria meio segundo para chegar ao topo e o especial
       * recusaria durante esse tempo com a tela dizendo que dá. Encher aqui é o
       * "instantaneamente" do pedido; as duas pontas já concordam, e a amostra
       * seguinte não tem o que corrigir. */
      if (msg.killer === this.myId && msg.victim !== this.myId && !this.down) {
        this.ki.encher();
        this.hud.toast("derrubou — ki cheio");
        this.audio.kiEncheu();
      }

      if (msg.victim === this.myId) {
        this.morrer(dir);
        this.audio.morreu(this.controller.position);
      } else {
        const morto = this.remotes.get(msg.victim);
        morto?.fighter.die(dir);
        if (morto) this.audio.morreu(morto.pose);
        if (this.lockId === msg.victim) this.lockId = null;
      }
      /* Os DOIS como objeto, e não como nome solto: o feed pinta cada lado com
         a cor do lutador e destaca a sua própria linha por id. Passando string,
         `pessoa()` devolvia cor nula para todo mundo e a metade colorida do
         placar de mortes nunca chegava a aparecer. */
      this.hud.killFeed(this.quem(msg.killer), this.quem(msg.victim), msg.kind);
    });

    net.on(NS2C.SPAWN, (msg) => {
      if (msg.id === this.myId) this.nascer(msg);
      else this.remotes.get(msg.id)?.fighter.revive();
    });

    /* CRATERA. Vem de todo mundo, inclusive de volta de mim — e a volta não é
       desperdício: é ela que carimba o id da sala no buraco que eu já abri
       localmente. `addCrater` é idempotente por id justamente para isso, e
       devolver null é o sinal de que não há nada novo a esculpir. */
    net.on(NS2C.CRATER, (msg) => {
      const c = this.field.addCrater(msg.i, msg.p[0], msg.p[2], msg.power);
      if (c) {
        this.world.applyCrater(c);
        /* O estouro de quem NÃO sou eu. O meu já soou no `reportar`, no
           instante do impacto; este chega pelo carimbo da sala, e é o que faz a
           destruição alheia existir para o ouvido. */
        if (msg.by !== this.myId) {
          this.audio.estouroNoChao({ x: msg.p[0], y: msg.p[1], z: msg.p[2] }, msg.power);
        }
      }
    });

    net.on(NS2C.PROP_DOWN, (msg) => {
      this.world.breakProp(msg.kind, msg.i);
    });

    net.on(NS2C.WEATHER, (msg) => {
      this.weather = msg.id;
      this.menu.setWeather(msg.id);
      this.world.setWeather(msg.id);
      this.hud.banner(
        msg.id === "tempestade" ? "O PLANETA ESTÁ EXPLODINDO" : "O CÉU ABRIU",
        3,
      );
    });

    net.on(NS2C.BOLT, (msg) => {
      this.world.strikeBolt(msg.p[0], msg.p[1]);
      this.audio.raio(msg.p[0], msg.p[1]);
      /* O tremor só se sente PERTO. Um raio a 800 m sacudindo a câmera diria
         que ele caiu ao lado, e a tempestade inteira viraria um tremor
         constante sem informação nenhuma. */
      const d = Math.hypot(msg.p[0] - this.controller.position.x, msg.p[1] - this.controller.position.z);
      if (d < 260) this.cam.shake(NAMEK.weather.tempestade.tremor * (1 - d / 260), 0.4);
    });

    net.on(NS2C.SCORES, (msg) => this.hud.setScores(this.placar(msg.s)));

    net.on("disconnected", () => this.hud.toast("conexão caiu — reconectando…"));
    net.on("reconnecting", () => this.hud.toast("reconectando…"));
  }

  async connect(nome) {
    await this.net.connect(nome, "kakarot");
  }

  /* -------------------------------------------------------- nascer/morrer -- */

  nascer(spawn) {
    if (!spawn) return;
    const p = spawn.p ? vecFrom(spawn.p) : { x: 0, y: NAMEK.respawn.dropHeight, z: 0 };
    this.controller.teleport(p.x, p.y, p.z, spawn.yaw ?? 0);
    /* A LENTE TAMBÉM TELEPORTA. Sem isto ela persegue amortecida o ponto novo e
       varre a arena inteira no caminho — meio segundo de montanha passando de
       lado toda vez que alguém renasce, e o jogador volta ao jogo já perdido no
       espaço. É a mesma marcação que `PlayerPhysics.markTeleport` faz no jogo do
       arqueiro, e pelo mesmo motivo. */
    this.cam.markTeleport();
    this.me.revive();
    this.down = false;
    this.deadUntil = 0;
    this.health = NAMEK.fighter.maxHealth;
    this.invulnUntil = spawn.invulnUntil ?? this.net.serverTime + NAMEK.respawn.invuln * 1000;
    this.hud.setDead(null);
    /* Nasce VOANDO. Cair de 120 m no chão é o que a queda de nascimento do vale
       faz — e lá ela dura 1,4 s e termina numa nuvem de poeira. Aqui o lutador
       voa: pousá-lo à força seria tirar dele, no instante da volta, a única
       coisa que ele estava querendo fazer. */
    this.controller.flying = true;
  }

  morrer(direcao) {
    if (this.down) return;
    this.down = true;
    this.deadUntil = this.net.serverTime + NAMEK.respawn.delay * 1000;
    this.me.die(direcao);
    this.lockId = null;
    this.casting = null;
    this.cam.shake(1, 0.6);
  }

  /* --------------------------------------------------------------- ajuda -- */

  nomeDe(id) {
    if (id === this.myId) return this.myName;
    return this.remotes.get(id)?.name ?? "alguém";
  }

  /** Quem é este id, do jeito que o feed e o placar sabem desenhar. */
  quem(id) {
    if (id === this.myId) return { id, nome: this.myName, cor: this.me.cor ?? null };
    const r = this.remotes.get(id);
    return r ? { id, nome: r.name, cor: r.color } : { id: null, nome: "alguém", cor: null };
  }

  /**
   * O tranco que uma onda alheia me dá.
   *
   * Cai com a distância — cheio no centro, zero na borda —, e é isso que faz a
   * onda ser DEFESA e não arma: quem está colado leva o empurrão inteiro e sai
   * de cima; quem está a doze metros mal sente. O dano quem cobra é a sala.
   */
  empurraoDaOnda(origem) {
    if (this.down) return;
    const K = NAMEK.ki;
    const c = this.controller.position;
    const dx = c.x - origem.x;
    const dy = c.y + NAMEK.fighter.chest - origem.y;
    const dz = c.z - origem.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > K.burstRadius) return;
    /* Distância zero é o caso em que dois lutadores ocupam o mesmo ponto: sem
       esta guarda a normalização divide por zero e a velocidade vira NaN — e um
       NaN em posição não é um empurrão errado, é um corpo que some da tela e
       nunca mais volta. Para cima, que é a única direção sem ambiguidade. */
    const forca = K.burstPush * (1 - d / K.burstRadius);
    if (d < 0.001) {
      this.controller.push(0, forca, 0, NAMEK.fighter.stunTime * 0.4);
      return;
    }
    const inv = forca / d;
    this.controller.push(dx * inv, dy * inv, dz * inv, NAMEK.fighter.stunTime * 0.4);
  }

  /**
   * Derruba o cenário que o estouro alcançou.
   *
   * A peça cai por ÁREA — pelo raio da cratera —, e não por colisão de cada
   * projétil contra cada rocha. É a decisão certa por dois motivos, e o segundo
   * é o que decide:
   *
   * 1. É o que a referência faz: no Budokai Tenkaichi 3 o cenário desaparece em
   *    volta do ponto onde o golpe estourou, não onde a bola encostou.
   * 2. Testar 200 projéteis contra ~550 peças por quadro é uma varredura de
   *    110 000 pares; aqui são ~550 testes no instante raro de um estouro. E o
   *    caso que a colisão por projétil pegaria e este não — uma bola de ki
   *    passando de raspão numa árvore sem tocar o chão — é justamente o que NÃO
   *    deve derrubar uma árvore.
   *
   * Quem decide de verdade é a sala (`NC2S.PROP_HIT` → `NS2C.PROP_DOWN`): a
   * peça só some da tela quando ela confirma, e é isso que faz a vila cair igual
   * para todo mundo. Aqui só se pede.
   */
  derrubarPorPerto(ponto, power) {
    const raio = craterFor(power).raio;
    /* Uma peça grande na borda ainda é atingida: o teste é contra o raio dela
       mais o do estouro, não contra o centro. */
    const props = this.world.props;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (p.vida <= 0) continue;
      const dx = p.x - ponto.x;
      const dy = p.y - ponto.y;
      const dz = p.z - ponto.z;
      const alcance = raio + p.raio;
      if (dx * dx + dy * dy + dz * dz > alcance * alcance) continue;
      this.net.send(NC2S.PROP_HIT, { kind: p.kind, i: p.i });
    }
  }

  /**
   * De onde veio a pancada: versor de quem bateu para quem levou.
   *
   * `null` quando o agressor não é ninguém que esteja em cena — morrer para o
   * chão ou para uma queda não tem direção, e inventar uma jogaria o corpo para
   * um lado ao acaso.
   */
  direcaoDoGolpe(byId, alvo) {
    if (byId === null || byId === undefined) return null;
    const de =
      byId === this.myId
        ? this.controller.position
        : this.remotes.get(byId)?.pose ?? null;
    if (!de) return null;
    const dx = alvo.x - de.x;
    const dy = alvo.y - de.y;
    const dz = alvo.z - de.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Mesmo ponto: não há direção. Ver a guarda gêmea em `empurraoDaOnda`.
    if (d < 0.001) return null;
    return { x: dx / d, y: dy / d, z: dz / d };
  }

  /** Quantos em campo são de CPU. Alimenta o menu. */
  botCount() {
    let n = 0;
    for (const r of this.remotes.byId.values()) if (r.isBot) n++;
    return n;
  }

  placar(lista) {
    return (lista ?? []).map((s) => ({ ...s, nome: s.name, eu: s.id === this.myId }));
  }

  /** Ângulo na tela de onde veio uma pancada — alimenta a marca de dano. */
  anguloNaTela(p) {
    const dx = p.x - this.controller.position.x;
    const dz = p.z - this.controller.position.z;
    return Math.atan2(dx, dz) - this.controller.yaw;
  }

  /* -------------------------------------------------------------- mira ---- */

  /**
   * Escolhe o alvo travado, ou o solta.
   *
   * Trava no que está mais perto do CENTRO DA TELA, não no mais próximo no
   * espaço: o jogador aponta para quem ele quer brigar, e o mais próximo é
   * frequentemente alguém às costas dele.
   */
  alternarTrava() {
    if (this.lockId !== null) {
      this.lockId = null;
      this.hud.setCrosshair("livre");
      return;
    }
    const dir = this.cam.aimDirection();
    let melhor = null;
    let melhorCos = 0.72; // ~44° de meio-ângulo: generoso, mas não "atrás de mim"
    for (const r of this.remotes.byId.values()) {
      if (r.down) continue;
      const dx = r.pose.x - this.controller.position.x;
      const dy = r.pose.y + NAMEK.fighter.chest - (this.controller.position.y + NAMEK.fighter.chest);
      const dz = r.pose.z - this.controller.position.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (cos > melhorCos) {
        melhorCos = cos;
        melhor = r;
      }
    }
    this.lockId = melhor?.id ?? null;
    if (this.lockId !== null) this.audio.travou();
    this.hud.setCrosshair(this.lockId !== null ? "travado" : "livre");
  }

  /** O ponto do alvo travado, ou null. */
  pontoDaTrava() {
    const r = this.lockId !== null ? this.remotes.get(this.lockId) : null;
    if (!r || r.down) return null;
    // Rascunho reescrito: este ponto é lido pela câmera e pela mira todo quadro.
    const p = this._pontoTrava;
    p.x = r.pose.x;
    p.y = r.pose.y + NAMEK.fighter.chest;
    p.z = r.pose.z;
    return p;
  }

  /* ------------------------------------------------------------ disparos -- */

  /**
   * A rajada básica: uma bola por mão, ALTERNANDO, enquanto o botão está
   * apertado. É o pedido literal do usuário, e a alternância é o que dá o ritmo
   * de duas mãos do anime em vez de uma metralhadora de um cano só.
   */
  atirar(dt) {
    this.blastCooldown -= dt;
    if (this.blastCooldown > 0) return;
    if (!this.ki.gastar(NAMEK.ki.blastCost)) return;

    this.blastCooldown = 1 / NAMEK.blast.rate;
    const mao = this.nextHand;
    this.nextHand = mao === 0 ? 1 : 0;

    const origem = this.me.handPoint(mao);
    const dir = this.direcaoDeTiro(origem);
    const alvo = this.escolherAlvoDaBola(origem, dir);

    const id = this.blastSeq++;
    this.powers.spawnBlast({
      id: `${this.myId}:${id}`,
      owner: this.myId,
      origem,
      dir,
      hand: mao,
      target: alvo,
      local: true,
    });
    this.me.lastHand = mao;
    this.me.handPose = 1;
    this.audio.rajada(origem, this.myId);

    this.net.send(NC2S.BLAST, {
      id,
      o: [origem.x, origem.y, origem.z],
      d: [dir.x, dir.y, dir.z],
      hand: mao,
      target: alvo,
      w: this.net.serverTime,
    });
  }

  /**
   * Para onde a bola sai.
   *
   * Com alvo travado ela sai na direção DELE, não do retículo — é o que o BT3
   * faz, e é o que torna o combate aéreo jogável: mirar à mão em alguém que se
   * move a 96 m/s enquanto você também se move não é habilidade, é sorte.
   *
   * Sem trava, sai pela mira. E em nenhum dos dois casos a bola procura sozinha
   * — a perseguição dela é fraca e limitada, ver o §6.1 do plano.
   */
  direcaoDeTiro(origem) {
    const trava = this.pontoDaTrava();
    if (trava) {
      const dx = trava.x - origem.x;
      const dy = trava.y - origem.y;
      const dz = trava.z - origem.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      return { x: dx / d, y: dy / d, z: dz / d };
    }
    return this.cam.aimDirection();
  }

  /**
   * Quem a bola vai perseguir — decidido AQUI, no disparo, e nunca revisto.
   *
   * O alvo travado tem prioridade. Sem trava, o mais alinhado com o tiro dentro
   * de `acquire` metros. Uma bola que troca de alvo no meio do voo lê como bug,
   * e é por isso que este valor viaja na mensagem em vez de cada cliente
   * recalculá-lo (ver o comentário de `NC2S.BLAST`).
   */
  escolherAlvoDaBola(origem, dir) {
    if (this.lockId !== null) return this.lockId;
    const H = NAMEK.blast.homing;
    const cosCone = Math.cos((H.cone * Math.PI) / 180);
    let melhor = null;
    let melhorCos = cosCone;
    for (const r of this.remotes.byId.values()) {
      if (r.down) continue;
      const dx = r.pose.x - origem.x;
      const dy = r.pose.y + NAMEK.fighter.chest - origem.y;
      const dz = r.pose.z - origem.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > H.acquire || d < 0.001) continue;
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (cos > melhorCos) {
        melhorCos = cos;
        melhor = r.id;
      }
    }
    return melhor;
  }

  /**
   * O especial. **Só sai com a barra CHEIA** — é a regra do §5 do plano e o
   * pedido explícito do usuário.
   */
  soltarEspecial(indice) {
    if (this.casting || this.down) return;
    const kind = NAMEK.specialOrder[indice];
    const info = specialInfo(kind);
    if (!info) return;
    if (!this.ki.podeEspecial()) {
      this.hud.toast("ki insuficiente — segure C para carregar");
      return;
    }
    this.ki.gastarTudo();

    const origem = this.me.chestPoint();
    const dir = this.direcaoDeTiro(origem);
    this.casting = { kind, indice, t: 0, dur: info.windup + info.sustain, dir };
    this.specialIndex = indice;

    /* A DIREÇÃO É TRAVADA AGORA, no início da pose, e não quando o feixe sai.
       O windup do Kamehameha dura um segundo inteiro; deixar a direção viva até
       o fim dele permitiria carregar olhando para o chão e disparar tendo girado
       para o céu, o que apaga o custo de se comprometer — que é a única coisa
       que o windup existe para cobrar. */
    this.powers.spawnSpecial({ owner: this.myId, kind, origem, dir, local: true });
    this.audio.especial(origem, kind);
    this.net.send(NC2S.SPECIAL, {
      kind,
      o: [origem.x, origem.y, origem.z],
      d: [dir.x, dir.y, dir.z],
      w: this.net.serverTime,
    });
  }

  onda() {
    if (this.down) return;
    if (!this.ki.gastar(NAMEK.ki.burstCost)) return;
    const origem = this.me.chestPoint();
    this.powers.spawnBurst({ owner: this.myId, origem, local: true });
    this.audio.ondaDeChoque(origem);
    this.net.send(NC2S.BURST, { p: [origem.x, origem.y, origem.z] });
  }

  /* -------------------------------------------------------------- quadro -- */

  start() {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this._frameBound);
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(DT_MAX, (now - this.lastTime) / 1000);
    this.lastTime = now;
    try {
      this.step(dt);
    } catch (err) {
      /* Um erro aqui mataria o `requestAnimationFrame` e a tela congelaria sem
         nada no console além do primeiro estouro. Registrar e seguir é o que
         mantém o jogo de pé o suficiente para a pessoa entender o que houve —
         e para o erro aparecer UMA vez, não sessenta por segundo. */
      if (!this._erroReportado) {
        console.error("Namekusei — erro no quadro:", err);
        this._erroReportado = true;
      }
    }
    requestAnimationFrame(this._frameBound);
  }

  step(dt) {
    const acoes = this.input.actions();
    const agora = this.net.serverTime;

    /* O MENU, antes de tudo. Ele solta o ponteiro e cala o teclado do jogo (é o
       que `setMenuOpen` faz lá dentro), então tratá-lo depois das ações deixaria
       um quadro de comandos passando por baixo da tela aberta. */
    if (acoes.menuPressed) {
      this.input.setMenuOpen(this.menu.toggle());
      this.hud.showHelp(this.menu.aberto);
      if (this.menu.aberto) {
        this.menu.setRoster(this.remotes.byId.size + 1, this.botCount());
        this.menu.setWeather(this.weather);
      }
    }

    /* ---------------------------------------------------------- morto --- */
    if (this.down) {
      const falta = Math.max(0, this.deadUntil - agora);
      this.hud.setDead(falta / 1000);
      if (falta <= 0 && acoes.respawn) this.net.send(NC2S.RESPAWN, {});
    }

    /* ------------------------------------------------------------ ki --- */
    this.ki.carregando = acoes.charge && !this.down && !this.casting;
    this.ki.update(dt);
    if (this.ki.encheuAgora) {
      this.hud.toast("ki cheio — especial pronto");
      this.audio.kiEncheu();
    }

    /* -------------------------------------------------------- controle --- */
    /* Carregar ki PRENDE no lugar, e é a troca central do modo: poder em troca
       de estar parado à vista de todo mundo. Zerar as ações de movimento é como
       isso é imposto, e fazê-lo aqui — e não dentro do controlador — é o que
       mantém o controlador ignorante do ki. */
    if (this.ki.carregando) {
      acoes.forward = 0;
      acoes.strafe = 0;
      acoes.up = 0;
      acoes.boost = false;
      acoes.run = false;
    }
    const pouso = this.down ? null : this.controller.update(dt, acoes, this.ki);

    /* O POUSO FORTE. Cratera, poeira e dano — é o pedido literal: "se o player
       cair do alto e cair no chão deve deformar e fazer nuvem de poeira". Quem
       decide o dano é a sala; o buraco e a poeira são locais e imediatos, para
       o baque não chegar meio segundo depois do impacto. */
    if (pouso && pouso.speed >= NAMEK.destruction.slamSpeed) {
      const power = (pouso.speed - NAMEK.destruction.slamSpeed) * NAMEK.destruction.slamPower;
      this.fx.slam(pouso.p.x, pouso.p.y, pouso.p.z, pouso.speed);
      this.audio.quedaNoChao(pouso.p, pouso.speed);
      this.cam.shake(Math.min(1, power * 0.6), 0.3);
      this.net.send(NC2S.SLAM, {
        p: [pouso.p.x, pouso.p.y, pouso.p.z],
        speed: pouso.speed,
      });
      // Cair de cem metros no meio da vila derruba a vila. Mesma regra do
      // estouro, mesma autoridade: aqui só se pede, quem confirma é a sala.
      this.derrubarPorPerto(pouso.p, power);
    }

    /* A TRAVA vem antes da câmera porque é ela que decide o enquadramento deste
       quadro. O DISPARO vem depois — ver `dispararAgora`, no fim do passo. */
    if (!this.down && acoes.lockPressed) this.alternarTrava();

    /* O especial em curso: a fração alimenta a pose (e viaja na rede como um
       número só — o mesmo truque do `q` do Kamehameha do arqueiro). */
    if (this.casting) {
      this.casting.t += dt;
      if (this.casting.t >= this.casting.dur) this.casting = null;
    }

    /* -------------------------------------------------------- a minha pose */
    const c = this.controller;
    this.me.position.x = c.position.x;
    this.me.position.y = c.position.y;
    this.me.position.z = c.position.z;
    this.me.velocity.x = c.velocity.x;
    this.me.velocity.y = c.velocity.y;
    this.me.velocity.z = c.velocity.z;
    this.me.yaw = c.yaw;
    this.me.pitch = c.pitch;
    this.me.roll = c.roll;
    this.me.gaitPhase = c.gaitPhase;
    this.me.runBlend = c.runBlend;
    this.me.flyBlend = c.flyBlend;
    this.me.boostBlend = c.boostBlend;
    this.me.chargeBlend = this.ki.blend;
    /* A AURA DE BARRA CHEIA. É o pedido de "mostrar que ele está com o ki
       cheio", e ela ganha um canal próprio em vez de virar mais um `if` na
       aura: quem desenha o corpo não conhece a barra, e a mesma informação
       chega aos lutadores remotos pelo `VITALS` (ver `RemoteFighters.update`).
       O limiar é o do ESPECIAL, o mesmo que o selo "KI CHEIO" do HUD usa — e
       como `freeFlightAt` hoje pede a mesma barra cheia, a aura acesa acaba
       dizendo as duas coisas: o golpe grande está pronto e o Shift não cobra. */
    this.me.kiFull = this.ki.podeEspecial();
    this.me.specialFraction = this.casting ? this.casting.t / this.casting.dur : 0;
    this.me.specialIndex = this.casting ? this.casting.indice : -1;
    this.me.down = this.down;
    this.me.invuln = agora < this.invulnUntil;
    /* O braço estendido do tiro volta sozinho DENTRO do `Fighter` — havia um
       decaimento aqui também, e os dois somados devolviam o braço rápido demais
       para a rajada parecer uma rajada. Quem manda na volta é quem manda na
       pose. */
    this.me.update(dt, this.camera3.position);

    /* --------------------------------------------------------- os outros -- */
    this.remotes.update(dt, this.camera3.position);

    /* ---------------------------------------------------------- câmera ---- *
     *
     * ELA VEM ANTES DO DISPARO, e a ordem dos três blocos aqui não é arbitrária:
     * o corpo se move, a lente acompanha, e só então se atira. `handPoint` sai
     * da pose que o `me.update` acabou de montar e `aimDirection` sai do eixo
     * óptico que a lente acabou de escolher.
     *
     * Estava ao contrário — o disparo acontecia no bloco de ações, lá em cima,
     * lendo a pose e a mira do quadro ANTERIOR. A 96 m/s um quadro são 1,6 m: a
     * bola saía de onde a mão estava, não de onde ela está, e mirava onde a
     * lente apontava antes de o jogador terminar de girar. */
    const ac = this._alvoCam;
    ac.position = c.position;
    ac.yaw = c.yaw;
    ac.pitch = c.pitch;
    ac.velocity = c.velocity;
    ac.flying = c.flying;
    ac.boosting = c.boostBlend > 0.3;
    this.cam.update(dt, ac, this.pontoDaTrava());

    /* ---------------------------------------------------------- disparo --- */
    if (!this.down) {
      if (acoes.burstPressed) this.onda();
      for (let i = 0; i < NAMEK.specialOrder.length; i++) {
        if (acoes.special[i]) this.soltarEspecial(i);
      }
      if (acoes.fire && !this.casting && !this.ki.carregando) this.atirar(dt);
    }

    /* --------------------------------------------------------- poderes ---- */
    const alvos = this.remotes.alvos();
    /* Eu também sou alvo — dos projéteis dos outros —, mas o sistema só reporta
       acerto de quem é dono do tiro, e o dono de um tiro alheio não sou eu. A
       minha cápsula entra na lista para o feixe ser BLOQUEADO por mim e para o
       empurrão da onda me alcançar; quem me machuca é sempre a sala. */
    const eu = this._minhaCapsula;
    eu.id = this.myId;
    eu.x = c.position.x;
    eu.y = c.position.y;
    eu.z = c.position.z;
    eu.vivo = !this.down;
    eu.invuln = this.me.invuln;
    alvos.push(eu);
    const eventos = this.powers.update(dt, alvos, this.myId);
    this.reportar(eventos);

    /* ------------------------------------------------------------ cena ---- */
    this.fx.update(dt, this.camera3.position);
    this.world.update(dt, this.camera3.position, agora);

    /* A câmera JÁ foi atualizada, lá em cima, antes do disparo — ver o
       comentário longo lá. Havia uma segunda chamada aqui, sobra da ordem
       antiga: ela rodava o amortecimento duas vezes por quadro, o que dobrava
       na prática a rigidez de toda constante de suavização da lente. */

    /* ------------------------------------------------------------- HUD ---- */
    this.hud.setVitals(this.health, NAMEK.fighter.maxHealth, this.ki.valor, this.ki.max);
    this.hud.setSpecials(this.specialIndex, this.ki.podeEspecial());
    const trava = this.lockId !== null ? this.remotes.get(this.lockId) : null;
    if (trava) {
      const ah = this._alvoHud;
      ah.id = trava.id;
      ah.nome = trava.name;
      ah.cor = trava.color;
      ah.vida = trava.health;
      this.hud.setTarget(ah);
    } else {
      this.hud.setTarget(null);
    }
    this.hud.update(dt);

    /* Os sons CONTÍNUOS. Um só lugar, uma vez por quadro: carga, feixe e vento
       são estados, não acontecimentos, e tratá-los como evento produziria um
       `play()` por quadro. */
    const v = c.velocity;
    this.audio.update({
      carregando: this.ki.carregando,
      feixeAceso: this.casting !== null && this.casting.t >= specialInfo(this.casting.kind).windup,
      velocidade: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
    });

    /* ------------------------------------------------------------ rede ---- */
    this.pushState(agora);

    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera3);
  }

  /**
   * Reporta à sala o que os MEUS projéteis fizeram.
   *
   * Quem atira é a autoridade sobre o próprio acerto; a sala é a autoridade
   * sobre a vida (§8 do plano). É o mesmo contrato do `C2S.IMPACT` da flecha, e
   * seguir o modelo que o jogo já usa vale mais do que qualquer melhoria
   * isolada aqui: dois modelos de confiança no mesmo servidor seriam a
   * inconsistência que ninguém lembra de manter.
   */
  reportar(ev) {
    if (!ev) return;

    for (const a of ev.acertos) {
      this.net.send(NC2S.BLAST_HIT, {
        id: a.blastId,
        victim: a.victim,
        p: [a.p.x, a.p.y, a.p.z],
      });
      this.fx.bodyHit(a.p.x, a.p.y, a.p.z, 0xbfe8ff);
      this.audio.acertoNoCorpo(a.p);
    }

    for (const q of ev.queimando) {
      this.net.send(NC2S.SPECIAL_HIT, { victim: q.victim, kind: q.kind, dt: q.dt });
    }

    for (const g of ev.chao) {
      /* A POEIRA SAI AGORA; O BURACO ESPERA O CARIMBO DA SALA.
       *
       * Havia uma cratera local aqui, cavada na hora com um id negativo "para
       * nunca colidir com o carimbo da sala" — e era o contrário do que a
       * idempotência precisa. Colidir é justamente o ponto: com ids diferentes,
       * o `NS2C.CRATER` que volta é um id inédito e `addCrater` cava DE NOVO no
       * mesmo lugar. Medido: quem atirou ficava com 4,64 m a mais de fundo que
       * todo mundo, e queimava o teto de 96 crateras em metade do tempo — o
       * critério 5 do §12 (duas abas, a mesma cratera) morria justamente na aba
       * de quem disparou.
       *
       * Esperar não custa nada visível: o clarão e a poeira são locais e
       * imediatos, e é sob eles que o buraco aparece. São dois ou três quadros
       * de rede embaixo de uma nuvem que dura um segundo. */
      this.fx.groundImpact(g.p.x, g.p.y, g.p.z, g.power);
      this.audio.estouroNoChao(g.p, g.power);
      this.derrubarPorPerto(g.p, g.power);
      /* Só o que é forte o bastante pede BURACO; o resto marca e some. Ver
         `craterMinPower` — sem o corte, a rajada consumia a fila inteira de 96
         crateras em pouco mais de um segundo e a destruição que importa apagava
         na frente do jogador. */
      if (g.power >= NAMEK.destruction.craterMinPower) {
        this.net.send(NC2S.GROUND_HIT, { p: [g.p.x, g.p.y, g.p.z], power: g.power });
      }
    }

    /* `ev.empurroes` não é reportado, e isso é de propósito: a SALA já resolve a
       onda inteira — dano e empurrão, para todo mundo — a partir do `NC2S.BURST`
       que ela recebeu (ver `NamekRoom`, o trecho do `burstRadius`). Mandar os
       acertos daqui cobraria o mesmo dano duas vezes.
     *
     * O que a sala NÃO consegue fazer é mover um humano, porque a posição dele é
     * dele (§8). Esse pedaço é o `empurraoDaOnda`, disparado pelo `NS2C.BURST`
     * alheio — e os dois juntos fecham o efeito sem se sobreporem. */
  }

  /**
   * A pose sai a 20 Hz, não por quadro.
   *
   * Sessenta poses por segundo por jogador com quinze em campo seriam 900
   * mensagens/s subindo por cliente para uma informação que a interpolação do
   * outro lado já suaviza a 20. É a mesma taxa do arqueiro, e pelo mesmo motivo.
   */
  pushState(agora) {
    if (agora < this.nextStateAt) return;
    this.nextStateAt = agora + 1000 / NAMEK.net.stateRate;
    if (!this.net.connected) return;
    this.net.send(NC2S.STATE, { s: packFighter(this.me), w: agora });
  }

  dispose() {
    this.running = false;
    window.removeEventListener("resize", this._onResize);
    this._offParticles?.();
    this.net.disconnect();
    this.input.dispose();
    this.hud.dispose();
    this.menu.dispose();
    this.audio.dispose();
    this.remotes.dispose();
    this.powers.dispose();
    this.fx.dispose();
    this.world.dispose();
    this.me.dispose();
    this.renderer.dispose();
  }
}
