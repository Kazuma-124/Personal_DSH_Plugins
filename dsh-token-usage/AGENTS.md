# AGENTS.md — dsh-token-usage

给后续改这个插件的智能体看的操作手册。**先读完本文再动手**；本插件的卖点之一就是“统计不花模型 token”，改它时也别把 token 烧在探索上。

## 1. 它是什么

- 一个 DSH 个人插件：读取本机 `~/.dsh` 的会话日志，按对话/项目/子项目汇总 token 用量，并提供时间趋势页面。
- **只读、纯 JavaScript、零模型调用**：不调用 LLM，不创建会话，不跑定时任务，不写回日志或工作区。
- 构成：host 插件（Node，注册 HTTP 路由）+ 浏览器模块（侧栏入口，iframe 嵌页面）+ 单文件静态页面。
- 无第三方依赖、无构建步骤；Node 24+（用 DSH 自带运行时）。

## 2. 文件地图（源码 7 个文件，另有 locale/ 与 icon.svg）

| 文件 | 行数 | 作用 | 改动风险 |
|:--|--:|:--|:--|
| `index.mjs` | 33 | host 入口：注册 `/token-usage`、`/api/token-usage`，只允许回环地址 + 同源 | 中，改路由/鉴权要测 |
| `collector.mjs` | 279 | 扫描会话日志、去重、归属、缓存 | 高，计费正确性 |
| `dashboard.html` | 93 | 页面 + 全部 CSS/JS（**超长行**） | 低，但读取要小心 |
| `client.js` | 9 | `window.__ModuleLoader__` 注册侧栏入口与 iframe 面板 | 低 |
| `cordis.yml` | 3 | 以包名安装时的 insert 片段 | 低 |
| `package.json` | 72 | `dsh.client` / `dsh.bundle` / `engines.dsh` / 元数据与插件声明 | 中，改错加载不了 |
| `collector.test.mjs` + `host.test.mjs` | 99 + 44 | 回归测试 | — |

`verification/` 只是本地验收产物（截图、Edge profile），**不参与运行，也不进转发包**。

## 3. 编辑 dashboard.html 的正确姿势（最容易烧 token 的地方）

`dashboard.html` 只有 93 行，但第 7 行是约 4.4 KB 的单行 CSS，第 74–86 行是多条数百到数千字符的单行 JS。

- **不要** `read` 整个文件来“先了解一下”——一次就是上万字符，且看完仍要 grep 定位。
- 正确流程：`grep` 关键词拿行号 → `read` 该行 ±2 行 → `edit` 用足够短且唯一的锚点。
- 典型改动（改默认值、文案、单位）通常是 **1 次 edit + 1 次页面校验**，不需要读 collector、不需要跑全量测试。
- 页面里所有数据文本走 `textContent`，不要引入 `innerHTML` 拼接（防 XSS 是既有约束）。
- 数字格式统一在 `fmt`（科学计数法 4 位有效数字）；项目数/记录数用 `exactFmt` 普通整数。改格式就改这两个入口，别逐处替换。
- 时间统一用 `ymd`/`stamp`/`spanText` 输出 `YYYY.MM.DD`，需要小时才追加 ` HH时`；**不要**用 `Intl` 带 `timeZoneName`、`toLocaleTimeString` 之类，会冒出 `GMT+8` 和分秒。

## 4. 安装方式与生效范围（别乱猜）

- 仓库是开发源，运行时不走仓库路径。`node scripts/deploy.mjs --only dsh-token-usage` 会把本目录复制到当前 profile 的默认插件目录 `<profile>/created-plugins/dsh-token-usage`（由环境变量 `DSH_PROFILE_DIR` 决定），再按需重启 DSH。
- profile 的 `cordis.patch.yml` 只保留一条 `insert`，`name` 指向部署后的 `created-plugins/dsh-token-usage/index.mjs`（file URL）。这是唯一与本机有关的配置，不写进仓库。
- 插件目录若被移动，运行中的 DSH 仍持旧 `import.meta.url`，`/token-usage` 会 500（找不到 `dashboard.html`）：改动后必须重启 DSH，不要用复制页面文件长期兜底。
- **`dashboard.html` 每次请求现读**：改完刷新页面即生效，无需重启。
- **`index.mjs` / `collector.mjs` 是加载时求值的模块**：改完需要重载插件或重启 DSH 才生效，别声称“刷新即可”。
- 端口每次启动可能不同。**从会话的 “DSH Web GUI URL” 取，不要背旧端口。**

