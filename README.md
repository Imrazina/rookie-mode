# Rookie

Sports, translated.

Rookie listens to the sports commentary you are already hearing and explains unfamiliar sports language at the moment it is said.

## Why Rookie

Sports broadcasts often assume viewers already understand jargon, race terminology, strategy language, and rules. That creates a barrier for new fans. Rookie translates broadcast language in real time so viewers can follow the action without leaving it.

## How it works

System audio → Azure Speech → sports term detection → instant glossary explanation → contextual AI explanation

## Features

- Real-time broadcast terminology explanations
- A newcomer-friendly Rookie Brief before a race
- Race alerts when you are not actively watching
- Followed-driver position, pit-stop, and penalty alerts
- Contextual Formula 1 statistics
- A real-audio TRY DEMO flow

## Demo

TRY DEMO opens a prepared sports clip, but Rookie still listens to the real system audio and sends that audio through the production speech-recognition and explanation pipeline. It is not a simulated transcript.

The demo URL is supplied through `DEMO_VIDEO_URL`. Public source distributions intentionally do not contain the private judge URL or credentials.

## Tech

Electron, React, TypeScript, Azure Speech, Microsoft Foundry with gpt-4.1-mini, OpenF1, and Jolpica.

## Platforms

- macOS: implemented and tested during development.
- Windows: support implemented; runtime verification pending.

## Privacy

Rookie processes captured system audio in memory for speech recognition and does not intentionally save captured audio to disk. The required display video track is discarded and is not rendered or recorded.

## Development

Requirements: Node.js and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

Fill `.env` with your own development configuration. `OPENF1_ACCESS_TOKEN` is optional when the unauthenticated OpenF1 API is sufficient.

Useful commands:

```bash
npm run typecheck
npm run build
npm run package:mac
npm run package:win
```

## Judge builds

Judge packages bundle a private local `.env.judge` inside the distributable. The installed app loads it automatically; judges do not need environment variables, API keys, Node.js, or a terminal.

```bash
cp .env.example .env.judge
# Fill .env.judge with temporary hackathon credentials and the demo URL.
npm run package:judge:mac
npm run package:judge:win
```

`.env.judge` is gitignored and must never be committed. Temporary judge credentials are distributed inside the Electron package and must be rotated after judging.

The macOS package is unsigned and not notarized. If Gatekeeper blocks it, right-click Rookie and choose **Open**, or use **System Settings → Privacy & Security → Open Anyway**.
