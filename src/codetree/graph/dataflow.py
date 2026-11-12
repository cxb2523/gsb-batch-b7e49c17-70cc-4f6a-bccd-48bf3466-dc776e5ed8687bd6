"""Intra-function dataflow and taint analysis using tree-sitter AST."""

import re
from ..languages.base import LanguagePlugin

# Known taint sources — method calls that return external/untrusted data
TAINT_SOURCES = {
    "request.get", "request.form", "request.args", "request.json",
    "request.data", "request.values", "request.files",
    "input", "raw_input",
    "sys.stdin.read", "sys.stdin.readline",
    "os.environ.get", "os.environ",
    "open", "read", "readline", "readlines",
}

# Known sinks — calls where tainted data is dangerous
TAINT_SINKS = {
    "db.execute", "cursor.execute", "connection.execute",
    "os.system", "os.popen",
    "subprocess.run", "subprocess.call", "subprocess.Popen", "subprocess.check_output",
    "eval", "exec", "compile",
    "open().write", "write",
}

# Known sanitizers — calls that make data safe
SANITIZERS = {
    "sanitize", "escape", "html.escape", "markupsafe.escape",
    "bleach.clean", "urllib.parse.quote",
    "parameterize", "quote", "sanitize_input",
    "int", "float", "bool",  # type casting is a form of sanitization
}


# Function-like AST node types across the languages we support.
_FUNCTION_NODE_TYPES = {
    "function_definition",      # Python, C, C++
    "function_declaration",     # JS, Go, Kotlin
    "method_definition",        # JS
    "method_declaration",       # Java, Go
    "method",                   # Ruby
    "singleton_method",         # Ruby
    "function_item",            # Rust
    "fun",                      # Kotlin (older grammar)
}

# AST node types that hold a parameter list.
_PARAM_CONTAINER_TYPES = {
    "parameters", "formal_parameters", "parameter_list",
    "method_parameters", "function_value_parameters", "parameter_clause",
    "function_parameters",
}

# AST nodes that are plain names rather than types.
_NAME_NODE_TYPES = {
    "identifier", "property_identifier", "field_identifier",
    "simple_identifier", "shorthand_property_identifier",
}

# AST node types for function calls.
_CALL_NODE_TYPES = {
    "call", "call_expression", "method_invocation",
    "function_call", "function_call_expression",
}

# Wrapper nodes that can contain the actual name inside a declarator.
_DECLARATOR_NODE_TYPES = {
    "pointer_declarator", "reference_declarator", "parenthesized_declarator",
    "array_declarator", "function_declarator", "init_declarator",
}

_ARGUMENT_CONTAINER_TYPES = {"argument_list", "arguments", "arguments_list",
                             "value_arguments"}


def extract_dataflow(plugin: LanguagePlugin, source: bytes, fn_name: str,
                     seed_vars: set[str] | None = None) -> dict | None:
    """Extract intra-function variable dataflow from AST.

    Args:
        seed_vars: extra names treated as already known (e.g. parameters
            seeded by a caller in cross-function analysis). These are not
            added to ``variables``; they only let dependency edges point at
            parameters, so assignments like ``q = f"...{data}"`` depend on
            the parameter ``data``.

    Returns:
        {
            "variables": [{"name", "line", "depends_on": [str], "source_expr": str}],
            "flow_chains": [[var1, var2, ...] ordered by dependency],
            "sources": [{"expr", "line", "kind"}],
            "sinks": [{"expr", "line", "kind"}],
        }
    """
    # Get function source
    result = plugin.extract_symbol_source(source, fn_name)
    if result is None:
        return None

    fn_source, start_line = result
    fn_bytes = fn_source.encode("utf-8", errors="replace")

    # Parse the function to walk assignments
    parser = plugin._get_parser()
    tree = parser.parse(fn_bytes)
    root = tree.root_node

    # Find the function body
    fn_body = _find_function_body(root, fn_name)
    if fn_body is None:
        # If we can't find the function in its own source, use root
        fn_body = root

    variables = []
    all_var_names = set(seed_vars or ())

    # Walk assignment nodes to build dependency graph
    _walk_assignments(fn_body, variables, all_var_names, start_line)

    # Identify sources and sinks from call expressions
    sources = []
    sinks = []
    _walk_calls(fn_body, sources, sinks, all_var_names, start_line)

    # Build flow chains (topological sort of dependencies)
    flow_chains = _build_flow_chains(variables)

    return {
        "variables": variables,
        "flow_chains": flow_chains,
        "sources": sources,
        "sinks": sinks,
    }


