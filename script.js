
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const store = { get(k,d){ try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }, set(k,v){ localStorage.setItem(k, JSON.stringify(v)) }, del(k){ localStorage.removeItem(k) } };
const SERVICES = { 'Exterior Wash':10, 'Full Valet':15, 'Deep Interior Clean':20 };
const PERMS = ['manageBookings','addManualBookings','manageReviews','viewCustomers','manageAdmins','viewAnalytics'];
const esc = v => String(v ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random());
const hasSupabaseConfig = !!(window.supabase && window.LGV_SUPABASE_URL && window.LGV_SUPABASE_ANON_KEY && !String(window.LGV_SUPABASE_URL).includes('PASTE_') && !String(window.LGV_SUPABASE_ANON_KEY).includes('PASTE_'));
const supabaseClient = hasSupabaseConfig ? window.supabase.createClient(window.LGV_SUPABASE_URL, window.LGV_SUPABASE_ANON_KEY, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }) : null;
let pendingVerifyEmail = store.get('lg_pending_verify_email','');
let currentSession = null;
const fallback = {
  bookings: store.get('lg_bookings', []),
  reviews: store.get('lg_reviews', null) || [
    {id:uid(), name:'Mason', rating:5, service:'Full Valet', text:'Car looked miles better after. Interior smelled fresh and the wheels came up clean.', approved:true, created_at:new Date(Date.now()-86400000).toISOString()},
    {id:uid(), name:'Ellie', rating:5, service:'Exterior Wash + Wax', text:'Easy to book, friendly service and the paint had a proper glossy finish after the wax.', approved:true, created_at:new Date(Date.now()-43200000).toISOString()},
    {id:uid(), name:'Josh', rating:5, service:'Deep Interior Clean', text:'Seats and carpets looked way cleaner than expected. Would definitely book again.', approved:true, created_at:new Date(Date.now()-18000000).toISOString()}
  ],
  profile: store.get('lg_profile', null)
};
const state = { profile:null, bookings:[], reviews:[], customers:[], admins:[], analytics:{pending:0,confirmed:0,completed:0,revenue:0} };
const profilePrefs = store.get('lg_profile_prefs', {});
function saveProfilePrefs(){ store.set('lg_profile_prefs', profilePrefs); }
function prefKey(user){ return (user?.email || user?.id || 'guest').toLowerCase(); }
function getPrefs(user=currentFullUser()){ return profilePrefs[prefKey(user)] || {}; }
function setPrefs(next,user=currentFullUser()){ if(!user) return; profilePrefs[prefKey(user)] = {...getPrefs(user), ...next}; saveProfilePrefs(); applyUserTheme(); }
function avatarHtml(user=currentFullUser()){
  const prefs=getPrefs(user);
  if(prefs.avatar) return `<img src="${prefs.avatar}" alt="${esc(user?.name||'Profile')} profile picture">`;
  const initials=(user?.name||user?.full_name||'LG').split(' ').filter(Boolean).map(x=>x[0]).join('').slice(0,2).toUpperCase() || 'LG';
  return initials;
}
function applyUserTheme(){
  const prefs=getPrefs();
  document.documentElement.dataset.theme = prefs.theme || 'blue';
}

