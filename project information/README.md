# GOMS project information

This folder is the project's documentation hub. Keep one topic per file so each document can be shared, edited or formatted independently.

| File | Contents |
| --- | --- |
| [API.md](API.md) | API namespaces, procedures, HTTP routes and authentication |
| [Database schema.md](<Database schema.md>) | Tables, migration sources and principal relationships |
| [Database migrations.sql](<Database migrations.sql>) | Ordered forward migration SQL from the current source |
| [Line diagram.md](<Line diagram.md>) | Application architecture, deployment and request-flow diagrams |
| [Tech stack.md](<Tech stack.md>) | Technologies grouped by application layer |
| [Setup and deployment.md](<Setup and deployment.md>) | Local development, Docker and hosting references |
| [Security and integrations.md](<Security and integrations.md>) | Authentication, permissions, secrets and external services |
| [Static details](<Static details/README.md>) | Supplied business information, employee lists by team and other fixed references |

These documents describe the current working folder, including local changes. They are not proof that every feature is deployed or that every migration has been applied to a live database. Source code and migration files remain authoritative.

To refresh the generated API and database references after changing code, run from the repository root:

```sh
node "project information/update-reference.mjs"
```

The generator only reads application source and migrations and writes documentation in this folder. It does not contact a database, change application code or copy environment variables/secrets. Update the architecture and technology documents manually when their corresponding layers change. Additional documents such as release notes, business flows, deployment diagrams and integration specifications can be added here.
