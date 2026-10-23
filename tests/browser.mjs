import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { define, loader } from '../esbuild.config.mjs';

const build = await esbuild.build({
  stdin: { contents: `import { ClipboardDiff } from './src/diff';
    window.previousEnvironment = { customProperty: 'preserved by the plugin' };
    window.MonacoEnvironment = window.previousEnvironment;
    window.changes = [];
    window.mount = (clipboard, note) => {
      window.diff?.dispose();
      window.changes = [];
      window.diff = new ClipboardDiff(document.getElementById('editor'), clipboard, note, text => window.changes.push(text));
      window.diff.setTheme(true);
    };`, resolveDir: process.cwd() },
  bundle: true, format: 'iife', outfile: 'fixture.js', write: false, define, loader,
});
const outputs = new Map(build.outputFiles.map(file => [file.path.split('/').pop(), file.contents]));
const ownCss = await readFile('src/styles.css', 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><head><link rel="stylesheet" href="/fixture.css"><style>
      html,body{height:100%;margin:0;background:#1e1e1e;color:#ccc;font-family:system-ui}
      .clipboard-compare-view{height:100vh} .clipboard-compare-labels{padding:12px;display:flex}
      .clipboard-compare-labels span{flex:1} #editor{flex:1;min-height:0}
      ${ownCss}</style></head><body><div class="clipboard-compare-view">
      <div class="clipboard-compare-labels"><span>Clipboard · read only</span><span>Current note · editable</span></div>
      <div id="editor"></div></div><script src="/fixture.js"></script></body></html>`);
    return;
  }
  const name = req.url.slice(1);
  if (!outputs.has(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
  res.end(outputs.get(name));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'warning' && /worker/i.test(message.text())) errors.push(message.text()); });
let passed = 0;

async function mount(clipboard, note) {
  await page.evaluate(([a, b]) => window.mount(a, b), [clipboard, note]);
  await page.waitForFunction(() => window.diff.editor.getLineChanges() !== null);
}
async function waitValue(expected) {
  await page.waitForFunction(value => window.diff.modified.getValue() === value, expected);
}
async function restore(clipboard, note, expected = clipboard) {
  console.log(`Checking restore: ${JSON.stringify(note)} → ${JSON.stringify(clipboard)}`);
  await mount(clipboard, note);
  await page.locator('.revertButton, .arrow-revert-change').first().click();
  await waitValue(expected);
  assert.equal(await page.evaluate(() => window.changes.at(-1)), expected);
  assert.equal(await page.evaluate(() => window.diff.original.getValue()), clipboard);
  await page.evaluate(() => window.diff.modified.undo());
  await waitValue(note);
  await page.evaluate(() => window.diff.modified.redo());
  await waitValue(expected);
  passed++;
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await restore('# 今日笔记\n\n今天完成了三个任务。\n', '# 今日笔记\n\n今天完成了两个任务。\n');
  await restore('a\ninserted\nb\n', 'a\nb\n');
  await restore('a\nb\n', 'a\nremoved\nb\n');
  await restore('', 'remove everything');
  await restore('new note', '');
  await restore('first\r\nchanged\r\n', 'first\r\noriginal\r\n');

  // Preserve the upstream widget's behavior: an EOF-only blank-line restore can be a no-op.
  // This limitation is documented; users can edit the final newline on the right.
  await mount('a\n', 'a');
  await page.locator('.arrow-revert-change').click();
  assert.equal(await page.evaluate(() => window.diff.modified.getValue()), 'a');
  passed++;

  const same = '# 标题\n\n[[链接]] 和 $x_i$\n\n```ts\nconst n = 1;\n```\n';
  await mount(same, same);
  assert.equal(await page.evaluate(() => window.diff.editor.getLineChanges().length), 0);
  passed++;

  await mount('word  \n', 'word\n');
  assert.equal(await page.evaluate(() => window.diff.editor.getLineChanges().length), 0);
  await page.evaluate(() => window.diff.setIgnoreWhitespace(false));
  await page.waitForFunction(() => window.diff.editor.getLineChanges()?.length === 1);
  passed++;

  // Independent changes must be individually applicable; unchanged Markdown survives exactly.
  const clipboard = 'new top\n\nunchanged one\nunchanged two\nunchanged three\nunchanged four\n\nnew bottom';
  const note = clipboard.replace('new top', 'old top').replace('new bottom', 'old bottom');
  await mount(clipboard, note);
  await page.waitForFunction(() => window.diff.editor.getLineChanges()?.length === 2);
  await page.locator('.revertButton').first().click();
  await waitValue(note.replace('old top', 'new top'));
  await page.waitForFunction(() => window.diff.editor.getLineChanges()?.length === 1);
  passed++;

  // External updates don't call onChange or erase undo history.
  await page.evaluate(() => { window.changes = []; window.diff.setNote('external update'); });
  await waitValue('external update');
  assert.deepEqual(await page.evaluate(() => window.changes), []);
  await page.evaluate(() => window.diff.modified.undo());
  await waitValue(note.replace('old top', 'new top'));
  passed++;

  // The clipboard editor cannot be typed into; right-side edits use normal Monaco undo.
  await mount('clipboard', 'note');
  await page.evaluate(() => window.diff.editor.getOriginalEditor().focus());
  await page.keyboard.type('MUST NOT CHANGE');
  assert.equal(await page.evaluate(() => window.diff.original.getValue()), 'clipboard');
  await page.evaluate(() => {
    const editor = window.diff.editor.getModifiedEditor();
    editor.focus(); editor.setPosition({ lineNumber: 1, column: 5 });
  });
  await page.keyboard.type(' edited');
  await waitValue('note edited');
  await page.keyboard.press('ControlOrMeta+z');
  await waitValue('note');
  passed++;

  await mount('# 今日笔记\n\n今天完成了三个任务。\n\n这一段保持不变。\n\n## 下一步\n\n- [x] 阅读论文\n- [ ] 整理笔记\n', '# 今日笔记\n\n今天完成了两个任务。\n\n这一段保持不变。\n\n## 下一步\n\n- [ ] 阅读论文\n- [ ] 整理笔记\n');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/clipboard-compare.png' });
  await page.setViewportSize({ width: 650, height: 700 });
  await page.evaluate(() => window.diff.editor.layout());
  await page.waitForFunction(() => !document.querySelector('.monaco-diff-editor.side-by-side'));
  passed++;

  await page.evaluate(() => window.diff.dispose());
  assert.equal(await page.locator('.monaco-editor').count(), 0);
  assert.equal(await page.evaluate(() => window.MonacoEnvironment === window.previousEnvironment), true);
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  console.log(`Passed ${passed} browser scenarios, including real diff arrows, undo/redo, editing, whitespace, Markdown, CRLF and responsive layout.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
