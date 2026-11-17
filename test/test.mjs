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
let promptText = '', dialogs = [], lastDialog = '', confirmAnswer = true;
c.on(m => { if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.type); lastDialog = m.params.message; c.send('Page.handleJavaScriptDialog', { accept: m.params.type === 'confirm' ? confirmAnswer : m.params.type !== 'beforeunload', promptText }); } });
await c.send('Page.enable');
const PAGE = 'http://127.0.0.1:8765/index.html';
await c.send('Page.navigate', { url: PAGE }); await sleep(1000);
const J = c.evalJs; let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'OK  ' : 'NG  ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };
const msg = () => J(`document.getElementById('msg').className + ':' + document.getElementById('msg').textContent`);
const click = async sel => { const r = await J(`(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 }); await sleep(400); };
const rclick = async sel => { const r = await J(`(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'right', clickCount: 1 }); await sleep(300); };
const setVal = (id, v) => J(`(()=>{const e=document.getElementById('${id}'); if (e.type==='checkbox') e.checked=${JSON.stringify(v)}; else e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input')); return 1})()`);
const hits = () => J(`[...document.querySelectorAll('#results .hit')].map(e=>e.textContent)`);
const head = () => J(`document.querySelector('#results .rhead span') ? document.querySelector('#results .rhead span').textContent : ''`);
const exists = p => J(`(async()=>{let d=await navigator.storage.getDirectory();const ps=${JSON.stringify(p)}.split('/');try{for(const x of ps.slice(0,-1))d=await d.getDirectoryHandle(x);for(const g of ['getFileHandle','getDirectoryHandle']){try{await d[g](ps.at(-1));return true}catch(e){}}return false}catch(e){return false}})()`);
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
await J(`delete current.handle.createWritable; 1`);   // 試しの壊しを戻す
// 未保存で別のノート → 確かめ
dialogs = [];
await click('.item[data-path="crlf.txt"]');
ok('未保存で切り替えると確かめる', dialogs.includes('confirm'), dialogs.join());
// 離れるときの警告
await J(`document.getElementById('editor').focus()`); await c.send('Input.insertText', { text: 'Y' });
ok('離れるときに警告（beforeunload を止める）', await J(`(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented})()`));
// 警告を断ったので、まだ同じページ。印を消して再読み込み
await J(`setDirty(false)`);

