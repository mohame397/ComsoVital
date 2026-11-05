import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuidance, SYMPTOM_QUESTIONS } from '../dist/guidance.js';
const NOW = Date.parse('2026-11-01T12:00:00Z');
const allNo = Object.fromEntries(SYMPTOM_QUESTIONS.map(question => [question.key, 'no']));
const rec = (values, extra = {}) => ({ id: 'test', timestamp: new Date(NOW - 60000).toISOString(), values, context: 'resting', source: 'manual', notes: '', ...extra });
const guide = (values, answers = allNo, extra = {}) => buildGuidance(rec(values, extra), answers, NOW);
const text = result => result.steps.map(step => step.title[0] + ' ' + step.body[0]).join('\n');

test('question schema has four explicit red-flag questions in both languages', () => {
  assert.deepEqual(SYMPTOM_QUESTIONS.map(q => q.key), ['breathing', 'stroke', 'unresponsive', 'unconsciousBreathing']);
  for (const q of SYMPTOM_QUESTIONS) { assert.equal(q.label.length, 2); assert.equal(q.hint.length, 2); }
});

test('oxygen boundaries separate emergency, urgent and review without rounding', () => {
  for (const [value, level] of [[88, 'emergency'], [88.5, 'urgent'], [89, 'urgent'], [92, 'urgent'], [92.5, 'review'], [93, 'review'], [94, 'review'], [95, 'info']]) {
    assert.equal(guide({ oxygen: value }).level, level, `oxygen ${value}`);
  }
});

test('missing/null/blank measurements never become zero; a recorded zero is preserved', () => {
  assert.equal(buildGuidance(null, {}, NOW).level, 'info');
  assert.equal(guide({ oxygen: null, temp: undefined, heart: '', sleep: 8 }).level, 'info');
  assert.deepEqual(guide({ sleep: 0 }).observations, [{ key: 'sleep', value: 0, unit: 'h' }]);
  assert.equal(guide({ sleep: 0 }).level, 'review');
  assert.equal(guide({ oxygen: '88' }).observations.length, 0);
});

test('each positive symptom overrides apparently normal measurements and may be incomplete', () => {
  for (const key of SYMPTOM_QUESTIONS.map(question => question.key)) {
    const result = guide({ oxygen: 99, heart: 72, temp: 36.8 }, { [key]: 'yes' });
    assert.equal(result.level, 'emergency');
    assert.equal(result.symptomsComplete, false);
    assert.ok(result.reasonCodes.includes(`symptom-${key}`));
    assert.match(result.steps[0].body[0], /Call local emergency services/);
    assert.doesNotMatch(text(result), /at least 1 minute|sip water|drink|fluids/i);
  }
  assert.match(text(guide({}, { ...allNo, stroke: 'yes' })), /Signs that stopped still need emergency assessment/);
});

test('unknown, partial and non-enum answers never become no symptoms', () => {
  for (const answers of [{}, { breathing: 'no' }, { ...allNo, stroke: 'unknown' }, { ...allNo, stroke: false }, { ...allNo, stroke: 'NO' }]) {
    const result = guide({ sys: 180, dia: 90 }, answers);
    assert.equal(result.symptomsComplete, false);
    assert.ok(result.reasonCodes.includes('symptoms-unknown'));
    assert.match(text(result), /Unknown does not mean absent/);
    assert.doesNotMatch(text(result), /wait at least 1 minute/);
  }
  assert.equal(guide({}, allNo).symptomsComplete, true);
  assert.equal(guide({}, { ...allNo, breathing: 'yes' }).symptomsComplete, true);
});

test('blood pressure OR rules include conservative exact triggers, explain source difference and gate recheck', () => {
  for (const values of [{ sys: 180, dia: 80 }, { sys: 150, dia: 120 }, { sys: 181, dia: 70 }]) {
    const result = guide(values);
    assert.equal(result.level, 'urgent');
    assert.match(text(result), /180 mmHg systolic OR 120 mmHg diastolic/);
    assert.match(text(result), /source uses higher than 180/);
    assert.match(text(result), /wait at least 1 minute/);
    assert.ok(result.sources.some(s => s.url.includes('heart.org')));
  }
  assert.equal(guide({ sys: 179, dia: 119 }).level, 'review');
  assert.equal(guide({ sys: 129, dia: 80 }).level, 'review');
  assert.equal(guide({ sys: 130, dia: 79 }).level, 'review');
  const red = guide({ sys: 180, dia: 80 }, { ...allNo, breathing: 'yes' });
  assert.equal(red.level, 'emergency');
  assert.doesNotMatch(text(red), /wait at least 1 minute/);
});

test('temperature thresholds and cold-specific first aid are correct and sourced', () => {
  assert.equal(guide({ temp: 35 }).level, 'info');
  const cold = guide({ temp: 34.9 });
  assert.equal(cold.level, 'emergency');
  assert.ok(cold.sources.some(s => s.url.endsWith('/hypothermia/')));
  assert.match(text(cold), /dry blanket/);
  assert.ok(cold.avoid.some(p => /hot bath or direct heat/.test(p[0])));
  assert.equal(guide({ temp: 37.9 }).level, 'info');
  assert.equal(guide({ temp: 38 }).level, 'review');
  assert.equal(guide({ temp: 40.5 }).level, 'review');
  assert.equal(guide({ temp: 40.6 }).level, 'urgent');
});

