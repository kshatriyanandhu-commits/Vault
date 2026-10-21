# Argus Vault

A 3D interactive credential vault with per-user encrypted credential storage and
a separate administrator session-audit console.

- **Sealed-vault screen** — an animated, procedurally generated 3D steel vault
  door (combination dial, iris, lock bolts, indicator lights) that reacts to
  typing, successful sign-in, rejected sign-in, and locking. Falls back to a
  CSS-rendered vault when WebGL is unavailable.
- **Personal vault** — add, view, edit, search, filter, copy, and delete
  credentials. Everything is encrypted in the browser with AES-256-GCM before
  upload; the server only ever stores ciphertext.
- **Administrator audit console** — session telemetry (active / signed-out /
  revoked), aggregate statistics, search + status filters, live refresh, and
  session revocation. Administrators can never see credential plaintext,
  ciphertext payloads, or vault keys.
- **Local activity history** — a device-local log of unlock/lock/copy/create/
  edit/delete actions (labels and field names only, never secrets).

---

## Prerequisites

- **Node.js ≥ 20** (developed on Node 26)
- **PostgreSQL ≥ 14** running locally or remotely (developed on PostgreSQL 18)
- npm (the project uses npm; lockfile included)

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
#    → edit DATABASE_URL, SESSION_PEPPER, ADMIN_* (see below)

# 3. Create the schema + provision admin + optional demo data
npm run db:setup          # = db:push + db:seed:admin + db:seed:demo

# 4. Run the dev server (port 8080)
npm run dev
#    → open http://localhost:8080
```

Production build:

```bash
npm run build
npm start                 # also serves on port 8080
```

### Creating the database

Any PostgreSQL works. Two common options:

```bash
# a) Existing server
createdb argus_vault

# b) Throwaway local cluster (what this repo was developed with)
initdb -D .pgdata -U postgres -A scram-sha-256
pg_ctl -D .pgdata -o "-p 5433 -c listen_addresses=127.0.0.1" start
createdb -h 127.0.0.1 -p 5433 -U postgres argus_vault
```

---

## Environment variables

All configuration is via environment variables (see [.env.example](.env.example)):

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL connection string for the app + drizzle-kit |
| `SESSION_PEPPER` | ✅ (prod) | Mixed into the SHA-256 hash of client IPs before storage; raw IPs are never persisted |
| `ADMIN_EMAIL` | for `db:seed:admin` | Administrator login email |
| `ADMIN_NAME` | optional | Administrator display name |
| `ADMIN_PASSWORD` | for `db:seed:admin` | Administrator master password (min 10 chars) |
| `DEMO_EMAIL` / `DEMO_NAME` / `DEMO_PASSWORD` | optional | Demo account + encrypted sample credentials |
| `VAULT_KDF_ITERATIONS` | optional | PBKDF2 iterations for new accounts (default 600000) |

**Admin accounts cannot be created through the UI.** Public sign-up always
creates `role = "user"`; the sign-up schema rejects unknown fields (including
`role`). Admins are provisioned only by `npm run db:seed:admin`.

---

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Next.js dev server on **http://localhost:8080** |
| `npm run build` | Production build |
| `npm start` | Serve the production build on port 8080 |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (validation, crypto, authorization) |
| `npm run db:generate` | Generate SQL migrations from schema changes |
| `npm run db:push` | Push the schema straight to the database (dev workflow) |
| `npm run db:migrate` | Apply generated migrations from `./drizzle` |
| `npm run db:seed:admin` | Provision/promote the admin account from env |
| `npm run db:seed:demo` | Create the demo account + 5 encrypted sample credentials |
| `npm run db:setup` | `db:push` → `db:seed:admin` → `db:seed:demo` |

Schema workflow: for local development `npm run db:push` is the fastest path.
For stricter environments, `npm run db:generate` writes versioned SQL into
`drizzle/` and `npm run db:migrate` applies it.

Demo sign-in after seeding: `demo@argus.local` / the `DEMO_PASSWORD` you set.
Admin sign-in: `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the console tab appears in
the header for admin accounts.

---

## Security model (honest description)

### What the server sees

