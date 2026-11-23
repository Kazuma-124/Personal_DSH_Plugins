# AGENTS.md — Personal_DSH_Plugins

给在本仓库工作的 Agent 的操作手册。各插件目录还有自己的 `AGENTS.md`，涉及插件内部实现时以那一份为准；本文件只讲仓库级约定。

## 1. 这是什么

Kazuma-124 的个人 DSH（DeepSeek Harness）插件 monorepo。每个插件都是**可独立安装的组合包**，仓库同时维护一个**插件索引**（`docs/index.json`），别人可以在 DSH 的「发现」页加这个索引来浏览和安装。

判断「某个插件能不能装到当前 DSH 上」时，不要凭印象，按 [README 的校验表](README.md#dsh-实际会校验什么) 逐项核对：

- 硬性：`dsh.bundle.patch` 存在、`engines.dsh`（或 `@deepseek-ai/dsh*` peer）与运行版本相容、patch 里的 `name` 能被 profile 解析。
- 软性：locale 文案、图标、`license`/`repository`/`homepage`/`keywords`。这些不阻止安装，只影响展示和搜索权重。

`engines.dsh` 一旦声明就**独占**判断，peer 依赖不再参与；两者都没有则视为任意版本兼容。改这个字段等于改安装门槛：宁可先窄后宽，也不要为了「看起来兼容」而放宽到未验证的版本。

## 2. 常用命令

```powershell
node scripts/version.mjs check                       # 版本、CHANGELOG 与已发布版本是否一致
node scripts/version.mjs bump <插件目录> patch --note "改了什么"
node --test scripts/version.test.mjs              # 版本比较与递增
node --test dsh-token-usage/*.test.mjs            # 统计口径
cd conversation-notebook; node build.mjs          # 改 src/ 后必须重建 dist/
cd conversation-notebook; node --test tests/*.test.mjs
node --test dsh-plugin-actions/tests/*.test.mjs   # 插件操作
node scripts/deploy.mjs --all                       # 部署全部插件（必须显式 --all）
node scripts/deploy.mjs --only dsh-token-usage      # 只部署一个插件（推荐）
node scripts/build-index.mjs                      # 重新生成 docs/index.json 并校验
node scripts/build-index.mjs --check              # 只验证是否最新
```

`npm install` 只在仓库根安装 `@deepseek-ai/dsh-plugin-market-index`（DSH 官方索引校验器的开发依赖，不用于分发），各插件本身没有依赖。

## 3. 不能破坏的东西

- **插件之间的独立性**：每个插件都是可单独安装、卸载、更新、迁移的单元。一次操作只针对一个插件；不得顺手改动另一个插件的目录、包名、patch、profile 条目或索引条目。插件之间不能互相 `import` 对方文件，也不能假设对方已安装；脚本必须支持只操作单个插件（`deploy.mjs --only`）。
- **包名与 patch 的一致性**：每个插件的 patch 行 id 都要与包名对应。`conversation-notebook/cordis.patch.yml` 是 `<包名>:notebook`，`dsh-plugin-actions/cordis.patch.yml` 是 `<包名>:actions`，`dsh-token-usage/cordis.yml` 的 `name` 是包名。改包名必须同时改这些地方，以及 `conversation-notebook/build.mjs` 里的包名校验。改名会让已安装的副本变成另一个 bundle，需要卸载重装。
- **部署目录名**：`scripts/deploy.mjs` 在 profile 里固定使用各插件自己的部署目录名（`dsh-token-usage`、`e1727a2d-8dfb-4483-8fd4-2a5078b2229e`、`dsh-plugin-actions`、`workspace-session-migration`），与本仓库的包名解耦。不要为了「对齐命名」去改这些目录，那会让用户已安装的条目变成孤儿。
- **索引与包的一致性**：`docs/index.json` 是生成物，字段全部来自 `package.json`、`locale/*.json` 和 `icon.svg`。不要手改；改完包并提交后跑 `node scripts/build-index.mjs`。索引固定的是 commit，所以“先提交、再生成”的顺序不能颠倒。
- **只读与隐私边界**：所有插件都不调用模型、不上传数据。`dsh-token-usage` 只读本机 DSH 数据目录、页面与 API 只允许回环地址；`conversation-notebook` 只通过已认证的 Connection 路由读写本机磁盘；`dsh-plugin-actions` 只按包名把本机插件目录交给系统文件管理器打开，不读文件内容、不经过 shell。新功能不能突破这些边界。
- **`conversation-notebook/dist/` 是提交物**：按目录安装和 git 安装都直接用它。改 `src/` 却忘了重建，等于发布旧代码。

## 4. Token 纪律

`dsh-token-usage/dashboard.html` 有多条数千字符的超长行，整文件读取会烧掉大量 token：先 `grep` 定位行号，再读该行 ±2 行，用短锚点 `edit`。验证按改动类型选最低一级（静态字符串 → `Invoke-WebRequest`；collector → `node --test`；真实渲染 → 最多一两次 headless Edge）。

## 5. 发布流程

分发 = 克隆仓库按目录安装，索引固定本仓库的 commit。

1. 改包，按第 8 节升版本并更新该插件的 `CHANGELOG.md`，跑对应测试，必要时 `node build.mjs`。新插件或从本机迁入的插件先按第 7 节处理。
2. 跑 `node scripts/version.mjs check`，确认版本高于已发布版本且变更记录存在。
3. **提交插件目录**——索引固定的是 commit，未提交的改动意味着索引描述的不是它指向的代码。
4. `node scripts/build-index.mjs`（脚本会拒绝在插件目录有未提交改动或版本未升时生成）。
5. 再提交 `docs/index.json` 并 push。索引走 `https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/docs/index.json`，jsDelivr 对 `@main` 有缓存，推送后可能需要几分钟才生效。

索引固定的是**最后一次修改该插件目录的 commit**，不是索引提交本身；提交 `docs/index.json` 之后 pin 会落后于 HEAD，这是正常的：那个 commit 里已经包含它所描述的插件代码。

## 6. 索引的硬约束（改格式前先读）

DSH 的索引是 **format 1** 的单个 JSON，用 `parseMarketIndex` 校验：

- 必须能被匿名 `GET` 取到，**返回 2xx 且不经重定向**（`github.com/.../raw/...` 会 302，不能用）；UTF-8，默认上限 128 MiB。
- `metadata.categories` / `labels` / `sortKeys` 里没声明的 id，在插件上引用会直接让整个索引被拒。
- 图标可以是相对路径（相对索引 URL 解析）或 https 绝对 URL；内联 `data:` 上限 32 KiB。
- 每个版本只有一个 `source`，本仓库固定为 `{ "type": "git", "url", "commit", "path" }`（commit 为 40 位小写 SHA）。
- `engines.dsh` 要与包自身一致，安装时 DSH 会再校验一次。

## 7. 插件搬运：本机 DSH ↔ 本仓库

两个方向都可能被要求：把本机 profile 里**正在使用**的插件搬进本仓库（迁入），或把本仓库的发布快照装到本机 profile（安装）。**先分清是覆盖还是新建，再动手**；同一个插件在仓库里只保留一个目录，本机只保留一个运行副本，两份内容必须能对应上。

**独立性优先**：每个插件都可单独安装、单独卸载、单独迁移。一次只搬一个插件；搬 A 不得改动 B 的目录、包名、patch、profile 条目或索引条目。`build-index.mjs`、`deploy.mjs`、README 表格这类共享文件只允许追加自己的条目；插件之间不互相 `import`，也不假设对方已安装。

### 7.1 覆盖还是新建

- **迁入**：仓库里已有同 `package.json` `name` 的目录 → 覆盖该目录（只动这个目录，不碰兄弟插件）；没有 → 用包名去掉 scope 的目录名新建（与 `dsh-token-usage` 风格一致），并完成 7.4 的注册。不要为同一个包建第二个目录。
- **安装**：profile 里已装同名包 → 原地更新，不换目录名、不产生第二个副本；换源时确认旧 `link:` 被替换，不残留指向旧目录的条目；未装 → 作为新包安装，由 DSH 写 profile 的 `package.json` 和 bundle 选择。
- 覆盖前确认目标目录确实属于这个插件；`scripts/deploy.mjs` 对目标目录先 `rm -rf`，没有自动备份。profile 的 `plugin-backups/` 是 DSH 自己的产物，不能依赖它兜底。
- 需要保留旧版或并行安装时，把新副本放到独立目录并使用不同包名；不要覆盖现有安装。
- 本机自用副本与仓库是两份源：本机副本是日常运行与修改的地方，仓库是发布快照。迁入只把内容复制进仓库，不改变本机安装，也不要把 profile 的 `link:` 指向仓库目录。
- 本机更新后，把差异提取到仓库并在仓库副本上升版本；需要重置本机副本时用发布快照，先确认本机没有尚未提取的改动。`deploy.mjs` 复制到 `created-plugins/` 的是本机副本，不是版本源。

### 7.2 找到本机正在用的插件

- 有 `plugin_manager` 时先 `list_bundles` / `list_plugins`，拿准确的包名、安装状态和来源。
- 没有时查 `<DSH_PROFILE_DIR>`：`package.json` 的 `dsh.profile.bundles`、`dependencies` 里的 `link:` 目标、`node_modules/<包名>` 的真实路径（link 常指向 profile 外的工作区）、`created-plugins/`。
- 记录来源路径、包名、版本、许可证和作者。无法取得源码的二进制分发不能迁入；只能依赖它的，在 README 里写清楚。

### 7.3 迁入前必须脱敏

仓库是公开可下载的。提交前逐项处理新增目录：

- **机器路径**：`C:\Users\<用户名>`、`/home/<用户名>`、`~/.dsh`、具体 profile 目录、`DSH_HOME` / `DSH_PROFILE_DIR` 的值、`file:///` 绝对路径、`link:` / `file:` 依赖。运行时要用的路径改为从环境变量或 `os.homedir()` 推导，并提供配置覆盖。
- **凭据**：API key、token、cookie、密码、私钥、`.env*`。
- **个人信息**：真实姓名、邮箱、机器名、内网地址和端口、会话 ID、工作区/项目路径、含隐私的截图或日志、`verification/`、`node_modules/`、浏览器 profile。
- **第三方内容**：没有许可证或禁止再分发的代码、图标、文案不能进仓库；必需的版权声明和署名要保留。
- **能力审查**：确认没有未声明的网络请求、模型调用、任意命令执行、读取对话正文或上传数据；与第 3 节冲突的实现要么改掉，要么不迁入。
- **脱敏不是删功能**：示例数据换成占位符，测试仍要覆盖原来的行为。

提交前在新增目录里做一次内容核对（用户名、`file:///`、绝对路径、凭据关键词、内部 URL），再看 `git status` 没有混进构建产物或本机文件；不要用 `git add -f` 强行加入被忽略的本机文件。

### 7.4 迁入后补齐公开字段与仓库注册

- `package.json`：`name` 用 `@kazuma-124/` 作用域；版本从 `1.0.0` 开始；`description`；`engines.dsh` 按**当前运行版本实测**后收窄，不要照抄未验证的宽范围；`author`；`license`；`repository` / `homepage` / `bugs` 指向本仓库；`keywords`；`exports` 暴露 `./locale/*.json` 与 `./icon`。
- 展示资源：`locale/en.json` 与 `locale/zh.json` 的 `meta.title` / `meta.description`（不能留模板文案）；原创或已获授权的 `icon.svg`（≤256 KiB）；`README.md`；`CHANGELOG.md`（至少一条当前版本记录）；需要详情页时加 `docs/DETAIL.md`。
- 仓库注册：`scripts/plugins.mjs` 的 `PLUGINS` 加目录和 category（新 category 先在 `INDEX_METADATA.categories` 声明）；`scripts/deploy.mjs` 加映射（目录名一旦被已安装用户使用就不能再改）；README 的中英文简介、插件表、兼容性表、仓库结构同步；要进社区目录时补 `catalog/`。这些注册只做加法，不改其他插件的条目。
- 测试与构建：按现有风格加 `node --test`，并纳入根测试脚本；有 `src/` + `dist/` 的必须提交构建产物。
- 溯源：在 README 或 `MIGRATIONS.md` 记录上游 URL/commit、原作者与许可证、脱敏时改了哪些东西，方便后续同步上游和说明再分发依据。
- 边界：迁入插件必须遵守第 3 节的只读/不上传约束；做不到的不要放进这个公开仓库。

### 7.5 安装到本机 profile

1. 先跑对应测试，必要时 `node build.mjs`；确认当前 DSH 版本满足 `engines.dsh`。
2. 选安装方式：
   - **新装 / 换源**：`plugin_manager` 的 `install_bundle`（target 为本机插件目录的绝对路径，不要指向分享仓库），或 UI 的「插件 → 添加插件」，或 `dsh plugin --profile <profile> add <目录>`。由 DSH 写 profile 的 `package.json` / `cordis.patch.yml`；不要手改这两份文件，也不要在 profile 里运行包管理器。需要执行的 build 脚本只在用户明确同意后放行。
   - **更新已装插件**：本机副本在自己的目录（`created-plugins/` 或独立工作目录），直接改该副本；本机更新后再提取到仓库。只有该插件在 `scripts/deploy.mjs` 且 profile 用其中固定的目录名时，才用 `node scripts/deploy.mjs --only <插件目录>` 从发布快照重置本机副本；先确认本机没有未提取的改动。
3. 只改一个插件时用 `--only`；批量部署必须显式 `--all`，不带参数会直接拒绝，避免误覆盖其他插件。
4. 覆盖已安装包后要重启 DSH 才会加载新的 Host/Client 模块；只改静态页面或文案可以刷新。以 `plugin_manager` 返回的 `application` 和新的会话/页面实测为准，不要凭日志或进程列表宣布生效。
5. 安装后核对插件行、标题/描述、图标和实际能力；恢复测试时改过的用户状态。不要把 profile 的 `link:` 路径、生成的 `node_modules` 或本机配置提交回仓库。

## 8. 版本管理

每个插件只有一个版本号：`package.json` 的 `version`，遵循 SemVer。它是 DSH 插件页、索引和迁移判断「这是不是同一版」的唯一依据；同一个版本号不能对应两份不同的内容。

- **仓库里的插件目录一旦修改就必须升版本**，并在同一个提交里更新该目录的 `CHANGELOG.md`。即使只改 README、locale、图标或 `package.json` 元数据，也至少升 patch——索引会为每个版本固定一个 commit，版本不动会让旧版本号静默指向另一份代码。
- 本机自用副本可以连续修改；每次把本机改动提取到仓库前，合并后的差异必须升一次版本，不能把多个已发布版本之间的改动塞进同一个版本号。
- 级别：**major** 改配置结构、包名、patch 行 id、`engines.dsh` 下限、数据格式或工具参数（旧用法会坏）；**minor** 加用户可见能力或选项且向后兼容；**patch** 修 bug、文案、样式、图标、文档和元数据整理。
- 新插件从 `1.0.0` 开始；预发布用 `1.0.0-rc.1`，正式发布时去掉后缀。不要用 `0.x` 表示「还在改」，也不要用 build metadata 代替版本。
- 不要手改 `docs/index.json` 的版本历史；`build-index.mjs` 会把旧版本连同各自的 commit 与发布时间保留在 `versions` 里。已经发布过的版本号不复用、不覆盖、不删除。
- 工具：

  ```powershell
  node scripts/version.mjs bump <插件目录> patch --note "一句话说明改了什么"
  node scripts/version.mjs check
  ```

  `check` 会拒绝「目录内容变了但版本没升」「版本低于已发布版本」「当前版本没有 CHANGELOG 条目」三种情况；`build-index.mjs` 写索引前会再跑一次同样的检查。
- 发布顺序：改代码 → 升版本并写 CHANGELOG → 跑测试 → 提交插件目录 → `node scripts/build-index.mjs` → 提交索引。顺序反过来会让索引指向没有该版本的 commit。
- 本机自用副本是日常修改的地方，仓库是发布快照。提取时先比较两侧内容，在仓库副本上升版本并写 CHANGELOG；需要两边版本号对齐时，把新版本号同步回本机副本。`deploy.mjs` 复制到 `created-plugins/` 的副本、profile 的 `link:` 目标和 `plugin-backups/` 都不是版本源。
