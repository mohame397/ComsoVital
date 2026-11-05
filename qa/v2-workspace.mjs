// Run against a local server: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node qa/v2-workspace.mjs
// Uses isolated browser profiles and QA fixtures only. No production data or external service is contacted.
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const qaDir = fileURLToPath(new URL('./', import.meta.url));
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:8080';
const RECORDS = 'cosmovital-records-v1', MISSION = 'cosmovital-mission-v2';
const results = [], errors = [], externalRequests = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
let failure = null;
const check = (name, condition) => { assert.ok(condition, name); results.push(name); };
const contexts = [];
async function newContext(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'UTC', acceptDownloads: true, serviceWorkers: 'block', ...options });
  contexts.push(context);
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(new URL(base).origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    externalRequests.push(url); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  return { context, page };
}
const { context, page: p } = await newContext();
async function go(view, page = p) {
  await page.goto(base + '/#' + view);
  await page.locator('#main .page-heading h1').waitFor();
  await page.waitForFunction(view => document.querySelector('.nav-item[href="#'+view+'"]')?.getAttribute('aria-current') === 'page', view);
}
async function stored(page = p) {
  return page.evaluate(([recordKey, missionKey]) => ({
    records: JSON.parse(localStorage.getItem(recordKey) || '[]'),
    mission: JSON.parse(localStorage.getItem(missionKey) || '{"schemaVersion":1,"cases":[],"consultations":[]}')
  }), [RECORDS, MISSION]);
}
async function rawState(page = p) {
  return page.evaluate(([r, m]) => [localStorage.getItem(r), localStorage.getItem(m)], [RECORDS, MISSION]);
}
async function submit(form, page = p) {
  await page.locator(`[form="${form}"]`).click();
  await page.locator('.modal').waitFor({ state: 'detached' });
}
async function close(page = p) { await page.locator('.modal [data-action="close"]').first().click(); }
async function download(action, page = p) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.locator(action).first().click()]);
  const path = await file.path(); assert.ok(path);
  return fs.readFile(path, 'utf8');
}
async function restore(content, { expectedError = null } = {}) {
  await go('cases');
  await p.locator('[data-action="ws-restore"]').click();
  await p.locator('#ws-restore input[type="file"]').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)) });
  await p.locator('#ws-restore [name="confirm"]').check();
  if (expectedError) {
    await p.locator('[form="ws-restore"]').click();
    await p.waitForFunction(() => document.querySelector('#form-error')?.textContent.trim());
    assert.match(await p.locator('#form-error').innerText(), expectedError);
    await close();
  } else await submit('ws-restore');
}
const day = offset => { const date = new Date(); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
const localInput = offset => day(offset) + 'T10:00';
const annotation = 'QA <img src=x onerror="window.qaXss=1"> context only';
try {
  await go('overview');
  check('Fresh browser has no fabricated cases or consultations', (await stored()).mission.cases.length === 0 && (await stored()).mission.consultations.length === 0);
  await p.locator('[data-action="log"]').first().click();
  await p.locator('[name="timestamp"]').fill(localInput(-20));
  for (const [key, value] of Object.entries({ heart: 72, oxygen: 98, temp: 36.8 })) await p.locator(`#reading-form [name="${key}"]`).fill(String(value));
  await p.locator('.meta-details summary').click();
  await p.locator('[name="meta_device"]').fill('QA device A');
  await p.locator('[name="meta_method"]').fill('QA resting observation');
  await p.locator('[name="meta_repeat"]').selectOption('yes');
  await p.locator('[name="meta_signal"]').selectOption('stable');
  await p.locator('[name="meta_temperatureSite"]').selectOption('oral');
  await p.locator('[name="notes"]').fill(annotation);
  await submit('reading-form');
  const initial = (await stored()).records[0];
  check('Record form saves reported metadata and values', initial.meta.device === 'QA device A' && initial.meta.repeat === 'yes' && initial.meta.temperatureSite === 'oral' && initial.values.heart === 72);
  await p.reload(); await go('records');
  await p.locator(`[data-action="ws-quality"][data-record="${initial.id}"]`).click();
  const quality = await p.locator('.modal-body').innerText();
  check('Quality view shows reported context without invented confidence', quality.includes('QA device A') && quality.includes('Context recorded') && quality.includes('not proof') && !/\d+\s*%/.test(quality));
  await p.locator('.modal [data-action="ws-create-case"]').click();
  await p.locator('#ws-case-create [name="title"]').fill('QA follow-up <b>case</b>');
  await p.locator('#ws-case-create [name="summary"]').fill('QA organizational timeline; no clinical outcome.');
  await submit('ws-case-create');
  check('Case starts with the actual selected record', (await stored()).mission.cases[0].recordIds[0] === initial.id);
  check('Case title and notes are escaped as plain text', (await p.locator('.case-detail h2').innerText()) === 'QA follow-up <b>case</b>' && await p.locator('.case-detail h2 b').count() === 0 && !(await p.evaluate(() => window.qaXss)));
  await p.locator('[data-action="ws-add-note"]').click();
  await p.locator('#ws-case-note [name="text"]').fill(annotation);
  await submit('ws-case-note');
  check('Dated case note appears in timeline', (await p.locator('.case-timeline').innerText()).includes(annotation) && (await stored()).mission.cases[0].events.some(e => e.type === 'note' && e.text === annotation));
  await p.locator('[data-action="ws-case-status"]').click();
  await p.locator('#ws-case-status [name="status"]').selectOption('follow-up');
  await p.locator('#ws-case-status [name="followUpAt"]').fill(localInput(1));
  await p.locator('#ws-case-status [name="reason"]').fill('QA user-scheduled follow-up');
  await submit('ws-case-status');
  check('Follow-up status and user-selected date persist', (await stored()).mission.cases[0].status === 'follow-up' && (await p.locator('.followup-banner').innerText()).includes('User-scheduled'));
  await p.locator('[data-action="ws-create-packet"]').click();
  await p.locator('#ws-packet-create [name="question"]').fill('QA question for a later review');
  await p.locator('#ws-packet-create [name="context"]').selectOption('mission');
  await submit('ws-packet-create');
  const snapshot = JSON.stringify((await stored()).mission.consultations[0].payload);
  check('Consultation begins as unsent draft with actual snapshot', (await stored()).mission.consultations[0].status === 'draft' && (await p.locator('.packet-preview').innerText()).includes('NOT SENT BY THIS APPLICATION'));
  await p.locator('[data-action="ws-prepare"]').click();
  check('Prepared is explicitly not sent', (await stored()).mission.consultations[0].status === 'prepared' && (await p.locator('.packet-detail').innerText()).includes('Prepared · not sent'));
  const packet = JSON.parse(await download('[data-action="ws-export-packet"][data-format="json"]'));
  check('JSON consultation download retains snapshot and truthful export status', packet.status === 'exported' && JSON.stringify(packet.payload) === snapshot && (await stored()).mission.consultations[0].status === 'exported');
  const readable = await download('[data-action="ws-export-packet"][data-format="txt"]');
  check('Readable handover export contains dates, context and no sent claim', readable.includes('NOT SENT BY THIS APPLICATION') && readable.includes('QA device A') && readable.includes('QA question'));
  await p.locator('[data-action="ws-share-declaration"]').click();
  await p.locator('#ws-sharing [name="channel"]').fill('QA pretend channel — test declaration only');
  await p.locator('#ws-sharing [name="note"]').fill('QA no real transmission occurred');
  await p.locator('#ws-sharing [name="confirm"]').check();
  await submit('ws-sharing');
  check('External sharing is a user declaration with unverified delivery', (await stored()).mission.consultations[0].status === 'external-sharing-recorded' && (await p.locator('.packet-detail').innerText()).includes('delivery unverified'));
  await go('cases');
  await p.locator('[data-action="ws-add-note"]').click();
  await p.locator('#ws-case-note [name="text"]').fill('QA later event excluded from older snapshot');
  await submit('ws-case-note');
  check('Later case events do not rewrite consultation snapshot', JSON.stringify((await stored()).mission.consultations[0].payload) === snapshot);
  await go('records');
  await p.locator(`[data-action="delete"][data-id="${initial.id}"]`).click();
  check('Deleting linked observation is blocked without opening confirmation', (await stored()).records.length === 1 && await p.locator('.modal').count() === 0 && (await p.locator('#toast').innerText()).includes('linked to a case'));

  // Controlled UI fixtures exercise date comparisons in this fresh test profile only.
  const fixture = { records: [-19, -18, -17, -10, -9, -8].map((offset, index) => ({ id: `qa-comparison-${index}`, timestamp: day(offset) + 'T10:00:00Z', source: 'imported', values: { heart: index < 3 ? 70 + index * 2 : 76 + (index - 3) * 2 }, context: 'resting', notes: 'QA fixture only', meta: { device: 'QA device A', method: 'QA resting observation', repeat: 'yes', signal: 'stable' } })) };
  await p.locator('[data-action="import"]').click();
  await p.locator('#import-form input[type="file"]').setInputFiles({ name: 'qa-fixtures.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await submit('import-form');
  await go('compare');
  const dates = { referenceStart: day(-19), referenceEnd: day(-17), currentStart: day(-10), currentEnd: day(-8) };
  for (const [key, value] of Object.entries(dates)) await p.locator(`#ws-comparison [name="${key}"]`).fill(value);
  await p.locator('#ws-comparison [name="context"]').selectOption('resting');
  await p.locator('#ws-comparison button[type="submit"]').click();
  check('Nonoverlapping periods show actual observations and descriptive means', await p.locator('.comparison-result').count() === 1 && (await p.locator('.period-cards').innerText()).includes('+6') && await p.locator('.comparison-points').count() === 2);
  await p.locator('.period-observation-lists details').first().locator('summary').click();
  check('Comparison exposes dated underlying records', await p.locator('.period-observation-lists details').first().locator('.comparison-points > div').count() === 3 && (await p.locator('.period-observation-lists').innerText()).includes('70'));
  await p.locator('#ws-comparison [name="currentStart"]').fill(day(-18));
  await p.locator('#ws-comparison button[type="submit"]').click();
  check('Overlapping comparison dates are rejected', (await p.locator('.form-error').innerText()).includes('must not overlap') && await p.locator('.comparison-result').count() === 0);

  await go('cases');
  const backupText = await download('[data-action="ws-backup"]');
  const backup = JSON.parse(backupText);
  check('Full backup contains records, cases and consultation snapshots', backup.schemaVersion === 2 && backup.records.length === 7 && backup.missionState.cases.length === 1 && backup.missionState.consultations.length === 1 && !('training' in backup));
  const beforeInvalid = await rawState();
  await restore('{not json', { expectedError: /JSON|position|property|Unexpected/i });
  check('Malformed backup rejected without overwriting workspace', JSON.stringify(await rawState()) === JSON.stringify(beforeInvalid));
  const duplicate = structuredClone(backup); duplicate.missionState.cases.push(structuredClone(duplicate.missionState.cases[0]));
  await restore(duplicate, { expectedError: /Case IDs must be unique/ });
  check('Duplicate case IDs rejected without overwriting workspace', JSON.stringify(await rawState()) === JSON.stringify(beforeInvalid));
  const duplicateRecord = structuredClone(backup); duplicateRecord.records.push(structuredClone(duplicateRecord.records[0]));
  await restore(duplicateRecord, { expectedError: /observation IDs must be unique/ });
  check('Duplicate observation IDs rejected without overwriting workspace', JSON.stringify(await rawState()) === JSON.stringify(beforeInvalid));
  const missingLink = structuredClone(backup); missingLink.records = [];
  await restore(missingLink, { expectedError: /missing linked observations/ });
  check('Backup with broken case observation link rejected atomically', JSON.stringify(await rawState()) === JSON.stringify(beforeInvalid));
  await restore({ app: 'CosmoVital', schemaVersion: 2, records: [], missionState: { schemaVersion: 1, cases: [], consultations: [] } });
  check('Explicit empty workspace restore is supported', (await stored()).records.length === 0 && (await stored()).mission.cases.length === 0 && (await stored()).mission.consultations.length === 0);
  await restore(backupText);
  const restored = await stored();
  check('Full workspace restores stable links and labels records imported', restored.records.length === 7 && restored.records.every(r => r.source === 'imported') && restored.mission.cases[0].recordIds[0] === initial.id && JSON.stringify(restored.mission.consultations[0].payload) === snapshot);
  await p.evaluate(key => localStorage.setItem(key, '{corrupt'), MISSION);
  await p.reload();
  check('Corrupt stored workspace shows recovery warning', (await p.locator('#main').innerText()).includes('recover an exported backup'));
  await restore(backupText);
  check('Validated backup can recover corrupt mission storage', (await stored()).mission.cases.length === 1 && !(await p.locator('#main').innerText()).includes('Saved mission workspace is unreadable'));

  const protectedState = await rawState();
  const choices = {
    'context-check': ['check-context', 'mark-unknown', 'workflow-only'],
    'delayed-review': ['dated-packet', 'prepared-unsent', 'available-help'],
    'emergency-priority': ['immediate-available-help', 'no-delay', 'choices-only']
  };
  await go('training');
  check('Training landing has three scenarios and prominent simulation banner', await p.locator('.training-card').count() === 3 && (await p.locator('.training-banner').innerText()).includes('SIMULATION · NOT CLINICAL CARE'));
  for (const [scenario, options] of Object.entries(choices)) {
    await p.locator(`[data-action="ws-training-start"][data-scenario="${scenario}"]`).click();
    for (const option of options) await p.locator(`[data-action="ws-training-answer"][data-option="${option}"]`).click();
    check(`Training ${scenario} completes with workflow-only feedback`, (await p.locator('.training-complete').innerText()).includes('3/3') && (await p.locator('.training-complete').innerText()).includes('workflow choices only'));
    check(`Training ${scenario} cannot write personal workspace data`, JSON.stringify(await rawState()) === JSON.stringify(protectedState));
    await p.locator('[data-action="ws-training-exit"]').click();
  }
  await p.locator('[data-action="ws-training-start"]').first().click();
  await p.locator('[data-option="diagnose-confidence"]').click();
  check('Incorrect training choice produces corrective workflow feedback', (await p.locator('.training-feedback').innerText()).includes('Review this workflow choice'));
  await p.reload();
  check('Training session is memory only and disappears on reload', await p.locator('.training-card').count() === 3 && JSON.stringify(await rawState()) === JSON.stringify(protectedState));

  const storageState = await context.storageState();
  const { page: m } = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, storageState });
  await go('cases', m);
  for (const language of ['en', 'ar']) {
    if (language === 'ar') await m.locator('[data-action="language"]').click();
    for (const view of ['overview', 'cases', 'consultations', 'compare', 'training', 'records']) {
      await go(view, m);
      check(`Mobile ${language} ${view} has no horizontal page overflow`, await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await go('records', m);
    await m.locator('[data-action="ws-quality"]').first().click();
    check(`Mobile ${language} quality modal fits viewport`, await m.evaluate(() => document.querySelector('.modal').getBoundingClientRect().right <= innerWidth && document.querySelector('.modal').getBoundingClientRect().left >= 0));
    await close(m);
    await go('cases', m); await m.locator('[data-action="ws-add-note"]').click();
    check(`Mobile ${language} case form fits viewport`, await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await close(m);
    await go('training', m); await m.locator('[data-action="ws-training-start"]').first().click();
    check(`Mobile ${language} active training fits viewport`, await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await m.locator('[data-action="ws-training-exit"]').click();
  }
  check('Arabic view uses RTL', await m.locator('html').getAttribute('dir') === 'rtl');
  check('No real external network request attempted by workflow features', externalRequests.length === 0);
  check('No browser application runtime errors', errors.length === 0);
} catch (error) {
  failure = { message: error.message, stack: error.stack, url: p.url() };
  throw error;
} finally {
  const report = { passed: results.length, results, errors, externalRequests, failure };
  await fs.writeFile(qaDir + 'v2-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
