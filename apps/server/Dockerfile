# Self hosted TabLodge sync server. Build from the repository root:
#   docker build -f apps/server/Dockerfile -t tablodge-sync .
# See docs/self-hosting.md.

FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/site/package.json apps/site/
# Only the build tools and the server's dependencies; install scripts fetch browser and workerd binaries the
# bundle does not need.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter tablodge --filter tablodge-sync-server
COPY tsconfig tsconfig
COPY apps/extension/src/shared apps/extension/src/shared
COPY apps/server apps/server
RUN pnpm --filter tablodge-sync-server build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /repo/apps/server/dist/node.js ./
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s \
	CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# A sync server for one library needs little memory; capping the heap keeps it predictable on a small VPS.
CMD ["node", "--max-old-space-size=128", "node.js"]
