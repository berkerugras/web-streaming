const socket = io();
const remoteVideo = document.getElementById('remoteVideo');
const info = document.getElementById('info');
const roomListDiv = document.getElementById('roomList');
const micBtn = document.getElementById('turnOnMic');

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let pc = null;
let micStream = null;
let broadcasterId = null; // NEW: store broadcaster's socket ID

function renderRooms(rooms) {
  roomListDiv.innerHTML = '';
  if (rooms.length === 0) {
    roomListDiv.textContent = "No broadcasters online.";
    return;
  }
  rooms.forEach(room => {
    const btn = document.createElement('button');
    btn.textContent = `Watch ${room}`;
    btn.onclick = () => {
      socket.emit('viewer-join', { room });
      info.textContent = `Connecting to ${room}...`;
      micBtn.style.display = 'inline-block';
    };
    roomListDiv.appendChild(btn);
  });
}

socket.on('room-list', renderRooms);
socket.emit('get-room-list');

async function startMic() {
  try {
    if (!pc) {
      console.warn("No active connection to broadcaster.");
      return;
    }

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getAudioTracks().forEach(track => pc.addTrack(track, micStream));

    // renegotiate
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: broadcasterId, sdp: offer }); // send to broadcaster
  } catch (err) {
    console.error('Could not get mic audio:', err);
  }
}
micBtn.onclick = startMic;

socket.on('no-broadcaster', () => {
  info.textContent = 'No broadcaster in this room.';
});

socket.on('broadcaster-offline', () => {
  info.textContent = 'Broadcaster went offline.';
  if (pc) { pc.close(); pc = null; }
  remoteVideo.srcObject = null;
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
});
socket.on('offer', async ({ from, sdp }) => {
    let pc = pcs[from];
    if (!pc) {
        pc = new RTCPeerConnection(config);
        pcs[from] = pc;

        pc.ontrack = (event) => {
            if (event.track.kind === 'audio') {
                viewerAudio.srcObject = event.streams[0];
                viewerAudio.playsInline = true;
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { target: from, candidate: event.candidate });
            }
        };

        // Add localStream tracks once here (screen + mic)
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }
    }

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: from, sdp: answer });
});