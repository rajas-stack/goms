FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm --workspace apps/api run build && npm prune --omit=dev --ignore-scripts

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
ENV NODE_ENV=production
USER node
CMD ["node", "dist/server.js"]
