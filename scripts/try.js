import * as FM from '../src/engine.js';
import * as S from '../src/search.js';
const L=(stat,value,min,max)=>({stat,value,min:min??null,max:max??null});
// Ceinture du Nocturlabe-like, jet moyen ; cible : vita 350, fo 70, cha 70, do eau 15, + exo PA
const belt={level:200,lines:[L('vita',325,301,350),L('fo',60,51,70),L('cha',60,51,70),L('sa',35,31,40),L('cri',3,3,4),
 L('po',1,1,1),L('do_neutre',12,11,15),L('do_terre',12,11,15),L('do_eau',12,11,15),L('prospe',13,11,15),L('re_per_terre',6,5,7),L('re_cri',25,21,30)]};
function run(target,state,label){
  console.time(label);
  const r=S.nextBestMoves(state,target,{samples:300,top:3});
  console.timeEnd(label);
  console.log(label,'h0=',r.h0?.toFixed(1));
  for(const m of r.moves) console.log(`  ${m.rune.name.padEnd(10)} SC ${FM.fmt(m.odds.sc)} SN ${FM.fmt(m.odds.sn)} EC ${FM.fmt(m.odds.ec)} | score ${m.score.toFixed(1)} net ${m.netGain.toFixed(2)} | P(abîme cible) ${(m.pHurtTarget*100).toFixed(0)}%`);
}
run({vita:350,fo:70,cha:70,do_eau:15},{item:belt,reliquat:0},'simple');
run({vita:350,fo:70,cha:70,do_eau:15,pa:1},{item:belt,reliquat:0},'avec PA');
const empty={level:200,lines:belt.lines.map(l=>({...l,value:0}))};
run({vita:350,fo:70,cha:70,do_eau:15,pa:1},{item:empty,reliquat:0},'objet vide + PA');
