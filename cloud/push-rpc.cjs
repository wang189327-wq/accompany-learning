'use strict';
const crypto = require('node:crypto');
const encode = (v) =>
  encodeURIComponent(String(v)).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
function signedParameters(input, credentials, now = new Date()) {
  const values = {
    ...input,
    Format: 'JSON',
    Version: '2016-08-01',
    AccessKeyId: credentials.id,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  if (credentials.securityToken) values.SecurityToken = credentials.securityToken;
  const canonical = Object.keys(values)
    .sort()
    .map((k) => encode(k) + '=' + encode(values[k]))
    .join('&');
  values.Signature = crypto
    .createHmac('sha1', credentials.secret + '&')
    .update('POST&%2F&' + encode(canonical))
    .digest('base64');
  return new URLSearchParams(values);
}
function createPushTransport(env = process.env, headers = {}, fetcher = fetch) {
  const credentials = {
    id: env.C9_PUSH_ACCESS_KEY_ID || headers['x-fc-access-key-id'],
    secret: env.C9_PUSH_ACCESS_KEY_SECRET || headers['x-fc-access-key-secret'],
    securityToken: env.C9_PUSH_SECURITY_TOKEN || headers['x-fc-security-token'],
  };
  let apps = {};
  try {
    apps = JSON.parse(env.C9_PUSH_APPS || '{}');
  } catch {
    throw Error('C9_PUSH_APPS must be JSON');
  }
  if (
    !apps ||
    Array.isArray(apps) ||
    typeof apps !== 'object' ||
    Object.entries(apps).some(
      ([id, value]) =>
        !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(id) ||
        typeof value !== 'string' ||
        !/^\d+$/.test(value),
    )
  )
    throw Error('C9_PUSH_APPS must map package names to quoted decimal AppKeys');
  const configured = !!(credentials.id && credentials.secret && Object.keys(apps).length);
  async function send(device, message) {
    const appKey = apps[device.applicationId];
    if (!configured || !/^\d+$/.test(String(appKey || ''))) throw Error('PUSH_NOT_CONFIGURED');
    const data = {
      Action: 'Push',
      RegionId: 'cn-hangzhou',
      AppKey: String(appKey),
      Target: 'DEVICE',
      TargetValue: device.deviceId,
      DeviceType: 'ANDROID',
      PushType: 'NOTICE',
      Title: message.title.slice(0, 100),
      Body: '你有一条新的作业消息，点击查看',
      StoreOffline: 'true',
      AndroidNotifyType: 'BOTH',
      AndroidNotificationChannel: 'c9_messages',
      AndroidOpenType: 'ACTIVITY',
      AndroidActivity: device.applicationId + '.MainActivity',
      AndroidPopupActivity: device.applicationId + '.PushPopupActivity',
      AndroidPopupTitle: message.title.slice(0, 100),
      AndroidPopupBody: '你有一条新的作业消息，点击查看',
      AndroidNotificationTag: crypto
        .createHash('sha256')
        .update(message.id)
        .digest('hex')
        .slice(0, 32),
      AndroidExtParameters: JSON.stringify({
        taskId: message.taskId || '',
        messageId: message.id,
        targetRole: device.role,
      }),
    };
    if (env.C9_PUSH_HUAWEI_CATEGORY)
      data.AndroidMessageHuaweiCategory = env.C9_PUSH_HUAWEI_CATEGORY;
    if (env.C9_PUSH_VIVO_CATEGORY) data.AndroidMessageVivoCategory = env.C9_PUSH_VIVO_CATEGORY;
    if (env.C9_PUSH_VIVO_TEST === 'true') data.AndroidVivoPushMode = '1';
    const response = await fetcher('https://cloudpush.aliyuncs.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: signedParameters(data, credentials),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok || !result.MessageId) throw Error('PUSH_PROVIDER_REJECTED');
    return { messageId: result.MessageId };
  }
  return { configured, applications: Object.keys(apps), send };
}
module.exports = { signedParameters, createPushTransport };
