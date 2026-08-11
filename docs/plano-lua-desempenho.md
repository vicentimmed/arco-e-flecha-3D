# Plano — deixar a Lua tão leve quanto o Vale

O relato é preciso e vale como critério de aceite: **a Lua trava quando se joga
online; o Vale Verde não.** Este documento mede a fase, aponta o culpado com
número e ordena o conserto por impacto — o que devolve mais quadro primeiro, o
que é enfeite por último.

Formato dos outros planos: cada bloco traz a decisão, o **porquê** e o custo.

---

## 1. O que foi medido, e como

Preset **High**, 1280×720, Chrome, uma sala local. As contagens de desenho saem
de `renderer.info` com `autoReset = false` (o contador é do QUADRO inteiro, com
o passe de sombra e os passes de pós — ver `core/renderer.js`), e cada número
foi tirado com o laço do jogo congelado e a cena estável, três quadros por
amostra.

O caso "online" foi reproduzido com **cinco bots na Lua**: um bot é desenhado
pelo mesmo `RemotePlayer` de um humano, com o mesmo corpo e o mesmo colisor.
Seis arqueiros em campo é uma partida normal.

### 1.1 O retrato

| | Vale (sozinho) | Lua (sozinho) | **Lua (6 arqueiros)** |
|---|---|---|---|
| chamadas de desenho | 263 | 203 | **847 – 1015** |
| triângulos | 265 k | 92 k | 154 k |
| render (CPU) | 4,8 ms | 2,7 ms | 2,9 ms |
| física (CPU) | 0,30 ms | 0,08 ms | 0,08 ms |

A primeira leitura já desmonta a suspeita natural. **A Lua não é pesada de
triângulo** — ela tem um TERÇO dos triângulos do Vale, e o Vale vai bem. O que
a Lua tem é **chamada de desenho**, e chamada de desenho é a única coisa aqui
que MULTIPLICA POR JOGADOR.

### 1.2 De onde vêm as 941 chamadas (6 arqueiros)

Medido escondendo cada grupo da cena, um a um, e comparando com a cena vazia:

| grupo | chamadas | fatia |
|---|---|---|
| **arqueiros (6 corpos)** | **563** | **60 %** |
| alien, meteorito e nave | 156 | 17 % |
| fase (terreno + base + foguete) | 20 | 2 % |
| pássaros — que não deviam estar na Lua | 12 | 1 % |
| céu, estrelas, partículas, passes de pós | ~18 | 2 % |

Um arqueiro são **99 malhas**, das quais **54 lançam sombra** — e o passe de
sombra desenha cada uma de novo. Dá ~94 chamadas por corpo.

### 1.3 Por que isso não derruba o Vale

O corpo é o mesmo nas duas fases. O que muda é **quantos aparecem ao mesmo
tempo**:

* no Vale há árvore, morro e neblina; os arqueiros se espalham por um vale
  inteiro e a maior parte deles está atrás de alguma coisa, ou além dos 160 m
  de `net.cull.hide`;
* na Lua não existe oclusão nenhuma — a arena tem 330 m de diâmetro, o céu é
  preto liso, **e todo mundo voa**. Seis arqueiros na Lua são seis arqueiros
  desenhados, sempre.

### 1.4 O que NÃO é o problema (para ninguém gastar tempo aqui)

* **Terreno da Lua**: 20 chamadas, 69 k triângulos, 0,08 ms de física. Ele
  parece o vilão (é a malha maior da cena) e não é.
* **CPU de animação**: montar a pose de seis arqueiros custa 0,18 ms; de doze,
  0,37 ms. Contra um orçamento de 16,6 ms, é ruído.
* **Rede**: 22,5 kB/s com seis jogadores (15,4 de `states`, 6,4 de `space`).
  Cabe folgado em qualquer conexão; não é daí que vem o engasgo.
* **Partículas** (inclusive o rastro do jetpack): 2 chamadas de desenho no
  total, 0,013 ms. O pool já resolve isso desde sempre.

---

## 2. As tarefas, da que mais devolve para a que menos

### Tarefa 1 — LOD de malha do arqueiro · **−480 chamadas (−57 %)**

**Medido, não estimado**: escondendo as peças pequenas dos seis corpos (414
malhas), o quadro cai de 847 para 367 chamadas.

Hoje o corpo tem um único nível de detalhe, com uma exceção: o rosto (nove
peças) some depois de 12 m (`FACE_DETAIL_DISTANCE`). O resto — fivelas, dedos,
costuras, penas da aljava, tiras da bota — é desenhado igual a 5 m e a 150 m,
onde ocupa menos de um pixel.

Três níveis, escolhidos pela distância que `RemotePlayer.update` já calcula:

| nível | distância | malhas | o que fica |
|---|---|---|---|
| cheio | < 20 m | 99 | tudo (é o que se vê num duelo corpo a corpo) |
| médio | 20–55 m | ~35 | corpo, roupa, arco, aljava, jetpack |
| longe | > 55 m | ~10 | tronco, cabeça, dois braços, duas pernas, arco |

Onde mexe: `entities/player.js` (marcar cada peça com o nível em que ela nasce,
na construção) e `net/remotePlayers.js` (chamar `setDetail(distancia)` do mesmo
jeito que já chama `setFaceDetail`).

