# AGENTS.md — dsh-compaction-prompts

给后续维护这个插件的智能体看的操作手册，动手前先读完。

## 1. 它是什么

本包在 DSH 的 **设置 → 压缩提示词** 中提供全局单选，让所有会话共用一份压缩摘要指令：

- 来源有三类：跟随当前安装版本的 `official:current`、按内容归档的官方快照、自定义提示词。
- 清单保存在 `~/.dsh/compaction-prompts/catalog.json`（可用 `DSH_COMPACTION_PROMPTS_DIR` 覆盖），首次创建时导入旧 `active/` 与 `presets/` 中的 `.md` / `.txt` 文件。
- 插件启动时从当前安装的 `BasicCompactionEngine.summarize()` 捕获官方指令，不调用模型、不发送网络请求；内容变化时新增快照。
- 自定义提示词可新增、编辑、删除；官方快照可删除，但“跟随当前版本”和当前安装内容对应的快照不可删除。
- Host 注册已认证的 Connection 路由 `/api/compaction-prompts`（GET 列表，POST 操作），并暴露 `compaction_prompt` 工具；Client 用 `settings.section` 槽位渲染页面。

## 2. 文件地图

- `index.js`：解析安装中的压缩引擎、捕获官方指令、替换共享 `BasicCompactionEngine.prototype.summarize()`、挂载接口与工具。
- `official-prompt.js`：在假上下文里调用官方 `summarize()` 捕获其最终指令（用哨兵异常在发出模型请求前中止），以及把选中正文替换进官方请求流程的 `summarizeWithPrompt`。
- `catalog-store.js`：`catalog.json` 的读取、校验、原子写入与全部清单操作（list/select/syncOfficial/addCustom/updateCustom/removePrompt/installedSnapshotId）。
- `prompt-interface.js`：设置页与工具共用的操作、HTTP 路由、参数校验与 400 KiB 限制。
- `prompt-store.js`：旧文件布局的读取工具与首次导入来源，保留给兼容测试。
- `client.js`：设置区组件、中英文文案、单选/预览/编辑/删除/折叠历史快照。
- `cordis.patch.yml`：bundle 的 insert 行，id 为 `<包名>:prompts`。
- `locale/{zh,en}.json`：插件页标题与说明；`icon.svg`：包内 `./icon` 导出的原创图标。
- `tests/catalog-store.test.mjs`：清单格式、迁移、去重、编辑删除、保护规则、原子写入与路径安全。
- `tests/hook.test.mjs`、`tests/prompt-store.test.mjs`：旧接口与文件读取的回归。
- `tests/ui-integration.test.mjs`：真实官方捕获、摘要请求、设置路由与工具、损坏清单恢复、客户端注册。
- `tests/connection-lifecycle.test.mjs`：用安装中的 Cordis/Connection 验证延迟就绪与路由注册/注销。
- `tests/http-route.test.mjs`：经真实 HTTP 服务验证认证、GET/POST、编辑删除、超大正文与无效 JSON。

## 3. 不能破坏的行为

- 包名 `@kazuma-124/dsh-compaction-prompts`、目录 `dsh-compaction-prompts`、patch 行 id 后缀 `:prompts`、`client.js` 的模块 id 必须互相对应；改任一项都等于改名，已安装副本需要卸载重装。
- 只在 `BasicCompactionEngine` 可用时安装钩子；接口不可用时页面显示不可用并禁止切换，不能假装成功。
- 捕获官方指令时不得发出真实模型请求；`summarizeWithPrompt` 必须继续走官方 `summarize()`，以保留模型路由、token 上限、请求前缀、工具与错误处理。
- 清单读写每次重新读取文件；选择是全局唯一 `selectedId`，不能缓存在进程里覆盖其他会话的更改。
- 写入必须是临时文件 + fsync + 同目录 rename；失败时磁盘内容保持不变。
- 清单损坏或选中的自定义内容无法读取时，当前压缩直接报错，不能静默改选官方。
- 自定义名称非空、最长 120 字符；正文非空、最多 64 KiB；标识由名称与正文的 SHA-256 生成，编辑后标识随之变化。
- 官方当前项与当前安装内容对应的快照不可删除；删除正在使用的自定义项或快照时，选择改为 `official:current`。
- HTTP 路由必须保持缓冲请求体模式：流式模式会给无正文的 `GET` 构造带正文请求并导致空 400。
- 请求体上限 400 KiB（读取前按 `Content-Length`、读取中按累计字节双重检查）；非法 JSON 与未知字段返回 400，超限返回 413。
- 不调用模型、不联网、不上传数据；提示词正文只写入本机数据目录。

## 4. 部署与验证

- 仓库根 `node scripts/deploy.mjs --only dsh-compaction-prompts` 复制到 `<profile>/created-plugins/dsh-compaction-prompts`；需要 `DSH_PROFILE_DIR`。
- 如果 profile 的 `link:` 指向仓库外目录，`deploy.mjs` 只会写 `created-plugins/`，不会改 link；要切到仓库副本，需重新安装/换源。
- 只改 `client.js` 时刷新页面即可；改 `index.js`、`official-prompt.js`、`catalog-store.js`、`package.json` 或 patch 行后需要重启 DSH。
- 测试需要打包 DSH 的 Electron Node 运行环境：设置 `ELECTRON_RUN_AS_NODE=1` 与 `DSH_INSTALL_DIR`，再运行 `node --test tests/*.test.mjs`；纯文本与清单测试可用普通 Node。
- 安装后验证：设置页能读取清单、切换后摘要请求使用所选正文、删除规则与折叠区生效。
- 安装目录名一旦被使用就不要改；本插件的既有部署目录名是 `dsh-compaction-prompts`。

## 5. 分发

- 插件加载只依赖 `exports` 指向的运行时文件；`AGENTS.md`、`tests/` 不参与加载。
- 图标为原创 SVG；不要引入无授权的素材。
- 版本在 `package.json`；改动本目录后按仓库根 `AGENTS.md` 第 8 节升版本并更新 `CHANGELOG.md`，不要沿用旧版本号发布新内容。
