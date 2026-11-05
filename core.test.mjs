import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, STORAGE_KEY, validateRecord, parseImport, toCSV, statusFor, assessRecord, mergeRecords, getRecords, saveRecords } from '../dist/core.js';
const timestamp = new Date(Date.now() - 60000).toISOString();
const raw = (values = { heart: 75 }, extra = {}) => ({ timestamp, values, context: 'resting', ...extra });

test('input bounds reject unit errors and blank input never becomes zero', () => {
  assert.throws(() => validateRecord(raw({ oxygen: 101 })), /between 50 and 100/);
  assert.throws(() => validateRecord(raw({ temp: 98.6 })), /Check the unit/);
  assert.throws(() => validateRecord(raw({ heart: '' })), /at least one/);
  assert.throws(() => validateRecord(raw({ mood: 2.2 })), /whole number/);
  assert.throws(() => validateRecord(raw({ heart: true })), /must be a number/);
  assert.throws(() => validateRecord(raw({ heart: '7e1' })), /must be a number/);
  assert.throws(() => validateRecord(raw({ heart: Infinity })), /between/);
  assert.throws(() => validateRecord(raw({ bpm: 70 })), /Unknown measurement/);
  assert.deepEqual(validateRecord(raw({ sleep: 0, heart: ' 75 ' })).values, { heart: 75, sleep: 0 });
  assert.equal(METRICS.glucose.unit, 'mg/dL');
});

test('blood pressure must be a correctly ordered pair', () => {
  assert.throws(() => validateRecord(raw({ sys: 120 })), /both systolic and diastolic/);
  assert.throws(() => validateRecord(raw({ dia: 80 })), /both systolic and diastolic/);
  assert.throws(() => validateRecord(raw({ sys: 75, dia: 85 })), /greater than/);
  assert.deepEqual(validateRecord(raw({ sys: 120, dia: 80 })).values, { sys: 120, dia: 80 });
});

test('timestamps retain timezone meaning and reject future, pre-1900 and nonexistent dates', () => {
  // Use a prior date to avoid a current UTC time boundary affecting this test.
  const oldOffset = new Date(Date.now() - 86400000).toISOString().slice(0, 10) + 'T08:00:00+02:00';
  assert.equal(validateRecord(raw({ heart: 70 }, { timestamp: oldOffset })).timestamp.slice(11, 16), '06:00');
  assert.throws(() => validateRecord(raw({ heart: 70 }, { timestamp: new Date(Date.now() + 600000).toISOString() })), /future/);
  assert.equal(validateRecord(raw({ heart: 70 }, { timestamp: '2000-01-01T00:00:00Z' })).timestamp, '2000-01-01T00:00:00.000Z');
  assert.throws(() => validateRecord(raw({ heart: 70 }, { timestamp: '1899-12-31T23:59:59Z' })), /earlier than 1900/);
  assert.throws(() => validateRecord(raw({ heart: 70 }, { timestamp: timestamp.slice(0, 19) })), /timezone/);
  const year = new Date().getUTCFullYear() - 1;
  assert.throws(() => validateRecord(raw({ heart: 70 }, { timestamp: `${year}-02-30T00:00:00Z` })), /does not exist|invalid/);
  assert.throws(() => validateRecord(raw({ heart: 70 }, { timestamp: timestamp.slice(0, 10) + 'T24:00:00Z' })), /time is invalid/);
  assert.throws(() => validateRecord(raw({ heart: 70 }, { context: 'fasting' })), /context/);
});

test('CSV parses quoted commas, escaped quotes and line breaks without corruption', () => {
  const csv = `timestamp,heart,sleep,context,notes\r\n${timestamp},74,7.5,resting,"Crew said ""steady"", resting\nsecond line"\r\n`;
  const records = parseImport(csv, 'readings.csv');
  assert.equal(records.length, 1);
  assert.equal(records[0].notes, 'Crew said "steady", resting\nsecond line');
  assert.equal(records[0].source, 'imported');
  assert.deepEqual(records[0].values, { heart: 74, sleep: 7.5 });
  const roundtrip = parseImport(toCSV(records), 'again.csv');
  assert.deepEqual(roundtrip[0].values, records[0].values);
  assert.equal(roundtrip[0].notes, records[0].notes);
  assert.throws(() => parseImport(`timestamp,notes,heart\n${timestamp},"unclosed,70`, 'bad.csv'), /unclosed/);
  assert.throws(() => parseImport(`timestamp,heart\n${timestamp},70,extra`, 'bad.csv'), /fields/);
  assert.throws(() => parseImport(`timestamp,heart,heart\n${timestamp},70,72`, 'bad.csv'), /duplicate/);
});

