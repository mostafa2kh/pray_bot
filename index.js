const axios = require("axios");
const fs = require("fs");

const token = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TELEGRAM_GROUP_ID;

if (!token) throw new Error("Missing token");

// -----------------------------
// 📊 STATE
// -----------------------------
const defaultResults = {
    Fajr: { Yes: 0, Mosque: 0, Later: 0 },
    Dhuhr: { Yes: 0, Mosque: 0, Later: 0 },
    Asr: { Yes: 0, Mosque: 0, Later: 0 },
    Maghrib: { Yes: 0, Mosque: 0, Later: 0 },
    Isha: { Yes: 0, Mosque: 0, Later: 0 },
};

let pollResults = fs.existsSync("state.json")
    ? JSON.parse(fs.readFileSync("state.json"))
    : defaultResults;

function save() {
    fs.writeFileSync("state.json", JSON.stringify(pollResults, null, 2));
}

// -----------------------------
// 📡 SIMPLE TELEGRAM SEND (NO POLLING)
// -----------------------------
async function sendMessage(text) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: GROUP_ID,
            text,
        }),
    });
}

// -----------------------------
// 🕌 PRAYER TIMES
// -----------------------------
async function getPrayers() {
    const res = await axios.get(
        "https://api.aladhan.com/v1/timingsByCity?city=Cairo&country=Egypt&method=5"
    );
    return res.data.data.timings;
}

// -----------------------------
// 📊 DAILY REPORT
// -----------------------------
async function run() {
    const t = await getPrayers();

    let text = "🕌 Prayer Bot Running (GitHub Job)\n\n";

    text += `Fajr: ${t.Fajr}\n`;
    text += `Dhuhr: ${t.Dhuhr}\n`;
    text += `Asr: ${t.Asr}\n`;
    text += `Maghrib: ${t.Maghrib}\n`;
    text += `Isha: ${t.Isha}\n\n`;

    text += "📊 Current Stored Results:\n\n";

    for (let p in pollResults) {
        const r = pollResults[p];
        text += `🕌 ${p} → ✅${r.Yes} 🕌${r.Mosque} ⏳${r.Later}\n`;
    }

    await sendMessage(text);

    console.log("Done");
}

run();
