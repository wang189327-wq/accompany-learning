'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  zlib = require('node:zlib'),
  crypto = require('node:crypto');
const { build } = require('./build.cjs');
const table = Array.from({ length: 256 }, (_, i) => {
  let v = i;
  for (let b = 0; b < 8; b++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
  return v >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function collect(folder, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    if (entry.name === '.bin' && prefix.includes('node_modules/')) continue;
    const full = path.join(folder, entry.name),
      name = prefix + entry.name;
    if (entry.isDirectory()) out.push(...(await collect(full, name + '/')));
    else if (entry.isFile()) out.push({ name, bytes: await fs.readFile(full) });
    else throw Error('部署包不允许符号链接：' + name);
  }
  return out;
}
function zip(entries) {
  const chunks = [],
    central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      compressed = zlib.deflateRawSync(entry.bytes),
      crc = crc32(entry.bytes),
      local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, compressed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(entry.bytes.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
async function packageAll() {
  await build();
  const release = path.join(__dirname, 'release');
  await fs.mkdir(release, { recursive: true });
  const entries = [];
  for (const name of [
    'environment.example.json',
    'function-permissions.example.json',
    'function-role-trust.json',
    'push-permissions.example.json',
    'errors.cjs',
    'push-routes.cjs',
    'push-service.cjs',
    'push-rpc.cjs',
    'push-timer.cjs',
    'storage-monitor.cjs',
    'static-assets.json',
    'lifecycle-maintenance.cjs',
    'lifecycle-example.xml',
    'maintenance.cjs',
    'task-service.cjs',
    'assignment-groups.cjs',
    'assignment-groups.js',
    'ai-review.cjs',
    'review-batches.cjs',
    'extras.cjs',
    'my-model.js',
    'server.cjs',
    'core.cjs',
    'aliyun.cjs',
    'model.js',
    'study-model.js',
    'package.json',
    'package-lock.json',
  ])
    entries.push({ name, bytes: await fs.readFile(path.join(__dirname, name)) });
  entries.push(
    ...(await collect(path.join(__dirname, 'node_modules'), 'node_modules/')),
    ...(await collect(path.join(__dirname, 'public'), 'public/')),
  );
  const files = {
    'Accompany Learning云端接口部署包.zip': zip(entries),
    'Accompany Learning云端界面.zip': zip(await collect(path.join(__dirname, 'public'))),
    'Accompany Learning自动备份函数.zip': zip([
      { name: 'index.js', bytes: await fs.readFile(path.join(__dirname, 'backup-handler.cjs')) },
    ]),
  };
  files['system-push-timer.zip'] = zip([
    { name: 'index.js', bytes: await fs.readFile(path.join(__dirname, 'push-timer.cjs')) },
  ]);
  const manifest = { created: new Date().toISOString(), files: {} };
  for (const [name, bytes] of Object.entries(files)) {
    await fs.writeFile(path.join(release, name), bytes);
    manifest.files[name] = {
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  }
  await fs.writeFile(path.join(release, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
if (require.main === module)
  packageAll()
    .then((m) => console.log(JSON.stringify(m, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
module.exports = { packageAll, zip, crc32, collect };
