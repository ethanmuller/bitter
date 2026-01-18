import { Server } from "socket.io";
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { sendMessage } from './discordBot.js'
import { rooms as roomData } from './src/rooms.js'

const w = 89
const h = 89
let rooms = {
  "a": initialize_canvas(), 
  "b": initialize_canvas(), 
  "c": initialize_canvas(), 
  "d": initialize_canvas(), 
};
const PORT = 3333

function resetPx(room) {
  rooms[room] = initialize_canvas(room)
}
function initialize_canvas(room) {
  const bits = new Array(h)

  for (let y = 0; y < h; y++) {
    bits[y] = []

    for (let x = 0; x < w; x++) {
      bits[y][x] = 0;
    }
  }
  return bits;
}


function chunkSet(room, panX, panY, chunkPx) {
  for (let y = 0; y < chunkPx.length; y++) {
    for (let x = 0; x < chunkPx.length; x++) {
      bit_set(room, x + panX, y + panY, chunkPx[y][x])
    }
  }
}

function bit_set(room, x, y, c) {
  rooms[room][y][x] = c
}

function bit_get(room, x, y) {
  return rooms[room][y][x]
}


async function createServer() {
  const app = express()

  // Configure Vite to use the same port
  const vite = await createViteServer({
    server: { 
      middlewareMode: 'html',
      port: PORT,
      strictPort: true // Force Vite to use our specified port
    }
  })
  // use vite's connect instance as middleware
  app.use(vite.middlewares)

  const server = app.listen(PORT)
  console.log(`listening on port ${PORT}`)
  const io = new Server(server, {
    path: '/bitter/socket/',
    cors: {
      origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:3333',
      methods: ["GET", "POST"]
    },
    transports: ['websocket']
  });
  

  io.on("connection", function (socket) {
    const room = socket.handshake.auth.room;

    if (room) {
      socket.join(room);
      const roomClients = Array.from(io.sockets.adapter.rooms.get(room) || []);
      io.to(room).emit('player list', roomClients)
      console.log(`${room} - join ${socket.id} @ ${new Date().toLocaleString()}`);
      sendMessage(`${roomClients.length} user(s) connected: https://ethanmuller.com/bitter/#/${room}`)
    } else {
      console.log('somebody joined the lobby');
    }

    const roomStatus = {};
    Object.keys(rooms).forEach(r => {
      const clients = Array.from(io.sockets.adapter.rooms.get(r) || []);
      roomStatus[r] = clients.length;
    });
    io.emit('room status', roomStatus);


    socket.on("join", function (cb) {
      const roomClients = Array.from(io.sockets.adapter.rooms.get(room) || []);
      cb({px: rooms[room], clientsList: roomClients})
    });

    socket.on("clear", function (cb) {
      let out = ''

      for (let y = 0; y < h; y++) {
        out += '\n'

        for (let x = 0; x < w; x++) {
          out += bit_get(x,y) ? '#' : ' '
        }
      }

      console.log(`cleared by ${socket.id} @ ${new Date().toLocaleString()}`)

      resetPx(room)
      io.to(room).emit("updateAll", px);
    });

    socket.on("pset", function (x,y, pan, c) {
      bit_set(room, x+pan[0], y+pan[1], c)
      socket.broadcast.to(room).emit("updatePx", x,y,pan,c);
    });
    socket.on("chunkSet", function (panX, panY, chunkPx) {
      chunkSet(room, panX, panY, chunkPx)
      socket.broadcast.to(room).emit("updateChunk", panX, panY, chunkPx);
    })

    socket.on("sfx", function (sfk) {
      socket.broadcast.to(room).emit("sfx", sfk);
    })
    socket.on('disconnect', (reason) => {
      if (room) {
        console.log(`${room} - disconnect: ${socket.id} @ ${new Date().toLocaleString()}, reason: ${reason}`)
        const roomClients = Array.from(io.sockets.adapter.rooms.get(room) || []);
        socket.broadcast.to(room).emit('player list', roomClients)
        if (roomClients.length < 1 ) {
          sendMessage(`Party's over: https://ethanmuller.com/bitter/#/${room}`)
        }
      }

      const roomStatus = {};
      Object.keys(rooms).forEach(r => {
        const clients = Array.from(io.sockets.adapter.rooms.get(r) || []);
        roomStatus[r] = clients.length;
      });
      io.emit('room status', roomStatus);
    })

  });
}

createServer()
