startBtn.onclick = async () => {
  try {
    const room = prompt("Enter room name for this broadcast:");
    if (!room) return;

    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    setStatus(`Sharing screen in room: ${room}`);
    startBtn.disabled = true;
    stopBtn.disabled = false;

    socket.emit('broadcaster-join', { room });
  } catch (err) {
    console.error('Error getting display media', err);
    alert('Could not start screen sharing: ' + err.message);
  }
};
