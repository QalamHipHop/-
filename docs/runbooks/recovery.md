# Wallet Recovery Runbook

## User-initiated

1. User triggers recovery from `/account/security/recover`.
2. System sends a code to the user's verified email + phone.
3. User enters the code + reconstructs the Shamir share from device + 2 trusted contacts.
4. New passkey is registered; old sessions revoked.

## Institutional

1. Two custodians initiate a recovery ceremony.
2. Three-of-five Shamir shares are presented offline to the HSM.
3. Master key is reconstructed inside the HSM; new rotation key generated.
4. Old key marked "retired" with grace period.
5. Audit event emitted.

## Lost master key

This is a **SEV-1** scenario.

1. Activate the recovery quorum (5-of-9 board members, 24h time-lock).
2. Generate a new master key in HSM.
3. Rotate every user account's key share (rolling re-encryption).
4. Communicate to users; provide a one-time re-enrollment window.

> Master key loss without quorum recovery is unrecoverable by design.
