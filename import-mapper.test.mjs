import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDelimited, previewMappedImport } from '../dist/import-mapper.js';

const options = { timestampColumn: 'time', valueColumn: 'reading', metric: 'heart', unit: 'bpm', timeZone: 'UTC' };
const csv = rows => 'time,reading\n' + rows.map(([t, v]) => `${t},${v}`).join('\n');

test('CSV and TSV inspection preserves quotes, newlines, BOM and source columns without numeric guessing', () => {
  const result = inspectDelimited('\uFEFFtime\treading\tnote\r\n"2026-01-01T10:00Z"\t72\t"first\nsecond \"\"quoted\"\""\r\n');
  assert.equal(result.delimiter, '\t');
  assert.deepEqual(result.headers, ['time', 'reading', 'note']);
  assert.equal(result.rows[0][2], 'first\nsecond "quoted"');
  assert.deepEqual(result.errors, []);
  assert.equal(inspectDelimited('"comma, header",reading\nvalue,2').delimiter, ',');
});

test('malformed quoting, duplicate/blank headers, empty data, oversized files and excessive rows reject', () => {
  for (const input of ['', 'time,reading\n', 'time,\n1,2', 'Time,time\n1,2', 'time,value\n"unclosed,2', 'time,value\n"done"suffix,2']) assert.throws(() => inspectDelimited(input));
  assert.throws(() => inspectDelimited('time,reading\n' + 'x'.repeat(5 * 1024 * 1024)), /5 MB/);
  assert.throws(() => inspectDelimited('time,reading\n' + '2026-01-01T10:00Z,72\n'.repeat(10001)), /10,000/);
});

test('mapping explicitly selects columns, metric and compatible unit', () => {
  const text = csv([['2026-01-01T10:00Z', 72]]);
  assert.throws(() => previewMappedImport(text, {}), /metric/);
  assert.throws(() => previewMappedImport(text, { ...options, timestampColumn: undefined }), /timestamp column/);
  assert.throws(() => previewMappedImport(text, { ...options, unit: '' }), /unit/);
  assert.throws(() => previewMappedImport(text, { ...options, unit: 'mmHg' }), /unit/);
  assert.throws(() => previewMappedImport(text, { ...options, valueColumn: 'time' }), /different/);
  const result = previewMappedImport(text, { ...options, timestampColumn: 0, valueColumn: 1 });
  assert.equal(result.records[0].values.heart, 72);
  assert.equal(result.records[0].timestamp, '2026-01-01T10:00:00.000Z');
  assert.equal(result.records[0].context, 'unknown');
});

test('whole-file preview is atomic and shows row-level errors instead of blanks as zero', () => {
  const result = previewMappedImport(csv([['2026-01-01T10:00Z', 72], ['2026-01-01T10:30Z', ''], ['bad', 74], ['2026-01-01T10:40Z', '1e3']]), options);
  assert.equal(result.records.length, 0);
  assert.deepEqual(result.errors.map(e => e.row), [3, 4, 5]);
  assert.equal(result.preview.length, 1);
  assert.equal(result.totalRows, 4);
  const width = previewMappedImport('time,reading\n2026-01-01T10:00Z,72,extra', options);
  assert.equal(width.records.length, 0);
  assert.match(width.errors[0].message, /columns/);
});

test('multiple readings per hour, duplicate timestamps and backdated records retain their actual timestamps', () => {
  const times = ['2010-01-01T10:00Z', '2026-01-01T10:00Z', '2026-01-01T10:00Z', '2026-01-01T10:12Z'];
  const result = previewMappedImport(csv(times.map((t, i) => [t, 70 + i])), options);
  assert.equal(result.errors.length, 0);
  assert.equal(result.records.length, 4);
  assert.equal(result.records[1].timestamp, result.records[2].timestamp);
  assert.notEqual(result.records[1].id, result.records[2].id);
});

