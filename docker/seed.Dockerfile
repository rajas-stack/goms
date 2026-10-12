FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm --workspace packages/domain run build
USER node
ENTRYPOINT ["node", "docker/api-entrypoint.mjs"]
CMD ["seed"]
