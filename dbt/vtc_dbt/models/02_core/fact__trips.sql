{{
    config(
        materialized='table',
        post_hook="ALTER TABLE {{ this }} ADD PRIMARY KEY (trip_id, updated_at)"
    )
}}

-- ============================================================
-- CTE 0: Divisa y tipo de cambio por país
--
--   minor_units → divisor para pasar del importe almacenado a la unidad
--     principal de la divisa. Los importes llegan en la unidad *menor*
--     (céntimos / centavos) en todos los mercados salvo COP y CLP, que se
--     registran en pesos enteros porque su unidad menor no se usa en la
--     práctica. Aplicar /100 a todos los mercados por igual dividía los
--     ingresos de Colombia y Chile por 100.
--   rate_to_eur → euros por 1 unidad principal de la divisa (media de 2021,
--     el periodo que cubre el dataset).
--
--   Comprobación: la mediana del ticket queda entre 2 y 10 € en los siete
--   mercados, que es el rango esperable de un trayecto urbano.
-- ============================================================
WITH fx_rates AS (
    SELECT *
    FROM (VALUES
        ('ES', 'EUR', 100, 1.0::numeric),
        ('CO', 'COP',   1, 0.000226),
        ('PE', 'PEN', 100, 0.2225),
        ('CL', 'CLP',   1, 0.00105),
        ('EC', 'USD', 100, 0.845),
        ('AR', 'ARS', 100, 0.00875),
        ('MX', 'MXN', 100, 0.0417)
    ) AS f(country, currency, minor_units, rate_to_eur)
),

-- ============================================================
-- CTE 1: Agregar los eventos del viaje para calcular las métricas de duración
-- ============================================================
trip_events AS (
    SELECT
        trip_id,
        ARRAY_AGG(updated_at ORDER BY updated_at ASC) AS updated_list,
        MIN(created_at) AS first_created_at,
        MAX(updated_at) AS last_updated_at,
        MAX(NULLIF(TRIM(COALESCE(reason, '')), '')) AS final_reason
    FROM {{ ref('staging__trips') }}
    GROUP BY trip_id
),

duration_calc AS (
    SELECT
        trip_id,
        first_created_at,
        last_updated_at,
        final_reason,
        -- Tiempo total del viaje (en minutos)
        EXTRACT(EPOCH FROM (last_updated_at - first_created_at)) / 60 AS trip_duration_minutes,
        -- Tiempo efectivo (último - penúltimo updated_at)
        CASE
            WHEN array_length(updated_list, 1) > 1
                THEN EXTRACT(EPOCH FROM (updated_list[array_length(updated_list, 1)] - updated_list[array_length(updated_list, 1) - 1])) / 60
            ELSE EXTRACT(EPOCH FROM (last_updated_at - first_created_at)) / 60
        END AS effective_trip_duration_minutes
    FROM trip_events
),

waiting_calc AS (
    SELECT
        trip_id,
        first_created_at,
        last_updated_at,
        final_reason,
        trip_duration_minutes,
        effective_trip_duration_minutes,
        GREATEST(trip_duration_minutes - effective_trip_duration_minutes, 0) AS waiting_time_minutes
    FROM duration_calc
),

-- ============================================================
-- CTE 2: Asignar el desfase horario según el país del usuario
-- ============================================================
localized_trips AS (
    SELECT
        t.*,
        u.locale_country,
        CASE
            WHEN u.locale_country = 'AR' THEN INTERVAL '-3 hour'
            WHEN u.locale_country = 'CO' THEN INTERVAL '-5 hour'
            WHEN u.locale_country = 'MX' THEN INTERVAL '-6 hour'
            WHEN u.locale_country = 'CL' THEN INTERVAL '-4 hour'
            WHEN u.locale_country = 'PE' THEN INTERVAL '-5 hour'
            WHEN u.locale_country = 'EC' THEN INTERVAL '-5 hour'
            WHEN u.locale_country = 'ES' THEN INTERVAL '+1 hour'
            ELSE INTERVAL '0 hour'
        END AS tz_offset
    FROM {{ ref('staging__trips') }} t
    LEFT JOIN {{ ref('dim__users') }} u
        ON t.user_id = u.user_id
        AND t.start_at >= u.valid_from
        AND (t.start_at < u.valid_to OR u.valid_to IS NULL)
),

