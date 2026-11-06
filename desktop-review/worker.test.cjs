const test = require('node:test'),
  assert = require('node:assert/strict'),
  { review, outputText, validateConfig } = require('./worker.cjs');
test('缺题只列规定汇总句，完整题继续点评，各批次保留约束和作业内容', async () => {
  const calls = [];
  const request = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return {
      ok: true,
      json: async () => ({
        status: 'completed',
        output_text: '第1题正确。因题目不完整，无法点评的题目为：第2题。',
      }),
    };
  };
  await review(
    {
      taskName: '缺题测试',
      text: '第1题：2+3，学生答5；第2题：根据下图回答，配图未提供。',
      images: Array.from({ length: 9 }, (_, i) => ({ url: 'https://example.com/' + i + '.png' })),
    },
    { gateway: 'http://127.0.0.1:18789', gatewayToken: 'test', agent: 'c9-review' },
    request,
  );
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.ok(c.instructions.includes('因题目不完整，无法点评的题目为：……'));
    assert.match(c.instructions, /不再展开可能的题意、假设条件、猜测答案/);
    assert.match(c.instructions, /全部题目都不完整时，只输出上述汇总句/);
    assert.match(c.instructions, /仅缺参考答案不等于题目不完整/);
    assert.match(c.instructions, /不编造题号/);
    assert.ok(c.input[0].content[0].text.includes('第1题：2+3'));
  }
});
test('GPT额度错误只回传安全类别、不误报成功、不泄露上游正文', async () => {
  const { run } = require('./worker.cjs'),
    controller = new AbortController();
  let result;
  const response = (value) => ({ ok: true, json: async () => value });
  const request = async (url, opts) => {
    if (url.endsWith('/v1/models')) return response({ data: [] });
    if (url.endsWith('/poll')) return response({ job: { id: 'test', claim: 'claim', images: [] } });
    if (url.endsWith('/v1/responses'))
      return {
        ok: false,
        status: 429,
        json: async () => ({
          error: { code: 'rate_limit_error', message: 'private upstream text' },
        }),
      };
    if (url.endsWith('/batch')) return response({ ok: true });
    if (url.endsWith('/result')) {
      result = JSON.parse(opts.body);
      controller.abort();
      return response({ ok: true });
    }
    throw Error('unexpected');
  };
  await run(
    {
      endpoint: 'https://example.com',
      gateway: 'http://127.0.0.1:18789',
      workerToken: 'x'.repeat(32),
      gatewayToken: 'test',
    },
    {
      request,
      signal: controller.signal,
      pollMs: 1,
      outboxDir: require('node:fs').mkdtempSync(
        require('node:path').join(require('node:os').tmpdir(), 'c9-worker-test-'),
      ),
    },
  );
  assert.equal(result.error, true);
  assert.equal(result.errorCode, 'model_limit');
  assert.equal(result.text, undefined);
  assert.ok(!JSON.stringify(result).includes('private upstream'));
});
test('图片分批完整传递、纯文字结果、无工具调用', async () => {
  const calls = [];
  const request = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return {
      ok: true,
      json: async () => ({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: '作业点评' }] }],
      }),
    };
  };
  const result = await review(
    {
      taskName: '测试',
      images: Array.from({ length: 11 }, (_, i) => ({ url: 'https://example.com/' + i + '.png' })),
    },
    { gateway: 'http://127.0.0.1:18789', gatewayToken: 'test', agent: 'c9-review' },
    request,
  );
  assert.equal(calls.length, 2);
  assert.equal(
    calls.flatMap((c) => c.input[0].content.filter((x) => x.type === 'input_image')).length,
    11,
  );
  assert.ok(calls.every((c) => c.tool_choice === 'none' && !c.user && !c.previous_response_id));
  assert.match(result, /第2组/);
});
test('不接受不完整响应、不公开OpenClaw、限制云端明文', () => {
  assert.throws(() => outputText({ status: 'failed', output_text: 'partial' }));
  assert.throws(() =>
    validateConfig({
      endpoint: 'http://example.com',
      workerToken: 'x'.repeat(32),
      gatewayToken: 'test',
    }),
  );
  assert.throws(() =>
    validateConfig({
      endpoint: 'https://example.com',
      gateway: 'http://example.com',
      workerToken: 'x'.repeat(32),
      gatewayToken: 'test',
    }),
  );
});
test('长时间思考期间持续心跳，避免被误判电脑离线', async () => {
  const { run } = require('./worker.cjs'),
    controller = new AbortController();
  let polls = 0,
    returned = false;
  const response = (value) => ({ ok: true, json: async () => value });
  const request = async (url, options) => {
    if (url.endsWith('/v1/models')) return response({ data: [] });
    if (url.endsWith('/poll')) {
      polls++;
      return response({
        job: polls === 1 ? { id: 'job', claim: 'claim', images: [], text: 'test' } : null,
      });
    }
    if (url.endsWith('/v1/responses')) {
      await new Promise((r) => setTimeout(r, 90));
      return response({ status: 'completed', output_text: '点评完成' });
    }
    if (url.endsWith('/batch')) return response({ ok: true });
    if (url.endsWith('/result')) {
      returned = true;
      controller.abort();
      return response({ ok: true });
    }
    throw Error('unexpected request');
  };
  await run(
    {
      endpoint: 'https://example.com',
      gateway: 'http://127.0.0.1:18789',
      workerToken: 'x'.repeat(32),
      gatewayToken: 'test',
    },
    {
      request,
      signal: controller.signal,
      heartbeatMs: 10,
      pollMs: 5,
      outboxDir: require('node:fs').mkdtempSync(
        require('node:path').join(require('node:os').tmpdir(), 'c9-worker-test-'),
      ),
    },
  );
  assert.equal(returned, true);
  assert.ok(polls >= 3, '模型思考期间持续更新心跳');
});
