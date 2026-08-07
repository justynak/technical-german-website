# Architecture — WerkDeutsch

This document describes the system **as it exists in the code today**. It does not describe
the planned mistake-classification / auto-generation pipeline — that is a future phase and is
called out explicitly at the end so the two don't get conflated.

## 1. What this is

A single-page, client-only web app that teaches workplace German (shop-floor / maintenance
vocabulary) to a Polish-speaking learner. There is no backend, no account system, and no
network calls of any kind at runtime.

## 2. Runtime shape

```
index.html
  ├─ styles.css
  ├─ lessons.js    (content: window.LESSONS)
  ├─ taxonomy.js    (window.WD.taxonomy)
  ├─ schedule.js    (window.WD.schedule)
  ├─ state.js       (window.WD.state)
  └─ app.js         (view layer, runs last)
```

Script load order in `index.html` is the dependency order — each later file assumes the
`window.WD.*` namespace built by the ones before it already exists. There is no bundler, no
transpiler, no `package.json`; the five `.js` files are shipped byte-for-byte as authored.

Everything hangs off one global namespace, `window.WD`, populated by IIFEs so nothing besides
the intended API leaks into global scope. `window.LESSONS` is the one exception — plain content
data, not a module.

## 3. Module responsibilities

| File | Responsibility | Depends on |
|---|---|---|
| `lessons.js` | Static lesson content (the only file edited to add scenarios) | nothing |
| `taxonomy.js` | Closed, versioned dictionary of German-error categories | nothing |
| `schedule.js` | Pure spaced-repetition function (Leitner boxes): `(entry, grade, now) -> entry` | nothing |
| `state.js` | Persistence, schema migration, merge algebra, export/import, content validation | `taxonomy.js`, `schedule.js`, `lessons.js` (validation only) |
| `app.js` | DOM rendering and event handling | all of the above |

Each module is deliberately narrow:
- `schedule.js` never touches the DOM or storage — it's a pure function so the spaced-repetition
  algorithm can be swapped (Leitner → SM-2/FSRS) without touching anything else. `due` and
  `interval` are the contract.
- `taxonomy.js` never counts anything from a live LLM response without validating it against a
  closed id list first — categories the model invents outside the list are rejected and logged
  separately (`rejected`), not silently absorbed into stats.
- `app.js` holds **no state of its own** — it reads from `WD.state` and writes back through it.
  Every reference to a lesson is by `id`, never by array index (indices are only used locally,
  for "prev/next" navigation and numbering).

## 4. Data model (`state.js`)

Persisted as one JSON blob in `localStorage["werkdeutsch-state"]`, schema-versioned
(`SCHEMA_VERSION = 4`):

```
{
  schemaVersion, current, currentAt, updatedAt,
  lessons: { [lessonId]: { completed, completedAt } },
  vocab:   { [vocabId]:  { de, pl, example, custom, learned, learnedAt, addedAt, deleted, updatedAt } },
  review:  { "lesson:<id>": { due, interval, reps, lapses, lastGrade, lastReviewAt, updatedAt } },
  attemptLog: [ { id, lessonId, contentVersion, mode, at, text, shownRegister,
                  choiceIndex, correctIndex, isCorrect, tagging } ]
}
```

Design invariants worth knowing before touching this file:

- **Identity, not position.** Lessons and vocab are keyed by stable string ids, never by array
  index, so `lessons.js` can be reordered or extended freely without corrupting saved progress.
- **Attempts are append-only and immutable.** `attemptLog` never overwrites — every answer
  (written or multiple-choice) becomes a new record. This is what makes error analysis possible
  at all; the previous schema (v3) overwrote one answer per lesson and destroyed history, which
  is exactly why v4 exists.
- **Every attempt already carries a `tagging` sub-object** (`status: pending|done|failed|skipped`,
  `tags[]`, `rejected[]`, `taggerVersion`, `taxonomyVersion`, `tries`, `error`), even though
  nothing in the current code ever sets `status` to `"done"`. This field exists so that a future
  classification step is a pure *addition* to existing records, not another schema migration.
- **Data is monotonic.** Every mutable value carries its own timestamp; deletions are tombstones
  (`deleted: true`), never removed outright. This is what makes `merge(a, b)` well-defined.
