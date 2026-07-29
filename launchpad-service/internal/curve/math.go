// Package curve — math helpers (separation to avoid name clashes).
package curve

import "math"

// powEImpl — exp(x) using stdlib math.
func powEImpl(x float64) float64 { return math.Exp(x) }

// lnEImpl — natural log.
func lnEImpl(x float64) float64 { return math.Log(x) }
