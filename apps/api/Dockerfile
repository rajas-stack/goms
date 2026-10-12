FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm --workspace packages/domain run build && npm --workspace apps/api run build && npm prune --omit=dev --ignore-scripts

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/migrations ./migrations
COPY --from=build /app/node_modules ./node_modules
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
