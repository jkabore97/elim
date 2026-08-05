import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult
} from 'firebase/auth'
import { auth } from './firebase'

// One-time SMS verification at signup only. Sign-in afterwards is unchanged:
// phone number + PIN, via the synthetic email address.
//
// The trick that makes both work on ONE account:
//   1. signInWithPhoneNumber() verifies the number and signs the person in as
//      a phone-auth user.
//   2. We then LINK an email/password credential (synthetic email + their PIN)
//      onto that same account.
// The result is a single Firebase user carrying both a verified phone number
// and email/password credentials - so the existing PIN sign-in keeps working
// untouched. Creating a separate email/password account instead would have
// left two unrelated users and verified nothing.

let verifier: RecaptchaVerifier | null = null

// Firebase requires a reCAPTCHA challenge before sending any SMS - it's the
// abuse control that stops someone draining an SMS quota. 'invisible' means
// it resolves silently unless the request looks suspicious.
function getVerifier(): RecaptchaVerifier {
  if (verifier) return verifier

  let host = document.getElementById('recaptcha-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'recaptcha-host'
    document.body.appendChild(host)
  }

  verifier = new RecaptchaVerifier(auth, host, { size: 'invisible' })
  return verifier
}

// A number must be in E.164 form (+22670000000) for Firebase to accept it.
export function toE164(countryCode: string, phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const cc = countryCode.replace(/\D/g, '')
  return `+${cc}${digits}`
}

export async function sendVerificationCode(
  countryCode: string,
  phone: string
): Promise<{ ok: true; confirmation: ConfirmationResult } | { ok: false; error: string }> {
  try {
    const result = await signInWithPhoneNumber(auth, toE164(countryCode, phone), getVerifier())
    return { ok: true, confirmation: result }
  } catch (err: any) {
    // The verifier is single-use once it has failed; clearing it means the
    // next attempt starts from a clean challenge instead of erroring forever.
    try { verifier?.clear() } catch { /* ignore */ }
    verifier = null

    const code = err?.code || ''
    if (code === 'auth/invalid-phone-number') return { ok: false, error: 'INVALID_NUMBER' }
    if (code === 'auth/too-many-requests') return { ok: false, error: 'TOO_MANY' }
    if (code === 'auth/quota-exceeded') return { ok: false, error: 'QUOTA' }
    return { ok: false, error: err?.message || 'UNKNOWN' }
  }
}

export async function confirmVerificationCode(
  confirmation: ConfirmationResult,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await confirmation.confirm(code)
    return { ok: true }
  } catch (err: any) {
    const c = err?.code || ''
    if (c === 'auth/invalid-verification-code') return { ok: false, error: 'BAD_CODE' }
    if (c === 'auth/code-expired') return { ok: false, error: 'EXPIRED' }
    return { ok: false, error: err?.message || 'UNKNOWN' }
  }
}

// Called once signup completes (or is abandoned) so a later attempt gets a
// fresh challenge rather than reusing a spent one.
export function resetVerifier() {
  try { verifier?.clear() } catch { /* ignore */ }
  verifier = null
}
