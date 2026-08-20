package api

import (
	"testing"

	"github.com/google/uuid"
)

func TestParseInt64RejectsEmptyAndMalformedValues(t *testing.T) {
	for _, input := range []string{"", " ", "not-a-number", "9223372036854775808"} {
		if _, err := parseInt64(input); err == nil {
			t.Fatalf("parseInt64(%q) accepted malformed input", input)
		}
	}
	got, err := parseInt64(" 42 ")
	if err != nil || got != 42 {
		t.Fatalf("parseInt64 valid input = %d, %v; want 42, nil", got, err)
	}
}

func TestParseUUIDRejectsMalformedValues(t *testing.T) {
	if _, err := parseUUID("not-a-uuid"); err == nil {
		t.Fatal("parseUUID accepted malformed input")
	}
	want := uuid.New()
	got, err := parseUUID(" " + want.String() + " ")
	if err != nil || got != want {
		t.Fatalf("parseUUID valid input = %v, %v; want %v, nil", got, err, want)
	}
}

func TestParseTradeIDsAndAmountRejectsAnyMalformedBoundary(t *testing.T) {
	userID, tokenID := uuid.New(), uuid.New()
	if _, _, _, err := parseTradeIDsAndAmount(userID.String(), tokenID.String(), "bad"); err == nil {
		t.Fatal("trade parser accepted malformed amount")
	}
	if _, _, _, err := parseTradeIDsAndAmount("bad", tokenID.String(), "1"); err == nil {
		t.Fatal("trade parser accepted malformed user id")
	}
	gotUser, gotToken, gotAmount, err := parseTradeIDsAndAmount(userID.String(), tokenID.String(), "7")
	if err != nil || gotUser != userID || gotToken != tokenID || gotAmount != 7 {
		t.Fatalf("valid trade parse = %v, %v, %d, %v", gotUser, gotToken, gotAmount, err)
	}
}
