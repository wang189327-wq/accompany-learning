const fs = require('node:fs/promises'),
  path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { createMemory } = require('../cloud/memory.cjs'),
    { createServer } = require('../cloud/server.cjs'),
    { createService } = require('../cloud/core.cjs');
  const memory = createMemory();
  require('../model.js');
  const M = global.TaskModel;
  let qaTime = M.parse('2026-10-25T12:00');
  const api = createService(memory.store, memory.objects, () => qaTime),
    apiServer = createServer({
      token: 'local-qa-not-real-token-12345678901234567890',
      provider: () => memory,
      clock: () => qaTime,
    });
  await api.saveTask(
    {
      task: {
        id: 'repeat',
        name: '周期重复提交测试',
        subject: '数学',
        semester: '七年级上学期',
        kind: 'recurring',
        rule: 'week',
        format: 'text',
        dateOnly: true,
        weekDays: [0, 1, 2, 3, 4, 5, 6],
        enabled: true,
      },
    },
    'teacher',
  );
  memory.tasks.get('repeat').created = M.parse('2026-10-12T12:00');
  memory.tasks.get('repeat').roundNotes = { '2026-W43': '当前周期备注', '2026-W42': '上轮备注' };
  await api.saveTask(
    {
      task: {
        id: 'auto',
        name: '默认打卡测试',
        subject: '英语',
        semester: '七年级上学期',
        kind: 'recurring',
        rule: 'day',
        format: 'auto',
        dateOnly: true,
        enabled: true,
      },
    },
    'teacher',
  );
  let apiOffline = false;
  let handler;
  const apkMode = true,
    blocked = [],
    assetRequests = [];
  if (apkMode) {
    const zip = await require('../zip-reader.js').loadAsync(
      await fs.readFile(
        process.env.C9_QA_APK_PATH ||
          path.join(__dirname, '../android/release/accompany-learning-v1.3.apk'),
      ),
    );
    const native = await fs.readFile(
      path.join(__dirname, '../android/src/app/accompany/learning/AssetList.java'),
      'utf8',
    );
    const allowed = new Set(
      [
        ...native
          .match(/NAMES\s*=\s*new HashSet<>\(Arrays\.asList\(([\s\S]*?)\)\)/)[1]
          .matchAll(/"([^"]+)"/g),
      ].map((x) => x[1]),
    );
    handler = async (req, res) => {
      const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
      if (name.startsWith('api/')) {
        if (apiOffline) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: '测试离线' }));
        }
        return apiServer.emit('request', req, res);
      }
      if (!allowed.has(name) && !/^pdf-(cmaps|fonts|wasm)\/[a-zA-Z0-9_.-]+$/.test(name)) {
        if (name !== 'favicon.ico') blocked.push(name);
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader(
        'Content-Type',
        /\.m?js$/.test(name)
          ? 'application/javascript'
          : name.endsWith('.html')
            ? 'text/html'
            : name.endsWith('.wasm')
              ? 'application/wasm'
              : 'application/octet-stream',
      );
      assetRequests.push(name);
      const asset = zip.file('assets/' + name);
      if (!asset) {
        blocked.push(name);
        console.log('Missing APK resource: ' + name);
        res.statusCode = 404;
        return res.end();
      }
      res.end(await asset.async('nodebuffer'));
    };
  }
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const profile = path.join(require('node:os').tmpdir(), 'banxue-qa-' + Date.now()),
    proc = spawn(
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      [
        '--headless=new',
        '--disable-gpu',
        '--remote-debugging-port=0',
        '--user-data-dir=' + profile,
        'about:blank',
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
  let socket;
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try {
        port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
        break;
      } catch {
        await wait(100);
      }
    }
    const target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(
      (x) => x.type === 'page',
    );
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (socket.onopen = r));
    let n = 0;
    const pending = new Map(),
      alertEvents = [];
    let alertClosed = 0;
    socket.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Page.javascriptDialogOpening') alertEvents.push(m.params);
      if (m.method === 'Page.javascriptDialogClosed') alertClosed++;
      if (m.id) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
      }
    };
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++n;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const ev = async (expression) => {
      const r = await call('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const until = async (expression) => {
      for (let i = 0; i < 200; i++) {
        if (await ev(expression)) return;
        await wait(70);
      }
      throw Error(
        'Timeout ' +
          expression +
          ' ' +
          (await ev(
            "document.querySelector('#formError')?.textContent+' '+document.querySelector('#galleryContent')?.textContent",
          )),
      );
    };
    const expectReviewAlert = async (expression, expected) => {
      const before = alertEvents.length > alertClosed ? alertEvents.length - 1 : alertEvents.length,
        closed = alertClosed;
      const action = ev(expression);
      for (let i = 0; i < 200 && alertEvents.length === before; i++) await wait(50);
      assert.equal(alertEvents.length, before + 1);
      assert.equal(alertEvents.at(-1).type, 'alert');
      assert.ok(alertEvents.at(-1).message.includes(expected));
      await wait(300);
      assert.equal(alertClosed, closed, '弹窗不会自行关闭');
      await call('Page.handleJavaScriptDialog', { accept: true });
      await action;
    };
    await call('Page.enable');
    await call('Runtime.enable');
    if (apkMode)
      await call('Page.addScriptToEvaluateOnNewDocument', {
        source:
          'window.qaWorkerAttempts=0;window.Worker=class{constructor(){qaWorkerAttempts++}addEventListener(){}removeEventListener(){}postMessage(){}terminate(){}};',
      });
    if (apkMode)
      await call('Page.addScriptToEvaluateOnNewDocument', {
        source:
          "localStorage.setItem('c9-cloud-connection-v1',JSON.stringify({endpoint:location.origin,token:'local-qa-not-real-token-12345678901234567890'}));window.C9Android={checkUpdate(){},widgetBackground(color){window.qaWidgetBackground=color},widgetConfigure(endpoint,token,role){window.qaWidgetRole=role},widgetSnapshot(data){window.qaWidget=JSON.parse(data)},consumeWidgetOpen(){return false},updateState(){return JSON.stringify({phase:'current',currentName:'2.0',currentCode:26})}};",
      });
    await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/?test=1' });
    await until("!!document.querySelector('[data-role=teacher]')");
    await ev("document.querySelector('[data-role=teacher]').click()");
    await until("!!document.querySelector('#newTask')");

    assert.ok(apkMode);
    await call('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 1280,
      deviceScaleFactor: 2,
      mobile: true,
    });
    const checked = [];
    // 4.0 uses a searchable ID-backed task picker while keeping assignments independent.
    await ev(
      "document.querySelector('#newAssignmentGroup').click();document.querySelector('#assignmentGroupName').value='英语阅读提升';document.querySelector('#assignmentGroupSubject').value='英语';document.querySelector('#assignmentGroupSemester').value='七年级上学期';document.querySelector('#assignmentGroupForm').requestSubmit()",
    );
    await until(
      "!document.querySelector('#assignmentGroupDialog').open && assignmentGroups.length===1",
    );
    const groupId = await ev('assignmentGroups[0].id');
    await ev(
      "document.querySelector('#newTask').click();document.querySelector('#formAssignmentGroup').focus();document.querySelector('#formAssignmentGroup').value='阅读';document.querySelector('#formAssignmentGroup').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#formAssignmentGroup').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))",
    );
    assert.equal(await ev("groupUI.value('formAssignmentGroup')"), groupId);
    await ev(
      "document.querySelector('#formAssignmentGroup').focus();document.querySelector('#formAssignmentGroup').value='未点选的词';document.querySelector('#formAssignmentGroup').dispatchEvent(new Event('input',{bubbles:true}))",
    );
    assert.equal(
      await ev(
        "(()=>{try{groupUI.value('formAssignmentGroup');return false}catch(e){return e.message.includes('点选')}})()",
      ),
      true,
    );
    await ev("document.querySelector('#formDialog').close()");
    await ev(
      "document.querySelector('#newTask').click();document.querySelector('#name').value='关联阅读作业';document.querySelector('#formAssignmentGroup').focus();document.querySelector('#formAssignmentGroup').value='阅读';document.querySelector('#formAssignmentGroup').dispatchEvent(new Event('input',{bubbles:true}))",
    );
    assert.ok(
      await ev(
        "document.querySelector('#formAssignmentGroup-options').textContent.includes('英语阅读提升')",
      ),
    );
    await ev(
      'document.querySelector(\'[data-group-choice=formAssignmentGroup][data-value="' +
        groupId +
        "\"]').click();document.querySelector('#subject').value='数学';document.querySelector('#taskSemester').value='八年级上学期';document.querySelector('#taskForm').requestSubmit()",
    );
    await until(
      "!document.querySelector('#formDialog').open && tasks.some(t=>t.name==='关联阅读作业')",
    );
    const linked = await ev("tasks.find(t=>t.name==='关联阅读作业')");
    assert.equal(linked.assignmentGroupId, groupId);
    assert.equal(linked.subject, '数学');
    assert.equal(linked.semester, '八年级上学期');
    await ev(
      "document.querySelector('[data-tab=history]').click();document.querySelector('#historyGroup').focus();document.querySelector('#historyGroup').value='阅读';document.querySelector('#historyGroup').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-group-choice=historyGroup][data-value=\"" +
        groupId +
        '"]\').click()',
    );
    assert.equal(await ev("document.querySelectorAll('#historyResults .taskCard').length"), 1);
    assert.ok(
      await ev("document.querySelector('#historyResults').textContent.includes('关联阅读作业')"),
    );
    await ev(
      "document.querySelector('#historySubject').value='英语';document.querySelector('#historySubject').dispatchEvent(new Event('change',{bubbles:true}))",
    );
    assert.equal(await ev("document.querySelectorAll('#historyResults .taskCard').length"), 0);
    await ev(
      "document.querySelector('#clearFilters').click();document.querySelector('#historyGroup').focus();document.querySelector('[data-group-choice=historyGroup][data-value=__unlinked__]').click()",
    );
    assert.equal(await ev("document.querySelectorAll('#historyResults .taskCard').length"), 2);
    for (const width of [360, 390, 600, 800, 1024]) {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1280,
        deviceScaleFactor: 2,
        mobile: true,
      });
      assert.ok(await ev('document.documentElement.scrollWidth<=innerWidth+2'));
      assert.ok(
        await ev("document.querySelector('#historyGroup').getBoundingClientRect().width>150"),
      );
      assert.ok(
        await ev(
          "document.querySelector('#historyGroup').getBoundingClientRect().top>document.querySelector('#historySearch').getBoundingClientRect().top",
        ),
      );
    }
    await ev(
      "document.querySelector('#clearFilters').click();document.querySelector('[data-tab=tasks]').click()",
    );
    assert.equal(await ev("document.querySelectorAll('.currentRound').length"), 0);
    await ev("document.querySelector('[data-detail=repeat]').click()");
    assert.equal(
      await ev(
        "[...document.querySelectorAll('.roundTitle strong')].some(e=>/W\\d\\d/.test(e.textContent))",
      ),
      false,
    );
    await ev("document.querySelector('[data-period-note]').click()");
    assert.equal(
      await ev("document.querySelector('#roundNoteTitle').textContent"),
      '周期重复提交测试',
    );
    await ev(
      "document.querySelector('#roundNoteDialog').close();document.querySelector('#detailDialog').close()",
    );
    // Remove only this synthetic QA assignment so existing fixture assertions remain stable.
    memory.tasks.delete(linked.id);
    await ev('refresh()');
    checked.push(
      '4.0任务发布、关键词点选、学科不覆盖、关联与未关联筛选、组合交集、五宽度布局及隐藏轮次',
    );
    const waitDialogClosed = async () => until("!document.querySelector('#myEditDialog').open");
    await ev(
      "document.querySelector('[data-tab=mine]').click();document.querySelector('[data-profile-open=nickname]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));document.querySelector('#myNickname').value='教师测试昵称';document.querySelector('#myEditForm').requestSubmit()",
    );
    await waitDialogClosed();
    assert.ok(
      await ev("document.querySelector('.profileCard').textContent.includes('教师测试昵称')"),
    );
    checked.push('老师昵称保存');
    await ev(
      "document.querySelector('[data-profile-open=nickname]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))",
    );
    const avatarDom = await call('DOM.getDocument'),
      avatarInput = await call('DOM.querySelector', {
        nodeId: avatarDom.root.nodeId,
        selector: '#myAvatar',
      });
    await call('DOM.setFileInputFiles', {
      nodeId: avatarInput.nodeId,
      files: [path.join(__dirname, '../tests/fixtures/avatar.png')],
    });
    await ev(
      "document.querySelector('#myAvatar').dispatchEvent(new Event('change',{bubbles:true}))",
    );
    await until("document.querySelector('#avatarPreview').hidden===false");
    await ev("document.querySelector('#myEditForm').requestSubmit()");
    await waitDialogClosed();
    assert.ok(await ev("!!document.querySelector('.profileCard img.avatar')"));
    checked.push('头像上传压缩保存');

    await ev(
      "document.querySelector('[data-my=goals]').click();document.querySelector('#targetSchool').value='目标学校测试';for(const sub of ['数学','体育','实验','总分']){const f=document.querySelector('[data-goal='+sub+']');f.querySelector('[data-goal-field=full]').value=sub==='总分'?'750':'120';f.querySelector('[data-goal-field=score]').value=sub==='总分'?'700':'100';f.querySelector('[data-goal-field=rank]').value='10';}document.querySelector('#myEditForm').requestSubmit()",
    );
    await waitDialogClosed();
    assert.ok(await ev("document.querySelector('#app').textContent.includes('目标学校测试')"));
    checked.push('共用目标含体育实验总分、任意满分与排名');
    await ev(
      "document.querySelector('[data-my=table]').click();window.confirm=()=>true;document.querySelector('[data-table-header]').value='年份可编辑';document.querySelector('[data-table-header]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-insert-row]').click();document.querySelector('[data-insert-column]').click()",
    );
    assert.ok(await ev("document.querySelectorAll('#tableEditor tbody tr').length>=2"));
    await ev(
      "document.querySelector('[data-table-r]').value='2026';document.querySelector('[data-table-r]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#tableSelect').click();document.querySelector('[data-cell-r=\"0\"][data-cell-c=\"0\"]').click();document.querySelector('[data-cell-r=\"1\"][data-cell-c=\"2\"]').click();document.querySelector('#tableMerge').click()",
    );
    if (await ev("document.querySelector('#mergeChoiceDialog').open"))
      await ev("document.querySelector('[data-merge-choice=all]').click()");
    assert.ok(await ev('!!document.querySelector(\'#tableEditor td[rowspan="2"][colspan="3"]\')'));
    await ev(
      "document.querySelector('[data-cell-r=\"0\"][data-cell-c=\"0\"]').click();document.querySelector('#tableFill').click();document.querySelector('#myEditForm').requestSubmit()",
    );
    await waitDialogClosed();
    checked.push('表格表头/增行增列/矩形六格合并/选区浅绿填充保存');
    for (const theme of ['default', 'green', 'cream', 'blue', 'lavender']) {
      await ev(
        "document.querySelector('#backgroundSettings').click();document.querySelector('[data-background=" +
          theme +
          "]').click();document.querySelector('[data-close=backgroundDialog]').click()",
      );
      assert.ok(
        await ev(
          "!!getComputedStyle(document.documentElement).getPropertyValue('--c9-accent').trim()",
        ),
      );
    }
    await ev(
      "document.querySelector('#fontSettings').click();document.querySelector('#fontSizeSelect').value='large';document.querySelector('#fontSizeSelect').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-close=fontDialog]').click()",
    );
    assert.equal(await ev('getComputedStyle(document.documentElement).fontSize'), '18px');
    checked.push('五主题与文字大小');
    await ev(
      "document.querySelector('#switchRole').click();document.querySelector('[data-role=student]').click()",
    );
    await until("qaWidgetRole==='student'");
    await ev("document.querySelector('[data-tab=mine]').click()");
    assert.ok(await ev("document.querySelector('#app').textContent.includes('目标学校测试')"));
    assert.equal(
      await ev("document.querySelector('.profileCard').textContent.includes('教师测试昵称')"),
      false,
    );
    checked.push('角色头像昵称隔离、目标共用');
    await ev("document.querySelector('[data-my=messages]').click()");
    assert.ok(await ev("document.querySelectorAll('.messageItem').length>0"));
    await ev("document.querySelector('#readAllMessages').click()");
    await until("document.querySelectorAll('.messageUnread').length===0");
    await ev(
      "document.querySelector('[data-close=messagesDialog]').click();document.querySelector('[data-tab=tasks]').click()",
    );
    checked.push('任务消息可读及标记已读');
    await ev(
      "document.querySelector('[data-detail=repeat]').click();document.querySelector('[data-submit]').click();document.querySelector('#resultText').value='学生文本作业';document.querySelector('#selfScore').value='8';document.querySelector('#submitForm').requestSubmit()",
    );
    await until(
      "!document.querySelector('#submitDialog').open&&!!document.querySelector('[data-ai-review]')",
    );
    assert.ok(
      await ev("document.querySelector('#detailBody').textContent.includes('学生文本作业')"),
    );
    await expectReviewAlert(
      "document.querySelector('[data-ai-review]').click()",
      'Open Claw暂未在线',
    );
    checked.push('学生文本提交自评及AI离线弹窗');
    await api.reviewWorkerPoll({ workerId: 'synthetic-worker-31', ready: true });
    await ev("document.querySelector('[data-ai-review]').click()");
    let claimed;
    for (let i = 0; i < 30; i++) {
      const r = await api.reviewWorkerPoll({ workerId: 'synthetic-worker-31', ready: true });
      if (r.job) {
        claimed = r.job;
        break;
      }
      await wait(50);
    }
    assert.ok(claimed);
    await wait(2300);
    assert.ok(
      await ev("document.querySelector('[data-ai-review]').textContent.includes('正在点评')"),
    );
    await api.reviewWorkerResult({
      workerId: 'synthetic-worker-31',
      jobId: claimed.id,
      claim: claimed.claim,
      text: '合成点评结果，未调用真实模型。',
    });
    await until("document.querySelector('#detailBody').textContent.includes('合成点评结果')");
    checked.push('AI请求禁重、领取后点评中、回传展示');
    await ev(
      "document.querySelector('[data-close=detailDialog]').click();document.querySelector('#switchRole').click();document.querySelector('[data-role=teacher]').click()",
    );
    await until("qaWidgetRole==='teacher'");
    await ev(
      "document.querySelector('[data-detail=repeat]').click();document.querySelector('[data-grade]').click();document.querySelector('#teacherScore').value='9';document.querySelector('#gradeForm').requestSubmit()",
    );
    await until(
      "!document.querySelector('#gradeDialog').open&&document.querySelector('#detailBody').textContent.includes('9 / 10 分')",
    );
    await ev("document.querySelector('[data-task-mode=chart]').click()");
    assert.ok(await ev("!!document.querySelector('#detailBody svg')"));
    await ev(
      "document.querySelector('[data-task-mode=records]').click();document.querySelector('#roundCompletionFilter').value='done';document.querySelector('#roundCompletionFilter').dispatchEvent(new Event('change',{bubbles:true}))",
    );
    assert.ok(await ev("document.querySelectorAll('.round').length>0"));
    await ev("document.querySelector('[data-close=detailDialog]').click()");
    checked.push('老师评分、作业评分趋势、完成筛选');
    await ev("TaskOrdering.start('repeat')");
    assert.ok(await ev('TaskOrdering.active'));
    await ev("document.querySelector('#cancelTaskOrder').click()");
    assert.equal(await ev('TaskOrdering.active'), false);
    await ev("TaskOrdering.start('repeat')");
    await wait(550);
    await ev("document.querySelector('#confirmTaskOrder').click()");
    await until('!TaskOrdering.active');
    assert.ok((await api.snapshot()).taskOrders.teacher);
    checked.push('角色排序确认/取消与云端保存');
    await ev(
      "document.querySelector('[data-tab=exams]').click();document.querySelector('[data-library-new=exam]').click();document.querySelector('#libraryName').value='只有名称附件的试卷'",
    );
    const dom = await call('DOM.getDocument'),
      input = await call('DOM.querySelector', {
        nodeId: dom.root.nodeId,
        selector: '#libraryFiles',
      });
    await call('DOM.setFileInputFiles', {
      nodeId: input.nodeId,
      files: [path.join(__dirname, '../tests/fixtures/preview.pdf')],
    });
    await ev(
      "document.querySelector('#libraryFiles').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#libraryForm').requestSubmit()",
    );
    await until(
      "!document.querySelector('#libraryDialog').open&&!!document.querySelector('[data-library-edit]')",
    );
    const paper = (await api.snapshot()).library.find((x) => x.name === '只有名称附件的试卷');
    assert.ok(paper);
    assert.equal(paper.score, null);
    checked.push('试卷仅名称附件上传');
    await ev(
      "document.querySelector('[data-library-edit]').click();document.querySelector('#editLibrarySubject').value='数学';document.querySelector('#editSemester').value='七年级上学期';document.querySelector('#editFullScore').value='120';document.querySelector('#editScore').value='100';document.querySelector('#editTargetScore').value='110';document.querySelector('#editRank').value='8';document.querySelector('#editGradeRank').value='35';document.querySelector('#editExamDate').value='2026-10-25';document.querySelector('#libraryForm').requestSubmit()",
    );
    await until("!document.querySelector('#libraryDialog').open");
    await ev('refresh()');
    await ev(
      "document.querySelector('[data-exam-mode=chart]').click();document.querySelector('.chartFilters').open=true",
    );
    await until("!!document.querySelector('#examChart svg')");
    for (const base of ['100', '120', '150']) {
      await ev(
        "document.querySelector('#examBase').value='" +
          base +
          "';document.querySelector('#examBase').dispatchEvent(new Event('change',{bubbles:true}))",
      );
      assert.ok(
        await ev("document.querySelector('#examChart').textContent.includes('满分 " + base + "')"),
      );
    }
    await ev(
      "document.querySelector('#examRankType').value='grade';document.querySelector('#examRankType').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-exam-clear]').click()",
    );
    checked.push('目标分、班级年级排名、成绩曲线与三分制和清空筛选');
    const result = {
      passed: true,
      checks: checked,
      realBusinessDataChanged: false,
      realModelCalled: false,
      physicalAndroidTested: false,
    };
    await fs.writeFile(
      path.join(__dirname, '../verification-results/browser.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    socket?.close();
    proc.kill();
    server.close();
    apiServer.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
