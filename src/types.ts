export interface UserProfile {
  username: string;
  displayName: string;
  avatar: string;
  online: boolean;
  lastSeen?: any;
  password?: string;
  isVip?: boolean;
  role?: 'user' | 'moderator' | 'admin' | 'owner';
  isBanned?: boolean;
}

export interface Message {
  id: string;
  room: string;
  username: string;
  text?: string;
  image?: string;
  audio?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  replyTo?: string;
  isVip?: boolean;
  isEdited?: boolean;
  isPinned?: boolean;
  reactions?: Record<string, string>; // { username: emoji }
  createdAt?: any;
}

export interface CallSession {
  id: string;
  room: string;
  caller: string;
  receiver: string;
  type: 'voice' | 'video';
  status: 'calling' | 'accepted' | 'declined' | 'ended';
  offer?: any;
  answer?: any;
  createdAt?: any;
}

export interface TypingState {
  user: string;
  room: string;
  time?: any;
}

export interface AdminLog {
  id?: string;
  action: string;
  targetUser: string;
  performedBy: string;
  timestamp: any;
}

