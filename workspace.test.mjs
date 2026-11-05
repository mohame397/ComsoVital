import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceUI } from '../dist/workspace.js';
import { validateRecord } from '../dist/core.js';
import { createCase, createConsultation, prepareConsultation, saveMissionState, MISSION_STORAGE_KEY } from '../dist/mission.js';

// Browser adapter tests use in-memory storage and modal callbacks only.
// No test observation or synthetic patient is written to the shipped application.
function harness() {
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  let writes = 0, closed = 0, lastModal = null;
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { writes++; values.set(key, String(value)); },
    removeItem: key => { writes++; values.delete(key); }
  };
  const stamp = new Date(Date.now() - 30000).toISOString();
  const records = ['A', 'B'].map((key, index) => validateRecord({
    id: `fixture-record-${key}`, timestamp: stamp, source: 'manual',
    values: { heart: 72 + index }, context: 'resting', notes: 'Isolated regression-test fixture.'
  }));
  const [caseA, caseB] = records.map((record, index) => createCase(record, { title: `Case ${index === 0 ? 'A' : 'B'}` }));
  const [packetA, packetB] = [caseA, caseB].map(value => prepareConsultation(createConsultation(value, records, { question: 'Review the isolated test observation.' })));
  saveMissionState({ schemaVersion: 1, cases: [caseA, caseB], consultations: [packetA, packetB] });
  const ui = createWorkspaceUI({
    t: en => en, esc: value => String(value ?? ''), icon: () => '',
    fmtDate: value => value, fmtTime: () => '',
    modal: (title, subtitle, body) => { lastModal = { title, subtitle, body }; },
    closeModal: () => { closed++; }, toast() {}, download() {}, render() {}, reloadRecords() {},
    getRecords: () => records, getLang: () => 'en'
  });
  return {
    ui, records, caseA, caseB, packetA, packetB,
    action: (action, extra = {}) => ui.action({ dataset: { action, ...extra } }),
    modal: () => lastModal,
    closeCount: () => closed,
    writeCount: () => writes,
    stored: () => localStorage.getItem(MISSION_STORAGE_KEY),
    replaceWithB: () => {
      saveMissionState({ schemaVersion: 1, cases: [caseB], consultations: [packetB] });
      ui.reload(); // Same callback the app uses after another tab restores data.
    },
    cleanup: () => { globalThis.localStorage = originalStorage; }
  };
}
function fields(values) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, String(value));
  return fd;
}

for (const scenario of [
  { name: 'note', action: 'ws-add-note', form: 'ws-case-note', values: { text: 'A note intended only for Case A.' } },
  { name: 'reading link', action: 'ws-link-record', form: 'ws-case-link', values: { recordId: 'fixture-record-B' } },
  { name: 'case status', action: 'ws-case-status', form: 'ws-case-status', values: { status: 'archived', reason: 'Intended only for Case A.', followUpAt: '' } }
]) {
  test(`stale ${scenario.name} form cannot retarget another case after cross-tab restore`, async () => {
    const h = harness();
    try {
      h.action('ws-select-case', { id: h.caseA.id });
      h.action(scenario.action);
      assert.ok(h.modal().body.includes(`name="caseId" value="${h.caseA.id}"`));
      h.replaceWithB();
      const before = h.stored(), writes = h.writeCount();
      await assert.rejects(h.ui.submit({ id: scenario.form }, fields({ ...scenario.values, caseId: h.caseA.id })), /case changed or was removed/i);
      assert.equal(h.stored(), before);
      assert.equal(h.writeCount(), writes, 'a stale form must not write even temporarily');
      assert.equal(h.closeCount(), 0, 'the invalid form stays open for the displayed error');
      assert.deepEqual(h.ui.getState().cases, [h.caseB]);
    } finally { h.cleanup(); }
  });
}

test('stale sharing declaration cannot mark a different consultation as shared', async () => {
  const h = harness();
  try {
    h.action('ws-select-packet', { id: h.packetA.id });
    h.action('ws-share-declaration');
    assert.ok(h.modal().body.includes(`name="packetId" value="${h.packetA.id}"`));
    h.replaceWithB();
    const before = h.stored(), writes = h.writeCount();
    await assert.rejects(h.ui.submit({ id: 'ws-sharing' }, fields({
      packetId: h.packetA.id, confirm: 'on', channel: 'Test-only external channel',
      at: new Date(Date.now() - 60000).toISOString(), note: 'Declaration intended only for Packet A.'
    })), /consultation changed or was removed/i);
    assert.equal(h.stored(), before);
    assert.equal(h.writeCount(), writes);
    assert.equal(h.ui.getState().consultations[0].status, 'prepared');
    assert.equal(h.ui.getState().consultations[0].externalSharing, undefined);
  } finally { h.cleanup(); }
});

test('a bound note keeps its original case even if the visible selection changes', async () => {
  const h = harness();
  try {
    h.action('ws-select-case', { id: h.caseA.id });
    h.action('ws-add-note');
    h.action('ws-select-case', { id: h.caseB.id });
    const note = 'This note belongs to A, regardless of the current selection.';
    assert.equal(await h.ui.submit({ id: 'ws-case-note' }, fields({ caseId: h.caseA.id, text: note })), true);
    const state = h.ui.getState();
    assert.equal(state.cases.find(c => c.id === h.caseA.id).events.at(-1).text, note);
    assert.deepEqual(state.cases.find(c => c.id === h.caseB.id), h.caseB);
    assert.equal(h.closeCount(), 1);
  } finally { h.cleanup(); }
});
