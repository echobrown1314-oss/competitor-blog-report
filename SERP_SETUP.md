# Google SERP 前十每日监测

## 监测设置

| 项目 | 配置 |
|---|---|
| 关键词 | `ai video generator`、`ai image generator`、`image to video ai` |
| 市场与语言 | 美国，英语；`gl=us`、`hl=en`、`location=United States` |
| 设备 | 桌面端、移动端，分别保存和比较 |
| 排名 | 按页面顺序统计前十个不同的自然结果 URL；不包含广告、AI Overview、视频轮播、子链接 |
| 时间 | 北京时间每天 09:17；GitHub 排队时可能延后 |
| 重点网站 | `aireel.net`，未进入前十时不推断其具体名次 |
| 数据源 | SerpApi Google Search API |

这是固定搜索环境的 SERP 快照，不代表全美国所有用户看到的统一排名。关键词、设备和搜索参数位于 `serp-config.json`。修改市场、位置等搜索口径会建立新基线；不会与不同口径的旧结果比较。

## 配置 API Key

1. 登录 [SerpApi Dashboard](https://serpapi.com/dashboard)，打开 API Key 页面，复制自己的 Key。
2. 打开仓库的 [New repository secret](https://github.com/echobrown1314-oss/competitor-blog-report/settings/secrets/actions/new)。
3. Name 填 `SERPAPI_API_KEY`，Secret 粘贴 API Key，点击 **Add secret**。
4. 将本次 SERP 工作流变更合入 `main`。首次合入会触发一次采集；此后每天定时执行。
5. 如需手动执行：仓库 **Actions → Google SERP Top 10 → Run workflow → main**。

密钥只保存在 GitHub Actions Secrets 中，脚本从环境变量读取；不写入代码、配置文件、快照或日报。不需要将 Key 发送到聊天中。缺少密钥或额度不足会使运行失败并在日报中注明，不会显示为“排名无变化”。

## 查看结果

- 中文最新日报：[`data/serp/latest.md`](data/serp/latest.md)
- Excel 可打开的最新 CSV：[`data/serp/latest.csv`](data/serp/latest.csv)
- 每日历史日报和 CSV：`data/serp/reports/YYYY-MM-DD.md`、`.csv`
- 每日结构化快照：`data/serp/snapshots/YYYY-MM-DD.json`
- 同时可在 Actions 单次运行的 Summary 查看日报，在 Artifacts 下载数据备份（保留 90 天）。

首次运行前这些数据文件尚不存在。Git 仓库中的历史快照长期保留；当前仓库为公开仓库，因此代码及提交的排名报告可公开查看。这个工作流不自动发送钉钉或邮件。

## 每日对比规则

1. 第一天只建立基线，不将所有结果误标为“新进入”。
2. 每个关键词、每种设备单独比较。每日只与昨天同一查询口径的有效前十比较。
3. 输出上升/下降位数、持平、新进入、跌出前十、搜索结果标题变化。
4. 同一域名各有一个 URL 进出前十时，补充“同域 URL 更替”；不据此断言发生了重定向或页面替换。
5. 昨日缺失、失败或不足十条时，今天仍保留有效排名，但明确注明“无法对比”。不会用前天的数据冒充昨天。
6. 一组采集失败不会抹掉其他组的成功数据。当天重跑复用成功组，只补采失败组。
7. 单页不足十条时根据分页信息最多采集两页；仍不足十条则标记不完整，不计算进出排名。
8. URL 只移除 `#fragment`、`utm_*`、`gclid`、`fbclid`、`msclkid`。其他路径、参数、协议、主机差异保留，避免将不同页面合并。
9. 快照保留采集时间、搜索参数、SerpApi search ID、分页起点和来源位置，方便核对；不保存包含账号密钥的原始 API 响应。
10. 任何一组失败/不完整都会返回非零退出码，让 GitHub Actions 显示异常，同时保存能够获取的数据。

## 请求量

通常每天 3 个关键词 × 2 种设备 = 6 次查询，30/31 天约 180/186 次。若需要补页，最多两次请求/组，即每天最多 12 次；手动补采失败组会增加请求。没有自动无限重试。实际可用额度以自己的 SerpApi Dashboard 为准。

同一天同口径已成功的组不会重复采集。SerpApi 默认允许一小时缓存，日常定时采集相隔约 24 小时；脚本额外拒绝明确属于前一天的缓存结果。

## 本地验证

需要 Node.js 24；SERP 模块只使用内置库，不需要安装 Playwright 或额外 npm 依赖。

```bash
node --test test/serp.test.mjs
```

测试使用模拟响应，不消耗 API 额度，覆盖正常采集、分页去重、时间/搜索口径校验、排名和标题变化、首次基线、失败/缺失对比、当天重跑、额度错误和密钥脱敏等情况。

在安全的本地环境变量中配置 `SERPAPI_API_KEY` 后，可运行：

```bash
node monitor-serp.mjs
```

在拿到真实密钥并完成首个线上采集之前，不能将模拟测试通过等同于 Google 实时采集成功。检查首次运行的 6 组是否均成功，再检查第二天是否形成正常的昨日对比。

## 文件

- `monitor-serp.mjs`：采集、快照、比较、Markdown/CSV 输出。
- `serp-config.json`：关键词、设备、搜索市场、分页上限。
- `.github/workflows/google-serp-report.yml`：验证、定时采集、报告、历史持久化。
- `test/serp.test.mjs`：无需 API Key 的测试。

现有博客/功能/玩法工作流独立运行。SERP 工作流只提交 `data/serp/` 下的结果；推送遇到其他任务更新时会 rebase 后重试，不强推。

官方说明：[SerpApi 参数](https://serpapi.com/search-api) · [自然结果字段](https://serpapi.com/organic-results) · [GitHub Actions Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) · [GitHub 定时事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。
