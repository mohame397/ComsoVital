import test from 'node:test';
import assert from 'node:assert/strict';
import { assessQuality, comparePeriods } from '../dist/insights.js';

const meta = { device: 'Sensor A', method: 'Finger, seated', repeat: 'yes', signal: 'stable', glucoseTiming: 'unknown', temperatureSite: 'unknown' };
const record = (value, day, hour = 0, extra = {}, metric = 'heart') => ({ id: `${day}-${hour}`, timestamp: `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`, values: { [metric]: value }, context: 'resting', meta: { ...meta }, source: 'manual', notes: '', ...extra });
const options = { referenceStart: '2026-10-01T00:00:00Z', referenceEnd: '2026-10-01T23:59:59.999Z', currentStart: '2026-10-02T00:00:00Z', currentEnd: '2026-10-02T23:59:59.999Z', context: 'all' };
const complete = () => [record(70, 1), record(72, 1, 1), record(74, 1, 2), record(75, 2), record(77, 2, 1), record(79, 2, 2)];
const wording = result => result.warnings.map(pair => pair[0]).join('\n');

test('quality reflects reported context, never fabricated confidence or measurement accuracy', () => {
  const result = assessQuality(record(70, 1));
  assert.equal(result.state, 'context-recorded');
  assert.equal(result.missing.length, 0);
  assert.equal(result.known.find(item => item.key === 'device').value[0], 'Sensor A');
  assert.match(result.explanation[0], /not a percentage of confidence/);
  assert.ok(!Object.keys(result).some(key => /score|percent|confidence/i.test(key)));
  const old = assessQuality({ values: { heart: 70 }, context: 'resting' });
  assert.equal(old.state, 'context-missing');
  assert.deepEqual(old.missing.map(item => item.key), ['device', 'method', 'repeat', 'signal']);
  assert.equal(assessQuality(null).state, 'context-missing');
});

test('quality requires conditional glucose and temperature context only for measured metrics', () => {
  const glucose = assessQuality(record(95, 1, 0, {}, 'glucose'));
  assert.ok(glucose.missing.some(item => item.key === 'glucoseTiming'));
  assert.ok(!glucose.missing.some(item => item.key === 'temperatureSite'));
  const temp = assessQuality(record(37, 1, 0, {}, 'temp'));
  assert.ok(temp.missing.some(item => item.key === 'temperatureSite'));
  const contextual = assessQuality(record(37, 1, 0, { meta: { ...meta, temperatureSite: 'oral' } }, 'temp'));
  assert.equal(contextual.state, 'context-recorded');
  const irrelevant = assessQuality({ ...record(70, 1), values: { heart: 70, glucose: null, temp: '' } });
  assert.equal(irrelevant.missing.length, 0);
});

test('unstable signal and not repeated create context cautions without diagnoses', () => {
  const result = assessQuality(record(70, 1, 0, { meta: { ...meta, signal: 'unstable', repeat: 'no' } }));
  assert.equal(result.state, 'caution');
  assert.equal(result.cautions.length, 2);
  assert.match(result.cautions[0][0], /does not identify a medical cause/);
  assert.equal(assessQuality(record(70, 1, 0, { context: 'other' })).state, 'context-missing');
  assert.equal(assessQuality(record(70, 1, 0, { meta: { ...meta, device: 'Unknown' } })).state, 'context-missing');
});

test('period statistics use actual sorted observations and retain descriptive deltas', () => {
  const records = complete().reverse();
  const before = JSON.stringify(records);
  const result = comparePeriods(records, 'heart', options);
  assert.deepEqual(result.reference, { count: 3, mean: 72, min: 70, max: 74 });
  assert.deepEqual(result.current, { count: 3, mean: 77, min: 75, max: 79 });
  assert.equal(result.difference, 5);
  assert.equal(result.percentChange, 5 / 72 * 100);
  assert.equal(result.comparable, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.referencePoints.length, 3);
  assert.ok(result.referencePoints[0].time < result.referencePoints[2].time);
  assert.equal(JSON.stringify(records), before);
});

test('explicit nonoverlapping date windows reject invalid, reversed, missing and touching bounds', () => {
  assert.throws(() => comparePeriods([], 'heart', {}), /explicit ISO/);
  assert.throws(() => comparePeriods([], 'heart', { ...options, referenceStart: '2026-02-30' }), /not a valid date/);
  assert.throws(() => comparePeriods([], 'heart', { ...options, referenceStart: '2026-10-01T24:00:00Z' }), /invalid time/);
  assert.throws(() => comparePeriods([], 'heart', { ...options, referenceStart: '2026-10-01T01:00:00' }), /timezone/);
  assert.throws(() => comparePeriods([], 'heart', { ...options, referenceStart: options.currentEnd }), /start on or before/);
  assert.throws(() => comparePeriods([], 'heart', { ...options, currentStart: options.referenceEnd }), /must not overlap/);
  assert.throws(() => comparePeriods([], 'heart', { ...options, currentStart: options.referenceStart }), /must not overlap/);
  assert.throws(() => comparePeriods([], 'missing', options), /supported measurement/);
  assert.throws(() => comparePeriods([], 'heart', { ...options, context: 'fasting' }), /comparison context/);
});

