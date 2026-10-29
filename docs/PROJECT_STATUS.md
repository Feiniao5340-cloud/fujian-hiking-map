# V0.3 当前实施状态

## 2026-10-29 · Day6-D4 当前交付边界

高德政策阅读按钮及微信指引→补充文档→官方政策阅读链已有用户Android验证；阅读通道、当次明示同意和真实请求许可已解耦。用户已选择方案A：V0.3暂缓真实Access，生产accessRequestsEnabled=false、policyPagePath=null保持。null为历史站内页面字段，不再代表已验证的微信阅读通道缺失；阅读成功不能生成grant或定位。release真实GPS继续由privateFollowBlock阻断。

Day6-D3已只读核对实际部署包、控制台截图及用户报告：部署入口除账号绑定和行尾外与本地安全实现同源；客户端invoke允许认证非匿名身份，navigation_limits禁止客户端读写。当前V0.3客户端关闭不等于所有服务端调用路径全局关闭；未调用线上服务，Key有效性、自动日志及实际事务行为仍未验证。

本轮仅在route-detail WXML提前说明接驳暂缓、调整说明层标题，并将未来定位文案限定为准入满足时显示；处理函数和安全契约未改。新文案待最小可视复验；正常浏览、四B1/两Native及真实GPS控制流保留。新文档是未暂存文件，现有87成员清单属于此前候选快照，未自动纳入这两份手册；未来打包需显式评估，不能声称当前导出已包含。

正式005 Android首位置/起点保护/停止、Nearby连续会话进度/暂停恢复及六正式路线离线回放分别成立；正式Route following、进度、正式页暂停恢复、偏航回归、终点和现场校准仍待，硬件停止独立证据UNKNOWN。历史用户设备结果不提升为Codex独立手机操作。

[3分钟/8分钟演示指南](PORTFOLIO_DEMO_GUIDE.md) · [正式GPS现场手册](V03_GPS_FIELD_ACCEPTANCE_RUNBOOK.md)

以下带日期内容为各阶段记录；当前结论以上节为准。

## 2026-10-27 · Day4-D5内部候选整理

V0.2已完成公开；V0.3开发中，当前仅整理内部候选源码、依赖和说明，不具备微信正式公开发布资格。Day3结论为DAY3_BASELINE_CLOSED_WITH_LIMITS，停止后的历史计数对比不是独立20秒回调证据（20S_COUNTER_COMPARISON_NOT_DIAGNOSTIC），不重新开启Day3收口。

正式005页面已有Android真实GPS启动、首位置和对应停止回执证据，远离起点时未错误进入following，重进未观察到自动定位。私人Nearby QA已取得真实following、同冻结路线同连续会话正向进度及暂停/恢复回执；这不能替代正式页面验收，也不证明实际步行距离测量精度。六条正式Route普通/密采样B1离线回放已通过。

正式Route的Android following、沿线进度、正式页面暂停/恢复、现场偏航和终点仍未完成验证；B1阈值仍为CALIBRATION_PENDING。停止回执证明SDK契约层结果，不独立证明硬件GPS停止；停止后的历史observationCount不是迟到回调探针。

真实GPS仅允许开发/体验版本在用户主动操作后进入必要隐私/位置授权，release仍由privateFollowBlock拒绝（RELEASE_GPS_BLOCKED）。高德法律主体与getLocation准入已有OWNER_CONFIRMED，但未由Codex独立登录后台核验；policyPagePath仍为null，真实Access继续阻断（ACCESS_POLICY_PENDING）。

六正式路线、列表/详情、Trail/Waypoint、Native目标、四条B1模拟和008/010原生速览保留；GPS独立入口及隐私授权、质量门、暂停恢复、唯一owner、停止/解绑失败阻断已接入。无后台定位、真实位置历史存储或上传。没有已确认的新P0/P1；现场与平台缺口不能由文档整理消除。

V0.3内部候选成员清单RELEASE_FILES_V03_INTERNAL_CANDIDATE.txt为原82个成员加5个新增依赖，共87项：DECISIONS、PROJECT_STATUS、access-privacy及两个测试helper。原V0.2清单字节保持不变；新清单是另一个构建控制文件，自身不计入87项，不能据此漏掉未来提交范围中的该控制文件。候选包含占位配置，排除私人QA工程、运行身份、GPS快照及原始GPX。

Day4-D4正式D直接回归为Follow77/B1核心12/Page19/Native40及相关路线、导航检查通过；D5不改业务源码，仅执行清单/依赖/文档/保护验证。是否满足下一轮受控Git整理以D5桌面报告实际结果为准；本轮不暂存、不提交、不推送、不部署、不发布。Push和微信发布必须另行授权。

## 历史：2026-10-19 R4准备记录

下文“待设备”“不进入Day4”仅对应当时阶段，现状以上节为准。

2026-10-19 · Day3-R4：真实前台GPS私人QA入口代码准备。既有Day2所有权/停止ACK与R3测试可移植性保留。当前运行身份是公开占位配置，需所有者在独立私人副本配置已获准的同一账号后进入人工验收。实现完成，待DevTools、Android和受控步行验证，不记真实GPS Feature验收完成。

隐私用途与接口开通为OWNER_CONFIRMED；后台与设备未独立核验。真实GPS每次启动仍检查SDK隐私/位置授权、当前Route/B1、前台状态、唯一资源及清理ACK。仅开发/体验版本可进入，不发布。高德Access仍因政策阅读入口未验证而独立阻断。B1阈值CALIBRATION_PENDING；不进入Day4、不提交/推送/部署。
