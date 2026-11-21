# DSH Token 用量统计

**English.** A DSH bundle that adds a **Token usage** entry to the left sidebar: totals, a per-project table and a trend chart, computed from local session logs. It never calls a model, never writes back to a conversation or log, and never uploads data. Not published to npm: clone the repository and add this directory in **Plugins → Add plugin**, or add this repository's plugin index in **Plugins → Discover**.

独立 DSH 插件，读取本地对话日志和项目目录数据，用普通 JavaScript 计算用量。统计、刷新、聚合与绘图不调用模型，不创建对话或定时任务，因此不产生额外模型 token 消耗。

## 安装

| 方式 | 命令 / 操作 |
|:--|:--|
| 插件索引 | **插件** → 开启实验性「自定义插件索引」→ **发现** → 添加索引源 `https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/site/index.json` |
| 克隆仓库 | `git clone https://github.com/Kazuma-124/Personal_DSH_Plugins.git`，再在 **插件 → 添加插件** 里选 `Personal_DSH_Plugins/dsh-token-usage` |
| 本地目录 | 仓库根运行 `node scripts/deploy.mjs`，再把 `created-plugins/dsh-token-usage/index.mjs` 以 `file://` 行插入 profile 的 `cordis.patch.yml` |

暂未发布到 npm。按目录安装是 pnpm 的 `link`，不执行构建脚本，也不需要放行 `allowBuilds`。

## 使用

启用插件后，刷新现有 DSH 页面，左侧出现 **Token 用量**。也可以直接在浏览器打开当前 DSH 服务地址下的 `/token-usage`；地址每次启动可能不同，以会话中的 DSH Web GUI URL 为准。

- 全局总量只对原始消费事件汇总一次；父项目与子项目的汇总行不能相加当作全局总量。
- 项目表分别展示自身用量和包含全部子项目的用量。DSH 当前项目没有原生父级字段时，以已登记项目的目录路径确定最近父项目（按目录边界比较）。
- 对话当前属于哪个项目，其历史用量就归哪个项目；移动对话后自动跟随。子代理归属顶层对话的项目，普通分叉作为独立对话。
- 支持项目、是否含子项目、日期范围和小时/天粒度筛选。趋势图默认显示**每期新增**，可切换到累计曲线；累计从所选范围的起点开始。
- 显示会话汇总和带时间的用量明细。时间是模型用量记录的结算时间，不伪造提问时间；缺失时间的记录保留在不限日期总量中，并提示无法放入曲线。
- 页面打开时每 30 秒刷新，可暂停或手动刷新。关闭页面即停止轮询，不运行模型统计任务。

## 用量口径

总 token = 未缓存输入 + 输出 + 缓存读取 + 缓存写入。四项互斥；输出已包括 reasoning token，不重复增加推理 token。不是金额，也不估算不同供应商的费用。

读取最新有效日志版本；排除分叉继承的历史；同一次模型调用的流式样本与最终消息替换合并，避免重复统计。实际重试的独立消费保留。已归档的对话仍统计，已删除且无本地日志的消费无法恢复。损坏或无法读取的记录会显示警告。

数据只读取本机 DSH 数据目录，默认 `~/.dsh`；不写回对话、项目或日志，不上传。插件页面与 API 仅允许本机回环地址访问，不要求另行登录；写入接口不可用，跨源请求被拒绝。DSH 原有页面及 API 的认证配置不变。可在插件 config 中设置 `dataDir` 更换数据根目录。

## 兼容性

`engines.dsh` 为 `>=0.2.0-0 <0.3.0`：面向 DSH 0.2 系列（含其预发布版本），实测于 0.2.2-rc.5 桌面版。0.2.0 的早期小版本未逐一验证；DSH 0.3 需要先实测再放宽，否则安装会被拒绝。

## 开发与验证

Node.js 24+（本机桌面 DSH 自带运行时）。无需 npm 依赖或编译。

运行 `node --test *.test.mjs` 验证统计与服务接口。

源码：`index.mjs` 为 Cordis host 插件，`collector.mjs` 为日志收集器，`client.js` 注册 DSH 导航入口，`dashboard.html` 为无外部依赖的页面。包通过 `dsh.bundle.patch` 声明插件，通过 `dsh.client` 声明浏览器模块，通过 `locale/*.json` 提供插件页面的中英文标题与说明。

## 许可

[MIT](../LICENSE)。图标为本包原创 SVG。
