"""
Fast checks on the scaffold template. No dbt, no network.

Every assertion here is a regression guard for something that actually shipped
broken -- see the docstrings.
"""

import ast
import importlib.metadata
import pathlib
import re
import types

import pytest
import yaml

from datavloot_platform import cli

TEMPLATES = {"scaffold": "probe_platform", "demo": "noaa_platform"}


def test_placeholders_are_substituted(scaffold: pathlib.Path):
    """No <project_name> or project_platform token survives `datavloot new`."""
    leftovers = []
    for f in scaffold.rglob("*"):
        if not f.is_file():
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue
        if any(token in text for token in ("<project_name>", "project_platform", *cli._versions())):
            leftovers.append(f.relative_to(scaffold).as_posix())
    assert leftovers == [], f"unsubstituted placeholders in: {leftovers}"

    assert (scaffold / "probe_platform").is_dir(), "module dir was not renamed"


@pytest.mark.parametrize("template", TEMPLATES)
def test_toolkit_and_dbt_package_are_pinned(tmp_path: pathlib.Path, template: str):
    """
    A new project pins the toolkit to its release and the dbt package to the one it was tested with.

    The scaffold listed `datavloot[optimist]` without a version and followed the
    dbt package's `0.1.x` branch, so after a 0.2.0 a new project got the 0.2
    toolkit with the 0.1 macros, and a laptop got whatever was newest on install day.
    """
    dest = tmp_path / "project"
    cli._copy_template(cli.TEMPLATES_DIR / template, dest)
    cli._pin_versions(dest, cli._versions())

    # No tomllib before Python 3.11, and the project supports 3.10.
    pyproject = (dest / "pyproject.toml").read_text(encoding="utf-8")
    assert f'"datavloot[optimist]~={importlib.metadata.version("datavloot")}"' in pyproject

    packages = yaml.safe_load((dest / "packages.yml").read_text(encoding="utf-8"))["packages"]
    (optimist,) = [p for p in packages if p.get("name") == "optimist"]
    assert optimist == {
        "tarball": (
            "https://codeload.github.com/datavloot/dbt-datavloot-optimist/tar.gz/refs/tags/"
            + cli.DBT_PACKAGE_VERSION
        ),
        "name": "optimist",
    }


@pytest.mark.parametrize("template", TEMPLATES)
def test_dbt_deps_does_not_need_git(tmp_path: pathlib.Path, template: str):
    """
    No package in a new project is fetched with `git:`.

    `dbt deps` shells out to git for a `git:` package. A clean Windows laptop has
    no git, and on an older one installing it with winget can fail too, so the
    first `dbt deps` of a new project failed there. Hub packages and tarballs are
    downloaded over HTTPS by dbt itself.
    """
    dest = tmp_path / "project"
    cli._copy_template(cli.TEMPLATES_DIR / template, dest)
    packages = yaml.safe_load((dest / "packages.yml").read_text(encoding="utf-8"))["packages"]
    assert [p for p in packages if "git" in p] == []


@pytest.mark.parametrize("template", TEMPLATES)
def test_projects_install_elementary_in_step_with_its_cli(
    tmp_path: pathlib.Path, repo_root: pathlib.Path, template: str
):
    """
    The project declares Elementary, in the same range as the toolkit's `edr` CLI.

    The Crows Nest's Data quality and Catalog panels read Elementary's tables, and
    the templates configure `models: elementary`. Up to 0.1.0 the optimist dbt
    package pulled Elementary in; from 0.1.1 (dbt-datavloot-optimist) it does not.
    The dbt package and `elementary-data` in pyproject.toml are bounded alike, so
    the CLI never reads tables a different minor of the package wrote.
    """
    dest = tmp_path / "project"
    cli._copy_template(cli.TEMPLATES_DIR / template, dest)
    packages = yaml.safe_load((dest / "packages.yml").read_text(encoding="utf-8"))["packages"]
    (version,) = [p["version"] for p in packages if p.get("package") == "elementary-data/elementary"]

    pyproject = (repo_root / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r'"elementary-data\[duckdb\]>=([\d.]+),<([\d.]+)"', pyproject)
    assert match, "elementary-data is not bounded as >=X,<Y in pyproject.toml"
    floor, cap = (".".join((v.split(".") + ["0", "0"])[:3]) for v in match.groups())
    assert version == [f">={floor}", f"<{cap}"]


@pytest.mark.parametrize("doc", ["README.md", "docs/getting-started.md"])
def test_docs_show_the_pinned_dbt_package_release(repo_root: pathlib.Path, doc: str):
    """
    The `packages.yml` examples in the docs pin the release new projects get.

    Only `DBT_PACKAGE_VERSION` is bumped on a dbt package release; without this
    the examples would keep the old tag.
    """
    text = (repo_root / doc).read_text(encoding="utf-8")
    pins = re.findall(r'dbt-datavloot-optimist/tar\.gz/refs/tags/([^"\s]+)"', text)
    assert pins, f"{doc} shows no dbt-datavloot-optimist pin"
    assert set(pins) == {cli.DBT_PACKAGE_VERSION}


