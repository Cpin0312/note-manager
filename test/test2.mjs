// file:// で、本物のディスクのフォルダを使う確かめ（ヘッドレス Chrome）。実行：node test/test2.mjs
// フォルダ選択のダイアログは自動で動かせないので、ドラッグ＆ドロップで本物の handle を得る（読むだけの許可）
import { launch, sleep } from './cdp.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T = mkdtempSync(tmpdir() + '/nm-test2-'), PROFILE = T + '/prof', DROP = T + '/droproot';
mkdirSync(DROP + '/sub', { recursive: true });
writeFileSync(DROP + '/crlf.txt', 'a\r\nb\r\n'); writeFileSync(DROP + '/img.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0])); writeFileSync(DROP + '/sub/a.md', 'hello\n');
let c = await launch({ profile: PROFILE, port: 9337 });
await c.send('Page.enable');
const PAGE = 'file://' + ROOT + 'index.html';
let J = c.evalJs; let fails = 0;
const ok = (n, cond, x = '') => { console.log((cond ? 'OK  ' : 'NG  ') + n + '  ' + x); if (!cond) fails++; };
await c.send('Page.navigate', { url: PAGE }); await sleep(1000);
// file:// で本物のディスクのフォルダの handle を、ドロップで得る（ダイアログの代わり）
await J(`window.__drop = new Promise(r => { document.addEventListener('dragover', e => e.preventDefault()); document.addEventListener('drop', async e => { e.preventDefault(); r(await e.dataTransfer.items[0].getAsFileSystemHandle()); }); }); 1`);
const data = { items: [], files: [DROP], dragOperationsMask: 1 };
for (const type of ['dragEnter', 'dragOver', 'drop']) await c.send('Input.dispatchDragEvent', { type, x: 600, y: 300, data });
await J(`(async()=>{const h=await window.__drop; await idbSet('root',h); const back=await idbGet('root'); window.__same=await back.isSameEntry(h); await openRoot(back); return 1})()`);
await sleep(500);
ok('file:// で IndexedDB に handle を保存・読み出し', await J(`window.__same`));
const tree = await J(`[...document.querySelectorAll('.item')].map(e=>e.dataset.path+(e.classList.contains('binary')?'(灰)':'')).join(' ')`);
ok('本物のフォルダの木', tree.includes('sub') && tree.includes('img.png(灰)') && tree.includes('crlf.txt'), tree);
await J(`document.querySelector('.item[data-path="sub"]').click()`); await sleep(500);
ok('フォルダを開くと中が出る', await J(`!!document.querySelector('.item[data-path="sub/a.md"]')`));
await J(`document.querySelector('.item[data-path="sub/a.md"]').click()`); await sleep(500);
ok('ディスクのノートを読める', (await J(`document.getElementById('editor').value`)) === 'hello\n');
// 再読み込み：ドロップの handle は書き込みの許可がないので「前回のフォルダを開く」が出る
await c.send('Page.reload'); await sleep(1500);
ok('許可がないときは「前回のフォルダを開く」ボタン', !(await J(`document.getElementById('btnRestore').classList.contains('hidden')`)), await J(`document.getElementById('btnRestore').textContent`));
// Chrome を閉じて起動し直しても、前回のフォルダを覚えている
c.close(); await sleep(1500);
c = await launch({ profile: PROFILE, port: 9337 }); J = c.evalJs;
await c.send('Page.enable'); await c.send('Page.navigate', { url: PAGE }); await sleep(1500);
ok('Chrome を起動し直しても「前回のフォルダを開く」', (await J(`document.getElementById('btnRestore').textContent`)).includes('droproot') && !(await J(`document.getElementById('btnRestore').classList.contains('hidden')`)));
// API がないブラウザ
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.showDirectoryPicker; delete Window.prototype.showDirectoryPicker;' });
await c.send('Page.reload'); await sleep(1000);
ok('API がないときの案内', (await J(`document.getElementById('welcome').textContent`)).includes('Edge') && await J(`document.getElementById('btnPick').disabled`), await J(`document.getElementById('welcome').textContent.slice(0,40)`));
console.log(fails ? 'NG ' + fails : 'ALL OK');
c.close(); process.exit(fails ? 1 : 0);
