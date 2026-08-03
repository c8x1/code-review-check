// Pure grading logic — unit-tested in grade.test.js.
export function gradeQuiz(questions, answers) {
  let score = 0;
  const missed_questions = [];
  for (const q of questions) {
    if (answers[q.id] === q.correct_option) {
      score++;
    } else {
      missed_questions.push(q.id);
    }
  }
  const total = questions.length;
  return {
    score,
    total,
    missed_questions,
    terminal: score === total ? "cleared" : "re-read",
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function scrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Editor-dark, code-first. One compact block per question.
export function renderQuiz(container, data, { token, onSubmit }) {
  const qs = data.questions;
  const answers = {};
  let answered = 0;

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  const repoShort = (data.repo || "").split("/").pop();
  topbar.innerHTML =
    `<span class="tb-left">${escapeHtml(repoShort)} #${escapeHtml(String(data.pr_number))} · ${escapeHtml(data.author || "")}</span>` +
    `<span class="tb-score" id="scorebox">Score: 0 / ${qs.length} · 0 answered</span>`;
  container.appendChild(topbar);

  for (const q of qs) {
    const block = document.createElement("section");
    block.className = "q";
    block.id = `q-${q.id}`;

    const label = document.createElement("div");
    label.className = "qlabel";
    label.textContent = `${q.id}  ${q.file}:${q.lines}`;
    block.appendChild(label);

    if (q.code) {
      const pre = document.createElement("pre");
      pre.className = "code";
      pre.id = `qcode-${q.id}`;
      const code = document.createElement("code");
      code.textContent = q.code;
      pre.appendChild(code);
      block.appendChild(pre);
    }

    const prompt = document.createElement("div");
    prompt.className = "prompt";
    prompt.textContent = q.prompt;
    block.appendChild(prompt);

    const opts = document.createElement("div");
    opts.className = "opts";
    block.appendChild(opts);
    for (const opt of q.options) {
      const btn = document.createElement("button");
      btn.className = "opt";
      btn.textContent = opt.text;
      btn.dataset.opt = opt.id;
      btn.addEventListener("click", () => {
        if (block.dataset.locked) return;
        block.dataset.locked = "1";
        const correct = opt.id === q.correct_option;
        btn.classList.add(correct ? "correct" : "wrong");
        if (!correct) {
          const c = block.querySelector(`button[data-opt="${q.correct_option}"]`);
          if (c) c.classList.add("correct");
        }
        answers[q.id] = opt.id;
        answered++;
        const fb = document.createElement("div");
        fb.className = "feedback";
        if (correct) {
          fb.textContent = q.reinforce || "正确。";
        } else {
          const back = document.createElement("a");
          back.href = "javascript:void(0)";
          back.textContent = "↺ 回看代码";
          back.className = "back";
          back.addEventListener("click", (e) => { e.preventDefault(); scrollTo(`qcode-${q.id}`); });
          fb.innerHTML = `<span class="why">正确项:${q.correct_option}。${escapeHtml(q.explanation || "")}</span> `;
          fb.appendChild(back);
        }
        block.appendChild(fb);
        const g = gradeQuiz(qs, answers);
        document.getElementById("scorebox").textContent =
          `Score: ${g.score} / ${qs.length} · ${answered} answered`;
        if (answered === qs.length) renderTerminal(container, qs, answers, onSubmit, token);
      });
      opts.appendChild(btn);
    }
    container.appendChild(block);
  }
}

function renderTerminal(container, qs, answers, onSubmit, token) {
  const g = gradeQuiz(qs, answers);
  const card = document.createElement("section");
  card.className = "q terminal";
  if (g.terminal === "cleared") {
    card.innerHTML = `<div class="verdict ok">✅ Cleared to merge · ${g.score}/${g.total}</div>`;
  } else {
    const missed = [...new Set(g.missed_questions)];
    card.innerHTML =
      `<div class="verdict no">⚠️ Not yet · ${g.score}/${g.total}</div>` +
      `<div class="missed">re-read: ${missed.map((id) => `<a href="javascript:void(0)" data-q="${id}">${id}</a>`).join(" · ")}</div>`;
    card.querySelectorAll("a[data-q]").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); scrollTo(`q-${a.dataset.q}`); }));
  }
  // Per-question result chips (the "summary figure") + a copy-as-PR-comment button.
  const chips = document.createElement("div");
  chips.className = "chips";
  chips.innerHTML = qs.map((q) => {
    const ok = answers[q.id] === q.correct_option;
    return `<span class="chip ${ok ? "ok" : "no"}" title="${q.id} ${q.file}:${q.lines}">${q.id} ${ok ? "✓" : "✗"}</span>`;
  }).join("");
  card.appendChild(chips);

  const copy = document.createElement("button");
  copy.className = "opt copy";
  copy.textContent = "复制为 PR 评论";
  copy.addEventListener("click", () => {
    const md = buildPrComment(data, qs, answers, g);
    navigator.clipboard.writeText(md).then(
      () => { copy.textContent = "已复制 ✓"; setTimeout(() => (copy.textContent = "复制为 PR 评论"), 1800); },
      () => alert("复制失败,请手动选择下方文本。"));
  });
  card.appendChild(copy);

  const submit = document.createElement("button");
  submit.className = "opt submit";
  submit.textContent = "提交结果(只记首交)";
  submit.addEventListener("click", () => {
    const gitcode_username = prompt("请输入你的 GitCode 账号名(须与 PR 作者一致):");
    if (!gitcode_username) return;
    onSubmit({
      token,
      gitcode_username,
      answers,
      score: g.score,
      answered: Object.keys(answers).length,
      total: g.total,
      missed_behavior_ids: [],
      missed_question_ids: g.missed_questions,
    });
  });
  card.appendChild(submit);
  container.appendChild(card);
}

function buildPrComment(data, qs, answers, g) {
  const verdict = g.terminal === "cleared" ? "✅ 通过" : "⚠️ 未全对";
  const rows = qs.map((q) => {
    const ok = answers[q.id] === q.correct_option;
    const file = (q.file || "").split("/").pop();
    return `| ${q.id} | \`${file}:${q.lines}\` | ${ok ? "✅" : "❌"} |`;
  }).join("\n");
  return [
    `## 📋 自查 quiz 结果 · ${data.repo}#${data.pr_number}`,
    ``,
    `**分数: ${g.score}/${g.total}** · ${verdict}`,
    ``,
    `| # | 位置 | 结果 |`,
    `|---|---|---|`,
    rows,
    ``,
    `> 由 code-review-check 生成 · ${location.href}`,
  ].join("\n");
}
