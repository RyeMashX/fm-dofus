// Construit dist/fm-dofus.html : la page entière en un seul fichier (CSS + JS inlinés), pour un artifact ou un partage.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const js = await build({ entryPoints: ['src/ui.js'], bundle: true, format: 'iife', write: false, minify: false, target: 'es2020' });
const css = readFileSync('style.css', 'utf8');
let html = readFileSync('index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="src/ui.js"></script>', `<script>\n${js.outputFiles[0].text}\n</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/fm-dofus.html', html);
console.log('dist/fm-dofus.html', html.length, 'octets');
