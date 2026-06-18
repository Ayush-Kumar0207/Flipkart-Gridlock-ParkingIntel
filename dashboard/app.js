/**
 * SignalFlow — Parking Intelligence Platform
 * Main Dashboard Application
 * Flipkart Gridlock 2.0 | Theme 1
 */

// ============================================================
// GLOBALS & STATE
// ============================================================
let map = null;
let patrolMap = null;
let heatLayer = null;
let clusterMarkers = [];
let patrolMarkers = [];
let patrolRouteLayer = null;
let patrolStationLookup = new Map();
let hourlyAnimData = {};
let isPlaying = false;
let playInterval = null;
let charts = {};
let tourStep = 0;
let operationsBriefData = null;
let allHotspotsData = [];
let hotspotMode = 'priority';
let heatVisible = true;
let zoneSearchIndex = [];
let selectedCommandItem = null;
let commandHighlightLayer = null;
const IS_CAPTURE_MODE = new URLSearchParams(window.location.search).has('shot');

// Chart.js global dark theme
Chart.defaults.color = '#8b93b3';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.plugins.legend.labels.usePointStyle = false;
Chart.defaults.plugins.legend.labels.boxWidth = 28;
Chart.defaults.plugins.legend.labels.boxHeight = 3;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15,21,53,0.95)';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(40,116,240,0.3)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.titleFont = { weight: '600', size: 13 };
Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.elements.bar.borderRadius = 4;
Chart.defaults.animation.duration = 800;

const COLORS = {
    blue: '#2874F0', blueLight: '#5a9cf5', blueFaded: 'rgba(40,116,240,0.3)',
    yellow: '#FFE500', yellowFaded: 'rgba(255,229,0,0.3)',
    critical: '#ff4757', high: '#ff8c42', medium: '#ffd166', low: '#06d6a0',
    purple: '#a855f7', pink: '#ec4899', teal: '#14b8a6', indigo: '#6366f1',
    chartColors: ['#2874F0','#FFE500','#ff4757','#06d6a0','#ff8c42','#a855f7','#ec4899','#14b8a6','#6366f1','#ffd166'],
};

const SEVERITY_COLORS = { Critical: COLORS.critical, High: COLORS.high, Medium: COLORS.medium, Low: COLORS.low };
const MAX_VISIBLE_HOTSPOTS = 140;

function formatNumber(value, digits = 0) {
    const num = Number(value) || 0;
    return num.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getPanelPosition(id) {
    try {
        const saved = localStorage.getItem(`signalflow:${id}:pos`);
        return saved ? JSON.parse(saved) : null;
    } catch (_) {
        return null;
    }
}

function savePanelPosition(id, x, y) {
    try {
        localStorage.setItem(`signalflow:${id}:pos`, JSON.stringify({
            x: Math.round(x),
            y: Math.round(y),
        }));
    } catch (_) {
        // Dragging should still work in browsers that block storage.
    }
}

function clearPanelPosition(id) {
    try {
        localStorage.removeItem(`signalflow:${id}:pos`);
    } catch (_) {
        // Ignore storage failures; the visual reset below is the important part.
    }
}

function initFloatingPanels() {
    if (window.matchMedia('(max-width: 768px)').matches) return;

    const panels = [
        'commandPanel',
        'zoneCommandPanel',
        'hotspotDetail',
        'mapLegend',
        'mapLensPanel',
        'opsBriefPanel',
        'routeBrief',
    ];

    panels.forEach(id => {
        const panel = document.getElementById(id);
        const parent = panel?.parentElement;
        if (!panel || !parent || panel.dataset.dragReady === 'true') return;

        panel.dataset.dragReady = 'true';
        panel.classList.add('floating-panel');

        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'panel-drag-grip';
        handle.setAttribute('aria-label', `Move ${id}`);
        handle.title = 'Drag panel';
        handle.textContent = '⋮⋮';
        panel.appendChild(handle);

        const saved = getPanelPosition(id);
        if (saved) {
            placePanel(panel, parent, saved.x, saved.y);
        }

        let dragState = null;

        const startDrag = (event) => {
            const parentRect = parent.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            dragState = {
                startX: event.clientX,
                startY: event.clientY,
                originX: panelRect.left - parentRect.left,
                originY: panelRect.top - parentRect.top,
            };
            panel.classList.add('is-dragging');
        };

        const moveDrag = (event) => {
            if (!dragState) return;
            const x = dragState.originX + event.clientX - dragState.startX;
            const y = dragState.originY + event.clientY - dragState.startY;
            placePanel(panel, parent, x, y);
        };

        handle.addEventListener('pointerdown', event => {
            event.preventDefault();
            event.stopPropagation();
            startDrag(event);
            document.addEventListener('mousemove', moveDrag);
            document.addEventListener('mouseup', finishMouseDrag, { once: true });
            handle.setPointerCapture(event.pointerId);
        });

        handle.addEventListener('pointermove', moveDrag);

        const finishDrag = (event = {}) => {
            if (!dragState) return;
            dragState = null;
            panel.classList.remove('is-dragging');
            document.removeEventListener('mousemove', moveDrag);
            const parentRect = parent.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            savePanelPosition(id, panelRect.left - parentRect.left, panelRect.top - parentRect.top);
            if (event.pointerId !== undefined) handle.releasePointerCapture(event.pointerId);
        };

        const finishMouseDrag = event => {
            finishDrag(event);
        };

        handle.addEventListener('pointerup', finishDrag);
        handle.addEventListener('pointercancel', finishDrag);
        handle.addEventListener('mousedown', event => {
            if (event.button !== 0 || dragState) return;
            event.preventDefault();
            event.stopPropagation();
            startDrag(event);
            document.addEventListener('mousemove', moveDrag);
            document.addEventListener('mouseup', finishMouseDrag, { once: true });
        });
        handle.addEventListener('dblclick', event => {
            event.preventDefault();
            clearPanelPosition(id);
            panel.style.left = '';
            panel.style.top = '';
            panel.style.right = '';
            panel.style.bottom = '';
        });
    });

    window.addEventListener('resize', () => {
        panels.forEach(id => {
            const panel = document.getElementById(id);
            const parent = panel?.parentElement;
            if (!panel || !parent || !panel.style.left || !panel.style.top) return;
            placePanel(panel, parent, parseFloat(panel.style.left), parseFloat(panel.style.top));
        });
    }, { passive: true });
}

function placePanel(panel, parent, x, y) {
    const margin = 10;
    const parentRect = parent.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const maxX = Math.max(margin, parentRect.width - panelRect.width - margin);
    const maxY = Math.max(margin, parentRect.height - panelRect.height - margin);
    const nextX = Math.min(Math.max(margin, x), maxX);
    const nextY = Math.min(Math.max(margin, y), maxY);

    panel.style.left = `${nextX}px`;
    panel.style.top = `${nextY}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
}

function configureMapWheelPan(leafletMap) {
    const container = leafletMap.getContainer();
    leafletMap.scrollWheelZoom.disable();

    container.addEventListener('wheel', (event) => {
        if (event.ctrlKey) {
            event.preventDefault();
            const direction = event.deltaY > 0 ? -1 : 1;
            const minZoom = Number.isFinite(leafletMap.getMinZoom()) ? leafletMap.getMinZoom() : 0;
            const maxZoom = Number.isFinite(leafletMap.getMaxZoom()) ? leafletMap.getMaxZoom() : 19;
            const nextZoom = Math.max(
                minZoom,
                Math.min(maxZoom, leafletMap.getZoom() + direction)
            );
            leafletMap.setZoomAround(leafletMap.mouseEventToContainerPoint(event), nextZoom);
            return;
        }

        event.preventDefault();
        const deltaX = Math.max(-180, Math.min(180, event.deltaX));
        const deltaY = Math.max(-180, Math.min(180, event.deltaY));
        leafletMap.panBy([deltaX, deltaY], { animate: false });
    }, { passive: false });
}

function setHeatLayerOpacity() {
    if (heatLayer && heatLayer._canvas) heatLayer._canvas.style.opacity = heatVisible ? '0.26' : '0';
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadJSON(file) {
    try {
        const resp = await fetch(`data/${file}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        console.warn(`Failed to load ${file}:`, e.message);
        return null;
    }
}

