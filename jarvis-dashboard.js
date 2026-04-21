// Jarvis Hub Dashboard v0.24
// Phase 2A: print pipeline wired to HoloMat API (.3mf upload → P1S).
// Phase 2B: Meshy.AI text-to-3D generation + GLB viewer.
const LIT = 'https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js';
const THR = 'https://esm.sh/three@0.160.0';

const [litM, thrM] = await Promise.all([import(LIT), import(THR)]);
const { LitElement, html, css, nothing } = litM;
const THREE = thrM;

function parseSTL(buffer) {
  const dv = new DataView(buffer);
  const numTri = dv.getUint32(80, true);
  if (buffer.byteLength !== 84 + numTri * 50) return null;
  const pos = new Float32Array(numTri * 9);
  const nrm = new Float32Array(numTri * 9);
  let off = 84, pi = 0, ni = 0;
  for (let i = 0; i < numTri; i++) {
    const nx = dv.getFloat32(off,true), ny = dv.getFloat32(off+4,true), nz = dv.getFloat32(off+8,true);
    off += 12;
    for (let v = 0; v < 3; v++) {
      pos[pi++] = dv.getFloat32(off,true); pos[pi++] = dv.getFloat32(off+4,true); pos[pi++] = dv.getFloat32(off+8,true);
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

const TYPE_LABELS = { '3d_model':'3D Model', svg:'Cricut Model', note:'Notes', other:'Other', glb:'3D Model (Meshy)', '3mf':'Print File' };

class JarvisDashboard extends LitElement {

  static properties = {
    hass:             {},
    _config:          { state: true },
    _leftOpen:        { state: true },
    _rightOpen:       { state: true },
    _logOpen:         { state: true },
    _activeView:      { state: true },
    _activeProject:   { state: true },
    _chatInput:       { state: true },
    _projects:        { state: true },
    _messages:        { state: true },
    _log:             { state: true },
    _sending:         { state: true },
    _files:           { state: true },
    _svgUrl:          { state: true },
    _showNewProject:  { state: true },
    _newProjName:     { state: true },
    _newProjType:     { state: true },
    _generating:      { state: true },
    _genError:        { state: true },
    _importing:       { state: true },
    _searchSession:   { state: true },
    _searchIndex:     { state: true },
    _loadingMore:     { state: true },
    _recording:       { state: true },
    _transcribing:    { state: true },
    _saving:          { state: true },
    _printModal:      { state: true },
    _meshyModal:      { state: true },
    _meshyPrompt:     { state: true },
    _meshyTask:       { state: true },
    _meshyProgress:   { state: true },
    _meshyStatus:     { state: true },
    _meshyThumb:      { state: true },
    _meshyError:      { state: true },
  };

  constructor() {
    super();
    this._leftOpen       = true;
    this._rightOpen      = true;
    this._activeView     = 'workspace';
    this._activeProject  = null;
    this._chatInput      = '';
    this._projects       = [];
    this._messages       = [];
    this._log            = [];
    this._sending        = false;
    this._files          = [];
    this._svgUrl         = null;
    this._three          = null;
    this._showNewProject = false;
    this._newProjName    = '';
    this._newProjType    = '3d_model';
    this._generating     = false;
    this._genError       = null;
    this._importing      = null;
    this._searchSession  = null;
    this._searchIndex    = 0;
    this._loadingMore    = false;
    this._recording      = false;
    this._transcribing   = false;
    this._mediaRecorder  = null;
    this._saving         = false;
    this._printModal     = false;
    this._meshyModal     = false;
    this._meshyPrompt    = '';
    this._meshyTask      = null;
    this._meshyProgress  = 0;
    this._meshyStatus    = 'idle';   // idle | pending | generating | saving | done | error
    this._meshyThumb     = null;
    this._meshyError     = null;
    this._meshyPollTimer = null;
    this._logOpen        = false;
  }

  setConfig(config) {
    this._config = config;
    if (config.api_url && config.api_key) this._loadData();
  }
  static getStubConfig() { return { api_url: '', api_key: '', holomat_url: '' }; }

  get _apiUrl()     { return (this._config?.api_url ?? '').replace(/\/$/, ''); }
  get _apiHeaders() { return { 'Content-Type': 'application/json', 'X-API-Key': this._config?.api_key ?? '' }; }
  get _holomatUrl() { return (this._config?.holomat_url ?? '').replace(/\/$/, ''); }

  async _loadData() { await Promise.all([this._loadProjects(), this._loadLog()]); }

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
          time: new Date(m.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
          text: m.content,
          project: m.project_name,
        })).reverse();
      }
    } catch (_) {}
  }

  _addLog(type, text) {
    const entry = {
      type,
      time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
      text,
    };
    this._log = [entry, ...this._log].slice(0, 200);
    this._logOpen = true;
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
    this._exitSearch();
    this._printModal = false;
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
      const glb = this._files.find(f => f.file_type === 'glb');
      const stl = this._files.find(f => f.file_type === 'stl');
      if (glb) await this._loadGLB(glb.id);
      else if (stl) await this._loadSTL(stl.id);
    } else if (this._activeView === 'svg') {
      const svg = this._files.find(f => f.file_type === 'svg');
      if (svg) await this._loadSVGFile(svg.id);
    }
  }

  _newProject() {
    this._newProjName = '';
    this._newProjType = '3d_model';
    this._showNewProject = true;
  }

  async _submitNewProject() {
    const name = this._newProjName.trim();
    if (!name) return;
    try {
      const r = await fetch(`${this._apiUrl}/api/projects`, {
        method: 'POST', headers: this._apiHeaders,
        body: JSON.stringify({ name, type: this._newProjType }),
      });
      if (r.ok) {
        const p = await r.json();
        this._projects = [p, ...this._projects];
        this._showNewProject = false;
        await this._selectProject(p);
      }
    } catch (_) {}
  }

  async _deleteProject(id) {
    if (!confirm('Delete this project and all its files? This cannot be undone.')) return;
    try {
      const r = await fetch(`${this._apiUrl}/api/projects/${id}`, {
        method: 'DELETE', headers: this._apiHeaders,
      });
      if (r.ok) {
        this._projects = this._projects.filter(p => p.id !== id);
        if (this._activeProject?.id === id) {
          this._activeProject = null;
          this._messages = [];
          this._files = [];
          this._disposeThree();
        }
      }
    } catch (_) {}
  }

  async _onFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file || !this._activeProject) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const fileType = ext === 'stl' ? 'stl' : ext === '3mf' ? '3mf' : 'svg';
    try {
      const r = await fetch(`${this._apiUrl}/api/projects/${this._activeProject.id}/files`, {
        method: 'POST',
        headers: { 'X-API-Key': this._config?.api_key ?? '', 'X-File-Name': file.name, 'X-File-Type': fileType },
        body: await file.arrayBuffer(),
      });
      if (r.ok) {
        const saved = await r.json();
        this._files = [saved, ...this._files];
        if (fileType === 'stl') {
          this._activeView = '3d';
          await this.updateComplete;
          this._disposeThree(); this._initThree();
          await this._loadSTL(saved.id);
        } else {
          this._activeView = 'svg';
          await this._loadSVGFile(saved.id);
        }
      }
    } catch (_) {}
  }

  _onChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
  }

  async _sendChat() {
    const msg = this._chatInput.trim();
    if (!msg || this._sending) return;
    this._chatInput = '';
    this._sending = true;
    const history = this._messages.slice(-20).map(m => ({ role: m.role, content: m.content }));
    this._messages = [...this._messages, { id: '_sending', role: 'user', content: msg }];
    try {
      const r = await fetch(`${this._apiUrl}/api/chat`, {
        method: 'POST', headers: this._apiHeaders,
        body: JSON.stringify({ message: msg, project_id: this._activeProject?.id ?? null, history }),
      });
      if (r.ok) {
        const d = await r.json();
        this._messages = this._messages.filter(m => m.id !== '_sending');
        if (this._activeProject) {
          await this._loadMessages(this._activeProject.id);
        } else {
          this._messages = [
            ...this._messages,
            { id: Date.now()+'u', role: 'user',   content: msg },
            { id: Date.now()+'j', role: 'jarvis', content: d.response },
          ];
        }
        if (d.search_results?.length) this._startSearchSession(d.search_results, d.search_query ?? '');
        // Auto-trigger Meshy if Jarvis responded with a meshy block
        const meshyMatch = d.response?.match(/```meshy[ \t]*\n?([\s\S]*?)```/i);
        if (meshyMatch && this._activeProject) {
          const prompt = meshyMatch[1].trim();
          this._meshyPrompt = prompt;
          this._meshyModal  = true;
          this._startMeshyGenerate();
        }
        this._loadLog();
      }
    } catch (_) {}
    this._sending = false;
  }

  // ── Thingiverse search ────────────────────────────────────────────────────

  _startSearchSession(results, query) {
    const sid = Date.now();
    this._searchSession = {
      sid, query,
      things: results.map(r => ({ ...r, status: 'idle', buffer: null, files: null, fileIndex: 0 })),
    };
    this._searchIndex = 0;
    this._activeView = '3d';
    this.updateComplete.then(() => {
      this._disposeThree(); this._initThree();
      this._loadSearchThing(0);
    });
  }

  async _loadSearchThing(idx) {
    const session = this._searchSession;
    if (!session) return;
    const sid = session.sid;
    const thing = session.things[idx];
    if (!thing || thing.status === 'loaded' || thing.status === 'loading') return;

    this._updateThing(idx, { status: 'loading' });
    try {
      const fr = await fetch(`${this._apiUrl}/api/thingiverse/files?thing_id=${thing.id}`, { headers: this._apiHeaders });
      if (this._searchSession?.sid !== sid) return;
      if (!fr.ok) throw new Error(`files ${fr.status}`);
      const files = await fr.json();
      if (this._searchSession?.sid !== sid) return;
      if (!files.length) throw new Error('no STL files');
      this._updateThing(idx, { files, fileIndex: 0, status: 'loading' });
      await this._fetchAndDisplaySTL(idx, files[0].id, sid);
    } catch (e) {
      if (this._searchSession?.sid !== sid) return;
      this._updateThing(idx, { status: 'error', error: e.message });
    }
  }

  async _fetchAndDisplaySTL(idx, fileId, sid) {
    const session = this._searchSession;
    if (!session || session.sid !== sid) return;
    const thing = session.things[idx];
    try {
      const buf = await this._fetchSTL(thing.id, fileId);
      if (this._searchSession?.sid !== sid) return;
      this._updateThing(idx, { buffer: buf, status: 'loaded' });
      if (idx === this._searchIndex) {
        const geo = parseSTL(buf);
        if (geo) { geo.computeVertexNormals(); this._loadSTLGeo(geo); }
      }
    } catch (e) {
      if (this._searchSession?.sid !== sid) return;
      this._updateThing(idx, { status: 'error', error: e.message });
    }
  }

  async _fetchSTL(thingId, fileId) {
    const r = await fetch(
      `${this._apiUrl}/api/thingiverse/stl?thing_id=${thingId}&file_id=${fileId}`,
      { headers: { 'X-API-Key': this._config?.api_key ?? '' } }
    );
    if (!r.ok) throw new Error(`STL ${r.status}`);
    return r.arrayBuffer();
  }

  _updateThing(idx, patch) {
    const session = this._searchSession;
    if (!session) return;
    const things = session.things.map((t, i) => i === idx ? { ...t, ...patch } : t);
    this._searchSession = { ...session, things };
  }

  async _setSearchIndex(idx) {
    const session = this._searchSession;
    if (!session) return;
    this._searchIndex = idx;
    const thing = session.things[idx];
    if (thing.status === 'loaded' && thing.buffer) {
      const geo = parseSTL(thing.buffer);
      if (geo) { geo.computeVertexNormals(); this._loadSTLGeo(geo); }
    } else if (thing.status === 'idle') {
      await this.updateComplete;
      this._loadSearchThing(idx);
    }
    // Preload neighbours
    const preload = [idx + 1, idx - 1].filter(i => i >= 0 && i < session.things.length);
    for (const i of preload) {
      const t = session.things[i];
      if (t.status === 'idle') this._loadSearchThing(i);
    }
  }

  _seeMoreFile() {
    const session = this._searchSession;
    if (!session) return;
    const thing = session.things[this._searchIndex];
    if (!thing.files?.length) return;
    const next = (thing.fileIndex + 1) % thing.files.length;
    this._updateThing(this._searchIndex, { fileIndex: next, status: 'loading', buffer: null });
    const sid = session.sid;
    this._fetchAndDisplaySTL(this._searchIndex, thing.files[next].id, sid);
  }

  async _loadMoreResults() {
    const session = this._searchSession;
    if (!session || this._loadingMore) return;
    this._loadingMore = true;
    const page = Math.floor(session.things.length / 10) + 1;
    try {
      const r = await fetch(`${this._apiUrl}/api/thingiverse/search?q=${encodeURIComponent(session.query)}&page=${page}`, { headers: this._apiHeaders });
      if (r.ok) {
        const more = await r.json();
        if (more.length) {
          const newThings = more.map(t => ({ ...t, status: 'idle', buffer: null, files: null, fileIndex: 0 }));
          this._searchSession = { ...session, things: [...session.things, ...newThings] };
        }
      }
    } catch (_) {}
    this._loadingMore = false;
  }

  _exitSearch() {
    this._clearSessionBlobs();
    this._searchSession = null;
    this._searchIndex = 0;
  }

  _clearSessionBlobs() {}

  // Save ALL STL files from current search result to active project
  async _saveThing() {
    const session = this._searchSession;
    if (!session || !this._activeProject) return;
    const thing = session.things[this._searchIndex];
    if (!thing.files?.length || thing.status !== 'loaded') return;
    this._saving = true;
    const saved = [];
    for (let fi = 0; fi < thing.files.length; fi++) {
      const file = thing.files[fi];
      try {
        const buf = (fi === thing.fileIndex && thing.buffer)
          ? thing.buffer
          : await this._fetchSTL(thing.id, file.id);
        const r = await fetch(`${this._apiUrl}/api/projects/${this._activeProject.id}/files`, {
          method: 'POST',
          headers: {
            'X-API-Key': this._config?.api_key ?? '',
            'X-File-Name': file.name,
            'X-File-Type': 'stl',
          },
          body: buf,
        });
        if (r.ok) saved.push(await r.json());
      } catch (_) {}
    }
    this._saving = false;
    if (saved.length) {
      this._files = [...saved, ...this._files];
      this._exitSearch();
      this._activeView = '3d';
      await this.updateComplete;
      this._disposeThree(); this._initThree();
      await this._loadSTL(saved[0].id);
    }
  }

  // ── Print modal ───────────────────────────────────────────────────────────

  _showPrintModal() {
    if (!this._activeProject) return;
    this._printModal = true;
  }

  _hidePrintModal() {
    this._printModal = false;
  }

  // ── Meshy.AI text-to-3D ──────────────────────────────────────────────────

  _openMeshyModal() {
    this._meshyModal    = true;
    this._meshyStatus   = 'idle';
    this._meshyError    = null;
    this._meshyTask     = null;
    this._meshyProgress = 0;
    this._meshyThumb    = null;
  }

  _closeMeshyModal() {
    if (this._meshyPollTimer) { clearInterval(this._meshyPollTimer); this._meshyPollTimer = null; }
    this._meshyModal  = false;
    this._meshyStatus = 'idle';
  }

  async _startMeshyGenerate() {
    const prompt = this._meshyPrompt.trim();
    if (!prompt) return;
    // Clear any previous poll timer before starting a new job
    if (this._meshyPollTimer) { clearInterval(this._meshyPollTimer); this._meshyPollTimer = null; }
    this._meshyStatus   = 'pending';
    this._meshyError    = null;
    this._meshyProgress = 0;
    this._meshyTask     = null;
    const url = `${this._apiUrl}/api/meshy/generate`;
    console.log('[Jarvis] Meshy generate → POST', url, '| prompt:', prompt.slice(0, 80));
    try {
      const r = await fetch(url, {
        method: 'POST', headers: this._apiHeaders,
        body: JSON.stringify({ prompt }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      this._meshyTask   = data.task_id;
      this._meshyStatus = 'generating';
      this._addLog('meshy', `Meshy generating: "${prompt}"`);
      this._meshyPollTimer = setInterval(() => this._pollMeshyTask(), 4000);
    } catch (e) {
      console.error('[Jarvis] Meshy generate error:', e);
      this._meshyStatus = 'error';
      this._meshyError  = e.message;
      this._addLog('error', `Meshy start failed: ${e.message}`);
    }
  }

  async _pollMeshyTask() {
    if (!this._meshyTask) return;
    try {
      const r = await fetch(`${this._apiUrl}/api/meshy/status/${this._meshyTask}`, { headers: this._apiHeaders });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      this._meshyProgress = d.progress ?? this._meshyProgress;
      if (d.thumbnail_url) this._meshyThumb = d.thumbnail_url;
      if (d.status === 'SUCCEEDED') {
        clearInterval(this._meshyPollTimer); this._meshyPollTimer = null;
        this._meshyStatus = 'saving';
        await this._saveMeshyModel();
      } else if (d.status === 'FAILED' || d.status === 'EXPIRED') {
        clearInterval(this._meshyPollTimer); this._meshyPollTimer = null;
        this._meshyStatus = 'error';
        this._meshyError  = d.error ?? `Task ${d.status.toLowerCase()}`;
        this._addLog('error', `Meshy failed: ${this._meshyError}`);
      }
    } catch (e) {
      // Don't kill polling on transient errors — just log
      console.warn('[Jarvis] Meshy poll error:', e.message);
    }
  }

  async _saveMeshyModel() {
    try {
      const r = await fetch(`${this._apiUrl}/api/meshy/save`, {
        method: 'POST', headers: this._apiHeaders,
        body: JSON.stringify({ task_id: this._meshyTask, project_id: this._activeProject?.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      this._files = [data, ...this._files];
      this._meshyStatus = 'done';
      this._addLog('meshy', `✅ Meshy model saved: ${data.filename}`);
      // Switch to 3D view and load the GLB
      this._activeView = '3d';
      await this.updateComplete;
      this._disposeThree(); this._initThree();
      await this._loadGLB(data.id);
    } catch (e) {
      this._meshyStatus = 'error';
      this._meshyError  = e.message;
      this._addLog('error', `Meshy save failed: ${e.message}`);
    }
  }

  async _loadGLB(fileId) {
    try {
      const { GLTFLoader } = await import('https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js');
      const r = await fetch(`${this._apiUrl}/api/files/${fileId}`, { headers: { 'X-API-Key': this._config?.api_key ?? '' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      const loader = new GLTFLoader();
      loader.parse(buf, '', (gltf) => {
        if (!this._three) return;
        const { scene, camera, renderer, controls } = this._three;
        // Clear existing meshes (keep lights)
        scene.children.filter(c => c.isMesh || c.isGroup).forEach(c => scene.remove(c));
        const model = gltf.scene;
        // Centre and scale to fit view
        const box = new THREE.Box3().setFromObject(model);
        const centre = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3()).length();
        model.position.sub(centre);
        const scale = 80 / size;
        model.scale.setScalar(scale);
        scene.add(model);
        camera.position.set(0, 60, 120);
        camera.lookAt(0, 0, 0);
        if (controls) controls.update();
        renderer.render(scene, camera);
      }, (e) => { console.error('[Jarvis] GLB parse error', e); });
    } catch (e) {
      console.error('[Jarvis] GLB load failed:', e);
    }
  }

  _renderMeshyModal() {
    if (!this._meshyModal) return nothing;
    const busy    = ['pending','generating','saving'].includes(this._meshyStatus);
    const done    = this._meshyStatus === 'done';
    const isError = this._meshyStatus === 'error';
    const statusLabel = {
      idle:       '',
      pending:    'Starting job…',
      generating: `Generating… ${this._meshyProgress}%`,
      saving:     'Saving model…',
      done:       '✅ Done! Model loaded in 3D viewer.',
      error:      `❌ ${this._meshyError}`,
    }[this._meshyStatus];

    return html`
      <div class="modal-overlay" @click=${e=>{ if(e.target===e.currentTarget && !busy) this._closeMeshyModal(); }}>
        <div class="modal">
          <div class="modal-title">⚡ Generate 3D Model</div>
          <div class="modal-subtitle">Powered by Meshy.AI · ~5 credits preview</div>
          ${this._meshyThumb ? html`<img src=${this._meshyThumb} style="width:100%;border-radius:6px;margin:8px 0">` : nothing}
          <div class="modal-row" style="flex-direction:column;align-items:stretch;gap:6px">
            <textarea
              style="width:100%;min-height:72px;resize:vertical;background:#111;color:#e8f4f8;border:1px solid #1a3a4a;border-radius:4px;padding:8px;font-size:13px"
              placeholder="Describe the model… e.g. 'a wall-mount bracket for a Raspberry Pi 4'"
              .value=${this._meshyPrompt}
              @input=${e=>this._meshyPrompt=e.target.value}
              ?disabled=${busy}></textarea>
          </div>
          ${statusLabel ? html`<div class="modal-subtitle" style="color:${isError?'#e05':done?'#0d6':'#8cf'}">${statusLabel}</div>` : nothing}
          ${busy ? html`
            <div style="height:4px;background:#0a2030;border-radius:2px;overflow:hidden;margin:4px 0">
              <div style="height:100%;width:${this._meshyProgress||10}%;background:#00aaff;transition:width 0.5s;border-radius:2px"></div>
            </div>` : nothing}
          <div class="modal-btns">
            <button class="modal-btn-cancel" @click=${this._closeMeshyModal} ?disabled=${busy && !isError}>
              ${done||isError ? 'Close' : 'Cancel'}
            </button>
            ${!done ? html`
              <button class="modal-btn-save" @click=${this._startMeshyGenerate}
                ?disabled=${busy || !this._meshyPrompt.trim() || !this._activeProject}>
                ${busy ? '⏳ Generating…' : '⚡ Generate'}
              </button>` : nothing}
          </div>
        </div>
      </div>`;
  }

  async _submitPrint(e) {
    e.preventDefault();
    const form = e.target;
    const stl  = this._files.find(f => f.file_type === '3mf')
              || this._files.find(f => f.file_type === 'stl');
    if (!stl) return;

    if (!this._holomatUrl) {
      alert('HoloMat pipeline not configured.\n\nAdd holomat_url to the card config (e.g. https://holomat.nannerserver.com).');
      return;
    }

    const btn = form.querySelector('[type=submit]');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Sending…';

    try {
      const payload = {
        file_id:    stl.id,
        filename:   stl.filename,
        file_type:  stl.file_type,
        quality:    form.quality.value,
        infill:     form.infill.value,
        supports:   form.supports.value,
        project_id: this._activeProject?.id ?? null,
      };
      this._addLog('print', `Sending print job: ${stl.filename} (${payload.quality}, ${payload.infill}% infill)`);

      const r = await fetch(`${this._holomatUrl}/print`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));

      if (r.ok) {
        this._addLog('print', `✅ Print job sent: ${data.filename ?? stl.filename}`);
        this._hidePrintModal();
        alert(`✅ Print job sent to NANN3R1S!\n\nFile: ${data.filename ?? stl.filename}\nProfile: ${data.profile ?? payload.quality}\nInfill: ${data.infill ?? payload.infill}%`);
      } else {
        // Surface the error detail from the API (OrcaSlicer not installed, etc.)
        const msg = typeof data.detail === 'object'
          ? (data.detail.error ?? JSON.stringify(data.detail))
          : (data.detail ?? data.error ?? `HTTP ${r.status}`);
        this._addLog('error', `Print failed: ${msg}`);
        alert(`Print failed:\n\n${msg}`);
      }
    } catch (err) {
      this._addLog('error', `Cannot reach HoloMat pipeline: ${err.message}`);
      alert(`Cannot reach HoloMat pipeline:\n\n${err.message}\n\nIs the server running at ${this._holomatUrl}?`);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  // ── Voice input ───────────────────────────────────────────────────────────

  async _toggleMic() {
    if (this._recording) {
      this._mediaRecorder?.stop();
      this._recording = false;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']
        .find(t => MediaRecorder.isTypeSupported(t)) ?? '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      const chunks = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        this._transcribing = true;
        try {
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          const r = await fetch(`${this._apiUrl}/api/stt`, {
            method: 'POST',
            headers: { 'Content-Type': blob.type, 'X-API-Key': this._config?.api_key ?? '' },
            body: await blob.arrayBuffer(),
          });
          if (r.ok) {
            const d = await r.json();
            if (d.text) this._chatInput = d.text;
          }
        } catch (_) {}
        this._transcribing = false;
      };
      mr.start(100);
      this._mediaRecorder = mr;
      this._recording = true;
    } catch (e) {
      alert('Microphone access denied or unavailable.');
    }
  }

  // ── OpenSCAD generation ───────────────────────────────────────────────────

  _parseContent(text) {
    const parts = [];
    // [^\n]* allows anything after language tag (comments, extra text) before newline
    // \n? makes the newline optional (handles no-newline edge case)
    const re = /```(openscad|scad|meshy)[^\n]*\n?([\s\S]*?)```/gi;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index) });
      const lang = m[1].toLowerCase();
      parts.push({ type: lang === 'meshy' ? 'meshy' : 'code', lang, code: m[2].trim() });
      last = re.lastIndex;
    }
    if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
    if (!parts.length) {
      console.log('[Jarvis] _parseContent: no code blocks found in response preview:', text.slice(0, 120));
    }
    return parts.length ? parts : [{ type: 'text', text }];
  }

  async _generateFromCode(code) {
    if (!this._activeProject || !this._holomatUrl) return;
    this._generating = true;
    this._genError = null;
    try {
      const fname = `${this._activeProject.name.replace(/\s+/g, '_')}_generated.stl`;
      const r = await fetch(`${this._holomatUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, project_id: this._activeProject.id, filename: fname }),
      });
      if (r.ok) {
        await this._loadFiles(this._activeProject.id);
        this._activeView = '3d';
        await this.updateComplete;
        this._disposeThree(); this._initThree();
        const stl = this._files.find(f => f.file_type === 'stl');
        if (stl) await this._loadSTL(stl.id);
      } else {
        const body = await r.text().catch(() => '');
        this._genError = `Pipeline error ${r.status}${body ? ': ' + body.slice(0, 120) : ''}`;
      }
    } catch (e) {
      this._genError = `Cannot reach pipeline: ${e.message}`;
    }
    this._generating = false;
  }

  // ── Three.js ──────────────────────────────────────────────────────────────

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
    canvas.addEventListener('mousedown',  e => { down=true; lastX=e.clientX; lastY=e.clientY; });
    canvas.addEventListener('mousemove',  e => {
      if (!down) return;
      theta -= (e.clientX-lastX)*0.008;
      phi = Math.max(0.1, Math.min(Math.PI-0.1, phi-(e.clientY-lastY)*0.008));
      lastX=e.clientX; lastY=e.clientY; update();
    });
    canvas.addEventListener('mouseup',    () => down=false);
    canvas.addEventListener('mouseleave', () => down=false);
    canvas.addEventListener('wheel', e => {
      radius = Math.max(1, Math.min(20, radius+e.deltaY*0.02));
      update(); e.preventDefault();
    }, { passive:false });
    update();
    return { reset: () => { theta=0; phi=Math.PI/2.5; radius=initRadius; update(); } };
  }

  _initThree() {
    if (this._three) return;
    const canvas = this.shadowRoot?.querySelector('#three-canvas');
    if (!canvas) return;
    const w = canvas.clientWidth || 640, h = canvas.clientHeight || 360;
    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d14);
    const camera   = new THREE.PerspectiveCamera(45, w/h, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key  = new THREE.DirectionalLight(0x00f5ff, 1.2); key.position.set(5, 10, 5);   scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-6, -4, 3);  scene.add(fill);
    const rim  = new THREE.DirectionalLight(0x0088aa, 0.4); rim.position.set(0, -2, -8);   scene.add(rim);
    const geo      = new THREE.IcosahedronGeometry(1.5, 1);
    const demoMesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color:0x00f5ff, opacity:0.85, transparent:true, shininess:80 }));
    const demoWire = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color:0x003d44, wireframe:true }));
    scene.add(demoMesh, demoWire);
    const orbit = this._makeOrbit(canvas, camera, 6);
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (!width||!height) return;
      camera.aspect = width/height; camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    ro.observe(canvas);
    let animFrame;
    const animate = () => {
      animFrame = requestAnimationFrame(animate);
      if (demoMesh.parent) { demoMesh.rotation.y+=0.004; demoWire.rotation.y+=0.004; }
      renderer.render(scene, camera);
    };
    animate();
    this._three = { scene, camera, renderer, animFrame, ro, orbit, demoMesh, demoWire };
  }

  _disposeThree() {
    if (!this._three) return;
    cancelAnimationFrame(this._three.animFrame);
    this._three.ro.disconnect();
    this._three.renderer.dispose();
    this._three = null;
  }

  _loadSTLGeo(geo) {
    if (!this._three) return;
    const { scene, demoMesh, demoWire, orbit } = this._three;
    scene.remove(demoMesh); scene.remove(demoWire);
    scene.children.filter(c => c.userData.stlMesh).forEach(c => {
      c.geometry?.dispose(); c.material?.dispose(); scene.remove(c);
    });
    geo.computeVertexNormals();
    geo.center();
    const bbox = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position'));
    const size = bbox.getSize(new THREE.Vector3());
    const maxD = Math.max(size.x, size.y, size.z) || 1;
    const scale = 3 / maxD;
    const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
      color: 0x00c8e0, specular: new THREE.Color(0x003344), shininess: 80,
    }));
    mesh.scale.setScalar(scale);
    mesh.userData.stlMesh = true;
    const wire = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: 0x003d44, wireframe: true, opacity: 0.12, transparent: true }));
    wire.scale.setScalar(scale);
    wire.userData.stlMesh = true;
    scene.add(mesh, wire);
    orbit.reset();
  }

  async _loadSTL(fileId) {
    if (!this._three) return;
    try {
      const r = await fetch(`${this._apiUrl}/api/files/${fileId}`, { headers:{'X-API-Key':this._config?.api_key??''} });
      if (!r.ok) return;
      const geo = parseSTL(await r.arrayBuffer());
      if (!geo) return;
      this._loadSTLGeo(geo);
    } catch (_) {}
  }

  async _loadSVGFile(fileId) {
    try {
      const r = await fetch(`${this._apiUrl}/api/files/${fileId}`, { headers:{'X-API-Key':this._config?.api_key??''} });
      if (!r.ok) return;
      const blob = await r.blob();
      if (this._svgUrl) URL.revokeObjectURL(this._svgUrl);
      this._svgUrl = URL.createObjectURL(blob);
    } catch (_) {}
  }

  updated(changed) {
    if (changed.has('_activeView')) {
      if (this._activeView !== '3d') this._disposeThree();
      else if (this._activeProject || this._searchSession) this.updateComplete.then(() => this._initThree());
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
      height: calc(100vh - var(--header-height, 56px));
      overflow: hidden;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      color: var(--text);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .root {
      display: flex; flex-direction: column; height: 100%; min-height: 500px;
      background: var(--bg); border-radius: var(--radius);
      overflow: hidden; border: 1px solid var(--border); position: relative;
    }
    .statusbar {
      display: flex; align-items: center; gap: 10px; padding: 7px 14px;
      background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0;
    }
    .logo { font-size: 1rem; font-weight: 800; letter-spacing: 4px; color: var(--accent); text-transform: uppercase; }
    .pulse {
      width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
      box-shadow: 0 0 6px var(--accent); animation: pulse 2.5s infinite; flex-shrink: 0;
    }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.85)} }
    .project-label { flex: 1; font-size: 0.8rem; color: var(--text-dim); }
    .project-label b { color: var(--text); font-weight: 500; }
    .toggle-btn {
      background: none; border: 1px solid var(--border); border-radius: 5px;
      color: var(--text-dim); cursor: pointer; font-size: 0.75rem; padding: 3px 8px; transition: all .15s;
    }
    .toggle-btn:hover { border-color: var(--accent); color: var(--accent); }
    .main { display: flex; flex: 1; overflow: hidden; min-height: 0; }
    .panel {
      width: var(--panel-w); background: var(--surface); display: flex;
      flex-direction: column; flex-shrink: 0; transition: width .25s ease; overflow: hidden;
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
      flex: 1; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px;
      color: var(--text); font-family: inherit; font-size: 0.8rem; padding: 5px 7px; resize: none; height: 52px;
    }
    .chat-footer textarea:focus { outline: none; border-color: var(--accent); }
    .chat-footer textarea:disabled { opacity: .5; }
    .send-btn {
      background: var(--accent); border: none; border-radius: 6px; color: #000;
      cursor: pointer; font-size: 1rem; font-weight: 700; padding: 0 10px; transition: opacity .15s;
    }
    .send-btn:disabled { opacity: .4; cursor: not-allowed; }
    .send-btn:hover:not(:disabled) { opacity: .8; }
    .workspace {
      flex: 1; display: flex; align-items: center; justify-content: center;
      padding: 14px; overflow: hidden; min-height: 0;
    }
    .ws-surface {
      width: 100%; aspect-ratio: 16/9; max-height: 100%;
      background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius);
      position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;
      background-image: linear-gradient(var(--border) 1px,transparent 1px), linear-gradient(90deg,var(--border) 1px,transparent 1px);
      background-size: 40px 40px;
    }
    .ws-idle { display: flex; flex-direction: column; align-items: center; gap: 10px; user-select: none; pointer-events: none; }
    .ws-idle .watermark { font-size: 3.5rem; font-weight: 900; letter-spacing: 10px; color: var(--accent); opacity: .06; text-transform: uppercase; }
    .ws-idle p { font-size: .8rem; color: var(--text-dim); opacity: .6; }
    .ws-canvas-wrap { position: absolute; inset: 0; }
    #three-canvas   { width: 100%; height: 100%; display: block; }
    .svg-viewer { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--bg); }
    .svg-viewer img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }
    .ws-hint { color: var(--text-dim); font-size: .82rem; text-align: center; line-height: 1.8; }
    .view-tabs {
      position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 3px; background: rgba(0,0,0,.5); backdrop-filter: blur(4px);
      padding: 3px; border-radius: 7px; border: 1px solid var(--border); z-index: 10;
    }
    .vt { background: none; border: none; border-radius: 5px; color: var(--text-dim); cursor: pointer; font-size: .72rem; padding: 3px 10px; transition: all .15s; }
    .vt.on { background: var(--accent); color: #000; font-weight: 700; }
    .ws-project-info { text-align: center; }
    .ws-project-info h2 { font-size: 1.2rem; font-weight: 600; color: var(--text); margin-bottom: 6px; }
    .ws-project-info p  { font-size: .82rem; color: var(--text-dim); }
    .badge { display: inline-block; background: var(--accent-dim); color: var(--accent); font-size: .65rem; font-weight: 700; letter-spacing: 1px; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; margin-top: 6px; }
    .gallery-list { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 5px; min-height: 0; }
    .gallery-list::-webkit-scrollbar { width: 3px; }
    .gallery-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    .proj-card { background: var(--surface2); border: 1px solid var(--border); border-radius: 7px; padding: 9px 10px; transition: all .15s; }
    .proj-card:hover  { border-color: var(--accent); }
    .proj-card.active { border-color: var(--accent); background: rgba(0,245,255,.05); }
    .proj-card-inner  { display: flex; align-items: center; gap: 4px; }
    .proj-card-info   { flex: 1; min-width: 0; cursor: pointer; }
    .proj-card .pc-name { font-size: .82rem; font-weight: 500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .proj-card .pc-meta { font-size: .68rem; color: var(--text-dim); margin-top: 2px; }
    .proj-delete {
      background: none; border: none; cursor: pointer; color: var(--text-dim);
      font-size: .9rem; padding: 3px 5px; border-radius: 4px; flex-shrink: 0;
      opacity: 0; transition: opacity .15s, color .15s; line-height: 1;
    }
    .proj-card:hover .proj-delete { opacity: 1; }
    .proj-delete:hover { color: #ff5555; }
    .gallery-empty { font-size: .78rem; color: var(--text-dim); text-align: center; padding: 20px 10px; }
    .gallery-foot { padding: 7px; border-top: 1px solid var(--border); flex-shrink: 0; }
    .new-btn { width: 100%; background: rgba(0,245,255,.08); border: 1px solid var(--accent); border-radius: 6px; color: var(--accent); cursor: pointer; font-size: .78rem; font-weight: 600; padding: 6px; }
    .new-btn:hover { background: rgba(0,245,255,.15); }
    .actionbar { display: flex; gap: 6px; padding: 7px 12px; background: var(--surface); border-top: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap; }
    .act { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text-dim); cursor: pointer; font-size: .75rem; padding: 4px 12px; transition: all .15s; }
    .act:hover    { border-color: var(--accent); color: var(--accent); }
    .act:disabled { opacity: .3; cursor: not-allowed; }
    .logdrawer { background: var(--surface); border-top: 1px solid var(--border); flex-shrink: 0; display: flex; flex-direction: column; transition: max-height .3s ease; max-height: 220px; overflow: hidden; }
    .logdrawer.collapsed { max-height: 32px; }
    .log-head { display: flex; align-items: center; gap: 8px; padding: 6px 14px; cursor: pointer; flex-shrink: 0; user-select: none; min-height: 32px; }
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

    /* ── Modals (new project + print) ── */
    .modal-overlay {
      position: absolute; inset: 0; background: rgba(0,0,0,.75);
      display: flex; align-items: center; justify-content: center; z-index: 200;
    }
    .modal {
      background: var(--surface); border: 1px solid var(--accent); border-radius: var(--radius);
      padding: 18px; width: 280px; display: flex; flex-direction: column; gap: 10px;
      box-shadow: 0 0 40px rgba(0,245,255,.12);
    }
    .modal-title { font-size: .72rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--accent); }
    .modal-subtitle { font-size: .72rem; color: var(--text-dim); margin-top: -4px; }
    .modal input, .modal select {
      width: 100%; background: var(--surface2); border: 1px solid var(--border);
      border-radius: 6px; color: var(--text); font-family: inherit; font-size: .82rem; padding: 7px 9px;
    }
    .modal input:focus, .modal select:focus { outline: none; border-color: var(--accent); }
    .modal select option { background: var(--surface); }
    .modal-row { display: flex; align-items: center; gap: 8px; }
    .modal-label { font-size: .7rem; color: var(--text-dim); min-width: 58px; flex-shrink: 0; }
    .modal-btns { display: flex; gap: 8px; margin-top: 2px; }
    .modal-btn-cancel {
      flex: 1; padding: 7px; border-radius: 6px; cursor: pointer;
      background: var(--surface2); border: 1px solid var(--border);
      color: var(--text-dim); font-size: .78rem; font-weight: 600;
    }
    .modal-btn-cancel:hover { border-color: var(--accent); color: var(--text); }
    .modal-btn-save {
      flex: 1; padding: 7px; border-radius: 6px; cursor: pointer;
      background: var(--accent); border: none; color: #000; font-size: .78rem; font-weight: 700;
    }
    .modal-btn-save:hover { opacity: .85; }
    .modal-no-stl { font-size: .75rem; color: #ffaa00; text-align: center; padding: 6px 0; }

    /* ── OpenSCAD code block ── */
    .code-block { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; margin: 6px 0; overflow: hidden; }
    .code-lang { font-size: .6rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--accent); padding: 3px 8px; background: rgba(0,245,255,.08); border-bottom: 1px solid #30363d; }
    .code-pre { font-family: 'JetBrains Mono','Fira Code','Cascadia Code',monospace; font-size: .7rem; line-height: 1.6; color: #e6edf3; padding: 8px; overflow-x: auto; white-space: pre; max-height: 180px; overflow-y: auto; margin: 0; }
    .code-pre::-webkit-scrollbar { width: 3px; height: 3px; }
    .code-pre::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .gen-btn { display: block; width: 100%; background: rgba(0,245,255,.08); border: none; border-top: 1px solid #30363d; color: var(--accent); cursor: pointer; font-size: .72rem; font-weight: 700; letter-spacing: .5px; padding: 6px; transition: background .15s; }
    .gen-btn:hover:not(:disabled) { background: rgba(0,245,255,.18); }
    .gen-btn:disabled { opacity: .45; cursor: not-allowed; }
    .gen-error { font-size: .68rem; color: #ff6b6b; padding: 4px 8px; background: rgba(255,80,80,.08); border-top: 1px solid #30363d; }

    /* ── Search mode ── */
    .search-layout { position: absolute; inset: 0; display: flex; flex-direction: column; }
    .search-nav {
      display: flex; align-items: center; gap: 6px; padding: 5px 8px; flex-shrink: 0;
      background: rgba(0,0,0,.6); backdrop-filter: blur(4px); border-bottom: 1px solid var(--border); z-index: 10;
    }
    .sn-arrow { background: none; border: 1px solid var(--border); border-radius: 4px; color: var(--text-dim); cursor: pointer; font-size: .8rem; padding: 2px 7px; transition: all .15s; }
    .sn-arrow:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .sn-arrow:disabled { opacity: .3; cursor: not-allowed; }
    .sn-pos { font-size: .7rem; color: var(--accent); font-weight: 700; flex-shrink: 0; min-width: 36px; text-align: center; }
    .sn-title { flex: 1; font-size: .75rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sn-meta { font-size: .65rem; color: var(--text-dim); flex-shrink: 0; }
    .sn-close { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: .9rem; padding: 2px 5px; }
    .sn-close:hover { color: #ff5555; }
    .search-canvas { flex: 1; position: relative; overflow: hidden; }
    .search-bar {
      display: flex; align-items: center; gap: 5px; flex-wrap: wrap; padding: 5px 8px; flex-shrink: 0;
      background: rgba(0,0,0,.6); backdrop-filter: blur(4px); border-top: 1px solid var(--border); z-index: 10;
    }
    .sb-btn {
      background: var(--surface2); border: 1px solid var(--border); border-radius: 5px;
      color: var(--text-dim); cursor: pointer; font-size: .72rem; padding: 3px 10px; transition: all .15s;
    }
    .sb-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .sb-btn:disabled { opacity: .35; cursor: not-allowed; }
    .sb-btn.accent { border-color: var(--accent); color: var(--accent); background: rgba(0,245,255,.06); }
    .sb-btn.accent:hover:not(:disabled) { background: rgba(0,245,255,.15); }
    .sb-spacer { flex: 1; }
    .search-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
    .search-loading .spin { width: 28px; height: 28px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .search-error { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
    .search-error p { font-size: .78rem; color: #ff6b6b; }

    /* ── Mic button ── */
    .mic-btn {
      background: var(--surface2); border: 1px solid var(--border); border-radius: 6px;
      color: var(--text-dim); cursor: pointer; font-size: 1rem; padding: 0 8px;
      transition: all .15s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .mic-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .mic-btn:disabled { opacity: .4; cursor: not-allowed; }
    .mic-btn.active { border-color: #ff5555; color: #ff5555; animation: mic-pulse 1s ease-in-out infinite; }
    @keyframes mic-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,85,85,.4)} 50%{box-shadow:0 0 0 5px rgba(255,85,85,0)} }
    .mic-spin {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid var(--border); border-top-color: var(--accent);
      border-radius: 50%; animation: spin .8s linear infinite;
    }

    @media (max-width: 680px) {
      .root { height: auto; min-height: 400px; }
      .main { flex-direction: column; }
      .panel { width: 100% !important; max-height: 180px; }
      .panel-left  { border-right: none; border-bottom: 1px solid var(--border); }
      .panel-right { border-left:  none; border-top:    1px solid var(--border); }
      .panel.closed { width: 100% !important; max-height: 32px; }
    }
  `;

  // ── Demo data ──────────────────────────────────────────────────────────────

  get _demoMessages() { return [{ id:'1', role:'jarvis', content:'Jarvis online. How can I help?' }]; }
  get _demoLog() {
    const t = d => new Date(Date.now()-d*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return [{ type:'sys', time:t(5), text:'Connected to Jarvis API' }];
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  _renderMsg(m) {
    const isJarvis = m.role === 'jarvis';
    const parts = this._parseContent(m.content ?? '');
    const hasProject  = !!this._activeProject;
    const hasPipeline = !!this._holomatUrl;
    return html`
      <div class="msg ${m.role} ${m.id==='_sending'?'sending':''}">
        <div class="msg-role">${isJarvis?'⬡ Jarvis':'▶ You'}</div>
        ${parts.map(p => {
          if (p.type === 'meshy') return html`
            <div class="code-block" style="border-color:#003a6b">
              <div class="code-lang" style="background:#003a6b">⚡ Meshy.AI</div>
              <div style="padding:8px 10px;font-size:12px;color:#8cf;font-style:italic">${p.code}</div>
              ${isJarvis ? html`
                <button class="gen-btn" style="background:#003a6b"
                  ?disabled=${!hasProject || ['pending','generating','saving'].includes(this._meshyStatus)}
                  @click=${() => { this._meshyPrompt=p.code; this._meshyModal=true; this._startMeshyGenerate(); }}>
                  ${['pending','generating','saving'].includes(this._meshyStatus) ? '⏳ Generating…' : !hasProject ? '⚡ Generating — select a project first' : '⚡ Generate with Meshy'}
                </button>` : nothing}
            </div>`;
          if (p.type === 'code') return html`
            <div class="code-block">
              <div class="code-lang">OpenSCAD</div>
              <pre class="code-pre">${p.code}</pre>
              ${isJarvis ? html`
                <button class="gen-btn"
                  ?disabled=${this._generating || !hasProject || !hasPipeline}
                  title=${!hasProject ? 'Select a project first' : !hasPipeline ? 'HoloMat pipeline not configured' : 'Render to STL'}
                  @click=${() => this._generateFromCode(p.code)}>
                  ${this._generating ? '⏳ Generating…' : !hasProject ? '⚙ Generate STL — select a project first' : '⚙ Generate STL'}
                </button>
                ${this._genError ? html`<div class="gen-error">⚠ ${this._genError}</div>` : nothing}
              ` : nothing}
            </div>`;
          return html`<span style="white-space:pre-wrap">${p.text}</span>`;
        })}
      </div>`;
  }

  _renderProjCard(p) {
    return html`
      <div class="proj-card ${this._activeProject?.id===p.id?'active':''}">
        <div class="proj-card-inner">
          <div class="proj-card-info" @click=${()=>this._selectProject(p)}>
            <div class="pc-name">${p.name}</div>
            <div class="pc-meta">${TYPE_LABELS[p.type]??p.type}</div>
          </div>
          <button class="proj-delete" title="Delete project"
            @click=${e=>{e.stopPropagation();this._deleteProject(p.id);}}>🗑</button>
        </div>
      </div>`;
  }

  _renderLogEntry(e) {
    return html`<div class="log-entry ${e.type}">
      <span class="le-time">${e.time}</span>
      <span class="le-type">${e.type==='cmd'?'CMD':e.type==='resp'?'RESP':'SYS'}</span>
      ${e.project?html`<span class="le-proj">[${e.project}]</span>`:nothing}
      <span class="le-text">${e.text}</span></div>`;
  }

  _renderNewProjectModal() {
    if (!this._showNewProject) return nothing;
    return html`
      <div class="modal-overlay" @click=${e=>{ if(e.target===e.currentTarget) this._showNewProject=false; }}>
        <div class="modal">
          <div class="modal-title">New Project</div>
          <input type="text" placeholder="Project name"
            .value=${this._newProjName}
            @input=${e=>this._newProjName=e.target.value}
            @keydown=${e=>e.key==='Enter'&&this._submitNewProject()}>
          <select @change=${e=>this._newProjType=e.target.value}>
            <option value="3d_model" ?selected=${this._newProjType==='3d_model'}>3D Model</option>
            <option value="svg"      ?selected=${this._newProjType==='svg'}>Cricut Model</option>
            <option value="note"     ?selected=${this._newProjType==='note'}>Notes</option>
            <option value="other"    ?selected=${this._newProjType==='other'}>Other</option>
          </select>
          <div class="modal-btns">
            <button class="modal-btn-cancel" @click=${()=>this._showNewProject=false}>Cancel</button>
            <button class="modal-btn-save"   @click=${this._submitNewProject}>Create</button>
          </div>
        </div>
      </div>`;
  }

  _renderPrintModal() {
    if (!this._printModal) return nothing;
    // Prefer pre-sliced .3mf (ready to send), fall back to .stl
    const printFile = this._files.find(f => f.file_type === '3mf')
                   || this._files.find(f => f.file_type === 'stl');
    const is3mf = printFile?.file_type === '3mf';
    return html`
      <div class="modal-overlay" @click=${e=>{ if(e.target===e.currentTarget) this._hidePrintModal(); }}>
        <div class="modal">
          <div class="modal-title">🖨 Print to NANN3R1S</div>
          ${printFile
            ? html`
              <div class="modal-subtitle">
                ${printFile.filename}
                ${is3mf
                  ? html`<span class="badge" style="margin-left:8px;background:#1a6b3a">✓ Pre-sliced</span>`
                  : html`<span class="badge" style="margin-left:8px;background:#7a4a00">⚠ Needs slicing</span>`}
              </div>
              ${!is3mf ? html`
                <div class="modal-no-stl" style="margin-bottom:12px">
                  STL detected. Slice in Bambu Studio first:<br>
                  File → Export → Export Sliced File (.3mf) → upload here.
                </div>` : nothing}
              <form @submit=${this._submitPrint}>
                <div class="modal-row">
                  <span class="modal-label">Quality</span>
                  <select name="quality" ?disabled=${!is3mf}>
                    <option value="draft">Draft (0.3mm)</option>
                    <option value="standard" selected>Standard (0.2mm)</option>
                    <option value="fine">Fine (0.1mm)</option>
                  </select>
                </div>
                <div class="modal-row">
                  <span class="modal-label">Infill</span>
                  <select name="infill" ?disabled=${!is3mf}>
                    <option value="15">15% — Light</option>
                    <option value="30" selected>30% — Standard</option>
                    <option value="50">50% — Strong</option>
                    <option value="80">80% — Solid</option>
                  </select>
                </div>
                <div class="modal-row">
                  <span class="modal-label">Supports</span>
                  <select name="supports" ?disabled=${!is3mf}>
                    <option value="off" selected>Off</option>
                    <option value="auto">Auto</option>
                    <option value="on">On</option>
                  </select>
                </div>
                <div class="modal-btns">
                  <button type="button" class="modal-btn-cancel" @click=${this._hidePrintModal}>Cancel</button>
                  <button type="submit" class="modal-btn-save" ?disabled=${!is3mf}>🖨 Send to Printer</button>
                </div>
              </form>`
            : html`
              <div class="modal-no-stl">⚠ No printable file in this project.<br>Upload an STL or pre-sliced .3mf.</div>
              <div class="modal-btns">
                <button class="modal-btn-cancel" @click=${this._hidePrintModal}>Close</button>
              </div>`
          }
        </div>
      </div>`;
  }

  _renderSearchConsole() {
    const session = this._searchSession;
    if (!session) return nothing;
    const thing  = session.things[this._searchIndex];
    const total  = session.things.length;
    const isLast = this._searchIndex === total - 1;
    const fileCount = thing.files?.length ?? 0;
    const fileLabel = fileCount > 1 ? `File ${thing.fileIndex + 1}/${fileCount} →` : nothing;

    let body;
    if (thing.status === 'loading' || thing.status === 'idle') {
      body = html`<div class="search-loading"><div class="spin"></div><span style="font-size:.75rem;color:var(--text-dim)">Loading model…</span></div>`;
    } else if (thing.status === 'error') {
      body = html`<div class="search-error">
        <p>Could not load model.</p>
        <p style="font-size:.65rem;color:var(--text-dim)">${thing.error ?? ''}</p>
        <button class="act" @click=${()=>this._loadSearchThing(this._searchIndex)}>↻ Retry</button>
      </div>`;
    } else {
      body = html`<div class="ws-canvas-wrap"><canvas id="three-canvas"></canvas></div>`;
    }

    return html`
      <div class="search-layout">
        <div class="search-nav">
          <button class="sn-arrow" ?disabled=${this._searchIndex===0} @click=${()=>this._setSearchIndex(this._searchIndex-1)}>◀</button>
          <span class="sn-pos">${this._searchIndex+1}/${total}</span>
          <button class="sn-arrow" ?disabled=${this._searchIndex===total-1} @click=${()=>this._setSearchIndex(this._searchIndex+1)}>▶</button>
          <span class="sn-title">${thing.title}</span>
          <span class="sn-meta">♥ ${thing.likes} · ⬇ ${thing.downloads}</span>
          <button class="sn-close" title="Exit search" @click=${this._exitSearch}>✕</button>
        </div>
        <div class="search-canvas">${body}</div>
        <div class="search-bar">
          ${fileCount > 1 ? html`
            <button class="sb-btn" @click=${this._seeMoreFile}
              ?disabled=${thing.status==='loading'}>${fileLabel}</button>` : nothing}
          <button class="sb-btn accent"
            ?disabled=${thing.status!=='loaded' || !this._activeProject || this._saving}
            title=${!this._activeProject ? 'Select a project first' : 'Save all STL files from this result to the active project'}
            @click=${this._saveThing}>
            ${this._saving ? '⏳ Saving…' : '⬇ Save to Project'}
          </button>
          <span class="sb-spacer"></span>
          ${isLast ? html`
            <button class="sb-btn" ?disabled=${this._loadingMore} @click=${this._loadMoreResults}>
              ${this._loadingMore ? '⏳ Loading…' : 'Load More ▶'}
            </button>` : nothing}
        </div>
      </div>`;
  }

  _renderWorkspaceSurface() {
    if (this._searchSession) return this._renderSearchConsole();
    if (!this._activeProject) return html`<div class="ws-idle"><div class="watermark">Jarvis</div><p>Select or create a project</p></div>`;
    const tabs = html`<div class="view-tabs">
      <button class="vt ${this._activeView==='workspace'?'on':''}" @click=${()=>this._activeView='workspace'}>Info</button>
      ${this._activeProject.type==='3d_model'?html`<button class="vt ${this._activeView==='3d'?'on':''}" @click=${()=>this._activeView='3d'}>3D</button>`:nothing}
      ${this._activeProject.type==='svg'?html`<button class="vt ${this._activeView==='svg'?'on':''}" @click=${()=>this._activeView='svg'}>SVG</button>`:nothing}
    </div>`;
    let body;
    if (this._activeView === '3d') {
      body = html`<div class="ws-canvas-wrap"><canvas id="three-canvas"></canvas></div>`;
    } else if (this._activeView === 'svg') {
      body = html`<div class="svg-viewer">${this._svgUrl?html`<img src=${this._svgUrl} alt="SVG preview">`:html`<p class="ws-hint">No SVG uploaded yet.<br>Use ⬆ Upload to add one.</p>`}</div>`;
    } else {
      body = html`<div class="ws-project-info"><h2>${this._activeProject.name}</h2><p>${this._activeProject.description??'No description'}</p><span class="badge">${TYPE_LABELS[this._activeProject.type]??this._activeProject.type}</span></div>`;
    }
    return html`${tabs}${body}`;
  }

  render() {
    const haProj   = !!this._activeProject;
    const messages = this._messages.length ? this._messages : this._demoMessages;
    const log      = this._log.length ? this._log : this._demoLog;
    const lastLog  = log.at(-1);
    return html`
      <input type="file" id="fu" accept=".stl,.svg,.3mf" style="display:none" @change=${this._onFileSelect}>
      <div class="root">
        ${this._renderNewProjectModal()}
        ${this._renderPrintModal()}
        ${this._renderMeshyModal()}
        <div class="statusbar">
          <span class="logo">Jarvis</span>
          <div class="pulse"></div>
          <div class="project-label">${haProj?html`Project: <b>${this._activeProject.name}</b>`:'No active project'}</div>
          <button class="toggle-btn" @click=${()=>this._leftOpen=!this._leftOpen}>${this._leftOpen?'◀':'▶'} Chat</button>
          <button class="toggle-btn" @click=${()=>this._rightOpen=!this._rightOpen}>Projects ${this._rightOpen?'▶':'◀'}</button>
        </div>
        <div class="main">
          <div class="panel panel-left ${this._leftOpen?'':'closed'}">
            <div class="panel-head">
              <span class="ph-label">Chat</span><span class="ph-icon">💬</span>
              <button class="ph-label" @click=${()=>this._leftOpen=false}>✕</button>
            </div>
            <div class="panel-body">
              <div class="chat-msgs">
                ${messages.map(m=>this._renderMsg(m))}
                ${this._sending?html`<div class="msg jarvis sending"><div class="msg-role">⬡ Jarvis</div>…</div>`:nothing}
              </div>
              <div class="chat-footer">
                <textarea .value=${this._chatInput} @input=${e=>this._chatInput=e.target.value}
                  @keydown=${this._onChatKey} ?disabled=${this._sending} placeholder="Ask Jarvis…"></textarea>
                <button class="mic-btn ${this._recording?'active':''}"
                  title=${this._recording?'Stop recording':'Hold to speak'}
                  ?disabled=${this._transcribing||this._sending}
                  @click=${this._toggleMic}>
                  ${this._transcribing ? html`<span class="mic-spin"></span>` : this._recording ? '⏹' : '🎙'}
                </button>
                <button class="send-btn" ?disabled=${this._sending} @click=${this._sendChat}>▶</button>
              </div>
            </div>
          </div>
          <div class="workspace"><div class="ws-surface">${this._renderWorkspaceSurface()}</div></div>
          <div class="panel panel-right ${this._rightOpen?'':'closed'}">
            <div class="panel-head">
              <span class="ph-icon">📁</span><span class="ph-label">Projects</span>
              <button class="ph-label" @click=${()=>this._rightOpen=false}>✕</button>
            </div>
            <div class="panel-body">
              <div class="gallery-list">
                ${this._projects.length?this._projects.map(p=>this._renderProjCard(p)):html`<div class="gallery-empty">No projects yet.<br>Create one below.</div>`}
              </div>
              <div class="gallery-foot"><button class="new-btn" @click=${this._newProject}>+ New Project</button></div>
            </div>
          </div>
        </div>
        <div class="actionbar">
          <button class="act" ?disabled=${!haProj} @click=${this._showPrintModal}>🖨 Print</button>
          <button class="act" ?disabled=${!haProj} @click=${this._openMeshyModal}>⚡ Generate</button>
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
window.customCards.push({ type:'jarvis-dashboard', name:'Jarvis Dashboard', description:'Jarvis Hub — AI assistant, project gallery, and HoloMat workspace', preview:true });
