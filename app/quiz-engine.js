// Pure grading logic — unit-tested in grade.test.js. Returns the Worker body
// field names directly (missed_questions, missed_behaviors) — the terminal
// state maps them to the Worker's `missed_question_ids` / `missed_behavior_ids`.
export function gradeQuiz(questions, answers) {
  let score = 0;
  const missed_questions = [];
  const missed_behaviors = [];
  for (const q of questions) {
    if (answers[q.id] === q.correct_option) {
      score++;
    } else {
      missed_questions.push(q.id);
      if (q.tests_behavior_id) missed_behaviors.push(q.tests_behavior_id);
    }
  }
  const total = questions.length;
  return {
    score,
    total,
    missed_questions,
    missed_behaviors,
    terminal: score === total ? "cleared" : "re-read",
  };
}

// DOM-bound interaction. One shared engine for all quizzes; implements the
// change-quiz contract: lock-on-click, wrong-answer excerpt + scroll-back
// anchor, live score box, two terminal states.
//
// Note: section anchors ("#behav-b2") are NOT used as <a href> — they would
// collide with this SPA's hash router (#/pr/...). We scroll via
// scrollIntoView on the element whose id is the anchor without the "#".
function scrollToAnchor(anchor) {
  const id = anchor.replace(/^#/, "");
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
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
    const block = document.createElement("section");
    block.className = "card";
    block.innerHTML = `<h3>${q.prompt}</h3>`;
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
          const correctBtn = block.querySelector(`button[data-opt="${q.correct_option}"]`);
          if (correctBtn) correctBtn.classList.add("correct");
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
          back.textContent = "回看";
          back.addEventListener("click", (e) => { e.preventDefault(); scrollToAnchor(q.section_anchor); });
          const label = document.createElement("span");
          label.innerHTML = `正确项:${q.correct_option}。 <em>From the report:</em> ${q.excerpt} `;
          fb.appendChild(label);
          fb.appendChild(back);
        }
        block.appendChild(fb);
        const g = gradeQuiz(qs, answers);
        scorebox.textContent = `Score: ${g.score} / ${qs.length} · ${answered} answered`;
        if (answered === qs.length) renderTerminal(container, qs, answers, onSubmit, token);
      });
      block.appendChild(btn);
    }
    container.appendChild(block);
  }
}

function renderTerminal(container, qs, answers, onSubmit, token) {
  const g = gradeQuiz(qs, answers);
  const card = document.createElement("section");
  card.className = "card";
  if (g.terminal === "cleared") {
    card.innerHTML = `<h2>✅ Cleared to merge</h2>
      <ul><li>CI 绿</li><li>dev 自查通过 (${g.score}/${g.total})</li><li>head_sha 与最新一致</li></ul>`;
  } else {
    // dedup missed questions by their section anchor
    const anchors = [...new Set(qs.filter(q => g.missed_questions.includes(q.id)).map(q => q.section_anchor))];
    const list = document.createElement("div");
    list.innerHTML = `<h2>⚠️ Not yet — re-read these sections</h2>`;
    for (const a of anchors) {
      const link = document.createElement("a");
      link.href = "javascript:void(0)";
      link.textContent = a;
      link.style.display = "block";
      link.addEventListener("click", (e) => { e.preventDefault(); scrollToAnchor(a); });
      list.appendChild(link);
    }
    card.appendChild(list);
  }
  const submit = document.createElement("button");
  submit.className = "opt";
  submit.textContent = "提交结果(只记首交)";
  submit.addEventListener("click", () => {
    const gitcode_username = prompt("请输入你的 GitCode 账号名(须与 PR 作者一致):");
    if (!gitcode_username) return;
    // map gradeQuiz field names -> Worker body field names
    onSubmit({
      token,
      gitcode_username,
      answers,
      score: g.score,
      answered: Object.keys(answers).length,
      total: g.total,
      missed_behavior_ids: g.missed_behaviors,
      missed_question_ids: g.missed_questions,
    });
  });
  card.appendChild(submit);
  container.appendChild(card);
}
