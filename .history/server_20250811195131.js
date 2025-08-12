const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { log } = require('console');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Password for broadcaster
const BROADCASTER_PASSWORD = 'mySecret123';



// Redirect root to viewer.html
app.get('/', (req, res) => {
  res.redirect('/viewer.html');
});

// Protect broadcaster.html
app.get('/broadcaster.html', (req, res) => {
  const password = req.query.password;
  if (password === BROADCASTER_PASSWORD) {
    console.log(password);
    res.sendFile(path.join(__dirname, 'public', 'broadcaster.html'));

  } else {
    res.status(401).send(`
      <html>
        <body style="font-family: sans-serif;">
          <h2>Enter Broadcaster Password</h2>
          <form method="GET" action="/broadcaster.html">
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Submit</button>
          </form>
          ${password ? '<p style="color:red;">Unauthorized: Wrong password</p>' : ''}
        </body>
      </html>
    `);
  }
});

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