def extract_taint_paths(plugin: LanguagePlugin, source: bytes, fn_name: str) -> dict | None:
    """Analyze taint paths from sources to sinks.

    Returns:
        {
            "paths": [
                {"verdict": "SAFE"|"UNSAFE", "chain": [str], "sanitizer": str|None, "risk": str|None}
            ]
        }
    """
    flow = extract_dataflow(plugin, source, fn_name)
    if flow is None:
        return {"paths": []}

    # Build variable dependency map
    dep_map: dict[str, list[str]] = {}
    for v in flow["variables"]:
        dep_map[v["name"]] = v["depends_on"]

    # Build call map — which variables pass through which function calls
    call_map: dict[str, str] = {}  # var_name → call_expr that produces it
    for v in flow["variables"]:
        expr = v.get("source_expr", "")
        if "(" in expr:
            call_map[v["name"]] = expr

    paths = []

    # For each sink, trace backward to see if any taint source reaches it
    for sink in flow["sinks"]:
        sink_expr = sink["expr"]
        # Find variables used in the sink call
        sink_vars = _extract_identifiers_from_expr(sink_expr)

        for sv in sink_vars:
            # Trace backward through dependencies
            chain = _trace_backward(sv, dep_map, call_map)
            if not chain:
                continue

            # Check if any source in the chain is a taint source
            has_taint = False
            for var_name in chain:
                expr = call_map.get(var_name, "")
                for src in TAINT_SOURCES:
                    if src in expr:
                        has_taint = True
                        break
                if has_taint:
                    break

            if not has_taint:
                continue

            # Check if any sanitizer exists in the chain
            sanitizer = None
            for var_name in chain:
                expr = call_map.get(var_name, "")
                for san in SANITIZERS:
                    if san in expr:
                        sanitizer = san
                        break
                if sanitizer:
                    break

            chain_strs = chain + [sink_expr]
            if sanitizer:
                paths.append({
                    "verdict": "SAFE",
                    "chain": chain_strs,
                    "sanitizer": sanitizer,
                    "risk": None,
                })
            else:
                # Determine risk type
                risk = _risk_for_sink(sink_expr)

                paths.append({
                    "verdict": "UNSAFE",
                    "chain": chain_strs,
                    "sanitizer": None,
                    "risk": risk,
                })

    return {"paths": paths}


def extract_cross_function_taint(indexer, file_path: str, fn_name: str,
                                  depth: int = 3) -> dict:
    """Trace taint paths across function call boundaries.

    Unlike a textual ``callee(var`` scan, this binds each *actual* argument
    at a call site to the corresponding *formal* parameter of the callee, so
    renamed parameters, multiple arguments, nested calls and chained passing
    are tracked by position rather than by name coincidence.

    Args:
        indexer: Indexer instance with file index
        file_path: starting file
        fn_name: starting function name
        depth: max cross-function depth (default 3). ``depth=0`` analyzes
            only the entry function and never enters a callee.

    Returns:
        {
            "entry": "file::function",
            "paths": [{"verdict", "chain", "functions", "sanitizer", "risk"}],
            "depth_reached": int,
        }

    ``functions`` lists the ``file::function`` keys a path passed through
    (in order), and ``depth_reached`` is the deepest cross-function hop
    reached (0 = entry function only).
    """
    entry_key = f"{file_path}::{fn_name}"
    entry = indexer._index.get(file_path)
    if entry is None:
        return {"entry": entry_key, "paths": [], "depth_reached": 0}

    max_depth = max(0, int(depth))
    all_paths: list[dict] = []
    depth_reached = 0
    definitions = _collect_function_definitions(indexer)
    param_cache: dict[tuple[str, str], list[tuple[str, bool]]] = {}

    def _trace(fp: str, fn: str, cur_depth: int, chain_prefix: list[str],
               funcs_prefix: list[str], seeded_taint: dict[str, str | None],
               seeded_sanitized: dict[str, str | None],
               path_fns: frozenset[str]):
        nonlocal depth_reached
        if cur_depth > max_depth:
            return
        e = indexer._index.get(fp)
        if e is None:
            return

        fn_key = f"{fp}::{fn}"
        # Skip re-entering a function already on this path (cycles/recursion),
        # but let a sibling caller reach the same callee and report its own
        # chain.
        if fn_key in path_fns:
            return
        path_fns = path_fns | {fn_key}
        depth_reached = max(depth_reached, cur_depth)

        analysis = _analyze_function_seeded(
            e.plugin, e.source, fn, seeded_taint, seeded_sanitized
        )
        if analysis is None:
            return

        funcs_here = funcs_prefix + [fn_key]

        # 1. Local sinks reachable from taint (including seeded parameters).
        for path in analysis["local_paths"]:
            all_paths.append({
                "verdict": path["verdict"],
                "chain": chain_prefix + path["chain"],
                "functions": list(funcs_here),
                "sanitizer": path["sanitizer"],
                "risk": path["risk"],
            })

        # 2. Follow tainted arguments into callees.
        if cur_depth >= max_depth:
            return

        for call in analysis["calls"]:
            callee = call["callee"]
            if not callee or _is_known_call(call["expr"]):
                continue

            candidates = definitions.get(callee)
            if not candidates:
                continue

            same_file = [c for c in candidates if c == fp]
            # Prefer the definition in the calling file; same-named functions
            # elsewhere are only considered when nothing local matches.
            for candidate in (same_file or candidates):
                params = param_cache.get((candidate, callee))
                if params is None:
                    params = _callee_parameters(indexer, candidate, callee)
                    param_cache[(candidate, callee)] = params
                if not params:
                    continue

                child_taint: dict[str, str | None] = {}
                child_sanitized: dict[str, str | None] = {}
                for arg in call["args"]:
                    if arg["state"] == "clean":
                        continue
                    param_name = _bind_argument(arg, params)
                    if param_name is None:
                        continue
                    if arg["state"] == "tainted":
                        child_taint[param_name] = None
                    else:
                        child_sanitized[param_name] = arg["sanitizer"]

                if not child_taint and not child_sanitized:
                    continue

                hop = f"{fn}() → {callee}({call['arg_text']})"
                _trace(
                    candidate, callee, cur_depth + 1,
                    chain_prefix + [hop],
                    funcs_here,
                    child_taint, child_sanitized,
                    path_fns,
                )

    _trace(file_path, fn_name, 0, [], [], {}, {}, frozenset())

    # Collapse duplicate paths produced by multiple equivalent call sites.
    unique_paths = []
    seen_paths = set()
    for path in all_paths:
        key = (path["verdict"], tuple(path["chain"]), tuple(path["functions"]),
               path["sanitizer"], path["risk"])
        if key in seen_paths:
            continue
        seen_paths.add(key)
        unique_paths.append(path)

    return {
        "entry": entry_key,
        "paths": unique_paths,
        "depth_reached": depth_reached,
    }


