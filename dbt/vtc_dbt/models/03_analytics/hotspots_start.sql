{{ config(materialized='view') }}

SELECT
    user_country,
    ROUND(start_lat::numeric, 3) AS lat,
    ROUND(start_lon::numeric, 3) AS lon,
    COUNT(*) AS num_trips
FROM {{ ref('fact__trips') }}
WHERE reason IS NOT NULL
  AND price IS NOT NULL
  AND price <> 'NaN'
GROUP BY user_country, ROUND(start_lat::numeric, 3), ROUND(start_lon::numeric, 3)
ORDER BY num_trips DESC
