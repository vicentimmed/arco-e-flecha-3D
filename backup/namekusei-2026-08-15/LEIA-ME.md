# Backup do cenário de Namekusei — 15/08/2026

Cópia dos arquivos do mundo de Namekusei **como estavam antes** da remodelagem
visual do terreno (detalhe triplanar anti-repetição).

Isto é um backup de conveniência, para olhar lado a lado sem precisar de `git`.
O backup de verdade é a **tag** no repositório:

```bash
git show namekusei-v1:src/namek/world/terrain.js
```

Para restaurar um arquivo específico:

```bash
git checkout namekusei-v1 -- src/namek/world/terrain.js
```

## O que está aqui

| arquivo | o que faz |
|---|---|
| `src/namek/world/terrain.js` | a malha polar do chão, com LOD por raio e cratera dinâmica |
| `src/namek/world/scenery.js` | rochas, ajisas e casas — instanciadas e destrutíveis |
| `src/namek/world/index.js` | monta o mundo e distribui o dial do clima |
| `src/namek/world/sky.js` | os três sóis, a névoa e a tempestade |
| `src/namek/world/water.js` | o mar |
| `src/shared/namek/config.js` | o `NAMEK` (mundo, destruição, clima) |
| `src/shared/namek/field.js` | o campo de altura puro, com a fila de crateras |

## O que a remodelagem mudou

Só `src/namek/world/terrain.js` — a **superfície**:

- material ganhou detalhe triplanar anti-repetição (`world/detail.js`, novo);
- `corDeSuperficie` ganhou uma terceira escala de ruído, descorrelacionada.

O que **não** mudou, de propósito: a malha polar, o perfil de LOD, a ausência
de colisor (a colisão deste modo é analítica contra `NamekField.heightAt`), a
fila de crateras sincronizada pela sala, as fissuras de magma e a paleta
turquesa do planeta.
