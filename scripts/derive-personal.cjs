'use strict';
// 自用版本只改变品牌和地址配置；业务代码从同一份公开工程复制。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readConfig } = require('./config.cjs');
const root = path.resolve(__dirname, '..');
const info = require('../project-info.json');
function derive(destination, configPath) {
  const out = path.resolve(destination);
  if (out === root || out.startsWith(root + path.sep) || fs.existsSync(out))
    throw Error('派生目录必须位于工程之外，且尚未存在');
  const config = readConfig(process.env, configPath ? path.resolve(configPath) : undefined);
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    },
  )
    .split('\0')
    .filter(Boolean);
  const manifest = [];
  for (const rel of [...new Set(files)].sort()) {
    const source = path.join(root, rel),
      target = path.join(out, rel);
    if (/\.(p12|jks|keystore|key)$/.test(rel) || /(^|\/)(signing|node_modules)\//.test(rel))
      throw Error('公开源码清单含私有或生成内容');
    let bytes = fs.readFileSync(source);
    if (
      !bytes.includes(0) &&
      /\.(js|cjs|md|html|json|xml|java|ps1|yml|txt)$/.test(rel) &&
      !/^(third-party-notices|pdf-)|^(docx-reader|zip-reader|pdf)/.test(rel)
    ) {
      let text = bytes.toString('utf8');
      if (!['project-info.json', 'scripts/derive-personal.cjs'].includes(rel))
        text = text.replaceAll(info.displayName, info.personalDisplayName);
      if (
        ['android/src/cn/c9/studyplan/UpdateManager.java', 'scripts/make-update.cjs'].includes(rel)
      )
        text = text.replaceAll(info.publicUpdatePrefix, info.personalUpdatePrefix);
      bytes = Buffer.from(text);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    manifest.push({ path: rel, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  fs.writeFileSync(path.join(out, 'public-config.local.json'), JSON.stringify(config, null, 2));
  const origin = {
    variant: 'personal',
    upstream: info.repository,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    sourceFiles: manifest.length,
    manifest,
  };
  fs.writeFileSync(path.join(out, 'personal-origin.json'), JSON.stringify(origin, null, 2));
  return { destination: out, sourceCommit: origin.sourceCommit, files: manifest.length };
}
if (require.main === module) {
  try {
    if (!process.argv[2])
      throw Error('用法：node scripts/derive-personal.cjs 新目录 [自己的配置JSON]');
    console.log(JSON.stringify(derive(process.argv[2], process.argv[3])));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { derive };
