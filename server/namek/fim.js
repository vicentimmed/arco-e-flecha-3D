/* ---------------------------------------------------------------------------
   O FIM DE NAMEKUSEI — a máquina de estados do planeta morrendo.

   O pedido, inteiro e em ordem: *"quando entrar no modo que namecusei vai
   explodir, o Freeza deve entrar. Depois de matar o Freeza entra uma contagem de
   1 minuto para o planeta explodir. Se o planeta explodir com eles dentro todos
   os players morrem. Mas se eles voarem em direção ao céu por pelo menos 30
   segundos eles saem do planeta e entram no espaço… Uma vez no espaço eles podem
   continuar lutando ali se quiserem."*

   ------------------------------------------------------------------ as fases

       calmo ──(clima = tempestade)──▶ freeza ──(o Freeza morre)──▶ contagem
         ▲                               │                             │
         │                               │                             │ 60 s
         │                               │                             ▼
         │                               │                        explodindo
         │        (clima = dia, de qualquer fase)                       │ 6 s
         └───────────────────────────────┴─────────────────────────  espaco

   `calmo` é o jogo de sempre. `freeza` é a tempestade com o vilão em campo.
   `contagem` é o minuto final, e é a ÚNICA fase em que a fuga existe: o teto de
   voo sobe e o portal acende no céu. `explodindo` são os seis segundos do
   espetáculo — quem não escapou já morreu no primeiro quadro dela. `espaco` é o
   jogo continuando sem chão.

   **A fuga é só altitude.** Não há relógio pessoal, não há acúmulo, não há
   estado por jogador: a cada quadro se pergunta se o corpo está dentro da esfera
   do portal, e é só. O único relógio do fim é o do planeta, e ele é o mesmo para
   todo mundo — é por isso que `FIM_CONTAGEM` é uma mensagem em broadcast e não
   uma por destinatário. Ver `NAMEK.fim.fuga`.

   ------------------------------------------------------------- quem manda aqui

   A SALA, e só ela. O §8 do plano divide autoridade assim: o cliente é dono da
   própria pose, a sala é dona de vida, morte, renascimento e clima. Escapar do
   planeta é uma morte que não aconteceu — cabe deste lado por definição, e é por
   isso que **nada neste arquivo lê uma mensagem do cliente**. A fuga é medida na
   POSIÇÃO que a pose de 20 Hz já carrega, e o cliente só recebe o resultado.

   ------------------------------------------------------ o contrato com o Freeza

   O boss é de outro arquivo (`server/namek/freeza.js`), e este aqui fala com ele
   por quatro coisas e mais nada:

       sala.freeza.entrar(dificuldade)   põe o boss em campo (devolve false
                                         quando não há ninguém para lutar)
       sala.freeza.sair()                tira, sem morte e sem `aoMorrer`
       sala.freeza.vivo                  ele está em campo?
       sala.freeza.aoMorrer = (agora)=>  chamado quando ele cai

   **As chamadas continuam com `?.`** mesmo agora que `NamekRoom` constrói o boss
   no próprio construtor. Não é desconfiança do módulo vizinho: é que este
   arquivo é o dono do FIM DO PLANETA, e um fim de planeta que só funciona
   enquanto um segundo módulo estiver instalado é um fim de planeta que quebra na
   primeira vez que alguém quiser rodar a sala sem boss (o banco de provas, uma
   sala de teste, uma bifurcação do modo). `freeza.esperaMax` é o plano B para
   esse caso: sem `sala.freeza` nenhum, a contagem começa sozinha e a tempestade
   não vira um beco sem saída. Com o boss instalado — que é o caso hoje — a linha
   nunca dispara, porque o objeto existe desde o primeiro quadro.

   Além do `aoMorrer`, a morte também é observada por BORDA (`vivo` caindo de
   verdadeiro para falso). Não é redundância desconfiada: são dois contratos
   diferentes com o mesmo objeto, e o que não pode acontecer é o planeta ficar
   preso na fase `freeza` para sempre porque o outro lado preferiu um deles — ou
   porque alguém chamou `freeza.morrer()` por um caminho que não passa pelo
   callback.
   --------------------------------------------------------------------------- */

