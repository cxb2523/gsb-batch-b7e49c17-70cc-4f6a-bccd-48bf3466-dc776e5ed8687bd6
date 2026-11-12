#!/usr/bin/env python3
"""
从解析后的 JSON 数据生成微信收藏可视化 HTML 报告。
单文件输出，内联 ECharts CDN，无需额外依赖。
"""

import argparse
import html
import json
import os
import sys


def _json_for_script(obj):
    """序列化 JSON 并转义可突破 <script> 块的字符。

    json.dumps 不会转义 ``<``、``>``、``&``，用户文本若包含 ``</script>``
    会直接终止脚本块造成注入。统一用 Unicode 转义形式输出，
    JS 解析回字符串后内容不变。
    """
    escaped = json.dumps(obj, ensure_ascii=False)
    for ch, code in (("<", "003c"), (">", "003e"), ("&", "0026"),
                     (chr(0x2028), "2028"), (chr(0x2029), "2029")):
        escaped = escaped.replace(ch, '\\' + "u" + code)
    return escaped


def generate_html(stats, items=None, title="我的微信收藏报告"):
    """生成完整的 HTML 报告"""

    items = items or []
    # 为浏览区准备精简的 items 数据（去掉 search_key 等大字段节省体积）
    browse_items = []
    for it in items:
        browse_items.append({
            "id": it.get("id", 0),
            "type_name": it.get("type_name", "其他"),
            "source": it.get("source", ""),
            "timestamp": it.get("timestamp", ""),
            "title": it.get("title", ""),
            "desc": it.get("desc", "") or "",
            "link": it.get("link", "") or "",
            "thumb": it.get("thumb", "") or "",
            "tags": it.get("tags", []),
        })
    items_json = _json_for_script(browse_items)

    type_dist_json = _json_for_script(stats["type_dist"])
    source_top_json = _json_for_script(stats["source_top"][:15])
    monthly_json = _json_for_script(stats["monthly_trend"])
    hour_json = _json_for_script(stats["hour_dist"])
    weekday_json = _json_for_script(stats["weekday_dist"])
    keywords_json = _json_for_script(stats["keywords"][:60])
    heatmap_json = _json_for_script(stats["heatmap"])
    tag_json = _json_for_script(stats.get("tag_dist", []))
    has_tags = stats.get("has_tags", False)

    # 计算亮点
    top_source = stats["source_top"][0]["name"] if stats["source_top"] else "无"
    top_source_count = stats["source_top"][0]["value"] if stats["source_top"] else 0
    top_type = stats["type_dist"][0]["name"] if stats["type_dist"] else "无"
    top_type_pct = round(stats["type_dist"][0]["value"] / max(stats["total"], 1) * 100) if stats["type_dist"] else 0

    # 所有写入静态 HTML 文本节点/属性的用户可控字符串都要按纯文本转义
    esc = html.escape
    title_esc = esc(str(title))
    first_date_esc = esc(str(stats["first_date"]))
    last_date_esc = esc(str(stats["last_date"]))
    busiest_day_esc = esc(str(stats["busiest_day"]))
    top_source_esc = esc(str(top_source))
    top_type_esc = esc(str(top_type))

    report_html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title_esc}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/echarts-wordcloud@2/dist/echarts-wordcloud.min.js"></script>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #0a0e27;
    color: #e0e6ff;
    min-height: 100vh;
  }}
  .header {{
    text-align: center;
    padding: 60px 20px 40px;
    background: linear-gradient(135deg, #0a0e27 0%, #1a1f4e 50%, #0a0e27 100%);
  }}
  .header h1 {{
    font-size: 2.5em;
    font-weight: 700;
    background: linear-gradient(135deg, #60a5fa, #a78bfa, #f472b6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 8px;
  }}
  .header .subtitle {{
    color: #8b95c9;
    font-size: 1.1em;
  }}

  /* 数字卡片 */
  .stats-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    max-width: 1200px;
    margin: -20px auto 40px;
    padding: 0 30px;
  }}
  .stat-card {{
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 28px 24px;
    text-align: center;
    backdrop-filter: blur(10px);
    transition: transform 0.2s, border-color 0.2s;
  }}
  .stat-card:hover {{
    transform: translateY(-4px);
    border-color: rgba(96,165,250,0.3);
  }}
  .stat-card .number {{
    font-size: 2.8em;
    font-weight: 800;
    background: linear-gradient(135deg, #60a5fa, #a78bfa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    line-height: 1.2;
  }}
  .stat-card .label {{
    color: #8b95c9;
    font-size: 0.95em;
    margin-top: 8px;
  }}

  /* 图表容器 */
  .container {{
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 30px 60px;
  }}
  .chart-row {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 24px;
  }}
  .chart-full {{
    margin-bottom: 24px;
  }}
  .chart-box {{
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 24px;
    backdrop-filter: blur(10px);
  }}
  .chart-box h3 {{
    font-size: 1.15em;
    font-weight: 600;
    color: #c4cbf5;
    margin-bottom: 16px;
    padding-left: 12px;
    border-left: 3px solid #60a5fa;
  }}
  .chart {{
    width: 100%;
    height: 360px;
  }}
  .chart-tall {{
    height: 450px;
  }}

  /* 亮点卡片 */
  .highlights {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
    margin-bottom: 40px;
  }}
  .highlight {{
    background: linear-gradient(135deg, rgba(96,165,250,0.1), rgba(167,139,250,0.1));
    border: 1px solid rgba(96,165,250,0.2);
    border-radius: 12px;
    padding: 20px;
  }}
  .highlight .hl-label {{
    color: #8b95c9;
    font-size: 0.85em;
    margin-bottom: 6px;
  }}
  .highlight .hl-value {{
    font-size: 1.3em;
    font-weight: 700;
    color: #e0e6ff;
  }}
  .highlight .hl-detail {{
    color: #60a5fa;
    font-size: 0.9em;
    margin-top: 4px;
  }}

  /* 分类浏览区 */
  .browse-section {{
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 30px 60px;
  }}
  .browse-header {{
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }}
  .browse-header h2 {{
    font-size: 1.4em;
    font-weight: 700;
    color: #c4cbf5;
    margin-right: 12px;
  }}
  .filter-group {{
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    padding: 12px 16px;
    margin-bottom: 12px;
  }}
  .filter-label {{
    color: #4a5280;
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 8px;
    display: block;
  }}
  .tab-bar {{
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }}
  .tab-btn {{
    padding: 4px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    color: #6b7394;
    font-size: 0.8em;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    line-height: 1.6;
  }}
  .tab-btn:hover {{
    border-color: rgba(96,165,250,0.3);
    color: #c4cbf5;
    background: rgba(96,165,250,0.06);
  }}
  .tab-btn.active {{
    background: rgba(96,165,250,0.15);
    border-color: #60a5fa;
    color: #60a5fa;
    font-weight: 600;
  }}
  .tab-btn .tab-count {{
    font-size: 0.8em;
    opacity: 0.5;
    margin-left: 3px;
  }}
  #tag-tabs .tab-btn {{
    border-radius: 12px;
    padding: 3px 10px;
    font-size: 0.75em;
    color: #a78bfa;
    border-color: rgba(167,139,250,0.15);
    background: rgba(167,139,250,0.04);
  }}
  #tag-tabs .tab-btn:hover {{
    border-color: rgba(167,139,250,0.3);
    background: rgba(167,139,250,0.08);
  }}
  #tag-tabs .tab-btn.active {{
    background: rgba(167,139,250,0.2);
    border-color: #a78bfa;
    color: #a78bfa;
  }}
  .search-row {{
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }}
  .search-input {{
    flex: 1;
    min-width: 200px;
    padding: 10px 16px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: #e0e6ff;
    font-size: 0.95em;
    outline: none;
    transition: border-color 0.2s;
  }}
  .search-input:focus {{
    border-color: #60a5fa;
  }}
  .search-input::placeholder {{
    color: #4a5280;
  }}
  .sort-select {{
    padding: 10px 16px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: #8b95c9;
    font-size: 0.9em;
    cursor: pointer;
    outline: none;
  }}
  .browse-info {{
    color: #4a5280;
    font-size: 0.85em;
    margin-bottom: 16px;
  }}
  .items-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }}
  .item-card {{
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 12px;
    padding: 20px;
    transition: border-color 0.2s, transform 0.15s;
    cursor: pointer;
  }}
  .item-card:hover {{
    border-color: rgba(96,165,250,0.25);
    transform: translateY(-2px);
  }}
  .item-top {{
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }}
  .item-type-badge {{
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 0.75em;
    font-weight: 600;
    white-space: nowrap;
  }}
  .badge-article {{ background: rgba(96,165,250,0.15); color: #60a5fa; }}
  .badge-image {{ background: rgba(244,114,182,0.15); color: #f472b6; }}
  .badge-video {{ background: rgba(251,191,36,0.15); color: #fbbf24; }}
  .badge-text {{ background: rgba(52,211,153,0.15); color: #34d399; }}
  .badge-file {{ background: rgba(251,146,60,0.15); color: #fb923c; }}
  .badge-note {{ background: rgba(167,139,250,0.15); color: #a78bfa; }}
  .badge-chat {{ background: rgba(56,189,248,0.15); color: #38bdf8; }}
  .badge-other {{ background: rgba(139,149,201,0.12); color: #8b95c9; }}
  .item-date {{
    color: #4a5280;
    font-size: 0.8em;
    margin-left: auto;
  }}
  .item-title {{
    font-size: 1em;
    font-weight: 600;
    color: #e0e6ff;
    margin-bottom: 6px;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }}
  .item-desc {{
    font-size: 0.85em;
    color: #6b7394;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }}
  .item-bottom {{
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }}
  .item-source {{
    font-size: 0.8em;
    color: #60a5fa;
    background: rgba(96,165,250,0.08);
    padding: 2px 8px;
    border-radius: 6px;
  }}
  .item-tag {{
    font-size: 0.75em;
    color: #a78bfa;
    background: rgba(167,139,250,0.1);
    padding: 2px 8px;
    border-radius: 6px;
  }}
  .pagination {{
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
  }}
  .page-btn {{
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: #8b95c9;
    cursor: pointer;
    font-size: 0.9em;
    transition: all 0.2s;
  }}
  .page-btn:hover:not(:disabled) {{
    border-color: #60a5fa;
    color: #60a5fa;
  }}
  .page-btn:disabled {{
    opacity: 0.3;
    cursor: not-allowed;
  }}
  /* 详情弹窗 */
  .detail-overlay {{
    display: none;
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(5,7,20,0.85);
    z-index: 1000;
    justify-content: center;
    align-items: center;
    padding: 40px;
  }}
  .detail-overlay.open {{
    display: flex;
  }}
  .detail-panel {{
    background: #0f1335;
    border: 1px solid rgba(96,165,250,0.25);
    border-radius: 16px;
    max-width: 700px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    padding: 32px;
    position: relative;
  }}
  .detail-close {{
    position: absolute;
    top: 16px; right: 16px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    color: #8b95c9;
    width: 32px; height: 32px;
    border-radius: 8px;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }}
  .detail-close:hover {{
    background: rgba(255,255,255,0.12);
    color: #e0e6ff;
  }}
  .detail-meta {{
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }}
  .detail-title {{
    font-size: 1.3em;
    font-weight: 700;
    color: #e0e6ff;
    line-height: 1.4;
    margin-bottom: 16px;
  }}
  .detail-body {{
    color: #9ba4cc;
    font-size: 0.95em;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
    margin-bottom: 16px;
  }}
  .detail-field {{
    margin-bottom: 12px;
  }}
  .detail-label {{
    color: #4a5280;
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }}
  .detail-value {{
    color: #c4cbf5;
    font-size: 0.9em;
    word-break: break-all;
  }}
  .detail-tags {{
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 12px;
  }}
  .page-info {{
    color: #4a5280;
    font-size: 0.85em;
    min-width: 100px;
    text-align: center;
  }}
  .empty-state {{
    grid-column: 1 / -1;
    text-align: center;
    color: #6b7394;
    padding: 60px 20px;
    border: 1px dashed rgba(255,255,255,0.1);
    border-radius: 12px;
    background: rgba(255,255,255,0.02);
  }}
  .empty-state .empty-icon {{
    font-size: 2em;
    display: block;
    margin-bottom: 10px;
    opacity: 0.6;
  }}
  .empty-state .empty-title {{
    font-size: 1em;
    color: #8b95c9;
    margin-bottom: 6px;
  }}
  .empty-state .empty-hint {{
    font-size: 0.85em;
    color: #4a5280;
  }}

  /* Footer */
  .footer {{
    text-align: center;
    padding: 40px 20px;
    color: #4a5280;
    font-size: 0.85em;
    border-top: 1px solid rgba(255,255,255,0.05);
  }}
  .footer a {{ color: #60a5fa; text-decoration: none; }}

  @media (max-width: 768px) {{
    .chart-row {{ grid-template-columns: 1fr; }}
    .header h1 {{ font-size: 1.8em; }}
    .stats-grid {{ grid-template-columns: repeat(2, 1fr); }}
    .items-grid {{ grid-template-columns: 1fr; }}
  }}
</style>
</head>
<body>

<div class="header">
  <h1>{title_esc}</h1>
  <p class="subtitle">{first_date_esc} ~ {last_date_esc}</p>
</div>

<!-- 数字卡片 -->
<div class="stats-grid">
  <div class="stat-card">
    <div class="number">{stats['total']:,}</div>
    <div class="label">总收藏数</div>
  </div>
  <div class="stat-card">
    <div class="number">{stats['span_days']:,}</div>
    <div class="label">跨越天数</div>
  </div>
  <div class="stat-card">
    <div class="number">{stats['daily_avg']}</div>
    <div class="label">日均收藏</div>
  </div>
  <div class="stat-card">
    <div class="number">{len(stats['source_top'])}</div>
    <div class="label">不同来源</div>
  </div>
</div>

<div class="container">

  <!-- 亮点发现 -->
  <div class="highlights">
    <div class="highlight">
      <div class="hl-label">收藏最多的一天</div>
      <div class="hl-value">{busiest_day_esc}</div>
      <div class="hl-detail">共收藏 {stats['busiest_count']} 条</div>
    </div>
    <div class="highlight">
      <div class="hl-label">最爱的来源</div>
      <div class="hl-value">{top_source_esc}</div>
      <div class="hl-detail">贡献了 {top_source_count} 条收藏</div>
    </div>
    <div class="highlight">
      <div class="hl-label">最多的类型</div>
      <div class="hl-value">{top_type_esc}</div>
      <div class="hl-detail">占比 {top_type_pct}%</div>
    </div>
  </div>

  <!-- 月度趋势 -->
  <div class="chart-full">
    <div class="chart-box">
      <h3>月度收藏趋势</h3>
      <div id="chart-monthly" class="chart"></div>
    </div>
  </div>

  <!-- 类型分布 + 来源排行 -->
  <div class="chart-row">
    <div class="chart-box">
      <h3>内容类型分布</h3>
      <div id="chart-type" class="chart"></div>
    </div>
    <div class="chart-box">
      <h3>来源 Top 15</h3>
      <div id="chart-source" class="chart chart-tall"></div>
    </div>
  </div>

  <!-- 时间热力图 -->
  <div class="chart-full">
    <div class="chart-box">
      <h3>收藏时间热力图（星期 x 小时）</h3>
      <div id="chart-heatmap" class="chart"></div>
    </div>
  </div>

  <!-- 小时分布 + 星期分布 -->
  <div class="chart-row">
    <div class="chart-box">
      <h3>每小时收藏分布</h3>
      <div id="chart-hour" class="chart"></div>
    </div>
    <div class="chart-box">
      <h3>每周收藏分布</h3>
      <div id="chart-weekday" class="chart"></div>
    </div>
  </div>

  <!-- 关键词云 -->
  <div class="chart-full">
    <div class="chart-box">
      <h3>关键词云</h3>
      <div id="chart-wordcloud" class="chart chart-tall"></div>
    </div>
  </div>

  <!-- 标签分布（如有） -->
  {"" if not has_tags else '''
  <div class="chart-full">
    <div class="chart-box">
      <h3>标签分布</h3>
      <div id="chart-tags" class="chart"></div>
    </div>
  </div>
  '''}

</div>

<!-- 分类浏览区 -->
<div class="browse-section" id="browse">
  <div class="browse-header">
    <h2>收藏浏览</h2>
  </div>
  <div class="filter-group">
    <span class="filter-label">按类型</span>
    <div class="tab-bar" id="type-tabs"></div>
  </div>
  <div class="filter-group" id="tag-group">
    <span class="filter-label">按标签</span>
    <div class="tab-bar" id="tag-tabs"></div>
  </div>
  <div class="search-row">
    <input type="text" class="search-input" id="search-input"
           placeholder="搜索标题、描述、来源...">
    <select class="sort-select" id="sort-select">
      <option value="time-desc">最新优先</option>
      <option value="time-asc">最早优先</option>
      <option value="source">按来源</option>
    </select>
  </div>
  <div class="browse-info" id="browse-info"></div>
  <div class="items-grid" id="items-grid"></div>
  <div class="pagination" id="pagination"></div>
</div>

<!-- 详情弹窗 -->
<div class="detail-overlay" id="detail-overlay">
  <div class="detail-panel" id="detail-panel">
    <button class="detail-close" id="detail-close">&times;</button>
    <div id="detail-content"></div>
  </div>
</div>

<div class="footer">
  Generated by <a href="#">wechat-favorites-viz</a> skill
</div>

<script>
const darkTheme = {{
  backgroundColor: 'transparent',
  textStyle: {{ color: '#8b95c9' }},
  title: {{ textStyle: {{ color: '#c4cbf5' }} }},
  legend: {{ textStyle: {{ color: '#8b95c9' }} }},
}};

// 月度趋势
(function() {{
  const chart = echarts.init(document.getElementById('chart-monthly'));
  const data = {monthly_json};
  chart.setOption({{
    ...darkTheme,
    tooltip: {{ trigger: 'axis' }},
    xAxis: {{
      type: 'category',
      data: data.map(d => d.month),
      axisLabel: {{ color: '#6b7394', rotate: 45 }},
      axisLine: {{ lineStyle: {{ color: '#2a2f5a' }} }},
    }},
    yAxis: {{
      type: 'value',
      axisLabel: {{ color: '#6b7394' }},
      splitLine: {{ lineStyle: {{ color: '#1a1f4e' }} }},
    }},
    series: [{{
      type: 'line',
      data: data.map(d => d.count),
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: {{ color: '#60a5fa', width: 3 }},
      itemStyle: {{ color: '#60a5fa' }},
      areaStyle: {{
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          {{ offset: 0, color: 'rgba(96,165,250,0.3)' }},
          {{ offset: 1, color: 'rgba(96,165,250,0.02)' }},
        ])
      }},
    }}],
    grid: {{ left: 50, right: 20, bottom: 60, top: 20 }},
  }});
  window.addEventListener('resize', () => chart.resize());
}})();

// 类型分布
(function() {{
  const chart = echarts.init(document.getElementById('chart-type'));
  const data = {type_dist_json};
  const colors = ['#60a5fa', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb923c', '#f87171', '#818cf8'];
  chart.setOption({{
    ...darkTheme,
    tooltip: {{ trigger: 'item', formatter: '{{b}}: {{c}} ({{d}}%)' }},
    series: [{{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '50%'],
      data: data,
      label: {{
        color: '#8b95c9',
        formatter: '{{b}}\\n{{d}}%',
      }},
      itemStyle: {{
        borderColor: '#0a0e27',
        borderWidth: 3,
      }},
      color: colors,
    }}],
  }});
  window.addEventListener('resize', () => chart.resize());
}})();

// 来源排行
(function() {{
  const chart = echarts.init(document.getElementById('chart-source'));
  const data = {source_top_json};
  const reversed = data.slice().reverse();
  chart.setOption({{
    ...darkTheme,
    tooltip: {{ trigger: 'axis', axisPointer: {{ type: 'shadow' }} }},
    xAxis: {{
      type: 'value',
      axisLabel: {{ color: '#6b7394' }},
      splitLine: {{ lineStyle: {{ color: '#1a1f4e' }} }},
    }},
    yAxis: {{
      type: 'category',
      data: reversed.map(d => {{
        const name = d.name;
        return name.length > 12 ? name.slice(0, 12) + '...' : name;
      }}),
      axisLabel: {{ color: '#8b95c9', fontSize: 11 }},
      axisLine: {{ lineStyle: {{ color: '#2a2f5a' }} }},
    }},
    series: [{{
      type: 'bar',
      data: reversed.map(d => d.value),
      itemStyle: {{
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          {{ offset: 0, color: '#60a5fa' }},
          {{ offset: 1, color: '#a78bfa' }},
        ]),
        borderRadius: [0, 4, 4, 0],
      }},
      barWidth: '60%',
    }}],
    grid: {{ left: 120, right: 30, bottom: 20, top: 10 }},
  }});
  window.addEventListener('resize', () => chart.resize());
}})();

// 热力图
(function() {{
  const chart = echarts.init(document.getElementById('chart-heatmap'));
  const data = {heatmap_json};
  const hours = Array.from({{length:24}}, (_, i) => i + ':00');
  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const maxVal = Math.max(...data.map(d => d[2]), 1);
  chart.setOption({{
    ...darkTheme,
    tooltip: {{
      formatter: function(p) {{
        return days[p.data[1]] + ' ' + hours[p.data[0]] + ': ' + p.data[2] + '条';
      }}
    }},
    xAxis: {{
      type: 'category',
      data: hours,
      axisLabel: {{ color: '#6b7394', fontSize: 10 }},
      splitArea: {{ show: false }},
    }},
    yAxis: {{
      type: 'category',
      data: days,
      axisLabel: {{ color: '#8b95c9' }},
    }},
    visualMap: {{
      min: 0,
      max: maxVal,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: {{
        color: ['#0a0e27', '#1e3a5f', '#3b82f6', '#60a5fa', '#93c5fd']
      }},
      textStyle: {{ color: '#6b7394' }},
    }},
    series: [{{
      type: 'heatmap',
      data: data,
      label: {{ show: false }},
      itemStyle: {{ borderColor: '#0a0e27', borderWidth: 2 }},
    }}],
    grid: {{ left: 60, right: 20, bottom: 60, top: 10 }},
  }});
  window.addEventListener('resize', () => chart.resize());
}})();

// 每小时分布
(function() {{
  const chart = echarts.init(document.getElementById('chart-hour'));
  const data = {hour_json};
  chart.setOption({{
    ...darkTheme,
    tooltip: {{ trigger: 'axis' }},
    xAxis: {{
      type: 'category',
      data: data.map(d => d.hour + ':00'),
      axisLabel: {{ color: '#6b7394', rotate: 45, fontSize: 10 }},
      axisLine: {{ lineStyle: {{ color: '#2a2f5a' }} }},
    }},
    yAxis: {{
      type: 'value',
      axisLabel: {{ color: '#6b7394' }},
      splitLine: {{ lineStyle: {{ color: '#1a1f4e' }} }},
    }},
    series: [{{
      type: 'bar',
      data: data.map(d => d.count),
      itemStyle: {{
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          {{ offset: 0, color: '#a78bfa' }},
          {{ offset: 1, color: 'rgba(167,139,250,0.2)' }},
        ]),
        borderRadius: [4, 4, 0, 0],
      }},
    }}],
    grid: {{ left: 40, right: 10, bottom: 50, top: 10 }},
  }});
  window.addEventListener('resize', () => chart.resize());
}})();

// 星期分布
(function() {{
  const chart = echarts.init(document.getElementById('chart-weekday'));
  const data = {weekday_json};
  chart.setOption({{
    ...darkTheme,
    tooltip: {{ trigger: 'axis' }},
    xAxis: {{
      type: 'category',
      data: data.map(d => d.day),
      axisLabel: {{ color: '#6b7394' }},
      axisLine: {{ lineStyle: {{ color: '#2a2f5a' }} }},
    }},
    yAxis: {{
      type: 'value',
      axisLabel: {{ color: '#6b7394' }},
      splitLine: {{ lineStyle: {{ color: '#1a1f4e' }} }},
    }},
    series: [{{
      type: 'bar',
      data: data.map(d => d.count),
      itemStyle: {{
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          {{ offset: 0, color: '#34d399' }},
          {{ offset: 1, color: 'rgba(52,211,153,0.2)' }},
        ]),
        borderRadius: [4, 4, 0, 0],
      }},
    }}],
    grid: {{ left: 40, right: 10, bottom: 30, top: 10 }},
  }});
  window.addEventListener('resize', () => chart.resize());
}})();

// 关键词云
(function() {{
  const chart = echarts.init(document.getElementById('chart-wordcloud'));
  const data = {keywords_json};
  if (data.length === 0) {{
    document.getElementById('chart-wordcloud').innerHTML =
      '<p style="text-align:center;color:#4a5280;padding-top:150px;">暂无关键词数据</p>';
    return;
  }}
  chart.setOption({{
    series: [{{
      type: 'wordCloud',
      shape: 'circle',
      sizeRange: [14, 60],
      rotationRange: [-30, 30],
      rotationStep: 15,
      gridSize: 8,
      drawOutOfBound: false,
      textStyle: {{
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        color: function() {{
          const colors = ['#60a5fa','#a78bfa','#f472b6','#34d399','#fbbf24','#818cf8','#fb923c','#38bdf8'];
          return colors[Math.floor(Math.random() * colors.length)];
        }},
      }},
      data: data,
      width: '90%',
      height: '90%',
    }}],
  }});
  window.addEventListener('resize', () => chart.resize());
}})();

// 标签分布（如有）
(function() {{
  const el = document.getElementById('chart-tags');
  if (!el) return;
  const data = {tag_json};
  if (data.length === 0) {{
    el.innerHTML = '<p style="text-align:center;color:#4a5280;padding-top:150px;">暂无标签数据</p>';
    return;
  }}
  const chart = echarts.init(el);
  chart.setOption({{
    ...darkTheme,
    series: [{{
      type: 'wordCloud',
      shape: 'diamond',
      sizeRange: [16, 50],
      rotationRange: [0, 0],
      gridSize: 12,
      textStyle: {{
        fontWeight: 'bold',
        color: function() {{
          const colors = ['#60a5fa','#a78bfa','#f472b6','#34d399','#fbbf24'];
          return colors[Math.floor(Math.random() * colors.length)];
        }},
      }},
      data: data,
    }}],
  }});
  window.addEventListener('resize', () => chart.resize());
}})();

// ===== 分类浏览区 =====
(function() {{
  const rawItems = {items_json};

  const PAGE_SIZE = 24;
  const ALL = '全部';

  // 纯文本转义：用户文本只能进入文本节点或属性文本，绝不作为 HTML 解析
  function escHtml(value) {{
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }}

  // 只放行 http(s)/mailto 链接，javascript: 等危险协议退化为纯文本
  function safeUrl(value) {{
    const url = String(value === null || value === undefined ? '' : value).trim();
    return /^(https?|mailto):/i.test(url) ? url : '';
  }}

  // 归一化数据并分配稳定 uid（数组下标）。
  // 输入记录的 id 可能重复或缺失，卡片与详情之间一律用 uid 对应
  const allItems = (Array.isArray(rawItems) ? rawItems : []).map(function(raw, index) {{
    const it = raw || {{}};
    return {{
      uid: index,
      id: it.id,
      type_name: it.type_name ? String(it.type_name) : '其他',
      source: it.source === null || it.source === undefined ? '' : String(it.source),
      timestamp: it.timestamp === null || it.timestamp === undefined ? '' : String(it.timestamp),
      title: it.title === null || it.title === undefined ? '' : String(it.title),
      desc: it.desc === null || it.desc === undefined ? '' : String(it.desc),
      link: it.link === null || it.link === undefined ? '' : String(it.link),
      thumb: it.thumb === null || it.thumb === undefined ? '' : String(it.thumb),
      tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
    }};
  }});
  const itemByUid = new Map(allItems.map(function(it) {{ return [it.uid, it]; }}));

  // 单一状态源：类型 / 标签 / 搜索 / 排序 / 页码
  const state = {{
    type: ALL,
    tag: ALL,
    search: '',
    sort: 'time-desc',
    page: 1,
  }};

  const badgeClassMap = {{
    '文章/链接': 'badge-article',
    '图片': 'badge-image',
    '视频': 'badge-video',
    '文本': 'badge-text',
    '文件': 'badge-file',
    '笔记': 'badge-note',
    '聊天记录': 'badge-chat',
    '语音': 'badge-other',
    '小程序': 'badge-other',
    '位置': 'badge-other',
    '其他': 'badge-other',
  }};

  // 类型 / 标签计数（基于全量数据，与筛选状态无关）
  const typeCounts = {{}};
  allItems.forEach(function(it) {{
    typeCounts[it.type_name] = (typeCounts[it.type_name] || 0) + 1;
  }});
  const typeOrder = Object.keys(typeCounts).map(function(name) {{
    return [name, typeCounts[name]];
  }}).sort(function(a, b) {{ return b[1] - a[1]; }});

  const tagCounts = {{}};
  allItems.forEach(function(it) {{
    it.tags.forEach(function(tag) {{
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }});
  }});
  const tagOrder = Object.keys(tagCounts).map(function(name) {{
    return [name, tagCounts[name]];
  }}).sort(function(a, b) {{ return b[1] - a[1]; }});
  const hasAnyTags = tagOrder.length > 0;

  // 稳定排序：缺失的时间/来源排到末尾，主键相同时按 uid 兜底，结果确定且不抛错
  function compareItems(a, b) {{
    if (state.sort === 'source') {{
      if (!a.source && b.source) return 1;
      if (a.source && !b.source) return -1;
      const bySource = a.source.localeCompare(b.source);
      return bySource !== 0 ? bySource : a.uid - b.uid;
    }}
    if (!a.timestamp && b.timestamp) return 1;
    if (a.timestamp && !b.timestamp) return -1;
    const byTime = a.timestamp.localeCompare(b.timestamp);
    if (byTime !== 0) {{
      return state.sort === 'time-asc' ? byTime : -byTime;
    }}
    return a.uid - b.uid;
  }}

  // 过滤 + 排序始终从 allItems 派生新数组，不修改源数据
  function getFiltered() {{
    let items = allItems.slice();
    if (state.type !== ALL) {{
      items = items.filter(function(it) {{ return it.type_name === state.type; }});
    }}
    if (state.tag !== ALL) {{
      items = items.filter(function(it) {{ return it.tags.indexOf(state.tag) !== -1; }});
    }}
    if (state.search) {{
      const q = state.search.toLowerCase();
      items = items.filter(function(it) {{
        return it.title.toLowerCase().indexOf(q) !== -1 ||
               it.desc.toLowerCase().indexOf(q) !== -1 ||
               it.source.toLowerCase().indexOf(q) !== -1 ||
               it.tags.some(function(tag) {{ return tag.toLowerCase().indexOf(q) !== -1; }});
      }});
    }}
    items.sort(compareItems);
    return items;
  }}

  function renderTypeTabs() {{
    let html = '<button type="button" class="tab-btn ' + (state.type === ALL ? 'active' : '') +
      '" data-type="' + escHtml(ALL) + '">全部<span class="tab-count">' + allItems.length + '</span></button>';
    typeOrder.forEach(function(pair) {{
      const name = pair[0];
      const count = pair[1];
      html += '<button type="button" class="tab-btn ' + (state.type === name ? 'active' : '') +
        '" data-type="' + escHtml(name) + '">' + escHtml(name) +
        '<span class="tab-count">' + count + '</span></button>';
    }});
    document.getElementById('type-tabs').innerHTML = html;
  }}

  function renderTagTabs() {{
    const tagGroup = document.getElementById('tag-group');
    const tagBar = document.getElementById('tag-tabs');
    if (!hasAnyTags) {{
      tagGroup.style.display = 'none';
      return;
    }}
    tagGroup.style.display = '';
    let html = '<button type="button" class="tab-btn ' + (state.tag === ALL ? 'active' : '') +
      '" data-tag="' + escHtml(ALL) + '">全部</button>';
    tagOrder.forEach(function(pair) {{
      const name = pair[0];
      const count = pair[1];
      html += '<button type="button" class="tab-btn ' + (state.tag === name ? 'active' : '') +
        '" data-tag="' + escHtml(name) + '">' + escHtml(name) +
        '<span class="tab-count">' + count + '</span></button>';
    }});
    tagBar.innerHTML = html;
  }}

  function cardHtml(it) {{
    const badge = badgeClassMap[it.type_name] || 'badge-other';
    const date = it.timestamp ? it.timestamp.slice(0, 10) : '';
    const title = it.title || '(无标题)';
    const thumbUrl = safeUrl(it.thumb);
    const thumbHtml = thumbUrl
      ? '<img class="card-thumb" src="' + escHtml(thumbUrl) + '" alt="" loading="lazy" ' +
        'style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin-bottom:8px;">'
      : '';
    const descHtml = it.desc ? '<div class="item-desc">' + escHtml(it.desc) + '</div>' : '';
    const sourceHtml = it.source
      ? '<span class="item-source">' + escHtml(it.source) + '</span>'
      : '';
    const tagsHtml = it.tags.map(function(tag) {{
      return '<span class="item-tag">' + escHtml(tag) + '</span>';
    }}).join('');
    return '<div class="item-card" data-uid="' + it.uid + '" role="button" tabindex="0">' +
      '<div class="item-top">' +
        '<span class="item-type-badge ' + badge + '">' + escHtml(it.type_name) + '</span>' +
        '<span class="item-date">' + escHtml(date) + '</span>' +
      '</div>' +
      thumbHtml +
      '<div class="item-title">' + escHtml(title) + '</div>' +
      descHtml +
      '<div class="item-bottom">' + sourceHtml + tagsHtml + '</div>' +
    '</div>';
  }}

  function emptyStateHtml() {{
    return '<div class="empty-state">' +
      '<span class="empty-icon">🔍</span>' +
      '<div class="empty-title">没有匹配的收藏</div>' +
      '<div class="empty-hint">试试更换类型或标签筛选，或清空搜索词</div>' +
    '</div>';
  }}

  function renderItems() {{
    const filtered = getFiltered();
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;

    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    // “共 N 条”与卡片、分页共用同一份 filtered，保证三者永远一致
    const conditions = [];
    if (state.type !== ALL) conditions.push('类型: ' + state.type);
    if (state.tag !== ALL) conditions.push('标签: ' + state.tag);
    if (state.search) conditions.push('搜索: "' + state.search + '"');
    document.getElementById('browse-info').textContent =
      '共 ' + total + ' 条' + (conditions.length ? '（' + conditions.join('，') + '）' : '');

    const grid = document.getElementById('items-grid');
    grid.innerHTML = total === 0 ? emptyStateHtml() : pageItems.map(cardHtml).join('');

    const pagination = document.getElementById('pagination');
    if (totalPages <= 1) {{
      pagination.innerHTML = '';
    }} else {{
      pagination.innerHTML =
        '<button type="button" class="page-btn" ' + (state.page <= 1 ? 'disabled' : '') +
          ' data-page="' + (state.page - 1) + '">上一页</button>' +
        '<span class="page-info">' + state.page + ' / ' + totalPages + '</span>' +
        '<button type="button" class="page-btn" ' + (state.page >= totalPages ? 'disabled' : '') +
          ' data-page="' + (state.page + 1) + '">下一页</button>';
    }}
  }}

  // 任一状态变化后统一重渲染；条件变化时页码由调用方重置为 1
  function render() {{
    renderTypeTabs();
    renderTagTabs();
    renderItems();
  }}

  function showDetail(uid) {{
    const item = itemByUid.get(uid);
    if (!item) return;

    const badge = badgeClassMap[item.type_name] || 'badge-other';
    const dateText = item.timestamp ? item.timestamp.slice(0, 19).replace('T', ' ') : '';
    const tagsHtml = item.tags.map(function(tag) {{
      return '<span class="item-tag">' + escHtml(tag) + '</span>';
    }}).join('');

    let html = '<div class="detail-meta">' +
      '<span class="item-type-badge ' + badge + '">' + escHtml(item.type_name) + '</span>' +
      '<span class="item-date">' + escHtml(dateText) + '</span>' +
      '</div>' +
      '<div class="detail-title">' + escHtml(item.title || '(无标题)') + '</div>';

    const thumbUrl = safeUrl(item.thumb);
    if (thumbUrl) {{
      html += '<img class="detail-thumb" src="' + escHtml(thumbUrl) + '" alt="" ' +
        'style="width:100%;max-height:300px;object-fit:contain;border-radius:8px;margin-bottom:16px;background:#1a1f4e;">';
    }}

    const mediaTypes = ['图片', '视频', '文件', '语音'];
    if (mediaTypes.indexOf(item.type_name) !== -1 && !thumbUrl) {{
      html += '<div style="padding:20px;text-align:center;background:rgba(96,165,250,0.06);border:1px dashed rgba(96,165,250,0.2);border-radius:8px;margin-bottom:16px;color:#4a5280;font-size:0.85em;">' +
        escHtml(item.type_name) + '内容存储在微信 CDN，本地缓存已加密，暂无法直接预览</div>';
    }}

    if (item.desc) {{
      html += '<div class="detail-body">' + escHtml(item.desc) + '</div>';
    }}

    if (item.link) {{
      const url = safeUrl(item.link);
      const valueHtml = url
        ? '<a href="' + escHtml(url) + '" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;word-break:break-all;">' +
          escHtml(url.length > 80 ? url.slice(0, 80) + '...' : url) + '</a>'
        : escHtml(item.link);
      html += '<div class="detail-field"><div class="detail-label">链接</div>' +
        '<div class="detail-value">' + valueHtml + '</div></div>';
    }}

    if (item.source) {{
      html += '<div class="detail-field"><div class="detail-label">来源</div>' +
        '<div class="detail-value">' + escHtml(item.source) + '</div></div>';
    }}

    if (tagsHtml) {{
      html += '<div class="detail-field"><div class="detail-label">标签</div>' +
        '<div class="detail-tags">' + tagsHtml + '</div></div>';
    }}

    document.getElementById('detail-content').innerHTML = html;
    document.getElementById('detail-overlay').classList.add('open');
  }}

  // 图片加载失败：事件委托（capture 阶段 error 不冒泡），替代内联 onerror
  function hideBrokenImage(event) {{
    if (event.target && event.target.tagName === 'IMG') {{
      event.target.style.display = 'none';
    }}
  }}
  document.getElementById('items-grid').addEventListener('error', hideBrokenImage, true);
  document.getElementById('detail-content').addEventListener('error', hideBrokenImage, true);

  // 类型筛选（事件委托，兼容 file://）
  document.getElementById('type-tabs').addEventListener('click', function(event) {{
    const btn = event.target.closest('.tab-btn');
    if (!btn || btn.dataset.type === undefined) return;
    if (state.type === btn.dataset.type) return;
    state.type = btn.dataset.type;
    state.page = 1;
    render();
  }});

  // 标签筛选
  document.getElementById('tag-tabs').addEventListener('click', function(event) {{
    const btn = event.target.closest('.tab-btn');
    if (!btn || btn.dataset.tag === undefined) return;
    if (state.tag === btn.dataset.tag) return;
    state.tag = btn.dataset.tag;
    state.page = 1;
    render();
  }});

  // 翻页
  document.getElementById('pagination').addEventListener('click', function(event) {{
    const btn = event.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    const page = parseInt(btn.dataset.page, 10);
    if (!Number.isFinite(page)) return;
    state.page = page;
    renderItems();
    document.getElementById('browse').scrollIntoView({{ behavior: 'smooth' }});
  }});

  // 搜索：每次输入都回到第 1 页
  document.getElementById('search-input').addEventListener('input', function(event) {{
    state.search = event.target.value.trim();
    state.page = 1;
    renderItems();
  }});

  // 排序：切换后回到第 1 页
  document.getElementById('sort-select').addEventListener('change', function(event) {{
    state.sort = event.target.value;
    state.page = 1;
    renderItems();
  }});

  // 卡片点击：按被点击卡片的 uid 打开对应记录，id 重复也不会点错
  document.getElementById('items-grid').addEventListener('click', function(event) {{
    const card = event.target.closest('.item-card');
    if (!card || card.dataset.uid === undefined) return;
    showDetail(parseInt(card.dataset.uid, 10));
  }});

  // 键盘可访问性：卡片聚焦时 Enter / 空格打开详情
  document.getElementById('items-grid').addEventListener('keydown', function(event) {{
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.item-card');
    if (!card || card.dataset.uid === undefined) return;
    event.preventDefault();
    showDetail(parseInt(card.dataset.uid, 10));
  }});

  // 关闭弹窗
  document.getElementById('detail-close').addEventListener('click', function() {{
    document.getElementById('detail-overlay').classList.remove('open');
  }});
  document.getElementById('detail-overlay').addEventListener('click', function(event) {{
    if (event.target === this) {{
      this.classList.remove('open');
    }}
  }});
  document.addEventListener('keydown', function(event) {{
    if (event.key === 'Escape') {{
      document.getElementById('detail-overlay').classList.remove('open');
    }}
  }});

  render();
}})();
</script>

</body>
</html>"""
    return report_html


def main():
    parser = argparse.ArgumentParser(description="生成微信收藏可视化 HTML 报告")
    parser.add_argument("--input", "-i", required=True, help="parse_favorites.py 输出的 JSON 文件")
    parser.add_argument("--output", "-o", required=True, help="输出 HTML 文件路径")
    parser.add_argument("--title", "-t", default="我的微信收藏报告", help="报告标题")
    args = parser.parse_args()

    input_path = os.path.expanduser(args.input)
    output_path = os.path.expanduser(args.output)

    if not os.path.exists(input_path):
        print(f"[ERROR] 输入文件不存在: {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    stats = data.get("stats", {})
    if stats.get("total", 0) == 0:
        print("[ERROR] 没有收藏数据，无法生成报告", file=sys.stderr)
        sys.exit(1)

    print(f"[INFO] 正在生成报告，共 {stats['total']} 条收藏...")

    items = data.get("items", [])
    html = generate_html(stats, items=items, title=args.title)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"[OK] 报告已生成: {output_path}")
    print(f"[INFO] 用浏览器打开查看: open \"{output_path}\"")


if __name__ == "__main__":
    main()
