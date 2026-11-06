'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  { pathToFileURL } = require('node:url');
// Resolve only the gateway credential for local authenticated requests. Never log,
// export or persist resolved values, and never read model/provider credentials.
async function localAuth(options = {}) {
  const cfg = JSON.parse(
    (await fs.readFile(path.join(os.homedir(), '.openclaw/openclaw.json'), 'utf8')).replace(
      /^\uFEFF/,
      '',
    ),
  );
  const ref = cfg.gateway?.auth?.token || cfg.gateway?.auth?.password;
  let token;
  if (typeof ref === 'string') token = ref;
  else if (ref && typeof ref === 'object') {
    const root =
      options.openclawRoot ||
      process.env.OPENCLAW_ROOT ||
      (() => {
        throw Error('OpenClaw使用SecretRef时，请设置OPENCLAW_ROOT为自己的OpenClaw安装目录');
      })();
    const sdk = await import(
      pathToFileURL(path.join(root, 'dist/plugin-sdk/secret-ref-runtime.js')).href
    );
    const resolved = await sdk.resolveSecretRefValues([ref], { config: cfg });
    token = [...resolved.values()][0];
  }
  if (typeof token !== 'string' || !token) throw Error('无法解析本机OpenClaw网关凭据');
  return {
    gateway: options.gateway || 'http://127.0.0.1:' + (cfg.gateway.port || 18789),
    gatewayToken: token,
  };
}
module.exports = { localAuth };
