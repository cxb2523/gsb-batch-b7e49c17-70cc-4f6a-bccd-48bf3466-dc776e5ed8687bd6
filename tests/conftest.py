import pathlib
import sys

# make `printdash` importable when pytest runs from the repo root
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
