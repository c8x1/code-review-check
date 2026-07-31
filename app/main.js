import { renderReport } from "./report.js";
import { loadQuizData, getQuizByToken, submitQuiz } from "./api.js";
import { renderQuiz } from "./quiz-engine.js";

const root = document.getElementById("app");

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [path, qs] = hash.split("?");
  const seg = path.split("/").filter(Boolean);
  const params = new URLSearchParams(qs || "");
  return { seg, params };
}

async function route() {
  const { seg, params } = parseRoute();
  root.innerHTML = "";
  if (seg[0] === "dashboard") {
    const ct = params.get("ct");
    if (!ct) { root.innerHTML = `<main><p>需要 committer token。</p></main>`; return; }
    const { renderDashboard } = await import("./dashboard.js");
    await renderDashboard(root, ct);
    return;
  }
  if (seg[0] === "pr" && seg[1] && seg[2]) {
    const repo = decodeURIComponent(seg[1]);
    const pr = seg[2];
    const token = params.get("t");
    let data;
    let alreadySubmitted = false;
    if (token) {
      const meta = await getQuizByToken(token);
      if (!meta) { root.innerHTML = `<main><p>链接无效或已过期。</p></main>`; return; }
      alreadySubmitted = !!meta.has_result;
      data = await loadQuizData(meta.quiz_data_url);
    } else {
      // read-only: explicit data path (?d=...) for preview without the Worker,
      // else fall back to sample data (relative so it works locally and on Pages)
      const dpath = params.get("d");
      data = await loadQuizData(dpath ? decodeURIComponent(dpath) : `data/sample/${pr}-abc1234.json`);
    }
    if (!data) { root.innerHTML = `<main><p>quiz 数据未就绪。</p></main>`; return; }
    const main = document.createElement("main");
    root.appendChild(main);
    renderReport(main, data);
    const quizHost = document.createElement("div");
    quizHost.id = "quiz-host";
    main.appendChild(quizHost);

    if (alreadySubmitted) {
      quizHost.innerHTML = `<section class="card"><p>该版本已提交,只记首交。结果见 dashboard。</p></section>`;
    } else if (!token) {
      // read-only: render the quiz for browsing but disable submit (no token)
      renderQuiz(quizHost, data, {
        token: null,
        onSubmit: () => alert("只读视图:无法提交。请从 GitCode PR 评论中的链接进入。"),
      });
    } else {
      renderQuiz(quizHost, data, {
        token,
        onSubmit: async (payload) => {
          const res = await submitQuiz(payload.token, payload.gitcode_username, payload);
          if (res.status === 201) {
            alert(`已记录: ${res.body.score}/${res.body.total} (${res.body.terminal})`);
          } else if (res.status === 410) {
            alert("已提交过,只记首交。");
          } else if (res.status === 403) {
            alert("账号名与 PR 作者不一致。");
          } else {
            alert("提交失败:" + (typeof res.body === "string" ? res.body : JSON.stringify(res.body)));
          }
        },
      });
    }
    return;
  }
  root.innerHTML = `<main><h1>code-review-check</h1><p>自查站点。请从 GitCode PR 评论中的链接进入。</p></main>`;
}

addEventListener("hashchange", route);
addEventListener("DOMContentLoaded", route);

