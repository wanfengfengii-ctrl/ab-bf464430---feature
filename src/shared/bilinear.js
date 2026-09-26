/**
 * 双线性单元形变与全网不翻折的连续判定（严格连续判定，不以有限采样点替代）。
 *
 * 数学依据
 * --------
 * 每个矩形单元的织补形变视为连续双线性映射：
 *   P(s,t) = C0·(1-s)(1-t) + C1·s(1-t) + C2·s·t + C3·(1-s)t,  (s,t) ∈ [0,1]²
 * 其雅可比行列式 J(s,t) = (∂P/∂s) × (∂P/∂t) 关于 (s,t) 是双线性函数。
 *
 * 定理：双线性函数在矩形域 [0,1]² 上的最小值必在某一角点取得。
 *   证明：固定 t，J 关于 s 是线性函数，最小值在 s=0 或 s=1 处取得；
 *   两条边 s=0、s=1 上 J 关于 t 仍为线性，最小值在 t=0 或 t=1 处取得。
 *   故 min J = min{J(0,0), J(1,0), J(1,1), J(0,1)}。
 *
 * 推论（连续不翻折判据）：
 *   J(s,t) > 0  ∀(s,t)∈[0,1]²   ⇔   四个角点的 J 值均 > 0。
 * 因此检查 4 个角点即等价于检查单元内任意内部位置，无需任何采样。
 * 角点 J 值即该角点处两条邻边向量的叉积：
 *   J(0,0) = (C1-C0)×(C3-C0)   J(1,0) = (C1-C0)×(C2-C1)
 *   J(1,1) = (C2-C3)×(C2-C1)   J(0,1) = (C2-C3)×(C3-C0)
 *
 * 坐标约定：y 轴向下（与屏幕及矩阵行序一致），s 沿列方向，t 沿行方向。
 * 恒等单元（单位正方形）四角 J 均为 1；网结坐标为整数时 J 必为整数，
 * 故 J > 0 等价于 J ≥ 1，不存在数值模糊地带。
 *
 * 相邻单元共享边：共享边两侧的双线性映射在边上均退化为同一对端点的
 * 同一线性插值（双线性映射限制在边界上即为线性插值），因此只要两侧
 * 单元共用同一对网结——结构化网格在数据模型上天然如此——整条边
 * （含边上每一点）连续重合。checkSharedEdges 对该不变量做显式核验。
 */

export const MIN_ROWS = 2;
export const MAX_ROWS = 4;
export const MIN_COLS = 2;
export const MAX_COLS = 4;
export const MIN_MARKERS = 3;
export const MAX_MARKERS = 12;
export const MIN_PROBES = 2;
export const MAX_PROBES = 8;
export const COORD_LIMIT = 1_000_000;
/** 闭式根在闭合单元域内的精确容差（求根只用于排序与展示，归属以 BigInt 精确验证为准） */
export const DOMAIN_EPS = 1e-9;

/** 固定角点顺序：C0 左上 (s=0,t=0) → C1 右上 (1,0) → C2 右下 (1,1) → C3 左下 (0,1) */
export const CORNER_NAMES = [
  'C0 左上 (s=0,t=0)',
  'C1 右上 (s=1,t=0)',
  'C2 右下 (s=1,t=1)',
  'C3 左下 (s=0,t=1)',
];

export const FAILURE_TYPE_NAMES = {
  fold: '翻折（J < 0）',
  degenerate: '退化（J = 0）',
};

