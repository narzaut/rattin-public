// lib/plugins/pubkey.ts
// Dev Ed25519 public key (DER-encoded SPKI, base64).
// This is a throwaway dev key for testing. It MUST be replaced with a production
// keypair generated in CI before public release. See the private plugin repo plan.
//
// The matching dev private key is in test/fixtures/dev-private-key.json (not shipped).

const PUBKEY_BASE64 = "MCowBQYDK2VwAyEAvOdSd7xl7A+zw9Gyy9fVW919slAHk7XKWGIat7ffNls=";

export const PLUGIN_PUBKEY_DER = Buffer.from(PUBKEY_BASE64, "base64");
