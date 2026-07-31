export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function renderReport(root, data) {
  const r = data.report;
  root.innerHTML = `
    <h1>自查 · ${escapeHtml(data.repo)} #${data.pr_number}</h1>
    <section class="card"><h2>背景</h2><p>${escapeHtml(r.context)}</p></section>
    <section class="card"><h2>直觉</h2><p>${escapeHtml(r.intuition)}</p></section>
    <section class="card"><h2>改了什么</h2><p>${escapeHtml(r.what_was_done)}</p></section>
    <section><h2>本改动引入的非显然行为</h2>${(r.non_obvious_behaviors || []).map((b) => `
      <div class="card behavior" id="behav-${escapeHtml(b.id)}">
        <div class="what">${escapeHtml(b.id)}: ${escapeHtml(b.what)}</div>
        <div class="why">${escapeHtml(b.why)}</div>
        <div>where: <span class="where">${escapeHtml(b.where)}</span></div>
      </div>`).join("")}</section>
    <section class="card landmine"><h2>依赖的既有行为</h2>
      <p>${escapeHtml(r.inherited_dependency.what)}</p>
      <div>where: <span class="where">${escapeHtml(r.inherited_dependency.where)}</span></div>
    </section>`;
}
