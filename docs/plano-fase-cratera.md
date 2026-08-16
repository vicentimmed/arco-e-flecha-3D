# Fase Cratera — um terreno feito de crateras, escavável por dentro

> **Fase NOVA e isolada.** Nada em `src/namek/`, `src/shared/namek/` ou
> `server/namek/` é tocado — há outros agentes trabalhando lá. Branch
> `fase-cratera`.

---

## 0. O que este documento responde

A tentativa anterior (`plano-grutas.md`, abandonada) funcionou tecnicamente e
falhou onde importa. O pedido novo diz exatamente onde:

> *"o furo na montanha ficou como um furo de minhoca e não como um acúmulo de
> várias crateras, ou seja, não tem características de crateras. **Ter a
> característica de cratera é o mais importante**, pois é um jogo de batalha de
> poderes Dragon Ball."*

E acrescenta cinco requisitos:

1. **Não pode ser oco** — de dentro do túnel não se vê nada de fora.
2. O túnel toma **a forma que o jogador quiser**, decidida por onde o poder bate.
3. Estando **dentro** de um buraco, dá para continuar escavando atirando mais.
4. Montanha muito furada **cede e desmorona** por cima.
5. Terreno **pequeno**, é fase de teste. Personagens entram depois.

---

## 1. Por que o furo saiu liso — e a correção

A causa não foi o motor, foi a **primitiva de escavação**. Cada impacto removia
uma **esfera**, e as esferas eram:

- do **mesmo raio** (6,67 m, sempre),
- **colineares** (todas no eixo exato do tiro),
- **igualmente espaçadas** (7,00 m, cravados),
- **perfeitamente lisas** (é uma esfera).

A união de esferas iguais em fila reta é um **cilindro de bordas arredondadas**.
Ou seja: o resultado liso não foi um defeito da implementação — foi *exatamente*
o que aquela receita descreve. Uma broca.

Uma cratera de verdade tem quatro coisas que a esfera não tem, e as imagens de
referência mostram as quatro:

| o que faz ler como cratera | onde aparece na referência |
|---|---|
| **borda lascada, irregular** | a boca na encosta (imagem 2) não é um círculo — é um rasgo com dentes |
| **lábio de ejeção** — material acumulado em volta | o anel de pedra levantada em volta do poço (imagem 1) |
| **entulho solto** no fundo e nas paredes | as pedras cravadas na parede e caídas no chão do túnel (imagem 3) |
| **escalonamento** — bacias que se comem parcialmente | a parede do túnel em anéis sobrepostos (imagem 3), não um tubo |

A correção é trocar a primitiva. Ver §3 — é o coração deste plano.

---

## 2. Por que uma fase NOVA resolve o "oco"

Em Namekusei o chão é uma **casca**: uma superfície de altura, com as faces
internas descartadas. Furá-la abre a chance de ver através dela, e cada correção
que eu fiz lá foi tapando um sintoma diferente do mesmo problema estrutural.

Aqui o terreno é **volume desde o primeiro byte**. A malha gerada é a **fronteira
completa do sólido** — a encosta de fora e a parede de toda cavidade, na mesma
superfície fechada. Consequência direta, e é ela que responde ao requisito 1:

> De dentro de um túnel, todo raio ou bate em rocha ou sai por uma abertura de
> verdade. **Não existe "atravessar a montanha sem querer"**, porque não existe
> casca — existe pedra.

Isso não é um conserto melhor. É o problema deixando de existir.

---

## 3. A primitiva: uma CRATERA, e não uma esfera

O núcleo do plano. Cada impacto remove uma **bacia lascada**, definida por
função implícita e semeada pelo id do golpe (logo: igual em toda máquina).

### 3.1 A forma

Para um impacto no ponto `C`, com eixo do tiro `d` e raio nominal `R`:

```
v      = p − C
dir    = normalizar(v)
alonga = 1 + 0.35·(dir·d)²          ← estica na direção do tiro
raio(dir) = R · alonga · ( 1
             + 0.22·ruído3(dir·2.1 + semente)      ← lascas grandes
             + 0.09·ruído3(dir·5.7 + semente·3) )  ← lascas finas
f(p)   = |v| − raio(dir)
```

O ruído aplicado **na direção** (e não na posição) é o que dá a borda mordida
sem custar continuidade: a mesma direção sempre devolve o mesmo raio, então a
superfície é fechada e sem furos.

### 3.2 A variação entre impactos — o que quebra o cilindro

Três sorteios por impacto, todos derivados do hash do id (determinísticos):

