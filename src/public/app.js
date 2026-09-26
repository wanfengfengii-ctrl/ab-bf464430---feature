import {
  verifyGrid, traceBack, makeIdentityKnots,
  MIN_ROWS, MAX_ROWS, MIN_COLS, MAX_COLS,
  MIN_MARKERS, MAX_MARKERS, MIN_PROBES, MAX_PROBES,
  CORNER_NAMES, FAILURE_TYPE_NAMES,
} from '/shared/bilinear.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');

function defaultMarkers(rows, cols) {
  return [
    { u: 0.5, v: 0.5 },
    { u: cols / 2, v: rows / 2 },
    { u: cols - 0.5, v: rows - 0.5 },
  ];
}

function defaultProbes(rows, cols) {
  // 默认两个互异的整数格点（2–4 规格下均合法），恒等网格中与原网一致
  return [
    { x: 1, y: 1 },
    { x: Math.max(2, cols - 1), y: Math.max(2, rows - 1) },
  ];
}

const state = {
  rows: 3,
  cols: 3,
  knots: makeIdentityKnots(3, 3),
  markers: defaultMarkers(3, 3),
  probes: defaultProbes(3, 3),
  result: null,  // 最近一次校核结论
  trace: null,   // 最近一次反向追溯结论
  fresh: false,  // 校核结论是否仍对应当前输入
  traceFresh: false, // 追溯结论是否仍对应当前输入
};

/* ---------------- 输入控件 ---------------- */

const rowsSel = $('#rows');
const colsSel = $('#cols');
for (let n = MIN_ROWS; n <= MAX_ROWS; n++) rowsSel.add(new Option(String(n), n));
for (let n = MIN_COLS; n <= MAX_COLS; n++) colsSel.add(new Option(String(n), n));
rowsSel.value = state.rows;
colsSel.value = state.cols;
rowsSel.onchange = () => resetGrid(Number(rowsSel.value), state.cols);
colsSel.onchange = () => resetGrid(state.rows, Number(colsSel.value));

$('#resetKnots').onclick = () => {
  state.knots = makeIdentityKnots(state.rows, state.cols);
  buildKnotFields();
  invalidate();
};

function resetGrid(rows, cols) {
  state.rows = rows;
  state.cols = cols;
  state.knots = makeIdentityKnots(rows, cols);
  state.markers = defaultMarkers(rows, cols);
  state.probes = defaultProbes(rows, cols);
  state.result = null;
  state.trace = null;
  buildKnotFields();
  buildMarkerFields();
  buildProbeFields();
  invalidate();
}

let knotInputs = []; // knotInputs[i][j] = { xi, yi }

function buildKnotFields() {
  const host = $('#knotFields');
  host.innerHTML = '';
  knotInputs = [];
  for (let i = 0; i <= state.rows; i++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'knot-row';
    const title = document.createElement('span');
    title.className = 'knot-row-title';
    title.textContent = `第 ${i} 行`;
    rowEl.append(title);
    const arr = [];
    for (let j = 0; j <= state.cols; j++) {
      const k = state.knots[i][j];
      const field = document.createElement('span');
      field.className = 'knot-field';
      const lab = document.createElement('em');
      lab.textContent = `K(${i},${j})`;
      const xi = document.createElement('input');
      xi.type = 'number';
      xi.step = '1';
      xi.value = Number.isFinite(k.x) ? k.x : '';
      xi.setAttribute('aria-label', `K(${i},${j}) x`);
      const yi = document.createElement('input');
      yi.type = 'number';
      yi.step = '1';
      yi.value = Number.isFinite(k.y) ? k.y : '';
      yi.setAttribute('aria-label', `K(${i},${j}) y`);
      xi.oninput = () => updateKnot(i, j, xi.valueAsNumber, state.knots[i][j].y);
      yi.oninput = () => updateKnot(i, j, state.knots[i][j].x, yi.valueAsNumber);
      field.append(lab, xi, yi);
      rowEl.append(field);
      arr.push({ xi, yi });
    }
    host.append(rowEl);
    knotInputs.push(arr);
  }
}

