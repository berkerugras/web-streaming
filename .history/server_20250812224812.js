let rooms = {}; // { roomName: broadcasterSocketId }

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('broadcaster-join', ({ room }) => {
    console.log(`Broadcaster joined room: ${room}`);
    rooms[room] = socket.id;
    socket.join(room);
    socket.broadcast.emit('room-list', Object.keys(rooms));
  });

  socket.on('broadcaster-leave', ({ room }) => {
    console.log(`Broadcaster left room: ${room}`);
    delete rooms[room];
    socket.leave(room);
    socket.broadcast.emit('room-list', Object.keys(rooms));
  });

  socket.on('viewer-join', ({ room }) => {
    console.log(`Viewer joined room: ${room}`);
    socket.join(room);
    if (rooms[room]) {
      io.to(rooms[room]).emit('new-viewer', { viewerId: socket.id });
    } else {
      socket.emit('no-broadcaster');
    }
  });

  socket.on('offer', ({ target, sdp }) => {
    io.to(target).emit('offer', { from: socket.id, sdp });
  });

  socket.on('answer', ({ target, sdp }) => {
    io.to(target).emit('answer', { from: socket.id, sdp });
  });

  socket.on('ice-candidate', ({ target, candidate }) => {
    io.to(target).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);

    // Remove broadcaster if they disconnect
    for (const [room, id] of Object.entries(rooms)) {
      if (id === socket.id) {
        delete rooms[room];
        socket.broadcast.emit('room-list', Object.keys(rooms));
      }
    }

    socket.broadcast.emit('peer-left', { id: socket.id });
  });
});
