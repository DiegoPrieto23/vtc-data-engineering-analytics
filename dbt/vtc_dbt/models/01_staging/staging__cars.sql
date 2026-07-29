{{ 
    config(
        materialized='table',
        post_hook="ALTER TABLE {{ this }} ADD PRIMARY KEY (car_id, updated_at)"
    )
}}

WITH ordered AS (
    SELECT
        _id AS car_id,
        licensed,
        disabled,
        icon,
        reg_plate,
        product_ids,
        created_at,
        updated_at,
        LAG(updated_at) OVER (PARTITION BY _id ORDER BY updated_at ASC) AS prev_updated_at,
        LEAD(updated_at) OVER (PARTITION BY _id ORDER BY updated_at ASC) AS next_updated_at
    FROM {{ source('raw', 'cars') }}
)
SELECT
    car_id,
    licensed,
    disabled,
    icon,
    reg_plate,
    product_ids,
    created_at,
    updated_at,
    COALESCE(prev_updated_at, created_at) AS valid_from,
    CASE
        WHEN next_updated_at IS NULL THEN NULL
        ELSE updated_at
    END AS valid_to,
    CASE
        WHEN next_updated_at IS NULL THEN TRUE
        ELSE FALSE
    END AS is_valid
FROM ordered