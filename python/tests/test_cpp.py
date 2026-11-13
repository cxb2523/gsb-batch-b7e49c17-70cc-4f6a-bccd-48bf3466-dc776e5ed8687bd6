"""anchorlaw-scanner C++ 支持单元测试。

验证语言无关的 @anchor 注释式标注：提取、格式校验（test 必须带 source）、
多文件扫描。对应协议 v0.4 C++ cross-language note。
"""
import textwrap

import pytest

from anchorlaw_scanner.cpp import (
    CppAnchor,
    CppParseError,
    is_cpp_file,
    scan_cpp_file,
    summarize_cpp,
)


def _write(tmp_path, name, src):
    p = tmp_path / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(textwrap.dedent(src), encoding="utf-8")
    return str(p)


class TestIsCppFile:
    def test_extensions(self):
        assert is_cpp_file("a.cpp")
        assert is_cpp_file("b.h")
        assert is_cpp_file("c.hpp")
        assert is_cpp_file("d.cc")
        assert not is_cpp_file("e.py")
        assert not is_cpp_file("f.js")


class TestScanCpp:
    def test_extracts_test_anchor(self, tmp_path):
        f = _write(tmp_path, "density.h", '''
            // @anchor.test("density matches Java", source="probe:block_probe!density")
            int density(int x, int y, int z);
        ''')
        anchors = scan_cpp_file(f)
        assert len(anchors) == 1
        a = anchors[0]
        assert a.kind == "test"
        assert a.description == "density matches Java"
        assert a.source == "probe:block_probe!density"
        assert a.valid

    def test_extracts_idk_anchor(self, tmp_path):
        f = _write(tmp_path, "surface.h", '''
            // @anchor.idk("1.17 surface edge cases unverified")
            void apply_surface(...);
        ''')
        anchors = scan_cpp_file(f)
        assert len(anchors) == 1
        assert anchors[0].kind == "idk"
        assert anchors[0].valid  # idk 不需要 source

    def test_test_anchor_without_source_invalid(self, tmp_path):
        f = _write(tmp_path, "a.h", '''
            // @anchor.test("no source here")
            int f();
        ''')
        anchors = scan_cpp_file(f)
        assert len(anchors) == 1
        assert not anchors[0].valid
        assert any("source" in i for i in anchors[0].issues)

    def test_empty_description_invalid(self, tmp_path):
        f = _write(tmp_path, "a.h", '''
            // @anchor.test("", source="probe:x")
            int f();
        ''')
        anchors = scan_cpp_file(f)
        assert not anchors[0].valid

    def test_comment_detection_not_in_code(self, tmp_path):
        f = _write(tmp_path, "a.h", '''
            int x = 1;  // @anchor.idk("still a comment, ok")
        ''')
        anchors = scan_cpp_file(f)
        assert len(anchors) == 1  # 行注释中的标注应被识别

    def test_single_line_anchor(self, tmp_path):
        f = _write(tmp_path, "a.h", "// @anchor.test(\"one line\", source=\"trace:x\")\n")
        anchors = scan_cpp_file(f)
        assert len(anchors) == 1
        assert anchors[0].valid


class TestSummarize:
    def test_summary(self, tmp_path):
        f = _write(tmp_path, "a.h", '''
            // @anchor.test("a", source="probe:1")
            // @anchor.idk("b")
            int f();
        ''')
        anchors = scan_cpp_file(f)
        s = summarize_cpp(anchors)
        assert s["total"] == 2
        assert s["test"] == 1
        assert s["idk"] == 1
        assert s["invalid"] == []

class TestCliCppWiring:
    """CLI 接线：check 命令对 C++ 文件做 annotation-extraction
    （参考实现改进，协议 §8 C++ = annotation-extraction 声称的实现入口）。"""

    def test_check_cpp_file_valid(self, tmp_path, capsys):
        import argparse
        from anchorlaw_scanner import cli
        f = _write(tmp_path, "foo.cpp", '''
            // @anchor.test("valid anchor", source="trace:probe#001")
            int foo() { return 1; }
        ''')
        ns = argparse.Namespace(command="check", path=f, lang="cpp",
                                no_recursive=False)
        cli._cmd_check(ns)  # valid → 不抛 SystemExit
        out = capsys.readouterr().out
        assert "VALID" in out
        assert "Total: 1 anchors" in out

    def test_check_cpp_file_invalid_exits(self, tmp_path, capsys):
        import argparse
        from anchorlaw_scanner import cli
        f = _write(tmp_path, "bad.cpp", '''
            // @anchor.test("missing source")
            int bad() { return 0; }
        ''')
        ns = argparse.Namespace(command="check", path=f, lang="cpp",
                                no_recursive=False)
        with pytest.raises(SystemExit) as e:
            cli._cmd_check(ns)
        assert e.value.code == 1
        out = capsys.readouterr().out
        assert "INVALID" in out
        assert "must be fixed" in out

    def test_check_cpp_dir_with_lang_cpp(self, tmp_path, capsys):
        import argparse
        from anchorlaw_scanner import cli
        _write(tmp_path, "a.cpp", '''
            // @anchor.test("a ok", source="trace:p#1")
            int a() { return 1; }
        ''')
        _write(tmp_path, "b.h", '''
            // @anchor.idk("b unknown")
            int b();
        ''')
        ns = argparse.Namespace(command="check", path=str(tmp_path), lang="cpp",
                                no_recursive=False)
        cli._cmd_check(ns)
        out = capsys.readouterr().out
        assert "Total: 2 anchors" in out
        assert "test=1 idk=1" in out

    def test_check_cpp_dir_skips_py_files(self, tmp_path, capsys):
        import argparse
        from anchorlaw_scanner import cli
        _write(tmp_path, "x.py", '''
            def f(x):
                return x
        ''')
        ns = argparse.Namespace(command="check", path=str(tmp_path), lang="cpp",
                                no_recursive=False)
        cli._cmd_check(ns)
        out = capsys.readouterr().out
        assert "Total: 0 anchors" in out  # C++ 模式不处理 .py

