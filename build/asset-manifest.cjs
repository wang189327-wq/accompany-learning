'use strict';
const { BROWSER_SCRIPTS, ANDROID_SCRIPTS } = require('./assets.cjs');
function cloudMap() {
  return Object.fromEntries([
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ...[...BROWSER_SCRIPTS, 'pdf.mjs', 'pdf.worker.mjs'].map((name) => ['/' + name, name]),
  ]);
}
function javaSource() {
  const names = [...new Set(['index.html', ...ANDROID_SCRIPTS, 'pdf.mjs', 'pdf.worker.mjs'])];
  return (
    '// Generated from build/assets.cjs; do not edit.\npackage app.accompany.learning;\n' +
    'import java.util.Arrays;\nimport java.util.HashSet;\nimport java.util.Set;\n' +
    'final class AssetList { static final Set<String> NAMES = new HashSet<>(Arrays.asList(\n' +
    names.map((name) => '    ' + JSON.stringify(name)).join(',\n') +
    '\n)); }\n'
  );
}
module.exports = { cloudMap, javaSource };
