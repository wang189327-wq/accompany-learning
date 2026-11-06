const test = require('node:test');
const assert = require('node:assert/strict');
const { replaceRegion, scriptTags, androidStyles } = require('../build/html.cjs');
const { BROWSER_SCRIPTS, ANDROID_SCRIPTS } = require('../build/assets.cjs');

test('HTML区域可重复用于多平台，缺失或重复入口明确失败', () => {
  const html = '<!-- @build:styles:begin -->old<!-- @build:styles:end -->';
  const result = replaceRegion(html, 'styles', 'new');
  assert.equal(replaceRegion(result, 'styles', 'native').includes('native'), true);
  assert.throws(() => replaceRegion('', 'styles', ''), /区域/);
  assert.throws(() => replaceRegion(html + html, 'styles', ''), /区域/);
  assert.ok(scriptTags(['app.js']).includes('src="app.js"'));
});

test('平台脚本顺序及原安卓字号转换规则保持', () => {
  for (const names of [BROWSER_SCRIPTS, ANDROID_SCRIPTS]) {
    assert.equal(names.length, new Set(names).size);
    assert.ok(names.indexOf('library-views.js') < names.indexOf('study-ui.js'));
    assert.ok(names.indexOf('task-views.js') < names.indexOf('app.js'));
  }
  assert.ok(ANDROID_SCRIPTS.indexOf('android-client.js') < ANDROID_SCRIPTS.indexOf('app.js'));
  assert.equal(
    androidStyles('a{font-size:15px}b{font-size:20px}c{font-size: 30px}', 'header{}'),
    'a{font-size:15px}b{font-size:1.3333rem}c{font-size: 2.0000rem}\nheader{}',
  );
});
