import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSION_STORAGE_KEY, getMissionState, saveMissionState, validateMissionState,
  createCase, appendCaseEvent, setCaseStatus, createConsultation,
  prepareConsultation, serializeConsultation, recordConsultationExport,
  markExternalSharing, packetBytes
} from '../dist/mission.js';

const stamp = () => new Date(Date.now() - 30000).toISOString();
const record = (overrides = {}) => ({
  id: 'observation-1', timestamp: stamp(), source: 'manual',
  values: { heart: 72, oxygen: 98 }, notes: 'Actual test fixture in isolated tests, never deployed as a user observation.', context: 'resting',
  meta: { device: 'Personal cuff', method: 'Seated', signal: 'stable', repeat: 'yes', glucoseTiming: 'unknown', temperatureSite: 'unknown' },
  ...overrides
});
const state = (c, p) => ({ schemaVersion: 1, cases: c ? [c] : [], consultations: p ? [p] : [] });
function memoryStorage(initial) {
  const values = new Map(initial || []);
  return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), clear: () => values.clear() };
}
globalThis.localStorage = memoryStorage();

// All fixtures stay in Node's memory, never in dist data or a real user's storage.
test('cases preserve explicit user symptoms and immutable audit history', () => {
  const r = record(), symptoms = { chestPain: 'unknown', dizziness: 'no', description: '<script>alert(1)</script>' };
  const c = createCase(r, { title: 'Measurement check', summary: '<b>Plain text only</b>', symptoms });
  assert.equal(c.status, 'open');
  assert.deepEqual(c.recordIds, [r.id]);
  assert.equal(c.symptoms.description, '<script>alert(1)</script>');
  assert.equal(c.summary, '<b>Plain text only</b>');
  symptoms.chestPain = 'yes';
  assert.equal(c.symptoms.chestPain, 'unknown');
  const added = appendCaseEvent(c, { type: 'note', text: 'Rechecked the device without changing measurements.' });
  assert.equal(c.events.length, 1);
  assert.equal(added.events.length, 2);
  assert.notStrictEqual(added.symptoms, c.symptoms);
  assert.throws(() => appendCaseEvent(c, { type: 'note', text: 'a'.repeat(2001) }), /2000/);
});

test('record links deduplicate and unknown linked IDs cannot become a complete packet', () => {
  const r = record(), c = createCase(r);
  const same = appendCaseEvent(c, { type: 'reading-linked', text: 'Linked same observation.', recordId: r.id });
  assert.deepEqual(same.recordIds, [r.id]);
  const other = appendCaseEvent(same, { type: 'reading-linked', text: 'Added another observation.', recordId: 'observation-2' });
  assert.deepEqual(other.recordIds, ['observation-1', 'observation-2']);
  assert.throws(() => createConsultation(other, [r], { question: 'Please review the pattern.' }), /missing/);
  assert.throws(() => createConsultation(c, [r, r], { question: 'Review?' }), /duplicated/);
  const packet = createConsultation(other, [r, record({ id: 'observation-2', values: { heart: 74 } })], { question: 'Please review the pattern.' });
  assert.equal(packet.payload.records.length, 2);
});

test('archiving needs a reason and statuses never claim recovery', () => {
  const c = createCase(record());
  assert.throws(() => setCaseStatus(c, 'archived'), /reason/i);
  assert.throws(() => setCaseStatus(c, 'recovered', { reason: 'Better' }), /organizational/);
  assert.throws(() => setCaseStatus(c, 'resolved'), /organizational/);
  assert.throws(() => setCaseStatus(c, 'follow-up', { followUpAt: '2026-02-30T10:00:00Z' }), /valid date/);
  assert.throws(() => setCaseStatus(c, 'follow-up', { followUpAt: 'tomorrow' }), /ISO/);
  const future = new Date(Date.now() + 86400000).toISOString();
  const follow = setCaseStatus(c, 'follow-up', { followUpAt: future, reason: 'User-selected check-in time.' });
  assert.equal(follow.followUpAt, future);
  assert.equal(c.followUpAt, null);
  const archived = setCaseStatus(follow, 'archived', { reason: 'Kept for future reference.' });
  assert.equal(archived.archiveReason, 'Kept for future reference.');
  assert.match(archived.events.at(-1).text, /not a recovery/);
  assert.equal(setCaseStatus(c, 'archived', { reason: 'a'.repeat(2000) }).archiveReason.length, 2000);
});

test('synthetic and training provenance cannot be normalized into a real packet', () => {
  for (const source of ['simulated', 'training', 'demo', 'synthetic', 'sensor', undefined]) {
    assert.throws(() => createCase(record({ source })), /real self-entered/);
  }
  assert.throws(() => createCase(record({ training: true })), /Training/);
  assert.throws(() => createCase(record({ simulated: true })), /Training/);
  const c = createCase(record());
  assert.throws(() => createConsultation(c, [record({ source: 'simulated' })], { question: 'Review?' }), /real self-entered/);
  const p = createConsultation(c, [record()], { question: 'Review?' });
  p.payload.records[0].source = 'simulated';
  assert.throws(() => serializeConsultation(p), /real self-entered/);
});

