// 'pastor' carries the same privileges as 'admin' (approvals, logs, etc.)
// but is a distinct role so pastoral message threads can be routed to the
// pastor specifically, separate from technical support.
export type UserRole = "member" | "church" | "pending_church" | "admin" | "pastor";

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
  churchName?: string;
  location?: string;
  country?: string;
  city?: string;
  phone?: string;
  avatar?: string;
  createdAt?: any;
  // For members: which church they picked at signup (from the public
  // directory), or undefined if they picked "Other".
  memberChurchId?: string;
  memberChurchName?: string;
  // Stored as an ISO date string ('1990-04-23') rather than a Date object:
  // Firestore would return a Timestamp we'd have to convert on every read,
  // and we never do date arithmetic on this beyond the age check at signup.
  phoneVerified?: boolean;
  dateOfBirth?: string;
  gender?: 'homme' | 'femme';
  profession?: string;
  quartier?: string;
  // Church departments the person belongs to or wants to join. An array
  // because people commonly serve in more than one.
  interests?: string[];
  // Push notifications
  notificationsEnabled?: boolean;
  fcmTokens?: string[];
}

export interface ChurchProfile {
  id: string;
  name: string;
  location: string;
  avatar: string;
  followers: number;
  verified: boolean;
  ownerId?: string;
}

export interface Post {
  // The individual who published, kept alongside churchName. With one church
  // every post would otherwise carry an identical name, so nothing on screen
  // would say who actually wrote it.
  authorName?: string;
  authorId?: string;
  // Which surface this post belongs to. Health posts are ordinary posts with
  // a marker rather than a separate collection, so they inherit the entire
  // media pipeline - uploads, embeds, the global audio player, zoom,
  // downloads, likes and comments - instead of duplicating it.
  section?: 'feed' | 'sante' | 'musique';
  category?: string;
  id: string;
  churchId: string;
  churchName?: string;
  churchAvatar?: string;
  type: "text-image" | "audio" | "video" | "youtube" | "facebook" | "document";
  content: string;
  mediaUrl?: string;
  coverUrl?: string;
  fileName?: string;
  likes: number;
  commentsCount: number;
  createdAt: any;
}

export type ActivityAction =
  | 'signin' | 'signup'
  | 'post_created' | 'post_edited' | 'post_deleted'
  | 'church_approved' | 'church_denied'
  | 'directory_synced'
  | 'like_added' | 'like_removed' | 'comment_added';

export interface ActivityLog {
  id: string;
  action: ActivityAction;
  userId: string;
  userName: string;
  userRole: string;
  // Human-readable context, e.g. the church name approved or a post excerpt.
  detail?: string;
  createdAt?: any;
}

// Two shapes of conversation:
//  - 'support': a member's thread with the church/support team. Any church
//    or admin account can see and reply to these - it's a shared inbox, not
//    a thread with one specific staff member.
//  - 'direct': a one-to-one thread between two specific accounts. Only
//    church/admin accounts can start these.
export interface Conversation {
  id: string;
  // 'pastor' and 'tech' are the two support channels every member and
  // church can open. 'direct' is a one-to-one thread started by staff.
  type: 'pastor' | 'tech' | 'direct';
  // For 'support' this is just [memberUid]; staff access is granted by role
  // rather than membership, so any staff member can pick up the thread.
  participantIds: string[];
  participantNames: Record<string, string>;
  participantAvatars?: Record<string, string>;
  // Role of the non-staff side, so the inbox can badge a thread without a
  // second lookup on the user document.
  ownerRole?: string;
  lastMessage?: string;
  lastMessageAt?: any;
  lastSenderId?: string;
  // uid -> timestamp of when that user last opened the thread. Used to show
  // unread state without needing a separate per-user counter document.
  readBy?: Record<string, any>;
  createdAt?: any;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  text: string;
  // Optional attachment. 'image' and 'audio' are uploaded to Storage under
  // message-media/{senderUid}/ and referenced by download URL.
  mediaUrl?: string;
  mediaType?: 'image' | 'audio';
  mediaDuration?: number;
  editedAt?: any;
  // Denormalized from the parent conversation so security rules can check
  // access on the message itself, without an expensive get() on every single
  // message read.
  participantIds: string[];
  createdAt?: any;
}

