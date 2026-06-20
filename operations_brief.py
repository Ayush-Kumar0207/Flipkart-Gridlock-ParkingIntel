"""
SignalFlow - Operations Brief Generator
Creates judge-facing decision metrics and patrol budget scenarios.
"""

import json
import math
import os

import numpy as np
import pandas as pd


def _load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _hour_label(hour):
    return f"{int(hour):02d}:00"


def _window_label(hours):
    hours = sorted(int(h) for h in hours)
    if not hours:
        return 'N/A'
    return f"{_hour_label(hours[0])}-{_hour_label(hours[-1] + 1)} IST"


def _top_consecutive_window(hourly_counts, window_size=3):
    values = hourly_counts.reindex(range(24), fill_value=0)
    best_start = 0
    best_total = -1
    for start in range(0, 24 - window_size + 1):
        total = int(values.loc[start:start + window_size - 1].sum())
        if total > best_total:
            best_total = total
            best_start = start
    hours = list(range(best_start, best_start + window_size))
    return {
        'hours': hours,
        'label': _window_label(hours),
        'violations': best_total,
    }


def _reason_tags(row, station_df, city_main_road_pct, city_heavy_pct, trend_pct):
    tags = []
    if row['total_violations'] >= 20000:
        tags.append('high-volume zone')
    if row['peak_window_share'] >= 0.35:
        tags.append('tight peak window')
    if row['main_road_pct'] > city_main_road_pct:
        tags.append('main-road obstruction')
    station_heavy_pct = (station_df['vehicle_size'] == 'Heavy').mean() * 100
    if station_heavy_pct > city_heavy_pct:
        tags.append('heavy-vehicle mix')
    if trend_pct >= 10:
        tags.append('rising trend')
    if not tags:
        tags.append('steady repeat demand')
    return tags[:3]


def _station_top_junctions(station_df):
    junction_df = station_df[station_df['junction_name'] != 'No Junction'].copy()
    if junction_df.empty:
        return []

    rows = []
    for name, group in junction_df.groupby('junction_name'):
        peak_hour = group['hour_ist'].dropna().mode()
        rows.append({
            'name': name,
            'violations': int(len(group)),
            'main_road_pct': round(group['is_main_road_violation'].mean() * 100, 1),
            'peak_hour': int(peak_hour.iloc[0]) if len(peak_hour) else None,
        })

    return sorted(rows, key=lambda x: x['violations'], reverse=True)[:3]


def _allocate_budget(playbooks, budget):
    assignments = {p['station']: 0 for p in playbooks}
    remaining = int(budget)

    while remaining > 0:
        candidates = [
            p for p in playbooks
            if assignments[p['station']] < p['recommended_units']
        ]
        if not candidates:
            break

        def marginal_value(p):
            used = assignments[p['station']]
            return p['priority_score'] / ((used + 1) ** 0.7)

        best = max(candidates, key=marginal_value)
        assignments[best['station']] += 1
        remaining -= 1

    zones = []
    weekly_reduction = 0.0
    covered_daily_peak = 0.0

    for p in playbooks:
        units = assignments[p['station']]
        if units <= 0:
            continue
        unit_fraction = units / max(p['recommended_units'], 1)
        coverage_factor = math.sqrt(min(unit_fraction, 1.0))
        modeled_weekly = p['modeled_daily_reduction'] * 7 * coverage_factor
        covered_daily = p['peak_window_daily_avg'] * coverage_factor
        weekly_reduction += modeled_weekly
        covered_daily_peak += covered_daily
        zones.append({
            'station': p['station'],
            'units': units,
            'recommended_units': p['recommended_units'],
            'cis': p['cis'],
            'peak_window': p['peak_window'],
            'modeled_weekly_reduction': round(modeled_weekly, 0),
        })

    return {
        'budget_units': int(budget),
        'zones_covered': len(zones),
        'covered_peak_violations_per_day': round(covered_daily_peak, 1),
        'modeled_weekly_reduction': round(weekly_reduction, 0),
        'deployments': zones,
    }


