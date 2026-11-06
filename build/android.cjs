'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('./cloud.cjs');
const { readConfig } = require('../scripts/config.cjs');
const { ANDROID_SCRIPTS, RESOURCE_DIRECTORIES } = require('./assets.cjs');
const { replaceRegion, scriptTags, androidStyles } = require('./html.cjs');

async function prepare() {
  await build();
  const root = path.resolve(__dirname, '..');
  const android = path.join(root, 'android');
  const publicDir = path.join(root, 'cloud/public');
  const assets = path.join(android, 'build/assets');
  await fs.mkdir(assets, { recursive: true });
  for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
    await fs.copyFile(path.join(root, name), path.join(assets, name));
  }
  for (const name of RESOURCE_DIRECTORIES) {
    await fs.cp(path.join(root, name), path.join(assets, name), { recursive: true });
  }
  for (const name of ANDROID_SCRIPTS) {
    const source =
      name === 'android-client.js' ? path.join(android, name) : path.join(publicDir, name);
    await fs.copyFile(source, path.join(assets, name));
  }
  const sharedCss = await fs.readFile(path.join(root, 'styles.css'), 'utf8');
  const nativeCss = await fs.readFile(path.join(android, 'styles.css'), 'utf8');
  let html = await fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
  html = replaceRegion(
    html,
    'styles',
    '<style>' + androidStyles(sharedCss, nativeCss) + '</style>',
  );
  html = replaceRegion(html, 'scripts', scriptTags(ANDROID_SCRIPTS));
  await fs.writeFile(path.join(assets, 'index.html'), html);

  const config = readConfig();
  await fs.writeFile(
    path.join(android, 'src/cn/c9/studyplan/PublicConfig.java'),
    'package cn.c9.studyplan;\nfinal class PublicConfig { static final String UPDATE_MANIFEST_URL=' +
      JSON.stringify(config.updateManifestUrl) +
      '; }\n',
  );
}

module.exports = { prepare };
