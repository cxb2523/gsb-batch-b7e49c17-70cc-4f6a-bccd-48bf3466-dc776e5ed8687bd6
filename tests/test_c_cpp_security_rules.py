"""C and C++ security rules (CC001-CC004)."""

from __future__ import annotations

from typing import List, Tuple

import pytest


def _need_pack() -> None:
    pytest.importorskip("tree_sitter_language_pack")


def _rules(language: str, code: str, path: str = "src/app.c") -> List[Tuple[str, int, str]]:
    _need_pack()
    from hefesto.analyzers.security import SecurityAnalyzer
    from hefesto.core.parsers.treesitter_parser import TreeSitterParser

    analyzer = SecurityAnalyzer()
    analyzer.lang_rules = True
    tree = TreeSitterParser(language).parse(code, path)
    issues = analyzer.analyze(tree, path, code)
    return sorted((i.rule_id, i.line, i.severity.value) for i in issues if i.rule_id)


def _c(body: str) -> str:
    return "void f(char *d, const char *s, int n) {\n" + body + "\n}\n"


C_CASES = [
    # CC001 gets
    ("char b[8]; gets(b);", [("CC001", 2, "HIGH")]),
    # CC002 unbounded copy / write
    ("strcpy(d, s);", [("CC002", 2, "MEDIUM")]),
    ("strcat(d, s);", [("CC002", 2, "MEDIUM")]),
    ('sprintf(d, "%s/x", s);', [("CC002", 2, "MEDIUM")]),
    ('scanf("%s", d);', [("CC002", 2, "MEDIUM")]),
    ('sscanf(s, "%d %s", &n, d);', [("CC002", 2, "MEDIUM")]),
    # bounded or literal forms are not reported
    ('strcpy(d, "abc");', []),
    ('sprintf(d, "%d", n);', []),
    ('sprintf(d, "%.8s", s);', []),
    ('sprintf(d, "%8s", s);', [("CC002", 2, "MEDIUM")]),
    ('scanf("%7s", d);', []),
    ('snprintf(d, 8, "%s", s);', []),
    ("strncpy(d, s, 8);", []),
    # CC003 format string that is not a literal
    ("printf(s);", [("CC003", 2, "MEDIUM")]),
    ("fprintf(stderr, s);", [("CC003", 2, "MEDIUM")]),
    ("snprintf(d, 8, s);", [("CC003", 2, "MEDIUM")]),
    ("syslog(3, s);", [("CC003", 2, "MEDIUM")]),
    ('printf("%s", s);', []),
    ('printf("a" "b");', []),
    ("printf(MSG_FMT);", []),
    # CC004 command built at runtime
    ("system(s);", [("CC004", 2, "HIGH")]),
    ('popen(s, "r");', [("CC004", 2, "HIGH")]),
    ('system("ls -l");', []),
    ('popen("date", "r");', []),
    ('system("ls " "-l");', []),
    ("system(FIXED_CMD);", []),
    ('system(_("ls"));', []),
    ('system("ls " + s);', [("CC004", 2, "HIGH")]),
    # comments and strings never match
    ('/* gets(b); strcpy(d, s); */ const char *t = "system(s)";', []),
]


@pytest.mark.parametrize("body,expected", C_CASES)
def test_c_rules(body: str, expected) -> None:
    assert _rules("c", _c(body)) == expected


CPP_CASES = [
    ("std::system(s);", [("CC004", 2, "HIGH")]),
    ('std::system("ls" " -l");', []),
    ("std::system(FIXED_CMD);", []),
    ('std::system(_("ls"));', []),
    ('std::system("ls " + s);', [("CC004", 2, "HIGH")]),
    ("::strcpy(d, s);", [("CC002", 2, "MEDIUM")]),
    ("std::printf(s);", [("CC003", 2, "MEDIUM")]),
    ("obj.system(s);", []),
    ("std::string t(s); std::cout << t;", []),
]


@pytest.mark.parametrize("body,expected", CPP_CASES)
def test_cpp_rules(body: str, expected) -> None:
    assert _rules("cpp", _c(body), "src/app.cpp") == expected


def test_test_paths_are_skipped() -> None:
    assert _rules("c", _c("gets(d);"), "tests/t.c") == []


def test_off_by_default() -> None:
    _need_pack()
    from hefesto.analyzers.security import SecurityAnalyzer
    from hefesto.core.parsers.treesitter_parser import TreeSitterParser

    code = _c("gets(d); system(s);")
    tree = TreeSitterParser("c").parse(code, "src/a.c")
    issues = SecurityAnalyzer().analyze(tree, "src/a.c", code)
    assert not [i for i in issues if (i.rule_id or "").startswith("CC")]


