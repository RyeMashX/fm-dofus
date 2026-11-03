// Solveur en arrière-plan (Web Worker, module) : les simulations ne bloquent plus l'interface.
import * as Search from './search.js';
import * as FM from './engine.js';

self.onmessage = e => {
  const { id, fn, args, P } = e.data;
  try {
    if (P) Object.assign(FM.P, P);
    self.postMessage({ id, result: Search[fn](...args) });
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
