const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_GROUP_ID;

if (!token || !chatId) throw new Error("Missing env vars");

const baseURL = `https://api.telegram.org/bot${token}`;

// -----------------------------
// 📦 LOAD PERSISTENT POLLS
// -----------------------------
let polls = fs.existsSync("polls.json")
    ? JSON.parse(fs.readFileSync("polls.json"))
    : [];

function savePolls() {
    fs.writeFileSync("polls.json", JSON.stringify(polls, null, 2));
}

// -----------------------------
// 📡 TELEGRAM HELPERS
// -----------------------------
async function sendMessage(text) {
    await axios.post(`${baseURL}/sendMessage`, {
        chat_id: chatId,
        text,
    });
}

async function sendPoll(name) {
    const res = await axios.post(`${baseURL}/sendPoll`, {
        chat_id: chatId,
        question: `Did you pray ${name}?`,
        options: ["Yes", "No"],
        is_anonymous: false,
    });

    polls.push({
        name,
        message_id: res.data.result.message_id,
    });

    savePolls();
}

// -----------------------------
// 🕌 PRAYER TIMES (STATIC FOR GITHUB)
// -----------------------------
const prayers = {
    Fajr: "05:10",
    Dhuhr: "12:05",
    Asr: "15:30",
    Maghrib: "18:10",
    Isha: "19:30",
};

// -----------------------------
// ⏰ SCHEDULER
// -----------------------------
function schedulePrayer(name, time) {
    const [h, m] = time.split(":");

    // 🔔 10 min before
    let before = (parseInt(h) * 60 + parseInt(m)) - 10;
    let bh = Math.floor(before / 60);
    let bm = before % 60;

    cron.schedule(`${bm} ${bh} * * *`, async () => {
        await sendMessage(`⏰ ${name} in 10 minutes`);
    }, { timezone: "Africa/Cairo" });

    // 🕌 prayer time
    cron.schedule(`${m} ${h} * * *`, async () => {
        await sendMessage(`🕌 ${name} prayer time`);
        await sendPoll(name);
    }, { timezone: "Africa/Cairo" });
}

// -----------------------------
// 📊 MIDNIGHT REPORT
// -----------------------------
cron.schedule("0 0 * * *", async () => {
    let text = "📊 Daily Prayer Results\n\n";

    for (let p of polls) {
        try {
            const res = await axios.post(`${baseURL}/stopPoll`, {
                chat_id: chatId,
                message_id: p.message_id,
            });

            const options = res.data.result.options;

            const yes = options[0]?.voter_count || 0;
            const no = options[1]?.voter_count || 0;

            text += `🕌 ${p.name}\n`;
            text += `✅ Yes: ${yes}\n`;
            text += `❌ No: ${no}\n\n`;
        } catch (err) {
            text += `🕌 ${p.name}\n❌ Error getting results\n\n`;
        }
    }

    await sendMessage(text);

    // RESET
    polls = [];
    savePolls();

}, { timezone: "Africa/Cairo" });

// -----------------------------
// 🚀 START SCHEDULING
// -----------------------------
for (let p in prayers) {
    schedulePrayer(p, prayers[p]);
}

console.log("🕌 Bot running...");
