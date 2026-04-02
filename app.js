/* ═══════════════════════════════════════════════════════════════
   CONFIG FIREBASE — Remplacer les valeurs ci-dessous par celles
   de votre projet (Console Firebase › Paramètres du projet)
   ═══════════════════════════════════════════════════════════════ */
const firebaseConfig = {
  apiKey:            "AIzaSyBITTHbJ7vjn1jB8-mjNTV0-2lCrRiFgSg",
  authDomain:        "gpcorp-91948.firebaseapp.com",
  databaseURL:       "https://gpcorp-91948-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "gpcorp-91948",
  storageBucket:     "gpcorp-91948.firebasestorage.app",
  messagingSenderId: "673558256097",
  appId:             "1:673558256097:web:db427519ecffaf898b9aa0"
};
/* ═══════════════════════════════════════════════════════════════ */

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const FORMAT_LABELS = { 'poids-lourd': 'Poids lourd', 'semi': 'Semi-remorque' };
const FORMAT_KEYS   = ['poids-lourd', 'semi'];
const STATUS_LABELS = { arrived: 'Sur place', waiting: 'À venir', left: 'Reparti' };
const STATUS_BADGE  = { arrived: 'badge-arrived', waiting: 'badge-waiting', left: 'badge-left' };
let totalPlaces = 82, trucks = [], places = [], truckId = 0, selectedType = 'known', logEntries = [];
let sortCol = '', sortDir = 1;
const OVERDUE_MS = 30 * 60 * 1000; // 30 minutes
const isOverdue = t => t.status === 'arrived' && t.updatedAt && (Date.now() - new Date(t.updatedAt).getTime()) > OVERDUE_MS;
const overdueElapsed = t => {
  const ms    = Date.now() - new Date(t.updatedAt).getTime();
  const total = Math.floor(ms / 60000);
  const h     = Math.floor(total / 60);
  const m     = total % 60;
  return h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${total} min`;
};

/* ── Sync depuis Firebase ──────────────────────────────────────── */
function syncFromSnapshot(data) {
  totalPlaces = (data.config && data.config.totalPlaces) || 82;
  truckId     = (data.config && data.config.nextId)      || 0;
  const obj   = data.trucks || {};
  trucks = Object.keys(obj).map(k => {
    const t = obj[k];
    return {
      id: Number(k), plate: t.plate, format: t.format, type: t.type,
      company: t.company || '', content: t.content || '', eta: t.eta || '',
      notes: t.notes || '', status: t.status,
      place: (t.place !== undefined && t.place !== null) ? t.place : null,
      updatedAt: t.updatedAt || null,
      priority: t.priority || false
    };
  });
  places = Array(totalPlaces).fill(null);
  trucks.forEach(t => { if (t.place !== null) places[t.place] = t.id; });
  document.getElementById('capacity-input').value = totalPlaces;
  document.getElementById('reg-place-label').textContent = 'Numéro de place * (1–' + totalPlaces + ')';
  document.getElementById('reg-place').max = totalPlaces;
  renderTable(); renderMap(); updateStats();
  renderTimeline('bs-timeline-section', 'bs-timeline-chart', 'bs-tl-total');
  if (document.getElementById('view-bigscreen')?.classList.contains('active')) renderBigScreen();
}

/* ── Init & écoute temps réel ──────────────────────────────────── */
function selectType(t) {
  selectedType = t;
  document.getElementById('type-btn-known').className   = 'type-btn' + (t === 'known'   ? ' active-known'   : '');
  document.getElementById('type-btn-unknown').className = 'type-btn' + (t === 'unknown' ? ' active-unknown' : '');
}

function init() {
  if (localStorage.getItem('darkMode') === '1') {
    document.body.classList.add('dark');
    const btn = document.getElementById('dark-toggle-btn');
    if (btn) btn.textContent = '☀';
  }
  document.getElementById('table-body').innerHTML =
    '<tr><td colspan="8" style="text-align:center;padding:2rem;color:#9a9a95">Connexion Firebase…</td></tr>';
  db.ref('/').on('value', snapshot => {
    const data = snapshot.val();
    if (!data || !data.trucks) {
      trucks = []; places = Array(totalPlaces).fill(null);
      renderTable(); renderMap(); updateStats();
      return;
    }
    syncFromSnapshot(data);
  });
  db.ref('log').limitToLast(300).on('value', snapshot => {
    const obj = snapshot.val() || {};
    logEntries = Object.values(obj).sort((a, b) => new Date(b.ts) - new Date(a.ts));
    if (document.getElementById('view-log')?.classList.contains('active')) renderLog();
    renderTimeline();
  });
  setInterval(() => {
    if (document.getElementById('view-list')?.classList.contains('active')) renderTable();
    if (document.getElementById('view-map')?.classList.contains('active')) renderMap();
    if (document.getElementById('view-log')?.classList.contains('active')) renderLog();
    if (document.getElementById('view-bigscreen')?.classList.contains('active')) renderBigScreen();
  }, 30000);
}

/* ── Vues & stats ──────────────────────────────────────────────── */
function showView(v) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el  => el.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  document.querySelectorAll('.tab')[['list', 'register', 'map', 'import', 'log', 'bigscreen'].indexOf(v)].classList.add('active');
  if (v === 'map') renderMap();
  if (v === 'log') renderLog();
  if (v === 'bigscreen') {
    renderBigScreen();
    if (!window._bsClockInterval) {
      window._bsClockInterval = setInterval(() => {
        const el = document.getElementById('bs-clock');
        if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }, 1000);
    }
  }
}

function sortBy(col) {
  if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = 1; }
  renderTable();
}

function updateStats() {
  const arrived = trucks.filter(t => t.status === 'arrived').length;
  const waiting = trucks.filter(t => t.status === 'waiting').length;
  const left    = trucks.filter(t => t.status === 'left').length;
  const free    = places.filter(p => p === null).length;
  const pct     = Math.round((arrived / totalPlaces) * 100);
  // hidden ids (toujours utilisés ailleurs)
  document.getElementById('stat-total').textContent   = totalPlaces;
  document.getElementById('stat-arrived').textContent = arrived;
  document.getElementById('stat-free').textContent    = free;
  document.getElementById('stat-left').textContent    = left;
  const bar = document.getElementById('capacity-bar');
  if (bar) { bar.style.width = Math.min(pct,100)+'%'; bar.className = 'capacity-fill'+(pct>=90?' danger':pct>=70?' warn':''); }
  const kA = trucks.filter(t => t.type === 'known'   && t.status === 'arrived').length;
  const kW = trucks.filter(t => t.type === 'known'   && t.status === 'waiting').length;
  const kL = trucks.filter(t => t.type === 'known'   && t.status === 'left').length;
  const uA = trucks.filter(t => t.type === 'unknown' && t.status === 'arrived').length;
  const uW = trucks.filter(t => t.type === 'unknown' && t.status === 'waiting').length;
  const uL = trucks.filter(t => t.type === 'unknown' && t.status === 'left').length;
  // 3 grands compteurs
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('sc-waiting',        waiting);
  set('sc-waiting-known',  kW + ' connus');
  set('sc-waiting-unknown',uW + ' sans info');
  set('sc-arrived',        arrived);
  set('sc-arrived-known',  kA + ' connus');
  set('sc-arrived-unknown',uA + ' sans info');
  set('sc-left',           left);
  set('sc-left-known',     kL + ' connus');
  set('sc-left-unknown',   uL + ' sans info');
  // plan
  set('map-free',    free);
  set('map-known',   kA);
  set('map-unknown', uA);
  set('map-left',    left);
  // hidden pour compat
  set('g-known-total',     trucks.filter(t=>t.type==='known').length);
  set('g-known-remaining', kW);
  set('g-known-arrived',   kA+' sur place');
  set('g-known-waiting',   kW+' à venir');
  set('g-known-left',      kL+' repartis');
  set('g-unknown-total',   trucks.filter(t=>t.type==='unknown').length);
  set('g-unknown-remaining',uW);
  set('g-unknown-arrived', uA+' sur place');
  set('g-unknown-waiting', uW+' à venir');
  set('g-unknown-left',    uL+' repartis');
}

function renderTable() {
  const q      = document.getElementById('search').value.toLowerCase();
  const ft     = document.getElementById('filter-type').value;
  const fs     = document.getElementById('filter-status').value;
  const ff     = document.getElementById('filter-format').value;
  const now    = new Date();
  const isLate = t => {
    if (t.type !== 'known' || t.status !== 'waiting' || !t.eta) return false;
    return now > new Date(t.eta);
  };
  let filtered = trucks.filter(t => {
    const mQ = !q || (t.plate.toLowerCase().includes(q) || (t.company && t.company.toLowerCase().includes(q)));
    return mQ && (!ft || t.type === ft) && (!fs || t.status === fs) && (!ff || t.format === ff);
  });
  if (sortCol) {
    const STATUS_ORD = { waiting: 0, arrived: 1, left: 2 };
    filtered.sort((a, b) => {
      let va, vb;
      if (sortCol === 'eta') {
        va = a.eta ? new Date(a.eta).getTime() : Infinity;
        vb = b.eta ? new Date(b.eta).getTime() : Infinity;
      } else if (sortCol === 'status') {
        va = STATUS_ORD[a.status] ?? 9; vb = STATUS_ORD[b.status] ?? 9;
      } else if (sortCol === 'place') {
        va = a.place !== null ? a.place : Infinity; vb = b.place !== null ? b.place : Infinity;
      } else {
        va = (a[sortCol] || '').toLowerCase(); vb = (b[sortCol] || '').toLowerCase();
      }
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });
  }
  const lateCount = trucks.filter(isLate).length;
  const lateAlert = document.getElementById('late-alert');
  if (lateAlert) {
    lateAlert.style.display = lateCount > 0 ? 'block' : 'none';
    if (lateCount > 0) lateAlert.textContent = `⚠ ${lateCount} camion${lateCount > 1 ? 's' : ''} connu${lateCount > 1 ? 's' : ''} en retard sur l'heure prévue`;
  }
  const tb = document.getElementById('table-body');
  if (!filtered.length) {
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:#9a9a95">Aucun camion trouvé</td></tr>';
    document.getElementById('table-count').textContent = '';
    return;
  }
  // Priorités en haut, puis tri colonne
  filtered.sort((a, b) => (!!a.priority === !!b.priority) ? 0 : a.priority ? -1 : 1);
  tb.innerHTML = filtered.slice(0, 100).map(t => {
    const late    = isLate(t);
    const overdue = isOverdue(t);
    return `<tr class="${overdue ? 'row-overdue' : late ? 'row-late' : ''}${t.priority ? ' row-priority' : ''}">
    <td style="font-weight:600;font-family:monospace;cursor:pointer;color:#185FA5;white-space:nowrap" onclick="openInfo(${t.id})">
      <button class="star-btn${t.priority ? ' starred' : ''}" onclick="event.stopPropagation();togglePriority(${t.id})" title="${t.priority ? 'Retirer la priorité' : 'Marquer prioritaire'}">★</button>
      ${t.plate}
    </td>
    <td>${FORMAT_LABELS[t.format]}</td>
    <td><span class="badge badge-${t.type === 'known' ? 'known' : 'unknown'}">${t.type === 'known' ? 'Connu' : 'Sans info'}</span></td>
    <td>${t.company || '<span style="color:#9a9a95">—</span>'}</td>
    <td>${t.content || '<span style="color:#9a9a95">—</span>'}</td>
    ${(() => {
      if (!t.eta) return '<td style="color:#9a9a95;font-size:12px">—</td><td style="color:#9a9a95;font-size:12px">—</td>';
      // Essai ISO ou format natif
      let d = new Date(t.eta);
      if (!isNaN(d.getTime())) {
        return `<td style="white-space:nowrap;font-size:12px">${d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})}</td><td style="white-space:nowrap;font-size:12px">${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</td>`;
      }
      // DD/MM/YYYY HH:MM ou DD/MM/YYYY HH:MM:SS
      const mFull = t.eta.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}):(\d{2})/);
      if (mFull) {
        d = new Date(parseInt(mFull[3]), parseInt(mFull[2])-1, parseInt(mFull[1]), parseInt(mFull[4]), parseInt(mFull[5]));
        return `<td style="white-space:nowrap;font-size:12px">${d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})}</td><td style="white-space:nowrap;font-size:12px">${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</td>`;
      }
      // DD/MM HH:MM
      const mShort = t.eta.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
      if (mShort) {
        return `<td style="white-space:nowrap;font-size:12px">${mShort[1]}/${mShort[2]}</td><td style="white-space:nowrap;font-size:12px">${mShort[3]}:${mShort[4]}</td>`;
      }
      // HH:MM ou HH:MM:SS
      const mTime = t.eta.match(/^(\d{1,2}):(\d{2})/);
      if (mTime) {
        return `<td style="color:#9a9a95;font-size:12px">—</td><td style="white-space:nowrap;font-size:12px">${mTime[1].padStart(2,'0')}:${mTime[2]}</td>`;
      }
      // fallback
      return `<td style="color:#9a9a95;font-size:12px">—</td><td style="white-space:nowrap;font-size:12px">${t.eta}</td>`;
    })()}
    <td>${t.place !== null ? '<strong>#' + (t.place + 1) + '</strong>' : '<span style="color:#9a9a95">—</span>'}</td>
    <td style="text-align:center">
      <span class="badge ${STATUS_BADGE[t.status]}">${STATUS_LABELS[t.status]}</span>
      ${overdue ? `<div class="overdue-badge">⏱ Sur site depuis ${overdueElapsed(t)}</div>` : ''}
      ${!overdue && late ? '<div class="late-badge">⚠ En retard</div>' : ''}
      ${t.updatedAt ? `<div class="row-time">${new Date(t.updatedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>` : ''}
    </td>
    <td style="white-space:nowrap">
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px">
        ${t.status === 'waiting' ? `<button class="assign-btn" onclick="markArrived(${t.id})">Arrivée auto</button>` : ''}
        ${t.status === 'arrived' ? `<button class="assign-btn" onclick="markLeft(${t.id})">Reparti</button>`       : ''}
        ${t.status === 'left'    ? `<button class="assign-btn" onclick="markWaiting(${t.id})">Réactiver</button>`  : ''}
        <button class="assign-btn btn-delete" onclick="confirmDeleteTruck(${t.id})" title="Supprimer"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
      </div>
    </td>
  </tr>`;
  }).join('');
  document.querySelectorAll('.sort-icon').forEach(el => {
    const col = el.dataset.col;
    el.textContent = sortCol === col ? (sortDir === 1 ? ' ↑' : ' ↓') : '';
  });
  const n = filtered.length;
  document.getElementById('table-count').textContent =
    `${n} camion${n > 1 ? 's' : ''} affiché${n > 1 ? 's' : ''}${n > 100 ? ' (100 premiers)' : ''}`;
}

