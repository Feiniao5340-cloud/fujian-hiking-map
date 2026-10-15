# v0.2 当前架构

本文是当前公开候选摘要，替代旧阶段架构入口；私人开发/QA历史没有删除或改写。

## 数据与调用流

~~~text
首页 -> routes列表 -> route-detail
                      |-- route-service -> wx.cloud -> routes（只读）
                      |-- map-data -> 正式Trail + Start + Waypoint
                      |-- navigation-service -> wx.openLocation（原生目标）
                      |-- 单次wx.getLocation -> planAccessRoute -> 高德Walking -> 页面临时Access
                      |-- 005/006/009/011 -> trail-simulator -> trail-progress(B1)
                      |-- 008/010 -> native-route-overview -> MapContext.moveAlong
~~~

只有路线详情拥有当前选择、Access、模拟会话及地图派生状态。切换路线、hide/unload、重播通过清理及版本/代际检查拒绝旧响应；没有全局状态库、持久化徒步历史或第二套后端。

## Route v1：保留源数据

六套 data/routes/*.json 和同名 -import.json 是同一完整对象；导入版单行仅为CloudBase输入，不能当第七条路线。坐标统一gcj02，客户端不转换；track保持正式顺序、点值和首尾，不为动画补闭环或旋转数组。

根字段：_id、schemaVersion、name、city、district、locationText、coverImage、distanceMeters、estimatedDurationMinutes、difficulty、elevationGainMeters、routeType、summary、description、bestSeason、notice、coordinateSystem、startPoint、track、waypoints、source、updatedAt。字段约束以 scripts/check-route-data.cjs 为可执行准则。

startPoint包含name/latitude/longitude；track项只有latitude/longitude；Waypoint包含id/name/type/latitude/longitude/description/distanceFromStartMeters。source只含infoSource/trackSource/originalCoordinateSystem/conversionMethod/permissionNote/checkedAt。未知值按契约使用null，不补0或个人字段。

距离单位米、估计用时分钟、接驳返回用时秒；算法进度以有序几何累计长度计算，不强等于资料distanceMeters。起点元数据不必等于track[0]，太姥山有前置轨迹，完成点仍是正式最后一点。

## 模块职责

- services/route-service.js：云列表摘要、按ID读取完整Route及错误边界。
- utils/map-data.js：正式几何与Start/Waypoint适配；组合临时Access，不发网络请求、不改Route。
- services/navigation-service.js：Native与单次真实定位接驳；处理拒绝、错误、重入、超时及迟到结果。
- cloudfunctions/planAccessRoute：信任平台上下文、校验APPID/OPENID/SOURCE、事务限频、服务端HTTPS高德请求；Key不进客户端。
- utils/trail-progress.js：纯B1引擎，无wx/网络/持久化，阈值仍需真实校准。
- utils/trail-simulator.js：从正式轨迹派生虚拟观测；调用完整B1，视觉里程与确认进度分离；冻结私有索引的静态校验缓存不改变动态算法。
- utils/native-route-overview.js：只为008/010启用原生分段状态机，包含010第15段严格末点证据备用机制；不输出实时B1资格。
- services/trail-follow-service.js：保留真实前台GPS会话源码供后续验证；用户入口关闭，不在模拟中调用。

正式Marker与模拟Marker分离，模拟ID=-2、真实位置ID=-1、起点ID=0、业务Waypoint稳定正整数。四个本地图标分别为start/waypoint/location/simulation.png。页面只更新必要模拟显示字段，避免重复发送完整track；正常浏览不依赖模拟。

[模拟机制与限制](SIMULATION.md) · [运行安全](RUNNING_AND_SECURITY.md) · [数据来源](DATA_SOURCE.md) · [测试](TESTING.md)
