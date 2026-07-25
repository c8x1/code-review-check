export interface QuizRow {
  repo: string;
  pr: number;
  head_sha: string;
  author: string;
  quiz_data_url: string;
  token: string;
  created_at: string;
}

export interface ResultRow {
  repo: string;
  pr: number;
  head_sha: string;
  gitcode_username: string;
  score: number;
  answered: number;
  total: number;
  missed_behavior_ids: string;
  missed_question_ids: string;
  submitted_at: string;
}

export interface InsertResultOutcome {
  /** true when a uniqueness constraint is violated (token dup, or PK dup). */
  conflict: boolean;
}

/**
 * Storage interface the route handlers depend on. The production Worker is
 * wired with `D1Store`; tests use an in-memory implementation that faithfully
 * simulates the one-shot PK conflict.
 */
export interface QuizStore {
  getQuizByToken(token: string): Promise<QuizRow | null>;
  getResult(repo: string, pr: number, head_sha: string): Promise<ResultRow | null>;
  insertQuiz(q: QuizRow): Promise<InsertResultOutcome>;
  insertResult(r: ResultRow): Promise<InsertResultOutcome>;
  listAll(): Promise<{ quiz: QuizRow; result: ResultRow | null }[]>;
}

export class D1Store implements QuizStore {
  constructor(private db: D1Database) {}

  async getQuizByToken(token: string): Promise<QuizRow | null> {
    return this.db
      .prepare("SELECT * FROM quizzes WHERE token = ?1")
      .bind(token)
      .first<QuizRow>();
  }

  async getResult(repo: string, pr: number, head_sha: string): Promise<ResultRow | null> {
    return this.db
      .prepare("SELECT * FROM results WHERE repo=?1 AND pr=?2 AND head_sha=?3")
      .bind(repo, pr, head_sha)
      .first<ResultRow>();
  }

  async insertQuiz(q: QuizRow): Promise<InsertResultOutcome> {
    const res = await this.db
      .prepare(
        "INSERT INTO quizzes(repo,pr,head_sha,author,quiz_data_url,token,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)"
      )
      .bind(q.repo, q.pr, q.head_sha, q.author, q.quiz_data_url, q.token, q.created_at)
      .run();
    return { conflict: !res.success };
  }

  async insertResult(r: ResultRow): Promise<InsertResultOutcome> {
    const res = await this.db
      .prepare(
        "INSERT INTO results(repo,pr,head_sha,gitcode_username,score,answered,total,missed_behavior_ids,missed_question_ids,submitted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"
      )
      .bind(
        r.repo, r.pr, r.head_sha, r.gitcode_username, r.score, r.answered,
        r.total, r.missed_behavior_ids, r.missed_question_ids, r.submitted_at
      )
      .run();
    // D1 sets `success=false` on a constraint violation (e.g. PK conflict).
    return { conflict: !res.success };
  }

  async listAll(): Promise<{ quiz: QuizRow; result: ResultRow | null }[]> {
    const rows = await this.db
      .prepare(
        "SELECT quizzes.*, results.gitcode_username, results.score, results.answered, results.total, results.missed_behavior_ids, results.missed_question_ids, results.submitted_at " +
          "FROM quizzes LEFT JOIN results " +
          "ON quizzes.repo=results.repo AND quizzes.pr=results.pr AND quizzes.head_sha=results.head_sha " +
          "ORDER BY quizzes.created_at DESC"
      )
      .all<any>();
    return (rows.results ?? []).map((r) => ({
      quiz: {
        repo: r.repo, pr: r.pr, head_sha: r.head_sha, author: r.author,
        quiz_data_url: r.quiz_data_url, token: r.token, created_at: r.created_at,
      },
      result: r.gitcode_username == null ? null : {
        repo: r.repo, pr: r.pr, head_sha: r.head_sha, gitcode_username: r.gitcode_username,
        score: r.score, answered: r.answered, total: r.total,
        missed_behavior_ids: r.missed_behavior_ids,
        missed_question_ids: r.missed_question_ids, submitted_at: r.submitted_at,
      },
    }));
  }
}
