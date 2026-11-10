'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { AppError } = require('./errors.cjs');
const PARTITION = '__c9_push__';
const key = (s) => createHash('sha256').update(s).digest('hex');
function createPushService(store, transport, clock = Date.now) {
  async function update(id, mutate) {
    for (let i = 0; i < 5; i++) {
      const old = await store.getRecord(PARTITION, id);
      const next = await mutate(old);
      if (!next) return old;
      try {
        const value = {
          ...next,
          taskId: PARTITION,
          round: id,
          gradeRevision: (old?.gradeRevision || 0) + 1,
        };
        await store.putRecord(value, old?.gradeRevision ?? null);
        return value;
      } catch (e) {
        if (e.status !== 409 || i === 4) throw e;
      }
    }
  }
  async function bind(body, role) {
    if (!['teacher', 'student'].includes(role)) throw new AppError(403, '请选择身份');
    if (
      !body ||
      !/^[a-f0-9-]{32,64}$/i.test(body.installationId || '') ||
      !/^[a-f0-9-]{32,80}$/i.test(body.bindingSecret || '') ||
      !transport.applications.includes(body.applicationId) ||
      (body.enabled !== false && !/^[a-zA-Z0-9_-]{8,256}$/.test(body.deviceId || ''))
    )
      throw new AppError(400, '推送设备信息无效或应用尚未配置');
    const id = key(body.applicationId + '|' + body.installationId);
    const registry = await update('devices', (old) => {
      const devices = { ...(old?.devices || {}) },
        previous = devices[id];
      if (previous && previous.secretHash !== key(body.bindingSecret))
        throw new AppError(403, '设备绑定凭据无效');
      if (!previous && Object.keys(devices).length >= 32)
        throw new AppError(409, '推送设备数量已达到32台，请先移除旧设备');
      const keep =
        previous?.enabled &&
        body.enabled !== false &&
        previous.role === role &&
        previous.deviceId === body.deviceId;
      devices[id] = {
        id,
        applicationId: body.applicationId,
        deviceId: body.deviceId || previous?.deviceId,
        secretHash: key(body.bindingSecret),
        role,
        enabled: body.enabled !== false,
        updated: clock(),
        generation: keep ? previous.generation : randomUUID(),
        since: keep ? previous.since : clock(),
      };
      return { devices };
    });
    return { ok: true, configured: transport.configured, enabled: registry.devices[id].enabled };
  }
  async function dispatch(messages) {
    if (!transport.configured) return { configured: false, sent: 0, failed: 0 };
    const devices = Object.values((await store.getRecord(PARTITION, 'devices'))?.devices || {});
    const result = { configured: true, sent: 0, failed: 0 };
    const started = Date.now();
    for (const device of devices) {
      if (!device.enabled) continue;
      for (const message of messages) {
        if (Date.now() - started > 40000 || result.sent + result.failed >= 50)
          return { ...result, deferred: true };
        if (
          message.read ||
          message.targetRole !== device.role ||
          message.created < device.since ||
          message.created < clock() - 86400000
        )
          continue;
        const id = 'delivery:' + key(device.id + '|' + device.generation + '|' + message.id);
        const lease = randomUUID();
        await update(id, (old) => {
          if (old?.status === 'sent' || old?.leaseUntil > clock()) return null;
          return { status: 'sending', lease, leaseUntil: clock() + 30000, updated: clock() };
        });
        let current = await store.getRecord(PARTITION, id);
        if (current?.lease !== lease) continue;
        try {
          // Recheck the binding after claiming a delivery: role changes and disable take effect immediately.
          const latest = (await store.getRecord(PARTITION, 'devices'))?.devices?.[device.id];
          if (!latest?.enabled || latest.generation !== device.generation) continue;
          await transport.send(device, message);
          await update(id, (old) =>
            old?.lease === lease
              ? { ...old, status: 'sent', leaseUntil: 0, updated: clock() }
              : null,
          );
          result.sent++;
        } catch {
          await update(id, (old) =>
            old?.lease === lease
              ? { ...old, status: 'retry', leaseUntil: clock() + 60000, updated: clock() }
              : null,
          );
          result.failed++;
        }
      }
    }
    return result;
  }
  return {
    bind,
    dispatch,
    status: () => ({ configured: transport.configured, applications: transport.applications }),
  };
}
module.exports = { createPushService };
