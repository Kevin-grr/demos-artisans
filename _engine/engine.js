/* Moteur commun des sites artisans.
   Chaque page définit window.SITE (données du client) AVANT de charger ce fichier. */
(function(){
const S = window.SITE;
const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString('fr-FR')+' €';
const round = n => Math.round(n/10)*10 >= 1000 ? Math.round(n/50)*50 : Math.round(n/10)*10;
const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const debounce=(f,ms=220)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>f(...a),ms)}};
const km=(a,b)=>{const R=6371,r=Math.PI/180,dLa=(b.lat-a.lat)*r,dLo=(b.lon-a.lon)*r,x=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(x))};
const IGN = layer => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${layer.includes('ORTHO')?'image/jpeg':'image/png'}`;
const IGN_PLAN = IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'), IGN_ORTHO = IGN('ORTHOIMAGERY.ORTHOPHOTOS');
const FP = (f,w=1400) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=${w}`;
const telMsg = ()=>toast(`Démo : ici, le téléphone de ${S.artisan} sonne directement 📞`);

function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('on'),2800)}

function autocomplete(input, box, fetcher, onPick){
  let items=[];
  const close=()=>box.classList.remove('on');
  const pick=it=>{input.value=it.label;close();onPick(it)};
  const run=debounce(async()=>{
    const q=input.value.trim(); if(q.length<2){close();return}
    try{ items=await fetcher(q) }catch(e){ items=[] }
    if(!items.length){box.innerHTML='<button disabled>Aucun résultat</button>';box.classList.add('on');return}
    box.innerHTML=items.map((it,i)=>`<button data-i="${i}">${esc(it.label)}<small>${esc(it.sub||'')}</small></button>`).join('');
    box.classList.add('on');
    box.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>pick(items[+b.dataset.i]));
  });
  input.addEventListener('input',run);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault(); if(items[0]&&box.classList.contains('on')) pick(items[0]); else run()} if(e.key==='Escape')close()});
  document.addEventListener('click',e=>{if(!box.contains(e.target)&&e.target!==input)close()});
}
const geoCommune = async q => {
  const r=await fetch(`https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=nom,centre,codesPostaux,codeDepartement&boost=population&limit=6`);
  const list=(await r.json()).filter(c=>c.centre).map(c=>({label:c.nom,sub:(c.codesPostaux||[])[0]+' · '+c.codeDepartement,lat:c.centre.coordinates[1],lon:c.centre.coordinates[0]}));
  if(list.length) return list;
  // repli : communes déléguées / anciennes communes (ex. Oiron) via la Base Adresse Nationale
  const g=await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&autocomplete=1&limit=5&lat=${S.base.lat}&lon=${S.base.lon}`);
  return (await g.json()).features.map(f=>({label:f.properties.type==='municipality'?f.properties.city:(f.properties.name+', '+f.properties.city),sub:f.properties.postcode+' · '+f.properties.context,lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]}));
};
const geoAddress = async q => {
  const r=await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&autocomplete=1&limit=5&lat=${S.base.lat}&lon=${S.base.lon}`);
  return (await r.json()).features.map(f=>({label:f.properties.label,sub:f.properties.context,lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],type:f.properties.type}));
};
const whenLeaflet = cb => window.L ? cb() : setTimeout(()=>whenLeaflet(cb),100);