function updateKnot(i, j, x, y) {
  state.knots[i][j] = { x, y };
  invalidate();
}

function syncKnotInputs(i, j) {
  const pair = knotInputs[i] && knotInputs[i][j];
  if (!pair) return;
  pair.xi.value = state.knots[i][j].x;
  pair.yi.value = state.knots[i][j].y;
}

function buildMarkerFields() {
  const host = $('#markerFields');
  host.innerHTML = '';
  state.markers.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = 'marker-row';
    const lab = document.createElement('em');
    lab.textContent = `M${idx + 1}`;
    const ui = document.createElement('input');
    ui.type = 'number';
    ui.step = '0.1';
    ui.value = Number.isFinite(m.u) ? m.u : '';
    ui.oninput = () => { state.markers[idx].u = ui.valueAsNumber; invalidate(); };
    const vi = document.createElement('input');
    vi.type = 'number';
    vi.step = '0.1';
    vi.value = Number.isFinite(m.v) ? m.v : '';
    vi.oninput = () => { state.markers[idx].v = vi.valueAsNumber; invalidate(); };
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '删除';
    rm.disabled = state.markers.length <= MIN_MARKERS;
    rm.onclick = () => {
      state.markers.splice(idx, 1);
      buildMarkerFields();
      invalidate();
    };
    row.append(lab, document.createTextNode('u ='), ui, document.createTextNode('v ='), vi, rm);
    host.append(row);
  });
  $('#addMarker').disabled = state.markers.length >= MAX_MARKERS;
}

$('#addMarker').onclick = () => {
  if (state.markers.length >= MAX_MARKERS) return;
  state.markers.push({ u: state.cols / 2, v: state.rows / 2 });
  buildMarkerFields();
  invalidate();
};

/* ---------------- 复核针位控件 ---------------- */

function buildProbeFields() {
  const host = $('#probeFields');
  host.innerHTML = '';
  state.probes.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'marker-row';
    const lab = document.createElement('em');
    lab.textContent = `P${idx + 1}`;
    const xi = document.createElement('input');
    xi.type = 'number';
    xi.step = '1';
    xi.value = Number.isFinite(p.x) ? p.x : '';
    xi.setAttribute('aria-label', `P${idx + 1} x`);
    xi.oninput = () => { state.probes[idx].x = xi.valueAsNumber; invalidateTraceOnly(); };
    const yi = document.createElement('input');
    yi.type = 'number';
    yi.step = '1';
    yi.value = Number.isFinite(p.y) ? p.y : '';
    yi.setAttribute('aria-label', `P${idx + 1} y`);
    yi.oninput = () => { state.probes[idx].y = yi.valueAsNumber; invalidateTraceOnly(); };
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '删除';
    rm.disabled = state.probes.length <= MIN_PROBES;
    rm.onclick = () => {
      state.probes.splice(idx, 1);
      buildProbeFields();
      invalidateTraceOnly();
    };
    row.append(lab, document.createTextNode('x ='), xi, document.createTextNode('y ='), yi, rm);
    host.append(row);
  });
  $('#addProbe').disabled = state.probes.length >= MAX_PROBES;
}

$('#addProbe').onclick = () => {
  if (state.probes.length >= MAX_PROBES) return;
  state.probes.push({ x: 0, y: 0 });
  buildProbeFields();
  invalidateTraceOnly();
};

$('#traceBtn').onclick = () => {
  state.trace = traceBack({
    rows: state.rows,
    cols: state.cols,
    knots: state.knots,
    probes: state.probes,
  });
  state.traceFresh = true;
  renderTraceResults();
  draw();
};

$('#verifyBtn').onclick = () => {
  state.result = verifyGrid({
    rows: state.rows,
    cols: state.cols,
    knots: state.knots,
    markers: state.markers,
  });
  state.fresh = true;
  renderResults();
  updateTraceGate();
  draw();
};

