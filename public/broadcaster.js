 const socket = io();

let localStream = null;

let micStream = null;

const pcs = {};

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };



const startBtn = document.getElementById('startBtn');

const stopBtn = document.getElementById('stopBtn');

const recordBtn = document.getElementById('recordBtn');

const localVideo = document.getElementById('localVideo');

const statusDiv = document.getElementById('status');

const toggleMicBtn = document.getElementById('turnOnMic');

const viewerAudio = document.getElementById('viewerAudio');

const viewersMap = {}; // This stores { socketId: userName }

const viewerListUI = document.getElementById('viewerList'); // Ensure this ID exists in HTML

let roomName = null;

let mediaRecorder = null;

let recordedChunks = [];

let micOn = false;



function setStatus(msg) {

 statusDiv.textContent = 'Status: ' + msg;

}

function updateViewerUI() {
  if (!viewerListUI) return;
  viewerListUI.innerHTML = '';
  Object.values(viewersMap).forEach(name => {
    const li = document.createElement('li');
    li.innerHTML = name + ' <i class="fa-solid fa-user"></i>';
    viewerListUI.appendChild(li);
  });
}

startBtn.onclick = async () => {

 try {

  roomName = prompt("Enter room name for this broadcast:");

  if (!roomName) return;



  localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

  localVideo.srcObject = localStream;



  setStatus(`Sharing screen in room: ${roomName}`);

  startBtn.disabled = true;

  stopBtn.disabled = false;



  socket.emit('broadcaster-join', { room: roomName });

 } catch (err) {

  console.error('Error getting display media', err);

  alert('Could not start screen sharing: ' + err.message);

 }

};



stopBtn.onclick = () => {

 if (localStream) localStream.getTracks().forEach(t => t.stop());

 if (micStream) micStream.getTracks().forEach(t => t.stop());



 Object.values(pcs).forEach(pc => pc.close());

 for (const k in pcs) delete pcs[k];



 socket.emit('broadcaster-leave', { room: roomName });

 localVideo.srcObject = null;

 setStatus('Stopped');

 startBtn.disabled = false;

 stopBtn.disabled = true;

 micOn = false;

 toggleMicBtn.textContent = 'Turn On Mic';

};


async function renegotiate(pc, viewerId) {

 const offer = await pc.createOffer();

 await pc.setLocalDescription(offer);

 socket.emit('offer', { target: viewerId, sdp: offer });

}



async function addMicTracks() {

 micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

 setStatus('Mic is ON');

 toggleMicBtn.textContent = 'Turn Off Mic';

 micOn = true;

 micStream.getAudioTracks().forEach(track => localStream.addTrack(track));

 for (const [viewerId, pc] of Object.entries(pcs)) {

  micStream.getAudioTracks().forEach(track => pc.addTrack(track, localStream));

  await renegotiate(pc, viewerId);

 }

}



async function removeMicTracks() {

 if (!micStream) return;

 for (const [viewerId, pc] of Object.entries(pcs)) {

  pc.getSenders().forEach(sender => {

   if (sender.track && micStream.getTracks().includes(sender.track)) {

    pc.removeTrack(sender);

   }

  });

  await renegotiate(pc, viewerId);

 }

 micStream.getTracks().forEach(track => { localStream.removeTrack(track); track.stop(); });

 micStream = null;

 setStatus('Mic is OFF');

 toggleMicBtn.textContent = 'Turn On Mic';

 micOn = false;

}



toggleMicBtn.onclick = () => micOn ? removeMicTracks() : addMicTracks();



// Update the new-viewer listener
socket.on('new-viewer', async ({ viewerId, userName }) => {
  if (!localStream) return;

  // Store the mapping
  viewersMap[viewerId] = userName;
  updateViewerUI();

  const pc = new RTCPeerConnection(config);
  pcs[viewerId] = pc;

  // Receive viewer mic audio on this same connection
  pc.ontrack = (event) => {
    if (event.track.kind === 'audio') {
      console.log("Received viewer's audio track on existing pc.");
      viewerAudio.srcObject = event.streams[0];
      setStatus(`Receiving voice from ${userName || 'viewer'}`);
    }
  };

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit('ice-candidate', { target: viewerId, candidate: e.candidate }); };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { target: viewerId, sdp: offer });
});




socket.on('answer', async ({ from, sdp }) => {

 if (pcs[from]) await pcs[from].setRemoteDescription(new RTCSessionDescription(sdp));

});



socket.on('ice-candidate', ({ from, candidate }) => {

 if (pcs[from]) pcs[from].addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);

});



socket.on('peer-left', ({ id }) => {
  if (pcs[id]) {
    pcs[id].close();
    delete pcs[id];
  }
  // Remove from map and update UI
  if (viewersMap[id]) {
    delete viewersMap[id];
    updateViewerUI();
  }
});




socket.on('offer', async ({ from, sdp }) => {
  // In this app we use one RTCPeerConnection per viewer for both directions.
  if (!pcs[from]) {
    console.warn('Offer received from unknown viewer:', from);
    return;
  }

  try {
    const pc = pcs[from];
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: from, sdp: answer });
  } catch (err) {
    console.error('Error handling viewer renegotiation offer:', err);
  }
});
