'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path');
const { build } = require('./build.cjs');
const { BROWSER_SCRIPTS } = require('../build/assets.cjs');
async function makeMobile() {
  await build();
  const publicDir = path.join(__dirname, 'public');
  let html = await fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
  for (const name of BROWSER_SCRIPTS) {
    const source = await fs.readFile(path.join(publicDir, name), 'utf8');
    html = html.replace(
      '<script src="' + name + '"></script>',
      '<script>\n' + source.replace(/<\/script/gi, '<\\/script') + '\n</script>',
    );
  }
  if (/<script\b[^>]*\bsrc=/i.test(html)) throw Error('手机文件仍有外部脚本依赖');
  await fs.mkdir(path.join(__dirname, 'release'), { recursive: true });
  await fs.writeFile(path.join(__dirname, 'release', 'Accompany Learning手机测试版.html'), html);
  return html;
}
if (require.main === module)
  makeMobile()
    .then(() => console.log('手机单文件测试版已生成'))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
module.exports = { makeMobile };
