/**
 * 冒烟验收：健康检查 + 校核样例（通过 /api/verify，与浏览器页面共用同一数学模块）。
 * 用法：node scripts/smoke.js [baseURL]   （默认 http://127.0.0.1:8080，可用 SMOKE_BASE_URL 覆盖）
 * 全部通过退出码 0，否则退出码 1。
 */

const base = (process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');

let failures = 0;
function check(cond, label, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  —— ' + extra : ''}`);
  if (!cond) failures++;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const ident = (rows, cols) =>
  Array.from({ length: rows + 1 }, (_, i) =>
    Array.from({ length: cols + 1 }, (_, j) => ({ x: j, y: i })));

async function postVerify(spec) {
  const res = await fetch(`${base}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  });
  return { status: res.status, body: await res.json() };
}

async function postTrace(spec) {
  const res = await fetch(`${base}/api/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  });
  return { status: res.status, body: await res.json() };
}

/* 1) 健康检查（重试等待服务就绪） */
let health = null;
for (let i = 0; i < 30 && !health; i++) {
  try {
    const r = await fetch(`${base}/healthz`);
    if (r.ok) health = await r.json();
  } catch { /* 服务尚未就绪，继续等待 */ }
  if (!health) await new Promise((r) => setTimeout(r, 1000));
}
check(!!health && health.status === 'ok', '健康检查 GET /healthz', JSON.stringify(health));

/* 2) 样例 A：恒等网格 —— 通过，J_min = 1，标记原样换算 */
{
  const { status, body } = await postVerify({
    rows: 2, cols: 2, knots: ident(2, 2),
    markers: [{ u: 0.5, v: 0.5 }, { u: 1.5, v: 1.5 }, { u: 2, v: 1 }],
  });
  check(status === 200 && body.ok === true, '样例A：恒等网格校核通过');
  check(body.minJacobian && body.minJacobian.value === 1, '样例A：全网最小雅可比 = 1', JSON.stringify(body.minJacobian));
  const m = body.markers || [];
  check(
    m.length === 3 && near(m[0].x, 0.5) && near(m[0].y, 0.5) && near(m[1].x, 1.5) && near(m[2].x, 2) && near(m[2].y, 1),
    '样例A：标记换算位置正确', JSON.stringify(m),
  );
  check(body.edges && body.edges.continuous === true && body.edges.edgeCount === 4, '样例A：相邻单元共享边连续');
}

/* 3) 样例 B：翻折 —— 首项失败证据 = 单元(0,0) 角点 C1，J = -1，且不输出标记 */
{
  const k = ident(2, 2);
  k[1][1] = { x: -1, y: -1 };
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: k,
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 0.5 }],
  });
  const f = body.firstFailure || {};
  const cell = f.cell || {};
  check(
    body.ok === false && f.type === 'fold' && cell.r === 0 && cell.c === 0 && f.corner === 1 && f.jacobian === -1,
    '样例B：翻折首项证据（行优先单元 + 固定角点序）', JSON.stringify(f),
  );
  check(body.markers === null, '样例B：失败时不输出纹样换算位置');
}

/* 4) 样例 C：退化 —— 首项失败证据 = 单元(0,0) 角点 C1，J = 0 */
{
  const k = ident(2, 2);
  k[1][1] = { x: 2, y: 0 };
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: k,
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 0.5 }],
  });
  const f = body.firstFailure || {};
  const cell = f.cell || {};
  check(
    body.ok === false && f.type === 'degenerate' && cell.r === 0 && cell.c === 0 && f.corner === 1 && f.jacobian === 0,
    '样例C：退化首项证据', JSON.stringify(f),
  );
  check(body.markers === null, '样例C：失败时不输出纹样换算位置');
}

/* 5) 样例 D：无效坐标 —— 非整数网结被拒绝 */
{
  const k = ident(2, 2);
  k[0][1] = { x: 0.5, y: 0 };
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: k,
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }],
  });
  check(
    body.ok === false && body.stage === 'validation' && Array.isArray(body.errors) && body.errors.length > 0,
    '样例D：无效坐标被拒绝', JSON.stringify(body.errors && body.errors[0]),
  );
  check(body.markers === null, '样例D：无效输入不输出纹样位置');
}

