# Technology stack

| Layer | Technologies and purpose |
| --- | --- |
| Repository | TypeScript, JavaScript ES modules, npm Workspaces; frontend, API and shared domain package |
| Web frontend | React 18, React DOM, Vite 6, React Router 7 |
| UI and styling | Tailwind CSS 3, PostCSS, Autoprefixer, clsx, tailwind-merge, Lucide React, Framer Motion |
| Data and grids | TanStack React Query, React Table, React Virtual |
| Rich text | Tiptap and ProseMirror; Document maker files open in the installed Word, Excel or PowerPoint over WebDAV |
| Import/export and OCR | SheetJS/XLSX, application CSV utilities, Tesseract.js |
| Geographic features | D3 Geo, SVG, GeoJSON; Turf Simplify, polygon-clipping, Proj4, shapefile and archive tooling |
| Browser persistence | IndexedDB, localStorage, sessionStorage |
| Backend | Node.js 22 container runtime, Fastify 5, tRPC 11, Zod 3, Fastify CORS and rate-limit plugins |
| Database | PostgreSQL 16, node-postgres/pg, SQL transactions, node-pg-migrate |
| Shared domain | @goms/domain: TypeScript business types, rules and permission definitions |
| Authentication | Firebase Authentication, Firebase Admin SDK, Google OAuth/OpenID Connect, JOSE JWT implementation |
| Credential protection | Web Crypto, PBKDF2/SHA-256, AES-256-GCM; OAuth refresh-token hashing and rotation |
| External services | Google service integrations, Google Drive DMS, Google Cloud Storage SDK, Jev AI |
| Android | Capacitor 8, Android WebView, Java, Android SDK, Gradle; lifecycle, browser, filesystem, sharing and secure-storage plugins |
| Containers | Docker, Docker Compose, Node build images, unprivileged Nginx, PostgreSQL volumes and mounted secrets |
| Infrastructure | Terraform; Cloud Run, Cloud SQL, Cloud Storage, Artifact Registry, Secret Manager, IAM, VPC and Workload Identity Federation configuration |
| Hosting | Firebase Hosting configuration; GitLab Pages pipeline configuration also exists |
| Monitoring | Cloud Logging, Cloud Monitoring, uptime checks, alert policies; database backups and point-in-time recovery configuration |
| Tests | Vitest, React Testing Library, jest-dom, user-event, jsdom, Playwright and backend/database tests |
| CI and security tooling | GitHub Actions, GitLab CI/CD, CodeQL, Trivy, npm audit and custom credential-pattern checks |
| Developer tooling | Git, GitHub/GitLab, VS Code, Container Tools, Dev Containers, npm, tsx |
| Frontend compression | vite-plugin-compression2, gzip and Brotli |

Version numbers above identify major dependency declarations or container versions, not necessarily the exact installed release. Use `package-lock.json` for resolved npm versions. Some integrations and infrastructure are optional/configuration-dependent rather than universally enabled.

Sources: [frontend manifest](../package.json), [API manifest](../apps/api/package.json), [domain manifest](../packages/domain/package.json), [Docker guide](../DOCKER.md), [integration catalog](../src/features/integrations/catalog.ts).