class TestCommentFormGoJava:
    """v0.16：Go/Java 与 C++ 同注释式声明位置（行注释 // @anchor.*）。"""

    def test_go_java_extensions(self):
        assert is_cpp_file("main.go")
        assert is_cpp_file("App.java")

    def test_scan_go_file(self, tmp_path):
        f = _write(tmp_path, "main.go", '''
            // @anchor.test("density matches Java", source="probe:block_probe!density")
            func density(x, y, z int) int { return 0 }
        ''')
        anchors = scan_cpp_file(f)
        assert len(anchors) == 1
        assert anchors[0].kind == "test"
        assert anchors[0].valid
        assert anchors[0].source == "probe:block_probe!density"

    def test_scan_java_file_invalid_missing_source(self, tmp_path):
        f = _write(tmp_path, "App.java", '''
            // @anchor.test("missing source")
            public int density() { return 0; }
        ''')
        anchors = scan_cpp_file(f)
        assert len(anchors) == 1
        assert not anchors[0].valid
        assert any("source" in i for i in anchors[0].issues)

    def test_cli_check_go_file(self, tmp_path, capsys):
        import argparse
        from anchorlaw_scanner import cli
        f = _write(tmp_path, "main.go", '''
            // @anchor.test("ok", source="trace:p#1")
            func f() {}
        ''')
        ns = argparse.Namespace(command="check", path=f, lang="go",
                                no_recursive=False)
        cli._cmd_check(ns)
        out = capsys.readouterr().out
        assert "VALID" in out
        assert "Total: 1 anchors" in out

    def test_cli_check_java_dir(self, tmp_path, capsys):
        import argparse
        from anchorlaw_scanner import cli
        _write(tmp_path, "App.java", '''
            // @anchor.test("a ok", source="trace:p#1")
            public int a() { return 1; }
        ''')
        _write(tmp_path, "main.go", '''
            // @anchor.idk("g unknown")
            func g() {}
        ''')
        ns = argparse.Namespace(command="check", path=str(tmp_path), lang="java",
                                no_recursive=False)
        cli._cmd_check(ns)
        out = capsys.readouterr().out
        # 注释式模式（cpp/go/java）共享同一提取器，目录扫描覆盖全部注释式文件
        assert "Total: 2 anchors" in out  # App.java test + main.go idk


class TestDecodeError:
    """坏编码文件不得用替换字符吞掉非法字节：产出一条 parse-error，
    且该文件不再产出任何 @anchor 结果。"""

    def _write_bytes(self, tmp_path, name, raw):
        p = tmp_path / name
        p.write_bytes(raw)
        return str(p)

    def test_bad_encoding_yields_single_parse_error_and_no_anchor(self, tmp_path):
        # 合法 anchor 行之后紧跟一个非法 UTF-8 字节：不能被报成“标注缺失”，
        # 也不能产出残缺 anchor。
        raw = (
            b'// @anchor.test("valid", source="probe:x")\n'
            b'int good();\n'
            b'// bad byte follows: \xff\xfe\n'
        )
        f = self._write_bytes(tmp_path, "broken.cpp", raw)
        items = scan_cpp_file(f)

        assert len(items) == 1
        err = items[0]
        assert isinstance(err, CppParseError)
        assert err.category == "parse-error"
        assert err.severity == "info"
        assert err.file_path == f
        assert "decode error" in err.message
        # 原始异常信息必须保留（UnicodeDecodeError 的编码名/位置/原因）
        assert "UnicodeDecodeError" in err.message
        assert not any(isinstance(i, CppAnchor) for i in items)

    def test_parse_error_line_is_first_decode_failure_line(self, tmp_path):
        # 前两行合法，第三行含非法字节
        raw = b'// line one\n// line two\n// \xff broken\n'
        f = self._write_bytes(tmp_path, "broken.go", raw)
        items = scan_cpp_file(f)
        assert len(items) == 1
        assert isinstance(items[0], CppParseError)
        assert items[0].line_number == 3

    def test_valid_utf8_file_unchanged(self, tmp_path):
        # 合法文件行为不变：test 缺 source、描述为空仍判 invalid 并列出 issues
        f = _write(tmp_path, "a.h", '''
            // @anchor.test("")
            int f();
        ''')
        items = scan_cpp_file(f)
        assert len(items) == 1
        anchor = items[0]
        assert isinstance(anchor, CppAnchor)
        assert not anchor.valid
        assert anchor.issues  # 描述为空 + 缺 source 均列出

    def test_explicit_string_source_skips_decoding(self, tmp_path):
        # 调用方直接给出已解码文本时，不再读盘、不触发 decode 失败
        f = str(tmp_path / "virtual.java")
        items = scan_cpp_file(f, source='// @anchor.idk("in-memory")\n')
        assert len(items) == 1
        assert isinstance(items[0], CppAnchor)