/* 6) 反向追溯样例 E：唯一追溯 —— 恒等网格整数针位精确回到原网格点 */
{
  const { status, body } = await postTrace({
    rows: 2, cols: 2, knots: ident(2, 2),
    probes: [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
  });
  check(status === 200 && body.ok === true && body.stage === 'trace', '样例E：恒等网格反向追溯通过');
  const t = body.traces || [];
  check(t.length === 3 && near(t[0].u, 0) && near(t[0].v, 0) && near(t[1].u, 2) && near(t[1].v, 1),
    '样例E：针位唯一回到原网坐标', JSON.stringify(t.map((z) => [z.u, z.v])));
  check(t[0].exact && typeof t[0].exact.u.p === 'string', '样例E：附带 BigInt 精确数域证据');
}

/* 7) 反向追溯样例 F：公共边合并 —— 内部顶点四单元命中合一项，边界归属稳定 */
{
  // (1,1) 在恒等 2x2 中是四个单元的公共顶点
  const { body: center } = await postTrace({
    rows: 2, cols: 2, knots: ident(2, 2),
    probes: [{ x: 1, y: 1 }, { x: 0, y: 0 }],
  });
  check(center.ok === true && center.traces[0].sharedEdgeMatches === 3,
    '样例F：内部公共顶点四单元命中合并为一项', JSON.stringify(center.traces && center.traces[0]));
  check(center.traces[0].cell.r === 1 && center.traces[0].cell.c === 1,
    '样例F：公共点按既有边界约定稳定归属 (1,1)');

  // 放大 2 倍网格：公共竖边整数中点 (2,1) 合两项
  const k2 = ident(2, 2).map((row) => row.map((z) => ({ x: 2 * z.x, y: 2 * z.y })));
  const { body: edge } = await postTrace({
    rows: 2, cols: 2, knots: k2,
    probes: [{ x: 2, y: 1 }, { x: 0, y: 0 }],
  });
  check(edge.ok === true && edge.traces[0].sharedEdgeMatches === 1 &&
    near(edge.traces[0].u, 1) && near(edge.traces[0].v, 0.5),
    '样例F：相邻单元公共边同位置合并为一项', JSON.stringify(edge.traces && edge.traces[0]));
}

/* 8) 反向追溯样例 G：重叠歧义 —— 全网校核通过但非相邻单元给出不同原网位置 */
{
  // 2x4 开口螺旋：8 个单元四角 J 全为正（最小 1839），片 0 与片 3 像有面积重叠
  const spiral = [
    [{ x: 280, y: 110 }, { x: 103, y: 252 }, { x: 0, y: 64 }, { x: 192, y: 0 }, { x: 219, y: 187 }],
    [{ x: 240, y: 110 }, { x: 110, y: 214 }, { x: 34, y: 76 }, { x: 175, y: 29 }, { x: 195, y: 167 }],
    [{ x: 200, y: 110 }, { x: 116, y: 177 }, { x: 68, y: 88 }, { x: 158, y: 58 }, { x: 171, y: 146 }],
  ];
  const vf = await postVerify({
    rows: 2, cols: 4, knots: spiral,
    markers: [{ u: 0.5, v: 0.5 }, { u: 2, v: 1 }, { u: 3.5, v: 1.5 }],
  });
  check(vf.body.ok === true && vf.body.minJacobian.value === 1839,
    '样例G：歧义样例网格本身校核通过（J_min=1839）');

  const { body } = await postTrace({
    rows: 2, cols: 4, knots: spiral,
    probes: [{ x: 280, y: 110 }, { x: 173, y: 132 }], // 先唯一、后歧义
  });
  const e = body.evidence || {};
  check(body.ok === false && body.stage === 'trace' && e.index === 1 &&
    e.status === 'ambiguous' && e.kind === 'overlap' && e.adjacent === false,
    '样例G：非相邻单元不同原网位置 → 重叠歧义，首个证据按针位序号返回', JSON.stringify(e));
  check(body.traces === null, '样例G：存在歧义针位时不输出其余追溯结果');

  // 歧义针位排在第一位时 index=0
  const first = await postTrace({
    rows: 2, cols: 4, knots: spiral,
    probes: [{ x: 173, y: 132 }, { x: 280, y: 110 }],
  });
  check(first.body.ok === false && first.body.evidence.index === 0,
    '样例G：歧义针位首位时 index=0');
}

/* 9) 反向追溯样例 H：网外针位与输入校验 */
{
  const outside = await postTrace({
    rows: 2, cols: 2, knots: ident(2, 2),
    probes: [{ x: 0, y: 0 }, { x: 9, y: 9 }],
  });
  check(outside.body.ok === false && outside.body.evidence.status === 'outside' &&
    outside.body.evidence.index === 1 && outside.body.traces === null,
    '样例H：针位落在网外（无有效根）→ outside 证据，不输出结果');

  const countBad = await postTrace({ rows: 2, cols: 2, knots: ident(2, 2), probes: [{ x: 0, y: 0 }] });
  check(countBad.body.ok === false && countBad.body.stage === 'validation' &&
    countBad.body.errors[0].kind === 'probes-count',
    '样例H：针位数量须为 2–8 个');

  const intBad = await postTrace({
    rows: 2, cols: 2, knots: ident(2, 2),
    probes: [{ x: 0.5, y: 0 }, { x: 0, y: 0 }],
  });
  check(intBad.body.stage === 'validation' && intBad.body.errors[0].kind === 'probe-integer',
    '样例H：复核针位须为整数坐标');
}

if (failures) {
  console.error(`\n冒烟验收未通过：${failures} 项失败`);
  process.exit(1);
}
console.log('\n冒烟验收通过：健康检查 + 校核样例 + 反向追溯（唯一/公共边/重叠歧义/网外）');
