/** Descriptive measurement context and period summaries, never medical baselines. */
import { METRICS, META_DEFAULTS } from './core.js';
const pair = (en, ar) => [en, ar];
const LABELS = Object.freeze({
  device: pair('Device or source', 'الجهاز أو المصدر'), method: pair('Measurement method', 'طريقة القياس'),
  repeat: pair('Repeated measurement', 'إعادة القياس'), signal: pair('Signal quality', 'جودة الإشارة'),
  glucoseTiming: pair('Glucose timing', 'توقيت قياس السكر'), temperatureSite: pair('Temperature site', 'موضع قياس الحرارة'),
  context: pair('Activity context', 'ظروف النشاط')
});
const ENUM_LABELS = Object.freeze({
  yes: pair('Yes', 'نعم'), no: pair('No', 'لا'), stable: pair('Stable', 'مستقرة'), unstable: pair('Unstable', 'غير مستقرة'),
  fasting: pair('Fasting', 'صائم'), 'after-meal': pair('After a meal', 'بعد الأكل'), other: pair('Other / unspecified', 'أخرى / غير محددة'),
  oral: pair('Oral', 'الفم'), axillary: pair('Armpit', 'تحت الإبط'), ear: pair('Ear', 'الأذن'), forehead: pair('Forehead', 'الجبهة'),
  resting: pair('At rest', 'في الراحة'), 'post-exercise': pair('After exercise', 'بعد التمرين')
});
const VALID_CONTEXTS = ['resting', 'post-exercise', 'other'];
const enumChoices = {
  repeat: ['yes', 'no'], signal: ['stable', 'unstable'], glucoseTiming: ['fasting', 'after-meal', 'other'],
  temperatureSite: ['oral', 'axillary', 'ear', 'forehead', 'other']
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clean = value => typeof value === 'string' ? value.trim() : '';
function applicableFields(record, metric = null) {
  const fields = ['device', 'method', 'repeat', 'signal'];
  if (metric === 'glucose' || (!metric && finite(record?.values?.glucose))) fields.push('glucoseTiming');
  if (metric === 'temp' || (!metric && finite(record?.values?.temp))) fields.push('temperatureSite');
  return fields;
}
function metaValue(record, key) {
  const value = record?.meta?.[key] ?? META_DEFAULTS[key];
  if (key === 'device' || key === 'method') { const text = clean(value); return text.toLowerCase() === 'unknown' ? '' : text; }
  return enumChoices[key]?.includes(value) ? value : 'unknown';
}

/** Completeness of reported context is not a confidence score or proof of accuracy. */
export function assessQuality(record = null) {
  const known = [], missing = [], cautions = [];
  for (const key of applicableFields(record)) {
    const value = metaValue(record, key);
    if (!value || value === 'unknown') missing.push({ key, label: [...LABELS[key]] });
    else known.push({ key, label: [...LABELS[key]], value: key === 'device' || key === 'method' ? pair(value, value) : [...ENUM_LABELS[value]] });
  }
  if (['resting', 'post-exercise'].includes(record?.context)) known.push({ key: 'context', label: [...LABELS.context], value: [...ENUM_LABELS[record.context]] });
  else missing.push({ key: 'context', label: [...LABELS.context] });
  if (metaValue(record, 'signal') === 'unstable') cautions.push(pair('An unstable signal was reported. Review placement, conditions and the device instructions; this does not identify a medical cause.', 'تم الإبلاغ عن إشارة غير مستقرة. راجع تثبيت الجهاز والظروف وتعليماته؛ ده لا يحدد سببًا طبيًا.'));
  if (metaValue(record, 'repeat') === 'no') cautions.push(pair('The measurement was not repeated. A single reading may be affected by measurement conditions; do not delay urgent help to repeat it.', 'القياس لم يُعد. القراءة الواحدة قد تتأثر بظروف القياس؛ لا تؤخر المساعدة العاجلة لإعادته.'));
  const state = cautions.length ? 'caution' : missing.length ? 'context-missing' : 'context-recorded';
  return {
    state, known, missing, cautions,
    explanation: pair('This describes the context you recorded, not a percentage of confidence, a verified sensor result, or a diagnosis. Missing context does not mean a measurement is false, and complete context does not prove it is accurate.', 'ده وصف للسياق الذي سجلته، وليس نسبة ثقة أو نتيجة جهاز متحققًا منها أو تشخيصًا. نقص السياق لا يعني أن القياس خاطئ، واكتماله لا يثبت دقته.')
  };
}

function rangeTime(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
    throw new Error(`${label} must be an explicit ISO date or timestamp with timezone.`);
  }
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > maxDay) throw new Error(`${label} is not a valid date.`);
  if (value.length > 10) {
    const clock = value.slice(11, 19).split(':').map(Number);
    if (clock[0] > 23 || clock[1] > 59 || (clock[2] !== undefined && clock[2] > 59)) throw new Error(`${label} has an invalid time.`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} is not a valid timestamp.`);
  return time;
}
function stats(points) {
  if (!points.length) return { count: 0, mean: null, min: null, max: null };
  let sum = 0, min = Infinity, max = -Infinity;
  for (const point of points) { sum += point.value; min = Math.min(min, point.value); max = Math.max(max, point.value); }
  return { count: points.length, mean: sum / points.length, min, max };
}
function isTraining(record) {
  const trueFlag = value => value === true || (typeof value === 'string' && ['true', 'yes', '1'].includes(value.trim().toLowerCase()));
  return trueFlag(record?.training) || trueFlag(record?.simulated) || trueFlag(record?.synthetic) || [record?.source, record?.source_type, record?.mode].some(value => typeof value === 'string' && /(?:^|[^a-z])(?:training|simulat(?:ed|ion)|demo|synthetic)(?:$|[^a-z])/i.test(value));
}

/**
 * Compare inclusive timestamp windows without interpolation, synthetic points,
 * diagnostic scoring, or declaring a period to be a healthy physiological baseline.
 * Date-only boundaries mean midnight UTC; UI callers should pass explicit end times.
 * `comparable` only means this tool's minimum context checks passed, not statistical
 * significance, clinical equivalence, or control of every confounding factor.
 */
export function comparePeriods(records, metric, options = {}) {
  if (!Array.isArray(records)) throw new Error('Comparison records must be an array.');
  if (!Object.prototype.hasOwnProperty.call(METRICS, metric)) throw new Error('Choose a supported measurement for comparison.');
  const context = options.context ?? 'all';
  if (!['all', ...VALID_CONTEXTS].includes(context)) throw new Error('Choose all, resting, post-exercise, or other comparison context.');
  const referenceStart = rangeTime(options.referenceStart, 'Reference start');
  const referenceEnd = rangeTime(options.referenceEnd, 'Reference end');
  const currentStart = rangeTime(options.currentStart, 'Current start');
  const currentEnd = rangeTime(options.currentEnd, 'Current end');
  if (referenceStart > referenceEnd || currentStart > currentEnd) throw new Error('Each period must start on or before its end.');
  if (Math.max(referenceStart, currentStart) <= Math.min(referenceEnd, currentEnd)) throw new Error('Comparison periods must not overlap or share an included timestamp.');
  const referenceRecords = [], currentRecords = [], warnings = [];
  let comparable = true, ignored = 0;
  const warn = (en, ar, blocking = true) => { warnings.push(pair(en, ar)); if (blocking) comparable = false; };
  for (const record of records) {
    if (!finite(record?.values?.[metric])) continue;
    if (isTraining(record)) { ignored++; continue; }
    let time;
    try { time = rangeTime(record.timestamp, 'Observation timestamp'); } catch { ignored++; continue; }
    if (context !== 'all' && record.context !== context) continue;
    if (time >= referenceStart && time <= referenceEnd) referenceRecords.push(record);
    else if (time >= currentStart && time <= currentEnd) currentRecords.push(record);
  }
  const pointsFor = input => input.map(record => ({ time: Date.parse(record.timestamp), value: record.values[metric] })).sort((a, b) => a.time - b.time);
  const referencePoints = pointsFor(referenceRecords), currentPoints = pointsFor(currentRecords);
  const reference = stats(referencePoints), current = stats(currentPoints);
  if (ignored) warn('Some nonpersonal or invalid-timestamp observations were excluded. No missing points were generated.', 'تم استبعاد بعض التسجيلات غير الشخصية أو ذات التوقيت غير الصالح. لم يتم توليد نقاط مفقودة.');
  if (reference.count < 3 || current.count < 3) warn('At least one period has fewer than three actual observations. This tool keeps the comparison descriptive and does not mark it comparable.', 'توجد فترة بها أقل من ثلاثة قياسات فعلية. الأداة تعرض وصفًا للأرقام ولا تعتبر المقارنة قابلة للمضاهاة.');
  const selected = [...referenceRecords, ...currentRecords];
  if (selected.length) {
    const contexts = new Set(selected.map(record => record.context));
    if ([...contexts].some(value => !['resting', 'post-exercise'].includes(value))) warn('Activity context is missing or unspecified for some observations. Resting and post-exercise readings may mean different things.', 'ظروف النشاط مفقودة أو غير محددة لبعض التسجيلات. قياسات الراحة وما بعد التمرين قد تختلف في معناها.');
    if (contexts.size > 1) warn('The periods include different activity contexts. The numerical difference may reflect the conditions of measurement.', 'الفترتان تشملان ظروف نشاط مختلفة. الفرق العددي قد يعكس ظروف القياس.');
    const fields = applicableFields(null, metric);
    const missing = fields.filter(key => selected.some(record => !metaValue(record, key) || metaValue(record, key) === 'unknown'));
    if (missing.length) warn(`Measurement context is incomplete (${missing.map(key => LABELS[key][0]).join(', ')}). Older records remain included without invented metadata.`, `سياق القياس غير مكتمل (${missing.map(key => LABELS[key][1]).join('، ')}). السجلات القديمة تظل موجودة بدون اختلاق بيانات وصفية.`);
    for (const key of ['device', 'method']) {
      const unique = new Set(selected.map(record => clean(metaValue(record, key)).toLowerCase()).filter(Boolean));
      if (unique.size > 1) warn(`Different ${key === 'device' ? 'devices or sources' : 'measurement methods'} were used. Their readings may not be directly comparable.`, key === 'device' ? 'تم استخدام أجهزة أو مصادر مختلفة. قد لا تكون القراءات قابلة للمقارنة المباشرة.' : 'تم استخدام طرق قياس مختلفة. قد لا تكون القراءات قابلة للمقارنة المباشرة.');
    }
    if (selected.some(record => metaValue(record, 'signal') === 'unstable')) warn('An unstable signal was recorded. Measurement conditions can affect the descriptive difference.', 'تم تسجيل إشارة غير مستقرة. ظروف القياس قد تؤثر على الفرق الوصفي.');
    if (selected.some(record => metaValue(record, 'repeat') === 'no')) warn('Some measurements were not repeated. This is a context limitation, not evidence of a medical condition.', 'بعض القياسات لم تُعد. ده قيد في السياق، وليس دليلًا على حالة طبية.');
    for (const key of fields.filter(key => ['glucoseTiming', 'temperatureSite'].includes(key))) {
      const known = new Set(selected.map(record => metaValue(record, key)).filter(value => value !== 'unknown'));
      if (known.size > 1) warn(`Different ${LABELS[key][0].toLowerCase()} was recorded. Keep these conditions consistent when interpreting a trend.`, `تم تسجيل اختلاف في ${LABELS[key][1]}. راعِ اتساق الظروف عند تفسير الاتجاه.`);
    }
  }
  const difference = reference.mean !== null && current.mean !== null ? current.mean - reference.mean : null;
  const percentChange = difference !== null && reference.mean !== 0 ? difference / reference.mean * 100 : null;
  if (difference !== null && reference.mean === 0) warn('The reference-period mean is zero, so percentage change is undefined. The absolute difference is still shown.', 'متوسط الفترة المرجعية صفر، لذلك نسبة التغيّر غير معرّفة. يظل الفرق المطلق معروضًا.', false);
  return { reference, current, difference, percentChange, comparable, warnings, referencePoints, currentPoints };
}
