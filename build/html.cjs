'use strict';

/** Replace one named HTML region, retaining its markers for the next platform. */
function replaceRegion(html, name, content) {
  const begin = `<!-- @build:${name}:begin -->`;
  const end = `<!-- @build:${name}:end -->`;
  const start = html.indexOf(begin);
  const finish = html.indexOf(end);
  if (
    start < 0 ||
    finish < start ||
    html.indexOf(begin, start + begin.length) >= 0 ||
    html.indexOf(end, finish + end.length) >= 0
  ) {
    throw Error(`HTML构建区域缺失、重复或顺序错误：${name}`);
  }
  return html.slice(0, start + begin.length) + '\n' + content + '\n' + html.slice(finish);
}

function scriptTags(names) {
  return names.map((name) => `<script src="${name}"></script>`).join('\n');
}

function androidStyles(shared, native) {
  // Keep the existing device-font scaling rule. Only the stylesheet is changed.
  const scaled = shared.replace(/font-size:(\s*)(\d+)px/g, (value, space, size) =>
    Number(size) === 15 ? value : `font-size:${space}${(Number(size) / 15).toFixed(4)}rem`,
  );
  return scaled + '\n' + native;
}

module.exports = { replaceRegion, scriptTags, androidStyles };
