"""
SignalFlow — Data Processor
Cleans and enriches the 298K parking violation records from Bengaluru.
"""

import pandas as pd
import numpy as np
import ast
import json
import os

# Bengaluru bounding box for filtering invalid coordinates
BLR_LAT_MIN, BLR_LAT_MAX = 12.75, 13.35
BLR_LON_MIN, BLR_LON_MAX = 77.35, 77.85

# UTC to IST offset
IST_OFFSET_HOURS = 5.5

# Vehicle size categories
HEAVY_VEHICLES = {'HGV', 'LGV', 'GOODS AUTO', 'TRUCK', 'TRACTOR', 'TRAILER', 'TIPPER', 'TANKER'}
MEDIUM_VEHICLES = {'MAXI-CAB', 'PASSENGER AUTO', 'BUS', 'MINI BUS'}
LIGHT_VEHICLES = {'CAR', 'SCOOTER', 'MOTOR CYCLE', 'MOPED', 'BICYCLE', 'E-RICKSHAW'}

# Main road violation types
MAIN_ROAD_VIOLATIONS = {
    'PARKING IN A MAIN ROAD', 'PARKING NEAR ROAD CROSSING',
    'PARKING NEAR TRAFFIC LIGHT OR ZEBRA CROSS',
    'PARKING NEAR BUSTOP/SCHOOL/HOSPITAL ETC',
    'PARKING OPPOSITE TO ANOTHER PARKED VEHICLE', 'DOUBLE PARKING'
}


def load_raw_data(filepath='data_raw.csv'):
    """Load the raw CSV dataset."""
    print(f"[DataProcessor] Loading {filepath}...")
    df = pd.read_csv(filepath)
    print(f"[DataProcessor] Loaded {len(df):,} records with {len(df.columns)} columns")
    return df


def parse_violation_types(df):
    """Parse JSON-encoded violation_type strings into individual flags."""
    print("[DataProcessor] Parsing violation types...")

    all_types = set()
    parsed_lists = []

    for v in df['violation_type']:
        try:
            violations = ast.literal_eval(v)
            if isinstance(violations, list):
                all_types.update(violations)
                parsed_lists.append(violations)
            else:
                parsed_lists.append([str(v)])
        except (ValueError, SyntaxError):
            parsed_lists.append([str(v)] if pd.notna(v) else [])

    df['violation_list'] = parsed_lists
    df['num_violations'] = df['violation_list'].apply(len)
    df['primary_violation'] = df['violation_list'].apply(lambda x: x[0] if x else 'UNKNOWN')

    # Create binary flags for key violation types
    key_violations = ['WRONG PARKING', 'NO PARKING', 'PARKING IN A MAIN ROAD',
                      'DOUBLE PARKING', 'PARKING ON FOOTPATH', 'DEFECTIVE NUMBER PLATE']
    for vtype in key_violations:
        col_name = 'is_' + vtype.lower().replace(' ', '_').replace('/', '_')
        df[col_name] = df['violation_list'].apply(lambda x: 1 if vtype in x else 0)

    # Flag if any violation is a main-road type
    df['is_main_road_violation'] = df['violation_list'].apply(
        lambda x: 1 if any(v in MAIN_ROAD_VIOLATIONS for v in x) else 0
    )

    print(f"[DataProcessor] Found {len(all_types)} unique violation types")
    return df


def extract_datetime_features(df):
    """Parse timestamps and extract IST-based temporal features."""
    print("[DataProcessor] Extracting datetime features...")

    df['created_dt'] = pd.to_datetime(df['created_datetime'], errors='coerce', utc=True)

    # Convert to IST
    df['created_ist'] = df['created_dt'] + pd.Timedelta(hours=IST_OFFSET_HOURS)

    df['hour_ist'] = df['created_ist'].dt.hour
    df['day_of_week'] = df['created_ist'].dt.dayofweek  # 0=Monday
    df['day_name'] = df['created_ist'].dt.day_name()
    df['month'] = df['created_ist'].dt.month
    df['month_name'] = df['created_ist'].dt.month_name()
    df['date'] = df['created_ist'].dt.date
    df['week'] = df['created_ist'].dt.isocalendar().week.fillna(0).astype(int)
    df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)

    # Time-of-day buckets
    conditions = [
        (df['hour_ist'] >= 6) & (df['hour_ist'] < 10),
        (df['hour_ist'] >= 10) & (df['hour_ist'] < 14),
        (df['hour_ist'] >= 14) & (df['hour_ist'] < 18),
        (df['hour_ist'] >= 18) & (df['hour_ist'] < 22),
    ]
    choices = ['Morning Rush', 'Midday', 'Afternoon Rush', 'Evening']
    df['time_period'] = np.select(conditions, choices, default='Night')

    print(f"[DataProcessor] Date range: {df['created_ist'].min()} to {df['created_ist'].max()}")
    return df


