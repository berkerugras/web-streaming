const socket = io();
const localVideo = document.getElementById('localVideo');
const statusDiv = document.getElementById('status');
const viewerAudio = document.getElementById('viewerAudio');

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let pcs = {}; // Multiple viewers
let localStream = null;

// Start sharing desktop
document.getElementById('startBtn').onclick = async () => {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    socket.emit('broadcaster');
    statusDiv.textContent = "Status: broadcasting";
  } catch (err) {
    console.error('Error starting share:', err);
  }
};

// Stop sharing
document.getElementById('stopBtn').onclick = () => {
  localStream.getTracks().forEach(track => track.stop());
  Object.values(pcs).forEach(pc => pc.close());
  pcs = {};
  socket.emit('broadcaster-offline');
  statusDiv.textContent = "Status: idle";
};

// Handle incoming viewer
socket.on('viewer-join', async ({ viewerId }) => {
  const pc = new RTCPeerConnection(config);

  // Send our stream to the viewer
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Receive viewer's mic audio
  pc.ontrack = (event) => {
    if (event.track.kind === 'audio') {
      console.log(`Receiving mic audio from ${viewerId}`);
      viewerAudio.srcObject = event.streams[0];
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { target: viewerId, candidate: event.candidate });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { target: viewerId, sdp: offer });

  pcs[viewerId] = pc;
});

// Handle answer from viewer
socket.on('answer', ({ from, sdp }) => {
  pcs[from]?.setRemoteDescription(new RTCSessionDescription(sdp));
});

// ICE candidate from viewer
socket.on('ice-candidate', ({ from, candidate }) => {
  pcs[from]?.addIceCandidate(new RTCIceCandidate(candidate));
});

// Remove viewer if disconnected
socket.on('viewer-disconnected', ({ viewerId }) => {
  pcs[viewerId]?.close();
  delete pcs[viewerId];
});
