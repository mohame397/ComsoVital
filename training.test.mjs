import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TRAINING_SCENARIOS, createTrainingSession, answerTrainingStep, trainingSummary } from '../dist/training.js';

const clone = value => JSON.parse(JSON.stringify(value));
const bilingual = pair => {
  assert.equal(pair.length, 2);
  assert.ok(pair.every(part => typeof part === 'string' && part.trim().length > 0));
  assert.match(pair[1], /[\u0600-\u06ff]/);
};

test('three bounded fictional scenarios have bilingual text and exactly one verified choice per step', () => {
  assert.equal(TRAINING_SCENARIOS.length, 3);
  assert.equal(new Set(TRAINING_SCENARIOS.map(s => s.id)).size, 3);
  for (const scenario of TRAINING_SCENARIOS) {
    for (const key of ['title', 'description', 'mission']) bilingual(scenario[key]);
    assert.match(scenario.title[0], /Simulation/);
    assert.ok(Number.isFinite(scenario.delayMinutes) && scenario.delayMinutes >= 0);
    assert.ok(scenario.steps.length >= 1 && scenario.steps.length <= 4);
    assert.equal(new Set(scenario.steps.map(s => s.id)).size, scenario.steps.length);
    for (const step of scenario.steps) {
      bilingual(step.prompt);
      assert.match(step.prompt[0], /Simulation/);
      assert.equal(step.options.filter(option => option.correct).length, 1);
      assert.equal(new Set(step.options.map(o => o.id)).size, step.options.length);
      for (const option of step.options) { bilingual(option.label); bilingual(option.feedback); }
    }
  }
});

test('invalid scenario IDs, missing sessions, and invalid options are rejected', () => {
  for (const id of ['', 'fake', undefined, null]) assert.throws(() => createTrainingSession(id), /Unknown training scenario/);
  for (const session of [null, undefined, {}]) assert.throws(() => trainingSummary(session));
  const session = createTrainingSession('context-check');
  const before = clone(session);
  for (const option of ['fake', '', undefined, null, 'workflow-only']) {
    assert.throws(() => answerTrainingStep(session, option), /Unknown option/);
    assert.deepEqual(session, before);
  }
});

test('answering returns a new immutable audited session without modifying its input', () => {
  const original = createTrainingSession('context-check');
  const next = answerTrainingStep(original, 'check-context');
  assert.notEqual(next, original);
  assert.equal(original.stepIndex, 0);
  assert.deepEqual(original.answers, []);
  assert.equal(next.id, original.id);
  assert.equal(next.startedAt, original.startedAt);
  assert.equal(next.stepIndex, 1);
  assert.equal(next.answers[0].stepId, 'verify-metadata');
  assert.equal(next.answers[0].optionId, 'check-context');
  assert.equal(next.answers[0].correct, true);
  bilingual(next.answers[0].feedback);
  assert.ok(Number.isFinite(Date.parse(next.answers[0].answeredAt)));
  assert.throws(() => next.answers.push({}), TypeError);
  assert.throws(() => { next.answers[0].correct = false; }, TypeError);
  assert.throws(() => { TRAINING_SCENARIOS[0].steps[0].options[0].correct = false; }, TypeError);
});

test('each step is answered once in order and a finished session cannot earn more decisions', () => {
  for (const scenario of TRAINING_SCENARIOS) {
    let session = createTrainingSession(scenario.id);
    assert.deepEqual([trainingSummary(session).completedSteps, trainingSummary(session).correctSteps], [0, 0]);
    for (let index = 0; index < scenario.steps.length; index++) {
      const option = scenario.steps[index].options.find(o => o.correct);
      session = answerTrainingStep(session, option.id);
      assert.equal(session.answers.length, index + 1);
      assert.equal(session.stepIndex, index + 1);
      if (index < scenario.steps.length - 1) assert.throws(() => answerTrainingStep(session, option.id), /Unknown option/);
    }
    const snapshot = clone(session);
    const summary = trainingSummary(session);
    assert.equal(summary.finished, true);
    assert.equal(summary.completedSteps, scenario.steps.length);
    assert.equal(summary.correctSteps, scenario.steps.length);
    assert.equal(summary.totalSteps, scenario.steps.length);
    assert.throws(() => answerTrainingStep(session, scenario.steps[0].options[0].id), /finished/);
    assert.deepEqual(session, snapshot);
  }
});

