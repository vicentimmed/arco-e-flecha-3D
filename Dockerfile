# Dois estágios: um compila o jogo, o outro só o serve.
#
# Three.js e Rapier existem apenas no estágio de build — o Vite os embute no
# bundle, e carregá-los de novo no runtime seria peso morto. A imagem final tem
# UMA dependência (`ws`) e fica em ~60 MB, o que faz o deploy no EasyPanel ser
# quase instantâneo.

FROM node:24-alpine AS build
WORKDIR /app
# package*.json antes do código: enquanto as dependências não mudarem, o Docker
# reaproveita a camada de `npm ci` e o build sai em segundos.
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# O jogo compilado e os únicos módulos-fonte que o servidor importa: a
# configuração e a matemática do terreno, que ele precisa para escolher onde
# alguém nasce e para os porcos andarem no relevo certo.
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/config.js ./src/config.js
COPY --from=build /app/src/shared ./src/shared
COPY --from=build /app/src/utils ./src/utils
COPY server ./server

# Não roda como root. Node oficial já traz o usuário `node`.
USER node

EXPOSE 3000
# `node` direto, sem npm no meio: o SIGTERM do EasyPanel chega ao processo que
# precisa fechar as conexões, em vez de morrer num wrapper.
CMD ["node", "server/index.js"]
