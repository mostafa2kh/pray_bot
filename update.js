import fs from "fs";

const city = "Qalyubia";
const country = "Egypt";

const url = `https://api.aladhan.com/v1/timingsByCity?city=${city}&country=${country}&method=5`;

async function update() {
  const res = await fetch(url); // native fetch (NO PACKAGE NEEDED)
  const data = await res.json();

  const t = data.data.timings;

  const prayerTimes = {
    Fajr: t.Fajr,
    Dhuhr: t.Dhuhr,
    Asr: t.Asr,
    Maghrib: t.Maghrib,
    Isha: t.Isha
  };

  fs.writeFileSync("prayer.json", JSON.stringify(prayerTimes, null, 2));

  console.log("Updated:", prayerTimes);
}

update();
