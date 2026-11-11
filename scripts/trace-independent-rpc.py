"""Static request assembly tracing. APK code is never executed."""
import gc
import argparse
import json
import sys
import zipfile
from pathlib import Path
sys.path.insert(0, str(Path('research/tools/python').resolve()))
from loguru import logger
logger.remove()
from androguard.core.dex import DEX

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('needles', nargs='+')
parser.add_argument('--output', default='research/independent/rpc-trace.json')
args = parser.parse_args()
needles = args.needles
results = []
with zipfile.ZipFile('research/upstream/kylin-official.apk') as apk:
 for name in apk.namelist():
  if not name.endswith('.dex'): continue
  raw = apk.read(name)
  if not any(n.encode() in raw for n in needles): continue
  dex = DEX(raw)
  for cls in dex.get_classes():
   selected = cls.get_name() in needles
   for method in cls.get_methods():
    if not method.get_code(): continue
    instructions = [i.get_name()+' '+i.get_output() for i in method.get_code().get_bc().get_instructions()]
    if selected or any(any(n in i for n in needles) for i in instructions):
     results.append({'dex':name,'class':cls.get_name(),'method':method.get_name(),'descriptor':method.get_descriptor(),'instructions':instructions})
  print(json.dumps({'dex':name,'matches':len(results)}),flush=True)
  del dex, raw
  gc.collect()
Path(args.output).write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
