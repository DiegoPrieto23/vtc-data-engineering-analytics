/* ==========================================================================
   VTC Analytics — informe interactivo
   Todo el cálculo ocurre en el navegador sobre el extracto `data/trips.json`,
   de modo que los filtros globales se propagan a todas las páginas igual que
   el cross-filtering de una herramienta de BI.
   ========================================================================== */
(() => {
'use strict';

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const S = {
  trips: [],
  meta: {},
  view: [],                       // viajes tras aplicar filtros
  page: 'overview',
  filters: { c: new Set(), city: new Set(), r: new Set(), ct: new Set(), dt: { from: null, to: null } },
  dates: [],
  rendered: new Set(),
  maps: {},
  geo: { scope: 'ALL', layers: { routes: true, pickup: true, dropoff: true, heat: false }, topn: 25 },
};

// ---------------------------------------------------------------------------
// Diccionarios
// ---------------------------------------------------------------------------
const COUNTRY = { ES:'España', CO:'Colombia', PE:'Perú', CL:'Chile', EC:'Ecuador', AR:'Argentina', MX:'México' };

const REASON  = {
  drop_off:      'Completado',
  rider_cancel:  'Cancelado por el usuario',
  not_found:     'Conductor no encontrado',
  not_shown:     'El usuario no apareció',
  system_cancel: 'Cancelado por el sistema',
  stop:          'Parada intermedia',
  __null:        'Sin cierre registrado',
};
const REASON_SHORT = {
  drop_off:'Completado', rider_cancel:'Cancela usuario', not_found:'Sin conductor',
  not_shown:'No apareció', system_cancel:'Cancela sistema', stop:'Parada', __null:'Sin cierre',
};
const WD  = { 1:'Lunes', 2:'Martes', 3:'Miércoles', 4:'Jueves', 5:'Viernes', 6:'Sábado', 7:'Domingo' };
const WDS = { 1:'L', 2:'M', 3:'X', 4:'J', 5:'V', 6:'S', 7:'D' };

const PAGE_TITLES = {
  overview:'Resumen ejecutivo', revenue:'Ingresos y precio', demand:'Demanda y horarios',
  geo:'Mapa y rutas', ops:'Conductores y flota', funnel:'Conversión del viaje',
  users:'Usuarios y fidelidad', quality:'Calidad del dato', method:'Modelo y metodología',
};

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------
const nf  = new Intl.NumberFormat('es-ES');
const nf1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits:1, maximumFractionDigits:1 });
const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits:2, maximumFractionDigits:2 });

const n  = v => (v == null || Number.isNaN(v)) ? '-' : nf.format(Math.round(v));
const n1 = v => (v == null || Number.isNaN(v)) ? '-' : nf1.format(v);
const n2 = v => (v == null || Number.isNaN(v)) ? '-' : nf2.format(v);
const eur  = v => (v == null || Number.isNaN(v)) ? '-' : nf.format(Math.round(v)) + ' €';
const eur2 = v => (v == null || Number.isNaN(v)) ? '-' : nf2.format(v) + ' €';
const pct  = v => (v == null || Number.isNaN(v)) ? '-' : nf1.format(v) + ' %';
const cname = c => COUNTRY[c] || c || 'Sin país';
const cflag = c => cname(c);                       // texto plano: seguro en ejes de gráficos
const cbadge = c => (c && COUNTRY[c] ? `<span class="cc">${esc(c)}</span> ` : '') + esc(cname(c));
const cdot  = c => (c && COUNTRY[c] ? `<span class="cc">${esc(c)}</span> ` : '');
const rname = r => REASON[r || '__null'] || r;
const rshort = r => REASON_SHORT[r || '__null'] || r;
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const dmy = iso => { if (!iso) return '-'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };
const dmyShort = iso => { const [,m,d] = iso.split('-'); return `${d}/${m}`; };

// ---------------------------------------------------------------------------
// Estadística
// ---------------------------------------------------------------------------
const sum  = (a, f = x => x) => a.reduce((s, x) => s + (f(x) || 0), 0);
const mean = (a, f = x => x) => { const v = a.map(f).filter(x => x != null && !Number.isNaN(x)); return v.length ? sum(v) / v.length : null; };
function quantile(arr, q) {
  const v = arr.filter(x => x != null && !Number.isNaN(x)).sort((a,b) => a-b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q, base = Math.floor(pos), rest = pos - base;
  return v[base + 1] !== undefined ? v[base] + rest * (v[base+1] - v[base]) : v[base];
}
const median = a => quantile(a, .5);
function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
const billed = t => t.p != null;

// ---------------------------------------------------------------------------
// Tokens de color leídos del CSS (respetan el tema activo)
// ---------------------------------------------------------------------------
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function series(i) { return css(`--series-${(i % 8) + 1}`); }
function seqRamp() { return [css('--seq-100'), css('--seq-200'), css('--seq-300'), css('--seq-400'), css('--seq-500'), css('--seq-600'), css('--seq-700')]; }
function seqColor(t) {  // t ∈ [0,1]
  const r = seqRamp(), x = Math.max(0, Math.min(1, t)) * (r.length - 1);
  const i = Math.floor(x), f = x - i;
  return f === 0 || i >= r.length - 1 ? r[Math.min(i, r.length - 1)] : mix(r[i], r[i+1], f);
}
function hex2rgb(h) { const s = h.replace('#',''); return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)]; }
function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return `rgb(${Math.round(A[0]+(B[0]-A[0])*t)},${Math.round(A[1]+(B[1]-A[1])*t)},${Math.round(A[2]+(B[2]-A[2])*t)})`;
}
function alpha(hex, a) { const [r,g,b] = hex2rgb(hex); return `rgba(${r},${g},${b},${a})`; }
const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

// ---------------------------------------------------------------------------
// Plotly: tema y helpers
// ---------------------------------------------------------------------------
const PCFG = { displayModeBar: false, responsive: true, locale: 'es' };

function layout(extra = {}) {
  const base = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: css('--font') || 'system-ui, sans-serif', size: 12, color: css('--text-secondary') },
    margin: { l: 52, r: 14, t: 12, b: 40 },
    xaxis: { gridcolor: css('--grid'), zerolinecolor: css('--axis'), linecolor: css('--axis'),
             tickfont: { color: css('--text-muted'), size: 11 }, automargin: true },
    yaxis: { gridcolor: css('--grid'), zerolinecolor: css('--axis'), linecolor: 'rgba(0,0,0,0)',
             tickfont: { color: css('--text-muted'), size: 11 }, automargin: true },
    hoverlabel: { bgcolor: css('--surface-2'), bordercolor: css('--border-strong'),
                  font: { color: css('--text-primary'), size: 12 } },
    showlegend: false,
    hovermode: 'closest',
    bargap: 0.28,
  };
  return deepMerge(base, extra);
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const k in b) {
    out[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object')
      ? deepMerge(a[k], b[k]) : b[k];
  }
  return out;
}
function plot(id, data, extra) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!data.length || data.every(d => !(d.x || []).length && !(d.y || []).length)) {
    el.innerHTML = '<div class="empty">Sin datos para los filtros aplicados</div>';
    return;
  }
  Plotly.react(el, data, layout(extra), PCFG);
}
function emptyBox(id, msg = 'Sin datos para los filtros aplicados') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="empty">${msg}</div>`;
}

// ---------------------------------------------------------------------------
// Tooltip compartido (para los heatmaps y tablas hechos a mano)
// ---------------------------------------------------------------------------
const tip = document.createElement('div');
Object.assign(tip.style, {
  position:'fixed', zIndex:'999', pointerEvents:'none', display:'none',
  padding:'7px 10px', borderRadius:'6px', fontSize:'12px', lineHeight:'1.45',
  maxWidth:'260px',
});
document.body.appendChild(tip);
function bindTip(el, html) {
  el.addEventListener('mouseenter', e => {
    tip.innerHTML = html;
    tip.style.background = css('--surface-2');
    tip.style.color = css('--text-primary');
    tip.style.border = `1px solid ${css('--border-strong')}`;
    tip.style.display = 'block';
    moveTip(e);
  });
  el.addEventListener('mousemove', moveTip);
  el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}
function moveTip(e) {
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

// ---------------------------------------------------------------------------
// Componentes reutilizables
// ---------------------------------------------------------------------------
function kpi({ label, value, unit, foot, accent, spark, hint }) {
  return `<div class="kpi" style="--accent:${accent || 'transparent'}">
    <div class="kpi-label">${esc(label)}${hint ? ` <span title="${esc(hint)}" style="cursor:help;opacity:.6">ⓘ</span>` : ''}</div>
    <div class="kpi-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div>
    <div class="kpi-foot">${foot || ''}</div>
    ${spark ? `<div class="kpi-spark" id="${spark}"></div>` : ''}
  </div>`;
}
function table(el, cols, rows, opts = {}) {
  const t = typeof el === 'string' ? document.getElementById(el) : el;
  if (!t) return;
  if (!rows.length) { t.innerHTML = `<tbody><tr><td class="empty">Sin datos para los filtros aplicados</td></tr></tbody>`; return; }
  const head = `<thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${rows.map((r, i) => `<tr ${opts.rowAttr ? opts.rowAttr(r, i) : ''}>${
    cols.map(c => {
      const v = c.f(r, i);
      return `<td class="${c.cls || ''} ${c.num ? 'num' : ''}">${v}</td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
  t.innerHTML = head + body;
}
function barCell(value, max, text) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return `<div class="bar-cell"><i class="bar" style="width:${w}%"></i><span>${text}</span></div>`;
}
function setInsight(id, html, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector('div').innerHTML = html;
  if (cls) { el.className = 'insight ' + cls; }
}

/** Heatmap en CSS grid: filas × 24 horas (o columnas arbitrarias). */
function heatGrid(container, rows, opts) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return;
  const cols = opts.cols;
  const max = Math.max(...rows.flatMap(r => r.values.filter(v => v != null)), 0);
  el.className = 'hm';
  el.style.gridTemplateColumns = `${opts.labelWidth || 34}px repeat(${cols.length}, minmax(0, 1fr))`;
  el.innerHTML = '';

  // cabecera
  el.appendChild(Object.assign(document.createElement('div'), { className: 'hm-lab' }));
  cols.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'hm-lab';
    d.textContent = (opts.colLabel ? opts.colLabel(c, i) : c);
    el.appendChild(d);
  });

  rows.forEach(r => {
    const lab = document.createElement('div');
    lab.className = 'hm-lab row';
    lab.textContent = r.label;
    el.appendChild(lab);
    r.values.forEach((v, i) => {
      const cell = document.createElement('div');
      cell.className = 'hm-cell';
      const t = max > 0 && v != null ? v / max : 0;
      cell.style.background = v == null || v === 0 ? css('--surface-sunken') : seqColor(0.12 + t * 0.88);
      bindTip(cell, opts.tip(r, cols[i], v));
      el.appendChild(cell);
    });
  });
}

