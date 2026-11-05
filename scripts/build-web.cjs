'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const {apiEndpoint}=require('./config.cjs').readConfig();if(!apiEndpoint)throw Error('部署Netlify前请在public-config.local.json或C9_API_ENDPOINT中填写自己的HTTPS接口根地址');
 await require('../cloud/build.cjs').build();const out=path.join(__dirname,'../cloud/public');
 await fs.writeFile(path.join(out,'runtime-config.js'),'globalThis.C9_DEFAULT_ENDPOINT=location.origin;\n');
 await fs.writeFile(path.join(out,'_redirects'),'/api/* '+apiEndpoint+'/api/:splat 200\n/health '+apiEndpoint+'/health 200\n');
 await fs.copyFile(path.join(__dirname,'../deploy/netlify-headers.example'),path.join(out,'_headers'));
 console.log('Netlify发布目录：cloud/public。首次连接填写此网站地址及自己的访问码。');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