/* ── Actions camions → Firebase ────────────────────────────────── */
function markArrived(id) {
  const t = trucks.find(x => x.id === id); if (!t) return;
  const fp = places.findIndex(p => p === null);
  if (fp === -1) { alert('Plus de places disponibles !'); return; }
  db.ref('/').update({ [`trucks/${id}/status`]: 'arrived', [`trucks/${id}/place`]: fp, [`trucks/${id}/updatedAt`]: new Date().toISOString() });
  logAction(t.plate, 'arrived', fp);
}
function markLeft(id) {
  const t = trucks.find(x => x.id === id); if (!t) return;
  db.ref('/').update({ [`trucks/${id}/status`]: 'left', [`trucks/${id}/place`]: null, [`trucks/${id}/updatedAt`]: new Date().toISOString() });
  logAction(t.plate, 'left', t.place);
}
function markWaiting(id) {
  const t = trucks.find(x => x.id === id); if (!t) return;
  db.ref('/').update({ [`trucks/${id}/status`]: 'waiting', [`trucks/${id}/place`]: null, [`trucks/${id}/updatedAt`]: new Date().toISOString() });
  logAction(t.plate, 'waiting', null);
}
function confirmDeleteTruck(id) {
  const t = trucks.find(x => x.id === id); if (!t) return;
  document.getElementById('delete-modal-text').textContent = `Supprimer le camion ${t.plate} ? Cette action est irréversible.`;
  document.getElementById('delete-modal-confirm').onclick = () => { deleteTruck(id); closeDeleteModal(); };
  document.getElementById('delete-modal-bg').classList.add('open');
}
function deleteTruck(id) {
  db.ref('/').update({ [`trucks/${id}`]: null });
}
function closeDeleteModal() { document.getElementById('delete-modal-bg').classList.remove('open'); }

