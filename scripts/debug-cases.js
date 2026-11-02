import * as FM from '../src/engine.js';
import * as S from '../src/search.js';
const L=(stat,value,min,max)=>({stat,value,min,max});
const base=(ine,po,doN)=>({level:200,lines:[L('vita',335,301,350),L('fo',59,41,60),L('ine',ine,41,60),L('sa',23,31,40),L('cri',6,4,6),L('pm',1,1,1),L('po',po,1,1),
 L('do_neutre',doN,11,15),L('do_terre',15,11,15),L('do_feu',15,11,15),L('prospe',8,11,15),L('re_per_eau',10,7,10),L('ret_pme',2,4,6),L('fuite',-5,-5,-5)]});
const target={vita:335,fo:58,ine:58,cri:6,pm:1,po:1,do_neutre:15,do_terre:15,do_feu:15,re_per_eau:10};
function show(label,state){
  const T=S.buildTables(state,target);
  console.log(`\n== ${label} : h0=${S.estimateRemaining(state,target,T).toFixed(2)}`);
  for (const [k,tb] of Object.entries(T.tables)) { const v=state.item.lines.find(l=>l.stat===k).value; if (v<tb.t) console.log(`   ${k} ${v}→${tb.t} E=${tb.Eof(v).toFixed(2)}`); else console.log(`   ${k} ok ; si −1 : E=${tb.Eof(v-1).toFixed(2)}`); }
  const r=S.nextBestMoves(state,target,{samples:300,top:8,seed:5});
  for(const m of r.moves) console.log(`   ${m.rune.name.padEnd(12)} SC ${FM.fmt(m.odds.sc)} SN ${FM.fmt(m.odds.sn)} EC ${FM.fmt(m.odds.ec)} | score ${m.score.toFixed(1)} | abîme ${(m.pHurtTarget*100).toFixed(0)}% perte ${m.expLossOnTarget.toFixed(1)}`);
}
show('cas 1 : ine 51, reliquat 2,2', {item:base(51,1,15),reliquat:2.2});
show('cas 2 : ine 61 (over), PO tombée, reliquat 38,2', {item:base(61,0,14),reliquat:38.2});
// cas 1 bis : mêmes jets, cible vita relâchée à 320 (les petites pertes de vita ne comptent plus)
{ const t2={...target, vita:320}; const st={item:base(51,1,15),reliquat:2.2};
  const r=S.nextBestMoves(st,t2,{samples:300,top:4,seed:5});
  console.log('\n== cas 1 bis : cible vita 320');
  for(const m of r.moves) console.log(`   ${m.rune.name.padEnd(12)} SC ${FM.fmt(m.odds.sc)} SN ${FM.fmt(m.odds.sn)} EC ${FM.fmt(m.odds.ec)} | score ${m.score.toFixed(1)} | abîme ${(m.pHurtTarget*100).toFixed(0)}%`); }
