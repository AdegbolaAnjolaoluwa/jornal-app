# Say So File Guide

A complete reference to every file in the project and what it does.

## Root Files

### `config.js` - START HERE
The heart of the system. Every user-facing behavior is configurable here.

**What it contains:**
- App name, description
- Capture input settings (voice, text, labels)
- Extraction behavior (prompts, response parsing)
- UI theme colors and labels
- Database schema definition
- AI model parameters
- Authentication settings
- API endpoint definitions
- Feature flags

**When to edit:**
- Changing app name or description
- Updating UI colors or labels
- Adding a new extraction type
- Disabling features
- Changing AI model or parameters

**Key functions:**
- `DEFAULT_CONFIG` - Full configuration object
- `validateConfig()` - Check required env vars
- `getConfig(path)` - Get config value by path
- `mergeConfig(custom)` - Merge custom with defaults

**Size:** 244 lines

### `package.json`
NPM dependencies and project metadata.

**Dependencies:**
- `@anthropic-ai/sdk` - Claude API
- `@vercel/postgres` - Database connection
- `bcryptjs` - Password hashing
- `cookie` - Cookie parsing
- `jsonwebtoken` - JWT tokens

**Size:** 22 lines

### `vercel.json`
Deployment configuration for Vercel.

**Sets:**
- Build command (no build needed)
- Runtime (Node.js 20.x)
- Environment variable bindings
- Default env values

**Size:** 17 lines

### `.env.example`
Template for environment variables.

**Required:**
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - Session signing key
- `ANTHROPIC_API_KEY` - Claude API key

**Optional:**
- `ANTHROPIC_MODEL` - Which Claude model
- `APP_NAME` - App branding
- `APP_DESCRIPTION` - App branding

**Size:** 17 lines

### `.gitignore`
Files to exclude from version control.

**Excludes:**
- `node_modules/` - Dependencies
- `.env` files - Secrets
- Build artifacts
- IDE files (.vscode, .idea)
- OS files (.DS_Store)
- Logs

**Size:** 39 lines

### `index.html`
Single-file frontend. HTML, CSS, and JavaScript combined.

**Sections:**
- `<style>` - All CSS styling (~500 lines)
- `<body>` - All HTML structure (~200 lines)
- `<script>` - All JavaScript (~414 lines)

**Key JavaScript objects:**
- `CONFIG` - Hardcoded API endpoints
- `state` - Frontend state (user, entries, recording)
- API functions - `handleSignup()`, `handleSignin()`, `loadEntries()`, etc.
- Event listeners - Attached at DOM load
- Utility functions - `showAlert()`, `escapeHtml()`, etc.

**Features:**
- Auth screen (sign up / sign in)
- App screen (entry form + list)
- Voice input with waveform
- Text input
- Entry display with extraction results
- Responsive design

**Size:** 1,114 lines

---

## Documentation Files

### `README.md`
User-facing guide for the project.

**Sections:**
- What it does
- Features list
- Quick start (local dev + production)
- Configuration overview
- API reference
- Tech stack
- Use cases

**For:** New users, deployment guide

**Size:** 160 lines

### `ARCHITECTURE.md`
System design and technical reference.

**Sections:**
- Key design principles
- System architecture diagram
- File structure explanation
- Configuration system deep dive
- Customization examples (meeting, bugs)
- Data model (with SQL)
- API endpoints
- Security model
- Deployment guide
- Performance notes
- Extension patterns
- Future possibilities

**For:** Developers, architects, maintenance

**Size:** 258 lines

### `IMPLEMENTATION_SUMMARY.md`
What was built and why.

**Sections:**
- Overview of what's built
- Configuration-driven architecture
- Authentication & security
- Input capture & processing
- AI-powered extraction
- Data model explanation
- Frontend single-file design
- Serverless backend design
- Deployment readiness
- Documentation overview
- How to customize (5 examples)
- Design decisions explained
- Use case examples
- Generalization vs. original spec
- Files overview table
- Testing checklist
- Next steps (deploy, extend, customize)
- Performance & scalability
- Security summary

**For:** Stakeholders, technical leads, understanding rationale

**Size:** 412 lines

### `QUICK_REFERENCE.md`
Cheat sheet and common tasks.

