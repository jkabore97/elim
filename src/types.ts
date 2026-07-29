export type UserRole = "member" | "church";

export interface ChurchProfile {
  id: string;
  name: string;
  location: string;
  avatar: string;
  followers: number;
  verified: boolean;
  role?: UserRole;
}

export interface Post {
  id: string;
  churchId: string;
  type: "text-image" | "audio" | "video";
  content: string;
  mediaUrl?: string;
  coverUrl?: string;
  likes: number;
  commentsCount: number;
  createdAt: string;
  liked?: boolean;
}

export interface Comment {
  id: string;
  postId: string;
  userName: string;
  userAvatar: string;
  text: string;
  createdAt: string;
  userId?: string;
}
