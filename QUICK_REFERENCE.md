# Say So Quick Reference

## Getting Started

```bash
# Clone
git clone <repo> say-so
cd say-so

# Install
npm install

# Environment
cp .env.example .env
# Edit .env with your values

# Dev
vercel dev
# Visit http://localhost:3000
```

## Core Concepts

### Configuration Is Everything
All customization happens in `config.js`. No code changes needed to:
- Change app name, description
- Update UI colors and labels
- Adjust AI extraction behavior
- Enable/disable features
- Configure security settings

### User Isolation
Every database query enforces `WHERE user_id = $1`. Impossible for users to see each other's data.

### AI-Powered Extraction
Send user input to Claude, get back:
- Action points (tasks)
- Reflection (optional)
- Clarifying question (optional)

## API Cheat Sheet

### Auth (public)
```bash
POST /api/auth/signup
{ email, password }

POST /api/auth/login
{ email, password }

POST /api/auth/logout

GET /api/auth/me
# Returns current user (requires auth)
```

### Entries (requires auth)
```bash
GET /api/entries
# Returns: { entries, pagination }

POST /api/entries
{ inputType: "voice"|"text", inputText: "..." }

PATCH /api/entries/:id
{ actionPoints, reflection, clarifyingQuestion }

DELETE /api/entries/:id
```

### Extraction (requires auth)
```bash
POST /api/extract
{ 
  userInput: "...",
  entryId: "...",                    # optional
  extractionType: "default"|"meeting"|"bug"|"standup",  # optional
  customInstructions: "..."          # optional
}
# Returns: { extraction: { actionPoints, reflection, clarifyingQuestion } }
```

## File Map

| What | Where |
|------|-------|
| Customization | `config.js` |
| Frontend | `index.html` |
| Auth logic | `lib/auth.js` |
| Database queries | `lib/db.js` |
| AI calls | `lib/ai.js` |
| API responses | `lib/response.js` |
| Signup | `api/auth/signup.js` |
| Login | `api/auth/login.js` |
| Logout | `api/auth/logout.js` |
| Get user | `api/auth/me.js` |
| Entries CRUD | `api/entries.js` |
| Extract | `api/extract.js` |

## Common Tasks

### Change App Name
```javascript
// config.js
app: { name: "Bug Tracker" }
```

### Change Theme Colors
```javascript
// config.js
ui: { theme: { primaryColor: "#FF6B6B", accentColor: "#4ECDC4" } }
```

### Add New Extraction Type
```javascript
// lib/ai.js - in buildSystemPrompt()
case "standup":
  return `Extract: what was done yesterday, what's planned today, blockers`;

// Then call API with extractionType: "standup"
```

### Disable Voice Input
```javascript
// config.js
capture: { enableVoice: false, enableText: true }
```

### Upgrade AI Model
```javascript
// config.js
ai: { model: "claude-opus-4-8" }
```

### Deploy to Vercel
```bash
vercel link
vercel env add DATABASE_URL <your-postgres-url>
vercel env add JWT_SECRET <random-secret>
vercel env add ANTHROPIC_API_KEY <your-key>
vercel deploy
```

## Debugging

### Users Can't Log In
1. Check JWT_SECRET is set and consistent
2. Verify database connection works
3. Check bcryptjs is installed

### Extraction Failing
1. Verify ANTHROPIC_API_KEY is valid
2. Check Claude API isn't rate-limited
3. Look at extraction response format in `lib/ai.js`

### Data Not Showing
1. Verify user_id matches in database
2. Check authentication middleware in each endpoint
3. Make sure JWT token is in httpOnly cookie

### Database Connection Error
1. Verify DATABASE_URL is correct
2. Test connection: `psql $DATABASE_URL -c "SELECT 1"`
3. Ensure tables exist: check `lib/db.initializeSchema()`

## Config Deep Dive

### Extraction Config
```javascript
extraction: {
  systemPrompt: "What Claude should do",    // Main instructions
  actionPoints: {
    label: "Action Points",                 // Display label
    prompt: "What tasks need doing?",      // User-facing text
    allowMultiple: true,                    // Can have many
    allowCheck: true                        # Can mark complete
  },
  reflection: {
    label: "Reflection",
    enabled: true,
    prompt: "What's the takeaway?"
  },
  clarifyingQuestion: {
    label: "Clarifying Question",
    enabled: true,
    prompt: "Anything unclear?"
  }
}
```

### Auth Config
```javascript
auth: {
  jwtSecret: "from environment",            // Signs tokens
  jwtExpiresIn: "7d",                       // Token lifetime
  cookieName: "session",                    // Cookie name
  cookieOptions: {
    httpOnly: true,                         // No JS access
    secure: true,  // in production          // HTTPS only
    sameSite: "strict"                      // CSRF prevention
  },
  passwordMinLength: 8                      // Validation
}
```

### Database Config
```javascript
database: {
  tables: {
    users: { columns: [...] },              // Auto-generated
    entries: { columns: [...] },
    action_points: { columns: [...] }
  }
}
```

### AI Config
```javascript
ai: {
  model: "claude-sonnet-4-6",               // Which model
  maxTokens: 1024,                          // Response limit
  temperature: 0.7,                         // Creativity
  retryAttempts: 3,                         // Retry on error
  retryDelayMs: 1000                        // Delay between retries
}
```

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL | `postgresql://user:pass@host/db` |
| `JWT_SECRET` | Sign tokens | `$(openssl rand -hex 32)` |
| `ANTHROPIC_API_KEY` | Claude access | `sk-ant-...` |
| `ANTHROPIC_MODEL` | Which model | `claude-opus-4-8` |
| `APP_NAME` | Branding | `Bug Tracker` |
| `APP_DESCRIPTION` | Branding | `Capture and triage bugs` |
| `NODE_ENV` | Runtime | `production` or `development` |

