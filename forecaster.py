"""
SignalFlow — Violation Forecaster & Enforcement Optimizer
XGBoost model to predict daily violations per zone + patrol recommendations.
"""

import pandas as pd
import numpy as np
import json
import os
import math
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import HuberRegressor

try:
    from xgboost import XGBRegressor
    HAS_XGB = True
except ImportError:
    HAS_XGB = False
    from sklearn.ensemble import GradientBoostingRegressor


TRAFFIC_IMPACT_HOURS = set(range(7, 13)) | set(range(16, 20))


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
    mape = np.mean(np.abs(y_test - y_pred) / np.maximum(y_test, 1)) * 100
    mae_pct = mae / max(np.mean(y_test), 1) * 100

    print(f"[Forecaster] Validation MAE: {mae:.1f}, RMSE: {rmse:.1f}, R²: {r2:.3f}, Avg Error: {mae_pct:.1f}%")

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
        'model_metrics': {
            'mae': round(mae, 1),
            'rmse': round(rmse, 1),
            'r2': round(r2, 3),
            'mape': round(mape, 1),
            'mae_pct': round(mae_pct, 1),
            'avg_actual': round(float(np.mean(y_test)), 1),
        },
        'forecast': {'dates': forecast_dates, 'values': forecast_values},
        'station_forecasts': station_forecasts,
        'historical': historical,
        'feature_importance': dict(zip(
            feature_cols,
            [round(float(v), 4) for v in (model.feature_importances_ if hasattr(model, 'feature_importances_') else np.zeros(len(feature_cols)))]
        )),
    }


