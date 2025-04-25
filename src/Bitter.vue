<script setup>
import { reactive, watch, ref, onMounted, onUnmounted, nextTick } from 'vue'
import Spreditor from './components/Spreditor.vue'
import Spravigator from './components/Spravigator.vue'
import { usePxStore } from './stores/PxStore.js'
import { sfx } from './Sfx.js'
import * as Tone from 'tone'
import { viewWidth, viewHeight, imageWidth, imageHeight } from './dimensions'
import { useRoute } from 'vue-router';
import { rooms as roomData } from './rooms';

const route = useRoute();

const getLastSegment = () => {
  const path = route.path;
  const segments = path.split('/');
  return segments.pop();
};

const room = roomData[getLastSegment()]
const theme = room.theme

const store = usePxStore()

const clientsList = ref([])
const exportWindowOpen = ref(false)

store.$subscribe((mutation, s) => {
  updateCanvas()
})

const clipboardCanvas = ref(null)
const exportPreviewCanvas = ref(null)
const exportCtx = ref(null)
const exportScale = ref(4)
const exportFg = ref('black')
const exportBg = ref('white')

watch([exportScale, exportFg, exportBg], function() {
  nextTick(() => {
    renderExportPreview()
  })
})

const themeSynth = new Tone.PolySynth().toDestination();
themeSynth.set({
  oscillator: {
    type: 'sine',
  },
  envelope: {
    attack: 0,
    decay: 0.2,
    sustain: 0,
    release: 0,
  },
  filter : {
    Q: 2,
    type : 'lowpass' ,
    rolloff : -48,
    frequency: 200,
  },
});

const state = reactive({
  ctx: null,
})

function handleKeyDown(event) {
   if (event.key === 'w' || event.key === 'ArrowUp') {
    shiftPan(0, -1)
   }
   if (event.key === 'a' || event.key === 'ArrowLeft') {
    shiftPan(-1, 0)
   }
   if (event.key === 's' || event.key === 'ArrowDown') {
    shiftPan(0, 1)
   }
   if (event.key === 'd' || event.key === 'ArrowRight') {
    shiftPan(1, 0)
   }
}

onMounted(async () => {
  await store.initializeSocket();

  state.ctx = clipboardCanvas.value.getContext('2d')
  exportCtx.value = exportPreviewCanvas.value.getContext('2d')

  setupSocketEvents();

  updateCanvas()


  window.addEventListener('focus', windowReturn);
  window.addEventListener('blur', windowLeave);
  window.addEventListener('keydown', handleKeyDown);
})

onUnmounted(() => {
  store.disconnectSocket()

  window.removeEventListener('focus', windowReturn);
  window.removeEventListener('blur', windowLeave);
  window.removeEventListener('keydown', handleKeyDown);
})

function updateCanvas() {
  if (state && state.ctx) {
    const pxColor = theme.fg

    state.ctx.fillStyle = pxColor
    state.ctx.clearRect(0, 0, 9, 9)

    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const v = store.clipboard[y][x]
        if (v === 1) {
          state.ctx.fillRect(x,y,1,1)
        }
      }
    }
  }
}

function clear() {
  store.clearView()
  store.socket.emit('chunkSet', store.pan[0], store.pan[1], f)
}

function copy() {
  for (let y = 0; y < store.clipboard.length; y++) {
    for (let x = 0; x < store.clipboard.length; x++) {
      store.clipboard[y][x] = store.px[y + store.pan[1]][x + store.pan[0]]
    }
  }
}

function isChunkEmpty(chunk) {
  const height = chunk.length
  const width = chunk[0].length

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (chunk[y][x] !== 0) {
        return false
      }
    }
  }

  return true
}

function invert() {
  const chunk = getViewedChunk()

  const height = chunk.length
  const width = chunk[0].length

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      chunk[y][x] = chunk[y][x] === 1 ? 0 : 1
    }
  }

  store.chunkSet(store.pan[0], store.pan[1], chunk)
  store.socket.emit('chunkSet', store.pan[0], store.pan[1], chunk)

  store.invertFlip = (store.invertFlip + 1) % 2
  sfx.bwip()
  store.socket.emit('sfx', 'bwip')
}

