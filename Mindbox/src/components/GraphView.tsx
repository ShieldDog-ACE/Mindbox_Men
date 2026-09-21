import { useEffect, useMemo, useRef, useState } from "react";
import { api, GraphLink, GraphNode } from "../lib/api";
import { IconFocus, IconOrphan } from "./icons";
import { loadSettings } from "./SettingsModal";

interface Props {
  focusPath?: string; // 本地图谱中心(当前笔记)
  onOpen: (path: string) => void;
  onClose: () => void;
}

interface Sim extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

const FOLDER_COLORS = ["#a882ff", "#7fd3a8", "#ffb36b", "#7fb0ff", "#ff8fa3", "#e8d26a", "#6ad4d4", "#d69aff"];

/**
 * 关系图谱 v3:力导向 + SVG。
 * 性能:布局循环直接写 DOM(translate/x1y1x2y2),平移缩放同理,只在结构/高亮变化时走 React 渲染。
 * 交互:单击选中(高亮邻域),双击打开笔记(手动判定,抗布局漂移);拖拽带惯性,边界弹性反弹。
 */
export default function GraphView({ focusPath, onOpen, onClose }: Props) {
  const [all, setAll] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [onlyOrphans, setOnlyOrphans] = useState(false);
  const [localMode, setLocalMode] = useState(!!focusPath);
  const [selected, setSelected] = useState<string | null>(null);
  const simsRef = useRef<Sim[]>([]);
  const [sims, setSims] = useState<Sim[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const alphaRef = useRef(1);
  const rafRef = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const rootGRef = useRef<SVGGElement>(null);
  const nodeElsRef = useRef<Map<string, SVGGElement>>(new Map());
  const lineElsRef = useRef<Map<number, SVGLineElement>>(new Map());
  const centerRef = useRef({ x: 420, y: 300 });
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<Sim | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false); // 本次按下是否超过拖动阈值(区分点击与拖拽)
  const dragVelRef = useRef({ vx: 0, vy: 0 }); // 松手惯性
  const lastPtRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastClickRef = useRef<{ id: string; t: number } | null>(null); // 手动双击判定
  // 图谱自定义(节点大小/颜色),跟随设置实时生效
  const [gs, setGs] = useState(() => ({ scale: 1, colorMode: "folder" as "folder" | "custom", color: "#a882ff" }));
  useEffect(() => {
    const sync = () => {
      const s = loadSettings();
      setGs({
        scale: s.graphNodeScale ?? 1,
        colorMode: s.graphColorMode ?? "folder",
        color: s.graphNodeColor ?? "#a882ff",
      });
    };
    sync();
    window.addEventListener("mindbox-settings-changed", sync);
    return () => window.removeEventListener("mindbox-settings-changed", sync);
  }, []);

  // Esc 返回(焦点在输入框/编辑器内时不触发)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tgt = e.target as HTMLElement | null;
      if (tgt?.closest?.("input, textarea, .cm-editor")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    api.graph().then(setAll);
  }, []);

  // 可见子图:全局 / 本地(一跳邻域) / 孤立
  const visible = useMemo(() => {
    let nodes = all.nodes;
    let links = all.links;
    if (localMode && focusPath) {
      const keep = new Set<string>([focusPath]);
      for (const l of links) {
        if (l.source === focusPath) keep.add(l.target);
        if (l.target === focusPath) keep.add(l.source);
      }
      nodes = nodes.filter((n) => keep.has(n.id));
      links = links.filter((l) => keep.has(l.source) && keep.has(l.target));
    }
    if (onlyOrphans) {
      const linked = new Set<string>();
      for (const l of links) {
        linked.add(l.source);
        linked.add(l.target);
      }
      nodes = nodes.filter((n) => !linked.has(n.id));
      links = [];
    }
    return { nodes, links };
  }, [all, onlyOrphans, localMode, focusPath]);

  // 子图变化 → 重建模拟(以画布中心为圆心展开)
  useEffect(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect && rect.width > 50) centerRef.current = { x: rect.width / 2, y: rect.height / 2 };
    const { x: cx, y: cy } = centerRef.current;
    const R = Math.min(340, 120 + visible.nodes.length * 18);
    const next: Sim[] = visible.nodes.map((n, i) => {
      const old = simsRef.current.find((s) => s.id === n.id);
      if (old) return { ...n, x: old.x, y: old.y, vx: 0, vy: 0 };
      const a = (2 * Math.PI * i) / Math.max(visible.nodes.length, 1);
      return { ...n, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, vx: 0, vy: 0 };
    });
    simsRef.current = next;
    setSims(next);
    linksRef.current = visible.links;
    alphaRef.current = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 位置直接写 DOM,绕过 React 渲染(丝滑的关键)
  const syncDom = () => {
    const ns = simsRef.current;
    for (const n of ns) {
      nodeElsRef.current.get(n.id)?.setAttribute("transform", `translate(${n.x},${n.y})`);
    }
    const idx = new Map(ns.map((n) => [n.id, n]));
    const ls = linksRef.current;
    for (let i = 0; i < ls.length; i++) {
      const el = lineElsRef.current.get(i);
      if (!el) continue;
      const a = idx.get(ls[i].source);
      const b = idx.get(ls[i].target);
      if (!a || !b) continue;
      el.setAttribute("x1", String(a.x));
      el.setAttribute("y1", String(a.y));
      el.setAttribute("x2", String(b.x));
      el.setAttribute("y2", String(b.y));
    }
  };

  const applyView = () => {
    const v = viewRef.current;
    rootGRef.current?.setAttribute("transform", `translate(${v.x},${v.y}) scale(${v.k})`);
  };

  // 力导向模拟
  useEffect(() => {
    if (!sims.length) return;
    const step = () => {
      const alpha = alphaRef.current;
      if (alpha > 0.005) {
        const ns = simsRef.current;
        let moving = dragRef.current != null; // 拖拽中始终同步
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const dx = ns[j].x - ns[i].x;
            const dy = ns[j].y - ns[i].y;
            const d2 = dx * dx + dy * dy || 1;
            const f = (2400 / d2) * alpha;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * f;
            const fy = (dy / d) * f;
            ns[i].vx -= fx;
            ns[i].vy -= fy;
            ns[j].vx += fx;
            ns[j].vy += fy;
          }
        }
        const idx = new Map(ns.map((n, i) => [n.id, i]));
        for (const l of linksRef.current) {
          const a = ns[idx.get(l.source)!];
          const b = ns[idx.get(l.target)!];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - 120) * 0.02 * alpha;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
        for (const n of ns) {
          n.vx += (centerRef.current.x - n.x) * 0.008 * alpha;
          n.vy += (centerRef.current.y - n.y) * 0.008 * alpha;
          if (n.fixed) {
            n.vx = 0;
            n.vy = 0;
            continue;
          }
          n.vx *= 0.85;
          n.vy *= 0.85;
          n.x += n.vx;
          n.y += n.vy;
          if (Math.abs(n.vx) > 0.05 || Math.abs(n.vy) > 0.05) moving = true;
        }
        // 视口边界:弹性反弹而非生硬卡停
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect && rect.width > 50) {
          const v = viewRef.current;
          const pad = 16;
          const L = -v.x / v.k + pad;
          const T = -v.y / v.k + pad;
          const R = (rect.width - v.x) / v.k - pad;
          const B = (rect.height - v.y) / v.k - pad;
          for (const n of ns) {
            if (n.fixed) continue;
            if (n.x < L) {
              n.x = L;
              n.vx = Math.abs(n.vx) * 0.6;
            } else if (n.x > R) {
              n.x = R;
              n.vx = -Math.abs(n.vx) * 0.6;
            }
            if (n.y < T) {
              n.y = T;
              n.vy = Math.abs(n.vy) * 0.6;
            } else if (n.y > B) {
              n.y = B;
              n.vy = -Math.abs(n.vy) * 0.6;
            }
          }
        }
        alphaRef.current = alpha * 0.98; // 衰减加快:~3 秒静止,之后不再写 DOM,悬停零争抢
        if (moving) syncDom();
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [sims]);

  // 悬停完全交给 CSS(:hover + :has),滑动时零 React 渲染;选中(单击)才走 React 做邻域高亮
  const activeId = selected;
  const neighbors = useMemo(() => {
    if (!activeId) return null;
    const set = new Set<string>([activeId]);
    for (const l of linksRef.current) {
      if (l.source === activeId) set.add(l.target);
      if (l.target === activeId) set.add(l.source);
    }
    return set;
  }, [activeId]);

  const folderColor = (id: string) => {
    const folder = id.includes("/") ? id.split("/")[0] : "根目录";
    let h = 0;
    for (const c of folder) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return FOLDER_COLORS[h % FOLDER_COLORS.length];
  };

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (e.clientX - rect.left - v.x) / v.k, y: (e.clientY - rect.top - v.y) / v.k };
  };

  // 全局拖拽/平移:移出画布不丢手势;微动(<3px)不算拖拽,点击零扰动
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const d = downRef.current;
        if (!movedRef.current && d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
        movedRef.current = true;
        const n = dragRef.current;
        const p = toSvg(e);
        n.x = p.x;
        n.y = p.y;
        n.fixed = true;
        alphaRef.current = Math.max(alphaRef.current, 0.25); // 只有真拖拽才唤醒布局
        const now = performance.now();
        const lp = lastPtRef.current;
        if (lp && now > lp.t) {
          const dt = Math.max(now - lp.t, 1);
          dragVelRef.current.vx = ((e.clientX - lp.x) / dt) * 16 / viewRef.current.k;
          dragVelRef.current.vy = ((e.clientY - lp.y) / dt) * 16 / viewRef.current.k;
        }
        lastPtRef.current = { x: e.clientX, y: e.clientY, t: now };
        syncDom();
      } else if (panRef.current) {
        viewRef.current.x += e.clientX - panRef.current.x;
        viewRef.current.y += e.clientY - panRef.current.y;
        panRef.current = { x: e.clientX, y: e.clientY };
        applyView();
      }
    };
    const onUp = () => {
      const n = dragRef.current;
      if (n) {
        n.fixed = false;
        if (movedRef.current) {
          // 拖拽松手:按最近速度惯性滑行 + 弹墙
          const cap = 36;
          n.vx = Math.max(-cap, Math.min(cap, dragVelRef.current.vx));
          n.vy = Math.max(-cap, Math.min(cap, dragVelRef.current.vy));
          alphaRef.current = Math.max(alphaRef.current, 0.5);
        } else {
          n.vx = 0; // 纯点击:不扰动布局,双击不漂移
          n.vy = 0;
        }
      }
      dragRef.current = null;
      panRef.current = null;
      lastPtRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    const v = viewRef.current;
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const k = Math.min(3, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    v.x = mx - ((mx - v.x) * k) / v.k;
    v.y = my - ((my - v.y) * k) / v.k;
    v.k = k;
    applyView();
  };

  const v = viewRef.current;
  const links = linksRef.current;
  const idx = new Map(simsRef.current.map((n) => [n.id, n]));

  return (
    <main className="workarea">
      <header className="work-head">
        <span className="note-title">{localMode && focusPath ? `本地图谱 · ${focusPath.split("/").pop()!.replace(/\.md$/, "")}` : "关系图谱"}</span>
        <div className="work-actions">
          <button className={`icon-btn ${localMode ? "primary" : ""}`} onClick={() => setLocalMode((v) => !v)} disabled={!focusPath} title="本地图谱:当前笔记的邻域">
            <IconFocus />
          </button>
          <button className={`icon-btn ${onlyOrphans ? "primary" : ""}`} onClick={() => setOnlyOrphans((v) => !v)} title="只看孤立笔记(无链接)">
            <IconOrphan />
          </button>
        </div>
      </header>
      <svg
        ref={svgRef}
        className="graph-svg"
        onWheel={onWheel}
        onMouseDown={(e) => (panRef.current = { x: e.clientX, y: e.clientY })}
      >
        <g ref={rootGRef} transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
          {links.map((l, i) => {
            const a = idx.get(l.source);
            const b = idx.get(l.target);
            if (!a || !b) return null;
            const dim = neighbors && !(neighbors.has(l.source) && neighbors.has(l.target));
            const focusEdge = l.source === selected || l.target === selected;
            return (
              <line
                key={i}
                ref={(el) => {
                  if (el) lineElsRef.current.set(i, el);
                  else lineElsRef.current.delete(i);
                }}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                className={`graph-edge ${focusEdge ? "focus" : ""} ${dim ? "dim" : ""}`}
              />
            );
          })}
          {simsRef.current.map((n) => {
            const r = (6 + Math.min(n.degree ?? 0, 12) * 1.5) * gs.scale;
            const hit = Math.max(r + 10, 18); // 碰撞箱半径:大于球体,悬停判定宽松且不重叠
            const dim = neighbors && !neighbors.has(n.id);
            const focus = n.id === activeId;
            const col = gs.colorMode === "custom" ? gs.color : folderColor(n.id);
            return (
              <g
                key={n.id}
                ref={(el) => {
                  if (el) nodeElsRef.current.set(n.id, el);
                  else nodeElsRef.current.delete(n.id);
                }}
                transform={`translate(${n.x},${n.y})`}
                className={`graph-node ${dim ? "dim" : ""} ${focus ? "focus" : ""}`}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = n;
                  downRef.current = { x: e.clientX, y: e.clientY };
                  lastPtRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
                  dragVelRef.current = { vx: 0, vy: 0 };
                  movedRef.current = false;
                }}
                onClick={() => {
                  // 拖拽不算点击;单击选中;350ms 内同节点二击 = 打开(手动判定,节点漂移也不丢)
                  if (movedRef.current) return;
                  const now = performance.now();
                  const last = lastClickRef.current;
                  if (last && last.id === n.id && now - last.t < 350) {
                    lastClickRef.current = null;
                    if (!n.missing) onOpen(n.id);
                  } else {
                    lastClickRef.current = { id: n.id, t: now };
                    setSelected(n.id);
                  }
                }}
              >
                {/* 碰撞箱:透明捕获层,悬停/离开判定全看它(球体本身缩放不影响判定面积) */}
                <circle r={hit} fill="transparent" className="graph-hit" />
                <circle r={r} fill={col} style={{ color: col }} className={n.missing ? "graph-dot missing" : "graph-dot"} />
                <text y={r + 13} textAnchor="middle" className="graph-label">
                  {n.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <footer className="graph-foot">拖动节点(松手带惯性) · 滚轮缩放 · 空白拖拽平移 · 单击选中 · 双击打开笔记 · 颜色 = 顶层目录/自定义</footer>
    </main>
  );
}
