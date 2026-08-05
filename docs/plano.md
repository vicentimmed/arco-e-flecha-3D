# Plano — melhorias gráficas e modo zumbi

Documento vivo. Cada item traz o custo estimado, porque a regra que atravessa o
plano inteiro é: **o jogo tem que continuar rodando liso**.

## Linha de base medida

Mac, 2560×1440, `devicePixelRatio` 2, com o jogo em campo aberto:

| Métrica | Valor |
|---|---|
| FPS | 83–104 |
| Draw calls | 222 (vale vazio) → 447 (2 jogadores) |
| Triângulos | ~270 k |
| Texturas / programas | 7 / 16 |
| WebGL2, MSAA máx. | sim / 4× |

Sobra GPU. O gargalo é **contagem de objetos**:

| Objeto | Meshes cada | Pior caso |
|---|---|---|
| Arqueiro + arco | ~98 | ×12 jogadores = ~1.180 calls |
| Porco | 21 | ×30 vivos = 630 calls |
| Pássaro | 8 | ×7 = 56 |
| Alce | 25 | — |

E não existe culling por distância para porcos nem pássaros — só para jogadores
remotos. No modo caçada com 30 porcos o jogo já passa de 1.000 draw calls hoje,
antes de qualquer melhoria visual.

---

## Fase 0 — Liberar orçamento

Ganho puro, zero impacto visual. É o que financia todo o resto.

| Item | Ganho |
|---|---|
| Culling por distância em porcos e pássaros | −400 a −600 calls no modo caçada |
| Merge por osso e material no arqueiro (cabeça 12→4, mão 6→1, pé 3→2, aljava 7→2) | 98 → ~35 por arqueiro |
| Mesmo tratamento no porco (21→~7) e no alce | ×30 porcos: 630 → 210 |
| Merge das cercas (46 meshes estáticos → 1) | −45 calls |
| LOD de rosto: acima de ~12 m some íris, boca, sobrancelha, orelha, nariz | −7 por jogador remoto |
| Correção do `onEnded` em `AudioSystem.play3D` (ver Fase 4.4) | corrige bug latente |
| Contador de draw calls e ms/frame no painel de debug | guarda-corpo |
| Preset de qualidade (`baixo`/`médio`/`alto`) em `CONFIG.render` | escape para máquina fraca |

---

## Fase 1 — Luz, cor e ar (custo de runtime ≈ 0)

1. **AO de céu e sombra de vegetação assados nas cores de vértice do terreno.**
   Duas amostragens a mais no loop que já existe em `Terrain.build`. Build-time
   apenas; runtime zero. Resolve de uma vez o "tudo flutua", a sombra que corta
   em 46 m e a encosta sem sombra de árvore. **Melhor item da lista.**
2. **Névoa direcional** — trocar `FogExp2` por um chunk que interpola duas cores
   pelo ângulo entre o raio de visão e o sol. ~6 instruções por fragmento.
3. **Disco solar e halo** no shader do céu, que já tem `sunDir` e `sunColor`.
4. **Reequilibrar exposição e paleta** — a imagem está lavada por excesso de
   luz ambiente.
5. **Especular seletiva** — braços do arco, ponta da flecha, neve, face do alvo.

## Fase 2 — Um passe de pós-processamento (~0,4–0,8 ms)

**Obrigatório:** usar `WebGLRenderTarget({ samples: 4 })`. Ligar `EffectComposer`
sem isso perde o `antialias: true` do framebuffer padrão e a imagem piora.

- **Bloom** (cadeia de 4 mips) — maior salto isolado de qualidade percebida.
- **Vinheta, grão sutil e curva de cor** — grátis no mesmo passe do composite.

## Fase 3 — Cenário vivo

1. **Vento nas copas** — o mesmo shader de balanço da grama, fase vinda da
   posição da instância. Quase grátis e é o que mais faz o cenário parecer vivo.
2. **Gradiente vertical nas copas** (cor de vértice) — resolve o close-up.
3. **Mais variantes de silhueta** — 2 formas para 860 árvores é pouco.
4. **Grama** — fade por distância, tingir pelo terreno abaixo, camada de flores.
5. **Nuvens** — derivar com o vento, somar camada alta e fina.
6. **Assentamento dos matacões** — corrigir a pedra que flutua em encosta.

## Fase 4 — Impacto e feedback

