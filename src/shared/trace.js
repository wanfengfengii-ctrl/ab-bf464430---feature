/**
 * 反向追溯：织补面复核针位 → 原网纹样坐标（双线性形变的解析求逆）。
 *
 * 数学依据
 * --------
 * 单元的织补映射为双线性映射，写成仿射分解形式：
 *   P(s,t) = A + B·s + D·t + E·s·t
 *   A = C0,  B = C1 - C0,  D = C3 - C0,  E = C0 - C1 + C2 - C3
 * 给定针位 Q，令 d = Q - A，方程组
 *   B·s + D·t + E·s·t = d
 * 对两分量分别消去 s（由第一式解出 s = (dx - Dx·t)/(Bx + Ex·t) 代入第二式），
 * 得到关于 t 的二次方程（系数全部为整数叉积，可精确计算）：
 *   a·t² + b·t + c = 0
 *   a = E×D,  b = B×D + d×E,  c = d×B
 * 对每个单元：
 *   1. 用数值稳定的求根公式枚举该二次方程的全部实根（0、1 或 2 个；
 *      a = 0 时退化为线性方程，恰有一根）——这是解析枚举，
 *      不依赖网格采样，也不需要迭代初值；
 *   2. 对每个根 t 回代求 s（选取绝对值较大的分母，避免相消；
 *      已校核网格 J > 0 保证闭合域内分母不为零）；
 *   3. 只保留落在闭合单元域 [0,1]² 内的根，并把每个候选根正向代入
 *      P(s,t) 验证确实映回针位（残差检查），再裁剪到闭合域。
 *
 * 唯一性与合并
 * ------------
 * 已校核网格（全网 J > 0）保证每个单元的映射在闭合域内是单射，因此同一单元
 * 至多给出一个域内根；但全网 J > 0 是局部性质，并不排除非相邻单元的像相互
 * 重叠（整体不自交不能由局部保证）。因此：
 *   - 同一原网位置被多个单元给出（只可能发生在公共边/公共角点上，两侧根一致），
 *     合并为一项；展示单元与局部参数按既有 locateCell 归属规则确定
 *     （边界点归入局部坐标为 0 的单元，外边界归入末单元，角点恒归 C0），
 *     与纹样标记正向换算的归属完全一致，显示稳定；
 *   - 不同单元给出不同的原网位置（非相邻单元重叠歧义）、针位落在网外
 *     （全部单元在闭合域内均无有效根，含二次方程无实根的情形），
 *     该针位不可追溯；
 *   - 按针位录入顺序处理，遇到首个不可追溯针位即返回该证据，
 *    其余针位的追溯结果一律不输出；只有全部针位各自对应唯一原网位置时，
 *    才输出原网坐标、所在单元与局部参数。
 */

import {
  COORD_LIMIT,
  bilinearMap,
  cross2,
  locateCell,
  validateGridSpec,
  verifyGeometry,
} from './bilinear.js';

export const MIN_NEEDLES = 2;
export const MAX_NEEDLES = 8;

export const TRACE_REASON_NAMES = {
  outside: '落在网外（闭合域内无有效根）',
  ambiguous: '重叠歧义（多个不同原网位置）',
};

/**
 * 容差说明：网结与针位均为整数（|坐标| ≤ 1e6），二次方程系数为 ≤ 1.6e13 的
 * 整数（远小于 2^53，可精确表示），稳定求根公式下域内根的误差 ~1e-15。
 * 而 J ≥ 1（整数雅可比）保证真正落在域外的根与边界相距 ≥ ~1e-6 量级，
 * 故以下容差既不会误吞真边界根，也不会误并不同位置。
 */
const DOMAIN_EPS = 1e-9; // 闭合域 [0,1]² 判定容差
const MERGE_EPS = 1e-7; // 原网位置（值域 [0,4]）合并容差
const SNAP_EPS = 1e-9; // 展示前整数边界吸附容差

/**
 * 复核针位输入校验：2–8 个织补面整数坐标。
 * 返回错误数组（空数组表示通过），每个错误含 kind 与中文 message。
 */