test('imports override claimed provenance, reject atomically and cap batch size', () => {
  const source = raw({ heart: 70 }, { source: 'NASA live', notes: '<img src=x onerror=alert(1)>' });
  const [imported] = parseImport(JSON.stringify({ records: [source] }), 'readings.json');
  assert.equal(imported.source, 'imported');
  assert.equal(imported.notes, '<img src=x onerror=alert(1)>'); // App must render textContent.
  assert.throws(() => parseImport(JSON.stringify([source, raw({ heart: 300 })]), 'bad.json'), /Observation 2/);
  assert.throws(() => parseImport(JSON.stringify(Array.from({ length: 10001 }, () => source)), 'large.json'), /10,000/);
  assert.throws(() => parseImport('{}', 'empty.json'), /records array/);
  assert.throws(() => parseImport('timestamp,heart\n', 'empty.csv'), /at least one/);
});

test('CSV preserves exported provenance labels while imports enforce imported source', () => {
  const record = validateRecord(raw({ heart: 70 }, { source: 'manual' }));
  const csv = toCSV([record]);
  assert.match(csv.split('\r\n')[0], /,source,context,notes,meta_device,meta_method,meta_repeat,meta_signal,meta_glucoseTiming,meta_temperatureSite,id,measured_at,created_at,user_id,source_reference,symptoms$/);
  assert.match(csv.split('\r\n')[1], /,manual,resting,/);
  const [roundtrip] = parseImport(csv, 'backup.csv');
  assert.equal(roundtrip.source, 'imported');
  assert.deepEqual(roundtrip.values, record.values);
  const forged = csv.replace(',manual,resting,', ',NASA-live,resting,');
  assert.equal(parseImport(forged, 'forged.csv')[0].source, 'imported');
});