function life() {
  const chunk = getViewedChunk()
  const height = chunk.length
  const width = chunk[0].length
  
  // Create a copy of the current state to calculate the next generation
  const nextGen = Array(height).fill().map(() => Array(width).fill(0))
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Count live neighbors, including wrap-around
      let liveNeighbors = 0
      
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          // Skip the cell itself
          if (dx === 0 && dy === 0) continue
          
          // Calculate neighbor coordinates with wrap-around
          const nx = (x + dx + width) % width
          const ny = (y + dy + height) % height
          
          // Add to live neighbor count if the neighbor is alive
          liveNeighbors += chunk[ny][nx] ? 1 : 0
        }
      }
      
      // Apply Conway's Game of Life rules
      if (chunk[y][x]) {
        // Cell is currently alive
        nextGen[y][x] = (liveNeighbors === 2 || liveNeighbors === 3) ? 1 : 0
      } else {
        // Cell is currently dead
        nextGen[y][x] = (liveNeighbors === 3) ? 1 : 0
      }
    }
  }
  
  // Update the chunk with the next generation
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      chunk[y][x] = nextGen[y][x]
    }
  }
  
  // Store and emit the updated chunk
  store.chunkSet(store.pan[0], store.pan[1], chunk)
  store.socket.emit('chunkSet', store.pan[0], store.pan[1], chunk)
  sfx.bwip()
  store.socket.emit('sfx', 'bwip')
}

function xFlip() {
  const chunk = getViewedChunk()

  const height = chunk.length

  for (let y = 0; y < height; y++) {
    chunk[y].reverse()
  }

  store.chunkSet(store.pan[0], store.pan[1], chunk)
  store.socket.emit('chunkSet', store.pan[0], store.pan[1], chunk)

  store.xFlip = (store.xFlip + 1) % 2
  sfx.bwip()
  store.socket.emit('sfx', 'bwip')
}

function yFlip() {
  const chunk = getViewedChunk()


  chunk.reverse()

  store.chunkSet(store.pan[0], store.pan[1], chunk)
  store.socket.emit('chunkSet', store.pan[0], store.pan[1], chunk)

  store.yFlip = (store.yFlip + 1) % 2
  sfx.bwip()
  store.socket.emit('sfx', 'bwip')
}

function rotate90_clockwise() {
  const chunk = getViewedChunk()

  const rows = chunk.length;
  const cols = chunk[0].length;
  const rotatedChunk = [];
  for (let j = 0; j < cols; j++) {
    rotatedChunk[j] = [];
    for (let i = rows - 1; i >= 0; i--) {
      rotatedChunk[j].push(chunk[i][j]);
    }
  }

  store.chunkSet(store.pan[0], store.pan[1], rotatedChunk)
  store.socket.emit('chunkSet', store.pan[0], store.pan[1], rotatedChunk)

  store.rotateFlip = (store.rotateFlip + 1) % 4
  sfx.bwip()
  store.socket.emit('sfx', 'bwip')
}


function getViewedChunk() {
  const chunk = store.px.slice(store.pan[1], store.pan[1]+9)

  for (let y = 0; y < 9; y++) {
    chunk[y] = chunk[y].slice(store.pan[0], store.pan[0]+9)
  }

  return chunk
}

function cut() {
  store.cut()
  sfx.down()
  store.socket.emit('sfx', 'down')
}

function shiftPan(x,y) {
  if (store.panJump) {
    store.setPan(
      Math.round((store.pan[0] + x*viewWidth)/viewWidth)*viewWidth,
      Math.round((store.pan[1] + y*viewHeight)/viewHeight)*viewHeight
    )
  } else {
    store.setPan(store.pan[0] + x, store.pan[1] + y)
  }
}

function randomize() {
  const chunk = getViewedChunk()

  const height = chunk.length
  const width = chunk[0].length

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.random() >= 0.95;
      if (r) {
        chunk[y][x] = chunk[y][x] === 1 ? 0 : 1
      }
    }
  }

  store.chunkSet(store.pan[0], store.pan[1], chunk)
  store.socket.emit('chunkSet', store.pan[0], store.pan[1], chunk)

  sfx.csh()
  store.socket.emit('sfx', 'csh')
}

function paste() {
  store.chunkSet(store.pan[0], store.pan[1], store.clipboard)
  store.socket.emit('chunkSet', store.pan[0], store.pan[1], store.clipboard)

  sfx.up()
  store.socket.emit('sfx', 'up')
}

function triggerThemeChange(ev, themeName) {
  store.changeTheme(themeName)

  try {
    themeSynth.triggerAttackRelease(750, "64n");
  } catch(e) {
  }
}

function clearAll() {
  const shouldClear = confirm('Clear the whole board?')
  if (shouldClear) {
    store.socket.emit('clear')
  }
}

function setupSocketEvents() {
  store.socket.on('sfx', (sfk) => {
    sfx[sfk]()
  })

  store.socket.on('theme changed', (themeName) => {
    store.changeTheme(themeName)

    try {
      themeSynth.triggerAttackRelease(750, "64n");
    } catch(e) {
    }
  })

  store.socket.on('player list', (list) => {
    //clientsList.value = list.filter((invertFlip) => invertFlip !== store.socket.id)
    clientsList.value = list
  })
}

