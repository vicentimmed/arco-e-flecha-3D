# Namekusei — o modo de luta aérea

> **Referência declarada:** *Dragon Ball Z: Budokai Tenkaichi 3* (PS2, 2007).
> Voo livre em arena esférica, rajadas de ki, especiais que enchem a tela,
> cenário que se destrói e cratera onde o golpe bate. É disso que este modo tenta
> chegar perto — não de uma homenagem vaga, mas do jeito específico com que
> aquele jogo se sente na mão.

---

## 0. A regra que manda em todas as outras

**Este modo não pode encostar no jogo de arco e flecha.**

Não é um pedido de organização, é o requisito principal. O jogo atual —
vale, Lua, castelo, cerco, chuva, zumbi, as dezenas de sistemas em `src/` e os
5 700 linhas de `server/room.js` — precisa continuar funcionando **byte por
byte** como funciona hoje, com o modo novo instalado ao lado.

Daí três decisões que não estão em negociação:

1. **Namekusei NÃO é uma fase de `shared/levels.js`.** Entrar lá o poria na
   rotação de fases do arqueiro (tecla 9), no `levelForMode`, no `fallbackMode`
   e na checagem de integridade de `levels/index.js`. É um JOGO à parte que
   compartilha o servidor e a tela de entrada, não a quarta fase do arqueiro.

2. **Namekusei não usa Rapier.** O jogo do arqueiro tem um mundo de física só, e
   dividi-lo é como o `LevelManager` já avisa: colisor fantasma, ponteiro morto,
   pânico do WASM. Aqui a colisão é analítica contra o campo de altura — mais
   leve, mais rápida, mais fácil de sincronizar, e sem nenhuma superfície de
   contato com o mundo do arqueiro. Ver §4.

3. **Todo arquivo novo mora em pasta própria:** `src/namek/` (cliente),
   `src/shared/namek/` (os dois lados), `server/namek/` (sala). Os únicos
   arquivos existentes que podem ser tocados são os quatro listados no §11, e
   só com os acréscimos descritos lá.

---

## 1. O que o jogo é

Um **mata-mata aéreo** para até **15 jogadores** — humanos, bots ou mistura — no
planeta Namekusei. Cada um tem vida e ki. Quem morre reaparece depois de alguns
segundos, piscando e invulnerável. Não há fim de partida: é campo aberto, como o
`free` do vale, mas com placar de abates.

O tempo do planeta tem **dois climas**, e eles são a mesma arena com outra luz:

| Clima | O que é |
|---|---|
| `dia` | O céu verde-claro de Namekusei, três sóis, mar turquesa, calmaria. |
| `tempestade` | O planeta indo embora — céu vermelho, raios, tremor, fissuras de magma. É a batalha contra Freeza nos cinco minutos finais. |

---

## 2. Escala do mundo

Arena **circular de 900 m de raio**, teto de voo em **520 m**, chão descendo até
o mar em −8 m. É grande de propósito: o pedido é espaço para voar, e um combate
aéreo a 60 m/s come 900 m em quinze segundos.

O tamanho **não** custa memória proporcional — ver §3 e §4. O que cresce com a
arena é a malha do terreno, e ela é resolvida por LOD radial, não por densidade
uniforme.

```
       ┌──────────────── 1800 m ────────────────┐
       │            teto de voo 520 m           │
       │   ▲                                    │
       │   │        ☁  ilhas flutuantes         │
       │   │   ▲▲▲ montanhas 60–140 m           │
       │   │  ▲▲▲▲▲▲                            │
       │   │ ~~~ mar ~~~   ⌂⌂ vila   ♣ ajisa    │
       └────────────────────────────────────────┘
```

---

## 3. Orçamento (o requisito "leve de memória")

O jogo atual roda com um orçamento apertado e o modo novo herda a régua:

| Item | Teto |
|---|---|
| Draw calls do cenário | **≤ 90** |
| Triângulos do cenário | **≤ 180 k** |
| Texturas carregadas | **0** (tudo por código, como o resto do jogo) |
| Luzes dinâmicas simultâneas | **≤ 3** |
| Alocação por quadro em regime | **0 B** (pools pré-alocados) |
| Personagens desenhados | 15 × ~30 primitivas, com LOD |

Instanciar é obrigatório para rocha, ajisa, casa e detrito:
`THREE.InstancedMesh`, uma chamada por espécie. Já existe precedente no
repositório (`entities/environment.js`, `systems/spaceLife.js`) — siga o padrão
de lá.

---

## 4. Física: por que não há Rapier aqui

