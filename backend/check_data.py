import sqlite3

db = sqlite3.connect('data_store/meta.db')
c = db.cursor()

print("=== EARNINGS_CALENDAR ===")
c.execute("SELECT symbol, company_name, result_date, quarter, concall_date, status FROM earnings_calendar ORDER BY result_date DESC LIMIT 10")
for r in c.fetchall():
    print(r)

print("\n=== FII_DII_FLOWS ===")
c.execute("SELECT * FROM fii_dii_flows ORDER BY date DESC LIMIT 5")
for r in c.fetchall():
    print(r)

print("\n=== RECENT NEWS ===")
c.execute("SELECT headline, ticker, published_at, sentiment, source FROM news ORDER BY published_at DESC LIMIT 5")
for r in c.fetchall():
    print(r)

print("\n=== MACRO_INDICATORS ===")
c.execute("SELECT indicator, value, unit FROM macro_indicators ORDER BY id DESC LIMIT 5")
for r in c.fetchall():
    print(r)

db.close()
