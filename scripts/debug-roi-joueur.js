import * as FM from '../src/engine.js';
import * as S from '../src/search.js';
const L=(stat,value,min,max)=>({stat,value,min,max});
const item={level:200,lines:[L('vita',346,301,350),L('fo',51,41,60),L('ine',45,41,60),L('sa',36,31,40),L('cri',5,4,6),L('pm',1,1,1),L('po',1,1,1),
 L('do_neutre',14,11,15),L('do_terre',14,11,15),L('do_feu',14,11,15),L('prospe',15,11,15),L('re_per_eau',7,7,10),L('ret_pme',5,4,6),L('fuite',-5,-5,-5)]};
const target={vita:335,fo:58,ine:58,sa:1,cri:6,pm:1,po:1,do_neutre:15,do_terre:15,do_feu:15,prospe:2,re_per_eau:10,ret_pme:2};
const st={item,reliquat:0};
console.log('h0 =', S.estimateRemaining(st,target).toFixed(2));
// détail de h par ligne
for (const m of S.missing(item,target)) {
  const one={...target}; for(const k of Object.keys(one)) if(k!==m.stat) delete one[k];
  const t2={}; t2[m.stat]=target[m.stat];
  console.log('  ', m.stat, 'manque', m.missing, 'h_ligne ≈', S.estimateRemaining(st,t2).toFixed(2));
}
const r=S.nextBestMoves(st,target,{samples:300,top:20,seed:7});
for(const m of r.all) console.log(`${m.rune.name.padEnd(14)} SC ${FM.fmt(m.odds.sc)} SN ${FM.fmt(m.odds.sn)} EC ${FM.fmt(m.odds.ec)} ${m.odds.regime.padEnd(6)} | score ${m.score.toFixed(2)} | hurt ${(m.pHurtTarget*100).toFixed(0)}% loss ${m.expLossOnTarget.toFixed(1)}`);
