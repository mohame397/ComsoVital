import test from 'node:test';
import assert from 'node:assert/strict';
import {buildChartModel,renderHealthChart,availableMetrics,dateKey,localTimeToISO,inZone} from '../dist/health-charts.js';

const now = Date.parse('2026-11-03T16:30:00Z');
const meta = {device:'Meter A',method:'At-rest observation',signal:'stable',repeat:'yes',temperatureSite:'oral',glucoseTiming:'fasting'};
const record = (id,timestamp,values,extra = {}) => ({id,timestamp,values,source:'manual',context:'resting',meta:{...meta},...extra});
const options = {now,timeZone:'UTC'};

test('empty model renders honest missing days and no invented zeros', () => {
 const model = buildChartModel([],'heart',options);
 assert.equal(model.range,'7'); assert.equal(model.days.length,7); assert.equal(model.points.length,0); assert.equal(model.stats.average,null);
 assert.ok(model.days.every(day => day.count === 0 && day.summaries.heart.min === null));
 const html = renderHealthChart(model); assert.match(html,/No measurements in this period/); assert.doesNotMatch(html,/<svg/); assert.equal((html.match(/No observations · missing data/g)||[]).length,7);
});
test('24-hour points use exact timestamps, include irregular same-hour readings and exclude boundaries outside', () => {
 const rs = [record('outside','2026-11-02T16:29:59Z',{heart:80}),record('first','2026-11-02T16:30:00Z',{heart:70}),record('same-hour-1','2026-11-03T16:00:03Z',{heart:72}),record('same-hour-2','2026-11-03T16:00:47Z',{heart:74}),record('future','2026-11-03T16:31:00Z',{heart:76})];
 const model = buildChartModel(rs,'heart',{...options,range:'24'});
 assert.deepEqual(model.points.map(p => p.id),['first','same-hour-1','same-hour-2']); assert.equal(model.end-model.start,86400000); assert.equal(model.mode,'raw');
 assert.equal(model.points[2].time-model.points[1].time,44000); assert.match(renderHealthChart(model),/16:00:47/);
});
test('one actual measurement produces exactly one raw chart point and no manufactured line', () => {
 const rs = [record('only','2026-11-03T12:00:00Z',{heart:74})]; const model = buildChartModel(rs,'heart',{...options,range:'24'});
 const html = renderHealthChart(model); assert.equal(model.points.length,1); assert.equal(model.stats.count,1); assert.equal(model.stats.average,74);
 assert.equal((html.match(/class="health-chart-point"/g)||[]).length,1); assert.doesNotMatch(html,/<path/);
});
test('weekly and monthly models group actual calendar dates, retain missing days and raw originals', () => {
 const rs = [record('a','2026-10-28T01:00:00Z',{heart:70}),record('b','2026-10-28T23:00:00Z',{heart:80}),record('c','2026-10-31T08:00:00Z',{heart:90})];
 const frozen = JSON.stringify(rs), week = buildChartModel(rs,'heart',options), month = buildChartModel(rs,'heart',{...options,range:'30'});
 assert.equal(week.days[0].date,'2026-10-28'); assert.equal(week.days[0].count,2); assert.equal(week.days[0].summaries.heart.average,75);
 assert.equal(week.days[0].summaries.heart.min,70); assert.equal(week.days[0].summaries.heart.max,80); assert.equal(week.days[1].summaries.heart.average,null);
 assert.equal(month.days.length,30); assert.equal(month.days[0].date,'2026-10-05'); assert.equal(week.points.length,3); assert.equal(JSON.stringify(rs),frozen);
 const html = renderHealthChart(week); assert.match(html,/2026-10-28/); assert.match(html,/2 readings/); assert.match(html,/Original observations/);
});
test('selected timezone determines day groups rather than browser or UTC date', () => {
 const rs = [record('late','2026-11-03T00:30:00Z',{heart:75})];
 const model = buildChartModel(rs,'heart',{now:Date.parse('2026-11-03T06:00:00Z'),timeZone:'America/Los_Angeles'});
 assert.equal(model.points[0].date,'2026-11-02'); assert.equal(dateKey(rs[0].timestamp,'Asia/Tokyo'),'2026-11-03');
 assert.equal(model.days.at(-1).date,'2026-11-02'); assert.match(inZone(rs[0].timestamp,'America/Los_Angeles'),/2 Nov 2026/);
});
test('calendar windows survive 23/25-hour daylight-saving days without assigning dates', () => {
 const fall = buildChartModel([],'heart',{now:Date.parse('2026-11-03T12:00:00Z'),timeZone:'America/New_York'});
 const fallDay = fall.days.find(day => day.date === '2026-11-01'); assert.equal((fallDay.end-fallDay.start)/3600000,25);
 const spring = buildChartModel([],'heart',{now:Date.parse('2026-03-10T12:00:00Z'),timeZone:'America/New_York'});
 const springDay = spring.days.find(day => day.date === '2026-03-08'); assert.equal((springDay.end-springDay.start)/3600000,23);
});
test('local time conversion respects selected zone and rejects impossible or ambiguous clocks', () => {
 assert.equal(localTimeToISO('2026-11-03T10:30','Africa/Cairo'),'2026-11-03T08:30:00.000Z');
 assert.equal(localTimeToISO('2026-07-03T10:30','America/New_York'),'2026-07-03T14:30:00.000Z');
 assert.throws(() => localTimeToISO('2026-03-08T02:30','America/New_York'),/does not exist/);
 assert.throws(() => localTimeToISO('2026-11-01T01:30','America/New_York'),/occurs twice/);
 assert.equal(localTimeToISO('2026-11-01T01:30','America/New_York',{disambiguation:'earlier'}),'2026-11-01T05:30:00.000Z');
 assert.equal(localTimeToISO('2026-11-01T01:30','America/New_York',{disambiguation:'later'}),'2026-11-01T06:30:00.000Z');
 assert.throws(() => localTimeToISO('2026-02-30T10:00','UTC'),/does not exist/);
 assert.throws(() => localTimeToISO('2026-02-30T10:00:00Z','UTC'),/does not exist/);
 assert.throws(() => localTimeToISO('2026-02-02T24:00:00Z','UTC'),/does not exist/);
 assert.throws(() => buildChartModel([],'heart',{timeZone:'Not/AZone'}),RangeError);
});
test('out-of-order and identical-timestamp distinct readings are sorted and all retained', () => {
 const rs = [record('c','2026-11-03T11:00:00Z',{heart:80}),record('b','2026-11-03T10:00:00Z',{heart:70}),record('a','2026-11-03T10:00:00Z',{heart:72})];
 const model = buildChartModel(rs,'heart',options); assert.deepEqual(model.points.map(p => p.id),['a','b','c']); assert.equal(model.stats.count,3); assert.equal(model.stats.latest.id,'c'); assert.equal(model.stats.average,74);
});
test('blood pressure uses two separate series with paired counts and raw values', () => {
 const rs = [record('a','2026-11-03T10:00:00Z',{sys:120,dia:80}),record('b','2026-11-03T12:00:00Z',{sys:130,dia:84})];
 const model = buildChartModel(rs,'bp',options); assert.equal(model.series.length,2); assert.equal(model.stats.count,2); assert.equal(model.stats.numericCount,4);
 assert.equal(model.stats.series.sys.average,125); assert.equal(model.stats.series.dia.average,82); assert.equal(model.stats.average,null);
 const html = renderHealthChart(model); assert.match(html,/Systolic pressure/); assert.match(html,/Diastolic pressure/); assert.match(html,/mmHg/); assert.equal(model.days.at(-1).count,2);
});
test('sleep is individual recorded durations, never automatically summed or averaged', () => {
 const model = buildChartModel([record('nap','2026-11-03T09:00:00Z',{sleep:1}),record('night','2026-11-03T10:00:00Z',{sleep:7})],'sleep',options);
 assert.equal(model.mode,'sleep'); assert.equal(model.stats.average,null); assert.equal(model.stats.count,2); assert.equal(model.stats.max,7);
 const html = renderHealthChart(model); assert.equal((html.match(/<rect/g)||[]).length,2); assert.match(html,/Periods are not summed/); assert.doesNotMatch(html,/<dt>Average/);
});
test('mood and energy preserve ordinal levels with distributions, no continuous averages', () => {
 for (const key of ['mood','energy']) {
  const model = buildChartModel([record('a','2026-11-03T08:00:00Z',{[key]:2}),record('b','2026-11-03T09:00:00Z',{[key]:4}),record('c','2026-11-03T10:00:00Z',{[key]:4})],key,options);
  assert.equal(model.stats.average,null); assert.deepEqual(model.stats.distribution,{'2':1,'4':2}); assert.match(renderHealthChart(model),/Recorded score distribution/); assert.doesNotMatch(renderHealthChart(model),/<dt>Average/);
 }
});
test('glucose mixed meal contexts withhold averages while keeping every actual value', () => {
 const rs = [record('a','2026-11-03T08:00:00Z',{glucose:90}),record('b','2026-11-03T10:00:00Z',{glucose:120},{meta:{...meta,glucoseTiming:'after-meal'}})];
 const model = buildChartModel(rs,'glucose',options); assert.equal(model.stats.average,null); assert.equal(model.points.length,2); assert.equal(model.days.at(-1).summaries.glucose.average,null); assert.ok(model.warnings.some(w => w.id === 'context-average'));
 const unknown = buildChartModel([record('c','2026-11-03T10:00:00Z',{glucose:100},{meta:{...meta,glucoseTiming:'unknown'}})],'glucose',options); assert.equal(unknown.stats.average,null);
});
test('mixed measurement methods or temperature sites do not silently share a mean', () => {
 const rs = [record('a','2026-11-03T08:00:00Z',{temp:36.5}),record('b','2026-11-03T10:00:00Z',{temp:36.8},{meta:{...meta,temperatureSite:'axillary'}})];
 assert.equal(buildChartModel(rs,'temp',options).stats.average,null);
 const hearts = rs.map((r,i) => ({...r,values:{heart:70+i*10},context:i?'post-exercise':'resting'})); assert.equal(buildChartModel(hearts,'heart',options).stats.average,null);
});
test('display units convert actual canonical values and correctly label statistics', () => {
 const temperature = buildChartModel([record('t','2026-11-03T08:00:00Z',{temp:37})],'temp',{...options,unitPreferences:{temperature:'F'}});
 assert.equal(temperature.unit,'°F'); assert.equal(temperature.points[0].value,98.6); assert.equal(temperature.points[0].rawValue,37); assert.equal(temperature.stats.average,98.6);
 const glucose = buildChartModel([record('g','2026-11-03T08:00:00Z',{glucose:90.091})],'glucose',{...options,unitPreferences:{glucose:'mmol/L'}});
 assert.equal(glucose.points[0].value,5); assert.equal(glucose.unit,'mmol/L'); assert.match(renderHealthChart(glucose),/mmol\/L/);
});
test('equal-duration prior comparisons require real adequate samples and consistent known context', () => {
 const rs = Array.from({length:3},(_,i) => record('previous-'+i,`2026-11-02T${10+i}:00:00Z`,{heart:70+i})).concat(Array.from({length:3},(_,i) => record('current-'+i,`2026-11-03T${10+i}:00:00Z`,{heart:76+i})));
 const model = buildChartModel(rs,'heart',{...options,range:'24'}); assert.equal(model.previous.end-model.previous.start,model.end-model.start); assert.equal(model.previous.differences.heart.delta,6); assert.equal(model.previous.differences.heart.available,true);
 assert.equal(buildChartModel(rs.slice(1),'heart',{...options,range:'24'}).previous.differences.heart.available,false);
 const changed = structuredClone(rs); changed[0].meta.device='different'; assert.equal(buildChartModel(changed,'heart',{...options,range:'24'}).previous.differences.heart.available,false);
});
test('optional authenticated-user filter, invalid points and simulated provenance never mix accounts', () => {
 const rs = [record('mine','2026-11-03T10:00:00Z',{heart:70},{user_id:'u1'}),record('theirs','2026-11-03T10:00:00Z',{heart:90},{user_id:'u2'}),record('demo','2026-11-03T10:00:00Z',{heart:100},{user_id:'u1',source:'simulated'}),record('invalid','bad-time',{heart:50},{user_id:'u1'})];
 const model = buildChartModel(rs,'heart',{...options,userId:'u1'}); assert.equal(model.stats.count,1); assert.equal(model.points[0].id,'mine'); assert.equal(model.invalidCount,1);
 assert.deepEqual(availableMetrics(rs,{userId:'u2'}),['heart']);
});
test('malformed inputs fail clearly, absent indicators stay absent and duplicate IDs are not double counted', () => {
 assert.throws(() => buildChartModel(null,'heart',options),/array/); assert.throws(() => buildChartModel([],'nope',options),/supported/); assert.throws(() => buildChartModel([],'heart',{...options,range:'10'}),/Choose/);
 const rs = [record('a','2026-11-03T10:00:00Z',{heart:70,sys:120,dia:80})]; assert.deepEqual(availableMetrics(rs),['heart','bp']);
 const duplicate = buildChartModel([...rs,...rs],'heart',options); assert.equal(duplicate.stats.count,1); assert.equal(duplicate.invalidCount,1);
});
test('labels are escaped, Arabic descriptions work and SVG point sampling never removes stored originals', () => {
 const rs = Array.from({length:1300},(_,i) => record('r'+i,new Date(now-3600000+i*1000).toISOString(),{heart:70+i%4},{meta:{...meta,device:'<img onerror="evil()">'}}));
 const model = buildChartModel(rs,'heart',{...options,range:'24'}), html = renderHealthChart(model,{lang:'ar'});
 assert.equal(model.points.length,1300); assert.equal(model.stats.count,1300); assert.equal((html.match(/class="health-chart-point"/g)||[]).length,1200);
 assert.doesNotMatch(html,/<img/); assert.match(html,/&lt;img/); assert.match(html,/وقت القياس الفعلي/); assert.match(html,/جزءًا من النقاط الفعلية/); assert.equal((html.match(/<time datetime=/g)||[]).length,1300);
});
