# code-review-check — Design Spec

**Date**: 2026-07-25
**Author**: Noc
**Status**: approved (brainstorm)

## 1. Problem & Goal

For complex PRs on the OpenHarmony repos the `gitcode-review` daemon already
reviews automatically, the dev's *understanding* of their own change is not
checked. Because most of these PRs are written by AI agents, a self-check quiz
forcing the dev to apply the change's non-obvious behaviors is a stronger
signal than a rubber-stamp review.

**Goal**: for each complex PR, generate a `change-quiz`-style self-check quiz,
host it on a static site (`code-review-check`, GitHub Pages), link the quiz URL
from the GitCode review report, let the dev take it once, and surface the
dev's first-attempt score + missed non-obvious behaviors to the committer
before merge.

**Non-goals**: replacing the existing review; quizzing trivial PRs (UT-only,
few-line changes); verifying the submitter's real identity (OAuth) — the
committer cross-checks suspicious results by asking the dev.

## 2. Decided constraints (from brainstorm)

- **Result store**: real serverless backend (not PR-comment, not daemon-only).
- **Submitter gating**: one-time token in the quiz URL **+** a GitCode username
  field that must equal the PR author. No OAuth. The token lives in a public
  PR comment; the username check is the second barrier. Weak by design —
  internal tool, committer knows the dev.
- **Attempt policy**: one-shot. Only the first submission per PR is recorded.
  The dev can re-read and re-answer locally, but the backend keeps the first
  locked answers. First-attempt score is the honest signal.
- **Architecture**: JSON quiz-data + shared SPA engine + Cloudflare Worker
  with D1 (SQLite). One quiz engine, many PRs; repo stays small.

## 3. Components

| Component | Responsibility | Status |
|---|---|---|
| `review_daemon.py` | complexity gate, mint token, inject quiz URL into review prompt, post-review push of quiz JSON + one Worker registration call | extend |
| `gitcode-review` SKILL.md | during review, write `quiz_<pr>.json` per schema + contract self-check; include URL in summary only on success | extend |
| `code-review-check` repo (GitHub Pages) | host SPA + `data/<repo>/<pr>.json` | scaffolded, add content |
| Cloudflare Worker + D1 | quiz registry + token/author validation + one-shot result store | new |
| GitCode PR review comment | carries quiz URL | extend |

## 4. Quiz JSON contract

```json
{
  "repo": "openharmony/multimedia_audio_framework",
  "pr_number": 16401,
  "author": "xiaokuerz",
  "head_sha": "abc123",
  "report": {
    "context": "why this change exists",
    "intuition": "the mental model behind it",
    "what_was_done": "readable diff walkthrough (markdown)",
    "non_obvious_behaviors": [
      { "id": "b1", "what": "...", "why": "...", "where": "services/audio_policy/.../foo.cpp:142" }
    ],
    "inherited_dependency": { "what": "...", "where": "..." }
  },
  "quiz": {
    "questions": [
      { "id": "q1", "type": "scenario",
        "prompt": "after deploy a user reports X — what does that tell you?",
        "options": [
          { "id": "a", "text": "..." },
          { "id": "b", "text": "...", "correct": true }
        ],
        "correct_option": "b",
        "tests_behavior_id": "b1",
        "excerpt": "1-2 sentence quote from the report",
        "section_anchor": "#behav-b1",
        "reinforce": "why the right answer is right" }
    ],
    "hard_gate_question_ids": ["q1"]
  }
}
```

**Contract self-check (skill enforces at generation; daemon does not publish a
quiz that fails)**:

1. `non_obvious_behaviors` ≥ 1, each `where` is a real file:line from the diff.
2. `inherited_dependency` exactly 1 (an existing component the change silently
   leans on).
3. ≥ half of questions are `type: "scenario"`.
4. `hard_gate_question_ids` ≥ 1; each cited `tests_behavior_id` resolves to a
   real behavior whose `where` is printed on that question's card.
5. Every question carries `excerpt` + `section_anchor` + `reinforce`.
6. No pure-recall / diff-log-restatement questions.

## 5. Data flow (single chain)

