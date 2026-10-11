const canvas = document.querySelector("canvas"), gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
if (!gl) throw new Error("WebGL2 is required for this benchmark fixture");
let program, timeLocation, ratioLocation, elapsed = 0, instances = 6000;
function rebuild() {
  function shader(type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const vs = shader(gl.VERTEX_SHADER, "#version 300 es\nprecision highp float;uniform float t;uniform float aspect;out vec3 color;void main(){int face=gl_VertexID/6;int corner=gl_VertexID%6;vec2 q=vec2((corner==1||corner==2||corner==4)?1.:-1.,(corner==2||corner==4||corner==5)?1.:-1.);vec3 p=face<2?vec3(q,float(face*2-1)):face<4?vec3(q.x,float((face-2)*2-1),q.y):vec3(float((face-4)*2-1),q);float i=float(gl_InstanceID);float a=t*.35+i*.01;mat2 rot=mat2(cos(a),-sin(a),sin(a),cos(a));p*=.065;p.xz=rot*p.xz;vec3 c=vec3(mod(i,25.)-12.,mod(floor(i/25.),16.)-8.,floor(i/400.)*.8+3.);c.xy*=.23;c.xy=rot*c.xy;p+=c;gl_Position=vec4(p.x/aspect,p.y,p.z*.95-1.,p.z);color=vec3(.15+float(face)*.06,.45+mod(i,9.)*.025,.7+float(face)*.03);}");
  const fs = shader(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;in vec3 color;out vec4 outColor;void main(){outColor=vec4(color,1.);}");
  program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.deleteShader(vs); gl.deleteShader(fs);
  timeLocation = gl.getUniformLocation(program, "t"); ratioLocation = gl.getUniformLocation(program, "aspect");
  gl.enable(gl.DEPTH_TEST);
}
rebuild();
const runtime = createPaeanRuntime({
  canvas: true, opaque: true, keepAwake: true, version: "benchmark-3d-v1", saveKey: "benchmark-3d",
  getSave: () => ({ elapsed }), applySave: s => { if (Number.isFinite(s.elapsed)) elapsed = s.elapsed; },
  onQuality: q => { instances = [6000, 4000, 2400, 1200][q.level]; },
  onSample: s => { document.querySelector("output").textContent = "WebGL2 · p95 " + s.p95.toFixed(1) + " ms · " + instances + " cubes"; }
});
function resize() {
  const ratio = runtime.pixelRatio(innerWidth, innerHeight);
  canvas.width = Math.round(innerWidth * ratio); canvas.height = Math.round(innerHeight * ratio);
}
addEventListener("resize", resize); addEventListener("paean:runtime", resize); resize();
runtime.watchCanvas(canvas, rebuild); runtime.restore();
runtime.startLoop(dt => {
  elapsed += dt; gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(.03,.06,.13,1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(program); gl.uniform1f(timeLocation, elapsed); gl.uniform1f(ratioLocation, canvas.width/canvas.height);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, instances);
  runtime.ready();
});
window.runtimeBenchmark = { runtime, get elapsed() { return elapsed; } };
