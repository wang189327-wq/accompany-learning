'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {build}=require('../cloud/build.cjs');
async function prepare(){
 await build();
 const assets=path.join(__dirname,'build/assets');await fs.mkdir(assets,{recursive:true});
 for(const name of ['pdf.mjs','pdf.worker.mjs'])await fs.copyFile(path.join(__dirname,'../',name),path.join(assets,name));
 for(const name of ['pdf-cmaps','pdf-fonts','pdf-wasm'])await fs.cp(path.join(__dirname,'../',name),path.join(assets,name),{recursive:true});
 await fs.cp(path.join(__dirname,'../third-party-notices'),path.join(assets,'third-party-notices'),{recursive:true});
 for(const name of ['my-model.js','my-page.js','font-settings.js','background-settings.js','pull-refresh.js','attachment-cache.js','runtime-config.js','index.html','startup-watch.js','model.js','cloud-client.js','study-model.js','study-ui.js','task-order.js','image-zoom.js','file-viewer.js','zip-reader.js','docx-reader.js','app.js']){
  let source=await fs.readFile(path.join(__dirname,'../cloud/public',name),'utf8');
  if(name==='index.html'){
   source=source.replaceAll('伴学记录','伴学记录').replace('电脑端保存到下载目录；安卓相册保存将在 APK 版本接入。','点击“手动保存图片”后才会保存到手机相册。').replace('<script src="app.js"></script>','<script src="android-client.js"></script><script src="app.js"></script>');
   source=source.replace(/font-size:(\d+)px/g,(value,size)=>Number(size)===15?value:'font-size:'+(Number(size)/15).toFixed(4)+'rem');
   source=source.replace('</style>','header{flex-wrap:wrap}header>div:first-child{flex:1 0 100%}@media(min-width:640px){header>div:first-child{flex:1 1 auto}}</style>');
  }
  if(name==='app.js')source=source.replaceAll('伴学记录','伴学记录').replace("'两个人，一起把事情完成'+' · 双人同步'","'两个人，一起把事情完成'").replace(/function download\(blob,name\)\{[^\n]+\}/,'async function download(blob,name){return AndroidPhotos.save(blob,name);}').replace("download(await Cloud.imageBlob(im.uploadId),im.name||'作业图片.jpg');","await download(await Cloud.imageBlob(im.uploadId),im.name||'作业图片.jpg');");
  await fs.writeFile(path.join(assets,name),source);
 }
 const config=require('../scripts/config.cjs').readConfig();
 await fs.writeFile(path.join(__dirname,'src/cn/c9/studyplan/PublicConfig.java'),'package cn.c9.studyplan;\nfinal class PublicConfig { static final String UPDATE_MANIFEST_URL='+JSON.stringify(config.updateManifestUrl)+'; }\n');
 await fs.copyFile(path.join(__dirname,'android-client.js'),path.join(assets,'android-client.js'));
}
if(require.main===module)prepare().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={prepare};
