// D2I: 正式track派生的受控GPS替身；不访问wx/云，不修改路线，不代表真机。
const assert = require('node:assert/strict');
const core = require('../miniprogram/utils/trail-progress');
const { fixture, routeById, gpsOffset } = require('./formal-route-fixtures.cjs');
const passed = [];
const test = (name, fn) => { fn(); passed.push(name); };
for (const id of ['005', '008', '010']) {
  const setup = () => { const f = fixture(routeById('fj-route-' + id)); f.start(); f.walk(150); return f; };
  test(id + ': single departure, interrupted evidence, continuous departure and return', () => {
    const f = setup(), cursor = f.state.cursorMeters, max = f.state.maxConfirmedMeters;
    let offset = 0;
    for (let d = 10; d <= 150; d += 10) {
      f.fix(gpsOffset(f.at(cursor), d));
      if (f.state.offEvidence) { offset = d; break; }
    }
    assert(offset); assert.equal(f.state.offEvidence.count, 1);
    assert.notEqual(f.state.offRouteStatus, 'suspected');
    f.fix(gpsOffset(f.at(cursor), offset), 5);
    assert.equal(f.state.offEvidence.count, 2);
    f.fix(gpsOffset(f.at(cursor), offset), 2, 60);
    assert.equal(f.state.offEvidence, null); assert.equal(f.state.reason, 'LOW_ACCURACY');
    f.fix(gpsOffset(f.at(cursor), offset), 5);
    assert.equal(f.state.offEvidence.count, 1); assert.notEqual(f.state.offRouteStatus, 'suspected');
    f.fix(gpsOffset(f.at(cursor), offset), 4); f.fix(gpsOffset(f.at(cursor), offset), 4);
    assert.equal(f.state.offRouteStatus, 'suspected');
    assert.equal(f.state.cursorMeters, cursor); assert.equal(f.state.maxConfirmedMeters, max);
    // 不够接近路线的可靠位置不能确认回归；精度差也不能清除已确认偏航。
    f.fix(gpsOffset(f.at(cursor), offset), 3); assert.equal(f.state.returnEvidence, null);
    f.fix(gpsOffset(f.at(cursor), offset), 2, 60); assert.equal(f.state.offRouteStatus, 'suspected');
    let firstReturn = false;
    for (let d = offset - 10; d >= 0; d -= 10) {
      f.fix(gpsOffset(f.at(cursor), d));
      if (!firstReturn && f.state.returnEvidence) {
        firstReturn = true;
        assert.equal(f.state.returnEvidence.count, 1);
        assert.equal(f.state.offRouteStatus, 'suspected'); assert.equal(f.state.reason, 'RETURN_PENDING');
      }
    }
    assert(firstReturn);
    for (let i = 0; i < 10; i++) f.fix(f.at(cursor), 2);
    assert.equal(f.state.offRouteStatus, 'near'); assert.equal(f.state.phase, 'following');
    assert.equal(f.state.continuityBroken, false); assert(Math.abs(f.state.cursorMeters - cursor) < 0.001);
    assert(Math.abs(f.state.maxConfirmedMeters - max) < 0.001);
    f.walk(cursor + 60, cursor + 10); for (let i = 0; i < 5; i++) f.fix(f.at(cursor + 60), 2);
    assert(f.state.maxConfirmedMeters > max); assert.equal(f.state.canConfirmCompletion, false);
  });
  test(id + ': pause while off-route keeps confirmed progress, rejects far resume, rechecks near resume', () => {
    const f = setup(), cursor = f.state.cursorMeters;
    for (let d = 10; d <= 150; d += 10) f.fix(gpsOffset(f.at(cursor), d));
    assert.equal(f.state.offRouteStatus, 'suspected');
    const paused = core.pauseProgressState(f.index, f.state), before = JSON.stringify(paused);
    assert.equal(paused.offRouteStatus, 'suspected'); assert.equal(paused.offEvidence, null);
    assert.equal(paused.lastReliablePosition, null); assert.equal(paused.anchor, null);
    const resumed = core.resumeProgressState(f.index, paused), now = f.now + 60000;
    const far = core.updateTrailProgress(f.index, resumed, { ...gpsOffset(f.at(cursor), 150), accuracy: 5, updatedAt: now }, now);
    assert.equal(far.reason, 'RESUME_TOO_FAR'); assert.equal(far.state.cursorMeters, cursor);
    let state = resumed;
    for (let i = 0; i < 10; i++) {
      const time = now + i * 2000;
      state = core.updateTrailProgress(f.index, state, { ...f.at(cursor), accuracy: 5, updatedAt: time }, time).state;
      if (i === 0) { assert.equal(state.activeReliableSeconds, paused.activeReliableSeconds); assert.equal(state.reason, 'RETURN_PENDING'); assert.equal(state.offRouteStatus, 'suspected'); }
    }
    assert.equal(state.phase, 'following'); assert.equal(state.offRouteStatus, 'near');
    assert.equal(state.continuityBroken, false); assert(Math.abs(state.cursorMeters - cursor) < 0.001);
    assert(state.activeReliableSeconds - paused.activeReliableSeconds <= 18);
    assert.equal(JSON.stringify(paused), before); assert.equal(state.canConfirmCompletion, false);
  });
}
console.log(JSON.stringify({ result: 'PASS', evidence: 'SIMULATED_NOT_ANDROID', groups: passed }, null, 2));
