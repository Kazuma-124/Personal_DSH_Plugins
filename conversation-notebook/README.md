# 对话记事本

**English.** A DSH bundle that adds a **Conversation notebook** entry to the right sidebar: one plain-text note per conversation, saved to the DSH host's disk through authenticated owner-only routes. It never reads conversation content, never calls a model, never injects context and never uploads data. Install with `dsh plugin add @kazuma-124/dsh-conversation-notebook`, or add this repository's plugin index in **Plugins → Discover**.

在对话右侧栏打开入口页（加号），选择“对话记事本”。每个对话有一份独立的纯文本笔记，新笔记从空白开始，只由用户手动编辑。输入后自动保存到 DSH 所在设备的磁盘；显示“已保存到磁盘”后，关闭侧栏、刷新、重启或清除浏览器数据都不会删除笔记。

笔记不读取对话正文，不调用模型，不注入模型上下文，不提供代理读写工具。数据通过 DSH 已认证且仅允许 owner 的 Connection API 读写，不使用公开 HTTP 路由。桌面端和 Web 端连接同一 DSH 后端时使用同一份磁盘笔记。

## 安装

| 方式 | 命令 / 操作 |
|:--|:--|
| 插件索引 | **插件** → 开启实验性「自定义插件索引」→ **发现** → 添加索引源 `https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/site/index.json` |
| npm | `dsh plugin --profile <profile> add @kazuma-124/dsh-conversation-notebook`（桌面版用 **插件 → 添加插件**） |
| 本地目录 | 仓库根运行 `node scripts/deploy.mjs`，再在 **插件 → 添加插件** 里选择 `created-plugins/e1727a2d-8dfb-4483-8fd4-2a5078b2229e` |

npm 上是预构建产物（`dist/` 已随包发布），安装不会执行构建脚本，也不需要放行 `allowBuilds`。

## 兼容性

`engines.dsh` 为 `>=0.2.0-0 <0.3.0`：面向 DSH 0.2 系列（含其预发布版本），实测于 0.2.2-rc.5 桌面版。依赖 `sidebar.right.pane.tab` 槽位与已认证的 Connection 路由；DSH 0.3 需要先实测再放宽。

## 保存位置与备份

默认数据目录为 `~/.dsh/conversation-notebook/`（若 Host 设置 `DSH_HOME`，则位于 `$DSH_HOME/conversation-notebook/`），独立于插件安装目录和对话日志目录：

```text
conversation-notebook/
  notes/<对话ID的SHA-256>.json
  legacy-backups/<对话ID和旧文本的SHA-256>.json
```

每份 JSON 包含版本、原始对话 ID、笔记文本、修订号和更新时间。数据不会随对话归档、关闭侧栏或卸载插件而删除，更新插件也不覆盖数据目录。备份或迁移时应同时保存该目录与 DSH 对话数据；只复制对话日志不包括笔记。文本以本机文件保存，不提供加密。

写入使用同目录临时文件、文件同步和原子重命名。服务端按对话串行处理请求，并检查客户端修订号，拒绝旧窗口覆盖新版本。读取失败时禁止编辑，保存失败时保留当前页面草稿并提供重试。多个窗口发生冲突时先复制当前草稿，再选择“加载最新版本”。

## 旧版浏览器笔记迁移

新版浏览器插件激活时，会自动扫描本插件旧的 localStorage 命名空间，逐份迁移所有旧笔记，包含未打开和已归档对话的笔记，无需逐个打开对话。浏览器原值保留，不自动删除。若磁盘已有不同文本，当前磁盘版本保持不变，浏览器版本另存到 `legacy-backups/`，因此不会互相覆盖。

**升级后需重启一次 DSH，再打开原来保存笔记的桌面窗口或浏览器页面。打开记事本，等待读取结束，并确认没有“正在迁移旧笔记”“部分旧笔记尚未迁移”或“无法访问浏览器旧数据”的提示，才可清除旧浏览器数据。** 来自其他浏览器或其他来源地址的旧笔记，需要在相应原环境中运行新版插件才能迁移。已被清除的旧浏览器数据无法恢复。

后端不可用或当前对话的旧笔记迁移失败时会阻止编辑并提示重试，避免创建空笔记覆盖已有数据。单份迁移失败不会中止其他笔记的迁移或使用，界面会显示全局迁移警告。浏览器禁止访问 localStorage 时，新版仍可直接使用磁盘笔记，但无法读取该浏览器的旧笔记。

## 使用与限制

1. 打开任意对话的右侧栏，在入口页（加号）选择“对话记事本”。
2. 输入内容，等待状态从“正在保存…”变为“已保存到磁盘”。未完成保存时关闭页面会触发浏览器离开提示（取决于浏览器支持）。
3. 再次打开同一对话继续编辑；切换对话则打开另一份笔记。

单份笔记文本上限为 16 MiB（UTF-8），兼容旧浏览器配额内的长笔记。本插件不提供跨设备同步。版本检查和本地文件锁用于多个窗口及本机多个 DSH 进程。活锁不会按时间强行删除；确认进程已退出的锁可自动回收，损坏锁和残留恢复锁则保守报错，避免冒险覆盖数据。请将数据目录放在本地磁盘。保存失败的草稿仅保留在当前页面，重试成功前请不要关闭页面。插件卸载时清理自身入口、标签和监听，不删除磁盘笔记。

## 构建、测试与部署

- 构建：`node build.mjs`。输出独立的 `dist/client.js`、`dist/index.js` 和 `dist/disk-store.js`，无第三方依赖。
- 测试：`node --test tests/*.test.mjs`（使用 DSH 自带 Node/Electron Node 运行时）。覆盖真实文件持久化、空文本、损坏文件保护、原子写入失败、并发修订检查、旧笔记与冲突备份迁移、异步草稿和失败重试、Host 路由及独立打包。
- 部署：仅同步本插件到当前 profile 的 `created-plugins/e1727a2d-8dfb-4483-8fd4-2a5078b2229e`；后端代码变更必须重启 DSH，页面刷新不足以加载新后端。
- 无浏览器控制时，测试结果不代表真实桌面渲染与升级迁移已经人工验收。

## 许可

[MIT](../LICENSE)。图标为本包原创 SVG。
