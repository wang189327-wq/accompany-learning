const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('README/部署文档的本地链接均存在，部署包及变量名称与源码匹配',()=>{
 const root=path.join(__dirname,'..'),files=['README.md',...fs.readdirSync(path.join(root,'docs')).filter(n=>n.endsWith('.md')).map(n=>'docs/'+n)];
 for(const name of files){const full=path.join(root,name),text=fs.readFileSync(full,'utf8');for(const m of text.matchAll(/\]\(([^)]+)\)/g)){if(/^(https?:|#)/.test(m[1]))continue;assert.ok(fs.existsSync(path.resolve(path.dirname(full),m[1].split('#')[0])),name+': '+m[1]);}}
 const doc=fs.readFileSync(path.join(root,'docs/DEPLOY_ALIYUN.md'),'utf8'),pack=fs.readFileSync(path.join(root,'cloud/package.cjs'),'utf8');for(const name of ['伴学记录云端接口部署包.zip','伴学记录云端界面.zip','伴学记录自动备份函数.zip'])assert.ok(doc.includes(name)&&pack.includes(name),name);
 const example=JSON.parse(fs.readFileSync(path.join(root,'cloud/environment.example.json'),'utf8'));for(const key of Object.keys(example))assert.ok(doc.includes(key),key);
});
