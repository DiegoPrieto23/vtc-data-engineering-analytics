import json
import re
import pandas as pd
import os

def repair_line(line: str) -> str:
    """
    Attempts to repair common errors in the 'stops' field of trip.json.
    Returns the possibly corrected line (without guaranteeing it is valid JSON).
    """

    fixed = line

    # Specific case detected: ...]}}]}  →  ...]}]} closes 'stops' incorrectly: there is an extra '}'
    fixed = fixed.replace("]}}]}", "]}]}")

    return fixed


def load_ndjson(file_path: str, save_invalid: bool = True, invalid_dir: str = "data/invalid") -> pd.DataFrame:
    """
    Loads an NDJSON file, attempting to repair some corrupted lines (such as improperly closed 'stops').

    - Returns only valid records.
    - Saves unparseable lines to a CSV file for later analysis.
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

            # 1st attempt: try line as-is
            try:
                record = json.loads(raw_line)
                data.append(record)
                continue
            except json.JSONDecodeError:
                pass

            # 2nd attempt: repair and try again
            fixed = repair_line(raw_line)
            try:
                record = json.loads(fixed)
                data.append(record)
                repaired_count += 1
                continue
            except json.JSONDecodeError:
                # Still invalid → store as invalid record
                invalid_records.append({
                    "file": file_name,
                    "line_number": line_number,
                    "raw_text": raw_line[:500]
                })

    valid_count = len(data)
    invalid_count = len(invalid_records)

    print(f"✅ {valid_count} valid records loaded from {file_name}.")
    print(f"🔧 {repaired_count} lines were automatically repaired.")
    if invalid_count > 0:
        print(f"⚠️ {invalid_count} lines could not be parsed and were recorded.")

        if save_invalid:
            os.makedirs(invalid_dir, exist_ok=True)
            invalid_path = os.path.join(invalid_dir, f"invalid_{file_name}.csv")
            pd.DataFrame(invalid_records).to_csv(invalid_path, index=False)
            print(f"📝 Invalid lines saved to: {invalid_path}")

    return pd.DataFrame(data)
