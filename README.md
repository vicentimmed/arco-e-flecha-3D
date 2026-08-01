# Arco & Flecha — simulação balística

Jogo 3D de arco e flecha em **Three.js** com física em **Rapier3D**. Roda no
navegador, sem assets externos: cenário, personagem e alvos são gerados por
código.

O diferencial não é o visual — é que **nada da trajetória é simulado "de
mentira"**. A flecha é um corpo rígido com massa, inércia e momento angular; o
que ela faz no ar sai de gravidade, arrasto e vento; o que acontece no impacto
sai do solver de contato. Não existe interpolação, curva pré-calculada,
correção de rota nem assistência de mira.

![campo de tiro](docs/captura.jpg)

## Rodar

```bash
npm install
```

```bash
npm run dev
```

Abre em `http://localhost:5173`. Para gerar a versão estática:

```bash
npm run build
```

O `dist/` resultante é autocontido (o WASM do Rapier vem embutido) e funciona em
qualquer hospedagem de arquivos estáticos.

## Controles

| Comando | Ação |
|---|---|
| **Mouse** | mirar (clique na tela para capturar o ponteiro; `Esc` libera) |
| **Botão esquerdo** | segurar tensiona o arco, soltar dispara |
| **W A S D** | andar |
| **Roda do mouse** | regular o pino de mira (10–100 m) |
| **Tab** | selecionar o próximo alvo e calibrar o pino nele |
| **C** | alternar a câmera que acompanha a flecha |
| **F** | acompanhar automaticamente toda flecha disparada |
| **T** | traçado da trajetória real da última flecha |
| **R** | limpar as flechas cravadas |
| **~** | painel de depuração |
| **H** | ocultar a ajuda |

Segurar o arco tensionado por mais de 3 s começa a tremer a mira, e o tremor
cresce com o tempo — vale soltar e reengatar.

## A física

Tudo em SI, com 1 unidade Three.js = 1 metro. Todas as constantes moram em
[`src/config.js`](src/config.js).

| Grandeza | Valor | Efeito no jogo |
|---|---|---|
| Gravidade | −9,81 m/s² | a queda que o jogador precisa compensar |
| Passo da física | 1/120 s, fixo | resultado idêntico em 60, 120 ou 144 Hz |
| Massa da flecha | 25 g | define o momento transferido ao alvo |
| Comprimento / diâmetro | 0,75 m / 8 mm | área frontal do arrasto = 5,03·10⁻⁵ m² |
| Coeficiente de arrasto | 2,0 | ~20 % de perda de velocidade em 100 m |
| Área lateral efetiva | 55× a frontal | penaliza voar de lado; é o que estabiliza |
| Centro de pressão | 13 cm atrás do CM | gera o torque que alinha a ponta |
| Velocidade inicial | 30 → 85 m/s | curva saturando em 1,2 s de tensionamento |
| Densidade do ar | 1,225 kg/m³ | nível do mar, 15 °C |
| Vento | 0–12 m/s, com rajadas | entra pela velocidade relativa ao ar |

### Quatro decisões que fazem a diferença

**1. O arrasto é calculado à mão.** Nenhuma engine de física traz arrasto
aerodinâmico. O `linearDamping` do Rapier é amortecimento exponencial — modelo
diferente, que erraria a queda. A cada passo fixo aplicamos:

```
F_arrasto = −½ · ρ · Cd · A_ef · |v_rel| · v_rel
```

com `v_rel = v_flecha − v_vento`. O vento nunca é uma força separada: ele altera
a velocidade relativa ao ar, e é por isso que o efeito dele depende da
velocidade da flecha e do tempo de voo. Um tiro fraco a 100 m sofre muito mais
deriva que um tiro forte.

**2. A flecha se alinha sozinha, por aerodinâmica real.** A ponta não é girada
à força para o vetor velocidade. O arrasto é aplicado no **centro de pressão**,
13 cm atrás do centro de massa, e a área efetiva cresce com o ângulo de ataque
(`A_ef = A · (1 + 55·sen²α)`). O torque resultante endireita a flecha com o
pequeno atraso e a oscilação amortecida de uma empena de verdade. Medido em voo,
o ângulo de ataque fica entre 0,4° e 3,4° do lançamento ao pouso, inclusive
passando pelo apogeu de um tiro alto.

**3. CCD ligado.** A 85 m/s a flecha percorre 71 cm por passo de física. Sem
detecção contínua de colisão ela atravessaria alvos finos de forma aleatória — e
isso costuma ser diagnosticado como bug de colisão quando é passo de integração.

**4. O impulso é lido antes do contato.** Depois que o solver resolve a colisão a
velocidade da flecha já mudou. Guardamos a velocidade do passo anterior e é ela
que vira `J = m·v`, aplicada no ponto exato do contato (lido do manifold do
narrow-phase, nunca estimado pelo centro de massa — numa flecha de 75 cm o erro
seria de dezenas de centímetros).

### Os alvos

As massas não são arbitrárias. Uma flecha de 25 g a 70 m/s carrega 1,75 kg·m/s;
fazendo a conta de energia contra a elevação do centro de gravidade, **só tomba
quem pesa menos de ~3 kg**. Então:

- **leve (2,5 kg, tripé)** — tomba com um impacto forte e centrado; resiste a
  tiro fraco ou baixo. O tombo é consequência da conta, não um efeito roteirizado.
- **suspenso (5 kg, junta revoluta)** — balança como pêndulo, com as flechas
  cravadas indo junto.
- **pesado (70 kg)** — absorve e mal se mexe.

