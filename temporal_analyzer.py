"""
SignalFlow — Temporal Pattern Analyzer
Mines hourly, daily, and monthly violation patterns across zones and junctions.
"""

import pandas as pd
import numpy as np
import json
import os


def analyze_temporal_patterns(df, output_dir='dashboard/data'):
    """Extract and export all temporal pattern data."""
    print("[TemporalAnalyzer] Analyzing temporal patterns...")
    os.makedirs(output_dir, exist_ok=True)

    temporal = {}

    # --- 1. Hourly Distribution (IST) ---
    hourly = df.groupby('hour_ist').size().reindex(range(24), fill_value=0)
    temporal['hourly'] = {
        'labels': [f"{h}:00" for h in range(24)],
        'values': hourly.tolist(),
        'peak_hour': int(hourly.idxmax()),
        'peak_count': int(hourly.max()),
    }

    # Hourly by top stations
    top_stations = df['police_station'].value_counts().head(8).index.tolist()
    hourly_by_station = {}
    for station in top_stations:
        station_hourly = df[df['police_station'] == station].groupby('hour_ist').size().reindex(range(24), fill_value=0)
        hourly_by_station[station] = station_hourly.tolist()
    temporal['hourly_by_station'] = hourly_by_station

    # --- 2. Day of Week Distribution ---
    day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    daily = df.groupby('day_name').size().reindex(day_order, fill_value=0)
    temporal['daily'] = {
        'labels': day_order,
        'values': daily.tolist(),
        'busiest_day': day_order[int(daily.values.argmax())],
    }

    # --- 3. Monthly Trend ---
    monthly = df.dropna(subset=['month']).groupby('month').size().sort_index()
    monthly.index = monthly.index.astype(int)
    month_names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    temporal['monthly'] = {
        'labels': [month_names[m] if m < len(month_names) else str(m) for m in monthly.index],
        'values': monthly.tolist(),
        'months': monthly.index.tolist(),
    }

    # --- 4. Time Period Distribution ---
    period_order = ['Morning Rush', 'Midday', 'Afternoon Rush', 'Evening', 'Night']
    periods = df.groupby('time_period').size().reindex(period_order, fill_value=0)
    temporal['time_periods'] = {
        'labels': period_order,
        'values': periods.tolist(),
    }

    # --- 5. Weekday vs Weekend Comparison ---
    weekday_hourly = df[df['is_weekend'] == 0].groupby('hour_ist').size().reindex(range(24), fill_value=0)
    weekend_hourly = df[df['is_weekend'] == 1].groupby('hour_ist').size().reindex(range(24), fill_value=0)
    # Normalize to daily averages
    n_weekdays = df[df['is_weekend'] == 0]['date'].nunique() or 1
    n_weekends = df[df['is_weekend'] == 1]['date'].nunique() or 1
    temporal['weekday_vs_weekend'] = {
        'labels': [f"{h}:00" for h in range(24)],
        'weekday_avg': (weekday_hourly / n_weekdays).round(1).tolist(),
        'weekend_avg': (weekend_hourly / n_weekends).round(1).tolist(),
    }

    # --- 6. Vehicle Type Breakdown ---
    vehicle_counts = df['vehicle_type_clean'].value_counts().head(10)
    temporal['vehicle_types'] = {
        'labels': vehicle_counts.index.tolist(),
        'values': vehicle_counts.values.tolist(),
    }

    # Vehicle size distribution
    size_counts = df['vehicle_size'].value_counts()
    temporal['vehicle_sizes'] = {
        'labels': size_counts.index.tolist(),
        'values': size_counts.values.tolist(),
    }

    # --- 7. Violation Type Breakdown ---
    violation_counts = df['primary_violation'].value_counts().head(10)
    temporal['violation_types'] = {
        'labels': violation_counts.index.tolist(),
        'values': violation_counts.values.tolist(),
    }

    # --- 8. Station Rankings ---
    station_counts = df['police_station'].value_counts().head(15)
    temporal['station_rankings'] = {
        'labels': station_counts.index.tolist(),
        'values': station_counts.values.tolist(),
    }

    # --- 9. Validation Status ---
    if 'validation_status' in df.columns:
        val_counts = df['validation_status'].fillna('Unknown').value_counts()
        temporal['validation'] = {
            'labels': val_counts.index.tolist(),
            'values': val_counts.values.tolist(),
        }

    # --- 10. Daily violation count time series ---
    daily_ts = df.groupby('date').size().reset_index()
    daily_ts.columns = ['date', 'count']
    daily_ts['date'] = daily_ts['date'].astype(str)
    temporal['daily_timeseries'] = {
        'dates': daily_ts['date'].tolist(),
        'counts': daily_ts['count'].tolist(),
    }

    # --- 11. Heatmap: Hour × Day of Week ---
    hour_day = df.groupby(['day_of_week', 'hour_ist']).size().unstack(fill_value=0)
    hour_day_data = []
    for dow in range(7):
        for hour in range(24):
            val = int(hour_day.loc[dow, hour]) if dow in hour_day.index and hour in hour_day.columns else 0
            hour_day_data.append([dow, hour, val])
    temporal['hour_day_heatmap'] = {
        'data': hour_day_data,
        'days': day_order,
        'hours': list(range(24)),
    }

    # Export
    with open(os.path.join(output_dir, 'temporal.json'), 'w') as f:
        json.dump(temporal, f, indent=2)

    print(f"[TemporalAnalyzer] ✅ Exported temporal patterns to temporal.json")
    print(f"  Peak hour (IST): {temporal['hourly']['peak_hour']}:00 ({temporal['hourly']['peak_count']} violations)")
    print(f"  Busiest day: {temporal['daily']['busiest_day']}")

    return temporal


