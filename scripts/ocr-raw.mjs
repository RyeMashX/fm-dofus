import { readFileSync } from 'node:fs';
import { createWorker } from 'tesseract.js';
const worker = await createWorker('fra', 1, { langPath: '/usr/share/tesseract-ocr/5/tessdata', gzip: false, cachePath: '/tmp/tess-cache' });
await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
for (const [file, rect] of [['ocr-samples/ceinture-vide.png', {left:400,top:260,width:1000,height:900}], ['ocr-samples/ceinture-historique.png', {left:0,top:245,width:360,height:860}]]) {
  const { data } = await worker.recognize(readFileSync(file), { rectangle: rect }, { blocks: true });
  console.log('==', file);
  for (const l of data.blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines))) console.log(`  [y ${l.bbox.y0}-${l.bbox.y1} x ${l.bbox.x0}] ${l.text.trim()}`);
}
await worker.terminate();
