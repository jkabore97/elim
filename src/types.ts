export type UserRole = "member" | "church" | "pending_church" | "admin";

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
  | 'directory_synced';

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
  type: 'support' | 'direct';
  // For 'support' this is just [memberUid]; staff access is granted by role
  // rather than membership, so any staff member can pick up the thread.
  participantIds: string[];
  participantNames: Record<string, string>;
  participantAvatars?: Record<string, string>;
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
}
