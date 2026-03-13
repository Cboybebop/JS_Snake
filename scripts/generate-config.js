const fs = require("node:fs");
const path = require("node:path");

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

const supabaseUrl = readEnv("SUPABASE_URL", "PUBLIC_SUPABASE_URL", "NETLIFY_SUPABASE_URL");
const supabaseAnonKey = readEnv(
  "SUPABASE_ANON_KEY",
  "PUBLIC_SUPABASE_ANON_KEY",
  "NETLIFY_SUPABASE_ANON_KEY"
);
const highscoresTable =
  readEnv("SUPABASE_HIGHSCORES_TABLE", "SUPABASE_TABLE", "NETLIFY_SUPABASE_TABLE") ||
  "snake_highscores";
const supabaseManaged = Boolean(supabaseUrl && supabaseAnonKey);

if ((supabaseUrl && !supabaseAnonKey) || (!supabaseUrl && supabaseAnonKey)) {
  console.warn(
    "Supabase config is incomplete. Set both SUPABASE_URL and SUPABASE_ANON_KEY to enable managed highscores."
  );
}

const output = `window.SNAKE_CONFIG = window.SNAKE_CONFIG || ${JSON.stringify(
  {
    supabaseManaged,
    supabaseUrl,
    supabaseAnonKey,
    highscoresTable
  },
  null,
  2
)};\n`;

const outputPath = path.resolve(__dirname, "..", "config.js");
fs.writeFileSync(outputPath, output);

console.log(
  `Wrote ${path.basename(outputPath)} with ${supabaseManaged ? "managed" : "editable"} Supabase config.`
);