function windowLeave() {
}

function windowReturn() {
  store.socket.emit('join', (data) => {
    store.px = data.px
    updateCanvas()
    clientsList.value = data.clientsList
  })
}

function openExportWindow() {
  exportWindowOpen.value = true
  window.scrollTo(0,0)
  renderExportPreview()
}

function renderExportPreview() {
  exportCtx.value.scale(exportScale.value, exportScale.value)

  exportCtx.value.clearRect(0,0, imageWidth,imageHeight)

  exportCtx.value.fillStyle = exportBg.value
  exportCtx.value.fillRect(0,0,imageWidth,imageHeight)

  exportCtx.value.fillStyle = exportFg.value
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const v = store.px[y][x]
      if (v === 1) {
        exportCtx.value.fillRect(x,y,1,1)
      }
    }
  }
  // Reset the scale
  exportCtx.value.setTransform(1, 0, 0, 1, 0, 0)
}

function closeExportWindow() {
  exportWindowOpen.value = false
}

function getFormattedTimestamp() {
  const now = new Date();

  const pad = (n) => String(n).padStart(2, '0');

  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1); // Months are 0-indexed
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());

  return `${year}-${month}-${day}--${hours}_${minutes}_${seconds}`;
}

function downloadPng() {
  const imageURL = exportPreviewCanvas.value.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = imageURL;
  link.download = `bitter-${getFormattedTimestamp()}@${exportScale.value}x.png`;
  link.click()
}

</script>


<template>
  <div class="wrapper">
    <div v-show="exportWindowOpen" class="export-window dialog-window">
      <button @click="closeExportWindow" class="dialog-window__close-button" aria-label="close">&times;</button>
      <div class="export-window__canvas-wrapper">
        <canvas ref="exportPreviewCanvas" :width="imageWidth*exportScale" :height="imageHeight*exportScale" class="export-canvas"></canvas>
      </div>
      <div class="dialog-window__actions">
        <div class="radio-button-group">
          <h2>background</h2>
          <div>
            <label>
              <input type="radio" value="white" name="exportBg" v-model="exportBg" />
              white
            </label>
            <label>
              <input type="radio" value="transparent" name="exportBg" v-model="exportBg" />
              transparent
            </label>
          </div>
        </div>
        <div class="radio-button-group">
          <h2>bit color</h2>
          <div>
            <label>
              <input type="radio" value="black" name="exportFg" v-model="exportFg" />
              black
            </label>
            <label>
              <input type="radio" :value="theme.fg" name="exportFg" v-model="exportFg" />
              room color
            </label>
          </div>
        </div>
        <div class="radio-button-group">
          <h2>scale</h2>
          <div class="flex">
            <label>
              <input type="radio" value="1" name="exportScale" v-model="exportScale" />&times;1
            </label>
            <label>
              <input type="radio" value="2" name="exportScale" v-model="exportScale" />&times;2
            </label>
            <label>
              <input type="radio" value="4" name="exportScale" v-model="exportScale" />&times;4
            </label>
            <label>
              <input type="radio" value="8" name="exportScale" v-model="exportScale" />&times;8
            </label>
          </div>
        </div>
        <button @click="downloadPng" class="neo-btn neo-btn--auto">💾 Download PNG</button>
      </div>
    </div>
    <div :style="{ opacity: !exportWindowOpen ? 1 : 0.25, transition: 'all 500ms ease-out'}">
      <div class="status-bar" v-if="store.socket && store.socket.connected && clientsList && clientsList.length">
        <div><span class="indicator positive"></span> Connected to <strong>{{room.name}}</strong></div>
        <div>Users online: {{clientsList.length}}</div>
      </div>
      <div class="status-bar" v-else>
        <div><span class="indicator warning"></span> Connecting...</div>
      </div>
      <div :style="{ opacity: store.socket && store.socket.connected ? 1 : 0.25, transition: 'all 500ms ease-out'}">
        <Spreditor tone="Tone" :theme="theme" width="9" height="9" />
        <div class="toolbar">

          <!--<button class="clear-btn" @click="clearAll">clear all</button>-->
          <button class="neo-btn toolbar-btn rando-btn" @click="rotate90_clockwise"><span class="neo-btn__inner"><span :style="{ display: 'inline-block', transform: `rotate(${store.rotateFlip * 90}deg)` }">⤵</span></span></button>
          <button class="neo-btn toolbar-btn rando-btn" @click="xFlip"><span class="neo-btn__inner"><span :style="{ display: 'inline-block', transform: `scaleX(${ 1 + -2 * store.xFlip }) rotate(75deg)` }">🩴</span></span></button>
          <button class="neo-btn toolbar-btn rando-btn" @click="yFlip"><span class="neo-btn__inner"><span :style="{ display: 'inline-block', transform: `scaleY(${ 1 + -2 * store.yFlip }) rotate(-10deg)` }">🩴</span></span></button>
          <button class="neo-btn toolbar-btn invert-btn" @click="invert"><span class="neo-btn__inner"><span :style="{ display: 'inline-block', transform: `rotate(${ 180 * store.invertFlip }deg)` }">🌓</span></span></button>
          <button class="neo-btn toolbar-btn rando-btn" @click="randomize"><span class="neo-btn__inner">🎲</span></button>
          <button class="neo-btn toolbar-btn life-btn" @click="life"><span class="neo-btn__inner">🦠</span></button>
          <button class="neo-btn toolbar-btn cut-btn" @click="cut" :disabled="isChunkEmpty(getViewedChunk())"><span class="neo-btn__inner">✂️</span></button>
          <button class="neo-btn toolbar-btn clipboard-btn" @click="paste">
            <canvas ref="clipboardCanvas" width="9" height="9" :style="{ background: theme.hl }" class="neo-btn__inner"></canvas>
          </button>
        </div>
        <div class="navigator">
          <div class="tool-grid" :style="{ '--arrow-size': store.panJump ? '1.75em' : '0.9em' }">
            <button class="neo-btn bl arrow-btn arrow-btn--horizontal" @click="shiftPan(-1, 0)"><span class="neo-btn__inner">←</span></button>
            <button class="neo-btn b arrow-btn arrow-btn--vertical" @click="shiftPan(0, 1)"><span class="neo-btn__inner">↓</span></button>
            <button class="neo-btn t arrow-btn arrow-btn--vertical" @click="shiftPan(0, -1)"><span class="neo-btn__inner">↑</span></button>
            <button class="neo-btn br arrow-btn arrow-btn--horizontal" @click="shiftPan(1, 0)"><span class="neo-btn__inner">→</span></button>
            <label class="tr jump-ctrl">
              <input type="checkbox" name="panJump" v-model="store.panJump" />
              🦘
            </label>
            <label class="tl jump-ctrl">
              <input type="checkbox" name="draggin" v-model="store.draggin" />
              🐉
            </label>
          </div>
          <Spravigator :theme="theme"/>
          <button @click="openExportWindow" class="neo-btn export-button">📸</button>
        </div>
      </div>
    </div>
  </div>

