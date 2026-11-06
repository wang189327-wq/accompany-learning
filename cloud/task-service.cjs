'use strict';
/** Task writes share the service clock and conditional-update policy. */
function createTaskService({
  store,
  clock,
  M,
  extras,
  assignmentGroups,
  taskGet,
  visibleTask,
  libraryRole,
  id,
  round,
  role,
  fail,
}) {
  return {
    async saveWeekDays(body, who) {
      libraryRole(who);
      const old = await taskGet(body.taskId);
      if (old.deletedAt || old.kind !== 'recurring' || old.rule !== 'week')
        fail(400, '只有每周周期作业可修改完成星期');
      if (old.revision !== body.expected) fail(409, '作业已变更，请重新打开');
      const next = {
        ...old,
        weekDays: body.weekDays,
        autoScheduleFrom:
          old.format === 'auto' ? M.period(old, clock()).start : old.autoScheduleFrom || null,
        dateOnly: true,
        startTime: null,
        endTime: null,
        updated: clock(),
        revision: old.revision + 1,
      };
      try {
        M.validateTask(next, { requireSemester: true });
      } catch (e) {
        fail(400, e.message);
      }
      extras.taskEvent(next, old, who);
      await store.putTask(next, old.revision);
      return visibleTask(next);
    },
    async saveTaskOrder(body, who) {
      libraryRole(who);
      if (
        !Array.isArray(body.ids) ||
        body.ids.some((v) => typeof v !== 'string' || !/^[-a-zA-Z0-9_]{1,100}$/.test(v)) ||
        new Set(body.ids).size !== body.ids.length
      )
        fail(400, '排序内容无效');
      const ids = new Set((await store.listTasks()).filter((t) => !t.deletedAt).map((t) => t.id));
      if (body.ids.some((id) => !ids.has(id))) fail(409, '作业列表已变更，请取消并重新排序');
      const old = await store.getRecord('__c9_prefs__', who);
      if (old ? old.gradeRevision !== body.expected : body.expected != null)
        fail(409, '同一角色的排序已在其他设备更新，请取消并重试');
      const next = {
        taskId: '__c9_prefs__',
        round: who,
        ids: body.ids,
        gradeRevision: (old?.gradeRevision || 0) + 1,
      };
      await store.putRecord(next, old?.gradeRevision ?? null);
      return { ids: next.ids, revision: next.gradeRevision };
    },
    async saveTask(body, who) {
      libraryRole(who);
      const { task: input, expected } = body;
      if (!input || typeof input !== 'object') fail(400, '作业信息无效');
      id(input.id);
      let old = await store.getTask(input.id);
      if (old && !M.canManage(old, who)) fail(403, '只能修改或删除自己发布的作业');
      if (old?.deletedAt) fail(409, '作业已删除');
      if (old && old.revision !== expected) fail(409, '作业已变更，请刷新后重试');
      if (!old && expected != null) fail(409, '作业不存在，请刷新');
      if (input.requiresTeaching !== undefined && typeof input.requiresTeaching !== 'boolean')
        fail(400, '授课选项无效');
      input.subject = input.subject ?? old?.subject ?? '';
      input.semester = input.semester ?? old?.semester ?? '';
      input.kind = input.kind ?? old?.kind ?? 'recurring';
      input.rule = input.kind === 'once' ? null : (input.rule ?? old?.rule ?? 'day');
      input.format = input.format ?? old?.format ?? 'text';
      input.enabled = input.enabled ?? old?.enabled ?? true;
      input.requiresTeaching = input.requiresTeaching ?? old?.requiresTeaching ?? false;
      if (input.kind === 'once' && input.deadline == null) {
        input.deadline =
          old?.deadline ??
          M.parse(M.input(Math.max(clock(), input.availableFrom || 0) + M.DAY).slice(0, 10)) +
            M.DAY -
            1;
      }
      const next = {
        ...extras.teacherFields(input, old, who),
        _events: old?._events || [],
        id: input.id,
        name: typeof input.name === 'string' ? input.name.trim() : '',
        assignmentGroupId: await assignmentGroups.association(
          input.assignmentGroupId,
          old?.assignmentGroupId,
        ),
        requiresTeaching: input.requiresTeaching,
        subject: input.subject,
        semester: input.semester ?? old?.semester,
        createdBy: old?.createdBy || (old ? 'teacher' : who),
        kind: input.kind,
        rule: input.kind === 'once' ? null : input.rule,
        format: input.format,
        autoScheduleFrom:
          old?.format === 'auto' &&
          JSON.stringify(input.weekDays ?? old.weekDays) !== JSON.stringify(old.weekDays)
            ? M.period(old, clock()).start
            : old?.autoScheduleFrom || null,
        dateOnly: input.dateOnly ?? old?.dateOnly ?? false,
        autoStartAt:
          input.format === 'auto'
            ? old?.format !== 'auto' || (!old?.enabled && input.enabled)
              ? clock()
              : old?.autoStartAt || old?.created || clock()
            : null,
        deadline: input.kind === 'once' ? input.deadline : null,
        availableFrom: input.availableFrom ?? old?.availableFrom ?? null,
        startTime: input.startTime ?? old?.startTime ?? null,
        endTime: input.endTime ?? old?.endTime ?? null,
        weekDays: input.weekDays ?? old?.weekDays ?? null,
        enabled: input.enabled,
        disabledAt: input.enabled
          ? null
          : old?.enabled === false
            ? old.disabledAt || old.updated || clock()
            : clock(),
        created: old?.created || clock(),
        updated: clock(),
        revision: (old?.revision || 0) + 1,
        _rounds: old?._rounds || {},
        pausedRounds: old?.pausedRounds || [],
      };
      M.validateTask(next, { requireSemester: true });
      if (typeof next.enabled !== 'boolean') fail(400, '启用状态无效');
      const changed =
        old && (old.kind !== next.kind || old.rule !== next.rule || old.format !== next.format);
      if (who !== 'teacher' && changed && Object.keys(old._rounds || {}).length)
        fail(409, '已有作业，不能修改类型、周期或提交形式');
      if (old && (old.kind !== next.kind || old.rule !== next.rule)) next.created = clock();
      if (input.deletedAt) {
        if (!old) fail(400, '新作业不能直接删除');
        next.deletedAt = clock();
      }
      if (input.roundNote) {
        role(who, 'teacher');
        try {
          Object.assign(
            next,
            M.withRoundNote(next, input.roundNote.round, input.roundNote.text, clock()),
          );
        } catch (e) {
          fail(400, e.message);
        }
      }
      extras.taskEvent(next, old, who);
      await store.putTask(next, old?.revision ?? null);
      return visibleTask(next);
    },
    async saveRoundNote(body, who) {
      role(who, 'teacher');
      round(body.round);
      const t = await taskGet(body.taskId);
      if (t.revision !== body.expected) fail(409, '作业已在另一设备更新，请关闭并重新打开备注');
      let next;
      try {
        next = M.withRoundNote(t, body.round, body.text, clock());
      } catch (e) {
        fail(400, e.message);
      }
      next.revision = t.revision + 1;
      next.updated = clock();
      extras.taskEvent(next, t, who);
      await store.putTask(next, t.revision);
      return visibleTask(next);
    },
    async pauseRound(body, who) {
      role(who, 'teacher');
      const t = await taskGet(body.taskId);
      if (t.deletedAt || !t.enabled || t.kind !== 'recurring')
        fail(409, '仅启用中的周期作业可以暂停本轮');
      const current = M.period(t, clock());
      if (body.round !== current.key) fail(409, '轮次已变化，请刷新');
      if (typeof body.paused !== 'boolean') fail(400, '暂停设置无效');
      if (t.revision !== body.expected) fail(409, '作业已变更，请刷新');
      if (t._rounds?.[current.key]) fail(409, '本轮已完成，无需暂停');
      const values = new Set(t.pausedRounds || []);
      if (body.paused) values.add(current.key);
      else values.delete(current.key);
      const next = { ...t, pausedRounds: [...values], revision: t.revision + 1, updated: clock() };
      extras.taskEvent(next, t, who);
      await store.putTask(next, t.revision);
      return visibleTask(next);
    },
  };
}
module.exports = { createTaskService };
