# Catalog submissions

这两个文件是提交给 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的条目草稿。该目录是 dsh-market（插件市场插件，月下载百万级）、[dshmarket.com](https://dshmarket.com) 和 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 的数据源，也是 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json` 这个 format-1 索引的内容来源。

## 怎么提交

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`。
2. 把这里的每个 `*.yml` **按原文件名**复制到上游的 `data/plugins/` 下（文件名规则 `owner__repo--subdir.yml`，monorepo 子包就是这种形态）。
3. 一个 PR 最多 3 条；monorepo 的多子包正是这个额度存在的原因，所以两个插件可以放同一个 PR。
4. 不要手工改 README：上游的 README 由 `data/plugins/*.yml` 生成。

## 上游的硬门槛（逐条对过）

| 要求 | 本仓库状态 |
|:--|:--|
| `package.json` 声明 `dsh.bundle`（只声明 `dsh.client` 不算可安装） | ✅ 两个子包都声明 |
| 仓库有真实可用代码 | ✅ |
| 仓库创建满 1 天 | ⏳ 建于 2026-11-20，2026-11-21 之后达标 |
| 仓库带 `dsh-plugin` topic | ⏳ 尚未设置，需要在 GitHub 仓库设置里加 |
| 描述只讲功能、不夸大、以句号结尾 | ✅ 每条都已核对 |
| 分类贴合实际功能 | ✅ `usage` / `ui` |

## 可选增强

- `icon`：卡片图标只接受 GitHub 托管的**位图**（PNG/JPEG），SVG 不行；不写则回退到作者头像。需要时在仓库里放一张 `icon-180.png` 再填 URL。
- `screenshots.json`：放在 `package.json` 旁边（monorepo 条目放子目录里），列 1–8 张图片路径，dsh-market 详情页会以 App Store 风格展示。当前仓库还没有截图。
