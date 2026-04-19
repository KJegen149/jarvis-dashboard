// Jarvis Hub Dashboard v0.2
const LIT = 'https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js';
const { LitElement, html, css, nothing } = await import(LIT);

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
  };

  constructor() {
    super();
    this._leftOpen      = true;
    this._rightOpen     = true;
    this._logOpen       = true;
    this._activeView    = 'workspace';
    this._activeProject = null;
    this._chatInput     = '';
  }

  setConfig(config) { this._config = config; }
  static getStubConfig() { return { api_url: '', api_key: '' }; }

  _onChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); }
  }

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

    /* ── Status bar ── */
    .statusbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 14px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .logo {
      font-size: 1rem;
      font-weight: 800;
      letter-spacing: 4px;
      color: var(--accent);
      text-transform: uppercase;
    }
    .pulse {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 6px var(--accent);
      animation: pulse 2.5s infinite;
      flex-shrink: 0;
    }
    @keyframes pulse {
      0%,100% { opacity:1; transform:scale(1); }
      50%      { opacity:.4; transform:scale(.85); }
    }
    .project-label {
      flex: 1;
      font-size: 0.8rem;
      color: var(--text-dim);
    }
    .project-label b { color: var(--text); font-weight: 500; }
    .toggle-btn {
      background: none;
      border: 1px solid var(--border);
      border-radius: 5px;
      color: var(--text-dim);
      cursor: pointer;
      font-size: 0.75rem;
      padding: 3px 8px;
      transition: all .15s;
    }
    .toggle-btn:hover { border-color: var(--accent); color: var(--accent); }

    /* ── Main ── */
    .main {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }

    /* ── Panels ── */
    .panel {
      width: var(--panel-w);
      background: var(--surface);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      transition: width .25s ease;
      overflow: hidden;
    }
    .panel-left  { border-right: 1px solid var(--border); }
    .panel-right { border-left:  1px solid var(--border); }
    .panel.closed { width: 32px; }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--accent);
      flex-shrink: 0;
    }
    .panel-head button {
      background: none; border: none;
      color: var(--text-dim); cursor: pointer; font-size: .9rem;
    }
    .panel-head button:hover { color: var(--accent); }
    .panel.closed .panel-head { justify-content: center; padding: 8px 0; }
    .panel.closed .panel-head .ph-label,
    .panel.closed .panel-body { display: none; }
    .ph-icon { font-size: 1rem; }

    .panel-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }

    /* ── Chat ── */
    .chat-msgs {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 7px;
      min-height: 0;
    }
    .chat-msgs::-webkit-scrollbar { width: 3px; }
    .chat-msgs::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    .msg {
      padding: 7px 9px;
      border-radius: 7px;
      font-size: 0.8rem;
      line-height: 1.5;
    }
    .msg-role {
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 2px;
      opacity: .6;
    }
    .msg.user   { background:#0d2d40; border:1px solid #1a4a60; color:#8ecfef; }
    .msg.jarvis { background:#0a2010; border:1px solid #1a4020; color:#80d080; }

    .chat-footer {
      padding: 7px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 5px;
      flex-shrink: 0;
    }
    .chat-footer textarea {
      flex: 1;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-family: inherit;
      font-size: 0.8rem;
      padding: 5px 7px;
      resize: none;
      height: 52px;
    }
    .chat-footer textarea:focus { outline: none; border-color: var(--accent); }
    .send-btn {
      background: var(--accent);
      border: none;
      border-radius: 6px;
      color: #000;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 700;
      padding: 0 10px;
    }
    .send-btn:hover { opacity: .8; }

    /* ── Workspace ── */
    .workspace {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 14px;
      overflow: hidden;
      min-height: 0;
    }
    .ws-surface {
      width: 100%;
      aspect-ratio: 16/9;
      max-height: 100%;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background-image:
        linear-gradient(var(--border) 1px, transparent 1px),
        linear-gradient(90deg, var(--border) 1px, transparent 1px);
      background-size: 40px 40px;
    }
    .ws-idle {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      user-select: none;
      pointer-events: none;
    }
    .ws-idle .watermark {
      font-size: 3.5rem;
      font-weight: 900;
      letter-spacing: 10px;
      color: var(--accent);
      opacity: .06;
      text-transform: uppercase;
    }
    .ws-idle p { font-size: .8rem; color: var(--text-dim); opacity: .6; }

    .view-tabs {
      position: absolute;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 3px;
      background: rgba(0,0,0,.5);
      backdrop-filter: blur(4px);
      padding: 3px;
      border-radius: 7px;
      border: 1px solid var(--border);
    }
    .vt {
      background: none; border: none;
      border-radius: 5px;
      color: var(--text-dim);
      cursor: pointer;
      font-size: .72rem;
      padding: 3px 10px;
      transition: all .15s;
    }
    .vt.on { background: var(--accent); color: #000; font-weight: 700; }

    .ws-project-info { text-align: center; }
    .ws-project-info h2 {
      font-size: 1.2rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 6px;
    }
    .ws-project-info p { font-size: .82rem; color: var(--text-dim); }
    .badge {
      display: inline-block;
      background: var(--accent-dim);
      color: var(--accent);
      font-size: .65rem;
      font-weight: 700;
      letter-spacing: 1px;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      margin-top: 6px;
    }

    /* ── Gallery ── */
    .gallery-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      min-height: 0;
    }
    .gallery-list::-webkit-scrollbar { width: 3px; }
    .gallery-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    .proj-card {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 9px 10px;
      cursor: pointer;
      transition: all .15s;
    }
    .proj-card:hover  { border-color: var(--accent); }
    .proj-card.active { border-color: var(--accent); background: rgba(0,245,255,.05); }
    .proj-card .pc-name { font-size: .82rem; font-weight: 500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .proj-card .pc-meta { font-size: .68rem; color: var(--text-dim); margin-top: 2px; }
    .gallery-foot {
      padding: 7px;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .new-btn {
      width: 100%;
      background: rgba(0,245,255,.08);
      border: 1px solid var(--accent);
      border-radius: 6px;
      color: var(--accent);
      cursor: pointer;
      font-size: .78rem;
      font-weight: 600;
      padding: 6px;
    }
    .new-btn:hover { background: rgba(0,245,255,.15); }

    /* ── Action bar ── */
    .actionbar {
      display: flex;
      gap: 6px;
      padding: 7px 12px;
      background: var(--surface);
      border-top: 1px solid var(--border);
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .act {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-dim);
      cursor: pointer;
      font-size: .75rem;
      padding: 4px 12px;
      transition: all .15s;
    }
    .act:hover    { border-color: var(--accent); color: var(--accent); }
    .act:disabled { opacity: .3; cursor: not-allowed; }

    /* ── Log drawer ── */
    .logdrawer {
      background: var(--surface);
      border-top: 1px solid var(--border);
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      transition: max-height .3s ease;
      max-height: 220px;
      overflow: hidden;
    }
    .logdrawer.collapsed { max-height: 32px; }
    .log-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      cursor: pointer;
      flex-shrink: 0;
      user-select: none;
      min-height: 32px;
    }
    .log-head:hover { background: var(--surface2); }
    .lh-title {
      font-size: .7rem;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--accent);
      flex-shrink: 0;
    }
    .lh-last {
      flex: 1;
      font-size: .72rem;
      color: var(--text-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lh-chevron {
      color: var(--text-dim);
      font-size: .75rem;
      transition: transform .25s;
      flex-shrink: 0;
    }
    .logdrawer:not(.collapsed) .lh-chevron { transform: rotate(180deg); }
    .log-body {
      flex: 1;
      overflow-y: auto;
      padding: 6px 14px 10px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .log-body::-webkit-scrollbar { width: 3px; }
    .log-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    .log-entry {
      display: flex;
      gap: 8px;
      align-items: baseline;
      font-size: .74rem;
      line-height: 1.4;
      padding: 3px 0;
      border-bottom: 1px solid rgba(255,255,255,.03);
    }
    .le-time  { color: var(--text-dim); flex-shrink: 0; font-family: monospace; font-size: .68rem; }
    .le-type  { flex-shrink: 0; font-size: .63rem; font-weight: 700; letter-spacing: .5px; padding: 1px 5px; border-radius: 3px; }
    .log-entry.cmd  .le-type { background: rgba(0,245,255,.12); color: var(--accent); }
    .log-entry.resp .le-type { background: rgba(80,200,80,.12);  color: #80d080; }
    .log-entry.sys  .le-type { background: rgba(255,170,0,.12);  color: #ffaa00; }
    .le-text { color: var(--text); flex: 1; }

    /* ── Responsive ── */
    @media (max-width: 680px) {
      .root { height: auto; min-height: 400px; }
      .main { flex-direction: column; }
      .panel { width: 100% !important; max-height: 180px; }
      .panel-left  { border-right: none; border-bottom: 1px solid var(--border); }
      .panel-right { border-left:  none; border-top:    1px solid var(--border); }
      .panel.closed { width: 100% !important; max-height: 32px; }
    }
  `;

  get _demoMessages() {
    return [
      { id: '1', role: 'jarvis', content: 'Jarvis online. How can I help?' },
      { id: '2', role: 'user',   content: 'Turn on the living room lights.' },
      { id: '3', role: 'jarvis', content: 'Done.' },
    ];
  }

  get _demoProjects() {
    return [
      { id: 'a', name: 'Desk Organiser', type: '3d_model', updated_at: new Date().toISOString() },
      { id: 'b', name: 'Label Sheet',    type: 'svg',      updated_at: new Date().toISOString() },
    ];
  }

  get _demoLog() {
    const now = new Date();
    const t = d => new Date(now - d * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return [
      { type: 'sys',  time: t(120), text: 'Jarvis online — all systems nominal' },
      { type: 'cmd',  time: t(90),  text: 'Turn on the living room lights' },
      { type: 'resp', time: t(89),  text: 'Done.' },
      { type: 'cmd',  time: t(45),  text: "What's the weather like?" },
      { type: 'resp', time: t(44),  text: "It's currently 68°F and partly cloudy." },
    ];
  }

  _renderMsg(m) {
    return html`
      <div class="msg ${m.role}">
        <div class="msg-role">${m.role === 'jarvis' ? '⬡ Jarvis' : '▶ You'}</div>
        ${m.content}
      </div>`;
  }

  _renderProjCard(p) {
    const labels = { '3d_model':'3D', svg:'SVG', note:'Note', other:'—' };
    return html`
      <div class="proj-card ${this._activeProject?.id === p.id ? 'active' : ''}"
           @click=${() => {
             this._activeProject = p;
             this._activeView = p.type === '3d_model' ? '3d' : p.type === 'svg' ? 'svg' : 'workspace';
           }}>
        <div class="pc-name">${p.name}</div>
        <div class="pc-meta">${labels[p.type] ?? p.type}</div>
      </div>`;
  }

  _renderLogEntry(e) {
    return html`
      <div class="log-entry ${e.type}">
        <span class="le-time">${e.time}</span>
        <span class="le-type">${e.type === 'cmd' ? 'CMD' : e.type === 'resp' ? 'RESP' : 'SYS'}</span>
        <span class="le-text">${e.text}</span>
      </div>`;
  }

  _renderWorkspaceSurface() {
    if (!this._activeProject) return html`
      <div class="ws-idle">
        <div class="watermark">Jarvis</div>
        <p>Select or create a project</p>
      </div>`;
    return html`
      <div class="view-tabs">
        <button class="vt ${this._activeView==='workspace'?'on':''}" @click=${()=>this._activeView='workspace'}>Info</button>
        ${this._activeProject.type==='3d_model' ? html`<button class="vt ${this._activeView==='3d'?'on':''}" @click=${()=>this._activeView='3d'}>3D</button>` : nothing}
        ${this._activeProject.type==='svg'       ? html`<button class="vt ${this._activeView==='svg'?'on':''}" @click=${()=>this._activeView='svg'}>SVG</button>` : nothing}
      </div>
      <div class="ws-project-info">
        <h2>${this._activeProject.name}</h2>
        <p>${this._activeProject.description ?? 'No description'}</p>
        <span class="badge">${this._activeProject.type}</span>
      </div>`;
  }

  render() {
    const haProj = !!this._activeProject;
    const lastLog = this._demoLog.at(-1);

    return html`
      <div class="root">

        <div class="statusbar">
          <span class="logo">Jarvis</span>
          <div class="pulse"></div>
          <div class="project-label">
            ${haProj ? html`Project: <b>${this._activeProject.name}</b>` : 'No active project'}
          </div>
          <button class="toggle-btn" @click=${()=>this._leftOpen=!this._leftOpen}>
            ${this._leftOpen?'◀':'▶'} Chat
          </button>
          <button class="toggle-btn" @click=${()=>this._rightOpen=!this._rightOpen}>
            Projects ${this._rightOpen?'▶':'◀'}
          </button>
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
                ${this._demoMessages.map(m=>this._renderMsg(m))}
              </div>
              <div class="chat-footer">
                <textarea
                  .value=${this._chatInput}
                  @input=${e=>this._chatInput=e.target.value}
                  @keydown=${this._onChatKey}
                  placeholder="Ask Jarvis…"></textarea>
                <button class="send-btn">▶</button>
              </div>
            </div>
          </div>

          <div class="workspace">
            <div class="ws-surface">
              ${this._renderWorkspaceSurface()}
            </div>
          </div>

          <div class="panel panel-right ${this._rightOpen?'':'closed'}">
            <div class="panel-head">
              <span class="ph-icon">📁</span>
              <span class="ph-label">Projects</span>
              <button class="ph-label" @click=${()=>this._rightOpen=false}>✕</button>
            </div>
            <div class="panel-body">
              <div class="gallery-list">
                ${this._demoProjects.map(p=>this._renderProjCard(p))}
              </div>
              <div class="gallery-foot">
                <button class="new-btn">+ New Project</button>
              </div>
            </div>
          </div>

        </div>

        <div class="actionbar">
          <button class="act" ?disabled=${!haProj}>🖨 Print</button>
          <button class="act" ?disabled=${!haProj}>✂ Cut</button>
          <button class="act" ?disabled=${!haProj}>⬇ Export</button>
          <button class="act" ?disabled=${!haProj}>📁 Upload</button>
          <button class="act">↻ Refresh</button>
        </div>

        <div class="logdrawer ${this._logOpen?'':'collapsed'}">
          <div class="log-head" @click=${()=>this._logOpen=!this._logOpen}>
            <span class="lh-title">⬡ Activity Log</span>
            <span class="lh-last">${lastLog?.text ?? ''}</span>
            <span class="lh-chevron">▼</span>
          </div>
          <div class="log-body">
            ${this._demoLog.map(e=>this._renderLogEntry(e))}
          </div>
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