A flecha cravada em alvo dinâmico continua sendo um corpo dinâmico, presa por um
`FixedJoint` que preserva a orientação exata do impacto. Congelá-la travaria o
alvo junto. Já no cenário estático (chão, rochas, árvores) congelar é mais
estável e mais barato que um vínculo.

A pontuação sai da posição do impacto convertida para o referencial do alvo, o
que mantém os anéis corretos mesmo com o alvo tombado ou balançando.

## Mira: o pino

Este é o único ponto do jogo que merece explicação, porque parece assistência e
não é.

A câmera fica atrás e à esquerda da arqueira — enquadramento, não linha de tiro.
Se o retículo ficasse fixo no centro da tela, ele mentiria: a flecha sai do arco,
não da câmera. Então o retículo **não é fixo**. A cada frame ele é desenhado onde
a linha de tiro real cruza a distância regulada no pino, projetada na tela.

É exatamente o que faz a mira de um arco de verdade, e o que ela corrige é só
geometria:

- ✅ elimina o paralaxe entre câmera e flecha;
- ❌ não compensa gravidade;
- ❌ não compensa vento;
- ❌ não sabe onde estão os alvos.

Ou seja: pôr o pino em cima do alvo acerta **em linha reta**. A flecha cai. Se o
alvo está a 60 m e o pino está em 30, a leitura da linha continua honesta — só a
elevação e a deriva continuam sendo problema seu. `Tab` calibra o pino no alvo
selecionado; a roda do mouse ajusta de 5 em 5 m.

## Critérios de aceite

Abra o painel com `~` e clique em **rodar auto-teste**. Ele monta um mundo
Rapier temporário — mesma gravidade, mesmo passo fixo, mesma massa, mesma conta
de arrasto — e verifica:

| Teste | Resultado |
|---|---|
| Alcance sem arrasto, 60 m/s a 45° vs `v₀²·sen(2θ)/g` | **366,9 m vs 367,0 m — erro 0,03 %** |
| Arrasto reduz o alcance e a velocidade decresce | **224,1 m (−39 %), monotônica** |
| CCD a 85 m/s contra placa de 5 cm, 50 disparos | **50/50 detectadas, 0 atravessaram** |

Medições complementares no jogo: velocidade de impacto de 82,7 m/s a 10 m e
66,5 m/s a 100 m (perda de ~22 %, na faixa de uma flecha real); 30 flechas
cravadas + 7 alvos custam ~1,5 ms de CPU por frame.

O painel também traz vetores de velocidade / arrasto / vento no mundo, telemetria
de voo e sliders para massa, Cd, velocidade máxima, gravidade, vento e posição do
centro de pressão. Os sliders valem para as **próximas** flechas — massa e
inércia são fixadas na criação do corpo.

## Estrutura

```
src/
  main.js              laço principal, acumulador de passo fixo
  config.js            todas as constantes físicas, com unidade
  core/
    physics.js         mundo Rapier, eventos de contato (não importa Three.js)
    sync.js            única ponte física → visual, com interpolação
    renderer.js        WebGL, câmera, luzes PBR, céu e nuvens
  entities/
    environment.js     relevo, colisor trimesh, rochas, árvores, vegetação
    player.js          arqueira, postura por IK de dois ossos
    bow.js             arco recurvo, corda e lâminas animadas
    arrow.js           aerodinâmica, impacto, flechas cravadas
    target.js          alvos, vínculos, pontuação por anéis
  systems/
    wind.js            vento contínuo com rajadas
    aim.js             linha de tiro e projeção do pino
    camera.js          terceira pessoa + câmera da flecha
    input.js           mouse com pointer lock e teclado
    selftest.js        critérios de aceite em mundo isolado
  ui/
    hud.js             placar, vento, força, retículo
    debug.js           telemetria, vetores, sliders, auto-teste
  utils/
    math.js            IK de dois ossos, interpolação, PRNG
    noise.js           ruído de valor + FBM (terreno e vento)
    geometry.js        segmentos que se esticam entre dois pontos
```

O relevo alimenta o render **e** o colisor com a mesma geometria, então não
existe descolamento entre o que se vê e o que a física enxerga. `core/physics.js`
não conhece Three.js; a sincronização acontece num único lugar.

## Notas de implementação

- **Interpolação de render.** O passo é fixo em 1/120 s num acumulador. Guardamos
  a transformação anterior e a atual de cada corpo e interpolamos por `alpha` na
  hora de desenhar — sem isso a imagem treme em qualquer taxa de quadros que não
  seja múltipla de 120.
- **Torque acumulado.** No Rapier, forças **e torques** somam entre passos até
  serem zerados. `addForceAtPoint` alimenta os dois acumuladores, então
  `resetForces()` sozinho deixa o torque crescendo indefinidamente e a flecha
  acaba voando de traseira. É preciso `resetTorques()` também.
- **Orientação dos triângulos do terreno.** Como z diminui conforme o índice da
  linha cresce, a ordem ingênua de índices gera faces viradas para baixo e o chão
  some por backface culling.
- **Mundo determinístico.** Terreno, vegetação e posicionamento usam PRNG com
  semente fixa: o vale é sempre o mesmo entre sessões.
- **Depuração.** `window.game` está exposto no console para inspecionar
  `player`, `arrows`, `targets`, `wind` e o mundo de física em tempo real.

## Limites conhecidos

- Sem áudio (o projeto não usa nenhum arquivo externo).
- A arqueira não tem ciclo de caminhada completo — anda com balanço e postura de
  tiro mantida.
- O arrasto usa Cd constante; não há modelo de número de Reynolds nem de efeito
  Magnus (a flecha não tem rotação axial imposta pela empena).
