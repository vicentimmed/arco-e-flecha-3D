/* ---------------------------------------------------------------------------
   A bandeira, e — mais importante — QUEM ESTÁ COM ELA.

   O modo inteiro depende de uma única informação chegar depressa: onde está a
   bandeira agora. Tudo o mais é consequência disso. Se a resposta exige
   procurar um objeto pequeno no meio de uma arena de 300 m, o modo não é
   difícil, é confuso — e a diferença entre as duas coisas é o que este arquivo
   resolve.

   Por isso a bandeira não é só um objeto no chão. Ela tem TRÊS camadas de
   sinalização, e cada uma responde a uma distância diferente:

   1. O PILAR DE LUZ, visível ATRAVÉS DO CENÁRIO (`depthTest: false`). É a
      camada de longe. De qualquer ponto da arena, atrás de qualquer montanha,
      dentro de qualquer hábitat, existe uma coluna colorida dizendo onde a
      bandeira está. Atravessar parede é normalmente um defeito; aqui é o
      recurso — um pilar que some atrás de uma pedra não responde à pergunta
      justamente quando ela é mais urgente.

   2. O HALO NO CHÃO e o brilho em volta do portador. É a camada de perto: a
      quinze metros, o pilar já não diz QUEM, e um anel pulsando sob os pés de
      alguém diz.

   3. A BANDEIRA em si, tremulando acima da cabeça de quem a carrega. É a
      leitura de rosto: quando você está mirando na pessoa, é ela que confirma
      que aquela é a pessoa certa.

   A COR É A DO TIME de quem carrega, e ela é o quarto sinal — o mais rápido de
   todos, porque não precisa ser lido: azul é seu, vermelho é do outro (ou o
   contrário, do outro lado da rede). Solta no chão, a bandeira volta ao branco
   dourado do estado neutro, que é a maneira mais curta de dizer "de ninguém,
   corram".

   Nada disto decide nada. Quem decide quem pegou, quem entregou e quem marcou é
   a SALA (`server/flagSim.js`); este arquivo só desenha o que ela disse.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { CONFIG } from "../config.js";

/** Neutra: ouro claro. A cor de "de ninguém ainda". */
const COR_NEUTRA = 0xffd75e;
/** Os dois times. Humanos em azul, CPU em vermelho — como o placar já mostra. */
const COR_TIME = { humans: 0x4aa3ff, bots: 0xff5a4a };

const TAU = Math.PI * 2;

/**
 * Material que ATRAVESSA o cenário. É o truque central da camada de longe.
 *
 * `depthTest: false` faz o objeto ser desenhado por cima de tudo o que já
 * está no buffer; `depthWrite: false` impede que ele estrague o buffer para
 * quem vier depois. `renderOrder` alto garante que ele venha por último.
 */
