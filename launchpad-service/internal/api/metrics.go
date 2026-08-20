package api

import (
	"fmt"
	"net/http"
	"runtime"
	"time"
)

var processStartedAt = time.Now()

// metrics exposes operational Prometheus metrics only. It deliberately does not
// fabricate market, token, balance, or volume values; financial metrics belong
// to authoritative ledger/analytics exporters.
func (s *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = fmt.Fprintf(w, "# HELP rial_launchpad_up Whether the launchpad HTTP process is alive.\n# TYPE rial_launchpad_up gauge\nrial_launchpad_up 1\n")
	_, _ = fmt.Fprintf(w, "# HELP rial_launchpad_uptime_seconds Process uptime in seconds.\n# TYPE rial_launchpad_uptime_seconds gauge\nrial_launchpad_uptime_seconds %.3f\n", time.Since(processStartedAt).Seconds())
	_, _ = fmt.Fprintf(w, "# HELP rial_launchpad_goroutines Number of live Go goroutines.\n# TYPE rial_launchpad_goroutines gauge\nrial_launchpad_goroutines %d\n", runtime.NumGoroutine())
	_, _ = fmt.Fprintf(w, "# HELP rial_launchpad_heap_alloc_bytes Bytes allocated on the Go heap.\n# TYPE rial_launchpad_heap_alloc_bytes gauge\nrial_launchpad_heap_alloc_bytes %d\n", mem.HeapAlloc)
	_, _ = fmt.Fprintf(w, "# HELP rial_launchpad_heap_inuse_bytes Bytes in in-use heap spans.\n# TYPE rial_launchpad_heap_inuse_bytes gauge\nrial_launchpad_heap_inuse_bytes %d\n", mem.HeapInuse)
	_, _ = fmt.Fprintf(w, "# HELP rial_launchpad_gc_cycles_total Completed GC cycles.\n# TYPE rial_launchpad_gc_cycles_total counter\nrial_launchpad_gc_cycles_total %d\n", mem.NumGC)
}