import { NAMEK } from "../../src/shared/namek/config.js";
import { NS2C } from "../../src/shared/namek/protocol.js";

/** As fases, escritas uma vez. O cliente compara contra as MESMAS strings. */
export const FASE = {
  CALMO: "calmo",
  FREEZA: "freeza",
  CONTAGEM: "contagem",
  EXPLODINDO: "explodindo",
  ESPACO: "espaco",
};

/** ms — de quanto em quanto tempo o relógio da contagem é reafirmado. */
const TIQUE = 1000;

const round = (v) => Math.round(v * 1000) / 1000;
const round1 = (v) => Math.round(v * 10) / 10;

/* NÃO HÁ ENVIO PARA UMA CONEXÃO SÓ neste arquivo, e a ausência tem história.
 *
 * O `FIM_CONTAGEM` era pessoal: além do relógio do planeta ele levava os
 * segundos de subida DAQUELE jogador, então saía uma mensagem por destinatário
 * e este módulo precisava de um `enviar(conn, msg)` próprio (o `send` de
 * `room.js` é função de módulo e não é exportada).
 *
 * Com a fuga virando altitude pura, o relógio de subida sumiu — e com ele o
 * único dado do fim que era diferente para cada um. Sobrou o relógio do planeta,
 * que é o mesmo para todo mundo, e `sala.broadcastAll` já sabe mandá-lo: uma
 * serialização por segundo em vez de quinze, e um caminho de saída a menos para
 * manter. */

export class NamekFim {
  /** @param {import("./room.js").NamekRoom} sala */
  constructor(sala) {
    this.sala = sala;

    /** @type {string} uma de `FASE`. */
    this.fase = FASE.CALMO;
    /** ms — o que falta no relógio da fase corrente. 0 quando ela não tem um. */
    this.relogio = 0;
    /** ms — quando o próximo `FIM_CONTAGEM` sai. */
    this.proximoTique = 0;

    /** Ids de quem já está no espaço. **O único estado por jogador do fim** —
     *  e ele é um conjunto de ids, não um relógio: a fuga é geometria. */
    this.escapados = new Set();

    /* O Freeza, observado por borda. `null` enquanto nunca foi visto — é o que
       separa "ele ainda não entrou" de "ele entrou e morreu". */
    this._freezaVivo = null;
    /** s — desde que a tempestade começou. Alimenta a entrada e o plano B. */
    this._desdeATempestade = 0;
    /** Já mandamos ele entrar nesta tempestade? */
    this._chamado = false;

    /* O ponto do portal e o de nascimento no espaço: os dois são reaproveitados
       entre quadros, porque `resumo()` e `nascimento()` saem uma vez por
       mensagem e alocar um literal por chamada é o tipo de lixo que o §3 do
       plano cobra. */
    this._portal = { x: 0, y: NAMEK.fim.fuga.altitude, z: 0 };
    this._nasce = { x: 0, y: NAMEK.fim.espaco.altura, z: 0 };
  }

  /* ================================================================ leitura == */

  /** A sala inteira já está sem planeta? */
  get noEspaco() {
    return this.fase === FASE.ESPACO;
  }

  /**
   * Já não há chão em que pôr ninguém.
   *
   * Diferente de `noEspaco` por seis segundos — os da explosão —, e a diferença
   * importa exatamente uma vez: um bot posto em campo durante o espetáculo
   * nasceria em cima de um planeta que está afundando. Ver `NamekRoom.addBot`.
   */
  get semChao() {
    return this.fase === FASE.ESPACO || this.fase === FASE.EXPLODINDO;
  }

  /** A fuga está aberta: teto alto, portal aceso, relógio correndo. */
  get fugaAberta() {
    return this.fase === FASE.CONTAGEM;
  }

  /** Este lutador está no espaço (escapou, ou renasceu lá depois do fim)? */
  estaNoEspaco(f) {
    return this.fase === FASE.ESPACO || this.escapados.has(f?.id);
  }

