'use strict';
exports.handler = async () => {
  const endpoint = process.env.C9_BACKUP_ENDPOINT?.replace(/\/+$/, '');
  const token = process.env.C9_ACCESS_TOKEN;
  if (!endpoint?.startsWith('https://') || !token)
    throw Error('请配置 C9_BACKUP_ENDPOINT 和 C9_ACCESS_TOKEN');
  const response = await fetch(endpoint + '/api/backup', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'X-C9-Role': 'teacher',
      'Content-Type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(55000),
  });
  if (!response.ok) throw Error('自动备份失败，HTTP ' + response.status);
  const result = await response.json();
  console.log('C9 automatic backup completed');
  return { ok: result.ok };
};