async function loadAllData() {
    const [stats, hotspots, heatmap, temporal, impact, forecasts, enforcement, hourlyAnim, operationsBrief] = await Promise.all([
        loadJSON('stats.json'),
        loadJSON('hotspots.json'),
        loadJSON('heatmap_data.json'),
        loadJSON('temporal.json'),
        loadJSON('impact_scores.json'),
        loadJSON('forecasts.json'),
        loadJSON('enforcement.json'),
        loadJSON('hourly_animation.json'),
        loadJSON('operations_brief.json'),
    ]);
    return { stats, hotspots, heatmap, temporal, impact, forecasts, enforcement, hourlyAnim, operationsBrief };
}

// ============================================================
// VIEW NAVIGATION
// ============================================================
function initNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const viewId = tab.dataset.view;
            switchView(viewId);
        });
    });
}

function switchView(viewId) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector(`[data-view="${viewId}"]`).classList.add('active');
    document.getElementById(`view-${viewId}`).classList.add('active');

    // Lazy-init maps
    if (viewId !== 'map' && map && heatLayer && map.hasLayer(heatLayer)) {
        map.removeLayer(heatLayer);
    }
    if (viewId === 'map' && map) {
        requestAnimationFrame(() => {
            map.invalidateSize();
            if (heatVisible && heatLayer && !map.hasLayer(heatLayer)) {
                heatLayer.addTo(map);
                setHeatLayerOpacity();
            }
        });
    }
    if (viewId === 'patrol' && patrolMap) patrolMap.invalidateSize();
}

function getRequestedView() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('view') || window.location.hash.replace('#', '');
    return ['map', 'analytics', 'patrol', 'forecast'].includes(requested) ? requested : 'map';
}

function applyInitialViewFromUrl() {
    switchView(getRequestedView());
}

// ============================================================
// KPI CARDS
// ============================================================
function renderKPIs(stats, hotspots) {
    if (!stats) return;
    animateNumber('kpi-total-val', stats.total_violations);
    animateNumber('kpi-hotspots-val', hotspots ? hotspots.length : 0);
    animateNumber('kpi-daily-val', stats.avg_daily_violations);
    document.getElementById('kpi-mainroad-val').textContent = stats.main_road_pct + '%';
    document.getElementById('kpi-heavy-val').textContent = stats.heavy_vehicle_pct + '%';
}

