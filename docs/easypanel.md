# Deploy no EasyPanel (Linux)

O jogo é um único container Node: HTTP (arquivos estáticos) + WebSocket (`/ws`)
na **mesma porta**. No EasyPanel basta apontar o domínio para a porta **3000**;
o Traefik faz proxy de `Upgrade` (WSS) sozinho.

Repositório de referência: `vicentimmed/arco-e-flecha-3D` (branch `main`).

---

## 0. Pré-requisitos

| Item | Mínimo recomendado |
|---|---|
| VPS Linux | Ubuntu 22.04+ (servidor **novo**, sem outro painel) |
| RAM | **2 GB** (4 GB se o build e outros apps rodarem juntos) |
| Disco | 20 GB+ |
| Portas abertas | **80**, **443** (jogo) e **3000** (painel EasyPanel) |
| Acesso | root via SSH |
| Domínio (opcional) | registro A apontando para o IP do VPS |

Sem domínio próprio o EasyPanel gera um hostname automático — já dá para jogar.

---

## 1. Instalar o EasyPanel no VPS

Conecte por SSH como root e rode:

```bash
curl -sSL https://get.easypanel.io | sh
```

O script instala o Docker (se precisar), inicia o Docker Swarm e sobe o painel.

Quando terminar, abra no navegador:

```text
http://SEU_IP:3000
```

Crie o usuário administrador na primeira visita.

> Marketplace: vários provedores (Hetzner, DigitalOcean, Contabo, etc.) têm
> imagem one-click do EasyPanel — nesse caso pule este passo.

---

## 2. (Opcional) Conectar o GitHub

Se o repositório for **privado**, no EasyPanel:

1. **Settings** → integração **GitHub**
2. Autorize o EasyPanel na conta/organização que tem o repo
3. Confirme que o token aparece como conectado

Repositório **público** não precisa de token.

---

## 3. Criar o projeto e o serviço do jogo

1. No painel, **Create Project** (ex.: `jogos`)
2. **New Service** → **App**
3. Nome do serviço: `arco-flecha` (ou o que preferir)
4. Confirme a criação

---

## 4. Configurar a origem do código (Source)

Abra o serviço → aba **Source**:

### Opção A — GitHub (recomendada)

| Campo | Valor |
|---|---|
| Source | **GitHub** |
| Owner / Repo | `vicentimmed/arco-e-flecha-3D` |
| Branch | `main` |
| Build Path | `/` |

### Opção B — Git (URL pública)

| Campo | Valor |
|---|---|
| Source | **Git** |
| Repository URL | `https://github.com/vicentimmed/arco-e-flecha-3D.git` |
| Branch | `main` |
| Build Path | `/` |

### Opção C — Upload

Empacote o projeto (sem `node_modules` nem `dist`) em ZIP e envie em **Upload**.

Salve.

---

## 5. Configurar o build (Build)

Ainda no serviço → aba **Build**:

| Campo | Valor |
|---|---|
| Builder | **Dockerfile** |
| Dockerfile path | `Dockerfile` |

Não use Nixpacks/Buildpacks neste projeto: o `Dockerfile` multi-stage já gera
a imagem enxuta (~60 MB) com só a dependência `ws`.

Salve.

---

## 6. Domínio e porta (Domains)

Aba **Domains**:

1. Use o domínio automático do serviço **ou** adicione o seu
   (ex.: `arco.seudominio.com`)
2. Configure:

| Campo | Valor |
|---|---|
| Path | `/` |
| Port / Target Port | **3000** |
| HTTPS / SSL | **ligado** (Let's Encrypt) |

3. Marque o domínio como **Primary** se houver mais de um
4. Salve

O cliente WebSocket usa `wss://mesmo-host/ws` automaticamente quando a página
abre em HTTPS — não há variável extra para configurar.

DNS: se for domínio próprio, crie um registro **A** apontando para o IP do VPS
antes de esperar o certificado.

---

## 7. Ambiente (Environment) — opcional

Aba **Environment**. O padrão já funciona sem nada. Se quiser deixar explícito:

```dotenv
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
```

Salve.

---

## 8. Recursos e réplicas (importante)

Aba **Resources** (sugerido):

- Memory limit: **512 MB** (runtime é leve; o pico é no *build*)
- CPU: conforme o VPS

Aba **Advanced** → **Deploy**:

| Campo | Valor | Motivo |
|---|---|---|
| Replicas | **1** | A sala multiplayer vive na memória do processo |
| Zero Downtime | **desligado** (preferível) | Duas réplicas = duas salas distintas |

Salve.

---

## 9. Deploy

1. Volte ao **Overview** do serviço
2. Clique em **Deploy**
3. Acompanhe o log do build (primeira vez: `npm ci` + `vite build`, ~1–3 min)
4. Quando o status ficar **Running**, abra o domínio (botão **Open**)

Verificação rápida:

```text
https://SEU_DOMINIO/healthz
```

Deve responder `ok`.

---

## 10. Jogar

1. Abra o domínio no navegador (Chrome/Firefox/Edge atualizados)
2. Digite um nome no lobby e entre na sala
3. Abra a **mesma URL em outra aba** (ou outro dispositivo) com outro nome —
   os dois jogadores aparecem no mesmo mundo
4. Clique na tela para capturar o mouse e jogar

Controles principais: mirar com o mouse, segurar o botão esquerdo para
tensionar, soltar para disparar; **W A S D** para andar.

---

## Atualizar o jogo depois

1. Faça push na branch configurada (`main`)
2. No serviço: **Enable Auto Deploy** (webhook do GitHub) **ou** clique em **Deploy** de novo
3. Se o build parecer “preso” em cache antigo: **Force Rebuild**

---

## Problemas comuns

| Sintoma | O que checar |
|---|---|
| Build falha em `npm ci` | RAM insuficiente no VPS; use ≥ 2 GB ou adicione swap |
| Site abre, mas não conecta à sala | Target Port ≠ 3000; ou HTTPS sem certificado válido (WSS bloqueado) |
| `/healthz` não responde | Container não subiu — veja **Logs** no Overview |
| “sala cheia” | Limite de jogadores no servidor; aguarde alguém sair |
| Dois jogadores não se veem | Réplicas > 1 (cada réplica é uma sala); deixe **1** |
| Certificado SSL pendente | DNS A ainda não propagou; aguarde e redeploy o domínio |

---

## Arquitetura (por que um só serviço)

```text
Navegador ──HTTPS──► Traefik (EasyPanel) ──► container :3000
                         │                      ├── GET /        → dist/
                         └── Upgrade /ws ──────► └── WebSocket   → sala
```

Não há banco de dados, Redis nem segundo container. Estado da partida =
memória do processo Node. Por isso: **uma réplica**.
