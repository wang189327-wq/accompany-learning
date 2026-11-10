'use strict';
exports.handler = async function () {
  const endpoint = process.env.C9_PUSH_ENDPOINT;
  const token = process.env.C9_PUSH_JOB_TOKEN;
  if (!endpoint || !token || token.length < 32 || /^(GENERATE_|REPLACE_)/.test(token))
    throw Error('请配置推送接口地址和独立触发访问码');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw Error('推送接口必须使用HTTPS');
  url.pathname = '/api/push/dispatch';
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(50000),
  });
  if (!response.ok) throw Error('推送调度失败：HTTP ' + response.status);
  return response.json();
};
