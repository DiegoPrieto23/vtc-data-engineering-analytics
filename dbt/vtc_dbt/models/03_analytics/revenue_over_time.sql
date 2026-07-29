{{ config(materialized='view') }}

WITH trips AS (
    SELECT
        start_day as trip_date,
        DATE_TRUNC('month', start_at)::date AS trip_month,
        DATE_TRUNC('year', start_at)::date AS trip_year,
        price_eur,
        trip_id
    FROM {{ ref('fact__trips') }}
    WHERE reason IS NOT NULL
      AND price IS NOT NULL
      AND price <> 'NaN'
)
SELECT
    trip_year,
    trip_month,
    trip_date,
    COUNT(DISTINCT trip_id) AS num_trips,
    ROUND(SUM(price_eur), 2) AS total_revenue_eur,
    ROUND(AVG(price_eur), 2) AS avg_trip_price_eur,
    CASE
        WHEN trip_date IS NOT NULL THEN 'daily'
        WHEN trip_month IS NOT NULL AND trip_date IS NULL THEN 'monthly'
        WHEN trip_year IS NOT NULL AND trip_month IS NULL THEN 'yearly'
        ELSE 'total'
    END AS aggregation_level
FROM trips
GROUP BY GROUPING SETS (
    (trip_year, trip_month, trip_date),   
    (trip_year, trip_month),              
    (trip_year),                        
    ()                                    
)
ORDER BY trip_year, trip_month, trip_date