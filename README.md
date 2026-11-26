# Personal DSH Plugins

[Kazuma-124](https://github.com/Kazuma-124) 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件仓库：每个插件都是可独立安装的**组合包**（bundle），仓库同时发布一个 **DSH 插件索引**，方便在应用的「发现」页里浏览、安装和更新。

**English.** Five installable DeepSeek Harness bundles — token usage statistics, a per-conversation notebook, a collection of interface tweaks, workspace session migration, and a global compaction-prompt picker with official snapshots and custom prompts. All are plain JavaScript, have no third-party runtime dependencies, never call a model and never upload data; the migration bundle reads local session logs to copy a conversation into another workspace, and the compaction-prompt bundle replaces only the trailing summarization instruction of the installed compaction request. Clone the repository and install a directory, or add the plugin index (`https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/docs/index.json`) in **Plugins → Discover**. See [Install](#install) and [what DSH actually validates](#what-dsh-actually-validates).

| 插件 | 作用 | 出现位置 | 仓库目录 |
|:--|:--|:--|:--|
| [dsh-token-usage](dsh-token-usage/README.md) | 按对话与项目汇总 token 用量，带趋势图 | 左侧栏「Token 用量」 | [`dsh-token-usage/`](dsh-token-usage) |
| [conversation-notebook](conversation-notebook/README.md) | 每个对话一份独立纯文本笔记，保存到本机磁盘 | 右侧栏入口页「对话记事本」 | [`conversation-notebook/`](conversation-notebook) |
| [dsh-tweaks](dsh-tweaks/README.md) | DSH 界面小改动合集：插件详情页打开所在文件夹、会话行「标为未读」 | 插件详情页动作区、会话行菜单与行尾 | [`dsh-tweaks/`](dsh-tweaks) |
| [dsh-compaction-prompts](dsh-compaction-prompts/README.md) | 全局选择一个压缩提示词；支持跟随官方、官方历史快照、自定义提示词的增改删与快照清理 | 设置 →「压缩提示词」页 + `compaction_prompt` 工具 | [`dsh-compaction-prompts/`](dsh-compaction-prompts) |
| [workspace-session-migration](workspace-session-migration/README.md) | 把对话完整迁移到另一个工作区，原日志进备份或归档 | 左侧栏「工作区迁移」页 + 两个 Agent 工具 | [`workspace-session-migration/`](workspace-session-migration) |

五个插件都只在本机工作：不调用模型、不上传任何数据、不创建定时任务；会话迁移需要复制会话，因此会读取本机会话日志；压缩提示词只替换压缩请求末尾的摘要指令，提示词正文保存在本机数据目录。

## 安装

分发方式是「克隆仓库 + 按目录安装」，或通过插件索引安装（索引条目指向本仓库的固定 commit，需要本机有 `git`）。

### 方式一：插件索引（在 DSH 里浏览、安装）

1. 打开 **插件**，在**实验性插件**里开启**自定义插件索引**（DSH 默认不启用「发现」页，也不自带任何索引源）。
2. 切到 **发现** → **添加索引源**，填入：

   ```text
   https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/docs/index.json
   ```

3. 选中条目，确认来源后安装。安装过程会用 `git` 拉取索引里写的那个 commit（不是分支头），所以装到的东西是固定的。

索引是第三方内容：DSH 校验文件格式，但标题、作者和来源由索引声明，安装前请在确认框里核对来源。

### 方式二：克隆后按目录安装（推荐，步骤最少）

```powershell
git clone https://github.com/Kazuma-124/Personal_DSH_Plugins.git
```

然后在 DSH 里用 **插件 → 添加插件** 选择克隆下来的子目录：

- `Personal_DSH_Plugins/dsh-token-usage`
- `Personal_DSH_Plugins/conversation-notebook`
- `Personal_DSH_Plugins/dsh-tweaks`
- `Personal_DSH_Plugins/dsh-compaction-prompts`
- `Personal_DSH_Plugins/workspace-session-migration`

桌面版和 `dsh web` 都可以这样装。也可以走命令行（`<profile>` 换成实际的 profile 名）：

```sh
dsh plugin --profile <profile> add ./Personal_DSH_Plugins/dsh-token-usage
dsh plugin --profile <profile> add ./Personal_DSH_Plugins/conversation-notebook
dsh plugin --profile <profile> add ./Personal_DSH_Plugins/dsh-tweaks
dsh plugin --profile <profile> add ./Personal_DSH_Plugins/dsh-compaction-prompts
dsh plugin --profile <profile> add ./Personal_DSH_Plugins/workspace-session-migration
```

按目录 / 本地路径安装使用本地 link，不执行任何构建脚本，也不需要放行 `allowBuilds`。注意 `conversation-notebook` 的 `dist/` 已经在仓库里构建好；改 `src/` 之后要自己跑一次 `node build.mjs`。

### 方式三：从发布快照安装到本机 profile

`scripts/deploy.mjs` 把插件复制到当前 profile 的默认插件目录 `<profile>/created-plugins`，复制目标目录名保持不变（`dsh-token-usage`、`e1727a2d-8dfb-4483-8fd4-2a5078b2229e`、`dsh-tweaks`、`dsh-compaction-prompts`、`workspace-session-migration`），因此改包名不影响本机已安装的条目。它安装的是仓库快照；本机日常修改应发生在复制后的目录，再提取回仓库并升版本。插件互相独立，只更新一个时用 `--only`，不会碰另一个插件的已部署副本：

```powershell
node scripts/deploy.mjs --only dsh-token-usage            # 只更新 Token 用量
node scripts/deploy.mjs --only conversation-notebook      # 只更新对话记事本
node scripts/deploy.mjs --only dsh-tweaks              # 只更新界面微调
node scripts/deploy.mjs --only dsh-compaction-prompts  # 只更新压缩提示词
node scripts/deploy.mjs --only workspace-session-migration # 只更新会话迁移
node scripts/deploy.mjs --list                            # 列出可用名字
node scripts/deploy.mjs --all                             # 批量部署必须显式 --all
```

以上命令需要 `DSH_PROFILE_DIR`，DSH 会话的 shell 里已有。

之后按插件 README 的说明刷新页面或重启 DSH。

## 怎么找到这个仓库

- **GitHub 仓库的 About**：description 与 topics（`dsh-plugin`、`deepseek-harness`、`dsh`）——GitHub 搜索和社区目录都读它。
- **[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)**：条目草稿在 [`catalog/`](catalog/README.md)。这个目录同时喂给 dsh-market 插件、[dshmarket.com](https://dshmarket.com) 和 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)，并发布成一份 format-1 索引，所以进目录 = 同时进市场、网站和别人「发现」页里的那个源。
- **本仓库的插件索引**：`https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/docs/index.json`，由 [`scripts/build-index.mjs`](scripts/build-index.mjs) 从包字段生成，DSH「发现」页可直接添加。
- **落地页**：<https://kazuma-124.github.io/Personal_DSH_Plugins/>（GitHub Pages，给搜索引擎看的静态页）。同一目录也提供备用索引源 `https://kazuma-124.github.io/Personal_DSH_Plugins/index.json`，`github.io` 在部分网络下较慢，所以默认仍用 jsDelivr。
- 页面正文（本 README 与各插件 README）里的名词、安装命令、能力描述，是普通搜索引擎唯一能抓到的内容，改动时别把它们删掉。

## DSH 实际会校验什么

区分**硬性**（DSH 会拒绝安装或禁用插件行）与**软性**（只影响展示，不阻止安装）。这是别人（或别人的 Agent）判断「这个插件能不能用在当前版本上」的依据，也是本仓库补字段的依据。

| 字段 | 强制程度 | 不满足时会发生什么 | 本仓库做法 |
|:--|:--|:--|:--|
| `dsh.bundle.patch` | **硬性** | 包能装进去，但只作为普通依赖，**不会插入任何插件行** | 五个包都声明 |
| `engines.dsh`（或 `@deepseek-ai/dsh*` peer） | **硬性** | 不匹配时安装被拒（需按 `name@version` 显式豁免）；已装的行在启动时被自动禁用并打警告 | 各包按实测声明：三个包为 `>=0.2.0-0 <0.3.0`，会话迁移与压缩提示词为 `>=0.2.2-rc.5 <0.3.0` |
| patch 里的 `name` 能被 profile 解析 | **硬性** | 该行加载失败 | patch 与包名一致 |
| `meta.title` / `meta.description` | 软性 | 回退 `package.json` 的 `name` / `description`，卡片和详情页显示粗糙 | 中英 locale 都写了 |
| `icon` | 软性 | 用面板默认占位图；超过 256 KiB 或格式不是 SVG/PNG/JPEG/WebP 会报诊断 | 各有原创 SVG |
| `license` / `repository` / `homepage` / `bugs` | 软性 | DSH 不读；只影响目录站，以及 Discover 详情页从仓库默认分支读 README | 已补齐 |
| `keywords` | 软性 | 不参与安装；索引搜索对关键词的匹配权重是 2 倍 | 已补齐 |
| `author` | 软性 | 卡片与详情页作者为空 | 已补齐 |

`engines.dsh` 是全有或全无的：声明了它就**只**看它，`@deepseek-ai/dsh*` peer 不再参与判断；没有声明时才逐个检查 peer；两者都没有则该包被视为**任意版本都兼容**。所以不要把 peer 依赖当作「顺便声明的版本约束」——那会变成硬门槛。

## 兼容性

| 插件 | 版本 | `engines.dsh` | 实测环境 |
|:--|:--|:--|:--|
| dsh-token-usage | 1.0.2 | `>=0.2.0-0 <0.3.0` | DSH 0.2.2-rc.5（Desktop） |
| conversation-notebook | 1.0.3 | `>=0.2.0-0 <0.3.0` | DSH 0.2.2-rc.5（Desktop） |
| dsh-tweaks | 2.0.0 | `>=0.2.0-0 <0.3.0` | DSH 0.2.2-rc.5（Desktop） |
| dsh-compaction-prompts | 2.2.0 | `>=0.2.2-rc.5 <0.3.0` | DSH 0.2.2-rc.5（Desktop） |
| workspace-session-migration | 1.0.1 | `>=0.2.2-rc.5 <0.3.0` | DSH 0.2.2-rc.5（Desktop） |

`-0` 让范围包含 0.2.x 的预发布版本。这个范围表示「面向 0.2 系列」，`<0.3.0` 用于挡住未验证的大版本：升级 DSH 到 0.3 之后需要先实测再放宽，否则用户会看到「不兼容」。0.2.0 的早期小版本没有逐一验证。各版本的具体变化见插件目录里的 `CHANGELOG.md`。

## 版本管理

每个插件只有一个版本号：`package.json` 的 `version`，遵循 SemVer。DSH 的插件页、索引和迁移判断都读它；同一个版本号不能对应两份不同的代码。

本机自用副本与仓库是分开的两份：仓库是发布快照，本机 DSH 从自己的插件目录（`created-plugins/` 或独立工作目录）加载插件。日常修改发生在本机副本，提取到仓库时再合并、升版本；`deploy.mjs` 只用于把发布快照复制到本机，不能反过来当成本机更新的来源。

改了插件目录就必须升版本——包括 README、locale、图标和 `package.json` 元数据——并在同一个提交里给该目录的 `CHANGELOG.md` 增加一条记录：

```powershell
node scripts/version.mjs bump dsh-token-usage patch --note "修复……"
node scripts/version.mjs check          # 检查版本、变更记录与已发布版本
```

级别按影响选择：

- **major**：配置结构、包名、patch 行 id、`engines.dsh` 下限、数据格式或工具参数变化，旧用法会坏；
- **minor**：新增用户可见的能力或选项，且保持向后兼容；
- **patch**：修 bug、文案、样式、图标、文档和元数据整理。

新插件从 `1.0.0` 开始，预发布用 `1.0.0-rc.1`，正式发布时去掉后缀。`scripts/build-index.mjs` 在写索引前会拒绝「插件目录变了但版本没升」「版本低于已发布版本」「当前版本没有 CHANGELOG 条目」三种情况；`docs/index.json` 会保留旧版本及其固定 commit 与发布时间，方便对比或安装旧版。已发布的版本号不复用、不覆盖、不删除。

## 仓库结构

```text
.
├── dsh-token-usage/           # 插件 A：host 路由 + 浏览器侧栏入口 + 单文件页面
├── conversation-notebook/     # 插件 B：Connection 路由 + 磁盘存储 + 右侧栏页签
├── dsh-tweaks/                # 插件 C：DSH 界面小改动合集（插件目录、会话未读标记）
├── dsh-compaction-prompts/    # 插件 D：压缩提示词全局选择、官方快照与自定义提示词
├── workspace-session-migration/ # 插件 E：工作区之间复制并移除会话（Host 工具）
├── scripts/
│   ├── deploy.mjs             # 复制插件到当前 profile 的 created-plugins（--only / --all）
│   ├── plugins.mjs            # 参与索引的插件目录与分类
│   ├── version.mjs            # 版本递增、变更记录与发布前检查
│   └── build-index.mjs        # 生成并校验 docs/index.json（DSH 插件索引）
├── docs/                      # GitHub Pages 发布目录：落地页 + 索引 + icons/
├── catalog/                   # 提交到社区目录 awesome-dsh-plugin 的条目草稿
├── package.json               # 仓库工具：只装索引校验器的开发依赖
└── AGENTS.md                  # 给在本仓库工作的 Agent 的说明
```

## 开发与测试

需要 Node.js 24+（DSH 桌面版自带运行时）。

```powershell
node --test dsh-token-usage/*.test.mjs          # 统计口径与服务接口
cd conversation-notebook
node build.mjs                                  # 改 src/ 后必须重建 dist/
node --test tests/*.test.mjs
node --test dsh-tweaks/tests/*.test.mjs # 界面微调
node --test dsh-compaction-prompts/tests/*.test.mjs # 压缩提示词（需 DSH 运行环境变量）
node --test workspace-session-migration/tests/*.test.mjs # 会话迁移
```

`conversation-notebook` 的 `dist/` 是提交进仓库的构建产物：按目录安装和 git 安装都直接使用它，不依赖安装时的构建。

`dsh-compaction-prompts` 的清单与客户端测试可用普通 Node 运行；后端集成测试（官方提示词捕获、Connection 路由、真实 HTTP）需要打包 DSH 的 Electron Node 运行环境，并设置 `ELECTRON_RUN_AS_NODE=1` 与 `DSH_INSTALL_DIR`。

## 索引与分发

索引指向本仓库的**固定 commit**。索引由脚本生成，字段全部从包自身读取（`name`、`version`、`engines.dsh`、locale 文案、图标），因此不会与代码漂移。

```powershell
npm install                              # 只装索引校验器（开发依赖，不用于分发）
node scripts/build-index.mjs             # 提交后运行：固定每个插件最后一次变更的 commit
node scripts/build-index.mjs --check     # 只验证 docs/index.json 是否最新
```

更新索引的顺序：

1. 改包、按[版本管理](#版本管理)升版本并写 `CHANGELOG.md`，跑测试（必要时 `node build.mjs`）。
2. 跑 `node scripts/version.mjs check`，确认版本高于已发布版本且变更记录存在。
3. **提交**插件目录的改动——索引固定的是 commit，不是分支头。
4. `node scripts/build-index.mjs`：脚本会先检查插件目录有没有未提交的改动、版本有没有升，有问题就直接报错。
5. 提交 `docs/index.json` 并 push。jsDelivr 对 `@main` 有缓存，推送后可能要几分钟才生效。

## 许可

[MIT](LICENSE)。图标为本仓库原创 SVG。
