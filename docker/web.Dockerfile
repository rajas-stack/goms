FROM node:26-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm --workspace packages/domain run build
# Only public frontend configuration belongs in build arguments.
ARG VITE_API_BASE_URL=http://localhost:8088
ARG VITE_AUTH_PROVIDER=firebase
ARG VITE_ADMIN_IMPORT_ENABLED=true
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_AUTH_PROVIDER=$VITE_AUTH_PROVIDER VITE_BID_TRACKER_ENABLED=true
ENV VITE_ADMIN_IMPORT_ENABLED=$VITE_ADMIN_IMPORT_ENABLED
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
RUN npm run build

# 1.28 is no longer rebuilt upstream (its Alpine packages carry unfixed HIGH/CRITICAL CVEs); 1.30 is the current stable line.
# apk upgrade picks up Alpine security fixes published after the base image was built.
FROM nginxinc/nginx-unprivileged:1.30-alpine
USER root
RUN apk upgrade --no-cache
USER 101
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
