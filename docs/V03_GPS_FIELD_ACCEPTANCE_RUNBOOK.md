# V0.3正式路线Android GPS现场验收手册

更新：2026-10-29。本文件是未来操作计划，本轮没有启动GPS、安排外出或取得新Android结果。只在用户另行授权且现场合法安全时执行；短段通过不代表全程导航通过。

## 当前证据：哪些无需重复

|项目|状态与证据边界|
|---|---|
|正式005启动、首位置、起点保护、对应停止ACK及重进无自动启动|ALREADY_VERIFIED（历史Android用户摘要/观察，R6J/R6K）。精度15米；非正式起点，未进入following。|
|正式路线连续起点确认、following及沿线推进|FIELD_REQUIRED；当前远离路线时BLOCKED_BY_DISTANCE，不因距离保护判GPS失败。|
|Nearby临时路线following、同路线连续会话正向进度、暂停/继续新SDK会话及最终停止|ALREADY_VERIFIED（Day4-D3私人QA），正式页面适用性PARTIAL，不能移用为正式Route PASS。|
|六正式Route普通/密采样B1回放|ALREADY_VERIFIED（SIMULATED，Day4-D2报告），不用现场前重跑全部回放。|
|正式页面暂停恢复专项、偏航/回归、终点资格|FIELD_REQUIRED；合法短测试未覆盖时保持NOT_VERIFIED。|
|真实累计距离准确性、阈值校准|NOT_VERIFIED；B1输出是沿线位置，不能用它直接证明GPS累计测距。|
|停止后20秒历史observationCount相同|不构成独立回调探针；20S_COUNTER_COMPARISON_NOT_DIAGNOSTIC。|
|底层硬件GPS独立停止|UNKNOWN；SDK ACK不等于系统级证明。|

## 出发前的版本与权限检查

1. 只有用户确实到达一条正式路线的合法、可通行起点，才安排本手册的following段。不按名称推测道路开放、交通或徒步安全，不为验收专程赶路。
2. 记录Android/微信粗粒度版本、真机调试或预览方式。必须为合法账号的开发/体验版；release被privateFollowBlock拒绝，不篡改envVersion。正常调试上传仍需其明确授权，不点正式上传审核。
3. 核对测试载体的版本/源码与审核版本。正式D使用公开占位配置；本轮未改私人载体。现有R6I是历史诊断版，不能凭目录名认定已包含后续D5修改。以后准备载体需单独授权、比对来源，不在现场临时合并代码。
4. 手机系统定位开启，微信具有所需前台权限，账号定位接口与隐私用途按实际账号核实；已有授权未弹窗属可能正常。不收集配置原值。
5. 同一页面进入正式Route详情，核对Route ID、名称、正式起点、track版本一致。仅看地图，不点击开始，确认无自动定位。不要把Nearby轨迹导入正式页。
6. 如需精确cursor、max、reason与ACK，优先使用经来源核对的现有只读R6I“读取真实GPS诊断（不定位）”。普通正式D仅显示格式化进度/质量，不能凭四舍五入字段补造精确标量；无足够观测字段时标UNKNOWN并停止该证据项，不在本轮新增工具。

## 一次有界短段尝试

### 1. 主动启动与起点确认

- 安全站稳，在“真实GPS循迹（前台实验功能）”点一次“开始真实循迹（私人测试）”。如需微信官方隐私同意，阅读后自行选择；同意不自动启动，再主动点击开始。拒绝就结束本次测试，不循环弹窗。
- 分别记录启动结果、首个业务位置是否到达、精度与最近更新时间、B1 phase/reason；START_ACK只对应实际session.start成功契约，不能由“无报错”推导。
- 原POLICY：reliableAccuracy=30米、startRadius=60米、prefixMeters=80米、startCount=3、startMs=4000。需要可靠连续证据，不是站到60米内就必然成功；分支歧义等也可能阻断。禁止改阈值或虚拟坐标。
- 只有实际phase=following才记录正式起点确认PASS。当前页面SDK启动后有20秒起点/恢复等待保护，不承诺30秒或无限等待。若POSITION_REQUIRED/NOT_AT_START/NO_LOCAL_MATCH/OFF_ROUTE_OR_PENDING等导致自动停止，读取那次停止结果，不重复结束覆盖成NO_SESSION。
- 精度持续不足、无回调或超时：结束本次尝试并标INCONCLUSIVE；远离起点则保留START_PROTECTION，不要求following。

