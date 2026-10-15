// Native overview tests: callbacks are substitutes, never real DevTools proof.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../miniprogram/utils/trail-progress'),api=require('../miniprogram/utils/native-route-overview');
const {loadFormalRoutes}=require('./formal-route-fixtures.cjs');
const routes=loadFormalRoutes(),route=routes.find(r=>r._id==='fj-route-008'),original=JSON.stringify(route),cases=[];
function test(name,fn){fn();cases.push(name);}
function harness(raw=false,extra={},input=route){
 let now=100000;const timers=new Set(),moves=[],states=[],removed=[],adds=[];
 const ctx={addMarkers(o){adds.push(o);o.success();},removeMarkers(o){removed.push(o);o.success();},moveAlong(o){moves.push({options:o,at:now});}};
 const session=api.create(input,ctx,{raw,now:()=>now,setTimeout(fn,ms){const t={fn,due:now+ms};timers.add(t);return t;},clearTimeout(t){timers.delete(t);},onState:s=>states.push(s),...extra});
 return {session,ctx,moves,states,removed,adds,timers,advance(ms){now+=ms;},get now(){return now;},complete(){const m=moves.at(-1);now=Math.max(now,m.at+m.options.duration);m.options.success();m.options.complete();for(const t of [...timers])if(t.due<=now){timers.delete(t);t.fn();}},flush(){for(const t of [...timers])if(t.due<=now){timers.delete(t);t.fn();}},timeout(){for(const t of [...timers]){now=Math.max(now,t.due);timers.delete(t);t.fn();}}};
}
test('explicit008/010 only; invalid geometry/API rejected',()=>{for(const r of routes)assert.equal(api.enabledRoute(r),['fj-route-008','fj-route-010'].includes(r._id));assert.throws(()=>api.prepare({...route,track:[]}),/INVALID_OVERVIEW_TRACK/);assert.throws(()=>api.create(route,{}),/NATIVE_API_UNAVAILABLE/);});
let maxBoundaryError=0;
test('raw7035 exact; 16 pieces retain all original coordinates and geometry',()=>{
 const raw=api.prepare(route,true),p=api.prepare(route);assert.deepEqual(raw.pieces[0].path,route.track);assert.equal(p.pieces.length,16);
 assert.deepEqual(p.pieces[0].path[0],route.track[0]);assert.deepEqual(p.pieces.at(-1).path.at(-1),route.track.at(-1));
 const included=new Set(p.pieces.flatMap(x=>x.path.map(q=>JSON.stringify(q))));for(const q of route.track)assert(included.has(JSON.stringify(q)));
 for(const piece of p.pieces)for(const [q,s] of [[piece.path[0],piece.from],[piece.path.at(-1),piece.to]]){
  const seg=p.index.segments.find(e=>e.endMeters>=s)||p.index.segments.at(-1),t=Math.max(0,Math.min(1,(s-seg.startMeters)/seg.lengthMeters));
  maxBoundaryError=Math.max(maxBoundaryError,core.distance(q,{latitude:seg.a.latitude+(seg.b.latitude-seg.a.latitude)*t,longitude:seg.a.longitude+(seg.b.longitude-seg.a.longitude)*t}));assert(maxBoundaryError<0.0001);
 }assert.equal(JSON.stringify(route),original);
});
test('16 delayed native success callbacks; no position event needed; no per-segment setData',()=>{
 const h=harness();h.session.start();assert.equal(h.session.getSnapshot().progressRatio,0);
 assert.equal(h.adds[0].clear,false);assert.equal(h.adds[0].markers[0].id,-2);assert.deepEqual(h.adds[0].markers[0].anchor,{x:0.5,y:0.5});
 for(let i=0;i<16;i++)h.complete();const s=h.session.getSnapshot();assert.equal(s.status,'finished');assert.equal(s.progressRatio,1);assert.equal(s.completedSegments,16);assert.equal(s.finishedElapsedMs,15504);assert.equal(s.events,0);assert.equal(s.b1Matched,false);assert.equal(s.actualOutdoorCompleted,false);assert.equal(h.states.length,3);assert.equal(h.timers.size,0);
});
test('raw delayed completion 3000ms; early acceptance/time-only/event cannot fake done',()=>{
 const raw=harness(true);raw.session.start();raw.complete();assert.equal(raw.session.getSnapshot().status,'finished');assert.equal(raw.session.getSnapshot().finishedElapsedMs,3000);
 const early=harness();early.session.start();early.moves[0].options.success();assert.equal(early.session.getSnapshot().lastError,null);assert.equal(early.removed.length,0);early.timeout();assert.equal(early.session.getSnapshot().lastError,'NATIVE_REPLAY_TIMEOUT');assert.equal(early.session.getSnapshot().progressRatio,0);
 const none=harness();none.session.start();none.advance(1000);none.session.event({detail:{markerId:-2,...route.track[0],animationStatus:'complete'}});assert.equal(none.session.getSnapshot().progressRatio,0);none.timeout();assert.equal(none.session.getSnapshot().lastError,'NATIVE_REPLAY_TIMEOUT');
});
test('pause finishes current segment only; freezes; resume follows exact boundary, no catch-up',()=>{
 const h=harness();h.session.start();const m=h.moves[0];h.advance(400);h.session.pause();assert.equal(h.session.getSnapshot().status,'pausing');h.session.pause();assert.equal(h.moves.length,1);
 h.complete();const s=h.session.getSnapshot();assert.equal(s.status,'paused');assert.equal(s.pauseBoundaryLatencyMs,569);assert.equal(s.completedSegments,1);assert.equal(h.moves.length,1);assert.equal(h.timers.size,0);
 h.advance(10000);assert.equal(h.session.getSnapshot().progressRatio,s.progressRatio);assert.equal(h.session.getSnapshot().activeElapsedMs,s.activeElapsedMs);
 h.session.resume();h.flush();assert.equal(h.moves.length,2);assert.deepEqual(h.moves[1].options.path[0],m.options.path.at(-1));h.session.resume();h.flush();assert.equal(h.moves.length,2);
 for(let i=1;i<16;i++)h.complete();assert.equal(h.session.getSnapshot().status,'finished');assert.equal(h.session.getSnapshot().activeElapsedMs,15504);
});
test('stale callbacks after resume/dispose cannot advance; failed move visible; last-segment pause completes naturally',()=>{
 const h=harness();h.session.start();const first=h.moves[0].options;h.complete();const before=h.session.getSnapshot().completedSegments;first.success();first.fail();assert.equal(h.session.getSnapshot().completedSegments,before);h.session.dispose();h.moves.at(-1).options.success();assert.equal(h.session.getSnapshot().status,'disposed');assert.equal(h.timers.size,0);assert.deepEqual(h.removed[0].markerIds,[-2]);
 const fail=harness();fail.session.start();fail.moves[0].options.fail();assert.equal(fail.session.getSnapshot().lastError,'NATIVE_MOVE_REJECTED');
 const last=harness();last.session.start();for(let i=0;i<15;i++)last.complete();last.session.pause();last.complete();assert.equal(last.session.getSnapshot().status,'finished');
});
test('realPage adapter: native008 repeated start, restart generation, hide/unload; no GPS or B1',()=>{
 const root=path.resolve(__dirname,'..');let def,updates=0,simCreates=0;const moves=[],timers=new Set(),removed=[];let holdRemoval=false,pendingRemoval=null;
 const wx={getSystemInfoSync(){throw Error('identity forbidden');},createMapContext(){return {addMarkers(o){o.success();},removeMarkers(o){removed.push(o);if(holdRemoval)pendingRemoval=o;else o.success();},moveAlong(o){moves.push(o);}};},getLocation(){throw Error('GPS forbidden');}};
 const clock={setTimeout(fn,ms){const t={fn,ms};timers.add(t);return t;},clearTimeout(t){timers.delete(t);},setInterval(){throw Error('no native simulation interval');},clearInterval(){}};
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'miniprogram/utils/native-route-overview.js'),'utf8'),{module:mod,require:()=>core,Date,...clock});
 vm.runInNewContext(fs.readFileSync(path.join(root,'miniprogram/pages/route-detail/index.js'),'utf8'),{wx,Date,...clock,console,Page(d){def=d;},require(n){
  if(n.includes('native-route-overview'))return mod.exports;
  if(n.includes('route-service'))return {getRouteById:async()=>route};
  if(n.includes('trail-simulator'))return {...require('../miniprogram/utils/trail-simulator'),createSimulator(){simCreates++;throw Error('native must not run B1');}};
  if(n.includes('trail-follow-service'))return {createSession(){throw Error('GPS forbidden');}};
  return require(path.resolve(root,'miniprogram/pages/route-detail',n));
 }});
 const p={...def,data:JSON.parse(JSON.stringify(def.data)),setData(patch){assert(!this._unloaded);updates++;Object.assign(this.data,patch);}};
 p.data.route=route;p.data.status='success';p._hidden=false;p._unloaded=false;p.onSimulationStartTap();p.onSimulationStartTap();assert.equal(moves.length,1);assert.equal(simCreates,0);
 p.onSimulationPauseTap();assert.equal(p.data.overviewState.status,'pausing');assert.equal(moves.length,1);
 const stale=moves[0];p.onSimulationRestartTap();assert.equal(moves.length,2);stale.success();assert.equal(p.getPlanBSummary().completedSegments,0);
 p.onNativeOverviewPoint({detail:{unexpectedField:true}});assert.equal(p.getPlanBSummary().incomingEvents,1);assert.equal(p.getPlanBSummary().events,0);
 p.onHide();assert.equal(p._nativeOverview,null);assert.equal(timers.size,0);p.onUnload();assert.equal(timers.size,0);assert(removed.length>=2);assert(updates<15);
  const q={...def,data:JSON.parse(JSON.stringify(def.data)),setData(patch){assert(!this._unloaded);Object.assign(this.data,patch);}};
 q.data.route=route;q.data.status='success';q._hidden=false;q._unloaded=false;q.onSimulationStartTap({currentTarget:{dataset:{first:'true'}}});assert.equal(q.getPlanBSummary().firstSegmentOnly,true);
 const one=moves.at(-1);one.path.forEach(p=>q.onNativeOverviewPoint({detail:{...p,markerId:-2,animationStatus:'interpolating'}}));one.success();one.complete();q.onNativeOverviewPoint({detail:{...one.path.at(-1),markerId:-2,animationStatus:'complete'}});assert.equal(q.getPlanBSummary().status,'paused');assert.equal(q.getPlanBSummary().completedSegments,1);
 holdRemoval=true;q.onSimulationRestartTap();const beforeLate=moves.length;const cleanup=[...timers].find(t=>t.ms===1500);assert(cleanup);timers.delete(cleanup);cleanup.fn();assert.equal(q.data.overviewState.message,'NATIVE_REMOVE_TIMEOUT');holdRemoval=false;pendingRemoval.success();assert.equal(moves.length,beforeLate,'late cleanup ACK after timeout must not launch');q.onUnload();assert.equal(timers.size,0);
 const safe=v=>{if(v&&typeof v==='object'){assert(!Object.keys(v).some(k=>['latitude','longitude','path','track'].includes(k)));Object.values(v).forEach(safe);}};safe(p.getPlanBSummary());
 const markup=fs.readFileSync(path.join(root,'miniprogram/pages/route-detail/index.wxml'),'utf8');assert(markup.includes('bind:interpolatepoint="onNativeOverviewPoint"'));assert(!markup.includes('demo-notice'));assert(!markup.includes('播放倍率'));
});
// R3 signals are deterministic native substitutes, all coordinates from the official008
// Track/path; they are not device evidence and do not manufacture a seventh Route.
function send(h,p,status='interpolating',markerId=-2){h.session.event({detail:{...p,markerId,animationStatus:status}});}
function travelEvents(h){const path=h.moves.at(-1).options.path;path.forEach(p=>send(h,p));}
function finishEvent(h,terminalFirst=false){const m=h.moves.at(-1),at=m.at;travelEvents(h);h.advance(Math.max(0,at+650-h.now));if(terminalFirst)send(h,m.options.path.at(-1),'complete');h.advance(Math.max(0,at+689-h.now));m.options.success();m.options.complete();h.advance(Math.max(0,at+704-h.now));if(!terminalFirst)send(h,m.options.path.at(-1),'complete');h.flush();}
test('R3 early success689 waits terminal704, no removal, first-only boundary never submits second',()=>{
 const h=harness(false,{firstSegmentOnly:true});h.session.start();travelEvents(h);h.advance(689);const m=h.moves[0].options;m.success();m.complete();assert.equal(h.session.getSnapshot().completedSegments,0);assert.equal(h.removed.length,0);h.advance(15);send(h,m.path.at(-1),'complete');assert.equal(h.session.getSnapshot().status,'paused');assert.equal(h.session.getSnapshot().completedSegments,1);assert.equal(h.moves.length,1);assert.equal(h.timers.size,0);assert.equal(h.session.getSnapshot().completionEvidence,'NATIVE_TERMINAL_WITH_ORDERED_TRAVEL');
});
test('R3 terminal before success and API complete reordered; duplicate callbacks confirm once',()=>{
 const h=harness();h.session.start();travelEvents(h);h.advance(704);const o=h.moves[0].options;send(h,o.path.at(-1),'complete');send(h,o.path.at(-1),'complete');assert.equal(h.session.getSnapshot().completedSegments,0);o.complete();assert.equal(h.session.getSnapshot().completedSegments,0);o.success();o.success();o.complete();assert.equal(h.session.getSnapshot().completedSegments,1);assert.equal(h.moves.length,1);h.flush();assert.equal(h.moves.length,2);o.success();o.fail();send(h,o.path.at(-1),'complete');assert.equal(h.session.getSnapshot().completedSegments,1);
});
test('R3 all16 actual raw-path observations incl sparse segments; only final confirmed once',()=>{
 const h=harness();h.session.start();for(let i=0;i<16;i++){const old=h.moves.at(-1).options;finishEvent(h,i%2===0);assert.equal(h.session.getSnapshot().completedSegments,i+1);old.success();old.complete();send(h,old.path.at(-1),'complete');}
 const s=h.session.getSnapshot();assert.equal(s.status,'finished');assert.equal(s.progressRatio,1);assert.equal(h.moves.length,16);assert.equal(h.timers.size,0);assert.equal(s.completedSegments,16);assert.equal(s.b1Matched,false);assert.equal(s.actualOutdoorCompleted,false);assert.equal(s.lastConfirmedSegment,15);
});
test('R3 terminal alone/shared boundary/old late terminal cannot establish next progress; missing terminal times out',()=>{
 const h=harness();h.session.start();finishEvent(h);const previous=h.moves[0].options.path.at(-1),next=h.moves[1].options;send(h,previous,'complete');send(h,next.path.at(-1),'complete');assert.equal(h.session.getSnapshot().currentWitnessCount,0);h.advance(969);next.success();next.complete();assert.equal(h.session.getSnapshot().completedSegments,1);h.timeout();assert.equal(h.session.getSnapshot().status,'error');assert.equal(h.session.getSnapshot().lastError,'NATIVE_REPLAY_TIMEOUT');
});
test('R3 invalid marker/coordinate/status do not establish capability; off-end and no ordered travel rejected',()=>{
 const h=harness();h.session.start();const p=h.moves[0].options.path[0];send(h,p,'interpolating',5);send(h,{latitude:NaN,longitude:0});send(h,p,'unknown');assert.equal(h.session.getSnapshot().events,0);send(h,p);send(h,h.moves[0].options.path.at(-1),'complete');assert.equal(h.session.getSnapshot().completedSegments,0);assert(h.session.getSnapshot().rejectedTerminal>0);h.timeout();assert.equal(h.session.getSnapshot().progressRatio,0);
 assert.throws(()=>harness(false,{endpointMeters:40}),/INVALID_ENDPOINT_TOLERANCE/);
});
test('R3 pause during async handoff cancels next; resume no catchup; final pause finishes normally',()=>{
 const h=harness();h.session.start();const o=h.moves[0].options;travelEvents(h);h.advance(704);o.success();send(h,o.path.at(-1),'complete');assert.equal(h.moves.length,1);h.session.pause();assert.equal(h.session.getSnapshot().status,'paused');const ratio=h.session.getSnapshot().progressRatio;h.advance(10000);assert.equal(h.session.getSnapshot().progressRatio,ratio);h.session.resume();assert.equal(h.moves.length,1);h.flush();assert.equal(h.moves.length,2);for(let i=1;i<15;i++)finishEvent(h);h.session.pause();finishEvent(h);assert.equal(h.session.getSnapshot().status,'finished');
});
test('R3 queued handoff disposed; old event and old API callbacks cannot revive removed session',()=>{
 const h=harness();h.session.start();travelEvents(h);const o=h.moves[0].options;h.advance(704);o.success();send(h,o.path.at(-1),'complete');h.session.dispose();h.flush();send(h,o.path.at(-1),'complete');o.success();o.complete();assert.equal(h.moves.length,1);assert.equal(h.session.getSnapshot().status,'disposed');assert.equal(h.timers.size,0);
});
test('R3 no-event early callbacks alone never complete; valid event forbids callback fallback',()=>{
 const early=harness();early.session.start();early.advance(689);early.moves[0].options.success();early.moves[0].options.complete();early.advance(1000);assert.equal(early.session.getSnapshot().progressRatio,0);early.timeout();assert.equal(early.session.getSnapshot().status,'error');
 const partial=harness();partial.session.start();send(partial,partial.moves[0].options.path[0]);partial.complete();assert.equal(partial.moves.length,1);assert.equal(partial.session.getSnapshot().completedSegments,0);partial.timeout();assert.equal(partial.session.getSnapshot().status,'error');
});
test('R3 late add must settle before dispose acknowledgement; failed cleanup visible',()=>{
 const h=harness();let add;h.ctx.addMarkers=o=>{add=o;};h.session.start();let ack=false;h.session.dispose(()=>ack=true);assert.equal(ack,false);assert.equal(h.removed.length,0);add.success();assert.equal(ack,true);assert.equal(h.moves.length,0);assert.equal(h.removed.length,1);
 const f=harness();f.session.start();f.ctx.removeMarkers=o=>o.fail();let code;f.session.dispose(e=>code=e);assert.equal(code,'NATIVE_REMOVE_FAILED');assert.equal(f.session.getSnapshot().status,'disposed');
});
const taimushan=routes.find(r=>r._id==='fj-route-010');
test('Task5 frozen explicit config enables008/010 only; unknown/prototype IDs rejected',()=>{
 assert(Object.isFrozen(api.OVERVIEW_CONFIG));assert(Object.values(api.OVERVIEW_CONFIG).every(Object.isFrozen));
 for(const r of routes){assert.equal(api.enabledRoute(r),['fj-route-008','fj-route-010'].includes(r._id));if(!api.enabledRoute(r))assert.throws(()=>api.prepare(r),/NOT_OVERVIEW_ROUTE/);}
 assert.equal(api.enabledRoute({_id:'toString'}),false);assert.equal(api.enabledRoute(null),false);assert.equal(api.enabledRoute({_id:'fj-route-007'}),false);
 assert.deepEqual(api.getOverviewConfig(route),{segments:16,targetMs:15500,start:'track-first',end:'track-last'});
 assert.deepEqual(api.getOverviewConfig(taimushan),api.getOverviewConfig(route));
});
test('Task5 010 all6395 vertices and prefix retained;16 continuous original segments; real end not closed',()=>{
 const before=JSON.stringify(taimushan),p=api.prepare(taimushan);assert.equal(p.sourcePoints,6395);assert.equal(p.index.segments.length,6394);assert.equal(p.pieces.length,16);assert.equal(p.duration,15500);
 assert.deepEqual(p.pieces[0].path.slice(0,5),taimushan.track.slice(0,5));assert.deepEqual(taimushan.startPoint,{...taimushan.track[4],name:taimushan.startPoint.name});
 assert.deepEqual(p.pieces.at(-1).path.at(-1),taimushan.track.at(-1));assert(core.distance(taimushan.track[0],p.pieces.at(-1).path.at(-1))>40);
 const all=new Set(p.pieces.flatMap(x=>x.path.map(q=>JSON.stringify(q))));for(const q of taimushan.track)assert(all.has(JSON.stringify(q)));
 for(let n=0;n<16;n++){const x=p.pieces[n];if(n)assert.deepEqual(x.path[0],p.pieces[n-1].path.at(-1));
  for(const [v,s] of [[x.path[0],x.from],[x.path.at(-1),x.to]]){const seg=p.index.segments.find(e=>e.endMeters>=s)||p.index.segments.at(-1),t=Math.max(0,Math.min(1,(s-seg.startMeters)/seg.lengthMeters));assert(core.distance(v,{latitude:seg.a.latitude+(seg.b.latitude-seg.a.latitude)*t,longitude:seg.a.longitude+(seg.b.longitude-seg.a.longitude)*t})<1e-4);}
 }
 assert.equal(Math.max(...p.pieces.map(x=>x.path.length)),420);assert.equal(p.pieces.reduce((n,x)=>n+x.path.length,0),6425);assert.equal(taimushan.waypoints.length,4);assert.equal(JSON.stringify(taimushan),before);
});
test('Task5 010 empirical no-event full16 and correctly captured routeId; no B1 fiction',()=>{
 const h=harness(false,{},taimushan);h.session.start();assert.equal(h.session.getSnapshot().routeId,'fj-route-010');assert.deepEqual(h.adds[0].markers[0].anchor,{x:.5,y:.5});assert.equal(h.adds[0].markers[0].width,22);
 for(let n=0;n<16;n++)h.complete();const s=h.session.getSnapshot();assert.equal(s.status,'finished');assert.equal(s.completedSegments,16);assert.equal(s.finishedElapsedMs,15504);assert.equal(s.b1Matched,false);assert.equal(s.actualOutdoorCompleted,false);assert.equal(h.moves.length,16);
});
test('Task5 010 genuine Track-derived event full16, early success, reordered/duplicate signals and overlap',()=>{
 const h=harness(false,{},taimushan);h.session.start();for(let n=0;n<16;n++){const old=h.moves.at(-1).options;finishEvent(h,n%2===0);assert.equal(h.session.getSnapshot().completedSegments,n+1);old.success();old.complete();send(h,old.path.at(-1),'complete');}
 const s=h.session.getSnapshot();assert.equal(s.status,'finished');assert.equal(s.progressRatio,1);assert.equal(s.lastConfirmedSegment,15);assert.equal(s.completionEvidence,'NATIVE_TERMINAL_WITH_ORDERED_TRAVEL');assert.equal(h.moves.length,16);
});
test('Task5 010 first-only early success waits terminal; boundary pause/resume; old terminal cannot advance',()=>{
 const h=harness(false,{firstSegmentOnly:true},taimushan);h.session.start();finishEvent(h);assert.equal(h.session.getSnapshot().status,'paused');assert.equal(h.moves.length,1);assert.equal(h.session.getSnapshot().completedSegments,1);
 const before=h.session.getSnapshot();h.advance(5000);assert.equal(h.session.getSnapshot().activeElapsedMs,before.activeElapsedMs);h.session.resume();h.flush();assert.equal(h.moves.length,2);
 const old=h.moves[0].options;send(h,old.path.at(-1),'complete');send(h,h.moves[1].options.path.at(-1),'complete');assert.equal(h.session.getSnapshot().currentWitnessCount,0);assert.equal(h.session.getSnapshot().completedSegments,1);h.session.dispose();old.success();old.complete();assert.equal(h.timers.size,0);
});
test('Task5 010 illegal marker/coordinates and previous008 event cannot establish progress',()=>{
 const h=harness(false,{firstSegmentOnly:true},taimushan);h.session.start();const o=h.moves[0].options;
 send(h,o.path[0],'interpolating',0);send(h,{latitude:NaN,longitude:0});send(h,route.track[0]);send(h,route.track.at(-1),'complete');o.success();o.complete();assert.equal(h.session.getSnapshot().completedSegments,0);assert.equal(h.session.getSnapshot().routeId,taimushan._id);
 travelEvents(h);send(h,route.track.at(-1),'complete');assert.equal(h.session.getSnapshot().completedSegments,0);send(h,o.path.at(-1),'complete');assert.equal(h.session.getSnapshot().completedSegments,1);assert.equal(h.moves.length,1);
});
test('Approved migration differences isolated; original geometry/filter/pause/dispose core preserved',()=>{let source=fs.readFileSync(path.join(__dirname,'../miniprogram/utils/native-route-overview.js'),'utf8');for(const [before,after] of [["clickedAt,firstSegmentOnly,onState:","clickedAt,firstSegmentOnly,strictEndpointFallback:route._id==='fj-route-010',onState:"],["if(d.animationStatus==='complete'){stats.terminalCount++","if(d.animationStatus==='interpolating'&&c.strictFallback)consider(c);\n  if(d.animationStatus==='complete'){stats.terminalCount++"],["if(q&&q.meters>=c.progress){c.progress=q.meters;const thresholds=[0,0.1,0.5,0.9];if(c.stage<4&&c.progress/c.length>=thresholds[c.stage])c.stage++;}","if(q&&q.meters>=c.progress){c.progress=q.meters;const thresholds=[0,0.1,0.5,0.9];if(c.stage<4&&c.progress/c.length>=thresholds[c.stage])c.stage++;\n     if(c.strictFallback&&c.stage===4){const endMeters=distance(p,c.end),remainingMeters=c.length-c.progress;\n      if(endMeters<=c.nearLimit&&remainingMeters<=c.nearLimit&&q.d<=c.nearLimit)c.nearWitness=Object.freeze({token:c.token,segmentZeroBased:part,eventAfterSubmitMs:now()-c.at,eventNumber:c.validEvents,limitMeters:c.nearLimit,endpointDistanceMeters:endMeters,remainingOrderedMeters:remainingMeters,pathProjectionDistanceMeters:q.d,orderedProgressRatio:c.progress/c.length,orderedStage:c.stage});\n     }\n    }"],["stats.events++;const p=point(d);","stats.events++;if(c.strictFallback)c.validEvents++;const p=point(d);"],["const d=e&&e.detail||e;stats.incomingEvents++;","const d=e&&e.detail||e;if(c.strictFallback){c.nearWitness=null;if(d&&d.animationStatus==='complete')c.terminalCandidates++;}stats.incomingEvents++;"],["c.length=meters;c.progress=0;c.maxGap","c.length=meters;c.strictFallback=fallbackEnabled&&part===14;c.nearLimit=Math.min(1,c.length*0.0001);c.nearWitness=null;c.terminalCandidates=0;c.validEvents=0;c.progress=0;c.maxGap"],["if(eventCapability){if(c.terminal&&c.stage===4)confirm(c,'NATIVE_TERMINAL_WITH_ORDERED_TRAVEL');return;}","if(eventCapability){\n   if(c.terminal&&c.stage===4){confirm(c,'NATIVE_TERMINAL_WITH_ORDERED_TRAVEL');return;}\n   // Only010 segment15: ordered native endpoint observations plus both API signals.\n   if(c.strictFallback&&c.apiComplete&&c.stage===4&&c.nearWitness&&c.nearWitness.token===c.token&&c.terminalCandidates===0){\n    stats.fallbackConfirmations++;stats.lastFallbackSegment=part;stats.lastFallbackWitness=c.nearWitness;\n    confirm(c,'NATIVE_NEAR_ENDPOINT_WITNESS_WITH_API_COMPLETE');\n   }return;\n  }"],["c.confirmed=true;stats.completionEvidence","c.confirmed=true;stats.lastConfirmedState=safeState(c);stats.completionEvidence"],["function error(code){if(disposed||state==='error')return;token++;","function error(code){if(disposed||state==='error')return;stats.lastFailureState=current?safeState(current):null;token++;"],["function clear(){","function safeState(c){return Object.freeze({routeId:meta.routeId,segmentZeroBased:part,segmentHuman:part+1,apiAccepted:c.accepted,apiComplete:c.apiComplete,orderedStage:c.stage,orderedProgressRatio:c.progress/c.length,terminalCandidates:c.terminalCandidates,terminalAccepted:c.terminal,confirmed:c.confirmed,strictFallbackEligible:c.strictFallback,strictFallbackLimitMeters:c.strictFallback?c.nearLimit:null,strictFallbackWitness:c.nearWitness});}\n function clear(){"],["actualOutdoorCompleted:false});","actualOutdoorCompleted:false,strictEndpointFallbackEnabled:fallbackEnabled,currentSegmentState:current?safeState(current):null});"],["const stats={moveCalls:","const stats={fallbackConfirmations:0,lastFallbackSegment:null,lastFallbackWitness:null,lastFailureState:null,lastConfirmedState:null,moveCalls:"],["const meta={routeId:route._id,","const fallbackEnabled=options.strictEndpointFallback===true&&route._id==='fj-route-010'&&!options.raw;\n const meta={routeId:route._id,"]]){assert(source.includes(after));source=source.replace(after,before);}source=source.slice(source.indexOf('function eventProgress'),source.indexOf('function enabledRoute')).replace('const meta={routeId:route._id,','const meta={').replace('routeId:meta.routeId,','routeId:OVERVIEW_ROUTE,');assert.equal(require('node:crypto').createHash('sha256').update(source).digest('hex'),'fdc5af6a18b3b8ba8d6f33432f5c91917e766e3008c434b964174f0974068e6c');});

