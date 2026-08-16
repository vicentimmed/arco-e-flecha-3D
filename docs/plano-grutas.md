# Grutas — o terreno deixa de ser uma superfície e passa a ser um volume

> Complementa `plano-namekusei.md`. O §4 (física sem Rapier) e o §7 (destruição)
> continuam valendo; o que muda é o **tipo do dado** com que os dois trabalham.

## 0. O pedido, literal

> *"fazer realmente um furo na montanha ou um furo bem grande no chão, e que
> fique teto. Ou seja, um furo normal do tamanho da cratera que o poder está
> soltando."*
>
> *"se forem soltados vários poderes grandes, a cratera fica maior… se são
> vários pequenos poderes, no mesmo ponto, o furo fica menor. Ou seja, uma
> montanha com vários pontos de furos vai ficar como se fosse um queijo suíço.
> Se chegar a um ponto que a montanha tem tantos furos que a parte de cima não
> sustenta a montanha, a parte de cima sede e desaba."*
>
> E o adendo: *"isso vai permitir… deixar o chão bem com bastante terra e fazer
> buracos, explorar por debaixo da terra, fazer grandes cavernas… como se fosse
> por exemplo Minecraft… Mas isso é no futuro. O que importa é a física dos
> buracos."*

---

## 1. Por que hoje é impossível, e o que exatamente precisa mudar

O terreno do modo é `NamekField.heightAt(x, z)` — **uma função que devolve um
único `y` por coluna**. Teto é, por definição, uma segunda superfície na mesma
coluna: ar embaixo, rocha em cima. Não cabe. Não é limitação de esforço nem de
desempenho, é o tipo do dado, e o próprio código já registrava isso em
`config.js:533` e em `powers/beam.js:353` — foi por isso que o Kamehameha
entrega uma **vala a céu aberto** em vez de um túnel.

Então a mudança é de tipo: de **superfície** `h(x,z)` para **volume**
`solido(x, y, z)`.

O que **não** pode acontecer é jogar o campo de altura fora. Há mais de duzentos
pontos de chamada de `heightAt` no repositório (jogador, bot, projétil, poeira,
detrito, cenário, mato, água, nascimento, câmera). Reescrever tudo de uma vez é
o caminho garantido para o modo parar de funcionar por três semanas.

### A decisão que resolve os dois

**O volume passa a ser a verdade, e o campo de altura vira o TERMO BASE dele.**

```
solido(x, y, z)  ⇔  y ≤ baseHeight(x,z) + desl(x,z)   E   (x,y,z) ∉ nenhuma gruta
                    └──────── o que já existe ────────┘   └─── o que é novo ───┘
```

Consequências, e as três importam:

1. **Nada quebra.** Onde não há gruta, o volume responde exatamente o que
   `heightAt` responde hoje. Todo sistema não migrado continua correto.
2. **O custo é pago por quem usa.** Uma coluna sem gruta custa uma consulta a
   mais num hash espacial que devolve vazio. A clareira inteira segue de graça.
3. **É o caminho para o adendo.** No dia em que o chão inteiro for escavável
   (o "Minecraft"), o que muda é o *termo base* — de campo de altura para um
   campo de densidade 3D com ruído — e **nenhum consumidor precisa saber**,
   porque todos já perguntam ao volume. O mesmo vale para o malhador: ele é
   escrito genérico sobre a função de densidade, não sobre grutas esféricas.

É por isso que este plano não faz o atalho óbvio (uma malha de tubo pré-fabricada
por buraco). O atalho entrega o furo desta semana e não entrega caverna nenhuma
depois.

---

## 2. O que é uma gruta

```js
{ id, x, y, z, r }   // uma esfera de rocha REMOVIDA
```

Só isso. A forma complexa — o túnel torto, a caverna irregular, o queijo suíço —
nasce da **união** de muitas esferas, do mesmo jeito que a cratera de hoje nasce
da soma de muitos `craterDelta` no mapa de deslocamento.

Escolhi esfera e não caixa/cilindro por três motivos que se pagam ao longo do
plano inteiro: a interseção com uma coluna vertical é uma fórmula de uma linha
(§3), a união de esferas não tem quina — o resultado já sai orgânico, sem
paredes retas nem cilindro perfeito —, e são 4 números na rede.

