#!/usr/bin/env python3
"""분석 테스트용 앱 복사본을 만든다(운영 설정 값은 합성 값). 저장소 파일은 바꾸지 않는다.
사용: python3 tests/build-testcopy.py <출력 폴더> [--policy-incomplete]"""
import re, sys, os, shutil
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
s = s.replace("\n})();\n</script>", "\nwindow.__T={S,track,consentGet,anOn,anQ,anSnaps,anBuildSnap,anPolicyOK,planOf,commitPlan,shift,renderAll,logout,anFlush};\n})();\n</script>")
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(s)
c = open(os.path.join(root, 'config.js'), encoding='utf-8').read()
if '--policy-incomplete' not in sys.argv:
    c = re.sub(r'enabled: false', 'enabled: true', c)
    for k, v in {'operator': 'TEST-OPERATOR', 'contact': 'test@example.invalid', 'policyVersion': 'test-1', 'region': 'TEST-REGION', 'processors': 'TEST-PROCESSOR'}.items():
        c = re.sub(r'(%s: )""' % k, r'\1"%s"' % v, c)
    c = c.replace('retentionDays: { events: "", snapshots: "", consent: "", audit: "" }', 'retentionDays: { events: "365", snapshots: "365", consent: "1095", audit: "730" }')
open(os.path.join(out, 'config.js'), 'w', encoding='utf-8').write(c)
for f in ('sw.js', 'manifest.webmanifest'):
    shutil.copy(os.path.join(root, f), out)
