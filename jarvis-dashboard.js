// Jarvis Hub Dashboard v0.4
const LIT  = 'https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js';
const THR  = 'https://esm.sh/three@0.160.0';


const [litM, thrM] = await Promise.all([import(LIT), import(THR)]);
const { LitElement, html, css, nothing } = litM;
const THR  = 'https://esm.sh/three@0.160.0';



function parseSTL(buffer) {
  const dv = new DataView(buffer);
  const numTri = dv.getUint32(80, true);
  if (buffer.byteLength !== 84 + numTri * 50) return null; // ASCII STL unsupported
  const pos = new Float32Array(numTri * 9);
  const nrm = new Float32Array(numTri * 9);
  let off = 84, pi = 0, ni = 0;
  for (let i = 0; i < numTri; i++) {
    const nx = dv.getFloat32(off, true), ny = dv.getFloat32(off+4, true), nz = dv.getFloat32(off+8, true);
    off += 12;
    for (let v = 0; v < 3; v++) {
      pos[pi++] = dv.getFloat32(off, true);
      pos[pi++] = dv.getFloat32(off+4, true);
      pos[pi++] = dv.getFloat32(off+8, true);
      nrm[ni++] = nx; nrm[ni++] = ny; nrm[ni++] = nz;
      off += 12;
    }
    off += 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(nrm, 3));
  return geo;
}

class JarvisDashboard extends LitElement {

  static properties = {
    hass:           {},
    _config:        { state: true },
    _leftOpen:      { state: true },
    _rightOpen:     { state: true },
    _logOpen:       { state: true },
    _activeView:    { state: true },
    _activeProject: { state: true },
    _chatInput:     { state: true },
    _projects:      { state: true },
    _messages:      { state: true },
    _log:           { state: true },
    _sending:       { state: true },
    _files:         { state: true },
    _svgUrl:        { state: true },
  };

  constructor() {
    super();
    this._leftOpen      = true;
    this._rightOpen     = true;
    this._logOpen       = true;
    this._activeView    = 'workspace';
    this._activeProject = null;
    this._chatInput     = '';
    this._projects      = [];
    this._messages      = [];
    this._log           = [];
    this._sending       = false;
    this._files         = [];
    this._svgUrl        = null;
    this._three         = null;
  }

  setConfig(config) {
    this._config = config;
    if (config.api_url && config.api_key) this._loadData();
  }
  static getStubConfig() { return { api_url: '', api_key: '' }; }

  get _apiUrl()     { return (this._config?.api_url ?? '').replace(/\/$/, ''); }
  get _apiHeaders() { return { 'Content-Type': 'application/json', 'X-API-Key': this._config?.api_key ?? '' }; }

  // ── Data ──────────────────────────────────────────────────────────────────

  async _loadData() {
    await Promise.all([this._loadProjects(), this._loadLog()]);
  }

  async _loadProjects() {
    try {
      const r = await fetch(`${this._apiUrl}/api/projects`, { headers: this._apiHeaders });
      if (r.ok) this._projects = await r.json();
    } catch (_) {}
  }

  async _loadLog() {
    try {
      const r = await fetch(`${this._apiUrl}/api/log`, { headers: this._apiHeaders });
      if (r.ok) {
        const raw = await r.json();
        this._log = raw.map(m => ({
          type: m.role === 'user' ? 'cmd' : 'resp',
          time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          text: m.content,
          project: m.project_name,
        })).reverse();
      }
    } catch (_) {}
  }

  async _loadMessages(projectId) {
    try {
      const r = await fetch(`${this._apiUrl}/api/projects/${projectId}/messages`, { headers: this._apiHeaders });
      if (r.ok) this._messages = await r.json();
    } catch (_) {}
  }

  async _loadFiles(projectId) {
    try {
      const r = await fetch(`${this._apiUrl}/api/projects/${projectId}/files`, { headers: this._apiHeaders });
      if (r.ok) this._files = await r.json();
    } catch (_) {}
  }

