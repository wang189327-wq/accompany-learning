'use strict';
const fs = require('node:fs'),
  path = require('node:path');
function secureURL(value, name) {
  if (!value) return '';
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw Error(name + '必须为不含凭据、端口、查询或片段的HTTPS地址');
  if (name === 'apiEndpoint' && url.pathname !== '/') throw Error('apiEndpoint需要填写接口根地址');
  if (name === 'updateManifestUrl' && !url.pathname.endsWith('/latest.json'))
    throw Error('更新地址必须以/latest.json结尾');
  return name === 'apiEndpoint' ? url.origin : url.href;
}
function readConfig(
  env = process.env,
  configPath = path.join(__dirname, '../public-config.local.json'),
) {
  let local = {};
  try {
    local = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return {
    apiEndpoint: secureURL(env.C9_API_ENDPOINT ?? local.apiEndpoint ?? '', 'apiEndpoint'),
    updateManifestUrl: secureURL(
      env.C9_UPDATE_MANIFEST_URL ?? local.updateManifestUrl ?? '',
      'updateManifestUrl',
    ),
  };
}
module.exports = { readConfig };
