/*
 * 演示页启动脚本。
 *
 * 页面本身仍是仓库根目录那份界面，只是把 app.js 的启动时机挪到写完示例数据之后，
 * 否则应用会先读到一个空库，再刷新一次才能看到内容。
 *
 * 示例数据用 model.js 里的函数生成而不是写死 JSON，因为轮次日期是跟着当前时间算的，
 * 写死的日期放几个月就会全部变成“已逾期”，看起来像坏了。
 */
(function () {
  'use strict';

  const DB_NAME = 'two-person-task-assistant';
  const SEED_FLAG = 'c9-demo-seeded';
  const DAY = 86400000;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ['preferences', 'messages'])
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('tasks'))
          db.createObjectStore('tasks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('records')) {
          const store = db.createObjectStore('records', { keyPath: 'id' });
          store.createIndex('taskId', 'taskId');
        }
        if (!db.objectStoreNames.contains('library'))
          db.createObjectStore('library', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function write(db, storeName, rows) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      rows.forEach((row) => store.put(row));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function clear(db, storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function baseTask(fields) {
    return {
      id: fields.id,
      name: fields.name,
      assignmentGroupId: null,
      subject: fields.subject,
      semester: '八年级上学期',
      requiresTeaching: false,
      createdBy: 'teacher',
      kind: fields.kind,
      rule: fields.kind === 'recurring' ? fields.rule : null,
      format: 'text',
      deadline: fields.deadline ?? null,
      dateOnly: true,
      availableFrom: fields.availableFrom ?? null,
      startTime: null,
      endTime: null,
      weekDays: fields.weekDays ?? null,
      enabled: true,
      disabledAt: null,
      created: fields.created,
      updated: fields.created,
      note: fields.note ?? '',
      reminder: null,
      revision: 0,
    };
  }

  function buildSample(now) {
    const tasks = [
      baseTask({
        id: 'demo-math',
        name: '函数与导数练习',
        subject: '数学',
        kind: 'recurring',
        rule: 'day',
        created: now - 13 * DAY,
        note: '每天一页，做错的题我们当天一起看。',
      }),
      baseTask({
        id: 'demo-english',
        name: 'Unit 3 词汇默写',
        subject: '英语',
        kind: 'recurring',
        rule: 'week',
        weekDays: [1, 3],
        created: now - 21 * DAY,
        note: '每次二十个词，写错的圈出来，下次再默一遍。',
      }),
      baseTask({
        id: 'demo-chinese',
        name: '古诗词背诵',
        subject: '语文',
        kind: 'recurring',
        rule: 'day',
        created: now - 4 * DAY,
        note: '背熟后录段语音，我听听断句和语气。',
      }),
      baseTask({
        id: 'demo-chem',
        name: '实验报告整理',
        subject: '化学',
        kind: 'once',
        availableFrom: now - 2 * DAY,
        deadline: now + 2 * DAY,
      }),
      baseTask({
        id: 'demo-physics',
        name: '电路图练习',
        subject: '物理',
        kind: 'once',
        availableFrom: now - 6 * DAY,
        deadline: now - 4 * DAY,
      }),
    ];

    const records = [];

    // 单次作业没有轮次结束时间，可完成区间要问 windowFor 拿，否则算出来的时间是 1970 年。
    const submit = (taskId, roundOffset, text, selfScore, options) => {
      const task = tasks.find((t) => t.id === taskId);
      const round = TaskModel.history(task, now)[roundOffset];
      if (!round) return null;
      const window = TaskModel.windowFor(task, round);
      const last = window.end ?? round.end ?? now;
      const completed =
        options && options.late
          ? last + 3 * 3600000
          : Math.max(window.start + 3600000, last - 3 * 3600000);
      const record = TaskModel.submission(task, round.key, completed, text, [], selfScore);
      records.push(record);
      return record;
    };

    const grade = (record, score) => {
      if (!record) return;
      records[records.indexOf(record)] = TaskModel.grade(
        record,
        score,
        record.completed + 4 * 3600000,
      );
    };

    grade(
      submit(
        'demo-math',
        2,
        '第 3 页全部完成。错的两道是复合函数求导，已经重新推了一遍，思路写在旁边。',
        9,
      ),
      9,
    );
    grade(submit('demo-math', 1, '第 2 页完成，最后一道用了两种方法，第二种快一点。', 8), 8);
    submit('demo-math', 0, '第 1 页完成，极限那题还不太确定。', 9);

    grade(
      submit(
        'demo-english',
        0,
        '默写二十个词，错 2 个：achieve 写成 acheve，confident 少写一个 f。',
        8,
      ),
      8,
    );

    grade(
      submit(
        'demo-physics',
        0,
        '画了三张电路图，并联那题算出来电流偏大，可能漏了内阻。迟交了一天。',
        7,
        { late: true },
      ),
      6,
    );

    return { tasks, records, exams: buildExams(now) };
  }

  // 成绩趋势读的是试卷条目里的分数，不读附件；文件留空，免得点进去是个打不开的假链接。
  function buildExams(now) {
    const exam = (id, name, subject, fullScore, score, daysAgo, rank, gradeRank) => ({
      id: 'demo-' + id,
      type: 'exam',
      name,
      subject,
      folderId: null,
      semester: '八年级上学期',
      fullScore,
      score,
      rank,
      gradeRank,
      examDate: now - daysAgo * DAY,
      notes: '',
      targetScore: null,
      files: [],
    });
    return [
      exam('exam-1', '第一次月考', '数学', 120, 91, 64, 18, 96),
      exam('exam-2', '二次函数单元测验', '数学', 100, 86, 45, 14, 72),
      exam('exam-3', '期中考试', '数学', 120, 103, 26, 7, 35),
      exam('exam-4', '第一次月考', '英语', 120, 88, 63, 22, 118),
      exam('exam-5', '期中考试', '英语', 120, 99, 25, 11, 58),
    ];
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const element = document.createElement('script');
      element.src = src;
      element.onload = resolve;
      element.onerror = () => reject(Error('无法加载 ' + src));
      document.body.append(element);
    });
  }

  function waitFor(check, timeout) {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (check() || Date.now() - started > timeout) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }

  function notice() {
    // app.js 每次重绘都会把标题改回正式名，这里盯着 <title> 改回来。
    const title = document.querySelector('title');
    const wanted = '伴学记录 · 交互演示';
    new MutationObserver(() => {
      if (title.textContent !== wanted) title.textContent = wanted;
    }).observe(title, { childList: true, characterData: true, subtree: true });
    title.textContent = wanted;
    const style = document.createElement('style');
    document.head.append(style);
    const bar = document.createElement('div');
    bar.id = 'demoNotice';
    bar.innerHTML =
      '<span>演示数据，可随意点击。改动只存在这台设备的浏览器里。</span>' +
      '<button type="button" id="demoReset">恢复演示数据</button>';
    Object.assign(bar.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      bottom: '0',
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      justifyContent: 'center',
      flexWrap: 'wrap',
      padding: '8px 14px',
      font: '13px/1.5 system-ui, sans-serif',
      color: '#e8eef7',
      background: 'rgba(24,32,48,.94)',
      borderTop: '1px solid rgba(255,255,255,.13)',
      zIndex: '99',
    });
    bar.querySelector('button').style.cssText =
      'font:inherit;padding:3px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.35);background:transparent;color:inherit;cursor:pointer';
    document.body.append(bar);
    // 提示条高度随文案换行变化，导航让位的距离按实际高度算，写死会压住导航。
    const makeRoom = () => {
      const height = bar.offsetHeight;
      style.textContent = `nav.bottomNav{bottom:${height}px!important}body{padding-bottom:${height + 72}px!important}`;
    };
    makeRoom();
    window.addEventListener('resize', makeRoom);
    bar.querySelector('#demoReset').addEventListener('click', async () => {
      localStorage.removeItem(SEED_FLAG);
      const db = await openDatabase();
      for (const name of ['tasks', 'records', 'library', 'messages']) await clear(db, name);
      db.close();
      location.reload();
    });
  }

  (async () => {
    try {
      const db = await openDatabase();
      if (localStorage.getItem(SEED_FLAG) !== 'v3') {
        const { tasks, records, exams } = buildSample(Date.now());
        await clear(db, 'tasks');
        await clear(db, 'records');
        await clear(db, 'library');
        await write(db, 'tasks', tasks);
        await write(db, 'records', records);
        await write(db, 'library', exams);
        localStorage.setItem(SEED_FLAG, 'v3');
      }
      db.close();
      localStorage.setItem('c9-last-role', localStorage.getItem('c9-last-role') || 'student');
      await loadScript('../app.js');
      await loadScript('../pull-refresh.js');
      await waitFor(() => document.querySelector('nav.bottomNav'), 4000);
      notice();
    } catch (error) {
      document.body.insertAdjacentHTML(
        'afterbegin',
        '<div class="card"><h2>演示数据准备失败</h2><p>' + error.message + '</p></div>',
      );
    }
  })();
})();
