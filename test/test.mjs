// ロジックの確かめ（ヘッドレス Chrome）。OPFS は file:// で使えないので、127.0.0.1 で配る。実行：node test/test.mjs
import { launch, sleep } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const srv = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1', '-d', ROOT], { stdio: 'ignore' });
await sleep(800);
const c = await launch({ profile: mkdtempSync(tmpdir() + '/nm-test-'), port: 9336 });
let promptText = '', dialogs = [];
c.on(m => { if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.type); c.send('Page.handleJavaScriptDialog', { accept: m.params.type !== 'beforeunload', promptText }); } });
await c.send('Page.enable');
const PAGE = 'http://127.0.0.1:8765/index.html';
await c.send('Page.navigate', { url: PAGE }); await sleep(1000);
const J = c.evalJs; let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'OK  ' : 'NG  ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };
const msg = () => J(`document.getElementById('msg').className + ':' + document.getElementById('msg').textContent`);
const click = async sel => { const r = await J(`(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 }); await sleep(400); };
const readOpfs = p => J(`(async()=>{let d=await navigator.storage.getDirectory();const ps=${JSON.stringify(p)}.split('/');for(const x of ps.slice(0,-1))d=await d.getDirectoryHandle(x);const b=new Uint8Array(await (await (await d.getFileHandle(ps.at(-1))).getFile()).arrayBuffer());return [...b].join(',')})()`);
const bytes = s => [...Buffer.from(s, 'utf8')].join(',');

ok('初回は前回ボタンなし', await J(`document.getElementById('btnRestore').classList.contains('hidden')`));
// OPFS に試しのファイルを置く（本物のフォルダの代わり）
await J(`(async()=>{const r=await navigator.storage.getDirectory();for await (const k of r.keys()) await r.removeEntry(k,{recursive:true});
 const put=async(n,b)=>{const w=await (await r.getFileHandle(n,{create:true})).createWritable();await w.write(b);await w.close()};
 await put('bom.md',new Uint8Array([0xEF,0xBB,0xBF,0x61,0x0A])); await put('crlf.txt',new Uint8Array([97,13,10,98,13,10])); await put('bin.png',new Uint8Array([137,80,78,71,0,0,1])); await put('sjis.txt',new Uint8Array([0x82,0xA0,0x82,0xA2])); await put('script.js',new TextEncoder().encode('let x = 1;\\n'));
 await idbSet('root', r); await openRoot(r); return 1})()`);
await sleep(500);
const tree = await J(`[...document.querySelectorAll('.item')].map(e=>e.dataset.path+(e.classList.contains('binary')?'(灰)':'')).join(' ')`);
ok('木に全部のファイル、画像と SJIS は灰色', tree.includes('bin.png(灰)') && tree.includes('sjis.txt(灰)') && tree.includes('script.js ') || tree.endsWith('script.js'), tree);
// フォルダ作成
promptText = 'メモ'; await click('#btnNewFolder'); await sleep(500);
ok('フォルダ作成', (await msg()).includes('フォルダを作りました：メモ'), await msg());
// ノート作成（選んだフォルダの中に .md）
promptText = '今日'; await click('#btnNewNote'); await sleep(800);
ok('ノート作成と自動で開く', (await J(`document.getElementById('fileName').textContent`)) === 'メモ/今日.md', await J(`document.getElementById('fileName').textContent`));
ok('ファイルが空でできた', (await readOpfs('メモ/今日.md')) === '');
// 編集 → 未保存の印 → Ctrl+S
await J(`(()=>{const e=document.getElementById('editor');e.focus();return 1})()`);
await c.send('Input.insertText', { text: '# 見出し\nこんにちは' });
ok('未保存の印', !(await J(`document.getElementById('dirtyMark').classList.contains('hidden')`)));
for (const type of ['rawKeyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 });
await sleep(500);
ok('Ctrl+S で保存・印が消える', (await J(`document.getElementById('dirtyMark').classList.contains('hidden')`)) && (await msg()).startsWith('ok'), await msg());
ok('中身が書けた', (await readOpfs('メモ/今日.md')) === bytes('# 見出し\nこんにちは'));
// 同じ名前・使えない名前
promptText = '今日'; await click('#btnNewNote'); await sleep(500);
ok('同じ名前は断る（上書きしない）', (await msg()).includes('もうあります') && (await readOpfs('メモ/今日.md')) === bytes('# 見出し\nこんにちは'), await msg());
promptText = 'a:b'; await click('#btnNewFolder'); await sleep(300);
ok('Windows で使えない名前を断る', (await msg()).startsWith('err'), await msg());
// CRLF を保つ
await click('.item[data-path="crlf.txt"]');
await J(`(()=>{const e=document.getElementById('editor');e.focus();e.setSelectionRange(e.value.length,e.value.length);return 1})()`);
await c.send('Input.insertText', { text: 'c\n' });
await click('#btnSave'); await sleep(300);
ok('CRLF のまま保存', (await readOpfs('crlf.txt')) === '97,13,10,98,13,10,99,13,10', await readOpfs('crlf.txt'));
// BOM を保つ
await click('.item[data-path="bom.md"]');
await J(`(()=>{const e=document.getElementById('editor');e.focus();e.setSelectionRange(e.value.length,e.value.length);return 1})()`);
await c.send('Input.insertText', { text: 'b' });
await click('#btnSave'); await sleep(300);
ok('BOM のまま保存', (await readOpfs('bom.md')) === '239,187,191,97,10,98', await readOpfs('bom.md'));
// 速い2回押しで木が重ならない
await J(`document.querySelector('.item[data-path=""]').click(); document.querySelector('.item[data-path=""]').click(); 1`); await sleep(600);
const paths = await J(`[...document.querySelectorAll('.item')].map(e=>e.dataset.path)`);
ok('2回押しで木が重ならない', paths.length === new Set(paths).size, paths.join(' '));
// 文字でないファイル
await click('.item[data-path="bin.png"]');
ok('画像は開かない', (await msg()).includes('文字のファイルではない') && (await J(`document.getElementById('fileName').textContent`)) === 'bom.md', await msg());
await click('.item[data-path="script.js"]');
ok('拡張子に関係なく文字なら開く', (await J(`document.getElementById('fileName').textContent`)) === 'script.js');
// 保存の失敗を画面に出す
await c.send('Input.insertText', { text: 'X' });
await J(`current.handle.createWritable = async () => { throw new DOMException('disk full', 'QuotaExceededError') }; save()`); await sleep(300);
ok('保存失敗を表示・印は残る', (await msg()).startsWith('err:保存に失敗') && !(await J(`document.getElementById('dirtyMark').classList.contains('hidden')`)), await msg());
// 未保存で別のノート → 確かめ
dialogs = [];
await click('.item[data-path="crlf.txt"]');
ok('未保存で切り替えると確かめる', dialogs.includes('confirm'), dialogs.join());
// 離れるときの警告
await J(`document.getElementById('editor').focus()`); await c.send('Input.insertText', { text: 'Y' });
ok('離れるときに警告（beforeunload を止める）', await J(`(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented})()`));
// 警告を断ったので、まだ同じページ。印を消して再読み込み
await J(`setDirty(false)`);
await c.send('Page.reload'); await sleep(1500);
ok('再読み込みで前回のフォルダが開く', (await J(`document.getElementById('rootName').textContent`)).length > 0 && (await J(`!!document.querySelector('.item[data-path="メモ"]')`)), await J(`document.getElementById('rootName').textContent`));
console.log(fails ? `NG ${fails} 件` : 'ALL OK');
c.close(); srv.kill(); process.exit(fails ? 1 : 0);
