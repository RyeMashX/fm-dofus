import { createWorker } from 'tesseract.js';
const t0=Date.now();
const worker = await createWorker('fra', 1, { langPath: '/usr/share/tesseract-ocr/5/tessdata', gzip: false, cachePath: '/tmp/tess-cache' });
await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
const { data } = await worker.recognize('ocr-samples/ceinture-historique.png', {}, { blocks: true });
console.log('temps', Date.now()-t0, 'ms');
const lines = data.blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines));
for (const l of lines) console.log(`[${l.bbox.x0},${l.bbox.y0}-${l.bbox.x1},${l.bbox.y1}] ${l.text.trim()}`);
await worker.terminate();
