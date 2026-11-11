<h1 align="center">Chartdeck</h1>

<p align="center">
  <strong>Bars, gauges and charts for Home Assistant dashboards.</strong><br>
  Every style set up from the visual editor, drawn by the card itself, and themed to match
  your dashboard in light and dark.
</p>

<p align="center">
  <a href="https://github.com/tempus2016/chartdeck/releases"><img src="https://img.shields.io/github/v/release/tempus2016/chartdeck?include_prereleases" alt="Latest Release"></a>
  <a href="https://my.home-assistant.io/redirect/marketplace_repository/?owner=tempus2016&repository=chartdeck"><img src="https://img.shields.io/badge/Marketplace-Default-41BDF5.svg" alt="Home Assistant Marketplace"></a>
  <a href="https://github.com/tempus2016/chartdeck/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
  <img src="https://img.shields.io/badge/Home%20Assistant-2025.1+-blue" alt="HA Version">
  <a href="https://github.com/tempus2016/chartdeck/releases"><img src="https://img.shields.io/github/downloads/tempus2016/chartdeck/total" alt="Downloads"></a>
  <a href="https://community.home-assistant.io/t/chartdeck-bars-and-gauges-for-your-dashboard-all-set-up-from-the-visual-editor/1030685"><img src="https://img.shields.io/badge/community-forum-41BDF5?logo=home-assistant&logoColor=white" alt="Community Forum"></a>
</p>

<p align="center">
  <a href="https://github.com/tempus2016/chartdeck/actions/workflows/build.yml"><img src="https://github.com/tempus2016/chartdeck/actions/workflows/build.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/tempus2016/chartdeck/actions/workflows/hacs.yml"><img src="https://github.com/tempus2016/chartdeck/actions/workflows/hacs.yml/badge.svg" alt="Marketplace validation"></a>
  <a href="https://github.com/tempus2016/chartdeck/actions/workflows/codeql.yml"><img src="https://github.com/tempus2016/chartdeck/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://github.com/tempus2016/chartdeck/commits/main"><img src="https://img.shields.io/github/commit-activity/y/tempus2016/chartdeck" alt="Commit activity"></a>
</p>

> **2.0 adds the rest of the roadmap: parts of a total, distributions, comparisons, flows, hierarchies, and zoom, annotations and more on the line chart.** Ideas for what comes next are on the
> [roadmap board][roadmap].

![The seven Chartdeck styles in a light theme: classic bar, thin bar, segmented, tank, ring, needle and arc](images/preview-v1.png)

📖 **The documentation is in the [wiki][wiki]**, also published as a [searchable site][pages].
This page is the summary. What changed in each version is on the [releases page][releases].

## Why Chartdeck

- **Everything from the visual editor.** Pick entities, choose a style, set colour bands
  and limits without writing YAML. YAML still works, and the editor and YAML always agree.
- **One card, many styles.** Switching from a bar to a ring or a gauge is one setting. Colour
  bands, actions, names and limits carry across.
- **No chart library.** Every style is drawn by the card's own code, so it stays small, loads
  fast on wall tablets, and follows your Home Assistant theme.
- **Limits from anywhere.** Minimum, maximum and target can each be a number or another
  entity.
- **In your language.** The card and its editor follow the language in your Home Assistant
  profile: English, German, Spanish, French, Dutch or Portuguese.

## Styles