/* ── Recherche & dropdown ──────────────────────────────────────── */
function onSearch() {
  renderTable();
  const q  = document.getElementById('search').value.trim();
  const dd = document.getElementById('search-dropdown');
  if (q.length < 2) { dd.classList.remove('open'); return; }
  const qu      = q.toUpperCase();
  const matches = trucks.filter(t =>
    t.plate.toUpperCase().includes(qu) || (t.company && t.company.toUpperCase().includes(qu))
  ).slice(0, 8);
  if (!matches.length) { dd.classList.remove('open'); return; }
  dd.innerHTML = matches.map(t =>
    `<div class="dd-item" onmousedown="openInfo(${t.id})">
      <span class="dd-plate">${highlight(t.plate, q)}</span>
      <span class="dd-meta">${t.company || FORMAT_LABELS[t.format]}</span>
      <span class="dd-badge dd-${t.type === 'known' ? 'known' : 'unknown'}">${t.type === 'known' ? 'Connu' : 'Sans info'}</span>
      <span class="dd-badge dd-${t.status}">${STATUS_LABELS[t.status]}</span>
    </div>`
  ).join('');
  dd.classList.add('open');
}
function highlight(text, q) {
  const idx = text.toUpperCase().indexOf(q.toUpperCase());
  if (idx === -1) return text;
  return text.slice(0, idx) + '<strong>' + text.slice(idx, idx + q.length) + '</strong>' + text.slice(idx + q.length);
}
function hideDropdownDelay() {
  setTimeout(() => document.getElementById('search-dropdown').classList.remove('open'), 180);
}

