/* ---------------------------------------------------------------------------
   O Arqueiro Medieval — um ranger encapuzado.

   Segunda tentativa, escrita do zero. A primeira ficou ruim, e a causa foi
   medida em vez de adivinhada (ver `docs/plano-arqueiro-medieval.md`): as onze
   peças dela caíam quase todas na mesma faixa de luminância, o corpo virava uma
   coluna marrom a quarenta metros, e por baixo dos adereços era a arqueira com
   outra roupa.

   Este arquivo é organizado pelas cinco coisas que fazem um corpo procedural
   parecer de brinquedo, e cada seção mata uma:

     1. SIMETRIA PERFEITA  → a lista de assimetrias do §"equipamento"
     2. MEMBRO DE RAIO FIXO → `makeMuscleSegment`, com perfil torneado
     3. ROUPA SEM ESPESSURA → toda camada termina numa borda mais larga e escura
     4. UMA FORMA POR REGIÃO → o tronco são TRÊS formas de seções diferentes
     5. FACETA E AUSÊNCIA DE VINCO → 20–24 lados, e barras de pano onduladas

   E acima de tudo isso, a regra que a v1 quebrou: **o corpo ALTERNA claro e
   escuro de cima para baixo**. Capuz escuro, rosto claro, manto escuro, túnica
   média, mangas brilhantes, cinto escuro, calças claras, botas escuras. É essa
   alternância — e não a contagem de peças — que faz um corpo ser legível de
   longe. Ver `tint` e `createMaterials`.

   Referencial: peças de tronco entram no `spine` (origem no quadril, -Z na
   mira); braços e pernas são grupos soltos que a IK posiciona a cada quadro.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { makeJoint } from "../../utils/geometry.js";
import {
  BODY,
  pele,
  pano,
  metal,
  makeMuscleSegment,
  ondularBarra,
} from "./base.js";

const WHITE = new THREE.Color(1, 1, 1);

/** Altura do ombro sobre o quadril (m) — aparece em quase toda peça do tronco. */
const H = BODY.shoulderY - BODY.hipY;

/** A lã crua da túnica, de onde o tingimento parte. Ver `tint`. */
const TUNICA_CRUA = new THREE.Color("#8a6f3f");

