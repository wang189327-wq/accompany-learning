'use strict';
// 评分对话框：打开、复位与分数颜色。写库仍在 app.js 的 runtime 区完成。
const GradeFlow = (() => {
  function colorSelect(id) {
    const el = $(id);
    el.classList.remove('scoreGreen', 'scoreYellow', 'scoreRed', 'muted');
    if (el.value !== '') el.classList.add(M.scoreColor(Number(el.value)));
  }
  function open(id) {
    if (role !== 'teacher') return;
    const r = records.find((x) => x.id === id);
    if (!r) return;
    grading = { id, revision: r.gradeRevision || 0 };
    $('gradeForm').reset();
    $('gradeTitle').textContent = r.taskName + ' · ' + M.display(r.completed);
    $('teacherScore').value = r.teacherScore == null ? '' : String(r.teacherScore);
    colorSelect('teacherScore');
    $('gradeError').textContent = '';
    $('gradeDialog').showModal();
  }
  return { colorSelect, open };
})();
