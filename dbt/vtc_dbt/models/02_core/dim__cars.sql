{{ 
    config(
        materialized='table',
        post_hook="ALTER TABLE {{ this }} ADD PRIMARY KEY (car_id, updated_at)"
    )
}}

SELECT
    car_id,
    licensed,
    disabled,
    icon,
    reg_plate,
    product_ids,
    jsonb_array_length(product_ids::jsonb) AS num_products,
    created_at,
    updated_at,
    valid_from,
    valid_to,
    is_valid
FROM {{ ref('staging__cars') }}
