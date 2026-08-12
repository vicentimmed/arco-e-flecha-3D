# Plano — Skins do arqueiro (e o Arqueiro Medieval)

> **Estado: IMPLEMENTADO.** As seis fases estão em pé: o rig separado da
> fantasia, o registro de skins, o arqueiro medieval, a escolha na tela de
> entrada, a skin viajando na rede e os bots misturados.
>
> **Escopo:** o corpo do jogador ganhou uma segunda APARÊNCIA — um arqueiro
> medieval homem — escolhida na tela de entrada, antes de entrar na sala. O
> movimento, a física, a mira, a câmera, o colisor e a rede continuam
> **exatamente os mesmos**. Skin é fantasia, não é estatística.
>
> **A decisão que organizou tudo:** `entities/player.js` misturava duas coisas
> que não são a mesma — o **rig** (juntas, IK, pose, estado, rede) e a
> **fantasia** (as primitivas e os materiais pendurados nas juntas). As duas
> foram separadas e a fantasia virou módulo. A skin nova é a segunda
> implementação de um contrato, não um `if` dentro do corpo.
>
> ---
>
> ## O que o teste em tela desmentiu
>
> **1. O orçamento partia de um número inventado.** O §2.7 dizia "~60 malhas por
> arqueiro", contado à mão no fonte. O corpo tem **99** — os laços escondem mais
> peças do que parece, e o arco sozinho são 14. Todo o raciocínio de corte foi
> refeito sobre a medida real (ver §2.7, agora com números medidos).
>
> **2. O vão do capuz já nasce virado para o rosto.** Copiei do cabelo da
> arqueira o `rotation.y = -π/2` — que ELA precisa, por ser meia esfera — e o
> capuz fechou por completo. No `SphereGeometry` do Three, `phi = 0` aponta para
> −X e `phi = π/2` para +Z, então um arco de 1,44π centrado na nuca deixa a
> fatia que sobra exatamente em −Z, que é a direção do rosto. O sintoma foi uma
> cabeça sem rosto nenhum, e ele não aparece de trás.
>
> **3. Multiplicar a cor do jogador não escurece o que se pensa.** O plano dizia
> "calças = cor × 0,55", copiando a bermuda da arqueira. O Three trabalha em
> espaço LINEAR: metade do laranja ainda sai laranja, e a perna inteira é um
> terço do corpo. O resultado foi meia-calça fluorescente. A conta certa parte da
> **lã crua** e caminha 30 % na direção da cor.
>
> **4. Não se pendura acessório num segmento de osso.** O enfaixamento da canela
> ia ser filho do `shin` — e `orientSegment` escreve `scale.y = comprimento do
> osso`, então o aro sairia achatado a 42 %. A peça foi cortada; a mudança que a
> salvaria é do rig, e acabamento não paga mudança de rig.
>
> **5. Dois setters não guardavam o que escreviam.** `setJetpackVisible` e
> `setHeadVisible` só mexiam na malha — e a malha morre na troca de skin. Trocar
> de corpo na Lua devolvia um arqueiro voando sem mochila; em primeira pessoa,
> uma cabeça no meio da câmera. Achados por um teste de estresse de vinte trocas
> seguidas, não pelo olho. Ver §3.4, que é a seção que mais rendeu deste plano.
>
> **6. Uma bancada sem o tone mapping do jogo MENTE.** As primeiras decisões de
> cor foram tomadas sob luz de estúdio, sem ACES, e mandaram "corrigir" o que não
> estava errado. A bancada hoje copia número a número as luzes de
> `core/renderer.js`. Ver `dev/skins.html`.

---

## 0. O que é INVARIANTE, e por quê

