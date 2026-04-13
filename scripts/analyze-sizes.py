#!/usr/bin/env python3
import json

with open('/Users/admin/Documents/GitHub/gmail-toolkit/scripts/debug-layer2-output.json') as f:
    data = json.load(f)

# Size per top-level key
print('Bytes per top-level key:')
total = 0
for k, v in data.items():
    s = len(json.dumps(v))
    total += s
    print(f'  {s:>8,}  {k}')
print(f'  {total:>8,}  TOTAL')

# Drill into one message - what fields are big?
msgs_data = [(k, v) for k, v in data.items() if isinstance(v, dict) and 'messages' in v]
print()
print('Per-message field sizes (first message of first search):')
k0, v0 = msgs_data[0]
print(f'  Result: {k0}')
m = v0['messages'][0]
for field, val in sorted(m.items(), key=lambda x: -len(json.dumps(x[1]))):
    sz = len(json.dumps(val))
    print(f'  {sz:>6}  {field}')

# body_text total bytes
all_body = []
for k, v in data.items():
    if isinstance(v, dict) and 'messages' in v:
        for msg in v['messages']:
            bt = msg.get('body_text') or ''
            all_body.append(len(bt))
print(f'\nbody_text total bytes: {sum(all_body):,}  ({len([x for x in all_body if x > 0])} non-empty)')

# labels total bytes
label_total = 0
for k, v in data.items():
    if isinstance(v, dict) and 'messages' in v:
        for msg in v['messages']:
            label_total += len(json.dumps(msg.get('labels') or []))
print(f'labels total bytes:    {label_total:,}')

# web_url total bytes
url_total = 0
for k, v in data.items():
    if isinstance(v, dict) and 'messages' in v:
        for msg in v['messages']:
            url_total += len(json.dumps(msg.get('web_url') or ''))
print(f'web_url total bytes:   {url_total:,}  (base always "https://mail.google.com/mail/u/0/#all")')

# snippet total bytes
snip_total = 0
for k, v in data.items():
    if isinstance(v, dict) and 'messages' in v:
        for msg in v['messages']:
            snip_total += len(json.dumps(msg.get('snippet') or ''))
print(f'snippet total bytes:   {snip_total:,}')

# null/empty field overhead
null_total = 0
null_breakdown = {}
for k, v in data.items():
    if isinstance(v, dict) and 'messages' in v:
        for msg in v['messages']:
            for field, val in msg.items():
                if val is None or val == '' or val == [] or val == {}:
                    sz = len(f'"{field}":null') + 2  # rough JSON overhead
                    null_total += sz
                    null_breakdown[field] = null_breakdown.get(field, 0) + sz
print(f'\nNull/empty field overhead: {null_total:,} bytes')
for field, sz in sorted(null_breakdown.items(), key=lambda x: -x[1]):
    print(f'  {sz:>6,}  {field}')

