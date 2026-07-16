const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;

const state = { view:'dashboard', snapshot:null, viewer:null, busy:false, demo:false };
const navItems = [
  ['dashboard','總覽'],['talks','場次'],['speakers','講者'],['tasks','待辦'],['settings','設定']
];

function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600)}
function setSync(text,kind=''){const el=$('#syncPill');el.textContent=text;el.className=`pill ${kind}`.trim()}

const demoData = {
  revision:1,serverTime:new Date().toISOString(),
  viewer:{email:'owner@example.edu',role:'owner',domain:'example.edu'},
  config:{schemaVersion:1,organization:{schoolName:'範例大學',unitName:'通識教育中心',timeZone:'Asia/Taipei'},course:{name:'AI 與社會專題演講',semester:'115-1',room:'人文大樓 A101',talkCount:4},schedule:{termStart:'2026-09-07',termEnd:'2027-01-08',weekday:3,startTime:'14:00',endTime:'17:00',excludedDates:[]},features:{speakerLibrary:true,tasks:true,backup:true}},
  speakers:[{id:'spk_1',name:'林老師',title:'副教授',organization:'範例大學',email:'',phone:'',notes:'AI 倫理',status:'active',version:1}],
  talks:[{id:'talk_1',date:'2026-09-16',startTime:'14:00',endTime:'17:00',title:'生成式 AI 與社會',speakerId:'spk_1',room:'人文大樓 A101',status:'confirmed',notes:'',version:1},{id:'talk_2',date:'2026-09-23',startTime:'14:00',endTime:'17:00',title:'',speakerId:'',room:'人文大樓 A101',status:'planned',notes:'',version:1}],
  tasks:[{id:'task_1',talkId:'talk_1',title:'寄出演講前確認信',dueDate:'2026-09-09',assigneeEmail:'',status:'pending',notes:'',version:1}],
  users:[{id:'user_1',email:'owner@example.edu',role:'owner',status:'active',version:1}]
};

const demoApi = {
  async whoami(){return {ok:true,email:demoData.viewer.email,domain:demoData.viewer.domain,role:'owner',installed:true}},
  async getSnapshot(){return structuredClone(demoData)},
  async saveBatch(payload){
    for(const op of payload.operations){
      const list=demoData[op.entity];
      if(op.action==='create'){const row={...op.data,id:op.id||uid(op.entity.slice(0,-1)),version:1,status:op.data.status||'active'};list.push(row)}
      if(op.action==='update'){const i=list.findIndex(x=>x.id===op.id);if(i>=0)list[i]={...list[i],...op.data,version:(list[i].version||0)+1}}
      if(op.action==='delete'){const i=list.findIndex(x=>x.id===op.id);if(i>=0)list.splice(i,1)}
    }
    demoData.revision++; return {ok:true,revision:demoData.revision,results:[]};
  },
  async importCourseConfig({config}){demoData.config=config;demoData.revision++;return {ok:true,revision:demoData.revision,config}},
  async healthCheck(){return {ok:true,installed:true,domain:'example.edu',ownerCount:1,sheets:['Users','Settings','Speakers','Talks','Tasks','AuditLog','Transactions']}}
};

function gasCall(name,arg){
  if(state.demo||!(globalThis.google?.script?.run)) return demoApi[name](arg);
  return new Promise((resolve,reject)=>{
    const runner=google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
    if(arg===undefined) runner[name]();
    else runner[name](arg);
  });
}

function normalizeGasError(raw){
  const original=raw?.message||String(raw||'未知錯誤');
  const start=original.indexOf('{'),end=original.lastIndexOf('}');
  if(start>=0&&end>start){
    try{const parsed=JSON.parse(original.slice(start,end+1));return {code:parsed.code||'ERROR',message:parsed.message||original,details:parsed.details||null}}
    catch(_error){}
  }
  return {code:'ERROR',message:original,details:null};
}

