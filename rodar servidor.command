#!/bin/bash

# Inicia o servidor local do Arco & Flecha com um duplo clique no macOS.
# O servidor de produção serve o jogo e o WebSocket na porta 3000.

set -u

ROOT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT_DIR" || exit 1

echo "========================================"
echo "       Arco & Flecha — servidor"
echo "========================================"
echo

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js e npm não foram encontrados."
  echo "Instale o Node.js 20 ou superior e tente novamente:"
  echo "https://nodejs.org/"
  echo
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Dependências não encontradas. Instalando..."
  if ! npm install; then
    echo
    echo "Não foi possível instalar as dependências."
    read -r -p "Pressione Enter para fechar..."
    exit 1
  fi
  echo
fi

echo "Gerando a versão atual do jogo..."
if ! npm run build; then
  echo
  echo "O build falhou. O servidor não foi iniciado."
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

echo
echo "Servidor disponível em:"
echo "  http://127.0.0.1:3000"
echo
echo "Para disponibilizar o jogo na internet, execute também"
echo "o arquivo «rodar túnel.command»."
echo
echo "Para parar o servidor, pressione Ctrl+C."
echo

HOST=0.0.0.0 PORT=3000 npm start

STATUS=$?
echo
echo "O servidor foi encerrado (código $STATUS)."
read -r -p "Pressione Enter para fechar..."
exit "$STATUS"