export const medieval = {
  id: "medieval",
  label: "Arqueiro Medieval",
  detalhe: "capuz, manto e arco de teixo",
  swatch: ["#232a20", "#e8dfc4"],

  /* Arco de teixo. A GEOMETRIA continua idêntica — `BRACE_HEIGHT`,
     `DRAW_LENGTH` e o ponto de disparo são linha de tiro. Só a matéria muda.

     A madeira é mais CLARA que a da v1 (0,26 de luminância contra 0,16): lá ela
     tinha o mesmo valor da túnica e o arco sumia dentro do corpo, que é a última
     coisa que se quer do objeto que dá nome ao jogo. */
  bowPalette: {
    limb: { color: "#b08a54", roughness: 0.72, metalness: 0.0 },
    grip: { color: "#3a2a1c", roughness: 0.9, metalness: 0.0 },
    string: { color: "#e3dcc4", roughness: 0.6, metalness: 0.0 },
  },

  /**
   * A paleta, escolhida por LUMINÂNCIA antes de ser escolhida por cor.
   *
   * Os números entre parênteses são a luminância relativa de cada tom — o que o
   * olho lê como claro ou escuro, e a única coisa que sobra a quarenta metros.
   * Eles não são resultado: são o projeto. A régua da bancada
   * (`dev/skins.html`) mede exatamente isto no corpo montado.
   */
  createMaterials() {
    return {
      // (0,46) O rosto é a mancha clara dentro do capuz escuro. É o contraste
      // que faz um capuz parecer um capuz em vez de um balde.
      skin: pele("#e0a97e", 0.62),
      // (0,02) Cabelo e barba, quase pretos — eles emolduram o rosto por baixo.
      hair: pele("#2a2018", 0.5),
      // (0,02) A lã do capuz. Verde tão fundo que lê como preto ao sol.
      wool: pano("#232a20", 0.95),
      // (0,016) O manto, ainda mais fundo que o capuz: é ele que separa a
      // cabeça dos ombros quando os dois estão contra o céu.
      cloak: pano("#1e241c", 0.95),
      // (0,15 na cor do jogador) O gambeson — o ÚNICO lugar da cor do time.
      tunic: pano("#8a6f3f", 0.88),
      /* (0,74) A ÂNCORA BRILHANTE, e a peça mais importante da paleta.
         A v1 não tinha nada acima de 0,41 e por isso não tinha onde o olho
         pousar. As mangas são o equivalente funcional dos tênis brancos da
         arqueira, e melhores: os braços se mexem o tempo todo e ficam
         recortados contra o fundo em qualquer pose de tiro. */
      linen: pano("#e8dfc4", 0.9),
      // (0,46) As calças. Claras, para as pernas não fundirem com as botas.
      hose: pano("#c2b393", 0.93),
      // (0,014) Cinto, bracelete e bota: o escuro que ancora o corpo no chão.
      leatherDark: pano("#2a1d12", 0.88),
      // (0,03) A luva, escura contra a manga clara — é o contraste que faz a
      // mão existir a média distância.
      glove: pano("#3a2a1c", 0.84),
      // (0,26) Madeira da aljava e das hastes. Sem trama: madeira não é tecido.
      wood: pano("#b08a54", 0.72, 0),
      metal: metal("#c8ccd2", 0.3, 0.85),
      eyeWhite: pele("#f7f4ee", 0.28),
      eyeDark: pele("#241a14", 0.18),
      mouth: pele("#9c5148", 0.66),
      fletch: (() => {
        const m = pano("#d6cbb0", 0.85);
        m.side = THREE.DoubleSide;
        return m;
      })(),
      arrowShaft: pano("#c9b58c", 0.6),
    };
  },

  /**
   * A cor do jogador entra em UM lugar grande e dois pequenos.
   *
   * A v1 espalhou a cor por túnica, calças, bota e bracelete — e apagou as
   * quatro: cercada de tons parecidos, cor nenhuma é lida como cor. Aqui a
   * túnica fica sozinha, com escuro em cima (o manto) e brilhante embaixo (as
   * mangas), e é esse cerco que a faz saltar mesmo num tom médio.
   *
   * Pele, cabelo, capuz, manto, calças e botas NUNCA recebem cor: são eles que
   * seguram a estrutura de valor, e tingi-los é justamente o que colapsa tudo
   * para a mesma faixa.
   */
  tint(mat, c) {
    // Lã tingida: parte do bege cru e caminha até a cor, sem nunca ser a cor
    // pura — pano medieval não é tinta de caneta.
    mat.tunic.color.copy(TUNICA_CRUA).lerp(c, 0.82);
    mat.fletch.color.copy(c).lerp(WHITE, 0.25);
  },

  build(rig) {
    const mat = rig.mat;
    const spine = rig.spine;

    /* Os dois níveis de detalhe (ver `Player.setDetailLevel`). A regra que
       impede buraco: nenhuma peça daqui é estrutural — cada uma some POR CIMA
       de uma forma que continua ali. */
    const perto = []; // some acima de 12 m
    const medio = []; // some acima de 40 m

    /* ----------------------------------------------------------- o tronco --
     *
     * TRÊS formas, não uma. Um cilindro só é um barril, e foi o que a v1 era.
     * O que faz um torso parecer um torso não é a silhueta de frente — é a
     * mudança de SEÇÃO ao longo dele: a caixa torácica é achatada na frente e
     * atrás (z 0,68), a cintura é quase redonda (z 0,82), o quadril volta a
     * achatar (z 0,74). São três números, e é deles que sai a curva. */
    const peito = new THREE.Mesh(
      new THREE.CylinderGeometry(0.178, 0.128, 0.3, 22),
      mat.tunic,
    );
    peito.scale.set(1, 1, 0.7);
    peito.position.y = 0.36;
    peito.castShadow = true;
    peito.receiveShadow = true;
    spine.add(peito);

    const cintura = new THREE.Mesh(
      new THREE.CylinderGeometry(0.128, 0.112, 0.13, 22),
      mat.tunic,
    );
    cintura.scale.set(1, 1, 0.78);
    cintura.position.y = 0.155;
    cintura.castShadow = true;
    spine.add(cintura);

    const quadril = new THREE.Mesh(
      new THREE.CylinderGeometry(0.112, 0.142, 0.12, 22),
      mat.tunic,
    );
    quadril.scale.set(1, 1, 0.76);
    quadril.position.y = 0.03;
    quadril.castShadow = true;
    spine.add(quadril);

    /* A PELVE.
     *
     * Ela não estava aqui, e a falta apareceu na primeira olhada de perto: uma
     * faixa de calça clara entre a barra do tronco e o começo da saia. O tronco
     * é filho do `spine` e a saia é filha da PERNA, que a IK move — entre as
     * duas sempre haverá uma emenda, e é esta peça que a cobre. É a mesma razão
     * de a arqueira ter uma. */
    const pelve = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.128, 0.075, 5, 18),
      mat.tunic,
    );
    pelve.rotation.z = Math.PI / 2;
    pelve.scale.set(1, 1, 0.76);
    pelve.position.y = -0.012;
    pelve.castShadow = true;
    spine.add(pelve);

    /* O TRAPÉZIO — a cunha que desce do pescoço até o ombro.
     *
     * É a peça isolada que mais faz um corpo parecer humano. Sem ela o pescoço
     * sai do tronco em ângulo reto, e ângulo reto entre pescoço e ombro é a
     * assinatura de manequim de vitrine. Duas cápsulas inclinadas. */
    for (const lado of [-1, 1]) {
      const trapezio = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.05, 0.1, 4, 12),
        mat.tunic,
      );
      trapezio.rotation.z = lado * (Math.PI / 2 - 0.5);
      trapezio.scale.set(1, 1, 0.76);
      trapezio.position.set(lado * 0.082, H - 0.028, 0);
      trapezio.castShadow = true;
      spine.add(trapezio);
    }

    for (const lado of [-1, 1]) {
      const ombro = makeJoint(0.076, mat.tunic, 16);
      ombro.position.set(lado * BODY.shoulderX, H, 0);
      spine.add(ombro);
    }

    const pescoco = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.058, 0.1, 14),
      mat.skin,
    );
    pescoco.position.y = BODY.neckY - BODY.hipY - 0.03;
    pescoco.castShadow = true;
    spine.add(pescoco);

    /* A GOLA da túnica — a borda que denuncia a camada.
     *
     * Roupa sem borda é tinta, não roupa: o olho lê camada pela ESPESSURA dela.
     * Um anel 1,5 cm mais largo que o pescoço, e mais escuro, e o pano passa a
     * ter começo. Vale o mesmo para o punho, a barra e a volta da bota. */
    const gola = new THREE.Mesh(
      new THREE.CylinderGeometry(0.072, 0.083, 0.04, 16),
      mat.cloak,
    );
    gola.position.y = H + 0.03;
    spine.add(gola);
    medio.push(gola);

    /* O MANTO curto sobre os ombros.
     *
     * Cone aberto com a barra ONDULADA — a borda perfeitamente circular de um
     * cilindro é chapa, e as ondas dão as sombras verticais irregulares que o
     * olho lê como pano. Custa zero malhas: é um laço sobre vértices que já
     * existem (ver `ondularBarra`).
     *
     * A largura dele é metade da silhueta do personagem: 0,245 no manto contra
     * 0,112 na cintura são 2,19 : 1 de aperto. A v1 tinha 1,33 : 1, que é quase
     * nenhum — e é por isso que ela empilhava quatro cilindros da mesma
     * largura em vez de ter cintura. */
    const mantoGeo = ondularBarra(
      new THREE.CylinderGeometry(0.108, 0.245, 0.175, 24, 1, true),
      0.035,
      9,
    );
    const manto = new THREE.Mesh(mantoGeo, mat.cloak);
    manto.scale.set(1, 1, 0.92);
    manto.position.y = H - 0.008;
    manto.castShadow = true;
    spine.add(manto);

    /* ------------------------------------------------------- equipamento --
     *
     * A LISTA DE ASSIMETRIAS, e ela é obrigatória.
     *
     * Nada no mundo real é espelhado, e o cérebro sabe disso antes de saber
     * qualquer outra coisa sobre a figura. A v1 era simétrica em tudo — dois
     * braceletes iguais, duas ombreiras iguais — e simetria perfeita é, sozinha,
     * um sinal de brinquedo tão forte quanto a falta de cor.
     *
     *   direita: aljava nas costas, escarcela no cinto
     *   esquerda: adaga no quadril, ponta do cinto pendurada
     *   só no braço do arco: o bracelete
     *   um lado só: o rabicho do capuz
     */
    const cinto = new THREE.Mesh(
      new THREE.CylinderGeometry(0.118, 0.118, 0.072, 20),
      mat.leatherDark,
    );
    cinto.scale.set(1, 1, 0.82);
    cinto.position.y = 0.098;
    cinto.castShadow = true;
    spine.add(cinto);

    const fivela = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.044, 0.016),
      mat.metal,
    );
    fivela.position.set(0, 0.098, -0.1);
    spine.add(fivela);
    medio.push(fivela);

    // A ponta do cinto, pendurada e de um lado só.
    const pontaCinto = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.11, 0.008),
      mat.leatherDark,
    );
    pontaCinto.position.set(-0.055, 0.03, -0.098);
    pontaCinto.rotation.z = 0.14;
    spine.add(pontaCinto);
    medio.push(pontaCinto);

    // Escarcela à direita.
    const escarcela = new THREE.Mesh(
      new THREE.BoxGeometry(0.082, 0.098, 0.05),
      mat.leatherDark,
    );
    escarcela.position.set(0.126, 0.03, -0.02);
    escarcela.rotation.z = 0.1;
    escarcela.castShadow = true;
    spine.add(escarcela);
    medio.push(escarcela);

    // Adaga à esquerda — bainha e punho, inclinada para trás.
    const bainha = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.2, 0.022),
      mat.leatherDark,
    );
    bainha.position.set(-0.122, 0.0, 0.02);
    bainha.rotation.set(0.3, 0, 0.16);
    bainha.castShadow = true;
    spine.add(bainha);
    medio.push(bainha);

    const punhoAdaga = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.011, 0.07, 8),
      mat.wood,
    );
    punhoAdaga.position.set(-0.13, 0.13, 0.0);
    punhoAdaga.rotation.set(0.3, 0, 0.16);
    spine.add(punhoAdaga);
    medio.push(punhoAdaga);

    // Bandoleira cruzando o peito — a alça da aljava, e ela cruza num sentido só.
    const bandoleira = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.44, 0.014),
      mat.leatherDark,
    );
    bandoleira.position.set(0.02, H * 0.55, -0.105);
    bandoleira.rotation.z = 0.42;
    spine.add(bandoleira);

    /* A aljava. POSIÇÃO idêntica à da arqueira — `updateReloadArm` mira em
       (-0,1 / H·0,88 / 0,2) para pegar a flecha, e mexer nisso faz a mão
       pescar no ar. O que muda é a INCLINAÇÃO: 0,52 rad contra 0,34, para as
       empenas cruzarem o contorno do ombro em vez de sumirem contra as costas. */
    const aljava = new THREE.Mesh(
      new THREE.CylinderGeometry(0.054, 0.046, 0.34, 12),
      mat.wood,
    );
    aljava.position.set(-0.11, H * 0.62, 0.13);
    aljava.rotation.set(0.52, 0, -0.3);
    aljava.castShadow = true;
    spine.add(aljava);

    for (let i = 0; i < 4; i++) {
      const haste = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.26, 5),
        mat.arrowShaft,
      );
      const dx = (i % 2 ? 1 : -1) * 0.018;
      const dz = i < 2 ? 0.016 : -0.016;
      haste.position.set(-0.11 + dx, H * 0.62 + 0.2, 0.13 + dz);
      haste.rotation.set(0.52, 0, -0.3);
      spine.add(haste);
      medio.push(haste);

      const empena = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.075), mat.fletch);
      empena.position.copy(haste.position);
      empena.position.y += 0.09;
      empena.rotation.set(0.52, i * 0.8, -0.3);
      spine.add(empena);
      medio.push(empena);
    }

    /* ---------------------------------------------------------- a cabeça --
     *
     * A regra que organiza tudo aqui: o ROSTO É UMA MANCHA CLARA dentro do
     * escuro. A v1 errou exatamente isto — capuz escuro, barba subindo pela
     * bochecha e rosto na sombra deram uma bola preta sem feições. Um capuz
     * existe para EMOLDURAR um rosto claro, não para engoli-lo. */
    const head = new THREE.Group();
    head.position.y = BODY.headY - BODY.hipY;
    spine.add(head);

    const cranio = makeJoint(BODY.headR, mat.skin, 20);
    cranio.scale.set(1.0, 0.97, 1.03); // mandíbula quadrada, testa reta
    head.add(cranio);

    const R = BODY.headR;

    /* O CAPUZ — esfera com um vão de ~100° na frente.
     *
     * O vão já nasce virado para o rosto: no `SphereGeometry` do Three,
     * `phi = 0` aponta para -X e `phi = π/2` para +Z, então o arco coberto
     * [-0,22π, 1,22π] varre -X → +Z → +X e o que sobra é a fatia centrada em -Z
     * — a direção da mira. Copiar daqui o `rotation.y = -π/2` do cabelo da
     * arqueira (que é meia esfera e precisa dele) fecha o capuz por completo:
     * foi o primeiro erro desta peça, e o sintoma foi uma cabeça sem rosto.
     *
     * `DoubleSide` é obrigatório: a casca é ABERTA, e sem as duas faces a parte
     * de trás — cujas normais apontam para longe de quem olha de frente — é
     * descartada e aparece um buraco de céu dentro da cabeça. */
    const capuz = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.22, 20, 14, -Math.PI * 0.22, Math.PI * 1.44, 0, Math.PI * 0.78),
      mat.wool,
    );
    capuz.material.side = THREE.DoubleSide;
    capuz.rotation.set(-0.16, 0, 0);
    capuz.scale.set(1.02, 1.06, 1.1);
    capuz.position.set(0, 0.012, 0.014);
    capuz.castShadow = true;
    head.add(capuz);

    /* O FORRO — a borda que dá espessura ao capuz.
     *
     * Uma casca de uma superfície só termina numa aresta de zero milímetro, e
     * aresta de zero milímetro é papel. O forro é a mesma forma 5 % menor e mais
     * escura, recuada 1 cm no vão: olhando de frente vê-se lã, depois uma tira
     * escura, depois o rosto. É essa tira que o cérebro lê como "o capuz tem
     * pano de espessura". */
    const forro = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.16, 18, 12, -Math.PI * 0.18, Math.PI * 1.36, 0, Math.PI * 0.74),
      mat.cloak,
    );
    forro.material.side = THREE.DoubleSide;
    forro.rotation.copy(capuz.rotation);
    forro.scale.copy(capuz.scale);
    forro.position.copy(capuz.position);
    head.add(forro);
    medio.push(forro);

    /* A ponta do capuz saiu junto com o rabicho, e por um motivo diferente:
       medida contra a casca, ela emergia UM CENTÍMETRO. Era malha invisível
       pagando chamada de desenho e entrada no passe de sombra — o pior tipo de
       peça que existe, a que custa e não aparece. O capuz ficou uma abóbada
       lisa. Um bico de verdade é fácil de devolver: basta empurrá-lo uns 4 cm
       para fora da casca, e aí ele passa a ser silhueta em vez de enfeite
       enterrado. */

    /* O rosto. As POSIÇÕES são as mesmas da arqueira, e isso é contrato:
       `setDetailLevel` corta este conjunto acima de 12 m e a âncora da corda é
       medida a partir do centro da cabeça — mover a boca move a linha da
       flecha. O que muda é a MEDIDA das peças. */
    for (const lado of [-1, 1]) {
      const olho = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.15, 10, 8),
        mat.eyeWhite,
      );
      olho.position.set(lado * R * 0.38, R * 0.1, -R * 0.86);
      olho.scale.set(1, 1.02, 0.62);
      head.add(olho);
      perto.push(olho);

      const iris = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.082, 8, 6),
        mat.eyeDark,
      );
      iris.position.set(lado * R * 0.38, R * 0.1, -R * 0.95);
      iris.scale.set(1, 1, 0.55);
      head.add(iris);
      perto.push(iris);

      // Sobrancelha grossa e reta: é ela que fecha o olhar sob o capuz.
      const sobrancelha = new THREE.Mesh(
        new THREE.BoxGeometry(R * 0.36, R * 0.1, R * 0.1),
        mat.hair,
      );
      sobrancelha.position.set(lado * R * 0.38, R * 0.34, -R * 0.87);
      sobrancelha.rotation.z = lado * 0.08;
      head.add(sobrancelha);
      perto.push(sobrancelha);
    }

    const nariz = new THREE.Mesh(
      new THREE.ConeGeometry(R * 0.13, R * 0.32, 7),
      mat.skin,
    );
    nariz.rotation.x = -Math.PI / 2;
    nariz.position.set(0, -R * 0.06, -R * 0.97);
    head.add(nariz);
    perto.push(nariz);

    const boca = new THREE.Mesh(
      new THREE.BoxGeometry(R * 0.28, R * 0.05, R * 0.06),
      mat.mouth,
    );
    boca.position.set(0, -R * 0.42, -R * 0.86);
    head.add(boca);
    perto.push(boca);

    for (const lado of [-1, 1]) {
      const orelha = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.19, 8, 6),
        mat.skin,
      );
      orelha.position.set(lado * R * 0.92, -R * 0.02, 0);
      orelha.scale.set(0.42, 1, 0.72);
      head.add(orelha);
      perto.push(orelha);
    }

    /* A BARBA, e ela NÃO passa da linha da boca.
     *
     * Na v1 ela tomava a bochecha — e bochecha escura dentro de capuz escuro
     * apaga justamente a mancha clara que o capuz existe para emoldurar. Uma
     * peça só, no maxilar, abaixo da boca. */
    const barba = new THREE.Mesh(
      new THREE.CapsuleGeometry(R * 0.34, R * 0.16, 4, 12),
      mat.hair,
    );
    barba.position.set(0, -R * 0.66, -R * 0.34);
    barba.rotation.x = 0.42;
    barba.scale.set(1.05, 1, 0.8);
    head.add(barba);
    medio.push(barba);

    /* SEM RABICHO.
     *
     * O capuz teve um liripipe — o rabicho de pano que os capuzes medievais têm
     * de verdade, pendurado atrás e balançando na cadeia de `sway`. Saiu a
     * pedido: pendurado na cabeça ele lia como apêndice, não como roupa, e
     * roubava a atenção da única coisa que a cabeça precisa dizer de longe, que
     * é a forma do capuz.
     *
     * `sway: null` é um valor previsto pelo contrato, e o rig sai de
     * `updateSway` na primeira linha quando não há o que balançar (skin careca é
     * skin válida). A ponta do capuz continua: ela é a silhueta do capuz, não um
     * pingente. */

    /* ------------------------------------------------ braços e pernas ----- */
    const armR = buildArm(mat, true, perto, medio); // braço do arco: leva o bracelete
    const armL = buildArm(mat, false, perto, medio);
    const legR = buildLeg(mat, medio);
    const legL = buildLeg(mat, medio);

    return {
      head,
      detail: { perto, medio },
      sway: null,
      armR,
      armL,
      legR,
      legL,
    };
  },
};

