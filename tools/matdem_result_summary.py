# -*- coding: utf-8 -*-
"""MatDEM 结果摘要提取工具 v1（matdem_result_summary.py）

用途：把 MatDEM 运行产物整理成可核对的表格：
  - list    ：列出结果目录里的产物（png/gif/mat/txt/csv/log)
  - extract ：从文本统计文件（key=value / key: value 行）提取键值 -> CSV
  - merge   ：把一个目录下多份文本结果合并成一张宽表 CSV（行=文件，列=键）
  - mat     ：探测 .mat 类型/MCOS 类名/普通标量变量（scipy 可选；缺失时仅报元数据）

边界：只读产物；不启动任何求解器；不修改任何文件；零硬依赖（scipy 可选）。
说明：MatDEM 的 Result .mat 常为 MATLAB MCOS 对象序列化（_Class=obj_Box/build 等），
      scipy 无法解析其属性；统计量建议由脚本 fprintf 写文本，再用本工具 extract/merge。
"""
import argparse
import csv
import os
import re
import sys

KEY = re.compile(r'(?<![=\w.\u4e00-\u9fff])([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff .><\/\-]{0,40}?)\s*[:=]\s*')
SKIP_PREFIX = ('#', '//', '%', '=')

RESULT_EXTS = ('.png', '.gif', '.mat', '.txt', '.csv', '.log', '.jpg', '.jpeg', '.fig')


def first(v):
    try:
        import numpy as np
        if isinstance(v, np.ndarray) and v.size:
            return v.ravel()[0]
    except Exception:
        pass
    return v


def scalar_repr(v):
    try:
        import numpy as np
        a = np.asarray(v)
        if a.dtype.kind in 'US':
            return "'%s'" % (str(a.ravel()[0])[:40] if a.size else '')
        if a.size == 0:
            return None
        if a.size <= 4 and a.dtype.kind in 'fiub':
            return ', '.join('%.6g' % x for x in a.ravel())
        return '(array %s %s)' % (a.shape, a.dtype)
    except Exception:
        return None


def iter_text_kv(path):
    """全局扫描一行里的所有 key=value 对（一行多对；键含空格/中文/>阈值式；值内 = 修正）。"""
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        for ln in fh:
            s = ln.rstrip('\r\n')
            st = s.strip()
            if not st or st.startswith(SKIP_PREFIX):
                continue
            ms = list(KEY.finditer(s))
            if not ms:
                continue
            for i, m in enumerate(ms):
                start = m.end()
                end = ms[i + 1].start() if i + 1 < len(ms) else len(s)
                k = re.sub(r'\s+', ' ', m.group(1)).strip()
                v = s[start:end].strip().rstrip(',;')
                mm = re.match(r'^(\d[\d.]*)=(.+)$', v)
                if mm:
                    k = k + '=' + mm.group(1)
                    v = mm.group(2).strip()
                if not k or v == '':
                    continue
                yield k, v


def find_results(root, exts=RESULT_EXTS, recurse=False):
    hits = []
    if recurse:
        for dp, _, names in os.walk(root):
            for n in sorted(names):
                if n.lower().endswith(exts):
                    hits.append(os.path.join(dp, n))
    else:
        for n in sorted(os.listdir(root)):
            full = os.path.join(root, n)
            if os.path.isfile(full) and n.lower().endswith(exts):
                hits.append(full)
    return hits


def cmd_list(args):
    files = find_results(args.dir, tuple(args.ext.split(',')), args.recurse)
    total = 0
    print('# 结果文件清单：%s（%d 件）' % (args.dir, len(files)))
    for f in (files[:args.limit] if args.limit else files):
        st = os.stat(f)
        total += st.st_size
        low = f.lower()
        kind = ('mat' if low.endswith('.mat') else
                'figure' if low.endswith(('.png', '.gif', '.jpg', '.jpeg', '.fig')) else 'text')
        print('- %s | %s | %.1f KiB' % (os.path.basename(f), kind, st.st_size / 1024.0))
    if args.limit and len(files) > args.limit:
        print('…（仅显示前 %d 件）' % args.limit)
    print('合计 %d 件 / %.1f MiB' % (len(files), total / 1048576.0))