// Targeted tests always replay the real first13 segments; no diagnostic window in product.
function scoped14(extra={}){const raw=harness(false,extra,taimushan);raw.session.start();for(let n=0;n<13;n++)finishEvent(raw);const real=raw.session;return {...raw,get now(){return raw.now;},get moves(){return raw.moves.slice(13);},session:{...real,getSnapshot(){const s=real.getSnapshot();return {...s,completedSegments:s.completedSegments-13,terminalCount:s.terminalCount-13};}}};}
test('Task5B segment15 missing terminal keeps safe failure state and no16, cleanup and replay isolated',()=>{
 const h=scoped14();finishEvent(h);const o=h.moves.at(-1).options;travelEvents(h);h.advance(900);o.success();assert.equal(h.session.getSnapshot().completedSegments,1);o.complete();assert.equal(h.session.getSnapshot().completedSegments,1);h.timeout();const d=h.session.getSnapshot().lastFailureState;assert.equal(d.segmentHuman,15);assert.equal(d.orderedStage,4);assert.equal(d.apiAccepted,true);assert.equal(d.apiComplete,true);assert.equal(d.terminalCandidates,0);assert.equal(d.confirmed,false);assert(Object.isFrozen(d));assert.equal(h.moves.length,2);assert.equal(h.removed.length,1);assert.equal(h.timers.size,0);o.success();send(h,o.path.at(-1),'complete');assert.strictEqual(h.session.getSnapshot().lastFailureState,d);const fresh=harness(false,{},taimushan);fresh.session.start();assert.equal(fresh.session.getSnapshot().lastFailureState,null);fresh.session.dispose();
});
test('Task5B14->15 real prefix replay keeps exact geometry and boundary pause only after valid terminal',()=>{
 const h=scoped14(),p=api.prepare(taimushan);assert.deepEqual(h.moves[0].options.path,p.pieces[13].path);finishEvent(h);const next=h.moves.at(-1).options;assert.deepEqual(next.path,p.pieces[14].path);send(h,h.moves[0].options.path.at(-1),'complete');send(h,next.path.at(-1),'complete');next.success();next.complete();assert.equal(h.session.getSnapshot().completedSegments,1);assert.equal(h.session.getSnapshot().currentWitnessCount,0);h.session.pause();travelEvents(h);send(h,next.path.at(-1),'complete');assert.equal(h.session.getSnapshot().status,'paused');assert.equal(h.session.getSnapshot().completedSegments,2);assert.equal(h.moves.length,2);assert.equal(h.timers.size,0);h.session.dispose();
});
test('Task5B invalid event filtering preserved, safe summary has no raw coordinates or private window',()=>{
 const h=scoped14();finishEvent(h);const o=h.moves.at(-1).options;send(h,o.path.at(-1),'complete',0);send(h,{latitude:NaN,longitude:0},'complete');send(h,o.path[0],'OTHER');send(h,o.path.at(-1),'complete');assert.equal(h.session.getSnapshot().currentWitnessCount,0);assert(h.session.getSnapshot().rejectedTerminal>0);h.timeout();assert.equal(h.session.getSnapshot().lastFailureState.confirmed,false);
 const forbidden=x=>{if(x&&typeof x==='object'){for(const k of Object.keys(x))assert(!['latitude','longitude','path','track','appId','envId','diagnosticWindow'].includes(k));Object.values(x).forEach(forbidden);}};forbidden(h.session.getSnapshot());const source=fs.readFileSync(path.join(__dirname,'../miniprogram/utils/native-route-overview.js'),'utf8');assert(!source.includes('diagnosticWindow'));assert(!source.includes('PRIVATE_TASK'));
});
test('Task5B production Page adapter activates010 native mode and unload cancels session',()=>{
 const moves=[],removed=[],wx={createMapContext(){return {addMarkers(o){o.success();},moveAlong(o){moves.push(o);},removeMarkers(o){removed.push(o);o.success();}};}};const def={loadRoute:async function(){},onSimulationStartTap(){throw Error('no B1');},onSimulationPauseTap(){},onSimulationResumeTap(){},onSimulationRestartTap(){},onHide(){},onUnload(){this._unloaded=true;},onBackTap(){},onMapError(){}};api.install(def,wx,'ROUTE_OVERVIEW');const page={...def,data:{route:taimushan,status:'success'},setData(p){Object.assign(this.data,p);}};page.onSimulationStartTap();assert.equal(page.getPlanBSummary().routeId,'fj-route-010');assert.equal(page.getPlanBSummary().strictEndpointFallbackEnabled,true);assert.equal(moves.length,1);page.onUnload();assert.equal(page._nativeOverview,null);assert.equal(removed.length,1);
});
// Task5C injected native observations use the official010 Track, not device proof.
function at15(extra={}){const h=scoped14({strictEndpointFallback:true,...extra});finishEvent(h);assert.equal(h.session.getSnapshot().currentSegment,14);h.session.pause();return h;}
function near15(h,remaining=.04){const p=api.prepare(taimushan),piece=p.pieces[14],o=h.moves.at(-1).options;let traversed=0;const length=o.path.slice(1).reduce((n,v,i)=>n+core.distance(o.path[i],v),0);for(let i=0;i<o.path.length;i++){if(i)traversed+=core.distance(o.path[i-1],o.path[i]);if(traversed>length-remaining)break;send(h,o.path[i]);}send(h,api.position(p.index,piece.to-remaining));}
function accepted(h){const o=h.moves.at(-1).options;o.success();o.complete();return o;}
function still15(h){assert.equal(h.session.getSnapshot().completedSegments,1);assert.equal(h.moves.length,2);}
test('Task5C strict actual sample scalar bounds and missing-terminal endpoint before API confirms once',()=>{
 const h=at15();near15(h);still15(h);const o=h.moves.at(-1).options;o.complete();still15(h);o.success();const s=h.session.getSnapshot();assert.equal(s.status,'paused');assert.equal(s.completedSegments,2);assert.equal(s.lastConfirmedSegment,14);assert.equal(s.fallbackConfirmations,1);assert.equal(s.completionEvidence,'NATIVE_NEAR_ENDPOINT_WITNESS_WITH_API_COMPLETE');assert.equal(s.terminalCount,1);assert.equal(s.lastConfirmedState.terminalCandidates,0);assert.equal(s.lastConfirmedState.terminalAccepted,false);assert.equal(h.removed.length,0);
 const d=s.lastConfirmedState;assert(d.strictFallbackLimitMeters<.106&&d.strictFallbackLimitMeters>.105);assert(.0361376123<d.strictFallbackLimitMeters);assert((1-.9999662983)*(api.prepare(taimushan).total/16)<d.strictFallbackLimitMeters);assert(d.strictFallbackWitness.remainingOrderedMeters<d.strictFallbackLimitMeters);
 o.success();o.complete();send(h,o.path.at(-1),'complete');assert.equal(h.session.getSnapshot().completedSegments,2);assert.equal(h.moves.length,2);h.session.resume();h.flush();assert.equal(h.moves.length,3,'production resumes to actual16; no private window');h.session.dispose();
});
test('Task5C API first, near position later; normal terminal before callbacks stays preferred',()=>{
 const h=at15();accepted(h);still15(h);near15(h);assert.equal(h.session.getSnapshot().fallbackConfirmations,1);
 const normal=at15();travelEvents(normal);send(normal,normal.moves.at(-1).options.path.at(-1),'complete');accepted(normal);assert.equal(normal.session.getSnapshot().completionEvidence,'NATIVE_TERMINAL_WITH_ORDERED_TRAVEL');assert.equal(normal.session.getSnapshot().fallbackConfirmations,0);
});
test('Task5C API-only, endpoint-only, stage insufficient cannot replace full ordered travel',()=>{
 for(const signal of ['success','complete','both']){const h=at15();const o=h.moves.at(-1).options;if(signal!=='complete')o.success();if(signal!=='success')o.complete();still15(h);send(h,o.path.at(-1));still15(h);h.timeout();assert.equal(h.session.getSnapshot().status,'error');}
 const h=at15();accepted(h);send(h,h.moves.at(-1).options.path[0]);send(h,h.moves.at(-1).options.path.at(-1));still15(h);assert(h.session.getSnapshot().currentWitnessCount<4);h.session.dispose();
 const pre=harness(false,{strictEndpointFallback:true},taimushan);send(pre,taimushan.track.at(-1));assert.equal(pre.moves.length,0);pre.session.dispose();
});
test('Task5C strict geometry rejects unfinished ordered mile, off-track and old shared endpoints',()=>{
 for(const remaining of [.2,1,10,50]){const h=at15();accepted(h);near15(h,remaining);still15(h);h.session.dispose();}
 const h=at15();near15(h,1);const o=h.moves.at(-1).options;send(h,{latitude:o.path.at(-1).latitude+.001,longitude:o.path.at(-1).longitude});accepted(h);still15(h);assert.equal(h.session.getSnapshot().currentSegmentState.strictFallbackWitness,null);h.session.dispose();
 const shared=at15();accepted(shared);const old=shared.moves[0].options;send(shared,old.path.at(-1));send(shared,old.path.at(-1),'complete');still15(shared);assert(shared.session.getSnapshot().currentWitnessCount<4);shared.session.dispose();
 // A near endpoint coordinate at the start of a loop cannot bypass ordered path.
 const loop=at15();accepted(loop);send(loop,loop.moves.at(-1).options.path.at(-1));still15(loop);loop.session.dispose();
});
test('Task5C a later invalid event or backward point invalidates pending endpoint witness',()=>{
 const h=at15();near15(h);send(h,{latitude:NaN,longitude:0});accepted(h);still15(h);assert.equal(h.session.getSnapshot().currentSegmentState.strictFallbackWitness,null);h.session.dispose();
 const back=at15();near15(back);send(back,back.moves.at(-1).options.path[0]);accepted(back);still15(back);back.session.dispose();
});
test('Task5C boundary pause before fallback, disposed/timeout sessions and replay callbacks cannot advance',()=>{
 const h=at15();h.session.pause();accepted(h);near15(h);assert.equal(h.session.getSnapshot().status,'paused');assert.equal(h.moves.length,2);assert.equal(h.timers.size,0);
 const disposed=at15(),o=disposed.moves.at(-1).options;near15(disposed);disposed.session.dispose();o.success();o.complete();send(disposed,o.path.at(-1));assert.equal(disposed.session.getSnapshot().completedSegments,1);
 const old=at15(),stale=old.moves.at(-1).options;old.timeout();near15(old);stale.success();stale.complete();assert.equal(old.session.getSnapshot().status,'error');assert.equal(old.session.getSnapshot().fallbackConfirmations,0);
 const fresh=at15();old.session.event({detail:{...stale.path.at(-1),markerId:-2,animationStatus:'interpolating'}});stale.success();stale.complete();send(fresh,stale.path.at(-1));accepted(fresh);still15(fresh);fresh.session.dispose();
});
test('Task5C only010 segment15: full16 cannot finish16 from previous evidence;008 ignores opt-in',()=>{
 const h=harness(false,{strictEndpointFallback:true},taimushan);h.session.start();for(let i=0;i<14;i++)finishEvent(h);accepted(h);near15(h);assert.equal(h.session.getSnapshot().completedSegments,15);assert.equal(h.moves.length,15);h.flush();assert.equal(h.moves.length,16);const last=h.moves.at(-1).options;send(h,h.moves[14].options.path.at(-1),'complete');last.success();last.complete();assert.equal(h.session.getSnapshot().status,'playing');assert.equal(h.session.getSnapshot().completedSegments,15);travelEvents(h);send(h,last.path.at(-1),'complete');assert.equal(h.session.getSnapshot().status,'finished');assert.equal(h.session.getSnapshot().completedSegments,16);assert.equal(h.session.getSnapshot().fallbackConfirmations,1);assert.equal(h.session.getSnapshot().lastFallbackSegment,14);
 const y=harness(false,{strictEndpointFallback:true},route);y.session.start();for(let i=0;i<14;i++)finishEvent(y);accepted(y);travelEvents(y);assert.equal(y.session.getSnapshot().completedSegments,14);assert.equal(y.session.getSnapshot().fallbackConfirmations,0);y.timeout();assert.equal(y.session.getSnapshot().lastError,'NATIVE_REPLAY_TIMEOUT');
});