test('consultation is a stable deep snapshot and retains unknowns and limitations', () => {
  const r = record(), c = createCase(r, { symptoms: { dizziness: 'unknown' } });
  const p = createConsultation(c, [r], { question: 'Could the device context explain this pattern?', context: 'earth' });
  assert.equal(p.status, 'draft');
  assert.equal(p.context, 'earth');
  assert.equal(p.payload.records[0].source, 'manual');
  assert.equal(p.payload.records[0].timestamp, r.timestamp);
  assert.equal(p.payload.records[0].values.heart, 72);
  assert.equal(p.payload.records[0].meta.device, 'Personal cuff');
  assert.equal(p.payload.records[0].meta.signal, 'stable');
  assert.equal(p.payload.records[0].meta.glucoseTiming, 'unknown');
  assert(p.payload.unknowns.length);
  assert(p.payload.limitations.some(v => /not a diagnosis/.test(v)));
  const snapshot = serializeConsultation(p);
  r.values.heart = 110;
  r.notes = 'Changed outside packet';
  c.symptoms.dizziness = 'yes';
  c.events[0].text = 'Changed outside packet';
  assert.equal(serializeConsultation(p), snapshot);
  const deletedOriginals = [];
  assert.equal(deletedOriginals.length, 0);
  assert.equal(JSON.parse(serializeConsultation(p)).payload.records[0].values.heart, 72);
  const copy = prepareConsultation(p);
  copy.payload.records[0].values.heart = 88;
  assert.equal(p.payload.records[0].values.heart, 72);
});

test('question, context, timestamps, and byte count validate actual UTF-8 content', () => {
  const r = record(), c = createCase(r);
  assert.throws(() => createConsultation(c, [r], { question: '  ' }), /question is required/);
  assert.throws(() => createConsultation(c, [r], { question: 'a'.repeat(2001) }), /2000/);
  assert.throws(() => createConsultation(c, [r], { question: 'Review?', context: 'fake-doctor' }), /earth or mission/);
  const p = createConsultation(c, [r], { question: 'هل يمكن مراجعة ظروف هذا القياس؟' });
  assert.equal(packetBytes(p), Buffer.byteLength(serializeConsultation(p), 'utf8'));
  assert(packetBytes(p) > serializeConsultation(p).length);
  assert.throws(() => appendCaseEvent(c, { type: 'note', text: 'Future event', timestamp: new Date(Date.now() + 86400000).toISOString() }), /future/);
  const corrupted = structuredClone(p);
  corrupted.createdAt = '2026-02-30T12:00:00Z';
  assert.throws(() => serializeConsultation(corrupted), /valid date/);
});

test('preparation, export, and declared sharing have no fake send or review state', () => {
  const r = record(), c = createCase(r), draft = createConsultation(c, [r], { question: 'Please review.' });
  assert.throws(() => recordConsultationExport(draft), /Prepare/);
  const prepared = prepareConsultation(draft);
  assert.equal(draft.status, 'draft');
  assert.equal(prepared.status, 'prepared');
  assert.match(prepared.events.at(-1).text, /Nothing was sent/);
  const exported = recordConsultationExport(prepared);
  assert.equal(exported.status, 'exported');
  assert.equal(prepared.status, 'prepared');
  assert.throws(() => markExternalSharing(exported, { channel: '' }), /required/);
  assert.throws(() => markExternalSharing(exported, { channel: 'email', at: new Date(Date.now() + 86400000).toISOString() }), /future/);
  const shared = markExternalSharing(exported, { channel: 'in-person', at: stamp(), note: '<b>User report only</b>' });
  assert.equal(shared.status, 'external-sharing-recorded');
  assert.equal(shared.externalSharing.deliveryVerified, false);
  assert.equal(shared.externalSharing.userDeclared, true);
  assert.match(shared.events.at(-1).text, /not verified/);
  assert.equal(shared.externalSharing.note, '<b>User report only</b>');
  for (const status of ['sent', 'delivered', 'reviewed', 'diagnosed']) {
    assert.throws(() => serializeConsultation({ ...prepared, status }), /Consultation status/);
  }
  assert.throws(() => prepareConsultation(exported), /Only a draft/);
  const tampered = structuredClone(shared); tampered.externalSharing.deliveryVerified = true;
  assert.throws(() => serializeConsultation(tampered), /without verified delivery/);
});