# ─── Cross-function helpers ─────────────────────────────────────────────────


def _node_text(node) -> str:
    return node.text.decode("utf-8", errors="replace") if node.text else ""


def _is_name_node(node) -> bool:
    return node.type in _NAME_NODE_TYPES


def _last_name(node) -> str | None:
    """Rightmost plain-name descendant — the called symbol in ``a.b.c(...)``."""
    if node is None:
        return None
    if _is_name_node(node):
        return _node_text(node)
    for child in reversed(node.named_children):
        if _is_name_node(child):
            return _node_text(child)
        if child.type in _ARGUMENT_CONTAINER_TYPES:
            continue
        name = _last_name(child)
        if name:
            return name
    return None


def _call_parts(call_node):
    """Return (callee_name, callee_expr, arguments_node) for a call node."""
    fn_node = call_node.child_by_field_name("function")
    if fn_node is None:
        # Java method_invocation / Ruby call expose method/name instead.
        fn_node = call_node.child_by_field_name("method")
    if fn_node is None:
        fn_node = call_node.child_by_field_name("name")

    args = call_node.child_by_field_name("arguments")
    if args is None:
        for child in call_node.named_children:
            if child.type in _ARGUMENT_CONTAINER_TYPES:
                args = child
                break

    if fn_node is not None:
        callee = _last_name(fn_node)
        callee_expr = _node_text(fn_node)
        return callee, callee_expr, args

    # Fallback: first named child that looks like a callable expression.
    named = call_node.named_children
    if named:
        callee = _last_name(named[0])
        return callee, _node_text(named[0]), args
    return None, "", args


def _is_call_node(node) -> bool:
    return node.type in _CALL_NODE_TYPES


def _iter_calls(root):
    for n in _walk_tree(root):
        if _is_call_node(n):
            yield n


_SANITIZER_ALT = "|".join(re.escape(s) for s in sorted(SANITIZERS, key=len, reverse=True))
# Match a call to a sanitizer, bare or dotted (int(...), html.escape(...)).
_SANITIZER_CALL_RE = re.compile(r"(?<![\w])(?:%s)\s*\(" % _SANITIZER_ALT)
_SOURCE_RE = re.compile(
    r"(?<![\w])(?:%s)\b" % "|".join(
        re.escape(s) for s in sorted(TAINT_SOURCES, key=len, reverse=True)
    )
)


def _expr_has_source(expr: str) -> bool:
    return bool(_SOURCE_RE.search(expr))


def _sanitizer_token(expr: str) -> str | None:
    """First sanitizer call name appearing in an expression string."""
    for match in _SANITIZER_CALL_RE.finditer(expr):
        name = match.group(0).rsplit("(", 1)[0].strip()
        if name:
            return name
    return None


def _is_sanitizer_call(node) -> bool:
    if not _is_call_node(node):
        return False
    callee, callee_expr, _ = _call_parts(node)
    for candidate in (callee, callee_expr):
        if not candidate:
            continue
        if candidate in SANITIZERS:
            return True
        if any(candidate.endswith("." + san) for san in SANITIZERS):
            return True
    return False


def _is_source_call(node) -> bool:
    if not _is_call_node(node):
        return False
    callee, callee_expr, _ = _call_parts(node)
    for candidate in (callee, callee_expr):
        if not candidate:
            continue
        if candidate in TAINT_SOURCES:
            return True
        if any(candidate.endswith("." + src) or src.endswith("." + candidate)
               for src in TAINT_SOURCES if "." in src):
            return True
    return False


def _subtree_has_source_call(node) -> bool:
    return any(_is_source_call(n) for n in _walk_tree(node))