/** 二维叉积（z 分量）：a × b */
export function cross2(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

/** 生成原网（恒等网格）：网结 (i,j) 位于 (j, i)，单位间距 */
export function makeIdentityKnots(rows, cols) {
  const knots = [];
  for (let i = 0; i <= rows; i++) {
    const row = [];
    for (let j = 0; j <= cols; j++) row.push({ x: j, y: i });
    knots.push(row);
  }
  return knots;
}

/** 单元 (r,c) 的四角，按固定角点顺序 C0..C3 */
export function cellCorners(knots, r, c) {
  return [knots[r][c], knots[r][c + 1], knots[r + 1][c + 1], knots[r + 1][c]];
}

/** 四角雅可比值 [J(0,0), J(1,0), J(1,1), J(0,1)]，与 CORNER_NAMES 同序 */
export function cornerJacobians(corners) {
  const [C0, C1, C2, C3] = corners;
  return [
    cross2(C1.x - C0.x, C1.y - C0.y, C3.x - C0.x, C3.y - C0.y),
    cross2(C1.x - C0.x, C1.y - C0.y, C2.x - C1.x, C2.y - C1.y),
    cross2(C2.x - C3.x, C2.y - C3.y, C2.x - C1.x, C2.y - C1.y),
    cross2(C2.x - C3.x, C2.y - C3.y, C3.x - C0.x, C3.y - C0.y),
  ];
}

/** 双线性映射：局部坐标 (s,t) → 织补坐标 */
export function bilinearMap(corners, s, t) {
  const [C0, C1, C2, C3] = corners;
  const w0 = (1 - s) * (1 - t);
  const w1 = s * (1 - t);
  const w2 = s * t;
  const w3 = (1 - s) * t;
  return {
    x: w0 * C0.x + w1 * C1.x + w2 * C2.x + w3 * C3.x,
    y: w0 * C0.y + w1 * C1.y + w2 * C2.y + w3 * C3.y,
  };
}

/* ==========================================================================
 * 反向追溯：给定织补面上的整数复核针位，闭式求解其在原网中的位置。
 *
 * 展开双线性映射（c0..c3 为角点织补坐标，q 为针位整数坐标）：
 *   f(s,t) = c0 + a·s + b·t + d·s·t − q = 0,
 *     a = c1-c0, b = c3-c0, d = c0-c1-c3+c2
 *   分量：a_x s + b_x t + d_x st = e_x (= q_x-c0_x)
 *         a_y s + b_y t + d_y st = e_y
 *
 * 消元（任选一个 e 分量非零的轴作为消去轴）：对 t 的二次方程
 *   A t² + B t + C = 0
 * 求得 t 后由线性关系 s = (e_t - b_t t)/(a_t + d_t t) 恢复 s。
 * 真正的解必定同时满足两个分量方程且落在闭合域 [0,1]² 内；
 * 浮点根仅用于排序与展示，有效性一律以 BigInt 精确核验，不靠采样与迭代。
 * ========================================================================== */

/**
 * 浮点参考实现：枚举单个闭合单元域内 f(s,t)=q 的实根（消元二次方程）。
 * 仅供与精确实现 exactCellRoots 交叉核对/教学展示，不参与任何应用判定；
 * 判定一律走 exactCellRoots 的 BigInt 数域算术。返回 [{s,t}]，按 (t,s) 排序。
 */
export function invertBilinearClosed(corners, q, eps = DOMAIN_EPS) {
  const [c0, c1, c2, c3] = corners;
  const ax = c1.x - c0.x, ay = c1.y - c0.y;
  const bx = c3.x - c0.x, by = c3.y - c0.y;
  const dx = c0.x - c1.x - c3.x + c2.x;
  const dy = c0.y - c1.y - c3.y + c2.y;
  const ex = q.x - c0.x, ey = q.y - c0.y;

  const roots = [];
  const pushRoot = (s, t) => {
    if ([s, t].some((z) => !Number.isFinite(z))) return;
    const sc = Math.min(1, Math.max(0, s));
    const tc = Math.min(1, Math.max(0, t));
    if (Math.abs(s - sc) <= eps && Math.abs(t - tc) <= eps) {
      if (!roots.some((r) => Math.abs(r.s - sc) <= 1e-7 && Math.abs(r.t - tc) <= 1e-7)) {
        roots.push({ s: sc, t: tc });
      }
    }
  };

  // 选 e_k != 0 的轴 k 作消去轴（k 轴方程先解 t，再由另一轴恢复 s）
  for (const k of ex !== 0 ? ['x', 'y'] : ['y', 'x']) {
    const a = k === 'x' ? ax : ay;
    const b = k === 'x' ? bx : by;
    const d = k === 'x' ? dx : dy;
    const e = k === 'x' ? ex : ey;
    const ap = k === 'x' ? ay : ax;
    const bp = k === 'x' ? by : bx;
    const dp = k === 'x' ? dy : dx;
    const ep = k === 'x' ? ey : ex;

    const A = d * bp - b * dp;
    const B = a * bp - b * ap + e * dp - d * ep;
    const C = e * ap - a * ep;

    const addFromT = (t) => {
      const denom = a + d * t;
      if (Math.abs(denom) < 1e-12) return; // 恢复轴退化，换另一消去轴仍可枚举
      pushRoot((e - b * t) / denom, t);
    };

    if (A === 0) {
      if (B !== 0) addFromT(-C / B);
    } else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const r = Math.sqrt(disc);
        addFromT((-B - r) / (2 * A));
        if (r > 1e-12) addFromT((-B + r) / (2 * A));
      }
    }
    if (roots.length) break;
  }

  roots.sort((p, q2) => p.t - q2.t || p.s - q2.s);
  return roots;
}

