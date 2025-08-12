const socket = io();
const remoteVideo = document.getElementById('remoteVideo');
const info = document.getElementById('info');
const roomListDiv = document.getElementById('roomList');
const micBtn = document.getElementById('turnOnMic');

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let pc = null; // PC for receiving broadcaster's stream
let audioPc = null; // PC for sending viewer's mic audio
let micStream = null;
let broadcasterId = null; 
let micOn = false;

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
    if (micOn) return;

    audioPc = new RTCPeerConnection(config);
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getAudioTracks().forEach(track => audioPc.addTrack(track, micStream));
    micOn = true;
    micBtn.textContent = 'Turn Off Mic';

    audioPc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: broadcasterId, candidate: event.candidate });
        }
    };
    
    const offer = await audioPc.createOffer();
    await audioPc.setLocalDescription(offer);
    socket.emit('offer', { target: broadcasterId, sdp: offer });

  } catch (err) {
    console.error('Could not get mic audio:', err);
  }
}

async function stopMic() {
    if (!micOn) return;
    
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;

    if (audioPc) {
        audioPc.close();
        audioPc = null;
    }

    micOn = false;
    micBtn.textContent = 'Turn On Mic';
}

micBtn.onclick = () => {
    micOn ? stopMic() : startMic();
};

socket.on('no-broadcaster', () => {
  info.textContent = 'No broadcaster in this room.';
});

socket.on('broadcaster-offline', () => {
  info.textContent = 'Broadcaster went offline.';
  if (pc) { pc.close(); pc = null; }
  if (audioPc) { audioPc.close(); audioPc = null; }
  remoteVideo.srcObject = null;
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
});

socket.on('offer', async ({ from, sdp }) => {
  broadcasterId = from;
  if (!sdp) {
    info.textContent = 'No broadcaster currently available.';
    return;
  }

  if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { target: from, sdp: answer });
  } else {
      pc = new RTCPeerConnection(config);
      pc.ontrack = (event) => { remoteVideo.srcObject = event.streams[0]; };
      pc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('ice-candidate', { target: from, candidate: event.candidate });
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
  }
});

socket.on('answer', async ({ from, sdp }) => {
    if (from === broadcasterId && audioPc) {
        await audioPc.setRemoteDescription(new RTCSessionDescription(sdp));
    } else if (from === broadcasterId && pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
});

socket.on('ice-candidate', ({ from, candidate }) => {
  if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
  if (audioPc) audioPc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
});