function toast(msg){ const t=$('#toast'); if(!t){ console.log(msg); return; } t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3200); }
function saveFallback(){ store.set('lg_bookings', fallback.bookings); store.set('lg_reviews', fallback.reviews); store.set('lg_profile', fallback.profile); }
function currentFullUser(){ return state.profile || fallback.profile || null; }
function isAdmin(){ const p=currentFullUser(); return !!p && ['master','admin'].includes(p.role); }
function can(perm){ const p=currentFullUser(); if(!p || p.disabled) return false; if(p.role==='master') return true; return p.role==='admin' && Array.isArray(p.permissions) && p.permissions.includes(perm); }
function stars(n){ return '★★★★★'.slice(0,n)+'☆☆☆☆☆'.slice(0,5-n); }
function dayKind(dateStr){ if(!dateStr) return 'none'; const d=new Date(dateStr+'T12:00:00'); const n=d.getDay(); return (n>=1 && n<=5)?'weekday':'weekend'; }
function timeOptions(dateStr){ return dayKind(dateStr)==='weekday' ? ['16:00','16:30','17:00','17:30','18:00','18:30','19:00'] : ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00']; }
function fillTimes(select,dateStr){ if(!select) return; const old=select.value; const times=timeOptions(dateStr); select.innerHTML=times.map(t=>`<option value="${t}">${t}</option>`).join(''); if(times.includes(old)) select.value=old; }
function dateTaken(dateStr, ignoreId){ return dayKind(dateStr)==='weekday' && state.bookings.some(b => b.date===dateStr && b.id!==ignoreId && !['Declined','Cancelled'].includes(b.status)); }
function bookingRuleMessage(dateStr){ if(!dateStr) return 'Pick a date. Weekday slots are after 4:00pm.'; if(dayKind(dateStr)==='weekday' && dateTaken(dateStr)) return 'That weekday already has a booking. Pick another weekday or use a weekend.'; if(dayKind(dateStr)==='weekday') return 'Weekday selected: only after 4:00pm slots are available.'; return 'Weekend selected: more time slots are available.'; }
function servicePrice(service,wax=false){ return Number(SERVICES[service]||0)+(wax?5:0); }
function pageMode(){ return window.LGV_PAGE || document.body?.dataset?.page || (location.hostname.startsWith('admin.')?'admin':''); }

async function db(table, op, payload, opts={}){
  if(!supabaseClient) throw new Error('Supabase is not connected.');
  let q=supabaseClient.from(table);
  if(op==='select'){
    q=q.select(opts.select||'*');
    if(opts.eq) Object.entries(opts.eq).forEach(([k,v])=>q=q.eq(k,v));
    if(opts.order) q=q.order(opts.order, {ascending: opts.ascending ?? false});
    if(opts.limit) q=q.limit(opts.limit);
    const {data,error}=await q; if(error) throw error; return data||[];
  }
  if(op==='insert'){ const {data,error}=await q.insert(payload).select().single(); if(error) throw error; return data; }
  if(op==='update'){ let u=q.update(payload); if(opts.eq) Object.entries(opts.eq).forEach(([k,v])=>u=u.eq(k,v)); const {data,error}=await u.select(); if(error) throw error; return data; }
  if(op==='delete'){ let d=q.delete(); if(opts.eq) Object.entries(opts.eq).forEach(([k,v])=>d=d.eq(k,v)); const {error}=await d; if(error) throw error; return true; }
}
async function loadProfile(){
  if(!supabaseClient || !currentSession?.user){ state.profile=null; return; }
  const u=currentSession.user;
  let rows=[];
  try { rows=await db('profiles','select',null,{eq:{id:u.id}, limit:1}); } catch(e){ console.warn('profiles select failed', e.message); }
  let p=rows[0];
  if(!p){
    const full_name=u.user_metadata?.full_name || u.user_metadata?.name || (u.email||'Customer').split('@')[0];
    try { p=await db('profiles','insert',{id:u.id,email:u.email,full_name,role:'customer',permissions:[],disabled:false}); }
    catch(e){ p={id:u.id,email:u.email,full_name,role:'customer',permissions:[],disabled:false}; }
  }
  state.profile={ id:p.id, name:p.full_name || p.name || u.email?.split('@')[0] || 'Customer', full_name:p.full_name, email:p.email || u.email, phone:p.phone||'', role:p.role||'customer', permissions:p.permissions||[], disabled:!!p.disabled, verified:!!u.email_confirmed_at };
  fallback.profile=state.profile; saveFallback();
}
async function loadData(){
  if(!supabaseClient){ state.bookings=fallback.bookings; state.reviews=fallback.reviews; return; }
  try{
    const p=currentFullUser();
    const isA=isAdmin();
    state.bookings = await db('bookings','select',null,{order:'created_at'});
    if(!isA && p) state.bookings=state.bookings.filter(b=>b.user_id===p.id || (b.email||'').toLowerCase()===(p.email||'').toLowerCase());
    if(!p) state.bookings=[];
    state.reviews = await db('reviews','select',null,{order:'created_at'});
    if(!isA) state.reviews=state.reviews.filter(r=>r.approved!==false);
    if(isA){
      state.customers = can('viewCustomers')||can('manageAdmins') ? await db('profiles','select',null,{order:'created_at'}) : [];
      state.admins = state.customers.filter(x=>['master','admin'].includes(x.role));
    }
    fallback.bookings=state.bookings; fallback.reviews=state.reviews; saveFallback();
  }catch(e){ console.warn(e); state.bookings=fallback.bookings; state.reviews=fallback.reviews; }
}
async function refresh(){ await loadProfile(); await loadData(); renderAll(); }
async function initSupabase(){
  if(!supabaseClient){ state.bookings=fallback.bookings; state.reviews=fallback.reviews; state.profile=fallback.profile; renderAll(); return; }
  const {data}=await supabaseClient.auth.getSession(); currentSession=data?.session||null; await refresh();
  supabaseClient.auth.onAuthStateChange(async (_ev, session)=>{ currentSession=session; await refresh(); if(pageMode()==='admin' && !isAdmin()) showAdminGate(); });
}

function initNav(){ $('#year') && ($('#year').textContent=new Date().getFullYear()); addEventListener('scroll',()=>$('#header')?.classList.toggle('scrolled',scrollY>20),{passive:true}); $('#menuToggle') && ($('#menuToggle').onclick=()=>$('#navLinks')?.classList.toggle('open')); }
function openAuth(){ const m=$('#authModal'); if(!m) return; m.classList.add('open'); m.setAttribute('aria-hidden','false'); setTab(currentFullUser()?'profile':'login'); renderProfilePanel(); }
function closeAuth(){ const m=$('#authModal'); if(!m) return; m.classList.remove('open'); m.setAttribute('aria-hidden','true'); }
function setTab(tab){ if(tab==='profile'&&!currentFullUser()) tab='login'; if((tab==='login'||tab==='register')&&currentFullUser()) tab='profile'; $$('.tabs button').forEach(b=>{ b.classList.toggle('active',b.dataset.tab===tab); if(b.dataset.tab==='profile'||b.dataset.tab==='change') b.hidden=!currentFullUser(); }); $$('.auth-panel').forEach(p=>p.classList.remove('active')); $('#'+tab+'Form')?.classList.add('active'); if($('#authTitle')) $('#authTitle').textContent = tab==='register'?'Register':tab==='change'?'Change password':tab==='profile'?'Profile':'Login'; if($('#authMsg')) $('#authMsg').textContent=''; renderProfilePanel(); }
async function doLogout(e){
  if(e && typeof e.preventDefault === 'function') e.preventDefault();
  if(e && typeof e.stopPropagation === 'function') e.stopPropagation();

  // Fully sign out of Supabase, then aggressively clear every cached browser session.
  // This fixes the issue where the UI says logout but Supabase restores the account on refresh.
  try{
    if(supabaseClient){
      await supabaseClient.auth.signOut({ scope: 'global' });
    }
  }catch(err){
    console.warn('logout error', err?.message || err);
  }

  currentSession = null;
  state.profile = null;
  fallback.profile = null;
  pendingVerifyEmail = '';

  try{
    const keys = [];
    for(let i=0;i<localStorage.length;i++) keys.push(localStorage.key(i));
    keys.filter(Boolean).forEach(k=>{
      if(
        k === 'lg_profile' ||
        k === 'lg_pending_verify_email' ||
        k === 'supabase.auth.token' ||
        k.startsWith('sb-') ||
        k.includes('supabase') ||
        k.includes('gotrue')
      ){
        localStorage.removeItem(k);
      }
    });
  }catch(err){}

  try{
    const keys = [];
    for(let i=0;i<sessionStorage.length;i++) keys.push(sessionStorage.key(i));
    keys.filter(Boolean).forEach(k=>{
      if(k.startsWith('sb-') || k.includes('supabase') || k.includes('gotrue') || k.includes('lg_')){
        sessionStorage.removeItem(k);
      }
    });
  }catch(err){}

  store.del('lg_profile');
  store.del('lg_pending_verify_email');
  saveFallback();
  applyUserTheme();
  renderAll();
  setTab('login');
  closeAuth();
  toast('Logged out.');

  // Hard reload so every page/header/profile tab instantly becomes guest state.
  setTimeout(()=>{
    const target = pageMode()==='profile' ? '/profile/' : (pageMode()==='booking' ? '/booking/' : '/');
    window.location.replace(target + '?logged_out=' + Date.now());
  }, 250);
}
function renderProfilePanel(){
  const p=currentFullUser();
  const panel=$('#profileForm');
  if(!panel) return;
  const avatar=$('#profileAvatar');
  if(!p){
    if(avatar) avatar.innerHTML='LG';
    $('#profileName')&&($('#profileName').textContent='Guest');
    $('#profileEmail')&&($('#profileEmail').textContent='Login to view your profile.');
    $('#profileBookings')&&($('#profileBookings').textContent='0');
    $('#profileReviews')&&($('#profileReviews').textContent='0');
    $('#profileDisplayName')&&($('#profileDisplayName').value='');
    $('#profilePhone')&&($('#profilePhone').value='');
    $('#profileBookingsList')&&($('#profileBookingsList').innerHTML='<p class="muted">Login or register to see your bookings here.</p>');
    return;
  }
  const prefs=getPrefs(p);
  if(avatar) avatar.innerHTML=avatarHtml(p);
  $('#profileName')&&($('#profileName').textContent=p.name || p.full_name || 'Customer');
  $('#profileEmail')&&($('#profileEmail').textContent=`${p.email} · ${p.verified?'Verified':'Not verified'} · ${p.role||'customer'}`);
  $('#profileDisplayName')&&($('#profileDisplayName').value=p.name || p.full_name || '');
  $('#profilePhone')&&($('#profilePhone').value=p.phone || prefs.phone || '');
  $('#profileTheme')&&($('#profileTheme').value=prefs.theme || 'blue');
  const mine=state.bookings.filter(b=>b.user_id===p.id || b.userId===p.id || (b.email&&b.email.toLowerCase()===p.email));
  $('#profileBookings')&&($('#profileBookings').textContent=mine.length);
  $('#profileReviews')&&($('#profileReviews').textContent=state.reviews.filter(r=>r.email===p.email).length);
  $('#profileBookingsList')&&($('#profileBookingsList').innerHTML= mine.length ? mine.slice().sort((a,b)=>String(b.created_at||b.created).localeCompare(String(a.created_at||a.created))).map(b=>`<div class="booking-item"><strong>${esc(b.service)} · £${esc(b.total)} · ${esc(b.status)}</strong><span>${esc(b.date)} at ${esc(b.time)} · ${esc(b.vehicle)}</span><span>${esc(b.location)}</span></div>`).join('') : '<p class="muted">No bookings yet. Your website bookings will show here.</p>');
}
function showCodeVerifyBox(email){ const box=$('#verifyBox'); if(!box) return; pendingVerifyEmail=String(email||pendingVerifyEmail||'').toLowerCase(); store.set('lg_pending_verify_email', pendingVerifyEmail); box.hidden=false; box.innerHTML=`<div class="code-head"><span class="number">Email verification</span><h3>Enter your code</h3><p class="muted">We sent a code to <strong>${esc(pendingVerifyEmail||'your email')}</strong>. Paste it below to verify your account.</p></div><form id="codeVerifyForm" class="code-form"><label>Verification code<input required id="verifyCodeInput" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="12345678"></label><button class="pill primary full" type="submit">Verify code</button><button class="pill ghost full" id="resendCodeBtn" type="button">Resend code</button></form><p class="tiny" id="verifyCodeMsg"></p>`; $('#codeVerifyForm').onsubmit=verifySignupCode; $('#resendCodeBtn').onclick=resendSignupCode; $('#verifyCodeInput')?.focus(); }
async function verifySignupCode(e){ e?.preventDefault?.(); const email=pendingVerifyEmail || $('#registerEmail')?.value?.trim().toLowerCase() || $('#loginEmail')?.value?.trim().toLowerCase(); const token=$('#verifyCodeInput')?.value?.replace(/\D/g,'').trim(); const msg=$('#verifyCodeMsg')||$('#authMsg'); if(!supabaseClient){ msg.textContent='Supabase is not connected.'; return; } if(!email||!token||token.length<6){ msg.textContent='Enter the code from your email.'; return; } msg.textContent='Checking code...'; let result=await supabaseClient.auth.verifyOtp({email, token, type:'signup'}); if(result.error){ const fallbackOtp=await supabaseClient.auth.verifyOtp({email, token, type:'email'}); if(!fallbackOtp.error) result=fallbackOtp; }
  if(result.error){ msg.textContent=result.error.message; return; } currentSession=result.data?.session || currentSession; pendingVerifyEmail=''; store.del('lg_pending_verify_email'); $('#verifyBox').hidden=true; await refresh(); toast('Email verified. You are logged in.'); setTab('profile'); }
async function resendSignupCode(){ const email=pendingVerifyEmail || $('#registerEmail')?.value?.trim().toLowerCase() || $('#loginEmail')?.value?.trim().toLowerCase(); const msg=$('#verifyCodeMsg')||$('#authMsg'); if(!supabaseClient){ msg.textContent='Supabase is not connected.'; return; } if(!email){ msg.textContent='Enter your email first.'; return; } msg.textContent='Sending a new code...'; const {error}=await supabaseClient.auth.resend({type:'signup', email, options:{emailRedirectTo: location.origin+'/profile/'}}); if(error){ msg.textContent=error.message; return; } msg.textContent='New code sent.'; toast('Verification code resent.'); }
function initProfileSettings(){
  const form=$('#profileSettingsForm');
  if(!form) return;
  const file=$('#profilePfpInput');
  if(file) file.onchange=e=>{
    const p=currentFullUser();
    const f=e.target.files && e.target.files[0];
    if(!p || !f) return;
    if(!/^image\/(jpeg|png|webp)$/i.test(f.type)){ toast('Use a JPG, PNG or WebP image.'); return; }
    if(f.size > 900000){ toast('Profile picture is too large. Use one under 900KB.'); return; }
    const reader=new FileReader();
    reader.onload=()=>{ setPrefs({avatar:reader.result}, p); renderProfilePanel(); renderProfile(); toast('Profile picture updated.'); };
    reader.readAsDataURL(f);
  };
  form.onsubmit=async e=>{
    e.preventDefault();
    const p=currentFullUser();
    if(!p) return toast('Login first.');
    const full_name=$('#profileDisplayName')?.value?.trim() || p.name;
    const phone=$('#profilePhone')?.value?.trim() || '';
    const theme=$('#profileTheme')?.value || 'blue';
    try{
      if(supabaseClient && p.id) await db('profiles','update',{full_name, phone},{eq:{id:p.id}});
      state.profile={...p, name:full_name, full_name, phone};
      fallback.profile=state.profile;
      setPrefs({phone, theme}, state.profile);
      saveFallback();
      await refresh();
      toast('Profile settings saved.');
      setTab('profile');
    }catch(err){ toast(err.message || 'Could not save profile.'); }
  };
}
function initAuth(){ initProfileSettings(); $('#profileBtn')&&($('#profileBtn').onclick=openAuth); $('#quickLogin')&&($('#quickLogin').onclick=openAuth); $('#closeAuth')&&($('#closeAuth').onclick=closeAuth); $$('#profileLogout, #logoutBtn, [data-logout]').forEach(btn=>btn.addEventListener('click', doLogout)); $('#authModal')?.addEventListener('click',e=>{ if(e.target===$('#authModal')) closeAuth(); }); $$('.tabs button').forEach(btn=>btn.onclick=()=>setTab(btn.dataset.tab));
  const reg=$('#registerForm'); if(reg) reg.onsubmit=async e=>{ e.preventDefault(); const name=$('#registerName').value.trim(), email=$('#registerEmail').value.trim().toLowerCase(), password=$('#registerPassword').value; $('#authMsg')&&($('#authMsg').textContent=''); if(!supabaseClient){ fallback.profile={id:uid(),name,email,role:'customer',verified:true}; saveFallback(); await refresh(); setTab('profile'); return; } const {error}=await supabaseClient.auth.signUp({email,password,options:{data:{full_name:name},emailRedirectTo:location.origin+'/profile/'}}); if(error){ $('#authMsg').textContent=error.message; return; } showCodeVerifyBox(email); toast('Verification code sent.'); };
  const login=$('#loginForm'); if(login) login.onsubmit=async e=>{ e.preventDefault(); const email=$('#loginEmail').value.trim().toLowerCase(), password=$('#loginPassword').value; $('#authMsg')&&($('#authMsg').textContent=''); if(!supabaseClient){ const p=fallback.profile||{id:uid(),name:email.split('@')[0],email,role:'customer',verified:true}; fallback.profile=p; saveFallback(); await refresh(); setTab('profile'); return; } const {data,error}=await supabaseClient.auth.signInWithPassword({email,password}); if(error){ if(/confirm/i.test(error.message)){ pendingVerifyEmail=email; showCodeVerifyBox(email); $('#authMsg').textContent='Enter the verification code from your email before logging in.'; } else $('#authMsg').textContent=error.message; return; } currentSession=data.session; await refresh(); if(currentFullUser()?.disabled){ await doLogout(); $('#authMsg').textContent='This account has been disabled. Contact LG Valeting.'; return; } toast('Logged in.'); setTab('profile'); if(pageMode()==='admin') renderAdmin(); };
  const change=$('#changeForm'); if(change) change.onsubmit=async e=>{ e.preventDefault(); const pass=$('#changePassword').value; if(supabaseClient){ const {error}=await supabaseClient.auth.updateUser({password:pass}); if(error){ $('#authMsg').textContent=error.message; return; } } toast('Password changed.'); setTab('profile'); };
  if(pendingVerifyEmail) showCodeVerifyBox(pendingVerifyEmail);
}
function updateTotal(prefix='booking'){ const service=$('#'+prefix+'Service'); if(!service) return 0; const wax=$('#'+(prefix==='booking'?'waxAddon':'manualWax'))?.checked; const total=servicePrice(service.value,wax); if(prefix==='booking'&&$('#bookingTotal')) $('#bookingTotal').textContent='£'+total; return total; }
function applyChosenService(){ const params=new URLSearchParams(location.search); const service=params.get('service'); const wax=params.get('wax')==='1'; if(service && $('#bookingService')){ $('#bookingService').value=service; if($('#waxAddon')) $('#waxAddon').checked=wax || service==='Hybrid Wax Add-On'; updateTotal('booking'); } }
function initBooking(){ const minDate=new Date(); minDate.setDate(minDate.getDate()+1); const min=minDate.toISOString().split('T')[0]; ['bookingDate','manualDate'].forEach(id=>{ const el=$('#'+id); if(el) el.min=min; }); fillTimes($('#bookingTime'),$('#bookingDate')?.value); fillTimes($('#manualTime'),$('#manualDate')?.value); $('#bookingDate')&&($('#bookingDate').onchange=()=>{fillTimes($('#bookingTime'),$('#bookingDate').value); $('#bookingRuleHint')&&($('#bookingRuleHint').textContent=bookingRuleMessage($('#bookingDate').value));}); $('#manualDate')&&($('#manualDate').onchange=()=>fillTimes($('#manualTime'),$('#manualDate').value)); ['bookingService','waxAddon','manualService','manualWax'].forEach(id=>$('#'+id)&&($('#'+id).onchange=()=>updateTotal(id.startsWith('manual')?'manual':'booking'))); $$('.book-service').forEach(btn=>btn.onclick=()=>{ const card=btn.closest('.service-card'); const name=card?.dataset?.service || btn.dataset.service; const url='/booking/?service='+encodeURIComponent(name || 'Exterior Wash')+(name==='Hybrid Wax Add-On'?'&wax=1':''); location.href=url; }); applyChosenService(); const form=$('#bookingForm'); if(form) form.onsubmit=async e=>{ e.preventDefault(); const date=$('#bookingDate').value; if(dateTaken(date)){ toast('That weekday already has one booking. Pick another date.'); return; } const p=currentFullUser(); const b={ user_id:p?.id||null, name:$('#bookingName').value.trim(), email:$('#bookingEmail').value.trim().toLowerCase(), phone:$('#bookingPhone').value.trim(), vehicle:$('#bookingVehicle').value.trim(), service:$('#bookingService').value, date, time:$('#bookingTime').value, location:$('#bookingLocation').value.trim(), wax:$('#waxAddon')?.checked||false, total:updateTotal('booking'), status:'Pending', source:'Website', notes:$('#bookingNotes').value.trim() };
    try{ if(supabaseClient) await db('bookings','insert',b); else { b.id=uid(); b.created_at=new Date().toISOString(); fallback.bookings.push(b); saveFallback(); } await refresh(); toast('Booking request sent. Await confirmation from LG Valeting.'); form.reset(); fillTimes($('#bookingTime')); updateTotal('booking'); }
    catch(err){ toast(err.message || 'Booking failed.'); }
  };
  const mform=$('#manualBookingForm'); if(mform) mform.onsubmit=async e=>{ e.preventDefault(); if(!can('addManualBookings')) return toast('No permission to add bookings.'); const date=$('#manualDate').value; if(dateTaken(date)) return toast('That weekday already has one booking. Pick another date.'); const b={ user_id:null, name:$('#manualName').value.trim(), email:$('#manualEmail').value.trim().toLowerCase(), phone:$('#manualPhone').value.trim(), vehicle:$('#manualVehicle').value.trim(), service:$('#manualService').value, date, time:$('#manualTime').value, location:$('#manualLocation').value.trim(), wax:$('#manualWax')?.checked||false, total:updateTotal('manual'), status:'Confirmed', source:'Manual / Facebook', notes:$('#manualNotes').value.trim() };
    try{ if(supabaseClient) await db('bookings','insert',b); else {b.id=uid(); fallback.bookings.push(b); saveFallback();} await refresh(); toast('Manual booking added.'); mform.reset(); $('#manualLocation')&&($('#manualLocation').value='Crofton, Wakefield'); }catch(err){ toast(err.message); }
  };
}
function renderProfile(){ const p=currentFullUser(); applyUserTheme(); if($('#profileBtn')) { $('#profileBtn').classList.add('profile-chip'); $('#profileBtn').innerHTML=p?`<span class="mini-avatar">${avatarHtml(p)}</span><span>${esc(isAdmin()?'Admin':(p.name||'Profile').split(' ')[0])}</span>`:'Login'; } $('#dashName')&&($('#dashName').textContent=p?p.name:'Guest customer'); $('#dashStatus')&&($('#dashStatus').textContent=p?`${p.verified?'Verified':'Unverified'} ${p.role||'customer'} profile`:'Create an account to save your details, bookings and reviews.'); if(p){ $('#bookingName')&&($('#bookingName').value ||= p.name); $('#bookingEmail')&&($('#bookingEmail').value ||= p.email); $('#reviewName')&&($('#reviewName').value ||= p.name); } const mine=p?state.bookings.filter(b=>b.user_id===p.id||b.userId===p.id||(b.email&&b.email===p.email)):[]; $('#dashBookings')&&($('#dashBookings').textContent=mine.length); $('#dashReviews')&&($('#dashReviews').textContent=state.reviews.filter(r=>p&&r.email===p.email).length); $('#bookingList')&&($('#bookingList').innerHTML=mine.length?mine.map(b=>`<div class="booking-item"><strong>${esc(b.service)} · £${esc(b.total)}</strong><span>${esc(b.date)} · ${esc(b.time)} · ${esc(b.vehicle)}</span><span>${esc(b.status)}</span></div>`).join(''):'<p class="muted">No bookings yet. Your requests will appear here.</p>'); const admin=$('#admin'); if(admin) admin.hidden=!isAdmin(); }
function renderReviews(){ const grid=$('#reviewGrid'); if(!grid) return; grid.innerHTML=state.reviews.filter(r=>r.approved!==false).slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).map(r=>`<article class="review glass"><div class="stars">${stars(Number(r.rating))}</div><h3>${esc(r.name)}</h3><small>${esc(r.service||'LG Valeting')}</small><p>“${esc(r.text)}”</p></article>`).join(''); }
function initReviews(){ const rating=$('#reviewRating'); if(rating && !$('#starRating')){ rating.style.display='none'; rating.insertAdjacentHTML('afterend','<div id="starRating" class="star-picker" role="radiogroup" aria-label="Rating">'+[1,2,3,4,5].map(n=>`<button type="button" data-rate="${n}" aria-label="${n} stars">★</button>`).join('')+'</div>'); const pick=n=>{ rating.value=n; $$('#starRating button').forEach(b=>b.classList.toggle('active',Number(b.dataset.rate)<=n)); }; $$('#starRating button').forEach(b=>b.onclick=()=>pick(Number(b.dataset.rate))); pick(Number(rating.value||5)); }
  const form=$('#reviewForm'); if(form) form.onsubmit=async e=>{ e.preventDefault(); const p=currentFullUser(); const r={name:$('#reviewName').value.trim(), email:p?.email||'', rating:Number($('#reviewRating').value), service:$('#reviewService').value.trim(), text:$('#reviewText').value.trim(), approved:false}; try{ if(supabaseClient) await db('reviews','insert',r); else {r.id=uid(); r.created_at=new Date().toISOString(); fallback.reviews.push({...r,approved:true}); saveFallback();} await refresh(); toast('Review submitted. It will show once approved.'); form.reset(); if(p) $('#reviewName').value=p.name; }catch(err){ toast(err.message); } };
}
function initAdmin(){ $$('.admin-tab[data-admin-tab]').forEach(btn=>btn.onclick=()=>{ $$('.admin-tab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); $$('.admin-panel').forEach(p=>p.classList.remove('active')); $('#'+btn.dataset.adminTab)?.classList.add('active'); }); $('#bookingFilter')&&($('#bookingFilter').onchange=renderAdmin); const acf=$('#adminCreateForm'); if(acf) acf.onsubmit=async e=>{ e.preventDefault(); if(!can('manageAdmins')) return toast('No permission to manage admins.'); const email=$('#adminEmail').value.trim().toLowerCase(); const permissions=$$('#adminCreateForm .perm-grid input:checked').map(i=>i.value); try{ const matches=(state.customers||[]).filter(p=>(p.email||'').toLowerCase()===email); if(!matches.length) return toast('Ask them to register first, then promote their account here.'); await db('profiles','update',{role:'admin',permissions,disabled:false},{eq:{id:matches[0].id}}); await refresh(); toast('Admin permissions updated.'); acf.reset(); }catch(err){ toast(err.message); } };
}
function statusButtons(b){ if(!can('manageBookings')) return ''; return ['Pending','Confirmed','Completed','Declined','Cancelled'].map(s=>`<button class="mini-btn ${b.status===s?'active':''}" data-booking-status="${s}" data-id="${b.id}">${s}</button>`).join(''); }
function showAdminGate(){ const admin=$('#admin'); if(admin) admin.hidden=true; openAuth(); $('#authMsg')&&($('#authMsg').textContent='Login with an admin account to open the control panel.'); }
function renderAdmin(){ if(pageMode()==='admin' && !isAdmin()){ showAdminGate(); return; } if(!isAdmin()) return; const bookingsEl=$('#adminBookings'); if(!bookingsEl) return; const filter=$('#bookingFilter')?.value||'all'; const bookings=state.bookings.filter(b=>filter==='all'||b.status===filter).sort((a,b)=>(String(a.date)+String(a.time)).localeCompare(String(b.date)+String(b.time))); bookingsEl.innerHTML=bookings.length?bookings.map(b=>`<div class="admin-item"><div><strong>${esc(b.date)} ${esc(b.time)} · ${esc(b.name)}</strong><span>${esc(b.service)} · £${esc(b.total)} · ${esc(b.vehicle)} · ${esc(b.phone)} · ${esc(b.source||'Website')}</span><small>${esc(b.location)}${b.notes?' · '+esc(b.notes):''}</small></div><div class="admin-actions">${statusButtons(b)}<button class="mini-btn danger" data-delete-booking="${b.id}">Delete</button></div></div>`).join(''):'<p class="muted">No bookings found.</p>';
  $$('[data-booking-status]').forEach(btn=>btn.onclick=async()=>{ try{ await db('bookings','update',{status:btn.dataset.bookingStatus},{eq:{id:btn.dataset.id}}); await refresh(); toast('Booking updated.'); }catch(e){ toast(e.message); } });
  $$('[data-delete-booking]').forEach(btn=>btn.onclick=async()=>{ if(!confirm('Delete this booking?')) return; try{ await db('bookings','delete',null,{eq:{id:btn.dataset.deleteBooking}}); await refresh(); toast('Booking deleted.'); }catch(e){ toast(e.message); } });
  const customers=state.customers||[]; $('#adminUsers')&&($('#adminUsers').innerHTML=customers.filter(u=>['admin','master'].includes(u.role)).map(u=>`<div class="admin-item"><div><strong>${esc(u.full_name||u.email)} · ${esc(u.role)}</strong><span>${esc(u.email)}${u.disabled?' · disabled':''}</span><small>${esc((u.permissions||[]).join(', ')||'all permissions')}</small></div>${u.role!=='master'&&can('manageAdmins')?`<button class="mini-btn danger" data-demote-admin="${u.id}">Demote</button>`:''}</div>`).join('')||'<p class="muted">No admins yet.</p>');
  $$('[data-demote-admin]').forEach(btn=>btn.onclick=async()=>{ await db('profiles','update',{role:'customer',permissions:[]},{eq:{id:btn.dataset.demoteAdmin}}); await refresh(); toast('Admin demoted.'); });
  $('#adminCustomers')&&($('#adminCustomers').innerHTML=can('viewCustomers')?customers.filter(u=>u.role==='customer'||!u.role).map(u=>`<div class="admin-item"><div><strong>${esc(u.full_name||u.email)}</strong><span>${esc(u.email)} · ${u.disabled?'disabled':'active'}</span><small>${state.bookings.filter(b=>b.user_id===u.id||b.email===u.email).length} bookings</small></div><div class="admin-actions"><button class="mini-btn" data-promote-user="${u.id}">Promote</button><button class="mini-btn danger" data-disable-user="${u.id}">${u.disabled?'Enable':'Disable'}</button></div></div>`).join('')||'<p class="muted">No customers yet.</p>':'<p class="muted">No permission to view customers.</p>');
  $$('[data-promote-user]').forEach(btn=>btn.onclick=async()=>{ await db('profiles','update',{role:'admin',permissions:['manageBookings','addManualBookings','manageReviews','viewCustomers']},{eq:{id:btn.dataset.promoteUser}}); await refresh(); toast('Customer promoted to admin.'); });
  $$('[data-disable-user]').forEach(btn=>btn.onclick=async()=>{ const u=customers.find(x=>x.id===btn.dataset.disableUser); await db('profiles','update',{disabled:!u.disabled},{eq:{id:u.id}}); await refresh(); toast('Customer updated.'); });
  $('#adminReviews')&&($('#adminReviews').innerHTML=can('manageReviews')?state.reviews.slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).map(r=>`<div class="admin-item"><div><strong>${esc(r.name)} · ${stars(Number(r.rating))}</strong><span>${esc(r.service||'LG Valeting')} · ${r.approved===false?'Hidden/Pending':'Visible'}</span><small>${esc(r.text)}</small></div><div class="admin-actions"><button class="mini-btn" data-toggle-review="${r.id}">${r.approved===false?'Approve/Show':'Hide'}</button><button class="mini-btn danger" data-delete-review="${r.id}">Delete</button></div></div>`).join(''):'<p class="muted">No permission to manage reviews.</p>');
  $$('[data-toggle-review]').forEach(btn=>btn.onclick=async()=>{ const r=state.reviews.find(x=>x.id===btn.dataset.toggleReview); await db('reviews','update',{approved:!(r.approved!==false)},{eq:{id:r.id}}); await refresh(); });
  $$('[data-delete-review]').forEach(btn=>btn.onclick=async()=>{ if(!confirm('Delete this review?')) return; await db('reviews','delete',null,{eq:{id:btn.dataset.deleteReview}}); await refresh(); toast('Review deleted.'); });
}
function initPageMode(){ const mode=pageMode(); setTimeout(()=>{ if(mode==='booking') $('#booking')?.scrollIntoView({behavior:'smooth',block:'start'}); if(mode==='profile') openAuth(); if(mode==='admin'){ if(isAdmin()){ $('#admin')?.removeAttribute('hidden'); $('#admin')?.scrollIntoView({behavior:'smooth',block:'start'}); renderAdmin(); } else showAdminGate(); } },250); }
function initCompare(){ $$('.compare').forEach(box=>{ const before=box.querySelector('.before'), handle=box.querySelector('.handle'); if(!before||!handle) return; function set(x){ const r=box.getBoundingClientRect(); const p=Math.max(0,Math.min(100,((x-r.left)/r.width)*100)); before.style.clipPath=`inset(0 ${100-p}% 0 0)`; handle.style.left=p+'%'; } box.addEventListener('mousedown',e=>{set(e.clientX); const move=m=>set(m.clientX); const up=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',up)}; addEventListener('mousemove',move); addEventListener('mouseup',up);}); box.addEventListener('touchmove',e=>set(e.touches[0].clientX),{passive:true}); }); }
function initScrollFx(){ const obs=new IntersectionObserver(entries=>entries.forEach(e=>{ if(e.isIntersecting) e.target.classList.add('in-view'); }),{threshold:.12}); $$('.card,.glass,.section-head,.review,.compare-card').forEach(el=>{ el.classList.add('scroll-fx'); obs.observe(el); }); }
function renderAll(){ renderProfile(); renderReviews(); renderAdmin(); renderProfilePanel(); }
initNav(); initAuth(); initBooking(); initReviews(); initAdmin(); initCompare(); initScrollFx(); updateTotal('booking'); initSupabase().then(()=>{ renderAll(); initPageMode(); });

// LGV v3 reactive glow + stronger scroll animation refresh
window.addEventListener('pointermove', e=>{
  document.body.style.setProperty('--mx', e.clientX+'px');
  document.body.style.setProperty('--my', e.clientY+'px');
},{passive:true});
