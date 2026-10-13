// 本地模拟云请求检查，不连接 CloudBase，不代替开发者工具或真机验收。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const seed = require("./formal-route-fixtures.cjs").routeById("fj-route-005");
const expectedEnv = require(path.join(root, "miniprogram/config/env.js")).cloudEnvId;

function harness() {
  let handler = async () => ({ data: [seed] });
  let requests = 0;
  let definition;
  let navigated;
  let fields;
  const logs = [];
  const wx = {
    cloud: {
      database(options) {
        assert.equal(options.env, expectedEnv);
        return {
          collection(name) {
            assert.equal(name, "routes");
            return {
              field(value) { fields = value; return this; },
              limit(value) { assert.equal(value, 20); return this; },
              get() { requests += 1; return handler(); }
            };
          }
        };
      }
    },
    navigateTo(options) { navigated = options.url; }
  };
  const output = {
    info(...args) { logs.push({ level: "info", args }); },
    error(...args) { logs.push({ level: "error", args }); }
  };
  const serviceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "miniprogram/services/route-service.js"), "utf8"), {
    module: serviceModule, wx,
    require() { return { cloudEnvId: expectedEnv }; }
  });
  vm.runInNewContext(fs.readFileSync(path.join(root, "miniprogram/pages/routes/index.js"), "utf8"), {
    Page(value) { definition = value; }, wx, console: output,
    require(name) {
      if (name === "../../services/route-service") return serviceModule.exports;
      if (name === "../../utils/format") return require(path.join(root, "miniprogram/utils/format.js"));
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    updates: 0,
    setData(update) { Object.assign(this.data, update); this.updates += 1; }
  });
  return {
    page, logs, wx,
    respond(next) { handler = next; },
    get requests() { return requests; },
    get navigated() { return navigated; },
    get fields() { return fields; }
  };
}

async function run() {
  const h = harness();
  let resolve;
  h.respond(() => new Promise(done => { resolve = done; }));
  const pending = h.page.onLoad();
  assert.equal(h.page.data.status, "loading");
  assert.equal(h.page.data.routes.length, 0);
  await h.page.onRetryTap();
  assert.equal(h.requests, 1, "加载中重复点击不得重复请求");
  resolve({ data: [seed] });
  await pending;
  assert.equal(h.page.data.status, "success");
  assert.equal(h.page.data.routeCount, "01");
  assert.equal(h.page.data.routes[0].name, seed.name);
  assert.equal(h.page.data.routes[0].displayDistance, require("../miniprogram/utils/format").formatDistance(seed.distanceMeters));
  assert.equal(h.page.data.routes[0].displayDuration, require("../miniprogram/utils/format").formatDuration(seed.estimatedDurationMinutes));
  assert.deepEqual(Object.keys(h.fields).sort(), [
    "_id", "name", "city", "district", "distanceMeters", "estimatedDurationMinutes", "difficulty", "routeType"
  ].sort());
  h.page.onRouteTap({ currentTarget: { dataset: { id: "cloud/id ?" } } });
  assert.equal(h.navigated, "/pages/route-detail/index?id=cloud%2Fid%20%3F");
  assert.equal(h.logs.filter(log => log.level === "error").length, 0);

  h.respond(async () => ({ data: [] }));
  await h.page.onRetryTap();
  assert.equal(h.page.data.status, "empty");
  assert.equal(h.page.data.routeCount, "00");
  assert.equal(h.page.data.routes.length, 0, "空结果不能回退 Mock");

  const failure = new Error("DATABASE_PERMISSION_DENIED");
  h.respond(async () => { throw failure; });
  await h.page.onRetryTap();
  assert.equal(h.page.data.status, "error");
  assert.equal(h.page.data.routeCount, "--");
  assert.equal(h.page.data.routes.length, 0, "失败时不能保留旧列表或回退 Mock");
  assert.equal(h.logs.at(-1).args[1], failure);

  h.respond(async () => ({ data: [seed] }));
  await h.page.onRetryTap();
  assert.equal(h.page.data.status, "success", "重试成功必须清除错误状态");
  h.respond(async () => ({ data: null }));
  await h.page.onRetryTap();
  assert.equal(h.page.data.status, "error", "返回格式异常不能当空列表");
  h.wx.cloud = undefined;
  await h.page.onRetryTap();
  assert.equal(h.page.data.status, "error", "云能力不可用必须进入错误状态");

  const gone = harness();
  gone.respond(() => new Promise(done => { resolve = done; }));
  const late = gone.page.onLoad();
  gone.page.onUnload();
  const updateCount = gone.page.updates;
  resolve({ data: [seed] });
  await late;
  assert.equal(gone.page.updates, updateCount, "离开页面后不得更新已卸载页面");
  console.log("通过：加载/成功/空结果/失败/重试/格式异常/缺少云能力/卸载、摘要查询、跳转与成功路径 Console 检查。");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
