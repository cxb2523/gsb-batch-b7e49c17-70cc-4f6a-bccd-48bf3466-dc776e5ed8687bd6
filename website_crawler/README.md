# website_crawler — 网站抓取技能的 Python 调用层

把 `skills/website-crawler-api`（Scavio Extract 的 map / crawl / batch 三个接口）封装成可复用的
Python 库模块（不是命令行工具），把任务进度、每页状态和额度消耗**如实**汇总给调用方。
只依赖 Python 标准库，Python 3.9+。

```
website_crawler/
├── __init__.py        # 公开接口导出
├── client.py          # 库本体：WebsiteCrawlerClient 与结果类型
├── fake_server.py     # 本地假服务 FakeScavioServer（测试用，不需要真实 API key）
└── README.md          # 本文档
tests/
└── test_website_crawler.py   # 自动化测试（stdlib unittest）
```

## 快速开始

```python
from website_crawler import WebsiteCrawlerClient

client = WebsiteCrawlerClient()  # 读取环境变量 SCAVIO_API_KEY；也可传 api_key="sk_..."

# Map：同步，1 额度
site = client.map("https://hono.dev", include_paths=["/docs"], limit=500)
print(site.total_found, site.credits_used)

# Crawl：启动（202，此时额度为 0）→ 轻量轮询 → 结束后取正文 → 诚实汇总
report = client.crawl("https://hono.dev/docs", max_pages=50, include_paths=["/docs"])
print(report.summary())
for page in report.succeeded_pages:
    ...  # page.content 是 Markdown

# Batch：已有 URL 列表，一次任务
report = client.batch(["https://hono.dev/docs/api/routing", "https://hono.dev/docs/api/context"])
```

## 公开接口

### `WebsiteCrawlerClient(api_key=None, *, base_url=..., poll_interval=2.0, request_timeout=30.0)`

- `api_key` 缺省读 `SCAVIO_API_KEY`；两者都没有时抛 `ValueError`。
- `base_url` 默认 `https://api.scavio.dev`，测试时指向假服务。

| 方法 | 说明 |
|---|---|
| `map(url, **params) -> MapResult` | 同步列 URL。`MapResult` 带 `links / total_found / returned / truncated / credits_used`。 |
| `start_crawl(url, *, idempotency_key=None, **params) -> JobHandle` | 发 POST（自动携带 `Idempotency-Key`），返回任务句柄；此时 `credits_used` 为 0。 |
| `start_batch(urls, *, idempotency_key=None, **params) -> JobHandle` | 同上；`handle.invalid_urls` 单独列出被拒链接。全部非法时抛 `BatchNotCreated`。 |
| `status(job, *, include_content=False, status=None, cursor=None, limit=None) -> dict` | 单次状态查询，默认轻量（不带正文）。 |
| `wait(job, *, poll_interval=None, timeout=None) -> JobReport` | 轮询到终态后取回全部页面正文，返回汇总报告。 |
| `cancel(job) -> dict` | 取消任务，立即停止计费。 |
| `crawl(url, *, wait=True, ...) -> JobReport \| JobHandle` | `start_crawl` + `wait` 的便捷组合；`wait=False` 返回句柄。 |
| `batch(urls, *, wait=True, ...) -> JobReport \| JobHandle` | 同上。 |

### `JobReport` —— 如实汇总

- `status`：终态原样（`completed` / `failed` / `cancelled`）。
- `stopped_reason`：提前结束原因**原样暴露**（`max_pages` / `insufficient_credits` /
  `time_limit` / `storage_limit` / `cancelled`），绝不改写成成功。
- `ok`：仅当 `completed` 且无 `stopped_reason` 且无任务级错误时为 `True`。
- `pages`：`discovered / queued / succeeded / failed / skipped` 计数。
- `results`：每页 `PageResult`（`status`、`content`、`error`、`skip_reason`、`credits`）。
  `succeeded_pages / failed_pages / skipped_pages` 三个属性做过滤。
- 额度三口径并列，便于对账：`credits_used`（API 报告值）、`credits_from_pages`
  （逐页求和）、`credits_expected`（成功页数 × 每页单价）；`credits_match` 三者一致时为真。
- `invalid_urls`：batch 中被拒的链接，从未计费，不计入成功页。
- `billing_url`：`insufficient_credits` 停止时给出补额链接（API 未携带时回退到
  `https://dashboard.scavio.dev/billing`）。