@pytest.mark.parametrize("target", ["dev", "prod"])
def test_profile_writes_to_the_lake_not_memory(scaffold: pathlib.Path, target: str):
    """
    The scaffold must persist to disk.

    It once shipped with `path: ":memory:"` and nothing attached, so `dbt run`
    reported tables built and left nothing behind -- a silent failure. The
    session database is still in memory, so what persists is the attached lake:
    dbt's `database` has to be that attach, or every model lands in memory again.
    """
    profile = yaml.safe_load((scaffold / "profiles.yml").read_text(encoding="utf-8"))
    output = profile["probe"]["outputs"][target]
    attaches = {a["alias"]: a for a in output.get("attach", [])}

    assert output["database"] in attaches, "dbt writes to the in-memory session, not the lake"
    lake = attaches[output["database"]]
    assert lake["path"].startswith("ducklake:sqlite:") and lake["path"].endswith("/catalog.sqlite")

    # The two options the lake does not work without (see storage.py): WAL, or
    # readers and writers lock each other out; the override, or a relative data
    # path follows the current directory.
    options = lake["options"]
    assert options["meta_journal_mode"] == "WAL"
    assert options["override_data_path"] is True


def test_dbt_by_hand_never_writes_to_production(scaffold: pathlib.Path):
    """
    A plain `dbt run` builds dev, into schemas apart from production's.

    The scaffold had a single `dev` target that wrote to the production
    schemas, so any manual run overwrote what Dagster had built. dbt prefixes
    every custom schema with the target schema, so distinct target schemas keep
    dev_business and probe_business apart -- in the same lake, which prod and
    dev both attach.
    """
    profile = yaml.safe_load((scaffold / "profiles.yml").read_text(encoding="utf-8"))["probe"]
    dev, prod = profile["outputs"]["dev"], profile["outputs"]["prod"]

    assert profile["target"] == "dev", "the default target must be dev, not production"
    assert prod["schema"] == "probe", "production schemas would no longer be <project>_*"
    assert dev["schema"] != prod["schema"]
    assert not dev["schema"].startswith(f"{prod['schema']}_"), (
        f"dev's schemas ({dev['schema']}_business) would read as production's"
    )
    assert dev["attach"] == prod["attach"] and dev["database"] == prod["database"], (
        "dev and prod must attach the same lake, or dev cannot read production sources"
    )


def test_crowsnest_reports_production_quality(scaffold: pathlib.Path, monkeypatch):
    """The Crows Nest shows Elementary results from prod, not from the default dev target."""
    from datavloot_platform.crowsnest import config

    monkeypatch.chdir(scaffold)
    assert config._infer_elementary_schema() == "probe_elementary"


def _platform_dir(template: str, scaffold: pathlib.Path) -> pathlib.Path:
    if template == "scaffold":
        return scaffold / TEMPLATES[template]
    return cli.TEMPLATES_DIR / template / TEMPLATES[template]


def _keyword(call: ast.Call, name: str):
    return next((kw.value for kw in call.keywords if kw.arg == name), None)


@pytest.mark.parametrize("template", TEMPLATES)
def test_dagster_builds_the_prod_target(scaffold: pathlib.Path, template: str):
    """Dagster is the production writer, so its dbt project uses prod, not the default dev."""
    tree = ast.parse((_platform_dir(template, scaffold) / "assets.py").read_text(encoding="utf-8"))
    projects = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "DbtProject"
    ]

    assert projects, "no DbtProject in assets.py"
    for project in projects:
        target = _keyword(project, "target")
        assert isinstance(target, ast.Constant) and target.value == "prod", (
            "DbtProject has no target='prod'; Dagster would build the dev schemas"
        )


@pytest.mark.parametrize("template", TEMPLATES)
def test_loading_the_code_does_not_reinstall_the_dbt_packages(scaffold: pathlib.Path, template: str):
    """
    Dagster does not run `dbt deps` when it loads the project's code.

    From dagster-dbt 0.29.8, prepare_if_dev runs `dbt deps` on every code load
    under `dagster dev`, and `dbt deps` first deletes dbt_packages/. When the
    code server and a run load at once, that fails on Windows with WinError 32,
    and every materialization fails with it. The installers, `new --from` and
    `update` run `dbt deps` themselves.
    """
    tree = ast.parse((_platform_dir(template, scaffold) / "assets.py").read_text(encoding="utf-8"))
    projects = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "DbtProject"
    ]

    assert projects, "no DbtProject in assets.py"
    for project in projects:
        install_deps = _keyword(project, "install_deps")
        assert isinstance(install_deps, ast.Constant) and install_deps.value is False, (
            "DbtProject has no install_deps=False; every code load would run dbt deps"
        )


