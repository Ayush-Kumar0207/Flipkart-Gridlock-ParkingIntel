# SignalFlow Judging Brief

## 90-Second Pitch

SignalFlow turns 298,450 Bengaluru parking violation records into an operational enforcement planner. It does not stop at heatmaps: it identifies repeat hotspots, scores congestion impact with evidence confidence, forecasts demand, and recommends where to deploy limited patrol units by time window.

Theme 1 is the strongest choice because the organizer-provided parking dataset has enough spatial, temporal, vehicle, and violation-type depth to support a real prototype. SignalFlow uses only that dataset.

## What Makes It Top-10 Competitive

1. **Decision support, not just visualization**  
   The dashboard answers: where should enforcement go, when should it go, how many units are needed, and what impact is expected?

2. **Reliability-adjusted impact scoring**  
   CIS combines log violation density, main-road obstruction, heavy-vehicle mix, peak concentration, traffic-window share, and evidence confidence. This prevents low-sample hotspots from being over-promoted.

3. **Patrol budget simulator**  
   Judges can compare 5, 10, 15, and 20 patrol-unit scenarios and see the deployment route, covered peak-window demand, and modeled weekly reduction.

4. **Operationally aligned time windows**  
   Recommendations focus on traffic-impact hours instead of blindly selecting late-night statistical peaks.

5. **Clean executive view with auditability**  
   The default Priority Lens keeps the map readable for demos, while Audit All exposes the full hotspot set when reviewers want to inspect coverage.

6. **Clear Flipkart relevance**  
   Parking-induced bottlenecks affect delivery reliability, rider dwell time, route predictability, and customer promise windows in dense Bengaluru corridors.

## Demo Path

1. **Hotspot Map**  
   Open with the Priority Lens and state the core evidence: 298,450 records, 674 detected clusters, 209,129 unique coordinates. Briefly switch to Audit All to show that the clean view is intentional, not missing data.

2. **Operations Brief on Map**  
   Point to the best first action and the city peak window: 09:00-12:00 IST accounts for 30.7% of violations.

3. **Analytics**  
   Show temporal peaks, station rankings, vehicle mix, and violation types. Emphasize that the system is learning enforcement timing patterns from historical data.

4. **Patrol Planner**  
   Use the budget slider. Show that the model changes deployment and redraws the route as resources increase, instead of producing a static top-10 list.

5. **Forecasts**  
   Explain the 7-day forecast and model validation metrics. Keep the claim precise: this is a short-horizon planning signal, not a city traffic simulator.

## Strongest Talking Points

- "We converted raw violation logs into a city operations layer."
- "The score is reliability-adjusted, so the model does not chase tiny noisy hotspots."
- "The patrol planner is budget-aware, which makes it usable by enforcement teams."
- "All recommendations are generated from the organizer dataset; no external data dependency is required."
- "The method is extensible: if speed, road width, or live camera feeds are later added, the same scoring layer can absorb them."

## Known Limitation and Safe Framing

The dataset contains parking violation records, not direct traffic speed or delay measurements. SignalFlow therefore estimates **congestion impact risk**, not measured traffic delay. This is why CIS uses defensible proxy features: main-road parking, heavy vehicles, peak-window concentration, spatial density, and evidence confidence.

Use this framing in Q&A: "We are not claiming direct travel-time reduction from this dataset alone. We are prioritizing enforcement where parking violations are most likely to create congestion."

## Submission Checklist

- Start the dashboard locally from `dashboard/`.
- Keep `dashboard/data/*.json` included for instant demo loading.
- Mention the full HDBSCAN rebuild is offline preprocessing and can take several minutes.
- Use Auto Tour only if time is tight; otherwise drive the demo manually through the path above.
- In the deck/video, show the patrol budget simulator because it is the most operational differentiator.