function animateNumber(elId, target) {
    const el = document.getElementById(elId);
    if (!el) return;
    const targetNum = parseInt(target);
    if (IS_CAPTURE_MODE) {
        el.textContent = targetNum.toLocaleString();
        return;
    }
    const duration = 1200;
    const start = performance.now();

    function step(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(eased * targetNum).toLocaleString();
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function renderOpsBrief(opsBrief) {
    if (!opsBrief || !opsBrief.top_action || !opsBrief.city_brief) return;

    operationsBriefData = opsBrief;
    const city = opsBrief.city_brief;
    const action = opsBrief.top_action;

    const title = `${action.station}: deploy ${action.recommended_units} units during ${action.peak_window}`;
    const peakWindowShort = city.top_peak_window.label.replace(/:00/g, '');
    document.getElementById('opsBriefTitle').textContent = title;
    document.getElementById('opsPeakWindow').textContent =
        `${peakWindowShort} (${city.top_peak_window.share_pct}%)`;
    document.getElementById('opsTopZone').textContent = action.station;
    document.getElementById('opsDailyTarget').textContent =
        `${formatNumber(action.peak_window_daily_avg, 1)}/day`;
    document.getElementById('opsModeledReduction').textContent =
        `${formatNumber(action.modeled_weekly_reduction)}/week`;
}

// ============================================================
// MAP (View 1)
// ============================================================
function initMap(heatmapData, hotspots, hourlyAnim) {
    hourlyAnimData = hourlyAnim || {};
    allHotspotsData = hotspots || [];

    map = L.map('map', {
        center: [12.97, 77.59],
        zoom: 12,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
        wheelDebounceTime: 24,
        zoomSnap: 0.5,
        zoomDelta: 0.5,
    });
    configureMapWheelPan(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(map);

    // Heatmap layer
    if (heatmapData && heatmapData.length > 0) {
        heatLayer = L.heatLayer(heatmapData, {
            radius: 20,
            blur: 30,
            maxZoom: 14,
            max: 1.45,
            minOpacity: 0.08,
            gradient: { 0.28: '#102858', 0.58: '#2874F0', 0.84: '#FFE500', 1.0: '#ffb020' },
        });
        if (getRequestedView() === 'map') {
            requestAnimationFrame(() => {
                heatLayer.addTo(map);
                setHeatLayerOpacity();
            });
        }
    }

    // Hotspot markers
    if (hotspots) {
        renderHotspotMarkers(hotspots);
    }

    // Time slider
    initTimeSlider();
    initMapLensControls();
}

function renderHotspotMarkers(hotspots) {
    clusterMarkers.forEach(m => map.removeLayer(m));
    clusterMarkers = [];

    const limit = hotspotMode === 'audit' ? hotspots.length : MAX_VISIBLE_HOTSPOTS;
    const visibleHotspots = [...hotspots]
        .sort((a, b) => (a.rank || 9999) - (b.rank || 9999))
        .slice(0, limit);

    visibleHotspots.forEach(h => {
        const color = SEVERITY_COLORS[h.severity] || COLORS.low;
        const radius = Math.max(4.5, Math.min(15, 3.8 + Math.sqrt(h.count) * 0.32));
        const isPriority = h.severity === 'Critical' || h.severity === 'High';

        const marker = L.circleMarker([h.lat, h.lon], {
            radius: radius,
            fillColor: color,
            fillOpacity: isPriority ? 0.2 : 0.1,
            color: color,
            weight: isPriority ? 1.8 : 1.2,
            opacity: isPriority ? 0.86 : 0.58,
            bubblingMouseEvents: false,
        }).addTo(map);

        const popupContent = `
            <div class="popup-title">Hotspot #${h.rank} — ${h.severity}</div>
            <div class="popup-row"><span class="popup-label">Violations</span><span class="popup-value">${h.count.toLocaleString()}</span></div>
            <div class="popup-row"><span class="popup-label">Top Violation</span><span class="popup-value">${h.dominant_violation}</span></div>
            <div class="popup-row"><span class="popup-label">Top Vehicle</span><span class="popup-value">${h.dominant_vehicle}</span></div>
            <div class="popup-row"><span class="popup-label">Peak Hour</span><span class="popup-value">${h.peak_hour}:00 IST</span></div>
            <div class="popup-row"><span class="popup-label">Main Road %</span><span class="popup-value">${(h.main_road_frac * 100).toFixed(1)}%</span></div>
            <div class="popup-row"><span class="popup-label">Heavy Vehicle %</span><span class="popup-value">${(h.frac_heavy * 100).toFixed(1)}%</span></div>
        `;
        marker.bindPopup(popupContent, { maxWidth: 280 });

        marker.on('click', () => showHotspotDetail(h));
        clusterMarkers.push(marker);
    });

    updateMapLensStatus(visibleHotspots.length, hotspots.length);
}

function initMapLensControls() {
    document.querySelectorAll('[data-hotspot-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            hotspotMode = btn.dataset.hotspotMode;
            document.querySelectorAll('[data-hotspot-mode]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderHotspotMarkers(allHotspotsData);
        });
    });

    const densityToggle = document.getElementById('densityToggle');
    densityToggle?.addEventListener('click', () => {
        heatVisible = !heatVisible;
        densityToggle.classList.toggle('active', heatVisible);
        densityToggle.textContent = heatVisible ? 'Density Backdrop' : 'Density Hidden';
        if (heatLayer && map) {
            if (heatVisible && !map.hasLayer(heatLayer)) heatLayer.addTo(map);
            if (!heatVisible && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
            setHeatLayerOpacity();
        }
    });

    updateMapLensStatus(Math.min(allHotspotsData.length, MAX_VISIBLE_HOTSPOTS), allHotspotsData.length);
}

function updateMapLensStatus(visible, total) {
    const status = document.getElementById('lensStatus');
    if (!status) return;
    status.textContent = hotspotMode === 'audit'
        ? `Auditing all ${formatNumber(total)} detected clusters`
        : `Showing top ${formatNumber(visible)} priority clusters of ${formatNumber(total)}`;
}

function showHotspotDetail(h) {
    const panel = document.getElementById('hotspotDetail');
    const grid = document.getElementById('detailGrid');
    const commandPanel = document.getElementById('zoneCommandPanel');
    if (commandPanel) commandPanel.style.display = 'none';
    document.getElementById('detailTitle').textContent = `Hotspot #${h.rank}`;

    grid.innerHTML = `
        <div class="detail-item"><div class="detail-item-label">Severity</div><div class="detail-item-value" style="color:${SEVERITY_COLORS[h.severity]}">${h.severity}</div></div>
        <div class="detail-item"><div class="detail-item-label">Violations</div><div class="detail-item-value">${h.count.toLocaleString()}</div></div>
        <div class="detail-item"><div class="detail-item-label">Peak Hour</div><div class="detail-item-value">${h.peak_hour}:00 IST</div></div>
        <div class="detail-item"><div class="detail-item-label">Spread</div><div class="detail-item-value">${Math.round(h.spread_m)}m</div></div>
        <div class="detail-item full"><div class="detail-item-label">Dominant Violation</div><div class="detail-item-value">${h.dominant_violation}</div></div>
        <div class="detail-item full"><div class="detail-item-label">Dominant Vehicle</div><div class="detail-item-value">${h.dominant_vehicle}</div></div>
        <div class="detail-item"><div class="detail-item-label">Main Road %</div><div class="detail-item-value">${(h.main_road_frac*100).toFixed(1)}%</div></div>
        <div class="detail-item"><div class="detail-item-label">Heavy Vehicles</div><div class="detail-item-value">${(h.frac_heavy*100).toFixed(1)}%</div></div>
        <div class="detail-item"><div class="detail-item-label">Junctions</div><div class="detail-item-value">${h.num_junctions}</div></div>
        <div class="detail-item"><div class="detail-item-label">Coordinates</div><div class="detail-item-value">${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}</div></div>
    `;
    panel.style.display = 'block';

    // Hide ops-brief to prevent overlap
    const opsBrief = document.querySelector('.ops-brief-panel');
    if (opsBrief) opsBrief.style.display = 'none';
}

document.getElementById('closeDetail')?.addEventListener('click', () => {
    document.getElementById('hotspotDetail').style.display = 'none';
    // Restore ops-brief panel
    const opsBrief = document.querySelector('.ops-brief-panel');
    if (opsBrief) opsBrief.style.display = '';
});

// Dataset-native search and station command card
function initCommandCenter(opsBrief, hotspots, forecasts) {
    const input = document.getElementById('zoneSearchInput');
    const results = document.getElementById('zoneSearchResults');
    const closeBtn = document.getElementById('closeZoneCommand');
    const patrolBtn = document.getElementById('zoneCommandPatrol');
    if (!input || !results) return;

    zoneSearchIndex = buildZoneSearchIndex(opsBrief, hotspots, forecasts);

    input.addEventListener('input', () => renderZoneSearchResults(input.value));
    input.addEventListener('focus', () => {
        const zonePanel = document.getElementById('zoneCommandPanel');
        if (zonePanel) zonePanel.style.display = 'none';
        if (commandHighlightLayer && map) {
            map.removeLayer(commandHighlightLayer);
            commandHighlightLayer = null;
        }
        const opsBriefPanel = document.querySelector('.ops-brief-panel');
        if (opsBriefPanel) opsBriefPanel.style.display = 'none';
        renderZoneSearchResults(input.value);
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const first = results.querySelector('.zone-result');
            if (first) first.click();
            results.innerHTML = '';
            input.blur();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            results.innerHTML = '';
            input.blur();
            closeZoneCommand();
        }
    });
    document.addEventListener('click', (event) => {
        const commandPanel = document.getElementById('commandPanel');
        const zonePanel = document.getElementById('zoneCommandPanel');
        const hotspotPanel = document.getElementById('hotspotDetail');
        if (commandPanel?.contains(event.target)) return;
        results.innerHTML = '';
        if (zonePanel?.style.display !== 'block' && hotspotPanel?.style.display !== 'block') {
            const opsBriefPanel = document.querySelector('.ops-brief-panel');
            if (opsBriefPanel) opsBriefPanel.style.display = '';
        }
    });
    closeBtn?.addEventListener('click', closeZoneCommand);
    patrolBtn?.addEventListener('click', openSelectedInPatrol);
}

function buildZoneSearchIndex(opsBrief, hotspots, forecasts) {
    const items = [];
    const stationForecasts = forecasts?.station_forecasts || {};
    const playbooks = opsBrief?.station_playbooks || [];
    const seenJunctions = new Set();

    playbooks.forEach(playbook => {
        items.push({
            type: 'station',
            label: playbook.station,
            subtitle: `Station playbook | CIS ${playbook.cis} | ${playbook.peak_window}`,
            searchText: [
                playbook.station,
                playbook.reason_tags?.join(' '),
                playbook.top_junctions?.map(j => j.name).join(' '),
            ].join(' ').toLowerCase(),
            lat: playbook.lat,
            lon: playbook.lon,
            playbook,
            forecast: stationForecasts[playbook.station],
            score: 100000 + (playbook.priority_score || playbook.cis || 0),
        });

        (playbook.top_junctions || []).forEach(junction => {
            const key = junction.name.toLowerCase();
            if (seenJunctions.has(key)) return;
            seenJunctions.add(key);
            items.push({
                type: 'junction',
                label: junction.name,
                subtitle: `${playbook.station} | ${formatNumber(junction.violations)} violations | peak ${junction.peak_hour}:00`,
                searchText: `${junction.name} ${playbook.station}`.toLowerCase(),
                lat: playbook.lat,
                lon: playbook.lon,
                playbook,
                junction,
                forecast: stationForecasts[playbook.station],
                score: 50000 + (junction.violations || 0),
            });
        });
    });

    [...(hotspots || [])]
        .sort((a, b) => (a.rank || 9999) - (b.rank || 9999))
        .slice(0, 160)
        .forEach(h => {
            items.push({
                type: 'hotspot',
                label: `Hotspot #${h.rank}`,
                subtitle: `${h.severity} | ${formatNumber(h.count)} violations | ${h.dominant_violation}`,
                searchText: `hotspot ${h.rank} ${h.severity} ${h.dominant_violation} ${h.dominant_vehicle}`.toLowerCase(),
                lat: h.lat,
                lon: h.lon,
                hotspot: h,
                score: 25000 + (1000 - (h.rank || 999)),
            });
        });

    return items.sort((a, b) => b.score - a.score);
}

function renderZoneSearchResults(query) {
    const results = document.getElementById('zoneSearchResults');
    if (!results) return;
    const normalized = query.trim().toLowerCase();
    const matches = zoneSearchIndex
        .filter(item => !normalized || item.searchText.includes(normalized) || item.label.toLowerCase().includes(normalized))
        .slice(0, normalized ? 7 : 4);

    if (normalized && matches.length === 0) {
        results.innerHTML = '<div class="zone-empty">No matching station, junction, or hotspot</div>';
        return;
    }

    results.innerHTML = matches.map((item, index) => `
        <button class="zone-result" type="button" data-zone-index="${zoneSearchIndex.indexOf(item)}">
            <span class="zone-result-type">${item.type}</span>
            <span class="zone-result-main">${escapeHtml(item.label)}</span>
            <span class="zone-result-sub">${escapeHtml(item.subtitle)}</span>
        </button>
    `).join('');

    results.querySelectorAll('.zone-result').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = zoneSearchIndex[Number(btn.dataset.zoneIndex)];
            if (item) focusCommandItem(item);
        });
    });
}

