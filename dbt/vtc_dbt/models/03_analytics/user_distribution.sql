{{ config(materialized='view') }}

SELECT
    locale_country,
    COUNT(DISTINCT user_id) AS num_users,
    ROUND(AVG(total_trips), 2) AS avg_trips_per_user,
    ROUND(AVG(total_spent_eur), 2) AS avg_spent_per_user_eur
FROM (
    SELECT
        u.user_id,
        u.locale_country,
        COUNT(DISTINCT f.trip_id) AS total_trips,
        SUM(f.price_eur) AS total_spent_eur
    FROM {{ ref('dim__users') }} u
    LEFT JOIN {{ ref('fact__trips') }} f
      ON u.user_id = f.user_id
     AND f.reason IS NOT NULL
     AND f.price IS NOT NULL
     AND f.price <> 'NaN'
    GROUP BY u.user_id, u.locale_country
) t
GROUP BY locale_country
ORDER BY num_users DESC
