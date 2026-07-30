-- =============================================================
-- MÉTRICAS DE NEGOCIO
-- =============================================================

-- Visión global del rendimiento del negocio:
-- muestra el total de viajes, los viajes válidos (con precio), los tiempos medios
-- y las métricas de ingresos agregadas.
SELECT * FROM analytics.business_overview;

-- Métricas de ingresos y rentabilidad por país.
SELECT * FROM analytics.revenue_by_country;

-- Evolución temporal de los ingresos agregados por día, mes y año.
SELECT * FROM analytics.revenue_over_time;

-- =============================================================
-- CONDUCTORES Y OPERACIONES
-- =============================================================

-- Rendimiento de los conductores: número de viajes, ingresos y duración media.
SELECT * FROM analytics.driver_performance;

-- Número medio, mínimo y máximo de cambios de conductor por viaje.
SELECT * FROM analytics.driver_changes_summary;

-- Análisis de rendimiento por tipo de vehículo: ingresos y duración media.
SELECT * FROM analytics.car_type_performance;

-- =============================================================
-- USUARIOS Y DEMANDA
-- =============================================================

-- Comportamiento de los usuarios: número de viajes, gasto total y fechas de actividad.
SELECT * FROM analytics.user_behavior;

-- Distribución de usuarios por país, con la media de viajes y de gasto por usuario.
SELECT * FROM analytics.user_distribution;

-- =============================================================
-- ANÁLISIS TEMPORAL Y ESTACIONAL
-- =============================================================

-- Volumen, precio y duración media de los viajes por hora del día.
SELECT * FROM analytics.trips_by_hour;

-- Volumen, precio y duración media de los viajes por día de la semana.
SELECT * FROM analytics.trips_by_weekday;

-- =============================================================
-- ANÁLISIS GEOGRÁFICO
-- =============================================================

-- Las 5 rutas más frecuentes por país (según las coordenadas de origen y destino).
SELECT * FROM analytics.top_routes_by_country;

-- Puntos de origen más frecuentes (hotspots) por país.
SELECT * FROM analytics.hotspots_start;

-- Puntos de destino más frecuentes (hotspots) por país.
SELECT * FROM analytics.hotspots_end;

-- =============================================================
-- ANÁLISIS ECONÓMICO
-- =============================================================

-- Distribución de precios: total de viajes, viajes válidos, viajes con precio positivo
-- y estadísticas de precio.
SELECT * FROM analytics.price_distribution;

-- =============================================================
-- CALIDAD Y DURACIÓN DE LOS VIAJES
-- =============================================================

-- Estadísticas de finalización de los viajes (reason): recuento y proporción de cada tipo.
SELECT * FROM analytics.trip_completion_stats;

-- Distribución de las duraciones de los viajes agrupadas por intervalos (<5, 5-10, 10-20, etc.).
SELECT * FROM analytics.effective_duration_distribution;

-- =============================================================
-- RESUMEN POR ENTIDAD Y ANTIGÜEDAD
-- =============================================================

-- Resumen por país: usuarios, conductores, número de viajes e ingresos.
SELECT * FROM analytics.country_summary;

-- Distribución de la antigüedad (años registrados) de usuarios, conductores y vehículos.
SELECT * FROM analytics.tenure_distribution;
