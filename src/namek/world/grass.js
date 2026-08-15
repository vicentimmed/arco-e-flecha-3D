/* ---------------------------------------------------------------------------
   O mato da clareira de Namekusei.

   ------------------------------------------------------------------ por que

   O chão ganhou grão (`world/detail.js`) e isso resolveu a superfície, mas não
   resolveu a ESCALA: sem nada de pé no campo, não há como o olho medir o
   tamanho de uma cratera de trinta metros contra um chão que não tem
   referência nenhuma. Os tufos são a régua.

   --------------------------------------------------------------- a densidade

   A clareira tem 200 m de raio. Cobri-la na densidade que a fase Sandbox usa
   (que é a de um jardim visto de perto) pediria mais de cem mil tufos. Aqui
   são poucos milhares, ESPALHADOS: a leitura pretendida não é um gramado, é um
   campo aberto com touceiras — e é a que cabe num modo em que o jogador passa
   metade do tempo a cem metros de altura.

   --------------------------------------------------------------- e a cratera

   Tufo dentro do buraco MORRE, e não volta. É a mesma regra do Sandbox, e ela
   é determinística: mesma semente, mesmos tufos; mesma lista de crateras,
   mesmos mortos. Por isso quem entra no meio da partida chega com exatamente
   os mesmos claros no campo que todo mundo já vê, sem que nada disso viaje
   pela rede.
   --------------------------------------------------------------------------- */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom } from "../../utils/math.js";
import { NAMEK } from "../../shared/namek/config.js";

/** Quantos tufos. Um `InstancedMesh` só, uma chamada de desenho. */
const QUANTIDADE = 7000;
/** m — raio da região semeada. Acompanha a clareira do relevo. */
const ALCANCE = 205;
/** m — altura de um tufo. */
const ALTURA = 1.15;
/* m — a partir daqui o tufo encolhe, e some de vez no segundo número. Sem
   isso, sete mil quadriláteros de um metro a duzentos metros de distância
   viram um véu cinza sobre o campo inteiro. */
const FADE = 90;
const FADE_FIM = 150;

const _obj = new THREE.Object3D();

/**
 * A textura de um tufo, desenhada em código — pelo mesmo motivo do grão do
 * chão: o repositório não carrega arquivo de imagem.
 *
 * As lâminas puxam para o turquesa, e não para o verde de grama: é a mesma
 * decisão da paleta do terreno, e um tufo verde-terrestre num campo ciano
 * denuncia os dois.
 */
