# 竞品博客监测

这是一个基于 GitHub Actions + Playwright 的竞品博客日报项目。

目标是每天自动检查指定竞品站点过去 24 小时内发布或更新的文章，并把结果发送到钉钉群。

另外，项目也支持一套独立的“模板/玩法页监测日报”，用于跟踪模板库、效果页、产品玩法页的新增页面。

如果你现在更想盯“新功能 / 新工具页”，项目里也已经准备了一套独立的功能页监控。

## 当前监控站点

- https://www.litmedia.ai/resource/
- https://www.mindvideo.ai/blog/
- https://www.topview.ai/blog
- https://www.datacamp.com/blog
- https://wavespeed.ai/blog/
- https://www.weshop.ai/blog/
- https://www.atlascloud.ai/blog
- https://www.topmediai.com/video-tips
- https://pollo.ai/hub/
- https://www.jxp.com/blog

## 模板/玩法页监控站点

- https://magichour.ai/products/
- https://viddo.ai/video-effects
- https://deevid.ai/
- https://a2e.ai/
- https://kling.ai/
- https://invideo.io/
- https://higgsfield.ai/

## 功能/工具页监控站点

- Higgsfield
- Pollo AI
- LibTV
- Flova AI
- Deevid AI
- Topview AI
- Yapper
- Artlist

## 规则

1. 报告过去 24 小时内发布或更新的文章
2. 如果昨天已经报过，今天不重复报
3. 每天北京时间早上 9 点自动执行
4. 即使本地电脑睡眠，也不影响运行

## 运行方式

项目通过 GitHub Actions 在云端运行，不依赖本地电脑常驻。

工作流文件：

- `.github/workflows/competitor-blog-report.yml`
- `.github/workflows/competitor-showcase-report.yml`
- `.github/workflows/competitor-feature-report.yml`

主脚本：

- `monitor-browser.mjs`
- `monitor-showcase-browser.mjs`
- `monitor-feature-browser.mjs`

状态文件：

- `data/state-browser.json`
- `data/showcase-state.json`
- `data/feature-state.json`

最新日报：

- `data/browser-report-latest.md`
- `data/showcase-report-latest.md`
- `data/feature-report-latest.md`

## GitHub 需要配置的 Secrets

在仓库 `Settings` -> `Secrets and variables` -> `Actions` 里添加：

- `DINGTALK_WEBHOOK`
- `DINGTALK_SECRET`

## 本地调试

安装依赖：

```bash
npm install
```

运行：

```bash
npm run run:cloud
```

模板/玩法页日报：

```bash
npm run run:showcase
```

功能/工具页日报：

```bash
npm run run:feature
```

功能/工具页日报只展示有新增页面的竞品；没有新增的竞品不会出现在日报正文里。

如果只想本地生成报告，不发钉钉，可以设置：

```bash
DRY_RUN_DINGTALK=1
```

## 说明

本项目当前不纳入正式监控的站点：

- `Imagine.art`
- `InVideo`
