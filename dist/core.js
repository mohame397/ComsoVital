/**
 * CosmoVital data layer. All records are user-entered or imported observations.
 * Plausibility limits reject likely unit/input errors; they are not normal ranges.
 * Screening references are terrestrial adult references, NOT validated astronaut
 * thresholds. They do not diagnose disease, replace symptoms, or prescribe care.
 */
export const STORAGE_KEY = 'cosmovital-records-v1';
export const METRICS = Object.freeze({
  heart: { label: 'Heart rate', ar: 'معدل ضربات القلب', unit: 'bpm', min: 20, max: 250, step: 1, color: '#e17561' },
  oxygen: { label: 'Blood oxygen', ar: 'تشبع الأكسجين', unit: '%', min: 50, max: 100, step: 1, color: '#5b93b4' },
  sleep: { label: 'Sleep duration', ar: 'مدة النوم', unit: 'h', min: 0, max: 24, step: 0.1, color: '#8c80b4' },
  temp: { label: 'Body temperature', ar: 'درجة حرارة الجسم', unit: '°C', min: 30, max: 43, step: 0.1, color: '#d3a55f' },
  sys: { label: 'Systolic pressure', ar: 'الضغط الانقباضي', unit: 'mmHg', min: 50, max: 260, step: 1, color: '#739b8c' },
  dia: { label: 'Diastolic pressure', ar: 'الضغط الانبساطي', unit: 'mmHg', min: 30, max: 180, step: 1, color: '#739b8c' },
  glucose: { label: 'Blood glucose', ar: 'سكر الدم', unit: 'mg/dL', min: 20, max: 600, step: 0.1, color: '#d3a55f' },
  hrv: { label: 'Heart rate variability', ar: 'تباين معدل ضربات القلب', unit: 'ms', min: 0, max: 300, step: 0.1, color: '#6e9e99' },
  eda: { label: 'Electrodermal activity', ar: 'النشاط الكهربي للجلد', unit: 'µS', min: 0, max: 100, step: 0.1, color: '#9c8bb0' },
  energy: { label: 'Energy / fatigue', ar: 'الطاقة / الإرهاق', unit: '/5', min: 1, max: 5, step: 1, color: '#6e9e99' },
  mood: { label: 'Mood', ar: 'الحالة المزاجية', unit: '/5', min: 1, max: 5, step: 1, color: '#799eb0' }
});

export const META_DEFAULTS = Object.freeze({ device: '', method: '', repeat: 'unknown', signal: 'unknown', glucoseTiming: 'unknown', temperatureSite: 'unknown' });
const META_ENUMS = Object.freeze({
  repeat: ['unknown', 'yes', 'no'], signal: ['unknown', 'stable', 'unstable'],
  glucoseTiming: ['unknown', 'fasting', 'after-meal', 'other'],
  temperatureSite: ['unknown', 'oral', 'axillary', 'ear', 'forehead', 'other']
});
const META_KEYS = Object.keys(META_DEFAULTS);
const META_COLUMNS = META_KEYS.map(key => `meta_${key}`);

/** Explicit training flags are rejected before imports can relabel their source. */
function assertPersonalObservation(raw) {
  if (!raw || typeof raw !== 'object') return;
  const trueFlag = value => value === true || (typeof value === 'string' && ['true', 'yes', '1'].includes(value.trim().toLowerCase()));
  const sourceLabels = [raw.source, raw.source_type, raw.mode];
  if (trueFlag(raw.training) || trueFlag(raw.simulated) || trueFlag(raw.synthetic) || sourceLabels.some(label =>
    typeof label === 'string' && /(?:^|[^a-z])(?:training|simulat(?:ed|ion)|demo|synthetic)(?:$|[^a-z])/i.test(label))) {
    throw new Error('Training or simulated observations cannot be used as personal health records.');
  }
}

