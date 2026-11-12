# -*- coding: utf-8 -*-
"""生成演示样例页面。

从仓库根目录的 index.html 中抽取加固后的启动脚本（保证演示与正式页逻辑一致），
替换配置（密钥 / 模板数量 / 白名单）后生成以下自包含页面，可直接用浏览器打开：

  demo/index.html               演示入口与说明
  demo/ok.html                  正常密文：标题与正文被还原，内联脚本执行
  demo/missing-template.html    模板缺失：错误区域提示，页面不白屏
  demo/bad-base64.html          Base64 非法：错误区域提示，页面不白屏
  demo/empty-key.html           空密钥：判定为配置错误，不进入解码循环
  demo/cross-origin-script.html 跨域脚本：被拦截并记录，外部脚本未插入 DOM

运行：python demo/build_demos.py
"""
import base64
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DEMO_KEY = "demo-key-0123"
DEMO_KEY_B64 = base64.b64encode(DEMO_KEY.encode("ascii")).decode("ascii")
PREFIX = "_ct"
COUNT = 3


def encrypt(payload_html: str, key: str = DEMO_KEY) -> str:
    data = payload_html.encode("utf-8")
    kb = key.encode("ascii")
    xored = bytes(b ^ kb[i % len(kb)] for i, b in enumerate(data))
    return base64.b64encode(xored).decode("ascii")


def split_templates(b64: str, n: int) -> str:
    chunk = (len(b64) + n - 1) // n
    parts = [b64[i:i + chunk] for i in range(0, len(b64), chunk)]
    while len(parts) < n:
        parts.append("")
    return "\n".join(
        '<template id="%s%d">%s</template>' % (PREFIX, i, p)
        for i, p in enumerate(parts)
    )


def extract_boot() -> str:
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        src = f.read()
    m = re.search(r"<script>function gkFrRY[\s\S]*?\}\)\(\);</script>", src)
    if not m:
        raise SystemExit("未能从 index.html 抽取启动脚本")
    js = m.group(0)[len("<script>"):-len("</script>")]
    return js


def patch_boot(js: str, key_b64: str, count: int, whitelist_js: str) -> str:
    js = re.sub(r"var TEMPLATE_PREFIX='[^']*';",
                "var TEMPLATE_PREFIX='%s';" % PREFIX, js, count=1)
    js = re.sub(r"var TEMPLATE_COUNT=\d+;",
                "var TEMPLATE_COUNT=%d;" % count, js, count=1)
    js = re.sub(r"var KEY_B64='[^']*';",
                "var KEY_B64='%s';" % key_b64, js, count=1)
    js = re.sub(r"var ALLOWED_SCRIPT_SRC_PREFIXES=\[[\s\S]*?\];",
                "var ALLOWED_SCRIPT_SRC_PREFIXES=%s;" % whitelist_js, js, count=1)
    return js


