# 🏗️ Arquitectura y decisiones de diseño

Este documento recoge **cómo está construida** la solución y **por qué** se tomó cada
decisión.

- ← [README principal](../README.md) — qué es el proyecto y cómo clonarlo y ejecutarlo.
- → [Diseño de la arquitectura en cloud](README_cloud.md) — cómo se replicaría en AWS.
- 📈 [Ver el informe interactivo](https://diegoprieto23.github.io/vtc-data-engineering-analytics/report/)

---

## 📑 Índice

- [Visión general de la arquitectura de datos](#-visión-general-de-la-arquitectura-de-datos)
- [Modelado de datos](#️-modelado-de-datos)
- [Decisiones de modelado](#-decisiones-de-modelado)
- [Cómo está construido el informe interactivo](#-cómo-está-construido-el-informe-interactivo)
- [Recorrido del desarrollo](#-recorrido-del-desarrollo)
- [Scripts SQL](#-scripts-sql)
- [Planificación y escalabilidad](#-planificación-y-escalabilidad)
- [Principios de diseño y buenas prácticas](#-principios-de-diseño-y-buenas-prácticas)
- [Mejoras futuras](#-mejoras-futuras)

---

## 🧩 Visión general de la arquitectura de datos

La base de datos se divide en **cuatro capas lógicas (esquemas)** por claridad, mantenibilidad y escalabilidad:

| Esquema | Propósito | Descripción |
|---------|----------|-------------|
| **raw** | Ingesta | Almacena los datos de origen sin modificar, tal cual se reciben. |
| **staging** | Transformación | Limpia, renombra columnas, deduplica y estandariza los datos antes del modelado. |
| **core** | Modelo listo para negocio | Contiene las tablas de hechos y dimensiones para analítica. Implementa la lógica de negocio y estadísticas adicionales. |
| **analytics** | Insights agregados | Tablas resumen de alto nivel y KPIs para reporting. |

---

## 🏗️ Modelado de datos

El esquema **core** está estructurado siguiendo un patrón de **esquema en estrella** (*star schema*):
<p align="center">
  <img src="../src/images/VTCDiagram.drawio.png" alt="Diagrama de clases VTC" width="600"/>
</p>

- `fact_trips.driver_id` → `dim_drivers.driver_id`
- `fact_trips.car_id` → `dim_cars.car_id`
- `fact_trips.user_id` → `dim_users.user_id`

### Tablas de hechos
Contienen eventos medibles, como los viajes.

- `fact_trips`: trip_id, created_at, updated_at, start_at, week_day, start_day, start_date, start_month, start_year, start_hour, driver_id, car_id, user_id, reason, start_lat, start_lon, end_lat, end_lon, trip_duration_minutes, effective_trip_duration_minutes, waiting_time_minutes, price, currency, price_minor_units, exchange_rate,
price_eur, user_country, driver_state, car_type

### Tablas de dimensiones
Contienen las entidades descriptivas relacionadas con los viajes.

- `dim_drivers`: driver_id, name, state, created_at, valid_from, valid_to, is_valid
- `dim_users`: user_id, name, mobile_num, email, locale, locale_language, locale_country, created_at, valid_from, valid_to, is_valid
- `dim_cars`: car_id, licensed, disabled, icon, reg_plate, product_ids, num_products, created_at, valid_from, valid_to, is_valid


Este diseño simplifica las consultas analíticas y permite agregaciones eficientes.

---

## 🧠 Decisiones de modelado

Esta sección resume las decisiones más relevantes tomadas al preparar y modelar los datos.

### 1. Tratamiento de los problemas de calidad en `trip.json`
Al cargar `trip.json`, varias filas provocaban errores de parseo.
Tras investigar el origen, se comprobó que:
- Un pequeño número de líneas estaba mal formado (por ejemplo, con una `}` de más), lo que rompía el parseo estándar de JSON.
- Para resolverlo se implementó un cargador propio, `load_ndjson`, con una función `repair_line` que:
  - Detecta las líneas mal formadas
  - Corrige o limpia los caracteres sobrantes
  - Permite ingestar todos los registros válidos sin perder el resto del fichero

Así se garantiza que unas pocas líneas defectuosas no detengan todo el proceso de ingesta.

### 2. Conflicto con una palabra reservada: user → user_id
Los datos de viajes contienen una columna llamada `user`.
Como `USER` (o similares) puede ser una palabra reservada en algunos dialectos de SQL, esto puede dar problemas al crear tablas o escribir consultas.

Para evitarlo, la columna se ha renombrado:
- user → user_id

Así se mantiene claro el significado y se garantiza que las sentencias SQL sigan siendo válidas y legibles.

### 3. Dimensiones con histórico (SCD tipo 2)

Las tablas de dimensiones (`cars`, `drivers`, `users`) contienen varias filas para un mismo ID a lo largo del tiempo.
En lugar de forzar un único registro «el más reciente», se ha decidido conservar el histórico completo:

- Tratamos estas dimensiones como *Slowly Changing Dimensions* de tipo 2 (SCD tipo 2).
- Para cada fila se añaden columnas de validez, como:
  - `valid_from` – cuándo pasó a estar activa esta versión
  - `valid_to` – cuándo dejó de estarlo (o NULL si es la vigente)
  - `is_current` – marca que identifica la versión activa

Esto nos permite:
- Responder preguntas «a fecha de» un momento concreto (p. ej. «¿quién era el conductor en ese momento?»)
- Mantener una visión histórica completa de los cambios en conductores, usuarios y vehículos.

### 4. Reducción de ruido en trips (lógica en el esquema staging)

El dataset de `trips` en bruto contiene varias filas por `trip_id`, que reflejan actualizaciones sucesivas de estado (asignación, progreso, cancelación, etc.).
Para que los datos sean utilizables en análisis, hay que quedarse solo con las **filas clave** que capturan transiciones de estado con significado.

Para cada `trip_id`, ordenado por `updated_at ASC`, conservamos:

#### ✅ Siempre:
- La **primera fila** del viaje (`is_first_row = TRUE`)

#### 🔄 Eventos de cambio de conductor o vehículo:
- La **primera fila** cada vez que cambia `driver_id` o `car_id` (`is_change_event = TRUE`)

#### 🏁 Lógica de cierre y cancelación del viaje:
- Si hay filas en las que `TRIM(reason)` no está vacío:
  - Conservar **solo la primera** de esas filas **en la que `price` no sea NULL ni NaN**
- Si todas esas filas tienen `price` NULL o NaN:
  - Conservar la **primera** fila con `reason` no vacío (aunque falte el precio)
- Si ninguna fila tiene `reason` no vacío, no se añade ninguna fila adicional más allá de las condiciones anteriores.

Esta lógica garantiza que:
- Cada viaje conserve una única fila de inicio, las filas relevantes de cambio de conductor/vehículo y una fila final de cierre (si procede).
- Se eliminen las actualizaciones redundantes y el ruido, reduciendo drásticamente el número de filas sin perder ningún evento relevante para negocio.

#### Filtrado por pares de coordenadas
- Del análisis exploratorio se desprende que en torno al 99,78 % de los viajes tienen exactamente dos pares de coordenadas (inicio y fin).
- Para mantener el modelo consistente y evitar registros extraños o incompletos:
  - Conservamos únicamente los viajes con exactamente dos pares de coordenadas en la tabla de hechos de `core`.
  - Los viajes que no cumplen esta regla siguen almacenados en la capa `raw`, pero quedan excluidos de `fact_trips`.

Esta lógica ayuda a reducir el número de filas preservando la información clave necesaria para el análisis de negocio.

### 5. Ajuste horario y conversión de divisa en fact_trips

Todas las marcas de tiempo originales de `staging__trips` están en UTC.
Para el análisis de negocio suele ser más útil trabajar en la hora local del usuario.

En el modelo `fact_trips`:
#### 1. Aplicamos el ajuste horario según el país del usuario
- Usamos `user_country` para desplazar las marcas de tiempo UTC a la zona horaria local.
- Se aplica a los campos temporales clave, como el inicio y el fin del viaje.
- Como resultado, las horas reportadas encajan mucho mejor con el horario comercial local y el uso real.

#### 2. Convertimos los precios a una divisa común
- Los precios de los viajes pueden venir en distintas divisas.
- Convertimos todos los importes a una divisa de referencia única (EUR) según una tabla de tipos de cambio.
- Esto facilita comparar viajes entre mercados distintos.

> ⚠️ **La unidad importa tanto como el tipo de cambio.**
> El importe no llega en la misma unidad en todos los mercados. España, Perú, Ecuador, Argentina y
> México lo registran en la **unidad menor** de su divisa (céntimos, centavos), pero **Colombia y Chile
> lo registran en pesos enteros**, porque su unidad menor no se usa en la práctica.
>
> Por eso el CTE `fx_rates` de `fact__trips` lleva **dos** columnas por país —`minor_units` (divisor) y
> `rate_to_eur` (tipo de cambio)— en lugar de una sola constante. Con un `/100` uniforme, los ingresos
> de Colombia y Chile quedaban divididos por cien: tickets medios de 0,03 € y 0,05 €, cifras imposibles
> que el modelo daba por buenas.
>
> **Comprobación de sanidad:** tras la corrección, la mediana del ticket queda entre 2 € y 10 € en los
> siete mercados, que es el rango esperable de un trayecto urbano. El notebook
> [01_exploratory_data_analysis.ipynb](../notebooks/01_exploratory_data_analysis.ipynb) contrasta ambas
> hipótesis explícitamente.

#### 3. Calculamos el tiempo efectivo de viaje y el tiempo de espera
A partir del histórico de eventos de cada viaje calculamos:
- Duración total del viaje (minutos):
  - Diferencia entre el primer evento (`first_created_at`) y el último (`last_updated_at`).

- Tiempo efectivo de viaje (minutos)
  - Diferencia entre la marca de tiempo del último evento y la del penúltimo.
  - Aproxima el tiempo que el usuario estuvo realmente en el vehículo, o el tramo «activo» principal del viaje.

- Tiempo de espera (minutos)
  - `waiting_time = duración_total - tiempo_efectivo`
  - Representa el tiempo de espera (buscando conductor, conductor en camino, estados intermedios, etc.).

### 6. Columnas derivadas (nuevas variables extraídas en el esquema core)

Durante el proceso de limpieza y transformación se han generado varias columnas nuevas a partir de los campos originales para ampliar la capacidad analítica. Estas columnas derivadas enriquecen los modelos de hechos y dimensiones con contexto temporal, geográfico y de negocio.

#### En `fact_trips`:
Temporales (todas ya en hora local del usuario, no en UTC):

- **start_day** – Fecha de calendario del viaje (AAAA-MM-DD)
- **start_date** – Día del mes (1–31)
- **start_month** – Número de mes (1–12)
- **start_year** – Año extraído de la marca de tiempo de inicio del viaje
- **week_day** – Día de la semana como entero (lunes = 1, domingo = 7)
- **start_hour** – Hora del día (0–23)

De importe:

- **currency** – Código ISO de la divisa local del mercado (`EUR`, `COP`, `PEN`…)
- **price_minor_units** – Divisor para pasar del importe almacenado a la unidad principal de la divisa: `100` en casi todos los mercados, `1` en Colombia y Chile
- **exchange_rate** – Euros por 1 unidad principal de la divisa
- **price_eur** – `price / price_minor_units * exchange_rate`

De duración:

- **trip_duration_minutes**, **effective_trip_duration_minutes**, **waiting_time_minutes** – Duraciones derivadas de las diferencias entre marcas de tiempo

Estos enriquecimientos permiten hacer analítica de series temporales, detectar tendencias por día de la semana y comparar ingresos entre países en una divisa unificada.

---

## 📈 Cómo está construido el informe interactivo

El dashboard de `report/` **no consulta la base de datos en vivo**: lee un extracto
JSON generado por [`scripts/export_report_data.py`](../scripts/export_report_data.py).
Esa decisión es la que permite publicarlo como sitio estático en GitHub Pages sin
servidor ni base de datos detrás.

### Estructura

```
report/
├── index.html              # las 9 páginas, en un único documento
├── assets/
│   ├── app.js              # estado, filtros, agregación y render
│   ├── styles.css          # tokens de color, tema claro/oscuro, layout
│   └── vendor/             # Plotly (bundle cartesian) y Leaflet, servidos en local
└── data/
    ├── trips.json          # 1 fila por viaje (1.863 filas, ~770 KB)
    └── meta.json           # agregados de calidad del dato y metadatos del pipeline
```

### Por qué un extracto a nivel de viaje y no agregados precalculados

`trips.json` contiene **una fila por viaje**, no tablas ya agregadas. Todo el cálculo
—KPIs, series temporales, heatmaps, rutas, curvas de Lorenz— ocurre en el navegador.

Eso es lo que hace posible el **filtrado cruzado**: los cinco filtros de la barra
superior (país, ciudad, desenlace, tipo de vehículo, rango de fechas) se propagan a
las nueve páginas a la vez, igual que el *cross-filtering* de Power BI. Con agregados
precalculados habría que exportar una tabla por combinación de filtros, lo que es
inviable. Con 1.863 filas el coste de recalcular en cliente es despreciable.

`meta.json` sí lleva agregados: son las métricas de calidad del dato y volumetría del
pipeline, que describen el **origen** y por tanto no dependen de los filtros.

### Enriquecimientos que añade el exportador

| Campo | Cómo se calcula |
|-------|-----------------|
| `city` / `city_end` | Área metropolitana más cercana al punto de recogida/dejada, dentro de un radio por ciudad. Permite agrupar por ciudad sin geocodificación externa. |
| `km` | Distancia haversine entre origen y destino. Es geodésica, no por carretera: sirve para comparar mercados, no como medida absoluta. |
| `nd` / `nc` | Conductores y vehículos distintos implicados en el viaje, **excluyendo el placeholder** `1B2M2Y8AsgTpgAmY7PhCfg==`. |

### Decisiones de visualización

- **Nunca dos ejes Y.** Cuando hay que comparar dos medidas de escala distinta
  (viajes e ingresos), o se separan en dos gráficos o se indexan ambas a su propio
  total. Un eje doble permite sugerir cualquier correlación eligiendo las escalas.
- **Paleta validada.** Los ocho colores de serie se comprobaron con un validador de
  contraste y separación para daltonismo (protanopía, deuteranopía, tritanopía) en
  tema claro y oscuro. En gráficos donde todas las series se comparan entre sí
  (dispersión, burbujas) el número de series se limita a tres, que es lo que la
  paleta garantiza distinguible; el resto se agrupa en «Otros».
- **La forma refuerza al color.** En el mapa, las recogidas son discos y las dejadas
  anillos, porque a menudo caen sobre el mismo punto.
- **Interpolación lineal, nunca spline.** Suavizar una serie con pocos puntos inventa
  valores intermedios que no existen.
- **Narrativa honesta.** Los textos se generan a partir de los datos filtrados y
  declaran cuándo una relación es indicativa y no concluyente (por ejemplo, el efecto
  de las reasignaciones de conductor, que descansa sobre 113 viajes).

### Accesibilidad y portabilidad

- Tema claro y oscuro, con las paletas escogidas para cada superficie (no es una
  inversión automática).
- Todas las tablas de datos duplican la información de los gráficos.
- Plotly y Leaflet se sirven desde `assets/vendor/`, sin CDN. Lo único que sale a
  internet son los *tiles* del mapa.

---

## 🧱 Recorrido del desarrollo

Esta sección resume los pasos clave que se han seguido para construir el proyecto desde cero.

#### Paso 0: Análisis exploratorio inicial
- Descomprimir el `dataset.zip`
- Crear un primer notebook para hacer pruebas y conocer los datos

#### Paso 1: Extracción de los datos en bruto
- Se parte de un dataset comprimido (`dataset.zip`) con cuatro ficheros JSON: conductores, usuarios, vehículos y viajes.
- Se implementa un cargador de datos ([load_ndjson](../src/utils/load_ndjson.py)) que parsea y repara las líneas JSON mal formadas (sobre todo en `trip.json`, que contenía caracteres `}` de más).
- Se convierten los JSON ya limpios a ficheros CSV para facilitar la ingesta en PostgreSQL.

#### Paso 2: Creación de la base de datos y diseño de esquemas (de local a Docker)
- Se diseña una base de datos PostgreSQL con cuatro esquemas principales: `raw`, `staging`, `core` y `analytics`.
- Se usa un script de Python (`db_init.py`) para crear la base de datos e inicializar los esquemas automáticamente.
- Después se pasa de local a Docker, con lo que `db_init.py` deja de ser necesario.

#### Paso 3: Ingesta de datos
- Ingestar los datos en bruto en el primer esquema de la base de datos (`raw`).
- Hacer las transformaciones de dbt para llevar los datos al esquema `staging`.
- Profundizar en el uso de dbt.

#### Paso 4: Core
- Crear las tablas de dimensiones y de hechos
- Implementar nueva lógica para `fact__trips`

#### Paso 5: Vistas de analytics
- Pensar KPIs, métricas y demás, y convertir esas ideas en vistas SQL.
- Ejecutar, corregir y mejorar las vistas

#### Paso 6: Notebooks
- Crear un dashboard analítico que represente toda la información de las vistas de analytics y demuestre el valor de los datos
- Documentar y corregir el notebook inicial
- Corregir `fact__trips`, ya que se nos había pasado que las fechas venían en UTC, así que se aplica un ajuste horario

#### Paso 7: Documentación
- Crear todos los README en markdown

#### Paso 8: Informe interactivo
- Diseñar un dashboard HTML que sustituya a las salidas estáticas de los notebooks y sirva como herramienta de exploración: nueve páginas agrupadas por tipo de información, con filtros globales que se propagan a todas ellas.
- Escribir [`scripts/export_report_data.py`](../scripts/export_report_data.py) para generar el extracto JSON desde PostgreSQL.
- Publicarlo en GitHub Pages como sitio estático.

#### Paso 9: Revisión cruzada del modelo
Al contrastar las cifras del informe contra la realidad del negocio aparecieron tres errores que llevaban tiempo pasando desapercibidos:

- **Los ingresos de Colombia y Chile estaban divididos por 100.** `fact__trips` aplicaba `/100` a los siete mercados por igual, dando por hecho que todos registran el precio en la unidad menor de su divisa. El ticket medio de Bogotá salía a 0,03 €. Corregido con el CTE `fx_rates` (ver [decisión 5](#5-ajuste-horario-y-conversión-de-divisa-en-fact_trips)).
- **`analytics.country_summary` contaba siempre 0 conductores por país**, porque unía `dim__drivers.state` contra el país del viaje, y `state` es un identificador hasheado, no un código de país.
- **Bug en el notebook exploratorio**: la consulta del boxplot de precios particionaba por `driver` en vez de por `id`, devolviendo una fila por conductor en lugar de una por viaje.

La lección que deja el paso 9 es metodológica: **una cifra solo está validada cuando se ha contrastado contra un valor plausible del mundo real.** El `/100` no producía ningún error de SQL ni rompía ningún test; simplemente devolvía un número que nadie había comparado con lo que cuesta un trayecto urbano.

---

## 📂 Scripts SQL

En la carpeta `/sql` encontrarás un [script SQL](../sql/analytics_script.sql) que define las vistas de analytics.
El fichero incluye:
- El código SQL para crear o refrescar la vista
- Una descripción de las métricas y su propósito (p. ej. «duración media de viaje por ciudad», «ingresos por conductor», etc.)

Estos scripts pueden ejecutarse directamente en PostgreSQL o incorporarse a dbt como modelos adicionales.

---

## 🔁 Planificación y escalabilidad

Cada modelo de datos está diseñado para poder ejecutarse **de forma independiente y segura N veces al día**.

Ahora mismo el proyecto no incluye planificación automática (Airflow, cron, etc.).
Aun así, puede reejecutarse manualmente en cualquier momento con los comandos de Docker descritos más arriba:
```bash
# Modelo individual
docker compose run --rm -e PIPELINE_TARGET=trips app

# Pipeline completo
docker compose run --rm app
```
Esta modularidad garantiza que:
- Cada reejecución actualice los datos correctamente sin generar duplicados (gracias a la lógica de insert/update).
- El pipeline pueda integrarse más adelante en DAGs de Airflow o en tareas cron para ejecutarse periódicamente.
- El sistema siga siendo escalable horizontalmente a medida que crezca el número de modelos.

---

## 🧠 Principios de diseño y buenas prácticas

- **Separación de responsabilidades** — Cada capa tiene un cometido propio (raw → staging → core → analytics).
- **Idempotencia** — Reejecutar los procesos de ETL no genera duplicados.
- **Modularidad** — Las transformaciones se construyen como funciones reutilizables y componibles.
- **Reproducibilidad** — Todo el entorno está dockerizado para garantizar consistencia.
- **Gestión de secretos** — Las credenciales se leen de variables de entorno; no hay valores por defecto ni contraseñas en el código.
- **Documentación desde el principio** — Cada esquema, tabla y transformación está explicado.

---

## ✅ Mejoras futuras

- Añadir **pipelines de CI/CD** para automatizar tests y despliegue.
- Ampliar la **capa de analytics** con KPIs adicionales.
- **Tipos de cambio históricos** en lugar de una tabla estática, para que la conversión a EUR use el tipo del día de cada viaje.
- **Tests de negocio en dbt** que detecten cifras implausibles (por ejemplo, un ticket medio fuera del rango 1–100 €) además de los tests de unicidad y nulos que ya hay.
- **Automatizar la exportación del informe** en el propio pipeline, para que `report/data/` se regenere en cada ejecución.

---
