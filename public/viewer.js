const socket = window.io ? io() : {
  on: () => {},
  emit: () => {},
  disconnect: () => {},
  connected: false
};

if (!window.io) {
  const infoEl = document.getElementById('info');
  const roomListDiv = document.getElementById('roomList');
  if (infoEl) {
    infoEl.textContent = 'Realtime connection is unavailable on GitHub Pages. Deploy the Node backend to a host like Render/Railway to enable live streaming.';
  }
  if (roomListDiv) {
    roomListDiv.textContent = 'Static preview only';
  }
  console.warn('Socket.IO client is unavailable. This page is being served by GitHub Pages, which does not host the Node backend.');
}

const remoteVideo = document.getElementById('remoteVideo');
const broadcasterCam = document.getElementById('broadcasterCam');

const info = document.getElementById('info');

const roomListDiv = document.getElementById('roomList');

const micBtn = document.getElementById('turnOnMic');
const startCamBtn = document.getElementById('startCam');
const localCamera = document.getElementById('localCamera');

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;

let micStream = null;

let camStream = null;

let broadcasterId = null; // NEW: store broadcaster's socket ID

let broadcasterScreenReceived = false;
let broadcasterCamReceived = false;

function renderRooms(rooms) {
  roomListDiv.innerHTML = '';
  if (rooms.length === 0) {
    roomListDiv.textContent = "No broadcasters online.";
    return;
  }
  rooms.forEach(room => {
    const btn = document.createElement('button');
    btn.innerHTML = `<i class="fas fa-broadcast-tower"></i> Watch ${room}`;
    btn.onclick = () => {
      // NEW: Ask for a username
      const userName = prompt("Enter your username:");
      if (!userName) return;

      socket.emit('viewer-join', { room, userName }); // Send userName here
      info.textContent = `Connecting to ${room}...`;
      micBtn.style.display = 'inline-block';
      startCamBtn.style.display = 'inline-block';
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
   info.textContent = 'No broadcaster connection yet. Join a room first.';
   return;
  }

  if (micStream) {
   const audioTrack = micStream.getAudioTracks()[0];
   if (audioTrack) {
    if (audioTrack.enabled) {
     audioTrack.enabled = false;
     micBtn.textContent = 'Turn on your Mic';
     info.textContent = 'Microphone muted.';
     console.log('Mic muted (track.enabled=false)');
     return;
    }
    audioTrack.enabled = true;
    micBtn.textContent = 'Mute Mic';
    info.textContent = 'Microphone unmuted.';
    console.log('Mic unmuted (track.enabled=true)');
    return;
   }
  }

  console.log('Requesting microphone access');
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  micStream.getAudioTracks().forEach(track => {
    console.log('Adding mic track to peer connection', track);
    pc.addTrack(track, micStream);
  });

  micBtn.textContent = 'Mute Mic';
  info.textContent = 'Microphone enabled. Connecting voice...';

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  console.log('Sending renegotiation offer to broadcaster', broadcasterId);
  socket.emit('offer', { target: broadcasterId, sdp: offer });

 } catch (err) {
  console.error('Could not get mic audio:', err);

  if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
   info.textContent = 'Microphone not found. Please attach a microphone and refresh.';
  } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
   info.textContent = 'Microphone access denied. Allow microphone permissions and try again.';
  } else {
   info.textContent = `Could not access microphone: ${err.message}`;
  }
 }
}

micBtn.onclick = startMic;

async function toggleCam() {
  try {
    if (!pc) {
      console.warn('No active connection to broadcaster.');
      info.textContent = 'No broadcaster connection yet. Join a room first.';
      return;
    }

    if (camStream) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) pc.removeTrack(sender);

      camStream.getTracks().forEach(t => t.stop());
      camStream = null;
      localCamera.srcObject = null;
      localCamera.style.display = 'none';
      startCamBtn.textContent = 'Start Camera';
      info.textContent = 'Camera stopped.';

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { target: broadcasterId, sdp: offer });
      return;
    }

    console.log('Requesting camera access');
    camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

    localCamera.srcObject = camStream;
    localCamera.style.display = 'block';
    startCamBtn.textContent = 'Stop Camera';
    info.textContent = 'Camera enabled. Connecting...';

    camStream.getVideoTracks().forEach(track => {
      console.log('Adding camera track to peer connection', track);
      pc.addTrack(track, camStream);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: broadcasterId, sdp: offer });
  } catch (err) {
    console.error('Could not get camera:', err);
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      info.textContent = 'Camera not found. Please attach a webcam and refresh.';
    } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      info.textContent = 'Camera access denied. Allow camera permissions and try again.';
    } else {
      info.textContent = `Could not access camera: ${err.message}`;
    }
  }
}

startCamBtn.onclick = toggleCam;

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

 if (camStream) {

  camStream.getTracks().forEach(t => t.stop());

  camStream = null;

  localCamera.srcObject = null;

  localCamera.style.display = 'none';

  startCamBtn.textContent = 'Start Camera';

 }

 broadcasterCam.srcObject = null;
 broadcasterCam.style.display = 'none';
 broadcasterScreenReceived = false;
 broadcasterCamReceived = false;

});



socket.on('offer', async ({ from, sdp }) => {
  broadcasterId = from; // store for mic renegotiation
  console.log('Received offer from broadcaster/viewer', from);

  if (!sdp) {
    info.textContent = 'No broadcaster currently available.';
    return;
  }

  if (!pc) {
    pc = new RTCPeerConnection(config);

    pc.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        if (!remoteVideo.srcObject) {
          remoteVideo.srcObject = event.streams[0];
        }
        return;
      }

      if (event.track.kind === 'video') {
        const stream = event.streams[0];

        if (!broadcasterScreenReceived) {
          remoteVideo.srcObject = stream;
          remoteVideo.style.display = 'block';
          broadcasterScreenReceived = true;
          console.log('Receiver: broadcaster screen stream set');
          return;
        }

        if (!broadcasterCamReceived) {
          broadcasterCam.srcObject = stream;
          broadcasterCam.style.display = 'block';
          broadcasterCamReceived = true;
          console.log('Receiver: broadcaster cam stream set');
          return;
        }

        // Fallback: if we already have both, keep screen on remoteVideo
        console.log('Receiver: extra video track received', event.track.label);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Viewer sending ice-candidate', event.candidate);
        socket.emit('ice-candidate', { target: from, candidate: event.candidate });
      }
    };
  }

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log('Viewer sending answer to', from);
    socket.emit('answer', { target: from, sdp: answer });
    info.textContent = 'Connected.';
  } catch (err) {
    console.error('Error handling offer', err);
  }
});



socket.on('ice-candidate', ({ from, candidate }) => {

 if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);

});