import os
import io
import pandas as pd
import psycopg2
import subprocess
from psycopg2.extras import execute_values
from src.utils.db_connection import get_connection
from src.utils.load_ndjson import load_ndjson


def ensure_schemas():
    """Crea los esquemas base si no existen."""
    conn = get_connection()
    conn.autocommit = True
    cur = conn.cursor()
    for schema in ["raw", "staging", "core", "analytics"]:
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {schema};")
    cur.close()
    conn.close()


def initial_load(extract_zip=False):
    """Carga incremental de usuarios en la base de datos (esquema raw)."""
    print("\n==============================")
    print("👤 [INICIO] Carga incremental de USUARIOS")
    print("==============================\n")

    ensure_schemas()

    base_dir = os.path.join(os.getcwd(), "data")
    extracted_dir = os.path.join(base_dir, "extracted")
    json_path = os.path.join(extracted_dir, "users.json")

    if not os.path.exists(json_path):
        raise FileNotFoundError(f"No se ha encontrado {json_path}. Ejecuta antes unzip_dataset().")

    df = load_ndjson(json_path)
    print(f"[INFO] {len(df)} registros cargados desde users.json")

    conn = get_connection()
    cur = conn.cursor()

    create_table_sql = """
    CREATE TABLE IF NOT EXISTS raw.users (
        id TEXT,
        name TEXT,
        mobile_num TEXT,
        email TEXT,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        locale TEXT,
        PRIMARY KEY (id, updated_at)
    );
    """
    cur.execute(create_table_sql)
    print("[OK] Tabla raw.users creada o ya existente")

    cols = list(df.columns)
    values = [tuple(x) for x in df.to_numpy()]
    insert_sql = f"""
        INSERT INTO raw.users ({', '.join(cols)})
        VALUES %s
        ON CONFLICT (id, updated_at) DO NOTHING;
    """
    execute_values(cur, insert_sql, values)
    conn.commit()

    cur.close()
    conn.close()
    print(f"[OK] {len(values)} filas procesadas (se insertan las nuevas y se ignoran las duplicadas)")
    print("\n✅ [FIN] Carga incremental de USUARIOS completada.\n")
