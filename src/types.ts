export type UserRole = "member" | "church";

export interface ChurchProfile {
  id: string;
  name: string;
  location: string;
  avatar: string;
  followers: number;
  verified: boolean;
}

export interface Post {
  id: string;
  churchId: string;
  churchName?: string;
  type: "text-image" | "audio" | "video";
  content: string;
  mediaUrl?: string;
  coverUrl?: string;
  likes: number;
  commentsCount: number;
  createdAt: any;
  liked?: boolean;
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