/* ==========================================================================
 * 精确反向追溯（BigInt 数域算术，不采样、不迭代）
 *
 * 消元后得到 t 的整系数二次方程 A t² + B t + C = 0，其根形如
 *
 *   t = (p + q·√D) / den     （p,q,den ∈ Z，den > 0，D ∈ Z≥0）
 *
 * 即二次数域 Q(√D) 中的元素；s 由 s=(e-bt)/(a+dt) 恢复，经分母有理化后
 * 仍是同一数域元素。于是“根是否落在闭合域 [0,1]²”“根是否恰好满足两个
 * 分量方程”“两个根是否为同一原网位置”全部可化为 BigInt 整数比较：
 *
 *   符号判定 (P + Q√D) ≥ 0：
 *     Q = 0 时即判 P；P,Q 同号时显然；异号时平方化归为 Q²D 与 P² 比较。
 *   重代验证：把 s,t 代入 a·s+b·t+d·s·t=e，展开后有理部与 √D 部必须
 *     同时为 0（两个分量各自核验），这是精确等式，无任何容差。
 *
 * 浮点只在最后生成给人看的十进制近似；有效根的判定不依赖浮点。
 * ========================================================================== */

function bigSqrt(n) {
  if (n === 0n) return 0n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) / 2n;
    if (y >= x) return x;
    x = y;
  }
}

function isSquareBig(n) {
  if (n < 0n) return false;
  const r = bigSqrt(n);
  return r * r === n;
}

/** 数域元素归一：分母转正 */
function normElt(z) {
  if (z.den < 0n) return { p: -z.p, q: -z.q, d: z.d, den: -z.den };
  return z;
}

/** (P + Q·√D) 与 0 的精确比较：1 / 0 / -1 */
function rootSign(P, Q, D) {
  if (Q === 0n || D === 0n) return P === 0n ? 0 : P > 0n ? 1 : -1;
  if (P === 0n) return Q > 0n ? 1 : -1;
  // P 与 Q√D 同号（含 D 为完全平方时）：和不可能为 0
  if ((P > 0n) === (Q > 0n)) return P > 0n ? 1 : -1;
  // 异号：平方比较绝对值，相等则和恰为 0
  const q2d = Q * Q * D;
  const p2 = P * P;
  if (q2d === p2) return 0;
  if (Q > 0n) return q2d > p2 ? 1 : -1;
  return p2 > q2d ? 1 : -1;
}

/** 闭合域判定：0 ≤ (P+Q√D)/den ≤ 1（调用时 den>0），返回 -1/0/1 三态边界信息 */
function domainStatus(z) {
  const lo = rootSign(z.p, z.q, z.d);
  const hi = rootSign(z.p - z.den, z.q, z.d);
  return lo >= 0 && hi <= 0 ? (lo === 0 ? 0 : hi === 0 ? 1 : 2) : -1;
}

/** 展示用十进制近似（仅用于输出，不参与任何判定） */
export function eltToNumber(z) {
  const r = z.q === 0n || z.d === 0n ? 0 : Math.sqrt(Number(z.d));
  return (Number(z.p) + Number(z.q) * r) / Number(z.den);
}

function eltToJson(z) {
  return { p: String(z.p), q: String(z.q), d: String(z.d), den: String(z.den) };
}

/**
 * 枚举一个闭合单元域内 f(s,t)=q 的全部精确实根并逐一精确验证。
 *
 * 返回数组，每项 { s:{p,q,d,den}, t:{...}, approx:{s,t} }；
 * 方程在消元后退化（J=0 的单元才可能）时返回 { degenerate:true }。
 * 校核通过（四角 J>0）的网格不会出现退化，且至多一个根（局部微分同胚）。
 */