def _first_sanitizer_call(node):
    """First sanitizer call inside an expression, or None."""
    for n in _walk_tree(node):
        if _is_sanitizer_call(n):
            return n
    return None


def _is_within(node, container) -> bool:
    """True if ``node`` is ``container`` or nested inside it."""
    return (node.start_byte >= container.start_byte
            and node.end_byte <= container.end_byte)


def _identifiers_outside_sanitizers(node) -> set[str]:
    names: set[str] = set()

    def walk(n):
        if _is_sanitizer_call(n):
            return
        if _is_name_node(n):
            names.add(_node_text(n))
        for child in n.named_children:
            walk(child)

    walk(node)
    return names


def _has_source_call_outside_sanitizer(node) -> bool:
    for n in _walk_tree(node):
        if not _is_source_call(n):
            continue
        san = _first_sanitizer_call(node)
        if san is None or not _is_within(n, san):
            return True
    return False


def _identifiers_in(node) -> set[str]:
    """All plain names appearing anywhere in an expression."""
    names: set[str] = set()

    def walk(n):
        if _is_name_node(n):
            names.add(_node_text(n))
        for child in n.named_children:
            walk(child)

    walk(node)
    return names


def _classify_expr(node, status: dict[str, str],
                   sanitizer_of: dict[str, str]) -> tuple[str, str | None]:
    """Classify an expression as clean / tainted / sanitized.

    Only a sanitizer call wrapping the tainted operands makes the expression
    sanitized. Anything tainted left outside that wrapper (another argument,
    a ``+`` concatenation, a nested source call) keeps it tainted.
    """
    all_names = _identifiers_in(node)
    outside_names = _identifiers_outside_sanitizers(node)
    sanitizer_call = _first_sanitizer_call(node)

    tainted_outside = any(status.get(n) == "tainted" for n in outside_names)
    source_outside = _has_source_call_outside_sanitizer(node)

    if sanitizer_call is not None:
        if tainted_outside or source_outside:
            return "tainted", None
        callee, callee_expr, _ = _call_parts(sanitizer_call)
        san = callee if callee in SANITIZERS else callee_expr
        if not any(status.get(n) in ("tainted", "sanitized") for n in all_names) \
                and not _subtree_has_source_call(node):
            return "clean", None
        return "sanitized", san or "sanitizer"

    if tainted_outside or _subtree_has_source_call(node):
        return "tainted", None
    for n in all_names:
        if status.get(n) == "sanitized":
            return "sanitized", sanitizer_of.get(n) or "sanitizer"
    return "clean", None


def _collect_function_definitions(indexer) -> dict[str, list[str]]:
    """Map bare function/method name → list of files defining it."""
    definitions: dict[str, list[str]] = {}
    for fp, e in indexer._index.items():
        for item in e.skeleton:
            if item.get("type") not in ("function", "method"):
                continue
            name = item.get("name")
            if not name:
                continue
            definitions.setdefault(name, [])
            if fp not in definitions[name]:
                definitions[name].append(fp)
    return definitions


def _callee_parameters(indexer, file_path: str,
                       fn_name: str) -> list[tuple[str, bool]]:
    """Return ordered ``(param_name, is_splat)`` pairs for a callee."""
    e = indexer._index.get(file_path)
    if e is None:
        return []
    result = e.plugin.extract_symbol_source(e.source, fn_name)
    if result is None:
        return []
    fn_source, _ = result
    tree = e.plugin._get_parser().parse(fn_source.encode("utf-8", errors="replace"))
    fn_node = _find_function_node(tree.root_node, fn_name)
    if fn_node is None:
        return []
    return _parameter_names(fn_node)


_RECEIVER_LIKE_PARAMS = {"self", "cls", "this"}


def _parameter_names(fn_node) -> list[tuple[str, bool]]:
    params_node = None
    for child in fn_node.named_children:
        if child.type in _PARAM_CONTAINER_TYPES:
            params_node = child
            break
    if params_node is None:
        return []

    params: list[tuple[str, bool]] = []
    for child in params_node.named_children:
        name = _parameter_name(child)
        if not name:
            continue
        splat = child.type in (
            "list_splat_pattern", "dictionary_splat_pattern",
            "rest_pattern", "variadic_parameter", "spread_parameter",
        ) or _node_text(child).lstrip().startswith(("*", "**"))
        params.append((name, splat))

    # Drop an implicit receiver parameter (self/cls/this) so positional
    # arguments align with the parameters written at the call site.
    if params and params[0][0] in _RECEIVER_LIKE_PARAMS:
        params = params[1:]
    return params


def _parameter_name(node) -> str | None:
    if _is_name_node(node):
        return _node_text(node)

    name_node = node.child_by_field_name("name")
    if name_node is not None and _is_name_node(name_node):
        return _node_text(name_node)

    # C/C++/Go parameters name the variable via a declarator:
    #   char *a  →  parameter_declaration(declarator=pointer_declarator(identifier))
    declarator = node.child_by_field_name("declarator")
    if declarator is not None:
        nested = _declarator_name(declarator)
        if nested:
            return nested

    for child in node.named_children:
        if _is_name_node(child):
            return _node_text(child)
        if child.type in ("list_splat_pattern", "dictionary_splat_pattern", "rest_pattern"):
            nested = _parameter_name(child)
            if nested:
                return nested
        if child.type in _DECLARATOR_NODE_TYPES:
            nested = _parameter_name(child)
            if nested:
                return nested
    return None


