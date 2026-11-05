import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord} from '../dist/core.js';
import {reconcileAlerts, acknowledgeAlert, resolveAlert, validateAlerts, alertCounts, sortAlerts} from '../dist/alert-manager.js';

const base = Date.now() - 3600000;
const at = offset => new Date(base + offset).toISOString();
const record = (id, values, extras = {}) => validateRecord({id, timestamp:at(-86400000), values, context:'resting', ...extras});
const initial = () => reconcileAlerts([], [record('oxygen-observation', {oxygen:90})], {now:at(0)});

test('actual source-linked prompts have stable UUIDs, actual snapshots and explicit terrestrial limitations', () => {
  const records = [record('pulse-observation', {heart:120}), record('oxygen-observation', {oxygen:90})];
  const first = reconcileAlerts([], records, {now:at(0)});
  assert.equal(first.length, 2);
  assert.equal(first[0].severity, 'urgent');
  assert.equal(first[0].snapshot.value, 90);
  assert.equal(first[0].snapshot.unit, '%');
  assert.equal(first[0].measured_at, at(-86400000));
  assert.equal(first[0].created_at, at(0));
  assert.match(first[0].id, /^[a-f\d-]{36}$/i);
  assert.match(first[0].message, /Terrestrial adult reference.*not clinically validated astronaut/);
  assert.match(first[0].reference_url, /^https:\/\//);
  assert.equal(first[0].classification, 'reference-prompt');
  assert.deepEqual(reconcileAlerts(first, records, {now:at(1000)}), first);
});

test('a missing activity context never produces an invented resting pulse prompt', () => {
  const unknown = validateRecord({id:'unknown-context', timestamp:at(-86400000), values:{heart:120}});
  assert.deepEqual(reconcileAlerts([], [unknown], {now:at(0)}), []);
  assert.equal(reconcileAlerts([], [{...unknown, context:'resting'}], {now:at(0)}).length, 1);
});

test('mood is educational information and never a clinically validated severity threshold', () => {
  const alerts = reconcileAlerts([], [record('wellbeing-record', {mood:1, energy:1})], {now:at(0)});
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].classification, 'information');
  assert.equal(alerts[0].severity, 'info');
  assert.match(alerts[0].message, /not a validated mental health threshold/);
  assert.throws(() => validateAlerts([{...alerts[0], severity:'urgent'}]), /Educational information/);
});

test('glucose, HRV and EDA do not acquire invented thresholds', () => {
  const alerts = reconcileAlerts([], [record('context-required', {glucose:50, hrv:0, eda:80, energy:2})], {now:at(0)});
  assert.deepEqual(alerts, []);
});

test('blood pressure retains both measured values in one source-linked prompt', () => {
  const alerts = reconcileAlerts([], [record('paired-pressure', {sys:180, dia:80})], {now:at(0)});
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].parameter_name, 'bp');
  assert.deepEqual(alerts[0].snapshot, {value:{sys:180, dia:80}, context:'resting', unit:'mmHg'});
  assert.match(alerts[0].message, /conservative/);
});

test('a later reassuring observation cannot erase unresolved historical prompts', () => {
  const old = record('oxygen-observation', {oxygen:90});
  const first = reconcileAlerts([], [old], {now:at(0)});
  const next = reconcileAlerts(first, [old, record('later-oxygen', {oxygen:98}, {timestamp:at(1000)})], {now:at(2000)});
  assert.equal(next.length, 1);
  assert.equal(next[0].id, first[0].id);
  assert.equal(next[0].status, 'active');
  assert.equal(next[0].resolved_at, null);
});

test('deleting a source observation retains its snapshot without claiming resolution', () => {
  const first = initial(), before = structuredClone(first);
  const removed = reconcileAlerts(first, [], {now:at(1000)});
  assert.deepEqual(first, before);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].is_current, false);
  assert.equal(removed[0].status, 'active');
  assert.deepEqual(removed[0].snapshot, before[0].snapshot);
  assert.equal(removed[0].related_reading_id, 'oxygen-observation');
});

test('editing a measurement preserves the original alert snapshot and creates a distinct applicable prompt', () => {
  const first = initial();
  const next = reconcileAlerts(first, [record('oxygen-observation', {oxygen:93})], {now:at(1000)});
  assert.equal(next.length, 2);
  assert.equal(next.find(alert => alert.id === first[0].id).is_current, false);
  assert.equal(next.find(alert => alert.id === first[0].id).snapshot.value, 90);
  const changed = next.find(alert => alert.id !== first[0].id);
  assert.equal(changed.is_current, true);
  assert.equal(changed.severity, 'review');
  assert.equal(changed.snapshot.value, 93);
  assert.equal(changed.created_at, at(1000));
  assert.deepEqual(reconcileAlerts(next, [record('oxygen-observation', {oxygen:93})], {now:at(2000)}), next);
});

