# Deployment & e2e Runbook

The code is complete and all tests pass (Worker 9, SPA 3, daemon complexity 6,
daemon publish 7). The remaining steps need **your** Cloudflare account and a
live PR — Claude cannot authenticate to Cloudflare and must not post to real
GitCode PRs without your consent.

## 1. Create the D1 database + apply schema

```bash
cd /Users/noctis/Workspace/code-review-check/worker
npx wrangler login                                   # one-time, your Cloudflare account
npx wrangler d1 create code-review-check             # copy the printed database_id
npx wrangler d1 execute code-review-check --remote --file=migrations/0001_init.sql
```

Paste the `database_id` into `wrangler.toml` (replace `REPLACE_WITH_D1_ID`).

## 2. Set the committer token secret + deploy the Worker

```bash
COMMITTER_TOKEN=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')
echo "$COMMITTER_TOKEN" | npx wrangler secret put COMMITTER_TOKEN
npx wrangler deploy
# note the deployed URL, e.g. https://code-review-check.<sub>.workers.dev
```

Save `$COMMITTER_TOKEN` somewhere private — it's the committer dashboard +
daemon admin credential.

## 3. Wire the real URL + token into the code

- `app/api.js`: set `WORKER_URL` to the deployed URL.
- `scripts/config.yaml`:
  - `worker_url`: the deployed URL
  - `committer_token`: `$COMMITTER_TOKEN` (or `export CRC_COMMITTER_TOKEN=…` in the daemon's env)
  - set `quiz.enabled: true`

Seed the daemon's site clone:

```bash
git clone https://github.com/c8x1/code-review-check \
  ~/.claude/skills/gitcode-review/code-review-check-worktree
```

## 4. Verify the Worker live

```bash
W=https://code-review-check.<sub>.workers.dev
curl -s "$W/api/quiz?t=nope"                     # -> {"error":"unknown token"} 404
curl -s -X POST "$W/admin/quiz" -H "Authorization: Bearer $COMMITTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repo":"o/r","pr":1,"head_sha":"aaa","author":"alice","token":"tok-live","quiz_data_url":"https://example/data.json"}'
curl -s "$W/api/quiz?t=tok-live"                 # -> {quiz_data_url, has_result:false, head_sha:"aaa"}
```

## 5. End-to-end against one real complex PR

```bash
cd ~/.claude/skills/gitcode-review/scripts
python3 review_daemon.py --once
```

Watch the daemon log for, on a complex PR from a watched author:

1. complexity gate logs "complex"
2. the review prompt contains the `[复杂 PR]` injection with the quiz URL
3. after review, `publish_quiz` logs `registered quiz with worker (HTTP 201) -> …`
4. the GitCode PR summary comment includes the quiz URL

Then as the dev: open the quiz URL, enter the author's GitCode login, take the
quiz, submit → expect `201 {score, total, terminal, missed_behaviors}`; a
second submit returns `410`.

Then as committer: open
`https://c8x1.github.io/code-review-check/#/dashboard?ct=<COMMITTER_TOKEN>` →
expect a card for that PR with the dev's score + missed behavior ids.

> ⚠️ `--once` posts real review comments to a real GitCode PR as "Noc".
> Confirm before running it on a PR you don't own.
