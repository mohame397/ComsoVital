import { METRICS, validateRecord } from './core.js';

const MAX_ROWS = 10000;
const MAX_BYTES = 5 * 1024 * 1024;
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function chooseDelimiter(text) {
  let quoted = false, commas = 0, tabs = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (c === '\r' || c === '\n') break;
      if (c === ',') commas++;
      if (c === '\t') tabs++;
    }
  }
  return tabs > commas ? '\t' : ',';
}

export function inspectDelimited(input, { delimiter } = {}) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Choose a non-empty CSV or TSV file.');
  if (new TextEncoder().encode(input).byteLength > MAX_BYTES) throw new Error('Import file exceeds 5 MB.');
  const text = input.replace(/^\uFEFF/, '');
  delimiter = delimiter === 'tab' ? '\t' : delimiter || chooseDelimiter(text);
  if (!['\t', ','].includes(delimiter)) throw new Error('Choose comma or tab as the delimiter.');
  const matrix = [];
  let row = [], cell = '', quoted = false, closedQuote = false;
  const pushRow = () => {
    row.push(cell);
    if (row.some(value => value.trim() !== '')) matrix.push(row);
    if (matrix.length > MAX_ROWS + 1) throw new Error('Import contains more than 10,000 data rows.');
    row = []; cell = ''; closedQuote = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else cell += c;
      continue;
    }
    if (closedQuote && c !== delimiter && c !== '\r' && c !== '\n') throw new Error('A quoted field must end at a delimiter or line ending.');
    if (c === '"') {
      if (cell) throw new Error('Quotes must begin at the start of a field.');
      quoted = true;
    } else if (c === delimiter) { row.push(cell); cell = ''; closedQuote = false; }
    else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else cell += c;
  }
  if (quoted) throw new Error('A quoted field was not closed.');
  if (cell || row.length || closedQuote) pushRow();
  if (!matrix.length) throw new Error('The file has no header row.');
  const headers = matrix.shift().map(value => value.trim());
  if (headers.length > 100) throw new Error('The file has more than 100 columns.');
  if (headers.some(value => !value)) throw new Error('Every column needs a non-empty header.');
  if (new Set(headers.map(value => value.toLowerCase())).size !== headers.length) throw new Error('Column headers must be unique.');
  if (!matrix.length) throw new Error('The file has no data rows.');
  const errors = matrix.flatMap((values, index) => values.length === headers.length ? [] : [{ row: index + 2, message: `Expected ${headers.length} columns, found ${values.length}.` }]);
  return { headers, rows: matrix, delimiter, errors };
}

function columnIndex(column, headers, label) {
  let index = typeof column === 'number' ? column : headers.indexOf(column);
  if (index < 0 && typeof column === 'string' && /^\d+$/.test(column)) index = Number(column);
  if (!Number.isInteger(index) || index < 0 || index >= headers.length) throw new Error(`Choose the ${label} column explicitly.`);
  return index;
}

function calendarParts(value) {
  const match = LOCAL_TIME.exec(value);
  if (!match) throw new Error('Use an ISO timestamp with an offset, or a local date and time with an explicit time zone.');
  const parts = match.slice(1, 7).map(value => Number(value || 0));
  const [year, month, day, hour, minute, second] = parts;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) throw new Error('The timestamp is not a valid calendar date and time.');
  return { parts, milliseconds: Number((match[7] || '').padEnd(3, '0') || 0) };
}

function localTimestamp(value, timeZone) {
  const { parts, milliseconds } = calendarParts(value);
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatter.format(new Date());
  } catch { throw new Error('Choose a valid IANA time zone, such as Africa/Cairo or UTC.'); }
  const extract = time => {
    const p = Object.fromEntries(formatter.formatToParts(new Date(time)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    return [p.year, p.month, p.day, p.hour, p.minute, p.second];
  };
  const target = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = target + hours * 3600000;
    const p = extract(sample);
    offsets.add(Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) - sample);
  }
  const matches = [...offsets].map(offset => target - offset).filter(time => extract(time).every((v, i) => v === parts[i]));
  if (matches.length !== 1) throw new Error(matches.length ? 'This local time occurs twice at a daylight-saving transition. Add an explicit UTC offset.' : 'This local time does not exist in the selected time zone.');
  return new Date(matches[0] + milliseconds).toISOString();
}

function timestamp(value, options) {
  value = String(value ?? '').trim();
  if (ISO_OFFSET.test(value)) {
    const offset = /[+-](\d{2}):(\d{2})$/.exec(value);
    if (offset && (Number(offset[1]) > 14 || Number(offset[2]) > 59 || Number(offset[1]) === 14 && Number(offset[2]) !== 0)) throw new Error('The timestamp UTC offset is invalid.');
    return value;
  }
  if (!Object.hasOwn(options, 'timeZone') || !options.timeZone) throw new Error('A timestamp without an offset needs an explicitly selected time zone.');
  return localTimestamp(value, options.timeZone);
}

function valueNumber(value) {
  value = String(value ?? '').trim();
  if (!NUMBER.test(value)) throw new Error('A measurement must be a non-empty decimal number.');
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('The measurement is not finite.');
  return result;
}

