# AGENTS.md — Personal_DSH_Plugins

给在本仓库工作的 Agent 的操作手册。各插件目录还有自己的 `AGENTS.md`，涉及插件内部实现时以那一份为准；本文件只讲仓库级约定。

## 1. 这是什么

Kazuma-124 的个人 DSH（DeepSeek Harness）插件 monorepo。两个插件都是**可独立安装的组合包**，仓库同时维护一个**插件索引**（`site/index.json`），别人可以在 DSH 的「发现」页加这个索引来浏览和安装。

判断「某个插件能不能装到当前 DSH 上」时，不要凭印象，按 [README 的校验表](README.md#dsh-实际会校验什么) 逐项核对：

- 硬性：`dsh.bundle.patch` 存在、`engines.dsh`（或 `@deepseek-ai/dsh*` peer）与运行版本相容、patch 里的 `name` 能被 profile 解析。
- 软性：locale 文案、图标、`license`/`repository`/`homepage`/`keywords`、`files`。这些不阻止安装，只影响展示、搜索权重和发布产物。

`engines.dsh` 一旦声明就**独占**判断，peer 依赖不再参与；两者都没有则视为任意版本兼容。改这个字段等于改安装门槛：宁可先窄后宽，也不要为了「看起来兼容」而放宽到未验证的版本。

## 2. 常用命令

```powershell
node --test dsh-token-usage/*.test.mjs            # 统计口径
cd conversation-notebook; node build.mjs          # 改 src/ 后必须重建 dist/
cd conversation-notebook; node --test tests/*.test.mjs
node scripts/deploy.mjs                            # 需要 DSH_PROFILE_DIR（DSH 会话的 shell 里有）
npm run index                                      # 重新生成 site/index.json 并校验
npm run index:check                                # 只验证是否最新
```

`npm install` 只在仓库根装 `@deepseek-ai/dsh-plugin-market-index`（DSH 官方索引校验器），两个插件本身没有依赖。

## 3. 不能破坏的东西

- **包名与 patch 的一致性**：`conversation-notebook/cordis.patch.yml` 的行 id 是 `<包名>:notebook`，`dsh-token-usage/cordis.yml` 的 `name` 是包名。改包名必须同时改这两处，以及 `conversation-notebook/build.mjs` 里的包名校验。改名会让已安装的副本变成另一个 bundle，需要卸载重装。
- **部署目录名**：`scripts/deploy.mjs` 在 profile 里固定使用 `dsh-token-usage` 和 `e1727a2d-8dfb-4483-8fd4-2a5078b2229e` 两个目录名，与本仓库的包名解耦。不要为了「对齐命名」去改这两个目录，那会让用户已安装的条目变成孤儿。
- **索引与包的一致性**：`site/index.json` 是生成物，字段全部来自 `package.json`、`locale/*.json` 和 `icon.svg`。不要手改；改完包并提交后跑 `npm run index`。索引固定的是 commit，所以“先提交、再生成”的顺序不能颠倒。
- **只读与隐私边界**：两个插件都不调用模型、不上传数据。`dsh-token-usage` 只读本机 DSH 数据目录、页面与 API 只允许回环地址；`conversation-notebook` 只通过已认证的 Connection 路由读写本机磁盘。新功能不能突破这两条。
- **`conversation-notebook/dist/` 是提交物**：按目录安装和 git 安装都直接用它。改 `src/` 却忘了重建，等于发布旧代码。

## 4. Token 纪律

`dsh-token-usage/dashboard.html` 有多条数千字符的超长行，整文件读取会烧掉大量 token：先 `grep` 定位行号，再读该行 ±2 行，用短锚点 `edit`。验证按改动类型选最低一级（静态字符串 → `Invoke-WebRequest`；collector → `node --test`；真实渲染 → 最多一两次 headless Edge）。

## 5. 发布流程

**不经过 npm**。分发 = 克隆仓库按目录安装，索引固定本仓库的 commit。

1. 改包，跑对应测试，必要时 `node build.mjs`。
2. **提交插件目录**——索引固定的是 commit，未提交的改动意味着索引描述的不是它指向的代码。
3. `npm run index`（默认 `--source git`；脚本会拒绝在插件目录有未提交改动时生成）。
4. 再提交 `site/index.json` 并 push。索引走 `https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/site/index.json`，jsDelivr 对 `@main` 有缓存，推送后可能需要几分钟才生效。

提交 `site/index.json` 之后 index 里固定的 commit 会落后一个提交，这是正常的：那个 commit 里已经包含它所描述的插件代码。

将来若真的发 npm，用 `node scripts/build-index.mjs --source npm`；在那之前不要写 `source: { "type": "npm" }`，那条目装了会失败。

## 6. 索引的硬约束（改格式前先读）

DSH 的索引是 **format 1** 的单个 JSON，用 `parseMarketIndex` 校验：

- 必须能被匿名 `GET` 取到，**返回 2xx 且不经重定向**（`github.com/.../raw/...` 会 302，不能用）；UTF-8，默认上限 128 MiB。
- `metadata.categories` / `labels` / `sortKeys` 里没声明的 id，在插件上引用会直接让整个索引被拒。
- 图标可以是相对路径（相对索引 URL 解析）或 https 绝对 URL；内联 `data:` 上限 32 KiB。
- 每个版本只能有一个 `source`：`{ "type": "npm" }` 或 `{ "type": "git", "url", "commit", "path" }`（commit 为 40 位小写 SHA）。
- `engines.dsh` 要与包自身一致，安装时 DSH 会再校验一次。
