{{ config(materialized='view') }}

SELECT
    user_country,
    COUNT(DISTINCT trip_id) AS num_trips,
    ROUND(SUM(price_eur), 2) AS total_revenue_eur,
    ROUND(AVG(price_eur), 2) AS avg_trip_price_eur,
    ROUND(AVG(effective_trip_duration_minutes), 2) AS avg_effective_trip_duration_min,
    ROUND(SUM(price_eur) / NULLIF(SUM(effective_trip_duration_minutes), 0), 2) AS revenue_per_minute_eur
FROM {{ ref('fact__trips') }}
WHERE reason IS NOT NULL
  AND price IS NOT NULL
  AND price <> 'NaN'
GROUP BY user_country
ORDER BY total_revenue_eur DESC
