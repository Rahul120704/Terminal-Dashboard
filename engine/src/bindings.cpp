/**
 * BTI Engine — pybind11 Python Bindings
 * =======================================
 * Exposes the C++ QuoteStore and SPSC tick queue to the Python FastAPI backend.
 *
 * Python usage:
 *   import bti_engine
 *   store = bti_engine.get_global_store()
 *   store.update("RELIANCE", 2480.50, 15.20, 0.62, 2450.0, 2495.0, 2445.0, 2465.30, 1_250_000)
 *   q = store.get("RELIANCE")  # returns dict or None
 *   all_q = store.snapshot()   # returns list[dict]
 *
 * Integration with fyers_data.py:
 *   In _handle_tick(), after updating fyers_data._quote_cache (existing code),
 *   also call bti_engine.get_global_store().update(...) with the tick data.
 *   The batch broadcaster in main.py can then call store.drain_queue() to get
 *   the latest ticks without locking.
 */

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <pybind11/chrono.h>
#include "tick_processor.hpp"

namespace py = pybind11;
using namespace bti;

// ─── Python-facing Quote wrapper ─────────────────────────────────────────────
// Converts Quote struct → Python dict for zero-copy interop with existing code.

static py::dict quote_to_dict(const Quote& q) {
    py::dict d;
    d["symbol"]     = std::string(q.symbol);
    d["price"]      = q.price;
    d["change"]     = q.change;
    d["change_pct"] = q.change_pct;
    d["open"]       = q.open;
    d["high"]       = q.high;
    d["low"]        = q.low;
    d["prev_close"] = q.prev_close;
    d["volume"]     = q.volume;
    d["timestamp_ns"] = q.timestamp_ns;
    d["source"]     = "bti_engine";
    return d;
}

// ─── QuoteStoreWrapper ────────────────────────────────────────────────────────
class QuoteStoreWrapper {
public:
    explicit QuoteStoreWrapper(std::size_t capacity = 4096)
        : _store(std::make_unique<QuoteStore>(capacity)) {}

    bool update(const std::string& symbol,
                double price, double change, double change_pct,
                double open, double high, double low, double prev_close,
                int64_t volume) {
        Quote q;
        q.set_symbol(symbol);
        q.price       = price;
        q.change      = change;
        q.change_pct  = change_pct;
        q.open        = open;
        q.high        = high;
        q.low         = low;
        q.prev_close  = prev_close;
        q.volume      = volume;
        q.timestamp_ns = now_ns();
        // Also push to SPSC queue for broadcaster
        global_tick_queue().push(q);
        return _store->update(q);
    }

    py::object get(const std::string& symbol) const {
        auto opt = _store->get(symbol);
        if (!opt) return py::none();
        return quote_to_dict(*opt);
    }

    py::list snapshot() const {
        py::list result;
        for (const auto& q : _store->snapshot()) {
            result.append(quote_to_dict(q));
        }
        return result;
    }

    // Drain the SPSC queue — call from the broadcast thread every 33ms.
    // Returns list of recently-arrived ticks (may contain duplicates if same symbol
    // ticked multiple times — caller should deduplicate by keeping last per symbol).
    py::list drain_queue() {
        py::list result;
        std::vector<Quote> buf;
        buf.reserve(256);
        global_tick_queue().drain(buf);
        for (const auto& q : buf) {
            result.append(quote_to_dict(q));
        }
        return result;
    }

    std::size_t size() const { return _store->size(); }
    std::size_t capacity() const { return _store->capacity(); }
    std::size_t queue_size() const { return global_tick_queue().approx_size(); }

private:
    std::unique_ptr<QuoteStore> _store;
};

// ─── Module ──────────────────────────────────────────────────────────────────
PYBIND11_MODULE(bti_engine, m) {
    m.doc() = "BTI C++ tick processing engine — SPSC queue + lock-free QuoteStore";

    py::class_<QuoteStoreWrapper>(m, "QuoteStore")
        .def(py::init<std::size_t>(), py::arg("capacity") = 4096)
        .def("update", &QuoteStoreWrapper::update,
             py::arg("symbol"),
             py::arg("price"), py::arg("change"), py::arg("change_pct"),
             py::arg("open"), py::arg("high"), py::arg("low"), py::arg("prev_close"),
             py::arg("volume"),
             "Update quote in store + push to SPSC queue. Thread-safe.")
        .def("get", &QuoteStoreWrapper::get, py::arg("symbol"),
             "Get latest quote dict for symbol. Returns None if not found.")
        .def("snapshot", &QuoteStoreWrapper::snapshot,
             "Get all quotes as list[dict]. Safe to call from any thread.")
        .def("drain_queue", &QuoteStoreWrapper::drain_queue,
             "Drain SPSC queue — returns ticks since last drain. "
             "Call every 33ms from broadcast thread.")
        .def_property_readonly("size", &QuoteStoreWrapper::size)
        .def_property_readonly("capacity", &QuoteStoreWrapper::capacity)
        .def_property_readonly("queue_size", &QuoteStoreWrapper::queue_size);

    // Module-level global store accessor (singleton)
    m.def("get_global_store", []() -> QuoteStoreWrapper& {
        static QuoteStoreWrapper store(4096);
        return store;
    }, py::return_value_policy::reference,
       "Get the process-global QuoteStore singleton.");

    // Benchmark helper
    m.def("bench_update_ns", [](int n) -> double {
        QuoteStoreWrapper store(8192);
        Quote q;
        q.set_symbol("BENCH");
        q.price = 2480.50;
        const auto t0 = now_ns();
        for (int i = 0; i < n; ++i) {
            store.update("BENCH", 2480.50 + i * 0.01, 15.0, 0.6,
                         2450.0, 2495.0, 2445.0, 2465.0, 1000000 + i);
        }
        const auto t1 = now_ns();
        return static_cast<double>(t1 - t0) / n; // ns per update
    }, "Benchmark: ns per store.update() call");
}
