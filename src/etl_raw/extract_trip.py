import os
import io
import json
import pandas as pd
import psycopg2
import subprocess
from psycopg2.extras import execute_values
from src.utils.db_connection import get_connection
from src.utils.load_ndjson import load_ndjson


def ensure_schemas():
    """Creates the base schemas if they do not exist."""
    conn = get_connection()
    conn.autocommit = True
    cur = conn.cursor()
    for schema in ["raw", "staging", "core", "analytics"]:
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {schema};")
    cur.close()
    conn.close()


def initial_load(extract_zip=False):
    """Incremental load of trips into the database (raw schema)."""
    print("\n==============================")
    print("🚕 [START] Incremental load of TRIPS")
    print("==============================\n")

    ensure_schemas()

    base_dir = os.path.join(os.getcwd(), "data")
    extracted_dir = os.path.join(base_dir, "extracted")
    json_path = os.path.join(extracted_dir, "trip.json")

    if not os.path.exists(json_path):
        raise FileNotFoundError(f"{json_path} not found. Please run unzip_dataset().")

    df = load_ndjson(json_path)
    print(f"[INFO] {len(df)} records loaded from trip.json")

    if "user" in df.columns:
        df = df.rename(columns={"user": "user_id"})

    if "stops" in df.columns:
        df["stops"] = df["stops"].apply(
            lambda x: json.dumps(x) if isinstance(x, (list, dict)) else json.dumps([])
        )

    conn = get_connection()
    cur = conn.cursor()

    create_table_sql = """
    CREATE TABLE IF NOT EXISTS raw.trip (
        id TEXT,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        user_id TEXT,
        reason TEXT,
        start_at TIMESTAMP,
        driver TEXT,
        car TEXT,
        stops JSONB,
        price NUMERIC,
        PRIMARY KEY (id, updated_at)
    );
    """
    cur.execute(create_table_sql)
    print("[OK] Table raw.trip created or already exists")

    cols = list(df.columns)
    values = [tuple(x) for x in df.to_numpy()]
    insert_sql = f"""
        INSERT INTO raw.trip ({', '.join(cols)})
        VALUES %s
        ON CONFLICT (id, updated_at) DO NOTHING;
    """
    execute_values(cur, insert_sql, values)
    conn.commit()

    cur.close()
    conn.close()
    print(f"[OK] {len(values)} rows processed (new inserted, duplicates ignored)")
    print("\n✅ [DONE] Incremental load of TRIP completed.\n")
