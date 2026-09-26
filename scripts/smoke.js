/**
 * 冒烟验收：健康检查 + 校核样例 + 反向追溯样例（通过 /api/verify 与 /api/trace，
 * 与浏览器页面共用同一数学模块）。
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

/* 6) 样例 E：反向追溯·唯一追溯 —— 均匀放大 2 倍网格，针位各自对应唯一原网位置 */
{
  const scale2 = ident(2, 2).map((row) => row.map((k) => ({ x: 2 * k.x, y: 2 * k.y })));
  const { status, body } = await postTrace({
    rows: 2, cols: 2, knots: scale2,
    needles: [{ x: 1, y: 1 }, { x: 3, y: 3 }],
  });
  const t = body.traces || [];
  check(status === 200 && body.ok === true && body.stage === 'trace', '样例E：唯一追溯通过');
  check(
    t.length === 2
      && near(t[0].u, 0.5) && near(t[0].v, 0.5) && t[0].cell.r === 0 && t[0].cell.c === 0
      && near(t[0].s, 0.5) && near(t[0].t, 0.5) && t[0].witnesses.length === 1
      && near(t[1].u, 1.5) && near(t[1].v, 1.5) && t[1].cell.r === 1 && t[1].cell.c === 1,
    '样例E：原网坐标、所在单元与局部参数正确', JSON.stringify(t),
  );
  check(body.geometry && body.geometry.ok === true, '样例E：追溯证据附几何校核通过结论');
}

/* 7) 样例 F：反向追溯·公共边合并 —— 边上/角点针位被相邻单元同时给出，合并为一项并按既有归属显示 */
{
  const scale2 = ident(2, 2).map((row) => row.map((k) => ({ x: 2 * k.x, y: 2 * k.y })));
  const { body } = await postTrace({
    rows: 2, cols: 2, knots: scale2,
    needles: [{ x: 2, y: 1 }, { x: 2, y: 2 }],
  });
  const t = body.traces || [];
  check(
    body.ok === true && t.length === 2
      && near(t[0].u, 1) && near(t[0].v, 0.5) && t[0].witnesses.length === 2
      && t[0].cell.r === 0 && t[0].cell.c === 1 && near(t[0].s, 0) && near(t[0].t, 0.5)
      && near(t[1].u, 1) && near(t[1].v, 1) && t[1].witnesses.length === 4
      && t[1].cell.r === 1 && t[1].cell.c === 1 && near(t[1].s, 0) && near(t[1].t, 0),
    '样例F：公共边/公共角点合并为一项并按既有归属稳定显示', JSON.stringify(t),
  );
}

/* 8) 样例 G：反向追溯·重叠歧义 —— 局部 J>0 但非相邻单元像重叠，针位对应两个不同原网位置 */
{
  // 螺旋网格：全部角点 J > 0（校核通过），但单元 (0,0) 与 (0,3) 的像区域重叠
  const spiral = [
    [{ x: 8, y: 0 }, { x: 0, y: 8 }, { x: -8, y: 0 }, { x: 0, y: -8 }, { x: 5, y: 5 }],
    [{ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 }, { x: 0, y: -5 }, { x: 4, y: 4 }],
    [{ x: 2, y: 0 }, { x: 0, y: 2 }, { x: -2, y: 0 }, { x: 0, y: -2 }, { x: 1, y: 1 }],
  ];
  const { body } = await postTrace({
    rows: 2, cols: 4, knots: spiral,
    needles: [{ x: 4, y: 3 }, { x: 6, y: 1 }],
  });
  const f = body.firstFailure || {};
  check(
    body.geometry && body.geometry.ok === true,
    '样例G：螺旋网格本身通过校核（局部 J>0 不保证整体不自交）',
  );
  check(
    body.ok === false && body.stage === 'trace' && f.index === 0 && f.reason === 'ambiguous'
      && Array.isArray(f.positions) && f.positions.length === 2,
    '样例G：重叠歧义按录入顺序报告首个不可追溯证据', JSON.stringify(f),
  );
  check(body.traces === null, '样例G：不输出其余针位的追溯结果');
}

/* 9) 样例 H：反向追溯·网外 —— 首个不可追溯证据按录入顺序定位，且不输出任何追溯结果 */
{
  const { body } = await postTrace({
    rows: 2, cols: 2, knots: ident(2, 2),
    needles: [{ x: 0, y: 0 }, { x: 9, y: 9 }],
  });
  const f = body.firstFailure || {};
  check(
    body.ok === false && body.stage === 'trace' && f.index === 1 && f.reason === 'outside',
    '样例H：网外针位为首个不可追溯证据', JSON.stringify(f),
  );
  check(body.traces === null, '样例H：不输出其余针位的追溯结果');
}

/* 10) 样例 I：反向追溯·拒追 —— 定位网未通过校核时拒绝追溯 */
{
  const k = ident(2, 2);
  k[1][1] = { x: -1, y: -1 };
  const { body } = await postTrace({
    rows: 2, cols: 2, knots: k,
    needles: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  });
  check(
    body.ok === false && body.stage === 'geometry' && body.traces === null
      && body.geometry && body.geometry.firstFailure && body.geometry.firstFailure.type === 'fold',
    '样例I：网格未通过校核时拒绝反向追溯', JSON.stringify(body.geometry && body.geometry.firstFailure),
  );
}

if (failures) {
  console.error(`\n冒烟验收未通过：${failures} 项失败`);
  process.exit(1);
}
console.log('\n冒烟验收通过：健康检查 + 全部校核与反向追溯样例');
