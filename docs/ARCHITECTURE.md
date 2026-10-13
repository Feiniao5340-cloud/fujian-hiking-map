# v0.1 架构与 Route v1 契约

日期：2026-10-13。公开候选整理版；原项目历史记录未改。

## 当前架构

三个原生页面：home、routes、route-detail。app.js读取config/env.js初始化wx.cloud；route-service使用同一环境，只读routes摘要limit20和_id详情limit1，无Mock fallback。地图适配完整保留合法track原序原值；起点Marker为0，业务节点使用稳定正整数ID。

用户选择节点后wx.openLocation打开目标；主动接驳调用wx.getLocation(type=gcj02)一次，再经navigation-service调用planAccessRoute。正式绿色Trail与临时蓝色Access分离；切换/隐藏/退出使旧回调失效，失败保留原路线。无客户端数据库写入、后台定位或位置历史。

唯一云函数保持getWXContext的APPID/OPENID/SOURCE=wx_client校验；Key仅AMAP_WEB_SERVICE_KEY服务端变量；navigation_limits事务仅存哈希计数，客户端read/write均false。每用户10/分钟、60/日，全函数200/日；上游失败计入已消耗计数。高德等待8秒，云函数建议15秒，客户端20秒，响应最大1MiB和2–5000合法点。

trail-follow-service真实GPS会话源码及trail-progress纯算法保留；公开真实循迹面板已停用，B1最多3个有界沿线分支，质量/时间预算与完成资格未放宽。最新版真实GPS真机验收未完成。交互式模拟v0.2仅计划，无新模块。

## 冻结的 Route Schema v1

一个 `routes` 文档保存一条路线；`startPoint`、`track`、`waypoints`、`source` 嵌套保存，不建立额外 collection。详情按 `_id` 一次读取大部分信息；列表只取摘要字段，避免把轨迹送到列表页面。

表中“必填”指 Day 2 合法文档必须提供；“可空”指资料未整理时的固定占位，不能据此把地图 Feature 标成完成。导入时建议保留全部字段及下表默认值，避免同一字段有多种空值表达。

| 字段 | 数据类型 | 必填 / Day 2 空值 | 含义与限制 |
| --- | --- | --- | --- |
| `_id` | string | 是，非空 | 稳定唯一 ID，如 `fj-route-005`；不使用可变名称作 ID |
| `schemaVersion` | number | 是，固定 1 | 首次冻结版本，尚无已入库旧版本需迁移 |
| `name` | string | 是，非空 | 路线名称 |
| `city` | string | 是，非空 | 福建省内城市 |
| `district` | string | 是，非空 | 所在区县，跨区路线选主要起点所在区县 |
| `locationText` | string | 是，非空 | 具体位置或起点区域说明；沿用现有页面字段 |
| `coverImage` | string | 否，`""` | 云存储 fileID（`cloud://...`）；无封面保留现有装饰占位，不接额外图床 |
| `distanceMeters` | number | 是 | 有限正数，单位米，路线总徒步距离 |
| `estimatedDurationMinutes` | number | 是 | 正整数，单位分钟，预计总徒步用时 |
| `difficulty` | string | 是 | `easy` / `moderate` / `hard`，人工参考评级 |
| `elevationGainMeters` | number 或 null | 否，`null` | 有限非负数，累计正向爬升，单位米；未知不是 0 |
| `routeType` | string | 是 | `loop` / `outAndBack` / `pointToPoint`，沿用当前页面 |
| `summary` | string | 是，非空 | 简短介绍，用于概览 |
| `description` | string | 否，`""` | 详细说明，纯文本，可含换行；不引入富文本或 Markdown 渲染器 |
| `bestSeason` | string | 否，`""` | 推荐季节说明，如“春秋，雨后需谨慎”；无资料时不推断 |
| `notice` | string | 否，`""` | 限制或不确定性说明，不再复用 summary 当提醒 |
| `coordinateSystem` | string | 是，固定 `gcj02` | 存储坐标的统一目标系；无坐标时不能宣称已完成转换 |
| `startPoint` | object | 是，可使用下表占位 | 起点唯一信息来源 |
| `track` | TrackPoint[] | 是，可 `[]` | 按行进顺序的坐标；Day 3 绘线前至少两个有效点 |
| `waypoints` | Waypoint[] | 是，可 `[]` | 起点以外的关键节点，按行进顺序排列 |
| `source` | object | 是 | 资料来源与坐标处理记录，见下表 |
| `updatedAt` | string | 是 | UTC ISO 8601，固定 `YYYY-MM-DDTHH:mm:ss.sssZ`，如 `2026-10-02T08:00:00.000Z` |