- **Master password** — sent over the connection at sign-up and sign-in so the
  server can verify it against a stored **scrypt verifier**
  (`scrypt`, N=2^15, r=8, p=1 via the audited [`@noble/hashes`](https://github.com/paulmillr/noble-hashes)
  implementation; self-describing format `scrypt$N$r$p$salt$hash`, constant-time
  comparison). This is **not** a PAKE or zero-knowledge authentication scheme;
  the password crosses the wire (serve the app behind TLS in production).
- **Ciphertext only** for credentials: AES-256-GCM payloads plus fresh 12-byte
  nonces. No plaintext, no keys, no metadata beyond timestamps.

### What only your browser sees

- The **vault key**: AES-256 derived with PBKDF2-HMAC-SHA-256 (600k iterations,
  OWASP guidance) from your master password and a per-user salt. It lives in
  tab memory only — never in the database, server sessions, or
  localStorage/sessionStorage. Locking the vault, signing out, or closing the
  tab drops it.
- **Credential plaintext**: decrypted with AES-256-GCM after download. Each
  blob's AAD binds it to `userId:credentialId`, so ciphertext cannot be moved
  between rows or accounts. A non-secret "key check" blob lets the client
  verify a derived key without transmitting anything.
- A short-lived **key-check** flow also lets a restored session (httpOnly
  cookie) re-unlock locally by re-entering only the master password.

### Sessions

- Opaque 256-bit token in an **httpOnly, SameSite=Lax** cookie (Secure on
  HTTPS; works on plain http://localhost for development).
- Only the token's SHA-256 hash is stored; sessions carry status
  (`active` / `signed_out` / `revoked`), timestamps, expiry, and metadata.
- "Remember this device" stores an opaque random device id + email in
  localStorage (never a password or key) and extends the session to 30 days
  (default 12 hours). The device id is a display hint, never an authenticator.
- Every protected route re-validates the session; credential queries are
  scoped by `user_id` in the SQL itself. Revoked/expired sessions fail the
  lookup immediately.

### Audit console privacy

- Admin queries touch only `sessions`, `users`, and `audit_events`
  (`audit_events` contains event types, masked emails, hashed IPs, user agents).
  The credentials table contributes a `COUNT(*)` to the statistics page and
  nothing else. Responses never include ciphertext or key material.
- IPs are stored as `SHA-256(ip + SESSION_PEPPER)` truncated; client-reported
  fingerprints and device labels are marked as untrusted display hints and are
  never used for authorization.

### Hardening details

- Mutating routes require JSON content type + same-origin check (defense in
  depth on top of SameSite cookies).
- Rate limiting on sign-up/sign-in (in-memory fixed window; swap for
  Redis/Postgres per-instance-safe limiting in multi-node production).
- Generic 401s on credential failures + dummy verification for unknown users
  to reduce enumeration signal.
- All input validated with bounded zod schemas (length caps, enums, UUID
  checks); strict schemas reject unknown keys.
- Error responses never include stack traces, SQL, or secrets; audit logging
  itself never records passwords, keys, tokens, or ciphertext.
- UI details: visible focus states, labelled inputs, `role="alert"` errors,
  keyboard-dismissable dialogs, `prefers-reduced-motion` support, and a
  fully DOM-based control surface (the 3D canvas is decorative).

### Known limitations (stated plainly)

- The rate limiter and its store are per-process (fine for a single dev
  instance, not for horizontal scaling).
- Copy-to-clipboard does not auto-clear the clipboard.
- Losing your master password means losing your vault — by design. There is no
  server-side recovery.
- Serve behind HTTPS in production: the master password is sent to the server
  for verification at sign-in.

---

## Project layout

```
src/
  app/                    # App Router pages + API routes
    page.tsx              #   sealed-vault screen (auth + 3D scene)
    vault/page.tsx        #   personal vault
    console/page.tsx      #   admin audit console (role-guarded)
    api/auth/*            #   signup, signin, me, signout
    api/credentials/*     #   ownership-scoped CRUD
    api/admin/*           #   sessions ledger, stats, audit feed, revoke
  components/             # UI: auth panel, vault view, console, providers
    vault-scene/          # Three.js engine + React wrapper + CSS fallback
  lib/                    # client crypto, validation, activity, api client
  server/                 # drizzle client/schema, sessions, scrypt, http, audit
scripts/                  # seed-admin, seed-demo
tests/                    # vitest: validation, crypto, password, authorization
```

## Development notes

- The 3D scene is fully procedural (no external assets): brushed-steel canvas
  textures, PBR materials, IBL environment, and a phase state machine
  (`sealed / typing / unlocking / open / error / locked`).
- Seed scripts reuse the browser crypto code via Node's WebCrypto, so demo
  credentials are encrypted exactly like real user data.
