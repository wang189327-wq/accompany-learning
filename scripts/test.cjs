'use strict';
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
function run(args){const r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});if(r.status!==0)process.exit(r.status||1);}
run(['cloud/mobile-file.cjs']);run(['android/prepare-assets.cjs']);
const tests=[];
for(const dir of ['cloud/tests','desktop-review','.','android','tests'])for(const file of fs.readdirSync(path.join(root,dir)))if(file.endsWith('.test.cjs')&&file!=='asset-paths.test.cjs')tests.push(path.join(dir,file));
run(['--test',...tests]);
for(const file of ['tests.cjs','extras-tests.cjs','android/tests.cjs'])run([file]);