  async _selectProject(p) {
    this._activeProject = p;
    this._activeView = p.type === '3d_model' ? '3d' : p.type === 'svg' ? 'svg' : 'workspace';
    this._messages = [];
    this._files = [];
    this._disposeThree();
    if (this._svgUrl) { URL.revokeObjectURL(this._svgUrl); this._svgUrl = null; }

    await Promise.all([this._loadMessages(p.id), this._loadFiles(p.id)]);

    if (this._activeView === '3d') {
      await this.updateComplete;
      this._initThree();
      const stl = this._files.find(f => f.file_type === 'stl');
      if (stl) await this._loadSTL(stl.id);
    } else if (this._activeView === 'svg') {
      const svg = this._files.find(f => f.file_type === 'svg');
      if (svg) await this._loadSVGFile(svg.id);
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  async _sendChat() {
    const msg = this._chatInput.trim();
    if (!msg || this._sending) return;
    this._chatInput = '';
    this._sending = true;
    this._messages = [...this._messages, { id: '_u', role: 'user', content: msg }];
    try {
      const r = await fetch(`${this._apiUrl}/api/chat`, {
        method: 'POST',
        headers: this._apiHeaders,
        body: JSON.stringify({ message: msg, project_id: this._activeProject?.id ?? null }),
      });
      if (r.ok) {
        const d = await r.json();
        this._messages = [...this._messages, { id: '_j', role: 'jarvis', content: d.response }];
        this._loadLog();
      } else {
        this._messages = [...this._messages, { id: '_e', role: 'jarvis', content: 'Something went wrong. Try again.' }];
      }
    } catch (_) {
      this._messages = [...this._messages, { id: '_e', role: 'jarvis', content: "Can't reach the API right now." }];
    }
    this._sending = false;
  }

  async _newProject() {
    const name = prompt('Project name:');
    if (!name?.trim()) return;
    const typeInput = prompt('Type (3d_model / svg / note / other):', 'other');
    const type = ['3d_model','svg','note','other'].includes(typeInput) ? typeInput : 'other';
    try {
      const r = await fetch(`${this._apiUrl}/api/projects`, {
        method: 'POST',
        headers: this._apiHeaders,
        body: JSON.stringify({ name: name.trim(), type }),
      });
      if (r.ok) {
        const p = await r.json();
        this._projects = [p, ...this._projects];
        await this._selectProject(p);
      }
    } catch (_) {}
  }

  _onChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
  }

  // ── File upload ───────────────────────────────────────────────────────────

  async _onFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !this._activeProject) return;
    e.target.value = '';
    const ext      = file.name.split('.').pop().toLowerCase();
    const fileType = ext === 'stl' ? 'stl' : 'svg';
    const buf      = await file.arrayBuffer();
    try {
      const r = await fetch(`${this._apiUrl}/api/projects/${this._activeProject.id}/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-API-Key':    this._config?.api_key ?? '',
          'X-File-Name':  file.name,
          'X-File-Type':  fileType,
        },
        body: buf,
      });
      if (r.ok) {
        const f = await r.json();
        this._files = [f, ...this._files];
        if (fileType === 'stl') {
          this._activeView = '3d';
          await this.updateComplete;
          this._disposeThree();
          this._initThree();
          await this._loadSTL(f.id);
        } else {
          this._activeView = 'svg';
          await this._loadSVGFile(f.id);
        }
      }
    } catch (_) {}
  }

  // ── Three.js ─────────────────────────────────────────────────────────────

  _makeOrbit(canvas, camera, initRadius) {
    let down = false, lastX = 0, lastY = 0;
    let theta = 0, phi = Math.PI / 2.5, radius = initRadius;
    const update = () => {
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(0, 0, 0);
    };
    canvas.addEventListener('mousedown',  e => { down = true; lastX = e.clientX; lastY = e.clientY; });
    canvas.addEventListener('mousemove',  e => {
      if (!down) return;
      theta -= (e.clientX - lastX) * 0.008;
      phi    = Math.max(0.1, Math.min(Math.PI - 0.1, phi - (e.clientY - lastY) * 0.008));
      lastX  = e.clientX; lastY = e.clientY;
      update();
    });
    canvas.addEventListener('mouseup',    () => down = false);
    canvas.addEventListener('mouseleave', () => down = false);
    canvas.addEventListener('wheel', e => {
      radius = Math.max(1, Math.min(20, radius + e.deltaY * 0.02));
      update(); e.preventDefault();
    }, { passive: false });
    update();
    return { reset: () => { theta = 0; phi = Math.PI / 2.5; radius = initRadius; update(); } };
  }

    _initThree() {
    if (this._three) return;
    const canvas = this.shadowRoot?.querySelector('#three-canvas');
    if (!canvas) return;

    const w = canvas.clientWidth  || 640;
    const h = canvas.clientHeight || 360;

    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d14);

    const camera   = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.set(0, 0, 6);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0x00f5ff, 1.5);
    key.position.set(5, 10, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-5, -5, -5);
    scene.add(fill);

    const geo      = new THREE.IcosahedronGeometry(1.5, 1);
    const mat      = new THREE.MeshPhongMaterial({ color: 0x00f5ff, opacity: 0.85, transparent: true, shininess: 80 });
    const wireMat  = new THREE.MeshBasicMaterial({ color: 0x003d44, wireframe: true });
    const demoMesh = new THREE.Mesh(geo, mat);
    const demoWire = new THREE.Mesh(geo.clone(), wireMat);
    scene.add(demoMesh, demoWire);

    const controls = this._makeOrbit(canvas, camera, 6);

    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    ro.observe(canvas);

    let animFrame;
    const animate = () => {
      animFrame = requestAnimationFrame(animate);
      if (demoMesh.parent) { demoMesh.rotation.y += 0.004; demoWire.rotation.y += 0.004; }
      renderer.render(scene, camera);
    };
    animate();

    this._three = { scene, camera, renderer, controls, animFrame, ro, demoMesh, demoWire };
  }

  _disposeThree() {
    if (!this._three) return;
    cancelAnimationFrame(this._three.animFrame);
    this._three.ro.disconnect();
    this._three.renderer.dispose();
    this._three = null;
  }

  async _loadSTL(fileId) {
    if (!this._three) return;
    try {
      const r = await fetch(`${this._apiUrl}/api/files/${fileId}`, {
        headers: { 'X-API-Key': this._config?.api_key ?? '' },
      });
      if (!r.ok) return;
      const buffer = await r.arrayBuffer();

      const geo = parseSTL(buffer);
      if (!geo) return;
      geo.computeBoundingBox();

      const center = new THREE.Vector3();
      geo.boundingBox.getCenter(center);
      geo.translate(-center.x, -center.y, -center.z);

      const size  = new THREE.Vector3();
      geo.boundingBox.getSize(size);
      const scale = 3 / Math.max(size.x, size.y, size.z);
      geo.scale(scale, scale, scale);

      const { scene, demoMesh, demoWire } = this._three;
      scene.remove(demoMesh, demoWire);

      const mesh     = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x00f5ff, shininess: 60 }));
      const wireMesh = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: 0x003d44, wireframe: true }));
      scene.add(mesh, wireMesh);

      this._three.camera.position.set(0, 0, 6);
    } catch (_) {}
  }

  async _loadSVGFile(fileId) {
    try {
      const r = await fetch(`${this._apiUrl}/api/files/${fileId}`, {
        headers: { 'X-API-Key': this._config?.api_key ?? '' },
      });
      if (!r.ok) return;
      const blob = await r.blob();
      if (this._svgUrl) URL.revokeObjectURL(this._svgUrl);
      this._svgUrl = URL.createObjectURL(blob);
    } catch (_) {}
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  updated(changed) {
    if (changed.has('_activeView')) {
      if (this._activeView !== '3d') {
        this._disposeThree();
      } else if (this._activeProject) {
        this.updateComplete.then(() => this._initThree());
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeThree();
    if (this._svgUrl) URL.revokeObjectURL(this._svgUrl);
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  static styles = css`
    :host {
      display: block;
      --bg:         #0a0d14;
      --surface:    #10141e;
      --surface2:   #161c2a;
      --border:     #1e2638;
      --accent:     #00f5ff;
      --accent-dim: #003d44;
      --text:       #d0d8e8;
      --text-dim:   #4a5a70;
      --radius:     10px;
      --panel-w:    220px;
      height: 100%;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      color: var(--text);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .root {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 500px;
      background: var(--bg);
      border-radius: var(--radius);
      overflow: hidden;
      border: 1px solid var(--border);
    }

    .statusbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 14px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .logo { font-size: 1rem; font-weight: 800; letter-spacing: 4px; color: var(--accent); text-transform: uppercase; }
    .pulse {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 6px var(--accent);
      animation: pulse 2.5s infinite; flex-shrink: 0;
    }
    @keyframes pulse {
      0%,100% { opacity:1; transform:scale(1); }
      50%      { opacity:.4; transform:scale(.85); }
    }
    .project-label { flex: 1; font-size: 0.8rem; color: var(--text-dim); }
    .project-label b { color: var(--text); font-weight: 500; }
    .toggle-btn {
      background: none; border: 1px solid var(--border); border-radius: 5px;
      color: var(--text-dim); cursor: pointer; font-size: 0.75rem; padding: 3px 8px; transition: all .15s;
    }
    .toggle-btn:hover { border-color: var(--accent); color: var(--accent); }

    .main { display: flex; flex: 1; overflow: hidden; min-height: 0; }

    .panel {
      width: var(--panel-w); background: var(--surface);
      display: flex; flex-direction: column; flex-shrink: 0;
      transition: width .25s ease; overflow: hidden;
    }
    .panel-left  { border-right: 1px solid var(--border); }
    .panel-right { border-left:  1px solid var(--border); }
    .panel.closed { width: 32px; }
    .panel-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 10px; border-bottom: 1px solid var(--border);
      font-size: 0.7rem; font-weight: 700; letter-spacing: 1.5px;
      text-transform: uppercase; color: var(--accent); flex-shrink: 0;
    }
    .panel-head button { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: .9rem; }
    .panel-head button:hover { color: var(--accent); }
    .panel.closed .panel-head { justify-content: center; padding: 8px 0; }
    .panel.closed .panel-head .ph-label, .panel.closed .panel-body { display: none; }
    .ph-icon { font-size: 1rem; }
    .panel-body { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }

    .chat-msgs {
      flex: 1; overflow-y: auto; padding: 10px;
      display: flex; flex-direction: column; gap: 7px; min-height: 0;
    }
    .chat-msgs::-webkit-scrollbar { width: 3px; }
    .chat-msgs::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    .msg { padding: 7px 9px; border-radius: 7px; font-size: 0.8rem; line-height: 1.5; }
    .msg-role { font-size: 0.65rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 2px; opacity: .6; }
    .msg.user   { background:#0d2d40; border:1px solid #1a4a60; color:#8ecfef; }
    .msg.jarvis { background:#0a2010; border:1px solid #1a4020; color:#80d080; }
    .msg.sending { opacity: .5; }

    .chat-footer { padding: 7px; border-top: 1px solid var(--border); display: flex; gap: 5px; flex-shrink: 0; }
    .chat-footer textarea {
      flex: 1; background: var(--surface2); border: 1px solid var(--border);
      border-radius: 6px; color: var(--text); font-family: inherit;
      font-size: 0.8rem; padding: 5px 7px; resize: none; height: 52px;
    }
    .chat-footer textarea:focus { outline: none; border-color: var(--accent); }
    .chat-footer textarea:disabled { opacity: .5; }
    .send-btn {
      background: var(--accent); border: none; border-radius: 6px;
      color: #000; cursor: pointer; font-size: 1rem; font-weight: 700;
      padding: 0 10px; transition: opacity .15s;
    }
    .send-btn:disabled { opacity: .4; cursor: not-allowed; }
    .send-btn:hover:not(:disabled) { opacity: .8; }

    .workspace {
      flex: 1; display: flex; align-items: center; justify-content: center;
      padding: 14px; overflow: hidden; min-height: 0;
    }
    .ws-surface {
      width: 100%; aspect-ratio: 16/9; max-height: 100%;
      background: var(--surface2); border: 1px solid var(--border);
      border-radius: var(--radius); position: relative; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      background-image:
        linear-gradient(var(--border) 1px, transparent 1px),
        linear-gradient(90deg, var(--border) 1px, transparent 1px);
      background-size: 40px 40px;
    }
    .ws-idle { display: flex; flex-direction: column; align-items: center; gap: 10px; user-select: none; pointer-events: none; }
    .ws-idle .watermark { font-size: 3.5rem; font-weight: 900; letter-spacing: 10px; color: var(--accent); opacity: .06; text-transform: uppercase; }
    .ws-idle p { font-size: .8rem; color: var(--text-dim); opacity: .6; }

    /* 3D canvas */
    .ws-canvas-wrap { position: absolute; inset: 0; }
    #three-canvas   { width: 100%; height: 100%; display: block; }

    /* SVG viewer */
    .svg-viewer {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      padding: 20px; background: var(--bg);
    }
    .svg-viewer img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }
    .ws-hint { color: var(--text-dim); font-size: .82rem; text-align: center; line-height: 1.8; }

    .view-tabs {
      position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 3px; background: rgba(0,0,0,.5); backdrop-filter: blur(4px);
      padding: 3px; border-radius: 7px; border: 1px solid var(--border); z-index: 10;
    }
    .vt {
      background: none; border: none; border-radius: 5px;
      color: var(--text-dim); cursor: pointer; font-size: .72rem; padding: 3px 10px; transition: all .15s;
    }
    .vt.on { background: var(--accent); color: #000; font-weight: 700; }

    .ws-project-info { text-align: center; }
    .ws-project-info h2 { font-size: 1.2rem; font-weight: 600; color: var(--text); margin-bottom: 6px; }
    .ws-project-info p  { font-size: .82rem; color: var(--text-dim); }
    .badge {
      display: inline-block; background: var(--accent-dim); color: var(--accent);
      font-size: .65rem; font-weight: 700; letter-spacing: 1px;
      padding: 2px 8px; border-radius: 4px; text-transform: uppercase; margin-top: 6px;
    }

    .gallery-list {
      flex: 1; overflow-y: auto; padding: 8px;
      display: flex; flex-direction: column; gap: 5px; min-height: 0;
    }
    .gallery-list::-webkit-scrollbar { width: 3px; }
    .gallery-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    .proj-card {
      background: var(--surface2); border: 1px solid var(--border);
      border-radius: 7px; padding: 9px 10px; cursor: pointer; transition: all .15s;
    }
    .proj-card:hover  { border-color: var(--accent); }
    .proj-card.active { border-color: var(--accent); background: rgba(0,245,255,.05); }
    .proj-card .pc-name { font-size: .82rem; font-weight: 500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .proj-card .pc-meta { font-size: .68rem; color: var(--text-dim); margin-top: 2px; }
    .gallery-empty { font-size: .78rem; color: var(--text-dim); text-align: center; padding: 20px 10px; }
    .gallery-foot { padding: 7px; border-top: 1px solid var(--border); flex-shrink: 0; }
    .new-btn {
      width: 100%; background: rgba(0,245,255,.08); border: 1px solid var(--accent);
      border-radius: 6px; color: var(--accent); cursor: pointer; font-size: .78rem; font-weight: 600; padding: 6px;
    }
    .new-btn:hover { background: rgba(0,245,255,.15); }

    .actionbar {
      display: flex; gap: 6px; padding: 7px 12px;
      background: var(--surface); border-top: 1px solid var(--border);
      flex-shrink: 0; flex-wrap: wrap;
    }
    .act {
      background: var(--surface2); border: 1px solid var(--border);
      border-radius: 6px; color: var(--text-dim); cursor: pointer;
      font-size: .75rem; padding: 4px 12px; transition: all .15s;
    }
    .act:hover    { border-color: var(--accent); color: var(--accent); }
    .act:disabled { opacity: .3; cursor: not-allowed; }

    .logdrawer {
      background: var(--surface); border-top: 1px solid var(--border);
      flex-shrink: 0; display: flex; flex-direction: column;
      transition: max-height .3s ease; max-height: 220px; overflow: hidden;
    }
    .logdrawer.collapsed { max-height: 32px; }
    .log-head {
      display: flex; align-items: center; gap: 8px; padding: 6px 14px;
      cursor: pointer; flex-shrink: 0; user-select: none; min-height: 32px;
    }
    .log-head:hover { background: var(--surface2); }
    .lh-title { font-size: .7rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent); flex-shrink: 0; }
    .lh-last  { flex: 1; font-size: .72rem; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lh-chevron { color: var(--text-dim); font-size: .75rem; transition: transform .25s; flex-shrink: 0; }
    .logdrawer:not(.collapsed) .lh-chevron { transform: rotate(180deg); }
    .log-body { flex: 1; overflow-y: auto; padding: 6px 14px 10px; display: flex; flex-direction: column; gap: 3px; }
    .log-body::-webkit-scrollbar { width: 3px; }
    .log-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    .log-entry { display: flex; gap: 8px; align-items: baseline; font-size: .74rem; line-height: 1.4; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,.03); }
    .le-time  { color: var(--text-dim); flex-shrink: 0; font-family: monospace; font-size: .68rem; }
    .le-type  { flex-shrink: 0; font-size: .63rem; font-weight: 700; letter-spacing: .5px; padding: 1px 5px; border-radius: 3px; }
    .log-entry.cmd  .le-type { background: rgba(0,245,255,.12); color: var(--accent); }
    .log-entry.resp .le-type { background: rgba(80,200,80,.12);  color: #80d080; }
    .log-entry.sys  .le-type { background: rgba(255,170,0,.12);  color: #ffaa00; }
    .le-proj { color: var(--text-dim); font-size: .65rem; flex-shrink: 0; }
    .le-text { color: var(--text); flex: 1; }

    @media (max-width: 680px) {
      .root { height: auto; min-height: 400px; }
      .main { flex-direction: column; }
      .panel { width: 100% !important; max-height: 180px; }
      .panel-left  { border-right: none; border-bottom: 1px solid var(--border); }
      .panel-right { border-left:  none; border-top:    1px solid var(--border); }
      .panel.closed { width: 100% !important; max-height: 32px; }
    }
  `;

  // ── Render helpers ────────────────────────────────────────────────────────

  get _demoMessages() { return [{ id:'1', role:'jarvis', content:'Jarvis online. How can I help?' }]; }

  get _demoLog() {
    const t = d => new Date(Date.now()-d*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return [{ type:'sys', time:t(5), text:'Connected to Jarvis API' }];
  }

  _renderMsg(m) {
    return html`
      <div class="msg ${m.role} ${m.id==='_sending'?'sending':''}">
        <div class="msg-role">${m.role==='jarvis'?'⬡ Jarvis':'▶ You'}</div>
        ${m.content}
      </div>`;
  }

  _renderProjCard(p) {
    const labels = { '3d_model':'3D', svg:'SVG', note:'Note', other:'—' };
    return html`
      <div class="proj-card ${this._activeProject?.id===p.id?'active':''}"
           @click=${()=>this._selectProject(p)}>
        <div class="pc-name">${p.name}</div>
        <div class="pc-meta">${labels[p.type]??p.type}</div>
      </div>`;
  }

  _renderLogEntry(e) {
    return html`
      <div class="log-entry ${e.type}">
        <span class="le-time">${e.time}</span>
        <span class="le-type">${e.type==='cmd'?'CMD':e.type==='resp'?'RESP':'SYS'}</span>
        ${e.project?html`<span class="le-proj">[${e.project}]</span>`:nothing}
        <span class="le-text">${e.text}</span>
      </div>`;
  }

  _renderWorkspaceSurface() {
    if (!this._activeProject) return html`
      <div class="ws-idle">
        <div class="watermark">Jarvis</div>
        <p>Select or create a project</p>
      </div>`;

    const tabs = html`
      <div class="view-tabs">
        <button class="vt ${this._activeView==='workspace'?'on':''}" @click=${()=>this._activeView='workspace'}>Info</button>
        ${this._activeProject.type==='3d_model'?html`<button class="vt ${this._activeView==='3d'?'on':''}" @click=${()=>this._activeView='3d'}>3D</button>`:nothing}
        ${this._activeProject.type==='svg'?html`<button class="vt ${this._activeView==='svg'?'on':''}" @click=${()=>this._activeView='svg'}>SVG</button>`:nothing}
      </div>`;

    let body;
    if (this._activeView === '3d') {
      body = html`<div class="ws-canvas-wrap"><canvas id="three-canvas"></canvas></div>`;
    } else if (this._activeView === 'svg') {
      body = html`<div class="svg-viewer">
        ${this._svgUrl
          ? html`<img src=${this._svgUrl} alt="SVG preview">`
          : html`<p class="ws-hint">No SVG uploaded yet.<br>Use ⬆ Upload to add one.</p>`}
      </div>`;
    } else {
      body = html`
        <div class="ws-project-info">
          <h2>${this._activeProject.name}</h2>
          <p>${this._activeProject.description??'No description'}</p>
          <span class="badge">${this._activeProject.type}</span>
        </div>`;
    }

    return html`${tabs}${body}`;
  }

  render() {
    const haProj   = !!this._activeProject;
    const messages = this._messages.length ? this._messages : this._demoMessages;
    const projects = this._projects;
    const log      = this._log.length ? this._log : this._demoLog;
    const lastLog  = log.at(-1);

    return html`
      <input type="file" id="fu" accept=".stl,.svg" style="display:none" @change=${this._onFileSelect}>

      <div class="root">
        <div class="statusbar">
          <span class="logo">Jarvis</span>
          <div class="pulse"></div>
          <div class="project-label">
            ${haProj?html`Project: <b>${this._activeProject.name}</b>`:'No active project'}
          </div>
          <button class="toggle-btn" @click=${()=>this._leftOpen=!this._leftOpen}>${this._leftOpen?'◀':'▶'} Chat</button>
          <button class="toggle-btn" @click=${()=>this._rightOpen=!this._rightOpen}>Projects ${this._rightOpen?'▶':'◀'}</button>
        </div>

        <div class="main">
          <div class="panel panel-left ${this._leftOpen?'':'closed'}">
            <div class="panel-head">
              <span class="ph-label">Chat</span>
              <span class="ph-icon">💬</span>
              <button class="ph-label" @click=${()=>this._leftOpen=false}>✕</button>
            </div>
            <div class="panel-body">
              <div class="chat-msgs">
                ${messages.map(m=>this._renderMsg(m))}
                ${this._sending?html`<div class="msg jarvis sending"><div class="msg-role">⬡ Jarvis</div>…</div>`:nothing}
              </div>
              <div class="chat-footer">
                <textarea
                  .value=${this._chatInput}
                  @input=${e=>this._chatInput=e.target.value}
                  @keydown=${this._onChatKey}
                  ?disabled=${this._sending}
                  placeholder="Ask Jarvis…"></textarea>
                <button class="send-btn" ?disabled=${this._sending} @click=${this._sendChat}>▶</button>
              </div>
            </div>
          </div>

          <div class="workspace">
            <div class="ws-surface">${this._renderWorkspaceSurface()}</div>
          </div>

          <div class="panel panel-right ${this._rightOpen?'':'closed'}">
            <div class="panel-head">
              <span class="ph-icon">📁</span>
              <span class="ph-label">Projects</span>
              <button class="ph-label" @click=${()=>this._rightOpen=false}>✕</button>
            </div>
            <div class="panel-body">
              <div class="gallery-list">
                ${projects.length
                  ? projects.map(p=>this._renderProjCard(p))
                  : html`<div class="gallery-empty">No projects yet.<br>Create one below.</div>`}
              </div>
              <div class="gallery-foot">
                <button class="new-btn" @click=${this._newProject}>+ New Project</button>
              </div>
            </div>
          </div>
        </div>

        <div class="actionbar">
          <button class="act" ?disabled=${!haProj}>🖨 Print</button>
          <button class="act" ?disabled=${!haProj}>✂ Cut</button>
          <button class="act" ?disabled=${!haProj}>⬇ Export</button>
          <button class="act" ?disabled=${!haProj} @click=${()=>this.shadowRoot.querySelector('#fu').click()}>⬆ Upload</button>
          <button class="act" @click=${this._loadData}>↻ Refresh</button>
        </div>

        <div class="logdrawer ${this._logOpen?'':'collapsed'}">
          <div class="log-head" @click=${()=>this._logOpen=!this._logOpen}>
            <span class="lh-title">⬡ Activity Log</span>
            <span class="lh-last">${lastLog?.text??''}</span>
            <span class="lh-chevron">▼</span>
          </div>
          <div class="log-body">${log.map(e=>this._renderLogEntry(e))}</div>
        </div>
      </div>`;
  }
}

customElements.define('jarvis-dashboard', JarvisDashboard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'jarvis-dashboard',
  name: 'Jarvis Dashboard',
  description: 'Jarvis Hub — AI assistant, project gallery, and HoloMat workspace',
  preview: true,
});