**Sections:**
- Getting started (npm install, dev)
- Core concepts
- API cheat sheet (with curl examples)
- File map (what's where)
- Common tasks (15 examples)
- Config deep dives
- Environment variables table
- Data model reference
- Extraction flow diagram
- Security checklist
- Performance tips
- Common customizations
- Troubleshooting guide
- File guide (what to know)

**For:** Daily development, quick answers, troubleshooting

**Size:** 400 lines

### `PROJECT_STATUS.md`
Project completion status and statistics.

**Sections:**
- Project status (✅ COMPLETE)
- What's built (checklist)
- Code statistics
- Feature checklist (comprehensive)
- Configuration system reference
- API reference (complete)
- Database schema (SQL)
- Deployment checklist
- Security verification
- Performance characteristics
- What's next (roadmap)
- How to use this project
- Summary and quick stats

**For:** Project management, status updates, reference

**Size:** 500 lines

### `FILE_GUIDE.md` (this file)
Complete reference to every file in the project.

**For:** Navigation, understanding project structure

---

## Backend Files

### `lib/auth.js`
Authentication utilities: JWT, cookies, passwords.

**Exports:**
- `signToken(userId)` - Create JWT
- `verifyToken(token)` - Validate JWT
- `getTokenFromRequest(req)` - Extract JWT from cookie
- `getUserIdFromRequest(req)` - Extract user ID from JWT
- `requireAuth(req)` - Middleware to enforce authentication
- `setCookieHeader(token)` - Format Set-Cookie header
- `clearCookieHeader()` - Clear session cookie
- `hashPassword(password)` - Bcryptjs hash
- `comparePassword(password, hash)` - Bcryptjs compare
- `validatePassword(password)` - Check password strength

**Used by:** All API endpoints (auth check), auth endpoints (signup/login)

**Size:** 132 lines

### `lib/db.js`
Database queries with user-scoped data access.

**Exports:**
- `query(queryText, values)` - Execute raw query
- `queryOne(queryText, values)` - Get single result
- `users.findById(id)` - Get user by ID
- `users.findByEmail(email)` - Get user by email
- `users.create(email, hash)` - Create new user
- `users.update(id, updates)` - Update user
- `entries.findByUserId(userId, limit, offset)` - List entries (user-scoped)
- `entries.findById(id, userId)` - Get entry (with ownership check)
- `entries.create(userId, inputType, inputText)` - Create entry
- `entries.updateExtraction(id, userId, extraction)` - Update with AI results
- `entries.delete(id, userId)` - Delete entry (with ownership check)
- `entries.countByUserId(userId)` - Count user's entries
- `actionPoints.findByEntryId(entryId, userId)` - Get action points (checked)
- `actionPoints.create(entryId, userId, text)` - Create action point
- `actionPoints.updateCompleted(apId, userId, completed)` - Toggle completion
- `actionPoints.delete(apId, userId)` - Delete action point
- `initializeSchema()` - Create tables and indexes

**Security:** Every function enforces `WHERE user_id = $1`

**Used by:** All API endpoints that touch data

**Size:** 253 lines

### `lib/ai.js`
AI integration with Claude for extraction.

**Exports:**
- `extractInsights(userInput)` - Main extraction function
- `parseExtractionResponse(responseText)` - Parse Claude JSON
- `buildSystemPrompt(type, customInstructions)` - Create prompt
- `validateExtraction(extraction)` - Check format
- `getModelInfo()` - Debug info

**Prompt types:**
- `default` - Action points + reflection + clarification
- `meeting` - Decisions and action items
- `bugReport` - Bug, steps, expected behavior
- `standup` - Yesterday, today, blockers

**Retry logic:** Exponential backoff up to 3 attempts

**Used by:** `/api/extract` endpoint

**Size:** 181 lines

### `lib/response.js`
Standardized API response formatting.

**Exports:**
- `success(data, statusCode)` - Success response
- `error(message, statusCode, details)` - Error response
- `validationError(fields)` - 422 validation error
- `unauthorized(message)` - 401 unauthorized
- `notFound(resource)` - 404 not found
- `methodNotAllowed(method)` - 405 method not allowed
- `withErrorHandling(handler)` - Wrap handler with error catching

**Used by:** All API endpoints for consistent response format

**Size:** 107 lines

---

## API Endpoint Files

### `api/auth/signup.js`
Create a new user account.

**Endpoint:** `POST /api/auth/signup`

**Request:**
```json
{ "email": "...", "password": "..." }
```

**Response:**
```json
{ "success": true, "data": { "user": { "id", "email", "createdAt" } } }
```

**Process:**
1. Validate email and password
2. Check if user already exists
3. Hash password with bcryptjs
4. Create user in database
5. Sign JWT token
6. Set httpOnly cookie
7. Return user data

**Error handling:**
- 422: Missing fields, invalid email, password too weak, user exists
- 500: Database or hashing error

**Size:** 95 lines

### `api/auth/login.js`
Authenticate a user with email/password.

**Endpoint:** `POST /api/auth/login`

**Request:**
```json
{ "email": "...", "password": "..." }
```

**Response:**
```json
{ "success": true, "data": { "user": { "id", "email" } } }
```

**Process:**
1. Validate input
2. Find user by email
3. Compare password hash
4. Sign JWT token
5. Set httpOnly cookie
6. Return user data

**Error handling:**
- 422: Missing fields
- 401: User not found or wrong password
- 500: Database or comparison error

**Size:** 70 lines

### `api/auth/logout.js`
Clear session cookie.

**Endpoint:** `POST /api/auth/logout`

**Response:**
```json
{ "success": true, "data": { "message": "Logged out successfully" } }
```

**Process:**
1. Clear httpOnly cookie (max-age=0)
2. Return success message

**Size:** 22 lines

### `api/auth/me.js`
Get current authenticated user.

**Endpoint:** `GET /api/auth/me`

**Requires:** Authentication (JWT in httpOnly cookie)

**Response:**
```json
{ "success": true, "data": { "user": { "id", "email", "createdAt", "updatedAt" } } }
```

**Process:**
1. Extract user ID from JWT
2. Query database
3. Return user data

**Error handling:**
- 401: Not authenticated
- 404: User not found
- 500: Database error

**Size:** 50 lines

### `api/entries.js`
CRUD operations for entries (voice/text captures).

**Endpoints:**
- `GET /api/entries` - List entries
- `POST /api/entries` - Create entry
- `PATCH /api/entries/:id` - Update entry with extraction
- `DELETE /api/entries/:id` - Delete entry

**Requires:** Authentication on all endpoints

**Process:**
1. Extract user ID from JWT
2. Route to appropriate handler
3. Enforce user ownership in database queries
4. Return result

**Validation:**
- inputType: must be 'voice' or 'text'
- inputText: must not be empty
- entryId: must belong to current user

**Error handling:**
- 401: Not authenticated
- 404: Entry not found
- 405: Method not allowed
- 422: Validation error
- 500: Database error

**Size:** 180 lines

### `api/extract.js`
Extract insights from user input using Claude.

**Endpoint:** `POST /api/extract`

**Requires:** Authentication (JWT in httpOnly cookie)

**Request:**
```json
{
  "userInput": "...",
  "entryId": "..." (optional),
  "extractionType": "default|meeting|bug|standup" (optional),
  "customInstructions": "..." (optional)
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "extraction": {
      "actionPoints": ["...", "..."],
      "reflection": "..." (optional),
      "clarifyingQuestion": "..." (optional)
    },
    "entry": { ...updated entry } (if entryId provided)
  }
}
```

**Process:**
1. Extract user ID from JWT
2. Validate userInput
3. If entryId provided, verify ownership
4. Call Claude for extraction
5. Validate response format
6. If entryId provided, update entry
7. Return extraction results

**Error handling:**
- 401: Not authenticated
- 404: Entry not found
- 422: Validation error, invalid extraction format
- 500: Claude API error, database error

**Size:** 84 lines

---

## Summary by File Type

### Configuration & Setup (3 files)
- `config.js` - Application configuration
- `package.json` - Dependencies
- `vercel.json` - Deployment config

### Environment (1 file)
- `.env.example` - Environment template

### Frontend (1 file)
- `index.html` - Complete frontend (HTML/CSS/JS)

### Backend Libraries (4 files)
- `lib/auth.js` - Authentication utilities
- `lib/db.js` - Database queries
- `lib/ai.js` - AI extraction
- `lib/response.js` - Response formatting

### Backend Endpoints (6 files)
- `api/auth/signup.js` - User creation
- `api/auth/login.js` - User authentication
- `api/auth/logout.js` - Session clearing
- `api/auth/me.js` - Current user
- `api/entries.js` - Entry CRUD
- `api/extract.js` - AI extraction

### Documentation (5 files)
- `README.md` - User guide
- `ARCHITECTURE.md` - System design
- `IMPLEMENTATION_SUMMARY.md` - What was built
- `QUICK_REFERENCE.md` - Cheat sheet
- `PROJECT_STATUS.md` - Completion status

### Meta (1 file)
- `.gitignore` - Git exclusions

### Navigation (1 file)
- `FILE_GUIDE.md` - This file

---

## File Dependencies

```
Frontend (index.html)
  ├── Calls /api/auth/signup
  ├── Calls /api/auth/login
  ├── Calls /api/auth/logout
  ├── Calls /api/auth/me
  ├── Calls /api/entries
  └── Calls /api/extract

API Endpoints
  ├── api/auth/signup.js
  │   └── Uses lib/auth.js (hashPassword, signToken, setCookieHeader)
  │   └── Uses lib/db.js (users.create)
  │   └── Uses lib/response.js (success, validationError)
  │
  ├── api/auth/login.js
  │   └── Uses lib/auth.js (comparePassword, signToken, setCookieHeader)
  │   └── Uses lib/db.js (users.findByEmail)
  │   └── Uses lib/response.js (success, unauthorized)
  │
  ├── api/auth/logout.js
  │   └── Uses lib/auth.js (clearCookieHeader)
  │   └── Uses lib/response.js (success)
  │
  ├── api/auth/me.js
  │   └── Uses lib/auth.js (requireAuth)
  │   └── Uses lib/db.js (users.findById)
  │   └── Uses lib/response.js (success, unauthorized, notFound)
  │
  ├── api/entries.js
  │   └── Uses lib/auth.js (requireAuth)
  │   └── Uses lib/db.js (entries.*)
  │   └── Uses lib/response.js (success, validationError, notFound)
  │
  └── api/extract.js
      └── Uses lib/auth.js (requireAuth)
      └── Uses lib/db.js (entries.findById, entries.updateExtraction)
      └── Uses lib/ai.js (extractInsights, validateExtraction)
      └── Uses lib/response.js (success, unauthorized, validationError)

All API endpoints
  └── Depend on config.js for constants (indirectly through lib files)
```

---

## Where to Look For...

| Need | File |
|------|------|
| Change app name/colors | `config.js` |
| Change UI labels | `config.js` |
| Add extraction type | `config.js` + `lib/ai.js` |
| Fix auth bug | `lib/auth.js` or `api/auth/*.js` |
| Fix data query bug | `lib/db.js` or `api/entries.js` |
| Fix extraction bug | `lib/ai.js` or `api/extract.js` |
| Fix frontend bug | `index.html` |
| Understand architecture | `ARCHITECTURE.md` |
| Deploy | `README.md` + `vercel.json` + `.env.example` |
| Quick answer | `QUICK_REFERENCE.md` |
| Show progress | `PROJECT_STATUS.md` |
| Learn why decisions | `IMPLEMENTATION_SUMMARY.md` |

---

## Reading Order

### For New Users
1. `README.md` - Understand what it does
2. `QUICK_REFERENCE.md` - Learn how to use it
3. Deploy to Vercel

### For Developers
1. `ARCHITECTURE.md` - Understand the system
2. `config.js` - See all configuration
3. `api/entries.js` - See example endpoint
4. `lib/db.js` - See database queries
5. `index.html` - See frontend

### For Customization
1. `QUICK_REFERENCE.md` - See common tasks
2. `config.js` - Make changes
3. Redeploy

### For Troubleshooting
1. `QUICK_REFERENCE.md` - Check debugging section
2. `PROJECT_STATUS.md` - Check security/performance
3. Relevant API endpoint file

### For Extension
1. `ARCHITECTURE.md` - See extension patterns
2. `IMPLEMENTATION_SUMMARY.md` - See design rationale
3. Review relevant file (auth, db, ai, api)
4. Implement following existing patterns

Good luck! 🚀