export function validateNeedles(needles) {
  const errors = [];
  if (!Array.isArray(needles) || needles.length < MIN_NEEDLES || needles.length > MAX_NEEDLES) {
    errors.push({
      kind: 'needles-count',
      message: `复核针位数量须为 ${MIN_NEEDLES}–${MAX_NEEDLES} 个，当前 ${Array.isArray(needles) ? needles.length : '无效'}`,
    });
    return errors;
  }
  needles.forEach((n, idx) => {
    if (!Number.isInteger(n?.x) || !Number.isInteger(n?.y)) {
      errors.push({
        kind: 'needle-integer', index: idx,
        message: `复核针位 P${idx + 1} 坐标须为整数，当前 (${n?.x}, ${n?.y})`,
      });
    } else if (Math.abs(n.x) > COORD_LIMIT || Math.abs(n.y) > COORD_LIMIT) {
      errors.push({
        kind: 'needle-range', index: idx,
        message: `复核针位 P${idx + 1} 坐标超出允许范围 ±${COORD_LIMIT}`,
      });
    }
  });
  return errors;
}

/**
 * 数值稳定的二次方程实根枚举：a·t² + b·t + c = 0。
 * 返回全部实根数组（0、1 或 2 个）；重根只返回一次。
 * a = b = 0 的恒等退化在已校核网格中不可达，按无根处理。
 */
export function quadraticRoots(a, b, c) {
  if (a === 0) {
    if (b === 0) return [];
    return [-c / b];
  }
  const disc = b * b - 4 * a * c;
  const tol = 1e-9 * (b * b + Math.abs(4 * a * c));
  if (disc < -tol) return [];
  if (disc <= 0) return [-b / (2 * a)]; // 重根（微小负判别式按 0 处理）
  const sq = Math.sqrt(disc);
  // 稳定形式：先算不相消的根 q/a，再由韦达定理 c/a = r1·r2 求另一根
  const q = -0.5 * (b + (b >= 0 ? sq : -sq));
  const r1 = q / a;
  const r2 = c / q; // disc > 0 时 q ≠ 0
  return r1 === r2 ? [r1] : [r1, r2];
}

/**
 * 单元双线性形变的解析求逆：枚举目标点 (qx,qy) 在闭合单元域 [0,1]² 内的全部根。
 * 返回 [{ s, t, residual }]，其中 residual 为正向验证 |P(s,t) - Q| 的最大分量。
 * 已校核（J > 0）网格中返回值至多一个元素；一般情形下可能为 0、1、2 个。
 */
export function invertCell(corners, qx, qy) {
  const [C0, C1, C2, C3] = corners;
  const Bx = C1.x - C0.x, By = C1.y - C0.y;
  const Dx = C3.x - C0.x, Dy = C3.y - C0.y;
  const Ex = C0.x - C1.x + C2.x - C3.x, Ey = C0.y - C1.y + C2.y - C3.y;
  const dx = qx - C0.x, dy = qy - C0.y;

  const a = cross2(Ex, Ey, Dx, Dy);
  const b = cross2(Bx, By, Dx, Dy) + cross2(dx, dy, Ex, Ey);
  const c = cross2(dx, dy, Bx, By);

  const scale = Math.max(
    1,
    Math.abs(qx), Math.abs(qy),
    Math.abs(C0.x), Math.abs(C0.y),
    Math.abs(C1.x), Math.abs(C1.y),
    Math.abs(C2.x), Math.abs(C2.y),
    Math.abs(C3.x), Math.abs(C3.y),
  );

  const roots = [];
  for (const t of quadraticRoots(a, b, c)) {
    // 回代求 s：两个分量方程各给出一个表达式，取分母绝对值较大者。
    // 已校核网格 J(s,t) > 0 ⟹ ∂P/∂s = B + E·t 在闭合域内非零，分母必可用。
    const denX = Bx + Ex * t;
    const denY = By + Ey * t;
    let s;
    if (Math.abs(denX) >= Math.abs(denY)) {
      if (denX === 0) continue;
      s = (dx - Dx * t) / denX;
    } else {
      s = (dy - Dy * t) / denY;
    }
    // 闭合单元域判定（含边界）
    if (!(s >= -DOMAIN_EPS && s <= 1 + DOMAIN_EPS && t >= -DOMAIN_EPS && t <= 1 + DOMAIN_EPS)) continue;
    const sc = Math.min(Math.max(s, 0), 1);
    const tc = Math.min(Math.max(t, 0), 1);
    // 正向验证：候选根必须确实映回针位
    const p = bilinearMap(corners, sc, tc);
    const residual = Math.max(Math.abs(p.x - qx), Math.abs(p.y - qy));
    if (residual > 1e-6 * scale) continue;
    roots.push({ s: sc, t: tc, residual });
  }
  return roots;
}

/** 展示前把贴近整数的原网坐标吸附到整数边界，保证归属稳定 */
function snapToInteger(x) {
  const r = Math.round(x);
  return Math.abs(x - r) <= SNAP_EPS ? r : x;
}