function focusCommandItem(item) {
    selectedCommandItem = item;
    const input = document.getElementById('zoneSearchInput');
    const results = document.getElementById('zoneSearchResults');
    if (input) input.value = item.label;
    if (results) results.innerHTML = '';
    requestAnimationFrame(() => {
        const currentResults = document.getElementById('zoneSearchResults');
        if (currentResults) currentResults.innerHTML = '';
    });

    if (map && item.lat && item.lon) {
        map.flyTo([item.lat, item.lon], item.type === 'hotspot' ? 15 : 13.7, { duration: 0.75 });
        renderCommandHighlight(item);
    }

    if (item.type === 'hotspot') {
        const commandPanel = document.getElementById('zoneCommandPanel');
        if (commandPanel) commandPanel.style.display = 'none';
        showHotspotDetail(item.hotspot);
    } else {
        document.getElementById('hotspotDetail').style.display = 'none';
        showZoneCommand(item);
    }
}

function renderCommandHighlight(item) {
    if (!map) return;
    if (commandHighlightLayer) map.removeLayer(commandHighlightLayer);
    commandHighlightLayer = L.layerGroup().addTo(map);
    const color = item.type === 'hotspot'
        ? SEVERITY_COLORS[item.hotspot?.severity] || COLORS.yellow
        : COLORS.yellow;

    L.circle([item.lat, item.lon], {
        radius: item.type === 'hotspot' ? 280 : 900,
        color,
        weight: 2,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: 0.08,
        dashArray: '8 8',
    }).addTo(commandHighlightLayer);

    L.circleMarker([item.lat, item.lon], {
        radius: 7,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
    }).addTo(commandHighlightLayer);
}

