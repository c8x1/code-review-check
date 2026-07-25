# code-review-check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For complex OpenHarmony PRs the gitcode-review daemon already reviews, generate a self-check quiz, host it on the `code-review-check` static site, link it from the GitCode review report, record the dev's one-shot first attempt, and surface score + missed non-obvious behaviors to the committer.

**Architecture:** JSON quiz-data + one shared SPA engine (GitHub Pages) + Cloudflare Worker with D1 (one-shot result store keyed by repo/pr/head_sha). The daemon mints a token, injects the quiz URL into the existing `claude -p` review, pushes the generated quiz JSON to the site repo, and registers it with the Worker. The dev takes the quiz once; the committer views results on a dashboard.

**Tech Stack:** Cloudflare Workers (TypeScript) + D1 (SQLite); `vitest` + `@cloudflare/vitest-pool-workers` for Worker tests; vanilla JS SPA (hash routing, no framework); `pytest` for daemon; the existing `gitcode-review` skill (`claude -p`).

## Global Constraints

- All review/quiz text is **Chinese** for the OpenHarmony audience; reviewer signature stays "Noc". Code identifiers stay English.
- One-shot semantics: `results` PK is `(repo, pr, head_sha)`; a second submit for the same version returns HTTP 410.
- Submitter gating: `POST /api/submit` requires a valid `token` **and** `gitcode_username == quizzes.author`. No OAuth.
- Quiz data is public (GitHub Pages); the Worker stores only quiz registry + results. CORS `*` on `/api/*`; `/admin/*` requires `Authorization: Bearer <COMMITTER_TOKEN>`.
- Token is 32-byte URL-safe, minted **locally by the daemon**, carried in the URL **fragment** (`#...?t=<token>`), never sent to the Worker in a referrer.
- Contract self-check (§4 of spec): `non_obvious_behaviors ≥ 1` with real `where` file:line; `inherited_dependency` exactly 1; ≥ half questions `type:"scenario"`; `hard_gate_question_ids ≥ 1` each citing a real `tests_behavior_id`; every question has `excerpt` + `section_anchor` + `reinforce`; no pure-recall.
- Commit hygiene: each task ends with a commit; push via `http.proxy=http://127.0.0.1:7897` when github.com is unreachable (local Clash proxy, per project CLAUDE.md).
- The site repo is `c8x1/code-review-check`, Pages already live at `https://c8x1.github.io/code-review-check/`. Local working copy: `/Users/noctis/Workspace/code-review-check`.

---

## File Structure

**Worker (new, in `code-review-check/worker/`):**
- `worker/src/index.ts` — Worker entry; routing + handlers for `/admin/quiz`, `/api/submit`, `/api/quiz`, `/admin/results`.
- `worker/src/db.ts` — typed D1 helpers (queries only; no business logic).
- `worker/schema.sql` — `quizzes` + `results` D1 schema.
- `worker/wrangler.toml` — bindings (`DB` D1, `COMMITTER_TOKEN` secret).
- `worker/package.json`, `worker/tsconfig.json`, `worker/vitest.config.ts`.
- `worker/test/index.test.ts` — vitest-pool-workers tests against a local D1.

**SPA (in `code-review-check/`, served by Pages):**
- `index.html` — SPA shell, loads `app/main.js`.
- `app/main.js` — hash router → report-view / dashboard.
- `app/api.js` — Worker HTTP client (`getQuizByToken`, `submit`, `getResults`).
- `app/report.js` — render the report body + non-obvious behavior cards.
- `app/quiz-engine.js` — interaction (lock-on-click, wrong-answer feedback, live score, two terminal states) + pure `gradeQuiz`.
- `app/dashboard.js` — committer result cards.
- `app/styles.css` — the warm palette from `knowUnknowns/framework.md` (ivory/clay/olive).
- `app/grade.test.js` — vitest unit tests for the pure grading function.
- `data/sample/16401-abc1234.json` — sample quiz JSON for dev/CI without a live Worker.

**Daemon + skill (in `~/.claude/skills/gitcode-review/`):**
- `scripts/review_daemon.py` — modify: `is_complex_pr()`, `mint_token()`, quiz-URL prompt injection, post-review `publish_quiz()`.
- `scripts/config.yaml` — add `quiz:` block.
- `scripts/tests/test_complexity_gate.py` — new.
- `scripts/tests/test_publish_quiz.py` — new (mocks git + Worker).
- `SKILL.md` — add `Step 2.5: generate self-check quiz (complex PRs)`.

---

## Task 1: Worker scaffold + D1 schema + register/lookup endpoints

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/wrangler.toml`, `worker/vitest.config.ts`
- Create: `worker/schema.sql`
- Create: `worker/src/index.ts`, `worker/src/db.ts`
- Create: `worker/test/index.test.ts`

**Interfaces:**
- Produces: `POST /admin/quiz` → `{token, quiz_url}` (idempotent by repo/pr/head_sha); `GET /api/quiz?t=<token>` → `{quiz_data_url, has_result, head_sha}`.

- [ ] **Step 1: Create `worker/package.json`**

```json
{
  "name": "code-review-check-worker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.4.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "wrangler": "^3.60.0"
  }
}
```

- [ ] **Step 2: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["@cloudflare/vitest-pool-workers"],
    "lib": ["ES2022"],
    "jsx": "react-jsx"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `worker/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS quizzes(
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  author TEXT NOT NULL,
  quiz_data_url TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(repo, pr, head_sha)
);

CREATE TABLE IF NOT EXISTS results(
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  gitcode_username TEXT NOT NULL,
  score REAL NOT NULL,
  answered INTEGER NOT NULL,
  total INTEGER NOT NULL,
  missed_behavior_ids TEXT NOT NULL,   -- JSON array
  missed_question_ids TEXT NOT NULL,   -- JSON array
  submitted_at TEXT NOT NULL,
  PRIMARY KEY(repo, pr, head_sha)
);
```

- [ ] **Step 4: Create `worker/wrangler.toml`**

```toml
name = "code-review-check"
main = "src/index.ts"
compatibility_date = "2025-05-01"

[[d1_databases]]
binding = "DB"
database_name = "code-review-check"
database_id = "REPLACE_WITH_D1_ID"
```

> The `COMMITTER_TOKEN` secret is set via `wrangler secret put COMMITTER_TOKEN` (manual, once, in Task 9).

- [ ] **Step 5: Create `worker/vitest.config.ts`**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
        },
      },
    },
  },
});
```

- [ ] **Step 6: Create `worker/src/db.ts`**

```ts
export interface QuizRow {
  repo: string; pr: number; head_sha: string; author: string;
  quiz_data_url: string; token: string; created_at: string;
}
export interface ResultRow {
  repo: string; pr: number; head_sha: string; gitcode_username: string;
  score: number; answered: number; total: number;
  missed_behavior_ids: string; missed_question_ids: string; submitted_at: string;
}

export async function getQuizByToken(db: D1Database, token: string): Promise<QuizRow | null> {
  return db.prepare("SELECT * FROM quizzes WHERE token = ?1").bind(token).first<QuizRow>();
}
export async function getResult(db: D1Database, repo: string, pr: number, head_sha: string): Promise<ResultRow | null> {
  return db.prepare("SELECT * FROM results WHERE repo=?1 AND pr=?2 AND head_sha=?3")
    .bind(repo, pr, head_sha).first<ResultRow>();
}
export async function insertQuiz(db: D1Database, q: QuizRow): Promise<void> {
  await db.prepare(
    "INSERT INTO quizzes(repo,pr,head_sha,author,quiz_data_url,token,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)"
  ).bind(q.repo, q.pr, q.head_sha, q.author, q.quiz_data_url, q.token, q.created_at).run();
}
export async function insertResult(db: D1Database, r: ResultRow): Promise<D1Result> {
  return db.prepare(
    "INSERT INTO results(repo,pr,head_sha,gitcode_username,score,answered,total,missed_behavior_ids,missed_question_ids,submitted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"
  ).bind(r.repo, r.pr, r.head_sha, r.gitcode_username, r.score, r.answered, r.total, r.missed_behavior_ids, r.missed_question_ids, r.submitted_at).run();
}
export async function listAll(db: D1Database): Promise<{quiz: QuizRow; result: ResultRow | null}[]> {
  const rows = await db.prepare(
    "SELECT quizzes.*, results.gitcode_username, results.score, results.answered, results.total, results.missed_behavior_ids, results.missed_question_ids, results.submitted_at " +
    "FROM quizzes LEFT JOIN results ON quizzes.repo=results.repo AND quizzes.pr=results.pr AND quizzes.head_sha=results.head_sha " +
    "ORDER BY quizzes.created_at DESC"
  ).all<any>();
  return (rows.results ?? []).map(r => ({
    quiz: { repo: r.repo, pr: r.pr, head_sha: r.head_sha, author: r.author, quiz_data_url: r.quiz_data_url, token: r.token, created_at: r.created_at },
    result: r.gitcode_username == null ? null : {
      repo: r.repo, pr: r.pr, head_sha: r.head_sha, gitcode_username: r.gitcode_username,
      score: r.score, answered: r.answered, total: r.total,
      missed_behavior_ids: r.missed_behavior_ids, missed_question_ids: r.missed_question_ids, submitted_at: r.submitted_at,
    },
  }));
}
```

