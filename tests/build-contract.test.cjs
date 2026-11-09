const test = require('node:test');
const assert = require('node:assert/strict');
const { replaceRegion, scriptTags, androidStyles } = require('../build/html.cjs');
const { BROWSER_SCRIPTS, ANDROID_SCRIPTS } = require('../build/assets.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { cloudMap, javaSource } = require('../build/asset-manifest.cjs');

test('云端路由、HTML与原生白名单从同一脚本清单生成', () => {
  const generated = require('../cloud/static-assets.json');
  assert.deepEqual(generated, cloudMap());
  for (const script of BROWSER_SCRIPTS) assert.equal(generated['/' + script], script);
  const java = fs.readFileSync(
    path.join(__dirname, '../android/src/app/accompany/learning/AssetList.java'),
    'utf8',
  );
  assert.equal(java, javaSource());
  assert.ok(
    fs
      .readFileSync(
        path.join(__dirname, '../android/src/app/accompany/learning/MainActivity.java'),
        'utf8',
      )
      .includes('ASSETS = AssetList.NAMES'),
  );
});

test('安卓原生资源白名单覆盖构建清单中的全部脚本', () => {
  const java = fs.readFileSync(
    path.join(__dirname, '../android/src/app/accompany/learning/AssetList.java'),
    'utf8',
  );
  const block = java.match(/NAMES = new HashSet<>\(Arrays\.asList\(([\s\S]*?)\)\);/);
  assert.ok(block, '原生白名单定义必须可检查');
  const allowed = new Set([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const missing = ANDROID_SCRIPTS.filter((name) => !allowed.has(name));
  assert.deepEqual(missing, [], '新增脚本必须同步安卓 shouldInterceptRequest 白名单');
});

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
