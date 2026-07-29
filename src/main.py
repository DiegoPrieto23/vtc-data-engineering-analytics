import os
import subprocess
from src.etl_raw import extract_drivers, extract_trip, extract_cars, extract_users
from src.utils.db_connection import get_connection
from src.utils.unzip_dataset import unzip_dataset
from src.utils.dbt_transform import dbt_transform


def init_schemas():
    """Creates the required schemas if they do not exist."""
    print("[INIT] Creating schemas (raw, staging, core, analytics)...")
    schemas = ["raw", "staging", "core", "analytics"]
    conn = get_connection()
    conn.autocommit = True
    cur = conn.cursor()
    for schema in schemas:
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {schema};")
    cur.close()
    conn.close()
    print("[OK] Schemas ready.\n")


def run_dbt_full():
    """Runs dbt transformations in order (staging -> core -> analytics)."""
    dbt_dir = os.path.join("dbt", "vtc_dbt")
    print("\n[DBT] Running global dbt transformations...")

    # 1) Run staging layer
    subprocess.run(["dbt", "run", "--select", "01_staging"], cwd=dbt_dir, check=True)

    # 2) Run core layer
    subprocess.run(["dbt", "run", "--select", "02_core"], cwd=dbt_dir, check=True)
    
    # 3) Run tests (core only)
    subprocess.run(["dbt", "test", "--select", "02_core"], cwd=dbt_dir, check=True)

    # 4) Run analytics layer (if already exists)
    subprocess.run(["dbt", "run", "--select", "03_analytics"], cwd=dbt_dir, check=True)
    
    print("[OK] dbt transformations completed.\n")


def run_full_pipeline():
    """Full pipeline: unzip + raw load + full dbt run."""
    print("\n🚀 Starting VTC pipeline (RAW → STAGING → CORE → ANALYTICS)...\n")

    init_schemas()
    unzip_dataset()

    extract_drivers.initial_load(extract_zip=False)
    extract_trip.initial_load(extract_zip=False)
    extract_cars.initial_load(extract_zip=False)
    extract_users.initial_load(extract_zip=False)

    run_dbt_full()
    print("\n✅ Full pipeline completed.\n")


if __name__ == "__main__":
    target = os.getenv("PIPELINE_TARGET", "all")

    if target == "all":
        run_full_pipeline()
    elif target == "drivers":
        init_schemas()
        unzip_dataset()
        extract_drivers.initial_load(extract_zip=False)
        dbt_transform("staging", "drivers")
        dbt_transform("core", "drivers")
    elif target == "trips":
        init_schemas()
        unzip_dataset()
        extract_trip.initial_load(extract_zip=False)
        dbt_transform("staging", "trips")
        dbt_transform("core", "trips")
    elif target == "cars":
        init_schemas()
        unzip_dataset()
        extract_cars.initial_load(extract_zip=False)
        dbt_transform("staging", "cars")
        dbt_transform("core", "cars")
    elif target == "users":
        init_schemas()
        unzip_dataset()
        extract_users.initial_load(extract_zip=False)
        dbt_transform("staging", "users")
        dbt_transform("core", "users")
    else:
        print(f"[ERROR] Unrecognized PIPELINE_TARGET value: {target}")
