const socket = io();
const remoteVideo = document.getElementById('remoteVideo');
const info = document.getElementById('info');
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;

socket.emit('viewer-join');

socket.on('no-broadcaster', () => {
  info.textContent = 'No broadcaster online.';
});

socket.on('broadcaster-offline', () => {
  info.textContent = 'Broadcaster went offline.';
  if (pc) {
    pc.close();
    pc = null;
  }
  remoteVideo.srcObject = null;
});

socket.on('offer', async ({ from, sdp }) => {
  if (!sdp) {
    info.textContent = 'No broadcaster currently available.';
    return;
  }

  // If existing pc, close it before creating new
  if (pc) {
    pc.close();
    pc = null;
  }

  pc = new RTCPeerConnection(config);

  pc.ontrack = (event) => {
    // Set stream to video element
    remoteVideo.srcObject = event.streams[0];

    // Attempt to autoplay video with sound
    remoteVideo.play().catch(e => console.warn('Auto-play prevented:', e));
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { target: from, candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      info.textContent = 'Connection lost.';
      remoteVideo.srcObject = null;
      pc = null;
    }
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: from, sdp: answer });
    info.textContent = 'Connected.';
  } catch (err) {
    console.error('Error handling offer', err);
    info.textContent = 'Failed to connect.';
  }
});

socket.on('ice-candidate', ({ from, candidate }) => {
  if (pc) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn(e));
  }
});
