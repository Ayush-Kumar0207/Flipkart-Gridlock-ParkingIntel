# Vendored Browser Libraries

These files are checked in so the reviewer zip can run without CDN access:

- Leaflet 1.9.4: `leaflet/leaflet.css`, `leaflet/leaflet.js`, and `leaflet/images/*`
- Chart.js 4.4.0: `chartjs/chart.umd.min.js`
- Leaflet.heat 0.2.0: `leaflet-heat/leaflet-heat.js`

The dashboard may still use Carto Dark Matter tiles when live internet is available. Use `http://localhost:8000?offline=1` to force the local schematic basemap for judging.
