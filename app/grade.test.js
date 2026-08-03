import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeQuiz } from "./quiz-engine.js";

const questions = [
  { id: "q1", correct_option: "b", options: [{ id: "a" }, { id: "b" }, { id: "c" }] },
  { id: "q2", correct_option: "a", options: [{ id: "a" }, { id: "b" }, { id: "c" }] },
];

test("perfect score -> cleared, no missed", () => {
  const g = gradeQuiz(questions, { q1: "b", q2: "a" });
  assert.equal(g.score, 2);
  assert.equal(g.total, 2);
  assert.deepEqual(g.missed_questions, []);
  assert.equal(g.terminal, "cleared");
});

test("missed question is recorded", () => {
  const g = gradeQuiz(questions, { q1: "a", q2: "a" });
  assert.equal(g.score, 1);
  assert.deepEqual(g.missed_questions, ["q1"]);
  assert.equal(g.terminal, "re-read");
});

test("unanswered counts as missed", () => {
  const g = gradeQuiz(questions, { q2: "a" });
  assert.equal(g.score, 1);
  assert.deepEqual(g.missed_questions, ["q1"]);
});

test("all wrong -> all missed", () => {
  const g = gradeQuiz(questions, { q1: "c", q2: "c" });
  assert.equal(g.score, 0);
  assert.deepEqual(g.missed_questions, ["q1", "q2"]);
  assert.equal(g.terminal, "re-read");
});