export function exactCellRoots(corners, q) {
  const [c0, c1, c2, c3] = corners;
  const ax = BigInt(c1.x - c0.x), ay = BigInt(c1.y - c0.y);
  const bx = BigInt(c3.x - c0.x), by = BigInt(c3.y - c0.y);
  const dx = BigInt(c0.x - c1.x - c3.x + c2.x);
  const dy = BigInt(c0.y - c1.y - c3.y + c2.y);
  const ex = BigInt(q.x - c0.x), ey = BigInt(q.y - c0.y);

  /**
   * 沿一个消去轴枚举。系数记号见文件头：消去轴 k、恢复轴 p。
   * 返回 { roots:[{s,t}], pole }；pole=true 表示恢复分母在某根处为 0，
   * 需换另一消去轴（J>0 网格不会发生）。
   */
  const solveAxis = (k) => {
    const a = k === 'x' ? ax : ay, b = k === 'x' ? bx : by;
    const d = k === 'x' ? dx : dy, e = k === 'x' ? ex : ey;
    const ap = k === 'x' ? ay : ax, bp = k === 'x' ? by : bx;
    const dp = k === 'x' ? dy : dx, ep = k === 'x' ? ey : ex;

    const A = d * bp - b * dp;
    const B = a * bp - b * ap + e * dp - d * ep;
    const C = e * ap - a * ep;

    // t 的全部候选（精确数域元素）
    const tCandidates = [];
    if (A === 0n) {
      if (B === 0n) {
        // 消元多项式恒等：该分量方程对 t 无约束（如该方向系数全为 0），
        // 不是立即判退化——换另一分量消元；两轴都恒等才是真退化。
        if (C === 0n) return { roots: [], pole: false, identity: true };
        return { roots: [], pole: false };
      }
      tCandidates.push({ p: -C, q: 0n, d: 1n, den: B });
    } else {
      const disc = B * B - 4n * A * C;
      if (disc < 0n) return { roots: [], pole: false };
      const den = 2n * A;
      // 完全平方判别式：根式退化为有理数，直接发出 (p, q=0, d=1)，
      // 避免在 Q(√d)=Q 中使用共轭范数（非零元素的范数可能为 0）。
      const g = bigSqrt(disc);
      if (g * g === disc) {
        if (g === 0n) {
          tCandidates.push({ p: -B, q: 0n, d: 1n, den });
        } else {
          tCandidates.push({ p: -B - g, q: 0n, d: 1n, den });
          tCandidates.push({ p: -B + g, q: 0n, d: 1n, den });
        }
      } else {
        tCandidates.push({ p: -B, q: -1n, d: disc, den });
        tCandidates.push({ p: -B, q: 1n, d: disc, den });
      }
    }

    const out = [];
    let pole = false;
    for (const t0raw of tCandidates) {
      const t0 = normElt(t0raw);
      // s = (e - b·t)/(a + d·t)，分母有理化：
      //   Ms = a·den + d·p,  Mq = d·q
      //   Ns = e·den - b·p,  Nq = -b·q
      //   s = [(Ns·Ms - Nq·Mq·D) + (Nq·Ms - Ns·Mq)·√D] / (Ms² - Mq²·D)
      const Ms = a * t0.den + d * t0.p;
      const Mq = d * t0.q;
      const Ns = e * t0.den - b * t0.p;
      const Nq = -b * t0.q;
      const denS = Ms * Ms - Mq * Mq * t0.d;
      if (denS === 0n) { pole = true; continue; }
      const s0 = normElt({
        p: Ns * Ms - Nq * Mq * t0.d,
        q: Nq * Ms - Ns * Mq,
        d: t0.d,
        den: denS,
      });

      if (domainStatus(s0) < 0 || domainStatus(t0) < 0) continue;

      // 精确重代：a·s + b·t + d·s·t - e 的有理部与 √D 部须同时为 0
      const verify = (aa, bb, dd, ee) => {
        const Lden = s0.den * t0.den;
        const stP = s0.p * t0.p + s0.q * t0.q * t0.d;
        const stQ = s0.p * t0.q + s0.q * t0.p;
        const P = aa * s0.p * t0.den + bb * t0.p * s0.den + dd * stP - ee * Lden;
        const Q = aa * s0.q * t0.den + bb * t0.q * s0.den + dd * stQ;
        return P === 0n && Q === 0n;
      };
      const okx = verify(ax, bx, dx, ex);
      const oky = verify(ay, by, dy, ey);
      if (okx && oky) out.push({ s: s0, t: t0 });
    }
    return { roots: out, pole };
  };

  // 两个消去轴都精确求解并按数域相等合并：任一轴的恢复分母在某根处为 0
  // （该分量只约束 t）或消元多项式恒等时，另一轴仍能枚举全部根；
  // 浮点不参与判定。两轴都恒等才表示方程组整体塌缩（J=0 退化单元）。
  const axis1 = solveAxis(ex !== 0n ? 'x' : 'y');
  const axis2 = solveAxis(ex !== 0n ? 'y' : 'x');
  if (axis1.identity && axis2.identity) return { degenerate: true };

  const merged = [];
  for (const res of [axis1, axis2]) {
    for (const r of res.roots) {
      if (!merged.some((z) => fieldEqual(z.s, r.s) && fieldEqual(z.t, r.t))) {
        merged.push(r);
      }
    }
  }

  const roots = merged.map((r) => ({
    s: r.s, t: r.t, approx: { s: eltToNumber(r.s), t: eltToNumber(r.t) },
  }));
  roots.sort((p1, p2) => p1.approx.t - p2.approx.t || p1.approx.s - p2.approx.s);
  return roots;
}