def write_csv(rows, header, out):
    with open(out, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


def cmd_extract(args):
    kv = list(iter_text_kv(args.file))
    if args.out:
        write_csv([[k, v] for k, v in kv], ['key', 'value'], args.out)
        print('extract: %d 项 -> %s' % (len(kv), args.out))
    else:
        for k, v in kv:
            print('%s = %s' % (k, v))
        print('共 %d 项' % len(kv))


def cmd_merge(args):
    exts = tuple('.' + e.strip().lstrip('.') for e in args.ext.split(',') if e.strip())
    files = find_results(args.dir, exts, args.recurse)
    data = []
    allkeys = []
    for f in files:
        d = {}
        for k, v in iter_text_kv(f):
            if k not in d:
                d[k] = v
        if d:
            data.append((f, d))
            for k in d:
                if k not in allkeys:
                    allkeys.append(k)
    allkeys.sort()
    rows = [[os.path.relpath(f, args.dir)] + [d.get(k, '') for k in allkeys] for f, d in data]
    header = ['file'] + allkeys
    if args.out:
        write_csv(rows, header, args.out)
        print('merge: %d 文件 / %d 键 -> %s' % (len(rows), len(allkeys), args.out))
    else:
        for r in rows:
            print(r)


def cmd_mat(args):
    try:
        import scipy.io as sio
        have = True
    except Exception:
        have = False
    for p in args.files:
        st = os.stat(p)
        line = '- %s | %.2f MiB' % (os.path.basename(p), st.st_size / 1048576.0)
        if not have:
            print(line + ' | (scipy 不可用：仅报元数据)')
            continue
        try:
            m = sio.loadmat(p, squeeze_me=False, struct_as_record=False)
        except Exception as e:
            print(line + ' | LOAD FAIL: %s' % e)
            continue
        tops = [k for k in sorted(m) if not k.startswith('__')]
        classes = []
        scalars = []
        others = []
        for k in tops:
            v = m[k]
            names = getattr(getattr(v, 'dtype', None), 'names', None)
            if names and '_Class' in names:
                classes.append('%s:%s' % (k, str(first(v['_Class']))))
            else:
                disp = scalar_repr(v)
                if disp is not None:
                    scalars.append('%s=%s' % (k, disp))
                else:
                    others.append(k)
        desc = []
        if classes:
            desc.append('MCOS对象[%s]' % ', '.join(classes))
        if scalars:
            desc.append('变量[%s]' % ', '.join(scalars[:12]) + ('…' if len(scalars) > 12 else ''))
        if others:
            desc.append('其他[%s]' % ', '.join(others[:6]) + ('…' if len(others) > 6 else ''))
        print(line + ' | ' + ('; '.join(desc) if desc else '无顶层变量'))


def main():
    ap = argparse.ArgumentParser(description='MatDEM result summary tool v1')
    sub = ap.add_subparsers(dest='cmd', required=True)
    p1 = sub.add_parser('list'); p1.add_argument('dir'); p1.add_argument('--ext', default=','.join(RESULT_EXTS)); p1.add_argument('--recurse', action='store_true'); p1.add_argument('--limit', type=int, default=0)
    p2 = sub.add_parser('extract'); p2.add_argument('file'); p2.add_argument('--out')
    p3 = sub.add_parser('merge'); p3.add_argument('dir'); p3.add_argument('--ext', default='txt,log,csv'); p3.add_argument('--recurse', action='store_true'); p3.add_argument('--out')
    p4 = sub.add_parser('mat'); p4.add_argument('files', nargs='+')
    a = ap.parse_args()
    if a.cmd == 'list': cmd_list(a)
    elif a.cmd == 'extract': cmd_extract(a)
    elif a.cmd == 'merge': cmd_merge(a)
    else: cmd_mat(a)


if __name__ == '__main__':
    main()