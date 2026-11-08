'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const prefixes = [
  ['c9-abort-incomplete-assets', 'assets/'],
  ['c9-abort-incomplete-library', 'library-files/'],
];
const empty =
  '<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration></LifecycleConfiguration>';
function list(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
async function planLifecycle(xml, parse, days = 3) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw Error('分片保留天数须为1—365整数');
  if (
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !/<LifecycleConfiguration(?:\s[^>]*)?>/.test(xml) ||
    !/<\/LifecycleConfiguration>\s*$/.test(xml)
  )
    throw Error('无法安全识别现有生命周期XML，请使用控制台检查');
  const parsed = await parse(xml),
    rules = list(parsed.Rule);
  const rawRules = xml.match(/<Rule(?:\s[^>]*)?>[\s\S]*?<\/Rule>/g) || [];
  if (rawRules.length !== rules.length) throw Error('现有规则无法逐项保留，停止合并');
  let next = xml;
  const kept = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i],
      own = prefixes.find(([id]) => id === rule.ID);
    if (own) {
      if (
        Object.keys(rule).some(
          (k) => !['ID', 'Prefix', 'Status', 'AbortMultipartUpload'].includes(k),
        ) ||
        rule.Prefix !== own[1]
      )
        throw Error('同名规则含其他策略，停止覆盖');
      next = next.replace(rawRules[i], '');
    } else {
      if (rule.AbortMultipartUpload) {
        if (
          rule.Filter ||
          typeof rule.Prefix !== 'string' ||
          prefixes.some(([, p]) => p.startsWith(rule.Prefix) || rule.Prefix.startsWith(p))
        )
          throw Error('现有分片规则与目标前缀重叠，请在控制台合并，原规则未改动');
      }
      kept.push(rule);
    }
  }
  const additions = prefixes
    .map(
      ([id, prefix]) =>
        '<Rule><ID>' +
        id +
        '</ID><Prefix>' +
        prefix +
        '</Prefix><Status>Enabled</Status><AbortMultipartUpload><Days>' +
        days +
        '</Days></AbortMultipartUpload></Rule>',
    )
    .join('\n');
  next = next.replace('</LifecycleConfiguration>', additions + '\n</LifecycleConfiguration>');
  await parse(next);
  return { xml: next, kept, days, affectedPrefixes: prefixes.map((x) => x[1]) };
}
async function maintain(client, bucket, { days = 3, apply = false, backupDir } = {}) {
  const read = async () => {
    const params = client._bucketRequestParams('GET', bucket, 'lifecycle', {});
    params.successStatuses = [200];
    params.xmlResponse = false;
    try {
      return String((await client.request(params)).data);
    } catch (e) {
      if (e.code === 'NoSuchLifecycle') return empty;
      throw e;
    }
  };
  const original = await read();
  const plan = await planLifecycle(original, (xml) => client.parseXML(xml), days);
  await fs.mkdir(backupDir, { recursive: true });
  // Exclusive files preserve earlier inspection snapshots instead of overwriting them.
  await fs.writeFile(path.join(backupDir, 'original-lifecycle.xml'), original, { flag: 'wx' });
  await fs.writeFile(path.join(backupDir, 'proposed-lifecycle.xml'), plan.xml, { flag: 'wx' });
  if (!apply)
    return {
      applied: false,
      days,
      affectedPrefixes: plan.affectedPrefixes,
      existingRulesPreserved: plan.kept.length,
    };
  if ((await read()) !== original) throw Error('检查期间生命周期已改变，停止写入，请重新预览');
  const params = client._bucketRequestParams('PUT', bucket, 'lifecycle', {});
  Object.assign(params, { successStatuses: [200, 204], mime: 'xml', content: plan.xml });
  await client.request(params);
  const actual = await client.parseXML(await read());
  const actualRules = list(actual.Rule);
  const others = actualRules.filter((r) => !prefixes.some(([id]) => id === r.ID));
  const normalize = (r) => JSON.stringify(canonical(r));
  if (
    JSON.stringify(others.map(normalize).sort()) !==
      JSON.stringify(plan.kept.map(normalize).sort()) ||
    prefixes.some(
      ([id, prefix]) =>
        !actualRules.some(
          (r) =>
            r.ID === id &&
            r.Prefix === prefix &&
            r.Status === 'Enabled' &&
            Number(r.AbortMultipartUpload?.Days) === days,
        ),
    )
  )
    throw Error('写入后核对未通过，原XML已保留，请检查控制台；不自动回滚其他并发改动');
  return {
    applied: true,
    days,
    affectedPrefixes: plan.affectedPrefixes,
    existingRulesPreserved: others.length,
  };
}
module.exports = { planLifecycle, maintain, empty };
