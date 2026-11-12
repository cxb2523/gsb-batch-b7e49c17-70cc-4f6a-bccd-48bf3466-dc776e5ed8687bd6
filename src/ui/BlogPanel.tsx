import { useEffect, useRef, useState } from "react";
import type { CityBuilding } from "../lib/types";
import { usePresence } from "../lib/usePresence";

interface BlogPanelProps {
  building: CityBuilding | null;
  onClose: () => void;
  onRandom: () => void;
}

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function BlogPanel({ building, onClose, onRandom }: BlogPanelProps) {
  const [copied, setCopied] = useState(false);
  const { mounted, shown } = usePresence(Boolean(building), 240);
  // keep the last card on screen while it slides away
  const last = useRef<CityBuilding | null>(null);
  if (building) last.current = building;

  useEffect(() => {
    setCopied(false);
  }, [building?.blog.id]);

  const current = building ?? last.current;
  if (!mounted || !current) return null;
  const { blog, h } = current;
  const floors = Math.max(2, Math.round(h / 3.2));
  const freshPct = Math.round(blog.fresh * 100);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(blog.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className={`panel${shown ? " is-open" : ""}`} role="dialog" aria-label={`${blog.name} 的博客信息`}>
      <div className="panel-head">
        <span className={`tag-state${blog.dead ? " is-dead" : ""}`}>{blog.dead ? "疑似失效" : "活跃"}</span>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>

      <h2 className="panel-title">{blog.name}</h2>
      <p className="panel-host">https://{host(blog.url)}</p>

      {blog.tags.length > 0 && (
        <div className="tag-list">
          {blog.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-k">楼层</span>
          <span className="stat-v">{floors}</span>
        </div>
        <div className="stat">
          <span className="stat-k">{blog.dead ? "状态" : "活跃度"}</span>
          <span className={`stat-v${blog.dead ? " is-dead" : ""}`}>{blog.dead ? "疑似失效" : `${freshPct}%`}</span>
        </div>
        <div className="stat">
          <span className="stat-k">名录</span>
          <span className="stat-v">#{blog.num}</span>
        </div>
      </div>

      {!blog.dead && (
        <>
          <div className="meter" title="距上次发文越近，灯越亮">
            <span style={{ width: `${Math.max(4, freshPct)}%` }} />
          </div>
          <p className="panel-note">活跃度 = 1 / (1 + 距上次发文天数 / 90)，数据来自列表的公开状态接口</p>
        </>
      )}

      {blog.dead && blog.reason && (
        <p className="note">
          抓取失败原因：<code>{blog.reason}</code>
          <br />
          楼还立着，只是灯灭了。如果你认识这位博主，欢迎去列表仓库提 PR 更新 RSS。
        </p>
      )}

      <div className="panel-actions">
        <a className="btn primary" href={blog.url} target="_blank" rel="noreferrer noopener">
          打开博客 ↗
        </a>
        {blog.feed ? (
          <a className="btn" href={blog.feed} target="_blank" rel="noreferrer noopener">
            RSS ↗
          </a>
        ) : null}
        <button className="btn" onClick={copy}>
          {copied ? "已复制" : "复制链接"}
        </button>
      </div>

      <button className="btn ghost" onClick={onRandom}>
        随机逛逛另一座大厦 →
      </button>
    </aside>
  );
}
