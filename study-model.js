'use strict';
(() => {
  const SUBJECTS = ['语文', '数学', '英语', '政治', '历史', '地理', '物理', '化学', '生物'];
  const SEMESTERS = ['七年级', '八年级', '九年级'].flatMap((g) =>
    ['上学期', '下学期'].map((t) => g + t),
  );
  const DAY = 86400000,
    OFFSET = 28800000;
  function text(v, label) {
    if (typeof v !== 'string' || !v.trim()) throw Error('请填写' + label);
    return v.trim();
  }
  function semesters(values) {
    if (!Array.isArray(values) || !values.length || values.some((v) => !SEMESTERS.includes(v)))
      throw Error('请选择至少一个所属学期');
    return SEMESTERS.filter((v) => values.includes(v));
  }
  function semesterMatch(entry, selected) {
    return (
      !selected?.length ||
      selected.some((v) =>
        (entry.type === 'exam'
          ? [entry.semester].filter(Boolean)
          : entry.semesters || [entry.semester || '七年级上学期']
        ).includes(v),
      )
    );
  }
  function validate(input) {
    if (!input || !['folder', 'material', 'exam'].includes(input.type)) throw Error('资料类型无效');
    const v = {
      id: input.id,
      type: input.type,
      name: text(
        input.name,
        input.type === 'exam' ? '试卷名称' : input.type === 'folder' ? '文件夹名称' : '资料名称',
      ),
    };
    if (input.type === 'folder') {
      if (!['materials', 'exams'].includes(input.scope)) throw Error('文件夹位置无效');
      if (!/^#[0-9a-f]{6}$/i.test(input.color || '')) throw Error('请选择封面底色');
      return {
        ...v,
        scope: input.scope,
        color: input.color,
        semesters: semesters(input.semesters),
      };
    }
    const optional = (v) => v == null || v === '';
    if (!SUBJECTS.includes(input.subject) && !(input.type === 'exam' && optional(input.subject)))
      throw Error('请选择学科');
    v.subject = input.subject || null;
    v.folderId = input.folderId || null;
    if (input.type === 'material') {
      if (!['student', 'teacher'].includes(input.uploader)) throw Error('请选择上传人身份');
      v.uploader = input.uploader;
      v.semesters = semesters(input.semesters);
    } else {
      if (!optional(input.semester) && !SEMESTERS.includes(input.semester))
        throw Error('所属学期无效');
      const full = optional(input.fullScore) ? null : input.fullScore,
        score = optional(input.score) ? null : input.score,
        target = optional(input.targetScore) ? null : input.targetScore;
      if (full != null && (!Number.isFinite(full) || full <= 0))
        throw Error('试卷满分须为大于 0 的数字');
      for (const [name, n] of [
        ['成绩', score],
        ['目标分数', target],
      ])
        if (n != null && (!Number.isFinite(n) || n < 0 || full == null || n > full))
          throw Error(name + '需要同时填写满分，且在 0 到满分之间');
      for (const key of ['rank', 'gradeRank'])
        if (!optional(input[key]) && (!Number.isSafeInteger(input[key]) || input[key] < 1))
          throw Error((key === 'rank' ? '班级' : '年级') + '排名必须为正整数');
      if (
        !optional(input.examDate) &&
        (!Number.isFinite(input.examDate) ||
          input.examDate <= 0 ||
          !Number.isFinite(new Date(input.examDate).getTime()))
      )
        throw Error('考试日期无效');
      Object.assign(v, {
        semester: input.semester || null,
        fullScore: full,
        score,
        rank: optional(input.rank) ? null : input.rank,
        gradeRank: optional(input.gradeRank) ? null : input.gradeRank,
        examDate: input.examDate || null,
        notes: typeof input.notes === 'string' ? input.notes.trim() : '',
        targetScore: target,
      });
    }
    if (!Array.isArray(input.files) || !input.files.length) throw Error('请至少选择一个文件');
    v.files = input.files;
    return v;
  }
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const n = Date.parse(value + 'T00:00:00+08:00');
    return Number.isFinite(n) && dateLabel(n) === value ? n : null;
  }
  function dateLabel(value) {
    return new Date(value + OFFSET).toISOString().slice(0, 10);
  }
  function bounds(from, to) {
    const start = from ? date(from) : null,
      end = to ? date(to) : null;
    if ((from && start == null) || (to && end == null)) throw Error('请选择有效日期');
    if (start != null && end != null && start > end) throw Error('开始日期不能晚于结束日期');
    return [start, end == null ? null : end + DAY];
  }
  function inRange(t, range) {
    return (
      Number.isFinite(t) &&
      (range[0] == null || t >= range[0]) &&
      (range[1] == null || t < range[1])
    );
  }
  function filter(entries, f = {}) {
    return entries.filter(
      (x) =>
        semesterMatch(x, f.semesters) &&
        (!f.subject || x.subject === f.subject) &&
        (!f.uploader || x.uploader === f.uploader) &&
        (!f.search || x.name.toLocaleLowerCase().includes(f.search.toLocaleLowerCase())),
    );
  }
  function exams(entries, f = {}) {
    const range = bounds(f.from, f.to),
      base = Number(f.base || 100);
    if (![100, 120, 150].includes(base)) throw Error('图表分制无效');
    return entries
      .filter(
        (x) =>
          x.type === 'exam' &&
          Number.isFinite(x.score) &&
          Number.isFinite(x.fullScore) &&
          x.fullScore > 0 &&
          semesterMatch(x, f.semesters) &&
          (!f.subject || x.subject === f.subject) &&
          (!f.fullScore || x.fullScore === Number(f.fullScore)) &&
          inRange(x.examDate, range),
      )
      .sort((a, b) => a.examDate - b.examDate || a.id.localeCompare(b.id))
      .map((x) => ({
        ...x,
        time: x.examDate,
        plottedScore: (x.score / x.fullScore) * base,
        plottedRank: f.rankType === 'grade' ? x.gradeRank : x.rank,
        plottedTarget: x.targetScore == null ? null : (x.targetScore / x.fullScore) * base,
      }));
  }
  function taskPoints(records, taskId, from, to) {
    const range = bounds(from, to);
    return records
      .filter((r) => r.taskId === taskId && inRange(r.completed, range))
      .sort((a, b) => a.completed - b.completed || a.id.localeCompare(b.id))
      .map((r) => ({ ...r, time: r.completed }));
  }
  globalThis.StudyModel = {
    SUBJECTS,
    SEMESTERS,
    semesters,
    semesterMatch,
    validate,
    date,
    dateLabel,
    bounds,
    filter,
    exams,
    taskPoints,
    DAY,
  };
  if (typeof module !== 'undefined') module.exports = globalThis.StudyModel;
})();
