const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const express = require('express')
const fs = require('fs')

// 1. CONFIG & STATE
const config = JSON.parse(fs.readFileSync('config.json'));
let randomMessages = [];
try { randomMessages = JSON.parse(fs.readFileSync('messages.json')); } catch (e) { randomMessages = ["Hello!"]; }

const webPort = process.env.PORT || 3000;
let bot, reconnectTimer = 0, status = "OFFLINE", reconnectInterval, msgTimeout;
let logs = [];
let lastMessageTime = 0; // Track the last time a message was sent

function addLog(msg) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    logs.push(`[${time}] ${msg}`);
    if (logs.length > 10) logs.shift();
}

// Logic to send chat with a 60s safety check
function safeChat(message) {
    const now = Date.now();
    const waitTime = 60000 - (now - lastMessageTime);

    if (waitTime > 0) {
        addLog(`Wait ${Math.ceil(waitTime / 1000)}s to chat.`);
        return false;
    }

    bot.chat(message);
    lastMessageTime = Date.now();
    return true;
}

function startRandomMessages() {
    if (msgTimeout) clearTimeout(msgTimeout);
    
    // Choose a random time between 60 and 120 seconds
    const nextMsgTime = Math.floor(Math.random() * (120000 - 60000 + 1) + 60000);
    
    msgTimeout = setTimeout(() => {
        if (status === "ONLINE" && bot?.entity) {
            const randomMsg = randomMessages[Math.floor(Math.random() * randomMessages.length)];
            const sent = safeChat(randomMsg);
            if (sent) addLog(`Random Msg: ${randomMsg}`);
        }
        startRandomMessages(); 
    }, nextMsgTime);
}

function createBot() {
    if (bot) { bot.removeAllListeners(); try { bot.end(); } catch (e) {} }
    if (msgTimeout) clearTimeout(msgTimeout);

    status = "CONNECTING...";
    bot = mineflayer.createBot({
        host: config.ip,
        port: parseInt(config.port),
        username: config.name,
        version: config.version || false,
        viewDistance: "tiny"
    });

    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvp);

    bot.on('spawn', () => {
        status = "ONLINE";
        reconnectTimer = 0;
        clearInterval(reconnectInterval);
        addLog("Bot Online.");
        const mcData = require('minecraft-data')(bot.version);
        bot.pathfinder.setMovements(new Movements(bot, mcData));
        startRandomMessages(); 
    });

    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        addLog(`${username}: ${message}`);
    });

    bot.on('error', (err) => {
        addLog(`Error: ${err.message}`);
        if (err.code === 'ETIMEDOUT') status = "TIMEOUT";
    });

    bot.on('end', () => {
        status = (status === "TIMEOUT") ? "TIMEOUT" : "OFFLINE";
        addLog("Disconnected. Rejoin in 23s.");
        reconnectTimer = 23;
        clearInterval(reconnectInterval);
        reconnectInterval = setInterval(() => {
            reconnectTimer--;
            if (reconnectTimer <= 0) { clearInterval(reconnectInterval); createBot(); }
        }, 1000);
    });
}

const app = express();
app.use(express.json());
app.get('/h', (req, res) => res.json({ s: status, t: reconnectTimer, p: bot?.entity?.position || null, l: logs }));

app.post('/c', (req, res) => {
    if (bot?.entity) {
        const sent = safeChat(req.body.m);
        if (!sent) return res.status(429).send("Cooldown active");
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send(`
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    body { background: #111; color: #eee; font-family: sans-serif; display: flex; justify-content: center; padding: 20px; }
    .card { background: #222; padding: 20px; border-radius: 12px; width: 350px; border: 1px solid #333; }
    #st { color: #2dd4bf; font-weight: bold; }
    #log { background: #000; padding: 10px; border-radius: 5px; height: 120px; overflow-y: auto; text-align: left; font-size: 12px; margin: 10px 0; border: 1px solid #444; color: #aaa; }
    input { width: calc(100% - 22px); padding: 10px; margin-bottom: 10px; background: #000; border: 1px solid #444; color: #fff; border-radius: 5px; }
    button { background: #2dd4bf; border: none; padding: 12px; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; }
</style></head><body>
    <div class="card">
        <h2 style="margin:0">${config.name}</h2>
        <p>Status: <span id="st">...</span></p>
        <div id="log"></div>
        <input id="i" placeholder="Message..." onkeypress="if(event.key==='Enter')send()">
        <button onclick="send()">SEND (60s CD)</button>
    </div>
    <script>
        async function send() {
            const i = document.getElementById('i');
            if(!i.value) return;
            const res = await fetch('/c', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({m:i.value})});
            if (res.status === 429) alert("Please wait 60 seconds between messages!");
            i.value = '';
        }
        setInterval(async () => {
            const r = await fetch('/h').then(res => res.json());
            document.getElementById('st').innerText = (r.s.includes('OFFLINE') || r.s === 'TIMEOUT') ? r.s + ' (' + r.t + 's)' : r.s;
            document.getElementById('log').innerHTML = r.l.join('<br>');
        }, 1000);
    </script>
</body></html>`));

app.listen(webPort, () => createBot());
