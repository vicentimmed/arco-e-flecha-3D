/* ---------------------------------------------------------------------------
   Namekusei — o mundo montado.

   Esta classe é FINA de propósito: ela monta, desmonta e distribui o dial do
   clima. A inteligência está nas peças — `terrain.js` sabe esculpir cratera,
   `sky.js` sabe o que é uma tempestade, `scenery.js` sabe onde uma vila cabe,
   `water.js` sabe fazer onda. É a mesma divisão que `levels/moonLevel.js` faz
   do lado do arqueiro: uma fase é um roteiro de construção, não um lugar para
   lógica.

   ------------------------------------------------------------ o dial do clima

   `setWeather` não troca nada: ele mira um alvo, e `update` caminha até lá em
   `NAMEK.weather.fade` segundos. O valor caminhado é UM escalar, repassado às
   quatro peças. Ter um número só é o que garante que a névoa, o céu, o mar, as
   fissuras e a força do vento terminem a transição no mesmo instante — e que
   voltar ao dia desfaça exatamente o que a tempestade fez.

   ------------------------------------------------------------------ o contrato

   Quatro sistemas dependem deste arquivo e nenhum deles conhece os outros
   quatro: a sala manda cratera, raio, clima e queda de objeto; a câmera lê
   `NAMEK_CAMERA_FAR`; os poderes leem `props` para saber o que dá para
   derrubar. Nada aqui guarda estado de jogo — vida de lutador, placar e o
   relógio da partida são de quem os possui.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { NAMEK } from "../../shared/namek/config.js";
import { clamp } from "../../utils/math.js";
import { NamekTerrain } from "./terrain.js";
import { NamekScenery } from "./scenery.js";
import { NamekSky, NAMEK_CAMERA_FAR } from "./sky.js";
import { NamekWater } from "./water.js";
import { NamekPlanetas } from "./planetas.js";
import { NamekMeteoros } from "./meteoros.js";
import { NamekLava } from "./lava.js";
import { NamekGrass } from "./grass.js";
import { NamekPeixe } from "./peixe.js";
/* O FIM DO PLANETA. As duas peças ficam FORA de `this.root` de propósito — ver
   o cabeçalho de `./fuga.js`: `root` é o PLANETA, e a fase `espaco` o apaga com
   uma linha. A explosão que o mata não pode sumir junto com ele. */
import { NamekFuga, FASE } from "./fuga.js";
import { NamekEspaco } from "./espaco.js";

export { NAMEK_CAMERA_FAR };

