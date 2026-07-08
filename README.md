# ORCA - Onsite Remote Construction Assistance (P2 Team 36)
ORCA is a secure, real-time communication platform designed to bridge the gap between on-site construction workers and verified remote technical experts. The platform enables rapid, secure decision-making on active job sites to mitigate safety incidents, structural risks, and project delays.

When a problem comes up on site, a Worker shouldn't have to wait for someone to physically travel out to look at it. ORCA lets them get an Expert's eyes on the issue immediately, whether that means a quick chat, a photo with annotations pointing at the crack in question, a voice note recorded on the move, or a live video call walking the expert through the site in real time.

## Why ORCA

Construction sites are time-sensitive and safety-critical environments. A delayed decision on something like a structural anomaly, an electrical fault, or a material defect can mean lost days, lost money, or worse. ORCA's goal is to compress the distance between "something looks wrong" and "a qualified expert has weighed in" down to minutes, without compromising on the security of the people, sites, and data involved.

## Core Features

- **Real-time messaging** — Workers and Experts exchange text messages instantly within a conversation, with delivery built for active, time-sensitive use.
- **Site photo & document upload** — Share site photos, documents, and diagrams directly within a conversation, validated server-side for file type and size.
- **Image annotation** — Mark up uploaded images directly in the chat (e.g. circling a crack or pointing at a fault). Annotations are saved as versioned, immutable overlays so a participant's markup can never be silently altered.
- **Voice messages** — Record and send asynchronous voice notes for hands-free, non-urgent communication — ideal for a Worker wearing gloves on an active site.
- **Live video calls** — Initiate peer-to-peer video calls directly from a conversation, with support for live annotation overlays during the call itself.
- **Expert directory** — Browse verified Experts by specialty, availability, and credential status before starting a conversation.
- **Graceful degradation** — If video or file services are disrupted, text messaging keeps working, so a conversation is never fully blocked.
- **Mobile-first, glove-friendly UI** — Built as a touch-first, installable Progressive Web App so it's usable on a phone in the field without a native app install.

## Trust & Safety

ORCA handles sensitive site data and credentials, so security isn't an afterthought:

- **Argon2id password hashing**, short-lived JWT access tokens, and rotating refresh tokens with a hard 2-hour session cap and a 15-minute inactivity timeout.
- **Soft and hard account lockouts** after repeated failed logins, independently tracked so one can't be used to bypass the other.
- **Role-based access control (RBAC)** enforced server-side on every route — Workers, Experts, and Admins each see and can do only what their role permits.
- **A separate Admin portal** with its own login path, dedicated rate limiting, and optional TOTP-based two-factor authentication.
- **Full audit trail** — every sensitive action (logins, password resets, file uploads, Expert verification decisions, account and chat log deletions) is recorded with user ID, action, timestamp, source IP, and affected resource, written to an append-only log store.
- **Admin session oversight** — admins can view and terminate any user's active sessions directly from the dashboard.
- Expert accounts require **explicit Admin approval** before they can access the platform beyond a pending-verification screen.

## Tech Stack

**Frontend** — React 19, React Router 7, and Vite, communicating with the backend over HTTP (Axios) and WebSockets (Socket.IO) for real-time messaging and call signalling.

**Backend** — Node.js with Express 5, MySQL (via `mysql2`) for persistent storage, and Socket.IO for real-time events. Authentication uses `argon2` for password hashing, `jsonwebtoken` for sessions, and `speakeasy` + `qrcode` for TOTP-based two-factor authentication. Email (password resets, verification) is sent via `nodemailer`.

**Observability** — Application and audit logs are written with `winston` and shipped to **Grafana Loki** via `winston-loki`, with **Grafana Alloy** collecting container logs. The admin dashboard's log viewer is built directly on top of this pipeline.

**Infrastructure** — The full stack runs via Docker Compose: an **Nginx** reverse proxy in front of the frontend and backend containers, a **MySQL** database, and the Loki/Alloy logging pipeline. A **SonarQube** + Postgres pairing is included for static analysis and code quality scanning in CI.

## Project Structure

