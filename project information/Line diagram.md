# Architecture and line diagrams

These Mermaid diagrams describe the current architecture and can be rendered by a Markdown viewer with Mermaid support. Optional components are labelled explicitly.

## Application layers

```mermaid
flowchart LR
    Browser[Web browser] --> UI[React and Vite frontend]
    Android[Android app: Capacitor WebView] --> UI
    UI --> Client[tRPC client and React Query]
    Client --> API[Fastify and tRPC API]
    UI --> Local[IndexedDB and browser drafts: local mode]
    UI -. shared rules and types .-> Domain[TypeScript domain package]
    API -. shared rules and types .-> Domain
    API --> Auth[Identity verification and RBAC]
    API --> DB[(PostgreSQL)]
    UI --> Google[Configured Google service APIs]
    API --> Storage[Google Cloud Storage]
    API --> AI[Jev AI: optional configuration]
    UI --> Docs[Installed Word / Excel / PowerPoint]
    Docs -- WebDAV open and save --> API
```

## Local Docker deployment

```mermaid
flowchart LR
    User[Browser: localhost 8088] --> Web[Nginx web container]
    Web --> API[API container: internal 8080]
    API --> DB[(PostgreSQL container)]
    Migration[One-shot migrations] --> DB
    Migration -. completes before API starts .-> API
    Seed[Optional reference-data seed] --> DB
    DB --> Volume[Persistent database volume]
    Secret[Mounted Docker secrets] --> API
    Secret --> DB
    User --> Office[Installed Office app]
    Office -- WebDAV /api/dav --> API
```

## Cloud deployment configuration

```mermaid
flowchart LR
    User[Browser] --> Hosting[Firebase Hosting]
    Hosting --> Static[Frontend static bundle]
    Hosting --> Run[Cloud Run API]
    Run --> SQL[(Cloud SQL PostgreSQL: private IP)]
    Run --> GCS[Cloud Storage attachments]
    Run --> Secrets[Secret Manager]
    Run --> Observe[Cloud Logging and Monitoring]
    CI[CI pipeline with Workload Identity Federation] --> Registry[Artifact Registry]
    Registry --> Run
    Terraform[Terraform configuration] -. provisions .-> Run
    Terraform -. provisions .-> SQL
```

## Typical authenticated request

```mermaid
sequenceDiagram
    participant User
    participant UI as React UI
    participant API as Fastify and tRPC
    participant Guard as Identity and RBAC
    participant DB as PostgreSQL
    User->>UI: Submit action
    UI->>API: Typed request with Bearer token
    API->>Guard: Validate identity, permissions and input
    alt Authorized
        Guard-->>API: Allow
        API->>DB: Parameterized SQL or transaction
        DB-->>API: Result
        API-->>UI: Typed response
        UI-->>User: Updated screen
    else Rejected
        Guard-->>API: Authentication or access error
        API-->>UI: Error response
        UI-->>User: Sign-in or permission message
    end
```

Cloud diagrams describe repository deployment configuration; they are not a statement that every resource has been deployed. Local mode and remote database mode are separate repository implementations.
