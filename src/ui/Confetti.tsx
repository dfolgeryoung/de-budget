import { useEffect, useRef } from "react";

/** A short burst of paper from the top of the screen, once per day per device. */
export function Confetti({ dayKey }: { dayKey: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const key = `confetti:${dayKey}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* private mode: still show it */ }
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = (cv.width = innerWidth * dpr), H = (cv.height = innerHeight * dpr);
    const colors = ["#F94144", "#F3722C", "#F9C74F", "#90BE6D", "#43AA8B", "#577590", "#F9844A", "#277DA1", "#FF70A6"];
    const ps = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: -Math.random() * H * 0.3, vx: (Math.random() - 0.5) * 2 * dpr, vy: (2 + Math.random() * 3) * dpr, w: (6 + Math.random() * 6) * dpr, h: (8 + Math.random() * 10) * dpr, a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3, c: colors[Math.floor(Math.random() * colors.length)]!, sway: Math.random() * Math.PI * 2 }));
    const t0 = performance.now(); let raf = 0;
    const tick = (t: number) => {
      const el = (t - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      const fade = el > 3.2 ? Math.max(0, 1 - (el - 3.2) / 0.8) : 1;
      for (const p of ps) {
        p.x += p.vx + Math.sin(el * 3 + p.sway) * 0.8 * dpr; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.globalAlpha = fade; ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (el < 4) raf = requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dayKey]);
  return <canvas ref={ref} aria-hidden className="fixed inset-0 pointer-events-none" style={{ zIndex: 60, width: "100vw", height: "100vh" }} />;
}
