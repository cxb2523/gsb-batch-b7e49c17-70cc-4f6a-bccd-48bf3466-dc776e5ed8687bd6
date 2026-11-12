import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import Buildings from "../scene/Buildings";
import { useCanvasPicking } from "../scene/useCanvasPicking";
import type { CameraInteraction } from "../lib/picking";
import type { CityBuilding, CityLayout } from "../lib/types";
import type { Blog } from "../../shared/blogs";

// ─── 验证场景：两栋相邻的楼 + 周围大片空白 ─────────────────────
// 复用与正式城市完全相同的 <Buildings>（实例化渲染 + 点选/悬停逻辑）和
// useCanvasPicking（按下/拖动/滚轮守卫），只是数据换成两栋假楼。

function fakeBlog(id: string, name: string, fresh: number): Blog {
  return {
    id,
    num: 0,
    name,
    url: `https://example.com/${id}`,
    feed: "",
    tags: ["验证", "测试"],
    dead: false,
    reason: "",
    fresh,
  };
}

const TOWER_A: CityBuilding = {
  i: 0,
  blog: fakeBlog("alpha", "阿尔法博客", 0.9),
  x: -11,
  z: 0,
  w: 18,
  d: 18,
  h: 64,
  lit: 0.7,
  cols: 6,
  seed: 0.31,
  color: "#7fb2ff",
};

const TOWER_B: CityBuilding = {
  i: 1,
  blog: fakeBlog("beta", "贝塔博客", 0.4),
  x: 11,
  z: 0,
  w: 18,
  d: 18,
  h: 44,
  lit: 0.35,
  cols: 6,
  seed: 0.72,
  color: "#ffb27f",
};

const layout: CityLayout = {
  buildings: [TOWER_A, TOWER_B],
  roads: [],
  trees: [],
  plaza: 0,
  extent: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
};

const FOG = { color: "#0b1020", near: 260, far: 900 };

/** 与正式 Rig 相同的规则：按住指针期间暂停自动旋转，松手恢复 */
function VerifyRig({ interaction }: { interaction: React.MutableRefObject<CameraInteraction> }) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  useFrame(() => {
    const ctl = controls.current;
    if (!ctl) return;
    const want = !interaction.current.pressing;
    if (ctl.autoRotate !== want) ctl.autoRotate = want;
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      autoRotate
      autoRotateSpeed={0.6}
      minDistance={40}
      maxDistance={600}
      maxPolarAngle={Math.PI / 2.1}
      target={[0, 25, 0]}
    />
  );
}

function HoverBox({ building }: { building: CityBuilding | null }) {
  if (!building) return null;
  return (
    <mesh position={[building.x, (building.h + 1) / 2, building.z]}>
      <boxGeometry args={[building.w + 1.6, building.h + 1, building.d + 1.6]} />
      <meshBasicMaterial color="#fff6d8" transparent opacity={0.25} wireframe depthWrite={false} />
    </mesh>
  );
}

/** 把 three 的 get() 暴露给测试脚本，用于投影坐标和读取相机 */
function Probe({ probeRef }: { probeRef: React.MutableRefObject<RootState["get"] | null> }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    probeRef.current = get;
  }, [get, probeRef]);
  return null;
}

interface Pt {
  x: number;
  y: number;
}

interface Result {
  name: string;
  pass: boolean;
  detail: string;
}

const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

