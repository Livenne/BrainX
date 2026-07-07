# brainx Server

S-side control plane prototype for brainx. This module currently implements an in-memory vertical slice for:

- workspace and agent creation
- agent run creation
- client daemon registration
- execution request polling and result submission
- branch capsule generation
- Markdown-only skill proposal creation

## Commands

```bash
mvn test
mvn spring-boot:run
```

The service listens on `http://localhost:8080` by default.

## Current Scope

This is intentionally not the final persistence architecture. The next server step is replacing `BrainxState` with Postgres/Flyway-backed repositories while keeping the REST behavior stable.
