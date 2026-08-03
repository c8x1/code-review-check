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
      // read-only preview: explicit ?d= path, else sample
      const dpath = params.get("d");
      data = await loadQuizData(dpath ? decodeURIComponent(dpath) : `data/sample/${pr}-abc1234.json`);
    }
    if (!data) { root.innerHTML = `<main><p>quiz 数据未就绪。</p></main>`; return; }
    const main = document.createElement("main");
    root.appendChild(main);
    const host = document.createElement("div");
    main.appendChild(host);

    if (alreadySubmitted) {
      host.innerHTML = `<div class="q"><div class="verdict no">该版本已提交,只记首交。结果见 dashboard。</div></div>`;
    } else if (!token) {
      renderQuiz(host, data, {
        token: null,
        onSubmit: async () => ({ status: 201 }),  // read-only: submit = client-side reveal
      });
    } else {
      renderQuiz(host, data, {
        token,
        onSubmit: async (payload) => {
          const res = await submitQuiz(payload.token, payload.gitcode_username, payload);
          return { status: res.status, body: res.body };
        },
      });
    }
    return;
  }
  root.innerHTML = `<main><h1>code-review-check</h1><p>自查站点。请从 GitCode PR 评论中的链接进入。</p></main>`;
}

addEventListener("hashchange", route);
addEventListener("DOMContentLoaded", route);
