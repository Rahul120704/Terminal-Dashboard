import sqlite3
db = sqlite3.connect('data_store/meta.db')
c = db.cursor()

# Schema
c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='news'")
print("=== NEWS SCHEMA ===")
print(c.fetchone()[0])

# Most recent by created_at
print("\n=== RECENT BY created_at ===")
c.execute("SELECT headline, source, published_at, created_at FROM news ORDER BY created_at DESC LIMIT 5")
for r in c.fetchall():
    print(r)

# Count by year
print("\n=== COUNT BY created_at YEAR ===")
c.execute("SELECT strftime('%Y-%m', created_at) as ym, COUNT(*) FROM news GROUP BY ym ORDER BY ym DESC LIMIT 12")
for r in c.fetchall():
    print(r)

db.close()
