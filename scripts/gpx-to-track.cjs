// 开发期 GPX track 准备；不生成完整 Route，不调用网络或云端。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { wgs84ToGcj02, haversine } = require('./prepare-gpx-route.cjs');
const VERSION = 'gpx-to-track-v1';
const GPX_NS = new Set(['http://www.topografix.com/GPX/1/0', 'http://www.topografix.com/GPX/1/1']);
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function number(value) {
  return typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) ? Number(value) : NaN;
}
function decodeXml(value) {
  requireThat(!/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(value), 'Unsupported XML entity');
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity) => {
    const basic = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (basic[entity]) return basic[entity];
    const n = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    requireThat(n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff), 'Invalid XML character');
    return String.fromCodePoint(n);
  });
}

// 有界、无实体解析的 GPX XML 读取器；不执行 DTD、XInclude 或附件。
// 维护 XML 栈和命名空间，按文档顺序只读取 trk/trkseg/trkpt/ele。
function parseGpx(xml) {
  requireThat(typeof xml === 'string' && Buffer.byteLength(xml) <= 8 * 1024 * 1024, 'GPX exceeds 8 MiB limit');
  requireThat(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'DTD/entities are prohibited');
  requireThat(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml), 'Invalid XML control character');
  xml = xml.replace(/^\uFEFF/, '');
  const encoding = /^\s*<\?xml\b[^?]*encoding\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1];
  requireThat(!encoding || /^utf-8$/i.test(encoding), 'Only UTF-8 GPX is supported');
  const stack = [], segments = []; let cursor = 0, roots = 0, version, trackCount = 0, waypointCount = 0, segment, point;
  while (cursor < xml.length) {
    if (xml[cursor] !== '<') {
      const stop = xml.indexOf('<', cursor), end = stop < 0 ? xml.length : stop;
      requireThat(!xml.slice(cursor, end).includes(']]>'), 'CDATA terminator outside CDATA');
      const text = decodeXml(xml.slice(cursor, end));
      requireThat(stack.length > 0 || !text.trim(), 'Text outside XML root');
      if (stack.at(-1)?.isElevation) point.elevationText += text;
      cursor = end; continue;
    }
    if (xml.startsWith('<!--', cursor)) {
      const end = xml.indexOf('-->', cursor + 4); requireThat(end >= 0 && !xml.slice(cursor + 4, end).includes('--'), 'Malformed XML comment'); cursor = end + 3; continue;
    }
    if (xml.startsWith('<![CDATA[', cursor)) {
      const end = xml.indexOf(']]>', cursor + 9); requireThat(end >= 0 && stack.length, 'Malformed CDATA');
      if (stack.at(-1).isElevation) point.elevationText += xml.slice(cursor + 9, end);
      cursor = end + 3; continue;
    }
    if (xml.startsWith('<?', cursor)) {
      const end = xml.indexOf('?>', cursor + 2); requireThat(end >= 0, 'Malformed XML processing instruction'); cursor = end + 2; continue;
    }
    const token = /^<\/?[A-Za-z_][\w.:-]*(?:[^<>"']|"[^"<]*"|'[^'<]*')*>/.exec(xml.slice(cursor));
    requireThat(token, 'Malformed XML tag'); cursor += token[0].length;
    const tag = token[0], closing = tag.startsWith('</'), selfClosing = /\/>$/.test(tag);
    const name = /^<\/?([A-Za-z_][\w.:-]*)/.exec(tag)[1];
    if (closing) {
      requireThat(new RegExp('^</' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*>$').test(tag), 'Malformed closing tag');
      requireThat(stack.length && stack.at(-1).name === name, 'Mismatched XML tags');
      close(); continue;
    }
    const attrs = Object.create(null); let rest = tag.slice(1 + name.length, tag.length - (selfClosing ? 2 : 1));
    while (rest.trim()) {
      const match = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(rest);
      requireThat(match && !Object.hasOwn(attrs, match[1]), 'Malformed or duplicate XML attribute');
      attrs[match[1]] = decodeXml(match[3] ?? match[4]); rest = rest.slice(match[0].length);
    }
    const namespaces = { ...(stack.at(-1)?.namespaces || {}), xml: 'http://www.w3.org/XML/1998/namespace' };
    for (const [key, value] of Object.entries(attrs)) if (key === 'xmlns') namespaces[''] = value; else if (key.startsWith('xmlns:')) namespaces[key.slice(6)] = value;
    const parts = name.split(':'); requireThat(parts.length <= 2, 'Malformed XML name');
    const local = parts.at(-1), prefix = parts.length === 2 ? parts[0] : '';
    requireThat(!prefix || Object.hasOwn(namespaces, prefix), 'Unbound XML namespace');
    const ns = namespaces[prefix] || '', parent = stack.at(-1), gpx = GPX_NS.has(ns);
    if (!stack.length) {
      requireThat(++roots === 1 && local === 'gpx' && gpx && ['1.0', '1.1'].includes(attrs.version), 'Expected standard GPX 1.0/1.1 root');
      requireThat(ns.endsWith(attrs.version.replace('.', '/')), 'GPX namespace/version mismatch'); version = attrs.version;
    }
    const frame = { name, local, ns, namespaces };
    if (gpx && local === 'trk' && parent?.local === 'gpx' && parent.ns === ns) { frame.trackNumber = ++trackCount; }
    if (gpx && local === 'trkseg' && parent?.trackNumber) {
      segment = { segmentNumber: segments.length + 1, trackNumber: parent.trackNumber, points: [] }; segments.push(segment); frame.segment = segment;
    }
    if (gpx && local === 'trkpt' && parent?.segment) {
      segment = parent.segment; point = { latitude: number(attrs.lat), longitude: number(attrs.lon), elevationMeters: null, elevationText: '', elevationPresent: false };
      segment.points.push(point); frame.point = point;
    }
    if (gpx && local === 'ele' && parent?.point) { requireThat(!point.elevationPresent, 'Duplicate elevation element'); point.elevationPresent = true; frame.isElevation = true; }
    if (gpx && local === 'wpt' && parent?.local === 'gpx') waypointCount++;
    stack.push(frame); requireThat(stack.length <= 64, 'XML nesting exceeds limit'); if (selfClosing) close();
  }
  requireThat(roots === 1 && !stack.length, 'Incomplete XML document');
  requireThat(segments.length > 0 && segments.some(s => s.points.length), 'No track points; rte/wpt are not used as track');
  return { version, trackCount, waypointCount, segments };
  function close() {
    const frame = stack.pop();
    if (frame.point) {
      const value = number(frame.point.elevationText);
      frame.point.elevationMeters = Number.isFinite(value) ? value : null;
      frame.point.invalidElevation = frame.point.elevationPresent && !Number.isFinite(value);
      delete frame.point.elevationText;
    }
  }
}
function valid(p) { return Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && !(p.latitude === 0 && p.longitude === 0); }
function bounds(points) {
  if (!points.length) return null;
  const b = { minLatitude: Infinity, maxLatitude: -Infinity, minLongitude: Infinity, maxLongitude: -Infinity };
  for (const p of points) { b.minLatitude = Math.min(b.minLatitude, p.latitude); b.maxLatitude = Math.max(b.maxLatitude, p.latitude); b.minLongitude = Math.min(b.minLongitude, p.longitude); b.maxLongitude = Math.max(b.maxLongitude, p.longitude); }
  return b;
}
function inspectFile(input, options = {}) {
  const bytes = fs.readFileSync(input); requireThat(bytes.length <= 8 * 1024 * 1024, 'GPX exceeds 8 MiB limit');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const parsed = parseGpx(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const manifestFile = input.replace(/\.gpx$/i, '.source.json');
  let crs = null, confirmation = null;
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
    requireThat(manifest.sha256 === sha256 && manifest.archivedFileName === path.basename(input), 'Source manifest/hash mismatch');
    if (['wgs84', 'gcj02'].includes(manifest.originalCoordinateSystem)) { crs = manifest.originalCoordinateSystem; confirmation = 'hash-matched source manifest'; }
  }
  if (options.sourceCrs) {
    requireThat(options.confirmed && ['wgs84', 'gcj02'].includes(options.sourceCrs), '--source-crs requires wgs84/gcj02 and --confirmed');
    requireThat(!crs || crs === options.sourceCrs, 'CLI coordinate system conflicts with source manifest');
    crs = options.sourceCrs; confirmation ||= 'operator --source-crs with --confirmed';
  }
  const raw = [], segmentBoundaries = [];
  for (const s of parsed.segments) {
    segmentBoundaries.push({ segmentNumber: s.segmentNumber, trackNumber: s.trackNumber, rawStartOrdinal: raw.length + 1, rawPoints: s.points.length });
    for (const p of s.points) raw.push({ ...p, rawOrdinal: raw.length + 1, segmentNumber: s.segmentNumber });
  }
  const kept = [], duplicateOrdinals = [], invalidDetails = [];
  for (const p of raw) {
    if (!valid(p)) invalidDetails.push({ rawOrdinal: p.rawOrdinal, reason: 'non-finite, missing, out of range or 0,0 coordinate' });
    const previous = kept.at(-1);
    if (valid(p) && previous && valid(previous) && p.latitude === previous.latitude && p.longitude === previous.longitude) duplicateOrdinals.push(p.rawOrdinal);
    else kept.push(p);
  }
  const suspiciousJumps = [], segmentConnections = [], threshold = options.jumpMeters ?? 100;
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1], b = kept[i]; if (!valid(a) || !valid(b)) continue;
    const edge = { fromRawOrdinal: a.rawOrdinal, toRawOrdinal: b.rawOrdinal, distanceMeters: haversine(a, b), crossesSegment: a.segmentNumber !== b.segmentNumber };
    if (edge.crossesSegment) segmentConnections.push(edge);
    if (edge.distanceMeters > threshold) suspiciousJumps.push(edge);
  }
  const geographicErrors = crs ? kept.filter(p => valid(p) && !(p.latitude >= 23 && p.latitude <= 29 && p.longitude >= 115 && p.longitude <= 122)).map(p => p.rawOrdinal) : [];
  const eligible = !invalidDetails.length && !geographicErrors.length && kept.length >= 2 && !!crs;
  const track = eligible && !options.inspect ? kept.map(p => crs === 'wgs84' ? wgs84ToGcj02(p) : ({ latitude: p.latitude, longitude: p.longitude })) : null;
  const start = valid(raw[0]) ? { latitude: raw[0].latitude, longitude: raw[0].longitude } : null;
  const end = valid(raw.at(-1)) ? { latitude: raw.at(-1).latitude, longitude: raw.at(-1).longitude } : null;
  const report = {
    status: invalidDetails.length || geographicErrors.length || kept.length < 2 ? 'REJECT' : !crs || suspiciousJumps.length || parsed.trackCount > 1 ? 'REVIEW' : 'PASS',
    filename: path.basename(input), sourceSha256: sha256, gpxVersion: parsed.version, trackCount: parsed.trackCount, segmentCount: parsed.segments.length,
    sourceCoordinateSystem: crs, coordinateConfirmation: confirmation, outputCoordinateSystem: 'gcj02',
    rawPoints: raw.length, deduplicatedPoints: kept.length, convertedPoints: track?.length || 0,
    adjacentDuplicatesRemoved: duplicateOrdinals.length, duplicateRawOrdinals: duplicateOrdinals,
    invalidPoints: invalidDetails.length, invalidPointDetails: invalidDetails, outsideFujianRawOrdinals: geographicErrors,
    suspiciousJumps, jumpThresholdMeters: threshold, segmentBoundaries, segmentConnections,
    bounds: bounds(raw.filter(valid)), boundsCoordinateSystem: crs, convertedBounds: track ? bounds(track) : null,
    start, end, startEndDistance: start && end ? haversine(start, end) : null,
    conversionEligible: eligible, ignoredGpxWaypoints: parsed.waypointCount,
    method: crs === 'gcj02' ? VERSION + ': confirmed GCJ-02 passthrough' : VERSION + ': adjacent coordinate deduplication; shared D016 offline WGS84->GCJ-02 equations; no simplification',
    elevationSamples: raw.filter(p => p.elevationMeters !== null).length,
    invalidElevationSamples: raw.filter(p => p.invalidElevation).length
  };
  return { artifactType: 'route-track-preparation-not-formal-route', toolVersion: VERSION, report, track,
    analysis: { elevations: raw.map(p => ({ rawOrdinal: p.rawOrdinal, elevationMeters: p.elevationMeters })), retainedRawOrdinals: kept.map(p => p.rawOrdinal) } };
}
function main(args) {
  const help = 'node scripts/gpx-to-track.cjs <input.gpx|directory> [--inspect] [--source-crs wgs84|gcj02 --confirmed] [--jump-meters 100] [--out output.json]';
  if (!args.length || args.includes('--help')) { console.log(help); return; }
  const input = path.resolve(args.shift()), options = {}; let out;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--inspect') options.inspect = true;
    else if (arg === '--confirmed') options.confirmed = true;
    else if (['--source-crs', '--jump-meters', '--out'].includes(arg)) {
      const value = args.shift(); requireThat(value && !value.startsWith('--'), 'Missing option value');
      if (arg === '--source-crs') options.sourceCrs = value;
      else if (arg === '--out') out = path.resolve(value);
      else { options.jumpMeters = number(value); requireThat(Number.isFinite(options.jumpMeters) && options.jumpMeters > 0, 'Positive jump threshold required'); }
    } else throw new Error('Unknown option; ' + help);
  }
  requireThat(!options.confirmed || options.sourceCrs, '--confirmed requires --source-crs');
  if (fs.statSync(input).isDirectory()) {
    requireThat(!out, 'Directory mode is batch inspect only; no output files');
    const reports = fs.readdirSync(input, { withFileTypes: true }).filter(f => f.isFile() && /\.gpx$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name)).map(f => {
      try { return inspectFile(path.join(input, f.name), { ...options, inspect: true }).report; }
      catch (error) { return { filename: f.name, status: 'REJECT', error: error.message }; }
    });
    console.log(JSON.stringify({ mode: 'batch-inspect', reports }, null, 2)); if (reports.some(r => r.status === 'REJECT')) process.exitCode = 1; return;
  }
  requireThat(/\.gpx$/i.test(input), 'Expected .gpx input');
  const result = inspectFile(input, options);
  if (out) {
    requireThat(!options.inspect && result.track, 'No valid converted track; output file not written');
    const parent = fs.realpathSync(path.dirname(out)), destination = path.join(parent, path.basename(out));
    const root = path.resolve(__dirname, '..');
    for (const dir of ['data/raw', 'data/routes', 'data/seed', 'miniprogram', 'cloudfunctions', 'scripts', '.git']) {
      const relative = path.relative(path.join(root, dir), destination);
      requireThat(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Use a private preparation output outside source/formal/code directories');
    }
    requireThat(destination !== fs.realpathSync(input), 'Cannot overwrite source');
    fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
    console.log(JSON.stringify({ ...result.report, output: destination }, null, 2));
  } else console.log(JSON.stringify(options.inspect ? result.report : result, null, 2));
  if (result.report.status === 'REJECT') process.exitCode = 1;
  else if (!result.report.conversionEligible && !options.inspect) process.exitCode = 2;
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(JSON.stringify({ status: 'REJECT', error: error.message })); process.exitCode = 1; }
}
module.exports = { parseGpx, inspectFile, main };
