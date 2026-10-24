# tenet-meet-tests

Playwright end-to-end tests for **Tenet Meet** (`meet.tenetnetworks.com`).

## Setup

```bash
npm install
```

## Running

```bash
export BASE_URL=https://meet.tenetnetworks.com
export MEET_USER=anil@tenetnetworks.com
export MEET_PASS=your_zoho_password
npx playwright test
```

## Test files

| File | What it covers |
|------|---------------|
| `01-auth.spec.js` | Zoho OAuth login, saves `.auth/user.json` |
| `02-dashboard.spec.js` | Dashboard layout, tab navigation |
| `03-start-now-modal.spec.js` | Start Now modal open/close/submit/spinner |
| `04-schedule-modal.spec.js` | Schedule modal, creates meeting |
| `05-meetings-api.spec.js` | REST API CRUD + auth |
| `06-guest-join.spec.js` | Guest join via token URL |
| `07-meeting-list.spec.js` | Meeting cards in correct tabs |
