import json
import re
import pandas as pd
import os

def repair_line(line: str) -> str:
    """
    Intenta reparar los errores habituales del campo 'stops' de trip.json.
    Devuelve la línea posiblemente corregida (sin garantizar que sea JSON válido).
    """

    fixed = line

    # Caso concreto detectado: ...]}}]}  →  ...]}]} cierra mal 'stops': sobra una '}'
    fixed = fixed.replace("]}}]}", "]}]}")

    return fixed


def load_ndjson(file_path: str, save_invalid: bool = True, invalid_dir: str = "data/invalid") -> pd.DataFrame:
    """
    Carga un fichero NDJSON intentando reparar algunas líneas corruptas
    (como un 'stops' mal cerrado).

    - Devuelve únicamente los registros válidos.
    - Guarda en un CSV las líneas no parseables para analizarlas más adelante.
    """
    data = []
    invalid_records = []
    repaired_count = 0
    file_name = os.path.basename(file_path)

    with open(file_path, "r", encoding="utf-8") as f:
        for line_number, line in enumerate(f, 1):
            raw_line = line.strip()
            if not raw_line:
                continue

            # 1er intento: probar la línea tal cual
            try:
                record = json.loads(raw_line)
                data.append(record)
                continue
            except json.JSONDecodeError:
                pass

            # 2.º intento: reparar y volver a probar
            fixed = repair_line(raw_line)
            try:
                record = json.loads(fixed)
                data.append(record)
                repaired_count += 1
                continue
            except json.JSONDecodeError:
                # Sigue siendo inválida → se guarda como registro inválido
                invalid_records.append({
                    "file": file_name,
                    "line_number": line_number,
                    "raw_text": raw_line[:500]
                })

    valid_count = len(data)
    invalid_count = len(invalid_records)

    print(f"✅ {valid_count} registros válidos cargados desde {file_name}.")
    print(f"🔧 {repaired_count} líneas se repararon automáticamente.")
    if invalid_count > 0:
        print(f"⚠️ {invalid_count} líneas no se han podido parsear y se han registrado.")

        if save_invalid:
            os.makedirs(invalid_dir, exist_ok=True)
            invalid_path = os.path.join(invalid_dir, f"invalid_{file_name}.csv")
            pd.DataFrame(invalid_records).to_csv(invalid_path, index=False)
            print(f"📝 Líneas inválidas guardadas en: {invalid_path}")

    return pd.DataFrame(data)
