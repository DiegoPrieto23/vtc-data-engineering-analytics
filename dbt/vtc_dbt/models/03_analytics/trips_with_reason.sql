{{ config(materialized='view') }}

SELECT *
FROM {{ ref('fact__trips') }}
WHERE reason IS NOT NULL