@pytest.mark.parametrize("template", TEMPLATES)
def test_every_writing_asset_waits_its_turn(scaffold: pathlib.Path, template: str):
    """
    Writers to the lake take turns, enforced by Dagster.

    The lake accepts one commit at a time and refuses a second with "database
    is locked" instead of waiting. dagster.yaml limits each pool to one running
    asset, across runs and within a run; that only helps the assets in a pool.
    """
    instance = yaml.safe_load(
        (cli.TEMPLATES_DIR / template / "dagster.yaml").read_text(encoding="utf-8")
    )
    pools = instance["concurrency"]["pools"]
    assert pools["default_limit"] == 1
    assert pools["granularity"] == "op", "with run granularity, steps within one run still overlap"

    # Ops too: lake maintenance commits to the lake like any asset.
    decorators = [
        dec
        for module in sorted(_platform_dir(template, scaffold).glob("*.py"))
        for node in ast.walk(ast.parse(module.read_text(encoding="utf-8")))
        if isinstance(node, ast.FunctionDef)
        for dec in node.decorator_list
        if getattr(dec.func if isinstance(dec, ast.Call) else dec, "id", None)
        in {"asset", "multi_asset", "dbt_assets", "dlt_assets", "op"}
    ]

    assert decorators, "no assets found in the platform module"
    outside = [
        ast.unparse(dec) for dec in decorators
        if not isinstance(dec, ast.Call)
        or not (isinstance(_keyword(dec, "pool"), ast.Name) and _keyword(dec, "pool").id == "LAKE_POOL")
    ]
    assert outside == [], f"assets that write outside the lake pool: {outside}"


@pytest.mark.parametrize("template", TEMPLATES)
def test_a_run_loads_the_code_once(scaffold: pathlib.Path, template: str):
    """
    Every run executes its steps in its own process.

    With Dagster's default multiprocess executor each step started a process of
    its own that loaded the project's code again: on Windows about 48 seconds
    per step, against 3 to 25 seconds of real work. The lake pool lets one
    writer in at a time, so the extra processes bought no parallelism.
    """
    tree = ast.parse((_platform_dir(template, scaffold) / "definitions.py").read_text(encoding="utf-8"))
    definitions = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "Definitions"
    ]

    assert len(definitions) == 1, "expected one Definitions(...) in definitions.py"
    executor = _keyword(definitions[0], "executor")
    assert isinstance(executor, ast.Name) and executor.id == "in_process_executor", (
        "Definitions has no executor=in_process_executor; every step would load the code again"
    )


@pytest.mark.parametrize(
    "value, on",
    [(None, True), ("", True), ("on", True), ("off", False), (" OFF ", False)],
)
def test_lake_maintenance_can_be_switched_off(monkeypatch, value, on):
    """A project chooses whether maintenance runs on its own; unset means on."""
    from datavloot_platform import maintenance

    if value is None:
        monkeypatch.delenv(maintenance.SCHEDULE_ENV, raising=False)
    else:
        monkeypatch.setenv(maintenance.SCHEDULE_ENV, value)
    assert maintenance.scheduled() is on


def test_a_mistyped_switch_is_an_error(monkeypatch):
    """`of` or `false` must not silently leave maintenance running."""
    from datavloot_platform import maintenance

    monkeypatch.setenv(maintenance.SCHEDULE_ENV, "of")
    with pytest.raises(ValueError, match=maintenance.SCHEDULE_ENV):
        maintenance.scheduled()


@pytest.mark.parametrize("template", TEMPLATES)
def test_the_maintenance_schedule_follows_the_switch(scaffold: pathlib.Path, template: str):
    """The schedule's starting state comes from the switch, not a fixed RUNNING."""
    tree = ast.parse(
        (_platform_dir(template, scaffold) / "lake_maintenance.py").read_text(encoding="utf-8")
    )
    schedules = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "ScheduleDefinition"
    ]

    assert schedules, "no ScheduleDefinition in lake_maintenance.py"
    for schedule in schedules:
        status = _keyword(schedule, "default_status")
        assert status is not None and "maintenance.scheduled()" in ast.unparse(status)


def test_every_model_layer_sets_a_custom_schema(scaffold: pathlib.Path):
    """
    No layer may fall back to the bare target schema.

    The target schema is named after the project, and so is the catalog the
    lake is attached as, so the catalog and that schema collide. DuckDB then refuses two-part names:
    `Ambiguous reference to catalog or schema "probe"`. dbt is unaffected (it
    emits three-part names); it breaks what a person types.
    """
    project = yaml.safe_load((scaffold / "dbt_project.yml").read_text(encoding="utf-8"))
    layers = project["models"]["probe"]

    missing = [name for name, cfg in layers.items() if "+schema" not in cfg]
    assert missing == [], f"layers with no +schema, will collide with the catalog: {missing}"