test('state detects unknown IDs, mismatched snapshots, limits, and invalid event links', () => {
  const r = record(), c = createCase(r), p = createConsultation(c, [r], { question: 'Review?' });
  assert.equal(validateMissionState(state(c, p)).consultations.length, 1);
  assert.throws(() => validateMissionState(state(null, p)), /unknown case/);
  assert.throws(() => validateMissionState({ ...state(c, p), schemaVersion: 2 }), /schema/);
  assert.throws(() => validateMissionState({ ...state(c), cases: Array(501).fill(c) }), /500/);
  assert.throws(() => validateMissionState({ ...state(c), consultations: Array(501).fill(p) }), /500/);
  const corrupt = structuredClone(p); corrupt.payload.records[0].id = 'unknown-id';
  assert.throws(() => serializeConsultation(corrupt), /unknown/);
  const mismatch = structuredClone(p); mismatch.payload.symptoms = { changed: 'yes' };
  assert.throws(() => serializeConsultation(mismatch), /preserve/);
  const badCase = structuredClone(c); badCase.events[0].recordId = 'unknown-id';
  assert.throws(() => validateMissionState(state(badCase)), /unknown linked/);
  const badLimits = structuredClone(p); badLimits.payload.limitations = [];
  assert.throws(() => serializeConsultation(badLimits), /limitations/);
});

test('local persistence survives reload and blocks overwrite on corruption or storage failure', () => {
  globalThis.localStorage = memoryStorage();
  assert.deepEqual(getMissionState(), state());
  const r = record(), c = createCase(r), p = prepareConsultation(createConsultation(c, [r], { question: 'Review?' }));
  const saved = saveMissionState(state(c, p));
  assert.deepEqual(getMissionState(), saved);
  saved.cases[0].summary = 'Mutated caller copy';
  assert.notEqual(getMissionState().cases[0].summary, saved.cases[0].summary);
  localStorage.setItem(MISSION_STORAGE_KEY, '{broken');
  assert.throws(() => getMissionState(), /Do not overwrite/);
  assert.throws(() => saveMissionState(state()), /Do not overwrite/);
  assert.equal(localStorage.getItem(MISSION_STORAGE_KEY), '{broken');
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => saveMissionState(state()), /blocked or full/);
  globalThis.localStorage = memoryStorage();
});

test('corrupt workspace restore requires explicit boolean authorization and a valid backup', () => {
  const originalStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = memoryStorage([[MISSION_STORAGE_KEY, '{corrupt-workspace']]);
    const c = createCase(record(), { title: 'Restored case', summary: 'User-selected backup.' });
    const backup = state(c);
    // Neither omitted/false options nor a string from an untrusted source can
    // accidentally opt in to overwriting a corrupt local workspace.
    for (const options of [undefined, {}, { replaceCorrupt: false }, { replaceCorrupt: 'false' }, { replaceCorrupt: 1 }]) {
      assert.throws(() => saveMissionState(backup, options), /Do not overwrite/);
      assert.equal(localStorage.getItem(MISSION_STORAGE_KEY), '{corrupt-workspace');
    }
    const restored = saveMissionState(backup, { replaceCorrupt: true });
    assert.deepEqual(restored, validateMissionState(backup));
    assert.deepEqual(getMissionState(), restored);
    // Restored values remain independent of the provided backup object.
    backup.cases[0].summary = 'Changed after restore';
    assert.equal(getMissionState().cases[0].summary, 'User-selected backup.');
  } finally { globalThis.localStorage = originalStorage; }
});

test('invalid restore never writes, including when corruption replacement is authorized', () => {
  const originalStorage = globalThis.localStorage;
  try {
    let writes = 0, stored = '{corrupt-workspace';
    globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { writes++; stored = value; } };
    const r = record(), c = createCase(r), packet = createConsultation(c, [r], { question: 'Please review.' });
    const invalidCases = [
      { schemaVersion: 2, cases: [], consultations: [] },
      { schemaVersion: 1, cases: [], consultations: [packet] },
      { schemaVersion: 1, cases: [{ ...c, status: 'recovered' }], consultations: [] },
      { schemaVersion: 1, cases: [c], consultations: [{ ...packet, status: 'sent' }] }
    ];
    for (const invalid of invalidCases) {
      assert.throws(() => saveMissionState(invalid, { replaceCorrupt: true }));
      assert.equal(writes, 0);
      assert.equal(stored, '{corrupt-workspace');
    }
    const restored = saveMissionState(state(c, packet), { replaceCorrupt: true });
    assert.equal(writes, 1);
    assert.deepEqual(JSON.parse(stored), restored);
    const validStored = stored;
    assert.throws(() => saveMissionState(invalidCases[0], { replaceCorrupt: true }));
    assert.equal(writes, 1);
    assert.equal(stored, validStored);
  } finally { globalThis.localStorage = originalStorage; }
});
