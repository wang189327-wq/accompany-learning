'use strict';
const AssignmentGroupsUI = (() => {
  function create(context) {
    const states = new Map();
    function cancel(id) {
      const s = state(id);
      s.open = false;
      s.dirty = false;
      s.query = '';
      const input = document.getElementById(id);
      if (input) input.value = name(s.value, s.allowAll);
      update(id);
    }
    const escape = (value) => context().escapeHTML(value);
    const state = (id) => {
      if (!states.has(id))
        states.set(id, { value: '', query: '', open: false, dirty: false, active: 0 });
      return states.get(id);
    };
    function name(value, allowAll) {
      if (!value) return allowAll ? '全部任务' : '未关联任务';
      if (value === '__unlinked__') return '未关联任务';
      return context().groups.find((group) => group.id === value)?.name || '任务不存在';
    }
    function options(id) {
      const s = state(id),
        allowAll = s.allowAll;
      const choices = [
        { id: '', label: allowAll ? '全部任务' : '未关联任务' },
        ...(allowAll ? [{ id: '__unlinked__', label: '未关联任务' }] : []),
        ...AssignmentGroups.filter(context().groups, s.query).map((group) => ({
          id: group.id,
          label: group.name + ' · ' + group.subject + ' · ' + group.semester,
        })),
      ];
      s.choices = choices;
      s.active = Math.min(s.active, choices.length - 1);
      return choices
        .map(
          (choice, index) =>
            '<button type="button" role="option" id="' +
            id +
            '-option-' +
            index +
            '" aria-selected="' +
            (choice.id === s.value) +
            '" class="' +
            (index === s.active ? 'candidateActive' : '') +
            '" data-group-choice="' +
            escape(id) +
            '" data-value="' +
            escape(choice.id) +
            '">' +
            escape(choice.label) +
            '</button>',
        )
        .join('');
    }
    function html(id, value, allowAll = false) {
      const s = state(id);
      s.allowAll = allowAll;
      s.value = value || '';
      return (
        '<div class="groupPicker" data-group-picker="' +
        id +
        '"><label for="' +
        id +
        '">任务名称</label><input type="search" id="' +
        id +
        '" role="combobox" autocomplete="off" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="' +
        s.open +
        '" aria-controls="' +
        id +
        '-options" placeholder="输入任务名称关键词后选择" value="' +
        escape(s.open || s.dirty ? s.query : name(s.value, allowAll)) +
        '"><div class="groupCandidates" role="listbox" aria-label="任务名称候选" id="' +
        id +
        '-options"' +
        (s.open ? '' : ' hidden') +
        '>' +
        options(id) +
        '</div><small class="muted" id="' +
        id +
        '-selected">已选：' +
        escape(name(s.value, allowAll)) +
        '</small></div>'
      );
    }
    function update(id) {
      const s = state(id),
        input = document.getElementById(id),
        list = document.getElementById(id + '-options');
      if (!input || !list) return;
      input.setAttribute('aria-expanded', String(s.open));
      list.hidden = !s.open;
      list.innerHTML = options(id);
      input.setAttribute('aria-activedescendant', id + '-option-' + s.active);
    }
    function choose(id, value) {
      const s = state(id);
      s.value = value;
      s.query = '';
      s.open = false;
      s.dirty = false;
      const input = document.getElementById(id);
      input.value = name(value, s.allowAll);
      document.getElementById(id + '-selected').textContent = '已选：' + name(value, s.allowAll);
      update(id);
      context().onSelect(id, value);
    }
    document.addEventListener('focusin', (event) => {
      if (
        !event.target.matches('input[role="combobox"]') ||
        !event.target.closest('[data-group-picker]')
      )
        return;
      const s = state(event.target.id);
      s.open = true;
      s.query = '';
      s.active = 0;
      event.target.value = '';
      update(event.target.id);
    });
    document.addEventListener('input', (event) => {
      if (!event.target.closest('[data-group-picker]') || event.target.tagName !== 'INPUT') return;
      const s = state(event.target.id);
      s.query = event.target.value;
      s.open = true;
      s.dirty = true;
      s.active =
        s.query.trim() && AssignmentGroups.filter(context().groups, s.query).length
          ? s.allowAll
            ? 2
            : 1
          : 0;
      update(event.target.id);
    });
    document.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-group-choice]');
      if (choice) {
        choose(choice.dataset.groupChoice, choice.dataset.value);
        return;
      }
      for (const [id, s] of states) {
        if (!event.target.closest('[data-group-picker="' + id + '"]') && s.open) {
          s.open = false;
          update(id);
        }
      }
    });
    document.addEventListener('keydown', (event) => {
      const input = event.target;
      if (!input.closest('[data-group-picker]') || input.tagName !== 'INPUT') return;
      const s = state(input.id);
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        s.open = true;
        s.active = Math.max(
          0,
          Math.min(s.choices.length - 1, s.active + (event.key === 'ArrowDown' ? 1 : -1)),
        );
        update(input.id);
      } else if (event.key === 'Enter' && s.open) {
        event.preventDefault();
        choose(input.id, s.choices[s.active].id);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel(input.id);
      }
    });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<dialog id="assignmentGroupDialog"><div class="dialogHead"><h3>发布任务</h3><button data-close="assignmentGroupDialog">关闭</button></div><form id="assignmentGroupForm"><label>任务名称<input id="assignmentGroupName" required></label><label>所属学科<select id="assignmentGroupSubject" required><option value="">请选择学科</option>' +
        context()
          .M.SUBJECTS.map((value) => '<option>' + value + '</option>')
          .join('') +
        '</select></label><label>所属学期<select id="assignmentGroupSemester" required><option value="">请选择学期</option>' +
        context()
          .M.SEMESTERS.map((value) => '<option>' + value + '</option>')
          .join('') +
        '</select></label><p class="error" id="assignmentGroupError"></p><button class="primary" id="assignmentGroupPublish" type="submit">发布任务</button></form></dialog>',
    );
    document.getElementById('assignmentGroupForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.getElementById('assignmentGroupPublish');
      if (button.disabled) return;
      button.disabled = true;
      try {
        const c = context();
        const value = AssignmentGroups.validate(
          {
            id: c.uid(),
            name: document.getElementById('assignmentGroupName').value,
            subject: document.getElementById('assignmentGroupSubject').value,
            semester: document.getElementById('assignmentGroupSemester').value,
          },
          c.M.SUBJECTS,
          c.M.SEMESTERS,
        );
        await c.publish(value);
        document.getElementById('assignmentGroupDialog').close();
        await c.refresh();
        c.toast('任务发布成功');
      } catch (error) {
        document.getElementById('assignmentGroupError').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    return {
      html,
      reset(id, value = '') {
        states.set(id, { value, query: '', open: false, dirty: false, active: 0 });
      },
      value(id) {
        const s = state(id);
        if (!s.query.trim()) s.dirty = false;
        if (s.dirty) throw Error('请从候选列表中点选任务，或选择未关联任务');
        return s.value || null;
      },
      publish() {
        context().checkCapability();
        document.getElementById('assignmentGroupForm').reset();
        document.getElementById('assignmentGroupError').textContent = '';
        document.getElementById('assignmentGroupDialog').showModal();
      },
    };
  }
  return { create };
})();