def compute_summary_stats(df, output_dir='dashboard/data'):
    """Compute high-level KPI stats for the dashboard header."""
    os.makedirs(output_dir, exist_ok=True)

    total_violations = len(df)
    unique_locations = df[['latitude', 'longitude']].drop_duplicates().shape[0]
    unique_junctions = df['junction_name'].nunique()
    unique_stations = df['police_station'].nunique()
    main_road_pct = df['is_main_road_violation'].mean() * 100
    top_violation = df['primary_violation'].mode().iloc[0]
    top_vehicle = df['vehicle_type_clean'].mode().iloc[0]

    # Handle date column safely (may be string or mixed)
    dates = df['date'].dropna().astype(str)
    dates_sorted = sorted(dates.unique())
    date_range_start = dates_sorted[0] if len(dates_sorted) > 0 else 'N/A'
    date_range_end = dates_sorted[-1] if len(dates_sorted) > 0 else 'N/A'
    num_days = len(dates_sorted)
    avg_daily = total_violations / max(num_days, 1)
    heavy_pct = (df['vehicle_size'] == 'Heavy').mean() * 100

    stats = {
        'total_violations': total_violations,
        'unique_locations': unique_locations,
        'unique_junctions': unique_junctions,
        'unique_stations': unique_stations,
        'main_road_pct': round(main_road_pct, 1),
        'top_violation': top_violation,
        'top_vehicle': top_vehicle,
        'date_range': f"{date_range_start} to {date_range_end}",
        'avg_daily_violations': round(avg_daily, 0),
        'heavy_vehicle_pct': round(heavy_pct, 1),
        'total_days': num_days,
    }

    with open(os.path.join(output_dir, 'stats.json'), 'w') as f:
        json.dump(stats, f, indent=2)

    print(f"[TemporalAnalyzer] ✅ Exported summary stats to stats.json")
    return stats


if __name__ == '__main__':
    df = pd.read_csv('data_clean.csv')
    analyze_temporal_patterns(df)
    compute_summary_stats(df)
