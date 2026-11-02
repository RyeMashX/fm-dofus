import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createWorker } from 'tesseract.js';
import { preprocess } from '../src/ocr.js';
const file = process.argv[2]; const mode = process.argv[3] || 'table';
const png = PNG.sync.read(readFileSync(file)); const frame = { width: png.width, height: png.height, data: png.data };
const worker = await createWorker('fra', 1, { langPath: '/usr/share/tesseract-ocr/5/tessdata', gzip: false, cachePath: '/tmp/tess-cache' });
await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
const rect = mode === 'table' ? { x: 0, y: 260, w: 700, h: frame.height - 260 } : { x: 0, y: 245, w: 366, h: 860 };
for (const thr of (mode === 'table' ? [90, 105, 130] : [105])) {
  const pp = preprocess(frame, rect, 2, thr);
  const out = new PNG({ width: pp.width, height: pp.height }); out.data = Buffer.from(pp.data);
  if (mode === 'table') require_write(`/tmp/pp-${thr}.png`, PNG.sync.write(out));
  const { data } = await worker.recognize(PNG.sync.write(out), {}, { blocks: true });
  console.log(`-- seuil ${thr}`);
  for (const l of data.blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines))) {
    const y0 = l.bbox.y0 / 2 + pp.y0, y1 = l.bbox.y1 / 2 + pp.y0, x0 = l.bbox.x0 / 2 + pp.x0;
    let extra = '';
    if (mode !== 'table') {
      // fraction de pixels « non fond » dans la colonne des icônes de rune (x 8..44), hauteur stricte
      let n = 0, diff = 0; const h = y1 - y0;
      for (let y = Math.round(y0 + h * 0.15); y < y1 - h * 0.15; y++) for (let x = 8; x < 44; x++) { const i = (y * frame.width + x) * 4; const d = Math.abs(frame.data[i] - 58) + Math.abs(frame.data[i + 1] - 56) + Math.abs(frame.data[i + 2] - 85); n++; if (d > 60) diff++; }
      extra = ` icône=${(100 * diff / n).toFixed(0)}%`;
    }
    console.log(`  [y ${y0.toFixed(0)}-${y1.toFixed(0)} x ${x0.toFixed(0)}]${extra} ${l.text.trim()}`);
  }
}
function require_write(p, b) { import('node:fs').then(fs => fs.writeFileSync(p, b)); }
await worker.terminate();
