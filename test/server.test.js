import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

const ident = (rows, cols) =>
  Array.from({ length: rows + 1 }, (_, i) =>
    Array.from({ length: cols + 1 }, (_, j) => ({ x: j, y: i })));

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('健康检查与校核 API', async () => {
  await withServer(async (base) => {
    const h = await fetch(`${base}/healthz`);
    assert.equal(h.status, 200);
    const hb = await h.json();
    assert.equal(hb.status, 'ok');
    assert.ok(typeof hb.uptimeSeconds === 'number');

    const res = await fetch(`${base}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: 2, cols: 2, knots: ident(2, 2),
        markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.minJacobian.value, 1);
    assert.equal(body.markers.length, 3);
  });
});

test('API 错误处理：方法不允许与非法 JSON', async () => {
  await withServer(async (base) => {
    const get = await fetch(`${base}/api/verify`);
    assert.equal(get.status, 405);

    const bad = await fetch(`${base}/api/verify`, { method: 'POST', body: 'not json' });
    assert.equal(bad.status, 400);

    const empty = await fetch(`${base}/api/verify`, { method: 'POST', body: '{}' });
    assert.equal(empty.status, 200);
    const eb = await empty.json();
    assert.equal(eb.ok, false);
    assert.equal(eb.stage, 'validation');
  });
});

test('反向追溯 API：唯一追溯、公共边合并与错误处理', async () => {
  await withServer(async (base) => {
    const scale2 = ident(2, 2).map((row) => row.map((k) => ({ x: 2 * k.x, y: 2 * k.y })));
    const res = await fetch(`${base}/api/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: 2, cols: 2, knots: scale2,
        needles: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.stage, 'trace');
    assert.equal(body.traces.length, 2);
    assert.deepEqual([body.traces[0].u, body.traces[0].v], [0.5, 0.5]);
    // 中心网结：四单元公共角点合并为一项
    assert.deepEqual([body.traces[1].u, body.traces[1].v], [1, 1]);
    assert.equal(body.traces[1].witnesses.length, 4);

    // 方法不允许与非法 JSON
    const get = await fetch(`${base}/api/trace`);
    assert.equal(get.status, 405);
    const bad = await fetch(`${base}/api/trace`, { method: 'POST', body: 'not json' });
    assert.equal(bad.status, 400);

    // 针位缺失：输入校验失败
    const noNeedles = await fetch(`${base}/api/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: 2, cols: 2, knots: ident(2, 2) }),
    });
    const nb = await noNeedles.json();
    assert.equal(nb.ok, false);
    assert.equal(nb.stage, 'validation');
    assert.equal(nb.errors[0].kind, 'needles-count');

    // 网格未通过校核：拒绝追溯
    const folded = ident(2, 2);
    folded[1][1] = { x: -1, y: -1 };
    const refuse = await fetch(`${base}/api/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: 2, cols: 2, knots: folded, needles: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }),
    });
    const rb = await refuse.json();
    assert.equal(rb.ok, false);
    assert.equal(rb.stage, 'geometry');
    assert.equal(rb.traces, null);
  });
});

test('静态文件：不存在的路径返回 404，路径穿越被拒绝', async () => {
  await withServer(async (base) => {
    const missing = await fetch(`${base}/no-such-file.js`);
    assert.equal(missing.status, 404);
    const traversal = await fetch(`${base}/..%2F..%2Fpackage.json`);
    assert.ok([403, 404].includes(traversal.status));
  });
});
