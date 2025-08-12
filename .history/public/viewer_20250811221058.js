const socket = io();
const remoteVideo = document.getElementById('remoteVideo');
const info = document.getElementById('info');
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;
let micStream = null;

socket.emit('viewer-join');

async function startMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getAudioTracks().forEach(track => pc.addTrack(track, micStream));
  } catch (err) {
    console.error('Could not get mic audio:', err);
  }
}

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
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
});

socket.on('offer', async ({ from, sdp }) => {
  if (!sdp) {
    info.textContent = 'No broadcaster currently available.';
    return;
  }

  pc = new RTCPeerConnection(config);

  // Add mic audio tracks before setting remote description
  await startMic();

  pc.ontrack = (event) => {
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