def generate_operations_brief(
    df,
    impact_path='dashboard/data/impact_scores.json',
    enforcement_path='dashboard/data/enforcement.json',
    forecasts_path='dashboard/data/forecasts.json',
    output_dir='dashboard/data',
):
    """Export operational story, station playbooks, and unit-budget scenarios."""
    print("[OperationsBrief] Building operations brief...")
    os.makedirs(output_dir, exist_ok=True)

    impact = _load_json(impact_path)
    enforcement = _load_json(enforcement_path)
    forecasts = _load_json(forecasts_path)

    total_days = max(df['date'].nunique(), 1)
    total_violations = int(len(df))
    city_main_road_pct = float(df['is_main_road_violation'].mean() * 100)
    city_heavy_pct = float((df['vehicle_size'] == 'Heavy').mean() * 100)

    hourly = df.dropna(subset=['hour_ist']).groupby('hour_ist').size()
    top_window = _top_consecutive_window(hourly)
    top_window['share_pct'] = round(top_window['violations'] / total_violations * 100, 1)

    weekday_daily = df[df['is_weekend'] == 0].groupby('date').size()
    weekend_daily = df[df['is_weekend'] == 1].groupby('date').size()
    weekday_avg = weekday_daily.mean() if len(weekday_daily) else 0
    weekend_avg = weekend_daily.mean() if len(weekend_daily) else 0
    weekend_index = (weekend_avg / weekday_avg) if weekday_avg else 0

    trend_lookup = {
        name: data.get('trend_pct', 0)
        for name, data in forecasts.get('station_forecasts', {}).items()
    }

    playbooks = []
    for i, rec in enumerate(enforcement, start=1):
        station = rec['station']
        station_df = df[df['police_station'] == station].copy()
        if station_df.empty:
            continue

        peak_hours = [int(h) for h in rec.get('peak_hours', [])]
        peak_window_df = station_df[station_df['hour_ist'].isin(peak_hours)]
        peak_window_daily_avg = len(peak_window_df) / total_days
        station_daily_avg = len(station_df) / total_days
        peak_window_share = peak_window_daily_avg / max(station_daily_avg, 1)
        trend_pct = float(trend_lookup.get(station, 0))
        modeled_daily_reduction = peak_window_daily_avg * rec['expected_reduction_pct'] / 100

        row = {
            'rank': i,
            'station': station,
            'cis': rec['cis'],
            'confidence_label': rec.get('confidence_label', 'High'),
            'total_violations': int(rec['total_violations']),
            'daily_avg': round(station_daily_avg, 1),
            'peak_window_daily_avg': round(peak_window_daily_avg, 1),
            'peak_window_share': round(peak_window_share, 3),
            'peak_hours': peak_hours,
            'peak_window': _window_label(peak_hours),
            'peak_day': rec['peak_day'],
            'recommended_units': int(rec['recommended_units']),
            'expected_reduction_pct': rec['expected_reduction_pct'],
            'modeled_daily_reduction': round(modeled_daily_reduction, 1),
            'modeled_weekly_reduction': round(modeled_daily_reduction * 7, 0),
            'main_road_pct': rec['main_road_pct'],
            'trend_pct': round(trend_pct, 1),
            'lat': rec['lat'],
            'lon': rec['lon'],
        }
        row['reason_tags'] = _reason_tags(row, station_df, city_main_road_pct, city_heavy_pct, trend_pct)
        row['top_junctions'] = _station_top_junctions(station_df)
        row['priority_score'] = round(
            row['cis'] * math.sqrt(max(row['peak_window_daily_avg'], 1)) * (1 + max(trend_pct, 0) / 300),
            2,
        )
        playbooks.append(row)

    playbooks = sorted(playbooks, key=lambda x: x['priority_score'], reverse=True)
    for i, row in enumerate(playbooks, start=1):
        row['rank'] = i

    budget_scenarios = [_allocate_budget(playbooks, budget) for budget in [5, 10, 15, 20]]

    top_action = playbooks[0] if playbooks else {}
    brief = {
        'city_brief': {
            'total_violations': total_violations,
            'total_days': int(total_days),
            'avg_daily_violations': round(total_violations / total_days, 1),
            'top_peak_window': top_window,
            'weekend_index': round(weekend_index, 2),
            'main_road_pct': round(city_main_road_pct, 1),
            'heavy_vehicle_pct': round(city_heavy_pct, 1),
            'highest_priority_station': top_action.get('station'),
        },
        'top_action': top_action,
        'station_playbooks': playbooks,
        'budget_scenarios': budget_scenarios,
        'methodology': {
            'cis_formula': impact.get('formula', ''),
            'reduction_note': 'Modeled reduction is a planning proxy derived from historical peak-window demand, CIS, and diminishing returns by unit coverage.',
            'data_scope': 'Bengaluru parking violation records from the organizer dataset only.',
        },
    }

    with open(os.path.join(output_dir, 'operations_brief.json'), 'w', encoding='utf-8') as f:
        json.dump(brief, f, indent=2)

    print(f"[OperationsBrief] [OK] Exported {len(playbooks)} station playbooks and {len(budget_scenarios)} scenarios")
    return brief


if __name__ == '__main__':
    data = pd.read_csv('data_clean.csv')
    generate_operations_brief(data)
