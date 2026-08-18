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

import { NAMEK, specialInfo, duracaoDaPose, qualidadeNamek } from "../shared/namek/config.js";
import { NamekField } from "../shared/namek/field.js";
import { NC2S, NS2C, packFighter, vecFrom } from "../shared/namek/protocol.js";
import { gameEvents, EventType } from "../core/events.js";

import { NamekWorld, NAMEK_CAMERA_FAR } from "./world/index.js";
/* O FIM DE NAMEKUSEI: o estado (a cópia cliente da máquina de estados da sala,
   que também escreve o regime de voo) e a tela da fuga. Ver `world/fuga.js`. */
import { EstadoDoFim, FASE } from "./world/fuga.js";
import { FugaHud } from "./ui/fuga.js";
import { PEIXE_ALVO_ID } from "./world/peixe.js";
import { NamekFx } from "./fx/index.js";
import { PowerSystem } from "./powers/index.js";
import { Fighter } from "./character/index.js";
import { FighterController } from "./movement.js";
import { NamekCamera } from "./camera.js";
import { LockOn } from "./lockon.js";
import { NamekInput } from "./input.js";
import { NamekHud, NamekMenu } from "./ui/index.js";
import { EVENTO_MENU } from "./ui/menu.js";
import { KiMeter } from "./ki.js";
import { SuperSaiyajin, podeAcender, vidaMaxima } from "./character/ssj.js";
import { NamekAudio } from "./audio.js";
import { NamekClient } from "./net/client.js";
import { RemoteFighters } from "./net/remote.js";
import { BossSystem } from "./boss/index.js";

/** s — teto do passo. Ver o cabeçalho. */
const DT_MAX = 0.05;

/* ------------------------------------------------------------- a bússola ----
   m — a partir de onde um lutador ganha pino na tela, e onde o pino fica
   opaco. A conta da ótica está em `NamekGame.bussola`: a 90 m um corpo tem
   dezoito pixels de altura numa tela de 1080, que é onde ele deixa de ser uma
   pessoa e vira um cisco. */
const PINO_DE = 90;
const PINO_CHEIO = 150;

/** Mais perto primeiro. Função de módulo, e não uma seta criada na chamada:
 *  `sort` a recebe uma vez por quadro e um literal ali é lixo por quadro. */
const ordemDoPino = (a, b) => a.dist - b.dist;

/** A lista vazia que o HUD recebe durante as cenas cinemáticas do boss.
 *  Congelada e de módulo: ela é passada em todo quadro de cena, e um `[]` novo
 *  ali seriam quatrocentos arrays por cena para dizer "nada". */
const VAZIO = Object.freeze([]);

