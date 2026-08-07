# WerkDeutsch

A single-page web app for learning workplace German (industrial / maintenance vocabulary),
built for one learner, with the UI in Polish. See [ARCHITECTURE.md](./ARCHITECTURE.md) for how
the system is put together.

## What it does

- Practice scenarios (`lessons.js`): a workplace situation in Polish, an answer typed freely or
  chosen from multiple choice, then a model answer in three registers (simple / natural /
  professional) with grammar and phrase notes.
- A personal vocabulary notebook, filterable and searchable.
- Spaced repetition of completed scenarios (Leitner boxes: 1 / 3 / 7 / 21 / 60-day intervals).
- Local-only progress: everything is saved in the browser's `localStorage`. Nothing is sent
  anywhere — see the Content-Security-Policy in `index.html` / `customHttp.yml`.
- Manual backup/restore and an "export attempts for analysis" bundle (rolling N-day window of
  answers, keyed for future error-pattern analysis).

## Running it locally

No build step, no dependencies. Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`. Opening `index.html` directly via `file://` also works in
most browsers, though some may restrict `localStorage` under the `file:` origin — a local server
is the more reliable option.

## Running the tests

```bash
node tests.js
```

Plain Node, no framework, no `npm install` required. Run this after any change to `lessons.js`
(content validation) or `state.js` (data layer). CI runs the same command on every push/PR to
`main` (`.github/workflows/tests.yml`), and it also gates the Amplify build (`amplify.yml`).

## Project structure

| File | Purpose |
|---|---|
| `index.html` | Page shell and markup |
| `styles.css` | Styling |
| `lessons.js` | Lesson content — the only file to edit to add a scenario |
| `taxonomy.js` | Closed, versioned dictionary of German-error categories |
| `schedule.js` | Spaced-repetition scheduling algorithm (pure function) |
| `state.js` | Persistence, migration, merge, validation, export/import |
| `app.js` | Rendering and event handling |
| `tests.js` | Dependency-free test suite (`node tests.js`) |
| `amplify.yml` | Amplify build spec (backend deploy + test gate + static artifact deploy) |
| `customHttp.yml` | Amplify custom response headers (CSP, HSTS, etc.) |
| `amplify/backend.ts` | Backend infra as CDK: DynamoDB `AttemptsTable` + ingest Lambda |
| `amplify/functions/record-attempt/` | Lambda handler that writes an attempt to DynamoDB |
| `package.json` / `package-lock.json` / `tsconfig.json` | Backend-only, for `amplify/`. The frontend above stays dependency-free. |

## Adding a lesson

Edit `lessons.js` only. Each entry needs: `id` (permanent — never change after publishing, or
saved progress for it is lost), `icon`, `category`, `short`, `title`, `situation`, `answers`
(`simple` / `natural` / `professional`), `grammar`, `phrase`, `choices` + `correct` index,
`vocab` (each word needs a permanent, global `id` — reuse an existing id if the same word appears
in another lesson), and `targetWeaknesses` (must be ids from `taxonomy.js`). Run `node tests.js`
before committing — the app also self-validates at startup and will refuse to render if the
content is malformed.

## Deployment

Hosted on AWS Amplify. `amplify.yml` has two phases: `backend` deploys `amplify/` (DynamoDB +
Lambda) via CDK, `frontend` runs the test gate and ships the static files as-is —
`customHttp.yml` attaches the security headers. Connect the GitHub repo in the Amplify console
(Host web app → GitHub).

### One-time backend setup

The app was originally connected as hosting-only, so enabling the backend needs two manual steps
the first time (neither is needed again after):

1. **IAM role for backend deploys.** In the Amplify console: App settings → IAM roles → attach or
   create a role with the `AmplifyBackendDeployFullAccess` managed policy. Without this, the
   `backend` phase in `amplify.yml` will fail — Amplify's build process has no permission to
   create the DynamoDB table / Lambda via CloudFormation otherwise.
2. **Shared secret for the ingest endpoint.** In the Amplify console: App settings →
   Environment variables → add `INGEST_SHARED_SECRET` with a random value (e.g.
   `openssl rand -hex 32`). `amplify/backend.ts` reads this at build time and sets it as the
   Lambda's environment variable — it is never committed to the repo.

After both are set, push to `main` and check the Amplify build log for the `backend` phase. On
success it prints the `RecordAttemptFunctionUrl` output — save that URL; it's needed to wire the
frontend (not done yet, see `ARCHITECTURE.md` §12).

### Local backend development

```bash
npm install
npx ampx sandbox   # deploys a personal, temporary copy of amplify/ to your own AWS account
```

Requires AWS credentials configured locally (`aws configure` or equivalent) — not needed for the
Amplify-hosted deploy above, only for iterating on `amplify/backend.ts` locally before pushing.
