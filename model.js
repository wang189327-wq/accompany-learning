(function (scope) {
  'use strict';
  const DAY = 86400000,
    OFFSET = 8 * 3600000;
  const SUBJECTS = ['语文', '数学', '英语', '政治', '历史', '地理', '物理', '化学', '生物'];
  const SEMESTERS = ['七年级', '八年级', '九年级'].flatMap((g) =>
    ['上学期', '下学期'].map((t) => g + t),
  );
  function semesterLabel(value) {
    return SEMESTERS.includes(value) ? value[0] + (value.includes('上') ? '上' : '下') : value;
  }
  function canManage(task, role) {
    return (
      role === 'teacher' || (role === 'student' && (task.createdBy || 'teacher') === 'student')
    );
  }
  function local(ms) {
    return new Date(ms + OFFSET);
  }
  function parse(value) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value += 'T00:00';
    const ms = Date.parse(value + ':00+08:00');
    if (!Number.isFinite(ms)) throw Error('请输入有效时间');
    return ms;
  }
  function input(ms) {
    return local(ms).toISOString().slice(0, 16);
  }
  function display(ms) {
    return ms == null ? '无截止时间' : input(ms).replace('T', ' ');
  }
  function period(task, ms) {
    if (task.kind === 'once') return { key: '单次', start: task.created, end: null };
    const d = local(ms);
    let start, end, key;
    if (task.rule === 'day') {
      start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - OFFSET;
      end = start + DAY;
      key = input(start).slice(0, 10);
    } else if (task.rule === 'month') {
      start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - OFFSET;
      end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - OFFSET;
      key = input(start).slice(0, 7);
    } else {
      start =
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
        OFFSET -
        ((d.getUTCDay() + 6) % 7) * DAY;
      end = start + 7 * DAY;
      const thursday = local(start + 3 * DAY);
      const year = thursday.getUTCFullYear();
      const jan4 = Date.UTC(year, 0, 4) - OFFSET;
      const first = jan4 - ((local(jan4).getUTCDay() + 6) % 7) * DAY;
      key = year + '-W' + String(Math.round((start - first) / (7 * DAY)) + 1).padStart(2, '0');
    }
    return { key, start, end };
  }
  function history(task, ms) {
    if (task.kind === 'once') return [period(task, ms)];
    let p = period(task, Math.min(ms, task.deletedAt || ms));
    const first = period(task, task.created).start,
      out = [];
    while (p.start >= first) {
      out.push(p);
      p = period(task, p.start - 1);
    }
    return out;
  }
  function paused(task, round) {
    return (task.pausedRounds || []).includes(typeof round === 'string' ? round : round.key);
  }
  function windowFor(task, round) {
    if (task.kind === 'once')
      return { start: task.availableFrom ?? task.created, end: task.deadline };
    if (task.dateOnly) {
      const days =
        task.rule === 'week' && task.weekDays?.length
          ? [...task.weekDays].sort((a, b) => a - b)
          : null;
      return {
        start: days ? round.start + days[0] * DAY : round.start,
        end: days ? round.start + (days.at(-1) + 1) * DAY - 1 : round.end - 1,
      };
    }
    const minutes = (value) => {
      const [h, m] = value.split(':').map(Number);
      return (h * 60 + m) * 60000;
    };
    const days =
      task.rule === 'week' && task.weekDays?.length
        ? [...task.weekDays].sort((a, b) => a - b)
        : null;
    const first = days ? round.start + days[0] * DAY : round.start,
      last = days ? round.start + days[days.length - 1] * DAY : round.end - DAY;
    return {
      start: first + minutes(task.startTime || '00:00'),
      end: task.endTime ? last + minutes(task.endTime) : days ? last + DAY : round.end,
    };
  }
  function status(task, round, record, now) {
    if (!record && paused(task, round)) return { label: '本轮暂停', color: 'gray' };
    if ((task.createdBy || 'teacher') === 'student') {
      if (record)
        return record.late
          ? { label: '逾期完成', color: 'purple' }
          : { label: '已完成', color: 'green' };
      return {
        label:
          now > windowFor(task, round).end || (task.kind === 'recurring' && round.end <= now)
            ? '已逾期'
            : '待完成',
        color: 'blue',
      };
    }
    if (record)
      return record.late
        ? record.kind === 'once'
          ? { label: '逾期完成', color: 'green' }
          : { label: '补交完成', color: 'purple' }
        : { label: '已完成', color: 'green' };
    if (task.kind === 'once' && now > task.deadline) return { label: '已逾期', color: 'red' };
    if (task.kind === 'recurring' && (windowFor(task, round).end < now || round.end <= now))
      return { label: '未完成 · 可补交', color: 'red' };
    return { label: '待完成', color: 'amber' };
  }
  const removedTests = {
    '0b4d2fc1-514a-4783-bb2f-47713af1c375': '测试作业',
    '0bc8fb74-74cc-488b-a5e5-e310f7513b68': '图片上传',
    'e2etest-20261010': 'E2E验收测试',
  };
  function historyHidden(task) {
    return !!task.historyPurged || removedTests[task.id] === task.name;
  }
  function disabledAutoOn(task, start) {
    if (task.enabled || task.format !== 'auto') return false;
    const at = task.disabledAt || task.updated || task.created;
    return start >= period({ kind: 'recurring', rule: 'day' }, at).start;
  }
  function scheduleLabel(task, round) {
    const w = windowFor(task, round),
      date = (v) => input(v).slice(0, 10);
    if (task.kind === 'recurring' && task.rule === 'week' && task.weekDays?.length)
      return [...task.weekDays]
        .sort((a, b) => a - b)
        .map((d) => date(round.start + d * DAY))
        .join('、');
    const a = date(w.start),
      b = date(w.end);
    return a === b ? a : a + ' 至 ' + b;
  }
  function indexRecords(records) {
    const byRound = new Map(),
      byDay = new Map();
    for (const r of records) {
      const key = r.taskId + '|' + r.round;
      if (!byRound.has(key)) byRound.set(key, []);
      byRound.get(key).push(r);
      const day = period({ kind: 'recurring', rule: 'day' }, r.completed).start;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(r);
    }
    for (const list of byRound.values())
      list.sort((a, b) => a.completed - b.completed || a.id.localeCompare(b.id));
    for (const list of byDay.values()) list.sort((a, b) => a.completed - b.completed);
    return { byRound, byDay };
  }
  function calendarRecords(tasks, records, start, role, index) {
    const visible = new Set(
      tasks
        .filter(
          (t) =>
            !historyHidden(t) && (role === 'teacher' || !t.deletedAt) && !disabledAutoOn(t, start),
        )
        .map((t) => t.id),
    );
    return (index?.byDay.get(start) || (!index ? records : []))
      .filter((r) => visible.has(r.taskId) && r.completed >= start && r.completed < start + DAY)
      .sort((a, b) => a.completed - b.completed);
  }
  function calendarPending(tasks, records, start, index) {
    const end = start + DAY;
    return tasks.filter((t) => {
      const p = period(t, start),
        w = windowFor(t, p);
      return (
        t.enabled &&
        !t.deletedAt &&
        !paused(t, p) &&
        t.created < end &&
        (t.kind === 'once'
          ? w.start < end && w.end >= start
          : t.rule !== 'week' ||
            !t.weekDays?.length ||
            t.weekDays.includes((local(start).getUTCDay() + 6) % 7)) &&
        !(index ? index.byRound.get(t.id + '|' + p.key) || [] : records).some(
          (r) => r.taskId === t.id && r.round === p.key && r.completed < end,
        )
      );
    });
  }
  function validateTask(task, options = {}) {
    if (task.semester != null && task.semester !== '' && !SEMESTERS.includes(task.semester))
      throw Error('请选择有效的所属学期');
    if (task.subject != null && task.subject !== '' && !SUBJECTS.includes(task.subject))
      throw Error('请选择有效学科');
    if (task.requiresTeaching !== undefined && typeof task.requiresTeaching !== 'boolean')
      throw Error('授课选项无效');
    if (typeof task.name !== 'string' || !task.name.trim()) throw Error('请填写作业名称');
    if (!['once', 'recurring'].includes(task.kind)) throw Error('作业类型无效');
    if (!['text', 'image', 'auto', 'file'].includes(task.format)) throw Error('提交形式无效');
    if (task.kind === 'once' && !Number.isFinite(task.deadline))
      throw Error('单次作业必须填写截止时间');
    if (task.kind === 'recurring' && !['day', 'week', 'month'].includes(task.rule))
      throw Error('请选择周期规则');
    if (
      task.availableFrom != null &&
      (!Number.isFinite(task.availableFrom) ||
        (task.kind === 'once' && task.availableFrom > task.deadline))
    )
      throw Error('开始时间不能晚于结束时间');
    for (const k of ['startTime', 'endTime'])
      if (task[k] != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(task[k]))
        throw Error('请选择有效时分');
    if (task.startTime && task.endTime && task.startTime > task.endTime)
      throw Error('每日开始时间不能晚于结束时间');
    if (
      task.weekDays != null &&
      (!Array.isArray(task.weekDays) ||
        !task.weekDays.length ||
        task.weekDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
        new Set(task.weekDays).size !== task.weekDays.length)
    )
      throw Error('请至少选择一个完成星期');
  }
  function submission(task, roundKey, now, text, images, selfScore) {
    if (task.format === 'auto') throw Error('默认打卡由系统自动记录，无需手动提交');
    validateScore(selfScore);
    if (task.deletedAt || !task.enabled) throw Error('作业已停用或删除，不能提交');
    if (paused(task, roundKey)) throw Error('本轮已暂停，无需提交');
    const round = history(task, now).find((x) => x.key === roundKey);
    if (!round) throw Error('该轮次尚未开始或不属于此作业');
    const window = windowFor(task, round);
    if (now < window.start) throw Error('尚未到作业可完成时间');
    if (task.kind === 'recurring' && now <= window.end) {
      const d = local(now),
        day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - OFFSET;
      if (
        task.rule === 'week' &&
        task.weekDays?.length &&
        !task.weekDays.includes((d.getUTCDay() + 6) % 7)
      )
        throw Error('今天不在作业设定的完成星期内');
      if (!task.dateOnly && task.startTime && input(now).slice(11) < task.startTime)
        throw Error('尚未到作业可完成时间');
    }
    if (task.format === 'text' && !text.trim()) throw Error('请填写成果文字');
    if (task.format === 'image' && !images.length) throw Error('请至少选择一张图片');
    if (task.format === 'file' && !images.length) throw Error('请至少选择一个文件');
    return {
      id: task.id + '|' + round.key,
      taskId: task.id,
      taskName: task.name,
      semester: task.semester ?? '七年级上学期',
      subject: task.subject || null,
      kind: task.kind,
      format: task.format,
      round: round.key,
      start: round.start,
      end: round.end,
      completed: now,
      selfScore,
      teacherScore: null,
      gradeRevision: 0,
      late:
        task.kind === 'once'
          ? now > task.deadline
          : now > windowFor(task, round).end ||
            now >= round.end ||
            (!task.dateOnly && !!task.endTime && input(now).slice(11) > task.endTime),
      text: task.format === 'text' ? text : '',
      images: task.format === 'image' ? images : [],
      files: task.format === 'file' ? images : [],
    };
  }
  function roundNote(task, key) {
    return typeof task?.roundNotes?.[key] === 'string' ? task.roundNotes[key] : '';
  }
  function withRoundNote(task, key, text, ms) {
    if (task.kind !== 'recurring') throw Error('仅周期作业支持本周期备注');
    if (typeof text !== 'string') throw Error('周期备注格式无效');
    if (!history(task, ms).some((p) => p.key === key) && !task._rounds?.[key])
      throw Error('轮次尚未开始或不属于此作业');
    return { ...task, roundNotes: { ...(task.roundNotes || {}), [key]: text.trim() } };
  }
  function validateScore(score) {
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 10)
      throw Error('请选择 0–10 分的整数分数');
    return score;
  }
  function scoreColor(score) {
    if (score == null) return 'muted';
    validateScore(score);
    return score >= 8 ? 'scoreGreen' : score >= 5 ? 'scoreYellow' : 'scoreRed';
  }
  function grade(record, score, time) {
    validateScore(score);
    return {
      ...record,
      teacherScore: score,
      gradedAt: time,
      gradeRevision: (record.gradeRevision || 0) + 1,
    };
  }
  function filterHistory(tasks, name, subject) {
    const needle = String(name || '')
      .trim()
      .toLocaleLowerCase();
    return tasks.filter(
      (t) =>
        (!needle || t.name.toLocaleLowerCase().includes(needle)) &&
        (!subject || (subject === 'unset' ? !t.subject : t.subject === subject)),
    );
  }
  function autoDates(task, ms) {
    if (task.format !== 'auto' || !task.enabled || task.deletedAt) return [];
    if (task.kind === 'once') {
      const completed = Math.max(
        task.created,
        task.availableFrom ?? task.created,
        task.autoStartAt || task.created,
      );
      return completed > ms
        ? []
        : [
            {
              round: '单次',
              date: input(completed).slice(0, 10),
              start: task.availableFrom ?? task.created,
              end: task.deadline,
              completed,
            },
          ];
    }
    const first = Math.max(
        task.created,
        task.autoStartAt || task.created,
        task.autoScheduleFrom || 0,
      ),
      day = period({ kind: 'recurring', rule: 'day' }, first).start,
      out = [];
    for (let at = day; at <= ms; at += DAY) {
      const p = period(task, at);
      if (paused(task, p)) continue;
      if (task.rule === 'week' && !(task.weekDays || [6]).includes((local(at).getUTCDay() + 6) % 7))
        continue;
      if (task.rule === 'month' && at + DAY < p.end) continue;
      const completed = Math.max(at, first);
      if (completed <= ms)
        out.push({
          round: p.key,
          date: input(at).slice(0, 10),
          start: p.start,
          end: p.end,
          completed,
        });
    }
    return out;
  }
  scope.TaskModel = {
    indexRecords,
    semesterLabel,
    historyHidden,
    disabledAutoOn,
    scheduleLabel,
    autoDates,
    windowFor,
    roundNote,
    withRoundNote,
    paused,
    calendarRecords,
    calendarPending,
    SEMESTERS,
    canManage,
    validateScore,
    scoreColor,
    grade,
    SUBJECTS,
    filterHistory,
    DAY,
    parse,
    input,
    display,
    period,
    history,
    status,
    validateTask,
    submission,
  };
})(globalThis);
