"""
Exporta los datos necesarios para el informe interactivo (report/) desde PostgreSQL.

Genera ficheros JSON estáticos en `report/data/` para que el dashboard funcione
tanto en local (python -m http.server) como publicado en GitHub Pages, sin
necesidad de una base de datos detrás.

Uso:
    python -m scripts.export_report_data
    python scripts/export_report_data.py --out report/data

Requiere que el pipeline esté ejecutado (docker compose up) y que la base de
datos sea accesible en PG_HOST (por defecto localhost desde fuera de Docker).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

# El ID `1B2M2Y8AsgTpgAmY7PhCfg==` es el hash MD5 de la cadena vacía codificado
# en base64: es el placeholder que usa el sistema cuando todavía no hay
# conductor/vehículo asignado, no una entidad real.
PLACEHOLDER_ID = "1B2M2Y8AsgTpgAmY7PhCfg=="

# Divisa local por país (para poder mostrar el precio original además del EUR).
CURRENCIES = {
    "ES": "EUR",
    "CO": "COP",
    "PE": "PEN",
    "CL": "CLP",
    "EC": "USD",
    "AR": "ARS",
    "MX": "MXN",
}

# Centros de ciudad para asignar cada viaje a un área metropolitana.
# (lat, lon, nombre, radio_km máximo de asignación)
CITIES = [
    # España
    (40.4168, -3.7038, "Madrid", "ES", 45),
    (41.3874, 2.1686, "Barcelona", "ES", 35),
    (39.4699, -0.3763, "Valencia", "ES", 30),
    (37.3891, -5.9845, "Sevilla", "ES", 30),
    (36.7213, -4.4214, "Málaga", "ES", 30),
    (43.2630, -2.9350, "Bilbao", "ES", 30),
    (41.6488, -0.8891, "Zaragoza", "ES", 25),
    (38.3452, -0.4810, "Alicante", "ES", 25),
    (37.9922, -1.1307, "Murcia", "ES", 25),
    (39.5696, 2.6502, "Palma", "ES", 30),
    (28.1235, -15.4363, "Las Palmas", "ES", 40),
    (28.4636, -16.2518, "Tenerife", "ES", 40),
    (42.2406, -8.7207, "Vigo", "ES", 25),
    (43.3623, -8.4115, "A Coruña", "ES", 25),
    (37.1773, -3.5986, "Granada", "ES", 25),
    (41.6523, -4.7245, "Valladolid", "ES", 25),
    (37.8882, -4.7794, "Córdoba", "ES", 25),
    (43.3183, -1.9812, "San Sebastián", "ES", 25),
    (43.4623, -3.8100, "Santander", "ES", 25),
    (43.5322, -5.6611, "Gijón", "ES", 25),
    (42.8125, -1.6458, "Pamplona", "ES", 25),
    (36.8340, -2.4637, "Almería", "ES", 25),
    # Colombia
    (4.7110, -74.0721, "Bogotá", "CO", 45),
    (6.2442, -75.5812, "Medellín", "CO", 35),
    (3.4516, -76.5320, "Cali", "CO", 30),
    (10.9639, -74.7964, "Barranquilla", "CO", 30),
    (10.3910, -75.4794, "Cartagena", "CO", 30),
    (7.1193, -73.1227, "Bucaramanga", "CO", 30),
    # Perú
    (-12.0464, -77.0428, "Lima", "PE", 55),
    (-16.4090, -71.5375, "Arequipa", "PE", 30),
    (-8.1091, -79.0215, "Trujillo", "PE", 30),
    # Chile
    (-33.4489, -70.6693, "Santiago", "CL", 45),
    (-33.0472, -71.6127, "Valparaíso", "CL", 30),
    (-36.8201, -73.0444, "Concepción", "CL", 30),
    (-23.6509, -70.3975, "Antofagasta", "CL", 30),
    # Ecuador
    (-0.1807, -78.4678, "Quito", "EC", 40),
    (-2.1894, -79.8891, "Guayaquil", "EC", 40),
    (-2.9001, -79.0059, "Cuenca", "EC", 30),
    # Argentina
    (-34.6037, -58.3816, "Buenos Aires", "AR", 55),
    (-31.4201, -64.1888, "Córdoba (AR)", "AR", 30),
    (-32.9442, -60.6505, "Rosario", "AR", 30),
    (-32.8895, -68.8458, "Mendoza", "AR", 30),
    # México
    (19.4326, -99.1332, "Ciudad de México", "MX", 55),
    (20.6597, -103.3496, "Guadalajara", "MX", 40),
    (25.6866, -100.3161, "Monterrey", "MX", 40),
    (19.0414, -98.2063, "Puebla", "MX", 30),
    (21.1619, -86.8515, "Cancún", "MX", 30),
]


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def haversine_km(lat1, lon1, lat2, lon2):
    """Distancia en línea recta (km) entre dos coordenadas."""
    if None in (lat1, lon1, lat2, lon2):
        return None
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * r * math.asin(min(1.0, math.sqrt(a))), 3)


def assign_city(lat, lon, country):
    """Asigna el área metropolitana más cercana dentro de su radio."""
    if lat is None or lon is None:
        return "Sin geolocalizar"
    best, best_d = None, None
    for clat, clon, name, ccountry, radius in CITIES:
        if country and ccountry != country:
            continue
        d = haversine_km(lat, lon, clat, clon)
        if d is not None and d <= radius and (best_d is None or d < best_d):
            best, best_d = name, d
    if best:
        return best
    # Segunda pasada ignorando el país del usuario (viajes en el extranjero).
    for clat, clon, name, ccountry, radius in CITIES:
        d = haversine_km(lat, lon, clat, clon)
        if d is not None and d <= radius and (best_d is None or d < best_d):
            best, best_d = name, d
    return best or "Otras zonas"


def clean(value):
    """Normaliza tipos de psycopg2 a algo serializable en JSON."""
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, 6)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def rows_to_dicts(cur):
    cols = [c.name for c in cur.description]
    return [{c: clean(v) for c, v in zip(cols, row)} for row in cur.fetchall()]


def q(cur, sql, params=None):
    cur.execute(sql, params or ())
    return rows_to_dicts(cur)


def q_one(cur, sql, params=None):
    res = q(cur, sql, params)
    return res[0] if res else {}


def get_connection():
    """Conecta a PostgreSQL tanto desde dentro de Docker como desde el host.

    Dentro de un contenedor de la propia compose el host es `postgres`. Desde
    fuera hay que ir por el puerto publicado; si en la máquina hay otro
    PostgreSQL escuchando en el 5432, se puede redirigir con PG_HOST_LOCAL /
    PG_PORT_LOCAL sin tocar el `.env` que consume Docker.
    """
    in_docker = Path("/.dockerenv").exists()
    host = os.getenv("PG_HOST_LOCAL") or os.getenv("PG_HOST", "localhost")
    port = os.getenv("PG_PORT_LOCAL") or os.getenv("PG_PORT", "5432")
    if not in_docker and host == "postgres":
        host = "localhost"
    print(f"[INFO] Conectando a {host}:{port}/{os.getenv('PG_DB', 'vtc_db')}…")
    return psycopg2.connect(
        host=host,
        port=port,
        dbname=os.getenv("PG_DB", "vtc_db"),
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD"),
    )


# ---------------------------------------------------------------------------
# Consultas
# ---------------------------------------------------------------------------

TRIPS_SQL = """
WITH events AS (
    SELECT
        trip_id,
        COUNT(*)                                                        AS n_events,
        COUNT(DISTINCT driver_id) FILTER (WHERE driver_id <> %(ph)s)    AS n_drivers,
        COUNT(DISTINCT car_id)    FILTER (WHERE car_id    <> %(ph)s)    AS n_cars,
        MIN(created_at)                                                 AS requested_at,
        MIN(start_at)                                                   AS start_at,
        MAX(updated_at)                                                 AS ended_at
    FROM core.fact__trips
    GROUP BY trip_id
),
ranked AS (
    SELECT
        f.*,
        ROW_NUMBER() OVER (
            PARTITION BY f.trip_id
            ORDER BY
                (f.price IS NOT NULL AND f.price <> 'NaN') DESC,
                (f.reason IS NOT NULL) DESC,
                f.updated_at DESC
        ) AS rn_final
    FROM core.fact__trips f
)
SELECT
    r.trip_id,
    r.user_id,
    r.driver_id,
    r.car_id,
    r.car_type,
    r.user_country,
    r.reason,
    CASE WHEN r.price = 'NaN' THEN NULL ELSE r.price END        AS price_raw,
    r.price_eur,
    r.currency,
    r.price_minor_units,
    r.exchange_rate,
    r.start_at,
    r.week_day,
    r.start_hour,
    r.start_day                                                  AS trip_date,
    r.start_lat, r.start_lon, r.end_lat, r.end_lon,
    r.trip_duration_minutes,
    r.effective_trip_duration_minutes,
    r.waiting_time_minutes,
    e.n_events,
    e.n_drivers,
    e.n_cars,
    e.requested_at,
    e.ended_at