function normalizeMeta(input) {
  if (input != null && !plainObject(input)) throw new Error('Measurement metadata must be an object.');
  const raw = input || {};
  const unknown = Object.keys(raw).find(key => !META_KEYS.includes(key));
  if (unknown) throw new Error(`Unknown measurement metadata: ${unknown}.`);
  const meta = { ...META_DEFAULTS };
  for (const [key, max] of [['device', 100], ['method', 200]]) {
    if (raw[key] === undefined || raw[key] === null) continue;
    if (typeof raw[key] !== 'string') throw new Error(`Measurement ${key} must be plain text.`);
    const value = raw[key].trim();
    if (value.length > max) throw new Error(`Measurement ${key} must contain no more than ${max} characters.`);
    meta[key] = value;
  }
  for (const [key, allowed] of Object.entries(META_ENUMS)) {
    const value = raw[key];
    // Blank CSV fields represent unknown, as do fields absent in older records.
    if (value === undefined || value === null || value === '') continue;
    if (!allowed.includes(value)) throw new Error(`Invalid measurement metadata ${key}. Choose ${allowed.join(', ')}.`);
    meta[key] = value;
  }
  return meta;
}

const CONTEXTS = ['unknown', 'resting', 'post-exercise', 'other'];
const KEYS = Object.keys(METRICS);
const MAX_RECORDS = 10000;
const FIVE_MINUTES = 5 * 60 * 1000;
const EARLIEST_TIMESTAMP = Date.UTC(1900, 0, 1);
const SOURCES = Object.freeze({
  heart: 'https://www.heart.org/en/healthy-living/exercise-and-physical-activity/fitness-basics/target-heart-rates',
  oxygen: 'https://medlineplus.gov/lab-tests/pulse-oximetry/',
  sleep: 'https://www.cdc.gov/sleep/about/index.html',
  temp: 'https://www.nhs.uk/symptoms/fever-in-adults/',
  bp: 'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings'
});