/* ---------- Zone d'intervention ---------- */
function initZone(){
  if(!$('#zoneMap')) return;
  whenLeaflet(()=>{
    const B=S.base;
    const map=L.map('zoneMap',{scrollWheelZoom:false,dragging:!L.Browser.mobile,tap:false}).setView([B.lat,B.lon],9);
    map.attributionControl.setPrefix(false);
    L.tileLayer(IGN_PLAN,{maxZoom:18,className:'night',attribution:'© IGN — Plan IGN'}).addTo(map);
    const acc=getComputedStyle(document.documentElement).getPropertyValue('--acc').trim();
    L.circle([B.lat,B.lon],{radius:B.radiusKm*1000,color:acc,weight:2,dashArray:'6 8',fillColor:acc,fillOpacity:.08,interactive:false}).addTo(map);
    L.marker([B.lat,B.lon],{icon:L.divIcon({className:'pin'}),interactive:false}).addTo(map).bindTooltip(`${esc(S.short)} · ${esc(B.name)}`,{permanent:true,direction:'right',offset:[12,0],className:'lbl'});
    map.fitBounds(L.latLng(B.lat,B.lon).toBounds(B.radiusKm*2300));
    let layer;
    function show(it){
      const d=km(B,it), inZone=d<=B.radiusKm, mins=Math.round(d*1.3/65*60+4);
      if(layer) map.removeLayer(layer);
      layer=L.layerGroup([
        L.polyline([[B.lat,B.lon],[it.lat,it.lon]],{color:inZone?'#2fbf71':'#ff8a3d',weight:3,dashArray:'2 8',lineCap:'round'}),
        L.marker([it.lat,it.lon],{icon:L.divIcon({className:'dest'+(inZone?'':' out')})}).bindTooltip(esc(it.label),{permanent:true,direction:'right',offset:[12,0],className:'lbl'})
      ]).addTo(map);
      map.flyToBounds(L.latLngBounds([[B.lat,B.lon],[it.lat,it.lon]]).pad(.6),{duration:.8,maxZoom:11});
      const c=$('#zoneCard');
      c.innerHTML = inZone
        ? `<h4>✅ Oui, on vient à ${esc(it.label)}</h4><p>${esc(S.zoneOk||'Déplacement offert pour le devis.')}</p><div class="kpis"><div><b>${d<1?'<1':Math.round(d)} km</b><span>à vol d'oiseau</span></div><div><b>≈ ${mins} min</b><span>de route</span></div><div><b>${esc(S.urgency||'24 h')}</b><span>en urgence</span></div></div><button class="btn btn-main" data-z>Estimer mes travaux →</button>`
        : `<h4>🟠 ${esc(it.label)} est un peu loin</h4><p>${Math.round(d)} km, au-delà de notre zone de ${B.radiusKm} km. Appelez-nous : pour un gros chantier, on étudie.</p><div style="margin-top:12px"><a class="btn btn-main" href="#" data-zt>📞 Nous appeler</a></div>`;
      c.classList.add('on');
      c.querySelector('[data-z]')?.addEventListener('click',()=>openSim({city:it.label}));
      c.querySelector('[data-zt]')?.addEventListener('click',e=>{e.preventDefault();telMsg()});
    }
    autocomplete($('#cityIn'),$('#citySugg'),geoCommune,show);
    $('#geoBtn')?.addEventListener('click',()=>{
      if(!navigator.geolocation) return toast('Géolocalisation indisponible sur cet appareil');
      navigator.geolocation.getCurrentPosition(async p=>{
        let nom='Votre position';
        try{const r=await fetch(`https://geo.api.gouv.fr/communes?lat=${p.coords.latitude}&lon=${p.coords.longitude}&fields=nom`);nom=(await r.json())[0]?.nom||nom}catch(e){}
        $('#cityIn').value=nom; show({label:nom,lat:p.coords.latitude,lon:p.coords.longitude});
      },()=>toast('Position refusée : tapez plutôt votre commune'));
    });
  });
}

/* ---------- Chantiers réels (curseur temporel) ---------- */
function initCases(){
  const stage=$('#stage'); if(!stage||!S.cases) return;
  const scrub=$('#scrub'); let ci=0;
  if(S.cases.length>1){ $('#cases').innerHTML=S.cases.map((c,i)=>`<button data-c="${i}">${esc(c.tab)}</button>`).join(''); document.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>show(+b.dataset.c)) }
  function show(i){
    ci=i; const c=S.cases[i];
    document.querySelectorAll('[data-c]').forEach(b=>b.classList.toggle('on',+b.dataset.c===i));
    stage.querySelectorAll('img').forEach(x=>x.remove());
    c.stages.forEach((s,j)=>stage.insertAdjacentHTML('afterbegin',`<img src="${s.img}" alt="${esc(s.l)} — ${esc(s.c)}" data-j="${j}">`));
    scrub.max=(c.stages.length-1)*100; scrub.value=0;
    $('#ticks').innerHTML=c.stages.map((s,j)=>`<button data-t="${j}"><b style="display:block;font-size:13px">${esc(s.l)}</b>${esc(s.d)}</button>`).join('');
    document.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>animTo(+b.dataset.t*100));
    $('#cTitle').textContent=c.title; $('#cText').textContent=c.text;
    $('#cFacts').innerHTML=c.facts.map(f=>`<div><b>${esc(f[0])}</b><span>${esc(f[1])}</span></div>`).join('');
    $('#cCredit').innerHTML=c.credit; paint();
  }
  function paint(){
    const v=+scrub.value/100, near=Math.round(v), c=S.cases[ci];
    stage.querySelectorAll('img').forEach(im=>{const j=+im.dataset.j; im.style.zIndex=j===near?1:0; im.style.opacity=j===near?1:0});
    const nx=v>near?near+1:near-1, img=stage.querySelector(`img[data-j="${nx}"]`); if(img){img.style.zIndex=2;img.style.opacity=Math.abs(v-near)}
    const s=c.stages[near]; $('#stBadge').textContent=s.d; $('#stCap').textContent=s.c;
    document.querySelectorAll('[data-t]').forEach(b=>b.classList.toggle('on',+b.dataset.t===near));
  }
  function animTo(t){const a=+scrub.value,t0=performance.now();const f=n=>{const k=Math.min(1,(n-t0)/700),e=1-Math.pow(1-k,3);scrub.value=a+(t-a)*e;paint();if(k<1)requestAnimationFrame(f)};requestAnimationFrame(f)}
  scrub.addEventListener('input',paint); show(0);
  const o=new IntersectionObserver(es=>{if(!es[0].isIntersecting)return;o.disconnect();setTimeout(()=>animTo(+scrub.max),500)},{threshold:.5}); o.observe(stage);
}

