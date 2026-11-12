from dataclasses import dataclass


@dataclass
class SymbolNode:
    qualified_name: str
    name: str
    kind: str
    file_path: str
    start_line: int
    end_line: int | None = None
    parent_qn: str | None = None
    doc: str = ""
    params: str = ""
    is_test: bool = False
    is_entry_point: bool = False


@dataclass
class Edge:
    source_qn: str
    target_qn: str
    type: str  # CALLS, IMPORTS, CONTAINS, TESTS, DATA_FLOWS
    weight: float = 1.0


def make_qualified_name(file_path: str, name: str, parent: str | None = None) -> str:
    """Build a qualified name: file_path::Parent.name or file_path::name."""
    if parent:
        return f"{file_path}::{parent}.{name}"
    return f"{file_path}::{name}"
