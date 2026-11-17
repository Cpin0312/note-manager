// 小さな CDP ヘルパー
import { spawn } from 'node:child_process';
export async function launch({ profile, headless = true, port = 9333 }) {
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'];
  if (headless) args.unshift('--headless=new');
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args, { stdio: 'ignore' });
  process.on('exit', () => proc.kill());   // 途中で落ちても Chrome を残さない
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find(t => t.type === 'page')) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(); const listeners = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else listeners.forEach(f => f(m)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const on = f => listeners.push(f);
  const close = () => { ws.close(); proc.kill(); };
  return { send, evalJs, on, close, proc };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
