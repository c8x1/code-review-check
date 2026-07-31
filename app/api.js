// Worker URL is set in Task 9 (Cloudflare deploy). Leave as a placeholder
// for local dev; the read-only route does not call the Worker.
const WORKER_URL = "https://code-review-check.WORKER_SUBDOMAIN.workers.dev";

export async function getQuizByToken(token) {
  try {
    const r = await fetch(`${WORKER_URL}/api/quiz?t=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export async function submitQuiz(token, gitcode_username, payload) {
  const r = await fetch(`${WORKER_URL}/api/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, gitcode_username, ...payload }),
  });
  let body;
  try { body = r.ok ? await r.json() : await r.json(); } catch { body = await r.text(); }
  return { status: r.status, body };
}

export async function getResults(committer_token) {
  try {
    const r = await fetch(`${WORKER_URL}/admin/results`, { headers: { Authorization: `Bearer ${committer_token}` } });
    return r.ok ? r.json() : [];
  } catch { return []; }
}

export async function loadQuizData(quiz_data_url) {
  try {
    const r = await fetch(quiz_data_url, { cache: "no-cache" });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}
