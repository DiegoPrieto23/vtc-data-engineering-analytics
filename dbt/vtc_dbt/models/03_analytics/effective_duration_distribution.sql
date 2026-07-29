{{ config(materialized='view') }}

SELECT
    CASE
        WHEN effective_trip_duration_minutes < 5 THEN '<5 min'
        WHEN effective_trip_duration_minutes < 10 THEN '5-10 min'
        WHEN effective_trip_duration_minutes < 20 THEN '10-20 min'
        WHEN effective_trip_duration_minutes < 40 THEN '20-40 min'
        ELSE '40+ min'
    END AS duration_bucket,
    COUNT(DISTINCT trip_id) AS num_trips,
    ROUND(AVG(price_eur), 2) AS avg_price_eur
FROM {{ ref('fact__trips') }}
WHERE reason IS NOT NULL
  AND price IS NOT NULL
  AND price <> 'NaN'
GROUP BY duration_bucket
ORDER BY num_trips DESC
