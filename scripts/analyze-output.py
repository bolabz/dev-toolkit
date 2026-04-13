#!/usr/bin/env python3
import json, collections, statistics

with open('/Users/admin/Documents/GitHub/gmail-toolkit/scripts/debug-layer2-output.json') as f:
    data = json.load(f)

# ── 1. Collect all messages across search results ──────────────────────────────
all_msgs = []
for k, v in data.items():
    if isinstance(v, dict) and 'messages' in v and isinstance(v['messages'], list):
        all_msgs.extend(v['messages'])

print(f'Total message objects across all search results: {len(all_msgs)}')

# ── 2. Label repetition ────────────────────────────────────────────────────────
label_counter = collections.Counter()
for m in all_msgs:
    for lbl in (m.get('labels') or []):
        label_counter[lbl] += 1

print(f'\nTop 25 most frequent label values across {len(all_msgs)} messages:')
for lbl, cnt in label_counter.most_common(25):
    print(f'  {cnt:4d}x  {lbl!r}')

# ── 3. Sender (from.email) repetition ─────────────────────────────────────────
from_counter = collections.Counter()
for m in all_msgs:
    frm = m.get('from') or {}
    email = frm.get('email') if isinstance(frm, dict) else None
    if email:
        from_counter[email] += 1

print(f'\nTop 20 most frequent from.email values:')
for email, cnt in from_counter.most_common(20):
    print(f'  {cnt:4d}x  {email}')

# ── 4. body_text size analysis ────────────────────────────────────────────────
body_lens = [len(m.get('body_text') or '') for m in all_msgs]
nonempty = [l for l in body_lens if l > 0]
print(f'\nbody_text sizes ({len(nonempty)}/{len(body_lens)} non-empty):')
if nonempty:
    print(f'  min={min(nonempty)}, max={max(nonempty)}, median={statistics.median(nonempty):.0f}, mean={statistics.mean(nonempty):.0f}')
    print(f'  > 5KB:  {sum(1 for l in nonempty if l > 5_000)}')
    print(f'  > 10KB: {sum(1 for l in nonempty if l > 10_000)}')
    print(f'  > 50KB: {sum(1 for l in nonempty if l > 50_000)}')

# ── 5. snippet vs body_text overlap ──────────────────────────────────────────
overlap = 0
for m in all_msgs:
    snippet = (m.get('snippet') or '').strip()
    body = (m.get('body_text') or '').strip()
    if snippet and body and snippet[:40] in body:
        overlap += 1
print(f'\nMessages where snippet is contained in body_text: {overlap}/{len(all_msgs)}')

# ── 6. web_url prefix pattern ─────────────────────────────────────────────────
web_prefixes = collections.Counter()
for m in all_msgs:
    url = m.get('web_url') or ''
    if url:
        prefix = url.rsplit('/', 1)[0] if '/' in url else url
        web_prefixes[prefix] += 1

print(f'\nweb_url base prefixes:')
for prefix, cnt in web_prefixes.most_common(5):
    print(f'  {cnt:4d}x  {prefix}')

# ── 7. Fields that are always null/empty ──────────────────────────────────────
field_null = collections.defaultdict(int)
field_total = collections.defaultdict(int)
for m in all_msgs:
    for k, v in m.items():
        field_total[k] += 1
        if v is None or v == '' or v == [] or v == {}:
            field_null[k] += 1

print('\nAll fields null/empty rate:')
for k in sorted(field_total.keys()):
    pct = field_null[k] / field_total[k] * 100
    print(f'  {pct:5.1f}%  {k}  ({field_null[k]}/{field_total[k]})')

# ── 8. Analyze threads too ────────────────────────────────────────────────────
all_threads = []
for k, v in data.items():
    if isinstance(v, dict) and 'threads' in v and isinstance(v['threads'], list):
        all_threads.extend(v['threads'])

print(f'\nTotal thread objects: {len(all_threads)}')
if all_threads:
    print('Thread fields null/empty rate:')
    tf_null = collections.defaultdict(int)
    tf_total = collections.defaultdict(int)
    for t in all_threads:
        for k, v in t.items():
            tf_total[k] += 1
            if v is None or v == '' or v == [] or v == {}:
                tf_null[k] += 1
    for k in sorted(tf_total.keys()):
        pct = tf_null[k] / tf_total[k] * 100
        print(f'  {pct:5.1f}%  {k}  ({tf_null[k]}/{tf_total[k]})')

# ── 9. labels array cardinality ───────────────────────────────────────────────
label_counts = [len(m.get('labels') or []) for m in all_msgs]
print(f'\nLabels per message: min={min(label_counts)}, max={max(label_counts)}, median={statistics.median(label_counts):.1f}, mean={statistics.mean(label_counts):.1f}')
print(f'Messages with 0 labels: {sum(1 for c in label_counts if c == 0)}')
print(f'Messages with 1 label:  {sum(1 for c in label_counts if c == 1)}')
print(f'Messages with 2 labels: {sum(1 for c in label_counts if c == 2)}')
print(f'Messages with 3+ labels:{sum(1 for c in label_counts if c >= 3)}')

# ── 10. Unique IDs — are messages duplicated across search results? ────────────
unique_ids = set()
dup_count = 0
for k, v in data.items():
    if isinstance(v, dict) and 'messages' in v:
        for m in (v['messages'] or []):
            mid = m.get('id')
            if mid in unique_ids:
                dup_count += 1
            unique_ids.add(mid)
print(f'\nMessage ID deduplication: {len(unique_ids)} unique IDs, {dup_count} duplicates across search results')

# ── 11. history.ts analysis ──────────────────────────────────────────────────
for k, v in data.items():
    if 'getHistory' in k and isinstance(v, dict):
        changes = v.get('changes') or []
        print(f'\n{k}: {len(changes)} history records')
        if changes:
            types = collections.Counter()
            for c in changes:
                types['messages_added'] += len(c.get('messages_added') or [])
                types['messages_deleted'] += len(c.get('messages_deleted') or [])
                types['labels_added'] += len(c.get('labels_added') or [])
                types['labels_removed'] += len(c.get('labels_removed') or [])
            print(f'  changes: {dict(types)}')

