'use strict';
const StudyUI = (() => {
  const S = StudyModel,
    esc = (v) =>
      String(v ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
  const byId = (id) => document.getElementById(id);
  let entries = [],
    available = true,
    semestersReady = true,
    draft = null,
    folderDraft = null,
    viewer = null,
    viewerUrls = [],
    taskMode = 'records';
  const state = {
    materials: { search: '', subject: '', uploader: '', folder: '', semesters: [] },
    exams: {
      search: '',
      subject: '',
      folder: '',
      semesters: [],
      mode: 'papers',
      filtersOpen: false,
      from: '',
      to: '',
      fullScore: '',
      base: '100',
      rankType: 'class',
    },
    task: { from: '', to: '', completion: 'all', completionChosen: false },
  };
  const colors = ['#e8f0e9', '#dceafb', '#eee1f6', '#fae6ca', '#f6dfe2', '#d9eeee'];
  const options = (values, selected, empty) =>
    `${empty ? `<option value="">${esc(empty)}</option>` : ''}${values.map((v) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;
  const subjectSelect = (id, value) =>
    `<label>学科<select id="${id}">${options(S.SUBJECTS, value, '全部学科')}</select></label>`;
  const choices = (id, values = []) =>
    '<div class="semesterChoices" id="' +
    id +
    '">' +
    S.SEMESTERS.map(
      (v) =>
        '<label><input type="checkbox" value="' +
        v +
        '" ' +
        (values.includes(v) ? 'checked' : '') +
        '><span>' +
        v +
        '</span></label>',
    ).join('') +
    '</div>';
  const semesterSummary = (values) =>
    values.length
      ? values
          .map((v) => '<span class="semesterValue">' + esc(TaskModel.semesterLabel(v)) + '</span>')
          .join('、')
      : '全部学期';
  const semesterControl = (id, values = []) =>
    '<div class="semesterField"><span>所属学期</span><details class="semesterFilter semesterDropdown"><summary aria-label="所属学期，多选">' +
    semesterSummary(values) +
    '</summary>' +
    choices(id, values) +
    '</details></div>';
  const picked = (id) => [...byId(id).querySelectorAll('input:checked')].map((x) => x.value);
  const size = (n) =>
    n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB';
  function set(list, ready = true, features) {
    entries = list || [];
    available = ready;
    semestersReady = features ? !!features.semesters : true;
  }
  function folders(scope) {
    return entries.filter((x) => x.type === 'folder' && x.scope === scope);
  }
  const libraryViews = LibraryViews.create(() => ({
    state,
    available,
    entries,
    options,
    subjectSelect,
    semesterControl,
    examChart,
    S,
    folders,
    esc,
  }));
  function page(scope) {
    return libraryViews.page(scope);
  }
  function results(scope) {
    return libraryViews.results(scope);
  }
  function redraw() {
    if (byId('libraryResults')) byId('libraryResults').innerHTML = results(tab);
    if (byId('examChart')) byId('examChart').innerHTML = examChart();
  }
  function chart(points, series, max, { ranking = false, id = 'chart', table = '' } = {}) {
    if (!points.length) return '<div class="empty">所选时间范围暂无记录</div>';
    const W = 720,
      H = 310,
      L = 54,
      R = ranking ? 60 : 25,
      T = 24,
      B = 58,
      pw = W - L - R,
      ph = H - T - B;
    const first = points[0].time,
      last = points.at(-1).time;
    const x = (i) =>
      first === last ? L + pw / 2 : L + ((points[i].time - first) / (last - first)) * pw;
    const maxRank = Math.max(
      2,
      ...series.filter((s) => s.rank).flatMap((s) => points.map((p) => p[s.key] || 1)),
    );
    const y = (value, rank) =>
      rank ? T + ((value - 1) / (maxRank - 1)) * ph : T + (1 - value / max) * ph;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${ranking ? '成绩及排名趋势' : '作业自评分及老师评分趋势'}">`;
    for (let n = 0; n <= 5; n++) {
      const yy = T + (ph * n) / 5;
      svg += `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="#e2e9e4"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" class="axisText">${+(max * (1 - n / 5)).toFixed(1)}</text>`;
      if (ranking)
        svg += `<text x="${W - R + 8}" y="${yy + 4}" class="axisText">${Math.round(1 + ((maxRank - 1) * n) / 5)}</text>`;
    }
    const maxTicks = innerWidth < 600 ? 3 : 5;
    const ticks = [
      ...new Set([
        0,
        ...Array.from({ length: Math.min(maxTicks, points.length) }, (_, i) =>
          Math.round(
            (i * (points.length - 1)) / Math.max(1, Math.min(maxTicks, points.length) - 1),
          ),
        ),
        points.length - 1,
      ]),
    ];
    for (const i of ticks)
      svg += `<text x="${x(i)}" y="${H - B + 24}" text-anchor="middle" class="axisText">${S.dateLabel(points[i].time).slice(5)}</text>`;
    svg += `<text x="${L}" y="${H - 7}" class="axisText">${S.dateLabel(first)} — ${S.dateLabel(last)}</text>`;
    const info = points.map((p) => p.info || '');
    series.forEach((s) => {
      let segment = [];
      const flush = () => {
        if (segment.length > 1)
          svg += `<polyline points="${segment.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.8"/>`;
        segment = [];
      };
      points.forEach((p, i) => {
        const v = p[s.key];
        if (v == null || !Number.isFinite(v)) {
          flush();
          return;
        }
        segment.push(x(i) + ',' + y(v, s.rank));
      });
      flush();
      points.forEach((p, i) => {
        const v = p[s.key];
        if (v == null || !Number.isFinite(v)) return;
        const message = info[i] + ' · ' + s.name + ' ' + (s.rank ? v : +v.toFixed(2));
        svg += [
          `<circle cx="${x(i)}" cy="${y(v, s.rank)}" r="5" fill="${s.color}" tabindex="0" role="button" data-chart-info="${esc(message)}" data-chart-target="${id}Info" aria-label="${esc(message)}">`,
          `<title>`,
          `${esc(message)}</title>`,
          `</circle>`,
        ].join('');
      });
    });
    return [
      `<section class="card chartCard">`,
      `<div class="chartLegend">`,
      `${series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}${s.rank ? '（右轴，越小越好）' : '（左轴，满分 ' + max + '）'}</span>`).join('')}</div>`,
      `${svg + '</svg>'}<p id="${id}Info" class="chartInfo" role="status">点击图中圆点查看详情</p>`,
      `${table}</section>`,
    ].join('');
  }
  function examChart() {
    try {
      const f = state.exams,
        points = S.exams(entries, f).map((p) => ({
          ...p,
          info: `${p.name} · ${S.dateLabel(p.time)} · 原始成绩 ${p.score}/${p.fullScore} · 班级第${p.rank ?? '—'}名 · 年级第${p.gradeRank ?? '—'}名`,
        }));
      return chart(
        points,
        [
          { key: 'plottedScore', name: '成绩', color: '#26745b' },
          {
            key: 'plottedRank',
            name: f.rankType === 'grade' ? '年级排名' : '班级排名',
            color: '#496bbc',
            rank: true,
          },
          ...(points.some((p) => p.plottedTarget != null)
            ? [{ key: 'plottedTarget', name: '目标分数', color: '#c89a23' }]
            : []),
        ],
        Number(f.base),
        {
          ranking: true,
          id: 'exam',
          table: [
            `<div class="tableScroll">`,
            `<table>`,
            `<thead>`,
            `<tr>`,
            `<th>试卷</th>`,
            `<th>考试日期</th>`,
            `<th>原始成绩</th>`,
            `<th>`,
            `${f.base}分制</th>`,
            `<th>目标（${f.base}分制）</th>`,
            `<th>`,
            `${f.rankType === 'grade' ? '年级排名' : '班级排名'}</th>`,
            `</tr>`,
            `</thead>`,
            `<tbody>`,
            `${points
              .map((p) =>
                [
                  `<tr>`,
                  `<td>`,
                  `<button data-library-view="${p.id}">`,
                  `${esc(p.name)}</button>`,
                  `</td>`,
                  `<td>`,
                  `${S.dateLabel(p.time)}</td>`,
                  `<td>`,
                  `${p.score}/${p.fullScore}</td>`,
                  `<td>`,
                  `${+p.plottedScore.toFixed(2)}</td>`,
                  `<td>`,
                  `${p.plottedTarget == null ? '—' : +p.plottedTarget.toFixed(2)}</td>`,
                  `<td>`,
                  `${p.plottedRank ?? '—'}</td>`,
                  `</tr>`,
                ].join(''),
              )
              .join('')}</tbody>`,
            `</table>`,
            `</div>`,
          ].join(''),
        },
      );
    } catch (e) {
      return `<p class="error">${esc(e.message)}</p>`;
    }
  }
  function taskTabs(task) {
    const f = state.task;
    return task.kind === 'recurring'
      ? [
          `<div class="taskDetailControls detailTabs">`,
          `<div class="taskModeButtons">`,
          `<button data-task-mode="records" class="${taskMode === 'records' ? 'primary' : ''}">完成记录</button>`,
          `<button data-task-mode="chart" class="${taskMode === 'chart' ? 'primary' : ''}">评分趋势</button>`,
          `</div>`,
          `<label class="completionSelect ${f.completionChosen ? 'chosen' : ''}">`,
          `<select id="roundCompletionFilter" aria-label="完成状态">`,
          `<option value="" disabled hidden ${!f.completionChosen ? 'selected' : ''}>完成状态</option>`,
          `<option value="all" ${f.completionChosen && f.completion === 'all' ? 'selected' : ''}>全部任务</option>`,
          `<option value="done" ${f.completionChosen && f.completion === 'done' ? 'selected' : ''}>已完成任务</option>`,
          `<option value="pending" ${f.completionChosen && f.completion === 'pending' ? 'selected' : ''}>未完成任务</option>`,
          `</select>`,
          `</label>`,
          `</div>`,
        ].join('')
      : '';
  }
  function taskScore(value, empty) {
    return value == null
      ? empty
      : '<span class="' + TaskModel.scoreColor(value) + '">' + value + '</span>';
  }
  function taskChart(task, records) {
    const f = state.task;
    let content;
    try {
      const points = S.taskPoints(records, task.id, f.from, f.to).map((p) => ({
        ...p,
        info: `${p.round} · 提交 ${TaskModel.display(p.completed)}`,
      }));
      content = chart(
        points,
        [
          { key: 'selfScore', name: '作业自评分', color: '#496bbc' },
          { key: 'teacherScore', name: '老师评分', color: '#26745b' },
        ],
        10,
        {
          id: 'task',
          table: [
            `<div class="tableScroll">`,
            `<table>`,
            `<thead>`,
            `<tr>`,
            `<th>轮次</th>`,
            `<th>提交时间</th>`,
            `<th>作业自评分</th>`,
            `<th>老师评分</th>`,
            `</tr>`,
            `</thead>`,
            `<tbody>`,
            `${points.map((p) => `<tr><td>${esc(p.round)}</td><td>${TaskModel.display(p.completed)}</td><td>${taskScore(p.selfScore, '未评分')}</td><td>${taskScore(p.teacherScore, '待评分')}</td></tr>`).join('')}</tbody>`,
            `</table>`,
            `</div>`,
          ].join(''),
        },
      );
    } catch (e) {
      content = `<p class="error">${esc(e.message)}</p>`;
    }
    return [
      `${taskTabs(task)}<div class="filterPanel">`,
      `<label>开始日期<input id="taskChartFrom" type="date" value="${f.from}">`,
      `</label>`,
      `<label>结束日期<input id="taskChartTo" type="date" value="${f.to}">`,
      `</label>`,
      `<button data-range="task">最近90天</button>`,
      `<button data-range="task-all">全部时间</button>`,
      `</div>`,
      `${content}`,
    ].join('');
  }
  function beginTask() {
    taskMode = 'records';
    state.task.completion = 'all';
    state.task.completionChosen = false;
    state.task.from = '';
    state.task.to = '';
  }
  function showEditor(type, old) {
    if (typeof Cloud !== 'undefined' && !semestersReady) {
      toast('请先更新 v1.5.1 云端接口，再上传或修改资料');
      return;
    }
    const scope = type === 'exam' ? 'exams' : 'materials';
    draft = {
      id: old?.id || uid(),
      type,
      expected: old?.revision,
      files: old?.files || [],
      uploaded: [],
      selected: [],
    };
    byId('libraryForm').reset();
    byId('libraryError').textContent = '';
    byId('libraryEditorTitle').textContent =
      (old ? '编辑' : '上传') + (type === 'exam' ? '试卷' : '资料');
    byId('libraryName').value = old?.name || '';
    byId('libraryNameLabel').textContent = type === 'exam' ? '试卷名称' : '资料名称';
    byId('editLibrarySubject').innerHTML = options(S.SUBJECTS, old?.subject, '请选择学科');
    byId('editLibraryUploader').value = old?.uploader || '';
    byId('uploaderLabel').classList.toggle('hidden', type === 'exam');
    byId('editLibraryUploader').required = type === 'material';
    byId('editLibraryFolder').innerHTML = options(
      folders(scope).map((x) => x.id),
      old?.folderId || state[scope].folder,
      '不放入文件夹',
    );
    for (const option of byId('editLibraryFolder').options) {
      if (option.value)
        option.textContent = folders(scope).find((f) => f.id === option.value)?.name || '';
    }
    byId('examFields').classList.toggle('hidden', type !== 'exam');
    byId('materialSemesterLabel').classList.toggle('hidden', type !== 'material');
    const folder = folders(scope).find((f) => f.id === (old?.folderId || state[scope].folder));
    byId('materialSemesters').innerHTML = choices(
      'materialSemesterChoices',
      old ? old.semesters || ['七年级上学期'] : folder?.semesters || [],
    );
    byId('editTargetScore').value = old?.targetScore ?? '';
    byId('editSemester').innerHTML = options(S.SEMESTERS, old?.semester, '请选择学期');
    byId('editFullScore').value = old?.fullScore ?? '';
    for (const [id, key] of [
      ['editScore', 'score'],
      ['editRank', 'rank'],
      ['editGradeRank', 'gradeRank'],
      ['editNotes', 'notes'],
    ])
      byId(id).value = old?.[key] ?? '';
    byId('editExamDate').value = old?.examDate ? S.dateLabel(old.examDate) : '';
    for (const id of [
      'editSemester',
      'editFullScore',
      'editScore',
      'editRank',
      'editNotes',
      'editExamDate',
    ])
      byId(id).required = false;
    byId('editLibrarySubject').required = type === 'material';
    byId('libraryFiles').required = !old;
    byId('libraryFileSummary').textContent = old
      ? '已保存 ' + old.files.length + ' 个文件；新选择的文件会追加。'
      : '';
    byId('libraryDialog').showModal();
  }
  function showFolder(scope, old) {
    if (typeof Cloud !== 'undefined' && !semestersReady) {
      toast('请先更新 v1.5.1 云端接口，再创建或修改文件夹');
      return;
    }
    folderDraft = { id: old?.id || uid(), scope, expected: old?.revision };
    byId('folderForm').reset();
    byId('folderError').textContent = '';
    byId('folderName').value = old?.name || '';
    byId('folderColor').value = old?.color || colors[0];
    byId('folderSemesters').innerHTML = choices(
      'folderSemesterChoices',
      old ? old.semesters || ['七年级上学期'] : [],
    );
    folderPreview();
    byId('folderDialog').showModal();
  }
  function folderPreview() {
    byId('folderPreview').style.background = byId('folderColor').value;
    byId('folderPreview').textContent = byId('folderName').value.trim() || '文件夹名称';
  }
  function releaseViewer() {
    viewerUrls.forEach(URL.revokeObjectURL);
    viewerUrls = [];
  }
  function isImageFile(file) {
    return (
      /^image\//i.test(file.contentType || file.blob?.type || '') ||
      /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name || '')
    );
  }
  function previewFile(entry, index) {
    const scope = entry.type === 'exam' ? 'exams' : 'materials',
      f = state[scope],
      list = S.filter(
        entries.filter(
          (x) => x.type === entry.type && (x.folderId || '') === (entry.folderId || ''),
        ),
        f,
      ),
      queue = list.flatMap((x) => x.files.map((file) => ({ entry: x, file }))),
      selected = queue.findIndex((x) => x.entry.id === entry.id && x.file === entry.files[index]);
    FileViewer.open(queue, Math.max(0, selected));
  }
  function view(entry) {
    viewer = entry;
    releaseViewer();
    byId('libraryViewTitle').textContent = entry.name;
    byId('libraryViewBody').innerHTML = [
      `<p>`,
      `<span class="badge green">`,
      `${esc(entry.subject)}</span>`,
      `${entry.type === 'exam' ? `<span class="badge">${esc(entry.semester)}</span>` : `<span class="badge">${entry.uploader === 'teacher' ? '老师' : '学生'}</span>`}</p>`,
      `${entry.type === 'material' ? `<p class="muted">${(entry.semesters || ['七年级上学期']).map(esc).join('、')}</p>` : ''}${
        entry.type === 'exam'
          ? [
              `<p class="paperScore">成绩 ${entry.score ?? '—'}/${entry.fullScore ?? '—'} · 班级第 ${entry.rank ?? '—'} 名 · 年级第 ${entry.gradeRank ?? '—'} 名${entry.targetScore == null ? '' : ' · 目标 ' + entry.targetScore + ' 分'}</p>`,
              `<p>考试日期：${entry.examDate ? S.dateLabel(entry.examDate) : '未设置'}</p>`,
              `<div class="content">`,
              `${esc(entry.notes)}</div>`,
            ].join('')
          : ''
      }<div class="fileList">`,
      `${entry.files
        .map((file, i) => {
          let url = file.url;
          if (file.blob) {
            url = URL.createObjectURL(file.blob);
            viewerUrls.push(url);
          }
          return [
            `<article class="fileRow">`,
            `${isImageFile(file) ? `<img class="filePreview" src="${esc(url)}" alt="${esc(file.name)}" data-file-preview="${i}" title="点击全屏查看">` : '<div class="fileIcon">' + esc(file.name.split('.').at(-1).toUpperCase()) + '</div>'}<div class="fileMeta">`,
            `<strong>`,
            `${esc(file.name)}</strong>`,
            `<p class="muted">`,
            `${size(file.size || file.blob?.size || 0)}</p>`,
            `</div>`,
            `<button data-file-open="${i}">查看</button>`,
            `<button data-file-download="${i}">下载</button>`,
            `</article>`,
          ].join('');
        })
        .join('')}</div>`,
      `<div class="actions">`,
      `<button data-library-edit="${entry.id}">编辑 / 移动</button>`,
      `<button class="danger" data-library-delete="${entry.id}">删除</button>`,
      `</div>`,
    ].join('');
    byId('libraryViewer').showModal();
  }
  document.body.insertAdjacentHTML(
    'beforeend',
    [
      `<dialog id="libraryDialog">`,
      `<div class="dialogHead">`,
      `<h3 id="libraryEditorTitle">`,
      `</h3>`,
      `<button data-close="libraryDialog">关闭</button>`,
      `</div>`,
      `<form id="libraryForm">`,
      `<div class="fields">`,
      `<label class="full">`,
      `<span id="libraryNameLabel">资料名称</span>`,
      `<input id="libraryName" required>`,
      `</label>`,
      `<label>学科<select id="editLibrarySubject" required>`,
      `</select>`,
      `</label>`,
      `<label id="uploaderLabel">上传人身份<select id="editLibraryUploader" required>`,
      `<option value="">请选择身份</option>`,
      `<option value="student">学生</option>`,
      `<option value="teacher">老师</option>`,
      `</select>`,
      `</label>`,
      `<label class="full">放入文件夹<select id="editLibraryFolder">`,
      `</select>`,
      `</label>`,
      `</div>`,
      `<div id="materialSemesterLabel">`,
      `<label>所属学期（必选，可多选）</label>`,
      `<div id="materialSemesters">`,
      `</div>`,
      `</div>`,
      `<div id="examFields" class="fields">`,
      `<label>所属学期<select id="editSemester">`,
      `</select>`,
      `</label>`,
      `<label>试卷满分<input id="editFullScore" type="number" min="0" step="any" placeholder="输入本次试卷满分">`,
      `</label>`,
      `<label>成绩<input id="editScore" type="number" min="0" step="any">`,
      `</label>`,
      `<label>目标分数（选填）<input id="editTargetScore" type="number" min="0" step="any">`,
      `</label>`,
      `<label>班级排名（选填）<input id="editRank" type="number" min="1" step="1">`,
      `</label>`,
      `<label>年级排名（选填）<input id="editGradeRank" type="number" min="1" step="1">`,
      `</label>`,
      `<label>考试日期<input id="editExamDate" type="date">`,
      `</label>`,
      `<label class="full">备注<textarea id="editNotes" placeholder="选填">`,
      `</textarea>`,
      `</label>`,
      `</div>`,
      `<label>选择文件<input id="libraryFiles" type="file" multiple>`,
      `</label>`,
      `<p id="libraryFileSummary" class="muted">`,
      `</p>`,
      `<div id="libraryError" class="error">`,
      `</div>`,
      `<button id="librarySave" type="submit" class="primary">保存</button>`,
      `</form>`,
      `</dialog>`,
      `<dialog id="folderDialog">`,
      `<div class="dialogHead">`,
      `<h3>文件夹设置</h3>`,
      `<button data-close="folderDialog">关闭</button>`,
      `</div>`,
      `<form id="folderForm">`,
      `<label>文件夹名称<input id="folderName" required>`,
      `</label>`,
      `<label>所属学期（必选，可多选）</label>`,
      `<div id="folderSemesters">`,
      `</div>`,
      `<label>封面底色<input id="folderColor" type="color" value="${colors[0]}">`,
      `</label>`,
      `<div class="colorChoices">`,
      `${colors.map((c) => `<button type="button" data-folder-color="${c}" style="background:${c}" aria-label="底色${c}"></button>`).join('')}</div>`,
      `<div id="folderPreview" class="folderCover">`,
      `</div>`,
      `<div id="folderError" class="error">`,
      `</div>`,
      `<button id="folderSave" type="submit" class="primary">保存文件夹</button>`,
      `</form>`,
      `</dialog>`,
      `<dialog id="libraryViewer">`,
      `<div class="dialogHead">`,
      `<h3 id="libraryViewTitle">`,
      `</h3>`,
      `<button data-close="libraryViewer">关闭</button>`,
      `</div>`,
      `<div id="libraryViewBody">`,
      `</div>`,
      `</dialog>`,
    ].join(''),
  );
  byId('folderName').addEventListener('input', folderPreview);
  byId('folderColor').addEventListener('input', folderPreview);
  byId('libraryFiles').addEventListener('change', () => {
    const next = [...byId('libraryFiles').files];
    if (!next.every((f, i) => f === draft.selected[i]) || next.length !== draft.selected.length) {
      draft.uploaded = [];
      draft.selected = next;
    }
    byId('libraryFileSummary').textContent = '已选择 ' + next.length + ' 个文件';
  });
  byId('folderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    byId('folderSave').disabled = true;
    try {
      const entry = S.validate({
        id: folderDraft.id,
        type: 'folder',
        scope: folderDraft.scope,
        semesters: picked('folderSemesterChoices'),
        name: byId('folderName').value,
        color: byId('folderColor').value,
      });
      await writeLibrary(entry, folderDraft.expected);
      byId('folderDialog').close();
      await refresh();
      toast('文件夹已保存');
    } catch (err) {
      byId('folderError').textContent = err.message;
    } finally {
      busy = false;
      byId('folderSave').disabled = false;
    }
  });
  byId('libraryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !draft) return;
    busy = true;
    byId('librarySave').disabled = true;
    try {
      const input = {
        id: draft.id,
        type: draft.type,
        name: byId('libraryName').value,
        subject: byId('editLibrarySubject').value,
        uploader: byId('editLibraryUploader').value,
        folderId: byId('editLibraryFolder').value,
        semester: byId('editSemester').value,
        semesters: picked('materialSemesterChoices'),
        targetScore:
          byId('editTargetScore').value === '' ? null : Number(byId('editTargetScore').value),
        fullScore: byId('editFullScore').value === '' ? null : Number(byId('editFullScore').value),
        score: byId('editScore').value === '' ? null : Number(byId('editScore').value),
        rank: byId('editRank').value === '' ? null : Number(byId('editRank').value),
        gradeRank: byId('editGradeRank').value === '' ? null : Number(byId('editGradeRank').value),
        examDate: S.date(byId('editExamDate').value),
        notes: byId('editNotes').value,
        files: [...draft.files, ...draft.selected],
      };
      S.validate(input);
      for (let i = draft.uploaded.length; i < draft.selected.length; i++) {
        const file = draft.selected[i];
        if (!file.size) throw Error('不能上传空文件：' + file.name);
        const saved =
          typeof Cloud !== 'undefined'
            ? await Cloud.uploadLibrary(file, draft.type, role, (done, total) => {
                byId('librarySave').textContent =
                  '正在上传 ' +
                  (i + 1) +
                  '/' +
                  draft.selected.length +
                  ' · ' +
                  Math.round((done / total) * 100) +
                  '%';
              })
            : { name: file.name, contentType: file.type, size: file.size, blob: file };
        draft.uploaded.push(saved);
      }
      input.files = [...draft.files, ...draft.uploaded];
      byId('librarySave').textContent = '正在保存…';
      await writeLibrary(S.validate(input), draft.expected);
      byId('libraryDialog').close();
      if (byId('libraryViewer').open) byId('libraryViewer').close();
      await refresh();
      toast('已保存并同步');
    } catch (err) {
      byId('libraryError').textContent = err.message;
    } finally {
      busy = false;
      byId('librarySave').disabled = false;
      byId('librarySave').textContent = '保存';
    }
  });
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button,[data-chart-info],[data-file-preview]');
    if (!el) return;
    try {
      if (el.dataset.folderDelete) {
        const item = entries.find((x) => x.id === el.dataset.folderDelete);
        if (
          !item ||
          busy ||
          !confirm('删除文件夹“' + item.name + '”？其中的资料和文件会保留，并移至本页根目录。')
        )
          return;
        busy = true;
        el.disabled = true;
        try {
          if (typeof Cloud !== 'undefined') {
            if (!cloudFeatures.folderDelete)
              throw Error('请先部署3.0云端接口（build49），再删除文件夹');
            await Cloud.request('/api/library/delete', {
              method: 'POST',
              role,
              body: { id: item.id, expected: item.revision },
            });
          } else
            await new Promise((resolve, reject) => {
              const tx = db.transaction('library', 'readwrite'),
                st = tx.objectStore('library'),
                get = st.get(item.id);
              get.onsuccess = () => {
                if (get.result?.revision !== item.revision) {
                  tx.abort();
                  return;
                }
                const cursor = st.openCursor();
                cursor.onsuccess = () => {
                  const c = cursor.result;
                  if (!c) return;
                  if (c.value.folderId === item.id)
                    c.update({ ...c.value, folderId: null, revision: c.value.revision + 1 });
                  c.continue();
                };
                st.delete(item.id);
              };
              tx.oncomplete = () => {
                changed();
                resolve();
              };
              tx.onabort = () => reject(Error('文件夹已变更，请重试'));
            });
          if (state[tab].folder === item.id) state[tab].folder = '';
          await refresh();
          toast('文件夹已删除，资料已保留');
        } finally {
          busy = false;
          el.disabled = false;
        }
      } else if (el.dataset.libraryDelete) {
        const item = entries.find((x) => x.id === el.dataset.libraryDelete);
        if (!item || !confirm('删除“' + item.name + '”？将从双方的资料列表和成绩分析中移除。'))
          return;
        if (typeof Cloud !== 'undefined')
          await Cloud.request('/api/library/delete', {
            method: 'POST',
            role,
            body: { id: item.id, expected: item.revision },
          });
        else
          await new Promise((resolve, reject) => {
            const tx = db.transaction('library', 'readwrite'),
              st = tx.objectStore('library'),
              req = st.get(item.id);
            req.onsuccess = () => {
              if (req.result?.revision !== item.revision) {
                tx.abort();
                return;
              }
              st.delete(item.id);
            };
            tx.oncomplete = () => {
              changed();
              resolve();
            };
            tx.onabort = () => reject(Error('资料已变更，请刷新后重试'));
          });
        if (byId('libraryViewer').open) byId('libraryViewer').close();
        await refresh();
        toast('已删除');
      } else if (el.hasAttribute('data-library-new')) showEditor(el.dataset.libraryNew);
      else if (el.dataset.libraryEdit) {
        const old = entries.find((x) => x.id === el.dataset.libraryEdit);
        if (old) showEditor(old.type, old);
      } else if (el.dataset.libraryView) {
        const item = entries.find((x) => x.id === el.dataset.libraryView);
        if (item) previewFile(item, 0);
      } else if (el.dataset.folderNew) showFolder(el.dataset.folderNew);
      else if (el.dataset.folderEdit) {
        const folder = entries.find((x) => x.id === el.dataset.folderEdit);
        if (folder) showFolder(folder.scope, folder);
      } else if (el.dataset.folderColor) {
        byId('folderColor').value = el.dataset.folderColor;
        folderPreview();
      } else if (el.dataset.folderOpen) {
        state[tab].folder = el.dataset.folderOpen;
        redraw();
      } else if (el.hasAttribute('data-folder-root')) {
        state[tab].folder = '';
        redraw();
      } else if (el.hasAttribute('data-library-clear')) {
        Object.assign(state[tab], { search: '', subject: '', uploader: '', semesters: [] });
        render();
      } else if (el.hasAttribute('data-exam-clear')) {
        Object.assign(state.exams, {
          subject: '',
          semesters: [],
          from: '',
          to: '',
          fullScore: '',
          base: '100',
          rankType: 'class',
          rangeInitialized: true,
        });
        render();
      } else if (el.dataset.examMode) {
        state.exams.mode = el.dataset.examMode;
        if (el.dataset.examMode === 'chart' && !state.exams.rangeInitialized) {
          if (!state.exams.from && !state.exams.to) setRange(state.exams);
          state.exams.rangeInitialized = true;
        }
        render();
      } else if (el.dataset.taskMode) {
        taskMode = el.dataset.taskMode;
        renderDetail();
      } else if (el.dataset.range) {
        const isTask = el.dataset.range.startsWith('task'),
          target = isTask ? state.task : state.exams;
        if (el.dataset.range.endsWith('all')) {
          target.from = '';
          target.to = '';
        } else setRange(target);
        if (isTask) renderDetail();
        else render();
      } else if (el.dataset.chartInfo)
        byId(el.dataset.chartTarget).textContent = el.dataset.chartInfo;
      else if (el.hasAttribute('data-file-open')) {
        previewFile(viewer, Number(el.dataset.fileOpen));
      } else if (el.hasAttribute('data-file-preview')) {
        previewFile(viewer, Number(el.dataset.filePreview));
      } else if (el.hasAttribute('data-file-download')) {
        if (busy) return;
        busy = true;
        el.disabled = true;
        try {
          const file = viewer.files[Number(el.dataset.fileDownload)],
            blob = file.blob || (await Cloud.fileBlob(file.uploadId));
          if (typeof AndroidPhotos !== 'undefined') await AndroidPhotos.saveFile(blob, file.name);
          else await download(blob, file.name);
        } finally {
          busy = false;
          el.disabled = false;
        }
      }
    } catch (err) {
      toast(err.message);
    }
  });
  function setRange(f) {
    const today = S.dateLabel(now());
    f.to = today;
    f.from = S.dateLabel(S.date(today) - 90 * S.DAY);
  }
  function update(e) {
    const id = e.target.id,
      v = e.target.value;
    const semesterGroup = e.target.closest('#librarySemesters,#examChartSemesters');
    if (semesterGroup && ['materials', 'exams'].includes(tab)) {
      state[tab].semesters = picked(semesterGroup.id);
      semesterGroup.closest('details').querySelector('summary').innerHTML = semesterSummary(
        state[tab].semesters,
      );
      redraw();
      return;
    }
    const map = {
      librarySearch: 'search',
      librarySubject: 'subject',
      libraryUploader: 'uploader',
      examChartSubject: 'subject',
      examFrom: 'from',
      examTo: 'to',
      examFull: 'fullScore',
      examBase: 'base',
      examRankType: 'rankType',
    };
    if (map[id] && ['materials', 'exams'].includes(tab)) {
      state[tab][map[id]] = v;
      redraw();
    }
    if (id === 'taskChartFrom' || id === 'taskChartTo') {
      state.task[id === 'taskChartFrom' ? 'from' : 'to'] = v;
      renderDetail();
    }
  }
  document.addEventListener('input', update);
  document.addEventListener('change', (e) => {
    if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') update(e);
  });
  document.addEventListener(
    'toggle',
    (e) => {
      if (e.target.classList?.contains('chartFilters')) state.exams.filtersOpen = e.target.open;
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (['Enter', ' '].includes(e.key) && e.target.dataset.chartInfo) {
      e.preventDefault();
      e.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  ['libraryDialog', 'folderDialog'].forEach((id) =>
    byId(id).addEventListener('cancel', (e) => {
      if (busy) e.preventDefault();
    }),
  );
  byId('libraryViewer').addEventListener('close', () => {
    if (!byId('photoDialog').open) releaseViewer();
  });
  return {
    set,
    page,
    taskTabs,
    taskChart,
    beginTask,
    get taskMode() {
      return taskMode;
    },
    state,
  };
})();
