# ELIM — Security & Functionality Policy

**Version 1.0 — July 2026**

This document defines the rules ELIM is built and operated under, and maps each rule to where it's actually enforced in the codebase (Firestore rules, Storage rules, or application code). Where a control isn't implemented yet, it's listed under **Roadmap** rather than silently omitted.

---

## 1. Purpose & Scope

ELIM is a community app where **churches publish** (text, images, audio, video, documents) and **members read, like, and comment**. This policy covers account security, access control, content moderation, file handling, and data privacy for that model.

---

## 2. Roles & Access Control

Four roles, enforced server-side in `firestore.rules` (never trusted from the client alone):

| Role | Can publish posts | Can moderate | Notes |
|---|---|---|---|
| `member` | No | No | Default role on signup |
| `pending_church` | No | No | A church signup awaiting admin approval |
| `church` | Yes (own posts only) | Own posts only | Granted only by an admin approval |
| `admin` | Yes | Any post, any church approval | Never self-assignable — see §3 |

**Principle of least privilege:** every write is scoped to "your own data" by default. The only cross-user writes allowed are an admin approving/denying a pending church, and an admin removing a post that violates policy.

---

## 3. Authentication

- **Email/password and Google Sign-In** are the two supported methods.
- **No client can assign itself `church` or `admin`.** Account creation is restricted to `member` or `pending_church` at the rules level, regardless of what the client sends. `church` only happens via admin approval; `admin` only via direct console action by the project owner (there is intentionally no in-app path to grant it — this is a bootstrap step, not a feature).
- **Password minimum length: 8 characters** (raised from an earlier 6-character minimum to align with current NIST 800-63B guidance, which favors length over forced complexity/rotation rules).
- **Email verification is encouraged, not required.** A verification email is sent automatically on signup, and a persistent (non-blocking) banner reminds an unverified user to check their inbox. Deliberately, verification does **not** gate publishing or any other action — for a low-stakes community app, we chose immediate access over adding friction to signup. This is a real tradeoff, not an oversight: it trades some identity assurance for a smoother first experience. If ELIM later needs stronger identity assurance (e.g. handling payments/giving), this is the first control to revisit.
- **Password reset** is self-service via Firebase's standard reset-email flow.

---

## 4. Content & Moderation

- Only `church`/`admin` roles may create posts; enforced in `firestore.rules`, not just hidden buttons.
- **A church can remove its own posts.** An **admin can remove any post**, for moderation.
- Comments can be removed by their author. (Admin-removal of comments is on the roadmap — see §9.)
- **Prohibited content** (policy-level, enforced by moderation rather than automated filtering at this stage): hate speech, harassment or bullying, sexually explicit material, content that endangers or exposes a minor without guardian consent, illegal content, and spam/scams.
- **Minors:** ELIM is not directed at children under 13, and churches must not publish content that identifies or exposes an unaccompanied minor without a guardian's consent. This is a policy-level rule for church admins today; automated enforcement is not yet built (see Roadmap).

---

## 5. File Uploads & Storage

Members and churches can upload real files (not just paste a URL). Every upload is validated **twice** — once client-side for fast feedback, and again at the Storage rules layer, which is the layer that actually matters since client-side checks can be bypassed.

| Category | Allowed types | Max size |
|---|---|---|
| Profile picture | JPEG, PNG, WebP | 5 MB |
| Post image | JPEG, PNG, WebP, GIF | 10 MB |
| Post audio | MP3, M4A, WAV, OGG | 50 MB |
| Post video | MP4, WebM, MOV | 200 MB |
| Post document | PDF | 20 MB |

- Uploads are written to a path scoped to the uploader's own user ID (`profile-pictures/{uid}/...`, `post-media/{uid}/...`); Storage rules reject any attempt to write outside your own folder.
- Read access is public, matching the fact that the feed itself is visible to any signed-in member — files are not a separate trust boundary from the posts that reference them.
- **Malware/virus scanning is not implemented** — see Roadmap. This is a real gap for any file-upload feature and is called out rather than glossed over.

---

## 6. Data Collected

Email, display name, role, and (for churches) a church name and city/state — plus, now, an optional profile picture. No payment data, no precise geolocation, no health data. Google Sign-In shares only the name/email/profile photo Google itself provides.

---

## 7. Session & Account Security

- Firebase-managed sessions (industry-standard token refresh/expiry; not custom-built).
- No account deletion / data export flow yet — see Roadmap.

---

## 8. Change Management

Any change to `firestore.rules` or Storage rules is reviewed against this document before publishing, since the rules — not the UI — are the actual security boundary.

---

## 9. Roadmap (known gaps, not yet built)

- Content **reporting** (flag a post/comment for admin review)
- **Rate limiting** / abuse prevention (needs a Cloud Function + App Check; can't be done in Firestore/Storage rules alone)
- **Malware scanning** on uploaded files
- **Account deletion & data export** (GDPR/CCPA-style self-service)
- **Admin ability to remove comments**, not just posts
- Optional **MFA** for admin accounts specifically
- Structured audit logging for admin actions (approvals, deletions)

---

*This policy describes the system as of the commit that introduced it. If you change the roles, the upload limits, or the moderation model, update this file in the same change.*
