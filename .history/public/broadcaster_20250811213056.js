const socket = io();
let localStream = null;
let micStream = null;
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
const turnOnMic = document.getElementById('turnOnMic');
let mediaRecorder = null;
let recordedChunks = [];

function setStatus(msg) { statusDiv.textContent = 'Status: ' + msg; }

startBtn.onclick = async () => {
  try {
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
  Object.values(pcs).forEach(pc => pc.close());
  for (const k in pcs) delete pcs[k];

  socket.emit('broadcaster-leave');
  localVideo.srcObject = null;
  setStatus('stopped');
  startBtn.disabled = false;
  stopBtn.disabled = true;
};

recordBtn.onclick = () => {
  if (!localStream) { alert('Start sharing first'); return; }
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

turnOnMic.onclick = () => {
    
}

socket.on('new-viewer', async ({ viewerId }) => {
  console.log('New viewer', viewerId);
  if (!localStream) return;

  const pc = new RTCPeerConnection(config);
  pcs[viewerId] = pc;

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
