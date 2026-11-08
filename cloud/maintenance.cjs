'use strict';
// 仅供管理员单独运行，不在应用启动或上传时修改Bucket策略。
const path = require('node:path');
async function main() {
  const OSS = require('ali-oss');
  const required = [
    'C9_OSS_REGION',
    'C9_OSS_BUCKET',
    'ALIBABA_CLOUD_ACCESS_KEY_ID',
    'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
    'ALIBABA_CLOUD_SECURITY_TOKEN',
  ];
  for (const key of required) if (!process.env[key]) throw Error('缺少管理员临时环境变量：' + key);
  const client = new OSS({
    region: process.env.C9_OSS_REGION,
    bucket: process.env.C9_OSS_BUCKET,
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    stsToken: process.env.ALIBABA_CLOUD_SECURITY_TOKEN,
    secure: true,
    timeout: 30000,
  });
  const backupDir = path.resolve(
    process.env.C9_MAINTENANCE_BACKUP_DIR || 'maintenance-results/' + Date.now(),
  );
  const result = await require('./lifecycle-maintenance.cjs').maintain(
    client,
    process.env.C9_OSS_BUCKET,
    {
      days: Number(process.env.C9_ABORT_DAYS || 3),
      apply: process.argv.includes('--apply'),
      backupDir,
    },
  );
  console.log(JSON.stringify({ ...result, backupDir }));
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main };