class TestMultilineAnchor:
    """跨行书写的标注必须被正确提取，行号取标注起始行；
    相邻的独立单行标注不得被合并。"""

    def test_multiline_anchor_extracted_with_start_line(self, tmp_path):
        f = _write(tmp_path, "multi.cpp", '''
            int before();
            // @anchor.test("描述",
            // source="probe:x")
            int after();
        ''')
        anchors = scan_cpp_file(f)
        assert len(anchors) == 1
        a = anchors[0]
        assert a.kind == "test"
        assert a.description == "描述"
        assert a.source == "probe:x"
        assert a.valid
        # 标注起始行：文件第 3 行（第 1 行为空行）
        assert a.line_number == 3

    def test_multiline_anchor_without_repeated_comment_marker(self, tmp_path):
        # 续行不带 // 的写法同样应被识别
        f = _write(tmp_path, "multi.h",
                   '// @anchor.test("split",\n'
                   'source="trace:y")\n')
        anchors = scan_cpp_file(f)
        assert len(anchors) == 1
        assert anchors[0].valid
        assert anchors[0].source == "trace:y"
        assert anchors[0].line_number == 1

    def test_two_adjacent_single_line_anchors_not_merged(self, tmp_path):
        f = _write(tmp_path, "two.cpp", '''
            // @anchor.test("first", source="probe:1")
            // @anchor.idk("second")
            int f();
        ''')
        anchors = scan_cpp_file(f)
        assert len(anchors) == 2
        first, second = anchors
        assert first.kind == "test"
        assert first.description == "first"
        assert first.source == "probe:1"
        assert first.line_number == 2
        assert second.kind == "idk"
        assert second.description == "second"
        assert second.line_number == 3

    def test_inline_comment_anchor_still_detected(self, tmp_path):
        # 既有行为：行内注释中的标注仍被识别，行号取所在行
        f = _write(tmp_path, "inline.java",
                   'int x = 1;  // @anchor.idk("still a comment, ok")\n')
        anchors = scan_cpp_file(f)
        assert len(anchors) == 1
        assert anchors[0].kind == "idk"
        assert anchors[0].line_number == 1


class TestCliParseFailure:
    """CLI check 在注释式模式下遇到解析失败项：打印文件与原因，
    汇总单独给出失败文件数，并以非零退出码结束。"""

    def test_check_bad_encoding_file_exits_nonzero(self, tmp_path, capsys):
        import argparse
        from anchorlaw_scanner import cli
        f = tmp_path / "broken.cpp"
        f.write_bytes(b'// @anchor.test("x", source="probe:1")\n\xff broken\n')
        ns = argparse.Namespace(command="check", path=str(f), lang="cpp",
                                no_recursive=False)
        with pytest.raises(SystemExit) as e:
            cli._cmd_check(ns)
        assert e.value.code != 0
        out = capsys.readouterr().out
        assert str(f) in out
        assert "parse-error" in out
        assert "decode error" in out
        assert "parse-failed files=1" in out

    def test_check_dir_mixes_parse_failure_and_valid_anchors(
        self, tmp_path, capsys
    ):
        import argparse
        from anchorlaw_scanner import cli
        _write(tmp_path, "ok.go", '''
            // @anchor.test("ok", source="trace:p#1")
            func f() {}
        ''')
        (tmp_path / "broken.java").write_bytes(b'public class B {}\n\xff\n')
        ns = argparse.Namespace(command="check", path=str(tmp_path), lang="java",
                                no_recursive=False)
        with pytest.raises(SystemExit) as e:
            cli._cmd_check(ns)
        assert e.value.code != 0
        out = capsys.readouterr().out
        # 合法文件的 anchor 照常列出
        assert "Total: 1 anchors" in out
        # 失败文件单独计数
        assert "parse-failed files=1" in out
        assert "decode error" in out

    def test_check_valid_only_still_exits_zero(self, tmp_path, capsys):
        import argparse
        from anchorlaw_scanner import cli
        _write(tmp_path, "ok.cpp", '''
            // @anchor.test("ok", source="trace:p#1")
            int f() { return 0; }
        ''')
        ns = argparse.Namespace(command="check", path=str(tmp_path), lang="cpp",
                                no_recursive=False)
        cli._cmd_check(ns)  # 不抛 SystemExit → 退出码 0
        out = capsys.readouterr().out
        assert "parse-failed files=0" in out
        assert "Total: 1 anchors" in out