test('CSV exports neutralize spreadsheet formulas in notes', () => {
  const record = validateRecord(raw({ heart: 70 }, { notes: '=HYPERLINK("https://example.com")' }));
  assert.match(toCSV([record]), /'=HYPERLINK/);
});

test('merging imports deduplicates content regardless of object key order or source/id', () => {
  const first = validateRecord(raw({ heart: 70, oxygen: 98 }, { id: 'first', source: 'manual' }));
  const second = validateRecord(raw({ oxygen: 98, heart: 70 }, { id: 'second', source: 'imported' }));
  assert.equal(mergeRecords([first], [second]).length, 1);
  const different = validateRecord(raw({ heart: 70, oxygen: 98 }, { notes: 'After measurement' }));
  assert.equal(mergeRecords([first], [different]).length, 2);
  const sameId = validateRecord(raw({ heart: 71 }, { id: first.id }));
  const distinct = mergeRecords([first], [sameId]);
  assert.notEqual(distinct[0].id, distinct[1].id);
  const later = validateRecord(raw({ heart: 71 }, { timestamp: new Date(Date.parse(timestamp) + 1000).toISOString() }));
  assert.deepEqual(mergeRecords([later], [first]).map(item => item.id), [first.id, later.id]);
});

test('screening combines blood pressure components and respects resting context', () => {
  assert.equal(statusFor('temp', 34), 'urgent');
  assert.equal(statusFor('oxygen', 92), 'urgent');
  const veryLowOxygen = assessRecord(validateRecord(raw({ oxygen: 88 })));
  assert.match(veryLowOxygen[0].detail, /immediate crew medical assistance/);
  const veryLowTemp = assessRecord(validateRecord(raw({ temp: 34 })));
  assert.match(veryLowTemp[0].sourceUrl, /hypothermia/);
  assert.equal(statusFor('oxygen', 93), 'review');
  assert.equal(statusFor('heart', 100), 'reference');
  assert.equal(statusFor('glucose', 90), 'unassessed');
  assert.equal(statusFor('heart', undefined), 'unassessed');
  const systolic = assessRecord(validateRecord(raw({ sys: 181, dia: 90 })));
  assert.equal(systolic.length, 1);
  assert.equal(systolic[0].metric, 'bp');
  assert.equal(systolic[0].severity, 'urgent');
  const diastolic = assessRecord(validateRecord(raw({ sys: 150, dia: 120 })));
  assert.equal(diastolic[0].severity, 'urgent');
  const review = assessRecord(validateRecord(raw({ sys: 129, dia: 81 })));
  assert.equal(review[0].severity, 'review');
  assert.equal(assessRecord(validateRecord(raw({ heart: 130 }, { context: 'post-exercise' }))).length, 0);
  assert.equal(assessRecord(validateRecord(raw({ heart: 130 }))).length, 1);
  assert.equal(assessRecord(validateRecord(raw({ glucose: 50, hrv: 12, eda: 2 }))).length, 0);
});

test('persistence roundtrips and corrupt storage produces a recovery error without overwrite', () => {
  const map = new Map();
  globalThis.localStorage = { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, value) };
  assert.deepEqual(getRecords(), []);
  const canonical = saveRecords([raw({ heart: 70 })]);
  assert.deepEqual(getRecords(), canonical);
  map.set(STORAGE_KEY, '{broken');
  assert.throws(() => getRecords(), /unreadable/);
  assert.equal(map.get(STORAGE_KEY), '{broken');
  globalThis.localStorage = { setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.throws(() => saveRecords([raw()]), /could not be saved/);
  delete globalThis.localStorage;
});


test('v2 metadata normalizes older records, validates enums and preserves plain text', () => {
  const defaults = { device: '', method: '', repeat: 'unknown', signal: 'unknown', glucoseTiming: 'unknown', temperatureSite: 'unknown' };
  assert.deepEqual(validateRecord(raw()).meta, defaults);
  const meta = { device: '  Device, model A  ', method: '<b>oral</b>', repeat: 'yes', signal: 'stable', glucoseTiming: 'fasting', temperatureSite: 'oral' };
  const record = validateRecord(raw({ temp: 37 }, { meta }));
  assert.deepEqual(record.meta, { ...meta, device: 'Device, model A' });
  assert.throws(() => validateRecord(raw({}, { meta: { repeat: 'YES' } })), /at least one/);
  assert.throws(() => validateRecord(raw({ heart: 70 }, { meta: { repeat: 'YES' } })), /Invalid measurement metadata repeat/);
  assert.throws(() => validateRecord(raw({ heart: 70 }, { meta: { device: 'x'.repeat(101) } })), /no more than 100/);
  assert.throws(() => validateRecord(raw({ heart: 70 }, { meta: { method: 'x'.repeat(201) } })), /no more than 200/);
  assert.throws(() => validateRecord(raw({ heart: 70 }, { meta: { signal: true } })), /Invalid measurement metadata signal/);
  assert.throws(() => validateRecord(raw({ heart: 70 }, { meta: { unknown: 'value' } })), /Unknown measurement metadata/);
});

test('v2 metadata survives quoted CSV and JSON round trips while old CSV remains supported', () => {
  const record = validateRecord(raw({ temp: 37, glucose: 95 }, { meta: { device: 'Device, "A"', method: 'Oral\nsecond line', repeat: 'yes', signal: 'stable', glucoseTiming: 'fasting', temperatureSite: 'oral' } }));
  assert.deepEqual(parseImport(toCSV([record]), 'v2.csv')[0].meta, record.meta);
  assert.deepEqual(parseImport(JSON.stringify({ records: [record] }), 'v2.json')[0].meta, record.meta);
  const [old] = parseImport(`timestamp,heart\n${timestamp},70`, 'v1.csv');
  assert.equal(old.meta.signal, 'unknown');
  const [blank] = parseImport(`timestamp,heart,meta_signal\n${timestamp},70,`, 'blank.csv');
  assert.equal(blank.meta.signal, 'unknown');
});

test('deduplication preserves differing metadata without duplicating equivalent old defaults', () => {
  const old = raw({ heart: 70 });
  const canonical = validateRecord(old);
  assert.equal(mergeRecords([old], [canonical]).length, 1);
  const contextual = validateRecord(raw({ heart: 70 }, { meta: { device: 'Device A' } }));
  assert.equal(mergeRecords([old], [contextual]).length, 2);
});

test('training and simulated imports are rejected before relabeling, including CSV and top-level envelopes', () => {
  for (const flags of [{ training: true }, { simulated: true }, { source: 'training' }, { source: 'simulated' }, { source: 'demo-scenario' }, { source_type: 'synthetic' }]) {
    assert.throws(() => parseImport(JSON.stringify([raw({ heart: 70 }, flags)]), 'training.json'), /Training or simulated/);
  }
  assert.throws(() => parseImport(JSON.stringify({ training: true, records: [raw()] }), 'training.json'), /Training or simulated/);
  assert.throws(() => parseImport(`timestamp,heart,source\n${timestamp},70,training`, 'training.csv'), /Training or simulated/);
  assert.throws(() => parseImport(`timestamp,heart,simulated\n${timestamp},70,true`, 'simulation.csv'), /Training or simulated/);
  assert.equal(parseImport(JSON.stringify([raw({ heart: 70 }, { simulated: false, source: 'unverified clinical export' })]), 'real.json')[0].source, 'imported');
});


test('missing context remains unknown and cannot become an assumed resting heart-rate prompt', () => {
  const [record] = parseImport(JSON.stringify([{timestamp, values: {heart: 120}}]), 'unknown.json');
  assert.equal(record.context, 'unknown');
  assert.equal(assessRecord(record).length, 0);
  assert.equal(assessRecord(validateRecord({...record, context: 'resting'})).length, 1);
});

test('saved historical observations never age out of the persistent ledger', () => {
  const saved = new Map();
  globalThis.localStorage = {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)};
  const originalNow = Date.now;
  try {
    const beforeOldLimit = new Date(originalNow() - 10 * 366 * 86400000 + 3600000).toISOString();
    saveRecords([{id:'historical-record', timestamp:beforeOldLimit, values:{heart:72}}]);
    Date.now = () => originalNow() + 7200000;
    assert.equal(getRecords()[0].id, 'historical-record');
    assert.equal(getRecords()[0].timestamp, beforeOldLimit);
  } finally {Date.now = originalNow; delete globalThis.localStorage;}
});