async function mutate(task,successMessage){
  if(state.busy) throw new Error('上一筆資料還在寫入，請稍候。');
  state.busy=true;document.body.classList.add('is-busy');setSync('寫入中','warn');
  try{
    const result=await task();
    if(successMessage)toast(successMessage);
    await refresh();
    return result;
  }catch(raw){
    const error=normalizeGasError(raw);
    if(['REVISION_CONFLICT','VERSION_CONFLICT'].includes(error.code)){
      await refresh().catch(()=>{});
      error.message='資料已被其他人更新，畫面已重新整理；請確認後再操作一次。';
    }else setSync('同步失敗','danger');
    throw Object.assign(new Error(error.message),{code:error.code,details:error.details});
  }finally{
    state.busy=false;document.body.classList.remove('is-busy');
  }
}

async function boot(){
  state.demo=new URLSearchParams(location.search).get('demo')==='1'||!(globalThis.google?.script?.run);
  try{
    const who=await gasCall('whoami');
    if(!who.ok||!who.installed) return renderInstall(who);
    state.viewer={email:who.email,role:who.role,domain:who.domain};
    $('#viewerLabel').textContent=`${who.email} · ${who.role}`;
    await refresh(); renderNav();
  }catch(error){renderFatal(error)}
}
async function refresh(){setSync('同步中');state.snapshot=await gasCall('getSnapshot',{});if(state.snapshot.ok===false)throw new Error(state.snapshot.error?.message||'讀取失敗');state.viewer=state.snapshot.viewer||state.viewer;setSync(state.demo?'示範模式':'已同步');render()}

function renderNav(){const nav=$('#nav');nav.innerHTML=navItems.map(([id,label])=>`<button data-view="${id}">${label}</button>`).join('');nav.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(!b)return;state.view=b.dataset.view;render()})}
function render(){
  const config=state.snapshot?.config;$('#courseTitle').textContent=config?.course?.name||'Talk Course Manager';
  $$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  const views={dashboard:renderDashboard,talks:renderTalks,speakers:renderSpeakers,tasks:renderTasks,settings:renderSettings};
  views[state.view]?.();
}
function $$(selector,root=document){return [...root.querySelectorAll(selector)]}
function page(title,subtitle,action=''){return `<div class="pagehead"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${action}</div>`}
function speakerName(id){return state.snapshot.speakers.find(s=>s.id===id)?.name||'尚未安排'}
function talkName(id){const t=state.snapshot.talks.find(x=>x.id===id);return t?(t.title||t.date||'未命名場次'):'未連結場次'}
function statusLabel(status){return ({planned:'規劃中',confirmed:'已確認',completed:'已完成',cancelled:'已取消',pending:'待處理',in_progress:'處理中',done:'已完成',active:'使用中',inactive:'停用'}[status]||status||'—')}