test('incorrect choices are counted once, retain feedback, and permit the next step', () => {
  let session = createTrainingSession('context-check');
  session = answerTrainingStep(session, 'diagnose-confidence');
  assert.equal(trainingSummary(session).correctSteps, 0);
  assert.equal(session.answers[0].correct, false);
  assert.match(session.answers[0].feedback[0], /verification/);
  session = answerTrainingStep(session, 'mark-unknown');
  session = answerTrainingStep(session, 'workflow-only');
  assert.equal(trainingSummary(session).correctSteps, 2);
});

test('tampered state cannot skip steps, duplicate answers, or alter correctness', () => {
  const session = answerTrainingStep(createTrainingSession('context-check'), 'check-context');
  const corruptions = [
    s => { s.stepIndex = 2; },
    s => { s.answers.push(s.answers[0]); s.stepIndex = 2; },
    s => { s.answers[0].correct = false; },
    s => { s.answers[0].feedback[0] = 'Invented'; },
    s => { s.answers[0].stepId = 'preserve-unknowns'; },
    s => { s.finished = true; },
    s => { s.startedAt = 'invalid'; },
    s => { s.answers[0].answeredAt = 'invalid'; }
  ];
  for (const corrupt of corruptions) {
    const changed = clone(session); corrupt(changed);
    assert.throws(() => trainingSummary(changed), /Invalid training/);
    assert.throws(() => answerTrainingStep(changed, 'mark-unknown'), /Invalid training/);
  }
});

test('case priorities verify metadata, prepare an unsent dated packet, and seek available emergency help', () => {
  const scenario = id => TRAINING_SCENARIOS.find(s => s.id === id);
  const correct = (id, index) => scenario(id).steps[index].options.find(o => o.correct);
  assert.equal(correct('context-check', 0).id, 'check-context');
  assert.match(correct('context-check', 0).label[0], /source, date, device, and context/);
  assert.equal(correct('delayed-review', 0).id, 'dated-packet');
  assert.match(correct('delayed-review', 0).feedback[0], /Nothing has been transmitted/);
  assert.equal(correct('delayed-review', 1).id, 'prepared-unsent');
  assert.equal(correct('delayed-review', 2).id, 'available-help');
  assert.equal(correct('emergency-priority', 0).id, 'immediate-available-help');
  assert.match(correct('emergency-priority', 0).feedback[0], /Do not wait for an Earth reply/);
  assert.equal(correct('emergency-priority', 1).id, 'no-delay');
  assert.match(correct('emergency-priority', 1).feedback[0], /not a prerequisite/);
});

test('summary concerns workflow decisions only, is bilingual, and makes no positive clinical recovery claim', () => {
  for (const scenario of TRAINING_SCENARIOS) {
    let session = createTrainingSession(scenario.id);
    for (const step of scenario.steps) session = answerTrainingStep(session, step.options.find(o => o.correct).id);
    const summary = trainingSummary(session);
    bilingual(summary.feedback); bilingual(summary.disclaimer);
    assert.match(summary.feedback[0], /workflow choices only/);
    assert.match(summary.disclaimer[0], /not NASA-validated/);
    assert.match(summary.disclaimer[0], /No real patient/);
    assert.match(summary.disclaimer[0], /prediction/);
    assert.doesNotMatch(summary.feedback[0], /will recover|survival rate|healthy|medically cleared/i);
    assert.deepEqual(Object.keys(summary).sort(), ['completedSteps', 'correctSteps', 'disclaimer', 'feedback', 'finished', 'totalSteps'].sort());
    assert.equal('values' in session, false);
    assert.equal('patient' in session, false);
  }
});

test('module has no record-core, storage, dispatch, or network dependency', async () => {
  const source = await readFile(new URL('../dist/training.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|localStorage|sessionStorage|fetch|XMLHttpRequest|WebSocket|saveRecord|saveCase|setTimeout)\b/);
});
