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

  broadcasterId = from; // store for mic renegotiation

  if (!sdp) {

    info.textContent = 'No broadcaster currently available.';

    return;

  }



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

});



socket.on('ice-candidate', ({ from, candidate }) => {

  if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);

});