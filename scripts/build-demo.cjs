'use strict';
/*
 * 生成 docs/demo/index.html。
 *
 * 演示页不另外维护一份界面，直接由根目录 index.html 改写得到，避免两份 HTML 走样。
 * 改写只有三件事：资源路径退两级、去掉 app.js 的两个启动脚本、末尾接上 demo-boot.js。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'index.html');
const outDir = path.join(root, 'docs/demo');
const outFile = path.join(outDir, 'index.html');
const bootScripts = ['app.js', 'pull-refresh.js'];

function build() {
  let html = fs.readFileSync(source, 'utf8');

  html = html.replace(/(href|src)="(?!https?:|\.\.\/|\/)([^"]+)"/g, (all, attr, value) => {
    return attr + '="../../' + value + '"';
  });

  let removed = 0;
  for (const name of bootScripts) {
    const tag = new RegExp('\\s*<script src="\\.\\./\\.\\./' + name + '"></script>');
    if (tag.test(html)) {
      html = html.replace(tag, '');
      removed += 1;
    }
  }

  html = html.replace(
    /^(\s*)<!-- @build:scripts:end -->/m,
    '$1<script src="./demo-boot.js"></script>\n$1<!-- @build:scripts:end -->',
  );

  html = html.replace(/<title>[^<]*<\/title>/, '<title>伴学记录 · 交互演示</title>');
  html = html.replace(
    /(<meta name="viewport" content="[^"]*" \/>)/,
    '$1\n    <meta name="robots" content="noindex" />',
  );

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html);
  return { removed, bytes: Buffer.byteLength(html) };
}

if (require.main === module) {
  const result = build();
  const missing = bootScripts.length - result.removed;
  console.log('已生成 docs/demo/index.html，' + result.bytes + ' 字节');
  if (missing > 0) {
    console.error('有 ' + missing + ' 个启动脚本没有找到，请检查 index.html 的 script 标签');
    process.exitCode = 1;
  }
}

module.exports = { build };