- `summary()`：一段人读的诚实摘要（含停止原因与补额链接）。

### 异常

- `ScavioError`：非 2xx 响应。带 `status`、`body`、`billing_url`（402/限额 400）、
  `retry_after`（429）。
- `BatchNotCreated(ScavioError)`：batch 全部 URL 非法，POST 返回 400，**未创建任务**；
  `invalid_urls` 列出每个非法链接及原因。

## 库遵守的计费语义

1. crawl / batch 的 POST 返回 202 时只拿到任务 id，额度为 0；启动、轮询、取消均免费。
2. 只有 `succeeded` 页面计费：normal / advanced 每页 1，ultra 每页 2；
   `failed` 与 `skipped` 计 0。
3. 轮询默认 `include_content=false` 做轻量进度查询；任务进入
   `completed` / `failed` / `cancelled` 后才取正文（游标分页，每页 100 条）。
4. crawl 与 batch 的 POST 必须携带 `Idempotency-Key`：调用方没传时库自动生成
   （可从 `handle.idempotency_key` 读回）；同一键 24 小时内重试复用原任务，
   不会新开任务、不会重复计费。
5. 额度不足时任务以 `insufficient_credits` 停止并保留已抓页面：报告里这些页面仍在
   `succeeded_pages` 中，`stopped_reason` 原样保留，`billing_url` 给出补额链接。
6. batch 的 202 可能带 `invalid_urls`：这些链接从未计费，单独列出，不计入成功页；
   全部非法时 POST 返回 400 且不创建任务，库抛 `BatchNotCreated` 明确报告。

## 本地假服务（不依赖真实 SCAVIO_API_KEY）

`FakeScavioServer` 用 `http.server` 实现，模拟：202 建任务、`queued → running →
completed/failed/cancelled` 状态迁移（默认每次状态查询推进一页）、
succeeded/failed/skipped 混合结果、按页计费（ultra 每页 2）、batch 的
`invalid_urls`、全非法 400（不建任务）、幂等键 24 小时复用、余额耗尽时
`insufficient_credits` 提前停止（保留已抓页面并带 `billing_url`）、DELETE 取消、
401/404/409/402 错误。

```python
from website_crawler import WebsiteCrawlerClient
from website_crawler.fake_server import FakeScavioServer

with FakeScavioServer(api_key="test-key", credits=100) as server:
    client = WebsiteCrawlerClient(api_key="test-key", base_url=server.base_url,
                                  poll_interval=0.01)
    # 编排抓取计划：两页成功、一页失败、一页被 robots 跳过
    server.add_crawl_plan("https://docs.example.com", [
        {"url": "https://docs.example.com/a"},
        {"url": "https://docs.example.com/b"},
        {"url": "https://docs.example.com/boom", "outcome": "failed", "error": "HTTP 500"},
        {"url": "https://docs.example.com/robots", "outcome": "skipped", "skip_reason": "robots"},
    ])
    report = client.crawl("https://docs.example.com", max_pages=10)
    print(report.summary())

    # 模拟额度不足：余额只够一页
    server.credits = 1
    report = client.crawl("https://docs.example.com/other", max_pages=10)
    assert report.stopped_reason == "insufficient_credits"
    print(report.billing_url)  # 补额链接
```

测试钩子：

- `add_crawl_plan(start_url, pages)` / `set_page_outcome(url, outcome, **extra)` /
  `add_map_plan(url, links)`：编排页面与结果。
- `credits`：可变余额，低于每页单价时任务以 `insufficient_credits` 停止。
- `jobs` / `request_log` / `idempotent_replays`：检查建了几个任务、每次请求的参数、
  幂等复用次数。
- 构造参数 `pages_per_poll`：每次状态查询推进的页数（默认 1）。

## 运行测试

```bash
python -m unittest discover -s tests -v
```

覆盖：map 计费与 402、202 零额度、混合结果只对成功页计费（含 ultra 每页 2）、
轻量轮询后取正文、`max_pages` 停止原因原样暴露、`insufficient_credits` 保留页面并给出
补额链接、取消、自动携带幂等键、同键重试复用任务且不重复计费、batch 的
`invalid_urls` 单独列出且不计费、全非法 400 不建任务、batch 幂等复用、
batch 额度不足、401/404 错误。
