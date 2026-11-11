import json,re
data=json.load(open('research/independent/specific-classes.json',encoding='utf-8'))
for cls in data:
 if cls['class'].endswith('/BookstoreTabType;') or cls['class'].endswith('/SearchSource;'):
  regs={};mapping={}
  for item in next(m['instructions'] for m in cls['methods'] if m['name']=='<clinit>'):
   match=re.match(r'const(?:/4|/16)? (v\d+), (-?\d+)$',item)
   if match:regs[match[1]]=int(match[2])
   match=re.match(r'const-string(?:/jumbo)? (v\d+), "([^"]+)"',item)
   if match:regs[match[1]]=match[2]
   match=re.search(r'invoke-direct (v\d+), (v\d+), (v\d+), (v\d+), .*-><init>',item)
   if match:mapping[regs.get(match[2])]=regs.get(match[4])
  print(json.dumps({'class':cls['class'],'values':mapping}))
 if cls['class'] in ['LG9g69q/qq;','Lcom/dragon/read/kmp/app/core/rpc/q9Qgq9Qq;']:
  print(json.dumps({'class':cls['class'],'methods':[{'name':m['name'],'strings':m['strings']} for m in cls['methods']]}))