</template>

<style>

.wrapper {
  max-width: 480px;
  margin: 0 auto;
  position: relative;
}

.toolbar {
  display: flex;
  flex-direction: row;
  justify-content: stretch;
  align-items: space-between;
  margin-top: 0.25rem;
  gap: 0.5rem;
  padding: 0 0.5rem 0.5rem;
}

.navigator {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding-right: 0.5rem;
  padding-bottom: 3rem;
  align-items: end;
}

.tool-grid {
  padding: 0 0.5rem;
  display: grid;
  grid-auto-rows: 48px;
  grid-template-columns: 48px 48px 48px;
  grid-template-areas: "tl t tr"
    "bl b br";
  min-height: 5em;
  position: relative;
  z-index: 1;
  gap: 0.5rem;
}

.tool-grid .t {
  grid-area: t;
}
.tool-grid .bl {
  grid-area: bl;
  position: relative;
  z-index: 2;
}
.tool-grid .b {
  grid-area: b;
  position: relative;
  z-index: 1;
}
.tool-grid .br {
  grid-area: br;
}
.tool-grid .tr {
  grid-area: tr;
}
.arrows .tl {
  grid-area: tl;
}
.jump-ctrl {
  display: flex;
  align-items: center;
}

.neo-btn {
  font-size: 1em;
  padding: 0;
  margin: 0;
  overflow: hidden;
  touch-action: manipulation;

  font-family: inherit;
  border: none;

  width: 48px;
  height: 48px;

  border-radius: 9px;
  border-radius: 9px;
  background: #eee;
  transition: .7s all ease-out;
  box-shadow: 5.63px -5.63px 10.03px #ffffffc2, 1.04px -1.04px 3.62px #ffffffb3, -45px 45px 80px #00000012, -13.57px 13.5662px 24.1177px #00000007, -5.63px 5.6347px 10.0172px #0000000c, -2.04px 2.03796px 2.62304px #0000000d, -1.04px 1.03796px 3px #0000000d, inset -1px 1px 3px #0000, inset 1px -1px 3px #fff0;

  display: flex;
  align-items: center;
  justify-content: center;
}

