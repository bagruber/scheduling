# syntax=docker/dockerfile:1

##############################################
# Stage 1 – Frontend bauen
##############################################
FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable

# Erst die Manifeste -> besserer Layer-Cache
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

##############################################
# Stage 2 – Laufzeit
##############################################
FROM node:24-alpine
WORKDIR /app

# Der Server hat keine einzige Laufzeit-Dependency: er benutzt nur node:http,
# node:sqlite und node:crypto, und Node 24 strippt die Typen selbst. Deshalb
# wandert hier kein node_modules mit, nur der Build und die Quellen.
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
