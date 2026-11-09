(function (scope) {
  'use strict';
  const HEADERS = ['年份', '学校', '学校录取分数线', '年级排名', '全市录取分数线', '全市排名'];
  const GOAL_EXTRAS = ['体育', '实验', '总分'],
    LIGHT_GREEN = '#e5f2e5';
  const goalSubjects = (subjects) => [...new Set([...subjects, ...GOAL_EXTRAS])];
  const copy = (v) => JSON.parse(JSON.stringify(v));
  function table() {
    return {
      headers: [...HEADERS],
      rows: [Array(6).fill('')],
      merges: [],
      alignment: 'center',
      columnWidths: Array(6).fill(130),
      rowHeights: [null],
    };
  }
  function validateTable(t) {
    const columns = Array.isArray(t?.headers)
      ? t.headers.length
      : Array.isArray(t?.rows?.[0])
        ? t.rows[0].length
        : 0;
    if (
      !t ||
      columns < 1 ||
      columns > 30 ||
      !Array.isArray(t.rows) ||
      !t.rows.length ||
      !Array.isArray(t.merges) ||
      t.rows.some(
        (r) => !Array.isArray(r) || r.length !== columns || r.some((v) => typeof v !== 'string'),
      )
    )
      throw Error('录取表格格式无效');
    if (
      t.headers !== undefined &&
      (!Array.isArray(t.headers) ||
        t.headers.length !== columns ||
        t.headers.some((h) => typeof h !== 'string'))
    )
      throw Error('表头格式无效');
    if (t.alignment !== undefined && !['center', 'left'].includes(t.alignment))
      throw Error('表格文字对齐方式无效');
    t.alignment = t.alignment || 'center';
    if (t.columnWidths === undefined) t.columnWidths = Array(columns).fill(130);
    if (
      !Array.isArray(t.columnWidths) ||
      t.columnWidths.length !== columns ||
      t.columnWidths.some((w) => !Number.isInteger(w) || w < 60 || w > 900)
    )
      throw Error('列宽无效（60—900 像素）');
    if (t.rowHeights === undefined) t.rowHeights = Array(t.rows.length).fill(null);
    if (
      !Array.isArray(t.rowHeights) ||
      t.rowHeights.length !== t.rows.length ||
      t.rowHeights.some((h) => h !== null && (!Number.isInteger(h) || h < 48 || h > 1000))
    )
      throw Error('行高无效（48—1000 像素）');
    const used = new Set();
    for (const m of t.merges) {
      if (
        ![m.r, m.c, m.h, m.w].every(Number.isInteger) ||
        m.r < 0 ||
        m.c < 0 ||
        m.h < 1 ||
        m.w < 1 ||
        m.r + m.h > t.rows.length ||
        m.c + m.w > columns ||
        m.h * m.w < 2
      )
        throw Error('合并区域无效');
      for (let r = m.r; r < m.r + m.h; r++)
        for (let c = m.c; c < m.c + m.w; c++) {
          const key = r + ',' + c;
          if (used.has(key)) throw Error('合并区域重叠');
          used.add(key);
        }
    }
    if (t.fillColor != null && t.fillColor !== LIGHT_GREEN) throw Error('表格填充颜色无效');
    if (t.cellFills !== undefined) {
      if (!t.cellFills || typeof t.cellFills !== 'object' || Array.isArray(t.cellFills))
        throw Error('单元格填充无效');
      for (const [key, color] of Object.entries(t.cellFills)) {
        const [r, c] = key.split(',').map(Number);
        if (
          key !== r + ',' + c ||
          !Number.isInteger(r) ||
          !Number.isInteger(c) ||
          r < 0 ||
          c < 0 ||
          r >= t.rows.length ||
          c >= columns ||
          ![LIGHT_GREEN, '#ffffff'].includes(color)
        )
          throw Error('单元格填充无效');
      }
    }
    return t;
  }
  function bounds(t, a, b) {
    let r = Math.min(a.r, b.r),
      c = Math.min(a.c, b.c),
      er = Math.max(a.r, b.r),
      ec = Math.max(a.c, b.c),
      change = true;
    while (change) {
      change = false;
      for (const m of t.merges)
        if (m.r <= er && m.r + m.h - 1 >= r && m.c <= ec && m.c + m.w - 1 >= c) {
          const next = [
            Math.min(r, m.r),
            Math.min(c, m.c),
            Math.max(er, m.r + m.h - 1),
            Math.max(ec, m.c + m.w - 1),
          ];
          if (next.some((v, i) => v !== [r, c, er, ec][i])) {
            [r, c, er, ec] = next;
            change = true;
          }
        }
    }
    if (r < 0 || c < 0 || er >= t.rows.length || ec >= t.rows[0].length)
      throw Error('请选择表格内连续区域');
    return { r, c, h: er - r + 1, w: ec - c + 1 };
  }
  function contents(t, m) {
    const values = [];
    for (let r = m.r; r < m.r + m.h; r++)
      for (let c = m.c; c < m.c + m.w; c++) if (t.rows[r][c].trim()) values.push(t.rows[r][c]);
    return values;
  }
  function merge(t, m, mode) {
    validateTable(t);
    const out = copy(t),
      values = contents(out, m);
    if (m.h * m.w < 2) throw Error('请至少选择两个单元格');
    if (values.length > 1 && !['all', 'first'].includes(mode)) throw Error('请选择内容保留方式');
    for (let r = m.r; r < m.r + m.h; r++) for (let c = m.c; c < m.c + m.w; c++) out.rows[r][c] = '';
    out.rows[m.r][m.c] = mode === 'first' ? values[0] || '' : values.join('\n');
    out.merges = out.merges.filter(
      (x) => !(x.r < m.r + m.h && x.r + x.h > m.r && x.c < m.c + m.w && x.c + x.w > m.c),
    );
    out.merges.push(m);
    return validateTable(out);
  }
  function unmerge(t, m) {
    const out = copy(t);
    out.merges = out.merges.filter(
      (x) => !(x.r < m.r + m.h && x.r + x.h > m.r && x.c < m.c + m.w && x.c + x.w > m.c),
    );
    return out;
  }
  function deleteRow(t, row) {
    if (t.rows.length <= 1) throw Error('至少保留一行');
    const out = copy(t);
    for (const m of out.merges)
      if (m.r === row && m.h > 1) out.rows[row + 1][m.c] = out.rows[row][m.c];
    remapFills(out, (r, c) => (r === row ? null : [r > row ? r - 1 : r, c]));
    out.rows.splice(row, 1);
    out.rowHeights.splice(row, 1);
    out.merges = out.merges.flatMap((m) => {
      if (m.r > row) m.r--;
      else if (m.r <= row && row < m.r + m.h) m.h--;
      return m.h * m.w > 1 ? [m] : [];
    });
    return validateTable(out);
  }
  function insertRow(t, index) {
    validateTable(t);
    if (!Number.isInteger(index) || index < 0 || index > t.rows.length)
      throw Error('新增行位置无效');
    const out = copy(t);
    remapFills(out, (r, c) => [r >= index ? r + 1 : r, c]);
    out.rows.splice(index, 0, Array(out.headers.length).fill(''));
    out.rowHeights.splice(index, 0, null);
    for (const m of out.merges) {
      if (index <= m.r) m.r++;
      else if (index < m.r + m.h) m.h++;
    }
    return validateTable(out);
  }
  function insertColumn(t, index) {
    validateTable(t);
    const columns = t.headers.length;
    if (columns >= 30) throw Error('最多保留 30 列');
    if (!Number.isInteger(index) || index < 0 || index > columns) throw Error('新增列位置无效');
    const out = copy(t);
    remapFills(out, (r, c) => [r, c >= index ? c + 1 : c]);
    out.headers.splice(index, 0, '新列');
    out.columnWidths.splice(index, 0, 130);
    for (const row of out.rows) row.splice(index, 0, '');
    for (const m of out.merges) {
      if (index <= m.c) m.c++;
      else if (index < m.c + m.w) m.w++;
    }
    return validateTable(out);
  }
  function deleteColumn(t, column) {
    validateTable(t);
    const columns = t.rows[0].length;
    if (columns <= 1) throw Error('至少保留一列');
    if (!Number.isInteger(column) || column < 0 || column >= columns) throw Error('删除列位置无效');
    const out = copy(t);
    out.headers = out.headers || [...HEADERS];
    for (const m of out.merges)
      if (m.c === column && m.w > 1) out.rows[m.r][column + 1] = out.rows[m.r][column];
    remapFills(out, (r, c) => (c === column ? null : [r, c > column ? c - 1 : c]));
    out.headers.splice(column, 1);
    out.columnWidths.splice(column, 1);
    for (const row of out.rows) row.splice(column, 1);
    out.merges = out.merges.flatMap((m) => {
      if (m.c > column) m.c--;
      else if (m.c <= column && column < m.c + m.w) m.w--;
      return m.h * m.w > 1 ? [m] : [];
    });
    return validateTable(out);
  }
  function remapFills(t, map) {
    if (!t.cellFills) return;
    const out = {};
    for (const [key, color] of Object.entries(t.cellFills)) {
      const v = map(...key.split(',').map(Number));
      if (v) out[v.join(',')] = color;
    }
    t.cellFills = out;
  }
  function fill(t, m, color) {
    validateTable(t);
    const out = copy(t);
    if (!m) {
      out.fillColor = color ? LIGHT_GREEN : null;
      out.cellFills = {};
    } else {
      m = bounds(out, { r: m.r, c: m.c }, { r: m.r + m.h - 1, c: m.c + m.w - 1 });
      out.cellFills = out.cellFills || {};
      for (let r = m.r; r < m.r + m.h; r++)
        for (let c = m.c; c < m.c + m.w; c++)
          out.cellFills[r + ',' + c] = color ? LIGHT_GREEN : '#ffffff';
    }
    return validateTable(out);
  }
  function move(t, axis, from, to, side = 'before') {
    validateTable(t);
    if (!['row', 'column'].includes(axis) || !['before', 'after'].includes(side))
      throw Error('移动方式无效');
    const row = axis === 'row',
      count = row ? t.rows.length : t.rows[0].length,
      pos = row ? 'r' : 'c',
      span = row ? 'h' : 'w';
    if (![from, to].every((x) => Number.isInteger(x) && x >= 0 && x < count))
      throw Error('移动位置无效');
    let lo = from,
      hi = from,
      changed = true;
    while (changed) {
      changed = false;
      for (const m of t.merges)
        if (m[pos] <= hi && m[pos] + m[span] - 1 >= lo) {
          const a = Math.min(lo, m[pos]),
            b = Math.max(hi, m[pos] + m[span] - 1);
          if (a !== lo || b !== hi) {
            lo = a;
            hi = b;
            changed = true;
          }
        }
    }
    const boundary = to + (side === 'after' ? 1 : 0);
    if (boundary >= lo && boundary <= hi + 1) return copy(t);
    const order = Array.from({ length: count }, (_, i) => i),
      block = order.splice(lo, hi - lo + 1);
    order.splice(boundary > hi ? boundary - block.length : boundary, 0, ...block);
    const map = [];
    order.forEach((old, i) => (map[old] = i));
    for (const m of t.merges) {
      const indices = Array.from({ length: m[span] }, (_, i) => map[m[pos] + i]).sort(
        (a, b) => a - b,
      );
      if (indices.some((v, i) => v !== indices[0] + i))
        throw Error('目标位置会拆开合并单元格，请选择合并区域外的位置');
    }
    const out = copy(t);
    if (row) {
      out.rows = order.map((i) => out.rows[i]);
      out.rowHeights = order.map((i) => out.rowHeights[i]);
    } else {
      out.headers = order.map((i) => (out.headers || HEADERS)[i]);
      out.columnWidths = order.map((i) => out.columnWidths[i]);
      out.rows = out.rows.map((r) => order.map((i) => r[i]));
    }
    for (const m of out.merges)
      m[pos] = Math.min(...Array.from({ length: m[span] }, (_, i) => map[m[pos] + i]));
    remapFills(out, (r, c) => (row ? [map[r], c] : [r, map[c]]));
    return validateTable(out);
  }
  function goals(value, subjects) {
    const out = {};
    for (const s of goalSubjects(subjects)) {
      const v = value[s] || {},
        any = [v.full, v.score, v.rank].some((x) => x !== '' && x != null);
      if (!any) continue;
      const full = Number(v.full),
        score = Number(v.score),
        rank = Number(v.rank);
      if (
        [v.full, v.score, v.rank].some((x) => x === '' || x == null) ||
        !Number.isFinite(full) ||
        full <= 0 ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > full ||
        !Number.isInteger(rank) ||
        rank < 1
      )
        throw Error(s + '：请填写满分、有效目标分数和正整数排名');
      out[s] = { full, score, rank };
    }
    return out;
  }
  function reminder(config) {
    if (!config) return null;
    if (
      !['minutes', 'hours', 'days'].includes(config.unit) ||
      !Number.isFinite(config.amount) ||
      config.amount <= 0
    )
      throw Error('提醒提前量须为大于 0 的数字');
    const ms = config.amount * { minutes: 60000, hours: 3600000, days: 86400000 }[config.unit];
    if (!Number.isFinite(ms)) throw Error('提醒提前量过大');
    return { amount: config.amount, unit: config.unit };
  }
  function due(task, records, time, M) {
    if (!task.reminder || task.deletedAt || !task.enabled || task.created > time) return null;
    const p = M.period(task, time);
    if (M.paused(task, p) || records.some((r) => r.taskId === task.id && r.round === p.key))
      return null;
    const cfg = reminder(task.reminder),
      cutoff = M.windowFor(task, p).end,
      lead = cfg.amount * { minutes: 60000, hours: 3600000, days: 86400000 }[cfg.unit];
    if (time < cutoff - lead) return null;
    return {
      id: 'reminder:' + task.id + ':' + p.key,
      targetRole: 'student',
      kind: 'reminder',
      taskId: task.id,
      round: p.key,
      title: '作业完成提醒',
      body:
        task.name +
        ' · ' +
        p.key +
        '\n' +
        (task.kind === 'once' ? '截止时间：' : '本轮结束时间：') +
        M.display(cutoff),
      created: time,
      read: false,
    };
  }
  const api = {
    GOAL_EXTRAS,
    LIGHT_GREEN,
    goalSubjects,
    fill,
    move,
    HEADERS,
    copy,
    table,
    validateTable,
    bounds,
    contents,
    merge,
    unmerge,
    deleteRow,
    insertRow,
    insertColumn,
    deleteColumn,
    goals,
    reminder,
    due,
  };
  scope.MyModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
