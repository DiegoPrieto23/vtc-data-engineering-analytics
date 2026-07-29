import os
import subprocess

def dbt_transform(level="staging", entity=None):
    """
    Executes dbt transformations for a specific level and entity.
    Examples:
      dbt_transform("staging", "drivers")
      dbt_transform("core", "users")
      dbt_transform("core", "trips")
    """
    if level not in ["staging", "core"]:
        raise ValueError("The 'level' parameter must be either 'staging' or 'core'.")

    if entity not in ["drivers", "users", "cars", "trips"]:
        raise ValueError("The 'entity' parameter must be one of: 'drivers', 'users', 'cars', 'trips'.")

    dbt_dir = os.path.join("dbt", "vtc_dbt")

    # Determine which model to execute according to naming convention
    if level == "staging":
        model = f"staging__{entity}"
    elif level == "core":
        if entity == "trips":
            model = "fact__trips"
        else:
            model = f"dim__{entity}"

    print(f"[DBT] Running dbt transformations ({level}) for {entity}...\n")
    subprocess.run(["dbt", "run", "--select", model], cwd=dbt_dir, check=True)
    print(f"[OK] {level.capitalize()} transformations completed for {entity}.\n")