/** 任何网结、网格规格或纹样标记修改：校核与追溯结论同时失效 */
function invalidate() {
  state.fresh = false;
  state.traceFresh = false;
  renderResults();
  renderTraceResults();
  updateTraceGate();
  draw();
}

/**
 * 仅复核针位增删改：只使追溯结论失效。
 * 校核不以针位为输入，历史草稿（无针位）的既有校核与结果继续保持。
 */
function invalidateTraceOnly() {
  state.traceFresh = false;
  renderTraceResults();
  draw();
}

/* ---------------- 结论展示 ---------------- */

function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(4).replace(/\.?0+$/, '');
  return s === '' || s === '-' ? '0' : s;
}

function renderResults() {
  const host = $('#results');
  const stale = $('#staleNotice');
  if (!state.result) {
    stale.hidden = true;
    host.innerHTML = '<p class="hint">尚未校核。配置网格与标记后点击“校核”，将对每个单元做连续双线性判定。</p>';
    return;
  }
  if (!state.fresh) {
    stale.hidden = false;
    host.innerHTML = '';
    return;
  }
  stale.hidden = true;
  host.innerHTML = renderConclusion(state.result);
}

function renderCellTable(res) {
  const rows = res.cells.map((cell, i) => {
    const js = cell.cornerJacobians
      .map((j, k) => `<span class="${j <= 0 ? 'bad' : ''}">J${k}=${j}</span>`)
      .join(' ');
    return `<tr class="${cell.ok ? '' : 'fail-row'}">
      <td>单元 (${cell.r},${cell.c})（行优先第 ${i + 1} 个）</td>
      <td>${js}</td>
      <td>${cell.minJ}</td>
      <td>${cell.ok ? '通过' : '失败'}</td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr><th>单元（行优先）</th><th>四角雅可比（固定角点序 C0→C3）</th><th>最小值</th><th>结论</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderConclusion(res) {
  const parts = [];

  if (res.stage === 'validation') {
    parts.push(`<div class="banner fail">输入无效：共 ${res.errors.length} 处问题，首项如下。</div>`);
    parts.push(`<p class="first-failure">首项失败证据：${res.errors[0].message}</p>`);
    if (res.errors.length > 1) {
      parts.push(`<ul>${res.errors.slice(1).map((e) => `<li>${e.message}</li>`).join('')}</ul>`);
    }
    parts.push('<p class="hint">已拦截：未输出纹样换算位置，以免失真坐标误导织补。</p>');
    return parts.join('');
  }

  if (!res.ok) {
    const f = res.firstFailure;
    const n = f.cell.r * state.cols + f.cell.c + 1;
    parts.push(`<div class="banner fail">校核未通过：网格存在${f.type === 'fold' ? '翻折' : '退化'}。</div>`);
    parts.push(`<p class="first-failure">首项失败证据：单元 (${f.cell.r},${f.cell.c})（行优先第 ${n} 个单元），`
      + `角点 ${CORNER_NAMES[f.corner]}，J = ${f.jacobian}，判定：${FAILURE_TYPE_NAMES[f.type]}。</p>`);
    parts.push('<p class="hint">已拦截：未输出纹样换算位置，以免失真坐标误导织补。</p>');
    parts.push(renderCellTable(res));
    return parts.join('');
  }

  const m = res.minJacobian;
  parts.push('<div class="banner ok">校核通过：全网连续无翻折、无退化。</div>');
  parts.push(`<p>全网最小雅可比证据：<b>J<sub>min</sub> = ${m.value}</b>，`
    + `位于单元 (${m.cell.r},${m.cell.c}) 角点 ${CORNER_NAMES[m.corner]}。`
    + `双线性函数的最小值必在角点取得，故单元内部任意位置 J ≥ J<sub>min</sub> &gt; 0（连续判定，非采样）。</p>`);
  parts.push(`<p>相邻单元共享边：${res.edges.continuous ? '连续' : '不连续'}`
    + `（共 ${res.edges.edgeCount} 条内部边，两侧共用同一对网结，边上双线性退化为同一线性插值）。</p>`);

  const markerRows = res.markers.map((mk) =>
    `<tr>
      <td>M${mk.index + 1}</td>
      <td>(${fmt(mk.u)}, ${fmt(mk.v)})</td>
      <td>单元 (${mk.cell.r},${mk.cell.c})，s=${fmt(mk.s)}，t=${fmt(mk.t)}</td>
      <td><b>(${fmt(mk.x)}, ${fmt(mk.y)})</b></td>
    </tr>`).join('');
  parts.push(`<table>
    <thead><tr><th>标记</th><th>原网坐标 (u, v)</th><th>所在单元 / 局部坐标</th><th>织补坐标 (x, y)</th></tr></thead>
    <tbody>${markerRows}</tbody>
  </table>`);
  parts.push(renderCellTable(res));
  return parts.join('');
}

/* ---------------- 反向追溯结论展示 ---------------- */

function updateTraceGate() {
  const btn = $('#traceBtn');
  const gate = $('#traceGate');
  const res = state.result;
  if (!res) {
    btn.disabled = true;
    gate.textContent = '请先在第 4 步完成定位网校核。';
    return;
  }
  if (!state.fresh) {
    btn.disabled = true;
    gate.textContent = '输入已修改、旧校核失效，请重新校核后再追溯。';
    return;
  }
  if (res.stage !== 'geometry' || !res.ok) {
    btn.disabled = true;
    gate.textContent = '定位网未通过校核，不能发起反向追溯。';
    return;
  }
  btn.disabled = false;
  gate.textContent = '定位网已校核通过，可录入针位并追溯。';
}

function exactText(e) {
  const rad = BigInt(e.q) === 0n ? '' : ` ${BigInt(e.q) < 0n ? '−' : '+'} ${BigInt(e.q) < 0n ? -BigInt(e.q) : BigInt(e.q)}·√${e.d}`;
  return `(${e.p}${rad}) / ${e.den}`;
}

function renderTraceResults() {
  const host = $('#traceResults');
  const stale = $('#traceStale');
  if (!state.trace) {
    stale.hidden = true;
    host.innerHTML = '<p class="hint">尚未追溯。校核通过后录入 2–8 个整数针位，点击“反向追溯”。</p>';
    return;
  }
  if (!state.traceFresh) {
    stale.hidden = false;
    host.innerHTML = '';
    return;
  }
  stale.hidden = true;
  const res = state.trace;
  const parts = [];

  if (res.stage === 'validation') {
    parts.push(`<div class="banner fail">追溯输入无效：共 ${res.errors.length} 处问题，首项如下。</div>`);
    parts.push(`<p class="first-failure">首项失败证据：${res.errors[0].message}</p>`);
    if (res.errors.length > 1) {
      parts.push(`<ul>${res.errors.slice(1).map((e) => `<li>${e.message}</li>`).join('')}</ul>`);
    }
    host.innerHTML = parts.join('');
    return;
  }

  if (res.stage === 'geometry') {
    const f = res.firstFailure;
    parts.push('<div class="banner fail">定位网几何校核未通过，不能反向追溯。</div>');
    if (f) {
      parts.push(`<p class="first-failure">首项失败证据：单元 (${f.cell.r},${f.cell.c})，`
        + `角点 ${CORNER_NAMES[f.corner]}，J = ${f.jacobian}（${FAILURE_TYPE_NAMES[f.type]}）。请重新校核。</p>`);
    }
    host.innerHTML = parts.join('');
    return;
  }

  if (!res.ok) {
    const ev = res.evidence;
    let title = '反向追溯失败';
    if (ev.status === 'outside') title = '针位落在网外（方程无有效根）';
    if (ev.status === 'ambiguous') title = '原网位置不唯一（重叠歧义）';
    if (ev.status === 'multi-root') title = '单元方程存在多个有效根';
    parts.push(`<div class="banner fail">${title}</div>`);
    parts.push(`<p class="first-failure">首个不可追溯证据（按针位录入顺序）：P${ev.index + 1} `
      + `(${ev.probe.x}, ${ev.probe.y})。${ev.message || ''}</p>`);
    if (Array.isArray(ev.positions) && ev.positions.length) {
      parts.push('<table><thead><tr><th>候选单元</th><th>候选原网坐标 (u, v)</th></tr></thead><tbody>');
      for (const p of ev.positions) {
        parts.push(`<tr><td>单元 (${p.cell.r},${p.cell.c})</td><td>(${fmt(p.u)}, ${fmt(p.v)})</td></tr>`);
      }
      parts.push('</tbody></table>');
    }
    parts.push('<p class="hint">已拦截：不输出任何追溯结果，修复师不会依据该歧义针位落针。请核对针位或定位网。</p>');
    host.innerHTML = parts.join('');
    return;
  }

  parts.push('<div class="banner ok">反向追溯通过：每个针位均唯一对应原网位置（公共边同一位置已合并）。</div>');
  parts.push(`<table>
    <thead><tr><th>针位</th><th>织补坐标 (x, y)</th><th>原网坐标 (u, v)</th><th>所在单元</th><th>局部参数 (s, t)</th><th>公共边合并</th></tr></thead>
    <tbody>`);
  for (const t of res.traces) {
    const merge = t.sharedEdgeMatches > 0
      ? `与 ${t.sharedEdgeMatches} 个相邻单元同位置，已归此单元`
      : '单一单元';
    parts.push(`<tr>
      <td>P${t.index + 1}</td>
      <td>(${t.probe.x}, ${t.probe.y})</td>
      <td><b>(${fmt(t.u)}, ${fmt(t.v)})</b></td>
      <td>(${t.cell.r}, ${t.cell.c})</td>
      <td>s=${fmt(t.s)}, t=${fmt(t.t)}</td>
      <td>${merge}</td>
    </tr>`);
  }
  parts.push('</tbody></table>');
  parts.push('<details class="exact-details"><summary>查看 BigInt 精确数域证据（闭式二次方程根，判定不依赖浮点）</summary><dl>');
  for (const t of res.traces) {
    parts.push(`<dt>P${t.index + 1} 原网 u</dt><dd>${exactText(t.exact.u)}</dd>`);
    parts.push(`<dt>P${t.index + 1} 原网 v</dt><dd>${exactText(t.exact.v)}</dd>`);
  }
  parts.push('</dl></details>');
  host.innerHTML = parts.join('');
}

/* ---------------- 画布 ---------------- */

const COLORS = {
  original: '#9aa4b2',
  edge: '#2f4b7c',
  knot: '#1565c0',
  knotFill: '#ffffff',
  marker: '#6b7280',
  mapped: '#d32f2f',
  ok: 'rgba(40,160,90,0.16)',
  fail: 'rgba(220,60,60,0.14)',
  failFirst: 'rgba(220,60,60,0.32)',
  plain: 'rgba(80,120,200,0.10)',
};

let view = { scale: 1, ox: 0, oy: 0 };

function computeView() {
  const pts = [{ x: 0, y: 0 }, { x: state.cols, y: state.rows }];
  for (const row of state.knots) {
    for (const k of row) if (finite(k)) pts.push(k);
  }
  for (const m of state.markers) {
    if (Number.isFinite(m.u) && Number.isFinite(m.v)) pts.push({ x: m.u, y: m.v });
  }
  for (const p of state.probes) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push({ x: p.x, y: p.y });
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const pad = 60;
  const W = canvas.width, H = canvas.height;
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
  view = {
    scale,
    ox: pad + ((W - 2 * pad) - w * scale) / 2 - minX * scale,
    oy: pad + ((H - 2 * pad) - h * scale) / 2 - minY * scale,
  };
}

const toPx = (x, y) => [view.ox + x * view.scale, view.oy + y * view.scale];
const toGrid = (px, py) => [(px - view.ox) / view.scale, (py - view.oy) / view.scale];
const finite = (p) => Number.isFinite(p.x) && Number.isFinite(p.y);

function line(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function cellCornersOf(r, c) {
  return [state.knots[r][c], state.knots[r][c + 1], state.knots[r + 1][c + 1], state.knots[r + 1][c]];
}

function cellStatus(res, r, c) {
  if (!res || res.stage !== 'geometry') return 'plain';
  const cell = res.cells[r * state.cols + c];
  if (!cell) return 'plain';
  if (cell.ok) return 'ok';
  const f = res.firstFailure;
  return f && f.cell.r === r && f.cell.c === c ? 'failFirst' : 'fail';
}

function draw() {
  computeView();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1;
  drawOriginalGrid();
  drawCells();
  drawMarkers();
  drawProbes();
  drawKnots();
}

function drawOriginalGrid() {
  ctx.save();
  ctx.strokeStyle = COLORS.original;
  ctx.setLineDash([5, 4]);
  for (let j = 0; j <= state.cols; j++) line(...toPx(j, 0), ...toPx(j, state.rows));
  for (let i = 0; i <= state.rows; i++) line(...toPx(0, i), ...toPx(state.cols, i));
  ctx.restore();
}

function drawCells() {
  const res = state.fresh ? state.result : null;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cs = cellCornersOf(r, c);
      if (!cs.every(finite)) continue;
      const status = cellStatus(res, r, c);
      ctx.beginPath();
      cs.forEach((p, k) => {
        const [px, py] = toPx(p.x, p.y);
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = COLORS[status];
      ctx.fill();
      ctx.strokeStyle = COLORS.edge;
      ctx.lineWidth = status === 'failFirst' ? 2.5 : 1.2;
      ctx.stroke();
    }
  }
  ctx.lineWidth = 1;

  // 首项失败角点证据
  if (res && res.stage === 'geometry' && res.firstFailure) {
    const f = res.firstFailure;
    const p = cellCornersOf(f.cell.r, f.cell.c)[f.corner];
    if (finite(p)) {
      const [px, py] = toPx(p.x, p.y);
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.mapped;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = COLORS.mapped;
      ctx.font = '12px system-ui';
      ctx.fillText(`首项失败 J=${f.jacobian}`, px + 14, py - 10);
    }
  }
}

function drawKnots() {
  ctx.font = '10px system-ui';
  for (let i = 0; i <= state.rows; i++) {
    for (let j = 0; j <= state.cols; j++) {
      const k = state.knots[i][j];
      if (!finite(k)) continue;
      const [px, py] = toPx(k.x, k.y);
      ctx.beginPath();
      ctx.rect(px - 5, py - 5, 10, 10);
      ctx.fillStyle = COLORS.knotFill;
      ctx.fill();
      ctx.strokeStyle = COLORS.knot;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#374151';
      ctx.fillText(`(${k.x},${k.y})`, px + 8, py + 14);
    }
  }
}

function drawMarkers() {
  const res = state.fresh ? state.result : null;
  const mapped = res && res.ok && res.markers ? res.markers : null;
  ctx.font = '11px system-ui';
  state.markers.forEach((m, idx) => {
    if (!Number.isFinite(m.u) || !Number.isFinite(m.v)) return;
    const [px, py] = toPx(m.u, m.v);
    ctx.beginPath();
    ctx.moveTo(px, py - 6);
    ctx.lineTo(px + 6, py);
    ctx.lineTo(px, py + 6);
    ctx.lineTo(px - 6, py);
    ctx.closePath();
    ctx.strokeStyle = COLORS.marker;
    ctx.stroke();
    ctx.fillStyle = COLORS.marker;
    ctx.fillText(`M${idx + 1}`, px + 9, py - 7);
    const mp = mapped && mapped[idx];
    if (mp) {
      const [qx, qy] = toPx(mp.x, mp.y);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = COLORS.mapped;
      line(px, py, qx, qy);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(qx, qy, 5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.mapped;
      ctx.fill();
      ctx.fillText(`M${idx + 1}'`, qx + 9, qy + 14);
    }
  });
}

