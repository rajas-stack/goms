# One-off image for running scripts/seed-import.ts against goms-dev's private
# Cloud SQL instance via a Cloud Run Job (mirrors goms-migrate's Terraform
# shape in infra/dev/cloudrun.tf: same VPC network interfaces + Direct VPC
# egress, same goms-api-runtime service account, same DATABASE_URL secret --
# no new network path, no public Cloud SQL exposure).
#
# Kept separate from apps/api/Dockerfile deliberately: seed-import.ts needs
# the full frontend src/ tree (buildSeed/buildOwnershipFixture and their
# dependency chain) plus scripts/, which goms-api's own runtime image never
# needs and shouldn't carry on every deploy.
#
# Build (from repo root): docker build -f scripts/seed-import.Dockerfile -t
# asia-south1-docker.pkg.dev/goms-dev/goms/goms-seed-import:<tag> .
FROM node:20-slim AS build
WORKDIR /app
COPY . .
RUN npm ci

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/packages ./packages
ENV NODE_ENV=production
CMD ["npx", "tsx", "scripts/seed-import.ts"]
