const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const express = require('express')
const fs = require('fs')

// 1. CONFIG & STATE
const config = JSON.parse(fs.readFileSync('config.json'));
let randomMessages = [];
try {
    randomMessages = JSON.parse(fs.readFileSync('messages.json'));
} catch (e) {
    randomMessages = ["Default message!"];
}

const webPort = process.env.PORT || 3000;
let bot, reconnectTimer = 0, status = "OFFLINE", reconnectInterval, msgTimeout;
let logs = [];

function addLog(msg) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    logs.push(`[${time}] ${msg}`);
    if (logs.length > 10) logs.shift();
}

// Function to handle random messaging
function startRandomMessages() {
    if (msgTimeout) clearTimeout(msgTimeout);
    
    // Choose a random time between 5 and 10 minutes (300000ms - 600000ms)
    const nextMsgTime = Math.floor(Math.random() * (600000 - 300000 + 1) + 300000);
    
    msgTimeout = setTimeout(() => {
        if (status === "ONLINE" && bot?.entity) {
            const randomMsg = randomMessages[Math.floor(Math.random() * randomMessages.length)];
            bot.chat(randomMsg);
            addLog(`Sent Random: ${randomMsg}`);
        }
        startRandomMessages(); // Schedule next
    }, nextMsgTime);
}

function createBot() {
    if (bot) {
        bot.removeAllListeners();
        try { bot.end(); } catch (e) {}
    }
    if (msgTimeout) clearTimeout(msgTimeout);

    status = "CONNECTING...";
    addLog("Connecting...");

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
        addLog("Bot Spawned!");
        
        const mcData = require('minecraft-data')(bot.version);
        bot.pathfinder.setMovements(new Movements(bot, mcData));
        
        startRandomMessages(); // Start the chat loop
    });

    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        addLog(`${username}: ${message}`);
        // ... (existing follow/guard commands)
    });

    bot.on('error', (err) => {
        addLog(`Error: ${err.message}`);
        if (err.code === 'ETIMEDOUT') status = "TIMEOUT";
    });

    bot.on('end', () => {
        status = (status === "TIMEOUT") ? "TIMEOUT" : "OFFLINE";
        addLog("Disconnected. Retrying in 23s...");
        reconnectTimer = 23;
        clearInterval(reconnectInterval);
        reconnectInterval = setInterval(() => {
            reconnectTimer--;
            if (reconnectTimer <= 0) {
                clearInterval(reconnectInterval);
                createBot();
            }
        }, 1000);
    });
}

// 2. EXPRESS DASHBOARD (Logic remains the same as previous)
const app = express();
app.use(express.json());
app.get('/h', (req, res) => res.json({ s: status, t: reconnectTimer, p: bot?.entity?.position || null, l: logs }));
app.post('/c', (req, res) => {
    if (bot?.entity) bot.chat(req.body.m);
    res.sendStatus(200);
});
app.get('/', (req, res) => res.send(`
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    body { background: #111; color: #eee; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; padding: 20px; }
    .card { background: #222; padding: 20px; border-radius: 12px; width: 350px; border: 1px solid #333; }
    #st { color: #2dd4bf; font-weight: bold; }
    #log { background: #000; padding: 10px; border-radius: 5px; height: 120px; overflow-y: auto; text-align: left; font-size: 12px; margin: 10px 0; border: 1px solid #444; color: #aaa; }
    input { width: calc(100% - 22px); padding: 10px; margin-bottom: 10px; background: #000; border: 1px solid #444; color: #fff; border-radius: 5px; }
    button { background: #2dd4bf; border: none; padding: 12px; border-radius: 5px; cursor: pointer; font-weight: bold; width: 100%; margin-top: 5px; }
</style></head><body>
    <div class="card">
        <h2 style="margin:0">${config.name}</h2>
        <p>Status: <span id="st">...</span> | Pos: <span id="lc">0,0,0</span></p>
        <div id="log"></div>
        <input id="i" placeholder="Message..." onkeypress="if(event.key==='Enter')send()">
        <button onclick="send()">SEND</button>
    </div>
    <script>
        async function send() {
            const i = document.getElementById('i');
            if(!i.value) return;
            await fetch('/c', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({m:i.value})});
            i.value = '';
        }
        setInterval(async () => {
            const r = await fetch('/h').then(res => res.json());
            document.getElementById('st').innerText = (r.s.includes('OFFLINE') || r.s === 'TIMEOUT') ? r.s + ' (' + r.t + 's)' : r.s;
            if(r.p) document.getElementById('lc').innerText = Math.floor(r.p.x) + ',' + Math.floor(r.p.y) + ',' + Math.floor(r.p.z);
            document.getElementById('log').innerHTML = r.l.join('<br>');
        }, 1000);
    </script>
</body></html>`));

app.listen(webPort, () => {
    console.log(`Web Dashboard: http://localhost:${webPort}`);
    createBot();
});
