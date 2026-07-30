import os
import subprocess
from src.etl_raw import extract_drivers, extract_trip, extract_cars, extract_users
from src.utils.db_connection import get_connection
from src.utils.unzip_dataset import unzip_dataset
from src.utils.dbt_transform import dbt_transform


def init_schemas():
    """Crea los esquemas necesarios si no existen."""
    print("[INIT] Creando esquemas (raw, staging, core, analytics)...")
    schemas = ["raw", "staging", "core", "analytics"]
    conn = get_connection()
    conn.autocommit = True
    cur = conn.cursor()
    for schema in schemas:
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {schema};")
    cur.close()
    conn.close()
    print("[OK] Esquemas listos.\n")


def run_dbt_full():
    """Ejecuta las transformaciones de dbt en orden (staging -> core -> analytics)."""
    dbt_dir = os.path.join("dbt", "vtc_dbt")
    print("\n[DBT] Ejecutando las transformaciones globales de dbt...")

    # 1) Ejecutar la capa staging
    subprocess.run(["dbt", "run", "--select", "01_staging"], cwd=dbt_dir, check=True)

    # 2) Ejecutar la capa core
    subprocess.run(["dbt", "run", "--select", "02_core"], cwd=dbt_dir, check=True)
    
    # 3) Ejecutar los tests (solo core)
    subprocess.run(["dbt", "test", "--select", "02_core"], cwd=dbt_dir, check=True)

    # 4) Ejecutar la capa analytics (si ya existe)
    subprocess.run(["dbt", "run", "--select", "03_analytics"], cwd=dbt_dir, check=True)
    
    print("[OK] Transformaciones de dbt completadas.\n")


def run_full_pipeline():
    """Pipeline completo: descompresión + carga raw + ejecución completa de dbt."""
    print("\n🚀 Iniciando el pipeline VTC (RAW → STAGING → CORE → ANALYTICS)...\n")

    init_schemas()
    unzip_dataset()

    extract_drivers.initial_load(extract_zip=False)
    extract_trip.initial_load(extract_zip=False)
    extract_cars.initial_load(extract_zip=False)
    extract_users.initial_load(extract_zip=False)

    run_dbt_full()
    print("\n✅ Pipeline completo finalizado.\n")


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
        print(f"[ERROR] Valor de PIPELINE_TARGET no reconocido: {target}")
