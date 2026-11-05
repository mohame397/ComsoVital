import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceUI} from '../dist/workspace.js';
import {validateRecord} from '../dist/core.js';
import {createCase} from '../dist/mission.js';

const stamp = new Date(Date.now() - 30000).toISOString();
function setup({save, restore, exportValue} = {}) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() {throw new Error('Account workspaces must not access browser health storage.');}});
  const record = validateRecord({id: 'account-fixture', timestamp: stamp, source: 'manual', values: {heart: 72}, context: 'resting', notes: 'Isolated adapter fixture.'});
  const entry = createCase(record, {title: 'Private test case'});
  let current = {schemaVersion: 1, cases: [entry], consultations: []}, closed = 0, download;
  const ui = createWorkspaceUI({
    t: en => en, esc: value => String(value ?? ''), icon: () => '', fmtDate: value => value, fmtTime: () => '',
    modal() {}, closeModal() {closed++;}, toast() {}, render() {}, reloadRecords() {}, getLang: () => 'en', getRecords: () => [record],
    getPersistence: () => ({configured: true, user: {id: 'account-A'}}), getMissionState: () => structuredClone(current),
    async saveMissionState(next) {if (save) await save(next); current = structuredClone(next); return current;},
    async restoreWorkspace(value) {const result = restore ? await restore(value) : value; current = result.missionState; return result;},
    exportWorkspace: () => exportValue,
    download(value, name) {download = {value, name};}
  });
  return {ui, entry, record, current: () => current, closeCount: () => closed, download: () => download, cleanup() {if (old) Object.defineProperty(globalThis, 'localStorage', old); else delete globalThis.localStorage;}};
}
function fields(values) {const fd = new FormData(); for (const [key, value] of Object.entries(values)) fd.set(key, value); return fd;}

test('case forms await confirmed account save before applying state or closing the modal', async () => {
  let complete; const pending = new Promise(resolve => {complete = resolve;});
  const h = setup({save: () => pending});
  try {
    const write = h.ui.submit({id: 'ws-case-note'}, fields({caseId: h.entry.id, text: 'A note pending server confirmation.'}));
    await Promise.resolve(); assert.equal(h.closeCount(), 0); assert.equal(h.current().cases[0].events.length, 1);
    complete(); assert.equal(await write, true); assert.equal(h.closeCount(), 1); assert.equal(h.current().cases[0].events.at(-1).text, 'A note pending server confirmation.');
  } finally {h.cleanup();}
});

test('failed account save preserves the previous case and leaves the form open', async () => {
  const h = setup({save: () => {throw new Error('Network unavailable; not remotely saved.');}});
  try {
    await assert.rejects(h.ui.submit({id: 'ws-case-note'}, fields({caseId: h.entry.id, text: 'Unsaved note.'})), /not remotely saved/);
    assert.equal(h.closeCount(), 0); assert.equal(h.ui.getState().cases[0].events.length, 1);
  } finally {h.cleanup();}
});

test('version3 full account restore delegates one atomic snapshot without browser health storage', async () => {
  let passed; const h = setup({restore: value => {passed = structuredClone(value); return value;}});
  try {
    const backup = {app: 'CosmoVital', schemaVersion: 3, records: [], missionState: {schemaVersion: 1, cases: [], consultations: []}, alerts: []};
    const fd = fields({confirm: 'on'}); fd.set('file', new Blob([JSON.stringify(backup)], {type: 'application/json'}), 'backup.json');
    assert.equal(await h.ui.submit({id: 'ws-restore'}, fd), true);
    assert.deepEqual(passed, {records: [], missionState: backup.missionState, alerts: []}); assert.equal(h.closeCount(), 1); assert.equal(h.ui.getState().cases.length, 0);
  } finally {h.cleanup();}
});

test('backup exports the shared store snapshot including persisted alert history', async () => {
  const exported = {app: 'CosmoVital', schemaVersion: 3, records: [], missionState: {schemaVersion: 1, cases: [], consultations: []}, alerts: [{id: 'fixture-alert'}]};
  const h = setup({exportValue: exported});
  try {await h.ui.action({dataset: {action: 'ws-backup'}}); assert.deepEqual(JSON.parse(h.download().value), exported);}
  finally {h.cleanup();}
});
