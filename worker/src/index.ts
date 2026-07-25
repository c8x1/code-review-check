import { D1Store, type QuizStore, type QuizRow } from "./store";

export interface Env {
  DB: D1Database;
  COMMITTER_TOKEN: string;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

export function guard(req: Request, env: { COMMITTER_TOKEN: string }): Response | null {
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${env.COMMITTER_TOKEN}`) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }
  return null;
}

export async function handleRequest(
  req: Request,
  store: QuizStore,
  env: { COMMITTER_TOKEN: string }
): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (url.pathname === "/api/quiz" && req.method === "GET") return await getQuiz(url, store);
    if (url.pathname === "/admin/quiz" && req.method === "POST") {
      const g = guard(req, env);
      if (g) return g;
      return await register(req, store);
    }
    return Response.json({ error: "not found" }, { status: 404, headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
}

async function getQuiz(url: URL, store: QuizStore): Promise<Response> {
  const token = url.searchParams.get("t");
  if (!token) return Response.json({ error: "missing token" }, { status: 400, headers: CORS });
  const q = await store.getQuizByToken(token);
  if (!q) return Response.json({ error: "unknown token" }, { status: 404, headers: CORS });
  const r = await store.getResult(q.repo, q.pr, q.head_sha);
  return Response.json(
    { quiz_data_url: q.quiz_data_url, has_result: r !== null, head_sha: q.head_sha },
    { headers: CORS }
  );
}

async function register(req: Request, store: QuizStore): Promise<Response> {
  const body = (await req.json()) as {
    repo: string; pr: number; head_sha: string; author: string;
    token: string; quiz_data_url: string;
  };
  // Idempotent fast path: same token already registered.
  const existing = await store.getQuizByToken(body.token);
  if (existing) {
    return Response.json({ token: existing.token, quiz_data_url: existing.quiz_data_url }, { headers: CORS });
  }
  const row: QuizRow = {
    repo: body.repo, pr: body.pr, head_sha: body.head_sha, author: body.author,
    quiz_data_url: body.quiz_data_url, token: body.token,
    created_at: new Date().toISOString(),
  };
  const out = await store.insertQuiz(row);
  if (out.conflict) {
    // Token collision (or a registration that landed between our pre-check and
    // insert). Resolve by reading the winner.
    const winner = await store.getQuizByToken(body.token);
    if (winner) {
      return Response.json({ token: winner.token, quiz_data_url: winner.quiz_data_url }, { headers: CORS });
    }
  }
  return Response.json({ token: row.token, quiz_data_url: row.quiz_data_url }, { status: 201, headers: CORS });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, new D1Store(env.DB), { COMMITTER_TOKEN: env.COMMITTER_TOKEN });
  },
};
