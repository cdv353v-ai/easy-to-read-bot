# Medical Transcription Bot

Telegram bot that receives a medical document (photo or PDF) and returns:
- Full transcription
- Flagged critical fragments
- Plain-language explanation

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Edit `.env` and fill in your keys:
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

Get a Telegram bot token from [@BotFather](https://t.me/BotFather).  
Get an Anthropic API key from [console.anthropic.com](https://console.anthropic.com).

### 3. Set the system prompt
Open `bot.js` and replace the placeholder inside `SYSTEM_PROMPT` (line ~8) with your full prompt from `medical_transcription_project.md`.

### 4. Run locally
```bash
npm start
```

## Usage

Send the bot a photo or PDF of a medical document.  
It will reply with a structured analysis — no commands, no menus.

Any other message type returns: `Отправьте медицинский документ — фото или PDF.`

## Notes

- Supports: photos, PDFs, images sent as files
- Model: `claude-sonnet-4-20250514`
- PDF support requires the Anthropic SDK beta document feature (included automatically via the SDK)
