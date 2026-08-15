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
import { NamekLava } from "./lava.js";
import { NamekGrass } from "./grass.js";

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

    progresso(0.05, "acendendo os três sóis…");
    this.sky = new NamekSky(this.scene, this.field).build(this.root);

    progresso(0.25, "levantando o relevo…");
    this.terrain = new NamekTerrain(this.field).build(this.root);

    progresso(0.7, "enchendo o mar…");
    this.water = new NamekWater(this.field).build(this.root);

    progresso(0.78, "plantando as ajisas…");
    this.scenery = new NamekScenery(this.field).build(this.root);

    /* A lava DEPOIS do terreno, porque ela lê `field.lavaPools` — que quem
       entra no meio da partida já recebeu preenchida, via a lista de crateras
       do `welcome`. E o gancho, para as poças que abrirem daqui em diante. */
    this.lava = new NamekLava(this.field, this.fx).build(this.root);
    this.field.onLava = (poca) => this.lava?.acender(poca);

    progresso(0.9, "semeando o campo…");
    /* O mato por último: ele consulta `heightAt` e `slopeAt` por tufo, e as
       duas já têm de incluir toda cratera que o `welcome` trouxe. */
    this.grass = new NamekGrass(this.field).build(this.root);

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
    // As peças primeiro: elas soltam referências e devolvem a névoa da cena.
    this.sky?.dispose();
    this.terrain?.dispose();
    this.water?.dispose();
    this.scenery?.dispose();
    this.lava?.dispose();
    this.grass?.dispose();
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
    return contagem;
  }
}
