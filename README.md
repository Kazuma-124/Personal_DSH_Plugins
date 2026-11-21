# Personal DSH Plugins

[Kazuma-124](https://github.com/Kazuma-124) 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件仓库：每个插件都是可独立安装的**组合包**（bundle），仓库同时发布一个 **DSH 插件索引**，方便在应用的「发现」页里浏览、安装和更新。

**English.** Two installable DeepSeek Harness bundles — token usage statistics and a per-conversation notebook. Both are plain JavaScript, have no third-party runtime dependencies, never call a model and never upload data. Install them from the plugin index (`https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/site/index.json`) or with `dsh plugin add`. See [Install](#install) and [what DSH actually validates](#what-dsh-actually-validates).

| 插件 | 作用 | 出现位置 | npm 包 |
|:--|:--|:--|:--|
| [dsh-token-usage](dsh-token-usage/README.md) | 按对话与项目汇总 token 用量，带趋势图 | 左侧栏「Token 用量」 | `@kazuma-124/dsh-token-usage` |
| [conversation-notebook](conversation-notebook/README.md) | 每个对话一份独立纯文本笔记，保存到本机磁盘 | 右侧栏入口页「对话记事本」 | `@kazuma-124/dsh-conversation-notebook` |

两个插件都只在本机工作：不调用模型、不读对话正文、不上传任何数据、不创建定时任务。

## 安装

### 方式一：插件索引（推荐，能在 DSH 里浏览和更新）

1. 打开 **插件**，在**实验性插件**里开启**自定义插件索引**（DSH 默认不启用「发现」页，也不自带任何索引源）。
2. 切到 **发现** → **添加索引源**，填入：

   ```text
   https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/site/index.json
   ```

3. 选中条目，确认来源后安装。

索引是第三方内容：DSH 校验文件格式，但标题、作者和来源由索引声明，安装前请在确认框里核对来源。

### 方式二：直接按包名安装（npm，预构建产物）

```sh
dsh plugin --profile <profile> add @kazuma-124/dsh-token-usage
dsh plugin --profile <profile> add @kazuma-124/dsh-conversation-notebook
```

npm 上是发布时构建好的产物，安装过程不会执行本仓库的构建脚本，也不需要放行 `allowBuilds`。桌面版 App 请改用 **插件 → 添加插件** 搜索包名，`dsh plugin --profile web` 只会装进 `profiles/web`，桌面版看不到。

### 方式三：本地目录（仓库开发者用）

`scripts/deploy.mjs` 把两个插件复制到当前 profile 的默认插件目录 `<profile>/created-plugins`，复制目标目录名保持不变（`dsh-token-usage`、`e1727a2d-8dfb-4483-8fd4-2a5078b2229e`），因此改包名不影响本机已安装的条目。

```powershell
node scripts/deploy.mjs   # 需要 DSH_PROFILE_DIR，DSH 会话的 shell 里已有
```

之后按插件 README 的说明刷新页面或重启 DSH。

## DSH 实际会校验什么

区分**硬性**（DSH 会拒绝安装或禁用插件行）与**软性**（只影响展示，不阻止安装）。这是别人（或别人的 Agent）判断「这个插件能不能用在当前版本上」的依据，也是本仓库补字段的依据。

| 字段 | 强制程度 | 不满足时会发生什么 | 本仓库做法 |
|:--|:--|:--|:--|
| `dsh.bundle.patch` | **硬性** | 包能装进去，但只作为普通依赖，**不会插入任何插件行** | 两个包都声明 |
| `engines.dsh`（或 `@deepseek-ai/dsh*` peer） | **硬性** | 不匹配时安装被拒（需按 `name@version` 显式豁免）；已装的行在启动时被自动禁用并打警告 | 两包都声明 `>=0.2.0-0 <0.3.0` |
| patch 里的 `name` 能被 profile 解析 | **硬性** | 该行加载失败 | patch 与包名一致 |
| `meta.title` / `meta.description` | 软性 | 回退 `package.json` 的 `name` / `description`，卡片和详情页显示粗糙 | 中英 locale 都写了 |
| `icon` | 软性 | 用面板默认占位图；超过 256 KiB 或格式不是 SVG/PNG/JPEG/WebP 会报诊断 | 各有原创 SVG |
| `files` | 仅发布时 | 只影响 `npm pack` / `npm publish` 的产物；**本地目录安装是 link，不按 `files` 过滤** | 只列运行时文件 |
| `license` / `repository` / `homepage` / `bugs` | 软性 | DSH 不读；只影响 npm 页、目录站，以及 Discover 详情页从仓库默认分支读 README | 已补齐 |
| `keywords` | 软性 | 不参与安装；索引搜索对关键词的匹配权重是 2 倍 | 已补齐 |
| `private: true` | 仅 npm | 阻止 `npm publish`，与 DSH 安装无关 | 已移除 |
| `author` | 软性 | 卡片与详情页作者为空 | 已补齐 |

`engines.dsh` 是全有或全无的：声明了它就**只**看它，`@deepseek-ai/dsh*` peer 不再参与判断；没有声明时才逐个检查 peer；两者都没有则该包被视为**任意版本都兼容**。所以不要把 peer 依赖当作「顺便声明的版本约束」——那会变成硬门槛。

## 兼容性

| 插件 | 版本 | `engines.dsh` | 实测环境 |
|:--|:--|:--|:--|
| dsh-token-usage | 1.0.0 | `>=0.2.0-0 <0.3.0` | DSH 0.2.2-rc.5（Desktop） |
| conversation-notebook | 1.0.0 | `>=0.2.0-0 <0.3.0` | DSH 0.2.2-rc.5（Desktop） |

`-0` 让范围包含 0.2.x 的预发布版本。这个范围表示「面向 0.2 系列」，`<0.3.0` 用于挡住未验证的大版本：升级 DSH 到 0.3 之后需要先实测再放宽，否则用户会看到「不兼容」。0.2.0 的早期小版本没有逐一验证。

## 仓库结构

```text
.
├── dsh-token-usage/           # 插件 A：host 路由 + 浏览器侧栏入口 + 单文件页面
├── conversation-notebook/     # 插件 B：Connection 路由 + 磁盘存储 + 右侧栏页签
├── scripts/
│   ├── deploy.mjs             # 复制两个插件到当前 profile 的 created-plugins
│   └── build-index.mjs        # 生成并校验 site/index.json（DSH 插件索引）
├── site/                      # 索引发布目录：index.json + icons/
├── catalog/                   # 提交到社区目录 awesome-dsh-plugin 的条目草稿
├── package.json               # 仓库工具：只装索引校验器，不发 npm
└── AGENTS.md                  # 给在本仓库工作的 Agent 的说明
```

## 开发与测试

需要 Node.js 24+（DSH 桌面版自带运行时）。

```powershell
node --test dsh-token-usage/*.test.mjs          # 统计口径与服务接口
cd conversation-notebook
node build.mjs                                  # 改 src/ 后必须重建 dist/
node --test tests/*.test.mjs
```

`conversation-notebook` 的 `dist/` 是提交进仓库的构建产物：npm 包和 git 安装都直接使用它，不依赖安装时的构建。

## 发布与索引

索引由脚本生成，字段全部从包自身读取（`name`、`version`、`engines.dsh`、locale 文案、图标），因此不会与已发布的包漂移。

```powershell
npm install                 # 只装 @deepseek-ai/dsh-plugin-market-index 用于校验
npm run index               # 写 site/index.json（npm 源）
npm run index:check         # CI 用：文件是否与包一致
node scripts/build-index.mjs --source git   # 不想发 npm 时，改用本仓库固定 commit
```

发布新版本的顺序：改包并提交 → `npm publish` → `npm run index` → 提交 `site/`。索引里写的是 `name@version`，版本没发到 npm 之前，索引条目装了会失败。

## 许可

[MIT](LICENSE)。图标为本仓库原创 SVG。
