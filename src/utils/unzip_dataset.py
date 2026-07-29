import os
import shutil
from zipfile import ZipFile
from pathlib import Path

def unzip_dataset():
    """Unzips dataset.zip and leaves the JSON files ready in data/extracted/"""
    base_dir = Path(__file__).resolve().parents[2]
    zip_path = base_dir / "data" / "raw" / "dataset.zip"
    extracted_dir = base_dir / "data" / "extracted"

    if not zip_path.exists():
        raise FileNotFoundError(f"{zip_path} not found")

    if extracted_dir.exists():
        shutil.rmtree(extracted_dir)
    extracted_dir.mkdir(parents=True, exist_ok=True)

    with ZipFile(zip_path, "r") as z:
        z.extractall(extracted_dir)
    print(f"[OK] Dataset unzipped in {extracted_dir}")

    macosx_folder = extracted_dir / "__MACOSX"
    if macosx_folder.exists():
        shutil.rmtree(macosx_folder)
        print("[INFO] '__MACOSX' folder removed")

    dataset_folder = extracted_dir / "dataset"
    if dataset_folder.exists() and dataset_folder.is_dir():
        for item in dataset_folder.iterdir():
            shutil.move(str(item), extracted_dir)
        shutil.rmtree(dataset_folder)
        print("[INFO] Content moved from 'dataset/' to data/extracted/")

    return extracted_dir