## 5. 验证预算（硬性）

按改动类型选**最低一级**，够了就停：

1. **纯静态/文案/默认值**：`Invoke-WebRequest http://127.0.0.1:<端口>/token-usage`，检查状态码和目标字符串。**不要开浏览器。**
2. **collector / 归属 / 去重 / 压缩帧**：`node --test *.test.mjs`（Node 24+；也可用 DSH 自带运行时，路径形如 `~/.dsh/dsh-runtimes/<runtime>/dependencies/node/bin/node.exe`），必须全绿。
3. **真实渲染 / 交互 / 图表**：才用 Edge headless，且最多 1–2 次。

Edge 已知坑（踩过就别再踩）：

- `--dump-dom` 和 `--screenshot` **不能同时传**，会 `exit 13`（"Multiple targets are not supported"）。
- 截图用 `--headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=9000`；dump 单独跑一次。
- 真实页面一律用 `--user-data-dir` 指向临时目录，避免和正在运行的 Edge 抢单例。
- 失败一次先看 stderr 再决定，**不要换 3 种写法重试同一条命令**；PowerShell 里嵌套引号先赋给变量再 `Contains($needle)`。
- 页面地址是 `/token-usage`，数据是 `/api/token-usage`，两者都只允许 127.0.0.1/::1。

## 6. 不能破坏的统计口径

这些是“数字对不对”的底线，改 collector 前必须理解：

- 总量 = `input + output + cacheRead + cacheWrite` 四个**互斥**桶；`output` 已含 reasoning，**不要**再加 `totalTokens`/`reasoningTokens`。
- 同一 turn+step 的流式样本与最终 `assistant/message` 是**替换**关系，直到 `llm/retry-started` 打破；实际重试是独立消费，要保留。
- 分叉会话会复制历史：只统计 `session/end-seed inherited` 之后的记录；没有边界就整段排除并告警，宁少不重复。
- 子代理用量归到顶层父会话的项目；普通分叉是独立会话。
- 项目归属跟随会话**当前**所在工作区；父子项目只能由已登记目录的最近祖先推导（Windows 路径不区分大小写、按目录边界）。
- 日志只读最新版本号；JSONL 尾部不完整就截断；zstd 只解**完整帧**，尾部残缺帧丢弃。
- 同一 `seq` 重复/乱序、缺口、坏行都要告警，不能静默吞掉或重复计数。

## 7. Token 纪律（写给下一个 agent）

- 一次小改动（默认值、文案、颜色）目标：**≤ 3 次工具调用、≤ 2 万字符读取**。超出就说明流程错了。
- 禁止：为改一行而通读 29 KB 的 dashboard.html；反复 read 同一文件；跑与本改动无关的测试；为验证静态字符串而启动浏览器；发现端口不通就连试多个端口（先探测当前 URL 一次）。
- 报告要短：改了什么、怎么验证的、结果如何。不要把文件内容、命令输出原样贴回对话。
- 只有涉及计费/归属/去重的改动，才值得完整跑测试并逐条核对口径。

## 8. 分发

运行时文件共 10 个：`index.mjs`、`collector.mjs`、`client.js`、`dashboard.html`、`cordis.yml`、`package.json`、`README.md`、`locale/en.json`、`locale/zh.json`、`icon.svg`。`locale/*.json` 提供插件页面的中英文标题与说明，`icon.svg` 是包内 `./icon` 导出的原创图标。

- **排除 `verification/`**（Edge profile 可能上百 MB）。
- 对方启用：复制到其 profile 的 `created-plugins/dsh-token-usage`，再在 `cordis.patch.yml` 末尾加 `insert`，`name` 写 `file:///<该目录>/index.mjs`（正斜杠；路径含空格或中文时先挪到简单路径）。
- 若按包名安装，`cordis.yml` 里的 `name` 必须等于包名（当前 `@kazuma-124/dsh-token-usage`）；`client.js` 里 `__ModuleLoader__.load({ id })` 的 id 也必须等于包名，否则浏览器模块加载失败。改包名要同时改这两处。
- 版本在 `package.json`；改动本目录后按仓库根 `AGENTS.md` 第 8 节升版本并更新 `CHANGELOG.md`，不要沿用旧版本号发布新内容。