function newId() {
  return globalThis.crypto?.randomUUID?.() || `cv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function timestampValue(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} timestamp is required.`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error(`${label} timestamp must be ISO with a timezone, for example 2026-01-01T10:00:00Z.`);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  if (hour > 23 || minute > 59 || (second !== undefined && second > 59)) throw new Error(`${label} time is invalid.`);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error(`${label} date does not exist.`);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} timestamp is invalid.`);
  if (time < EARLIEST_TIMESTAMP) throw new Error(`${label} timestamp cannot be earlier than 1900.`);
  if (time > Date.now() + FIVE_MINUTES) throw new Error(`${label} timestamp cannot be more than five minutes in the future.`);
  return time;
}

/** Validate one observation, returning a canonical object and never coercing blanks to zero. */
export function validateRecord(raw) {
  if (!plainObject(raw)) throw new Error('Each observation must be an object.');
  assertPersonalObservation(raw);
  const time = timestampValue(raw.measured_at ?? raw.timestamp, 'Observation');
  if (raw.timestamp != null && raw.measured_at != null && timestampValue(raw.timestamp, 'Observation') !== time) throw new Error('timestamp and measured_at must identify the same instant.');
  const createdAt = raw.created_at == null || raw.created_at === '' ? null : new Date(timestampValue(raw.created_at, 'Creation')).toISOString();
  const owner = raw.user_id == null || raw.user_id === '' ? null : raw.user_id;
  if (owner !== null && (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(owner))) throw new Error('User ID must be a valid identifier.');
  if (raw.source_reference != null && typeof raw.source_reference !== 'string') throw new Error('Source reference must be plain text.');
  const sourceReference = (raw.source_reference || '').trim();
  if (sourceReference.length > 2000) throw new Error('Source reference must contain no more than 2,000 characters.');
  if (raw.symptoms != null && typeof raw.symptoms !== 'string') throw new Error('Symptoms must be plain text.');
  const symptoms = (raw.symptoms || '').trim();
  if (symptoms.length > 2000) throw new Error('Symptoms must contain no more than 2,000 characters.');
  if (!plainObject(raw.values)) throw new Error('Observation values must be an object.');
  const unknown = Object.keys(raw.values).filter(key => !KEYS.includes(key));
  if (unknown.length) throw new Error(`Unknown measurement: ${unknown[0]}.`);
  const values = {};
  for (const key of KEYS) {
    const value = raw.values[key];
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if ((typeof value !== 'number' && typeof value !== 'string') ||
        (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) {
      throw new Error(`${METRICS[key].label} must be a number.`);
    }
    const numeric = Number(value);
    const metric = METRICS[key];
    if (!Number.isFinite(numeric) || numeric < metric.min || numeric > metric.max) {
      throw new Error(`${metric.label} must be between ${metric.min} and ${metric.max} ${metric.unit}. Check the unit.`);
    }
    if (metric.step === 1 && !Number.isInteger(numeric)) throw new Error(`${metric.label} must be a whole number.`);
    values[key] = numeric;
  }
  if (!Object.keys(values).length) throw new Error('Enter at least one measurement.');
  if ((values.sys === undefined) !== (values.dia === undefined)) throw new Error('Enter both systolic and diastolic blood pressure, or leave both blank.');
  if (values.sys !== undefined && values.sys <= values.dia) throw new Error('Systolic blood pressure must be greater than diastolic blood pressure. Check the order.');
  const context = raw.context || 'unknown';
  if (!CONTEXTS.includes(context)) throw new Error('Choose unknown, resting, post-exercise, or other measurement context.');
  if (raw.notes != null && typeof raw.notes !== 'string') throw new Error('Notes must be plain text.');
  const notes = (raw.notes || '').trim();
  if (notes.length > 1000) throw new Error('Notes must contain no more than 1,000 characters.');
  // Notes remain plain text. All rendering must use textContent, never innerHTML.
  return {
    id: typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(raw.id) ? raw.id : newId(),
    timestamp: new Date(time).toISOString(),
    measured_at: new Date(time).toISOString(),
    created_at: createdAt,
    user_id: owner,
    source_reference: sourceReference,
    symptoms,
    source: raw.source === 'imported' ? 'imported' : 'manual',
    values,
    notes,
    context,
    meta: normalizeMeta(raw.meta)
  };
}

/** RFC 4180-style CSV parser, including quoted delimiters, newlines and escaped quotes. */
function readCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false, afterQuote = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else cell += character;
      continue;
    }
    if (afterQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw new Error('CSV contains characters after a closing quote.');
    }
    if (character === '"') {
      if (cell.length) throw new Error('CSV quotes must begin at the start of a field.');
      quoted = true;
    } else if (character === ',') {
      row.push(cell); cell = ''; afterQuote = false;
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = ''; afterQuote = false;
    } else cell += character;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell);
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

/** Parse and validate the complete import before returning anything. Imported provenance is enforced. */
export function parseImport(text, filename = '') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The selected file is empty.');
  if (text.length > 10 * 1024 * 1024) throw new Error('Import files must be smaller than 10 MB.');
  let input;
  if (/\.json$/i.test(filename) || /^[\s\uFEFF]*[\[{]/.test(text)) {
    let parsed;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { throw new Error('The file is not valid JSON.'); }
    if (!Array.isArray(parsed)) assertPersonalObservation(parsed);
    input = Array.isArray(parsed) ? parsed : parsed?.records;
    if (!Array.isArray(input)) throw new Error('JSON must contain an array or an object with a records array.');
  } else {
    const rows = readCSV(text);
    if (rows.length < 2) throw new Error('CSV must include a header and at least one observation.');
    const headers = rows.shift().map(value => value.trim());
    if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate column names.');
    if (!headers.includes('timestamp') && !headers.includes('measured_at')) throw new Error('CSV requires a timestamp or measured_at column.');
    const allowed = ['id', 'timestamp', 'measured_at', 'created_at', 'user_id', 'source_reference', 'symptoms', 'source', 'context', 'notes', 'training', 'simulated', 'synthetic', 'source_type', 'mode', ...KEYS, ...META_COLUMNS];
    const unknown = headers.filter(header => !allowed.includes(header));
    if (unknown.length) throw new Error(`Unknown CSV column: ${unknown[0]}. Use the downloadable template.`);
    input = rows.map((row, index) => {
      if (row.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${row.length} fields; expected ${headers.length}.`);
      const raw = { values: {}, meta: {} };
      headers.forEach((header, column) => {
        if (KEYS.includes(header)) raw.values[header] = row[column];
        else if (META_COLUMNS.includes(header)) raw.meta[header.slice(5)] = row[column];
        else raw[header] = row[column];
      });
      return raw;
    });
  }
  if (!input.length) throw new Error('The file contains no observations.');
  if (input.length > MAX_RECORDS) throw new Error(`Import no more than ${MAX_RECORDS.toLocaleString()} observations at a time.`);
  return input.map((raw, index) => {
    try { assertPersonalObservation(raw); return validateRecord({ ...raw, user_id: null, source: 'imported' }); }
    catch (error) { throw new Error(`Observation ${index + 1}: ${error.message}`); }
  });
}