// ---------------------------------------------------------------------------
// Filtros globales (slicers)
// ---------------------------------------------------------------------------
function dimValues(dim) {
  // Opciones calculadas sobre los viajes filtrados por *las demás* dimensiones,
  // para que los recuentos que se ven en el menú sean coherentes.
  const base = applyFilters(S.trips, dim);
  const counts = new Map();
  for (const t of base) {
    const k = dim === 'r' ? (t.r || '__null') : (t[dim] ?? '__null');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
function dimLabel(dim, v) {
  if (dim === 'c')  return cflag(v === '__null' ? null : v);
  if (dim === 'r')  return rname(v === '__null' ? null : v);
  if (dim === 'ct') return v === '__null' ? 'Sin categoría' : v;
  return v === '__null' ? 'Sin asignar' : v;
}
function applyFilters(arr, exceptDim) {
  const f = S.filters;
  return arr.filter(t => {
    if (exceptDim !== 'c'    && f.c.size    && !f.c.has(t.c ?? '__null')) return false;
    if (exceptDim !== 'city' && f.city.size && !f.city.has(t.city ?? '__null')) return false;
    if (exceptDim !== 'r'    && f.r.size    && !f.r.has(t.r || '__null')) return false;
    if (exceptDim !== 'ct'   && f.ct.size   && !f.ct.has(t.ct ?? '__null')) return false;
    if (exceptDim !== 'dt') {
      if (f.dt.from && t.dt < f.dt.from) return false;
      if (f.dt.to   && t.dt > f.dt.to)   return false;
    }
    return true;
  });
}
function buildSlicers() {
  document.querySelectorAll('.slicer').forEach(sl => {
    const dim = sl.dataset.dim;
    const btn = sl.querySelector('.slicer-btn');
    const menu = sl.querySelector('.slicer-menu');

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains('open');
      document.querySelectorAll('.slicer-menu').forEach(m => m.classList.remove('open'));
      if (!wasOpen) { renderSlicerMenu(dim, menu); menu.classList.add('open'); }
    });
    menu.addEventListener('click', e => e.stopPropagation());
  });
  document.addEventListener('click', () => document.querySelectorAll('.slicer-menu').forEach(m => m.classList.remove('open')));
  document.getElementById('reset-filters').addEventListener('click', () => {
    S.filters = { c:new Set(), city:new Set(), r:new Set(), ct:new Set(), dt:{ from:null, to:null } };
    refresh();
  });
}
function renderSlicerMenu(dim, menu) {
  if (dim === 'dt') return renderDateMenu(menu);
  const sel = S.filters[dim];
  const opts = dimValues(dim);
  menu.innerHTML =
    `<button class="slicer-opt" data-all="1" aria-pressed="${sel.size === 0}"><span class="slicer-check">✓</span>Todos<span class="tail">${n(sum(opts, o => o[1]))}</span></button>
     <div class="slicer-sep"></div>` +
    opts.map(([v, c]) =>
      `<button class="slicer-opt" data-v="${esc(v)}" aria-pressed="${sel.has(v)}">
         <span class="slicer-check">✓</span>${esc(dimLabel(dim, v))}<span class="tail">${n(c)}</span>
       </button>`).join('');

  menu.querySelectorAll('.slicer-opt').forEach(o => o.addEventListener('click', () => {
    if (o.dataset.all) { sel.clear(); }
    else { const v = o.dataset.v; sel.has(v) ? sel.delete(v) : sel.add(v); }
    renderSlicerMenu(dim, menu);
    refresh();
  }));
}
function renderDateMenu(menu) {
  const [min, max] = [S.dates[0], S.dates[S.dates.length - 1]];
  const f = S.filters.dt;
  const presets = [
    ['Todo el periodo', null, null],
    ['Septiembre 2021', '2021-09-01', '2021-09-30'],
    ['Octubre 2021',    '2021-10-01', '2021-10-31'],
    ['Última semana',   S.dates[Math.max(0, S.dates.length - 7)], max],
  ];
  menu.innerHTML = presets.map(([lab, a, b]) => {
    const on = (f.from || null) === a && (f.to || null) === b;
    return `<button class="slicer-opt" data-a="${a || ''}" data-b="${b || ''}" aria-pressed="${on}">
      <span class="slicer-check">✓</span>${lab}</button>`;
  }).join('') +
  `<div class="slicer-sep"></div>
   <div style="display:flex;gap:6px;padding:6px 8px 8px;align-items:center">
     <input class="inp" type="date" id="dt-from" value="${f.from || min}" min="${min}" max="${max}" style="width:100%">
     <span style="color:var(--text-muted)">→</span>
     <input class="inp" type="date" id="dt-to" value="${f.to || max}" min="${min}" max="${max}" style="width:100%">
   </div>`;

  menu.querySelectorAll('.slicer-opt').forEach(o => o.addEventListener('click', () => {
    S.filters.dt = { from: o.dataset.a || null, to: o.dataset.b || null };
    renderDateMenu(menu); refresh();
  }));
  const upd = () => {
    S.filters.dt = { from: menu.querySelector('#dt-from').value || null, to: menu.querySelector('#dt-to').value || null };
    refresh();
  };
  menu.querySelector('#dt-from').addEventListener('change', upd);
  menu.querySelector('#dt-to').addEventListener('change', upd);
}
function syncSlicerButtons() {
  document.querySelectorAll('.slicer').forEach(sl => {
    const dim = sl.dataset.dim, btn = sl.querySelector('.slicer-btn');
    const names = { c:'País', city:'Ciudad', r:'Desenlace', ct:'Vehículo', dt:'Fechas' };
    if (dim === 'dt') {
      const f = S.filters.dt, on = !!(f.from || f.to);
      btn.classList.toggle('active', on);
      btn.innerHTML = on
        ? `${dmyShort(f.from || S.dates[0])}-${dmyShort(f.to || S.dates[S.dates.length-1])} <span class="caret">▼</span>`
        : `Fechas <span class="caret">▼</span>`;
      return;
    }
    const sel = S.filters[dim];
    btn.classList.toggle('active', sel.size > 0);
    btn.innerHTML = sel.size === 0 ? `${names[dim]} <span class="caret">▼</span>`
      : sel.size === 1 ? `${esc(dimLabel(dim, [...sel][0]))} <span class="caret">▼</span>`
      : `${names[dim]} <span class="count">${sel.size}</span> <span class="caret">▼</span>`;
  });

  const parts = [];
  if (S.filters.c.size)    parts.push(`${S.filters.c.size} país(es)`);
  if (S.filters.city.size) parts.push(`${S.filters.city.size} ciudad(es)`);
  if (S.filters.r.size)    parts.push(`${S.filters.r.size} desenlace(s)`);
  if (S.filters.ct.size)   parts.push(`${S.filters.ct.size} tipo(s) de vehículo`);
  if (S.filters.dt.from || S.filters.dt.to) parts.push('rango de fechas');
  const banner = document.getElementById('filter-banner');
  banner.classList.toggle('show', parts.length > 0);
  banner.innerHTML = parts.length
    ? `Vista filtrada por ${parts.join(', ')}: <b>${n(S.view.length)}</b> de ${n(S.trips.length)} viajes`
    : '';
}

// ---------------------------------------------------------------------------
// Métricas compartidas
// ---------------------------------------------------------------------------
function metrics(rows) {
  const bill = rows.filter(billed);
  const done = rows.filter(t => t.r === 'drop_off');
  return {
    trips: rows.length,
    billed: bill.length,
    revenue: sum(bill, t => t.p),
    avgTicket: mean(bill, t => t.p),
    medTicket: median(bill.map(t => t.p)),
    completion: rows.length ? 100 * done.length / rows.length : null,
    avgEff: mean(rows.filter(t => t.eff != null), t => t.eff),
    avgWait: mean(rows.filter(t => t.wait != null), t => t.wait),
    users: new Set(rows.map(t => t.u)).size,
    drivers: new Set(rows.map(t => t.d).filter(Boolean)).size,
    countries: new Set(rows.map(t => t.c).filter(Boolean)).size,
    cities: new Set(rows.map(t => t.city)).size,
    avgKm: mean(rows.filter(t => t.km != null), t => t.km),
    revPerMin: (() => { const m = sum(bill, t => t.eff || 0); return m > 0 ? sum(bill, t => t.p) / m : null; })(),
  };
}
function byDay(rows) {
  const g = groupBy(rows, t => t.dt);
  return S.dates.map(d => {
    const r = g.get(d) || [];
    return { date: d, trips: r.length, revenue: sum(r.filter(billed), t => t.p) };
  });
}

// ---------------------------------------------------------------------------
// PÁGINA · Resumen ejecutivo
// ---------------------------------------------------------------------------
function pageOverview() {
  const rows = S.view, m = metrics(rows), daily = byDay(rows);

  // El titular se adapta al ámbito filtrado: hablar de «siete países» con un
  // solo mercado seleccionado sería describir algo que ya no está en pantalla.
  const days = new Set(rows.map(t => t.dt)).size;
  const WEEKS = ['', 'Una semana', 'Dos semanas', 'Tres semanas', 'Cuatro semanas',
                 'Cinco semanas', 'Seis semanas', 'Siete semanas', 'Ocho semanas'];
  const w = Math.max(1, Math.round(days / 7));
  const span = WEEKS[w] || `${w} semanas`;
  const NUM = ['cero','un','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez'];
  const scope = m.countries === 1 ? `en ${cname(rows[0]?.c)}`
              : m.countries ? `en ${NUM[m.countries] || m.countries} países` : '';
  document.getElementById('ov-title').textContent =
    m.trips ? `${span} de operación ${scope}`.trim() : 'Sin viajes para los filtros aplicados';

  document.getElementById('ov-lede').innerHTML =
    `Entre el <b>${dmy(S.dates[0])}</b> y el <b>${dmy(S.dates[S.dates.length-1])}</b> el sistema registró
     <b>${n(m.trips)}</b> viajes de <b>${n(m.users)}</b> ${m.users === 1 ? 'usuario' : 'usuarios'}
     en <b>${m.countries}</b> ${m.countries === 1 ? 'mercado' : 'mercados'}.
     De ellos, <b>${n(m.billed)}</b> llegaron a facturarse, por un total de <b>${eur(m.revenue)}</b>.
     Todo lo que sigue responde a los filtros de la barra superior.`;

  document.getElementById('ov-kpis').innerHTML = [
    kpi({ label:'Viajes registrados', value:n(m.trips), foot:`<span class="pill">${n(m.billed)} facturados</span>`, spark:'sp-trips' }),
    kpi({ label:'Ingresos', value:n(m.revenue), unit:'€', foot:`Ticket medio ${eur2(m.avgTicket)}`, spark:'sp-rev' }),
    kpi({ label:'Tasa de finalización', value:pct(m.completion), foot:'Viajes que acaban en destino',
          hint:'Porcentaje de viajes cuyo motivo de cierre es drop_off' }),
    kpi({ label:'Espera media', value:n1(m.avgWait), unit:'min', foot:`Trayecto ${n1(m.avgEff)} min`,
          hint:'Derivada de las diferencias entre eventos, no medida directamente' }),
    kpi({ label:'Cobertura', value:`${m.countries}`, unit:`países`, foot:`${n(m.cities)} áreas urbanas · ${n(m.drivers)} conductores` }),
  ].join('');

  const spark = (id, vals, color) => plot(id,
    [{ x: daily.map(d => d.date), y: vals, type:'scatter', mode:'lines', line:{ color, width:2, shape:'linear' },
       fill:'tozeroy', fillcolor: alpha(color, .16), hoverinfo:'skip' }],
    { margin:{l:0,r:0,t:2,b:0}, xaxis:{ visible:false }, yaxis:{ visible:false } });
  spark('sp-trips', daily.map(d => d.trips), css('--series-1'));
  spark('sp-rev',   daily.map(d => d.revenue), css('--series-3'));

  plot('ov-trips-day', [{
    x: daily.map(d => d.date), y: daily.map(d => d.trips), type:'bar',
    marker:{ color: css('--series-1'), line:{ width:1.5, color: css('--surface-1') } },
    hovertemplate:'%{x|%d %b}<br><b>%{y} viajes</b><extra></extra>',
  }], { margin:{l:40,r:10,t:8,b:36}, xaxis:{ type:'date', tickformat:'%d %b' }, yaxis:{ title:{ text:'viajes', font:{size:11} } } });

  plot('ov-rev-day', [{
    x: daily.map(d => d.date), y: daily.map(d => d.revenue), type:'scatter', mode:'lines',
    line:{ color: css('--series-3'), width:2, shape:'linear' }, fill:'tozeroy', fillcolor: alpha(css('--series-3'), .14),
    hovertemplate:'%{x|%d %b}<br><b>%{y:,.0f} €</b><extra></extra>',
  }], { margin:{l:52,r:10,t:8,b:36}, xaxis:{ type:'date', tickformat:'%d %b' }, yaxis:{ ticksuffix:' €' } });

  // — País: dos medidas indexadas a su propio total (evita el doble eje)
  const gc = [...groupBy(rows, t => t.c ?? '__null')]
    .map(([k, v]) => ({ k, trips: v.length, rev: sum(v.filter(billed), t => t.p) }))
    .sort((a, b) => b.rev - a.rev);
  const totT = sum(gc, x => x.trips) || 1, totR = sum(gc, x => x.rev) || 1;
  plot('ov-country', [
    { y: gc.map(x => cflag(x.k === '__null' ? null : x.k)), x: gc.map(x => 100*x.trips/totT), name:'% de viajes',
      type:'bar', orientation:'h', marker:{ color: css('--series-1') },
      hovertemplate:'%{y}<br>%{x:.1f} % de los viajes<extra></extra>' },
    { y: gc.map(x => cflag(x.k === '__null' ? null : x.k)), x: gc.map(x => 100*x.rev/totR), name:'% de ingresos',
      type:'bar', orientation:'h', marker:{ color: css('--series-3') },
      hovertemplate:'%{y}<br>%{x:.1f} % de los ingresos<extra></extra>' },
  ], { barmode:'group', showlegend:true, margin:{l:110,r:16,t:26,b:34},
       legend:{ orientation:'h', y:1.12, x:0, font:{ size:11.5 } },
       xaxis:{ ticksuffix:' %' }, yaxis:{ autorange:'reversed' }, bargap:.32, bargroupgap:.12 });

  const gcity = [...groupBy(rows, t => t.city)]
    .map(([k, v]) => ({ k, trips: v.length, rev: sum(v.filter(billed), t => t.p), c: v[0].c }))
    .sort((a, b) => b.trips - a.trips).slice(0, 10);
  const maxCity = Math.max(...gcity.map(x => x.trips), 1);
  table('ov-cities', [
    { h:'#', f:(_,i) => `<span class="rank">${i+1}</span>`, cls:'rank' },
    { h:'Área urbana', f:r => `${cdot(r.c)}${esc(r.k)}` },
    { h:'Viajes', num:true, f:r => barCell(r.trips, maxCity, n(r.trips)) },
    { h:'Ingresos', num:true, f:r => eur(r.rev) },
  ], gcity);

  // Narrativa
  const top = gc[0], topT = [...gc].sort((a,b) => b.trips - a.trips)[0];
  const peak = daily.reduce((a, b) => b.trips > a.trips ? b : a, daily[0] || { trips:0 });
  setInsight('ov-insight-time',
    daily.length ? `El pico de actividad se registró el <b>${dmy(peak.date)}</b> con <b>${n(peak.trips)}</b> viajes.
      La serie es corta (<b>${daily.filter(d => d.trips > 0).length} días con actividad</b>) y con un panel de
      usuarios cerrado, así que las oscilaciones diarias reflejan más el comportamiento de una muestra pequeña
      que un ciclo de mercado. Cualquier lectura de tendencia sobre este periodo sería prematura.`
      : 'Sin datos en el rango seleccionado.');
  setInsight('ov-insight-geo', top ?
    `<b>${cname(topT.k)}</b> aporta el <b>${pct(100*topT.trips/totT)}</b> de los viajes, pero
     <b>${cname(top.k)}</b> se lleva el <b>${pct(100*top.rev/totR)}</b> de los ingresos.
     ${top.k !== topT.k
       ? `Esa divergencia es la señal más útil de esta página: el mercado que más mueve no es el que más factura,
          y el ticket medio de ${cname(top.k)} (${eur2(top.rev/Math.max(1,top.trips))}) frente al de
          ${cname(topT.k)} (${eur2(topT.rev/Math.max(1,topT.trips))}) explica por qué.`
       : `Volumen e ingresos apuntan al mismo mercado, así que el reparto de caja sigue de cerca al de demanda.`}`
    : 'Sin datos.');

  const rowsT = gc.map(x => {
    const v = rows.filter(t => (t.c ?? '__null') === x.k);
    return { ...x, ...metrics(v) };
  });
  table('ov-table', [
    { h:'Mercado', f:r => cbadge(r.k === '__null' ? null : r.k) },
    { h:'Viajes', num:true, f:r => n(r.trips) },
    { h:'Facturados', num:true, f:r => n(r.billed) },
    { h:'Finalización', num:true, f:r => pct(r.completion) },
    { h:'Ingresos', num:true, f:r => eur(r.revenue) },
    { h:'Ticket medio', num:true, f:r => eur2(r.avgTicket) },
    { h:'Ticket mediano', num:true, f:r => eur2(r.medTicket) },
    { h:'Trayecto (min)', num:true, f:r => n1(r.avgEff) },
    { h:'Espera (min)', num:true, f:r => n1(r.avgWait) },
    { h:'€/min', num:true, f:r => n2(r.revPerMin) },
    { h:'Usuarios', num:true, f:r => n(r.users) },
  ], rowsT);
}

