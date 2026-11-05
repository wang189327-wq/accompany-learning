'use strict';
globalThis.C9Boot={started:false,fail(){const app=document.getElementById('app');if(!this.started&&app)app.innerHTML='<div class="card"><h2>界面没有成功启动</h2><p>请使用完整的界面文件，或打开“C9手机测试版.html”。只下载一个普通 index.html 会缺少配套脚本。</p><p>如果浏览器仅提供文件预览且按钮不可点击，请改用允许运行网页的方式打开，或使用后续安卓安装包。</p></div>';}};
globalThis.addEventListener('error',()=>globalThis.C9Boot.fail());
setTimeout(()=>globalThis.C9Boot.fail(),8000);