/**
 * 单针位追溯：对全部单元解析求逆，合并同一原网位置。
 * 成功返回 { ok:true, u, v, cell, s, t, residual, witnesses }；
 * 失败返回 { ok:false, reason:'outside'|'ambiguous', positions? }。
 */
function traceNeedle(cells, rows, cols, qx, qy) {
  const hits = [];
  for (const cell of cells) {
    for (const root of invertCell(cell.corners, qx, qy)) {
      hits.push({
        r: cell.r, c: cell.c,
        u: cell.c + root.s, v: cell.r + root.t,
        residual: root.residual,
      });
    }
  }
  if (hits.length === 0) return { ok: false, reason: 'outside' };

  // 合并同一原网位置：公共边/公共角点上的位置会被相邻单元同时给出，
  // 两侧求逆结果在数学上相同，合并为一项并记录全部证据单元。
  const positions = [];
  for (const h of hits) {
    const found = positions.find(
      (p) => Math.abs(p.u - h.u) <= MERGE_EPS && Math.abs(p.v - h.v) <= MERGE_EPS,
    );
    if (found) {
      found.witnesses.push({ r: h.r, c: h.c });
      found.residual = Math.max(found.residual, h.residual);
    } else {
      positions.push({ u: h.u, v: h.v, residual: h.residual, witnesses: [{ r: h.r, c: h.c }] });
    }
  }
  if (positions.length > 1) return { ok: false, reason: 'ambiguous', positions };

  const pos = positions[0];
  // 归属稳定化：贴近整数边界的坐标先吸附，再按既有 locateCell 规则
  // 确定展示单元与局部参数（与纹样标记正向换算的归属完全一致）。
  const u = snapToInteger(pos.u);
  const v = snapToInteger(pos.v);
  const loc = locateCell(u, v, rows, cols);
  return {
    ok: true, u, v,
    cell: { r: loc.r, c: loc.c }, s: loc.s, t: loc.t,
    residual: pos.residual, witnesses: pos.witnesses,
  };
}

/**
 * 反向追溯（全网）：
 * 1. 输入校验（网格几何 + 2–8 个整数针位）；
 * 2. 几何校核——既有定位网须已通过校核，否则拒绝追溯；
 * 3. 按针位录入顺序逐针位解析求逆；遇首个不可追溯针位（网外/无有效根、
 *    非相邻单元给出不同原网位置）即返回该证据，且 traces 为 null；
 * 4. 全部针位各自唯一时输出 traces：原网坐标、所在单元、局部参数与证据单元。
 *
 * 返回结果对象：
 *   ok, stage('validation'|'geometry'|'trace'), errors,
 *   geometry: 几何校核证据（输入无效时为 null）,
 *   firstFailure: { index, x, y, reason, positions?, message } | null,
 *   traces: 追溯结果数组（任一针位不可追溯时为 null）
 */
export function traceNeedles(spec) {
  const { rows, cols, knots, needles } = spec ?? {};

  const errors = [...validateGridSpec(rows, cols, knots), ...validateNeedles(needles)];
  if (errors.length) {
    return { ok: false, stage: 'validation', errors, geometry: null, firstFailure: null, traces: null };
  }

  const geometry = verifyGeometry(rows, cols, knots);
  if (!geometry.ok) {
    return { ok: false, stage: 'geometry', errors: [], geometry, firstFailure: null, traces: null };
  }

  const traces = [];
  for (let index = 0; index < needles.length; index++) {
    const n = needles[index];
    const res = traceNeedle(geometry.cells, rows, cols, n.x, n.y);
    if (!res.ok) {
      const message = res.reason === 'ambiguous'
        ? `复核针位 P${index + 1} (${n.x}, ${n.y}) 重叠歧义：非相邻单元给出 ${res.positions.length} 个不同原网位置，无法唯一落针`
        : `复核针位 P${index + 1} (${n.x}, ${n.y}) 落在网外：全部单元解析求逆在闭合单元域内均无有效根`;
      return {
        ok: false, stage: 'trace', errors: [], geometry, traces: null,
        firstFailure: {
          index, x: n.x, y: n.y, reason: res.reason,
          positions: res.positions
            ? res.positions.map((p) => ({ u: p.u, v: p.v, witnesses: p.witnesses }))
            : null,
          message,
        },
      };
    }
    traces.push({
      index, x: n.x, y: n.y,
      u: res.u, v: res.v,
      cell: res.cell, s: res.s, t: res.t,
      residual: res.residual, witnesses: res.witnesses,
    });
  }

  return { ok: true, stage: 'trace', errors: [], geometry, firstFailure: null, traces };
}
