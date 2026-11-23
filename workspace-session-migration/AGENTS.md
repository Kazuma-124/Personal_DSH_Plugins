# AGENTS.md — workspace-session-migration

给后续维护此插件的智能体看的操作手册，动手前先读完。

## 1. 功能和边界

- 两个 Host Agent 工具：`list_workspace_sessions`、`migrate_workspace_sessions`。
- 一个左侧栏页面「工作区迁移」：列出工作区与会话、勾选、预演/迁移；与工具共用同一套操作。
- 迁移 = 读原会话完整日志 → 用目标工作区路径写新会话 → 挂到目标工作区 → 移除原会话（备份或归档）。
- 只使用公开服务：`ctx.sessionPersistence`（`stat`/`list`/`open`/`create`）、`ctx.workspaceRegistry`（`list`/`attachSession`/`detachSession`/`archiveSession`/`unarchiveSession`/`unpinSession`）、`ctx.get('sessionProjectionCache').coldSnapshot`。
- UI 数据通过 `ctx.connection.fetch.register` 注册的两个已认证路由提供：`GET /api/workspace-session-migration/state`、`POST /api/workspace-session-migration/migrate`。不要改用未鉴权的 `webServer` 路由暴露写操作。
- 不调用模型、不发网络请求、不执行 shell；不读 `workspace.json` 或日志正文以外的私有存储。
- **不要**为了实现“保留 Session ID”去调用 `workspaceRegistry` 的私有方法、改 `workspace.json`、或改写已有 zstd 积压日志：这些都会绕过 DSH 的内存索引，升级后也容易失效。当前“新会话 id”的行为来自 DSH 的公开模型。

## 2. 文件地图

- `index.js`：路径解析、清单、迁移事务（复制/挂接/备份/归档/回滚）、参数校验、工具注册、两个认证路由。
- `client.js`：`window.__ModuleLoader__` 入口；`main` 面板、`sidebar.panellist` 入口、中英文案、页面组件。
- `tests/migration.test.mjs`：模拟 persistence / workspace / projection cache 的端到端测试，含认证路由。
- `tests/client.test.mjs`：浏览器模块的注册与面板/导航入口测试。
- `cordis.patch.yml`：bundle insert 行，行 id 与包名对应。
- `locale/{zh,en}.json`、`icon.svg`：插件页展示资源。

## 3. 不能破坏的行为

- 复制必须保留完整事件数组与继承前缀长度；新 header 只改 `id` 与 `cwd`。
- 新会话的 `cwd` 必须是目标工作区的 canonical `path`，否则 `attachSession` 会拒绝。
- 源工作区的目录状态不参与迁移校验：只读取已保存的会话日志；只有目标工作区的目录必须存在。
- UI 的工作区选项必须同时显示名称与目录，不能按名称去重或只显示名称；同名工作区靠目录区分。
- 挂接成功后，才能从原工作区 `detachSession`；原日志的移动必须可回滚（`rename` 到备份区，失败移回）。
- 默认 `keepOriginal: false`：原日志移到会话根目录同级的 `session-migration-backups/<stamp>/<id>/`；`keepOriginal: true` 时保留日志并归档原会话。
- 打开中的会话、需要格式升级的会话、无落盘日志的会话、子代理会话默认跳过；跳过和失败不能中止同批其他会话。
- 单会话失败要回滚：删新会话、恢复原日志、撤销挂接。
- 备份目录不自动删除。

## 4. 部署与验证

- 仓库根：`node scripts/deploy.mjs --only workspace-session-migration`（需要 `DSH_PROFILE_DIR`），或通过 `plugin_manager` 安装目录。
- Host 与 Client 代码更新需重启 DSH 才会加载；只改 Client 文案时刷新页面即可。左侧栏出现「工作区迁移」入口即 Client 注册成功。
- 安装后以工具是否出现在新会话、页面是否能列出工作区、以及一次 `dryRun` + 一次真实迁移的结果为准。
- 认证路由不能在没有 GUI 登录态的情况下直接调用；Host 侧行为以 `tests/migration.test.mjs` 的路由测试为准，Client 注册以 `tests/client.test.mjs` 为准。没有浏览器控制时不要声称实际渲染或交互已验收。
- 先跑 `node --test workspace-session-migration/tests/*.test.mjs`。

## 5. 分发

- 插件加载只依赖 `exports` 指向的运行时文件；`tests/` 不参与加载。
- 图标为原创 SVG；引入素材前确认授权。
- 版本在 `package.json`；改动本目录后按仓库根 `AGENTS.md` 第 8 节升版本并更新 `CHANGELOG.md`，不要沿用旧版本号发布新内容。
