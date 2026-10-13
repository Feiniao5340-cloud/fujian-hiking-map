# 六正式路线与公开自动测试

日期：2026-10-13。公开候选测试说明，原项目详细历史报告未改。

唯一数据：005厦门环岛、006大姆山、008嵛山岛、009黄连盂、010太姥山、011小坪森林公园及六Import。完整原序Polyline，合计40Waypoint；无第七Route、Seed/Mock输入或云fallback。GPS噪声/坏字段/XML负例仅来自六正式点的临时变异。

在根目录运行：

```powershell
node scripts/check-public-routes.cjs
```

该入口执行15项检查：数据/列表/详情/地图/Navigation/多路线/山线/GPX/轨迹算法/定位服务及公开入口、回放unit/matrix/formal/dense、B1独立控制。原18组Trail Follow、12组算法、Navigation16项及完成负例保留。候选身份测试读取本地project.config.json，绝不使用所有者AppID；云函数仍有同样鉴权。

双节奏完整回放20m/10s与2m/2s逐条检查，不是界面播放器。B1使用同一正式大姆山与纯历史源码文本：旧算法预期FAIL必须被检出，当前算法PASS。到终点只返回following+canConfirmCompletion；低精度/过时/跳点/暂停/旧Route等仍不得获得资格。

Task1/Task2及Day2独立验收已获本地15项PASS；Day3本候选已实际执行15/15 LOCAL PASS，原18组Trail Follow检查保持，28份JS/CJS语法检查通过，退出码与结果已记录在候选外的验收Manifest。当前源码自动模拟不等于DevTools/云/手机/实地导航PASS。具体公开范围见RELEASE_FILES.txt，运行与人工Gate见RUNNING_AND_SECURITY.md。