### A regra de perfuração — o pedido, traduzido

Cada impacto de poder deposita **uma esfera do calibre do poder**:

| poder | raio da cratera hoje | calibre do furo |
|---|---|---|
| rajada | 8,3 m | ~8 m de boca |
| Kamehameha | 9 m | ~9 m de boca |
| Genki Dama | até 52 m (`craterMax`) | até 52 m de boca |

E a esfera não é depositada na superfície: ela é depositada **no ponto sólido
mais fundo ao longo do eixo do tiro**, avançando um calibre por impacto. Daí sai
literalmente o que foi pedido:

- **vários poderes pequenos no mesmo ponto** → esferas pequenas em fila →
  um túnel **estreito e comprido**;
- **poderes grandes** → esferas grandes → **furo largo**;
- um poder grande num furo estreito já existente → alarga a boca e continua;
- **muitos furos em direções diferentes** → esferas espalhadas pelo maciço →
  **queijo suíço**, sem nenhum código específico para isso.

O tamanho do furo é o calibre do poder, sem acumulação lateral — que é
exatamente a queixa que abriu esta conversa, resolvida pela raiz em vez de por
uma curva de saturação.

### 2.1 O Kamehameha atravessa a montanha e deixa passagem

> *"se eu soltar um Kamehameha… ele deve perfurar a montanha a ponto de sair do
> outro lado. E aí, quando o poder acaba, fica um furo na montanha que é possível
> passar por dentro desse furo."*

**Este é o requisito que já está construído.** O `beam.js` não para no relevo
desde o commit `97e7892`: quando a cabeça encosta, ela **entra** (`furando`) e
continua andando dentro da rocha, deixando um buraco a cada `passo` metros, até
sair do outro lado ou gastar o orçamento. O que faltava não era o mecanismo —
era o tipo do dado, que transformava o corredor numa **vala a céu aberto** em vez
de um túnel.

Com o volume, o mesmo laço deposita **grutas** no lugar de crateras, e o
resultado é o túnel pedido. Os números que já estão no config foram calibrados
justamente para isto:

| `NAMEK.specials.kamehameha.atravessar` | valor | por que serve como está |
|---|---|---|
| `passo` | 7 m | menor que o calibre (≈8 m de raio): as esferas se **sobrepõem** e o furo sai contínuo e liso, não um rosário de bolhas |
| `alcance` | 260 m de rocha | as montanhas têm 90–220 m de base — **atravessa a maior delas** e ainda trava o tiro rasante que correria enterrado por meio quilômetro |
| `potencia` | 0,62 | a boca é a cratera cheia (9 m), o corredor é o rastro (≈7,7 m de raio). Boca larga + broca mais estreita é a leitura certa de uma entrada estourada |

Um furo de ~15 m de vão para um lutador de 1,78 m: passa voando com folga
enorme, que é o pedido.

Três coisas que a implementação tem de acertar, e nenhuma delas é grande:

1. **O furo é cavado enquanto o feixe avança**, não quando ele acaba. Vê-se a
   broca entrando. Quando o poder termina, o que fica é o que já foi cavado —
   permanente, como as crateras, e viajando no `welcome` para quem chegar depois.
2. **A esfera de saída.** A última esfera antes de a cabeça deixar a rocha pode
   parar rente à face oposta e deixar uma membrana fina de pedra fechando o
   túnel. Ao detectar a saída, deposita-se **uma esfera extra na face de fora** —
   é o que garante que ele sai mesmo do outro lado, e ainda dá a boca de saída
   estourada.
3. **Um túnel não pode derrubar a montanha.** O limiar do §5 tem de ser calibrado
   contra este caso: um vão de 15 m num maciço de 90–220 m de base tira uma
   fração pequena da seção, e **um Kamehameha nunca desaba nada**. O desabamento
   é a recompensa de *muitos* furos — senão os dois pedidos brigam entre si.

---

## 3. A física — aritmética de intervalos por coluna

Esta é a peça central, e ela é **exata** (nada de amostragem, nada de
ray-march às cegas), determinística e barata.

Para uma coluna `(x, z)`, cada gruta remove um intervalo de `y`:

