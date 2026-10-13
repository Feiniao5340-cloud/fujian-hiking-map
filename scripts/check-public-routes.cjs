// 构造最小临时公开测试候选：只有六正式数据及显式源码依赖；不提交/推送/访问云。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { FILES, loadFormalRoutes } = require('./formal-route-fixtures.cjs');
const { validateRoute } = require('./check-route-data.cjs');
const { toStartMapData } = require('../miniprogram/utils/map-data');
const core = require('../miniprogram/utils/trail-progress');
const root = path.resolve(__dirname, '..');
const commands = [
  ['scripts/check-route-data.cjs'], ['scripts/check-route-list.cjs'], ['scripts/check-route-detail.cjs'],
  ['scripts/check-map-data.cjs'], ['scripts/check-navigation.cjs'], ['scripts/check-multi-route.cjs'],
  ['scripts/check-mountain-route.cjs'], ['scripts/check-gpx-track.cjs'], ['scripts/check-trail-progress.cjs'],
  ['scripts/check-trail-follow.cjs'], ['scripts/check-trail-replay.cjs','--unit'],
  ['scripts/check-trail-replay.cjs','--matrix'], ['scripts/check-trail-replay.cjs','--formal'],
  ['scripts/check-trail-replay.cjs','--dense'],
  ['scripts/check-b1-verification.cjs','--before','docs/evidence/day6-b1-before-progress.txt']
];
const scriptFiles = [...new Set(commands.map(c=>c[0])), 'scripts/formal-route-fixtures.cjs',
  'scripts/gpx-to-track.cjs','scripts/prepare-gpx-route.cjs','scripts/prepare-gpx-route.ps1','scripts/check-public-routes.cjs'];
const sourceFiles = ['project.config.json', 'miniprogram/app.js','miniprogram/app.json','miniprogram/app.wxss','miniprogram/sitemap.json',
  'miniprogram/config/env.js', 'miniprogram/services/route-service.js','miniprogram/services/navigation-service.js',
  'miniprogram/services/trail-follow-service.js','miniprogram/utils/format.js','miniprogram/utils/map-data.js',
  'miniprogram/utils/trail-progress.js', ...['home','routes','route-detail'].flatMap(p=>['js','json','wxml','wxss'].map(ext=>`miniprogram/pages/${p}/index.${ext}`)),
  ...['start','waypoint','location'].map(n=>`miniprogram/assets/map/${n}.png`),
  'cloudfunctions/planAccessRoute/index.js','cloudfunctions/planAccessRoute/package.json'];
