const socket = io();
const localVideo = document.getElementById('localVideo');
const info = document.getElementById('info');

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let localStream = null;
let pcs = {}; // store RTCPeerConnection per viewer

async function startBroadcast() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    socket.emit('broadcaster');
    info.textContent = 'Broadcasting...';
  } catch (err) {
    console.error('Could not start broadcast:', err);
    info.textContent = 'Error accessing camera/mic.';
  }
}

socket.on('watcher', async (viewerId) => {
  console.log(`Viewer ${viewerId} joined`);

  const pc = new RTCPeerConnection(config);
  pcs[viewerId] = pc;

  // Send our tracks (video+audio) to the viewer
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // If viewer sends audio back, play it
  pc.ontrack = (event) => {
    if (event.track.kind === 'audio') {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.srcObject = event.streams[0];
      audioEl.dataset.viewerId = viewerId;
      document.body.appendChild(audioEl);
    }
  };

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
    console.error('Error creating offer for viewer', err);
  }
});

// Handle ICE candidates from viewers
socket.on('ice-candidate', ({ from, candidate }) => {
  const pc = pcs[from];
  if (pc) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
  }
});

// Handle answers from viewers
socket.on('answer', async ({ from, sdp }) => {
  const pc = pcs[from];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }
});

// Handle renegotiation when viewer enables mic
socket.on('offer', async ({ from, sdp }) => {
  console.log(`Renegotiation offer from ${from}`);
  let pc = pcs[from];
  if (!pc) {
    pc = new RTCPeerConnection(config);
    pcs[from] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = event.streams[0];
        audioEl.dataset.viewerId = from;
        document.body.appendChild(audioEl);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { target: from, candidate: event.candidate });
      }
    };
  }

  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { target: from, sdp: answer });
});

// Viewer leaves
socket.on('viewer-disconnected', (viewerId) => {
  console.log(`Viewer ${viewerId} disconnected`);
  if (pcs[viewerId]) {
    pcs[viewerId].close();
    delete pcs[viewerId];
  }
  const audioEl = document.querySelector(`audio[data-viewer-id="${viewerId}"]`);
  if (audioEl) audioEl.remove();
});

startBroadcast();
