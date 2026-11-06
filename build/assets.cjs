'use strict';

// Order matters: models precede views; views precede their controllers.
const BROWSER_SCRIPTS = [
  'runtime-config.js',
  'startup-watch.js',
  'model.js',
  'attachment-cache.js',
  'cloud-client.js',
  'study-model.js',
  'library-views.js',
  'study-ui.js',
  'task-order.js',
  'zip-reader.js',
  'docx-reader.js',
  'image-zoom.js',
  'file-viewer.js',
  'my-model.js',
  'my-page.js',
  'font-settings.js',
  'background-settings.js',
  'task-views.js',
  'app.js',
  'pull-refresh.js',
];
const ANDROID_SCRIPTS = BROWSER_SCRIPTS.flatMap((name) =>
  name === 'app.js' ? ['android-client.js', name] : [name],
);
const SHARED_SCRIPTS = BROWSER_SCRIPTS.filter(
  (name) => !['runtime-config.js', 'startup-watch.js', 'cloud-client.js', 'app.js'].includes(name),
);
const RESOURCE_DIRECTORIES = ['pdf-cmaps', 'pdf-fonts', 'pdf-wasm', 'third-party-notices'];

module.exports = { BROWSER_SCRIPTS, ANDROID_SCRIPTS, SHARED_SCRIPTS, RESOURCE_DIRECTORIES };