1. **Traçado da flecha como fita** — hoje é `THREE.Line` de 1 px de framebuffer
   (meio pixel em tela retina), cintila e não tem perspectiva. `CONFIG.trail.width`
   é configuração morta. Fita expandida no vertex shader: largura real, sem
   cintilar, afinando com a distância e com massa para o bloom pegar. Mesmo
   número de draw calls, o dobro de vértices.
   **Não usar `Line2`** — ele realoca e brigaria com o buffer pré-alocado.
2. **Partículas de impacto** — um pool de ~64 quads instanciados para terra,
   lascas, penas e sangue. 1 draw call para todos os impactos do jogo.
3. **Poeira sob os pés** ao correr e aterrissar.
4. **A voz do alce** — abaixo.

### Fase 4.4 — A voz do alce

Asset: `src/assets/audio/alce_berro.mp3` — 416 KB, 160 kbps, 24 kHz, 20,81 s.
Medido: **oito chamadas separadas por silêncio**, não um berro contínuo.

Sem editar o arquivo. `THREE.Audio` expõe `offset` e `duration` como propriedades
públicas, lidas em `source.start(when, offset, duration)` — cada gatilho toca um
trecho. Cortes com 60 ms de folga antes e 150 ms depois; como os segmentos são
separados por ≥350 ms de silêncio, a cauda cai no silêncio e não estala.

| Trecho | `offset` | `duration` | pico rel. | Usado em |
|---|---|---|---|---|
| 1 | 0,79 | 1,46 | 0,95 | flechada |
| 2 | 2,64 | 1,11 | 0,86 | flechada |
| 3 | 4,14 | 1,51 | 0,91 | flechada |
| 4 | 6,49 | 6,36 | 1,00 | investida |
| 5 | 13,29 | 1,01 | 0,64 | susto |
| 6 | 15,14 | 2,26 | 0,65 | susto |
| 7 | 17,74 | 1,56 | 0,59 | susto |
| 8 | — | — | 0,44 | descartado |

Gatilhos: entrada em `flee` (susto), entrada em `charge` (investida) e
`S2C.ELK_HIT`. **Nunca** em `graze`, `alert` ou `recover` — "só passando".
O estado vem do servidor a 10 Hz e é igual em todos os clientes: gatilho local,
nenhuma mensagem nova.

Três mudanças no `AudioSystem`:

1. **A voz segue o alce.** `play3D` prende o som a um ponto fixo; num alce
   investindo a 12,5–17 m/s isso deixa a voz 100 m para trás.
2. **Voz dedicada por alce**, fora do pool de 16. `if (voz.isPlaying) return;`
   é a regra de não-reinício.
3. **Corrigir o `onEnded`.** O override de `play3D` não chama o padrão, que é o
   único lugar que faz `isPlaying = false` — e o `play()` do Three recusa quando
   a flag está ligada. Bug latente hoje; a partir daqui a flag é a regra.

Decidido: `elkPain` sai (o mp3 vira a voz; `elkHit` fica como baque da flecha) e
a morte corta o som com fade de 0,4 s, deixando `elkDeath` assumir.

## Fase 5 — Personagens

### 5A · Arqueiro
Gradiente de cor de vértice em cada peça; AO de junta assado; rim light só nele
(`pow(1 - dot(N,V), 3)`); bainha e costuras; roughness realmente separada por
material; LOD de rosto; cor do jogador também na fita do cabelo e na empena.

### 5B · Alce
Refazer a silhueta (corcova alta, peito fundo, focinho pendente, corpo e cernelha
mesclados); **galhada 2× maior e palmada** (maior retorno isolado); joelho e
jarrete nas pernas, que hoje são um cilindro só; separar a paleta; bufo de vapor
na investida; barra de vida com moldura e crescimento limitado a 3×; morte em
dois tempos (ajoelha, depois tomba).

### Custo da Fase 5
Tudo é geometria, cor de vértice e uma linha de fragmento. Zero draw calls novos
depois do merge da Fase 0 — e o LOD de rosto é ganho líquido.

---

## O que NÃO fazer

- SSAO/SSGI/SSR em 1440p — o AO assado da Fase 1.1 entrega 80 % por 0 ms.
- Cascaded shadow maps com 3+ splits.
- Trocar árvores por cartões com textura alpha (overdraw).
- Subir `maxPixelRatio` acima de 2, ou MSAA 8× junto com pós.

---

# Modo zumbi

Sexto modo, tecla **6**. Ao ligar, o mundo vira noite e a partida começa na hora.

## O cenário