/* --------------------------------------------------------------- membros --- */

/* Os PERFIS dos membros: pares [altura 0..1, raio em metros], da raiz para a
   ponta. É aqui que mora a anatomia deste corpo, e ela custa zero malhas — o
   torneado é esticado pela IK exatamente como a cápsula era (ver
   `makeMuscleSegment`).

   Cada perfil tem a mesma história: massa no terço de cima, afunilamento até a
   junta. É o que separa um membro de um cano. */
const PERFIL_BRACO = [
  [0, 0.058],
  [0.16, 0.068], // deltoide
  [0.42, 0.062], // bíceps
  [0.78, 0.05],
  [1, 0.044],
];
const PERFIL_ANTEBRACO = [
  [0, 0.05],
  [0.22, 0.054], // a massa do antebraço, logo abaixo do cotovelo
  [0.72, 0.038],
  [1, 0.032], // punho
];
const PERFIL_COXA = [
  [0, 0.096],
  [0.22, 0.104], // quadríceps
  [0.72, 0.078],
  [1, 0.068],
];
const PERFIL_CANELA = [
  [0, 0.072],
  [0.2, 0.078], // panturrilha
  [0.68, 0.046],
  [1, 0.038], // tornozelo
];

function buildArm(mat, comBracelete, perto, medio) {
  const group = new THREE.Group();
  const upper = makeMuscleSegment(PERFIL_BRACO, mat.linen, 20);
  const fore = makeMuscleSegment(PERFIL_ANTEBRACO, mat.linen, 20);
  const elbow = makeJoint(0.052, mat.linen, 14);

  /* O PUNHO da manga — a borda de novo. Sem ela a manga de linho encosta na
     luva escura sem transição, e duas cores encostadas sem borda leem como uma
     peça pintada de duas cores. */
  const punho = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.038, 0.03, 14),
    mat.cloak,
  );
  fore.add(punho);
  punho.position.y = 0.94; // espaço unitário do segmento: quase na ponta
  punho.scale.y = 3.2; // desfaz o achatamento que a IK impõe aos filhos
  medio.push(punho);

  /* ------------------------------------------------------------- a mão ---
   *
   * Em primeira pessoa a mão do arco fica a meio metro do olho: é o pedaço do
   * corpo mais visto do jogo inteiro. Daí ela ganhar duas falanges e nós, e
   * daí esse detalhe viver no nível de PERTO — a doze metros ele não desenha
   * nada, e pagá-lo em doze arqueiros seria absurdo. */
  const hand = new THREE.Group();
  const palma = new THREE.Mesh(
    new THREE.BoxGeometry(0.062, 0.082, 0.036),
    mat.glove,
  );
  palma.castShadow = true;
  hand.add(palma);

  // O dorso, um pouco mais estreito: duas formas onde a v1 tinha uma.
  const dorso = new THREE.Mesh(
    new THREE.BoxGeometry(0.056, 0.05, 0.022),
    mat.glove,
  );
  dorso.position.set(0, 0.03, -0.02);
  hand.add(dorso);
  medio.push(dorso);

  for (let i = 0; i < 4; i++) {
    const largura = 0.05 - Math.abs(i - 1.5) * 0.008;
    // Falange de baixo: continua existindo a média distância.
    const dedo = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.0102, largura * 0.55, 3, 6),
      mat.glove,
    );
    dedo.position.set(-0.021 + i * 0.014, 0.058, 0.002);
    dedo.rotation.x = -0.22;
    hand.add(dedo);
    medio.push(dedo);

    // Falange da ponta e o nó entre as duas: só de perto.
    const ponta = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.0092, largura * 0.42, 3, 6),
      mat.glove,
    );
    ponta.position.set(-0.021 + i * 0.014, 0.058 + largura * 0.55, 0.012);
    ponta.rotation.x = -0.62;
    hand.add(ponta);
    perto.push(ponta);

    const no = new THREE.Mesh(
      new THREE.SphereGeometry(0.0108, 6, 5),
      mat.glove,
    );
    no.position.copy(ponta.position).y -= largura * 0.28;
    hand.add(no);
    perto.push(no);
  }

  const polegar = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.0122, 0.03, 3, 6),
    mat.glove,
  );
  polegar.position.set(0.034, 0.018, -0.014);
  polegar.rotation.set(-0.2, 0, 0.9);
  hand.add(polegar);
  medio.push(polegar);

  const polegarPonta = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.0102, 0.022, 3, 6),
    mat.glove,
  );
  polegarPonta.position.set(0.052, 0.044, -0.006);
  polegarPonta.rotation.set(-0.5, 0, 0.7);
  hand.add(polegarPonta);
  perto.push(polegarPonta);

  // A costura da luva, no dorso. Detalhe de primeira pessoa, e só.
  const costura = new THREE.Mesh(
    new THREE.BoxGeometry(0.004, 0.05, 0.004),
    mat.leatherDark,
  );
  costura.position.set(0, 0.03, -0.031);
  hand.add(costura);
  perto.push(costura);

  /* O BRACELETE, e ele existe num braço só.
   *
   * Dois braceletes iguais em posições espelhadas leem como parte do corpo;
   * um só lê como EQUIPAMENTO — e é no braço do arco que a corda raspa, então
   * é o braço certo. O outro braço devolve um grupo vazio porque `poseArm`
   * escreve posição e rotação em `arm.band` todo quadro: sem um objeto ali,
   * a pose quebra. Um grupo vazio custa zero desenho. */
  let band;
  if (comBracelete) {
    band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.056, 0.052, 0.115, 14),
      mat.leatherDark,
    );
    band.castShadow = true;
    for (const y of [-0.032, 0.032]) {
      const tira = new THREE.Mesh(
        new THREE.CylinderGeometry(0.058, 0.054, 0.014, 14),
        mat.leatherDark,
      );
      tira.position.y = y;
      band.add(tira);
      medio.push(tira);
    }
    const fivelinha = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.018, 0.012),
      mat.metal,
    );
    fivelinha.position.set(0.055, 0.032, 0);
    band.add(fivelinha);
    perto.push(fivelinha);
  } else {
    band = new THREE.Group();
  }

  group.add(upper, fore, elbow, hand, band);
  return { group, upper, fore, elbow, hand, band };
}