function converter(metric, unit) {
  if (typeof unit !== 'string' || !unit.trim()) throw new Error('Specify the source measurement unit.');
  const key = unit.trim().replace(/μ/g, 'µ').toLowerCase();
  const m = metric === 'bp' ? { unit: 'mmHg' } : METRICS[metric];
  if (!m) throw new Error('Choose a supported health indicator explicitly.');
  if (metric === 'temp' && ['°f', 'f', 'fahrenheit'].includes(key)) return { convert: n => Number(((n - 32) * 5 / 9).toFixed(6)), unit: '°C', note: 'Converted °F to °C using (°F − 32) × 5/9.' };
  if (metric === 'glucose' && ['mmol/l', 'mmol·l−1'].includes(key)) return { convert: n => Number((n * 18.0182).toFixed(6)), unit: 'mg/dL', note: 'Converted mmol/L to mg/dL using glucose factor 18.0182.' };
  if (metric === 'sleep' && ['min', 'minutes'].includes(key)) return { convert: n => Number((n / 60).toFixed(6)), unit: 'h', note: 'Converted minutes to hours by dividing by 60.' };
  const accepted = {
    heart: ['bpm'], oxygen: ['%', 'percent'], sleep: ['h', 'hours'], temp: ['°c', 'c', 'celsius'],
    bp: ['mmhg'], sys: ['mmhg'], dia: ['mmhg'], glucose: ['mg/dl'], hrv: ['ms'], eda: ['µs', 'us'],
    mood: ['/5', '1-5', '1–5'], energy: ['/5', '1-5', '1–5']
  };
  if (!accepted[metric]?.includes(key)) throw new Error(`The selected unit is not supported for ${metric}. Expected ${m.unit}.`);
  return { convert: n => n, unit: m.unit, note: '' };
}

function rejectSyntheticRow(headers, row) {
  const fields = Object.fromEntries(headers.map((key, index) => [key.toLowerCase(), row[index]]));
  if (['training', 'simulated', 'synthetic'].some(key => /^(?:true|yes|1)$/i.test(String(fields[key] || '').trim())) || ['source', 'source_type', 'mode'].some(key => /(?:^|[^a-z])(?:training|demo|simulat(?:ed|ion)|synthetic)(?:$|[^a-z])/i.test(fields[key] || ''))) throw new Error('Training or simulated data cannot be imported as personal health measurements.');
}

export function previewMappedImport(text, options = {}) {
  const parsed = inspectDelimited(text, { delimiter: options.delimiter });
  const metric = options.metric;
  if (!metric || metric === 'sys' || metric === 'dia') throw new Error('Choose a supported metric; blood pressure requires both systolic and diastolic columns.');
  const conversion = converter(metric, options.unit);
  const timeIndex = columnIndex(options.timestampColumn, parsed.headers, 'timestamp');
  const valueIndex = columnIndex(options.valueColumn, parsed.headers, 'measurement');
  const secondIndex = metric === 'bp' ? columnIndex(options.secondaryValueColumn, parsed.headers, 'diastolic measurement') : null;
  if (timeIndex === valueIndex || secondIndex === timeIndex || secondIndex === valueIndex) throw new Error('Timestamp and measurement columns must be different.');
  const sourceReference = String(options.sourceReference || (options.dataSource && options.dataSource !== 'imported' ? options.dataSource : '')).trim();
  if (sourceReference.length > 2000) throw new Error('The source reference must not exceed 2,000 characters.');
  const dataSource = String(options.dataSource || 'imported').trim();
  if (!dataSource || dataSource.length > 100 || /(?:training|demo|simulat|synthetic)/i.test(dataSource)) throw new Error('Identify an actual measurement source, not a simulated dataset.');
  const errors = [...parsed.errors], preview = [], records = [];
  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    if (parsed.errors.some(error => error.row === i + 2)) continue;
    try {
      rejectSyntheticRow(parsed.headers, row);
      const value = conversion.convert(valueNumber(row[valueIndex]));
      const values = metric === 'bp' ? { sys: value, dia: conversion.convert(valueNumber(row[secondIndex])) } : { [metric]: value };
      const record = validateRecord({
        timestamp: timestamp(row[timeIndex], options), source: 'imported', values,
        context: options.context || 'unknown', source_reference: sourceReference,
        notes: '', meta: { method: conversion.note, glucoseTiming: options.glucoseTiming || 'unknown', temperatureSite: options.temperatureSite || 'unknown' }
      });
      // Source identity is descriptive; file-provided account IDs are never copied.
      record.source_reference = sourceReference;
      records.push(record);
      if (preview.length < 10) preview.push({ row: i + 2, originalTimestamp: row[timeIndex], originalValue: row[valueIndex], originalSecondaryValue: secondIndex == null ? null : row[secondIndex], originalUnit: options.unit, timestamp: record.timestamp, values: { ...record.values }, unit: conversion.unit, source: 'imported', sourceReference, conversion: conversion.note });
    } catch (error) { errors.push({ row: i + 2, message: error.message }); }
  }
  errors.sort((a, b) => a.row - b.row);
  return {
    records: errors.length ? [] : records, errors, preview, totalRows: parsed.rows.length,
    warnings: [conversion.note, 'Imported measurements are unverified. Preview does not save anything. Confirm personal-data import explicitly before saving.'].filter(Boolean)
  };
}