test('Task5C full near-end movement still needs BOTH accepted and complete; minimum distance strict',()=>{
 for(const signal of ['success','complete']){const h=at15();near15(h);const o=h.moves.at(-1).options;o[signal]();still15(h);h.timeout();assert.equal(h.session.getSnapshot().fallbackConfirmations,0);}
 const h=at15();near15(h,.11);accepted(h);still15(h);h.session.dispose();
 // Official earlier-route overlap near the endpoint does not establish submitted15 travel.
 const loop=at15(),p=api.prepare(taimushan),end=p.pieces[14].path.at(-1);accepted(loop);const prior=taimushan.track.slice(0,4000).reduce((best,v)=>!best||core.distance(v,end)<core.distance(best,end)?v:best,null);send(loop,prior);send(loop,end);still15(loop);assert(loop.session.getSnapshot().currentWitnessCount<4);loop.session.dispose();
});
test('Task5C production Page activation isolated010 and adapter hide cancels candidate before confirmation',()=>{
 for(const r of [taimushan,route]){const moves=[],removed=[];const wx={createMapContext(){return {addMarkers(o){o.success();},moveAlong(o){moves.push(o);},removeMarkers(o){removed.push(o);o.success();}};}};
 const def={loadRoute:async function(){},onSimulationStartTap(){},onSimulationPauseTap(){},onSimulationResumeTap(){},onSimulationRestartTap(){},onHide(){this._hidden=true;},onUnload(){this._unloaded=true;},onBackTap(){},onMapError(){}};api.install(def,wx,'TEST_NEGATIVE_CONTROL');const page={...def,data:{route:r,status:'success'},setData(p){Object.assign(this.data,p);}};
 page.onSimulationStartTap({currentTarget:{dataset:{}}});if(r===taimushan)assert.equal(page.getPlanBSummary().strictEndpointFallbackEnabled,true);else assert.equal(page.getPlanBSummary().strictEndpointFallbackEnabled,false);const old=moves.at(-1);page.onHide();old.success();old.complete();page.onNativeOverviewPoint({detail:{...old.path.at(-1),markerId:-2,animationStatus:'interpolating'}});assert.equal(page.getPlanBSummary().completedSegments,0);assert.equal(removed.length,1);page.onUnload();}
});
console.log(JSON.stringify({result:'LOCAL_NATIVE_CALLBACK_LOGIC_PASS',cases,sourcePoints:route.track.length,segments:16,nodeControlledMs:15504,maxBoundaryErrorMeters:maxBoundaryError,devtools:'PENDING',boundaryPause:'USER_ACCEPTED_RETEST_PENDING'},null,2));