/* ---------------- 复核针位（反向追溯） ---------------- */

function drawProbes() {
  const okTrace = state.traceFresh && state.trace && state.trace.ok;
  const failTrace = state.traceFresh && state.trace && !state.trace.ok && state.trace.stage === 'trace';
  const traces = okTrace ? state.trace.traces : null;
  const failIndex = failTrace && state.trace.evidence ? state.trace.evidence.index : -1;
  const failKind = failTrace ? state.trace.evidence.status : null;
  ctx.font = '11px system-ui';
  state.probes.forEach((p, idx) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const [px, py] = toPx(p.x, p.y);
    // 成功：绿色三角；失败：红色空心三角，首个不可追溯针位高亮
    const isFail = idx === failIndex;
    ctx.save();
    if (isFail) {
      ctx.beginPath();
      ctx.moveTo(px, py - 7);
      ctx.lineTo(px + 7, py);
      ctx.lineTo(px, py + 7);
      ctx.lineTo(px - 7, py);
      ctx.closePath();
      ctx.fillStyle = 'rgba(220,60,60,0.25)';
      ctx.fill();
      ctx.strokeStyle = COLORS.mapped;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = COLORS.mapped;
      ctx.fillText(`P${idx + 1} ${failKind === 'outside' ? '（网外）' : '（歧义）'}`, px + 10, py - 8);
    } else {
      ctx.beginPath();
      ctx.moveTo(px, py - 6);
      ctx.lineTo(px + 6, py);
      ctx.lineTo(px, py + 6);
      ctx.lineTo(px - 6, py);
      ctx.closePath();
      const hit = traces && traces[idx];
      ctx.fillStyle = hit ? 'rgba(40,160,90,0.25)' : 'rgba(107,114,128,0.12)';
      ctx.fill();
      ctx.strokeStyle = hit ? '#1e7e46' : COLORS.marker;
      ctx.stroke();
      ctx.fillStyle = hit ? '#1e7e46' : COLORS.marker;
      ctx.fillText(`P${idx + 1}`, px + 9, py - 7);
    }
    ctx.restore();

    // 追溯成功：把针位（织补坐标）连回它唯一对应的原网坐标
    const hit = traces && traces[idx];
    if (hit) {
      const [qx, qy] = toPx(hit.u, hit.v);
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = '#1e7e46';
      line(px, py, qx, qy);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(qx, qy, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#1e7e46';
      ctx.fill();
      ctx.fillStyle = '#1e7e46';
      ctx.fillText(`P${idx + 1}→(${fmt(hit.u)},${fmt(hit.v)})`, qx + 8, qy + 16);
    }
  });
}

/* ---------------- 网结拖动 ---------------- */

let dragKnot = null;

function eventGrid(e) {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas.height / rect.height);
  return toGrid(px, py);
}

canvas.addEventListener('pointerdown', (e) => {
  const [gx, gy] = eventGrid(e);
  const tol = 14 / view.scale;
  let best = null;
  let bestD = tol;
  for (let i = 0; i <= state.rows; i++) {
    for (let j = 0; j <= state.cols; j++) {
      const k = state.knots[i][j];
      if (!finite(k)) continue;
      const d = Math.hypot(k.x - gx, k.y - gy);
      if (d <= bestD) { bestD = d; best = { i, j }; }
    }
  }
  if (best) {
    dragKnot = best;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragKnot) return;
  const [gx, gy] = eventGrid(e);
  state.knots[dragKnot.i][dragKnot.j] = { x: Math.round(gx), y: Math.round(gy) };
  syncKnotInputs(dragKnot.i, dragKnot.j);
  invalidate();
});

const endDrag = () => { dragKnot = null; canvas.style.cursor = ''; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

/* ---------------- 初始化 ---------------- */

buildKnotFields();
buildMarkerFields();
buildProbeFields();
renderResults();
renderTraceResults();
updateTraceGate();
draw();