| grandeza | faixa | por quê |
|---|---|---|
| raio | **0,75 – 1,30 × R** | bacias de tamanhos diferentes não se somam num tubo |
| desvio lateral do centro | até **0,40 × R**, perpendicular ao tiro | tira as bacias da linha reta — é isto que faz a parede serpentear |
| espaçamento | **0,70 – 1,05 × R** | irregular; espaçamento cravado é assinatura de máquina |

Só estas três linhas já transformam a broca num rosário de crateras. As da §3.1
transformam cada conta do rosário numa cratera.

### 3.3 O lábio de ejeção

O que mais faz o olho ler "explosão" é o material **em volta** do buraco, não o
buraco. Em campo de densidade isso é uma casca fina de rocha ADICIONADA logo
fora da bacia:

```
labio(p) = A · exp( −((|v| − raio(dir)) / w)² )   , só onde |v| > raio(dir)
densidade = max(densidade, labio)                  , só onde já havia rocha perto
```

com `A ≈ 0,35·R` e `w ≈ 0,25·R`. O "só onde já havia rocha perto" impede lábio
flutuando no ar no meio de um túnel.

### 3.4 A boca é MAIOR que a broca

Nas duas referências de encosta a entrada é um rasgo enorme e o corredor é
estreito. Então o primeiro impacto de cada penetração usa **R_boca ≈ 2,2 × R** e
os seguintes voltam ao normal — o túnel entra em funil, que é o que se vê.

---

## 4. O campo e a malha

### 4.1 A arena — pequena, porque é teste

| | |
|---|---|
| planta | **192 × 192 m** |
| cota | **−64 m a +72 m** (136 m de vão vertical) |
| relevo | uma clareira central, **três morros** de 30 a 60 m e um paredão num lado — o suficiente para furar de lado, furar de cima e derrubar |
| voxel | **0,5 m** |
| chunk | **32 m** (64³ células) |

Voxel de 0,5 m contra um calibre de 6 m dá 24 amostras no vão: forma de sobra
para a borda lascada aparecer. Foi 0,75 m na tentativa anterior, e parte da
lisura veio daí.

### 4.2 O campo é ESPARSO — e é isto que serve ao futuro

```
densidade(p) = chunk gravado, se este chunk já foi escavado
               senão, a fórmula do relevo base
```

Chunk intocado não ocupa memória: ele é uma função. O primeiro golpe que o
alcança "materializa" um `Int8Array` de 64³ = 256 KB e passa a gravar nele.
Um túnel de cem metros toca umas 20 células = ~5 MB.

Esse é o mesmo desenho que um jogo de blocos usa, e é de propósito: é o que
permite, mais adiante, o terreno virar profundo e explorável sem reescrever
nada.

### 4.3 A malha

Surface nets sobre a densidade, por chunk, construção fatiada fora do quadro.
Já escrevi este malhador uma vez e sei onde ele morde — as três armadilhas vão
resolvidas desde o início, não descobertas de novo:

1. **A auréola.** Cada chunk amostra uma célula ANTES do próprio início e desenha
   as faces da sua borda baixa. Sem isso, a face entre dois chunks não é
   desenhada por nenhum dos dois e abre uma fresta a cada 32 m.
2. **A mão dos quads.** A volta em torno da aresta usa `(e+1)%3, (e+2)%3` nos
   três eixos, por construção — não escrita à mão por eixo.
3. **A normal vem do gradiente** do campo, não da topologia: é contínua entre
   chunks, então a costura não aparece como linha de iluminação.

### 4.4 A cor — o perfil de solo

Por metros abaixo da superfície original: terra clara na boca, marrom escuro,
rocha cinza, rocha-mãe. É o que a imagem 3 mostra e o que faz um corte parecer
um corte. (Namekusei já tem essa paleta; aqui ela é **reescrita**, não
importada — a fase é isolada.)

---

## 5. Atirar de dentro da terra

Requisito 3, e ele cai quase de graça na arquitetura — com **um** cuidado que já
me custou caro uma vez:

> O feixe abre bacias de ~6 m e a cabeça anda ~5,7 m por quadro. Um quadro depois
> de escavar, ela está **dentro do próprio buraco**, conclui que saiu da rocha e
> recomeça a entrada. Na tentativa anterior isso produziu um colar de bolhas
> separadas por tampões ao longo do maciço inteiro.

A correção: o tiro enxerga o terreno **como ele estava quando saiu**. As
escavações anteriores contam (é o que faz o segundo tiro continuar o túnel do
primeiro); as dele, não. Implementado como um carimbo de ordem por escavação.

