import sqlite3, os

for fname in ['data_store/bti.db', 'data_store/meta.db']:
    if not os.path.exists(fname):
        print(f"{fname}: NOT FOUND")
        continue
    db = sqlite3.connect(fname)
    c = db.cursor()
    c.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in c.fetchall()]
    print(f"\n{fname}: {tables}")
    for t in tables:
        try:
            c.execute(f"SELECT COUNT(*) FROM {t}")
            cnt = c.fetchone()[0]
            print(f"  {t}: {cnt} rows")
        except Exception as e:
            print(f"  {t}: {e}")
    db.close()
