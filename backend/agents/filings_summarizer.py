"""
BTI FilingsSummarizerAgent
- Monitors new NSE/BSE filings in the SQLite database
- Extracts key financial data from XBRL/text filings
- Generates LLM summaries via TerminalCopilot
- Broadcasts via WebSocket
"""

from __future__ import annotations

import asyncio
import logging
import re
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class FilingSummary:
    filing_id: str
    symbol: str
    title: str
    filing_type: str
    date: str
    url: str
    raw_text: str = ""
    summary: str = ""
    key_metrics: Dict[str, Any] = field(default_factory=dict)
    sentiment: str = "NEUTRAL"
    impact: str = "LOW"        # LOW | MEDIUM | HIGH | CRITICAL
    ai_generated: bool = False
    processed_at: str = ""

    def to_dict(self) -> dict:
        return {
            "filing_id": self.filing_id,
            "symbol": self.symbol,
            "title": self.title,
            "filing_type": self.filing_type,
            "date": self.date,
            "url": self.url,
            "summary": self.summary,
            "key_metrics": self.key_metrics,
            "sentiment": self.sentiment,
            "impact": self.impact,
            "ai_generated": self.ai_generated,
            "processed_at": self.processed_at,
        }


class FilingsSummarizerAgent:
    """
    Picks up unsummarized filings, generates structured summaries,
    and broadcasts them to connected WebSocket clients.
    """

    INTERVAL_S = 120  # run every 2 minutes
    BATCH_SIZE = 5    # max filings per run

    # Filing types and their impact weights
    IMPACT_MAP = {
        "board meeting": "HIGH",
        "quarterly results": "HIGH",
        "annual results": "HIGH",
        "dividend": "MEDIUM",
        "bonus": "HIGH",
        "split": "HIGH",
        "rights": "HIGH",
        "merger": "CRITICAL",
        "acquisition": "CRITICAL",
        "concall": "MEDIUM",
        "agm": "MEDIUM",
        "ipo": "HIGH",
        "insider": "HIGH",
        "block deal": "MEDIUM",
        "bulk deal": "MEDIUM",
        "credit rating": "HIGH",
        "default": "CRITICAL",
        "management change": "HIGH",
        "ceo": "HIGH",
        "cfo": "HIGH",
        "promoter": "HIGH",
        "pledg": "HIGH",
        "nclt": "CRITICAL",
        "sebi": "CRITICAL",
        "fraud": "CRITICAL",
        "revision": "MEDIUM",
    }

    def __init__(self, db_path: str, copilot=None, broadcast_fn=None):
        self.db_path = db_path
        self.copilot = copilot
        self.broadcast_fn = broadcast_fn
        self._running = False
        self._processed: set = set()
        self._summaries: List[FilingSummary] = []
        self._last_run = 0.0
        logger.info("FilingsSummarizerAgent initialized")

    def _get_db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _classify_impact(self, title: str, filing_type: str) -> str:
        combined = (title + " " + filing_type).lower()
        for keyword, impact in self.IMPACT_MAP.items():
            if keyword in combined:
                return impact
        return "LOW"

    def _extract_key_metrics(self, text: str, filing_type: str) -> Dict[str, Any]:
        """Extract structured metrics from filing text using regex patterns."""
        metrics: Dict[str, Any] = {}
        if not text:
            return metrics

        # Revenue patterns (₹ / crore / lakh)
        rev_match = re.search(
            r"(?:revenue|net sales|total revenue)[^\d]*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|lakh|mn|bn)?",
            text, re.IGNORECASE
        )
        if rev_match:
            metrics["revenue_crore"] = float(rev_match.group(1).replace(",", ""))

        # PAT
        pat_match = re.search(
            r"(?:profit after tax|pat|net profit)[^\d]*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|lakh|mn)?",
            text, re.IGNORECASE
        )
        if pat_match:
            metrics["pat_crore"] = float(pat_match.group(1).replace(",", ""))

        # EPS
        eps_match = re.search(r"(?:eps|earnings per share)[^\d]*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d+)?)", text, re.IGNORECASE)
        if eps_match:
            metrics["eps"] = float(eps_match.group(1).replace(",", ""))

        # Dividend
        div_match = re.search(r"(?:dividend)[^\d]*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d+)?)\s*(?:per share)?", text, re.IGNORECASE)
        if div_match:
            metrics["dividend_per_share"] = float(div_match.group(1).replace(",", ""))

        # YoY growth mentions
        yoy_match = re.search(r"([\d]+(?:\.\d+)?)\s*%?\s*(?:yoy|year.on.year|year over year)", text, re.IGNORECASE)
        if yoy_match:
            metrics["yoy_growth_pct"] = float(yoy_match.group(1))

        return metrics

    def _rule_based_summary(self, filing: Any) -> str:
        """Generate a simple rule-based summary when AI is unavailable."""
        title = filing.get("title", "") if isinstance(filing, dict) else filing["title"]
        symbol = filing.get("symbol", "") if isinstance(filing, dict) else filing["symbol"]
        date = filing.get("date", "") if isinstance(filing, dict) else filing["date"]
        filing_type = filing.get("filing_type", "") if isinstance(filing, dict) else filing.get("category", "filing")

        metrics = self._extract_key_metrics(
            filing.get("description", "") if isinstance(filing, dict) else "",
            filing_type
        )

        parts = [f"{symbol} filed: {title} ({date})."]
        if metrics.get("revenue_crore"):
            parts.append(f"Revenue: ₹{metrics['revenue_crore']:,.0f}Cr.")
        if metrics.get("pat_crore"):
            parts.append(f"PAT: ₹{metrics['pat_crore']:,.0f}Cr.")
        if metrics.get("eps"):
            parts.append(f"EPS: ₹{metrics['eps']:.2f}.")
        if metrics.get("dividend_per_share"):
            parts.append(f"Dividend: ₹{metrics['dividend_per_share']:.2f}/share.")
        if metrics.get("yoy_growth_pct"):
            parts.append(f"YoY growth: {metrics['yoy_growth_pct']:.1f}%.")
        return " ".join(parts)

    async def _ai_summary(self, title: str, description: str, symbol: str, filing_type: str) -> str:
        """Get AI-generated summary from TerminalCopilot."""
        if not self.copilot:
            return ""
        prompt = (
            f"Summarize this NSE/BSE filing for {symbol} in 3 bullet points. "
            f"Focus on financial impact, key numbers, and what investors should watch.\n\n"
            f"Filing: {title}\n\nDetails: {description[:2000]}"
        )
        try:
            response = await asyncio.wait_for(
                self.copilot.query(prompt, session_id="filings_summarizer", max_tokens=512),
                timeout=30.0
            )
            return response.content if not response.error else ""
        except Exception as e:
            logger.warning(f"AI summary failed for {symbol}: {e}")
            return ""

    async def _process_filing(self, row: dict) -> Optional[FilingSummary]:
        """Process a single filing row."""
        filing_id = str(row.get("id", row.get("filing_id", "")))
        symbol = row.get("symbol", "UNKNOWN")
        title = row.get("title", "")
        filing_type = row.get("category", row.get("filing_type", "filing"))
        date = row.get("date", row.get("published", ""))
        url = row.get("url", row.get("link", ""))
        description = row.get("description", row.get("content", ""))

        impact = self._classify_impact(title, filing_type)
        metrics = self._extract_key_metrics(description, filing_type)

        # Try AI summary for HIGH/CRITICAL
        ai_summary = ""
        if impact in ("HIGH", "CRITICAL") and self.copilot:
            ai_summary = await self._ai_summary(title, description, symbol, filing_type)

        summary = ai_summary if ai_summary else self._rule_based_summary(row)

        # Simple sentiment from keywords
        neg_words = ["loss", "decline", "default", "fraud", "nclt", "penalty", "fine", "adverse", "resign"]
        pos_words = ["profit", "growth", "dividend", "expansion", "acquisition", "upgrade", "beat"]
        text_lower = (title + " " + description).lower()
        neg_score = sum(1 for w in neg_words if w in text_lower)
        pos_score = sum(1 for w in pos_words if w in text_lower)
        sentiment = "POSITIVE" if pos_score > neg_score else ("NEGATIVE" if neg_score > pos_score else "NEUTRAL")

        return FilingSummary(
            filing_id=filing_id,
            symbol=symbol,
            title=title,
            filing_type=filing_type,
            date=str(date),
            url=url,
            summary=summary,
            key_metrics=metrics,
            sentiment=sentiment,
            impact=impact,
            ai_generated=bool(ai_summary),
            processed_at=datetime.now().isoformat(),
        )

    async def run_once(self) -> List[FilingSummary]:
        """Process new filings — called by scheduler."""
        try:
            conn = self._get_db()
            # Try to find unprocessed filings (last 24h not yet summarized)
            since = (datetime.now() - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
            try:
                rows = conn.execute(
                    "SELECT * FROM filings WHERE published >= ? ORDER BY published DESC LIMIT ?",
                    (since, self.BATCH_SIZE)
                ).fetchall()
            except Exception:
                try:
                    rows = conn.execute(
                        "SELECT * FROM news WHERE published >= ? AND category LIKE '%filing%' ORDER BY published DESC LIMIT ?",
                        (since, self.BATCH_SIZE)
                    ).fetchall()
                except Exception:
                    rows = []
            conn.close()

            new_summaries: List[FilingSummary] = []
            for row in rows:
                row_dict = dict(row)
                fid = str(row_dict.get("id", row_dict.get("filing_id", "")))
                if fid in self._processed:
                    continue
                summary = await self._process_filing(row_dict)
                if summary:
                    self._processed.add(fid)
                    self._summaries.insert(0, summary)
                    new_summaries.append(summary)

            # Keep last 500
            self._summaries = self._summaries[:500]

            if new_summaries and self.broadcast_fn:
                await self.broadcast_fn({
                    "type": "filings_summaries",
                    "data": [s.to_dict() for s in new_summaries],
                    "count": len(new_summaries),
                })

            if new_summaries:
                logger.info(f"FilingsSummarizer: processed {len(new_summaries)} new filings")
            return new_summaries

        except Exception as e:
            logger.error(f"FilingsSummarizerAgent error: {e}", exc_info=True)
            return []

    def get_recent_summaries(self, symbol: Optional[str] = None, limit: int = 50) -> List[dict]:
        """Return cached summaries, optionally filtered by symbol."""
        summaries = self._summaries
        if symbol:
            summaries = [s for s in summaries if s.symbol == symbol]
        return [s.to_dict() for s in summaries[:limit]]

    async def start(self):
        """Start background polling loop."""
        self._running = True
        logger.info("FilingsSummarizerAgent started")
        while self._running:
            await self.run_once()
            await asyncio.sleep(self.INTERVAL_S)

    def stop(self):
        self._running = False
