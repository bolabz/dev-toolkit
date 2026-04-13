#!/usr/bin/env python3
import json, statistics, collections

with open('/Users/admin/Documents/GitHub/gmail-toolkit/scripts/debug-layer2-output.json') as f:
    data = json.load(f)

sa = data['searchAll(60d,pages=1)']
threads = sa['threads']
summary = sa['summary']

print(f'searchAll result: {sa["total_messages"]} messages in {sa["total_threads"]} threads')
print(f'Threads returned: {len(threads)}')

# Per-thread field sizes
thread_field_bytes = collections.defaultdict(int)
all_matched_msgs = []
for t in threads:
    for k, v in t.items():
        thread_field_bytes[k] += len(json.dumps(v))
    for mm in (t.get('matched_messages') or []):
        all_matched_msgs.append(mm)

print(f'\nPer-field bytes across {len(threads)} threads:')
for k, v in sorted(thread_field_bytes.items(), key=lambda x: -x[1]):
    avg = v / len(threads)
    print(f'  {v:>8,}  avg={avg:5.0f}  {k}')

print(f'\nmatched_messages total: {len(all_matched_msgs)}')

# Per-message field sizes in matched_messages
if all_matched_msgs:
    msg_field_bytes = collections.defaultdict(int)
    for m in all_matched_msgs:
        for k, v in m.items():
            msg_field_bytes[k] += len(json.dumps(v))

    print(f'Per-field bytes across {len(all_matched_msgs)} matched_messages:')
    for k, v in sorted(msg_field_bytes.items(), key=lambda x: -x[1]):
        avg = v / len(all_matched_msgs)
        print(f'  {v:>8,}  avg={avg:5.0f}  {k}')

    empty_bt = sum(1 for m in all_matched_msgs if not (m.get('body_text') or '').strip())
    print(f'\nbody_text empty in matched_messages: {empty_bt}/{len(all_matched_msgs)}')

# Summary structure
print(f'\nSummary keys: {list(summary.keys())}')
print(f'  unread_count: {summary["unread_count"]}')
print(f'  senders: {len(summary["senders"])} unique')
print(f'  labels: {summary["labels"]}')

# participants repetition across threads
all_participants = []
for t in threads:
    for p in (t.get('participants') or []):
        if isinstance(p, dict):
            all_participants.append(p.get('email') or '')
        else:
            all_participants.append(str(p))
pcounter = collections.Counter(all_participants)
print(f'\nTop 15 participants across {len(threads)} threads:')
for email, cnt in pcounter.most_common(15):
    print(f'  {cnt:3d}x  {email}')

# message_count distribution in threads
mc = [t.get('message_count', 0) for t in threads]
print(f'\nMessage count per thread: min={min(mc)}, max={max(mc)}, median={statistics.median(mc):.0f}')
print(f'  single-message threads: {sum(1 for x in mc if x == 1)}')
print(f'  2-5 messages: {sum(1 for x in mc if 2 <= x <= 5)}')
print(f'  6+ messages: {sum(1 for x in mc if x >= 6)}')

# matched_count vs message_count
mmatch = [t.get('matched_count', 0) for t in threads]
print(f'matched_count < message_count (partial match): {sum(1 for i in range(len(threads)) if mmatch[i] < mc[i])}')

# web_url in matched_messages
if all_matched_msgs:
    url_bytes = sum(len(json.dumps(m.get('web_url') or '')) for m in all_matched_msgs)
    id_bytes = sum(len(json.dumps(m.get('id') or '')) for m in all_matched_msgs)
    print(f'\nmatched_messages web_url bytes: {url_bytes:,} vs id bytes: {id_bytes:,} (save {url_bytes-id_bytes:,})')

    # label repetition
    label_ctr = collections.Counter()
    for m in all_matched_msgs:
        for l in (m.get('labels') or []):
            label_ctr[l] += 1
    labels_raw = sum(len(json.dumps(m.get('labels') or [])) for m in all_matched_msgs)
    print(f'label bytes in matched_messages: {labels_raw:,}')
    print(f'Top labels: {label_ctr.most_common(8)}')

# date_range repetition across threads with single message
single_msg_threads = [t for t in threads if t.get('message_count', 0) == 1]
if single_msg_threads:
    dr = single_msg_threads[0].get('date_range') or {}
    print(f'\ndate_range in single-msg thread: first={dr.get("first")}, last={dr.get("last")}')
    print(f'  (first==last when only 1 message — redundant)')
    same = sum(1 for t in single_msg_threads
               if isinstance(t.get('date_range'), dict)
               and t['date_range'].get('first') == t['date_range'].get('last'))
    print(f'  {same}/{len(single_msg_threads)} single-msg threads have date_range.first == last')