  /**
   * m — o teto que `registrarPose` deve aceitar.
   *
   * A validação da pose recusa quem está acima do teto de voo mais uma folga, e
   * isso é uma defesa contra lixo de rede — não contra este modo. Sem passar por
   * aqui, a primeira pose de quem sobe atrás do portal (a 1 700 m, contra um teto
   * de 520) seria descartada, e o lutador ficaria congelado no céu de todo mundo
   * enquanto o próprio cliente continuaria subindo. É o pior defeito possível:
   * silencioso, e exatamente no momento que o modo inteiro existe para produzir.
   */
  tetoDePose() {
    const F = NAMEK.fim;
    const topoDaBolha = F.espaco.altura + F.espaco.raio;
    if (this.semChao) return topoDaBolha;
    /* Durante a CONTAGEM valem os dois tetos ao mesmo tempo: quem ainda está no
       planeta não passa de `fuga.teto`, e quem já atravessou o portal está na
       bolha, que é mais alta. O teto da validação é o maior dos dois assim que
       existir alguém lá em cima — apertá-lo antes disso não protege nada e
       descartaria, em silêncio, a primeira pose de quem acabou de escapar. */
    if (this.fase === FASE.CONTAGEM) {
      return this.escapados.size ? topoDaBolha : F.fuga.teto;
    }
    return NAMEK.world.ceiling;
  }

  /**
   * O ponto de nascimento no espaço, ou `null` quando ainda há planeta.
   *
   * Sorteado numa esfera em torno do centro da bolha, e não numa casca: nascer
   * sempre à mesma distância do meio seria nascer num anel, e um anel de quinze
   * lutadores é um cardume. O `∛` no raio é o mesmo argumento do `√` de
   * `pickSpawn`, uma dimensão acima — sem ele o sorteio se acumula no centro,
   * porque o volume de uma casca cresce com o cubo do raio.
   */
  nascimento() {
    if (this.fase !== FASE.ESPACO && this.fase !== FASE.EXPLODINDO) return null;
    const E = NAMEK.fim.espaco;
    const u = Math.random() * 2 - 1;
    const ang = Math.random() * Math.PI * 2;
    const r = E.nascimento * Math.cbrt(Math.random());
    const plano = Math.sqrt(1 - u * u);
    this._nasce.x = Math.cos(ang) * plano * r;
    this._nasce.y = E.altura + u * r;
    this._nasce.z = Math.sin(ang) * plano * r;
    return this._nasce;
  }

  /** O que viaja no `welcome` e no `NS2C.FIM_ESTADO`. */
  resumo() {
    return {
      fase: this.fase,
      w: this.sala.now(),
      restante: Math.max(0, Math.round(this.relogio)),
      portal: [this._portal.x, this._portal.y, this._portal.z],
      teto: this.tetoDePose(),
      escapados: [...this.escapados],
    };
  }

  /* ================================================================ ganchos == */

  /**
   * O clima mudou — e é ELE que liga e desliga o fim inteiro.
   *
   * `tempestade` já era, por escrito, *"o planeta indo embora… é a batalha contra
   * Freeza nos cinco minutos finais"* (§1 do plano). Pendurar o Freeza nela é o
   * que faz o botão que já existe no menu significar o que ele sempre disse que
   * significava — e voltar para `dia` é o botão de desistir, que precisa existir
   * porque a alternativa seria uma sala que, uma vez virada, nunca mais volta.
   *
   * Chamado por `NamekRoom.pedirClima` **depois** da retransmissão, e só quando o
   * clima de fato mudou: a carência de `weather.fade` já filtrou o clique
   * repetido lá, e duplicá-la aqui daria duas travas para o mesmo botão.
   */
  clima(id, agora) {
    if (id === "tempestade") {
      if (this.fase !== FASE.CALMO) return;
      this.fase = FASE.FREEZA;
      this.relogio = 0;
      this._desdeATempestade = 0;
      this._chamado = false;
      this._freezaVivo = null;
      this.sala.log("namek — o fim começou: o céu fechou, o Freeza está a caminho");
      this.anunciar(agora);
      return;
    }
    if (id !== "dia" || this.fase === FASE.CALMO) return;

    /* O CÉU ABRIU DE NOVO — e o que isso desfaz depende de até onde tinha ido.
     *
     * De `freeza` ou `contagem`, basta parar: o Freeza sai, o relógio zera, o
     * teto volta a 520 m e ninguém sequer chegou a morrer. De `explodindo` ou
     * `espaco` não há mais planeta debaixo de ninguém, então o retorno tem de
     * TRAZER todo mundo de volta ao chão — senão a sala ficaria com quinze
     * lutadores boiando a dois quilômetros de altura sobre um planeta que voltou
     * a existir, cada um deles fora do teto de voo que acabou de encolher. */
    const voltandoDoEspaco = this.fase === FASE.EXPLODINDO || this.fase === FASE.ESPACO;
    this.pararFreeza();
    this.fase = FASE.CALMO;
    this.relogio = 0;
    this.escapados.clear();
    this.sala.log("namek — o fim foi desfeito: o planeta continua");
    this.anunciar(agora);
    if (voltandoDoEspaco) {
      /* `todos()` são os jogadores e os bots — o boss não está nele, e não devia
         estar: quem o tira de campo é `pararFreeza`, logo acima. */
      for (const f of this.sala.todos()) this.sala.nascer(f, agora);
    }
  }

