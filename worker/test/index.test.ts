import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore } from "./in-memory";
import { handleRequest } from "../src/index";

const CT = "test-committer";

function makeStore() {
  return new InMemoryStore();
}
function post(path: string, body: unknown, token?: string): Request {
  return new Request(`https://x${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
function get(path: string): Request {
  return new Request(`https://x${path}`);
}

describe("register + lookup", () => {
  let store: InMemoryStore;
  beforeEach(() => { store = makeStore(); });

  it("registers a quiz and looks it up by token", async () => {
    const res = await handleRequest(
      post("/admin/quiz", {
        repo: "o/r", pr: 1, head_sha: "aaa", author: "alice",
        token: "tok1", quiz_data_url: "https://pages/data/1-aaa.json",
      }, CT),
      store, { COMMITTER_TOKEN: CT }
    );
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.token).toBe("tok1");

    const g = await handleRequest(get("/api/quiz?t=tok1"), store, { COMMITTER_TOKEN: CT });
    expect(g.status).toBe(200);
    const gj = await g.json();
    expect(gj.quiz_data_url).toBe("https://pages/data/1-aaa.json");
    expect(gj.has_result).toBe(false);
    expect(gj.head_sha).toBe("aaa");
  });

  it("rejects /admin without committer token", async () => {
    const res = await handleRequest(post("/admin/quiz", {}, ""), store, { COMMITTER_TOKEN: CT });
    expect(res.status).toBe(401);
  });

  it("re-registering the same token returns the existing record (not 201)", async () => {
    await handleRequest(
      post("/admin/quiz", {
        repo: "o/r", pr: 1, head_sha: "aaa", author: "alice",
        token: "tok1", quiz_data_url: "u1",
      }, CT),
      store, { COMMITTER_TOKEN: CT }
    );
    const res = await handleRequest(
      post("/admin/quiz", {
        repo: "o/r", pr: 1, head_sha: "aaa", author: "alice",
        token: "tok1", quiz_data_url: "u1",
      }, CT),
      store, { COMMITTER_TOKEN: CT }
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 for unknown token", async () => {
    const res = await handleRequest(get("/api/quiz?t=nope"), store, { COMMITTER_TOKEN: CT });
    expect(res.status).toBe(404);
  });

  it("returns 400 when token param missing", async () => {
    const res = await handleRequest(get("/api/quiz"), store, { COMMITTER_TOKEN: CT });
    expect(res.status).toBe(400);
  });
});

describe("submit + results", () => {
  let store: InMemoryStore;
  beforeEach(async () => {
    store = makeStore();
    await handleRequest(
      post("/admin/quiz", {
        repo: "o/r", pr: 1, head_sha: "aaa", author: "alice",
        token: "tok1", quiz_data_url: "u1",
      }, CT),
      store, { COMMITTER_TOKEN: CT }
    );
  });

  it("records a first submission and locks a second (410)", async () => {
    const body = {
      token: "tok1", gitcode_username: "alice", answers: { q1: "b" },
      score: 1, answered: 1, total: 1, missed_behavior_ids: [], missed_question_ids: [],
    };
    const r1 = await handleRequest(post("/api/submit", body), store, { COMMITTER_TOKEN: CT });
    expect(r1.status).toBe(201);
    const j1 = await r1.json();
    expect(j1.score).toBe(1);
    expect(j1.terminal).toBe("cleared");

    const r2 = await handleRequest(post("/api/submit", body), store, { COMMITTER_TOKEN: CT });
    expect(r2.status).toBe(410);
  });

  it("rejects submit when gitcode_username != author (403)", async () => {
    const body = {
      token: "tok1", gitcode_username: "mallory", answers: {},
      score: 0, answered: 0, total: 1, missed_behavior_ids: ["b1"], missed_question_ids: ["q1"],
    };
    const r = await handleRequest(post("/api/submit", body), store, { COMMITTER_TOKEN: CT });
    expect(r.status).toBe(403);
  });

  it("returns 404 when token unknown", async () => {
    const r = await handleRequest(
      post("/api/submit", { token: "nope", gitcode_username: "alice", answers: {},
        score: 0, answered: 0, total: 1, missed_behavior_ids: [], missed_question_ids: [] }),
      store, { COMMITTER_TOKEN: CT }
    );
    expect(r.status).toBe(404);
  });

  it("GET /admin/results returns the quiz with its result, guarded by token", async () => {
    await handleRequest(
      post("/api/submit", {
        token: "tok1", gitcode_username: "alice", answers: { q1: "x" },
        score: 0, answered: 1, total: 1, missed_behavior_ids: ["b1"], missed_question_ids: ["q1"],
      }),
      store, { COMMITTER_TOKEN: CT }
    );
    const unauth = await handleRequest(get("/admin/results"), store, { COMMITTER_TOKEN: CT });
    expect(unauth.status).toBe(401);

    const r = await handleRequest(
      new Request("https://x/admin/results", { headers: { Authorization: `Bearer ${CT}` } }),
      store, { COMMITTER_TOKEN: CT }
    );
    expect(r.status).toBe(200);
    const arr = await r.json();
    expect(arr.length).toBe(1);
    expect(arr[0].result.gitcode_username).toBe("alice");
    expect(arr[0].result.missed_behavior_ids).toBe('["b1"]');
    expect(arr[0].quiz.repo).toBe("o/r");
  });
});
