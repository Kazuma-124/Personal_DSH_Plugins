# 版本记录

版本号遵循 SemVer；每个版本对应一次提交，`docs/index.json` 保留各版本的固定 commit 与发布时间。

## 1.0.0 — 2026-11-23

- 首个公开版本：左侧栏「工作区迁移」页面，以及 `list_workspace_sessions`、`migrate_workspace_sessions` 两个 Agent 工具。
- 把会话的完整事件日志复制到目标工作区并挂接；原会话默认把日志移入备份区，`keepOriginal` 为真时改为归档。
- 跳过打开中、待升级、无落盘日志和子代理会话；单会话失败回滚，不影响同批其他会话。