function renderDashboard(){
  const s=state.snapshot,talks=s.talks||[],tasks=s.tasks||[];
  const upcoming=[...talks].filter(t=>t.date&&t.status!=='cancelled'&&t.status!=='completed').sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
  $('#app').innerHTML=page('總覽','先看下一場與還沒完成的事')+`<div class="grid">
    <section class="card metric"><span>場次</span><strong>${talks.length}</strong></section>
    <section class="card metric"><span>已確認</span><strong>${talks.filter(t=>t.status==='confirmed').length}</strong></section>
    <section class="card metric"><span>講者</span><strong>${s.speakers.length}</strong></section>
    <section class="card metric"><span>待辦</span><strong>${tasks.filter(t=>t.status!=='done').length}</strong></section>
    <section class="card split"><h3>接下來的場次</h3>${upcoming.length?`<div class="tablewrap"><table><tbody>${upcoming.map(t=>`<tr><td><b>${esc(t.date)}</b><br><span class="muted">${esc(t.startTime)}–${esc(t.endTime)}</span></td><td>${esc(t.title||'講題待確認')}<br><span class="muted">${esc(speakerName(t.speakerId))}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">還沒有排定場次</div>'}</section>
    <section class="card split"><h3>系統狀態</h3><p>資料版本：${esc(s.revision)}</p><p>使用者：${esc(state.viewer?.role)}</p><p class="muted">${state.demo?'目前為假資料示範，不會寫入 Google Sheet。':'所有正式資料儲存在本課程的私有 Google Sheet。'}</p></section>
  </div>`;
}

function renderTalks(){const rows=[...state.snapshot.talks].sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));$('#app').innerHTML=page('場次','日期、講題與講者一頁管理','<button class="btn" data-new="talk">新增場次</button>')+`<section class="card"><div class="tablewrap"><table><thead><tr><th>日期</th><th>講題／講者</th><th>狀態</th><th>教室</th><th></th></tr></thead><tbody>${rows.map(t=>`<tr><td>${esc(t.date||'未排')}<br><span class="muted">${esc(t.startTime||'')}–${esc(t.endTime||'')}</span></td><td><b>${esc(t.title||'講題待確認')}</b><br><span class="muted">${esc(speakerName(t.speakerId))}</span></td><td><span class="status ${esc(t.status)}">${esc(statusLabel(t.status))}</span></td><td>${esc(t.room||'')}</td><td><div class="actions"><button class="btn ghost" data-edit-talk="${esc(t.id)}">編輯</button><button class="btn danger" data-delete="talks:${esc(t.id)}:${t.version}">刪除</button></div></td></tr>`).join('')}</tbody></table></div></section>`;bindCommon();$('[data-new="talk"]')?.addEventListener('click',()=>openTalk()) ;$$('[data-edit-talk]').forEach(b=>b.addEventListener('click',()=>openTalk(state.snapshot.talks.find(t=>t.id===b.dataset.editTalk))))}

