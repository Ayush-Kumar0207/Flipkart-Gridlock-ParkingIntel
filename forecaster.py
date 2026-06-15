"""
SignalFlow — Violation Forecaster & Enforcement Optimizer
XGBoost model to predict daily violations per zone + patrol recommendations.
"""

import pandas as pd
import numpy as np
import json
import os
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

try:
    from xgboost import XGBRegressor
    HAS_XGB = True
except ImportError:
    HAS_XGB = False
    from sklearn.ensemble import GradientBoostingRegressor


def build_forecasting_features(daily_df):
    """Create time-series features from daily violation counts."""
    df = daily_df.copy()
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date')

    # Lag features
    for lag in [1, 2, 3, 7, 14]:
        df[f'lag_{lag}'] = df['count'].shift(lag)

    # Rolling features
    for window in [3, 7, 14]:
        df[f'rolling_mean_{window}'] = df['count'].rolling(window).mean()
        df[f'rolling_std_{window}'] = df['count'].rolling(window).std()

    # Calendar features
    df['day_of_week'] = df['date'].dt.dayofweek
    df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
    df['month'] = df['date'].dt.month
    df['day_of_month'] = df['date'].dt.day
    df['week_of_year'] = df['date'].dt.isocalendar().week.astype(int)

    # Cyclical encoding
    df['dow_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
    df['dow_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)

    return df.dropna()


def train_forecast_model(df):
    """Train XGBoost model on daily violation counts."""
    print("[Forecaster] Training violation forecasting model...")

    # Aggregate to daily counts
    daily = df.groupby('date').size().reset_index()
    daily.columns = ['date', 'count']
    daily['date'] = pd.to_datetime(daily['date'])
    daily = daily.sort_values('date')

    # Build features
    feat_df = build_forecasting_features(daily)

    feature_cols = [c for c in feat_df.columns if c not in ['date', 'count']]
    X = feat_df[feature_cols].values
    y = feat_df['count'].values
    dates = feat_df['date'].values

    # Train/test split: last 20% for validation
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    dates_test = dates[split_idx:]

    if HAS_XGB:
        model = XGBRegressor(
            n_estimators=200, max_depth=5, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8,
            random_state=42, verbosity=0
        )
    else:
        model = GradientBoostingRegressor(
            n_estimators=200, max_depth=5, learning_rate=0.05,
            subsample=0.8, random_state=42
        )

    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)

    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    r2 = r2_score(y_test, y_pred)

    print(f"[Forecaster] Validation MAE: {mae:.1f}, RMSE: {rmse:.1f}, R²: {r2:.3f}")

    # Generate 7-day forecast
    last_known = feat_df.iloc[-1:].copy()
    forecast_dates = []
    forecast_values = []

    current_date = pd.to_datetime(daily['date'].max()) + pd.Timedelta(days=1)

    # Simple rolling forecast
    recent_values = list(daily['count'].values[-14:])

    for day in range(7):
        fdate = current_date + pd.Timedelta(days=day)
        forecast_dates.append(fdate.strftime('%Y-%m-%d'))

        # Use recent average with day-of-week adjustment
        base = np.mean(recent_values[-7:])
        dow = fdate.dayofweek
        dow_factor = daily[daily['date'].dt.dayofweek == dow]['count'].mean() / daily['count'].mean()
        predicted = base * dow_factor
        forecast_values.append(round(max(0, predicted)))

    # Per-station forecasts (simplified — use historical averages with trends)
    station_forecasts = {}
    for station in df['police_station'].value_counts().head(10).index:
        station_df_filt = df[df['police_station'] == station]
        station_daily = station_df_filt.groupby('date').size()
        station_base = station_daily.mean()
        station_trend = 0
        if len(station_daily) > 14:
            recent_avg = station_daily.iloc[-7:].mean()
            older_avg = station_daily.iloc[-14:-7].mean()
            station_trend = (recent_avg - older_avg) / max(older_avg, 1) * 100

        station_fc = []
        for day in range(7):
            fdate = current_date + pd.Timedelta(days=day)
            dow = fdate.dayofweek
            st_dow = df[(df['police_station'] == station) & (df['day_of_week'] == dow)]
            daily_count = st_dow.groupby('date').size()
            predicted = daily_count.mean() if len(daily_count) > 0 else station_base
            station_fc.append(round(max(0, predicted)))

        station_forecasts[station] = {
            'forecast': station_fc,
            'avg_daily': round(station_base, 1),
            'trend_pct': round(station_trend, 1),
        }

    # Historical vs predicted for chart
    actual_dates = [pd.Timestamp(d).strftime('%Y-%m-%d') for d in dates_test]
    historical = {
        'dates': actual_dates,
        'actual': [int(v) for v in y_test],
        'predicted': [int(round(v)) for v in y_pred],
    }

    return {
        'model_metrics': {'mae': round(mae, 1), 'rmse': round(rmse, 1), 'r2': round(r2, 3)},
        'forecast': {'dates': forecast_dates, 'values': forecast_values},
        'station_forecasts': station_forecasts,
        'historical': historical,
        'feature_importance': dict(zip(
            feature_cols,
            [round(float(v), 4) for v in (model.feature_importances_ if hasattr(model, 'feature_importances_') else np.zeros(len(feature_cols)))]
        )),
    }


def generate_enforcement_recommendations(df, impact_data, output_dir='dashboard/data'):
    """Generate patrol deployment recommendations based on CIS and temporal patterns."""
    print("[Forecaster] Generating enforcement recommendations...")
    os.makedirs(output_dir, exist_ok=True)

    # Load impact scores
    if isinstance(impact_data, str):
        with open(impact_data) as f:
            impact_data = json.load(f)

    stations = impact_data.get('stations', [])

    recommendations = []
    for station in stations[:10]:  # Top-10 by CIS
        name = station['name']
        station_df = df[df['police_station'] == name]

        if len(station_df) == 0:
            continue

        # Find peak hours
        hourly = station_df.groupby('hour_ist').size()
        peak_hours = hourly.nlargest(3).index.tolist()
        peak_hours_str = ', '.join([f"{h}:00" for h in sorted(peak_hours)])

        # Find peak days
        daily = station_df.groupby('day_name').size()
        peak_day = daily.idxmax()

        # Estimated violations per patrol hour (based on historical)
        avg_hourly_violations = len(station_df) / (df['date'].nunique() * 24)

        # Coverage efficiency
        main_road_pct = station_df['is_main_road_violation'].mean() * 100

        recommendations.append({
            'station': name,
            'cis': station['cis'],
            'total_violations': station['count'],
            'peak_hours': sorted(peak_hours),
            'peak_hours_str': peak_hours_str,
            'peak_day': peak_day,
            'avg_hourly_violations': round(avg_hourly_violations, 1),
            'main_road_pct': round(main_road_pct, 1),
            'recommended_units': max(1, min(5, station['count'] // 5000)),
            'expected_reduction_pct': round(min(40, station['cis'] * 0.6), 1),
            'lat': station['lat'],
            'lon': station['lon'],
        })

    with open(os.path.join(output_dir, 'enforcement.json'), 'w') as f:
        json.dump(recommendations, f, indent=2)

    print(f"[Forecaster] ✅ Exported {len(recommendations)} enforcement recommendations")
    return recommendations


def run_forecasting(df, output_dir='dashboard/data'):
    """Full forecasting pipeline."""
    os.makedirs(output_dir, exist_ok=True)

    forecast_data = train_forecast_model(df)

    with open(os.path.join(output_dir, 'forecasts.json'), 'w') as f:
        json.dump(forecast_data, f, indent=2)

    print(f"[Forecaster] ✅ Exported forecast data to forecasts.json")
    return forecast_data


if __name__ == '__main__':
    df = pd.read_csv('data_clean.csv')
    run_forecasting(df)
