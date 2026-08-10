/* ---------------------------------------------------------------------------
   A REGRA DE PROPRIEDADE, e o único lugar que a aplica.

   O jogo tem fases: uma é destruída, a outra é construída. Isso só é seguro se
   estiver claro, para cada geometria, material e textura, QUEM é o dono — e a
   resposta não pode ser "quem lembrar".

   Existem dois tipos de recurso:

   • DE FASE. Nasce dentro do `build()` de uma fase e morre dentro do
     `dispose()` dela. É a esmagadora maioria: a malha do terreno, as copas, os
     materiais do foguete.

   • DE MÓDULO. É `const` no topo de um arquivo, criado uma vez e compartilhado
     por todas as instâncias de propósito — para não alocar trinta vezes a mesma
     esfera. `entities/zombie.js`, `entities/boar.js`, `entities/wolf.js`,
     `entities/target.js`, `entities/bird.js`, `entities/elk.js` e
     `systems/torches.js` fazem isso, e `entities/environment.js` faz com a
     textura de grão do terreno.

   Destruir um recurso de módulo junto com uma fase é o bug clássico deste tipo
   de sistema, e ele é traiçoeiro por um motivo específico: **não aparece na
   fase que você quebrou, aparece na próxima**. Você sai do vale, entra na Lua,
   volta ao vale — e o chão está preto. A causa ficou duas trocas atrás.

   A defesa é declarativa: quem cria um recurso de módulo o envolve em
   `shared()`, e `disposeSubtree()` nunca encosta nele. Não depende de ninguém
   lembrar de uma lista de exceções ao escrever o `dispose()`.
   --------------------------------------------------------------------------- */

/**
 * Recursos que sobrevivem a qualquer troca de fase.
 *
 * É um `Set` de identidade, não de nomes: guarda a própria textura/material, de
 * modo que a proteção acompanha o objeto mesmo que ele seja passado adiante,
 * clonado de referência ou enfiado num uniform de shader — que é justamente o
 * caso da textura de grão do terreno, invisível para quem varre `material.map`.
 */
const SHARED = new Set();

/**
 * Marca um recurso como DE MÓDULO. Devolve o próprio recurso, para poder
 * envolver a criação sem uma linha a mais:
 *
 * ```js
 * const CHAMA = shared(new THREE.MeshBasicMaterial({ color: 0xffb347 }));
 * ```
 */
export function shared(resource) {
  if (resource) SHARED.add(resource);
  return resource;
}

/** Este recurso é de módulo (e portanto imortal)? */
export function isShared(resource) {
  return SHARED.has(resource);
}

/**
 * Devolve à GPU tudo o que pende de uma subárvore, menos o que é de módulo.
 *
 * `scene.remove(grupo)` NÃO libera memória de vídeo: o buffer de vértices e a
 * textura continuam alocados até alguém chamar `dispose()` neles. É por isso
 * que esta função existe e é por isso que ela é obrigatória no caminho de troca
 * de fase.
 *
 * Materiais e geometrias são coletados em `Set` antes de serem destruídos
 * porque o compartilhamento DENTRO de uma fase é comum e legítimo — 180 rochas
 * dividem um material só. Sem o `Set`, o mesmo material seria destruído 180
 * vezes; a segunda em diante é inofensiva no Three, mas a contagem que este
 * módulo devolve (e que o critério de aceite compara) mentiria feio.
 *
 * As texturas saem do próprio material, por varredura das propriedades: os
 * slots são muitos (`map`, `normalMap`, `alphaMap`, `emissiveMap`…) e uma lista
 * escrita à mão envelhece mal.
 *
 * NÃO mexe em física. Corpos e colisores do Rapier são varridos de uma vez por
 * `PhysicsWorld.recreate()`, que garante por construção o que uma varredura
 * manual garantiria só por disciplina.
 *
 * @returns {{geometries: number, materials: number, textures: number}}
 */
export function disposeSubtree(root) {
  const geometrias = new Set();
  const materiais = new Set();

  root.traverse((o) => {
    if (o.geometry) geometrias.add(o.geometry);
    const m = o.material;
    if (Array.isArray(m)) for (const um of m) materiais.add(um);
    else if (m) materiais.add(m);
    // InstancedMesh guarda buffers próprios (matrizes e cores por instância)
    // que não estão na geometria nem no material.
    if (o.isInstancedMesh) o.dispose();
  });

  const contagem = { geometries: 0, materials: 0, textures: 0 };

  for (const geo of geometrias) {
    if (SHARED.has(geo)) continue;
    geo.dispose();
    contagem.geometries++;
  }

  for (const mat of materiais) {
    if (SHARED.has(mat)) continue;
    for (const chave of Object.keys(mat)) {
      const valor = mat[chave];
      if (valor?.isTexture && !SHARED.has(valor)) {
        valor.dispose();
        contagem.textures++;
      }
    }
    mat.dispose();
    contagem.materials++;
  }

  root.parent?.remove(root);
  root.clear();

  return contagem;
}