const CSV_COLUMNS = ['timestamp', ...KEYS, 'source', 'context', 'notes', ...META_COLUMNS, 'id', 'measured_at', 'created_at', 'user_id', 'source_reference', 'symptoms'];
function quoteCSV(value) {
  let cell = value == null ? '' : String(value);
  // Prevent spreadsheet formula execution when notes are opened in Excel/Sheets.
  if (/^[=+@\-\t\r]/.test(cell) && typeof value !== 'number') cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

export function toCSV(records) {
  return [CSV_COLUMNS.join(','), ...records.map(record =>
    CSV_COLUMNS.map(key => quoteCSV(KEYS.includes(key) ? record.values[key] : META_COLUMNS.includes(key) ? (record.meta || META_DEFAULTS)[key.slice(5)] : record[key])).join(',')
  )].join('\r\n');
}

/** Reference is an adult terrestrial screening label, not a declaration of health. */
export function statusFor(metric, value) {
  if (!Number.isFinite(value)) return 'unassessed';
  if (metric === 'heart') return value < 60 || value > 100 ? 'review' : 'reference';
  if (metric === 'oxygen') return value <= 92 ? 'urgent' : value < 95 ? 'review' : 'reference';
  if (metric === 'sleep') return value < 7 ? 'review' : 'reference';
  if (metric === 'temp') return value < 35 || value >= 40.6 ? 'urgent' : value >= 38 ? 'review' : 'reference';
  if (metric === 'sys') return value >= 180 ? 'urgent' : value >= 130 ? 'review' : 'unassessed';
  if (metric === 'dia') return value >= 120 ? 'urgent' : value >= 80 ? 'review' : 'unassessed';
  if (metric === 'mood') return value <= 2 ? 'review' : 'unassessed';
  return 'unassessed';
}

/** Generate review prompts, never diagnoses or treatment recommendations. */
export function assessRecord(record) {
  const { values, context } = record;
  const alerts = [];
  const add = (metric, severity, title, detail, sourceUrl) => alerts.push({
    id: `${record.id}-${metric}`, metric, severity, title, detail, sourceUrl
  });
  for (const metric of ['heart', 'oxygen', 'sleep', 'temp', 'mood']) {
    const value = values[metric];
    let severity = statusFor(metric, value);
    // Heart rate during exercise cannot be screened using a resting reference.
    if (metric === 'heart' && context !== 'resting') severity = 'unassessed';
    if (!['review', 'urgent'].includes(severity)) continue;
    const titles = { heart: 'Resting heart rate review', oxygen: 'Oxygen reading review', sleep: 'Sleep check-in', temp: 'Temperature review', mood: 'Wellbeing check-in' };
    const details = {
      heart: 'This reading is outside the broad adult resting reference of 60–100 bpm. Fitness, medicines, symptoms and mission context matter. Recheck the measurement and follow the crew medical protocol.',
      oxygen: value <= 88
        ? 'The reading is at or below 88%. Seek immediate crew medical assistance according to the mission emergency protocol. Check the sensor promptly without delaying help; severe symptoms take priority over a sensor reading.'
        : severity === 'urgent'
        ? 'The reading is at or below 92%. Check sensor placement promptly and contact the designated medical lead under the mission protocol. Symptoms take priority over a sensor reading; pulse oximeters have limitations.'
        : 'The reading is below the broad 95–100% reference. Check sensor placement, measurement conditions and symptoms, and request medical review according to the mission protocol.',
      sleep: 'Sleep is below the general adult recommendation of at least 7 hours. Review the sleep schedule, workload and wellbeing with the crew. This is a self-reported observation, not a diagnosis.',
      temp: value < 35
        ? 'The reading is below 35°C, the NHS hypothermia reference. Promptly seek crew medical assistance under the mission emergency protocol. Verify the unit, measurement method and symptoms without delaying help.'
        : severity === 'urgent'
        ? 'Temperature is at least 40.6°C, a MedlinePlus adult high-fever contact reference. Promptly contact the crew medical lead; the measurement method, symptoms and persistence matter.'
        : 'The reading is at least 38°C, a common adult fever reference. Measurement site and symptoms matter. Recheck and follow the mission medical protocol.',
      mood: 'You reported low wellbeing. Consider a private check-in with the designated crew support or medical lead. The 1–5 mood scale is a personal check-in, not a validated mental health assessment.'
    };
    add(metric, severity, titles[metric], details[metric], metric === 'mood' ? 'https://www.nasa.gov/hrp/hazards/' : metric === 'temp' && value < 35 ? 'https://www.nhs.uk/conditions/hypothermia/' : metric === 'temp' && value >= 40.6 ? 'https://medlineplus.gov/ency/article/003090.htm' : SOURCES[metric]);
  }
  if (values.sys !== undefined && values.dia !== undefined) {
    const urgent = values.sys >= 180 || values.dia >= 120;
    const review = values.sys >= 130 || values.dia >= 80;
    if (urgent || review) add('bp', urgent ? 'urgent' : 'review', 'Blood pressure review', urgent
      ? 'One or both readings meet the app’s conservative at-or-above 180 systolic / 120 diastolic review trigger, adapted from the AHA higher-than-180/120 reference. Promptly follow the mission medical protocol and contact the designated medical lead. Severe symptoms require immediate crew assistance. A single reading does not establish a diagnosis.'
      : 'One or both readings reach the broad adult 130 systolic / 80 diastolic review reference. Recheck using an approved cuff and measurement procedure, and discuss the trend with the medical lead. A single reading does not establish a diagnosis.', SOURCES.bp);
  }
  // Glucose requires timing (fasting/after meal), medicines and clinical context;
  // HRV/EDA depend strongly on devices and baselines. Do not invent cutoffs.
  return alerts;
}

function storage() {
  try {
    if (!globalThis.localStorage) throw new Error();
    return globalThis.localStorage;
  } catch { throw new Error('Browser storage is unavailable. Export your records before leaving this page.'); }
}

export function getRecords() {
  const local = storage();
  let raw;
  try { raw = local.getItem(STORAGE_KEY); }
  catch { throw new Error('Saved observations could not be read. Browser storage may be blocked.'); }
  if (raw === null) return [];
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Saved observations are unreadable. Do not overwrite them; recover your last exported backup.'); }
  if (!Array.isArray(parsed)) throw new Error('Saved observations have an unsupported format. Do not overwrite them.');
  try { return parsed.map(validateRecord).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)); }
  catch { throw new Error('Saved observations contain invalid data. Do not overwrite them; recover your last exported backup.'); }
}