// ---------------------------------------------------------------------------
// PÁGINA · Ingresos y precio
// ---------------------------------------------------------------------------
function pageRevenue() {
  const rows = S.view, bill = rows.filter(billed), m = metrics(rows);

  document.getElementById('rv-kpis').innerHTML = [
    kpi({ label:'Ingresos totales', value:n(m.revenue), unit:'€', foot:`sobre ${n(m.billed)} viajes facturados` }),
    kpi({ label:'Ticket medio', value:n2(m.avgTicket), unit:'€', foot:`Mediana ${eur2(m.medTicket)}` }),
    kpi({ label:'Ingreso por minuto', value:n2(m.revPerMin), unit:'€/min', foot:'sobre el tiempo efectivo de trayecto' }),
    kpi({ label:'Ingreso por kilómetro', value:n2((() => {
            const k = sum(bill, t => t.km || 0); return k > 0 ? sum(bill, t => t.p) / k : null; })()),
          unit:'€/km', foot:'distancia en línea recta',
          hint:'La distancia es geodésica, no por carretera: el valor real por km recorrido será menor.' }),
  ].join('');

  const countries = [...groupBy(bill, t => t.c ?? '__null')]
    .map(([k, v]) => ({ k, v })).sort((a, b) => b.v.length - a.v.length);

  // Antes / después de normalizar
  if (!countries.length) { ['rv-box-local','rv-box-eur','rv-revenue-country','rv-ticket-country','rv-scatter','rv-rpm','rv-hist'].forEach(i => emptyBox(i)); table('rv-table', [{h:'',f:()=>''}], []); return; }

  plot('rv-box-local', countries.map((c, i) => ({
    y: c.v.map(t => t.pl).filter(x => x != null), name: cname(c.k === '__null' ? null : c.k),
    type:'box', boxpoints:false, marker:{ color: series(i) }, line:{ width:1.6 },
    fillcolor: alpha(series(i), .22),
    hovertemplate:`${cname(c.k)} (${c.v[0].cur || '-'})<br>mediana %{median:,.0f}<extra></extra>`,
  })), { yaxis:{ type:'log', title:{ text:'unidades de divisa local (log)', font:{size:11} } },
         xaxis:{ tickangle:-25 }, margin:{ l:66, r:10, t:10, b:66 } });

  plot('rv-box-eur', countries.map((c, i) => ({
    y: c.v.map(t => t.p), name: cname(c.k === '__null' ? null : c.k),
    type:'box', boxpoints:false, marker:{ color: series(i) }, line:{ width:1.6 },
    fillcolor: alpha(series(i), .22),
    hovertemplate:`${cname(c.k)}<br>mediana %{median:.2f} €<extra></extra>`,
  })), { yaxis:{ ticksuffix:' €' }, xaxis:{ tickangle:-25 }, margin:{ l:56, r:10, t:10, b:66 } });

  const spreads = countries.map(c => ({ k:c.k, med: median(c.v.map(t => t.pl)) })).filter(x => x.med);
  const hi = spreads.reduce((a,b) => b.med > a.med ? b : a, spreads[0] || {});
  const lo = spreads.reduce((a,b) => b.med < a.med ? b : a, spreads[0] || {});
  setInsight('rv-insight-fx', spreads.length > 1
    ? `En divisa local la mediana va de <b>${n(lo.med)}</b> unidades en ${cname(lo.k)} a <b>${n(hi.med)}</b> en
       ${cname(hi.k)}: una diferencia de <b>${n1(hi.med/lo.med)}×</b> que no dice nada sobre el precio real,
       solo sobre la denominación de cada moneda. Convertidos a euros las medianas se comprimen a un rango
       de <b>${eur2(Math.min(...countries.map(c => median(c.v.map(t => t.p)))))}</b> a <b>${eur2(Math.max(...countries.map(c => median(c.v.map(t => t.p)))))}</b>,
       que ya es una comparación honesta. Este es el motivo de que la conversión de divisa esté en el modelo
       y no en el informe.`
    : 'Selecciona más de un mercado para comparar divisas.');

  const revC = countries.map((c, i) => ({ k:c.k, rev: sum(c.v, t => t.p), avg: mean(c.v, t => t.p),
                                          med: median(c.v.map(t => t.p)), n: c.v.length, i }))
                        .sort((a, b) => b.rev - a.rev);
  plot('rv-revenue-country', [{
    x: revC.map(r => cname(r.k === '__null' ? null : r.k)), y: revC.map(r => r.rev), type:'bar',
    marker:{ color: revC.map(r => series(r.i)), line:{ width:1.5, color: css('--surface-1') } },
    text: revC.map(r => eur(r.rev)), textposition:'outside', textfont:{ color: css('--text-secondary'), size:11 },
    cliponaxis:false,
    hovertemplate:'%{x}<br><b>%{y:,.0f} €</b><extra></extra>',
  }], { yaxis:{ ticksuffix:' €' }, xaxis:{ tickangle:-25 }, margin:{ l:60, r:12, t:24, b:66 } });

  plot('rv-ticket-country', [
    { x: revC.map(r => cname(r.k)), y: revC.map(r => r.avg), name:'Media', type:'bar',
      marker:{ color: css('--series-1'), line:{ width:1.5, color: css('--surface-1') } },
      hovertemplate:'%{x}<br>media %{y:.2f} €<extra></extra>' },
    { x: revC.map(r => cname(r.k)), y: revC.map(r => r.med), name:'Mediana', type:'bar',
      marker:{ color: css('--series-5'), line:{ width:1.5, color: css('--surface-1') } },
      hovertemplate:'%{x}<br>mediana %{y:.2f} €<extra></extra>' },
  ], { barmode:'group', showlegend:true, legend:{ orientation:'h', y:1.14, x:0, font:{size:11.5} },
       yaxis:{ ticksuffix:' €' }, xaxis:{ tickangle:-25 }, margin:{ l:56, r:12, t:28, b:66 }, bargroupgap:.1 });

  // Scatter: máximo 3 series simultáneas (regla all-pairs de la paleta)
  const top3 = revC.slice(0, 3).map(r => r.k);
  const groupsS = top3.map((k, i) => ({ k, i, v: bill.filter(t => (t.c ?? '__null') === k) }));
  const rest = bill.filter(t => !top3.includes(t.c ?? '__null'));
  const traces = groupsS.map(g => ({
    x: g.v.map(t => t.eff), y: g.v.map(t => t.p), name: cname(g.k === '__null' ? null : g.k),
    type:'scatter', mode:'markers',
    marker:{ size:7, color: alpha(series(g.i), .62), line:{ width:1, color: css('--surface-1') } },
    hovertemplate:`${cname(g.k)}<br>%{x:.1f} min · %{y:.2f} €<extra></extra>`,
  }));
  if (rest.length) traces.push({
    x: rest.map(t => t.eff), y: rest.map(t => t.p), name:'Otros mercados', type:'scatter', mode:'markers',
    marker:{ size:6, color: alpha(css('--text-muted'), .45), line:{ width:1, color: css('--surface-1') } },
    hovertemplate:'Otros<br>%{x:.1f} min · %{y:.2f} €<extra></extra>',
  });
  const effMax = quantile(bill.map(t => t.eff), .98) || 60;
  const pMax   = quantile(bill.map(t => t.p), .99) || 30;
  plot('rv-scatter', traces, { showlegend:true, legend:{ orientation:'h', y:1.12, x:0, font:{size:11.5} },
    xaxis:{ title:{ text:'duración efectiva (min)', font:{size:11} }, range:[0, effMax*1.05] },
    yaxis:{ ticksuffix:' €', range:[0, pMax*1.05] }, margin:{ l:56, r:12, t:28, b:44 } });

  const rpm = revC.map(r => {
    const v = bill.filter(t => (t.c ?? '__null') === r.k);
    const mins = sum(v, t => t.eff || 0), km = sum(v, t => t.km || 0);
    return { ...r, rpm: mins > 0 ? r.rev / mins : null, rpk: km > 0 ? r.rev / km : null };
  }).sort((a,b) => (b.rpm||0) - (a.rpm||0));
  plot('rv-rpm', [{
    y: rpm.map(r => cname(r.k === '__null' ? null : r.k)), x: rpm.map(r => r.rpm),
    type:'bar', orientation:'h', marker:{ color: rpm.map(r => seqColor(0.3 + 0.65 * (r.rpm / Math.max(...rpm.map(z => z.rpm || 0), 1)))),
                                          line:{ width:1.5, color: css('--surface-1') } },
    text: rpm.map(r => n2(r.rpm) + ' €/min'), textposition:'outside',
    textfont:{ color: css('--text-secondary'), size:11 }, cliponaxis:false,
    hovertemplate:'%{y}<br><b>%{x:.2f} €/min</b><extra></extra>',
  }], { xaxis:{ ticksuffix:' €' }, yaxis:{ autorange:'reversed' }, margin:{ l:96, r:60, t:12, b:36 } });

  const best = rpm[0];
  setInsight('rv-insight-price', best
    ? `El ingreso por minuto separa mejor los mercados que el ticket: <b>${cname(best.k)}</b> factura
       <b>${n2(best.rpm)} €</b> por minuto de trayecto, frente a <b>${n2(rpm[rpm.length-1].rpm)} €</b> del
       último de la lista. La nube de puntos muestra por qué: el precio crece con la duración, pero con una
       dispersión amplia: hay viajes largos y baratos y viajes cortos y caros, lo que sugiere que la tarifa
       combina tiempo, distancia y suplementos que este dataset no desglosa.`
    : 'Sin datos.');

  const pcut = quantile(bill.map(t => t.p), .99) || 50;
  plot('rv-hist', [{
    x: bill.map(t => t.p).filter(v => v <= pcut), type:'histogram', nbinsx:34,
    marker:{ color: css('--series-1'), line:{ width:1.5, color: css('--surface-1') } },
    hovertemplate:'%{x} €<br><b>%{y} viajes</b><extra></extra>',
  }], { xaxis:{ ticksuffix:' €', title:{ text:'precio del viaje (EUR)', font:{size:11} } },
        yaxis:{ title:{ text:'viajes', font:{size:11} } }, margin:{ l:52, r:12, t:10, b:44 }, bargap:.06 });

  table('rv-table', [
    { h:'Mercado', f:r => cbadge(r.k === '__null' ? null : r.k) },
    { h:'n', num:true, f:r => n(r.n) },
    { h:'Media', num:true, f:r => n2(r.avg) },
    { h:'Mediana', num:true, f:r => n2(r.med) },
    { h:'P25', num:true, f:r => n2(quantile(bill.filter(t => (t.c ?? '__null') === r.k).map(t => t.p), .25)) },
    { h:'P75', num:true, f:r => n2(quantile(bill.filter(t => (t.c ?? '__null') === r.k).map(t => t.p), .75)) },
    { h:'€/min', num:true, f:r => n2(rpm.find(x => x.k === r.k)?.rpm) },
  ], revC);
}