- [ ] **Step 7: Create `worker/src/index.ts` (register + lookup only; submit/results in Task 2)**

```ts
import { getQuizByToken, getResult, insertQuiz, type QuizRow } from "./db";

export interface Env { DB: D1Database; COMMITTER_TOKEN: string; }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    try {
      if (url.pathname === "/api/quiz" && req.method === "GET") return await getQuiz(req, url, env);
      if (url.pathname === "/admin/quiz" && req.method === "POST") {
        const g = guard(req, env); if (g) return g;
        return await register(req, env);
      }
      return Response.json({ error: "not found" }, { status: 404, headers: CORS });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500, headers: CORS });
    }
  },
};

function guard(req: Request, env: Env): Response | null {
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${env.COMMITTER_TOKEN}`)
    return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  return null;
}

async function getQuiz(req: Request, url: URL, env: Env): Promise<Response> {
  const token = url.searchParams.get("t");
  if (!token) return Response.json({ error: "missing token" }, { status: 400, headers: CORS });
  const q = await getQuizByToken(env.DB, token);
  if (!q) return Response.json({ error: "unknown token" }, { status: 404, headers: CORS });
  const r = await getResult(env.DB, q.repo, q.pr, q.head_sha);
  return Response.json({ quiz_data_url: q.quiz_data_url, has_result: r !== null, head_sha: q.head_sha }, { headers: CORS });
}

async function register(req: Request, env: Env): Promise<Response> {
  const body = await req.json() as { repo: string; pr: number; head_sha: string; author: string; token: string; quiz_data_url: string };
  const existing = await getQuizByToken(env.DB, body.token);
  if (existing) return Response.json({ token: existing.token, quiz_data_url: existing.quiz_data_url }, { headers: CORS });
  // idempotent by (repo,pr,head_sha): if same sha registered under a different token, keep the old token
  const row: QuizRow = {
    repo: body.repo, pr: body.pr, head_sha: body.head_sha, author: body.author,
    quiz_data_url: body.quiz_data_url, token: body.token,
    created_at: new Date().toISOString(),
  };
  try { await insertQuiz(env.DB, row); }
  catch (e) { // UNIQUE(token) collision: fetch the winner
    const winner = await getQuizByToken(env.DB, body.token);
    if (winner) return Response.json({ token: winner.token, quiz_data_url: winner.quiz_data_url }, { headers: CORS });
    throw e;
  }
  return Response.json({ token: row.token, quiz_data_url: row.quiz_data_url }, { status: 201, headers: CORS });
}
```

> Note: `Env.COMMITTER_TOKEN` is undefined in tests unless injected; Task 9 sets the real secret. Tests inject a test value via the harness `env`.

- [ ] **Step 8: Create `worker/test/index.test.ts` (register + lookup)**

```ts
import { env_test, resetD1 } from "./helpers";
import { describe, it, expect, beforeEach } from "vitest";

