import { useEffect, useMemo, useRef, useState } from "react";
import type { Blog } from "../../shared/blogs";
import { usePresence } from "../lib/usePresence";

interface DirectoryProps {
  open: boolean;
  blogs: Blog[];
  onClose: () => void;
  onPick: (blog: Blog) => void;
}

const PAGE = 60;

export default function Directory({ open, blogs, onClose, onPick }: DirectoryProps) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mounted, shown } = usePresence(open, 240);

  useEffect(() => {
    if (open) {
      setLimit(PAGE);
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    setLimit(PAGE);
  }, [query]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? blogs.filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            b.url.toLowerCase().includes(q) ||
            b.tags.some((t) => t.toLowerCase().includes(q)),
        )
      : blogs;
    return list;
  }, [blogs, query]);

  if (!mounted) return null;

  return (
    <div className={`drawer${shown ? " is-open" : ""}`} role="dialog" aria-label="博客目录">
      <div className="drawer-card">
        <div className="drawer-head">
          <div>
            <h2>博客目录</h2>
            <p>
              共 {results.length.toLocaleString("en-US")} 间
              {query ? ` · 匹配 “${query}”` : " · 按名录顺序"}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭目录">
            ✕
          </button>
        </div>

        <input
          ref={inputRef}
          className="search"
          value={query}
          placeholder="搜索博客名、域名或标签…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && results[0]) onPick(results[0]);
          }}
        />

        <ul className="rows">
          {results.slice(0, limit).map((b) => {
            return (
              <li key={b.id}>
                <button className="row" onClick={() => onPick(b)}>
                  <span className="row-name">{b.name}</span>
                  <span className="row-tags">{b.tags.slice(0, 2).join(" / ")}</span>
                  <span className={`row-state${b.dead ? " is-dead" : ""}`}>{b.dead ? "失效" : "活跃"}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {limit < results.length && (
          <button className="btn ghost wide" onClick={() => setLimit((l) => l + PAGE)}>
            继续加载（还有 {results.length - limit} 间）
          </button>
        )}
      </div>
      <button className="drawer-backdrop" onClick={onClose} aria-label="关闭" />
    </div>
  );
}
