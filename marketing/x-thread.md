# X (Twitter) Thread

## Thread (English, 6 tweets)

---

**Tweet 1 (Hook)**

I built a one-click installer for AI agents.

No terminal. No npm. No config files.

Download → Run → Enter API key. Done.

🔗 github.com/ClawLite/ClawLite-Installer

🧵 Here's why I built it and what I learned ↓

---

**Tweet 2 (Problem)**

Running your own AI agent on Telegram is powerful.

But setting it up means:

- Installing Node.js
- Running npm commands
- Editing JSON config files
- Managing a gateway process

I kept seeing people give up at step 2.

---

**Tweet 3 (Solution)**

So I built ClawLite — a desktop app that handles everything.

It auto-detects your environment, installs dependencies, configures your AI provider (Anthropic / Gemini / OpenAI / MiniMax / GLM), and sets up Telegram.

Works on macOS and Windows.

---

**Tweet 4 (Technical challenge)**

The hardest part? Windows support.

The AI agent runs inside WSL, which has 6 possible states and requires a system reboot mid-install.

I built a state machine that saves your progress and resumes after reboot. IPv6 DNS issues? Fixed those too.

---

**Tweet 5 (Stack)**

Tech stack:
• Electron + electron-vite
• React 19 + Tailwind CSS 4
• TypeScript
• GitHub Actions CI/CD
• Apple Notarization for macOS
• i18n (EN/ZH/JA)

MIT licensed. Fully open source.

---

**Tweet 6 (CTA)**

Try it out:

🍎 macOS: clawlite.ai
🪟 Windows: clawlite.ai

⭐ Star on GitHub: github.com/ClawLite/ClawLite-Installer

Feedback, issues, PRs — all welcome!

#AIAgent #OpenSource #Telegram #Electron

---

## Hashtags

#AIAgent #OpenSource #Telegram #Electron #React #TypeScript #DesktopApp #DevTools
