# Personal DSH Plugins

[Kazuma-124](https://github.com/Kazuma-124) 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件仓库：每个插件都是可独立安装的**组合包**（bundle），仓库同时发布一个 **DSH 插件索引**，方便在应用的「发现」页里浏览、安装和更新。

**English.** Two installable DeepSeek Harness bundles — token usage statistics and a per-conversation notebook. Both are plain JavaScript, have no third-party runtime dependencies, never call a model and never upload data. Not published to npm: clone the repo and install a directory, or add the plugin index (`https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/site/index.json`) in **Plugins → Discover**. See [Install](#install) and [what DSH actually validates](#what-dsh-actually-validates).

| 插件 | 作用 | 出现位置 | 仓库目录 |
|:--|:--|:--|:--|
| [dsh-token-usage](dsh-token-usage/README.md) | 按对话与项目汇总 token 用量，带趋势图 | 左侧栏「Token 用量」 | [`dsh-token-usage/`](dsh-token-usage) |
| [conversation-notebook](conversation-notebook/README.md) | 每个对话一份独立纯文本笔记，保存到本机磁盘 | 右侧栏入口页「对话记事本」 | [`conversation-notebook/`](conversation-notebook) |

两个插件都只在本机工作：不调用模型、不读对话正文、不上传任何数据、不创建定时任务。

## 安装

目前**没有发布到 npm**，分发方式是「克隆仓库 + 按目录安装」，或通过插件索引安装（索引条目指向本仓库的固定 commit，需要本机有 `git`）。

### 方式一：插件索引（在 DSH 里浏览、安装）

1. 打开 **插件**，在**实验性插件**里开启**自定义插件索引**（DSH 默认不启用「发现」页，也不自带任何索引源）。
2. 切到 **发现** → **添加索引源**，填入：

   ```text
   https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/site/index.json
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

桌面版和 `dsh web` 都可以这样装。也可以走命令行（`<profile>` 换成实际的 profile 名）：

```sh
dsh plugin --profile <profile> add ./Personal_DSH_Plugins/dsh-token-usage
dsh plugin --profile <profile> add ./Personal_DSH_Plugins/conversation-notebook
```

按目录 / 本地路径安装是 pnpm 的 `link`，不执行任何构建脚本，也不需要放行 `allowBuilds`。注意 `conversation-notebook` 的 `dist/` 已经在仓库里构建好；改 `src/` 之后要自己跑一次 `node build.mjs`。

### 方式三：复制到 profile 的插件目录（仓库开发者自用）

`scripts/deploy.mjs` 把两个插件复制到当前 profile 的默认插件目录 `<profile>/created-plugins`，复制目标目录名保持不变（`dsh-token-usage`、`e1727a2d-8dfb-4483-8fd4-2a5078b2229e`），因此改包名不影响本机已安装的条目。

```powershell
node scripts/deploy.mjs   # 需要 DSH_PROFILE_DIR，DSH 会话的 shell 里已有
```

之后按插件 README 的说明刷新页面或重启 DSH。

## 怎么找到这个仓库

- **GitHub 仓库的 About**：description 与 topics（`dsh-plugin`、`deepseek-harness`、`dsh`）——GitHub 搜索和社区目录都读它。
- **[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)**：条目草稿在 [`catalog/`](catalog/README.md)。这个目录同时喂给 dsh-market 插件、[dshmarket.com](https://dshmarket.com) 和 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)，并发布成一份 format-1 索引，所以进目录 = 同时进市场、网站和别人「发现」页里的那个源。
- **本仓库的插件索引**：`https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/site/index.json`，由 [`scripts/build-index.mjs`](scripts/build-index.mjs) 从包字段生成，DSH「发现」页可直接添加。
- **落地页**：<https://kazuma-124.github.io/Personal_DSH_Plugins/>（GitHub Pages，给搜索引擎看的静态页）。同一目录也提供备用索引源 `https://kazuma-124.github.io/Personal_DSH_Plugins/index.json`，`github.io` 在部分网络下较慢，所以默认仍用 jsDelivr。
- 页面正文（本 README 与两个插件 README）里的名词、安装命令、能力描述，是普通搜索引擎唯一能抓到的内容，改动时别把它们删掉。

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

`conversation-notebook` 的 `dist/` 是提交进仓库的构建产物：按目录安装和 git 安装都直接使用它，不依赖安装时的构建。

## 发布与索引

分发不经过 npm，索引指向本仓库的**固定 commit**。索引由脚本生成，字段全部从包自身读取（`name`、`version`、`engines.dsh`、locale 文案、图标），因此不会与代码漂移。

```powershell
npm install             # 只装 @deepseek-ai/dsh-plugin-market-index 用于校验
npm run index           # 提交后运行：把 HEAD 固定进 site/index.json
npm run index:check     # 只验证 site/index.json 是否最新
```

发布一个改动的顺序：

1. 改包、跑测试（必要时 `node build.mjs`）。
2. **提交**插件目录的改动——索引固定的是 commit，不是分支头。
3. `npm run index`：脚本会先检查插件目录有没有未提交的改动，有就直接报错。
4. 提交 `site/index.json` 并 push。jsDelivr 对 `@main` 有缓存，推送后可能要几分钟才生效。

将来如果改发 npm，把 `--source npm` 传给脚本即可；不加参数时默认 `--source git`。

## 许可

[MIT](LICENSE)。图标为本仓库原创 SVG。