/* ---------- Simulateur ---------- */
const WHEN = S.when || [{id:'urgent',e:'🚨',t:'Urgent',s:'Dans les 7 jours'},{id:'mois',e:'📅',t:'Dans le mois',s:'Avant la fin du mois prochain'},{id:'3mois',e:'🗓️',t:'Dans les 3 mois',s:'Je planifie'},{id:'info',e:'💭',t:'Je me renseigne',s:'Pas de date pour l\'instant'}];
const SLOTS=(()=>{const d=new Date();d.setDate(d.getDate()+1);if(d.getDay()===0)d.setDate(d.getDate()+1);let day=d.toLocaleDateString('fr-FR',{weekday:'long'});day=day[0].toUpperCase()+day.slice(1);return[{id:'a',b:day,s:'8h–10h'},{id:'b',b:day,s:'12h–14h'},{id:'c',b:day,s:'18h–20h'},{id:'sms',b:'Plutôt',s:'par SMS'}]})();
let st={}; let sim,simIn,next,back;
const need=()=>S.needs.find(x=>x.id===st.need);
function flow(){const n=need(),f=['need']; if(!n) return f; if(n.ask) f.push('ask'); if(n.unit) f.push('qty'); f.push('when','photos','result','done'); return f}
function openSim(o={}){
  st={need:o.need||null,ask:o.ask||null,qty:o.qty??null,qtyNote:o.qtyNote||'',override:o.override||null,extra:o.extra||null,when:o.when||null,photos:[],slot:'a',city:o.city||'',i:0};
  if(st.need){ st.i=1; if(st.ask && need().ask) st.i=2; if(st.ask && st.qty!=null) st.i=flow().indexOf('when') }
  sim.classList.add('open');document.body.style.overflow='hidden';render();
}
function closeSim(){sim.classList.remove('open');document.body.style.overflow=''}
function opts(list,key){return `<div class="opts two">`+list.map(o=>`<button class="opt ${st[key]===o.id?'sel':''}" data-k="${key}" data-v="${o.id}"><span class="e">${o.e}</span><span><b>${esc(o.t)}</b><small>${esc(o.s||'')}</small></span></button>`).join('')+`</div>`}
function estimate(){
  const n=need(); if(st.override) return st.override.map(round);
  let p=n.fixed||(n.price&&(n.price[st.ask]||n.price.all||Object.values(n.price)[0]));
  if(n.priceAsk&&st.ask&&n.priceAsk[st.ask]) p=n.priceAsk[st.ask];
  let lo=p[0],hi=p[1]; if(n.unit&&!n.fixed){lo*=st.qty;hi*=st.qty}
  if(n.unit&&n.fixed&&n.perUnit){lo*=st.qty;hi*=st.qty}
  if(st.when==='urgent'&&!n.noUrgentFee){lo*=1.05;hi*=1.1}
  return [round(lo),round(hi)];
}
const unitTxt=(n,q)=>n.unit+(q>1&&n.plural!==false&&!/²|ml/.test(n.unit)?'s':'');
function render(){
  const f=flow(), step=f[st.i], n=need();
  $('#simProg').style.width=(n?Math.min(100,st.i/(f.length-1)*100):4)+'%';
  back.style.visibility=st.i>0&&step!=='done'?'visible':'hidden';
  next.disabled=false; next.textContent='Continuer';
  let h='';
  if(step==='need'){h=`<div class="eyebrow">Étape 1</div><h3>De quoi avez-vous besoin&nbsp;?</h3>${opts(S.needs,'need')}`;next.disabled=!st.need}
  if(step==='ask'){h=`<div class="eyebrow">${n.e} ${esc(n.t)}</div><h3>${esc(n.ask.title)}</h3>${opts(n.ask.opts,'ask')}`;next.disabled=!st.ask}
  if(step==='qty'){
    if(st.qty==null) st.qty=n.def;
    h=`<div class="eyebrow">${n.e} ${esc(n.t)}</div><h3>${esc(n.qtyTitle)}&nbsp;?</h3>
      ${st.qtyNote?`<div class="measured">${st.qtyNote}</div>`:''}
      <div class="range-box"><div class="range-val"><span id="qv">${st.qty}</span> <small id="qu">${unitTxt(n,st.qty)}</small></div><input type="range" id="qr" min="${n.min}" max="${n.max}" step="${n.step||1}" value="${st.qty}" aria-label="${esc(n.qtyTitle)}"><div class="range-hint">${esc(n.hint||'')}</div></div>
      ${S.qtyExtra?S.qtyExtra(n,st):''}`;
  }
  if(step==='when'){h=`<div class="eyebrow">Presque fini</div><h3>Pour quand&nbsp;?</h3>${opts(WHEN,'when')}`;next.disabled=!st.when}
  if(step==='photos'){
    h=`<div class="eyebrow">Facultatif</div><h3>${esc(n.photoTitle||'Une photo ?')}</h3><p class="lead">${esc(n.photoLead||`Elle aide ${S.artisan} à préparer la visite et à venir avec le bon matériel.`)}</p>
      <button class="drop" id="drop"><span style="font-size:34px">📷</span><b>Ajouter des photos</b><small>Depuis votre téléphone ou ordinateur</small></button>
      <div class="thumbs">${st.photos.map(u=>`<img src="${u}" alt="Photo ajoutée">`).join('')}</div>`;
    next.textContent=st.photos.length?'Voir mon prix':'Passer et voir mon prix';
  }
  if(step==='result'){
    const [lo,hi]=estimate(), mid=(lo+hi)/2, a=n.ask&&n.ask.opts.find(o=>o.id===st.ask);
    const recap=[n.t,a&&a.t,st.extra,n.unit&&(st.qty+' '+unitTxt(n,st.qty)),WHEN.find(w=>w.id===st.when).t,st.photos.length&&`${st.photos.length} photo${st.photos.length>1?'s':''}`].filter(Boolean);
    h=`<div class="result"><div class="lbl">Votre fourchette estimée</div><div class="price">${fmt(lo)} – ${fmt(hi)}</div><div class="lbl">TTC, fournitures et pose comprises</div>
      <div class="recap">${recap.map(r=>`<span>${esc(r)}</span>`).join('')}</div>
      <div class="splitbar">${n.split.map(([k,p])=>`<div class="r"><span>${esc(k)}</span><span>≈ ${fmt(round(mid*p/100))}</span><i style="--w:${p}%"></i></div>`).join('')}</div>
      <div class="disc">Estimation indicative basée sur nos chantiers récents. Le prix exact est fixé sur le devis, après la visite gratuite.</div></div>
      <div class="subh">Quand ${esc(S.artisan)} vous rappelle-t-il&nbsp;?</div>
      <div class="slots">${SLOTS.map(s=>`<button class="slot ${st.slot===s.id?'sel':''}" data-slot="${s.id}"><b>${s.b}</b><small>${s.s}</small></button>`).join('')}</div>
      <div class="subh">Vos coordonnées</div>
      <div class="fields"><label for="fN">Prénom</label><input id="fN" autocomplete="given-name" value="${esc(st.name)}"><label for="fT">Téléphone</label><input id="fT" type="tel" inputmode="tel" autocomplete="tel" value="${esc(st.tel)}"><label for="fC">Commune</label><input id="fC" autocomplete="address-level2" value="${esc(st.city)}"></div>`;
    next.textContent='Recevoir mon devis';
  }
  if(step==='done'){
    const s=SLOTS.find(x=>x.id===st.slot), ref=S.refPrefix+'-'+String(Date.now()).slice(-5);
    const when=st.slot==='sms'?'vous envoie un SMS dans l\'heure':`vous rappelle <b style="color:#fff">${s.b.toLowerCase()} ${s.s}</b>`;
    h=`<div class="done"><div class="ok">✓</div><h3>C'est noté, ${esc(st.name)}&nbsp;!</h3><p>${esc(S.artisan)} ${when} pour caler ${esc(S.visitWord||'la visite gratuite')} à ${esc(st.city)}.</p>
      <div class="ticket"><div class="tt"><span>Dossier ${ref}</span><span>${n.e} ${esc(n.t)}</span></div><div class="tl">
      ${S.doneSteps.map((t,i)=>`<div><b>${i+1}</b>${esc(t)}</div>`).join('')}</div></div>
      <p style="font-size:13px;margin-top:22px">Démo : aucune donnée n'a été envoyée.</p></div>`;
    next.textContent='Fermer'; $('#simProg').style.width='100%';
  }
  simIn.innerHTML=`<div class="step">${h}</div>`;
  simIn.querySelectorAll('.opt').forEach(b=>b.onclick=()=>{const k=b.dataset.k;st[k]=b.dataset.v; if(k==='need'){st.ask=null;st.qty=null;st.qtyNote='';st.override=null;st.extra=null} if(k==='ask'){st.override=null;st.extra=null} render(); setTimeout(()=>next.click(),200)});
  simIn.querySelectorAll('[data-slot]').forEach(b=>b.onclick=()=>{saveContact();st.slot=b.dataset.slot;render()});
  const qr=$('#qr'); if(qr) qr.oninput=()=>{st.qty=+qr.value;st.override=null;st.extra=null;$('#qv').textContent=st.qty;$('#qu').textContent=unitTxt(n,st.qty)};
  $('#drop')?.addEventListener('click',()=>$('#fileIn').click());
  S.bindExtra&&S.bindExtra(st);
  sim.querySelector('.sim-body').scrollTop=0;
}
function saveContact(){if($('#fN')){st.name=$('#fN').value.trim();st.tel=$('#fT').value.trim();st.city=$('#fC').value.trim()}}
function validContact(){saveContact(); if(!st.name||st.tel.replace(/\D/g,'').length<10||!st.city){toast('Il manque votre prénom, un numéro à 10 chiffres ou la commune');return false} return true}

