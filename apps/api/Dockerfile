FROM node:20-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm --workspace apps/api run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
