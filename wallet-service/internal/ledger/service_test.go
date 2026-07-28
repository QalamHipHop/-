package ledger

import "testing"

func TestFormatAmount(t *testing.T) {
	cases := []struct{
		in int64
		want string
	}{
		{100_000_000, "1.00000000"},
		{1, "0.00000001"},
		{0, "0.00000000"},
	}
	for _, c := range cases {
		got := formatAmount(c.in)
		if got != c.want { t.Errorf("formatAmount(%d)=%q want %q", c.in, got, c.want) }
	}
}

func formatAmount(minor int64) string {
	neg := minor < 0
	if neg { minor = -minor }
	whole := minor / 100_000_000
	frac := minor % 100_000_000
	out := ""
	if neg { out += "-" }
	out += itoa(whole) + "." + padLeft(itoa(frac), 8, '0')
	return out
}

func itoa(n int64) string { if n==0 {return "0"}; var b []byte; for n>0 { b = append([]byte{byte('0'+n%10)}, b...); n/=10 }; return string(b) }
func padLeft(s string, n int, c byte) string { for len(s) < n { s = string(c) + s }; return s }