Um lutador de Namekusei é uma **cápsula cinemática**. Ele não tumbla, não é
empurrado por solver, não precisa de junta nem de CCD. O que ele faz é: andar,
correr, voar, arrancar com ki, levar knockback e cair.

Tudo isso é integração explícita contra um campo de altura, e cabe em umas
duzentas linhas. Em troca ganha-se:

- **Determinismo pleno** — o mesmo passo dá o mesmo resultado em toda máquina,
  que é o que torna a interpolação de rede honesta;
- **Custo constante** — 15 lutadores + 200 projéteis não têm broad-phase;
- **Isolamento total** — nenhum corpo, colisor ou evento chega perto do mundo do
  arqueiro;
- **Memória** — o WASM do Rapier já está carregado pelo outro jogo, mas nenhum
  mundo novo é criado.

Colisão de projétil é **esfera contra cápsula** por varredura de segmento
(`distância ponto-segmento`), a mesma conta que `distanciaAoFeixe` já faz no
Kamehameha atual. Colisão com o chão é `y ≤ heightAt(x, z)`.

---

## 5. Ki, vida e o botão de carga

```
vida  0 ────────────────────── 100      morre em 0
ki    0 ────────────────────── 100      carrega segurando a tecla
```

A economia, tirada do BT3 e ajustada ao pedido:

| Ação | Custo | Regra |
|---|---|---|
| Rajada de ki (tiro básico) | **2** por bola | bloqueada abaixo de 2 |
| Arranque com ki (boost) | **14 / s** | enquanto segura |
| Voo parado / normal | 0 | voar não custa |
| **Especial (Kamehameha e cia.)** | **a barra inteira** | **só sai com o ki CHEIO** |

> **"Ele só pode soltar com o ki cheio"** vale para os ESPECIAIS. A rajada
> básica das duas mãos é o tiro comum — se ela também exigisse barra cheia, o
> jogador ficaria sem ataque nenhum durante 90 % da partida e o modo não teria
> jogabilidade. É exatamente a divisão do BT3: bola de ki custa uma lasca,
> especial custa estoque cheio.

Carregar ki (`segurar C`) trava o personagem no lugar, acende a aura, ergue o
chão em pedrinhas ao redor e enche a barra a **38/s**. É a pose mais icônica do
anime e é também o momento em que você está vulnerável — é a troca.

---

## 6. Os poderes

| Poder | Tecla | Custo | Comportamento |
|---|---|---|---|
| **Rajada de ki** | segurar botão esq. | 2 | Uma bola por mão, ALTERNANDO, a 6/s enquanto segura. Perseguição fraca (§6.1). |
| **Kamehameha** | 1 | barra cheia | Feixe azul sustentado, 3 s, atravessa tudo menos o chão. Cratera grande. |
| **Galick Gun** | 2 | barra cheia | Irmão roxo do Kamehameha, mais curto e mais grosso. |
| **Destructo Disk** | 3 | barra cheia | Disco que voa reto, corta cenário e não explode. |
| **Genki Dama** | 4 | barra cheia | Carga longa (4 s parado), esfera enorme, cratera máxima. |
| **Explosão de ki** | espaço no ar | 25 | Onda esférica curta que empurra quem está perto. Defesa de pressão. |

### 6.1 A perseguição fraca das bolas

O pedido é explícito: *"elas devem seguir levemente o outro player"*. Levemente
é a palavra que importa — uma bola que persegue de verdade tira o jogo do
jogador e o dá ao software.

A regra: a cada quadro, a bola gira sua direção em direção ao alvo com **teto de
95°/s**, por no máximo **1,1 s** de vida, e **só enquanto o alvo estiver dentro
de um cone de 35°** à frente dela. Fora do cone ela segue reta. Isso perdoa a
mira em movimento — que é o ponto — e continua deixando desviar com um passo
lateral, que é o que mantém o combate vivo.

O alvo é escolhido **no disparo** (o mais próximo do centro da tela dentro de
50 m), nunca reavaliado. Bola que troca de alvo no meio do voo lê como bug.

---

## 7. Destruição e deformação

Três coisas diferentes que o jogador lê como uma só:

**a) Cratera no terreno.** O campo de altura tem uma lista de crateras
dinâmicas — exatamente a mesma ideia das crateras estáticas da Lua
(`shared/moonField.js`), mas acrescentadas em jogo. Raio e profundidade saem da
potência do golpe:

```
raio      = 2.2 + 5.4 · √potência        (m)   →  bola de ki 3 m, Genki Dama 30 m
fundura   = 0.35 · raio                  (m)
```

A malha do terreno é re-esculpida **só nos vértices dentro do raio**, num
`BufferAttribute` marcado `needsUpdate` — nunca a malha inteira.

