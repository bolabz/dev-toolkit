#!/usr/bin/env python3
import json

with open('/Users/admin/Documents/GitHub/gmail-toolkit/scripts/debug-layer2-output.json') as f:
    data = json.load(f)

sa = data.get('searchAll(60d,pages=1)', {})
msgs = sa.get('messages') or []
print(f'searchAll(60d): {len(msgs)} messages, total={sa.get("total_matched")}, returned={sa.get("returned")}')

# Per-field byte contribution inside searchAll
field_bytes = {}
for m in msgs:
    for k, v in m.items():
        field_bytes[k] = field_bytes.get(k, 0) + len(json.dumps(v))

print('Per-field bytes across all searchAll messages:')
for k, v in sorted(field_bytes.items(), key=lambda x: -x[1]):
    avg = v / len(msgs)
    print(f'  {v:>8,}  avg={avg:5.0f}  {k}')

# How many are empty string body_text in searchAll?
empty_bt = sum(1 for m in msgs if not (m.get('body_text') or '').strip())
print(f'\nbody_text empty in searchAll: {empty_bt}/{len(msgs)}')

# label string size vs integer index saving
all_labels = []
for m in msgs:
    all_labels.extend(m.get('labels') or [])
unique = list(set(all_labels))
idx_map = {l: i for i, l in enumerate(unique)}
labels_raw = sum(len(json.dumps(m.get('labels') or [])) for m in msgs)
labels_indexed = sum(len(json.dumps([idx_map[l] for l in (m.get('labels') or [])])) for m in msgs)
print(f'\nLabel strings: {labels_raw:,} bytes  vs  as integer indices: {labels_indexed:,} bytes  (save {labels_raw-labels_indexed:,})')
print(f'Unique labels in this result: {unique}')

# web_url saving
url_bytes = sum(len(json.dumps(m.get('web_url') or '')) for m in msgs)
id_bytes = sum(len(json.dumps(m.get('id') or '')) for m in msgs)
print(f'\nweb_url bytes: {url_bytes:,}  vs  id bytes: {id_bytes:,}  (base="https://mail.google.com/mail/u/0/#all" is constant)')

# If we omit null/empty optional fields
sparse_fields = ['cc', 'bcc', 'reply_to', 'attachments', 'body_html', 'body_text']
null_saving = 0
for m in msgs:
    for f in sparse_fields:
        v = m.get(f)
        if v is None or v == '' or v == [] or v == {}:
            null_saving += len(f'"{f}":null,')
print(f'Omitting null/empty sparse fields saves ~{null_saving:,} bytes in searchAll alone')

# snippet length distribution
snip_lens = [len(m.get('snippet') or '') for m in msgs]
import statistics
print(f'\nsnippet lengths: min={min(snip_lens)}, max={max(snip_lens)}, median={statistics.median(snip_lens):.0f}')
print(f'snippet total bytes: {sum(snip_lens):,}')

# Estimate compressed size if we:
# 1. omit web_url (derivable)
# 2. omit empty body_text
# 3. omit null sparse fields (cc, bcc, reply_to, attachments, body_html)
# 4. use label indices
total_raw = sum(len(json.dumps(m)) for m in msgs)
saving = (url_bytes - id_bytes) + null_saving + (labels_raw - labels_indexed)
print(f'\nTotal raw message bytes: {total_raw:,}')
print(f'Estimated saving (web_url->id + null omit + label index): {saving:,} ({saving/total_raw*100:.1f}%)')

