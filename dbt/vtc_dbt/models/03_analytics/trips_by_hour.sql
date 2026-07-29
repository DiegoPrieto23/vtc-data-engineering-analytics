{{ config(materialized='view') }}

SELECT
    start_hour,
    COUNT(DISTINCT trip_id) AS num_trips,
    ROUND(AVG(price_eur), 2) AS avg_price_eur,
    ROUND(AVG(effective_trip_duration_minutes), 2) AS avg_effective_trip_duration_min,
    ROUND(AVG(waiting_time_minutes), 2) AS avg_waiting_time_min
FROM {{ ref('fact__trips') }}
WHERE reason IS NOT NULL
  AND price IS NOT NULL
  AND price <> 'NaN'
GROUP BY start_hour
ORDER BY start_hour
