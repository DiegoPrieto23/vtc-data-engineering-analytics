{{ config(materialized='view') }}

SELECT
    reason,
    COUNT(DISTINCT trip_id) AS num_trips,
    ROUND(AVG(price_eur), 2) AS avg_price_eur,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct_total
FROM {{ ref('fact__trips') }}
WHERE price IS NOT NULL
GROUP BY reason
ORDER BY num_trips DESC