function buildSim(){
  document.body.insertAdjacentHTML('beforeend',`
  <div class="sim" id="sim" role="dialog" aria-modal="true" aria-label="Estimer mes travaux">
    <div class="sim-top"><div class="prog"><i id="simProg"></i></div><button id="simClose" aria-label="Fermer">✕</button></div>
    <div class="sim-body"><div class="sim-in" id="simIn"></div></div>
    <div class="sim-foot"><button class="btn back" id="simBack" aria-label="Retour">←</button><button class="btn btn-main" id="simNext" disabled>Continuer</button></div>
  </div><input type="file" id="fileIn" accept="image/*" multiple hidden><div class="toast" id="toast"></div>`);
  sim=$('#sim');simIn=$('#simIn');next=$('#simNext');back=$('#simBack');
  $('#simClose').onclick=closeSim;
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&sim.classList.contains('open'))closeSim()});
  back.onclick=()=>{if(st.i>0){st.i--;render()}};
  next.onclick=()=>{const s=flow()[st.i]; if(s==='result'&&!validContact())return; if(s==='done'){closeSim();return} st.i++;render()};
  $('#fileIn').onchange=e=>{[...e.target.files].slice(0,8-st.photos.length).forEach(f=>st.photos.push(URL.createObjectURL(f)));e.target.value='';render()};
}

