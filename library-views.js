'use strict';
/** View rendering reads a fresh controller snapshot on every call. */
const LibraryViews = (() => {
  function create(getContext) {
    function page(scope) {
      const { state, available, entries, options, subjectSelect, semesterControl, examChart, esc } =
        getContext();

      const f = state[scope],
        exam = scope === 'exams';
      if (!available)
        return '<section class="card"><div class="pageHeading"><h2>云端功能待更新</h2></div><p>请先更新 C9 云端接口，再刷新页面。</p></section>';
      if (exam && f.mode === 'chart')
        return [
          `<div class="pageHeading">`,
          `<h2>成绩分析</h2>`,
          `<div class="pageActions">`,
          `<div class="segmented">`,
          `<button data-exam-mode="papers">试卷库</button>`,
          `<button class="primary" data-exam-mode="chart">成绩趋势</button>`,
          `</div>`,
          `</div>`,
          `</div>`,
          `<details class="chartFilters" ${f.filtersOpen ? 'open' : ''}>`,
          `<summary>筛选与分制设置</summary>`,
          `<div class="filterPanel">`,
          `${subjectSelect('examChartSubject', f.subject)}${semesterControl('examChartSemesters', f.semesters)}<label>开始日期<input id="examFrom" type="date" value="${f.from}">`,
          `</label>`,
          `<label>结束日期<input id="examTo" type="date" value="${f.to}">`,
          `</label>`,
          `<label>试卷满分<select id="examFull">`,
          `${options(
            [
              ...new Set([
                100,
                120,
                150,
                ...entries
                  .filter(
                    (x) => x.type === 'exam' && Number.isFinite(x.fullScore) && x.fullScore > 0,
                  )
                  .map((x) => x.fullScore),
              ]),
            ].sort((a, b) => a - b),
            f.fullScore,
            '全部满分',
          )}</select>`,
          `</label>`,
          `<label>图表分制<select id="examBase">`,
          `${options([100, 120, 150], f.base).replace('>100</option>', '>百分制</option>').replace('>120</option>', '>120分制</option>').replace('>150</option>', '>150分制</option>')}</select>`,
          `</label>`,
          `<label>排名类型<select id="examRankType">`,
          `<option value="class" ${f.rankType !== 'grade' ? 'selected' : ''}>班级排名</option>`,
          `<option value="grade" ${f.rankType === 'grade' ? 'selected' : ''}>年级排名</option>`,
          `</select>`,
          `</label>`,
          `<button data-range="exam">最近90天</button>`,
          `<button data-range="exam-all">全部时间</button>`,
          `<button data-exam-clear>清空筛选</button>`,
          `</div>`,
          `</details>`,
          `<div id="examChart">`,
          `${examChart()}</div>`,
        ].join('');
      return [
        `<div class="pageHeading">`,
        `<h2>`,
        `${exam ? '成绩分析' : '学习资料'}</h2>`,
        `<div class="pageActions">`,
        `${exam ? '<div class="segmented"><button class="primary" data-exam-mode="papers">试卷库</button><button data-exam-mode="chart">成绩趋势</button></div>' : ''}</div>`,
        `</div>`,
        `<div class="filterPanel">`,
        `<label class="searchField">`,
        `${exam ? '试卷' : '资料'}名称<input id="librarySearch" type="search" value="${esc(f.search)}" placeholder="输入名称关键词">`,
        `</label>`,
        `${subjectSelect('librarySubject', f.subject)}${semesterControl('librarySemesters', f.semesters)}${
          exam
            ? ''
            : [
                `<label>上传人<select id="libraryUploader">`,
                `<option value="">全部身份</option>`,
                `<option value="student" ${f.uploader === 'student' ? 'selected' : ''}>学生</option>`,
                `<option value="teacher" ${f.uploader === 'teacher' ? 'selected' : ''}>老师</option>`,
                `</select>`,
                `</label>`,
              ].join('')
        }<button data-library-clear>清空筛选</button>`,
        `</div>`,
        `<div class="toolbar">`,
        `<button class="primary" data-library-new="${exam ? 'exam' : 'material'}">＋ ${exam ? '上传试卷' : '上传资料'}</button>`,
        `<button data-folder-new="${scope}">＋ 新建文件夹</button>`,
        `</div>`,
        `<div id="libraryResults">`,
        `${results(scope)}</div>`,
      ].join('');
    }

    function results(scope) {
      const { state, S, entries, folders, esc } = getContext();

      const f = state[scope],
        type = scope === 'exams' ? 'exam' : 'material';
      const all = S.filter(
          entries.filter((x) => x.type === type),
          f,
        ),
        filtering = !!(f.search || f.subject || f.uploader || f.semesters.length);
      const scopeFolders = folders(scope),
        folderById = new Map(scopeFolders.map((x) => [x.id, x])),
        counts = new Map();
      for (const x of all) counts.set(x.folderId, (counts.get(x.folderId) || 0) + 1);
      const selected = folderById.get(f.folder);
      if (f.folder && !selected) {
        f.folder = '';
      }
      const dirs = f.folder
        ? []
        : scopeFolders.filter(
            (dir) =>
              !filtering ||
              (S.semesterMatch(dir, f.semesters) && !f.search && !f.subject && !f.uploader) ||
              counts.has(dir.id),
          );
      const list = all.filter((x) =>
        f.folder ? x.folderId === f.folder : filtering || !x.folderId,
      );
      return [
        `${selected ? `<div class="breadcrumbs"><button data-folder-root>全部文件夹</button><strong>${esc(selected.name)}</strong></div>` : ''}${
          dirs.length
            ? [
                `<div class="folderGrid">`,
                `${dirs
                  .map((dir) =>
                    [
                      `<article class="folderCard">`,
                      `<button class="folderCover" style="background:${dir.color}" data-folder-open="${dir.id}">`,
                      `${esc(dir.name)}</button>`,
                      `<div class="folderFoot">`,
                      `<span>`,
                      `${counts.get(dir.id) || 0} 份</span>`,
                      `<button data-folder-edit="${dir.id}" aria-label="编辑${esc(dir.name)}">编辑</button>`,
                      `<button class="danger" data-folder-delete="${dir.id}">删除</button>`,
                      `</div>`,
                      `</article>`,
                    ].join(''),
                  )
                  .join('')}</div>`,
              ].join('')
            : ''
        }<div class="grid">`,
        `${
          list
            .map((x) =>
              [
                `<article class="card resourceCard">`,
                `<span class="badge green">`,
                `${esc(x.subject || '学科未设置')}</span>`,
                `${x.type === 'material' ? `<span class="badge">${x.uploader === 'teacher' ? '老师' : '学生'}</span>` : `<span class="badge">${esc(x.semester || '学期未设置')}</span>`}<h3>`,
                `${esc(x.name)}</h3>`,
                `${x.type === 'material' ? `<p class="muted">${(x.semesters || ['七年级上学期']).map(esc).join('、')}</p>` : ''}${
                  x.type === 'exam'
                    ? [
                        `<p class="paperScore">`,
                        `<strong>`,
                        `${x.score ?? '—'}</strong> / ${x.fullScore ?? '—'} 分 <span>班级第 ${x.rank ?? '—'} 名 · 年级第 ${x.gradeRank ?? '—'} 名</span>`,
                        `</p>`,
                        `<p class="muted">考试日期：${x.examDate ? S.dateLabel(x.examDate) : '未设置'}${x.targetScore == null ? '' : ' · 目标 ' + x.targetScore + ' 分'}</p>`,
                      ].join('')
                    : ''
                }<p class="muted">`,
                `${x.files.length} 个文件${x.folderId ? ' · ' + esc(folderById.get(x.folderId)?.name || '文件夹') : ''}</p>`,
                `<div class="actions">`,
                `<button data-library-view="${x.id}">查看${x.type === 'exam' ? '试卷' : '资料'}</button>`,
                `<button data-library-edit="${x.id}">编辑 / 移动</button>`,
                `<button class="danger" data-library-delete="${x.id}">删除</button>`,
                `</div>`,
                `</article>`,
              ].join(''),
            )
            .join('') || '<p class="empty">暂无符合条件的文件</p>'
        }</div>`,
      ].join('');
    }
    return { page, results };
  }
  return { create };
})();
if (typeof module !== 'undefined') module.exports = LibraryViews;
