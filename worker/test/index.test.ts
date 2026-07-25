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
