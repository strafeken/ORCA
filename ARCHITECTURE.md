# ORCA — Architecture & Design Patterns

This document describes the architectural and design patterns applied across the
ORCA backend, and maps each one to the files that implement it. It is the
reference the class diagram is drawn from: **every class named below is one
file**, and the "depends-on" arrows follow the layering described here.

The patterns were introduced as **behaviour-preserving refactors** — the backend
test suite (`backend/tests/`) passes at every step, so the structure changed
without changing behaviour.

---

## 1. Layered architecture (the spine)

The backend follows a **Controller → Service → Repository** layering, with
external systems isolated behind **Adapters**. Each layer has exactly one
responsibility, and dependencies point downward only.

```
HTTP request
    │
    ▼
┌─────────────┐   routes/*.js       thin wiring: middleware + handler binding
│   Route     │
└─────────────┘
    │
    ▼
┌─────────────┐   controllers/*.js  HTTP only: parse/validate input, map
│ Controller  │                      outcomes → status codes
└─────────────┘
    │
    ▼
┌─────────────┐   services/*.js     business rules; DB-free, unit-testable via
│  Service    │                      injected repositories
└─────────────┘
    │
    ▼
┌─────────────┐   repositories/*.js all SQL lives here, one table-family each
│ Repository  │
└─────────────┘
    │
    ▼
┌─────────────┐   adapters/*.js     wrap external libs (argon2, jwt, ffmpeg,
│  Adapter    │                      nodemailer) + db/pool.js
└─────────────┘
```

Every seam uses **constructor dependency injection** (a real collaborator by
default, a fake in tests), which is what makes the services and controllers
unit-testable with no database and no Express server (see
`tests/expertDirectory.test.js`, `tests/conversationService.test.js`).

### Layer → file map

| Layer | Files |
|-------|-------|
| **Controllers** | `controllers/ExpertController.js`, `controllers/ConversationController.js` |
| **Services** | `services/ExpertService.js`, `services/ConversationService.js`, `utils/authService.js` (orchestrator) |
| **Repositories** | `repositories/UserRepository.js`, `repositories/SessionRepository.js`, `repositories/ConversationRepository.js` |
| **Thin routes** | `routes/experts.js`, `routes/conversations.js` |

> The remaining fat routes (`admin.js`, `users.js`, `auth.js`, `authExtras.js`,
> `files.js`, `annotations.js`) still hold inline SQL. Their audit writes are
> already migrated to events (see §3); layering them is future work — the
> experts + conversations slices are the reference implementation.

---

## 2. Design patterns and where they live

| Pattern | Role in ORCA | Files |
|---------|--------------|-------|
| **Ports & Adapters** | Isolate external libraries so callers depend on a capability, not a vendor. | `adapters/PasswordHasher.js` (argon2), `adapters/TokenSigner.js` (jsonwebtoken), `adapters/MailAdapter.js` (nodemailer), `adapters/TranscoderAdapter.js` (ffmpeg) |
| **Repository** | Centralise data access; one class per table-family. | `repositories/UserRepository.js`, `repositories/SessionRepository.js`, `repositories/ConversationRepository.js` |
| **Service layer** | Business rules, independent of HTTP and SQL. | `services/*.js`, `utils/authService.js` |
| **Observer / Pub-Sub** | Decouple "something happened" from "what we do about it" — the cross-cutting audit thread. | `domain/events/EventBus.js`, `domain/events/AuditObserver.js`, `domain/events/DomainEvent.js`, `domain/events/index.js` |
| **Factory** | Create one-time tokens (verification/reset) by kind, hiding table + TTL + material. | `domain/TokenFactory.js` (used by `utils/oneTimeTokens.js`) |
| **Strategy** | Interchangeable behaviour selected at runtime. | `adapters/MailAdapter.js` — `SmtpMailAdapter` vs `ConsoleMailAdapter`, chosen by `createMailAdapter()` |
| **Facade** | A simple front over a subsystem. | Frontend `frontend/src/auth/api.js` (`apiFetch` over fetch + CSRF + token refresh); `sockets/webrtc.js` (signalling relay) |
| **Chain of Responsibility** | A request passes through ordered handlers, any of which can stop it. | Express middleware pipeline: `middleware/authMiddleware.js` → `requireRole` → CSRF (`app.js`) → `middleware/rateLimiter.js`; socket guard sequence in `sockets/guards.js` (`authorizeConversationEvent`: parse id → live session → participant) |
| **Singleton** | One shared instance. | `db/pool.js` (connection pool), the socket `io` instance (`app.set('io')`), `domain/events/index.js` (`eventBus`) |

---

## 3. The audit thread (Observer, cross-cutting)

Audit (SR-29/SR-30) is the clearest use of the Observer pattern and the one
thing that ties every lane together.

```
Service / route          EventBus                 AuditObserver          winston/loki
     │                      │                          │                      │
     │ publish(DomainEvent) │                          │                      │
     ├─────────────────────►│  notify subscribers      │                      │
     │                      ├─────────────────────────►│  audit.log(entry)    │
     │                      │                          ├─────────────────────►│
```

- Publishers: `utils/authService.js`, `routes/auth.js`, `routes/admin.js`,
  `routes/files.js`, `routes/annotations.js`, `routes/authExtras.js`,
  `routes/users.js` — each calls `eventBus.publish(new DomainEvent(type, payload))`.
- **`AuditObserver` is the only writer of the audit trail.** No lane calls
  `audit.log` directly.
- This is enforced by an ESLint rule (`no-restricted-syntax` in
  `backend/eslint.config.mjs`) that fails the build on any direct `audit.log(...)`
  call.
- Adding a new observer later (notifications, metrics) requires **zero changes
  to any publisher** — just register it on the bus in `domain/events/index.js`.

---

## 4. Frontend

The frontend is React (components/hooks), so it is lighter on class-diagram
structure, but the same ideas appear:

| Concept | File |
|---------|------|
| **Facade / Adapter** over `fetch` (base URL, auth header, CSRF, refresh-on-401) | `frontend/src/auth/api.js` (`apiFetch`) |
| **Provider / Observer** (components subscribe to auth state) | `frontend/src/auth/AuthContext.jsx` |
| **Route guards** | `frontend/src/auth/guards.jsx` (`RequireAuth`, `RequireRole`) |
| De-facto **State machine** (call lifecycle: idle → ringing → incoming → connecting → in-call) | `frontend/src/components/ConsultThread.jsx` |

---

## 5. Directory layout

```
backend/
  controllers/     HTTP handlers (thin)
  services/        business logic
  repositories/    all SQL
  adapters/        external systems (argon2, jwt, nodemailer, ffmpeg)
  domain/
    TokenFactory.js
    events/        EventBus, DomainEvent, AuditObserver, index (wiring)
  middleware/      Express middleware (Chain of Responsibility)
  sockets/         socket gateways + guards
  routes/          route wiring
  utils/           remaining helpers (some still fat; being migrated)
  db/pool.js       shared connection pool (Singleton)
```

---

## 6. Testing note

Coverage is collected across `controllers/`, `services/`, `repositories/`,
`adapters/`, `domain/`, `sockets/`, `routes/`, `middleware/`, `utils/`
(see `backend/package.json` → `jest.collectCoverageFrom`). The layered classes
are unit-tested with injected fakes (no DB), and the pre-existing
behaviour-level tests act as the safety net that proves each refactor preserved
behaviour.