def test_cwe_and_types() -> None:
    _need_pack()
    from hefesto.analyzers.security import SecurityAnalyzer
    from hefesto.core.parsers.treesitter_parser import TreeSitterParser

    code = _c("gets(d); strcpy(d, s); printf(s); system(s);")
    analyzer = SecurityAnalyzer()
    analyzer.lang_rules = True
    tree = TreeSitterParser("c").parse(code, "src/a.c")
    got = {
        i.rule_id: (i.issue_type.value, i.metadata.get("cwe"))
        for i in analyzer.analyze(tree, "src/a.c", code)
        if i.rule_id
    }
    assert got == {
        "CC001": ("UNSAFE_BUFFER_FUNCTION", "CWE-242"),
        "CC002": ("UNSAFE_BUFFER_FUNCTION", "CWE-120"),
        "CC003": ("FORMAT_STRING_RISK", "CWE-134"),
        "CC004": ("COMMAND_INJECTION", "CWE-78"),
    }


def test_system_line_is_reported_once() -> None:
    _need_pack()
    from hefesto.analyzers.security import SecurityAnalyzer
    from hefesto.core.parsers.treesitter_parser import TreeSitterParser

    code = _c('char c[64]; sprintf(c, "rm %s", s); system(c);')
    analyzer = SecurityAnalyzer()
    analyzer.lang_rules = True
    tree = TreeSitterParser("c").parse(code, "src/a.c")
    cmd = [
        i
        for i in analyzer.analyze(tree, "src/a.c", code)
        if i.issue_type.value == "COMMAND_INJECTION"
    ]
    assert len(cmd) == 1 and cmd[0].rule_id == "CC004"


EXCLUSION_CASES = [
    # CC003: format forwarded by a variadic or va_list wrapper
    ("void lg(const char *fmt, ...) { va_list ap; vprintf(fmt, ap); }", []),
    ("void lv(const char *fmt, va_list ap) { vfprintf(stderr, fmt, ap); }", []),
    ("void nv(const char *fmt) { printf(fmt); }", [("CC003", 1, "MEDIUM")]),
    # CC003: literal + offset, ternary of literals, gettext literals
    ('void g(int k) { printf(" %u" + k, 3); }', []),
    ('void g(int k) { printf(k ? "%d\\n" : "%d", k); }', []),
    ('void g(int k, char *s) { printf(k ? s : "x"); }', [("CC003", 1, "MEDIUM")]),
    ('void g(void) { printf(_("hello")); }', []),
    ('void g(void) { printf(gettext("hello %d"), 1); }', []),
    ("void g(char *s) { printf(_(s)); }", [("CC003", 1, "MEDIUM")]),
    # CC002: ALL-CAPS macro source is a literal
    ("void g(char *d) { strcpy(d, DEFAULT_NAME); }", []),
    ("void g(char *d, char *Name) { strcpy(d, Name); }", [("CC002", 1, "MEDIUM")]),
    # CC002: source length checked just before
    (
        "void g(char *d, char *s) {\n if (strlen(s) >= 16) return;\n strcpy(d, s);\n}",
        [],
    ),
    (
        "void g(char *s) {\n char *d = malloc(strlen(s) + 1);\n strcpy(d, s);\n}",
        [],
    ),
    (
        "void g(char *d, char *s, char *t) {\n if (strlen(t) > 3) return;\n strcpy(d, s);\n}",
        [("CC002", 3, "MEDIUM")],
    ),
]


@pytest.mark.parametrize("code,expected", EXCLUSION_CASES)
def test_exclusions(code: str, expected) -> None:
    assert _rules("c", code + "\n") == expected


