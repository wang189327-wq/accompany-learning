const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false,open:false,addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
 let state={phase:'available',currentName:'1.5.1',latest:{versionName:'1.5.1',notes:'新版说明'}},interval,checks=0,downloads=0,installs=0;const messages=[];
 const context=vm.createContext({document:{body:{insertAdjacentHTML(){}},getElementById:get,querySelector:()=>null},C9Android:{checkUpdate(){checks++;},updateState:()=>JSON.stringify(state),downloadUpdate(){downloads++;state={...state,phase:'downloading',done:0,total:100};},installUpdate(){installs++;}},setTimeout(){},setInterval(fn){interval=fn;return 1;},clearInterval(){},toast:v=>messages.push(v),Blob});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'android-client.js'),'utf8'),context);
 return {context,get,messages,get checks(){return checks;},get downloads(){return downloads;},get installs(){return installs;},async check(){await vm.runInContext('AndroidUpdates.check(true)',context);},tick(value){state={...state,...value};interval();}};
}
test('检查只提示新版本，用户点击才下载；下载完成才请求系统安装',async()=>{
 const f=fixture();await f.check();assert.equal(f.checks,1);assert.equal(f.downloads,0);assert.equal(f.get('updateDialog').open,true);assert.match(f.get('updateNotes').textContent,/新版说明/);
 f.get('downloadUpdate').onclick();assert.equal(f.downloads,1);assert.equal(f.installs,0);f.tick({phase:'downloading',done:50,total:100});assert.match(f.get('updateStatus').textContent,/50%/);f.tick({phase:'downloaded'});assert.equal(f.installs,1);assert.equal(f.get('downloadUpdate').textContent,'安装更新');
});
test('校验或网络失败不请求安装，允许重试',async()=>{
 const f=fixture();await f.check();f.get('downloadUpdate').onclick();f.tick({phase:'error',error:'安装包校验失败'});assert.equal(f.installs,0);assert.equal(f.get('downloadUpdate').disabled,false);assert.match(f.get('updateStatus').textContent,/校验失败/);
});
test('更新原生端限制固定HTTPS来源，检查SHA、包名、递增版本和原签名，使用只读私有文件URI',()=>{
 const native=fs.readFileSync(path.join(__dirname,'src/cn/c9/studyplan/UpdateManager.java'),'utf8'),provider=fs.readFileSync(path.join(__dirname,'src/cn/c9/studyplan/UpdateProvider.java'),'utf8');
 for(const text of ['HttpsURLConnection','setInstanceFollowRedirects(false)','SHA-256','next.packageName','version(next)<=version(current)','Arrays.equals(a[0].toByteArray(),b[0].toByteArray())','canRequestPackageInstalls()','FLAG_GRANT_READ_URI_PERMISSION'])assert.ok(native.includes(text),text);
 assert.ok(provider.includes('MODE_READ_ONLY'));assert.ok(provider.includes('getCanonicalPath()'));assert.ok(provider.includes('getCacheDir()'));
});
