import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGrid, verifyGeometry, makeIdentityKnots, bilinearMap, cross2,
} from '../src/shared/bilinear.js';
import {
  traceNeedles, invertCell, quadraticRoots, validateNeedles,
  MIN_NEEDLES, MAX_NEEDLES,
} from '../src/shared/trace.js';

const ident = makeIdentityKnots;
const scale2 = (rows, cols) =>
  ident(rows, cols).map((row) => row.map((k) => ({ x: 2 * k.x, y: 2 * k.y })));

/** 螺旋网格：全部角点 J > 0（校核通过），但单元 (0,0) 与 (0,3) 的像区域重叠 */
const SPIRAL = [
  [{ x: 8, y: 0 }, { x: 0, y: 8 }, { x: -8, y: 0 }, { x: 0, y: -8 }, { x: 5, y: 5 }],
  [{ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 }, { x: 0, y: -5 }, { x: 4, y: 4 }],
  [{ x: 2, y: 0 }, { x: 0, y: 2 }, { x: -2, y: 0 }, { x: 0, y: -2 }, { x: 1, y: 1 }],
];

test('quadraticRoots：线性、两实根、重根、无实根、稳定求根', () => {
  assert.deepEqual(quadraticRoots(0, 2, -4), [2]); // 2t - 4 = 0
  assert.deepEqual(quadraticRoots(0, 0, 1), []); // 无解
  assert.deepEqual(quadraticRoots(0, 0, 0), []); // 恒等退化按无根处理
  assert.deepEqual([...quadraticRoots(1, -3, 2)].sort((a, b) => a - b), [1, 2]);
  assert.deepEqual(quadraticRoots(1, 2, 1), [-1]); // 重根只返回一次
  assert.deepEqual(quadraticRoots(1, 0, 1), []); // 无实根
  // 数值稳定：b 很大时小根不相消（t·t' = c/a = 1e-9）
  const [small] = quadraticRoots(1, 1e9 + 1e-9, 1).sort((a, b) => Math.abs(a) - Math.abs(b));
  assert.ok(Math.abs(small - -1e-9) < 1e-20, `小根精度：${small}`);
});

test('invertCell：恒等单元的内部点、角点、边中点', () => {
  const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  assert.deepEqual(invertCell(corners, 0, 0).map(({ s, t }) => [s, t]), [[0, 0]]);
  assert.deepEqual(invertCell(corners, 1, 1).map(({ s, t }) => [s, t]), [[1, 1]]);
  const mid = invertCell(corners, 1, 0);
  assert.equal(mid.length, 1);
  assert.ok(Math.abs(mid[0].s - 1) < 1e-12 && Math.abs(mid[0].t) < 1e-12);
  assert.equal(invertCell(corners, 5, 5).length, 0); // 域外无根
});

