import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGrid, traceBack, traceProbe, exactCellRoots, invertBilinearClosed,
  makeIdentityKnots, bilinearMap, cellCorners, fieldEqual, cellsAdjacent,
  MIN_PROBES, MAX_PROBES,
} from '../src/shared/bilinear.js';

const ident = makeIdentityKnots;
const threeMarkers = [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }];

/* ---------------- 闭式求逆单元性质 ---------------- */

test('闭式求逆：恒等单元的整数像全部精确回到原格点', () => {
  const C = cellCorners(ident(2, 2), 0, 0);
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      const roots = exactCellRoots(C, { x, y });
      assert.equal(roots.degenerate, undefined);
      assert.equal(roots.length, 1, `(${x},${y}) 应恰有一个根`);
      assert.ok(Math.abs(roots[0].approx.s - x) < 1e-12);
      assert.ok(Math.abs(roots[0].approx.t - y) < 1e-12);
    }
  }
});

test('闭式求逆：J>0 单元内至多一个根（局部微分同胚），枚举与浮点参考一致', () => {
  // 多个手工 J>0 单元：仿射与真正双线性
  const cases = [
    [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }],
    [{ x: 1, y: 0 }, { x: 4, y: 1 }, { x: 3, y: 4 }, { x: 0, y: 3 }],
    [{ x: -1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  ];
  for (const C of cases) {
    for (let x = -3; x <= 6; x++) {
      for (let y = -3; y <= 6; y++) {
        const roots = exactCellRoots(C, { x, y });
        assert.ok(roots.length <= 1, 'J>0 单元不应出现两个不同原像');
        if (roots.length === 1) {
          const p = bilinearMap(C, roots[0].approx.s, roots[0].approx.t);
          assert.ok(Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);
        }
      }
    }
  }
});

test('闭式求逆：枚举闭合域全部根——角点、边、内部根均不遗漏（非采样）', () => {
  // 非仿射双线性单元，取若干“前向像恰为整数”的参数点做往返
  const C = [{ x: 1, y: 0 }, { x: 4, y: 1 }, { x: 5, y: 5 }, { x: 0, y: 4 }];
  const params = [
    [0, 0], [1, 0], [1, 1], [0, 1],           // 四角
    [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5],   // 四边中点
    [0.5, 0.5], [0.25, 0.75],                 // 内部
  ];
  for (const [s, t] of params) {
    const q = bilinearMap(C, s, t);
    // 该样例这些点像坐标恰好为整数
    if (!Number.isInteger(q.x) || !Number.isInteger(q.y)) continue;
    const roots = exactCellRoots(C, { x: q.x, y: q.y });
    assert.equal(roots.length, 1, `q=(${q.x},${q.y})`);
    assert.ok(Math.abs(roots[0].approx.s - s) < 1e-9);
    assert.ok(Math.abs(roots[0].approx.t - t) < 1e-9);
  }
});

test('闭式求逆：无像整数点返回空数组（方程无闭合域内有效根）', () => {
  const C = cellCorners(ident(2, 2), 0, 0);
  assert.deepEqual(exactCellRoots(C, { x: 5, y: 5 }), []);
  assert.deepEqual(exactCellRoots(C, { x: -1, y: 0 }), []);
});

test('闭式求逆：退化（J=0）单元标记 degenerate，不给出伪唯一结论', () => {
  // 两角点重合的退化单元
  const C = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  const res = exactCellRoots(C, { x: 1, y: 0 });
  assert.equal(res.degenerate, true);
});

test('invertBilinearClosed（浮点枚举）与精确实现给出相同根数量', () => {
  const C = [{ x: 2, y: -1 }, { x: 5, y: 0 }, { x: 6, y: 4 }, { x: 1, y: 3 }];
  for (let x = 0; x <= 8; x++) {
    for (let y = -1; y <= 5; y++) {
      const exact = exactCellRoots(C, { x, y });
      const loose = invertBilinearClosed(C, { x, y });
      if (exact.degenerate) continue;
      assert.equal(exact.length, loose.length, `(${x},${y}) 精确 ${exact.length} 根 vs 浮点 ${loose.length} 根`);
    }
  }
});

test('fieldEqual：跨二次域精确相等（√8=2√2）与有理元素相等', () => {
  assert.equal(fieldEqual({ p: 1n, q: 0n, d: 5n, den: 2n }, { p: 2n, q: 0n, d: 9n, den: 4n }), true);
  assert.equal(fieldEqual({ p: 1n, q: 1n, d: 2n, den: 3n }, { p: 2n, q: 1n, d: 8n, den: 6n }), true);
  assert.equal(fieldEqual({ p: 1n, q: 1n, d: 2n, den: 3n }, { p: 1n, q: 1n, d: 3n, den: 3n }), false);
});

/* ---------------- 全网反向追溯：唯一 ---------------- */

test('唯一追溯：恒等网格整数针位回到原网格点，给出单元与局部参数', () => {
  const res = traceBack({
    rows: 2, cols: 2, knots: ident(2, 2),
    probes: [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.stage, 'trace');
  assert.equal(res.traces.length, 3);
  assert.deepEqual([res.traces[0].u, res.traces[0].v], [0, 0]);
  assert.deepEqual(res.traces[0].cell, { r: 0, c: 0 });
  assert.deepEqual([res.traces[1].u, res.traces[1].v], [2, 1]);
  assert.deepEqual(res.traces[2].cell, { r: 1, c: 1 });
  // 附带精确数域证据（p/q/d/den 均为整数字符串）
  for (const t of res.traces) {
    for (const key of ['u', 'v', 's', 't']) assert.ok(typeof t.exact[key].p === 'string');
  }
});

test('唯一追溯：非仿射双线性网格，前向-反向往返一致', () => {
  const knots = ident(2, 2);
  knots[0][0] = { x: -1, y: -1 };
  const origMarkers = [
    { u: 0, v: 0 }, { u: 1, v: 0 }, { u: 0, v: 1 }, { u: 2, v: 2 },
  ];
  // 先做前向换算取得整数像点
  const vf = verifyGrid({ rows: 2, cols: 2, knots, markers: origMarkers });
  assert.equal(vf.ok, true);
  const probes = vf.markers.map((m) => ({ x: m.x, y: m.y }));
  assert.ok(probes.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)));

  const res = traceBack({ rows: 2, cols: 2, knots, probes });
  assert.equal(res.ok, true);
  res.traces.forEach((t, i) => {
    assert.ok(Math.abs(t.u - origMarkers[i].u) < 1e-9, `u 往返 ${i}`);
    assert.ok(Math.abs(t.v - origMarkers[i].v) < 1e-9, `v 往返 ${i}`);
  });
  // (0,0) 映到 (-1,-1)：追溯必须还原到被移动角点所在的单元 (0,0)
  assert.deepEqual(res.traces[0].cell, { r: 0, c: 0 });
  assert.deepEqual([res.traces[0].s, res.traces[0].t], [0, 0]);
});

/* ---------------- 公共边合并与稳定归属 ---------------- */

test('公共边：公共竖边上的同一位置合并为一项，按固定角点归属（s=0 一侧）', () => {
  // 放大 2 倍的 2x2 恒等网：针位 (2,1) 是 K(0,1)-K(1,1) 公共竖边中点，
  // 原网位置 (u=1, v=0.5)，单元 (0,0) 视其 s=1，单元 (0,1) 视其 s=0。
  const knots = ident(2, 2).map((row) => row.map((k) => ({ x: 2 * k.x, y: 2 * k.y })));
  const one = traceProbe({ rows: 2, cols: 2, knots }, { x: 2, y: 1 });
  assert.equal(one.status, 'unique');
  assert.equal(one.equivalents, 1); // 两个单元命中合并
  assert.deepEqual(one.hit.cell, { r: 0, c: 1 }); // 归 s=0 一侧（左单元…即右邻单元的 C0 边）
  assert.ok(Math.abs(one.hit.approx.u - 1) < 1e-9);
  assert.ok(Math.abs(one.hit.approx.v - 0.5) < 1e-9);
});

test('公共边：内部网结顶点被四个单元命中，合并为一项并稳定归 C0 单元', () => {
  const knots = ident(2, 2); // 针位 (1,1) 是四个单元的公共顶点
  const one = traceProbe({ rows: 2, cols: 2, knots }, { x: 1, y: 1 });
  assert.equal(one.status, 'unique');
  assert.equal(one.equivalents, 3); // 共 4 个命中合并为 1 项
  // (1,1) 在单元 (1,1) 为 C0(s=0,t=0)，固定角点序最早
  assert.deepEqual(one.hit.cell, { r: 1, c: 1 });
  assert.ok(Math.abs(one.hit.approx.u - 1) < 1e-12);
  assert.ok(Math.abs(one.hit.approx.v - 1) < 1e-12);
});

test('公共边：边界顶点归属与 locateCell 边界约定一致，且结果可复现', () => {
  const knots = ident(2, 2);
  const q = { x: 1, y: 0 }; // K(0,1)：单元 (0,0) 的 C1 与 (0,1) 的 C0
  const a = traceProbe({ rows: 2, cols: 2, knots }, q);
  const b = traceProbe({ rows: 2, cols: 2, knots }, q);
  assert.equal(a.status, 'unique');
  assert.equal(a.equivalents, 1);
  assert.deepEqual(a.hit.cell, { r: 0, c: 1 });
  assert.deepEqual(a.hit.cell, b.hit.cell);
});

/* ---------------- 不可追溯：网外 / 重叠歧义 / 顺序裁决 ---------------- */

test('网外针位：outside 证据，不输出追溯结果', () => {
  const res = traceBack({
    rows: 2, cols: 2, knots: ident(2, 2),
    probes: [{ x: 0, y: 0 }, { x: 9, y: 9 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'trace');
  assert.equal(res.traces, null);
  assert.equal(res.evidence.status, 'outside');
  assert.equal(res.evidence.index, 1);
  assert.equal(res.evidence.kind, 'outside');
});

test('针位顺序：第二个针位不可追溯时返回 index=1 的首个证据，其余结果不输出', () => {
  const knots = ident(2, 2);
  const res = traceBack({
    rows: 2, cols: 2, knots,
    probes: [{ x: 0, y: 0 }, { x: 9, y: 9 }, { x: 1, y: 1 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.evidence.index, 1);
  assert.equal(res.traces, null);
});

// 螺旋重叠样例：2 行 x 4 列，8 个单元四角 J 全为正，但非相邻单元像有面积重叠
const SPIRAL = [
  [{ x: 280, y: 110 }, { x: 103, y: 252 }, { x: 0, y: 64 }, { x: 192, y: 0 }, { x: 219, y: 187 }],
  [{ x: 240, y: 110 }, { x: 110, y: 214 }, { x: 34, y: 76 }, { x: 175, y: 29 }, { x: 195, y: 167 }],
  [{ x: 200, y: 110 }, { x: 116, y: 177 }, { x: 68, y: 88 }, { x: 158, y: 58 }, { x: 171, y: 146 }],
];

test('重叠歧义样例：全网校核通过（J_min>0），但针位被非相邻单元映到不同原网位置', () => {
  const vf = verifyGrid({ rows: 2, cols: 4, knots: SPIRAL, markers: threeMarkers });
  assert.equal(vf.ok, true);
  assert.ok(vf.minJacobian.value > 0);

  // (173,132)：单元 (1,0) 与非相邻单元 (1,3) 的不同原网位置
  const one = traceProbe({ rows: 2, cols: 4, knots: SPIRAL }, { x: 173, y: 132 });
  assert.equal(one.status, 'ambiguous');
  assert.equal(one.evidence.kind, 'overlap');
  assert.equal(one.evidence.adjacent, false);
  const cells = one.evidence.positions.map((p) => `${p.cell.r},${p.cell.c}`).sort();
  assert.deepEqual(cells, ['1,0', '1,3']);
  const [p0, p1] = one.evidence.positions;
  assert.ok(Math.hypot(p0.u - p1.u, p0.v - p1.v) > 0.1, '两个原网位置必须不同');

  // 全网追溯：首个针位即歧义 → 整体失败，不输出任何追溯项
  const res = traceBack({
    rows: 2, cols: 4, knots: SPIRAL,
    probes: [{ x: 173, y: 132 }, { x: 280, y: 110 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'trace');
  assert.equal(res.evidence.index, 0);
  assert.equal(res.evidence.status, 'ambiguous');
  assert.equal(res.traces, null);
});

test('重叠歧义样例：唯一针位在前、歧义针位在后时，返回歧义针位序号且不输出前项', () => {
  const res = traceBack({
    rows: 2, cols: 4, knots: SPIRAL,
    probes: [{ x: 280, y: 110 }, { x: 173, y: 132 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.evidence.index, 1);
  assert.equal(res.evidence.status, 'ambiguous');
  assert.equal(res.traces, null);
});

test('重叠歧义样例：同网仍有可唯一追溯的针位（网结与公共边点），证明歧义按针位隔离', () => {
  const res = traceBack({
    rows: 2, cols: 4, knots: SPIRAL,
    probes: [
      { x: 280, y: 110 },  // K(0,0)
      { x: 240, y: 110 },  // K(1,0)（公共顶点，合并）
      { x: 175, y: 162 },  // 行公共横边整数中点，合并上下单元
    ],
  });
  assert.equal(res.ok, true);
  assert.equal(res.traces.length, 3);
  assert.deepEqual([res.traces[0].u, res.traces[0].v], [0, 0]);
  assert.equal(res.traces[1].sharedEdgeMatches, 1);
  assert.equal(res.traces[2].sharedEdgeMatches, 1);
});

/* ---------------- 输入与前置校核 ---------------- */

test('针位校验：数量 2–8、整数坐标', () => {
  const base = { rows: 2, cols: 2, knots: ident(2, 2) };
  assert.equal(traceBack({ ...base, probes: [{ x: 0, y: 0 }] }).errors[0].kind, 'probes-count');
  assert.equal(
    traceBack({ ...base, probes: Array.from({ length: MAX_PROBES + 1 }, () => ({ x: 0, y: 0 })) }).errors[0].kind,
    'probes-count',
  );
  const bad = traceBack({
    ...base,
    probes: [{ x: 0.5, y: 0 }, { x: 0, y: 0 }],
  });
  assert.equal(bad.stage, 'validation');
  assert.equal(bad.errors[0].kind, 'probe-integer');
  assert.equal(MIN_PROBES, 2);
  assert.equal(MAX_PROBES, 8);
});

test('前置校核未通过（翻折网格）时追溯停在 geometry 阶段，不给出追溯结果', () => {
  const knots = ident(2, 2);
  knots[1][1] = { x: -1, y: -1 };
  const res = traceBack({
    rows: 2, cols: 2, knots,
    probes: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'geometry');
  assert.equal(res.firstFailure.type, 'fold');
  assert.equal(res.traces, null);
});

test('追溯与校核共用同一网结阵列：相邻关系判定正确', () => {
  assert.equal(cellsAdjacent(0, 0, 0, 1), true);
  assert.equal(cellsAdjacent(0, 0, 1, 0), true);
  assert.equal(cellsAdjacent(1, 0, 1, 3), false);
  assert.equal(cellsAdjacent(0, 0, 1, 1), false); // 仅共顶点不算相邻
});