test('inclusive exact date boundaries include real points, missing values are not zero-filled', () => {
  const rows = [record(70, 1), record(71, 1, 1), record(72, 2), { ...record(99, 1, 2), values: { oxygen: 99 } }, { ...record(73, 2, 1), values: { heart: null } }];
  const result = comparePeriods(rows, 'heart', { ...options, referenceEnd: '2026-10-01T01:00:00Z', currentEnd: '2026-10-02T00:00:00Z' });
  assert.equal(result.reference.count, 2);
  assert.equal(result.current.count, 1);
  assert.deepEqual(result.referencePoints.map(p => p.value), [70, 71]);
  assert.equal(result.comparable, false);
  assert.match(wording(result), /fewer than three/);
  const empty = comparePeriods([], 'heart', options);
  assert.deepEqual(empty.reference, { count: 0, mean: null, min: null, max: null });
  assert.equal(empty.difference, null);
  assert.equal(empty.percentChange, null);
});

test('zero reference mean has no percent change while absolute difference remains valid', () => {
  const rows = [0, 0, 0].map((value, hour) => record(value, 1, hour, {}, 'sleep')).concat([1, 2, 3].map((value, hour) => record(value, 2, hour, {}, 'sleep')));
  const result = comparePeriods(rows, 'sleep', options);
  assert.equal(result.reference.mean, 0);
  assert.equal(result.difference, 2);
  assert.equal(result.percentChange, null);
  assert.equal(result.comparable, true); // Absolute descriptive comparison still passes context checks.
  assert.match(wording(result), /percentage change is undefined/);
});

test('different or unknown devices and methods warn while keeping descriptive differences', () => {
  for (const key of ['device', 'method']) {
    const rows = complete();
    rows[3].meta[key] = `Different ${key}`;
    const result = comparePeriods(rows, 'heart', options);
    assert.equal(result.comparable, false);
    assert.equal(result.difference, 5);
    assert.match(wording(result), key === 'device' ? /Different devices/ : /Different measurement methods/);
  }
  const old = complete().map(({ meta: ignored, ...record }) => record);
  const result = comparePeriods(old, 'heart', options);
  assert.equal(result.comparable, false);
  assert.equal(result.reference.count, 3);
  assert.match(wording(result), /context is incomplete/);
});

test('contexts must be known and consistent; filtering selects only actual matching records', () => {
  const mixed = complete();
  mixed[3].context = 'post-exercise';
  assert.equal(comparePeriods(mixed, 'heart', options).comparable, false);
  assert.match(wording(comparePeriods(mixed, 'heart', options)), /different activity contexts/);
  const filtered = comparePeriods(mixed, 'heart', { ...options, context: 'resting' });
  assert.equal(filtered.current.count, 2);
  const unknown = complete().map(row => ({ ...row, context: 'other' }));
  assert.equal(comparePeriods(unknown, 'heart', options).comparable, false);
  assert.match(wording(comparePeriods(unknown, 'heart', options)), /missing or unspecified/);
  const absent = complete(); delete absent[0].context;
  assert.equal(comparePeriods(absent, 'heart', options).comparable, false);
});

test('signal, repeat, glucose timing and temperature site limitations prevent comparability', () => {
  for (const [key, value] of [['signal', 'unstable'], ['repeat', 'no']]) {
    const rows = complete(); rows[2].meta[key] = value;
    assert.equal(comparePeriods(rows, 'heart', options).comparable, false);
  }
  const glucoseRows = complete().map(row => ({ ...row, values: { glucose: row.values.heart }, meta: { ...row.meta, glucoseTiming: 'fasting' } }));
  assert.equal(comparePeriods(glucoseRows, 'glucose', options).comparable, true);
  glucoseRows[3].meta.glucoseTiming = 'after-meal';
  assert.equal(comparePeriods(glucoseRows, 'glucose', options).comparable, false);
  const tempRows = complete().map(row => ({ ...row, values: { temp: 36 + row.values.heart / 100 }, meta: { ...row.meta, temperatureSite: 'oral' } }));
  assert.equal(comparePeriods(tempRows, 'temp', options).comparable, true);
  tempRows[3].meta.temperatureSite = 'ear';
  assert.equal(comparePeriods(tempRows, 'temp', options).comparable, false);
});

test('training and invalid timestamps cannot add invented observations to real comparisons', () => {
  const rows = [...complete(), record(200, 1, 4, { source: 'training' }), record(200, 2, 4, { simulated: true }), record(200, 1, 5, { timestamp: '2026-02-30T00:00:00Z' }), record(200, 1, 6, { timestamp: '2026-10-01T06:00:00' })];
  const result = comparePeriods(rows, 'heart', options);
  assert.equal(result.reference.count, 3);
  assert.equal(result.current.count, 3);
  assert.equal(result.difference, 5);
  assert.equal(result.comparable, false);
  assert.match(wording(result), /were excluded/);
});
