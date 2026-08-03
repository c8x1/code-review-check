import { getResults } from "./api.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export async function renderDashboard(root, committer_token) {
  const rows = await getResults(committer_token);
  if (!rows.length) {
    root.innerHTML = `<main><h1>Committer 自查结果</h1><p>暂无 quiz 记录。</p></main>`;
    return;
  }
  const cards = rows
    .map(({ quiz, result }) => {
      const missed = result ? safeParse(result.missed_question_ids) : [];
      const status = result
        ? `✅ ${result.score}/${result.total}`
        : "⏳ 未自查";
      const missedHtml = result && missed.length
        ? `<div class="missed">错题: ${missed.map((id) => escapeHtml(id)).join(" · ")}</div>`
        : "";
      const prUrl = `https://gitcode.com/${quiz.repo}/pull/${quiz.pr}`;
      return `<section class="q">
        <div class="qlabel">#${quiz.pr} · ${escapeHtml(quiz.repo)} · ${escapeHtml(quiz.author)} · head ${escapeHtml(quiz.head_sha.slice(0, 7))}</div>
        <div class="status">${status} · 生成 ${escapeHtml(quiz.created_at)}</div>
        ${missedHtml}
        <div class="links"><a href="#/pr/${encodeURIComponent(quiz.repo)}/${quiz.pr}?t=${encodeURIComponent(quiz.token)}">→ quiz 页</a> · <a href="${prUrl}" target="_blank">→ GitCode PR</a></div>
      </section>`;
    })
    .join("");
  root.innerHTML = `<main><h1>Committer 自查结果</h1>${cards}</main>`;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}