Antes de qualquer geometria nova, o contrato. `BODY` (em
[player.js:22](../src/entities/player.js#L22)) tem dezoito números, e eles não
são todos da mesma natureza. Uns são **osso**, outros são **carne**.

**Osso — congelado, igual em toda skin:**

| campo | valor | quem depende |
| --- | --- | --- |
| `hipY`, `waistY`, `chestY`, `shoulderY`, `neckY`, `headY` | 0,9 … 1,625 | pivô da câmera (`getCameraPivot`), origem dos ombros e quadris da IK |
| `thigh`, `shin`, `upperArm`, `foreArm` | 0,44 / 0,42 / 0,28 / 0,26 | `solveTwoBoneIK` — comprimento de osso é entrada da IK |
| `shoulderX`, `hipX`, `stanceWidth`, `ankleY` | 0,175 / 0,105 / 0,23 / 0,085 | largura da base, pose dos pés, `poseLegTo` |
| `stanceYaw` | 1,16 rad | o giro do tronco — é dele que nasce o enquadramento inteiro |
| `armReach` | 0,505 | onde o punho do arco fica: define a linha da flecha |
| `anchorSide`, `anchorDrop`, `anchorForward` | 0,062 / 0,09 / 0,03 | a âncora da corda, e daí `getEye()` — a **primeira pessoa** |
| `headR` | 0,107 | posições do rosto, que são todas múltiplos de `R` |

Três razões para congelar, e a terceira é a que fecha o assunto:

1. **A câmera sai daí.** `getCameraPivot` usa `shoulderY`; `getEye` usa a
   âncora. Uma skin mais alta veria de mais alto e atiraria de outra altura —
   isso é regra de jogo disfarçada de enfeite.
2. **O colisor não é da skin.** A cápsula é fixa
   ([config.js:131](../src/config.js#L131): `height: 1.72`,
   `colliderRadius: 0.35`) e é ela que a flecha acerta. Uma skin visualmente
   mais alta teria cabeça fora da hitbox; uma mais baixa, corpo sobrando. Skin
   com vantagem competitiva é bug, não estilo.
3. **A pose viaja como FASE, não como esqueleto.** O que a rede manda é
   `gaitPhase`, `drawFraction`, `pitch` — e cada cliente monta o corpo daquele
   jogador a partir disso. O contrato só fecha se "fase 0,3 do passo" quiser
   dizer a mesma coisa nas duas pontas.

**Carne — a skin manda:** raio dos segmentos (`makeSegment(0.057, …)`), raio das
juntas, escala e proporção das peças de tronco, todas as peças decorativas, e
todos os materiais. Um gambeson acolchoado tem 12 cm de peito a mais que uma
camiseta e isso é só `scale` de um cilindro — não toca em osso nenhum.

**Regra prática:** se o número entra numa conta de IK, de câmera ou de física,
é osso. Se ele só decide o tamanho de uma malha, é carne.

---

## 1. Arquitetura — o rig e a fantasia

```
src/entities/
  player.js            ← vira O RIG: estado, IK, pose, rede, LOD, ragdoll
  bow.js               ← ganha uma paleta opcional no construtor
  skins/
    index.js           ← registro, contrato, helpers compartilhados
    atleta.js          ← a arqueira de hoje, extraída SEM mudar um pixel
    medieval.js        ← o arqueiro medieval
src/shared/
  skins.js             ← os ids, e só isso (o servidor importa daqui)
```

### 1.1 O contrato de uma skin

```js
export const skin = {
  id: "medieval",
  label: "Arqueiro Medieval",
  detalhe: "gambeson, capuz e arco de teixo",
  swatch: ["#6b5535", "#3f2d1c"],   // as duas cores do botão do lobby

  /** Materiais NOVOS a cada arqueiro — nunca de módulo. Ver §6.6. */
  createMaterials(),

  /** Pendura o corpo no rig. Recebe o Player; devolve os HANDLES. */
  build(rig) -> {
    head,                 // THREE.Group — a cabeça inteira, filha de spine
    faceDetail: [],       // peças que somem acima de 12 m
    sway,                 // { root, a, b, tip, tuning } | null
    armR, armL,           // { group, upper, fore, elbow, hand, band }
    legR, legL,           // { group, thigh, shin, knee, shoe, short }
  },

  /** Onde a cor do jogador entra. Ver §6.3. */
  tint(mat, cor),

  /** Paleta do arco, ou null para o arco padrão. */
  bowPalette,
};
```

Os handles não são uma lista arbitrária: são **exatamente** os nomes que o
código de pose já lê hoje, e o objetivo é que `updateArms`, `updateLegs`,
`poseLegTo`, `poseRagdoll`, `updateReloadArm`, `updateKnifeArm` e
`poseKamehameha` não mudem **uma linha**. `poseLegTo`
([player.js:1859](../src/entities/player.js#L1859)) orienta `leg.short` entre o
quadril e meia coxa — no atleta isso é a bermuda, no medieval é a barra da
túnica. Mesmo nome, mesma conta, roupa diferente.

### 1.2 O que o rig NÃO entrega para a skin

- **O jetpack.** É equipamento da FASE (a Lua), não da fantasia. Continua em
  `player.js` e continua sendo filho do `spine`. Um capuz não muda a mochila.
- **O arco, a flecha da mão e a faca.** Geometria e métrica ficam no rig
  (`BRACE_HEIGHT`, `DRAW_LENGTH` e o `getMuzzleWorld` do arco são a linha de
  tiro). A skin só pode mandar na **paleta** — ver §2.6.
- **`podarSombras`, `fillNeutralVertexColors`, `withRimLight`.** São helpers do
  corpo, sobem para `skins/index.js` e as duas skins usam os mesmos.

### 1.3 `updatePonytail` vira `updateSway`

O rabo de cavalo ([player.js:1874](../src/entities/player.js#L1874)) é uma
cadeia de dois segmentos com atraso proporcional à velocidade angular. É boa
máquina e não tem nada de feminino: no medieval ela move o **liripipe** — o
rabicho de tecido do capuz. Mesma função, alvo declarado pela skin:

```js
sway: {
  root, a, b, tip,           // os Object3D
  tuning: { yawGain: .09, pitchGain: .25, damp: 9, len1: .17, len2: .22 },
}
```

Quando `sway` é `null`, `updateSway` retorna na primeira linha. Skin careca é
skin válida.

---

## 2. O Arqueiro Medieval — o desenho

Um arqueiro inglês de campanha: gambeson acolchoado, capuz com mantelete,
calças de lã enfaixadas, botas de couro, aljava de madeira. **A leitura de
quarenta metros vem da silhueta** — a ponta do capuz e o mantelete sobre os
ombros são o que diz "medieval" antes de qualquer textura aparecer.

Referencial e unidades: metros, no espaço do `spine` (origem no quadril, `-Z`
na mira), iguais aos de hoje.

### 2.1 Cabeça — filha de `head`

| peça | geometria | material |
| --- | --- | --- |
| crânio | `makeJoint(headR, skin, 18)`, escala `(0.97, 1.03, 1.0)` | pele |
| capuz | esfera aberta `r = headR·1.17`, `thetaLength ≈ 0.72π`, escala `(1.05, 1.10, 1.13)`, `z += 0.012` | lã |
| aba do capuz | cilindro aberto `1.02·headR → 1.20·headR`, alt. 0.055, inclinado −0.25 rad sobre a testa | lã |
| liripipe (2 seg.) | cadeia de sway, raios 0.032 e 0.022 | lã (recebe cor) |
| barba | 3 cápsulas: queixo `0.06×0.05`, duas laterais até a orelha | cabelo |
| bigode | caixa `R·0.34 × R·0.06 × R·0.06` | cabelo |
| sobrancelhas | caixa `R·0.34 × R·0.09` (mais grossas que as de hoje) | cabelo |
| nariz | cone `R·0.12 × R·0.30` (mais reto e maior) | pele |
| olhos, íris, boca, orelhas | **mesmas posições de hoje**, sem mudança | — |

**Mantelete (a ombreira do capuz) é filho do `spine`, NÃO da cabeça.** Se
pendurar na cabeça, ele gira quando o arqueiro olha para o lado e o efeito é
imediato de fantasia de papel. Cone aberto `0.16 → 0.26`, altura 0.16, no topo
do tronco.

**LOD do rosto:** entram em `faceDetail` olhos, íris, sobrancelha, nariz, boca,
orelha e **bigode**. **Barba, capuz e liripipe ficam de fora** — são silhueta, e
silhueta é justamente o que precisa sobreviver à distância.

**Primeira pessoa:** capuz, aba, barba e liripipe são todos filhos de `head`, e
`setHeadVisible(false)` ([player.js:1945](../src/entities/player.js#L1945))
apaga a cabeça inteira de uma vez. Nenhuma peça nova pode ser pendurada no
`spine` na altura dos olhos, ou a câmera de primeira pessoa fica dentro dela.

### 2.2 Tronco — filho de `spine`

| peça | geometria | material |
| --- | --- | --- |
| gambeson | cilindro `0.160 → 0.142`, escala z `0.70` (hoje: `0.152 → 0.128`, z `0.66`) | **túnica — recebe a cor** |
| costuras do acolchoado | 6 caixas `0.010 × 0.34 × 0.008` no peito e nas costas | túnica escurecida |
| saiote (barra da túnica) | cilindro aberto `0.150 → 0.186`, altura 0.20, abaixo da cintura | túnica |
| ombreiras de couro | 2 cápsulas achatadas sobre os ombros, `r = 0.075`, escala `(1, 0.55, 1)` | couro |
| gorjal | toro fino no pescoço, `r = 0.052` | linho |
| cinto largo | cilindro `0.146`, altura 0.07 | couro |
| fivela | caixa `0.05 × 0.045 × 0.018` | metal |
| escarcela (bolsa) | caixa `0.09 × 0.10 × 0.05`, lado direito do cinto | couro escuro |
| bandoleira | caixa `0.055 × 0.42 × 0.016`, como hoje | couro escuro |
| aljava de madeira | cilindro `0.055 → 0.048`, alt. 0.34 + 2 aros | madeira + couro |
| 4 hastes + 4 empenas | como hoje, sem mudança de contagem | haste + **empena recebe a cor** |

As **ombreiras** são a peça-chave da leitura masculina: elas alargam a silhueta
em ~7 cm de cada lado **sem tocar em `shoulderX`**, que é osso (§0). É o truque
que permite um corpo mais pesado com a mesma IK.

**Manto/capa: fica de fora da v1.** Um pano grande nas costas ou é rígido (e aí
atravessa o corpo ao correr) ou precisa de simulação própria — e ainda entraria
no passe de sombra inteiro por causa do tamanho (§6.5). O mantelete já entrega a
silhueta pelo custo de um cone.

### 2.3 Braços — `buildArm` da skin

Mesma estrutura de hoje (`upper`, `fore`, `elbow`, `hand`, `band`), trocando:

- `upper` e `fore` em **linho** (manga), não em pele. Raios um pouco maiores:
  0.062 e 0.051 (hoje 0.057 / 0.047).
- **Luva de tiro** nas duas mãos: palma e dedos em couro escuro, mesmos
  tamanhos — a mão do arco fica a meio metro do olho em primeira pessoa e é
  onde o detalhe rende mais.
- **Bracer** (a proteção da corda) maior e com 3 tiras em vez de 1: cilindro
  `0.062 → 0.058`, altura 0.11, mais dois aros finos. **A tira do meio recebe a
  cor do jogador.**

### 2.4 Pernas — `buildLeg` da skin

- `thigh` e `shin` em **lã** (as *hose*), não em pele. Raios 0.095 e 0.072.
- `short` (o que a IK orienta na meia coxa) vira a **barra da túnica**, em lã
  escura, raio 0.112.
- **Enfaixamento cruzado:** 3 toros finos (`r = 0.070`, tubo 0.008) por canela,
  filhos do `shin`. Custo ridículo, leitura enorme.
- **Bota:** sola `0.104 × 0.045 × 0.24`, cano `0.098 × 0.13 × 0.15`, volta do
  cano `0.106 × 0.035 × 0.14`. Ponta menos comprida que o tênis, cano mais alto.
  A volta do cano **recebe a cor**.

### 2.5 Materiais

Nove, cada um com o seu brilho — o critério é o mesmo de hoje
([player.js:58](../src/entities/player.js#L58)): a diferença de `roughness`
entre as peças é o que conta de que coisa cada uma é feita.

| material | cor base | roughness | trama |
| --- | --- | --- | --- |
| `skin` / `skinDark` | `#d9a077` / `#c98f63` | 0.62 / 0.66 | não |
| `hair` (cabelo e barba) | `#3a2a1c` | 0.55 | não |
| `linen` (mangas, gorjal) | `#c9bda4` | 0.92 | sim |
| `wool` (capuz, hose, liripipe) | `#4a4437` | 0.95 | sim |
| `tunic` (gambeson) | `#6b5535` | 0.88 | sim |
| `leather` / `leatherDark` | `#6b4526` / `#3d2614` | 0.86 / 0.90 | sim |
| `wood` (aljava, haste) | `#8a6a44` | 0.72 | não |
| `metal` (fivela, ponta, ilhoses) | `#b9bcc2` | 0.30, metal 0.85 | não |
| `eyeWhite`, `eyeDark`, `mouth` | como hoje | como hoje | não |

### 2.6 O arco

Um recurvo preto de metal num arqueiro de gambeson é a única peça que quebraria
o conjunto inteiro. Mas a geometria do arco é linha de tiro: `BRACE_HEIGHT`,
`DRAW_LENGTH`, `LIMB_PROFILE` e o `getMuzzleWorld`.

**v1 — troca só a paleta.** `Bow` ([bow.js:30](../src/entities/bow.js#L30))
passa a aceitar `new Bow(palette)`, com `{ limb, grip, string }`. O medieval usa
teixo (`#8a6a44`, roughness 0.75, metalness 0), punho de couro (`#4a3220`) e
corda de linho encerado (`#e3dcc4`). Zero risco, e resolve 80 % do incômodo.

**v2 (opcional, §5 fase 7)** — silhueta de arco longo: `LIMB_PROFILE` mais reto
e lâminas mais longas. **Condição inegociável:** `BRACE_HEIGHT`, `DRAW_LENGTH` e
o ponto devolvido por `getMuzzleWorld` ficam idênticos aos de hoje, ou a flecha
passa a sair de outro lugar e isso deixa de ser skin.

### 2.7 Orçamento de malhas — **medido**, não estimado

|  | atleta | medieval | diferença |
| --- | ---: | ---: | ---: |
| malhas | 99 | **108** | +9 (+9 %) |
| com `castShadow` (após poda) | 25 | **28** | +3 |
| materiais | 29 | 31 | +2 |
| peças do rosto (somem a 12 m) | 10 | 11 | +1 |
| **malhas além de 12 m** | **89** | **97** | +8 (+9 %) |

A última linha é a que importa numa sala cheia: acima de 12 m o rosto inteiro
sai (`setFaceDetail`), e o que resta é o que se paga doze vezes.

**O alvo do plano era ficar dentro de 5 %, e ele não foi cumprido: ficou em 9 %.**
O que comprou esses 9 % são peças de silhueta — mantelete, ombreiras, saiote,
ponta do capuz e barba —, e cortar qualquer uma devolve o corpo para "atleta com
outra cor". Dois cortes foram feitos por não passarem nesse teste: as costuras
do acolchoado (a trama do fragmento já dá o grão) e a volta da bota, que dizia a
mesma coisa que o cano colorido diz.

Medido a qualquer momento, com o jogo rodando:

```bash
let n = 0; game.player.root.traverse((o) => o.isMesh && n++); console.log(n)
```

Ou, lado a lado e com o corte do rosto separado, em `/dev/skins.html`.

---

## 3. A troca na tela inicial

### 3.1 Onde e como

Uma seção nova em [ui/lobby.js](../src/ui/lobby.js), **acima** do campo do nome
e abaixo da qualidade, com a mesma estrutura de `radiogroup` que a qualidade já
usa ([lobby.js:94](../src/ui/lobby.js#L94)) e o mesmo CSS
([style.css:1685](../src/style.css#L1685), duplicado como `.lobby-skin-*`):

```
   PERSONAGEM
   ┌──────────────────┬──────────────────┐
   │  Atleta          │ Arqueiro         │
   │  moderna, leve   │ Medieval         │
   └──────────────────┴──────────────────┘
```

Cada botão carrega as duas cores do `swatch` da skin como um filete vertical à
esquerda — é o que dá diferença visual sem precisar de imagem nenhuma.

### 3.2 Persistência

`localStorage["arco-flecha:skin"]`, no mesmo molde de `savedQuality()`
([config.js:1891](../src/config.js#L1891)) e do nome
([lobby.js:227](../src/ui/lobby.js#L227)), com `try/catch` para navegação
privada. Valor desconhecido ou ausente → `"atleta"`.

### 3.3 O momento em que o corpo é construído

Aqui há uma armadilha real: o `Player` local nasce dentro do `new Game(...)`
([main.js:184](../src/main.js#L184)), que roda **antes** de o lobby ser
respondido — o mundo é montado enquanto a pessoa digita o nome, e é isso que
faz a entrada ser imediata. Dois caminhos, e o plano usa os dois:

1. **No boot**, `main()` lê a skin salva e passa para o `Game`, junto com
   `applyQuality(savedQuality())` ([main.js:3092](../src/main.js#L3092)). Quem
   já escolheu nasce certo, sem rebuild.
2. **Ao clicar**, `Player.setSkin(id)` reconstrói o corpo na hora. É barato
   (nenhum laço de quadro está rodando), e a pose é toda derivada de campos —
   nenhum estado vive dentro das malhas.

**Sem `location.reload()`**, ao contrário da qualidade. A qualidade recarrega
porque shadow map, densidade de grama e AO do terreno são assados na construção
do mundo; a skin não é entrada de nada disso.

### 3.4 `setSkin` — o que precisa ser refeito depois do rebuild

Esta lista é o coração do risco desta fase. Sete coisas, e esquecer qualquer uma
dá um bug silencioso:

1. `dispose()` do que sai — geometrias **e** materiais antigos, ou vaza GPU a
   cada troca no lobby.
2. `this.color = null` **antes** de reaplicar a cor: `setColor`
   ([player.js:825](../src/entities/player.js#L825)) sai na primeira linha se a
   cor for igual à guardada, e o corpo novo nasceria sem tingir.
3. `fillNeutralVertexColors(this.root)` **antes** de o arco entrar (§6.1).
4. `setJetpackVisible(this.jetpackVisible)` — o estado é da fase, não do corpo.
5. `setHeadVisible` conforme a câmera atual (primeira pessoa).
6. `this._faceDetailOn = null` e `setFaceDetail(...)` de novo.
7. `podarSombras(this.root)` outra vez — ela roda uma vez na construção.

E, no remoto: `heldArrow` e `knife` são filhos de `armL.hand`, que é uma malha
nova; precisam ser re-parenteados.

---

## 4. A rede — os outros também precisam ver

Sem isto, você é um arqueiro medieval só na sua tela.

| arquivo | mudança |
| --- | --- |
| `src/shared/skins.js` | `SKIN_IDS = ["atleta", "medieval"]`, `DEFAULT_SKIN`, `sanitizeSkin(raw)` |
| `src/net/client.js:114` | `skin` entra no `hello`, ao lado de `name` e `version` |
| `server/room.js:2823` | `skin: sanitizeSkin(msg.skin)` no registro do jogador |
| `server/room.js:3763` | `publicView` devolve `skin` |
| `src/net/remotePlayers.js:58` | `new Player(terrain, this.entityId, info.skin)` |
| `src/shared/protocol.js:98` | `PROTOCOL_VERSION` 16 → **17** |

**A validação é do SERVIDOR**, contra a lista, e id desconhecido vira o padrão.
Não é sobre segurança — é que um cliente adiantado (ou uma aba velha em cache)
mandando `skin: "dragao"` faria doze bonecos sumirem da tela de todo mundo.
`sanitizeSkin` mora em `src/shared/` porque o servidor já importa de lá
([room.js:26](../server/room.js#L26)).

**Por que bater a versão do protocolo,** se o campo é opcional e o padrão
cobre a ausência: porque um cliente velho contra um servidor novo mostraria
todo mundo de atleta, calado. A checagem de versão
([room.js:2798](../server/room.js#L2798)) transforma isso num "recarregue a
página" em vez de num mistério.

**Bots** (`server/botSim.js`): entram na mesma lista dos humanos via
`publicView`. Cada bot sorteia uma skin no nascimento — um campo de batalha só
de atletas contra um jogador medieval fica estranho, e a mistura sai por uma
linha.

**Nada disto entra no pacote de poses.** A skin viaja **uma vez**, no `hello` e
no roster, como o nome e a cor. O tráfego de 20 Hz não muda em um byte.

---

## 5. As fases, cada uma verificável sozinha

### Fase 1 — Extrair a arqueira de hoje para `skins/atleta.js`
Mover `createMaterials`, o corpo de `build()`, `buildArm`, `buildLeg`, e os
helpers `withRimLight` / `fillNeutralVertexColors` / `podarSombras`.
`player.js` fica com rig, pose, estado e rede.
**Pronto quando:** o jogo roda e a arqueira está **pixel a pixel igual**. Captura
antes e depois, no mesmo ponto do vale, com o mesmo Sol. Zero mudança visual é o
critério — esta fase não é para melhorar nada.

### Fase 2 — Registro, `setSkin`, e o terceiro parâmetro do `Player`
`skins/index.js`, `Player(terrain, entityId, skinId)`, `setSkin(id)` com os sete
passos do §3.4.
**Pronto quando:** `game.player.setSkin("atleta")` no console reconstrói o corpo
sem erro, sem piscar cor, sem perder o jetpack na Lua e sem vazar (contagem de
malhas estável depois de dez trocas).

### Fase 3 — O arqueiro medieval (o grosso do trabalho)
Todo o §2, na ordem: cabeça → tronco → braços → pernas → paleta do arco.
**Pronto quando:** os seis testes do §7 passam.

### Fase 4 — A tela de entrada
Seção no lobby, CSS, `localStorage`, leitura no boot, troca ao vivo.
**Pronto quando:** escolho medieval, entro, saio, recarrego a página e continuo
medieval.

### Fase 5 — A rede
Tudo do §4.
**Pronto quando:** duas abas, skins diferentes, cada uma vê a outra certa — e
uma terceira aba que entra depois vê as duas certas (o caminho do `snapshot`, que
é diferente do `JOIN` e é onde esse tipo de bug se esconde).

### Fase 6 — Bots, LOD e a conta
Skin sorteada por bot; conferir que `faceDetail` corta as peças certas; medir
malhas e chamadas de desenho com seis arqueiros medievais em campo, contra os
mesmos seis de atleta.
**Pronto quando:** a diferença de chamadas de desenho é menor que 5 %.

### Fase 7 — Opcional, e só se sobrar vontade
Arco longo de verdade (§2.6 v2) e **prévia 3D no lobby**. A prévia é bonita e
não é barata: o laço de render ainda não está rodando na tela de entrada, então
ela exige um render alvo próprio, uma luz e um laço só dela. Fica fora da v1 de
propósito — dois botões com filete de cor resolvem a escolha, e a pessoa vê o
corpo inteiro três segundos depois.

---

## 6. Armadilhas — todas encontradas lendo o código, nenhuma hipotética

**6.1 Malha preta.** Os materiais do corpo têm `vertexColors: true`, e o Three
define `USE_COLOR` pelo MATERIAL, sem olhar a geometria. Peça sem atributo
`color` sai **preta**. Toda malha nova precisa passar por
`fillNeutralVertexColors` ([player.js:141](../src/entities/player.js#L141)), que
roda no fim da construção e **antes** de o arco entrar no `root` — os materiais
do arco não têm `vertexColors` e não devem ganhar o atributo à toa.

**6.2 Cache de programa do shader.** `withRimLight` define
`customProgramCacheKey = archer-rim-${forca}-${tecido}`
([player.js:136](../src/entities/player.js#L136)). Dois materiais com a mesma
força e a mesma trama compartilham programa — o que é certo e é economia. Mas
uma variante nova de shader (uma cota de malha brilhante, por exemplo) que
reaproveite a chave seria **silenciosamente ignorada**. Chave nova para shader
novo.

**6.3 `setColor` não pode conhecer skins.** Hoje ele tinge cinco materiais por
nome ([player.js:825](../src/entities/player.js#L825)). Vira
`this.skin.tint(this.mat, cor)`, e cada skin decide: no atleta, camiseta,
bermuda, tênis, fita e empena; no medieval, gambeson, hose, volta da bota, tira
do bracer, liripipe e empena. O critério que já está lá continua valendo — **pele
e cabelo nunca**, e as peças pequenas ficam mais claras que a roupa para não
sumirem contra o couro e o cabelo.

**6.4 `dispose` varre `Object.values(this.mat)`**
([player.js:814](../src/entities/player.js#L814)). Material de skin que não more
em `this.mat` vaza. Sem exceção, nem para "só um material do capuz".

**6.5 Sombra por tamanho.** `podarSombras` corta tudo com raio efetivo abaixo de
16 cm. Costura, fivela e aro de enfaixamento saem sozinhos — bom. Mas o
**mantelete** e o **saiote** passam do corte e entram no passe de sombra, que é
um segundo desenho da cena inteira. É a razão principal de o manto ter ficado
fora (§2.2): medir antes de acrescentar pano grande.

**6.6 Materiais são POR ARQUEIRO, nunca de módulo.** Já está escrito no código
([player.js:50](../src/entities/player.js#L50)) e a razão é dura: material
compartilhado faz tingir um de azul tingir a sala inteira, e o piscar de quem
renasceu piscar todo mundo junto. `createMaterials()` é função, e é chamada uma
vez por corpo.

**6.7 O ragdoll usa os mesmos handles.** `poseRagdoll`
([player.js:1502](../src/entities/player.js#L1502)) mexe em `head`, `legR/legL`,
braços e `sway`. Como os nomes são o contrato, ele não muda — **mas morrer de
medieval entra nos testes**, porque é o caminho que mais depende de todos os
handles existirem de verdade.

**6.8 A empena da flecha tem `side: DoubleSide`**
([player.js:206](../src/entities/player.js#L206)). Um plano de uma face só
desaparece de metade dos ângulos. Vale para qualquer pano chato que a skin nova
acrescente.

---

## 6-A. A bancada — `dev/skins.html`

Não estava no plano e virou a ferramenta central. Dois arqueiros lado a lado, o
mesmo Sol, a mesma pose, e a contagem de malhas embaixo. Ela importa o `Player`
**de verdade** — mesma IK, mesma pose, mesmo material — e troca só o mundo em
volta: o terreno vira um plano em `y = 0` e não há física.

Por que ela paga o que custou:

- **Compara.** Duas skins no mesmo ângulo, na mesma luz, no mesmo quadro. Sem
  isso, "ficou mais pesado?" é memória contra memória.
- **Não depende do jogo.** Enquanto uma fase em obras travava a página principal
  no arranque, o corpo continuou verificável.
- **Mede.** Malhas, sombras e materiais na tela, atualizados a cada troca.
- **Encena o que é raro.** Tombo (ragdoll), recarga, corrida e primeira pessoa
  num clique — os quatro estados em que uma peça mal pendurada aparece.

Duas armadilhas dela, as duas já corrigidas e as duas instrutivas: **sem o tone
mapping do jogo as cores mentem** (item 6 do cabeçalho), e **enquadrar o rosto
não é `yaw = π`** — o tronco gira `+stanceYaw` e a cabeça desfaz 86 % disso, de
modo que o rosto aponta 0,162 rad ADIANTE do corpo.

Há também `dev/lobby.html`, que monta a tela de entrada sozinha: olhar um seletor
de duas linhas não devia custar esculpir um vale.

---

## 7. Como saber que ficou pronto

Seis testes, todos com o jogo aberto — nenhum deles é "parece bom":

1. **Silhueta a 40 m.** Dois arqueiros lado a lado, câmera longe: dá para dizer
   qual é qual sem ler o nome? Se não der, o capuz e o mantelete estão pequenos.
2. **Primeira pessoa.** Nenhuma peça da cabeça aparece; a mão do arco tem luva;
   o bracer não atravessa a manga ao tensionar; a flecha sai rente à câmera como
   antes.
3. **Ciclo completo de tiro,** de lado, tensionando devagar: a corda ancora no
   canto da boca (a âncora é osso — se a barba a cobre, a barba está grande) e o
   braço do arco não entra no gambeson.
4. **Correndo, virando rápido:** o liripipe sobra e volta, sem atravessar o
   ombro nem esticar. É o teste do `swayTuning`.
5. **Morrer.** Ragdoll de medieval, três vezes, ângulos diferentes: nenhuma peça
   fica para trás no lugar antigo, nenhuma vira do avesso.
6. **A conta.** Malhas ≤ 66 (§2.7) e chamadas de desenho dentro de 5 % do
   atleta, com seis em campo.

---

## 8. O que este plano NÃO faz, de propósito

- **Nenhum movimento novo.** Nem animação própria, nem pose diferente, nem
  cadência de passo. É o pedido, e é também o que mantém o custo desta feature
  onde ele está.
- **Nenhuma diferença de jogo.** Mesma cápsula, mesma altura, mesma velocidade,
  mesma linha de tiro. Skin não pode ser escolha estratégica.
- **Nada de troca com o jogo em andamento.** A skin é escolhida na tela de
  entrada e vale para a sessão. Trocar de corpo no meio de um duelo mexe em
  `dispose` de malha com o laço de física rodando, e não paga.
- **Nada de terceira skin agora.** Mas depois da fase 2 uma skin nova é **um
  arquivo** em `skins/`, uma linha em `SKIN_IDS` e um botão. É esse o ponto de
  separar o rig da fantasia.

---

## 9. Ordem sugerida de commits

1. `Separa o arqueiro em rig e fantasia` — fase 1, sem mudança visual
2. `Abre o corpo para skins` — fase 2 (registro, `setSkin`)
3. `Veste o arqueiro medieval` — fase 3
4. `Deixa escolher o corpo na porta de entrada` — fase 4
5. `Manda a skin pela rede` — fase 5 (bate `PROTOCOL_VERSION`)
6. `Mistura os bots e fecha a conta` — fase 6
