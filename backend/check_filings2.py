import sqlite3
db = sqlite3.connect("data_store/meta.db")
c = db.cursor()
c.execute("SELECT symbol, exchange, filing_type, subject, filed_at FROM filings ORDER BY filed_at DESC LIMIT 5")
for r in c.fetchall():
    print(r)
print()
c.execute("SELECT filed_at FROM filings ORDER BY filed_at DESC LIMIT 1")
print("Latest filing:", c.fetchone())
c.execute("SELECT filed_at FROM filings ORDER BY filed_at ASC LIMIT 1")
print("Oldest filing:", c.fetchone())
db.close()
