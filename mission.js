/**
 * CosmoVital v2 organizational case and consultation workspace.
 * This module stores user-authored records locally. It never sends a message,
 * claims delivery, makes a diagnosis, or treats a workflow status as recovery.
 */
import { validateRecord } from './core.js';

export const MISSION_STORAGE_KEY = 'cosmovital-mission-v2';
const CASE_STATUSES = ['open', 'follow-up', 'awaiting-review', 'archived'];
const PACKET_STATUSES = ['draft', 'prepared', 'exported', 'external-sharing-recorded'];
const MAX_CASES = 500, MAX_PACKETS = 500, MAX_EVENTS = 2000, MAX_LINKS = 10000;
const LIMITATIONS = [
  'This is a user-prepared observation packet, not a diagnosis, treatment plan, or validated flight medical system.',
  'Measurements are self-entered or imported and have not been independently verified. Imported provenance is not proof of sensor accuracy.',
  'Missing measurements, device details, methods, symptoms, and context remain unknown; no values are inferred.',
  'Any review prompts use broad terrestrial adult references, not validated astronaut medical limits.',
  'Preparation and export do not send this packet, connect to a clinician, establish affiliation, or confirm receipt.',
  'An external-sharing entry is a user declaration only, not evidence of delivery or medical review.'
];
const badKeys = new Set(['__proto__', 'prototype', 'constructor']);
const object = v => v !== null && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const clone = v => JSON.parse(JSON.stringify(v));
const now = () => new Date().toISOString();
function id(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)}`; }
function identifier(v, label) {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v)) throw new Error(`${label} must be a valid identifier.`);
  return v;
}
function text(v, label, max = 2000, required = false) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new Error(`${label} must be plain text.`);
  const result = v.trim();
  if (result.length > max) throw new Error(`${label} must contain no more than ${max} characters.`);
  if (required && !result) throw new Error(`${label} is required.`);
  return result;
}
function timestamp(v, label, future = false) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(v)) throw new Error(`${label} must be an ISO timestamp with a timezone.`);
  const time = Date.parse(v), [year, month, day] = v.slice(0, 10).split('-').map(Number), clock = v.slice(11, 19).split(':').map(Number);
  if (!Number.isFinite(time) || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || clock[0] > 23 || clock[1] > 59 || (clock[2] !== undefined && clock[2] > 59)) throw new Error(`${label} is not a valid date and time.`);
  if (!future && time > Date.now() + 300000) throw new Error(`${label} cannot be in the future.`);
  return new Date(time).toISOString();
}
function symptomsObject(raw = {}) {
  if (!object(raw)) throw new Error('Symptoms must be an object of user-entered values.');
  let count = 0;
  function visit(v, depth) {
    if (++count > 500 || depth > 5) throw new Error('Symptoms contain too many entries or levels.');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') return text(v, 'Symptom text');
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(x => visit(x, depth + 1));
    if (object(v)) {
      const result = {};
      for (const [key, value] of Object.entries(v)) {
        if (badKeys.has(key) || key.length > 100 || !key.trim()) throw new Error('Invalid symptom field name.');
        result[key] = visit(value, depth + 1);
      }
      return result;
    }
    throw new Error('Symptoms must contain plain JSON values, not functions or objects with unknown values.');
  }
  return visit(raw, 0);
}
function event(raw) {
  if (!object(raw)) throw new Error('Each audit event must be an object.');
  const type = text(raw.type, 'Event type', 60, true);
  if (!/^[a-z][a-z0-9-]*$/.test(type)) throw new Error('Use a plain organizational event type.');
  const out = { id: identifier(raw.id, 'Event ID'), timestamp: timestamp(raw.timestamp, 'Event time'), type, text: text(raw.text, 'Event text', 4000, true) };
  if (raw.recordId !== undefined) out.recordId = identifier(raw.recordId, 'Linked record ID');
  if (raw.channel !== undefined) out.channel = text(raw.channel, 'Sharing channel', 100, true);
  if (raw.sharedAt !== undefined) out.sharedAt = timestamp(raw.sharedAt, 'Declared sharing time');
  if (raw.userDeclared !== undefined) {
    if (raw.userDeclared !== true || raw.deliveryVerified !== false) throw new Error('External sharing must be explicitly unverified and user-declared.');
    out.userDeclared = true; out.deliveryVerified = false;
  }
  return out;
}
function events(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_EVENTS) throw new Error(`Keep between 1 and ${MAX_EVENTS} audit events.`);
  const parsed = raw.map(event);
  if (new Set(parsed.map(e => e.id)).size !== parsed.length) throw new Error('Audit event IDs must be unique.');
  return parsed;
}
function caseObject(raw) {
  if (!object(raw)) throw new Error('Each case must be an object.');
  const status = raw.status;
  if (!CASE_STATUSES.includes(status)) throw new Error('Choose an organizational case status: open, follow-up, awaiting-review, or archived.');
  if (!Array.isArray(raw.recordIds) || !raw.recordIds.length || raw.recordIds.length > MAX_LINKS) throw new Error('A case must link at least one observation.');
  const recordIds = [...new Set(raw.recordIds.map(v => identifier(v, 'Linked record ID')))];
  const createdAt = timestamp(raw.createdAt, 'Case creation time'), updatedAt = timestamp(raw.updatedAt, 'Case update time');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error('Case update time cannot precede creation time.');
  const archiveReason = text(raw.archiveReason, 'Archive reason');
  if (status === 'archived' && !archiveReason) throw new Error('An archive reason is required. Archiving is organizational and does not mean recovery.');
  const parsedEvents = events(raw.events);
  for (const e of parsedEvents) if (e.recordId && !recordIds.includes(e.recordId)) throw new Error('A case audit event refers to an unknown linked observation.');
  return {
    id: identifier(raw.id, 'Case ID'), title: text(raw.title, 'Case title', 200, true), summary: text(raw.summary, 'Case summary'),
    createdAt, updatedAt, recordIds, symptoms: symptomsObject(raw.symptoms), events: parsedEvents,
    status, followUpAt: raw.followUpAt == null || raw.followUpAt === '' ? null : timestamp(raw.followUpAt, 'Follow-up time', true), archiveReason
  };
}
function realRecord(raw) {
  if (!object(raw) || !['manual', 'imported'].includes(raw.source) || raw.training === true || raw.simulated === true || raw.synthetic === true || raw.isTraining === true) throw new Error('Only real self-entered or imported observations can be linked. Training or simulated readings are not allowed.');
  identifier(raw.id, 'Observation ID');
  // Core validates values and measurement metadata; this clone has no shared refs.
  return clone(validateRecord(raw));
}
function packetObject(raw) {
  if (!object(raw)) throw new Error('Each consultation must be an object.');
  if (!PACKET_STATUSES.includes(raw.status)) throw new Error('Consultation status must be draft, prepared, exported, or external-sharing-recorded. No delivery or review is implied.');
  if (!['earth', 'mission'].includes(raw.context)) throw new Error('Choose earth or mission consultation context.');
  if (!object(raw.payload) || raw.payload.schemaVersion !== 1) throw new Error('Unsupported consultation payload schema.');
  const snapshot = caseObject(raw.payload.case);
  const caseId = identifier(raw.caseId, 'Consultation case ID');
  if (snapshot.id !== caseId) throw new Error('Consultation snapshot does not match its case ID.');
  if (!Array.isArray(raw.payload.records) || raw.payload.records.length !== snapshot.recordIds.length) throw new Error('Consultation must contain every linked observation exactly once.');
  const records = raw.payload.records.map(realRecord), recordIds = records.map(r => r.id);
  if (new Set(recordIds).size !== recordIds.length || snapshot.recordIds.some(key => !recordIds.includes(key))) throw new Error('Consultation contains duplicate, unknown, or missing observation IDs.');
  const createdAt = timestamp(raw.createdAt, 'Consultation creation time'), updatedAt = timestamp(raw.updatedAt, 'Consultation update time');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error('Consultation update time cannot precede creation time.');
  const parsedEvents = events(raw.events);
  const payloadEvents = events(raw.payload.events);
  if (JSON.stringify(payloadEvents) !== JSON.stringify(snapshot.events) || JSON.stringify(symptomsObject(raw.payload.symptoms)) !== JSON.stringify(snapshot.symptoms)) throw new Error('Consultation payload must preserve the case symptom and audit snapshots.');
  if (!Array.isArray(raw.payload.limitations) || !LIMITATIONS.every(v => raw.payload.limitations.includes(v))) throw new Error('Consultation limitations must be retained.');
  const out = {
    id: identifier(raw.id, 'Consultation ID'), caseId, createdAt, updatedAt,
    question: text(raw.question, 'Consultation question', 2000, true), context: raw.context, status: raw.status,
    payload: { case: snapshot, records, symptoms: clone(snapshot.symptoms), events: clone(snapshot.events), limitations: [...LIMITATIONS],
      unknowns: ['Unrecorded values are unknown.', 'Device and method details may be unknown.', 'No independent measurement verification or recipient confirmation is available.'], schemaVersion: 1 },
    events: parsedEvents
  };
  if (raw.externalSharing !== undefined) {
    if (!object(raw.externalSharing) || raw.externalSharing.userDeclared !== true || raw.externalSharing.deliveryVerified !== false) throw new Error('External sharing must be a user declaration without verified delivery.');
    out.externalSharing = { channel: text(raw.externalSharing.channel, 'Sharing channel', 100, true), at: timestamp(raw.externalSharing.at, 'Declared sharing time'), note: text(raw.externalSharing.note, 'Sharing note'), userDeclared: true, deliveryVerified: false };
  }
  if (raw.status === 'external-sharing-recorded' && !out.externalSharing) throw new Error('An external sharing declaration is required for this status.');
  return out;
}
function newEvent(type, value, extra = {}) { return event({ id: id('cve'), timestamp: now(), type, text: value, ...extra }); }

/** Validate and return a fresh canonical state, without mutating input. */
export function validateMissionState(raw) {
  if (!object(raw) || raw.schemaVersion !== 1) throw new Error('Unsupported mission workspace schema.');
  if (!Array.isArray(raw.cases) || raw.cases.length > MAX_CASES || !Array.isArray(raw.consultations) || raw.consultations.length > MAX_PACKETS) throw new Error(`Keep no more than ${MAX_CASES} cases and ${MAX_PACKETS} consultation packets.`);
  const cases = raw.cases.map(caseObject), consultations = raw.consultations.map(packetObject);
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Case IDs must be unique.');
  if (new Set(consultations.map(c => c.id)).size !== consultations.length) throw new Error('Consultation IDs must be unique.');
  if (consultations.some(packet => !cases.some(c => c.id === packet.caseId))) throw new Error('A consultation refers to an unknown case.');
  return { schemaVersion: 1, cases, consultations };
}
function localStore() { try { if (!globalThis.localStorage) throw new Error(); return globalThis.localStorage; } catch { throw new Error('Browser storage is unavailable. Export a backup before leaving this page.'); } }
export function getMissionState() {
  let value;
  try { value = localStore().getItem(MISSION_STORAGE_KEY); } catch (e) { throw new Error(`Mission workspace could not be read. ${e.message}`); }
  if (value === null) return { schemaVersion: 1, cases: [], consultations: [] };
  try { return validateMissionState(JSON.parse(value)); }
  catch { throw new Error('Saved mission workspace is unreadable or invalid. Do not overwrite it; recover an exported backup.'); }
}
export function saveMissionState(raw, { replaceCorrupt = false } = {}) {
  const state = validateMissionState(raw);
  // Detect existing corruption before replacing it, even if callers skipped load.
  if (replaceCorrupt !== true) getMissionState();
  try { localStore().setItem(MISSION_STORAGE_KEY, JSON.stringify(state)); }
  catch { throw new Error('Mission workspace could not be saved. Browser storage may be blocked or full. Export a backup.'); }
  return state;
}
export function createCase(record, { title = 'Measurement review', summary = '', symptoms = {} } = {}) {
  const canonical = realRecord(record), time = now();
  return caseObject({ id: id('cvc'), title, summary, createdAt: time, updatedAt: time, recordIds: [canonical.id], symptoms,
    events: [newEvent('opened', 'Case opened by the user. This organizational status does not establish a diagnosis.', { recordId: canonical.id })],
    status: 'open', followUpAt: null, archiveReason: '' });
}
export function appendCaseEvent(value, { type, text: content, recordId, timestamp: at } = {}) {
  const current = caseObject(value);
  const entry = newEvent(type, text(content, 'Case note', 2000, true), { ...(recordId === undefined ? {} : { recordId }), ...(at === undefined ? {} : { timestamp: at }) });
  const recordIds = recordId === undefined ? current.recordIds : [...new Set([...current.recordIds, identifier(recordId, 'Linked record ID')])];
  return caseObject({ ...current, recordIds, updatedAt: now(), events: [...current.events, entry] });
}
export function setCaseStatus(value, status, { reason = '', followUpAt = null } = {}) {
  const current = caseObject(value);
  if (!CASE_STATUSES.includes(status)) throw new Error('Choose an organizational case status.');
  const note = text(reason, status === 'archived' ? 'Archive reason' : 'Status note', 2000, status === 'archived');
  const followUp = followUpAt == null || followUpAt === '' ? null : timestamp(followUpAt, 'Follow-up time', true);
  return caseObject({ ...current, status, followUpAt: followUp, archiveReason: status === 'archived' ? note : '', updatedAt: now(),
    events: [...current.events, newEvent('status-changed', `User set organizational status to ${status}.${note ? ' ' + note : ''}${followUp ? ' Manual follow-up: ' + followUp + '.' : ''} This is not a recovery or treatment outcome.`)] });
}
export function createConsultation(value, allRecords, { question, context = 'mission' } = {}) {
  const current = caseObject(value);
  if (!Array.isArray(allRecords)) throw new Error('Provide the available observations.');
  const linked = current.recordIds.map(key => {
    const matches = allRecords.filter(r => r?.id === key);
    if (matches.length !== 1) throw new Error(`Linked observation ${key} is missing or duplicated. A complete packet cannot be prepared.`);
    return realRecord(matches[0]);
  });
  const time = now();
  return packetObject({ id: id('cvp'), caseId: current.id, createdAt: time, updatedAt: time, question, context, status: 'draft',
    payload: { case: clone(current), records: linked, symptoms: clone(current.symptoms), events: clone(current.events), limitations: [...LIMITATIONS], schemaVersion: 1 },
    events: [newEvent('drafted', 'Consultation draft created locally by the user. No clinician has been contacted.')] });
}
export function prepareConsultation(value) {
  const current = packetObject(value);
  if (current.status === 'prepared') return current;
  if (current.status !== 'draft') throw new Error('Only a draft can be prepared. Existing exported snapshots remain unchanged.');
  return packetObject({ ...current, status: 'prepared', updatedAt: now(), events: [...current.events, newEvent('prepared', 'Packet prepared locally for user review. Nothing was sent.')] });
}
export function serializeConsultation(value) { return JSON.stringify(packetObject(value), null, 2); }
export function packetBytes(value) { return new TextEncoder().encode(serializeConsultation(value)).byteLength; }
export function recordConsultationExport(value) {
  const current = packetObject(value);
  if (current.status === 'draft') throw new Error('Prepare the consultation packet before recording an export.');
  return packetObject({ ...current, status: 'exported', updatedAt: now(),
    events: [...current.events, newEvent('export-recorded', 'User initiated a local packet export. This does not verify a completed download, sharing, delivery, or medical review.')] });
}
export function markExternalSharing(value, { channel, at = now(), note = '' } = {}) {
  const current = packetObject(value);
  if (current.status === 'draft') throw new Error('Prepare the consultation packet before recording external sharing.');
  const declaration = { channel: text(channel, 'Sharing channel', 100, true), at: timestamp(at, 'Declared sharing time'), note: text(note, 'Sharing note'), userDeclared: true, deliveryVerified: false };
  return packetObject({ ...current, status: 'external-sharing-recorded', updatedAt: now(), externalSharing: declaration,
    events: [...current.events, newEvent('external-sharing-recorded', `User reports sharing externally via ${declaration.channel}.${declaration.note ? ' ' + declaration.note : ''} Delivery and recipient review are not verified.`,
      { channel: declaration.channel, sharedAt: declaration.at, userDeclared: true, deliveryVerified: false })] });
}