  /** Alguém saiu da sala: some do conjunto de escapados.
   *
   *  **Não há mais nada a limpar.** Havia aqui um segundo `delete` num mapa de
   *  relógios de subida; a fuga virou geometria e o mapa deixou de existir. */
  saiu(f) {
    if (!f) return;
    this.escapados.delete(f.id);
  }

  /** Sala vazia: o planeta é zerado e o fim junto. Ver `NamekRoom.handleClose`. */
  zerar() {
    this.pararFreeza();
    this.fase = FASE.CALMO;
    this.relogio = 0;
    this.escapados.clear();
    this._freezaVivo = null;
    this._chamado = false;
  }

  /* ================================================================== passo == */

  /**
   * Um quadro do fim. Chamado por `NamekRoom.passo`, DEPOIS de `montarCorpos` —
   * a fuga é medida na lista uniforme, que é onde a posição de humano, de bot e
   * do boss já está no mesmo formato.
   */
  passo(dt, agora) {
    switch (this.fase) {
      case FASE.FREEZA:
        this.passoDoFreeza(dt, agora);
        break;
      case FASE.CONTAGEM:
        this.passoDaContagem(dt, agora);
        break;
      case FASE.EXPLODINDO:
        this.relogio -= dt * 1000;
        if (this.relogio <= 0) {
          this.relogio = 0;
          this.fase = FASE.ESPACO;
          this.sala.log("namek — o planeta acabou: a briga continua no espaço");
          this.anunciar(agora);
        }
        break;
      default:
        break;
    }
  }