RUNTIME_FORMAT_CASES = [
    # CC003: a non-forwarded, non-constant format is reported whether or not
    # arguments follow it -- printf(buf) prints the buffer as a format and
    # printf(fmt, x) still passes a runtime-chosen string as the format.
    ("void g(char *s) { printf(s); }", [("CC003", 1, "MEDIUM")]),
    ("void g(FILE *f, char *m) { fprintf(f, m); }", [("CC003", 1, "MEDIUM")]),
    ("void g(char *m) { syslog(3, m); }", [("CC003", 1, "MEDIUM")]),
    ("void g(char *d, char *m) { sprintf(d, m); }", [("CC003", 1, "MEDIUM")]),
    ("void g(char *s, int n) { printf(s, n); }", [("CC003", 1, "MEDIUM")]),
    ("void g(FILE *f, char *fmt, int n) { fprintf(f, fmt, n); }", [("CC003", 1, "MEDIUM")]),
    ("void g(char *m, char *x) { syslog(3, m, x); }", [("CC003", 1, "MEDIUM")]),
    ("void g(char *d, char *fmt, int n) { snprintf(d, 8, fmt, n); }", [("CC003", 1, "MEDIUM")]),
    # A local variable or an expression used as a format is still CC003.
    ("void g(char *x) { char *m = x; printf(m); }", [("CC003", 1, "MEDIUM")]),
    ("char *g_msg; void g(void) { printf(g_msg); }", [("CC003", 1, "MEDIUM")]),
    ("void g(int k, char *s) { printf(k ? s : \"x\"); }", [("CC003", 1, "MEDIUM")]),
]


@pytest.mark.parametrize("code,expected", RUNTIME_FORMAT_CASES)
def test_cc003_runtime_format_is_reported(code: str, expected) -> None:
    assert _rules("c", code + "\n") == expected


FORWARD_CASES = [
    # A variadic or va_list wrapper forwards its own format parameter: the
    # caller chose the format, so the wrapper itself is not CC003.
    ("void lg(const char *fmt, ...) { va_list ap; vprintf(fmt, ap); }", []),
    ("void lv(const char *fmt, va_list ap) { vfprintf(stderr, fmt, ap); }", []),
    ("void ls(const char *fmt, ...) { char b[64]; vsnprintf(b, 64, fmt, ap); }", []),
    ("void lv(const char *fmt, va_list &ap) { vfprintf(stderr, fmt, ap); }", []),
    ("void lg(const char *fmt, ...) { printf(fmt, 1); }", []),
    # A non-variadic function cannot forward: its parameter is a plain runtime
    # string, so passing it as a format is CC003.
    ("void nv(const char *fmt) { printf(fmt); }", [("CC003", 1, "MEDIUM")]),
    ("void nv(const char *fmt, int n) { printf(fmt, n); }", [("CC003", 1, "MEDIUM")]),
    # The va_list argument carries values, not a format: a local format used
    # beside it in a va_list function is still CC003.
    (
        "#include <stdarg.h>\nvoid g(va_list ap) { char *m = 0; vprintf(m, ap); }",
        [("CC003", 2, "MEDIUM")],
    ),
]


@pytest.mark.parametrize("code,expected", FORWARD_CASES)
def test_cc003_forwarded_format(code: str, expected) -> None:
    lang = "cpp" if "&ap" in code else "c"
    assert _rules(lang, code + "\n", f"src/app.{'cpp' if lang == 'cpp' else 'c'}") == expected


LENGTH_CHECK_CASES = [
    # strlen/strnlen on the source within the three preceding statements: safe.
    (
        "void g(char *d, char *s) {\n if (strlen(s) >= 16) return;\n strcpy(d, s);\n}",
        [],
    ),
    (
        "void g(char *d, char *s) {\n if (strnlen(s, 64) > 8) return;\n strcpy(d, s);\n}",
        [],
    ),
    (
        "void g(char *d, char *s) {\n (void)strlen(s);\n int a = 1;\n int b = 2;\n"
        " strcpy(d, s);\n}",
        [],
    ),
    (
        "void g(char *d, char *s) {\n size_t n = strlen(s);\n strcat(d, s);\n}",
        [],
    ),
    # Removing the check restores the report.
    (
        "void g(char *d, char *s) {\n int x = 1;\n strcpy(d, s);\n}",
        [("CC002", 3, "MEDIUM")],
    ),
    # A check older than the three preceding statements no longer protects.
    (
        "void g(char *d, char *s) {\n (void)strlen(s);\n int a = 1;\n int b = 2;\n"
        " int c = 3;\n strcpy(d, s);\n}",
        [("CC002", 6, "MEDIUM")],
    ),
    # A check on a different source does not protect this copy.
    (
        "void g(char *d, char *s, char *t) {\n if (strlen(t) > 3) return;\n strcpy(d, s);\n}",
        [("CC002", 3, "MEDIUM")],
    ),
]


@pytest.mark.parametrize("code,expected", LENGTH_CHECK_CASES)
def test_cc002_length_check_window(code: str, expected) -> None:
    assert _rules("c", code + "\n") == expected