/* ── Info overlay ──────────────────────────────────────────────── */
function openInfo(id) {
  document.getElementById('search-dropdown').classList.remove('open');
  const t = trucks.find(x => x.id === id); if (!t) return;
  document.getElementById('ic-plate').textContent = t.plate;
  const fmtDT = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' })
      + ' à ' + d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  };
  const rows = [
    ['Format',        FORMAT_LABELS[t.format]],
    ['Type',          t.type === 'known' ? 'Connu' : 'Sans info'],
    ['Statut',        `<span class="badge ${STATUS_BADGE[t.status]}">${STATUS_LABELS[t.status]}</span>`],
    ['Place',         t.place !== null ? '#' + (t.place + 1) : '—'],
    ['Société',       t.company  || '—'],
    ['Contenu',       t.content  || '—'],
    ['Date/heure prévue', fmtDT(t.eta)],
    ['Notes',         t.notes    || '—'],
    ['Dernière MAJ',  fmtDT(t.updatedAt)],
  ];
  document.getElementById('ic-rows').innerHTML = rows
    .map(([l, v]) => `<div class="info-row"><span class="info-label">${l}</span><span class="info-val">${v}</span></div>`)
    .join('');
  const actions = document.getElementById('ic-actions');
  actions.innerHTML = '';
  if (t.status === 'waiting') { const b = document.createElement('button'); b.className = 'btn btn-primary'; b.textContent = 'Marquer arrivé';  b.onclick = () => { markArrived(t.id); closeInfo(); }; actions.appendChild(b); }
  if (t.status === 'arrived') { const b = document.createElement('button'); b.className = 'btn';             b.textContent = 'Marquer reparti'; b.onclick = () => { markLeft(t.id);    closeInfo(); }; actions.appendChild(b); }
  if (t.status === 'left')    { const b = document.createElement('button'); b.className = 'btn';             b.textContent = 'Réactiver';       b.onclick = () => { markWaiting(t.id); closeInfo(); }; actions.appendChild(b); }
  const pr = document.createElement('button');
  pr.className = 'btn' + (t.priority ? ' btn-priority-on' : '');
  pr.textContent = t.priority ? '★ Prioritaire' : '☆ Priorité';
  pr.onclick = () => { togglePriority(t.id); closeInfo(); };
  actions.appendChild(pr);
  const ed = document.createElement('button'); ed.className = 'btn'; ed.textContent = 'Modifier'; ed.onclick = () => { closeInfo(); openEdit(t.id); }; actions.appendChild(ed);
  const cl = document.createElement('button'); cl.className = 'btn'; cl.textContent = 'Fermer'; cl.onclick = closeInfo; actions.appendChild(cl);
  document.getElementById('info-overlay').classList.add('open');
}
function closeInfo() { document.getElementById('info-overlay').classList.remove('open'); }

/* ── Edit modal ────────────────────────────────────────────────── */
function openEdit(id) {
  const t = trucks.find(x => x.id === id); if (!t) return;
  document.getElementById('edit-modal-title').textContent = 'Modifier — ' + t.plate;
  document.getElementById('edit-id').value       = t.id;
  document.getElementById('edit-plate').value    = t.plate;
  document.getElementById('edit-format').value   = t.format;
  document.getElementById('edit-company').value  = t.company || '';
  document.getElementById('edit-content').value  = t.content || '';
  document.getElementById('edit-eta').value      = t.eta     || '';
  document.getElementById('edit-notes').value    = t.notes   || '';
  // type toggle
  document.getElementById('edit-btn-known').className   = 'type-btn' + (t.type === 'known'   ? ' active-known'   : '');
  document.getElementById('edit-btn-unknown').className = 'type-btn' + (t.type === 'unknown' ? ' active-unknown' : '');
  document.getElementById('edit-modal-bg').dataset.editType = t.type;
  document.getElementById('edit-modal-bg').dataset.editPriority = t.priority ? '1' : '0';
  const pb = document.getElementById('edit-priority-btn');
  if (pb) { pb.textContent = t.priority ? '★ Prioritaire' : '☆ Non prioritaire'; pb.className = 'btn' + (t.priority ? ' btn-priority-on' : ''); }
  document.getElementById('edit-save-msg').style.display = 'none';
  document.getElementById('edit-modal-bg').classList.add('open');
}
function toggleEditPriority() {
  const bg  = document.getElementById('edit-modal-bg');
  const cur = bg.dataset.editPriority === '1';
  bg.dataset.editPriority = cur ? '0' : '1';
  const pb  = document.getElementById('edit-priority-btn');
  pb.textContent = cur ? '☆ Non prioritaire' : '★ Prioritaire';
  pb.className   = 'btn' + (cur ? '' : ' btn-priority-on');
}
function selectEditType(t) {
  document.getElementById('edit-modal-bg').dataset.editType = t;
  document.getElementById('edit-btn-known').className   = 'type-btn' + (t === 'known'   ? ' active-known'   : '');
  document.getElementById('edit-btn-unknown').className = 'type-btn' + (t === 'unknown' ? ' active-unknown' : '');
}
function saveEdit() {
  const id      = parseInt(document.getElementById('edit-id').value);
  const format  = document.getElementById('edit-format').value;
  const company = document.getElementById('edit-company').value.trim();
  const content = document.getElementById('edit-content').value.trim();
  const eta     = document.getElementById('edit-eta').value;
  const notes   = document.getElementById('edit-notes').value.trim();
  const type     = document.getElementById('edit-modal-bg').dataset.editType || 'known';
  const priority = document.getElementById('edit-modal-bg').dataset.editPriority === '1' ? true : null;
  if (!format) { alert('Le format est obligatoire.'); return; }
  const updates = {
    [`trucks/${id}/format`]:   format,
    [`trucks/${id}/type`]:     type,
    [`trucks/${id}/company`]:  company,
    [`trucks/${id}/content`]:  content,
    [`trucks/${id}/eta`]:      eta,
    [`trucks/${id}/notes`]:    notes,
    [`trucks/${id}/priority`]: priority,
  };
  db.ref('/').update(updates).then(() => {
    const msg = document.getElementById('edit-save-msg');
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; closeEditModal(); }, 1200);
  });
}
function closeEditModal() { document.getElementById('edit-modal-bg').classList.remove('open'); }