  /** A tempestade correndo: chamar o Freeza, e esperar que alguém o mate. */
  passoDoFreeza(dt, agora) {
    const F = NAMEK.fim.freeza;
    this._desdeATempestade += dt;

    if (!this._chamado && this._desdeATempestade >= F.entrada) {
      /* O `?.` é por CONTRATO e não por desconfiança — ver o cabeçalho: a sala
         constrói o boss hoje, e o fim do planeta não pode depender disso para
         existir. */
      if (this.sala.freeza?.entrar) {
        let entrou = false;
        try {
          /* SEM ARGUMENTO. `entrar(dificuldade)` aceita um id do vocabulário
             DELE (`NAMEK.freeza.dificuldadeOrdem`), que não é o dos bots — e
             passar "medio" ali faria o boss cair no padrão dele toda vez que uma
             tempestade começasse, desfazendo em silêncio o nível que alguém
             tivesse escolhido no menu. A dificuldade do boss é de quem a
             configura; o que este arquivo decide é QUANDO ele entra. */
          entrou = this.sala.freeza.entrar() !== false;
        } catch (err) {
          this.sala.log(`namek — o Freeza não entrou: ${err?.message ?? err}`);
        }
        /* O `_chamado` só trava depois do SUCESSO. `entrar()` recusa quando não
           há ninguém em campo (um boss sozinho é CPU queimada para ninguém), e
           travar na recusa deixaria a tempestade sem vilão para sempre — a fase
           `freeza` esperando uma morte que nunca poderia acontecer. */
        if (entrou) {
          this._chamado = true;
          /* O aviso de morte, ligado DEPOIS de `entrar` — quem constrói o vilão
             pode escrever o próprio `aoMorrer` lá dentro, e sobrescrevê-lo aqui
             é o que garante que a contagem é nossa. A borda de `vivo`, logo
             abaixo, é a rede de segurança para o caso de ele nunca chamar
             ninguém. */
          this.sala.freeza.aoMorrer = () => this.freezaMorreu(this.sala.now());
          this.sala.log("namek — o Freeza entrou: matem-no e o relógio começa");
        }
      }
    }

    /* A BORDA DE `vivo` — a rede de segurança do `aoMorrer`.
     *
     * O caminho normal é o callback, e hoje ele é confiável (`NamekFreeza.morrer`
     * o chama dentro de um `try`). Esta borda cobre o caso em que o boss cai por
     * um caminho que não passa por lá.
     *
     * **Ela não confunde `sair()` com morrer**, e a defesa é o `_freezaVivo`:
     * `pararFreeza` — o único lugar deste arquivo que chama `sair()` — o zera
     * antes, e a fase já saiu de `freeza` quando isso acontece, então este
     * método nem chega a rodar. Sem essa trava, virar o clima para `dia` tiraria
     * o boss de campo e a queda dele seria lida como vitória: o planeta
     * começaria a contagem no exato momento em que alguém desistiu dela. */
    const vivo = this.sala.freeza?.vivo;
    if (vivo === true) this._freezaVivo = true;
    else if (this._freezaVivo === true && vivo === false) {
      this.freezaMorreu(agora);
      return;
    }

    /* O PLANO B. Sem `sala.freeza` nenhum, a tempestade levaria a lugar nenhum —
       e o fim do planeta seria código que nunca roda. Com o vilão instalado esta
       linha jamais dispara, porque o objeto existe desde o primeiro quadro. */
    if (!this.sala.freeza && this._desdeATempestade >= F.esperaMax) {
      this.sala.log("namek — sem Freeza nesta sala: a contagem começa sozinha");
      this.freezaMorreu(agora);
    }
  }

  /** O vilão caiu. É o instante em que o relógio do planeta começa a correr. */
  freezaMorreu(agora = this.sala.now()) {
    if (this.fase !== FASE.FREEZA) return;
    this.fase = FASE.CONTAGEM;
    this.relogio = NAMEK.fim.contagem * 1000;
    this.proximoTique = 0;
    this.sala.log(`namek — o Freeza morreu: ${NAMEK.fim.contagem} s para o fim`);
    this.anunciar(agora);
  }

  /**
   * O minuto final: o relógio anda, e quem chega ao portal sai do planeta.
   *
   * A ordem importa. A fuga é resolvida ANTES do decremento porque o quadro em
   * que o relógio chega a zero é o quadro em que a explosão acontece — e quem
   * entrou no portal naquele mesmo quadro escapou, não morreu. Um empate no
   * último décimo de segundo tem de cair para o lado de quem estava subindo.
   */
  passoDaContagem(dt, agora) {
    this.medirFugas(agora);

    this.relogio -= dt * 1000;
    if (this.relogio <= 0) {
      this.relogio = 0;
      this.explodir(agora);
      return;
    }

    if (agora >= this.proximoTique) {
      this.proximoTique = agora + TIQUE;
      this.baterORelogio();
    }
  }