def _bind_argument(arg: dict, params: list[tuple[str, bool]]) -> str | None:
    """Map one actual argument to the callee's formal parameter name."""
    keyword = arg.get("keyword")
    if keyword:
        for name, _splat in params:
            if name == keyword:
                return name
        return None

    index = arg.get("position")
    if index is None:
        return None
    # Positional binding, expanding a *args parameter for the tail.
    splat_name = None
    for i, (name, splat) in enumerate(params):
        if splat:
            splat_name = name if name else splat_name
            if i <= index:
                return splat_name
        if i == index:
            return name
    return splat_name


_KEYWORD_ARGUMENT_TYPES = {"keyword_argument", "named_argument", "pair",
                           "named_pair", "value_argument"}


def _keyword_parts(node):
    """Return (keyword, value_node) when the argument is keyword-style."""
    if node.type not in _KEYWORD_ARGUMENT_TYPES:
        return None, None

    name_node = node.child_by_field_name("name")
    if name_node is None:
        name_node = node.child_by_field_name("key")
    value_node = node.child_by_field_name("value")

    if value_node is not None and name_node is not None:
        return _node_text(name_node), value_node

    if node.type == "value_argument" and value_node is None:
        # Kotlin: value_argument `query = bad` carries no name/value fields.
        # Require a direct `=` token so `f(a == b)` is not mistaken for one.
        has_eq = any(c.type == "=" for c in node.children)
        named = node.named_children
        if has_eq and len(named) >= 2:
            return _node_text(named[0]), named[-1]

    return None, value_node


def _call_arguments(args_node) -> list[dict]:
    """Flatten a call's arguments into positional/keyword descriptors."""
    if args_node is None:
        return []

    result: list[dict] = []
    positional = 0
    for node in args_node.named_children:
        if node.type == "comment":
            continue

        keyword, value_node = _keyword_parts(node)
        if value_node is None:
            value_node = node

        text = _node_text(value_node)
        if keyword:
            text = f"{keyword}={text}"
        result.append({
            "node": value_node,
            "keyword": keyword,
            "position": None if keyword else positional,
            "text": text,
        })
        if keyword is None:
            positional += 1
    return result


def _is_known_call(callee_expr: str) -> bool:
    """True for built-in sinks/sources/sanitizers we should not follow into."""
    if not callee_expr:
        return True
    bare = callee_expr.rsplit(".", 1)[-1].strip()

    known = set(TAINT_SINKS) | set(TAINT_SOURCES) | set(SANITIZERS)
    for name in known:
        if callee_expr == name:
            return True
        if "." in name and (callee_expr == name or callee_expr.endswith("." + name)):
            return True
        if "." not in name and callee_expr.endswith("." + name):
            return True
    # Bare builtin sink/sanitizer names that we never want to "follow into".
    if bare in {"eval", "exec", "compile", "write", "execute",
                "system", "popen", "read", "open"}:
        return True
    return False


def _risk_for_sink(sink_expr: str) -> str:
    if "execute" in sink_expr:
        return "SQL injection"
    if "system" in sink_expr or "popen" in sink_expr or "subprocess" in sink_expr:
        return "Command injection"
    if "eval" in sink_expr or "exec" in sink_expr or "compile" in sink_expr:
        return "Code injection"
    return "unknown"


