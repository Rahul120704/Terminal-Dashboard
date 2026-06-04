import sqlite3
db = sqlite3.connect('data_store/meta.db')
c = db.cursor()
c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='filings'")
print(c.fetchone()[0])
print()
c.execute("SELECT * FROM filings ORDER BY filed_at DESC LIMIT 3")
for r in c.fetchall():
    print(r[:5])
db.close()
