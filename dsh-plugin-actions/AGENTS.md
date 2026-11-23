# AGENTS.md — dsh-plugin-actions

给后续维护这个插件的智能体看的操作手册，动手前先读完。

## 1. 它是什么

- DSH 插件详情页的「打开所在文件夹」动作。
- Host 注册已认证的 Connection 路由 `POST /api/plugin-actions/reveal`；Client 用 `plugins.detail.actions` 槽位渲染按钮。
- 只按包名定位本机插件目录并交给系统文件管理器打开；不调用模型、不读对话内容、不上传数据。

## 2. 文件地图

- `index.js`：路由、请求体限制、包名解析、跨平台打开目录。
- `client.js`：槽位注册、中英文文案、按钮状态。
- `cordis.patch.yml`：bundle 的 insert 行，id 为 `<包名>:actions`。
- `locale/{zh,en}.json`：插件页标题与说明。
- `icon.svg`：包内 `./icon` 导出的原创图标。
- `tests/index.test.mjs`：包名解析、路由注册、非法请求、元数据一致性。

## 3. 不能破坏的行为

- 只接受合法包名（`PACKAGE_NAME`）；禁止把用户输入拼进路径或交给 shell。
- 只打开已安装包所在目录；解析不到时返回 404，按钮显示失败说明。
- 请求体上限 8192 字节；非法 JSON/结构返回 400，超限返回 413。
- 不读文件内容、不遍历目录、不调用模型、不上传数据。
- 包名、patch 行 id、`client.js` 的模块 id 三者必须一致。

## 4. 部署与验证

- 仓库根 `node scripts/deploy.mjs --only dsh-plugin-actions` 复制到 `<profile>/created-plugins/dsh-plugin-actions`；需要 `DSH_PROFILE_DIR`。
- 如果 profile 的 `link:` 仍指向仓库外目录，`deploy.mjs` 只会写 `created-plugins/`，不会改 link；要切到仓库副本，需重新安装/换源。
- 覆盖后重启 DSH 才会加载新的 Host/Client 模块；只改 Client 可刷新页面。
- 先跑 `node --test dsh-plugin-actions/tests/*.test.mjs`，再在实际安装里验证按钮和失败提示。
- 安装目录名一旦被使用就不要改；改名会产生孤儿条目。

## 5. 分发

- 插件加载只依赖 `exports` 指向的运行时文件；`AGENTS.md`、`tests/` 不参与加载。
- 图标为原创 SVG；不要引入无授权的素材。
- 版本在 `package.json`；改动本目录后按仓库根 `AGENTS.md` 第 8 节升版本并更新 `CHANGELOG.md`，不要沿用旧版本号发布新内容。
