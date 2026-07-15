# Say So Architecture

A configurable, AI-powered system for capturing user input and extracting structured insights. Designed to work across multiple use cases through a centralized configuration system.

## Key Design Principles

1. **Configuration Over Code** - All user-facing customizations live in `config.js`, not scattered through the codebase
2. **User-Scoped Security** - Every database query enforces user ownership at the SQL level
3. **Serverless Backend** - Vercel Functions handle API requests with no persistent containers
4. **Frontend Simplicity** - Single HTML file, vanilla JS, no build step required
5. **AI-Driven Extraction** - Claude Sonnet processes raw input and extracts structured insights

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (index.html)                   │
│  Vanilla JS, no build step, httpOnly session cookies        │
└────────────────────┬────────────────────────────────────────┘
                     │
    ┌────────────────┴────────────────┐
    │                                 │
┌───▼─────────────────┐   ┌──────────▼──────────────┐
│   Auth APIs         │   │  Entries & Extract      │
│  /api/auth/*        │   │  /api/entries           │
│                     │   │  /api/extract           │
└───┬─────────────────┘   └──────────┬──────────────┘
    │                                 │
    │      ┌─────────────────────────┴─────────────┐
    │      │                                       │
┌───▼──────▼──────────────┐          ┌────────────▼────────┐
│  JWT + httpOnly Cookies │          │  Anthropic Claude   │
│  Signed by JWT_SECRET   │          │  Extracts insights  │
└────────────────────────┘          └─────────────────────┘
                                               │
    ┌───────────────────────────────────────────┘
    │
┌───▼──────────────────────────────┐
│    PostgreSQL Database           │
│  - users (isolated by id)        │
│  - entries (user_id enforced)    │
│  - action_points (denormalized)  │
└──────────────────────────────────┘
```

## File Structure

```
say-so/
├── config.js                 # 👈 START HERE: All configuration
├── index.html                # Frontend (auth + app UI)
├── package.json              # Dependencies
├── .env.example              # Environment variable template
├── vercel.json               # Deployment config
│
├── lib/
│   ├── auth.js              # JWT, cookie, password handling
│   ├── db.js                # Database queries (user-scoped)
│   ├── ai.js                # Claude extraction, prompts
│   └── response.js          # Standardized API responses
│
└── api/
    ├── entries.js           # GET/POST/PATCH/DELETE entries
    ├── extract.js           # POST to extract insights
    └── auth/
        ├── signup.js        # POST new account
        ├── login.js         # POST authenticate
        ├── logout.js        # POST clear session
        └── me.js            # GET current user
```

## Configuration System

All customizable behavior is in `config.js`:

```javascript
export const DEFAULT_CONFIG = {
  app: { name, description },
  capture: { enableVoice, enableText, labels, placeholders },
  extraction: {
    systemPrompt,        // What Claude looks for
    actionPoints: {},    // Settings for action points
    reflection: {},      // Settings for reflections
    clarifyingQuestion: {}
  },
  ui: { theme, labels, layout },
  database: { tables },
  ai: { model, maxTokens },
  auth: { jwtSecret, jwtExpiresIn },
  api: { endpoints },
  features: { voiceInput, textInput, ... }
};
```

### Customizing for Different Use Cases

**Example: For bug report triage:**

```javascript
export const BUGTRACK_CONFIG = mergeConfig({
  app: {
    name: "Bug Tracker",
    description: "Capture and triage bugs from voice or text"
  },
  extraction: {
    systemPrompt: buildSystemPrompt("bugReport"),
    actionPoints: {
      label: "Required Fixes",
      prompt: "What needs fixing?"
    }
  },
  ui: {
    theme: { primaryColor: "#FF6B6B" }
  }
});
```

**Example: For meeting notes:**

```javascript
export const MEETINGS_CONFIG = mergeConfig({
  app: {
    name: "Meeting Notes",
    description: "Extract decisions and action items from meetings"
  },
  extraction: {
    systemPrompt: buildSystemPrompt("meeting"),
    actionPoints: {
      label: "Action Items",
      prompt: "Who needs to do what?"
    }
  }
});
```

## Data Model

### users
```sql
id (uuid, pk)
email (text, unique)
password_hash (text)
created_at, updated_at
```

### entries
```sql
id (uuid, pk)
user_id (uuid, fk to users) ← ENFORCED ON EVERY QUERY
input_type ('voice' | 'text')
input_text (text)
action_points (jsonb array)
reflection (text)
clarifying_question (text)
created_at, updated_at
```

### action_points
```sql
id (uuid, pk)
entry_id (uuid, fk to entries)
text (text)
completed (boolean)
created_at, updated_at
```

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/logout` - Clear session
- `GET /api/auth/me` - Current user (requires auth)

### Entries (requires auth)
- `GET /api/entries` - List all entries
- `POST /api/entries` - Create entry
- `PATCH /api/entries/:id` - Update extraction results
- `DELETE /api/entries/:id` - Delete entry

### Extraction (requires auth)
- `POST /api/extract` - Extract insights from text

## Security Model

**Session Management**
- JWT signed with `JWT_SECRET`
- Stored in httpOnly cookie (no JS access)
- Secure flag in production
- Expires in 7 days (configurable)

**Data Isolation**
- Every query filters by `WHERE user_id = $1`
- `requireAuth(req)` middleware enforces authentication
- Passwords hashed with bcryptjs (10 rounds)

**API Keys**
- `ANTHROPIC_API_KEY` never sent to browser
- All extraction happens server-side
- Database connection string server-only

## Deployment

### Vercel
```bash
npm install
vercel link
vercel env add DATABASE_URL <postgres-connection>
vercel env add JWT_SECRET <random-secret>
vercel env add ANTHROPIC_API_KEY <claude-api-key>
vercel deploy
```

### Local Development
```bash
npm install
cp .env.example .env
# Edit .env with your values
vercel dev
```

## Extending the System

### Add a new extraction type
1. Update `ai.js` to add a prompt in `buildSystemPrompt()`
2. Clients can call `/api/extract` with `extractionType: "yourtype"`

### Add custom fields to entries
1. Extend the `entries` table schema in `config.js`
2. Update the SQL queries in `lib/db.js`
3. Update the frontend form in `index.html`

### Change the AI model
1. Update `config.js`: `ai.model = "claude-opus-4-8"`
2. Re-deploy (no code changes needed)

### Custom branding
1. Update `config.js`: `ui.theme` colors
2. Update `index.html` CSS variable references
3. No backend changes needed

## Performance Considerations

- **Indexes**: Created on `user_id`, `created_at`, `entry_id` for fast queries
- **Pagination**: `/api/entries` returns 50 entries at a time
- **AI Retry**: Exponential backoff if Claude extraction fails
- **JSON Storage**: `action_points` stored as JSONB for fast querying

## Future Extensions

These could be added without changing the core architecture:

- Team/manager views (add `team_id` to users table)
- Custom categories (add `tags` JSONB to entries)
- Due dates on action points (add `due_at` column)
- Slack/email integrations (add handlers in new `/api/integrations/*` endpoints)
- Export to CSV/PDF (add `/api/export` endpoint)
- Real-time collaboration (add WebSocket layer)
