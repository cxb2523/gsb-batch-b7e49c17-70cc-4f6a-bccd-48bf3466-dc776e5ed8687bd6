import pytest
from codetree.languages.base import LanguagePlugin


def test_language_plugin_is_abstract():
    """LanguagePlugin cannot be instantiated directly."""
    with pytest.raises(TypeError):
        LanguagePlugin()


def test_concrete_plugin_must_implement_all_methods():
    """A subclass missing any method cannot be instantiated."""
    class Incomplete(LanguagePlugin):
        extensions = (".x",)
        def extract_skeleton(self, source): return []
        # missing the other 3 methods

    with pytest.raises(TypeError):
        Incomplete()


def test_concrete_plugin_with_all_methods_works():
    class Complete(LanguagePlugin):
        extensions = (".x",)
        def extract_skeleton(self, source): return []
        def extract_symbol_source(self, source, name): return None
        def extract_calls_in_function(self, source, fn_name): return []
        def extract_symbol_usages(self, source, name): return []
        def extract_imports(self, source): return []

    plugin = Complete()
    assert plugin.extensions == (".x",)
    assert plugin.extract_skeleton(b"") == []