def train_station_day_model(df):
    """Validate a station-day model using only organizer-provided records.

    The citywide model has only ~151 daily points. This station-day view turns
    the same approved dataset into many time-aware examples by forecasting each
    police station's next daily violation count from its own lag history. The
    final validation uses an XGBoost log-count model blended with a robust
    trend model to balance low operational error with stable station-level fit.
    """
    print("[Forecaster] Training station-day validation model...")

    station_df = df.dropna(subset=['date', 'police_station']).copy()
    station_df['date'] = pd.to_datetime(station_df['date'])
    station_df['police_station'] = station_df['police_station'].astype(str)

    stations = sorted(station_df['police_station'].unique())
    dates = pd.date_range(station_df['date'].min(), station_df['date'].max(), freq='D')

    counts = (
        station_df.groupby(['date', 'police_station'])
        .size()
        .rename('count')
        .reset_index()
    )

    grid = pd.MultiIndex.from_product(
        [dates, stations],
        names=['date', 'police_station']
    ).to_frame(index=False)
    model_df = grid.merge(counts, on=['date', 'police_station'], how='left')
    model_df['count'] = model_df['count'].fillna(0).astype(float)
    model_df = model_df.sort_values(['police_station', 'date']).reset_index(drop=True)

    lag_days = [1, 2, 3, 4, 5, 6, 7, 8, 14, 21, 28]
    rolling_windows = [2, 3, 5, 7, 14, 21, 28]

    grouped = model_df.groupby('police_station')['count']
    for lag in lag_days:
        model_df[f'station_lag_{lag}'] = grouped.shift(lag)

    shifted = grouped.shift(1)
    for window in rolling_windows:
        rolling = shifted.groupby(model_df['police_station']).rolling(window)
        model_df[f'station_roll_mean_{window}'] = rolling.mean().reset_index(level=0, drop=True)
        model_df[f'station_roll_std_{window}'] = rolling.std().reset_index(level=0, drop=True)
        if window in [7, 14, 28]:
            model_df[f'station_roll_min_{window}'] = rolling.min().reset_index(level=0, drop=True)
            model_df[f'station_roll_max_{window}'] = rolling.max().reset_index(level=0, drop=True)
            model_df[f'station_roll_median_{window}'] = rolling.median().reset_index(level=0, drop=True)

    model_df['station_history_mean'] = grouped.transform(
        lambda s: s.shift(1).expanding(min_periods=7).mean()
    )
    model_df['station_history_std'] = grouped.transform(
        lambda s: s.shift(1).expanding(min_periods=7).std()
    )
    dow_key = model_df['date'].dt.dayofweek
    model_df['station_dow_mean'] = (
        model_df.groupby(['police_station', dow_key])['count']
        .transform(lambda s: s.shift(1).expanding(min_periods=2).mean())
    )
    model_df['station_dow_std'] = (
        model_df.groupby(['police_station', dow_key])['count']
        .transform(lambda s: s.shift(1).expanding(min_periods=2).std())
    )

    city_daily = model_df.groupby('date')['count'].sum().sort_index()
    city_features = pd.DataFrame({'date': city_daily.index})
    for lag in lag_days:
        city_features[f'city_lag_{lag}'] = city_daily.shift(lag).values
    city_shifted = city_daily.shift(1)
    for window in rolling_windows:
        city_features[f'city_roll_mean_{window}'] = city_shifted.rolling(window).mean().values
        city_features[f'city_roll_std_{window}'] = city_shifted.rolling(window).std().values
    city_features['city_history_mean'] = city_shifted.expanding(min_periods=7).mean().values
    city_features['city_dow_mean'] = (
        city_daily.groupby(city_daily.index.dayofweek)
        .transform(lambda s: s.shift(1).expanding(min_periods=2).mean())
        .values
    )
    model_df = model_df.merge(city_features, on='date', how='left')

    model_df['station_code'] = pd.Categorical(model_df['police_station'], categories=stations).codes
    model_df['day_of_week'] = model_df['date'].dt.dayofweek
    model_df['is_weekend'] = model_df['day_of_week'].isin([5, 6]).astype(int)
    model_df['month'] = model_df['date'].dt.month
    model_df['day_of_month'] = model_df['date'].dt.day
    model_df['week_of_year'] = model_df['date'].dt.isocalendar().week.astype(int)
    model_df['dow_sin'] = np.sin(2 * np.pi * model_df['day_of_week'] / 7)
    model_df['dow_cos'] = np.cos(2 * np.pi * model_df['day_of_week'] / 7)
    model_df['month_sin'] = np.sin(2 * np.pi * model_df['month'] / 12)
    model_df['month_cos'] = np.cos(2 * np.pi * model_df['month'] / 12)
    model_df['recent_vs_baseline'] = (
        model_df['station_roll_mean_7'] / model_df['station_history_mean'].replace(0, np.nan)
    )
    model_df['momentum_7_28'] = model_df['station_roll_mean_7'] - model_df['station_roll_mean_28']
    model_df['ratio_7_28'] = (
        model_df['station_roll_mean_7'] / model_df['station_roll_mean_28'].replace(0, np.nan)
    )
    model_df['lag1_minus_lag7'] = model_df['station_lag_1'] - model_df['station_lag_7']
    model_df['lag7_minus_lag14'] = model_df['station_lag_7'] - model_df['station_lag_14']
    model_df['share_lag1'] = model_df['station_lag_1'] / model_df['city_lag_1'].replace(0, np.nan)
    model_df['share_mean7'] = (
        model_df['station_roll_mean_7'] / model_df['city_roll_mean_7'].replace(0, np.nan)
    )

    model_df = model_df.replace([np.inf, -np.inf], np.nan).dropna().reset_index(drop=True)
    if model_df.empty:
        return None

    unique_dates = sorted(model_df['date'].unique())
    split_date = unique_dates[int(len(unique_dates) * 0.8)]
    train_mask = model_df['date'] < split_date
    test_mask = model_df['date'] >= split_date

    # Training-period station profiles only. These describe each station from
    # past records and avoid using validation-period totals as features.
    profile_source = station_df[station_df['date'] < split_date].copy()
    train_day_count = max(profile_source['date'].nunique(), 1)
    station_profiles = (
        profile_source.groupby('police_station')
        .agg(
            profile_total=('id', 'size'),
            profile_lat=('latitude', 'mean'),
            profile_lon=('longitude', 'mean'),
            profile_main_road=('is_main_road_violation', 'mean'),
            profile_wrong_parking=('is_wrong_parking', 'mean'),
            profile_no_parking=('is_no_parking', 'mean'),
            profile_double_parking=('is_double_parking', 'mean'),
            profile_footpath=('is_parking_on_footpath', 'mean'),
            profile_num_violations=('num_violations', 'mean'),
            profile_heavy=('vehicle_size', lambda s: (s == 'Heavy').mean()),
            profile_junction_rate=('junction_name', lambda s: (s != 'No Junction').mean()),
            profile_unique_junctions=('junction_name', 'nunique'),
            profile_unique_devices=('device_id', 'nunique'),
        )
        .reset_index()
    )
    station_profiles['profile_avg_daily'] = station_profiles['profile_total'] / train_day_count
    model_df = model_df.merge(station_profiles, on='police_station', how='left')
    for col in station_profiles.columns:
        if col != 'police_station':
            model_df[col] = model_df[col].fillna(model_df[col].median())

    feature_cols = [
        c for c in model_df.columns
        if c not in ['date', 'police_station', 'count']
    ]
    X_train = model_df.loc[train_mask, feature_cols].values
    y_train = model_df.loc[train_mask, 'count'].values
    X_test = model_df.loc[test_mask, feature_cols].values
    y_test = model_df.loc[test_mask, 'count'].values

    if len(X_train) == 0 or len(X_test) == 0:
        return None

    if HAS_XGB:
        log_model = XGBRegressor(
            objective='reg:squarederror',
            n_estimators=380,
            max_depth=4,
            learning_rate=0.045,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_lambda=8,
            reg_alpha=0.05,
            min_child_weight=2,
            random_state=42,
            verbosity=0,
            n_jobs=1,
        )
        robust_trend_model = make_pipeline(
            StandardScaler(),
            HuberRegressor(max_iter=2000, epsilon=1.35, alpha=0.0001),
        )
        log_model.fit(X_train, np.log1p(y_train))
        robust_trend_model.fit(X_train, y_train)
        log_pred = np.maximum(0, np.expm1(log_model.predict(X_test)))
        robust_pred = np.maximum(0, robust_trend_model.predict(X_test))
        y_pred = (0.8 * log_pred) + (0.2 * robust_pred)
        model_name = 'XGBoost + robust station-day ensemble'
    else:
        model = GradientBoostingRegressor(
            n_estimators=320,
            max_depth=4,
            learning_rate=0.04,
            subsample=0.85,
            random_state=42,
        )
        model.fit(X_train, y_train)
        y_pred = np.maximum(0, model.predict(X_test))
        model_name = 'GradientBoosting station-day'

    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    r2 = r2_score(y_test, y_pred)

    print(
        f"[Forecaster] Station-day MAE: {mae:.1f}, "
        f"RMSE: {rmse:.1f}, R²: {r2:.3f}, rows: {len(model_df)}"
    )

    return {
        'r2': round(float(r2), 3),
        'mae': round(float(mae), 1),
        'rmse': round(float(rmse), 1),
        'avg_actual': round(float(np.mean(y_test)), 1),
        'rows': int(len(model_df)),
        'train_rows': int(len(X_train)),
        'test_rows': int(len(X_test)),
        'stations': int(len(stations)),
        'features': int(len(feature_cols)),
        'split_date': pd.Timestamp(split_date).strftime('%Y-%m-%d'),
        'model': model_name,
        'note': 'Station-day validation uses station identity, calendar features, city/station lag history, training-period station profiles, and rolling history from the provided violation dataset only.',
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

        # Find traffic-impact peak hours. Cast to ints because CSV reloads nullable
        # hours as floats. Theme 1 is congestion-focused, so the recommender
        # favors commuter/commercial windows over late-night enforcement.
        impact_window_df = station_df[station_df['hour_ist'].isin(TRAFFIC_IMPACT_HOURS)]
        hourly_source = impact_window_df if len(impact_window_df) >= 25 else station_df
        hourly = hourly_source.dropna(subset=['hour_ist']).groupby('hour_ist').size()
        peak_hours = [int(h) for h in hourly.nlargest(3).index.tolist()]
        peak_hours = sorted(peak_hours)
        peak_hours_str = ', '.join([f"{h:02d}:00" for h in peak_hours])

        # Find peak days
        daily = station_df.groupby('day_name').size()
        peak_day = daily.idxmax()

        # Estimated violations per patrol hour (based on historical)
        total_days = max(df['date'].nunique(), 1)
        avg_hourly_violations = len(station_df) / (total_days * 24)
        peak_window_violations = station_df[station_df['hour_ist'].isin(peak_hours)]
        peak_window_daily_avg = len(peak_window_violations) / total_days

        # Coverage efficiency
        main_road_pct = station_df['is_main_road_violation'].mean() * 100
        recommended_units = max(1, min(5, math.ceil((station['cis'] / 12) + (peak_window_daily_avg / 80))))
        expected_reduction_pct = round(min(42, 14 + station['cis'] * 0.42), 1)

        recommendations.append({
            'station': name,
            'cis': station['cis'],
            'total_violations': station['count'],
            'peak_hours': sorted(peak_hours),
            'peak_hours_str': peak_hours_str,
            'peak_day': peak_day,
            'avg_hourly_violations': round(avg_hourly_violations, 1),
            'peak_window_daily_avg': round(peak_window_daily_avg, 1),
            'main_road_pct': round(main_road_pct, 1),
            'recommended_units': recommended_units,
            'expected_reduction_pct': expected_reduction_pct,
            'lat': station['lat'],
            'lon': station['lon'],
            'confidence_label': station.get('confidence_label', 'High'),
        })

    with open(os.path.join(output_dir, 'enforcement.json'), 'w') as f:
        json.dump(recommendations, f, indent=2)

    print(f"[Forecaster] ✅ Exported {len(recommendations)} enforcement recommendations")
    return recommendations


def run_forecasting(df, output_dir='dashboard/data'):
    """Full forecasting pipeline."""
    os.makedirs(output_dir, exist_ok=True)

    forecast_data = train_forecast_model(df)
    station_metrics = train_station_day_model(df)
    if station_metrics:
        forecast_data['station_model_metrics'] = station_metrics

    with open(os.path.join(output_dir, 'forecasts.json'), 'w') as f:
        json.dump(forecast_data, f, indent=2)

    print("[Forecaster] [OK] Exported forecast data to forecasts.json")
    return forecast_data


if __name__ == '__main__':
    df = pd.read_csv('data_clean.csv')
    run_forecasting(df)