  /**
   * Quem já está dentro da boca do portal.
   *
   * **É a fuga inteira**, e ela cabe num teste de esfera: *"a fuga é baseada
   * somente em metros mesmo — ele tem que sair do planeta antes que ele
   * exploda."* Não há relógio pessoal, não há acúmulo e não há estado por
   * jogador — quem decide é onde o corpo está agora, e o único cronômetro é o do
   * planeta.
   *
   * ------------------------------------------------------------ quem NÃO escapa
   *
   * Três exclusões, e cada uma é uma regra e não uma defesa:
   *
   * • **Bots.** A física deles (`server/namek/bots.js`) é integrada contra
   *   `NAMEK.world.ceiling` e contra o campo de altura, sem passar pelo `regime`
   *   que este modo reescreve — um bot no espaço voaria contra um chão que já
   *   não existe, atrás de um teto que já subiu. São criaturas do planeta e vão
   *   embora com ele.
   * • **O BOSS.** O corpo do Freeza entra na mesma lista uniforme (ele precisa
   *   estar lá para os bots o enxergarem), e ele entra de cima e ALTO — ver
   *   `NamekFreeza.entrar`. Sem esta linha, um boss que subisse até a boca do
   *   portal seria tratado como um jogador que escapou: entraria no conjunto de
   *   escapados, sairia no `FIM_ESTADO` para todo mundo e a sala tentaria
   *   teleportá-lo com `f.state.p`, que no espantalho dele é `null`. O `boss` é
   *   a marca que ele mesmo põe no corpo (`freeza.js`), e ela existe justamente
   *   para os sistemas que não o conhecem poderem pulá-lo.
   * • **Quem já escapou**, que não tem para onde escapar de novo.
   */
  medirFugas(agora) {
    const F = NAMEK.fim.fuga;
    const raio2 = F.raio * F.raio;

    for (const c of this.sala.corpos) {
      if (c.isBot || c.boss || !c.alive) continue;
      if (this.escapados.has(c.id)) continue;

      /* Dentro da boca. A esfera é o "lugar para onde eles têm que voar" do
         pedido, e ela é a MESMA que o portal desenha no céu (`world/fuga.js` lê
         `altitude` e `raio` daqui) — a coisa que se vê e a coisa que conta não
         podem ser dois números. */
      const dx = c.x - this._portal.x;
      const dy = c.y - this._portal.y;
      const dz = c.z - this._portal.z;
      if (dx * dx + dy * dy + dz * dz > raio2) continue;

      this.escapar(c.ref, agora);
    }
  }

  /** Tira alguém do planeta e o põe na bolha do espaço. */
  escapar(f, agora) {
    if (!f || this.escapados.has(f.id)) return;
    this.escapados.add(f.id);

    const p = this.nascimentoDeQuemEscapa();
    /* O corpo do QUADRO EM CURSO vai junto: a lista uniforme já foi montada, e
       deixá-la com a posição velha faria o resto do passo (onda, lava, mar)
       procurar este lutador no lugar de onde ele acabou de sair. */
    const corpo = this.sala.corpoPorId.get(f.id);
    if (corpo) {
      corpo.x = p.x;
      corpo.y = p.y;
      corpo.z = p.z;
    }
    /* A pose guardada também: ela é o que a sala responde quando alguém pergunta
       onde este lutador está (`pontoDe`), e ela só seria reescrita no próximo
       pacote de 20 Hz — 50 ms em que o afogamento e a lava ainda o veriam no
       chão de onde ele saiu. */
    if (f.state?.p) {
      f.state.p[0] = round(p.x);
      f.state.p[1] = round(p.y);
      f.state.p[2] = round(p.z);
      /* E o CARIMBO junto. `broadcastStates` manda `w: f.stateTime`, e o buffer
         de interpolação do outro lado usa esse instante para decidir onde o
         corpo estava: com a posição nova e o carimbo velho, os outros clientes
         desenhariam o salto para o espaço como se ele tivesse acontecido cem
         milissegundos atrás — que é o mesmo que desenhá-lo em nenhum lugar. */
      f.stateTime = agora;
    }
    /* Escapar não é renascer: a vida, o ki e o placar continuam como estavam. O
       que muda é o endereço. O `afogando` zera porque ele é um relógio de lugar,
       e o lugar mudou. */
    f.afogando = 0;

    this.sala.broadcastAll({
      t: NS2C.FIM_ESCAPOU,
      id: f.id,
      p: [round(p.x), round(p.y), round(p.z)],
      w: agora,
    });
    this.sala.log(`namek — ${f.name} escapou do planeta`);
  }

