'use strict';
const MyUI = (() => {
  let prefs = [],
    messages = [],
    draftTable = null,
    start = null,
    end = null,
    selection = false,
    expected = null,
    saving = false,
    profileRole = null;
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const get = (id) => prefs.find((p) => p.id === id) || { id, revision: 0 };
  const shared = () => get('shared'),
    profile = () => get('profile:' + role);
  function set(p, m) {
    prefs = p;
    messages = m;
  }
  function unread() {
    return messages.filter((m) => m.targetRole === role && !m.read).length;
  }
  function admissions(t, edit = false) {
    t = MyModel.validateTable(t || MyModel.table());
    const width = t.columnWidths.reduce((a, b) => a + b, 0) + (edit ? 170 : 0),
      cols =
        t.columnWidths.map((w) => '<col style="width:' + w + 'px">').join('') +
        (edit ? '<col style="width:170px">' : ''),
      align = t.alignment === 'center' ? 'text-center' : '';
    const range = edit && start && end ? MyModel.bounds(t, start, end) : null;
    const heads = (t.headers || MyModel.HEADERS)
      .map(
        (h, c) =>
          '<th style="background:' +
          esc(t.fillColor || '') +
          '">' +
          (edit && !selection
            ? '<textarea rows="2" data-table-header="' +
              c +
              '" aria-label="第 ' +
              (c + 1) +
              ' 列表头">' +
              esc(h) +
              '</textarea><div class="tableInsertActions"><button type="button" data-insert-column="' +
              c +
              '">左侧新增</button><button type="button" data-insert-column="' +
              (c + 1) +
              '">右侧新增</button><button type="button" class="danger" data-delete-column="' +
              c +
              '">删除列</button></div>'
            : esc(h)) +
          (edit
            ? '<span class="columnResizeHandle" data-col-resize="' +
              c +
              '" role="separator" aria-orientation="vertical" tabindex="0" aria-label="拖动调整第 ' +
              (c + 1) +
              ' 列宽"></span>'
            : '') +
          '</th>',
      )
      .join('');
    const rows = t.rows
      .map(
        (row, r) =>
          '<tr data-table-row="' +
          r +
          '"' +
          (t.rowHeights[r] ? ' style="height:' + t.rowHeights[r] + 'px"' : '') +
          '>' +
          row
            .map((value, c) => {
              const cover = t.merges.find(
                (m) => r >= m.r && r < m.r + m.h && c >= m.c && c < m.c + m.w,
              );
              if (cover && (cover.r !== r || cover.c !== c)) return '';
              const selected =
                range &&
                r >= range.r &&
                r < range.r + range.h &&
                c >= range.c &&
                c < range.c + range.w;
              return (
                '<td ' +
                (cover ? 'rowspan="' + cover.h + '" colspan="' + cover.w + '" ' : '') +
                'style="background:' +
                esc(t.cellFills?.[r + ',' + c] || t.fillColor || '') +
                '" data-cell-r="' +
                r +
                '" data-cell-c="' +
                c +
                '" class="' +
                (selected ? 'cellSelected' : '') +
                '">' +
                (edit && !selection
                  ? '<textarea rows="2" data-table-r="' +
                    r +
                    '" data-table-c="' +
                    c +
                    '" aria-label="第 ' +
                    (r + 1) +
                    ' 行 ' +
                    esc((t.headers || MyModel.HEADERS)[c]) +
                    '">' +
                    esc(value) +
                    '</textarea>'
                  : esc(value) || '　') +
                '</td>'
              );
            })
            .join('') +
          (edit
            ? '<td class="rowOperationCell"><div class="tableInsertActions"><button type="button" data-insert-row="' +
              r +
              '">上方新增</button><button type="button" data-insert-row="' +
              (r + 1) +
              '">下方新增</button></div><button type="button" data-delete-row="' +
              r +
              '">删除行</button><span class="rowResizeHandle" data-row-resize="' +
              r +
              '" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="拖动调整第 ' +
              (r + 1) +
              ' 行高"></span></td>'
            : '') +
          '</tr>',
      )
      .join('');
    return (
      '<div class="admissionsScroll"><table class="admissionsTable ' +
      align +
      '" style="width:' +
      width +
      'px"><colgroup>' +
      cols +
      '</colgroup><thead><tr>' +
      heads +
      (edit ? '<th>操作</th>' : '') +
      '</tr></thead><tbody>' +
      rows +
      '</tbody></table></div>'
    );
  }

  function page() {
    const p = profile(),
      s = shared(),
      count = unread();
    return (
      '<div class="myGrid"><section class="card profileCard">' +
      (p.avatar
        ? '<img class="avatar" data-profile-open="avatar" tabindex="0" role="button" aria-label="双击头像编辑头像和昵称" src="' +
          esc(p.avatar) +
          '" alt="头像">'
        : '<div class="avatar avatarEmpty" data-profile-open="avatar" tabindex="0" role="button" aria-label="双击头像编辑头像和昵称">' +
          (role === 'teacher' ? '师' : '生') +
          '</div>') +
      '<div class="profileInfo"><div class="profileNameRow"><h2><span data-profile-open="nickname" tabindex="0" role="button" aria-label="双击昵称编辑头像和昵称">' +
      esc(p.nickname || (role === 'teacher' ? '老师' : '学生')) +
      '</span></h2></div><p class="muted">' +
      (role === 'teacher' ? '老师' : '学生') +
      '</p></div></section><section class="card"><div class="pageHeading"><h2>消息' +
      (count ? '<span class="unreadBadge">' + count + '</span>' : '') +
      '</h2><button data-my="messages">查看消息</button></div><p>' +
      (count ? '有 ' + count + ' 条未读消息' : '暂无未读消息') +
      '</p></section><section class="card full"><div class="pageHeading"><h2>学习目标</h2><button data-my="goals">编辑目标</button></div><p>目标院校：<strong>' +
      esc(s.school || '暂未设置') +
      '</strong></p><div class="tableScroll"><table><thead><tr><th>学科</th><th>满分</th><th>目标分数</th><th>目标排名</th></tr></thead><tbody>' +
      MyModel.goalSubjects(TaskModel.SUBJECTS)
        .map((sub) => {
          const v = s.goals?.[sub];
          return (
            '<tr><th>' +
            sub +
            '</th><td>' +
            (v?.full ?? '—') +
            '</td><td>' +
            (v?.score ?? '—') +
            '</td><td>' +
            (v?.rank ?? '—') +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div></section><section class="card full"><div class="pageHeading"><h2>合肥高中录取分数线</h2><button data-my="table">编辑表格</button></div>' +
      admissions(s.table) +
      '</section><div id="mySettingsSlot" class="full"></div></div>'
    );
  }
  document.body.insertAdjacentHTML(
    'beforeend',
    `<dialog id="myEditDialog"><div class="dialogHead"><h3 id="myEditTitle"></h3><button data-close="myEditDialog">关闭</button></div><form id="myEditForm"><div id="myEditBody"></div><p id="myEditError" class="error"></p><button type="submit" class="primary" id="mySave">保存</button></form></dialog><dialog id="messagesDialog"><div class="dialogHead"><h3>消息</h3><button data-close="messagesDialog">关闭</button></div><button id="readAllMessages">全部标为已读</button><div id="messagesBody"></div></dialog><dialog id="mergeChoiceDialog"><div class="dialogHead"><h3>合并内容如何保留？</h3></div><p>选中区域有多个单元格包含文字，请选择保留方式。</p><div class="actions"><button data-merge-choice="all" class="primary">保留全部（换行合并）</button><button data-merge-choice="first">仅保留第一个有内容的单元格</button><button data-close="mergeChoiceDialog">取消</button></div></dialog>`,
  );
  let editKind = '';
  function open(kind) {
    editKind = kind;
    expected = (kind === 'profile' ? profile() : shared()).revision || 0;
    profileRole = role;
    draftTable = null;
    start = end = null;
    selection = false;
    document.getElementById('myEditError').textContent = '';
    document.getElementById('myEditTitle').textContent = {
      profile: '头像和昵称',
      goals: '学习目标',
      table: '编辑录取表格',
    }[kind];
    const p = profile(),
      s = shared();
    document.getElementById('myEditBody').innerHTML =
      kind === 'profile'
        ? '<label>昵称<input id="myNickname" required value="' +
          esc(p.nickname || (role === 'teacher' ? '老师' : '学生')) +
          '"></label><label>头像<input id="myAvatar" type="file" accept="image/*"></label><img class="avatar" id="avatarPreview" ' +
          (p.avatar ? 'src="' + esc(p.avatar) + '"' : 'hidden') +
          ' alt="头像预览"><button type="button" id="removeAvatar">移除头像</button>'
        : kind === 'goals'
          ? '<label>目标院校<input id="targetSchool" value="' +
            esc(s.school || '') +
            '"></label><div class="goalEdit">' +
            MyModel.goalSubjects(TaskModel.SUBJECTS)
              .map((sub) => {
                const v = s.goals?.[sub] || {};
                return (
                  '<fieldset data-goal="' +
                  sub +
                  '"><legend>' +
                  sub +
                  '</legend><label>满分<input data-goal-field="full" type="number" min="0" step="any" value="' +
                  esc(v.full ?? '') +
                  '"></label><label>目标分数<input data-goal-field="score" type="number" min="0" step="any" value="' +
                  esc(v.score ?? '') +
                  '"></label><label>目标排名<input data-goal-field="rank" type="number" min="1" step="1" value="' +
                  esc(v.rank ?? '') +
                  '"></label></fieldset>'
                );
              })
              .join('') +
            '</div>'
          : '<div class="actions"><button type="button" id="tableAlign">' +
            (draftTable?.alignment === 'center' ? '恢复左对齐' : '文字居中') +
            '</button><button type="button" id="tableSelect">选择单元格 / 区域</button><button type="button" id="tableSelectionReset">重新选择</button><button type="button" id="tableFill">浅绿填充</button><button type="button" id="tableClearFill">清除填充</button><button type="button" id="tableMerge">合并单元格</button><button type="button" id="tableUnmerge">取消合并</button></div><p id="tableSelectionInfo" class="muted">点击需要填色的单元格，再点浅绿填充。选择单元格 / 区域可选择多格；拖动边缘可调整行高和列宽。</p><div class="tableMoveControls"><label>移动<select id="tableMoveAxis"><option value="row">行</option><option value="column">列</option></select></label><label>从<select id="tableMoveFrom"></select></label><label>到<select id="tableMoveTo"></select></label><label>位置<select id="tableMoveSide"><option value="before">前面</option><option value="after">后面</option></select></label><button type="button" id="tableMove">移动</button></div><div id="tableEditor"></div>';
    if (kind === 'table') {
      draftTable = MyModel.validateTable(MyModel.copy(s.table || MyModel.table()));
      draftTable.headers = draftTable.headers || [...MyModel.HEADERS];
      drawTable();
    }
    document.getElementById('myEditDialog').showModal();
  }
  function moveOptions() {
    const count =
      document.getElementById('tableMoveAxis').value === 'row'
        ? draftTable.rows.length
        : draftTable.headers.length;
    for (const id of ['tableMoveFrom', 'tableMoveTo']) {
      const el = document.getElementById(id),
        old = el.value;
      el.innerHTML = Array.from(
        { length: count },
        (_, i) => '<option value="' + i + '">第 ' + (i + 1) + '</option>',
      ).join('');
      if (Number(old) < count) el.value = old || '0';
    }
  }
  function drawTable() {
    moveOptions();
    document.getElementById('tableEditor').innerHTML = admissions(draftTable, true);
    document.getElementById('tableAlign').textContent =
      draftTable.alignment === 'center' ? '恢复左对齐' : '文字居中';
    document.getElementById('tableSelect').textContent = selection
      ? '返回文字编辑'
      : '选择单元格 / 区域';
    document.getElementById('tableSelectionInfo').textContent = selection
      ? '点击起点和对角终点，可跨多行、多列合并；再次点击可调整终点。点击一个格子即可填充单格，点击对角终点可选择多个格子；未选中时不填充。'
      : '点击需要填色的单元格，再点浅绿填充。选择单元格 / 区域可选择多格；拖动边缘可调整行高和列宽。';
  }
  function selectionBounds() {
    if (!start || !end) throw Error('请先选择连续矩形区域');
    return MyModel.bounds(draftTable, start, end);
  }
  function showMessages() {
    document.getElementById('messagesBody').innerHTML =
      messages
        .filter((m) => m.targetRole === role)
        .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
        .map(
          (m) =>
            '<article class="messageItem ' +
            (!m.read ? 'messageUnread' : '') +
            '"><h3>' +
            (!m.read ? '<span class="redDot"></span>' : '') +
            esc(m.title) +
            '</h3><p class="content">' +
            esc(m.body) +
            '</p><p class="muted">' +
            TaskModel.display(m.created) +
            '</p><div class="actions"><button data-message="' +
            esc(m.id) +
            '">查看任务</button>' +
            (!m.read ? '<button data-read-message="' + esc(m.id) + '">标为已读</button>' : '') +
            '</div></article>',
        )
        .join('') || '<p class="empty">暂无消息</p>';
  }
  let avatarDraft = null,
    lastProfileTap = null;
  function openProfile() {
    if (document.getElementById('myEditDialog').open) return;
    avatarDraft = null;
    open('profile');
  }
  document.addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-profile-open]')) {
      e.preventDefault();
      openProfile();
    }
  });
  document.addEventListener('pointerup', (e) => {
    const target = e.target.closest('[data-profile-open]');
    if (!target || e.pointerType === 'mouse' || !e.isPrimary || e.button !== 0) return;
    const stamp = performance.now();
    if (
      lastProfileTap &&
      lastProfileTap.target === target &&
      stamp - lastProfileTap.time < 380 &&
      Math.hypot(e.clientX - lastProfileTap.x, e.clientY - lastProfileTap.y) < 22
    ) {
      lastProfileTap = null;
      e.preventDefault();
      openProfile();
    } else lastProfileTap = { target, time: stamp, x: e.clientX, y: e.clientY };
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('[data-profile-open]') && ['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openProfile();
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.dataset.tableHeader != null)
      draftTable.headers[Number(e.target.dataset.tableHeader)] = e.target.value;
    if (e.target.dataset.tableR != null)
      draftTable.rows[Number(e.target.dataset.tableR)][Number(e.target.dataset.tableC)] =
        e.target.value;
  });
  document.addEventListener('change', async (e) => {
    if (e.target.id === 'tableMoveAxis') {
      moveOptions();
      return;
    }
    if (e.target.id !== 'myAvatar' || !e.target.files[0]) return;
    try {
      const file = e.target.files[0];
      if (!file.type.startsWith('image/')) throw Error('请选择图片');
      const url = URL.createObjectURL(file),
        im = new Image();
      try {
        await new Promise((resolve, reject) => {
          im.onload = resolve;
          im.onerror = () => reject(Error('无法读取头像图片'));
          im.src = url;
        });
        const scale = Math.min(1, 512 / Math.max(im.width, im.height)),
          canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(im.width * scale));
        canvas.height = Math.max(1, Math.round(im.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
        avatarDraft = canvas.toDataURL('image/jpeg', 0.85);
        document.getElementById('avatarPreview').src = avatarDraft;
        document.getElementById('avatarPreview').hidden = false;
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      document.getElementById('myEditError').textContent = err.message;
    }
  });
  let resizeDrag = null;
  document.addEventListener('pointerdown', (e) => {
    const col = e.target.closest('[data-col-resize]'),
      row = e.target.closest('[data-row-resize]');
    if ((!col && !row) || editKind !== 'table' || !document.getElementById('myEditDialog').open)
      return;
    const el = col || row,
      kind = col ? 'column' : 'row',
      index = Number(el.dataset[col ? 'colResize' : 'rowResize']),
      tr = el.closest('tr');
    resizeDrag = {
      kind,
      index,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start:
        kind === 'column'
          ? draftTable.columnWidths[index]
          : draftTable.rowHeights[index] || tr.getBoundingClientRect().height,
    };
    if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('pointermove', (e) => {
    if (!resizeDrag || resizeDrag.id !== e.pointerId) return;
    const d = resizeDrag;
    if (d.kind === 'column') {
      const value = Math.max(60, Math.min(900, Math.round(d.start + e.clientX - d.x)));
      draftTable.columnWidths[d.index] = value;
      const table = document.querySelector('#tableEditor .admissionsTable');
      if (table) {
        table.querySelectorAll('colgroup col')[d.index].style.width = value + 'px';
        table.style.width = draftTable.columnWidths.reduce((a, b) => a + b, 0) + 170 + 'px';
      }
    } else {
      const value = Math.max(48, Math.min(1000, Math.round(d.start + e.clientY - d.y)));
      draftTable.rowHeights[d.index] = value;
      const tr = document.querySelector('#tableEditor [data-table-row="' + d.index + '"]');
      if (tr) tr.style.height = value + 'px';
    }
    e.preventDefault();
  });
  const endResize = (e) => {
    if (resizeDrag && resizeDrag.id === e.pointerId) resizeDrag = null;
  };
  document.addEventListener('pointerup', endResize);
  document.addEventListener('pointercancel', endResize);
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button,[data-cell-r]');
    if (!el) return;
    try {
      if (el.dataset.my) {
        if (el.dataset.my === 'messages') {
          showMessages();
          document.getElementById('messagesDialog').showModal();
        } else {
          avatarDraft = null;
          open(el.dataset.my);
        }
        return;
      }
      if (el.id === 'removeAvatar') {
        avatarDraft = '';
        document.getElementById('avatarPreview').hidden = true;
        return;
      }
      if (el.id === 'tableSelectionReset') {
        start = end = null;
        selection = true;
        drawTable();
        return;
      }
      if (el.id === 'tableFill' || el.id === 'tableClearFill') {
        if (!start || !end) throw Error('请先点击需要填色的单元格');
        draftTable = MyModel.fill(draftTable, selectionBounds(), el.id === 'tableFill');
        drawTable();
        return;
      }
      if (el.id === 'tableMove') {
        draftTable = MyModel.move(
          draftTable,
          document.getElementById('tableMoveAxis').value,
          Number(document.getElementById('tableMoveFrom').value),
          Number(document.getElementById('tableMoveTo').value),
          document.getElementById('tableMoveSide').value,
        );
        start = end = null;
        drawTable();
        return;
      }
      if (el.id === 'tableAlign') {
        draftTable.alignment = draftTable.alignment === 'center' ? 'left' : 'center';
        drawTable();
        return;
      }
      if (el.id === 'tableSelect') {
        selection = !selection;
        drawTable();
        return;
      }
      if (!selection && el.dataset.cellR != null) {
        start = end = { r: Number(el.dataset.cellR), c: Number(el.dataset.cellC) };
        const m = selectionBounds();
        document.querySelectorAll('#tableEditor [data-cell-r]').forEach((td) => {
          const r = Number(td.dataset.cellR),
            c = Number(td.dataset.cellC);
          td.classList.toggle(
            'cellSelected',
            r >= m.r && r < m.r + m.h && c >= m.c && c < m.c + m.w,
          );
        });
        document.getElementById('myEditError').textContent = '';
        document.getElementById('tableSelectionInfo').textContent =
          '已选第 ' + (m.r + 1) + ' 行、第 ' + (m.c + 1) + ' 列，点击浅绿填充即可填色。';
        return;
      }
      if (selection && el.dataset.cellR != null) {
        const cell = { r: Number(el.dataset.cellR), c: Number(el.dataset.cellC) };
        if (!start) start = cell;
        end = cell;
        const m = MyModel.bounds(draftTable, start, end);
        drawTable();
        document.getElementById('tableSelectionInfo').textContent =
          '已选：第 ' +
          (m.r + 1) +
          '—' +
          (m.r + m.h) +
          ' 行，第 ' +
          (m.c + 1) +
          '—' +
          (m.c + m.w) +
          ' 列' +
          (!end ? '；请选择终点' : '');
        return;
      }
      if (el.dataset.insertRow != null) {
        draftTable = MyModel.insertRow(draftTable, Number(el.dataset.insertRow));
        start = end = null;
        drawTable();
        return;
      }
      if (el.dataset.deleteColumn != null) {
        const c = Number(el.dataset.deleteColumn);
        if (
          confirm(
            '删除第 ' + (c + 1) + ' 列“' + draftTable.headers[c] + '”及该列内容？点击保存后生效。',
          )
        ) {
          draftTable = MyModel.deleteColumn(draftTable, c);
          start = end = null;
          drawTable();
        }
        return;
      }
      if (el.dataset.insertColumn != null) {
        draftTable = MyModel.insertColumn(draftTable, Number(el.dataset.insertColumn));
        start = end = null;
        drawTable();
        return;
      }
      if (el.dataset.deleteRow != null) {
        if (confirm('删除这一行？点击保存后生效。')) {
          draftTable = MyModel.deleteRow(draftTable, Number(el.dataset.deleteRow));
          start = end = null;
          drawTable();
        }
        return;
      }
      if (el.id === 'tableMerge') {
        const m = selectionBounds();
        if (m.h * m.w < 2) throw Error('请至少选择两个单元格');
        if (MyModel.contents(draftTable, m).length > 1)
          document.getElementById('mergeChoiceDialog').showModal();
        else {
          draftTable = MyModel.merge(draftTable, m, 'all');
          start = end = null;
          drawTable();
        }
        return;
      }
      if (el.dataset.mergeChoice) {
        draftTable = MyModel.merge(draftTable, selectionBounds(), el.dataset.mergeChoice);
        start = end = null;
        document.getElementById('mergeChoiceDialog').close();
        drawTable();
        return;
      }
      if (el.id === 'tableUnmerge') {
        draftTable = MyModel.unmerge(draftTable, selectionBounds());
        start = end = null;
        drawTable();
        return;
      }
      if (el.id === 'readAllMessages' || el.dataset.readMessage || el.dataset.message) {
        const ids =
          el.id === 'readAllMessages'
            ? messages.filter((m) => m.targetRole === role).map((m) => m.id)
            : [el.dataset.readMessage || el.dataset.message];
        await markMessagesRead(ids);
        await refresh();
        showMessages();
        if (el.dataset.message) {
          const msg = messages.find((m) => m.id === el.dataset.message),
            task = tasks.find((t) => t.id === msg?.taskId);
          if (!task || !canViewTask(task)) {
            toast('此任务已删除，学生端无法查看');
            return;
          }
          document.getElementById('messagesDialog').close();
          selected = task.id;
          shown = Math.max(30, TaskModel.history(task, now()).length);
          StudyUI.beginTask();
          renderDetail();
          document.getElementById('detailDialog').showModal();
          document
            .querySelector('#detailBody [data-round="' + CSS.escape(msg.round || '') + '"]')
            ?.scrollIntoView({ block: 'start' });
        }
        return;
      }
    } catch (err) {
      if (document.getElementById('myEditDialog').open)
        document.getElementById('myEditError').textContent = err.message;
      else toast(err.message);
    }
  });
  document.getElementById('myEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    saving = true;
    document.getElementById('mySave').disabled = true;
    try {
      if (role !== profileRole) throw Error('身份已变化，请重新打开编辑');
      const old = get(editKind === 'profile' ? 'profile:' + role : 'shared'),
        out = MyModel.copy(old);
      if (editKind === 'profile') {
        out.nickname = document.getElementById('myNickname').value.trim();
        if (!out.nickname) throw Error('请输入昵称');
        if (avatarDraft !== null) out.avatar = avatarDraft;
      } else if (editKind === 'goals') {
        out.school = document.getElementById('targetSchool').value.trim();
        const values = {};
        document.querySelectorAll('[data-goal]').forEach((field) => {
          values[field.dataset.goal] = {};
          field
            .querySelectorAll('[data-goal-field]')
            .forEach(
              (input) => (values[field.dataset.goal][input.dataset.goalField] = input.value),
            );
        });
        out.goals = MyModel.goals(values, TaskModel.SUBJECTS);
        for (const sub of MyModel.GOAL_EXTRAS) if (!out.goals[sub]) out.goals[sub] = null;
      } else out.table = MyModel.validateTable(draftTable);
      await saveMyPreference(out, expected);
      await refresh();
      document.getElementById('myEditDialog').close();
      toast('已保存');
    } catch (err) {
      document.getElementById('myEditError').textContent = err.message;
    } finally {
      saving = false;
      document.getElementById('mySave').disabled = false;
    }
  });
  document.getElementById('myEditDialog').addEventListener('cancel', (e) => {
    if (saving) e.preventDefault();
  });
  return {
    set,
    page,
    unread,
    showMessages,
    get editing() {
      return document.getElementById('myEditDialog').open || saving;
    },
  };
})();