```
dxz² = (x−gx)² + (z−gz)²
se dxz² < r²:  meia = √(r² − dxz²)
               remove [gy − meia, gy + meia]
```

O sólido da coluna é `(−∞, heightAt(x,z)]` menos a união desses intervalos. O
resultado é uma lista curta e ordenada de faixas sólidas — quase sempre **uma
só**, porque quase nenhuma coluna tem gruta.

Disso saem todas as respostas que o jogo precisa, e nenhuma delas custa mais que
percorrer essa lista:

| pergunta | quem pergunta hoje |
|---|---|
| `chaoAbaixo(x, y, z)` — o piso sob mim | `movement._chao` (hoje `heightAt`) |
| `tetoAcima(x, y, z)` — o teto sobre mim | **novo**: impede subir através da rocha |
| `solidoEm(x, y, z)` — estou dentro da pedra? | projétil, bot, câmera |
| `primeiroSolido(origem, dir, alcance)` | os raycasts de `beam.js`/`blast.js` |

O índice é um **hash espacial 2D em XZ** (célula de 32 m, o mesmo padrão do
`fusaoGrid` que já existe): devolve as poucas grutas cuja projeção toca a
coluna. Coluna sem gruta = um `Map.get` que devolve `undefined`, e o caminho
volta a ser o `heightAt` de hoje, byte por byte.

**`movement._chao(x, z)` vira `_chao(x, y, z)`** — a única assinatura pública que
muda, e ela muda porque tem de mudar: "qual é o chão" deixou de ter resposta sem
saber onde o corpo está. Dentro de uma caverna o chão é o piso da caverna; sobre
ela, o topo da montanha.

O `tetoAcima` é o que impede o defeito mais óbvio da implementação ingênua: sem
ele, quem entra na gruta voando sobe através do maciço e sai pelo alto.

---

## 4. A malha — como o furo aparece na tela

Duas metades, e a segunda é o truque que evita rasgar a malha polar.

### 4.1 O miolo: chunks de superfície implícita

Onde há gruta, um **chunk** de 24 m³ é malhado por *surface nets* (marching
cubes com vértice no centróide — mesma família, menos triângulo e sem os casos
ambíguos) sobre a função de densidade do §1. Voxel de **0,75 m**: 32³ = 32.768
células por chunk, e um furo de Kamehameha (18 m de boca) atravessa 24 voxels —
forma de sobra.

O chunk desenha o que a malha polar não sabe desenhar: a **parede interna** e o
**teto**. Cor por profundidade escavada já existe (`corDeCratera`, as cinco
camadas de solo) e é reaproveitada como está.

Construção **fora do quadro**: um Web Worker, ou fatiada por orçamento de tempo.
Um furo abre no meio do combate; travar 40 ms para malhar não é aceitável.

### 4.2 A boca: descarte por fragmento, não corte de malha

A malha polar tem célula de 7–9 m no anel de montanhas. Recortar um buraco nela
por triângulo daria uma boca serrilhada de 8 m de passo, ou obrigaria a
re-triangular a malha inteira — as duas coisas ruins.

Em vez disso: o *fragment shader* do terreno recebe as **N grutas mais próximas
da câmera** num array de uniforms e faz `discard` no fragmento cujo ponto de
mundo cair dentro de uma delas. A boca do buraco fica com precisão de pixel, sem
tocar num único índice da malha, e — o ponto que faz isso ser correto e não um
truque — o shader avalia **a mesma esfera** que a física avalia, então o que se
vê e o que se atravessa são o mesmo buraco.

Custo: um `discard` cria um caminho de fragmento não-opaco. Mede-se; se pesar,
restringe-se aos anéis de LOD que têm gruta (a tabela de anéis já dá isso de
graça em `percorrerDisco`).

---

## 5. O desabamento

> *"Se chegar a um ponto que a montanha tem tantos furos que a parte de cima não
> sustenta a montanha, a parte de cima sede e desaba."*

Avaliado **na sala** (autoridade única, senão cada cliente desaba a montanha num
instante diferente) e só quando uma gruta nova é aberta — nunca por quadro.

1. **Medida de apoio.** Sobre a região da gruta nova, uma grade grossa (4 m) mede
   a fração sólida de cada coluna entre o piso da montanha e a superfície.