```
ORCA/
├── backend/                 # Express API, Socket.IO server, auth & business logic
│   ├── adapters/            # Mail, password hashing, token signing, transcoder adapters
│   ├── constants/           # Password policy constants
│   ├── controllers/         # Route controllers (conversations, experts)
│   ├── data/                # Static data, e.g. NCSC common-password blocklist
│   ├── db/                  # Schema (init.sql), seed data, connection pool
│   ├── domain/              # Domain models & events (e.g. TokenFactory)
│   ├── middleware/          # Auth, RBAC, rate limiting, password checks
│   ├── repositories/        # Data access layer (conversations, sessions, users)
│   ├── routes/              # REST endpoints (auth, users, admin, experts, files, voip, etc.)
│   ├── services/            # Business logic (conversations, experts)
│   ├── sockets/             # Real-time chat / call signalling handlers
│   ├── tests/               # Jest unit & integration tests
│   ├── utils/               # Tokens, logging, mail, TOTP, crypto helpers
│   ├── app.js               # Express app assembly (also used by tests)
│   └── server.js            # Entry point
├── frontend/                # React + Vite single-page application
│   └── src/
│       ├── auth/            # Auth context, route guards, API client
│       ├── components/      # Shared UI (shells, layout)
│       ├── hooks/           # Shared React hooks
│       ├── pages/           # Routed pages, including /admin
│       ├── styles/          # Global/shared styles
│       ├── tests/           # Vitest unit tests
│       └── utils/           # Frontend helpers
├── e2e/                     # Playwright end-to-end tests (two-tier: full suite pre-merge, smoke post-deploy)
├── nginx/                   # Reverse proxy configuration (prod, dev, and e2e variants)
├── loki/ & alloy/           # Logging pipeline configuration
├── docker-compose.yml       # Local/dev orchestration
├── docker-compose.e2e.yml   # Disposable stack used by the E2E test suite
└── docker-compose.prod.yml  # Production orchestration
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 24+ (only needed if running the frontend/backend outside of Docker, or running the test suites)

### Setup

1. Clone the repository and copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Fill in `.env` with your own values. At minimum you'll need:

   | Variable | Purpose |
   |---|---|
   | `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | MySQL credentials and database name |
   | `DB_HOST`, `DB_PORT` | Backend's connection target for MySQL |
   | `JWT_SECRET` | Signing secret for access tokens |
   | `TOTP_ENC_KEY` | Encryption key for stored TOTP secrets |
   | `MESSAGE_ENC_KEY` | Encryption key for stored chat message content |
   | `CSRF_SECRET` | Secret used by the double-submit CSRF cookie scheme |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Outbound email for verification & password resets |
   | `APP_URL` | Base URL used in outbound email links |
   | `LOKI_URL` | Loki endpoint the backend logger ships to |
   | `METERED_USERNAME`, `METERED_CREDENTIAL` | TURN server credentials for peer-to-peer video calls |
   | `SONAR_DB_PASSWORD` | Postgres password for the SonarQube database |

3. Start the full stack:

   ```bash
   docker compose up --build
   ```

   This brings up Nginx, the frontend, the backend, MySQL (seeded from `backend/db/init.sql` and `backend/db/seed.sql`), Loki, Alloy, and SonarQube.

4. Visit the app at `http://localhost`. The Admin portal is available at `/adm/administratorLogin`, separate from the regular user login.

### Running services individually (without Docker)

```bash
# Backend
cd backend
npm install
npm start

# Frontend
cd frontend
npm install
npm run dev
```

## Testing

- **Backend** — Jest + Supertest unit and integration tests.

  ```bash
  cd backend
  npm test
  npm run test:coverage
  ```

- **Frontend** — Vitest + Testing Library unit tests.

  ```bash
  cd frontend
  npm test
  npm run test:coverage
  ```

- **End-to-end** — Playwright, run in two tiers: the full suite pre-merge against a disposable `docker-compose.e2e.yml` stack, and a smoke-only subset post-deploy against the live environment. See `e2e/README.md` for the full local setup (generating a throwaway `.env`, spinning up the stack, running `npm test` from `e2e/`).

## Linting

Both the frontend and backend are linted with ESLint, including security-focused plugins (`eslint-plugin-security`, `eslint-plugin-security-node`, `eslint-plugin-no-unsanitized`) and React-specific hook rules on the frontend.

```bash
cd backend && npm run lint
cd frontend && npm run lint
```