describe("register + lookup", () => {
  beforeEach(async () => { await resetD1(); });
  it("registers a quiz and looks it up by token", async () => {
    const res = await env_test.fetch("https://x/admin/quiz", {
      method: "POST",
      headers: { Authorization: "Bearer test-committer", "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "o/r", pr: 1, head_sha: "aaa", author: "alice", token: "tok1", quiz_data_url: "https://pages/data/1-aaa.json" }),
    });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.token).toBe("tok1");

    const g = await env_test.fetch("https://x/api/quiz?t=tok1");
    expect(g.status).toBe(200);
    const gj = await g.json();
    expect(gj.quiz_data_url).toBe("https://pages/data/1-aaa.json");
    expect(gj.has_result).toBe(false);
    expect(gj.head_sha).toBe("aaa");
  });
  it("rejects /admin without committer token", async () => {
    const res = await env_test.fetch("https://x/admin/quiz", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
  it("re-registering the same token returns the existing record", async () => {
    await env_test.fetch("https://x/admin/quiz", { method: "POST", headers: { Authorization: "Bearer test-committer", "Content-Type": "application/json" }, body: JSON.stringify({ repo: "o/r", pr: 1, head_sha: "aaa", author: "alice", token: "tok1", quiz_data_url: "u1" }) });
    const res = await env_test.fetch("https://x/admin/quiz", { method: "POST", headers: { Authorization: "Bearer test-committer", "Content-Type": "application/json" }, body: JSON.stringify({ repo: "o/r", pr: 1, head_sha: "aaa", author: "alice", token: "tok1", quiz_data_url: "u1" }) });
    expect(res.status).toBe(200); // existing, not 201
  });
  it("returns 404 for unknown token", async () => {
    const res = await env_test.fetch("https://x/api/quiz?t=nope");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 9: Create `worker/test/helpers.ts`**

```ts
import { createExecutionContext, env } from "cloudflare:test";
import { execSql } from "./migrate";
export { env };

let ctx = createExecutionContext();
export const env_test = {
  fetch: (url: string | URL, init?: RequestInit) =>
    env.WORKER.fetch(url instanceof URL ? url : new URL(url), init ?? {}, ctx),
};
export async function resetD1() {
  await env.DB.exec("DELETE FROM results;");
  await env.DB.exec("DELETE FROM quizzes;");
}
```

> `cloudflare:test` is provided by `@cloudflare/vitest-pool-workers`. The schema is applied automatically from `schema.sql` via the `migrations` dir configured in `wrangler.toml` (add `migrations_dir = "migrations"` and move `schema.sql` to `migrations/0001_init.sql`; wrangler applies it to the test D1). If the harness does not auto-migrate, run `env.DB.exec(schema_sql)` in `beforeAll`.

- [ ] **Step 10: Run tests; verify they pass**

Run (from `worker/`): `npx vitest run`
Expected: 4 tests pass.

- [ ] **Step 11: Commit**

```bash
cd /Users/noctis/Workspace/code-review-check
git add worker/
git -c user.name="c8x1" -c user.email="c8x1@users.noreply.github.com" commit -m "feat(worker): scaffold + D1 schema + register/lookup endpoints"
```

---

## Task 2: Worker submit + results endpoints (one-shot lock)

**Files:**
- Modify: `worker/src/index.ts` (add `/api/submit` + `/admin/results` handlers)
- Modify: `worker/test/index.test.ts` (add submit + results tests)

**Interfaces:**
- Produces: `POST /api/submit` → `{score, total, terminal, missed_behaviors}`; second submit for same version → 410; username mismatch → 403. `GET /admin/results` → array of `{quiz, result|null}`.

- [ ] **Step 1: Write failing test for submit (one-shot + author check)**

Append to `worker/test/index.test.ts`:

```ts
describe("submit + results", () => {
  beforeEach(async () => { await resetD1();
    await env_test.fetch("https://x/admin/quiz", { method: "POST", headers: { Authorization: "Bearer test-committer", "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "o/r", pr: 1, head_sha: "aaa", author: "alice", token: "tok1", quiz_data_url: "u1" }) });
  });

  it("records a first submission and locks a second (410)", async () => {
    const body = { token: "tok1", gitcode_username: "alice", answers: { q1: "b" }, score: 1, answered: 1, total: 1, missed_behavior_ids: [], missed_question_ids: [] };
    const r1 = await env_test.fetch("https://x/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(r1.status).toBe(201);
    const j1 = await r1.json(); expect(j1.score).toBe(1); expect(j1.terminal).toBe("cleared");

    const r2 = await env_test.fetch("https://x/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(r2.status).toBe(410);
  });

  it("rejects submit when gitcode_username != author (403)", async () => {
    const body = { token: "tok1", gitcode_username: "mallory", answers: {}, score: 0, answered: 0, total: 1, missed_behavior_ids: ["b1"], missed_question_ids: ["q1"] };
    const r = await env_test.fetch("https://x/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(r.status).toBe(403);
  });

  it("GET /admin/results returns the quiz with its result", async () => {
    await env_test.fetch("https://x/api/submit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "tok1", gitcode_username: "alice", answers: { q1: "x" }, score: 0, answered: 1, total: 1, missed_behavior_ids: ["b1"], missed_question_ids: ["q1"] }) });
    const r = await env_test.fetch("https://x/admin/results", { headers: { Authorization: "Bearer test-committer" } });
    expect(r.status).toBe(200);
    const arr = await r.json();
    expect(arr.length).toBe(1);
    expect(arr[0].result.gitcode_username).toBe("alice");
    expect(arr[0].result.missed_behavior_ids).toBe('["b1"]');
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `npx vitest run`
Expected: 3 new tests FAIL (`/api/submit` and `/admin/results` not routed).

- [ ] **Step 3: Implement `/api/submit` and `/admin/results`**

Add imports and routes in `worker/src/index.ts`:

```ts
import { getQuizByToken, getResult, insertQuiz, insertResult, listAll, type ResultRow } from "./db";
```

In the `fetch` switch, add (before the `not found` fallthrough):

```ts
if (url.pathname === "/api/submit" && req.method === "POST") return await submit(req, env);
if (url.pathname === "/admin/results" && req.method === "GET") {
  const g = guard(req, env); if (g) return g;
  return Response.json(await listAll(env.DB), { headers: CORS });
}
```

Add the handler:

```ts
async function submit(req: Request, env: Env): Promise<Response> {
  const b = await req.json() as { token: string; gitcode_username: string; answers: Record<string,string>; score: number; answered: number; total: number; missed_behavior_ids: string[]; missed_question_ids: string[] };
  const q = await getQuizByToken(env.DB, b.token);
  if (!q) return Response.json({ error: "unknown token" }, { status: 404, headers: CORS });
  if (b.gitcode_username !== q.author) return Response.json({ error: "submitter is not the PR author" }, { status: 403, headers: CORS });
  const row: ResultRow = {
    repo: q.repo, pr: q.pr, head_sha: q.head_sha, gitcode_username: b.gitcode_username,
    score: b.score, answered: b.answered, total: b.total,
    missed_behavior_ids: JSON.stringify(b.missed_behavior_ids),
    missed_question_ids: JSON.stringify(b.missed_question_ids),
    submitted_at: new Date().toISOString(),
  };
  const ins = await insertResult(env.DB, row);
  if (ins.error) { // PK (repo,pr,head_sha) already present
    return Response.json({ error: "already submitted; only the first attempt per version is recorded" }, { status: 410, headers: CORS });
  }
  const total = b.total;
  const terminal = b.score === total ? "cleared" : "re-read";
  return Response.json({ score: b.score, total, terminal, missed_behaviors: b.missed_behavior_ids }, { status: 201, headers: CORS });
}
```

- [ ] **Step 4: Run tests; verify all pass**

Run: `npx vitest run`
Expected: all tests pass (register/lookup from Task 1 + submit/results from Task 2).

- [ ] **Step 5: Commit**

```bash
git add worker/
git -c user.name="c8x1" -c user.email="c8x1@users.noreply.github.com" commit -m "feat(worker): submit + results endpoints with one-shot lock"
```

---

## Task 3: SPA shell + sample data + report rendering (read-only route)

**Files:**
- Create: `index.html`, `app/main.js`, `app/report.js`, `app/styles.css`, `app/api.js`
- Create: `data/sample/16401-abc1234.json`
- Modify: the existing placeholder `index.html` (replace its contents)

**Interfaces:**
- Produces: a working read-only report view at `#/pr/<repo>/<pr>` (no token) rendering the sample JSON; `app/api.getQuizByToken(token)` returns the Worker response (used in Task 4).

- [ ] **Step 1: Create sample quiz JSON `data/sample/16401-abc1234.json`**

```json
{
  "repo": "openharmony/multimedia_audio_framework",
  "pr_number": 16401,
  "author": "xiaokuerz",
  "head_sha": "abc1234",
  "report": {
    "context": "本 PR 修复了 AudioPolicy 在设备切换时的音量泄漏问题。",
    "intuition": "旧实现依赖 setStreamVolume 在设备变更前同步刷一次,但新设备 HDI 尚未 ready 时该调用会被丢弃。",
    "what_was_done": "在 `OnAudioDeviceChange` 回调里新增 50ms debounce,确认 HDI ready 后再 setStreamVolume。",
    "non_obvious_behaviors": [
      { "id": "b1", "what": "debounce 计时器在 service 退出时不会自动取消", "why": "service 退出时 SetVolume 跑在已释放的上下文", "where": "services/audio_policy/server/audio_policy_service.cpp:142" },
      { "id": "b2", "what": "HDI ready 检查只看 renderer,capturer 路径不查", "why": "录音场景设备切换仍会丢音量", "where": "services/audio_policy/server/audio_policy_service.cpp:88" }
    ],
    "inherited_dependency": { "what": "依赖旧 SetVolume 的幂等性", "where": "frameworks/native/audiorenderer/audio_renderer.cpp:300" }
  },
  "quiz": {
    "questions": [
      { "id": "q1", "type": "scenario", "prompt": "用户在录音时切换设备后音量异常,根因最可能是?",
        "options": [ { "id": "a", "text": "debounce 没启动" }, { "id": "b", "text": "capturer 路径未检查 HDI ready" }, { "id": "c", "text": "setStreamVolume 返回错误码" } ],
        "correct_option": "b", "tests_behavior_id": "b2",
        "excerpt": "HDI ready 检查只看 renderer,capturer 路径不查",
        "section_anchor": "#behav-b2", "reinforce": "对,b2 指出 capturer 路径未受保护。" },
      { "id": "q2", "type": "scenario", "prompt": "service 异常退出后用户报告崩溃,指向哪条?",
        "options": [ { "id": "a", "text": "计时器未取消,跑在已释放上下文" }, { "id": "b", "text": "音量值越界" } ],
        "correct_option": "a", "tests_behavior_id": "b1",
        "excerpt": "debounce 计时器在 service 退出时不会自动取消",
        "section_anchor": "#behav-b1", "reinforce": "对,b1 的关键风险。" }
    ],
    "hard_gate_question_ids": ["q1", "q2"]
  }
}
```

- [ ] **Step 2: Create `app/styles.css`** (warm palette from framework.md)

```css
:root{
  --ivory:#FAF9F5; --paper:#FFFFFF; --slate:#141413;
  --clay:#D97757; --clay-d:#B85C3E; --olive:#788C5D; --oat:#E3DACC;
  --g100:#F0EEE6; --g200:#E6E3DA; --g300:#D1CFC5; --g500:#87867F; --g700:#3D3D3A;
  --serif:ui-serif,Georgia,"Times New Roman",serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,monospace;
}
body{margin:0;background:var(--ivory);color:var(--slate);font-family:var(--sans);line-height:1.6}
main{max-width:820px;margin:0 auto;padding:2rem 1.2rem}
h1,h2,h3{font-family:var(--serif);letter-spacing:-.01em}
.card{background:var(--paper);border:1px solid var(--g200);border-radius:10px;padding:1.1rem 1.2rem;margin:1rem 0}
.where{font-family:var(--mono);font-size:.85em;color:var(--clay-d);background:#FBF0EA;border:1px solid var(--clay);border-radius:4px;padding:.1rem .4rem}
.behavior .what{font-weight:600}
.behavior .why{color:var(--g700)}
.landmine{color:var(--clay-d);border-color:var(--clay);background:#FBF0EA}
.opt{display:block;width:100%;text-align:left;margin:.4rem 0;padding:.6rem .8rem;border:1px solid var(--g300);border-radius:8px;background:var(--paper);cursor:pointer;font:inherit}
.opt.correct{border-color:var(--olive);background:#EFF2E9}
.opt.wrong{border-color:var(--clay);background:#FBF0EA}
.feedback{margin:.4rem 0 .4rem;padding:.6rem .8rem;border-left:3px solid var(--clay);background:var(--g100);font-size:.95em}
.scorebox{position:sticky;top:0;background:var(--ivory);padding:.6rem 0;font-family:var(--mono)}
a{color:var(--clay-d)}
```

- [ ] **Step 3: Create `app/api.js`**

```js
const WORKER_URL = "https://code-review-check.<你的子域>.workers.dev"; // set in Task 9
export async function getQuizByToken(token) {
  const r = await fetch(`${WORKER_URL}/api/quiz?t=${encodeURIComponent(token)}`);
  if (!r.ok) return null;
  return r.json();
}
export async function submitQuiz(token, gitcode_username, payload) {
  const r = await fetch(`${WORKER_URL}/api/submit`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, gitcode_username, ...payload }),
  });
  return { status: r.status, body: r.ok ? await r.json() : await r.text() };
}
export async function getResults(committer_token) {
  const r = await fetch(`${WORKER_URL}/admin/results`, { headers: { Authorization: `Bearer ${committer_token}` } });
  return r.ok ? r.json() : [];
}
export async function loadQuizData(quiz_data_url) {
  const r = await fetch(quiz_data_url, { cache: "no-cache" });
  if (!r.ok) return null;
  return r.json();
}
```

- [ ] **Step 4: Create `app/report.js`**

```js
export function renderReport(root, data) {
  const r = data.report;
  root.innerHTML = `
    <h1>自查 · ${escapeHtml(data.repo)} #${data.pr_number}</h1>
    <section class="card"><h2>背景</h2><p>${escapeHtml(r.context)}</p></section>
    <section class="card"><h2>直觉</h2><p>${escapeHtml(r.intuition)}</p></section>
    <section class="card"><h2>改了什么</h2><p>${escapeHtml(r.what_was_done)}</p></section>
    <section><h2>本改动引入的非显然行为</h2>${r.non_obvious_behaviors.map(b => `
      <div class="card behavior" id="behav-${b.id}">
        <div class="what">${b.id}: ${escapeHtml(b.what)}</div>
        <div class="why">${escapeHtml(b.why)}</div>
        <div>where: <span class="where">${escapeHtml(b.where)}</span></div>
      </div>`).join("")}</section>
    <section class="card landmine"><h2>依赖的既有行为</h2>
      <p>${escapeHtml(r.inherited_dependency.what)}</p>
      <div>where: <span class="where">${escapeHtml(r.inherited_dependency.where)}</span></div>
    </section>`;
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
export { escapeHtml };
```

- [ ] **Step 5: Create `app/main.js` (router; quiz engine wired in Task 4)**

```js
import { renderReport } from "./report.js";
import { loadQuizData } from "./api.js";

const root = document.getElementById("app");
function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [path, qs] = hash.split("?");
  const seg = path.split("/").filter(Boolean); // e.g. ["pr", repo, prnum] or ["dashboard"]
  const params = new URLSearchParams(qs || "");
  return { seg, params };
}
async function route() {
  const { seg, params } = parseRoute();
  if (seg[0] === "pr" && seg[1] && seg[2]) {
    const repo = decodeURIComponent(seg[1]);
    const pr = seg[2];
    // dev view: prefer Worker-resolved data URL when token present (Task 4); fallback to sample for read-only dev
    let data;
    const token = params.get("t");
    if (token) {
      const { getQuizByToken } = await import("./api.js");
      const meta = await getQuizByToken(token);
      if (!meta) { root.innerHTML = `<main><p>链接无效或已过期。</p></main>`; return; }
      data = await loadQuizData(meta.quiz_data_url);
    } else {
      data = await loadQuizData(`${location.origin}/code-review-check/data/sample/${pr}-abc1234.json`);
    }
    if (!data) { root.innerHTML = `<main><p>quiz 数据未就绪。</p></main>`; return; }
    const main = document.createElement("main");
    root.innerHTML = "";
    root.appendChild(main);
    renderReport(main, data);
    // quiz engine mounted in Task 4
    return;
  }
  root.innerHTML = `<main><h1>code-review-check</h1><p>自查站点。请从 GitCode PR 评论中的链接进入。</p></main>`;
}
addEventListener("hashchange", route);
addEventListener("DOMContentLoaded", route);
```

- [ ] **Step 6: Replace `index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>code-review-check</title>
  <link rel="stylesheet" href="app/styles.css" />
</head>
<body>
  <div id="app"><main><p>加载中…</p></main></div>
  <script type="module" src="app/main.js"></script>
</body>
</html>
```

- [ ] **Step 7: Smoke test the read-only view**

Run a local server from the repo root:
```bash
cd /Users/noctis/Workspace/code-review-check
python3 -m http.server 8080
```
Open `http://localhost:8080/#/pr/openharmony%2Fmultimedia_audio_framework/16401` (no token → read-only, loads sample).
Expected: the report renders with two non-obvious behavior cards + inherited dependency. (Quiz buttons come in Task 4.)

- [ ] **Step 8: Commit**

```bash
git add index.html app/ data/
git -c user.name="c8x1" -c user.email="c8x1@users.noreply.github.com" commit -m "feat(spa): shell + report rendering + sample quiz data"
```

---

## Task 4: SPA quiz engine (lock, feedback, live score, two terminals) + grading unit tests

**Files:**
- Create: `app/quiz-engine.js`, `app/grade.test.js`, `app/vitest.config.js`, `app/package.json`
- Modify: `app/main.js` (mount the quiz engine after the report)

**Interfaces:**
- Produces: pure `gradeQuiz(questions, answers) -> {score, total, missed_questions, missed_behaviors, terminal}` (unit-tested); a rendered quiz with lock-on-click, wrong-answer excerpt + anchor, live score, two terminal cards; POSTs to Worker on submit.

- [ ] **Step 1: Create `app/package.json` + `app/vitest.config.js`**

```json
{ "name": "code-review-check-spa", "private": true, "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^1.6.0" } }
```
```js
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 2: Write failing test for `gradeQuiz`**

`app/grade.test.js`:

```js
import { gradeQuiz } from "./quiz-engine.js";
import { describe, it, expect } from "vitest";

const questions = [
  { id: "q1", correct_option: "b", tests_behavior_id: "b2", options: [{id:"a"},{id:"b"},{id:"c"}] },
  { id: "q2", correct_option: "a", tests_behavior_id: "b1", options: [{id:"a"},{id:"b"}] },
];
describe("gradeQuiz", () => {
  it("perfect score -> cleared, no missed", () => {
    const g = gradeQuiz(questions, { q1: "b", q2: "a" });
    expect(g.score).toBe(2); expect(g.total).toBe(2);
    expect(g.missed_questions).toEqual([]); expect(g.missed_behaviors).toEqual([]);
    expect(g.terminal).toBe("cleared");
  });
  it("missed question surfaces its behavior id", () => {
    const g = gradeQuiz(questions, { q1: "a", q2: "a" });
    expect(g.score).toBe(1); expect(g.missed_questions).toEqual(["q1"]);
    expect(g.missed_behaviors).toEqual(["b2"]); expect(g.terminal).toBe("re-read");
  });
  it("unanswered counts as missed", () => {
    const g = gradeQuiz(questions, { q2: "a" });
    expect(g.score).toBe(1); expect(g.missed_questions).toEqual(["q1"]);
    expect(g.missed_behaviors).toEqual(["b2"]);
  });
});
```

- [ ] **Step 3: Run; verify failure**

Run (from `app/`): `npx vitest run`
Expected: FAIL — `gradeQuiz` not defined.

- [ ] **Step 4: Implement `gradeQuiz` + the engine in `app/quiz-engine.js`**

```js
export function gradeQuiz(questions, answers) {
  let score = 0; const missed_questions = []; const missed_behaviors = [];
  for (const q of questions) {
    if (answers[q.id] === q.correct_option) score++;
    else { missed_questions.push(q.id); if (q.tests_behavior_id) missed_behaviors.push(q.tests_behavior_id); }
  }
  const total = questions.length;
  return { score, total, missed_questions, missed_behaviors, terminal: score === total ? "cleared" : "re-read" };
}

export function renderQuiz(container, data, { token, onSubmit }) {
  const qs = data.quiz.questions;
  const answers = {};
  let answered = 0;
  const scorebox = document.createElement("div");
  scorebox.className = "scorebox";
  scorebox.textContent = `Score: 0 / ${qs.length} · 0 answered`;
  container.appendChild(scorebox);

  for (const q of qs) {
    const block = document.createElement("section"); block.className = "card";
    block.innerHTML = `<h3>${q.prompt}</h3>`;
    for (const opt of q.options) {
      const btn = document.createElement("button");
      btn.className = "opt"; btn.textContent = opt.text; btn.dataset.opt = opt.id;
      btn.addEventListener("click", () => {
        if (block.dataset.locked) return;
        block.dataset.locked = "1";
        const correct = opt.id === q.correct_option;
        btn.classList.add(correct ? "correct" : "wrong");
        if (!correct) block.querySelector(`button[data-opt="${q.correct_option}"]`).classList.add("correct");
        answers[q.id] = opt.id;
        answered++;
        const fb = document.createElement("div"); fb.className = "feedback";
        if (correct) { fb.textContent = q.reinforce || "正确。"; }
        else { fb.innerHTML = `正确项:${q.correct_option}。<br><em>From the report:</em> ${q.excerpt} <a href="${q.section_anchor}">回看</a>`; }
        block.appendChild(fb);
        scorebox.textContent = `Score: ${gradeQuiz(qs, answers).score} / ${qs.length} · ${answered} answered`;
        if (answered === qs.length) renderTerminal(container, qs, answers, onSubmit, token);
      });
      block.appendChild(btn);
    }
    container.appendChild(block);
  }
}

function renderTerminal(container, qs, answers, onSubmit, token) {
  const g = gradeQuiz(qs, answers);
  const card = document.createElement("section"); card.className = "card";
  if (g.terminal === "cleared") {
    card.innerHTML = `<h2>✅ Cleared to merge</h2>
      <ul><li>CI 绿</li><li>dev 自查通过 (${g.score}/${g.total})</li><li>head_sha 与最新一致</li></ul>`;
  } else {
    const dedup = [...new Set(g.missed_questions.map(id => qs.find(q=>q.id===id).section_anchor))];
    card.innerHTML = `<h2>⚠️ Not yet — re-read these sections</h2>
      ${dedup.map(a => `<div><a href="${a}">${a}</a></div>`).join("")}`;
  }
  const submit = document.createElement("button"); submit.className = "opt"; submit.textContent = "提交结果(只记首交)";
  submit.addEventListener("click", () => {
    const gitcode_username = prompt("请输入你的 GitCode 账号名(须与 PR 作者一致):");
    if (!gitcode_username) return;
    // map gradeQuiz field names -> Worker body field names
    onSubmit({
      token, gitcode_username, answers,
      score: g.score, answered: Object.keys(answers).length, total: g.total,
      missed_behavior_ids: g.missed_behaviors, missed_question_ids: g.missed_questions,
    });
  });
  card.appendChild(submit);
  container.appendChild(card);
}
```

- [ ] **Step 5: Run unit tests; verify pass**

Run (from `app/`): `npx vitest run`
Expected: 3 tests pass.

- [ ] **Step 6: Wire the engine into `app/main.js`**

In the `pr` route, after `renderReport(main, data);`, add:

```js
const token = params.get("t");
const quizHost = document.createElement("div");
main.appendChild(quizHost);
const { renderQuiz } = await import("./quiz-engine.js");
const { submitQuiz } = await import("./api.js");
// one-shot lock from server: if already submitted, mount read-only
let already = false;
if (token) {
  const { getQuizByToken } = await import("./api.js");
  const meta = await getQuizByToken(token);
  already = !!(meta && meta.has_result);
}
if (already) {
  quizHost.innerHTML = `<section class="card"><p>该版本已提交,只记首交。结果见 dashboard。</p></section>`;
} else {
  renderQuiz(quizHost, data, { token, onSubmit: async (payload) => {
    const res = await submitQuiz(payload.token, payload.gitcode_username, payload);
    if (res.status === 201) alert(`已记录: ${res.body.score}/${res.body.total} (${res.body.terminal})`);
    else if (res.status === 410) alert("已提交过,只记首交。");
    else if (res.status === 403) alert("账号名与 PR 作者不一致。");
    else alert("提交失败:" + res.body);
  }});
}
```

Adjust Step 5 of Task 3's `main.js` so the `token` block that imports `getQuizByToken` is replaced by this wiring (the engine now owns submit). Re-read `app/main.js` and merge so there is a single `pr` branch that: loads data (via token→meta→data_url, or sample for read-only), renders report, then mounts the quiz engine.

- [ ] **Step 7: Smoke test end-to-end against the sample (no Worker)**

```bash
python3 -m http.server 8080
```
Open `http://localhost:8080/#/pr/openharmony%2Fmultimedia_audio_framework/16401`.
Expected: report + quiz. Click a wrong option → correct one highlights, excerpt + "回看" link appear; live score updates; after all answered → terminal card + submit button. (Submit will fail to reach the Worker until Task 9; that's fine for this smoke — the interaction is what we're checking.)

- [ ] **Step 8: Commit**

```bash
git add app/
git -c user.name="c8x1" -c user.email="c8x1@users.noreply.github.com" commit -m "feat(spa): quiz engine + grading unit tests + submit wiring"
```

---

## Task 5: SPA committer dashboard

**Files:**
- Create: `app/dashboard.js`
- Modify: `app/main.js` (add `dashboard` route)

**Interfaces:**
- Produces: `#/dashboard?ct=<committer_token>` → a list of PR cards (score + missed behaviors with file:line + links), reading `GET /admin/results`.

- [ ] **Step 1: Create `app/dashboard.js`**

```js
import { getResults } from "./api.js";
import { escapeHtml } from "./report.js";

export async function renderDashboard(root, committer_token) {
  const rows = await getResults(committer_token);
  if (!rows.length) { root.innerHTML = `<main><p>暂无 quiz 记录。</p></main>`; return; }
  const cards = rows.map(({quiz, result}) => {
    const missed = result ? JSON.parse(result.missed_behavior_ids) : [];
    const behaviors = quiz ? null : null; // behavior details live in the quiz JSON on Pages; link to the quiz page instead
    const status = result ? `✅ 已提交 ${result.score}/${result.total}` : "⏳ 未自查";
    const missedHtml = result && missed.length
      ? `<div>错过的 non-obvious behavior(证据):<ul>${missed.map(id => `<li>${escapeHtml(id)} <a href="#/pr/${encodeURIComponent(quiz.repo)}/${quiz.pr}?t=${quiz.token}">见 quiz 页</a></li>`).join("")}</ul></div>`
      : "";
    const prUrl = `https://gitcode.com/${quiz.repo}/pull/${quiz.pr}`;
    return `<section class="card">
      <h3>#${quiz.pr} · ${escapeHtml(quiz.repo)} · author: ${escapeHtml(quiz.author)} · head ${quiz.head_sha.slice(0,7)}</h3>
      <div>状态: ${status} · 生成 ${escapeHtml(quiz.created_at)}</div>
      ${missedHtml}
      <div><a href="#/pr/${encodeURIComponent(quiz.repo)}/${quiz.pr}?t=${quiz.token}">→ 打开 quiz 页</a> · <a href="${prUrl}" target="_blank">→ GitCode PR</a></div>
    </section>`;
  }).join("");
  root.innerHTML = `<main><h1>Committer 自查结果</h1>${cards}</main>`;
}
```

- [ ] **Step 2: Add `dashboard` route to `app/main.js`**

In `route()`, before the `pr` branch:

```js
if (seg[0] === "dashboard") {
  const ct = params.get("ct");
  if (!ct) { root.innerHTML = `<main><p>需要 committer token。</p></main>`; return; }
  const { renderDashboard } = await import("./dashboard.js");
  await renderDashboard(root, ct);
  return;
}
```

- [ ] **Step 3: Smoke (no live Worker yet — should show "暂无")**

```bash
python3 -m http.server 8080
```
Open `http://localhost:8080/#/dashboard?ct=anything`.
Expected: "暂无 quiz 记录。" (Worker not deployed yet; the fetch fails → `getResults` returns `[]`.) No crash.

- [ ] **Step 4: Commit**

```bash
git add app/
git -c user.name="c8x1" -c user.email="c8x1@users.noreply.github.com" commit -m "feat(spa): committer dashboard"
```

---

## Task 6: Daemon complexity gate + unit tests

**Files:**
- Create: `scripts/tests/test_complexity_gate.py`
- Modify: `scripts/review_daemon.py` (add `is_complex_pr`)
- Modify: `scripts/config.yaml` (add `quiz:` block)

**Interfaces:**
- Consumes: the PR dict (has `head.sha`, `user.login`, `updated_at`) and the per-file change list `[{filename, additions, deletions, status}]` (already fetched via `_fetch_pr_files`-style call — add a `_fetch_pr_diffstat` helper if the files API doesn't return additions/deletions).
- Produces: `is_complex_pr(pr, diffstat, config) -> bool` used in `daemon_loop` to decide whether to inject the quiz prompt.

- [ ] **Step 1: Add the `quiz:` block to `scripts/config.yaml`**

Append (the `code_review_graph` and `business_knowledge` blocks already exist; add this peer):

```yaml
quiz:
  enabled: true
  site_repo: c8x1/code-review-check
  site_local_clone: ~/.claude/skills/gitcode-review/code-review-check-worktree
  worker_url: https://code-review-check.<你的子域>.workers.dev
  committer_token: "REPLACE_WITH_SECRET"   # set in Task 9; daemon reads from env CRC_COMMITTER_TOKEN if present
  complexity:
    min_changed_lines: 30          # additions + deletions across non-skip files
    min_non_test_files: 3
    logic_paths: ["services/", "frameworks/"]
    skip_path_suffixes: ["_test/", "test/", "__test__/", ".gni", "BUILD.gn", "README", "docs/"]
```

- [ ] **Step 2: Write failing test `scripts/tests/test_complexity_gate.py`**

```python
import sys, os, pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import review_daemon as rd

CFG = {"quiz": {"complexity": {
    "min_changed_lines": 30, "min_non_test_files": 3,
    "logic_paths": ["services/", "frameworks/"],
    "skip_path_suffixes": ["_test/", "test/", ".gni", "BUILD.gn", "README"]}}}

def filelist(items):
    return [{"filename": n, "additions": a, "deletions": d, "status": "modified"} for n,a,d in items]

def test_pure_test_changes_are_not_complex():
    pr = {"head": {"sha": "x"}, "user": {"login": "alice"}, "updated_at": "2026-07-25T15:00:00+08:00"}
    ds = filelist([("services/audio_policy/a_test.cpp", 100, 0)])
    assert rd.is_complex_pr(pr, ds, CFG) is False

def test_logic_change_above_line_threshold_is_complex():
    pr = {"head": {"sha": "x"}, "user": {"login": "alice"}, "updated_at": "2026-07-25T15:00:00+08:00"}
    ds = filelist([("services/audio_policy/a.cpp", 40, 0)])
    assert rd.is_complex_pr(pr, ds, CFG) is True

def test_tiny_logic_change_not_complex():
    pr = {"head": {"sha": "x"}, "user": {"login": "alice"}, "updated_at": "2026-07-25T15:00:00+08:00"}
    ds = filelist([("services/audio_policy/a.cpp", 5, 0)])
    assert rd.is_complex_pr(pr, ds, CFG) is False

def test_three_small_logic_files_complex_via_file_count():
    pr = {"head": {"sha": "x"}, "user": {"login": "alice"}, "updated_at": "2026-07-25T15:00:00+08:00"}
    ds = filelist([("services/a.cpp",1,0),("services/b.cpp",1,0),("frameworks/c.cpp",1,0)])
    assert rd.is_complex_pr(pr, ds, CFG) is True

def test_config_path_only_logic_counts():
    pr = {"head": {"sha": "x"}, "user": {"login": "alice"}, "updated_at": "2026-07-25T15:00:00+08:00"}
    # 100 lines changed but only in docs/ — not logic_path -> not complex
    ds = filelist([("docs/readme.md", 100, 0)])
    assert rd.is_complex_pr(pr, ds, CFG) is False
```

- [ ] **Step 3: Run; verify failure**

Run: `cd scripts && python3 -m pytest tests/test_complexity_gate.py -v`
Expected: FAIL — `is_complex_pr` not defined.

- [ ] **Step 4: Implement `is_complex_pr` in `review_daemon.py`**

```python
def is_complex_pr(pr: dict, diffstat: list, config: dict) -> bool:
    """A PR is complex enough to warrant a self-check quiz iff it touches a
    logic path, is not entirely skip-suffix files, and exceeds either the
    changed-line or non-test-file threshold."""
    q = (config.get("quiz") or {})
    if not q.get("enabled", False):
        return False
    c = q.get("complexity") or {}
    logic = c.get("logic_paths") or []
    skip = c.get("skip_path_suffixes") or []
    logic_hits = [f for f in diffstat if any(f["filename"].startswith(p) for p in logic)]
    if not logic_hits:
        return False
    # all-touched-logic-files-are-skip? then trivial
    if all(any(f["filename"].endswith(s) or s.rstrip("/") in f["filename"] for s in skip) for f in logic_hits):
        return False
    non_test = [f for f in logic_hits if not any(s.rstrip("/") in f["filename"] for s in skip)]
    changed_lines = sum(f["additions"] + f["deletions"] for f in non_test)
    if changed_lines >= c.get("min_changed_lines", 30):
        return True
    if len(non_test) >= c.get("min_non_test_files", 3):
        return True
    return False
```

- [ ] **Step 5: Run; verify pass**

Run: `cd scripts && python3 -m pytest tests/test_complexity_gate.py -v`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
cd ~/.claude/skills/gitcode-review
git add scripts/review_daemon.py scripts/config.yaml scripts/tests/test_complexity_gate.py
git -c user.name="c8x1" -c user.email="c8x1@users.noreply.github.com" commit -m "feat(daemon): complexity gate for quiz generation"
```

> Note: `~/.claude/skills/gitcode-review` may not be a git repo. If it isn't, skip the commit and treat this dir as versioned by the user's dotfile backup. Still keep the files; Task 9 finalizes storage.

---

## Task 7: Daemon quiz generation pipeline (token mint, prompt injection, post-review publish + register)

**Files:**
- Modify: `scripts/review_daemon.py` (`mint_token`, `build_quiz_prompt_injection`, `publish_quiz`, call sites in `invoke_review` + `daemon_loop`)
- Create: `scripts/tests/test_publish_quiz.py`

**Interfaces:**
- Consumes: `is_complex_pr` (Task 6), `config["quiz"]`, the review subprocess result, `gitcode_api` for fetching diffstat.
- Produces: a quiz JSON pushed to the site repo at `data/<repo>/<pr>-<sha7>.json`; a Worker `POST /admin/quiz` registration; the review prompt carries the quiz URL + contract.

- [ ] **Step 1: Write failing test `scripts/tests/test_publish_quiz.py`**

```python
import sys, os, json, pathlib, tempfile, pytest
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import review_daemon as rd

CFG = {"quiz": {"enabled": True, "site_repo": "c8x1/code-review-check",
                "site_local_clone": tempfile.mkdtemp(),
                "worker_url": "https://w.example.dev",
                "committer_token": "ct-secret"},
       "claude_cli": {"path": "claude", "timeout_seconds": 1}}

def test_mint_token_is_url_safe_32():
    t = rd.mint_token()
    assert len(t) >= 20 and all(c.isalnum() or c in "-_" for c in t)

def test_publish_quiz_pushes_file_and_registers(monkeypatch, tmp_path):
    repo = "openharmony/multimedia_audio_framework"; pr = "16401"; sha = "abc1234567"
    cfg = {"quiz": {**CFG["quiz"], "site_local_clone": str(tmp_path)}}
    # fake a quiz JSON the review wrote
    quiz_json = {"repo": repo, "pr_number": int(pr), "author": "xiaokuerz", "head_sha": sha,
                 "report": {"context":"", "intuition":"", "what_was_done":"",
                            "non_obvious_behaviors":[{"id":"b1","what":"","why":"","where":"f.cpp:1"}],
                            "inherited_dependency":{"what":"","where":""}},
                 "quiz":{"questions":[],"hard_gate_question_ids":[]}}
    review_logs = pathlib.Path(__file__).parent / ".." / "review_logs"
    quiz_path = review_logs / f"quiz_{pr}.json"
    quiz_path.parent.mkdir(exist_ok=True)
    quiz_path.write_text(json.dumps(quiz_json))

    calls = {"git_push": 0, "worker": None}
    def fake_run(cmd, **kw): calls["git_push"] += 1; return mock.Mock(returncode=0)
    class FakeResp:
        status = 201
        def json(self): return {"token":"tok","quiz_data_url":"u"}
    def fake_post(url, **kw): calls["worker"] = (url, kw); return FakeResp()

    monkeypatch.setattr(rd.subprocess, "run", fake_run)
    monkeypatch.setattr(rd, "requests", mock.Mock(post=fake_post))

    rd.publish_quiz(repo, pr, sha, "xiaokuerz", "tok", cfg, log=mock.Mock())

    # file written into the site clone data dir, named with sha7
    out = tmp_path / "data" / repo / f"{pr}-abc1234.json"
    assert out.exists()
    assert json.loads(out.read_text())["head_sha"] == sha
    assert calls["worker"][0].endswith("/admin/quiz")
    assert calls["worker"][1]["headers"]["Authorization"] == "Bearer ct-secret"
    quiz_path.unlink()
```

- [ ] **Step 2: Run; verify failure**

Run: `cd scripts && python3 -m pytest tests/test_publish_quiz.py -v`
Expected: FAIL — `mint_token` / `publish_quiz` not defined.

- [ ] **Step 3: Implement `mint_token` + `publish_quiz` + `build_quiz_prompt_injection` in `review_daemon.py`**

```python
import secrets, json, pathlib, urllib.request, urllib.error

def mint_token() -> str:
    return secrets.token_urlsafe(32)

def _sha7(sha: str) -> str:
    return (sha or "")[:7]

def build_quiz_prompt_injection(repo: str, pr_number: str, head_sha: str,
                                token: str, config: dict) -> str:
    base = (config.get("quiz") or {}).get("site_base_url") or "https://c8x1.github.io/code-review-check"
    url = f"{base}/#/pr/{urllib.parse.quote(repo, safe='')}/{pr_number}?t={token}"
    return (
        f"\n\n[复杂 PR] 本 PR 判定为复杂,需额外生成 self-check quiz,步骤见 SKILL.md Step 2.5。\n"
        f"将 quiz 写到 scripts/review_logs/quiz_{pr_number}.json(契约见 Step 2.5)。\n"
        f"quiz 页面 URL(仅当 JSON 写出且通过契约自检后,才在总结评论附上此 URL 引导开发者自查):\n{url}\n"
        f"若 JSON 生成失败或本 PR 实际 trivial,不要附该 URL。\n"
    )

def _quiz_contract_ok(data: dict) -> bool:
    try:
        beh = data["report"]["non_obvious_behaviors"]
        assert len(beh) >= 1 and all(b.get("where") for b in beh)
        assert "inherited_dependency" in data["report"]
        qs = data["quiz"]["questions"]
        scen = sum(1 for q in qs if q.get("type") == "scenario")
        assert len(qs) == 0 or scen * 2 >= len(qs)  # >= half
        hard = data["quiz"].get("hard_gate_question_ids", [])
        assert len(hard) >= 1
        ids = {b["id"] for b in beh}
        assert all(q["tests_behavior_id"] in ids for q in qs if "tests_behavior_id" in q)
        for q in qs:
            assert q.get("excerpt") and q.get("section_anchor") and q.get("reinforce")
        return True
    except Exception:
        return False

def publish_quiz(repo: str, pr_number: str, head_sha: str, author: str,
                 token: str, config: dict, log) -> None:
    q = config.get("quiz") or {}
    quiz_path = pathlib.Path(__file__).parent / "review_logs" / f"quiz_{pr_number}.json"
    if not quiz_path.exists():
        log.info("  quiz_%s.json absent; not publishing", pr_number); return
    try:
        data = json.loads(quiz_path.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning("  quiz_%s.json unreadable (%s); not publishing", pr_number, e); return
    if not _quiz_contract_ok(data):
        log.warning("  quiz_%s.json failed contract check; not publishing", pr_number); return

    clone = pathlib.Path(os.path.expanduser(q["site_local_clone"]))
    repo_dir = clone / "data" / repo
    repo_dir.mkdir(parents=True, exist_ok=True)
    out = repo_dir / f"{pr_number}-{_sha7(head_sha)}.json"
    out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    # commit + push (best-effort; proxy if direct fails)
    env_git = dict(os.environ)
    try:
        subprocess.run(["git", "-C", str(clone), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(clone), "commit", "-m", f"quiz: {repo}#{pr_number}@{_sha7(head_sha)}"],
                       check=True, env={**env_git, "GIT_AUTHOR_NAME": "c8x1", "GIT_AUTHOR_EMAIL": "c8x1@users.noreply.github.com"})
        subprocess.run(["git", "-C", str(clone), "push"], env=env_git)
    except Exception as e:
        subprocess.run(["git", "-C", str(clone), "-c", "http.proxy=http://127.0.0.1:7897",
                        "-c", "https.proxy=http://127.0.0.1:7897", "push"], env=env_git)
        log.info("  pushed via proxy")

    quiz_data_url = f"{(q.get('site_base_url') or 'https://c8x1.github.io/code-review-check')}/data/{urllib.parse.quote(repo, safe='')}/{pr_number}-{_sha7(head_sha)}.json"
    # register with Worker
    import requests
    requests.post(f"{q['worker_url']}/admin/quiz",
                  headers={"Authorization": f"Bearer {q.get('committer_token') or os.environ.get('CRC_COMMITTER_TOKEN','')}",
                           "Content-Type": "application/json"},
                  json={"repo": repo, "pr": int(pr_number), "head_sha": head_sha,
                        "author": author, "token": token, "quiz_data_url": quiz_data_url},
                  timeout=15)
    quiz_path.unlink(missing_ok=True)
    log.info("  published quiz for %s#%s@%s -> %s", repo, pr_number, _sha7(head_sha), quiz_data_url)
```

> `import urllib.parse` is already used elsewhere in the file; if not, add it. The `requests` import is local to avoid a hard dependency at module import (the daemon already uses `gitcode_api`; `requests` is available in that env).

- [ ] **Step 4: Run; verify pass**

Run: `cd scripts && python3 -m pytest tests/test_publish_quiz.py -v`
Expected: 2 tests pass.

- [ ] **Step 5: Wire into the review flow**

In `invoke_review` (around line 483 in the existing file), after building the base `prompt`, append the quiz injection when the PR is complex. The complexity is decided by the caller (`daemon_loop`) and passed in. Concretely:

- Add a parameter `complex: bool = False` and `token: str = ""` to `invoke_review`.
- When `complex and token`:
  ```python
  prompt += build_quiz_prompt_injection(repo, pr_number, (pr_head_sha or ""), token, config)
  ```
  (the caller computes `pr_head_sha` from the PR dict).
- In `daemon_loop`, after `should_review` returns True and before invoking, compute `diffstat` (a new helper `_fetch_pr_diffstat(repo, pr_number, config, log)` that calls the GitCode files API and returns `[{filename, additions, deletions, status}]`), then `complex = is_complex_pr(pr, diffstat, config)`, `token = mint_token() if complex else ""`, pass both into `invoke_review`.
- After `invoke_review` returns (the review subprocess finishes), if `complex and token` and the exit code is 0 (review succeeded enough to have posted comments), call `publish_quiz(repo, pr_number, pr_head_sha, author, token, config, log)`.
- Mark the review `review_count` etc. as before.

- [ ] **Step 6: Manual smoke (no live Worker)**

Run the daemon once against a known complex PR in dry-run/once mode (`python3 review_daemon.py --once`) with `quiz.enabled=true` but `worker_url` pointing at a stub. Verify: the review prompt printed in the log includes the quiz URL injection; after review, `publish_quiz` logs "published quiz" and the file appears in the site clone. (Full e2e with a live Worker is Task 9.)

- [ ] **Step 7: Commit**

```bash
cd ~/.claude/skills/gitcode-review
git add scripts/review_daemon.py scripts/tests/test_publish_quiz.py
git -c user.name="c8x1" -c user.email="c8x1@users.noreply.github.com" commit -m "feat(daemon): quiz generation pipeline (token, prompt, publish, register)"
```

---

## Task 8: SKILL.md Step 2.5 (quiz generation instructions for the reviewer)

**Files:**
- Modify: `~/.claude/skills/gitcode-review/SKILL.md` (insert a new `Step 2.5` between Step 2 and Step 3)

**Interfaces:** none (documentation consumed by `claude -p` during review).

- [ ] **Step 1: Insert `Step 2.5` into `SKILL.md`**

After the existing "### Step 2: Analyze Code Changes" section's last subsection and before "### Step 3: Generate Review Report", insert:

````markdown
### Step 2.5: 生成 self-check quiz(复杂 PR)

> 仅当 review prompt 中包含 `[复杂 PR]` 注入块时执行本步;否则跳过。

基于已加载的 diff + CRG 影响面(`impact_<pr>.md`)+ 业务 KB(`biz_<pr>.md`),生成一份开发者自查 quiz,写到 `scripts/review_logs/quiz_<pr-number>.json`。

**JSON 契约**:

```json
{
  "repo": "org/repo", "pr_number": 123, "author": "<PR 作者 login>", "head_sha": "<head.sha>",
  "report": {
    "context": "改动背景", "intuition": "背后的心智模型", "what_was_done": "可读的 diff 走读",
    "non_obvious_behaviors": [{"id":"b1","what":"...","why":"...","where":"<file:line>"}],
    "inherited_dependency": {"what":"...","where":"<file:line>"}
  },
  "quiz": {
    "questions": [
      {"id":"q1","type":"scenario","prompt":"...场景/决策题...",
       "options":[{"id":"a","text":"..."},{"id":"b","text":"...","correct":true}],
       "correct_option":"b","tests_behavior_id":"b1",
       "excerpt":"原文 1-2 句","section_anchor":"#behav-b1","reinforce":"答对解释"}
    ],
    "hard_gate_question_ids":["q1"]
  }
}
```

**契约自检(全部满足才能贴 URL)**:
1. `non_obvious_behaviors` ≥ 1,每条 `where` 是 diff 中真实 file:line
2. `inherited_dependency` 恰 1 条
3. ≥ 半数题目 `type:"scenario"`
4. `hard_gate_question_ids` ≥ 1,每道引用的 `tests_behavior_id` 对应真实 behavior
5. 每题带 `excerpt` + `section_anchor` + `reinforce`
6. 禁止纯复述/定义题

**流程**:
1. 先写 `quiz_<pr>.json`,跑契约自检
2. 自检通过 → 在 Step 4 的总结评论里附上注入块给出的 quiz URL,引导开发者:"本 PR 为复杂改动,请完成自查 quiz:<URL>(需输入你的 GitCode 账号名,只记首次提交)"
3. 自检失败或本 PR 实际 trivial → 不附 URL(由 daemon 的 `publish_quiz` 判定是否落库)

> quiz 的渲染、错答反馈、实时评分、双终态由站点 SPA 引擎统一处理;你只需产出符合契约的 JSON。
````

- [ ] **Step 2: Verify the JSON contract matches the schema in the spec**

Open `docs/superpowers/specs/2026-07-25-code-review-check-design.md` §4 and confirm field names match (`non_obvious_behaviors`, `inherited_dependency`, `questions[].tests_behavior_id`, `hard_gate_question_ids`). Fix any drift.

- [ ] **Step 3: Commit**

```bash
cd ~/.claude/skills/gitcode-review
git add SKILL.md
git -c user.name="c8x1" -c user.email="c8x1@users.noreply.github.com" commit -m "docs(skill): add Step 2.5 self-check quiz generation"
```

---

## Task 9: Cloudflare provisioning + secrets + end-to-end smoke

**Files:**
- Modify: `worker/wrangler.toml` (real D1 id), `app/api.js` (real WORKER_URL)
- Runbook: create D1, apply schema, set secret, deploy Worker, set daemon `committer_token`, seed the site clone, run `--once` against one real complex PR.

**Interfaces:** produces the live system: a real Worker URL, a deployed SPA, a daemon that generates + publishes quizzes and registers them, a dev taking the quiz, a committer viewing the dashboard.

- [ ] **Step 1: Create the D1 database and apply the schema**

```bash
cd /Users/noctis/Workspace/code-review-check/worker
npx wrangler d1 create code-review-check   # copy the printed database_id into wrangler.toml
npx wrangler d1 execute code-review-check --remote --file=schema.sql
npx wrangler d1 execute code-review-check --local  --file=schema.sql   # for local dev
```
Edit `wrangler.toml`: replace `REPLACE_WITH_D1_ID` with the printed id.

- [ ] **Step 2: Set the committer token secret + deploy**

```bash
COMMITTER_TOKEN=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')
echo "$COMMITTER_TOKEN" | npx wrangler secret put COMMITTER_TOKEN
npx wrangler deploy
# note the deployed URL, e.g. https://code-review-check.<sub>.workers.dev
```
Save `$COMMITTER_TOKEN` somewhere only you control (it is the committer dashboard + daemon admin credential).

- [ ] **Step 3: Configure the SPA and daemon with the real URL/token**

- `app/api.js`: set `WORKER_URL` to the deployed URL.
- `scripts/config.yaml`: set `worker_url` to the deployed URL; set `committer_token` to `$COMMITTER_TOKEN` (or export `CRC_COMMITTER_TOKEN` in the daemon's env).
- Seed the daemon's site clone: `git clone https://github.com/c8x1/code-review-check ~/.claude/skills/gitcode-review/code-review-check-worktree` (the path must match `site_local_clone`).

- [ ] **Step 4: Verify Worker live (curl)**

```bash
W=https://code-review-check.<sub>.workers.dev
curl -s "$W/api/quiz?t=nope" ; echo   # -> {"error":"unknown token"} 404
curl -s -X POST "$W/admin/quiz" -H "Authorization: Bearer $COMMITTER_TOKEN" -H "Content-Type: application/json" \
  -d '{"repo":"o/r","pr":1,"head_sha":"aaa","author":"alice","token":"tok-live","quiz_data_url":"https://example/data.json"}'
curl -s "$W/api/quiz?t=tok-live"      # -> {quiz_data_url, has_result:false, head_sha:"aaa"}
```

- [ ] **Step 5: Push the SPA live**

```bash
cd /Users/noctis/Workspace/code-review-check
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push
# GitHub Pages rebuilds; verify https://c8x1.github.io/code-review-check/ loads the SPA
```

- [ ] **Step 6: End-to-end against one real complex PR**

Run the daemon once:
```bash
cd ~/.claude/skills/gitcode-review/scripts
python3 review_daemon.py --once
```
Pick (or wait for) a complex PR from a watched author. Verify in the daemon log:
1. complexity gate says "complex"
2. the review prompt contains the `[复杂 PR]` injection with the quiz URL
3. after review, `publish_quiz` logs "published quiz … -> https://c8x1.github.io/code-review-check/data/<repo>/<pr>-<sha7>.json"
4. the GitCode PR summary comment includes the quiz URL

Then as the dev: open the quiz URL (in a browser where you're logged into GitCode as that author — or just type the author login when prompted), take the quiz, submit. Expect: a `201` with `{score, total, terminal, missed_behaviors}`; a second submit returns `410`.

Then as committer: open `https://c8x1.github.io/code-review-check/#/dashboard?ct=<COMMITTER_TOKEN>`. Expect: a card for that PR with the dev's score + missed behavior ids + links.

- [ ] **Step 7: Commit runbook + final wiring**

```bash
cd /Users/noctis/Workspace/code-review-check
git add worker/wrangler.toml app/api.js docs/
git -c user.name="c8x1" -c user.email="c8x1@users.noreply.github.com" commit -m "chore: wire live worker url + d1 id + runbook"
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push
```

---

## Self-Review (run before handoff)

**Spec coverage** — every spec section maps to a task:
- §2 constraints → Global Constraints + Task 2 (one-shot/token/author) + Task 7 (local token mint).
- §3 components → Tasks 1–9 (Worker, SPA, daemon, skill, GitCode comment).
- §4 JSON contract → Task 3 sample + Task 8 SKILL.md + Task 7 `_quiz_contract_ok`.
- §5 data flow → Task 7 (steps 1–7) + Task 9 e2e.
- §6 complexity gate → Task 6.
- §7 Worker+D1 → Tasks 1–2 + Task 9 provisioning.
- §8 SPA routes → Tasks 3–5.
- §9 failure modes → handled: no-JSON no-URL (Task 7 `publish_quiz` no-op), dev never takes (dashboard "未自查"), concurrent submit (D1 PK 410), Pages 404 (SPA "数据未就绪").
- §10 testing → each task's unit/integration tests + Task 9 e2e.
- §11 files to change → matched 1:1 in File Structure.

**Placeholder scan** — `<你的子域>` and `REPLACE_WITH_SECRET` / `REPLACE_WITH_D1_ID` are deploy-time values the operator fills in Task 9; they are not gaps in the plan. `new Date()` appears in Worker code (Workers runtime supports it) — fine.

**Type consistency** — `gradeQuiz` returns `{score, total, missed_questions, missed_behaviors, terminal}`; the SPA submit payload spreads `...g` plus `answers`, `answered`, matching the Worker's expected body `{token, gitcode_username, answers, score, answered, total, missed_behavior_ids, missed_question_ids}` — note the field rename (`missed_behaviors`→`missed_behavior_ids`, `missed_questions`→`missed_question_ids`); the submit wiring in Task 4 Step 6 must map these. **Fix**: in `app/quiz-engine.js` `renderTerminal`'s `onSubmit`, send:
```js
onSubmit({ token, gitcode_username, answers, score: g.score, answered: Object.keys(answers).length,
           total: g.total, missed_behavior_ids: g.missed_behaviors, missed_question_ids: g.missed_questions });
```
Apply this rename in Task 4 Step 4 before the unit tests' contract drifts.

**Scope** — single feature, one plan, 9 tasks each shippable.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-25-code-review-check.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