| Style | Good for | Status |
| --- | --- | --- |
| Classic bar | Batteries, levels, anything 0–100 | 1.0 |
| Thin bar | Storage, compact lists | 1.0 |
| Segmented bar | Signal strength, fill levels | 1.0 |
| Vertical / tank | Tanks, bins, water butts | 1.0 |
| Ring | CPU, memory, disk | 1.0 |
| Half circle with needle | Power, speed | 1.0 |
| Three-quarter arc | Temperature, humidity, CO₂ | 1.0 |
| Line chart | How a sensor changed over hours, days or months | 1.2 |
| Area chart | Solar, power use, import and export either side of zero | 1.3 |
| Column chart | Energy per day, rain per hour | 1.3 |
| Combined chart | Columns, lines and areas on one time axis, with a second axis | 1.3 |
| Pie and donut | How a total splits into parts, such as where today's energy came from | 2.0 |
| Rings | Several batteries or goals in one dial | 2.0 |
| Pictograph | Counting: chores done, glasses of water, people at home | 2.0 |
| Waffle | One share out of 100, or a split of one total | 2.0 |
| Histogram | How long a room spent in each temperature range | 2.0 |
| Scatter | One sensor against another, such as heating against outside temperature | 2.0 |
| Bubble | A scatter sized by a third sensor: temperature, humidity and CO₂ | 2.0 |
| Heatmap | Power by hour and weekday, or a year of days as a calendar | 2.0 |
| Box plot | How readings spread, per entity or per day, week or month | 2.0 |
| Funnel | Solar produced, used in the house, exported | 2.0 |
| Waterfall | How a total is built up or worn down, step by step | 2.0 |
| Treemap | Power use by floor and room | 2.0 |
| Sunburst and icicle | A hierarchy as rings or bars, tap to drill in | 2.0 |
| Radar | Comparing profiles of several values | 2.0 |
| Polar area | Values as slice lengths around a circle | 2.0 |
| Grouped and stacked bars | Several values side by side, stacked or as 100 % | 2.0 |
| Bullet and lollipop | A value against its target; many values with little ink | 2.0 |
| Slope and dumbbell | Each entity then and now, or its lowest and highest | 2.0 |
| Range area | Each period's lowest to highest, shaded | 2.0 |
| Sparklines | A tiny trend beside each entity's name and value | 2.0 |
| Streamgraph | How several entities share a total over time | 2.0 |
| Candlestick | Open, high, low and close per period | 2.0 |
| Violin, raincloud and beeswarm | How readings are spread, or every reading as a dot | 2.0 |
| State timeline | When each entity was on, off, home or heating | 2.0 |
| Climate | A thermostat's temperature against its set point | 2.0 |
| Sankey | How power flows between sources and loads | 2.0 |
| Wind rose | Where the wind comes from, and how hard | 2.0 |
| 24-hour clock | When each entity was on, around the clock | 2.0 |
| Trend card | A compact tile: the value over its recent history | 2.0 |
| Line chart extras | Zoom and pan, annotations, value labels, synced charts, small multiples, highest/lowest/average marks, log scale | 2.0 |
| Marimekko | A total split two ways, such as energy by room and by use | vNEXT |
| Chord | Flows both ways between a few places, round a circle | vNEXT |
| Battery grid | Every battery in the house, emptiest first | vNEXT |
| Spiral | A daily or weekly routine, one turn per day or week | vNEXT |
| Strip plot | Every reading as a dot, with a line at the median | vNEXT |
| Cycle plot | The average day for each weekday, side by side | vNEXT |
| Chart extras | Forecasts, anomalies, earlier spans and a now line on the line chart; error bars on columns; a recent range behind the gauges; running totals, rates, unit conversion, conditional series, hiding series, an export menu and the Energy dashboard as a source | vNEXT |

A Chartdeck badge (`custom:chartdeck-badge`, vNEXT) puts one entity in the badge row of a
Sections view as a value, sparkline, ring or thin bar, with the card's colour bands and limits.

## Installation

Chartdeck is in the Home Assistant Marketplace:

1. Go to **Settings → Marketplace** and search for *Chartdeck*.
2. Choose **Install**, then reload your browser.

[![Open your Home Assistant instance and show Chartdeck in the Marketplace.](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=tempus2016&repository=chartdeck)

On Home Assistant older than 2026.11, the Marketplace is still HACS: open HACS, search for
*Chartdeck* and choose **Download**.

To install by hand, save every `.js` file of the [latest release][latest-release] to
`<config>/www/` *(v2.1.0+: each translation is a file of its own beside the main one)* and add
`/local/chartdeck-card.js` as a dashboard resource of type `module`. The
[Installation][wiki-installation] page has the detail.

## Getting started

Edit a dashboard, choose **Add card**, and search for **Chartdeck**. The editor walks you
through the rest. The [Quick start][wiki-quick-start] shows the same in pictures.

## Quick start

```yaml
type: custom:chartdeck-card
style: ring
entities:
  - sensor.cpu_usage
severity:
  - from: 0
    color: green
  - from: 80
    color: red
```

Every option is in the [wiki][wiki].

## Help and feedback

- Something not right? Check [Troubleshooting][wiki-troubleshooting], then
  [open an issue][issues].
- Want a chart type that is not here yet? Use the
  [New chart type][new-chart] form — the votes on those decide what comes next.
- Questions and dashboards to show off go in [Discussions][discussions].

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Translations are the easiest place to start.

## Licence

[MIT](LICENSE).

[wiki]: https://github.com/tempus2016/chartdeck/wiki
[pages]: https://tempus2016.github.io/chartdeck/
[releases]: https://github.com/tempus2016/chartdeck/releases
[latest-release]: https://github.com/tempus2016/chartdeck/releases/latest
[roadmap]: https://github.com/users/tempus2016/projects/5
[wiki-installation]: https://github.com/tempus2016/chartdeck/wiki/Installation
[wiki-quick-start]: https://github.com/tempus2016/chartdeck/wiki/Quick-Start
[wiki-troubleshooting]: https://github.com/tempus2016/chartdeck/wiki/Troubleshooting
[issues]: https://github.com/tempus2016/chartdeck/issues
[new-chart]: https://github.com/tempus2016/chartdeck/issues/new?template=new_chart_type.yml
[discussions]: https://github.com/tempus2016/chartdeck/discussions