def _analyze_function_seeded(plugin: LanguagePlugin, source: bytes, fn_name: str,
                             seeded_taint: dict[str, str | None],
                             seeded_sanitized: dict[str, str | None]) -> dict | None:
    """Analyze one function with caller-provided tainted parameter names.

    Returns local sink paths, taint status per local variable, and call
    sites annotated with the taint state of each actual argument.
    """
    seed_vars = set(seeded_taint) | set(seeded_sanitized)
    flow = extract_dataflow(plugin, source, fn_name, seed_vars=seed_vars)
    if flow is None:
        return None

    result = plugin.extract_symbol_source(source, fn_name)
    if result is None:
        return None
    fn_source, start_line = result
    tree = plugin._get_parser().parse(fn_source.encode("utf-8", errors="replace"))
    fn_node = _find_function_node(tree.root_node, fn_name)
    body = _function_body(fn_node) if fn_node is not None else tree.root_node

    status: dict[str, str] = {}
    sanitizer_of: dict[str, str] = {}
    for name in seeded_taint:
        status[name] = "tainted"
    for name, san in seeded_sanitized.items():
        status[name] = "sanitized"
        sanitizer_of[name] = san or "sanitizer"

    dep_map: dict[str, list[str]] = {}
    call_map: dict[str, str] = {}
    for v in flow["variables"]:
        dep_map[v["name"]] = v["depends_on"]
        if "(" in v.get("source_expr", ""):
            call_map[v["name"]] = v["source_expr"]

    # Fixpoint over assignments: origin matters (tainted vs clean) and a
    # sanitizer call (directly, or inherited from a sanitized dependency)
    # downgrades the tainted origin to "sanitized".
    for _ in range(len(flow["variables"]) + 2):
        changed = False
        for v in flow["variables"]:
            name = v["name"]
            expr = v.get("source_expr", "")
            deps = v["depends_on"]

            has_origin = _expr_has_source(expr) or any(
                status.get(d) in ("tainted", "sanitized") for d in deps
            )
            if not has_origin:
                continue

            direct_san = _sanitizer_token(expr)
            inherited_san = None
            inherited_tainted = False
            for d in deps:
                if status.get(d) == "tainted":
                    inherited_tainted = True
                elif status.get(d) == "sanitized" and inherited_san is None:
                    inherited_san = sanitizer_of.get(d)

            if direct_san:
                new_status, new_san = "sanitized", direct_san
            elif inherited_san and not inherited_tainted and not _expr_has_source(expr):
                new_status, new_san = "sanitized", inherited_san
            else:
                new_status, new_san = "tainted", None

            if status.get(name) != new_status or (new_san and sanitizer_of.get(name) != new_san):
                status[name] = new_status
                if new_san:
                    sanitizer_of[name] = new_san
                else:
                    sanitizer_of.pop(name, None)
                changed = True

        if not changed:
            break

    # Local sink paths.
    local_paths = []
    seen_local = set()
    for sink in flow["sinks"]:
        sink_expr = sink["expr"]
        for sv in _extract_identifiers_from_expr(sink_expr):
            st = status.get(sv)
            if st not in ("tainted", "sanitized"):
                continue
            chain = _trace_backward(sv, dep_map, call_map)
            if not chain:
                continue
            chain = chain + [sink_expr]
            verdict = "SAFE" if st == "sanitized" else "UNSAFE"
            sanitizer = sanitizer_of.get(sv) if st == "sanitized" else None
            risk = None if st == "sanitized" else _risk_for_sink(sink_expr)
            key = (verdict, tuple(chain), sanitizer, risk)
            if key in seen_local:
                continue
            seen_local.add(key)
            local_paths.append({
                "verdict": verdict,
                "chain": chain,
                "sanitizer": sanitizer,
                "risk": risk,
            })

    # Call sites with taint-annotated arguments.
    calls = []
    for call_node in _iter_calls(body):
        callee, callee_expr, args_node = _call_parts(call_node)
        if not callee:
            continue
        annotated_args = []
        for arg in _call_arguments(args_node):
            state, san = _classify_expr(arg["node"], status, sanitizer_of)
            if state == "clean":
                continue
            annotated_args.append({
                "keyword": arg["keyword"],
                "position": arg["position"],
                "state": state,
                "sanitizer": san,
                "text": arg["text"],
            })
        if not annotated_args:
            continue
        calls.append({
            "callee": callee,
            "expr": callee_expr,
            "args": annotated_args,
            "arg_text": ", ".join(a["text"] for a in annotated_args),
        })

    return {
        "local_paths": local_paths,
        "calls": calls,
    }


_BODY_NODE_TYPES = {
    "block", "statement_block", "compound_statement", "body_statement",
    "declaration_list", "field_declaration_list", "function_body",
}


def _find_function_node(root, fn_name: str):
    """Find the function-like node named ``fn_name`` in ``root``."""
    for node in _walk_tree(root):
        node_type = node.type
        if node_type == "decorated_definition":
            inner = None
            for child in node.named_children:
                if child.type in _FUNCTION_NODE_TYPES:
                    inner = child
                    break
            if inner is not None and _node_name(inner) == fn_name:
                return inner
            continue
        if node_type not in _FUNCTION_NODE_TYPES:
            continue
        if _node_name(node) == fn_name:
            return node
    return None


def _node_name(node) -> str | None:
    """Name of a function-like node, unwrapping declarators."""
    name_node = node.child_by_field_name("name")
    if name_node is not None and _is_name_node(name_node):
        return _node_text(name_node)
    if name_node is not None:
        # C/C++: name lives inside a function_declarator.
        nested = _declarator_name(name_node)
        if nested:
            return nested
    for child in node.named_children:
        if child.type in _DECLARATOR_NODE_TYPES:
            nested = _declarator_name(child)
            if nested:
                return nested
        if _is_name_node(child):
            return _node_text(child)
    return None


def _declarator_name(node) -> str | None:
    for n in _walk_tree(node):
        if _is_name_node(n):
            return _node_text(n)
    return None


def _function_body(fn_node):
    if fn_node is None:
        return None
    body = fn_node.child_by_field_name("body")
    if body is not None:
        return body
    for child in fn_node.named_children:
        if child.type in _BODY_NODE_TYPES:
            return child
    # Ruby method body is an implicit statements node.
    for child in fn_node.named_children:
        if child.type in ("statements", "block_body"):
            return child
    return fn_node