const dataFiles = Object.values(FILES).flatMap(f=>['data/routes/'+f,'data/routes/'+f.replace('.json','-import.json')]);
const publicTestFiles = [...sourceFiles,...scriptFiles,...dataFiles,'docs/evidence/day6-b1-before-progress.txt'];
const digest = p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const baseline = Object.fromEntries(publicTestFiles.map(p=>[p,digest(path.join(root,p))]));
const reports = loadFormalRoutes().map(r=>{
  validateRoute(r);
  const paired=JSON.parse(fs.readFileSync(path.join(root,'data/routes',FILES[r._id].replace('.json','-import.json')),'utf8'));
  assert.deepEqual(r,paired);const map=toStartMapData(r);assert.deepEqual(map.polyline[0].points,r.track);
  assert.equal(map.discardedTrackPointCount,0);assert.equal(map.markers.length,r.waypoints.length+1);
  const fields=Object.keys(r).sort();const schemaFields=['_id','schemaVersion','name','city','district','locationText','coverImage','distanceMeters','estimatedDurationMinutes','difficulty','elevationGainMeters','routeType','summary','description','bestSeason','notice','coordinateSystem','startPoint','track','waypoints','source','updatedAt'].sort();
  assert.deepEqual(fields,schemaFields,'Route根字段不允许私人扩展');
  assert.deepEqual(Object.keys(r.source).sort(),['infoSource','trackSource','originalCoordinateSystem','conversionMethod','permissionNote','checkedAt'].sort());
  assert.deepEqual(Object.keys(r.startPoint).sort(),['latitude','longitude','name']);
  for(const p of r.track)assert.deepEqual(Object.keys(p).sort(),['latitude','longitude']);
  for(const w of r.waypoints)assert.deepEqual(Object.keys(w).sort(),['id','name','type','latitude','longitude','description','distanceFromStartMeters'].sort());
  const raw=JSON.stringify(r);
  assert(!/BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]+|(?:secret|token|api[_-]?key)\s*["']?\s*:\s*["'][^"']{16,}|(?:[A-Z]:\\|\/Users\/|\/home\/)|_openid|unionid|session_key|access_token|userLocationHistory|locationHistory/i.test(raw),'私人字段/凭据/绝对路径');
  const index=core.buildTrailIndex(r);assert.equal(index.status,'ready');
  const longest=index.segments.reduce((a,b)=>a.lengthMeters>b.lengthMeters?a:b);
  return {id:r._id,name:r.name,file:'data/routes/'+FILES[r._id],trackPoints:r.track.length,waypoints:r.waypoints.length,
    geometryMeters:index.totalTrackMeters,maxAdjacentSegmentMeters:longest.lengthMeters,maxSegmentIndex:longest.segmentIndex,
    startToFirstMeters:core.distance(r.startPoint,r.track[0]),firstToLastMeters:core.distance(r.track[0],r.track.at(-1)),
    exactStartTrackIndex:r.track.findIndex(p=>p.latitude===r.startPoint.latitude&&p.longitude===r.startPoint.longitude),
    localData:'PASS',import:'PASS',orderedPolyline:'PASS',algorithmPreparation:'PASS',publicDataSafety:'PASS'};
});
// 本runner包含“缺席文件”断言本身；只对实际功能检查入口扫描依赖。
for(const p of scriptFiles.filter(p=>p.includes('check-') && p!=='scripts/check-public-routes.cjs')){
  const source=fs.readFileSync(path.join(root,p),'utf8');
  assert(!/data\/seed\/(?:mock-route|demo-routes|gushan)|miniprogram\/data\/mock-routes|_id:\s*['"](?:synthetic|qa-outback|local-route-b|boundary-A|boundary-B|regression-empty-only)['"]/.test(source),p+': retired route dependency');
}
const candidate=fs.mkdtempSync(path.join(os.tmpdir(),'fujian-public-six-routes-'));
for(const p of publicTestFiles){const target=path.join(candidate,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,p),target);}
for(const p of ['data/seed','data/raw','data/temporary','response.json','miniprogram/data/mock-routes.js','project.private.config.json','.git'])assert(!fs.existsSync(path.join(candidate,p)));
const results=[];
for(const args of commands){
  const result=cp.spawnSync(process.execPath,args,{cwd:candidate,encoding:'utf8'});
  results.push({command:'node '+args.join(' '),exitCode:result.status,output:result.stdout,stderr:result.stderr});
  console.log(JSON.stringify({command:args.join(' '),result:result.status===0?'LOCAL PASS':'FAIL'}));
  if(result.status!==0)break;
}
const unchanged=publicTestFiles.every(p=>baseline[p]===digest(path.join(root,p))&&baseline[p]===digest(path.join(candidate,p)));
assert(unchanged,'检查不得修改来源或候选文件');
const result=results.length===commands.length&&results.every(r=>r.exitCode===0)?'PASS':'FAIL';
const evidence={date:'2026-10-13',timezone:'Asia/Shanghai',result,evidenceType:'LOCAL_FORMAL_TRACK_DERIVED_GPS_NOT_PHONE_OR_CLOUD',
  reports,commands:results,publicTestFiles,protectedHashes:baseline,candidateDirectory:candidate,
  retiredFilesAbsent:true,sourceAndCandidateUnchanged:unchanged,cloudCalled:false,phoneTested:false};
const reportFile=path.join(os.tmpdir(),'fujian-day2-task1-public-tests.json');
fs.writeFileSync(reportFile,JSON.stringify(evidence,null,2));
console.log(JSON.stringify({result,routes:reports.length,checks:results.length,retiredFilesAbsent:true,sourceAndCandidateUnchanged:unchanged,reportFile}));
if(result!=='PASS')process.exitCode=1;
module.exports={publicTestFiles,commands};
