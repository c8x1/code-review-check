import type {
  QuizStore, QuizRow, ResultRow, InsertResultOutcome,
} from "../src/store";

/**
 * In-memory QuizStore for tests. Faithfully simulates the D1 uniqueness
 * constraints: a duplicate token on `insertQuiz` and a duplicate
 * (repo, pr, head_sha) on `insertResult` both return {conflict: true}.
 */
export class InMemoryStore implements QuizStore {
  private quizzes = new Map<string, QuizRow>();      // key = token
  private results = new Map<string, ResultRow>();    // key = repo/pr/head_sha

  async getQuizByToken(token: string): Promise<QuizRow | null> {
    return this.quizzes.get(token) ?? null;
  }

  async getResult(repo: string, pr: number, head_sha: string): Promise<ResultRow | null> {
    return this.results.get(this.rkey(repo, pr, head_sha)) ?? null;
  }

  async insertQuiz(q: QuizRow): Promise<InsertResultOutcome> {
    if (this.quizzes.has(q.token)) return { conflict: true };
    this.quizzes.set(q.token, q);
    return { conflict: false };
  }

  async insertResult(r: ResultRow): Promise<InsertResultOutcome> {
    const key = this.rkey(r.repo, r.pr, r.head_sha);
    if (this.results.has(key)) return { conflict: true };
    this.results.set(key, r);
    return { conflict: false };
  }

  async listAll(): Promise<{ quiz: QuizRow; result: ResultRow | null }[]> {
    const out: { quiz: QuizRow; result: ResultRow | null }[] = [];
    const byKey = new Map<string, ResultRow>();
    for (const r of this.results.values()) byKey.set(this.rkey(r.repo, r.pr, r.head_sha), r);
    const quizzes = [...this.quizzes.values()].sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    for (const quiz of quizzes) {
      out.push({ quiz, result: byKey.get(this.rkey(quiz.repo, quiz.pr, quiz.head_sha)) ?? null });
    }
    return out;
  }

  private rkey(repo: string, pr: number, head_sha: string): string {
    return `${repo}/${pr}/${head_sha}`;
  }
}