function buildLeg(mat, medio) {
  const group = new THREE.Group();
  const thigh = makeMuscleSegment(PERFIL_COXA, mat.hose, 20);
  const shin = makeMuscleSegment(PERFIL_CANELA, mat.hose, 20);
  const knee = makeJoint(0.074, mat.hose, 14);

  /* A barra da túnica sobre a coxa — a peça que a IK orienta do quadril até a
     meia coxa (é o `short` do contrato; na arqueira é a bermuda).

     Ela é um TORNEADO com a barra ondulada, e não um cilindro: é a saia do
     gambeson, e uma saia que termina num círculo perfeito é chapa de metal.
     A v1 tinha, além disto, um saiote rígido preso ao TRONCO — que alargava o
     quadril exatamente onde a silhueta precisa afinar, e que a perna atravessava
     ao andar. Aqui quem cobre a coxa é esta peça, que anda junto com ela. */
  const short = makeMuscleSegment(
    [
      [0, 0.118],
      [0.55, 0.128],
      [1, 0.134],
    ],
    mat.tunic,
    20,
  );
  ondularBarra(short.geometry, 0.045, 7, "max");
  short.userData.isShort = true;

  /* A BOTA. O grupo do pé é posicionado sem escala pela pose (`poseLegTo` só
     escreve posição e rotação), então aqui os filhos são seguros — é o único
     lugar do corpo onde se pode empilhar peça à vontade. */
  const shoe = new THREE.Group();
  const sola = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.032, 0.235), mat.leatherDark);
  sola.position.set(0, 0.016, -0.02);
  sola.castShadow = true;
  const salto = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.028, 0.07), mat.leatherDark);
  salto.position.set(0, 0.044, 0.06);
  const cano = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.14, 0.148), mat.leatherDark);
  cano.position.set(0, 0.102, 0.026);
  cano.castShadow = true;
  const bico = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.052, 0.088), mat.leatherDark);
  bico.position.set(0, 0.056, -0.102);
  // A volta do cano, dobrada para fora: a borda que dá espessura ao couro.
  const volta = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.03, 0.162), mat.wood);
  volta.position.set(0, 0.178, 0.026);
  shoe.add(sola, salto, cano, bico, volta);
  medio.push(salto, volta);

  group.add(thigh, shin, knee, shoe, short);
  return { group, thigh, shin, knee, shoe, short };
}