O resto é consequência: o golpe sai de dentro do túnel, bate na parede à frente,
abre bacia, e o corredor cresce **para onde o jogador apontou**. É o requisito 2
sem nenhum código específico para "forma de túnel".

---

## 6. Desabamento

Avaliado **só quando uma escavação nova acontece**, nunca por quadro.

1. **Medida de apoio.** Numa grade grossa (2 m) sobre a região mexida, mede-se a
   fração sólida de cada coluna entre o piso e a superfície.
2. **Gatilho.** Vizinhança com fração sólida abaixo de ~25 % e massa relevante
   por cima é marcada instável.
3. **A queda.** O teto vira entulho de verdade (§7): a região é escavada de uma
   vez e o volume removido **reaparece como pedras caindo**, que se acomodam no
   fundo do túnel e o entopem parcialmente. É a leitura de desabamento, e não a
   de "o teto sumiu".

**Calibragem obrigatória:** um único tiro nunca desaba nada. O desabamento é a
recompensa de insistir — se um Kamehameha derruba a montanha, os dois requisitos
brigam entre si.

---

## 7. O entulho — o que faltou na tentativa anterior

Nas três imagens de referência há pedra solta por toda parte, e ela faz metade
do trabalho de leitura. São duas coisas diferentes:

- **Ejeção**: no instante do impacto, pedras voando radialmente (imagem 1).
  Pool de instâncias com balística simples, colidindo contra o campo.
- **Depósito**: as que param viram **pedras assentadas** no piso do túnel e
  cravadas na parede (imagem 3). Instanciadas, permanentes, baratas.

Sem isto o túnel é limpo demais — e túnel limpo lê como tubo, que é justamente a
queixa.

---

## 8. Arquivos e escopo

Tudo novo, tudo isolado:

| arquivo | o quê |
|---|---|
| `src/cratera/campo.js` | densidade: relevo base + chunks esparsos gravados |
| `src/cratera/escavar.js` | **a primitiva de cratera** (§3) — o coração |
| `src/cratera/malha.js` | surface nets em chunks, fatiado |
| `src/cratera/entulho.js` | ejeção e depósito |
| `src/cratera/desabar.js` | apoio e queda |
| `src/cratera/mundo.js` | monta e distribui |
| `dev/cratera.html` / `dev/cratera.js` | **a bancada** — a fase em si |

**Nada** em `src/namek/`, `src/shared/namek/`, `server/namek/`, e nada nos
outros modos (Lua, vale, cerco, sandbox).

A fase nasce como **página de bancada** (`dev/cratera.html`), no padrão de
`dev/voo.html` e `dev/cerco.html`, e não como entrada no lobby. Motivo: assim
ela não encosta em `lobby.js` nem em `main.js`, que é o que garante zero risco
para quem está trabalhando no jogo agora. Promovê-la a fase de verdade depois é
mover a montagem para um `level`, sem mexer no terreno.

---

## 9. Entrega em fases

| # | o que entra | como se vê que funcionou |
|---|---|---|
| **1** | Campo esparso + relevo base + malha por chunks | a arena aparece, com morros, e nada mais |
| **2** | **A primitiva de cratera** e o comando de escavar | um clique abre uma cratera que **parece** cratera — borda lascada, lábio, fundo em camadas |
| **3** | Sequência de impactos: túnel de cima, túnel de lado | o furo lê como bacias sobrepostas, não como broca |
| **4** | Atirar de dentro | entrar no buraco e continuar escavando na direção que quiser |
| **5** | Entulho | pedras voando no impacto, assentadas depois |
| **6** | Desabamento | furar demais derruba o topo, com queda |
| **7** | Personagem dentro | controlador com chão, teto e parede contra o campo |

A fase **2** é a que decide se este trabalho vale — é ela que responde ao "tem de
ter característica de cratera". Sugiro parar lá para você olhar antes de eu
seguir.

---

## 10. O que este plano NÃO promete

- **Não é o motor de Namekusei.** Não há troca, importação nem ponte. Se um dia
  o resultado agradar, a conversa sobre migrar é outra, e começa por decidir se
  Namekusei vira uma fase volumétrica ou continua campo de altura.
- **Não é multijogador.** A bancada é local. A escavação é determinística e
  semeada por id justamente para que a rede seja possível depois, mas nada de
  rede entra agora.
- **Não tem orçamento de 90 draw calls.** É bancada de teste; o custo é medido e
  anotado, não perseguido. Perseguir orçamento antes de a aparência estar certa é
  a ordem errada.

---

## 11. O contrato de multijogador — obrigatório desde a primeira linha

> *"só faça o trabalho se for possível deixar isso multiplayer depois, vários
> players atirando no mesmo buraco e todos vendo os buracos de todos."*

