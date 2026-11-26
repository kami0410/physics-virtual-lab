// 三维舞台：渲染器、相机、轨道控制、光照、拾取与标签
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class Stage {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    // 手机/平板：像素比封顶 1.25，填充率降为原来的一半左右，帧率更稳
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.25 : 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'three';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'labels';
    container.appendChild(this.labelRenderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x171b1a);
    scene.fog = new THREE.Fog(0x171b1a, 380, 1100);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this._envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = this._envRT.texture;
    pmrem.dispose();
    scene.environmentIntensity = 0.55;
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 3000);
    this.camera.position.set(40, 90, 160);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 600;
    this.controls.target.set(50, 20, 0);

    const hemi = new THREE.HemisphereLight(0xf1f2ea, 0x1d2220, 0.6);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(80, 180, 120);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = -160; sc.right = 160; sc.top = 120; sc.bottom = -120; sc.near = 10; sc.far = 500;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.3;
    scene.add(key); scene.add(key.target);
    this.keyLight = key;
    this.ambient = hemi;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.frameFns = new Set();
    this.clock = new THREE.Clock();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();
    this._running = true;
    // 按需渲染：只有相机移动、场景变化或飞行动画时才重绘；静止时每 300 ms 兜底刷新一次
    this._need = 2;
    this._lastRender = 0;
    this.controls.addEventListener('change', () => this.invalidate());
    renderer.domElement.addEventListener('pointermove', () => this.invalidate());
    const loop = () => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, this.clock.getDelta()); // 低帧率设备上预热等过程仍按真实时间推进
      if (this._fly) { this._stepFly(dt); this._need = 2; }
      this.controls.update();
      for (const f of this.frameFns) f(dt);
      const now = performance.now();
      if (this._need > 0 || now - this._lastRender > 300) {
        this._need = Math.max(0, this._need - 1);
        this._lastRender = now;
        renderer.render(scene, this.camera);
        this.labelRenderer.render(scene, this.camera);
        if (now - (this._lastDeclutter || 0) > 160) { this._lastDeclutter = now; this.declutter(); }
      }
    };
    loop();
  }

  /** 标记需要重绘（连续两帧，保证阴影与标签同步） */
  invalidate() { this._need = 2; }

  setLightTarget(x, y, z) {
    this.keyLight.target.position.set(x, y, z);
    this.keyLight.position.set(x + 60, y + 180, z + 120);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  /** 与水平面 y=planeY 求交 */
  hitPlane(e, planeY) {
    const inside = this.setPointer(e);
    const p = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), p);
    return inside && ok ? p : null;
  }

  pickObjects(e, objects) {
    this.setPointer(e);
    const hits = this.raycaster.intersectObjects(objects, true);
    return hits[0] || null;
  }

  /** 平滑飞行到指定视角 */
  flyTo(pos, target, ms = 900) {
    return new Promise((res) => {
      this._fly = {
        p0: this.camera.position.clone(), t0: this.controls.target.clone(),
        p1: new THREE.Vector3(...pos), t1: new THREE.Vector3(...target), start: performance.now(), dur: ms, res,
      };
    });
  }
  _stepFly(dt) {
    const f = this._fly;
    f.t = (performance.now() - f.start) / f.dur;
    const k = f.t >= 1 ? 1 : 1 - Math.pow(1 - f.t, 3);
    this.camera.position.lerpVectors(f.p0, f.p1, k);
    this.controls.target.lerpVectors(f.t0, f.t1, k);
    if (f.t >= 1) { this._fly = null; f.res(); }
  }

  /** 标签避让：彼此重叠的标签依次往上挪，不再叠成一团（只改 margin，transform 归 CSS2DRenderer） */
  declutter() {
    const box = this.labelRenderer.domElement;
    if (box.style.display === 'none') return;
    const els = [...box.children].filter((e) => e.style.display !== 'none' && e.offsetParent);
    if (els.length < 2) { els.forEach((e) => (e.style.marginTop = '')); return; }
    const items = els.map((e) => { const r = e.getBoundingClientRect(), m = parseFloat(e.style.marginTop) || 0; return { e, l: r.left, r: r.right, t: r.top - m, b: r.bottom - m, m }; });
    items.sort((a, b) => b.b - a.b || a.l - b.l);
    const placed = [];
    for (const it of items) {
      let dy = 0;
      for (let pass = 0; pass < 8; pass++) {
        const hit = placed.find((p) => it.l < p.r - 2 && it.r > p.l + 2 && it.t - dy < p.b - 1 && it.b - dy > p.t + 1);
        if (!hit) break;
        dy = it.b - hit.t + 2;
      }
      placed.push({ l: it.l, r: it.r, t: it.t - dy, b: it.b - dy });
      if (Math.abs(-dy - it.m) > 0.5) it.e.style.marginTop = dy ? `${-dy}px` : '';
    }
  }

  makeLabel(html, cls = 'lbl') {
    const div = document.createElement('div');
    div.className = cls; div.innerHTML = html;
    const o = new CSS2DObject(div);
    o.center.set(0.5, 1);
    return o;
  }

  dispose() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    this._envRT && this._envRT.dispose();
    this.renderer.dispose();
    // 立即释放 WebGL 上下文：浏览器同时存活的上下文有上限（Chrome 约 16 个），超出后最早的会丢失
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
