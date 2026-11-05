'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
(async()=>{
 const [file,origin,versionName,code]=process.argv.slice(2);if(!file||!origin||!/^\d+(\.\d+)*$/.test(versionName||'')||!Number.isSafeInteger(Number(code))||Number(code)<1)throw Error('用法：node scripts/make-update.cjs 安装包路径 https://自己的更新站点 版本名 内部版本号');
 const uri=new URL(origin);if(uri.protocol!=='https:'||uri.pathname!=='/'||uri.port||uri.username||uri.password||uri.search||uri.hash)throw Error('更新站点需要HTTPS根地址');
 const bytes=await fs.readFile(file),out=path.join(__dirname,'../cloud/public/updates');await fs.mkdir(out,{recursive:true});const name='banxue-record-v'+versionName+'.apk';await fs.writeFile(path.join(out,name),bytes);
 const value={versionName,versionCode:Number(code),url:uri.origin+'/updates/'+name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),notes:'伴学记录更新'};await fs.writeFile(path.join(out,'latest.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