test('old observations are labeled without asserting current physiology; current symptoms still dominate', () => {
  const old = rec({ oxygen: 88 }, { timestamp: new Date(NOW - 86400001).toISOString() });
  const result = buildGuidance(old, allNo, NOW);
  assert.equal(result.historical, true);
  assert.equal(result.level, 'emergency');
  assert.match(result.summary[0], /Historical observation/);
  assert.match(result.steps[0].body[0], /If the problem is current or unresolved/);
  const current = buildGuidance(old, { ...allNo, breathing: 'yes' }, NOW);
  assert.match(current.summary[0], /warning symptom was reported now/);
  assert.match(current.steps[0].body[0], /^Call local emergency services/);
  const boundary = guide({}, allNo, { timestamp: new Date(NOW - 86400000).toISOString() });
  assert.equal(boundary.historical, false);
  const noTime = guide({ oxygen: 88 }, allNo, { timestamp: 'bad' });
  assert.equal(noTime.recordTimestamp, null);
  assert.ok(noTime.reasonCodes.includes('record-timestamp-unknown'));
});

test('CPR is limited to unresponsive AND abnormal breathing, follows dispatcher/AED and stops on normal breathing', () => {
  const result = guide({}, { ...allNo, unresponsive: 'yes' });
  assert.equal(result.level, 'emergency');
  assert.match(text(result), /Put the emergency call on speaker, start CPR/);
  assert.match(text(result), /AED/);
  assert.match(text(result), /until normal breathing returns/);
  assert.ok(result.sources.some(s => s.url.includes('sja.org.uk')));
  assert.doesNotMatch(text(guide({}, { ...allNo, breathing: 'yes' })), /start CPR/);
});


test('unresponsive with normal breathing is emergency with airway guidance rather than immediate CPR', () => {
  const result = guide({ oxygen: 99 }, { ...allNo, unconsciousBreathing: 'yes' });
  assert.equal(result.level, 'emergency');
  assert.match(text(result), /recovery position if safe/);
  assert.match(text(result), /CPR is not indicated while breathing remains normal/);
  assert.doesNotMatch(text(result), /start CPR/);
  assert.doesNotMatch(text(result), /rest in a safe, supported position/);
  assert.ok(result.sources.some(s => s.url.endsWith('/recovery-position/')));
});

test('conflicting unresponsiveness answers require dispatcher breathing check before conditional CPR', () => {
  const result = guide({}, { ...allNo, unresponsive: 'yes', unconsciousBreathing: 'yes' });
  assert.equal(result.level, 'emergency');
  assert.match(text(result), /answers conflict about normal breathing/);
  assert.match(text(result), /Only if the person is unresponsive and not breathing normally, start CPR/);
  assert.match(text(result), /Stop CPR if normal breathing returns/);
});

test('emergency low oxygen includes a sensor check only in parallel with help and never a wait', () => {
  const result = guide({ oxygen: 88 });
  assert.equal(result.steps[0].title[0], 'Get emergency help now');
  assert.match(text(result), /another person can check without delaying help/);
  assert.match(text(result), /Do not interrupt or postpone the emergency call/);
  assert.doesNotMatch(text(result), /wait (?:at least|for|until)/i);
});

test('emergency dominance removes all optional oral and recheck advice despite milder measures', () => {
  for (const values of [{ oxygen: 88, sys: 180, dia: 90, temp: 38.5 }, { temp: 34.9, sys: 180, dia: 90 }, { oxygen: 89, temp: 38.5, sys: 180, dia: 90 }]) {
    const result = guide(values, { ...allNo, breathing: 'yes' });
    assert.equal(result.level, 'emergency');
    assert.doesNotMatch(text(result), /sip water|drink|fluids|wait at least 1 minute/i);
    assert.match(result.steps[0].body[0], /now/);
  }
});

test('fever fluid advice requires all explicit no answers and includes safe swallowing and prescribed limits', () => {
  const result = guide({ temp: 38.5 });
  assert.match(text(result), /fully alert, able to swallow normally and there are no warning symptoms/);
  assert.match(text(result), /within any fluid limits already prescribed/);
  assert.doesNotMatch(text(guide({ temp: 38.5 }, {})), /sip water/);
});

test('no automatic glucose/HRV/EDA interpretation or medicine dosing; source output and inputs stay intact', () => {
  const record = rec({ glucose: 45, hrv: 4, eda: 99 });
  const frozen = JSON.stringify(record);
  const result = buildGuidance(record, allNo, NOW);
  assert.equal(result.level, 'info');
  assert.ok(result.reasonCodes.includes('uninterpreted-observations'));
  assert.equal(JSON.stringify(record), frozen);
  assert.ok(result.avoid.some(p => /Do not start, stop, or change medicines or oxygen settings/.test(p[0])));
  assert.doesNotMatch(text(result), /aspirin|\b\d+(?:\.\d+)?\s?(?:mg|mcg|tablets?|litres? per minute)\b/i);
  assert.equal(guide({ heart: 140 }, allNo, { context: 'post-exercise' }).level, 'info');
  assert.equal(guide({ heart: 59 }).level, 'review');
  assert.equal(guide({ mood: 2 }).level, 'review');
  assert.equal(guide({ sleep: 6.9 }).level, 'review');
  for (const s of result.sources) { assert.match(s.url, /^https:\/\//); assert.ok(s.label); }
});
