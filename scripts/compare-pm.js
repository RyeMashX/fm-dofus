// Compare deux stratégies complètes par simulation jusqu'à la cible : PM tôt vs PM en dernier.
import * as FM from '../src/engine.js';
import * as S from '../src/search.js';
import { RUNES } from '../src/stats.js';
const L=(stat,value,min,max)=>({stat,value,min,max});
const mk=()=>({level:200,lines:[L('vita',346,301,350),L('fo',51,41,60),L('ine',45,41,60),L('sa',36,31,40),L('cri',5,4,6),L('pm',0,1,1),L('po',1,1,1),
 L('do_neutre',14,11,15),L('do_terre',14,11,15),L('do_feu',14,11,15),L('prospe',15,11,15),L('re_per_eau',7,7,10),L('ret_pme',5,4,6),L('fuite',-5,-5,-5)]});
const target={vita:335,fo:58,ine:58,sa:1,cri:6,pm:1,po:1,do_neutre:15,do_terre:15,do_feu:15,prospe:2,re_per_eau:10,ret_pme:2};
const val=(it,s)=>it.lines.find(l=>l.stat===s)?.value??0;

// politique gloutonne sur les lignes autres que PM : rune minimisant 1 + pass·E[v+b] + (1−pass)·E[v] (tables recalculées à chaque pose)
function greedy(state, excludePm) {
  const tgt = {...target}; if (excludePm) delete tgt.pm;
  const T = S.buildTables(state, tgt);
  let best=null;
  for (const {stat} of S.missing(state.item, tgt)) {
    const tb=T.tables[stat]; const v=val(state.item,stat);
    for (const r of RUNES.filter(r=>r.stat===stat)) {
      const o=FM.odds(state.item,r); if(o.blocked) continue;
      const pass=(o.sc+o.sn)/100;
      const c=(1-o.sc/100)*Math.max(0,r.weight-state.reliquat)*T.share/T.wpp;
      const v2=1+c+pass*tb.Eof(v+r.bonus)+(1-pass)*tb.Eof(v);
      if(!best||v2<best.val) best={rune:r,val:v2};
    }
  }
  return best?.rune ?? null;
}
const PM = RUNES.find(r=>r.stat==='pm');
function run(strategy, rng, cap=200) {
  let s={item:mk(),reliquat:0}, poses=0;
  while (poses<cap && !S.targetReached(s.item,target)) {
    let rune;
    const pmDown = val(s.item,'pm')<1;
    if (strategy==='early' && pmDown && s.reliquat < 10) rune = PM;
    else if (strategy==='late' && pmDown && S.missing(s.item,target).length===1) rune = PM;
    else rune = greedy(s, true) ?? (pmDown ? PM : null);
    if (!rune) break;
    const r=FM.applyMove(s,rune,rng); if(!r.outcome) { rune = PM; const r2=FM.applyMove(s,rune,rng); if(!r2.outcome) break; s={item:r2.item,reliquat:r2.reliquat}; poses++; continue; }
    s={item:r.item,reliquat:r.reliquat}; poses++;
  }
  return {poses, done:S.targetReached(s.item,target)};
}
for (const strat of ['early','late']) {
  const N=150; let sum=0, done=0; const rng=S.rngFrom(23);
  for(let k=0;k<N;k++){ const r=run(strat,rng); sum+=r.poses; done+=r.done?1:0; }
  console.log(`${strat.padEnd(6)} poses moyennes ${(sum/N).toFixed(1)}  cible atteinte ${done}/${N}`);
}
