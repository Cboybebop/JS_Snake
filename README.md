# Neon Snake Arena
![Neon Snake Arena](snake.png)

A modern, responsive Snake game built with vanilla HTML/CSS/JS, featuring:

- Traditional single-player mode
- Versus mode (human vs human, human vs CPU, or mixed) with up to 4 players
- Power-ups (speed burst, x2 points, shield, freeze rivals, phase walk)
- Local highscores (always available)
- Online highscores via Supabase (optional)
- Keyboard, touch, and controller support
- Widescreen desktop support + mobile-friendly layout
- Netlify-ready static hosting

## Project Structure

- `index.html` - app shell + UI
- `styles.css` - responsive modern styling
- `config.js` - generated runtime config for public Supabase settings
- `scripts/generate-config.js` - Netlify/local build helper that writes `config.js`
- `src/app.js` - game engine + UI + highscore services
- `netlify.toml` - Netlify configuration

## Quick Start

This is a static site. You can run it with any local static server.

Example with Node:

```bash
npx serve .
```

Then open the local URL printed by your server.

## Controls

### Keyboard

- Player 1: Arrow keys
- Player 2: `W A S D`
- Player 3: `I J K L`
- Player 4: `T F G H`
- Pause / Resume: `Space` or `P`

### Touch (mobile)

- Use the on-screen direction pad under the board.

### Controller (Gamepad API)

- Supports up to 4 connected controllers
- Uses D-pad or left stick per assigned human player slot

## Modes

### Traditional

- Classic single-player Snake.

### Versus

- 2 to 4 players
- Set number of CPU opponents (always keeps at least 1 human slot)

## Power-Ups

- `Speed Burst` - temporary movement speed increase
- `x2 Points` - doubles points for food and power-up bonuses while active
- `Shield` - blocks one lethal collision
- `Freeze Rivals` - temporarily slows other living snakes
- `Phase Walk` - pass through walls/body collisions temporarily

## Highscores

### Local Highscores

Saved automatically in browser `localStorage` by mode (`classic` / `versus`).

### Online Highscores (Supabase)

1. Create a Supabase project.
2. Create a table (default expected name: `snake_highscores`).
3. Either paste your project URL and anon key into the in-game Supabase panel, or set them as Netlify environment variables for the deployment.
4. Save settings if you are using the in-app panel.

Suggested SQL:

```sql
create table if not exists public.snake_highscores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  score integer not null,
  mode text not null check (mode in ('classic', 'versus')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.snake_highscores enable row level security;

create policy "Public read highscores"
on public.snake_highscores
for select
using (true);

create policy "Public insert highscores"
on public.snake_highscores
for insert
with check (true);
```

## Netlify Deployment

This repo is static and includes `netlify.toml`.

Deploy options:

1. Connect repo to Netlify and deploy directly.
2. Or drag-and-drop this folder in Netlify Deploys.

The included Netlify build command writes `config.js` from environment variables before publish. That managed setup applies when Netlify is building the repo; drag-and-drop deploys use whatever `config.js` is already in the folder.

Recommended Netlify environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_HIGHSCORES_TABLE` (optional, defaults to `snake_highscores`)

When `SUPABASE_URL` and `SUPABASE_ANON_KEY` are both present, the app treats Supabase as deployment-managed and does not render the in-app Supabase editor at all.

## Configuration

`config.js` can define default Supabase values:

```js
window.SNAKE_CONFIG = {
  supabaseManaged: false,
  supabaseUrl: "",
  supabaseAnonKey: "",
  highscoresTable: "snake_highscores"
};
```

On Netlify, `scripts/generate-config.js` overwrites `config.js` during the build using public environment variables. The in-app Supabase form only exists when deployment-managed config is not active, and that editable mode still saves values to browser local storage.

## Notes

- Online score save/load requires network access from the browser and valid Supabase RLS policies.
- If Supabase is not configured, the game still works fully with local highscores.