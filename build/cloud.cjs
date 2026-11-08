'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { assembleRuntime } = require('../cloud/runtime-builder.cjs');
const { readConfig } = require('../scripts/config.cjs');
const { BROWSER_SCRIPTS, SHARED_SCRIPTS, RESOURCE_DIRECTORIES } = require('./assets.cjs');
const { replaceRegion, scriptTags } = require('./html.cjs');

async function build() {
  const root = path.resolve(__dirname, '..');
  const cloud = path.join(root, 'cloud');
  const out = path.join(cloud, 'public');
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(
    path.join(cloud, 'static-assets.json'),
    JSON.stringify(require('./asset-manifest.cjs').cloudMap(), null, 2) + '\n',
  );
  const config = readConfig();
  await fs.writeFile(
    path.join(out, 'runtime-config.js'),
    `globalThis.C9_DEFAULT_ENDPOINT=${JSON.stringify(config.apiEndpoint)};\n`,
  );
  await fs.copyFile(path.join(cloud, 'client.js'), path.join(out, 'cloud-client.js'));
  await fs.copyFile(path.join(cloud, 'startup-watch.js'), path.join(out, 'startup-watch.js'));

  for (const name of ['pdf.mjs', 'pdf.worker.mjs', ...SHARED_SCRIPTS]) {
    await fs.copyFile(path.join(root, name), path.join(out, name));
  }
  for (const name of RESOURCE_DIRECTORIES) {
    await fs.cp(path.join(root, name), path.join(out, name), { recursive: true });
  }
  // Backend and browser use the same business model source.
  for (const name of ['model.js', 'study-model.js', 'my-model.js', 'assignment-groups.js']) {
    await fs.copyFile(path.join(root, name), path.join(cloud, name));
  }

  const app = await assembleRuntime(await fs.readFile(path.join(root, 'app.js'), 'utf8'), (name) =>
    fs.readFile(path.join(cloud, `runtime-${name}.js`), 'utf8'),
  );
  await fs.writeFile(path.join(out, 'app.js'), app);

  let html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const styles = await fs.readFile(path.join(root, 'styles.css'), 'utf8');
  const connection = await fs.readFile(path.join(cloud, 'templates/connection.html'), 'utf8');
  html = replaceRegion(html, 'styles', '<style>' + styles + '</style>');
  html = replaceRegion(html, 'connection', connection);
  html = replaceRegion(html, 'scripts', scriptTags(BROWSER_SCRIPTS));
  html = replaceRegion(
    html,
    'loading',
    '正在启动学习计划… 如果此提示一直不变且按钮没有反应，说明界面脚本未加载，请使用完整界面文件或手机测试版。',
  );
  html = html.replace(/<title>[^<]*<\/title>/, '<title>伴学记录</title>');
  await fs.writeFile(path.join(out, 'index.html'), html);
}

module.exports = { build };