@pytest.mark.parametrize(
    "relpath",
    [
        "models/source/_schema.yml",
        "models/business/facts/_fct_configs.yml",
        "models/business/datasets/_dataset_configs.yml",
        "models/business/dimensions/_dim_configs.yml",
    ],
)
def test_config_templates_are_valid_yaml(scaffold: pathlib.Path, relpath: str):
    """
    Every shipped config parses, and an empty `models:` is an explicit list.

    A bare `models:` with only commented examples under it parses as null, which
    dbt rejects. The fix was `models: []` -- this keeps it that way, and keeps
    the annotation telling the reader to remove the [] before adding an entry.
    """
    text = (scaffold / relpath).read_text(encoding="utf-8")
    doc = yaml.safe_load(text)

    assert doc is not None, f"{relpath} parses as null"
    assert "models" in doc, f"{relpath} has no models key"
    assert doc["models"] is not None, f"{relpath} has a null models key; use [] instead"

    if doc["models"] == []:
        assert "models: []" in text
        assert "remove the []" in text, (
            f"{relpath} has an empty models list with no note telling the reader "
            "to remove it before uncommenting the example below"
        )


def test_no_placeholder_model_is_declared(scaffold: pathlib.Path):
    """
    Templates must not declare models that do not exist.

    `_schema.yml` shipped a literal stg_<source_name>__<table_name> entry with
    tests attached, so dbt registered two tests against a missing model and a
    fresh project's first parse emitted three warnings.
    """
    doc = yaml.safe_load((scaffold / "models/source/_schema.yml").read_text(encoding="utf-8"))
    declared = {m["name"] for m in (doc.get("models") or [])}

    sql_models = {p.stem for p in (scaffold / "models").rglob("*.sql")}
    orphans = declared - sql_models
    assert orphans == set(), f"declared in YAML but no .sql file exists: {orphans}"


def test_no_placeholder_source_is_declared(scaffold: pathlib.Path):
    """
    Templates must not declare sources that do not exist.

    `_sources.yml` shipped an active <source_name>.<table_name> with unique and
    not_null tests. `dbt run` skips tests, so it passed; `dbt build` -- which is
    what Dagster runs on the first materialization -- executed them and failed
    on `select <primary_key_column>`. On Windows it failed even earlier: the
    test names contain < and >, which are not allowed in file names.
    """
    text = (scaffold / "models/source/_sources.yml").read_text(encoding="utf-8")
    doc = yaml.safe_load(text)

    assert doc["sources"] == [], f"_sources.yml declares sources: {doc['sources']}"
    assert "remove the []" in text, (
        "_sources.yml has an empty sources list with no note telling the reader "
        "to remove it before uncommenting the example below"
    )


def _translator(assets_py: pathlib.Path, project_name: str):
    """
    The LayerGroupTranslator class from an assets.py, without importing it:
    the module needs dagster and a compiled dbt manifest.
    """
    tree = ast.parse(assets_py.read_text(encoding="utf-8"))
    cls = next(
        n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "LayerGroupTranslator"
    )
    project = types.SimpleNamespace(name=project_name)
    namespace = {"DagsterDbtTranslator": object}
    namespace.update(
        {n.id: project for n in ast.walk(cls) if isinstance(n, ast.Name) and n.id.endswith("_dbt_project")}
    )
    exec(compile(ast.Module(body=[cls], type_ignores=[]), str(assets_py), "exec"), namespace)
    return namespace["LayerGroupTranslator"]()


@pytest.mark.parametrize(
    "where, project_name",
    [("scaffold", "probe"), ("demo", "noaa")],
)
def test_a_package_gets_one_dagster_group(scaffold: pathlib.Path, where: str, project_name: str):
    """
    Elementary's models are grouped as `elementary`, the project's by folder.

    Grouped by folder, Elementary showed up as seven groups (alerts,
    data_monitoring, system, ...) between the project's own source and
    business, looking like part of the project.
    """
    assets_py = {
        "scaffold": scaffold / "probe_platform" / "assets.py",
        "demo": cli.TEMPLATES_DIR / "demo" / "noaa_platform" / "assets.py",
    }[where]
    translator = _translator(assets_py, project_name)

    elementary = {
        "package_name": "elementary",
        "fqn": ["elementary", "edr", "data_monitoring", "anomaly_detection", "metrics_anomaly_score"],
    }
    own = {"package_name": project_name, "fqn": [project_name, "business", "dim_date"]}

    assert translator.get_group_name(elementary) == "elementary"
    assert translator.get_group_name(own) == "business"