def _find_function_body(root, fn_name: str):
    """Find the body node of a function by name."""
    fn_node = _find_function_node(root, fn_name)
    if fn_node is None:
        return None
    return _function_body(fn_node)


def _walk_tree(node):
    """Depth-first walk of all nodes."""
    yield node
    for child in node.children:
        yield from _walk_tree(child)


def _walk_assignments(node, variables: list, all_var_names: set, line_offset: int):
    """Walk AST to find assignments and their dependencies."""
    for n in _walk_tree(node):
        # Python/Ruby/JS: assignment node
        if n.type == "assignment":
            left = None
            right = None
            for child in n.children:
                if child.type == "identifier" and left is None:
                    left = child
                elif child.type == "=" or child.type == "assignment_operator":
                    continue
                elif left is not None and right is None:
                    right = child

            if left and right:
                var_name = left.text.decode("utf-8", errors="replace")
                if var_name in ("self", "cls"):
                    continue
                all_var_names.add(var_name)
                rhs_text = right.text.decode("utf-8", errors="replace") if right.text else ""
                deps = _extract_identifiers_from_node(right, all_var_names)
                line = (left.start_point[0] + line_offset) if hasattr(left, 'start_point') else 0

                variables.append({
                    "name": var_name,
                    "line": line,
                    "depends_on": list(deps),
                    "source_expr": rhs_text,
                })

        # C/C++: declaration with init_declarator
        elif n.type == "declaration":
            for child in n.children:
                if child.type == "init_declarator":
                    id_node = None
                    rhs_node = None
                    saw_eq = False
                    for sub in child.children:
                        if sub.type == "identifier" and id_node is None:
                            id_node = sub
                        elif sub.type == "=":
                            saw_eq = True
                        elif saw_eq and rhs_node is None:
                            rhs_node = sub
                    if id_node:
                        var_name = id_node.text.decode("utf-8", errors="replace")
                        all_var_names.add(var_name)
                        rhs_text = rhs_node.text.decode("utf-8", errors="replace") if rhs_node and rhs_node.text else ""
                        deps = _extract_identifiers_from_node(rhs_node, all_var_names) if rhs_node else set()
                        line = (id_node.start_point[0] + line_offset) if hasattr(id_node, 'start_point') else 0
                        variables.append({
                            "name": var_name,
                            "line": line,
                            "depends_on": list(deps),
                            "source_expr": rhs_text,
                        })

        # JS/TS: lexical_declaration (const/let) or variable_declaration (var)
        elif n.type in ("lexical_declaration", "variable_declaration"):
            for child in n.children:
                if child.type == "variable_declarator":
                    _extract_declarator(child, variables, all_var_names, line_offset)

        # Go: short_var_declaration (x := expr)
        elif n.type == "short_var_declaration":
            lhs_list = None
            rhs_list = None
            saw_assign = False
            for child in n.children:
                if child.type == "expression_list" and not saw_assign:
                    lhs_list = child
                elif child.type == ":=":
                    saw_assign = True
                elif child.type == "expression_list" and saw_assign:
                    rhs_list = child
            if lhs_list:
                for id_node in lhs_list.children:
                    if id_node.type == "identifier":
                        var_name = id_node.text.decode("utf-8", errors="replace")
                        if var_name == "_":
                            continue
                        all_var_names.add(var_name)
                        rhs_text = rhs_list.text.decode("utf-8", errors="replace") if rhs_list and rhs_list.text else ""
                        deps = _extract_identifiers_from_node(rhs_list, all_var_names) if rhs_list else set()
                        line = (id_node.start_point[0] + line_offset) if hasattr(id_node, 'start_point') else 0
                        variables.append({
                            "name": var_name,
                            "line": line,
                            "depends_on": list(deps),
                            "source_expr": rhs_text,
                        })

        # Rust: let_declaration (let x = expr; or let x: Type = expr;)
        elif n.type == "let_declaration":
            id_node = None
            rhs_node = None
            saw_eq = False
            for child in n.children:
                if child.type == "identifier" and id_node is None:
                    id_node = child
                elif child.type == "=":
                    saw_eq = True
                elif saw_eq and rhs_node is None and child.type != ";":
                    rhs_node = child
            if id_node:
                var_name = id_node.text.decode("utf-8", errors="replace")
                all_var_names.add(var_name)
                rhs_text = rhs_node.text.decode("utf-8", errors="replace") if rhs_node and rhs_node.text else ""
                deps = _extract_identifiers_from_node(rhs_node, all_var_names) if rhs_node else set()
                line = (id_node.start_point[0] + line_offset) if hasattr(id_node, 'start_point') else 0
                variables.append({
                    "name": var_name,
                    "line": line,
                    "depends_on": list(deps),
                    "source_expr": rhs_text,
                })

        # Java: local_variable_declaration
        elif n.type == "local_variable_declaration":
            for child in n.children:
                if child.type == "variable_declarator":
                    _extract_declarator(child, variables, all_var_names, line_offset)

        # Kotlin: property_declaration (val/var x = expr)
        elif n.type == "property_declaration":
            id_node = None
            rhs_node = None
            saw_eq = False
            for child in n.children:
                if not saw_eq and id_node is None and child.type == "variable_declaration":
                    for sub in child.named_children:
                        if sub.type == "identifier":
                            id_node = sub
                            break
                elif child.type == "=":
                    saw_eq = True
                elif saw_eq and rhs_node is None:
                    rhs_node = child
            if id_node is not None and rhs_node is not None:
                var_name = None
                if id_node.text:
                    var_name = id_node.text.decode("utf-8", errors="replace")
                if var_name:
                    all_var_names.add(var_name)
                    rhs_text = (rhs_node.text.decode("utf-8", errors="replace")
                                if rhs_node.text else "")
                    deps = _extract_identifiers_from_node(rhs_node, all_var_names)
                    line = (id_node.start_point[0] + line_offset
                            if hasattr(id_node, 'start_point') else 0)
                    variables.append({
                        "name": var_name,
                        "line": line,
                        "depends_on": list(deps),
                        "source_expr": rhs_text,
                    })



