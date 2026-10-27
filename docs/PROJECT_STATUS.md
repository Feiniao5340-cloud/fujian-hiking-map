# V0.3 当前实施状态

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