/** 两个（可能来自不同二次域的）数域元素是否精确相等 */
export function fieldEqual(e1, e2) {
  const irrational1 = e1.q !== 0n && e1.d > 0n;
  const irrational2 = e2.q !== 0n && e2.d > 0n;
  if (!irrational1 || !irrational2) {
    if (irrational1 !== irrational2) return false;
    return e1.p * e2.den === e2.p * e1.den;
  }
  if (e1.d === e2.d) {
    return e1.p * e2.den === e2.p * e1.den && e1.q * e2.den === e2.q * e1.den;
  }
  // 不同根式仍可能同属 Q(√d)：√D1 与 √D2 可有理互化 ⇔ D1·D2 为完全平方
  const w2 = e1.d * e2.d;
  if (!isSquareBig(w2)) return false;
  const w = bigSqrt(w2); // √D2 = (w/D1)·√D1
  return e1.p * e2.den === e2.p * e1.den &&
         e1.q * e1.d * e2.den === e2.q * w * e1.den;
}


/**
 * 原网坐标 (u,v) → 所在单元与局部坐标 (s,t)。
 * 边界上的点（u=cols 或 v=rows）归入末单元，局部坐标恰为 1。
 * 超出原网范围返回 null。
 */
export function locateCell(u, v, rows, cols) {
  if (!(u >= 0 && u <= cols && v >= 0 && v <= rows)) return null;
  const c = Math.min(Math.floor(u), cols - 1);
  const r = Math.min(Math.floor(v), rows - 1);
  return { r, c, s: u - c, t: v - r };
}

/**
 * 显式核验相邻单元共享同一条连续边：
 * 水平相邻单元的公共竖边、垂直相邻单元的公共横边，两侧端点必须一致。
 * （结构化网格由同一网结阵列装配，天然满足；此处对装配不变量做运行时核验。）
 */
export function checkSharedEdges(knots, rows, cols) {
  const mismatches = [];
  let edgeCount = 0;
  const samePoint = (a, b) => a.x === b.x && a.y === b.y;
  // 水平相邻：单元 (r,c) 的右边（C1,C2）与单元 (r,c+1) 的左边（C0,C3）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      edgeCount++;
      const right = cellCorners(knots, r, c);
      const left = cellCorners(knots, r, c + 1);
      if (!samePoint(right[1], left[0]) || !samePoint(right[2], left[3])) {
        mismatches.push({ kind: 'vertical-edge', r, c });
      }
    }
  }
  // 垂直相邻：单元 (r,c) 的下边（C3,C2）与单元 (r+1,c) 的上边（C0,C1）
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      edgeCount++;
      const bottom = cellCorners(knots, r, c);
      const top = cellCorners(knots, r + 1, c);
      if (!samePoint(bottom[3], top[0]) || !samePoint(bottom[2], top[1])) {
        mismatches.push({ kind: 'horizontal-edge', r, c });
      }
    }
  }
  return { continuous: mismatches.length === 0, edgeCount, mismatches };
}

/**
 * 输入校验：网格规格、网结整数坐标、纹样标记数量与范围。
 * 返回错误数组（空数组表示通过），每个错误含 kind 与中文 message。
 */
export function validateInput(spec) {
  const errors = validateGeometry(spec);
  if (errors.length) return errors;
  const { rows, cols, markers } = spec;

  if (!Array.isArray(markers) || markers.length < MIN_MARKERS || markers.length > MAX_MARKERS) {
    errors.push({
      kind: 'markers-count',
      message: `纹样标记数量须为 ${MIN_MARKERS}–${MAX_MARKERS} 个，当前 ${Array.isArray(markers) ? markers.length : '无效'}`,
    });
    return errors;
  }
  markers.forEach((m, idx) => {
    const u = m?.u;
    const v = m?.v;
    if (typeof u !== 'number' || typeof v !== 'number' || !Number.isFinite(u) || !Number.isFinite(v)) {
      errors.push({
        kind: 'marker-invalid', index: idx,
        message: `纹样标记 M${idx + 1} 坐标须为有限数值，当前 (${u}, ${v})`,
      });
    } else if (u < 0 || u > cols || v < 0 || v > rows) {
      errors.push({
        kind: 'marker-range', index: idx,
        message: `纹样标记 M${idx + 1} (${u}, ${v}) 超出原网范围 [0,${cols}]×[0,${rows}]`,
      });
    }
  });
  return errors;
}

