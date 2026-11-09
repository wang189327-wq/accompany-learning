/*
 * 演示动图录制脚本。
 *
 * 在本地静态服务（仓库根目录）上打开 demo 页，逐场景操作并截图。
 * 每帧的字幕说明由 make-demo-gif.py 在合成时绘制到画面顶部，
 * 不在页面里注入——全屏 dialog 处于 top layer，会盖住页面内的字幕。
 *
 * 用法：
 *   1) 仓库根目录起服务：python -m http.server 8765 --bind 127.0.0.1
 *   2) node scripts/record-demo.cjs            # 截图输出到 demo-frames/
 *   3) python scripts/make-demo-gif.py         # 合成 docs/images/demo.gif
 *
 * 需要本机装有 Chrome（puppeteer-core 不会自动下载浏览器）。
 */
'use strict';

const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:8765';
const OUT_DIR = path.join(__dirname, '..', 'demo-frames');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(CHROME)) throw Error('找不到 Chrome：' + CHROME);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--window-size=520,1120', '--lang=zh-CN', '--force-color-profile=srgb'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 480, height: 1039, deviceScaleFactor: 1 });
    await page.goto(BASE + '/demo/', { waitUntil: 'networkidle0' });
    await page.waitForSelector('nav.bottomNav', { timeout: 10000 });
    await sleep(1200);

    // 字幕在合成阶段由 make-demo-gif.py 绘制，这里只负责截图。

    let index = 0;
    const frames = [];
    async function frame(caption, holdMs, afterAction) {
      // evaluate 的代码以字符串传入，与 qa-five-pages.cjs 的写法一致，
      // 避免 Node 侧 lint 把浏览器全局当未定义变量。
      await page.evaluate('window.scrollTo(0, 0)');
      await sleep(150);
      if (afterAction) await afterAction();
      await sleep(650);
      const name = `frame-${String(index).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, name) });
      frames.push({ file: name, caption, ms: holdMs });
      index += 1;
      console.log(`[${index}] ${caption}`);
    }

    async function clickNav(text) {
      await page.evaluate(
        `(function () {
          const el = [...document.querySelectorAll('nav.bottomNav button')].find((b) =>
            b.textContent.includes(${JSON.stringify(text)}),
          );
          if (!el) throw Error('找不到导航：${text}');
          el.click();
        })()`,
      );
      await sleep(700);
    }

    async function clickButton(text) {
      await page.evaluate(
        `(function () {
          const el = [...document.querySelectorAll('button')].find((b) =>
            b.textContent.includes(${JSON.stringify(text)}),
          );
          if (!el) throw Error('找不到按钮：${text}');
          el.click();
        })()`,
      );
      await sleep(700);
    }

    // ---- 场景 1：作业清单 ----
    await frame('作业清单：发布的作业和完成情况，一眼看完', 2600);

    // ---- 场景 2：日程（作业清单页内切换 日 → 周）----
    await clickButton('日程');
    await frame('日程：按天查看当天要交的作业', 2200);
    await clickButton('周视图');
    await frame('也可以切到周视图、月视图看整周安排', 2200);

    // ---- 场景 3：作业档案 ----
    await clickNav('作业档案');
    await frame('作业档案：按学期、学科筛选全部历史作业', 2400);

    // ---- 场景 4：作业详情（已完成作业，有提交与评分）----
    await clickNav('作业清单');
    await clickButton('查看详情');
    await frame('点开一条作业：提交内容和双方评分都在', 3000);
    await page.keyboard.press('Escape');
    await sleep(400);

    // ---- 场景 5：学习资料（列表 → 文件夹内）----
    await clickNav('学习资料');
    await frame('学习资料：讲义、错题本等分文件夹存放', 2400);
    await clickButton('错题与笔记');
    await frame('文件夹里的资料，老师和学生都能上传', 2400);

    // ---- 场景 6：成绩分析（列表 → 趋势）----
    await clickNav('成绩分析');
    await frame('成绩分析：录入每次考试的分数和排名', 2400);
    await clickButton('成绩趋势');
    await frame('成绩趋势：分数与班级排名的变化曲线', 3000);

    // ---- 场景 7：我的 ----
    await clickNav('我的');
    await frame('我的：消息、各科学习目标与目标院校', 2600);

    // ---- 场景 8：结尾回到作业清单 ----
    await clickNav('作业清单');
    await frame('示例数据，打开在线演示即可自由试用', 2600);

    fs.writeFileSync(path.join(OUT_DIR, 'frames.json'), JSON.stringify(frames, null, 2), 'utf8');
    console.log('完成：' + frames.length + ' 帧已写入 ' + OUT_DIR);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
