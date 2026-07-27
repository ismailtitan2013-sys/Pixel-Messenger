import React, { useState, useEffect, useRef } from 'react';
import { db } from './firebase';
import { AuthScreen } from './components/auth/AuthScreen';
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  getDocs,
  where
} from 'firebase/firestore';
import { UserProfile, Message, CallSession } from './types';

// Helper function to resize images using HTML5 Canvas to prevent excessive payload sizes
function resizeImage(file: File, maxWidth: number, maxHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL(file.type || 'image/jpeg', 0.85));
        } else {
          reject(new Error('Canvas context not available'));
        }
      };
      img.onerror = reject;
      img.src = event.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Simple Web Audio Ringtone Generator for Calls
function playRingtoneSound() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.8);
  } catch (e) {
    // Ignore audio context autoplay policy restrictions
  }
}

export default function App() {
  // Application state
  const [myUsername, setMyUsername] = useState<string | null>(() => {
    try {
      return localStorage.getItem('myUsername');
    } catch {
      return null;
    }
  });
  const [theme, setTheme] = useState<'dark' | 'light' | 'amoled'>(() => {
    try {
      return (localStorage.getItem('tgTheme') as 'dark' | 'light' | 'amoled') || 'dark';
    } catch {
      return 'dark';
    }
  });
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  const [currentChatRoom, setCurrentChatRoom] = useState<string | null>(null);
  const [geminiKey, setGeminiKey] = useState(() => {
    try {
      return localStorage.getItem('geminiKey') || '';
    } catch {
      return '';
    }
  });
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [replyingToMessage, setReplyingToMessage] = useState<{ text: string } | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<string | null>(null);

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileEditName, setProfileEditName] = useState('');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');

  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  // Admin VIP Panel state
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');

  // Recording voice state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Call state
  const [currentCall, setCurrentCall] = useState<CallSession | null>(null);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  // WebRTC state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.services.mozilla.com' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  };

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, currentCall]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch((e) => console.log('Video play error:', e));
    }
  }, [remoteStream, currentCall]);

  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch((e) => console.log('Audio play error:', e));
    }
  }, [remoteStream]);

  const cleanupCall = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setCurrentCall(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOff(false);
  };

  // Typing state
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [usersProfiles, setUsersProfiles] = useState<Record<string, UserProfile>>({});

  const chatBoxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isMilkyVip = myUsername === 'MilkyVIP' || (myUsername && usersProfiles[myUsername]?.isVip === true);
  const isCurrentBanned = myUsername ? usersProfiles[myUsername]?.isBanned === true : false;

  // --- Theme Sync ---
  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('tgTheme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'amoled' : theme === 'amoled' ? 'light' : 'dark');
  };

  // --- Animated Canvas Background ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let particles: Array<{ x: number; y: number; vx: number; vy: number; radius: number }> = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        radius: Math.random() * 1.5 + 0.6
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const isDark = document.body.getAttribute('data-theme') === 'dark';
      ctx.fillStyle = isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(37, 99, 235, 0.1)';

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx = -p.vx;
        if (p.y < 0 || p.y > canvas.height) p.vy = -p.vy;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [theme]);

  // --- Global Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsProfileOpen(false);
        setIsAdminOpen(false);
        setLightboxImg(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Auth Handlers ---
  const handleRegister = async () => {
    const u = usernameInput.trim();
    const p = passwordInput.trim();
    if (!u || !p) return alert('Заполните поля');

    // VIP Account Special Verification
    const isVipAcc = u === 'MilkyVIP';
    if (isVipAcc && p !== 'A0812a20') {
      return alert('Неверный пароль для VIP аккаунта MilkyVIP!');
    }

    try {
      const ref = doc(db, 'users', u);
      const snap = await getDoc(ref);
      if (snap.exists()) return alert('Юзер занят');
      await setDoc(ref, {
        displayName: isVipAcc ? 'MilkyVIP' : u,
        password: p,
        avatar: '',
        online: true,
        isVip: isVipAcc,
        isBanned: false,
        lastSeen: serverTimestamp()
      });
      localStorage.setItem('myUsername', u);
      setMyUsername(u);
    } catch (err: any) {
      alert('Ошибка при регистрации: ' + err.message);
    }
  };

  const handleLogin = async () => {
    const u = usernameInput.trim();
    const p = passwordInput.trim();
    if (!u || !p) return alert('Заполните поля');

    const isVipAcc = u === 'MilkyVIP';

    try {
      const ref = doc(db, 'users', u);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        // Auto-provision MilkyVIP account with required password
        if (isVipAcc && p === 'A0812a20') {
          await setDoc(ref, {
            displayName: 'MilkyVIP',
            password: p,
            avatar: '',
            online: true,
            isVip: true,
            isBanned: false,
            lastSeen: serverTimestamp()
          });
          localStorage.setItem('myUsername', u);
          setMyUsername(u);
          return;
        }
        return alert('Пользователь не найден');
      }

      const userData = snap.data();
      if (userData.password !== p) {
        return alert('Неверный пароль');
      }

      if (userData.isBanned) {
        return alert('🚫 Ваш аккаунт заблокирован администратором!');
      }

      await updateDoc(ref, { online: true, isVip: isVipAcc || userData.isVip, lastSeen: serverTimestamp() });
      localStorage.setItem('myUsername', u);
      setMyUsername(u);
    } catch (err: any) {
      alert('Ошибка при входе: ' + err.message);
    }
  };

  const handleLogout = async () => {
    if (myUsername) {
      try {
        await updateDoc(doc(db, 'users', myUsername), { online: false, lastSeen: serverTimestamp() });
      } catch (e) {
        console.error(e);
      }
    }
    localStorage.removeItem('myUsername');
    setMyUsername(null);
  };

  // --- Online Presence Heartbeat ---
  useEffect(() => {
    if (!myUsername) return;

    const isVipAcc = myUsername === 'MilkyVIP';

    const updatePresence = async (isOnline: boolean) => {
      try {
        await setDoc(
          doc(db, 'users', myUsername),
          { online: isOnline, isVip: isVipAcc, lastSeen: serverTimestamp() },
          { merge: true }
        );
      } catch (e) {
        console.error('Error updating presence', e);
      }
    };

    updatePresence(true);
    const interval = setInterval(() => updatePresence(true), 30000);

    const handleBeforeUnload = () => {
      updatePresence(false);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [myUsername]);

  // --- Realtime Users & Dialogs Listener ---
  useEffect(() => {
    if (!myUsername) return;

    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const profiles: Record<string, UserProfile> = {};
      snapshot.forEach((docSnap) => {
        profiles[docSnap.id] = { username: docSnap.id, ...docSnap.data() } as UserProfile;
      });
      setUsersProfiles(profiles);

      // Default select first available user if no active room
      if (!currentChatRoom) {
        const otherUsers = Object.keys(profiles).filter((u) => u !== myUsername);
        if (otherUsers.length > 0) {
          const firstUser = otherUsers[0];
          const members = [myUsername, firstUser].sort();
          const roomId = `pm_${members[0]}_${members[1]}`;
          setCurrentChatRoom(roomId);
          setSelectedUser(profiles[firstUser]);
        }
      } else if (selectedUser) {
        // Keep selected user fresh
        const updated = profiles[selectedUser.username];
        if (updated) setSelectedUser(updated);
      }
    });

    return () => unsubscribe();
  }, [myUsername, currentChatRoom]);

  // --- Realtime Messages Listener ---
  useEffect(() => {
    if (!myUsername) return;

    const q = query(collection(db, 'messages'), orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded: Message[] = [];
      snapshot.forEach((docSnap) => {
        loaded.push({ id: docSnap.id, ...docSnap.data() } as Message);
      });
      setMessages(loaded);
    });

    return () => unsubscribe();
  }, [myUsername]);

  // --- Realtime Calls Listener ---
  useEffect(() => {
    if (!myUsername) return;

    const unsubscribe = onSnapshot(collection(db, 'calls'), (snapshot) => {
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as CallSession;
        const callObj = { id: docSnap.id, ...data };

        if ((data.caller === myUsername || data.receiver === myUsername) && data.status !== 'ended' && data.status !== 'declined') {
          setCurrentCall(prev => {
             if (data.caller === myUsername && data.answer && peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'stable') {
                peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(console.error);
             }
             return callObj;
          });
          if (data.status === 'calling' && data.receiver === myUsername) {
            playRingtoneSound();
          }
        } else if (currentCall && currentCall.id === docSnap.id && (data.status === 'ended' || data.status === 'declined')) {
          cleanupCall();
        }
      });
    });

    return () => unsubscribe();
  }, [myUsername, currentCall]);

  // Handle remote ICE candidates
  useEffect(() => {
    if (!currentCall || !peerConnectionRef.current) return;
    const isCaller = currentCall.caller === myUsername;
    const candidatesCollection = isCaller ? 'calleeCandidates' : 'callerCandidates';
    
    const unsubscribe = onSnapshot(collection(db, 'calls', currentCall.id, candidatesCollection), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const candidate = new RTCIceCandidate(change.doc.data());
          peerConnectionRef.current?.addIceCandidate(candidate).catch(console.error);
        }
      });
    });
    
    return () => unsubscribe();
  }, [currentCall, myUsername]);

  // --- Call Timer Counter ---
  useEffect(() => {
    let timer: any = null;
    if (currentCall && currentCall.status === 'accepted') {
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(timer);
  }, [currentCall?.status]);

  // --- Scroll Chat Box to Bottom ---
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, currentChatRoom]);

  // Handle Mute & Video Toggles
  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
  }, [isMuted, localStream]);

  useEffect(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !isVideoOff;
      });
    }
  }, [isVideoOff, localStream]);

  // --- Realtime Typing Indicator Listener ---
  useEffect(() => {
    if (!myUsername || !currentChatRoom) return;

    const unsubscribe = onSnapshot(collection(db, 'typing'), (snapshot) => {
      const typers: string[] = [];
      snapshot.forEach((d) => {
        const dat = d.data();
        if (dat.user !== myUsername && dat.room === currentChatRoom) {
          const p = usersProfiles[dat.user];
          typers.push(p ? p.displayName : dat.user);
        }
      });
      setTypingUsers(typers);
    });

    return () => unsubscribe();
  }, [myUsername, currentChatRoom, usersProfiles]);

  // --- Admin Moderation Actions ---
  const handleToggleBanUser = async (targetUser: string, currentBannedState: boolean) => {
    if (!isMilkyVip) return;
    if (targetUser === 'MilkyVIP') return alert('Нельзя заблокировать Главного Админа!');

    try {
      await updateDoc(doc(db, 'users', targetUser), { isBanned: !currentBannedState });
      alert(`Пользователь ${targetUser} ${!currentBannedState ? 'успешно заблокирован! 🚫' : 'разблокирован! ✅'}`);
    } catch (e: any) {
      alert('Ошибка бана: ' + e.message);
    }
  };

  const handleDeleteUserMessages = async (targetUser: string) => {
    if (!isMilkyVip) return;
    if (!confirm(`Вы уверены, что хотите удалить ВСЕ сообщения пользователя @${targetUser}?`)) return;

    try {
      const q = query(collection(db, 'messages'), where('username', '==', targetUser));
      const querySnap = await getDocs(q);
      let count = 0;
      for (const docItem of querySnap.docs) {
        await deleteDoc(doc(db, 'messages', docItem.id));
        count++;
      }
      alert(`Удалено ${count} сообщений пользователя @${targetUser}`);
    } catch (e: any) {
      alert('Ошибка удаления сообщений: ' + e.message);
    }
  };

  const handleDeleteUserAccount = async (targetUser: string) => {
    if (!isMilkyVip) return;
    if (targetUser === 'MilkyVIP') return alert('Нельзя удалить аккаунт MilkyVIP!');
    if (!confirm(`Удалить полностью аккаунт @${targetUser} из базы данных?`)) return;

    try {
      await deleteDoc(doc(db, 'users', targetUser));
      alert(`Аккаунт @${targetUser} был полностью удален.`);
    } catch (e: any) {
      alert('Ошибка удаления аккаунта: ' + e.message);
    }
  };

  const handleSendBroadcast = async () => {
    if (!isMilkyVip || !broadcastText.trim()) return alert('Введите текст объявления');

    try {
      const announceText = `📢 [ОФИЦИАЛЬНОЕ ОБЪЯВЛЕНИЕ МИЛКИ VIP]\n${broadcastText.trim()}`;
      setPinnedMessage(announceText);

      // Send broadcast to current active room
      if (currentChatRoom) {
        await sendMessage({ text: announceText });
      }

      setBroadcastText('');
      alert('Объявление отправлено и закреплено!');
    } catch (e: any) {
      alert('Ошибка отправки объявления: ' + e.message);
    }
  };

  // --- Call Control Actions ---
  const handleStartCall = async (type: 'voice' | 'video') => {
    if (isCurrentBanned) return alert('Ваш аккаунт заблокирован');
    if (!selectedUser || !currentChatRoom || !myUsername) return alert('Выберите собеседника');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      setLocalStream(stream);

      const pc = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const callRef = await addDoc(collection(db, 'calls'), {
        room: currentChatRoom,
        caller: myUsername,
        receiver: selectedUser.username,
        type,
        status: 'calling',
        offer: { type: offer.type, sdp: offer.sdp },
        createdAt: serverTimestamp()
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(collection(db, 'calls', callRef.id, 'callerCandidates'), event.candidate.toJSON());
        }
      };

      setCurrentCall({
        id: callRef.id,
        room: currentChatRoom,
        caller: myUsername,
        receiver: selectedUser.username,
        type,
        status: 'calling'
      });
    } catch (e: any) {
      alert('Ошибка совершения звонка: ' + e.message);
    }
  };

  const handleAcceptCall = async () => {
    if (!currentCall) return;
    try {
      // 1. Get media stream FIRST to preserve user gesture context on iOS Safari
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: currentCall.type === 'video' });
      setLocalStream(stream);

      // 2. Fetch offer data from Firestore
      const callDocSnap = await getDoc(doc(db, 'calls', currentCall.id));
      const callData = callDocSnap.data();
      if (!callData || !callData.offer) return alert('Ошибка соединения: звонок завершен');

      const pc = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(collection(db, 'calls', currentCall.id, 'calleeCandidates'), event.candidate.toJSON());
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await updateDoc(doc(db, 'calls', currentCall.id), { 
        status: 'accepted',
        answer: { type: answer.type, sdp: answer.sdp }
      });
      setCurrentCall({ ...currentCall, status: 'accepted' });
    } catch (e: any) {
      console.error(e);
      alert('Не удалось принять звонок: ' + (e.message || 'Ошибка разрешения микрофона'));
    }
  };

  const handleDeclineCall = async () => {
    if (!currentCall) return;
    try {
      await updateDoc(doc(db, 'calls', currentCall.id), { status: 'declined' });
      cleanupCall();
    } catch (e) {
      console.error(e);
    }
  };

  const handleEndCall = async () => {
    if (!currentCall) return;
    try {
      await updateDoc(doc(db, 'calls', currentCall.id), { status: 'ended' });

      if (currentChatRoom) {
        const formatSecs = `${Math.floor(callDuration / 60)}:${(callDuration % 60).toString().padStart(2, '0')}`;
        await sendMessage({
          text: `📞 ${currentCall.type === 'video' ? 'Видеозвонок' : 'Голосовой звонок'} (${callDuration > 0 ? 'Длительность: ' + formatSecs : 'Звонок завершен'})`
        });
      }

      cleanupCall();
    } catch (e) {
      console.error(e);
    }
  };

  // --- Send Message Payload ---
  const sendMessage = async (payload: Partial<Message>) => {
    if (isCurrentBanned) return alert('Ваш аккаунт заблокирован');
    if (!currentChatRoom || !myUsername) return;

    const isVipMsg = myUsername === 'MilkyVIP' || usersProfiles[myUsername]?.isVip === true;

    const finalPayload: any = {
      ...payload,
      room: currentChatRoom,
      username: myUsername,
      isVip: isVipMsg,
      createdAt: serverTimestamp()
    };

    if (replyingToMessage) {
      finalPayload.replyTo = replyingToMessage.text;
      setReplyingToMessage(null);
    }

    try {
      await addDoc(collection(db, 'messages'), finalPayload);

      // Check if message is for AI Assistant with mixed keyboard layout normalization
      const text = (payload.text || '').trim();
      const textLower = text.toLowerCase();

      // Normalize lookalike Cyrillic characters (e.g. Cyrillic 'а' -> Latin 'a')
      const normalizedText = textLower
        .replace(/а/g, 'a')
        .replace(/с/g, 'c')
        .replace(/е/g, 'e')
        .replace(/о/g, 'o')
        .replace(/р/g, 'p')
        .replace(/х/g, 'x');

      const isAiTrigger =
        normalizedText.startsWith('@ai') ||
        normalizedText.startsWith('@bot') ||
        textLower.startsWith('@ии') ||
        textLower.startsWith('@бот') ||
        textLower.startsWith('ии,') ||
        textLower.startsWith('ai,');

      let aiPrompt = '';
      if (isAiTrigger) {
        if (normalizedText.startsWith('@ai')) aiPrompt = text.substring(3).trim();
        else if (normalizedText.startsWith('@bot')) aiPrompt = text.substring(4).trim();
        else if (textLower.startsWith('@ии')) aiPrompt = text.substring(3).trim();
        else if (textLower.startsWith('@бот')) aiPrompt = text.substring(5).trim();
        else if (textLower.startsWith('ии,')) aiPrompt = text.substring(3).trim();
        else if (textLower.startsWith('ai,')) aiPrompt = text.substring(3).trim();
        else aiPrompt = text.replace(/^[@а-яa-z,]+/, '').trim();
      }

      if (isAiTrigger) {
        let aiReply = '';
        const promptText = aiPrompt || 'Привет!';

        if (geminiKey) {
          try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                systemInstruction: { parts: [{ text: 'Ты дружелюбный и умный ИИ-помощник в мессенджере Pixel Messenger. Твой создатель - Milky VIP. Отвечай весело, кратко, используй эмодзи.' }] }
              })
            });
            const data = await res.json();
            aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          } catch (e) {
            console.error('Gemini API call failed:', e);
          }
        }

        if (!aiReply) {
          // Smart offline fallback response generator if API key is not set or request failed
          const lowerPrompt = promptText.toLowerCase();
          if (lowerPrompt.includes('привет') || lowerPrompt.includes('здравствуй') || lowerPrompt.includes('хай') || lowerPrompt.includes('hello') || lowerPrompt.includes('hi')) {
            aiReply = 'Привет! 👋 Я ваш ИИ-Помощник в Pixel Messenger. Чем могу помочь? ✨';
          } else if (lowerPrompt.includes('кто ты') || lowerPrompt.includes('создатель') || lowerPrompt.includes('кто тебя создал')) {
            aiReply = 'Я умный ИИ-Помощник Pixel Messenger! 🤖 Мой создатель — легендарный Milky VIP 👑';
          } else if (lowerPrompt.includes('как дела')) {
            aiReply = 'У меня всё отлично, работаю на 100% мощности! ⚡ А как твои дела?';
          } else {
            aiReply = `🤖 Я умный ИИ-Помощник! Твой запрос: "${promptText}". Укажи ключ Gemini API в АДМИН-панели для полной генерации ответов! 🚀`;
          }
        }

        await addDoc(collection(db, 'messages'), {
          room: currentChatRoom,
          text: aiReply,
          createdAt: serverTimestamp(),
          username: 'ИИ Помощник 🤖',
          isVip: true
        });
      }
    } catch (error) {
      console.error('Error sending message: ', error);
    }
  };

  const handleSendText = async () => {
    const text = messageText.trim();
    if (!text) return;
    setMessageText('');
    await sendMessage({ text });
  };

  const handleTypingHeartbeat = async () => {
    if (!myUsername || !currentChatRoom) return;
    try {
      await setDoc(doc(db, 'typing', myUsername), { user: myUsername, room: currentChatRoom, time: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.error(e);
    }
  };

  // --- Voice Recording ---
  const startVoiceRecording = async () => {
    if (isCurrentBanned) return alert('Ваш аккаунт заблокирован');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = 'audio/webm';
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
          if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
          else if (MediaRecorder.isTypeSupported('audio/aac')) mimeType = 'audio/aac';
          else mimeType = '';
        }
      }
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const actualType = mediaRecorder.mimeType || mimeType || 'audio/mp4';
        const blob = new Blob(audioChunksRef.current, { type: actualType });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          if (reader.result) {
            await sendMessage({ audio: reader.result as string });
          }
        };
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      alert('Нет доступа к микрофону');
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // --- Image File Upload ---
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isCurrentBanned) return alert('Ваш аккаунт заблокирован');
    const file = e.target.files?.[0];
    if (file) {
      try {
        const b64 = await resizeImage(file, 800, 800);
        await sendMessage({ image: b64 });
      } catch (err) {
        alert('Ошибка загрузки изображения');
      }
    }
  };

  // --- Profile Image Upload ---
  const handleProfileAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && myUsername) {
      try {
        const b64 = await resizeImage(file, 200, 200);
        setProfileAvatarUrl(b64);
        await updateDoc(doc(db, 'users', myUsername), { avatar: b64 });
      } catch (err) {
        alert('Ошибка изменения фото профиля');
      }
    }
  };

  const handleSaveProfileName = async () => {
    if (!myUsername || !profileEditName.trim()) return;
    try {
      await updateDoc(doc(db, 'users', myUsername), { displayName: profileEditName.trim() });
      setIsProfileOpen(false);
    } catch (err) {
      alert('Ошибка обновления имени');
    }
  };

  const openProfileModal = () => {
    if (!myUsername) return;
    const profile = usersProfiles[myUsername];
    setProfileEditName(profile?.displayName || myUsername);
    setProfileAvatarUrl(profile?.avatar || '');
    setIsProfileOpen(true);
  };

  // Filtered dialog list
  const otherUsers = Object.keys(usersProfiles).filter((u) => u !== myUsername);
  const filteredUsers = otherUsers.filter((u) => {
    const p = usersProfiles[u];
    const name = (p?.displayName || u).toLowerCase();
    return name.includes(searchQuery.toLowerCase().trim());
  });

  // Active chat messages
  const currentMessages = messages.filter((m) => m.room === currentChatRoom);

  // Admin stats
  const totalUsersCount = Object.keys(usersProfiles).length;
  const onlineUsersCount = (Object.values(usersProfiles) as UserProfile[]).filter((u: UserProfile) => u.online).length;
  const totalMessagesCount = messages.length;

  // --- Render Authentication Screen ---
  if (!myUsername) {
    return (
      <div className="relative w-screen h-screen overflow-hidden flex items-center justify-center">
        <canvas ref={canvasRef} id="bg-canvas" />
        <div id="auth-screen">
          <div className="auth-box">
            <h2 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              <i className="fas fa-bolt" style={{ color: '#3b82f6' }} /> Pixel Messenger
            </h2>
            <input
              type="text"
              placeholder="Username (@..."
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
            />
            <input
              type="password"
              placeholder="Пароль"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
            <div className="auth-buttons">
              <button id="login-btn" onClick={handleLogin}>
                Войти
              </button>
              <button id="register-btn" onClick={handleRegister}>
                Регистрация
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Render Banned User Overlay Screen ---
  if (isCurrentBanned) {
    return (
      <div id="banned-screen">
        <i className="fas fa-user-slash" />
        <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>АККАУНТ ЗАБЛОКИРОВАН</h1>
        <p style={{ marginTop: '12px', fontSize: '1.1rem', color: '#cbd5e1', maxWidth: '450px' }}>
          Ваш аккаунт <b>@{myUsername}</b> был заблокирован Главным Администратором MilkyVIP за нарушение правил.
        </p>
        <button
          onClick={handleLogout}
          style={{
            marginTop: '30px',
            padding: '12px 28px',
            borderRadius: '14px',
            background: '#ef4444',
            color: 'white',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer'
          }}
        >
          Выйти из системы
        </button>
      </div>
    );
  }

  // --- Render Main Application Layout ---
  return (
    <div className="relative w-screen h-screen overflow-hidden flex">
      <canvas ref={canvasRef} id="bg-canvas" />

      {/* LIGHTBOX MODAL */}
      {lightboxImg && (
        <div id="lightbox-modal" onClick={() => setLightboxImg(null)}>
          <img id="lightbox-img" src={lightboxImg} alt="Zoom" />
        </div>
      )}

      {/* ACTIVE CALL MODAL / OVERLAY */}
      {currentCall && (
        <div id="call-modal">
          <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <h2 style={{ fontSize: '1.8rem', fontWeight: 700 }}>
              {currentCall.type === 'video' ? '📹 Видеозвонок' : '📞 Голосовой звонок'}
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
              {currentCall.status === 'calling'
                ? currentCall.caller === myUsername
                  ? 'Вызов...'
                  : 'Входящий звонок...'
                : `В эфире: ${Math.floor(callDuration / 60)
                  .toString()
                  .padStart(2, '0')}:${(callDuration % 60).toString().padStart(2, '0')}`}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <img
              className="call-avatar-pulse"
              src={
                (currentCall.caller === myUsername
                  ? usersProfiles[currentCall.receiver]?.avatar
                  : usersProfiles[currentCall.caller]?.avatar) || 'https://via.placeholder.com/150'
              }
              alt="Caller"
            />
            <h3 style={{ fontSize: '1.4rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              {currentCall.caller === myUsername
                ? usersProfiles[currentCall.receiver]?.displayName || currentCall.receiver
                : usersProfiles[currentCall.caller]?.displayName || currentCall.caller}
              {(currentCall.caller === 'MilkyVIP' || currentCall.receiver === 'MilkyVIP') && (
                <>
                  <span className="verified-badge" title="Подтвержденный аккаунт" />
                  <span className="vip-star-badge">
                    <i className="fas fa-crown" /> VIP
                  </span>
                </>
              )}
            </h3>
          </div>

          {currentCall.status === 'accepted' && currentCall.type === 'video' && (
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '20px' }}>
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted 
                style={{ width: '150px', height: '150px', borderRadius: '12px', objectFit: 'cover', background: '#000', transform: 'scaleX(-1)' }} 
              />
              <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                style={{ width: '150px', height: '150px', borderRadius: '12px', objectFit: 'cover', background: '#000' }} 
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
            {currentCall.status === 'calling' && currentCall.receiver === myUsername ? (
              <>
                <button className="call-btn-circle call-btn-accept" onClick={handleAcceptCall} title="Ответить">
                  <i className="fas fa-phone" />
                </button>
                <button className="call-btn-circle call-btn-decline" onClick={handleDeclineCall} title="Отклонить">
                  <i className="fas fa-phone-slash" />
                </button>
              </>
            ) : (
              <>
                <button
                  className="call-btn-circle call-btn-mute"
                  style={{ background: isMuted ? '#ef4444' : undefined }}
                  onClick={() => setIsMuted(!isMuted)}
                  title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                >
                  <i className={`fas ${isMuted ? 'fa-microphone-slash' : 'fa-microphone'}`} />
                </button>

                {currentCall.type === 'video' && (
                  <button
                    className="call-btn-circle call-btn-mute"
                    style={{ background: isVideoOff ? '#ef4444' : undefined }}
                    onClick={() => setIsVideoOff(!isVideoOff)}
                    title={isVideoOff ? 'Включить камеру' : 'Выключить камеру'}
                  >
                    <i className={`fas ${isVideoOff ? 'fa-video-slash' : 'fa-video'}`} />
                  </button>
                )}

                <button className="call-btn-circle call-btn-decline" onClick={handleEndCall} title="Завершить">
                  <i className="fas fa-phone-slash" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ADMIN PANEL MODAL (EXCLUSIVE FOR MILKYVIP) */}
      {isAdminOpen && isMilkyVip && (
        <div id="admin-modal">
          <div className="admin-card-modal">
            <div className="admin-header">
              <h3>
                <i className="fas fa-crown" /> VIP АДМИН-ПАНЕЛЬ (MilkyVIP)
              </h3>
              <button
                onClick={() => setIsAdminOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.4rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div className="admin-body">
              {/* STATS OVERVIEW */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div style={{ padding: '16px', background: 'var(--input-bg)', borderRadius: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#3b82f6' }}>{totalUsersCount}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Всего пользователей</div>
                </div>
                <div style={{ padding: '16px', background: 'var(--input-bg)', borderRadius: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#22c55e' }}>{onlineUsersCount}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Сейчас В сети</div>
                </div>
                <div style={{ padding: '16px', background: 'var(--input-bg)', borderRadius: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f59e0b' }}>{totalMessagesCount}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Сообщений в базе</div>
                </div>
              </div>

              {/* BROADCAST BOX */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', background: 'var(--input-bg)', borderRadius: '16px' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <i className="fas fa-bullhorn" style={{ color: '#f59e0b' }} /> Глобальное Объявление от MilkyVIP
                </h4>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="text"
                    placeholder="Напишите важное объявление всем пользователям..."
                    value={broadcastText}
                    onChange={(e) => setBroadcastText(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      borderRadius: '12px',
                      border: '1px solid var(--input-border)',
                      background: 'var(--card-bg)',
                      color: 'var(--text-color)',
                      outline: 'none'
                    }}
                  />
                  <button className="admin-action-btn admin-btn-broadcast" onClick={handleSendBroadcast}>
                    <i className="fas fa-paper-plane" /> Опубликовать
                  </button>
                </div>
              </div>

              {/* AI SETTINGS */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', background: 'var(--input-bg)', borderRadius: '16px' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <i className="fas fa-robot" style={{ color: '#a855f7' }} /> Настройки ИИ-Помощника (Gemini)
                </h4>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Чтобы бот работал по вызову <code>@ai</code>, введите бесплатный API-ключ от Google Gemini.
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="password"
                    placeholder="AIzaSy..."
                    value={geminiKey}
                    onChange={(e) => {
                      setGeminiKey(e.target.value);
                      localStorage.setItem('geminiKey', e.target.value);
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      borderRadius: '12px',
                      border: '1px solid var(--input-border)',
                      background: 'var(--card-bg)',
                      color: 'var(--text-color)',
                      outline: 'none'
                    }}
                  />
                  <button className="admin-action-btn admin-btn-unban" onClick={() => alert('Ключ ИИ успешно сохранен!')}>
                    <i className="fas fa-save" /> Сохранить
                  </button>
                </div>
              </div>

              {/* ALL USERS MANAGEMENT LIST */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h4 style={{ fontSize: '1rem', fontWeight: 700 }}>Управление Пользователями</h4>
                {(Object.values(usersProfiles) as UserProfile[]).map((usr: UserProfile) => (
                  <div key={usr.username} className="admin-user-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <img
                        src={usr.avatar || 'https://via.placeholder.com/150'}
                        alt="Avatar"
                        style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {usr.displayName || usr.username}
                          {usr.username === 'MilkyVIP' && (
                            <>
                              <span className="verified-badge" />
                              <span className="vip-star-badge">
                                <i className="fas fa-crown" /> VIP
                              </span>
                            </>
                          )}
                          {usr.isBanned && <span className="banned-badge">ЗАБАНЕН</span>}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          @{usr.username} | {usr.online ? '🟢 В сети' : '⚪ Оффлайн'} | Пароль: <code>{usr.password || '***'}</code>
                        </div>
                      </div>
                    </div>

                    {usr.username !== 'MilkyVIP' && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className={`admin-action-btn ${usr.isBanned ? 'admin-btn-unban' : 'admin-btn-ban'}`}
                          onClick={() => handleToggleBanUser(usr.username, usr.isBanned || false)}
                        >
                          <i className={`fas ${usr.isBanned ? 'fa-unlock' : 'fa-ban'}`} />
                          {usr.isBanned ? 'Разбанить' : 'Забанить'}
                        </button>
                        <button
                          className="admin-action-btn admin-btn-delete"
                          onClick={() => handleDeleteUserMessages(usr.username)}
                          title="Очистить сообщения юзера"
                        >
                          <i className="fas fa-eraser" /> Сообщения
                        </button>
                        <button
                          className="admin-action-btn admin-btn-delete"
                          onClick={() => handleDeleteUserAccount(usr.username)}
                          title="Удалить аккаунт"
                        >
                          <i className="fas fa-trash-alt" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PROFILE MODAL */}
      {isProfileOpen && (
        <div id="profile-modal">
          <div className="profile-card-modal">
            <div className="profile-big-avatar" title="Сменить фото">
              <img
                src={profileAvatarUrl || usersProfiles[myUsername]?.avatar || 'https://via.placeholder.com/150'}
                alt="Avatar"
              />
              <input type="file" id="profile-avatar-file" accept="image/*" onChange={handleProfileAvatarChange} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                {usersProfiles[myUsername]?.displayName || myUsername}
                {isMilkyVip && (
                  <>
                    <span className="verified-badge" title="Подтвержденный аккаунт" />
                    <span className="vip-star-badge">
                      <i className="fas fa-crown" /> VIP
                    </span>
                  </>
                )}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>@{myUsername}</p>
            </div>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input
                type="text"
                placeholder="Ваше имя..."
                value={profileEditName}
                onChange={(e) => setProfileEditName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid var(--input-border)',
                  background: 'var(--input-bg)',
                  color: 'var(--text-color)',
                  outline: 'none'
                }}
              />
              <button
                onClick={handleSaveProfileName}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'var(--accent-gradient)',
                  color: 'white',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Сохранить
              </button>
              <button
                onClick={() => setIsProfileOpen(false)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN TWO-COLUMN APP CONTAINER */}
      <div id="app-container">
        {/* LEFT COLUMN */}
        <div id="left-column" className={selectedUser ? 'hidden-mobile' : ''}>
          <div className="sidebar-top-bar">
            <button className="menu-burger-btn" onClick={openProfileModal} title="Профиль">
              <i className="fas fa-bars" />
            </button>

            {/* EXCLUSIVE ADMIN PANEL BUTTON FOR MILKYVIP */}
            {isMilkyVip && (
              <button
                onClick={() => setIsAdminOpen(true)}
                style={{
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '6px 10px',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 2px 10px rgba(245, 158, 11, 0.4)'
                }}
                title="VIP Админ-Панель"
              >
                <i className="fas fa-crown" /> АДМИН
              </button>
            )}

            <div className="sidebar-search-box">
              <i className="fas fa-search" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Поиск чатов..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="dialogs-list" id="dialogs-list">
            {filteredUsers.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                {otherUsers.length === 0 ? 'Загрузка или нет пользователей...' : 'Чаты не найдены'}
              </div>
            ) : (
              filteredUsers.map((uName) => {
                const uData = usersProfiles[uName] || { username: uName };
                const members = [myUsername, uName].sort();
                const roomId = `pm_${members[0]}_${members[1]}`;
                const dispName = uData.displayName || uName;
                const isOnline = uData.online === true;
                const isActive = currentChatRoom === roomId;
                const isVipUser = uName === 'MilkyVIP' || uData.isVip;
                const isUserBanned = uData.isBanned === true;

                // Find last message for room
                const roomMsgs = messages.filter((m) => m.room === roomId);
                const lastMsg = roomMsgs[roomMsgs.length - 1];
                let lastMsgText = 'Нет сообщений';
                let timeStr = '';

                if (lastMsg) {
                  if (lastMsg.text) lastMsgText = lastMsg.text;
                  else if (lastMsg.image) lastMsgText = '📷 Фотография';
                  else if (lastMsg.audio) lastMsgText = '🎤 Голосовое сообщение';

                  if (lastMsg.createdAt?.toDate) {
                    timeStr = lastMsg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  }
                }

                return (
                  <div
                    key={uName}
                    className={`dialog-item ${isOnline ? 'online' : ''} ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setCurrentChatRoom(roomId);
                      setSelectedUser(uData);
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <img className="dialog-avatar" src={uData.avatar || 'https://via.placeholder.com/150'} alt="Avatar" />
                      <div className="online-indicator" />
                    </div>
                    <div className="dialog-info">
                      <div className="dialog-row-top">
                        <div className="dialog-name">
                          {dispName}
                          {isVipUser && (
                            <>
                              <span className="verified-badge" title="Подтвержденный аккаунт" />
                              <span className="vip-star-badge">
                                <i className="fas fa-crown" /> VIP
                              </span>
                            </>
                          )}
                          {isUserBanned && <span className="banned-badge">БАН</span>}
                        </div>
                        <div className="dialog-time">{timeStr}</div>
                      </div>
                      <div className="dialog-row-bottom">
                        <div className="dialog-last-msg">{lastMsgText}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN (CHAT AREA) */}
        <div id="right-column" className={!selectedUser ? 'hidden-mobile' : ''}>
          {/* CHAT HEADER */}
          <div className="chat-header">
            <div className="chat-header-left">
              <button
                className="mobile-back-btn"
                onClick={() => setSelectedUser(null)}
                title="Назад к чатам"
              >
                <i className="fas fa-chevron-left" />
              </button>
              <img
                className="chat-header-avatar"
                src={selectedUser?.avatar || 'https://via.placeholder.com/150'}
                alt="Avatar"
              />
              <div className="chat-header-info">
                <h4>
                  {selectedUser ? selectedUser.displayName || selectedUser.username : 'Выберите чат'}{' '}
                  {(selectedUser?.username === 'MilkyVIP' || selectedUser?.isVip) && (
                    <>
                      <span className="verified-badge" title="Подтвержденный аккаунт" />
                      <span className="vip-star-badge">
                        <i className="fas fa-crown" /> VIP
                      </span>
                    </>
                  )}
                  {selectedUser?.isBanned && <span className="banned-badge">ЗАБЛОКИРОВАН</span>}
                </h4>
                <span style={{ color: typingUsers.length > 0 ? 'var(--accent-color)' : '' }}>
                  {typingUsers.length > 0
                    ? `${typingUsers.join(', ')} печатает...`
                    : selectedUser
                      ? selectedUser.online
                        ? 'в сети'
                        : 'был недавно'
                      : ''}
                </span>
              </div>
            </div>
            <div className="chat-header-actions">
              {selectedUser && (
                <>
                  <button className="header-icon-btn" onClick={() => handleStartCall('voice')} title="Голосовой звонок">
                    <i className="fas fa-phone" />
                  </button>
                  <button className="header-icon-btn" onClick={() => handleStartCall('video')} title="Видеозвонок">
                    <i className="fas fa-video" />
                  </button>
                </>
              )}
              <button className="header-icon-btn" onClick={toggleTheme} title="Сменить тему">
                <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} />
              </button>
              <button className="header-icon-btn" onClick={handleLogout} title="Выйти">
                <i className="fas fa-sign-out-alt" />
              </button>
            </div>
          </div>

          {/* PINNED BANNER */}
          {pinnedMessage && (
            <div id="pinned-banner">
              <div>
                📌 <span style={{ fontWeight: 600 }}>{pinnedMessage}</span>
              </div>
              <button
                onClick={() => setPinnedMessage(null)}
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* CHAT BOX MESSAGES */}
          <div id="chat-box" ref={chatBoxRef}>
            {currentMessages.map((data) => {
              const isMy = data.username === myUsername;
              const isVipMsg = data.isVip || data.username === 'MilkyVIP';

              const dateObj = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
              const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              return (
                <div key={data.id} className={`message ${isMy ? 'my' : 'other'} ${isVipMsg ? 'vip-msg' : ''}`}>
                  {/* VIP message header label */}
                  {isVipMsg && (
                    <div style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 800, marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <i className="fas fa-crown" /> VIP Сообщение
                    </div>
                  )}

                  {/* Reply Preview */}
                  {data.replyTo && <div className="reply-preview-box">↩ {data.replyTo}</div>}

                  {/* Content Payload */}
                  {data.image ? (
                    <img
                      className="chat-img"
                      src={data.image}
                      onClick={() => setLightboxImg(data.image!)}
                      alt="Photo"
                    />
                  ) : data.audio ? (
                    <VoicePlayer url={data.audio} id={data.id} />
                  ) : (
                    <div>{data.text}</div>
                  )}

                  {/* Emoji Reactions display */}
                  {data.reactions && Object.keys(data.reactions).length > 0 && (
                    <div className="reactions-row" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                      {Object.entries(
                        Object.values(data.reactions).reduce((acc: Record<string, number>, em: string) => {
                          acc[em] = (acc[em] || 0) + 1;
                          return acc;
                        }, {})
                      ).map(([em, count]) => (
                        <span
                          key={em}
                          style={{
                            background: 'rgba(255,255,255,0.2)',
                            borderRadius: '12px',
                            padding: '2px 8px',
                            fontSize: '0.78rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                        >
                          {em} {count}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Message Time and Status */}
                  <div className="msg-time-status">
                    <span>{timeStr}</span>
                    {isMy && <i className="fas fa-check-double" />}
                  </div>

                  {/* Hover Popup Actions */}
                  <div className="msg-actions-popup">
                    {['👍', '❤️', '🔥', '😂', '😮'].map((em) => (
                      <button
                        key={em}
                        className="msg-action-btn"
                        onClick={async () => {
                          try {
                            await updateDoc(doc(db, 'messages', data.id), {
                              [`reactions.${myUsername}`]: em
                            });
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                      >
                        {em}
                      </button>
                    ))}
                    <button
                      className="msg-action-btn"
                      onClick={() => setReplyingToMessage({ text: data.text || 'Медиа' })}
                      title="Ответить"
                    >
                      <i className="fas fa-reply" />
                    </button>
                    <button
                      className="msg-action-btn"
                      onClick={() => setPinnedMessage(data.text || 'Медиа')}
                      title="Закрепить"
                    >
                      <i className="fas fa-thumbtack" />
                    </button>
                    {(isMy || isMilkyVip) && (
                      <button
                        className="msg-action-btn"
                        onClick={async () => {
                          if (confirm('Удалить сообщение?')) {
                            await deleteDoc(doc(db, 'messages', data.id));
                          }
                        }}
                        title="Удалить"
                      >
                        <i className="fas fa-trash" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ACTIVE REPLY BANNER */}
          {replyingToMessage && (
            <div className="active-reply-banner">
              <div>
                Ответ на:{' '}
                <span style={{ color: 'var(--accent-color)', fontWeight: 600 }}>{replyingToMessage.text}</span>
              </div>
              <button
                onClick={() => setReplyingToMessage(null)}
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* INPUT AREA */}
          <div className="chat-input-area">
            <label className="input-icon-btn" title="Прикрепить фото">
              <i className="fas fa-paperclip" />
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
            </label>

            <textarea
              className="chat-text-input"
              placeholder="Сообщение..."
              rows={1}
              value={messageText}
              onChange={(e) => {
                setMessageText(e.target.value);
                handleTypingHeartbeat();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendText();
                }
              }}
            />

            <button
              className="dynamic-send-btn"
              style={{ background: isRecording ? '#ef4444' : undefined }}
              onClick={() => {
                if (messageText.trim().length > 0) {
                  handleSendText();
                } else {
                  if (!isRecording) startVoiceRecording();
                  else stopVoiceRecording();
                }
              }}
              title={messageText.trim().length > 0 ? 'Отправить' : isRecording ? 'Остановить' : 'Записать голосовое'}
            >
              <i
                className={`fas ${messageText.trim().length > 0 ? 'fa-paper-plane' : isRecording ? 'fa-stop' : 'fa-microphone'
                  }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Custom Waveform Voice Message Player Component
function VoicePlayer({ url }: { url: string; id: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState('0:00');
  const [progressRatio, setProgressRatio] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const barsCount = 28;
  // Generate stable height bars array per component instance
  const barsHeights = useRef<number[]>(
    Array.from({ length: barsCount }, () => Math.floor(Math.random() * 18) + 6)
  ).current;

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      const dur = audio.duration;
      if (isFinite(dur) && !isNaN(dur)) {
        const mins = Math.floor(dur / 60);
        const secs = Math.floor(dur % 60);
        setCurrentTime(`${mins}:${secs < 10 ? '0' : ''}${secs}`);
      }
    };

    const handleTimeUpdate = () => {
      const cur = audio.currentTime;
      const dur = audio.duration || 1;
      const mins = Math.floor(cur / 60);
      const secs = Math.floor(cur % 60);
      setCurrentTime(`${mins}:${secs < 10 ? '0' : ''}${secs}`);

      if (isFinite(dur) && dur > 0) {
        setProgressRatio(cur / dur);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgressRatio(0);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [url]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const changeSpeed = () => {
    let nextSpeed = 1;
    if (speed === 1) nextSpeed = 1.5;
    else if (speed === 1.5) nextSpeed = 2;
    else nextSpeed = 1;

    setSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const activeIndex = Math.floor(progressRatio * barsCount);

  return (
    <div className="voice-player">
      <button className="voice-play-btn" onClick={togglePlay}>
        <i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play'}`} />
      </button>
      <div className="voice-waveform-box">
        <div className="voice-bars">
          {barsHeights.map((h, idx) => (
            <div
              key={idx}
              className={`voice-bar ${idx <= activeIndex ? 'active' : ''}`}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
        <div className="voice-meta-row">
          <span>{currentTime}</span>
          <button className="voice-speed-btn" onClick={changeSpeed}>
            {speed}x
          </button>
        </div>
      </div>
    </div>
  );
}
