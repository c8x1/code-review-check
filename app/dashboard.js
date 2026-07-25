import { getResults } from "./api.js";
import { escapeHtml } from "./report.js";

export async function renderDashboard(root, committer_token) {
  const rows = await getResults(committer_token);
  if (!rows.length) {
    root.innerHTML = `<main><h1>Committer 自查结果</h1><p>暂无 quiz 记录。</p></main>`;
    return;
  }
  const cards = rows
    .map(({ quiz, result }) => {
      const missed = result ? safeParse(result.missed_behavior_ids) : [];
      const status = result
        ? `✅ 已提交 ${result.score}/${result.total}`
        : "⏳ 未自查";
      const missedHtml =
        result && missed.length
          ? `<div>错过的 non-obvious behavior(证据):<ul>${missed
              .map(
                (id) =>
                  `<li>${escapeHtml(id)} <a href="#/pr/${encodeURIComponent(
                    quiz.repo
                  )}/${quiz.pr}?t=${encodeURIComponent(quiz.token)}">见 quiz 页</a></li>`
              )
              .join("")}</ul></div>`
          : "";
      const prUrl = `https://gitcode.com/${quiz.repo}/pull/${quiz.pr}`;
      return `<section class="card">
        <h3>#${quiz.pr} · ${escapeHtml(quiz.repo)} · author: ${escapeHtml(
          quiz.author
        )} · head ${escapeHtml(quiz.head_sha.slice(0, 7))}</h3>
        <div>状态: ${status} · 生成 ${escapeHtml(quiz.created_at)}</div>
        ${missedHtml}
        <div><a href="#/pr/${encodeURIComponent(quiz.repo)}/${quiz.pr}?t=${encodeURIComponent(
          quiz.token
        )}">→ 打开 quiz 页</a> · <a href="${prUrl}" target="_blank">→ GitCode PR</a></div>
      </section>`;
    })
    .join("");
  root.innerHTML = `<main><h1>Committer 自查结果</h1>${cards}</main>`;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}