/* ---------- Démarrage ---------- */
function init(){
  buildSim();
  const g=$('#needGrid'); if(g){g.innerHTML=S.needs.map(n=>`<button class="need" data-need="${n.id}"><span class="ic">${n.e}</span><span><strong>${esc(n.t)}</strong><small>${esc(n.s)}</small></span></button>`).join(''); g.querySelectorAll('[data-need]').forEach(b=>b.onclick=()=>openSim({need:b.dataset.need}))}
  document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openSim()));
  document.querySelectorAll('[data-tel]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();telMsg()}));
  initCases(); initZone();
  const ph=$('.phone'); if(ph){const o=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;o.disconnect();document.querySelectorAll('#feed .msg').forEach((m,i)=>setTimeout(()=>m.classList.add('in'),300+i*900));setTimeout(()=>$('#pbar').style.width=(S.feedProgress||'38%'),200)}),{threshold:.4});o.observe(ph)}
  const rv=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');rv.unobserve(e.target)}}),{threshold:.12});
  document.querySelectorAll('.rev').forEach(el=>rv.observe(el));
  const dock=$('#dock'); if(dock) addEventListener('scroll',()=>dock.classList.toggle('show',scrollY>innerHeight*.6),{passive:true});
}
window.Engine={openSim,closeSim,toast,autocomplete,geoCommune,geoAddress,km,esc,fmt,round,FP,IGN_PLAN,IGN_ORTHO,whenLeaflet,telMsg};
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