/** 网格规格与网结整数坐标校验（校核与反向追溯共用） */
export function validateGeometry(spec) {
  const errors = [];
  const { rows, cols, knots } = spec ?? {};

  if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    errors.push({ kind: 'rows', message: `行数须为 ${MIN_ROWS}–${MAX_ROWS} 的整数，当前：${rows}` });
  }
  if (!Number.isInteger(cols) || cols < MIN_COLS || cols > MAX_COLS) {
    errors.push({ kind: 'cols', message: `列数须为 ${MIN_COLS}–${MAX_COLS} 的整数，当前：${cols}` });
  }
  if (errors.length) return errors;

  if (
    !Array.isArray(knots) ||
    knots.length !== rows + 1 ||
    knots.some((row) => !Array.isArray(row) || row.length !== cols + 1)
  ) {
    errors.push({ kind: 'knots-shape', message: `网结阵列须为 ${rows + 1}×${cols + 1}` });
    return errors;
  }
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const k = knots[i][j] ?? {};
      if (!Number.isInteger(k.x) || !Number.isInteger(k.y)) {
        errors.push({
          kind: 'knot-integer', i, j,
          message: `网结 K(${i},${j}) 坐标须为整数，当前 (${k.x}, ${k.y})`,
        });
      } else if (Math.abs(k.x) > COORD_LIMIT || Math.abs(k.y) > COORD_LIMIT) {
        errors.push({
          kind: 'knot-range', i, j,
          message: `网结 K(${i},${j}) 坐标超出允许范围 ±${COORD_LIMIT}`,
        });
      }
    }
  }
  return errors;
}

/** 复核针位校验：2–8 个织补面整数坐标 */
export function validateProbes(spec) {
  const errors = validateGeometry(spec);
  if (errors.length) return errors;
  const { probes } = spec ?? {};
  if (!Array.isArray(probes) || probes.length < MIN_PROBES || probes.length > MAX_PROBES) {
    errors.push({
      kind: 'probes-count',
      message: `复核针位数量须为 ${MIN_PROBES}–${MAX_PROBES} 个，当前 ${Array.isArray(probes) ? probes.length : '无效'}`,
    });
    return errors;
  }
  probes.forEach((p, idx) => {
    const x = p?.x;
    const y = p?.y;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      errors.push({
        kind: 'probe-integer', index: idx,
        message: `复核针位 P${idx + 1} 坐标须为整数，当前 (${x}, ${y})`,
      });
    } else if (Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT) {
      errors.push({
        kind: 'probe-range', index: idx,
        message: `复核针位 P${idx + 1} 坐标超出允许范围 ±${COORD_LIMIT}`,
      });
    }
  });
  return errors;
}

/**
 * 逐单元几何分析（校核与反向追溯共用）：
 * 行优先计算四角雅可比、首项失败、全网最小雅可比、共享边连续性。
 */
export function analyzeGridGeometry(rows, cols, knots) {
  const cells = [];
  let firstFailure = null;
  let minJacobian = null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const corners = cellCorners(knots, r, c);
      const J = cornerJacobians(corners);
      const minJ = Math.min(...J);
      cells.push({ r, c, corners, cornerJacobians: J, minJ, ok: minJ > 0 });
      for (let k = 0; k < 4; k++) {
        if (minJacobian === null || J[k] < minJacobian.value) {
          minJacobian = { value: J[k], cell: { r, c }, corner: k };
        }
        if (J[k] <= 0 && !firstFailure) {
          firstFailure = {
            cell: { r, c }, corner: k, jacobian: J[k],
            type: J[k] < 0 ? 'fold' : 'degenerate',
          };
        }
      }
    }
  }

  const edges = checkSharedEdges(knots, rows, cols);
  return { cells, firstFailure, minJacobian, edges, ok: !firstFailure && edges.continuous };
}

/**
 * 全网校核（连续判定）：
 * 1. 输入校验（无效坐标直接判负）；
 * 2. 逐单元（行优先）计算四角雅可比，首项失败按行优先单元 + 固定角点顺序报告；
 * 3. 相邻单元共享边连续性核验；
 * 4. 仅当全网通过时，才把纹样标记换算到织补坐标（避免输出失真位置）。
 *
 * 返回结果对象：
 *   ok, stage('validation'|'geometry'), errors,
 *   firstFailure: { cell:{r,c}, corner, jacobian, type:'fold'|'degenerate' } | null,
 *   minJacobian: { value, cell:{r,c}, corner } | null,
 *   cells: 行优先单元证据数组,
 *   edges: { continuous, edgeCount, mismatches },
 *   markers: 换算后的标记数组（失败时为 null）
 */
