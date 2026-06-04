"""
FinBERT GPU Sentiment Scorer
Uses ProsusAI/finbert when PyTorch + transformers are available (GPU accelerated).
Falls back to rule-based scoring otherwise.
Designed to run once per process — loads model on first call and caches it.
"""

import asyncio
import logging
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── State ──────────────────────────────────────────────────────────────────────
_model = None
_tokenizer = None
_device = None
_lock = threading.Lock()
_finbert_ready = False
_finbert_failed = False

# Dedicated single-thread executor for ALL FinBERT GPU inference.
# Why single-thread:
#   1. Serialises CUDA access — no contention/OOM from concurrent forward passes.
#   2. Keeps every inference OFF the asyncio event loop, so a news sweep of
#      hundreds of articles can never block WS price broadcasts (this was the
#      root cause of the "ticker freezes for 10-15s then resumes" symptom).
_infer_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="finbert-infer")

LABELS = ["positive", "negative", "neutral"]

# ── Rule-based fallback ────────────────────────────────────────────────────────
_POS = [
    "surge", "rally", "beat", "outperform", "upgrade", "buy", "bullish",
    "record high", "all-time high", "strong", "growth", "profit", "gain",
    "acquisition", "dividend", "buyback", "expansion", "launch", "win",
    "approve", "positive", "robust", "recover", "breakout", "exceed",
    "guidance raise", "earnings beat", "accumulate", "inflow", "optimistic",
    "turnaround", "higher", "up", "increase", "rise", "boost", "soar",
    "momentum", "overweight", "strong buy", "outperformed", "target raise",
]
_NEG = [
    "crash", "plunge", "slump", "sell-off", "downgrade", "sell", "bearish",
    "record low", "weak", "loss", "decline", "drop", "cut", "miss",
    "warning", "concern", "fraud", "scam", "default", "bankruptcy", "recall",
    "guidance cut", "earnings miss", "outflow", "pessimistic", "collapse",
    "lower", "down", "decrease", "fall", "dump", "underperform", "underweight",
    "target cut", "short", "volatile", "warning", "probe", "investigation",
    "margin call", "halt", "circuit breaker", "below expectations",
]


def _rule_based(text: str) -> float:
    """Returns score in [-1, +1]. Pure Python, no dependencies."""
    tl = text.lower()
    pos = sum(1 for w in _POS if w in tl)
    neg = sum(1 for w in _NEG if w in tl)
    total = pos + neg
    if total == 0:
        return 0.0
    return round((pos - neg) / total, 3)


# ── FinBERT loader ─────────────────────────────────────────────────────────────

def _try_load_finbert() -> bool:
    global _model, _tokenizer, _device, _finbert_ready
    try:
        import torch
        from transformers import AutoTokenizer, AutoModelForSequenceClassification

        _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info("FinBERT: loading model on %s …", _device)

        _tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
        _model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
        _model.to(_device)
        _model.eval()

        # Warm-up
        _ = _score_batch_gpu(["Market sentiment is positive today."])
        logger.info("FinBERT: ready on %s ✓", _device)
        _finbert_ready = True
        return True
    except Exception as e:
        logger.warning("FinBERT not available: %s — using rule-based fallback", e)
        return False


def _ensure_loaded():
    global _finbert_failed
    if _finbert_ready or _finbert_failed:
        return
    with _lock:
        if _finbert_ready or _finbert_failed:
            return
        if not _try_load_finbert():
            _finbert_failed = True


def _score_batch_gpu(texts: List[str]) -> List[Tuple[str, float]]:
    """Run a batch through FinBERT. Returns list of (label, confidence) tuples."""
    import torch
    inputs = _tokenizer(
        texts,
        return_tensors="pt",
        truncation=True,
        max_length=512,
        padding=True,
    ).to(_device)

    with torch.no_grad():
        outputs = _model(**inputs)

    probs = torch.nn.functional.softmax(outputs.logits, dim=-1).cpu().numpy()
    results = []
    for prob in probs:
        idx = int(prob.argmax())
        label = LABELS[idx]
        # Convert to -1..+1 score: positive=+conf, negative=-conf, neutral=0
        if label == "positive":
            score = float(prob[0])
        elif label == "negative":
            score = -float(prob[1])
        else:
            score = 0.0
        results.append((label, round(score, 4)))
    return results


# ── Public API ─────────────────────────────────────────────────────────────────

def score_text(text: str) -> float:
    """
    Score a single text snippet.
    Returns float in [-1.0, +1.0]:  negative=bearish, positive=bullish.
    Uses FinBERT if available, rule-based otherwise.
    """
    _ensure_loaded()
    if _finbert_ready:
        try:
            results = _score_batch_gpu([text[:512]])
            return results[0][1]
        except Exception as e:
            logger.warning("FinBERT inference error: %s", e)
    return _rule_based(text)


def score_batch(texts: List[str], batch_size: int = 32) -> List[float]:
    """
    Score multiple texts. Batches GPU calls for efficiency.
    Returns list of floats in [-1.0, +1.0].
    """
    _ensure_loaded()
    if not texts:
        return []

    if _finbert_ready:
        results = []
        for i in range(0, len(texts), batch_size):
            chunk = [t[:512] for t in texts[i:i + batch_size]]
            try:
                batch_results = _score_batch_gpu(chunk)
                results.extend(r[1] for r in batch_results)
            except Exception as e:
                logger.warning("FinBERT batch error: %s", e)
                results.extend(_rule_based(t) for t in chunk)
        return results

    return [_rule_based(t) for t in texts]


async def score_text_async(text: str) -> float:
    """
    Async, non-blocking single-text scorer.
    Runs FinBERT inference on the dedicated single-thread executor so the
    asyncio event loop stays free for WS price broadcasts. Use this from any
    coroutine instead of score_text() (which blocks the loop for ~15-50ms/call
    and freezes the whole terminal during multi-hundred-article news sweeps).
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_infer_executor, score_text, text)


async def score_batch_async(texts: List[str], batch_size: int = 32) -> List[float]:
    """Async, non-blocking batch scorer (runs on the dedicated FinBERT thread)."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_infer_executor, score_batch, texts, batch_size)


def is_gpu_active() -> bool:
    """Returns True if FinBERT is running on GPU."""
    if not _finbert_ready:
        return False
    try:
        import torch
        return _device is not None and _device.type == "cuda"
    except Exception:
        return False


def get_status() -> dict:
    """Return status dict for the health/guardian endpoint."""
    return {
        "engine": "FinBERT" if _finbert_ready else "rule-based",
        "device": str(_device) if _device else "cpu",
        "gpu_active": is_gpu_active(),
        "ready": _finbert_ready,
        "failed_to_load": _finbert_failed,
    }


def load_async():
    """Start loading FinBERT in a background thread (non-blocking)."""
    t = threading.Thread(target=_ensure_loaded, daemon=True, name="finbert-loader")
    t.start()