function materialVazado(cor, opacidade) {
  return new THREE.MeshBasicMaterial({
    color: cor,
    transparent: true,
    opacity: opacidade,
    depthTest: false,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

export class FlagEntity {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "bandeira";
    this.group.frustumCulled = false;
    scene.add(this.group);

    this.tempo = 0;
    /* Nasce ESCONDIDA. O objeto é construído uma vez e sobrevive à troca de
       modo; quem o acende é a primeira amostra da sala (`applyNetwork`). Sem
       isto, uma bandeira apareceria no centro do vale durante um duelo. */
    this.visible = false;
    this.group.visible = false;
    /** Estado vindo da sala. Ver `FlagField.view()`. */
    this.carrier = null;
    this.carrierTeam = null;
    this.atBase = "center";
    this.position = new THREE.Vector3();
    /** Onde desenhar de fato — a posição da sala, ou a do portador na tela. */
    this._alvo = new THREE.Vector3();

    this.buildMastro();
    this.buildPano();
    this.buildPilar();
    this.buildHalo();

    this.bases = new THREE.Group();
    this.bases.frustumCulled = false;
    this.bases.visible = false;
    scene.add(this.bases);
    this._basesFeitas = false;
    /** Os dois feixes das bases, para o desbotamento por distância. */
    this._feixes = [];
  }

  /* ------------------------------------------------------------ as peças -- */

  buildMastro() {
    /* O mastro é material NORMAL (com profundidade): ele é o objeto físico, e um
       mastro atravessando montanha pareceria defeito. Quem atravessa é o pilar
       de luz, que ninguém confunde com matéria. */
    this.mastro = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.09, 3.4, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.5, metalness: 0.6 }),
    );
    this.mastro.position.y = 1.7;
    this.mastro.castShadow = true;
    this.group.add(this.mastro);

    // Ponteira dourada: a silhueta precisa de um topo para não parecer um cano.
    const ponta = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshStandardMaterial({ color: COR_NEUTRA, roughness: 0.3, metalness: 0.8 }),
    );
    ponta.position.y = 3.44;
    this.group.add(ponta);
  }

  /**
   * O pano, com ondulação feita em VÉRTICE.
   *
   * Um retângulo parado lê como placa; a ondulação é o que faz o olho
   * reconhecer "bandeira" à distância, antes de conseguir ver a cor. São 12×6
   * vértices e uma senoide por quadro — barato o bastante para não merecer
   * shader próprio.
   */
  buildPano() {
    const geo = new THREE.PlaneGeometry(1.9, 1.15, 12, 6);
    this._panoBase = Float32Array.from(geo.attributes.position.array);
    this.pano = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: COR_NEUTRA,
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.DoubleSide,
        emissive: COR_NEUTRA,
        emissiveIntensity: 0.35,
      }),
    );
    this.pano.position.set(0.95, 2.75, 0);
    this.pano.castShadow = true;
    this.group.add(this.pano);
  }

  /**
   * O pilar de luz — a camada de LONGE.
   *
   * 90 m de altura: mais alto que qualquer coisa do jogo, inclusive o foguete
   * da Lua (28 m). Tem de ser, porque ele é lido de cima, de baixo e de dentro
   * de um vale — e um pilar que termina abaixo da linha do horizonte de quem
   * olha some exatamente quando é preciso.
   */
  buildPilar() {
    this.pilar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 1.5, 90, 12, 1, true),
      materialVazado(COR_NEUTRA, 0.3),
    );
    this.pilar.position.y = 45;
    this.pilar.renderOrder = 999;
    this.pilar.frustumCulled = false;
    this.group.add(this.pilar);

    // Um núcleo mais estreito e mais forte: dá ao pilar um centro definido em
    // vez de uma mancha larga, e é o que o mantém legível contra o céu claro.
    this.nucleo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.3, 90, 8, 1, true),
      materialVazado(0xffffff, 0.42),
    );
    this.nucleo.position.y = 45;
    this.nucleo.renderOrder = 1000;
    this.nucleo.frustumCulled = false;
    this.group.add(this.nucleo);
  }

  /** O halo no chão — a camada de PERTO, que diz *quem*. */
  buildHalo() {
    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 2.4, 32),
      materialVazado(COR_NEUTRA, 0.55),
    );
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.position.y = 0.08;
    this.halo.renderOrder = 998;
    this.halo.frustumCulled = false;
    this.group.add(this.halo);
  }

  /**
   * Os dois discos de entrega, um por time.
   *
   * Desenhados UMA vez, quando a sala manda as posições. São a única peça do
   * modo que não se move, e a única cuja cor não muda: a base humana é azul
   * para sempre, e é isso que faz "corra para o azul" ser uma instrução.
   */
  montarBases(bases, terrain = null) {
    if (!bases || this._basesFeitas) return;
    const raio = CONFIG.modes.captureFlag.baseRadius;

    for (const [time, p] of Object.entries(bases)) {
      const cor = COR_TIME[time] ?? COR_NEUTRA;

      /* O anel RESPEITA A PROFUNDIDADE, ao contrário do feixe.
         Ele é a marca no chão de um lugar, e um lugar tem de ficar onde está:
         sem o teste de profundidade, o anel da base do outro lado do vale era
         desenhado por cima do morro que fica na frente dele — riscos vermelhos
         atravessando a grama, a 60 m de onde a base realmente está. Quem
         atravessa o relevo é o feixe, que é fino e não engana ninguém sobre
         onde o chão está. */
      /* O anel ACOMPANHA O RELEVO, vértice a vértice.
         Um anel plano de 9 m de raio sobre chão ondulado mergulha no morro de
         um lado e flutua do outro — e o que se vê não é um anel, são pedaços de
         linha vermelha aparecendo e sumindo pela grama, que foi exatamente o
         defeito. Reprojetar cada vértice na altura do terreno custa 90 consultas
         UMA vez, na construção, e o anel passa a ser a marca de chão que ele
         diz ser. */
      const anelGeo = new THREE.RingGeometry(raio * 0.86, raio, 44);
      if (terrain?.heightAt) {
        const pos = anelGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          // O anel ainda está deitado no plano XY: aqui `y` é o que virará `z`.
          const wx = p.x + pos.getX(i);
          const wz = p.z + pos.getY(i);
          // O `z` local vira a ALTURA depois do `rotation.x = -PI/2`, e o sinal
          // se inverte com ele — daí o negativo.
          pos.setZ(i, -(terrain.heightAt(wx, wz) - p.y));
        }
        pos.needsUpdate = true;
      }

      const disco = new THREE.Mesh(
        anelGeo,
        new THREE.MeshBasicMaterial({
          color: cor,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          fog: true,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      disco.rotation.x = -Math.PI / 2;
      disco.position.set(p.x, p.y + 0.09, p.z);
      this.bases.add(disco);

      /* Um feixe FINO no centro da base, e não uma coluna da largura dela.
         A primeira versão era um cilindro de 9 m de raio, e ele destruía a tela:
         qualquer coisa desenhada com `depthTest: false` cobre tudo o que está
         atrás, e "tudo o que está atrás" de um tubo de 9 m de raio, visto de
         perto, é a tela inteira — o efeito era duas faixas vermelhas cruzando a
         imagem de canto a canto. Um feixe fino atravessa parede do mesmo jeito
         (que é o que se quer: achar a base de qualquer lugar) e nunca chega a
         cobrir nada, porque nunca é largo o bastante.

         Ele é BAIXO, 22 m, contra os 90 m do pilar da bandeira. A diferença de
         altura é o que distingue as duas leituras: o alto é o que se persegue,
         o baixo é para onde se leva. */
      const feixe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.5, 22, 8, 1, true),
        materialVazado(cor, 0.3),
      );
      feixe.position.set(p.x, p.y + 11, p.z);
      feixe.renderOrder = 995;
      this.bases.add(feixe);
      this._feixes.push(feixe);
    }
    this._basesFeitas = true;
  }

  /* ------------------------------------------------------------- a rede --- */

  /**
   * Aplica a amostra da sala.
   * @param {object} msg `S2C.FLAG` — ver `FlagField.view()`
   */
  applyNetwork(msg, terrain = null) {
    this.carrier = msg.carrier ?? null;
    this.carrierTeam = msg.carrierTeam ?? null;
    this.atBase = msg.atBase ?? null;
    if (msg.p) this.position.set(msg.p[0], msg.p[1], msg.p[2]);
    this.montarBases(msg.bases, terrain);
    this.mostrar();
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3|null} posPortador onde o portador está NESTA tela.
   *   Vem do boneco interpolado, não da amostra de 10 Hz: a bandeira precisa
   *   grudar no corpo que se vê, senão ela flutua meio metro atrás dele em toda
   *   corrida — e é justamente durante a corrida que todo mundo está olhando.
   * @param {boolean} souEu o portador é o jogador desta tela?
   */
  update(dt, posPortador = null, souEu = false, camera = null) {
    if (!this.visible) return;
    this.tempo += dt;

    /* O FEIXE DA BASE DESBOTA DE PERTO.
     *
     * Ele existe para ser visto de longe — é assim que se acha a base do outro
     * lado do vale. De perto ele não informa nada (você está dentro dela) e
     * cobra caro: é aditivo e sem teste de profundidade, então parado dentro da
     * própria base, que é exatamente onde se renasce depois de cada morte, ele
     * lavava metade da tela de azul. Some abaixo de 14 m, cheio a partir de
     * 34 m — a faixa em que ele deixa de ser informação e vira estorvo. */
    if (camera && this._feixes.length) {
      for (const f of this._feixes) {
        const d = camera.position.distanceTo(f.position);
        const k = Math.max(0, Math.min(1, (d - 14) / 20));
        f.material.opacity = 0.3 * k;
        f.visible = k > 0.01;
      }
    }

    const carregada = this.carrier != null;
    this._alvo.copy(carregada && posPortador ? posPortador : this.position);

    const cor = carregada ? (COR_TIME[this.carrierTeam] ?? COR_NEUTRA) : COR_NEUTRA;

    this.group.position.copy(this._alvo);

    /* Carregada, a bandeira sobe para a ALTURA DA CABEÇA e o mastro some: um
       mastro de 3,4 m saindo do meio de um arqueiro em corrida é uma haste
       atravessando o corpo dele. Solta, ela é um objeto fincado no chão. */
    const naMao = carregada;
    this.mastro.visible = !naMao;

    /* O TAMANHO DEPENDE DE QUEM OLHA, e é a mesma lógica do pilar.
     *
     * Na tela dos OUTROS o pano é grande (1,15×) porque ele é a confirmação de
     * rosto: quando você já está mirando na pessoa, é ele que diz que aquela é
     * a pessoa certa, e um pano pequeno a 40 m não diz nada.
     *
     * Na tela do PORTADOR ele encolhe para 0,5× e cola na cabeça. Medido: em
     * terceira pessoa a câmera fica a 4 m, e um pano de 2,2 m nessa distância
     * ocupava um quarto da tela — o jogador carregava a bandeira olhando para
     * um retângulo azul em vez de para o caminho. Pequeno, ele continua no
     * canto do olho dizendo "é você", que é tudo o que o dono precisa. */
    const escala = naMao ? (souEu ? 0.5 : 1.15) : 1;
    const raioOrbita = naMao ? (souEu ? 0.3 : 0.55) : 0.95;
    this.pano.position.set(raioOrbita, naMao ? (souEu ? 2.15 : 2.5) : 2.75, 0);
    this.pano.scale.setScalar(escala);

    // Girando devagar quando está no chão: um objeto que se mexe é um objeto
    // que o olho encontra. Carregada, ela acompanha quem corre.
    this.group.rotation.y = carregada ? this.tempo * 1.6 : this.tempo * 0.55;

    this.ondularPano();

    /* O PULSO. Tudo pisca junto, e mais rápido quando alguém está carregando:
       a urgência do modo é literalmente a frequência da luz na tela. */
    const hz = carregada ? 2.6 : 1.1;
    const pulso = 0.5 + 0.5 * Math.sin(this.tempo * TAU * hz * 0.5);

    /* O PILAR SOME PARA QUEM O CARREGA.
     *
     * Ele nasce nos pés do portador e sobe 90 m; a câmera de terceira pessoa
     * fica 4 m atrás e 1,25 m ao lado. Ou seja: quando o portador é você, a
     * câmera está DENTRO de um cilindro aditivo sem teste de profundidade, e o
     * resultado medido foi meia tela lavada de azul-leitoso — você fica cego
     * exatamente durante a corrida que o modo inteiro existe para produzir.
     *
     * E não se perde nada ao escondê-lo, porque o pilar responde a uma pergunta
     * que o portador não tem: *onde está a bandeira?*. Ele sabe. Quem precisa
     * do pilar é todo o resto da sala, e para esses ele continua aceso — o que
     * some é só a cópia desenhada na tela de quem já é o dono da informação. A
     * faixa da HUD (`hud.setFlag`) é o que diz a ele o que ele precisa saber. */
    const escondePilar = carregada && souEu;
    this.pilar.visible = !escondePilar;
    this.nucleo.visible = !escondePilar;
    this.pilar.material.color.setHex(cor);
    this.pilar.material.opacity = (carregada ? 0.34 : 0.22) + pulso * 0.16;
    this.nucleo.material.opacity = (carregada ? 0.5 : 0.3) + pulso * 0.2;
    this.nucleo.material.color.setHex(carregada ? 0xffffff : COR_NEUTRA);

    this.halo.material.color.setHex(cor);
    /* O halo fica, mas DISCRETO para o próprio portador: sob os próprios pés
       ele é um anel de 2,4 m ocupando o rodapé da tela. Fraco, ele ainda
       confirma "é você que está com ela" no canto do olho; forte, ele briga
       com o chão que a pessoa está tentando atravessar correndo. */
    this.halo.material.opacity = souEu && carregada ? 0.12 : 0.35 + pulso * 0.35;
    // O halo cresce e encolhe: sem isso ele lê como decalque no chão.
    const k = 1 + pulso * (carregada ? 0.28 : 0.12);
    this.halo.scale.set(k, k, 1);
    // Ele fica na altura DO CHÃO sob o portador, e o portador pode estar no ar
    // (jetpack). Descer o halo até o chão exigiria um raycast por quadro; ficar
    // colado nos pés é a leitura certa e custa zero.
    this.halo.position.y = 0.08;

    this.pano.material.color.setHex(cor);
    this.pano.material.emissive.setHex(cor);
    this.pano.material.emissiveIntensity = 0.3 + pulso * 0.45;
  }

  /** A senoide que faz o pano tremular. Duas ondas, uma por eixo. */
  ondularPano() {
    const attr = this.pano.geometry.attributes.position;
    const base = this._panoBase;
    for (let i = 0; i < attr.count; i++) {
      const k = i * 3;
      const x = base[k];
      const y = base[k + 1];
      /* A amplitude cresce com a distância ao mastro: o pano é PRESO de um lado
         e livre do outro, e uma onda uniforme daria uma folha de papel rígida
         balançando inteira. */
      const amp = ((x + 0.95) / 1.9) * 0.28;
      attr.array[k + 2] =
        Math.sin(x * 3.4 + this.tempo * 7) * amp +
        Math.sin(y * 2.2 + this.tempo * 4.3) * amp * 0.4;
    }
    attr.needsUpdate = true;
  }

  esconder() {
    this.visible = false;
    this.group.visible = false;
    this.bases.visible = false;

    /* AS BASES SÃO DESMONTADAS, não só escondidas.
     *
     * Elas são construídas uma vez, com as coordenadas E as alturas de terreno
     * da fase em que o modo começou. Guardá-las para reacender depois é
     * reacendê-las no lugar errado: jogar a bandeira no vale, ir para a Lua e
     * voltar ao modo desenhava dois anéis a 31 m do centro do VALE, no meio da
     * planície lunar, com o relevo de outro mundo gravado nos vértices. */
    for (const o of this.bases.children) {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    }
    this.bases.clear();
    this._feixes = [];
    this._basesFeitas = false;
  }

  mostrar() {
    this.visible = true;
    this.group.visible = true;
    this.bases.visible = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.bases);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this.bases.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this.group = null;
    this.bases = null;
  }
}
