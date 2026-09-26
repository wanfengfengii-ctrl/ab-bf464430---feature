import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyGrid, traceBack, makeIdentityKnots } from '../src/shared/bilinear.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 构建：
 * 1. 自检——恒等网格必须通过校核且 J_min = 1；闭式反向追溯必须在恒等网格上
 *    精确还原整数针位，并在重叠歧义/网外样例上拒绝，防止把损坏的数学模块打进产物；
 * 2. 组装 dist/public（页面 + 共享数学模块），并生成带 SHA-256 的构建清单。
 */
export async function build() {
  const probe = verifyGrid({
    rows: 2,
    cols: 2,
    knots: makeIdentityKnots(2, 2),
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 2, v: 2 }],
  });
  if (!probe.ok || probe.minJacobian.value !== 1) {
    throw new Error('构建自检失败：恒等网格校核未通过');
  }

  // 反向追溯自检（与运行时共用同一 traceBack）
  const traceOk = traceBack({
    rows: 2, cols: 2, knots: makeIdentityKnots(2, 2),
    probes: [{ x: 0, y: 0 }, { x: 2, y: 1 }],
  });
  if (!traceOk.ok || traceOk.traces.length !== 2 ||
      traceOk.traces[0].u !== 0 || traceOk.traces[0].v !== 0 ||
      traceOk.traces[1].u !== 2 || traceOk.traces[1].v !== 1) {
    throw new Error('构建自检失败：恒等网格反向追溯未精确还原针位');
  }
  const traceOut = traceBack({
    rows: 2, cols: 2, knots: makeIdentityKnots(2, 2),
    probes: [{ x: 0, y: 0 }, { x: 9, y: 9 }],
  });
  if (traceOut.ok || traceOut.evidence.status !== 'outside') {
    throw new Error('构建自检失败：网外针位应判定为 outside');
  }

  const srcPublic = path.join(ROOT, 'src', 'public');
  const distPublic = path.join(ROOT, 'dist', 'public');
  await rm(path.join(ROOT, 'dist'), { recursive: true, force: true });
  await mkdir(path.join(distPublic, 'shared'), { recursive: true });

  const files = [
    ['index.html', path.join(srcPublic, 'index.html'), path.join(distPublic, 'index.html')],
    ['app.js', path.join(srcPublic, 'app.js'), path.join(distPublic, 'app.js')],
    ['styles.css', path.join(srcPublic, 'styles.css'), path.join(distPublic, 'styles.css')],
    ['shared/bilinear.js', path.join(ROOT, 'src', 'shared', 'bilinear.js'), path.join(distPublic, 'shared', 'bilinear.js')],
  ];

  const manifest = { builtAt: new Date().toISOString(), files: {} };
  for (const [name, from, to] of files) {
    await copyFile(from, to);
    const buf = await readFile(to);
    manifest.files[name] = {
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    };
  }
  await writeFile(path.join(ROOT, 'dist', 'build-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[build] dist/ 已生成（${files.length} 个文件），构建自检通过`);
  return manifest;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  build().catch((err) => {
    console.error('[build] 失败:', err.message);
    process.exit(1);
  });
}
