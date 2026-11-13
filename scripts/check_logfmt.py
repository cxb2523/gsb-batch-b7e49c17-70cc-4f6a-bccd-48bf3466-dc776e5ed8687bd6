#!/usr/bin/env python3
"""pre-commit hook: 阻止不合规的日志调用、错误消息和注解提交。

检查 astrocrawl/astroframe/astroweave 下所有 Python 文件：
  - stdlib logger 消息字符串必须以 "event=" 开头（logfmt 规范）
  - 项目异常的静态 raise 消息必须引用 ErrorMessage 枚举成员（Rule B）
  - ProcessingContext.annotate() 键参数必须引用 AnnotationKey 枚举成员（Rule C）

豁免规则：
  A. 模块级 logging.xxx() 直接调用 → 跳过（启动期日志）
  B. 测试文件（路径含 /tests/） → 跳过
  C. 行末 # logfmt: allow 注释 → 跳过该行
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

from astrobasis._logfmt_checker import check_annotation_arg, check_raise_arg

_LOG_METHODS = frozenset({"debug", "info", "warning", "error", "critical", "exception"})


def _collect_loggers(tree: ast.AST) -> tuple[set[str], set[str]]:
    """收集 stdlib logger 变量。

    Returns:
        (stdlib_loggers, self_loggers)
        - stdlib_loggers: 模块级赋值为 logging.getLogger(...) 的变量名
        - self_loggers: __init__ 中赋值为 logging.getLogger(...) 的 self.xxx 属性名
    """
    stdlib_loggers: set[str] = set()
    self_loggers: set[str] = set()

    for node in ast.walk(tree):
        # 模块级: name = logging.getLogger(...)
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    if _is_getlogger_call(node.value, "logging"):
                        stdlib_loggers.add(target.id)

        # __init__ 中: self.xxx = logging.getLogger(...)
        if isinstance(node, ast.FunctionDef) and node.name == "__init__":
            for stmt in ast.walk(node):
                if isinstance(stmt, ast.Assign):
                    for target in stmt.targets:
                        if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name):
                            if target.value.id == "self":
                                if _is_getlogger_call(stmt.value, "logging"):
                                    self_loggers.add(target.attr)

    return stdlib_loggers, self_loggers


def _is_getlogger_call(node: ast.expr, module_name: str) -> bool:
    """检查是否为 module_name.getLogger(...) 调用。"""
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if not isinstance(func, ast.Attribute):
        return False
    if func.attr != "getLogger":
        return False
    return isinstance(func.value, ast.Name) and func.value.id == module_name


def _is_log_call(node: ast.expr, logger_names: set[str], self_logger_attrs: set[str]) -> bool:
    """检查是否为 stdlib logger 的日志方法调用。"""
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if not isinstance(func, ast.Attribute):
        return False
    if func.attr not in _LOG_METHODS:
        return False

    # 模块级: _log.info(...) / logger.info(...) / _LOG.info(...)
    if isinstance(func.value, ast.Name) and func.value.id in logger_names:
        return True

    # 实例级: self._log.info(...)
    if isinstance(func.value, ast.Attribute) and isinstance(func.value.value, ast.Name):
        if func.value.value.id == "self" and func.value.attr in self_logger_attrs:
            return True

    return False


def _check_message(first_arg: ast.expr) -> tuple[bool, str]:
    """检查第一个参数是否以 event= 开头。

    Returns:
        (is_ok, issue_description)
    """
    # 字符串常量
    if isinstance(first_arg, ast.Constant) and isinstance(first_arg.value, str):
        if first_arg.value.startswith("event="):
            return True, ""
        preview = first_arg.value[:60].replace("\n", " ")
        return False, f'日志消息缺少 event= 前缀: "{preview}..."' if len(
            first_arg.value
        ) > 60 else f'日志消息缺少 event= 前缀: "{first_arg.value}"'

    # f-string: 提取静态前缀检查 event=
    if isinstance(first_arg, ast.JoinedStr):
        prefix_parts: list[str] = []
        for part in first_arg.values:
            if isinstance(part, ast.Constant) and isinstance(part.value, str):
                prefix_parts.append(part.value)
            else:
                break
        prefix = "".join(prefix_parts)
        if "event=" in prefix:
            return True, ""
        return False, f'f-string 缺少 event= 前缀: "{prefix}..."'

    # .format() 调用
    if isinstance(first_arg, ast.Call) and isinstance(first_arg.func, ast.Attribute):
        if first_arg.func.attr == "format":
            if isinstance(first_arg.func.value, ast.Constant) and isinstance(first_arg.func.value.value, str):
                template = first_arg.func.value.value
                if template.startswith("event="):
                    return True, ""
                return False, f'.format() 模板缺少 event= 前缀: "{template[:60]}"'

    # 变量引用 — 无法静态检查
    if isinstance(first_arg, ast.Name):
        return True, ""

    return True, ""


def _is_module_level_logging(node: ast.expr) -> bool:
    """检查是否为模块级 logging.xxx() 调用（非 getLogger 的结果）。"""
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if not isinstance(func, ast.Attribute):
        return False
    if func.attr not in _LOG_METHODS:
        return False
    return isinstance(func.value, ast.Name) and func.value.id == "logging"


def _has_allow_comment(node: ast.AST, source_lines: list[str]) -> bool:
    """检查节点所在行是否有 # logfmt: allow 注释。"""
    if hasattr(node, "lineno") and node.lineno is not None:
        line = source_lines[node.lineno - 1]
        return "# logfmt: allow" in line
    return False