- **Noite fechada**: sol desligado, hemisférica quase zerada, névoa escura, céu
  com estrelas e lua. O gradiente diurno do shader do céu ganha um caminho
  noturno; as estrelas são um `Points` de algumas centenas de pontos e a lua um
  disco no mesmo fragmento — nada disso custa draw call relevante.
- **Tudo some**: pássaros, porcos, alces, os sete alvos fixos, o alvo da série e
  as bandeirolas de vento. Campo limpo.
- **Quatro tochas em quadrado** no centro do cenário, com meia-aresta de 10 m —
  20 m de lado, espaço de sobra para se mover.
- Cada tocha é **quebrável**: uma flecha apaga a chama, e a luz dela morre junto.
- **É breu fora do alcance das tochas.** O raio de luz de cada uma é ~16 m, então
  os quatro círculos cobrem o quadrado e pouco mais.
- **Sair do centro mata.** Além de `safeRadius` (22 m) o jogador morre — não há
  o que fazer no escuro, e o modo é a defesa daquele quadrado.

## As flechas

No modo zumbi toda flecha é **incendiária**: ponta acesa, rastro de fogo no ar e
uma `PointLight` barata acompanhando o voo, que ilumina o que ela passa. Só uma
luz por flecha viva e só neste modo.

## As hordas

Dez hordas. A primeira traz 3 zumbis, e cada uma seguinte traz 2 a mais:
3, 5, 7, 9, 11, 13, 15, 17, 19, 21 — 120 zumbis no total.

**Só passa de horda quando o último zumbi da horda atual cai.** A tela mostra
sempre a horda atual e quantos zumbis faltam.

## Os zumbis

- **Olhos vermelhos acesos.** É o único traço deles que atravessa o breu: o
  material dos olhos é `MeshBasicMaterial`, que ignora a iluminação da cena, então
  os dois pontos vermelhos continuam visíveis onde o corpo já sumiu no escuro. É o
  que transforma a noite em ameaça em vez de em cegueira — você vê os pares de
  olhos se aproximando muito antes de ver de quem são, e conta quantos vêm.
- **Nascem em ordem circular** ao redor do centro, num raio fora do alcance das
  tochas. Cada zumbi da horda entra num setor seguinte do círculo, com um pequeno
  sorteio dentro do setor: eles vêm de todos os lados, nunca em fila pelo mesmo
  rumo, e a horda cerca o quadrado em vez de chegar por uma aresta só.
- Andam **devagar**, sempre na direção do jogador vivo mais próximo.
- **Duas flechas no corpo** derrubam. **Uma na cabeça** derruba na hora.
- Morte por corpo: cai.
- Morte por cabeça: **pega fogo rapidamente e cai**.
- **Gemem enquanto andam** (som 3D, intervalo sorteado) e gritam ao morrer.
- Chegando a menos de ~1,6 m de um jogador, **atacam e tiram uma vida**.

A detecção de cabeça é pela altura do ponto de impacto em relação à base do
corpo — o mesmo dado que o `ARROW_IMPACT` já carrega.

## Vidas, morte e game over

- Cada jogador tem **3 vidas**.
- Morrer custa uma vida e devolve o jogador ao centro logo em seguida.
- Perdidas as três, o jogador fica **caído** e **renasce depois de 10 s**, com as
  vidas restauradas. Um **contador na tela** mostra quanto falta.
- Se em algum instante **todos os jogadores estiverem caídos**, é **game over**:
  a partida acaba e o modo volta para livre.

## O que fica na tela

Horda atual, zumbis restantes, vidas de quem está jogando e, quando caído, o
contador de renascimento. O game over é uma faixa central.

## Divisão cliente/servidor

Segue a regra já estabelecida no projeto: **a IA e a arbitragem moram no
servidor**. `server/zombieSim.js` decide para onde cada zumbi anda, quem ele
ataca, quando a horda vira e quando é game over; o cliente recebe pose e estado
a 10 Hz e cuida de corpo, animação, fogo e som. Acerto de flecha é declarado por
quem atirou (como já acontece com porco e alce) e confirmado pela sala.

## Custo

O pior caso é a horda 10 com 21 zumbis vivos. Com o corpo do zumbi construído já
mesclado por material (~6 meshes, seguindo a regra da Fase 0), são ~126 draw
calls — abaixo dos 630 que os porcos custam hoje. As quatro `PointLight` das
tochas e a da flecha são luzes sem sombra, que no `MeshStandardMaterial` custam
alguns ciclos por fragmento e nenhum passe extra.