export default function VerifyApp() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);

  const selectedRef = useRef<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const probeRef = useRef<RootState["get"] | null>(null);

  const { interaction, canvasProps } = useCanvasPicking(() => handleSelect(null));

  function handleSelect(b: CityBuilding | null) {
    selectedRef.current = b ? b.blog.id : null;
    setSelectedId(b ? b.blog.id : null);
  }
  function handleHover(b: CityBuilding | null) {
    hoveredRef.current = b ? b.blog.id : null;
    setHoveredId(b ? b.blog.id : null);
  }

  const hovered = useMemo(
    () => layout.buildings.find((b) => b.blog.id === hoveredId) ?? null,
    [hoveredId],
  );

  // ── 事件注入工具 ────────────────────────────────────────────
  const getCanvas = () => probeRef.current!().gl.domElement;

  const toScreen = (x: number, y: number, z: number): Pt => {
    const state = probeRef.current!();
    const v = new THREE.Vector3(x, y, z).project(state.camera);
    const rect = state.gl.domElement.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (1 - (v.y * 0.5 + 0.5)) * rect.height,
    };
  };

  /** 楼群上空一点：必然落在空白区域 */
  const skyPoint = (): Pt => {
    const rect = getCanvas().getBoundingClientRect();
    const p = toScreen(0, 500, 0);
    const inside =
      p.x > rect.left + 4 && p.x < rect.right - 4 && p.y > rect.top + 4 && p.y < rect.bottom - 4;
    return inside ? p : { x: rect.left + 8, y: rect.top + 8 };
  };

  const firePointer = (type: string, p: Pt, buttons: number) => {
    getCanvas().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: p.x,
        clientY: p.y,
        button: 0,
        buttons,
        pointerId: 1,
        isPrimary: true,
        pointerType: "mouse",
      }),
    );
  };

  const fireClick = (p: Pt) => {
    getCanvas().dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }),
    );
  };

  const fireWheel = (p: Pt) => {
    getCanvas().dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: p.x,
        clientY: p.y,
        deltaY: -120,
      }),
    );
  };

  const tapAt = async (p: Pt) => {
    firePointer("pointerdown", p, 1);
    await frame();
    firePointer("pointerup", p, 0);
    fireClick(p);
    await frame();
  };

  const log = (name: string, pass: boolean, detail: string) =>
    setResults((r) => [...r, { name, pass, detail }]);

  // ── 四类路径的自动化用例 ────────────────────────────────────
  const runTests = async () => {
    setRunning(true);
    setResults([]);
    // 让指针“进入”画布，悬停检测才开始工作
    getCanvas().dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
    await frame();

    // T1 正常点选：按下与抬起都落在塔 A 上
    {
      const p = toScreen(TOWER_A.x, TOWER_A.h * 0.55, TOWER_A.z);
      await tapAt(p);
      log(
        "T1 正常点选：按下/抬起同一栋楼 → 选中",
        selectedRef.current === "alpha",
        `期望 selected=alpha，实际=${selectedRef.current}`,
      );
    }

    // T2a 拖动旋转后抬起：不选中、不收起
    {
      const before = selectedRef.current;
      const p0 = toScreen(TOWER_A.x, TOWER_A.h * 0.55, TOWER_A.z);
      firePointer("pointerdown", p0, 1);
      await frame();
      let p = p0;
      for (let i = 1; i <= 6; i++) {
        p = { x: p0.x + i * 24, y: p0.y - i * 6 };
        firePointer("pointermove", p, 1);
        await frame();
      }
      firePointer("pointerup", p, 0);
      fireClick(p);
      await frame();
      log(
        "T2a 拖动相机后抬起 → 不触发选中",
        selectedRef.current === before,
        `拖动前 selected=${before}，拖动后=${selectedRef.current}`,
      );
    }

    // T2b 拖出去再拖回原位：净位移为 0，但行程超过 8px，仍不算点击
    {
      const before = selectedRef.current;
      const p0 = toScreen(TOWER_A.x, TOWER_A.h * 0.55, TOWER_A.z);
      firePointer("pointerdown", p0, 1);
      await frame();
      firePointer("pointermove", { x: p0.x + 120, y: p0.y }, 1);
      await frame();
      firePointer("pointermove", p0, 1);
      await frame();
      firePointer("pointerup", p0, 0);
      fireClick(p0);
      await frame();
      log(
        "T2b 拖走又拖回原位（净位移 0）→ 不触发选中",
        selectedRef.current === before,
        `之前 selected=${before}，之后=${selectedRef.current}`,
      );
    }

    // T2c 按住期间滚轮缩放：抬起不算点击
    {
      const before = selectedRef.current;
      const p = toScreen(TOWER_A.x, TOWER_A.h * 0.55, TOWER_A.z);
      firePointer("pointerdown", p, 1);
      await frame();
      fireWheel(p);
      await frame();
      firePointer("pointerup", p, 0);
      fireClick(p);
      await frame();
      log(
        "T2c 按住期间滚轮缩放 → 抬起不触发选中",
        selectedRef.current === before,
        `之前 selected=${before}，之后=${selectedRef.current}`,
      );
    }

    // T3 先点中塔 A，再点空白处：卡片收起
    {
      await tapAt(toScreen(TOWER_A.x, TOWER_A.h * 0.55, TOWER_A.z));
      const got = selectedRef.current;
      const sky = skyPoint();
      firePointer("pointerdown", sky, 1);
      await frame();
      firePointer("pointerup", sky, 0);
      fireClick(sky);
      await frame();
      log(
        "T3 点空白处 → 收起卡片",
        got === "alpha" && selectedRef.current === null,
        `点楼后 selected=${got}，点空白后=${selectedRef.current}`,
      );
    }

    // T4a 悬停塔 B：高亮 + 指针样式
    {
      const p = toScreen(TOWER_B.x, TOWER_B.h * 0.5, TOWER_B.z);
      firePointer("pointermove", p, 0);
      await frame();
      log(
        "T4a 悬停进入塔 B → 高亮 + pointer 指针",
        hoveredRef.current === "beta" && document.body.style.cursor === "pointer",
        `hovered=${hoveredRef.current}，cursor="${document.body.style.cursor}"`,
      );
    }

    // T4b 移到空白：清除高亮与指针样式
    {
      firePointer("pointermove", skyPoint(), 0);
      await frame();
      log(
        "T4b 移出楼群到空白 → 清除悬停",
        hoveredRef.current === null && document.body.style.cursor === "",
        `hovered=${hoveredRef.current}，cursor="${document.body.style.cursor}"`,
      );
    }

    // T4c 移入塔 A 再离开画布：悬停随之更新并清除
    {
      const p = toScreen(TOWER_A.x, TOWER_A.h * 0.55, TOWER_A.z);
      firePointer("pointermove", p, 0);
      await frame();
      const onA = hoveredRef.current;
      getCanvas().dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
      await frame();
      log(
        "T4c 悬停塔 A 后指针离开画布 → 清除悬停",
        onA === "alpha" && hoveredRef.current === null && document.body.style.cursor === "",
        `在塔A时 hovered=${onA}，离开后=${hoveredRef.current}，cursor="${document.body.style.cursor}"`,
      );
    }

    setRunning(false);
  };

  const passed = results.filter((r) => r.pass).length;

  return (
    <div className="verify">
      <div className="verify-scene">
        <Canvas
          dpr={[1, 1.8]}
          camera={{ position: [70, 70, 120], fov: 45, near: 2, far: 4000 }}
          gl={{ antialias: true }}
          onCreated={({ gl }) => gl.setClearColor("#0b1020")}
          {...canvasProps}
        >
          <ambientLight intensity={0.6} />
          <hemisphereLight args={["#3d5c8c", "#0a0f18", 2]} />
          {/* 地面只作视觉参照，不挂事件：它和天空一起构成“空白区域” */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
            <planeGeometry args={[600, 600]} />
            <meshBasicMaterial color="#131c30" />
          </mesh>
          <gridHelper args={[200, 20, "#233052", "#1a2540"]} position={[0, 0.02, 0]} />
          <Buildings
            layout={layout}
            onHover={handleHover}
            onSelect={handleSelect}
            fog={FOG}
            interaction={interaction}
          />
          <HoverBox building={hovered} />
          <VerifyRig interaction={interaction} />
          <Probe probeRef={probeRef} />
        </Canvas>
      </div>

      <div className="verify-panel">
        <h1>点选 / 悬停验证场景</h1>
        <div>
          <span className="verify-tag">两栋相邻楼</span>
          <span className="verify-tag">周围为空白区域</span>
          <span className="verify-tag">复用正式点选逻辑</span>
        </div>

        <div className="verify-status">
          当前选中：{selectedId ?? "（无）"}
          {"\n"}当前悬停：{hoveredId ?? "（无）"}
          {"\n"}指针样式：{typeof document !== "undefined" ? document.body.style.cursor || "默认" : ""}
        </div>

        <button onClick={runTests} disabled={running}>
          {running ? "测试运行中…" : "运行全部自动测试"}
        </button>
        {results.length > 0 && (
          <div className="verify-status">
            通过 {passed} / {results.length}
          </div>
        )}

        <ul className="verify-results">
          {results.map((r) => (
            <li key={r.name} className={r.pass ? "pass" : "fail"}>
              {r.pass ? "✅" : "❌"} {r.name}
              <span className="detail">{r.detail}</span>
            </li>
          ))}
        </ul>

        <h2>手动观察（与正式城市行为一致）</h2>
        <ol>
          <li>单击任意一栋楼 → 右侧面板“当前选中”变为 alpha / beta，楼顶出现高亮框。</li>
          <li>按住拖动旋转视角后松开 → 选中状态不变，不会误选中松开位置下的楼。</li>
          <li>按住左键同时滚轮缩放再松开 → 同样不触发选中。</li>
          <li>选中后单击天空或地面空白 → “当前选中”清空（正式城市中同时把旋转中心交还城中心）。</li>
          <li>鼠标在楼之间移动 → “当前悬停”实时变化，楼体出现线框高亮，指针变为手型；移到空白或移出画布 → 高亮与手型消失。</li>
          <li>场景默认缓慢自动旋转：按住鼠标时旋转暂停，松手恢复——这样按下与抬起命中的是同一栋楼。</li>
        </ol>
      </div>
    </div>
  );
}
