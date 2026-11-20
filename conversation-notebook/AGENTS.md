# AGENTS.md — conversation-notebook

给后续改这个插件的智能体看的操作手册。**先读完本文再动手**。

## 1. 它是什么

- DSH 右侧栏插件「对话记事本」：每个对话一份独立纯文本笔记，由用户手动维护，输入即保存。
- 与对话一一对应：键为会话 ID；不读对话正文、不调用模型、不注入上下文、不提供代理读写工具。
- 构成：Host 空壳行（`dist/index.js` 只有 `apply(){}`）+ 浏览器模块（`dist/client.js`，注册右侧栏 tab 类型、guide 入口、正文与标题槽位）。
- 无 npm 依赖；浏览器端只用宿主 `require('react')`，不 import 任何 DSH Client 包。

## 2. 文件地图

| 文件 | 作用 | 改动风险 |
|:--|:--|:--|
| `src/client.js` | 槽位组件、样式、中英文文案、注册与清理 | 中，槽位契约改错会整块空白 |
| `src/notes-store.js` | localStorage 存储层、状态机、`noteEditorState` 语义 | 高，影响草稿/失败路径 |
| `build.mjs` | 把两个源文件打包成 `dist/client.js`，并生成 `dist/index.js` | 中 |
| `src/` + `dist/` | 配置用源码；`dist/` 是实际加载产物，**改源码必须重建** | — |
| `cordis.patch.yml` / `package.json` | bundle 补丁与 `dsh.client` 声明 | 中 |
| `locale/{zh,en}.json` | 插件页标题、描述 | 低 |
| `tests/notebook.test.mjs` | 7 项回归测试 | — |

## 3. 生效范围（别乱猜）

- 仓库是开发源，运行时不走仓库路径。仓库根的 `node scripts/deploy.mjs` 会把本目录复制到当前 profile 的默认插件目录 `<profile>/created-plugins/e1727a2d-8dfb-4483-8fd4-2a5078b2229e`（由 `DSH_PROFILE_DIR` 决定），并在复制前运行 `build.mjs`。
- 首次安装：DSH「插件」页 →「添加插件」→ 选择部署后的目录；DSH 会写入 profile 的 `link:` 依赖，`node_modules/@dsh-local/...` 指向该目录。之后**改源码 + 运行部署脚本**即更新运行代码，无需重装。
- 改 `dist/` 后需刷新页面重新加载浏览器模块；Host 行为未变时通常不必重启 DSH。
- profile 里的 link 失效（目录被删或改名）时，重新运行部署脚本，并在插件页重新选择目录。
- 桌面端页面来源是稳定的 `dsh-app://app`，localStorage 跨启动保留；若通过浏览器访问 `127.0.0.1:<端口>`，存储随来源地址变化。端口每次启动可能不同，从会话的 “DSH Web GUI URL” 取。

## 4. 槽位契约（改 UI 前先核对）

- tab 类型：`ctx.sidebarRightTabs.register({ id, kind, title, guide: [{ id, order, title, description, icon }] })`；正文与标题分别注册到 keyed 槽位 `sidebar.right.pane.tab`、`sidebar.right.pane.tab.title`，key 必须是 tab 类型的 `id`。
- 注册时 `locale: NS` 才拿到注入的 `t`；代码里仍保留 `props.t ?? boundT` 兜底。
- 只使用主题令牌（`--dsw-alias-*`、`--dsw-specific-sidebar-fill`）；`--dsw-alias-border-l3` 等宿主自用令牌可用但不保证文档化。颜色不要在容器上用 `bg-layer-1`（比侧栏亮一档）。

## 5. 验证预算（硬性）

1. 纯文案/样式：`node build.mjs` + `node --test tests/*.test.mjs`（用 DSH 自带运行时：`ELECTRON_RUN_AS_NODE=1 "<DSH_NODE_EXECUTABLE>" --test ...`）。
2. 存储/状态机：必须跑测试，全绿。
3. 真实视觉：无浏览器控制时只能确认 slot occupant 为 active，**不得声称外观已验收**。

## 6. 不能破坏的行为

- 读取失败时禁止编辑，绝不能覆盖未知的已有笔记；写入失败保留页面草稿并显式提示“未保存”。
- 空字符串存取都归为 `empty`；重试先进入 `retrying` 让 `aria-live` 重播，重复点击复用同一 pending promise。
- 卸载顺序：先摘 `storage` 监听，再按 `kind` 精确关闭本插件标签（单项失败不中断），最后摘槽位、tab 类型、locale 与 store。
- 存储键 `…:v1:session:<encodeURIComponent(sessionId)>` 属于本插件命名空间，不要遍历或读取其他键。

## 7. 已知限制

- 仅本设备当前浏览器；清除浏览器数据即丢失。
- 同键多标签最后写入优先；聚焦输入也可能被其他标签的写入覆盖。
- 每次按键同步写入；长笔记未做防抖。
