const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{collect}=require('../package.cjs');
test('云端运行包保留依赖源码，跳过Windows/Linux不一致的.bin命令快捷方式',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'banxue-pack-'));try{await fs.mkdir(path.join(dir,'.bin'));await fs.writeFile(path.join(dir,'.bin','unused-cli'),'shim');await fs.writeFile(path.join(dir,'runtime.js'),'module.exports=1');
  if(process.platform!=='win32')await fs.symlink('../runtime.js',path.join(dir,'.bin','runtime-link'));
  const files=await collect(dir,'node_modules/');assert.deepEqual(files.map(x=>x.name),['node_modules/runtime.js']);assert.equal(files[0].bytes.toString(),'module.exports=1');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('打包器仍拒绝.bin之外的未知符号链接',{skip:process.platform==='win32'},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'banxue-pack-link-'));try{await fs.writeFile(path.join(dir,'runtime.js'),'test');await fs.symlink('runtime.js',path.join(dir,'unexpected.js'));await assert.rejects(collect(dir,'node_modules/'),/不允许符号链接/);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
