const socket = io();
let localStream = null; // screen-only stream (from getDisplayMedia)
let micStream = null;   // separate mic audio stream
const pcs = {};
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const toggleMicBtn = document.getElementById('turnOnMic');
const localVideo = document.getElementById('localVideo');

let micOn = false;

startBtn.onclick = async () => {
  try {
    // get screen stream, video + possibly audio if you want screen audio
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    localVideo.srcObject = localStream;
    socket.emit('broadcaster-join');
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (err) {
    console.error('Error getting display media', err);
    alert('Could not start screen sharing: ' + err.message);
  }
};

stopBtn.onclick = () => {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  Object.values(pcs).forEach(pc => pc.close());
  for (const k in pcs) delete pcs[k];
  socket.emit('broadcaster-leave');
  localVideo.srcObject = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  micOn = false;
  toggleMicBtn.textContent = 'Turn On Mic';
};

async function addMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micOn = true;
    toggleMicBtn.textContent = 'Turn Off Mic';

    // Add mic tracks to all PCs and renegotiate
    for (const [viewerId, pc] of Object.entries(pcs)) {
      micStream.getAudioTracks().forEach(track => pc.addTrack(track, micStream));
      await renegotiate(pc, viewerId);
    }
  } catch (err) {
    console.error('Error accessing mic', err);
    alert('Could not access mic: ' + err.message);
  }
}

async function removeMic() {
  if (!micStream) return;

  for (const [viewerId, pc] of Object.entries(pcs)) {
    pc.getSenders().forEach(sender => {
      if (sender.track && micStream.getTracks().includes(sender.track)) {
        pc.removeTrack(sender);
      }
    });
    await renegotiate(pc, viewerId);
  }

  micStream.getTracks().forEach(track => track.stop());
  micStream = null;
  micOn = false;
  toggleMicBtn.textContent = 'Turn On Mic';
}

toggleMicBtn.onclick = async () => {
  if (micOn) {
    await removeMic();
  } else {
    await addMic();
  }
};

async function renegotiate(pc, viewerId) {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: viewerId, sdp: offer });
  } catch (err) {
    console.error('Renegotiation error:', err);
  }
}

socket.on('new-viewer', async ({ viewerId }) => {
  if (!localStream) return;

  const pc = new RTCPeerConnection(config);
  pcs[viewerId] = pc;

  // Add screen tracks to PC first
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // If mic is on, add mic tracks as well
  if (micOn && micStream) {
    micStream.getAudioTracks().forEach(track => pc.addTrack(track, micStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { target: viewerId, candidate: event.candidate });
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: viewerId, sdp: offer });
  } catch (err) {
    console.error('Error creating offer for viewer:', err);
  }
});

socket.on('answer', ({ from, sdp }) => {
  const pc = pcs[from];
  if (!pc) return;
  pc.setRemoteDescription(new RTCSessionDescription(sdp)).catch(console.error);
});

socket.on('ice-candidate', ({ from, candidate }) => {
  const pc = pcs[from];
  if (!pc) return;
  pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
});

socket.on('peer-left', ({ id }) => {
  if (pcs[id]) {
    pcs[id].close();
    delete pcs[id];
  }
});
