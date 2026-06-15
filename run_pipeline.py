"""
SignalFlow - Pipeline Orchestrator
Run this single script to process data, run all ML models, and export dashboard JSON.

Usage: python run_pipeline.py
"""

import os
import sys
import time
import json
import io

# Fix Windows encoding issues
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def main():
    start = time.time()
    print("=" * 70)
    print("  SignalFlow — Parking Intelligence Pipeline")
    print("  Flipkart Gridlock 2.0 | Theme 1: Parking-Induced Congestion")
    print("=" * 70)

    output_dir = os.path.join('dashboard', 'data')
    os.makedirs(output_dir, exist_ok=True)

    # Step 1: Data Processing
    print("\n" + "─" * 50)
    print("STEP 1/5: Data Processing")
    print("─" * 50)
    from data_processor import process_data
    df = process_data('data_raw.csv', 'data_clean.csv')

    # Reload with proper list parsing
    import pandas as pd
    df = pd.read_csv('data_clean.csv')
    df['violation_list'] = df['violation_list'].apply(json.loads)

    # Step 2: Temporal Analysis & Summary Stats
    print("\n" + "─" * 50)
    print("STEP 2/5: Temporal Analysis")
    print("─" * 50)
    from temporal_analyzer import analyze_temporal_patterns, compute_summary_stats
    analyze_temporal_patterns(df, output_dir)
    compute_summary_stats(df, output_dir)

    # Step 3: Hotspot Detection
    print("\n" + "─" * 50)
    print("STEP 3/5: Hotspot Detection (Spatial Clustering)")
    print("─" * 50)
    from hotspot_engine import run_hotspot_analysis
    df_clustered, cluster_summary, hotspot_list = run_hotspot_analysis(df, output_dir)

    # Step 4: Impact Scoring
    print("\n" + "─" * 50)
    print("STEP 4/5: Congestion Impact Scoring")
    print("─" * 50)
    from impact_scorer import compute_impact_scores
    junction_stats, station_stats = compute_impact_scores(df, output_dir)

    # Step 5: Forecasting & Enforcement
    print("\n" + "─" * 50)
    print("STEP 5/5: Forecasting & Enforcement Optimization")
    print("─" * 50)
    from forecaster import run_forecasting, generate_enforcement_recommendations
    run_forecasting(df, output_dir)

    # Load impact scores for enforcement recommendations
    impact_path = os.path.join(output_dir, 'impact_scores.json')
    generate_enforcement_recommendations(df, impact_path, output_dir)

    # Summary
    elapsed = time.time() - start
    print("\n" + "=" * 70)
    print(f"  ✅ PIPELINE COMPLETE in {elapsed:.1f}s")
    print(f"  Dashboard data exported to: {output_dir}/")
    print(f"  Files generated:")
    for f in sorted(os.listdir(output_dir)):
        size = os.path.getsize(os.path.join(output_dir, f))
        print(f"    • {f} ({size/1024:.1f} KB)")
    print()
    print(f"  🚀 Open dashboard/index.html in your browser to view the dashboard")
    print("=" * 70)


if __name__ == '__main__':
    main()
