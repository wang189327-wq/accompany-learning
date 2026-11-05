'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {assembleRuntime}=require('./runtime-builder.cjs');
async function build(){
 const root=path.dirname(__dirname),out=path.join(__dirname,'public');await fs.mkdir(out,{recursive:true});
 const config=require('../scripts/config.cjs').readConfig();await fs.writeFile(path.join(out,'runtime-config.js'),'globalThis.C9_DEFAULT_ENDPOINT='+JSON.stringify(config.apiEndpoint)+';\n');await fs.copyFile(path.join(__dirname,'client.js'),path.join(out,'cloud-client.js'));await fs.copyFile(path.join(__dirname,'startup-watch.js'),path.join(out,'startup-watch.js'));
 for(const name of ['pdf.mjs','pdf.worker.mjs'])await fs.copyFile(path.join(root,name),path.join(out,name));
 for(const name of ['pdf-cmaps','pdf-fonts','pdf-wasm'])await fs.cp(path.join(root,name),path.join(out,name),{recursive:true});
 await fs.cp(path.join(root,'third-party-notices'),path.join(out,'third-party-notices'),{recursive:true});
 for(const name of ['my-model.js','my-page.js','font-settings.js','background-settings.js','pull-refresh.js','attachment-cache.js','study-model.js','study-ui.js','task-order.js','image-zoom.js','file-viewer.js','zip-reader.js','docx-reader.js']){const bytes=await fs.readFile(path.join(root,name));await fs.writeFile(path.join(out,name),bytes);if(['study-model.js','my-model.js'].includes(name))await fs.writeFile(path.join(__dirname,name),bytes);}
 const model=await fs.readFile(path.join(root,'model.js'),'utf8');await fs.writeFile(path.join(__dirname,'model.js'),model);await fs.writeFile(path.join(out,'model.js'),model);
 let app=await assembleRuntime(await fs.readFile(path.join(root,'app.js'),'utf8'),name=>fs.readFile(path.join(__dirname,'runtime-'+name+'.js'),'utf8'));
 // These presentation-only substitutions retain local/cloud wording; all
 // executable adapters have explicit, validated source regions above.
 app=app.replaceAll('伴学记录 · 本机测试版','伴学记录').replaceAll('发布历史与成果','历史任务');
 await fs.writeFile(path.join(out,'app.js'),app);
 let html=await fs.readFile(path.join(root,'index.html'),'utf8');
 const styles=await fs.readFile(path.join(root,'styles.css'),'utf8');html=html.replace(/<style>[\s\S]*?<\/style>/,()=>'<style>'+styles+'</style>');
 // Settings controls are already present in the My page.
 const dialog='<dialog id="connectionDialog"><div class="dialogHead"><h3>连接学习计划</h3></div><form id="connectionForm"><label>云端地址<input id="apiEndpoint" type="url" required placeholder="https://你的云端接口地址"></label><label>访问码<input id="connectionToken" type="password" required autocomplete="off" placeholder="首次配置时填写"></label><div id="connectionError" class="error"></div><button type="submit" class="primary">连接并保存</button></form></dialog>';
 html=html.replace('<script src="model.js"></script><script src="attachment-cache.js"></script>',dialog+'<script src="model.js"></script><script src="attachment-cache.js"></script><script src="cloud-client.js"></script>');
 html=html.replace(/<dialog id="localConnectionDialog">[\s\S]*?<\/dialog>/,'');
 html=html.replace('伴学记录 · 本机测试版','伴学记录');
 html=html.replace('正在加载本地数据…','正在启动学习计划… 如果此提示一直不变且按钮没有反应，说明界面脚本未加载，请使用完整界面文件或手机测试版。');
 html=html.replace('<script src="model.js"></script>','<script src="runtime-config.js"></script><script src="startup-watch.js"></script><script src="model.js"></script>');
 await fs.writeFile(path.join(out,'index.html'),html);
}
if(require.main===module)build().then(()=>console.log('云端界面已生成')).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={build};
