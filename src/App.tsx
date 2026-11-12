import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import catalogJson from "./data/blogs.json";
import type { Blog, Catalog } from "../shared/blogs";
import { buildCity } from "./lib/layout";
import type { CityBuilding } from "./lib/types";
import CityScene, { type FocusTarget } from "./scene/CityScene";
import Hud from "./ui/Hud";
import BlogPanel from "./ui/BlogPanel";
import Directory from "./ui/Directory";

const catalog = catalogJson as unknown as Catalog;

export default function App() {
  const city = useMemo(() => buildCity(catalog.blogs), []);
  const byId = useMemo(() => new Map(city.buildings.map((b) => [b.blog.id, b])), [city]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [homeToken, setHomeToken] = useState(0);
  const [dirOpen, setDirOpen] = useState(false);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  const tokenRef = useRef(0);

  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const hovered = hoveredId ? (byId.get(hoveredId) ?? null) : null;

  const flyTo = useCallback((b: CityBuilding) => {
    tokenRef.current += 1;
    setFocus({ x: b.x, z: b.z, h: b.h, token: tokenRef.current });
  }, []);

  const select = useCallback(
    (b: CityBuilding | null) => {
      setSelectedId(b ? b.blog.id : null);
      if (b) flyTo(b);
      // deselecting hands the orbit centre back to the middle of the city
      else setHomeToken((t) => t + 1);
    },
    [flyTo],
  );

  const random = useCallback(() => {
    const pool = city.buildings;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) select(pick);
  }, [city.buildings, select]);

  const pickBlog = useCallback(
    (blog: Blog) => {
      const b = byId.get(blog.id);
      if (b) select(b);
      setDirOpen(false);
    },
    [byId, select],
  );

  // tooltip follows the pointer
  useEffect(() => {
    if (!hovered) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setPointer({ x: e.clientX, y: e.clientY });
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [hovered]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDirOpen(false);
        select(null);
      }
      if (e.key === "r" && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== "INPUT") random();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [random, select]);

  return (
    <div className="app">
      <div className="scene">
        <CityScene
          layout={city}
          selected={selected}
          hovered={hovered}
          focus={focus}
          homeToken={homeToken}
          onHover={(b) => setHoveredId(b ? b.blog.id : null)}
          onSelect={select}
        />
      </div>

      <div className="ui">
        <Hud
          stats={catalog.stats}
          onDirectory={() => setDirOpen(true)}
          onRandom={random}
        />

        <BlogPanel building={selected} onClose={() => select(null)} onRandom={random} />

        <footer className="credit">
          数据：<a href="https://github.com/timqian/chinese-independent-blogs" target="_blank" rel="noreferrer noopener">中文独立博客列表</a>
          {" · "}
          {catalog.stats.total.toLocaleString("en-US")} 个博客
        </footer>
      </div>

      {hovered && !selected && (
        <div
          className="tooltip"
          style={{
            left: Math.min(pointer.x + 16, window.innerWidth - 250),
            top: Math.min(pointer.y + 18, window.innerHeight - 80),
          }}
        >
          <b>{hovered.blog.name}</b>
          <span>{hovered.blog.tags.slice(0, 3).join(" · ") || "无标签"}</span>
          <em>{hovered.blog.dead ? "疑似失效 · 楼还立着" : `活跃度 ${Math.round(hovered.blog.fresh * 100)}%`}</em>
        </div>
      )}

      <Directory open={dirOpen} blogs={catalog.blogs} onClose={() => setDirOpen(false)} onPick={pickBlog} />

    </div>
  );
}
