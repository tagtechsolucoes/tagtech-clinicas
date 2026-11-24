# Uma imagem por serviço, todas a partir do mesmo monorepo.
#   docker compose -f deploy/compose.yaml build
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /app

# Dependências de todo o workspace (o lockfile garante as mesmas versões do CI).
FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

# API (NestJS). Roda o TypeScript direto com tsx, igual ao desenvolvimento.
FROM deps AS api
ENV NODE_ENV=production PORT=3000 MEDIA_DIR=/data/media
EXPOSE 3000
CMD ["pnpm", "--filter", "@tagtech/api", "start"]

# Migrações: roda uma vez a cada deploy, com o usuário dono do banco, e termina.
FROM deps AS migrate
ENV NODE_ENV=production
CMD ["pnpm", "db:migrate"]

# Cardápio do cliente (Next.js).
FROM deps AS web-cliente
ENV NODE_ENV=production API_URL=http://api:3000 NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @tagtech/web-cliente build
EXPOSE 3001
CMD ["pnpm", "--filter", "@tagtech/web-cliente", "start"]

# App da equipe (Vite): só arquivos estáticos, servidos pelo Caddy.
FROM deps AS web-equipe-build
# Endereço do site de agendamento (vai nos links do painel e da mensagem ao paciente).
ARG SITE_HOST
RUN test -n "$SITE_HOST" || (echo "SITE_HOST não definido" && exit 1)
RUN VITE_SITE_URL=https://$SITE_HOST pnpm --filter @tagtech/web-equipe build

FROM caddy:2.10-alpine AS caddy
COPY --from=web-equipe-build /app/apps/web-equipe/dist /srv/equipe
COPY deploy/Caddyfile /etc/caddy/Caddyfile
# Falha o build se o Caddyfile tiver erro (com endereços de exemplo só para validar).
RUN SITE_HOST=agendar.exemplo.com EQUIPE_HOST=app.exemplo.com ACME_EMAIL=ti@exemplo.com \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
