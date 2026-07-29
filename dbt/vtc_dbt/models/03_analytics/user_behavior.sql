{{ config(materialized='view') }}

SELECT
    user_id,
    user_country,
    COUNT(DISTINCT trip_id) AS total_trips,
    ROUND(SUM(price_eur), 2) AS total_spent_eur,
    ROUND(AVG(price_eur), 2) AS avg_spent_per_trip_eur,
    MIN(created_at) AS first_trip_date,
    MAX(updated_at) AS last_trip_date
FROM {{ ref('fact__trips') }}
WHERE reason IS NOT NULL
  AND price IS NOT NULL
  AND price <> 'NaN'
GROUP BY user_id, user_country
ORDER BY total_spent_eur DESC
