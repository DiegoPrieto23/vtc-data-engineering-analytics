# 🚖 VTC Data Engineering Analytics Challenge

## 🚀 Jumping In!

This repository contains an end-to-end **Data Engineering & Analytics** solution built around a **VTC / ride-hailing** dataset (drivers, users, cars and trips).

In this repo, you'll find everything needed in order to have a job up and running, that will extract, clean and store the data, for its posterior visualization and analysis. 

The entire solution is containerized using **Docker** to ensure reproducibility and easy setup.

---
## ☁️ Cloud Architecture
The architecture explained throughout this document can be easily replicated in a cloud environment for scalability, reliability, and automation.

A dedicated document describes this in detail:
[Cloud Architecture Design](docs/README_cloud.md)

That document covers:
- Compute layer (ECS / EKS)
- Storage layer (S3, RDS)
- Orchestration (Airflow – MWAA)
- Logging and monitoring (CloudWatch)
- Scalability and fault tolerance principles

---

## Pre-Requisites

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)
- Alterntively: [Docker Desktop](https://www.docker.com/products/docker-desktop) - it comes with everything you need (Docker Engine, Docker Compose and graphic interface)
- [Python](https://www.python.org/)
- *(Optional)* [DBeaver](https://dbeaver.io/) or any other SQL client for exploring the data.

Furthermore, in order to be able to execute the cells in the Notebooks, different python libraries must be installed, for example, using [pip](https://pypi.org/project/pip/).

---

## ⚙️ Executing the Pipeline
### 1. Clone the repository
```bash
git clone https://github.com/DiegoPrieto23/vtc-data-engineering-analytics.git

cd vtc-data-engineering-analytics
```

### 2. Check Docker is installed and running
```bash
docker compose version
```

### 3. Build the Docker environment
```bash
docker compose build
```
By default, the project will spin up:
- A PostgreSQL database
- An application container that runs the ETL / ELT logic (`main.py` + dbt models)

### 4. Run the Full Pipeline (all models)
To start the database and run the full pipeline (all entities: `drivers`, `users`, `cars`, `trips`):

```bash
docker compose up
```
This will:
1. Start the PostgreSQL container
2. Create the schemas (`raw`, `staging`, `core`, `analytics`)
3. Load the raw data
4. Run all **dbt** transformations and data modeling steps
5. Once it finishes, the data will be ready to explore in the database.

```bash
# Punctual execution (lighter and faster because containers are erased when finished)
docker compose run --rm app
```

### 5. Run individual models 
Sometimes you might want to run the pipeline only for a single entity, such as `drivers`.
```bash
docker compose run --rm -e PIPELINE_TARGET=drivers app
docker compose run --rm -e PIPELINE_TARGET=users app
docker compose run --rm -e PIPELINE_TARGET=cars app
docker compose run --rm -e PIPELINE_TARGET=trips app
```

### 6. Stop everything
```bash
docker compose down

# Stop and delete data
docker compose down -v
```
---

## 🧭 Exploring and Visualizing the Data

You can connect to the PostgreSQL instance using a **database explorer** such as DBeaver, PgAdmin4, etc.

**Connection details:**

| Parameter  | Value          |
|-------------|----------------|
| Host        | `localhost`    |
| Port        | `5432`         |
| Database    | `vtc_db`    |
| User        | `vtc_user`  |
| Password    | `vtc_dwh`   |

Once connected, you can browse through the four schemas in the vtc_db database:  

`raw` >> `staging` >> `core` >> `analytics`

---

## 🧩 Data Architecture Overview

The database is divided into **four logical layers (schemas)** for clarity, maintainability, and scalability:

| Schema | Purpose | Description |
|---------|----------|-------------|
| **raw** | Ingestion | Stores unmodified source data exactly as received. |
| **staging** | Transformation | Cleans, changes columns names, deduplicates, and standardizes data before modeling. |
| **core** | Business-ready model | Contains fact and dimension tables for analytics. Implement business logic and extra stats |
| **analytics** | Aggregated insights | High-level summary tables and KPIs for reporting. |

---

## 🧱 Development Journey

This section summarizes the key development steps followed to build the project from scratch.

#### Step 0: Initial Exploratory Data Analysis
- Unzip the `dataset.zip`
- Create an initial notebook to do tests and learn about the data

#### Step 1: Raw Data Extraction
- Started from a compressed dataset (`dataset.zip`) containing four JSON files: drivers, users, cars, and trips.
- Implemented a data loader ([load_ndjson](src/utils/load_ndjson.py)) to parse and repair malformed JSON lines (notably in `trip.json`, which contained extra `}` characters).
- Converted the cleaned JSONs into CSV files for easier ingestion into PostgreSQL.

#### Step 2: Database Creation and Schema Design (from Local to Docker)
- Designed a PostgreSQL database with four main schemas: `raw`, `staging`, `core`, and `analytics`.
- Used a Python script (`db_init.py`) to create the database and initialize schemas automatically.
- Then moved from local to Docker, so the `db_init.py` was no longer needed.

#### Step 3: Data Ingestion
- Ingest the raw data into the first schema of the database (`raw`).
- Do dbt transformations to get the data into `staging` schema.
- Learned more about dbt.

#### Step 4: Core
- Create the dimensions and fact tables
- Implement new logic for fact__trips

#### Step 5: Analytics views
- Think KPIs, metrics and so on, and then convert those ideas into SQL views.
- Run, fix, and improve views

#### Step 6: Notebooks
- Create an analytics dashboard to plot all the info from the analytics views and demonstrate the value of the data
- Document and fix the initial notebook
- Fix in fact__trips since we had overlooked that the dates were in UTC, so we applied a time adjustment

#### Step 7: Documentation
- Create all the READMEs in markdown

---

## 🏗️ Data Modeling

The **core** schema is structured following a **star-schema** pattern:
<p align="center">
  <img src="src/images/VTCDiagram.drawio.png" alt="VTC Class Diagram" width="600"/>
</p>

- `fact_trips.driver_id` → `dim_drivers.driver_id`  
- `fact_trips.car_id` → `dim_cars.car_id`
- `fact_trips.user_id` → `dim_users.user_id`

### Fact Tables
Contain measurable events such as trips.

- `fact_trips`: trip_id, created_at, updated_at, start_at, week_day, start_day, start_date, start_month, start_year, start_hour, driver_id, car_id, user_id, reason, start_lat, start_lon, end_lat, end_lon, trip_duration_minutes, effective_trip_duration_minutes, waiting_time_minutes, price, exchange_rate, 
price_eur, user_country, driver_state, car_type

### Dimension Tables
Contain descriptive entities related to trips.

- `dim_drivers`: driver_id, name, state, created_at, valid_from, valid_to, is_valid
- `dim_users`: user_id, name, mobile_num, email, locale, locale_language, locale_country, created_at, valid_from, valid_to, is_valid 
- `dim_cars`: car_id, licensed, disabled, icon, reg_plate, product_ids, num_products, created_at, valid_from, valid_to, is_valid


This design simplifies analytical queries and supports efficient aggregation.

---

## 🧠 Data Modeling Decisions

This section summarizes the most important decisions made while preparing and modeling the data.

### 1. Handling Data Quality Issues in `trip.json`
When loading `trip.json`, several rows caused parsing errors.
After investigating the source, we found that:
- A small number of lines were malformed (for example, containing an extra `}`), which broke the standard JSON parsing.
- To solve this, we implemented a custom loader, `load_ndjson`, with a `repair_line` function that:
  - Detects malformed lines
  - Fixes or cleans the extra characters
  - Allows us to ingest all valid records without losing the rest of the file
This step ensures that bad lines do not stop the entire ingestion process.

### 2. Reserved Word Conflict: user → user_id
The trips data contains a column named `user`.
Since USER (or similar) can be a reserved word in some SQL dialects, this can cause problems when creating tables or writing queries.

To avoid this, we renamed the column to:
- user → user_id

This keeps the meaning clear and guarantees that SQL statements remain valid and easy to read.

### 3. Dimension Tables with Historical Records (SCD Type 2)

The dimension tables (`cars`, `drivers`, `users`) contain multiple rows for the same ID over time.
Instead of forcing a single “latest” record, we decided to preserve the full history:

- We treat these dimensions as Slowly Changing Dimensions Type 2 (SCD Type 2).
- For each row, we add validity columns, such as:
  - `valid_from` – when this version became active
  - `valid_to` – when this version stopped being active (or NULL if it is the current one)
  - `is_current` – flag to mark the active version

This allows us to:
- Answer questions “as of” a specific date (e.g. “who was the driver at that time?”)
- Keep a full historical view of changes in drivers, users, and cars.

### 4. Reducing Noise in trips (logic in Staging schema)

The raw `trips` dataset contains multiple rows per `trip_id`, reflecting sequential status updates (assignment, progress, cancellation, etc.).  
To make the data usable for analysis, we need to retain only the **key rows** that capture meaningful state transitions.

For each `trip_id`, ordered by `updated_at ASC`, we keep:

#### ✅ Always keep:
- The **first row** of the trip (`is_first_row = TRUE`)

#### 🔄 Driver or car change events:
- The **first row** whenever either `driver_id` or `car_id` changes (`is_change_event = TRUE`)

#### 🏁 Trip closure and cancellation logic:
- If there are rows where `TRIM(reason)` is not empty:
  - Keep **only the first** of those rows **where `price` is not NULL or NaN**
- If all those rows have `price` NULL or NaN:
  - Keep the **first** row where `reason` is not empty (even if price is missing)
- If no row has a non-empty `reason`, no additional row is added beyond the above conditions.

This logic ensures that:
- Each trip keeps only one starting row, relevant driver/car change rows, and a final closure row (if applicable).
- Redundant updates and noise are eliminated, drastically reducing the number of rows while keeping all business-relevant events.

#### Filtering on coordinate pairs
- From exploratory analysis, we found that about 99.78% of trips have exactly two coordinate pairs (start and end).
- To keep the model consistent and avoid strange or incomplete records:
  - We keep only trips with exactly two pairs of coordinates in the core fact table.
  - Trips that do not meet this rule are still stored in the raw layer but are excluded from the final fact_trips.
This logic helps us reduce the number of rows while preserving the key information needed for business analysis.

### 5. Timezone Adjustment and Currency Conversion in fact_trips

All original timestamps in staging__trips are in UTC.
For business analysis, it is often more useful to work in the local time of the user.

In the fact_trips model we:
#### 1. Apply timezone adjustment per user country
- We use the user_country to shift the UTC timestamps to the local time zone.
- This is applied to key time fields such as trip start and end.
- As a result, the reported hours align better with local business hours and real-world usage.

#### 2. Convert prices to a common currency
- Trip prices can come in different currencies.
- We convert all amounts to a single reference currency (e.g. EUR) based on an exchange rate mapping.
- This makes it easier to compare trips across different markets.

#### 3. Calculate effective trip time and waiting time
From the event history of each trip, we compute:
- Total trip duration (minutes):
  - Difference between the first event (first_created_at) and the last event (last_updated_at).

- Effective trip time (minutes)
  - Difference between the last and the penultimate event timestamps.
  - This approximates the time the user was actually in the car or the main “active” segment of the trip.

- Waiting time (minutes)
  - waiting_time = total_duration - effective_trip_time
  - Represents the time spent waiting (e.g. searching for a driver, driver on its way, or intermediate states).

### 6. Derived Columns (New Features Extracted in Core schema)

During the data cleaning and transformation process, we generated several new columns from the base raw fields to enhance analytical capabilities. These derived columns enrich the fact and dimension models with temporal, geographic, and business logic context.

#### In `fact_trips`:
- **week_day** – Day of the week as an integer (Monday = 1, Sunday = 7)
- **start_day** – Day of the month (1–31)
- **start_month** – Month number (1–12)
- **start_year** – Year extracted from the trip start timestamp
- **start_hour** – Hour of day (0–23)
- **start_date** – Calendar date (YYYY-MM-DD)
- **price_eur** – Price converted to EUR using the applicable exchange rate
- **exchange_rate** – Mapping rate applied to normalize trip currencies
- **trip_duration_minutes**, **effective_trip_duration_minutes**, **waiting_time_minutes** – Durations derived from timestamp deltas

These enrichments allow for time-series analytics, weekday trends, and cross-country revenue comparison in a unified currency.

---

## 📊 Initial and Analytics Notebook

To explore the data and computed statistics, you can use the notebooks in the `notebooks/` folder. For example:
- 🔍 [notebooks/01_exploratory_data_analysis.ipynb](notebooks/01_exploratory_data_analysis.ipynb) – Initial exploratory analysis of the raw and staging data.
- 📊 [notebooks/02_analytics_dashboard.ipynb](notebooks/02_analytics_dashboard.ipynb) – Visual KPIs and charts based on the core and analytics layers like this:
<p align="center">
  <img src="notebooks/images/revenue_trip_volume_over_time.png" alt="Trip and Volume over Time" width="600"/>
</p>

<p align="center">
  <img src="notebooks/images/trip_volume_per_hour.png" alt="Trip and Volume per Hour" width="600"/>
</p>


Also, you can see some of the outputs generated in the [notebooks/02_analytics_dashboard.ipynb](notebooks/02_analytics_dashboard.ipynb) in this [route link](notebooks/outputs/). To be able to see the HTML correctly, you will need to download and open them in a browser to see something like this:
<p align="center">
  <img src="notebooks/images/top_routes.png" alt="Top Routes per Country" width="600"/>
</p>

<p align="center">
  <img src="notebooks/images/hotspots.png" alt="Hotspots" width="600"/>
</p>

---

## 📂 SQL Scripts

In the `/sql` folder, you will find a [SQL script](sql/analytics_script.sql) defining the analytics views.
The file includes:
- The SQL code to create or refresh the view
- A description of the metrics and purpose (e.g. “Average Trip Duration by City”, “Revenue per Driver”, etc.)
These scripts can be executed directly in PostgreSQL or included in dbt as additional models.

---

## 🔁 Scheduling and Scalability

Each data model is designed to be executed **independently and safely N times per day**.

Currently, the project does not include automated scheduling (e.g. Airflow or cron).
However, it can be re-executed manually at any time using the Docker commands described earlier:
```bash
# Individual model
docker compose run --rm -e PIPELINE_TARGET=trips app

# Full pipeline
docker compose run --rm app
```
This modularity ensures that:
- Each re-run updates data correctly without creating duplicates (thanks to insert/update logic).
- The pipeline can easily be integrated later into Airflow DAGs or cron jobs to run periodically.
- As the number of data models grows, the system remains horizontally scalable.

---

## 🧠 Design Principles & Best Practices

- **Separation of concerns** — Each layer has a distinct responsibility (raw → staging → core → analytics).  
- **Idempotency** — Re-running ETL jobs does not create duplicates.  
- **Modularity** — Transformations are built as reusable, composable functions.  
- **Reproducibility** — The full environment is Dockerized for consistency.  
- **Documentation-first** — Each schema, table, and transformation is explained.  

---

## ✅ Future Improvements

- Add **CI/CD pipelines** for automated testing and deployment.   
- Extend the **analytics layer** with additional KPIs and dashboards.  

---

## 🧾 Summary

This project demonstrates an end-to-end, production-oriented data solution:
- Automated extraction, cleaning, and modeling
- Layered database architecture ready for analytics
- Fully containerized for portability
- Scalable design with cloud readiness

Even though the dataset is small, the structure follows real-world principles used in data engineering teams at scale.

