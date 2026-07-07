const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTML Interface එක
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp Session ID Generator</title>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f4f4f9; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 100%; }
                input { width: 90%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 5px; font-size: 16px; }
                button { background-color: #25D366; color: white; border: none; padding: 10px 20px; font-size: 16px; border-radius: 5px; cursor: pointer; width: 95%; }
                button:hover { background-color: #128C7E; }
                #result { margin-top: 20px; font-weight: bold; word-break: break-all; background: #eee; padding: 10px; border-radius: 5px; display: none; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>WhatsApp Bot Session Generator</h2>
                <p>Enter your phone number with country code (e.g., 9477xxxxxxx)</p>
                <form action="/pair" method="POST">
                    <input type="text" name="phone" placeholder="94771234567" required>
                    <button type="submit">Get Pairing Code</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// Pairing Code Generator Route
app.post('/pair', async (req, res) => {
    let phone = req.body.phone.replace(/[^0-9]/g, '');

    if (!phone) {
        return res.status(400).send("Invalid Phone Number");
    }

    // Temporary session folder එකක් හදනවා auth එකට
    const sessionDir = path.join(__dirname, `./auth_${phone}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    try {
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' })
        });

        if (!sock.authState.creds.registered) {
            await delay(1500); // පොඩි delay එකක් pairing code එක request කරන්න කලින්
            const code = await sock.requestPairingCode(phone);
            
            // User ට pairing code එක display කරනවා
            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Your Pairing Code</title>
                    <style>
                        body { font-family: Arial, sans-serif; background-color: #f4f4f9; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                        .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); text-align: center; }
                        .code { font-size: 32px; font-weight: bold; color: #25D366; letter-spacing: 5px; margin: 20px 0; background: #e3fcef; padding: 10px; border-radius: 5px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h2>Your WhatsApp Pairing Code</h2>
                        <div class="code">${code}</div>
                        <p>Copy this code and enter it on your WhatsApp (Linked Devices -> Link with phone number).</p>
                        <p>Once linked, check your terminal/hosting log or wait for the session data.</p>
                    </div>
                </body>
                </html>
            `);
        }

        // Connection එක update වෙන එක බලාගන්න
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                await delay(5000);
                
                // creds.json එක කියවලා Base64 string එකක් හදනවා (මේක තමයි Session ID එක වෙන්නේ)
                const credsFile = fs.readFileSync(path.join(sessionDir, 'creds.json'));
                const sessionID = Buffer.from(credsFile).toString('base64');

                // Bot owner ගේ නම්බර් එකටම Session ID එක WhatsApp message එකක් විදිහට යවනවා
                await sock.sendMessage(sock.user.id, { text: `YOUR_SESSION_ID:\n\n${sessionID}` });

                console.log(`[SUCCESS] Session Generated successfully for ${phone}`);
                
                // Temporary folder එක අයින් කරනවා security එකට
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (!shouldReconnect) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

    } catch (err) {
        console.error(err);
        res.status(500).send("Error generating pairing code.");
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