_PROJECT_PACKAGES = (
    "astrobasis",
    "astroframe",
    "astrocrawl",
    "astroweave",
    "astroguard",
    "astrostaff",
    "astroforum",
    "astrocraft",
    "astrovault",
    "astroguild",
)


def _collect_project_exceptions(tree: ast.AST) -> set[str]:
    """扫描项目包 import 以收集异常类名（供 Rule B 识别项目异常）。"""
    exc_names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.module and node.module.startswith(_PROJECT_PACKAGES):
                for alias in node.names:
                    if "Error" in alias.name:
                        exc_names.add(alias.name)
    return exc_names


def check_file(filepath: Path) -> list[str]:
    """检查单个文件，返回违规列表。"""
    try:
        source = filepath.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []

    source_lines = source.splitlines()
    try:
        tree = ast.parse(source, filename=str(filepath))
    except SyntaxError:
        return []

    stdlib_loggers, self_loggers = _collect_loggers(tree)
    project_exc_names = _collect_project_exceptions(tree)

    violations: list[str] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue

        # 豁免: 模块级 logging.xxx() 调用
        if _is_module_level_logging(node):
            continue

        # 检查是否为 stdlib logger 的日志调用
        if _is_log_call(node, stdlib_loggers, self_loggers):
            if not node.args:
                continue
            first_arg = node.args[0]
            if _has_allow_comment(node, source_lines):
                continue
            ok, msg = _check_message(first_arg)
            if not ok:
                violations.append(f"{filepath}:{node.lineno}: [LOGFMT] {msg}")

    # Rule C: annotate() 调用 — 键参数必须引用 AnnotationKey 枚举
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Attribute) or func.attr != "annotate":
            continue
        if not node.args:
            continue
        first_arg = node.args[0]
        if _has_allow_comment(node, source_lines):
            continue
        msg = check_annotation_arg(first_arg)
        if msg is not None:
            violations.append(f"{filepath}:{node.lineno}: [LOGFMT] {msg}")

    # Rule B: raise 语句 — 静态消息必须引用 ErrorMessage 枚举
    for node in ast.walk(tree):
        if not isinstance(node, ast.Raise):
            continue
        if node.exc is None:
            continue
        exc = node.exc
        if not isinstance(exc, ast.Call) or not exc.args:
            continue
        exc_name = None
        if isinstance(exc.func, ast.Name):
            exc_name = exc.func.id
        elif isinstance(exc.func, ast.Attribute):
            exc_name = exc.func.attr
        if exc_name not in project_exc_names:
            continue
        first_arg = exc.args[0]
        if _has_allow_comment(node, source_lines):
            continue
        msg = check_raise_arg(first_arg)
        if msg is not None:
            violations.append(f"{filepath}:{node.lineno}: [LOGFMT] {msg}")

    return violations


def main() -> int:
    files = [
        Path(f)
        for f in sys.argv[1:]
        if f.endswith(".py")
        and ("/astrocrawl/" in f or "/astrobasis/" in f or "/astroframe/" in f or "/astroweave/" in f)
    ]

    # 跳过测试文件
    files = [f for f in files if "/tests/" not in str(f)]

    if not files:
        return 0

    all_violations: list[str] = []
    for filepath in files:
        all_violations.extend(check_file(filepath))

    if all_violations:
        for v in all_violations:
            print(v)
        print(f"\n{len(all_violations)} violations in {len({v.split(':')[0] for v in all_violations})} files")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
