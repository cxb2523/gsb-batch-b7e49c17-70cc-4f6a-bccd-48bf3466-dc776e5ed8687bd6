# 贡献指南

先谢谢你。这个项目一半的乐趣来自「城市看起来怎么样」，所以任何让城市更好看、更快、更准确的意见都欢迎。

## 提之前先看一眼

| 想改的东西 | 改哪里 |
| --- | --- |
| 视觉、交互、性能 | 这个仓库，直接提 PR |
| 名单本身（加/删博客、改 RSS） | 上游 [`timqian/chinese-independent-blogs`](https://github.com/timqian/chinese-independent-blogs)，一小时后自动生效 |
| 活跃度、失效判定 | 上游的状态接口，本仓库只消费它 |

**不要在本仓库手改 `src/data/blogs.json` 或 `data/health.json`** —— 它们是生成物，下次构建会被覆盖。

## 开发环境

```bash
node -v            # 需要 22+
npm install
npm run dev        # http://localhost:3210
```

本地默认读同级的 `chinese-independent-blogs` 克隆；没有克隆也能跑，会自动走 jsDelivr 镜像。

## 提交规范

用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>
```

`type`：`feat` / `fix` / `perf` / `refactor` / `docs` / `chore` / `ci`
`scope`：`city` / `data` / `ui` / `layout`

标题一行说清做了什么，正文说为什么。一个提交一件事。

```
feat(city): add a downtown roundabout and a pixel sign
fix(ui): restore the stylesheet the modal cleanup mangled
```

## PR 检查清单

- [ ] `npx tsc --noEmit` 无报错
- [ ] `npm run build` 通过
- [ ] 动了界面：附一张改动前后的截图（`docs/` 里已有两张可以对照）
- [ ] 动了场景：说明对帧率/draw call 的影响
- [ ] 没有提交 `node_modules`、`dist`、`.wrangler`、任何 `.log`
- [ ] 没有手改生成的数据文件

## 关于性能

这个项目对性能比较敏感，因为整座城是一屏几百栋楼 + 全屏天空着色器。两条底线：

1. **全屏 shader 里不要用 `sin()` 当哈希** —— 集显会直接跪；
2. **新增的可见物体尽量走 InstancedMesh**，别一个物体一个 `mesh`。

改完如果帧率掉了，宁可不加。

## 关于风格

- TypeScript `strict` 开着，不要 `any` 糊过去；
- 组件保持「一个文件一个职责」，别把 three.js 逻辑塞进 UI 组件；
- 注释写「为什么」，不写「是什么」——代码已经说了是什么。

## 行为准则

参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
