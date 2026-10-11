const canvas = document.querySelector("canvas"), ctx = canvas.getContext("2d");
let elapsed = 0, count = 0;
const runtime = createPaeanRuntime({
  canvas: true, opaque: true, keepAwake: true, version: "benchmark-2d-v1", saveKey: "benchmark-2d",
  getSave: () => ({ elapsed }), applySave: s => { if (Number.isFinite(s.elapsed)) elapsed = s.elapsed; },
  onQuality: q => { count = [1600, 1100, 700, 350][q.level]; },
  onSample: s => { document.querySelector("output").textContent = "Canvas2D · p95 " + s.p95.toFixed(1) + " ms · " + count + " particles"; }
});
function resize() {
  const ratio = runtime.pixelRatio(innerWidth, innerHeight);
  canvas.width = Math.round(innerWidth * ratio); canvas.height = Math.round(innerHeight * ratio);
}
addEventListener("resize", resize); addEventListener("paean:runtime", resize);
resize(); runtime.restore();
runtime.startLoop(dt => {
  elapsed += dt;
  ctx.fillStyle = "#061522"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < count; i++) {
    const x = (Math.sin(i * 1.71 + elapsed * .4) * .48 + .5) * canvas.width;
    const y = (Math.cos(i * .83 + elapsed * .3) * .48 + .5) * canvas.height;
    ctx.fillStyle = ["#65e8f0", "#7495ef", "#e6d6a1"][i % 3];
    ctx.beginPath(); ctx.arc(x, y, 1.5 + (i % 5), 0, Math.PI * 2); ctx.fill();
  }
  runtime.ready();
});
window.runtimeBenchmark = { runtime, get elapsed() { return elapsed; } };