SHELL_LITERAL_CASES = [
    # Constant commands are not reported: plain and adjacent literals,
    # ALL-CAPS macros, gettext-style wrappers, ternaries of constants.
    ('void g(void) { system("ls -l"); }', []),
    ('void g(void) { system("ls " "-l"); }', []),
    ('void g(void) { popen("date", "r"); }', []),
    ("#define FIXED_CMD \"ls\"\nvoid g(void) { system(FIXED_CMD); }", []),
    ('void g(void) { system(_("ls -l")); }', []),
    ('void g(void) { system(gettext("ls")); }', []),
    ('void g(int k) { system(k ? "a" : "b"); }', []),
    ('void g(int k) { system("ls" + k); }', []),
    ("void g(char s[]) { system(\"ls \" + s); }", [("CC004", 1, "HIGH")]),
]


@pytest.mark.parametrize("code,expected", SHELL_LITERAL_CASES)
def test_cc004_constant_commands(code: str, expected) -> None:
    assert _rules("c", code + "\n") == expected


SHELL_RUNTIME_CASES = [
    # Variables and built expressions are commands an attacker can influence.
    ("void g(char *c) { system(c); }", [("CC004", 1, "HIGH")]),
    ('void g(char *s) { system("ls " + s); }', [("CC004", 1, "HIGH")]),
    ("void g(char *c) { popen(c, \"r\"); }", [("CC004", 1, "HIGH")]),
    ('void g(int k, char *s) { system(k ? s : "ls"); }', [("CC004", 1, "HIGH")]),
    ("void g(char *c) { _wsystem(c); }", [("CC004", 1, "HIGH")]),
]


@pytest.mark.parametrize("code,expected", SHELL_RUNTIME_CASES)
def test_cc004_runtime_commands(code: str, expected) -> None:
    got = _rules("c", code + "\n")
    assert got == [(rule, line, sev) for (rule, line, sev) in got if rule == "CC004"]
    assert got == expected
    assert all(sev == "HIGH" for _, _, sev in got)


def test_cc004_integer_offset_is_constant_in_cpp() -> None:
    code = (
        "void g(int& n, const char* s) {\n"
        ' std::system("ls" + n);\n'
        ' std::system("ls " + s);\n'
        "}\n"
    )
    assert _rules("cpp", code, "src/a.cpp") == [("CC004", 3, "HIGH")]


def test_cc004_keeps_cwe78() -> None:
    _need_pack()
    from hefesto.analyzers.security import SecurityAnalyzer
    from hefesto.core.parsers.treesitter_parser import TreeSitterParser

    code = "void g(char *c) { system(c); }\n"
    analyzer = SecurityAnalyzer()
    analyzer.lang_rules = True
    tree = TreeSitterParser("c").parse(code, "src/a.c")
    issue = next(i for i in analyzer.analyze(tree, "src/a.c", code) if i.rule_id == "CC004")
    assert issue.metadata["cwe"] == "CWE-78"
    assert issue.severity.value == "HIGH"


def test_strings_and_comments_never_trigger() -> None:
    _need_pack()
    code = (
        "void g(void) {\n"
        "  /* gets(b); strcpy(d, s); system(s); printf(s); */\n"
        "  // system(\"rm -rf /\"); strcat(d, s);\n"
        '  const char *t = "system(s); strcpy(d, s); gets(b);";\n'
        "}\n"
    )
    assert _rules("c", code) == []


def _measured_complexity(name: str) -> int:
    """Complexity of the one function named ``name``, from the analyzer."""
    from pathlib import Path

    from hefesto.analyzers.complexity import ComplexityAnalyzer
    from hefesto.core.parsers.python_parser import PythonParser

    relative = "hefesto/analyzers/lang_security_rules.py"
    code = (Path(__file__).resolve().parents[1] / relative).read_text(encoding="utf-8")
    tree = PythonParser().parse(code, relative)
    found = [node for node in tree.get_functions() if node.name == name]
    assert len(found) == 1, name
    analyzer = ComplexityAnalyzer()
    score = analyzer._calculate_complexity(found[0])
    for issue in analyzer.analyze(tree, relative, code):
        if issue.function_name == name:
            assert issue.metadata["complexity"] == score
    return score


@pytest.mark.parametrize("name", ["_cc_func_name", "_cc_format_rule", "_cc_rule"])
def test_flagged_c_cpp_rule_functions_stay_below_medium(name: str) -> None:
    from hefesto.analyzers.complexity import _THRESHOLDS
    from hefesto.core.analysis_models import AnalysisIssueSeverity

    medium = _THRESHOLDS[AnalysisIssueSeverity.MEDIUM]
    score = _measured_complexity(name)
    assert score < medium, (name, score, medium)
