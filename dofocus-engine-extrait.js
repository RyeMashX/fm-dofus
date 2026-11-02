// Extrait du bundle https://dofocus.fr/assets/index-DiAXkpru.js (2026-11-02)
// Moteur de forgemagie du simulateur DoFocus : probabilités (oz) et pertes (gBe), pose complète (vBe).
// Noms minifiés conservés. Référence pour l'outil FM, à ne pas redistribuer tel quel.

const tz=170,nz=101,rz=.8,iBe=1,iz=.5,aBe=1/60,oBe=1/3,sBe=new Set([1,23]),lBe=new Set([1,23,19]),Sr=1e-9,
Ys=e=>Number.isFinite(e==null?void 0:e.min)&&Number.isFinite(e==null?void 0:e.max),
cd=e=>Number.isFinite(e==null?void 0:e.weight)&&e.weight>0,
yS=e=>Math.round(e*100)/100,
Dc=e=>[Math.min(e.min,e.max),Math.max(e.min,e.max)];

// Qualité de l'objet hors ligne t
function cBe(e,t){let n=0,r=0;return e.forEach((i,a)=>{if(a===t||!Ys(i)||!cd(i))return;const[,o]=Dc(i);o<0||(n+=i.weight*Math.min(Math.max(0,i.value),o),r+=i.weight*o)}),r>0?n/r:0}
// Difficulté
function uBe({position:e=0,over:t=!1,overWeight:n=0,ratio:r=0,quality:i=0,level:a=200,step:o=!0}){let l=5+12*Math.max(0,r-14)+60*i**12;return t?l+=65+4*Math.max(0,n):o&&e>=rz-Sr&&(l+=45),a<tz&&(l-=20*Math.max(0,1.1-i)),l}
// SC / SN / EC à partir de la difficulté
function dBe(e,t=!1){const n=Math.max(2,(100-e)/2);let r=t?Math.max(5,40-.375*(e-100)):e<=100?Math.min(50,100-n):Math.max(15,50-.375*(e-100));return r=Math.min(Math.max(r,0),100-n),{sc:n,sn:r,ec:100-n-r}}
// Régime exo (t = poids final de la ligne)
function fBe(e,t){if(lBe.has(e))return{sc:1,sn:0,ec:99,estimated:!1};let n=0;t<=2?n=57:t<=15?n=57-(t-2)*38/13:t<25&&(n=19-(t-15)*1.9);const r=Math.max(1,.077*n),i=.923*n;return{sc:r,sn:i,ec:100-r-i,estimated:!0}}
// Plafond d'une ligne : max(max_roll, floor(101/poids))
function az(e,t=e==null?void 0:e.weight){const n=Math.floor(nz/t+Sr);return Ys(e)?Math.max(Dc(e)[1],n):n}
// Charge over+exo de l'objet
function y$(e){return e.reduce((t,n)=>!cd(n)||!(n.value>0)?t:Ys(n)?t+Math.max(0,n.value-Dc(n)[1])*n.weight:t+n.value*n.weight,0)}
// Probabilités d'une pose
function oz(e,t){const n=e.lines,r=n.findIndex(k=>k.effectId===t.effectId),i=r>=0?n[r]:null,a=t.weight/t.value,o=i?i.value:0,l=az(i||{min:null,max:null},a);if(o+t.value>l)return{blocked:"line-cap",limit:l};const c=r>=0?n.map((k,w)=>w===r?{...k,value:o+t.value}:k):[...n,{effectId:t.effectId,value:t.value,min:null,max:null,weight:a}];if(y$(c)>nz+Sr)return{blocked:"item-cap",limit:l,load:yS(y$(n))};const d=t.value,f=cBe(n,r);if(!i||!Ys(i))return{...fBe(t.effectId,(o+d)*a),regime:"exo",quality:f,gain:d,limit:l};const[p,h]=Dc(i),v=o+d>h,y=h===p,x=o+d<0,g=y?1:(o+d-p)/(h-p),b=n.some(k=>sBe.has(k.effectId)&&!Ys(k)&&k.value>0),_={position:g,over:v,quality:b?iBe:f,level:e.level,overWeight:v?(o+d-h)*a:0,ratio:o/t.value,step:!y},j=v?"over":y?"repass":g>=rz-Sr?"step":"normal",S=uBe(_);return{...dBe(S,v),regime:j,difficulty:S,position:g,quality:_.quality,gain:d,limit:l,overWeight:_.overWeight,ratio:_.ratio,...x?{half:!0}:{},...b?{exoPa:!0}:{}}}
// Probabilité de toucher une ligne over/exo
function pBe(e){return Math.min(1,.75*Math.max(0,e)**.85)}
// Tirage pondéré d'une ligne normale
function mBe(e,t,n,r,i=-1){const a=e.map(l=>Math.min(1,t/n[l].weight)*(l===i?aBe:1));let o=r()*a.reduce((l,c)=>l+c,0);for(let l=0;l<e.length;l+=1)if(o-=a[l],o<0)return e[l];return e[e.length-1]}
function hBe(e,t){const n=[...e];for(let r=n.length-1;r>0;r-=1){const i=Math.floor(t()*(r+1));[n[r],n[i]]=[n[i],n[r]]}return n}
// Pertes (SN ou EC)
function gBe(e,t,n,r,i,{failure:a=!1}={}){const o=new Map,l=(v,y)=>{e[v]={...e[v],value:e[v].value-y},o.set(v,(o.get(v)||0)-y)},c=v=>v!==t||a&&e[v].value>0,u=v=>cd(e[v])&&(Ys(e[v])?e[v].value>Dc(e[v])[1]:e[v].value>0),d=(v,y)=>{const x=e[v],g=x.weight*(x.value<0?iz:1);if(i()>=pBe(n/g)*y)return;const b=x.value>0?x.value:x.value-Dc(x)[0],_=Math.min(b,Math.max(1,Math.ceil(f/g-Sr)));l(v,_),f-=_*g};let f=n;const p=e.map((v,y)=>y).filter(v=>v!==t&&u(v));for(const v of hBe(p,i)){if(f<=Sr)break;d(v,1)}if(f>Sr&&r>0){const v=Math.min(r,f);r-=v,f-=v}for(f>Sr&&e[t]&&c(t)&&u(t)&&d(t,oBe);f>Sr;){const v=e.map((_,j)=>j).filter(_=>c(_)&&Ys(e[_])&&cd(e[_])&&e[_].value>0);if(!v.length)break;const y=mBe(v,n,e,i,t),x=e[y],g=Math.min(x.value,Math.max(1,Math.ceil(f/x.weight-Sr))),b=g===1?1:1+Math.floor(i()*g);l(y,b),f-=b*x.weight}const h=e[t];if(f>Sr&&h&&cd(h)&&h.value>0){const v=Math.min(h.value,Math.max(1,Math.ceil(f/h.weight-Sr)));l(t,v),f-=v*h.weight}return f<-Sr&&(r+=-f),{lines:e,reliquat:yS(Math.max(0,r)),changes:o}}
// Pose complète
function vBe(e,t,n=Math.random){const r=oz(e.item,t);if(r.blocked)return{...e,outcome:null,odds:r,changes:[]};const i=n()*100,a=i<r.sc?"SC":i<r.sc+r.sn?"SN":"EC",o=e.item.lines.map(d=>({...d}));let l=o.findIndex(d=>d.effectId===t.effectId);const c=new Map;a!=="EC"&&(l<0&&(o.push({effectId:t.effectId,value:0,min:null,max:null,weight:t.weight/t.value}),l=o.length-1),o[l]={...o[l],value:o[l].value+t.value},c.set(l,t.value));let u=e.reliquat;if(a!=="SC"){const d=l>=0?e.item.lines[l]:null,f=t.weight*(d&&d.value+t.value<0?iz:1),p=gBe(o,l,f,u,n,{failure:a==="EC"});u=p.reliquat;for(const[h,v]of p.changes)c.set(h,(c.get(h)||0)+v)}return{item:{...e.item,lines:o},reliquat:u,outcome:a,odds:r,reliquatDelta:yS(u-e.reliquat),changes:[...c].filter(([,d])=>d).map(([d,f])=>({effectId:o[d].effectId,delta:f}))}}