2. **Gatilho.** Se a fração sólida de uma vizinhança cair abaixo de ~25 % e a
   massa acima dela passar de um limiar, a região é marcada instável.
3. **O desabamento.** A sala emite **uma** mensagem. Os dois lados aplicam o
   mesmo efeito determinístico: as grutas da região se fundem numa gruta grande
   que come o teto, o mapa de deslocamento **baixa** a superfície ali (a montanha
   perdeu altura) e **sobe** um pouco em volta (o entulho tem de ir a algum
   lugar), e o pool de detritos já existente (`fx/debris.js`) faz a queda.

O resultado lido pelo jogador: a montanha furada demais **cede**, com pedra
caindo, e o que sobra é uma cratera de desabamento — não um teto que some por
corte.

---

## 6. Rede

Grutas viajam como as crateras já viajam, pelo mesmo modelo de confiança do §8
do plano (quem atira reporta, a sala carimba, todos aplicam o mesmo determinismo):

- **`NS2C.GRUTA`** — `{ i, p:[x,y,z], r }`. 5 números por furo.
- **`welcome`** — a lista de grutas junto com a de crateras. Mil furos numa
  partida longa são ~20 KB; a malha e os chunks continuam sem sair da máquina,
  como o mapa de deslocamento de 231 k células já não sai.
- **`NS2C.DESABOU`** — `{ p:[x,y,z], r }`, emitido só pela sala.

Idempotência por `id`, igual a `addCrater` — a mensagem chega duas vezes porque
quem atirou já aplicou localmente, e a segunda não pode cavar de novo.

---

## 7. Orçamento e riscos — o que pode dar errado

| risco | mitigação |
|---|---|
| **Triângulos.** Teto do §3 é 180 k para o cenário inteiro. | Chunks de gruta com teto próprio (~40 k), LOD por distância, chunk longe vira caixa vazia. Medir a cada fase. |
| **Travada ao abrir furo.** Malhar 32³ no quadro do tiro. | Worker + fila; o furo existe na física no mesmo quadro, a malha chega um ou dois quadros depois. A física é a que não pode atrasar. |
| **`discard` custa fill-rate.** | Restringir aos anéis com gruta; medir em GPU integrada antes de aceitar. |
| **Jogador preso na rocha.** Gruta aberta em volta de quem está lá dentro, ou desabamento sobre ele. | Empurrão de despenetração ao longo do gradiente do campo (a mesma normal que o malhador já calcula) + dano de esmagamento no desabamento — que é a leitura certa, não um defeito. |
| **Bots.** `bots.js` navega por `heightAt` e vai voar contra o teto. | Bot não entra em gruta na primeira entrega: a decisão de rota testa `solidoEm` e desvia. Navegação em caverna é trabalho de outra rodada. |
| **A câmera dentro do túnel.** `camera.js:634` empurra a câmera para cima do relevo por `heightAt`; dentro da montanha ela pularia para fora do maciço e mostraria o lado de fora. | A câmera passa a consultar o volume: dentro de gruta, ela encolhe a distância até caber no vão em vez de subir. É o ponto mais chato da fase 1 e o mais visível se ficar errado. |
| **Cenário.** Árvore de pé sobre o teto que sumiu. | `scenery.reassentar` já derruba peça dentro do raio da cratera; passa a testar contra a gruta também. |
| **Lava.** Furo passante numa montanha cruza a cota da lava (−28). | `avaliarLava` passa a perguntar ao volume, não à altura. Furo que desce até lá **deve** acender — é o desenho atual e é bom. |

---

## 8. Entrega em fases, cada uma verificável sozinha