```
1. daemon: complexity gate passes
2. daemon: mint token (local random, 32 bytes URL-safe)
3. daemon: inject into review prompt:
     "This PR is complex. Generate a self-check quiz to
      review_logs/quiz_<pr>.json per §4 schema + self-check.
      Quiz page URL: <site>/#/pr/<repo>/<pr>?t=<token>.
      Include the URL in the summary comment ONLY if quiz JSON is written
      and passes self-check; otherwise omit (no dead URL)."
4. claude -p review: analyze (using already-loaded diff + CRG impact + biz KB)
   → write quiz_<pr>.json + self-check → on success include URL in summary
5. daemon post-review:
   - if quiz_<pr>.json exists + valid:
       copy to <site_local_clone>/data/<repo>/<pr>-<sha7>.json
       git add/commit/push (live on Pages)
       POST /admin/quiz {repo,pr,head_sha,author,token,quiz_data_url}
   - else: no-op (review did not post a URL)
6. dev opens URL → SPA reads token from fragment → GET /api/quiz?t=<token>
   → {quiz_data_url, has_result} → loads the static JSON from quiz_data_url
   → if has_result, mount locked post-submit state; else answer (one-shot
   locked) → POST /api/submit {token, gitcode_username, answers, score, missed}
7. committer opens #/dashboard → GET /admin/results → sees score + missed
   behaviors (file:line) for the version matching the PR's current head
   → merges or not in GitCode
```

## 6. Complexity gate (daemon, before invoking review)

```yaml
quiz:
  enabled: true
  site_repo: c8x1/code-review-check
  site_local_clone: ~/.claude/skills/gitcode-review/code-review-check-worktree
  worker_url: https://crc-worker.<subdomain>.workers.dev
  committer_token: "<random secret>"   # also a Worker secret
  complexity:
    min_net_changed_lines: 30
    min_non_test_files: 3
    logic_paths: ["services/", "frameworks/"]
    skip_path_suffixes: ["_test/", "test/", "__test__/", ".gni", "BUILD.gn", "README"]
```

A PR is "complex" iff it touches a `logic_paths` entry AND is not entirely
`skip_path_suffixes` AND (`net changed lines ≥ min_net_changed_lines` OR
`non-test files ≥ min_non_test_files`). The gate runs in daemon Python; the
result is passed into the review prompt so the reviewer knows whether to
produce a quiz.

**Re-review**: the daemon already re-reviews a PR when the author pushes new
commits (max 3). A re-review produces a **new quiz for the new `head_sha`** —
a new quiz version. Quiz records and results are therefore keyed by
`(repo, pr, head_sha)`, not just `(repo, pr)`. The dev re-takes for the new
version; the old version's recorded result stands untouched. The dashboard
shows the result for the version matching the PR's current head, with older
versions folded away as history.

## 7. Cloudflare Worker + D1

```sql
CREATE TABLE quizzes(
  repo TEXT, pr INTEGER, head_sha TEXT, author TEXT,
  quiz_data_url TEXT, token TEXT UNIQUE, created_at TEXT,
  PRIMARY KEY(repo, pr, head_sha));

CREATE TABLE results(
  repo TEXT, pr INTEGER, head_sha TEXT, gitcode_username TEXT,
  score REAL, answered INTEGER, total INTEGER,
  missed_behavior_ids TEXT,   -- JSON array, e.g. ["b1","b3"]
  missed_question_ids TEXT,   -- JSON array
  submitted_at TEXT,
  PRIMARY KEY(repo, pr, head_sha));  -- DB-level one-shot lock per quiz version
```

Data file path includes the short sha so each version is preserved:
`data/<repo>/<pr>-<sha7>.json` (e.g. `data/openharmony%2Fmultimedia_audio_framework/16401-abc1234.json`).

| Endpoint | Auth | Behavior |
|---|---|---|
| `POST /admin/quiz` | committer_token (header) | daemon registers quiz + token. Idempotent by `(repo,pr,head_sha)`: re-registration of the same sha keeps the existing token; a new sha (re-review) creates a new row + the daemon mints a new token locally. |
| `POST /api/submit` | token + gitcode_username | validate token in `quizzes` (gets repo/pr/head_sha/author) → assert `gitcode_username == quizzes.author` (403 if not) → INSERT into `results` keyed by `(repo,pr,head_sha)`; PK conflict → 410 "already submitted, only first attempt per version is recorded". Returns `{score, total, terminal, missed_behaviors}`. |
| `GET /api/quiz?t=<token>` | public | resolves token → quiz record; returns `{quiz_data_url, has_result, head_sha}` so the SPA can load the static JSON and lock the UI if already submitted for this version. Unknown token → 404. |
| `GET /admin/results` | committer_token | dashboard: list of all quiz versions with their result (if any); client groups by (repo,pr) and surfaces the version matching the current head. |