**Sim, é possível** — e a resposta honesta é que isso *não* sai de graça depois:
depende de cinco regras que precisam valer desde já. Retrofitar qualquer uma
delas significa jogar a escavação fora e reescrevê-la.

### 11.1 O que viaja é a LISTA DE IMPACTOS, nunca o terreno

Um impacto são nove números:

```
{ id, x, y, z, dx, dy, dz, raio, semente }
```

Uns 40 bytes. O terreno em si — os chunks de voxels — **nunca sai da máquina**:
seriam centenas de KB por túnel. Cada cliente recebe a lista e a reproduz pela
mesma função de escavação, chegando ao mesmo chão.

É o mesmo desenho que Namekusei já usa para crateras, e ele já provou funcionar
naquela escala. A diferença é que aqui a função de escavação é bem mais rica, e
é por isso que as quatro regras abaixo existem.

### 11.2 A ORDEM é o contrato

Escavar é `min` (tira rocha) e o lábio é `max` (põe rocha). **Misturar `min` e
`max` não é comutativo**: cavar A e depois levantar o lábio de B dá um chão
diferente de levantar o lábio de B e depois cavar A.

Portanto:

- cada impacto aplica a sua bacia **e** o seu lábio **juntos, atomicamente**;
- os impactos são aplicados na **ordem do id carimbado**, que é total e igual em
  toda máquina;
- quem chega no meio da partida reproduz a lista **na ordem recebida**.

Este parágrafo é a coisa mais fácil de esquecer e a mais cara de descobrir
depois: o sintoma seria dois jogadores com chões silenciosamente diferentes, e
ele só apareceria quando um caísse num buraco que o outro não vê.

### 11.3 Nada de `Math.random` — e nada de transcendentais

- **Aleatoriedade**: toda variação (raio, desvio lateral, espaçamento, fase do
  ruído) sai de um **hash do id**, nunca de `Math.random()`. É o mesmo
  `embaralhar` que `NamekField` já usa, pelo mesmo motivo: ids consecutivos têm
  bits baixos consecutivos, e sem embaralhar as crateras vizinhas saem gêmeas.
- **Ruído**: o `ValueNoise` do próprio repositório, com semente fixa. Ele é
  aritmética inteira mais interpolação — determinístico por construção.
- **Transcendentais**: `Math.sin`, `cos`, `exp`, `pow` e `log` **não têm
  resultado idêntico garantido** entre motores e plataformas (o IEEE 754 só
  obriga exatidão em `+ − × ÷ √`). Um bit de diferença numa borda de voxel vira
  uma célula sólida num cliente e vazia no outro.
  **A função de escavação usa apenas `+ − × ÷ √` e comparações.** É por isso que
  o lábio da §3.3 é uma parábola e não uma gaussiana, e é uma regra a conferir em
  revisão, não uma intenção.

### 11.4 O campo é PURO — roda em Node sem navegador

`src/cratera/campo.js` e `src/cratera/escavar.js` **não importam Three.js**, nem
DOM, nem nada de cliente. É a mesma disciplina de `shared/namek/field.js`, e a
razão é a mesma: um dia a sala precisa do mesmo chão para mover bot, cobrar
queda e validar acerto. Um campo que só existe no navegador não vira
multijogador — vira dois jogos.

A malha (`malha.js`), o entulho e o desabamento visual ficam do lado do cliente.

### 11.5 O que ainda falta decidir, e pode esperar

- **Quem carimba o id.** Numa sala, o servidor — como `NamekRoom` faz. Na bancada
  é um contador local. A troca é de uma linha porque o resto só depende de o id
  existir e ser ordenado.
- **Cota de escavação.** Quinze jogadores atirando abrem muitos impactos por
  segundo; vai precisar de um balde, como Namekusei precisou. É balanceamento, e
  balanceamento depende de ver o jogo rodando.
- **Retardatário com partida longa.** Reproduzir dez mil impactos é barato no
  campo (é só escrever voxel) e caro na malha — mas a malha já é preguiçosa e só
  constrói o que está à vista. Se um dia doer, a saída é mandar os chunks
  gravados em vez da lista; o formato já é um `Int8Array` compactável.

### 11.6 Como isso será verificado

Um teste que roda em Node, sem navegador: dois campos independentes, a mesma
lista de impactos aplicada em ordem, e uma varredura comparando a densidade
**voxel a voxel**. Diferença esperada: **zero**, não "pequena". Este teste entra
junto com a etapa 2 e roda a cada mudança na função de escavação — é o único
jeito de a promessa de multijogador não virar uma intenção.