**O que NÃO pode sumir em nível nenhum**: o arco e a flecha encaixada. Eles são
a silhueta que conta o que o outro está fazendo — quem tira isso de longe tira
a informação de que alguém está mirando em você.

O arqueiro local fica sempre no nível cheio: a câmera está em cima dele.

---

### Tarefa 2 — Sombra só nas peças grandes · **−84 chamadas (−10 %)**

**Medido**: desligar `castShadow` das 174 peças pequenas dos seis corpos tira 84
chamadas por quadro, e junto tira o preenchimento correspondente do shadow map.

São 54 lançadores de sombra por arqueiro. A sombra de uma fivela de cinto não
existe na tela: o mapa é de 2048 px cobrindo 92 m (`render.shadowRange`), o que
dá ~4,5 cm por texel — a peça inteira cabe num texel e meio.

Regra: lança sombra o tronco, a cabeça, as coxas, os braços e o arco. Mais nada.
Vale igual para o alien e para o meteorito (§ Tarefa 3).

Onde mexe: `entities/player.js`, na construção, e `systems/spaceLife.js`.

Este ganho se sobrepõe em parte ao da Tarefa 1 (nível longe já não tem peça
pequena para lançar sombra), mas ele vale para o **arqueiro local e para quem
está perto**, que é justamente onde a Tarefa 1 não age.

---

### Tarefa 3 — Alien e meteorito mais baratos · **−80 a −110 chamadas**

Com os bichos em cena eles valem 156 chamadas (17 % do quadro) para SETE
objetos. Três cortes:

* **escolta do meteorito**: 5 a 9 pedrinhas por rocha, cada uma uma malha, todas
  lançando sombra. Viram um `InstancedMesh` por meteorito (1 chamada) e perdem a
  sombra — são cascalho a vinte metros de altura;
* **alien**: 9 malhas, 8 delas com sombra. Corpo, cabeça e olhos são rígidos
  entre si — dá para fundir numa geometria só na construção, deixando soltos
  apenas os braços e as pernas, que animam;
* **sombra**: só a rocha e o corpo do alien.

Onde mexe: `systems/spaceLife.js` (classes `Alien` e `Meteor`).

---

### Tarefa 4 — Tirar os pássaros da Lua · **−12 chamadas, e um absurdo**

Há **sete bandos de pássaros voando no vácuo**, a 20 m do chão, numa fase que se
declara `fauna: false` em `shared/levels.js`. Custam 42 malhas e a animação de
asa de cada um.

Não é só desempenho: é um bicho respirando onde não há ar. O caminho é o estado
que a sala manda — o cliente recria o bando a partir dele. Conferir
`Room.tickCreatures` e o `snapshot`, que hoje mandam pássaro na Lua.

---

### Tarefa 5 — Cull mais curto enquanto o LOD não existe · **−1 a −2 corpos**

`net.cull.hide` é 160 m, herdado do Vale, onde a neblina já esconde antes disso.
Na arena de 330 m sem oclusão, 160 m alcança quase todo mundo.

Baixar para ~110 m **na Lua** é uma linha e vale um ou dois corpos numa sala
cheia. É paliativo: com a Tarefa 1 pronta, o corpo distante custa 10 chamadas e
esconder deixa de ser urgente.

---

### Tarefa 6 — `space` parou de mandar quem não se mexe · **−3 kB/s por jogador**

O pacote de 10 Hz custa 6,4 kB/s — 28 % do tráfego — e a maior parte dele é
meteorito, que **anda de 1,2 a 2,6 m/s**: entre duas amostras ele se desloca
20 cm, e o cliente ainda amortece a pose. O rover é igualmente previsível.

Meteorito e rover a 5 Hz (ou só quando mudam de verdade); alien e nave continuam
a 10 Hz, porque alien mata e nave é alvo.

Não devolve quadro — devolve margem numa conexão ruim, que é outro tipo de
engasgo e vale menos que os cinco primeiros itens.

---

### Tarefa 7 — Poeira e estilhaços · **~0,04 ms e 12 chamadas eventuais**

* a poeira do `Ambiente` são 220 pontos reescritos e reenviados à GPU **todo
  quadro** (0,037 ms). Cair para 120 pontos e atualizar a 30 Hz não muda nada na
  tela: são grãos de 5 cm passando pela câmera;
* cada meteorito estourado cria 12 malhas independentes que vivem ~4 s. Um
  `InstancedMesh` transforma isso em uma chamada.

Último da fila porque é pouco e é raro — mas é barato de fazer.

---

## 3. Onde isso chega

Somando as tarefas 1 a 4, o quadro de seis arqueiros na Lua sai de **~940 para
~300 chamadas de desenho** — abaixo do Vale sozinho hoje (263), que é a fase que
o próprio jogador aponta como referência de "funciona bem". Sobra orçamento para
doze pessoas em campo, que é o teto da sala.

Nenhuma das quatro primeiras tarefas mexe em regra de jogo, em rede ou em
física: são todas sobre **quantas vezes se pede à placa de vídeo para desenhar
alguma coisa**, e nenhuma delas muda o que o jogador vê a menos que ele esteja a
mais de vinte metros do detalhe que sumiu.
