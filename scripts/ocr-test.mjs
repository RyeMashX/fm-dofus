// Teste la lecture OCR sur les captures de ocr-samples/ : node scripts/ocr-test.mjs [fichier.png]
import { readFileSync, readdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createWorker } from 'tesseract.js';
import { readScreen, interpretEntry, preprocess } from '../src/ocr.js';
import { PNG as PNGW } from 'pngjs';
import { STAT_BY_KEY } from '../src/stats.js';

const files = process.argv[2] ? [process.argv[2]] : readdirSync('ocr-samples').filter(f => f.endsWith('.png')).map(f => 'ocr-samples/' + f);
const worker = await createWorker('fra', 1, { langPath: '/usr/share/tesseract-ocr/5/tessdata', gzip: false, cachePath: '/tmp/tess-cache' });

for (const file of files) {
  const png = PNG.sync.read(readFileSync(file));
  const frame = { width: png.width, height: png.height, data: png.data };
  const ocr = async (rect, psm, scale = 3, threshold = null) => {
    await worker.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1' });
    let input, map = b => b;
    if (psm === 11) input = readFileSync(file);
    else {
      const pp = preprocess(frame, rect, scale, threshold);
      const out = new PNGW({ width: pp.width, height: pp.height }); out.data = Buffer.from(pp.data); input = PNGW.sync.write(out);
      map = b => ({ x0: b.x0 / pp.scale + pp.x0, y0: b.y0 / pp.scale + pp.y0, x1: b.x1 / pp.scale + pp.x0, y1: b.y1 / pp.scale + pp.y0 });
    }
    const { data } = await worker.recognize(input, psm === 11 ? {} : {}, { blocks: true });
    return data.blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines)).map(l => ({ text: l.text.trim(), bbox: map(l.bbox) }));
  };
  let t0 = Date.now();
  const r = await readScreen(frame, ocr);
  if (process.argv[3] === 'again') { const t1 = Date.now(); const r2 = await readScreen(frame, ocr, r.hints); console.log(`relecture avec repères : ${Date.now() - t1} ms, reliquat=${r2.reliquat}, ${r2.table.length} lignes, ${r2.history.length} poses`); }
  console.log(`\n=== ${file} (${Date.now() - t0} ms) reliquat=${r.reliquat} ${r.error || ''}`);
  for (const l of r.tableUnparsed || []) console.log('  ?? ' + l);
  for (const row of r.table) console.log(`  ${String(row.min).padStart(4)} ${String(row.max).padStart(4)}  ${String(row.value).padStart(4)}${row.pct ? '%' : ' '} ${row.label.padEnd(24)} → ${row.stat ? STAT_BY_KEY[row.stat].label : '??'}`);
  r.history.forEach((e, i) => console.log(`  pose ${i + 1} (icône ${r.historyRaw[i].iconScore.toFixed(0)}) : ` + e.map(it => it.reliquat ? (it.reliquat > 0 ? '+reliquat' : '−reliquat') : `${it.delta > 0 ? '+' : ''}${it.delta} ${STAT_BY_KEY[it.stat].label}`).join(', ')));
  if (r.history.length) console.log('  dernière pose →', JSON.stringify(interpretEntry(r.history.at(-1), null)));
}
await worker.terminate();
