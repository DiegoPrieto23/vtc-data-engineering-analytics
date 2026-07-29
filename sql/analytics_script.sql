-- =============================================================
-- BUSINESS METRICS
-- =============================================================

-- Global business performance overview:
-- Shows total trips, valid trips (with price), average times and aggregated revenue metrics.
SELECT * FROM analytics.business_overview;

-- Revenue and profitability metrics by country.
SELECT * FROM analytics.revenue_by_country;

-- Temporal evolution of revenue aggregated by day, month, and year.
SELECT * FROM analytics.revenue_over_time;

-- =============================================================
-- DRIVERS AND OPERATIONS
-- =============================================================

-- Driver performance: number of trips, revenue, and average duration.
SELECT * FROM analytics.driver_performance;

-- Average, minimum, and maximum number of driver changes per trip.
SELECT * FROM analytics.driver_changes_summary;

-- Performance analysis by car type: revenue and average duration.
SELECT * FROM analytics.car_type_performance;

-- =============================================================
-- USERS AND DEMAND
-- =============================================================

-- User behavior: number of trips, total spending, and activity dates.
SELECT * FROM analytics.user_behavior;

-- User distribution by country, showing average trips and spending per user.
SELECT * FROM analytics.user_distribution;

-- =============================================================
-- TEMPORAL AND SEASONAL ANALYSIS
-- =============================================================

-- Volume, price, and average trip duration by hour of the day.
SELECT * FROM analytics.trips_by_hour;

-- Volume, price, and average trip duration by day of the week.
SELECT * FROM analytics.trips_by_weekday;

-- =============================================================
-- GEOGRAPHIC ANALYSIS
-- =============================================================

-- Top 5 most frequent routes by country (based on origin and destination coordinates).
SELECT * FROM analytics.top_routes_by_country;

-- Most frequent starting points (hotspots) by country.
SELECT * FROM analytics.hotspots_start;

-- Most frequent destination points (hotspots) by country.
SELECT * FROM analytics.hotspots_end;

-- =============================================================
-- ECONOMIC ANALYSIS
-- =============================================================

-- Price distribution: total trips, valid trips, positive-price trips, and price statistics.
SELECT * FROM analytics.price_distribution;

-- =============================================================
-- TRIP QUALITY AND DURATION
-- =============================================================

-- Trip completion statistics (reason): count and proportion of each type.
SELECT * FROM analytics.trip_completion_stats;

-- Distribution of trip durations grouped by intervals (<5, 5–10, 10–20, etc.).
SELECT * FROM analytics.effective_duration_distribution;

-- =============================================================
-- ENTITY SUMMARY AND TENURE
-- =============================================================

-- Country summary: users, drivers, number of trips, and revenue.
SELECT * FROM analytics.country_summary;

-- Tenure distribution (years registered) of users, drivers, and cars.
SELECT * FROM analytics.tenure_distribution;