### 2. 同一连续会话的A/B

在following且质量reliable、没有清理阻断时，记录A，再在安全可通行的正式步道上短行约60–120米；无需走完全程。停稳后记录B，不边走边操作手机。

必须保持同一Route/track、页面与连续会话；A/B期间不暂停、不切后台/锁屏、不返回、不重进、不重新开始。A先在电脑保留脱敏文字，按钮再读可能覆盖旧显示，不为复制而切手机后台。只能在已确认Android真机上下文使用现有`getFormalGpsSummary()`；没有这个接口不能假设正式D也有。

|字段|A|B|
|---|---|---|
|版本标识、Route ID、track版本或长度、sessionKey/序号|按实际记录|须匹配|
|recordKind、phase、reason、locationQuality|按实际记录|须是运行态证据|
|accuracyMeters、lastLocationAgeMs、起点证据次数/时长|无字段填UNKNOWN|按实际记录|
|cursorMeters、maxConfirmedMeters、remainingMeters|取精确标量|取精确标量|
|START_ACK、cleanup/cleanupPending、业务观测状态|按实际记录|按实际记录|

仅有效同会话才计算B−A的deltaCursor、deltaMax、deltaRemaining。cursor可因回走或噪声下降；历史max与当前cursor不是同一量。不要拿两者相减当本次走距，也不拿用户估计步行米数直接作精度标尺。先核对精度、reason、时序和会话，再判断冻结；一次没有推进不自动认定算法Bug。跨会话、路线变化、关键字段缺失标COMPARISON_INVALID。

### 3. 暂停、继续与最终结束

1. A/B完成后站稳，点“暂停循迹”。记录对应session.stop结果、cleanupPending及清理资源状态；单独的“已暂停”文字只是页面证据，不是独立SDK ACK。
2. 仅确认清理成功后主动“继续循迹”。继续建立新SDK会话，记录新标识及START_ACK；B1从resuming按原条件重新确认，不强求立即following。不要把暂停前后的快照当未中断A/B。
3. 不必继续走路，点一次“结束循迹”。记录这次实际SUCCESS_ACK或失败状态；NO_SESSION不代表新停止成功。CLEANUP_CONTRACT_CONFIRMED与原生SDK回执分别记录；cleanup=null只表示摘要无活动会话细节，不能单独证明物理停止。
4. 留在原页约20秒观察可见业务更新/意外恢复。停止后的LAST_SESSION_EVIDENCE是历史冻结记录，计数不变不能证明SDK没再回调；如无活动探针，业务迟到隔离证据保留Node负控，Android该项UNKNOWN，不新增监听探针。
5. 安全停止后“返回路线列表”，重进同一详情，确认不自动启动。无需再次点开始证明重进正常。

## 立即停止的条件

出现STOP_FAILED_OR_UNCONFIRMED、长期PENDING、cleanupPending=true、owner未释放、监听解绑异常、旧位置污染或意外重复启动：立即终止后续操作，不运行模拟/Native/Access，也不反复重试掩盖状态。保留脱敏错误和当前ACK；必要时用户退出小程序并关闭微信位置权限终止进一步定位，仍记录清理未确认。不要用重启手机或清UI把失败写成成功。

道路、天气、身体或交通条件不安全时同样停止；不要求为了数据继续走或返回危险地点。

## 短段不覆盖的项目