.neo-btn--auto {
  padding: 18px 16px;
  width: auto;
  height: auto;
}

.neo-btn:hover {
  transition-duration: 0.3s;
  background: #f3f3f3;
  box-shadow: 4px -4px 8px #ffffffc2,
    1.04px -1.04px 2.62px #ffffffb3,
    -7px 7px 20px #00000012,
    -10.57px 10.5662px 7px #00000007,
    -3.63px 3.6347px 2.0172px #0000000c,
    -1.04px 1.03796px 1.62304px #0000000d,
    -0.2px 0.2px 1px #0000000d,
    inset -1px 1px 3px #0000,
    inset 1px -1px 3px #fff0;
}
.neo-btn:active {
  transition-duration: 0s;
  background: #eaeaea;
  box-shadow: 0 0 #ffffffc2, 0 0 #ffffffb3, 0 0 #00000012, 0 0 #00000007, 0 0 #0000000c, 0 0 #0000000d, 0 0 #0000000d, inset -1px 1px 3px #0000001a, inset 1px -1px 3px #fff3;
}
.neo-btn__inner {
  display: inline-block;
  transition: .7s all ease-out;
  transform: scale(1);
}
.neo-btn:active .neo-btn__inner {
  transform: scale(.8);
  transition-duration: 0s;
}

.toolbar-btn {
}

.arrow-btn {
  flex: 1;
  color: #666;
  font-size: var(--arrow-size);
  font-weight: bold;

  line-height: 0;

  width: 100%;
  height: 100%;

}

.bl span, .br span {
  /*
     i hate this, but I can't figure out how
     to get the arrows aligned otherwise
  */
  margin-top: -0.25em;
}

.cut-btn {
  margin-left: auto;
  margin-right: 0;
  z-index: 1;
}

.life-btn img {
  image-rendering: pixelated;
  width: 36px;
  height: 36px;
}

.toolbar button:disabled {
  opacity: 0.2;
}

.toolbar canvas {
  display: block;
  image-rendering: pixelated;
  width: 36px;
  height: 36px;
}

.status-bar {
  padding: 0.5rem;
  font-family: monospace;
  font-size: 0.7rem;
  display: flex;
  justify-content: space-between;
}
.indicator {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
}
.indicator.positive {
  background: green;
}
.indicator.warning {
  background: #ffc800;;
}
.status-text {
  opacity: 0.5;
}

.export-window {
  box-sizing: border-box;
  position: absolute;
  background: white;
  padding: 2rem 3rem;
  z-index: 3;
  width: 95%;
  left: 2.5%;
  top: 2.5%;
  border-radius: 12px;
  box-shadow: 10px 10px 40px rgba(0,0,0,0.1),
    5px 5px 20px rgba(0,0,0,0.3);
}
.export-canvas {
  box-sizing: border-box;
  image-rendering: pixelated;
  max-width: 100%;
}

.export-window__canvas-wrapper {
  aspect-ratio: 5/4;
  display: flex;
  justify-content: center;
  align-items: center;
  background-image:
    linear-gradient(45deg, #ccc 25%, transparent 25%), 
    linear-gradient(135deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(135deg, #eee 75%, #ccc 75%);
  background-size:25px 25px; /* Must be a square */
  background-position:0 0, 12.5px 0, 12.5px -12.5px, 0px 12.5px; /* Must be half of one side of the square */
    margin-bottom: 1rem;

}

.dialog-window {
  display: flex;
  flex-direction: column;
  font-family: monospace;
}

.dialog-window__close-button {
  align-self: end;
  border: none;
  background: transparent;
  font-size: 2.5rem;
  margin-bottom: 2rem;
}

.dialog-window__actions {
  margin-top: auto;
}

.dialog-window__actions button {
  margin-top: 2em;
    margin-left: auto;
}

.export-button {
  grid-column: 2;
  justify-self: end;
  margin-top: 0.25em;
}

.radio-button-group {
  display: grid;
  grid-template-columns: 6rem auto;
  border: none;
  padding: 0;
  margin: 0 0 1rem;
}

.radio-button-group h2 {
  margin: 0.4rem 0;
}

.radio-button-group input[type="radio"] {
  margin: 0 0.25rem 0 0.5rem;
}
.radio-button-group h2 {
  font-size: inherit;
  font-weight: normal;
}
.radio-button-group > .flex {
  display: flex;
  gap: 0.05rem;
}

.radio-button-group label {
  display: flex;
  align-items: center;
  padding: 0.5em 0;
}
</style>
