# Plano — Lobo assustador (visual + gameplay)

Documento de referência para o redesign do lobo. A regra central é a mesma
do `plano.md`: **realista o bastante para assustar, leve o bastante para não
travar o jogo**.

Backup da versão anterior: `src/entities/wolf.backup.js`.

---

## Referência visual

Lobo cinza-carvão visto de perfil, postura encolhida de predador:

| Elemento | Implementação |
|---|---|
| Pelagem escura | `#3a3f48` corpo, `#22252a` sombras, `#5c636d` destaque no dorso |
| Olhos laranja | `MeshBasicMaterial` `#ff8c28`, `fog: false` — visíveis no breu |
| Boca aberta (snarl) | Mandíbula articulada + interior vermelho + caninos |
| Juba peluda | Esferas mescladas no pescoço/ombros |
| Patas com dedos | Coxa → joelho → canela → pata (3 dedos + garras mesclados) |
| Cauda espessa | 4 segmentos articulados |

---

## Orçamento de performance

| Métrica | Meta |
|---|---|
| Meshes por lobo | ~22 (vs ~18 anterior, +4 pela juba/dentes/patas) |
| Geometrias compartilhadas | corpo, juba, olhos, pata — 1 build por sessão |
| Materiais de módulo | 8 compartilhados entre todos os lobos |
| Draw calls (10 lobos vivos) | ~220 — aceitável dentro do orçamento do modo zumbi |

### O que NÃO fazer (caro demais)

- Texturas PNG por lobo
- Esqueleto com 20+ bones individuais animados
- Pelos com partículas ou shader de fur
- Cada dente/garra como mesh separada sem merge
- Sombra extra por segmento de cauda

### O que já está implementado (Fase 1)

- [x] Paleta cinza-carvão com contraste interno
- [x] Olhos laranja BasicMaterial (anunciam ameaça no escuro)
- [x] Boca aberta permanente com mandíbula animada no ataque
- [x] Juba peluda mesclada
- [x] 4 pernas com coxa + joelho + pata articulada (dedos mesclados)
- [x] Cauda de 4 segmentos
- [x] Postura encolhida (`visualRoot.rotation.x = 0.14`)
- [x] Geometrias compartilhadas via `buildShared()`

---

## Fase 2 — Animação mais realista (custo baixo)

| Item | Custo | Impacto |
|---|---|---|
| IK simples nos pés (pata alinha ao chão em encosta) | ~15 linhas no `animate()` | Marcha mais crível |
| Orelhas reagem ao estado (alerta → para trás, walk → oscila) | 2 linhas por frame | Expressão |
| Respiração no tórax (`corpo.scale.y` sutil) | 1 linha | Vivo mesmo parado |
| Uivo sincronizado com pescoço erguido | evento + rotação neck | Feedback de ameaça |

---

## Fase 3 — LOD e culling (libera GPU)

| Item | Ganho estimado |
|---|---|
| Acima de 40 m: sumir juba, dentes inferiores, highlight | −3 meshes/lobo distante |
| Acima de 60 m: blob de corpo + olhos apenas | −15 meshes/lobo |
| `frustumCulled` nos segmentos de cauda | culling automático |

Com 10 lobos e 30 zumbis, LOD nos lobos distantes economiza ~100 draw calls.

---

## Fase 4 — Gameplay (spawn escalonado) ✅

Implementado em `server/zombieSim.js` e `server/elkWolves.js`:

| Parâmetro | Valor | Efeito |
|---|---|---|
| `spawnRadiusMin/Max` | 28–50 m | Alguns nascem perto, outros longe |
| `spawnStagger` | 0.85 s | Zumbis entram um a um, não todos juntos |
| `wolfSpawnRadiusBonus` | +6 m | Lobos nascem mais longe que zumbis |
| `wolfSpawnDelay/Stagger` | 1.0 / 1.4 s | Lobos entram espaçados após mortes |
| `wolfSpawnRadiusMin/Max` (alce) | 5–14 m | Pack do alce também espalhada |

**Resultado esperado:** em vez de 20 zumbis chegando ao centro em ~25 s
(todos a 36 m, mesma velocidade), a chegada se espalha em ~40–50 s com
ondas visuais de 3–5 bichos por vez.

---

## Fase 5 — Áudio e feedback (opcional)

- Uivo direcional 3D mais grave para lobos distantes
- Som de patas/leaves ao correr (só se lobo < 15 m)
- Rosnado curto ao iniciar salto (`state: leap`)

---

## Critérios de aceite

1. Silhueta reconhecível como lobo assustador a 30 m (olhos + postura)
2. Patas dobram no joelho durante a marcha (não vara reta)
3. FPS não cai > 5% com 10 lobos + 30 zumbis vs versão anterior
4. Hordas não chegam todas ao centro no mesmo segundo
5. Backup restaurável: `cp wolf.backup.js wolf.js`
