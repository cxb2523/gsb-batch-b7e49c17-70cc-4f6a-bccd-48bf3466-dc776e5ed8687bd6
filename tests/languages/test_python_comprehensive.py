"""
Exhaustive tests for the Python plugin covering every realistic code pattern.

Code style categories:
  - Plain and decorated classes (dataclass, attrs, abc)
  - Instance methods, static methods, class methods, properties, property setters
  - Plain, decorated, and async top-level functions
  - Multiple stacked decorators
  - Async methods inside classes
  - Class inheritance
  - extract_symbol_source with and without decorators
  - extract_calls_in_function with various call styles
"""
import pytest
from codetree.languages.python import PythonPlugin

P = PythonPlugin()


# ─── Class styles ──────────────────────────────────────────────────────────────

def test_plain_class():
    src = b"class Foo:\n    pass\n"
    assert any(x["type"] == "class" and x["name"] == "Foo" for x in P.extract_skeleton(src))


def test_class_with_inheritance():
    src = b"class Child(Base):\n    pass\n"
    assert any(x["name"] == "Child" for x in P.extract_skeleton(src))


def test_class_with_multiple_bases():
    src = b"class Mixed(Base1, Base2, Mixin):\n    pass\n"
    assert any(x["name"] == "Mixed" for x in P.extract_skeleton(src))


def test_decorated_class_dataclass():
    src = b"from dataclasses import dataclass\n\n@dataclass\nclass Point:\n    x: float\n    y: float\n"
    assert any(x["type"] == "class" and x["name"] == "Point" for x in P.extract_skeleton(src))


def test_decorated_class_with_args():
    src = b"@decorator(arg=True)\nclass Configured:\n    pass\n"
    assert any(x["name"] == "Configured" for x in P.extract_skeleton(src))


def test_multiple_stacked_class_decorators():
    src = b"@d1\n@d2\n@d3\nclass Multi:\n    pass\n"
    assert any(x["name"] == "Multi" for x in P.extract_skeleton(src))


# ─── Method styles ─────────────────────────────────────────────────────────────

def test_instance_method():
    src = b"class Foo:\n    def bar(self): pass\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "bar" and x["parent"] == "Foo" for x in result)


def test_static_method():
    src = b"class Foo:\n    @staticmethod\n    def static_bar(): pass\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "static_bar" and x["parent"] == "Foo" for x in result)


def test_class_method():
    src = b"class Foo:\n    @classmethod\n    def create(cls): pass\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "create" and x["parent"] == "Foo" for x in result)


def test_property():
    src = b"class Foo:\n    @property\n    def name(self): return self._name\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "name" and x["parent"] == "Foo" for x in result)


def test_property_setter():
    src = b"class Foo:\n    @name.setter\n    def name(self, v): self._name = v\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "name" for x in result)


def test_async_method():
    src = b"class Api:\n    async def fetch(self): pass\n"
    result = P.extract_skeleton(src)
    assert any(x["name"] == "fetch" and x["parent"] == "Api" for x in result)


def test_dunder_method():
    src = b"class Foo:\n    def __init__(self): pass\n    def __str__(self): return ''\n"
    result = P.extract_skeleton(src)
    names = [x["name"] for x in result]
    assert "__init__" in names
    assert "__str__" in names


def test_private_method():
    src = b"class Foo:\n    def _private(self): pass\n    def __dunder(self): pass\n"
    result = P.extract_skeleton(src)
    names = [x["name"] for x in result]
    assert "_private" in names
    assert "__dunder" in names


# ─── Top-level function styles ─────────────────────────────────────────────────

def test_plain_function():
    src = b"def plain(): pass\n"
    assert any(x["name"] == "plain" and x["parent"] is None for x in P.extract_skeleton(src))


def test_async_function():
    src = b"async def load(): pass\n"
    assert any(x["name"] == "load" for x in P.extract_skeleton(src))


def test_decorated_function():
    src = b"@app.route('/users')\ndef get_users(): return []\n"
    assert any(x["name"] == "get_users" for x in P.extract_skeleton(src))


