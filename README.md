# Rookie

**Sports, translated.**

Rookie listens to the sports commentary you're already hearing and explains unfamiliar sports language the moment it is said.

It is designed for people who want to enjoy sports without already knowing every term, strategy, or rule.

## What Rookie does

- Explains sports terminology in real time
- Adds contextual AI explanations based on what is happening right now
- Gives a newcomer-friendly pre-race Rookie Brief
- Provides race alerts and followed-driver updates
- Shows Formula 1 stats without leaving the app

## Try Rookie

Download the latest build from the **Releases** section of this repository.

Available builds:

- macOS — Apple Silicon
- Windows — x64

Installation instructions are included in the release description.

## How to use it

1. Open Rookie.
2. Choose **Formula 1**.
3. Press **TRY DEMO** to try Rookie with a prepared race clip.
4. Grant the requested system-audio / screen-capture permission.
5. Allow notifications if you want Rookie race alerts outside the app.

Rookie listens to the **real system audio** playing on your computer.

When the commentary mentions an unfamiliar Formula 1 term, Rookie detects it and shows an explanation directly over what you're watching.

The demo uses the same real speech-recognition and AI pipeline as normal viewing — the transcript and explanation events are not simulated.

### Permissions

Rookie may request OS permissions the first time you use it.

**macOS**
- Allow **Screen & System Audio Recording** when requested so Rookie can hear the broadcast.
- Allow **Notifications** to receive race alerts.
- If you change a permission in System Settings, macOS may require Rookie to be restarted.

**Windows**
- Allow screen/system-audio capture if Windows asks for permission.
- Allow Rookie notifications if prompted so race alerts can appear outside the app.

Rookie does not intentionally save captured audio or screen video to disk.

### While watching

- Keep Rookie running while your broadcast or video is playing.
- Explanations appear automatically when Rookie detects supported terminology.
- Press `⌃⇧R` on macOS or `Ctrl+Shift+R` on Windows to stop listening.

### Before the race

Open the Formula 1 hub to see the **Rookie Brief** for the next Grand Prix.

### When you're not watching

Use **Alerts** to follow race events or specific drivers.

## Tech

Electron · React · TypeScript · Azure Speech · Microsoft Foundry · OpenF1 · Jolpica
