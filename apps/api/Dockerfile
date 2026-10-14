FROM node:22-slim AS build
WORKDIR /app
COPY . .
# apps/api/node_modules holds the API's own versions of packages that conflict with root ones (e.g. @google-cloud/storage);
# the mkdir keeps the runtime COPY below valid even if a future lock file hoists everything.
RUN npm ci --ignore-scripts && npm --workspace packages/domain run build && npm --workspace apps/api run build && npm prune --omit=dev --ignore-scripts \
  && mkdir -p apps/api/node_modules

# Runtime: Alpine has far fewer OS packages than Debian slim (no perl, util-linux, ncurses), and the API only needs
# `node` — the dependencies are pure JavaScript, so node_modules built on Debian run unchanged. npm, npx, corepack and
# yarn are removed because nothing runs them at runtime and their bundled dependencies carry their own CVEs.
FROM node:22-alpine
RUN apk upgrade --no-cache \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
# Keep the npm workspace layout so Node resolves apps/api/node_modules before the hoisted root node_modules.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
# node_modules/@goms/domain is a workspace symlink to ../../packages/domain —
# the symlink itself is copied above, but its target must exist too, and
# plain `node` (no ts-node/tsx here) needs the compiled dist/, not raw .ts.
COPY --from=build /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/docker/api-entrypoint.mjs ./docker/api-entrypoint.mjs
COPY --from=build /app/docker/api-healthcheck.mjs ./docker/api-healthcheck.mjs
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=5 CMD ["node", "docker/api-healthcheck.mjs"]
USER node
ENTRYPOINT ["node", "docker/api-entrypoint.mjs"]
CMD ["serve"]