// ---------------------------------------------------------------------------
// PÁGINA · Demanda y horarios
// ---------------------------------------------------------------------------
function pageDemand() {
  const rows = S.view, m = metrics(rows);
  const byHour = Array.from({ length: 24 }, (_, h) => rows.filter(t => t.h === h));
  const peakH  = byHour.reduce((a, v, i) => v.length > a.n ? { h:i, n:v.length } : a, { h:0, n:0 });
  const nightShare = 100 * sum(byHour.slice(0, 6), a => a.length) / Math.max(1, rows.length);
  const wkndShare  = 100 * rows.filter(t => t.wd >= 6).length / Math.max(1, rows.length);

  document.getElementById('dm-kpis').innerHTML = [
    kpi({ label:'Hora punta', value:`${String(peakH.h).padStart(2,'0')}:00`, foot:`${n(peakH.n)} viajes · ${pct(100*peakH.n/Math.max(1,rows.length))} del total` }),
    kpi({ label:'Demanda nocturna', value:pct(nightShare), foot:'entre las 00:00 y las 06:00' }),
    kpi({ label:'Peso del fin de semana', value:pct(wkndShare), foot:'sábados y domingos' }),
    kpi({ label:'Espera media', value:n1(m.avgWait), unit:'min', foot:`vs. ${n1(m.avgEff)} min de trayecto` }),
  ].join('');

  document.getElementById('dm-hm-sub').textContent =
    `${n(rows.length)} viajes · hora local del usuario, ya corregida desde UTC`;
  document.getElementById('dm-ramp').innerHTML =
    Array.from({ length: 12 }, (_, i) => `<i style="background:${seqColor(0.12 + i/11*0.88)}"></i>`).join('');

  const hmRows = [1,2,3,4,5,6,7].map(wd => ({
    label: WDS[wd], wd,
    values: Array.from({ length: 24 }, (_, h) => rows.filter(t => t.wd === wd && t.h === h).length),
  }));
  heatGrid('dm-heatmap', hmRows, {
    cols: Array.from({ length: 24 }, (_, i) => i),
    colLabel: h => h % 3 === 0 ? String(h).padStart(2,'0') : '',
    tip: (r, h, v) => `<b>${WD[r.wd]} · ${String(h).padStart(2,'0')}:00</b><br>${n(v)} viaje${v === 1 ? '' : 's'}`,
  });

  // Ventana de 3h más intensa
  let bestWin = { start:0, n:-1 };
  for (let h = 0; h < 24; h++) {
    const tot = [0,1,2].reduce((s, k) => s + byHour[(h+k) % 24].length, 0);
    if (tot > bestWin.n) bestWin = { start:h, n:tot };
  }
  setInsight('dm-insight-hm', rows.length
    ? `La franja más intensa es <b>${String(bestWin.start).padStart(2,'0')}:00-${String((bestWin.start+3)%24).padStart(2,'0')}:00</b>,
       que concentra el <b>${pct(100*bestWin.n/rows.length)}</b> de la demanda en solo el 12,5 % de las horas del día.
       El fin de semana aporta el <b>${pct(wkndShare)}</b> del volumen frente al 28,6 % que le correspondería
       por reparto uniforme, así que ${wkndShare > 28.6 ? 'la demanda se inclina hacia el ocio de fin de semana' : 'el uso es predominantemente laboral, entre semana'}.
       Este patrón solo es legible porque las marcas de tiempo se localizaron antes de extraer la hora.`
    : 'Sin datos.');

  plot('dm-hour', [{
    x: Array.from({ length: 24 }, (_, i) => i), y: byHour.map(a => a.length), type:'bar',
    marker:{ color: byHour.map(a => seqColor(0.2 + 0.8 * a.length / Math.max(...byHour.map(z => z.length), 1))),
             line:{ width:1.5, color: css('--surface-1') } },
    hovertemplate:'%{x}:00<br><b>%{y} viajes</b><extra></extra>',
  }], { xaxis:{ dtick:2, title:{ text:'hora local', font:{size:11} } }, yaxis:{ title:{ text:'viajes', font:{size:11} } },
        margin:{ l:48, r:12, t:10, b:42 } });

  const wdCounts = [1,2,3,4,5,6,7].map(wd => rows.filter(t => t.wd === wd).length);
  plot('dm-weekday', [{
    x: [1,2,3,4,5,6,7].map(w => WD[w]), y: wdCounts, type:'bar',
    marker:{ color: [1,2,3,4,5,6,7].map(w => w >= 6 ? css('--series-5') : css('--series-1')),
             line:{ width:1.5, color: css('--surface-1') } },
    text: wdCounts.map(v => n(v)), textposition:'outside', cliponaxis:false,
    textfont:{ color: css('--text-secondary'), size:11 },
    hovertemplate:'%{x}<br><b>%{y} viajes</b><extra></extra>',
  }], { xaxis:{ tickangle:-25 }, yaxis:{ title:{ text:'viajes', font:{size:11} } }, margin:{ l:48, r:12, t:20, b:60 } });

  const waitH = byHour.map(a => mean(a.filter(t => t.wait != null), t => t.wait));
  const effH  = byHour.map(a => mean(a.filter(t => t.eff  != null), t => t.eff));
  plot('dm-times', [
    { x:Array.from({length:24},(_,i)=>i), y: effH, name:'Trayecto efectivo', type:'scatter', mode:'lines',
      line:{ color: css('--series-3'), width:2, shape:'linear' },
      hovertemplate:'%{x}:00<br>trayecto %{y:.1f} min<extra></extra>' },
    { x:Array.from({length:24},(_,i)=>i), y: waitH, name:'Espera', type:'scatter', mode:'lines',
      line:{ color: css('--series-2'), width:2, shape:'linear' },
      hovertemplate:'%{x}:00<br>espera %{y:.1f} min<extra></extra>' },
  ], { showlegend:true, legend:{ orientation:'h', y:1.13, x:0, font:{size:11.5} }, hovermode:'x unified',
       xaxis:{ dtick:2, title:{ text:'hora local', font:{size:11} } },
       yaxis:{ ticksuffix:' min' }, margin:{ l:56, r:12, t:28, b:42 } });

  const buckets = [['<5 min',0,5],['5-10 min',5,10],['10-20 min',10,20],['20-40 min',20,40],['40+ min',40,Infinity]];
  const bvals = buckets.map(([, a, b]) => rows.filter(t => t.eff != null && t.eff >= a && t.eff < b).length);
  plot('dm-duration', [{
    x: buckets.map(b => b[0]), y: bvals, type:'bar',
    marker:{ color: buckets.map((_, i) => seqColor(0.25 + i/(buckets.length-1)*0.65)),
             line:{ width:1.5, color: css('--surface-1') } },
    text: bvals.map(v => n(v)), textposition:'outside', cliponaxis:false,
    textfont:{ color: css('--text-secondary'), size:11 },
    hovertemplate:'%{x}<br><b>%{y} viajes</b><extra></extra>',
  }], { yaxis:{ title:{ text:'viajes', font:{size:11} } }, margin:{ l:48, r:12, t:20, b:42 } });

  const wIdx = waitH.map((w, i) => ({ h:i, w })).filter(x => x.w != null);
  const worst = wIdx.reduce((a, b) => b.w > a.w ? b : a, wIdx[0] || { h:0, w:0 });
  setInsight('dm-insight-times', wIdx.length
    ? `La espera media es de <b>${n1(m.avgWait)} min</b> frente a <b>${n1(m.avgEff)} min</b> de trayecto:
       el usuario pasa <b>${n1(100*m.avgWait/Math.max(0.01, m.avgWait+m.avgEff))} %</b> del ciclo esperando.
       El peor momento son las <b>${String(worst.h).padStart(2,'0')}:00</b>, con ${n1(worst.w)} min de espera media.
       Conviene recordar que estos tiempos se derivan de las diferencias entre eventos del sistema, así que
       sirven para comparar franjas entre sí, no como medición absoluta.`
    : 'Sin datos.');

  const cs = [...new Set(rows.map(t => t.c).filter(Boolean))]
    .map(c => ({ c, v: rows.filter(t => t.c === c) }))
    .sort((a, b) => b.v.length - a.v.length);
  heatGrid('dm-country-hours', cs.map(({ c, v }) => {
    const counts = Array.from({ length: 24 }, (_, h) => v.filter(t => t.h === h).length);
    const tot = Math.max(1, v.length);
    return { label: c, country: c, counts, total: tot, values: counts.map(x => 100 * x / tot) };
  }), {
    cols: Array.from({ length: 24 }, (_, i) => i), labelWidth: 40,
    colLabel: h => h % 3 === 0 ? String(h).padStart(2,'0') : '',
    tip: (r, h, v) => `<b>${cname(r.country)} · ${String(h).padStart(2,'0')}:00</b><br>${n1(v)} % de su demanda<br>${n(r.counts[h])} viajes`,
  });
}

// ---------------------------------------------------------------------------
// PÁGINA · Mapa y rutas
// ---------------------------------------------------------------------------
const rk = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

