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
    // Check if the viewer is sending an offer for THEIR microphone.
    // This part of the code is for handling offers from the viewer to the broadcaster,
    // not the other way around. The broadcaster needs a new PC to receive this.
    
    // We create a NEW RTCPeerConnection for the viewer-to-broadcaster flow.
    const pcViewerToBroadcaster = new RTCPeerConnection(config);
    
    // We need a place to store this new PC. Let's create a new object.
    pcs[from + '_viewer'] = pcViewerToBroadcaster;

    // Set up the ontrack handler to receive the viewer's audio.
    pcViewerToBroadcaster.ontrack = (event) => {
        if (event.track.kind === 'audio') {
            console.log("Received viewer's audio track!");
            
            // Create a new audio element to play the viewer's sound.
            // Using a new element prevents mixing up streams.
            const viewerAudioElement = document.createElement('audio');
            viewerAudioElement.srcObject = event.streams[0];
            viewerAudioElement.autoplay = true;
            viewerAudioElement.playsInline = true;
            
            // Append the audio element to the document body or a dedicated div.
            document.body.appendChild(viewerAudioElement);
            
        }
    };

    // Set up the onicecandidate handler to send candidates back to the viewer.
    pcViewerToBroadcaster.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: from, candidate: event.candidate });
        }
    };
    
    // Set the remote description with the offer from the viewer.
    await pcViewerToBroadcaster.setRemoteDescription(new RTCSessionDescription(sdp));
    
    // Create an answer and set it as the local description.
    const answer = await pcViewerToBroadcaster.createAnswer();
    await pcViewerToBroadcaster.setLocalDescription(answer);
    
    // Send the answer back to the viewer.
    socket.emit('answer', { target: from, sdp: answer });
});
