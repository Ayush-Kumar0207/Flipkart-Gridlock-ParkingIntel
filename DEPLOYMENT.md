# SignalFlow Demo Deployment

The dashboard is a static site in `dashboard/`, so it can be deployed without a backend.

## Option A: GitHub Pages

1. Push the repository to GitHub.
2. Open the repository on GitHub.
3. Go to Settings > Pages.
4. Set Source to `GitHub Actions`.
5. Go to Actions > Deploy Dashboard.
6. Run the workflow manually, or push a change under `dashboard/`.
7. Use the generated Pages URL as the Hackerearth Demo Link.

Expected URL format:

```text
https://ayush-kumar0207.github.io/Flipkart-Gridlock-ParkingIntel/
```

## Option B: Netlify

1. Go to Netlify.
2. Drag and drop the `dashboard/` folder.
3. Copy the generated public URL.
4. Use that URL as the Hackerearth Demo Link.

## Option C: Local Reviewer Run

If a reviewer downloads the source zip, the polished offline path is:

```bash
cd dashboard
python -m http.server 8000
```

Then open:

```text
http://localhost:8000?offline=1
```

This path uses vendored Leaflet, Leaflet.heat, Chart.js, and Leaflet image assets from `dashboard/vendor/`. The query parameter forces the local dark basemap immediately, so the demo does not wait on live internet or external map tiles. Without the query parameter, Carto tiles are used when available and the dashboard falls back automatically on tile errors, browser offline events, or tile timeout.

Do not open `dashboard/index.html` directly from the filesystem; the browser needs the local HTTP server so `dashboard/data/*.json` can be fetched reliably.
