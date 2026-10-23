import { useEffect, useRef } from "react";

const COLORS = ["#80d877", "#e8b34b", "#f4f5f5", "#66b5e8", "#d66e6e"];

/** Small canvas celebration used when a practice session is completed. */
export function Confetti({ fire }: { fire: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!fire) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    context.scale(dpr, dpr);

    const pieces = Array.from({ length: 110 }, (_, index) => ({
      x: width * 0.5 + (Math.random() - 0.5) * width * 0.22,
      y: height * 0.34 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 8,
      vy: -Math.random() * 9 - 2,
      size: 4 + Math.random() * 6,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: COLORS[index % COLORS.length],
      life: 1,
    }));

    let frame = 0;
    let raf = 0;
    const draw = () => {
      frame += 1;
      context.clearRect(0, 0, width, height);
      for (const piece of pieces) {
        piece.vy += 0.22;
        piece.vx *= 0.995;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.spin;
        if (frame > 35) piece.life = Math.max(0, piece.life - 0.018);
        context.save();
        context.globalAlpha = piece.life;
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.62);
        context.restore();
      }
      if (frame < 230) raf = requestAnimationFrame(draw);
      else context.clearRect(0, 0, width, height);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      context.clearRect(0, 0, width, height);
    };
  }, [fire]);

  return <canvas ref={canvasRef} className="cb-confetti" aria-hidden />;
}