/* ── Capacité ──────────────────────────────────────────────────── */
function updateCapacity() {
  const n    = parseInt(document.getElementById('capacity-input').value);
  const hint = document.getElementById('capacity-hint');
  if (!n || n < 1 || n > 999) { hint.style.color = '#A32D2D'; hint.textContent = 'Valeur invalide'; return; }
  const lost = places.filter((p, i) => p !== null && i >= n);
  if (lost.length && !confirm('Réduire à ' + n + ' places ? ' + lost.length + ' camion(s) remis en attente.')) return;
  const updates = { 'config/totalPlaces': n };
  lost.forEach(id => { updates[`trucks/${id}/status`] = 'waiting'; updates[`trucks/${id}/place`] = null; });
  db.ref('/').update(updates);
  hint.style.color = '#1D9E75'; hint.textContent = 'Mis à jour : ' + n + ' places.';
  setTimeout(() => hint.textContent = '', 3000);
}

/* ── Enregistrement ────────────────────────────────────────────── */
function checkPlate() {
  const v = document.getElementById('reg-plate').value.toUpperCase();
  document.getElementById('plate-warning').style.display = trucks.some(t => t.plate === v) ? 'block' : 'none';
}
function checkPlace() {
  const fb  = document.getElementById('place-feedback');
  const val = parseInt(document.getElementById('reg-place').value);
  fb.className = 'place-feedback'; fb.textContent = '';
  if (!val || val < 1 || val > totalPlaces) {
    if (document.getElementById('reg-place').value !== '') { fb.textContent = 'Place invalide (1–' + totalPlaces + ')'; fb.classList.add('warn'); }
    return;
  }
  const occ = places[val - 1];
  if (occ === null) { fb.textContent = 'Place #' + val + ' disponible'; fb.classList.add('ok'); }
  else { const t = trucks.find(x => x.id === occ); fb.textContent = 'Place #' + val + ' occupée par ' + t.plate; fb.classList.add('warn'); }
}
function registerTruck() {
  const plate    = document.getElementById('reg-plate').value.toUpperCase().trim();
  const format   = document.getElementById('reg-format').value;
  if (!plate || !format) { alert('Immatriculation et format obligatoires.'); return; }
  if (trucks.some(t => t.plate === plate)) { alert('Immatriculation déjà enregistrée.'); return; }
  const placeRaw = document.getElementById('reg-place').value;
  const placeVal = placeRaw ? parseInt(placeRaw) : null;
  let idx = null;
  if (placeVal !== null) {
    if (placeVal < 1 || placeVal > totalPlaces) { alert('Numéro de place invalide (1–' + totalPlaces + ').'); return; }
    idx = placeVal - 1;
    if (places[idx] !== null) { const occ = trucks.find(x => x.id === places[idx]); alert('Place #' + placeVal + ' occupée par ' + occ.plate + '.'); return; }
  }
  const company = document.getElementById('reg-company').value.trim();
  const content = document.getElementById('reg-content').value.trim();
  const eta     = document.getElementById('reg-time').value;
  const notes   = document.getElementById('reg-notes').value.trim();
  const nid     = truckId;
  const status  = idx !== null ? 'arrived' : 'waiting';
  const updates = {};
  updates[`trucks/${nid}`] = { id: nid, plate, format, type: selectedType, company, content, eta, notes, status, place: idx };
  updates['config/nextId'] = nid + 1;
  db.ref('/').update(updates);
  logAction(plate, 'registered', idx);
  const msg = document.getElementById('success-msg');
  msg.textContent = 'Camion ' + plate + ' (' + (selectedType === 'known' ? 'Connu' : 'Sans info') + ') enregistré' + (idx !== null ? ' — place #' + placeVal : ' — en attente') + '.';
  msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3500);
  clearForm();
}
function clearForm() {
  ['reg-plate', 'reg-company', 'reg-content', 'reg-time', 'reg-notes', 'reg-place'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('reg-format').value = '';
  document.getElementById('plate-warning').style.display = 'none';
  const fb = document.getElementById('place-feedback'); fb.className = 'place-feedback'; fb.textContent = '';
  selectType('known');
}

/* ── Plan des places ───────────────────────────────────────────── */
function renderMap() {
  const grid     = document.getElementById('map-grid');
  const ZONES    = [{ label: 'Utilitaires', size: 74 }, { label: 'Poids lourds', size: 8 }];
  const sections = [];
  let cursor = 0;
  for (const z of ZONES) {
    const s = cursor, e = Math.min(s + z.size, totalPlaces);
    if (s < totalPlaces) sections.push({ label: `${z.label} — Places ${s + 1} à ${e}`, start: s, end: e });
    cursor = e;
  }
  const cols = Math.max(8, Math.floor((Math.min(window.innerWidth - 60, 900) - 40) / 36));
  grid.innerHTML = sections.map(sec => {
    let cells = '';
    for (let i = sec.start; i < sec.end; i++) {
      const occ = places[i]; let cls = 'place-free';
      if (occ !== null) { const t = trucks.find(x => x.id === occ); if (t) cls = isOverdue(t) ? 'place-overdue' : t.status === 'left' ? 'place-left' : t.type === 'known' ? 'place-known' : 'place-unknown'; }
      cells += `<div class="place ${cls}" onclick="showPlace(${i})">${i + 1}</div>`;
    }
    return `<div style="margin-bottom:20px"><div class="map-section-label">${sec.label}</div><div style="display:grid;grid-template-columns:repeat(${cols},32px);gap:4px">${cells}</div></div>`;
  }).join('');
}
function showPlace(idx) {
  const occ = places[idx];
  document.getElementById('map-modal-title').textContent = 'Place #' + (idx + 1);
  const btn = document.getElementById('map-modal-action');
  if (occ === null) {
    const waiting = trucks.filter(t => t.status === 'waiting');
    document.getElementById('map-modal-content').innerHTML =
      '<div style="color:#3B6D11;font-size:13px;margin-bottom:10px">Place libre</div>' +
      (waiting.length ? `
        <input id="map-search" type="text" placeholder="Rechercher immat., société…"
          style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--border-med);border-radius:var(--radius-sm);font-size:13px;font-family:inherit;margin-bottom:6px">
        <div id="map-truck-list" class="map-truck-list"></div>
        <input type="hidden" id="map-selected-id">
      ` : '<div style="font-size:12px;color:#9a9a95">Aucun camion en attente</div>');

    if (waiting.length) {
      const renderList = (q) => {
        const filtered = waiting.filter(t =>
          t.plate.toLowerCase().includes(q) ||
          (t.company && t.company.toLowerCase().includes(q)) ||
          (t.content && t.content.toLowerCase().includes(q))
        );
        const list = document.getElementById('map-truck-list');
        list.innerHTML = filtered.length
          ? filtered.map(t => `
              <div class="map-truck-item" data-id="${t.id}" onclick="selectMapTruck(${t.id})">
                <span class="map-truck-plate">${t.plate}</span>
                <span class="map-truck-meta">${FORMAT_LABELS[t.format]}${t.company ? ' — ' + t.company : ''}${t.content ? ' · ' + t.content : ''}</span>
              </div>`).join('')
          : '<div style="font-size:12px;color:#9a9a95;padding:8px">Aucun résultat</div>';
      };
      renderList('');
      document.getElementById('map-search').addEventListener('input', e => renderList(e.target.value.toLowerCase().trim()));
    }

    btn.textContent = 'Assigner';
    btn.onclick = () => {
      const sel = document.getElementById('map-selected-id') ? document.getElementById('map-selected-id').value : '';
      if (!sel) { alert('Sélectionnez un camion.'); return; }
      const tid = parseInt(sel);
      db.ref('/').update({ [`trucks/${tid}/status`]: 'arrived', [`trucks/${tid}/place`]: idx, [`trucks/${tid}/updatedAt`]: new Date().toISOString() });
      const selT = trucks.find(x => x.id === tid);
      if (selT) logAction(selT.plate, 'arrived', idx);
      closeMapModal();
    };
  } else {
    const t = trucks.find(x => x.id === occ);
    const fmtUpd = iso => { if (!iso) return null; const d = new Date(iso); return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) + ' à ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); };
    document.getElementById('map-modal-content').innerHTML =
      `<div class="map-modal-detail">Immatriculation : <span>${t.plate}</span></div>` +
      `<div class="map-modal-detail">Format : <span>${FORMAT_LABELS[t.format]}</span></div>` +
      `<div class="map-modal-detail">Type : <span>${t.type === 'known' ? 'Connu' : 'Sans info'}</span></div>` +
      (t.company ? `<div class="map-modal-detail">Société : <span>${t.company}</span></div>` : '') +
      (t.content ? `<div class="map-modal-detail">Contenu : <span>${t.content}</span></div>` : '') +
      (t.updatedAt ? `<div class="map-modal-detail">Dernière MAJ : <span>${fmtUpd(t.updatedAt)}</span></div>` : '');
    btn.textContent = t.status === 'arrived' ? 'Marquer reparti' : 'Réactiver';
    btn.onclick = () => { t.status === 'arrived' ? markLeft(t.id) : markWaiting(t.id); closeMapModal(); };
  }
  document.getElementById('map-modal-bg').classList.add('open');
}
function selectMapTruck(id) {
  document.getElementById('map-selected-id').value = id;
  document.querySelectorAll('.map-truck-item').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.map-truck-item[data-id="${id}"]`).classList.add('selected');
}
function closeMapModal() { document.getElementById('map-modal-bg').classList.remove('open'); }
window.addEventListener('resize', () => { if (document.getElementById('view-map').classList.contains('active')) renderMap(); });

/* ── Import Excel ──────────────────────────────────────────────── */
let importedRows = [];

function handleImportFile(file) {
  if (!file) return;
  const drop = document.getElementById('import-drop');
  drop.classList.remove('loaded');
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb   = XLSX.read(data, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      parseImportedRows(rows);
      drop.classList.add('loaded');
    } catch (err) { alert('Erreur de lecture du fichier : ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function _norm(s) { return String(s).toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function _col(row, ...keys) {
  for (const k of Object.keys(row)) {
    const nk = _norm(k);
    for (const key of keys) { if (nk === _norm(key) || nk.startsWith(_norm(key))) return String(row[k] || '').trim(); }
  }
  return '';
}

function parseImportedRows(rows) {
  importedRows = rows.map(r => {
    const plate = _col(r, 'immatriculation', 'plaque', 'plate', 'immat').toUpperCase().replace(/\s/g, '');
    if (!plate) return null;
    const fmtRaw  = _norm(_col(r, 'format'));
    const format  = fmtRaw.includes('semi') ? 'semi' : 'poids-lourd';
    const typeRaw = _norm(_col(r, 'type'));
    const type    = (typeRaw.includes('unknown') || typeRaw.includes('sans') || typeRaw.includes('inconnu')) ? 'unknown' : 'known';
    const company = _col(r, 'societe', 'société', 'company', 'entreprise');
    const content = _col(r, 'contenu', 'content', 'marchandise');
    const eta     = _col(r, 'heure', 'eta', 'heure prevue');
    const notes   = _col(r, 'notes', 'note', 'remarque', 'observation');
    return { plate, format, type, company, content, eta, notes, status: 'waiting', place: null };
  }).filter(Boolean);
  renderImportPreview();
}

function renderImportPreview() {
  const dupes = importedRows.filter(r =>  trucks.some(t => t.plate === r.plate));
  const valid = importedRows.filter(r => !trucks.some(t => t.plate === r.plate));
  document.getElementById('import-summary').innerHTML =
    `<strong>${importedRows.length}</strong> ligne(s) détectée(s) &nbsp;—&nbsp; ` +
    `<span class="v-green"><strong>${valid.length}</strong> nouveau(x)</span>` +
    (dupes.length ? ` &nbsp;—&nbsp; <span style="color:var(--amber)"><strong>${dupes.length}</strong> doublon(s) ignoré(s)</span>` : '');
  document.getElementById('import-btn').textContent = `Importer ${valid.length} camion(s)`;
  document.getElementById('import-table-body').innerHTML = importedRows.slice(0, 20).map(r => {
    const isDupe = trucks.some(t => t.plate === r.plate);
    return `<tr style="${isDupe ? 'opacity:0.4' : ''}">
      <td style="font-weight:600;font-family:monospace">${r.plate}${isDupe ? ' <span style="font-size:10px;color:var(--amber)">(doublon)</span>' : ''}</td>
      <td>${FORMAT_LABELS[r.format] || r.format}</td>
      <td><span class="badge badge-${r.type === 'known' ? 'known' : 'unknown'}">${r.type === 'known' ? 'Connu' : 'Sans info'}</span></td>
      <td>${r.company || '<span style="color:#9a9a95">—</span>'}</td>
      <td>${r.content || '<span style="color:#9a9a95">—</span>'}</td>
      <td>${r.eta     || '<span style="color:#9a9a95">—</span>'}</td>
      <td>${r.notes   || '<span style="color:#9a9a95">—</span>'}</td>
    </tr>`;
  }).join('');
  document.getElementById('import-table-more').textContent =
    importedRows.length > 20 ? `… et ${importedRows.length - 20} autre(s) ligne(s) non affichée(s)` : '';
  document.getElementById('import-preview').style.display = 'block';
  document.getElementById('import-success').style.display = 'none';
}

function doImport() {
  const clearAll  = document.getElementById('import-clear').checked;
  const toImport  = clearAll ? importedRows : importedRows.filter(r => !trucks.some(t => t.plate === r.plate));
  if (!toImport.length) { alert('Aucun camion à importer (tous en doublon ?).'); return; }
  const updates   = {};
  let nextId      = clearAll ? 0 : truckId;
  if (clearAll) updates['trucks'] = null;
  toImport.forEach(r => { updates[`trucks/${nextId}`] = { ...r, id: nextId }; nextId++; });
  updates['config/nextId']      = nextId;
  if (clearAll) updates['config/totalPlaces'] = totalPlaces;
  db.ref('/').update(updates).then(() => {
    const msg = document.getElementById('import-success');
    msg.textContent = `✓ ${toImport.length} camion(s) importé(s) avec succès !`;
    msg.style.display = 'block';
    importedRows = [];
    document.getElementById('import-preview').style.display = 'none';
    document.getElementById('import-file').value = '';
    document.getElementById('import-drop').classList.remove('loaded');
    setTimeout(() => msg.style.display = 'none', 4000);
  }).catch(err => alert('Erreur Firebase : ' + err.message));
}

function confirmResetAll() {
  document.getElementById('reset-modal-bg').classList.add('open');
}
function doResetAll() {
  db.ref('/').update({ trucks: null, log: null, 'config/nextId': 0 }).then(() => {
    document.getElementById('reset-modal-bg').classList.remove('open');
    const msg = document.getElementById('import-success');
    msg.textContent = '✓ Base réinitialisée — tous les camions et l\'historique ont été supprimés.';
    msg.style.display = 'block';
    setTimeout(() => msg.style.display = 'none', 4000);
  });
}
function cancelImport() {
  importedRows = [];
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-file').value = '';
  document.getElementById('import-drop').classList.remove('loaded');
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Immatriculation', 'Format',      'Type',    'Société',           'Contenu',        'Date/Heure prévue',  'Notes'],
    ['AB-123-CD',       'poids-lourd', 'known',   'Transports Dupont', 'Matériel scène', '2026-04-03T08:30',   ''],
    ['EF-456-GH',       'semi',        'unknown', '',                  '',               '',                   'Camion non identifié'],
    ['IJ-789-KL',       'poids-lourd', 'known',   'FastCargo',         'Alimentation',   '2026-04-03T09:15',   'Prioritaire'],
  ]);
  ws['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 25 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Camions');
  XLSX.writeFile(wb, 'modele_camions.xlsx');
}

/* ── Priorité ─────────────────────────────────────────────────── */
function togglePriority(id) {
  const t = trucks.find(x => x.id === id); if (!t) return;
  db.ref('/').update({ [`trucks/${id}/priority`]: t.priority ? null : true });
}

/* ── Timeline arrivées ─────────────────────────────────────────── */
function renderTimeline(sectionId = 'timeline-section', chartId = 'timeline-chart', totalId = 'tl-total') {
  const section = document.getElementById(sectionId);
  const chart   = document.getElementById(chartId);
  if (!section || !chart) return;
  // Parser flexible : ISO, DD/MM HH:MM, DD/MM/YYYY HH:MM, HH:MM
  const parseEtaHour = eta => {
    if (!eta) return null;
    let d = new Date(eta);
    if (!isNaN(d.getTime())) return d.getHours();
    // DD/MM(/YYYY) HH:MM
    const m = eta.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})/);
    if (m) { d = new Date(m[3] ? parseInt(m[3]) : new Date().getFullYear(), parseInt(m[2])-1, parseInt(m[1]), parseInt(m[4]), parseInt(m[5])); if (!isNaN(d.getTime())) return d.getHours(); }
    // HH:MM seul (ancien format)
    const t2 = eta.match(/^(\d{1,2}):(\d{2})$/);
    if (t2) return parseInt(t2[1]);
    return null;
  };
  // ETA de tous les camions → vue planning "à venir par heure"
  const allHours = trucks
    .filter(t => t.eta)
    .map(t => parseEtaHour(t.eta))
    .filter(h => h !== null);
  if (!allHours.length) { section.style.display = 'none'; return; }
  const counts = {};
  allHours.forEach(h => { counts[h] = (counts[h] || 0) + 1; });
  const hours    = Object.keys(counts).map(Number);
  const minH     = Math.max(0,  Math.min(...hours) - 1);
  const maxH     = Math.min(23, Math.max(...hours) + 1);
  const maxCount = Math.max(...Object.values(counts));
  const BAR_MAX  = 72; // px
  let html = '';
  for (let h = minH; h <= maxH; h++) {
    const c   = counts[h] || 0;
    const px  = c > 0 ? Math.max(Math.round((c / maxCount) * BAR_MAX), 6) : 0;
    const peak = c > 0 && c === maxCount;
    html += `<div class="tl-col">
      <div class="tl-bar-wrap">
        ${c > 0 ? `<span class="tl-count">${c}</span>` : '<span class="tl-count" style="visibility:hidden">0</span>'}
        <div class="tl-bar${peak ? ' tl-bar-peak' : ''}" style="height:${px}px"></div>
      </div>
      <div class="tl-label">${String(h).padStart(2,'0')}h</div>
    </div>`;
  }
  chart.innerHTML = html;
  document.getElementById(totalId).textContent = `${allHours.length} arrivée${allHours.length > 1 ? 's' : ''} enregistrée${allHours.length > 1 ? 's' : ''}`;
  section.style.display = 'block';
}

/* ── Log ───────────────────────────────────────────────────────── */
function logAction(plate, action, placeIdx) {
  db.ref('log').push({ ts: new Date().toISOString(), plate, action, place: (placeIdx !== undefined && placeIdx !== null) ? placeIdx : null });
}
function renderLog() {
  const tb = document.getElementById('log-body');
  const countEl = document.getElementById('log-count');
  if (!logEntries.length) {
    tb.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:#9a9a95">Aucun événement enregistré</td></tr>';
    if (countEl) countEl.textContent = ''; return;
  }
  const LABELS = { arrived: 'Arrivée', left: 'Départ', waiting: 'Remis en attente', registered: 'Enregistré' };
  const BADGES = { arrived: 'badge-arrived', left: 'badge-left', waiting: 'badge-waiting', registered: 'badge-known' };
  const overduePlates = new Set(trucks.filter(t => isOverdue(t)).map(t => t.plate));
  tb.innerHTML = logEntries.map(e => {
    const d      = new Date(e.ts);
    const od     = e.action === 'arrived' && overduePlates.has(e.plate);
    return `<tr class="${od ? 'row-overdue' : ''}">
      <td style="white-space:nowrap;color:var(--text-secondary);font-variant-numeric:tabular-nums">${d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})} ${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td>
      <td style="font-weight:600;font-family:monospace">${e.plate}${od ? ' <span class="overdue-badge">⏱ dépassement</span>' : ''}</td>
      <td><span class="badge ${BADGES[e.action] || ''}">${LABELS[e.action] || e.action}</span></td>
      <td>${e.place !== null && e.place !== undefined ? '<strong>#' + (e.place + 1) + '</strong>' : '—'}</td>
    </tr>`;
  }).join('');
  if (countEl) countEl.textContent = `${logEntries.length} événement${logEntries.length > 1 ? 's' : ''} (300 max)`;
}
function exportLog() {
  if (!logEntries.length) { alert('Aucun événement à exporter.'); return; }
  const LABELS = { arrived: 'Arrivée', left: 'Départ', waiting: 'Remis en attente', registered: 'Enregistré' };
  const rows = logEntries.slice().reverse().map(e => ({
    'Date/Heure': new Date(e.ts).toLocaleString('fr-FR'),
    'Camion': e.plate, 'Action': LABELS[e.action] || e.action,
    'Place': (e.place !== null && e.place !== undefined) ? '#' + (e.place + 1) : ''
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Historique');
  XLSX.writeFile(wb, `historique_${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.xlsx`);
}

/* ── Export snapshot ───────────────────────────────────────────── */
function exportSnapshot() {
  if (!trucks.length) { alert('Aucune donnée à exporter.'); return; }
  const rows = trucks.map(t => ({
    'Immatriculation': t.plate, 'Format': FORMAT_LABELS[t.format],
    'Type': t.type === 'known' ? 'Connu' : 'Sans info',
    'Société': t.company || '', 'Contenu': t.content || '',
    'Heure prévue': t.eta || '', 'Notes': t.notes || '',
    'Statut': STATUS_LABELS[t.status],
    'Place': t.place !== null ? '#' + (t.place + 1) : '',
    'Dernière MAJ': t.updatedAt ? new Date(t.updatedAt).toLocaleString('fr-FR') : ''
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 16 },{ wch: 14 },{ wch: 10 },{ wch: 22 },{ wch: 20 },{ wch: 10 },{ wch: 25 },{ wch: 12 },{ wch: 8 },{ wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Camions');
  XLSX.writeFile(wb, `snapshot_${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.xlsx`);
}

/* ── Grand écran ───────────────────────────────────────────────── */
function renderBigScreen() {
  const arrived = trucks.filter(t => t.status === 'arrived').length;
  const waiting = trucks.filter(t => t.status === 'waiting').length;
  const left    = trucks.filter(t => t.status === 'left').length;
  const free    = places.filter(p => p === null).length;
  const pct     = Math.round((arrived / totalPlaces) * 100);
  const now     = new Date();
  const lateList = trucks.filter(t => {
    if (t.type !== 'known' || t.status !== 'waiting' || !t.eta) return false;
    const [h, m] = t.eta.split(':').map(Number);
    return now > new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  });
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('bs-arrived', arrived); set('bs-free', free); set('bs-waiting', waiting);
  set('bs-left', left); set('bs-total', totalPlaces); set('bs-late-count', lateList.length);
  set('bs-clock', now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const bar = document.getElementById('bs-progress');
  if (bar) { bar.style.width = Math.min(pct, 100) + '%'; bar.className = 'bs-progress-fill' + (pct >= 90 ? ' danger' : pct >= 70 ? ' warn' : ''); }
  const lbl = document.getElementById('bs-progress-label');
  if (lbl) lbl.textContent = `${arrived} place${arrived > 1 ? 's' : ''} occupée${arrived > 1 ? 's' : ''} sur ${totalPlaces} — ${pct}%`;
  renderTimeline('bs-timeline-section', 'bs-timeline-chart', 'bs-tl-total');
  const sec = document.getElementById('bs-late-section');
  if (sec) {
    sec.style.display = lateList.length ? 'block' : 'none';
    const list = document.getElementById('bs-late-list');
    if (list) list.innerHTML = lateList.map(t => {
      const etaFmt = t.eta ? (() => { const d = new Date(t.eta); return isNaN(d.getTime()) ? t.eta : d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) + ' ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); })() : '';
      return `<div class="bs-late-item">
        <span class="bs-late-plate">${t.plate}</span>
        <span class="bs-late-meta">${t.company || FORMAT_LABELS[t.format]}</span>
        <span class="bs-late-eta">prévu ${etaFmt}</span>
      </div>`;
    }).join('');
  }
}

/* ── Mode nuit ─────────────────────────────────────────────────── */
function toggleDarkMode() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('darkMode', isDark ? '1' : '0');
  document.getElementById('dark-toggle-btn').textContent = isDark ? '☀' : '🌙';
}

init();
