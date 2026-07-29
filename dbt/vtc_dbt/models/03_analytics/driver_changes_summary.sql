{{ config(materialized='view') }}

WITH changes AS (
    SELECT
        trip_id,
        COUNT(DISTINCT driver_id) AS num_driver_changes
    FROM {{ ref('fact__trips') }}
    GROUP BY trip_id
)
SELECT
    ROUND(AVG(num_driver_changes), 2) AS avg_driver_changes,
    MIN(num_driver_changes) AS min_driver_changes,
    MAX(num_driver_changes) AS max_driver_changes
FROM changes