export function verifyGrid(spec) {
  const errors = validateInput(spec);
  if (errors.length) {
    return {
      ok: false, stage: 'validation', errors,
      firstFailure: null, minJacobian: null, cells: [], edges: null, markers: null,
    };
  }

  const { rows, cols, knots, markers } = spec;
  const { cells, firstFailure, minJacobian, edges, ok } = analyzeGridGeometry(rows, cols, knots);

  let mappedMarkers = null;
  if (ok) {
    mappedMarkers = markers.map((m, idx) => {
      const loc = locateCell(m.u, m.v, rows, cols);
      const p = bilinearMap(cellCorners(knots, loc.r, loc.c), loc.s, loc.t);
      return {
        index: idx, u: m.u, v: m.v,
        cell: { r: loc.r, c: loc.c }, s: loc.s, t: loc.t,
        x: p.x, y: p.y,
      };
    });
  }

  return {
    ok, stage: 'geometry', errors: [],
    firstFailure, minJacobian, cells, edges, markers: mappedMarkers,
  };
}

/* ==========================================================================
 * 反向追溯（织补面整数针位 → 原网纹样坐标）
 *
 * 流程（每个针位独立执行，结果按针位录入顺序裁决）：
 *   1. 对全部单元（行优先）做闭式求逆：展开双线性方程 → 消元得 t 的整系数
 *      二次方程 → 在数域 Q(√Δ) 中精确枚举 [0,1]² 内的全部根并精确重代
 *      （见 exactCellRoots；不采样、不设迭代初值）；
 *   2. 把每个命中折算为原网坐标 u=c+s, v=r+t；
 *   3. 相邻单元公共边上的同一原网位置合并为一项，归属按固定方向稳定选择
 *      （公共竖边归左侧单元 s=1；公共横边归上侧单元 t=1）；
 *   4. 全部针位都只有唯一原网位置时才输出；出现以下任一情况即按针位顺序
 *      返回首个不可追溯证据，且不输出其余追溯结果：
 *        outside    针位不在任何单元的闭合像内（落在网外）；
 *        ambiguous  非相邻单元给出不同原网位置（重叠歧义）；
 *        multi-root 同一闭合单元内存在多个不同根（仅退化单元可能，防御性）。
 * ========================================================================== */

/** 两个单元是否相邻（共享一条完整边） */
export function cellsAdjacent(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
}

/** 数域元素是否为整数；若是返回该 BigInt，否则 null */
function fieldInteger(z) {
  if (z.q !== 0n) return null;
  if (z.p % z.den === 0n) return z.p / z.den;
  return null;
}

/**
 * 公共边/公共顶点稳定归属：严格沿用既有 locateCell 的边界约定——
 *   内部整数坐标 u=c（c<cols）归右侧单元（其 s=0，C0/C3 边）；
 *   右外边界 u=cols 归末列单元（s=1）；v 方向同理。
 * 由全局精确原网坐标 (u,v) 直接反算规范单元，再在等价命中中选取它。
 */
function stabilizeOwnership(members, rows, cols) {
  if (members.length === 1) return members[0];
  const g = members[0];
  const ui = fieldInteger(g.u);
  const vi = fieldInteger(g.v);
  let targetR = null;
  let targetC = null;
  if (ui !== null) {
    const c = Number(ui);
    targetC = c >= cols ? cols - 1 : c;
  }
  if (vi !== null) {
    const r = Number(vi);
    targetR = r >= rows ? rows - 1 : r;
  }
  const rep = members.find((h) =>
    (targetR === null || h.cell.r === targetR) &&
    (targetC === null || h.cell.c === targetC));
  return rep || members[0];
}

/**
 * 单个针位的反向追溯。
 * 返回 { status:'unique', hit, equivalents } 或 { status, evidence }。
 */
