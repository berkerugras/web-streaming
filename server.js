const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));  

const BROADCASTER_PASSWORD = 'mySecret123';

let rooms = {};

// Redirect root to viewer.html
app.get('/', (req, res) => {
  res.redirect('/viewer.html');
});

app.post('/broadcaster-login', (req, res) => {
  const password = req.body.password;
  if (password === BROADCASTER_PASSWORD) {
    res.sendFile(path.join(__dirname, 'public', 'broadcaster.html'));
  } else {
    res.status(401).sendFile(path.join(__dirname, 'public', 'authorization.html'));
  }
});

app.get('/broadcaster.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'authorization.html'));
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('broadcaster-join', ({ room }) => {
    console.log(`Broadcaster ${socket.id} joined room: ${room}`);
    rooms[room] = socket.id;
    socket.join(room);
    io.emit('room-list', Object.keys(rooms));
  });

  socket.on('broadcaster-leave', ({ room }) => {
    console.log(`Broadcaster left room: ${room}`);
    delete rooms[room];
    socket.leave(room);
    io.emit('room-list', Object.keys(rooms));
    socket.broadcast.to(room).emit('broadcaster-offline');
  });

  // Viewer joins a room
  socket.on('viewer-join', ({ room, userName }) => {
    console.log(`Viewer ${userName} (${socket.id}) joined room: ${room}`);
    socket.join(room);
    
    if (rooms[room]) {
      // Send both the socket ID AND the username to the broadcaster
      io.to(rooms[room]).emit('new-viewer', { 
        viewerId: socket.id, 
        userName: userName || 'Anonymous' 
      });
    } else {
      socket.emit('no-broadcaster');
    }
  });

  // Signaling
  socket.on('offer', ({ target, sdp }) => {
    io.to(target).emit('offer', { from: socket.id, sdp });
  });

  socket.on('answer', ({ target, sdp }) => {
    io.to(target).emit('answer', { from: socket.id, sdp });
  });

  socket.on('ice-candidate', ({ target, candidate }) => {
    io.to(target).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('quality-adapt', ({ target, quality }) => {
    io.to(target).emit('quality-adapt', { from: socket.id, quality });
  });

  // Send initial room list
  socket.on('get-room-list', () => {
    socket.emit('room-list', Object.keys(rooms));
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    for (const [room, id] of Object.entries(rooms)) {
      if (id === socket.id) {
        delete rooms[room];
        io.emit('room-list', Object.keys(rooms));
        socket.broadcast.to(room).emit('broadcaster-offline');
      }
    }
    socket.broadcast.emit('peer-left', { id: socket.id });
  });
});
