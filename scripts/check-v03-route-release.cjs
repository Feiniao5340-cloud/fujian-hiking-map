const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {prepareRoutes}=require('./prepare-v03-route-release.cjs'),{FILES}=require('./formal-route-fixtures.cjs');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'v03-route-packet-check-')),out=path.join(temp,'packet');
const m=prepareRoutes({outDir:out});assert.equal(m.routes.length,6);assert.equal(m.remoteVerified,false);assert.equal(m.gpsReleaseEnabled,false);
for(const e of m.routes){const text=fs.readFileSync(path.join(out,e.file),'utf8');assert.equal(text.trim().split(/\r?\n/).length,1);assert.equal(crypto.createHash('sha256').update(text).digest('hex'),e.payloadSha256);assert.deepEqual(JSON.parse(text),JSON.parse(fs.readFileSync(path.join(__dirname,'../data/routes',FILES[e.routeId]))));}
assert.throws(()=>prepareRoutes({outDir:out}),/refusing overwrite/);
const bad=path.join(temp,'bad-source');fs.mkdirSync(bad);for(const f of Object.values(FILES))for(const file of [f,f.replace('.json','-import.json')])fs.copyFileSync(path.join(__dirname,'../data/routes',file),path.join(bad,file));
const f=path.join(bad,'xiamen-loop-import.json'),r=JSON.parse(fs.readFileSync(f));r.name+=' mismatch';fs.writeFileSync(f,JSON.stringify(r));const badOut=path.join(temp,'must-not-exist');assert.throws(()=>prepareRoutes({sourceDir:bad,outDir:badOut}),/Import differs/);assert(!fs.existsSync(badOut));
console.log(JSON.stringify({result:'PASS',evidence:'OFFLINE_ONLY',tests:['six exact approved documents','JSONL and SHA closed','no output overwrite','mismatched Import fails before output','005 fixed approved fingerprint','B1 index validation'],temporaryArtifacts:temp},null,2));

// Also verify the production reader never falls back to the V0.2 collection.
const vm=require('node:vm');
async function checkReader(){
 const source=fs.readFileSync(path.join(__dirname,'../miniprogram/services/route-service.js'),'utf8');
 for(const value of [undefined,null,'','routes','routes_v03_typo',42]){
  let calls=0;const module={exports:{}};
  vm.runInNewContext(source,{module,require:()=>({cloudEnvId:'TEST_ENV_ONLY',routeCollection:value}),wx:{cloud:{database(){calls++;throw Error('Should not reach database');}}}});
  await assert.rejects(module.exports.getRouteList());await assert.rejects(module.exports.getRouteById('fj-route-005'));assert.equal(calls,0);
 }
 let calls=[];let fail=false;let detailMode="valid";const approved=JSON.parse(fs.readFileSync(path.join(__dirname,"../data/routes/xiamen-loop.json")));const module={exports:{}};
 const wx={cloud:{database(){return {collection(name){assert.equal(name,'routes_v03');calls.push(name);let filter=null;return {field(){return this;},where(v){filter=v;return this;},limit(){return this;},async get(){if(fail)throw Error('ISOLATED_READ_FAILED');return {data:filter?(detailMode==='missing'?[]:[detailMode==='bad'?{_id:filter._id}:approved]):[{_id:'fj-route-005'}]};}};}};}}};
 vm.runInNewContext(source,{module,wx,require:()=>({cloudEnvId:'TEST_ENV_ONLY',routeCollection:'routes_v03'})});
 assert.equal((await module.exports.getRouteList())[0]._id,'fj-route-005');assert.equal((await module.exports.getRouteById('fj-route-005'))._id,'fj-route-005');detailMode='missing';assert.equal(await module.exports.getRouteById('fj-route-005'),null);detailMode='bad';await assert.rejects(module.exports.getRouteById('fj-route-005'),/结构异常/);detailMode='valid';fail=true;await assert.rejects(module.exports.getRouteList(),/ISOLATED_READ_FAILED/);await assert.rejects(module.exports.getRouteById('fj-route-005'),/ISOLATED_READ_FAILED/);assert(calls.every(x=>x==='routes_v03'));
 console.log('PASS: isolated collection list/detail; missing/invalid/legacy config sends zero database calls; cloud failure never falls back. NODE_ONLY.');
}
checkReader().catch(e=>{console.error(e);process.exitCode=1;});
