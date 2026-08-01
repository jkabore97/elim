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

export interface Comment {
  id: string;
  postId: string;
  userName: string;
  userAvatar?: string;
  text: string;
  createdAt: any;
  userId?: string;
}
