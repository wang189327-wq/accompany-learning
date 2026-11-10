'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..'),
  git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
if (git.status !== 0) throw Error('请在Git仓库内运行公开检查');
const paths = [...new Set(git.stdout.split('\0').filter(Boolean))],
  issues = [];
for (const rel of paths) {
  if (
    /(^|\/)(push\.local\.properties|local\.properties)$/.test(rel) ||
    /^android\/push\/(generated-res|build|\.gradle)\//.test(rel) ||
    /(^|\/)(node_modules|signing|tools|local-data|\.netlify)\//.test(rel) ||
    /\.(p12|pfx|jks|keystore|pem|key|apk)$/.test(rel) ||
    /(^|\/)(credentials\.json|review-worker\.json|public-config\.local\.json|\.env)$/.test(rel)
  ) {
    issues.push({ file: rel, reason: 'Private/generated artifact in publish tree' });
    continue;
  }
  const bytes = fs.readFileSync(path.join(root, rel));
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  for (const [reason, pattern] of [
    [
      'Potential GitHub credential',
      /\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b/,
    ],
    ['Potential cloud access key', /\bLTAI[A-Za-z0-9]{16,}\b/],
    ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['Personal machine path', /[A-Z]:\\(?:Users|Documents|software development)\\/],
    ['Hardcoded deployed API host', /https:\/\/[a-z0-9-]+\.(?:cn-[a-z0-9-]+\.)?fcapp\.run/],
    ['Hardcoded deployed Netlify host', /https:\/\/[a-z0-9-]+\.netlify\.app/],
  ])
    if (pattern.test(text)) issues.push({ file: rel, reason });
}
if (issues.length) {
  console.error(JSON.stringify({ passed: false, issues }, null, 2));
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      passed: true,
      filesChecked: paths.length,
      note: 'Pattern checks plus manual review; never a guarantee that every possible secret is detected.',
    }),
  );
