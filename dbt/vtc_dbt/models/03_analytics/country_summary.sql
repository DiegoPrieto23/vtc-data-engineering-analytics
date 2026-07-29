{{ config(materialized='view') }}

WITH user_stats AS (
    SELECT
        locale_country AS country,
        COUNT(DISTINCT user_id) AS num_users
    FROM {{ ref('dim__users') }}
    GROUP BY locale_country
),
driver_stats AS (
    SELECT
        state AS driver_state,
        COUNT(DISTINCT driver_id) AS num_drivers
    FROM {{ ref('dim__drivers') }}
    GROUP BY state
),
trip_stats AS (
    SELECT
        user_country AS country,
        COUNT(DISTINCT trip_id) AS num_trips,
        ROUND(SUM(price_eur), 2) AS total_revenue_eur,
        ROUND(AVG(price_eur), 2) AS avg_trip_price_eur,
        ROUND(AVG(effective_trip_duration_minutes), 2) AS avg_effective_trip_duration_min,
        ROUND(AVG(waiting_time_minutes), 2) AS avg_waiting_time_min
    FROM {{ ref('fact__trips') }}
    WHERE reason IS NOT NULL
      AND price IS NOT NULL
      AND price <> 'NaN'
    GROUP BY user_country
)
SELECT
    t.country,
    COALESCE(u.num_users, 0) AS num_users,
    COALESCE(d.num_drivers, 0) AS num_drivers,
    t.num_trips,
    t.total_revenue_eur,
    t.avg_trip_price_eur,
    t.avg_effective_trip_duration_min,
    t.avg_waiting_time_min
FROM trip_stats t
LEFT JOIN user_stats u ON t.country = u.country
LEFT JOIN driver_stats d ON d.driver_state = t.country
