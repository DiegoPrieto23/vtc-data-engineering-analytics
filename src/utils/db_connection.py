import os
import psycopg2


def _obligatoria(nombre: str) -> str:
    """Lee una variable de entorno obligatoria y falla si no está definida.

    Evita dejar credenciales por defecto escritas en el código.
    """
    valor = os.getenv(nombre)
    if not valor:
        raise RuntimeError(
            f"Falta la variable de entorno '{nombre}'. "
            "Copia .env.example a .env y rellena los valores antes de ejecutar."
        )
    return valor


def get_connection():
    return psycopg2.connect(
        host=os.getenv("PG_HOST", "localhost"),
        port=os.getenv("PG_PORT", "5432"),
        dbname=_obligatoria("PG_DB"),
        user=_obligatoria("PG_USER"),
        password=_obligatoria("PG_PASSWORD"),
    )
