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

  if (pc) {
    // Close previous pc if any before creating new one (e.g. after renegotiation)
    pc.close();
    pc = null;
  }

  pc = new RTCPeerConnection(config);

  pc.ontrack = (event) => {
    // Remote stream will include video and audio (mic)
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { target: from, candidate: event.candidate });
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
  }
});

socket.on('ice-candidate', ({ from, candidate }) => {
  if (pc) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn(e));
  }
});
