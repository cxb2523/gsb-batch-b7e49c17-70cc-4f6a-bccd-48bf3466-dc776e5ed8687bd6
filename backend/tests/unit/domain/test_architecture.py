import ast
from pathlib import Path
import app
import pytest

APP = Path(app.__file__).resolve().parent

@pytest.mark.parametrize("layer", ["domain", "application"])
def test_inner_layers_do_not_import_adapters_or_web_frameworks(layer):
    forbidden = ("app.infrastructure", "app.presentation", "app.bootstrap", "app.main",
                 "fastapi", "starlette", "aiortc", "av", "psycopg", "sqlite3", "dotenv")
    for path in (APP / layer).rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                imports = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                assert node.level == 0, f"Use explicit imports so the boundary can be checked: {path}"
                imports = [node.module or ""]
            else:
                continue
            if layer == "domain":
                assert not any(name.startswith("app.application") for name in imports), path
            assert not any(name == prefix or name.startswith(prefix + ".")
                           for name in imports for prefix in forbidden), (path, imports)