export interface Comment {
  id: string;
  postId: string;
  userName: string;
  userAvatar?: string;
  text: string;
  createdAt: any;
  userId?: string;
  // Set when this comment is a reply to another comment. Replies are kept one
  // level deep: a reply to a reply points at the same top-level parent.
  parentId?: string;
  // Denormalised like counter (mirrors Post.likes). The authoritative per-user
  // state lives in the commentLikes collection.
  likes?: number;
}


// An in-app notification shown in the bell. Created ONLY by Cloud Functions
// (so it can't be forged by a client) whenever someone likes or comments on
// something the recipient authored. "New post" alerts are NOT stored here -
// they're derived client-side from a last-seen timestamp to avoid a per-user
// write for every post.
export interface AppNotification {
  id: string;
  recipientId: string;
  type: 'post_like' | 'comment_like' | 'post_comment' | 'comment_reply';
  actorId: string;
  actorName: string;
  actorAvatar?: string;
  postId: string;
  commentId?: string;
  preview?: string;
  read: boolean;
  createdAt: any;
}


// Donation details, editable by an admin and shown to everyone in the
// donation sheet. Stored as a single doc at config/donation.
//
// Two kinds of payment method:
//  - 'number': a mobile-money number (Wave, Orange Money, Moov Money) the
//    person copies and pays from their own money app. The original kind;
//    providers without a `kind` are treated as 'number' for backward compat.
//  - 'link': an external payment page (PayPal, Cash App, a card checkout
//    link from a processor). The app only OPENS the link in the system
//    browser - it never collects card details itself, which keeps it out of
//    PCI scope and clear of Play's payment rules (charitable donations are
//    exempt from Play Billing, but checkout still must not happen in-app).
export interface DonationProvider {
  id: string;
  label: string;      // e.g. "Wave", "PayPal", "Carte bancaire"
  kind?: 'number' | 'link';
  number: string;     // for kind 'number': the phone number money is sent to
  url?: string;       // for kind 'link': the external payment page
  holder?: string;    // account holder name
  note?: string;      // free-text instructions
}
export interface DonationConfig {
  title?: string;
  message?: string;
  // Thank-you sent into the donor's Messages (from Centre Chrétien E.L.I.M.)
  // after they declare a donation. Sent server-side by a Cloud Function so it
  // can't be forged; editable here so the church can word it.
  thanksMessage?: string;
  providers: DonationProvider[];
}

// A donation DECLARED by a member after paying outside the app. The app never
// sees the money move (mobile money / PayPal / cards all settle elsewhere),
// so this self-declaration is what triggers the thank-you message and feeds
// the treasurer's reconciliation ledger in the Admin tab. `verified` is set
// by staff once the payment is matched against a statement.
export type DonationType = 'dime' | 'offrande' | 'autre';
export interface Donation {
  id: string;
  donorId: string;
  donorName: string;
  type: DonationType;
  // Free text: what the donation is for (construction, missions, ...).
  purpose?: string;
  // Free text amount as the donor typed it ("10 000 FCFA", "$50") - currencies
  // vary too much across mobile money / PayPal / Cash App to force a number.
  amount?: string;
  methodId?: string;
  methodLabel?: string;
  status: 'declared' | 'verified';
  verifiedById?: string;
  verifiedByName?: string;
  verifiedAt?: any;
  createdAt: any;
}


export interface Book {
  id: string;
  title: string;
  author?: string;
  category: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  sizeBytes?: number;
  pageCount?: number;
  uploadedById: string;
  uploadedByName: string;
  createdAt?: any;
}


// ==================== SAFETY REPORTS ====================
//
// User reports of harmful content. Required by Google Play's child safety
// standards policy for social apps: people must be able to report child
// safety concerns from inside the app, not only by email.
//
// 'child_safety' is deliberately the first reason offered, and is what the
// published standards page at /child-safety.html points people to.
export type ReportReason =
  | 'child_safety'
  | 'sexual'
  | 'violence'
  | 'harassment'
  | 'spam'
  | 'other';

export type ReportTargetType = 'post' | 'comment' | 'message' | 'user';

export interface Report {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  // Who authored the reported content, so staff can act on the account.
  targetOwnerId?: string;
  targetOwnerName?: string;
  reason: ReportReason;
  // Optional free text from the reporter.
  details?: string;
  // Snapshot of the reported content, so a report stays reviewable even if
  // the original is deleted before staff get to it.
  preview?: string;
  reporterId: string;
  reporterName: string;
  status: 'open' | 'actioned' | 'dismissed';
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: any;
  createdAt: any;
}
