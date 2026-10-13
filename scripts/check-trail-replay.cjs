// 六正式轨迹派生GPS回放；无人工路线，不调用wx/云，不代表实地验收。
const assert = require('node:assert/strict');
const core = require('../miniprogram/utils/trail-progress');
const { loadFormalRoutes, routeById, fixture, gpsOffset } = require('./formal-route-fixtures.cjs');
function replay(r, step = 20, interval = 10, api = core) {
  const f = fixture(r, api); f.start(); const L = f.index.totalTrackMeters;
  let backwards = false, early = false, worstLag = 0, previous = f.state.cursorMeters, ambiguityFrames = 0;
  const advance = s => {
    f.fix(f.at(s), interval);
    if (f.state.locationQuality === 'ambiguous') ambiguityFrames++;
    if (f.state.cursorMeters < previous - 5) backwards = true;
    previous = f.state.cursorMeters; worstLag = Math.max(worstLag, s - previous);
    if (api.canConfirmCompletion(f.index, f.state, f.now) && s < L - Math.min(100, L * 0.01)) early = true;
  };
  const startMeters = f.state.startCursorMeters;
  for (let s = startMeters + step; s < L; s += step) advance(s);
  advance(L); for (let i = 0; i < 10; i++) f.fix(f.index.finishPoint, 2);
  const complete = api.canConfirmCompletion(f.index, f.state, f.now);
  return { routeId: r._id, name: r.name, routeType: r.routeType, trackPoints: r.track.length,
    stepMeters: step, intervalSeconds: interval, startMeters, geometryMeters: L, progressMeters: f.state.cursorMeters,
    progressPercent: f.state.cursorMeters / L * 100, expectedEnd: 'following + canConfirmCompletion（不自动completed）',
    canConfirmCompletion: complete, ambiguityFrames, abnormalRollback: backwards,
    permanentMismatch: !complete && L - f.state.cursorMeters > Math.min(100, L * 0.01), prematureCompletion: early,
    maximumLagMeters: worstLag, result: complete && !backwards && !early && worstLag <= api.POLICY.maxForward ? 'PASS' : 'FAIL' };
}
function started(id = 'fj-route-006') { const f = fixture(routeById(id)); f.start(); return f; }
function main(mode) {
  assert(!mode || ['--unit','--formal','--dense','--matrix'].includes(mode));
  const cases = []; const test = (name, fn) => { fn(); cases.push(name); };
  if (!mode || mode === '--unit') {
    test('B1正式大姆山歧义后原序全程恢复', () => {
      const r = replay(routeById('fj-route-006')); assert.equal(r.result, 'PASS', JSON.stringify(r)); assert(r.ambiguityFrames > 0);
    });
    test('正式轨迹上的真实连续20米反走可确认', () => {
      const f = started(); f.walk(300); const cursor = f.state.cursorMeters;
      for (const offset of [20,40,60,80]) f.fix(f.at(cursor - offset), 10);
      assert(f.state.cursorMeters < cursor - 40); assert.equal(f.state.canConfirmCompletion, false);
    });
    test('太姥山实际前缀起点向前，返回原前缀可真实回退', () => {
      const f = started('fj-route-010'), start = f.state.cursorMeters; assert(start > 10 && start < 20);
      for (const s of [2,4,6]) f.fix(f.at(s), 2);
      assert(f.state.cursorMeters < start - 5); assert.equal(f.state.canConfirmCompletion, false);
    });
  }
  if (!mode || mode === '--formal' || mode === '--dense') {
    const reports = loadFormalRoutes().map(r => replay(r, mode === '--dense' ? 2 : 20, mode === '--dense' ? 2 : 10));
    console.log(JSON.stringify({ evidence:'LOCAL_FORMAL_TRACK_GPS_REPLAY_ONLY', reports }, null, 2));
    assert(reports.every(r=>r.result==='PASS'), '六路线任何FAIL不能报告整体PASS');
  }
  if (!mode || mode === '--matrix') {
    test('六正式路线实际近邻/交叉歧义后全程恢复，不误退', () => {
      for (const route of loadFormalRoutes()) { const r = replay(route); assert(r.ambiguityFrames > 0); assert.equal(r.result,'PASS'); }
    });
    test('非闭合黄连盂按实际末点取得资格，不补闭环', () => {
      const r = routeById('fj-route-009'); assert(core.distance(r.track[0],r.track.at(-1)) > 100); assert.equal(replay(r).result,'PASS');
    });
    test('正式大姆山未走全程返回起点，不能伪造完成', () => {
      const f = started(); f.walk(300); const cursor = f.state.cursorMeters;
      for (let s = cursor - 10; s >= 0; s -= 10) f.fix(f.at(s));
      for (let i = 0; i < 8; i++) f.fix(f.index.startPoint, 2);
      assert(f.state.cursorMeters < 30); assert.equal(core.canConfirmCompletion(f.index,f.state,f.now),false);
    });
    test('正式嵛山岛多处歧义后密采样恢复', () => { const r = replay(routeById('fj-route-008'),2,2); assert(r.ambiguityFrames>0); assert.equal(r.result,'PASS'); });
    test('正式大姆山短暂失配不补预算，连续返回可信路段恢复', () => {
      const f = started(); f.walk(150); const cursor = f.state.cursorMeters, budget=f.state.activeReliableSeconds;
      // 使用原轨迹GPS点的横向漂移，找到受控NO_LOCAL_MATCH，不创建路线。
      let drift;
      for (const [north,east] of [[30,0],[-30,0],[0,30],[0,-30]]) {
        const p = gpsOffset(f.at(cursor+10),north,east);
        const probe = core.updateTrailProgress(f.index,f.state,{...p,accuracy:5,updatedAt:f.now+5000},f.now+5000);
        if(probe.reason==='NO_LOCAL_MATCH'){drift=p;break;}
      }
      assert(drift,'该正式路段必须触发短暂失配负例'); f.fix(drift);
      assert.equal(f.state.cursorMeters,cursor); assert.equal(f.state.activeReliableSeconds,budget); assert.equal(f.state.reason,'NO_LOCAL_MATCH');
      for(let s=cursor+20;s<=cursor+100;s+=10)f.fix(f.at(s));
      assert(f.state.cursorMeters>cursor+60); assert.equal(f.state.canConfirmCompletion,false);
    });
    test('正式轨迹低精度/异常远点不认领进度，回锚后恢复', () => {
      const f = started(); f.walk(150); const cursor=f.state.cursorMeters;
      for(const a of [35,80,100,null]){f.fix(f.at(800),5,a);assert.equal(f.state.cursorMeters,cursor);}
      for(let i=0;i<5;i++)f.fix(f.at(cursor),2);assert.equal(f.state.continuityBroken,false);
      assert.equal(f.fix(f.at(900),1).locationQuality,'jump');assert.equal(f.state.cursorMeters,cursor);
      for(let i=0;i<5;i++)f.fix(f.at(cursor),2);
      for(let s=cursor+10;s<=cursor+100;s+=10)f.fix(f.at(s));assert(f.state.cursorMeters>cursor+60);
    });
  }
  console.log(JSON.stringify({result:'PASS',mode:mode||'all',cases},null,2));
}
if(require.main===module)main(process.argv[2]);
module.exports={replay,fixture,started};
