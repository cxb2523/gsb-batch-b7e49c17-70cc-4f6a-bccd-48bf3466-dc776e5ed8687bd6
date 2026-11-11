import json
import struct
import sys
import zipfile
from pathlib import Path
sys.path.insert(0,str(Path('research/tools/python').resolve()))
from loguru import logger
logger.remove()
from androguard.core.dex import DEX
targets=sys.argv[1:]
result=[]
with zipfile.ZipFile('research/upstream/kylin-official.apk') as apk:
 for name in apk.namelist():
  if not name.endswith('.dex'):continue
  raw=apk.read(name)
  if not any(t.encode() in raw for t in targets):continue
  def uint(pos):return struct.unpack_from('<I',raw,pos)[0]
  strings=[]
  for i in range(uint(56)):
   pos=uint(uint(60)+i*4)
   while raw[pos]>=128:pos+=1
   pos+=1;strings.append(raw[pos:raw.index(0,pos)].decode('utf-8','replace'))
  types=[strings[uint(uint(68)+i*4)] for i in range(uint(64))]
  names=[types[uint(uint(100)+i*32)] for i in range(uint(96))]
  selected=[n for n in names if any(n==t or n.startswith(t[:-1]+'$') for t in targets)]
  if not selected:continue
  dex=DEX(raw)
  for cls in dex.get_classes():
   if cls.get_name() not in selected:continue
   fields=[{'name':f.get_name(),'type':f.get_descriptor()} for f in cls.get_fields()]
   methods=[]
   for m in cls.get_methods():
    if not m.get_code():continue
    instr=[i.get_name()+' '+i.get_output() for i in m.get_code().get_bc().get_instructions()]
    # DTO serializer constants recover actual snake_case query names.
    narrow=[i for i in instr if 'const-string' in i]
    if narrow or m.get_name()=='<clinit>':methods.append({'name':m.get_name(),'descriptor':m.get_descriptor(),'strings':narrow,'instructions':instr if len(instr)<350 or m.get_name()=='<clinit>' else []})
   result.append({'dex':name,'class':cls.get_name(),'fields':fields,'methods':methods})
  Path('research/independent/specific-classes.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
  print(json.dumps({'dex':name,'classes':selected}),flush=True)