test('local timestamp imports require an explicit zone and handle offsets, invalid days and DST gaps/folds', () => {
  const local = csv([['2026-01-01T10:15', 72]]);
  const noZone = { ...options }; delete noZone.timeZone;
  assert.match(previewMappedImport(local, noZone).errors[0].message, /explicitly selected time zone/);
  const cairo = previewMappedImport(local, { ...options, timeZone: 'Africa/Cairo' });
  assert.equal(cairo.records[0].timestamp, '2026-01-01T08:15:00.000Z');
  assert.equal(previewMappedImport(csv([['2026-01-01T10:15+02:00', 72]]), noZone).records[0].timestamp, cairo.records[0].timestamp);
  assert.match(previewMappedImport(csv([['2026-03-08T02:30', 72]]), { ...options, timeZone: 'America/New_York' }).errors[0].message, /does not exist/);
  assert.match(previewMappedImport(csv([['2026-11-01T01:30', 72]]), { ...options, timeZone: 'America/New_York' }).errors[0].message, /occurs twice/);
  assert.match(previewMappedImport(csv([['2026-02-30T10:15', 72]]), options).errors[0].message, /calendar/);
  assert.match(previewMappedImport(csv([['2026-01-01T10:15+14:15', 72]]), options).errors[0].message, /offset/);
});

test('temperature, glucose and sleep conversions are explicit and preserve meaningful precision', () => {
  const input = value => csv([['2026-01-01T10:00Z', value]]);
  const temperature = previewMappedImport(input('98.6'), { ...options, metric: 'temp', unit: '°F', temperatureSite: 'oral' });
  assert.equal(temperature.records[0].values.temp, 37);
  assert.match(temperature.preview[0].conversion, /°F to °C/);
  assert.equal(temperature.records[0].meta.temperatureSite, 'oral');
  const glucose = previewMappedImport(input('5.5'), { ...options, metric: 'glucose', unit: 'mmol/L', glucoseTiming: 'fasting' });
  assert.equal(glucose.records[0].values.glucose, 99.1001);
  assert.match(glucose.records[0].meta.method, /18.0182/);
  const sleep = previewMappedImport(input('450'), { ...options, metric: 'sleep', unit: 'min' });
  assert.equal(sleep.records[0].values.sleep, 7.5);
});

test('paired blood pressure needs separate mapped systolic/diastolic columns', () => {
  const text = 'time,systolic,diastolic\n2026-01-01T10:00Z,120,80';
  assert.throws(() => previewMappedImport(text, { ...options, metric: 'bp', unit: 'mmHg', valueColumn: 'systolic' }), /diastolic/);
  const result = previewMappedImport(text, { ...options, metric: 'bp', unit: 'mmHg', valueColumn: 'systolic', secondaryValueColumn: 'diastolic' });
  assert.deepEqual(result.records[0].values, { sys: 120, dia: 80 });
  assert.throws(() => previewMappedImport(text, { ...options, metric: 'sys', unit: 'mmHg', valueColumn: 'systolic' }), /both/);
  const invalid = previewMappedImport(text.replace('120,80', '80,120'), { ...options, metric: 'bp', unit: 'mmHg', valueColumn: 'systolic', secondaryValueColumn: 'diastolic' });
  assert.match(invalid.errors[0].message, /Systolic/);
});

test('source labels remain imported and no file-provided owner, record ID or created timestamp is trusted', () => {
  const text = 'time,reading,user_id,id,created_at\n2026-01-01T10:00Z,72,other-account,stolen,2026-01-02T10:00Z';
  const result = previewMappedImport(text, { ...options, dataSource: 'Wearable export', sourceReference: 'https://example.org/my-export' });
  const record = result.records[0];
  assert.equal(record.source, 'imported');
  assert.equal(record.source_reference, 'https://example.org/my-export');
  assert.ok(!record.user_id);
  assert.notEqual(record.id, 'stolen');
  assert.ok(!record.created_at);
});

test('explicit simulated source columns or flags cannot be laundered through numeric column mapping', () => {
  for (const flag of ['source,training', 'source_type,simulated-demo', 'training,true', 'synthetic,yes']) {
    const [header, value] = flag.split(',');
    const result = previewMappedImport(`time,reading,${header}\n2026-01-01T10:00Z,72,${value}`, options);
    assert.equal(result.records.length, 0);
    assert.match(result.errors[0].message, /simulated/);
  }
});

test('ordinal mood/energy and EDA use explicit supported units with no physiological interpretation', () => {
  const mood = previewMappedImport(csv([['2026-01-01T10:00Z', 4]]), { ...options, metric: 'mood', unit: '/5' });
  assert.equal(mood.records[0].values.mood, 4);
  const energy = previewMappedImport(csv([['2026-01-01T10:00Z', 3]]), { ...options, metric: 'energy', unit: '/5' });
  assert.equal(energy.records[0].values.energy, 3);
  const eda = previewMappedImport(csv([['2026-01-01T10:00Z', 2.3]]), { ...options, metric: 'eda', unit: 'uS' });
  assert.equal(eda.records[0].values.eda, 2.3);
});
