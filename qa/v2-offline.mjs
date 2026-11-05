// Local-only offline QA. Root runs with an existing HTTP server and Playwright:
// PLAYWRIGHT_MODULE=/tmp/cosmovital-qa/node_modules/playwright/index.mjs node qa/v2-offline.mjs
// The ephemeral profile contains clearly identified QA fixtures, never production records.
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const qaDir = fileURLToPath(new URL('./', import.meta.url));
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:8080';
const origin = new URL(base).origin;
const checks = [], errors = [], externalRequests = [], screenshots = [];
let browser, context, page, failure = null;
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const waitMain = async view => {
  await page.locator('#main .page-heading h1').waitFor();
  await page.waitForFunction(view => document.querySelector('.nav-item[href="#' + view + '"]')?.getAttribute('aria-current') === 'page', view);
};
const go = async view => {
  await page.evaluate(view => { location.hash = view; }, view);
  await waitMain(view);
};
const rawWorkspace = () => page.evaluate(() => ({
  records: localStorage.getItem('cosmovital-records-v1'),
  mission: localStorage.getItem('cosmovital-mission-v2')
}));
async function screenshot(name) {
  await page.evaluate(async () => { await document.fonts.ready; });
  const path = qaDir + name;
  await page.screenshot({path, fullPage: true});
  screenshots.push(path);
}
try {
  check('QA target is a local HTTP origin', /^https?:$/.test(new URL(base).protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
  const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  // Separate allow profile: all other v2 suites block SW, this one deliberately
  // verifies the installed worker. Browser context is destroyed at teardown.
  context = await browser.newContext({viewport: {width: 1440, height: 1100}, timezoneId: 'UTC', serviceWorkers: 'allow'});
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    externalRequests.push(url); return route.abort();
  });
  context.on('request', request => {
    const url = request.url();
    if (/^https?:/.test(url) && !url.startsWith(origin + '/') && !externalRequests.includes(url)) externalRequests.push(url);
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/#overview', {waitUntil: 'load'});
  await waitMain('overview');
  await page.waitForFunction(() => 'serviceWorker' in navigator && !!navigator.serviceWorker.controller, null, {timeout: 30000});
  const workerState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {active: registration.active?.state, script: registration.active?.scriptURL, controlled: !!navigator.serviceWorker.controller};
  });
  check('Service worker is activated and controls the isolated page', workerState.active === 'activated' && workerState.controlled && workerState.script.endsWith('/sw.js'));
  const cachedModules = await page.evaluate(async () => {
    const modules = ['app.js', 'core.js', 'mission.js', 'insights.js', 'training.js', 'workspace.js'];
    const found = await Promise.all(modules.map(async name => ({name, cached: !!await caches.match(new URL('./' + name, location.href))})));
    return {keys: await caches.keys(), found};
  });
  check('Offline cache contains every v2 module', cachedModules.found.every(module => module.cached));
  check('Version 2 cache is installed', cachedModules.keys.some(key => key.startsWith('cosmovital-app-v2')));

  const seeded = await page.evaluate(async () => {
    const core = await import('./core.js');
    const mission = await import('./mission.js');
    const record = core.validateRecord({
      id: 'qa-offline-observation', timestamp: new Date(Date.now() - 2 * 3600000).toISOString(), source: 'manual',
      values: {heart: 76, oxygen: 98, sleep: 6.2, temp: 36.8}, context: 'resting',
      notes: 'QA fixture in an isolated browser. Not an actual patient measurement.',
      meta: {device: 'QA fixture device', method: 'Isolated offline interface test', repeat: 'yes', signal: 'stable', glucoseTiming: 'unknown', temperatureSite: 'oral'}
    });
    core.saveRecords([record]);
    let c = mission.createCase(record, {
      title: 'Sleep & recovery follow-up (QA)',
      summary: 'A dated case timeline for checking continuity while the mission workspace is offline. Isolated QA fixture, not a patient record.',
      symptoms: {breathing: 'unknown', stroke: 'no', unresponsive: 'no', unconsciousBreathing: 'no'}
    });
    c = mission.appendCaseEvent(c, {type: 'note', text: 'QA note: measurement context is recorded. No diagnosis or treatment outcome is claimed.'});
    c = mission.setCaseStatus(c, 'follow-up', {reason: 'User-selected review time for the QA workflow.', followUpAt: new Date(Date.now() + 24 * 3600000).toISOString()});
    const packet = mission.prepareConsultation(mission.createConsultation(c, [record], {
      question: 'Which recorded context should be reviewed at the next planned check-in? QA fixture only.', context: 'mission'
    }));
    mission.saveMissionState({schemaVersion: 1, cases: [c], consultations: [packet]});
    localStorage.setItem('cosmovital-language', JSON.stringify('en'));
    localStorage.setItem('cosmovital-settings-v1', JSON.stringify({name: 'QA Explorer', environment: 'station', start: ''}));
    return {recordId: record.id, caseId: c.id, packetId: packet.id, snapshot: JSON.stringify(packet.payload)};
  });
  // Reload once while online so a controlled navigation caches the exact entry.
  await page.reload({waitUntil: 'load'}); await go('cases');
  await page.locator('.case-detail').waitFor();
  check('Seeded case is visible before disconnect', (await page.locator('.case-detail h2').innerText()).includes('Sleep & recovery follow-up (QA)'));
  const baseline = await rawWorkspace();

  await context.setOffline(true);
  await page.reload({waitUntil: 'domcontentloaded'}); await waitMain('cases');
  await page.locator('.case-detail').waitFor();
  check('Offline reload renders the full case workspace', (await page.locator('.case-detail h2').innerText()).includes('Sleep & recovery follow-up (QA)'));
  check('Real-schema manual observation and case survive offline reload', JSON.stringify(await rawWorkspace()) === JSON.stringify(baseline));
  check('Offline case includes its dated follow-up and note', (await page.locator('.case-detail').innerText()).includes('User-selected') && (await page.locator('.case-timeline').innerText()).includes('QA note'));
  await screenshot('v2-case-desktop.png');

  await go('consultations');
  await page.locator('.packet-detail').waitFor();
  check('Offline consultation UI loads from cached v2 modules', (await page.locator('.packet-detail').innerText()).includes('Prepared · not sent'));
  await page.reload({waitUntil: 'domcontentloaded'}); await waitMain('consultations');
  const packetAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('cosmovital-mission-v2')).consultations[0]);
  check('Prepared packet snapshot persists unchanged offline', packetAfterReload.id === seeded.packetId && packetAfterReload.status === 'prepared' && JSON.stringify(packetAfterReload.payload) === seeded.snapshot);
  check('Offline packet retains source metadata and unknowns', packetAfterReload.payload.records[0].meta.device === 'QA fixture device' && packetAfterReload.payload.records[0].source === 'manual' && packetAfterReload.payload.symptoms.breathing === 'unknown' && packetAfterReload.payload.records[0].meta.glucoseTiming === 'unknown');

  await go('training');
  check('Training scenarios load offline', await page.locator('.training-card').count() === 3);
  const beforeTraining = await rawWorkspace();
  const allStorageBeforeTraining = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]))));
  await page.locator('[data-action="ws-training-start"][data-scenario="context-check"]').click();
  await page.locator('[data-action="ws-training-answer"][data-option="check-context"]').click();
  check('Offline training interactions run from cached code', await page.locator('.training-session').count() === 1 && (await page.locator('.training-feedback').innerText()).includes('Workflow choice recorded'));
  check('Training writes no health records, cases, packets, or other local storage', JSON.stringify(await rawWorkspace()) === JSON.stringify(beforeTraining) && await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])))) === allStorageBeforeTraining);
  await page.reload({waitUntil: 'domcontentloaded'}); await waitMain('training');
  check('Offline reload discards memory-only training progress', await page.locator('.training-card').count() === 3 && await page.locator('.training-session').count() === 0 && JSON.stringify(await rawWorkspace()) === JSON.stringify(beforeTraining));

  await page.setViewportSize({width: 390, height: 844});
  await go('cases');
  await page.locator('[data-action="language"]').click();
  await page.locator('.case-detail').waitFor();
  check('Arabic case view uses RTL while offline', await page.locator('html').getAttribute('dir') === 'rtl');
  check('Arabic mobile case view has no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot('v2-case-ar-mobile.png');
  await page.reload({waitUntil: 'domcontentloaded'}); await waitMain('cases');
  check('Arabic language and case persist through offline mobile reload', await page.locator('html').getAttribute('dir') === 'rtl' && (await page.locator('.case-detail h2').innerText()).includes('Sleep & recovery follow-up (QA)'));
  check('No external network requests were attempted', externalRequests.length === 0);
  check('No browser application runtime errors', errors.length === 0);
} catch (error) {
  failure = {message: error.message, stack: error.stack, url: page?.url() || null};
  process.exitCode = 1;
} finally {
  const report = {passed: checks.length, checks, errors, externalRequests, screenshots, failure};
  await fs.mkdir(qaDir, {recursive: true});
  await fs.writeFile(qaDir + 'v2-offline-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (browser) await browser.close();
}