| # | o que entra | como se vê que funcionou |
|---|---|---|
| **1** | O volume e a física. `NamekField` ganha `grutas`, `intervalosNaColuna`, `chaoAbaixo`, `tetoAcima`, `solidoEm`. Movimento, câmera e raycasts de poder migram. | Comando de depuração abre uma gruta; o jogador **entra na montanha e anda lá dentro** — sem nada desenhado, atravessando a parede. A física está certa antes de existir pixel. |
| **2** | A malha: surface nets em chunk + `discard` na malha polar. | O furo **aparece**, com teto, e o que se vê casa com o que se atravessa. |
| **3** | A regra de perfuração: calibre do poder, avanço pelo eixo do tiro, integração com `beam.atravessar` (§2.1) e com `addCrater`. | Rajada no mesmo ponto fura túnel estreito; Genki Dama abre boca larga; montanha vira queijo suíço; **um Kamehameha atravessa a montanha e dá para voar por dentro do furo**. |
| **4** | Rede: `NS2C.GRUTA`, `welcome`, idempotência. | Duas abas veem a **mesma** montanha furada; quem entra no meio também. |
| **5** | O desabamento. | Furar demais derruba o topo, com detrito. |
| **6** | Ajustes: bots desviando, cenário reassentando, lava, poeira dentro da gruta. | — |

As fases 1 e 2 são o grosso do trabalho e o grosso do risco. A 1 pode ser
validada inteira sem escrever uma linha de renderização, e é assim que ela deve
ser feita.

---

## 9. Arquivos

### 9.0 Isto é SÓ de Namekusei — regra dura

> *"esse terreno é somente para o Dragon Ball Namekusei. Todos os outros
> terrenos do jogo que são relacionados continuam iguais."*

O modo já é isolado por construção (§11 do `plano-namekusei.md`), e esta
implementação não abre exceção nenhuma. Os outros campos de altura do jogo
**não são tocados, nem lidos, nem generalizados**:

| campo | de quem é | fica como está |
|---|---|---|
| `src/shared/moonField.js` | a Lua | ✅ intacto |
| `src/shared/terrainField.js` | o vale do arqueiro | ✅ intacto |
| `src/shared/castleField.js` | o cerco | ✅ intacto |
| `src/shared/sandboxField.js` | a fase de teste | ✅ intacto |

Nada de "extrair uma classe base de volume compartilhada entre os modos".
Seria a tentação óbvia e é exatamente o que o §0 do `plano-namekusei.md`
proíbe: um bug no volume novo passaria a poder derrubar o jogo do arqueiro.
O volume nasce e vive dentro de `src/shared/namek/`.

Isso vale inclusive para o futuro do §10: o modo "escavar e explorar" nasce como
**fase própria**, com o campo dele, e não convertendo um terreno existente.

### 9.1 O que é tocado

Dentro do que o §11 do plano permite — tudo em `src/namek/` e
`src/shared/namek/`, nada do arqueiro:

| arquivo | o que acontece |
|---|---|
| `src/shared/namek/volume.js` | **novo.** As grutas, o hash, a aritmética de intervalos, a densidade. O núcleo puro. |
| `src/shared/namek/field.js` | passa a compor com `volume.js`; `heightAt` intacto |
| `src/shared/namek/config.js` | seção `grutas` (calibre, avanço, limiar de desabamento, voxel, chunk) |
| `src/shared/namek/protocol.js` | `NS2C.GRUTA`, `NS2C.DESABOU` |
| `src/namek/world/grutas.js` | **novo.** Chunks, surface nets, worker |
| `src/namek/world/terrain.js` | uniforms das grutas + `discard` no shader |
| `src/namek/movement.js` | `_chao(x, y, z)`, teto, despenetração |
| `src/namek/powers/*.js` | raycasts contra o volume |
| `server/namek/room.js` | carimbo das grutas, avaliação de apoio, desabamento |

---

## 10. O que isto compra para o futuro (o adendo)

O modo "escavar e explorar" — chão profundo, cavernas grandes, ver o que tem por
baixo — **não é outro projeto** depois disto. É:

1. trocar o termo base do §1 (campo de altura → densidade 3D com ruído), e
2. deixar os chunks do §4.1 cobrirem o mundo em vez de só as grutas.

Todo o resto — física por intervalos, colisão, rede, escavação por poder,
desabamento, o malhador — já está escrito genérico sobre a função de densidade e
não sabe a diferença. É por isso que o §1 insiste que o volume seja a verdade e o
campo de altura seja apenas o seu termo mais barato: a alternativa (tubo
pré-fabricado por furo) entregaria o mesmo furo esta semana e teria de ser jogada
fora inteira no dia do "Minecraft".