test('editing into a nonprompting value or changing recorded context deactivates applicability only', () => {
  const first = reconcileAlerts([], [record('pulse-observation', {heart:120})], {now:at(0)});
  for (const changed of [record('pulse-observation', {heart:75}), record('pulse-observation', {heart:120}, {context:'post-exercise'})]) {
    const next = reconcileAlerts(first, [changed], {now:at(1000)});
    assert.equal(next.length, 1);
    assert.equal(next[0].is_current, false);
    assert.equal(next[0].status, 'active');
  }
});

test('acknowledgement is immutable, idempotent and does not resolve or downgrade severity', () => {
  const first = initial(), before = structuredClone(first);
  const seen = acknowledgeAlert(first, first[0].id, {now:at(1000)});
  assert.deepEqual(first, before);
  assert.equal(seen[0].status, 'acknowledged');
  assert.equal(seen[0].acknowledged_at, at(1000));
  assert.equal(seen[0].resolved_at, null);
  assert.equal(seen[0].severity, 'urgent');
  assert.deepEqual(acknowledgeAlert(seen, first[0].id, {now:at(2000)}), seen);
  assert.deepEqual(reconcileAlerts(seen, [record('oxygen-observation', {oxygen:90})], {now:at(2000)}), seen);
});

test('organizational closure requires a reason and preserves acknowledgement separately', () => {
  const first = initial();
  assert.throws(() => resolveAlert(first, first[0].id, {reason:'  ', now:at(1000)}), /reason is required/);
  const seen = acknowledgeAlert(first, first[0].id, {now:at(1000)});
  const closed = resolveAlert(seen, first[0].id, {reason:'User recorded an external review; not verified by this application.', now:at(2000)});
  assert.equal(closed[0].status, 'resolved');
  assert.equal(closed[0].acknowledged_at, at(1000));
  assert.equal(closed[0].resolved_at, at(2000));
  assert.match(closed[0].resolution_note, /not verified/);
  assert.equal(seen[0].status, 'acknowledged');
  assert.deepEqual(resolveAlert(closed, first[0].id, {reason:'Repeated action', now:at(3000)}), closed);
  assert.deepEqual(acknowledgeAlert(closed, first[0].id, {now:at(3000)}), closed);
});

test('closing an unacknowledged alert does not fabricate an acknowledgement', () => {
  const first = initial(), closed = resolveAlert(first, first[0].id, {reason:'Organizational closure only', now:at(1000)});
  assert.equal(closed[0].acknowledged_at, null);
  assert.equal(closed[0].status, 'resolved');
});

test('invalid states, timestamps, duplicate identifiers and unsafe reference schemes reject atomically', () => {
  const first = initial(), item = first[0];
  for (const change of [
    {id:'not-a-uuid'}, {status:'sent'}, {severity:'critical'}, {classification:'clinical-diagnosis'},
    {created_at:'2025-02-30T00:00:00Z'}, {measured_at:'2025-01-01T00:00:00'},
    {reference_url:'javascript:alert(1)'}, {is_current:'yes'}, {snapshot:{value:null, context:'resting', unit:'%'}},
    {status:'acknowledged'}, {status:'resolved', resolved_at:at(1000)}, {status:'active', acknowledged_at:at(1000)}
  ]) assert.throws(() => validateAlerts([{...item, ...change}]));
  assert.throws(() => validateAlerts([item, {...item, dedupe_key:'other'}]), /IDs must be unique/);
  assert.throws(() => validateAlerts([item, {...item, id:'bf3d0310-e4ba-41a8-8814-1749f58045bf'}]), /keys must be unique/);
  assert.throws(() => acknowledgeAlert(first, 'missing'), /no longer exists/);
  assert.throws(() => acknowledgeAlert(first, item.id, {now:at(-1)}), /precede/);
  assert.throws(() => resolveAlert(first, item.id, {reason:'Reason', now:at(-1)}), /precede/);
  assert.deepEqual(validateAlerts(JSON.parse(JSON.stringify(first))), first);
});

test('reconciliation rejects invalid, duplicate or simulated observations without mutating history', () => {
  const first = initial(), before = structuredClone(first), good = record('new-record', {oxygen:90});
  assert.throws(() => reconcileAlerts(first, [good, good]), /IDs must be unique/);
  assert.throws(() => reconcileAlerts(first, [{...good, values:{oxygen:101}}]), /between/);
  assert.throws(() => reconcileAlerts(first, [{...good, source:'simulated'}]), /Training or simulated/);
  assert.deepEqual(first, before);
});

test('counts and sorting distinguish status, current applicability and educational information', () => {
  const generated = reconcileAlerts([], [record('mood-record', {mood:1}), record('heart-record', {heart:120}), record('oxygen-record', {oxygen:90})], {now:at(0)});
  const seen = acknowledgeAlert(generated, generated.find(alert => alert.parameter_name === 'heart').id, {now:at(1000)});
  const closed = resolveAlert(seen, seen.find(alert => alert.parameter_name === 'mood').id, {reason:'Check-in recorded', now:at(1000)});
  assert.deepEqual(alertCounts(closed), {active:1, acknowledged:1, resolved:1, total:3, current:3, information:1, reference:2});
  assert.deepEqual(sortAlerts([...closed].reverse()).map(alert => alert.severity), ['urgent', 'review', 'info']);
});
