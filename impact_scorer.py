"""
SignalFlow — Congestion Impact Scorer
Computes a novel Congestion Impact Score (CIS) per junction and zone.
"""

import pandas as pd
import numpy as np
import json
import os


TRAFFIC_IMPACT_HOURS = set(range(7, 13)) | set(range(16, 20))


def compute_impact_scores(df, output_dir='dashboard/data'):
    """
    Compute a reliability-adjusted Congestion Impact Score for each junction
    and police-station zone.
    """
    print("[ImpactScorer] Computing Congestion Impact Scores...")
    os.makedirs(output_dir, exist_ok=True)

    # --- Per-Junction Scores ---
    junction_df = df[df['junction_name'] != 'No Junction'].copy()
    if len(junction_df) == 0:
        junction_df = df.copy()

    junction_stats = junction_df.groupby('junction_name').agg(
        count=('id', 'size'),
        lat=('latitude', 'mean'),
        lon=('longitude', 'mean'),
        main_road_frac=('is_main_road_violation', 'mean'),
        peak_hour=('hour_ist', lambda x: int(x.mode().iloc[0]) if len(x.dropna()) > 0 and len(x.mode()) > 0 else 12),
    ).reset_index()

    # Heavy vehicle ratio per junction
    heavy_counts = junction_df[junction_df['vehicle_size'] == 'Heavy'].groupby('junction_name').size()
    total_counts = junction_df.groupby('junction_name').size()
    junction_stats['heavy_vehicle_ratio'] = junction_stats['junction_name'].map(
        (heavy_counts / total_counts).fillna(0)
    ).fillna(0)

    # Peak hour concentration: fraction of violations in top-3 hours
    def peak_concentration(group):
        hour_counts = group['hour_ist'].dropna().value_counts()
        total = len(group)
        if total == 0:
            return 0
        top3 = hour_counts.head(3).sum()
        return top3 / total

    peak_conc = junction_df.groupby('junction_name')[['hour_ist']].apply(lambda g: peak_concentration(g))
    junction_stats['peak_hour_concentration'] = junction_stats['junction_name'].map(peak_conc).fillna(0)

    traffic_window = junction_df.groupby('junction_name')['hour_ist'].apply(
        lambda x: x.isin(TRAFFIC_IMPACT_HOURS).mean()
    )
    junction_stats['traffic_window_frac'] = junction_stats['junction_name'].map(traffic_window).fillna(0)

    # Dominant violation
    dom_viol = junction_df.groupby('junction_name')['primary_violation'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else 'UNKNOWN'
    )
    junction_stats['dominant_violation'] = junction_stats['junction_name'].map(dom_viol)

    # Dominant vehicle
    dom_veh = junction_df.groupby('junction_name')['vehicle_type_clean'].agg(
        lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else 'UNKNOWN'
    )
    junction_stats['dominant_vehicle'] = junction_stats['junction_name'].map(dom_veh)

    # Compute CIS from normalized risk components.
    #
    # Volume is log-normalized so one massive junction does not flatten the
    # rest of the city. The evidence confidence factor prevents small-sample
    # junctions with extreme ratios from outranking zones with sustained impact.
    def normalize(series):
        min_val, max_val = series.min(), series.max()
        if max_val == min_val:
            return pd.Series(0.5, index=series.index)
        return (series - min_val) / (max_val - min_val)

    def evidence_confidence(counts, target=500):
        return np.minimum(1.0, np.log1p(counts) / np.log1p(target))

    def confidence_label(conf):
        if conf >= 0.85:
            return 'High'
        if conf >= 0.60:
            return 'Medium'
        return 'Low'

    junction_stats['norm_density'] = normalize(np.log1p(junction_stats['count']))
    junction_stats['norm_main_road'] = junction_stats['main_road_frac']
    junction_stats['norm_heavy'] = junction_stats['heavy_vehicle_ratio']
    junction_stats['norm_peak'] = junction_stats['peak_hour_concentration']
    junction_stats['evidence_confidence'] = evidence_confidence(junction_stats['count'])

    junction_stats['norm_traffic_window'] = junction_stats['traffic_window_frac']

    junction_stats['cis_raw'] = (
        0.40 * junction_stats['norm_density'] +
        0.20 * junction_stats['norm_main_road'] +
        0.12 * junction_stats['norm_heavy'] +
        0.13 * junction_stats['norm_peak'] +
        0.15 * junction_stats['norm_traffic_window']
    ) * 100  # Scale to 0-100

    junction_stats['cis'] = junction_stats['cis_raw'] * (
        0.55 + 0.45 * junction_stats['evidence_confidence']
    )
    junction_stats['confidence_label'] = junction_stats['evidence_confidence'].apply(confidence_label)

    junction_stats = junction_stats.sort_values('cis', ascending=False).reset_index(drop=True)
    junction_stats['rank'] = range(1, len(junction_stats) + 1)

    # --- Per-Zone (Police Station) Scores ---
    station_stats = df.groupby('police_station').agg(
        count=('id', 'size'),
        lat=('latitude', 'mean'),
        lon=('longitude', 'mean'),
        main_road_frac=('is_main_road_violation', 'mean'),
        peak_hour=('hour_ist', lambda x: int(x.mode().iloc[0]) if len(x.dropna()) > 0 and len(x.mode()) > 0 else 12),
        num_junctions=('junction_name', 'nunique'),
    ).reset_index()

    heavy_st = df[df['vehicle_size'] == 'Heavy'].groupby('police_station').size()
    total_st = df.groupby('police_station').size()
    station_stats['heavy_vehicle_ratio'] = station_stats['police_station'].map(
        (heavy_st / total_st).fillna(0)
    ).fillna(0)

    peak_st = df.groupby('police_station')[['hour_ist']].apply(lambda g: peak_concentration(g))
    station_stats['peak_hour_concentration'] = station_stats['police_station'].map(peak_st).fillna(0)

    traffic_st = df.groupby('police_station')['hour_ist'].apply(
        lambda x: x.isin(TRAFFIC_IMPACT_HOURS).mean()
    )
    station_stats['traffic_window_frac'] = station_stats['police_station'].map(traffic_st).fillna(0)

    station_stats['norm_density'] = normalize(np.log1p(station_stats['count']))
    station_stats['norm_traffic_window'] = station_stats['traffic_window_frac']
    station_stats['evidence_confidence'] = evidence_confidence(station_stats['count'], target=1500)
    station_stats['cis_raw'] = (
        0.40 * station_stats['norm_density'] +
        0.20 * station_stats['main_road_frac'] +
        0.12 * station_stats['heavy_vehicle_ratio'] +
        0.13 * station_stats['peak_hour_concentration'] +
        0.15 * station_stats['norm_traffic_window']
    ) * 100
    station_stats['cis'] = station_stats['cis_raw'] * (
        0.55 + 0.45 * station_stats['evidence_confidence']
    )
    station_stats['confidence_label'] = station_stats['evidence_confidence'].apply(confidence_label)

    station_stats = station_stats.sort_values('cis', ascending=False).reset_index(drop=True)
    station_stats['rank'] = range(1, len(station_stats) + 1)

    # Export
    junction_export = []
    for _, row in junction_stats.head(50).iterrows():
        junction_export.append({
            'name': row['junction_name'],
            'rank': int(row['rank']),
            'lat': round(row['lat'], 6),
            'lon': round(row['lon'], 6),
            'count': int(row['count']),
            'cis': round(row['cis'], 1),
            'cis_raw': round(row['cis_raw'], 1),
            'evidence_confidence': round(row['evidence_confidence'], 3),
            'confidence_label': row['confidence_label'],
            'main_road_frac': round(row['main_road_frac'], 3),
            'heavy_vehicle_ratio': round(row['heavy_vehicle_ratio'], 3),
            'peak_hour': int(row['peak_hour']),
            'peak_concentration': round(row['peak_hour_concentration'], 3),
            'traffic_window_frac': round(row['traffic_window_frac'], 3),
            'dominant_violation': row['dominant_violation'],
            'dominant_vehicle': row['dominant_vehicle'],
        })

    station_export = []
    for _, row in station_stats.iterrows():
        station_export.append({
            'name': row['police_station'],
            'rank': int(row['rank']),
            'lat': round(row['lat'], 6),
            'lon': round(row['lon'], 6),
            'count': int(row['count']),
            'cis': round(row['cis'], 1),
            'cis_raw': round(row['cis_raw'], 1),
            'evidence_confidence': round(row['evidence_confidence'], 3),
            'confidence_label': row['confidence_label'],
            'main_road_frac': round(row['main_road_frac'], 3),
            'heavy_vehicle_ratio': round(row['heavy_vehicle_ratio'], 3),
            'peak_hour': int(row['peak_hour']),
            'peak_concentration': round(row['peak_hour_concentration'], 3),
            'traffic_window_frac': round(row['traffic_window_frac'], 3),
            'num_junctions': int(row['num_junctions']),
        })

    impact_data = {
        'junctions': junction_export,
        'stations': station_export,
        'formula': 'CIS = raw_score * (0.55 + 0.45 * evidence_confidence); raw_score = 0.40*log_density + 0.20*main_road_frac + 0.12*heavy_vehicle + 0.13*peak_concentration + 0.15*traffic_window_frac',
    }

    with open(os.path.join(output_dir, 'impact_scores.json'), 'w') as f:
        json.dump(impact_data, f, indent=2)

    print(f"[ImpactScorer] ✅ Exported {len(junction_export)} junction scores and {len(station_export)} station scores")
    print(f"[ImpactScorer] Top-5 junctions by CIS:")
    for j in junction_export[:5]:
        print(f"  #{j['rank']} {j['name']}: CIS={j['cis']}, violations={j['count']}")

    return junction_stats, station_stats


if __name__ == '__main__':
    df = pd.read_csv('data_clean.csv')
    compute_impact_scores(df)
