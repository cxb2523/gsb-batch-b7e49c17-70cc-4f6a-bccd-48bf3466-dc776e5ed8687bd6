/* 测试公共件：拦截 OpenRouter 接口回放真实 fixture，让测试走完整真实渲染管线
 *  （getJSON → unwrap → prepareBench → renderAll），不依赖线上接口可用性。 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const fx = n => JSON.parse(readFileSync(join(HERE, "fixtures", n + ".json"), "utf-8"));

/* URL 片段 → fixture 文件名（与 app.js ENDPOINTS 一一对应） */
const FIXTURES = {
  "rankings/models?view=day": "usage",
  "rankings/benchmarks": "bench",
  "rankings/model-rankings-chart": "trend",
  "rankings/discovery": "disc",
  "rankings/task-spend": "spend",
  "rankings/performance": "perf",
  "rankings/programming-language": "prog",
  "rankings/natural-language": "nl",
  "rankings/context-length": "ctx",
  "rankings/images": "images",
  "rankings/tools": "tools",
  "rankings/video-output-hours": "video",
  "catalog/models": "catalog",
};

export async function intercept(page, mode = "replay") {
  await page.route(/https:\/\/fonts\.(loli\.net|googleapis\.com|gstatic\.com)\//, route => route.abort());
  await page.route("**/openrouter.ai/**", async route => {
    if (mode === "abort") return route.abort();
    const url = route.request().url();
    for (const [needle, name] of Object.entries(FIXTURES)) {
      if (url.includes(needle)) {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(fx(name)) });
      }
    }
    return route.fulfill({ status: 404, body: "{}", contentType: "application/json" });
  });
}
