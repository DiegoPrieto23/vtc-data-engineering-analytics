import os
import subprocess

def dbt_transform(level="staging", entity=None):
    """
    Ejecuta las transformaciones de dbt para un nivel y una entidad concretos.
    Ejemplos:
      dbt_transform("staging", "drivers")
      dbt_transform("core", "users")
      dbt_transform("core", "trips")
    """
    if level not in ["staging", "core"]:
        raise ValueError("El parámetro 'level' debe ser 'staging' o 'core'.")

    if entity not in ["drivers", "users", "cars", "trips"]:
        raise ValueError("El parámetro 'entity' debe ser uno de: 'drivers', 'users', 'cars', 'trips'.")

    dbt_dir = os.path.join("dbt", "vtc_dbt")

    # Determinar qué modelo ejecutar según la convención de nombres
    if level == "staging":
        model = f"staging__{entity}"
    elif level == "core":
        if entity == "trips":
            model = "fact__trips"
        else:
            model = f"dim__{entity}"

    print(f"[DBT] Ejecutando las transformaciones de dbt ({level}) para {entity}...\n")
    subprocess.run(["dbt", "run", "--select", model], cwd=dbt_dir, check=True)
    print(f"[OK] Transformaciones de {level} completadas para {entity}.\n")
