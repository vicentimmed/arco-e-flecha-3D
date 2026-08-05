#!/bin/bash

# Cria um Cloudflare Quick Tunnel para o servidor local.
# A URL pública encontrada é copiada automaticamente para o clipboard do macOS.

set -u

ROOT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT_DIR" || exit 1

PORT="${PORT:-3000}"
LOCAL_URL="${LOCAL_URL:-http://127.0.0.1:${PORT}}"
LOG_FILE="$(mktemp -t arco-flecha-cloudflared.XXXXXX)"
TUNNEL_PID=""

cleanup() {
  if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
  rm -f "$LOG_FILE"
}

trap cleanup EXIT INT TERM

echo "========================================"
echo "        Arco & Flecha — túnel"
echo "========================================"
echo

if ! command -v curl >/dev/null 2>&1; then
  echo "O comando curl não foi encontrado no macOS."
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

echo "Aguardando o servidor em ${LOCAL_URL}..."
SERVER_READY=0
for _ in $(seq 1 30); do
  if curl --silent --fail --max-time 1 "${LOCAL_URL}/healthz" >/dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  sleep 1
done

if [ "$SERVER_READY" -ne 1 ]; then
  echo
  echo "O servidor não respondeu."
  echo "Abra primeiro «rodar servidor.command» e aguarde ele iniciar."
  echo
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

CLOUDFLARED_BIN=""
for candidate in \
  "$(command -v cloudflared 2>/dev/null || true)" \
  "/opt/homebrew/bin/cloudflared" \
  "/usr/local/bin/cloudflared"
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    CLOUDFLARED_BIN="$candidate"
    break
  fi
done

if [ -z "$CLOUDFLARED_BIN" ]; then
  echo
  echo "cloudflared não foi encontrado."
  echo "Instale-o pelo Homebrew com:"
  echo
  echo "  brew install cloudflared"
  echo
  echo "Depois execute este arquivo novamente."
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

echo "Criando o túnel Cloudflare..."
"$CLOUDFLARED_BIN" tunnel --no-autoupdate --url "$LOCAL_URL" >"$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

PUBLIC_URL=""
for _ in $(seq 1 30); do
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    break
  fi

  PUBLIC_URL="$(awk '
    match($0, /https:\/\/[A-Za-z0-9.-]+\.trycloudflare\.com/) {
      print substr($0, RSTART, RLENGTH)
      exit
    }
  ' "$LOG_FILE")"

  if [ -n "$PUBLIC_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$PUBLIC_URL" ]; then
  echo
  echo "Não foi possível encontrar a URL pública do túnel."
  echo "Saída do cloudflared:"
  awk '{ print "  " $0 }' "$LOG_FILE"
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

echo
echo "========================================"
echo "URL pública do jogo:"
echo "$PUBLIC_URL"
echo "========================================"

if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$PUBLIC_URL" | pbcopy
  echo
  echo "A URL já foi copiada. Agora é só colar e enviar."
else
  echo
  echo "Copie a URL acima manualmente."
fi

echo
echo "O túnel está ativo. Para encerrar, pressione Ctrl+C."
echo

wait "$TUNNEL_PID"
