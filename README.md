# Say So

A configurable AI-powered capture and extraction system. Extract structured insights from voice or text input across multiple use cases.

## What It Does

Say So lets users capture work updates via voice or text, then uses Claude to extract:

- **Action Points** - Specific tasks that need doing
- **Reflections** - Brief takeaways from the update (optional)
- **Clarifying Questions** - When action points need clarification (optional)

## Features

- 🎤 Voice or text input (Web Speech API for Chrome/Edge)
- 🔐 Email + password auth with httpOnly session cookies
- 🤖 AI extraction powered by Claude Sonnet
- 💾 PostgreSQL backend with user-scoped data isolation
- 📱 Responsive, mobile-friendly frontend
- ⚙️ Fully configurable via `config.js`
- 🚀 Deploys to Vercel with serverless functions

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Anthropic API key (Claude access)

### Local Development

1. **Clone and install**
   ```bash
   git clone <repo>
   cd say-so
   npm install
   ```

2. **Set up environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with:
   ```
   DATABASE_URL=postgresql://user:pass@localhost/sayso
   JWT_SECRET=your-random-secret-key
   ANTHROPIC_API_KEY=sk-ant-...
   ```

3. **Start dev server**
   ```bash
   vercel dev
   ```
   Open http://localhost:3000

### Deployment to Vercel

```bash
npm install -g vercel
vercel link
vercel env add DATABASE_URL <your-postgres-url>
vercel env add JWT_SECRET <generate-random-string>
vercel env add ANTHROPIC_API_KEY <your-claude-key>
vercel deploy
```

## Configuration

All customization happens in `config.js`. No need to edit code for:

- App name, description, labels
- Which input methods to enable (voice, text, or both)
- What Claude extracts (action points, reflection, clarifying questions)
- UI colors and theme
- AI model and parameters
- Feature flags

**Example: Customize for bug tracking**

```javascript
import { DEFAULT_CONFIG, mergeConfig } from "./config.js";

export const BUGS_CONFIG = mergeConfig({
  app: {
    name: "Bug Tracker",
    description: "Capture and triage bugs"
  },
  ui: {
    theme: { primaryColor: "#FF6B6B" }
  }
});
```

Then use `BUGS_CONFIG` instead of `DEFAULT_CONFIG`.

## API

All endpoints except auth require authentication (JWT in httpOnly cookie).

### Authentication
- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Entries
- `GET /api/entries` - List entries (50 per page)
- `POST /api/entries` - Create entry from voice/text
- `PATCH /api/entries/:id` - Update with extraction results
- `DELETE /api/entries/:id` - Delete entry

### Extraction
- `POST /api/extract` - Extract insights from text

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for:
- System design and data flow
- File structure and organization
- Security model
- How to extend/customize
- Performance notes

## Use Cases

### Journaling
Capture daily work updates, auto-extract tasks.

### Meeting Notes
Record meetings, auto-extract decisions and action items.

### Bug Triage
Voice-in bug reports, extract reproduce steps and fixes.

### Standup Reports
Quick voice updates, extract yesterday/today/blockers.

### Feedback Capture
Collect user feedback, extract themes and action items.

## Tech Stack

**Frontend**
- Vanilla JavaScript (no build, no framework)
- Web Speech API (voice input)
- Fetch API (http client)
- CSS Grid + Flexbox

**Backend**
- Node.js 20
- Vercel serverless functions
- PostgreSQL (database)
- JWT (sessions)
- bcryptjs (passwords)
- Anthropic SDK (Claude)

## License

MIT

