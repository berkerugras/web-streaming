const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));

let broadcasterSocketId = null;

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('broadcaster-join', () => {
    console.log('Broadcaster joined:', socket.id);
    broadcasterSocketId = socket.id;
    socket.broadcast.emit('broadcaster-online');
  });

  socket.on('broadcaster-leave', () => {
    console.log('Broadcaster left');
    broadcasterSocketId = null;
    socket.broadcast.emit('broadcaster-offline');
  });

  socket.on('viewer-join', () => {
    console.log('Viewer joined:', socket.id);
    if (broadcasterSocketId) {
      io.to(broadcasterSocketId).emit('new-viewer', { viewerId: socket.id });
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
    if (socket.id === broadcasterSocketId) {
      broadcasterSocketId = null;
      socket.broadcast.emit('broadcaster-offline');
    }
    socket.broadcast.emit('peer-left', { id: socket.id });
  });
});
