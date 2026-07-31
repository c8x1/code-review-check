import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeQuiz } from "./quiz-engine.js";

const questions = [
  { id: "q1", correct_option: "b", tests_behavior_id: "b2", options: [{ id: "a" }, { id: "b" }, { id: "c" }] },
  { id: "q2", correct_option: "a", tests_behavior_id: "b1", options: [{ id: "a" }, { id: "b" }] },
];

test("perfect score -> cleared, no missed", () => {
  const g = gradeQuiz(questions, { q1: "b", q2: "a" });
  assert.equal(g.score, 2);
  assert.equal(g.total, 2);
  assert.deepEqual(g.missed_questions, []);
  assert.deepEqual(g.missed_behaviors, []);
  assert.equal(g.terminal, "cleared");
});

test("missed question surfaces its behavior id", () => {
  const g = gradeQuiz(questions, { q1: "a", q2: "a" });
  assert.equal(g.score, 1);
  assert.deepEqual(g.missed_questions, ["q1"]);
  assert.deepEqual(g.missed_behaviors, ["b2"]);
  assert.equal(g.terminal, "re-read");
});

test("unanswered counts as missed", () => {
  const g = gradeQuiz(questions, { q2: "a" });
  assert.equal(g.score, 1);
  assert.deepEqual(g.missed_questions, ["q1"]);
  assert.deepEqual(g.missed_behaviors, ["b2"]);
});