test('measurement and creation timestamps remain separate and legacy creation is explicitly unknown', () => {
  const legacy = validateRecord(raw());
  assert.equal(legacy.measured_at, legacy.timestamp);
  assert.equal(legacy.created_at, null);
  assert.equal(legacy.user_id, null);
  const measured = '2000-01-01T10:00:00+02:00';
  const created = new Date(Date.now() - 60000).toISOString();
  const record = validateRecord({id:'historical-id', measured_at:measured, created_at:created, user_id:'account-a', values:{heart:72}, source_reference:'Device A'});
  assert.equal(record.id, 'historical-id');
  assert.equal(record.timestamp, '2000-01-01T08:00:00.000Z');
  assert.equal(record.created_at, created);
  assert.equal(record.user_id, 'account-a');
  assert.equal(record.source_reference, 'Device A');
  assert.throws(() => validateRecord({...record, timestamp:'2000-01-01T09:00:00Z'}), /same instant/);
  assert.throws(() => validateRecord({...record, created_at:'2025-02-30T10:00:00Z'}), /does not exist/);
  assert.throws(() => validateRecord({...record, created_at:'2025-01-01T24:00:00Z'}), /invalid/);
  assert.equal(validateRecord({...record, created_at:'2025-01-01T10:00:00.123456+00:00'}).created_at, '2025-01-01T10:00:00.123Z');
});

test('CSV keeps stable observation identifiers and timestamps while imports discard claimed account ownership', () => {
  const record = validateRecord(raw({heart:72}, {id:'original-id', user_id:'account-a', created_at:timestamp, source_reference:'Device, model A', symptoms:'Observed symptom'}));
  const [csv] = parseImport(toCSV([record]), 'archive.csv');
  assert.equal(csv.id, record.id);
  assert.equal(csv.measured_at, record.measured_at);
  assert.equal(csv.created_at, record.created_at);
  assert.equal(csv.source_reference, record.source_reference);
  assert.equal(csv.user_id, null);
  assert.equal(csv.symptoms, 'Observed symptom');
  const [json] = parseImport(JSON.stringify([record]), 'archive.json');
  assert.equal(json.user_id, null);
  const [alias] = parseImport(`measured_at,heart\n${timestamp},72`, 'alias.csv');
  assert.equal(alias.timestamp, timestamp);
});

test('ordinal energy, symptoms and converted glucose preserve actual values without invented precision loss', () => {
  const record = validateRecord(raw({energy:4, glucose:5.2 * 18.0182}, {symptoms:'  Plain text <b>only</b>  '}));
  assert.equal(record.values.energy, 4);
  assert.equal(record.values.glucose, 5.2 * 18.0182);
  assert.equal(record.symptoms, 'Plain text <b>only</b>');
  assert.throws(() => validateRecord(raw({energy:1.5})), /whole number/);
  assert.throws(() => validateRecord(raw({energy:6})), /between/);
  assert.throws(() => validateRecord(raw({heart:72}, {symptoms:['symptom']})), /plain text/);
  assert.throws(() => validateRecord(raw({heart:72}, {symptoms:'x'.repeat(2001)})), /2,000/);
  assert.throws(() => validateRecord(raw({heart:72}, {source_reference:'x'.repeat(2001)})), /2,000/);
  assert.equal(mergeRecords([record], [{...record, id:'another-id', symptoms:'Different symptom'}]).length, 2);
});
