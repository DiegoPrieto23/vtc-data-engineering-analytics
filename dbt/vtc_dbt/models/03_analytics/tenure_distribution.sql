{{ config(materialized='view') }}

WITH user_tenure AS (
    SELECT
        'user' AS entity_type,
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, created_at))::int AS years_registered
    FROM {{ ref('dim__users') }}
),
driver_tenure AS (
    SELECT
        'driver' AS entity_type,
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, created_at))::int AS years_registered
    FROM {{ ref('dim__drivers') }}
),
car_tenure AS (
    SELECT
        'car' AS entity_type,
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, created_at))::int AS years_registered
    FROM {{ ref('dim__cars') }}
),
union_all AS (
    SELECT * FROM user_tenure
    UNION ALL
    SELECT * FROM driver_tenure
    UNION ALL
    SELECT * FROM car_tenure
)
SELECT
    entity_type,
    years_registered,
    COUNT(*) AS num_entities
FROM union_all
GROUP BY entity_type, years_registered
ORDER BY entity_type, years_registered
