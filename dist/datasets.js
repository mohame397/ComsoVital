export const DATASET_SOURCE_TYPES = Object.freeze(['simulated-demo', 'user-entered', 'nasa-research', 'nasa-space-weather', 'terrestrial-research']);

function plain(raw) { return raw !== null && typeof raw === 'object' && !Array.isArray(raw); }
function field(value, name, maximum = 500) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new Error(`${name} is required and must be plain text of at most ${maximum} characters.`);
  return value.trim();
}
function iso(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp with a time-zone offset.`);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const clock = value.slice(11, 19).split(':').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || clock[0] > 23 || clock[1] > 59 || clock[2] > 59) throw new Error(`${name} is not a valid calendar timestamp.`);
  return new Date(value).toISOString();
}

export function validateDatasetMetadata(raw) {
  if (!plain(raw)) throw new Error('Dataset metadata must be an object.');
  const sourceType = raw.sourceType || raw.source_type;
  if (!DATASET_SOURCE_TYPES.includes(sourceType)) throw new Error('Choose a supported, explicitly identified dataset source type.');
  const sourceUrl = field(raw.sourceUrl || raw.source_url, 'Original source URL', 2000);
  let url;
  try { url = new URL(sourceUrl); } catch { throw new Error('Original source URL must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Original source URL must use HTTPS and must not contain credentials.');
  const measurements = raw.measurements;
  if (!Array.isArray(measurements) || !measurements.length || measurements.length > 100) throw new Error('List between 1 and 100 explicitly named measurements and units.');
  const canonicalMeasurements = measurements.map(m => {
    if (!plain(m)) throw new Error('Every measurement descriptor must be an object.');
    return { name: field(m.name, 'Measurement name', 100), unit: field(m.unit, 'Measurement unit', 100) };
  });
  if (new Set(canonicalMeasurements.map(m => m.name.toLowerCase())).size !== canonicalMeasurements.length) throw new Error('Dataset measurement names must be unique.');
  const original = raw.originalTimestamps || raw.original_timestamps;
  let originalTimestamps;
  if (Array.isArray(original)) {
    if (!original.length || original.length > 10000) throw new Error('Original timestamps need 1 to 10,000 explicit timestamps or a documented range.');
    originalTimestamps = original.map(value => iso(value, 'Original timestamp'));
  } else if (plain(original)) {
    const start = iso(original.start, 'Original start timestamp'), end = iso(original.end, 'Original end timestamp');
    if (Date.parse(start) > Date.parse(end)) throw new Error('Original timestamp range must be in chronological order.');
    originalTimestamps = { start, end };
  } else throw new Error('Document original timestamps explicitly; import time cannot replace measurement time.');
  const permissions = raw.accessPermissions || raw.access_permissions;
  if (!plain(permissions) || !['public', 'restricted', 'private'].includes(permissions.level)) throw new Error('Access permissions need an explicit public, restricted, or private level.');
  const accessPermissions = { level: permissions.level, license: field(permissions.license, 'License or permission basis', 1000), notes: typeof permissions.notes === 'string' ? permissions.notes.trim() : '' };
  if (accessPermissions.notes.length > 2000) throw new Error('Permission notes are too long.');
  if (raw.isLivePersonalAstronautReading === true || raw.personallyAbsorbedRadiationDose === true) throw new Error('Research and space-weather metadata cannot establish personal astronaut readings or an absorbed radiation dose.');
  return {
    datasetName: field(raw.datasetName || raw.dataset_name, 'Dataset name'),
    datasetId: field(raw.datasetId || raw.dataset_id, 'Dataset ID', 200),
    sourceType, sourceUrl: url.href,
    sourceOrganization: field(raw.sourceOrganization || raw.source_organization, 'Source organization'),
    researchPopulation: field(raw.researchPopulation || raw.research_population, 'Research population or observed environment', 1000),
    measurements: canonicalMeasurements, originalTimestamps,
    importedAt: iso(raw.importedAt || raw.import_date, 'Import timestamp'),
    accessPermissions,
    verificationStatus: 'metadata-only-unverified',
    personalHealthImportAllowed: false,
    limitations: [
      'Metadata validation does not verify dataset authenticity, medical suitability, permissions, or available data formats.',
      sourceType === 'nasa-space-weather' ? 'Space-weather observations are environmental research data, not a person’s absorbed radiation dose.' : 'Research records must not be presented as live personal astronaut readings.',
      'Dataset records remain separate from personal health history. No external dataset connection or transformation is activated by this metadata.'
    ]
  };
}

export function prepareDatasetMetadata(raw, { now = new Date().toISOString() } = {}) {
  if (!plain(raw)) throw new Error('Dataset metadata must be an object.');
  return validateDatasetMetadata({ ...raw, importedAt: raw.importedAt || raw.import_date || now });
}
