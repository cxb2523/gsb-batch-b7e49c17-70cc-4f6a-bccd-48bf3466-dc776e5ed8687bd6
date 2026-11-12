import pytest
from codetree.languages.python import PythonPlugin

PLUGIN = PythonPlugin()

SAMPLE = b"""\
class Calculator:
    def add(self, a, b):
        return a + b

    def divide(self, a, b):
        if b == 0:
            raise ValueError("cannot divide by zero")
        return a / b

def helper():
    calc = Calculator()
    return calc.add(1, 2)
"""


def test_skeleton_finds_class():
    result = PLUGIN.extract_skeleton(SAMPLE)
    assert any(item["type"] == "class" and item["name"] == "Calculator" for item in result)


def test_skeleton_finds_methods():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "add" in names
    assert "divide" in names


def test_skeleton_method_has_parent():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert add["parent"] == "Calculator"


def test_skeleton_finds_top_level_function():
    result = PLUGIN.extract_skeleton(SAMPLE)
    names = [item["name"] for item in result]
    assert "helper" in names


def test_skeleton_includes_line_numbers():
    result = PLUGIN.extract_skeleton(SAMPLE)
    calc = next(item for item in result if item["name"] == "Calculator")
    assert calc["line"] == 1


def test_skeleton_includes_params():
    result = PLUGIN.extract_skeleton(SAMPLE)
    add = next(item for item in result if item["name"] == "add")
    assert "a" in add["params"] and "b" in add["params"]


def test_extract_symbol_finds_function():
    source, line = PLUGIN.extract_symbol_source(SAMPLE, "add")
    assert "def add" in source
    assert "return a + b" in source


def test_extract_symbol_finds_class():
    source, line = PLUGIN.extract_symbol_source(SAMPLE, "Calculator")
    assert "class Calculator" in source


def test_extract_symbol_returns_none_for_missing():
    assert PLUGIN.extract_symbol_source(SAMPLE, "nonexistent") is None


def test_extract_calls_in_function():
    calls = PLUGIN.extract_calls_in_function(SAMPLE, "helper")
    assert "Calculator" in calls
    assert "add" in calls


def test_extract_symbol_usages():
    usages = PLUGIN.extract_symbol_usages(SAMPLE, "add")
    assert len(usages) >= 1
    assert any(u["line"] > 1 for u in usages)


# --- Decorated function/class support ---

DECORATED_SAMPLE = b"""\
import flask

app = flask.Flask(__name__)

@app.route('/users')
def get_users():
    return []

@app.route('/users/<int:id>')
def get_user(id):
    return {}

class UserService:
    @property
    def name(self):
        return 'UserService'

    @staticmethod
    def create(data):
        pass

@dataclass
class Config:
    host: str = 'localhost'
"""


def test_skeleton_decorated_functions():
    result = PLUGIN.extract_skeleton(DECORATED_SAMPLE)
    names = [item["name"] for item in result]
    assert "get_users" in names
    assert "get_user" in names


def test_skeleton_decorated_methods():
    result = PLUGIN.extract_skeleton(DECORATED_SAMPLE)
    names = [item["name"] for item in result]
    assert "name" in names
    assert "create" in names


def test_skeleton_decorated_class():
    result = PLUGIN.extract_skeleton(DECORATED_SAMPLE)
    assert any(item["type"] == "class" and item["name"] == "Config" for item in result)


def test_skeleton_no_duplicates():
    result = PLUGIN.extract_skeleton(DECORATED_SAMPLE)
    keys = [(item["name"], item["line"]) for item in result]
    assert len(keys) == len(set(keys))


def test_extract_symbol_decorated_function():
    result = PLUGIN.extract_symbol_source(DECORATED_SAMPLE, "get_users")
    assert result is not None
    source, line = result
    assert "@app.route" in source
    assert "def get_users" in source


def test_extract_calls_decorated_function():
    source = b"""\
@app.route('/users')
def get_users():
    return list_all()
"""
    calls = PLUGIN.extract_calls_in_function(source, "get_users")
    assert "list_all" in calls