function renderSpeakers(){const rows=state.snapshot.speakers;$('#app').innerHTML=page('講者','只保存課務需要的聯絡資料','<button class="btn" data-new="speaker">新增講者</button>')+`<section class="card"><div class="tablewrap"><table><thead><tr><th>姓名</th><th>單位／職稱</th><th>聯絡</th><th>備註</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.organization||'')}<br><span class="muted">${esc(s.title||'')}</span></td><td>${esc(s.email||'')}<br><span class="muted">${esc(s.phone||'')}</span></td><td>${esc(s.notes||'')}</td><td><div class="actions"><button class="btn ghost" data-edit-speaker="${esc(s.id)}">編輯</button><button class="btn danger" data-delete="speakers:${esc(s.id)}:${s.version}">刪除</button></div></td></tr>`).join('')}</tbody></table></div></section>`;bindCommon();$('[data-new="speaker"]')?.addEventListener('click',()=>openSpeaker());$$('[data-edit-speaker]').forEach(b=>b.addEventListener('click',()=>openSpeaker(state.snapshot.speakers.find(s=>s.id===b.dataset.editSpeaker))))}

function renderTasks(){const rows=[...state.snapshot.tasks].sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));$('#app').innerHTML=page('待辦','每一場該做的事，照到期日排序','<button class="btn" data-new="task">新增待辦</button>')+`<section class="card"><div class="tablewrap"><table><thead><tr><th>到期日</th><th>待辦</th><th>場次</th><th>狀態</th><th></th></tr></thead><tbody>${rows.map(t=>`<tr><td>${esc(t.dueDate||'')}</td><td><b>${esc(t.title)}</b><br><span class="muted">${esc(t.notes||'')}</span></td><td>${esc(talkName(t.talkId))}</td><td><span class="status ${esc(t.status)}">${esc(statusLabel(t.status))}</span></td><td><div class="actions"><button class="btn ghost" data-edit-task="${esc(t.id)}">編輯</button><button class="btn danger" data-delete="tasks:${esc(t.id)}:${t.version}">刪除</button></div></td></tr>`).join('')}</tbody></table></div></section>`;bindCommon();$('[data-new="task"]')?.addEventListener('click',()=>openTask());$$('[data-edit-task]').forEach(b=>b.addEventListener('click',()=>openTask(state.snapshot.tasks.find(t=>t.id===b.dataset.editTask))))}

function renderSettings(){const c=state.snapshot.config||{};const isOwner=state.viewer?.role==='owner';$('#app').innerHTML=page('設定','課程設定與同網域使用者')+`<div class="grid"><section class="card split"><h3>課程設定</h3><p><b>${esc(c.course?.name||'尚未設定')}</b></p><p>${esc(c.organization?.schoolName||'')} · ${esc(c.course?.semester||'')}</p><p class="muted">${esc(c.schedule?.termStart||'')}～${esc(c.schedule?.termEnd||'')}，星期 ${esc(c.schedule?.weekday??'—')}，${esc(c.schedule?.startTime||'')}–${esc(c.schedule?.endTime||'')}</p><div class="actions">${isOwner?'<button class="btn secondary" id="importConfig">匯入課程設定</button>':''}<button class="btn ghost" id="backup">下載 JSON 備份</button></div><p class="muted">備份可能含講者聯絡資料，請當成個資檔保存。</p></section><section class="card split"><h3>權限健檢</h3><p>部署模式：同校 Workspace</p>${isOwner?'<button class="btn secondary" id="health">執行健檢</button><pre id="healthOut" class="code" hidden></pre>':'<p class="muted">只有 owner 可以查看完整健檢。</p>'}</section>${isOwner?`<section class="card"><div class="toolbar"><h3>使用者</h3><button class="btn" id="addUser">新增使用者</button></div><div class="tablewrap"><table><thead><tr><th>Email</th><th>角色</th><th>狀態</th><th></th></tr></thead><tbody>${state.snapshot.users.map(u=>`<tr><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(u.status)}</td><td>${u.email!==state.viewer.email?`<button class="btn danger" data-delete="users:${esc(u.id)}:${u.version}">移除</button>`:''}</td></tr>`).join('')}</tbody></table></div></section>`:''}</div>`;bindCommon();$('#importConfig')?.addEventListener('click',openConfigImport);$('#health')?.addEventListener('click',runHealth);$('#backup')?.addEventListener('click',downloadBackup);$('#addUser')?.addEventListener('click',openUser)}

function dialog(title,fields,submitLabel,onSubmit){const d=document.createElement('dialog');d.className='dialog';d.innerHTML=`<form class="dialogbody"><div class="dialoghead"><h3>${esc(title)}</h3><button type="button" class="iconbtn" aria-label="關閉">×</button></div><div class="formgrid">${fields}</div><div class="actions" style="margin-top:18px"><button class="btn" type="submit">${esc(submitLabel)}</button><button class="btn ghost" type="button" data-cancel>取消</button></div></form>`;document.body.append(d);d.showModal();const close=()=>{d.close();d.remove()};$('.iconbtn',d).onclick=close;$('[data-cancel]',d).onclick=close;$('form',d).onsubmit=async e=>{e.preventDefault();try{await onSubmit(new FormData(e.currentTarget));close()}catch(err){toast(err.message||String(err))}};return d}
const field=(name,label,value='',type='text',extra='')=>`<div class="field ${type==='textarea'?'full':''}"><label for="f_${name}">${esc(label)}</label>${type==='textarea'?`<textarea id="f_${name}" name="${name}">${esc(value)}</textarea>`:`<input id="f_${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}>`}</div>`;
const select=(name,label,value,options)=>`<div class="field"><label for="f_${name}">${esc(label)}</label><select id="f_${name}" name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;