export function traceProbe(spec, probe) {
  const { rows, cols, knots } = spec;
  const allHits = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const corners = cellCorners(knots, r, c);
      const roots = exactCellRoots(corners, probe);
      if (roots.degenerate) {
        // 几何校核本应已拦截 J<=0；防御性分支
        return {
          status: 'multi-root',
          evidence: { kind: 'degenerate-cell', cell: { r, c }, message: `单元 (${r},${c}) 退化，方程无法唯一求逆` },
        };
      }
      for (const root of roots) {
        allHits.push({
          cell: { r, c },
          s: root.s, t: root.t,
          // 全局原网坐标 u = c + s, v = r + t：(p/den) + c = (p + c·den)/den
          u: { p: root.s.p + BigInt(c) * root.s.den, q: root.s.q, d: root.s.d, den: root.s.den },
          v: { p: root.t.p + BigInt(r) * root.t.den, q: root.t.q, d: root.t.d, den: root.t.den },
          approx: {
            s: root.approx.s, t: root.approx.t,
            u: c + root.approx.s, v: r + root.approx.t,
          },
        });
      }
    }
  }

  if (!allHits.length) {
    return {
      status: 'outside',
      evidence: {
        kind: 'outside', probe,
        message: `针位 (${probe.x}, ${probe.y}) 不在任何单元闭合像内（落在网外），方程无有效根`,
      },
    };
  }

  // 按全局原网坐标 (u,v) 精确相等聚类：公共边、公共顶点上的多个命中合为一项，
  // 不论它们来自相邻单元还是仅共顶点的对角单元。
  const groups = [];
  for (const h of allHits) {
    let placed = false;
    for (const g of groups) {
      const rep = g.members[0];
      if (fieldEqual(rep.u, h.u) && fieldEqual(rep.v, h.v)) {
        g.members.push(h);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ members: [h] });
  }

  if (groups.length > 1) {
    // 同一织补针对应多个不同原网位置（重叠歧义）；取行优先最早两组作首项证据
    groups.sort((g1, g2) => {
      const a = g1.members[0].cell, b = g2.members[0].cell;
      return a.r - b.r || a.c - b.c;
    });
    const g1 = groups[0];
    const g2 = groups[1];
    const adjacent = cellsAdjacent(
      g1.members[0].cell.r, g1.members[0].cell.c,
      g2.members[0].cell.r, g2.members[0].cell.c,
    );
    return {
      status: 'ambiguous',
      evidence: {
        kind: 'overlap',
        adjacent,
        probe,
        positions: groups.map((g) => ({
          cell: g.members[0].cell,
          u: g.members[0].approx.u, v: g.members[0].approx.v,
        })),
        message: `针位 (${probe.x}, ${probe.y}) 同时对应${adjacent ? '相邻' : '非相邻'}单元 `
          + `(${g1.members[0].cell.r},${g1.members[0].cell.c}) 与 (${g2.members[0].cell.r},${g2.members[0].cell.c})，`
          + `原网位置 (${g1.members[0].approx.u}, ${g1.members[0].approx.v}) 与 `
          + `(${g2.members[0].approx.u}, ${g2.members[0].approx.v}) 不一致，无法唯一追溯`,
      },
    };
  }

  // 唯一位置（组成员是公共边/公共顶点上的等价命中）→ 固定角点稳定归属
  const group = groups[0];
  const rep = stabilizeOwnership(group.members, rows, cols);
  return { status: 'unique', hit: rep, equivalents: group.members.length - 1 };
}

/** 命中的 JSON 表示（展示近似值 + 精确数域证据） */
function hitToJson(hit, equivalents) {
  return {
    cell: hit.cell,
    s: hit.approx.s, t: hit.approx.t,
    u: hit.approx.u, v: hit.approx.v,
    exact: { u: eltToJson(hit.u), v: eltToJson(hit.v), s: eltToJson(hit.s), t: eltToJson(hit.t) },
    sharedEdgeMatches: equivalents,
  };
}

/**
 * 全网反向追溯：
 * 先复用连续不翻折校核（既有定位网须校核通过），再按针位录入顺序逐个追溯。
 * 任一针位不可追溯即返回首个证据（stage='trace'），不输出其余追溯结果；
 * 全部唯一时输出每个针位的原网坐标、所在单元与局部参数。
 */
export function traceBack(spec) {
  const errors = validateProbes(spec);
  if (errors.length) {
    return { ok: false, stage: 'validation', errors, traces: null, evidence: null };
  }
  const { rows, cols, knots, probes } = spec;
  const geom = analyzeGridGeometry(rows, cols, knots);
  if (!geom.ok) {
    return {
      ok: false, stage: 'geometry', errors: [],
      firstFailure: geom.firstFailure, edges: geom.edges, cells: geom.cells,
      traces: null, evidence: null,
    };
  }

  const traces = [];
  for (let i = 0; i < probes.length; i++) {
    const res = traceProbe(spec, probes[i]);
    if (res.status !== 'unique') {
      return {
        ok: false, stage: 'trace', errors: [],
        cells: geom.cells, edges: geom.edges, minJacobian: geom.minJacobian,
        evidence: {
          index: i,
          probe: probes[i],
          status: res.status,
          ...res.evidence,
        },
        traces: null,
      };
    }
    traces.push({
      index: i, probe: probes[i],
      ...hitToJson(res.hit, res.equivalents),
    });
  }

  return {
    ok: true, stage: 'trace', errors: [],
    cells: geom.cells, edges: geom.edges, minJacobian: geom.minJacobian,
    evidence: null, traces,
  };
}
