import { sfx } from '../Sfx.js'
import { defineStore } from "pinia"
import { io } from 'socket.io-client'
import { viewWidth, viewHeight, imageWidth, imageHeight } from '../dimensions'
import { useRoute } from 'vue-router';

const getLastSegment = (path) => {
  const segments = path.split('/');
  return segments.pop();
};

function createEmptyGrid(width, height) {
  const grid = new Array(height)

  for (let y = 0; y < height; y++) {
    grid[y] = []

    for (let x = 0; x < width; x++) {
      grid[y][x] = 0
    }
  }

  return grid
}

export const usePxStore = defineStore('main', {
  state() {
    const route = useRoute();


    return {
      px: createEmptyGrid(imageWidth, imageHeight),
      clipboard: createEmptyGrid(viewWidth, viewHeight),
      socket: null,
      pan: [0,0],
      panJump: true,
      draggin: false,
      invertFlip: 0,
      xFlip: 0,
      yFlip: 0,
      rotateFlip: 0,
      room: getLastSegment(route.path),
    }
  },
  persist: {
    pick: ['clipboard'],
  },
  getters: {
  },
  actions: {
    initializeSocket() {
      const route = useRoute();
      this.socket = io(window.location.origin, {
        path: '/bitter/socket/',
        transports: ['websocket'],
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        auth: {
          room: getLastSegment(route.path),
        },
      });
    },
    disconnectSocket() {
      this.socket.disconnect();
    },
    pget(x, y) {
      if (this.px[y]) {
        return this.px[y + this.pan[1]][x + this.pan[0]]
      } else {
        return 0
      }
    },
    pset(x,y,c) {
      this.px[y][x] = c
    },
    chunkSet(panX, panY, chunkPx) {
      for (let y = 0; y < chunkPx.length; y++) {
        for (let x = 0; x < chunkPx.length; x++) {
          this.pset(x + panX, y + panY, chunkPx[y][x])
        }
      }
    },
    chunkGet(offsetX, offsetY, width, height) {
      const chunk = Array(height).fill().map(() => Array(width).fill(0))
      for (let y = 0; y < chunk.length; y++) {
        for (let x = 0; x < chunk.length; x++) {
          chunk[y][x] = this.px[y+offsetY][x+offsetX]
        }
      }
      return chunk
    },
    setPan(x, y) {
      x = Math.max(x, 0)
      x = Math.min(imageWidth-viewWidth, x)
      y = Math.max(y, 0)
      y = Math.min(imageHeight-viewHeight, y)

      this.pan[0] = x
      this.pan[1] = y

      sfx.nav({ short: !this.panJump })
    },
    changeTheme(t) {
      this.currentTheme = t
    },
    cut() {
      for (let y = 0; y < this.clipboard.length; y++) {
        for (let x = 0; x < this.clipboard.length; x++) {
          this.clipboard[y][x] = this.px[y + this.pan[1]][x + this.pan[0]]
        }
      }

      this.clearView()
    },
    clearView() {
      const f = new Array(viewHeight)

      for (let y = 0; y < viewHeight; y++) {
        f[y] = []

        for (let x = 0; x < viewWidth; x++) {
          f[y][x] = 0
        }
      }

      this.chunkSet(this.pan[0], this.pan[1], f)
      this.socket.emit('chunkSet', this.pan[0], this.pan[1], f)
    },
  },
})


