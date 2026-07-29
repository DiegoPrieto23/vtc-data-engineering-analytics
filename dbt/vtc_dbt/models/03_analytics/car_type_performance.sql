{{ config(materialized='view') }}

SELECT
    car_type,
    COUNT(DISTINCT trip_id) AS num_trips,
    ROUND(SUM(price_eur), 2) AS total_revenue_eur,
    ROUND(AVG(price_eur), 2) AS avg_price_eur,
    ROUND(AVG(effective_trip_duration_minutes), 2) AS avg_effective_trip_duration_min
FROM {{ ref('fact__trips') }}
WHERE reason IS NOT NULL
  AND price IS NOT NULL
  AND price <> 'NaN'
GROUP BY car_type
ORDER BY total_revenue_eur DESC
