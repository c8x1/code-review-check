-- migrations/0001_init.sql
CREATE TABLE IF NOT EXISTS quizzes(
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  author TEXT NOT NULL,
  quiz_data_url TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(repo, pr, head_sha)
);

CREATE TABLE IF NOT EXISTS results(
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  gitcode_username TEXT NOT NULL,
  score REAL NOT NULL,
  answered INTEGER NOT NULL,
  total INTEGER NOT NULL,
  missed_behavior_ids TEXT NOT NULL,
  missed_question_ids TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY(repo, pr, head_sha)
);
