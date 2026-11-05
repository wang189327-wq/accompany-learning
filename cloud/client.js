'use strict';
const Cloud=(()=>{
 let config,connectResolve=null,storageSaved=true,clockBase=Date.now(),clockTick=performance.now();
 let confirmed=false,pendingSnapshot=null;
 const mediaLinks=new Map();let mediaScope='';
 function stableMedia(data){const scope=cacheKey();if(mediaScope!==scope){mediaLinks.clear();mediaScope=scope;}const seen=new Set();const keep=file=>{if(!file.url)return;const key=file.key||file.uploadId;if(!key)return;seen.add(key);const old=mediaLinks.get(key);if(old&&old.until>Date.now()+30000)file.url=old.url;else {let until;try{until=Number(new URL(file.url).searchParams.get('Expires'))*1000;}catch{}mediaLinks.set(key,{url:file.url,until:until||Date.now()+240000});}};for(const r of data.records||[])for(const f of r.images||[])keep(f);for(const r of data.library||[])for(const f of r.files||[])keep(f);for(const key of mediaLinks.keys())if(!seen.has(key))mediaLinks.delete(key);return data;}
 const attachments=C9AttachmentCache.create();let scopeIdentity='',scopePromise=null;
 function attachmentScope(){const identity=JSON.stringify([config?.endpoint,config?.token]);if(identity!==scopeIdentity){scopeIdentity=identity;scopePromise=crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)).then(bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''));}return scopePromise;}
 const configKey='c9-cloud-connection-v1';
 const el=id=>document.getElementById(id);
 function time(){return clockBase+(performance.now()-clockTick);}
 function setTime(serverTime){if(!Number.isFinite(serverTime))return;clockBase=serverTime;clockTick=performance.now();}
 async function request(path,{method='GET',body,role,raw=false}={}){
  if(!config)throw Error('请先配置云端连接');if(method!=='GET'&&!confirmed)throw Error('正在同步云端，请稍后再保存；离线时可查看已缓存内容');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  try{let res;try{res=await fetch(config.endpoint+path,{method,headers:{Authorization:'Bearer '+config.token,...(role?{'X-C9-Role':role}:{}),...(body&&!raw?{'Content-Type':'application/json'}:{})},body:body?(raw?body:JSON.stringify(body)):undefined,signal:controller.signal});}catch(e){throw Error('网络连接失败，作业尚未确认保存，请保留页面后重试');}
   if(!res.ok){let message='云端请求失败（'+res.status+'）';try{message=(await res.json()).error||message;}catch{}const err=Error(message);err.status=res.status;throw err;}
   return await(raw&&method==='GET'?res.blob():res.json());
  }finally{clearTimeout(timer);}
 }
 function dialog(){const d=el('connectionDialog');el('apiEndpoint').value=config?.endpoint||globalThis.C9_DEFAULT_ENDPOINT||(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1'?location.origin:'');el('connectionToken').value=config?.token||'';el('connectionError').textContent='';if(!d.open)d.showModal();}
 async function connect(){
  try{config=JSON.parse(localStorage.getItem(configKey));}catch{config=null;}
  if(config?.endpoint&&config?.token)return;
  await new Promise(resolve=>{connectResolve=resolve;dialog();});
 }
 async function applyConfig(){
  const endpoint=el('apiEndpoint').value.trim().replace(/\/+$/,'');const url=new URL(endpoint);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('请填写 HTTPS 地址');if(url.username||url.password||url.search||url.hash)throw Error('接口地址不能包含账号或查询参数');
  const token=el('connectionToken').value.trim();if(token.length<32)throw Error('访问码至少需要 32 个字符');const previous=config;config={endpoint,token};try{await request('/api/check');const data=await request('/api/snapshot');setTime(data.serverTime);confirmed=true;try{localStorage.setItem(cacheKey(),JSON.stringify(data));}catch{}}catch(e){config=previous;throw e;}try{localStorage.setItem(configKey,JSON.stringify(config));storageSaved=true;}catch{storageSaved=false;}el('connectionDialog').close();
 }
 function updateWidget(role,tasks,records){try{if(typeof C9Android==='undefined'||!C9Android.widgetConfigure||!config||!role)return;C9Android.widgetConfigure(config.endpoint,config.token,role);if(confirmed)C9Android.widgetSnapshot(JSON.stringify({tasks:tasks.filter(t=>!TaskModel.historyHidden(t)).map(t=>({id:t.id,name:t.name,kind:t.kind,rule:t.rule,created:t.created,enabled:t.enabled,deletedAt:t.deletedAt,format:t.format,disabledAt:t.disabledAt||t.updated||t.created,availableFrom:t.availableFrom,deadline:t.deadline,weekDays:t.weekDays,pausedRounds:t.pausedRounds,roundNotes:t.roundNotes})),records:records.map(r=>({taskId:r.taskId,taskName:r.taskName,round:r.round,completed:r.completed,late:r.late}))}));}catch{}}
 function cacheKey(){let h=2166136261;for(const c of config?.token||'')h=Math.imul(h^c.charCodeAt(0),16777619);return 'c9-snapshot:'+config?.endpoint+':'+(h>>>0);}
 function cached(){try{const value=JSON.parse(localStorage.getItem(cacheKey()));return value&&Array.isArray(value.tasks)&&Array.isArray(value.records)?value:null;}catch{return null;}}
 function showSync(text){let el=document.getElementById('syncStatus');if(!el){el=document.createElement('div');el.id='syncStatus';el.setAttribute('role','status');document.body.append(el);}el.textContent=text;el.hidden=!text;}
 async function loadSnapshot(){showSync('正在同步…');try{const previous=cached(),since=Number(previous?.serverTime),path=Number.isSafeInteger(since)&&since>0?'/api/snapshot?since='+encodeURIComponent(since):'/api/snapshot';let data=stableMedia(await request(path));if(data.recordsPartial&&previous){const records=new Map(previous.records.map(record=>[record.id,record]));for(const record of data.records)records.set(record.id,record);data.records=[...records.values()];}else if(data.recordsPartial){data=stableMedia(await request('/api/snapshot'));}delete data.recordsPartial;setTime(data.serverTime);confirmed=true;try{localStorage.setItem(cacheKey(),JSON.stringify(data));}catch{}showSync('');return data;}catch(e){showSync('当前为缓存内容 · 同步失败，请检查网络');throw e;}}
 async function snapshot(){if(pendingSnapshot)return pendingSnapshot;pendingSnapshot=loadSnapshot().finally(()=>pendingSnapshot=null);return pendingSnapshot;}
 async function upload(blob,taskId,kind,name,onProgress){
  const session=await request('/api/uploads',{method:'POST',role:'student',body:{taskId,kind,name,size:blob.size,contentType:blob.type||'application/octet-stream'}});
  const parts=[];for(let offset=0,number=1;offset<blob.size;offset+=session.chunkSize,number++){
   const chunk=blob.slice(offset,offset+session.chunkSize);let saved;
   for(let attempt=0;attempt<3;attempt++){try{saved=await request('/api/uploads/'+session.uploadId+'/parts/'+number,{method:'POST',role:'student',body:chunk,raw:true});break;}catch(e){if(e.status&&e.status<500||attempt===2)throw e;}}
   parts.push(saved);onProgress?.(Math.min(offset+session.chunkSize,blob.size),blob.size);
  }
  return request('/api/uploads/'+session.uploadId+'/complete',{method:'POST',role:'student',body:{parts}});
 }
 async function submit(record,revision,context){
  const attachments=record.format==='file'?record.files:record.images;const binary=record.format==='image'||record.format==='file';const files=binary?attachments.map(x=>x.blob):[];
  const same=context.cached&&context.cached.text===record.text&&files.length===context.cached.files.length&&files.every((f,i)=>f===context.cached.files[i]);
  if(!same)context.cached={text:record.text,files,uploads:[]};
  const cache=context.cached;const count=binary?files.length:1;
  for(let i=cache.uploads.length;i<count;i++){
   const blob=binary?files[i]:new Blob([record.text],{type:'text/plain'});
   const name=binary?attachments[i].name:'作业内容.txt';
   cache.uploads.push(await upload(blob,record.taskId,binary?record.format:'text',name,(done,total)=>{el('submitButton').textContent='正在上传 '+(i+1)+'/'+count+' · '+Math.round(done/total*100)+'%';}));
  }
  const saved=await request('/api/submissions',{method:'POST',role:'student',body:{taskId:record.taskId,taskRevision:revision,round:record.round,requestId:context.requestId,selfScore:record.selfScore,uploadIds:cache.uploads.map(x=>x.uploadId)}});Object.assign(record,saved);return saved;
 }
 async function uploadLibrary(blob,libraryType,who,onProgress){
  const session=await request('/api/uploads',{method:'POST',role:who,body:{scope:'library',libraryType,name:blob.name,size:blob.size,contentType:blob.type||'application/octet-stream'}});
  const parts=[];for(let offset=0,n=1;offset<blob.size;offset+=session.chunkSize,n++){
   let part;for(let attempt=0;attempt<3;attempt++){try{part=await request('/api/uploads/'+session.uploadId+'/parts/'+n,{method:'POST',role:who,body:blob.slice(offset,offset+session.chunkSize),raw:true});break;}catch(e){if(e.status&&e.status<500||attempt===2)throw e;}}
   parts.push(part);onProgress?.(Math.min(offset+session.chunkSize,blob.size),blob.size);
  }
  const saved=await request('/api/uploads/'+session.uploadId+'/complete',{method:'POST',role:who,body:{parts}});return {uploadId:saved.uploadId};
 }
 async function fileBlob(uploadId,onStatus){const scope=await attachmentScope();return attachments.get(scope,'file:'+uploadId,async()=>{if(scope!==await attachmentScope())throw Error('连接已切换，请重新打开资料');return request('/api/files/'+encodeURIComponent(uploadId),{raw:true});},onStatus);}
 async function imageBlob(uploadId){return attachments.get(await attachmentScope(),'image:'+uploadId,()=>request('/api/images/'+encodeURIComponent(uploadId),{raw:true}));}
 document.addEventListener('click',e=>{if(e.target.closest('#connectionSettings,#reconnect'))dialog();});
 el('connectionForm').onsubmit=async e=>{e.preventDefault();const button=el('connectionForm').querySelector('button[type="submit"]');button.disabled=true;button.textContent='正在连接…';try{await applyConfig();if(connectResolve){const resolve=connectResolve;connectResolve=null;resolve();}else document.dispatchEvent(new Event('c9-connected'));}catch(err){el('connectionError').textContent=err.message;}finally{button.disabled=false;button.textContent='连接并保存';}};
 el('connectionDialog').addEventListener('cancel',e=>{if(!config)e.preventDefault();});
 return {attachmentScope,attachmentCacheStats:attachments.stats,flushAttachmentCache:attachments.flush,updateWidget,cached,showSync,connect,snapshot,request,time,submit,imageBlob,uploadLibrary,fileBlob,get storageSaved(){return storageSaved;}};
})();