- **Merge is a CRDT-style join**: commutative, idempotent, and associative (all three are
  enforced by tests). This is the entire mechanism behind cross-device sync today — "sync" is
  literally "export a JSON file on device A, import it on device B," and `importJSON` calls the
  same `merge()` that any future automated sync would use.
- **Forward-compatibility guard.** If localStorage holds a `schemaVersion` newer than the running
  code (e.g., a stale service-worker/CDN cache), the app goes read-only rather than silently
  stripping fields it doesn't understand and overwriting good data with a lossy save.

## 5. Content validation

`state.validateLessons()` runs once at startup against `window.LESSONS`. If it finds a problem
(missing required field, duplicate id, `correct` index out of range, a `targetWeaknesses` tag not
in `taxonomy.js`, two vocab entries with the same id but different meanings, etc.), `app.js`
replaces the entire page with an error listing every problem and **refuses to render the app**.
This is deliberate — with a handful of hand-written lessons a content bug is obvious; the
validator exists for when there are fifty, some machine-generated.

The schema already anticipates generated content: `kind` (`scenario` | `sentences`), `origin`
(`static` | `generated`), `status` (`published` | `draft`), and `contentVersion` are all defined
now, defaulted for hand-written lessons via `applyLessonDefaults`, and enforced for anything with
`origin: "generated"` (which must declare `targetWeaknesses`).

## 6. Spaced repetition (`schedule.js`)

Simple Leitner boxes with fixed intervals `[1, 3, 7, 21, 60]` days. Grading:
- `again` → back to step 0, `lapses` incremented, shown again same day.
- `hard` → repeat the current interval, no advance, no reset.
- `good` → advance one step (caps at 60 days).

Review entries are keyed `"<type>:<id>"` (currently only `"lesson:<id>"` is used) — the format
already supports scheduling other item types (e.g. `"word:<id>"`) with no schema change.

## 7. Error taxonomy (`taxonomy.js`)

A closed, versioned list of German-error category ids (word order, verb forms, cases,
vocabulary/register, other), each with a group (for aggregation) and a Polish label (for
display). Two things make this durable for future automated tagging:

- **Closed vocabulary**: `accept(tags)` splits any input into `known` vs `rejected`. An
  unversioned, free-text label set from an LLM would drift release to release and silently break
  historical comparisons; this doesn't allow that.
- **Versioned**: `TAXONOMY_VERSION` is stamped onto every tagging result. Changing the category
  list or prompt bumps the version, so a before/after comparison can detect that the *measuring
  stick* changed, not just the learner's error rate.

`summarize()` performs counting deterministically, in code — never delegated to the model that
produced the tags.

## 8. Export / import (manual bridge to analysis)

Two user-triggered exports exist today, both client-side, no network:

- **Progress backup** (`export-progress` button) — the full state blob, for moving progress
  between devices via `importJSON` → `merge()`.
- **Attempts for analysis** (`export-attempts` button) — a rolling N-day window (default 7) of
  attempts, each enriched with the resolved lesson context (situation, all three answer
  registers, `targetWeaknesses`) so the file is self-sufficient for whoever/whatever tags it,
  without needing to also ship `lessons.js`. This is explicitly the seam a future
  classification/generation pipeline will consume — the file can already be fed to a manual or
  offline script today, before any backend exists.

## 9. Security posture

