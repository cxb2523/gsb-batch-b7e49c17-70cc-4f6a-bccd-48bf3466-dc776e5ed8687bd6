"""Narrow static DEX request tracing; does not execute any APK code."""
import gc
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path('research/tools/python').resolve()))
from loguru import logger
logger.remove()
from androguard.core.dex import DEX

needles=['/reading/bookapi/search/', '/reading/bookapi/bookmall/tab/']
report={'executed':False,'methods':[],'requestClasses':[]}
with zipfile.ZipFile('research/upstream/kylin-official.apk') as apk:
 for name in apk.namelist():
  if not re.fullmatch(r'classes\d*\.dex',name): continue
  raw=apk.read(name)
  if not any(n.encode() in raw for n in needles) and not any(n.encode() in raw for n in ['SearchRequest','SearchTabRequest','BookMallTabRequest']): continue
  dex=DEX(raw)
  for cls in dex.get_classes():
   cn=cls.get_name()
   if re.search(r'(Search(?:Tab|Suggest)?Req|BookMallTabReq)',cn,re.I):
    report['requestClasses'].append({'dex':name,'class':cn,'fields':[{'name':f.get_name(),'type':f.get_descriptor()} for f in cls.get_fields()]})
   for method in cls.get_methods():
    code=method.get_code()
    if not code: continue
    instructions=list(code.get_bc().get_instructions())
    matches=[i.get_output() for i in instructions if i.get_name().startswith('const-string') and any(n in i.get_output() for n in needles)]
    if matches:
     report['methods'].append({'dex':name,'class':cn,'method':method.get_name(),'descriptor':method.get_descriptor(),'matches':matches,'instructions':[i.get_name()+' '+i.get_output() for i in instructions]})
  print(json.dumps({'dex':name,'methods':len(report['methods']),'requestClasses':len(report['requestClasses'])}),flush=True)
  del dex,raw;gc.collect()
Path('research/independent/request-trace.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