def _extract_declarator(node, variables: list, all_var_names: set, line_offset: int):
    """Extract variable from a variable_declarator node (JS/TS/Java pattern)."""
    id_node = None
    rhs_node = None
    saw_eq = False
    for child in node.children:
        if child.type == "identifier" and id_node is None:
            id_node = child
        elif child.type == "=":
            saw_eq = True
        elif saw_eq and rhs_node is None:
            rhs_node = child
    if id_node:
        var_name = id_node.text.decode("utf-8", errors="replace")
        all_var_names.add(var_name)
        rhs_text = rhs_node.text.decode("utf-8", errors="replace") if rhs_node and rhs_node.text else ""
        deps = _extract_identifiers_from_node(rhs_node, all_var_names) if rhs_node else set()
        line = (id_node.start_point[0] + line_offset) if hasattr(id_node, 'start_point') else 0
        variables.append({
            "name": var_name,
            "line": line,
            "depends_on": list(deps),
            "source_expr": rhs_text,
        })


def _extract_identifiers_from_node(node, known_vars: set) -> set[str]:
    """Extract identifier names from an AST node that match known variables."""
    ids = set()
    for n in _walk_tree(node):
        if n.type == "identifier" and n.text:
            name = n.text.decode("utf-8", errors="replace")
            if name in known_vars:
                ids.add(name)
    return ids


def _extract_identifiers_from_expr(expr: str) -> list[str]:
    """Simple text-based identifier extraction from an expression string."""
    return re.findall(r'\b([a-zA-Z_]\w*)\b', expr)


def _walk_calls(node, sources: list, sinks: list, var_names: set, line_offset: int):
    """Find function calls that are taint sources or sinks."""
    for n in _walk_tree(node):
        if n.type == "call" or n.type == "call_expression":
            call_text = n.text.decode("utf-8", errors="replace") if n.text else ""
            line = (n.start_point[0] + line_offset) if hasattr(n, 'start_point') else 0

            # Check if it's a known source
            for src in TAINT_SOURCES:
                if src in call_text:
                    sources.append({"expr": call_text, "line": line, "kind": "external_input"})
                    break

            # Check if it's a known sink
            for sink in TAINT_SINKS:
                if sink in call_text:
                    sinks.append({"expr": call_text, "line": line, "kind": _sink_kind(sink)})
                    break


def _sink_kind(sink_name: str) -> str:
    if "execute" in sink_name:
        return "database"
    if "system" in sink_name or "subprocess" in sink_name:
        return "shell"
    if "eval" in sink_name or "exec" in sink_name:
        return "code_execution"
    return "output"


def _build_flow_chains(variables: list) -> list[list[str]]:
    """Build ordered flow chains from variable dependencies."""
    chains = []
    visited = set()

    for v in variables:
        if v["name"] in visited:
            continue
        chain = _trace_forward(v["name"], variables, visited)
        if len(chain) > 1:
            chains.append(chain)

    return chains


def _trace_forward(start: str, variables: list, visited: set) -> list[str]:
    """Trace forward from a variable through its dependents."""
    chain = [start]
    visited.add(start)
    # Find variables that depend on start
    for v in variables:
        if start in v["depends_on"] and v["name"] not in visited:
            chain.extend(_trace_forward(v["name"], variables, visited))
    return chain


def _trace_backward(var_name: str, dep_map: dict, call_map: dict,
                    visited: set | None = None, max_depth: int = 20) -> list[str]:
    """Trace backward from a variable to its origins."""
    if visited is None:
        visited = set()
    if var_name in visited or max_depth <= 0:
        return []
    visited.add(var_name)

    deps = dep_map.get(var_name, [])
    if not deps:
        return [var_name]

    chain = []
    for dep in deps:
        sub_chain = _trace_backward(dep, dep_map, call_map, visited, max_depth - 1)
        chain.extend(sub_chain)
    chain.append(var_name)
    return chain