function texturaDeTufo() {
  const S = 64;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, S, S);
  const laminas = [
    [32, 0.0, "#49b98a"],
    [22, -0.35, "#3aa87a"],
    [42, 0.35, "#5fc79b"],
    [14, -0.6, "#2f9a72"],
    [50, 0.6, "#54c092"],
  ];
  for (const [bx, inclina, cor] of laminas) {
    ctx.beginPath();
    ctx.moveTo(bx - 3.2, S);
    ctx.quadraticCurveTo(bx + inclina * 14, S * 0.45, bx + inclina * 26, S * 0.06);
    ctx.quadraticCurveTo(bx + inclina * 14 + 3.5, S * 0.5, bx + 3.2, S);
    ctx.closePath();
    ctx.fillStyle = cor;
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class NamekGrass {
  /** @param {import("../../shared/namek/field.js").NamekField} field */
  constructor(field) {
    this.field = field;
    this.mesh = null;
    /** Os tufos vivos. Encolhe quando uma cratera come um pedaço do campo. */
    this.tufos = [];
    /** Uniforms do balanço, compartilhados com o shader. */
    this.uniforms = {
      tempo: { value: 0 },
      vento: { value: 0.1 },
    };
  }

  build(parent) {
    const material = new THREE.MeshStandardMaterial({
      map: texturaDeTufo(),
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
    });
    this.aplicarBalanco(material);

    const plano = new THREE.PlaneGeometry(0.9, ALTURA);
    plano.translate(0, ALTURA / 2, 0);
    const cruzado = plano.clone();
    cruzado.rotateY(Math.PI / 2);
    const geo = mergeGeometries([plano, cruzado]);

    this.mesh = new THREE.InstancedMesh(geo, material, QUANTIDADE);
    this.mesh.name = "namek-mato";
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    /* DYNAMIC porque uma cratera pode apagar tufos a qualquer momento. */
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const rnd = makeRandom((NAMEK.world.seed ^ 0x9a71) >>> 0);
    const mar = this.field.seaLevel;
    let tentativas = 0;
    while (this.tufos.length < QUANTIDADE && tentativas++ < QUANTIDADE * 8) {
      /* sqrt(u) e não u: a área de um anel cresce com o raio, e amostrar sem a
         raiz empilha tudo no meio da clareira. */
      const ang = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * ALCANCE;
      const x = Math.cos(ang) * d;
      const z = Math.sin(ang) * d;
      const y = this.field.heightAt(x, z);
      // nada de mato dentro d'água nem em parede
      if (y < mar + 2) continue;
      if (this.field.slopeAt(x, z, 1.5) < 0.82) continue;
      const s = 0.7 + rnd() * 0.9;
      this.tufos.push({ x, y, z, ry: rnd() * Math.PI, s, sy: s * (0.75 + rnd() * 0.6) });
    }

    for (let i = 0; i < this.tufos.length; i++) this.escrever(i, this.tufos[i]);
    this.mesh.count = this.tufos.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    parent.add(this.mesh);

    /* O campo já pode chegar cheio de buracos — é o caso de quem entra no meio
       da partida. Os claros são abertos aqui, na construção. */
    for (const c of this.field.craters) this.cortarNoRaio(c.x, c.z, c.raio);
    return this;
  }

  escrever(i, t) {
    _obj.position.set(t.x, t.y - 0.05, t.z);
    _obj.rotation.set(0, t.ry, 0);
    _obj.scale.set(t.s, t.sy, t.s);
    _obj.updateMatrix();
    this.mesh.setMatrixAt(i, _obj.matrix);
  }

  /**
   * Some com o mato que a cratera engoliu.
   *
   * Recompacta o lote em vez de zerar a escala, ao contrário do que as PEÇAS
   * fazem (`NamekScenery.breakProp`): a diferença é que um tufo não tem índice
   * na rede, então renumerar não confunde ninguém — e recompactar deixa
   * `mesh.count` menor, o que economiza vértice de verdade.
   */
  cortarNoRaio(cx, cz, raio) {
    if (!this.mesh || !this.tufos.length) return 0;
    const r2 = raio * raio;
    const sobrou = this.tufos.filter((t) => {
      const dx = t.x - cx;
      const dz = t.z - cz;
      return dx * dx + dz * dz > r2;
    });
    const mortos = this.tufos.length - sobrou.length;
    if (!mortos) return 0;

    for (let i = 0; i < sobrou.length; i++) this.escrever(i, sobrou[i]);
    this.mesh.count = sobrou.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tufos = sobrou;
    return mortos;
  }

  /** 0 = brisa, 1 = vendaval. O mesmo dial do resto do mundo. */
  setStorm(t) {
    this.uniforms.vento.value = 0.1 + t * 0.55;
  }

  update(dt, tempoSala = 0) {
    this.uniforms.tempo.value =
      tempoSala > 0 ? (tempoSala / 1000) % 3600 : this.uniforms.tempo.value + dt;
  }

  /**
   * O balanço e o sumiço por distância, os dois no vértice.
   *
   * Mesma técnica de `applyGroundCoverShader` no vale: a ponta do tufo se
   * desloca e a base fica presa, com fase tirada da posição da instância para
   * o campo inteiro não ondular em uníssono.
   */
  aplicarBalanco(material) {
    const u = this.uniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.tempo = u.tempo;
      shader.uniforms.vento = u.vento;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float tempo;
           uniform float vento;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float pontaT = clamp(position.y / ${ALTURA.toFixed(2)}, 0.0, 1.0);
           vec3 iPos = instanceMatrix[3].xyz;
           float fase = iPos.x * 0.6 + iPos.z * 0.45;
           float s = sin(tempo * 1.7 + fase) + 0.45 * sin(tempo * 3.3 + fase * 1.7);
           transformed.x += vento * pontaT * pontaT * (0.55 + 0.45 * s);
           {
             vec3 wp = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
             float d = distance(wp.xz, cameraPosition.xz);
             transformed.xyz *= 1.0 - smoothstep(${FADE.toFixed(1)}, ${FADE_FIM.toFixed(1)}, d);
           }`,
        );
    };
    material.customProgramCacheKey = () => "namek-mato";
  }

  dispose() {
    this.mesh = null;
    this.tufos = [];
  }
}
