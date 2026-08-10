# Plano — Sistema de fases

Como o jogo passa a ter **fases** de verdade: uma é destruída, a outra é
construída, com carregamento entre elas. É infraestrutura — sobrevive à Lua e é
o que permite, no futuro, uma tela de seleção de fases.

O cenário lunar, que é a primeira fase nova, está em
[`plano-lua.md`](plano-lua.md).

---

## 1. Por que isto existe

Hoje o mundo é construído **uma vez** no arranque (`createEnvironment()`, em
`main.js:94`) e nunca é desmontado. Terreno, ~200 árvores, ~180 rochas, cercas,
grama e bandeirolas entram no mundo Rapier e na cena Three e ficam lá até a aba
fechar.

A alternativa que se costuma tentar — esconder o cenário antigo com
`visible = false` — não funciona, e é importante entender por quê: **o jogo tem
um mundo de física só.** Esconder a malha some com o desenho e **deixa o
colisor**. O jogador bateria em troncos invisíveis e as flechas cravariam no ar,
dentro de uma copa que ninguém vê. Contornar isso exigiria listas de colisores e
um `setEnabled(false)` disciplinado em cada peça — e disciplina é exatamente o
que falha na terceira fase.

O caminho certo é destruir e reconstruir. E a boa notícia é que **o projeto já
está quase lá**.

### O padrão já existe

| Sistema | Tem `dispose()`/`clear()` | Nasce e morre com |
|---|---|---|
| `systems/torches.js` | ✅ | modo zumbi |
| `systems/boarManager.js` | ✅ | modo caçada |
| `systems/elkManager.js` | ✅ | modo alce |
| `systems/birdManager.js` | ✅ | modo pássaros |
| `systems/zombieManager.js` | ✅ | modo zumbi |
| `game/targetSeries.js` | ✅ | modo série |
| `systems/trails.js` | ✅ | por traçado |
| **`entities/environment.js`** | ❌ | **nunca morre** |

Não é um padrão novo a inventar: é **um padrão já estabelecido no repo, aplicado
à única peça que ficou de fora**.

---

## 2. O contrato

Uma fase é uma classe com dois métodos e um punhado de propriedades declaradas.

```js
class Fase {
  static id = "valley";
  static nome = "Vale";
  static modos = ["free", "duel", "boarHunt", "series", "elkHunt", "zombie", …];

  /** Campo de altura — PURO, compartilhado com o servidor. */
  static campo() { return new TerrainField(); }

  /** Constrói tudo. `progresso(0..1, texto)` alimenta a barra de carregamento. */
  async build(ctx, progresso) { … }

  /** Devolve TUDO o que `build` criou. Nada sobra. */
  dispose() { … }
}
```

### O que a fase possui, e o que não

| Da fase (morre com ela) | De fora da fase (sobrevive) |
|---|---|
| Campo de altura (cliente **e** servidor) | Jogador, arco, faca |
| Malha do terreno + colisor | Flechas, traçados |
| Cenário: vegetação, props, base lunar | HUD, rede, áudio, entrada |
| Céu, luz, névoa | Câmera |
| Gravidade, densidade do ar, vento | Placar |
| Salto, jetpack | Pool de partículas |
| Onde se nasce | Diálogos |
| **Quais modos aceita** | |

A última linha é o que separa **fase** de **modo** de vez, e é o que torna a tela
de seleção futura um simples laço sobre o registro.

### A regra de propriedade — a armadilha do "destrua e recrie"

Oito arquivos (`torches`, `bird`, `boar`, `wolf`, `target`, `zombie`, `elk`)
guardam materiais e geometrias em **nível de módulo**, compartilhados entre todas
as instâncias de propósito, para não alocar trinta vezes a mesma coisa.

Se um `dispose()` de fase encostar num desses, **a fase seguinte nasce preta**. O
bug não aparece onde foi causado — aparece na próxima troca, o que o torna caro
de diagnosticar. Daí a regra, que vai escrita no topo do módulo de fases:

> **Recurso de módulo nunca é destruído por fase.** Recurso de fase nasce dentro
> do `build()` e morre dentro do `dispose()`. Se um material é `const` no topo de
> um arquivo, ele não pertence a fase nenhuma.

---

## 3. O mundo de física: recriar, não limpar

Remover corpo por corpo funciona até alguém esquecer um. Em vez disso, o
`PhysicsWorld` ganha:

```js
recreate() {
  // o INVÓLUCRO continua o mesmo objeto — todas as referências
  // `this.physics` espalhadas pelo jogo seguem válidas
  this.world.free?.();
  this.world = new RAPIER.World({ x: 0, y: gravidadeDaFase, z: 0 });
  this.world.timestep = CONFIG.physics.fixedStep;
  this.eventQueue = new RAPIER.EventQueue(true);
  this.colliderOwners.clear();
  // beforeStep / onContact são PRESERVADOS: quem assinou continua assinado
}
```

Por que assim: **fica impossível esquecer um colisor.** Não é disciplina, é
construção — e é a diferença entre um sistema que aguenta a décima fase e um que
começa a vazar na terceira.

O custo é reconstruir os poucos corpos que sobrevivem à troca:

