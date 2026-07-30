# Diseño de la arquitectura en cloud

## 💻 Montaje actual (local / Docker)
El proyecto se ejecuta en local mediante Docker.
El script `main.py` ejecuta el proceso completo (los 4 modelos):
1. Extraer y limpiar los datos en bruto de `dataset.zip`
2. Cargarlos en una base de datos PostgreSQL (esquema `raw`)
3. Ejecutar las transformaciones de **dbt** para crear el resto de esquemas (`staging`, `core` y `analytics`)

Tanto la aplicación como la base de datos se ejecutan dentro de contenedores Docker.

## ☁️ Propuesta de despliegue en cloud
Si quisiéramos desplegar una aplicación como esta en la nube, esta misma lógica podría implantarse de forma mucho más automatizada usando los siguientes recursos (el ejemplo está planteado sobre AWS):

### 1. Capa de cómputo
- Usar AWS ECS (Elastic Container Service) o EKS (servicio de Kubernetes) para ejecutar los contenedores Docker. Conviene señalar que ejecutar esta aplicación sobre Kubernetes permitiría una arquitectura *cloud-agnostic*, de modo que migrar de un proveedor a otro requeriría un esfuerzo mínimo.
- El sistema puede escalar automáticamente si crece el volumen de datos.

### 2. Capa de base de datos
- Sustituir el contenedor local de PostgreSQL por Amazon RDS para PostgreSQL.
- Esto aporta alta disponibilidad, copias de seguridad automáticas, actualizaciones gestionadas, autoescalado, seguridad, etc.

### 3. Capa de almacenamiento
- Los ficheros de datos en bruto e intermedios (como `dataset.zip`) pueden almacenarse en Amazon S3, un almacenamiento en la nube seguro y escalable.
- Así los datos quedan accesibles para otros sistemas o herramientas de analítica.

### 4. Orquestación y planificación
- Usar Apache Airflow o similar para planificar y monitorizar todos los pasos.
- Airflow lanzaría los contenedores Docker en el orden correcto del ELT (extracción → carga → transformación).

### 5. Monitorización y logs
- Usar Amazon CloudWatch para almacenar los logs, detectar errores y disparar alertas automáticamente.
- Esto mejora la tolerancia a fallos y ayuda a identificar problemas de rendimiento.

### 6. Gestión de secretos
- Las credenciales de la base de datos no deben viajar en el repositorio ni en las definiciones de los contenedores.
- Usar AWS Secrets Manager (o SSM Parameter Store) e inyectarlas en tiempo de ejecución mediante la definición de tarea de ECS o los secretos de Kubernetes, con rotación automática activada.