  /**
   * Onde alguém aparece ao atravessar o portal.
   *
   * Perto do FUNDO da bolha e não no meio dela: quem sobe atravessando um rasgo
   * de luz tem de emergir do lado de baixo do espaço, com o planeta ainda debaixo
   * dos pés. Aparecer no centro seria ser teleportado para o meio do nada.
   */
  nascimentoDeQuemEscapa() {
    const E = NAMEK.fim.espaco;
    const ang = Math.random() * Math.PI * 2;
    const r = E.nascimento * 0.35 * Math.sqrt(Math.random());
    this._nasce.x = Math.cos(ang) * r;
    this._nasce.y = E.altura - E.raio * 0.55;
    this._nasce.z = Math.sin(ang) * r;
    return this._nasce;
  }

  /**
   * O planeta explode. **Quem estiver nele morre.**
   *
   * "Se o planeta explodir com eles dentro todos os players morrem… os que ainda
   * permanecerem no planeta e não conseguirem fugir morrem (depois eles
   * reaparecem no espaço)."
   *
   * Os bots saem ANTES das mortes, e não depois: eles são do planeta (ver
   * `medirFugas`), e matá-los para em seguida removê-los produziria um `DEATH` e
   * um `LEAVE` para o mesmo corpo, na mesma centésima de segundo, com o placar
   * piscando no meio.
   */
  explodir(agora) {
    this.fase = FASE.EXPLODINDO;
    this.relogio = NAMEK.fim.explosao.duracao * 1000;

    if (this.sala.bots?.count) this.sala.clearBots();

    const mortos = [];
    for (const f of [...this.sala.players.values()]) {
      if (this.escapados.has(f.id)) continue;
      if (!f.alive) continue;
      mortos.push(f.id);
      /* Sem culpado, como a lava, o mar e a queda: não há quem premiar por um
         planeta que acabou. A direção é para BAIXO porque a explosão vem de
         dentro do chão — é ela que joga o corpo para o lado certo. */
      this.sala.matar(f, null, "planeta", this.sala.pontoDe(f), [0, -1, 0], agora);
    }

    this.sala.broadcastAll({
      t: NS2C.FIM_EXPLODIU,
      w: agora,
      mortos,
      escapados: [...this.escapados],
    });
    this.sala.log(
      `namek — O PLANETA EXPLODIU: ${this.escapados.size} escaparam, ${mortos.length} morreram`,
    );
    this.anunciar(agora);
  }

  /* ============================================================== a conversa == */

  /** `FIM_ESTADO` para todos. Sai em troca de fase e nada mais — é raro. */
  anunciar(agora = this.sala.now()) {
    const msg = this.resumo();
    msg.w = agora;
    msg.t = NS2C.FIM_ESTADO;
    this.sala.broadcastAll(msg);
  }

  /**
   * O `FIM_CONTAGEM`, uma vez por segundo e para TODOS.
   *
   * Ele já foi pessoal: levava, além do relógio do planeta, os segundos de
   * subida daquele jogador — e um dado por destinatário obriga a uma mensagem
   * por destinatário. Com a fuga virando altitude pura não sobrou nada de
   * pessoal no fim, e o relógio do planeta é literalmente o mesmo número para as
   * quinze telas: uma serialização por segundo em vez de quinze.
   *
   * O cliente também tem o próprio relógio andando (`EstadoDoFim.passo`), e este
   * tique é a correção dele. Um segundo de deriva num cronômetro de sessenta é
   * invisível; um cronômetro que só o cliente conta é o caminho para duas telas
   * discordarem sobre quem estava dentro quando o planeta foi.
   */
  baterORelogio() {
    this.sala.broadcastAll({
      t: NS2C.FIM_CONTAGEM,
      restante: round1(this.relogio / 1000),
    });
  }

  /** Manda o Freeza embora, com o mesmo cuidado com que ele foi chamado. */
  pararFreeza() {
    this._chamado = false;
    this._freezaVivo = null;
    if (!this.sala.freeza?.sair) return;
    try {
      this.sala.freeza.sair();
    } catch (err) {
      this.sala.log(`namek — o Freeza não saiu: ${err?.message ?? err}`);
    }
  }
}
