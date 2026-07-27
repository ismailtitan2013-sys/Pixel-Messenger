import sys
import re

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add WebRTC state
state_block = '''  const [isVideoOff, setIsVideoOff] = useState(false);

  // WebRTC state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
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
    }
  }, [remoteStream, currentCall]);

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
'''
content = content.replace('  const [isVideoOff, setIsVideoOff] = useState(false);', state_block)

# 2. Add calleeCandidates/answer realtime listener
listen_code = '''
  // --- Realtime Calls Listener ---
  useEffect(() => {
    if (!myUsername) return;

    const unsubscribe = onSnapshot(collection(db, 'calls'), async (snapshot) => {
      snapshot.forEach(async (docSnap) => {
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
'''

content = re.sub(r'  // --- Realtime Calls Listener ---.*?  // --- Call Timer Counter ---', listen_code + '\n  // --- Call Timer Counter ---', content, flags=re.DOTALL)

# 3. Handle Call Actions
call_actions = '''
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
      const callDocSnap = await getDoc(doc(db, 'calls', currentCall.id));
      const callData = callDocSnap.data();
      if (!callData || !callData.offer) return alert('Ошибка соединения');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: currentCall.type === 'video' });
      setLocalStream(stream);

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
    } catch (e) {
      console.error(e);
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
          text: `📞 ${currentCall.type === 'video' ? 'Видеозвонок' : 'Голосовой звонок'} (${callDuration > 0 ? \`Длительность: ${formatSecs}\` : 'Звонок завершен'})`
        });
      }

      cleanupCall();
    } catch (e) {
      console.error(e);
    }
  };
'''

content = re.sub(r'  // --- Call Control Actions ---.*?  // --- Send Message Payload ---', call_actions + '\n  // --- Send Message Payload ---', content, flags=re.DOTALL)

# 4. Handle Mute & Video Toggles
mute_toggle = '''
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
'''

content = content.replace('  // --- Scroll Chat Box to Bottom ---', mute_toggle + '\n  // --- Scroll Chat Box to Bottom ---')


# 5. Render Video Tags in Modal
video_tags = '''          </div>

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

          <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>'''

content = content.replace('''          </div>

          <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>''', video_tags)

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