FROM ranked r
JOIN events e USING (trip_id)
WHERE r.rn_final = 1
ORDER BY r.start_at
"""


def build_trips(cur):
    raw = q(cur, TRIPS_SQL, {"ph": PLACEHOLDER_ID})
    trips = []
    for i, t in enumerate(raw):
        country = t["user_country"]
        city = assign_city(t["start_lat"], t["start_lon"], country)
        city_end = assign_city(t["end_lat"], t["end_lon"], country)
        raw_price, minor = t["price_raw"], t["price_minor_units"] or 100
        trips.append({
            "i": i,
            "id": t["trip_id"],
            "u": t["user_id"],
            "d": None if t["driver_id"] == PLACEHOLDER_ID else t["driver_id"],
            "car": None if t["car_id"] == PLACEHOLDER_ID else t["car_id"],
            "ct": t["car_type"],
            "c": country,
            "city": city,
            "city_end": city_end,
            "r": t["reason"],
            "p": t["price_eur"],
            "pl": None if raw_price is None else round(float(raw_price) / minor, 2),
            "cur": t["currency"] or CURRENCIES.get(country),
            "fx": t["exchange_rate"],
            "dt": t["trip_date"],
            "h": t["start_hour"],
            "wd": t["week_day"],
            "dur": t["trip_duration_minutes"],
            "eff": t["effective_trip_duration_minutes"],
            "wait": t["waiting_time_minutes"],
            "slat": t["start_lat"], "slon": t["start_lon"],
            "elat": t["end_lat"], "elon": t["end_lon"],
            "km": haversine_km(t["start_lat"], t["start_lon"], t["end_lat"], t["end_lon"]),
            "ev": t["n_events"],
            "nd": t["n_drivers"],
            "nc": t["n_cars"],
        })
    return trips


def build_meta(cur, trips):
    meta = {"generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z"}

    # --- Volumetría por capa -------------------------------------------------
    layers = q(cur, """
        SELECT 'raw.trip'          AS tabla, COUNT(*) AS filas, COUNT(DISTINCT id)      AS entidades FROM raw.trip
        UNION ALL SELECT 'raw.drivers',      COUNT(*), COUNT(DISTINCT id)               FROM raw.drivers
        UNION ALL SELECT 'raw.cars',         COUNT(*), COUNT(DISTINCT _id)              FROM raw.cars
        UNION ALL SELECT 'raw.users',        COUNT(*), COUNT(DISTINCT id)               FROM raw.users
        UNION ALL SELECT 'staging.trips',    COUNT(*), COUNT(DISTINCT trip_id)          FROM staging.staging__trips
        UNION ALL SELECT 'staging.drivers',  COUNT(*), COUNT(DISTINCT driver_id)        FROM staging.staging__drivers
        UNION ALL SELECT 'staging.cars',     COUNT(*), COUNT(DISTINCT car_id)           FROM staging.staging__cars
        UNION ALL SELECT 'staging.users',    COUNT(*), COUNT(DISTINCT user_id)          FROM staging.staging__users
        UNION ALL SELECT 'core.fact__trips', COUNT(*), COUNT(DISTINCT trip_id)          FROM core.fact__trips
        UNION ALL SELECT 'core.dim__users',  COUNT(*), COUNT(DISTINCT user_id)          FROM core.dim__users
        UNION ALL SELECT 'core.dim__drivers',COUNT(*), COUNT(DISTINCT driver_id)        FROM core.dim__drivers
        UNION ALL SELECT 'core.dim__cars',   COUNT(*), COUNT(DISTINCT car_id)           FROM core.dim__cars
    """)
    meta["layers"] = layers

    # --- Embudo de reducción de filas ---------------------------------------
    raw_rows = q_one(cur, "SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS trips FROM raw.trip")
    stg = q_one(cur, "SELECT COUNT(*) AS n, COUNT(DISTINCT trip_id) AS trips FROM staging.staging__trips")
    stops_dist = q(cur, """
        WITH last_row AS (
            SELECT DISTINCT ON (id) id, stops
            FROM raw.trip ORDER BY id, updated_at DESC
        )
        SELECT jsonb_array_length(stops::jsonb) AS n_stops, COUNT(*) AS trips
        FROM last_row GROUP BY 1 ORDER BY 1
    """)
    meta["funnel"] = {
        "raw_rows": raw_rows.get("n"),
        "raw_trips": raw_rows.get("trips"),
        "staging_rows": stg.get("n"),
        "staging_trips": stg.get("trips"),
        "fact_trips": len(trips),
        "trips_with_reason": sum(1 for t in trips if t["r"]),
        "trips_with_price": sum(1 for t in trips if t["p"] is not None),
        "stops_distribution": stops_dist,
    }

    # --- Tipología de las filas conservadas en staging ------------------------
    meta["row_roles"] = q(cur, """
        WITH ordered AS (
            SELECT id AS trip_id, updated_at, driver, car, reason,
                   LAG(driver) OVER (PARTITION BY id ORDER BY updated_at) AS prev_driver,
                   LAG(car)    OVER (PARTITION BY id ORDER BY updated_at) AS prev_car
            FROM raw.trip
        )
        SELECT
            CASE
                WHEN prev_driver IS NULL THEN 'Primera fila del viaje'
                WHEN TRIM(COALESCE(reason,'')) <> '' THEN 'Cierre (reason informado)'
                WHEN driver IS DISTINCT FROM prev_driver OR car IS DISTINCT FROM prev_car
                    THEN 'Cambio de conductor / vehículo'
                ELSE 'Actualización redundante'
            END AS rol,
            COUNT(*) AS filas
        FROM ordered
        GROUP BY 1 ORDER BY filas DESC
    """)

    # --- Cobertura de las dimensiones ---------------------------------------
    meta["coverage"] = q(cur, """
        SELECT 'Conductores' AS entidad,
               COUNT(DISTINCT t.driver) AS en_viajes,
               COUNT(DISTINCT t.driver) FILTER (WHERE d.driver_id IS NOT NULL) AS con_dimension
        FROM raw.trip t LEFT JOIN core.dim__drivers d ON t.driver = d.driver_id
        UNION ALL
        SELECT 'Vehículos',
               COUNT(DISTINCT t.car),
               COUNT(DISTINCT t.car) FILTER (WHERE c.car_id IS NOT NULL)
        FROM raw.trip t LEFT JOIN core.dim__cars c ON t.car = c.car_id
        UNION ALL
        SELECT 'Usuarios',
               COUNT(DISTINCT t.user_id),
               COUNT(DISTINCT t.user_id) FILTER (WHERE u.user_id IS NOT NULL)
        FROM raw.trip t LEFT JOIN core.dim__users u ON t.user_id = u.user_id
    """)

    # --- Nulos por columna en raw.trip --------------------------------------
    meta["raw_nulls"] = q(cur, """
        SELECT COUNT(*) AS filas,
               COUNT(*) FILTER (WHERE price IS NULL OR price = 'NaN')  AS price_nulo,
               COUNT(*) FILTER (WHERE TRIM(COALESCE(reason,'')) = '')  AS reason_vacio,
               COUNT(*) FILTER (WHERE driver = %(ph)s)                 AS driver_placeholder,
               COUNT(*) FILTER (WHERE car    = %(ph)s)                 AS car_placeholder
        FROM raw.trip
    """, {"ph": PLACEHOLDER_ID})[0]

    # --- Dimensiones: usuarios, conductores, vehículos -----------------------
    meta["users_by_country"] = q(cur, """
        SELECT locale_country AS country,
               locale_language AS language,
               COUNT(DISTINCT user_id) AS users
        FROM core.dim__users
        GROUP BY 1, 2 ORDER BY users DESC
    """)
    meta["drivers_total"] = q_one(cur, "SELECT COUNT(DISTINCT driver_id) AS n FROM core.dim__drivers").get("n")
    meta["cars_total"] = q_one(cur, "SELECT COUNT(DISTINCT car_id) AS n FROM core.dim__cars").get("n")
    meta["car_fleet"] = q(cur, """
        SELECT icon AS car_type,
               COUNT(DISTINCT car_id) AS cars,
               COUNT(DISTINCT car_id) FILTER (WHERE licensed)  AS licensed,
               COUNT(DISTINCT car_id) FILTER (WHERE disabled)  AS disabled
        FROM core.dim__cars
        WHERE is_valid
        GROUP BY 1 ORDER BY cars DESC
    """)
    meta["driver_state"] = q(cur, """
        SELECT COALESCE(state, '(sin estado)') AS state, COUNT(DISTINCT driver_id) AS drivers
        FROM core.dim__drivers GROUP BY 1 ORDER BY drivers DESC
    """)

    # --- Antigüedad de las entidades ----------------------------------------
    meta["tenure"] = q(cur, """
        SELECT entity_type, years_registered, num_entities
        FROM analytics.tenure_distribution
        ORDER BY entity_type, years_registered
    """)

    # --- Rangos de fechas ----------------------------------------------------
    meta["date_ranges"] = q(cur, """
        SELECT 'trips' AS entidad, MIN(created_at)::date AS desde, MAX(updated_at)::date AS hasta FROM raw.trip
        UNION ALL SELECT 'users',   MIN(created_at)::date, MAX(created_at)::date FROM core.dim__users
        UNION ALL SELECT 'drivers', MIN(created_at)::date, MAX(created_at)::date FROM core.dim__drivers
        UNION ALL SELECT 'cars',    MIN(created_at)::date, MAX(created_at)::date FROM core.dim__cars
    """)

    # --- Tipos de cambio realmente aplicados en el modelo --------------------
    meta["fx"] = q(cur, """
        SELECT DISTINCT
            user_country       AS country,
            currency,
            price_minor_units  AS minor_units,
            exchange_rate      AS rate
        FROM core.fact__trips
        WHERE user_country IS NOT NULL
        ORDER BY country
    """)
    meta["placeholder_id"] = PLACEHOLDER_ID
    return meta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(PROJECT_ROOT / "report" / "data"),
                        help="Directorio de salida de los JSON")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    conn = get_connection()
    cur = conn.cursor()

    print("[INFO] Construyendo el dataset de viajes...")
    trips = build_trips(cur)
    print(f"       {len(trips)} viajes.")

    print("[INFO] Construyendo metadatos y métricas de calidad...")
    meta = build_meta(cur, trips)

    cur.close()
    conn.close()

    (out_dir / "trips.json").write_text(
        json.dumps(trips, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    for name in ("trips.json", "meta.json"):
        size = (out_dir / name).stat().st_size / 1024
        print(f"[OK]   {out_dir / name}  ({size:,.0f} KB)")


if __name__ == "__main__":
    sys.exit(main())
