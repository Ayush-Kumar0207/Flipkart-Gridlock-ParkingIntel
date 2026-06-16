"""
SignalFlow — Hotspot Detection Engine
Uses HDBSCAN to identify spatial clusters of parking violations in Bengaluru.
"""

import pandas as pd
import numpy as np
import json
import os

try:
    import hdbscan
    HAS_HDBSCAN = True
except ImportError:
    HAS_HDBSCAN = False

from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler


def detect_hotspots(df, min_cluster_size=80, min_samples=20):
    """
    Cluster violation locations using HDBSCAN (or DBSCAN fallback).
    Returns DataFrame with cluster assignments and cluster summary.
    """
    print("[HotspotEngine] Starting spatial clustering...")

    coords = df[['latitude', 'longitude']].values

    if HAS_HDBSCAN:
        print("[HotspotEngine] Using HDBSCAN...")
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            metric='haversine',
            cluster_selection_method='eom',
            core_dist_n_jobs=1
        )
        # HDBSCAN with haversine expects radians
        coords_rad = np.radians(coords)
        labels = clusterer.fit_predict(coords_rad)
    else:
        print("[HotspotEngine] HDBSCAN not available, using DBSCAN fallback...")
        scaler = StandardScaler()
        coords_scaled = scaler.fit_transform(coords)
        clusterer = DBSCAN(eps=0.08, min_samples=min_samples)
        labels = clusterer.fit_predict(coords_scaled)

    df = df.copy()
    df['cluster_id'] = labels

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = (labels == -1).sum()
    print(f"[HotspotEngine] Found {n_clusters} clusters, {n_noise} noise points ({n_noise/len(df)*100:.1f}%)")

    return df, n_clusters


def compute_cluster_summary(df):
    """Compute per-cluster statistics."""
    print("[HotspotEngine] Computing cluster summaries...")

    # Exclude noise
    clustered = df[df['cluster_id'] >= 0].copy()

    if len(clustered) == 0:
        print("[HotspotEngine] WARNING: No clusters found!")
        return pd.DataFrame()

    summary = clustered.groupby('cluster_id').agg(
        count=('id', 'size'),
        lat_center=('latitude', 'mean'),
        lon_center=('longitude', 'mean'),
        lat_std=('latitude', 'std'),
        lon_std=('longitude', 'std'),
        main_road_frac=('is_main_road_violation', 'mean'),
        wrong_parking_frac=('is_wrong_parking', 'mean'),
        no_parking_frac=('is_no_parking', 'mean'),
        num_unique_junctions=('junction_name', 'nunique'),
        num_unique_stations=('police_station', 'nunique'),
        peak_hour=('hour_ist', lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else 12),
    ).reset_index()

    # Dominant violation per cluster
    def get_dominant_violation(group):
        modes = group['primary_violation'].mode()
        return modes.iloc[0] if len(modes) > 0 else 'UNKNOWN'

    dominant = clustered.groupby('cluster_id')[['primary_violation']].apply(
        lambda g: get_dominant_violation(g)
    ).reset_index()
    dominant.columns = ['cluster_id', 'dominant_violation']
    summary = summary.merge(dominant, on='cluster_id')

    # Dominant vehicle type per cluster
    def get_dominant_vehicle(group):
        modes = group['vehicle_type_clean'].mode()
        return modes.iloc[0] if len(modes) > 0 else 'UNKNOWN'

    dom_vehicle = clustered.groupby('cluster_id')[['vehicle_type_clean']].apply(
        lambda g: get_dominant_vehicle(g)
    ).reset_index()
    dom_vehicle.columns = ['cluster_id', 'dominant_vehicle']
    summary = summary.merge(dom_vehicle, on='cluster_id')

    # Vehicle size distribution per cluster
    for vs in ['Heavy', 'Medium', 'Light']:
        col = f'frac_{vs.lower()}_vehicles'
        vs_counts = clustered[clustered['vehicle_size'] == vs].groupby('cluster_id').size()
        total_counts = clustered.groupby('cluster_id').size()
        frac = (vs_counts / total_counts).fillna(0)
        summary[col] = summary['cluster_id'].map(frac).fillna(0)

    # Spatial spread (approx radius in meters)
    summary['spread_m'] = np.sqrt(summary['lat_std']**2 + summary['lon_std']**2) * 111000

    # Severity tier
    count_q75 = summary['count'].quantile(0.75)
    count_q50 = summary['count'].quantile(0.50)
    count_q25 = summary['count'].quantile(0.25)

    def assign_severity(row):
        if row['count'] >= count_q75 and row['main_road_frac'] > 0.15:
            return 'Critical'
        elif row['count'] >= count_q50:
            return 'High'
        elif row['count'] >= count_q25:
            return 'Medium'
        return 'Low'

    summary['severity'] = summary.apply(assign_severity, axis=1)

    # Sort by count descending
    summary = summary.sort_values('count', ascending=False).reset_index(drop=True)
    summary['rank'] = range(1, len(summary) + 1)

    print(f"[HotspotEngine] Cluster summary: {len(summary)} clusters")
    print(f"  Critical: {(summary['severity']=='Critical').sum()}")
    print(f"  High:     {(summary['severity']=='High').sum()}")
    print(f"  Medium:   {(summary['severity']=='Medium').sum()}")
    print(f"  Low:      {(summary['severity']=='Low').sum()}")

    return summary