// ===== ファイル検索（左の一覧の上、文字の検索とは別）=====
const fhits = () => J(`[...document.querySelectorAll('#fResults .hit')].map(e=>e.textContent)`);
await setVal('fQuery', '今日'); await sleep(800);
ok('ファイル名で下のフォルダまで探す（名前の印）', JSON.stringify(await fhits()) === JSON.stringify(['［名前］メモ/今日.md']), JSON.stringify(await fhits()));
ok('ファイル検索で文字の窓は開かない', await J(`document.getElementById('findDlg').classList.contains('hidden')`));
await click('#fResults .hit'); await sleep(400);
ok('結果を押すと開く', (await J(`document.getElementById('fileName').textContent`)) === 'メモ/今日.md');
await setVal('fQuery', 'こんにちは'); await sleep(800);
ok('中身でも当たる（中身の印・最初の行）', JSON.stringify(await fhits()) === JSON.stringify(['［中身］メモ/今日.md — 2: こんにちは']), JSON.stringify(await fhits()));
await click('.item[data-path="crlf.txt"]'); await sleep(300);
await click('#fResults .hit'); await sleep(400);
ok('中身の結果を押すとその行を開く', (await J(`(()=>{const e=document.getElementById('editor');return document.getElementById('fileName').textContent+'|'+e.value.slice(e.selectionStart,e.selectionEnd)})()`)) === 'メモ/今日.md|こんにちは');
await setVal('fQuery', 'X ='); await sleep(800);
ok('1ファイル1行・大文字小文字は気にしない', JSON.stringify(await fhits()) === JSON.stringify(['［中身］script.js — 1: let x = 1;']), JSON.stringify(await fhits()));
await setVal('fQuery', 'xyz'); await setVal('fQuery', 'こんに'); await sleep(100);
ok('入力が止まるまで探さない', (await fhits()).length === 0 || (await J(`document.querySelector('#fResults .rhead span').textContent`)) === '探しています…');
await sleep(800);
ok('止まったら探す', (await fhits()).length === 1, JSON.stringify(await fhits()));
await setVal('fQuery', ''); await sleep(500);
ok('空にすると結果が消える', await J(`document.getElementById('fResults').classList.contains('hidden')`));
// ===== 文字の検索の窓 =====
const key = async (k, code, vk, mod = 2) => { for (const type of ['rawKeyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers: mod }); await sleep(200); };
await key('f', 'KeyF', 70);
ok('Ctrl+F で窓が開き、探す欄に入る', await J(`!document.getElementById('findDlg').classList.contains('hidden') && document.activeElement.id === 'sQuery'`));
await key('Escape', 'Escape', 27, 0);
ok('Esc で閉じる', await J(`document.getElementById('findDlg').classList.contains('hidden')`));
await key('h', 'KeyH', 72);
ok('Ctrl+H で窓が開き、置き換える欄に入る', await J(`!document.getElementById('findDlg').classList.contains('hidden') && document.activeElement.id === 'sReplace'`));
await click('#btnFindClose');
ok('× で閉じる', await J(`document.getElementById('findDlg').classList.contains('hidden')`));
await click('#btnFind');
ok('ボタンで開く', await J(`!document.getElementById('findDlg').classList.contains('hidden')`));
// ドラッグで動かす
const t0 = await J(`(()=>{const r=document.getElementById('findTitle').getBoundingClientRect();return [r.x+40,r.y+12]})()`);
await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t0[0], y: t0[1], button: 'left', clickCount: 1 });
await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t0[0] - 100, y: t0[1] + 60, button: 'left', buttons: 1 });
await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t0[0] - 100, y: t0[1] + 60, button: 'left', clickCount: 1 });
const t1 = await J(`(()=>{const r=document.getElementById('findTitle').getBoundingClientRect();return [r.x+40,r.y+12]})()`);
ok('タイトルをドラッグで動かせる', Math.round(t1[0] - t0[0]) === -100 && Math.round(t1[1] - t0[1]) === 60, JSON.stringify([t0, t1]));
// 窓は左の一覧にかぶらない所へ戻しておく
await J(`(()=>{const d=document.getElementById('findDlg');d.style.left='330px';d.style.top='60px';d.style.width='460px';return 1})()`);
await setVal('sQuery', 'こんにちは'); await click('#btnSearch'); await sleep(400);
ok('文字検索：ファイル名・行番号・行', JSON.stringify(await hits()) === JSON.stringify(['2 メモ/今日.md : こんにちは']), JSON.stringify(await hits()));
await click('.item[data-path="crlf.txt"]'); await sleep(300);
await click('#results .hit'); await sleep(400);
ok('押すとその行を開く', (await J(`(()=>{const e=document.getElementById('editor');return document.getElementById('fileName').textContent+'|'+e.value.slice(e.selectionStart,e.selectionEnd)})()`)) === 'メモ/今日.md|こんにちは');
ok('結果を押しても窓は閉じない', await J(`!document.getElementById('findDlg').classList.contains('hidden')`));
ok('文字検索は文字でないファイルを飛ばす', !(await hits()).some(h => h.includes('bin.png')));
// 大文字小文字
await setVal('sQuery', 'LET'); await setVal('sCase', true); await click('#btnSearch'); await sleep(400);
const caseOn = (await hits()).length;
await setVal('sCase', false); await click('#btnSearch'); await sleep(400);
ok('大文字小文字を区別の切りかえ', caseOn === 0 && (await hits()).length === 1, caseOn + ' / ' + (await hits()).length);
// 正規表現
await setVal('sRegex', true); await setVal('sQuery', '^le.\\s'); await click('#btnSearch'); await sleep(400);
ok('正規表現で探す', JSON.stringify(await hits()) === JSON.stringify(['1 script.js : let x = 1;']), JSON.stringify(await hits()));
await setVal('sQuery', '('); await click('#btnSearch'); await sleep(200);
ok('まちがった正規表現は赤で知らせる', (await J(`document.getElementById('sQuery').classList.contains('bad')`)) && (await J(`document.getElementById('searchErr').textContent`)).includes('正規表現がまちがっています'), await J(`document.getElementById('searchErr').textContent`));
// ===== 置き換え（全部のファイル）=====
await setVal('sRegex', false); await setVal('sCase', true); await setVal('sQuery', 'b'); await setVal('sReplace', 'B$1'); await setVal('sScope', 'all');
await click('#btnPreview'); await sleep(500);
ok('見本：件数', (await head()).startsWith('2 個のファイルで 2 か所'), await head());
ok('見本：前→後', (await J(`[...document.querySelectorAll('#results .before,#results .after')].map(e=>e.textContent).join('|')`)).includes('2: b|2: B$1'), await J(`[...document.querySelectorAll('#results .before,#results .after')].map(e=>e.textContent).join('|')`));
ok('見本ではまだ書かない', (await readOpfs('crlf.txt')) === '97,13,10,98,13,10,99,13,10');
await click('#btnReplace'); await sleep(500);
ok('置き換えたファイルの数', (await msg()) === 'ok:2 個のファイルを置き換えました。', await msg());
ok('CRLF を保って置き換え（ふつうの検索は $1 をそのまま）', (await readOpfs('crlf.txt')) === bytes('a\r\nB$1\r\nc\r\n'), await readOpfs('crlf.txt'));
ok('BOM を保って置き換え', (await readOpfs('bom.md')) === '239,187,191,' + bytes('a\nB$1'), await readOpfs('bom.md'));
ok('文字でないファイルは変えない', (await readOpfs('bin.png')) === '137,80,78,71,0,0,1');
// ===== 置き換え（今のファイル・正規表現のグループ）=====
await click('.item[data-path="script.js"]'); await sleep(300);
await setVal('sRegex', true); await setVal('sQuery', '(\\d)'); await setVal('sReplace', '[$1]'); await setVal('sScope', 'current');
await click('#btnPreview'); await sleep(400);
ok('今のファイルだけの見本', (await head()).startsWith('1 個のファイルで 1 か所'), await head());
await click('#btnReplace'); await sleep(400);
ok('正規表現の $1 で置き換え・画面も新しく', (await readOpfs('script.js')) === bytes('let x = [1];\n') && (await J(`document.getElementById('editor').value`)) === 'let x = [1];\n', await readOpfs('script.js'));
// 未保存があるときは置き換えない
await J(`document.getElementById('editor').focus()`); await c.send('Input.insertText', { text: 'Z' });
await click('#btnPreview'); await sleep(300);
ok('未保存があるときは置き換えない', (await J(`document.getElementById('searchErr').textContent`)).includes('先に保存'));
// ===== 右クリックで削除 =====
await rclick('.item[data-path="bin.png"]');
ok('右クリックで「削除」が出る', !(await J(`document.getElementById('ctxMenu').classList.contains('hidden')`)));
confirmAnswer = false; await click('#ctxDelete'); await sleep(300); confirmAnswer = true;
ok('確かめで「いいえ」なら消さない', (await exists('bin.png')) && lastDialog.includes('元に戻せません'), lastDialog);
await rclick('.item[data-path="メモ"]'); await click('#ctxDelete'); await sleep(500);
ok('フォルダの確かめに中のファイル数', lastDialog.includes('「メモ」') && lastDialog.includes('ファイル 1 個') && lastDialog.includes('元に戻せません'), lastDialog);
ok('フォルダを中身ごと消す', !(await exists('メモ')) && !(await J(`!!document.querySelector('.item[data-path="メモ"]')`)));
// 編集中で未保存のファイルを消す（script.js は 'Z' が未保存）
await rclick('.item[data-path="script.js"]'); await click('#ctxDelete'); await sleep(400);
ok('未保存の変更を先に知らせる', lastDialog.startsWith('開いているノート「script.js」に、保存していない変更'), lastDialog);
ok('開いていたファイルを消すと編集を閉じる', !(await exists('script.js')) && (await J(`document.getElementById('editor').classList.contains('hidden') && !dirty`)));
// 削除の失敗を画面に出す
await J(`root.removeEntry = async () => { throw new DOMException('locked', 'NoModificationAllowedError') }; 1`);
await rclick('.item[data-path="bin.png"]'); await click('#ctxDelete'); await sleep(400);
ok('削除の失敗を画面に出す', (await msg()).startsWith('err:削除に失敗しました：bin.png') && (await exists('bin.png')), await msg());
// ===== 一覧の幅 =====
const sideW = () => J(`Math.round(document.getElementById('side').getBoundingClientRect().width)`);
const dragSplit = async dx => { const r = await J(`(()=>{const b=document.getElementById('splitter').getBoundingClientRect();return [b.x+2,b.y+100]})()`);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0] + dx, y: r[1], button: 'left', buttons: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[0] + dx, y: r[1], button: 'left', clickCount: 1 }); await sleep(200); };
await J(`closeFind(); 1`);
const w0 = await sideW(); await dragSplit(80);
ok('仕切りのドラッグで幅が変わる', (await sideW()) === w0 + 80, w0 + ' → ' + await sideW());
await dragSplit(-2000);
ok('最小の幅で止まる', (await sideW()) === 180, String(await sideW()));
await dragSplit(5000);
ok('最大の幅で止まる（編集の場所を残す）', (await sideW()) === (await J(`sideMax()`)) && (await J(`innerWidth`)) - (await sideW()) >= 320, String(await sideW()));
await dragSplit(-2000); await dragSplit(70);
ok('幅を覚える', (await J(`localStorage.getItem('note-manager.sideWidth')`)) === '250', await J(`localStorage.getItem('note-manager.sideWidth')`));
await c.send('Page.reload'); await sleep(1500);
ok('次に開いても同じ幅', (await sideW()) === 250, String(await sideW()));
ok('再読み込みで前回のフォルダが開く', (await J(`document.getElementById('rootName').textContent`)).length > 0 && (await J(`!!document.querySelector('.item[data-path="crlf.txt"]')`)), await J(`document.getElementById('rootName').textContent`));
// localStorage が使えないときは決まった幅で動く
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });" });
await c.send('Page.reload'); await sleep(1500);
ok('localStorage が使えなくても決まった幅で開く', (await sideW()) === 300 && (await J(`!!document.querySelector('.item[data-path="crlf.txt"]')`)), String(await sideW()));
console.log(fails ? `NG ${fails} 件` : 'ALL OK');
c.close(); srv.kill(); process.exit(fails ? 1 : 0);
