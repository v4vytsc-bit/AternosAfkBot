const mineflayer = require('mineflayer')
const pvp = require('mineflayer-pvp').plugin
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalFollow } = goals
const armorManager = require('mineflayer-armor-manager')
const cmd = require('mineflayer-cmd').plugin
const express = require('express')
const fs = require('fs');
const bodyParser = require('body-parser');

// 1. CONFIG LOAD
let config = JSON.parse(fs.readFileSync('config.json'));
const host = config["ip"];
const username = config["name"];
const webPort = process.env.PORT || 3000;

let death = 0, pvpc = 0;
let bot;
let reconnectTimer = 0; 
let reconnectInterval;
let statusState = "OFFLINE"; // Track detailed status
const startTime = Date.now();

function createBotInstance() {
    // Force clear everything first
    if (reconnectInterval) clearInterval(reconnectInterval);
    reconnectTimer = 0;
    statusState = "CONNECTING...";

    if (bot) {
        console.log("Cleaning up old bot instance...");
        bot.removeAllListeners();
        try { bot.end(); } catch (e) {}
        bot = null;
    }

    // Small delay to ensure the socket is closed before re-opening
    setTimeout(() => {
        console.log(`[${new Date().toLocaleTimeString()}] Rejoining ${host}...`);
        
        bot = mineflayer.createBot({
            host: host,
            port: config["port"],
            username: username,
            version: config["version"] || false,
            viewDistance: "tiny",
            connectTimeout: 30000
        });

        bot.loadPlugin(cmd);
        bot.loadPlugin(pvp);
        bot.loadPlugin(armorManager);
        bot.loadPlugin(pathfinder);

        bot.on('spawn', () => {
            statusState = "ONLINE";
            reconnectTimer = 0; 
            const mcData = require('minecraft-data')(bot.version);
            bot.pathfinder.setMovements(new Movements(bot, mcData));
            console.log("Bot joined successfully!");
        });

        bot.on('error', (err) => {
            console.log(`Connection Error: ${err.message}`);
            statusState = "ERROR";
        });

        bot.on('end', (reason) => {
            console.log(`Connection ended: ${reason}`);
            statusState = "OFFLINE";
            if (reconnectTimer <= 0) startReconnectCountdown();
        });
    }, 500); 
}

function startReconnectCountdown() {
    if (reconnectInterval) clearInterval(reconnectInterval);
    reconnectTimer = 23;
    reconnectInterval = setInterval(() => {
        reconnectTimer--;
        if (reconnectTimer <= 0) {
            clearInterval(reconnectInterval);
            createBotInstance();
        }
    }, 1000);
}

// 2. WEB SERVER
const app = express();
app.use(bodyParser.json());

app.get('/health', (req, res) => {
    res.json({
        status: (bot && bot.entity) ? 'connected' : statusState.toLowerCase(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        coords: (bot && bot.entity) ? bot.entity.position : null,
        reconnectIn: reconnectTimer,
        stats: { fights: pvpc, deaths: death }
    });
});

app.post('/restart', (req, res) => {
    console.log("Manual rejoin triggered.");
    createBotInstance();
    res.json({ success: true });
});

app.post('/send-chat', (req, res) => {
    if (bot && bot.entity) {
        bot.chat(req.body.message);
        return res.json({ success: true });
    }
    res.status(400).json({ success: false });
});

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Control Panel</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .container { background: #1e293b; padding: 25px; border-radius: 15px; box-shadow: 0 0 30px rgba(45, 212, 191, 0.2); width: 380px; border: 1px solid #334155; }
            .stat-card { background: #0f172a; padding: 10px; border-radius: 8px; border-left: 3px solid #2dd4bf; margin-bottom: 10px; }
            .label { font-size: 9px; color: #94a3b8; text-transform: uppercase; }
            .value { font-size: 14px; font-weight: bold; color: #2dd4bf; }
            input { background: #0f172a; border: 1px solid #334155; color: white; padding: 12px; width: calc(100% - 26px); border-radius: 6px; margin: 10px 0; }
            .btn { background: #2dd4bf; color: #0f172a; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold; cursor: pointer; }
            .btn-rejoin { background: #334155; color: white; margin-top: 8px; }
            .pulse { height: 10px; width: 10px; border-radius: 50%; display: inline-block; background: #4ade80; margin-right: 8px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h3 style="text-align:center"><span class="pulse" id="dot"></span> ${username}</h3>
            <div class="stat-card"><div class="label">Status</div><div id="stat" class="value">INITIALIZING...</div></div>
            <div class="stat-card"><div class="label">Location</div><div id="loc" class="value">---</div></div>
            <input type="text" id="chatInput" placeholder="Type message..." onkeydown="if(event.key==='Enter') sendChat()">
            <button class="btn" onclick="sendChat()">SEND TO SERVER</button>
            <button class="btn btn-rejoin" id="rejoinBtn" onclick="restartBot()">FORCE REJOIN</button>
        </div>
        <script>
            async function restartBot() {
                const btn = document.getElementById('rejoinBtn');
                btn.innerText = "CONNECTING...";
                await fetch('/restart', { method: 'POST' });
            }
            async function sendChat() {
                const input = document.getElementById('chatInput');
                await fetch('/send-chat', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ message: input.value })
                });
                input.value = '';
            }
            async function update() {
                try {
                    const r = await fetch('/health');
                    const d = await r.json();
                    const statEl = document.getElementById('stat');
                    const dotEl = document.getElementById('dot');
                    if (d.status === 'connected') {
                        statEl.innerText = 'ONLINE';
                        dotEl.style.background = '#4ade80';
                        document.getElementById('rejoinBtn').innerText = "FORCE REJOIN";
                    } else if (d.status === 'connecting...') {
                        statEl.innerText = 'CONNECTING...';
                        dotEl.style.background = '#fbbf24';
                    } else {
                        statEl.innerText = 'OFFLINE (RETRY: ' + d.reconnectIn + 's)';
                        dotEl.style.background = '#f87171';
                    }
                    if(d.coords) document.getElementById('loc').innerText = Math.floor(d.coords.x) + 'x, ' + Math.floor(d.coords.y) + 'y, ' + Math.floor(d.coords.z) + 'z';
                } catch(e) {}
            }
            setInterval(update, 1000);
        </script>
    </body>
    </html>
    `);
});

app.listen(webPort, () => {
    console.log("Server active.");
    createBotInstance();
});