function showZoneCommand(item) {
    const playbook = item.playbook;
    if (!playbook) return;

    const panel = document.getElementById('zoneCommandPanel');
    document.getElementById('zoneCommandType').textContent =
        item.type === 'junction' ? 'Junction routed to station playbook' : 'Station Playbook';
    document.getElementById('zoneCommandTitle').textContent = item.label;
    document.getElementById('zoneCommandSummary').textContent =
        `${playbook.station}: deploy ${playbook.recommended_units} units during ${playbook.peak_window}. ` +
        `Expected impact is ${formatNumber(playbook.modeled_weekly_reduction)} fewer weekly peak-window violations.`;

    document.getElementById('zoneCommandGrid').innerHTML = `
        <div><span>CIS</span><strong>${formatNumber(playbook.cis, 1)}</strong></div>
        <div><span>Violations</span><strong>${formatNumber(playbook.total_violations)}</strong></div>
        <div><span>Peak Demand</span><strong>${formatNumber(playbook.peak_window_daily_avg, 1)}/day</strong></div>
        <div><span>Trend</span><strong>${playbook.trend_pct >= 0 ? '+' : ''}${formatNumber(playbook.trend_pct, 1)}%</strong></div>
    `;

    document.getElementById('zoneCommandTags').innerHTML = (playbook.reason_tags || [])
        .map(tag => `<span>${escapeHtml(tag)}</span>`)
        .join('');

    const forecast = item.forecast?.forecast || [];
    const forecastLine = forecast.length
        ? `<div class="zone-forecast-strip">${forecast.map(v => `<span>${formatNumber(v)}</span>`).join('')}</div>`
        : '';
    document.getElementById('zoneCommandJunctions').innerHTML = `
        <div class="zone-section-title">Evidence junctions</div>
        ${(playbook.top_junctions || []).map(j => `
            <div class="zone-junction-row">
                <span>${escapeHtml(j.name)}</span>
                <strong>${formatNumber(j.violations)}</strong>
            </div>
        `).join('')}
        ${forecastLine ? `<div class="zone-section-title">7-day station forecast</div>${forecastLine}` : ''}
    `;

    panel.style.display = 'block';
    const opsBrief = document.querySelector('.ops-brief-panel');
    if (opsBrief) opsBrief.style.display = 'none';
}

function closeZoneCommand() {
    document.getElementById('zoneCommandPanel').style.display = 'none';
    selectedCommandItem = null;
    if (commandHighlightLayer && map) {
        map.removeLayer(commandHighlightLayer);
        commandHighlightLayer = null;
    }
    const opsBrief = document.querySelector('.ops-brief-panel');
    if (opsBrief) opsBrief.style.display = '';
}

function openSelectedInPatrol() {
    if (!selectedCommandItem?.playbook) return;
    const station = selectedCommandItem.playbook.station;
    switchView('patrol');
    requestAnimationFrame(() => {
        const rec = patrolStationLookup.get(station);
        if (rec && patrolMap) {
            patrolMap.invalidateSize();
            patrolMap.flyTo([rec.lat, rec.lon], 14, { duration: 0.75 });
        }
    });
}

// Time slider
function initTimeSlider() {
    const slider = document.getElementById('timeSlider');
    const label = document.getElementById('sliderTimeLabel');
    const playBtn = document.getElementById('playBtn');

    slider.addEventListener('input', () => {
        const hour = parseInt(slider.value);
        updateMapForHour(hour);
        label.textContent = hour === -1 ? 'All Hours' : `${hour.toString().padStart(2,'0')}:00 IST`;
    });

    playBtn.addEventListener('click', togglePlay);
}

function updateMapForHour(hour) {
    if (!heatLayer || !map) return;

    if (hour === -1) {
        // Show all data
        loadJSON('heatmap_data.json').then(data => {
            if (data) heatLayer.setLatLngs(data);
        });
        return;
    }

    const hourKey = String(hour);
    if (hourlyAnimData && hourlyAnimData[hourKey]) {
        heatLayer.setLatLngs(hourlyAnimData[hourKey]);
    }
}

function togglePlay() {
    const playBtn = document.getElementById('playBtn');
    const slider = document.getElementById('timeSlider');
    const label = document.getElementById('sliderTimeLabel');

    if (isPlaying) {
        clearInterval(playInterval);
        isPlaying = false;
        playBtn.classList.remove('playing');
        playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    } else {
        isPlaying = true;
        playBtn.classList.add('playing');
        playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

        let hour = parseInt(slider.value);
        if (hour >= 23) hour = -1;

        playInterval = setInterval(() => {
            hour++;
            if (hour > 23) hour = 0;
            slider.value = hour;
            label.textContent = `${hour.toString().padStart(2,'0')}:00 IST`;
            updateMapForHour(hour);
        }, 1200);
    }
}