def export_hotspot_data(df, summary, output_dir='dashboard/data'):
    """Export hotspot data as JSON for the dashboard."""
    os.makedirs(output_dir, exist_ok=True)

    # Hotspot summary JSON
    hotspot_list = []
    for _, row in summary.iterrows():
        hotspot_list.append({
            'id': int(row['cluster_id']),
            'rank': int(row['rank']),
            'lat': round(row['lat_center'], 6),
            'lon': round(row['lon_center'], 6),
            'count': int(row['count']),
            'severity': row['severity'],
            'spread_m': round(row['spread_m'], 0),
            'main_road_frac': round(row['main_road_frac'], 3),
            'dominant_violation': row['dominant_violation'],
            'dominant_vehicle': row['dominant_vehicle'],
            'peak_hour': int(row['peak_hour']),
            'frac_heavy': round(row['frac_heavy_vehicles'], 3),
            'frac_medium': round(row['frac_medium_vehicles'], 3),
            'frac_light': round(row['frac_light_vehicles'], 3),
            'num_junctions': int(row['num_unique_junctions']),
        })

    with open(os.path.join(output_dir, 'hotspots.json'), 'w') as f:
        json.dump(hotspot_list, f, indent=2)
    print(f"[HotspotEngine] ✅ Exported {len(hotspot_list)} hotspots to hotspots.json")

    # Heatmap data (sampled for performance — max 50k points)
    heatmap_sample = df.sample(n=min(50000, len(df)), random_state=42)
    heatmap_data = []
    for _, row in heatmap_sample.iterrows():
        intensity = 0.5 + 0.5 * row.get('is_main_road_violation', 0)
        heatmap_data.append([
            round(row['latitude'], 6),
            round(row['longitude'], 6),
            round(intensity, 2)
        ])

    with open(os.path.join(output_dir, 'heatmap_data.json'), 'w') as f:
        json.dump(heatmap_data, f)
    print(f"[HotspotEngine] ✅ Exported {len(heatmap_data)} heatmap points")

    # Hourly animation data (per-hour heatmap)
    hourly_anim = {}
    for hour in range(24):
        hour_df = df[df['hour_ist'] == hour]
        if len(hour_df) > 3000:
            hour_df = hour_df.sample(n=3000, random_state=42)
        points = []
        for _, row in hour_df.iterrows():
            points.append([
                round(row['latitude'], 6),
                round(row['longitude'], 6),
                round(0.5 + 0.5 * row.get('is_main_road_violation', 0), 2)
            ])
        hourly_anim[str(hour)] = points

    with open(os.path.join(output_dir, 'hourly_animation.json'), 'w') as f:
        json.dump(hourly_anim, f)
    print(f"[HotspotEngine] ✅ Exported hourly animation data (24 hours)")

    return hotspot_list


def run_hotspot_analysis(df, output_dir='dashboard/data'):
    """Full hotspot detection pipeline."""
    df_clustered, n_clusters = detect_hotspots(df)
    summary = compute_cluster_summary(df_clustered)
    hotspot_list = export_hotspot_data(df_clustered, summary, output_dir)
    return df_clustered, summary, hotspot_list


if __name__ == '__main__':
    df = pd.read_csv('data_clean.csv')
    df['violation_list'] = df['violation_list'].apply(json.loads)
    run_hotspot_analysis(df)
