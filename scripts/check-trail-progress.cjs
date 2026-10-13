// 六正式轨迹派生GPS和字段负例；无人工合成路线，不访问wx/云。
const assert=require('node:assert/strict');
const core=require('../miniprogram/utils/trail-progress');
const {loadFormalRoutes,routeById,fixture,gpsOffset,clone}=require('./formal-route-fixtures.cjs');
const passed=[];const test=(name,fn)=>{fn();passed.push(name);};
const start=(id='fj-route-006')=>{const f=fixture(routeById(id));f.start();return f;};
const finish=f=>{f.walk(f.index.totalTrackMeters,f.state.cursorMeters+20,20,10);f.fix(f.index.finishPoint,10);for(let i=0;i<10;i++)f.fix(f.index.finishPoint,2);};
test('真实有序轨迹/几何进度/反走/输入不变',()=>{
  const r=routeById('fj-route-006'),before=JSON.stringify(r),f=fixture(r);f.start();f.walk(500);
  assert(f.state.cursorMeters>450&&f.state.cursorMeters<=500);
  const max=f.state.maxConfirmedMeters,cursor=f.state.cursorMeters;
  for(const s of [cursor-10,cursor-20,cursor-25])f.fix(f.at(s));
  assert(f.state.cursorMeters<cursor);assert.equal(f.state.maxConfirmedMeters,max);assert.equal(JSON.stringify(r),before);
});
test('真实环线起点停留拒绝完成，全程末段资格及过时复核',()=>{
  const f=start();for(let i=0;i<60;i++)f.fix(f.index.startPoint,2);
  assert.equal(f.state.hasDeparted,false);assert.equal(core.canConfirmCompletion(f.index,f.state,f.now),false);
  finish(f);assert(f.state.hasDeparted);assert(core.canConfirmCompletion(f.index,f.state,f.now));assert.equal(f.state.phase,'following');
  assert.equal(core.canConfirmCompletion(f.index,f.state,f.now+16000),false);
});
test('进度不足/跳到远段或末点不能直接完成',()=>{
  const f=start();f.walk(150);const cursor=f.state.cursorMeters;
  assert.equal(f.fix(f.at(1500),1).locationQuality,'jump');assert.equal(f.state.cursorMeters,cursor);
  f.fix(f.index.finishPoint,40);assert.equal(f.state.cursorMeters,cursor);assert.equal(f.state.canConfirmCompletion,false);
});
test('GPS微抖/低精度/未知/过时/非正时间冻结',()=>{
  const f=start();f.walk(100);const cursor=f.state.cursorMeters;
  for(let i=0;i<12;i++)f.fix(f.at(cursor+(i%2?2:-2)),2);assert.equal(f.state.cursorMeters,cursor);
  assert.equal(f.fix(f.at(500),5,50).locationQuality,'degraded');assert.equal(f.state.cursorMeters,cursor);
  assert.equal(f.fix(f.at(500),5,null).locationQuality,'unavailable');
  const p={...f.at(cursor),accuracy:5,updatedAt:f.now+1000};
  assert.equal(core.updateTrailProgress(f.index,f.state,p,f.now+20000).locationQuality,'stale');
  assert.equal(core.updateTrailProgress(f.index,f.state,{...p,updatedAt:f.now},f.now).reason,'INVALID_TIME');
});
test('正式轨迹GPS偏离迟滞与可信锚恢复',()=>{
  const f=start();f.walk(150);const cursor=f.state.cursorMeters;
  for(let y=10;y<=150;y+=10)f.fix(gpsOffset(f.at(cursor),y),5);
  for(let i=0;i<4;i++)f.fix(gpsOffset(f.at(cursor),150),3);
  assert.equal(f.state.offRouteStatus,'suspected');assert.equal(f.state.cursorMeters,cursor);
  f.fix(gpsOffset(f.at(cursor),150),2,60);assert.equal(f.state.offRouteStatus,'suspected');
  for(let y=140;y>=0;y-=10)f.fix(gpsOffset(f.at(cursor),y),5);
  for(let i=0;i<8;i++)f.fix(f.at(cursor),2);
  assert.equal(f.state.offRouteStatus,'near');assert.equal(f.state.continuityBroken,false);
});
test('实际远分支不能全局跳进度',()=>{
  const f=start('fj-route-008');f.walk(100);const cursor=f.state.cursorMeters;
  f.fix(f.at(5000),1);assert.equal(f.state.cursorMeters,cursor);assert.equal(f.state.canConfirmCompletion,false);
});
test('正式大姆山歧义时冻结，随后完整恢复',()=>{
  const f=start();let seen=false;
  for(let s=20;s<f.index.totalTrackMeters;s+=20){const cursor=f.state.cursorMeters;f.fix(f.at(s),10);
    if(f.state.locationQuality==='ambiguous'){seen=true;assert.equal(f.state.cursorMeters,cursor);assert.equal(f.state.canConfirmCompletion,false);}}
  assert(seen,'必须覆盖真实几何歧义');f.fix(f.index.finishPoint,10);for(let i=0;i<10;i++)f.fix(f.index.finishPoint,2);
  assert(core.canConfirmCompletion(f.index,f.state,f.now));
});
test('长断流不追补/历史max不能伪造完成资格',()=>{
  const f=start();f.walk(120);const active=f.state.activeReliableSeconds;
  f.fix(f.at(f.state.cursorMeters),120);assert.equal(f.state.activeReliableSeconds,active);
  assert.equal(core.canConfirmCompletion(f.index,{...f.state,hasDeparted:true,maxConfirmedMeters:f.index.totalTrackMeters,canConfirmCompletion:true},f.now),false);
  assert.equal(core.canConfirmCompletion(f.index,null,f.now),false);
});
test('真实点派生重复点负例/太姥山前缀/黄连盂非闭合末点',()=>{
  const r=routeById('fj-route-006'),patched=clone(r);patched.track.splice(1,0,{...patched.track[0]});
  const before=JSON.stringify(patched),index=core.buildTrailIndex(patched);assert.equal(index.cumulativeMeters.length,r.track.length+1);
  assert.equal(index.segments[0].segmentIndex,1);assert.equal(JSON.stringify(patched),before);
  const f=start('fj-route-010');assert(f.state.cursorMeters>10&&f.state.cursorMeters<20);
  const g=fixture(routeById('fj-route-009'));assert.equal(g.index.finishPoint.latitude,routeById('fj-route-009').track.at(-1).latitude);
  assert(core.distance(g.index.startPoint,g.index.finishPoint)>100);
});
test('正式数据派生坏字段/坐标/状态安全返回',()=>{
  const r=routeById('fj-route-006');
  for(const bad of [null,{}, {...r,track:[]},{...r,track:[r.track[0]]}, {...r,coordinateSystem:'wgs84'},
    {...r,track:[r.track[0],{...r.track[1],latitude:NaN}]}, {...r,track:[r.track[0],,r.track[2]]}])assert.equal(core.buildTrailIndex(bad).status,'unavailable');
  const f=fixture(r);for(const p of [null,{}, {...r.track[0],latitude:91},{...r.track[0],longitude:'118'},{latitude:0,longitude:0}]){
    const out=core.updateTrailProgress(f.index,f.state,p,f.now);assert.equal(out.progressMeters,null);assert.equal(out.canConfirmCompletion,false);}
  assert.equal(core.updateTrailProgress({status:'ready',segments:[null]},null,null,1).phase,'unavailable');
  assert.equal(core.updateTrailProgress(f.index,{...f.state,routeIdentity:'invalid'},null,1).reason,'INVALID_STATE');
});
test('暂停去坐标/公开轨迹锚恢复/不补计/远处拒绝',()=>{
  const f=start();f.walk(300);const paused=core.pauseProgressState(f.index,f.state),before=JSON.stringify(paused);
  assert.equal(paused.anchor,null);assert.equal(paused.lastReliablePosition,null);assert.equal(paused.lastObservedAt,null);assert.equal(paused.pending,null);
  let resumed=core.resumeProgressState(f.index,paused);assert.equal(JSON.stringify(paused),before);const later=f.now+3600000;
  const far=core.updateTrailProgress(f.index,resumed,{...f.at(1500),accuracy:5,updatedAt:later},later);
  assert.equal(far.reason,'RESUME_TOO_FAR');assert.equal(far.state.cursorMeters,paused.cursorMeters);
  for(let i=0;i<3;i++)resumed=core.updateTrailProgress(f.index,resumed,{...f.at(paused.cursorMeters),accuracy:5,updatedAt:later+i*2000},later+i*2000).state;
  assert.equal(resumed.phase,'following');assert.equal(resumed.activeReliableSeconds,paused.activeReliableSeconds);assert(Math.abs(resumed.cursorMeters-paused.cursorMeters)<1e-6, "球面投影浮点误差<微米，不放宽进度门槛");assert.equal(resumed.canConfirmCompletion,false);
  assert.equal(core.resumeProgressState(null,null).phase,'unavailable');assert.equal(core.resumeProgressState({...f.index,segments:[]},paused).phase,'unavailable');
});
test('六正式Route原序准备/完整来源/输入不变',()=>{
  for(const r of loadFormalRoutes()){const before=JSON.stringify(r),index=core.buildTrailIndex(r);assert.equal(index.status,'ready');
    assert.equal(index.cumulativeMeters.length,r.track.length);assert.equal(JSON.stringify(r),before);assert.equal(index.calibration,'CALIBRATION_PENDING');}
});
console.log(JSON.stringify({result:'PASS',evidence:'FORMAL_TRACK_DERIVED_GPS_ONLY_NOT_PHONE',groups:passed},null,2));