- 偏航/回归仅在自然发生或确认安全合法时观察，不能离开安全步道制造偏航。没有条件标FIELD_REQUIRED。
- 完成需原B1终点条件及用户“确认完成本次循迹”，不以动画结束或时间到期替代。原finishRatio=0.98、finishRadius=50米、finishCount=3、finishMs=4000等条件保持；短段无法到终点就标FIELD_REQUIRED，不为表格全部通过冒险。
- 全程稳定性、累计测距、道路可通行、不同设备/弱网络/系统权限撤回仍需分别设计，短测不宣称全部通过。
- 本手册不测试高德Access；accessRequestsEnabled=false、policyPagePath=null及release GPS门保留。

## 反馈模板与隐私

只收集：版本、Route ID、Android上下文来源、同会话确认、phase/reason/精度/时间、起点证据、A/B进度标量、暂停停止/恢复启动/最终停止、清理状态、重进是否自动启动及脱敏错误码。每项用PASS/FAIL/PARTIAL/UNKNOWN/NOT_TESTED并注明USER_REPORTED或USER_SUPPLIED_ANDROID_DIAGNOSTIC。

不收集经纬度、地址、实际控制点、地图截图、完整Page.data、原始Console位置流、账号标识、Key或用户额度记录。报告可只保留脱敏标量，不上传私人QA和轨迹。尚未得到真机结果的格子保持未测；指南本身不是现场验收。

[演示替代路径](PORTFOLIO_DEMO_GUIDE.md) · [当前状态](PROJECT_STATUS.md) · [运行安全](RUNNING_AND_SECURITY.md)


## 2026-11-01 · 005新珍珠湾专项出发前Gate

本地正式005已永久移至用户指定的新起点，1004点/7节点，数据版本2026-11-01T00:00:00.000Z。珍珠湾仅作为正式起点展示（独立ID0 Marker），不再保留重叠的ID1 Waypoint；轨迹首点距起点约0.823米；使用原B1前缀/精度/连续确认，不放宽阈值。

**当前不能直接出发：手机CloudBase数据尚未同步或读回。** 不覆盖共用V0.2 routes/005。建议下轮批准在现有私人载体中只对005绑定审查后的正式JSON作为明确标记的本地正式数据源（不是临时短路线），其他路线云读取保持；或者经用户选择独立QA云环境复制获准路线并核对规则。两者本轮都只准备方案、未实施、未传输。不能从目录名、代码版本推断线上005已更新。

出发前在电脑核验手机实际收到005 updatedAt、1004点、首尾、startPoint/Waypoint1、新里程及唯一名称与本地一致；不需导出位置。完成合法调试传输授权、编译、静止启动/停止预检后，再决定出行。带充电宝/线缆、足够手机和电脑电量、可用移动网络；提前确认Android真机调试连通，现场不安装基础工具。无网络/权限失败先止步排障，不注入位置。

建议90–120分钟预算（不是通过承诺）：0–15分钟核对现场开放通行、设备连接和加载版本；15–30分钟站稳主动GPS启动、可靠精度与3次/4秒起点证据、following；30–65分钟在安全合法步道沿原方向500–1000米，原地停稳取同会话A/B并观察停走；65–85分钟暂停/停止契约、主动继续新会话、可安全范围内小段回走；85–100分钟仅在自然且安全合法路径允许时观察偏航/回归，否则待验；100–120分钟最终停止、清理、返回重进与脱敏结果整理。不要边走边操作电脑或手机，不跨机动车道/封闭区域造测试。

首位置不等于起点确认；若精度不足或起点无法确认，安全停止并记INCONCLUSIVE，不反复启动。SDK清理FAILED_OR_UNCONFIRMED或长期PENDING就终止后续导航操作。停后历史次数不是SDK迟到回调探针。500–1000米有效连续证据只能证明005新起点及部分沿线，不证明46公里全程、终点、其他五路线或实际测距精度。终点保留后续真实证据，不要求为了全表PASS走完整环岛。

Day8-D2C节点精简后，应以新版完整数据指纹核对手机；旧21节点摘要失效，轨迹指纹保持不变。