function routeAgg(rows, dec = 2) {
  const m = new Map();
  for (const t of rows) {
    if (t.slat == null || t.elat == null) continue;
    const k = `${rk(t.slat,dec)},${rk(t.slon,dec)}|${rk(t.elat,dec)},${rk(t.elon,dec)}`;
    if (!m.has(k)) m.set(k, { slat:rk(t.slat,dec), slon:rk(t.slon,dec), elat:rk(t.elat,dec), elon:rk(t.elon,dec),
                              n:0, rev:0, eff:[], wait:[], km:[], city:t.city, cityEnd:t.city_end, c:t.c });
    const r = m.get(k);
    r.n++; if (t.p != null) r.rev += t.p;
    if (t.eff != null) r.eff.push(t.eff);
    if (t.wait != null) r.wait.push(t.wait);
    if (t.km != null) r.km.push(t.km);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}
function pointAgg(rows, which, dec = 3) {
  const m = new Map();
  for (const t of rows) {
    const lat = which === 'start' ? t.slat : t.elat, lon = which === 'start' ? t.slon : t.elon;
    if (lat == null) continue;
    const k = `${rk(lat,dec)},${rk(lon,dec)}`;
    if (!m.has(k)) m.set(k, { lat:rk(lat,dec), lon:rk(lon,dec), n:0, city: which === 'start' ? t.city : t.city_end, c:t.c });
    m.get(k).n++;
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}
// Cartografia base: Esri Gray Canvas. Sustituye a CARTO, que desde 2024 estampa
// una marca de agua «API KEY REQUIRED» sobre cada tesela servida sin credencial.
// Esri sirve las teselas sin clave y tiene variante clara y oscura nativas, asi
// que el mapa base no necesita ningun filtro CSS para acompanar al tema.
//
// El lienzo va sin rotulos y los topónimos llegan en una capa aparte: asi el
// unico color saturado del mapa es el del dato.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
function tileUrl() {
  return isDark()
    ? `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`
    : `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
}
function labelUrl() {
  return isDark()
    ? `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`
    : `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
}
// Rampa del mapa de calor: verde (poco transitado) a rojo (con trafico).
function heatGradient() {
  return { 0.15: css('--heat-0'), 0.40: css('--heat-1'), 0.62: css('--heat-2'),
           0.82: css('--heat-3'), 1.00: css('--heat-4') };
}
function ensureMap(id) {
  if (S.maps[id]) return S.maps[id];
  const map = L.map(id, { scrollWheelZoom:true, zoomControl:true, attributionControl:true, worldCopyJump:true })
               .setView([10, -40], 2);
  const tileOpts = { attribution:'Esri, HERE, Garmin, © OpenStreetMap', maxZoom:19, maxNativeZoom:16 };
  const tiles  = L.tileLayer(tileUrl(),  tileOpts).addTo(map);
  const labels = L.tileLayer(labelUrl(), { ...tileOpts, pane:'shadowPane' }).addTo(map);
  const groups = { routes:L.layerGroup().addTo(map), pickup:L.layerGroup().addTo(map),
                   dropoff:L.layerGroup().addTo(map), heat:L.layerGroup().addTo(map) };
  S.maps[id] = { map, tiles, labels, groups };
  return S.maps[id];
}

function pageGeo() {
  const rows = S.view.filter(t => t.slat != null);

  // Selector de ámbito
  const sel = document.getElementById('geo-scope');
  const countries = [...groupBy(rows, t => t.c ?? '__null')].sort((a,b) => b[1].length - a[1].length);
  const cities = [...groupBy(rows, t => t.city)].filter(([, v]) => v.length >= 5).sort((a,b) => b[1].length - a[1].length);
  const prev = S.geo.scope;
  sel.innerHTML =
    `<option value="ALL">Vista global, ${n(rows.length)} viajes</option>` +
    `<optgroup label="Países">${countries.map(([k, v]) => `<option value="C:${esc(k)}">${cflag(k === '__null' ? null : k)}, ${n(v.length)}</option>`).join('')}</optgroup>` +
    `<optgroup label="Áreas urbanas">${cities.map(([k, v]) => `<option value="T:${esc(k)}">${esc(k)}, ${n(v.length)}</option>`).join('')}</optgroup>`;
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : 'ALL';
  S.geo.scope = sel.value;

  drawGeo();
}

function scopedRows() {
  const rows = S.view.filter(t => t.slat != null);
  const sc = S.geo.scope;
  if (sc === 'ALL') return rows;
  if (sc.startsWith('C:')) { const k = sc.slice(2); return rows.filter(t => (t.c ?? '__null') === k); }
  return rows.filter(t => t.city === sc.slice(2));
}

function drawGeo() {
  const rows = scopedRows();
  const { map, groups } = ensureMap('geo-map');
  Object.values(groups).forEach(g => g.clearLayers());

  const global = S.geo.scope === 'ALL';
  const dec = global ? 1 : 2;
  const routes = routeAgg(rows, global ? 1 : 2).slice(0, S.geo.topn);
  const pick = pointAgg(rows, 'start', global ? 2 : 3);
  const drop = pointAgg(rows, 'end',   global ? 2 : 3);
  const maxR = Math.max(...routes.map(r => r.n), 1);

  document.getElementById('geo-caption').textContent =
    `${n(rows.length)} viajes · ${n(routeAgg(rows, global ? 1 : 2).length)} corredores distintos`;

  if (S.geo.layers.routes) {
    routes.forEach(r => {
      const t = Math.sqrt(r.n / maxR);
      L.polyline([[r.slat, r.slon], [r.elat, r.elon]], {
        color: seqColor(0.45 + t * 0.5), weight: 2 + t * 7, opacity: 0.65 + t * 0.3, lineCap:'round',
      }).bindTooltip(
        `<b>${esc(r.city)} → ${esc(r.cityEnd)}</b><br>${n(r.n)} viajes<br>` +
        `${r.km.length ? n1(mean(r.km)) + ' km · ' : ''}${r.eff.length ? n1(mean(r.eff)) + ' min' : ''}` +
        `${r.rev ? `<br>${eur(r.rev)} facturados` : ''}`, { sticky:true }
      ).addTo(groups.routes);
    });
  }
  // Recogida y dejada caen a menudo sobre el mismo punto, así que además del
  // color se distinguen por la forma: disco relleno vs. anillo hueco.
  const maxP = Math.max(...pick.map(p => p.n), 1), maxD = Math.max(...drop.map(p => p.n), 1);
  if (S.geo.layers.dropoff) {
    drop.slice(0, 900).forEach(p => L.circleMarker([p.lat, p.lon], {
      radius: 3.5 + 7 * Math.sqrt(p.n / maxD), color: css('--series-2'), weight: 2.2,
      fillColor: css('--series-2'), fillOpacity: .10, opacity: .95,
    }).bindTooltip(`<b>Dejadas</b><br>${esc(p.city)}<br>${n(p.n)} viajes`, { sticky:true }).addTo(groups.dropoff));
  }
  if (S.geo.layers.pickup) {
    pick.slice(0, 900).forEach(p => L.circleMarker([p.lat, p.lon], {
      radius: 2.5 + 6 * Math.sqrt(p.n / maxP), color: css('--surface-1'), weight: 1,
      fillColor: css('--series-3'), fillOpacity: .9,
    }).bindTooltip(`<b>Recogidas</b><br>${esc(p.city)}<br>${n(p.n)} viajes`, { sticky:true }).addTo(groups.pickup));
  }
  document.getElementById('geo-legend')?.classList.toggle('heat-on', !!S.geo.layers.heat);
  if (S.geo.layers.heat && typeof L.heatLayer === 'function') {
    const pts = rows.flatMap(t => [[t.slat, t.slon, 1], [t.elat, t.elon, 1]]);
    // `max` es el numero de puntos que saturan una celda de la retícula interna
    // del plugin. Con el valor por defecto (1) cualquier solape llegaba al tope
    // de la rampa y el mapa entero salia del mismo color; escalarlo con el
    // volumen visible es lo que devuelve el degradado.
    const heatMax = Math.max(3, Math.round(Math.sqrt(pts.length) / (global ? 6 : 4)));
    if (pts.length) groups.heat.addLayer(L.heatLayer(pts, {
      radius: global ? 14 : 26, blur: global ? 11 : 18, minOpacity: .45, max: heatMax,
      gradient: heatGradient(),
    }));
  }

  const pts = rows.flatMap(t => [[t.slat, t.slon], [t.elat, t.elon]]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.12), { animate:false, maxZoom: global ? 5 : 14 });
  setTimeout(() => map.invalidateSize(), 60);

  // Tabla de corredores
  const all = routeAgg(rows, global ? 1 : 2);
  const top = all.slice(0, 14);
  table('geo-routes', [
    { h:'#', f:(_,i) => `<span class="rank">${i+1}</span>`, cls:'rank' },
    { h:'Corredor', f:r =>
        `${cdot(r.c)}${esc(r.city)}${r.city === r.cityEnd ? ' <span style="color:var(--text-muted)">(interno)</span>' : ' → ' + esc(r.cityEnd)}` +
        `<div class="mono" style="font-size:var(--t-micro);color:var(--text-muted);margin-top:1px">` +
        `${n2(r.slat)}, ${n2(r.slon)} → ${n2(r.elat)}, ${n2(r.elon)}</div>` },
    { h:'Viajes', num:true, f:r => barCell(r.n, top[0]?.n || 1, n(r.n)) },
    { h:'km', num:true, f:r => n1(mean(r.km)) },
    { h:'min', num:true, f:r => n1(mean(r.eff)) },
    { h:'Espera', num:true, f:r => n1(mean(r.wait)) },
  ], top, { rowAttr: r => `style="cursor:pointer" data-lat="${(r.slat+r.elat)/2}" data-lon="${(r.slon+r.elon)/2}"` });
  document.querySelectorAll('#geo-routes tbody tr').forEach(tr => tr.addEventListener('click', () => {
    const la = parseFloat(tr.dataset.lat), lo = parseFloat(tr.dataset.lon);
    if (!Number.isNaN(la)) map.flyTo([la, lo], Math.max(map.getZoom(), 12), { duration:.7 });
  }));

  const hs = [...pick.slice(0, 7).map(p => ({ ...p, kind:'Recogida', color:'--series-3' })),
              ...drop.slice(0, 7).map(p => ({ ...p, kind:'Dejada', color:'--series-2' }))]
             .sort((a,b) => b.n - a.n).slice(0, 14);
  table('geo-hotspots', [
    { h:'Tipo', f:r => `<i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(${r.color});margin-right:6px"></i>${r.kind}` },
    { h:'Zona', f:r => esc(r.city) },
    { h:'Coordenadas', cls:'mono', f:r => `${n2(r.lat)}, ${n2(r.lon)}` },
    { h:'Viajes', num:true, f:r => n(r.n) },
  ], hs);

  // Narrativa
  const topRoute = all[0];
  const sameCell = pick.length && drop.length &&
    Math.abs(pick[0].lat - drop[0].lat) < 0.01 && Math.abs(pick[0].lon - drop[0].lon) < 0.01;
  const topKm = mean(topRoute?.km || []);
  const corridorDesc = !topRoute ? ''
    : topRoute.city === topRoute.cityEnd
      ? `es un trayecto interno de <b>${esc(topRoute.city)}</b>${topKm ? ` de unos <b>${n1(topKm)} km</b>` : ''}`
      : `une <b>${esc(topRoute.city)}</b> con <b>${esc(topRoute.cityEnd)}</b>`;
  setInsight('geo-insight', topRoute
    ? `El corredor más transitado de la selección ${corridorDesc} y acumula <b>${n(topRoute.n)}</b> viajes
       (${pct(100*topRoute.n/Math.max(1,rows.length))} de la selección).
       Los focos de recogida y de dejada <b>${sameCell ? 'coinciden' : 'no coinciden'}</b>:
       ${sameCell
         ? 'el mismo punto genera y absorbe demanda, lo que suele indicar un intercambiador o un centro de actividad.'
         : `la celda que más recogidas concentra (<span class="mono">${n2(pick[0]?.lat)}, ${n2(pick[0]?.lon)}</span>
            en ${esc(pick[0]?.city || '-')}, ${n(pick[0]?.n || 0)} viajes) no es la que más dejadas recibe
            (<span class="mono">${n2(drop[0]?.lat)}, ${n2(drop[0]?.lon)}</span> en ${esc(drop[0]?.city || '-')},
            ${n(drop[0]?.n || 0)}). Esa asimetría entre dónde empieza y dónde acaba la demanda es la que genera
            reposicionamiento en vacío y encarece la operación.`}`
    : 'Sin viajes geolocalizados en la selección.');

  const kms = rows.map(t => t.km).filter(x => x != null);
  const cut = quantile(kms, .99) || 30;
  plot('geo-dist', [{
    x: kms.filter(k => k <= cut), type:'histogram', nbinsx:32,
    marker:{ color: css('--series-7'), line:{ width:1.5, color: css('--surface-1') } },
    hovertemplate:'%{x} km<br><b>%{y} viajes</b><extra></extra>',
  }], { xaxis:{ ticksuffix:' km', title:{ text:'distancia en línea recta', font:{size:11} } },
        yaxis:{ title:{ text:'viajes', font:{size:11} } }, margin:{ l:52, r:12, t:10, b:44 }, bargap:.06 });

  const spd = [...groupBy(rows, t => t.c ?? '__null')].map(([k, v]) => {
    const km = mean(v.filter(t => t.km != null), t => t.km);
    const mn = mean(v.filter(t => t.eff != null && t.eff > 0), t => t.eff);
    return { k, n:v.length, km, mn, kmh: (km != null && mn) ? km / (mn/60) : null,
             medKm: median(v.map(t => t.km)) };
  }).sort((a,b) => b.n - a.n);
  table('geo-speed', [
    { h:'Mercado', f:r => cbadge(r.k === '__null' ? null : r.k) },
    { h:'Viajes', num:true, f:r => n(r.n) },
    { h:'km medios', num:true, f:r => n1(r.km) },
    { h:'km medianos', num:true, f:r => n1(r.medKm) },
    { h:'min medios', num:true, f:r => n1(r.mn) },
    { h:'km/h implícitos', num:true, f:r => n1(r.kmh) },
  ], spd);

  const slow = spd.filter(x => x.kmh != null).sort((a,b) => a.kmh - b.kmh)[0];
  const fast = spd.filter(x => x.kmh != null).sort((a,b) => b.kmh - a.kmh)[0];
  setInsight('geo-insight-speed', slow && fast
    ? `La velocidad implícita va de <b>${n1(slow.kmh)} km/h</b> en ${cname(slow.k)} a <b>${n1(fast.kmh)} km/h</b>
       en ${cname(fast.k)}. Al calcularse sobre distancia geodésica, infravalora la velocidad real (el recorrido
       por calle siempre es más largo que la línea recta), así que léase como un índice de congestión relativa
       entre mercados, no como una medida de tráfico.`
    : 'Sin datos suficientes para estimar velocidades.');
}

// ---------------------------------------------------------------------------
// PÁGINA · Conductores y flota
// ---------------------------------------------------------------------------
function pageOps() {
  const rows = S.view, bill = rows.filter(billed);
  const drivers = [...groupBy(rows.filter(t => t.d), t => t.d)].map(([id, v]) => ({
    id, n:v.length, rev: sum(v.filter(billed), t => t.p),
    eff: mean(v.filter(t => t.eff != null), t => t.eff),
    done: v.filter(t => t.r === 'drop_off').length,
  })).sort((a,b) => b.rev - a.rev);

  const reassign = rows.map(t => t.nd || 0);
  const multi = rows.filter(t => (t.nd || 0) > 1).length;

  document.getElementById('op-kpis').innerHTML = [
    kpi({ label:'Conductores activos', value:n(drivers.length), foot:`de ${n(S.meta.drivers_total)} en el catálogo` }),
    kpi({ label:'Viajes por conductor', value:n1(rows.length / Math.max(1, drivers.length)), foot:`mediana ${n(median(drivers.map(d => d.n)))} viajes` }),
    kpi({ label:'Conductores por viaje', value:n2(mean(reassign)), foot:`${pct(100*multi/Math.max(1,rows.length))} implican a más de uno`,
          hint:'Conductores distintos que llegan a asignarse a un viaje, sin contar el placeholder del sistema. Es menor que 1 porque algunos viajes no llegan a tener conductor.' }),
    kpi({ label:'Ingreso medio por conductor', value:n2(drivers.length ? sum(drivers, d => d.rev)/drivers.length : null),
          unit:'€', foot:'en las cinco semanas' }),
  ].join('');

  const maxNd = Math.min(6, Math.max(...reassign, 1));
  const ndBuckets = Array.from({ length: maxNd + 1 }, (_, i) => i);
  const ndCounts = ndBuckets.map(i => rows.filter(t => (t.nd || 0) === i).length);
  const lastLabel = `${maxNd}+`;
  ndCounts[maxNd] = rows.filter(t => (t.nd || 0) >= maxNd).length;
  plot('op-changes', [{
    x: ndBuckets.map(i => i === 0 ? 'Ninguno' : i === maxNd ? lastLabel : String(i)), y: ndCounts, type:'bar',
    marker:{ color: ndBuckets.map(i => i === 0 ? css('--text-muted') : seqColor(0.25 + i/Math.max(1,maxNd)*0.65)),
             line:{ width:1.5, color: css('--surface-1') } },
    text: ndCounts.map(v => n(v)), textposition:'outside', cliponaxis:false,
    textfont:{ color: css('--text-secondary'), size:11 },
    hovertemplate:'%{x} conductor(es)<br><b>%{y} viajes</b><extra></extra>',
  }], { xaxis:{ type:'category', title:{ text:'conductores distintos implicados', font:{size:11} } },
        yaxis:{ title:{ text:'viajes', font:{size:11} } }, margin:{ l:48, r:12, t:20, b:44 } });

  // Los viajes con 0 conductores no pueden completarse por definición, así que se
  // sacan del análisis de reasignación y se comentan aparte.
  const noDriver = rows.filter(t => (t.nd || 0) === 0);
  const assigned = rows.filter(t => (t.nd || 0) >= 1);
  const outcBuckets = [['1', t => t.nd === 1], ['2', t => t.nd === 2], ['3 o más', t => t.nd >= 3]];
  const outc = outcBuckets.map(([k, f]) => {
    const v = assigned.filter(f);
    return { k, n: v.length, rate: v.length ? 100 * v.filter(t => t.r === 'drop_off').length / v.length : null };
  }).filter(x => x.n >= 5);
  const maxRate = Math.max(...outc.map(o => o.rate || 0), 1);
  plot('op-changes-outcome', [{
    x: outc.map(o => o.k), y: outc.map(o => o.rate), type:'bar',
    marker:{ color: outc.map(o => seqColor(0.25 + 0.65 * (o.rate / maxRate))),
             line:{ width:1.5, color: css('--surface-1') } },
    text: outc.map(o => `${n1(o.rate)} %`), textposition:'outside', cliponaxis:false,
    textfont:{ color: css('--text-secondary'), size:11 },
    customdata: outc.map(o => o.n),
    hovertemplate:'%{x} conductor(es)<br><b>%{y:.1f} % completados</b><br>sobre %{customdata} viajes<extra></extra>',
  }], { xaxis:{ type:'category', title:{ text:'conductores distintos implicados', font:{size:11} } },
        yaxis:{ ticksuffix:' %', range:[0, 105] }, margin:{ l:52, r:12, t:20, b:44 } });

  const r1 = outc.find(o => o.k === '1'), rN = outc[outc.length - 1];
  const drop = r1 && rN && r1.k !== rN.k ? r1.rate - rN.rate : null;
  setInsight('op-insight-changes', r1
    ? `<b>${n(noDriver.length)}</b> viajes (${pct(100*noDriver.length/Math.max(1,rows.length))}) nunca llegaron a
       tener conductor asignado: no son reasignaciones, son demanda que la oferta no llegó a atender, y por
       definición no pueden completarse.
       Entre los que sí encontraron conductor, el que lo hizo a la primera se completa el <b>${pct(r1.rate)}</b>
       de las veces${drop != null
         ? `, frente al <b>${pct(rN.rate)}</b> de los que pasaron por ${rN.k} conductores: <b>${n1(Math.abs(drop))} puntos</b>
            ${drop > 0 ? 'menos' : 'más'}. Con solo <b>${n(sum(outc.slice(1), o => o.n))}</b> viajes reasignados en la
            muestra, la diferencia es <em>indicativa, no concluyente</em>: sirve para plantear la hipótesis de que la
            reasignación anticipa una caída, no para darla por probada.`
         : '.'}
       En cualquier caso, esta métrica solo existe porque el modelo conserva los cambios de conductor: se perdería
       por completo si la tabla de viajes se aplanara quedándose con la última fila de cada
       <code class="i">trip_id</code>.`
    : 'No hay suficientes viajes con conductor asignado para evaluar el efecto.');

  // Lorenz de conductores
  const sortedD = [...drivers].sort((a,b) => a.n - b.n);
  const totN = sum(sortedD, d => d.n) || 1;
  let acc = 0;
  const lx = [0], ly = [0];
  sortedD.forEach((d, i) => { acc += d.n; lx.push(100*(i+1)/sortedD.length); ly.push(100*acc/totN); });
  plot('op-lorenz', [
    { x:[0,100], y:[0,100], type:'scatter', mode:'lines', name:'Reparto uniforme',
      line:{ color: css('--text-muted'), width:1.5, dash:'dot' }, hoverinfo:'skip' },
    { x:lx, y:ly, type:'scatter', mode:'lines', name:'Conductores', fill:'tozeroy',
      line:{ color: css('--series-1'), width:2 }, fillcolor: alpha(css('--series-1'), .16),
      hovertemplate:'El %{x:.0f} % de conductores<br>acumula el %{y:.0f} % de los viajes<extra></extra>' },
  ], { showlegend:true, legend:{ orientation:'h', y:1.13, x:0, font:{size:11.5} },
       xaxis:{ ticksuffix:' %', title:{ text:'% de conductores (ordenados por actividad)', font:{size:11} } },
       yaxis:{ ticksuffix:' %', title:{ text:'% de viajes', font:{size:11} } },
       margin:{ l:56, r:14, t:28, b:46 } });

  const top10 = drivers.slice(0, Math.ceil(drivers.length * 0.1));
  setInsight('op-insight-lorenz', drivers.length
    ? `El <b>10 % de conductores más activos</b> concentra el <b>${pct(100*sum(top10, d => d.n)/Math.max(1,totN))}</b>
       de los viajes. Con una mediana de <b>${n(median(drivers.map(d => d.n)))}</b> viajes por conductor en cinco
       semanas, la mayoría del catálogo apenas aparece: no hay base para un ranking de rendimiento estable, y
       cualquier «top conductor» de esta muestra lo es por azar tanto como por desempeño.`
    : 'Sin conductores en la selección.');

  const maxRev = Math.max(...drivers.map(d => d.rev), 1);
  table('op-drivers', [
    { h:'#', f:(_,i) => `<span class="rank">${i+1}</span>`, cls:'rank' },
    { h:'Conductor', cls:'mono', f:r => esc(r.id.slice(0, 12)) + '…' },
    { h:'Viajes', num:true, f:r => n(r.n) },
    { h:'Completados', num:true, f:r => `${n(r.done)} <span style="color:var(--text-muted)">(${n1(100*r.done/r.n)} %)</span>` },
    { h:'Ingresos', num:true, f:r => barCell(r.rev, maxRev, eur(r.rev)) },
    { h:'min/viaje', num:true, f:r => n1(r.eff) },
  ], drivers.slice(0, 12));

  const ctg = [...groupBy(bill, t => t.ct ?? '__null')].map(([k, v]) => ({
    k: k === '__null' ? 'Sin categoría' : k, n: v.length, rev: sum(v, t => t.p),
    avg: mean(v, t => t.p), eff: mean(v.filter(t => t.eff != null), t => t.eff),
  })).sort((a,b) => b.n - a.n);
  plot('op-cartype', [
    { x: ctg.map(c => c.k), y: ctg.map(c => c.n), name:'Viajes', type:'bar', yaxis:'y',
      marker:{ color: css('--series-1'), line:{ width:1.5, color: css('--surface-1') } },
      text: ctg.map(c => `${n(c.n)} viajes · ${eur2(c.avg)}`), textposition:'outside', cliponaxis:false,
      textfont:{ color: css('--text-secondary'), size:11 },
      customdata: ctg.map(c => c.avg),
      hovertemplate:'%{x}<br><b>%{y} viajes</b><br>ticket medio %{customdata:.2f} €<extra></extra>' },
  ], { yaxis:{ title:{ text:'viajes facturados', font:{size:11} } }, margin:{ l:52, r:12, t:24, b:42 } });

  const fleet = S.meta.car_fleet || [];
  const maxF = Math.max(...fleet.map(f => f.cars), 1);
  table('op-fleet', [
    { h:'Categoría', f:r => esc(r.car_type ?? 'Sin categoría') },
    { h:'Vehículos', num:true, f:r => barCell(r.cars, maxF, n(r.cars)) },
    { h:'Con licencia', num:true, f:r => `${n(r.licensed)} <span style="color:var(--text-muted)">(${n1(100*r.licensed/r.cars)} %)</span>` },
    { h:'Deshabilitados', num:true, f:r => `${n(r.disabled)} <span style="color:var(--text-muted)">(${n1(100*r.disabled/r.cars)} %)</span>` },
  ], fleet);
}

// ---------------------------------------------------------------------------
// PÁGINA · Conversión del viaje
// ---------------------------------------------------------------------------
const REASON_COLOR = r => ({
  drop_off:'--series-6', rider_cancel:'--series-2', not_found:'--series-8',
  not_shown:'--series-4', system_cancel:'--series-5', stop:'--series-7', __null:'--text-muted',
}[r || '__null'] || '--series-1');

function pageFunnel() {
  const rows = S.view;
  const g = [...groupBy(rows, t => t.r || '__null')].map(([k, v]) => ({
    k, n: v.length, rev: sum(v.filter(billed), t => t.p), avg: mean(v.filter(billed), t => t.p),
    wait: mean(v.filter(t => t.wait != null), t => t.wait),
    eff: mean(v.filter(t => t.eff != null), t => t.eff),
    nd: mean(v, t => t.nd || 0),
  })).sort((a,b) => b.n - a.n);
  const done = g.find(x => x.k === 'drop_off')?.n || 0;
  const cancels = rows.filter(t => ['rider_cancel','system_cancel','not_found','not_shown'].includes(t.r)).length;
  const avgDone = mean(rows.filter(t => t.r === 'drop_off' && t.p != null), t => t.p);

  document.getElementById('fn-kpis').innerHTML = [
    kpi({ label:'Tasa de finalización', value:pct(100*done/Math.max(1,rows.length)), foot:`${n(done)} de ${n(rows.length)} viajes` }),
    kpi({ label:'Viajes no completados', value:n(cancels), foot:pct(100*cancels/Math.max(1,rows.length)) + ' del total' }),
    kpi({ label:'Ingreso no realizado', value:n(cancels * (avgDone || 0)), unit:'€', foot:'estimado al ticket medio del viaje completado',
          hint:'Estimación teórica: nº de viajes caídos × ticket medio de un viaje completado' }),
    kpi({ label:'Espera antes de caerse', value:n1(mean(rows.filter(t => t.r && t.r !== 'drop_off' && t.wait != null), t => t.wait)),
          unit:'min', foot:`vs. ${n1(mean(rows.filter(t => t.r === 'drop_off' && t.wait != null), t => t.wait))} min si se completa` }),
  ].join('');

  plot('fn-reasons', [{
    y: g.map(x => rshort(x.k === '__null' ? null : x.k)), x: g.map(x => x.n), type:'bar', orientation:'h',
    marker:{ color: g.map(x => css(REASON_COLOR(x.k === '__null' ? null : x.k))), line:{ width:1.5, color: css('--surface-1') } },
    text: g.map(x => `${n(x.n)} · ${n1(100*x.n/Math.max(1,rows.length))} %`), textposition:'outside', cliponaxis:false,
    textfont:{ color: css('--text-secondary'), size:11 },
    hovertemplate:'%{y}<br><b>%{x} viajes</b><extra></extra>',
  }], { yaxis:{ autorange:'reversed' }, xaxis:{ title:{ text:'viajes', font:{size:11} } },
        margin:{ l:130, r:80, t:12, b:40 } });

  table('fn-table', [
    { h:'Desenlace', f:r => `<i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:var(${REASON_COLOR(r.k === '__null' ? null : r.k)});margin-right:7px"></i>${esc(rname(r.k === '__null' ? null : r.k))}` },
    { h:'Viajes', num:true, f:r => n(r.n) },
    { h:'%', num:true, f:r => n1(100*r.n/Math.max(1,rows.length)) },
    { h:'Ticket', num:true, f:r => eur2(r.avg) },
    { h:'Espera', num:true, f:r => n1(r.wait) },
    { h:'Conduct.', num:true, f:r => n2(r.nd) },
  ], g);

  const nf_ = g.find(x => x.k === 'not_found'), rc = g.find(x => x.k === 'rider_cancel');
  setInsight('fn-insight', g.length
    ? `El <b>${pct(100*done/Math.max(1,rows.length))}</b> de los viajes llega a destino.
       ${nf_ ? `El motivo de caída dominante es <b>«${rname('not_found')}»</b> (${n(nf_.n)} viajes,
        ${pct(100*nf_.n/rows.length)}): el sistema no consiguió emparejar a nadie. Es un problema de oferta,
        no de precio ni de producto.` : ''}
       ${rc ? ` Las cancelaciones del usuario, en cambio, llegan tras <b>${n1(rc.wait)} min</b> de espera media.` : ''}
       Un dato de modelado que conviene tener presente: los viajes con <code class="i">not_found</code> casi nunca
       traen precio, así que están en el recuento de viajes pero no en el de ingresos.`
    : 'Sin datos.');

  const byC = [...groupBy(rows, t => t.c ?? '__null')].map(([k, v]) => ({
    k, n:v.length, rate: 100 * v.filter(t => t.r === 'drop_off').length / v.length,
  })).filter(x => x.n >= 5).sort((a,b) => b.rate - a.rate);
  plot('fn-country', [{
    y: byC.map(x => cflag(x.k === '__null' ? null : x.k)), x: byC.map(x => x.rate), type:'bar', orientation:'h',
    marker:{ color: byC.map(x => x.rate >= 70 ? css('--series-6') : x.rate >= 50 ? css('--series-4') : css('--series-8')),
             line:{ width:1.5, color: css('--surface-1') } },
    text: byC.map(x => n1(x.rate) + ' %'), textposition:'outside', cliponaxis:false,
    textfont:{ color: css('--text-secondary'), size:11 },
    customdata: byC.map(x => x.n),
    hovertemplate:'%{y}<br><b>%{x:.1f} % completados</b><br>%{customdata} viajes<extra></extra>',
  }], { yaxis:{ autorange:'reversed' }, xaxis:{ ticksuffix:' %', range:[0, 108] },
        margin:{ l:110, r:56, t:12, b:38 } });

  const reasons = g.map(x => x.k);
  plot('fn-hour', reasons.map(k => ({
    x: Array.from({ length: 24 }, (_, h) => h),
    y: Array.from({ length: 24 }, (_, h) => {
      const v = rows.filter(t => t.h === h);
      return v.length ? 100 * v.filter(t => (t.r || '__null') === k).length / v.length : 0;
    }),
    name: rshort(k === '__null' ? null : k), type:'bar',
    marker:{ color: css(REASON_COLOR(k === '__null' ? null : k)), line:{ width:0.8, color: css('--surface-1') } },
    hovertemplate:`%{x}:00<br>${rshort(k)}: %{y:.1f} %<extra></extra>`,
  })), { barmode:'stack', showlegend:true, legend:{ orientation:'h', y:1.16, x:0, font:{size:11} },
         xaxis:{ dtick:3, title:{ text:'hora local', font:{size:11} } },
         yaxis:{ ticksuffix:' %', range:[0,100] }, margin:{ l:52, r:12, t:34, b:42 }, bargap:.12 });

  const rates = Array.from({ length: 24 }, (_, h) => {
    const v = rows.filter(t => t.h === h);
    return { h, n: v.length, rate: v.length ? 100 * v.filter(t => t.r === 'drop_off').length / v.length : null };
  }).filter(x => x.n >= 8);
  const worstH = rates.length ? rates.reduce((a,b) => b.rate < a.rate ? b : a) : null;
  const bestC = byC[0], worstC = byC[byC.length - 1];
  setInsight('fn-insight-when', bestC && worstC
    ? `La tasa de finalización va del <b>${pct(bestC.rate)}</b> en ${cname(bestC.k)} al
       <b>${pct(worstC.rate)}</b> en ${cname(worstC.k)}: <b>${n1(bestC.rate - worstC.rate)} puntos</b> de diferencia
       entre mercados que operan el mismo producto.
       ${worstH ? `Por horas, la peor franja son las <b>${String(worstH.h).padStart(2,'0')}:00</b>, con solo
       ${pct(worstH.rate)} de viajes completados: el momento donde la oferta de conductores no cubre la demanda.` : ''}`
    : 'Sin datos suficientes por mercado.');

  const wb = [['0-2 min',0,2],['2-5 min',2,5],['5-10 min',5,10],['10-20 min',10,20],['20+ min',20,Infinity]];
  plot('fn-wait', reasons.map(k => ({
    x: wb.map(b => b[0]),
    y: wb.map(([, a, b]) => {
      const v = rows.filter(t => t.wait != null && t.wait >= a && t.wait < b);
      return v.length ? 100 * v.filter(t => (t.r || '__null') === k).length / v.length : 0;
    }),
    name: rshort(k === '__null' ? null : k), type:'bar',
    marker:{ color: css(REASON_COLOR(k === '__null' ? null : k)), line:{ width:1.2, color: css('--surface-1') } },
    hovertemplate:`espera %{x}<br>${rshort(k)}: %{y:.1f} %<extra></extra>`,
  })), { barmode:'stack', showlegend:true, legend:{ orientation:'h', y:1.14, x:0, font:{size:11} },
         yaxis:{ ticksuffix:' %', range:[0,100] }, margin:{ l:52, r:12, t:32, b:40 }, bargap:.32 });

  const w1 = rows.filter(t => t.wait != null && t.wait < 5);
  const w2 = rows.filter(t => t.wait != null && t.wait >= 20);
  setInsight('fn-insight-wait', w1.length && w2.length
    ? `Con menos de 5 minutos de espera, el <b>${pct(100*w1.filter(t => t.r === 'drop_off').length/w1.length)}</b>
       de los viajes acaba en destino. Pasados los 20 minutos, la cifra es del
       <b>${pct(100*w2.filter(t => t.r === 'drop_off').length/w2.length)}</b>.
       Ojo con la causalidad: parte de esa relación es mecánica (un viaje que nunca encuentra conductor acumula
       espera por definición), así que el gráfico describe la anatomía de un viaje fallido más que un umbral de
       paciencia del usuario.`
    : 'Sin datos suficientes de espera.');
}

// ---------------------------------------------------------------------------
// PÁGINA · Usuarios
// ---------------------------------------------------------------------------
function pageUsers() {
  const rows = S.view;
  const users = [...groupBy(rows, t => t.u)].map(([id, v]) => ({
    id, n: v.length, spent: sum(v.filter(billed), t => t.p),
    c: v[0].c, city: [...groupBy(v, t => t.city)].sort((a,b) => b[1].length - a[1].length)[0]?.[0],
    done: v.filter(t => t.r === 'drop_off').length,
    days: new Set(v.map(t => t.dt)).size,
    avg: mean(v.filter(billed), t => t.p),
  })).sort((a,b) => b.spent - a.spent);

  document.getElementById('us-kpis').innerHTML = [
    kpi({ label:'Usuarios activos', value:n(users.length), foot:`de ${n(sum(S.meta.users_by_country || [], u => u.users))} registrados` }),
    kpi({ label:'Viajes por usuario', value:n1(rows.length / Math.max(1, users.length)), foot:`mediana ${n(median(users.map(u => u.n)))}` }),
    kpi({ label:'Gasto medio', value:n2(mean(users, u => u.spent)), unit:'€', foot:`mediana ${eur2(median(users.map(u => u.spent)))}` }),
    kpi({ label:'Días activos', value:n1(mean(users, u => u.days)), foot:`sobre ${S.dates.length} días del periodo` }),
  ].join('');

  const freq = users.map(u => u.n);
  plot('us-freq', [{
    x: freq, type:'histogram', nbinsx: Math.min(30, Math.max(6, Math.ceil(Math.max(...freq, 1) / 2))),
    marker:{ color: css('--series-1'), line:{ width:1.5, color: css('--surface-1') } },
    hovertemplate:'%{x} viajes<br><b>%{y} usuarios</b><extra></extra>',
  }], { xaxis:{ title:{ text:'viajes en el periodo', font:{size:11} } },
        yaxis:{ title:{ text:'usuarios', font:{size:11} } }, margin:{ l:48, r:12, t:10, b:44 }, bargap:.06 });

  const sortedU = [...users].sort((a,b) => a.spent - b.spent);
  const tot = sum(sortedU, u => u.spent) || 1;
  let acc = 0; const lx = [0], ly = [0];
  sortedU.forEach((u, i) => { acc += u.spent; lx.push(100*(i+1)/sortedU.length); ly.push(100*acc/tot); });
  plot('us-lorenz', [
    { x:[0,100], y:[0,100], type:'scatter', mode:'lines', name:'Reparto uniforme',
      line:{ color: css('--text-muted'), width:1.5, dash:'dot' }, hoverinfo:'skip' },
    { x:lx, y:ly, type:'scatter', mode:'lines', name:'Gasto acumulado', fill:'tozeroy',
      line:{ color: css('--series-3'), width:2 }, fillcolor: alpha(css('--series-3'), .16),
      hovertemplate:'El %{x:.0f} % de usuarios<br>aporta el %{y:.0f} % del gasto<extra></extra>' },
  ], { showlegend:true, legend:{ orientation:'h', y:1.13, x:0, font:{size:11.5} },
       xaxis:{ ticksuffix:' %', title:{ text:'% de usuarios (ordenados por gasto)', font:{size:11} } },
       yaxis:{ ticksuffix:' %' }, margin:{ l:56, r:14, t:28, b:46 } });

  const top20 = users.slice(0, Math.ceil(users.length * 0.2));
  setInsight('us-insight', users.length
    ? `El <b>20 % de usuarios que más gasta</b> aporta el <b>${pct(100*sum(top20, u => u.spent)/Math.max(1,tot))}</b>
       de los ingresos. La media de <b>${n1(rows.length/users.length)}</b> viajes por usuario esconde una
       distribución con cola: la mediana está en <b>${n(median(users.map(u => u.n)))}</b> viajes y el usuario más
       activo hizo <b>${n(Math.max(...users.map(u => u.n)))}</b>. Con 99 identificadores en total, este panel es
       una muestra de comportamiento, no un censo de clientes: sirve para estudiar patrones de uso, no para
       dimensionar el mercado.`
    : 'Sin usuarios en la selección.');

  const ubc = S.meta.users_by_country || [];
  const langs = [...new Set(ubc.map(u => u.language))];
  const countriesU = [...new Set(ubc.map(u => u.country))]
    .sort((a,b) => sum(ubc.filter(x => x.country === b), x => x.users) - sum(ubc.filter(x => x.country === a), x => x.users));
  plot('us-locale', langs.map((lang, i) => ({
    x: countriesU.map(c => cname(c)),
    y: countriesU.map(c => ubc.find(u => u.country === c && u.language === lang)?.users || 0),
    name: lang === 'es' ? 'Español' : lang === 'en' ? 'Inglés' : lang, type:'bar',
    marker:{ color: series(i), line:{ width:1.2, color: css('--surface-1') } },
    hovertemplate:`%{x} · ${lang}<br><b>%{y} usuarios</b><extra></extra>`,
  })), { barmode:'stack', showlegend:true, legend:{ orientation:'h', y:1.14, x:0, font:{size:11.5} },
         xaxis:{ tickangle:-25 }, yaxis:{ title:{ text:'usuarios', font:{size:11} } },
         margin:{ l:48, r:12, t:30, b:64 } });

  const ten = S.meta.tenure || [];
  const kinds = [['user','Usuarios'], ['driver','Conductores'], ['car','Vehículos']];
  const years = [...new Set(ten.map(t => t.years_registered))].sort((a,b) => a-b);
  plot('us-tenure', kinds.map(([k, lab], i) => {
    const rowsK = ten.filter(t => t.entity_type === k);
    const totK = sum(rowsK, t => t.num_entities) || 1;
    return { x: years, y: years.map(y => 100 * (rowsK.find(t => t.years_registered === y)?.num_entities || 0) / totK),
             name: lab, type:'scatter', mode:'lines+markers',
             line:{ color: series(i), width:2, shape:'linear' }, marker:{ size:6 },
             hovertemplate:`${lab}<br>%{x} años: %{y:.1f} %<extra></extra>` };
  }), { showlegend:true, legend:{ orientation:'h', y:1.14, x:0, font:{size:11.5} },
        xaxis:{ title:{ text:'años desde el alta', font:{size:11} }, dtick:1 },
        yaxis:{ ticksuffix:' %' }, margin:{ l:52, r:12, t:30, b:44 } });

  const maxSpent = Math.max(...users.map(u => u.spent), 1);
  table('us-table', [
    { h:'#', f:(_,i) => `<span class="rank">${i+1}</span>`, cls:'rank' },
    { h:'Usuario', cls:'mono', f:r => esc(r.id.slice(0, 12)) + '…' },
    { h:'Mercado', f:r => cbadge(r.c) },
    { h:'Zona principal', f:r => esc(r.city || '-') },
    { h:'Viajes', num:true, f:r => n(r.n) },
    { h:'Completados', num:true, f:r => `${n(r.done)} <span style="color:var(--text-muted)">(${n1(100*r.done/r.n)} %)</span>` },
    { h:'Días activos', num:true, f:r => n(r.days) },
    { h:'Ticket medio', num:true, f:r => eur2(r.avg) },
    { h:'Gasto total', num:true, f:r => barCell(r.spent, maxSpent, eur(r.spent)) },
  ], users.slice(0, 25));
}

// ---------------------------------------------------------------------------
// PÁGINA · Calidad del dato  (no depende de los filtros)
// ---------------------------------------------------------------------------
function pageQuality() {
  const m = S.meta, f = m.funnel || {};
  const cov = m.coverage || [];
  const carCov = cov.find(c => c.entidad === 'Vehículos');
  const reduction = f.raw_rows ? 100 * (1 - f.fact_trips / f.raw_rows) : null;

  document.getElementById('dq-kpis').innerHTML = [
    kpi({ label:'Filas en el origen', value:n(f.raw_rows), foot:`para solo ${n(f.raw_trips)} viajes distintos` }),
    kpi({ label:'Reducción del ruido', value:pct(reduction), foot:`${n(f.raw_rows)} → ${n(f.fact_trips)} filas útiles` }),
    kpi({ label:'Viajes con precio', value:pct(f.trips_with_price != null ? 100*f.trips_with_price/Math.max(1,f.fact_trips) : null),
          foot:`${n(f.trips_with_price)} de ${n(f.fact_trips)}` }),
    kpi({ label:'Vehículos con dimensión', value:pct(carCov ? 100*carCov.con_dimension/Math.max(1,carCov.en_viajes) : null),
          accent:'var(--critical)', foot:`${n(carCov?.con_dimension)} de ${n(carCov?.en_viajes)} IDs`,
          hint:'El hallazgo más limitante del dataset: la mayoría de los coches referenciados en viajes no existe en cars.json' }),
  ].join('');

  // El embudo mezcla dos unidades (filas y viajes), así que se separa en dos
  // bloques con su propia escala: comparar 23.919 filas con 1.863 viajes en la
  // misma barra sugeriría una pérdida de datos que no existe.
  const blocks = [
    { title:'Reducción de filas', unit:'filas', steps:[
      { l:'Filas en <code class="i">raw.trip</code>', s:'Un evento de estado por fila', v:f.raw_rows, c:'--seq-300' },
      { l:'Filas conservadas en staging', s:'Primera + cambios de conductor + cierre', v:f.staging_rows, c:'--seq-500' },
      { l:'Viajes en <code class="i">fact__trips</code>', s:'Una fila por viaje tras colapsar', v:f.fact_trips, c:'--seq-700' },
    ]},
    { title:'Cobertura de los viajes', unit:'viajes', steps:[
      { l:'Viajes distintos en el origen', s:'<code class="i">COUNT(DISTINCT trip_id)</code>', v:f.raw_trips, c:'--seq-200' },
      { l:'Con geometría completa', s:'Exactamente dos paradas', v:f.staging_trips, c:'--seq-400' },
      { l:'Con desenlace registrado', s:'<code class="i">reason</code> informado', v:f.trips_with_reason, c:'--seq-500' },
      { l:'Facturados', s:'<code class="i">price</code> válido', v:f.trips_with_price, c:'--seq-600' },
    ]},
  ];
  const ft = document.getElementById('dq-funnel-title');
  if (ft) ft.textContent = `El embudo: de ${n(f.raw_rows)} filas a ${n(f.fact_trips)} viajes`;
  document.getElementById('dq-funnel').innerHTML = blocks.map((b, bi) => {
    const base = b.steps[0].v || 1;
    return `${bi ? '<div style="height:14px"></div>' : ''}
      <div style="font-family:var(--font-mono);font-size:var(--t-micro);letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">${b.title} <span style="opacity:.7">· escala en ${b.unit}</span></div>` +
      b.steps.map((s, i) => `
        <div class="funnel-row">
          <div class="funnel-label"><b>${s.l}</b>${s.s}</div>
          <div class="funnel-bar"><i style="width:${100*(s.v||0)/base}%;background:var(${s.c})"></i></div>
          <div class="funnel-num">${n(s.v)}<small>${i === 0 ? 'base 100 %' : pct(100*(s.v||0)/base)}</small></div>
        </div>`).join('');
  }).join('');

  setInsight('dq-insight-funnel',
    `La tabla de origen tiene <b>${n(f.raw_rows)}</b> filas y <b>${n(f.raw_trips)}</b> viajes: una media de
     <b>${n1(f.raw_rows/Math.max(1,f.raw_trips))}</b> filas por viaje. Casi todas son actualizaciones redundantes
     del mismo estado. Al conservar solo las filas con significado (la primera, los cambios de conductor o
     vehículo y el cierre) quedan <b>${n(f.staging_rows)}</b>, y al colapsar a un viaje por fila,
     <b>${n(f.fact_trips)}</b>. Es una reducción del <b>${pct(reduction)}</b> <em>sin perder ningún evento
     relevante para negocio</em>: el conductor final, el precio y el motivo de cierre siguen ahí.`);

  const roles = m.row_roles || [];
  const totRoles = sum(roles, r => r.filas) || 1;
  plot('dq-roles', [{
    y: roles.map(r => r.rol), x: roles.map(r => r.filas), type:'bar', orientation:'h',
    marker:{ color: roles.map(r => r.rol.startsWith('Actualización') ? css('--text-muted') : css('--series-1')),
             line:{ width:1.5, color: css('--surface-1') } },
    text: roles.map(r => `${n(r.filas)} · ${n1(100*r.filas/totRoles)} %`), textposition:'outside', cliponaxis:false,
    textfont:{ color: css('--text-secondary'), size:11 },
    hovertemplate:'%{y}<br><b>%{x} filas</b><extra></extra>',
  }], { yaxis:{ autorange:'reversed' }, margin:{ l:172, r:90, t:12, b:36 } });

  document.getElementById('dq-anatomy').innerHTML =
`trip_id 7tNkOwqRYq0+PTA2j6p/GQ==

updated_at (UTC)   driver           reason     price
13:57:36.296       <b>1B2M2Y8…</b>  (vacío)    NULL   ← <b>primera fila</b>
13:57:36.531       1B2M2Y8…         (vacío)    NULL
13:57:37.031       1B2M2Y8…         (vacío)    NULL
13:58:19.854       <b>hNNJrlX…</b>  (vacío)    NULL   ← <b>cambio de conductor</b>
13:58:20.193       hNNJrlX…         (vacío)    NULL
14:15:27.646       hNNJrlX…         (vacío)    NULL
14:15:28.024       <b>1B2M2Y8…</b>  (vacío)    NULL   ← vuelve al placeholder
14:15:40.164       <b>cfMZHyO…</b>  (vacío)    NULL   ← <b>cambio de conductor</b>
   …
14:38:46.509       cfMZHyO…         <b>drop_off</b>   NULL   ← reason sin precio
14:38:47.922       cfMZHyO…         drop_off   <b>1.234</b>  ← <b>fila de cierre elegida</b>
15:16:00.197       cfMZHyO…         drop_off   1.234
15:16:00.598       cfMZHyO…         drop_off   1.234

17 filas → <b>4 filas útiles</b> → 1 viaje en fact__trips`;

  document.getElementById('dq-coverage').innerHTML = cov.map(c => {
    const p = 100 * c.con_dimension / Math.max(1, c.en_viajes);
    const col = p >= 95 ? '--good' : p >= 50 ? '--warning' : '--critical';
    return `<div class="dq-row">
      <div>${esc(c.entidad)} <span style="color:var(--text-muted)">· ${n(c.con_dimension)} de ${n(c.en_viajes)} IDs</span></div>
      <div class="dq-val" style="color:var(${col})">${n1(p)} %</div>
      <div class="dq-track"><i style="width:${p}%;background:var(${col})"></i></div>
    </div>`;
  }).join('');

  const rn = m.raw_nulls || {};
  document.getElementById('dq-placeholder').innerHTML = `
    <p style="font-size:var(--t-sm);color:var(--text-secondary)">
      El identificador <code class="i">${esc(m.placeholder_id || '')}</code> aparece
      <b>${n(rn.driver_placeholder)}</b> veces como conductor y <b>${n(rn.car_placeholder)}</b> como vehículo,
      pero no existe en <code class="i">drivers.json</code> ni en <code class="i">cars.json</code>.</p>
    <p style="font-size:var(--t-sm);color:var(--text-secondary);margin-top:9px">
      No es un fallo de datos: es el <b>hash MD5 de la cadena vacía</b> codificado en base64. El sistema lo emite
      cuando el campo va vacío, es decir, mientras el viaje aún no tiene conductor asignado.
      Reconocerlo cambia la lectura: esas filas no son «conductores fantasma», son
      <b>el estado «buscando conductor»</b>, y contarlas como reasignaciones reales inflaría la métrica de fricción.</p>
    <pre class="code">$ echo -n "" | md5sum | xxd -r -p | base64
<b>1B2M2Y8AsgTpgAmY7PhCfg==</b></pre>`;

  setInsight('dq-insight-cov',
    carCov ? `Solo el <b>${pct(100*carCov.con_dimension/Math.max(1,carCov.en_viajes))}</b> de los vehículos que
      aparecen en viajes (<b>${n(carCov.con_dimension)}</b> de <b>${n(carCov.en_viajes)}</b>) encuentra su fila en
      <code class="i">dim__cars</code>, pese a que el catálogo tiene <b>${n(m.cars_total)}</b> vehículos distintos.
      Los dos ficheros describen poblaciones que apenas se solapan. <b>Consecuencia práctica:</b> cualquier
      análisis por categoría de vehículo de este informe cubre una fracción pequeña del volumen y no debe
      extrapolarse. Conductores y usuarios, en cambio, cruzan casi al 100 %.`
      : 'Sin datos de cobertura.', 'insight alert');

  const totRows = rn.filas || 1;
  document.getElementById('dq-nulls').innerHTML = [
    ['Precio ausente o NaN', rn.price_nulo],
    ['Motivo de cierre vacío', rn.reason_vacio],
    ['Conductor sin asignar (placeholder)', rn.driver_placeholder],
    ['Vehículo sin asignar (placeholder)', rn.car_placeholder],
  ].map(([lab, v]) => {
    const p = 100 * (v || 0) / totRows;
    const col = p >= 60 ? '--warning' : p >= 20 ? '--serious' : '--good';
    return `<div class="dq-row">
      <div>${lab} <span style="color:var(--text-muted)">· ${n(v)} filas</span></div>
      <div class="dq-val">${n1(p)} %</div>
      <div class="dq-track"><i style="width:${p}%;background:var(${col})"></i></div>
    </div>`;
  }).join('');

  const stops = f.stops_distribution || [];
  const totStops = sum(stops, s => s.trips) || 1;
  table('dq-stops', [
    { h:'Pares de coordenadas', f:r => `${r.n_stops} ${r.n_stops === 2 ? '<span class="pill good">conservado</span>' : '<span class="pill bad">descartado</span>'}` },
    { h:'Viajes', num:true, f:r => n(r.trips) },
    { h:'%', num:true, f:r => n2(100*r.trips/totStops) },
  ], stops);

  const ok = stops.find(s => s.n_stops === 2);
  setInsight('dq-insight-stops', ok
    ? `El <b>${n2(100*ok.trips/totStops)} %</b> de los viajes trae exactamente dos paradas: origen y destino.
       Los <b>${n(totStops - ok.trips)}</b> restantes (con cero, una o tres) se quedan en la capa
       <code class="i">raw</code> (el origen se preserva íntegro) pero no entran en la tabla de hechos: sin par
       origen-destino no se puede calcular ruta ni distancia sin inventar el dato que falta.`
    : 'Sin datos de geometría.');

  // El extracto trae las tablas sin un orden útil. Se ordenan por entidad y,
  // dentro de cada una, por capa, para poder seguir un mismo dato de raw a core
  // leyendo hacia abajo: raw.trip → staging.trips → core.fact__trips, etc.
  const ENTIDADES = ['trip', 'user', 'driver', 'car'];
  const CAPAS     = ['raw', 'staging', 'core', 'analytics'];
  const entidad = t => t.split('.').pop()            // core.fact__trips → fact__trips
    .replace(/^(fact|dim|staging)__/, '')            // → trips
    .replace(/s$/, '');                              // → trip
  const pos = (orden, v) => { const i = orden.indexOf(v); return i < 0 ? orden.length : i; };
  const lay = [...(m.layers || [])].sort((a, b) =>
    pos(ENTIDADES, entidad(a.tabla)) - pos(ENTIDADES, entidad(b.tabla)) ||
    pos(CAPAS, a.tabla.split('.')[0]) - pos(CAPAS, b.tabla.split('.')[0]));
  table('dq-layers', [
    { h:'Tabla', cls:'mono', f:r => esc(r.tabla) },
    { h:'Capa', f:r => { const s = r.tabla.split('.')[0];
        return `<span class="chip ${s === 'core' || s === 'analytics' ? 'on' : ''}">${s}</span>`; } },
    { h:'Filas', num:true, f:r => n(r.filas) },
    { h:'Entidades distintas', num:true, f:r => n(r.entidades) },
    { h:'Filas por entidad', num:true, f:r => n2(r.filas / Math.max(1, r.entidades)) },
  ], lay);
}

// ---------------------------------------------------------------------------
// PÁGINA · Metodología
// ---------------------------------------------------------------------------
function pageMethod() {
  const lay = S.meta.layers || [];
  const info = [
    { k:'raw', t:'Ingesta', d:'Los JSON tal y como llegan, sin transformar. Preserva el origen íntegro y hace auditable todo lo que viene después.', c:'--seq-200' },
    { k:'staging', t:'Limpieza', d:`Renombrado, deduplicación y la reducción de eventos a las filas con significado. Aquí vive la lógica que colapsa las ${n(S.meta.funnel?.raw_rows)} filas del origen.`, c:'--seq-400' },
    { k:'core', t:'Modelo de negocio', d:'Esquema en estrella: una tabla de hechos de viajes y tres dimensiones con histórico (SCD tipo 2).', c:'--seq-500' },
    { k:'analytics', t:'Agregados', d:'Vistas SQL con los KPIs ya calculados, listas para consumir desde un BI o desde este informe.', c:'--seq-600' },
  ];
  document.getElementById('mt-layers').innerHTML = info.map(i => {
    const tabs = lay.filter(l => l.tabla.startsWith(i.k + '.'));
    return `<div class="card" style="border-top:2px solid var(${i.c})">
      <div class="card-head"><div class="card-title"><code class="i">${i.k}</code></div>
        <div class="card-tag">${i.t}</div></div>
      <p style="font-size:var(--t-sm);color:var(--text-secondary);margin:6px 0 10px">${i.d}</p>
      ${tabs.length ? `<div style="font-size:var(--t-xs);color:var(--text-muted)">
        ${tabs.map(t => `<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0">
          <span class="mono">${esc(t.tabla.split('.')[1])}</span>
          <b style="font-variant-numeric:tabular-nums;color:var(--text-secondary)">${n(t.filas)}</b></div>`).join('')}
      </div>` : `<div style="font-size:var(--t-xs);color:var(--text-muted)">Vistas SQL agregadas</div>`}
    </div>`;
  }).join('');

  const fx = S.meta.fx || [];
  table('mt-fx', [
    { h:'Mercado', f:r => cbadge(r.country) },
    { h:'Divisa', f:r => `<span class="mono">${esc(r.currency)}</span>` },
    { h:'Tipo a EUR', num:true, f:r => r.rate },
    { h:'Huso aplicado', num:true, f:r => ({ ES:'UTC+1', CO:'UTC−5', PE:'UTC−5', EC:'UTC−5', MX:'UTC−6', CL:'UTC−4', AR:'UTC−3' })[r.country] || '-' },
  ], fx);

  const g = S.meta.generated_at;
  document.getElementById('mt-generated').textContent = g ? new Date(g).toLocaleString('es-ES') : '-';
}

// ---------------------------------------------------------------------------
// Router y refresco
// ---------------------------------------------------------------------------
const PAGES = {
  overview: pageOverview, revenue: pageRevenue, demand: pageDemand, geo: pageGeo,
  ops: pageOps, funnel: pageFunnel, users: pageUsers, quality: pageQuality, method: pageMethod,
};
const GLOBAL_PAGES = new Set(['quality', 'method']);  // no reaccionan a los filtros

function goTo(page, push = true) {
  if (!PAGES[page]) page = 'overview';
  S.page = page;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  document.querySelectorAll('.nav-item').forEach(b => {
    const on = b.dataset.page === page;
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  });
  document.getElementById('tb-title').textContent = PAGE_TITLES[page];
  if (push && location.hash.slice(1) !== page) history.replaceState(null, '', '#' + page);
  render(page);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function render(page) {
  // Plotly mide el contenedor en el momento de dibujar. Sobre un elemento con
  // `display:none` la medida es 0 y cae a su ancho por defecto (700 px), asi que
  // los graficos de la primera pagina se salian de su tarjeta hasta que algo
  // provocaba un `resize`. Dibujar solo lo que esta visible lo evita: en el
  // arranque, `refresh()` corre antes de que `goTo()` marque la pagina activa.
  const host = document.getElementById('page-' + page);
  if (!host || !host.classList.contains('active')) return;
  try { PAGES[page](); } catch (e) { console.error(`[${page}]`, e); }
  if (page === 'geo') setTimeout(() => S.maps['geo-map']?.map.invalidateSize(), 120);
}
function refresh() {
  S.view = applyFilters(S.trips);
  document.getElementById('tb-count').textContent =
    `${n(S.view.length)} viaje${S.view.length === 1 ? '' : 's'}`;
  syncSlicerButtons();
  S.rendered.clear();
  render(S.page);
}

// ---------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('vtc-theme', t); } catch (_) {}
  const m = S.maps['geo-map'];
  if (m) { m.tiles.setUrl(tileUrl()); m.labels?.setUrl(labelUrl()); }
  render(S.page);
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
async function boot() {
  try { const t = localStorage.getItem('vtc-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (_) {}

  let trips, meta;
  try {
    [trips, meta] = await Promise.all([
      fetch('data/trips.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('data/meta.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    ]);
  } catch (e) {
    document.querySelector('.main').innerHTML =
      `<div style="padding:60px 30px;max-width:640px">
         <h1 style="font-size:var(--t-xl);margin-bottom:12px">No se han podido cargar los datos</h1>
         <p style="color:var(--text-secondary);font-size:var(--t-md)">
           El informe necesita <code class="i">data/trips.json</code> y <code class="i">data/meta.json</code>.
           Genéralos con <code class="i">python scripts/export_report_data.py</code> y sirve la carpeta con
           <code class="i">python -m http.server 8080 --directory report</code>
           (abrir el fichero con <code class="i">file://</code> no funciona: el navegador bloquea el fetch).</p>
         <pre class="code">${esc(String(e))}</pre>
       </div>`;
    return;
  }

  S.trips = trips; S.meta = meta;
  S.dates = [...new Set(trips.map(t => t.dt))].sort();

  document.getElementById('foot-meta').innerHTML =
    `${n(trips.length)} viajes · ${S.dates.length} días<br>` +
    `Extracto de ${meta.generated_at ? new Date(meta.generated_at).toLocaleDateString('es-ES') : '-'}`;
  document.getElementById('foot-1').textContent =
    `Periodo ${dmy(S.dates[0])} a ${dmy(S.dates[S.dates.length-1])}`;

  buildSlicers();

  document.getElementById('nav').addEventListener('click', e => {
    const b = e.target.closest('.nav-item'); if (b) goTo(b.dataset.page);
  });
  document.getElementById('theme-toggle').addEventListener('click', () =>
    setTheme(isDark() ? 'light' : 'dark'));
  addEventListener('hashchange', () => goTo(location.hash.slice(1) || 'overview', false));

  // Controles del mapa
  document.getElementById('geo-scope').addEventListener('change', e => { S.geo.scope = e.target.value; drawGeo(); });
  document.getElementById('geo-layers').addEventListener('click', e => {
    const b = e.target.closest('button[data-layer]'); if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    S.geo.layers[b.dataset.layer] = on;
    drawGeo();
  });
  const topn = document.getElementById('geo-topn');
  topn.addEventListener('input', e => {
    S.geo.topn = +e.target.value;
    document.getElementById('geo-topn-val').textContent = e.target.value;
    drawGeo();
  });

  addEventListener('resize', () => { clearTimeout(S._rz); S._rz = setTimeout(() => render(S.page), 200); });

  // Las fuentes se sirven con `font-display: swap`, asi que la primera pintura
  // usa la fallback del sistema y el texto cambia de metricas cuando Plex acaba
  // de cargar. Plotly mide el contenedor una sola vez al dibujar: si mide antes
  // de ese cambio, los graficos se quedan con el ancho equivocado. Esperar a
  // `document.fonts.ready` cuesta unos milisegundos y evita el reflujo.
  try { await document.fonts.ready; } catch (_) {}

  S.view = S.trips;
  refresh();
  goTo(location.hash.slice(1) || 'overview', false);
}

boot();
})();
