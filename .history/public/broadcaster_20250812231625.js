const socket = io();
let localStream = null;
let micStream = null;
const pcs = {};
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

  Object.values(pcs).forEach(pc => pc.close());
  for (const k in pcs) delete pcs[k];

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
  
  pc.ontrack = (event) => {
    if (event.track.kind === 'audio') {
      console.log(`Receiving mic audio from ${viewerId}`);
      viewerAudio.srcObject = event.streams[0];
    }

  };
  pc.onicecandidate = e => { if (e.candidate) socket.emit('ice-candidate', { target: viewerId, candidate: e.candidate }); };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { target: viewerId, sdp: offer });
});

socket.on('answer', async ({ from, sdp }) => {
  if (pcs[from]) await pcs[from].setRemoteDescription(new RTCSessionDescription(sdp));
});

socket.on('ice-candidate', ({ from, candidate }) => {
  if (pcs[from]) pcs[from].addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
});

socket.on('peer-left', ({ id }) => {
  if (pcs[id]) {
    pcs[id].close();
    delete pcs[id];
  }
});


socket.on('offer', async ({ from, sdp }) => {
    let pc = pcs[from];
    if (!pc) {
        pc = new RTCPeerConnection(config);
        pcs[from] = pc;

        // Handle incoming audio from viewer
        pc.ontrack = (event) => {
            if (event.track.kind === 'audio') {
                viewerAudio.srcObject = event.streams[0];
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { target: from, candidate: event.candidate });
            }
        };

        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: from, sdp: answer });
});