-- ============================================================
-- CTE 3: Aplicar el desfase horario a todas las columnas de fecha y hora
-- ============================================================
trips_localized AS (
    SELECT
        t.trip_id,
        t.driver_id,
        t.car_id,
        t.user_id,
        t.locale_country,

        -- Convertir todas las marcas de tiempo a hora local
        t.created_at + t.tz_offset AS created_at_local,
        t.updated_at + t.tz_offset AS updated_at_local,
        t.start_at + t.tz_offset AS start_at_local,

        -- Ajustar también los tiempos de referencia de las duraciones
        w.first_created_at + t.tz_offset AS first_created_at_local,
        w.last_updated_at + t.tz_offset AS last_updated_at_local,

        t.reason,
        t.price,
        t.stops
    FROM localized_trips t
    LEFT JOIN waiting_calc w USING (trip_id)
)

-- ============================================================
-- CTE 4: Construir la tabla de hechos final
-- ============================================================
SELECT
    t.trip_id,
    t.created_at_local AS created_at,
    t.updated_at_local AS updated_at,
    t.start_at_local AS start_at,

    -- Componentes de fecha y hora ya localizados
    CAST(EXTRACT(ISODOW FROM t.start_at_local) AS INT) AS week_day,
    DATE(t.start_at_local) AS start_day,
    CAST(EXTRACT(DAY FROM t.start_at_local) AS INT) AS start_date,
    CAST(EXTRACT(MONTH FROM t.start_at_local) AS INT) AS start_month,
    CAST(EXTRACT(YEAR FROM t.start_at_local) AS INT) AS start_year,
    CAST(EXTRACT(HOUR FROM t.start_at_local) AS INT) AS start_hour,

    t.driver_id,
    t.car_id,
    t.user_id,
    NULLIF(TRIM(COALESCE(t.reason, '')), '') AS reason,

    -- Coordenadas de inicio y de fin
    (t.stops->0->'loc'->>0)::float AS start_lat,
    (t.stops->0->'loc'->>1)::float AS start_lon,
    (t.stops->1->'loc'->>0)::float AS end_lat,
    (t.stops->1->'loc'->>1)::float AS end_lon,

    -- Métricas de duración (calculadas en minutos)
    CASE 
        WHEN t.reason IS NOT NULL THEN w.trip_duration_minutes 
        ELSE NULL 
    END AS trip_duration_minutes,

    CASE 
        WHEN t.reason IS NOT NULL THEN w.effective_trip_duration_minutes 
        ELSE NULL 
    END AS effective_trip_duration_minutes,

    CASE 
        WHEN t.reason IS NOT NULL THEN w.waiting_time_minutes 
        ELSE NULL 
    END AS waiting_time_minutes,

    -- Precio (solo cuando reason viene informado)
    CASE WHEN TRIM(COALESCE(t.reason, '')) <> '' THEN t.price ELSE NULL END AS price,

    -- Divisa local y tipo de cambio aplicado
    COALESCE(fx.currency, 'EUR')    AS currency,
    COALESCE(fx.minor_units, 100)   AS price_minor_units,
    COALESCE(fx.rate_to_eur, 1.0)   AS exchange_rate,

    -- Precio convertido a EUR: importe → unidad principal → euros
    CASE
        WHEN TRIM(COALESCE(t.reason, '')) <> ''
             AND t.price IS NOT NULL
             AND t.price <> 'NaN'
        THEN ROUND(
                 t.price / COALESCE(fx.minor_units, 100) * COALESCE(fx.rate_to_eur, 1.0),
                 2
             )
        ELSE NULL
    END AS price_eur,

    t.locale_country AS user_country,
    dvr.state AS driver_state,
    c.icon AS car_type

FROM trips_localized t
LEFT JOIN waiting_calc w USING (trip_id)
LEFT JOIN fx_rates fx
    ON fx.country = t.locale_country
LEFT JOIN {{ ref('dim__drivers') }} dvr
    ON t.driver_id = dvr.driver_id
   AND t.start_at_local >= dvr.valid_from
   AND (t.start_at_local < dvr.valid_to OR dvr.valid_to IS NULL)
LEFT JOIN {{ ref('dim__cars') }} c
    ON t.car_id = c.car_id
   AND t.start_at_local >= c.valid_from
   AND (t.start_at_local < c.valid_to OR c.valid_to IS NULL)