// ============================================================
// ANALYTICS CHARTS (View 2)
// ============================================================
function renderAnalytics(temporal) {
    if (!temporal) return;

    // Hourly pattern
    if (temporal.hourly) {
        charts.hourly = new Chart(document.getElementById('chartHourly'), {
            type: 'line',
            data: {
                labels: temporal.hourly.labels,
                datasets: [{
                    label: 'Violations',
                    data: temporal.hourly.values,
                    borderColor: COLORS.blue,
                    backgroundColor: COLORS.blueFaded,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: COLORS.blue,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
                    x: { grid: { display: false } },
                },
            }
        });
    }

    // Day of week
    if (temporal.daily) {
        charts.daily = new Chart(document.getElementById('chartDaily'), {
            type: 'bar',
            data: {
                labels: temporal.daily.labels.map(d => d.substring(0, 3)),
                datasets: [{
                    label: 'Violations',
                    data: temporal.daily.values,
                    backgroundColor: temporal.daily.values.map((v, i) =>
                        i >= 5 ? COLORS.yellowFaded : COLORS.blueFaded
                    ),
                    borderColor: temporal.daily.values.map((v, i) =>
                        i >= 5 ? COLORS.yellow : COLORS.blue
                    ),
                    borderWidth: 1.5,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
                    x: { grid: { display: false } },
                },
            }
        });
    }

    // Vehicle types (doughnut)
    if (temporal.vehicle_types) {
        charts.vehicles = new Chart(document.getElementById('chartVehicles'), {
            type: 'doughnut',
            data: {
                labels: temporal.vehicle_types.labels,
                datasets: [{
                    data: temporal.vehicle_types.values,
                    backgroundColor: COLORS.chartColors,
                    borderColor: 'rgba(10,14,39,0.8)',
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'right', labels: { font: { size: 11 }, padding: 8 } },
                },
            }
        });
    }

    // Weekday vs Weekend
    if (temporal.weekday_vs_weekend) {
        charts.weekdayWeekend = new Chart(document.getElementById('chartWeekdayWeekend'), {
            type: 'line',
            data: {
                labels: temporal.weekday_vs_weekend.labels,
                datasets: [
                    {
                        label: 'Weekday Avg',
                        data: temporal.weekday_vs_weekend.weekday_avg,
                        borderColor: COLORS.blue,
                        backgroundColor: 'rgba(40,116,240,0.1)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2,
                    },
                    {
                        label: 'Weekend Avg',
                        data: temporal.weekday_vs_weekend.weekend_avg,
                        borderColor: COLORS.yellow,
                        backgroundColor: 'rgba(255,229,0,0.08)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
                    x: { grid: { display: false } },
                },
            }
        });
    }

    // Violation types (horizontal bar)
    if (temporal.violation_types) {
        charts.violations = new Chart(document.getElementById('chartViolations'), {
            type: 'bar',
            data: {
                labels: temporal.violation_types.labels.map(l => l.length > 20 ? l.substring(0, 18) + '…' : l),
                datasets: [{
                    label: 'Count',
                    data: temporal.violation_types.values,
                    backgroundColor: COLORS.chartColors,
                    borderWidth: 0,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { grid: { display: false }, ticks: { font: { size: 10 } } },
                },
            }
        });
    }

    // Monthly trend
    if (temporal.monthly) {
        charts.monthly = new Chart(document.getElementById('chartMonthly'), {
            type: 'bar',
            data: {
                labels: temporal.monthly.labels,
                datasets: [{
                    label: 'Violations',
                    data: temporal.monthly.values,
                    backgroundColor: COLORS.blueFaded,
                    borderColor: COLORS.blue,
                    borderWidth: 1.5,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
                    x: { grid: { display: false } },
                },
            }
        });
    }

    // Top stations
    if (temporal.station_rankings) {
        const topN = 10;
        charts.stations = new Chart(document.getElementById('chartStations'), {
            type: 'bar',
            data: {
                labels: temporal.station_rankings.labels.slice(0, topN),
                datasets: [{
                    label: 'Violations',
                    data: temporal.station_rankings.values.slice(0, topN),
                    backgroundColor: COLORS.chartColors,
                    borderWidth: 0,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { grid: { display: false }, ticks: { font: { size: 10 } } },
                },
            }
        });
    }

    // Daily timeline
    if (temporal.daily_timeseries) {
        const dates = temporal.daily_timeseries.dates;
        const counts = temporal.daily_timeseries.counts;
        charts.timeline = new Chart(document.getElementById('chartTimeline'), {
            type: 'line',
            data: {
                labels: dates.map(d => {
                    const parts = d.split('-');
                    return `${parts[1]}/${parts[2]}`;
                }),
                datasets: [{
                    label: 'Daily Violations',
                    data: counts,
                    borderColor: COLORS.blue,
                    backgroundColor: 'rgba(40,116,240,0.08)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 1.5,
                    pointRadius: 1,
                    pointHoverRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 15, font: { size: 9 } } },
                },
            }
        });
    }
}

// ============================================================
// PATROL PLANNER (View 3)
// ============================================================
function initPatrolView(enforcement, opsBrief) {
    if (!enforcement || enforcement.length === 0) return;
    const playbookMap = new Map((opsBrief?.station_playbooks || []).map(p => [p.station, p]));
    patrolStationLookup = new Map(enforcement.map(rec => [rec.station, rec]));

    // Init patrol map
    patrolMap = L.map('patrolMap', {
        center: [12.97, 77.59],
        zoom: 12,
        scrollWheelZoom: false,
        wheelDebounceTime: 24,
        zoomSnap: 0.5,
        zoomDelta: 0.5,
    });
    configureMapWheelPan(patrolMap);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OSM &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(patrolMap);

    // Add patrol zone markers
    let totalViolations = 0;
    let totalReduction = 0;

    enforcement.forEach((rec, i) => {
        const color = rec.cis > 55 ? COLORS.critical : rec.cis > 45 ? COLORS.high : rec.cis > 30 ? COLORS.medium : COLORS.low;

        const circle = L.circle([rec.lat, rec.lon], {
            radius: 600,
            fillColor: color,
            fillOpacity: 0.15,
            color: color,
            weight: 2,
            opacity: 0.6,
        }).addTo(patrolMap);

        const marker = L.marker([rec.lat, rec.lon], {
            icon: L.divIcon({
                className: 'patrol-number-icon',
                html: `<div style="
                    background:${color}; color:#050816; width:24px; height:24px;
                    border-radius:50%; display:flex; align-items:center; justify-content:center;
                    font-weight:700; font-size:11px; font-family:'JetBrains Mono',monospace;
                    box-shadow: 0 0 12px ${color}80;
                ">${i + 1}</div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12],
            }),
        }).addTo(patrolMap);

        marker.bindPopup(`
            <div class="popup-title">${rec.station}</div>
            <div class="popup-row"><span class="popup-label">CIS Score</span><span class="popup-value">${rec.cis}</span></div>
            <div class="popup-row"><span class="popup-label">Violations</span><span class="popup-value">${rec.total_violations.toLocaleString()}</span></div>
            <div class="popup-row"><span class="popup-label">Peak Hours</span><span class="popup-value">${rec.peak_hours_str}</span></div>
            <div class="popup-row"><span class="popup-label">Peak Demand</span><span class="popup-value">${formatNumber(rec.peak_window_daily_avg, 1)}/day</span></div>
            <div class="popup-row"><span class="popup-label">Patrol Units</span><span class="popup-value">${rec.recommended_units}</span></div>
            <div class="popup-row"><span class="popup-label">Est. Reduction</span><span class="popup-value" style="color:#06d6a0">${rec.expected_reduction_pct}%</span></div>
        `);

        patrolMarkers.push(marker);
        totalViolations += rec.total_violations;
        totalReduction += rec.expected_reduction_pct;
    });

    // Render patrol list
    const list = document.getElementById('patrolList');
    list.innerHTML = '';
    enforcement.forEach((rec, i) => {
        const playbook = playbookMap.get(rec.station);
        const tags = playbook?.reason_tags || [];
        const tagHtml = tags.map(tag => `<span class="patrol-tag">${tag}</span>`).join('');
        const item = document.createElement('div');
        item.className = 'patrol-item';
        item.innerHTML = `
            <div class="patrol-item-header">
                <span class="patrol-item-name">${i+1}. ${rec.station}</span>
                <span class="patrol-item-cis">CIS ${rec.cis}</span>
            </div>
            <div class="patrol-item-details">
                <span class="patrol-item-detail">🕐 ${rec.peak_hours_str}</span>
                <span class="patrol-item-detail">🚔 ${rec.recommended_units} units</span>
                <span class="patrol-item-detail">${formatNumber(rec.peak_window_daily_avg, 1)}/day peak</span>
                <span class="patrol-item-detail" style="color:${COLORS.low}">↓${rec.expected_reduction_pct}%</span>
            </div>
            <div class="patrol-tags">${tagHtml}</div>
        `;
        item.addEventListener('click', () => {
            patrolMap.flyTo([rec.lat, rec.lon], 14, { duration: 1 });
        });
        list.appendChild(item);
    });

    // Summary
    document.getElementById('totalZones').textContent = enforcement.length;
    document.getElementById('estCoverage').textContent = totalViolations.toLocaleString() + ' violations';
    document.getElementById('projReduction').textContent = (totalReduction / enforcement.length).toFixed(0) + '% avg';

    initBudgetSimulator(opsBrief);
}

function initBudgetSimulator(opsBrief) {
    if (!opsBrief || !opsBrief.budget_scenarios) return;
    operationsBriefData = opsBrief;

    const slider = document.getElementById('budgetSlider');
    if (!slider) return;

    const renderCurrent = () => renderBudgetScenario(Number(slider.value));
    slider.addEventListener('input', renderCurrent);
    renderCurrent();
}

function getBudgetScenarios() {
    return [...(operationsBriefData?.budget_scenarios || [])]
        .sort((a, b) => Number(a.budget_units) - Number(b.budget_units));
}

function renderBudgetScenario(budget) {
    const scenarios = getBudgetScenarios();
    const scenario = scenarios.find(s => Number(s.budget_units) === Number(budget)) || scenarios[0];
    if (!scenario) return;

    document.getElementById('budgetUnits').textContent = `${scenario.budget_units} units`;
    document.getElementById('scenarioZones').textContent = scenario.zones_covered;
    document.getElementById('scenarioDemand').textContent =
        `${formatNumber(scenario.covered_peak_violations_per_day, 1)}`;
    document.getElementById('scenarioReduction').textContent =
        `${formatNumber(scenario.modeled_weekly_reduction)}`;

    const deployments = document.getElementById('scenarioDeployments');
    deployments.innerHTML = scenario.deployments.slice(0, 4).map(dep => `
        <div class="deployment-row">
            <span class="deployment-units">${dep.units}</span>
            <span class="deployment-station">${dep.station}</span>
            <span class="deployment-window">${dep.peak_window}</span>
        </div>
    `).join('');

    renderDeploymentFrontier(scenarios, scenario);
    renderPatrolRoute(scenario);
}

function renderDeploymentFrontier(scenarios, activeScenario) {
    const bars = document.getElementById('frontierBars');
    const marginal = document.getElementById('frontierMarginal');
    const slider = document.getElementById('budgetSlider');
    if (!bars || !marginal || !activeScenario || scenarios.length === 0) return;

    const maxReduction = Math.max(...scenarios.map(s => Number(s.modeled_weekly_reduction) || 0), 1);
    const activeIndex = scenarios.findIndex(s => Number(s.budget_units) === Number(activeScenario.budget_units));
    const previous = activeIndex > 0 ? scenarios[activeIndex - 1] : null;
    const gain = previous
        ? Number(activeScenario.modeled_weekly_reduction) - Number(previous.modeled_weekly_reduction)
        : Number(activeScenario.modeled_weekly_reduction);
    marginal.textContent = previous
        ? `+${formatNumber(gain)}/wk`
        : `${formatNumber(gain)}/wk base`;

    bars.innerHTML = scenarios.map(s => {
        const reduction = Number(s.modeled_weekly_reduction) || 0;
        const width = Math.max(8, Math.round((reduction / maxReduction) * 100));
        const isActive = Number(s.budget_units) === Number(activeScenario.budget_units);
        return `
            <button class="frontier-row${isActive ? ' active' : ''}" type="button" data-budget="${s.budget_units}" aria-label="Show ${s.budget_units} unit deployment">
                <span class="frontier-budget">${s.budget_units}u</span>
                <span class="frontier-track"><span class="frontier-fill" style="width:${width}%"></span></span>
                <span class="frontier-value">${formatNumber(reduction)}/wk</span>
            </button>
        `;
    }).join('');

    bars.querySelectorAll('.frontier-row').forEach(row => {
        row.addEventListener('click', () => {
            const nextBudget = Number(row.dataset.budget);
            if (slider) slider.value = nextBudget;
            renderBudgetScenario(nextBudget);
        });
    });
}

function renderPatrolRoute(scenario) {
    if (!patrolMap || !scenario) return;
    if (patrolRouteLayer) patrolMap.removeLayer(patrolRouteLayer);

    patrolRouteLayer = L.layerGroup().addTo(patrolMap);
    const stops = scenario.deployments
        .map(dep => ({ dep, rec: patrolStationLookup.get(dep.station) }))
        .filter(item => item.rec);
    const coords = stops.map(item => [item.rec.lat, item.rec.lon]);

    if (coords.length > 1) {
        L.polyline(coords, {
            color: COLORS.yellow,
            weight: 3,
            opacity: 0.72,
            dashArray: '8 8',
            lineCap: 'round',
        }).addTo(patrolRouteLayer);
    }

    stops.forEach((item, index) => {
        const { dep, rec } = item;
        L.circleMarker([rec.lat, rec.lon], {
            radius: 14 + Math.min(8, dep.units * 2),
            fillColor: COLORS.yellow,
            fillOpacity: 0.18,
            color: COLORS.yellow,
            weight: 2,
            opacity: 0.9,
        }).addTo(patrolRouteLayer).bindTooltip(
            `${index + 1}. ${dep.station}: ${dep.units} unit${dep.units > 1 ? 's' : ''}`,
            { direction: 'top', sticky: true }
        );
    });

    const routeTitle = document.getElementById('routeTitle');
    const routeMeta = document.getElementById('routeMeta');
    if (routeTitle) {
        routeTitle.textContent = `${scenario.budget_units} units across ${scenario.zones_covered} priority zones`;
    }
    if (routeMeta) {
        const frontierText = document.getElementById('frontierMarginal')?.textContent || 'frontier updated';
        routeMeta.textContent = `${formatNumber(scenario.covered_peak_violations_per_day, 1)} peak violations/day covered, ${formatNumber(scenario.modeled_weekly_reduction)} weekly reduction, ${frontierText} marginal gain`;
    }
}

// ============================================================
// FORECASTS (View 4)
// ============================================================
function renderForecasts(forecasts) {
    if (!forecasts) return;

    // Model metrics
    if (forecasts.model_metrics) {
        const m = forecasts.model_metrics;
        const avgError = m.mae_pct ?? m.mape;
        document.querySelector('#metricMAE .metric-value').textContent = formatNumber(m.mae, 1);
        document.querySelector('#metricRMSE .metric-value').textContent = formatNumber(m.rmse, 1);
        document.querySelector('#metricR2 .metric-value').textContent = avgError ? `${formatNumber(avgError, 1)}%` : m.r2;
        document.getElementById('modelBadge').textContent = avgError ? `Avg error ${formatNumber(avgError, 1)}%` : `R² = ${m.r2}`;
    }
    if (forecasts.station_model_metrics) {
        const sm = forecasts.station_model_metrics;
        const stationMetric = document.querySelector('#metricStationR2 .metric-value');
        if (stationMetric) stationMetric.textContent = Number(sm.r2 || 0).toFixed(3);
        const stationCard = document.getElementById('metricStationR2');
        if (stationCard) {
            stationCard.title = `${sm.model}: ${formatNumber(sm.rows)} station-day rows, ${formatNumber(sm.test_rows)} held out after ${sm.split_date}`;
        }
    }

    // 7-day forecast chart
    if (forecasts.forecast) {
        charts.forecast = new Chart(document.getElementById('chartForecast'), {
            type: 'bar',
            data: {
                labels: forecasts.forecast.dates.map(d => {
                    const dt = new Date(d);
                    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                }),
                datasets: [{
                    label: 'Predicted Violations',
                    data: forecasts.forecast.values,
                    backgroundColor: forecasts.forecast.values.map(v => {
                        const avg = forecasts.forecast.values.reduce((a,b)=>a+b,0) / forecasts.forecast.values.length;
                        return v > avg * 1.1 ? 'rgba(255,71,87,0.3)' : COLORS.blueFaded;
                    }),
                    borderColor: forecasts.forecast.values.map(v => {
                        const avg = forecasts.forecast.values.reduce((a,b)=>a+b,0) / forecasts.forecast.values.length;
                        return v > avg * 1.1 ? COLORS.critical : COLORS.blue;
                    }),
                    borderWidth: 1.5,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
                    x: { grid: { display: false } },
                },
            }
        });
    }

    // Historical vs Predicted
    if (forecasts.historical) {
        const h = forecasts.historical;
        charts.histPred = new Chart(document.getElementById('chartHistPred'), {
            type: 'line',
            data: {
                labels: h.dates.map(d => {
                    const parts = d.split('-');
                    return `${parts[1]}/${parts[2]}`;
                }),
                datasets: [
                    {
                        label: 'Actual',
                        data: h.actual,
                        borderColor: COLORS.blue,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.3,
                    },
                    {
                        label: 'Predicted',
                        data: h.predicted,
                        borderColor: COLORS.yellow,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [5, 3],
                        pointRadius: 2,
                        tension: 0.3,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { size: 9 } } },
                },
            }
        });
    }

    // Station trends
    if (forecasts.station_forecasts) {
        const container = document.getElementById('stationTrends');
        container.innerHTML = '';
        Object.entries(forecasts.station_forecasts).forEach(([name, data]) => {
            const trend = data.trend_pct;
            const badge = trend > 5 ? 'up' : trend < -5 ? 'down' : 'flat';
            const symbol = trend > 5 ? '↑' : trend < -5 ? '↓' : '→';
            const item = document.createElement('div');
            item.className = 'trend-item';
            item.innerHTML = `
                <span class="trend-item-name">${name}</span>
                <span class="trend-badge ${badge}">${symbol} ${Math.abs(trend).toFixed(0)}%</span>
            `;
            container.appendChild(item);
        });
    }
}

// ============================================================
// GUIDED TOUR
// ============================================================
const TOUR_STEPS = [
    {
        title: '🗺️ Welcome to SignalFlow',
        text: 'This AI-powered platform analyzes 298,450+ parking violations across Bengaluru to detect illegal parking hotspots, quantify their congestion impact, and optimize enforcement deployment.',
        view: null,
    },
    {
        title: '🔥 Hotspot Map',
        text: 'The heatmap shows density while the Map Lens keeps the default view clean by showing priority clusters first. Switch to Audit All when judges want to verify the full set of detected hotspots.',
        view: 'map',
    },
    {
        title: '⏱️ Time Animation',
        text: 'Press the play button on the time slider to watch violations emerge and shift across Bengaluru throughout a 24-hour cycle. Notice how patterns concentrate during morning and evening rush hours.',
        view: 'map',
    },
    {
        title: '📊 Analytics Dashboard',
        text: 'Deep-dive into temporal patterns, vehicle type distributions, violation breakdowns, and station rankings. The weekday vs weekend comparison reveals distinct enforcement patterns.',
        view: 'analytics',
    },
    {
        title: '🚔 Patrol Planner',
        text: 'AI-optimized enforcement recommendations based on Congestion Impact Score. The budget slider redraws the deployment route so reviewers can see how added units expand operational coverage.',
        view: 'patrol',
    },
    {
        title: '📈 Forecasts',
        text: 'The forecast view shows a short-horizon planning signal with validation error, historical fit, and station trend indicators for proactive enforcement.',
        view: 'forecast',
    },
];

function initTour() {
    document.getElementById('tourBtn').addEventListener('click', startTour);
    document.getElementById('tourSkip').addEventListener('click', endTour);
    document.getElementById('tourNext').addEventListener('click', nextTourStep);
}

function startTour() {
    tourStep = 0;
    showTourStep();
    document.getElementById('tourOverlay').style.display = 'flex';
}

function showTourStep() {
    const step = TOUR_STEPS[tourStep];
    document.getElementById('tourTitle').textContent = step.title;
    document.getElementById('tourText').textContent = step.text;

    // Step indicators
    const indicator = document.getElementById('tourStepIndicator');
    indicator.innerHTML = TOUR_STEPS.map((_, i) =>
        `<div class="tour-step-dot ${i === tourStep ? 'active' : i < tourStep ? 'done' : ''}"></div>`
    ).join('');

    // Switch view if needed
    if (step.view) switchView(step.view);

    // Update button text
    document.getElementById('tourNext').textContent =
        tourStep === TOUR_STEPS.length - 1 ? 'Finish ✓' : 'Next →';
}

function nextTourStep() {
    tourStep++;
    if (tourStep >= TOUR_STEPS.length) {
        endTour();
        return;
    }
    showTourStep();
}

function endTour() {
    document.getElementById('tourOverlay').style.display = 'none';
    tourStep = 0;
}

// ============================================================
// INIT
// ============================================================
async function init() {
    console.log('SignalFlow — Initializing...');

    initNavigation();
    initTour();

    const data = await loadAllData();
    console.log('Data loaded:', Object.keys(data).filter(k => data[k]).join(', '));

    renderKPIs(data.stats, data.hotspots);
    renderOpsBrief(data.operationsBrief);
    initMap(data.heatmap, data.hotspots, data.hourlyAnim);
    initCommandCenter(data.operationsBrief, data.hotspots, data.forecasts);
    renderAnalytics(data.temporal);
    initPatrolView(data.enforcement, data.operationsBrief);
    renderForecasts(data.forecasts);
    initFloatingPanels();
    applyInitialViewFromUrl();

    console.log('SignalFlow — Ready ✅');
}

document.addEventListener('DOMContentLoaded', init);