def clean_spatial_data(df):
    """Filter to valid Bengaluru coordinates."""
    print("[DataProcessor] Cleaning spatial data...")
    initial = len(df)

    mask = (
        (df['latitude'] >= BLR_LAT_MIN) & (df['latitude'] <= BLR_LAT_MAX) &
        (df['longitude'] >= BLR_LON_MIN) & (df['longitude'] <= BLR_LON_MAX)
    )
    df = df[mask].copy()
    removed = initial - len(df)
    if removed > 0:
        print(f"[DataProcessor] Removed {removed} records outside Bengaluru bounds")
    print(f"[DataProcessor] {len(df):,} records with valid coordinates")
    return df


def enrich_vehicle_features(df):
    """Add vehicle size categories and enrichment."""
    print("[DataProcessor] Enriching vehicle features...")

    def categorize_vehicle(vtype):
        if pd.isna(vtype):
            return 'Unknown'
        vtype_upper = str(vtype).upper().strip()
        if vtype_upper in HEAVY_VEHICLES:
            return 'Heavy'
        elif vtype_upper in MEDIUM_VEHICLES:
            return 'Medium'
        elif vtype_upper in LIGHT_VEHICLES:
            return 'Light'
        return 'Other'

    df['vehicle_size'] = df['vehicle_type'].apply(categorize_vehicle)

    # Standardize vehicle_type
    df['vehicle_type_clean'] = df['vehicle_type'].fillna('UNKNOWN').str.upper().str.strip()

    return df


def impute_station_codes(df):
    """Fill missing center_code from police_station mapping."""
    print("[DataProcessor] Imputing missing station codes...")

    # Build mapping from non-null rows
    station_code_map = (
        df.dropna(subset=['center_code'])
        .groupby('police_station')['center_code']
        .agg(lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else x.iloc[0])
        .to_dict()
    )

    mask = df['center_code'].isna()
    df.loc[mask, 'center_code'] = df.loc[mask, 'police_station'].map(station_code_map)

    remaining_nulls = df['center_code'].isna().sum()
    print(f"[DataProcessor] {remaining_nulls} center_code still null after imputation")
    return df


def process_data(input_path='data_raw.csv', output_path='data_clean.csv'):
    """Full processing pipeline."""
    df = load_raw_data(input_path)
    df = parse_violation_types(df)
    df = extract_datetime_features(df)
    df = clean_spatial_data(df)
    df = enrich_vehicle_features(df)
    df = impute_station_codes(df)

    # Select columns for output
    keep_cols = [
        'id', 'latitude', 'longitude', 'location',
        'vehicle_type_clean', 'vehicle_size',
        'violation_type', 'violation_list', 'num_violations',
        'primary_violation', 'is_main_road_violation',
        'is_wrong_parking', 'is_no_parking', 'is_parking_in_a_main_road',
        'is_double_parking', 'is_parking_on_footpath',
        'offence_code', 'device_id',
        'police_station', 'center_code', 'junction_name',
        'hour_ist', 'day_of_week', 'day_name', 'month', 'month_name',
        'date', 'week', 'is_weekend', 'time_period',
        'validation_status',
        'created_ist',
    ]
    keep_cols = [c for c in keep_cols if c in df.columns]
    df_out = df[keep_cols].copy()

    # Convert violation_list to string for CSV storage
    df_out['violation_list'] = df_out['violation_list'].apply(json.dumps)

    df_out.to_csv(output_path, index=False)
    print(f"\n[DataProcessor] ✅ Saved {len(df_out):,} clean records to {output_path}")
    print(f"[DataProcessor] Columns: {len(df_out.columns)}")

    return df_out


if __name__ == '__main__':
    process_data()