The app makes **zero network requests at runtime**. This is enforced, not incidental — a strict
Content-Security-Policy is set both as a `<meta>` tag in `index.html` and via `customHttp.yml`
(consumed by Amplify Hosting as custom response headers):

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
connect-src 'none'; font-src 'self'; object-src 'none'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests
```

`connect-src 'none'` in particular means the page cannot `fetch`/`XHR`/`WebSocket` to anywhere,
including its own origin. All learner data lives in `localStorage` on the one device that wrote
it, unless manually exported. `customHttp.yml` additionally sets HSTS, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, a locked-down `Permissions-Policy`, and same-origin
`Cross-Origin-*` policies.

## 10. Testing and CI

`tests.js` is a dependency-free test file (~70 cases) runnable with plain `node tests.js` — no
test framework, no `npm install`. It covers: content validation, schema migration (v1 → v4),
merge algebra (commutativity, idempotence, associativity, tombstone semantics), spaced-repetition
scheduling, taxonomy accept/summarize behavior, and cross-checks that every hand-written lesson's
`targetWeaknesses` references a real taxonomy id.

`.github/workflows/tests.yml` runs `node tests.js` on every push and pull request to `main`.
`amplify.yml` runs the same command as an Amplify build-phase gate, so a broken build never
deploys.

## 11. Deployment

Static hosting on AWS Amplify. There is no build step — `amplify.yml`'s `build` phase only runs
the test suite as a gate; `artifacts.baseDirectory` is the repo root, and every file is shipped
as-is. `customHttp.yml` is Amplify's mechanism for attaching the security headers described in
§9 at the CDN layer, not just via the in-page `<meta>` tag.

## 12. Backend: attempt ingestion (`amplify/`)

The first piece of server-side infrastructure, added to give the future analysis pipeline
somewhere to read from. Defined as plain CDK inside Amplify Gen 2's backend-as-code
(`amplify/backend.ts`), deployed through the same git-push-to-Amplify flow as the frontend — no
Amplify "categories" (Cognito auth, AppSync/GraphQL data) are used, deliberately, so the frontend
never needs the `aws-amplify` client library or a build step. It stays a plain static site that
happens to call one more endpoint with `fetch()`.

- **`AttemptsTable`** (DynamoDB, on-demand billing) — single-table design. Partition key `pk` is
  the constant `"ATTEMPT"`; sort key `sk` is `"<at>#<id>"`. This makes "everything since
  timestamp X" a `Query`, not a `Scan` — the access pattern the future daily analysis job needs.
  `RemovalPolicy.RETAIN`: the table survives a stack teardown by default, since it holds a real
  person's practice history.
- **`RecordAttemptFunction`** (Lambda, `amplify/functions/record-attempt/index.js`) — the only
  write path into the table. Deliberately plain CommonJS with no dependencies beyond
  `@aws-sdk/client-dynamodb`, which ships pre-bundled in the Lambda Node.js runtime — no
  bundler, no `node_modules` shipped as part of the function code. The item shape mirrors
  `attemptLog` records from `state.js` field-for-field, so there is no translation layer between
  what the browser writes locally and what lands in the database.
- **Exposed via a Lambda Function URL**, not API Gateway. At this traffic volume (one user, tens
  of requests a day) API Gateway adds cost and CDK complexity with no benefit — a Function URL is
  free indefinitely and is a plain HTTPS endpoint.
- **Auth is a static shared secret**, checked inside the function (`x-attempt-secret` header
  against `INGEST_SHARED_SECRET`), not IAM-signed requests — the client is a static site with no
  request-signing capability. The threat model this defends against is anonymous internet
  scanners writing garbage into the table, not a targeted attacker; see §9's reasoning about the
  page password for the same logic applied to the API.
- **Writes are idempotent**: the put uses `ConditionExpression: attribute_not_exists(sk)`, so a
  retried POST (flaky connection, not unlikely on real-world wifi) never produces a duplicate
  record — it silently no-ops on the second attempt, keyed off the same `id` the client already
  generates.

Two things this deliberately does **not** do yet:
- The frontend does not call this endpoint. The Function URL's hostname is only known after the
  first deploy, and CORS `allowedOrigins` is wide open (`*`) until the real Amplify hosting
  origin is known — both need a follow-up commit once those values exist.
- `connect-src 'none'` in the CSP (§9) has not been relaxed. The page still cannot make network
  requests. Wiring the frontend will require adding exactly one allowed origin (the Function URL
  domain) to both `customHttp.yml` and the `<meta>` CSP tag — nothing broader.

## 13. What is explicitly NOT built yet

- Automated mistake classification — the `tagging` field on each attempt exists and is *read*
  (`pendingTagging`, `setTagging` in `state.js`), but nothing currently calls an LLM; `status`
  never leaves `"pending"` in practice today.
- The daily batch analysis/generation job (EventBridge schedule + Lambda reading from
  `AttemptsTable`).
- Scheduled or on-demand lesson generation (`origin: "generated"` and `status: "draft"` are
  defined and validated in `state.js`, but no code produces such a lesson).
- Authentication / access control on the page itself (the "husband is the only user" password
  gate discussed separately — not yet implemented).
- Wiring the frontend to `RecordAttemptFunction` and the corresponding CSP relaxation (see §12).

These are being designed and built incrementally; this document is updated as they land.
