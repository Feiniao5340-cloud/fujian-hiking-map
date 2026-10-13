const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { parseGpx, inspectFile, main } = require('./gpx-to-track.cjs');
const { wgs84ToGcj02 } = require('./prepare-gpx-route.cjs');
// GPX解析负例仅序列化正式Route的坐标；临时格式/转换测试，不声明它是原始WGS84或新路线。
const official = require('./formal-route-fixtures.cjs').routeById('fj-route-006');
const origin = official.track[0], next = official.track[1];
const xiamen = require('./formal-route-fixtures.cjs').routeById('fj-route-005');
const longSegment = require('../miniprogram/utils/trail-progress').buildTrailIndex(xiamen).segments.reduce((a,b)=>a.lengthMeters>b.lengthMeters?a:b);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fujian-gpx-check-'));
const files = []; let checks = 0;
const point = (lat, lon, ele = '') => `<trkpt lat="${lat}" lon="${lon}">${ele}</trkpt>`;
const wrap = body => `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;
function fixture(name, body) { const file = path.join(directory, name + '.gpx'); fs.writeFileSync(file, body); files.push(file); return file; }
function test(name, fn) { fn(); checks++; }
function cli(args) {
  const log = console.log, lines = [], previous = process.exitCode; console.log = text => lines.push(text); process.exitCode = undefined;
  try { main(args); return { lines, code: process.exitCode || 0 }; }
  finally { console.log = log; process.exitCode = previous; }
}
try {
  const a = point(origin.latitude, origin.longitude, '<ele>10</ele>'), duplicate = point(origin.latitude, origin.longitude, '<ele>12</ele>'), b = point(next.latitude, next.longitude, '<ele>14</ele>');
  const multi = fixture('multi', wrap(`<wpt lat="${origin.latitude}" lon="${origin.longitude}"><name>PRIVATE_ACCOUNT_SENTINEL</name></wpt><trk><trkseg>${a}${duplicate}</trkseg><trkseg>${duplicate}${b}${a}</trkseg></trk>`));
  const opts = { sourceCrs: 'wgs84', confirmed: true };
  let result;
  test('multi segment order and adjacent coordinate deduplication', () => {
    result = inspectFile(multi, opts); assert.equal(result.report.rawPoints, 5); assert.equal(result.report.deduplicatedPoints, 3);
    assert.deepEqual(result.analysis.retainedRawOrdinals, [1, 4, 5]); assert.equal(result.report.segmentCount, 2);
    assert.equal(result.report.convertedPoints, 3); assert.deepEqual(result.track[0], result.track[2]);
  });
  test('elevation survives duplicate removal; coordinate-only track', () => {
    assert.deepEqual(result.analysis.elevations.map(p => p.elevationMeters), [10, 12, 12, 14, 10]);
    assert.deepEqual(Object.keys(result.track[0]), ['latitude', 'longitude']); assert.equal(result.report.ignoredGpxWaypoints, 1);
    assert(!JSON.stringify(result).includes('PRIVATE_ACCOUNT_SENTINEL'));
  });
  test('shared D016 formula, bounds and endpoints', () => {
    assert.deepEqual(result.track[0], wgs84ToGcj02(origin));
    assert.equal(result.report.startEndDistance, 0); assert.equal(result.report.bounds.maxLatitude, Math.max(origin.latitude,next.latitude));
  });
  test('unknown coordinate system does not convert', () => { const r = inspectFile(multi); assert.equal(r.track, null); assert.equal(r.report.status, 'REVIEW'); assert.equal(r.report.convertedPoints, 0); });
  test('unconfirmed CLI system rejected', () => assert.throws(() => inspectFile(multi, { sourceCrs: 'wgs84' })));
  test('GCJ-02 is not converted twice', () => assert.deepEqual(inspectFile(multi, { sourceCrs: 'gcj02', confirmed: true }).track[0], origin));
  test('namespace prefix, CDATA, comments and GPX 1.0', () => {
    const xml = `<g:gpx version="1.0" xmlns:g="http://www.topografix.com/GPX/1/0"><!--x--><g:trk><g:trkseg><g:trkpt lat="${origin.latitude}" lon="${origin.longitude}"><g:ele><![CDATA[12.5]]></g:ele></g:trkpt></g:trkseg></g:trk></g:gpx>`;
    assert.equal(parseGpx(xml).segments[0].points[0].elevationMeters, 12.5);
  });
  test('invalid points block full output; no bridging', () => {
    const file = fixture('invalid', wrap(`<trk><trkseg>${a}${point('', origin.longitude)}${b}${point(91, origin.longitude)}${point(0, 0)}${point('NaN', origin.longitude)}</trkseg></trk>`));
    const r = inspectFile(file, opts); assert.equal(r.report.invalidPoints, 4); assert.equal(r.track, null); assert.equal(r.report.status, 'REJECT');
  });
  test('jump and segment boundary reported, never removed', () => {
    const file = fixture('jump', wrap(`<trk><trkseg>${point(longSegment.a.latitude,longSegment.a.longitude)}</trkseg><trkseg>${point(longSegment.b.latitude,longSegment.b.longitude)}</trkseg></trk>`));
    const r = inspectFile(file, opts); assert.equal(r.track.length, 2); assert.equal(r.report.suspiciousJumps.length, 1);
    assert.equal(r.report.suspiciousJumps[0].crossesSegment, true); assert.equal(r.report.segmentConnections.length, 1); assert.equal(r.report.status, 'REVIEW');
  });
  test('multiple tracks retain document order', () => {
    const xml = wrap(`<trk><trkseg>${a}</trkseg></trk><trk><trkseg>${b}</trkseg></trk>`); const p = parseGpx(xml);
    assert.equal(p.trackCount, 2); assert.equal(p.segments[1].trackNumber, 2);
  });
  test('missing/malformed elevation does not reject coordinates', () => {
    const file = fixture('elevation', wrap(`<trk><trkseg>${point(origin.latitude, origin.longitude, '<ele>bad</ele>')}${point(next.latitude,next.longitude)}</trkseg></trk>`));
    const r = inspectFile(file, opts); assert.equal(r.report.invalidElevationSamples, 1); assert.equal(r.track.length, 2);
  });
  test('safe XML rejects DTD and malformed documents', () => {
    for (const xml of ['<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///secret">]>' + wrap(`<trk><trkseg>${a}</trkseg></trk>`), wrap(`<trk><trkseg>${a}</trk></trkseg>`), wrap(`<trk><trkseg>${a}</trkseg></trk>`) + '<extra/>', wrap(`<trk><trkseg><trkpt lat="${origin.latitude}" lat="${next.latitude}" lon="${origin.longitude}"/></trkseg></trk>`), wrap(`<trk><trkseg>${a}<name>&unknown;</name></trkseg></trk>`), wrap(`<rte><rtept lat="${origin.latitude}" lon="${origin.longitude}"/></rte>`)]) assert.throws(() => parseGpx(xml));
  });
  test('hash matched manifest and conflicting system rejected', () => {
    const manifest = multi.replace('.gpx', '.source.json'); files.push(manifest);
    const source = { archivedFileName: path.basename(multi), sha256: crypto.createHash('sha256').update(fs.readFileSync(multi)).digest('hex'), originalCoordinateSystem: 'wgs84' };
    fs.writeFileSync(manifest, JSON.stringify(source)); assert.equal(inspectFile(multi).report.convertedPoints, 3);
    assert.throws(() => inspectFile(multi, { sourceCrs: 'gcj02', confirmed: true }));
    fs.writeFileSync(manifest, JSON.stringify({ ...source, sha256: 'bad' })); assert.throws(() => inspectFile(multi)); fs.unlinkSync(manifest); files.splice(files.indexOf(manifest), 1);
  });
  test('inspect mode does not convert', () => assert.equal(inspectFile(multi, { ...opts, inspect: true }).report.convertedPoints, 0));
  test('CLI output exclusive creation, protected paths and batch inspect', () => {
    const output = path.join(directory, 'track.json'); files.push(output);
    const args = [multi, '--source-crs', 'wgs84', '--confirmed', '--out', output]; cli(args.slice()); assert(fs.existsSync(output)); assert.throws(() => cli(args.slice()));
    assert.throws(() => cli([multi, '--source-crs', 'wgs84', '--confirmed', '--out', path.resolve(__dirname, '../data/routes/should-not-exist.json')]));
    const batch = JSON.parse(cli([directory, '--inspect']).lines[0]); assert.equal(batch.mode, 'batch-inspect'); assert(batch.reports.every(r => r.convertedPoints === 0));
  });
  test('Fujian bounds block mismatched regional coordinates', () => {
    const file = fixture('outside', wrap(`<trk><trkseg>${point(40, origin.longitude)}${point(40.01, next.longitude)}</trkseg></trk>`));
    const r = inspectFile(file, opts); assert.equal(r.track, null); assert.equal(r.report.outsideFujianRawOrdinals.length, 2);
  });
  console.log(JSON.stringify({ status: 'PASS', checks }));
} finally {
  for (const file of files) if (fs.existsSync(file)) fs.unlinkSync(file);
  fs.rmdirSync(directory);
}