保留带单位的三个指标字段名，不增加 `distance`、`duration`、`elevationGain` 别名。同一指标只存一次，页面继续由 `format.js` 显示为公里/小时/米。`updatedAt` 从 Day 1 草案的数据库 Date 改为 JSON 可直接导入的时间字符串，不混存 Date、时间戳和字符串。

### StartPoint

| 字段 | 数据类型 | Day 2 | Day 3 地图验收 |
| --- | --- | --- | --- |
| `name` | string | 可 `""` | 起点名称必须明确 |
| `latitude` | number 或 null | 可 `null` | 有效 GCJ-02 纬度 |
| `longitude` | number 或 null | 可 `null` | 有效 GCJ-02 经度 |

纬度与经度同时存在或同时为 null。不能使用 0,0 作占位。起点不再通过 `startWaypointId` 引用，也不在 `waypoints` 重复保存 `type: start`，避免两个起点互相矛盾。

### TrackPoint

| 字段 | 数据类型 | 要求 |
| --- | --- | --- |
| `latitude` | number | 必填，有效 GCJ-02 纬度 |
| `longitude` | number | 必填，有效 GCJ-02 经度 |

轨迹允许整个数组为空；已有数组项不允许空坐标。使用明确字段名，避免 `[lng, lat]` 与 `[lat, lng]` 混淆。不存地图样式、marker ID、时间戳或海拔。Day 3 可直接使用 `track` 作为 polyline 的 `points`；颜色、线宽等由页面决定。

### Waypoint

| 字段 | 数据类型 | 要求 |
| --- | --- | --- |
| `id` | number | 必填，路线内唯一的稳定正整数；0 留给起点 marker |
| `name` | string | 必填，非空 |
| `type` | string | 必填，`end` / `viewpoint` / `junction` / `other` |
| `latitude` | number | 必填，有效 GCJ-02 纬度 |
| `longitude` | number | 必填，有效 GCJ-02 经度 |
| `description` | string | 可 `""`，纯文本 |
| `distanceFromStartMeters` | number 或 null | 可 `null`，有限非负沿路线距离，未知不得用直线距离替代 |

节点允许整个数组为空；已有节点必须提供 ID、名称、类型和有效坐标。id 不随数组排序重新编号。Day 3 markers 由起点（id=0）加 waypoints 转换而成，waypoint 的 id 直接用作 marker ID；标记名称、图标与 callout 在页面层映射，不存入库。

终点可用 `type: end` 节点表示，不再保存 `endWaypointId`。非环线路线需要展示终点时须准备 end 节点；环线可共用起点标记，不要求额外存重合终点。往返路线如有折返点，可用 other 节点说明“折返点”，不改路线总距离含义。

### Source

| 字段 | 数据类型 | Day 2 必填 / 空值 |
| --- | --- | --- |
| `infoSource` | string | 必填，非空；来源名称/链接，当前仅采用六条正式路线的真实来源记录 |
| `trackSource` | string | 无轨迹可 `""`；有轨迹或节点坐标时须说明坐标来源，混合来源分别写明 |
| `originalCoordinateSystem` | string | 无坐标可 `""`；有坐标时为 `gcj02` / `wgs84` / `bd09` |
| `conversionMethod` | string | 无坐标可 `""`；有坐标时写实际方法；确认原始 GCJ-02 直接使用写 `none` |
| `permissionNote` | string | 可 `""`；公开展示前明确资料和封面使用依据，不能虚构授权 |
| `checkedAt` | string | 必填，有效日期 `YYYY-MM-DD`，资料核对日期，不等同于实地核验 |

Source 细节和上传流程见 DATA_SOURCE.md。测试来源说明不构成真实路线资料验收。



## 验证边界

六正式/六Import、地图与算法自动测试通过；Task2用户DevTools复验为既有用户证据。本候选真实编译、独立环境及手机Access仍待。定位接口声明人工Gate见RUNNING_AND_SECURITY.md。