## Data Model

### users
```sql
id              UUID PRIMARY KEY
email           TEXT UNIQUE NOT NULL
password_hash   TEXT NOT NULL
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### entries
```sql
id                      UUID PRIMARY KEY
user_id                 UUID NOT NULL (references users)
input_type              TEXT ('voice' or 'text')
input_text              TEXT (raw input)
action_points           JSONB (array of strings)
reflection              TEXT (optional)
clarifying_question     TEXT (optional)
created_at              TIMESTAMP
updated_at              TIMESTAMP

INDEX on (user_id)
INDEX on (created_at)
```

### action_points
```sql
id              UUID PRIMARY KEY
entry_id        UUID NOT NULL (references entries)
text            TEXT NOT NULL
completed       BOOLEAN DEFAULT false
created_at      TIMESTAMP
updated_at      TIMESTAMP

INDEX on (entry_id)
```

## Extraction Flow

```
User Input (voice/text)
    ↓
[Frontend captures input]
    ↓
POST /api/entries
  Create entry record in DB
    ↓
POST /api/extract
  Send text to Claude
  Claude analyzes and extracts
    ↓
[Claude responds with JSON]
    ↓
PATCH /api/entries/:id
  Update entry with extraction results
    ↓
Frontend displays:
  - Action Points (clickable checkboxes)
  - Reflection (if provided)
  - Clarifying Question (if provided)
```

## Security Checklist

- [ ] JWT_SECRET is random and strong (use `openssl rand -hex 32`)
- [ ] All passwords hashed with bcryptjs
- [ ] ANTHROPIC_API_KEY never sent to browser
- [ ] httpOnly cookies enabled (no JavaScript access)
- [ ] SameSite=strict prevents CSRF
- [ ] All queries enforce user_id filtering
- [ ] No sensitive data in error messages (sent to frontend)
- [ ] Rate limiting on auth endpoints (consider adding)
- [ ] HTTPS in production (Vercel enforces this)

## Performance Tips

- Database queries are indexed on user_id, created_at
- Extraction is async (doesn't block UI)
- Frontend pagination limits to 50 entries per request
- AI has retry backoff to avoid hammering Claude API
- Serverless functions scale horizontally automatically

## Common Customizations

### Dark -> Light Theme
```javascript
ui: { theme: {
  backgroundColor: "#FFFFFF",
  textColor: "#1a1a1a",
  primaryColor: "#0066FF"
} }
```

### Remove Voice Input
```javascript
capture: { enableVoice: false }
```

### Custom Extraction Prompt
```javascript
extraction: {
  systemPrompt: "Your custom instructions here"
}
```

### Longer Sessions
```javascript
auth: { jwtExpiresIn: "30d" }
```

### More Detailed Extraction
```javascript
ai: { maxTokens: 2048, temperature: 0.3 }
```

## Troubleshooting

| Problem | Likely Cause | Solution |
|---------|--------------|----------|
| Can't signup | Missing PASSWORD_HASH | Check bcryptjs is imported |
| Can't login | Wrong JWT_SECRET | Ensure it matches between requests |
| No entries appear | Missing user_id filter | Check lib/db.js queries |
| Extraction fails | Invalid API key | Verify ANTHROPIC_API_KEY |
| Database error | No connection | Check DATABASE_URL and psql access |
| Voice not working | Browser not supported | Try Chrome/Edge; Safari needs https |
| Slow extraction | Rate limit or model | Try faster model or add retry delay |

## Next Steps

1. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for deep dive
2. Read [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for design rationale
3. Customize [config.js](./config.js) for your use case
4. Deploy to Vercel
5. Monitor in production

## Files to Know

- **config.js** - Where you customize everything
- **index.html** - Frontend UI (also has CSS + JS)
- **lib/ai.js** - Where Claude extraction happens
- **lib/db.js** - Database queries with user isolation
- **api/entries.js** - Main CRUD endpoint

Good luck! 🚀
