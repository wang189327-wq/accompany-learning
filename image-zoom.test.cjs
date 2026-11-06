'use strict';
const assert = require('node:assert/strict');
require('./image-zoom.js');
class Target {
  constructor() {
    this.listeners = {};
    this.style = {};
    this.dataset = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((x) => x !== fn);
  }
  emit(type, event) {
    for (const fn of this.listeners[type] || []) fn(event);
  }
}
const stage = new Target();
stage.clientWidth = 400;
stage.clientHeight = 300;
stage.getBoundingClientRect = () => ({ left: 0, top: 0 });
const image = new Target(),
  buttons = ['out', 'reset', 'in'].map((dataZoomAction) => ({
    dataset: { zoomAction: dataZoomAction },
    disabled: false,
  }));
const controls = new Target();
controls.querySelectorAll = () => buttons;
const zoom = globalThis.ImageZoom.attach(stage, image, controls);
function button(action) {
  const target = { closest: () => buttons.find((x) => x.dataset.zoomAction === action) };
  controls.emit('click', { target, preventDefault() {} });
}
image.emit('click', { clientX: 120, clientY: 90, preventDefault() {} });
assert.match(image.style.transform, /scale\(2\)/);
assert.equal(stage.dataset.zoomed, 'true');
button('out');
assert.match(image.style.transform, /scale\(1\.538/);
button('reset');
assert.match(image.style.transform, /scale\(1\)/);
assert.equal(stage.dataset.zoomed, 'false');
stage.emit('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
stage.emit('pointerdown', { pointerId: 2, clientX: 200, clientY: 100 });
stage.emit('pointermove', { pointerId: 2, clientX: 250, clientY: 100, preventDefault() {} });
assert.match(image.style.transform, /scale\(1\.5\)/);
assert.equal(stage.dataset.zoomed, 'true');
zoom.destroy();
assert.equal(stage.dataset.zoomed, undefined);
console.log('图片缩放检查通过：单击缩放、缩放按钮、双指捏合与清理。');
