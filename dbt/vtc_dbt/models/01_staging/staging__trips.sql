{{ 
    config(
        materialized='table',
        post_hook="ALTER TABLE {{ this }} ADD PRIMARY KEY (trip_id, updated_at)"
    )
}}

WITH ordered AS (
    SELECT
        id as trip_id,
        user_id,
        reason,
        driver as driver_id,
        car as car_id,
        stops,
        price,
        created_at,
        updated_at,
        start_at,
        LAG(driver) OVER (PARTITION BY id ORDER BY updated_at) AS prev_driver_id,
        LAG(car)     OVER (PARTITION BY id ORDER BY updated_at) AS prev_car_id
    FROM {{ source('raw', 'trip') }}
),

flagged AS (
    SELECT
        *,
        -- First row of the trip
        (prev_driver_id IS NULL) AS is_first_row,

        -- Driver or car change
        (
            driver_id IS DISTINCT FROM prev_driver_id
            OR car_id IS DISTINCT FROM prev_car_id
        ) AS is_change_event,

        -- Detect if reason is provided (not null or empty string)
        (TRIM(COALESCE(reason, '')) <> '') AS has_reason,

        -- Detect if price is provided (not null and not NaN)
        (price IS NOT NULL AND price <> 'NaN') AS has_price
    FROM ordered
),

-- Detect, for each trip, the first row where reason is informed
first_reason AS (
    SELECT
        trip_id,
        MIN(updated_at) AS first_reason_time
    FROM flagged
    WHERE has_reason
    GROUP BY trip_id
),

-- From those rows with reason, get the first one with a valid price
first_reason_with_price AS (
    SELECT
        f.trip_id,
        MIN(f.updated_at) AS first_reason_with_price_time
    FROM flagged f
    WHERE f.has_reason AND f.has_price 
    GROUP BY f.trip_id
),

-- Join everything and prioritize the row with a price if it exists; otherwise use the first with reason
final_events AS (
    SELECT
        fr.trip_id,
        COALESCE(frwp.first_reason_with_price_time, fr.first_reason_time) AS final_event_time
    FROM first_reason fr
    LEFT JOIN first_reason_with_price frwp
      ON fr.trip_id = frwp.trip_id
),

filtered AS (
    SELECT DISTINCT ON (f.trip_id, f.updated_at)
        f.trip_id,
        f.user_id,
        f.reason,
        f.driver_id,
        f.car_id,
        f.stops,
        f.price,
        f.created_at,
        f.updated_at,
        f.start_at
    FROM flagged f
    LEFT JOIN final_events fe
      ON f.trip_id = fe.trip_id
    WHERE
        f.is_first_row
        OR f.is_change_event
        OR f.updated_at = fe.final_event_time
)

SELECT
    trip_id,
    user_id,
    reason,
    driver_id,
    car_id,
    stops,
    price,
    created_at,
    updated_at,
    start_at
FROM filtered
WHERE jsonb_array_length(stops::jsonb) = 2