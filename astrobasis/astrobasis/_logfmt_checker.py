"""Logfmt 硬化验证函数 — 纯 AST 机制，无包依赖。

Rule B/C 的 AST 检查逻辑。供 pre-commit 脚本和 CI 调用。
所有函数接受 ast.expr 节点，返回 None（通过）或错误描述字符串（违规）。

用法:
    from astrobasis._logfmt_checker import check_raise_arg, check_annotation_arg
    violation = check_raise_arg(node)  # None if OK, str if violation
"""

from __future__ import annotations

import ast


def check_raise_arg(arg: ast.expr) -> str | None:
    """Rule B: raise 静态消息必须引用 ErrorMessage 枚举成员。"""
    if isinstance(arg, ast.Attribute) and arg.attr == "message":
        return None
    if isinstance(arg, ast.Name):
        return None
    if isinstance(arg, ast.JoinedStr):
        return None
    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
        preview = arg.value[:60]
        return f'raise 静态消息必须使用 ErrorMessage.MEMBER.message 枚举引用, 而非裸字符串: "{preview}"'
    return None


def check_annotation_arg(arg: ast.expr) -> str | None:
    """Rule C: annotate() 键参数必须引用 AnnotationKey 枚举成员。"""
    if isinstance(arg, ast.Attribute) and isinstance(arg.value, ast.Name):
        if arg.value.id == "AnnotationKey":
            return None
    if isinstance(arg, ast.Name):
        return None
    if isinstance(arg, ast.JoinedStr):
        return None
    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
        preview = arg.value[:60]
        return f'ctx.annotate() 键参数必须使用 AnnotationKey.MEMBER 枚举引用, 而非裸字符串: "{preview}"'
    return None
