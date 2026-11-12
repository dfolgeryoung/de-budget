/** Default emoji per category, the same keyword map the spreadsheet builder used. Editable per category in Settings. */
const EMOJI: [string, string][] = [
  ["next month", "📅"], ["capitalone", "💳"], ["secu credit", "💳"], ["mortgage", "🏠"], ["phone", "📱"], ["utilities", "💡"],
  ["car insurance", "🚗"], ["pest", "🐜"], ["ymca", "🏊"], ["netflix", "📺"], ["spotify", "🎵"], ["times", "📰"], ["icloud", "☁️"],
  ["groceries", "🛒"], ["target", "📦"], ["gas", "⛽"], ["cleaners", "🧹"], ["cat", "🐱"], ["unexpected", "❗"], ["clothes", "👕"],
  ["sports", "⚽"], ["babysit", "👶"], ["camp", "🏕️"], ["garden", "🌻"], ["entertainment", "🎬"], ["eating", "🍽️"], ["wine", "🍷"],
  ["david fun", "🎉"], ["elizabeth fun", "🎊"], ["emergency", "🚨"], ["retirement", "🏦"], ["529", "🎓"], ["taxes", "🧾"],
  ["big trips", "✈️"], ["small trips", "🚙"], ["student", "📚"], ["car loan", "🚘"], ["home maint", "🔧"], ["car maint", "🛠️"],
  ["medical", "🩺"], ["life insurance", "🛡️"], ["gifts", "🎁"], ["donations", "💝"], ["christmas", "🎄"], ["money market", "💰"],
];
export function defaultEmoji(name: string): string {
  const n = name.toLowerCase();
  return EMOJI.find(([k]) => n.includes(k))?.[1] ?? "🔹";
}
