'use strict';
// 提交记录的只读渲染。输出与原 app.js 内联版本一致，供 app.js 与 task-views.js 共用。
const SubmissionViews = (() => {
  function score(record) {
    if (!record) return '';
    if (record.automatic || record.format === 'auto') return '<p class="muted">自动打卡</p>';
    const line = (value, empty) =>
      value == null
        ? '<span class="muted">' + empty + '</span>'
        : '<strong class="' + M.scoreColor(value) + '">' + value + ' / 10 分</strong>';
    return (
      '<div class="scores"><span>作业自评分：' +
      line(record.selfScore, '未评分（旧记录）') +
      '</span><span>老师评分：' +
      line(record.teacherScore, '待评分') +
      '</span></div>'
    );
  }
  function record(r) {
    let html =
      '<article class="submissionRecord" data-submission="' +
      escapeHTML(r.id) +
      '"><p class="muted">提交时作业名称：' +
      escapeHTML(r.taskName) +
      '<br>学科：' +
      escapeHTML(r.subject || '未设置') +
      '<br>提交形式：' +
      formatText(r.format) +
      '<br>完成时间：' +
      M.display(r.completed) +
      '</p>';
    if (r.automatic || r.format === 'auto') return html + '<p>自动打卡</p></article>';
    html += score(r);
    if (role === 'teacher')
      html +=
        '<div class="actions submissionActions"><button data-grade="' +
        escapeHTML(r.id) +
        '">' +
        (r.teacherScore == null ? '老师评分' : '修改老师评分') +
        '</button>' +
        (r.format === 'file'
          ? ''
          : '<button data-ai-review="' +
            escapeHTML(r.id) +
            '"' +
            (reviewingIds.has(r.id) ? ' disabled' : '') +
            '>' +
            (receivedReviewIds.has(r.id) ? '正在点评…' : '点评作业') +
            '</button>') +
        '</div>';
    if (r.format === 'file')
      html +=
        '<div class="actions homeworkFiles">' +
        (r.files || [])
          .map(
            (f, i) =>
              '<button data-homework-file="' +
              escapeHTML(r.id) +
              '" data-file-index="' +
              i +
              '">' +
              escapeHTML(f.name) +
              '</button>',
          )
          .join('') +
        '</div>';
    else if (r.format === 'text') html += '<div class="content">' + escapeHTML(r.text) + '</div>';
    else
      html +=
        '<div class="thumbs">' +
        r.images
          .map((im, i) => {
            const u =
              typeof Cloud !== 'undefined' ? im.thumbnailUrl || im.url : localPhotoURL(im.blob);
            return (
              '<img class="thumb" loading="lazy" decoding="async" data-media-key="' +
              escapeHTML(im.uploadId || im.key || r.id + '|' + i) +
              '" src="' +
              escapeHTML(u) +
              '" data-photo="' +
              escapeHTML(r.id) +
              '" data-index="' +
              i +
              '" alt="作业图片">'
            );
          })
          .join('') +
        '</div>';
    return (
      html +
      (r.aiReview?.text
        ? '<section class="aiReview"><strong>AI点评</strong><div class="aiReviewText">' +
          escapeHTML(r.aiReview.text) +
          '</div></section>'
        : '') +
      '</article>'
    );
  }
  return { score, record };
})();