PAGE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>
  body{{font:15px/1.7 system-ui,sans-serif;margin:2em auto;max-width:760px;padding:0 1em}}
  .demo-note{{background:#fef9c3;border:1px solid #eab308;padding:.8em 1em;border-radius:6px}}
  .verdict{{position:fixed;bottom:0;left:0;right:0;padding:10px 16px;font:14px/1.5 ui-monospace,Consolas,monospace;color:#fff}}
  .verdict.pass{{background:#166534}} .verdict.fail{{background:#b91c1c}}
  template{{display:none}}
</style></head>
<body>
<div class="demo-note"><strong>{title}</strong><br>{note}</div>
{templates}
<script>{boot}</script>
<script>{verifier}</script>
</body></html>
"""

VERIFIER_HEAD = """(function(){
  function verdict(ok,msg){
    var d=document.createElement('div');
    d.className='verdict '+(ok?'pass':'fail');
    d.textContent=(ok?'验证通过 ✔ ':'验证失败 �“ ')+msg;
    (document.body||document.documentElement).appendChild(d);
  }
  function errText(){
    var b=document.getElementById('_bootError');
    return b?b.textContent:'';
  }
"""


def verifier(checks_js: str) -> str:
    return VERIFIER_HEAD + checks_js + "\n})();"


def write(name: str, title: str, note: str, templates: str,
          boot_js: str, checks_js: str) -> None:
    html = PAGE.format(title=title, note=note, templates=templates,
                       boot=boot_js, verifier=verifier(checks_js))
    with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
        f.write(html)
    print("written:", name)


OK_PAYLOAD = """<html><head><title>演示标题：还原成功</title><style>h1{color:#166534}</style><meta name="demo" content="ok"></head><body><h1>演示标题：还原成功</h1><p>正文内容已还原：模板拼接、Base64 解码、逐字节异或、UTF-8 解码全部成功。</p><p id="st">内联脚本未执行</p><script>document.getElementById('st').textContent='内联脚本已执行 ✔';</script></body></html>"""

XSS_PAYLOAD = """<html><head><title>跨域脚本拦截演示</title></head><body><h1>跨域脚本拦截演示</h1><p>本页密文的 body 中含有两个不可信外部脚本（跨域地址与 javascript: 伪协议）和一个白名单内的外部脚本，以及一段内联脚本。</p><script src="https://evil.example.com/pwn.js"></script><script src="javascript:alert(1)"></script><script src="https://cdn.example.com/lib/ok.js"></script><script>window.__inlineRan=true;</script></body></html>"""


def main() -> None:
    boot = extract_boot()

    # 1. 正常密文
    write(
        "ok.html",
        "演示 1/5：正常密文",
        "预期：页面标题变为「演示标题：还原成功」，正文被还原，内联脚本执行。"
        "若看到本说明被替换为绿色标题，即还原成功。",
        split_templates(encrypt(OK_PAYLOAD), COUNT),
        patch_boot(boot, DEMO_KEY_B64, COUNT, "[]"),
        """
  var ok=document.title==='演示标题：还原成功'
    && document.body.textContent.indexOf('正文内容已还原')!==-1
    && document.getElementById('st')
    && document.getElementById('st').textContent.indexOf('内联脚本已执行')!==-1;
  verdict(ok,'标题='+document.title+'；正文与内联脚本'+(ok?'均已还原':'未正确还原'));
""",
    )

    # 2. 模板缺失（应有 3 片，只给 2 片）
    templates = split_templates(encrypt(OK_PAYLOAD), COUNT)
    templates = "\n".join(templates.split("\n")[:2])
    write(
        "missing-template.html",
        "演示 2/5：模板缺失",
        "密文模板应有 3 片，实际只放了 2 片。预期：页面上方红色错误区域提示「模板缺失」，"
        "本说明文字保留（页面不白屏）。",
        templates,
        patch_boot(boot, DEMO_KEY_B64, COUNT, "[]"),
        """
  var t=errText();
  var ok=t.indexOf('模板缺失')!==-1 && document.querySelector('.demo-note')!==null;
  verdict(ok,'错误区域'+(t?'已显示：'+t:'未出现')+'；页面未白屏');
""",
    )

    # 3. Base64 非法
    write(
        "bad-base64.html",
        "演示 3/5：Base64 非法",
        "密文中混入了非 Base64 字符。预期：错误区域提示「Base64 非法」，页面不白屏。",
        split_templates("YWJjZGVm!!!### 这不是合法Base64 $$$", COUNT),
        patch_boot(boot, DEMO_KEY_B64, COUNT, "[]"),
        """
  var t=errText();
  var ok=t.indexOf('Base64 非法')!==-1 && document.querySelector('.demo-note')!==null;
  verdict(ok,'错误区域'+(t?'已显示：'+t:'未出现')+'；页面未白屏');
""",
    )

    # 4. 空密钥
    write(
        "empty-key.html",
        "演示 4/5：空密钥",
        "密钥被配置为空字符串。预期：直接判定为「配置错误」，不进入解码循环，页面不白屏。",
        split_templates(encrypt(OK_PAYLOAD), COUNT),
        patch_boot(boot, "", COUNT, "[]"),
        """
  var t=errText();
  var ok=t.indexOf('配置错误')!==-1 && document.querySelector('.demo-note')!==null;
  verdict(ok,'错误区域'+(t?'已显示：'+t:'未出现')+'；页面未白屏');
""",
    )

    # 5. 跨域脚本拦截
    write(
        "cross-origin-script.html",
        "演示 5/5：跨域脚本拦截",
        "解出的 body 含跨域脚本、javascript: 伪协议脚本（均不可信）和一个白名单脚本。"
        "预期：不可信脚本被拦截并记入错误区域、未插入 DOM；白名单脚本标签保留；内联脚本照常执行。",
        split_templates(encrypt(XSS_PAYLOAD), COUNT),
        patch_boot(boot, DEMO_KEY_B64, COUNT, "['https://cdn.example.com/']"),
        """
  var t=errText();
  var evil=document.querySelector('script[src*=\"evil.example.com\"]');
  var jsproto=document.querySelector('script[src^=\"javascript:\"]');
  var white=document.querySelector('script[src*=\"cdn.example.com\"]');
  var ok=!evil && !jsproto && white!==null && window.__inlineRan===true
    && t.indexOf('evil.example.com')!==-1;
  verdict(ok,'跨域脚本'+(evil?'未被拦截（异常）':'已被拦截且未插入 DOM')
    +'；javascript: '+(jsproto?'未被拦截（异常）':'已禁止')
    +'；白名单脚本'+(white?'已放行':'缺失（异常）')
    +'；内联脚本'+(window.__inlineRan?'已执行':'未执行（异常）'));
""",
    )

    # 演示入口
    index = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>启动流程演示样例</title>
<style>body{font:15px/1.8 system-ui,sans-serif;margin:2em auto;max-width:760px;padding:0 1em}
li{margin:.4em 0}</style></head>
<body>
<h1>启动流程演示样例</h1>
<p>直接点击下列链接在浏览器中打开（支持 file:// 协议），每页底部会显示绿色「验证通过」或红色「验证失败」。</p>
<ul>
  <li><a href="ok.html">演示 1：正常密文</a> —— 标题与正文被还原，内联脚本执行</li>
  <li><a href="missing-template.html">演示 2：模板缺失</a> —— 错误提示出现，页面不白屏</li>
  <li><a href="bad-base64.html">演示 3：Base64 非法</a> —— 错误提示出现，页面不白屏</li>
  <li><a href="empty-key.html">演示 4：空密钥</a> —— 判定为配置错误，不进入解码循环</li>
  <li><a href="cross-origin-script.html">演示 5：跨域脚本</a> —— 被拦截并记录，外部脚本未插入</li>
</ul>
<p>正式页面 <a href="../index.html">index.html</a> 使用同一套加固后的启动逻辑。</p>
</body></html>
"""
    with open(os.path.join(HERE, "index.html"), "w", encoding="utf-8") as f:
        f.write(index)
    print("written: index.html")


if __name__ == "__main__":
    main()
