# Backup do modo Namekusei — 16/08/2026

**O terreno como SUPERFÍCIE**, antes de ele virar volume (ver
`docs/plano-grutas.md`).

Esta é a cópia completa do modo — `src/namek/`, `src/shared/namek/` e
`server/namek/` — como estava no último commit em que o chão era, e só era, um
campo de altura `y = heightAt(x, z)`: sem grutas, sem teto, sem túnel.

## Como voltar atrás

O backup de verdade são a **tag** e o **branch**:

```bash
git checkout main
```

`main` fica parada nesta versão; o trabalho novo acontece em
`terreno-volumetrico`. Para voltar depois de um merge, a tag continua valendo:

```bash
git checkout namekusei-superficie-v1 -- src/namek src/shared/namek server/namek
```

Para comparar sem mexer em nada:

```bash
git diff namekusei-superficie-v1 -- src/namek
```

E, se preferir sem `git`, os arquivos estão aqui do lado, na árvore original.

## O que estava valendo nesta versão

- **O chão é uma superfície.** `NamekField.heightAt(x, z)` devolve um único `y`
  por coluna. Teto é impossível por definição — está registrado em
  `config.js:533` e em `powers/beam.js:353`.
- **A destruição é altura.** Um mapa de deslocamento de 481² células (`desl`)
  guarda quantos metros o chão baixou; `bakeCrater` assa a cratera nele uma vez.
- **O Kamehameha atravessa a montanha, mas deixa VALA** — corredor a céu aberto,
  com paredes dos dois lados e céu em cima (`atravessar`, em `powers/beam.js`).
- **A colisão é analítica** contra `heightAt`, sem Rapier (§4 do
  `plano-namekusei.md`).
- Crescimento lateral da cratera por soma de áreas, travado só no teto duro
  `craterMax` (52 m) — a queixa que abriu a conversa. Ver o backup anterior,
  `backup/namekusei-cratera-v1-2026-08-16/`, que documenta a fórmula.

## O que a implementação nova muda

`docs/plano-grutas.md`, §1: o volume passa a ser a verdade e o campo de altura
vira o termo base dele.

```
solido(x,y,z) ⇔ y ≤ heightAt(x,z)  E  (x,y,z) ∉ nenhuma gruta
```

Onde não há gruta, a resposta é idêntica à desta versão — é o que permite voltar
atrás sem drama, e é o que permite as duas conviverem enquanto a migração
acontece.
