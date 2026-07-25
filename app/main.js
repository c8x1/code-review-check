import { renderReport } from "./report.js";
import { loadQuizData, getQuizByToken } from "./api.js";

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
  if (seg[0] === "pr" && seg[1] && seg[2]) {
    const repo = decodeURIComponent(seg[1]);
    const pr = seg[2];
    const token = params.get("t");
    let data;
    if (token) {
      const meta = await getQuizByToken(token);
      if (!meta) { root.innerHTML = `<main><p>链接无效或已过期。</p></main>`; return; }
      data = await loadQuizData(meta.quiz_data_url);
    } else {
      // read-only fallback to sample data (relative so it works locally and on Pages)
      data = await loadQuizData(`data/sample/${pr}-abc1234.json`);
    }
    if (!data) { root.innerHTML = `<main><p>quiz 数据未就绪。</p></main>`; return; }
    const main = document.createElement("main");
    root.appendChild(main);
    renderReport(main, data);
    const quizHost = document.createElement("div");
    quizHost.id = "quiz-host";
    main.appendChild(quizHost); // quiz engine mounts here in Task 4
    return;
  }
  root.innerHTML = `<main><h1>code-review-check</h1><p>自查站点。请从 GitCode PR 评论中的链接进入。</p></main>`;
}

addEventListener("hashchange", route);
addEventListener("DOMContentLoaded", route);
