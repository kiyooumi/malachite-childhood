const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Хранилище облаков в памяти: code -> { question, words: Map(word -> count) }
const clouds = new Map();

function generateCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (clouds.has(code));
  return code;
}

function serializeWords(cloud) {
  return Array.from(cloud.words.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);
}

app.get('/guest', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'guest.html'));
});

io.on('connection', (socket) => {
  console.log('Подключение:', socket.id);

  // Ведущий создаёт облако
  socket.on('createCloud', (question) => {
    const q = (question || '').toString().trim() || 'Без вопроса';
    const code = generateCode();
    clouds.set(code, { question: q, words: new Map() });

    socket.join('room:' + code);
    socket.data.role = 'host';
    socket.data.code = code;

    console.log(`Создано облако ${code}: "${q}"`);
    socket.emit('cloudCreated', { code, question: q });
  });

  // Гость отправляет слово
  socket.on('submitWord', (payload) => {
    const code = (payload && payload.code ? String(payload.code) : '').trim();
    const rawWord = (payload && payload.word ? String(payload.word) : '').trim();

    if (!code || !rawWord) return;

    const cloud = clouds.get(code);
    if (!cloud) {
      socket.emit('errorMessage', { message: 'Комната не найдена' });
      return;
    }

    // Нормализация: одно слово, до 30 символов
    const word = rawWord.split(/\s+/)[0].slice(0, 30);
    if (!word) return;

    const key = word.toLowerCase();
    // сохраняем "канонический" вариант первого написания
    let storedKey = null;
    for (const k of cloud.words.keys()) {
      if (k.toLowerCase() === key) { storedKey = k; break; }
    }
    const finalKey = storedKey || word;
    const prev = cloud.words.get(finalKey) || 0;
    cloud.words.set(finalKey, prev + 1);

    socket.emit('wordAccepted', { word: finalKey });

    io.emit('cloudUpdate', {
      code,
      words: serializeWords(cloud)
    });
  });

  socket.on('disconnect', () => {
    console.log('Отключение:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
