# Language Node Type Cheatsheet

Quick reference for tree-sitter node types used in codetree language plugins.
Use this when implementing a new plugin.

## How to discover node types for any file

```python
from tree_sitter import Language, Parser
import tree_sitter_LANG as tslang
L = Language(tslang.language())
p = Parser(L)
tree = p.parse(open("yourfile.ext", "rb").read())
def show(n, i=0):
    print(" "*i + n.type + (" -> " + repr(n.text.decode()) if not n.children else ""))
    [show(c, i+2) for c in n.children]
show(tree.root_node)
```

---

## Python

| Construct | Node type | Name field |
|---|---|---|
| Module root | `module` | — |
| Class | `class_definition` | `name: (identifier)` |
| Method | `function_definition` inside `class_body → block` | `name: (identifier)` |
| Function | `function_definition` inside `module` | `name: (identifier)` |
| Parameters | `parameters` | — |
| Call | `call` | `function: (identifier)` or `function: (attribute attribute: (identifier))` |
| Identifier | `identifier` | `#eq?` predicate |

---

## JavaScript

| Construct | Node type | Name field |
|---|---|---|
| Program root | `program` | — |
| Class | `class_declaration` | `name: (identifier)` |
| Method | `method_definition` inside `class_body` | `name: (property_identifier)` |
| Function | `function_declaration` | `name: (identifier)` |
| Parameters | `formal_parameters` | — |
| Call | `call_expression` | `function: (identifier)` or `function: (member_expression property: (property_identifier))` |
| Constructor call | `new_expression` | `constructor: (identifier)` |
| Identifier | `identifier` | `#eq?` predicate |

---

## TypeScript

Same as JavaScript plus:

| Construct | Node type | Name field |
|---|---|---|
| Interface | `interface_declaration` | `name: (type_identifier)` |
| Type alias | `type_alias_declaration` | `name: (type_identifier)` |
| Class name | `class_declaration` | `name: (type_identifier)` (not `identifier`!) |
| Grammar API | `tsts.language_typescript()` / `tsts.language_tsx()` | — |

---

## Go

| Construct | Node type | Name field |
|---|---|---|
| Source root | `source_file` | — |
| Struct | `type_declaration → type_spec` | `name: (type_identifier)` |
| Method | `method_declaration` | `name: (field_identifier)`, receiver in `parameter_list` |
| Receiver type | inside `method_declaration → parameter_list → parameter_declaration` | `type: (type_identifier)` or `type: (pointer_type (type_identifier))` |
| Function | `function_declaration` | `name: (identifier)` |
| Parameters | `parameter_list` | — |
| Call | `call_expression` | `function: (identifier)` or `function: (selector_expression field: (field_identifier))` |
| Identifier | `identifier` + `type_identifier` | `#eq?` predicate (search both!) |

---

## Rust

| Construct | Node type | Name field |
|---|---|---|
| Source root | `source_file` | — |
| Struct | `struct_item` | `name: (type_identifier)` |
| Enum | `enum_item` | `name: (type_identifier)` |
| Impl block | `impl_item` | `type: (type_identifier)` |
| Method/fn in impl | `function_item` inside `impl_item → declaration_list` | `name: (identifier)` |
| Top-level function | `function_item` inside `source_file` | `name: (identifier)` |
| Parameters | `parameters` | — |
| Call | `call_expression` | `function: (identifier)` or `function: (field_expression field: (field_identifier))` |
| Identifier | `identifier` + `type_identifier` | `#eq?` predicate (search both!) |

---

## Java

| Construct | Node type | Name field |
|---|---|---|
| Program root | `program` | — |
| Class | `class_declaration` | `name: (identifier)` |
| Method | `method_declaration` inside `class_body` | `name: (identifier)` |
| Parameters | `formal_parameters` | — |
| Method call | `method_invocation` | `name: (identifier)` |
| Object creation | `object_creation_expression` | `type: (type_identifier)` |
| Identifier | `identifier` + `type_identifier` | `#eq?` predicate (search both!) |

---

## Adding a new language

1. Find the grammar: search PyPI for `tree-sitter-LANG`
2. Use the discovery script above to map your file's constructs
3. Copy `src/codetree/languages/_template.py` → fill in the TODOs
4. Register in `registry.py`
5. Write tests in `tests/languages/test_LANG.py`