export class NamekGame {
  constructor(canvas, uiRoot) {
    /* --------------------------------------------------------- desenho --- */
    /* ================================================== A QUALIDADE =========
     *
     * **Esta é a maior diferença de custo entre Namekusei e a fase do Vale**, e
     * ela não era de cenário: o modo tinha `min(devicePixelRatio, 2)` chumbado e
     * IGNORAVA o preset que o jogador escolheu no lobby. Numa tela de razão 2 com
     * a qualidade em "baixa", isso são quatro vezes mais fragmentos por quadro
     * que o Vale desenha na mesma máquina — e nenhuma otimização de cenário
     * compensa um fator quatro.
     *
     * O preset sai de `qualidadeNamek()`, que lê a MESMA chave de `localStorage`
     * que o lobby grava. Ver `NAMEK.render` para por que ele não importa
     * `src/config.js` e para a lista do que a qualidade pode e não pode mexer —
     * o resumo é: custo por pixel, sim; **distância de visão, nunca**, porque
     * este é um jogo de voo e o que se vê de longe é o jogo. */
    this.qualidade = qualidadeNamek();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      /* O antisserrilhado (MSAA) sai no `low`. Ele é o segundo item mais caro
         do quadro depois da resolução, e a razão de pixel 1 já é o cenário em
         que ele custa mais: cada amostra a mais é um quadro-buffer inteiro a
         mais na memória da placa. Nas outras duas ele fica. */
      antialias: this.qualidade.antialias,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.qualidade.pixelRatio));
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
    /* Os EFEITOS nascem antes do mundo, e a ordem passou a importar: a lava
       ferve com brasa e fumaça (`NamekLava.borbulhar`), e para isso ela precisa
       do pool de partículas já montado quando `world.build` a construir. */
    this.fx = new NamekFx(this.scene, this.field);
    this.world = new NamekWorld(this.scene, this.field, this.fx);
    /* NÃO HÁ MAIS APOSENTADORIA de cratera, e por isso não há mais gancho de
       aposentadoria aqui. A cratera é assada num mapa de deslocamento
       (`NamekField.bakeCrater`) e passa a ser parte do relevo: ela não sai
       nunca, e `heightAt` custa o mesmo com dez ou dez mil buracos abertos. */
    this.powers = new PowerSystem(this.scene, this.field);

    /* -------------------------------------------------------- o jogador --- */
    this.controller = new FighterController(this.field);
    this.ki = new KiMeter();
    /**
     * O SUPER SAIYAJIN do lutador local — a máquina de estados em
     * `character/ssj.js`.
     *
     * Ela não decide nada (a sala é quem aceita ou recusa o `NC2S.SSJ`): ela
     * PREVÊ, para os três segundos de animação começarem no quadro em que a
     * tecla desce, e se desfaz sozinha se a confirmação não chegar. Ver o
     * cabeçalho de lá.
     */
    this.ssj = new SuperSaiyajin();
    /* Borda do aviso de transformação — ver o `setAvisoSSJ` no quadro. Começa
       falso para que o primeiro quadro em que a condição valer TOQUE. */
    this._avisouSSJ = false;
    /**
     * O Freeza está em campo? É a condição do alerta e do gatilho — "durante a
     * batalha com freeza".
     *
     * Ele é lido do estado do BOSS de forma defensiva: as mensagens dele
     * (`NS2C.FREEZA_STATE`, `FREEZA_IN`, `FREEZA_DOWN`) são de outro arquivo e
     * podem não existir nesta versão do protocolo, então cada assinatura abaixo
     * é guardada por um `if` no id da mensagem. Sem chefe, este campo fica falso
     * para sempre e a transformação simplesmente não acontece — que é o modo
     * como ele era antes desta feature, e é o lado seguro para falhar.
     */
    this.freezaVivo = false;
    /**
     * **O Freeza já foi DERRUBADO nesta partida?**
     *
     * Espelho local de `NamekFreeza.derrotado`, e ele é uma segunda pergunta e
     * não o contrário de `freezaVivo`: fora de campo o chefe pode estar por
     * nunca ter entrado, por ter sido retirado (o clima voltando para `dia`) ou
     * por ter caído — e só a última destrava o Super Saiyajin livre. Ver
     * `NAMEK.ssj.livreAposOFreeza`.
     *
     * Ele chega por três caminhos, e os três precisam existir: o `welcome` (para
     * quem entra depois da batalha), o `FREEZA_DOWN` com `derrotado` (para quem
     * estava lá) e o `FREEZA_IN` (que o apaga, porque uma batalha nova recomeça
     * a conta).
     */
    this.freezaDerrotado = false;
    this.me = new Fighter(this.scene, 0xff7a1a, true);
    this.cam = new NamekCamera(this.camera3, this.field);
    this.input = new NamekInput(canvas);
    this.hud = new NamekHud(uiRoot);
    /* O FIM DO PLANETA — o estado e a tela dele.
     *
     * `EstadoDoFim` não decide nada (§8: a sala é a autoridade sobre quem
     * escapa e quem morre); ele guarda a fase, prevê o relógio entre dois
     * pacotes e escreve o REGIME DE VOO no controlador — que é como o teto de
     * 520 m vira 2 000 durante a fuga e como o chão desliga no espaço. Ver
     * `world/fuga.js`.
     *
     * A tela é separada do HUD porque ela vive e morre com uma fase que quase
     * sempre não está acontecendo — o cabeçalho de `ui/fuga.js` explica. */
    this.fim = new EstadoDoFim();
    this.fugaHud = new FugaHud(uiRoot);
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
      /* O menu PEDE; quem decide é a sala, e é o `NS2C.DIFFICULTY` de volta que
         acende o botão. Acender no clique daria a quem pediu uma tela que
         discorda das outras enquanto o pacote não chega — e num ajuste que vale
         para todos, essa discordância é a informação errada. */
      setDificuldade: (id) => this.net.send(NC2S.DIFFICULTY, { id }),
      sair: () => {
        this.net.disconnect();
        location.reload();
      },
    });
    /** Clima em cena, só para o menu acender o botão certo. */
    this.weather = NAMEK.weather.padrao;
    /** Dificuldade dos bots em vigor. Mesma função: acender o botão certo. */
    this.dificuldade = NAMEK.bot.dificuldadePadrao;

    /* ----------------------------------------------------------- rede --- */
    this.net = new NamekClient();
    this.remotes = new RemoteFighters(this.scene, () => this.net.serverTime);

    /* O BOSS. Ele assina as próprias mensagens de rede no construtor, desenha o
       próprio corpo, usa os POOLS que já existem para os poderes dele e monta a
       barra de vida dentro do HUD — daí o gancho ser este objeto e mais três
       linhas no `step`. Ver o cabeçalho de `boss/index.js`. */
    this.boss = new BossSystem({
      scene: this.scene,
      powers: this.powers,
      fx: this.fx,
      audio: this.audio,
      hudEl: this.hud.el,
      net: this.net,
      meuId: () => this.myId,
      /* A CÂMERA e o HUD, para as duas cenas dele — a chegada e a morte. Ele é
         quem sabe quando elas acontecem (as duas mensagens são dele), então é
         ele quem as conduz; o laço só pergunta, uma vez por quadro, se a lente
         ainda é do jogador. Ver `BossSystem.passoDaCine` e o §1 de `boss/cine.js`. */
      camera: this.camera3,
      hud: this.hud,
    });

    /** Meu id na sala. Vem no `welcome`. */
    this.myId = null;
    this.myName = "";
    /** Vida — a SALA é a autoridade; isto é a cópia local para o HUD. */
    this.health = NAMEK.fighter.maxHealth;
    this.down = false;
    this.deadUntil = 0;
    this.invulnUntil = 0;

    /**
     * QUEM É O ALVO — o sistema, em `lockon.js`.
     *
     * O nome da classe ainda diz "lock" e o campo ainda se chama `lock`, mas a
     * TRAVA saiu junto com a tecla `R`: o que mora ali hoje é a mira assistida
     * pelo cursor (quem está sob o retículo, e é nele que os projéteis miram) e o
     * painel de vida do adversário do momento. Ver o cabeçalho de `lockon.js`
     * para o que foi removido e por quê; os nomes ficaram porque renomear a
     * classe custaria tocar em cinco arquivos para não mudar comportamento
     * nenhum.
     */
    this.lock = new LockOn();
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
    /* A bússola: a lista devolvida ao HUD e o banco de registros dela. Os dois
       são reaproveitados entre quadros — ver `bussola`. */
    this._bussola = [];
    this._pinoBanco = [];
    this._pinoV = new THREE.Vector3();
    /** Rascunho da projeção do PORTAL da fuga. Próprio e não emprestado do pino:
     *  são dois marcadores diferentes na mesma tela, e um rascunho comum é a
     *  primeira coisa que quebra quando alguém mudar a ordem do quadro. */
    this._fimV = new THREE.Vector3();
    /** O que a tela do fim mostra, reescrito por quadro. Ver `ui/fuga.js`. */
    this._fimHud = {
      ativo: false, segundos: 0, metros: 0, fracao: 0,
      altitude: 0, altitudeAlvo: 0, escapou: false, rotulo: "", sub: "",
    };
    /** O painel de vida do alvo, reescrito por quadro — ver `dadosDoAlvo`. */
    this._alvoHud = {
      id: 0, nome: "", cor: 0, vida: 0, vidaMax: NAMEK.fighter.maxHealth, dano: 0,
    };

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
    this.bindMenu();
  }

  /**
   * A FICHA DE TECLAS SEGUE O MENU, sempre — por qualquer caminho.
   *
   * O Esc abre duas telas ao mesmo tempo: o cartão de comandos (`ui/menu.js`, na
   * metade de baixo) e a ficha de teclas (`hud.showHelp`, no topo). Quem as
   * abria era o `step`, no pulso de `menuPressed`, e ele também as fechava — mas
   * o menu tem um SEGUNDO jeito de fechar, que é o clique no fundo. Por esse
   * caminho o cartão sumia e a ficha de teclas ficava na tela, sozinha, sem nada
   * que a tirasse de lá a não ser um Esc e outro clique. É o relato literal:
   * *"se eu clicar enquanto esses menus estão ativos, somente um menu some;
   * aquele menu de teclas continua. Todos devem sumir ao clicar."*
   *
   * A defesa é a mesma que `EVENTO_MENU` já tinha inventado para o `NamekInput`,
   * e por isso ela não custa nada aqui: **toda** mudança de estado do menu passa
   * por `toggle()`, e `toggle()` grita. Escutando o grito, a ficha não depende
   * mais de ninguém lembrar de fechá-la — nem hoje, nem no botão novo que
   * alguém acrescentar amanhã.
   *
   * O `showHelp` é idempotente (sai na primeira linha quando o estado já bate),
   * então o caminho do Esc — que agora avisa duas vezes, uma pelo `step` e outra
   * por aqui — não pisca nada.
   */
  bindMenu() {
    this._onMenu = (e) => this.hud.showHelp(!!e.detail?.aberto);
    document.addEventListener(EVENTO_MENU, this._onMenu);
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
        /* A DIREÇÃO e a ABERTURA, que este barramento estava jogando fora.
         *
         * Todos os emissores do modo já mandavam `direction` e `spread` — o
         * clarão da boca do Kamehameha sai na direção do feixe, o talho do
         * Kienzan sai no rumo do voo, a poeira do impacto sobe do chão —, e
         * esta ponte repassava só posição, tamanho, cor, contagem e velocidade.
         * O resto caía no chão em silêncio: quatro efeitos com forma pedida e
         * nenhuma forma entregue, todos saindo como a mesma bola de fagulhas.
         *
         * `spread` continua com padrão 1 (a esfera de sempre) para quem não
         * manda direção, então nada que já estava calibrado mudou. */
        p.direction ?? null,
        p.spread ?? 1,
      );
    });
  }

  build(progresso = () => {}) {
    this.world.build(progresso);
    /* O peixe é do MUNDO e o som é do jogo; esta é a única linha em que os dois
       precisam um do outro. Ver `NamekPeixe.ligarAudio` — o peixe só CHAMA a
       API do áudio, não a estende. */
    this.world.peixe?.ligarAudio(this.audio);
    /* A chuva de meteoros, pelo mesmo contrato e pelo mesmo motivo: ela é a
       única coisa do mapa que MATA sem que ninguém tenha atirado, e o assobio da
       rocha descendo é o aviso que ela não tinha. Ver
       `NamekAudio.assobioDeQueda`. */
    this.world.meteoros?.ligarAudio(this.audio);
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

      /* E O QUE JÁ FOI DERRUBADO. A chave é `"tipo:índice"`, como a sala a
         monta em `registrarProp` — o mesmo par que o `NS2C.PROP_DOWN` manda
         durante a partida, só que em lote e de uma vez. */
      for (const chave of msg.props ?? []) {
        const sep = String(chave).indexOf(":");
        if (sep < 0) continue;
        this.world.breakProp(chave.slice(0, sep), Number(chave.slice(sep + 1)));
      }

      /* E OS PLANETAS QUE JÁ EXPLODIRAM. Somem do céu SEM a sequência: quem
         chega no meio precisa do estado, não do acontecimento — o mesmo que
         vale para a cratera e para a rocha derrubada. Ver `NamekPlanetas.jaCaidos`. */
      this.world.planetasCaidos(msg.planetas ?? []);

      /* E O SALTO DO PEIXE EM CURSO, se houver. Mesmo argumento das crateras:
         quem entra no meio de um mergulho tem de ver o mesmo bicho que os
         outros. Vem `null` entre um salto e outro, e aí o próximo `NS2C.FISH`
         chega pelo caminho normal. */
      if (msg.fish) this.world.peixe?.agendar(msg.fish);

      /* O SOL, com as feridas que ele já levou. Mesmo argumento das crateras e
         do peixe: quem entra numa partida em que o sol já apanhou dois
         Kamehamehas tem de ver o mesmo disco vermelho que os outros — e não um
         sol amarelo que fica laranja de repente no terceiro tiro. */
      this.world.sky?.setSolFeridas(msg.sol?.feridas ?? 0, true);

      /* E SE O FREEZA JÁ FOI DERRUBADO NESTA PARTIDA. É o que destrava o Super
         Saiyajin livre (ver `contextoSSJ`), e quem entra depois da batalha tem o
         mesmo direito de quem lutou — a marca é da SALA, não de quem estava lá.
         Sem esta linha, um jogador que entrasse durante a fuga do planeta
         apertaria `R` e ouviria "só na batalha contra o Freeza" para sempre. */
      this.freezaDerrotado = msg.freezaMorto === true;

      /* `.id` — o `welcome` traz o clima como `{ id, w }`, não como a string
         que o `NS2C.WEATHER` de cada troca manda. Passar o objeto inteiro não
         estourava: `setWeather` valida contra `NAMEK.weather.ids`, não achava o
         objeto lá e desistia CALADO. O sintoma era quem entrasse no meio de uma
         tempestade ver dia claro enquanto todo mundo via o planeta explodindo. */
      this.weather = msg.weather?.id ?? NAMEK.weather.padrao;
      this.world.setWeather(this.weather, true);
      /* O nível que está VALENDO, e não o padrão: quem entra no meio de uma
         sala em treino precisa ver "Parado" aceso no menu dele. */
      this.dificuldade = msg.difficulty ?? NAMEK.bot.dificuldadePadrao;
      this.menu.setDificuldade(this.dificuldade);
      this.remotes.reconcile((msg.fighters ?? []).filter((f) => f.id !== this.myId));
      this.hud.setScores(this.placar(msg.scores));
      /* EM QUE PÉ ESTÁ O FIM DO PLANETA. Sem esta linha, quem entrasse durante a
         contagem veria teto de 520 m, nenhum portal e nenhum relógio — e morreria
         sem nunca ter sabido que havia um. O `setFim` logo em seguida é o que põe
         o cenário no estado certo antes do primeiro quadro, em vez de deixá-lo
         chegar lá pela transição de fase que não vai mais acontecer. */
      this.fim.aplicarEstado(msg.fim, this.myId);
      this.world.setFim(this.fim);
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
      /* E some do painel do alvo, se ele estiver lá: sem isto a placa ficaria
         dois segundos pedindo a vida de alguém que não está mais na sala. */
      this.lock.esquecer(msg.id);
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
        /* A COR DA BOLA ALHEIA sai do estado do DONO, e não da mensagem: o bit
           16 da pose dele já chega a 20 Hz, e um campo no `BLAST` seria a mesma
           informação dita duas vezes — com a chance de as duas discordarem
           numa retransmissão atrasada. */
        ssj: this.remotes.get(msg.owner)?.ssj === true,
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
        /* O alvo veio de quem atirou e é repassado intacto: é ele que faz o
           disco do outro perseguir a MESMA pessoa na minha tela e na dele. */
        target: msg.target ?? null,
        local: false,
        /* E o golpe do adversário transformado sai DOURADO — mesma leitura do
           bit 16 que a rajada acima faz, e pelo mesmo motivo. */
        ssj: this.remotes.get(msg.owner)?.ssj === true,
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
        /* APARADO É OUTRO ACONTECIMENTO. O golpe que a guarda comeu não pode
           soar nem tremer como o que passou: se soasse, o jogador não teria
           como saber que o botão fez alguma coisa — a vida caiu de qualquer
           jeito, só que 78 % menos, e ninguém lê número no meio de uma briga.
           O som é o da guarda, o tremor é um terço, e a marca de direção
           continua saindo, porque saber DE ONDE veio importa ainda mais quando
           se está defendendo. */
        if (msg.g) {
          this.audio.golpeAparado(this.controller.position, true);
          this.cam.shake(0.12 + fracao * 0.2, 0.16);
        } else {
          this.audio.levouDano(this.controller.position, fracao > 0.4);
          this.cam.shake(0.3 + fracao * 0.7, 0.25);
        }
        const de = this.remotes.get(msg.by);
        if (de) this.hud.damageFrom(this.anguloNaTela(de.pose));
        return;
      }
      /* O GOLPE FOI MEU: acende o painel do alvo com a vida da vítima.
       *
       * *"Quando o player acerta o outro deve aparecer a vida do player que ele
       * acertou na tela dele diminuindo, independente se tiver lock-in ou não."*
       *
       * Aqui só se registra QUEM e QUANTO; a placa é desenhada no laço, a partir
       * da vida viva do remoto (que a linha logo abaixo acaba de atualizar). Ver
       * `LockOn.registrarAcerto` e `NAMEK.lock.painel`.
       *
       * Vale para todo golpe que a SALA cobrou em meu nome — bola, feixe, disco,
       * esfera, onda, e o dano já descontado pela guarda do outro —, porque a
       * autoridade sobre a vida é dela e este é o único aviso honesto de que o
       * meu golpe encostou em alguém. */
      if (msg.by === this.myId) this.lock.registrarAcerto(msg.id, msg.amount);

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
        /* O id da vítima entra na chamada porque a COTA do som é por lutador:
           sem ele, quinze corpos apanhando ao mesmo tempo dividem uma janela só
           e o tiroteio soa como um estalo. Ver `acertoNoCorpo` em `audio.js`. */
        if (msg.g) this.audio.golpeAparado(r.pose, false);
        else this.audio.acertoNoCorpo(r.pose, msg.amount > 20, msg.id);
      }
    });

    net.on(NS2C.DEATH, (msg) => {
      const dir = msg.d ? vecFrom(msg.d) : null;

      /* O BOSS RI DO ABATE, se o abate foi dele. A pergunta é feita pelo módulo
         do boss porque é ele quem conhece o repertório do Freeza — ver
         `BossSystem.matou`, que também explica por que o teste é pelo `kind` e
         não pelo `killer` (que vem `null` de propósito para os golpes dele). */
      this.boss?.matou?.(msg.kind);

      /* NÃO HÁ PRÊMIO DE ABATE AQUI, e a ausência é deliberada.
       *
       * Havia: quem matava alguém enchia a barra no quadro do abate, prevendo o
       * `por.ki = NAMEK.ki.max` que a sala fazia em `matar`. As duas metades
       * foram embora juntas, e tinham de ir — uma previsão que a sala não
       * confirma é pior do que previsão nenhuma: a barra encheria na tela e o
       * `VITALS` seguinte a arrastaria de volta para baixo em meio segundo,
       * exatamente enquanto o jogador tenta soltar o especial que ela prometeu.
       *
       * O prêmio que sobrou é o da QUEDA, e ele está no `STAGGER` logo abaixo.
       * Ver `NamekRoom.matar` para por que os dois não pagavam a mesma coisa. */
      if (msg.victim === this.myId) {
        this.morrer(dir);
        this.audio.morreu(this.controller.position);
      } else {
        const morto = this.remotes.get(msg.victim);
        morto?.fighter.die(dir);
        if (morto) {
          this.audio.morreu(morto.pose);
          /* A VIDA DELE VAI A ZERO AQUI, e não na amostra de `VITALS` seguinte.
             O golpe que MATA não manda `HURT` — a sala chama `matar` e sai antes
             (ver `aplicarDano`) —, então a última notícia que a placa do alvo
             teria era a vida de ANTES do golpe final, e a barra ficaria parada em
             12 ou 30 até os 100 ms da amostra chegarem. */
          morto.health = 0;
        }
        /* E O PAINEL FICA DE PÉ para mostrar isso, quando o abate foi seu: a
           última coisa que a placa desenha é a barra dele esvaziando, que é a
           resposta completa a *"quanto de vida do outro player ele tirou"* no
           único instante em que a pergunta se encerra. Dano zero de propósito —
           o total continua sendo o que os golpes anteriores somaram, porque a
           sala não diz quanto valeu o golpe final. */
        if (msg.killer === this.myId) this.lock.registrarAcerto(msg.victim, 0);
      }
      /* Os DOIS como objeto, e não como nome solto: o feed pinta cada lado com
         a cor do lutador e destaca a sua própria linha por id. Passando string,
         `pessoa()` devolvia cor nula para todo mundo e a metade colorida do
         placar de mortes nunca chegava a aparecer. */
      this.hud.killFeed(this.quem(msg.killer), this.quem(msg.victim), msg.kind);
    });

    /* DERRUBADO. Cinco golpes seguidos, e o corpo vai ao chão — ver
     * `NAMEK.fighter.stagger` e `NamekRoom.contarGolpe`.
     *
     * A sala manda o gatilho; quem derruba o corpo é ESTE cliente, porque a
     * posição de um humano é dele (§8 do plano). Para os outros, a queda chega
     * pela pose, no bit 4 — não há nada a fazer aqui por eles a não ser o
     * barulho, e nem isso: o `hit` alheio já saiu no `HURT` que veio antes. */
    net.on(NS2C.STAGGER, (msg) => {
      /* EU DERRUBEI ALGUÉM: a barra enche na hora.
       *
       * Quem manda na barra é a sala (ela faz o mesmo em `NamekRoom.derrubar`),
       * e o `VITALS` traria o valor cheio em no máximo 100 ms. Cem milissegundos
       * seriam invisíveis em quase tudo — menos justamente aqui, porque o que o
       * jogador faz no instante seguinte é apertar a tecla do especial, e o
       * especial exige a barra CHEIA: com a barra ainda velha na tela, a
       * primeira tentativa seria recusada com um "ki insuficiente" que já não é
       * verdade. Prever aqui é o que faz o presente chegar junto com o aviso. */
      /* `!this.down` porque a sala também exige `por.alive` (ver `derrubar`):
         um feixe que ainda estava aceso pode derrubar alguém depois de quem o
         soltou já ter morrido, e aí a sala NÃO paga o prêmio. Prever um presente
         que ela vai recusar é o mesmo erro que o `DEATH` acabou de deixar de
         cometer — a barra encheria na tela e o `VITALS` seguinte a desfaria. */
      if (msg.by === this.myId && msg.id !== this.myId && !this.down) {
        /* `encher()` e não a escrita crua: é o mesmo valor, mas ele também zera
           o relógio da regeneração passiva, e passar por um lugar só é o que
           mantém o prêmio da queda idêntico ao que a sala faz em `derrubar`.
           Desde que o abate deixou de pagar (ver o `DEATH` acima), este é o
           ÚNICO caminho do jogo que enche a barra de graça. */
        this.ki.encher();
        this.hud.toast(`${this.nomeDe(msg.id)} caiu — ki cheio`);
        this.audio.kiEncheu();
      }
      if (msg.id !== this.myId) return;
      if (this.down) return;
      const s = Number(msg.s) || NAMEK.fighter.stagger.time;
      this.controller.derrubar(s);
      this.me.derrubar(this.direcaoDoGolpe(msg.by, this.controller.position));
      /* O especial em curso morre com a queda — e a sala pensa o mesmo, do lado
         dela. Sem isto, a pose continuaria correndo com o corpo no chão e o
         feixe sairia de um lutador deitado. */
      this.casting = null;
      this.specialIndex = -1;
      this.ki.carregando = false;
      this.hud.banner("DERRUBADO", Math.min(2, s));
      this.cam.shake(1, 0.45);
      /* Dois acontecimentos, e não um: o baque de bater no chão e a dor logo
         atrás. `quedaNoChao` sozinho soava como um pulo mal dado. */
      this.audio.fuiDerrubado(this.controller.position, true);
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
      /* `msg.df` é o multiplicador de FUNDURA, e ele só vem quando não é 1 (ver
         `NamekRoom.cratera`). Sem o `?? 1` toda cratera comum viraria um buraco
         de profundidade `undefined` — que em multiplicação é NaN, e um NaN no
         mapa de deslocamento apaga o chão em vez de cavá-lo. */
      const c = this.field.addCrater(msg.i, msg.p[0], msg.p[2], msg.power, msg.df ?? 1);
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
      /* A PEÇA É LOCALIZADA ANTES DE CAIR, porque depois ela não está mais lá:
         `breakProp` zera a vida e enfileira a animação de queda, e procurá-la
         depois devolve uma peça já morta (ou, dependendo do tipo, uma escala
         zerada). Um `find` por objeto destruído — que é um acontecimento raro —
         é barato; guardar um índice para isto não seria. */
      const p = this.world.props.find((o) => o.kind === msg.kind && o.i === msg.i);
      if (!this.world.breakProp(msg.kind, msg.i)) return;
      /* O PÓ. Só ele: as lascas quem solta é o cenário, com a física da espécie
         (ver `NamekFx.propDust`, que existe exatamente para não duplicá-las).
         Sem esta linha, uma casa desabava em silêncio visual — sem uma nuvem de
         reboco —, que é metade do efeito. */
      if (p) this.fx.propDust(msg.kind, p.x, p.y, p.z, p.raio);
    });

    /* O PEIXE GIGANTE. Duas mensagens e nada mais: o salto inteiro chega num
       pacote só, com `NAMEK.peixe.aviso` segundos de antecedência, e a partir
       dele o cliente integra a mesma parábola que a sala integra. Ver
       `src/namek/world/peixe.js`. */
    net.on(NS2C.FISH, (msg) => this.world.peixe?.agendar(msg));

    net.on(NS2C.FISH_DOWN, (msg) => {
      this.world.peixe?.matar(msg);
      /* Um recado, e não um abate: matar o peixe não entra no placar (ver
         `NamekRoom.registrarPeixe`) — mas é o acontecimento mais raro do mapa e
         quem o derrubou merece o crédito na tela de todo mundo. */
      this.hud.toast(`${this.nomeDe(msg.by)} derrubou o peixe gigante`);
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

    /**
     * O SOL LEVOU UM KAMEHAMEHA — e, no terceiro, morreu.
     *
     * A sala é a autoridade sobre as três vidas dele (§8), como é sobre todo o
     * resto: este cliente mandou o `NC2S.SUN_HIT` e não sabe se ele contou até
     * esta mensagem chegar. O que ele faz aqui é pintar o disco um degrau mais
     * vermelho — que é a barra de vida deste alvo — e, no último, a explosão.
     *
     * A VIRADA DE CLIMA NÃO VEM POR AQUI. O `NS2C.WEATHER` sai por conta
     * própria logo atrás (a sala chama `pedirClima` dentro de `NamekSol.pedido`)
     * e é ele que fecha o céu, chama o Freeza e liga a máquina do fim do
     * planeta. Ver o comentário de `NS2C.SUN` no protocolo para por que as duas
     * coisas não viajam juntas.
     */
    if (NS2C.SUN) {
      net.on(NS2C.SUN, (msg) => {
        const ceu = this.world.sky;
        if (!ceu) return;
        ceu.setSolFeridas(msg?.feridas ?? 0);
        if (!msg?.morto) {
          this.hud.toast(
            `${this.nomeDe(msg?.by)} acertou o sol (${msg?.feridas ?? 0}/${NAMEK.sol.vidas})`,
          );
          return;
        }
        this.explodirSol();
      });
    }

    net.on(NS2C.DIFFICULTY, (msg) => {
      this.dificuldade = msg.id;
      this.menu.setDificuldade(msg.id);
      const nome = NAMEK.bot.dificuldades[msg.id]?.nome ?? msg.id;
      this.hud.toast(`bots: ${nome}`);
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

    /* ============================================ os planetas e a chuva ==== */

    /* UM PLANETA SE PARTIU. A sequência inteira (rachadura, clarão, cacos) é
       função fechada de `msg.w` mais as durações do config — ver
       `NamekPlanetas.derrubar`. Aqui só se dá a partida no relógio e se conta o
       que aconteceu. */
    net.on(NS2C.PLANET_DOWN, (msg) => {
      if (!this.world.derrubarPlaneta(msg.id, msg.w)) return;
      const nome = NAMEK.planetas.corpos.find((c) => c.id === msg.id)?.nome ?? msg.id;
      this.hud.banner(`${nome.toUpperCase()} FOI DESTRUÍDO`, 3.5);
      if (msg.by === this.myId) this.hud.toast("você destruiu um planeta");
      else this.hud.toast(`${this.nomeDe(msg.by)} destruiu ${nome}`);
      /* O ESTOURO CHEGA DEPOIS DA LUZ, e é o único lugar do modo em que isso é
         de propósito: o corpo está a 2.400 m, e som nenhum deste jogo viaja —
         o que se ouve é a onda chegando. Dois segundos e meio depois do clarão
         é o que a distância pediria se o ar de Namekusei fosse o nosso, e é
         também o tempo em que o jogador para de olhar para o céu e volta para a
         briga: o trovão o traz de volta. `detonouNoAr` com potência de Genki
         Dama escolhe a receita colossal (ver `_receitaDeImpacto`). */
      const p = NAMEK.planetas.corpos.find((c) => c.id === msg.id);
      if (p) {
        setTimeout(() => {
          /* O jogo pode ter sido desmontado nesses dois segundos e meio (menu,
             recarga, troca de sala). Tocar num contexto de áudio já fechado
             estoura dentro de um timer, longe de qualquer pilha que explique de
             onde ele veio — e `running` é o mesmo sinal que o laço usa. */
          if (!this.running) return;
          const c = this.controller.position;
          this.audio.detonouNoAr(
            { x: c.x + p.dir[0] * 60, y: c.y + p.dir[1] * 60, z: c.z + p.dir[2] * 60 },
            40,
            "genki",
          );
          this.cam.shake(0.55, 1.1);
        }, 2500);
      }
    });

    /* UMA ROCHA ENTROU NO CÉU. Seis números e um relógio; o resto é desenho. */
    net.on(NS2C.METEOR, (msg) => this.world.soltarMeteoro(msg));

    /* E ELA ESTOUROU. A cratera e o SOM vêm pelo `NS2C.CRATER` que a sala manda
       no mesmo quadro (ver `NamekMeteoros.estourar`); o que sai daqui é o que só
       existe nesta tela — a bola de fogo, o tranco da lente e as peças de
       cenário que o estouro derrubou. */
    net.on(NS2C.METEOR_HIT, (msg) => {
      this.world.estourarMeteoro(msg);
      if (!Array.isArray(msg.p)) return;
      const p = { x: msg.p[0], y: msg.p[1], z: msg.p[2] };
      /* O tremor cai com a distância, como o do relâmpago — e o alcance cresce
         com a rocha: um colosso a duzentos metros sacode, um pedrisco a
         duzentos metros não. */
      const alcance = 90 + (Number(msg.r) || 1) * 22;
      const d = Math.hypot(
        p.x - this.controller.position.x,
        p.y - this.controller.position.y,
        p.z - this.controller.position.z,
      );
      if (d < alcance) this.cam.shake(0.4 + 0.7 * (1 - d / alcance), 0.5);
      /* As peças dentro do buraco caem. É o MESMO caminho do impacto de um
         golpe (`NC2S.PROP_HIT` → `NS2C.PROP_DOWN`), e a sala deduplica por
         peça — então quinze telas reportando a mesma rocha derrubada custam
         quinze mensagens e uma queda. Sem isto, uma ajisa ficaria de pé no
         meio de uma cratera de trinta e sete metros. */
      this.derrubarPorPerto(p, Number(msg.power) || 1);
    });

    /* O EMBATE CONFIRMADO — dois poderes que se encostaram no ar.
     *
     * Vem de todo mundo, inclusive de volta de mim, e a volta não é desperdício
     * nem problema: quem avisou já aplicou localmente (é predição, como o resto
     * do jogo), e a busca por dono+tipo não acha mais nada porque os projéteis
     * já morreram. A mensagem é idempotente por construção — ver
     * `NS2C.POWER_CLASH` no protocolo, e o §2 de `powers/colisao.js` para por
     * que a sala precisa estar no meio disto.
     *
     * Ela é ENFILEIRADA, não aplicada: matar um projétil dentro do tratador
     * seria mexer num pool que o quadro atual pode estar percorrendo. */
    net.on(NS2C.POWER_CLASH, (msg) => this.powers.embateDaRede(msg));

    net.on(NS2C.SCORES, (msg) => this.hud.setScores(this.placar(msg.s)));

    /* ==================================================== O FIM DE NAMEKUSEI ==
       Quatro mensagens, e nenhuma delas decide nada aqui: a sala manda a fase, o
       relógio, quem escapou e quem morreu; este lado desenha. Ver o bloco `fim`
       de `shared/namek/protocol.js`. */

    net.on(NS2C.FIM_ESTADO, (msg) => {
      const antes = this.fim.fase;
      this.fim.aplicarEstado(msg, this.myId);
      if (antes === this.fim.fase) return;

      /* Uma faixa por transição. Elas são o roteiro do modo dito em voz alta —
         é a única forma de alguém que nunca viu isto descobrir, no meio de uma
         briga, que agora existe um relógio e uma saída. */
      if (this.fim.fase === FASE.FREEZA) {
        this.hud.banner("O CÉU SE FECHOU", 3);
      } else if (this.fim.fase === FASE.CONTAGEM) {
        this.hud.banner("O PLANETA VAI EXPLODIR — VOE PARA O CÉU", 4);
        this.audio.kiEncheu?.();
      } else if (this.fim.fase === FASE.ESPACO) {
        this.hud.banner("NAMEKUSEI SE FOI", 3.5);
      } else if (this.fim.fase === FASE.CALMO) {
        this.hud.banner("O PLANETA CONTINUA", 2.5);
      }
    });

    net.on(NS2C.FIM_CONTAGEM, (msg) => this.fim.aplicarContagem(msg));

    net.on(NS2C.FIM_ESCAPOU, (msg) => {
      const eu = this.fim.aplicarEscape(msg, this.myId);
      const p = msg.p ? vecFrom(msg.p) : null;
      if (!eu) {
        /* O corpo do OUTRO não é movido daqui, e é de propósito: a posição de um
           humano é dele (§8), e o que chega é a pose de 20 Hz. O interpolador vai
           cobrir os dois quilômetros na janela de 100 ms dele — um risco subindo
           pela tela, que por acaso é exatamente a leitura certa do que acabou de
           acontecer. Forçar um teleporte aqui seria este cliente escrevendo a
           posição de outro, que é a única coisa que o modelo de confiança do modo
           não permite. */
        this.hud.toast(`${this.nomeDe(msg.id)} escapou do planeta`);
        return;
      }
      if (p) {
        this.controller.teleport(p.x, p.y, p.z, this.controller.yaw);
        /* A lente teleporta junto: sem isto ela persegue amortecida o ponto novo
           e varre dois mil metros de céu no caminho. Mesma marcação do
           nascimento, e pelo mesmo motivo. */
        this.cam.markTeleport();
        this.controller.flying = true;
      }
      this.hud.banner("VOCÊ ESCAPOU — O ESPAÇO", 3.5);
      this.audio.kiEncheu?.();
    });

    net.on(NS2C.FIM_EXPLODIU, (msg) => {
      this.fim.aplicarExplosao(msg);
      /* O CLARÃO É LOCAL E IMEDIATO, como a poeira de um impacto: ele não espera
         nada e não pergunta nada. Quem morreu recebe o `DEATH` de sempre por
         outro caminho — este aqui é só o cenário. */
      this.fugaHud.explodiu();
      this.cam.shake(NAMEK.fim.explosao.tremor, 2.6);
      this.audio.detonouNoAr?.(this.controller.position, 48, "genki");
      this.hud.banner(
        this.fim.euEscapei ? "NAMEKUSEI EXPLODIU" : "O PLANETA LEVOU VOCÊ",
        4,
      );
    });

    /* ============================================== o SUPER SAIYAJIN ======
     *
     * Duas mensagens que chegam e uma condição observada — e a condição (o
     * Freeza em campo) é lida de forma DEFENSIVA, porque o boss é de outro
     * arquivo e as mensagens dele podem não existir nesta versão do protocolo.
     * `NS2C.FREEZA_*` valeria `undefined` num protocolo sem chefe, e
     * `net.on(undefined, …)` assinaria um evento de nome "undefined" que nunca
     * dispara — inofensivo, mas mudo e difícil de explicar. Com o `if`, a
     * ausência do chefe é o que ela é: o Super Saiyajin não existe naquela
     * partida, exatamente como não existia antes desta feature. */
    if (NS2C.FREEZA_IN) {
      net.on(NS2C.FREEZA_IN, () => {
        this.freezaVivo = true;
        /* UMA BATALHA NOVA APAGA A MARCA DA ANTERIOR. Sem esta linha, uma sala
           que virasse o clima para `dia` e de volta para `tempestade` começaria
           a segunda luta com todo mundo já podendo se transformar de graça — o
           prêmio da primeira valendo para sempre. A sala pensa o mesmo
           (`NamekFreeza.entrar` zera `derrotado`); isto é o espelho local. */
        this.freezaDerrotado = false;
      });
    }
    if (NS2C.FREEZA_STATE) {
      /* A REDE DE SEGURANÇA. A pose do chefe sai a 20 Hz e **só enquanto ele
         está de pé** (`NamekFreeza.passo` sai na primeira linha quando ele
         morre), então a mera chegada dela já é a resposta — não há campo de vida
         a ler, e não haveria como ler um: a mensagem carrega pose e mais nada.
         Com isto, um `FREEZA_IN` perdido se conserta em 50 ms em vez de deixar
         o jogador sem alerta pela luta inteira. */
      net.on(NS2C.FREEZA_STATE, () => {
        this.freezaVivo = true;
      });
    }
    if (NS2C.FREEZA_DOWN) {
      net.on(NS2C.FREEZA_DOWN, (msg) => {
        this.freezaVivo = false;
        /* **DERRUBADO É DIFERENTE DE RETIRADO**, e a mesma mensagem conta as
         * duas coisas: `NamekFreeza.morrer` manda `derrotado: 1`, e `sair()` —
         * o caminho do clima voltando para `dia` — não manda nada. Sem essa
         * distinção, desistir da luta pelo menu daria o mesmo prêmio de a ter
         * vencido.
         *
         * A marca destrava o Super Saiyajin livre (ver `contextoSSJ` e
         * `NAMEK.ssj.livreAposOFreeza`) e sobrevive à morte do jogador, que é o
         * pedido: *"se ele morrer e voltar, mas o Freeza tem que estar morto."* */
        if (msg?.derrotado) {
          this.freezaDerrotado = true;
          this.hud.toast("O Freeza caiu — a transformação é sua (R)");
          /* E A TRANSFORMAÇÃO **NÃO** ACABA JUNTO, ao contrário do que este
             bloco fazia. Ver a inversão argumentada em `SSJ.manutencao`: existe
             jogo depois da queda dele (a contagem, a fuga, a briga no espaço), e
             apagar o ouro no primeiro quadro desse trecho é o oposto do que o
             pedido descreve. */
          return;
        }
        /* A LUTA FOI CANCELADA. Aí sim a transformação some, e pelo argumento
           original do §"quando ela ACABA" em `NAMEK.ssj`: ninguém está atirando,
           e a poda de vida não custa nada neste instante. A sala manda um
           `SSJ_OFF` logo atrás; desligar aqui é previsão. */
        if (this.ssj.aceso) this.desligarSSJ();
      });
    }

    /* A transformação COMEÇOU. Ela vale para qualquer um: para mim, alinhando o
       relógio da previsão com o da sala; para os outros, começando a animação e
       levantando o teto de vida do alvo travado. */
    net.on(NS2C.SSJ_ON, (msg) => {
      if (msg.id === this.myId) {
        if (this.ssj.confirmar(msg.w, this.net.serverTime)) {
          this.me.transformar(Math.max(0, (this.net.serverTime - msg.w) / 1000));
        }
        this.me.ssj = true;
        if (Number.isFinite(msg.health)) this.health = msg.health;
        this.hud.setSSJ(true);
        this.hud.setAvisoSSJ(false);
        this.hud.banner("SUPER SAIYAJIN", 2.6);
        /* O GRITO, e ele já existe: três segundos de rugido subindo que acabam
           no estouro seco do clarão, tudo dentro do mesmo buffer (ver
           `NamekAudio.transformacao`). O `if` com fallback para `kiEncheu` era o
           paliativo enquanto o som não chegava, e sai junto. */
        this.audio.transformacao?.(this.controller.position);
        return;
      }
      const r = this.remotes.get(msg.id);
      if (!r) return;
      r.fighter.transformar(Math.max(0, (this.net.serverTime - msg.w) / 1000));
      /* O `ssj` do corpo alheio vem da POSE (bit 16) a 20 Hz e não é escrito
         aqui: escrever os dois criaria duas verdades sobre o mesmo estado, e a
         que chegasse por último ganharia. O que ESTA mensagem traz e a pose não
         tem é o INSTANTE — ver o protocolo. */
      this.hud.toast(`${this.nomeDe(msg.id)} virou Super Saiyajin`);
    });

    /* E ACABOU: o lutador morreu, ou o Freeza caiu. */
    net.on(NS2C.SSJ_OFF, (msg) => {
      if (msg.id !== this.myId) return;
      this.desligarSSJ();
      /* A vida vem na mensagem porque o fim APARA o teto (160 → 100), e quem
         estava acima dele precisa da poda junto com o motivo — e não como um
         número que despenca sozinho no `VITALS` seguinte. */
      if (Number.isFinite(msg.health)) this.health = msg.health;
    });

    net.on("disconnected", () => this.hud.toast("conexão caiu — reconectando…"));
    net.on("reconnecting", () => this.hud.toast("reconectando…"));
  }

  /**
   * **A EXPLOSÃO DE PODER** — o último quadro dos três segundos.
   *
   * *"A aura dele fica amarela e mais intensa e tem uma explosão de poder ali
   * momentânea."* São quatro coisas no mesmo instante, e cada uma cobre um
   * sentido diferente do jogador:
   *
   * • o CLARÃO, na cor do Super Saiyajin — é o que se vê da tela inteira;
   * • as FAGULHAS subindo, que dão volume ao clarão de perto;
   * • o CHÃO, quando há chão ao alcance: a onda de choque de `NamekFx.slam`
   *   (poeira em anel e pedra levantando) mais uma cratera de 15 m carimbada
   *   pela sala. É o "chão levantando pedra" literal, e ela é pedida pelo mesmo
   *   `NC2S.GROUND_HIT` de todo golpe — a cratera do grito é uma cratera como
   *   qualquer outra: aparece para todo mundo, entra na lista de quem chegar
   *   depois e funda a lava se insistirem no mesmo ponto;
   * • o TREMOR da lente, que é o que dá PESO ao resto.
   *
   * Ela não faz DANO, e a ausência é deliberada: a onda de choque do jogo já
   * existe, custa ki e tem um botão (`Q`). Uma segunda onda, de graça, saindo do
   * fim de uma invencibilidade de três segundos, seria a coisa mais forte do
   * modo — e transformaria a transformação num ataque.
   */
  estourarSSJ() {
    const E = NAMEK.ssj.estouro;
    const p = this.controller.position;
    const peito = p.y + NAMEK.fighter.chest;

    this.fx.clarao(p.x, peito, p.z, E.clarao, NAMEK.ssj.cor, 1);
    this.fx.fagulhas(p.x, peito, p.z, 0.6, NAMEK.ssj.cor, 40, 26);
    this.cam.shake(E.tremor, E.tremorDur);
    /* NENHUM SOM AQUI, e a ausência é a correção de um erro.
       O estouro deste instante já está tocando: ele são os últimos 200 ms do
       `transformacao`, disparado três segundos atrás pelo `NS2C.SSJ_ON` (ver
       `gritoDeTransformacao`, em `audio.js`, que descreve o corte seco no fim).
       O `detonouNoAr` que havia aqui era o paliativo de quando aquele som não
       existia; mantê-lo seria duas detonações com um piscar de diferença, que
       não soa como uma explosão maior — soa como eco de defeito. */

    /* O CHÃO, se houver chão. `heightAt` é a mesma função que a sala usa, então
       "perto do chão" quer dizer a mesma coisa nos dois lados. No ar não há
       cratera a pedir — e não haver é a leitura certa: um buraco abrindo no
       terreno debaixo de alguém que gritou a duzentos metros de altura seria a
       explosão acontecendo no lugar errado. */
    const chao = this.field.heightAt(p.x, p.z);
    if (p.y - chao > E.alcanceDoChao) return;
    this.fx.slam(p.x, chao, p.z, NAMEK.destruction.slamSpeed * 1.6);
    this.derrubarPorPerto({ x: p.x, y: chao, z: p.z }, E.potencia);
    this.net.send(NC2S.GROUND_HIT, {
      p: [p.x, chao, p.z],
      power: E.potencia,
    });
  }

  /**
   * **O SOL EXPLODIU.** O terceiro Kamehameha.
   *
   * *"Ele explode, ativando várias partículas, pegando fogo em Namekusei."*
   *
   * Três coisas, e cada uma cobre uma distância de leitura:
   *
   * • o CLARÃO do céu (`NamekSky.explodirSol`), que lava a tela inteira e
   *   acende o relevo por baixo — é o que se vê de qualquer lugar do mapa, e é
   *   ele que dá a escala de uma estrela morrendo;
   * • as PARTÍCULAS no lugar do sol, a três quilômetros: elas não são o
   *   espetáculo (a essa distância cada uma tem meio pixel), são a confirmação
   *   de ONDE aconteceu, para quem estava olhando para lá no instante do tiro;
   * • e o TREMOR da lente, que é o que dá peso ao clarão.
   *
   * *"Pegando fogo em Namekusei"* é a virada de clima, e ela não acontece aqui:
   * o `NS2C.WEATHER` que a sala manda logo atrás fecha o céu, incendeia o
   * horizonte e escurece o planeta ao longo dos oito segundos de
   * `NAMEK.weather.fade` — o cenário inteiro pegando fogo, que é bem mais do que
   * qualquer emissão de partícula daria.
   */
  explodirSol() {
    const ceu = this.world.sky;
    if (!ceu) return;
    ceu.explodirSol();
    this.hud.banner("O SOL SE APAGOU", 3.4);
    this.cam.shake(1, 2.2);

    const p = ceu.pontoDoSol(this._pontoSol ?? (this._pontoSol = { x: 0, y: 0, z: 0 }));
    /* O clarão do `fx` além do do céu: o do céu é o CÉU lavando, e este é a
       bola de fogo no lugar onde o disco estava. Raio enorme porque ele está a
       três quilômetros — o que importa é o ângulo que ele ocupa, não o metro. */
    this.fx.clarao(p.x, p.y, p.z, 900, 0xffd9a0, 1);
    this.fx.fagulhas(p.x, p.y, p.z, 260, 0xffb14a, 64, 900);
    /* O estouro é AUDÍVEL, e pela receita de detonação no ar que o modo já tem —
       não há som próprio de estrela morrendo, e inventar um por causa de um
       acontecimento que acontece uma vez por partida seria um buffer a mais na
       carga do jogo para tocar uma vez. */
    this.audio.detonouNoAr?.(p, 44, "genki");
  }

  /** Desfaz o Super Saiyajin nas quatro peças que o carregam: o estado, o corpo,
   *  a barra e o HUD. Um caminho só — morte, fim da batalha e recusa da sala
   *  passam todos por aqui. */
  desligarSSJ() {
    this.ssj.desligar();
    this.me.ssj = false;
    this.ki.ssj = false;
    this.hud.setSSJ(false);
  }

  /**
   * O `R`: pedir a transformação.
   *
   * O cliente confere a MESMA regra que a sala vai conferir (`podeAcender`) —
   * não para decidir, que é dela, mas para não começar três segundos de animação
   * que vão ser desfeitos. Recusado, ele explica: o alerta na tela já diz quando
   * dá, e um toque de tecla que não faz nada e não fala é a pior resposta
   * possível.
   */
  pedirSSJ() {
    if (!this.contextoSSJ()) {
      /* A mensagem separa os dois "não" que o jogador consegue consertar. O
         terceiro (estar caído) não vira aviso: quem está no chão tem coisa mais
         urgente na tela. */
      if (this.down || this.controller.caido) return;
      this.hud.toast(
        this.freezaVivo
          ? "Super Saiyajin: só com 30 % de vida ou menos"
          : "Super Saiyajin: só na batalha contra o Freeza",
      );
      return;
    }
    if (!this.ssj.pedir()) return;
    /* A previsão liga TUDO no mesmo quadro: o bit da pose (para quem olha de
       longe ver o ouro subindo junto com o grito), a economia da barra e a
       animação do corpo. A sala confirma logo atrás; se não confirmar, o
       `update` da máquina desfaz os quatro em bloco. */
    this.me.ssj = true;
    this.ki.ssj = true;
    this.me.transformar(0);
    this.hud.setSSJ(true);
    this.hud.setAvisoSSJ(false);
    this.net.send(NC2S.SSJ, {});
  }

  /**
   * As condições do alerta e do gatilho, num lugar só.
   *
   * Ele é o mesmo objeto reaproveitado entre quadros (o alerta é reavaliado a
   * 60 Hz), pela regra de sempre: um literal por quadro são 3 600 objetos por
   * minuto para o coletor recolher numa pergunta que quase sempre dá "não".
   */
  contextoSSJ() {
    const c = this._ctxSSJ ?? (this._ctxSSJ = {});
    c.vida = this.health;
    c.freeza = this.freezaVivo;
    /* A CONQUISTA: o Freeza já foi derrubado nesta partida. Com ela, `podeAcender`
       ignora o limiar de vida e a presença do chefe — ver
       `NAMEK.ssj.livreAposOFreeza`. */
    c.derrotado = this.freezaDerrotado === true;
    c.vivo = !this.down;
    c.caido = this.controller.caido === true;
    c.ssj = this.ssj.aceso;
    return podeAcender(c);
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
    /* MORRER DESLIGA O SUPER SAIYAJIN, e o corpo que renasce é um corpo novo:
       teto de 100, barra sem desconto, cabelo preto. A sala pensa o mesmo (ver
       `apagar`, chamado de `NamekRoom.matar`) e é por isso que a vida aqui volta
       ao `maxHealth` base sem consultar `vidaMaxima`. Ver o §"quando ela ACABA"
       em `NAMEK.ssj`. */
    this.desligarSSJ();
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
    /* Morto não aponta para ninguém: solta a mira, os círculos e o painel. */
    this.lock.soltar();
    this.casting = null;
    this.cam.shake(1, 0.6);
  }

  /* --------------------------------------------------------------- ajuda -- */

  /* NÃO PROCURE `lockId` AQUI. Ele era o id do adversário preso pela tecla `R`,
     e sumiu com ela — não existe mais estado "travado" neste arquivo.

     O que responde às mesmas perguntas hoje, e cada um a uma delas:
       `this.lock.sob`        quem está sob o cursor (mira assistida)
       `this.lock.alvoDeAtaque()`  em quem os projéteis miram
       `this.lock.noPainel`   quem a placa do canto está mostrando
     Ver `src/namek/lockon.js` e o bloco `lock` do config. */

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
    /* A guarda apara o EMPURRÃO também. A sala faz a mesma conta para os bots
       (ver `NamekRoom.onda`); aqui ela vale para mim, que é o único corpo que
       esta tela tem o direito de mover. */
    const guarda = this.controller.defendendo ? NAMEK.guard.push : 1;
    const forca = K.burstPush * (1 - d / K.burstRadius) * guarda;
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
  derrubarPorPerto(ponto, power, fundo = 1) {
    /* O RAIO DA ENCOSTA, e não o da clareira.
     *
     * Era `craterFor(power).raio` — o buraco de terreno plano —, e desde que a
     * montanha passou a perder um NACO de verdade (ver `NamekField.esculpirNaco`)
     * esse número virou o errado justamente onde a destruição mais aparece: na
     * ladeira o buraco é até 60 % maior, e as árvores da borda externa dele
     * continuavam de pé sobre um chão que tinha ido embora. `raioDeCratera`
     * mede a inclinação com a MESMA conta que esculpe o terreno, que é o que
     * garante que a área que derruba árvore e a área que afunda o chão sejam a
     * mesma área. */
    const raio = this.field.raioDeCratera(ponto.x, ponto.z, power, fundo);
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

  /**
   * A BÚSSOLA: onde estão os outros, para quem já não consegue enxergá-los.
   *
   * É a peça dos marcadores de rocha da chuva de meteoros, trazida para cá a
   * pedido — e o pedido veio com a regra que a torna diferente da de lá: *"quando
   * o jogador/bot está perto a setinha some. Ela só aparece quando está longe e
   * difícil de enxergar."*
   *
   * "Difícil de enxergar" tem um número, e ele sai da ótica, não do gosto. Um
   * lutador tem 1,78 m; com o campo de visão de 68° desta câmera, a altura
   * dele na tela é `1,78 / d` radianos sobre 1,19 rad de tela — a 90 m ele tem
   * **dezoito pixels** numa tela de 1080, a 150 m tem onze, a 300 m tem cinco.
   * Dezoito pixels é onde um corpo deixa de ser uma pessoa e passa a ser um
   * cisco contra o céu; daí `PINO_DE`. A rampa até `PINO_CHEIO` existe para o
   * pino nascer desbotando: aparecer de um estalo a noventa metros faria a tela
   * piscar toda vez que alguém cruzasse o limiar, que é o tempo todo.
   *
   * O que ele NÃO faz, e é deliberado: não aparece para quem está perto e fora
   * da tela. Alguém a vinte metros nas suas costas também é invisível, e mesmo
   * assim não ganha pino — porque numa briga colada catorze setas em volta da
   * mira seriam a própria briga escondida atrás da bússola. Quem está perto se
   * acha pelo som e pela trava; a bússola é para o outro problema.
   *
   * Zero alocação: a lista e os registros dentro dela são reaproveitados entre
   * quadros, como o `alvos()` dos remotos já faz e pelo mesmo motivo.
   */
  bussola() {
    const lista = this._bussola;
    lista.length = 0;
    const c = this.controller.position;
    const cam = this.camera3;
    /* A câmera acabou de se mover neste quadro (o bloco da lente roda antes
       deste) e `project` lê `matrixWorldInverse`, que só é recalculada dentro
       do `render`. Sem esta linha, o pino descreveria o enquadramento do quadro
       ANTERIOR — o que a 64 m/s de arranque é meio metro de erro por quadro, e
       aparece como a seta tremendo contra a borda. */
    cam.updateMatrixWorld();

    /* `mirados()` e não `remotes`: o CHEFE entra na bússola pela mesma porta que
       o pôs na mira. Ele é o único corpo do modo que o jogador precisa achar sem
       nunca tê-lo visto — e o que o pedido cobra é justamente isto: *"deve ficar
       um aviso visual no Freeza para saber onde ele está."* */
    for (const r of this.mirados()) {
      if (r.down) continue;
      const chefe = r.boss === true;
      const p = r.pose;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const dz = p.z - c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      /* A régua de distância vale para GENTE. O chefe tem outra (logo abaixo,
         depois da projeção), e ela não é de distância: é de estar ou não no
         quadro. */
      if (!chefe && d < PINO_DE) continue;

      const n = lista.length;
      let m = this._pinoBanco[n];
      if (!m) {
        m = this._pinoBanco[n] = {
          angulo: null, x: 0, y: 0, dist: 0, cor: null, travado: false, forca: 0,
          boss: false, nome: "",
        };
      }

      /* O PEITO, e não os pés: o anel tem de cair sobre o corpo, e mirar nos
         pés o deixaria pendurado meio metro abaixo de quem ele circula. O do
         chefe é mais alto (2,24 m de corpo contra 1,78 m). */
      const v = this._pinoV;
      v.set(p.x, p.y + (chefe ? NAMEK.freeza.peito : NAMEK.fighter.chest), p.z).project(cam);
      const atras = v.z > 1;
      const naTela = !atras && Math.abs(v.x) <= 0.95 && Math.abs(v.y) <= 0.95;
      /* A REGRA DO CHEFE, e ela divide o trabalho com o outro marcador em vez de
       * duplicá-lo:
       *
       *   NA TELA  → o anel magenta com o nome, em volta do corpo (`setAneis`);
       *   FORA     → a seta na borda, aqui, a QUALQUER distância.
       *
       * Sem a segunda metade, perder o Freeza de vista era perdê-lo — ele voa a
       * 118 m/s e teleporta 46 m por salto, então "atrás de você" é o estado
       * mais comum da luta e o mais caro de não saber. E sem a divisão, os dois
       * marcadores desenhariam no mesmo corpo ao mesmo tempo, que é a tela
       * dizendo duas vezes a mesma coisa por cima de si mesma. */
      if (chefe && naTela) continue;
      if (naTela) {
        m.angulo = null;
        m.x = v.x;
        m.y = v.y;
      } else {
        /* O RUMO SAI DO ESPAÇO DA CÂMERA, E NÃO DO NDC — e aqui esta bússola
         * DIVERGE do marcador de rocha do modo de meteoros de propósito.
         *
         * Lá o ângulo é `atan2` das coordenadas projetadas. Funciona para uma
         * rocha, e quebra para um lutador, porque a projeção divide por
         * `-z` da câmera: quando o alvo se aproxima do PLANO da lente (90° do
         * olhar), esse divisor tende a zero e ambas as coordenadas explodem
         * JUNTAS — o ângulo entre elas passa a ser decidido pela razão entre um
         * deslocamento lateral enorme e a altura do peito, que é 1,15 m.
         *
         * Medido, com a conta copiada: um adversário exatamente à sua direita, a
         * 200 m, produzia uma seta a **45°** — apontando para o canto superior
         * direito em vez de para o lado. À esquerda, o espelho disso. O modo de
         * meteoros não sente porque uma rocha está sempre CENTENAS de metros
         * acima, e ali a razão ainda significa alguma coisa; dois lutadores
         * voando na mesma faixa de altitude caem exatamente no caso ruim.
         *
         * O espaço da câmera não tem divisão nenhuma: `x` é "quanto está para a
         * direita do meu olhar" e `y` é "quanto está acima", nas unidades do
         * mundo. O ângulo entre eles é o rumo verdadeiro, em qualquer posição,
         * inclusive atrás. */
        const q = this._pinoV.set(
          p.x, p.y + (chefe ? NAMEK.freeza.peito : NAMEK.fighter.chest), p.z,
        );
        q.applyMatrix4(cam.matrixWorldInverse);
        /* O único ponto sem rumo é o que cai exatamente sobre o eixo do olhar,
           e ele quase não existe na prática: a mira é no PEITO, um metro e
           quinze acima dos pés, então um adversário alinhado com o eixo ainda
           tem `y` e a seta aponta para cima. A guarda é para o caso exato — sem
           ela, `atan2(0, 0)` devolve zero e a seta apontaria para a direita, que
           é a única resposta que não significa nada. Para baixo, que é como
           todo jogo diz "vire-se". */
        m.angulo = q.x * q.x + q.y * q.y < 1e-6 ? -Math.PI / 2 : Math.atan2(q.y, q.x);
      }

      m.dist = Math.round(d);
      m.cor = r.color;
      /* O PINO DESTACADO é o de quem está sob o cursor, e não mais o do alvo
         travado (que deixou de existir). É a mesma promessa em outro lugar da
         tela: o pino aceso e o círculo aceso são a mesma pessoa, e é nela que o
         próximo tiro vai. */
      m.travado = r.id === this.lock.sob;
      m.boss = chefe;
      m.nome = chefe ? (r.name ?? NAMEK.freeza.nome) : "";
      /* O CHEFE NÃO DESBOTA. A rampa existe para o pino de gente nascer e morrer
         suave conforme a distância — o dele não tem distância que o justifique:
         ou ele está fora do quadro, e aí é a informação mais urgente da tela, ou
         não há pino nenhum. */
      m.forca = chefe ? 1 : Math.min(1, (d - PINO_DE) / (PINO_CHEIO - PINO_DE));
      lista.push(m);
    }

    /* MAIS PERTO PRIMEIRO, e a ordem não é enfeite: o pool de nós do HUD é
       reaproveitado por índice, então uma lista que muda de ordem faz o mesmo
       elemento do DOM descrever outra pessoa de um quadro para o outro — e a
       transição de opacidade recomeça do zero em toda troca. Ordenando por
       distância, quem está perto fica ancorado nos primeiros nós. */
    lista.sort(ordemDoPino);
    /* E O CHEFE FICA NO PRIMEIRO NÓ, sempre — fora da ordenação por distância.
     *
     * Pelo mesmo argumento do parágrafo acima, levado a sério: o pino dele é o
     * único que carrega TEXTO próprio ("FREEZA · 240 m") e uma classe própria, e
     * ele se aproxima e se afasta o tempo todo. Deixado na ordem por distância,
     * ele trocaria de nó do DOM várias vezes por minuto, e a cada troca o rótulo
     * e o estilo do chefe saltariam para o pino de outra pessoa por um quadro.
     * Ancorado no índice 0, ele é sempre o mesmo elemento. */
    for (let i = 1; i < lista.length; i++) {
      if (!lista[i].boss) continue;
      const chefe = lista[i];
      for (let k = i; k > 0; k--) lista[k] = lista[k - 1];
      lista[0] = chefe;
      break;
    }
    return lista;
  }

  /**
   * A TELA DO FIM — a contagem, os metros que faltam e a seta do portal.
   *
   * *"Deve ter um indicativo no céu para o lugar que eles têm que voar para
   * escapar do planeta e quantos metros faltam."* A coluna de luz é do cenário
   * (`world/fuga.js`); o que se resolve aqui é a metade que o cenário não
   * consegue dizer — o número, a barra e o rumo de quem está olhando para o
   * outro lado.
   *
   * Depois do HUD e depois da câmera, como a bússola e pelo mesmo motivo: ela
   * projeta pela lente DESTE quadro, e a lente foi resolvida lá em cima.
   */
  telaDoFim(dt) {
    const F = this.fim;
    const ativo = F.fase === FASE.CONTAGEM || F.fase === FASE.EXPLODINDO;

    const h = this._fimHud;
    h.ativo = ativo;
    h.segundos = F.restante;
    h.metros = F.metros;
    h.fracao = F.fracaoDaFuga;
    h.altitude = F.altitude;
    h.altitudeAlvo = F.altitudeAlvo;
    h.escapou = F.euEscapei;
    /* As duas linhas de texto mudam quando você já está do lado de fora: a
       contagem continua valendo (o planeta ainda vai explodir, e é o que você
       veio ver), mas a instrução deixou de ser sua. */
    h.rotulo = F.euEscapei ? "NAMEKUSEI VAI EXPLODIR" : "O PLANETA VAI EXPLODIR";
    h.sub = F.euEscapei ? "VOCÊ ESTÁ FORA — ASSISTA" : "SUBA ATÉ O RASGO DE LUZ";
    this.fugaHud.set(h);

    /* O MARCADOR. Some depois de escapar: atravessado o portal, ele fica atrás e
       abaixo, e uma seta apontando para a saída de onde você já saiu é a única
       coisa da tela que não significa mais nada. */
    if (!ativo || F.euEscapei) {
      this.fugaHud.setMarca(undefined);
      this.fugaHud.update(dt);
      return;
    }

    const cam = this.camera3;
    /* Como na bússola: a lente andou neste quadro e `project` lê
       `matrixWorldInverse`, que só é recalculada dentro do `render`. */
    cam.updateMatrixWorld();
    const v = this._fimV.set(F.portal.x, F.portal.y, F.portal.z).project(cam);
    const atras = v.z > 1;
    const naTela = !atras && Math.abs(v.x) <= 0.95 && Math.abs(v.y) <= 0.95;

    if (naTela) {
      this.fugaHud.setMarca(null, v.x, v.y, F.metros);
    } else {
      /* O rumo sai do ESPAÇO DA CÂMERA e não do NDC, e este caso é o exemplo
         extremo do que `bussola` documenta: o portal está a dois quilômetros de
         altura sobre o centro do mapa, então para quem voa rente ao chão na
         borda ele fica quase no plano da lente — exatamente onde a projeção
         divide por um número que tende a zero e devolve um rumo inventado. */
      const q = this._fimV.set(F.portal.x, F.portal.y, F.portal.z);
      q.applyMatrix4(cam.matrixWorldInverse);
      const ang = q.x * q.x + q.y * q.y < 1e-6 ? Math.PI / 2 : Math.atan2(q.y, q.x);
      this.fugaHud.setMarca(ang, 0, 0, F.metros);
    }

    this.fugaHud.update(dt);
  }

  /** Ângulo na tela de onde veio uma pancada — alimenta a marca de dano. */
  anguloNaTela(p) {
    const dx = p.x - this.controller.position.x;
    const dz = p.z - this.controller.position.z;
    return Math.atan2(dx, dz) - this.controller.yaw;
  }

  /* -------------------------------------------------------------- mira ---- */

  /* A TRAVA MANUAL (`alternarTrava`, na tecla `R`) morava aqui e foi removida a
     pedido — *"pode remover o atalho que dá lock-in no teclado (R)"*. Com ela
     saíram o `pontoDaTrava` e o `anelDaTrava`, que só existiam para servi-la: o
     primeiro dizia à câmera e ao tiro onde estava o alvo preso, o segundo
     desenhava o círculo vermelho em volta dele.

     Quem designa alvo hoje é o CURSOR, e ele não precisa de gesto nenhum — ver
     `LockOn` e o bloco `lock` do config para a decisão inteira. */

  /**
   * A VIDA DO ALVO PARA O PAINEL — quem `LockOn.noPainel` escolheu, ou null.
   *
   * As duas razões de a placa aparecer (você acertou alguém / o cursor está em
   * cima de alguém) já foram resolvidas lá; aqui só se traduz um id em nome, cor
   * e vida. O rascunho é reaproveitado: a placa é escrita a 60 Hz e um objeto
   * novo por quadro seria lixo criado no meio da briga.
   *
   * A VIDA VEM DE `RemoteFighters`, e isso é a metade do pedido que ninguém vê:
   * aquele registro é atualizado pelo `NS2C.VITALS` (10 Hz, todo mundo) e por
   * TODO `NS2C.HURT`, inclusive os que não têm nada a ver comigo. É por isso que
   * a barra do alvo desce quando quem o acerta é um terceiro — *"a vida dinâmica
   * diminui conforme o player perde vida, seja para ele ou para outros
   * players"*.
   */
  dadosDoAlvo() {
    const id = this.lock.noPainel;
    if (id === null || this.down) return null;
    const r = this.remotes.get(id);
    /* Saiu da sala entre um quadro e outro: a placa some, e é a resposta certa —
       não há vida nenhuma a mostrar de quem não está mais aqui. */
    if (!r) return null;

    const a = this._alvoHud;
    a.id = r.id;
    a.nome = r.name;
    a.cor = r.color;
    a.vida = r.health;
    /* O teto do ADVERSÁRIO também é variável — ele pode estar transformado, e o
       bit 16 da pose dele já diz. Com o teto fixo, um Super Saiyajin com 130 de
       160 apareceria com a barra estourada em 100 %, que é a leitura oposta à
       verdadeira (ele está em 81 % e ainda dá para derrubá-lo). */
    a.vidaMax = vidaMaxima(r.ssj);
    /* O número só sai quando o golpe foi MEU (e é o `LockOn` quem sabe disso —
       ele zera o dano quando a placa está no ar por causa da mira). */
    a.dano = this.lock.danoNaTela();
    return a;
  }

  /** O peito de quem mira — a origem de toda medida da mira assistida. */
  _origemDaTrava() {
    const c = this.controller.position;
    const o = this._pontoTrava;
    o.x = c.x;
    o.y = c.y + NAMEK.fighter.chest;
    o.z = c.z;
    return o;
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

    /* A POSE VEM ANTES DO PONTO. `handPoint` lê a matriz do mundo da malha da
       mão, e a pose de rajada é que estica o braço para a frente — marcar a mão
       depois de perguntar onde ela está faz a PRIMEIRA bola de cada sequência
       nascer uns doze centímetros atrás, na mão ainda recolhida. Rajada
       sustentada não sofria, o primeiro tiro sim, e o primeiro tiro é o que se
       olha. */
    this.me.lastHand = mao;
    this.me.handPose = 1;
    const origem = this.me.handPoint(mao);
    const dir = this.direcaoDeTiro();
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
      /* Dourada em Super Saiyajin — "todos os poderes que ele solta ficam
         amarelos", e a bolinha é o que ele solta o tempo todo. O desconto de ki
         desta rajada não está aqui: quem o aplica é o `KiMeter`, no `gastar`
         acima, e é por isso que ele vale também para a onda e para a guarda sem
         uma linha em cada uma. */
      ssj: this.ssj.aceso,
    });
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
   * Para onde o tiro sai: **pela MIRA, sempre.**
   *
   * Houve um segundo caminho aqui — com a tecla `R` apertada, o tiro saía na
   * direção exata do alvo preso, em vez do eixo óptico. Ele saiu com a tecla, e
   * a perda é menor do que parece: quem designa alvo hoje é o cursor, e o cursor
   * já está praticamente em cima do adversário quando a mira assistida o elege
   * (a zona é apertada — `NAMEK.lock.mira.raioTela`). A correção que sobrava
   * para o caso travado é hoje a PERSEGUIÇÃO do próprio projétil (§6.1), que é
   * limitada de propósito e é o que perdoa a pontaria sem tirá-la do jogador.
   *
   * O método continua existindo, em vez de as duas chamadas virarem
   * `cam.aimDirection()` direto, porque ele é o ÚNICO lugar em que se decide
   * para onde um tiro sai — e a próxima pessoa que quiser mexer nisso (uma
   * finalização, um duelo, um alvo designado que volte) precisa ter um lugar só
   * para procurar.
   */
  direcaoDeTiro() {
    return this.cam.aimDirection();
  }

  /**
   * Quem a bola vai perseguir — decidido AQUI, no disparo, e nunca revisto.
   *
   * Quem está sob o CURSOR tem prioridade — é a mira assistida, e ela é a
   * intenção declarada do jogador no instante em que ele apertou o botão. Sem
   * ninguém sob o cursor, vale o mais alinhado com o tiro dentro de `acquire`
   * metros. Uma bola que troca de alvo no meio do voo lê como bug, e é por isso
   * que este valor viaja na mensagem em vez de cada cliente recalculá-lo (ver o
   * comentário de `NC2S.BLAST`).
   */
  /**
   * **Tudo em que a mira pode pegar: os lutadores remotos E O BOSS.**
   *
   * Os três seletores de alvo deste arquivo — a bola, o especial e a trava —
   * varriam `remotes.byId`, que é a lista de LUTADORES. O Freeza não é um: ele
   * não entra em `todos()` na sala e não chega pelo `NS2C.JOIN`. O resultado era
   * o defeito descrito em `BossSystem.candidato()`, e ele vale repetir aqui
   * porque é aqui que ele nascia: **nenhum poder do jogador curvava na direção
   * do boss**, e o Kamehameha — que só curva com alvo designado — saía reto
   * contra ele sempre. Medido: 7,9 % de acerto na rajada contra 64,2 % com a
   * perseguição ligada.
   *
   * Um gerador, e não uma lista montada: `remotes.byId.values()` já era um
   * iterador, e o que se acrescenta é no máximo um objeto que o `BossSystem`
   * mantém reusado. Zero alocação por quadro além do próprio iterador, que já
   * existia.
   */
  *mirados() {
    yield* this.remotes.byId.values();
    const boss = this.boss.candidato();
    if (boss) yield boss;
  }

  escolherAlvoDaBola(origem, dir) {
    const travado = this.lock.alvoDeAtaque();
    if (travado !== null) return travado;
    const H = NAMEK.blast.homing;
    const cosCone = Math.cos((H.cone * Math.PI) / 180);
    let melhor = null;
    let melhorCos = cosCone;
    for (const r of this.mirados()) {
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
   * Quem o especial vai perseguir. Irmã de `escolherAlvoDaBola`, com o alcance
   * e o cone do PRÓPRIO golpe em vez dos da rajada.
   *
   * Duas funções e não uma porque as duas escolhas têm réguas diferentes de
   * propósito: a bola de ki procura num cone de 22° a 50 m (ela perdoa a mira,
   * não escolhe por você), e um Kienzan procura num cone de 75° a 300 m —
   * porque ele é lançado de longe e a promessa dele é que chega. Unificá-las
   * pediria um parâmetro que nunca é o mesmo em nenhuma chamada.
   */
  escolherAlvoDeEspecial(origem, dir, info) {
    const H = info.homing;
    if (!H) return null;
    const cosCone = Math.cos((H.cone * Math.PI) / 180);
    let melhor = null;
    let melhorCos = cosCone;
    // O BOSS entra na varredura junto com os lutadores. Ver `mirados()`.
    for (const r of this.mirados()) {
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
    /* `gastarEspecial` e não `gastarTudo`: em Super Saiyajin o golpe custa um
       terço da barra, e são **três com uma carga** (ver `NAMEK.ssj`). O limiar
       de `podeEspecial` logo acima já caiu junto — os dois leem a mesma chave
       `ki.ssj`, e é ela que faz esta função continuar não sabendo do assunto. */
    this.ki.gastarEspecial();

    const origem = this.me.chestPoint();
    const dir = this.direcaoDeTiro();
    /* O ALVO DO GOLPE QUE PERSEGUE, escolhido AGORA e nunca revisto.
     *
     * Todos os quatro especiais têm `homing` hoje — o pedido foi literal ("todos
     * os poderes devem perseguir o player, alguns perseguem mais, outros
     * menos"). Quem está sob o CURSOR ganha de tudo, porque é a intenção
     * declarada do jogador; sem ninguém sob o cursor, vale o mais alinhado com a
     * mira dentro do alcance de aquisição do golpe, que é bem maior que o de uma
     * bola de ki (300 m contra 50).
     *
     * O KAMEHAMEHA É A EXCEÇÃO, e ela é o pedido: "para fazer curva, ele só faz
     * curva quando o player está travado o foco no inimigo". `soTrava` corta a
     * aquisição automática — sem ninguém designado ele sai sem alvo, e sem alvo
     * ele é o feixe reto que sempre foi. Com a tecla `R` removida, o preço da
     * curvatura deixou de ser um compromisso e passou a ser pontaria: é preciso
     * estar apontando para alguém no instante em que se gasta a barra inteira.
     *
     * É a mesma regra do §6.1 aplicada a um golpe caro, e ela precisa ser
     * resolvida aqui e viajar na mensagem: dois clientes escolhendo sozinhos
     * dariam duas trajetórias para o mesmo golpe. */
    const travado = this.lock.alvoDeAtaque();
    const alvo = !info.homing
      ? null
      : info.homing.soTrava
        ? travado
        : travado ?? this.escolherAlvoDeEspecial(origem, dir, info);
    /* `duracaoDaPose` e não `windup + sustain`: o Kienzan, o Galick Gun e a
       Genki Dama SAEM da mão e voam sozinhos, e prender o corpo pela vida do
       projétil deixaria o lutador na pose de arremesso por até dez segundos
       enquanto a bola já está do outro lado do vale. O feixe, esse sim, dura o
       que ele fica aceso. */
    this.casting = { kind, indice, t: 0, dur: duracaoDaPose(info), dir };
    this.specialIndex = indice;

    /* A DIREÇÃO É TRAVADA AGORA, no início da pose, e não quando o feixe sai.
       O windup do Kamehameha dura um segundo inteiro; deixar a direção viva até
       o fim dele permitiria carregar olhando para o chão e disparar tendo girado
       para o céu, o que apaga o custo de se comprometer — que é a única coisa
       que o windup existe para cobrar. */
    /* `ssj` é o que faz o golpe sair DOURADO — ele escolhe a definição do golpe
       lá dentro (ver `PowerSystem.spawnSpecial`), e daí a cor alcança as doze
       leituras de `.cor` do feixe, da esfera e do disco sem tocar em nenhuma. */
    this.powers.spawnSpecial({
      owner: this.myId, kind, origem, dir, target: alvo, local: true, ssj: this.ssj.aceso,
    });
    /* O `true` é "este golpe é MEU", e ele só muda uma coisa no áudio: a
       sustentação do meu Kamehameha vem do loop sem posição (ver
       `NamekAudio.update`), então tocar também a versão posicional dele seria o
       mesmo rugido duas vezes. Ver `NamekAudio.especial`. */
    this.audio.especial(origem, kind, true);
    this.net.send(NC2S.SPECIAL, {
      kind,
      o: [origem.x, origem.y, origem.z],
      d: [dir.x, dir.y, dir.z],
      target: alvo,
      w: this.net.serverTime,
    });

    /* ------------------------------------------------- o tiro no planeta --
     *
     * **Só o Kamehameha**, e é o pedido literal. Nenhum outro especial encosta
     * nos dois corpos: o Kienzan e o Galick Gun perseguem gente e a Genki Dama é
     * uma bola que cai — o feixe é o único golpe do jogo com escala para a
     * pergunta fazer sentido, exatamente como a Terra do arqueiro só responde ao
     * Kamehameha de lá.
     *
     * O teste é feito AQUI e não dentro de `powers/beam.js` por três razões, e
     * nenhuma é de organização:
     *
     *   1. o feixe alcança 1.860 m e o planeta está a 2.400 — a cabeça NUNCA
     *      chega nele. Não há interseção a acontecer em voo, e esperá-la seria
     *      esperar para sempre;
     *   2. a direção que vale é a TRAVADA no disparo, e ela é conhecida aqui,
     *      no quadro em que é decidida (`beam.js` a recebe pronta);
     *   3. a sala confere contra essa mesma direção (`NamekPlanetas.pedido`), e
     *      testar de outro vetor deste lado só produziria acertos recusados sem
     *      explicação.
     *
     * O planeta não cai agora: a sala espera `NAMEK.planetas.viagem` segundos
     * antes de anunciar. O feixe vai embora, o jogador desiste de esperar, e o
     * céu acende. Ver o comentário de `viagem` no config.
     */
    if (kind === "kamehameha") {
      const planeta = this.world.planetaNaMira(origem, dir);
      if (planeta) this.net.send(NC2S.PLANET_HIT, { id: planeta });

      /* ------------------------------------------------------- E O SOL ----
       *
       * *"Esse modo Namekusei também é ativado se 3 Kamehamehas atingirem o
       * sol."*
       *
       * Mesma pergunta, mesmo instante e mesmo motivo dos planetas: a direção
       * que vale é a TRAVADA no disparo, o feixe nunca chega lá (ele alcança
       * 1 860 m e o sol é uma direção, não um lugar), e a sala confere contra
       * este mesmo vetor. Ver `NamekSky.solNaMira` e `server/namek/sol.js`.
       *
       * Quem responde é o CÉU e não o mundo: o sol é dele — a direção, o raio e
       * o disco desenhado saem de `world/sky.js` —, e responder de outro lugar
       * seria a primeira oportunidade de a coisa que se vê e a coisa que conta
       * discordarem.
       *
       * Nada acontece na tela agora, nem deve: a sala é quem sabe se este era o
       * terceiro tiro, e a resposta dela chega pelo `NS2C.SUN`. */
      if (this.world.sky?.solNaMira?.(origem, dir)) {
        this.net.send(NC2S.SUN_HIT, {});
      }
    }
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
        this.menu.setDificuldade(this.dificuldade);
      }
    }

    /* ---------------------------------------------------------- morto --- */
    if (this.down) {
      const falta = Math.max(0, this.deadUntil - agora);
      this.hud.setDead(falta / 1000);
      if (falta <= 0 && acoes.respawn) this.net.send(NC2S.RESPAWN, {});
    }

    /* ------------------------------------------------ SUPER SAIYAJIN ---
     *
     * Antes da guarda, do ki e do controle, e a ordem é a mesma lógica do bloco
     * do menu logo acima: os três segundos de transformação CALAM tudo o que
     * vem depois, e resolvê-los no fim deixaria um quadro de guarda, de carga e
     * de tiro passando por baixo do grito.
     *
     * O alerta é reavaliado por quadro porque as três condições dele mudam por
     * quadro (a vida cai, a vida sobe com o renascimento, o chefe entra e sai).
     * `setAvisoSSJ` sai na primeira linha quando o estado já bate, então isto
     * custa a pergunta e mais nada. */
    if (acoes.ssjPressed) this.pedirSSJ();

    /* BANCADA: Alt+K mata o Freeza. Só PEDE — quem mata é a sala, e ela mata
       pelo caminho de morte de verdade, para o `aoMorrer` disparar e a fuga
       começar. Ver `NamekFreeza.matarPorTeste`. Sem boss em campo o pedido é
       inócuo do outro lado, então não há o que conferir aqui. */
    if (acoes.matarBossPressed) this.net.send(NC2S.BOT, { boss: "matar" });
    const ssjEvento = this.ssj.update(dt);
    if (ssjEvento === "explodiu") this.estourarSSJ();
    else if (ssjEvento === "cancelou") {
      /* A sala não confirmou em três segundos: a previsão se desfaz. Ver o
         cabeçalho de `character/ssj.js` — é o mesmo contrato do especial, que
         também é recusado em silêncio, com a diferença de que aqui a recusa
         precisa de uma palavra: o jogador viu o corpo dele fazer a animação
         inteira. */
      this.desligarSSJ();
      this.hud.toast("a transformação não foi aceita");
    }
    /* A barra do Super Saiyajin é a mesma barra; o que muda é o preço de tudo o
       que se faz com ela. A chave é escrita todo quadro (e não só na virada)
       porque ela é a única ligação entre a máquina de estados e a economia, e um
       caminho de saída que esquecesse de zerá-la deixaria a barra descontada
       para sempre. Ver `KiMeter.ssj`. */
    this.ki.ssj = this.ssj.aceso;
    const podeSSJ = this.contextoSSJ();
    this.hud.setAvisoSSJ(podeSSJ);
    /* O SOM DO AVISO, e ele sai só na SUBIDA da borda.
       O aviso é reavaliado por quadro (é o comentário logo acima), então tocar
       a cada quadro em que a condição vale seriam sessenta bipes por segundo. O
       que interessa é o instante em que ela passa a valer — a vida cruzou os
       30 %, ou o chefe acabou de entrar — porque é aí que a informação é nova.
       Ver `NamekAudio.ssjPronto`. */
    if (podeSSJ && !this._avisouSSJ) this.audio.ssjPronto?.();
    this._avisouSSJ = podeSSJ;

    /* -------------------------------------------------------- defesa --- */
    /* A GUARDA, resolvida ANTES do ki e do controle, porque as duas coisas
     * dependem dela: ela come da barra e ela corta a velocidade.
     *
     * Três condições para os braços subirem, e cada uma é uma regra do modo:
     * ninguém defende caído (é justamente o preço da queda), ninguém defende no
     * meio do próprio especial (já se comprometeu), e ninguém defende com a
     * barra vazia — a guarda é ki virando escudo, e sem ki não há escudo.
     *
     * O dreno é local aqui e é COBRADO DE NOVO na sala, a partir do bit 8 da
     * pose. Não é trabalho repetido: é a mesma divisão de sempre — o cliente
     * prevê para a barra dele responder no quadro, a sala decide para a barra
     * de todo mundo ser a mesma. */
    /* E ninguém defende NO MEIO DA PRÓPRIA TRANSFORMAÇÃO: os braços estão
       cruzados acima da cabeça, o corpo está preso, e ele já é invencível — uma
       guarda ali não protegeria de nada e só drenaria a barra. */
    const querDefender =
      acoes.guard === true &&
      !this.down &&
      !this.controller.caido &&
      !this.casting &&
      !this.ssj.transformando;
    const defendendo = querDefender && this.ki.valor > 0;
    if (defendendo) this.ki.drenar(NAMEK.guard.drain, dt);
    this.controller.defendendo = defendendo;
    this.me.defendendo = defendendo;

    /* ------------------------------------------------------------ ki --- */
    /* Defender e carregar são exclusivos: as duas mãos estão ocupadas de jeitos
       opostos, e a sala somaria o ganho de uma ao dreno da outra. */
    this.ki.carregando =
      acoes.charge &&
      !this.down &&
      !this.casting &&
      !defendendo &&
      !this.controller.caido &&
      /* Nem carregar durante o grito: a pose de carga e a de transformação são
         as duas mais parecidas do jogo (as duas plantam os pés e cerram os
         punhos), e deixá-las coexistir daria um corpo no meio do caminho entre
         elas — além de encher a barra de graça durante uma invencibilidade. */
      !this.ssj.transformando;
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
    /* O ESPECIAL PRENDE O CORPO ATÉ ACABAR — e é isto que conserta o feixe
     * pendurado no ar.
     *
     * O `beam.js` sempre disse que a origem do Kamehameha não acompanha o dono
     * "porque quem solta um especial fica preso na pose". Era verdade para o
     * bot e ficção para o humano: dava para soltar o feixe e sair voando, e o
     * tubo de meio quilômetro continuava saindo de um ponto onde não havia mais
     * ninguém — que é exatamente o que o usuário descreveu.
     *
     * A trava dura o que a POSE dura (`duracaoDaPose`), não o que o projétil
     * dura: quem segura um feixe fica preso enquanto ele estiver aceso, e quem
     * ARREMESSA um disco fica preso só a fração de segundo do arremesso. */
    /* A ASSISTÊNCIA DE MIRA rodava aqui, girando o olhar do jogador em direção
       ao alvo travado antes de o corpo andar. Foi embora com a tecla `R`: sem
       trava não há alvo a que ela possa pertencer, e passá-la para a mira
       assistida brigaria com o gesto que a mira assistida serve (varrer o mouse
       por vários adversários). Ver o cabeçalho de `input.js`. */

    /* ------------------------------------------------------------- o fim ---
     * O REGIME DE VOO, escrito ANTES do passo do controlador — e a ordem é a
     * coisa toda: é ele que diz quanto vale o teto neste quadro (520 m em
     * partida comum, 2 650 durante a fuga) e se ainda existe chão. Escrevê-lo
     * depois daria um quadro de física com a régua do quadro anterior, e o
     * quadro em que isso mais importa é justamente o da troca — o instante em
     * que o jogador atravessa o portal.
     *
     * O `passo` vem antes por dependência: ele adianta o relógio da contagem e
     * mede a altitude e a distância até o portal, que é o que `aplicarRegime` e
     * o HUD leem em seguida. Ver `world/fuga.js`. */
    this.fim.passo(dt, this.controller.position);
    this.fim.aplicarRegime(this.controller);

    /* O CORPO FICA PRESO NOS TRÊS SEGUNDOS, pelo mesmo mecanismo do especial e
       pela mesma razão: o gesto é uma pose inteira, dos pés à cabeça, e um
       lutador que sai voando no meio dela mostraria o X acima da cabeça
       atravessando a arena a 64 m/s. Preso, ele fica onde plantou os pés — que é
       exatamente onde a explosão do fim vai abrir o buraco. */
    this.controller.travado = this.casting !== null || this.ssj.transformando;
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
        /* **`"pouso"` NÃO MACHUCA, `"queda"` SIM.** O campo existia no evento do
           controlador desde sempre e nunca chegava à sala, então o dano de queda
           saía igual nos dois casos — e o `F` no ar, que é um mergulho de
           propósito, se pagava com vida. Ver `NamekRoom.registrarQueda`, que é
           quem lê isto, e o `@returns` de `FighterController.update`, que é quem
           decide qual dos dois foi. A cratera e a poeira continuam nos dois. */
        tipo: pouso.tipo,
      });
      // Cair de cem metros no meio da vila derruba a vila. Mesma regra do
      // estouro, mesma autoridade: aqui só se pede, quem confirma é a sala.
      this.derrubarPorPerto(pouso.p, power);
    }

    /* A MIRA ASSISTIDA, resolvida com a matriz de câmera do quadro ANTERIOR — de
     * propósito, e é a ordem certa: a câmera deste quadro ainda não foi resolvida
     * (ela vem lá embaixo, depois da pose), e o que a mira pergunta à câmera é
     * *"onde cada um cai na tela?"*, que é uma pergunta sobre o que o jogador
     * ACABOU DE VER. Inverter a ordem para "consertar" um quadro de atraso a 60 Hz
     * criaria a dependência circular que o §17 do pedido manda não fazer.
     *
     * É daqui que saem, no mesmo passo, três coisas que precisam concordar: o
     * alvo dos projéteis, os círculos que o HUD acende e o painel de vida do
     * adversário. Uma segunda varredura seria uma segunda oportunidade de elas
     * discordarem. */
    if (this.down) {
      this.lock.soltar();
    } else {
      this.lock.update(dt, {
        origem: this._origemDaTrava(),
        /* O BOSS vai junto — e é esta linha que faz o Kamehameha curvar contra
           ele. `alvoDeAtaque()` lê o que esta varredura escolheu, e o feixe só
           curva quando há alvo designado (`soTrava`). Ver `mirados()`. */
        candidatos: this.mirados(),
        camera: this.camera3,
        /* A proporção da tela, para a zona da mira ser um CÍRCULO em pixels e
           não uma elipse. Ver o comentário em `_sobAMira`. */
        aspecto: this.camera3.aspect,
      });
    }

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
    /* O ESTADO do Super Saiyajin, escrito todo quadro — é ele que vira o bit 16
       da pose e chega a todas as outras telas. Escrever aqui, e não só na
       virada, é a mesma disciplina do resto deste bloco: o `Fighter` é um
       espelho do estado, e um espelho que só é atualizado em eventos é um
       espelho que um evento perdido deixa mentindo para sempre. */
    this.me.ssj = this.ssj.aceso;
    /* A INVENCIBILIDADE DOS TRÊS SEGUNDOS entra pelo MESMO canal da
       invulnerabilidade de nascimento, e isso não é atalho: as duas dizem a
       mesma coisa ("nada acerta este corpo agora"), viajam no mesmo bit 2 e são
       cobradas pelo mesmo `if` da sala (`aplicarDano`). Um segundo canal para a
       mesma ideia seria um segundo lugar para esquecer de olhar.
     *
     * O efeito colateral é o PISCAR do renascimento aparecer durante o grito — e
     * ele é bem-vindo: é o vocabulário que este jogo já usa para dizer
     * "intocável", e o jogador do outro lado o lê sem precisar aprender nada. */
    this.me.invuln = agora < this.invulnUntil || this.ssj.invencivel;
    /* O corpo caído vai para a rede pelo bit 4, e a queda de verdade quem a
       conta é o controlador: `derrubar` acendeu o relógio dele lá, e é ele que
       sabe quando o lutador se levanta. Escrever o estado a partir do relógio da
       sala daria dois cronômetros para o mesmo tombo. */
    this.me.tonto = c.caido;
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
     * lendo a pose e a mira do quadro ANTERIOR. A 64 m/s um quadro é mais de um
     * metro: a
     * bola saía de onde a mão estava, não de onde ela está, e mirava onde a
     * lente apontava antes de o jogador terminar de girar. */
    const ac = this._alvoCam;
    ac.position = c.position;
    ac.yaw = c.yaw;
    ac.pitch = c.pitch;
    ac.velocity = c.velocity;
    ac.flying = c.flying;
    ac.boosting = c.boostBlend > 0.3;
    /* `null` E NÃO UM ALVO: **nada neste modo enquadra dois corpos.** O
       enquadramento de trava (`NamekCamera._enquadrarTrava`, `NAMEK.lock.camera`)
       era o privilégio da tecla `R`, que saiu — e a mira assistida não pode
       herdá-lo, porque o pedido dela é literal em "sem travar a câmera". O
       argumento continua no contrato da câmera, dormente, para o dia em que
       houver um alvo designado de novo; ver a nota DORMENTE no config. */
    this.cam.update(dt, ac, null);

    /* ---------------------------------------------------------- disparo --- */
    /* CAÍDO NÃO ATIRA, e DEFENDENDO tampouco. A sala recusa os dois de qualquer
       jeito (ver `registrarRajada`); calar aqui é o que impede o cliente de
       desenhar uma bola que nunca existiu para mais ninguém — o tiro sairia na
       tela de quem apertou, não acertaria nada, e leria como perda de pacote. */
    /* E QUEM ESTÁ SE TRANSFORMANDO TAMPOUCO. Os três segundos são invencíveis;
       atirar de dentro deles daria uma janela em que o lutador machuca e não
       pode ser machucado, que é a única forma de esta transformação virar
       injusta. A sala recusa os três disparos pela mesma razão e pelo mesmo
       teste (`SSJ.invencivel`, em `registrarRajada`, `registrarEspecial` e
       `registrarOnda`); calar aqui é o que impede o cliente de desenhar um tiro
       que não existiu para mais ninguém. */
    if (!this.down && !c.caido && !defendendo && !this.ssj.transformando) {
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
    /* E O PEIXE GIGANTE, quando há um no ar. Ele entra na MESMA lista das
       pessoas — uma esfera de nove metros com id `PEIXE_ALVO_ID` — e com isso
       ganha de graça tudo o que o sistema de poderes já sabe fazer: rajada
       estourando nele, feixe queimando, disco cortando, esfera detonando. O que
       muda é só o canal do aviso, e isso é resolvido em `reportar`.
       `alvo()` devolve null entre um salto e outro (§"fora do salto ele some" de
       `world/peixe.js`), então fora dos poucos segundos de voo isto é uma
       chamada que retorna imediatamente.
       A pose é a do quadro ANTERIOR, porque o mundo ainda não andou neste — são
       menos de sessenta centímetros no pior caso, contra um alvo de nove metros
       de raio. */
    const peixe = this.world.peixe?.alvo();
    if (peixe) alvos.push(peixe);
    /* E O BOSS, pela mesma porta e pelo mesmo motivo: entrando na lista de
       alvos ele ganha de graça tudo o que o sistema de poderes sabe fazer —
       bola estourando nele, Kamehameha parando nele, Genki Dama detonando
       contra ele. O canal do aviso é que muda, e isso é resolvido em `reportar`.
       Sem boss em campo, esta chamada sai na primeira linha. */
    this.boss.comoAlvo(alvos);
    /* O MUNDO vai junto: é dele que sai `propsNear`, e é isso que faz a bola
       de ki parar na pedra em vez de atravessá-la. */
    const eventos = this.powers.update(dt, alvos, this.myId, this.world);
    this.reportar(eventos);

    /* ------------------------------------------------------------ cena ---- */
    this.fx.update(dt, this.camera3.position);
    /* O BOSS depois dos poderes e antes do mundo: ele interpola a posição que a
       sala mandou, move o corpo e caminha a barra do HUD. Sem boss em campo é
       uma comparação e um `return`. */
    this.boss.update(dt, this.camera3.position);

    /* ------------------------------------------------- AS CENAS DO BOSS ----
     *
     * *"Todos os players veem a câmera com foco no Freeza e a câmera sai de foco
     * dos players, como se fosse uma apresentação de um jogo… Após essa cena
     * cinemática, a câmera volta ao normal do player."*
     *
     * Uma linha, e a câmera do jogo continua não sabendo que isto existe — ver o
     * §1 de `boss/cine.js` para por que a cena não virou um modo dela.
     *
     * **A POSIÇÃO NA FILA É O DETALHE QUE IMPORTA**, e ela custou uma medição
     * para ficar certa. A cena precisa acontecer entre duas coisas:
     *
     * • DEPOIS de `boss.update`, porque é ele que move o corpo interpolado. Com
     *   a cena antes, a lente enquadrava a posição do QUADRO ANTERIOR e o corpo
     *   era desenhado na deste — medido, o boss saía 30 % da tela fora do centro
     *   durante a chegada, que é justamente quando ele voa mais rápido;
     * • e ANTES de `world.update` e do HUD, que leem `camera3.position` para
     *   decidir nível de detalhe e projeção — deixá-los com a lente do jogador
     *   enquanto se renderiza da lente da cena faria o cenário perto do boss
     *   aparecer no detalhe de duzentos metros.
     *
     * A `NamekCamera` continua rodando normalmente lá em cima: é dela que a
     * mistura da cena parte, e é para ela — viva, já acompanhando o jogador —
     * que a rampa de saída volta. */
    const emCena = this.boss.passoDaCine(dt, this.cam);
    if (this._emCena && !emCena) {
      /* A CENA DEVOLVEU A LENTE. `invalidarLente` existe por causa de um cache:
         a câmera do jogo só reescreve o campo de visão quando o número que ELA
         calcula muda, e a cena fechou a lente para 46° pelas costas dela. Sem
         esta linha o jogo continuaria com a teleobjetiva da apresentação. */
      this.cam.invalidarLente();
    }
    this._emCena = emCena;

    /* O fim ANTES do mundo: `setFim` decide se o planeta ainda é desenhado, se o
       céu é o de estrelas e quanto o chão já rachou — e `world.update` é quem
       caminha tudo isso. Invertido, o cenário mostraria a fase anterior. */
    this.world.setFim(this.fim);
    this.world.update(dt, this.camera3.position, agora);

    /* A câmera JÁ foi atualizada, lá em cima, antes do disparo — ver o
       comentário longo lá. Havia uma segunda chamada aqui, sobra da ordem
       antiga: ela rodava o amortecimento duas vezes por quadro, o que dobrava
       na prática a rigidez de toda constante de suavização da lente. */

    /* ------------------------------------------------------------- HUD ---- */
    /* **DURANTE UMA CENA, O HUD DE MIRA SAI DA TELA.**
     *
     * A bússola, os anéis de alvo, o retículo e o painel de vida do alvo são
     * todos desenhados a partir de uma projeção — e a projeção é a da câmera,
     * que durante a chegada e a morte do boss está a dezessete metros dele, do
     * outro lado da arena. Deixá-los ligados produz o pior tipo de defeito
     * visual: elementos que PARECEM corretos, apontando para lugares que não
     * têm nada a ver com o que está na tela.
     *
     * E o pedido é explícito sobre o que a cena tem de ser: *"como se fosse uma
     * apresentação de um jogo"*. Apresentação de jogo não tem retículo.
     *
     * O que FICA é a barra de vida do boss, a do jogador e o placar: eles não
     * projetam nada, são canto de tela, e sumir com a barra do chefe justamente
     * no quadro em que ele é apresentado seria o contrário do que a cena quer
     * dizer. */
    const cena = this._emCena === true;
    /* A BÚSSOLA vem depois da câmera e antes do resto do HUD: ela projeta pela
       lente deste quadro, e a lente acabou de ser resolvida lá em cima. */
    this.hud.setMarcas(cena ? VAZIO : this.bussola());
    /* Os círculos de todo mundo, e o aceso é para onde o tiro vai. A lista é a
       MESMA projeção que escolheu o alvo da assistência — ver
       `LockOn.naTelaTodos`, que existe justamente para o anel aceso e o alvo do
       tiro nunca discordarem. */
    this.hud.setAneis(cena ? VAZIO : this.lock.naTelaTodos);

    /* O TETO DE VIDA É VARIÁVEL desde o Super Saiyajin: 100 normalmente, 160
       transformado (`NAMEK.ssj.vidaBonus`). Passá-lo em vez de `maxHealth` é o
       que faz a barra desenhar a fração certa — com o teto fixo, quem se
       transforma apareceria com 90 numa barra de 100 e o preenchimento bateria
       no fim aos 100 de 160. Ver `vidaMaxima`, e a gêmea dela na sala. */
    this.hud.setVitals(this.health, vidaMaxima(this.ssj.aceso), this.ki.valor, this.ki.max);
    this.hud.setSpecials(this.specialIndex, this.ki.podeEspecial());
    /* O retículo tem dois estados agora, e não três: o "travado" era o do alvo
       preso pela tecla `R`. Ver `NamekHud.setCrosshair`. */
    this.hud.setCrosshair(cena ? "oculto" : this.ki.carregando ? "carregando" : "livre");
    /* O PAINEL DE VIDA DO ALVO — um widget, duas razões (você acertou alguém, ou
       o cursor está em cima de alguém). Quem escolhe é `LockOn.noPainel`; aqui
       só se traduz o id em nome, cor e vida. Ver `dadosDoAlvo`. */
    this.hud.setTarget(cena ? null : this.dadosDoAlvo());
    this.hud.update(dt);

    /* --------------------------------------------------- a tela do fim ---- */
    this.telaDoFim(dt);

    /* Os sons CONTÍNUOS. Um só lugar, uma vez por quadro: carga, feixe e vento
       são estados, não acontecimentos, e tratá-los como evento produziria um
       `play()` por quadro. */
    const v = c.velocity;
    this.audio.update({
      carregando: this.ki.carregando,
      /* SÓ O KAMEHAMEHA ACENDE O RUGIDO. `casting` cobre a pose de qualquer
         especial, e a pose dos outros três dura `windup + SOLTURA` — ou seja,
         durante os 0,45 s de soltura do Galick, do Kienzan e da Genki Dama esta
         condição era verdadeira e o loop do FEIXE tocava por cima de um golpe
         que não é feixe nenhum. Três golpes emprestando o timbre de um quarto é
         exatamente o que o pedido de "timbres distintos" proíbe. */
      feixeAceso:
        this.casting !== null &&
        this.casting.kind === "kamehameha" &&
        this.casting.t >= specialInfo(this.casting.kind).windup,
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
      /* O BOSS, pelo canal dele. Mesmo desvio do peixe logo abaixo e pelo mesmo
         motivo: a sala procura um LUTADOR pelo id do `BLAST_HIT`, e o Freeza não
         é um. `acertou` devolve true quando a vítima era ele — e nesse caso já
         mandou o aviso e desenhou a fagulha. */
      if (this.boss.acertou(a.victim, "blast", 0, a.p)) continue;
      /* O PEIXE GIGANTE entra na mesma lista de alvos que as pessoas (ver o
         bloco de `alvos` no `step`), e é aqui que os dois caminhos se separam:
         a sala procura um LUTADOR pelo id do `BLAST_HIT`, e o peixe não é um.
         Mandar o aviso pelo canal certo é a diferença entre o bicho perder vida
         e o pacote morrer em silêncio do outro lado. */
      if (a.victim === PEIXE_ALVO_ID) {
        this.net.send(NC2S.FISH_HIT, { i: this.world.peixe?.salto?.i, kind: "blast" });
        this.world.peixe?.levouGolpe(a.p.x, a.p.y, a.p.z);
        this.audio.acertoNoCorpo(a.p, false, a.victim);
        continue;
      }
      this.net.send(NC2S.BLAST_HIT, {
        id: a.blastId,
        victim: a.victim,
        p: [a.p.x, a.p.y, a.p.z],
      });
      this.fx.bodyHit(a.p.x, a.p.y, a.p.z, 0xbfe8ff);
      this.audio.acertoNoCorpo(a.p, false, a.victim);
    }

    for (const q of ev.queimando) {
      /* O BOSS, com o `dt` junto: o Kamehameha cobra por segundo de exposição e
         é esse número que a tabela `NAMEK.freeza.dano` multiplica. */
      /* Sem ponto: a fila `queimando` não carrega um (ver `PowerSystem`), e não
         precisa — o único alvo possível é o boss, e `acertou` usa o peito dele. */
      if (this.boss.acertou(q.victim, q.kind, q.dt, null)) continue;
      /* O mesmo desvio do laço acima, com o `dt` junto: um feixe cobra por
         segundo de exposição, e é esse número que vira dano no peixe. */
      if (q.victim === PEIXE_ALVO_ID) {
        this.net.send(NC2S.FISH_HIT, {
          i: this.world.peixe?.salto?.i,
          kind: q.kind,
          dt: q.dt,
        });
        continue;
      }
      this.net.send(NC2S.SPECIAL_HIT, { victim: q.victim, kind: q.kind, dt: q.dt });
      /* O SOM DE QUEIMAR ALGUÉM. Este era o único canal de acerto do jogo que
         ia inteiro para a rede sem fazer barulho na ponta de quem atirou:
         segurar um Kamehameha em cima de um adversário por dois segundos
         devolvia, no máximo, o "toc" genérico do `HURT` dele voltando. A posição
         é a do corpo queimado — o feixe não sabe onde a vítima está, mas o
         `remotes` sabe, e é a mesma pose que o acerto normal já usa. */
      const alvo = this.remotes.get(q.victim);
      if (alvo) this.audio.queimouAlguem(alvo.pose, q.kind, q.victim);
    }

    /* O ESTOURO NO AR. Ele não abre cratera — não há chão — e por isso não passa
       por `ev.chao`; sem esta fila, uma Genki Dama detonando a duzentos metros
       de altura era a maior coisa que o modo desenha acontecendo em silêncio. */
    for (const a of ev.noAr) {
      this.audio.detonouNoAr(a.p, a.power, a.kind);
    }

    /* O EMBATE — dois poderes que se encostaram (§6 de `powers/index.js`).
     *
     * O registro faz DUAS coisas, e é por isso que o laço tem dois `if`:
     *
     * • **`cancelar`** encerra a pose do especial que foi anulado. Ele existe
     *   porque o relógio da pose é DAQUI (`this.casting`), não do feixe: sem
     *   isto, o lutador ficaria parado no ar terminando a animação de um
     *   Kamehameha que já não existe, travado (`controller.travado`) até o
     *   relógio vencer sozinho. A barra não volta, e não deve — ela foi gasta no
     *   instante do disparo, e é isso que faz o choque de duas cargas custar
     *   alguma coisa aos dois lados.
     * • **`enviar`** conta à sala, que confirma para todo mundo. Só sobe o que
     *   ESTE cliente detectou; o que chegou pela rede é aplicado e cala. Sem
     *   essa distinção, cada confirmação recebida geraria uma confirmação nova e
     *   o mesmo embate ricochetearia pela sala para sempre. */
    for (const e of ev.embates) {
      if (e.cancelar) {
        this.casting = null;
        this.hud.toast("golpe anulado no choque");
      }
      if (!e.enviar) continue;
      this.net.send(NC2S.POWER_CLASH, {
        a: e.aOwner,
        ka: e.aKind,
        b: e.bOwner,
        kb: e.bKind,
        p: [e.p.x, e.p.y, e.p.z],
        /* O único bit que a tabela não consegue deduzir dos tipos: dois
           Kamehamehas podem se encontrar como bolas de carga (explosão própria,
           regra 4) ou como feixes em voo (o estouro de sempre). */
        c: e.carga ? 1 : 0,
      });
    }

    /* O TREMOR do quadro, se houve. É do MEU golpe (o sistema só o relata para
       quem é dono), pelo mesmo motivo da luz: a lente é uma só e ela é minha. */
    if (ev.abalo && ev.abalo.forca > 0) {
      this.cam.shake(ev.abalo.forca, ev.abalo.dur);
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
      this.audio.estouroNoChao(g.p, g.power, g.kind);
      this.derrubarPorPerto(g.p, g.power, g.fundo);
      /* Só o que é forte o bastante pede BURACO; o resto marca e some. Ver
         `craterMinPower` — sem o corte, a rajada consumia a fila inteira de 96
         crateras em pouco mais de um segundo e a destruição que importa apagava
         na frente do jogador. */
      if (g.power >= NAMEK.destruction.craterMinPower) {
        this.net.send(NC2S.GROUND_HIT, {
          p: [g.p.x, g.p.y, g.p.z],
          power: g.power,
          /* O multiplicador de fundura. Só sobe quando não é 1, que é o caso de
             quase todo golpe — ver `craterFor`, que é quem o interpreta e o
             apara. É ele que faz o Kamehameha perfurar em vez de amassar. */
          df: g.fundo !== 1 ? g.fundo : undefined,
        });
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
    if (this._onMenu) document.removeEventListener(EVENTO_MENU, this._onMenu);
    this._offParticles?.();
    this.net.disconnect();
    this.input.dispose();
    this.hud.dispose();
    this.fugaHud.dispose();
    this.menu.dispose();
    this.audio.dispose();
    this.remotes.dispose();
    this.boss.dispose();
    this.powers.dispose();
    this.fx.dispose();
    this.world.dispose();
    this.me.dispose();
    this.renderer.dispose();
  }
}
