import type { CatalogStats } from "../../shared/blogs";

interface HudProps {
  stats: CatalogStats;
  onDirectory: () => void;
  onRandom: () => void;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export default function Hud({ stats, onDirectory, onRandom }: HudProps) {
  return (
    <>
      <header className="brand">
        <div className="brand-mark">
          <span className="brand-cn">博客之城</span>
          <span className="brand-en">BLOG CITY</span>
        </div>
        <p className="brand-meta">
          <strong>{fmt(stats.total)}</strong> 座大厦 · <strong>{fmt(stats.dead)}</strong> 座疑似废弃
        </p>
      </header>

      <div className="top-actions">
        <button className="btn" onClick={onDirectory}>
          搜索
        </button>
        <button className="btn" onClick={onRandom}>
          随机
        </button>
      </div>

      <p className="hint">
        拖动旋转 · 滚轮缩放 · 点击大厦 · <kbd>R</kbd> 随机 · <kbd>Esc</kbd> 关闭
      </p>
    </>
  );
}