export class NamekWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../../shared/namek/field.js").NamekField} field
   */
  /**
   * @param {import("../fx/index.js").NamekFx} [fx] o pool de partículas. Só a
   *   LAVA o usa, e por isso ele é opcional: ela ferve com brasa e fumaça (ver
   *   `NamekLava.borbulhar`), e sem o pool ela continua correta — só não ferve.
   *   A bancada de cenário em `dev/` monta o mundo sem o jogo em volta.
   */
  constructor(scene, field, fx = null) {
    this.scene = scene;
    this.field = field;
    this.fx = fx;

    /** 0 = dia, 1 = tempestade. O valor CAMINHADO. */
    this.storm = 0;
    /** Para onde ele está indo. */
    this.stormAlvo = 0;
    this.weather = NAMEK.weather.padrao;

    this.terrain = null;
    this.scenery = null;
    this.sky = null;
    this.water = null;
    this.lava = null;
    this.grass = null;
    /** O peixe gigante do mar. Quem manda nele é a sala — ver `world/peixe.js`. */
    this.peixe = null;
    /** Os dois corpos celestes, e a chuva que sai deles quando morrem. */
    this.planetas = null;
    this.meteoros = null;
    /** O céu PROFUNDO: Kuraia e Rubel, que sobrevivem à morte do planeta.
     *  Um grupo irmão de `root`, e não um filho dele — ver `build`. */
    this.orbita = null;
    /** O portal da fuga e a morte do planeta. Fora de `root` — ver o import. */
    this.fuga = null;
    /** O céu do espaço, para quem escapou. Idem. */
    this.espaco = null;
    /** A fase do fim em cena, para `setFim` não repetir trabalho por quadro. */
    this.faseDoFim = FASE.CALMO;
    this.root = null;
  }

  /**
   * Monta tudo dentro de `this.root`.
   *
   * A ordem não é livre. O céu vem primeiro porque é ele que instala a névoa da
   * cena, e um material compilado antes da névoa existir não ganha os trechos
   * de fog — o defeito é o terreno inteiro ficando imune à perspectiva aérea, e
   * ele só aparece na primeira partida depois de uma troca de fase. O
   * repositório já documenta essa armadilha em `core/renderer.js`.
   *
   * @param {(fracao:number, texto:string)=>void} progresso
   */
  build(progresso = () => {}) {
    this.root = new THREE.Group();
    this.root.name = "namek:mundo";
    this.scene.add(this.root);

    /* "o sol", no singular: ele era três e virou um, a pedido do usuário (ver o
       bloco `SOL` em `world/sky.js`). A tela de carregamento é a única coisa
       deste modo que CONTA os sóis para o jogador, e deixá-la no plural seria a
       primeira coisa que ele leria contradizendo a primeira coisa que ele vê. */
    progresso(0.05, "acendendo o sol…");
    this.sky = new NamekSky(this.scene, this.field).build(this.root);

    /* OS DOIS PLANETAS logo depois do céu, e antes do relevo: eles escrevem
       profundidade a 2.400 m e o terreno tem de poder recortá-los. Montá-los
       aqui é o que garante que o material deles seja compilado com a névoa da
       cena já instalada — a mesma armadilha que o comentário acima descreve. */
    this.planetas = new NamekPlanetas().build(this.root);
    this.meteoros = new NamekMeteoros(this.field, this.fx).build(this.root);

    progresso(0.25, "levantando o relevo…");
    this.terrain = new NamekTerrain(this.field).build(this.root);

    progresso(0.7, "enchendo o mar…");
    this.water = new NamekWater(this.field).build(this.root);

    progresso(0.78, "plantando as ajisas…");
    this.scenery = new NamekScenery(this.field).build(this.root);

    /* O peixe DEPOIS do mar, porque ele vive dentro dele: a nota do
       `renderOrder` em `world/peixe.js` só faz sentido com a água já montada, e
       é ela que faz o corpo submerso virar vulto sem custar um material. */
    this.peixe = new NamekPeixe(this.fx).build(this.root);

    /* A lava DEPOIS do terreno, porque ela lê `field.lavaPools` — que quem
       entra no meio da partida já recebeu preenchida, via a lista de crateras
       do `welcome`. E o gancho, para as poças que abrirem daqui em diante. */
    this.lava = new NamekLava(this.field, this.fx).build(this.root);
    this.field.onLava = (poca) => this.lava?.acender(poca);

    progresso(0.9, "semeando o campo…");
    /* O mato por último: ele consulta `heightAt` e `slopeAt` por tufo, e as
       duas já têm de incluir toda cratera que o `welcome` trouxe. */
    this.grass = new NamekGrass(this.field).build(this.root);

    /* O FIM, na CENA e não em `this.root` — ver o import. `fuga` recebe o grupo
       do planeta porque é ela que o faz tremer e afundar na explosão; `espaco`
       recebe o céu porque é ele que ela apaga ao sair da atmosfera. Os dois
       nascem invisíveis e custam zero enquanto ninguém virar o clima. */
    this.fuga = new NamekFuga(this.field, this.fx).build(this.scene, this.root);
    this.espaco = new NamekEspaco(this.scene).build(this.scene, this.sky);

    /* ------------------------------------------------- KURAIA E RUBEL FICAM
     *
     * Os dois corpos celestes são construídos DENTRO de `this.root` — é onde
     * `NamekPlanetas.build` os quer, pela nota de névoa três blocos acima — e
     * logo em seguida são REPARENTADOS para cá.
     *
     * O motivo é o fim do planeta: a fase `espaco` apaga `this.root` com uma
     * linha (ver `setFim`), e ela apagaria junto duas luas que estão a 2 400 m
     * de distância e não têm nada a ver com o chão que explodiu. Quem escapou
     * de Namekusei tem de continuar vendo o céu profundo — e se um deles já
     * tiver sido derrubado a tiro, tem de continuar NÃO vendo, que é a metade
     * da regra que uma cópia solta perderia.
     *
     * Reparentar em vez de mudar o `build` dele é deliberado: o módulo é de
     * outro dono e o contrato dele continua valendo palavra por palavra —
     * inclusive o `dispose`, que confia na varredura da raiz do mundo. Por isso
     * `dispose` daqui os DEVOLVE a `this.root` antes de varrer. */
    this.orbita = new THREE.Group();
    this.orbita.name = "namek:orbita";
    this.scene.add(this.orbita);
    if (this.planetas?.root) this.orbita.add(this.planetas.root);

    // O clima entra INSTANTÂNEO na montagem: quem chega no meio de uma
    // tempestade não pode ver oito segundos de dia antes de o céu fechar.
    this.aplicarClima(this.storm);
    progresso(1, "pronto");
    return this;
  }

  /* ----------------------------------------------------------------- clima - */

  /**
   * Clima da sala. `instantaneo` para quem acabou de entrar — ver `build`.
   * @param {"dia"|"tempestade"} id
   */
  setWeather(id, instantaneo = false) {
    if (!NAMEK.weather.ids.includes(id)) return;
    this.weather = id;
    this.stormAlvo = id === "tempestade" ? 1 : 0;
    if (instantaneo) {
      this.storm = this.stormAlvo;
      this.aplicarClima(this.storm);
    }
  }

  aplicarClima(s) {
    this.sky?.aplicar(s);
    this.water?.setStorm(s);
    this.terrain?.setStorm(s);
    this.scenery?.setStorm(s);
    this.grass?.setStorm(s);
    this.peixe?.setStorm(s);
    this.planetas?.setStorm(s);
  }

  /* ---------------------------------------------------------------- quadro - */

  /**
   * @param {number} dt
   * @param {THREE.Vector3} cameraPos céu, nuvem e brilho do mar seguem o olho
   * @param {number} tempoSala relógio da sala em ms — sincroniza nuvem e onda
   */
  update(dt, cameraPos, tempoSala = 0) {
    if (this.storm !== this.stormAlvo) {
      /* Rampa LINEAR, e é deliberado. Uma curva suavizada nas pontas soaria
         mais elegante e leria pior: o que se quer comunicar é um processo
         irreversível em curso, e um `smoothstep` desacelerando no fim dá
         exatamente a sensação contrária — a de que o céu está se acomodando. */
      const passo = dt / Math.max(0.001, NAMEK.weather.fade);
      const d = this.stormAlvo - this.storm;
      this.storm = Math.abs(d) <= passo ? this.stormAlvo : this.storm + Math.sign(d) * passo;
      this.aplicarClima(clamp(this.storm, 0, 1));
    }

    this.sky?.update(dt, cameraPos, tempoSala);
    this.water?.update(dt, cameraPos, tempoSala);
    this.scenery?.update(dt, cameraPos, tempoSala);
    /* A câmera vai junto: a lava só ferve PERTO de quem está olhando, e sem a
       posição ela borbulharia em todas as poças do mapa — inclusive nas que
       estão a quatrocentos metros, com as partículas em sub-pixel. Ver
       `NamekLava.borbulhar`. */
    this.lava?.update(dt, cameraPos);
    this.grass?.update(dt, tempoSala);
    /* O peixe anda pelo relógio da SALA e não pelo `dt` local: o salto dele é uma
       parábola resolvida em função do tempo absoluto, e é isso que faz quinze
       telas o desenharem no mesmo ponto. Ver `NamekPeixe.pose`. */
    this.peixe?.update(dt, cameraPos, tempoSala);
    /* Os planetas acompanham o OLHO (é o que os mantém "longe") e a morte deles
       corre pelo relógio da SALA — as duas coisas que este `update` recebe. A
       chuva pela mesma razão: cada rocha é uma reta mais um relógio, e o
       relógio é o de lá. Ver os cabeçalhos de `planetas.js` e `meteoros.js`. */
    this.planetas?.update(dt, cameraPos, tempoSala);
    this.meteoros?.update(dt, cameraPos, tempoSala);
    /* O fim do planeta. `tensao` é 0..1 e vem de `setFim` — é o relógio da
       contagem virado em quantidade de luz laranja no chão. Ver `NamekFuga`. */
    this.fuga?.update(dt, this._tensao ?? 0, tempoSala);
    this.espaco?.update(dt, cameraPos);
  }

  /* ------------------------------------------------------------------- fim -
     O FIM DE NAMEKUSEI, distribuído.

     Uma função só, chamada uma vez por quadro por `NamekGame.step` com o
     `EstadoDoFim` inteiro. Ela é a fronteira entre a máquina de estados (que é
     do jogo e da sala) e o desenho (que é daqui), e por isso não guarda nada
     além do último valor escrito — a autoridade continua sendo de quem manda. */

  /**
   * @param {import("./fuga.js").EstadoDoFim} fim
   */
  setFim(fim) {
    if (!fim) return;
    /* A TENSÃO: 0 no começo do minuto final, 1 no instante da explosão. É ela
       que abre as fissuras e acelera o pulso do portal. Fora da contagem ela é
       0 (nada rachando) ou 1 (o chão já se abriu inteiro). */
    this._tensao =
      fim.fase === FASE.CONTAGEM
        ? clamp(1 - fim.restante / NAMEK.fim.contagem, 0, 1)
        : fim.fase === FASE.EXPLODINDO
          ? 1
          : 0;

    if (fim.fase !== this.faseDoFim) {
      this.faseDoFim = fim.fase;
      this.fuga?.setFase(fim.fase, fim.restante);
      /* **UMA LINHA APAGA O PLANETA.** É por causa dela que `fuga`, `espaco` e
         os dois corpos celestes moram FORA de `root`: o que sai de cena aqui é
         o mundo inteiro — relevo, mar, cenário, mato, lava, peixe, chuva de
         rocha, céu e as luzes penduradas nele —, e três coisas precisam
         sobreviver a isso: a explosão que o matou, o vácuo que fica no lugar, e
         Kuraia e Rubel, que estão a 2 400 m e não tinham nada com o assunto.
         Ver o bloco da `orbita` em `build`. */
      if (this.root) this.root.visible = fim.temPlaneta;
      if (fim.fase === FASE.ESPACO) this.espaco?.planetaMorreu();
      if (fim.fase === FASE.CALMO) this.espaco?.planetaVoltou();
    }

    /* E o céu do ESPAÇO segue o OLHO, não a fase: quem escapa aos quarenta
       segundos vê estrelas enquanto catorze pessoas ainda brigam debaixo de um
       céu vermelho. Ver `NamekEspaco.setAtivo`. */
    this.espaco?.setAtivo(fim.euNoEspaco);
  }

  /* ---------------------------------------------------- planetas e chuva --- */

  /**
   * O Kamehameha está apontado para algum planeta? Devolve o id, ou `null`.
   * Quem pergunta é o `game.js`, no instante do disparo. Ver `NamekPlanetas.naMira`.
   */
  planetaNaMira(origem, dir) {
    return this.planetas?.naMira(origem, dir) ?? null;
  }

  /** A sala decretou a morte de um planeta (`NS2C.PLANET_DOWN`). */
  derrubarPlaneta(id, w) {
    return this.planetas?.derrubar(id, w) ?? false;
  }

  /** Os que já tinham caído antes de eu entrar (campo `planetas` do `welcome`). */
  planetasCaidos(lista) {
    this.planetas?.jaCaidos(lista);
  }

  /** Uma rocha entrou no céu (`NS2C.METEOR`). */
  soltarMeteoro(msg) {
    this.meteoros?.soltar(msg);
  }

  /** Uma rocha estourou (`NS2C.METEOR_HIT`). A cratera vem pelo `NS2C.CRATER`. */
  estourarMeteoro(msg) {
    this.meteoros?.estourar(msg);
  }

  /* -------------------------------------------------------------- cratera -- */

  /**
   * Uma cratera abriu. **Não a registra no campo** — quem faz isso é
   * `NamekField.addCrater`, e ele é compartilhado com a sala.
   *
   * A divisão importa: o campo é a autoridade sobre a ALTURA (é ele que bot,
   * bala e pé de jogador consultam) e este módulo é a autoridade sobre a MALHA.
   * Se este arquivo também inserisse no campo, uma cratera vinda da rede seria
   * inserida duas vezes — uma pelo tratador da mensagem, outra aqui — e o
   * `craterLimit` aposentaria as mais antigas no dobro da velocidade em que o
   * servidor as aposenta. Duas topografias, o pior defeito possível deste modo.
   *
   * @param {{id:number, x:number, z:number, raio:number, fundura:number}} cratera
   */
  applyCrater(cratera) {
    if (!cratera) return;
    this.terrain?.applyCrater(cratera);
    // Quem estava em cima do buraco desce junto. Ver `NamekScenery.reassentar`.
    this.scenery?.reassentar(cratera.x, cratera.z, cratera.raio);
    /* E o mato de dentro do buraco MORRE — não desce junto, como as peças.
       Uma touceira intacta no fundo de uma cratera de Genki Dama seria a
       única coisa do campo que a explosão respeitou. */
    this.grass?.cortarNoRaio(cratera.x, cratera.z, cratera.raio);
  }

  /* ---------------------------------------------------------------- raios -- */

  /** Um relâmpago em (x, z). A sala manda; este lado pinta e ilumina. */
  strikeBolt(x, z) {
    this.sky?.strikeBolt(x, z);
  }

  /* ----------------------------------------------------------------- peças - */

  /**
   * Os quebráveis, para o teste de acerto de quem atira.
   * `[{ kind, i, x, y, z, raio, vida }]` — (x, y, z) é o centro da esfera de
   * acerto e `raio` é o dela. Peças já derrubadas ficam na lista com `vida`
   * zero; ver `NamekScenery.props` para o porquê.
   */
  get props() {
    return this.scenery?.props ?? [];
  }

  /**
   * As peças que podem alcançar (x, z). É o que permite a um projétil parar
   * numa pedra em vez de atravessá-la — ver `NamekScenery.indexarProps`.
   */
  propsNear(x, z) {
    return this.scenery?.propsNear(x, z) ?? null;
  }

  /**
   * Derruba uma peça do cenário.
   * @param {"rocha"|"arvore"|"casa"} kind
   * @param {number} index índice em `props` dentro daquele tipo
   * @returns {boolean} false se o índice não existe ou a peça já caiu
   */
  breakProp(kind, index) {
    return this.scenery?.breakProp(kind, index) ?? false;
  }

  /* ------------------------------------------------------------- desmonta -- */

  /**
   * Contagem de recursos devolvidos, no mesmo formato de
   * `levels/resources.js` — mas SEM importar aquele módulo, porque ele carrega
   * o registro de recursos de módulo do jogo do arqueiro e este modo não pode
   * encostar nele (§0). A varredura aqui é a mesma; o que não existe é a lista
   * de exceções, porque nada em `src/namek/world/` é recurso de módulo: toda
   * geometria e todo material nascem dentro de um `build` e morrem aqui.
   */
  dispose() {
    /* KURAIA E RUBEL VOLTAM PARA CASA, e voltam ANTES de tudo.
     *
     * `build` os tirou de `this.root` para que a fase `espaco` não os apagasse
     * junto com o planeta; a varredura lá embaixo é quem destrói as geometrias
     * deles, e `NamekPlanetas.dispose` diz isso por escrito ("malhas, geometrias
     * e materiais saem com a raiz do mundo"). Devolvê-los aqui é o que mantém
     * aquele contrato verdadeiro — e tem de ser antes do `planetas.dispose()`
     * logo abaixo, que solta a referência a `root` e não teria mais o que
     * reparentar. */
    if (this.orbita && this.planetas?.root && this.root) {
      this.root.add(this.planetas.root);
    }
    this.orbita?.parent?.remove(this.orbita);
    this.orbita?.clear();
    this.orbita = null;

    // As peças primeiro: elas soltam referências e devolvem a névoa da cena.
    this.sky?.dispose();
    this.terrain?.dispose();
    this.water?.dispose();
    this.scenery?.dispose();
    this.lava?.dispose();
    this.grass?.dispose();
    this.peixe?.dispose();
    this.planetas?.dispose();
    this.meteoros?.dispose();
    /* Estes DOIS destroem as próprias geometrias, e têm de destruir: a varredura
       de `root` logo abaixo não os alcança, porque eles nunca estiveram lá. E o
       `espaco` devolve a névoa e o fundo da cena no caminho — sair do modo com a
       névoa do vácuo instalada deixaria o vale do arqueiro preto. */
    this.fuga?.dispose();
    this.espaco?.dispose();
    /* E o planeta volta a ser visível. `dispose` roda com o mundo já pronto para
       ir embora, mas a raiz é apagada logo abaixo pela varredura — deixá-la
       invisível seria deixar um `false` num objeto que alguém pode ter guardado. */
    if (this.root) this.root.visible = true;
    this.field.onLava = null;

    const contagem = { geometries: 0, materials: 0, textures: 0 };
    if (this.root) {
      const geometrias = new Set();
      const materiais = new Set();
      this.root.traverse((o) => {
        if (o.geometry) geometrias.add(o.geometry);
        const m = o.material;
        if (Array.isArray(m)) for (const um of m) materiais.add(um);
        else if (m) materiais.add(m);
        // `InstancedMesh` guarda buffers próprios (matrizes e cores por
        // instância) que não estão nem na geometria nem no material.
        if (o.isInstancedMesh) o.dispose();
      });
      for (const g of geometrias) {
        g.dispose();
        contagem.geometries++;
      }
      for (const m of materiais) {
        for (const chave of Object.keys(m)) {
          const valor = m[chave];
          if (valor?.isTexture) {
            valor.dispose();
            contagem.textures++;
          }
        }
        m.dispose();
        contagem.materials++;
      }
      this.root.parent?.remove(this.root);
      this.root.clear();
    }

    this.root = null;
    this.terrain = null;
    this.scenery = null;
    this.sky = null;
    this.water = null;
    this.lava = null;
    this.grass = null;
    this.peixe = null;
    this.planetas = null;
    this.meteoros = null;
    this.fuga = null;
    this.espaco = null;
    return contagem;
  }
}