test('invertCell：非仿射双线性单元的域内根（解析求逆，非采样）', () => {
  // 与 test/bilinear.test.js 相同的非仿射单元：左上角移到 (-1,-1)
  const corners = [{ x: -1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  // 角点
  assert.deepEqual(invertCell(corners, -1, -1).map(({ s, t }) => [s, t]), [[0, 0]]);
  assert.deepEqual(invertCell(corners, 1, 0).map(({ s, t }) => [s, t]), [[1, 0]]);
  // 内部点：P(0.5,0.5) = (0.25,0.25)，二次方程另一根在域外，只保留并验证域内根
  const roots = invertCell(corners, 0.25, 0.25);
  assert.equal(roots.length, 1);
  assert.ok(Math.abs(roots[0].s - 0.5) < 1e-9 && Math.abs(roots[0].t - 0.5) < 1e-9);
  assert.ok(roots[0].residual < 1e-9);
  // 域外点无根
  assert.equal(invertCell(corners, 10, 10).length, 0);
});

test('validateNeedles：数量、整数与范围', () => {
  assert.equal(validateNeedles([{ x: 0, y: 0 }, { x: 1, y: 1 }]).length, 0);
  assert.equal(validateNeedles([{ x: 0, y: 0 }])[0].kind, 'needles-count');
  assert.equal(validateNeedles(Array.from({ length: 9 }, () => ({ x: 0, y: 0 })))[0].kind, 'needles-count');
  assert.equal(validateNeedles([{ x: 0.5, y: 0 }, { x: 1, y: 1 }])[0].kind, 'needle-integer');
  assert.equal(validateNeedles([{ x: 1000001, y: 0 }, { x: 1, y: 1 }])[0].kind, 'needle-range');
  assert.equal(validateNeedles(undefined)[0].kind, 'needles-count');
  assert.equal(MIN_NEEDLES, 2);
  assert.equal(MAX_NEEDLES, 8);
});

test('唯一追溯：恒等网格角点、边点、内部点', () => {
  const res = traceNeedles({
    rows: 2, cols: 2, knots: ident(2, 2),
    needles: [{ x: 1, y: 1 }, { x: 1, y: 0 }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.stage, 'trace');
  // 中心网结：四个单元公共角点，合并为一项，按既有归属归入单元 (1,1) 的 C0
  assert.deepEqual(res.traces[0], {
    index: 0, x: 1, y: 1, u: 1, v: 1,
    cell: { r: 1, c: 1 }, s: 0, t: 0,
    residual: 0,
    witnesses: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 1 }],
  });
  // 上边中点：两个单元公共边，合并后按既有归属归入单元 (0,1) 的 s=0 边
  assert.deepEqual(res.traces[1], {
    index: 1, x: 1, y: 0, u: 1, v: 0,
    cell: { r: 0, c: 1 }, s: 0, t: 0,
    residual: 0,
    witnesses: [{ r: 0, c: 0 }, { r: 0, c: 1 }],
  });
});

test('唯一追溯：放大 2 倍网格的原网坐标、单元与局部参数', () => {
  const res = traceNeedles({
    rows: 2, cols: 2, knots: scale2(2, 2),
    needles: [{ x: 1, y: 1 }, { x: 3, y: 3 }, { x: 4, y: 2 }],
  });
  assert.equal(res.ok, true);
  const [t0, t1, t2] = res.traces;
  assert.deepEqual([t0.u, t0.v, t0.cell, t0.s, t0.t], [0.5, 0.5, { r: 0, c: 0 }, 0.5, 0.5]);
  assert.deepEqual([t1.u, t1.v, t1.cell, t1.s, t1.t], [1.5, 1.5, { r: 1, c: 1 }, 0.5, 0.5]);
  // 外边界与公共边交点上的针位：两单元合并，按既有 locateCell 归属
  // （u=2 外边界归末单元 s=1；v=1 内部公共边归下一单元 t=0），与正向换算一致
  assert.deepEqual([t2.u, t2.v, t2.cell, t2.s, t2.t], [2, 1, { r: 1, c: 1 }, 1, 0]);
  assert.equal(t2.witnesses.length, 2);
  assert.ok(res.traces.every((t) => t.residual < 1e-9));
});

test('追溯归属与纹样标记正向换算一致（既有 locateCell 归属规则）', () => {
  const knots = scale2(2, 2);
  const markers = [{ u: 1, v: 0.5 }, { u: 1, v: 1 }, { u: 0.5, v: 0.5 }];
  const fwd = verifyGrid({ rows: 2, cols: 2, knots, markers });
  assert.equal(fwd.ok, true);
  // 正向换算出的织补位置作为针位反向追溯
  const needles = fwd.markers.map((m) => ({ x: Math.round(m.x), y: Math.round(m.y) }));
  const back = traceNeedles({ rows: 2, cols: 2, knots, needles });
  assert.equal(back.ok, true);
  back.traces.forEach((tr, i) => {
    const m = fwd.markers[i];
    assert.ok(Math.abs(m.x - tr.x) < 1e-9 && Math.abs(m.y - tr.y) < 1e-9);
    assert.deepEqual(
      [tr.u, tr.v, tr.cell, tr.s, tr.t],
      [m.u, m.v, m.cell, m.s, m.t],
      `针位 P${i + 1} 的追溯归属须与正向换算一致`,
    );
  });
});

test('网外针位：按录入顺序返回首个不可追溯证据，不输出其余结果', () => {
  const res = traceNeedles({
    rows: 2, cols: 2, knots: ident(2, 2),
    needles: [{ x: 0, y: 0 }, { x: 9, y: 9 }, { x: 1, y: 1 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'trace');
  assert.equal(res.firstFailure.index, 1);
  assert.equal(res.firstFailure.reason, 'outside');
  assert.equal(res.traces, null); // 即使 P1、P3 可追溯也不输出
});

test('重叠歧义：非相邻单元给出不同原网位置', () => {
  const geo = verifyGeometry(2, 4, SPIRAL);
  assert.equal(geo.ok, true, '螺旋网格本身须通过校核（局部 J>0 不保证整体不自交）');
  const res = traceNeedles({
    rows: 2, cols: 4, knots: SPIRAL,
    needles: [{ x: 6, y: 1 }, { x: 4, y: 3 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'trace');
  assert.equal(res.firstFailure.index, 1); // 按录入顺序：P1 唯一，P2 歧义
  assert.equal(res.firstFailure.reason, 'ambiguous');
  assert.equal(res.firstFailure.positions.length, 2);
  // 两个不同原网位置：分别位于单元 (0,0) 与 (0,3) 的域内
  const us = res.firstFailure.positions.map((p) => p.u).sort((a, b) => a - b);
  assert.ok(us[0] > 0 && us[0] < 1 && us[1] > 3 && us[1] < 4, `歧义位置：${us}`);
  assert.equal(res.traces, null);
});

test('重叠歧义：同一重叠区内的唯一针位仍可追溯（歧义按针位逐个判定）', () => {
  const res = traceNeedles({
    rows: 2, cols: 4, knots: SPIRAL,
    needles: [{ x: 6, y: 1 }, { x: -6, y: 1 }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.traces[0].witnesses.length, 1);
});

test('网格未通过校核时拒绝反向追溯', () => {
  const knots = ident(2, 2);
  knots[1][1] = { x: -1, y: -1 };
  const res = traceNeedles({
    rows: 2, cols: 2, knots,
    needles: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'geometry');
  assert.equal(res.geometry.firstFailure.type, 'fold');
  assert.equal(res.traces, null);
});

test('输入校验：针位数量与坐标、网结坐标', () => {
  const knots = ident(2, 2);
  const one = traceNeedles({ rows: 2, cols: 2, knots, needles: [{ x: 0, y: 0 }] });
  assert.equal(one.stage, 'validation');
  assert.equal(one.errors[0].kind, 'needles-count');
  const nine = traceNeedles({
    rows: 2, cols: 2, knots,
    needles: Array.from({ length: 9 }, () => ({ x: 0, y: 0 })),
  });
  assert.equal(nine.errors[0].kind, 'needles-count');
  const frac = traceNeedles({ rows: 2, cols: 2, knots, needles: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }] });
  assert.equal(frac.errors[0].kind, 'needle-integer');
  const badKnots = ident(2, 2);
  badKnots[0][0] = { x: 0.5, y: 0 };
  const bk = traceNeedles({ rows: 2, cols: 2, knots: badKnots, needles: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  assert.equal(bk.stage, 'validation');
  assert.equal(bk.errors[0].kind, 'knot-integer');
});

test('针位数量边界：2 个与 8 个均可追溯', () => {
  const knots = ident(2, 2);
  const two = traceNeedles({ rows: 2, cols: 2, knots, needles: [{ x: 0, y: 0 }, { x: 2, y: 2 }] });
  assert.equal(two.ok, true);
  const eight = traceNeedles({
    rows: 2, cols: 2, knots,
    needles: Array.from({ length: 8 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) })),
  });
  assert.equal(eight.ok, true);
  assert.equal(eight.traces.length, 8);
});

/** 凸四边形（J>0 已校核）闭合域包含判定：整数叉积精确计算，仅供测试交叉验证 */
function pointInClosedQuad(corners, qx, qy) {
  let pos = 0;
  let neg = 0;
  for (let k = 0; k < 4; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % 4];
    const cr = cross2(b.x - a.x, b.y - a.y, qx - a.x, qy - a.y);
    if (cr > 0) pos++;
    else if (cr < 0) neg++;
  }
  return pos === 0 || neg === 0;
}

test('解析求逆与精确几何包含判定交叉验证（测试可穷举，应用不采样）', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // 在 3 倍恒等网格上加 ±1 整数扰动，得到形态各异的合法网格（J>0 由 verifyGeometry 把关）
  let grids = 0;
  let needlesChecked = 0;
  for (let attempt = 0; attempt < 20000 && grids < 150; attempt++) {
    const rows = 2 + Math.floor(rand() * 3);
    const cols = 2 + Math.floor(rand() * 3);
    const knots = ident(rows, cols).map((row) => row.map((k) => ({
      x: 3 * k.x + Math.floor(rand() * 3) - 1,
      y: 3 * k.y + Math.floor(rand() * 3) - 1,
    })));
    const geo = verifyGeometry(rows, cols, knots);
    if (!geo.ok) continue;
    grids++;
    for (let n = 0; n < 20; n++) {
      const qx = Math.floor(rand() * 21) - 10;
      const qy = Math.floor(rand() * 21) - 10;
      needlesChecked++;
      const analytic = [];
      for (const cell of geo.cells) {
        const roots = invertCell(cell.corners, qx, qy);
        assert.ok(roots.length <= 1, '已校核网格同一单元至多一个域内根');
        if (roots.length) {
          analytic.push(`${cell.r},${cell.c}`);
          // 正向验证：根必须映回针位
          const p = bilinearMap(cell.corners, roots[0].s, roots[0].t);
          assert.ok(Math.abs(p.x - qx) < 1e-6 && Math.abs(p.y - qy) < 1e-6);
        }
      }
      const exact = geo.cells
        .filter((cell) => pointInClosedQuad(cell.corners, qx, qy))
        .map((cell) => `${cell.r},${cell.c}`);
      assert.deepEqual(analytic.sort(), exact.sort(), `针位 (${qx},${qy}) 的命中单元集合须一致`);
    }
  }
  assert.ok(grids >= 150 && needlesChecked >= 3000, `交叉验证样本量：${grids} 网格 / ${needlesChecked} 针位`);
});
