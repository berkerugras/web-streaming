const socket = io();
let localStream = null; // will hold combined screen+mic tracks
let micStream = null;   // just for mic audio source before merging
const pcs = {};
const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const recordBtn = document.getElementById('recordBtn');
const localVideo = document.getElementById('localVideo');
const statusDiv = document.getElementById('status');
const toggleMicBtn = document.getElementById('turnOnMic');

let mediaRecorder = null;
let recordedChunks = [];
let micOn = false;

function setStatus(msg) {
  statusDiv.textContent = 'Status: ' + msg;
}

startBtn.onclick = async () => {
  try {
    // Get display stream (screen + optional audio)
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    setStatus('sharing');
    startBtn.disabled = true;
    stopBtn.disabled = false;
    socket.emit('broadcaster-join');
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
  setStatus('stopped');
  startBtn.disabled = false;
  stopBtn.disabled = true;
  micOn = false;
  toggleMicBtn.textContent = 'Turn On Mic';
};

recordBtn.onclick = () => {
  if (!localStream) {
    alert('Start sharing first');
    return;
  }
  if (!mediaRecorder) {
    mediaRecorder = new MediaRecorder(localStream, { mimeType: 'video/webm; codecs=vp8' });
    mediaRecorder.ondataavailable = e => {
      if (e.data.size) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'recording.webm';
      a.click();
      recordedChunks = [];
      mediaRecorder = null;
      recordBtn.textContent = 'Start Recording (optional)';
    };
    mediaRecorder.start();
    recordBtn.textContent = 'Stop Recording';
    setStatus('recording');
  } else {
    mediaRecorder.stop();
    setStatus('sharing');
  }
};

async function renegotiate(pc, viewerId) {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: viewerId, sdp: offer });
  } catch (err) {
    console.error('Error during renegotiation', err);
  }
}

async function addMicTracks() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setStatus('Mic is ON');
    toggleMicBtn.textContent = 'Turn Off Mic';
    micOn = true;

    // Add mic audio track(s) to localStream
    micStream.getAudioTracks().forEach(track => {
      // Add to localStream so it contains both screen + mic audio
      localStream.addTrack(track);
    });

    // Add new mic tracks to all existing PCs and renegotiate
    for (const [viewerId, pc] of Object.entries(pcs)) {
      micStream.getAudioTracks().forEach(track => pc.addTrack(track, localStream));
      await renegotiate(pc, viewerId);
    }
  } catch (err) {
    console.error('Error getting mic audio', err);
    alert('Could not access mic: ' + err.message);
  }
}

async function removeMicTracks() {
  if (!micStream) return;

  // Remove mic tracks from all PCs and renegotiate
  for (const [viewerId, pc] of Object.entries(pcs)) {
    pc.getSenders().forEach(sender => {
      if (sender.track && micStream.getTracks().includes(sender.track)) {
        pc.removeTrack(sender);
      }
    });
    await renegotiate(pc, viewerId);
  }

  // Remove mic tracks from localStream and stop them
  micStream.getTracks().forEach(track => {
    localStream.removeTrack(track);
    track.stop();
  });
  micStream = null;

  setStatus('Mic is OFF');
  toggleMicBtn.textContent = 'Turn On Mic';
  micOn = false;
}

toggleMicBtn.onclick = async () => {
  if (micOn) {
    await removeMicTracks();
  } else {
    await addMicTracks();
  }
};

socket.on('new-viewer', async ({ viewerId }) => {
  console.log('New viewer', viewerId);
  if (!localStream) return;

  const pc = new RTCPeerConnection(config);
  pcs[viewerId] = pc;

  // Add all tracks from localStream (screen + mic if any)
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

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
    console.error('Error creating offer for viewer', viewerId, err);
  }
});

socket.on('answer', async ({ from, sdp }) => {
  const pc = pcs[from];
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  } catch (err) {
    console.error('Error applying answer', err);
  }
});

socket.on('ice-candidate', ({ from, candidate }) => {
  const pc = pcs[from];
  if (!pc) return;
  pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn(e));
});

socket.on('peer-left', ({ id }) => {
  if (pcs[id]) {
    pcs[id].close();
    delete pcs[id];
  }
});
