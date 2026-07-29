{{ 
    config(
        materialized='table',
        post_hook="ALTER TABLE {{ this }} ADD PRIMARY KEY (user_id, updated_at)"
    )
}}

SELECT
    user_id,
    name,
    mobile_num,
    email,
    locale,
    split_part(locale, '-', 1) AS locale_language,
    split_part(locale, '-', 2) AS locale_country,
    created_at,
    updated_at,
    valid_from,
    valid_to,
    is_valid
FROM {{ ref('staging__users') }}
