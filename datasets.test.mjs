import test from 'node:test';
import assert from 'node:assert/strict';
import { DATASET_SOURCE_TYPES, prepareDatasetMetadata, validateDatasetMetadata } from '../dist/datasets.js';

const metadata = () => ({
  datasetName: 'Explicit QA metadata fixture; not a verified NASA dataset', datasetId: 'qa-only', sourceType: 'terrestrial-research',
  sourceUrl: 'https://example.org/dataset', sourceOrganization: 'QA fixture', researchPopulation: 'Ground research fixture',
  measurements: [{ name: 'heart rate', unit: 'bpm' }], originalTimestamps: { start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z' },
  importedAt: '2026-01-02T10:00:00Z', accessPermissions: { level: 'restricted', license: 'QA permission basis', notes: 'No external dataset is connected.' }
});

test('all distinct data classes are explicit and metadata validation does not activate personal ingestion', () => {
  assert.equal(DATASET_SOURCE_TYPES.length, 5);
  for (const sourceType of DATASET_SOURCE_TYPES) {
    const value = validateDatasetMetadata({ ...metadata(), sourceType });
    assert.equal(value.sourceType, sourceType);
    assert.equal(value.personalHealthImportAllowed, false);
    assert.equal(value.verificationStatus, 'metadata-only-unverified');
  }
});

test('required source, population, unit, timestamp, permission and import fields cannot be invented by omission', () => {
  for (const key of ['datasetName', 'datasetId', 'sourceUrl', 'sourceOrganization', 'researchPopulation', 'measurements', 'originalTimestamps', 'importedAt', 'accessPermissions']) {
    const value = metadata(); delete value[key];
    assert.throws(() => validateDatasetMetadata(value), undefined, key);
  }
  assert.throws(() => validateDatasetMetadata({ ...metadata(), measurements: [{ name: 'heart rate' }] }), /unit/);
  assert.throws(() => validateDatasetMetadata({ ...metadata(), accessPermissions: { level: 'public' } }), /License/);
});

test('original timestamps retain instants and never fall back to import time', () => {
  const result = validateDatasetMetadata({ ...metadata(), originalTimestamps: ['2026-01-01T10:00+02:00', '2026-01-01T10:10+02:00'] });
  assert.equal(result.originalTimestamps[0], '2026-01-01T08:00:00.000Z');
  assert.notEqual(result.originalTimestamps[0], result.importedAt);
  assert.throws(() => validateDatasetMetadata({ ...metadata(), originalTimestamps: { start: '2026-01-02T10:00Z', end: '2026-01-01T10:00Z' } }), /chronological/);
  assert.throws(() => validateDatasetMetadata({ ...metadata(), originalTimestamps: ['2026-02-30T10:00Z'] }), /calendar/);
  assert.throws(() => validateDatasetMetadata({ ...metadata(), originalTimestamps: ['2026-01-01T10:00'] }), /offset/);
});

test('source URLs reject credentials or unsafe protocols and preserve access restrictions', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'http://example.org', 'https://user:secret@example.org/file']) assert.throws(() => validateDatasetMetadata({ ...metadata(), sourceUrl }), /HTTPS|credentials/);
  const result = validateDatasetMetadata(metadata());
  assert.equal(result.accessPermissions.level, 'restricted');
  assert.equal(result.accessPermissions.license, 'QA permission basis');
});

test('NASA research and space-weather labels cannot assert live personal readings or absorbed dose', () => {
  assert.throws(() => validateDatasetMetadata({ ...metadata(), sourceType: 'nasa-research', isLivePersonalAstronautReading: true }), /cannot establish/);
  assert.throws(() => validateDatasetMetadata({ ...metadata(), sourceType: 'nasa-space-weather', personallyAbsorbedRadiationDose: true }), /cannot establish/);
  const result = validateDatasetMetadata({ ...metadata(), sourceType: 'nasa-space-weather', verificationStatus: 'verified' });
  assert.equal(result.verificationStatus, 'metadata-only-unverified');
  assert.ok(result.limitations.some(text => text.includes('absorbed radiation dose')));
});

test('prepare supplies only actual import time while preserving historical measurement timestamps', () => {
  const input = metadata(); delete input.importedAt;
  const prepared = prepareDatasetMetadata(input, { now: '2026-01-03T12:00Z' });
  assert.equal(prepared.importedAt, '2026-01-03T12:00:00.000Z');
  assert.equal(prepared.originalTimestamps.start, '2026-01-01T00:00:00.000Z');
  assert.equal(input.importedAt, undefined);
});
