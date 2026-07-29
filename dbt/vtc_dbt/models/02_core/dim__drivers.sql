{{ 
    config(
        materialized='table',
        post_hook="ALTER TABLE {{ this }} ADD PRIMARY KEY (driver_id, updated_at)"
    )
}}

SELECT
    driver_id,
    name,
    state,
    created_at,
    updated_at,
    valid_from,
    valid_to,
    is_valid
FROM {{ ref('staging__drivers') }}
