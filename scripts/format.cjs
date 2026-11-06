'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const prettier = require('prettier');

async function main() {
  const root = path.resolve(__dirname, '..');
  const check = process.argv.includes('--check');
  const paths = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  )
    .split('\0')
    .filter(Boolean);
  const extensions = new Set([
    '.js',
    '.cjs',
    '.mjs',
    '.json',
    '.css',
    '.html',
    '.md',
    '.yml',
    '.yaml',
  ]);
  const pending = [];
  let scanned = 0;
  for (const relative of new Set(paths)) {
    if (!extensions.has(path.extname(relative))) continue;
    const file = path.join(root, relative);
    const info = await prettier.getFileInfo(file, {
      ignorePath: path.join(root, '.prettierignore'),
    });
    if (info.ignored || !info.inferredParser) continue;
    const source = await fs.readFile(file, 'utf8');
    const config = await prettier.resolveConfig(file);
    const formatted = await prettier.format(source, { ...config, filepath: file });
    scanned++;
    if (source === formatted) continue;
    pending.push(relative);
    if (!check) await fs.writeFile(file, formatted);
  }
  console.log(JSON.stringify({ check, scanned, changed: pending.length, files: pending }));
  if (check && pending.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
