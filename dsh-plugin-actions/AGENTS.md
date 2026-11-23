# AGENTS.md — dsh-plugin-actions

给后续维护这个插件的智能体看的操作手册，动手前先读完。

## 1. 它是什么

本包是 DSH Web 界面的两处小改动，Host 与 Client 各承担一部分：

- 插件详情页的「打开所在文件夹」动作。Host 注册已认证的 Connection 路由 `POST /api/plugin-actions/reveal`；Client 用 `plugins.detail.actions` 槽位渲染按钮。只按包名定位本机插件目录并交给系统文件管理器打开。
- 会话侧栏的「标为未读」。Client 在会话行菜单（`ctx.contextMenus`，target 族 `session`）加带图标的标记项，用 `sidebar.session.row.trailing` 槽位渲染行尾未读圆点；标记存在浏览器 `localStorage` 的 `dsh.plugin-actions.unread.v1`，会话进入主视图或归档时清除。
- 两项功能都不调用模型、不读对话内容、不上传数据；未读标记只在本机浏览器内保存，不写入会话日志。

## 2. 文件地图

- `index.js`：Host 路由、请求体限制、包名解析、跨平台打开目录。
- `client.js`：Client 半部——插件页按钮、未读标记存取（`createUnreadMarks`）、会话菜单贡献（含 `contextMenu.icon` 图标注册）、行尾标记组件、打开会话与归档时清除标记的订阅、中英文文案。
- `cordis.patch.yml`：bundle 的 insert 行，id 为 `<包名>:actions`。
- `locale/{zh,en}.json`：插件页标题与说明（覆盖两项能力）。
- `icon.svg`：包内 `./icon` 导出的原创图标。
- `tests/index.test.mjs`：包名解析、路由注册、非法请求、元数据一致性。
- `tests/client.test.mjs`：用 Node 的 `window` 模拟浏览器存储、会话列表、Workspace 归档集合与插槽注册，覆盖标记存取、菜单标签切换、行尾标记显示条件、打开与归档时清除、重启后保留、损坏存储回退、存储不可写提示、可选服务缺失时的降级。

## 3. 不能破坏的行为

- 只接受合法包名（`PACKAGE_NAME`）；禁止把用户输入拼进路径或交给 shell。
- 只打开已安装包所在目录；解析不到时返回 404，按钮显示失败说明。
- 请求体上限 8192 字节；非法 JSON/结构返回 400，超限返回 413。
- 不读文件内容、不遍历目录、不调用模型、不上传数据。
- 包名、patch 行 id、`client.js` 的模块 id 三者必须一致。
- 未读标记只接受非空字符串会话 id；读存储时过滤非法项，最多保留 500 个 id。
- 会话**进入**主视图（`retainedBy.mainView` 从无到有）时清除其标记；首次 `ready` 列表快照只记录当前主视图会话、不清除，所以重启后仍打开的会话保留标记。当前打开的主会话不显示行尾圆点。
- 归档会话的标记在归档集合出现时清除，归档行不提供菜单项；宿主自己显示「完成未查看」状态点（`completionUnread`）时不显示行尾圆点，避免重复提示。
- 行尾标记只占 `sidebar.session.row.trailing`；不要改成读取会话正文或写入会话事件。
- 行尾圆点会随宿主行尾信息在悬停、键盘聚焦、菜单打开时一起隐藏；不要往宿主元素注入 CSS 或改宿主样式把显示条件抢回来。
- 浏览器存储写入失败时保留内存中的标记；标记成功和失败都通过共享菜单提示确认（行尾圆点在指针停留于该行时被宿主隐藏，所以需要提示）。
- `contextMenus`、`sessions`、`workspaces` 经 `ctx.inject` 可选加载：缺失时分别失去菜单入口、打开会话自动清除、归档清除；其余功能照常，不要把它们改回必需的 `inject`。
- 菜单图标用 `contextMenu.icon` 的 keyed 槽位注册，key 必须与菜单项的 `icon.key` 一致；图标是原创 SVG，只用 `currentColor`。

## 4. 部署与验证

- 仓库根 `node scripts/deploy.mjs --only dsh-plugin-actions` 复制到 `<profile>/created-plugins/dsh-plugin-actions`；需要 `DSH_PROFILE_DIR`。
- 如果 profile 的 `link:` 仍指向仓库外目录，`deploy.mjs` 只会写 `created-plugins/`，不会改 link；要切到仓库副本，需重新安装/换源。
- 只改 `client.js` 时页面刷新（或 Host 的客户端热更新）即可加载；改 `index.js`、`package.json` 或新增依赖后需要重启 DSH。
- 先跑 `node --test dsh-plugin-actions/tests/*.test.mjs`，再在实际安装里验证按钮、菜单项和失败提示。
- 安装目录名一旦被使用就不要改；改名会产生孤儿条目。

## 5. 分发

- 插件加载只依赖 `exports` 指向的运行时文件；`AGENTS.md`、`tests/` 不参与加载。
- 图标为原创 SVG；不要引入无授权的素材。
- 版本在 `package.json`；改动本目录后按仓库根 `AGENTS.md` 第 8 节升版本并更新 `CHANGELOG.md`，不要沿用旧版本号发布新内容。
