// 字形（SVG path，100×100 画布）整体变换工具：
// 水平/垂直镜像、绕画布中心旋转、等比缩放、横纵平移。
// 确认前由 UI 做实时预览，确认时调用 computeGlyphTransform 烘焙成新的 path。

export const CANVAS_SIZE = 100;
export const CANVAS_CENTER = CANVAS_SIZE / 2;
/** 包围盒允许的活动区 [MARGIN, CANVAS_SIZE - MARGIN]，给笔画留安全边距 */
export const FIT_MARGIN = 2;
/** 较长边至少占画布的比例 */
export const MIN_LONG_RATIO = 0.6;

export interface TransformParams {
  flipH: boolean;
  flipV: boolean;
  angleDeg: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GlyphTransformResult {
  ok: boolean;
  error?: string;
  /** 烘焙后的 path（绝对坐标 M/L/C/A/Z） */
  path?: string;
  /** 供 <g transform="matrix(...)"> 实时预览使用的仿射矩阵 */
  matrix?: { a: number; b: number; c: number; d: number; e: number; f: number };
  bbox?: BBox;
  /** 自动适配所乘的总倍率（相对用户设定的 scale） */
  fitFactor?: number;
  autoAction?: 'shrink' | 'enlarge' | null;
}

type Point = { x: number; y: number };

type AbsCmd =
  | { c: 'M'; x: number; y: number }
  | { c: 'L'; x: number; y: number }
  | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | {
      c: 'A';
      rx: number;
      ry: number;
      xRot: number;
      largeArc: 0 | 1;
      sweep: 0 | 1;
      x: number;
      y: number;
    }
  | { c: 'Z' };

const TOKEN_RE = /([a-zA-Z])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;

/** 把任意合法 SVG path 解析成绝对命令（Q/T/S/H/V 一律折算成 L/C，弧线保留） */
export function parsePath(d: string): AbsCmd[] {
  const tokens = d.match(TOKEN_RE);
  if (!tokens) return [];

  const out: AbsCmd[] = [];
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let prevCmd = '';
  let prevCubicCtrl: Point | null = null;
  let prevQuadCtrl: Point | null = null;

  let i = 0;
  const num = (): number => {
    const t = tokens[i++];
    if (t === undefined) throw new Error('路径参数不完整');
    const v = Number(t);
    if (Number.isNaN(v)) throw new Error('路径含无效数值');
    return v;
  };
  const flag = (): 0 | 1 => {
    const v = num();
    if (v !== 0 && v !== 1) throw new Error('弧线标志位无效');
    return v;
  };

  while (i < tokens.length) {
    const tok = tokens[i];
    let letter: string;
    if (/[a-zA-Z]/.test(tok)) {
      letter = tok;
      i++;
    } else {
      // 缺省命令：跟在 M/m 后视为 L/l，其余延续上一条命令
      letter = prevCmd === 'M' ? 'L' : prevCmd === 'm' ? 'l' : prevCmd;
      if (!letter) throw new Error('路径格式错误');
    }
    const rel = letter === letter.toLowerCase() && letter !== 'z' && letter !== 'Z';
    const cmd = letter.toLowerCase();

    const pt = (x: number, y: number): Point =>
      rel ? { x: cur.x + x, y: cur.y + y } : { x, y };

    switch (cmd) {
      case 'm': {
        const p = pt(num(), num());
        cur = p;
        start = { ...p };
        out.push({ c: 'M', ...p });
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'l': {
        const p = pt(num(), num());
        out.push({ c: 'L', ...p });
        cur = p;
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'h': {
        const x = rel ? cur.x + num() : num();
        out.push({ c: 'L', x, y: cur.y });
        cur = { x, y: cur.y };
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'v': {
        const y = rel ? cur.y + num() : num();
        out.push({ c: 'L', x: cur.x, y });
        cur = { x: cur.x, y };
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'c': {
        const c1 = pt(num(), num());
        const c2 = pt(num(), num());
        const p = pt(num(), num());
        out.push({ c: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y });
        cur = p;
        prevCubicCtrl = c2;
        prevQuadCtrl = null;
        break;
      }
      case 's': {
        const c1: Point =
          prevCmd.toLowerCase() === 'c' || prevCmd.toLowerCase() === 's'
            ? { x: 2 * cur.x - (prevCubicCtrl?.x ?? cur.x), y: 2 * cur.y - (prevCubicCtrl?.y ?? cur.y) }
            : { ...cur };
        const c2 = pt(num(), num());
        const p = pt(num(), num());
        out.push({ c: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y });
        cur = p;
        prevCubicCtrl = c2;
        prevQuadCtrl = null;
        break;
      }
      case 'q': {
        const ctrl = pt(num(), num());
        const p = pt(num(), num());
        appendQuad(out, cur, ctrl, p);
        cur = p;
        prevQuadCtrl = ctrl;
        prevCubicCtrl = null;
        break;
      }
      case 't': {
        const ctrl: Point =
          prevCmd.toLowerCase() === 'q' || prevCmd.toLowerCase() === 't'
            ? { x: 2 * cur.x - (prevQuadCtrl?.x ?? cur.x), y: 2 * cur.y - (prevQuadCtrl?.y ?? cur.y) }
            : { ...cur };
        const p = pt(num(), num());
        appendQuad(out, cur, ctrl, p);
        cur = p;
        prevQuadCtrl = ctrl;
        prevCubicCtrl = null;
        break;
      }
      case 'a': {
        const rx = num();
        const ry = num();
        const xRot = num();
        const largeArc = flag();
        const sweep = flag();
        const p = pt(num(), num());
        out.push({ c: 'A', rx: Math.abs(rx), ry: Math.abs(ry), xRot, largeArc, sweep, x: p.x, y: p.y });
        cur = p;
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'z': {
        out.push({ c: 'Z' });
        cur = { ...start };
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      default:
        throw new Error(`不支持的路径命令：${letter}`);
    }
    prevCmd = cmd;
  }
  return out;
}

function appendQuad(out: AbsCmd[], p0: Point, ctrl: Point, p: Point) {
  const c1 = { x: p0.x + (2 / 3) * (ctrl.x - p0.x), y: p0.y + (2 / 3) * (ctrl.y - p0.y) };
  const c2 = { x: p.x + (2 / 3) * (ctrl.x - p.x), y: p.y + (2 / 3) * (ctrl.y - p.y) };
  out.push({ c: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y });
}

// ---------- 仿射 ----------

interface Lin {
  a: number; // x' = a x + c y
  c: number;
  b: number; // y' = b x + d y
  d: number;
}

const rotLin = (rad: number): Lin => ({
  a: Math.cos(rad),
  c: -Math.sin(rad),
  b: Math.sin(rad),
  d: Math.cos(rad),
});

const mulLin = (m: Lin, n: Lin): Lin => ({
  a: m.a * n.a + m.c * n.b,
  c: m.a * n.c + m.c * n.d,
  b: m.b * n.a + m.d * n.b,
  d: m.b * n.c + m.d * n.d,
});

/** 关于画布中心的仿射：p -> C + L(p - C) + t */
const applyAboutCenter = (p: Point, L: Lin, tx: number, ty: number): Point => ({
  x: CANVAS_CENTER + L.a * (p.x - CANVAS_CENTER) + L.c * (p.y - CANVAS_CENTER) + tx,
  y: CANVAS_CENTER + L.b * (p.x - CANVAS_CENTER) + L.d * (p.y - CANVAS_CENTER) + ty,
});

// ---------- 弧线采样（用于求包围盒） ----------

function arcCenterParams(p0: Point, cmd: Extract<AbsCmd, { c: 'A' }>) {
  let rx = cmd.rx;
  let ry = cmd.ry;
  if (rx === 0 || ry === 0) return null;
  const phi = (cmd.xRot * Math.PI) / 180;
  const dx = (p0.x - cmd.x) / 2;
  const dy = (p0.y - cmd.y) / 2;
  const x1p = Math.cos(phi) * dx + Math.sin(phi) * dy;
  const y1p = -Math.sin(phi) * dx + Math.cos(phi) * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = cmd.largeArc !== cmd.sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);
  const cx = Math.cos(phi) * cxp - Math.sin(phi) * cyp + (p0.x + cmd.x) / 2;
  const cy = Math.sin(phi) * cxp + Math.cos(phi) * cyp + (p0.y + cmd.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry
  );
  if (cmd.sweep === 0 && dtheta > 0) dtheta -= 2 * Math.PI;
  if (cmd.sweep === 1 && dtheta < 0) dtheta += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, theta1, dtheta };
}

function arcPoint(cp: NonNullable<ReturnType<typeof arcCenterParams>>, t: number): Point {
  const theta = cp.theta1 + t * cp.dtheta;
  return {
    x: cp.cx + cp.rx * Math.cos(cp.phi) * Math.cos(theta) - cp.ry * Math.sin(cp.phi) * Math.sin(theta),
    y: cp.cx + cp.rx * Math.sin(cp.phi) * Math.cos(theta) + cp.ry * Math.cos(cp.phi) * Math.sin(theta),
  };
}

/** 把命令展开成折线点（用于求变换后的包围盒），p0 为每条命令起点 */
function flattenCommands(cmds: AbsCmd[]): Point[] {
  const pts: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let sub: Point = { x: 0, y: 0 };

  for (const cmd of cmds) {
    switch (cmd.c) {
      case 'M':
        cur = { x: cmd.x, y: cmd.y };
        sub = { ...cur };
        pts.push(cur);
        break;
      case 'L':
        cur = { x: cmd.x, y: cmd.y };
        pts.push(cur);
        break;
      case 'C': {
        const N = 12;
        for (let i = 1; i <= N; i++) {
          const t = i / N;
          const mt = 1 - t;
          pts.push({
            x:
              mt ** 3 * cur.x +
              3 * mt ** 2 * t * cmd.x1 +
              3 * mt * t ** 2 * cmd.x2 +
              t ** 3 * cmd.x,
            y:
              mt ** 3 * cur.y +
              3 * mt ** 2 * t * cmd.y1 +
              3 * mt * t ** 2 * cmd.y2 +
              t ** 3 * cmd.y,
          });
        }
        cur = { x: cmd.x, y: cmd.y };
        break;
      }
      case 'A': {
        const cp = arcCenterParams(cur, cmd);
        if (!cp) {
          cur = { x: cmd.x, y: cmd.y };
          pts.push(cur);
          break;
        }
        const N = 24;
        for (let i = 1; i <= N; i++) pts.push(arcPoint(cp, i / N));
        cur = { x: cmd.x, y: cmd.y };
        break;
      }
      case 'Z':
        pts.push(sub);
        cur = { ...sub };
        break;
    }
  }
  return pts;
}

const bboxOf = (pts: Point[]): BBox => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** 计算绕中心等比缩放 f（f≤1）使包围盒完整落入 [lo,hi]；f=1 表示无需缩放 */
function containFactor(bb: BBox, lo: number, hi: number): number {
  const c = (lo + hi) / 2;
  const factors: number[] = [1];
  if (bb.x < lo && bb.x < c) factors.push((c - lo) / (c - bb.x));
  if (bb.x + bb.width > hi && bb.x + bb.width > c)
    factors.push((hi - c) / (bb.x + bb.width - c));
  if (bb.y < lo && bb.y < c) factors.push((c - lo) / (c - bb.y));
  if (bb.y + bb.height > hi && bb.y + bb.height > c)
    factors.push((hi - c) / (bb.y + bb.height - c));
  return Math.min(...factors);
}

function fmt(n: number): string {
  const v = Math.round(n * 100) / 100;
  if (Object.is(v, -0)) return '0';
  return String(v);
}

/**
 * 计算字形整体变换。返回烘焙后的 path 与可直接用于预览的仿射矩阵。
 * 自动规则：结果包围盒越界 → 绕中心整体等比缩小；较长边不足画布六成 → 放大（仍保证在画布内）。
 */
export function computeGlyphTransform(path: string, params: TransformParams): GlyphTransformResult {
  const d = (path ?? '').trim();
  if (!d) return { ok: false, error: '空字形：请先绘制基础形状或选择已有变体' };

  const { flipH, flipV, angleDeg, scale, offsetX, offsetY } = params;
  if (
    !Number.isFinite(angleDeg) ||
    !Number.isFinite(scale) ||
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY)
  ) {
    return { ok: false, error: '存在无效数值，请检查角度、比例和偏移输入' };
  }
  if (scale <= 0) {
    return { ok: false, error: '比例必须为大于 0 的数字' };
  }

  let cmds: AbsCmd[];
  try {
    cmds = parsePath(d);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '路径无法解析' };
  }
  const hasGeometry = cmds.some((c) => c.c !== 'Z');
  if (!hasGeometry) return { ok: false, error: '空字形：路径中没有任何笔画' };

  // 线性部分 = 等比缩放 × 镜像 × 旋转（绕画布中心），镜像恰好一次时行列式为负
  const mirrorCount = (flipH ? 1 : 0) + (flipV ? 1 : 0);
  const reflected = mirrorCount % 2 === 1;
  const M: Lin = mulLin(
    flipH ? { a: -1, c: 0, b: 0, d: 1 } : { a: 1, c: 0, b: 0, d: 1 },
    flipV ? { a: 1, c: 0, b: 0, d: -1 } : { a: 1, c: 0, b: 0, d: 1 }
  );
  const theta = (angleDeg * Math.PI) / 180;
  const L0 = mulLin({ a: scale, c: 0, b: 0, d: scale }, mulLin(M, rotLin(theta)));

  // 第一步：用户变换后的包围盒
  const afterUser = flattenCommands(cmds).map((p) => applyAboutCenter(p, L0, offsetX, offsetY));
  const bb0 = bboxOf(afterUser);

  // 第二步：越界 → 绕中心等比缩小
  const lo = FIT_MARGIN;
  const hi = CANVAS_SIZE - FIT_MARGIN;
  const shrink = containFactor(bb0, lo, hi);
  let autoAction: 'shrink' | 'enlarge' | null = shrink < 1 ? 'shrink' : null;

  // 缩小后的包围盒（绕中心 50 缩放）
  const bb1: BBox = {
    x: CANVAS_CENTER + shrink * (bb0.x - CANVAS_CENTER),
    y: CANVAS_CENTER + shrink * (bb0.y - CANVAS_CENTER),
    width: bb0.width * shrink,
    height: bb0.height * shrink,
  };

  // 第三步：较长边不足六成 → 放大，放大后仍须落在画布内
  let growth = 1;
  const longEdge = Math.max(bb1.width, bb1.height);
  if (longEdge > 1e-9 && longEdge < CANVAS_SIZE * MIN_LONG_RATIO) {
    const want = (CANVAS_SIZE * MIN_LONG_RATIO) / longEdge;
    const hx = Math.max(CANVAS_CENTER - bb1.x, bb1.x + bb1.width - CANVAS_CENTER, 0);
    const hy = Math.max(CANVAS_CENTER - bb1.y, bb1.y + bb1.height - CANVAS_CENTER, 0);
    const span = hi - CANVAS_CENTER; // 48
    const maxX = hx > 1e-9 ? span / hx : Infinity;
    const maxY = hy > 1e-9 ? span / hy : Infinity;
    growth = Math.min(want, maxX, maxY);
    if (growth > 1.0000001) autoAction = autoAction ?? 'enlarge';
    else growth = 1;
  }

  const q = shrink * growth; // 自动适配总倍率
  const L = mulLin({ a: q, c: 0, b: 0, d: q }, L0);
  const tx = q * offsetX;
  const ty = q * offsetY;

  // 最终包围盒（用于预览叠加框）
  const finalPts = afterUser.map((p) => ({
    x: CANVAS_CENTER + shrink * growth * (p.x - CANVAS_CENTER),
    y: CANVAS_CENTER + shrink * growth * (p.y - CANVAS_CENTER),
  }));
  const bb = bboxOf(finalPts);

  // 绝对坐标仿射：p' = L p + b，b = C - L C + t
  const bx = CANVAS_CENTER - (L.a * CANVAS_CENTER + L.c * CANVAS_CENTER) + tx;
  const by = CANVAS_CENTER - (L.b * CANVAS_CENTER + L.d * CANVAS_CENTER) + ty;
  const T = (p: Point): Point => ({ x: L.a * p.x + L.c * p.y + bx, y: L.b * p.x + L.d * p.y + by });

  // 烘焙命令
  const parts: string[] = [];
  let cur: Point = { x: 0, y: 0 };
  let sub: Point = { x: 0, y: 0 };

  for (const cmd of cmds) {
    switch (cmd.c) {
      case 'M': {
        const p = T({ x: cmd.x, y: cmd.y });
        parts.push(`M${fmt(p.x)} ${fmt(p.y)}`);
        cur = { x: cmd.x, y: cmd.y };
        sub = { ...cur };
        break;
      }
      case 'L': {
        const p = T({ x: cmd.x, y: cmd.y });
        parts.push(`L${fmt(p.x)} ${fmt(p.y)}`);
        cur = { x: cmd.x, y: cmd.y };
        break;
      }
      case 'C': {
        const p1 = T({ x: cmd.x1, y: cmd.y1 });
        const p2 = T({ x: cmd.x2, y: cmd.y2 });
        const p = T({ x: cmd.x, y: cmd.y });
        parts.push(
          `C${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(p.x)} ${fmt(p.y)}`
        );
        cur = { x: cmd.x, y: cmd.y };
        break;
      }
      case 'A': {
        const p = T({ x: cmd.x, y: cmd.y });
        let outXRot = cmd.xRot;
        if (cmd.rx > 0 && cmd.ry > 0) {
          // 线性部分为“等比缩放 + 旋转 + 可选镜像”，椭圆半径不变形；
          // 新 x 轴 = 线性部分作用于原 x 轴方向 R(φ)·(1,0)
          if (reflected) {
            outXRot = normAngle((-cmd.xRot - angleDeg + 360) % 360);
          } else {
            outXRot = normAngle(cmd.xRot + angleDeg);
          }
        }
        const radiusScale = scale * q;
        parts.push(
          `A${fmt(cmd.rx * radiusScale)} ${fmt(cmd.ry * radiusScale)} ${fmt(outXRot)} ${
            cmd.largeArc
          } ${reflected ? cmd.sweep ^ 1 : cmd.sweep} ${fmt(p.x)} ${fmt(p.y)}`
        );
        cur = { x: cmd.x, y: cmd.y };
        break;
      }
      case 'Z':
        parts.push('Z');
        cur = { ...sub };
        break;
    }
  }

  return {
    ok: true,
    path: parts.join(''),
    matrix: { a: L.a, b: L.b, c: L.c, d: L.d, e: bx, f: by },
    bbox: bb,
    fitFactor: q,
    autoAction,
  };
}

function normAngle(a: number): number {
  let v = a % 360;
  if (v < 0) v += 360;
  return v;
}
