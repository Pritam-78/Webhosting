# HTMLhost — Instant HTML Hosting Platform

## Overview
A full-featured HTML website hosting platform where users can sign up, upload or paste HTML, instantly host it, get a unique public link, and manage their sites from a personal dashboard.

## Tech Stack
- **Backend**: Node.js + Express (port 5000)
- **Database**: PostgreSQL (Replit managed)
- **Auth**: JWT tokens + bcryptjs password hashing
- **Frontend**: Vanilla HTML/CSS/JS — dark mode, mobile-friendly

## Key Features
- Email register/login with JWT session
- First-time name setup prompt
- Returning user recognition with personalized welcome
- Paste HTML in code editor OR upload .html file
- Live preview iframe before publishing
- One-click publish with unique slug URL (e.g. /site/abc1234xyz)
- Copy link button
- User dashboard showing all hosted sites
- Delete site with password confirmation
- Hidden admin dashboard at `/pkpadminweb` (password: pritam@ixA)
- Admin sees total users, total sites, user email list, and each user's sites

## Routes
- `GET /` — Landing / dashboard (main app)
- `GET /site/:slug` — Serve hosted HTML page
- `GET /pkpadminweb` — Hidden admin panel
- `POST /api/auth/register` — Register
- `POST /api/auth/login` — Login
- `PUT /api/auth/name` — Set user name
- `GET /api/sites` — Get user's sites
- `POST /api/sites` — Create site (paste)
- `POST /api/sites/upload` — Create site (file upload)
- `DELETE /api/sites/:id` — Delete site (requires password)
- `POST /api/admin/verify` — Admin auth
- `GET /api/admin/stats` — Admin stats
- `GET /api/admin/user/:id/sites` — Admin view user sites

## User Preferences
- Dark mode interface
- Professional, modern design
- Mobile-responsive layout