CORS: `Access-Control-Allow-Origin: *` for `/api/*`; `/admin/*` restricted to
requests bearing the committer_token. Quiz data is public (served by GitHub
Pages); results are the dev's own self-check — no sensitive data in the Worker.

## 8. SPA

One SPA, three routes (hash routing — token/committer_token stay in the
fragment, never sent to the Worker in a referrer):

| Route | Purpose |
|---|---|
| `#/pr/<repo>/<pr>?t=<token>` | dev self-check view |
| `#/pr/<repo>/<pr>` | read-only report (any visitor; submit disabled) |
| `#/dashboard?ct=<committer_token>` | committer view |

`repo` is URL-encoded (`openharmony%2Fmultimedia_audio_framework`).

**Quiz engine (one shared, implements the change-quiz contract)**:

- Render report: context / intuition / what_was_done / **non-obvious behavior
  cards** (What / Why / Where chip) / inherited_dependency callout. Each
  behavior has `id="behav-b1"` anchor.
- Render quiz: options as buttons. **Click locks that question**:
  - wrong → feedback block naming the correct option + the `excerpt` quote
    labeled "From the report: <section>" + a scroll-back anchor link to
    `section_anchor`.
  - correct → `reinforce` line.
- Live score box `Score: X/N · Y answered`, updated per answer; per-option
  coloring on click (incremental, not one-shot).
- Two terminal states when all answered: perfect → "Cleared to merge" +
  merge-readiness checklist; imperfect → "Not yet — re-read these sections"
  with **deduped** scroll-back links.
- Submit POSTs locked first answers. On mount, if `GET /api/quiz` reports
  `has_result`, mount directly into the locked post-submit state showing the
  recorded result (prevents re-answering).

**Dashboard (buy-in-doc influence)** — each PR card is evidence-grounded, not
"dev said they understood":

```
PR #16401 · multimedia_audio_framework · author: xiaokuerz · head_sha abc123
status: ✅ submitted   score: 4/5   generated: 2026-07-25 15:34

missed non-obvious behaviors (evidence):
  ⚠ b1 <what>  where: services/audio_policy/.../foo.cpp:142
  ⚠ b3 <what>  where: services/audio_service/.../bar.cpp:88

[→ open quiz page]   [→ open GitCode PR]
```

buy-in-doc's "demo-first" translates to: the score + missed-behavior file:line
are the first thing the committer sees, before any prose.

## 9. Failure modes

- **Review produces no quiz JSON** → no URL in the summary, no Worker call, no
  dead link.
- **Quiz JSON fails self-check** → reviewer treats as "not produced"; same as
  above.
- **dev never takes the quiz** → dashboard shows "not attempted"; committer
  decides whether to block merge.
- **Token leaked + username check gamed** → accepted risk (internal tool);
  committer can cross-check submission timestamp / ask the dev.
- **GitHub Pages JSON 404 at submit time** → SPA shows "quiz data not yet
  published, retry shortly"; daemon push and Worker registration are
  sequential so this window is small.
- **Concurrent first-submits** → D1 `results` PK rejects the second; second
  caller gets 410.

## 10. Testing

- **Quiz engine unit**: answer-locking, wrong-answer feedback (excerpt +
  anchor), live score, both terminal states.
- **Worker**: `wrangler` local D1 — submit twice for the same PR, assert the
  second returns 410 and only one `results` row exists; assert username
  mismatch returns 403; assert unknown token 404s.
- **Daemon complexity gate**: unit-test the gate with synthetic PR file lists
  (UT-only → skip; logic + ≥30 lines → quiz).
- **End-to-end**: one real complex PR → quiz generated, pushed, registered,
  dev URL opens, submit, dashboard shows result.

## 11. Files to change

- `~/.claude/skills/gitcode-review/SKILL.md` — add `Step 2.5: generate
  self-check quiz (complex PRs)` with §4 schema + self-check + "write JSON
  before URL" rule.
- `~/.claude/skills/gitcode-review/scripts/review_daemon.py` — complexity
  gate, token mint, prompt injection, post-review push + Worker POST.
- `~/.claude/skills/gitcode-review/scripts/config.yaml` — `quiz:` block (§6).
- `c8x1/code-review-check` repo — SPA (`index.html` + assets), `data/` dir,
  `docs/superpowers/specs/` (this doc).
- Cloudflare Worker — `worker/` (new), D1 schema migration.