function openTalk(t={}){dialog(t.id?'編輯場次':'新增場次',field('date','日期',t.date,'date')+field('title','講題',t.title)+select('speakerId','講者',t.speakerId||'',[['','尚未安排'],...state.snapshot.speakers.map(s=>[s.id,s.name])])+field('room','教室',t.room||state.snapshot.config?.course?.room)+field('startTime','開始時間',t.startTime||state.snapshot.config?.schedule?.startTime,'time')+field('endTime','結束時間',t.endTime||state.snapshot.config?.schedule?.endTime,'time')+select('status','狀態',t.status||'planned',[['planned','規劃中'],['confirmed','已確認'],['completed','已完成'],['cancelled','已取消']])+field('notes','備註',t.notes,'textarea'),'儲存',fd=>saveEntity('talks',t,Object.fromEntries(fd)))}
function openSpeaker(s={}){dialog(s.id?'編輯講者':'新增講者',field('name','姓名',s.name,'text','required')+field('title','職稱',s.title)+field('organization','服務單位',s.organization)+field('email','Email',s.email,'email')+field('phone','電話',s.phone)+field('notes','備註',s.notes,'textarea'),'儲存',fd=>saveEntity('speakers',s,{...Object.fromEntries(fd),status:s.status||'active'}))}
function openTask(t={}){dialog(t.id?'編輯待辦':'新增待辦',field('title','待辦內容',t.title,'text','required')+field('dueDate','到期日',t.dueDate,'date')+select('talkId','連結場次',t.talkId||'',[['','不連結場次'],...state.snapshot.talks.map(x=>[x.id,x.title||x.date||'未命名場次'])])+select('status','狀態',t.status||'pending',[['pending','待處理'],['in_progress','處理中'],['done','已完成'],['cancelled','已取消']])+field('assigneeEmail','負責人 Email',t.assigneeEmail,'email')+field('notes','備註',t.notes,'textarea'),'儲存',fd=>saveEntity('tasks',t,Object.fromEntries(fd)))}
function openUser(){dialog('新增同網域使用者',field('email','學校 Email','','email','required')+select('role','角色','editor',[['editor','editor'],['owner','owner']]),'新增',fd=>saveEntity('users',{}, {...Object.fromEntries(fd),status:'active'}))}
function openConfigImport(){dialog('匯入課程設定',field('json','貼上已確認的 course.config.json','','textarea'),'驗證並匯入',async fd=>{const config=JSON.parse(fd.get('json'));await mutate(()=>gasCall('importCourseConfig',{baseRevision:state.snapshot.revision,config}),'課程設定已更新')})}
async function runHealth(){const out=$('#healthOut');out.hidden=false;out.textContent='檢查中…';try{out.textContent=JSON.stringify(await gasCall('healthCheck'),null,2)}catch(e){out.textContent=e.message||String(e)}}
function downloadBackup(){const payload={exportedAt:new Date().toISOString(),schemaVersion:1,revision:state.snapshot.revision,config:state.snapshot.config,speakers:state.snapshot.speakers,talks:state.snapshot.talks,tasks:state.snapshot.tasks};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`talk-course-manager-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('備份已下載')}
async function saveEntity(entity,current,data){const op=current.id?{entity,action:'update',id:current.id,version:current.version,data}:{entity,action:'create',id:uid(entity.slice(0,-1)),data};await mutate(()=>gasCall('saveBatch',{baseRevision:state.snapshot.revision,operations:[op]}),'已儲存')}
function bindCommon(){$$('[data-delete]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('確定要移除？資料會保留於稽核紀錄。'))return;const [entity,id,version]=b.dataset.delete.split(':');try{await mutate(()=>gasCall('saveBatch',{baseRevision:state.snapshot.revision,operations:[{entity,action:'delete',id,version:Number(version)}]}),'已移除')}catch(error){toast(error.message)}}))}

function renderInstall(who){setSync('尚未安裝','warn');$('#app').innerHTML=`${page('尚未完成安裝','請回到綁定的 Google Sheet 執行初始化')}<section class="card"><div class="notice warn"><b>需要 owner bootstrap</b><br>在試算表選單執行「Talk Course Manager → 初始化系統」，再重新部署或重新整理管理台。</div><pre class="code">${esc(JSON.stringify(who,null,2))}</pre></section>`}
function renderFatal(error){setSync('讀取失敗','danger');$('#app').innerHTML=`<div class="errorbox"><b>管理台無法啟動</b><p>${esc(error?.message||String(error))}</p><button class="btn secondary" onclick="location.reload()">重新整理</button></div>`}

boot();
