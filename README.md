# 竞品博客监测

这是一个基于 GitHub Actions + Playwright 的竞品博客日报项目。

目标是每天自动检查指定竞品站点过去 24 小时内发布或更新的文章，并把结果发送到钉钉群。

## 当前监控站点

- https://www.litmedia.ai/resource/
- https://www.mindvideo.ai/blog/
- https://www.topview.ai/blog
- https://www.datacamp.com/blog
- https://wavespeed.ai/blog/
- https://www.weshop.ai/blog/
- https://www.atlascloud.ai/blog
- https://www.topmediai.com/video-tips
- https://www.jxp.com/blog

## 规则

1. 报告过去 24 小时内发布或更新的文章
2. 如果昨天已经报过，今天不重复报
3. 每天北京时间早上 9 点自动执行
4. 即使本地电脑睡眠，也不影响运行

## 运行方式

项目通过 GitHub Actions 在云端运行，不依赖本地电脑常驻。

工作流文件：

- `.github/workflows/competitor-blog-report.yml`

主脚本：

- `monitor-browser.mjs`

状态文件：

- `data/state-browser.json`

最新日报：

- `data/browser-report-latest.md`

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

如果只想本地生成报告，不发钉钉，可以设置：

```bash
DRY_RUN_DINGTALK=1
```

## 说明

本项目当前不纳入正式监控的站点：

- `Imagine.art`
- `InVideo`
- `Pollo AI`
