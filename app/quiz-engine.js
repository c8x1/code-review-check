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

// Multi-color C/C++ syntax highlight (single-pass scanner, HTML-safe).
const _TK = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|(\b(?:void|if|else|return|true|false|auto|const|new|class|public|private|protected|virtual|override|static|namespace|using|template|typename|for|while|break|continue|switch|case|default|enum|struct|typedef|sizeof|nullptr)\b)|(\b(?:Hpae[A-Za-z]*|FadeOutState|FadeState|shared_ptr|make_shared|make_unique|unique_ptr|int32_t|uint32_t|int8_t|int|bool|size_t|float|double|char|std|void)\b)|(\b[A-Za-z_]\w*(?=\s*\())|(\b\d+\.?\d*f?\b)/g;
function highlight(code) {
  return code.split("\n").map((line) => {
    if (/^\s*$/.test(line)) return "";
    if (/^\s*\/\//.test(line)) return `<span class="cm">${escapeHtml(line)}</span>`;
    let out = "", last = 0, m;
    _TK.lastIndex = 0;
    while ((m = _TK.exec(line))) {
      if (m.index > last) out += escapeHtml(line.slice(last, m.index));
      const tok = escapeHtml(m[0]);
      const cls = m[1] ? "cm" : m[2] ? "st" : m[3] ? "kw" : m[4] ? "ty" : m[5] ? "fn" : m[6] ? "nm" : "";
      out += cls ? `<span class="${cls}">${tok}</span>` : tok;
      last = m.index + m[0].length;
      if (!m[0]) _TK.lastIndex++;
    }
    if (last < line.length) out += escapeHtml(line.slice(last));
    return out;
  }).join("\n");
}

function scrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Editor-dark, code-first. Answers are HIDDEN until the dev clicks 提交 —
// clicking an option only locks the choice (no correct/wrong reveal, no
// explanation), so the dev can't learn the right answers mid-quiz and
// refresh-re-try for a perfect score.
export function renderQuiz(container, data, { token, onSubmit }) {
  const qs = data.questions;
  const answers = {};
  let answered = 0;

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  const repoShort = (data.repo || "").split("/").pop();
  topbar.innerHTML =
    `<span class="tb-left">${escapeHtml(repoShort)} #${escapeHtml(String(data.pr_number))} · ${escapeHtml(data.author || "")}</span>` +
    `<span class="tb-score" id="scorebox">已答 0 / ${qs.length}</span>`;
  container.appendChild(topbar);

  const grid = document.createElement("div");
  grid.className = "qgrid";
  container.appendChild(grid);

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
      code.innerHTML = highlight(q.code);
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
      const ot = document.createElement("span");
      ot.className = "ot";
      ot.textContent = opt.text;
      btn.appendChild(ot);
      btn.dataset.opt = opt.id;
      btn.addEventListener("click", () => {
        if (block.dataset.locked) return;
        block.dataset.locked = "1";
        btn.classList.add("selected");
        answers[q.id] = opt.id;
        answered++;
        document.getElementById("scorebox").textContent = `已答 ${answered} / ${qs.length}`;
        if (answered === qs.length) {
          submitBtn.disabled = false;
          submitBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
      opts.appendChild(btn);
    }
    grid.appendChild(block);
  }

  // Submit footer (disabled until all answered). Reveal happens only after submit.
  const submitBtn = document.createElement("button");
  submitBtn.className = "opt submit";
  submitBtn.disabled = true;
  submitBtn.textContent = "提交并揭晓答案";
  const footer = document.createElement("section");
  footer.className = "q footer";
  footer.appendChild(submitBtn);
  grid.appendChild(footer);

  submitBtn.addEventListener("click", async () => {
    const g = gradeQuiz(qs, answers);
    const payload = {
      token,
      answers,
      score: g.score,
      answered: Object.keys(answers).length,
      total: g.total,
      missed_behavior_ids: [],
      missed_question_ids: g.missed_questions,
    };
    if (token) {
      const uname = prompt("请输入你的 GitCode 账号名(须与 PR 作者一致):");
      if (!uname) return;
      payload.gitcode_username = uname;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "提交中…";
    let res;
    try {
      res = await onSubmit(payload);
    } catch (e) {
      submitBtn.textContent = "提交失败,重试";
      submitBtn.disabled = false;
      alert("提交失败:" + e);
      return;
    }
    const status = res && res.status;
    if (status === 201 || status === 410 || !token) {
      reveal(qs, answers, g, data, footer, status === 410);
    } else if (status === 403) {
      submitBtn.textContent = "重新提交";
      submitBtn.disabled = false;
      alert("账号名与 PR 作者不一致。");
    } else {
      submitBtn.textContent = "重新提交";
      submitBtn.disabled = false;
      alert("提交失败:" + (typeof res.body === "string" ? res.body : JSON.stringify(res.body)));
    }
  });
}

function reveal(qs, answers, g, data, footer, alreadySubmitted) {
  // update scorebox to show the score
  document.getElementById("scorebox").textContent = `Score: ${g.score} / ${g.total} · ${g.total} answered`;

  // per-question: color correct/wrong + append feedback
  for (const q of qs) {
    const block = document.getElementById(`q-${q.id}`);
    const chosen = answers[q.id];
    const correct = chosen === q.correct_option;
    for (const opt of q.options) {
      const btn = block.querySelector(`button.opt[data-opt="${opt.id}"]`);
      if (!btn) continue;
      btn.classList.remove("selected");
      if (opt.id === q.correct_option) btn.classList.add("correct");
      else if (opt.id === chosen) btn.classList.add("wrong");
    }
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
  }

  // terminal card: verdict + chips + copy
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
  if (alreadySubmitted) {
    const note = document.createElement("div");
    note.className = "missed";
    note.textContent = "(该版本已提交过,只记首交。)";
    card.appendChild(note);
  }
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
    const done = () => { copy.textContent = "已复制 ✓"; setTimeout(() => (copy.textContent = "复制为 PR 评论"), 1800); };
    const fallback = () => {
      let box = card.querySelector("pre.copybox");
      if (!box) { box = document.createElement("pre"); box.className = "copybox"; card.appendChild(box); }
      box.textContent = md; box.hidden = false;
      const sel = window.getSelection(); const range = document.createRange();
      range.selectNodeContents(box); sel.removeAllRanges(); sel.addRange(range);
      copy.textContent = "已选中,按 Ctrl/Cmd+C 复制";
    };
    copyTextToClipboard(md, done, fallback);
  });
  card.appendChild(copy);
  footer.after(card);
}

function copyTextToClipboard(text, onOk, onFallback) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onOk, () => execCopy(text, onOk, onFallback));
  } else {
    execCopy(text, onOk, onFallback);
  }
}

function execCopy(text, onOk, onFallback) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy"); ta.remove();
    if (ok) onOk(); else onFallback();
  } catch (e) { onFallback(); }
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
