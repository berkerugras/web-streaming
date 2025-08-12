const socket = io();
let localStream = null;
let micStream = null;
const pcs = {}; // Stores PCs for sending streams TO viewers
const viewerPcs = {}; // Stores PCs for receiving streams FROM viewers
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const recordBtn = document.getElementById('recordBtn');
const localVideo = document.getElementById('localVideo');
const statusDiv = document.getElementById('status');
const toggleMicBtn = document.getElementById('turnOnMic');
const viewerAudio = document.getElementById('viewerAudio');

let roomName = null;
let mediaRecorder = null;
let recordedChunks = [];
let micOn = false;

function setStatus(msg) {
  statusDiv.textContent = 'Status: ' + msg;
}

startBtn.onclick = async () => {
  try {
    roomName = prompt("Enter room name for this broadcast:");
    if (!roomName) return;

    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    setStatus(`Sharing screen in room: ${roomName}`);
    startBtn.disabled = true;
    stopBtn.disabled = false;

    socket.emit('broadcaster-join', { room: roomName });
  } catch (err) {
    console.error('Error getting display media', err);
    alert('Could not start screen sharing: ' + err.message);
  }
};

stopBtn.onclick = () => {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (micStream) micStream.getTracks().forEach(t => t.stop());

  // Close all peer connections
  Object.values(pcs).forEach(pc => pc.close());
  for (const k in pcs) delete pcs[k];
  Object.values(viewerPcs).forEach(pc => pc.close());
  for (const k in viewerPcs) delete viewerPcs[k];

  socket.emit('broadcaster-leave', { room: roomName });
  localVideo.srcObject = null;
  setStatus('Stopped');
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
    mediaRecorder.ondataavailable = e => { if (e.data.size) recordedChunks.push(e.data); };
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
    setStatus('Recording');
  } else {
    mediaRecorder.stop();
    setStatus(`Sharing screen in room: ${roomName}`);
  }
};

async function renegotiate(pc, viewerId) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { target: viewerId, sdp: offer });
}

async function addMicTracks() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  setStatus('Mic is ON');
  toggleMicBtn.textContent = 'Turn Off Mic';
  micOn = true;
  micStream.getAudioTracks().forEach(track => localStream.addTrack(track));
  for (const [viewerId, pc] of Object.entries(pcs)) {
    micStream.getAudioTracks().forEach(track => pc.addTrack(track, localStream));
    await renegotiate(pc, viewerId);
  }
}

async function removeMicTracks() {
  if (!micStream) return;
  for (const [viewerId, pc] of Object.entries(pcs)) {
    pc.getSenders().forEach(sender => {
      if (sender.track && micStream.getTracks().includes(sender.track)) {
        pc.removeTrack(sender);
      }
    });
    await renegotiate(pc, viewerId);
  }
  micStream.getTracks().forEach(track => { localStream.removeTrack(track); track.stop(); });
  micStream = null;
  setStatus('Mic is OFF');
  toggleMicBtn.textContent = 'Turn On Mic';
  micOn = false;
}

toggleMicBtn.onclick = () => micOn ? removeMicTracks() : addMicTracks();

socket.on('new-viewer', async ({ viewerId }) => {
  if (!localStream) return;
  const pc = new RTCPeerConnection(config);
  pcs[viewerId] = pc;
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = e => { if (e.candidate) socket.emit('ice-candidate', { target: viewerId, candidate: e.candidate }); };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { target: viewerId, sdp: offer });
});

socket.on('answer', async ({ from, sdp }) => {
  if (pcs[from]) {
    await pcs[from].setRemoteDescription(new RTCSessionDescription(sdp));
  } else if (viewerPcs[from]) {
    await viewerPcs[from].setRemoteDescription(new RTCSessionDescription(sdp));
  }
});

socket.on('ice-candidate', ({ from, candidate }) => {
  if (pcs[from]) {
    pcs[from].addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
  } else if (viewerPcs[from]) {
    viewerPcs[from].addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
  }
});

socket.on('peer-left', ({ id }) => {
  if (pcs[id]) {
    pcs[id].close();
    delete pcs[id];
  }
  if (viewerPcs[id]) {
    viewerPcs[id].close();
    delete viewerPcs[id];
  }
});


socket.on('offer', async ({ from, sdp }) => {
  // If an existing viewer is trying to connect to a broadcaster who hasn't set up the reverse PC yet
  if (!pcs[from] && !viewerPcs[from]) {
    const pcViewerToBroadcaster = new RTCPeerConnection(config);
    viewerPcs[from] = pcViewerToBroadcaster;

    pcViewerToBroadcaster.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        const viewerAudioElement = document.createElement('audio');
        viewerAudioElement.srcObject = event.streams[0];
        viewerAudioElement.autoplay = true;
        viewerAudioElement.playsInline = true;
        document.body.appendChild(viewerAudioElement);
      }
    };

    pcViewerToBroadcaster.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { target: from, candidate: event.candidate });
      }
    };

    await pcViewerToBroadcaster.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pcViewerToBroadcaster.createAnswer();
    await pcViewerToBroadcaster.setLocalDescription(answer);
    socket.emit('answer', { target: from, sdp: answer });
  }
});