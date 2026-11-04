// Offline only: validate approved formal data and prepare an immutable import packet.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {FILES}=require('./formal-route-fixtures.cjs');
const {validateRoute}=require('./check-route-data.cjs');
const core=require('../miniprogram/utils/trail-progress');
const fmt=require('../miniprogram/utils/format');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function fingerprint(value){let h=2166136261;for(const c of JSON.stringify(value).split(''))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h.toString(16).padStart(8,'0');}
function prepareRoutes({sourceDir=path.resolve(__dirname,'../data/routes'),outDir}={}){
 const prepared=Object.entries(FILES).map(([id,file])=>{
  const raw=fs.readFileSync(path.join(sourceDir,file));const r=JSON.parse(raw);
  assert.equal(r._id,id);validateRoute(r);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sourceDir,file.replace('.json','-import.json')))),r,'Import differs: '+id);
  const index=core.buildTrailIndex(r);assert.equal(index.status,'ready','Invalid B1 route: '+id);
  const payload=JSON.stringify(r)+'\n';
  return {payload,entry:{routeId:id,file:id+'.json',routeSha256:sha(raw),payloadSha256:sha(payload),trackSha256:sha(JSON.stringify(r.track)),rawRouteFingerprint:fingerprint(r),routeFingerprint:fingerprint(Object.assign({},r,{displayDistance:fmt.formatDistance(r.distanceMeters),displayDuration:fmt.formatDuration(r.estimatedDurationMinutes),displayDifficulty:fmt.formatDifficulty(r.difficulty),displayRouteType:fmt.formatRouteType(r.routeType),displayElevationGain:fmt.formatElevationGain(r.elevationGainMeters),...fmt.formatRouteCopy(r)})),trackFingerprint:fingerprint(r.track),trackPoints:r.track.length,waypoints:r.waypoints.length,b1Status:index.status,totalTrackMeters:index.totalTrackMeters,issues:index.issues}};
 });
 const x=prepared.find(x=>x.entry.routeId==='fj-route-005').entry;
 assert.equal(x.routeFingerprint,'7013cb0b');assert.equal(x.trackFingerprint,'c7fb2d5f');assert.equal(x.trackPoints,1004);assert.equal(x.waypoints,7);
 const manifest={kind:'V03_OFFLINE_IMPORT_CANDIDATE',suggestedCollection:'routes_v03',remoteVerified:false,gpsReleaseEnabled:false,routes:prepared.map(x=>x.entry)};
 if(outDir){assert(!fs.existsSync(outDir),'Output already exists; refusing overwrite');fs.mkdirSync(outDir,{recursive:true});for(const x of prepared)fs.writeFileSync(path.join(outDir,x.entry.file),x.payload,{flag:'wx'});fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});}
 return manifest;
}
if(require.main===module){try{const args=process.argv.slice(2);assert(args.length===0||(args.length===2&&args[0]==='--out'),'Usage: node scripts/prepare-v03-route-release.cjs [--out NEW_DIRECTORY]');console.log(JSON.stringify(prepareRoutes({outDir:args[1]}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={prepareRoutes};
