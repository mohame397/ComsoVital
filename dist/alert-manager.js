import { assessRecord, METRICS, validateRecord } from './core.js';

const SEVERITIES = ['info', 'review', 'urgent'];
const STATUSES = ['active', 'acknowledged', 'resolved'];
const CLASSIFICATIONS = ['reference-prompt', 'information'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE_LIMITATION = 'Terrestrial adult reference prompt; not clinically validated astronaut guidance. ';
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, label, max = 6000, required = false) {
  if (value == null) value = '';
  if (typeof value !== 'string' || value.trim().length > max) throw new Error(`${label} must be plain text of no more than ${max} characters.`);
  if (required && !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}
function timestamp(value, label, nullable = false) {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error(`${label} must include an ISO timestamp and timezone.`);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number), [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < Date.UTC(1900, 0, 1) || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || (second !== undefined && second > 59)) throw new Error(`${label} is invalid.`);
  return new Date(time).toISOString();
}
function clock(value) {
  const instant = typeof value === 'function' ? value() : value ?? Date.now();
  return timestamp(typeof instant === 'string' ? instant : new Date(instant).toISOString(), 'Action time');
}
function identifier(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error(`${label} must be a valid identifier.`);
  return value;
}
function newId() {
  return globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 3) | 8).toString(16);
  });
}
function snapshot(raw) {
  if (!object(raw) || !['unknown', 'resting', 'post-exercise', 'other'].includes(raw.context)) throw new Error('Alert snapshot must retain its measurement context.');
  const unit = text(raw.unit, 'Snapshot unit', 30, true);
  let value;
  if (typeof raw.value === 'number' && Number.isFinite(raw.value)) value = raw.value;
  else if (object(raw.value) && Number.isFinite(raw.value.sys) && Number.isFinite(raw.value.dia) && Object.keys(raw.value).every(key => ['sys', 'dia'].includes(key))) value = {sys: raw.value.sys, dia: raw.value.dia};
  else throw new Error('Alert snapshot must retain actual numeric measurement values.');
  return {value, context: raw.context, unit};
}
function normalizeAlert(raw) {
  if (!object(raw) || !UUID.test(raw.id)) throw new Error('Each alert must have a UUID.');
  if (!SEVERITIES.includes(raw.severity) || !STATUSES.includes(raw.status) || !CLASSIFICATIONS.includes(raw.classification)) throw new Error('Alert severity, status or classification is invalid.');
  if (raw.classification === 'information' && raw.severity !== 'info') throw new Error('Educational information cannot have clinical severity.');
  if (typeof raw.is_current !== 'boolean') throw new Error('Alert current-reference state must be explicit.');
  const createdAt = timestamp(raw.created_at, 'Alert creation time'), measuredAt = timestamp(raw.measured_at, 'Measurement time');
  const acknowledgedAt = timestamp(raw.acknowledged_at, 'Acknowledgement time', true), resolvedAt = timestamp(raw.resolved_at, 'Resolution time', true);
  const resolutionNote = text(raw.resolution_note, 'Organizational closure reason', 2000);
  if (raw.status === 'active' && (acknowledgedAt || resolvedAt)) throw new Error('An active alert cannot contain acknowledgement or resolution timestamps.');
  if (raw.status === 'acknowledged' && (!acknowledgedAt || resolvedAt)) throw new Error('An acknowledged alert requires its acknowledgement time and remains unresolved.');
  if (raw.status === 'resolved' && (!resolvedAt || !resolutionNote)) throw new Error('Organizational closure requires its timestamp and explicit reason.');
  if ((acknowledgedAt && Date.parse(acknowledgedAt) < Date.parse(createdAt)) || (resolvedAt && Date.parse(resolvedAt) < Date.parse(createdAt)) || (resolvedAt && acknowledgedAt && Date.parse(resolvedAt) < Date.parse(acknowledgedAt))) throw new Error('Alert actions cannot precede its creation or acknowledgement.');
  const referenceUrl = text(raw.reference_url, 'Reference URL', 2000);
  if (referenceUrl && !/^https:\/\//i.test(referenceUrl)) throw new Error('Alert references must use HTTPS.');
  return {
    id: raw.id, related_reading_id: identifier(raw.related_reading_id, 'Related observation ID'),
    parameter_name: text(raw.parameter_name, 'Parameter name', 100, true), severity: raw.severity,
    message: text(raw.message, 'Alert message', 6000, true), status: raw.status,
    created_at: createdAt, measured_at: measuredAt, acknowledged_at: acknowledgedAt, resolved_at: resolvedAt,
    resolution_note: resolutionNote, reference_url: referenceUrl, classification: raw.classification,
    dedupe_key: text(raw.dedupe_key, 'Deduplication key', 300, true), is_current: raw.is_current, snapshot: snapshot(raw.snapshot)
  };
}

export function validateAlerts(raw) {
  if (!Array.isArray(raw) || raw.length > 100000) throw new Error('Alerts must be an array of no more than 100,000 entries.');
  const result = raw.map(normalizeAlert);
  if (new Set(result.map(alert => alert.id)).size !== result.length) throw new Error('Alert IDs must be unique.');
  if (new Set(result.map(alert => alert.dedupe_key)).size !== result.length) throw new Error('Alert deduplication keys must be unique.');
  return result;
}
function readingSnapshot(record, metric) {
  return metric === 'bp' ? {value: {sys: record.values.sys, dia: record.values.dia}, context: record.context, unit: 'mmHg'} : {value: record.values[metric], context: record.context, unit: METRICS[metric].unit};
}
function promptKey(record, metric) {
  const values = metric === 'bp' ? `${record.values.sys}/${record.values.dia}` : String(record.values[metric]);
  return `${record.id}:${metric}:terrestrial-reference-v1:${record.measured_at}:${record.context}:${values}`;
}

/** Retains historical prompts; edits/deletions affect applicability, never clinical resolution. */
export function reconcileAlerts(existing, records, {now} = {}) {
  const previous = validateAlerts(existing), at = clock(now);
  if (!Array.isArray(records)) throw new Error('Observation records must be an array.');
  const canonical = records.map(validateRecord);
  if (new Set(canonical.map(record => record.id)).size !== canonical.length) throw new Error('Observation IDs must be unique before alert reconciliation.');
  const next = new Map(previous.map(alert => [alert.dedupe_key, {...alert, is_current: false}]));
  for (const record of canonical) {
    for (const prompt of assessRecord(record)) {
      const information = prompt.metric === 'mood';
      const key = promptKey(record, prompt.metric), prior = next.get(key);
      next.set(key, {
        id: prior?.id || newId(), related_reading_id: record.id, parameter_name: prompt.metric,
        severity: information ? 'info' : prompt.severity,
        message: information ? 'Personal wellbeing check-in; this ordinal score is not a validated mental health threshold. Consider discussing concerns with your support or medical lead.' : REFERENCE_LIMITATION + prompt.detail,
        status: prior?.status || 'active', created_at: prior?.created_at || at, measured_at: record.measured_at,
        acknowledged_at: prior?.acknowledged_at || null, resolved_at: prior?.resolved_at || null,
        resolution_note: prior?.resolution_note || '', reference_url: prompt.sourceUrl || '',
        classification: information ? 'information' : 'reference-prompt', dedupe_key: key,
        is_current: true, snapshot: readingSnapshot(record, prompt.metric)
      });
    }
  }
  return sortAlerts([...next.values()]);
}

export function acknowledgeAlert(alerts, id, {now} = {}) {
  const canonical = validateAlerts(alerts), target = canonical.find(alert => alert.id === id);
  if (!target) throw new Error('The selected alert no longer exists.');
  if (target.status !== 'active') return clone(canonical);
  const at = clock(now);
  return validateAlerts(canonical.map(alert => alert.id === id ? {...alert, status: 'acknowledged', acknowledged_at: at} : alert));
}

/** A user records organizational closure; it does not certify recovery or clinical review. */
export function resolveAlert(alerts, id, {reason, now} = {}) {
  const canonical = validateAlerts(alerts), target = canonical.find(alert => alert.id === id);
  if (!target) throw new Error('The selected alert no longer exists.');
  const note = text(reason, 'Organizational closure reason', 2000, true);
  if (target.status === 'resolved') return clone(canonical);
  const at = clock(now);
  return validateAlerts(canonical.map(alert => alert.id === id ? {...alert, status: 'resolved', resolved_at: at, resolution_note: note} : alert));
}

export function alertCounts(alerts) {
  const canonical = validateAlerts(alerts), count = {active: 0, acknowledged: 0, resolved: 0, total: canonical.length, current: 0, information: 0, reference: 0};
  for (const alert of canonical) { count[alert.status]++; if (alert.is_current) count.current++; count[alert.classification === 'information' ? 'information' : 'reference']++; }
  return count;
}
export function sortAlerts(alerts) {
  const rank = {urgent: 0, review: 1, info: 2};
  return validateAlerts(alerts).sort((a, b) => rank[a.severity] - rank[b.severity] || Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id));
}
