{{ config(materialized='view') }}

WITH ranked_routes AS (
    SELECT
        user_country,
        ROUND(start_lat::numeric, 2) AS start_lat,
        ROUND(start_lon::numeric, 2) AS start_lon,
        ROUND(end_lat::numeric, 2) AS end_lat,
        ROUND(end_lon::numeric, 2) AS end_lon,
        COUNT(*) AS num_trips,
        ROUND(AVG(effective_trip_duration_minutes), 2) AS avg_effective_trip_duration_min,
        ROUND(AVG(waiting_time_minutes), 2) AS avg_waiting_time_min,
        ROW_NUMBER() OVER (
            PARTITION BY user_country
            ORDER BY COUNT(*) DESC
        ) AS route_rank
    FROM {{ ref('fact__trips') }}
    WHERE reason IS NOT NULL
      AND price IS NOT NULL
      AND price <> 'NaN'
    GROUP BY
        user_country,
        ROUND(start_lat::numeric, 2),
        ROUND(start_lon::numeric, 2),
        ROUND(end_lat::numeric, 2),
        ROUND(end_lon::numeric, 2)
)
SELECT *
FROM ranked_routes
WHERE route_rank < 20
ORDER BY user_country, num_trips DESC
