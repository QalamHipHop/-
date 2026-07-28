package middleware

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog"
)

var (
	httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "rial_http_requests_total", Help: "HTTP requests",
	}, []string{"method", "path", "status"})
	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name: "rial_http_request_duration_seconds", Help: "HTTP request latency",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path"})
)

func CorrelationID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Correlation-Id")
		if id == "" { id = c.GetHeader("X-Request-Id") }
		if id == "" { id = uuid.NewString() }
		c.Set("correlation_id", id)
		c.Writer.Header().Set("X-Correlation-Id", id)
		c.Next()
	}
}

func AccessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		dur := time.Since(start)
		zerolog.Ctx(c.Request.Context()).Info().
			Str("method", c.Request.Method).
			Str("path", c.Request.URL.Path).
			Int("status", c.Writer.Status()).
			Dur("duration", dur).
			Str("cid", c.GetString("correlation_id")).
			Msg("http")
	}
}

func Metrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		dur := time.Since(start)
		path := c.FullPath()
		if path == "" { path = c.Request.URL.Path }
		status := strconv.Itoa(c.Writer.Status())
		httpRequests.WithLabelValues(c.Request.Method, path, status).Inc()
		httpDuration.WithLabelValues(c.Request.Method, path).Observe(dur.Seconds())
	}
}

func Recovery(log zerolog.Logger) gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(nil, func(c *gin.Context, err any) {
		log.Error().Interface("err", err).Str("path", c.Request.URL.Path).Msg("panic recovered")
		c.AbortWithStatusJSON(500, gin.H{"error": "internal_error"})
	})
}
