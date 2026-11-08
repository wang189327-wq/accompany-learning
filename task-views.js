'use strict';
/** View rendering reads a fresh controller snapshot on every call. */
const TaskViews = (() => {
  function create(getContext) {
    const now = () => getContext().now();
    function calendarPage(list, agenda) {
      const {
        taskView,
        TaskOrdering,
        calendarDate,
        dayLabel,
        now,
        dayStart,
        M,
        recordFor,
        pendingOn,
        completedOn,
        tasks,
        escapeHTML,
        scoreHTML,
      } = getContext();

      const modes =
        '<div class="segmented viewModes">' +
        [
          ['agenda', '日程'],
          ['day', '日视图'],
          ['week', '周视图'],
          ['month', '月视图'],
        ]
          .map(
            ([key, label]) =>
              '<button data-calendar-view="' +
              key +
              '" class="' +
              (taskView === key ? 'primary' : '') +
              '">' +
              label +
              '</button>',
          )
          .join('') +
        '</div>';
      if (taskView === 'agenda')
        return (
          TaskOrdering.controls() +
          '<div class="pageHeading"><h2>作业清单</h2>' +
          modes +
          '</div>' +
          agenda
        );
      const value = calendarDate || dayLabel(now()),
        start = dayStart(value),
        month = value.slice(0, 7),
        currentMonth = new Date(start + 28800000),
        weekStart = start - ((currentMonth.getUTCDay() + 6) % 7) * M.DAY;
      const monthlyPending = list.filter(
        (t) =>
          t.enabled &&
          !t.deletedAt &&
          t.created <= now() &&
          !recordFor(t, M.period(t, now())) &&
          !M.paused(t, M.period(t, now())) &&
          ((t.kind === 'recurring' && t.rule !== 'day') ||
            (t.kind === 'once' && dayLabel(t.deadline).slice(0, 7) <= month)),
      );
      const pending = pendingOn(list, value),
        done = completedOn(value);
      const weekly = list.filter(
        (t) =>
          t.enabled &&
          !t.deletedAt &&
          t.kind === 'recurring' &&
          t.rule === 'week' &&
          t.created < weekStart + 7 * M.DAY,
      );
      let board = '';
      if (taskView !== 'day') {
        const firstMonth =
          Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), 1) - 28800000;
        const gridStart =
          taskView === 'week'
            ? weekStart
            : firstMonth - ((new Date(firstMonth + 28800000).getUTCDay() + 6) % 7) * M.DAY;
        const endMonth =
          Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 1) - 28800000;
        const count = taskView === 'week' ? 7 : Math.ceil((endMonth - gridStart) / M.DAY / 7) * 7;
        board =
          '<div class="calendarBoard"><h3>' +
          escapeHTML(
            taskView === 'week'
              ? dayLabel(weekStart) + ' — ' + dayLabel(weekStart + 6 * M.DAY)
              : month,
          ) +
          '</h3><div class="calendarGrid">' +
          ['一', '二', '三', '四', '五', '六', '日']
            .map((v) => '<div class="calendarWeekday">周' + v + '</div>')
            .join('') +
          Array.from({ length: count }, (_, i) => {
            const date = dayLabel(gridStart + i * M.DAY),
              events = completedOn(date),
              n = pendingOn(list, date).length;
            return (
              '<button class="calendarDay ' +
              (date.slice(0, 7) !== month ? 'outside ' : '') +
              (date === value ? 'current ' : '') +
              (date === dayLabel(now()) ? 'today' : '') +
              '" data-calendar-day="' +
              date +
              '" aria-label="' +
              date +
              '，完成 ' +
              events.length +
              '，待办 ' +
              n +
              '"><strong>' +
              Number(date.slice(-2)) +
              '</strong><span class="calendarDots">' +
              events
                .slice(0, 6)
                .map((r) => '<i class="calendarDot ' + (r.late ? 'purple' : '') + '"></i>')
                .join('') +
              '</span>' +
              (events.length ? '<small>完成 ' + events.length + '</small>' : '') +
              (n ? '<small>待办 ' + n + '</small>' : '') +
              '</button>'
            );
          }).join('') +
          '</div></div>';
      }
      const completion = done
        .map((r) => {
          const course = tasks.find((t) => t.id === r.taskId)?.requiresTeaching === true;
          return (
            '<article class="card calendarRecord ' +
            (course ? 'green' : r.late ? 'purple' : 'green') +
            (tasks.find((t) => t.id === r.taskId)?.createdBy === 'student' ? ' studentTask' : '') +
            (course ? ' courseTask' : '') +
            '"><span class="badge ' +
            (course ? 'green' : r.late ? 'purple' : 'green') +
            '">' +
            (r.late ? '逾期 / 补交完成' : '已完成') +
            '</span><h3>' +
            escapeHTML(r.taskName) +
            '</h3><p class="muted">' +
            M.display(r.completed) +
            '</p>' +
            scoreHTML(r) +
            '<button data-record-detail="' +
            escapeHTML(r.id) +
            '">查看此次作业</button></article>'
          );
        })
        .join('');
      const dayDetail =
        '<div class="calendarResult"><h3>' +
        value +
        '</h3><section class="taskSection"><div class="sectionTitle"><h2>当天待办</h2><span>' +
        pending.length +
        ' 个</span></div><div class="grid">' +
        (pending.map((t) => taskCard(t, start)).join('') ||
          '<p class="empty">当天没有待办作业</p>') +
        '</div></section><section class="taskSection"><div class="sectionTitle"><h2>当天完成</h2><span>' +
        done.length +
        ' 次</span></div><div class="grid">' +
        (completion || '<p class="empty">当天没有打卡记录</p>') +
        '</div></section></div>';
      return (
        '<div class="pageHeading"><h2>作业清单</h2>' +
        modes +
        '</div>' +
        (taskView === 'week'
          ? '<details class="chartFilters"><summary>本周作业 · ' +
            weekly.length +
            ' 个</summary><div class="grid">' +
            (weekly.map((t) => taskCard(t, weekStart)).join('') ||
              '<p class="empty">暂无周作业</p>') +
            '</div></details>'
          : '') +
        (taskView === 'month' && month === dayLabel(now()).slice(0, 7)
          ? '<details class="chartFilters"><summary>本月待办 · ' +
            monthlyPending.length +
            ' 个</summary><div class="grid">' +
            (monthlyPending.map((t) => taskCard(t)).join('') || '<p class="empty">暂无待办</p>') +
            '</div></details>'
          : '') +
        '<div class="calendarBar"><div class="actions"><button data-calendar-move="-1">上一' +
        (taskView === 'month' ? '月' : taskView === 'week' ? '周' : '天') +
        '</button><button id="calendarToday">今天</button><button data-calendar-move="1">下一' +
        (taskView === 'month' ? '月' : taskView === 'week' ? '周' : '天') +
        '</button><label class="datePickerButton"><span>选择日期</span><input id="calendarDate" type="date" aria-label="选择日期" value="' +
        value +
        '"></label></div></div><div class="' +
        (board ? 'calendarLayout' : '') +
        '">' +
        board +
        dayDetail +
        '</div>'
      );
    }

    function taskCard(t, at = now()) {
      const compact = getContext().tab === 'tasks' && getContext().taskView === 'agenda';
      const groupName = t.assignmentGroupId
        ? getContext().assignmentGroups?.find((group) => group.id === t.assignmentGroupId)?.name ||
          '未找到关联任务'
        : '';
      const {
        M,
        recordFor,
        now,
        TaskOrdering,
        badge,
        escapeHTML,
        kindText,
        formatText,
        scoreHTML,
        role,
        periodNoteName,
      } = getContext();

      const p = M.period(t, at),
        r = recordFor(t, p),
        base = M.status(t, p, r, now()),
        s =
          !t.enabled && !t.deletedAt
            ? { label: '已停用', color: 'purple' }
            : t.requiresTeaching
              ? { ...base, color: r ? 'green' : 'blue' }
              : base;
      return [
        `<article${TaskOrdering.card(t.id)} class="card taskCard ${s.color} ${t.createdBy === 'student' ? 'studentTask' : ''} ${t.requiresTeaching ? 'courseTask' : ''} ${!t.enabled ? 'disabledTask' : ''}">`,
        `${TaskOrdering.actions(t.id)}${badge(s)}<span class="badge${compact ? ' semesterTaskBadge' : ''}">`,
        `${escapeHTML(t.semester === undefined ? '七年级上学期' : t.semester || '学期未设置')}${compact && groupName ? ' | ' + escapeHTML(groupName) : ''}</span>`,
        `${t.requiresTeaching ? '<span class="badge blue">需要授课</span>' : ''}${t.createdBy === 'student' ? '<span class="badge blue">学生发布</span>' : ''}${t.deletedAt ? '<span class="badge red">已删除</span>' : ''}<h3>`,
        `${escapeHTML(t.name)}</h3>`,
        `${!compact && groupName ? '<p class="muted">任务：' + escapeHTML(groupName) + '</p>' : ''}`,
        `${!compact ? '<p class="muted">' + escapeHTML(t.subject || '学科未设置') + ' · ' + kindText(t) + ' · ' + formatText(t.format) + '</p>' : ''}`,
        `<p class="muted">完成时间：${M.scheduleLabel(t, p)}${t.rule === 'week' && t.weekDays?.length ? ' · ' + t.weekDays.map((d) => '周' + ['一', '二', '三', '四', '五', '六', '日'][d]).join('、') : ''}</p>`,
        `${t.note ? '<p class="muted taskNote">作业备注：' + escapeHTML(t.note) + '</p>' : ''}${t.kind === 'recurring' && M.roundNote(t, p.key) ? '<p class="muted periodNote">' + periodNoteName(t) + '：' + escapeHTML(M.roundNote(t, p.key)) + '</p>' : ''}${scoreHTML(recordFor(t, p))}<div class="actions">`,
        `${role === 'teacher' && p.key === M.period(t, now()).key && t.kind === 'recurring' && t.enabled && !t.deletedAt && !recordFor(t, p) ? `<button data-pause-round="${escapeHTML(t.id)}">${M.paused(t, p) ? '恢复' : '暂停'}${{ day: '本日', week: '本周', month: '本月' }[t.rule]}</button>` : ''}${t.kind === 'recurring' && t.rule === 'week' && !t.deletedAt ? '<button data-weekdays="' + escapeHTML(t.id) + '">完成星期</button>' : ''}<button data-detail="${escapeHTML(t.id)}">查看详情 / 历史</button>`,
        `${M.canManage(t, role) && !t.deletedAt ? `<button data-edit="${escapeHTML(t.id)}">修改</button><button data-toggle="${escapeHTML(t.id)}">${t.enabled ? '停用' : '恢复'}</button><button class="danger" data-delete="${escapeHTML(t.id)}">删除</button>` : ''}</div>`,
        `</article>`,
      ].join('');
    }

    function historyResults() {
      const {
        M,
        tasks,
        canViewTask,
        searchName,
        searchSubject,
        searchSemesters,
        role,
        searchAssignmentGroup = '',
      } = getContext();

      const list = M.filterHistory(tasks.filter(canViewTask), searchName, searchSubject)
        .filter(
          (t) =>
            !searchAssignmentGroup ||
            (searchAssignmentGroup === '__unlinked__'
              ? !t.assignmentGroupId
              : t.assignmentGroupId === searchAssignmentGroup),
        )
        .filter(
          (t) => !searchSemesters.length || searchSemesters.includes(t.semester ?? '七年级上学期'),
        )
        .sort((a, b) => b.created - a.created);
      return `<p class="muted">共 ${list.length} 个作业 · ${role === 'teacher' ? '包含停用和已删除作业' : '包含停用作业'}</p><div class="grid">${list.map((t) => taskCard(t)).join('') || '<div class="empty">没有符合条件的作业档案</div>'}</div>`;
    }
    return { calendarPage, taskCard, historyResults };
  }
  return { create };
})();
if (typeof module !== 'undefined') module.exports = TaskViews;