| Dono | Corpos | Como |
|---|---|---|
| `PlayerPhysics` | 1 cápsula | `rebuild()` |
| `RemoteBody` (por jogador remoto) | até 11 cápsulas | `rebuild()` |
| `ArrowManager` | pool | esvaziado na troca — flecha não atravessa fase |
| Alvos, bichos, tochas | — | já são do modo, já morrem sozinhos |

---

## 4. O registro

```js
export const FASES = { valley: ValleyLevel, moon: MoonLevel };
```

Uma entrada por fase, com `id`, `nome`, `modos` e a classe. A sala valida contra
ele; o cliente constrói a partir dele; a tela de seleção futura o percorre. Fase
nova = um arquivo + uma linha.

---

## 5. A troca

O mecanismo de espera coordenada **já existe**: o handshake `MODE_PREPARE`,
construído para a noite dos zumbis (`main.js:970`, `room.js:480`), já tem barra
de progresso, já espera todos os clientes aquecerem e só então a sala confirma.
É exatamente a troca de fase, com outro nome — só precisa deixar de ser
específico do zumbi (`main.js:971` filtra por `isZombieMode`).

```
  jogador aperta a tecla da fase
            │
            ▼
  sala  ──▶ MODE_PREPARE { level, token }  ──▶ todos os clientes
            │                                        │
            │                              fase.dispose()  (antiga)
            │                              physics.recreate()
            │                              fase.build()    (nova)
            │                              barra de progresso
            │                                        │
            │◀──────  MODE_READY { token }  ─────────┘
            │
   todos prontos (ou estourou o timeout de 12 s)
            ▼
  sala troca o terreno, sorteia nascimentos e anuncia LEVEL + MODE
```

Quem entra no meio recebe a fase atual no `welcome` e carrega antes de aparecer.

**Servidor:** `Room.level`, com `get terrain()` devolvendo o campo da fase ativa.
Como o servidor não desenha nada, do lado dele "trocar de fase" é trocar uma
instância de campo de altura e revalidar o modo em curso contra `Fase.modos`.

---

## 6. Critério de aceite

No espírito da tabela do README, e mensurável:

| Teste | Resultado esperado |
|---|---|
| `vale → vale` (destruir e reconstruir o mesmo) | Nada muda na tela |
| 10 idas e voltas `vale ⇄ lua` | `renderer.info.memory.geometries` e `.textures` voltam à linha de base |
| Idem | Contagem de corpos do Rapier volta à linha de base |
| Tempo de troca | Medido e exibido no painel `~` |

**O primeiro nível a ser destruído e reconstruído é o vale, não a Lua.** É um
teste que se verifica olhando — se nada muda na tela, o caminho inteiro está
certo — e ele exercita a mecânica sem nenhuma variável nova. Construir a Lua
primeiro misturaria "bug de fase nova" com "bug de sistema novo".

---

## 7. Arquivos

### Novos

| Arquivo | O que é |
|---|---|
| `src/levels/index.js` | Registro, regra de propriedade, tipo `Fase` |
| `src/levels/valleyLevel.js` | O vale de hoje, embrulhado no contrato |
| `src/levels/moonLevel.js` | A Lua (ver `plano-lua.md`) |

### Modificados

| Arquivo | Mudança |
|---|---|
| `src/core/physics.js` | `recreate()` preservando invólucro e assinaturas |
| `src/entities/environment.js` | Ganha `dispose()`; passa a ser chamado pela fase do vale |
| `src/systems/playerPhysics.js` | `rebuild()` após troca de mundo |
| `src/net/remotePlayers.js` | `rebuild()` das cápsulas remotas |
| `src/main.js` | `this.level`, `changeLevel()`, preparação genérica |
| `src/ui/hud.js` | Barra de carregamento deixa de dizer "preparando a noite" |
| `src/shared/protocol.js` | `level` nas mensagens de modo e no `welcome` |
| `server/room.js` | `Room.level`, validação de modo por fase |

---

## 8. Fases da implementação

| Etapa | Entrega | Prova |
|---|---|---|
| **F0.1** | `environment.dispose()` + regra de propriedade | Sem vazamento ao destruir |
| **F0.2** | `PhysicsWorld.recreate()` + `rebuild()` do jogador e dos remotos | Mundo novo, jogo continua |
| **F0.3** | Contrato, registro, `ValleyLevel`, `changeLevel()` | **`vale → vale` sem diferença visível** |
| **F0.4** | Handshake genérico, `Room.level`, protocolo | Troca sincronizada entre dois clientes |
| **F0.5** | Critérios de aceite no painel `~` | Números voltando à linha de base |

Só depois disso a Lua entra como fase #2.

---

## 9. Riscos

| Risco | Mitigação |
|---|---|
| `dispose()` pegar material de módulo → fase seguinte preta | Regra de propriedade escrita + a auditoria de `const` no topo dos 8 arquivos |
| Referência velha ao terreno após a troca | O terreno passa a ser lido da fase ativa, não capturado no construtor (hoje são 10 capturas) |
| Carregamento longo em máquina fraca | Barra de progresso já existe; timeout de 12 s já existe |
| Troca no meio de um tiro / de uma morte | `resetWorld()` da sala já limpa flechas, bichos e placar |
| `RAPIER.World` antigo não liberado | `free()` explícito no `recreate()` + contagem de corpos no critério de aceite |
