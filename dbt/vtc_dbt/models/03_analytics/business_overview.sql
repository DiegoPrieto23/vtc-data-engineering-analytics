{{ config(materialized='view') }}

WITH trips AS (
    SELECT *
    FROM {{ ref('fact__trips') }}
    WHERE reason IS NOT NULL
)
SELECT
    COUNT(DISTINCT trip_id) AS total_trips,
    COUNT(DISTINCT CASE WHEN price IS NOT NULL AND price <> 'NaN' THEN trip_id END) AS valid_trips,
    ROUND(SUM(CASE WHEN price IS NOT NULL AND price <> 'NaN' THEN price_eur END), 2) AS total_revenue_eur,
    ROUND(AVG(CASE WHEN price IS NOT NULL AND price <> 'NaN' THEN price_eur END), 2) AS avg_trip_price_eur,
    ROUND(AVG(effective_trip_duration_minutes), 2) AS avg_effective_trip_duration_min,
    ROUND(AVG(waiting_time_minutes), 2) AS avg_waiting_time_min,
    ROUND(
        SUM(CASE WHEN price IS NOT NULL AND price <> 'NaN' THEN price_eur END)
        / NULLIF(SUM(effective_trip_duration_minutes), 0),
        2
    ) AS revenue_per_minute_eur,
    COUNT(DISTINCT user_country) AS num_countries
FROM trips

