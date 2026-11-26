// 虚拟时钟：页面里的时间只在 __vt.advance(ms) 时前进，逐帧截图得到绝对平滑的画面
(() => {
  const rST = window.setTimeout.bind(window);
  const rPerf = performance.now.bind(performance);
  const date0 = Date.now();
  let now = 0;
  const timers = new Map(); let tid = 1;
  let rafs = []; let rid = 1;
  performance.now = () => now;
  const RD = Date;
  Date.now = () => date0 + now;
  window.setTimeout = (fn, ms, ...a) => { const id = tid++; timers.set(id, { t: now + Math.max(0, +ms || 0), fn, a, seq: id }); return id; };
  window.clearTimeout = (id) => { timers.delete(id); };
  window.setInterval = (fn, ms, ...a) => { const id = tid++; timers.set(id, { t: now + Math.max(1, +ms || 1), fn, a, iv: Math.max(1, +ms || 1), seq: id }); return id; };
  window.clearInterval = (id) => { timers.delete(id); };
  window.requestAnimationFrame = (fn) => { const id = rid++; rafs.push({ id, fn }); return id; };
  window.cancelAnimationFrame = (id) => { rafs = rafs.filter((r) => r.id !== id); };
  const yieldReal = () => new Promise((r) => rST(r, 0));
  const call = (fn, a) => { try { typeof fn === 'function' ? fn(...a) : eval(fn); } catch (e) { console.warn('vt cb', e); } };
  window.__vt = {
    get now() { return now; },
    async advance(ms, frames = true) {
      const end = now + ms;
      for (let guard = 0; guard < 5000; guard++) {
        let best = null, bid = 0;
        for (const [id, t] of timers) if (t.t <= end && (!best || t.t < best.t || (t.t === best.t && t.seq < best.seq))) { best = t; bid = id; }
        if (!best) break;
        now = Math.max(now, best.t);
        if (best.iv) { best.t += best.iv; best.seq = tid++; } else timers.delete(bid);
        call(best.fn, best.a);
        await yieldReal();
      }
      now = end;
      if (frames) {
        const list = rafs; rafs = [];
        for (const r of list) call(r.fn, [now]);
      }
      await yieldReal();
    },
  };
})();
