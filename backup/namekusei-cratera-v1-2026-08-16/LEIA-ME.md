# Backup do cenário de Namekusei — 16/08/2026

Cópia dos arquivos do terreno de Namekusei **como estavam antes** da mudança no
crescimento das crateras (saturação lateral + escavação em profundidade).

Isto é um backup de conveniência, para olhar lado a lado sem precisar de `git`.
O backup de verdade é a **tag** no repositório:

```bash
git show namekusei-cratera-v1:src/shared/namek/field.js
```

Para restaurar um arquivo específico:

```bash
git checkout namekusei-cratera-v1 -- src/shared/namek/field.js
```

Para voltar tudo de uma vez:

```bash
git checkout namekusei-cratera-v1 -- src/shared/namek/field.js src/shared/namek/config.js src/namek/world/terrain.js
```

## O que está aqui

| arquivo | o que faz |
|---|---|
| `src/shared/namek/field.js` | o campo de altura puro, com o mapa de deslocamento e a fusão de crateras |
| `src/shared/namek/config.js` | o `NAMEK` (mundo, destruição, lava) |
| `src/namek/world/terrain.js` | a malha polar do chão, que re-esculpe o disco da cratera |

## Como era o comportamento nesta versão

Em `NamekField.addCrater`, quando um golpe cai dentro de uma cratera existente
(`craterParaFundir`), a cratera é aprofundada e alargada assim:

```js
alvo.fundura = Math.min(FUNDURA_MAX, alvo.funduraBase + fundura * 0.8);
alvo.raio    = Math.min(NAMEK.destruction.craterMax, Math.hypot(alvo.raioBase, raio * 0.5));
```

- a largura cresce por **soma de áreas** (hipotenusa), sem saturação própria —
  o único freio é o teto duro `craterMax` (52 m);
- a profundidade é **linear** nos golpes, travada em `FUNDURA_MAX` (70 m) e no
  piso do mapa de deslocamento `DESL_MIN` (−80 m);
- a fusão só acontece se o golpe novo cair a menos de **metade** do raio da
  cratera existente (`d > c.raio * 0.5` descarta), então bater perto da borda
  abre uma cratera vizinha em vez de aprofundar — é o que fazia o buraco se
  alargar indefinidamente em tiroteio concentrado.