**b) Objeto destruído.** Rocha, ajisa e casa têm vida. Ao morrer, o índice sai
do `InstancedMesh` (escala 0) e vira estilhaço no pool de detritos.

**c) Poeira e pedrinha.** Todo impacto no chão emite poeira (partícula grande,
opaca, subindo e abrindo) e pedrinha (partícula pequena, escura, balística).
A contagem escala com a potência. Queda de altura usa a mesma emissão.

**Sincronismo:** cratera é estado COMPARTILHADO. Quem atira reporta o ponto
(`ponto` + `potência`); o **servidor** carimba um id e retransmite. Todo cliente
aplica a mesma cratera com a mesma conta determinística. Um cliente que chega
depois recebe a lista inteira no `welcome`.

---

## 8. Rede

Modelo de confiança **idêntico ao que o jogo já usa** — e isso é deliberado, não
preguiça: o jogo inteiro já é construído sobre "quem atira é a autoridade sobre
o próprio acerto, a sala é a autoridade sobre a vida" (ver `C2S.IMPACT`,
`C2S.SIEGE_HIT`, `Room.registerKameBlast`). Um segundo modelo de confiança no
mesmo servidor seria a inconsistência que ninguém lembra de manter.

| Quem decide | O quê |
|---|---|
| **Cliente** | a própria pose, o próprio disparo, o próprio acerto |
| **Servidor** | vida, morte, renascimento, placar, cratera, clima, bots |

Frequências: pose a **20 Hz**, projéteis por evento (custo zero por quadro),
vida/ki a **10 Hz**, placar quando muda.

Protocolo em `src/shared/namek/protocol.js`, **numerado à parte** do protocolo do
arqueiro — as duas salas nunca trocam mensagem.

---

## 9. Bots

Precisam "saber jogar muito bem". Uma máquina de estados com cinco estados
(`procurar`, `aproximar`, `atacar`, `esquivar`, `carregar`) rodando **no
servidor**, como `server/botSim.js` já faz para os arqueiros.

O que os torna bons, em ordem de importância:

1. **Gerenciam ki.** Recuam e carregam quando abaixo de 30; guardam a barra
   cheia para quando o alvo estiver a menos de 90 m e sem cobertura.
2. **Esquivam lateralmente**, nunca para trás — desviar de bola perseguidora
   exige mudar o ângulo, e recuar não muda.
3. **Erram de propósito** conforme a dificuldade, no ângulo do disparo e não na
   decisão. Bot que decide mal parece burro; bot que mira mal parece humano.
4. **Não se agrupam**: repulsão mútua de 25 m, senão viram cardume.

---

## 10. Animação

O rig é procedural, como todo o resto do jogo (não há um único asset externo no
repositório e não vai haver agora). Uma pose por ação, e **transições
amortecidas** entre elas — o que faz parecer animação de verdade não é a
quantidade de poses, é a interpolação entre elas nunca ser instantânea.

`parado · andar · correr · voar · voar rápido · arrancada · carregar ki ·
rajada (esq/dir) · especial · levar dano · arremessado · queda · morte`

Cada uma tem entrada e saída próprias. A rede manda a pose como **um número
por canal** (o mesmo truque do `q` do Kamehameha atual — sete segundos de
animação numa fração), nunca ossos.

---

## 11. Os únicos arquivos existentes que podem ser tocados

| Arquivo | Acréscimo permitido |
|---|---|
| `src/ui/lobby.js` | uma entrada em `PORTAS` com `jogo: "namek"` |
| `src/main.js` | um `if` no `onEnter` que arranca o outro jogo |
| `server/room.js` | um `if` em `RoomHost.ensure` que cria a `NamekRoom` |
| `index.html` / `src/style.css` | nada, se der para evitar |

**Nada mais.** Nenhuma linha de `config.js`, `levels.js`, `protocol.js`,
`player.js`, `renderer.js` ou qualquer sistema do arqueiro. Se um subsistema
parecer exigir isso, ele está desenhado errado — copie o que precisa para
`src/namek/` em vez de alterar o original.

---

## 12. Critério de aceite

O modo está pronto quando, com ele instalado:

1. O jogo do arqueiro abre, joga e troca de fase **sem nenhuma diferença**;
2. `git diff` mostra os quatro arquivos do §11 e mais nada de existente;
3. 15 lutadores (bots) em campo mantêm **60 fps** em qualidade média;
4. Uma partida de 10 minutos não cresce a memória (sem vazamento de pool);
5. Duas abas veem **a mesma cratera no mesmo lugar** depois de um Kamehameha;
6. Um jogador que entra no meio vê o terreno já deformado corretamente.
