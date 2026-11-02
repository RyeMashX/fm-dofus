import * as FM from '../src/engine.js';
import * as S from '../src/search.js';
import { RUNE_BY_ID as R } from '../src/stats.js';
const L=(stat,value,min,max)=>({stat,value,min,max});
const mk=(po,fill)=>({level:200,lines:[L('vita',346,301,350),L('fo',51+fill,41,60),L('ine',45+fill,41,60),L('sa',36,31,40),L('cri',5,4,6),L('pm',1,1,1),L('po',po,1,1),
 L('do_neutre',14,11,15),L('do_terre',14,11,15),L('do_feu',14,11,15),L('prospe',15,11,15),L('re_per_eau',7,7,10),L('ret_pme',5,4,6),L('fuite',-5,-5,-5)]});
const target={vita:335,fo:58,ine:58,sa:1,cri:6,pm:1,po:1,do_neutre:15,do_terre:15,do_feu:15,prospe:2,re_per_eau:10,ret_pme:2};
const show=o=>`SC ${FM.fmt(o.sc)} SN ${FM.fmt(o.sn)} EC ${FM.fmt(o.ec)} (Q=${o.quality.toFixed(3)}, D=${Math.round(o.difficulty)})`;
console.log('PO à reposer maintenant (objet tel quel)   :', show(FM.odds(mk(0,0),R['po:0'])));
console.log('PO à reposer après avoir rempli fo/ine +7  :', show(FM.odds(mk(0,7),R['po:0'])));
console.log('Ra Fo sans PO sur l\'objet                  :', show(FM.odds(mk(0,0),R['fo:2'])));
console.log('Ra Fo avec PO sur l\'objet                  :', show(FM.odds(mk(1,0),R['fo:2'])));
// comparaison des stratégies par simulation : A = PO maintenant, B = remplir d'abord (politique), horizon long
const r=S.nextBestMoves({item:mk(0,0),reliquat:50},target,{samples:400,horizon:12,top:5,seed:3});
for(const m of r.moves) console.log(`${m.rune.name.padEnd(12)} score ${m.score.toFixed(1)} abîme ${(m.pHurtTarget*100).toFixed(0)}%`);
