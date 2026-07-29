{{ config(materialized='view') }}

SELECT
    TRIM(TO_CHAR(ft.start_at, 'Day')) AS weekday,
    CASE TRIM(TO_CHAR(ft.start_at, 'Day'))
        WHEN 'Monday' THEN 1
        WHEN 'Tuesday' THEN 2
        WHEN 'Wednesday' THEN 3
        WHEN 'Thursday' THEN 4
        WHEN 'Friday' THEN 5
        WHEN 'Saturday' THEN 6
        WHEN 'Sunday' THEN 7
    END AS weekday_number,
    COUNT(DISTINCT trip_id) AS num_trips,
    ROUND(AVG(price_eur), 2) AS avg_price_eur,
    ROUND(AVG(effective_trip_duration_minutes), 2) AS avg_effective_trip_duration_min,
    ROUND(AVG(waiting_time_minutes), 2) AS avg_waiting_time_min
FROM core.fact__trips ft 
WHERE reason IS NOT NULL
  AND price IS NOT NULL
  AND price <> 'NaN'
GROUP BY 1, 2
ORDER BY weekday_number