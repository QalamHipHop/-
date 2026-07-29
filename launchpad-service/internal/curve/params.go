package curve

// MustParams — convenience constructor for already-encoded params.
func MustParams(b []byte) Params {
	p, err := DecodeParams(b)
	if err != nil { return DefaultParams() }
	return p
}
