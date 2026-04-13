#!/usr/bin/env python3
import json

with open('/Users/admin/Documents/GitHub/gmail-toolkit/scripts/debug-layer2-output.json') as f:
    data = json.load(f)

for k in data:
    if 'searchAll' in k or 'getMessages' in k:
        v = data[k]
        keys = list(v.keys()) if isinstance(v, dict) else str(type(v))
        print(k, '->', keys)
        if isinstance(v, dict):
            for fk, fv in v.items():
                if isinstance(fv, list):
                    print(f'  {fk}: len={len(fv)}')
                    if len(fv) > 0:
                        print(f'  first item keys: {list(fv[0].keys()) if isinstance(fv[0], dict) else type(fv[0])}')
                elif isinstance(fv, dict):
                    print(f'  {fk}: {list(fv.keys())}')
                else:
                    val = repr(fv)
                    print(f'  {fk}: {val[:100]}')

