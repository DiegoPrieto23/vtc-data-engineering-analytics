# Cloud Architecture Design

## 💻 Current Setup (Local / Docker)
The project runs locally using Docker.
The `main.py` script executes the entire process (all the 4 models):
1. Extract and clean raw data from the dataset.zip
2. Load it into a PostgreSQL database (raw schema)
3. Run **dbt** transformations to create the following schemas (staging, core and analytics)

Both the application and database run inside Docker containers.

## ☁️ Cloud Deployment Proposal
If we were to deploy an app like this into the Cloud, this same logic could be deployed in a more automated way making use of the following resources (we will do the example using AWS):
### 1. Compute Layer
- Use AWS ECS (Elastic Container Service) or EKS (Kubernetes Service) to run the Docker containers. Note that running this app on Kubernetes services would enable a cloud-agnostic architecture, meaning that migrating from one cloud provider to another would require minimal effort.
- The system can scale automatically if the data volume grows.

### 2. Database Layer
- Replace the local PostgreSQL container with Amazon RDS for PostgreSQL.
- This ensures high availability, automatic backups, managed updates, autoscaling, security, etc.

### 3. Storage Layer
- Raw and intermediate data files (like the dataset.zip) can be stored in Amazon S3, a secure and scalable cloud storage.
- This makes the data accessible for other systems or analytics tools.

### 4. Orchestration and Scheduling
- Use Apache Airflow or similar to schedule and monitor all steps.
- Airflow will trigger the Docker containers in the right order for the ELT (extract → load → transform).

### 5. Monitoring and Logs
- Use Amazon CloudWatch to store logs, detect errors, and trigger alerts automatically.
- This improves fault tolerance and helps identify performance issues.


