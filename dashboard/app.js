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
let hourlyAnimData = {};
let isPlaying = false;
let playInterval = null;
let charts = {};
let tourStep = 0;

// Chart.js global dark theme
Chart.defaults.color = '#8b93b3';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
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
    const [stats, hotspots, heatmap, temporal, impact, forecasts, enforcement, hourlyAnim] = await Promise.all([
        loadJSON('stats.json'),
        loadJSON('hotspots.json'),
        loadJSON('heatmap_data.json'),
        loadJSON('temporal.json'),
        loadJSON('impact_scores.json'),
        loadJSON('forecasts.json'),
        loadJSON('enforcement.json'),
        loadJSON('hourly_animation.json'),
    ]);
    return { stats, hotspots, heatmap, temporal, impact, forecasts, enforcement, hourlyAnim };
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
    if (viewId === 'map' && map) map.invalidateSize();
    if (viewId === 'patrol' && patrolMap) patrolMap.invalidateSize();
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

// ============================================================
// MAP (View 1)
// ============================================================
function initMap(heatmapData, hotspots, hourlyAnim) {
    hourlyAnimData = hourlyAnim || {};

    map = L.map('map', {
        center: [12.97, 77.59],
        zoom: 12,
        zoomControl: true,
        attributionControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(map);

    // Heatmap layer
    if (heatmapData && heatmapData.length > 0) {
        heatLayer = L.heatLayer(heatmapData, {
            radius: 18,
            blur: 22,
            maxZoom: 15,
            max: 1.0,
            gradient: { 0.2: '#2874F0', 0.4: '#14b8a6', 0.6: '#FFE500', 0.8: '#ff8c42', 1.0: '#ff4757' },
        }).addTo(map);
    }

    // Hotspot markers
    if (hotspots) {
        renderHotspotMarkers(hotspots);
    }

    // Time slider
    initTimeSlider();
}

function renderHotspotMarkers(hotspots) {
    clusterMarkers.forEach(m => map.removeLayer(m));
    clusterMarkers = [];

    hotspots.forEach(h => {
        const color = SEVERITY_COLORS[h.severity] || COLORS.low;
        const radius = Math.max(8, Math.min(30, Math.sqrt(h.count) * 0.8));

        const marker = L.circleMarker([h.lat, h.lon], {
            radius: radius,
            fillColor: color,
            fillOpacity: 0.35,
            color: color,
            weight: 2,
            opacity: 0.8,
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
}

function showHotspotDetail(h) {
    const panel = document.getElementById('hotspotDetail');
    const grid = document.getElementById('detailGrid');
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
}

document.getElementById('closeDetail')?.addEventListener('click', () => {
    document.getElementById('hotspotDetail').style.display = 'none';
});

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
function initPatrolView(enforcement) {
    if (!enforcement || enforcement.length === 0) return;

    // Init patrol map
    patrolMap = L.map('patrolMap', {
        center: [12.97, 77.59],
        zoom: 12,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OSM &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(patrolMap);

    // Add patrol zone markers
    let totalViolations = 0;
    let totalReduction = 0;

    enforcement.forEach((rec, i) => {
        const color = rec.cis > 30 ? COLORS.critical : rec.cis > 20 ? COLORS.high : rec.cis > 10 ? COLORS.medium : COLORS.low;

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
            <div class="popup-row"><span class="popup-label">Patrol Units</span><span class="popup-value">${rec.recommended_units}</span></div>
            <div class="popup-row"><span class="popup-label">Est. Reduction</span><span class="popup-value" style="color:#06d6a0">${rec.expected_reduction_pct}%</span></div>
        `);

        patrolMarkers.push(marker);
        totalViolations += rec.total_violations;
        totalReduction += rec.expected_reduction_pct;
    });

    // Render patrol list
    const list = document.getElementById('patrolList');
    enforcement.forEach((rec, i) => {
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
                <span class="patrol-item-detail" style="color:${COLORS.low}">↓${rec.expected_reduction_pct}%</span>
            </div>
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
}

// ============================================================
// FORECASTS (View 4)
// ============================================================
function renderForecasts(forecasts) {
    if (!forecasts) return;

    // Model metrics
    if (forecasts.model_metrics) {
        const m = forecasts.model_metrics;
        document.querySelector('#metricMAE .metric-value').textContent = m.mae;
        document.querySelector('#metricRMSE .metric-value').textContent = m.rmse;
        document.querySelector('#metricR2 .metric-value').textContent = m.r2;
        document.getElementById('modelBadge').textContent = `R² = ${m.r2}`;
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
        text: 'The heatmap shows violation density across the city. Colored circles mark detected hotspot clusters — red for critical, orange for high, yellow for medium, green for low severity. Use the time slider to see how patterns shift throughout the day.',
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
        text: 'AI-optimized enforcement recommendations based on our novel Congestion Impact Score (CIS). Each zone shows optimal patrol hours, required units, and projected violation reduction.',
        view: 'patrol',
    },
    {
        title: '📈 Forecasts',
        text: 'XGBoost-powered violation forecasting predicts daily violation counts per zone. Station trend indicators highlight areas with increasing violation pressure requiring proactive attention.',
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
    initMap(data.heatmap, data.hotspots, data.hourlyAnim);
    renderAnalytics(data.temporal);
    initPatrolView(data.enforcement);
    renderForecasts(data.forecasts);

    console.log('SignalFlow — Ready ✅');
}

document.addEventListener('DOMContentLoaded', init);
