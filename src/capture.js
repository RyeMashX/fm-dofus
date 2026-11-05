// Capture de la fenêtre du jeu (API de partage d'écran du navigateur) et OCR dans le navigateur (tesseract.js).
import { preprocess, readScreen } from './ocr.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let stream = null, video = null, worker = null, workerPromise = null, hints = null;

export const isSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
export const isCapturing = () => !!(stream && stream.active) || !!window.__fmTestFrame;

// Demande à l'utilisateur de choisir la fenêtre du jeu. Le flux reste ouvert jusqu'à stopCapture ou fermeture.
export async function startCapture(onEnd) {
  stopCapture(); hints = null;
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window', frameRate: 5 }, audio: false, preferCurrentTab: false, selfBrowserSurface: 'exclude' });
  video = document.createElement('video');
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  stream.getVideoTracks()[0].addEventListener('ended', () => { stopCapture(); onEnd?.(); });
  return { width: video.videoWidth, height: video.videoHeight };
}
export function stopCapture() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; video = null;
}

// Image courante du flux, en ImageData.
// Dernière image lue, pour l'exporter quand une lecture est fausse (diagnostic de l'OCR).
let lastCanvas = null;
export function downloadLastFrame(name = 'fm-dofus-capture.png') {
  if (!lastCanvas) return false;
  lastCanvas.toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }, 'image/png');
  return true;
}
export function grabFrame() {
  if (window.__fmTestFrame) { // image de test injectée (tests automatisés)
    const img = window.__fmTestFrame; const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    return { canvas: c, frame: ctx.getImageData(0, 0, c.width, c.height) };
  }
  if (!isCapturing() || !video.videoWidth) throw new Error('Pas de capture en cours.');
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(video, 0, 0);
  lastCanvas = c;
  return { canvas: c, frame: ctx.getImageData(0, 0, c.width, c.height) };
}

// Chargement paresseux de tesseract.js et du modèle français (une dizaine de Mo la première fois, puis en cache).
async function getWorker(onProgress) {
  if (worker) return worker;
  if (!workerPromise) workerPromise = (async () => {
    if (!window.Tesseract) await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = TESSERACT_URL; s.onload = ok; s.onerror = () => ko(new Error('tesseract.js introuvable (réseau ?)')); document.head.appendChild(s); });
    const w = await window.Tesseract.createWorker('fra', 1, { logger: m => onProgress?.(m) });
    worker = w; return w;
  })();
  return workerPromise;
}

function toCanvas(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

// Lit l'écran du jeu : { reliquat, table, history, … } (voir ocr.js).
export async function readGame(onProgress) {
  const { canvas, frame } = grabFrame();
  const w = await getWorker(onProgress);
  const ocr = async (rect, psm, scale = 3, threshold = null) => {
    await w.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1' });
    let input, map = b => b;
    if (psm === 11) input = canvas;
    else {
      const pp = preprocess(frame, rect, scale, threshold);
      input = toCanvas(pp);
      map = b => ({ x0: b.x0 / pp.scale + pp.x0, y0: b.y0 / pp.scale + pp.y0, x1: b.x1 / pp.scale + pp.x0, y1: b.y1 / pp.scale + pp.y0 });
    }
    const { data } = await w.recognize(input, {}, { blocks: true });
    return (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines)).map(l => ({ text: l.text.trim(), bbox: map(l.bbox) }));
  };
  const r = await readScreen(frame, ocr, hints);
  if (!r.error && r.hints) hints = r.hints;
  return r;
}
