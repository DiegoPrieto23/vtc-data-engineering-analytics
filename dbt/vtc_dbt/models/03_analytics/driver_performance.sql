{{ config(materialized='view') }}

SELECT
    f.driver_id,
    d.state AS driver_state,
    COUNT(DISTINCT f.trip_id) AS num_trips,
    ROUND(SUM(f.price_eur), 2) AS total_revenue_eur,
    ROUND(AVG(f.price_eur), 2) AS avg_trip_price_eur,
    ROUND(AVG(f.effective_trip_duration_minutes), 2) AS avg_effective_trip_duration_min,
    ROUND(SUM(f.price_eur) / NULLIF(SUM(f.effective_trip_duration_minutes), 0), 2) AS revenue_per_minute_eur
FROM {{ ref('fact__trips') }} f
LEFT JOIN {{ ref('dim__drivers') }} d
    ON f.driver_id = d.driver_id
   AND f.start_at >= d.valid_from
   AND (f.start_at < d.valid_to OR d.valid_to IS NULL)
WHERE f.reason IS NOT NULL
  AND f.price IS NOT NULL
  AND f.price <> 'NaN'
GROUP BY f.driver_id, d.state
ORDER BY total_revenue_eur DESC
