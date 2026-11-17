// ロジックの確かめ（ヘッドレス Chrome）。OPFS は file:// で使えないので、127.0.0.1 で配る。実行：node test/test.mjs
import { launch, sleep } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const srv = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1', '-d', ROOT], { stdio: 'ignore' });
await sleep(800);
process.on('exit', () => srv.kill());   // 途中で落ちても、配る係を残さない
const c = await launch({ profile: mkdtempSync(tmpdir() + '/nm-test-'), port: 9336 });
let promptText = '', dialogs = [], lastDialog = '', confirmAnswer = true;
c.on(m => { if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.type); lastDialog = m.params.message; c.send('Page.handleJavaScriptDialog', { accept: m.params.type === 'confirm' ? confirmAnswer : m.params.type !== 'beforeunload', promptText }); } });
await c.send('Page.enable');
const PAGE = 'http://127.0.0.1:8765/index.html';
await c.send('Page.navigate', { url: PAGE }); await sleep(1000);
const J = c.evalJs; let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'OK  ' : 'NG  ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };
const msg = () => J(`document.getElementById('msg').className + ':' + document.getElementById('msg').textContent`);
const click = async sel => { const r = await J(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});el.scrollIntoView({block:'nearest'});const b=el.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 }); await sleep(400); };
const rclick = async sel => { const r = await J(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});el.scrollIntoView({block:'nearest'});const b=el.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
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
ok('Ctrl+H で窓が開き、置き換える欄に入る（操作も置き換え）', await J(`!document.getElementById('findDlg').classList.contains('hidden') && document.activeElement.id === 'sReplace' && document.getElementById('sOp').value === 'replace'`));
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
const sel = () => J(`(()=>{const e=document.getElementById('editor');return e.value.slice(e.selectionStart,e.selectionEnd)+'@'+e.selectionStart})()`);
await setVal('sQuery', 'こんにちは'); await J(`search(); 1`); await sleep(300);
ok('文字検索は今のファイルだけ：行番号と行', JSON.stringify(await hits()) === JSON.stringify(['2 こんにちは']) && (await head()).startsWith('メモ/今日.md に 1 か所'), JSON.stringify(await hits()) + (await head()));
await setVal('sQuery', 'let'); await J(`search(); 1`); await sleep(300);
ok('ほかのファイルは探さない', (await hits()).length === 0 && (await head()) === '見つかりませんでした', await head());
await click('.item[data-path="crlf.txt"]'); await sleep(300);
await setVal('sRegex', true); await setVal('sQuery', '[abc]');
const enter = async (shift) => { await J(`document.getElementById('sQuery').focus()`); for (const type of ['rawKeyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: shift ? 8 : 0 }); await sleep(200); };
await enter(); const s1 = await sel(); await enter(); const s2 = await sel(); await enter(true); const s3 = await sel();
ok('Enter で次へ・Shift+Enter で前へ', s1 === 'a@0' && s2 === 'b@2' && s3 === 'a@0' && (await J(`document.getElementById('hitInfo').textContent`)) === '1 / 3', [s1, s2, s3].join());
await click('#btnPrev'); 
ok('「前へ」は最初から最後へ回る', (await sel()) === 'c@4' && (await J(`document.activeElement.id`)) === 'editor', await sel());
await click('#btnNext');
ok('「次へ」は最後から最初へ回る', (await sel()) === 'a@0', await sel());
await click('#results .hit:nth-child(3)'); await sleep(200);
ok('結果を押すとその行に移る', (await sel()) === 'b@2', await sel());
ok('結果を押しても窓は閉じない', await J(`!document.getElementById('findDlg').classList.contains('hidden')`));
// 未保存の変更も探す
await J(`(()=>{const e=document.getElementById('editor');e.focus();e.setSelectionRange(e.value.length,e.value.length);return 1})()`);
await c.send('Input.insertText', { text: 'zzz' });
await setVal('sRegex', false); await setVal('sQuery', 'zzz'); await J(`search(); 1`); await sleep(200);
ok('未保存の変更も含めて探す', JSON.stringify(await hits()) === JSON.stringify(['4 zzz']), JSON.stringify(await hits()));
await J(`(()=>{const e=document.getElementById('editor');e.value=savedText;e.dispatchEvent(new Event('input'));return 1})()`);
// 大文字小文字
await setVal('sQuery', 'A'); await setVal('sCase', true); await J(`search(); 1`); await sleep(200);
const caseOn = (await hits()).length;
await setVal('sCase', false); await J(`search(); 1`); await sleep(200);
ok('大文字小文字を区別の切りかえ', caseOn === 0 && (await hits()).length === 1, caseOn + ' / ' + (await hits()).length);
// 正規表現
await setVal('sRegex', true); await setVal('sQuery', '^[a-c]$'); await J(`search(); 1`); await sleep(200);
ok('正規表現で探す', (await hits()).length === 3, JSON.stringify(await hits()));
await setVal('sQuery', '('); await J(`search(); 1`); await sleep(200);
ok('まちがった正規表現は赤で知らせる', (await J(`document.getElementById('sQuery').classList.contains('bad')`)) && (await J(`document.getElementById('searchErr').textContent`)).includes('正規表現がまちがっています'), await J(`document.getElementById('searchErr').textContent`));
// ===== 窓の操作：置き換え（今のファイルだけ・押したらすぐ・編集画面だけ）=====
const edv = () => J(`document.getElementById('editor').value`);
const isDirty = () => J(`!document.getElementById('dirtyMark').classList.contains('hidden')`);
const saveKey = async () => { for (const type of ['rawKeyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 }); await sleep(400); };
const typeEnd = async t => { await J(`(()=>{const e=document.getElementById('editor');e.focus();e.setSelectionRange(e.value.length,e.value.length);return 1})()`); await c.send('Input.insertText', { text: t }); };
const noteText = () => J(`document.getElementById('searchErr').textContent`);
const run = async op => { await setVal('sOp', op); await click('#btnRun'); await sleep(250); };
ok('窓のボタンは少なく（↑ ↓ 実行 だけ）', await J(`[...document.querySelectorAll('#findBody button')].map(b=>b.textContent).join(' ') === '↑ ↓ 実行' && document.getElementById('sOp').options.length === 5`));
await click('.item[data-path="crlf.txt"]'); await sleep(300);
await setVal('sRegex', false); await setVal('sCase', true); await setVal('sQuery', 'b'); await setVal('sReplace', 'B$1');
dialogs = []; await run('replace');
ok('押したらすぐ置き換え（確かめも見本もなし。ふつうの検索は $1 をそのまま）', (await edv()) === 'a\nB$1\nc\n' && dialogs.length === 0 && (await J(`document.getElementById('results').classList.contains('hidden')`)), JSON.stringify(await edv()));
ok('結果を1行で出す', (await noteText()).startsWith('1 行を置き換えました'), await noteText());
ok('未保存の印が付き、ディスクはまだ元のまま', (await isDirty()) && (await readOpfs('crlf.txt')) === '97,13,10,98,13,10,99,13,10');
await J(`document.execCommand('undo'); 1`); await sleep(200);
ok('Ctrl+Z（元に戻す）で戻せる', (await edv()) === 'a\nb\nc\n' && !(await isDirty()), JSON.stringify(await edv()));
await run('replace'); await saveKey();
ok('保存すると CRLF のまま書く', (await readOpfs('crlf.txt')) === bytes('a\r\nB$1\r\nc\r\n'), await readOpfs('crlf.txt'));
await click('.item[data-path="bom.md"]'); await sleep(300);
await run('replace'); await saveKey();
ok('保存すると BOM のまま書く', (await readOpfs('bom.md')) === '239,187,191,' + bytes('a\nB$1'), await readOpfs('bom.md'));
await click('.item[data-path="script.js"]'); await sleep(300);
await setVal('sRegex', true); await setVal('sQuery', '(\\d)'); await setVal('sReplace', '[$1]'); await run('replace');
ok('正規表現の $1 で置き換え', (await edv()) === 'let x = [1];\n', JSON.stringify(await edv()));
await saveKey();
ok('保存で書ける', (await readOpfs('script.js')) === bytes('let x = [1];\n'));
await typeEnd('Z');   // あとの削除の確かめのため、未保存にしておく
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
await J(`openFind(false); 1`); await setVal('sQuery', 'a'); await J(`search(); 1`); await sleep(200);
ok('ファイルを開いていないときは検索も「ファイルを開いてから」', (await head()).includes('ファイルを開いてから'), await head());
ok('ファイルを開いていないときは実行できない', await J(`document.getElementById('btnRun').disabled && document.getElementById('searchErr').textContent.includes('ファイルを開いてから')`));
ok('開いていたファイルを消すと編集を閉じる', !(await exists('script.js')) && (await J(`document.getElementById('editor').classList.contains('hidden') && !dirty`)));
// 削除の失敗を画面に出す
await J(`root.removeEntry = async () => { throw new DOMException('locked', 'NoModificationAllowedError') }; 1`);
await rclick('.item[data-path="bin.png"]'); await click('#ctxDelete'); await sleep(400);
ok('削除の失敗を画面に出す', (await msg()).startsWith('err:削除に失敗しました：bin.png') && (await exists('bin.png')), await msg());
await J(`delete root.removeEntry; 1`);   // 試しの壊しを戻す
// ===== 検索の結果を押すと、木もそのファイルの場所へ =====
await J(`(async()=>{const r=await navigator.storage.getDirectory();for(let i=0;i<60;i++) await r.getDirectoryHandle('d'+String(i).padStart(2,'0'),{create:true});
 let d=await r.getDirectoryHandle('zz',{create:true}); d=await d.getDirectoryHandle('b',{create:true}); d=await d.getDirectoryHandle('c',{create:true});
 const w=await (await d.getFileHandle('深い.md',{create:true})).createWritable(); await w.write('一行目\\nふかいところ\\n'); await w.close();
 openPaths.clear(); openPaths.add(''); await renderTree(); document.getElementById('tree').scrollTop=0; return 1})()`);
const revealed = p => J(`(()=>{const row=document.querySelector('#tree .item[data-path="'+${JSON.stringify(p)}+'"]'); if(!row) return 'no row';
  const sel=[...document.querySelectorAll('#tree .item.selected')].map(e=>e.dataset.path); const t=document.getElementById('tree').getBoundingClientRect(), r=row.getBoundingClientRect();
  return JSON.stringify({sel, visible: r.top>=t.top && r.bottom<=t.bottom, opened: ['zz','zz/b','zz/b/c'].every(x=>openPaths.has(x))})})()`);
const want = p => JSON.stringify({ sel: [p], visible: true, opened: true });
ok('はじめは木で閉じていて見えない', !(await J(`!!document.querySelector('#tree .item[data-path="zz/b/c/深い.md"]')`)));
await setVal('fQuery', '深い'); await sleep(800);
await click('#fResults .hit'); await sleep(600);
ok('ファイル検索の結果を押すと、親を開き・印を付け・見える所へ', (await revealed('zz/b/c/深い.md')) === want('zz/b/c/深い.md'), await revealed('zz/b/c/深い.md'));
ok('検索の欄と結果はそのまま', (await J(`document.getElementById('fQuery').value`)) === '深い' && (await fhits()).length === 1);
await setVal('fQuery', 'ふかい'); await sleep(800);
await J(`(async()=>{openPaths.clear(); openPaths.add(''); await renderTree(); document.getElementById('tree').scrollTop=0; return 1})()`);
await click('#fResults .hit'); await sleep(600);
ok('同じファイルで中身の結果を押しても、木が合う（その行も選ぶ）', (await revealed('zz/b/c/深い.md')) === want('zz/b/c/深い.md') && (await J(`(()=>{const e=document.getElementById('editor');return e.value.slice(e.selectionStart,e.selectionEnd)})()`)) === 'ふかいところ', await revealed('zz/b/c/深い.md'));
// 続けて別の結果を押す
await setVal('fQuery', 'crlf'); await sleep(800);
await click('#fResults .hit'); await sleep(600);
ok('続けて別の結果も押せる', (await revealed('crlf.txt')).includes('"sel":["crlf.txt"]') && (await J(`document.getElementById('fileName').textContent`)) === 'crlf.txt', await revealed('crlf.txt'));
await setVal('fQuery', ''); await J(`closeFind(); 1`);
// ===== MD表示 =====
const MD = ['# 見出し1', '## 見出し2', '', '- りんご', '  - 小さいりんご', '- **太字** と *斜体* と `x<y`', '', '1. 一番', '2. 二番', '',
  '- [ ] まだ', '- [x] できた', '', '> 引用の文', '', '| 名前 | 数 |', '|:--|--:|', '| 柿 | 3 |', '', '---', '',
  '```', '<b>コードの中</b>', '```', '', '[安全なリンク](https://example.com/a?b=1&c=2)', '[危ないリンク](javascript:alert(1))', '[危ない2](JaVaScRiPt:alert(1))',
  '<script>window.__pwned=1</script>', '<img src=x onerror="window.__pwned=2">', '<a href="javascript:alert(1)">生のリンク</a>'].join('\n');
await J(`(async()=>{const r=await navigator.storage.getDirectory();const w=await (await r.getFileHandle('md.md',{create:true})).createWritable();await w.write(${JSON.stringify(MD)});await w.close();await renderTree();return 1})()`);
await click('.item[data-path="md.md"]'); await sleep(300);
ok('ファイルを開くと「MD表示」ボタン', (await J(`document.getElementById('btnMd').textContent`)) === 'MD表示' && !(await J(`document.getElementById('btnMd').disabled`)));
await J(`(()=>{const e=document.getElementById('editor');e.focus();e.setSelectionRange(e.value.length,e.value.length);return 1})()`);
await c.send('Input.insertText', { text: '\n\n未保存の行' });
await click('#btnMd'); await sleep(300);
const mv = sel => J(`document.querySelectorAll('#mdView ${sel}').length`);
ok('表示中は編集画面を隠し、MD を出す', (await J(`document.getElementById('editor').classList.contains('hidden') && !document.getElementById('mdView').classList.contains('hidden')`)) && (await J(`document.getElementById('btnMd').textContent`)) === '編集に戻る');
ok('見出し・箇条書き（入れ子）・番号付き', (await mv('h1')) === 1 && (await mv('h2')) === 1 && (await mv('ul ul li')) === 1 && (await mv('ol li')) === 2);
ok('太字・斜体・行内コード（中の < は文字）', (await mv('strong')) === 1 && (await mv('em')) === 1 && (await J(`[...document.querySelectorAll('#mdView p code, #mdView li code')].map(e=>e.textContent).join()`)) === 'x<y');
ok('コードのブロック（中の HTML は文字）', (await J(`document.querySelector('#mdView pre code').textContent`)) === '<b>コードの中</b>' && (await mv('pre b')) === 0);
ok('引用・表（そろえ）・水平線', (await mv('blockquote')) === 1 && (await mv('table th')) === 2 && (await mv('table td')) === 2 && (await J(`document.querySelectorAll('#mdView td')[1].style.textAlign`)) === 'right' && (await mv('hr')) === 1);
ok('チェックボックス（押せない）', (await mv('input[type=checkbox][disabled]')) === 2 && (await mv('input[type=checkbox]:checked')) === 1);
ok('リンクは別のタブで開く', (await J(`(()=>{const a=document.querySelector('#mdView a');return a.getAttribute('href')+'|'+a.target+'|'+a.rel})()`)) === 'https://example.com/a?b=1&c=2|_blank|noopener noreferrer');
ok('javascript: のリンクは無効', (await mv('a')) === 1 && !(await J(`[...document.querySelectorAll('#mdView a')].some(a=>/script/i.test(a.getAttribute('href')))`)));
ok('生の HTML は動かさず文字で見せる', (await mv('script')) === 0 && (await mv('img')) === 0 && !(await J(`[...document.querySelectorAll('#mdView *')].some(e=>[...e.attributes].some(a=>/^on/i.test(a.name)))`)) && (await J(`document.getElementById('mdView').textContent.includes('<script>')`)) && (await J(`window.__pwned === undefined`)));
ok('未保存の変更も含めて表示', (await J(`document.getElementById('mdView').textContent.includes('未保存の行')`)) && (await isDirty()));
await J(`openFind(true); 1`);
ok('表示中は実行できない', await J(`document.getElementById('btnRun').disabled && document.getElementById('searchErr').textContent.includes('MD表示中')`));
await setVal('sRegex', false); await setVal('sQuery', '太字'); await enter();
ok('MD表示中も検索でき、当たった所に印', (await J(`document.querySelectorAll('#mdView mark').length`)) === 1 && (await J(`document.querySelectorAll('#mdView mark.cur').length`)) === 1 && (await J(`document.getElementById('hitInfo').textContent`)) === '1 / 1');
await J(`closeFind(); 1`);
await saveKey();
ok('表示中も保存できる（未保存の変更を書く）', !(await isDirty()) && (await readOpfs('md.md')) === bytes(MD + '\n\n未保存の行'));
await click('.item[data-path="crlf.txt"]'); await sleep(300);
ok('ファイルを切りかえても MD表示のまま', (await J(`!document.getElementById('mdView').classList.contains('hidden') && document.getElementById('editor').classList.contains('hidden') && document.getElementById('mdView').textContent.includes('B$1')`)));
await click('#btnMd'); await sleep(200);
ok('「編集に戻る」で編集画面に戻る', (await J(`!document.getElementById('editor').classList.contains('hidden') && document.getElementById('mdView').classList.contains('hidden') && document.getElementById('btnMd').textContent === 'MD表示' && !document.getElementById('btnRun').disabled`)));
// ===== 窓の操作：当たった行の削除・行マージ・Ltrim・Rtrim =====
const L = ['apple', 'apple', 'banana', 'banana', 'apple', '　 \tcherry 　', '  Apple x　'];
await J(`(async()=>{const r=await navigator.storage.getDirectory();const w=await (await r.getFileHandle('lines.txt',{create:true})).createWritable();await w.write(${JSON.stringify(L.join('\r\n') + '\r\n')});await w.close();await renderTree();return 1})()`);
await click('.item[data-path="lines.txt"]'); await sleep(300);
await J(`openFind(false); 1`);
const orig = L.join('\n') + '\n';
const undo = async () => { await J(`document.execCommand('undo'); 1`); await sleep(150); };
await setVal('sReplace', ''); await setVal('sRegex', false); await setVal('sCase', false); await setVal('sQuery', '');
await setVal('sOp', 'replace');
ok('置き換えは探す文字が要る（押せず、理由は1か所に短く）', (await J(`document.getElementById('btnRun').disabled`)) && (await noteText()) === 'この操作は、探す文字が要ります。', await noteText());
await setVal('sOp', 'delete');
ok('削除も探す文字が要る', await J(`document.getElementById('btnRun').disabled`));
await run('merge');
ok('行マージ（探す文字が空ならファイル全体）：上下が全く同じ行を1行に', (await edv()) === ['apple', 'banana', 'apple', L[5], L[6]].join('\n') + '\n' && (await noteText()).startsWith('2 行をまとめました'), JSON.stringify(await edv()) + await noteText());
await undo(); ok('元に戻せる', (await edv()) === orig);
await setVal('sQuery', 'banana'); await run('merge');
ok('行マージ（探す文字があれば当たった行だけ）', (await edv()) === ['apple', 'apple', 'banana', 'apple', L[5], L[6]].join('\n') + '\n', JSON.stringify(await edv()));
await undo();
await setVal('sQuery', ''); await run('ltrim');
ok('Ltrim：全部の行の行頭の半角・全角スペースとタブ', (await edv()) === [...L.slice(0, 5), 'cherry 　', 'Apple x　'].join('\n') + '\n' && (await noteText()).startsWith('2 行を変えました'), JSON.stringify(await edv()));
await undo();
await setVal('sQuery', 'cherry'); await run('rtrim');
ok('Rtrim：当たった行だけ、行末の空白', (await edv()) === [...L.slice(0, 5), '　 \tcherry', L[6]].join('\n') + '\n' && (await noteText()).startsWith('1 行を変えました'), JSON.stringify(await edv()));
await undo();
await setVal('sQuery', 'banana'); await run('rtrim');
ok('変わらないときはそう出す', (await edv()) === orig && (await noteText()) === '変わる行はありませんでした。' && !(await isDirty()));
await setVal('sQuery', 'apple'); await run('delete');
ok('当たった行の削除（大文字小文字を区別しない）', (await edv()) === ['banana', 'banana', L[5]].join('\n') + '\n' && (await noteText()).startsWith('4 行を削除しました'), JSON.stringify(await edv()));
await saveKey();
ok('保存すると CRLF のまま', (await readOpfs('lines.txt')) === bytes(['banana', 'banana', L[5]].join('\r\n') + '\r\n'), await readOpfs('lines.txt'));
await setVal('sRegex', true); await setVal('sQuery', '^ban'); await run('merge');
ok('正規表現でも当たった行だけ', (await edv()) === ['banana', L[5]].join('\n') + '\n', JSON.stringify(await edv()));
await undo();
await J(`toggleMd(); 1`); await sleep(200);   // 窓がボタンにかぶるので、直に呼ぶ
ok('MD表示中は実行できない', (await J(`mdMode && document.getElementById('btnRun').disabled`)) && (await noteText()).includes('MD表示中'), await noteText());
await J(`toggleMd(); 1`); await sleep(200);
await setVal('sRegex', false); await J(`closeFind(); 1`);
// ===== 名前の変更と移動 =====
await J(`(async()=>{const r=await navigator.storage.getDirectory();const put=async(d,n,t)=>{const w=await (await d.getFileHandle(n,{create:true})).createWritable();await w.write(t);await w.close()};
 const mv=await r.getDirectoryHandle('mv',{create:true}); const inner=await mv.getDirectoryHandle('inner',{create:true}); await put(inner,'x.md','x');
 const dst=await r.getDirectoryHandle('dst',{create:true}); await put(dst,'same.md','D'); await put(r,'same.md','S'); await put(r,'note.md','n');
 ['mv','mv/inner','dst'].forEach(p=>openPaths.add(p)); await renderTree(); return 1})()`);
const curName = () => J(`document.getElementById('fileName').textContent`);
const selRow = () => J(`[...document.querySelectorAll('#tree .item.selected')].map(e=>e.dataset.path).join()`);
const drag = async (from, to) => { await J(`(()=>{const q=p=>document.querySelector('#tree .item[data-path="'+p+'"]');const dt=new DataTransfer();
  q(${JSON.stringify(from)}).dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt})); const d=q(${JSON.stringify(to)});
  d.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt})); d.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt})); return 1})()`); await sleep(600); };
// 名前の変更：開いていて未保存のファイル
await click('.item[data-path="note.md"]'); await sleep(300); await typeEnd('N');
promptText = 'note2.md'; dialogs = [];
await rclick('.item[data-path="note.md"]'); await click('#ctxRename'); await sleep(600);
ok('名前の変更：今の名前を入れた欄を出す', dialogs[0] === 'prompt');
ok('未保存なら先に保存するか聞いて保存する', dialogs.includes('confirm') && (await readOpfs('note2.md')) === bytes('nN') && !(await exists('note.md')), dialogs.join());
ok('開いたまま新しい名前・木の印も', (await curName()) === 'note2.md' && (await selRow()) === 'note2.md' && !(await isDirty()), (await curName()) + ' / ' + (await selRow()));
await typeEnd('2'); await saveKey();
ok('新しい名前で保存できる', (await readOpfs('note2.md')) === bytes('nN2'));
promptText = 'same.md'; await rclick('.item[data-path="note2.md"]'); await click('#ctxRename'); await sleep(400);
ok('同じ名前があれば断る', (await msg()).includes('もうあります') && (await readOpfs('same.md')) === bytes('S') && (await exists('note2.md')), await msg());
promptText = 'a:b'; await rclick('.item[data-path="note2.md"]'); await click('#ctxRename'); await sleep(300);
ok('Windows で使えない名前は断る', (await msg()).startsWith('err') && (await exists('note2.md')), await msg());
// 開いているファイルを含むフォルダの名前を変える
await click('.item[data-path="mv/inner/x.md"]'); await sleep(300);
promptText = 'mv2'; await rclick('.item[data-path="mv"]'); await click('#ctxRename'); await sleep(600);
ok('フォルダの名前を変えても、開いたまま・木の印も', (await curName()) === 'mv2/inner/x.md' && (await selRow()) === 'mv2/inner/x.md' && !(await exists('mv')), (await curName()) + ' / ' + (await selRow()));
await typeEnd('!'); await saveKey();
ok('新しい場所で保存できる', (await readOpfs('mv2/inner/x.md')) === bytes('x!'));
// ドラッグで移動
dialogs = []; await drag('same.md', 'dst');
ok('行き先に同じ名前があれば上書きせず断る', (await msg()).includes('もうあります') && (await readOpfs('dst/same.md')) === bytes('D') && (await readOpfs('same.md')) === bytes('S'), await msg());
dialogs = []; lastDialog = ''; await drag('note2.md', 'dst');
ok('ドラッグで移動（確かめてから）', lastDialog.includes('「note2.md」を「dst」へ移動します') && (await readOpfs('dst/note2.md')) === bytes('nN2') && !(await exists('note2.md')), lastDialog);
await drag('dst/note2.md', '');
ok('いちばん上へも移動できる', (await exists('note2.md')) && !(await exists('dst/note2.md')));
confirmAnswer = false; await drag('note2.md', 'dst'); confirmAnswer = true;
ok('確かめで「いいえ」なら動かさない', (await exists('note2.md')) && !(await exists('dst/note2.md')));
// メニューの「移動…」：開いているファイルを含むフォルダ
await rclick('.item[data-path="mv2"]'); await click('#ctxMove'); await sleep(400);
const opts = await J(`[...document.getElementById('moveDest').options].map(o=>o.value)`);
ok('移動先の一覧（自分と自分の中は出さない）', opts.includes('') && opts.includes('dst') && !opts.some(o => o === 'mv2' || o.startsWith('mv2/')), JSON.stringify(opts));
await J(`(()=>{const s=document.getElementById('moveDest');s.value='dst';return 1})()`); await click('#moveOk'); await sleep(600);
ok('メニューで移動・開いたまま新しい場所', (await readOpfs('dst/mv2/inner/x.md')) === bytes('x!') && !(await exists('mv2')) && (await curName()) === 'dst/mv2/inner/x.md' && (await selRow()) === 'dst/mv2/inner/x.md', (await curName()) + ' / ' + (await selRow()));
await drag('dst', 'dst/mv2');
ok('フォルダを自分の中へは移動しない', (await msg()).includes('自分の中') && (await exists('dst/mv2/inner/x.md')), await msg());
// move() が使えないとき：コピー → 中身を確かめる → 元を消す
await J(`(()=>{window.__mv={}; for (const C of [FileSystemHandle, FileSystemFileHandle, FileSystemDirectoryHandle]) { window.__mv[C.name]=Object.getOwnPropertyDescriptor(C.prototype,'move'); Object.defineProperty(C.prototype,'move',{value:undefined,configurable:true,writable:true}); } return 1})()`);
promptText = 'crlf2.txt'; await rclick('.item[data-path="crlf.txt"]'); await click('#ctxRename'); await sleep(600);
ok('move() なしでも名前を変える（バイトそのまま）', (await readOpfs('crlf2.txt')) === bytes('a\r\nB$1\r\nc\r\n') && !(await exists('crlf.txt')), await msg());
await drag('dst/mv2', '');
ok('move() なしでもフォルダを中身ごと移動・開いたまま', (await readOpfs('mv2/inner/x.md')) === bytes('x!') && !(await exists('dst/mv2')) && (await curName()) === 'mv2/inner/x.md', (await curName()) + ' ' + await msg());
await typeEnd('?'); await saveKey();
ok('コピーで動かしたあとも保存できる', (await readOpfs('mv2/inner/x.md')) === bytes('x!?'));
// コピーの途中で失敗 → 元は消さない
await J(`(()=>{window.__cw=FileSystemFileHandle.prototype.createWritable; FileSystemFileHandle.prototype.createWritable=async function(){ throw new DOMException('disk full','QuotaExceededError') }; return 1})()`);
promptText = 'bom2.md'; await rclick('.item[data-path="bom.md"]'); await click('#ctxRename'); await sleep(600);
ok('コピーに失敗したら元は消さず、画面に出す', (await msg()).includes('コピーの途中で失敗しました。元は消していません') && (await readOpfs('bom.md')) === '239,187,191,' + bytes('a\nB$1') && !(await exists('bom2.md')), await msg());
await J(`(()=>{FileSystemFileHandle.prototype.createWritable=window.__cw; for (const C of [FileSystemHandle, FileSystemFileHandle, FileSystemDirectoryHandle]) { const d=window.__mv[C.name]; if (d) Object.defineProperty(C.prototype,'move',d); else delete C.prototype.move; } return 1})()`);
// 未保存で「キャンセル」なら変えない
await typeEnd('#'); confirmAnswer = false; promptText = 'x2.md';
await rclick('.item[data-path="mv2/inner/x.md"]'); await click('#ctxRename'); await sleep(400); confirmAnswer = true;
ok('未保存で保存を断ったら変えない', (await exists('mv2/inner/x.md')) && !(await exists('mv2/inner/x2.md')) && (await isDirty()));
await J(`setDirty(false); 1`);
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
ok('再読み込みで前回のフォルダが開く', (await J(`document.getElementById('rootName').textContent`)).length > 0 && (await J(`!!document.querySelector('.item[data-path="crlf2.txt"]')`)), await J(`document.getElementById('rootName').textContent`));
// localStorage が使えないときは決まった幅で動く
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });" });
await c.send('Page.reload'); await sleep(1500);
ok('localStorage が使えなくても決まった幅で開く', (await sideW()) === 300 && (await J(`!!document.querySelector('.item[data-path="crlf2.txt"]')`)), String(await sideW()));
console.log(fails ? `NG ${fails} 件` : 'ALL OK');
c.close(); srv.kill(); process.exit(fails ? 1 : 0);
