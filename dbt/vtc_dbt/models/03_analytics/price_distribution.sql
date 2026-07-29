{{ config(materialized='view') }}

WITH base AS (
    SELECT *
    FROM {{ ref('fact__trips') }}
    WHERE reason IS NOT NULL
)
SELECT
    user_country,

    -- Totales por país
    COUNT(DISTINCT trip_id) AS total_trips,
    COUNT(DISTINCT CASE WHEN price IS NOT NULL AND price <> 'NaN' THEN trip_id END) AS trips_with_price,
    COUNT(DISTINCT CASE WHEN price IS NOT NULL AND price <> 'NaN' AND price_eur = 0 THEN trip_id END) AS trips_with_price_zero,
    COUNT(DISTINCT CASE WHEN price IS NOT NULL AND price <> 'NaN' AND price_eur > 0 THEN trip_id END) AS trips_with_price_positive,
    
    -- Estadísticas sobre los viajes con precio positivo
    ROUND(AVG(CASE WHEN price_eur > 0 AND price IS NOT NULL AND price <> 'NaN' THEN price_eur END), 2) AS avg_price_eur,
    ROUND(MIN(CASE WHEN price_eur > 0 AND price IS NOT NULL AND price <> 'NaN' THEN price_eur END), 2) AS min_price_eur,
    ROUND(MAX(CASE WHEN price_eur > 0 AND price IS NOT NULL AND price <> 'NaN' THEN price_eur END), 2) AS max_price_eur,
    ROUND(
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CASE 
            WHEN price_eur > 0 AND price IS NOT NULL AND price <> 'NaN' THEN price_eur::double precision 
        END)::numeric,
        2
    ) AS median_price_eur,
    ROUND(STDDEV(CASE WHEN price_eur > 0 AND price IS NOT NULL AND price <> 'NaN' THEN price_eur END), 2) AS stddev_price_eur

FROM base
GROUP BY user_country
ORDER BY total_trips DESC
