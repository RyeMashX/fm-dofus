import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createWorker } from 'tesseract.js';
import { preprocess } from '/home/claude/fm-dofus/src/ocr.js';
const png = PNG.sync.read(readFileSync('/home/claude/fm-dofus/ocr-samples/ceinture-historique.png')); const frame = { width: png.width, height: png.height, data: png.data };
const worker = await createWorker('fra', 1, { langPath: '/usr/share/tesseract-ocr/5/tessdata', gzip: false, cachePath: '/tmp/tess-cache' });
const rect = { x: 52, y: 245, w: 314, h: 860 };
const expected = ['-3 Dommages Eau','-1 Chance','-1 Résistance Critiques','-1 Sagesse','-3 Vitalité','10 Chance','-1 Sagesse','-3 Prospection'];
for (const [scale, thr, gray] of [[2,105,false],[3,105,false],[3,130,false],[3,90,false],[4,105,false],[3,null,true]]) {
  let pp;
  if (gray) { // niveaux de gris inversés sans binarisation
    pp = preprocess(frame, rect, scale, -1); // seuil -1 → tout noir ; on refait en gris :
    const w=pp.width,h=pp.height; const out=new Uint8ClampedArray(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.min(rect.w-1,(x/scale)|0),sy=Math.min(rect.h-1,(y/scale)|0);const i=((rect.y+sy)*frame.width+rect.x+sx)*4;const l=255-(frame.data[i]*0.3+frame.data[i+1]*0.5+frame.data[i+2]*0.2);const o=(y*w+x)*4;out[o]=out[o+1]=out[o+2]=l;out[o+3]=255;}
    pp.data=out;
  } else pp = preprocess(frame, rect, scale, thr);
  const img = new PNG({ width: pp.width, height: pp.height }); img.data = Buffer.from(pp.data);
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(PNG.sync.write(img));
  const lines = data.text.split('\n').map(l => l.replace(/[^\w\s%+\-àâäéèêëîïôöùûüç]/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean);
  const errs = expected.filter(e => !lines.some(l => l.endsWith(e)));
  console.log(`scale ${scale} thr ${thr} gray ${gray}: manquants = ${errs.join(' | ') || 'aucun'}`);
}
await worker.terminate();
