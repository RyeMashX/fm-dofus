import * as S from '../src/search.js';
const L=(stat,value,min,max)=>({stat,value,min,max});
const mk=(pm)=>({level:200,lines:[L('vita',346,301,350),L('fo',51,41,60),L('ine',45,41,60),L('sa',36,31,40),L('cri',5,4,6),L('pm',pm,1,1),L('po',1,1,1),
 L('do_neutre',14,11,15),L('do_terre',14,11,15),L('do_feu',14,11,15),L('prospe',15,11,15),L('re_per_eau',7,7,10),L('ret_pme',5,4,6),L('fuite',-5,-5,-5)]});
const target={vita:335,fo:58,ine:58,sa:1,cri:6,pm:1,po:1,do_neutre:15,do_terre:15,do_feu:15,prospe:2,re_per_eau:10,ret_pme:2};
for (const rel of [50, 20, 5, 0]) {
  const r=S.nextBestMoves({item:mk(0),reliquat:rel},target,{samples:300,top:4,seed:3});
  console.log(`reliquat ${rel} :`, r.moves.map(m=>`${m.rune.name} ${m.score.toFixed(1)}`).join(' | '), '| PM :', r.all.find(m=>m.rune.stat==='pm')?.score.toFixed(1));
}