def test_decorated_function_with_args():
    src = b"@cache(ttl=60)\ndef expensive(x): return x\n"
    assert any(x["name"] == "expensive" for x in P.extract_skeleton(src))


def test_multiple_stacked_function_decorators():
    src = b"@d1\n@d2\n@d3\ndef multi(): pass\n"
    assert any(x["name"] == "multi" for x in P.extract_skeleton(src))


def test_async_decorated_function():
    src = b"@retry(3)\nasync def flaky(): pass\n"
    assert any(x["name"] == "flaky" for x in P.extract_skeleton(src))


def test_function_with_complex_params():
    src = b"def complex(a, b=1, *args, key=None, **kwargs): pass\n"
    result = P.extract_skeleton(src)
    fn = next(x for x in result if x["name"] == "complex")
    assert "a" in fn["params"]
    assert "kwargs" in fn["params"]


# ─── extract_symbol_source ─────────────────────────────────────────────────────

def test_symbol_source_plain_function():
    src = b"def greet(name):\n    return 'Hello ' + name\n"
    source, line = P.extract_symbol_source(src, "greet")
    assert "def greet" in source
    assert line == 1


def test_symbol_source_decorated_function_includes_decorator():
    src = b"@app.route('/api')\ndef endpoint():\n    return {}\n"
    source, line = P.extract_symbol_source(src, "endpoint")
    assert "@app.route" in source
    assert "def endpoint" in source
    assert line == 1  # starts at decorator


def test_symbol_source_multiple_decorators_includes_all():
    src = b"@auth\n@log\ndef secure(): pass\n"
    source, line = P.extract_symbol_source(src, "secure")
    assert "@auth" in source
    assert "@log" in source


def test_symbol_source_class_includes_all_methods():
    src = b"class Calc:\n    def add(self): pass\n    def sub(self): pass\n"
    source, line = P.extract_symbol_source(src, "Calc")
    assert "def add" in source
    assert "def sub" in source


def test_symbol_source_none_for_missing():
    src = b"def foo(): pass\n"
    assert P.extract_symbol_source(src, "bar") is None


# ─── extract_calls_in_function ─────────────────────────────────────────────────

def test_calls_direct():
    src = b"def process():\n    validate()\n    save()\n"
    calls = P.extract_calls_in_function(src, "process")
    assert "validate" in calls
    assert "save" in calls


def test_calls_method_on_object():
    src = b"def run():\n    db.connect()\n    db.query('SELECT 1')\n"
    calls = P.extract_calls_in_function(src, "run")
    assert "connect" in calls
    assert "query" in calls


def test_calls_constructor():
    src = b"def build():\n    return MyClass()\n"
    calls = P.extract_calls_in_function(src, "build")
    assert "MyClass" in calls


def test_calls_chained():
    src = b"def fetch():\n    return requests.get(url).json()\n"
    calls = P.extract_calls_in_function(src, "fetch")
    assert "get" in calls or "json" in calls


def test_calls_decorated_function():
    src = b"@app.route('/')\ndef index():\n    return render_template('index.html')\n"
    calls = P.extract_calls_in_function(src, "index")
    assert "render_template" in calls


def test_calls_async_function():
    src = b"async def load():\n    data = await fetch()\n    return parse(data)\n"
    calls = P.extract_calls_in_function(src, "load")
    assert "fetch" in calls
    assert "parse" in calls


def test_calls_empty_for_unknown_function():
    src = b"def foo(): pass\n"
    assert P.extract_calls_in_function(src, "nonexistent") == []


# ─── extract_symbol_usages ─────────────────────────────────────────────────────

def test_usages_found_multiple_times():
    src = b"class Foo:\n    pass\n\ndef use():\n    x = Foo()\n    y = Foo()\n"
    usages = P.extract_symbol_usages(src, "Foo")
    lines = [u["line"] for u in usages]
    assert 1 in lines      # definition
    assert len(lines) >= 3  # definition + 2 uses


def test_usages_empty_for_absent_symbol():
    src = b"def foo(): pass\n"
    assert P.extract_symbol_usages(src, "Bar") == []
