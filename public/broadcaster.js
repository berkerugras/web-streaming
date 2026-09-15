 const socket = io();

let localStream = null;

let micStream = null;

const pcs = {};

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const qualityPresets = {
  '720p': { width: 1280, height: 720, frameRate: 30 },
  '1080p': { width: 1920, height: 1080, frameRate: 30 },
  '4k': { width: 3840, height: 2160, frameRate: 30 }
};

let currentQuality = '720p';

async function setStreamQuality(quality) {
  if (!qualityPresets[quality]) return;
  currentQuality = quality;

  if (!localStream) {
    setStatus(`Quality set to ${quality} (applied on start)`);
    return;
  }

  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;

  try {
    await videoTrack.applyConstraints({
      width: qualityPresets[quality].width,
      height: qualityPresets[quality].height,
      frameRate: qualityPresets[quality].frameRate
    });
    setStatus(`Quality switched to ${quality}`);
  } catch (err) {
    console.warn('Could not apply constraints directly, reopening capture if possible', err);
    try {
      const newStream = await navigator.mediaDevices.getDisplayMedia({ video: qualityPresets[quality], audio: true });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = newStream;
        localVideo.srcObject = localStream;

        for (const pc of Object.values(pcs)) {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) sender.replaceTrack(newVideoTrack);
        }
        setStatus(`Quality switched to ${quality} by reopening capture`);
      }
    } catch (innerErr) {
      console.error('Failed to reopen display capture for quality change:', innerErr);
      setStatus(`Quality change to ${quality} failed.`);
    }
  }
}

const startBtn = document.getElementById('startBtn');

const stopBtn = document.getElementById('stopBtn');

const recordBtn = document.getElementById('recordBtn');

const localVideo = document.getElementById('localVideo');

const statusDiv = document.getElementById('status');

const toggleMicBtn = document.getElementById('turnOnMic');

const toggleCamBtn = document.getElementById('turnOnCam');

const turnOnViewerCamBtn = document.getElementById('turnOnViewerCam');

const localCam = document.getElementById('localCam');

const viewerAudio = document.getElementById('viewerAudio');

const viewerCams = document.getElementById('viewerCams');

const viewersMap = {}; // This stores { socketId: userName }

const viewerListUI = document.getElementById('viewerList'); // Ensure this ID exists in HTML

let roomName = null;

let mediaRecorder = null;

let recordedChunks = [];

let micOn = false;
let camOn = false;
let camStream = null;


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

function addViewerCamElement(viewerId, stream) {
  if (!viewerCams) return;
  let el = document.getElementById(`viewer-cam-${viewerId}`);
  if (!el) {
    el = document.createElement('video');
    el.id = `viewer-cam-${viewerId}`;
    el.autoplay = true;
    el.playsInline = true;
    el.style.width = '100%';
    el.style.maxWidth = '300px';
    el.style.borderRadius = '8px';
    el.style.backgroundColor = '#000';
    viewerCams.appendChild(el);
  }
  el.srcObject = stream;
}

function removeViewerCamElement(viewerId) {
  const el = document.getElementById(`viewer-cam-${viewerId}`);
  if (el) el.remove();
}

turnOnViewerCamBtn.onclick = () => {
  if (!viewerCams) return;
  const isHidden = viewerCams.style.display === 'none' || !viewerCams.style.display;
  viewerCams.style.display = isHidden ? 'grid' : 'none';
  turnOnViewerCamBtn.textContent = isHidden ? 'Hide Viewer Cams' : 'Show Viewer Cams';
};

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

 if (camStream) camStream.getTracks().forEach(t => t.stop());



 Object.values(pcs).forEach(pc => pc.close());

 for (const k in pcs) delete pcs[k];



 socket.emit('broadcaster-leave', { room: roomName });

 localVideo.srcObject = null;

 localCam.srcObject = null;
 localCam.style.display = 'none';

 setStatus('Stopped');

 startBtn.disabled = false;

 stopBtn.disabled = true;

 micOn = false;
 camOn = false;

 toggleMicBtn.textContent = 'Turn On Mic';
 toggleCamBtn.textContent = 'Enable Cam';

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

async function addCamTracks() {
  camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  setStatus('Broadcaster Cam is ON');
  toggleCamBtn.textContent = 'Turn Off Cam';
  camOn = true;
  localCam.srcObject = camStream;
  localCam.style.display = 'block';

  for (const [viewerId, pc] of Object.entries(pcs)) {
    camStream.getVideoTracks().forEach(track => pc.addTrack(track, camStream));
    await renegotiate(pc, viewerId);
  }
}

async function removeCamTracks() {
  if (!camStream) return;

  for (const [viewerId, pc] of Object.entries(pcs)) {
    pc.getSenders().forEach(sender => {
      if (sender.track && camStream.getTracks().includes(sender.track)) {
        pc.removeTrack(sender);
      }
    });
    await renegotiate(pc, viewerId);
  }

  camStream.getTracks().forEach(track => { track.stop(); });
  camStream = null;
  localCam.srcObject = null;
  localCam.style.display = 'none';

  setStatus('Broadcaster Cam is OFF');
  toggleCamBtn.textContent = 'Enable Cam';
  camOn = false;
}


toggleMicBtn.onclick = () => micOn ? removeMicTracks() : addMicTracks();

toggleCamBtn.onclick = () => camOn ? removeCamTracks() : addCamTracks();

// Update the new-viewer listener
socket.on('new-viewer', async ({ viewerId, userName }) => {
  if (!localStream) return;

  // Store the mapping
  viewersMap[viewerId] = userName;
  updateViewerUI();

  const pc = new RTCPeerConnection(config);
  pcs[viewerId] = pc;

  // Receive viewer mic + camera data on this same connection
  pc.ontrack = (event) => {
    if (event.track.kind === 'audio') {
      console.log("Received viewer's audio track on existing pc.");
      viewerAudio.srcObject = event.streams[0];
      setStatus(`Receiving voice from ${userName || 'viewer'}`);
    }
    if (event.track.kind === 'video') {
      console.log("Received viewer's camera track.");
      addViewerCamElement(viewerId, event.streams[0]);
      setStatus(`Receiving camera from ${userName || 'viewer'}`);
    }
  };

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  if (camOn && camStream) {
    camStream.getVideoTracks().forEach(track => pc.addTrack(track, camStream));
  }

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
  removeViewerCamElement(id);
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