export function saveRecords(records) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) throw new Error(`Keep no more than ${MAX_RECORDS.toLocaleString()} observations in this browser.`);
  const canonical = records.map(validateRecord).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  try { storage().setItem(STORAGE_KEY, JSON.stringify(canonical)); }
  catch (error) {
    if (error.message.startsWith('Browser storage')) throw error;
    throw new Error('Records could not be saved. Browser storage may be full or blocked. Export a backup now.');
  }
  return canonical;
}

function fingerprint(record) {
  const values = Object.fromEntries(KEYS.filter(key => record.values[key] !== undefined).map(key => [key, record.values[key]]));
  return JSON.stringify([record.timestamp, values, record.context, record.notes, normalizeMeta(record.meta), record.symptoms || '', record.source_reference || '', record.user_id || null]);
}

/** Merge atomically in memory; callers persist only after reviewing the successful result. */
export function mergeRecords(existing, incoming) {
  const merged = [], seen = new Set(), ids = new Set();
  for (const raw of [...existing, ...incoming]) {
    const record = validateRecord(raw);
    const key = fingerprint(record);
    if (seen.has(key)) continue;
    seen.add(key);
    if (ids.has(record.id)) record.id = newId();
    ids.add(record.id);
    merged.push(record);
  }
  if (merged.length > MAX_RECORDS) throw new Error(`The combined data exceeds ${MAX_RECORDS.toLocaleString()} observations. Export or remove older records first.`);
  return merged.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
